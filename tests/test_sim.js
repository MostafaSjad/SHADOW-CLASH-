/* headless test for Sim: attacks, blocking, fireball, super, KO, rounds */
const path = require('path');
const Sim = require(path.join(__dirname, '..', 'public', 'sim.js'));
const B = Sim.BIT;
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : extra); }
}
function run(g, n, inputs) {
  for (let i = 0; i < n; i++) {
    if (inputs) {
      for (let p = 0; p < 2; p++) {
        const inp = inputs[p] ? inputs[p](i, g) : { k: 0, p: 0 };
        g.fighters[p].input = inp.k;
        g.fighters[p].pressed = inp.p;
      }
    }
    Sim.update(g);
  }
}

// ---- 1. basics: punch damages in range ------------------------------------
{
  const g = Sim.createGame();
  run(g, 130);                       // intro -> FIGHT
  check('fight phase reached', g.phase === 'fight', g.phase);
  // walk P1 to P2 and punch
  let done = false;
  for (let i = 0; i < 600 && !done; i++) {
    const dx = g.fighters[1].x - g.fighters[0].x;
    g.fighters[0].input = dx > 70 ? B.RIGHT : 0;
    g.fighters[0].pressed = (dx <= 70 && i % 20 === 0) ? B.PUNCH : 0;
    g.fighters[1].input = 0; g.fighters[1].pressed = 0;
    Sim.update(g);
    if (g.fighters[1].hp < 100) done = true;
  }
  check('punch dealt damage', done, 'p2 hp=' + g.fighters[1].hp);
  check('meter gained on hit', g.fighters[0].meter > 0, g.fighters[0].meter.toFixed(1));
}

// ---- 2. blocking ----------------------------------------------------------
{
  const g = Sim.createGame();
  run(g, 130);
  // bring P1 next to P2 first
  for (let i = 0; i < 300 && g.fighters[1].x - g.fighters[0].x > 70; i++) {
    g.fighters[0].input = B.RIGHT;
    Sim.update(g);
  }
  // P2 blocks forever, P1 punches a lot
  for (let i = 0; i < 300; i++) {
    g.fighters[0].pressed = i % 22 === 0 ? B.PUNCH : 0;
    g.fighters[0].input = 0;
    g.fighters[1].input = B.BLOCK;
    g.fighters[1].pressed = 0;
    Sim.update(g);
  }
  check('blocking prevented blockable damage', g.fighters[1].hp === 100, g.fighters[1].hp);
}

// ---- 3. fireball + chip through block -------------------------------------
{
  const g = Sim.createGame();
  run(g, 130);
  g.fighters[0].meter = 60;
  // press special
  g.fighters[0].pressed = B.SPECIAL;
  Sim.update(g);
  run(g, 20);   // special has 13 startup frames before the fireball leaves the hand
  check('fireball spawned', g.projectiles.length === 1, g.projectiles.length);
  // defender blocks; let projectile travel
  let hp0 = g.fighters[1].hp;
  run(g, 120, [null, () => ({ k: B.BLOCK, p: 0 })]);
  check('fireball chipped blocking defender', g.fighters[1].hp < hp0, g.fighters[1].hp);
  check('special cost 50 meter', g.fighters[0].meter < 60, g.fighters[0].meter);
}

// ---- 4. super beam --------------------------------------------------------
{
  const g = Sim.createGame();
  run(g, 130);
  g.fighters[0].meter = 100;
  g.fighters[0].pressed = B.SPECIAL;
  g.fighters[0].input = B.SPECIAL;
  Sim.update(g); Sim.update(g);
  check('super charge state', g.fighters[0].state === 'super', g.fighters[0].state);
  check('meter consumed (100)', g.fighters[0].meter < 5, g.fighters[0].meter);
  run(g, 50, [() => ({ k: B.SPECIAL, p: 0 }), null]);
  check('beam created', g.beams.length >= 1 || g.fighters[1].hp < 100, 'beams=' + g.beams.length + ' hp=' + g.fighters[1].hp);
  run(g, 40);
  check('beam damaged opponent', g.fighters[1].hp < 100, g.fighters[1].hp);
}

// ---- 5. KO + round flow ---------------------------------------------------
{
  const g = Sim.createGame();
  run(g, 130);
  // teleport close and kick until KO
  g.fighters[1].hp = 15;
  let roundsAdvanced = false, matchEnded = false;
  for (let i = 0; i < 4000; i++) {
    const dx = g.fighters[1].x - g.fighters[0].x;
    g.fighters[0].input = dx > 80 ? B.RIGHT : 0;
    g.fighters[0].pressed = (dx <= 100 && i % 25 === 0) ? B.KICK : 0;
    g.fighters[1].input = 0; g.fighters[1].pressed = 0;
    const before = g.round;
    Sim.update(g);
    if (g.round > before) roundsAdvanced = true;
    if (g.phase === 'matchEnd') { matchEnded = true; break; }
  }
  check('KO / round advanced or match ended', roundsAdvanced || matchEnded, 'phase=' + g.phase + ' wins=' + g.wins);
  check('match ended by wins', g.phase === 'matchEnd' && g.wins[0] === 2, JSON.stringify({ ph: g.phase, w: g.wins }));
  const snap = Sim.snapshot(g);
  check('snapshot is serializable', JSON.stringify(snap).length > 100);
}

// ---- 6. random fuzz (stability) -------------------------------------------
{
  const g = Sim.createGame();
  const bits = [0, 1, 2, 4, 8, 16, 32, 64, 128, 3, 17, 34, 96, 144];
  for (let i = 0; i < 60 * 60 * 3; i++) {   // 3 simulated minutes
    for (let p = 0; p < 2; p++) {
      const k = bits[Math.floor(Math.random() * bits.length)];
      g.fighters[p].input = k;
      g.fighters[p].pressed = Math.random() < 0.2 ? k : 0;
    }
    Sim.update(g);
    if (g.over) Sim.resetMatch(g);
  }
  check('fuzz ran with no exceptions', true);
  const snap = Sim.snapshot(g);
  check('state sane after fuzz',
    isFinite(snap.f[0].x) && isFinite(snap.f[1].hp) && snap.f[0].hp >= 0 && snap.f[0].hp <= 100,
    JSON.stringify({ x: snap.f[0].x, hp: snap.f[0].hp }));
}

// ---- 7. resetMatch ---------------------------------------------------------
{
  const g = Sim.createGame();
  run(g, 200);
  Sim.resetMatch(g);
  const s = Sim.snapshot(g);
  check('reset works', s.r === 1 && s.w[0] === 0 && s.f[0].hp === 100 && s.ph === 'intro');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures ? 1 : 0);
