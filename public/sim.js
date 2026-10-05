/* ============================================================================
   SHADOW CLASH — shared game simulation
   ----------------------------------------------------------------------------
   This single file runs in TWO places:
     * on the Node server  -> authoritative online matches (both browsers see
       the exact same world, no desync possible)
     * in the browser      -> "local 2P on one keyboard" mode + title screen
   It is deterministic and frame-based (60 fps). No dependencies.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var STAGE_W = 960;               // world width  (also canvas width)
  var GROUND_Y = 470;              // screen y of the floor (client uses it)
  var WALK = 3.1, JUMP_V = 14.4, GRAV = 0.68, MAX_FALL = 19;
  var HALF = 25;                   // fighter half width (push box)
  var MIN_X = 44, MAX_X = STAGE_W - 44;
  var ROUND_TIME = 60 * 60;        // 60 seconds in frames
  var WINS_NEEDED = 2, MAX_ROUNDS = 5;
  var SPECIAL_COST = 50, SUPER_COST = 100;
  var SUPER_CHARGE = 46, SUPER_FIRE = 26;
  var METER_REGEN = 0.03;

  var BIT = { LEFT: 1, RIGHT: 2, JUMP: 4, CROUCH: 8, PUNCH: 16, KICK: 32, BLOCK: 64, SPECIAL: 128 };

  // attack frame data. box = [xNear, xFar, yLow, yHigh] relative to fighter,
  // x is forward (facing), y is height above the floor.
  var ATTACKS = {
    punch: {
      name: 'punch', startup: 3, active: 4, recovery: 8, dmg: 6,
      box: [28, 78, 58, 98], hitstun: 15, blockstun: 8, push: 2.4,
      chip: 0, meter: 6, swing: 'punch', lunge: 0.6
    },
    cpunch: {
      name: 'cpunch', startup: 3, active: 4, recovery: 8, dmg: 6,
      box: [26, 74, 38, 72], hitstun: 15, blockstun: 8, push: 2.2,
      chip: 0, meter: 6, swing: 'punch', lunge: 0.4
    },
    kick: {
      name: 'kick', startup: 8, active: 5, recovery: 15, dmg: 10,
      box: [24, 98, 32, 80], hitstun: 19, blockstun: 10, push: 3.6,
      chip: 0, meter: 8, swing: 'kick', lunge: 2.0
    },
    low: {
      name: 'low', startup: 6, active: 4, recovery: 14, dmg: 8,
      box: [22, 96, 4, 44], hitstun: 18, blockstun: 9, push: 3.0,
      chip: 0, meter: 7, swing: 'low', lunge: 1.4
    },
    air: {
      name: 'air', startup: 4, active: 9, recovery: 8, dmg: 9,
      box: [10, 70, -30, 30], hitstun: 17, blockstun: 9, push: 2.8,
      chip: 0, meter: 7, swing: 'air', air: true
    },
    special: {
      name: 'special', startup: 13, active: 1, recovery: 20, dmg: 0,
      box: null, spawnAt: 13, meter: 0, swing: 'special', cost: SPECIAL_COST,
      proj: { dmg: 10, chip: 2, hitstun: 22, blockstun: 12, push: 3.6, speed: 8.6 }
    },
    super: { name: 'super', cost: SUPER_COST }
  };

  // ------------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function aabb(a, b) { return a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2]; }
  function comboScale(n) { return Math.max(0.3, 1 - n * 0.09); }
  function setState(f, s) { if (f.state !== s) { f.state = s; f.sf = 0; } }
  function fxPush(g, e, x, y, p) { g.fx.push({ e: e, x: Math.round(x), y: Math.round(y), p: p }); }

  function mkFighter(i) {
    return {
      i: i,
      x: i === 0 ? 300 : 660, y: 0, vx: 0, vy: 0,
      facing: i === 0 ? 1 : -1,
      hp: 100, meter: 0,
      state: 'idle', sf: 0,
      air: false, crouch: false, blocking: false,
      atk: null, atkFrame: 0, atkHit: false, usedAir: false,
      hitstun: 0, blockstun: 0, ko: false, flash: 0,
      combo: 0, comboT: 0, superT: -1,
      input: 0, pressed: 0
    };
  }

  function createGame() {
    return {
      frame: 0,
      phase: 'intro', phaseT: 110,
      round: 1, wins: [0, 0], timer: ROUND_TIME,
      fighters: [mkFighter(0), mkFighter(1)],
      projectiles: [], beams: [], fx: [],
      hitstop: 0, shake: 0,
      banner: { text: 'ROUND 1', kind: 'round', t: 0 },
      winner: -1, over: false, paused: false
    };
  }

  function startRound(g, n) {
    g.round = n;
    g.phase = 'intro';
    g.phaseT = 110;
    g.timer = ROUND_TIME;
    g.projectiles = [];
    g.beams = [];
    g.hitstop = 0;
    for (var i = 0; i < 2; i++) {
      var f = g.fighters[i];
      f.x = i === 0 ? 300 : 660;
      f.y = 0; f.vx = 0; f.vy = 0;
      f.facing = i === 0 ? 1 : -1;
      f.hp = 100;
      f.state = 'idle'; f.sf = 0;
      f.air = false; f.crouch = false; f.blocking = false;
      f.atk = null; f.atkFrame = 0; f.atkHit = false; f.usedAir = false;
      f.hitstun = 0; f.blockstun = 0; f.ko = false; f.flash = 0;
      f.combo = 0; f.comboT = 0; f.superT = -1;
    }
    g.banner = { text: 'ROUND ' + n, kind: 'round', t: 0 };
    fxPush(g, 'bell', 480, 200);
  }

  function resetMatch(g) {
    g.wins = [0, 0];
    g.winner = -1;
    g.over = false;
    g.paused = false;
    g.fx = [];
    startRound(g, 1);
  }

  // ------------------------------------------------------------------- physics
  function physics(g, f) {
    f.x += f.vx;
    if (f.y > 0 || f.vy !== 0) {
      f.vy -= GRAV;
      if (f.vy < -MAX_FALL) f.vy = -MAX_FALL;
      f.y += f.vy;
    }
    if (f.y <= 0) {
      var wasAir = f.air || f.vy < 0;
      if (f.vy < -4 && wasAir) fxPush(g, 'land', f.x, 0);
      f.y = 0;
      f.vy = 0;
      f.air = false;
      f.usedAir = false;
      f.vx *= (f.blocking || f.crouch) ? 0.7 : 0.8;
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
    } else {
      f.air = true;
    }
    f.x = clamp(f.x, MIN_X, MAX_X);
  }

  // ------------------------------------------------------------------- combat
  function hurtbox(f) {
    var h = f.crouch ? 74 : 114;
    var lo = f.crouch ? 4 : 0;
    return [f.x - HALF, f.x + HALF, f.y + lo, f.y + h];
  }

  function worldBox(f, b) {
    if (f.facing > 0) return [f.x + b[0], f.x + b[1], f.y + b[2], f.y + b[3]];
    return [f.x - b[1], f.x - b[0], f.y + b[2], f.y + b[3]];
  }

  function damage(g, def, amount) {
    def.hp = Math.max(0, def.hp - amount);
    def.flash = 8;
  }

  function ko(g, loser, winner) {
    loser.hp = 0;
    loser.ko = true;
    loser.state = 'ko';
    loser.sf = 0;
    loser.vy = 9;
    loser.y = Math.max(loser.y, 0.1);
    loser.vx = (winner && loser.x >= winner.x ? 1 : -1) * 6.5;
    loser.hitstun = 9999;
    if (winner) g.wins[winner.i]++;
    g.phase = 'roundEnd';
    g.phaseT = 210;
    g.banner = { text: 'K.O.', kind: 'ko', t: 0 };
    g.hitstop = 14;
    g.shake = 30;
    fxPush(g, 'ko', loser.x, loser.y + 60);
    fxPush(g, 'bell', 480, 200);
  }

  // resolves one attack instance against the defender. returns true on contact
  function resolve(g, atkr, def, a, box) {
    var dir = atkr.facing;
    var hx = (box[0] + box[1]) / 2;
    var hy = (box[2] + box[3]) / 2;

    // SUPER ARMOR — a fighter charging/firing a super can't be stunned
    if (def.superT >= 0) {
      damage(g, def, a.dmg * 0.6);
      atkr.meter = Math.min(100, atkr.meter + (a.meter || 5) * 0.5);
      fxPush(g, 'armor', hx, hy);
      g.hitstop = 3;
      if (def.hp <= 0 && g.phase === 'fight') ko(g, def, atkr);
      return true;
    }

    var blocked = def.blocking && def.blockstun <= 0;
    if (blocked) {
      if (a.chip) damage(g, def, a.chip);
      def.blockstun = a.blockstun;
      def.state = 'block'; def.sf = 0;
      def.vx = dir * a.push * 0.6;
      atkr.meter = Math.min(100, atkr.meter + (a.meter || 4) * 0.4);
      def.meter = Math.min(100, def.meter + 2);
      g.hitstop = 3;
      fxPush(g, 'block', hx, hy, 1);
    } else {
      var scale = comboScale(atkr.combo);
      damage(g, def, a.dmg * scale);
      if (def.atk) def.atk = null;
      def.hitstun = a.hitstun;
      def.blockstun = 0;
      def.state = 'hit'; def.sf = 0;
      def.vx = dir * a.push;
      if (a.launch) {
        def.vy = a.launch;
        def.y = Math.max(def.y, 0.1);
      }
      atkr.combo++;
      atkr.comboT = 55;
      if (atkr.combo > 1) fxPush(g, 'combo', atkr.x, 128, atkr.combo);
      atkr.meter = Math.min(100, atkr.meter + (a.meter || 5));
      def.meter = Math.min(100, def.meter + (a.meter || 5) * 0.6);
      g.hitstop = a.dmg >= 24 ? 10 : (a.dmg >= 9 ? 6 : 4);
      g.shake = Math.min(26, 3 + a.dmg * 0.8);
      fxPush(g, 'hit', hx, hy, a.dmg);
    }
    if (def.hp <= 0 && !def.ko && g.phase === 'fight') ko(g, def, atkr);
    return true;
  }

  // ----------------------------------------------------------------- actions
  function startAttack(g, f, a) {
    f.atk = a;
    f.atkFrame = 0;
    f.atkHit = false;
    setState(f, 'attack');
    if (a.lunge) f.vx = f.facing * a.lunge;
  }

  function stepAttack(g, f) {
    var a = f.atk;
    f.atkFrame++;
    var total = a.startup + a.active + a.recovery;

    if (f.atkFrame === 1 && a.air !== true) {
      fxPush(g, 'swing', f.x + f.facing * 46, f.y + (f.crouch ? 52 : 74), a.swing);
    }
    if (a.spawnAt && f.atkFrame === a.spawnAt) {
      var p = a.proj;
      g.projectiles.push({
        owner: f.i, dir: f.facing,
        x: f.x + f.facing * 48, y: 56,
        vx: f.facing * p.speed, w: 42, h: 30,
        dmg: p.dmg, chip: p.chip, hitstun: p.hitstun, blockstun: p.blockstun,
        push: p.push, meter: 4, t: 0
      });
      fxPush(g, 'fire', f.x + f.facing * 48, 74);
    }
    if (a.lunge) f.vx *= 0.88;

    if (a.air && f.y <= 0.5) f.atkFrame = total;   // landing cancels air attack
    if (f.atkFrame >= total) {
      f.atk = null;
      f.atkFrame = 0;
      setState(f, f.y > 0.5 ? 'air' : 'idle');
    }
  }

  function stepSuper(g, f) {
    f.superT++;
    f.vx *= 0.72;
    if (f.superT < SUPER_CHARGE) {
      if (f.superT % 5 === 0) fxPush(g, 'spark', f.x + (Math.random() * 70 - 35), f.y + Math.random() * 100);
    } else if (f.superT === SUPER_CHARGE) {
      g.beams.push({
        owner: f.i, dir: f.facing, t: 0, life: SUPER_FIRE,
        hit: false, dmg: 32, chip: 6, hitstun: 34, blockstun: 18, push: 9,
        x: f.x, y: 10, h: 98
      });
      fxPush(g, 'beam', f.x + f.facing * 30, 70, f.facing);
      g.shake = 26;
      g.hitstop = 6;
    } else if (f.superT >= SUPER_CHARGE + SUPER_FIRE) {
      f.superT = -1;
      setState(f, 'idle');
    }
  }

  function stepFighter(g, f, ctrl, opp) {
    var inp = ctrl ? f.input : 0;
    var pressed = ctrl ? f.pressed : 0;
    f.pressed = 0;

    if (f.flash > 0) f.flash--;
    f.sf++;

    // winner celebration pose
    if (g.phase === 'matchEnd' && g.winner === f.i && !f.ko) {
      setState(f, 'win');
      f.vx *= 0.8;
      physics(g, f);
      return;
    }

    if (f.ko) { physics(g, f); return; }

    if (f.superT >= 0) { stepSuper(g, f); physics(g, f); return; }

    if (f.hitstun > 0) {
      f.hitstun--;
      physics(g, f);
      if (f.hitstun === 0) setState(f, f.y > 0.5 ? 'air' : 'idle');
      return;
    }
    if (f.blockstun > 0) {
      f.blockstun--;
      physics(g, f);
      if (f.blockstun === 0) setState(f, 'idle');
      return;
    }
    if (f.atk) { stepAttack(g, f); physics(g, f); return; }

    var onGround = f.y <= 0.5;
    if (onGround) {
      f.air = false;
      f.facing = opp.x >= f.x ? 1 : -1;
      f.crouch = !!(inp & BIT.CROUCH);
      f.blocking = !!(inp & BIT.BLOCK);

      if (pressed & BIT.JUMP) {
        f.vy = JUMP_V;
        f.y = 0.1;
        f.air = true;
        f.usedAir = false;
        setState(f, 'air');
        fxPush(g, 'jump', f.x, 0);
        physics(g, f);
        return;
      }
      if (pressed & BIT.SPECIAL) {
        if (f.meter >= SUPER_COST) {
          f.meter -= SUPER_COST;
          f.superT = 0;
          setState(f, 'super');
          fxPush(g, 'charge', f.x, f.y + 60);
          physics(g, f);
          return;
        } else if (f.meter >= SPECIAL_COST) {
          f.meter -= SPECIAL_COST;
          startAttack(g, f, ATTACKS.special);
          physics(g, f);
          return;
        } else {
          f.flash = 10;   // not enough meter: little red blink
        }
      }
      if ((pressed & BIT.PUNCH) && (pressed & BIT.KICK) && f.meter >= SUPER_COST) {
        f.meter -= SUPER_COST;
        f.superT = 0;
        setState(f, 'super');
        fxPush(g, 'charge', f.x, f.y + 60);
        physics(g, f);
        return;
      }
      if (pressed & BIT.PUNCH) { startAttack(g, f, f.crouch ? ATTACKS.cpunch : ATTACKS.punch); physics(g, f); return; }
      if (pressed & BIT.KICK) { startAttack(g, f, f.crouch ? ATTACKS.low : ATTACKS.kick); physics(g, f); return; }

      if (f.blocking || f.crouch) {
        setState(f, f.crouch ? 'crouch' : 'block');
        f.vx *= 0.7;
      } else {
        var mv = ((inp & BIT.RIGHT) ? 1 : 0) - ((inp & BIT.LEFT) ? 1 : 0);
        if (mv !== 0) { f.vx = mv * WALK; setState(f, 'walk'); }
        else { f.vx *= 0.75; setState(f, 'idle'); }
      }
    } else {
      f.air = true;
      f.blocking = false;
      f.crouch = false;
      if (!f.usedAir && (pressed & (BIT.PUNCH | BIT.KICK))) {
        f.usedAir = true;
        startAttack(g, f, ATTACKS.air);
      } else {
        setState(f, 'air');
      }
      var mv2 = ((inp & BIT.RIGHT) ? 1 : 0) - ((inp & BIT.LEFT) ? 1 : 0);
      if (mv2) f.vx += mv2 * 0.14;
      f.vx = clamp(f.vx, -WALK * 1.5, WALK * 1.5);
    }
    physics(g, f);
  }

  // ------------------------------------------------------------------ bodies
  function separate(g, a, b) {
    if (a.ko && b.ko) return;
    var minD = HALF * 2 - 6;
    var d = b.x - a.x;
    var ad = Math.abs(d);
    if (ad >= minD) return;
    var push = (minD - ad) / 2;
    var s = d >= 0 ? 1 : -1;
    var pa = push, pb = push;
    if (a.air && !b.air) { pa = push * 1.8; pb = push * 0.2; }
    else if (b.air && !a.air) { pb = push * 1.8; pa = push * 0.2; }
    a.x = clamp(a.x - s * pa, MIN_X, MAX_X);
    b.x = clamp(b.x + s * pb, MIN_X, MAX_X);
  }

  function stepProjectiles(g) {
    var i, j;
    for (i = g.projectiles.length - 1; i >= 0; i--) {
      var p = g.projectiles[i];
      p.t++;
      p.x += p.vx;

      if (p.t % 3 === 0) fxPush(g, 'trail', p.x, p.y + 14);

      var def = g.fighters[1 - p.owner];
      if (!def.ko) {
        var box = [p.x - p.w / 2, p.x + p.w / 2, p.y, p.y + p.h];
        if (aabb(box, hurtbox(def))) {
          resolve(g, g.fighters[p.owner], def, {
            dmg: p.dmg, chip: p.chip, hitstun: p.hitstun, blockstun: p.blockstun,
            push: p.push, meter: p.meter, swing: 'special'
          }, box);
          g.projectiles.splice(i, 1);
          continue;
        }
      }

      // fireball vs fireball
      for (j = i - 1; j >= 0; j--) {
        var q = g.projectiles[j];
        if (q.owner !== p.owner &&
            Math.abs(q.x - p.x) < (q.w + p.w) / 2 && Math.abs(q.y - p.y) < (q.h + p.h) / 2) {
          fxPush(g, 'clash', (p.x + q.x) / 2, (p.y + q.y) / 2 + 14);
          g.projectiles.splice(i, 1);
          g.projectiles.splice(j, 1);
          i--;
          break;
        }
      }
      if (p.x < -80 || p.x > STAGE_W + 80) g.projectiles.splice(i, 1);
    }
  }

  function stepBeams(g) {
    for (var i = g.beams.length - 1; i >= 0; i--) {
      var b = g.beams[i];
      b.t++;
      var own = g.fighters[b.owner];
      b.x = own.x;
      if (!b.hit && b.t > 2) {
        var def = g.fighters[1 - b.owner];
        if (!def.ko) {
          var x1 = b.dir > 0 ? b.x + 6 : 0;
          var x2 = b.dir > 0 ? STAGE_W : b.x - 6;
          var box = [Math.min(x1, x2), Math.max(x1, x2), b.y, b.y + b.h];
          if (aabb(box, hurtbox(def))) {
            b.hit = true;
            resolve(g, own, def, b, box);
            g.shake = 26;
          }
        }
      }
      if (b.t >= b.life) g.beams.splice(i, 1);
    }
  }

  function timeUp(g) {
    var a = g.fighters[0].hp, b = g.fighters[1].hp;
    g.phase = 'roundEnd';
    g.phaseT = 190;
    if (a > b + 0.5) {
      g.wins[0]++;
      g.banner = { text: 'TIME UP', kind: 'time', sub: 'PLAYER 1 TAKES THE ROUND', t: 0 };
    } else if (b > a + 0.5) {
      g.wins[1]++;
      g.banner = { text: 'TIME UP', kind: 'time', sub: 'PLAYER 2 TAKES THE ROUND', t: 0 };
    } else {
      g.banner = { text: 'TIME UP', kind: 'time', sub: 'DRAW', t: 0 };
    }
    fxPush(g, 'bell', 480, 200);
  }

  function nextRoundOrMatch(g) {
    var done = g.wins[0] >= WINS_NEEDED || g.wins[1] >= WINS_NEEDED || g.round >= MAX_ROUNDS;
    if (!done) { startRound(g, g.round + 1); return; }
    g.phase = 'matchEnd';
    g.over = true;
    var w0 = g.wins[0], w1 = g.wins[1];
    g.winner = w0 > w1 ? 0 : w1 > w0 ? 1 : -1;
    if (g.winner >= 0) {
      g.banner = { text: 'PLAYER ' + (g.winner + 1) + ' WINS!', kind: 'win', sub: 'first to ' + WINS_NEEDED + ' rounds', t: 0 };
      g.fighters[g.winner].flash = 0;
    } else {
      g.banner = { text: 'DRAW GAME', kind: 'win', sub: '', t: 0 };
    }
    fxPush(g, 'bell', 480, 200);
  }

  // ------------------------------------------------------------------- update
  function update(g) {
    if (g.paused) return;
    g.frame++;
    if (g.banner) g.banner.t++;

    if (g.hitstop > 0) {
      g.hitstop--;
      for (var h = 0; h < 2; h++) if (g.fighters[h].flash > 0) g.fighters[h].flash--;
      return;
    }
    g.shake *= 0.86;
    if (g.shake < 0.3) g.shake = 0;

    if (g.phase === 'intro') {
      g.phaseT--;
      if (g.phaseT <= 0) {
        g.phase = 'fight';
        g.banner = { text: 'FIGHT!', kind: 'fight', t: 0 };
        fxPush(g, 'bell', 480, 200);
      }
    } else if (g.phase === 'fight') {
      g.timer--;
      if (g.timer <= 0) timeUp(g);
    } else if (g.phase === 'roundEnd') {
      g.phaseT--;
      if (g.phaseT <= 0) nextRoundOrMatch(g);
    }

    var ctrl = g.phase === 'fight';
    var f0 = g.fighters[0], f1 = g.fighters[1];

    if (ctrl) {
      for (var i = 0; i < 2; i++) {
        var f = g.fighters[i];
        f.meter = Math.min(100, f.meter + METER_REGEN);
        if (f.comboT > 0) { f.comboT--; if (f.comboT === 0) f.combo = 0; }
      }
    }

    stepFighter(g, f0, ctrl, f1);
    stepFighter(g, f1, ctrl, f0);
    separate(g, f0, f1);

    // melee collisions
    for (var k = 0; k < 2; k++) {
      var atk = g.fighters[k];
      var a = atk.atk;
      if (a && !atk.atkHit && a.box &&
          atk.atkFrame > a.startup && atk.atkFrame <= a.startup + a.active) {
        applyMelee(g, atk, a);
      }
    }

    stepProjectiles(g);
    stepBeams(g);
  }

  function applyMelee(g, atk, a) {
    var def = g.fighters[1 - atk.i];
    if (def.ko) return;
    var box = worldBox(atk, a.box);
    if (aabb(box, hurtbox(def))) {
      atk.atkHit = true;
      resolve(g, atk, def, a, box);
    }
  }

  // ----------------------------------------------------------------- snapshot
  function snapshot(g) {
    var s = {
      t: g.frame,
      ph: g.phase,
      pt: g.phaseT,
      r: g.round,
      w: [g.wins[0], g.wins[1]],
      tm: Math.max(0, Math.ceil(g.timer / 60)),
      hs: g.hitstop,
      pa: !!g.paused,
      ov: !!g.over,
      wi: g.winner,
      bn: g.banner ? { x: g.banner.text, s: g.banner.sub || '', k: g.banner.kind, t: g.banner.t } : null,
      f: [],
      pj: [],
      bm: [],
      fx: g.fx
    };
    for (var i = 0; i < 2; i++) {
      var f = g.fighters[i];
      s.f.push({
        x: r1(f.x), y: r1(f.y), fc: f.facing,
        hp: Math.round(f.hp * 10) / 10, mt: Math.round(f.meter),
        st: f.state, sf: f.sf,
        at: f.atk ? f.atk.name : null,
        af: f.atk ? f.atkFrame : -1,
        cr: f.crouch ? 1 : 0, bl: f.blocking ? 1 : 0, ar: f.air ? 1 : 0,
        cb: f.combo, su: f.superT, ko: f.ko ? 1 : 0, fl: f.flash
      });
    }
    for (var j = 0; j < g.projectiles.length; j++) {
      var p = g.projectiles[j];
      s.pj.push({ x: r1(p.x), y: r1(p.y), d: p.dir, o: p.owner, t: p.t });
    }
    for (var k = 0; k < g.beams.length; k++) {
      var b = g.beams[k];
      s.bm.push({ x: r1(b.x), d: b.dir, t: b.t, o: b.owner, l: b.life });
    }
    return s;
  }

  return {
    STAGE_W: STAGE_W, GROUND_Y: GROUND_Y, BIT: BIT, ATTACKS: ATTACKS,
    createGame: createGame, update: update, snapshot: snapshot,
    resetMatch: resetMatch, startRound: startRound,
    SUPER_COST: SUPER_COST, SPECIAL_COST: SPECIAL_COST
  };
});
