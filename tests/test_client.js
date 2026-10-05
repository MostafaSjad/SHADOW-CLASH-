/* headless DOM harness: executes public/client.js in Node with stubs */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SimPath = path.join(ROOT, 'public', 'sim.js');
const ClientPath = path.join(ROOT, 'public', 'client.js');
const Sim = require(SimPath);
const Maps = require(path.join(ROOT, 'public', 'maps.js'));

let failures = 0;
function check(name, cond, extra) { if (cond) console.log('  PASS', name); else { failures++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }

// ---------------- DOM stubs ----------------
function makeGrad() { return { addColorStop() {} }; }
function makeCtx() {
  const target = {};
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && p.startsWith('create')) return () => makeGrad();
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
const els = {};
let dynCount = 0;
function makeEl(id) {
  const el = {
    id, tagName: 'INPUT', isContentEditable: false,
    textContent: '', innerHTML: '', value: '', offsetWidth: 1,
    style: {}, children: [], className: '',
    _listeners: {},
    classList: {
      _s: new Set(),
      add() { for (const c of arguments) this._s.add(c); },
      remove() { for (const c of arguments) this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    querySelector() { return makeEl(id + '-child'); },
    appendChild(c) { this.children.push(c); },
    blur() { this._focused = false; },
    click() { this.fire('click'); },
    fire(type, ev) { (this._listeners[type] || []).forEach(f => f(ev || { preventDefault() {} })); }
  };
  return el;
}
const documentStub = {
  hidden: false,
  createElement(tag) {
    const el = makeEl('dyn-' + tag + '-' + (dynCount++));
    if (tag === 'canvas') {
      el.width = 0;
      el.height = 0;
      el.getContext = () => makeCtx();
    }
    return el;
  },
  getElementById(id) {
    if (!els[id]) {
      els[id] = makeEl(id);
      if (id === 'cv') els[id].getContext = () => makeCtx();
      if (id === 'pips1' || id === 'pips2') els[id].children = [makeEl('p'), makeEl('p')];
    }
    return els[id];
  },
  addEventListener() {}
};

const winListeners = {};
const rafQueue = [];
const store = () => ({ _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } });

class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
}

const sandboxGlobal = {
  Sim,
  Maps,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance,
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Map, Set,
  URLSearchParams,
  window: null,
  document: documentStub,
  navigator: {},
  location: { protocol: 'http:', host: 'localhost:3000', hostname: 'localhost', port: '3000', search: '' },
  localStorage: store(),
  sessionStorage: store(),
  WebSocket: FakeWS,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  prompt: () => null
};
const windowObj = {
  addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  devicePixelRatio: 1,
  scLan: null
};
sandboxGlobal.window = windowObj;
sandboxGlobal.globalThis = sandboxGlobal;

const context = vm.createContext(sandboxGlobal);

// ---------------- run the client ----------------
const code = fs.readFileSync(ClientPath, 'utf8');
try {
  vm.runInContext(code, context, { filename: 'client.js' });
  check('client.js loads without throwing', true);
} catch (e) {
  check('client.js loads without throwing', false, e.stack.split('\n').slice(0, 4).join(' | '));
  console.log(failures + ' FAILURES'); process.exit(1);
}

function stepFrames(n, dtMs) {
  for (let i = 0; i < n; i++) {
    const fn = rafQueue.shift();
    if (!fn) throw new Error('no rAF callback queued');
    fn(performance.now() + i * (dtMs || 16.7));
  }
}
function fireWin(type, ev) { (winListeners[type] || []).forEach(f => f(ev || { preventDefault() {} })); }

// ---------------- attract mode ----------------
try {
  stepFrames(180);
  check('attract mode renders 180 frames', true);
  check('arena picker built with 4 maps',
    els['mapStrip'] && els['mapStrip'].children.length === 4,
    els['mapStrip'] ? els['mapStrip'].children.length : 'missing');
  check('local arena picker built with 4 maps',
    els['mapStripLocal'] && els['mapStripLocal'].children.length === 4,
    els['mapStripLocal'] ? els['mapStripLocal'].children.length : 'missing');
} catch (e) { check('attract mode renders 180 frames', false, e.stack.split('\n').slice(0, 4).join(' | ')); }

// ---------------- typing in inputs must not be swallowed ----------------
try {
  const input = documentStub.getElementById('nameInput');
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyH', 'Space', 'ArrowLeft'];
  keys.forEach(c => {
    const ev = { code: c, repeat: false, target: input, prevented: false, preventDefault() { this.prevented = true; } };
    fireWin('keydown', ev);
    check('typing "' + c + '" not swallowed', ev.prevented === false);
  });
  // game keys while NOT typing must still be swallowed + tracked
  const ev2 = { code: 'KeyA', repeat: false, target: null, prevented: false, preventDefault() { this.prevented = true; } };
  fireWin('keydown', ev2);
  check('game key outside inputs still captured', ev2.prevented === true);
  // enter inside a field triggers the menu buttons without errors
  documentStub.getElementById('codeInput').value = '';
  const ev3 = { code: 'Enter', repeat: false, target: input, prevented: false, preventDefault() { this.prevented = true; } };
  fireWin('keydown', ev3);
  check('enter in field handled', true);
  // escape while typing only blurs
  const ev4 = { code: 'Escape', repeat: false, target: input, prevented: false, preventDefault() { this.prevented = true; } };
  fireWin('keydown', ev4);
  check('escape while typing does not leave the menu', ev4.prevented === false);
  if (FakeWS.last) FakeWS.last.readyState = 3;   // clean up any socket opened by Enter
} catch (e) { check('typing in inputs', false, e.stack.split('\n').slice(0, 4).join(' | ')); }

// ---------------- local 2P ----------------
try {
  documentStub.getElementById('localBtn').fire('click');
  documentStub.getElementById('localStart').fire('click');
  fireWin('keydown', { code: 'KeyD', repeat: false, preventDefault() {} });
  fireWin('keydown', { code: 'KeyJ', repeat: false, preventDefault() {} });
  stepFrames(120);
  fireWin('keyup', { code: 'KeyD', preventDefault() {} });
  fireWin('keydown', { code: 'ArrowLeft', repeat: false, preventDefault() {} });
  fireWin('keydown', { code: 'Numpad2', repeat: false, preventDefault() {} });
  stepFrames(120);
  const view = context ? true : true;
  check('local 2P runs 240 frames with input', true);
  // leave via Escape
  fireWin('keydown', { code: 'Escape', repeat: false, preventDefault() {} });
  stepFrames(30);
  check('escape returns to menu without errors', true);
} catch (e) { check('local 2P runs with input', false, e.stack.split('\n').slice(0, 4).join(' | ')); }

// ---------------- networked flow ----------------
try {
  documentStub.getElementById('createBtn').fire('click');
  const ws = FakeWS.last;
  check('clicking CREATE opens a websocket', !!ws);
  ws.readyState = 1;
  if (ws.onopen) ws.onopen();
  check('client sent create', ws.sent.some(m => m.t === 'create'), JSON.stringify(ws.sent));

  // server: room welcome (with an arena) + match start
  ws.onmessage({ data: JSON.stringify({ t: 'w', seat: 0, code: 'ABCD', token: 'tok', lan: '192.168.1.5', map: 'city' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'start', names: ['ADA', 'BOB'], map: 'bamboo' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'map', id: 'aurora' }) });   // switch arena

  // feed some real snapshots: run a sim game with a bit of action
  const g = Sim.createGame();
  const B = Sim.BIT;
  function pushSnap() {
    for (let p = 0; p < 2; p++) { g.fighters[p].input = 0; g.fighters[p].pressed = 0; }
    Sim.update(g);
    const s = Sim.snapshot(g);
    g.fx = [];
    ws.onmessage({ data: JSON.stringify({ t: 'st', s }) });
  }
  for (let i = 0; i < 40; i++) pushSnap();
  stepFrames(30);
  check('net mode renders with snapshots', true);

  // make a hit happen so fx/particles/HUD combos get exercised
  g.fighters[1].hp = 50;
  for (let i = 0; i < 400; i++) {
    const dx = g.fighters[1].x - g.fighters[0].x;
    g.fighters[0].input = dx > 70 ? B.RIGHT : 0;
    g.fighters[0].pressed = (dx <= 70 && i % 18 === 0) ? B.PUNCH : 0;
    g.fighters[1].input = 0; g.fighters[1].pressed = 0;
    Sim.update(g);
    const s = Sim.snapshot(g);
    g.fx = [];
    ws.onmessage({ data: JSON.stringify({ t: 'st', s }) });
    if (i % 40 === 0) stepFrames(5);
  }
  stepFrames(20);
  check('net mode renders during a fight with effects', true);

  // exercise message types
  ws.onmessage({ data: JSON.stringify({ t: 'pong', ts: Date.now() - 42 }) });
  ws.onmessage({ data: JSON.stringify({ t: 'paused' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'resumed' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'oppVote' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'vote' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'rematch' }) });
  stepFrames(20);
  check('pause/vote/rematch messages handled', true);

  // end the match in the sim and feed it so the banner + rematch UI appear
  g.fighters[1].hp = 1;
  for (let i = 0; i < 2400 && !g.over; i++) {
    if (g.phase === 'fight') g.fighters[1].hp = Math.min(g.fighters[1].hp, 1);
    const dx = g.fighters[1].x - g.fighters[0].x;
    g.fighters[0].input = dx > 70 ? B.RIGHT : 0;
    g.fighters[0].pressed = (dx <= 80 && i % 20 === 0) ? B.KICK : 0;
    Sim.update(g);
    const s = Sim.snapshot(g);
    g.fx = [];
    ws.onmessage({ data: JSON.stringify({ t: 'st', s }) });
    if (i % 100 === 0) stepFrames(10);
  }
  stepFrames(30);
  check('match end + win banner rendered', g.over);
  documentStub.getElementById('rematchBtn').fire('click');
  check('rematch button sends vote', ws.sent.some(m => m.t === 'rematch'));

  ws.onmessage({ data: JSON.stringify({ t: 'left' }) });
  stepFrames(30);
  check('opponent-left returns to menu cleanly', true);
} catch (e) {
  check('networked flow', false, e.stack.split('\n').slice(0, 5).join(' | '));
}

console.log(failures === 0 ? '\nALL CLIENT HARNESS TESTS PASSED' : '\n' + failures + ' CLIENT TEST(S) FAILED');
process.exit(failures ? 1 : 0);
