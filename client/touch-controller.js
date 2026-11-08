(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    const cursorHelper = require('./cursor-helper');
    module.exports = factory(cursorHelper);
  } else {
    root.TouchController = factory(root.CursorHelper);
  }
})(typeof self !== 'undefined' ? self : this, function(CursorHelper) {
  'use strict';

  /**
   * Helper to handle fractional line accumulation.
   */
  class FractionalLineAccumulator {
    constructor(lineHeight = 18) {
      this.lineHeight = lineHeight;
      this.accumulator = 0;
    }

    setLineHeight(lh) {
      if (lh > 0) this.lineHeight = lh;
    }

    /**
     * dy: pixel displacement (positive = dragging down, negative = dragging up)
     * returns integer lines to scroll (negative = scroll up, positive = scroll down)
     */
    addDisplacement(dy) {
      if (!this.lineHeight || this.lineHeight <= 0 || dy === 0) return 0;
      this.accumulator += -dy / this.lineHeight;
      const step = Math.trunc(this.accumulator) || 0;
      this.accumulator -= step;
      if (this.accumulator === 0 || Math.abs(this.accumulator) < 1e-9) {
        this.accumulator = 0;
      }
      return step;
    }

    reset() {
      this.accumulator = 0;
    }
  }

  /**
   * Clipboard fallback using hidden textarea and execCommand.
   */
  function copyToClipboardFallback(text) {
    if (typeof document === 'undefined') return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0.01';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      if (typeof textarea.setSelectionRange === 'function') {
        textarea.setSelectionRange(0, text.length);
      }
      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (err) {
        success = false;
      }
      document.body.removeChild(textarea);
      if (success) {
        resolve(true);
      } else {
        reject(new Error('execCommand copy failed'));
      }
    });
  }

  function copyText(text) {
    if (!text) return Promise.resolve();
    const hasWindow = typeof window !== 'undefined';
    const isSecure = hasWindow && (
      window.isSecureContext ||
      (window.location && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    );
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && isSecure) {
      return navigator.clipboard.writeText(text).catch(() => copyToClipboardFallback(text));
    }
    return copyToClipboardFallback(text);
  }

  /**
   * TouchController class for terminal touch handling:
   * 1. Screen dragging scroll on the terminal is DISABLED.
   * 2. Short tap focuses terminal.
   * 3. Long-press highlights text / activates copy mode.
   * 4. Exposes buffer-aware _routeScrollStep for the ScrollBall.
   */
  class TouchController {
    constructor(term, sendInputCallback, options = {}) {
      this.term = term;
      this.sendInput = sendInputCallback;
      this.container = options.container || (term ? term.element : null);

      // Screen dragging scroll on the terminal is DISABLED by default
      this.screenDragScrollEnabled = options.screenDragScrollEnabled || false;
      this.onCopyModeChange = options.onCopyModeChange || null;

      this.friction = (options.friction !== undefined) ? options.friction : 0.975;
      this.velocityGain = (options.velocityGain !== undefined) ? options.velocityGain : 1.75;
      this.velocityThreshold = 0.01; // px/ms
      this.longPressDelay = 500; // ms

      this.accumulator = new FractionalLineAccumulator(18);
      this.samples = []; // Rolling ~150ms window: [{ y, time }]
      this.animFrameId = null;
      this.copyTimer = null;
      this.copyPillEl = null;

      this.touchStartX = 0;
      this.touchStartY = 0;
      this.lastY = 0;
      this.lastX = 0;
      this.lastTime = 0;
      this.velocity = 0;
      this.isCopyModeActive = false;
      this.longPressTriggered = false;
      this.hasMoved = false;

      this._boundTouchStart = this._handleTouchStart.bind(this);
      this._boundTouchMove = this._handleTouchMove.bind(this);
      this._boundTouchEnd = this._handleTouchEnd.bind(this);
      this._boundTouchCancel = this._handleTouchCancel.bind(this);
      this._boundContextMenu = (e) => {
        if (this.longPressTriggered || this.isCopyModeActive) {
          e.preventDefault();
        }
      };

      if (this.container) {
        this.attach(this.container);
      }
    }

    getCellDimensions() {
      if (!this.term || !this.term.element) {
        return { width: 9, height: 18 };
      }
      const core = this.term._core;
      if (core && core._renderService && core._renderService.dimensions && core._renderService.dimensions.css && core._renderService.dimensions.css.cell) {
        const { width, height } = core._renderService.dimensions.css.cell;
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      const screenEl = (this.term.element.querySelector && this.term.element.querySelector('.xterm-screen')) || this.term.element;
      const rect = screenEl && screenEl.getBoundingClientRect ? screenEl.getBoundingClientRect() : { width: 0, height: 0 };
      const width = (rect.width > 0 && this.term.cols > 0) ? (rect.width / this.term.cols) : 9;
      const height = (rect.height > 0 && this.term.rows > 0) ? (rect.height / this.term.rows) : 18;
      return { width, height };
    }

    attach(container) {
      this.container = container;
      if (!this.container) return;

      this.container.style.touchAction = 'none';
      this.container.style.userSelect = 'none';
      this.container.style.webkitUserSelect = 'none';
      this.container.style.webkitTouchCallout = 'none';

      this.container.addEventListener('touchstart', this._boundTouchStart, { passive: false });
      this.container.addEventListener('touchmove', this._boundTouchMove, { passive: false });
      this.container.addEventListener('touchend', this._boundTouchEnd, { passive: false });
      this.container.addEventListener('touchcancel', this._boundTouchCancel, { passive: false });
      this.container.addEventListener('contextmenu', this._boundContextMenu, { passive: false });
    }

    detach() {
      if (!this.container) return;
      this.stopMomentum();
      this.clearCopyTimer();
      this.hideCopyPill();

      this.container.removeEventListener('touchstart', this._boundTouchStart);
      this.container.removeEventListener('touchmove', this._boundTouchMove);
      this.container.removeEventListener('touchend', this._boundTouchEnd);
      this.container.removeEventListener('touchcancel', this._boundTouchCancel);
      this.container.removeEventListener('contextmenu', this._boundContextMenu);
    }

    stopMomentum() {
      if (this.animFrameId) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.animFrameId);
        } else {
          clearTimeout(this.animFrameId);
        }
        this.animFrameId = null;
      }
      this.velocity = 0;
    }

    clearCopyTimer() {
      if (this.copyTimer) {
        clearTimeout(this.copyTimer);
        this.copyTimer = null;
      }
    }

    _handleTouchStart(e) {
      if (e.touches.length > 1) {
        this.clearCopyTimer();
        this.stopMomentum();
        return;
      }

      this.stopMomentum();
      this.clearCopyTimer();

      const touch = e.touches[0];
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.lastX = touch.clientX;
      this.lastY = touch.clientY;
      this.lastTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      this.longPressTriggered = false;
      this.hasMoved = false;

      const { height } = this.getCellDimensions();
      this.accumulator.setLineHeight(height);
      this.accumulator.reset();
      this.samples = [{ y: touch.clientY, time: this.lastTime }];

      // Dismiss copy pill if tapping outside it
      if (this.isCopyModeActive && (!this.copyPillEl || !this.copyPillEl.contains(e.target))) {
        this.hideCopyPill();
      }

      // 500ms long-press to highlight text / enter copy mode
      this.copyTimer = setTimeout(() => {
        this._triggerCopyMode(touch.clientX, touch.clientY);
      }, this.longPressDelay);
    }

    _handleTouchMove(e) {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const deltaX = touch.clientX - this.touchStartX;
      const deltaY = touch.clientY - this.touchStartY;
      const dist = Math.hypot(deltaX, deltaY);

      if (dist > 10) {
        this.hasMoved = true;
        this.clearCopyTimer();
        if (this.isCopyModeActive || this.longPressTriggered) {
          this.hideCopyPill();
          this.samples = [{ y: this.lastY, time: now - 16 }];
        }
      } else if (this.isCopyModeActive || this.longPressTriggered) {
        if (e.preventDefault) e.preventDefault();
        return;
      }

      if (e.preventDefault) e.preventDefault();

      const dy = touch.clientY - this.lastY;

      this.samples.push({ y: touch.clientY, time: now });
      while (this.samples.length > 3 && (now - this.samples[0].time) > 150) {
        this.samples.shift();
      }

      this.lastX = touch.clientX;
      this.lastY = touch.clientY;
      this.lastTime = now;

      // SCREEN DRAGGING SCROLL IS DISABLED BY DEFAULT:
      // Only scroll if explicitly enabled
      if (this.screenDragScrollEnabled) {
        const step = this.accumulator.addDisplacement(dy);
        if (step !== 0) {
          this._routeScrollStep(step, touch.clientX, touch.clientY);
        }
      }
    }

    calculateReleaseVelocity(now = ((typeof performance !== 'undefined') ? performance.now() : Date.now())) {
      let windowSamples = this.samples.filter(s => (now - s.time) <= 150);
      if (windowSamples.length < 3 && this.samples.length >= 2) {
        windowSamples = this.samples.slice(-3);
      }
      if (windowSamples.length < 2) {
        return 0;
      }

      let weightedVelSum = 0;
      let totalWeight = 0;

      for (let i = 0; i < windowSamples.length - 1; i++) {
        const sA = windowSamples[i];
        const sB = windowSamples[i + 1];
        const dt = sB.time - sA.time;
        if (dt > 0) {
          const segVel = (sB.y - sA.y) / dt;
          const weight = i + 1;
          weightedVelSum += segVel * weight;
          totalWeight += weight;
        }
      }

      let baseVelocity = 0;
      if (totalWeight > 0) {
        baseVelocity = weightedVelSum / totalWeight;
      } else {
        const first = windowSamples[0];
        const last = windowSamples[windowSamples.length - 1];
        const totalDt = last.time - first.time;
        if (totalDt > 0) {
          baseVelocity = (last.y - first.y) / totalDt;
        }
      }

      return baseVelocity * this.velocityGain;
    }

    _handleTouchEnd(e) {
      this.clearCopyTimer();

      if (this.longPressTriggered) {
        return;
      }

      const touch = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
      const deltaX = touch ? (touch.clientX - this.touchStartX) : 0;
      const deltaY = touch ? (touch.clientY - this.touchStartY) : 0;
      const isShortTap = !this.hasMoved && Math.hypot(deltaX, deltaY) < 10;

      // Short-tap calls term.focus()
      if (isShortTap) {
        if (this.term && typeof this.term.focus === 'function') {
          this.term.focus();
        }
        return;
      }

      // SCREEN DRAGGING SCROLL DISABLED:
      // Momentum scrolling is only started if screenDragScrollEnabled is true
      if (this.screenDragScrollEnabled) {
        const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        const releaseVel = this.calculateReleaseVelocity(now);
        if ((now - this.lastTime) <= 150 && Math.abs(releaseVel) >= this.velocityThreshold) {
          this.velocity = releaseVel;
          this._startMomentum();
        }
      }
    }

    _handleTouchCancel() {
      this.clearCopyTimer();
      this.stopMomentum();
      if (this.isCopyModeActive || this.longPressTriggered) {
        this.hideCopyPill();
      }
    }

    getFrictionDecay(dt) {
      return Math.pow(this.friction, dt / 16.67);
    }

    _startMomentum() {
      this.stopMomentum();
      if (Math.abs(this.velocity) < this.velocityThreshold) {
        return;
      }

      let lastAnimTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : (fn) => setTimeout(() => fn((typeof performance !== 'undefined') ? performance.now() : Date.now()), 16);

      const stepMomentum = (currentTime) => {
        const dt = Math.max(1, currentTime - lastAnimTime);
        lastAnimTime = currentTime;

        if (Math.abs(this.velocity) < this.velocityThreshold) {
          this.stopMomentum();
          return;
        }

        const dy = this.velocity * dt;
        this.velocity *= this.getFrictionDecay(dt);

        const step = this.accumulator.addDisplacement(dy);
        if (step !== 0) {
          this._routeScrollStep(step, this.lastX, this.lastY);
        }

        this.animFrameId = raf(stepMomentum);
      };

      this.animFrameId = raf(stepMomentum);
    }

    /**
     * Routes accumulated scroll steps to the appropriate destination based on buffer type.
     */
    _routeScrollStep(step, clientX = 0, clientY = 0) {
      if (!this.term) return;

      if (clientX === 0 && clientY === 0 && this.container && typeof this.container.getBoundingClientRect === 'function') {
        const rect = this.container.getBoundingClientRect();
        clientX = rect.left + rect.width / 2;
        clientY = rect.top + rect.height / 2;
      }

      const isAlternate = Boolean(
        this.term.buffer &&
        this.term.buffer.active &&
        this.term.buffer.active.type === 'alternate'
      );

      if (!isAlternate) {
        // Normal Buffer: term.scrollLines(step)
        if (typeof this.term.scrollLines === 'function') {
          this.term.scrollLines(step);
        }
      } else {
        // Alternate Buffer
        const mouseTracking = Boolean(
          this.term.modes &&
          this.term.modes.mouseTrackingMode &&
          this.term.modes.mouseTrackingMode !== 'none'
        );

        if (mouseTracking) {
          const { height } = this.getCellDimensions();
          const wheelDelta = step * height;
          if (this.term.element) {
            let wheelEvt;
            if (typeof WheelEvent !== 'undefined') {
              wheelEvt = new WheelEvent('wheel', {
                deltaY: wheelDelta,
                clientX: clientX,
                clientY: clientY,
                bubbles: true,
                cancelable: true
              });
            } else {
              wheelEvt = {
                type: 'wheel',
                deltaY: wheelDelta,
                clientX: clientX,
                clientY: clientY,
                bubbles: true,
                cancelable: true
              };
            }
            if (typeof this.term.element.dispatchEvent === 'function') {
              this.term.element.dispatchEvent(wheelEvt);
            }
          }
        } else {
          // Alt buffer without mouse tracking: cursor keys
          const direction = step < 0 ? 'up' : 'down';
          const seq = CursorHelper ? CursorHelper.getCursorKeySequence(direction, this.term) : (direction === 'up' ? '\x1b[A' : '\x1b[B');
          const count = Math.abs(step);
          if (this.sendInput && seq) {
            for (let i = 0; i < count; i++) {
              this.sendInput(seq);
            }
          }
        }
      }
    }

    /**
     * Long-press copy / highlight mode: looks up word at touch position and selects it.
     */
    _triggerCopyMode(clientX, clientY) {
      this.longPressTriggered = true;
      this.isCopyModeActive = true;
      this.stopMomentum();

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (e) {}
      }

      if (typeof this.onCopyModeChange === 'function') {
        this.onCopyModeChange(true);
      }

      const { width, height } = this.getCellDimensions();
      const screenEl = (this.term && this.term.element)
        ? ((this.term.element.querySelector && this.term.element.querySelector('.xterm-screen')) || this.term.element)
        : null;
      const rect = (screenEl && screenEl.getBoundingClientRect)
        ? screenEl.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0 };

      const col = Math.max(0, Math.min(this.term.cols - 1, Math.floor((clientX - rect.left) / width)));
      const row = Math.max(0, Math.min(this.term.rows - 1, Math.floor((clientY - rect.top) / height)));

      const bufferRow = (this.term.buffer && this.term.buffer.active) ? (this.term.buffer.active.viewportY + row) : row;
      const line = (this.term.buffer && this.term.buffer.active && typeof this.term.buffer.active.getLine === 'function')
        ? this.term.buffer.active.getLine(bufferRow)
        : null;

      let startCol = col;
      let endCol = col + 1;

      if (line && typeof line.translateToString === 'function') {
        const lineStr = line.translateToString(true);
        if (col < lineStr.length && lineStr[col].trim() !== '') {
          const wordRegex = /[a-zA-Z0-9_\-./:@~]/;
          startCol = col;
          while (startCol > 0 && wordRegex.test(lineStr[startCol - 1])) {
            startCol--;
          }
          endCol = col;
          while (endCol < lineStr.length && wordRegex.test(lineStr[endCol])) {
            endCol++;
          }
        }
      }

      const wordLength = Math.max(1, endCol - startCol);
      if (this.term && typeof this.term.select === 'function') {
        this.term.select(startCol, bufferRow, wordLength);
      }
      // Floating pill omitted on mobile; dock reflex keys [ENTER], [ESC], [COPY], [PASTE] control actions
    }

    triggerCopyMode(clientX, clientY) {
      if (clientX === undefined || clientY === undefined) {
        const rect = (this.container || (this.term && this.term.element))
          ? (this.container || this.term.element).getBoundingClientRect()
          : { left: 0, top: 0, width: 300, height: 200 };
        clientX = rect.left + rect.width / 2;
        clientY = rect.top + rect.height / 2;
      }
      this._triggerCopyMode(clientX, clientY);
    }

    _showCopyPill(clientX, clientY) {
      // Kept for backward compatibility if pill element exists or needed
      if (typeof document === 'undefined') return;

      if (!this.copyPillEl) {
        const pill = document.createElement('div');
        pill.id = 'mobile-copy-pill';
        pill.className = 'mobile-copy-pill';
        pill.innerHTML = `
          <button class="pill-btn pill-copy">Copy</button>
          <button class="pill-btn pill-cancel">Cancel</button>
        `;
        document.body.appendChild(pill);
        this.copyPillEl = pill;

        const copyBtn = pill.querySelector('.pill-copy');
        const cancelBtn = pill.querySelector('.pill-cancel');

        const handleCopy = (e) => {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          const selectedText = this.term ? this.term.getSelection() : '';
          copyText(selectedText)
            .then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => {
                copyBtn.textContent = 'Copy';
                this.hideCopyPill();
              }, 600);
            })
            .catch(() => {
              copyBtn.textContent = 'Failed';
              setTimeout(() => {
                copyBtn.textContent = 'Copy';
                this.hideCopyPill();
              }, 1000);
            });
        };

        const handleCancel = (e) => {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          this.hideCopyPill();
        };

        copyBtn.addEventListener('click', handleCopy);
        cancelBtn.addEventListener('click', handleCancel);
      }

      const pill = this.copyPillEl;
      pill.style.display = 'flex';
      pill.style.visibility = 'hidden';

      const pillWidth = pill.offsetWidth || 140;
      const pillHeight = pill.offsetHeight || 36;
      let left = clientX - (pillWidth / 2);
      let top = clientY - pillHeight - 14;

      const maxLeft = (typeof window !== 'undefined' ? window.innerWidth : 360) - pillWidth - 10;
      left = Math.max(10, Math.min(maxLeft, left));
      if (top < 10) {
        top = clientY + 24;
      }

      pill.style.left = `${left}px`;
      pill.style.top = `${top}px`;
      pill.style.visibility = 'visible';
    }

    hideCopyPill() {
      if (this.copyPillEl) {
        this.copyPillEl.style.display = 'none';
      }
      if (this.term && typeof this.term.clearSelection === 'function') {
        this.term.clearSelection();
      }
      const wasActive = this.isCopyModeActive;
      this.isCopyModeActive = false;
      this.longPressTriggered = false;
      this.hasMoved = false;
      if (wasActive && typeof this.onCopyModeChange === 'function') {
        this.onCopyModeChange(false);
      }
    }
  }

  return {
    FractionalLineAccumulator,
    TouchController,
    copyToClipboardFallback,
    copyText
  };
});
