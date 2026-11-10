let ctrlActive = false;
let activeShell = 'bash';
const shellSelect = document.getElementById('shell-select');

// Mobile gating: URL parameter, coarse pointer, or viewport <= 600px
const isMobile = (
  window.location.search.includes('mobile=1') ||
  Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  window.innerWidth <= 600
);

if (isMobile) {
  document.body.classList.add('is-mobile');
}

// URL parameters & authentication token handling
const urlParams = new URLSearchParams(window.location.search);
const tokenParam = urlParams.get('token');
let token = localStorage.getItem('conduit_token');

// If neither URL token nor stored token exists, immediately redirect to login
if (!tokenParam && !token) {
  window.location.href = '/';
  throw new Error('Redirecting: no auth token.');
}

// Declare ws at the module level
let ws;
let lastCols = null;
let lastRows = null;

// Reconnection state variables
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 30000];
let reconnectTimer = null;

// DOM element references for reconnection
const reconnectOverlay = document.getElementById('reconnect-overlay');
const reconnectStatus = document.getElementById('reconnect-status');
const reconnectBtn = document.getElementById('reconnect-btn');
const spinner = reconnectOverlay ? reconnectOverlay.querySelector('.spinner') : null;

// Initialize xterm.js terminal with 10,000 lines scrollback
const term = new Terminal({
  cursorBlink: true,
  scrollback: 10000,
  theme: {
    background: '#0d0d0d',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0'
  },
  fontSize: 14,
  fontFamily: 'Consolas, "Liberation Mono", Menlo, Courier, monospace'
});

const fitAddon = new FitAddon.FitAddon();
const webLinksAddon = new WebLinksAddon.WebLinksAddon();

term.loadAddon(fitAddon);
term.loadAddon(webLinksAddon);
term.open(document.getElementById('terminal-container'));

function sendWsInput(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data }));
  }
}

// Resize terminal and send to server
function resizeTerminal() {
  try {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    let targetHeight;

    if (isMobile) {
      // 44px mobile dock
      targetHeight = viewportHeight - 44;
    } else {
      const topBar = document.getElementById('top-bar');
      const toolbar = document.getElementById('toolbar');
      const topBarHeight = topBar ? topBar.offsetHeight : 40;
      const toolbarHeight = toolbar ? toolbar.offsetHeight : 52;
      targetHeight = viewportHeight - topBarHeight - toolbarHeight;
    }

    const container = document.getElementById('terminal-container');
    if (container) {
      container.style.height = `${targetHeight}px`;
    }

    // Determine scroll state prior to fitting
    const isAtBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    const previousScrollY = term.buffer.active.viewportY;

    fitAddon.fit();

    // Restore scroll position
    if (isAtBottom) {
      term.scrollToBottom();
    } else {
      term.scrollToLine(previousScrollY);
    }
    updateJumpToBottomVisibility();

    if (ws && ws.readyState === WebSocket.OPEN) {
      if (term.cols !== lastCols || term.rows !== lastRows) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
        lastCols = term.cols;
        lastRows = term.rows;
      }
    }
  } catch (err) {
    console.error("Error running resizeTerminal:", err);
  }
}

// Run initial resize before websocket setup
resizeTerminal();

// Initialize mobile subsystem components if mobile gating is active
let mobileDock = null;
let scrollBall = null;
let touchController = null;

function updateJumpToBottomVisibility() {
  // Safe no-op retained for terminal scroll listeners
}

