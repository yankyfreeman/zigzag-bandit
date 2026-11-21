(() => {
  'use strict';

  // ---------- Constants ----------
  const W = 960, H = 540;
  // Perspective: camera looks down a street. d = distance (1 = nearest), screen scale = 1/d.
  const HORIZON = 200, CAM = 270, VX = W / 2, D0 = 1, D1 = 3.0, F = 400, END = 3.35, GATE = 3.2;
  const WALL = 470, ROAD = 330, PORCH = 352;      // world x of building walls / road edge / porch posts
  const LIM = 285, STEP = 36, U = 0.95;           // runner lateral limit, step length, sprite scale
  const JUMP = 0.5, MAX_LIVES = 3, OUT_DELAY = 0.7; // OUT_DELAY: pause after the last bullet misses before he gets away
  const BEST_KEY = 'zigzag-bandit-best';
  const TITLE_FONT = '"Rye", "Rockwell", Georgia, serif';
  const UI_FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
  const PAINTS = ['#4cc9f0', '#ff5d8f', '#b8f35d', '#ffd23f'];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const muteBtn = document.getElementById('mute');

  const rand = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const depth = (z) => D0 + z * (D1 - D0);
  const P = (wx, wy, d) => [VX + wx / d, HORIZON + (CAM - wy) / d];   // world -> screen

  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Colour helpers (distance haze) ----------
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const HAZE = hex('#f3a76c');
  function fog(c, d, k = 0.62, mul = 1) {
    const a = hex(c), t = clamp((d - 1) / 2.5, 0, 1) * k;
    return `rgb(${a.map((v, i) => Math.round(clamp(v * mul, 0, 255) * (1 - t) + HAZE[i] * t)).join(',')})`;
  }

  // ---------- Levels ----------
  // time = seconds until he reaches the town limit, speed = sideways steps per second,
  // start = head start (0..1 of the street), jump/feint = chance per direction change.
  const LEVELS = [
    { name: 'Warm-up',        tip: 'Click to shoot. Stop him before the town limit!', time: 15,   speed: 3.2, hp: 1, ammo: 6, cover: 0, jump: 0,    feint: 0 },
    { name: 'Quick Feet',     tip: 'He found his running shoes.',                    time: 13.5, speed: 4.4, hp: 1, ammo: 6, cover: 0, jump: 0,    feint: 0 },
    { name: 'Crate Yard',     tip: 'Crates in front of him block your shots.',       time: 13.5, speed: 4.6, hp: 1, ammo: 6, cover: 3, jump: 0,    feint: 0 },
    { name: 'Padded Vest',    tip: 'Takes 2 hits. A headshot counts double.',        time: 13,   speed: 4.8, hp: 2, ammo: 7, cover: 2, jump: 0,    feint: 0 },
    { name: 'Jumping Jack',   tip: 'Now he jumps and ducks.',                        time: 12.5, speed: 5.2, hp: 2, ammo: 7, cover: 3, jump: 0.4,  feint: 0, tall: true },
    { name: 'Fake Out',       tip: 'Watch for the stutter-step.',                    time: 12,   speed: 5.6, hp: 2, ammo: 7, cover: 3, jump: 0.25, feint: 0.4, tall: true },
    { name: 'Head Start',     tip: 'He is already halfway down the street.',         time: 11,   speed: 5.6, hp: 2, ammo: 6, cover: 3, jump: 0.25, feint: 0.3, tall: true, start: 0.3 },
    { name: 'Dust Storm',     tip: 'Shoot through the dust.',                        time: 12,   speed: 6.0, hp: 2, ammo: 7, cover: 2, jump: 0.3,  feint: 0.3, tall: true, dust: true },
    { name: 'Triple Padding', tip: '3 hits to stop him. Aim for the head.',          time: 12,   speed: 6.4, hp: 3, ammo: 8, cover: 4, jump: 0.3,  feint: 0.35, tall: true },
    { name: 'The Ghost',      tip: 'Everything at once. Good luck.',                 time: 11,   speed: 7.2, hp: 3, ammo: 7, cover: 4, jump: 0.4,  feint: 0.45, tall: true, dust: true, start: 0.15 },
  ];
  const DEMO = { time: 9, speed: 4.5, hp: 1, ammo: 6, cover: 0, jump: 0.2, feint: 0.1 };

  function getLevel(i) {
    if (i < LEVELS.length) return LEVELS[i];
    const b = LEVELS[LEVELS.length - 1], k = i - LEVELS.length + 1;
    return { ...b, name: 'Overtime ' + k, tip: 'Even faster.', speed: b.speed + 0.4 * k, time: Math.max(8, b.time - 0.3 * k) };
  }

  // ---------- Audio (synthesized) ----------
  let ac = null, muted = false;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, type = 'square', vol = 0.12, f2 = 0, delay = 0) {
    if (muted) return;
    try {
      const a = audio(), t = a.currentTime + delay;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  function noise(dur, vol = 0.25) {
    if (muted) return;
    try {
      const a = audio();
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = a.createBufferSource(), g = a.createGain();
      src.buffer = buf;
      g.gain.value = vol;
      src.connect(g).connect(a.destination);
      src.start();
    } catch (e) { /* audio unavailable */ }
  }
  // ---------- Analytics (GoatCounter events; no-op if the script isn't loaded) ----------
  const reported = new Set();
  function track(name) {
    if (reported.has(name)) return;           // once per page load per event
    reported.add(name);
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) { /* ignore */ }
  }

  const sfx = {
    shot() { noise(0.16, 0.32); tone(190, 0.12, 'square', 0.1, 55); },
    hit() { tone(520, 0.12, 'triangle', 0.2, 880); },
    head() { tone(660, 0.08, 'triangle', 0.2); tone(990, 0.14, 'triangle', 0.2, 0, 0.07); },
    block() { tone(130, 0.08, 'square', 0.15, 80); },
    empty() { tone(900, 0.03, 'square', 0.08); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.18, 0, i * 0.09)); },
    escape() { tone(420, 0.5, 'sawtooth', 0.12, 140); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, 0, i * 0.18)); },
  };

  // ---------- State ----------
  let state = 'menu';       // menu | intro | play | result | over
  let stateT = 0, paused = false, clock = 0;
  let levelIdx = 0, lv = LEVELS[0];
  let score = 0, lives = MAX_LIVES, streak = 0, shotNo = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* no storage */ }
  let ammo = 0, outT = 0; // bullets left this round (no reloads); countdown once they run out
  let levelShots = 0, levelHits = 0;
  let runner = null, covers = [], clouds = [];
  let particles = [], decals = [], floats = [], tracer = null;
  let result = null;
  let shake = 0, flashT = 0, recoil = 0;
  const mouse = { x: W / 2, y: H * 0.55, show: false, ax: W / 2, ay: H * 0.55, since: 0 };
  // Anti-camping: once the aim has stayed within STILL_R px for STILL_TIME s, the bandit
  // silently steers around that spot (see avoidCamp), so waiting for him never pays off.
  const STILL_R = 14, STILL_TIME = 1.5;
  function aimAt(x, y) {
    if (Math.hypot(x - mouse.ax, y - mouse.ay) > STILL_R) { mouse.ax = x; mouse.ay = y; mouse.since = clock; }
    mouse.x = x; mouse.y = y;
  }
  const stillness = () => Math.min(1, (clock - mouse.since) / STILL_TIME);
  const motes = Array.from({ length: 36 }, () => ({ x: rand(0, W), y: rand(120, H), vx: rand(-14, 14), vy: rand(-8, 4), r: rand(0.8, 2.2) }));

  // ---------- Static scenery (rendered once to an offscreen canvas) ----------
  let bg = null, dustSprite = null;

  function quad(g, pts, fill) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }
  const wallPts = (side, dA, dB, y0, y1) => [P(side * WALL, y0, dA), P(side * WALL, y0, dB), P(side * WALL, y1, dB), P(side * WALL, y1, dA)];
  // Horizontal gradient so a wall fades into the haze as it recedes.
  function wallGrad(g, side, c, dA, dB, mul = 1, k = 0.62) {
    const gr = g.createLinearGradient(P(side * WALL, 0, dA)[0], 0, P(side * WALL, 0, dB)[0], 0);
    for (let i = 0; i <= 4; i++) { const d = dA + (dB - dA) * i / 4; gr.addColorStop(i / 4, fog(c, Math.max(1, d), k, mul)); }
    return gr;
  }
  // Vertical gradient for ground surfaces (screen y maps to distance).
  function groundGrad(g, c, mul = 1) {
    const y0 = HORIZON, gr = g.createLinearGradient(0, y0, 0, H);
    for (const d of [30, END, 3, 2.2, 1.6, 1.25, 1, 0.8]) gr.addColorStop(clamp((CAM / d) / (H - y0), 0, 1), fog(c, d, 0.7, mul));
    return gr;
  }

  function wallText(g, side, text, dA, dB, yTop, yBot, color) {
    const dl = side < 0 ? dA : dB, dr = side < 0 ? dB : dA;
    const p0 = P(side * WALL, yTop, dl), p1 = P(side * WALL, yTop, dr), p2 = P(side * WALL, yBot, dl);
    g.save();
    g.transform((p1[0] - p0[0]) / 100, (p1[1] - p0[1]) / 100, (p2[0] - p0[0]) / 30, (p2[1] - p0[1]) / 30, p0[0], p0[1]);
    g.font = `20px ${TITLE_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 50, 16, 90);
    g.restore();
  }

  function drawBuilding(g, side, b, R) {
    const { dA, dB, h, c } = b, len = dB - dA;
    quad(g, wallPts(side, dA, dB, 0, h), wallGrad(g, side, c, dA, dB));
    // clapboards converge on the vanishing point
    g.lineWidth = 1;
    for (let y = 22; y < h - 20; y += 22) {
      const a = P(side * WALL, y, dA), e = P(side * WALL, y, dB);
      g.strokeStyle = 'rgba(30,12,30,0.13)';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(e[0], e[1]); g.stroke();
    }
    quad(g, wallPts(side, dA, dB, h - 18, h), wallGrad(g, side, c, dA, dB, 0.65));
    // sunlit roof edge
    const t0 = P(side * WALL, h, dA), t1 = P(side * WALL, h, dB);
    g.strokeStyle = 'rgba(255,196,128,0.75)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(t0[0], t0[1]); g.lineTo(t1[0], t1[1]); g.stroke();
    // far end of the building
    const e0 = P(side * WALL, 0, dB), e1 = P(side * WALL, h, dB);
    g.strokeStyle = 'rgba(30,12,30,0.35)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.stroke();

    // upper windows
    const n = Math.max(1, Math.round(len / 0.26));
    for (let i = 0; i < n; i++) {
      const dc = dA + (i + 0.5) * len / n, hw = Math.min(0.05, len / n * 0.28);
      const lit = R() < 0.55;
      quad(g, wallPts(side, dc - hw - 0.01, dc + hw + 0.01, 184, 270), fog(c, dc, 0.62, 0.5));
      quad(g, wallPts(side, dc - hw, dc + hw, 191, 263), lit ? fog('#ffd98a', dc, 0.35) : fog('#2e2038', dc));
      const m0 = P(side * WALL, 191, dc), m1 = P(side * WALL, 263, dc);
      g.strokeStyle = fog(c, dc, 0.62, 0.5); g.lineWidth = 2 / dc;
      g.beginPath(); g.moveTo(m0[0], m0[1]); g.lineTo(m1[0], m1[1]); g.stroke();
      if (lit) {
        const pc = P(side * WALL, 227, dc), rr = 80 / dc;
        const gl = g.createRadialGradient(pc[0], pc[1], 0, pc[0], pc[1], rr);
        gl.addColorStop(0, 'rgba(255,200,110,0.35)'); gl.addColorStop(1, 'rgba(255,200,110,0)');
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = gl; g.fillRect(pc[0] - rr, pc[1] - rr, rr * 2, rr * 2);
        g.globalCompositeOperation = 'source-over';
      }
    }
    // door
    const dm = dA + len * 0.5;
    quad(g, wallPts(side, dm - 0.055, dm + 0.055, 10, 122), fog('#2c1a26', dm));
    quad(g, wallPts(side, dm - 0.04, dm + 0.04, 16, 116), fog('#4a2c2e', dm));

    if (b.porch) {
      quad(g, wallPts(side, dA, dB, 0, 152), 'rgba(24,10,32,0.28)');
      const pa = dA + 0.015, pb = dB - 0.015;
      quad(g, [P(side * WALL, 152, pa), P(side * WALL, 152, pb), P(side * PORCH, 136, pb), P(side * PORCH, 136, pa)], wallGrad(g, side, c, pa, pb, 0.62));
      quad(g, [P(side * PORCH, 136, pa), P(side * PORCH, 136, pb), P(side * PORCH, 127, pb), P(side * PORCH, 127, pa)], wallGrad(g, side, c, pa, pb, 0.4));
      for (const d of [pb - 0.03, (pa + pb) / 2, pa + 0.03]) {
        if (d < 0.9) continue;
        const a = P(side * PORCH, 8, d), e = P(side * PORCH, 128, d), w = 9 / d;
        g.fillStyle = fog('#2c1a22', d);
        g.fillRect(a[0] - w / 2, e[1], w, a[1] - e[1]);
        g.fillStyle = 'rgba(255,190,120,0.5)';
        g.fillRect(a[0] - side * w / 2 - (side > 0 ? 0 : 1.5 / d), e[1], 1.5 / d, a[1] - e[1]);
      }
    }
    // sign board
    if (b.name && len > 0.4) {
      const sa = dA + len * 0.14, sb = dB - len * 0.14, y0 = b.porch ? 286 : 140, y1 = y0 + 38;
      if (y1 < h - 20) {
        quad(g, wallPts(side, sa - 0.012, sb + 0.012, y0 - 4, y1 + 4), fog('#3a2228', (sa + sb) / 2));
        quad(g, wallPts(side, sa, sb, y0, y1), wallGrad(g, side, '#e9d3a2', sa, sb, 1, 0.45));
        wallText(g, side, b.name, sa, sb, y1, y0, fog('#40222a', (sa + sb) / 2, 0.4));
      }
    }
  }

  function drawCrate(g, wx, d, w, h) {
    const dz = w / F, d2 = d + dz;
    const [x0, y0] = P(wx - w / 2, 0, d), [x1] = P(wx + w / 2, 0, d), yt = P(wx, h, d)[1];
    const ds = Math.max(0.72, d - 0.3);
    quad(g, [P(wx - w / 2, 0, d), P(wx + w / 2, 0, d), P(wx + w / 2, 0, ds), P(wx - w / 2, 0, ds)], 'rgba(30,10,30,0.25)');
    quad(g, [P(wx - w / 2, h, d), P(wx + w / 2, h, d), P(wx + w / 2, h, d2), P(wx - w / 2, h, d2)], fog('#e9b070', d, 0.45));
    const sx = wx < 0 ? wx + w / 2 : wx - w / 2;
    if ((wx < 0) === (sx < 0)) quad(g, [P(sx, 0, d), P(sx, 0, d2), P(sx, h, d2), P(sx, h, d)], fog('#9a6638', d, 0.45));
    const fw = x1 - x0, fh = y0 - yt, lw = Math.max(1.5, 6 / d);
    g.fillStyle = fog('#74482a', d, 0.45); g.fillRect(x0, yt, fw, fh);
    g.strokeStyle = fog('#4a2a18', d, 0.45); g.lineWidth = lw; g.lineCap = 'butt';
    g.strokeRect(x0 + lw / 2, yt + lw / 2, fw - lw, fh - lw);
    g.beginPath(); g.moveTo(x0 + lw, yt + lw); g.lineTo(x1 - lw, y0 - lw); g.moveTo(x1 - lw, yt + lw); g.lineTo(x0 + lw, y0 - lw); g.stroke();
    g.fillStyle = 'rgba(255,196,128,0.7)'; g.fillRect(x0, yt - 0.5, fw, Math.max(1, 2 / d));
    return { x: x0, y: yt, w: fw, h: fh };
  }

  function drawBarrels(g, wx, d, w, h, count) {
    const [cx, y0] = P(wx, 0, d), r = w / 2 / d, each = h / count;
    const ry = (y0 - P(wx, 0, d + w / F)[1]) / 2 + 1;
    const ds = Math.max(0.72, d - 0.3), sy = P(wx, 0, ds)[1];
    g.fillStyle = 'rgba(30,10,30,0.25)';
    g.beginPath(); g.ellipse(cx, (y0 + sy) / 2, r, (sy - y0) / 2 + ry, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < count; i++) {
      const yb = P(wx, i * each, d)[1], yt = P(wx, (i + 1) * each, d)[1], bh = yb - yt;
      const gr = g.createLinearGradient(cx - r, 0, cx + r, 0);
      gr.addColorStop(0, fog('#4a2a1c', d, 0.45)); gr.addColorStop(0.45, fog('#9a5e34', d, 0.45)); gr.addColorStop(1, fog('#3c2018', d, 0.45));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(cx - r, yt); g.bezierCurveTo(cx - r * 1.14, yt + bh * 0.3, cx - r * 1.14, yb - bh * 0.3, cx - r, yb);
      g.ellipse(cx, yb, r, ry, 0, Math.PI, 0, true);
      g.bezierCurveTo(cx + r * 1.14, yb - bh * 0.3, cx + r * 1.14, yt + bh * 0.3, cx + r, yt);
      g.closePath(); g.fill();
      g.fillStyle = fog('#2a2530', d, 0.45);
      g.fillRect(cx - r * 1.08, yt + bh * 0.2, r * 2.16, Math.max(1.5, 5 / d));
      g.fillRect(cx - r * 1.08, yb - bh * 0.25, r * 2.16, Math.max(1.5, 5 / d));
      g.fillStyle = fog('#d9a066', d, 0.45);
      g.beginPath(); g.ellipse(cx, yt, r, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = fog('#5a3420', d, 0.45); g.lineWidth = Math.max(1, 2.5 / d); g.stroke();
    }
    const top = P(wx, h, d)[1] - ry;
    return { x: cx - r * 1.1, y: top, w: r * 2.2, h: y0 - top + ry * 0.5 };
  }

  const drawCover = (g, c) => (c.tall ? drawBarrels(g, c.wx, c.d, c.w, c.h, 2) : drawCrate(g, c.wx, c.d, c.w, c.h));

  function buildBackground() {
    const dpr = canvas.width / W;
    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const g = bg.getContext('2d');
    g.scale(dpr, dpr);
    const R = mulberry32(11);

    // sky
    const sky = g.createLinearGradient(0, 0, 0, HORIZON + 6);
    sky.addColorStop(0, '#1b1340'); sky.addColorStop(0.36, '#5a2a70'); sky.addColorStop(0.64, '#c5476b');
    sky.addColorStop(0.85, '#f68d55'); sky.addColorStop(1, '#ffd884');
    g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON + 6);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.5})`; g.fillRect(R() * W, R() * 95, 1.4, 1.4); }
    // sun + glow
    const sy = HORIZON - 14;
    const glow = g.createRadialGradient(VX, sy, 0, VX, sy, 330);
    glow.addColorStop(0, 'rgba(255,244,200,0.95)'); glow.addColorStop(0.16, 'rgba(255,205,120,0.55)');
    glow.addColorStop(0.5, 'rgba(255,140,90,0.16)'); glow.addColorStop(1, 'rgba(255,140,90,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, HORIZON + 6);
    g.fillStyle = '#fff6d0'; g.beginPath(); g.arc(VX, sy, 42, 0, Math.PI * 2); g.fill();
    // clouds
    for (let i = 0; i < 9; i++) {
      const cx = R() * W, cy = 28 + R() * 120, cw = 70 + R() * 150, hi = cy < 85;
      for (let j = 0; j < 4; j++) {
        g.fillStyle = hi ? 'rgba(150,84,150,0.34)' : 'rgba(255,168,118,0.42)';
        g.beginPath(); g.ellipse(cx + (R() - 0.5) * cw, cy + (R() - 0.5) * 8, cw * (0.3 + R() * 0.35), 5 + R() * 6, 0, 0, Math.PI * 2); g.fill();
      }
    }
    // distant mesas
    quad(g, [[330, 203], [352, 190], [384, 187], [392, 178], [432, 178], [440, 190], [456, 203]], '#a2566b');
    quad(g, [[500, 203], [514, 189], [546, 187], [552, 174], [590, 174], [598, 190], [640, 203]], '#93506a');

    // street
    g.fillStyle = groundGrad(g, '#9c6446'); g.fillRect(0, HORIZON, W, H - HORIZON);
    g.save(); g.translate(VX, HORIZON); g.scale(1, 0.42);
    const refl = g.createRadialGradient(0, 0, 0, 0, 0, 420);
    refl.addColorStop(0, 'rgba(255,214,140,0.6)'); refl.addColorStop(1, 'rgba(255,214,140,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = refl; g.fillRect(-480, 0, 960, 900);
    g.restore(); g.globalCompositeOperation = 'source-over';
    for (const wx of [-170, -95, 95, 170]) quad(g, [P(wx - 9, 0, 0.75), P(wx + 9, 0, 0.75), P(wx + 7, 0, 5), P(wx - 7, 0, 5)], 'rgba(70,34,34,0.16)');
    for (let i = 0; i < 230; i++) {
      const s = 0.22 + R() * 0.95, d = 1 / s, wx = (R() * 2 - 1) * ROAD, p = P(wx, 0, d), dark = R() < 0.6;
      g.fillStyle = dark ? 'rgba(70,36,34,0.3)' : 'rgba(255,214,160,0.22)';
      g.beginPath(); g.ellipse(p[0], p[1], (2 + R() * 7) * s, (1 + R() * 2.2) * s, 0, 0, Math.PI * 2); g.fill();
    }

    // town-limit gate (far end, backlit)
    const gd = GATE, gc = '#3a1c30';
    for (const s of [-1, 1]) { const a = P(s * 300, 0, gd), e = P(s * 300, 262, gd); g.fillStyle = gc; g.fillRect(a[0] - 4, e[1], 8, a[1] - e[1]); }
    const gl = P(-322, 262, gd), gr = P(322, 262, gd);
    g.fillStyle = gc; g.fillRect(gl[0], gl[1] - 8, gr[0] - gl[0], 9);
    const s0 = P(-150, 236, gd), s1 = P(150, 180, gd);
    g.fillRect(s0[0], s0[1], s1[0] - s0[0], s1[1] - s0[1]);
    g.fillStyle = '#ffd884'; g.font = `11px ${TITLE_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('TOWN LIMIT', VX, (s0[1] + s1[1]) / 2 + 0.5, s1[0] - s0[0] - 6);

    // boardwalks
    for (const s of [-1, 1]) {
      quad(g, [P(s * ROAD, 10, 0.7), P(s * WALL, 10, 0.7), P(s * WALL, 10, END), P(s * ROAD, 10, END)], groundGrad(g, '#8d5d3d'));
      quad(g, [P(s * ROAD, 0, 0.7), P(s * ROAD, 10, 0.7), P(s * ROAD, 10, END), P(s * ROAD, 0, END)], groundGrad(g, '#8d5d3d', 0.5));
      g.strokeStyle = 'rgba(40,16,24,0.22)';
      for (let d = 0.8; d < END; d += 0.09 * d) {
        const a = P(s * ROAD, 10, d), e = P(s * WALL, 10, d);
        g.lineWidth = Math.max(0.5, 1.6 / d);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(e[0], e[1]); g.stroke();
      }
    }

    // buildings, far to near
    const palette = ['#7b4a3a', '#8c5a3c', '#6d3f4a', '#93603f', '#5f4350', '#a06a45', '#74503f'];
    const names = { '-1': ['SALOON', 'HOTEL', 'BARBER', 'STABLES', 'BANK', 'TELEGRAPH'], '1': ['BANK', 'SHERIFF', 'GENERAL STORE', 'SALOON', 'ASSAY', 'HOTEL'] };
    for (const s of [-1, 1]) {
      const list = [];
      let d = 0.72, i = 0;
      while (d < END - 0.02) {
        const len = Math.min(0.42 + R() * 0.36, END - d);
        list.push({ dA: d, dB: d + len, h: 320 + R() * 120, c: palette[Math.floor(R() * palette.length)], porch: R() < 0.7, name: names[s][i++ % 6] });
        d += len;
      }
      for (const b of list.reverse()) drawBuilding(g, s, b, R);
    }

    // boardwalk props
    drawBarrels(g, -408, 1.32, 58, 76, 1);
    drawCrate(g, 414, 1.7, 70, 62);
    drawBarrels(g, 402, 2.5, 58, 76, 1);
    drawCrate(g, -410, 2.9, 70, 62);

    // soft dust sprite
    dustSprite = document.createElement('canvas');
    dustSprite.width = dustSprite.height = 128;
    const dg = dustSprite.getContext('2d'), dgr = dg.createRadialGradient(64, 64, 0, 64, 64, 64);
    dgr.addColorStop(0, 'rgba(238,200,150,0.9)'); dgr.addColorStop(0.5, 'rgba(238,200,150,0.5)'); dgr.addColorStop(1, 'rgba(238,200,150,0)');
    dg.fillStyle = dgr; dg.fillRect(0, 0, 128, 128);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBackground();
  }
  window.addEventListener('resize', resize);
  resize();
  if (document.fonts && document.fonts.load) document.fonts.load(`20px "Rye"`).then(buildBackground).catch(() => {});

  // ---------- Runner ----------
  function makeRunner(level) {
    const r = {
      lv: level, z: level.start || 0, X: 0, X0: 0,
      hp: level.hp, maxHp: level.hp,
      segDir: Math.random() < 0.5 ? 1 : -1, stepsLeft: 0, stepT: 0, run: 0, lean: 0,
      pause: 0, jumpT: -1, duckT: 0, panic: 0, flash: 0, puffT: 0,
      state: 'run', idle: false, fallT: 0, fallDir: 1, hatOff: false, splats: [], say: null, sayT: 0,
    };
    nextSegment(r, true);
    return r;
  }

  // The "weird pattern": a few steps one way, a few the other, 1-7 at a time.
  function nextSegment(r, first) {
    const room = (dir) => Math.floor((LIM - dir * r.X0) / STEP + 1e-6);
    let dir = -r.segDir;
    if (room(dir) < 1) dir = -dir;
    r.segDir = dir;
    r.stepsLeft = Math.max(1, Math.min(rint(1, 7), room(dir)));
    if (first) return;
    if (Math.random() < r.lv.feint) r.pause = rand(0.12, 0.3);
    if (Math.random() < r.lv.jump) { if (Math.random() < 0.5) r.jumpT = 0; else r.duckT = 0.55; }
  }

  function scr(r) {
    const d = depth(r.z), s = 1 / d;
    return { sx: VX + r.X * s, gy: HORIZON + CAM * s, S: s * U, d };
  }
  const jumpOff = (r, S) => (r.jumpT >= 0 ? -Math.sin(Math.PI * r.jumpT / JUMP) * 75 * S : 0);
  const ducking = (r) => r.duckT > 0 && r.state === 'run';

  function updateRunner(r, dt, active) {
    if (r.flash > 0) r.flash -= dt;
    if (r.say) { r.sayT -= dt; if (r.sayT <= 0) r.say = null; }
    if (r.state === 'down') { r.fallT += dt; return; }
    r.idle = !active;
    if (!active) return;
    r.run += dt * (12 + r.lv.speed * 0.6);
    if (r.state === 'flee') { r.z += dt * 0.2; return; }
    if (r.panic > 0) r.panic -= dt;
    if (r.jumpT >= 0) { r.jumpT += dt; if (r.jumpT >= JUMP) r.jumpT = -1; }
    if (r.duckT > 0) r.duckT -= dt;
    r.z += dt / r.lv.time;

    const { sx, gy, S } = scr(r);
    r.puffT -= dt;
    if (r.puffT <= 0 && r.jumpT < 0) {
      r.puffT = 0.11;
      particles.push({ x: sx + rand(-10, 10) * S, y: gy, vx: rand(-20, 20) * S, vy: rand(-30, -8) * S, life: 0.5, color: '#e6c193', size: rand(5, 9) * S, grav: 0, soft: true });
    }

    let target = 0;
    if (r.pause > 0) { r.pause -= dt; avoidCamp(r); }
    if (r.pause <= 0) {
      target = r.segDir * 0.17;
      r.stepT += dt * r.lv.speed * (r.dashUntil > clock ? DASH : r.panic > 0 ? 1.5 : 1);
      while (r.stepT >= 1) {
        r.stepT -= 1;
        r.X0 += r.segDir * STEP;
        r.stepsLeft--;
        if (r.stepsLeft <= 0) {
          nextSegment(r);
          for (let i = 0; i < 4; i++) particles.push({ x: sx, y: gy, vx: rand(-70, 70) * S, vy: rand(-70, -10) * S, life: 0.45, color: '#e6c193', size: rand(5, 10) * S, grav: 0, soft: true });
          if (r.pause > 0) { r.stepT = 0; break; }
        }
      }
      if (r.pause <= 0) avoidCamp(r);
      const t = r.stepT;
      r.X = r.X0 + r.segDir * STEP * (0.5 * t + 0.5 * t * t * (3 - 2 * t));
    }
    r.lean += (target - r.lean) * Math.min(1, dt * 12);
  }

  // If the aim has been parked for STILL_TIME, never step into it: turn away before the
  // next step would bring his hitbox over that spot, or hurry out if he is already there.
  // He starts steering AVOID_LEAD s early so he is already clear when the 1.5 s mark hits.
  // A mid-stride turn restarts the step from where he stands, so he never jumps.
  // Crossing to the inner side takes longer than a plain sidestep, so it may start earlier.
  const AVOID_LEAD = 0.6, CROSS_LEAD = 1.0, DASH = 2.5; // DASH: speed multiplier while slipping past the spot
  function avoidCamp(r) {
    const held = clock - mouse.since;
    if (state !== 'play' || r !== runner || r.state !== 'run' || held < STILL_TIME - CROSS_LEAD) return;
    const { gy, S, d } = scr(r);
    const ly = (mouse.ay - gy - jumpOff(r, S)) / S;
    if (ly < -240 || ly > 25) return; // spot is well above/below him (the band reaches above his hat, since he rises as he recedes)
    if (r.dashUntil > clock) return; // committed to dashing past the spot (pinned at the street edge)
    // A fixed screen point sits further out in world X as he recedes (aX grows with depth),
    // so a spot drifts toward the nearer street edge. Being on its outer side gets him cornered.
    const aX = (mouse.ax - VX) * d, M = (42 + 4 / S) * U;
    const gap = Math.abs(r.X - aX), inside = gap < M, away = r.X >= aX ? 1 : -1;
    const moving = r.pause <= 0;
    const room = (dir, from = r.X) => Math.floor((LIM - dir * from) / STEP + 1e-6);
    const crossLen = Math.ceil((gap + M) / STEP) + 1;
    const turn = () => { if (r.stepT > 0) { r.X0 = r.X; r.stepT = 0; } r.pause = 0; }; // turn mid-stride from where he stands
    const outer = (away === Math.sign(aX) && Math.abs(aX) > 20) || room(away) < 3;
    const squeeze = Math.abs((mouse.ax - VX) * depth(1)) + M > Math.abs(r.X); // the spot will reach him before the town limit
    const crossT = crossLen / (r.lv.speed * DASH);
    if (outer && (gap < M + 3 * STEP || squeeze) && room(-away) >= crossLen && (ly < -185 || held + crossT < STILL_TIME)) {
      // He's between the spot and the edge it drifts toward: slip past it to the inner
      // side now (ideally while it is still above his hat), before he gets cornered.
      turn();
      r.segDir = -away; r.stepsLeft = crossLen; r.panic = Math.max(r.panic, 0.5);
      r.dashUntil = clock + crossT;
      return;
    }
    if (held < STILL_TIME - AVOID_LEAD) return;
    const need = Math.ceil((M - gap) / STEP) + 1; // steps to get clear
    if (inside && moving && r.segDir === away) { // already escaping: just make sure he goes far enough
      r.stepsLeft = Math.max(r.stepsLeft, need); r.panic = Math.max(r.panic, 0.5); return;
    }
    if (!inside && (!moving || Math.abs(r.X0 + r.segDir * STEP - aX) >= M)) return; // current step stays clear
    turn();
    if (room(away) >= 1) {
      r.segDir = away;
      r.stepsLeft = Math.min(room(away), inside ? need + rint(0, 1) : rint(1, 3));
    } else if (inside) { // pinned against the edge with the spot on him: dash through it
      r.segDir = -away;
      r.stepsLeft = Math.min(room(-away), crossLen);
      r.dashUntil = clock + r.stepsLeft / (r.lv.speed * DASH);
    } else { r.pause = 0.15; return; } // pinned and clear: hold here
    if (inside) r.panic = Math.max(r.panic, 0.5);
  }

  function hitTest(r, px, py) {
    const { sx, gy, S } = scr(r), hF = ducking(r) ? 0.62 : 1;
    const lx = (px - sx) / S, ly = (py - gy - jumpOff(r, S)) / (S * hF);
    // Tight hitbox, matched to the drawing: head r13 at -133, hat crown, torso, legs. The loot sack doesn't count.
    if (Math.hypot(lx, ly + 133) <= 13) return 'head';
    if (!r.hatOff && Math.abs(lx) <= 13 && ly < -140 && ly >= -162) return 'head';
    if (Math.abs(lx) <= 21 && ly >= -120 && ly <= -60) return 'body';
    if (Math.abs(lx) <= 14 && ly > -60 && ly <= 0) return 'body';
    return null;
  }

  // ---------- Level flow ----------
  function startGame() {
    score = 0; lives = MAX_LIVES; streak = 0; levelIdx = 0;
    decals = []; particles = []; floats = [];
    startLevel();
  }

  function startLevel() {
    lv = getLevel(levelIdx);
    track(levelIdx === 0 ? 'game-start' : 'reached-level-' + (levelIdx + 1));
    runner = makeRunner(lv);
    covers = [];
    const zMin = Math.max(0.1, (lv.start || 0) + 0.08), zSpan = 0.72 - zMin;
    for (let i = 0; i < lv.cover; i++) {
      const tall = !!lv.tall && Math.random() < 0.35;
      const c = { z: zMin + (i + rand(0.15, 0.85)) * zSpan / lv.cover, wx: rand(-250, 250), tall, w: tall ? 62 : 92, h: tall ? 150 : 78 };
      c.d = depth(c.z);
      covers.push(c);
    }
    clouds = [];
    if (lv.dust) for (let i = 0; i < 7; i++) clouds.push({ x: rand(0, W), y: rand(HORIZON + 30, 430), r: rand(80, 150), vx: rand(25, 70) * (i % 2 ? 1 : -1) });
    ammo = lv.ammo; outT = 0;
    levelShots = 0; levelHits = 0;
    result = null; tracer = null;
    state = 'intro'; stateT = 0;
  }

  function saveBest() {
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* no storage */ }
    }
  }

  function takedown() {
    const mult = 1 + levelIdx * 0.2;
    const acc = levelHits / Math.max(1, levelShots);
    const distBonus = Math.round((1 - runner.z) * 300 * mult);
    const accBonus = Math.round(acc * 200 * mult);
    score += distBonus + accBonus;
    result = { win: true, stars: acc >= 0.6 ? 3 : acc >= 0.3 ? 2 : 1, distBonus, accBonus, acc, cleared: levelIdx === LEVELS.length - 1 };
    runner.state = 'down';
    runner.fallDir = runner.lean >= 0 ? 1 : -1;
    runner.say = null;
    const { sx, gy, S } = scr(runner);
    for (let i = 0; i < 20; i++) particles.push({ x: sx, y: gy - 90 * S, vx: rand(-260, 260) * S, vy: rand(-460, -140) * S, life: rand(0.7, 1.2), color: i % 4 ? '#ffd23f' : '#fff3b0', size: rand(3, 6) * S + 1, grav: 1100 * S });
    sfx.win();
    saveBest();
    state = 'result'; stateT = 0;
  }

  function escaped(dry) {
    lives--;
    streak = 0;
    runner.state = 'flee';
    runner.say = dry ? pick(['Out of paint? Ha!', 'Click click!', 'Empty, partner?']) : pick(['So long!', 'Bye bye!', 'Catch you never!', 'Ha ha ha!']);
    runner.sayT = 2;
    saveBest();
    if (lives <= 0) { sfx.over(); state = 'over'; track('game-over-level-' + (levelIdx + 1)); } else { sfx.escape(); result = { win: false }; state = 'result'; }
    stateT = 0;
  }

  function advance() {
    if (result && result.win) levelIdx++;
    startLevel();
  }

  // ---------- Shooting ----------

  function puff(x, y, n, color, k = 1) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-90, 90) * k, vy: rand(-130, -20) * k, life: rand(0.25, 0.5), color, size: rand(2, 4) * k + 0.6, grav: 320 * k });
  }

  function addFloat(text, x, y, color, size = 22) {
    floats.push({ text, x, y, color, size, life: 1 });
  }

  function splatDecal(x, y, color) {
    const blobs = Array.from({ length: 6 }, () => ({ a: rand(0, 6.28), d: rand(0.7, 1.5), r: rand(0.15, 0.4) }));
    if (y > HORIZON + 3) {
      const s = (y - HORIZON) / CAM;
      if (Math.abs((x - VX) / s) < WALL) { const rx = 26 * s + 3; decals.push({ x, y, rx, ry: rx * 0.36, color, life: 6, blobs }); return; }
    }
    const s = Math.abs(x - VX) / WALL, wy = CAM - (y - HORIZON) / s;
    if (s > 1 / END && wy > 0 && wy < 310) { const rx = 15 * s + 3; decals.push({ x, y, rx, ry: rx, color, life: 6, blobs, drip: true }); }
  }

  function gunPose() {
    const px = W * 0.62 + (mouse.x - W / 2) * 0.3, py = H + 130;
    return { px, py, a: Math.atan2(mouse.y - py, mouse.x - px) };
  }

  function shoot(x, y) {
    if (ammo <= 0) { sfx.empty(); return; }
    ammo--; levelShots++;
    const color = PAINTS[shotNo++ % PAINTS.length];
    sfx.shot();
    shake = 6; flashT = 0.07; recoil = 1;
    mouse.x = x; mouse.y = y;
    const gp = gunPose();
    tracer = { x1: gp.px + Math.cos(gp.a) * 250, y1: gp.py + Math.sin(gp.a) * 250, x2: x, y2: y, life: 0.08, color };

    const inRect = (c) => c.rect && x >= c.rect.x && x <= c.rect.x + c.rect.w && y >= c.rect.y && y <= c.rect.y + c.rect.h;
    const rd = depth(runner.z);
    const front = covers.some((c) => c.d < rd && inRect(c));
    const where = front ? null : hitTest(runner, x, y);

    if (where) {
      const head = where === 'head', far = runner.z > 0.6;
      const { sx, gy, S } = scr(runner);
      levelHits++; streak++;
      const mult = (1 + levelIdx * 0.2) * (1 + Math.min(streak - 1, 5) * 0.1) * (far ? 1.5 : 1);
      const pts = Math.round((head ? 250 : 100) * mult);
      score += pts;
      runner.hp -= head ? 2 : 1;
      runner.flash = 0.3;
      runner.panic = 0.8;
      runner.splats.push({ lx: (x - sx) / S, ly: (y - gy - jumpOff(runner, S)) / (S * (ducking(runner) ? 0.62 : 1)), color, r: rand(5, 8) });
      if (head && !runner.hatOff) {
        runner.hatOff = true;
        particles.push({ x: sx, y: gy - 150 * S, vx: rand(-120, 120) * S, vy: -420 * S, life: 1.2, grav: 1000 * S, hat: true, size: S, rot: 0, vr: rand(-9, 9) });
      }
      puff(x, y, 12, color, Math.max(0.5, S));
      addFloat((head ? 'HEADSHOT! +' : '+') + pts, x, y - 24, head ? '#ff5d8f' : '#fff', head ? 26 : 22);
      if (far) addFloat('LONG SHOT x1.5', x, y - 60, '#b8f35d', 15);
      else if (streak >= 3) addFloat('STREAK x' + streak, x, y - 60, '#ffd23f', 15);
      head ? sfx.head() : sfx.hit();
      if (runner.hp <= 0) takedown();
      else { runner.say = pick(['Ouch!', 'Hey!', 'Yikes!', 'Not the vest!']); runner.sayT = 0.8; }
    } else if (front || covers.some(inRect)) {
      sfx.block();
      puff(x, y, 8, '#8a5a2b');
      addFloat('BLOCKED', x, y - 14, '#e9cfa0', 15);
      streak = 0;
    } else {
      streak = 0;
      splatDecal(x, y, color);
      puff(x, y, 5, color, 0.7);
      if (Math.random() < 0.3) { runner.say = pick(['Ha! Missed!', 'Too slow!', 'Nope!', 'Over here!', 'Nice try!', 'Whoosh!']); runner.sayT = 0.9; }
    }
    if (ammo <= 0 && runner.state === 'run') outT = OUT_DELAY;
  }

  // ---------- Input ----------
  function toGame(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = toGame(e);
    aimAt(p.x, p.y); mouse.show = e.pointerType === 'mouse';
  });
  canvas.addEventListener('pointerleave', () => { mouse.show = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = toGame(e);
    aimAt(p.x, p.y); mouse.show = e.pointerType === 'mouse';
    try { audio(); } catch (err) { /* audio unavailable */ }
    if (paused) { paused = false; return; }
    if (e.button === 2) return;
    if (state === 'menu') startGame();
    else if (state === 'intro') { if (stateT > 0.4) { state = 'play'; stateT = 0; } }
    else if (state === 'play') shoot(p.x, p.y);
    else if (state === 'result') { if (stateT > 0.8) advance(); }
    else if (state === 'over') { if (stateT > 1) { state = 'menu'; runner = makeRunner(DEMO); covers = []; clouds = []; } }
  });

  function setMuted(m) {
    muted = m;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  }
  muteBtn.addEventListener('click', () => { setMuted(!muted); muteBtn.blur(); });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'm') setMuted(!muted);
    else if (k === 'p' || k === 'escape') { if (state === 'play' || paused) paused = !paused; }
    else if (k === 'enter') {
      if (state === 'menu') startGame();
      else if (state === 'result' && stateT > 0.8) advance();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // ---------- Update ----------
  function update(dt) {
    stateT += dt; clock += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    if (flashT > 0) flashT -= dt;
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 7);
    if (tracer) { tracer.life -= dt; if (tracer.life <= 0) tracer = null; }

    for (const p of particles) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.hat) p.rot += p.vr * dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const d of decals) d.life -= dt;
    decals = decals.filter((d) => d.life > 0);
    for (const f of floats) { f.life -= dt; f.y -= 40 * dt; }
    floats = floats.filter((f) => f.life > 0);
    for (const c of clouds) {
      c.x += c.vx * dt;
      if (c.x < -c.r) c.x = W + c.r;
      if (c.x > W + c.r) c.x = -c.r;
    }
    for (const m of motes) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < 0) m.x = W; if (m.x > W) m.x = 0;
      if (m.y < 110) m.y = H; if (m.y > H) m.y = 110;
    }

    if (state === 'menu') {
      updateRunner(runner, dt, true);
      if (runner.z >= 1) runner = makeRunner(DEMO);
    } else if (state === 'intro') {
      updateRunner(runner, dt, false);
      if (stateT > 2.2) { state = 'play'; stateT = 0; }
    } else if (state === 'play') {
      updateRunner(runner, dt, true);
      if (runner.z >= 1) escaped();
      else if (outT > 0 && (outT -= dt) <= 0) escaped(true);
    } else {
      updateRunner(runner, dt, true);
    }
  }

  // ---------- Drawing helpers ----------
  function txt(s, x, y, size, color, align = 'center', outline = true, font = UI_FONT) {
    ctx.font = `${font === UI_FONT ? 'bold ' : ''}${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(24,10,30,0.9)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }
  function title(s, x, y, size, c1 = '#ffe9a8', c2 = '#f0a23a') {
    ctx.font = `${size}px ${TITLE_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(20,8,24,0.55)'; ctx.fillText(s, x + size * 0.05, y + size * 0.08);
    ctx.lineWidth = Math.max(4, size / 7); ctx.strokeStyle = '#2a1220'; ctx.strokeText(s, x, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillText(s, x, y);
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function heart(x, y, s, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.75);
    ctx.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.6, y - s * 0.95, x, y - s * 0.3);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 0.95, x + s * 1.3, y - s * 0.1, x, y + s * 0.75);
    ctx.fillStyle = fill; ctx.fill();
  }
  function pill(x, y, w, h, fill = 'rgba(22,10,30,0.55)') {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  }

  function drawHat() {     // local runner units, hat base at y = -141
    ctx.fillStyle = '#2b1b1a';
    ctx.beginPath(); ctx.ellipse(0, -141, 28, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-14, -162, 28, 22, [9, 9, 2, 2]); ctx.fill();
    ctx.fillStyle = '#c8312f'; ctx.fillRect(-14, -147, 28, 4.5);
    ctx.strokeStyle = 'rgba(255,196,128,0.9)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, -141, 28, 8, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9, -162); ctx.lineTo(9, -162); ctx.stroke();
  }

  // Bandit seen from behind, running away from the camera.
  function drawRunner(r) {
    if (r.state === 'flee' && r.z > 1.22) return;
    const { sx, gy, S, d } = scr(r);
    const duck = ducking(r), hF = duck ? 0.62 : 1, jy = jumpOff(r, S);
    const moving = r.state !== 'down' && !r.idle;

    // long shadow toward the camera (sun is ahead)
    const sLen = r.state === 'down' ? 0 : (HORIZON + CAM / Math.max(0.72, d - 0.28)) - gy;
    ctx.fillStyle = 'rgba(30,10,34,0.26)';
    ctx.beginPath(); ctx.ellipse(sx - r.lean * 60 * S, gy + sLen * 0.45, 21 * S, sLen * 0.5 + 4 * S, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(sx, gy + jy);
    if (r.state === 'down') ctx.rotate(r.fallDir * Math.min(1, r.fallT / 0.3) * Math.PI / 2);
    else ctx.rotate(r.lean);
    ctx.scale(S, S * hF);
    if (moving) ctx.translate(0, -Math.abs(Math.sin(r.run)) * 4);
    if (r.flash > 0 && Math.floor(r.flash * 30) % 2) ctx.globalAlpha = 0.45;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const run = moving ? r.run : 0.0;

    // legs: the lifted foot shows its sole to the camera
    for (const side of [-1, 1]) {
      const lift = moving ? Math.max(0, Math.sin(run + (side > 0 ? Math.PI : 0))) : 0;
      const hx = side * 9, fx = side * 11, footY = -lift * 30;
      ctx.strokeStyle = '#2e3350'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(hx, -64); ctx.lineTo(side * 12, -34 - lift * 6); ctx.lineTo(fx, footY - 12); ctx.stroke();
      if (lift > 0.3) {
        ctx.fillStyle = '#3b2416'; ctx.beginPath(); ctx.ellipse(fx, footY - 9, 8.5, 6 + 8 * lift, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1c110b'; ctx.beginPath(); ctx.ellipse(fx, footY - 8, 6, 4 + 7 * lift, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#3b2416'; ctx.beginPath(); ctx.roundRect(fx - 8, footY - 16, 16, 16, [4, 4, 5, 5]); ctx.fill();
        ctx.fillStyle = '#1c110b'; ctx.fillRect(fx - 8, footY - 3, 16, 3);
      }
    }

    // arms pump opposite to the legs; striped sleeves
    for (const side of [-1, 1]) {
      const sw = moving ? Math.sin(run + (side > 0 ? 0 : Math.PI)) : 0;
      const pts = [[side * 22, -110], [side * 28, -88], [side * (26 - 2 * sw), -84 - 15 * sw]];
      ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]);
      ctx.strokeStyle = '#ece4cf'; ctx.lineWidth = 11; ctx.stroke();
      ctx.save(); ctx.setLineDash([4, 6]); ctx.lineCap = 'butt'; ctx.strokeStyle = '#2a2740'; ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#e8b88a'; circle(pts[2][0], pts[2][1], 6);
    }

    // torso: leather vest from behind
    const torso = () => {
      ctx.beginPath();
      ctx.moveTo(-24, -108); ctx.quadraticCurveTo(-25, -120, -12, -120); ctx.lineTo(12, -120);
      ctx.quadraticCurveTo(25, -120, 24, -108); ctx.lineTo(18, -60); ctx.lineTo(-18, -60); ctx.closePath();
    };
    const vg = ctx.createLinearGradient(-24, 0, 24, 0);
    vg.addColorStop(0, '#4a2a1e'); vg.addColorStop(0.5, '#6e4230'); vg.addColorStop(1, '#4a2a1e');
    torso(); ctx.fillStyle = vg; ctx.fill();
    ctx.strokeStyle = 'rgba(30,12,10,0.45)'; ctx.lineWidth = 1.5; line(0, -118, 0, -62);
    ctx.fillStyle = '#1d1410'; ctx.fillRect(-18, -67, 36, 8);
    ctx.fillStyle = '#ece4cf'; ctx.fillRect(-9, -123, 18, 5);
    ctx.strokeStyle = 'rgba(255,196,128,0.85)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-23, -112); ctx.quadraticCurveTo(-23, -120, -12, -120); ctx.lineTo(12, -120); ctx.quadraticCurveTo(23, -120, 23, -112); ctx.stroke();

    // loot sack over the shoulder
    const b = moving ? Math.sin(run * 2) * 2.5 : 0;
    ctx.strokeStyle = '#b08d50'; ctx.lineWidth = 5; line(22, -116 + b, 26, -122);
    const sg = ctx.createRadialGradient(8, -104 + b, 3, 13, -96 + b, 24);
    sg.addColorStop(0, '#edd197'); sg.addColorStop(1, '#a8834a');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(13, -95 + b, 19, 23, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b08d50'; ctx.beginPath(); ctx.ellipse(21, -117 + b, 7, 4.5, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5c431c'; ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', 13, -94 + b);

    // head from behind: hair, ears, bandana knot with fluttering tails
    ctx.fillStyle = '#e8b88a'; ctx.fillRect(-5, -126, 10, 8);
    circle(-13, -133, 3.4); circle(13, -133, 3.4);
    ctx.fillStyle = '#2a1a12'; circle(0, -133, 13);
    ctx.fillStyle = '#c8312f'; ctx.fillRect(-13, -139, 26, 6);
    const fl = Math.sin(clock * 11) * 3;
    ctx.beginPath(); ctx.moveTo(-2, -137); ctx.lineTo(-17 - fl * 0.5, -126 + fl); ctx.lineTo(-11, -124 + fl); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2, -136); ctx.lineTo(-9 + fl * 0.4, -118 - fl); ctx.lineTo(-4, -119 - fl); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a02422'; circle(-2, -136, 3.6);
    if (!r.hatOff) drawHat();

    // paint that stuck to him
    for (const s of r.splats) {
      ctx.fillStyle = s.color;
      circle(s.lx, s.ly, s.r); circle(s.lx + s.r * 0.9, s.ly + s.r * 0.5, s.r * 0.45); circle(s.lx - s.r * 0.6, s.ly + s.r * 0.9, s.r * 0.35);
    }
    ctx.restore();

    const top = gy + jy - 168 * S * hF;
    if (r.state === 'down') {
      const cx = sx + r.fallDir * 120 * S, cy = gy - 34 * S;
      for (let i = 0; i < 3; i++) {
        const an = clock * 5 + i * 2.1;
        txt('★', cx + Math.cos(an) * 22 * S, cy + Math.sin(an) * 8 * S, Math.max(9, 18 * S), '#ffd23f', 'center', false);
      }
    }
    if (r.maxHp > 1 && r.state === 'run') {
      for (let i = 0; i < r.maxHp; i++) heart(sx + (i - (r.maxHp - 1) / 2) * 15, top - 10, 5.5, i < r.hp ? '#ff5d8f' : 'rgba(20,8,26,0.55)');
    }
    if (r.say) {
      ctx.font = `bold 15px ${UI_FONT}`;
      const w = ctx.measureText(r.say).width + 20;
      const bx = clamp(sx, w / 2 + 6, W - w / 2 - 6), by = Math.max(24, top - (r.maxHp > 1 ? 40 : 26));
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath(); ctx.roundRect(bx - w / 2, by - 14, w, 28, 11); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 13); ctx.lineTo(bx + 6, by + 13); ctx.lineTo(bx, by + 22); ctx.fill();
      txt(r.say, bx, by + 1, 15, '#2a1a30', 'center', false);
    }
  }

  // First-person paint revolver that tracks the cursor.
  function drawGun() {
    const { px, py, a } = gunPose();
    ctx.save();
    ctx.translate(px, py); ctx.rotate(a); ctx.scale(1.33, 1.33); ctx.translate(-recoil * 14, 0);
    ctx.fillStyle = '#2a1812'; ctx.beginPath(); ctx.ellipse(16, 4, 46, 31, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2218'; ctx.beginPath(); ctx.ellipse(22, -2, 30, 20, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, -24, 0, 24);
    g.addColorStop(0, '#8189a0'); g.addColorStop(0.45, '#4a5166'); g.addColorStop(1, '#1e2230');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(44, -22, 58, 44, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(15,16,26,0.55)'; ctx.lineWidth = 3;
    for (const y of [-11, 0, 11]) line(52, y, 94, y);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(100, -12); ctx.lineTo(186, -8.5); ctx.lineTo(186, 8.5); ctx.lineTo(100, 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; line(104, -7, 182, -5);
    ctx.fillStyle = PAINTS[shotNo % PAINTS.length]; ctx.fillRect(179, -9.5, 8, 19);
    ctx.fillStyle = '#c9cede'; ctx.fillRect(172, -2, 8, 4);
    ctx.fillStyle = '#1e2230'; ctx.beginPath(); ctx.roundRect(34, -6, 14, 12, 3); ctx.fill();
    if (flashT > 0) {
      ctx.translate(194, 0);
      ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 46);
      fg.addColorStop(0, 'rgba(255,250,210,0.95)'); fg.addColorStop(0.4, 'rgba(255,190,90,0.5)'); fg.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = fg; circle(0, 0, 46);
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) { const rr = i % 2 ? 9 : 28, an = i * Math.PI / 6; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawDecals() {
    for (const d of decals) {
      ctx.globalAlpha = Math.min(1, d.life) * 0.85;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.rx, d.ry, 0, 0, Math.PI * 2); ctx.fill();
      for (const b of d.blobs) { ctx.beginPath(); ctx.ellipse(d.x + Math.cos(b.a) * d.rx * b.d, d.y + Math.sin(b.a) * d.ry * b.d, d.rx * b.r, d.ry * b.r, 0, 0, Math.PI * 2); ctx.fill(); }
      if (d.drip) { ctx.beginPath(); ctx.roundRect(d.x - d.rx * 0.18, d.y, d.rx * 0.36, d.rx * 1.9, d.rx * 0.18); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    pill(12, 10, 196, 46, 'rgba(22,10,30,0.5)');
    txt(`LEVEL ${levelIdx + 1}`, 30, 25, 17, '#fff', 'left', false);
    txt(lv.name, 30, 43, 13, '#ffd9a0', 'left', false);

    pill(W - 222, 10, 210, 46, 'rgba(22,10,30,0.5)');
    title(String(score), W - 62, 26, 22);
    txt('BEST ' + best, W - 62, 45, 10, 'rgba(255,255,255,0.8)', 'center', false);
    for (let i = 0; i < MAX_LIVES; i++) heart(W - 196 + i * 26, 32, 10, i < lives ? '#ff5d8f' : 'rgba(255,255,255,0.16)');

    // distance to the town limit
    const bw = 300, bx = W / 2 - bw / 2, by = 26, p = clamp(runner.z, 0, 1);
    pill(bx - 16, by - 14, bw + 84, 28, 'rgba(22,10,30,0.5)');
    pill(bx, by - 5, bw, 10, 'rgba(255,255,255,0.14)');
    pill(bx, by - 5, Math.max(10, bw * p), 10, p > 0.75 ? '#ff5d5d' : p > 0.5 ? '#ffb347' : '#5fd08a');
    ctx.fillStyle = '#fff'; circle(bx + bw * p, by, 7);
    ctx.fillStyle = '#2b1b1a'; circle(bx + bw * p, by, 4);
    txt('ESCAPE', bx + bw + 12, by + 1, 11, p > 0.75 ? '#ff8f8f' : '#fff', 'left', false);

    // cartridges
    pill(12, H - 54, 34 + lv.ammo * 17, 42, 'rgba(22,10,30,0.5)');
    for (let i = 0; i < lv.ammo; i++) {
      const x = 28 + i * 17, y = H - 46, on = i < ammo;
      ctx.fillStyle = on ? '#d9a441' : 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.roundRect(x, y + 8, 11, 18, 2); ctx.fill();
      ctx.fillStyle = on ? PAINTS[(shotNo + (ammo - 1 - i)) % PAINTS.length] : 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.roundRect(x, y, 11, 11, [5.5, 5.5, 0, 0]); ctx.fill();
    }
  }

  function panel(w, h) {
    const x = W / 2 - w / 2, y = H / 2 - h / 2;
    ctx.fillStyle = 'rgba(10,4,16,0.35)';
    ctx.beginPath(); ctx.roundRect(x + 5, y + 8, w, h, 16); ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(58,30,52,0.96)'); g.addColorStop(1, 'rgba(28,14,34,0.96)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 16); ctx.fill();
    ctx.strokeStyle = '#f0a23a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,233,168,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x + 7, y + 7, w - 14, h - 14, 11); ctx.stroke();
  }

  function blink(s, y) {
    if (Math.floor(performance.now() / 450) % 2) txt(s, W / 2, y, 17, '#fff');
  }

  function drawOverlay() {
    if (state === 'menu') {
      ctx.fillStyle = 'rgba(20,8,28,0.28)'; ctx.fillRect(0, 0, W, H);
      title('ZIGZAG BANDIT', W / 2, 112, 74);
      txt('He runs for the town limit and never in a straight line.', W / 2, 172, 19, '#fff');
      blink('CLICK TO START', 440);
      if (best > 0) txt('BEST ' + best, W / 2, 470, 14, '#ffd9a0');
      txt('Click: shoot   ·   limited bullets, no reloads   ·   P: pause   ·   M: mute', W / 2, H - 20, 12, 'rgba(255,255,255,0.85)');
    } else if (state === 'intro') {
      panel(540, 176);
      txt(`LEVEL ${levelIdx + 1}`, W / 2, H / 2 - 54, 16, '#ffd9a0', 'center', false);
      title(lv.name, W / 2, H / 2 - 10, 42);
      txt(lv.tip, W / 2, H / 2 + 42, 16, '#fff', 'center', false);
      txt(`${lv.ammo} bullets · no reloads`, W / 2, H / 2 + 68, 14, '#ffd23f', 'center', false);
    } else if (state === 'play' && stateT < 0.6) {
      ctx.globalAlpha = 1 - stateT / 0.6;
      title('GO!', W / 2, H / 2 - 60, 90 + stateT * 40);
      ctx.globalAlpha = 1;
    } else if (state === 'result' && stateT > 0.6) {
      if (result.win) {
        panel(480, 262);
        title(result.cleared ? 'TOWN IS SAFE!' : 'GOT HIM!', W / 2, H / 2 - 88, 40, '#d6ffb0', '#5fd08a');
        for (let i = 0; i < 3; i++) txt('★', W / 2 + (i - 1) * 54, H / 2 - 34, 46, i < result.stars ? '#ffd23f' : 'rgba(255,255,255,0.16)', 'center', i < result.stars);
        txt(`Accuracy ${Math.round(result.acc * 100)}%   +${result.accBonus}`, W / 2, H / 2 + 16, 16, '#fff', 'center', false);
        txt(`Caught early   +${result.distBonus}`, W / 2, H / 2 + 42, 16, '#fff', 'center', false);
        blink(result.cleared ? 'CLICK FOR OVERTIME' : 'CLICK FOR NEXT LEVEL', H / 2 + 92);
      } else {
        panel(440, 180);
        title('HE GOT AWAY!', W / 2, H / 2 - 40, 38, '#ffc0b0', '#ff5d5d');
        for (let i = 0; i < MAX_LIVES; i++) heart(W / 2 + (i - 1) * 34, H / 2 + 8, 12, i < lives ? '#ff5d8f' : 'rgba(255,255,255,0.16)');
        blink('CLICK TO TRY AGAIN', H / 2 + 56);
      }
    } else if (state === 'over' && stateT > 0.6) {
      panel(480, 230);
      title('GAME OVER', W / 2, H / 2 - 66, 48, '#ffc0b0', '#ff5d5d');
      title(String(score), W / 2, H / 2 - 8, 32);
      txt(`Reached level ${levelIdx + 1}` + (score >= best && score > 0 ? '   ·   NEW BEST!' : `   ·   Best ${best}`), W / 2, H / 2 + 32, 15, '#fff', 'center', false);
      blink('CLICK TO CONTINUE', H / 2 + 80);
    }
    if (paused) {
      ctx.fillStyle = 'rgba(12,4,18,0.6)'; ctx.fillRect(0, 0, W, H);
      title('PAUSED', W / 2, H / 2 - 14, 56);
      txt('Click or press P to resume', W / 2, H / 2 + 40, 17, '#fff');
    }
  }

  function drawCrosshair() {
    if (!mouse.show) return;
    const { x, y } = mouse, hot = state === 'play' && ammo > 0;
    const gap = 7 + recoil * 8;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? (hot ? '#ff4040' : '#fff') : 'rgba(10,4,16,0.65)';
      ctx.lineWidth = pass ? 2 : 5;
      ctx.beginPath(); ctx.arc(x, y, 15 + recoil * 6, 0, Math.PI * 2); ctx.stroke();
      line(x - 24 - recoil * 8, y, x - gap, y); line(x + gap, y, x + 24 + recoil * 8, y);
      line(x, y - 24 - recoil * 8, x, y - gap); line(x, y + gap, x, y + 24 + recoil * 8);
    }
    ctx.fillStyle = hot ? '#ff4040' : '#fff'; circle(x, y, 1.8);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    ctx.drawImage(bg, -8, -8, W + 16, H + 16);
    drawDecals();

    // depth-sorted: far things first
    const things = covers.map((c) => ({ d: c.d, c }));
    things.push({ d: depth(runner.z), r: runner });
    things.sort((a, b) => b.d - a.d);
    for (const t of things) { if (t.r) drawRunner(t.r); else t.c.rect = drawCover(ctx, t.c); }

    for (const c of clouds) ctx.drawImage(dustSprite, c.x - c.r, c.y - c.r * 0.6, c.r * 2, c.r * 1.2);
    ctx.fillStyle = 'rgba(255,224,170,0.35)';
    for (const m of motes) circle(m.x, m.y, m.r);

    for (const p of particles) {
      if (p.hat) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.size, p.size); ctx.translate(0, 150);
        ctx.globalAlpha = Math.min(1, p.life * 3); drawHat(); ctx.restore();
      } else if (p.soft) {
        ctx.globalAlpha = Math.min(1, p.life * 2) * 0.55;
        ctx.drawImage(dustSprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      } else {
        ctx.globalAlpha = Math.min(1, p.life * 3); ctx.fillStyle = p.color; circle(p.x, p.y, p.size);
      }
    }
    ctx.globalAlpha = 1;
    if (tracer) {
      ctx.globalAlpha = tracer.life / 0.08;
      ctx.lineCap = 'round';
      ctx.strokeStyle = tracer.color; ctx.lineWidth = 5; line(tracer.x1, tracer.y1, tracer.x2, tracer.y2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; line(tracer.x1, tracer.y1, tracer.x2, tracer.y2);
      ctx.globalAlpha = 1;
    }
    for (const f of floats) { ctx.globalAlpha = Math.min(1, f.life * 2); txt(f.text, f.x, f.y, f.size, f.color); }
    ctx.globalAlpha = 1;
    if (state !== 'menu') drawGun();
    ctx.restore();

    const v = ctx.createRadialGradient(VX, H * 0.5, H * 0.5, VX, H * 0.5, H * 1.1);
    v.addColorStop(0, 'rgba(14,4,22,0)'); v.addColorStop(1, 'rgba(14,4,22,0.6)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (flashT > 0) { ctx.fillStyle = 'rgba(255,240,200,0.1)'; ctx.fillRect(0, 0, W, H); }

    if (state !== 'menu') drawHUD();
    drawOverlay();
    drawCrosshair();
  }

  // ---------- Main loop ----------
  runner = makeRunner(DEMO);
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Read-only hook for automated tests.
  window.zigzag = {
    get state() { return state; }, get runner() { return runner; }, get score() { return score; }, get level() { return levelIdx + 1; }, get stillness() { return stillness(); }, get ammo() { return ammo; }, get lives() { return lives; }, wouldHit(x, y) { return hitTest(runner, x, y); },
    aim(part) { const { sx, gy, S } = scr(runner), hF = ducking(runner) ? 0.62 : 1; return { x: sx, y: gy + jumpOff(runner, S) - (part === 'head' ? 133 : 90) * S * hF }; },
  };
})();
