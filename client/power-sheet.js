(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    const cursorHelper = require('./cursor-helper');
    module.exports = factory(cursorHelper);
  } else {
    root.PowerSheet = factory(root.CursorHelper);
  }
})(typeof self !== 'undefined' ? self : this, function(CursorHelper) {
  'use strict';

  const DEFAULT_MACROS = [
    { name: 'git status', cmd: 'git status\n' },
    { name: 'docker ps', cmd: 'docker ps\n' },
    { name: 'npm test', cmd: 'npm test\n' }
  ];

  const SYMBOLS = ['|', '~', '/', '-', '_', '$', '&', '>', ';', '{', '}'];

  /**
   * PowerSheet pull-up drawer component.
   */
  class PowerSheet {
    constructor(options = {}) {
      this.term = options.term || null;
      this.sendInput = options.sendInput || (() => {});
      this.onSwitchShell = options.onSwitchShell || (() => {});
      this.onReconnect = options.onReconnect || (() => {});
      this.onLogout = options.onLogout || (() => {});
      this.onTriggerCopyMode = options.onTriggerCopyMode || (() => {});
      this.activeShell = options.activeShell || 'bash';

      this.isOpen = false;
      this.element = null;
      this.scrimEl = null;

      // Touch drag-to-dismiss tracking
      this.dragStartY = 0;
      this.isDragging = false;

      this.macros = this.loadMacros();
    }

    loadMacros() {
      if (typeof localStorage === 'undefined') {
        return [...DEFAULT_MACROS];
      }
      try {
        const stored = localStorage.getItem('conduit_macros');
        if (stored !== null) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        }
      } catch (e) {
        console.error('Error loading macros from localStorage:', e);
      }
      return [...DEFAULT_MACROS];
    }

    saveMacros() {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem('conduit_macros', JSON.stringify(this.macros));
      } catch (e) {
        console.error('Error saving macros to localStorage:', e);
      }
    }

    setActiveShell(shell) {
      this.activeShell = shell;
      if (this.element) {
        const select = this.element.querySelector('.sheet-shell-select');
        if (select) {
          select.value = shell;
        }
      }
    }

    open() {
      if (!this.element) {
        this.render();
      }
      this.isOpen = true;
      if (this.scrimEl) this.scrimEl.classList.add('visible');
      if (this.element) this.element.classList.add('open');
    }

    close() {
      this.isOpen = false;
      if (this.scrimEl) this.scrimEl.classList.remove('visible');
      if (this.element) this.element.classList.remove('open');
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    render() {
      if (typeof document === 'undefined') return null;

      // Scrim
      let scrim = document.getElementById('sheet-scrim');
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.id = 'sheet-scrim';
        scrim.className = 'sheet-scrim';
        document.body.appendChild(scrim);
        scrim.addEventListener('click', () => this.close());
      }
      this.scrimEl = scrim;

      // Sheet container
      let sheet = document.getElementById('power-sheet');
      if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'power-sheet';
        sheet.className = 'power-sheet';
        document.body.appendChild(sheet);
      }
      this.element = sheet;

      this.updateContent();
      this._bindEvents();

      return sheet;
    }

    updateContent() {
      if (!this.element) return;

      this.element.innerHTML = `
        <div class="sheet-handle-bar">
          <div class="sheet-handle"></div>
        </div>
        <div class="sheet-header">
          <span class="sheet-title">Power Tools</span>
          <button class="sheet-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        
        <div class="sheet-content">
          <!-- 1. Navigation D-Pad -->
          <div class="sheet-section">
            <div class="section-title">Navigation D-Pad</div>
            <div class="dpad-container">
              <div class="dpad-grid">
                <div></div>
                <button class="dpad-btn" data-dir="up" type="button" aria-label="Up">↑</button>
                <div></div>
                <button class="dpad-btn" data-dir="left" type="button" aria-label="Left">←</button>
                <button class="dpad-btn dpad-center" data-action="history" type="button" title="Search History (Ctrl+R)">^R</button>
                <button class="dpad-btn" data-dir="right" type="button" aria-label="Right">→</button>
                <button class="dpad-btn dpad-clear" data-action="clear" type="button" title="Clear Screen (Ctrl+L)">^L</button>
                <button class="dpad-btn" data-dir="down" type="button" aria-label="Down">↓</button>
                <div></div>
              </div>
            </div>
          </div>

          <!-- 2. Shell Symbol Strip -->
          <div class="sheet-section">
            <div class="section-title">Shell Symbols</div>
            <div class="symbols-grid">
              ${SYMBOLS.map(s => `<button class="symbol-btn" data-sym="${s}" type="button">${s}</button>`).join('')}
            </div>
          </div>

          <!-- 3. User-Defined Macros -->
          <div class="sheet-section">
            <div class="section-header-row">
              <div class="section-title">Custom Macros</div>
              <button class="macro-add-toggle-btn" type="button">+ New</button>
            </div>
            <div class="macro-add-form hidden">
              <input type="text" class="macro-input-name" placeholder="Macro Name (e.g. build)" maxlength="20" />
              <input type="text" class="macro-input-cmd" placeholder="Command (e.g. npm run build\\n)" />
              <div class="macro-form-actions">
                <button class="macro-save-btn" type="button">Save</button>
                <button class="macro-cancel-btn" type="button">Cancel</button>
              </div>
            </div>
            <div class="macros-list">
              ${this.macros.map((m, idx) => `
                <div class="macro-item">
                  <button class="macro-run-btn" data-macro-idx="${idx}" type="button">${this._escapeHtml(m.name)}</button>
                  <button class="macro-del-btn" data-macro-del-idx="${idx}" type="button" aria-label="Delete">×</button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- 4. Session Controls -->
          <div class="sheet-section">
            <div class="section-title">Session Controls</div>
            <div class="session-controls">
              <div class="shell-row">
                <label for="power-sheet-shell">Shell:</label>
                <select id="power-sheet-shell" class="sheet-shell-select">
                  <option value="bash" ${this.activeShell === 'bash' ? 'selected' : ''}>WSL (bash)</option>
                  <option value="zsh" ${this.activeShell === 'zsh' ? 'selected' : ''}>WSL (zsh)</option>
                  <option value="cmd" ${this.activeShell === 'cmd' ? 'selected' : ''}>Windows CMD</option>
                  <option value="powershell" ${this.activeShell === 'powershell' ? 'selected' : ''}>PowerShell</option>
                </select>
              </div>
              <div class="session-actions-grid">
                <button class="session-btn session-copy-btn" type="button">Copy Mode</button>
                <button class="session-btn session-reconnect-btn" type="button">Reconnect</button>
                <button class="session-btn session-logout-btn" type="button">Logout</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    _bindEvents() {
      if (!this.element) return;

      // Close button
      const closeBtn = this.element.querySelector('.sheet-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.close());
      }

      // Handle touch drag-down to dismiss
      const handleBar = this.element.querySelector('.sheet-handle-bar');
      if (handleBar) {
        handleBar.addEventListener('touchstart', (e) => {
          this.dragStartY = e.touches[0].clientY;
          this.isDragging = true;
        }, { passive: true });

        handleBar.addEventListener('touchmove', (e) => {
          if (!this.isDragging) return;
          const dy = e.touches[0].clientY - this.dragStartY;
          if (dy > 40) {
            this.isDragging = false;
            this.close();
          }
        }, { passive: true });

        handleBar.addEventListener('touchend', () => {
          this.isDragging = false;
        });
      }


      // (3) Spec Fix: D-pad uses shared cursor-key helper honoring applicationCursorKeysMode
      this.element.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
        const dir = btn.getAttribute('data-dir');
        btn.addEventListener('click', () => {
          const seq = CursorHelper ? CursorHelper.getCursorKeySequence(dir, this.term) : '';
          if (seq && typeof this.sendInput === 'function') {
            this.sendInput(seq);
          }
        });
      });

      // D-pad center (Ctrl+R history)
      const histBtn = this.element.querySelector('.dpad-btn[data-action="history"]');
      if (histBtn) {
        histBtn.addEventListener('click', () => {
          if (typeof this.sendInput === 'function') {
            this.sendInput('\x12'); // Ctrl+R
          }
        });
      }

      // D-pad clear (Ctrl+L clear screen)
      const clearBtn = this.element.querySelector('.dpad-btn[data-action="clear"]');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (typeof this.sendInput === 'function') {
            this.sendInput('\x0c'); // Ctrl+L
          }
        });
      }

      // Shell Symbol Strip
      this.element.querySelectorAll('.symbol-btn[data-sym]').forEach(btn => {
        const sym = btn.getAttribute('data-sym');
        btn.addEventListener('click', () => {
          if (typeof this.sendInput === 'function') {
            this.sendInput(sym);
          }
        });
      });

      // Macro Run buttons
      this.element.querySelectorAll('.macro-run-btn').forEach(btn => {
        const idx = parseInt(btn.getAttribute('data-macro-idx'), 10);
        btn.addEventListener('click', () => {
          const macro = this.macros[idx];
          if (macro && typeof this.sendInput === 'function') {
            this.sendInput(macro.cmd);
            this.close();
          }
        });
      });

      // Macro Delete buttons
      this.element.querySelectorAll('.macro-del-btn').forEach(btn => {
        const idx = parseInt(btn.getAttribute('data-macro-del-idx'), 10);
        btn.addEventListener('click', () => {
          this.macros.splice(idx, 1);
          this.saveMacros();
          this.updateContent();
          this._bindEvents();
        });
      });

      // Macro Add Form
      const addToggleBtn = this.element.querySelector('.macro-add-toggle-btn');
      const addForm = this.element.querySelector('.macro-add-form');
      const nameInput = this.element.querySelector('.macro-input-name');
      const cmdInput = this.element.querySelector('.macro-input-cmd');
      const saveBtn = this.element.querySelector('.macro-save-btn');
      const cancelBtn = this.element.querySelector('.macro-cancel-btn');

      if (addToggleBtn && addForm) {
        addToggleBtn.addEventListener('click', () => {
          addForm.classList.toggle('hidden');
          if (!addForm.classList.contains('hidden') && nameInput) {
            nameInput.focus();
          }
        });
      }

      if (cancelBtn && addForm) {
        cancelBtn.addEventListener('click', () => {
          addForm.classList.add('hidden');
          if (nameInput) nameInput.value = '';
          if (cmdInput) cmdInput.value = '';
        });
      }

      if (saveBtn && addForm && nameInput && cmdInput) {
        saveBtn.addEventListener('click', () => {
          const name = nameInput.value.trim();
          let cmd = cmdInput.value;
          if (!name || !cmd) return;
          // Unescape \n to real newline if user typed literal \n
          cmd = cmd.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
          this.macros.push({ name, cmd });
          this.saveMacros();
          this.updateContent();
          this._bindEvents();
        });
      }

      // Shell select change
      const shellSelect = this.element.querySelector('.sheet-shell-select');
      if (shellSelect) {
        shellSelect.addEventListener('change', () => {
          const newShell = shellSelect.value;
          if (typeof this.onSwitchShell === 'function') {
            this.onSwitchShell(newShell);
          }
        });
      }

      // Session Actions
      const copyBtn = this.element.querySelector('.session-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          this.close();
          if (typeof this.onTriggerCopyMode === 'function') {
            this.onTriggerCopyMode();
          }
        });
      }

      const reconnectBtn = this.element.querySelector('.session-reconnect-btn');
      if (reconnectBtn) {
        reconnectBtn.addEventListener('click', () => {
          this.close();
          if (typeof this.onReconnect === 'function') {
            this.onReconnect();
          }
        });
      }

      const logoutBtn = this.element.querySelector('.session-logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          this.close();
          if (typeof this.onLogout === 'function') {
            this.onLogout();
          }
        });
      }
    }
  }

  return {
    PowerSheet,
    DEFAULT_MACROS
  };
});
