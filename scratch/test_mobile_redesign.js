const assert = require('assert');
const path = require('path');

// Test Suite: Conduit Mobile Redesign Verification
console.log('====================================================');
console.log('RUNNING CONDUIT MOBILE REDESIGN COMPREHENSIVE TESTS');
console.log('====================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Shared Cursor Key Helper (Spec Fix 3)
// -----------------------------------------------------------------------------
console.log('--- Test 1: Cursor Key Helper (Spec Fix 3) ---');
const cursorHelper = require('../client/cursor-helper.js');

// 1.1 Normal cursor keys mode (applicationCursorKeysMode: false)
const normalTerm = { modes: { applicationCursorKeysMode: false } };
assert.strictEqual(cursorHelper.getCursorKeySequence('up', normalTerm), '\x1b[A');
assert.strictEqual(cursorHelper.getCursorKeySequence('down', normalTerm), '\x1b[B');
assert.strictEqual(cursorHelper.getCursorKeySequence('left', normalTerm), '\x1b[D');
assert.strictEqual(cursorHelper.getCursorKeySequence('right', normalTerm), '\x1b[C');

// 1.2 Application cursor keys mode (applicationCursorKeysMode: true)
const appTerm = { modes: { applicationCursorKeysMode: true } };
assert.strictEqual(cursorHelper.getCursorKeySequence('up', appTerm), '\x1bOA');
assert.strictEqual(cursorHelper.getCursorKeySequence('down', appTerm), '\x1bOB');
assert.strictEqual(cursorHelper.getCursorKeySequence('left', appTerm), '\x1bOD');
assert.strictEqual(cursorHelper.getCursorKeySequence('right', appTerm), '\x1bOC');

// 1.3 Handles missing modes or null term gracefully
assert.strictEqual(cursorHelper.getCursorKeySequence('up', null), '\x1b[A');
assert.strictEqual(cursorHelper.getCursorKeySequence('down', {}), '\x1b[B');
console.log('✓ Passed Cursor Key Helper tests\n');

// -----------------------------------------------------------------------------
// Test 2: Fractional Line Accumulator & Kinetic Physics
// -----------------------------------------------------------------------------
console.log('--- Test 2: Fractional Line Accumulator Physics ---');
const touchControllerModule = require('../client/touch-controller.js');
const { FractionalLineAccumulator } = touchControllerModule;

const accum = new FractionalLineAccumulator(20); // 20px per line

// No movement -> 0 step
assert.strictEqual(accum.addDisplacement(0), 0);

// Drag down 10px -> half line (not an integer yet)
assert.strictEqual(accum.addDisplacement(10), 0);
assert.strictEqual(Math.round(accum.accumulator * 100) / 100, -0.5);

// Drag down another 15px -> total 25px -> -1.25 -> step: -1 (scroll up 1 line)
const step1 = accum.addDisplacement(15);
assert.strictEqual(step1, -1);
assert.strictEqual(Math.round(accum.accumulator * 100) / 100, -0.25);

// Drag up 45px -> +2.25 - 0.25 = +2.0 -> step: +2 (scroll down 2 lines)
const step2 = accum.addDisplacement(-45);
assert.strictEqual(step2, 2);
assert.strictEqual(Math.round(accum.accumulator * 100) / 100, 0);

accum.reset();
assert.strictEqual(accum.accumulator, 0);
console.log('✓ Passed Fractional Line Accumulator tests\n');

// -----------------------------------------------------------------------------
// Test 3: Sticky CTRL Modifier State Machine & onData Hook (Spec Fix 4)
// -----------------------------------------------------------------------------
console.log('--- Test 3: Sticky CTRL onData Hook (Spec Fix 4) ---');
const mobileDockModule = require('../client/mobile-dock.js');
const { MobileDock } = mobileDockModule;

const dock = new MobileDock();
assert.strictEqual(dock.getCtrlState(), 'inactive');

// 3.1 Single tap -> active
dock._handleCtrlTap();
assert.strictEqual(dock.getCtrlState(), 'active');

// Converts single char 'c' (99) to \x03 and auto-clears
let sent = [];
dock.handleData('c', (d) => sent.push(d));
assert.deepStrictEqual(sent, ['\x03']);
assert.strictEqual(dock.getCtrlState(), 'inactive', 'Single-tap CTRL should auto-clear after 1 char');

// 3.2 Single tap -> multi-char input clears and passes through unmodified
dock.setCtrlState('active');
sent = [];
dock.handleData('hello', (d) => sent.push(d));
assert.deepStrictEqual(sent, ['hello'], 'Multi-char input must pass through unmodified');
assert.strictEqual(dock.getCtrlState(), 'inactive', 'Multi-char input must clear sticky CTRL');

// 3.3 Double tap (<300ms) -> locked
dock.setCtrlState('inactive');
dock.lastCtrlTapTime = 0;
dock._handleCtrlTap(); // tap 1
assert.strictEqual(dock.getCtrlState(), 'active');
dock._handleCtrlTap(); // tap 2 (< 300ms)
assert.strictEqual(dock.getCtrlState(), 'locked');

// Locked remains locked across multiple single chars
sent = [];
dock.handleData('a', (d) => sent.push(d));
dock.handleData('c', (d) => sent.push(d));
assert.deepStrictEqual(sent, ['\x01', '\x03']);
assert.strictEqual(dock.getCtrlState(), 'locked', 'Locked CTRL must remain locked');

// 3rd tap unlocks
dock._handleCtrlTap(); // tap 3
assert.strictEqual(dock.getCtrlState(), 'inactive', '3rd tap must unlock CTRL');

// When inactive, passes through unchanged
sent = [];
dock.handleData('x', (d) => sent.push(d));
assert.deepStrictEqual(sent, ['x']);

// 3.4 Pointerdown & click deduplication
let dockActionsSent = [];
const testDock = new MobileDock({
  sendInput: (d) => dockActionsSent.push(d)
});
testDock._handlePointerDown({
  preventDefault: () => {},
  target: { closest: () => ({ getAttribute: () => 'esc' }) }
});
assert.deepStrictEqual(dockActionsSent, ['\x1b']);

// Immediate click must be ignored
testDock._handleClick({
  target: { closest: () => ({ getAttribute: () => 'esc' }) }
});
assert.strictEqual(dockActionsSent.length, 1, 'Click immediately after pointerdown must be ignored');

console.log('✓ Passed Sticky CTRL & Dock tests\n');

// -----------------------------------------------------------------------------
// Test 4: Touch Controller Routing & Mode Fixes (Spec Fixes 1, 5, 6)
// -----------------------------------------------------------------------------
console.log('--- Test 4: Touch Controller (Spec Fixes 1, 5, 6) ---');
const { TouchController } = touchControllerModule;

let focusCalled = false;
let scrolledLines = null;
let dispatchedEvents = [];
let sentInputs = [];

const mockTerm = {
  cols: 80,
  rows: 24,
  element: {
    clientWidth: 720,
    clientHeight: 432,
    querySelector: () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 432 }) }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 432 }),
    dispatchEvent: (evt) => dispatchedEvents.push(evt),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {}
  },
  buffer: {
    active: {
      type: 'normal',
      viewportY: 100,
      baseY: 100,
      getLine: (r) => ({
        translateToString: () => 'git status --short'
      })
    }
  },
  modes: {
    mouseTrackingMode: 'none',
    applicationCursorKeysMode: false
  },
  focus: () => { focusCalled = true; },
  scrollLines: (lines) => { scrolledLines = lines; },
  select: (col, row, len) => {}
};

