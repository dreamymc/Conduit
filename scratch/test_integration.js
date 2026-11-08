const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');

// Load environment variables from .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log("Starting server in background...");
    serverProcess = spawn('node', ['server/index.js'], {
      env: { ...process.env, PORT: '3500' }
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server stdout] ${output.trim()}`);
      if (output.includes('Conduit is running')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server stderr] ${data.toString()}`);
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function verifyRedirects() {
  return new Promise((resolve, reject) => {
    console.log("Verifying HTTP redirects and query forwarding...");

    // Test 1: GET / -> /index.html
    http.get('http://localhost:3500/', (res) => {
      console.log(`HTTP GET / status: ${res.statusCode}, Location: ${res.headers.location}`);
      if (res.statusCode !== 302 || res.headers.location !== '/index.html') {
        return reject(new Error(`Root redirect failed: status ${res.statusCode}, location ${res.headers.location}`));
      }

      // Test 2: GET /?token=test_token_123 -> /index.html?token=test_token_123
      http.get('http://localhost:3500/?token=test_token_123', (res2) => {
        console.log(`HTTP GET /?token=... status: ${res2.statusCode}, Location: ${res2.headers.location}`);
        if (res2.statusCode !== 302 || res2.headers.location !== '/index.html?token=test_token_123') {
          return reject(new Error(`Root query redirect failed: status ${res2.statusCode}, location ${res2.headers.location}`));
        }

        // Test 3: GET /term -> /terminal.html
        http.get('http://localhost:3500/term', (res3) => {
          console.log(`HTTP GET /term status: ${res3.statusCode}, Location: ${res3.headers.location}`);
          if (res3.statusCode !== 302 || res3.headers.location !== '/terminal.html') {
            return reject(new Error(`/term redirect failed: status ${res3.statusCode}, location ${res3.headers.location}`));
          }

          // Test 4: GET /term?token=test_token_123 -> /terminal.html?token=test_token_123
          http.get('http://localhost:3500/term?token=test_token_123', (res4) => {
            console.log(`HTTP GET /term?token=... status: ${res4.statusCode}, Location: ${res4.headers.location}`);
            if (res4.statusCode !== 302 || res4.headers.location !== '/terminal.html?token=test_token_123') {
              return reject(new Error(`/term query redirect failed: status ${res4.statusCode}, location ${res4.headers.location}`));
            }

            console.log("All HTTP redirects and query forwarding verified successfully.");
            resolve();
          });
        });
      });
    }).on('error', reject);
  });
}

