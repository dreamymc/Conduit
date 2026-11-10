const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const config = require('./config');
const { revokedTokens } = require('./auth');

// Detect and cache WSL mount point at module level to avoid repeated disk checks
const WSL_MOUNT = fs.existsSync('/mnt/c') ? '/mnt/c' : (fs.existsSync('/c') ? '/c' : null);

const activeSessions = new Map();
const MAX_BUFFER_LENGTH = 512 * 1024; // 512KB scrollback buffer
const MAX_SESSIONS = 10; // Maximum concurrent sessions

const parseDim = (val, defaultValue) => {
  const parsed = parseInt(val, 10);
  return (isNaN(parsed) || parsed < 1) ? defaultValue : parsed;
};

/**
 * Resolves the absolute path for the requested shell executable.
 */
function resolveShellPath(shell) {
  switch (shell) {
    case 'bash':
      return '/bin/bash';
    case 'zsh':
      return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
    case 'cmd': {
      if (!WSL_MOUNT) return null;
      const candidates = [
        `${WSL_MOUNT}/Windows/System32/cmd.exe`,
        `${WSL_MOUNT}/windows/system32/cmd.exe`,
        `${WSL_MOUNT}/WINDOWS/SYSTEM32/cmd.exe`
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    case 'powershell': {
      if (!WSL_MOUNT) return null;
      const candidates = [
        `${WSL_MOUNT}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/windows/system32/windowspowershell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/WINDOWS/SYSTEM32/WINDOWSPOWERSHELL/V1.0/powershell.exe`,
        `${WSL_MOUNT}/Windows/System32/windowspowershell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe`
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    default:
      return '/bin/bash';
  }
}

/**
 * Checks if a process name corresponds to an idle shell executable.
 */
function isShellProcess(procName, shellName = '') {
  if (!procName) return false;
  const lower = procName.toLowerCase();
  const lowerShell = (shellName || '').toLowerCase();
  return lower.endsWith('bash') ||
         lower.endsWith('zsh') ||
         lower.endsWith('sh') ||
         lower.endsWith('cmd.exe') ||
         lower.endsWith('powershell.exe') ||
         (lowerShell && lower.endsWith(lowerShell));
}

/**
 * (7) Spec Fix: Detects whether a session has a running foreground process.
 * Returns the process name or descriptor if running, or null if idle shell.
 */
function getRunningForegroundProcess(session) {
  if (!session || !session.term) return null;

  // 1. Check term.process from node-pty
  const proc = session.term.process;
  if (proc && !isShellProcess(proc, session.shell)) {
    return proc;
  }

  // 2. Check child processes of the shell PID
  if (session.term.pid) {
    try {
      const out = execSync(`pgrep -P ${session.term.pid}`, {
        timeout: 200,
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString().trim();

      if (out.length > 0) {
        const childPids = out.split('\n').map(s => s.trim()).filter(Boolean);
        for (const pid of childPids) {
          try {
            const cmd = execSync(`ps -p ${pid} -o comm=`, {
              timeout: 200,
              stdio: ['ignore', 'pipe', 'ignore']
            }).toString().trim();
            if (cmd && !isShellProcess(cmd, session.shell)) {
              return cmd;
            }
          } catch (e) {
            // Process may have exited
          }
        }
      }
    } catch (e) {
      // pgrep exit code 1 indicates no children found
    }
  }

  return null;
}

/**
 * Cleans up and removes a session.
 */
function cleanupSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.disconnectTimeout) {
    clearTimeout(session.disconnectTimeout);
    session.disconnectTimeout = null;
  }

  if (session.activeDataListener) {
    session.activeDataListener.dispose();
    session.activeDataListener = null;
  }

  if (session.activeExitListener) {
    session.activeExitListener.dispose();
    session.activeExitListener = null;
  }

  if (session.term) {
    try {
      session.term.kill();
    } catch (e) {
      console.error(`Error killing PTY process for session ${sessionId}:`, e);
    }
    session.term = null;
  }

  if (session.ws) {
    if (session.ws.readyState === 1 || session.ws.readyState === 0) {
      try {
        session.ws.close(1000, 'Session cleaned up');
      } catch (e) {
        console.error(`Error closing WebSocket during session cleanup:`, e);
      }
    }
    session.ws = null;
  }
  activeSessions.delete(sessionId);
}

/**
 * Spawns a PTY process for the session.
 */
function spawnSession(sessionId, session, shellName) {
  try {
    const shellPath = resolveShellPath(shellName);
    const homeDir = process.env.HOME || os.homedir();

    let cwd = homeDir;
    if (shellName === 'cmd' || shellName === 'powershell') {
      if (WSL_MOUNT) {
        if (config.WINDOWS_USERPROFILE && config.WINDOWS_USERPROFILE.trim() !== '') {
          if (fs.existsSync(config.WINDOWS_USERPROFILE)) {
            cwd = config.WINDOWS_USERPROFILE;
          } else {
            console.warn(`Windows user profile path "${config.WINDOWS_USERPROFILE}" does not exist. Falling back to mount: ${WSL_MOUNT}`);
            cwd = WSL_MOUNT;
          }
        } else {
          cwd = WSL_MOUNT;
        }
      }
    }

    session.term = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        TERM_PROGRAM: 'conduit',
        LANG: process.env.LANG || 'en_US.UTF-8',
      }
    });

    session.shell = shellName;

    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: 'shell-active', shell: shellName }));
    }

    session.activeDataListener = session.term.onData((data) => {
      session.lastActiveTime = Date.now();

      // Append to the 512KB scrollback buffer
      session.buffer += data;
      if (session.buffer.length > MAX_BUFFER_LENGTH) {
        session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_LENGTH);
      }

      // Forward to websocket
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    session.activeExitListener = session.term.onExit(({ exitCode }) => {
      console.log(`PTY process exited for session ${sessionId} with code ${exitCode}`);
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.send(JSON.stringify({ type: 'exit', shell: shellName, code: exitCode }));
      }
      cleanupSession(sessionId);
    });

  } catch (err) {
    console.error(`Error spawning shell ${shellName} in session ${sessionId}:`, err);
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'output',
        data: `\r\n\x1b[31mError spawning shell ${shellName}: ${err.message}\x1b[0m\r\n`
      }));
    }
    if (shellName !== 'bash') {
      spawnSession(sessionId, session, 'bash');
      return;
    } else {
      cleanupSession(sessionId);
    }
  }
}

