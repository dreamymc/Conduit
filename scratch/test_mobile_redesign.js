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
let copyModeTransitions = [];
tc.onCopyModeChange = (active) => copyModeTransitions.push(active);
tc._triggerCopyMode(70, 30); // coordinates inside cell for word 'status'
assert.notStrictEqual(selectedArgs, null);
assert.strictEqual(selectedArgs.row, 101, 'Copy Mode select must use absolute buffer row (viewportY + row)');
assert.strictEqual(selectedArgs.col, 4, 'Word lookup start column for "status" must be 4');
assert.strictEqual(selectedArgs.len, 6, 'Word length for "status" must be 6');
assert.strictEqual(tc.isCopyModeActive, true);
assert.deepStrictEqual(copyModeTransitions, [true], 'Triggering Copy Mode must notify onCopyModeChange(true)');
tc.hideCopyPill();
assert.strictEqual(tc.isCopyModeActive, false);
assert.deepStrictEqual(copyModeTransitions, [true, false], 'Hiding Copy Mode must notify onCopyModeChange(false)');

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

// 4. Touchmove > 10px must dismiss Copy Mode and cancel timer, but must NOT scroll (screen drag scroll disabled)
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 100 }], preventDefault: () => {} });
assert.strictEqual(tc.isCopyModeActive, false, 'Touchmove > 10px must dismiss Copy Mode');
assert.strictEqual(tc.longPressTriggered, false, 'Touchmove > 10px must clear longPressTriggered');
assert.strictEqual(scrolledLines, null, 'Dragging on terminal must NOT scroll terminal (screen drag scroll disabled)');

// 5. Dragging up on terminal must also NOT scroll
scrolledLines = null;
tc._handleTouchMove({ touches: [{ clientX: 50, clientY: 40 }], preventDefault: () => {} });
assert.strictEqual(scrolledLines, null, 'Dragging up on terminal must NOT scroll terminal (screen drag scroll disabled)');

// 6. Release after drag must NOT call term.focus() and must NOT start momentum
focusCalled = false;
tc._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 40 }] });
assert.strictEqual(focusCalled, false, 'Release after drag must not focus');
assert.strictEqual(tc.animFrameId, null, 'Release after drag must not start momentum scrolling');

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
// Test 5: Middle-Mouse Scroll Ball Component
// -----------------------------------------------------------------------------
console.log('--- Test 5: Scroll Ball & Autoscroll Physics ---');

// DOM Mocks
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
    this.style = {};
    this.parentNode = null;
    this._textContent = '';
  }
  get textContent() {
    if (this._textContent !== undefined && this._textContent !== '') return this._textContent;
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join('');
    }
    return this._textContent || '';
  }
  set textContent(val) {
    this._textContent = val;
  }
  set id(val) { this.attributes['id'] = val; }
  get id() { return this.attributes['id'] || ''; }
  set className(val) {
    this.classList.set = new Set((val || '').split(/\s+/).filter(Boolean));
  }
  get className() { return this.classList.toString(); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    child.parentNode = null;
    return child;
  }
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
  getBoundingClientRect() {
    return { left: 300, top: 200, width: 64, height: 64 };
  }
  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith('.') && curr.classList && curr.classList.contains(selector.slice(1))) return curr;
      if (curr.tagName && curr.tagName.toLowerCase() === selector.toLowerCase()) return curr;
      curr = curr.parentNode;
    }
    return null;
  }
  set innerHTML(html) {
    this.innerHTMLText = html;
    this.children = [];
    const root = this;
    let current = root;
    const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)([^>]*)>|([^<]+)/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const isClosing = Boolean(match[1]);
      const tagName = match[2];
      const attrsStr = match[3];
      const text = match[4];

      if (text) {
        if (text.trim()) {
          current.textContent = (current.textContent || '') + text.trim();
        }
        continue;
      }

      if (isClosing) {
        if (current.parentNode) {
          current = current.parentNode;
        }
      } else {
        const el = new MockElement(tagName);
        if (attrsStr) {
          const attrRegex = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
          let aMatch;
          while ((aMatch = attrRegex.exec(attrsStr)) !== null) {
            const key = aMatch[1];
            const val = aMatch[2] !== undefined ? aMatch[2] : '';
            if (key === 'class') {
              el.className = val;
            } else if (key === 'id') {
              el.id = val;
            } else {
              el.setAttribute(key, val);
            }
          }
        }
        current.appendChild(el);
        const voidTags = ['input', 'img', 'br', 'hr', 'meta', 'link'];
        if (!voidTags.includes(tagName.toLowerCase())) {
          current = el;
        }
      }
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
      if (selector.includes('#')) {
        const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch && el.id !== idMatch[1]) match = false;
      }
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

