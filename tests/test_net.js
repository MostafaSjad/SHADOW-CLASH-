/* end-to-end test: http serving + websocket protocol + full online room flow */
const { spawn } = require('child_process');
const path = require('path');
const Maps = require(path.join(__dirname, '..', 'public', 'maps.js'));
const PORT = 3123;
const BASE = 'http://127.0.0.1:' + PORT;
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(tag) {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT);
  const q = [];
  const all = [];
  const waiters = [];
  let open = false;
  ws.onopen = () => { open = true; };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    q.push(m);
    all.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) {
        waiters[i].resolve(m);
        waiters.splice(i, 1);
      }
    }
  };
  function waitFor(pred, timeout = 8000) {
    for (let i = 0; i < q.length; i++) if (pred(q[i])) return Promise.resolve(q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { clearTimeout(t); resolve(m); } };
      const t = setTimeout(() => {
        const idx = waiters.indexOf(w);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(tag + ': timeout waiting for message'));
      }, timeout);
      waiters.push(w);
    });
  }
  async function openWS() {
    const t0 = Date.now();
    while (!open && Date.now() - t0 < 4000) await sleep(20);
    if (!open) throw new Error(tag + ': ws did not open');
  }
  return { tag, ws, waitFor, openWS, all, send: (o) => ws.send(JSON.stringify(o)) };
}

