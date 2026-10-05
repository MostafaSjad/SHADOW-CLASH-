/* ============================================================================
   SHADOW CLASH — browser client
   rendering + game feel + networking + local 2P mode. No dependencies.
   ========================================================================= */
'use strict';
(function () {

  // ---------------------------------------------------------------- helpers
  var $ = function (id) { return document.getElementById(id); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  var VW = 960, VH = 540, GY = Sim.GROUND_Y;

  // ---------------------------------------------------------------- canvas
  var cv = $('cv');
  var ctx = cv.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  function fitCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(VW * DPR);
    cv.height = Math.round(VH * DPR);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---------------------------------------------------------------- state
  var state = {
    mode: 'menu',              // menu | wait | net | local
    view: null,                // snapshot used for rendering
    map: null,                 // current arena id (see maps.js)
    local: { game: null, map: null },
    net: {
      ws: null, open: false, seat: 0, code: null, token: null, name: '',
      buf: [], latest: null, ping: 0, paused: false, voted: false, oppVoted: false,
      reconnectTries: 0, wantReconnect: false, started: false
    },
    attract: { game: null, endT: 0, bots: null },
    ghost: [100, 100],
    fx: { parts: [], texts: [], shake: 0, flash: 0 },
    ui: { lastBannerKey: '', lastCombo: [0, 0], hintT: 0, strips: [], lastMap: '' }
  };

  var fExtras = [
    { walk: 0, lastX: null },
    { walk: 0, lastX: null }
  ];

  // ========================================================================
  //  AUDIO — everything is synthesized, no files needed
  // ========================================================================
  var AC = null, master = null, sfxBus = null, musicBus = null, muted = false;
  var musicTimer = null, musicStep = 0;

  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = new Ctx();
      master = AC.createGain(); master.gain.value = muted ? 0 : 0.85;
      master.connect(AC.destination);
      sfxBus = AC.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
      musicBus = AC.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
      musicStart();
    } catch (e) { AC = null; }
  }

  function tone(o) {
    if (!AC) return;
    var t0 = AC.currentTime + (o.delay || 0);
    var dur = o.dur || 0.1;
    var osc = AC.createOscillator(), g = AC.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.06);
  }

  function noise(o) {
    if (!AC) return;
    var t0 = AC.currentTime + (o.delay || 0);
    var dur = o.dur || 0.1;
    var len = Math.max(1, Math.floor(AC.sampleRate * dur));
    var buf = AC.createBuffer(1, len, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = AC.createBufferSource(); src.buffer = buf;
    var flt = AC.createBiquadFilter();
    flt.type = o.hp ? 'highpass' : 'lowpass';
    flt.frequency.setValueAtTime(Math.max(20, o.f0 || 2400), t0);
    if (o.f1) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
    flt.Q.value = o.q || 0.8;
    var g = AC.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, o.vol), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(o.bus || sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  function sHit(p) {
    var k = clamp(p / 30, 0, 1);
    noise({ dur: 0.09, vol: 0.22 + k * 0.3, f0: 1400, f1: 120 });
    tone({ type: 'sine', f0: 160 + k * 40, f1: 42, dur: 0.14, vol: 0.4 + k * 0.3 });
  }
  function sBlock() {
    tone({ type: 'square', f0: 700, f1: 420, dur: 0.05, vol: 0.1 });
    noise({ dur: 0.04, vol: 0.16, f0: 4200, f1: 2500, hp: true });
  }
  function sSwing() { noise({ dur: 0.09, vol: 0.1, f0: 2600, f1: 500, hp: true }); }
  function sJump() { tone({ type: 'sine', f0: 260, f1: 520, dur: 0.1, vol: 0.09 }); }
  function sLand() { noise({ dur: 0.07, vol: 0.1, f0: 420, f1: 120 }); }
  function sFire() {
    tone({ type: 'sawtooth', f0: 130, f1: 620, dur: 0.28, vol: 0.18 });
    noise({ dur: 0.3, vol: 0.14, f0: 3000, f1: 200, hp: true });
  }
  function sBeam() {
    tone({ type: 'sawtooth', f0: 64, f1: 36, dur: 0.9, vol: 0.4 });
    tone({ type: 'square', f0: 900, f1: 1400, dur: 0.25, vol: 0.08 });
    noise({ dur: 0.9, vol: 0.3, f0: 5000, f1: 180 });
  }
  function sCharge() {
    tone({ type: 'sine', f0: 80, f1: 560, dur: 0.72, vol: 0.2 });
    tone({ type: 'sawtooth', f0: 42, f1: 130, dur: 0.72, vol: 0.12 });
  }
  function sKO() {
    tone({ type: 'sine', f0: 130, f1: 28, dur: 0.75, vol: 0.6 });
    noise({ dur: 0.55, vol: 0.35, f0: 2800, f1: 90 });
  }
  function sBell() {
    tone({ type: 'triangle', f0: 880, f1: 870, dur: 0.5, vol: 0.22 });
    tone({ type: 'triangle', f0: 1320, f1: 1310, dur: 0.4, vol: 0.12, delay: 0.02 });
  }
  function sClash() {
    noise({ dur: 0.16, vol: 0.3, f0: 3200, f1: 700, hp: true });
    tone({ type: 'square', f0: 420, f1: 90, dur: 0.16, vol: 0.15 });
  }

  function musicStart() {
    if (musicTimer || !AC) return;
    var stepDur = 60 / 116 / 2;      // 8th notes at 116 bpm
    var next = AC.currentTime + 0.1;
    var roots = [110, 87.31, 130.81, 98];        // A  F  C  G
    var thirds = [130.81, 104.65, 164.81, 123.47];
    var fifths = [164.81, 130.81, 196, 146.83];
    musicTimer = setInterval(function () {
      if (!AC) return;
      // while muted just keep the beat moving forward without scheduling
      if (muted) { next = Math.max(next, AC.currentTime + 0.1); return; }
      // never try to catch up a huge backlog (e.g. after unmuting)
      if (next < AC.currentTime - 0.25) next = AC.currentTime + 0.05;
      while (next < AC.currentTime + 0.3) {
        var bar = Math.floor(musicStep / 8) % 4;
        var s = musicStep % 8;
        var delay = Math.max(0, next - AC.currentTime);
        if (s === 0 || s === 4) {
          tone({ type: 'triangle', f0: roots[bar] / 2, dur: stepDur * 1.7, vol: 0.5, bus: musicBus, delay: delay });
        }
        var notes = [roots[bar], thirds[bar], fifths[bar], thirds[bar]];
        var note = notes[s % 4] * (s >= 4 ? 2 : 1);
        tone({ type: 'square', f0: note, dur: stepDur * 0.62, vol: 0.09, bus: musicBus, delay: delay });
        if (s % 2 === 1) noise({ dur: 0.03, vol: 0.1, f0: 9000, f1: 6000, hp: true, bus: musicBus, delay: delay });
        next += stepDur;
        musicStep++;
      }
    }, 90);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.85;
    toast(muted ? 'sound off' : 'sound on');
  }

  // ========================================================================
  //  INPUT
  // ========================================================================
  var BIT = Sim.BIT;
  var NETMAP = {
    KeyA: 'left', KeyD: 'right', KeyW: 'jump', KeyS: 'crouch',
    KeyJ: 'punch', KeyK: 'kick', KeyL: 'block', KeyI: 'special', Space: 'special',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'crouch'
  };
  var P1MAP = {
    KeyA: 'left', KeyD: 'right', KeyW: 'jump', KeyS: 'crouch',
    KeyJ: 'punch', KeyK: 'kick', KeyL: 'block', KeyI: 'special', Space: 'special'
  };
  var P2MAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'crouch',
    Comma: 'punch', Period: 'kick', Slash: 'block', Semicolon: 'special',
    Numpad1: 'punch', Numpad2: 'kick', Numpad3: 'block', Numpad5: 'special', Numpad0: 'special'
  };
  var held = {};                 // 'p1:punch' etc, or plain action in net mode
  var press1 = 0, press2 = 0, pressNet = 0;

  function bitsFrom(prefix) {
    var b = 0;
    if (held[prefix + 'left']) b |= BIT.LEFT;
    if (held[prefix + 'right']) b |= BIT.RIGHT;
    if (held[prefix + 'jump']) b |= BIT.JUMP;
    if (held[prefix + 'crouch']) b |= BIT.CROUCH;
    if (held[prefix + 'punch']) b |= BIT.PUNCH;
    if (held[prefix + 'kick']) b |= BIT.KICK;
    if (held[prefix + 'block']) b |= BIT.BLOCK;
    if (held[prefix + 'special']) b |= BIT.SPECIAL;
    return b;
  }
  function actionBit(a) { return BIT[a.toUpperCase()] || 0; }

  function isTyping(e) {
    var t = e && e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
  }

  window.addEventListener('keydown', function (e) {
    // typing in a text field? let the field have the keystrokes
    if (isTyping(e)) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        var typed = (($('codeInput').value) || '').trim();
        if (typed.length >= 4) $('joinBtn').click();
        else $('createBtn').click();
      } else if (e.code === 'Escape') {
        if (e.target && e.target.blur) e.target.blur();
      }
      return;
    }

    if (e.code === 'KeyM') { audioInit(); toggleMute(); return; }
    if (e.code === 'KeyH') { $('hint').classList.toggle('fade'); return; }
    if (e.code === 'Escape' && state.mode === 'local') { goMenu(); return; }

    var used = false;
    if (state.mode === 'local') {
      if (P1MAP[e.code]) { used = true; var a = 'p1:' + P1MAP[e.code]; if (!e.repeat && !held[a]) press1 |= actionBit(P1MAP[e.code]); held[a] = true; }
      if (P2MAP[e.code]) { used = true; var b = 'p2:' + P2MAP[e.code]; if (!e.repeat && !held[b]) press2 |= actionBit(P2MAP[e.code]); held[b] = true; }
    } else if (NETMAP[e.code]) {
      used = true; var act = NETMAP[e.code];
      if (!e.repeat && !held[act]) pressNet |= actionBit(act);
      held[act] = true;
    }
    if (used) {
      e.preventDefault();
      audioInit();
      if (state.mode === 'net' || state.mode === 'menu' || state.mode === 'wait') hideHintSoon();
    }
  }, { passive: false });

  window.addEventListener('keyup', function (e) {
    if (isTyping(e)) return;
    if (state.mode === 'local') {
      if (P1MAP[e.code]) { held['p1:' + P1MAP[e.code]] = false; e.preventDefault(); }
      if (P2MAP[e.code]) { held['p2:' + P2MAP[e.code]] = false; e.preventDefault(); }
    } else if (NETMAP[e.code]) {
      held[NETMAP[e.code]] = false; e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('blur', function () { held = {}; });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) held = {};
  });

  var hintTimer = null;
  function hideHintSoon() {
    if (hintTimer) return;
    hintTimer = setTimeout(function () { $('hint').classList.add('fade'); }, 7000);
  }

  // ========================================================================
  //  PARTICLES / EFFECTS
  // ========================================================================
  var parts = state.fx.parts, texts = state.fx.texts;

  function spawnPart(p) {
    if (parts.length > 700) return;
    p.life = p.life || 30; p.max = p.life;
    p.vx = p.vx || 0; p.vy = p.vy || 0; p.g = p.g || 0;
    p.size = p.size || 3; p.add = p.add !== false;
    parts.push(p);
  }

  function burst(x, y, n, color, speed, life, size) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = rnd(speed * 0.3, speed);
      spawnPart({
        type: 'spark', x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
        g: 0.12, life: rnd(life * 0.5, life), color: color, size: rnd(size * 0.5, size)
      });
    }
  }

  function ring(x, y, color, maxR, life, width) {
    spawnPart({ type: 'ring', x: x, y: y, r: 4, maxR: maxR, life: life, max: life, color: color, size: width || 3 });
  }

  function dust(x, y, n, dir) {
    for (var i = 0; i < n; i++) {
      spawnPart({
        type: 'dust', x: x + rnd(-14, 14), y: y + rnd(-4, 2),
        vx: rnd(-1.6, 1.6) + (dir || 0), vy: rnd(-1.8, -0.4),
        g: 0.03, life: rnd(16, 30), size: rnd(3, 8), color: 'rgba(200,190,180,0.5)'
      });
    }
  }

  function floatText(x, y, txt, color, size) {
    if (texts.length > 24) texts.shift();
    texts.push({ x: x, y: y, txt: txt, color: color || '#fff', size: size || 20, life: 46, vy: -1.1 });
  }

  function consumeFx(fx) {
    if (!fx || !fx.length) return;
    for (var i = 0; i < fx.length; i++) {
      var e = fx[i];
      switch (e.e) {
        case 'hit':
          burst(e.x, e.y, Math.round(6 + e.p), '#ffe9a3', 5 + e.p * 0.3, 22, 4);
          burst(e.x, e.y, 5, '#ffffff', 7, 14, 3);
          ring(e.x, e.y, 'rgba(255,240,190,0.9)', 34 + e.p * 1.4, 16, 4);
          state.fx.shake = Math.min(26, state.fx.shake + 2 + e.p * 0.4);
          state.fx.flash = Math.max(state.fx.flash, 0.10 + e.p * 0.006);
          sHit(e.p);
          floatText(e.x, e.y - 26, Math.round(e.p), '#ffe9a3', 18);
          break;
        case 'block':
          burst(e.x, e.y, 8, '#9fd8ff', 5.5, 18, 3);
          ring(e.x, e.y, 'rgba(140,210,255,0.9)', 30, 14, 3);
          state.fx.shake = Math.min(20, state.fx.shake + 1.2);
          sBlock();
          break;
        case 'armor':
          burst(e.x, e.y, 10, '#ffd23f', 4, 20, 3);
          ring(e.x, e.y, 'rgba(255,210,63,0.9)', 40, 18, 4);
          sBlock();
          break;
        case 'swing': sSwing(); break;
        case 'combo': floatText(e.x, e.y, e.p + ' HIT', '#8ef6ff', 26); break;
        case 'jump': dust(e.x, GY, 5, 0); sJump(); break;
        case 'land': dust(e.x, GY, 8, 0); sLand(); break;
        case 'fire':
          burst(e.x, e.y, 16, '#ffb347', 7, 26, 5);
          ring(e.x, e.y, 'rgba(255,180,80,0.9)', 40, 18, 4);
          sFire();
          break;
        case 'trail':
          spawnPart({ type: 'spark', x: e.x, y: GY - e.y - 14, vx: rnd(-0.6, 0.6), vy: rnd(-0.8, 0.2), g: -0.02, life: rnd(12, 24), color: Math.random() < 0.5 ? '#ffcc55' : '#ff7a2f', size: rnd(3, 7), add: true });
          break;
        case 'clash':
          burst(e.x, GY - e.y, 18, '#ffffff', 7, 26, 5);
          ring(e.x, GY - e.y, 'rgba(255,255,255,0.9)', 46, 18, 5);
          sClash();
          break;
        case 'ko':
          burst(e.x, e.y, 40, '#ffd23f', 10, 46, 6);
          burst(e.x, e.y, 20, '#ff5e7a', 8, 40, 5);
          ring(e.x, e.y, 'rgba(255,230,150,1)', 120, 30, 8);
          state.fx.shake = 26; state.fx.flash = 0.34;
          sKO();
          break;
        case 'charge':
          ring(e.x, e.y, 'rgba(255,220,90,0.9)', 80, 26, 5);
          burst(e.x, e.y, 20, '#ffe9a3', 5, 34, 4);
          sCharge();
          break;
        case 'spark':
          spawnPart({ type: 'spark', x: e.x, y: GY - e.y, vx: rnd(-1, 1), vy: rnd(-3.4, -1), g: 0.02, life: rnd(16, 30), color: '#ffd23f', size: rnd(2, 5), add: true });
          break;
        case 'beam':
          state.fx.flash = 0.55; state.fx.shake = 30;
          burst(e.x, GY - e.y, 30, '#dffcff', 11, 40, 7);
          ring(e.x, GY - e.y, 'rgba(200,250,255,1)', 150, 26, 9);
          sBeam();
          break;
        case 'bell': sBell(); break;
      }
    }
  }

  function updateParticles(dt) {
    var steps = dt * 60;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.x += p.vx * steps;
      p.y += p.vy * steps;
      if (p.sway) p.x += Math.sin((p.life || 0) * p.sway + (p.seed || 0)) * 0.6 * steps;
      p.vy += p.g * steps;
      p.vx *= (1 - 0.01 * steps);
      p.life -= steps;
      if (p.type === 'ring') p.r = lerp(p.r, p.maxR, 0.22 * steps);
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (var j = texts.length - 1; j >= 0; j--) {
      var t = texts[j];
      t.y += t.vy * steps;
      t.life -= steps;
      if (t.life <= 0) texts.splice(j, 1);
    }
    state.fx.shake *= Math.pow(0.86, steps);
    if (state.fx.shake < 0.25) state.fx.shake = 0;
    state.fx.flash *= Math.pow(0.88, steps);
    if (state.fx.flash < 0.01) state.fx.flash = 0;

    // per-arena ambience (embers, fireflies, snow, petals…)
    Maps.ambient(state.map, performance.now() / 1000, spawnPart);
  }

  // ========================================================================
  //  RENDERING
  // ========================================================================
  var PAL = [
    { main: '#3f8cff', dark: '#12275c', accent: '#35e0ff', skin: '#ffd9a8', aura: '53,224,255' },
    { main: '#ff3b5c', dark: '#5c0f22', accent: '#ffd23f', skin: '#f2c39a', aura: '255,80,120' }
  ];

  function limb(x1, y1, x2, y2, bend, w, color, outline) {
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var cx = mx + (-dy / len) * bend, cy = my + (dx / len) * bend;
    if (outline) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.lineWidth = w + 4; ctx.strokeStyle = outline; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  }

  function computePose(f, t, i, walkPhase) {
    var J = {
      hip: [0, -52], chest: [0, -84], head: [2, -102], hr: 12,
      shF: [7, -82], shB: [-7, -82],
      handF: [19, -80], handB: [7, -74],
      kneeF: [10, -30], kneeB: [-11, -30],
      footF: [13, -2], footB: [-15, -2],
      armBendF: 12, armBendB: 12, legBendF: 6, legBendB: 6
    };
    var st = f.st, sf = f.sf;
    var bob = Math.sin(t * 4 + i * 2.1) * 1.4;

    function crouchBase() {
      J.hip = [0, -30]; J.chest = [1, -52]; J.head = [2, -68];
      J.shF = [6, -52]; J.shB = [-6, -52];
      J.handF = [18, -48]; J.handB = [6, -44];
      J.kneeF = [13, -18]; J.kneeB = [-13, -18];
      J.footF = [16, -2]; J.footB = [-18, -2];
    }

    function atkExt(a) {
      if (!a) return 0;
      var af = f.af;
      if (af <= a.startup) return -0.3 * (af / Math.max(1, a.startup));
      if (af <= a.startup + a.active) {
        var k = (af - a.startup) / a.active;
        return 1 - Math.pow(1 - k, 3);
      }
      var k2 = (af - a.startup - a.active) / a.recovery;
      return Math.max(0, 1 - k2);
    }

    if (st === 'idle' || st === 'win') {
      J.chest[1] += bob; J.head[1] += bob; J.shF[1] += bob; J.shB[1] += bob;
      J.handF = [19, -80 + bob * 1.2]; J.handB = [7, -74 + bob];
      if (st === 'win') {
        J.handF = [26, -122 - Math.abs(Math.sin(t * 5)) * 7];
        J.handB = [-6, -84];
        J.head[1] += Math.sin(t * 5) * 2;
        J.chest[1] += Math.sin(t * 5) * 1.5;
      }
    } else if (st === 'walk') {
      var sw = Math.sin(walkPhase);
      J.footF = [13 + sw * 16, -2 - Math.max(0, sw) * 14];
      J.footB = [-15 - sw * 16, -2 - Math.max(0, -sw) * 14];
      J.kneeF = [8 + sw * 8, -30 - Math.max(0, sw) * 6];
      J.kneeB = [-9 - sw * 8, -30 - Math.max(0, -sw) * 6];
      var b2 = Math.abs(sw) * 1.5;
      J.hip[1] -= b2; J.chest[1] -= b2; J.head[1] -= b2;
      J.handF = [17 + sw * 4, -78]; J.handB = [5 - sw * 4, -72];
    } else if (st === 'crouch') {
      crouchBase();
      J.chest[1] += bob * 0.4; J.head[1] += bob * 0.4;
    } else if (st === 'block') {
      J.chest[0] -= 3; J.head[0] -= 3;
      J.handF = [21, -78]; J.handB = [17, -60];
      J.armBendF = 16; J.armBendB = 13;
      J.kneeF = [8, -30]; J.kneeB = [-13, -30];
      J.handF[1] += bob * 0.6; J.handB[1] += bob * 0.6;
    } else if (st === 'air') {
      J.kneeF = [9, -42]; J.footF = [7, -20];
      J.kneeB = [-8, -36]; J.footB = [-13, -16];
      J.handF = [16, -94]; J.handB = [-8, -86];
      J.head = [2, -104];
      J.chest[1] -= 2;
    } else if (st === 'hit') {
      var k = Math.min(1, sf / 7);
      J.chest[0] -= 7 * k; J.chest[1] -= 2 * k;
      J.head[0] -= 8 * k; J.head[1] -= 2.5 * k;
      J.handF = [25, -98]; J.handB = [-14, -86];
      J.kneeF = [15, -30]; J.footF = [19, -2];
      J.footB = [-12 - 6 * k, -2];
    } else if (st === 'ko') {
      J.handF = [24, -74]; J.handB = [-12, -66];
      J.kneeF = [16, -34]; J.kneeB = [-16, -30];
      J.head = [4, -102];
    } else if (st === 'super') {
      if (f.su >= 0 && f.su < 46) {
        var sh = Math.sin(t * 46) * 1.6;
        crouchBase();
        J.handF = [10 + sh, -54]; J.handB = [-12 + sh, -50];
        J.head[1] += 2;
      } else {
        J.handF = [36, -74]; J.handB = [30, -70];
        J.armBendF = 0; J.armBendB = 4;
        J.chest[0] += 6; J.head[0] += 5;
        J.kneeF = [17, -28]; J.kneeB = [-15, -28];
        J.footF = [20, -2]; J.footB = [-20, -2];
      }
    } else if (st === 'attack') {
      var a = f.at && Sim.ATTACKS[f.at];
      var ext = Math.max(0, atkExt(a));
      if (f.at === 'punch' || f.at === 'cpunch') {
        if (f.at === 'cpunch') { crouchBase(); J.handF = [18, -50]; }
        J.shF[0] += ext * 4;
        J.handF = [19 + ext * 46, (f.at === 'cpunch' ? -50 : -80)];
        J.armBendF = (1 - ext) * 16;
        J.chest[0] += ext * 3.5; J.head[0] += ext * 3;
        J.handB = [3 - ext * 6, -70];
      } else if (f.at === 'kick' || f.at === 'low') {
        var isLow = f.at === 'low';
        if (isLow) { crouchBase(); }
        J.footF = [13 + ext * 54, isLow ? -4 : (-26 - ext * 24)];
        J.kneeF = [10 + ext * 26, isLow ? -16 : (-30 - ext * 8)];
        J.hip[0] -= ext * 4; J.chest[0] -= ext * 6; J.head[0] -= ext * 4;
        J.handF = [14 - ext * 8, -88]; J.handB = [-18, -78];
        J.legBendF = (1 - ext) * 9;
      } else if (f.at === 'air') {
        J.footF = [10 + ext * 46, -22 - ext * 6];
        J.kneeF = [10 + ext * 18, -36];
        J.handF = [12, -94]; J.handB = [-10, -82];
        J.chest[1] -= 2;
      } else if (f.at === 'special') {
        var kk = Math.min(1, f.af / 13);
        J.handF = [20 + kk * 16, -72]; J.handB = [13 + kk * 16, -66];
        J.armBendF = 7; J.armBendB = 9;
        J.chest[0] += 2;
      }
    }
    return J;
  }

  function drawFighter(f, i, t) {
    var p = PAL[i];
    var ex = fExtras[i];
    if (ex.lastX === null) ex.lastX = f.x;
    var dx = f.x - ex.lastX;
    ex.lastX = f.x;
    ex.walk += Math.abs(dx) * 0.45;

    var sx = f.x, sy = GY - f.y;
    var airFrac = clamp(f.y / 260, 0, 1);

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.42 - airFrac * 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(f.x, GY + 7, 30 - airFrac * 10, 7.5 - airFrac * 3, 0, 0, 7);
    ctx.fill();
    ctx.restore();

    // super aura behind body
    if (f.st === 'super' && f.su >= 0 && f.su < 50) {
      var ar = 60 + Math.sin(t * 30) * 8 + f.su * 0.7;
      var ag = ctx.createRadialGradient(sx, sy - 55, 5, sx, sy - 55, ar);
      ag.addColorStop(0, 'rgba(255,240,160,0.5)');
      ag.addColorStop(0.55, 'rgba(' + p.aura + ',0.28)');
      ag.addColorStop(1, 'rgba(' + p.aura + ',0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(sx, sy - 55, ar, 0, 7); ctx.fill();
    }
    // meter full glow
    if (f.mt >= 100 && f.st !== 'ko') {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t * 8) * 0.1;
      ctx.fillStyle = 'rgba(255,220,90,1)';
      ctx.beginPath(); ctx.ellipse(sx, GY + 6, 36, 9, 0, 0, 7); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(f.fc, 1);

    if (f.st === 'ko') {
      var ka = Math.min(1.5, f.sf / 30 * 1.5);
      ctx.rotate(-ka * 0.9);
    } else if (f.st === 'hit') {
      ctx.rotate(-0.2 * Math.min(1, f.sf / 4));
    } else if (f.st === 'attack' && (f.at === 'kick')) {
      ctx.rotate(-0.05);
    }

    var J = computePose(f, t, i, ex.walk);
    var dark = p.dark;

    // back arm
    limb(J.shB[0], J.shB[1], J.handB[0], J.handB[1], J.armBendB, 8, p.main, dark);
    ctx.fillStyle = p.main;
    ctx.beginPath(); ctx.arc(J.handB[0], J.handB[1], 5, 0, 7); ctx.fill();

    // back leg
    limb(J.hip[0], J.hip[1], J.kneeB[0], J.kneeB[1], J.legBendB, 10, p.main, dark);
    limb(J.kneeB[0], J.kneeB[1], J.footB[0], J.footB[1], 2, 9, p.main, dark);

    // torso
    limb(J.hip[0], J.hip[1], J.chest[0], J.chest[1], 0, 29, p.main, dark);
    // belt
    ctx.strokeStyle = p.accent; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(J.hip[0] - 12, J.hip[1] - 8);
    ctx.lineTo(J.hip[0] + 12, J.hip[1] - 8);
    ctx.stroke();

    // chest emblem
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(J.chest[0] + 2, J.chest[1] + 6, 3.2, 0, 7); ctx.fill();

    // head
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.arc(J.head[0], J.head[1], J.hr, 0, 7); ctx.fill();
    // headband
    ctx.strokeStyle = p.accent; ctx.lineWidth = 5; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(J.head[0] - 13, J.head[1] - 4);
    ctx.lineTo(J.head[0] + 13, J.head[1] - 5);
    ctx.stroke();
    // band ribbon
    var rib = Math.sin(t * 9 + i) * 4;
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(J.head[0] - 11, J.head[1] - 5);
    ctx.quadraticCurveTo(J.head[0] - 30, J.head[1] - 10 + rib, J.head[0] - 44, J.head[1] - 2 + rib * 1.6);
    ctx.stroke();
    // eye
    ctx.fillStyle = 'rgba(10,10,20,0.9)';
    ctx.beginPath(); ctx.arc(J.head[0] + 6, J.head[1] - 1, 2.2, 0, 7); ctx.fill();

    // front leg
    limb(J.hip[0], J.hip[1], J.kneeF[0], J.kneeF[1], J.legBendF, 11, p.main, dark);
    limb(J.kneeF[0], J.kneeF[1], J.footF[0], J.footF[1], 2, 10, p.main, dark);

    // front arm
    limb(J.shF[0], J.shF[1], J.handF[0], J.handF[1], J.armBendF, 9, p.main, dark);
    ctx.fillStyle = p.main;
    ctx.beginPath(); ctx.arc(J.handF[0], J.handF[1], 6, 0, 7); ctx.fill();

    // punch / kick motion arc
    if (f.st === 'attack' && f.af >= 0) {
      var a2 = Sim.ATTACKS[f.at];
      if (a2 && f.af > a2.startup && f.af <= a2.startup + a2.active + 3) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 3;
        var ax = (f.at === 'kick' || f.at === 'low') ? J.footF[0] : J.handF[0];
        var ay = (f.at === 'kick' || f.at === 'low') ? J.footF[1] : J.handF[1];
        ctx.beginPath();
        ctx.arc(ax - 22, ay, 26, -0.8, 0.8);
        ctx.stroke();
      }
    }

    // super firing glow on hands
    if (f.st === 'super' && f.su >= 46) {
      var hg = ctx.createRadialGradient(J.handF[0], J.handF[1], 2, J.handF[0], J.handF[1], 34);
      hg.addColorStop(0, 'rgba(255,255,255,1)');
      hg.addColorStop(0.4, 'rgba(200,250,255,0.8)');
      hg.addColorStop(1, 'rgba(53,224,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(J.handF[0], J.handF[1], 34, 0, 7); ctx.fill();
    }

    ctx.restore();
  }

  function drawProjectile(p, t) {
    var sx = p.x, sy = GY - p.y - 15;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(p.d, 1);
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,215,120,0.95)');
    g.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();

    ctx.strokeStyle = 'rgba(255,220,140,0.95)';
    ctx.lineWidth = 3;
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(2, 0, 16, 9 - i * 2, t * 9 * p.d + i * 2, 0, 6.2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(4, 0, 7, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawBeam(b, t) {
    var y0 = GY - (b.y + 98), h = 98;
    var x0 = b.x, x1 = b.d > 0 ? VW : 0;
    var xa = Math.min(x0, x1), xw = Math.abs(x1 - x0);
    var flick = 1 + Math.sin(t * 64) * 0.06;
    var mid = y0 + h / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var grd = ctx.createLinearGradient(0, y0, 0, y0 + h);
    grd.addColorStop(0, 'rgba(53,224,255,0)');
    grd.addColorStop(0.5, 'rgba(53,224,255,0.55)');
    grd.addColorStop(1, 'rgba(53,224,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(xa, mid - h * 0.85 * flick, xw, h * 1.7 * flick);

    var grd2 = ctx.createLinearGradient(0, y0, 0, y0 + h);
    grd2.addColorStop(0, 'rgba(200,250,255,0)');
    grd2.addColorStop(0.5, 'rgba(230,252,255,0.95)');
    grd2.addColorStop(1, 'rgba(200,250,255,0)');
    ctx.fillStyle = grd2;
    ctx.fillRect(xa, mid - h * 0.42 * flick, xw, h * 0.84 * flick);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(xa, mid - h * 0.17, xw, h * 0.34);

    // muzzle flare
    var fg = ctx.createRadialGradient(x0, mid, 2, x0, mid, 70);
    fg.addColorStop(0, 'rgba(255,255,255,1)');
    fg.addColorStop(0.4, 'rgba(150,240,255,0.7)');
    fg.addColorStop(1, 'rgba(53,224,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(x0, mid, 70 * flick, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var k = p.life / p.max;
      var alpha = clamp(k, 0, 1) * 0.9;
      if (p.type === 'firefly') {
        alpha *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((p.life || 0) * 0.22 + (p.seed || 0)));
      }
      ctx.save();
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      ctx.globalAlpha = alpha;
      if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.type === 'dust' ? (1.6 - k * 0.6) : k + 0.2), 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
    for (var j = 0; j < texts.length; j++) {
      var t = texts[j];
      var kk = clamp(t.life / 46, 0, 1);
      ctx.save();
      ctx.globalAlpha = kk;
      ctx.font = '900 ' + t.size + 'px "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(t.txt, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.txt, t.x, t.y);
      ctx.restore();
    }
  }

  function renderScene(v) {
    var t = performance.now() / 1000;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, VW, VH);

    var shake = state.fx.shake;
    ctx.save();
    if (shake > 0.3) ctx.translate(rnd(-shake, shake), rnd(-shake, shake) * 0.6);

    Maps.draw(state.map, ctx, t);

    if (v) {
      var i;
      // fighters
      for (i = 0; i < v.f.length; i++) drawFighter(v.f[i], i, t);

      // projectiles
      for (i = 0; i < (v.pj || []).length; i++) drawProjectile(v.pj[i], t);

      // beams on top of everything for drama
      for (i = 0; i < (v.bm || []).length; i++) drawBeam(v.bm[i], t);

      // particles
      drawParticles();

      // slow-mo darkening while a beam is out
      if ((v.bm || []).length) {
        ctx.fillStyle = 'rgba(10,6,20,0.18)';
        ctx.fillRect(-40, -40, VW + 80, VH + 80);
      }
    }

    ctx.restore();

    // vignette
    var vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.42, VW / 2, VH / 2, VH * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);

    // impact flash
    if (state.fx.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + state.fx.flash.toFixed(3) + ')';
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  // ========================================================================
  //  NET
  // ========================================================================
  function wsURL() {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host;
  }

  function ensureWS(cb) {
    var n = state.net;
    if (n.ws && n.ws.readyState === 1) { cb(); return; }
    if (!n.ws || n.ws.readyState > 1) {
      var ws = new WebSocket(wsURL());
      n.ws = ws;
      ws.onopen = function () {
        n.open = true; n.reconnectTries = 0;
        if (n.wantReconnect && n.code && n.token) {
          send({ t: 'join', code: n.code, token: n.token, name: n.name });
        } else if (cb) cb();
      };
      ws.onmessage = function (ev) { handleNet(JSON.parse(ev.data)); };
      ws.onclose = function () {
        n.open = false;
        if (state.mode === 'net' && n.wantReconnect) attemptReconnect();
      };
      ws.onerror = function () { /* handled by onclose */ };
      return;
    }
    // still connecting: queue
    var old = n.ws.onopen;
    n.ws.onopen = function () { old && old(); };
    setTimeout(function () { ensureWS(cb); }, 60);
  }

  function send(obj) {
    var n = state.net;
    if (n.ws && n.ws.readyState === 1) n.ws.send(JSON.stringify(obj));
  }

  function attemptReconnect() {
    var n = state.net;
    if (n.reconnectTries >= 12) {
      goMenu();
      toast('could not reconnect');
      n.wantReconnect = false;
      return;
    }
    n.reconnectTries++;
    $('pauseBanner').innerHTML = 'CONNECTION LOST<span class="sub">reconnecting… (' + n.reconnectTries + ')</span>';
    $('pauseBanner').classList.remove('hidden');
    setTimeout(function () {
      if (state.mode === 'net') ensureWS(null);
    }, 1800);
  }

  function handleNet(m) {
    var n = state.net;
    switch (m.t) {
      case 'w':
        n.seat = m.seat; n.code = m.code; n.token = m.token; n.wantReconnect = true;
        try {
          sessionStorage.setItem('sc_code', m.code);
          sessionStorage.setItem('sc_token', m.token);
          sessionStorage.setItem('sc_name', n.name);
        } catch (e) { /* ignore */ }
        window.scLan = m.lan;
        if (m.map) state.map = m.map;
        if (!n.started) {
          // fresh room or a rejoin from the menu -> show the waiting screen
          showWaiting(m.code);
          $('waitText').textContent = 'waiting for your rival…';
        } else {
          // reconnected mid-match: stay in the game
          $('pauseBanner').classList.add('hidden');
          state.mode = 'net';
        }
        syncMapStrips();
        break;
      case 'start':
        hide($('menu')); hide($('waiting')); hide($('localHelp'));
        show($('hud'));
        $('name1').textContent = (m.names[0] || 'PLAYER 1') + '  (P1)';
        $('name2').textContent = (m.names[1] || 'PLAYER 2') + '  (P2)';
        state.mode = 'net';
        n.started = true;
        n.paused = false;
        n.voted = false; n.oppVoted = false;
        n.buf = [];
        if (m.map) state.map = m.map;
        syncMapStrips();
        state.ui.lastBannerKey = '';
        state.ui.lastCombo = [0, 0];
        state.ghost = [100, 100];
        $('rematchBox').classList.add('hidden');
        $('rematchMsg').textContent = '';
        $('pauseBanner').classList.add('hidden');
        hideHintSoon();
        audioInit();
        toastHide();
        break;
      case 'st': {
        var s = m.s;
        n.latest = s;
        consumeFx(s.fx);
        var now = performance.now() / 1000;
        n.buf.push({ t: now, s: s });
        while (n.buf.length > 40 || (n.buf.length && now - n.buf[0].t > 1)) n.buf.shift();
        break;
      }
      case 'pong':
        n.ping = Math.max(0, Date.now() - m.ts);
        break;
      case 'paused':
        n.paused = true;
        $('pauseBanner').innerHTML = 'OPPONENT DISCONNECTED<span class="sub">waiting for them to come back…</span>';
        $('pauseBanner').classList.remove('hidden');
        break;
      case 'map':
        if (m.id) { state.map = m.id; syncMapStrips(); }
        break;
      case 'resumed':
        n.paused = false;
        n.buf = [];
        $('pauseBanner').classList.add('hidden');
        break;
      case 'left':
        n.wantReconnect = false;
        n.started = false;
        goMenu();
        toast('opponent left the match');
        break;
      case 'vote':
        $('rematchMsg').textContent = 'waiting for opponent…';
        break;
      case 'oppVote':
        n.oppVoted = true;
        if (!n.voted) $('rematchMsg').textContent = 'opponent wants a rematch!';
        break;
      case 'rematch':
        n.voted = false; n.oppVoted = false;
        n.buf = [];
        state.ui.lastBannerKey = '';
        if (m.map) { state.map = m.map; syncMapStrips(); }
        $('rematchBox').classList.add('hidden');
        $('rematchMsg').textContent = '';
        break;
      case 'err':
        n.wantReconnect = false;
        goMenu();
        toast(m.m || 'server error');
        break;
    }
  }

  function netView() {
    var n = state.net;
    if (!n.buf.length) return null;
    var targ = performance.now() / 1000 - 0.048;
    for (var i = 0; i < n.buf.length - 1; i++) {
      if (n.buf[i].t <= targ && n.buf[i + 1].t >= targ) {
        var k = (targ - n.buf[i].t) / Math.max(0.0001, n.buf[i + 1].t - n.buf[i].t);
        return interp(n.buf[i].s, n.buf[i + 1].s, k);
      }
    }
    return n.buf[n.buf.length - 1].s;
  }

  function interp(a, b, k) {
    var out = {};
    for (var key in b) out[key] = b[key];
    out.f = [];
    for (var i = 0; i < b.f.length; i++) {
      var f = b.f[i], p = a.f[i], o = {};
      for (var kk in f) o[kk] = f[kk];
      if (p) { o.x = lerp(p.x, f.x, k); o.y = lerp(p.y, f.y, k); }
      out.f.push(o);
    }
    out.pj = (b.pj || []).map(function (pj, idx) {
      var q = a.pj[idx];
      if (!q) return pj;
      var o = {};
      for (var kk in pj) o[kk] = pj[kk];
      o.x = lerp(q.x, pj.x, k); o.y = lerp(q.y, pj.y, k);
      return o;
    });
    out.fx = [];
    return out;
  }

  // ========================================================================
  //  LOCAL 2P MODE + ATTRACT SCREEN (both run the sim in-browser)
  // ========================================================================
  function startLocal() {
    state.local.game = Sim.createGame();
    state.mode = 'local';
    hide($('menu')); hide($('waiting')); hide($('localHelp'));
    show($('hud'));
    state.map = state.local.map || Maps.randomId();
    syncMapStrips();
    $('name1').textContent = 'PLAYER 1';
    $('name2').textContent = 'PLAYER 2';
    $('rematchBox').classList.add('hidden');
    $('pauseBanner').classList.add('hidden');
    state.ui.lastBannerKey = '';
    state.ui.lastCombo = [0, 0];
    state.ghost = [100, 100];
    held = {}; press1 = 0; press2 = 0;
    audioInit();
    hideHintSoon();
    localStep();
  }

  function localStep() {
    var g = state.local.game;
    if (!g) return;
    g.fighters[0].input = bitsFrom('p1:');
    g.fighters[0].pressed = press1; press1 = 0;
    g.fighters[1].input = bitsFrom('p2:');
    g.fighters[1].pressed = press2; press2 = 0;
    Sim.update(g);
    var snap = Sim.snapshot(g);
    consumeFx(snap.fx);
    g.fx.length = 0;
    state.view = snap;
  }

  function initAttract() {
    var g = Sim.createGame();
    g.fighters[0].meter = 45;
    g.fighters[1].meter = 45;
    state.attract.game = g;
    state.attract.bots = [
      { move: 0, mt: 0, at: 0 },
      { move: 0, mt: 0, at: 0 }
    ];
    state.attract.endT = 0;
    state.map = Maps.randomId();    // showcase a new arena every demo fight
    syncMapStrips();
  }

  function attractStep() {
    var g = state.attract.game;
    if (!g) return;
    if (g.over) {
      state.attract.endT++;
      if (state.attract.endT > 260) {
        Sim.resetMatch(g);
        g.fighters[0].meter = 45;
        g.fighters[1].meter = 45;
        state.attract.endT = 0;
        state.map = Maps.randomId();   // rotate arenas between demo fights
        syncMapStrips();
      }
    } else {
      for (var i = 0; i < 2; i++) {
        var me = g.fighters[i], opp = g.fighters[1 - i], b = state.attract.bots[i];
        var ad = Math.abs(opp.x - me.x);
        var dir = opp.x > me.x ? 1 : -1;
        if (b.mt-- <= 0) {
          b.mt = 18 + Math.random() * 40;
          b.move = ad > 150 ? dir : ad < 70 ? -dir : (Math.random() < 0.62 ? dir : 0);
        }
        var bits = b.move > 0 ? BIT.RIGHT : b.move < 0 ? BIT.LEFT : 0;
        var press = 0;
        if (b.at-- <= 0 && ad < 105 && !me.ko && !opp.ko) {
          b.at = 26 + Math.random() * 55;
          var r = Math.random();
          press |= r < 0.5 ? BIT.PUNCH : BIT.KICK;
          if (Math.random() < 0.07) press |= BIT.JUMP;
        }
        if (!me.ko && me.meter >= 100 && ad < 460 && Math.random() < 0.03) press |= BIT.SPECIAL;
        else if (!me.ko && me.meter >= 50 && ad > 150 && Math.random() < 0.02) press |= BIT.SPECIAL;
        bits |= press;
        me.input = bits;
        me.pressed = press;
      }
    }
    Sim.update(g);
    var snap = Sim.snapshot(g);
    consumeFx(snap.fx);
    g.fx.length = 0;
    state.view = snap;
  }

  // ========================================================================
  //  HUD
  // ========================================================================
  function setBar(el, ghostEl, val, ghostVal) {
    el.style.width = clamp(val, 0, 100) + '%';
    ghostEl.style.width = clamp(ghostVal, 0, 100) + '%';
    if (val < 25) el.classList.add('lowamp'); else el.classList.remove('lowamp');
  }

  function updateHUD(v) {
    if (!v || !v.f) return;
    var f0 = v.f[0], f1 = v.f[1];

    state.ghost[0] += (f0.hp - state.ghost[0]) * 0.045;
    state.ghost[1] += (f1.hp - state.ghost[1]) * 0.045;
    if (state.ghost[0] < f0.hp) state.ghost[0] = f0.hp;
    if (state.ghost[1] < f1.hp) state.ghost[1] = f1.hp;

    setBar($('hp1'), $('ghost1'), f0.hp, state.ghost[0]);
    setBar($('hp2'), $('ghost2'), f1.hp, state.ghost[1]);

    $('timer').textContent = v.tm;
    $('timer').classList.toggle('urgent', v.tm <= 10 && v.ph === 'fight');
    $('roundlbl').textContent = 'ROUND ' + v.r;
    if (state.map !== state.ui.lastMap) {
      state.ui.lastMap = state.map;
      $('maplbl').textContent = Maps.name(state.map);
    }

    var pips1 = $('pips1').children, pips2 = $('pips2').children;
    for (var i = 0; i < 2; i++) {
      pips1[i].classList.toggle('on', v.w[0] > i);
      pips2[i].classList.toggle('on', v.w[1] > i);
    }

    var m1 = $('mtr1'), m2 = $('mtr2');
    m1.style.width = clamp(f0.mt, 0, 100) + '%';
    m2.style.width = clamp(f1.mt, 0, 100) + '%';
    m1.classList.toggle('ready', f0.mt >= 100);
    m2.classList.toggle('ready', f1.mt >= 100);

    // combos
    for (var p = 0; p < 2; p++) {
      var el = $('combo' + (p + 1));
      var cb = v.f[p].cb;
      if (cb >= 2 && v.ph === 'fight') {
        el.textContent = cb + ' HITS';
        el.style.opacity = 1;
        if (cb !== state.ui.lastCombo[p]) {
          el.classList.remove('pop');
          void el.offsetWidth;
          el.classList.add('pop');
          state.ui.lastCombo[p] = cb;
        }
      } else {
        el.style.opacity = 0;
        if (cb < 2) state.ui.lastCombo[p] = 0;
      }
    }

    // banner
    var bn = v.bn;
    var el2 = $('banner');
    var show = false, key = '';
    if (bn) {
      key = bn.x + '|' + bn.k;
      var life = bn.k === 'win' ? 1e9 : 175;
      show = bn.t < life && !(v.ph === 'matchEnd' && bn.t > 900);
    }
    if (show && key !== state.ui.lastBannerKey) {
      el2.className = 'k-' + bn.k;
      el2.querySelector('.btext').textContent = bn.x;
      el2.querySelector('.bsub').textContent = bn.s || '';
      var bt = el2.querySelector('.btext');
      bt.style.animation = 'none';
      void bt.offsetWidth;
      bt.style.animation = '';
      el2.classList.add('show');
      state.ui.lastBannerKey = key;
    } else if (!show && state.ui.lastBannerKey) {
      el2.classList.remove('show');
    } else if (show && key === state.ui.lastBannerKey) {
      el2.classList.add('show');
    }

    // rematch
    var box = $('rematchBox');
    if (v.ov) {
      box.classList.remove('hidden');
      if (state.mode === 'local') { $('rematchMsg').textContent = 'press rematch to fight again'; }
    } else {
      box.classList.add('hidden');
    }

    // net info
    var n = state.net;
    $('pingtxt').textContent = state.mode === 'net'
      ? (n.ping ? 'PING ' + n.ping + 'ms · ROOM ' + (n.code || '----') : 'connected')
      : (state.mode === 'local' ? 'LOCAL 2P' : '');
    $('pingdot').classList.toggle('bad', state.mode === 'net' && n.ping > 160);
  }

  // ========================================================================
  //  UI PLUMBING
  // ========================================================================
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  var toastT = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function toastHide() { $('toast').classList.remove('show'); }

  function showWaiting(code) {
    hide($('menu')); hide($('localHelp'));
    show($('waiting'));
    $('roomCode').textContent = code;
    state.mode = 'wait';
  }

  function goMenu() {
    state.mode = 'menu';
    hide($('waiting')); hide($('hud')); hide($('localHelp'));
    show($('menu'));
    state.local.game = null;
    state.net.started = false;
    initAttract();
    held = {};
  }

  function inviteLink(code) {
    var host = location.host;
    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && window.scLan) {
      host = window.scLan + ':' + (location.port || '3000');
    }
    return location.protocol + '//' + host + '/?room=' + code;
  }

  // ------------------------------------------------------------ arena picker
  function mapThumbCanvas(id) {
    var c = document.createElement('canvas');
    var w = 176, h = 99;
    c.width = w * 2;
    c.height = h * 2;
    var x = c.getContext('2d');
    if (x) {
      var s = (w * 2) / 960;
      x.setTransform(s, 0, 0, s, 0, 0);
      Maps.draw(id, x, 1.7);   // a fixed "moment in time" for every preview
    }
    return c;
  }

  function buildMapStrip(el, kind, onPick) {
    if (!el) return;
    el.innerHTML = '';
    var cards = {};
    Maps.list.forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'mapcard';
      b.type = 'button';
      b.title = m.name + ' — ' + m.tag;
      b.appendChild(mapThumbCanvas(m.id));
      var nm = document.createElement('span');
      nm.textContent = m.name;
      b.appendChild(nm);
      var tg = document.createElement('em');
      tg.textContent = m.tag;
      b.appendChild(tg);
      b.addEventListener('click', function () { if (onPick) onPick(m.id); });
      el.appendChild(b);
      cards[m.id] = b;
    });
    state.ui.strips.push({ el: el, cards: cards, kind: kind });
    syncMapStrips();
  }

  function syncMapStrips() {
    state.ui.strips.forEach(function (s) {
      var interactive = s.kind === 'local' || (s.kind === 'wait' && state.net.seat === 0 && state.mode === 'wait');
      for (var id in s.cards) {
        if (!Object.prototype.hasOwnProperty.call(s.cards, id)) continue;
        s.cards[id].classList.toggle('sel', id === state.map);
        s.cards[id].classList.toggle('locked', !interactive);
      }
    });
    var who = $('mapWho');
    if (who) {
      who.textContent = state.mode === 'wait'
        ? (state.net.seat === 0 ? '— you pick' : '— host picks')
        : '';
    }
  }

  // menu wiring
  $('createBtn').addEventListener('click', function () {
    audioInit();
    var name = ($('nameInput').value || 'PLAYER').trim().toUpperCase();
    var n = state.net;
    n.name = name;
    n.wantReconnect = true;
    ensureWS(function () { send({ t: 'create', name: name }); });
  });

  $('joinBtn').addEventListener('click', function () {
    audioInit();
    var code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length < 4) { toast('enter the 4-letter room code'); return; }
    var name = ($('nameInput').value || 'PLAYER').trim().toUpperCase();
    var n = state.net;
    n.name = name;
    n.wantReconnect = true;
    var token = null;
    try {
      // same room as last time? send the saved token so we take back our seat
      if (sessionStorage.getItem('sc_code') === code) token = sessionStorage.getItem('sc_token');
    } catch (e) { /* ignore */ }
    ensureWS(function () { send({ t: 'join', code: code, name: name, token: token }); });
  });

  $('localBtn').addEventListener('click', function () {
    audioInit();
    hide($('menu'));
    show($('localHelp'));
  });
  $('localBack').addEventListener('click', function () {
    hide($('localHelp'));
    show($('menu'));
  });
  $('localStart').addEventListener('click', startLocal);

  $('cancelBtn').addEventListener('click', function () {
    var n = state.net;
    n.wantReconnect = false;
    send({ t: 'leave' });
    if (n.ws) { try { n.ws.close(); } catch (e) { } }
    n.ws = null; n.code = null; n.token = null;
    goMenu();
  });

  $('copyBtn').addEventListener('click', function () {
    var link = inviteLink($('roomCode').textContent);
    function done() { $('copyBtn').textContent = 'COPIED!'; setTimeout(function () { $('copyBtn').textContent = 'COPY INVITE LINK'; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { prompt('Copy this link:', link); });
    } else {
      prompt('Copy this link:', link);
    }
  });

  $('rematchBtn').addEventListener('click', function () {
    if (state.mode === 'local') {
      Sim.resetMatch(state.local.game);
      state.ui.lastBannerKey = '';
      $('rematchBox').classList.add('hidden');
    } else {
      state.net.voted = true;
      $('rematchMsg').textContent = 'waiting for opponent…';
      send({ t: 'rematch' });
    }
  });

  // arena pickers: waiting room = host only / local mode = free choice
  buildMapStrip($('mapStrip'), 'wait', function (id) {
    if (state.mode !== 'wait' || state.net.seat !== 0) return;
    state.map = id;
    syncMapStrips();
    send({ t: 'map', id: id });
  });
  buildMapStrip($('mapStripLocal'), 'local', function (id) {
    state.local.map = id;
    state.map = id;
    syncMapStrips();
  });

  // pre-fill room code from ?room=CODE (invite link) or offer to rejoin the last match
  (function () {
    try {
      var nmSaved = localStorage.getItem('sc_name');
      if (nmSaved) $('nameInput').value = nmSaved;
      var q = new URLSearchParams(location.search);
      var room = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (room) {
        $('codeInput').value = room;
        $('joinBtn').classList.add('gold');
        toast('invited to room ' + room + ' — enter your name and press JOIN');
      } else {
        var savedCode = sessionStorage.getItem('sc_code');
        if (savedCode) {
          $('codeInput').value = savedCode;
          toast('you have a match in room ' + savedCode + ' — press JOIN to re-enter');
        }
      }
    } catch (e) { /* ignore */ }
  })();
  $('nameInput').addEventListener('change', function () {
    try { localStorage.setItem('sc_name', $('nameInput').value); } catch (e) { }
  });

  // never keep game keys "held" while the player is typing in a field
  ['nameInput', 'codeInput'].forEach(function (id) {
    $(id).addEventListener('focus', function () {
      held = {}; press1 = 0; press2 = 0; pressNet = 0;
    });
  });

  // ========================================================================
  //  MAIN LOOP
  // ========================================================================
  var lastT = performance.now(), accSim = 0, pingTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    // simulation stepping
    if (state.mode === 'local' && state.local.game) {
      accSim += dt;
      var steps = 0;
      while (accSim >= 1 / 60 && steps < 5) { accSim -= 1 / 60; steps++; localStep(); }
      if (steps) { /* view updated */ }
    } else if (state.mode === 'menu' || state.mode === 'wait') {
      accSim += dt;
      var steps2 = 0;
      while (accSim >= 1 / 60 && steps2 < 5) { accSim -= 1 / 60; steps2++; attractStep(); }
    } else {
      accSim = 0;
    }

    // net: send input + ping
    if (state.mode === 'net' && state.net.ws && state.net.ws.readyState === 1 && state.net.started) {
      send({ t: 'i', k: bitsFrom(''), p: pressNet });
      pressNet = 0;
      pingTimer += dt;
      if (pingTimer > 1) { pingTimer = 0; send({ t: 'ping', ts: Date.now() }); }
    }

    // pick view
    var v = null;
    if (state.mode === 'net') v = netView();
    else v = state.view;

    updateParticles(dt);
    renderScene(v);

    if (state.mode !== 'menu' && state.mode !== 'wait') {
      updateHUD(v);
    }
  }

  initAttract();
  requestAnimationFrame(frame);
})();
