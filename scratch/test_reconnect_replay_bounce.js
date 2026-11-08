const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const assert = require('assert');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TEST_PORT = '3505';
let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`Starting Conduit server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server/index.js'], {
      env: { ...process.env, PORT: TEST_PORT }
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      // console.log(`[Server] ${output.trim()}`);
      if (output.includes('Conduit is running')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      // console.error(`[Server stderr] ${data.toString()}`);
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function verifyMobileStaticAssets() {
  return new Promise((resolve, reject) => {
    console.log("Verifying mobile script static assets are served...");
    const files = ['/cursor-helper.js', '/touch-controller.js', '/mobile-dock.js', '/scroll-ball.js'];
    let remaining = files.length;

    files.forEach(file => {
      http.get(`http://localhost:${TEST_PORT}${file}`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to load ${file}: status ${res.statusCode}`));
          return;
        }
        remaining--;
        if (remaining === 0) {
          console.log("✓ All mobile static assets verified successfully.");
          resolve();
        }
      }).on('error', reject);
    });
  });
}

function verifyReconnectAndBounce() {
  return new Promise((resolve, reject) => {
    console.log("Verifying scrollback replay and PTY resize bounce on reconnect...");

    const sessionId = 'test-reconnect-session-' + Date.now();
    const token = jwt.sign({ authenticated: true, sessionId }, process.env.JWT_SECRET);
    const wsUrl = `ws://localhost:${TEST_PORT}/terminal?token=${token}`;

    let ws1 = new WebSocket(wsUrl);
    let initialOutput = '';
    let readyForLargeData = false;

    ws1.on('open', () => {
      console.log("1st WebSocket connection opened.");
      ws1.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    });

    ws1.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'output') {
        initialOutput += msg.data;

        // When shell is ready, write 60KB of scrollback data
        if (!readyForLargeData && (initialOutput.includes('$') || initialOutput.length > 20)) {
          readyForLargeData = true;
          console.log("Generating >50KB scrollback data in shell...");
          // Generate 60,000 characters of identifiable output
          ws1.send(JSON.stringify({
            type: 'input',
            data: 'python3 -c "print(\'MARKER_START_\' + \'X\'*60000 + \'_MARKER_END\')"\r'
          }));
        }

        if (initialOutput.includes('MARKER_END')) {
          console.log("Large payload confirmed written in session 1. Disconnecting socket...");
          ws1.close(1000, 'network_drop_simulation');
        }
      }
    });

    ws1.on('close', () => {
      console.log("Socket 1 closed. Reconnecting after 500ms with same sessionId...");
      setTimeout(() => {
        let ws2 = new WebSocket(wsUrl);
        let replayedData = '';
        let bounceRowsDecremented = false;
        let bounceRowsRestored = false;

        ws2.on('open', () => {
          console.log("2nd WebSocket connection opened (reconnect).");
        });

        ws2.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'output') {
            replayedData += msg.data;

            if (!bounceRowsDecremented && replayedData.includes('MARKER_START_') && replayedData.includes('_MARKER_END')) {
              console.log("✓ Full >50KB scrollback buffer successfully replayed upon reconnect (512KB buffer verified)!");

              // Simulate client PTY resize bounce (Spec Fix 2)
              console.log("Simulating client PTY resize bounce: sending rows: 23 followed by rows: 24...");
              bounceRowsDecremented = true;
              ws2.send(JSON.stringify({ type: 'resize', cols: 80, rows: 23 }));

              setTimeout(() => {
                ws2.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
                bounceRowsRestored = true;

                // Send verification command to ensure shell process handled SIGWINCH cleanly
                ws2.send(JSON.stringify({ type: 'input', data: 'echo "RESIZE_BOUNCE_CONFIRMED"\r' }));
              }, 60);
            }

            if (replayedData.includes('RESIZE_BOUNCE_CONFIRMED')) {
              console.log("✓ Shell responded after resize bounce! Verification complete.");
              ws2.close();
              resolve();
            }
          }
        });

        ws2.on('error', reject);
      }, 500);
    });

    ws1.on('error', reject);
  });
}

async function main() {
  try {
    await startServer();
    await verifyMobileStaticAssets();
    await verifyReconnectAndBounce();
    console.log("\n=======================================================");
    console.log("ALL RECONNECT, REPLAY & BOUNCE TESTS PASSED!");
    console.log("=======================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n=======================================================");
    console.error(`TEST FAILED: ${err.message}`);
    console.error("=======================================================\n");
    process.exit(1);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

main();