const windowListeners = {};
global.window = {
  innerWidth: 375,
  innerHeight: 667,
  addEventListener: (event, fn) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(fn);
  },
  removeEventListener: (event, fn) => {
    if (windowListeners[event]) {
      windowListeners[event] = windowListeners[event].filter(f => f !== fn);
    }
  },
  dispatchEvent: (event) => {
    const list = windowListeners[event.type] || [];
    for (const fn of list) fn(event);
  }
};

global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => null,
  body: new MockElement('body')
};

const scrollBallModule = require('../client/scroll-ball.js');
const { ScrollBall } = scrollBallModule;

// 5.1 Test ScrollBall DOM rendering and structural layout
let ballScrolledSteps = [];
let ballSentInputs = [];
let isHighlightedMock = false;

const ball = new ScrollBall({
  term: mockTerm,
  sendInput: (d) => ballSentInputs.push(d),
  onScroll: (step) => ballScrolledSteps.push(step),
  isHighlighted: () => isHighlightedMock,
  maxRadius: 26,
  deadzone: 4,
  minScrollSpeed: 2,
  maxScrollSpeed: 60
});

const ballEl = ball.render();
assert.notStrictEqual(ballEl, null);
assert.strictEqual(ballEl.id, 'scroll-ball');
assert.strictEqual(ball.nubEl !== null, true, 'ScrollBall must contain draggable nub element');
assert.strictEqual(ballEl.querySelectorAll('.scroll-arrow.arrow-up').length, 1, 'ScrollBall must contain visual up arrow triangle');
assert.strictEqual(ballEl.querySelectorAll('.scroll-arrow.arrow-down').length, 1, 'ScrollBall must contain visual down arrow triangle');

// 5.2 Autoscroll Speed Calculation & Deadzone
// Deadzone: movement <= 4px produces 0 speed
assert.strictEqual(ball.calculateScrollSpeed(0), 0);
assert.strictEqual(ball.calculateScrollSpeed(4), 0);
assert.strictEqual(ball.calculateScrollSpeed(-4), 0);

// Slight drag down (dy = 8px): small positive speed
const slightDownSpeed = ball.calculateScrollSpeed(8);
assert(slightDownSpeed > 0 && slightDownSpeed < 10, `Slight drag down must be slow positive speed (got ${slightDownSpeed})`);

// Medium drag down (dy = 16px): moderate positive speed
const mediumDownSpeed = ball.calculateScrollSpeed(16);
assert(mediumDownSpeed > slightDownSpeed, 'Medium drag must be faster than slight drag');

// Max drag down (dy = 26px): max speed 60 lines/sec
const maxDownSpeed = ball.calculateScrollSpeed(26);
assert.strictEqual(Math.round(maxDownSpeed), 60, 'Max drag down must reach maxScrollSpeed (60 lines/sec)');

// Far drag must be significantly faster (non-linear acceleration)
assert(maxDownSpeed > mediumDownSpeed * 1.5, 'Speed curve must accelerate non-linearly with distance');

// Upward drag produces matching negative speeds (scrolling up)
const slightUpSpeed = ball.calculateScrollSpeed(-8);
assert.strictEqual(slightUpSpeed, -slightDownSpeed, 'Upward drag must produce equal and opposite speed to downward drag');
const maxUpSpeed = ball.calculateScrollSpeed(-26);
assert.strictEqual(maxUpSpeed, -maxDownSpeed, 'Max upward drag must reach -maxScrollSpeed');

// 5.3 Continuous scrolling execution via displacement and animation step
ballScrolledSteps = [];
ball.isDragging = true;
isHighlightedMock = false;