/**
 * Binds message and close event handlers of a WebSocket connection to a session.
 */
function bindSocketToSession(ws, sessionId, session) {
  // (4) ws ping/pong heartbeat: server ping every 25s, terminate on missed pong
  ws.isAlive = true;
  const pongHandler = () => {
    ws.isAlive = true;
  };
  if (typeof ws.on === 'function') {
    ws.on('pong', pongHandler);
  }

  const pingInterval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(pingInterval);
      return;
    }
    if (ws.isAlive === false) {
      console.log(`[Heartbeat] Terminating inactive WebSocket for session ${sessionId} due to missed pong.`);
      clearInterval(pingInterval);
      if (typeof ws.terminate === 'function') {
        return ws.terminate();
      } else if (typeof ws.close === 'function') {
        return ws.close();
      }
      return;
    }
    ws.isAlive = false;
    if (typeof ws.ping === 'function') {
      ws.ping();
    }
  }, 25000);
  if (typeof pingInterval.unref === 'function') {
    pingInterval.unref();
  }

  const errorHandler = (err) => {
    console.error(`WebSocket error for session ${sessionId}:`, err);
    clearInterval(pingInterval);
  };
  if (typeof ws.on === 'function') {
    ws.on('error', errorHandler);
  }

  const messageHandler = (message) => {
    try {
      session.lastActiveTime = Date.now();
      const msg = JSON.parse(message);
      if (msg.type === 'input') {
        if (session.term) {
          session.term.write(msg.data);
        }
      } else if (msg.type === 'resize') {
        session.cols = Math.min(1000, parseDim(msg.cols, 80));
        session.rows = Math.min(1000, parseDim(msg.rows, 24));
        if (session.term) {
          session.term.resize(session.cols, session.rows);
        }
      } else if (msg.type === 'shell') {
        const targetShell = msg.shell;
        const shellPath = resolveShellPath(targetShell);
        const isAvailable = shellPath && fs.existsSync(shellPath);

        if (!isAvailable) {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'output',
              data: `\r\n\x1b[31mError: Shell "${targetShell}" is not available.\x1b[0m\r\n`
            }));
            ws.send(JSON.stringify({ type: 'shell-active', shell: session.shell }));
          }
        } else {
          // Reset buffer on shell change
          session.buffer = '';

          // Clean up current PTY first
          if (session.activeDataListener) {
            session.activeDataListener.dispose();
            session.activeDataListener = null;
          }
          if (session.activeExitListener) {
            session.activeExitListener.dispose();
            session.activeExitListener = null;
          }
          if (session.term) {
            try {
              session.term.kill();
            } catch (e) {
              console.error(`Error killing PTY process for shell switch in session ${sessionId}:`, e);
            }
            session.term = null;
          }

          spawnSession(sessionId, session, targetShell);
        }
      }
    } catch (err) {
      console.error(`Error processing client message for session ${sessionId}:`, err);
    }
  };

  const closeHandler = (code, reason) => {
    clearInterval(pingInterval);
    ws.removeListener('pong', pongHandler);
    ws.removeListener('error', errorHandler);

    if (session.ws !== ws) {
      return;
    }

    const reasonStr = reason ? reason.toString() : '';

    if (reasonStr === 'logout') {
      if (session.jti) {
        revokedTokens.add(session.jti);
      }
      cleanupSession(sessionId);
    } else {
      session.ws = null;
      session.disconnectTimeout = setTimeout(() => {
        cleanupSession(sessionId);
      }, config.SESSION_IDLE_TIMEOUT_MS);
    }
  };

  ws.on('message', messageHandler);
  ws.on('close', closeHandler);
}

