// ゲーム全体の進行・画面表示・メインループ
const hud = hudCanvas.getContext('2d');

const Game = {
  state: 'title',   // title | play | pause | seed | dead | clear
  time: 0,          // 経過時間（演出用）
  playTime: 0,      // プレイ時間
  stT: 0,
  acorns: 0,
  seeds: 0,
  shake: 0,
  toasts: [],
  lastSeed: null,
  best: Number(localStorage.getItem('koron-best') || 0),
  fps: 60,

  newGame() {
    buildLevelState();
    this.acorns = 0; this.seeds = 0; this.playTime = 0;
    P.hp = P.maxHp;
    const s = Level.start;
    playerReset(s.x, s.y, s.z, s.yaw);
    camReset();
    this.state = 'play'; this.stT = 0;
    this.toast('ひかりの種を ' + Level.seedTotal + ' こ 集めよう！', 4);
  },
  toast(msg, dur = 2.6) { this.toasts.push({ msg, t: 0, dur }); if (this.toasts.length > 3) this.toasts.shift(); },
  getSeed(s) {
    this.seeds++;
    this.lastSeed = s;
    Sound.play('seed');
    Fx.burst(s.x, s.y + 0.7, s.z, [0.7, 1, 0.95], 30, 8);
    P.hp = P.maxHp;
    if (this.seeds >= Level.seedTotal) {
      this.state = 'clear'; this.stT = 0;
      P.state = 'win'; P.vx = P.vz = 0;
      setTimeout(() => Sound.play('clear'), 600);
      const t = this.playTime;
      if (!this.best || t < this.best) { this.best = t; localStorage.setItem('koron-best', String(t)); this.newRecord = true; }
      else this.newRecord = false;
    } else {
      this.state = 'seed'; this.stT = 0;
      P.state = 'win';
    }
  },
  revealSeed(id) {
    const s = Level.seeds.find((q) => q.id === id);
    if (!s || !s.hidden) return;
    s.hidden = false;
    Sound.play('seed');
    Fx.burst(s.x, s.y + 0.7, s.z, [0.7, 1, 0.95], 24, 6);
    this.toast('どんぐり50こ！ スタート地点に ひかりの種が あらわれた！', 4);
  },
  onFall() {
    if (P.state === 'dead') return;
    Sound.play('fall');
    P.hp -= 1;
    if (P.hp <= 0) { playerDie(); return; }
    playerReset(P.safe[0], P.safe[1] + 0.2, P.safe[2], P.yaw);
    P.inv = 2;
    camReset();
    this.toast('落っこちた！', 1.6);
  },
  onDeath() { this.state = 'dead'; this.stT = 0; },
  onPound(x, y, z) { poundShock(x, y, z); },
};