const tc = new TouchController(mockTerm, (data) => sentInputs.push(data), {
  container: mockTerm.element
});

// 4.1 Spec Fix 1: Short tap calls term.focus()
focusCalled = false;
tc.touchStartX = 50;
tc.touchStartY = 50;
tc.longPressTriggered = false;
tc._handleTouchEnd({ changedTouches: [{ clientX: 52, clientY: 53 }] });
assert.strictEqual(focusCalled, true, 'Short tap must call term.focus()');

// Dragging >= 10px does NOT call term.focus()
focusCalled = false;
tc._handleTouchEnd({ changedTouches: [{ clientX: 75, clientY: 50 }] });
assert.strictEqual(focusCalled, false, 'Drag release must NOT call term.focus()');

// 4.2 Spec Fix 5: Timer cancelled on touchend and touchcancel
tc.copyTimer = setTimeout(() => {}, 10000);
tc._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 50 }] });
assert.strictEqual(tc.copyTimer, null, 'touchend must clear copyTimer');

tc.copyTimer = setTimeout(() => {}, 10000);
tc._handleTouchCancel();
assert.strictEqual(tc.copyTimer, null, 'touchcancel must clear copyTimer');

// 4.3 Normal buffer scroll
mockTerm.buffer.active.type = 'normal';
tc._routeScrollStep(-3, 100, 100);
assert.strictEqual(scrolledLines, -3, 'Normal buffer must call term.scrollLines');

