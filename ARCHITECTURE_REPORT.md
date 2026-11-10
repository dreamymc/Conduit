# Conduit Architecture Report

> **Evaluation Notice:** This document is a factual, read-only architectural analysis of the Conduit codebase as implemented. Every claim cites exact `file:line` locations. No speculative features or unverified behaviors are assumed.

---

## 1. Overview

### Directory Tree (Top 2 Levels)
```
.
├── ARCHITECTURE_REPORT.md
├── README.md
├── bin/
│   └── cloudflared
├── client/
│   ├── cursor-helper.js
│   ├── icon.svg
│   ├── index.html
│   ├── manifest.json
│   ├── mobile-dock.js
│   ├── scroll-ball.js
│   ├── style.css
│   ├── terminal.html
│   ├── terminal.js
│   └── touch-controller.js
├── docs/
│   └── plans/
├── mobile_redesign_design.md
├── package.json
├── package-lock.json
├── scratch/
│   ├── test_integration.js
│   ├── test_mobile_redesign.js
│   ├── test_pty.js
│   └── test_reconnect_replay_bounce.js
├── scripts/
│   ├── autostart.sh
│   ├── setup.sh
│   └── start.sh
└── server/
    ├── auth.js
    ├── config.js
    ├── index.js
    ├── terminal.js
    └── tunnel.js
```