// 敵やアイテムを初期状態に戻す（ステージを作り直す）
function buildLevelState() {
  buildLevel();
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ---------------- 更新 ----------------
function update(dt) {
  Game.time += dt;
  Game.stT += dt;
  Game.shake = Math.max(0, Game.shake - dt);
  for (const t of Game.toasts) t.t += dt;
  Game.toasts = Game.toasts.filter((t) => t.t < t.dur);

  if (Game.state === 'title') {
    titleCamera(dt);
    updateLevel(dt);
    if (Input.anyP && Game.stT > 0.3) { Sound.play('select'); Game.newGame(); }
    return;
  }
  if (Game.state === 'pause') {
    if (Input.pauseP || Input.jumpP) { Game.state = 'play'; }
    return;
  }
  if (Input.pauseP && Game.state === 'play') { Game.state = 'pause'; return; }

  if (Game.state === 'play') Game.playTime += dt;

  if (Game.state === 'play' || Game.state === 'dead') {
    updateLevel(dt);
    updatePlayer(dt);
    updateEntities(dt);
    updateCamera(dt);
  } else if (Game.state === 'seed' || Game.state === 'clear') {
    updatePlayer(dt);
    // 種を取った演出：カメラが正面に回る
    const a = P.yaw;
    const d = 5.5;
    Cam.override = {
      eye: [P.x + Math.sin(a) * d, P.y + 2.2, P.z + Math.cos(a) * d],
      target: [P.x, P.y + 1, P.z],
    };
    updateCamera(dt);
    if (Game.state === 'seed' && Game.stT > 2.6) {
      Cam.override = null;
      P.state = 'ground';
      Game.state = 'play';
      Game.toast(`ひかりの種 ${Game.seeds} / ${Level.seedTotal}`, 2.5);
    }
    if (Game.state === 'clear' && Game.stT > 3 && Input.anyP) {
      Cam.override = null;
      Game.state = 'title'; Game.stT = 0;
    }
  }
  if (Game.state === 'dead' && Game.stT > 2.2) {
    if (Input.anyP || Game.stT > 6) {
      // その場の進み具合は残して、スタート地点から再開
      P.hp = P.maxHp;
      const s = Level.start;
      playerReset(s.x, s.y, s.z, s.yaw);
      P.inv = 1.5;
      camReset();
      Game.state = 'play';
    }
  }
  Fx.update(dt);
}

function titleCamera(dt) {
  const a = Game.time * 0.08;
  Cam.override = null;
  Cam.eye = [Math.sin(a) * 46, 22 + Math.sin(a * 0.7) * 4, Math.cos(a) * 46];
  Cam.target = [0, 4, -4];
}

// ---------------- 描画 ----------------
function render() {
  if (!R.ok) return;
  beginFrame(Cam.eye, Cam.target || [0, 0, 0], Cam.fov);
  drawLevel();
  if (Game.state !== 'title') drawPlayer();
  drawEntities();
  // 半透明もの（影・粒）
  setBlend(true);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-2, -2);
  if (Game.state !== 'title' && P.state !== 'dead') drawShadow(P.x, P.y, P.z, 0.55, 0.38);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  Fx.draw();
  setBlend(false);
}

// ---------------- 画面の文字・ボタン ----------------
let hudW = 0, hudH = 0, hudDpr = 1;
function resizeHud() {
  hudDpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  if (w !== hudW || h !== hudH || hudCanvas.width !== Math.floor(w * hudDpr)) {
    hudW = w; hudH = h;
    hudCanvas.width = Math.floor(w * hudDpr);
    hudCanvas.height = Math.floor(h * hudDpr);
    layoutTouch(w, h);
  }
}

function txt(s, x, y, size, color = '#fff', align = 'left', stroke = 'rgba(30,40,70,.85)') {
  hud.font = `bold ${size}px "Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`;
  hud.textAlign = align;
  hud.textBaseline = 'middle';
  hud.lineJoin = 'round';
  hud.lineWidth = Math.max(3, size * 0.2);
  hud.strokeStyle = stroke;
  hud.strokeText(s, x, y);
  hud.fillStyle = color;
  hud.fillText(s, x, y);
}

function drawHeartIcon(x, y, s, full) {
  hud.save();
  hud.translate(x, y);
  hud.scale(s / 20, s / 20);
  hud.beginPath();
  hud.moveTo(0, 6);
  hud.bezierCurveTo(-10, -2, -10, -12, 0, -6);
  hud.bezierCurveTo(10, -12, 10, -2, 0, 6);
  hud.closePath();
  hud.fillStyle = full ? '#ff4f6d' : 'rgba(255,255,255,.25)';
  hud.strokeStyle = 'rgba(30,40,70,.85)';
  hud.lineWidth = 2.5;
  hud.stroke();
  hud.fill();
  hud.restore();
}

function drawAcornIcon(x, y, s) {
  hud.save();
  hud.translate(x, y);
  hud.fillStyle = '#c98a3e'; hud.strokeStyle = 'rgba(30,40,70,.85)'; hud.lineWidth = 2;
  hud.beginPath(); hud.ellipse(0, s * 0.12, s * 0.32, s * 0.4, 0, 0, TAU); hud.fill(); hud.stroke();
  hud.fillStyle = '#7a5230';
  hud.beginPath(); hud.ellipse(0, -s * 0.18, s * 0.38, s * 0.2, 0, 0, TAU); hud.fill(); hud.stroke();
  hud.restore();
}

