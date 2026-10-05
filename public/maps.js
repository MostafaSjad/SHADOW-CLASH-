/* ============================================================================
   SHADOW CLASH — arenas
   ----------------------------------------------------------------------------
   Four fully hand-drawn (code-drawn!) stages. Every map is a pure function of
   (ctx, time), so it can be rendered to the game canvas OR to a tiny thumbnail
   canvas for the map picker. Shared by the browser client and — for the id
   list / random picker — by the Node server too.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Maps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 960, H = 540, GY = 470;

  // ------------------------------------------------------------------ helpers
  function rand(a, b) { return a + Math.random() * (b - a); }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // deterministic pseudo-random (stable layouts across frames/clients)
  function R(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // gradients are bound to a canvas context; cache them per ctx so we don't
  // rebuild dozens every frame (the thumbnails use their own contexts).
  var gcache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function lin(ctx, key, x0, y0, x1, y1, stops) {
    if (!gcache) {
      var g0 = ctx.createLinearGradient(x0, y0, x1, y1);
      for (var s0 = 0; s0 < stops.length; s0++) g0.addColorStop(stops[s0][0], stops[s0][1]);
      return g0;
    }
    var m = gcache.get(ctx);
    if (!m) { m = {}; gcache.set(ctx, m); }
    if (!m[key]) {
      var g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (var s = 0; s < stops.length; s++) g.addColorStop(stops[s][0], stops[s][1]);
      m[key] = g;
    }
    return m[key];
  }
  function rad(ctx, key, x, y, r0, r1, stops) {
    if (!gcache) {
      var g0 = ctx.createRadialGradient(x, y, r0, x, y, r1);
      for (var s0 = 0; s0 < stops.length; s0++) g0.addColorStop(stops[s0][0], stops[s0][1]);
      return g0;
    }
    var m = gcache.get(ctx);
    if (!m) { m = {}; gcache.set(ctx, m); }
    if (!m[key]) {
      var g = ctx.createRadialGradient(x, y, r0, x, y, r1);
      for (var s = 0; s < stops.length; s++) g.addColorStop(stops[s][0], stops[s][1]);
      m[key] = g;
    }
    return m[key];
  }

  // shared stage furniture ---------------------------------------------------
  function groundBase(ctx, key, stops) {
    ctx.fillStyle = lin(ctx, 'gnd-' + key, 0, GY, 0, H, stops);
    ctx.fillRect(-40, GY, W + 80, H - GY + 40);
  }
  function neonEdge(ctx, key, c0, c1, c2) {
    ctx.fillStyle = lin(ctx, 'edge-' + key, 0, GY - 2, W, GY - 2, [[0, c0], [0.5, c1], [1, c2]]);
    ctx.fillRect(0, GY - 2, W, 3);
  }
  function perspective(ctx, color) {
    ctx.strokeStyle = color || 'rgba(90,180,255,0.09)';
    ctx.lineWidth = 1;
    for (var v = -2; v <= 10; v++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + v * 40, GY + 4);
      ctx.lineTo(W / 2 + v * 190, H + 20);
      ctx.stroke();
    }
  }
  function stars(ctx, t, count, seed, maxY, color) {
    for (var i = 0; i < count; i++) {
      var x = R(seed + i) * (W + 40) - 20;
      var y = R(seed + i + 500) * maxY;
      var s = R(seed + i + 900) * 1.5 + 0.4;
      var tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.1 + i * 1.7 + seed));
      ctx.fillStyle = 'rgba(' + color + ',' + (tw * 0.8).toFixed(3) + ')';
      ctx.fillRect(x, y, s, s);
    }
  }

  // ==========================================================================
  //  1. CRIMSON SHRINE — the classic sunset dojo
  // ==========================================================================
  function drawSunset(ctx, t) {
    ctx.save();

    ctx.fillStyle = lin(ctx, 'sunset-sky', 0, 0, 0, GY, [
      [0, '#0b0a24'], [0.42, '#2a1445'], [0.72, '#6b2550'], [1, '#c9555f']
    ]);
    ctx.fillRect(-40, -40, W + 80, GY + 40);

    // sun
    var sx = 690, sy = 320, sr = 95;
    ctx.fillStyle = rad(ctx, 'sunset-sun', sx, sy, 0, sr * 2.1, [
      [0, 'rgba(255,220,140,0.95)'], [0.35, 'rgba(255,150,90,0.5)'], [1, 'rgba(255,110,90,0)']
    ]);
    ctx.beginPath(); ctx.arc(sx, sy, sr * 2.1, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,236,180,0.95)';
    ctx.beginPath(); ctx.arc(sx, sy, sr * 0.72, 0, 7); ctx.fill();

    // distant birds
    ctx.strokeStyle = 'rgba(28,14,40,0.75)';
    ctx.lineWidth = 2;
    for (var b = 0; b < 3; b++) {
      var bx = ((t * 12 + b * 130) % (W + 400)) - 200;
      var by = 118 + b * 26 + Math.sin(t * 1.3 + b) * 6;
      var flap = Math.sin(t * 6 + b * 2) * 4;
      ctx.beginPath();
      ctx.moveTo(bx - 9, by + flap);
      ctx.quadraticCurveTo(bx, by - 3, bx + 2, by);
      ctx.quadraticCurveTo(bx + 4, by - 3, bx + 13, by + flap);
      ctx.stroke();
    }

    // clouds
    ctx.fillStyle = 'rgba(30,16,52,0.55)';
    for (var c = 0; c < 4; c++) {
      var cw = 150 + c * 40;
      var cxp = ((t * (6 + c * 3) + c * 420) % (W + 500)) - 250;
      var cyp = 90 + c * 46;
      ctx.beginPath();
      ctx.ellipse(cxp, cyp, cw * 0.5, 11, 0, 0, 7);
      ctx.ellipse(cxp + cw * 0.24, cyp - 9, cw * 0.3, 9, 0, 0, 7);
      ctx.fill();
    }

    // mountains
    ctx.fillStyle = '#241238';
    ctx.beginPath();
    ctx.moveTo(-40, GY);
    var pts = [[0, 350], [90, 300], [200, 355], [320, 285], [430, 345], [540, 300], [660, 360], [780, 290], [900, 350], [1000, 320]];
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(W + 40, GY); ctx.closePath(); ctx.fill();

    // pagoda
    ctx.fillStyle = '#1a0c2a';
    ctx.fillRect(120, 330, 6, GY - 330);
    for (var f = 0; f < 3; f++) {
      var fy = 332 - f * 34, fw = 58 - f * 12;
      ctx.beginPath();
      ctx.moveTo(123 - fw, fy + 26);
      ctx.lineTo(123, fy);
      ctx.lineTo(123 + fw, fy + 26);
      ctx.closePath(); ctx.fill();
    }
    // torii gate
    ctx.fillStyle = '#160a24';
    ctx.fillRect(810, 330, 8, GY - 330);
    ctx.fillRect(806, 322, 70, 8);
    ctx.fillRect(856, 330, 8, GY - 330);
    ctx.fillRect(800, 352, 76, 7);

    // hanging lanterns
    for (var L = 0; L < 2; L++) {
      var lx = L === 0 ? 260 : 700;
      var sway = Math.sin(t * 1.4 + L) * 4;
      ctx.strokeStyle = 'rgba(255,200,120,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(lx, 200); ctx.quadraticCurveTo(lx + sway * 0.5, 250, lx + sway, 285); ctx.stroke();
      ctx.fillStyle = rad(ctx, 'sunset-lant' + L, lx + sway, 296, 2, 34, [
        [0, 'rgba(255,180,90,0.55)'], [0.5, 'rgba(255,140,60,0.22)'], [1, 'rgba(255,120,50,0)']
      ]);
      ctx.beginPath(); ctx.arc(lx + sway, 296, 34, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff9b4a';
      ctx.beginPath(); ctx.ellipse(lx + sway, 296, 12, 16, 0, 0, 7); ctx.fill();
    }

    groundBase(ctx, 'sunset', [[0, '#160b1e'], [1, '#06040a']]);
    neonEdge(ctx, 'sunset', 'rgba(53,224,255,0.05)', 'rgba(53,224,255,0.85)', 'rgba(255,59,122,0.05)');
    perspective(ctx);
    ctx.restore();
  }
  function ambientSunset(t, spawn) {
    if (Math.random() < 0.10) {
      spawn({
        type: 'spark', x: rand(0, W), y: GY + rand(0, 46),
        vx: rand(-0.3, 0.3), vy: rand(-1.3, -0.5), g: -0.004,
        life: rand(40, 90), color: 'rgba(255,170,80,0.8)', size: rand(1.5, 3)
      });
    }
  }

  // ==========================================================================
  //  2. NEON DISTRICT — rain-slick rooftop above a glowing city
  // ==========================================================================
  var NEONS = ['#35e0ff', '#ff3b7a', '#ffd23f', '#7cff98', '#c05bff'];

  function drawCity(ctx, t) {
    ctx.save();

    ctx.fillStyle = lin(ctx, 'city-sky', 0, 0, 0, GY, [
      [0, '#04050e'], [0.4, '#130a2e'], [0.75, '#3c1150'], [1, '#7a1d5e']
    ]);
    ctx.fillRect(-40, -40, W + 80, GY + 40);

    stars(ctx, t, 80, 17, 250, '220,235,255');

    // moon
    ctx.fillStyle = rad(ctx, 'city-moon', 770, 105, 0, 92, [
      [0, 'rgba(200,225,255,0.85)'], [0.32, 'rgba(150,180,255,0.25)'], [1, 'rgba(120,140,255,0)']
    ]);
    ctx.beginPath(); ctx.arc(770, 105, 92, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8f4ff';
    ctx.beginPath(); ctx.arc(770, 105, 40, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(160,185,215,0.5)';
    ctx.beginPath();
    ctx.arc(752, 94, 6, 0, 7);
    ctx.arc(790, 122, 4, 0, 7);
    ctx.arc(766, 128, 9, 0, 7);
    ctx.arc(786, 88, 3, 0, 7);
    ctx.fill();

    // sweeping searchlights
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var s = 0; s < 3; s++) {
      var sbx = 180 + s * 300;
      var ang = Math.sin(t * 0.18 + s * 1.7) * 0.45 - 1.35;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      ctx.fillStyle = 'rgba(120,200,255,' + (0.05 + 0.02 * Math.sin(t * 0.9 + s)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(sbx, GY - 30);
      ctx.lineTo(sbx + dx * 540 - 74, GY - 30 + dy * 540);
      ctx.lineTo(sbx + dx * 540 + 74, GY - 30 + dy * 540);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // far skyline (lit windows)
    var far = [[0, 190, 70], [64, 265, 56], [126, 150, 82], [196, 300, 60], [256, 180, 76], [330, 240, 70], [398, 140, 92], [482, 280, 56], [548, 200, 76], [622, 320, 62], [692, 170, 86], [772, 250, 66], [846, 200, 80], [920, 290, 62]];
    for (var f = 0; f < far.length; f++) {
      var bx = far[f][0], bh = far[f][1], bw = far[f][2];
      ctx.fillStyle = '#191033';
      ctx.fillRect(bx, GY - bh, bw, bh);
      for (var wy = GY - bh + 12; wy < GY - 14; wy += 20) {
        for (var wx = bx + 7; wx < bx + bw - 10; wx += 16) {
          var lit = R(wx * 13 + wy * 7 + f * 31);
          if (lit > 0.58) {
            var flick = 0.5 + 0.5 * Math.sin(t * 2 + lit * 24);
            ctx.fillStyle = 'rgba(255,214,150,' + (0.22 + 0.45 * flick).toFixed(3) + ')';
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
    }

    // near skyline with neon signage
    var near = [[14, 120, 92], [140, 195, 82], [262, 150, 102], [404, 215, 92], [548, 140, 112], [700, 185, 86], [830, 225, 102], [936, 150, 82]];
    for (var n = 0; n < near.length; n++) {
      var nx = near[n][0], nh = near[n][1], nw = near[n][2];
      ctx.fillStyle = '#0d0820';
      ctx.fillRect(nx, GY - nh, nw, nh);
      // windows
      for (var wy2 = GY - nh + 14; wy2 < GY - 16; wy2 += 22) {
        for (var wx2 = nx + 8; wx2 < nx + nw - 12; wx2 += 18) {
          var lit2 = R(wx2 * 7 + wy2 * 3 + n * 57);
          if (lit2 > 0.62) {
            ctx.fillStyle = 'rgba(255,206,140,0.28)';
            ctx.fillRect(wx2, wy2, 6, 8);
          }
        }
      }
      // roof neon strip
      var col = NEONS[n % NEONS.length];
      ctx.globalAlpha = 0.45 + 0.4 * Math.sin(t * 1.5 + n * 2);
      ctx.fillStyle = col;
      ctx.fillRect(nx, GY - nh, nw, 2.5);
      ctx.globalAlpha = 1;
      // vertical sign
      if (n % 2 === 0) {
        var gx = nx + nw * 0.62, gy = GY - nh + 20;
        var gh = Math.min(74, nh * 0.5), gw = 10;
        var scol = NEONS[(n + 2) % NEONS.length];
        ctx.globalAlpha = 0.22; ctx.fillStyle = scol;
        ctx.fillRect(gx - 4, gy - 4, gw + 8, gh + 8);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(gx, gy, gw, gh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(8,5,18,0.8)';
        for (var sg = 0; sg < 4; sg++) ctx.fillRect(gx + 2, gy + 7 + sg * 17, gw - 4, 6);
      }
    }

    // animated billboard
    var bbX = 556, bbY = GY - 258, bbW = 152, bbH = 62;
    ctx.fillStyle = 'rgba(5,3,14,0.95)';
    ctx.fillRect(bbX, bbY, bbW, bbH);
    ctx.strokeStyle = 'rgba(53,224,255,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bbX + 1, bbY + 1, bbW - 2, bbH - 2);
    var glow = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 30px "Arial Black", sans-serif';
    ctx.strokeStyle = 'rgba(53,224,255,' + (0.22 * glow).toFixed(3) + ')';
    ctx.lineWidth = 9;
    ctx.strokeText('SHADOW', bbX + bbW / 2, bbY + 42);
    ctx.strokeStyle = 'rgba(53,224,255,' + (0.5 * glow).toFixed(3) + ')';
    ctx.lineWidth = 4;
    ctx.strokeText('SHADOW', bbX + bbW / 2, bbY + 42);
    ctx.fillStyle = '#eafcff';
    ctx.fillText('SHADOW', bbX + bbW / 2, bbY + 42);
    ctx.restore();

    // rooftop
    groundBase(ctx, 'city', [[0, '#161228'], [0.5, '#0b0817'], [1, '#05040b']]);
    neonEdge(ctx, 'city', 'rgba(255,59,122,0.08)', 'rgba(255,59,122,0.9)', 'rgba(53,224,255,0.08)');
    // cables
    ctx.strokeStyle = 'rgba(80,90,140,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, GY + 16);
    ctx.quadraticCurveTo(W / 2, GY + 30, W, GY + 18);
    ctx.stroke();
    // vents
    for (var v = 0; v < 2; v++) {
      var vx = v === 0 ? 150 : 720, vy = GY + 24;
      ctx.fillStyle = 'rgba(70,80,110,0.5)';
      ctx.fillRect(vx, vy, 54, 22);
      ctx.fillStyle = 'rgba(20,24,40,0.8)';
      for (var sl = 0; sl < 4; sl++) ctx.fillRect(vx + 6, vy + 4 + sl * 4, 42, 2);
    }
    // neon puddle reflections
    for (var p = 0; p < 2; p++) {
      var px = p === 0 ? 330 : 640, pw = 92 + p * 42;
      ctx.fillStyle = rad(ctx, 'city-puddle' + p, px, GY + 30, 0, pw, [
        [0, 'rgba(255,59,122,0.16)'], [0.6, 'rgba(53,224,255,0.07)'], [1, 'rgba(0,0,0,0)']
      ]);
      ctx.beginPath(); ctx.ellipse(px, GY + 30, pw, pw * 0.18, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function ambientCity(t, spawn) {
    if (Math.random() < 0.08) {
      spawn({
        type: 'firefly', x: rand(0, W), y: rand(80, 468),
        vx: rand(-0.2, 0.2), vy: rand(-0.35, -0.1), g: 0,
        life: rand(120, 220), color: 'rgba(90,220,255,0.85)', size: rand(1.5, 3),
        seed: rand(0, 6.28)
      });
    }
    if (Math.random() < 0.03) {
      spawn({
        type: 'firefly', x: rand(0, W), y: rand(80, 468),
        vx: rand(-0.2, 0.2), vy: rand(-0.35, -0.1), g: 0,
        life: rand(120, 220), color: 'rgba(255,90,180,0.8)', size: rand(1.5, 3),
        seed: rand(0, 6.28)
      });
    }
  }

  // ==========================================================================
  //  3. MOONLIT BAMBOO — misty grove with fireflies
  // ==========================================================================
  function bambooLayer(ctx, t, seed, color, count, wMin, wMax, swayAmp, speed, leaves) {
    for (var i = 0; i < count; i++) {
      var x = R(seed + i * 7) * (W + 160) - 80;
      var w = wMin + R(seed + i * 13) * (wMax - wMin);
      var ph = R(seed + i * 29) * 6.28;
      var sway = Math.sin(t * speed + ph) * swayAmp;
      var top = -40 + R(seed + i * 41) * 60;
      var h = GY + 26 - top;
      ctx.fillStyle = color;
      rr(ctx, x + sway, top, w, h, w / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1.5;
      for (var y = top + 46; y < GY; y += 60) {
        ctx.beginPath();
        ctx.moveTo(x + sway + 1, y);
        ctx.lineTo(x + sway + w - 1, y);
        ctx.stroke();
      }
      if (leaves) {
        ctx.fillStyle = color;
        for (var l = 0; l < 5; l++) {
          var ly = top + 34 + R(seed + i * 31 + l * 17) * (GY - top) * 0.55;
          var side = R(seed + i + l * 5) > 0.5 ? 1 : -1;
          var lx = x + sway + (side > 0 ? w : 0);
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(side * (0.55 + Math.sin(t * 0.8 + ph + l) * 0.15));
          ctx.beginPath();
          ctx.ellipse(side * 15, 0, 17, 3.2, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  function drawBamboo(ctx, t) {
    ctx.save();

    ctx.fillStyle = lin(ctx, 'bam-sky', 0, 0, 0, GY, [
      [0, '#03101a'], [0.45, '#0a2a33'], [0.8, '#17453f'], [1, '#2c5c4c']
    ]);
    ctx.fillRect(-40, -40, W + 80, GY + 40);

    stars(ctx, t, 60, 71, 220, '220,255,240');

    // moon
    ctx.fillStyle = rad(ctx, 'bam-moon', 250, 150, 0, 185, [
      [0, 'rgba(255,250,220,0.8)'], [0.25, 'rgba(200,240,220,0.22)'], [1, 'rgba(180,230,210,0)']
    ]);
    ctx.beginPath(); ctx.arc(250, 150, 185, 0, 7); ctx.fill();
    ctx.fillStyle = '#fdf6d8';
    ctx.beginPath(); ctx.arc(250, 150, 66, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(215,205,160,0.4)';
    ctx.beginPath();
    ctx.arc(224, 130, 9, 0, 7);
    ctx.arc(274, 172, 6, 0, 7);
    ctx.arc(243, 177, 10, 0, 7);
    ctx.arc(269, 121, 4, 0, 7);
    ctx.fill();

    // cloud streaks
    ctx.fillStyle = 'rgba(190,240,225,0.07)';
    for (var c = 0; c < 3; c++) {
      var cx = ((t * (10 + c * 6) + c * 380) % (W + 600)) - 300;
      ctx.beginPath();
      ctx.ellipse(cx, 168 + c * 40, 150 + c * 30, 8, 0, 0, 7);
      ctx.fill();
    }

    // mist bands (soft vertical fades, no hard edges)
    for (var m = 0; m < 3; m++) {
      var my = 330 + m * 44;
      ctx.fillStyle = lin(ctx, 'bam-mist' + m, 0, my - 42, 0, my + 42, [
        [0, 'rgba(170,230,215,0)'],
        [0.5, 'rgba(170,230,215,0.06)'],
        [1, 'rgba(170,230,215,0)']
      ]);
      ctx.fillRect(-40, my - 42, W + 80, 84);
    }

    // bamboo layers
    bambooLayer(ctx, t, 3, 'rgba(24,72,62,0.62)', 12, 7, 13, 3, 0.7, false);
    bambooLayer(ctx, t, 11, 'rgba(14,52,44,0.82)', 10, 11, 20, 5, 0.85, true);
    bambooLayer(ctx, t, 29, 'rgba(7,34,27,0.96)', 8, 16, 28, 8, 1.0, true);

    // stone lantern
    var lx = 822, ly = GY;
    ctx.fillStyle = 'rgba(6,20,16,0.98)';
    ctx.fillRect(lx - 24, ly - 10, 48, 10);
    ctx.fillRect(lx - 7, ly - 52, 14, 44);
    ctx.fillRect(lx - 26, ly - 64, 52, 14);
    ctx.fillRect(lx - 20, ly - 96, 40, 32);
    var flick = 0.8 + 0.2 * Math.sin(t * 7) + 0.05 * Math.sin(t * 23);
    ctx.fillStyle = 'rgba(255,190,90,' + (0.85 * flick).toFixed(3) + ')';
    ctx.fillRect(lx - 13, ly - 90, 9, 20);
    ctx.fillRect(lx + 4, ly - 90, 9, 20);
    ctx.fillStyle = 'rgba(6,20,16,0.98)';
    ctx.beginPath();
    ctx.moveTo(lx - 34, ly - 96);
    ctx.lineTo(lx, ly - 124);
    ctx.lineTo(lx + 34, ly - 96);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rad(ctx, 'bam-lant', lx, ly - 82, 2, 125, [
      [0, 'rgba(255,190,90,0.3)'], [0.5, 'rgba(255,160,60,0.12)'], [1, 'rgba(255,140,40,0)']
    ]);
    ctx.beginPath(); ctx.arc(lx, ly - 82, 125, 0, 7); ctx.fill();

    // ground
    groundBase(ctx, 'bamboo', [[0, '#0b1d17'], [1, '#020604']]);
    // stone path
    ctx.fillStyle = 'rgba(150,170,150,0.07)';
    ctx.beginPath(); ctx.ellipse(W / 2, GY + 28, W * 0.56, 26, 0, 0, 7); ctx.fill();
    // moon reflection on the path
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 2);
    ctx.fillStyle = lin(ctx, 'bam-refl', 0, GY, 0, H, [
      [0, 'rgba(253,246,216,1)'], [1, 'rgba(253,246,216,0)']
    ]);
    ctx.fillRect(180, GY, 140, H - GY);
    ctx.restore();
    neonEdge(ctx, 'bamboo', 'rgba(120,255,190,0.04)', 'rgba(140,255,200,0.55)', 'rgba(120,255,190,0.04)');
    ctx.restore();
  }
  function ambientBamboo(t, spawn) {
    if (Math.random() < 0.11) {
      spawn({
        type: 'firefly', x: rand(0, W), y: rand(180, 466),
        vx: rand(-0.25, 0.25), vy: rand(-0.2, 0.1), g: 0,
        life: rand(140, 260), color: 'rgba(190,255,120,0.9)', size: rand(1.2, 2.6),
        sway: 0.08, seed: rand(0, 6.28)
      });
    }
    if (Math.random() < 0.02) {
      spawn({
        type: 'leaf', x: rand(0, W), y: -12,
        vx: rand(-0.5, -0.1), vy: rand(0.25, 0.5), g: 0,
        life: rand(240, 380), color: 'rgba(120,190,140,0.5)', size: rand(2, 3.6),
        sway: 0.15, seed: rand(0, 6.28)
      });
    }
  }

  // ==========================================================================
  //  4. AURORA PEAK — frozen summit under dancing lights
  // ==========================================================================
  function peaks(ctx, t, color, snow, arr) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-40, GY);
    for (var i = 0; i < arr.length; i++) {
      var bx = arr[i][0], top = arr[i][1], wdt = arr[i][2];
      ctx.lineTo(bx, GY);
      ctx.lineTo(bx + wdt * 0.5, top + Math.sin(t * 0.3 + i) * 3);
      ctx.lineTo(bx + wdt, GY);
    }
    ctx.lineTo(W + 40, GY);
    ctx.closePath();
    ctx.fill();
    // snow caps
    ctx.fillStyle = snow;
    for (var j = 0; j < arr.length; j++) {
      var bx2 = arr[j][0], top2 = arr[j][1], wdt2 = arr[j][2];
      var tipY = top2 + Math.sin(t * 0.3 + j) * 3;
      ctx.beginPath();
      ctx.moveTo(bx2 + wdt2 * 0.5, tipY);
      ctx.lineTo(bx2 + wdt2 * 0.5 - wdt2 * 0.17, tipY + wdt2 * 0.24);
      ctx.lineTo(bx2 + wdt2 * 0.5 + wdt2 * 0.17, tipY + wdt2 * 0.24);
      ctx.closePath();
      ctx.fill();
    }
  }

  function pineRidge(ctx) {
    ctx.fillStyle = '#050d16';
    ctx.beginPath();
    ctx.moveTo(-40, GY);
    for (var x = -40; x <= W + 40; x += 8) {
      ctx.lineTo(x, 432 + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.005) * 8);
    }
    ctx.lineTo(W + 40, GY);
    ctx.closePath();
    ctx.fill();
    for (var i = 0; i < 12; i++) {
      var px = R(i + 900) * W;
      var py = 431 + Math.sin(px * 0.02) * 4 + Math.sin(px * 0.005) * 8;
      var ph = R(i + 120) * 16 + 20;
      var pw = 7 + R(i + 40) * 5;
      ctx.beginPath();
      ctx.moveTo(px, py - ph);
      ctx.lineTo(px - pw, py);
      ctx.lineTo(px + pw, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawAurora(ctx, t) {
    ctx.save();

    ctx.fillStyle = lin(ctx, 'aur-sky', 0, 0, 0, GY, [
      [0, '#02040c'], [0.45, '#06182b'], [0.8, '#0a2c42'], [1, '#12405a']
    ]);
    ctx.fillRect(-40, -40, W + 80, GY + 40);

    stars(ctx, t, 90, 53, 300, '230,245,255');

    // aurora ribbons
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var ribbons = [
      { c: '65,255,168', a: 0.075, base: 70, amp: 34, sp: 0.25, off: 0.0 },
      { c: '53,224,255', a: 0.06, base: 112, amp: 40, sp: 0.19, off: 2.1 },
      { c: '192,91,255', a: 0.05, base: 152, amp: 30, sp: 0.31, off: 4.2 }
    ];
    for (var r = 0; r < ribbons.length; r++) {
      var rb = ribbons[r];
      var x, yTop;
      ctx.fillStyle = 'rgba(' + rb.c + ',' + rb.a + ')';
      ctx.beginPath();
      for (x = 0; x <= W; x += 24) {
        yTop = rb.base + Math.sin(x * 0.008 + t * rb.sp + rb.off) * rb.amp + Math.sin(x * 0.021 - t * 0.13 + rb.off) * 12;
        if (x === 0) ctx.moveTo(x, yTop); else ctx.lineTo(x, yTop);
      }
      for (x = W; x >= 0; x -= 24) {
        yTop = rb.base + Math.sin(x * 0.008 + t * rb.sp + rb.off) * rb.amp + Math.sin(x * 0.021 - t * 0.13 + rb.off) * 12;
        ctx.lineTo(x, yTop + 72 + Math.sin(x * 0.013 + t * 0.2) * 16);
      }
      ctx.closePath();
      ctx.fill();
      // bright core line
      ctx.strokeStyle = 'rgba(' + rb.c + ',0.16)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (x = 0; x <= W; x += 24) {
        yTop = rb.base + Math.sin(x * 0.008 + t * rb.sp + rb.off) * rb.amp + Math.sin(x * 0.021 - t * 0.13 + rb.off) * 12;
        if (x === 0) ctx.moveTo(x, yTop); else ctx.lineTo(x, yTop);
      }
      ctx.stroke();
    }
    ctx.restore();

    // moon
    ctx.fillStyle = rad(ctx, 'aur-moon', 850, 80, 0, 74, [
      [0, 'rgba(220,240,255,0.85)'], [0.35, 'rgba(170,210,255,0.22)'], [1, 'rgba(140,190,255,0)']
    ]);
    ctx.beginPath(); ctx.arc(850, 80, 74, 0, 7); ctx.fill();
    ctx.fillStyle = '#eef6ff';
    ctx.beginPath(); ctx.arc(850, 80, 26, 0, 7); ctx.fill();

    // mountains
    peaks(ctx, t, '#0d2033', 'rgba(220,238,255,0.85)', [
      [0, 300, 120], [170, 330, 150], [360, 290, 130], [560, 335, 160], [760, 300, 120], [930, 335, 140]
    ]);
    peaks(ctx, t, '#081422', 'rgba(188,216,240,0.8)', [
      [60, 360, 150], [280, 395, 180], [520, 350, 160], [740, 400, 170], [900, 360, 150]
    ]);
    pineRidge(ctx);

    // frozen ground
    groundBase(ctx, 'aurora', [[0, '#cfe4f4'], [0.12, '#8fb0c9'], [0.5, '#33506a'], [1, '#0a1119']]);
    for (var sp = 0; sp < 26; sp++) {
      var sx = R(sp + 33) * W, sy = GY + 2 + R(sp + 77) * 10;
      var tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 2.2 + sp * 1.9));
      ctx.fillStyle = 'rgba(255,255,255,' + (tw * 0.8).toFixed(3) + ')';
      ctx.fillRect(sx, sy, 2, 2);
    }
    // aurora tint reflected on the ice
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = lin(ctx, 'aur-refl', 0, GY, 0, H, [
      [0, 'rgba(65,255,168,1)'], [1, 'rgba(65,255,168,0)']
    ]);
    ctx.fillRect(0, GY, W, H - GY);
    ctx.restore();
    neonEdge(ctx, 'aurora', 'rgba(200,240,255,0.05)', 'rgba(220,245,255,0.85)', 'rgba(160,210,255,0.05)');
    ctx.restore();
  }
  function ambientAurora(t, spawn) {
    if (Math.random() < 0.5) {
      spawn({
        type: 'snow', x: rand(-40, W + 40), y: rand(-40, 110),
        vx: rand(-0.2, 0.2), vy: rand(0.3, 0.7), g: 0,
        life: rand(280, 460), color: 'rgba(240,250,255,0.85)', size: rand(1, 2.6),
        sway: 0.045 + Math.random() * 0.07, seed: rand(0, 6.28)
      });
    }
    if (Math.random() < 0.015) {
      spawn({
        type: 'spark', x: rand(0, W), y: GY + rand(0, 16),
        vx: 0, vy: -0.2, g: 0, life: rand(20, 40),
        color: 'rgba(200,240,255,0.7)', size: rand(1, 2), add: true
      });
    }
  }

  // ==========================================================================
  //  registry
  // ==========================================================================
  var LIST = [
    { id: 'sunset', name: 'Crimson Shrine', tag: 'Sunset Dojo', draw: drawSunset, amb: ambientSunset },
    { id: 'city', name: 'Neon District', tag: 'Rooftop Brawl', draw: drawCity, amb: ambientCity },
    { id: 'bamboo', name: 'Moonlit Bamboo', tag: 'Whispering Grove', draw: drawBamboo, amb: ambientBamboo },
    { id: 'aurora', name: 'Aurora Peak', tag: 'Frozen Summit', draw: drawAurora, amb: ambientAurora }
  ];
  var BY_ID = {};
  for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

  return {
    W: W, H: H, GY: GY,
    ids: LIST.map(function (m) { return m.id; }),
    list: LIST.map(function (m) { return { id: m.id, name: m.name, tag: m.tag }; }),
    randomId: function () { return LIST[Math.floor(Math.random() * LIST.length)].id; },
    name: function (id) { return (BY_ID[id] || LIST[0]).name; },
    draw: function (id, ctx, t) { (BY_ID[id] || LIST[0]).draw(ctx, t || 0); },
    ambient: function (id, t, spawn) { (BY_ID[id] || LIST[0]).amb(t, spawn); }
  };
});
