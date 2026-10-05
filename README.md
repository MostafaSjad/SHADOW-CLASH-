# 🔥 SHADOW CLASH

**A 2-player 1v1 fighting game that runs in the browser. You open it on your PC, your friend opens it on theirs, and you fight in real time.**

- 🥊 Full fighting-game systems: walking, jumping, crouching, blocking, combos, hitstop, chip damage, best-of-3 rounds
- 🔥 Fill your meter, throw fireballs, and at 100% unleash a **screen-wide SUPER BEAM** (with super armor)
- 🗺️ **4 hand-drawn arenas** — Crimson Shrine, Neon District, Moonlit Bamboo and Aurora Peak — with the host picking the stage in the lobby (or random)
- 🌐 Online play with 4-letter room codes and shareable invite links — same Wi-Fi or over the internet
- ⌨️ Bonus mode: **2 players on one keyboard** + a CPU demo fight on the title screen
- 📦 **Zero dependencies.** One command to run: `node server.js`
- 🎨 No asset files at all — every pixel is drawn with Canvas 2D, every sound is synthesized with Web Audio

**First to win 2 rounds wins the match.**

---

## Table of contents

1. [Requirements](#requirements)
2. [Quick start — same Wi-Fi (30 seconds)](#quick-start--same-wi-fi-30-seconds)
3. [Playing over the internet](#playing-over-the-internet)
4. [Controls](#controls)
5. [How a match works (rules)](#how-a-match-works-rules)
6. [Combat guide + full frame data](#combat-guide--full-frame-data)
7. [HUD explained](#hud-explained)
8. [Arenas (the four maps)](#arenas-the-four-maps)
9. [Lobby, invite links and reconnection](#lobby-invite-links-and-reconnection)
10. [Project structure](#project-structure)
11. [How it works (architecture)](#how-it-works-architecture)
12. [Network protocol reference](#network-protocol-reference)
13. [Running the server](#running-the-server)
14. [Testing](#testing)
15. [Tweaking the game](#tweaking-the-game)
16. [Troubleshooting](#troubleshooting)
17. [FAQ](#faq)
18. [Known limitations](#known-limitations)
19. [License](#license)

---

## Requirements

| | |
|---|---|
| **Node.js** | version 16 or newer ([nodejs.org](https://nodejs.org), LTS button). Only the *host* needs it. |
| **Browser** | any modern browser: Chrome, Edge, Firefox, Safari 15+. Needs WebSocket, Canvas 2D and Web Audio. |
| **Keyboard** | a real keyboard. This is a fighting game — no touch controls (yet). |
| **Network** | the two players must be able to reach each other: same Wi-Fi / hotspot, a virtual LAN, a tunnel, or a port-forward (all explained below). |

The game is **zero-dependency**: there is nothing to `npm install`. The WebSocket protocol is implemented by hand inside `server.js`.

---

## Quick start — same Wi-Fi (30 seconds)

**1. Host (you):**

- **Windows:** double-click **`START GAME.bat`** — it starts the server *and* opens your browser.
- **Any OS / terminal:**
  ```bash
  node server.js
  # or: npm start
  ```

The server prints a box like this:

```
====================================================
   S H A D O W   C L A S H        (server running)
====================================================
   On this computer   :  http://localhost:3000
   For your friend    :  http://192.168.1.42:3000
   Other addresses    :  http://192.168.1.99:3000
====================================================
```

**2. You** open `http://localhost:3000`, type a name, press **CREATE ROOM**. A big 4-letter code appears (e.g. `KX7Q`).

**3. Your friend** opens the **"For your friend"** link (same Wi-Fi), types a name, enters the code, presses **JOIN**.
Shortcut: in the waiting room press **COPY INVITE LINK** and send them the link — it carries the room code automatically (`http://192.168.1.42:3000/?room=KX7Q`).

**4. FIGHT.** First to 2 rounds takes the match.

> The Windows Firewall may pop up the first time Node listens on the network — choose **Allow** on *Private networks*, or your friend won't be able to connect.

> **Testing solo:** open two browser windows (one in Incognito) on the same PC, create a room in one, join in the other. Works perfectly.

**If the printed "friend" address looks wrong** (e.g. a VirtualBox/VMware address like `192.168.56.1`), the server also lists *Other addresses* — try those, or run `ipconfig` (Windows) / `ifconfig` (macOS/Linux) and use the IPv4 of your Wi-Fi adapter.

---

## Playing over the internet

The game is a normal HTTP + WebSocket server, so any standard way of exposing it works. Easiest first:

### Option A — Free tunnel (recommended)

Run one of these on the host machine while the game server is running:

```bash
# Cloudflare Tunnel (no account needed for quick tunnels)
cloudflared tunnel --url http://localhost:3000

# or ngrok
ngrok http 3000
```

Both print a public `https://…` URL — send it to your friend, done. (Your browser will then use `wss://` automatically.)

### Option B — Virtual LAN (Tailscale / ZeroTier / Radmin VPN)

1. Install [Tailscale](https://tailscale.com), [ZeroTier](https://zerotier.com) or Radmin VPN **on both PCs** and join the same network.
2. Start the game server.
3. The server prints all your addresses — use the one belonging to the virtual adapter (e.g. Tailscale `100.x.x.x`).
   Your friend opens `http://<that-address>:3000`.

### Option C — Port forwarding

1. Forward TCP port **3000** on your router to the host PC's local IP.
2. Your friend opens `http://<your-public-IP>:3000`.
3. Beware: this exposes the game to the internet. Anyone with the URL/room code could join your room; there is no password.

### Latency expectations

The match is **server-authoritative at 60 fps** and clients render interpolated snapshots, so the game stays smooth even with some ping:

| Ping | Feel |
|---|---|
| 0–30 ms (LAN) | perfect |
| 30–80 ms | very good |
| 80–120 ms | still playable |
| 120 ms+ | noticeable, but the world never desyncs |

The current ping is shown in the bottom-right corner of the game.

---

## Controls

### Online (each player in their own browser uses these)

| Action | Key |
|---|---|
| Move left / right | **A** / **D** (or ← / →) |
| Jump | **W** (or ↑) |
| Crouch | **S** (or ↓) |
| Punch | **J** |
| Kick | **K** |
| Block (hold) | **L** |
| Fireball (costs 50% meter) | **I** or **Space** |
| Super Beam (at 100% meter — same button) | **I** or **Space** |
| Super (alternate input) | **J + K** pressed together at 100% |
| Mute / unmute sound | **M** |
| Show / hide the controls bar | **H** |

### Local mode: 2 players on ONE keyboard

From the menu press **⌨ 2 PLAYERS · SAME KEYBOARD**.

| Action | Player 1 | Player 2 |
|---|---|---|
| Move left / right | **A** / **D** | **←** / **→** |
| Jump | **W** | **↑** |
| Crouch | **S** | **↓** |
| Punch | **J** | **,** or **Num 1** |
| Kick | **K** | **.** or **Num 2** |
| Block (hold) | **L** | **/** or **Num 3** |
| Fireball / Super | **I** or **Space** | **;** or **Num 0** or **Num 5** |
| Return to menu | **Esc** | — |

### Text fields

- While you are typing in the name or room-code field, **all game keys are released** — you can type any letter, including WASD/M/H.
- **Enter** in a field submits: it joins if a 4-letter code is filled in, otherwise it creates a room.
- **Esc** while typing just unfocuses the field.

---

## How a match works (rules)

- **Format:** best of 3 — *first to win 2 rounds* wins the match. The match ends after at most 5 rounds (a draw is possible if nobody reaches 2).
- **Round timer:** 60 seconds. When it hits zero, the fighter with more HP takes the round. Equal HP = **DRAW** round (nobody gets a point, next round is played).
- **Round intro:** every round starts with a "ROUND N" banner and then "FIGHT!". You cannot move during the intro.
- **Reset between rounds:** HP refills to 100, positions reset — but **your meter carries over** between rounds of the same match. A rematch starts both fighters at 0 meter.
- **Winning a round:** reduce the opponent to 0 HP (KO) or have more HP at time-up. Chip damage *can* finish a round.
- **KO:** the loser is launched and knocked down, "K.O." banner, then the next round (or the match result) follows.
- **Match end:** the winner strikes a victory pose; the big banner stays. Press **REMATCH** to run it back — *both* players must press it (a vote indicator appears).
- **Disconnection:** the match pauses and the other player sees "OPPONENT DISCONNECTED". The leaver has **40 seconds** to come back (just reopen the page and rejoin the room — their seat is kept). After 40 s the room closes and the remaining player is notified.

---

## Combat guide + full frame data

All numbers are in **frames at 60 fps** (60 frames = 1 second). Distances are in stage pixels; the stage is 960 px wide and the fighters are ~52 px wide.

### Core systems

| System | Details |
|---|---|
| **Health** | 100 HP each. |
| **Walking** | 3.1 px/frame (≈186 px/s). |
| **Jump** | initial speed 14.4, gravity 0.68/frame → ≈152 px high, ≈0.7 s airtime. Air control adds up to 1.5× walk speed. One air attack per jump. |
| **Blocking** | Hold the block key (grounded only — you cannot block in the air). Blocked hits deal **0 damage** except chip damage. Blocking pushes you back. Crouch-blocking also works. |
| **Chip damage** | Only the **fireball (2)** and the **super beam (6)** deal chip through a block. Chip can KO. |
| **Meter** | 0–100. Passively regenerates ≈1.8/s (full in ~55 s), more from attacking. You also gain some meter when you *take* damage. |
| **Combo scaling** | Each extra hit in a combo multiplies its damage by `max(30%, 100% − 9% × hits)`. Long combos do less per hit. |
| **Combo timer** | A combo ends ~0.9 s after the last hit. |
| **Hitstop** | Both fighters freeze briefly on contact: 4 frames (light), 6 (heavy), 10 (super). Blocking freezes 3 frames. |
| **Pushboxes** | Fighters cannot overlap (44 px minimum separation); an airborne fighter gets pushed much more. |
| **Facing** | Automatic — grounded fighters always turn toward the opponent (including during walks). |

### Attack frame data

`Startup / Active / Recovery` = the three phases of every move. The hitbox is only live during *Active*. Damage listed is unscaled.

| Move | Startup | Active | Recovery | Damage | Reach (forward) | Height | On hit (hitstun) | On block (blockstun) | Meter gain | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Punch** | 3 | 4 | 8 | 6 | 28–78 | 58–98 (upper body) | 15 | 8 | 6 | tiny forward lunge (0.6) |
| **Crouch punch** | 3 | 4 | 8 | 6 | 26–74 | 38–72 (low) | 15 | 8 | 6 | |
| **Kick** | 8 | 5 | 15 | 10 | 24–98 | 32–80 (mid) | 19 | 10 | 8 | big forward lunge (2.0) |
| **Low sweep** (crouch + kick) | 6 | 4 | 14 | 8 | 22–96 | 4–44 (feet) | 18 | 9 | 7 | |
| **Air attack** (jump + punch/kick) | 4 | 9 | 8 | 9 | 10–70 | −30…30 relative to feet | 17 | 9 | 7 | cancelled on landing |
| **Fireball** (special, 50 meter) | 13 | — | 20 | 10 | projectile | full body | 22 | 12 | 4 | chip 2; projectile speed 8.6 px/frame |
| **SUPER BEAM** (special at 100 meter) | 46 charge | 26 beam | — | 32 | full screen | full body | 34 | 18 | — | chip 6; huge knockback (launch 9) |

Extra details:

- **Fireball** leaves your hands at frame 13 of the move, travels horizontally at chest height (56 px), and disappears at the screen edge. Two fireballs that meet **destroy each other**.
- **Super Beam** costs all 100 meter. While charging *and* firing, you have **super armor**: you keep going but take only 60% damage and no hitstun. The beam covers the entire ground level to the screen edge and hits once for massive knockback.
- **Getting hit while attacking cancels your attack.**
- **Air attack reaches downward** — it whiffs if you are too high, and hits grounded opponents when you come down.
- **Blocking a fireball/beam** still pushes you back; blocking builds a little meter for both players.

### Round flow in the simulation

```
intro (110 frames ≈ 1.8 s)  →  fight (≤ 60 s)  →  roundEnd (210 frames ≈ 3.5 s)
      ↑                                                            |
      └────────────── next round (if wins < 2 and round < 5) ──────┘
```

---

## HUD explained

```
 PLAYER 1 (P1)                    60                   PLAYER 2 (P2)
 [████████████████████░░]      ROUND 2        [░░████████████████████]
 ○ ●                                        ● ○
 [meter ██████░░]                                       [meter ░░██████]
```

- **Health bar** — drains toward the center. A yellow "ghost" layer lags behind real HP; the fill blinks when you are below 25%.
- **Round pips** (○ ●) under each name — one per round won.
- **Timer** — turns red and blinks under 10 seconds.
- **Meter bars** — segmented at 50% and 100%. `50` = fireball available; `100` = the bar pulses and the **SUPER** is ready (a golden glow also appears under your fighter).
- **Combo counter** — "N HITS" pops up on the attacking player's side once a combo reaches 2.
- **Banners** — ROUND N / FIGHT! / K.O. / TIME UP / PLAYER X WINS! appear center screen.
- **Bottom center** — controls cheat-sheet (H toggles).
- **Bottom right** — ping and room code; the dot turns red above 160 ms ping.
- **REMATCH button** — appears at match end; both players must press it.

---

## Arenas (the four maps)

All four stages are **drawn by code** (`public/maps.js`) — no image files anywhere. Each one is a pure `draw(ctx, time)` function, which is why the lobby thumbnails are real previews of the maps (rendered once into tiny canvases) rather than static screenshots.

| # | Arena | Vibe | Ambience |
|---|---|---|---|
| 1 | **Crimson Shrine** — *Sunset Dojo* | Golden-hour sky, glowing sun, mountains, pagoda, torii gate, swaying paper lanterns | rising embers, distant birds |
| 2 | **Neon District** — *Rooftop Brawl* | Midnight skyline with lit windows, sweeping searchlights, neon signs and a flickering **SHADOW** billboard, wet-roof puddle reflections | drifting cyan/magenta light motes |
| 3 | **Moonlit Bamboo** — *Whispering Grove* | Giant moon, three parallax layers of swaying bamboo with leaves, drifting fog, glowing stone lantern, reflected moonlight on the path | fireflies + falling leaves |
| 4 | **Aurora Peak** — *Frozen Summit* | Dancing green/cyan/violet aurora ribbons, snowy peaks, pine ridge, frozen ground with an aurora tint and sparkles | swaying snowfall |

**How an arena gets chosen:**

- **Online:** every room starts with a random arena. The **host** can change it in the waiting room by clicking one of the four thumbnails; the guest sees the full strip too (dimmed, "— host picks") and both clients stay in sync through the server. The current arena name is shown under the round counter in the HUD.
- **Rematch:** if the host never manually picked, the rematch **rerolls to a random arena** for variety; if they did pick one, it stays.
- **Local 2P:** pick any arena (or leave the random one) on the setup screen before pressing START FIGHT.
- **Title screen:** the CPU demo fight rotates to a random arena whenever it resets, so the menu shows off all four.

Each map also has its own ambient particle weather (embers, motes, fireflies, snow) that drifts through the fight.

---

## Lobby, invite links and reconnection

- **Room codes** are exactly 4 characters from a 32-character alphabet that avoids lookalikes: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `I`, `O`, `0` or `1`. Lowercase input is fine. Someone else hosting and typing the wrong code sees "Room "XXXX" not found. Check the code."
- **Invite links** look like `http://192.168.1.42:3000/?room=KX7Q`. Opening one pre-fills the room code and puts a toast on screen; type a name, press **JOIN** (or just **Enter**).
- **Third player** trying to join a full room gets "Room XXXX is full."
- **Reconnection keeps your seat:**
  - A random secret *token* is stored in your browser's `sessionStorage` when you join.
  - If your connection drops, the server pauses the match and keeps your seat for **40 seconds**. Your client automatically tries to reconnect ~12 times.
  - If you reload the page and join the same code again, the server recognizes your saved token — or, failing that, matches your **player name** against the seat left by the disconnected player. Either way you get your seat and the match resumes exactly where it paused.
- **Leaving:** the **← BACK** button in the waiting room leaves the room. Once a match has started there's no in-game "leave" button; close the tab (the other side sees the pause, then "opponent left" after 40 s).
- The host keeps the server running for as long as you want the room to exist. When the server process stops, everything is gone.

---

## Project structure

```
Suprice/
├── START GAME.bat          Windows one-click launcher (checks Node, starts server, opens browser)
├── server.js               HTTP static server + hand-written WebSocket server + authoritative game loop
├── package.json            name/scripts only — zero dependencies
├── README.md               this file
├── .gitignore
├── public/
│   ├── index.html          menu, waiting room, HUD markup, local-2P help screen
│   ├── style.css           neon arcade styling (pure CSS, no fonts/images)
│   ├── sim.js              ⭐ the whole combat simulation — shared by server AND browser
│   ├── maps.js             ⭐ the four arenas, drawn entirely in code — ids shared with the server
│   └── client.js           rendering, particles, screen shake, audio synthesis, input, netcode
└── tests/
    ├── run_all.js          runs the three suites below (npm test)
    ├── test_sim.js         headless combat tests + 3-minute random fuzz
    ├── test_net.js         real end-to-end test: starts the server, talks WebSocket, plays inputs
    └── test_client.js      loads client.js in a stubbed DOM/canvas and drives attract/local/net modes
```

`public/sim.js` is the heart of the game: the **same file** runs on the Node server (for online matches) and inside the browser (for local 2P and the title-screen demo fight). Physics, frame data and rules can therefore never disagree between the two.

---

## How it works (architecture)

### Server-authoritative simulation

```
client A ──inputs──┐                       ┌──snapshot──▶ client A
                   ├─▶ SERVER (60 Hz sim) ─┤
client B ──inputs──┘                       └──snapshot──▶ client B
```

- Clients never decide anything about the world. They send **only their own input bits** (held + newly pressed) — up to 60 messages/second.
- The server runs a fixed-timestep loop (accumulator, 4 ms timer, up to 5 catch-up steps) and calls `Sim.update(game)` exactly 60 times per second for every room.
- After each tick it serializes one `Sim.snapshot(game)` to JSON and sends it to both players in the room. Events (hits, blocks, dust, bells…) are attached as an `fx` array and cleared immediately after sending, so each event is delivered exactly once.
- Because the server owns the simulation, **cheating by editing the client is impossible** and the two browsers can never desync.

### Client rendering & "game feel"

- Clients keep a small buffer of the last ~40 snapshots. They render **48 ms in the past**, interpolating positions between the two snapshots that surround that moment; discrete fields (state, HP, banners) come from the newest snapshot. This hides jitter without adding meaningful input lag on a LAN.
- Simulated at 60 fps, rendered at the display's refresh rate.
- **Juice:** screen shake, white impact flash, hitstop freeze frames, expanding rings, sparks, dust, fireball trails, muzzle flares, floating damage numbers, combo popups, KO bursts.
- The fighters are drawn procedurally: capsule limbs, per-state poses (idle breathing, walk cycle, guard, hit reaction, KO fall, charged super, victory pose), plus headband ribbons that wave with time. Player 1 is blue/cyan, Player 2 is red/gold.
- Every arena is a stack of parallax layers (sky gradients, celestial bodies, mountains / skylines / bamboo forests / aurora ribbons, then the stage floor) plus its own ambient particles. Because each map is a pure function of time, it can be rendered into the game canvas or into the tiny lobby thumbnails with the same code.

### Audio

Everything is generated with the Web Audio API at runtime — **no audio files**:

- per-event synthesizers: punch thump, whoosh, block click, fireball sweep, beam wall-of-noise, KO boom, charge-up, bells, clash;
- a chiptune loop at 116 BPM (triangle bass, square arpeggio, noise hats);
- `M` mutes everything (master gain), and the music scheduler handles mute/unmute without bursts or drift.

### Local 2P and the attract screen

The same `sim.js` runs in the browser for:

- **Local 2P mode** — two keyboard maps feed the two fighters; the simulation advances in lockstep with the browser's frame clock using the same accumulator approach.
- **The title screen** — a CPU-vs-CPU demo fight behind the menu. Simple bot logic (approach/retreat/attack/fireball) keeps it lively; if the CPU match ends, it resets after a few seconds.

---

## Network protocol reference

Everything is JSON text over a WebSocket. Clients send **inputs**, the server sends **state**. Message size is capped at 2 MB; malformed messages are ignored.

### Client → Server

| `t` | Payload | Meaning |
|---|---|---|
| `create` | `name` | Create a room and take seat 0. |
| `join` | `code`, `name`, `token?` | Join (or rejoin) a room. `token` from a previous join = reclaim your seat. |
| `i` | `k` (held bits), `p` (newly-pressed bits) | Input state. Sent every frame while playing. |
| `map` | `id` | Host only, lobby only: choose the arena from `maps.js`. |
| `rematch` | — | Vote for a rematch (only valid after the match ended). |
| `ping` | `ts` | RTT probe; timestamp echoed back. |
| `leave` | — | Leave the room (waiting-room back button). |

### Server → Client

| `t` | Payload | Meaning |
|---|---|---|
| `w` | `seat`, `code`, `token`, `lan`, `map` | Welcome / seat taken. `lan` = best LAN address for invite links; `map` = current arena. |
| `wait` | — | You are alone in the room; waiting for an opponent. |
| `start` | `names[2]`, `map` | Both seats filled — the match begins on `map`. |
| `st` | `s` (snapshot) | World state, ~60×/second. See below. |
| `paused` | — | Opponent's connection dropped; sim is frozen. |
| `resumed` | — | Opponent came back; sim resumed. |
| `left` | — | Opponent left / grace period expired. |
| `vote` | — | Your rematch vote was registered, waiting for the other player. |
| `oppVote` | — | The opponent pressed rematch. |
| `rematch` | `map` | Both voted — a fresh match starts now on `map` (rerolled if the host hadn't picked one). |
| `pong` | `ts` | Reply to `ping`; client computes RTT. |
| `err` | `m` | Error text (e.g. "Room not found", "Room is full"). |

### Input bitmask (`k` and `p`)

| Bit | Value | Action |
|---|---|---|
| 0 | 1 | LEFT |
| 1 | 2 | RIGHT |
| 2 | 4 | JUMP |
| 3 | 8 | CROUCH |
| 4 | 16 | PUNCH |
| 5 | 32 | KICK |
| 6 | 64 | BLOCK |
| 7 | 128 | SPECIAL (fireball / super) |

`k` is what is currently held; `p` is an accumulated set of bits that turned on since the last message (so a 1-frame tap can never be lost). The server adds `p` into the fighter's "pressed" set, which `sim.js` consumes on the next tick.

### Snapshot format (`st.s`)

| Field | Meaning |
|---|---|
| `t` | simulation frame counter |
| `ph` | phase: `intro` \| `fight` \| `roundEnd` \| `matchEnd` |
| `pt` | frames left in the current phase |
| `r` | round number (1–5) |
| `w` | `[winsP1, winsP2]` |
| `tm` | whole seconds left on the round clock |
| `hs` | hitstop frames remaining |
| `pa` / `ov` | paused / match over flags |
| `wi` | winner seat (or −1) |
| `bn` | banner `{x: text, s: subtitle, k: kind, t: age}` or `null` |
| `f[2]` | fighters: `{x,y,fc,hp,mt,st,sf,at,af,cr,bl,ar,cb,su,ko,fl}` (position, facing, HP, meter, state, state-frame, attack name/frame, crouch, block, air, combo, super-frame, KO, flash) |
| `pj[]` | projectiles: `{x,y,d,o,t}` (position, direction, owner, age) |
| `bm[]` | beams: `{x,d,t,o,l}` |
| `fx[]` | one-shot events for this tick: `{e, x, y, p}` — types: `hit`, `block`, `armor`, `swing`, `combo`, `jump`, `land`, `fire`, `trail`, `clash`, `ko`, `charge`, `spark`, `beam`, `bell` |

---

## Running the server

```bash
node server.js                 # default: port 3000, browser stays closed
node server.js --open          # also opens http://localhost:<port> in your browser
PORT=4000 node server.js       # custom port  (Windows PowerShell: $env:PORT=4000; node server.js)
```

- If the port is busy the server **automatically tries the next one**, up to 10 ports (3000→3010). Watch the banner for the real port.
- On startup the server probes the OS routing table to pick the address your network actually uses for the "For your friend" link, and lists alternatives.
- Static files are served with `Cache-Control: no-store`, so **a normal refresh always gets the newest game code**.
- Rooms live in memory: no database, no accounts, nothing persisted. Empty rooms are cleaned up after 40 minutes. Heartbeat pings detect dead sockets within 45 seconds.

---

## Testing

```bash
npm test            # runs all three suites
# or individually:
node tests/test_sim.js
node tests/test_net.js
node tests/test_client.js
```

| Suite | What it proves |
|---|---|
| `test_sim.js` | Attacks connect and deal damage; blocking prevents damage; meter gain/costs; fireball spawn + chip; super charge + beam damage; KO → round flow → match end; `resetMatch`; a 3-minute random-input fuzz must not crash or produce invalid state. |
| `test_net.js` | Boots a real server on port 3123 and speaks the real WebSocket protocol: static serving + 404s, create/join, arena picking and lockout rules, start, live snapshots, an online hit landing, ping/pong, disconnect → pause, token rejoin, name-based "ghost takeover" after a page reload, leave notification, room-full rejection, startup banner. |
| `test_client.js` | Loads `public/client.js` into a stubbed DOM + canvas and runs it: attract mode frames, arena pickers built with 4 maps, local 2P with key input, typing in text fields (the WASD regression), Enter/Escape handling, the full networked message flow including arena changes, effects, match end, rematch and opponent-left. |

---

## Tweaking the game

Almost everything fun to change lives at the top of **`public/sim.js`**:

```js
var WALK = 3.1;            // walk speed (px/frame)
var JUMP_V = 14.4;         // jump speed
var GRAV = 0.68;           // gravity per frame
var ROUND_TIME = 60 * 60;  // round length in FRAMES (60 = 1 second)
var WINS_NEEDED = 2;       // rounds to win the match
var MAX_ROUNDS = 5;        // cap per match
var SPECIAL_COST = 50;     // meter for a fireball
var SUPER_COST = 100;      // meter for the super beam
var SUPER_CHARGE = 46;     // frames of charge-up
var SUPER_FIRE = 26;       // frames the beam is out
var METER_REGEN = 0.03;    // passive meter per frame
```

The `ATTACKS` table right below defines every move (`startup`, `active`, `recovery`, `dmg`, `box`, hit/block stun, pushback, chip, meter gain). Add a move by adding an entry and wiring a key to `startAttack` — online play picks it up automatically, no protocol change needed.

Other handy knobs:

| Where | What |
|---|---|
| `public/maps.js` → `LIST` | the four arenas. Add your own by appending `{id, name, tag, draw, amb}` — the lobby picker, protocol validation and thumbnails all update automatically. Each `draw(ctx, t)` is a pure function of time. |
| `server.js` → `START_PORT`, `MAX_ROOM_LIFE` | default port, empty-room lifetime |
| `client.js` → `netView()` `- 0.048` | interpolation delay (lower = snappier, higher = smoother on bad links) |
| `client.js` → `musicStart()` `116` | music tempo |
| `client.js` → `PAL[]` | fighter colors |
| `client.js` → `P2MAP` / `NETMAP` | key bindings |
| `style.css` → `:root` | neon palette |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **The bat file says Node was not found** | Install [Node.js LTS](https://nodejs.org) once, then run the bat again (reopen the terminal so PATH refreshes). |
| **Friend can't open the link** | 1) Are you both on the same network? 2) Allow Node.js through the Windows Firewall (Private networks) — first launch usually shows a prompt; if you missed it, add an inbound rule for TCP port 3000. 3) Try the *Other addresses* printed at startup — virtual adapters (VirtualBox/VMware/Hyper-V) can produce misleading links. 4) Verify with `ipconfig`. |
| **"Room XXXX not found"** | Codes are 4 characters and never contain I/O/0/1 — check for lookalikes. Host must still have the server running and must not have restarted it. |
| **"Room XXXX is full"** | Two players already inside. If one just disconnected/reloaded, wait a few seconds for their seat to free or for their automatic reconnect. |
| **Page loads but never connects** | Refresh once (the page uses the same host/port it was served from). Check the server terminal for errors. If you use a proxy/tunnel, make sure WebSocket upgrades are allowed (Cloudflare quick tunnels and ngrok both are). |
| **Fighter doesn't react to keys** | Click the game area once (focus), make sure you're not typing in a text field, and that you're using the keys from the [controls table](#controls). Browser/OS global shortcuts (e.g. functions keys, Alt+Tab) can't be captured. |
| **No sound** | Browsers require a first click/keypress before audio — click anywhere. Check `M` isn't muted (pressing it shows a toast) and the OS volume/mixer. |
| **Can't type letters in the name/code field** | Fixed in the current version — refresh the page to get the newest `client.js` (served with no-store). |
| **Black screen** | Try another modern browser; open the dev console (F12) for details. Usually an outdated browser without `ctx.ellipse` support (pre-2016). |
| **It lags** | Prefer LAN over tunnels; check the ping indicator; close downloads on the host machine. The netcode interpolates, but physics still run on the host's CPU (trivial for 2 fighters). |
| **Port 3000 keeps changing** | Something else uses 3000 (or an old instance of the game is still running — check Task Manager for a stray `node.exe`). The printed banner always tells you the real port. |
| **Sound keeps playing after closing the tab** | Shouldn't happen (audio is bound to the page); if it does, the browser or a media session is confused — close the browser process. |

---

## FAQ

**Does it work on phones/tablets?**
The page loads and you can watch, but there are no touch controls yet — you need a hardware keyboard to play. Two phone players could use Bluetooth keyboards.

**Can more than 2 people play?**
Two per room. Multiple rooms can run at the same time on one server (different codes), and every room is simulated independently.

**Can I play alone?**
You can watch the CPU-vs-CPU demo on the title screen, but there's no single-player arcade mode (yet). For practicing, open two windows and fight yourself.

**Can we choose which arena we fight in?**
Yes — the host clicks one of the four thumbnails in the online waiting room and the choice syncs to the guest instantly. If nobody picks, the arena is random (and rematches reroll it). Local 2P mode has its own picker on the setup screen.

**Is there a ranking / accounts / saved stats?**
No. Nothing is stored — not even on the server (rooms are in-memory) — except your name and last room code in your own browser's `localStorage`/`sessionStorage`.

**What data is sent?**
Only your chosen display name (to the server and opponent), your inputs, and — for invite-link generation — nothing personal (the server's own LAN address). No telemetry, no analytics, no external requests at all: the game is fully offline-capable once loaded from your own server.

**Does it need internet?**
No — on the same Wi-Fi it works without any internet connection (both devices just need to reach the host).

**Why is the first move sometimes a fireball when I wanted a super?**
Super needs **100 meter**. At 50–99 you get a fireball; at 100 the special button always becomes the super. Watch the meter bar: when it pulses, super is ready.

**The opponent left — did I win?**
The match just pauses; if they don't return within 40 s you're returned to the menu with an "opponent left" toast. No win is awarded automatically.

**Can spectators join?**
No — a room has exactly two seats.

**Can I run the server on a Raspberry Pi / Linux box?**
Yes, any Node 16+ machine. Serve it and connect from browsers on the network; `START GAME.bat` is Windows-only, but `node server.js` works everywhere.

---

## Known limitations

- 2 seats per room, no matchmaking/lobby list (share a code or link instead).
- No touch controls, no gamepad support.
- No single-player AI opponent (the title-screen fight is a demo, not playable).
- The host must keep the server process running; stopping it closes all rooms.
- No TLS by default — run behind a tunnel/reverse proxy if you want `https`/`wss`.
- Not rollback netcode: it's server-authoritative with interpolation, great up to roughly 120 ms, but a tournament-grade rollback implementation is beyond this project.
- Physics is 2D AABB-based; there is no throw/grab system, no high/low blocking distinction.

---

## License

Do whatever you want with it. Have fun, learn from it, remix it, ship it to your friends.
No warranty of any kind — if your fireball gets blocked, that's on you. 🔥
