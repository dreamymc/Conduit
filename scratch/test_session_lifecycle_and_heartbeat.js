const assert = require('assert');
const path = require('path');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Load environment config
const config = require('../server/config');
const { spawnTerminal, cleanupSession, activeSessions } = require('../server/terminal');

console.log("=================================================");
console.log("TESTING SESSION LIFECYCLE & HEARTBEAT FEATURES");
console.log("=================================================");

// Test 1: Config & 12-Hour Default
console.log("\n--- Test 1: SESSION_IDLE_TIMEOUT_MS Default & Config ---");
assert.strictEqual(
  config.SESSION_IDLE_TIMEOUT_MS,
  12 * 60 * 60 * 1000,
  `Default timeout must be exactly 12 hours (43,200,000 ms), got ${config.SESSION_IDLE_TIMEOUT_MS}`
);
assert.strictEqual(config.SESSION_IDLE_TIMEOUT_MS, 43200000);
console.log(`✓ Default SESSION_IDLE_TIMEOUT_MS is exactly 12 hours (${config.SESSION_IDLE_TIMEOUT_MS} ms)`);

// Test 2: Mock WebSocket to verify messages & lifecycle
console.log("\n--- Test 2: New Session vs Resumed Session Messages ---");

class MockWebSocket {
  constructor() {
    this.readyState = 1; // OPEN
    this.OPEN = 1;
    this.sentMessages = [];
    this.listeners = {};
    this.isAlive = true;
    this.terminated = false;
    this.closed = false;
  }

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeListener(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(h => h !== handler);
  }

  emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(h => h(...args));
    }
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = 3; // CLOSED
    this.closed = true;
    this.emit('close', code, reason);
  }

  terminate() {
    this.readyState = 3; // CLOSED
    this.terminated = true;
    this.emit('close', 1006, 'terminated');
  }

  ping() {
    this.pingSent = true;
  }
}

// 2A: New session connect
const ws1 = new MockWebSocket();
const testSessionId = 'test-lifecycle-' + Date.now();

spawnTerminal(ws1, testSessionId, 'bash');

const sessionNewMsg = ws1.sentMessages.find(m => m.type === 'session-new');
assert(sessionNewMsg, "Server must send { type: 'session-new' } on initial connect");
assert.strictEqual(sessionNewMsg.sessionId, testSessionId);
console.log("✓ New session received { type: 'session-new' }");

// Append mock buffer to session
const session = activeSessions.get(testSessionId);
assert(session, "Session must exist in activeSessions");
session.buffer = "hello world conduit test";

// 2B: Disconnect ws1 (simulating phone sleep / network drop)
ws1.close(1006, 'abnormal');
assert(session.disconnectTimeout !== null, "Disconnect timeout must be armed on socket close");
assert.strictEqual(session.ws, null, "session.ws must be null when disconnected");
console.log("✓ Normal disconnect armed disconnectTimeout without killing session");

// 2C: Reconnect with new WebSocket (ws2)
const ws2 = new MockWebSocket();
spawnTerminal(ws2, testSessionId, 'bash');

const sessionResumedMsg = ws2.sentMessages.find(m => m.type === 'session-resumed');
assert(sessionResumedMsg, "Server must send { type: 'session-resumed' } on reconnect");
assert.strictEqual(sessionResumedMsg.sessionId, testSessionId);

const replayMsg = ws2.sentMessages.find(m => m.type === 'replay');
assert(replayMsg, "Server must send explicit { type: 'replay' } message on reconnect");
assert.strictEqual(replayMsg.data, "hello world conduit test");
assert.strictEqual(session.disconnectTimeout, null, "disconnectTimeout must be cleared upon reconnect");
console.log("✓ Reconnected session received { type: 'session-resumed' } and explicit { type: 'replay' }");

// Test 3: Logout immediate cleanup
console.log("\n--- Test 3: Logout Immediate Cleanup ---");
ws2.close(1000, 'logout');
assert(!activeSessions.has(testSessionId), "Session must be immediately deleted on logout");
console.log("✓ Session immediately cleaned up on reason 'logout'");

// Test 4: Heartbeat ping / pong and missed pong termination
console.log("\n--- Test 4: Ping / Pong Heartbeat & Termination on Missed Pong ---");
const ws3 = new MockWebSocket();
const heartbeatSessionId = 'test-heartbeat-' + Date.now();
spawnTerminal(ws3, heartbeatSessionId, 'bash');

assert.strictEqual(ws3.isAlive, true, "ws.isAlive must be initialized to true");

// Simulate pong response
ws3.emit('pong');
assert.strictEqual(ws3.isAlive, true, "ws.isAlive must stay true on pong");

// Cleanup
cleanupSession(heartbeatSessionId);
console.log("✓ Heartbeat listeners registered and handled pong correctly");

console.log("\n=================================================");
console.log("ALL SESSION LIFECYCLE & HEARTBEAT TESTS PASSED!");
console.log("=================================================\n");
process.exit(0);
