/* ============================================================================
   SHADOW CLASH — game server
   ----------------------------------------------------------------------------
   * serves the game files (plain http, no frameworks)
   * runs a tiny RFC6455 WebSocket server (no npm install needed at all)
   * runs the authoritative 60 fps simulation for every room
   Start with:  node server.js        (or double-click "START GAME.bat")
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const dgram = require('dgram');
const Sim = require('./public/sim.js');
const Maps = require('./public/maps.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const START_PORT = Number(process.env.PORT) || 3000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TICK_MS = 1000 / 60;
const MAX_ROOM_LIFE = 40 * 60 * 1000;   // empty rooms are cleaned after 40 min

// ------------------------------------------------------------------ plumbing
function log(...a) { console.log('[shadow-clash]', ...a); }

function lanCandidates() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const virtual = /virtual|vbox|vmware|hyper|wsl|docker|loopback|bluetooth|tailscale|zerotier|radmin|hamachi/i.test(name);
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push({
          name: name,
          address: a.address,
          virtual: virtual,
          preferred: /wi-?fi|wlan|wireless|ethernet|eth|en0|en1/i.test(name)
        });
      }
    }
  }
  out.sort(function (x, y) {
    if (x.address === preferredAddr) return -1;
    if (y.address === preferredAddr) return 1;
    if (x.virtual !== y.virtual) return x.virtual ? 1 : -1;
    if (x.preferred !== y.preferred) return x.preferred ? -1 : 1;
    return 0;
  });
  return out;
}

function lanAddress() {
  if (preferredAddr) return preferredAddr;
  const c = lanCandidates();
  return c.length ? c[0].address : 'localhost';
}

// find the address the OS would actually use for the internet / LAN
let preferredAddr = null;
function probePrimaryAddress(cb) {
  let done = false;
  const finish = (addr) => {
    if (done) return;
    done = true;
    if (addr) preferredAddr = addr;
    cb(addr);
  };
  try {
    const s = dgram.createSocket('udp4');
    s.connect(53, '8.8.8.8', () => {
      let addr = null;
      try { addr = s.address().address; } catch (e) { /* ignore */ }
      try { s.close(); } catch (e) { /* ignore */ }
      finish(addr);
    });
    s.on('error', () => { try { s.close(); } catch (e) { /* ignore */ } finish(null); });
    setTimeout(() => { try { s.close(); } catch (e) { /* ignore */ } finish(null); }, 400);
  } catch (e) {
    finish(null);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

// ------------------------------------------------- minimal websocket server
class WSClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.dead = false;
    this.lastPong = Date.now();
    this.onMessage = null;
    this.onClose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > 2 * 1024 * 1024) return this.close();
    for (;;) {
      const f = this.readFrame();
      if (!f) break;
      if (f.opcode === 0x8) { this.close(); break; }
      else if (f.opcode === 0x9) this.pong(f.payload);
      else if (f.opcode === 0xA) this.lastPong = Date.now();
      else if (f.opcode === 0x1 || f.opcode === 0x2 || f.opcode === 0x0) {
        if (f.opcode === 0x0) this.frags.push(f.payload);
        else this.frags = [f.payload];
        if (f.fin) {
          const data = Buffer.concat(this.frags);
          this.frags = [];
          try { this.onMessage && this.onMessage(data.toString('utf8')); } catch (e) { log('handler error', e); }
        }
      }
    }
  }

  readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0F;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7F;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      len = Number(b.readBigUInt64BE(2)); off = 10;
    }
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4);
      off += 4;
    }
    if (b.length < off + len) return null;
    let payload = b.subarray(off, off + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  send(str) {
    if (this.dead) return;
    const data = Buffer.from(str, 'utf8');
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, data])); } catch (e) { this.close(); }
  }

  sendJSON(obj) { this.send(JSON.stringify(obj)); }

  ping() {
    if (this.dead) return;
    try { this.socket.write(Buffer.from([0x89, 0x00])); } catch (e) { this.close(); }
  }

  pong(payload) {
    if (this.dead) return;
    try {
      this.socket.write(Buffer.concat([Buffer.from([0x8A, payload.length]), payload]));
    } catch (e) { this.close(); }
  }

  close() {
    if (this.dead) return;
    this.dead = true;
    try { this.socket.end(Buffer.from([0x88, 0x00])); } catch (e) { /* ignore */ }
    if (this.onClose) this.onClose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const ws = new WSClient(socket);
  const player = { ws, name: 'PLAYER', token: null, seat: -1, room: null, input: 0, pressed: 0, vote: false };
  ws.onMessage = (text) => handleMessage(player, text);
  ws.onClose = () => dropPlayer(player);
});