function drawSeedIcon(x, y, s, on) {
  hud.save();
  hud.translate(x, y);
  hud.beginPath();
  hud.moveTo(0, -s * 0.5); hud.lineTo(s * 0.32, 0); hud.lineTo(0, s * 0.5); hud.lineTo(-s * 0.32, 0); hud.closePath();
  hud.fillStyle = on ? '#9cfff0' : 'rgba(255,255,255,.22)';
  hud.strokeStyle = 'rgba(30,40,70,.85)'; hud.lineWidth = 2;
  hud.fill(); hud.stroke();
  hud.restore();
}

function drawHud() {
  resizeHud();
  hud.setTransform(hudDpr, 0, 0, hudDpr, 0, 0);
  hud.clearRect(0, 0, hudW, hudH);
  const W = hudW, H = hudH;
  const small = Math.min(W, H) < 500;
  const fs = small ? 16 : 20;

  if (!R.ok) {
    txt('この端末では 3D 表示（WebGL2）が使えません', W / 2, H / 2, 18, '#fff', 'center');
    return;
  }

  if (Game.state === 'title') {
    hud.fillStyle = 'rgba(20,40,80,.18)';
    hud.fillRect(0, 0, W, H);
    const ts = clamp(W / 14, 26, 64);
    const bob = Math.sin(Game.time * 2) * 4;
    txt('ころんの', W / 2, H * 0.26 + bob, ts * 0.6, '#fff6d8', 'center');
    txt('空島アドベンチャー', W / 2, H * 0.26 + ts * 0.85 + bob, ts, '#ffd166', 'center');
    if (Math.floor(Game.time * 2) % 2 === 0) txt(Input.touchMode || 'ontouchstart' in window ? 'タップでスタート' : 'Enter / スペースでスタート', W / 2, H * 0.62, fs + 2, '#fff', 'center');
    const lines = 'ontouchstart' in window && Input.touchMode !== false
      ? ['左側をなぞって移動 ／ 右側をドラッグでカメラ', 'ジャンプ・パンチ・しゃがむ はボタンで']
      : ['移動：WASD / 矢印　ジャンプ：スペース　パンチ：J　しゃがむ：Shift', 'カメラ：Q・E またはマウスでドラッグ　遠近：R　ポーズ：Esc'];
    lines.forEach((l, i) => txt(l, W / 2, H * 0.74 + i * (fs + 8), fs * 0.75, '#e8f4ff', 'center'));
    if (Game.best) txt('ベストクリア ' + fmtTime(Game.best), W / 2, H * 0.9, fs * 0.8, '#ffe9a8', 'center');
    return;
  }

  // 体力
  for (let i = 0; i < P.maxHp; i++) drawHeartIcon(26 + i * 34, 30, small ? 28 : 32, i < P.hp);
  // どんぐり
  drawAcornIcon(26, 70, 26);
  txt('× ' + Game.acorns, 44, 71, fs + 2);
  // 種
  for (let i = 0; i < Level.seedTotal; i++) drawSeedIcon(W / 2 - (Level.seedTotal - 1) * 14 + i * 28, 28, 26, i < Game.seeds);
  // 時間
  txt(fmtTime(Game.playTime), W - (Input.touchMode ? 70 : 20), 30, fs, '#fff', 'right');

  // メッセージ
  Game.toasts.forEach((t, i) => {
    const a = Math.min(1, t.t * 4, (t.dur - t.t) * 2);
    hud.globalAlpha = a;
    txt(t.msg, W / 2, H * 0.2 + i * (fs + 14), fs + 2, '#fff', 'center');
    hud.globalAlpha = 1;
  });

  if (Game.state === 'seed' && Game.lastSeed) {
    const k = Math.min(1, Game.stT * 3);
    txt('ひかりの種 ゲット！', W / 2, H * 0.32 - (1 - k) * 30, clamp(W / 16, 26, 52) * k, '#9cfff0', 'center');
    txt(Game.lastSeed.name, W / 2, H * 0.32 + 48, fs, '#fff', 'center');
  }
  if (Game.state === 'clear') {
    hud.fillStyle = `rgba(255,250,220,${Math.min(0.35, Game.stT * 0.2)})`;
    hud.fillRect(0, 0, W, H);
    txt('ぜんぶ 集めた！ クリア！', W / 2, H * 0.3, clamp(W / 16, 26, 54), '#ffd166', 'center');
    txt('タイム ' + fmtTime(Game.playTime) + (Game.newRecord ? '  ベスト更新！' : ''), W / 2, H * 0.3 + 56, fs + 4, '#fff', 'center');
    txt('どんぐり ' + Game.acorns + ' こ', W / 2, H * 0.3 + 92, fs, '#fff', 'center');
    if (Game.stT > 3) txt('タップ / Enter でタイトルへ', W / 2, H * 0.75, fs, '#fff', 'center');
  }
  if (Game.state === 'dead') {
    hud.fillStyle = `rgba(30,10,30,${Math.min(0.45, Game.stT * 0.3)})`;
    hud.fillRect(0, 0, W, H);
    txt('ころんは たおれてしまった…', W / 2, H * 0.38, clamp(W / 20, 22, 40), '#fff', 'center');
    if (Game.stT > 2.2) txt('タップ / Enter で スタート地点から再開', W / 2, H * 0.5, fs, '#ffe9a8', 'center');
  }
  if (Game.state === 'pause') {
    hud.fillStyle = 'rgba(20,30,60,.5)';
    hud.fillRect(0, 0, W, H);
    txt('ポーズ', W / 2, H * 0.3, 44, '#fff', 'center');
    const got = Level.seeds.filter((s) => s.got).map((s) => '◆ ' + s.name);
    const left = Level.seeds.filter((s) => !s.got).length;
    got.forEach((g, i) => txt(g, W / 2, H * 0.42 + i * (fs + 6), fs * 0.85, '#9cfff0', 'center'));
    txt('のこり ' + left + ' こ', W / 2, H * 0.42 + got.length * (fs + 6) + 10, fs * 0.85, '#fff', 'center');
    txt('ジャンプ / Esc で つづける', W / 2, H * 0.85, fs, '#ffe9a8', 'center');
  }

  // タッチ操作ボタン
  if (Input.touchMode && (Game.state === 'play' || Game.state === 'pause')) drawTouchUI();
}