(async () => {
  // ---- start server --------------------------------------------------------
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d.toString(); });
  srv.stderr.on('data', d => { srvOut += d.toString(); });
  await sleep(900);

  try {
    // ---- http ---------------------------------------------------------------
    const home = await fetch(BASE + '/');
    const homeTxt = await home.text();
    check('GET / serves the game', home.status === 200 && homeTxt.includes('SHADOW') && homeTxt.includes('client.js'));
    const sim = await fetch(BASE + '/sim.js');
    check('GET /sim.js served', sim.status === 200 && (await sim.text()).includes('createGame'));
    const css = await fetch(BASE + '/style.css');
    check('GET /style.css served', css.status === 200);
    const missing = await fetch(BASE + '/nope.js');
    check('404 for unknown file', missing.status === 404);

    // ---- create + join ------------------------------------------------------
    const A = mkClient('A');
    await A.openWS();
    A.send({ t: 'create', name: 'Ada' });
    const aw = await A.waitFor(m => m.t === 'w');
    check('create -> welcome with code/token', !!aw.code && aw.seat === 0 && !!aw.token, aw);
    check('welcome includes a valid arena', Maps.ids.indexOf(aw.map) !== -1, aw.map);
    await A.waitFor(m => m.t === 'wait');

    // host picks an arena while waiting
    A.send({ t: 'map', id: 'bamboo' });
    const mapMsg = await A.waitFor(m => m.t === 'map');
    check('host can pick the arena', mapMsg.id === 'bamboo');

    const B = mkClient('B');
    await B.openWS();
    B.send({ t: 'join', code: aw.code, name: 'Bob' });
    const bw = await B.waitFor(m => m.t === 'w');
    check('join -> seat 1', bw.seat === 1 && bw.code === aw.code);
    check('joiner receives the host\'s arena', bw.map === 'bamboo', bw.map);

    const aStart = await A.waitFor(m => m.t === 'start');
    const bStart = await B.waitFor(m => m.t === 'start');
    check('both got start with names', aStart.names[1] === 'BOB' && bStart.names[0] === 'ADA', [aStart.names, bStart.names]);
    check('match starts on the chosen arena', aStart.map === 'bamboo' && bStart.map === 'bamboo', [aStart.map, bStart.map]);

    const aState = await A.waitFor(m => m.t === 'st');
    check('state snapshots flowing', Array.isArray(aState.s.f) && aState.s.f.length === 2 && aState.s.ph === 'intro', aState.s.ph);

    // wait for FIGHT phase
    await A.waitFor(m => m.t === 'st' && m.s.ph === 'fight', 10000);
    check('fight phase reached online', true);

    // ---- A walks right and punches B ---------------------------------------
    let hit = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !hit) {
      const st = await A.waitFor(m => m.t === 'st', 4000);
      const me = st.s.f[0], foe = st.s.f[1];
      const dx = foe.x - me.x;
      let k = 0, p = 0;
      if (dx > 75) k = 2;                       // RIGHT
      else if (dx < 55) k = 1;                  // LEFT
      else p = 16;                              // PUNCH
      A.send({ t: 'i', k, p });
      if (foe.hp < 100) hit = true;
    }
    check('online hit registered (B lost hp)', hit);

    // arena is locked during a match, and only the host can change it anyway
    B.send({ t: 'map', id: 'aurora' });
    await sleep(600);
    check('guest cannot change the arena', !B.all.some(m => m.t === 'map' && m.id === 'aurora'));

    // ---- ping ---------------------------------------------------------------
    A.send({ t: 'ping', ts: Date.now() });
    const pong = await A.waitFor(m => m.t === 'pong');
    check('ping/pong works', typeof pong.ts === 'number');

    // ---- disconnect + reconnect with token ---------------------------------
    A.ws.close();
    const paused = await B.waitFor(m => m.t === 'paused', 6000);
    check('B is told the match paused', paused.t === 'paused');

    const A2 = mkClient('A2');
    await A2.openWS();
    A2.send({ t: 'join', code: aw.code, token: aw.token, name: 'Ada' });
    const aw2 = await A2.waitFor(m => m.t === 'w', 6000);
    check('rejoin accepted with token (same seat)', aw2.seat === 0 && aw2.code === aw.code);
    const resumed = await B.waitFor(m => m.t === 'resumed', 6000);
    check('B told match resumed', resumed.t === 'resumed');
    const stAfter = await A2.waitFor(m => m.t === 'st', 6000);
    check('snapshots resume after rejoin', !!stAfter.s);

    // ---- ghost takeover: B reloads the page and rejoins WITHOUT a token ----
    B.ws.close();
    await A2.waitFor(m => m.t === 'paused', 6000);
    const B2 = mkClient('B2');
    await B2.openWS();
    B2.send({ t: 'join', code: aw.code, name: 'Bob' });   // no token, same name
    const bw2 = await B2.waitFor(m => m.t === 'w', 6000);
    check('reloaded player takes back their seat by name', bw2.seat === 1, bw2.seat);
    await A2.waitFor(m => m.t === 'resumed', 6000);
    const st3 = await A2.waitFor(m => m.t === 'st', 6000);
    check('match running again after ghost takeover', !!st3.s);

    // ---- leave -> opponent notified ----------------------------------------
    B2.send({ t: 'leave' });
    const left = await A2.waitFor(m => m.t === 'left', 6000);
    check('leaving notifies the other player', left.t === 'left');

    // ---- full room rejection ------------------------------------------------
    const C = mkClient('C');
    await C.openWS();
    C.send({ t: 'create', name: 'Cy' });
    const cw = await C.waitFor(m => m.t === 'w');
    const D = mkClient('D'); await D.openWS();
    const E = mkClient('E'); await E.openWS();
    D.send({ t: 'join', code: cw.code, name: 'Dee' });
    await D.waitFor(m => m.t === 'w');
    E.send({ t: 'join', code: cw.code, name: 'Eve' });
    const err = await E.waitFor(m => m.t === 'err', 6000);
    check('third player rejected (room full)', /full/i.test(err.m), err.m);
    E.ws.close();

    // ---- server startup banner ----------------------------------------------
    check('server banner printed friend URL', /For your friend\s*:\s*http:\/\/\d/.test(srvOut), srvOut.slice(0, 400));
  } catch (e) {
    failures++;
    console.log('  FAIL exception:', e.message);
  } finally {
    srv.kill();
  }

  console.log(failures === 0 ? '\nALL NET TESTS PASSED' : '\n' + failures + ' NET TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})();
