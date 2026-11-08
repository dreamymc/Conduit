(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MobileDock = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * MobileDock Component:
   * Fixed 44px reflex key dock with sticky CTRL modifier state machine,
   * connection status dot, virtual keyboard protection, and swipe-up power sheet gesture.
   */
  class MobileDock {
    constructor(options = {}) {
      this.sendInput = options.sendInput || (() => {});
      this.onTogglePowerSheet = options.onTogglePowerSheet || (() => {});
      this.container = null;
      this.element = null;

      // Sticky CTRL state: 'inactive' | 'active' | 'locked'
      this.ctrlState = 'inactive';
      this.lastCtrlTapTime = 0;

      // Connection status: 'connected' | 'reconnecting' | 'disconnected'
      this.connectionStatus = options.connectionStatus || 'connected';

      // Swipe-up tracking
      this.touchStartY = 0;
      this.touchStartX = 0;
      this.isSwiping = false;

      this.lastPointerActionTime = 0;

      this._boundPointerDown = this._handlePointerDown.bind(this);
      this._boundClick = this._handleClick.bind(this);
      this._boundDockTouchStart = this._handleDockTouchStart.bind(this);
      this._boundDockTouchMove = this._handleDockTouchMove.bind(this);
      this._boundDockTouchEnd = this._handleDockTouchEnd.bind(this);
    }

    /**
     * (4) Spec Fix: Sticky CTRL hooks onData, converts only single-char data, else clears and passes through.
     * @param {string} data - Incoming text from term.onData
     * @param {function} sendFn - Callback to send data to WebSocket
     * @returns {string|null} The converted or original data sent (or null if not handled)
     */
    handleData(data, sendFn = this.sendInput) {
      if (this.ctrlState === 'inactive') {
        if (typeof sendFn === 'function') sendFn(data);
        return data;
      }

      if (data && data.length === 1) {
        const charCode = data.charCodeAt(0);
        // ASCII control code conversion
        const ctrlCode = String.fromCharCode(charCode & 0x1f);
        if (typeof sendFn === 'function') sendFn(ctrlCode);

        // Single tap auto-clears; locked remains locked
        if (this.ctrlState === 'active') {
          this.setCtrlState('inactive');
        }
        return ctrlCode;
      } else {
        // Multi-char data (e.g. paste or escape sequence): clear sticky state and pass through
        if (this.ctrlState === 'active') {
          this.setCtrlState('inactive');
        }
        if (typeof sendFn === 'function') sendFn(data);
        return data;
      }
    }

    setCtrlState(state) {
      this.ctrlState = state;
      if (!this.element) return;

      const ctrlBtn = this.element.querySelector('.dock-ctrl-btn');
      if (!ctrlBtn) return;

      ctrlBtn.classList.remove('ctrl-active', 'ctrl-locked');
      if (state === 'active') {
        ctrlBtn.classList.add('ctrl-active');
      } else if (state === 'locked') {
        ctrlBtn.classList.add('ctrl-locked');
      }
    }

    getCtrlState() {
      return this.ctrlState;
    }

    _handleCtrlTap() {
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const elapsed = now - this.lastCtrlTapTime;

      if (this.ctrlState === 'inactive') {
        this.setCtrlState('active');
        this.lastCtrlTapTime = now;
      } else if (this.ctrlState === 'active') {
        if (elapsed < 300) {
          // Double tap within 300ms locks sticky CTRL
          this.setCtrlState('locked');
        } else {
          // Tapped again after delay -> turn off
          this.setCtrlState('inactive');
        }
        this.lastCtrlTapTime = 0;
      } else if (this.ctrlState === 'locked') {
        // 3rd tap unlocks and turns off
        this.setCtrlState('inactive');
        this.lastCtrlTapTime = 0;
      }
    }

    setConnectionStatus(status) {
      this.connectionStatus = status;
      if (!this.element) return;
      const dot = this.element.querySelector('.status-dot');
      if (!dot) return;

      dot.className = 'status-dot';
      if (status === 'connected') {
        dot.classList.add('status-connected');
        dot.title = 'Connected';
      } else if (status === 'reconnecting') {
        dot.classList.add('status-reconnecting');
        dot.title = 'Reconnecting';
      } else if (status === 'disconnected') {
        dot.classList.add('status-disconnected');
        dot.title = 'Disconnected';
      }
    }

    _executeAction(action) {
      switch (action) {
        case 'esc':
          this.sendInput('\x1b');
          break;
        case 'tab':
          this.sendInput('\t');
          break;
        case 'ctrl':
          this._handleCtrlTap();
          break;
        case 'ctrl-c':
          this.sendInput('\x03');
          break;
        case 'menu':
          if (typeof this.onTogglePowerSheet === 'function') {
            this.onTogglePowerSheet();
          }
          break;
      }
    }

    _handlePointerDown(e) {
      // Virtual Keyboard Protection: preventDefault prevents virtual keyboard from losing focus
      e.preventDefault();

      const btn = e.target.closest('.dock-btn');
      if (!btn) return;

      this.lastPointerActionTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const action = btn.getAttribute('data-action');
      this._executeAction(action);
    }

    _handleClick(e) {
      // Ignore click if pointerdown already processed this action within 300ms
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this.lastPointerActionTime < 300) {
        return;
      }
      const btn = e.target.closest('.dock-btn');
      if (!btn) return;

      const action = btn.getAttribute('data-action');
      this._executeAction(action);
    }

    _handleDockTouchStart(e) {
      if (e.touches.length !== 1) return;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartX = e.touches[0].clientX;
      this.isSwiping = true;
    }

    _handleDockTouchMove(e) {
      if (!this.isSwiping || e.touches.length === 0) return;
      const dy = e.touches[0].clientY - this.touchStartY;
      const dx = e.touches[0].clientX - this.touchStartX;

      // Swipe-Up gesture: dragging upward from the dock (delta y < -30px)
      if (dy < -30 && Math.abs(dy) > Math.abs(dx)) {
        this.isSwiping = false;
        if (typeof this.onTogglePowerSheet === 'function') {
          this.onTogglePowerSheet(true); // force open
        }
      }
    }

    _handleDockTouchEnd() {
      this.isSwiping = false;
    }

    render() {
      const dock = document.createElement('div');
      dock.id = 'mobile-dock';
      dock.className = 'mobile-dock';
      dock.innerHTML = `
        <button class="dock-btn" data-action="esc" type="button">ESC</button>
        <button class="dock-btn" data-action="tab" type="button">TAB</button>
        <button class="dock-btn dock-ctrl-btn" data-action="ctrl" type="button">CTRL</button>
        <button class="dock-btn" data-action="ctrl-c" type="button">^C</button>
        <button class="dock-btn dock-menu-btn" data-action="menu" type="button" aria-label="Open Power Sheet">
          <span class="status-dot ${this._getStatusClass()}"></span>
          <span class="menu-icon">≡</span>
        </button>
      `;

      // Use pointerdown with preventDefault to protect virtual keyboard retention
      dock.addEventListener('pointerdown', this._boundPointerDown);
      dock.addEventListener('click', this._boundClick);
      dock.addEventListener('touchstart', this._boundDockTouchStart, { passive: true });
      dock.addEventListener('touchmove', this._boundDockTouchMove, { passive: true });
      dock.addEventListener('touchend', this._boundDockTouchEnd, { passive: true });

      this.element = dock;
      return dock;
    }

    _getStatusClass() {
      if (this.connectionStatus === 'connected') return 'status-connected';
      if (this.connectionStatus === 'reconnecting') return 'status-reconnecting';
      return 'status-disconnected';
    }

    mount(container = document.body) {
      this.container = container;
      if (!this.element) {
        this.render();
      }
      this.container.appendChild(this.element);
      return this.element;
    }

    unmount() {
      if (this.element && this.element.parentNode) {
        this.element.removeEventListener('pointerdown', this._boundPointerDown);
        this.element.removeEventListener('click', this._boundClick);
        this.element.removeEventListener('touchstart', this._boundDockTouchStart);
        this.element.removeEventListener('touchmove', this._boundDockTouchMove);
        this.element.removeEventListener('touchend', this._boundDockTouchEnd);
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    }
  }

  return {
    MobileDock
  };
});