// Simulate dragging nub down (dy = 26)
ball.dy = 26;
ball.lastScrollTime = 1000;
// Advance 100ms: 60 lines/sec * 0.1s = 6 lines
ball.lastScrollTime = 1000;
ball._stepScroll();
// Let scroll step accumulate
ball.scrollAccumulator = 5.2;
ball._stepScroll();
assert(ballScrolledSteps.length > 0, 'Autoscroll loop must dispatch scroll steps');
assert.strictEqual(ballScrolledSteps[0] > 0, true, 'Dragging nub down must dispatch positive scroll step (scroll down)');

// Simulate dragging nub up (dy = -26)
ballScrolledSteps = [];
ball.dy = -26;
ball.scrollAccumulator = -4.1;
ball._stepScroll();
assert(ballScrolledSteps.length > 0, 'Autoscroll loop must dispatch upward scroll steps');
assert.strictEqual(ballScrolledSteps[0] < 0, true, 'Dragging nub up must dispatch negative scroll step (scroll up)');

// 5.4 Release Snap-Back: Nub resets to (0,0) and scrolling stops immediately
ball._resetNub();
assert.strictEqual(ball.isDragging, false, 'Release must clear isDragging');
assert.strictEqual(ball.dx, 0, 'Release must reset dx to 0');
assert.strictEqual(ball.dy, 0, 'Release must reset dy to 0');
assert.strictEqual(ball.animFrameId, null, 'Release must stop scroll animation frame loop');
assert.strictEqual(ball.nubEl.style.transform, 'translate(0px, 0px)', 'Release must snap nub back to center');

// 5.5 Text Highlighted Arrow Control Mode (Up, Down, Left, Right)
isHighlightedMock = true;
ballSentInputs = [];
mockTerm.modes.applicationCursorKeysMode = false;

// 1. Drag Up -> sends Up arrow (\x1b[A)
ball.isDragging = true;
ball._updateNubPosition(0, -20);
assert.strictEqual(ball.activeArrowDirection, 'up');
assert.deepStrictEqual(ballSentInputs, ['\x1b[A'], 'Dragging up in highlighted mode must send Up arrow sequence');

// 2. Drag Down -> sends Down arrow (\x1b[B)
ballSentInputs = [];
ball._updateNubPosition(0, 20);
assert.strictEqual(ball.activeArrowDirection, 'down');
assert.deepStrictEqual(ballSentInputs, ['\x1b[B'], 'Dragging down in highlighted mode must send Down arrow sequence');

// 3. Drag Left -> sends Left arrow (\x1b[D)
ballSentInputs = [];
ball._updateNubPosition(-20, 0);
assert.strictEqual(ball.activeArrowDirection, 'left');
assert.deepStrictEqual(ballSentInputs, ['\x1b[D'], 'Dragging left in highlighted mode must send Left arrow sequence');

// 4. Drag Right -> sends Right arrow (\x1b[C)
ballSentInputs = [];
ball._updateNubPosition(20, 0);
assert.strictEqual(ball.activeArrowDirection, 'right');
assert.deepStrictEqual(ballSentInputs, ['\x1b[C'], 'Dragging right in highlighted mode must send Right arrow sequence');

// 5. Application cursor keys mode honored
mockTerm.modes.applicationCursorKeysMode = true;
ballSentInputs = [];
ball._updateNubPosition(0, -20);
assert.deepStrictEqual(ballSentInputs, ['\x1bOA'], 'Dragging up in app mode must send \\x1bOA');

// 6. Release in arrow mode stops repeating and resets nub
ball._resetNub();
assert.strictEqual(ball.isDragging, false);
assert.strictEqual(ball.activeArrowDirection, null);
assert.strictEqual(ball.arrowTimer, null);
assert.strictEqual(ball.nubEl.style.transform, 'translate(0px, 0px)');

// 5.6 Window listener cleanup & leak prevention
ball._handlePointerDown({ clientX: 300, clientY: 200, preventDefault: () => {} });
assert((windowListeners['pointermove'] || []).length > 0, 'Pointerdown must attach pointermove');
ball._handlePointerUp({ preventDefault: () => {} });
assert.strictEqual((windowListeners['pointermove'] || []).length, 0, 'Pointerup must remove pointermove listener (no leak)');