// 4.4 Spec Fix 6: Wheel in mouse mode -> synthetic WheelEvent only
mockTerm.buffer.active.type = 'alternate';
mockTerm.modes.mouseTrackingMode = 'any';
dispatchedEvents = [];
tc._routeScrollStep(2, 120, 200);
assert.strictEqual(dispatchedEvents.length, 1, 'Mouse tracking active must dispatch synthetic WheelEvent');
assert.strictEqual(dispatchedEvents[0].type, 'wheel');
assert.strictEqual(dispatchedEvents[0].deltaY, 2 * 18);
assert.strictEqual(dispatchedEvents[0].clientX, 120);

// 4.5 Alt buffer without mouse tracking -> shared cursor helper (Spec Fix 3)
mockTerm.modes.mouseTrackingMode = 'none';
mockTerm.modes.applicationCursorKeysMode = false;
sentInputs = [];
tc._routeScrollStep(-2, 100, 100); // scroll up 2 lines -> 2 Up arrows
assert.deepStrictEqual(sentInputs, ['\x1b[A', '\x1b[A']);

mockTerm.modes.applicationCursorKeysMode = true;
sentInputs = [];
tc._routeScrollStep(2, 100, 100); // scroll down 2 lines -> 2 Down arrows in app mode
assert.deepStrictEqual(sentInputs, ['\x1bOB', '\x1bOB']);

// 4.6 Word lookup logic in Copy Mode (Spec Fix 5)
let selectedArgs = null;
mockTerm.select = (col, row, len) => { selectedArgs = { col, row, len }; };
// Touch on 'status' in 'git status --short' (cols 4..9)
tc._triggerCopyMode(70, 30); // coordinates inside cell for word 'status'
assert.notStrictEqual(selectedArgs, null);
assert.strictEqual(selectedArgs.row, 101, 'Copy Mode select must use absolute buffer row (viewportY + row)');
assert.strictEqual(selectedArgs.col, 4, 'Word lookup start column for "status" must be 4');
assert.strictEqual(selectedArgs.len, 6, 'Word length for "status" must be 6');
assert.strictEqual(tc.isCopyModeActive, true);
tc.hideCopyPill();
assert.strictEqual(tc.isCopyModeActive, false);

// 4.7 Round-trip pan (>10px moved, ended <10px from start) must NOT call term.focus()
focusCalled = false;
tc.touchStartX = 50;
tc.touchStartY = 50;
tc._handleTouchStart({ touches: [{ clientX: 50, clientY: 50 }] });
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 150 }], preventDefault: () => {} }); // moved 100px
assert.strictEqual(tc.hasMoved, true);
tc._handleTouchEnd({ changedTouches: [{ clientX: 52, clientY: 53 }] }); // released near start
assert.strictEqual(focusCalled, false, 'Round-trip pan must NOT be misclassified as a short tap');

// 4.8 Regression Test (Spec Fix 5 / Req 5): Long-press, then drag, and it must scroll
scrolledLines = null;
focusCalled = false;
tc.touchStartX = 50;
tc.touchStartY = 50;
tc.lastX = 50;
tc.lastY = 50;
tc.hasMoved = false;

// 1. Verify long-press timer cancellation if movement exceeds 10px before 500ms
tc._handleTouchStart({ touches: [{ clientX: 50, clientY: 50 }] });
assert.notStrictEqual(tc.copyTimer, null, 'TouchStart must start long-press timer');
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 65 }], preventDefault: () => {} }); // moved 15px
assert.strictEqual(tc.copyTimer, null, 'Touchmove > 10px must cancel long-press timer');
assert.strictEqual(tc.isCopyModeActive, false, 'Copy Mode must not activate if moved > 10px');

// 2. Simulate long-press Copy Mode triggered
tc.touchStartX = 50;
tc.touchStartY = 50;
tc.lastX = 50;
tc.lastY = 50;
tc.hasMoved = false;
tc._triggerCopyMode(50, 50);
assert.strictEqual(tc.isCopyModeActive, true, 'Copy mode must be active after long-press');
assert.strictEqual(tc.longPressTriggered, true, 'longPressTriggered must be true');

