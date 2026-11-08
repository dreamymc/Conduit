(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    const cursorHelper = require('./cursor-helper');
    module.exports = factory(cursorHelper);
  } else {
    root.ScrollBall = factory(root.CursorHelper);
  }
})(typeof self !== 'undefined' ? self : this, function(CursorHelper) {
  'use strict';

  /**
   * ScrollBall Component:
   * Middle-mouse style autoscroll ball located at middle-right of the screen.
   * Features:
   * 1. Draggable inner nub that snaps back to center on release.
   * 2. Visual up and down triangle arrows.
   * 3. Proportional continuous scrolling when dragged up/down (slight = slow, far = fast).
   * 4. Arrow navigation mode (up/down/left/right) when terminal text is highlighted.
   */
  class ScrollBall {
    constructor(options = {}) {
      this.term = options.term || null;
      this.sendInput = options.sendInput || (() => {});
      this.onScroll = options.onScroll || null;
      this.isHighlightedCallback = options.isHighlighted || null;
      this.container = options.container || null;

      // Physics & geometry
      this.maxRadius = options.maxRadius || 26; // max nub distance from center (px)
      this.deadzone = options.deadzone || 4;     // deadzone before movement triggers (px)
      this.minScrollSpeed = options.minScrollSpeed || 2;   // lines / sec
      this.maxScrollSpeed = options.maxScrollSpeed || 60;  // lines / sec

      // Arrow repeat timing
      this.arrowRepeatDelay = options.arrowRepeatDelay || 220; // ms
      this.minArrowInterval = options.minArrowInterval || 60;  // ms at max displacement
      this.maxArrowInterval = options.maxArrowInterval || 220; // ms near deadzone

      // State
      this.isDragging = false;
      this.dragMode = null; // 'arrow' | 'scroll' | null
      this.dx = 0;
      this.dy = 0;
      this.centerX = 0;
      this.centerY = 0;
      this.scrollAccumulator = 0;
      this.lastScrollTime = 0;
      this.animFrameId = null;
      this.arrowTimer = null;
      this.arrowIntervalTimer = null;
      this.activeArrowDirection = null;
      this._activeListenerType = null;

      // DOM Elements
      this.element = null;
      this.nubEl = null;

      // Bound handlers
      this._boundPointerDown = this._handlePointerDown.bind(this);
      this._boundPointerMove = this._handlePointerMove.bind(this);
      this._boundPointerUp = this._handlePointerUp.bind(this);
      this._boundTouchStart = this._handleTouchStart.bind(this);
      this._boundTouchMove = this._handleTouchMove.bind(this);
      this._boundTouchEnd = this._handleTouchEnd.bind(this);
      this._boundStepScroll = this._stepScroll.bind(this);
    }

    /**
     * Checks whether text in the terminal is highlighted.
     */
    isTextHighlighted() {
      if (typeof this.isHighlightedCallback === 'function') {
        return Boolean(this.isHighlightedCallback());
      }
      if (this.term && typeof this.term.hasSelection === 'function') {
        return Boolean(this.term.hasSelection());
      }
      return false;
    }

    /**
     * Calculate scroll speed in lines per second based on displacement dy.
     * dy > 0: dragging down -> scroll down (positive speed)
     * dy < 0: dragging up   -> scroll up   (negative speed)
     */
    calculateScrollSpeed(dy) {
      const absY = Math.abs(dy);
      if (absY <= this.deadzone) {
        return 0;
      }
      const sign = Math.sign(dy);
      const effectiveDist = absY - this.deadzone;
      const maxDist = Math.max(1, this.maxRadius - this.deadzone);
      const norm = Math.min(1, effectiveDist / maxDist);
      // Non-linear acceleration: slight movement = slow, far = fast
      const speed = this.minScrollSpeed + (this.maxScrollSpeed - this.minScrollSpeed) * Math.pow(norm, 1.5);
      return sign * speed;
    }

    /**
     * Determine dominant arrow direction from (dx, dy).
     */
    getArrowDirection(dx, dy) {
      const dist = Math.hypot(dx, dy);
      if (dist <= this.deadzone) {
        return null;
      }
      if (Math.abs(dy) >= Math.abs(dx)) {
        return dy < 0 ? 'up' : 'down';
      } else {
        return dx < 0 ? 'left' : 'right';
      }
    }

    /**
     * Sends the appropriate cursor key sequence for a given direction.
     */
    sendArrowKey(direction) {
      if (!direction) return;
      let seq = '';
      if (CursorHelper && typeof CursorHelper.getCursorKeySequence === 'function') {
        seq = CursorHelper.getCursorKeySequence(direction, this.term);
      } else {
        const map = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' };
        seq = map[direction] || '';
      }
      if (seq && typeof this.sendInput === 'function') {
        this.sendInput(seq);
      }
    }

    /**
     * Perform scroll step through onScroll callback or term.scrollLines.
     */
    _dispatchScrollStep(step) {
      if (step === 0) return;
      if (typeof this.onScroll === 'function') {
        this.onScroll(step);
      } else if (this.term && typeof this.term.scrollLines === 'function') {
        this.term.scrollLines(step);
      }
    }

    syncArrowMode() {
      if (!this.element) return;
      if (this.isDragging) return; // Keep drag mode visually locked during active drag
      const isHigh = this.isTextHighlighted();
      if (isHigh) {
        this.element.classList.add('arrow-mode');
      } else {
        this.element.classList.remove('arrow-mode');
      }
    }

    _addWindowListeners(type) {
      this._removeWindowListeners();
      if (typeof window === 'undefined' || !window.addEventListener) return;
      if (type === 'pointer') {
        window.addEventListener('pointermove', this._boundPointerMove, { passive: false });
        window.addEventListener('pointerup', this._boundPointerUp, { passive: false });
        window.addEventListener('pointercancel', this._boundPointerUp, { passive: false });
        this._activeListenerType = 'pointer';
      } else if (type === 'touch') {
        window.addEventListener('touchmove', this._boundTouchMove, { passive: false });
        window.addEventListener('touchend', this._boundTouchEnd, { passive: false });
        window.addEventListener('touchcancel', this._boundTouchEnd, { passive: false });
        this._activeListenerType = 'touch';
      }
    }

    _removeWindowListeners() {
      if (typeof window === 'undefined' || !window.removeEventListener) return;
      if (this._activeListenerType === 'pointer' || !this._activeListenerType) {
        window.removeEventListener('pointermove', this._boundPointerMove);
        window.removeEventListener('pointerup', this._boundPointerUp);
        window.removeEventListener('pointercancel', this._boundPointerUp);
      }
      if (this._activeListenerType === 'touch' || !this._activeListenerType) {
        window.removeEventListener('touchmove', this._boundTouchMove);
        window.removeEventListener('touchend', this._boundTouchEnd);
        window.removeEventListener('touchcancel', this._boundTouchEnd);
      }
      this._activeListenerType = null;
    }

    _startScrolling() {
      this._stopScrolling();
      this.scrollAccumulator = 0;
      this.lastScrollTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      this._stepScroll();
    }

    _stepScroll() {
      if (!this.isDragging || this.dragMode === 'arrow') {
        this._stopScrolling();
        return;
      }

      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const dt = Math.max(1, now - this.lastScrollTime) / 1000; // in seconds
      this.lastScrollTime = now;

      const speed = this.calculateScrollSpeed(this.dy);
      if (speed !== 0) {
        this.scrollAccumulator += speed * dt;
        const step = Math.trunc(this.scrollAccumulator);
        if (step !== 0) {
          this.scrollAccumulator -= step;
          this._dispatchScrollStep(step);
        }
      }

      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
      this.animFrameId = raf(this._boundStepScroll);
    }

    _stopScrolling() {
      if (this.animFrameId) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.animFrameId);
        } else {
          clearTimeout(this.animFrameId);
        }
        this.animFrameId = null;
      }
      this.scrollAccumulator = 0;
    }

    _startArrowRepeat(direction) {
      this._stopArrowRepeat();
      if (!direction) return;

      this.activeArrowDirection = direction;
      // Send first arrow immediately
      this.sendArrowKey(direction);

      const dist = Math.hypot(this.dx, this.dy);
      const effectiveDist = Math.max(0, dist - this.deadzone);
      const maxDist = Math.max(1, this.maxRadius - this.deadzone);
      const norm = Math.min(1, effectiveDist / maxDist);
      const interval = this.maxArrowInterval - (this.maxArrowInterval - this.minArrowInterval) * norm;

      // Start initial delay timer
      this.arrowTimer = setTimeout(() => {
        this._arrowRepeatLoop(interval);
      }, this.arrowRepeatDelay);
    }

    _arrowRepeatLoop(currentInterval) {
      if (!this.isDragging || this.dragMode !== 'arrow' || !this.activeArrowDirection) {
        this._stopArrowRepeat();
        return;
      }

      this.sendArrowKey(this.activeArrowDirection);

      const dist = Math.hypot(this.dx, this.dy);
      const effectiveDist = Math.max(0, dist - this.deadzone);
      const maxDist = Math.max(1, this.maxRadius - this.deadzone);
      const norm = Math.min(1, effectiveDist / maxDist);
      const nextInterval = this.maxArrowInterval - (this.maxArrowInterval - this.minArrowInterval) * norm;

      this.arrowIntervalTimer = setTimeout(() => {
        this._arrowRepeatLoop(nextInterval);
      }, nextInterval);
    }

    _stopArrowRepeat() {
      if (this.arrowTimer) {
        clearTimeout(this.arrowTimer);
        this.arrowTimer = null;
      }
      if (this.arrowIntervalTimer) {
        clearTimeout(this.arrowIntervalTimer);
        this.arrowIntervalTimer = null;
      }
      this.activeArrowDirection = null;
    }

    _updateNubPosition(rawDx, rawDy) {
      const dist = Math.hypot(rawDx, rawDy);
      if (dist > this.maxRadius && dist > 0) {
        this.dx = (rawDx / dist) * this.maxRadius;
        this.dy = (rawDy / dist) * this.maxRadius;
      } else {
        this.dx = rawDx;
        this.dy = rawDy;
      }

      if (this.nubEl) {
        this.nubEl.style.transform = `translate(${this.dx}px, ${this.dy}px)`;
        this.nubEl.style.transition = 'none';
      }

      if (!this.dragMode) {
        this.dragMode = this.isTextHighlighted() ? 'arrow' : 'scroll';
      }

      // Mode check: text highlighted vs continuous scrolling
      if (this.dragMode === 'arrow') {
        this._stopScrolling();
        if (this.element) this.element.classList.add('arrow-mode');

        const newDir = this.getArrowDirection(this.dx, this.dy);
        if (newDir !== this.activeArrowDirection) {
          if (newDir) {
            this._startArrowRepeat(newDir);
          } else {
            this._stopArrowRepeat();
          }
        }
      } else {
        this._stopArrowRepeat();
        if (this.element) this.element.classList.remove('arrow-mode');

        if (!this.animFrameId) {
          this._startScrolling();
        }
      }
    }

    _resetNub() {
      this.isDragging = false;
      this.dragMode = null;
      this.dx = 0;
      this.dy = 0;
      this._stopScrolling();
      this._stopArrowRepeat();
      this._removeWindowListeners();

      if (this.nubEl) {
        this.nubEl.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        this.nubEl.style.transform = 'translate(0px, 0px)';
      }
      if (this.element) {
        this.element.classList.remove('active');
      }
      this.syncArrowMode();
    }

    _computeCenter() {
      if (!this.element) return;
      if (typeof this.element.getBoundingClientRect === 'function') {
        const rect = this.element.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;
      }
    }

    _handlePointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();

      this._computeCenter();
      this.isDragging = true;
      this.dragMode = this.isTextHighlighted() ? 'arrow' : 'scroll';
      if (this.element) {
        this.element.classList.add('active');
        if (this.dragMode === 'arrow') {
          this.element.classList.add('arrow-mode');
        } else {
          this.element.classList.remove('arrow-mode');
        }
      }

      const clientX = e.clientX !== undefined ? e.clientX : 0;
      const clientY = e.clientY !== undefined ? e.clientY : 0;
      this._updateNubPosition(clientX - this.centerX, clientY - this.centerY);

      this._addWindowListeners('pointer');
    }

    _handlePointerMove(e) {
      if (!this.isDragging) return;
      if (e.preventDefault) e.preventDefault();
      const clientX = e.clientX !== undefined ? e.clientX : 0;
      const clientY = e.clientY !== undefined ? e.clientY : 0;
      this._updateNubPosition(clientX - this.centerX, clientY - this.centerY);
    }

    _handlePointerUp(e) {
      if (e && e.preventDefault) e.preventDefault();
      this._resetNub();
    }

    _handleTouchStart(e) {
      if (e.touches && e.touches.length !== 1) return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();

      this._computeCenter();
      this.isDragging = true;
      this.dragMode = this.isTextHighlighted() ? 'arrow' : 'scroll';
      if (this.element) {
        this.element.classList.add('active');
        if (this.dragMode === 'arrow') {
          this.element.classList.add('arrow-mode');
        } else {
          this.element.classList.remove('arrow-mode');
        }
      }

      const touch = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
      const clientX = touch.clientX !== undefined ? touch.clientX : 0;
      const clientY = touch.clientY !== undefined ? touch.clientY : 0;
      this._updateNubPosition(clientX - this.centerX, clientY - this.centerY);

      this._addWindowListeners('touch');
    }

    _handleTouchMove(e) {
      if (!this.isDragging) return;
      if (e.touches && e.touches.length === 0) return;
      if (e.preventDefault) e.preventDefault();
      const touch = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
      const clientX = touch.clientX !== undefined ? touch.clientX : 0;
      const clientY = touch.clientY !== undefined ? touch.clientY : 0;
      this._updateNubPosition(clientX - this.centerX, clientY - this.centerY);
    }

    _handleTouchEnd(e) {
      if (e && e.preventDefault) e.preventDefault();
      this._resetNub();
    }

    render() {
      if (typeof document === 'undefined') return null;

      const ball = document.createElement('div');
      ball.id = 'scroll-ball';
      ball.className = 'scroll-ball';
      ball.setAttribute('role', 'toolbar');
      ball.setAttribute('aria-label', 'Scroll Ball navigation');
      ball.innerHTML = `
        <div class="scroll-ball-disc">
          <div class="scroll-arrow arrow-up" aria-hidden="true">▲</div>
          <div class="scroll-arrow arrow-down" aria-hidden="true">▼</div>
          <div class="scroll-arrow arrow-left" aria-hidden="true">◀</div>
          <div class="scroll-arrow arrow-right" aria-hidden="true">▶</div>
          <div class="scroll-ball-nub">
            <div class="nub-core"></div>
          </div>
        </div>
      `;

      this.element = ball;
      this.nubEl = ball.querySelector('.scroll-ball-nub');

      // Use Pointer Events when supported, fallback to touch
      if (typeof window !== 'undefined' && window.PointerEvent) {
        ball.addEventListener('pointerdown', this._boundPointerDown);
      } else {
        ball.addEventListener('touchstart', this._boundTouchStart, { passive: false });
        ball.addEventListener('mousedown', this._boundPointerDown);
      }

      this.syncArrowMode();
      return ball;
    }

    mount(container = (typeof document !== 'undefined' ? document.body : null)) {
      this.container = container;
      if (!this.element) {
        this.render();
      }
      if (this.container && this.element) {
        this.container.appendChild(this.element);
      }
      this.syncArrowMode();
      return this.element;
    }

    unmount() {
      this._resetNub();
      if (this.element && this.element.parentNode) {
        this.element.removeEventListener('pointerdown', this._boundPointerDown);
        this.element.removeEventListener('touchstart', this._boundTouchStart);
        this.element.removeEventListener('mousedown', this._boundPointerDown);
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
      this.nubEl = null;
    }
  }

  return {
    ScrollBall
  };
});