// 5.7 Drag mode locking: mid-drag selection clear must NOT flip into runaway autoscroll
isHighlightedMock = true;
ballScrolledSteps = [];
ballSentInputs = [];
ball._handlePointerDown({ clientX: 300, clientY: 200, preventDefault: () => {} });
assert.strictEqual(ball.dragMode, 'arrow', 'Must start in arrow mode when highlighted');
ball._handlePointerMove({ clientX: 300, clientY: 180, preventDefault: () => {} }); // drag up 20px
assert.strictEqual(ball.activeArrowDirection, 'up');

// Shell outputs and clears selection while user is still dragging
isHighlightedMock = false;
ball._handlePointerMove({ clientX: 300, clientY: 175, preventDefault: () => {} });
assert.strictEqual(ball.dragMode, 'arrow', 'Must remain locked in arrow mode during active drag');
assert.strictEqual(ball.animFrameId, null, 'Must NOT start autoscrolling mid-drag');
assert.strictEqual(ballScrolledSteps.length, 0, 'Must NOT dispatch scroll steps in arrow mode');
ball._resetNub();

// 5.8 Visual arrow mode synchronization via syncArrowMode()
isHighlightedMock = true;
ball.syncArrowMode();
assert.strictEqual(ballEl.classList.contains('arrow-mode'), true, 'syncArrowMode must add arrow-mode when highlighted');
isHighlightedMock = false;
ball.syncArrowMode();
assert.strictEqual(ballEl.classList.contains('arrow-mode'), false, 'syncArrowMode must remove arrow-mode when selection cleared');

// 5.9 Scroll Ball 3-Mode State Machine & Mode Button (Task 1)
// 5.9.1 ball.mode defaults to 'scroll'
assert.strictEqual(ball.mode, 'scroll', 'ball.mode must default to "scroll"');

// 5.9.2 Mode button rendered directly above .scroll-ball-disc
const modeBtn = ballEl.querySelector('#scroll-ball-mode-btn');
assert.notStrictEqual(modeBtn, null, 'ScrollBall must render #scroll-ball-mode-btn');
assert.strictEqual(modeBtn.classList.contains('scroll-ball-mode-btn'), true, 'Mode button must have class scroll-ball-mode-btn');
assert.strictEqual(modeBtn.getAttribute('type'), 'button', 'Mode button must have type="button"');
assert.strictEqual(modeBtn.getAttribute('aria-label'), 'Toggle navigation mode', 'Mode button must have aria-label');

const discEl = ballEl.querySelector('.scroll-ball-disc');
assert.notStrictEqual(discEl, null, 'ScrollBall must contain .scroll-ball-disc');
const btnIdx = ballEl.children.indexOf(modeBtn);
const discIdx = ballEl.children.indexOf(discEl);
assert.strictEqual(btnIdx !== -1 && discIdx !== -1 && btnIdx < discIdx, true, 'Mode button must be positioned directly above .scroll-ball-disc inside .scroll-ball');

// Initial mode 'scroll' appearance
assert.strictEqual(ballEl.classList.contains('mode-scroll'), true, 'Container must have mode-scroll class in scroll mode');
assert.strictEqual(modeBtn.classList.contains('mode-scroll'), true, 'Mode button must have mode-scroll class in scroll mode');
const scrollIcon = modeBtn.querySelector('.mode-icon');
const scrollLabel = modeBtn.querySelector('.mode-label');
assert.notStrictEqual(scrollIcon, null, 'Mode button must contain .mode-icon');
assert.notStrictEqual(scrollLabel, null, 'Mode button must contain .mode-label');
assert.strictEqual(scrollIcon.textContent.trim(), '↕', 'Scroll mode icon must be ↕');
assert.strictEqual(scrollLabel.textContent.trim(), 'SCRL', 'Scroll mode label must be SCRL');

// 5.9.3 ball.setMode(newMode) validates and sets mode, updating DOM classes & text/icons
// Switch to 'arrow'
ball.setMode('arrow');
assert.strictEqual(ball.mode, 'arrow', 'ball.mode must be "arrow" after setMode("arrow")');
assert.strictEqual(ballEl.classList.contains('mode-arrow'), true, 'Container must have mode-arrow');
assert.strictEqual(ballEl.classList.contains('mode-scroll'), false, 'Container must not have mode-scroll');
assert.strictEqual(modeBtn.classList.contains('mode-arrow'), true, 'Mode button must have mode-arrow');
assert.strictEqual(modeBtn.classList.contains('mode-scroll'), false, 'Mode button must not have mode-scroll');
assert.strictEqual(scrollIcon.textContent.trim(), '✛', 'Arrow mode icon must be ✛');
assert.strictEqual(scrollLabel.textContent.trim(), 'ARW', 'Arrow mode label must be ARW');