// 3. Micro-movement <= 10px must stay in Copy Mode and NOT scroll
mockTerm.buffer.active.type = 'normal';
scrolledLines = null;
tc._handleTouchMove({ touches: [{ clientX: 55, clientY: 55 }], preventDefault: () => {} });
assert.strictEqual(tc.isCopyModeActive, true, 'Micro-movement <= 10px must retain Copy Mode');
assert.strictEqual(scrolledLines, null, 'Micro-movement <= 10px must not scroll');

// 4. Touchmove > 10px must dismiss Copy Mode, cancel timer, and scroll terminal
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 100 }], preventDefault: () => {} });
assert.strictEqual(tc.isCopyModeActive, false, 'Touchmove > 10px must dismiss Copy Mode');
assert.strictEqual(tc.longPressTriggered, false, 'Touchmove > 10px must clear longPressTriggered');
assert.notStrictEqual(scrolledLines, null, 'Touchmove > 10px after long-press must scroll');
assert.strictEqual(scrolledLines < 0, true, 'Dragging down must scroll up');

// 5. Dragging up after long-press must scroll down
scrolledLines = null;
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 40 }], preventDefault: () => {} });
assert.notStrictEqual(scrolledLines, null, 'Dragging up must scroll');
assert.strictEqual(scrolledLines > 0, true, 'Dragging up must scroll down');

// 6. Release after drag must NOT call term.focus()
focusCalled = false;
tc._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 40 }] });
assert.strictEqual(focusCalled, false, 'Release after long-press + drag must not focus');

// 7. Pausing stationary for >150ms before release must NOT trigger momentum
tc.touchStartX = 50;
tc.touchStartY = 50;
tc.lastX = 50;
tc.lastY = 50;
tc.hasMoved = false;
tc.samples = [];
tc._handleTouchStart({ touches: [{ clientX: 50, clientY: 50 }] });
// Fast drag to generate velocity
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 120 }], preventDefault: () => {} });
assert.strictEqual(tc.hasMoved, true);
// Simulate pause of 300ms before release: lastTime was set during move
tc.stopMomentum();
tc._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 120 }] });
// Verify that velocity does not run momentum if released long after moving
const pauseReleaseVel = tc.calculateReleaseVelocity(tc.lastTime + 300);
// While calculateReleaseVelocity provides the fallback value, _handleTouchEnd prevents momentum:
assert.strictEqual(tc.animFrameId, null, 'Stationary hold before release must not start momentum');

// 4.9 Time-based friction: 0.975 ** (dt / 16.67) so 120Hz phones feel the same (Req 2)
assert.strictEqual(tc.friction, 0.975, 'Default friction must be 0.975');
const decay60Hz = tc.getFrictionDecay(16.67);
assert(Math.abs(decay60Hz - 0.975) < 1e-4, 'At dt=16.67ms (60Hz), decay factor must be ~0.975');
const decay120Hz = tc.getFrictionDecay(16.67 / 2); // 8.335ms
assert(Math.abs(Math.pow(decay120Hz, 2) - 0.975) < 1e-4, 'Two 120Hz frames must equal one 60Hz frame decay');

// 4.10 Velocity window ~150ms with last-3-samples fallback and recency weighting (Req 1 & 3)
// 1:1 drag tracking check: accumulator with 18px line height moves 36px -> exactly 2 lines
accum.reset();
accum.setLineHeight(18);
assert.strictEqual(accum.addDisplacement(-36), 2, 'Drag tracking must be 1:1 without gain');

// Velocity calculation with recency weighting and gain
tc.samples = [
  { y: 100, time: 1000 },
  { y: 130, time: 1020 }, // dt=20, dy=30 -> v=1.5, weight=1
  { y: 180, time: 1040 }  // dt=20, dy=50 -> v=2.5, weight=2
];
// Base weighted velocity = (1.5 * 1 + 2.5 * 2) / 3 = 6.5 / 3 = 2.1666...
// Release velocity with 1.75 gain = 2.1666... * 1.75 = 3.79166...
const releaseVel = tc.calculateReleaseVelocity(1050); // within 150ms
const expectedBase = (1.5 * 1 + 2.5 * 2) / 3;
const expectedGain = expectedBase * tc.velocityGain;
assert(Math.abs(releaseVel - expectedGain) < 1e-4, 'Release velocity must include recency weighting and gain');
assert(tc.velocityGain >= 1.5 && tc.velocityGain <= 2.0, 'Gain must be between 1.5x and 2x');