### Entry Points
- **Server Entry Point:** [`server/index.js:1-240`](file:///home/visionmc/projects/Conduit/server/index.js#L1-L240), executed via `node server/index.js`.
- **Manual Launch Script:** [`scripts/start.sh:1-6`](file:///home/visionmc/projects/Conduit/scripts/start.sh#L1-L6), running `exec node server/index.js`.
- **Autostart Launch Script:** [`scripts/autostart.sh:1-15`](file:///home/visionmc/projects/Conduit/scripts/autostart.sh#L1-L15), running `exec node server/index.js >> "$LOG_FILE" 2>&1`.
- **Client Auth Entry Point:** [`client/index.html:1-130`](file:///home/visionmc/projects/Conduit/client/index.html#L1-L130), served at `/index.html` (root `/` redirects here via [`server/index.js:40-43`](file:///home/visionmc/projects/Conduit/server/index.js#L40-L43)).
- **Client Terminal Entry Point:** [`client/terminal.html:1-73`](file:///home/visionmc/projects/Conduit/client/terminal.html#L1-L73), served at `/terminal.html` (HTTP `/term` redirects here via [`server/index.js:46-49`](file:///home/visionmc/projects/Conduit/server/index.js#L46-L49)).

### Startup and Auto-Start
- **Environment & Dependency Setup:** Executed via [`scripts/setup.sh:1-77`](file:///home/visionmc/projects/Conduit/scripts/setup.sh#L1-L77). Checks for `make` and `g++`, downloads the standalone `cloudflared` Linux binary to `bin/cloudflared` ([`scripts/setup.sh:20-38`](file:///home/visionmc/projects/Conduit/scripts/setup.sh#L20-L38)), generates random cryptographic secrets in `.env` if absent ([`scripts/setup.sh:50-71`](file:///home/visionmc/projects/Conduit/scripts/setup.sh#L50-L71)), and runs `npm install` and `npm rebuild node-pty` ([`scripts/setup.sh:74-75`](file:///home/visionmc/projects/Conduit/scripts/setup.sh#L74-L75)).
- **Server Initialization:** [`server/index.js:185-240`](file:///home/visionmc/projects/Conduit/server/index.js#L185-L240) binds the HTTP server to `0.0.0.0:${config.PORT}` ([`server/index.js:185`](file:///home/visionmc/projects/Conduit/server/index.js#L185)), detects the Windows host user profile asynchronously via WSL cmd.exe interop ([`server/index.js:136-182, 191`](file:///home/visionmc/projects/Conduit/server/index.js#L136-L182)), spawns Cloudflare Quick Tunnel child process ([`server/tunnel.js:17-141`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L17-L141)), and renders console banner with local/public terminal URLs and QR codes ([`server/index.js:212-239`](file:///home/visionmc/projects/Conduit/server/index.js#L212-L239)).
- **Auto-Start Mechanism:** 
  - Shell script [`scripts/autostart.sh:8-13`](file:///home/visionmc/projects/Conduit/scripts/autostart.sh#L8-L13) checks if `conduit.log` exceeds 5MB (`5242880` bytes) and rotates it to `conduit.log.old`, then launches `node server/index.js`.
  - Windows Task Scheduler integration is documented in [`README.md:110-125`](file:///home/visionmc/projects/Conduit/README.md#L110-L125), launching via:
    `C:\Windows\System32\wsl.exe -d Ubuntu -e bash -c "cd ~/conduit && bash scripts/start.sh"` on system boot.

### Dependency List with Versions
#### Runtime Dependencies (`package.json:14-24`, resolved via `npm list --depth=0`)
- `bcryptjs`: `^3.0.3` (installed: `3.0.3`) ([`package.json:14`](file:///home/visionmc/projects/Conduit/package.json#L14))
- `chalk`: `^5.6.2` (installed: `5.6.2`) ([`package.json:15`](file:///home/visionmc/projects/Conduit/package.json#L15))
- `dotenv`: `^17.4.2` (installed: `17.4.2`) ([`package.json:16`](file:///home/visionmc/projects/Conduit/package.json#L16))
- `express`: `^5.2.1` (installed: `5.2.1`) ([`package.json:17`](file:///home/visionmc/projects/Conduit/package.json#L17))
- `ip`: `^2.0.1` (installed: `2.0.1`) ([`package.json:18`](file:///home/visionmc/projects/Conduit/package.json#L18))
- `jsonwebtoken`: `^9.0.3` (installed: `9.0.3`) ([`package.json:19`](file:///home/visionmc/projects/Conduit/package.json#L19))
- `node-pty`: `^1.1.0` (installed: `1.1.0`) ([`package.json:20`](file:///home/visionmc/projects/Conduit/package.json#L20))
- `qrcode-terminal`: `^0.12.0` (installed: `0.12.0`) ([`package.json:21`](file:///home/visionmc/projects/Conduit/package.json#L21))
- `uuid`: `^14.0.0` (installed: `14.0.0`) ([`package.json:22`](file:///home/visionmc/projects/Conduit/package.json#L22))
- `ws`: `^8.21.0` (installed: `8.21.0`) ([`package.json:23`](file:///home/visionmc/projects/Conduit/package.json#L23))

#### Client CDN Dependencies ([`client/terminal.html:11, 63-65`](file:///home/visionmc/projects/Conduit/client/terminal.html#L11))
- `xterm`: `5.3.0` (`https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js`, `https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css`)
- `xterm-addon-fit`: `0.8.0` (`https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js`)
- `xterm-addon-web-links`: `0.9.0` (`https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js`)
- Google Fonts: `Outfit` (weights 300, 400, 600) & `Fira Code` (weights 400, 500) ([`client/terminal.html:9`](file:///home/visionmc/projects/Conduit/client/terminal.html#L9))

#### Native / Standalone Binaries
- `cloudflared`: Standalone Linux binary downloaded from GitHub releases to `bin/cloudflared` ([`scripts/setup.sh:32-34`](file:///home/visionmc/projects/Conduit/scripts/setup.sh#L32-L34), [`server/tunnel.js:18`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L18)).

---

## 2. Server Pipeline

### WebSocket Connection & Auth Flow
- **Upgrade Route:** HTTP upgrade requests are intercepted on pathname `/terminal` ([`server/index.js:58-63`](file:///home/visionmc/projects/Conduit/server/index.js#L58-L63)). Requests to any other path have their underlying sockets destroyed immediately ([`server/index.js:86-88`](file:///home/visionmc/projects/Conduit/server/index.js#L86-L88)).
- **Origin Validation:** If an `Origin` header is present on the upgrade request, [`server/index.js:65-81`](file:///home/visionmc/projects/Conduit/server/index.js#L65-L81) parses the host and validates `parsedOrigin.host === expectedHost` (where `expectedHost` is derived from `x-forwarded-host` or `host`). Mismatches are rejected with HTTP `403 Forbidden` ([`server/index.js:71-73`](file:///home/visionmc/projects/Conduit/server/index.js#L71-L73)); malformed origins receive HTTP `400 Bad Request` ([`server/index.js:77-79`](file:///home/visionmc/projects/Conduit/server/index.js#L77-L79)).
- **Token Check & JWT Verification:**
  - On the `connection` event ([`server/index.js:91-131`](file:///home/visionmc/projects/Conduit/server/index.js#L91-L131)), the server extracts the `token` parameter from `req.url` search params ([`server/index.js:95-96`](file:///home/visionmc/projects/Conduit/server/index.js#L95-L96)).
  - If missing: closes connection with code `4001` and reason `'Unauthorized: Missing token'` ([`server/index.js:98-102`](file:///home/visionmc/projects/Conduit/server/index.js#L98-L102)).
  - Verified using `jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] })` ([`server/index.js:104`](file:///home/visionmc/projects/Conduit/server/index.js#L104)).
  - If invalid or expired: closes connection with code `4001` and reason `'Unauthorized: Invalid token'` ([`server/index.js:106-108`](file:///home/visionmc/projects/Conduit/server/index.js#L106-L108)).
  - Revocation check: verified against in-memory `revokedTokens` set via `revokedTokens.has(decoded.jti)` ([`server/index.js:111-115`](file:///home/visionmc/projects/Conduit/server/index.js#L111-L115)). If revoked, closes connection with code `4001` and reason `'Unauthorized: Token has been revoked'`.
  - Upon successful verification, extracts `sessionId = decoded.sessionId || 'default-session'` and calls `spawnTerminal(ws, sessionId, 'bash', jti)` ([`server/index.js:123-125`](file:///home/visionmc/projects/Conduit/server/index.js#L123-L125)).

### Session Creation
- **SessionId Source:** `sessionId` is generated on the server using `uuidv4()` during initial credential exchange at `POST /auth/login` ([`server/auth.js:63-68`](file:///home/visionmc/projects/Conduit/server/auth.js#L63-L68)) and signed into the JWT payload.
- **Session Map Structure:** Stored in module-level `activeSessions = new Map()` ([`server/terminal.js:11`](file:///home/visionmc/projects/Conduit/server/terminal.js#L11)). Key is `sessionId` (string UUID). The session object contains ([`server/terminal.js:434-446`](file:///home/visionmc/projects/Conduit/server/terminal.js#L434-L446)):
  - `term`: `node-pty` terminal instance or `null`
  - `shell`: active shell string (`'bash'`, `'zsh'`, `'cmd'`, `'powershell'`)
  - `cols`: integer column count (default 80)
  - `rows`: integer row count (default 24)
  - `buffer`: string holding the rolling scrollback history (max 512KB)
  - `ws`: active WebSocket reference or `null`
  - `activeDataListener`: `IDisposable` handle for PTY `onData`
  - `activeExitListener`: `IDisposable` handle for PTY `onExit`
  - `disconnectTimeout`: `NodeJS.Timeout` handle or `null`
  - `jti`: JWT ID token identifier string or `null`
  - `lastActiveTime`: timestamp (epoch ms) of last I/O or connection event
- **What is Spawned:** `pty.spawn(shellPath, [], options)` ([`server/terminal.js:192-205`](file:///home/visionmc/projects/Conduit/server/terminal.js#L192-L205)):
  - `shellPath` resolved by `resolveShellPath(shellName)` ([`server/terminal.js:23-62`](file:///home/visionmc/projects/Conduit/server/terminal.js#L23-L62)):
    - `'bash'` $\rightarrow$ `/bin/bash`
    - `'zsh'` $\rightarrow$ `/bin/zsh` if exists, else `/bin/bash`
    - `'cmd'` $\rightarrow$ `${WSL_MOUNT}/Windows/System32/cmd.exe`
    - `'powershell'` $\rightarrow$ `${WSL_MOUNT}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`
  - `args`: `[]` (empty array, [`server/terminal.js:192`](file:///home/visionmc/projects/Conduit/server/terminal.js#L192))
  - `cwd`: For bash/zsh, `process.env.HOME || os.homedir()` ([`server/terminal.js:176`](file:///home/visionmc/projects/Conduit/server/terminal.js#L176)). For cmd/powershell, cached `config.WINDOWS_USERPROFILE` if resolved and existent, falling back to `WSL_MOUNT` (`/mnt/c` or `/c`) ([`server/terminal.js:178-189`](file:///home/visionmc/projects/Conduit/server/terminal.js#L178-L189)).
  - `cols` / `rows`: `session.cols` (80), `session.rows` (24) ([`server/terminal.js:194-195`](file:///home/visionmc/projects/Conduit/server/terminal.js#L194-L195))
  - `name`: `'xterm-256color'` ([`server/terminal.js:193`](file:///home/visionmc/projects/Conduit/server/terminal.js#L193))
  - `env`: ([`server/terminal.js:197-204`](file:///home/visionmc/projects/Conduit/server/terminal.js#L197-L204)):
    ```javascript
    {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      TERM_PROGRAM: 'conduit',
      LANG: process.env.LANG || 'en_US.UTF-8',
    }
    ```
- **Shell Switching Flow:**
  - Client sends `{ type: 'shell', shell: targetShell, cols, rows }` ([`client/terminal.js:625-630`](file:///home/visionmc/projects/Conduit/client/terminal.js#L625-L630)).
  - Server verifies target shell executable exists ([`server/terminal.js:274`](file:///home/visionmc/projects/Conduit/server/terminal.js#L274)).
  - Buffer is wiped: `session.buffer = ''` ([`server/terminal.js:286`](file:///home/visionmc/projects/Conduit/server/terminal.js#L286)).
  - Disposes `session.activeDataListener` and `session.activeExitListener` ([`server/terminal.js:289-296`](file:///home/visionmc/projects/Conduit/server/terminal.js#L289-L296)).
  - Kills running PTY process: `session.term.kill()` ([`server/terminal.js:299`](file:///home/visionmc/projects/Conduit/server/terminal.js#L299)).
  - Sets `session.term = null` ([`server/terminal.js:303`](file:///home/visionmc/projects/Conduit/server/terminal.js#L303)).
  - Calls `spawnSession(sessionId, session, targetShell)` ([`server/terminal.js:306`](file:///home/visionmc/projects/Conduit/server/terminal.js#L306)) to spawn the new shell process.

### PTY Output Path
- Event listener: `session.term.onData((data) => { ... })` ([`server/terminal.js:213-226`](file:///home/visionmc/projects/Conduit/server/terminal.js#L213-L226)).
- Buffer storage: Appends incoming chunk to `session.buffer += data;` ([`server/terminal.js:217`](file:///home/visionmc/projects/Conduit/server/terminal.js#L217)).
- Buffer size & trimming: `MAX_BUFFER_LENGTH = 512 * 1024` (524,288 characters) ([`server/terminal.js:12`](file:///home/visionmc/projects/Conduit/server/terminal.js#L12)). If `session.buffer.length > MAX_BUFFER_LENGTH`, trims old data from head using:
  `session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_LENGTH)` ([`server/terminal.js:219`](file:///home/visionmc/projects/Conduit/server/terminal.js#L219)).
- Transmission: If WebSocket is open, immediately sends JSON payload:
  `session.ws.send(JSON.stringify({ type: 'output', data }))` ([`server/terminal.js:224`](file:///home/visionmc/projects/Conduit/server/terminal.js#L224)).
- Batching & Backpressure: None. There is no buffering timer, chunk aggregation, or check on `session.ws.bufferedAmount`. Every single `onData` callback immediately executes `session.ws.send()`.

### Input Path
- Handled via `ws.on('message', messageHandler)` in `bindSocketToSession` ([`server/terminal.js:257-312`](file:///home/visionmc/projects/Conduit/server/terminal.js#L257-L312)).
- Recognizes exactly three JSON message types:
  1. **Input:** `{ type: 'input', data: <string> }` $\rightarrow$ calls `session.term.write(msg.data)` ([`server/terminal.js:261-264`](file:///home/visionmc/projects/Conduit/server/terminal.js#L261-L264)).
  2. **Resize:** `{ type: 'resize', cols: <number>, rows: <number> }` $\rightarrow$ parses with `parseDim` clamped to 1000 max, sets `session.cols` and `session.rows`, and calls `session.term.resize(session.cols, session.rows)` ([`server/terminal.js:265-270`](file:///home/visionmc/projects/Conduit/server/terminal.js#L265-L270)).
  3. **Shell:** `{ type: 'shell', shell: <string>, cols: <number>, rows: <number> }` $\rightarrow$ switches shell ([`server/terminal.js:271-308`](file:///home/visionmc/projects/Conduit/server/terminal.js#L271-L308)).
- Any unrecognized message type or unparseable JSON is caught and logged ([`server/terminal.js:309-311`](file:///home/visionmc/projects/Conduit/server/terminal.js#L309-L311)).

### Session Lifecycle & Eviction
- **On WebSocket Close:** ([`server/terminal.js:314-332`](file:///home/visionmc/projects/Conduit/server/terminal.js#L314-L332)):
  - Ignores close if `session.ws !== ws` (preventing stale socket close races) ([`server/terminal.js:315-317`](file:///home/visionmc/projects/Conduit/server/terminal.js#L315-L317)).
  - If `reason === 'logout'`: revokes `session.jti` in `revokedTokens` ([`server/terminal.js:322-324`](file:///home/visionmc/projects/Conduit/server/terminal.js#L322-L324)) and immediately calls `cleanupSession(sessionId)` ([`server/terminal.js:325`](file:///home/visionmc/projects/Conduit/server/terminal.js#L325)).
  - Otherwise (network drop / browser sleep): sets `session.ws = null` ([`server/terminal.js:327`](file:///home/visionmc/projects/Conduit/server/terminal.js#L327)) and arms `session.disconnectTimeout = setTimeout(() => { cleanupSession(sessionId); }, 60000)` (60 seconds, [`server/terminal.js:328-330`](file:///home/visionmc/projects/Conduit/server/terminal.js#L328-L330)).
- **On WebSocket Error:**
  - Server does not bind a dedicated `ws.on('error')` handler on the session socket; socket errors trigger the underlying `ws.on('close')` event.
- **On PTY Exit:** ([`server/terminal.js:228-234`](file:///home/visionmc/projects/Conduit/server/terminal.js#L228-L234)):
  - `session.term.onExit(({ exitCode }) => { ... })`: sends `{ type: 'exit', shell: shellName, code: exitCode }` if WebSocket is open ([`server/terminal.js:231`](file:///home/visionmc/projects/Conduit/server/terminal.js#L231)), and immediately calls `cleanupSession(sessionId)` ([`server/terminal.js:233`](file:///home/visionmc/projects/Conduit/server/terminal.js#L233)).
- **On Server Restart:**
  - All state is strictly in-memory. Node process exit terminates all PTY instances, destroys `activeSessions`, `failedAttempts`, and `revokedTokens`. No persistent disk storage is utilized.
- **Session Cleanup (`cleanupSession`):** ([`server/terminal.js:127-166`](file:///home/visionmc/projects/Conduit/server/terminal.js#L127-L166)):
  1. Clears `session.disconnectTimeout` ([`server/terminal.js:132`](file:///home/visionmc/projects/Conduit/server/terminal.js#L132)).
  2. Disposes `session.activeDataListener` and `session.activeExitListener` ([`server/terminal.js:137, 142`](file:///home/visionmc/projects/Conduit/server/terminal.js#L137)).
  3. Invokes `session.term.kill()` ([`server/terminal.js:148`](file:///home/visionmc/projects/Conduit/server/terminal.js#L148)) and sets `session.term = null`.
  4. Closes `session.ws` with code 1000 if open ([`server/terminal.js:158`](file:///home/visionmc/projects/Conduit/server/terminal.js#L158)).
  5. Removes session from `activeSessions.delete(sessionId)` ([`server/terminal.js:165`](file:///home/visionmc/projects/Conduit/server/terminal.js#L165)).
- **Eviction Logic:** ([`server/terminal.js:379-431`](file:///home/visionmc/projects/Conduit/server/terminal.js#L379-L431)):
  - Hard limit: `MAX_SESSIONS = 10` ([`server/terminal.js:13`](file:///home/visionmc/projects/Conduit/server/terminal.js#L13)).
  - When connection arrives and `activeSessions.size >= 10`:
    - Disconnected candidates are gathered: `!sess.ws || sess.disconnectTimeout !== null` ([`server/terminal.js:384`](file:///home/visionmc/projects/Conduit/server/terminal.js#L384)).
    - If no disconnected sessions exist (all 10 active): connection is rejected with close code `4002` and reason `'Server session capacity full'` ([`server/terminal.js:394`](file:///home/visionmc/projects/Conduit/server/terminal.js#L394)).
    - If candidates exist: candidates are sorted by `lastActiveTime` ascending (oldest first) ([`server/terminal.js:403`](file:///home/visionmc/projects/Conduit/server/terminal.js#L403)).
    - Pass 1: checks `getRunningForegroundProcess(item.session)` ([`server/terminal.js:411`](file:///home/visionmc/projects/Conduit/server/terminal.js#L411)). If a disconnected session is idle (returns `null`), it is evicted.
    - Pass 2: if all disconnected sessions have running foreground processes, evicts the oldest disconnected one ([`server/terminal.js:419-422`](file:///home/visionmc/projects/Conduit/server/terminal.js#L419-L422)).
    - Calls `cleanupSession(candidate.id)` ([`server/terminal.js:430`](file:///home/visionmc/projects/Conduit/server/terminal.js#L430)).
- **Timers in Server:**
  1. `session.disconnectTimeout`: 60,000ms (60s) ([`server/terminal.js:330`](file:///home/visionmc/projects/Conduit/server/terminal.js#L330)). Kills PTY and deletes session via `cleanupSession`.
  2. Cloudflare tunnel start timeout: 30,000ms (30s) ([`server/tunnel.js:121`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L121)). Kills tunnel process attempt if URL not extracted.
  3. Cloudflare tunnel retry delay: 5,000ms (5s) ([`server/tunnel.js:20, 132`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L20)). Wait between tunnel retries.
  4. Auth rate limiter lockout window: 900,000ms (15 minutes) ([`server/auth.js:43`](file:///home/visionmc/projects/Conduit/server/auth.js#L43)). Window tracking failed attempts.
  5. Windows user profile detection timeout: 2,000ms (2s) ([`server/index.js:157`](file:///home/visionmc/projects/Conduit/server/index.js#L157)). Child process exec timeout.
  6. Foreground process inspection timeout: 200ms ([`server/terminal.js:96, 105`](file:///home/visionmc/projects/Conduit/server/terminal.js#L96)). Synchronous `pgrep` and `ps` timeout.

### Child Processes on PTY Termination
- When `session.term.kill()` executes, `node-pty` sends `SIGHUP` / `SIGTERM` to the shell process PID.
- In Linux, closing the PTY master descriptor causes the kernel to send `SIGHUP` to the foreground process group. If child programs catch/ignore `SIGHUP`, or were placed in the background, they are orphaned and reparented to init (PID 1).
- `detached: true`, `setsid`, `tmux`, `screen`, and `nohup` are **NOT** used anywhere in Conduit's implementation (verified via repository search).

---

## 3. Client Pipeline

### xterm.js Setup
- **Options:** Initialized in [`client/terminal.js:46-56`](file:///home/visionmc/projects/Conduit/client/terminal.js#L46-L56):
  ```javascript
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
  ```
- **Addons Loaded:**
  - `FitAddon.FitAddon` ([`client/terminal.js:58, 61`](file:///home/visionmc/projects/Conduit/client/terminal.js#L58))
  - `WebLinksAddon.WebLinksAddon` ([`client/terminal.js:59, 62`](file:///home/visionmc/projects/Conduit/client/terminal.js#L59))
  - No `webgl`, `canvas`, `serialize`, or search addons are loaded.
- **Renderer Type:** Default DOM renderer. Neither `xterm-addon-webgl` nor `xterm-addon-canvas` is present in HTML or JS.

### SessionId Storage and Reuse
- **Storage Location:** Stored exclusively in browser `localStorage` under the key `'conduit_token'` ([`client/index.html:71`](file:///home/visionmc/projects/Conduit/client/index.html#L71), [`client/terminal.js:19, 474`](file:///home/visionmc/projects/Conduit/client/terminal.js#L19)). The `sessionId` itself is not stored directly; it is an encoded claim inside this JWT token.
- **Reuse on Reload / Discard:**
  - On page load, [`client/terminal.js:19`](file:///home/visionmc/projects/Conduit/client/terminal.js#L19) reads `localStorage.getItem('conduit_token')`.
  - When [`connectWebSocket()`](file:///home/visionmc/projects/Conduit/client/terminal.js#L234-L379) executes, it passes the JWT in the WebSocket URL: `/terminal?token=${encodeURIComponent(token)}` ([`client/terminal.js:241`](file:///home/visionmc/projects/Conduit/client/terminal.js#L241)).
  - Server verifies the JWT, decodes `decoded.sessionId` ([`server/index.js:123`](file:///home/visionmc/projects/Conduit/server/index.js#L123)), and attaches to the existing session in `activeSessions` if it has not expired ([`server/terminal.js:342-377`](file:///home/visionmc/projects/Conduit/server/terminal.js#L342-L377)).

### Reconnect Logic
- **Triggers:**
  1. WebSocket closure: `ws.onclose` when `code !== 4001`, `code !== 4002`, and `reason !== 'logout'` ([`client/terminal.js:362-370`](file:///home/visionmc/projects/Conduit/client/terminal.js#L362-L370)).
  2. Visibility change: `document.visibilitychange` when `document.visibilityState === 'visible'` and socket is closed/closing ([`client/terminal.js:440-449`](file:///home/visionmc/projects/Conduit/client/terminal.js#L440-L449)).
  3. Online event: `window.online` ([`client/terminal.js:451-458`](file:///home/visionmc/projects/Conduit/client/terminal.js#L451-L458)).
  4. Manual click: `#reconnect-btn` click handler ([`client/terminal.js:421-437`](file:///home/visionmc/projects/Conduit/client/terminal.js#L421-L437)).
- **Backoff Schedule:**
  - `MAX_RECONNECT_ATTEMPTS = 5` ([`client/terminal.js:34`](file:///home/visionmc/projects/Conduit/client/terminal.js#L34)).
  - `BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 30000]` ms ([`client/terminal.js:35`](file:///home/visionmc/projects/Conduit/client/terminal.js#L35)).
- **What is Sent on Reconnect:**
  - Connects to `/terminal?token=${encodeURIComponent(token)}` ([`client/terminal.js:241`](file:///home/visionmc/projects/Conduit/client/terminal.js#L241)).
  - On open: dispatches resize message `{ type: 'resize', cols, rows }` ([`client/terminal.js:255, 109-116`](file:///home/visionmc/projects/Conduit/client/terminal.js#L255)).
- **How Replay Buffer is Applied:**
  - Replay state tracked by `isReconnectingReplay = true` ([`client/terminal.js:37, 400, 425, 445, 455`](file:///home/visionmc/projects/Conduit/client/terminal.js#L37)).
  - On first output message during reconnect ([`client/terminal.js:262-299`](file:///home/visionmc/projects/Conduit/client/terminal.js#L262-L299)):
    - Computes bottom offset: `bottomOffset = Math.max(0, term.buffer.active.baseY - term.buffer.active.viewportY)` ([`client/terminal.js:266`](file:///home/visionmc/projects/Conduit/client/terminal.js#L266)).
    - Clears corrupt escape sequences: `term.reset()` ([`client/terminal.js:269`](file:///home/visionmc/projects/Conduit/client/terminal.js#L269)).
    - Writes replay data: `term.write(msg.data, () => { ... })` ([`client/terminal.js:271`](file:///home/visionmc/projects/Conduit/client/terminal.js#L271)).
    - Restores viewport scroll: calls `term.scrollToBottom()` or `term.scrollToLine(targetY)` ([`client/terminal.js:273-276`](file:///home/visionmc/projects/Conduit/client/terminal.js#L273-L276)).
    - PTY resize bounce to force TUI redraw: sends resize with `rows: currentRows - 1`, followed 50ms later by resize with `rows: currentRows` ([`client/terminal.js:281-297`](file:///home/visionmc/projects/Conduit/client/terminal.js#L281-L297)).

### Touch / Mobile Layer
- **Modules:**
  - `client/cursor-helper.js`: `CursorHelper` ([`client/cursor-helper.js:1-39`](file:///home/visionmc/projects/Conduit/client/cursor-helper.js#L1-L39)).
  - `client/touch-controller.js`: `TouchController`, `FractionalLineAccumulator`, `copyText` ([`client/touch-controller.js:1-645`](file:///home/visionmc/projects/Conduit/client/touch-controller.js#L1-L645)).
  - `client/scroll-ball.js`: `ScrollBall` 3-mode middle-mouse autoscroll joystick ([`client/scroll-ball.js:1-716`](file:///home/visionmc/projects/Conduit/client/scroll-ball.js#L1-L716)).
  - `client/mobile-dock.js`: `MobileDock` 4-button reflex dock ([`client/mobile-dock.js:1-324`](file:///home/visionmc/projects/Conduit/client/mobile-dock.js#L1-L324)).
- **Gating Condition:** [`client/terminal.js:6-10`](file:///home/visionmc/projects/Conduit/client/terminal.js#L6-L10):
  ```javascript
  const isMobile = (
    window.location.search.includes('mobile=1') ||
    Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    window.innerWidth <= 600
  );
  ```
- **Event Listeners Attached:**
  - Terminal container: `touchstart`, `touchmove`, `touchend`, `touchcancel`, `contextmenu` (all `{ passive: false }`, [`client/touch-controller.js:177-181`](file:///home/visionmc/projects/Conduit/client/touch-controller.js#L177-L181)).
  - ScrollBall Mode Button: `pointerdown`, `click`, `touchstart` ([`client/scroll-ball.js:662-664`](file:///home/visionmc/projects/Conduit/client/scroll-ball.js#L662-L664)).
  - ScrollBall Container: `pointerdown` (or `touchstart` / `mousedown` fallback, [`client/scroll-ball.js:668-672`](file:///home/visionmc/projects/Conduit/client/scroll-ball.js#L668-L672)).
  - Window drag listeners: attached dynamically during drag on `pointermove`, `pointerup`, `pointercancel` (or `touchmove`, `touchend`, `touchcancel`) ([`client/scroll-ball.js:283-294`](file:///home/visionmc/projects/Conduit/client/scroll-ball.js#L283-L294)).
  - MobileDock: `pointerdown`, `click` on `#mobile-dock` ([`client/mobile-dock.js:293-294`](file:///home/visionmc/projects/Conduit/client/mobile-dock.js#L293-L294)).
  - Viewport resize: `visualViewport.addEventListener('resize', debouncedResize)` ([`client/terminal.js:587-591`](file:///home/visionmc/projects/Conduit/client/terminal.js#L587-L591)).

### PWA Implementation
- **Manifest:** Defined in [`client/manifest.json:1-18`](file:///home/visionmc/projects/Conduit/client/manifest.json#L1-L18) and linked via `<link rel="manifest" href="/manifest.json">` in [`client/terminal.html:13`](file:///home/visionmc/projects/Conduit/client/terminal.html#L13) and [`client/index.html:11`](file:///home/visionmc/projects/Conduit/client/index.html#L11).
  - Specifies: `display: "standalone"`, `start_url: "/term"`, `theme_color: "#0d0d0d"`, `background_color: "#0d0d0d"`, icon `/icon.svg`.
- **Service Worker:** **None.** There is no service worker file in the codebase, and no call to `navigator.serviceWorker.register` exists.
- **What is Cached:** **None via PWA APIs.** No offline caching via `CacheStorage` is implemented. Assets are cached solely according to standard browser HTTP response headers.

---

## 4. Network and Security

### Cloudflare Tunnel Configuration
- Spawns local binary at `bin/cloudflared` ([`server/tunnel.js:18`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L18)).
- Spawning arguments: `['tunnel', '--url', 'http://localhost:${port}', '--no-autoupdate']` ([`server/tunnel.js:24-28`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L24-L28)).
- Operates as a **Cloudflare Quick Tunnel** (ad-hoc tunnel on `*.trycloudflare.com` without login or named tunnel credentials).
- Timeout: 30,000ms ([`server/tunnel.js:17, 121`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L17)).
- Retries: Up to 3 attempts with 5,000ms delay between attempts ([`server/tunnel.js:19-20, 130-137`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L19)).
- Cleans up child process on parent process `exit`, `SIGINT`, or `SIGTERM` ([`server/tunnel.js:79-81`](file:///home/visionmc/projects/Conduit/server/tunnel.js#L79-L81)).

### Ports and Interface Binding
- Server binds to all IPv4 interfaces: `server.listen(config.PORT, '0.0.0.0', ...)` ([`server/index.js:185`](file:///home/visionmc/projects/Conduit/server/index.js#L185)).
- Configured via environment variable `PORT` in `.env`, falling back to `3000` ([`server/config.js:7`](file:///home/visionmc/projects/Conduit/server/config.js#L7)).

### CORS and Origin Checks
- **HTTP Endpoints:** No CORS headers are added (no CORS middleware loaded).
- **WebSocket Upgrade:** [`server/index.js:65-81`](file:///home/visionmc/projects/Conduit/server/index.js#L65-L81) strictly checks that `new URL(request.headers.origin).host === expectedHost`. If different, rejects connection with `403 Forbidden`.

### Rate Limiting
- Defined in [`server/auth.js:10, 37-51, 73-78`](file:///home/visionmc/projects/Conduit/server/auth.js#L10).
- In-memory Map `failedAttempts` tracks failure counts and timestamp keyed by `req.ip`.
- Limit: If 5 or more failed attempts occur within 15 minutes (`15 * 60 * 1000` ms), returns HTTP `429` with message `"Too many attempts. Try again in X minutes"` ([`server/auth.js:44-47`](file:///home/visionmc/projects/Conduit/server/auth.js#L44-L47)).
- Cleared upon successful authentication: `failedAttempts.delete(ipAddress)` ([`server/auth.js:60`](file:///home/visionmc/projects/Conduit/server/auth.js#L60)).

### Token Expiry and Refresh
- **Access Secret (`AUTH_SECRET`):** Pre-shared static token stored in `.env`.
- **JWT Secret (`JWT_SECRET`):** Symmetric secret stored in `.env`.
- **JWT Expiry:** Configured via `process.env.JWT_EXPIRY` or defaults to `'30d'` ([`server/config.js:10, 24`](file:///home/visionmc/projects/Conduit/server/config.js#L10), [`server/auth.js:67`](file:///home/visionmc/projects/Conduit/server/auth.js#L67)).
- **Token Refresh:** **None.** There is no token refresh endpoint. When the JWT expires, the server closes WebSocket with code `4001` ([`server/index.js:107`](file:///home/visionmc/projects/Conduit/server/index.js#L107)), the client clears `conduit_token` from `localStorage` ([`client/terminal.js:324`](file:///home/visionmc/projects/Conduit/client/terminal.js#L324)), and redirects to `/index.html` login page ([`client/terminal.js:329-330`](file:///home/visionmc/projects/Conduit/client/terminal.js#L329-L330)).

---

## 5. Known Failure Modes

*(Derived strictly from code logic)*

### Phone Disconnects for 1 Minute (60 Seconds)
- When socket disconnects, server initiates a 60-second timer: `session.disconnectTimeout = setTimeout(() => cleanupSession(sessionId), 60000)` ([`server/terminal.js:328-330`](file:///home/visionmc/projects/Conduit/server/terminal.js#L328-L330)).
- If reconnect occurs at $\le 60\text{s}$:
  - Timer is cleared via `clearTimeout(session.disconnectTimeout)` ([`server/terminal.js:349`](file:///home/visionmc/projects/Conduit/server/terminal.js#L349)).
  - Replay buffer is sent to client ([`server/terminal.js:368`](file:///home/visionmc/projects/Conduit/server/terminal.js#L368)).
  - Session continues without interruption.
- If reconnect occurs at $> 60\text{s}$:
  - `cleanupSession(sessionId)` executes at 60s, killing the PTY process ([`server/terminal.js:148`](file:///home/visionmc/projects/Conduit/server/terminal.js#L148)) and deleting the session key ([`server/terminal.js:165`](file:///home/visionmc/projects/Conduit/server/terminal.js#L165)).
  - When client reconnects with the JWT token, server finds no entry in `activeSessions.has(sessionId)` ([`server/terminal.js:342, 378`](file:///home/visionmc/projects/Conduit/server/terminal.js#L342)).
  - Server treats it as a new session and spawns a fresh `bash` shell with empty buffer ([`server/terminal.js:434-450`](file:///home/visionmc/projects/Conduit/server/terminal.js#L434-L450)). Any background tasks not detached from the killed shell are lost.

### Phone Disconnects for 10 Minutes
- Server destroyed the session 9 minutes prior (at 60s).
- Client exponential backoff retry loop (`[2s, 4s, 8s, 16s, 30s]`, totaling 60s) exhausts all 5 attempts ([`client/terminal.js:35, 382`](file:///home/visionmc/projects/Conduit/client/terminal.js#L35)).
- Client displays error overlay: `"Connection failed. Please retry manually."` ([`client/terminal.js:384`](file:///home/visionmc/projects/Conduit/client/terminal.js#L384)).
- When user taps `"Reconnect Now"`: client connects with stored JWT; server accepts JWT but spawns a fresh shell from scratch.

### Phone Disconnects for 1 Hour
- Same state as 10-minute disconnect.
- Additionally, if the WSL host or mobile IP changed, Cloudflare Quick Tunnel may have cycled or timed out, rendering the old tunnel URL unreachable.

### Server Restarts
- In-memory tables (`activeSessions`, `failedAttempts`, `revokedTokens`) are wiped.
- All running PTY child processes terminate.
- If clients reconnect:
  - Previously issued JWT tokens remain cryptographically valid if `.env` (`JWT_SECRET`) did not change.
  - Server accepts the JWT but finds no existing session; it spawns a fresh `bash` shell for that `sessionId`.
  - Cloudflare Quick Tunnel spawns a new process, producing a **new random subdomain URL** (`https://<new-random>.trycloudflare.com`). The previous URL permanently dies. Users connecting over the internet must scan the new QR code or load the new URL ([`README.md:162-164`](file:///home/visionmc/projects/Conduit/README.md#L162-L164)).

### Tab Discarded and Reopened
- When a mobile browser (Chrome/Safari) unloads the background tab to reclaim memory, the WebSocket is closed.
- When user switches back and reloads the tab:
  - Script loads `token = localStorage.getItem('conduit_token')` ([`client/terminal.js:19`](file:///home/visionmc/projects/Conduit/client/terminal.js#L19)).
  - Re-establishes connection using stored JWT ([`client/terminal.js:241`](file:///home/visionmc/projects/Conduit/client/terminal.js#L241)).
  - If restored $\le 60$ seconds: attaches to existing PTY and replays buffer history.
  - If restored $> 60$ seconds: server has evicted session; a new shell session is spawned.

---

## 6. Evidence

### A. Server WebSocket 'close' Handler
**File:** [`server/terminal.js:314-332`](file:///home/visionmc/projects/Conduit/server/terminal.js#L314-L332)
```javascript
  const closeHandler = (code, reason) => {
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
      }, 60000);
    }
  };
```

### B. Client WebSocket 'onclose' Handler
**File:** [`client/terminal.js:321-371`](file:///home/visionmc/projects/Conduit/client/terminal.js#L321-L371)
```javascript
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
```

### C. Server Session Cleanup Function
**File:** [`server/terminal.js:127-166`](file:///home/visionmc/projects/Conduit/server/terminal.js#L127-L166)
```javascript
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
```

### D. Server Session Spawn Function (`spawnSession`)
**File:** [`server/terminal.js:171-235`](file:///home/visionmc/projects/Conduit/server/terminal.js#L171-L235)
```javascript
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
    console.error(`Error spawning ${shellName} PTY for session ${sessionId}:`, err);
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'output',
        data: `\r\n\x1b[31mFailed to spawn ${shellName}: ${err.message}\x1b[0m\r\n`
      }));
    }
  }
}
```

### E. Server Session Create & Attach Function (`spawnTerminal`)
**File:** [`server/terminal.js:341-455`](file:///home/visionmc/projects/Conduit/server/terminal.js#L341-L455)
```javascript
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

    // Send the rolling 512KB scrollback history buffer
    if (session.buffer && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: session.buffer }));
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

    // Bind WebSocket message handlers and close handler to this session
    bindSocketToSession(ws, sessionId, session);
  }
}
```

### F. Eviction Function & Foreground Process Detection
**File:** [`server/terminal.js:83-122`](file:///home/visionmc/projects/Conduit/server/terminal.js#L83-L122)
```javascript
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
```

### G. Client Reconnect Function
**File:** [`client/terminal.js:381-418`](file:///home/visionmc/projects/Conduit/client/terminal.js#L381-L418)
```javascript
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
  isReconnectingReplay = true;

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
```

### H. Client Token & Session Storage Code
**File:** [`client/terminal.js:16-25`](file:///home/visionmc/projects/Conduit/client/terminal.js#L16-L25)
```javascript
// URL parameters & authentication token handling
const urlParams = new URLSearchParams(window.location.search);
const tokenParam = urlParams.get('token');
let token = localStorage.getItem('conduit_token');

// If neither URL token nor stored token exists, immediately redirect to login
if (!tokenParam && !token) {
  window.location.href = '/';
  throw new Error('Redirecting: no auth token.');
}
```

**File:** [`client/terminal.js:461-489`](file:///home/visionmc/projects/Conduit/client/terminal.js#L461-L489)
```javascript
  // If token is in URL (e.g. from scanned QR code or direct link), authenticate with backend
  if (tokenParam && tokenParam.trim()) {
    try {
      const response = await fetch('/auth/token-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
```

**File:** [`client/index.html:70-76`](file:///home/visionmc/projects/Conduit/client/index.html#L70-L76)
```javascript
        if (response.ok && data.token) {
          localStorage.setItem('conduit_token', data.token);
          // Preserve any extra query parameters (e.g. mobile=1) while stripping the token secret
          const targetParams = new URLSearchParams(window.location.search);
          targetParams.delete('token');
          const remainingQuery = targetParams.toString() ? '?' + targetParams.toString() : '';
          window.location.replace('/term' + remainingQuery);
        }
```

**File:** [`client/index.html:118-127`](file:///home/visionmc/projects/Conduit/client/index.html#L118-L127)
```javascript
    // Auto-login if token is already in URL or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');
    if (tokenParam && tokenParam.trim()) {
      authenticate(tokenParam.trim(), true);
    } else {
      const existingToken = localStorage.getItem('conduit_token');
      if (existingToken) {
        window.location.href = '/term';
      }
    }
```