// Switch to 'highlight'
ball.setMode('highlight');
assert.strictEqual(ball.mode, 'highlight', 'ball.mode must be "highlight" after setMode("highlight")');
assert.strictEqual(ballEl.classList.contains('mode-highlight'), true, 'Container must have mode-highlight');
assert.strictEqual(ballEl.classList.contains('mode-arrow'), false, 'Container must not have mode-arrow');
assert.strictEqual(modeBtn.classList.contains('mode-highlight'), true, 'Mode button must have mode-highlight');
assert.strictEqual(modeBtn.classList.contains('mode-arrow'), false, 'Mode button must not have mode-arrow');
assert.strictEqual(scrollIcon.textContent.trim(), '✦', 'Highlight mode icon must be ✦');
assert.strictEqual(scrollLabel.textContent.trim(), 'SEL', 'Highlight mode label must be SEL');

// Invalid mode rejection
const invalidRes = ball.setMode('teleport');
assert.strictEqual(invalidRes, false, 'setMode with invalid mode must return false');
assert.strictEqual(ball.mode, 'highlight', 'Invalid mode must not change ball.mode');

// Switch back to 'scroll'
ball.setMode('scroll');
assert.strictEqual(ball.mode, 'scroll');
assert.strictEqual(ballEl.classList.contains('mode-scroll'), true);
assert.strictEqual(scrollIcon.textContent.trim(), '↕');
assert.strictEqual(scrollLabel.textContent.trim(), 'SCRL');

// 5.9.4 ball.cycleMode() cycles sequentially: scroll -> arrow -> highlight -> scroll
assert.strictEqual(ball.cycleMode(), 'arrow', 'cycleMode from scroll must return arrow');
assert.strictEqual(ball.mode, 'arrow');
assert.strictEqual(ballEl.classList.contains('mode-arrow'), true);

assert.strictEqual(ball.cycleMode(), 'highlight', 'cycleMode from arrow must return highlight');
assert.strictEqual(ball.mode, 'highlight');
assert.strictEqual(ballEl.classList.contains('mode-highlight'), true);

assert.strictEqual(ball.cycleMode(), 'scroll', 'cycleMode from highlight must return scroll');
assert.strictEqual(ball.mode, 'scroll');
assert.strictEqual(ballEl.classList.contains('mode-scroll'), true);

// 5.9.5 Mode button interaction: clicking or pointerdown triggers cycleMode()
// with preventDefault() and stopPropagation()
let clickPreventDefault = false;
let clickStopProp = false;
modeBtn.dispatchEvent({
  type: 'click',
  target: modeBtn,
  preventDefault: () => { clickPreventDefault = true; },
  stopPropagation: () => { clickStopProp = true; }
});
assert.strictEqual(clickPreventDefault, true, 'Clicking mode button must call preventDefault()');
assert.strictEqual(clickStopProp, true, 'Clicking mode button must call stopPropagation()');
assert.strictEqual(ball.mode, 'arrow', 'Clicking mode button must cycle mode to arrow');

// Pointerdown on mode button triggers cycleMode() and does NOT start drag
let pdPreventDefault = false;
let pdStopProp = false;
modeBtn.dispatchEvent({
  type: 'pointerdown',
  target: modeBtn,
  preventDefault: () => { pdPreventDefault = true; },
  stopPropagation: () => { pdStopProp = true; }
});
assert.strictEqual(pdPreventDefault, true, 'Pointerdown on mode button must call preventDefault()');
assert.strictEqual(pdStopProp, true, 'Pointerdown on mode button must call stopPropagation()');
assert.strictEqual(ball.mode, 'highlight', 'Pointerdown on mode button must cycle mode to highlight');
assert.strictEqual(ball.isDragging, false, 'Pointerdown on mode button must NOT trigger nub drag');

// Deduplication: immediate click (<300ms) after pointerdown must be ignored
modeBtn.dispatchEvent({
  type: 'click',
  target: modeBtn,
  preventDefault: () => {},
  stopPropagation: () => {}
});
assert.strictEqual(ball.mode, 'highlight', 'Immediate click after pointerdown must be deduplicated and not double-cycle');