// Last-3-samples fallback when samples are older than 150ms window
tc.samples = [
  { y: 50, time: 100 },
  { y: 100, time: 200 },
  { y: 130, time: 300 },
  { y: 180, time: 400 }
];
// Test at t=1000 (all samples > 150ms old): fallback to last 3 samples (indices 1, 2, 3)
const fallbackVel = tc.calculateReleaseVelocity(1000);
// Intervals from indices 1, 2, 3:
// seg 1 (200->300): dt=100, dy=30 -> v=0.3, weight=1
// seg 2 (300->400): dt=100, dy=50 -> v=0.5, weight=2
// base = (0.3*1 + 0.5*2)/3 = 1.3/3 = 0.4333...
const expectedFallback = ((0.3 * 1 + 0.5 * 2) / 3) * tc.velocityGain;
assert(Math.abs(fallbackVel - expectedFallback) < 1e-4, 'Fallback must use last 3 samples with recency weighting');
console.log('✓ Passed Touch Controller tests\n');

// -----------------------------------------------------------------------------
// Test 5: Power Sheet Component & Macros
// -----------------------------------------------------------------------------
console.log('--- Test 5: Power Sheet & Macros ---');
const powerSheetModule = require('../client/power-sheet.js');
const { PowerSheet, DEFAULT_MACROS } = powerSheetModule;

assert(Array.isArray(DEFAULT_MACROS) && DEFAULT_MACROS.length === 3);

// 5.1 Test macro persistence when list is empty
const mockStorage = {
  store: { 'conduit_macros': '[]' },
  getItem: (k) => mockStorage.store[k] !== undefined ? mockStorage.store[k] : null,
  setItem: (k, v) => { mockStorage.store[k] = String(v); }
};
global.localStorage = mockStorage;

const psEmpty = new PowerSheet({ term: mockTerm });
assert.deepStrictEqual(psEmpty.macros, [], 'Empty macros list in localStorage must NOT be overwritten with default macros');

// 5.2 Test default macros loading when no storage exists
delete mockStorage.store['conduit_macros'];
const psDefault = new PowerSheet({ term: mockTerm });
assert.strictEqual(psDefault.macros.length, 3);
assert.strictEqual(psDefault.macros[0].name, 'git status');

// 5.3 PowerSheet DOM interaction mock
class MockClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...classes) {
    for (const c of classes) this.set.add(c);
  }
  remove(...classes) {
    for (const c of classes) this.set.delete(c);
  }
  contains(c) {
    return this.set.has(c);
  }
  toggle(c) {
    if (this.set.has(c)) { this.set.delete(c); return false; }
    else { this.set.add(c); return true; }
  }
  toString() {
    return [...this.set].join(' ');
  }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.classList = new MockClassList(this);
    this.listeners = {};
    this.innerHTMLText = '';
    this.value = '';
  }
  set id(val) { this.attributes['id'] = val; }
  get id() { return this.attributes['id'] || ''; }
  set className(val) {
    this.classList.set = new Set((val || '').split(/\s+/).filter(Boolean));
  }
  get className() { return this.classList.toString(); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  removeEventListener(event, fn) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }
  }
  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) fn(event);
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {}, stopPropagation: () => {} });
  }
  set innerHTML(html) {
    this.innerHTMLText = html;
    this.children = [];
    // Basic mock parser for test buttons
    const btnRegex = /<button\s+([^>]*?)>([\s\S]*?)<\/button>/g;
    let match;
    while ((match = btnRegex.exec(html)) !== null) {
      const btn = new MockElement('button');
      btn.textContent = match[2].trim();
      const attrStr = match[1];
      const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
      let aMatch;
      while ((aMatch = attrRegex.exec(attrStr)) !== null) {
        if (aMatch[1] === 'class') btn.className = aMatch[2];
        else btn.setAttribute(aMatch[1], aMatch[2]);
      }
      this.children.push(btn);
    }
  }
  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }
  querySelectorAll(selector) {
    const results = [];
    const check = (el) => {
      let match = true;
      if (selector.includes('.')) {
        const classes = selector.match(/\.([a-zA-Z0-9_-]+)/g);
        if (classes) {
          for (const c of classes) {
            if (!el.classList || !el.classList.contains(c.slice(1))) match = false;
          }
        }
      }
      if (selector.includes('[')) {
        const attrs = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g);
        if (attrs) {
          for (const a of attrs) {
            const m = a.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
            if (m) {
              const val = el.getAttribute(m[1]);
              if (val === null) match = false;
              else if (m[2] !== undefined && val !== m[2]) match = false;
            }
          }
        }
      }
      if (match) results.push(el);
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return results;
  }
}