if (isMobile) {
  const terminalContainerEl = document.getElementById('terminal-container');

  if (window.TouchController && window.TouchController.TouchController) {
    touchController = new window.TouchController.TouchController(term, sendWsInput, {
      container: terminalContainerEl,
      onCopyModeChange: () => {
        if (scrollBall) {
          scrollBall.syncArrowMode();
          if (scrollBall.mode === 'highlight' && term && typeof term.hasSelection === 'function' && term.hasSelection()) {
            scrollBall._initHighlightSelection();
          }
        }
      }
    });
  }

  if (window.ScrollBall && window.ScrollBall.ScrollBall) {
    scrollBall = new window.ScrollBall.ScrollBall({
      term: term,
      sendInput: sendWsInput,
      isHighlighted: () => {
        if (touchController && touchController.isCopyModeActive) return true;
        if (term && typeof term.hasSelection === 'function') return term.hasSelection();
        return false;
      },
      onScroll: (step) => {
        if (touchController && typeof touchController._routeScrollStep === 'function') {
          touchController._routeScrollStep(step);
        } else if (term && typeof term.scrollLines === 'function') {
          term.scrollLines(step);
        }
      }
    });
    scrollBall.mount(document.body);

    if (typeof term.onSelectionChange === 'function') {
      term.onSelectionChange(() => {
        if (scrollBall) {
          scrollBall.syncArrowMode();
          if (scrollBall.mode === 'highlight' && typeof term.hasSelection === 'function' && term.hasSelection()) {
            scrollBall._initHighlightSelection();
          }
        }
      });
    }
  }

  if (window.MobileDock && window.MobileDock.MobileDock) {
    mobileDock = new window.MobileDock.MobileDock({
      term: term,
      sendInput: sendWsInput,
      onEsc: () => {
        if (touchController && typeof touchController.hideCopyPill === 'function') {
          touchController.hideCopyPill();
        }
        if (scrollBall) {
          scrollBall.highlightSelection = null;
          scrollBall.syncArrowMode();
        }
      },
      onCopy: () => {
        if (term && term.hasSelection()) {
          const selectedText = term.getSelection();
          if (window.TouchController && window.TouchController.copyText) {
            window.TouchController.copyText(selectedText);
          }
          return true;
        }
        return false;
      },
      onPaste: () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          navigator.clipboard.readText().then(text => {
            if (text && ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'input', data: text }));
            }
          }).catch(err => {
            console.error('MobileDock paste error, falling back to prompt:', err);
            if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
              const pasted = window.prompt('Paste text to terminal:');
              if (pasted && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: pasted }));
              }
            }
          });
        } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
          const pasted = window.prompt('Paste text to terminal:');
          if (pasted && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: pasted }));
          }
        }
      }
    });
    mobileDock.mount(document.body);
  }
}

// Floating notification helper for session status notices
function showSessionNotice(text) {
  let notice = document.getElementById('session-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'session-notice';
    notice.className = 'session-notice';
    document.body.appendChild(notice);
  }
  notice.textContent = text;
  notice.classList.add('visible');
  clearTimeout(notice._timer);
  notice._timer = setTimeout(() => {
    notice.classList.remove('visible');
  }, 3000);
}