function verifyHttp() {
  return new Promise((resolve, reject) => {
    console.log("Verifying HTTP static file serving...");
    http.get('http://localhost:3500/terminal.html', (res) => {
      console.log(`HTTP GET /terminal.html status: ${res.statusCode}`);
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to load terminal.html: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data.includes('xterm') || !data.includes('terminal-container')) {
          return reject(new Error("terminal.html content does not match expected structure"));
        }

        http.get('http://localhost:3500/index.html', (res2) => {
          console.log(`HTTP GET /index.html status: ${res2.statusCode}`);
          if (res2.statusCode !== 200) {
            return reject(new Error(`Failed to load index.html: ${res2.statusCode}`));
          }

          let indexData = '';
          res2.on('data', chunk => indexData += chunk);
          res2.on('end', () => {
            if (!indexData.includes('authenticate') || !indexData.includes('tokenParam') || !indexData.includes('URLSearchParams')) {
              return reject(new Error("index.html does not contain direct token auto-authentication logic"));
            }

            // Also verify terminal.js serves direct token authentication handling
            http.get('http://localhost:3500/terminal.js', (res3) => {
              console.log(`HTTP GET /terminal.js status: ${res3.statusCode}`);
              if (res3.statusCode !== 200) {
                return reject(new Error(`Failed to load terminal.js: ${res3.statusCode}`));
              }

              let termJsData = '';
              res3.on('data', chunk => termJsData += chunk);
              res3.on('end', () => {
                if (termJsData.includes('initializeTerminalAuth') && termJsData.includes('tokenParam') && !termJsData.includes('throw new Error(\'Redirecting to auth with token param.\')')) {
                  console.log("HTTP static file serving and client auto-login scripts in index.html & terminal.js verified successfully.");
                  resolve();
                } else {
                  reject(new Error("terminal.js does not contain direct URL token authentication logic"));
                }
              });
            }).on('error', reject);
          });
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

function verifyAuthLogin() {
  return new Promise((resolve, reject) => {
    console.log("Verifying /auth/login endpoint...");
    const postData = JSON.stringify({ token: process.env.AUTH_SECRET });

    const req = http.request({
      hostname: 'localhost',
      port: 3500,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      console.log(`POST /auth/login status: ${res.statusCode}`);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.token) {
            console.log("Obtained valid JWT from /auth/login successfully.");
            // Also test invalid token rejection
            const badReq = http.request({
              hostname: 'localhost',
              port: 3500,
              path: '/auth/login',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify({ token: 'wrong-token' }))
              }
            }, (badRes) => {
              console.log(`POST /auth/login with invalid token status: ${badRes.statusCode}`);
              if (badRes.statusCode === 401) {
                console.log("Invalid token rejection verified.");
                resolve(parsed.token);
              } else {
                reject(new Error(`Expected 401 for bad token, got ${badRes.statusCode}`));
              }
            });
            badReq.on('error', reject);
            badReq.write(JSON.stringify({ token: 'wrong-token' }));
            badReq.end();
          } else {
            reject(new Error(`Failed to login with AUTH_SECRET: ${res.statusCode} ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function verifyWebSocket(jwtToken) {
  return new Promise((resolve, reject) => {
    console.log("Verifying WebSocket upgrade and PTY relay with /auth/login JWT...");
    
    const ws = new WebSocket(`ws://localhost:3500/terminal?token=${jwtToken}`);
    
    let receivedBuffer = '';
    let hasSentEcho = false;
    let timer;

    ws.on('open', () => {
      console.log("WebSocket connection established.");
      // Send a resize event first to emulate client resize
      ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    });

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.type === 'output') {
          receivedBuffer += msg.data;
          console.log(`[PTY Output] ${msg.data}`);
          
          // Wait for shell to be active (e.g. we see prompt or environment path)
          // Then send our echo command
          if (!hasSentEcho && (receivedBuffer.includes('$') || receivedBuffer.includes('visionmc') || receivedBuffer.length > 5)) {
            hasSentEcho = true;
            console.log("Shell active. Sending echo command...");
            ws.send(JSON.stringify({ type: 'input', data: 'echo "INTEGRATION_TEST_PASSED"\r' }));
          }

          if (receivedBuffer.includes('INTEGRATION_TEST_PASSED') && !receivedBuffer.includes('echo "INTEGRATION_TEST_PASSED"\\r')) {
            console.log("Success! Echo command output detected in PTY stream.");
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        }
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    ws.on('close', () => {
      console.log("WebSocket connection closed.");
    });

    // Set 8-second timeout for the integration test
    timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for 'INTEGRATION_TEST_PASSED' in PTY stream."));
    }, 8000);
  });
}

async function main() {
  try {
    await startServer();
    await verifyRedirects();
    await verifyHttp();
    const jwtToken = await verifyAuthLogin();
    await verifyWebSocket(jwtToken);
    console.log("\n=========================");
    console.log("ALL INTEGRATION TESTS PASSED!");
    console.log("=========================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n=========================");
    console.error(`INTEGRATION TEST FAILED: ${err.message}`);
    console.error("=========================\n");
    process.exit(1);
  } finally {
    if (serverProcess) {
      console.log("Stopping background server process...");
      serverProcess.kill();
    }
  }
}

main();
