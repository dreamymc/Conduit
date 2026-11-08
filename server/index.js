'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ip = require('ip');
const chalkModule = require('chalk');
const chalk = chalkModule.default || chalkModule;
const qrcode = require('qrcode-terminal');

const config = require('./config');
const { spawnTerminal } = require('./terminal');
const { startTunnel } = require('./tunnel');

const jwt = require('jsonwebtoken');
const { authRouter, revokedTokens } = require('./auth');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);

// Create WebSocket server attached to the same HTTP server
const wss = new WebSocket.Server({ noServer: true });

// Parse JSON request bodies
app.use(express.json());

app.use((req, res, next) => {
  const host = req.get('host') || '';
  if (host.endsWith('.trycloudflare.com')) {
    res.setHeader('Content-Security-Policy', 'upgrade-insecure-requests');
  }
  next();
});

// Redirect root to index.html (login screen), preserving query parameters (e.g. ?token=...)
app.get('/', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect('/index.html' + query);
});

// Redirect /term to terminal.html, preserving query parameters
app.get('/term', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect('/terminal.html' + query);
});

// Mount auth router
app.use('/auth', authRouter);

// Serve client directory statically
app.use(express.static(path.join(__dirname, '../client')));

// Handle connection upgrade to /terminal WebSocket
server.on('upgrade', (request, socket, head) => {
  const rawHost = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
  const expectedHost = rawHost.split(',')[0].trim();
  const { pathname } = new URL(request.url, `http://${expectedHost}`);

  if (pathname === '/terminal') {
    // Validate WebSocket upgrade Origin header
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.host !== expectedHost) {
          console.warn(`WebSocket upgrade rejected: Origin mismatch (${parsedOrigin.host} !== ${expectedHost})`);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch (err) {
        console.warn(`WebSocket upgrade rejected: Invalid Origin header`);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  console.log('New WebSocket client connecting...');

  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = searchParams.get('token');

    if (!token) {
      console.log('WebSocket connection rejected: Missing token');
      ws.close(4001, 'Unauthorized: Missing token');
      return;
    }

    jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) {
        console.log(`WebSocket connection rejected: ${err.message}`);
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }

      if (decoded && decoded.jti && revokedTokens.has(decoded.jti)) {
        console.log('WebSocket connection rejected: Token has been revoked');
        ws.close(4001, 'Unauthorized: Token has been revoked');
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket closed before PTY could be spawned.');
        return;
      }

      console.log('WebSocket client successfully authenticated.');
      const sessionId = decoded && decoded.sessionId ? decoded.sessionId : 'default-session';
      const jti = decoded && decoded.jti ? decoded.jti : null;
      spawnTerminal(ws, sessionId, 'bash', jti);
    });
  } catch (err) {
    console.error('Error during WebSocket verification:', err);
    ws.close(4001, 'Internal authentication error');
  }
});

/**
 * Detects the Windows host %USERPROFILE% via WSL interop cmd.exe and translates it to a WSL path.
 */
function detectWindowsUserProfile() {
  return new Promise((resolve) => {
    const paths = [
      { cmd: '/mnt/c/Windows/System32/cmd.exe', cwd: '/mnt/c' },
      { cmd: '/mnt/c/Windows/system32/cmd.exe', cwd: '/mnt/c' },
      { cmd: '/c/Windows/System32/cmd.exe', cwd: '/c' },
      { cmd: '/c/Windows/system32/cmd.exe', cwd: '/c' }
    ];

    let target = null;
    for (const p of paths) {
      if (fs.existsSync(p.cmd)) {
        target = p;
        break;
      }
    }

    if (!target) {
      return resolve(null);
    }

    exec(`"${target.cmd}" /c "echo %USERPROFILE%" < /dev/null`, { timeout: 2000, cwd: target.cwd }, (error, stdout) => {
      if (error) {
        return resolve(null);
      }
      const rawProfile = stdout.trim();
      if (!rawProfile) {
        return resolve(null);
      }

      const match = rawProfile.match(/^([a-zA-Z]):\\(.*)$/);
      if (!match) {
        return resolve(null);
      }

      const drive = match[1].toLowerCase();
      const relativePath = match[2].replace(/\\/g, '/');
      const mountPrefix = fs.existsSync(`/mnt/${drive}`) ? `/mnt/${drive}` : (fs.existsSync(`/${drive}`) ? `/${drive}` : null);
      if (!mountPrefix) {
        return resolve(null);
      }

      const wslPath = `${mountPrefix}/${relativePath}`;
      resolve(wslPath);
    });
  });
}

// ─── Async Startup ────────────────────────────────────────────────────────────
server.listen(config.PORT, '0.0.0.0', async () => {
  const localIp = ip.address();
  const localUrl = `http://${localIp}:${config.PORT}`;

  // Query and cache Windows user profile path asynchronously
  try {
    config.WINDOWS_USERPROFILE = await detectWindowsUserProfile();
    if (config.WINDOWS_USERPROFILE) {
      console.log(chalk.green(`✓ Successfully cached Windows user profile: ${config.WINDOWS_USERPROFILE}`));
    } else {
      console.log(chalk.yellow(`⚠ Could not resolve Windows user profile. Falling back to default mount paths.`));
    }
  } catch (err) {
    console.error(chalk.red(`✗ Error detecting Windows user profile: ${err.message}`));
  }

  // Attempt to start Cloudflare Tunnel
  let publicUrl = null;
  try {
    console.log(chalk.yellow('Starting Cloudflare Tunnel… (this takes ~10 seconds)'));
    publicUrl = await startTunnel(config.PORT);
  } catch (err) {
    console.warn(chalk.yellow(`Warning: Cloudflare Tunnel failed to start: ${err.message}`));
    console.warn(chalk.yellow('Continuing without public URL.'));
  }

  // ── Banner ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.green('╔' + '═'.repeat(63) + '╗'));
  console.log(chalk.green('║' + '                     Conduit is running                       ' + '║'));
  console.log(chalk.green('╠' + '═'.repeat(63) + '╣'));
  console.log(chalk.green(`║  Local:   ${localUrl.padEnd(51)} ║`));
  if (publicUrl) {
    console.log(chalk.green(`║  Public:  ${publicUrl.padEnd(51)} ║`));
  }
  if (process.stdout.isTTY) {
    console.log(chalk.green(`║  Token:   ${config.AUTH_SECRET.padEnd(51)} ║`));
  } else {
    console.log(chalk.green(`║  Token:   [hidden in logs]${' '.repeat(35)} ║`));
  }
  console.log(chalk.green('╚' + '═'.repeat(63) + '╝'));
  console.log('');

  const localAuthUrl = `${localUrl}/?token=${encodeURIComponent(config.AUTH_SECRET)}`;
  const publicAuthUrl = publicUrl ? `${publicUrl}/?token=${encodeURIComponent(config.AUTH_SECRET)}` : null;

  // ── Local QR Code ──────────────────────────────────────────────────────────
  console.log(chalk.cyan('  ▸ Local Network QR Code:'));
  qrcode.generate(localAuthUrl, { small: true });

  // ── Public QR Code ─────────────────────────────────────────────────────────
  if (publicAuthUrl) {
    console.log(chalk.cyan('  ▸ Public (Cloudflare) QR Code:'));
    qrcode.generate(publicAuthUrl, { small: true });
  }
});