// 5.10 Highlight Helper Mechanics (Mode 3: Green)
ball.setMode('highlight');
assert.strictEqual(ball.mode, 'highlight');

let mockSelections = [];
mockTerm.select = (col, row, len) => {
  mockSelections.push({ col, row, len });
};
mockTerm.cols = 80;
mockTerm.buffer.active.cursorX = 12;
mockTerm.buffer.active.cursorY = 5;
mockTerm.buffer.active.viewportY = 100; // buffer row = 105

ballSentInputs = [];
ballScrolledSteps = [];

// 5.10.1 Dragging nub in highlight mode does NOT send ANSI/VT keys to sendInput and does NOT scroll
ball.isDragging = true;
ball.dragMode = 'highlight';
ball._updateNubPosition(20, 0); // drag right 20px
assert.strictEqual(ballSentInputs.length, 0, 'Highlight mode must NOT send keystrokes to shell');
assert.strictEqual(ballScrolledSteps.length, 0, 'Highlight mode must NOT scroll terminal');

// 5.10.2 Dragging right expands selection length (+1 character)
assert(mockSelections.length > 0, 'Dragging right must call term.select');
const lastSelRight = mockSelections[mockSelections.length - 1];
assert.strictEqual(lastSelRight.col, 12, 'Selection should start at cursor column (12)');
assert.strictEqual(lastSelRight.row, 105, 'Selection should start at buffer row (105)');
assert(lastSelRight.len >= 2, 'Dragging right must expand selection length');

// 5.10.3 Dragging down expands selection by cols (80)
const curLen = ball.highlightSelection.length;
ball._updateNubPosition(0, 20); // drag down 20px
const lastSelDown = mockSelections[mockSelections.length - 1];
assert.strictEqual(lastSelDown.len, curLen + 80, 'Dragging down must expand selection by 1 line (80 cols)');

// 5.10.4 Dragging up contracts selection by cols (80)
ball._updateNubPosition(0, -20); // drag up 20px
const lastSelUp = mockSelections[mockSelections.length - 1];
assert.strictEqual(lastSelUp.len, curLen, 'Dragging up must contract selection by 1 line');

// 5.10.5 Dragging left contracts selection length
ball._updateNubPosition(-20, 0); // drag left 20px
const lastSelLeft = mockSelections[mockSelections.length - 1];
assert.strictEqual(lastSelLeft.len, curLen - 1, 'Dragging left must contract selection length');

// 5.10.6 Release snaps nub to center but preserves terminal highlight
ball._resetNub();
assert.strictEqual(ball.isDragging, false);
assert.strictEqual(ball.nubEl.style.transform, 'translate(0px, 0px)');
assert.notStrictEqual(ball.highlightSelection, null, 'Highlight selection state must be preserved on release for copy dock button');

// Reset mode to scroll for any subsequent tests
ball.setMode('scroll');

console.log('✓ Passed Scroll Ball tests\n');

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
// Test 7: Simplified 4-Button Mobile Dock ([ ENTER ], [ ESC ], [ COPY ], [ PASTE ])
// -----------------------------------------------------------------------------
console.log('--- Test 7: Simplified 4-Button Mobile Dock ---');

let dockSent = [];
let clipboardCopiedText = null;
let clipboardPastedText = 'hello world';
let termSelectionCleared = false;

const dockMockTerm = {
  hasSelection: () => true,
  getSelection: () => 'git commit -m "fix"',
  clearSelection: () => { termSelectionCleared = true; }
};

const simplifiedDock = new MobileDock({
  term: dockMockTerm,
  sendInput: (d) => dockSent.push(d),
  onCopy: () => { clipboardCopiedText = dockMockTerm.getSelection(); },
  onPaste: () => { dockSent.push(clipboardPastedText); }
});

const renderedDock = simplifiedDock.render();
assert.notStrictEqual(renderedDock, null);

// 7.1 Dock must render exactly four buttons: ENTER, ESC, COPY, PASTE
const dockButtons = renderedDock.querySelectorAll('.dock-btn');
assert.strictEqual(dockButtons.length, 4, 'Mobile dock must contain exactly four buttons');