// ------------------------------------------------------------------- rooms
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function makeRoom() {
  const room = {
    code: makeCode(),
    slots: [null, null],
    game: null,
    map: Maps.randomId(),
    mapPicked: false,
    started: false,
    purgeTimer: null,
    lastActivity: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

function other(player) {
  return player.room ? player.room.slots[1 - player.seat] : null;
}

function send(player, obj) {
  if (player && player.ws && !player.ws.dead) player.ws.sendJSON(obj);
}

function broadcast(room, obj) {
  for (const p of room.slots) if (p) send(p, obj);
}

function bothReady(room) {
  return !!(room.slots[0] && room.slots[1] && room.slots[0].ws && room.slots[1].ws) &&
    room.slots[0].seat >= 0 && room.slots[1].seat >= 0;
}

function startMatch(room) {
  room.game = Sim.createGame();
  room.started = true;
  broadcast(room, {
    t: 'start',
    names: [room.slots[0].name, room.slots[1].name],
    map: room.map
  });
  log(`room ${room.code}: match started on ${room.map}`);
}

function safeName(n) {
  return String(n || 'PLAYER').replace(/[^\w \-\.]/g, '').slice(0, 14).toUpperCase() || 'PLAYER';
}

function handleMessage(player, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;

  switch (m.t) {
    case 'create': {
      leaveRoom(player, false);
      const room = makeRoom();
      player.name = safeName(m.name);
      player.token = crypto.randomBytes(8).toString('hex');
      player.seat = 0;
      player.room = room;
      room.slots[0] = player;
      send(player, { t: 'w', seat: 0, code: room.code, token: player.token, lan: lanAddress(), map: room.map });
      if (bothReady(room)) startMatch(room); else send(player, { t: 'wait' });
      log(`room ${room.code} created by ${player.name}`);
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) { send(player, { t: 'err', m: 'Room "' + code + '" not found. Check the code.' }); break; }

      // reconnect with token?
      let slotIdx = -1;
      if (m.token) {
        for (let i = 0; i < 2; i++) {
          if (room.slots[i] && room.slots[i].token === m.token) { slotIdx = i; break; }
        }
      }
      if (slotIdx === -1) {
        if (!room.slots[0]) slotIdx = 0;
        else if (!room.slots[1]) slotIdx = 1;
        else {
          // Reloaded the page and lost the token? Take over a disconnected seat:
          // prefer the seat with the same player name, otherwise any empty ghost.
          const wantedName = safeName(m.name);
          let ghost = -1;
          if (room.slots[0] && !room.slots[0].ws && room.slots[0].name === wantedName) ghost = 0;
          else if (room.slots[1] && !room.slots[1].ws && room.slots[1].name === wantedName) ghost = 1;
          if (ghost === -1) {
            if (room.slots[1] && !room.slots[1].ws && !(room.slots[0] && !room.slots[0].ws)) ghost = 1;
            else if (room.slots[0] && !room.slots[0].ws) ghost = 0;
          }
          if (ghost >= 0) slotIdx = ghost;
          else {
            send(player, { t: 'err', m: 'Room ' + code + ' is full.' });
            break;
          }
        }
      }

      const old = room.slots[slotIdx];
      if (old && old.ws && old.ws !== player.ws) {
        try { old.ws.close(); } catch (e) { /* ignore */ }
      }
      leaveRoom(player, false);
      player.name = old ? old.name : safeName(m.name);
      player.token = (old && old.token) || crypto.randomBytes(8).toString('hex');
      player.seat = slotIdx;
      player.room = room;
      room.slots[slotIdx] = player;
      room.lastActivity = Date.now();
      if (room.purgeTimer) { clearTimeout(room.purgeTimer); room.purgeTimer = null; }

      send(player, { t: 'w', seat: player.seat, code: room.code, token: player.token, lan: lanAddress(), map: room.map });
      log(`room ${room.code}: ${player.name} joined seat ${slotIdx}`);

      if (bothReady(room)) {
        if (room.game) {
          room.game.paused = false;
          broadcast(room, { t: 'resumed' });
          broadcast(room, { t: 'st', s: Sim.snapshot(room.game) });
          room.game.fx = [];
        } else {
          startMatch(room);
        }
      } else {
        send(player, { t: 'wait' });
      }
      break;
    }
    case 'i': {
      if (player.seat < 0 || !player.room || !player.room.game || player.room.game.over) break;
      player.input = m.k | 0;
      player.pressed |= (m.p | 0);
      break;
    }
    case 'map': {
      const room = player.room;
      if (!room || player.seat !== 0) break;                   // host only
      if (room.game && !room.game.over) break;                 // locked during a match
      if (Maps.ids.indexOf(String(m.id)) === -1) break;        // unknown arena
      room.map = String(m.id);
      room.mapPicked = true;
      broadcast(room, { t: 'map', id: room.map });
      log(`room ${room.code}: map set to ${room.map}`);
      break;
    }
    case 'rematch': {
      const room = player.room;
      if (!room || !room.game || !room.game.over) break;
      player.vote = true;
      const bothVoted = room.slots[0] && room.slots[1] && room.slots[0].vote && room.slots[1].vote;
      if (bothVoted) {
        room.slots[0].vote = room.slots[1].vote = false;
        Sim.resetMatch(room.game);
        if (!room.mapPicked) room.map = Maps.randomId();   // surprise reroll
        broadcast(room, { t: 'rematch', map: room.map });
        log(`room ${room.code}: rematch on ${room.map}`);
      } else {
        send(player, { t: 'vote' });
        send(other(player), { t: 'oppVote' });
      }
      break;
    }
    case 'ping': {
      send(player, { t: 'pong', ts: m.ts });
      break;
    }
    case 'leave': {
      leaveRoom(player, true);
      break;
    }
  }
}

function leaveRoom(player, notify) {
  const room = player.room;
  if (!room) return;
  if (room.slots[player.seat] === player) room.slots[player.seat] = null;
  player.room = null;
  player.seat = -1;
  player.vote = false;
  if (notify) {
    const o = room.slots[0] || room.slots[1];
    if (o) send(o, { t: 'left' });
  }
  if (!room.slots[0] && !room.slots[1]) {
    if (room.purgeTimer) clearTimeout(room.purgeTimer);
    rooms.delete(room.code);
    log(`room ${room.code}: closed`);
  }
}

function dropPlayer(player) {
  const room = player.room;
  if (!room) return;
  player.ws = null;

  if (room.game && room.started) {
    room.game.paused = true;
    const o = room.slots[1 - player.seat];
    if (o) send(o, { t: 'paused' });
    log(`room ${room.code}: player ${player.seat + 1} disconnected — waiting 40s for reconnect`);
    if (room.purgeTimer) clearTimeout(room.purgeTimer);
    room.purgeTimer = setTimeout(() => {
      if (!room.slots[0] || !room.slots[1] ||
          (room.slots[0] && !room.slots[0].ws) || (room.slots[1] && !room.slots[1].ws)) {
        const o2 = room.slots[1 - player.seat];
        if (o2) { send(o2, { t: 'left' }); o2.room = null; o2.seat = -1; }
        rooms.delete(room.code);
        log(`room ${room.code}: closed (reconnect timeout)`);
      }
    }, 40000);
  } else {
    // not started: free the seat so someone else can join
    if (room.slots[player.seat] === player) room.slots[player.seat] = null;
    player.room = null;
    player.seat = -1;
    const o = room.slots[0] || room.slots[1];
    if (o) send(o, { t: 'wait' });
    if (!room.slots[0] && !room.slots[1]) {
      rooms.delete(room.code);
      log(`room ${room.code}: closed (empty)`);
    }
  }
}

// ----------------------------------------------------------------- main loop
let lastTime = Date.now();
let acc = 0;

setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;

  while (acc >= 1 / 60 && steps < 5) {
    acc -= 1 / 60;
    steps++;
    for (const room of rooms.values()) {
      const g = room.game;
      if (!g || g.paused || !bothReady(room)) continue;

      for (let i = 0; i < 2; i++) {
        const p = room.slots[i];
        const f = g.fighters[i];
        f.input = p.input;
        f.pressed = p.pressed;
        p.pressed = 0;
      }

      Sim.update(g);

      const msg = JSON.stringify({ t: 'st', s: Sim.snapshot(g) });
      g.fx = [];
      for (const p of room.slots) if (p && p.ws && !p.ws.dead) p.ws.send(msg);
    }
  }

  // housekeeping: heartbeat + stale room cleanup (every ~5s)
  if (Date.now() % 5000 < 6) {
    for (const room of rooms.values()) {
      for (const p of room.slots) {
        if (!p || !p.ws || p.ws.dead) continue;
        if (Date.now() - p.ws.lastPong > 45000) p.ws.close();
        else p.ws.ping();
      }
      if ((!room.slots[0] || !room.slots[1]) && !room.purgeTimer &&
          Date.now() - room.lastActivity > MAX_ROOM_LIFE) {
        if (room.slots[0]) { room.slots[0].room = null; send(room.slots[0], { t: 'left' }); }
        if (room.slots[1]) { room.slots[1].room = null; send(room.slots[1], { t: 'left' }); }
        rooms.delete(room.code);
      }
    }
  }
}, 4);