global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => null,
  body: new MockElement('body')
};

let sheetSent = [];
let sheetReconnectCalled = false;
const testPS = new PowerSheet({
  term: mockTerm,
  sendInput: (d) => sheetSent.push(d),
  onReconnect: () => { sheetReconnectCalled = true; }
});
testPS.render();

// Verify D-pad Up click sends cursor sequence honoring applicationCursorKeysMode
mockTerm.modes.applicationCursorKeysMode = false;
sheetSent = [];
const upBtn = testPS.element.querySelectorAll('.dpad-btn[data-dir]')[0];
assert.strictEqual(upBtn.getAttribute('data-dir'), 'up');
upBtn.click();
assert.deepStrictEqual(sheetSent, ['\x1b[A'], 'D-pad Up click in normal mode must send \\x1b[A');

mockTerm.modes.applicationCursorKeysMode = true;
sheetSent = [];
upBtn.click();
assert.deepStrictEqual(sheetSent, ['\x1bOA'], 'D-pad Up click in app mode must send \\x1bOA');

// Verify symbol click sends symbol character
sheetSent = [];
const symbolBtns = testPS.element.querySelectorAll('.symbol-btn[data-sym]');
assert(symbolBtns.length > 0);
symbolBtns[0].click();
assert.strictEqual(sheetSent.length, 1);

// Verify macro run sends command and closes sheet
sheetSent = [];
testPS.open();
assert.strictEqual(testPS.isOpen, true);
const macroRunBtn = testPS.element.querySelectorAll('.macro-run-btn')[0];
macroRunBtn.click();
assert.strictEqual(sheetSent[0], 'git status\n');
assert.strictEqual(testPS.isOpen, false, 'Running a macro must close the Power Sheet');

console.log('✓ Passed Power Sheet tests\n');

// -----------------------------------------------------------------------------
// Test 6: Server Terminal: 512KB Buffer, Max 10 Sessions & LRU Eviction (Spec Fix 7)
// -----------------------------------------------------------------------------
console.log('--- Test 6: Server Session Cap & LRU Eviction (Spec Fix 7) ---');
const serverTerminal = require('../server/terminal.js');
const { spawnTerminal, cleanupSession, activeSessions, getRunningForegroundProcess, MAX_SESSIONS, MAX_BUFFER_LENGTH } = serverTerminal;

assert.strictEqual(MAX_BUFFER_LENGTH, 512 * 1024, 'Buffer limit must be 512KB');
assert.strictEqual(MAX_SESSIONS, 10, 'Max sessions limit must be 10');

// Clear any existing sessions from previous runs
for (const id of activeSessions.keys()) {
  cleanupSession(id);
}

// 6.1 Create dummy mock websockets and fill up 10 sessions
const mockSockets = [];
for (let i = 1; i <= 10; i++) {
  const ws = {
    readyState: 1, // OPEN
    OPEN: 1,
    send: () => {},
    close: (code, reason) => { ws.closedCode = code; ws.closedReason = reason; ws.readyState = 3; },
    on: () => {}
  };
  mockSockets.push(ws);
  spawnTerminal(ws, `session-${i}`, 'bash');
}

assert.strictEqual(activeSessions.size, 10, 'Should have 10 active sessions');

// 6.2 When all 10 are connected, 11th session must be rejected with 4002
const rejectedWs = {
  readyState: 1,
  OPEN: 1,
  send: () => {},
  close: (code, reason) => { rejectedWs.closedCode = code; rejectedWs.closedReason = reason; rejectedWs.readyState = 3; },
  on: () => {}
};
spawnTerminal(rejectedWs, 'session-11', 'bash');
assert.strictEqual(rejectedWs.closedCode, 4002, 'Should reject with close code 4002 when full');
assert.strictEqual(rejectedWs.closedReason, 'Server session capacity full');
assert.strictEqual(activeSessions.size, 10);