// Setup WebSocket connection with reconnection logic
function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/terminal?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected.");
    reconnectAttempts = 0;
    lastCols = null;
    lastRows = null;
    if (reconnectOverlay) {
      reconnectOverlay.classList.add('hidden');
    }
    if (mobileDock) {
      mobileDock.setConnectionStatus('connected');
    }
    resizeTerminal();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data, updateJumpToBottomVisibility);
      } else if (msg.type === 'replay') {
        // (3) Explicit scrollback replay message
        const wasAtBottom = (term.buffer.active.viewportY === term.buffer.active.baseY);
        const bottomOffset = Math.max(0, term.buffer.active.baseY - term.buffer.active.viewportY);

        // Clear corrupted escape state
        term.reset();

        term.write(msg.data, () => {
          if (wasAtBottom) {
            term.scrollToBottom();
          } else {
            const targetY = Math.max(0, term.buffer.active.baseY - bottomOffset);
            term.scrollToLine(targetY);
          }
          updateJumpToBottomVisibility();

          // Force a TUI redraw via PTY resize bounce
          if (ws && ws.readyState === WebSocket.OPEN) {
            const currentCols = term.cols;
            const currentRows = term.rows;
            ws.send(JSON.stringify({
              type: 'resize',
              cols: currentCols,
              rows: Math.max(1, currentRows - 1)
            }));
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols: currentCols,
                  rows: currentRows
                }));
              }
            }, 50);
          }
        });
      } else if (msg.type === 'session-new') {
        // (2) Show notice for new session
        term.write('\r\n\x1b[36m[New session started]\x1b[0m\r\n');
        showSessionNotice('New session started');
      } else if (msg.type === 'session-resumed') {
        // (2) Show notice for resumed session
        showSessionNotice('Session resumed');
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[33m[Shell exited — ${msg.shell || activeShell} returned code ${msg.code}]\x1b[0m\r\n`);
        term.write(`\x1b[32m[Use the dropdown at the top to spawn another shell or reconnect]\x1b[0m\r\n`);
        if (shellSelect) {
          shellSelect.value = "";
        }
        activeShell = "";
      } else if (msg.type === 'shell-active') {
        activeShell = msg.shell;
        if (shellSelect) {
          shellSelect.value = msg.shell;
        }
      }
    } catch (err) {
      console.error("Error parsing WebSocket message:", err);
    }
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      term.write('\r\n[Authentication failed or expired. Redirecting to login...]\r\n');
      localStorage.removeItem('conduit_token');
      if (mobileDock) {
        mobileDock.setConnectionStatus('disconnected');
      }
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } else if (event.code === 4002) {
      // Session cap rejection (HTTP 429 / code 4002): halt retry loop
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      term.write('\r\n[Server session capacity full: Session limit reached. Close another tab.]\r\n');
      if (reconnectStatus) {
        reconnectStatus.textContent = "Session limit reached. Close another tab.";
      }
      if (reconnectOverlay) {
        reconnectOverlay.classList.remove('hidden');
      }
      if (spinner) {
        spinner.classList.add('hidden');
      }
      if (reconnectBtn) {
        reconnectBtn.classList.remove('hidden');
      }
      if (mobileDock) {
        mobileDock.setConnectionStatus('disconnected');
      }
    } else if (event.reason === 'logout') {
      term.write('\r\n[Logged out]\r\n');
      localStorage.removeItem('conduit_token');
      if (mobileDock) {
        mobileDock.setConnectionStatus('disconnected');
      }
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } else {
      if (reconnectAttempts === 0) {
        term.write('\r\n[Connection lost]\r\n');
      }
      if (mobileDock) {
        mobileDock.setConnectionStatus('reconnecting');
      }
      handleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    if (reconnectAttempts === 0) {
      term.write('\r\n[WebSocket connection error]\r\n');
    }
  };
}

function handleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (reconnectStatus) {
      reconnectStatus.textContent = "Connection failed. Please retry manually.";
    }
    if (reconnectBtn) {
      reconnectBtn.classList.remove('hidden');
    }
    if (spinner) {
      spinner.classList.add('hidden');
    }
    if (mobileDock) {
      mobileDock.setConnectionStatus('disconnected');
    }
    return;
  }

  const delay = BACKOFF_DELAYS[reconnectAttempts];
  reconnectAttempts++;

  if (reconnectOverlay) {
    reconnectOverlay.classList.remove('hidden');
  }
  if (spinner) {
    spinner.classList.remove('hidden');
  }
  if (reconnectBtn) {
    reconnectBtn.classList.add('hidden');
  }

  const seconds = delay / 1000;
  if (reconnectStatus) {
    reconnectStatus.textContent = `Connection lost. Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${seconds} seconds...`;
  }

  reconnectTimer = setTimeout(connectWebSocket, delay);
}

// Register manual reconnect click event listener
if (reconnectBtn) {
  reconnectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    reconnectAttempts = 0;
    if (reconnectStatus) {
      reconnectStatus.textContent = "Reconnecting...";
    }
    if (reconnectBtn) {
      reconnectBtn.classList.add('hidden');
    }
    if (spinner) {
      spinner.classList.remove('hidden');
    }
    connectWebSocket();
  });
}

// Lifecycle listeners for mobile browsers
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log("App visibility restored. Reconnecting WebSocket...");
      reconnectAttempts = 0;
      connectWebSocket();
    }
  }
});

window.addEventListener('online', () => {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    console.log("Network online. Checking WebSocket connection...");
    reconnectAttempts = 0;
    connectWebSocket();
  }
});

// Initialize authentication (exchanging URL token if present) and connect
async function initializeTerminalAuth() {
  if (tokenParam && tokenParam.trim()) {
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: tokenParam.trim() })
      });
      const data = await response.json();
      if (response.ok && data.token) {
        token = data.token;
        localStorage.setItem('conduit_token', data.token);
        // Strip sensitive token from URL while preserving other query params (e.g. mobile=1)
        urlParams.delete('token');
        const remainingQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
        window.history.replaceState({}, document.title, window.location.pathname + remainingQuery);
        connectWebSocket();
        return;
      }
    } catch (err) {
      console.error('Direct token authentication error:', err);
    }
    // Failed token authentication: clear token and redirect to login screen
    localStorage.removeItem('conduit_token');
    window.location.href = '/';
    return;
  }

  if (!token) {
    window.location.href = '/';
    return;
  }

  connectWebSocket();
}

// Start the initial connection on startup
initializeTerminalAuth();

// Handle user typing:
// (4) Spec Fix: Sticky CTRL hooks onData, converts only single-char data, else clears and passes through.
term.onData((data) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (isMobile && mobileDock) {
    mobileDock.handleData(data, (converted) => {
      ws.send(JSON.stringify({ type: 'input', data: converted }));
    });
  } else {
    // Desktop keyboard handling
    if (ctrlActive) {
      const char = data.toUpperCase();
      if (char.length === 1 && char.charCodeAt(0) >= 65 && char.charCodeAt(0) <= 90) {
        const ctrlCode = String.fromCharCode(char.charCodeAt(0) - 64);
        ws.send(JSON.stringify({ type: 'input', data: ctrlCode }));
      } else {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
      toggleCtrl(false);
    } else {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }
});

// Setup Desktop Mobile Toolbar CTRL Toggle
const ctrlBtn = document.getElementById('ctrl-btn');
function toggleCtrl(state) {
  ctrlActive = state !== undefined ? state : !ctrlActive;
  if (ctrlBtn) {
    if (ctrlActive) {
      ctrlBtn.classList.add('active');
    } else {
      ctrlBtn.classList.remove('active');
    }
  }
}

if (ctrlBtn) {
  const handleCtrl = (e) => {
    e.preventDefault();
    toggleCtrl();
  };
  ctrlBtn.addEventListener('click', handleCtrl);
  ctrlBtn.addEventListener('touchstart', handleCtrl);
}

// Special sequences mapping for touch buttons on desktop toolbar
const seqMap = {
  'esc': '\x1b',
  'tab': '\t',
  'up': '\x1b[A',
  'down': '\x1b[B',
  'left': '\x1b[D',
  'right': '\x1b[C',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'enter': '\r'
};

document.querySelectorAll('.key-btn[data-seq]').forEach(btn => {
  const handleKey = (e) => {
    e.preventDefault();
    const seqName = btn.getAttribute('data-seq');
    const seq = seqMap[seqName];
    if (seq && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
  };
  btn.addEventListener('click', handleKey);
  btn.addEventListener('touchstart', handleKey);
});

// Debounce helper to prevent rapid resize reflows
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
const debouncedResize = debounce(resizeTerminal, 150);

// Watch visualViewport for mobile keyboard height shifts
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', debouncedResize);
} else {
  window.addEventListener('resize', debouncedResize);
}
// Initial fit
setTimeout(resizeTerminal, 100);

function doLogout() {
  if (confirm("Disconnect and log out of Conduit?")) {
    localStorage.removeItem('conduit_token');
    if (ws) {
      ws.close(1000, 'logout');
    }
    window.location.href = '/';
  }
}

// Handle Logout Action from desktop bar
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    doLogout();
  });
  logoutBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    doLogout();
  });
}

function handleSwitchShell(selectedShell) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Unable to switch shell: Connection is closed.");
    if (shellSelect) shellSelect.value = activeShell;
    return;
  }
  if (confirm(`Switch to ${selectedShell}? The current session will be terminated.`)) {
    ws.send(JSON.stringify({
      type: 'shell',
      shell: selectedShell,
      cols: term.cols,
      rows: term.rows
    }));
  } else {
    if (shellSelect) shellSelect.value = activeShell;
  }
}

// Handle Shell Switcher Selection from desktop bar
if (shellSelect) {
  shellSelect.value = activeShell;
  shellSelect.addEventListener('change', () => {
    handleSwitchShell(shellSelect.value);
  });
}

// --- Custom Context Menu & Copy/Paste Logic for Desktop ---
const contextMenu = document.getElementById('context-menu');
const ctxCopy = document.getElementById('ctx-copy');
const ctxPaste = document.getElementById('ctx-paste');
const terminalContainer = document.getElementById('terminal-container');

const hasClipboardSupport = typeof navigator.clipboard !== 'undefined';
const isSecureContext = window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function showContextMenu(x, y) {
  if (!contextMenu || isMobile) return;

  if (ctxCopy) {
    const hasSelection = term.hasSelection();
    ctxCopy.disabled = !hasSelection;
  }

  if (ctxPaste) {
    ctxPaste.disabled = !isSecureContext || !hasClipboardSupport;
  }

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }
}

if (terminalContainer) {
  terminalContainer.addEventListener('contextmenu', (e) => {
    if (isMobile) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    let x = e.clientX;
    let y = e.clientY;
    showContextMenu(x, y);
  });
}

document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

if (ctxCopy) {
  ctxCopy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (term.hasSelection()) {
      const selectedText = term.getSelection();
      if (window.TouchController && window.TouchController.copyText) {
        window.TouchController.copyText(selectedText).then(() => {
          const originalText = ctxCopy.textContent;
          ctxCopy.textContent = "Copied!";
          setTimeout(() => {
            ctxCopy.textContent = originalText;
            hideContextMenu();
          }, 800);
        }).catch(() => {
          alert("Clipboard copy failed.");
          hideContextMenu();
        });
      }
    }
  });
}

if (ctxPaste) {
  ctxPaste.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSecureContext || !hasClipboardSupport) {
      alert("Paste is disabled: navigator.clipboard requires a Secure Context.");
      hideContextMenu();
      return;
    }
    navigator.clipboard.readText()
      .then((text) => {
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: text }));
        }
        hideContextMenu();
      })
      .catch((err) => {
        console.error("Clipboard read failed: ", err);
        alert("Could not read clipboard.");
        hideContextMenu();
      });
  });
}