const actions = dockButtons.map(b => b.getAttribute('data-action'));
assert.deepStrictEqual(actions, ['enter', 'esc', 'copy', 'paste'], 'Buttons must be exactly [ ENTER ], [ ESC ], [ COPY ], [ PASTE ]');

const labels = dockButtons.map(b => b.textContent.trim());
assert.deepStrictEqual(labels, ['ENTER', 'ESC', 'COPY', 'PASTE'], 'Button labels must match exactly');

// 7.2 Pointerdown on ENTER sends \r with preventDefault
let enterPreventDefault = false;
dockSent = [];
simplifiedDock._handlePointerDown({
  preventDefault: () => { enterPreventDefault = true; },
  target: dockButtons[0]
});
assert.strictEqual(enterPreventDefault, true, 'Pointerdown on ENTER must call preventDefault for virtual keyboard retention');
assert.deepStrictEqual(dockSent, ['\r'], 'ENTER button must send \\r');

// 7.3 Pointerdown on ESC sends \x1b and clears terminal selection
let escPreventDefault = false;
dockSent = [];
termSelectionCleared = false;
simplifiedDock._handlePointerDown({
  preventDefault: () => { escPreventDefault = true; },
  target: dockButtons[1]
});
assert.strictEqual(escPreventDefault, true, 'Pointerdown on ESC must call preventDefault');
assert.deepStrictEqual(dockSent, ['\x1b'], 'ESC button must send \\x1b');
assert.strictEqual(termSelectionCleared, true, 'ESC button must clear terminal selection');

// 7.4 Pointerdown on COPY copies selection and updates button text
let copyPreventDefault = false;
clipboardCopiedText = null;
const copyBtn = dockButtons[2];
simplifiedDock._handlePointerDown({
  preventDefault: () => { copyPreventDefault = true; },
  target: copyBtn
});
assert.strictEqual(copyPreventDefault, true, 'Pointerdown on COPY must call preventDefault');
assert.strictEqual(clipboardCopiedText, 'git commit -m "fix"', 'COPY button must copy current terminal selection');
assert.strictEqual(copyBtn.textContent, 'COPIED', 'COPY button must provide visual feedback');

// 7.5 Pointerdown on PASTE reads clipboard and sends input
let pastePreventDefault = false;
dockSent = [];
simplifiedDock._handlePointerDown({
  preventDefault: () => { pastePreventDefault = true; },
  target: dockButtons[3]
});
assert.strictEqual(pastePreventDefault, true, 'Pointerdown on PASTE must call preventDefault');
assert.deepStrictEqual(dockSent, ['hello world'], 'PASTE button must send clipboard text as input');

// 7.6 Deduplication: rapid click after pointerdown is ignored
dockSent = [];
simplifiedDock._handleClick({
  target: dockButtons[0]
});
assert.strictEqual(dockSent.length, 0, 'Rapid click event after pointerdown must be ignored');

// 7.7 COPY button does NOT show COPIED visual feedback when selection is empty
const emptySelectionDock = new MobileDock({
  term: { hasSelection: () => false, getSelection: () => '' },
  sendInput: () => {}
});
const emptyDockEl = emptySelectionDock.render();
const emptyCopyBtn = emptyDockEl.querySelectorAll('.dock-btn')[2];
emptySelectionDock._handlePointerDown({
  preventDefault: () => {},
  target: emptyCopyBtn
});
assert.strictEqual(emptyCopyBtn.textContent, 'COPY', 'COPY button must not show COPIED when nothing is selected');

// 7.8 PASTE button fallback when clipboard readText is rejected
let promptCalled = false;
global.window.prompt = (msg) => { promptCalled = true; return 'fallback text'; };
dockSent = [];
const fallbackDock = new MobileDock({
  sendInput: (d) => dockSent.push(d)
});
// Trigger fallbackPaste directly
fallbackDock._fallbackPaste();
assert.strictEqual(promptCalled, true, 'PASTE button fallback must prompt user for text');
assert.deepStrictEqual(dockSent, ['fallback text'], 'Fallback pasted text must be sent as input');

console.log('✓ Passed Simplified 4-Button Mobile Dock tests\n');

console.log('====================================================');
console.log('ALL UNIT AND COMPONENT TESTS PASSED SUCCESSFULLY!');
console.log('====================================================\n');