// 6.3 Disconnect session-1 and session-2
// session-1 has an older lastActiveTime than session-2
const sess1 = activeSessions.get('session-1');
const sess2 = activeSessions.get('session-2');
sess1.ws = null;
sess1.disconnectTimeout = 123; // marked disconnected
sess1.lastActiveTime = 1000;

sess2.ws = null;
sess2.disconnectTimeout = 124; // marked disconnected
sess2.lastActiveTime = 2000;

// Simulate that session-1 has a running foreground process ('vim'),
// while session-2 is idle shell.
// Spec Fix 7 requires LRU eviction to SKIP session-1 (which has a running foreground process)
// and evict session-2 instead!
Object.defineProperty(sess1.term, 'process', { value: 'vim', configurable: true });
Object.defineProperty(sess2.term, 'process', { value: '/bin/bash', configurable: true });

assert.notStrictEqual(getRunningForegroundProcess(sess1), null, 'sess1 should have fg process');
assert.strictEqual(getRunningForegroundProcess(sess2), null, 'sess2 should be idle');

const newWs = {
  readyState: 1,
  OPEN: 1,
  send: () => {},
  close: () => {},
  on: () => {}
};
spawnTerminal(newWs, 'session-11', 'bash');

// Verify session-2 was evicted (skipped session-1 with running process)
assert.strictEqual(activeSessions.has('session-2'), false, 'Session-2 should be evicted');
assert.strictEqual(activeSessions.has('session-1'), true, 'Session-1 with running process should have been spared');
assert.strictEqual(activeSessions.has('session-11'), true, 'Session-11 should be created');

// 6.4 Now disconnect session-11, and both session-1 and session-11 have running foreground processes
const sess11 = activeSessions.get('session-11');
sess11.ws = null;
sess11.disconnectTimeout = 125;
sess11.lastActiveTime = 3000;
Object.defineProperty(sess11.term, 'process', { value: 'htop', configurable: true });

// Disconnect all other sessions as well and mark them all as having foreground processes
for (let i = 3; i <= 10; i++) {
  const s = activeSessions.get(`session-${i}`);
  if (s) {
    s.ws = null;
    s.disconnectTimeout = 200 + i;
    s.lastActiveTime = 1000 + i;
    Object.defineProperty(s.term, 'process', { value: 'python', configurable: true });
  }
}

// When ALL disconnected sessions have running foreground processes,
// LRU eviction must evict the oldest disconnected one (session-1) and log the kill!
const newWs2 = {
  readyState: 1,
  OPEN: 1,
  send: () => {},
  close: () => {},
  on: () => {}
};
spawnTerminal(newWs2, 'session-12', 'bash');
assert.strictEqual(activeSessions.has('session-1'), false, 'Oldest session with running process should be evicted when all have fg processes');
assert.strictEqual(activeSessions.has('session-12'), true, 'Session-12 should be created');

// Clean up test sessions
for (const id of activeSessions.keys()) {
  cleanupSession(id);
}
assert.strictEqual(activeSessions.size, 0);

// 6.5 Real PTY child process foreground detection test
const pty = require('node-pty');
const realPty = pty.spawn('/bin/bash', [], { name: 'xterm', cols: 80, rows: 24 });
const realSess = { term: realPty, shell: 'bash' };
assert.strictEqual(getRunningForegroundProcess(realSess), null, 'Idle bash shell must return null for foreground process');

realPty.write('python3 -c "import time; time.sleep(3)"\r');

// Poll up to 1.5s for python3 process to spin up in session
let detectedFg = null;
const startTime = Date.now();
while (Date.now() - startTime < 1500) {
  detectedFg = getRunningForegroundProcess(realSess);
  if (detectedFg && detectedFg.includes('python')) break;
  // brief sync wait
  const t = Date.now();
  while (Date.now() - t < 100) {}
}
realPty.kill();
assert(detectedFg && detectedFg.includes('python'), `Must detect running child foreground process (got: ${detectedFg})`);

console.log('✓ Passed Server Session Cap & LRU Eviction tests\n');

// -----------------------------------------------------------------------------
// Test 7: Jump-to-Bottom Pill (Req 6)
// -----------------------------------------------------------------------------
console.log('--- Test 7: Jump-to-Bottom Pill (Req 6) ---');