/**
 * Spawns or restores a PTY session and binds its stdin/stdout to the given WebSocket.
 */
function spawnTerminal(ws, sessionId, initialShell = 'bash', jti = null) {
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    session.jti = jti;
    session.lastActiveTime = Date.now();

    // Clear the disconnect timeout if running
    if (session.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = null;
    }

    // Bind the new WebSocket first to avoid race condition with the old WebSocket's close handler
    const oldWs = session.ws;
    session.ws = ws;

    // Close the previous WebSocket if it exists and is different from the new one
    if (oldWs && oldWs !== ws) {
      try {
        oldWs.close(1000, 'Replaced by new connection');
      } catch (e) {
        console.error(`Error closing old WebSocket for session ${sessionId}:`, e);
      }
    }

    // (2) Send session-resumed notification
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'session-resumed', sessionId }));
    }

    // (3) Send explicit replay message instead of regular output
    if (session.buffer && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'replay', data: session.buffer }));
    }

    // Send the active shell state notification
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'shell-active', shell: session.shell }));
    }

    // Bind WebSocket message handlers and close handler to this session
    bindSocketToSession(ws, sessionId, session);
  } else {
    // Check session capacity
    if (activeSessions.size >= MAX_SESSIONS) {
      // Find candidate disconnected sessions
      const disconnectedSessions = [];
      for (const [id, sess] of activeSessions.entries()) {
        if (!sess.ws || sess.disconnectTimeout !== null) {
          disconnectedSessions.push({ id, session: sess });
        }
      }

      if (disconnectedSessions.length === 0) {
        // All sessions are actively connected -> reject connection
        console.warn(`[Session Cap] Rejecting connection: maximum session capacity of ${MAX_SESSIONS} reached with all sessions active.`);
        if (ws.readyState === ws.OPEN || ws.readyState === 0) {
          try {
            ws.close(4002, 'Server session capacity full');
          } catch (e) {
            console.error('Error closing WebSocket when capacity full:', e);
          }
        }
        return;
      }

      // Sort disconnected sessions by lastActiveTime ascending (oldest first)
      disconnectedSessions.sort((a, b) => (a.session.lastActiveTime || 0) - (b.session.lastActiveTime || 0));

      // (7) Spec Fix: LRU eviction skips sessions with a running foreground process, or logs the kill
      let candidate = null;
      let killedFgProc = null;

      // First pass: find a disconnected session without running foreground processes
      for (const item of disconnectedSessions) {
        const fgProc = getRunningForegroundProcess(item.session);
        if (!fgProc) {
          candidate = item;
          break;
        }
      }

      // Second pass: if all have running foreground processes, evict the oldest disconnected one
      if (!candidate) {
        candidate = disconnectedSessions[0];
        killedFgProc = getRunningForegroundProcess(candidate.session);
      }

      if (killedFgProc) {
        console.warn(`[LRU Eviction] Evicting session "${candidate.id}" with running foreground process (${killedFgProc})`);
      } else {
        console.log(`[LRU Eviction] Evicting idle disconnected session "${candidate.id}"`);
      }

      cleanupSession(candidate.id);
    }

    // Create a new session object
    const session = {
      term: null,
      shell: initialShell,
      cols: 80,
      rows: 24,
      buffer: '',
      ws: ws,
      activeDataListener: null,
      activeExitListener: null,
      disconnectTimeout: null,
      jti: jti,
      lastActiveTime: Date.now()
    };
    activeSessions.set(sessionId, session);

    // Spawn the initial PTY process
    spawnSession(sessionId, session, initialShell);

    // (2) Send session-new notification
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'session-new', sessionId }));
    }

    // Bind WebSocket message handlers and close handler to this session
    bindSocketToSession(ws, sessionId, session);
  }
}

module.exports = {
  spawnTerminal,
  cleanupSession,
  activeSessions,
  getRunningForegroundProcess,
  MAX_SESSIONS,
  MAX_BUFFER_LENGTH
};
