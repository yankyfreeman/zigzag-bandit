(() => {
  'use strict';

  // ---------- Setup ----------
  const W = 960, H = 540, GROUND = 430, EDGE = 40;
  const CLIP = 6, RELOAD_TIME = 0.8, JUMP = 0.5, MAX_LIVES = 3;
  const BEST_KEY = 'zigzag-bandit-best';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const muteBtn = document.getElementById('mute');

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const rand = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Levels ----------
  // speed = steps per second, scale = runner size, backMax = longest backtrack (steps),
  // cover = number of obstacles, jump/feint = chance per direction change.
  const LEVELS = [
    { name: 'Warm-up',       tip: 'Click to shoot. Stop him before the EXIT!', speed: 4.0, hp: 1, scale: 1.25, backMax: 2, cover: 0, jump: 0,    feint: 0 },
    { name: 'Quick Feet',    tip: 'He found his running shoes.',               speed: 5.2, hp: 1, scale: 1.15, backMax: 3, cover: 0, jump: 0,    feint: 0 },
    { name: 'Crate Yard',    tip: 'Crates block your shots.',                  speed: 5.4, hp: 1, scale: 1.1,  backMax: 3, cover: 2, jump: 0,    feint: 0 },
    { name: 'Padded Vest',   tip: 'Takes 2 hits. A headshot counts double.',   speed: 5.6, hp: 2, scale: 1.1,  backMax: 3, cover: 1, jump: 0,    feint: 0 },
    { name: 'Jumping Jack',  tip: 'Now he jumps and slides.',                  speed: 6.0, hp: 2, scale: 1.05, backMax: 3, cover: 2, jump: 0.4,  feint: 0, tall: true },
    { name: 'Fake Out',      tip: 'Watch for the stutter-step.',               speed: 6.4, hp: 2, scale: 1.0,  backMax: 4, cover: 2, jump: 0.25, feint: 0.4, tall: true },
    { name: 'Long Range',    tip: 'Smaller target. Steady hands.',             speed: 6.6, hp: 2, scale: 0.78, backMax: 4, cover: 2, jump: 0.25, feint: 0.3, tall: true },
    { name: 'Dust Storm',    tip: 'Shoot through the dust.',                   speed: 6.8, hp: 2, scale: 0.95, backMax: 4, cover: 2, jump: 0.3,  feint: 0.3, tall: true, dust: true },
    { name: 'Triple Padding', tip: '3 hits to stop him. Aim for the head.',    speed: 7.2, hp: 3, scale: 0.95, backMax: 4, cover: 3, jump: 0.3,  feint: 0.35, tall: true },
    { name: 'The Ghost',     tip: 'Everything at once. Good luck.',            speed: 8.0, hp: 3, scale: 0.85, backMax: 5, cover: 3, jump: 0.4,  feint: 0.45, tall: true, dust: true },
  ];

  function getLevel(i) {
    if (i < LEVELS.length) return LEVELS[i];
    const b = LEVELS[LEVELS.length - 1];
    const k = i - LEVELS.length + 1;
    return { ...b, name: 'Overtime ' + k, tip: 'Even faster.', speed: b.speed + 0.5 * k, scale: Math.max(0.6, b.scale - 0.03 * k) };
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
  const sfx = {
    shot() { noise(0.14, 0.3); tone(200, 0.1, 'square', 0.1, 60); },
    hit() { tone(520, 0.12, 'triangle', 0.2, 880); },
    head() { tone(660, 0.08, 'triangle', 0.2); tone(990, 0.14, 'triangle', 0.2, 0, 0.07); },
    block() { tone(130, 0.08, 'square', 0.15, 80); },
    empty() { tone(900, 0.03, 'square', 0.08); },
    reload() { tone(300, 0.04, 'square', 0.08); tone(450, 0.05, 'square', 0.08, 0, RELOAD_TIME - 0.1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.18, 0, i * 0.09)); },
    escape() { tone(420, 0.5, 'sawtooth', 0.12, 140); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, 0, i * 0.18)); },
  };

  // ---------- State ----------
  let state = 'menu';       // menu | intro | play | result | over
  let stateT = 0, paused = false;
  let levelIdx = 0, lv = LEVELS[0];
  let score = 0, lives = MAX_LIVES, streak = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* no storage */ }
  let ammo = CLIP, reloading = 0;
  let levelShots = 0, levelHits = 0;
  let runner = null, covers = [], dust = [];
  let particles = [], decals = [], floats = [];
  let result = null;
  let shake = 0, flashT = 0;
  const mouse = { x: W / 2, y: H / 2, show: false };

  // ---------- Runner ----------
  function makeRunner(level, dir) {
    const r = {
      lv: level, dir, face: dir, s: level.scale, stepLen: 30 * level.scale,
      x: dir > 0 ? EDGE : W - EDGE, x0: dir > 0 ? EDGE : W - EDGE,
      hp: level.hp, maxHp: level.hp,
      segDir: dir, stepsLeft: 0, stepT: 0, steps: 0, forwardNext: true,
      pause: 0, jumpT: -1, slideT: 0, panic: 0, flash: 0,
      state: 'run', fallT: 0, hatOff: false, say: null, sayT: 0,
    };
    nextSegment(r);
    return r;
  }

  function progress(r) {
    const p = r.dir > 0 ? (r.x - EDGE) / (W - 2 * EDGE) : (W - EDGE - r.x) / (W - 2 * EDGE);
    return Math.max(0, Math.min(1, p));
  }

  // The "weird pattern": forward a few steps, back a few, forward again...
  // Forward runs are longer on average, so he always gets to the exit eventually.
  function nextSegment(r) {
    const L = r.lv;
    let forward = r.forwardNext, n;
    if (!forward) {
      const room = Math.floor(progress(r) * (W - 2 * EDGE) / r.stepLen);
      n = Math.min(rint(1, L.backMax), room);
      if (n <= 0) forward = true;
    }
    if (forward) n = rint(2, 7);
    r.segDir = forward ? r.dir : -r.dir;
    r.face = r.segDir;
    r.stepsLeft = n;
    r.forwardNext = !forward;
    if (Math.random() < L.feint) r.pause = rand(0.12, 0.3);
    if (Math.random() < L.jump) {
      if (Math.random() < 0.5) r.jumpT = 0; else r.slideT = 0.5;
    }
  }

  function jumpY(r) {
    return r.jumpT >= 0 ? -Math.sin(Math.PI * r.jumpT / JUMP) * 70 * r.s : 0;
  }

  function updateRunner(r, dt) {
    if (r.flash > 0) r.flash -= dt;
    if (r.say) { r.sayT -= dt; if (r.sayT <= 0) r.say = null; }
    if (r.state === 'down') { r.fallT += dt; return; }
    if (r.panic > 0) r.panic -= dt;
    if (r.jumpT >= 0) { r.jumpT += dt; if (r.jumpT >= JUMP) r.jumpT = -1; }
    if (r.slideT > 0) r.slideT -= dt;
    if (r.state === 'flee') { r.x += r.dir * 500 * dt; r.steps += dt * 12; return; }
    if (r.pause > 0) { r.pause -= dt; return; }
    const sp = r.lv.speed * (r.panic > 0 ? 1.5 : 1);
    r.stepT += dt * sp;
    while (r.stepT >= 1) {
      r.stepT -= 1;
      r.x0 += r.segDir * r.stepLen;
      r.steps++;
      r.stepsLeft--;
      if (r.stepsLeft <= 0) {
        nextSegment(r);
        puff(r.x0, GROUND, 4, '#d9b382');
        if (r.pause > 0) { r.stepT = 0; break; }
      }
    }
    const t = r.stepT, e = 0.5 * t + 0.5 * t * t * (3 - 2 * t);
    r.x = r.x0 + r.segDir * r.stepLen * e;
  }

  function hitTest(r, px, py) {
    const s = r.s, hF = r.slideT > 0 ? 0.55 : 1, base = GROUND + jumpY(r);
    const hx = r.x + r.face * 2 * s, hy = base - 90 * s * hF;
    if (Math.hypot(px - hx, py - hy) <= 14 * s + 3) return 'head';
    if (Math.abs(px - r.x) <= 17 * s && py <= base + 2 && py >= base - 80 * s * hF) return 'body';
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
    const dir = levelIdx % 2 === 0 ? 1 : -1;
    runner = makeRunner(lv, dir);
    covers = [];
    for (let i = 0; i < lv.cover; i++) {
      const cx = 220 + (i + 0.5) * (W - 440) / lv.cover + rand(-40, 40);
      const tall = lv.tall && Math.random() < 0.35;
      const w = tall ? 56 : 72, h = tall ? 124 : 64;
      covers.push({ x: cx - w / 2, y: GROUND + 12 - h, w, h, tall });
    }
    dust = [];
    if (lv.dust) for (let i = 0; i < 6; i++) dust.push({ x: rand(0, W), y: rand(GROUND - 150, GROUND), r: rand(50, 90), vx: rand(30, 80) * (i % 2 ? 1 : -1) });
    ammo = CLIP; reloading = 0;
    levelShots = 0; levelHits = 0;
    result = null;
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
    const distBonus = Math.round((1 - progress(runner)) * 300 * mult);
    const accBonus = Math.round(acc * 200 * mult);
    score += distBonus + accBonus;
    result = { win: true, stars: acc >= 0.6 ? 3 : acc >= 0.3 ? 2 : 1, distBonus, accBonus, acc, cleared: levelIdx === LEVELS.length - 1 };
    runner.state = 'down';
    runner.say = null;
    for (let i = 0; i < 18; i++) particles.push({ x: runner.x, y: GROUND - 60 * runner.s, vx: rand(-220, 220), vy: rand(-380, -120), life: rand(0.6, 1.1), color: '#ffd23f', size: rand(3, 5), grav: 900 });
    sfx.win();
    saveBest();
    state = 'result'; stateT = 0;
  }

  function escaped() {
    lives--;
    streak = 0;
    runner.state = 'flee';
    runner.say = pick(['So long!', 'Bye bye!', 'Catch you never!', 'Ha ha ha!']);
    runner.sayT = 2;
    saveBest();
    if (lives <= 0) { sfx.over(); state = 'over'; } else { sfx.escape(); result = { win: false }; state = 'result'; }
    stateT = 0;
  }

  function advance() {
    if (result && result.win) levelIdx++;
    startLevel();
  }

  // ---------- Shooting ----------
  function startReload() {
    if (reloading > 0 || ammo === CLIP || state !== 'play') return;
    reloading = RELOAD_TIME;
    sfx.reload();
  }

  function puff(x, y, n, color) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-80, 80), vy: rand(-120, -20), life: rand(0.25, 0.5), color, size: rand(2, 4), grav: 300 });
  }

  function addFloat(text, x, y, color, size = 22) {
    floats.push({ text, x, y, color, size, life: 1 });
  }

  function shoot(x, y) {
    if (reloading > 0) return;
    if (ammo <= 0) { sfx.empty(); startReload(); return; }
    ammo--; levelShots++;
    sfx.shot();
    shake = 5; flashT = 0.06;

    let blocked = false;
    for (const c of covers) {
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) { blocked = true; break; }
    }
    const where = blocked ? null : hitTest(runner, x, y);

    if (blocked) {
      sfx.block();
      puff(x, y, 8, '#8a5a2b');
      addFloat('BLOCKED', x, y - 14, '#e0c097', 16);
      streak = 0;
    } else if (where) {
      const head = where === 'head';
      levelHits++; streak++;
      const mult = (1 + levelIdx * 0.2) * (1 + Math.min(streak - 1, 5) * 0.1);
      const pts = Math.round((head ? 250 : 100) * mult);
      score += pts;
      runner.hp -= head ? 2 : 1;
      runner.flash = 0.3;
      runner.panic = 0.8;
      if (head) runner.hatOff = true;
      puff(x, y, 12, head ? '#ff5d8f' : '#4cc9f0');
      addFloat((head ? 'HEADSHOT! +' : '+') + pts, x, y - 20, head ? '#ff5d8f' : '#fff', head ? 26 : 22);
      if (streak >= 3) addFloat('STREAK x' + streak, x, y - 48, '#ffd23f', 16);
      head ? sfx.head() : sfx.hit();
      if (runner.hp <= 0) takedown();
      else { runner.say = pick(['Ouch!', 'Hey!', 'Yikes!', 'Not the vest!']); runner.sayT = 0.8; }
    } else {
      streak = 0;
      decals.push({ x, y, r: rand(6, 10), life: 4, color: pick(['#4cc9f0', '#ff5d8f', '#b8f35d']) });
      puff(x, y, 5, '#fff');
      if (Math.random() < 0.3) { runner.say = pick(['Ha! Missed!', 'Too slow!', 'Nope!', 'Over here!', 'Nice try!', 'Whoosh!']); runner.sayT = 0.9; }
    }
    if (ammo <= 0 && state === 'play') startReload();
  }

  // ---------- Input ----------
  function toGame(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = toGame(e);
    mouse.x = p.x; mouse.y = p.y; mouse.show = e.pointerType === 'mouse';
  });
  canvas.addEventListener('pointerleave', () => { mouse.show = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = toGame(e);
    mouse.x = p.x; mouse.y = p.y; mouse.show = e.pointerType === 'mouse';
    try { audio(); } catch (err) { /* audio unavailable */ }
    if (paused) { paused = false; return; }
    if (e.button === 2) { startReload(); return; }
    if (state === 'menu') startGame();
    else if (state === 'intro') { if (stateT > 0.4) { state = 'play'; stateT = 0; } }
    else if (state === 'play') shoot(p.x, p.y);
    else if (state === 'result') { if (stateT > 0.8) advance(); }
    else if (state === 'over') { if (stateT > 1) { state = 'menu'; runner = makeRunner(LEVELS[1], 1); covers = []; dust = []; } }
  });

  function setMuted(m) {
    muted = m;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  }
  muteBtn.addEventListener('click', () => { setMuted(!muted); muteBtn.blur(); });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r' || k === ' ') { e.preventDefault(); startReload(); }
    else if (k === 'm') setMuted(!muted);
    else if (k === 'p' || k === 'escape') { if (state === 'play' || paused) paused = !paused; }
    else if (k === 'enter') {
      if (state === 'menu') startGame();
      else if (state === 'result' && stateT > 0.8) advance();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // ---------- Update ----------
  function update(dt) {
    stateT += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    if (flashT > 0) flashT -= dt;

    for (const p of particles) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const d of decals) d.life -= dt;
    decals = decals.filter((d) => d.life > 0);
    for (const f of floats) { f.life -= dt; f.y -= 40 * dt; }
    floats = floats.filter((f) => f.life > 0);
    for (const d of dust) {
      d.x += d.vx * dt;
      if (d.x < -d.r) d.x = W + d.r;
      if (d.x > W + d.r) d.x = -d.r;
    }

    if (state === 'menu') {
      updateRunner(runner, dt);
      if (progress(runner) >= 1) runner = makeRunner(LEVELS[1], -runner.dir);
    } else if (state === 'intro') {
      if (stateT > 2.2) { state = 'play'; stateT = 0; }
    } else if (state === 'play') {
      if (reloading > 0) { reloading -= dt; if (reloading <= 0) { reloading = 0; ammo = CLIP; } }
      updateRunner(runner, dt);
      if (progress(runner) >= 1) escaped();
    } else {
      updateRunner(runner, dt);
    }
  }

  // ---------- Drawing ----------
  function txt(s, x, y, size, color, align = 'center', outline = true) {
    ctx.font = `bold ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(20,10,30,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#2b1b4d'); g.addColorStop(0.55, '#c2456b'); g.addColorStop(1, '#ffb25e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);
    ctx.fillStyle = '#ffe8a3';
    circle(700, 330, 60);
    // mesas
    ctx.fillStyle = '#6b3358';
    ctx.beginPath();
    ctx.moveTo(0, GROUND - 20); ctx.lineTo(0, 300); ctx.lineTo(90, 300); ctx.lineTo(110, 250); ctx.lineTo(230, 250); ctx.lineTo(250, 320);
    ctx.lineTo(420, 340); ctx.lineTo(450, 280); ctx.lineTo(560, 280); ctx.lineTo(590, 345); ctx.lineTo(780, 350); ctx.lineTo(800, 300);
    ctx.lineTo(900, 300); ctx.lineTo(920, 340); ctx.lineTo(W, 340); ctx.lineTo(W, GROUND - 20);
    ctx.fill();
    // ground
    const gg = ctx.createLinearGradient(0, GROUND - 30, 0, H);
    gg.addColorStop(0, '#d99a56'); gg.addColorStop(1, '#8a5a30');
    ctx.fillStyle = gg;
    ctx.fillRect(0, GROUND - 30, W, H - GROUND + 30);
    // background cacti
    ctx.strokeStyle = '#2f6b4f'; ctx.lineCap = 'round';
    for (const [cx, ch] of [[150, 60], [520, 45], [840, 70]]) {
      ctx.lineWidth = 14; line(cx, GROUND - 28, cx, GROUND - 28 - ch);
      ctx.lineWidth = 9;
      line(cx - 18, GROUND - 28 - ch * 0.4, cx, GROUND - 28 - ch * 0.4); line(cx - 18, GROUND - 28 - ch * 0.4, cx - 18, GROUND - 28 - ch * 0.7);
      line(cx + 18, GROUND - 28 - ch * 0.55, cx, GROUND - 28 - ch * 0.55); line(cx + 18, GROUND - 28 - ch * 0.55, cx + 18, GROUND - 28 - ch * 0.85);
    }
  }

  function drawExit(dir) {
    const x = dir > 0 ? W - 34 : 34;
    ctx.strokeStyle = '#4a2f1b'; ctx.lineWidth = 8; ctx.lineCap = 'butt';
    line(x, GROUND + 8, x, GROUND - 150);
    ctx.fillStyle = '#2fbf71';
    ctx.beginPath(); ctx.roundRect(x - 32, GROUND - 180, 64, 34, 6); ctx.fill();
    txt('EXIT', x, GROUND - 162, 18, '#fff', 'center', false);
    txt(dir > 0 ? '→' : '←', x, GROUND - 128, 22, '#fff');
  }

  function drawRunner(r) {
    const s = r.s, hF = r.slideT > 0 && r.state === 'run' ? 0.55 : 1;
    const base = GROUND + jumpY(r);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(r.x, GROUND + 4, 24 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(r.x, base);
    if (r.state === 'down') ctx.rotate(-r.face * Math.min(1, r.fallT / 0.35) * Math.PI / 2);
    ctx.scale(r.face * s, s * hF);
    if (r.flash > 0 && Math.floor(r.flash * 30) % 2) ctx.globalAlpha = 0.45;
    const moving = r.state !== 'down' && r.pause <= 0;
    const a = moving ? Math.sin((r.steps + r.stepT) * Math.PI) * 0.8 : 0;
    ctx.lineCap = 'round';

    // loot bag
    ctx.fillStyle = '#c9a66b'; circle(-18, -58, 13);
    ctx.fillStyle = '#6b4a1e'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(-18, -57); ctx.scale(r.face, 1); ctx.fillText('$', 0, 0); ctx.restore();
    // legs
    ctx.strokeStyle = '#22223b'; ctx.lineWidth = 8;
    line(0, -40, Math.sin(a) * 26, -40 + Math.cos(a) * 40);
    line(0, -40, Math.sin(-a) * 26, -40 + Math.cos(a) * 40);
    // back arm
    ctx.strokeStyle = '#d8d5c4'; ctx.lineWidth = 6;
    line(0, -70, Math.sin(a) * 18, -70 + Math.cos(a) * 24);
    // striped shirt
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-13, -78, 26, 42, 8); ctx.clip();
    ctx.fillStyle = '#f4f1de'; ctx.fillRect(-13, -78, 26, 42);
    ctx.fillStyle = '#22223b';
    for (let y = -72; y < -36; y += 12) ctx.fillRect(-13, y, 26, 6);
    ctx.restore();
    // front arm
    ctx.strokeStyle = '#f4f1de'; ctx.lineWidth = 6;
    line(0, -70, Math.sin(-a) * 18, -70 + Math.cos(a) * 24);
    // head, mask, hat
    ctx.fillStyle = '#f2c9a0'; circle(2, -90, 13);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(-10, -96, 25, 8, 3); ctx.fill();
    ctx.fillStyle = '#fff'; circle(8, -92, 2.2);
    if (r.state === 'down') { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; line(4, -84, 11, -84); }
    if (!r.hatOff) {
      ctx.fillStyle = '#3d2c2e';
      ctx.beginPath(); ctx.ellipse(2, -100, 19, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-8, -115, 20, 15, 4); ctx.fill();
    }
    ctx.restore();

    // dizzy stars
    if (r.state === 'down') {
      const hx = r.x - r.face * 85 * s, hy = GROUND - 30 * s;
      for (let i = 0; i < 3; i++) {
        const an = stateT * 5 + i * 2.1;
        txt('★', hx + Math.cos(an) * 20, hy - 14 + Math.sin(an) * 7, 14, '#ffd23f', 'center', false);
      }
    }
    // hp pips
    if (r.maxHp > 1 && r.state === 'run') {
      const top = base - 125 * s * hF;
      for (let i = 0; i < r.maxHp; i++) {
        ctx.fillStyle = i < r.hp ? '#ff5d8f' : 'rgba(0,0,0,0.4)';
        circle(r.x + (i - (r.maxHp - 1) / 2) * 13, top, 4.5);
      }
    }
    // speech bubble
    if (r.say) {
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      const w = ctx.measureText(r.say).width + 18;
      const bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, r.x)), by = base - 148 * s * hF - 4;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(bx - w / 2, by - 14, w, 28, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 13); ctx.lineTo(bx + 6, by + 13); ctx.lineTo(bx, by + 22); ctx.fill();
      txt(r.say, bx, by, 15, '#22223b', 'center', false);
    }
  }

  function drawCover(c) {
    if (c.tall) {
      for (let i = 0; i < 2; i++) {
        const y = c.y + i * c.h / 2;
        ctx.fillStyle = '#a34a28'; ctx.beginPath(); ctx.roundRect(c.x, y, c.w, c.h / 2, 8); ctx.fill();
        ctx.fillStyle = '#6e2f18'; ctx.fillRect(c.x, y + 10, c.w, 5); ctx.fillRect(c.x, y + c.h / 2 - 15, c.w, 5);
      }
    } else {
      ctx.fillStyle = '#b07a3f'; ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = '#6b4520'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
      ctx.strokeRect(c.x + 2.5, c.y + 2.5, c.w - 5, c.h - 5);
      line(c.x + 4, c.y + 4, c.x + c.w - 4, c.y + c.h - 4);
      line(c.x + c.w - 4, c.y + 4, c.x + 4, c.y + c.h - 4);
    }
  }

  function drawHUD() {
    txt(`LEVEL ${levelIdx + 1}`, 16, 22, 20, '#fff', 'left');
    txt(lv.name, 16, 44, 14, '#ffd9a0', 'left');
    txt(String(score), W - 16, 22, 24, '#ffd23f', 'right');
    txt('BEST ' + best, W - 16, 46, 12, '#fff', 'right');
    for (let i = 0; i < MAX_LIVES; i++) txt('♥', W - 150 - i * 24, 22, 24, i < lives ? '#ff5d8f' : 'rgba(0,0,0,0.35)', 'right', i < lives);

    // escape progress bar
    const bw = 300, bx = W / 2 - bw / 2, by = 22, p = progress(runner);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.roundRect(bx, by - 6, bw, 12, 6); ctx.fill();
    ctx.fillStyle = p > 0.75 ? '#ff5d5d' : p > 0.5 ? '#ffb347' : '#2fbf71';
    ctx.beginPath(); ctx.roundRect(bx, by - 6, Math.max(12, bw * p), 12, 6); ctx.fill();
    txt('🏃', bx + bw * p, by - 1, 16, '#fff', 'center', false);
    txt('EXIT', bx + bw + 8, by, 12, '#fff', 'left');

    // ammo
    for (let i = 0; i < CLIP; i++) {
      ctx.fillStyle = i < ammo ? '#ffd23f' : 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.roundRect(18 + i * 16, H - 44, 10, 26, [5, 5, 2, 2]); ctx.fill();
    }
    if (reloading > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(18, H - 12, 90, 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(18, H - 12, 90 * (1 - reloading / RELOAD_TIME), 5);
      txt('RELOADING', 124, H - 31, 14, '#fff', 'left');
    } else if (ammo < CLIP) {
      txt('R / right-click: reload', 124, H - 31, 12, 'rgba(255,255,255,0.8)', 'left');
    }
  }

  function panel(w, h) {
    ctx.fillStyle = 'rgba(25,14,40,0.88)';
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, H / 2 - h / 2, w, h, 18); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.stroke();
  }

  function blink(s, y) {
    if (Math.floor(performance.now() / 450) % 2) txt(s, W / 2, y, 18, '#fff');
  }

  function drawOverlay() {
    if (state === 'menu') {
      txt('ZIGZAG BANDIT', W / 2, 150, 68, '#ffd23f');
      txt('He runs weird. You shoot paint. Stop him before the exit.', W / 2, 210, 20, '#fff');
      blink('CLICK TO START', 268);
      txt('Click: shoot   ·   R / Space / right-click: reload   ·   P: pause   ·   M: mute', W / 2, H - 22, 13, 'rgba(255,255,255,0.85)');
      if (best > 0) txt('BEST ' + best, W / 2, 304, 16, '#ffd9a0');
    } else if (state === 'intro') {
      panel(520, 170);
      txt(`LEVEL ${levelIdx + 1}`, W / 2, H / 2 - 48, 22, '#ffd9a0');
      txt(lv.name, W / 2, H / 2 - 8, 40, '#ffd23f');
      txt(lv.tip, W / 2, H / 2 + 42, 17, '#fff', 'center', false);
    } else if (state === 'play' && stateT < 0.6) {
      ctx.globalAlpha = 1 - stateT / 0.6;
      txt('GO!', W / 2, H / 2 - 40, 80, '#fff');
      ctx.globalAlpha = 1;
    } else if (state === 'result' && stateT > 0.6) {
      if (result.win) {
        panel(480, 250);
        txt(result.cleared ? 'ALL 10 LEVELS CLEARED!' : 'GOT HIM!', W / 2, H / 2 - 88, result.cleared ? 30 : 40, '#2fbf71');
        for (let i = 0; i < 3; i++) txt('★', W / 2 + (i - 1) * 52, H / 2 - 36, 46, i < result.stars ? '#ffd23f' : 'rgba(255,255,255,0.2)', 'center', i < result.stars);
        txt(`Accuracy ${Math.round(result.acc * 100)}%   +${result.accBonus}`, W / 2, H / 2 + 14, 17, '#fff', 'center', false);
        txt(`Caught early   +${result.distBonus}`, W / 2, H / 2 + 40, 17, '#fff', 'center', false);
        blink(result.cleared ? 'CLICK FOR OVERTIME' : 'CLICK FOR NEXT LEVEL', H / 2 + 88);
      } else {
        panel(440, 170);
        txt('HE GOT AWAY!', W / 2, H / 2 - 36, 38, '#ff5d5d');
        txt(`${lives} ${lives === 1 ? 'life' : 'lives'} left`, W / 2, H / 2 + 8, 18, '#fff', 'center', false);
        blink('CLICK TO TRY AGAIN', H / 2 + 50);
      }
    } else if (state === 'over' && stateT > 0.6) {
      panel(460, 220);
      txt('GAME OVER', W / 2, H / 2 - 62, 46, '#ff5d5d');
      txt(`Score ${score}`, W / 2, H / 2 - 8, 26, '#ffd23f');
      txt(`Reached level ${levelIdx + 1}` + (score >= best && score > 0 ? '   ·   NEW BEST!' : `   ·   Best ${best}`), W / 2, H / 2 + 28, 16, '#fff', 'center', false);
      blink('CLICK TO CONTINUE', H / 2 + 74);
    }
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
      txt('PAUSED', W / 2, H / 2 - 10, 54, '#fff');
      txt('Click or press P to resume', W / 2, H / 2 + 38, 18, '#fff');
    }
  }

  function drawCrosshair() {
    if (!mouse.show) return;
    const { x, y } = mouse, hot = state === 'play' && reloading <= 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
      line(x - 22, y, x - 8, y); line(x + 8, y, x + 22, y); line(x, y - 22, x, y - 8); line(x, y + 8, x, y + 22);
      ctx.strokeStyle = hot ? '#ff3b3b' : '#fff'; ctx.lineWidth = 2;
    }
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawBackground();
    if (state !== 'menu') drawExit(runner.dir);
    for (const d of decals) { ctx.globalAlpha = Math.min(1, d.life) * 0.8; ctx.fillStyle = d.color; circle(d.x, d.y, d.r); circle(d.x + d.r * 0.8, d.y + d.r * 0.5, d.r * 0.4); }
    ctx.globalAlpha = 1;
    drawRunner(runner);
    for (const c of covers) drawCover(c);
    for (const d of dust) { ctx.fillStyle = 'rgba(232,200,150,0.5)'; circle(d.x, d.y, d.r); circle(d.x + d.r * 0.7, d.y + 12, d.r * 0.7); }
    for (const p of particles) { ctx.globalAlpha = Math.min(1, p.life * 3); ctx.fillStyle = p.color; circle(p.x, p.y, p.size); }
    ctx.globalAlpha = 1;
    for (const f of floats) { ctx.globalAlpha = Math.min(1, f.life * 2); txt(f.text, f.x, f.y, f.size, f.color); }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (flashT > 0) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, W, H); }
    if (state !== 'menu') drawHUD();
    drawOverlay();
    drawCrosshair();
  }

  // ---------- Main loop ----------
  runner = makeRunner(LEVELS[1], 1);
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
  window.zigzag = { get state() { return state; }, get runner() { return runner; }, get score() { return score; }, get level() { return levelIdx + 1; } };
})();