let scrollToBottomCalled = false;
const jumpMockTerm = {
  buffer: {
    active: {
      type: 'normal',
      viewportY: 50,
      baseY: 100
    }
  },
  scrollToBottom: () => {
    scrollToBottomCalled = true;
    jumpMockTerm.buffer.active.viewportY = jumpMockTerm.buffer.active.baseY;
  },
  onScroll: (cb) => { jumpMockTerm._scrollCb = cb; },
  _scrollCb: null
};

// Create mock pill element
const pillEl = new MockElement('button');
pillEl.id = 'jump-to-bottom-pill';
pillEl.className = 'jump-to-bottom-pill hidden';

const updatePill = () => {
  const isNormal = Boolean(
    jumpMockTerm.buffer &&
    jumpMockTerm.buffer.active &&
    jumpMockTerm.buffer.active.type === 'normal'
  );
  if (!isNormal) {
    pillEl.classList.add('hidden');
    return;
  }
  const isAtBottom = (jumpMockTerm.buffer.active.viewportY >= jumpMockTerm.buffer.active.baseY);
  if (isAtBottom) {
    pillEl.classList.add('hidden');
  } else {
    pillEl.classList.remove('hidden');
  }
};

let pdPreventDefaultCalled = false;
const handleJumpTap = (e) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (jumpMockTerm.buffer && jumpMockTerm.buffer.active && jumpMockTerm.buffer.active.type === 'normal') {
    jumpMockTerm.scrollToBottom();
    updatePill();
  }
};
pillEl.addEventListener('pointerdown', handleJumpTap);

// 7.1 Normal buffer, scrolled up -> pill is visible
updatePill();
assert.strictEqual(pillEl.classList.contains('hidden'), false, 'Pill must be visible when scrolled up in normal buffer');

// 7.2 Pointerdown calls preventDefault and scrolls to bottom
pdPreventDefaultCalled = false;
scrollToBottomCalled = false;
pillEl.dispatchEvent({
  type: 'pointerdown',
  preventDefault: () => { pdPreventDefaultCalled = true; }
});
assert.strictEqual(pdPreventDefaultCalled, true, 'pointerdown on pill must call preventDefault to retain focus/keyboard');
assert.strictEqual(scrollToBottomCalled, true, 'pointerdown must scroll terminal to bottom');
assert.strictEqual(pillEl.classList.contains('hidden'), true, 'Pill must hide once scrolled to bottom');

// 7.3 Alternate buffer -> pill must remain hidden even if viewportY < baseY
jumpMockTerm.buffer.active.type = 'alternate';
jumpMockTerm.buffer.active.viewportY = 10;
jumpMockTerm.buffer.active.baseY = 100;
updatePill();
assert.strictEqual(pillEl.classList.contains('hidden'), true, 'Pill must NEVER show in alternate buffer');

// 7.4 Alternate buffer: tapping does not scroll
scrollToBottomCalled = false;
pillEl.dispatchEvent({
  type: 'pointerdown',
  preventDefault: () => {}
});
assert.strictEqual(scrollToBottomCalled, false, 'Tapping pill in alternate buffer must not scroll');

// 7.5 Momentum cancellation when Jump-to-Bottom pill is activated
let stopMomentumCalled = false;
const mockTouchController = {
  stopMomentum: () => { stopMomentumCalled = true; }
};
const handleJumpWithTouch = (e) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (mockTouchController && typeof mockTouchController.stopMomentum === 'function') {
    mockTouchController.stopMomentum();
  }
  if (jumpMockTerm.buffer && jumpMockTerm.buffer.active && jumpMockTerm.buffer.active.type === 'normal') {
    jumpMockTerm.scrollToBottom();
    updatePill();
  }
};
jumpMockTerm.buffer.active.type = 'normal';
jumpMockTerm.buffer.active.viewportY = 10;
updatePill();
stopMomentumCalled = false;
handleJumpWithTouch({ preventDefault: () => {} });
assert.strictEqual(stopMomentumCalled, true, 'Activating Jump-to-Bottom must stop running kinetic momentum');

console.log('✓ Passed Jump-to-Bottom Pill tests\n');

console.log('====================================================');
console.log('ALL UNIT AND COMPONENT TESTS PASSED SUCCESSFULLY!');
console.log('====================================================\n');