function drawTouchUI() {
  hud.save();
  for (const k in Input.btns) {
    const b = Input.btns[k];
    hud.beginPath();
    hud.arc(b.x, b.y, b.r, 0, TAU);
    hud.fillStyle = b.down ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)';
    hud.fill();
    hud.lineWidth = 2.5;
    hud.strokeStyle = 'rgba(255,255,255,.7)';
    hud.stroke();
    txt(b.label, b.x, b.y, k === 'pause' || k === 'camera' ? 16 : Math.max(11, b.r * 0.34), '#fff', 'center');
  }
  if (Input.stick) {
    const s = Input.stick;
    hud.beginPath(); hud.arc(s.ox, s.oy, 60, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.15)'; hud.fill();
    hud.strokeStyle = 'rgba(255,255,255,.5)'; hud.lineWidth = 2; hud.stroke();
    let dx = s.x - s.ox, dy = s.y - s.oy; const d = Math.hypot(dx, dy);
    if (d > 60) { dx *= 60 / d; dy *= 60 / d; }
    hud.beginPath(); hud.arc(s.ox + dx, s.oy + dy, 26, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.6)'; hud.fill();
  } else {
    txt('ここをなぞって移動', 90, hudH - 40, 13, 'rgba(255,255,255,.75)', 'center');
  }
  hud.restore();
}

// ---------------- メインループ ----------------
let lastT = performance.now();
function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.1) dt = 0.1;
  Game.fps = lerp(Game.fps, 1 / Math.max(dt, 1e-3), 0.05);
  pollInput();
  // 物理は細かく刻む（1/120 秒ずつ）
  const step = 1 / 120;
  let acc = dt, first = true;
  while (acc > 1e-6) {
    const h = Math.min(step, acc);
    update(h);
    if (first) { clearPressed(); first = false; }
    acc -= h;
  }
  render();
  drawHud();
  requestAnimationFrame(frame);
}

function boot() {
  try {
    initGL();
    if (R.ok) { buildModels(); buildLevel(); }
  } catch (e) {
    R.ok = false;
    console.error(e);
  }
  Cam.eye = [40, 20, 40]; Cam.target = [0, 0, 0];
  window.KORON = { Game, P, Cam, Level, World, Input, R };
  requestAnimationFrame(frame);
}
boot();
