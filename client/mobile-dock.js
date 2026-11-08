(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MobileDock = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  function copyFallback(text) {
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
      if (success) resolve(true);
      else reject(new Error('execCommand copy failed'));
    });
  }

  function writeClipboard(text) {
    if (!text) return Promise.resolve();
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(() => copyFallback(text));
    }
    return copyFallback(text);
  }

  /**
   * MobileDock Component:
   * Fixed 44px reflex key dock with exactly four buttons:
   * [ ENTER ], [ ESC ], [ COPY ], [ PASTE ]
   * Includes virtual keyboard protection (pointerdown preventDefault) and click deduplication.
   */
  class MobileDock {
    constructor(options = {}) {
      this.term = options.term || null;
      this.sendInput = options.sendInput || (() => {});
      this.onCopy = options.onCopy || null;
      this.onPaste = options.onPaste || null;
      this.onEsc = options.onEsc || null;
      this.onEnter = options.onEnter || null;
      this.container = null;
      this.element = null;

      // Sticky CTRL state for backwards compatibility
      this.ctrlState = 'inactive';
      this.lastCtrlTapTime = 0;

      // Connection status: 'connected' | 'reconnecting' | 'disconnected'
      this.connectionStatus = options.connectionStatus || 'connected';

      this.lastPointerActionTime = 0;

      this._boundPointerDown = this._handlePointerDown.bind(this);
      this._boundClick = this._handleClick.bind(this);
    }

    /**
     * Sticky CTRL hooks onData, converts only single-char data, else clears and passes through.
     */
    handleData(data, sendFn = this.sendInput) {
      if (this.ctrlState === 'inactive') {
        if (typeof sendFn === 'function') sendFn(data);
        return data;
      }

      if (data && data.length === 1) {
        const charCode = data.charCodeAt(0);
        const ctrlCode = String.fromCharCode(charCode & 0x1f);
        if (typeof sendFn === 'function') sendFn(ctrlCode);

        if (this.ctrlState === 'active') {
          this.setCtrlState('inactive');
        }
        return ctrlCode;
      } else {
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
          this.setCtrlState('locked');
        } else {
          this.setCtrlState('inactive');
        }
        this.lastCtrlTapTime = 0;
      } else if (this.ctrlState === 'locked') {
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

    _fallbackPaste() {
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const text = window.prompt('Paste text to terminal:');
        if (text && typeof this.sendInput === 'function') {
          this.sendInput(text);
        }
      }
    }

    _executeAction(action, btnElement) {
      switch (action) {
        case 'enter':
          if (typeof this.onEnter === 'function') {
            this.onEnter();
          } else {
            this.sendInput('\r');
          }
          break;

        case 'esc':
          if (typeof this.onEsc === 'function') {
            this.onEsc();
          }
          this.sendInput('\x1b');
          if (this.term && typeof this.term.clearSelection === 'function') {
            this.term.clearSelection();
          }
          break;

        case 'copy': {
          let hasText = false;
          if (typeof this.onCopy === 'function') {
            const res = this.onCopy();
            hasText = res !== false;
          } else {
            let text = '';
            if (this.term && typeof this.term.getSelection === 'function') {
              text = this.term.getSelection();
            }
            if (text) {
              writeClipboard(text);
              hasText = true;
            }
          }
          // Visual feedback on the button only when text was selected/copied
          if (hasText && btnElement) {
            const originalText = btnElement.textContent;
            btnElement.textContent = 'COPIED';
            btnElement.classList.add('dock-btn-highlight');
            setTimeout(() => {
              btnElement.textContent = originalText;
              btnElement.classList.remove('dock-btn-highlight');
            }, 600);
          }
          break;
        }

        case 'paste':
          if (typeof this.onPaste === 'function') {
            this.onPaste();
          } else {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
              navigator.clipboard.readText().then(text => {
                if (text && typeof this.sendInput === 'function') {
                  this.sendInput(text);
                }
              }).catch(err => {
                console.error('MobileDock paste error, falling back to prompt:', err);
                this._fallbackPaste();
              });
            } else {
              this._fallbackPaste();
            }
          }
          break;

        // Backward compatibility actions
        case 'tab':
          this.sendInput('\t');
          break;
        case 'ctrl':
          this._handleCtrlTap();
          break;
        case 'ctrl-c':
          this.sendInput('\x03');
          break;
      }
    }

    _handlePointerDown(e) {
      // Virtual Keyboard Protection: preventDefault keeps virtual keyboard open
      if (e.preventDefault) e.preventDefault();

      const btn = e.target && e.target.closest ? e.target.closest('.dock-btn') : null;
      if (!btn) return;

      this.lastPointerActionTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const action = btn.getAttribute('data-action');
      this._executeAction(action, btn);
    }

    _handleClick(e) {
      // Deduplicate pointerdown + click within 300ms
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this.lastPointerActionTime < 300) {
        return;
      }
      const btn = e.target && e.target.closest ? e.target.closest('.dock-btn') : null;
      if (!btn) return;

      const action = btn.getAttribute('data-action');
      this._executeAction(action, btn);
    }

    render() {
      const dock = document.createElement('div');
      dock.id = 'mobile-dock';
      dock.className = 'mobile-dock';
      dock.setAttribute('role', 'toolbar');
      dock.setAttribute('aria-label', 'Mobile terminal dock');
      dock.innerHTML = `
        <button class="dock-btn" data-action="enter" type="button">ENTER</button>
        <button class="dock-btn" data-action="esc" type="button">ESC</button>
        <button class="dock-btn" data-action="copy" type="button">COPY</button>
        <button class="dock-btn" data-action="paste" type="button">PASTE</button>
      `;

      // Pointerdown with preventDefault protects virtual keyboard focus
      dock.addEventListener('pointerdown', this._boundPointerDown);
      dock.addEventListener('click', this._boundClick);

      this.element = dock;
      return dock;
    }

    mount(container = (typeof document !== 'undefined' ? document.body : null)) {
      this.container = container;
      if (!this.element) {
        this.render();
      }
      if (this.container && this.element) {
        this.container.appendChild(this.element);
      }
      return this.element;
    }

    unmount() {
      if (this.element && this.element.parentNode) {
        this.element.removeEventListener('pointerdown', this._boundPointerDown);
        this.element.removeEventListener('click', this._boundClick);
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    }
  }

  return {
    MobileDock
  };
});