// ------------------------------------------------------------------- startup
function listen(port, tries) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries > 0) {
      log(`port ${port} busy, trying ${port + 1}...`);
      setTimeout(() => listen(port + 1, tries - 1), 50);
    } else {
      console.error('Failed to start:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const lan = lanAddress();
    const cands = lanCandidates();
    const line = '='.repeat(52);
    console.log('\n' + line);
    console.log('   S H A D O W   C L A S H        (server running)');
    console.log(line);
    console.log('   On this computer   :  http://localhost:' + port);
    console.log('   For your friend    :  http://' + lan + ':' + port);
    if (cands.length > 1) {
      console.log('   Other addresses    :  ' + cands.slice(1).map(function (c) { return 'http://' + c.address + ':' + port; }).join('  '));
    }
    console.log(line);
    console.log('   1. Open the link, enter a name, CREATE ROOM');
    console.log('   2. Send the 4-letter code (or the link) to your friend');
    console.log('   3. Fight!  (Ctrl+C here stops the server)');
    console.log(line + '\n');
    if (process.argv.includes('--open')) {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32' ? 'start "" "http://localhost:' + port + '"'
        : process.platform === 'darwin' ? 'open "http://localhost:' + port + '"'
        : 'xdg-open "http://localhost:' + port + '"';
      exec(cmd, () => { /* ignore */ });
    }
  });
}

// (probe first so the friend-link is the address your Wi-Fi actually uses)
probePrimaryAddress(function () {
  listen(START_PORT, 10);
});
