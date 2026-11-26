// ゲーム全体の進行・画面表示・メインループ
const hud = hudCanvas.getContext('2d');

// ---------------- セーブ（localStorage）----------------
// koron-save = { v:1, stages: { [ステージid]: { seeds:[取った種のid], best:ベストタイム(秒), done:全部集めたか } } }
const Save = {
  KEY: 'koron-save',
  data: { v: 1, stages: {} },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || !d.stages || typeof d.stages !== 'object') d = { v: 1, stages: {} };
    // 前の版のベストタイム（ステージが1つだったころ）を引きつぐ
    const old = Number(localStorage.getItem('koron-best') || 0);
    if (old > 0) {
      const s0 = d.stages[0] || (d.stages[0] = { seeds: [], best: 0, done: false });
      if (!s0.best) s0.best = old;
    }
    this.data = d;
  },
  write() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); localStorage.removeItem('koron-best'); } catch (e) { /* 保存できない環境でも遊べるように */ }
  },
  st(id) {
    const ss = this.data.stages;
    if (!ss[id] || !Array.isArray(ss[id].seeds)) ss[id] = { seeds: [], best: 0, done: false };
    return ss[id];
  },
  has(id, seedId) { return this.st(id).seeds.includes(seedId); },
  count(id) { return this.st(id).seeds.length; },
  addSeed(id, seedId) {
    const s = this.st(id);
    if (s.seeds.includes(seedId)) return false;
    s.seeds.push(seedId); this.write();
    return true;
  },
  // 開く条件（unlock: {stage, seeds}）をみたしているか
  unlocked(id) {
    const st = STAGES[id];
    if (!st || !st.unlock) return true;
    return this.count(st.unlock.stage) >= st.unlock.seeds;
  },
  clear() {
    this.data = { v: 1, stages: {} };
    try { localStorage.removeItem(this.KEY); localStorage.removeItem('koron-best'); } catch (e) { /* なにもしない */ }
  },
};
Save.load();

const Game = {
  state: 'title',   // title | select | erase | play | pause | seed | dead | clear
  time: 0,          // 経過時間（演出用）
  playTime: 0,      // プレイ時間
  stT: 0,
  acorns: 0,
  seeds: 0,
  shake: 0,
  toasts: [],
  lastSeed: null,
  stageId: 0,       // 遊んでいる（選んでいる）ステージ
  lastOld: false,   // さっき取った種が「とったことがある」種か
  fullRun: false,   // 1回のプレイで全部集めたか（クリア画面用）
  titleMsg: '', titleMsgT: 0,
  selShake: 0,
  fps: 60,
  cpuMs: 0,         // 1フレームの計算時間（描画をのぞく）
  menuSel: 0,
  help: false,      // 操作説明を表示中
  hurtFlash: 0,
  acornPop: 0, shownAcorns: 0,
  heartShake: 0, shownHp: 3,
  newRecord: false,
  portraitHintT: 0,

  newGame(id) {
    if (id !== undefined) this.stageId = id;
    buildLevelState(this.stageId);
    if (typeof Music !== 'undefined' && Music.setStyle) Music.setStyle(Level.stage.music);
    this.acorns = 0; this.seeds = 0; this.playTime = 0; this.shownAcorns = 0;
    P.hp = P.maxHp; this.shownHp = P.maxHp;
    const s = Level.start;
    playerReset(s.x, s.y, s.z, s.yaw);
    camReset();
    this.state = 'play'; this.stT = 0; this.help = false;
    this.toasts.length = 0;
    this.toast(Level.stage.name + '　ひかりの種を ' + Level.seedTotal + ' こ 集めよう！', 4);
    const had = Save.count(this.stageId);
    if (had > 0 && had < Level.seedTotal) this.toast('うすい種は とったことがある種（のこり ' + (Level.seedTotal - had) + ' こ）', 4);
    this.portraitHintT = 6;
    Sound.setDuck(1);
  },
  toast(msg, dur = 2.6) {
    if (this.toasts.length >= 3) this.toasts.shift();
    this.toasts.push({ msg, t: 0, dur });
  },
  getSeed(s) {
    this.seeds++;
    this.lastSeed = s;
    // その場で保存する。前に取ったことがある種は「とったことがある」扱い
    this.lastOld = !!s.old;
    const sid = this.stageId;
    const wasDone = Save.st(sid).done;
    Save.addSeed(sid, s.id);
    const fullRun = this.seeds >= Level.seedTotal;                  // 1回のプレイで全部集めた
    const firstAll = !wasDone && Save.count(sid) >= Level.seedTotal; // これまでの分とあわせて はじめて全部そろった
    Sound.play('seed');
    Sound.setDuck(0.15);
    Fx.burst(s.x, s.y + 0.7, s.z, [0.7, 1, 0.95], 30, 8);
    P.hp = P.maxHp;
    // 空中のわざの途中で取っても、演出のあとに続きが残らないようにする
    P.vy = 0; P.speed = 0; P.vx = P.vz = 0;
    P.flip = 0; P.sideFlip = false; P.dive = false; P.longJump = false;
    P.skidT = 0; P.slideT = 0; P.kickT = 0; P.wallSlide = false; P.wall = null; P.punchN = 0;
    if (fullRun || firstAll) {
      this.state = 'clear'; this.stT = 0; this.menuSel = 0;
      P.state = 'win'; P.vx = P.vz = 0;
      setTimeout(() => Sound.play('clear'), 600);
      const t = this.playTime, sv = Save.st(sid);
      sv.done = true;
      this.fullRun = fullRun;
      // ベストタイムは「1回のプレイで全部集めた」ときのタイム
      if (fullRun && (!sv.best || t < sv.best)) { sv.best = t; this.newRecord = true; }
      else this.newRecord = false;
      Save.write();
    } else {
      this.state = 'seed'; this.stT = 0;
      P.state = 'win';
    }
  },
  revealSeed(id) { revealSeedMsg(id, 'ひかりの種が あらわれた！'); },
  onFall() {
    if (P.state === 'dead') return;
    Sound.play('fall');
    P.hp -= 1;
    this.hurtFlash = 1;
    if (P.hp <= 0) { playerDie(); return; }
    playerReset(P.safe[0], P.safe[1] + 0.2, P.safe[2], P.yaw);
    P.inv = 2;
    camReset();
    this.toast('落っこちた！', 1.6);
  },
  onDeath() { this.state = 'dead'; this.stT = 0; this.menuSel = 0; Sound.play('over'); Sound.setDuck(0.3); },
  onPound(x, y, z) { poundShock(x, y, z); },
};

// 敵やアイテムを初期状態に戻す（ステージを作り直す）。取ったことがある種には印をつける
function buildLevelState(id) {
  buildLevel(id === undefined ? Game.stageId : id);
  for (const s of Level.seeds) s.old = Save.has(Level.stageId, s.id);
  Fx.list.length = 0; // 前のプレイの粒が止まったまま残らないように
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return m + ':' + (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
}

// ---------------- メニュー ----------------
const onOff = (b) => (b ? 'ON' : 'OFF');
const MENUS = {
  title: [
    { id: 'start', label: () => 'はじめる', big: true },
    { id: 'help', label: () => 'あそびかた' },
    { id: 'erase', label: () => 'きろくを けす' },
  ],
  erase: [
    { id: 'no', label: () => 'けさない', big: true },
    { id: 'yes', label: () => 'けす（もとに もどせません）' },
  ],
  pause: [
    { id: 'resume', label: () => 'つづける', big: true },
    { id: 'restart', label: () => 'はじめから' },
    { id: 'sfx', label: () => 'こうかおん：' + onOff(Sound.sfxOn) },
    { id: 'bgm', label: () => 'BGM：' + onOff(Sound.bgmOn) },
    { id: 'help', label: () => 'そうさ説明' },
    { id: 'select', label: () => 'ステージを えらぶ' },
    { id: 'title', label: () => 'タイトルへ' },
  ],
  dead: [
    { id: 'retry', label: () => 'スタート地点から つづける', big: true },
    { id: 'select', label: () => 'ステージを えらぶ' },
    { id: 'title', label: () => 'タイトルへ' },
  ],
  clear: [
    { id: 'again', label: () => 'もういちど あそぶ', big: true },
    { id: 'select', label: () => 'ステージを えらぶ' },
    { id: 'title', label: () => 'タイトルへ' },
  ],
};
// 画面に描いたボタンの位置（タップ判定用。毎フレーム中身だけ書きかえる）
const menuRects = [];
for (let i = 0; i < 8; i++) menuRects.push({ x: 0, y: 0, w: 0, h: 0, on: false });

// メニュー操作。決まったら項目の id を返す
function menuInput(items) {
  const n = items.length;
  if (Input.upP) { Game.menuSel = (Game.menuSel + n - 1) % n; Sound.play('cursor'); }
  if (Input.downP) { Game.menuSel = (Game.menuSel + 1) % n; Sound.play('cursor'); }
  Game.menuSel = clamp(Game.menuSel, 0, n - 1);
  if (Input.tapP) {
    for (let i = 0; i < n; i++) {
      const r = menuRects[i];
      if (r.on && Input.tapX >= r.x && Input.tapX <= r.x + r.w && Input.tapY >= r.y && Input.tapY <= r.y + r.h) {
        Game.menuSel = i;
        Sound.play('select');
        return items[i].id;
      }
    }
  }
  if (Input.okP) { Sound.play('select'); return items[Game.menuSel].id; }
  return null;
}

function goTitle() {
  Cam.override = null;
  Game.state = 'title'; Game.stT = 0; Game.menuSel = 0; Game.help = false;
  showStage(0);
  Sound.setDuck(1);
}
// ステージ選びの画面へ。sel: はじめに選んでおくステージ
function goSelect(sel) {
  Cam.override = null;
  Game.state = 'select'; Game.stT = 0; Game.help = false;
  Game.menuSel = clamp(sel === undefined ? Game.stageId : sel, 0, STAGES.length - 1);
  showStage(Game.menuSel);
  Sound.setDuck(1);
}
// 背景にステージを出す（空の色・BGM の調も切りかえる）。敵やアイテムも初めの状態に戻す
function showStage(id) {
  buildLevelState(id);
  if (typeof Music !== 'undefined' && Music.setStyle) Music.setStyle(Level.stage.music);
}

function respawnAtStart() {
  P.hp = P.maxHp;
  const s = Level.start;
  playerReset(s.x, s.y, s.z, s.yaw);
  P.inv = 1.5;
  camReset();
  Game.state = 'play';
  Sound.setDuck(1);
}

// ---------------- 更新 ----------------
const seedOv = { eye: [0, 0, 0], target: [0, 0, 0] };

function update(dt) {
  Game.time += dt;
  Game.stT += dt;
  Game.shake = Math.max(0, Game.shake - dt);
  Game.hurtFlash = Math.max(0, Game.hurtFlash - dt * 1.8);
  Game.acornPop = Math.max(0, Game.acornPop - dt * 4);
  Game.heartShake = Math.max(0, Game.heartShake - dt * 2.5);
  Game.portraitHintT = Math.max(0, Game.portraitHintT - dt);
  // メッセージ（配列を作り直さずに古いものを消す）
  const ts = Game.toasts;
  for (let i = ts.length - 1; i >= 0; i--) { ts[i].t += dt; if (ts[i].t >= ts[i].dur) ts.splice(i, 1); }
  if (Game.acorns !== Game.shownAcorns) { Game.shownAcorns = Game.acorns; Game.acornPop = 1; }
  if (P.hp < Game.shownHp) Game.heartShake = 1;
  Game.shownHp = P.hp;

  // 操作説明を表示中は、閉じる操作だけ受け付ける
  if (Game.help) {
    if (Input.okP || Input.backP || Input.tapP || Input.pauseP || Input.jumpP) { Game.help = false; Sound.play('cursor'); }
    if (Game.state === 'title') { titleCamera(dt); updateLevel(dt); }
    return;
  }
  Game.titleMsgT = Math.max(0, Game.titleMsgT - dt);
  Game.selShake = Math.max(0, Game.selShake - dt);

  if (Game.state === 'title') {
    titleCamera(dt);
    updateLevel(dt);
    if (Game.stT > 0.3) {
      const id = menuInput(MENUS.title);
      if (id === 'start') goSelect();
      else if (id === 'help') Game.help = true;
      else if (id === 'erase') { Game.state = 'erase'; Game.stT = 0; Game.menuSel = 0; }
    }
    return;
  }
  if (Game.state === 'erase') {
    // セーブを消す前の確認（「けさない」が先に選ばれている）
    titleCamera(dt);
    updateLevel(dt);
    if (Input.backP) { Game.state = 'title'; Game.menuSel = 2; Sound.play('cursor'); return; }
    if (Game.stT > 0.2) {
      const id = menuInput(MENUS.erase);
      if (id === 'yes') {
        Save.clear();
        Game.stageId = 0;
        showStage(0);
        Game.titleMsg = 'きろくを けしました'; Game.titleMsgT = 2.5;
        Game.state = 'title'; Game.stT = 0; Game.menuSel = 0;
      } else if (id === 'no') { Game.state = 'title'; Game.stT = 0; Game.menuSel = 2; }
    }
    return;
  }
  if (Game.state === 'select') {
    titleCamera(dt);
    updateLevel(dt);
    if (Game.stT > 0.2) updateSelect();
    return;
  }
  if (Game.state === 'pause') {
    if (Input.pauseP || Input.backP) { Game.state = 'play'; Sound.setDuck(1); Sound.play('pause'); return; }
    const id = menuInput(MENUS.pause);
    if (id === 'resume') { Game.state = 'play'; Sound.setDuck(1); }
    else if (id === 'restart') Game.newGame();
    else if (id === 'sfx') Sound.setSfx(!Sound.sfxOn);
    else if (id === 'bgm') Sound.setBgm(!Sound.bgmOn);
    else if (id === 'help') Game.help = true;
    else if (id === 'select') goSelect(Game.stageId);
    else if (id === 'title') goTitle();
    return;
  }
  if (Input.pauseP && Game.state === 'play') {
    Game.state = 'pause'; Game.menuSel = 0;
    Sound.play('pause'); Sound.setDuck(0.35);
    return;
  }

  if (Game.state === 'play') Game.playTime += dt;

  if (Game.state === 'play' || Game.state === 'dead') {
    updateLevel(dt);
    updatePlayer(dt);
    updateEntities(dt);
    updateCamera(dt);
  } else if (Game.state === 'seed' || Game.state === 'clear') {
    updatePlayer(dt);
    // 種を取った演出：カメラが正面にゆっくり回り込む
    const a = P.yaw + Math.sin(Game.stT * 0.6) * 0.5;
    const d = 6.5 - Math.min(1, Game.stT) * 0.8;
    seedOv.eye[0] = P.x + Math.sin(a) * d; seedOv.eye[1] = P.y + 2.6; seedOv.eye[2] = P.z + Math.cos(a) * d;
    seedOv.target[0] = P.x; seedOv.target[1] = P.y + 2.1; seedOv.target[2] = P.z;
    Cam.override = seedOv;
    updateCamera(dt);
    if (Game.state === 'seed' && Game.stT > 2.8) {
      Cam.override = null;
      // 空中で取ったときは落ちるところから再開（'ground' のままだと重力がかからず浮き続ける）
      if (P.grounded) P.state = 'ground';
      else { P.state = 'air'; P.airT = 0; P.coyote = 0; P.jumpHeld = false; P.fallFrom = P.y; }
      P.stateT = 0;
      Game.state = 'play';
      Sound.setDuck(1);
      const have = Save.count(Game.stageId);
      Game.toast(Game.lastOld ? `とったことがある種（これまでに ${have} / ${Level.seedTotal}）` : `ひかりの種 ${have} / ${Level.seedTotal}`, 2.5);
    }
    if (Game.state === 'clear' && Game.stT > 3) {
      const id = menuInput(MENUS.clear);
      if (id === 'again') Game.newGame();
      else if (id === 'select') goSelect(Game.stageId);
      else if (id === 'title') goTitle();
    }
  }
  if (Game.state === 'dead' && Game.stT > 1.6) {
    const id = menuInput(MENUS.dead);
    if (id === 'retry') respawnAtStart(); // その場の進み具合は残して、スタート地点から再開
    else if (id === 'select') goSelect(Game.stageId);
    else if (id === 'title') goTitle();
  }
  Fx.update(dt);
}

function titleCamera(dt) {
  const a = Game.time * 0.08;
  const tc = (Level.stage && Level.stage.titleCam) || { r: 46, y: 22, tx: 0, ty: 4, tz: -4 };
  Cam.override = null;
  Cam.eye[0] = tc.tx + Math.sin(a) * tc.r; Cam.eye[1] = tc.y + Math.sin(a * 0.7) * 4; Cam.eye[2] = tc.tz + Math.cos(a) * tc.r;
  Cam.target[0] = tc.tx; Cam.target[1] = tc.ty; Cam.target[2] = tc.tz;
  void dt;
}

// ---------------- ステージ選び ----------------
// 項目：ステージ 0..n-1、そのあと「もどる」。←→↑↓で えらぶ
function updateSelect() {
  const n = STAGES.length + 1;
  let sel = Game.menuSel;
  const prev = sel;
  if (Input.leftP || Input.upP) sel = (sel + n - 1) % n;
  if (Input.rightP || Input.downP) sel = (sel + 1) % n;
  let pick = null;
  if (Input.tapP) {
    for (let i = 0; i < n; i++) {
      const r = menuRects[i];
      if (r.on && Input.tapX >= r.x && Input.tapX <= r.x + r.w && Input.tapY >= r.y && Input.tapY <= r.y + r.h) { sel = i; pick = i; }
    }
  }
  if (Input.okP) pick = sel;
  if (sel !== prev) {
    if (pick === null) Sound.play('cursor');
    Game.menuSel = sel;
    if (sel < STAGES.length) showStage(sel);
  }
  if (Input.backP) { Sound.play('cursor'); goTitle(); return; }
  if (pick === null) return;
  if (pick >= STAGES.length) { Sound.play('select'); goTitle(); return; }
  if (!Save.unlocked(pick)) { Game.selShake = 0.4; Sound.play('hurt'); return; }
  Sound.play('select');
  Game.newGame(pick);
}

// ---------------- 描画 ----------------
function render() {
  if (!R.ok) return;
  beginFrame(Cam.eye, Cam.target, Cam.fov);
  drawLevel();
  // カメラが主人公にくっつくほど近いとき（壁ぎわ）は、体の内側が映らないように描かない
  if (Game.state !== 'title' && (Cam.shown > 0.9 || Cam.override)) drawPlayer();
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
window.addEventListener('orientationchange', () => { hudW = 0; });

const FONT_FAMILY = '"Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","BIZ UDPGothic","Noto Sans JP",sans-serif';
const fontCache = new Map();
function setFont(size) {
  const k = Math.round(size * 2);
  let f = fontCache.get(k);
  if (!f) { f = 'bold ' + k / 2 + 'px ' + FONT_FAMILY; fontCache.set(k, f); }
  hud.font = f;
}

function txt(s, x, y, size, color = '#fff', align = 'left', stroke = 'rgba(40,50,90,.9)') {
  setFont(size);
  hud.textAlign = align;
  hud.textBaseline = 'middle';
  hud.lineJoin = 'round';
  if (stroke) {
    hud.lineWidth = Math.max(3, size * 0.24);
    hud.strokeStyle = stroke;
    hud.strokeText(s, x, y);
  }
  hud.fillStyle = color;
  hud.fillText(s, x, y);
}
// 幅に収まるように文字を小さくする
function txtFit(s, x, y, size, maxW, color, align, stroke) {
  setFont(size);
  const w = hud.measureText(s).width;
  if (w > maxW) size = Math.max(9, size * maxW / w);
  txt(s, x, y, size, color, align, stroke);
}

function rrect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  hud.beginPath();
  hud.moveTo(x + r, y);
  hud.arcTo(x + w, y, x + w, y + h, r);
  hud.arcTo(x + w, y + h, x, y + h, r);
  hud.arcTo(x, y + h, x, y, r);
  hud.arcTo(x, y, x + w, y, r);
  hud.closePath();
}
function panel(x, y, w, h, r, fill = 'rgba(30,50,100,.42)', stroke = 'rgba(255,255,255,.55)') {
  rrect(x, y, w, h, r);
  hud.fillStyle = fill; hud.fill();
  if (stroke) { hud.lineWidth = 2; hud.strokeStyle = stroke; hud.stroke(); }
}

function drawHeartIcon(x, y, s, full) {
  hud.save();
  hud.translate(x, y);
  hud.scale(s / 20, s / 20);
  hud.beginPath();
  hud.moveTo(0, 7);
  hud.bezierCurveTo(-11, -1, -10, -12, 0, -5.5);
  hud.bezierCurveTo(10, -12, 11, -1, 0, 7);
  hud.closePath();
  hud.fillStyle = full ? '#ff5577' : 'rgba(255,255,255,.28)';
  hud.strokeStyle = 'rgba(40,50,90,.9)';
  hud.lineWidth = 2.6;
  hud.stroke();
  hud.fill();
  if (full) { // つや
    hud.fillStyle = 'rgba(255,255,255,.7)';
    hud.beginPath(); hud.ellipse(-4.5, -4.5, 2.4, 1.6, -0.6, 0, TAU); hud.fill();
  }
  hud.restore();
}

function drawAcornIcon(x, y, s) {
  hud.save();
  hud.translate(x, y);
  hud.fillStyle = '#d69548'; hud.strokeStyle = 'rgba(40,50,90,.9)'; hud.lineWidth = 2;
  hud.beginPath(); hud.ellipse(0, s * 0.12, s * 0.32, s * 0.4, 0, 0, TAU); hud.fill(); hud.stroke();
  hud.fillStyle = 'rgba(255,255,255,.45)';
  hud.beginPath(); hud.ellipse(-s * 0.12, s * 0.12, s * 0.07, s * 0.14, 0, 0, TAU); hud.fill();
  hud.fillStyle = '#7a5230';
  hud.beginPath(); hud.ellipse(0, -s * 0.18, s * 0.38, s * 0.2, 0, 0, TAU); hud.fill(); hud.stroke();
  hud.beginPath(); hud.moveTo(0, -s * 0.36); hud.lineTo(s * 0.06, -s * 0.5); hud.stroke();
  hud.restore();
}

function drawSeedIcon(x, y, s, on, glow) {
  hud.save();
  hud.translate(x, y);
  if (on && glow) {
    hud.fillStyle = 'rgba(160,255,240,.35)';
    hud.beginPath(); hud.arc(0, 0, s * 0.7, 0, TAU); hud.fill();
  }
  hud.beginPath();
  hud.moveTo(0, -s * 0.5); hud.lineTo(s * 0.32, 0); hud.lineTo(0, s * 0.5); hud.lineTo(-s * 0.32, 0); hud.closePath();
  hud.fillStyle = on ? '#9cfff0' : 'rgba(255,255,255,.22)';
  hud.strokeStyle = 'rgba(40,50,90,.9)'; hud.lineWidth = 2;
  hud.fill(); hud.stroke();
  if (on) {
    hud.fillStyle = 'rgba(255,255,255,.85)';
    hud.beginPath(); hud.moveTo(0, -s * 0.36); hud.lineTo(s * 0.1, -s * 0.05); hud.lineTo(-s * 0.06, 0); hud.closePath(); hud.fill();
  }
  hud.restore();
}

// メニューのボタンを縦に並べて描く
function drawMenu(items, cx, top, W, H) {
  const small = Math.min(W, H) < 500;
  const bw = clamp(W * 0.6, 220, 340);
  let y = top;
  for (let i = 0; i < menuRects.length; i++) menuRects[i].on = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const bh = it.big ? (small ? 46 : 54) : (small ? 36 : 42);
    const sel = i === Game.menuSel;
    const x = cx - bw / 2;
    const pop = sel ? 1 + Math.sin(Game.time * 6) * 0.015 : 1;
    hud.save();
    hud.translate(cx, y + bh / 2); hud.scale(pop, pop); hud.translate(-cx, -(y + bh / 2));
    panel(x, y, bw, bh, bh / 2, sel ? 'rgba(255,209,102,.95)' : 'rgba(255,255,255,.88)', sel ? '#fff' : 'rgba(40,50,90,.35)');
    hud.restore();
    txtFit(it.label(), cx, y + bh / 2 + 1, it.big ? (small ? 19 : 22) : (small ? 15 : 17), bw - 24, sel ? '#5a3300' : '#2c3e70', 'center', null);
    if (sel && !Input.touchMode) txt('▶', x - 16, y + bh / 2 + 1, small ? 14 : 17, '#ffd166', 'center');
    const r = menuRects[i];
    r.x = x; r.y = y; r.w = bw; r.h = bh; r.on = true;
    y += bh + (small ? 8 : 10);
  }
  return y;
}

// 操作説明
function drawHelp(W, H) {
  hud.fillStyle = 'rgba(20,30,60,.6)';
  hud.fillRect(0, 0, W, H);
  const S = Input.safe;
  const pw = Math.min(W - S.l - S.r - 20, 620), ph = Math.min(H - S.t - S.b - 16, 520);
  const px = (W - pw) / 2, py = (H - ph) / 2;
  panel(px, py, pw, ph, 18, 'rgba(255,252,240,.97)', '#ffd166');
  const touch = Input.touchMode || (Input.hasTouch && !Input.padOn && !Input.keys.size);
  const ctl = touch
    ? [['いどう', '画面の左をなぞる'], ['カメラ', '画面の右をなぞる（2回タップで後ろへ）'], ['ジャンプ／パンチ／しゃがむ', '右下のボタン'], ['しゃがむ＋ジャンプ', 'しゃがむを押したまま ジャンプへ指をすべらせる']]
    : [['いどう', 'WASD / 矢印キー（パッド：左スティック）'], ['ジャンプ／パンチ', 'スペース ／ J（パッド：A ／ B・X）'], ['しゃがむ', 'Shift（パッド：L・ZL・ZR）'], ['カメラ', 'ドラッグ・Q/E・右スティック（F：後ろへ　R：遠近）']];
  const moves = [
    ['3段ジャンプ', '走って、着地のたびにジャンプ（3回目はくるっと高く）'],
    ['幅とび', '走りながら しゃがむ＋ジャンプ'],
    ['バク宙', '止まって しゃがむ＋ジャンプ'],
    ['くるりんジャンプ', '走っていて逆を入れ、ブレーキ中にジャンプ'],
    ['壁キック', '壁にぶつかった瞬間にジャンプ'],
    ['ヒップドロップ', '空中で しゃがむ（着地してすぐジャンプで大ジャンプ）'],
    ['パンチ3れんぞく／ダイブ', 'パンチを続けて押す／走りジャンプ中にパンチ'],
    ['坂すべり', '坂で しゃがむ'],
  ];
  const lines = ctl.length + moves.length + 2;
  const lh = clamp((ph - 70) / lines, 15, 28);
  const fs = clamp(lh * 0.62, 10, 16);
  txt('あそびかた', W / 2, py + 26, clamp(lh, 18, 24), '#ff9f1c', 'center', '#fff');
  let y = py + 54;
  const colA = px + 16, colB = px + Math.min(pw * 0.38, 210);
  txt('そうさ', colA, y, fs, '#2c7be5', 'left', null); y += lh;
  for (const [a, b] of ctl) { txtFit(a, colA, y, fs, colB - colA - 8, '#2c3e70', 'left', null); txtFit(b, colB, y, fs, px + pw - colB - 12, '#444', 'left', null); y += lh; }
  txt('わざ', colA, y, fs, '#2c7be5', 'left', null); y += lh;
  for (const [a, b] of moves) { txtFit(a, colA, y, fs, colB - colA - 8, '#2c3e70', 'left', null); txtFit(b, colB, y, fs, px + pw - colB - 12, '#444', 'left', null); y += lh; }
  if (Math.floor(Game.time * 2) % 2 === 0) txt(touch ? 'タップでとじる' : 'Enter / Esc でとじる', W / 2, py + ph - 14, fs, '#999', 'center', null);
}

function drawHud() {
  resizeHud();
  hud.setTransform(hudDpr, 0, 0, hudDpr, 0, 0);
  hud.clearRect(0, 0, hudW, hudH);
  const W = hudW, H = hudH;
  const S = Input.safe;
  const small = Math.min(W, H) < 500;
  const fs = small ? 16 : 20;

  if (!R.ok) {
    txt('この端末では 3D 表示（WebGL2）が使えません', W / 2, H / 2, 18, '#fff', 'center');
    return;
  }

  if (Game.state === 'title' || Game.state === 'erase') { drawTitle(W, H, fs, small); if (Game.help) drawHelp(W, H); return; }
  if (Game.state === 'select') { drawSelect(W, H, fs, small); return; }

  // ---- 体力 ----
  const L = S.l + 12, T0 = S.t + 10;
  const hs = small ? 26 : 30;
  const hx = Math.sin(Game.time * 60) * Game.heartShake * 4;
  panel(L, T0, P.maxHp * (hs + 6) + 14, hs + 14, (hs + 14) / 2);
  for (let i = 0; i < P.maxHp; i++) {
    const danger = P.hp === 1 && i === 0 ? 1 + Math.sin(Game.time * 9) * 0.12 : 1;
    drawHeartIcon(L + 7 + hs / 2 + 3 + i * (hs + 6) + hx, T0 + (hs + 14) / 2 + 1, hs * danger, i < P.hp);
  }
  // ---- どんぐり ----
  const ay = T0 + hs + 22;
  const pop = 1 + Game.acornPop * 0.35;
  setFont(fs + 2);
  const aw = hud.measureText('× ' + Game.acorns).width;
  panel(L, ay, aw + 50, hs + 8, (hs + 8) / 2);
  drawAcornIcon(L + 20, ay + (hs + 8) / 2, 24 * pop);
  txt('× ' + Game.acorns, L + 38, ay + (hs + 8) / 2 + 1, (fs + 2) * pop, Game.acornPop > 0 ? '#ffe08a' : '#fff');
  // ---- 種 ----
  const n = Level.seedTotal;
  const sw = n * 26 + 18;
  const portrait = H > W;
  const seedY = portrait ? T0 + hs + 22 + hs + 22 : T0;
  const seedX = portrait ? L : W / 2 - sw / 2;
  panel(seedX, seedY, sw, hs + 14, (hs + 14) / 2);
  // 明るい：このプレイで取った／うすい：前に取ったことがある／から：まだ
  let oldN = 0;
  for (const q of Level.seeds) if (q.old && !q.got) oldN++;
  for (let i = 0; i < n; i++) {
    const x = seedX + 22 + i * 26, y = seedY + (hs + 14) / 2;
    if (i < Game.seeds) drawSeedIcon(x, y, 22, true, true);
    else if (i < Game.seeds + oldN) { hud.globalAlpha = 0.45; drawSeedIcon(x, y, 22, true, false); hud.globalAlpha = 1; }
    else drawSeedIcon(x, y, 22, false, false);
  }
  // ---- タイム ----
  const touchUI = Input.touchMode && (Game.state === 'play' || Game.state === 'pause');
  const tx = touchUI ? (Input.btns.camera ? Input.btns.camera.x - 32 : W - 130) : W - S.r - 14;
  const tStr = fmtTime(Game.playTime);
  setFont(fs);
  // せまい横画面では種の表示とぶつかるので、1段下へ
  const tLow = !portrait && tx - hud.measureText(tStr).width < seedX + sw + 6;
  txt(tStr, tLow ? W - S.r - 14 : tx, tLow ? T0 + hs + 14 + 20 : T0 + (hs + 14) / 2, fs, '#fff', 'right');

  // ---- メッセージ ----
  // 種ゲットの演出中は、見出しと重なるので出さない
  const showToast = Game.state === 'play';
  for (let i = 0; showToast && i < Game.toasts.length; i++) {
    const t = Game.toasts[i];
    const a = Math.min(1, t.t * 5, (t.dur - t.t) * 2);
    const yy = (portrait ? H * 0.3 : H * 0.22) + i * (fs + 20) - (1 - Math.min(1, t.t * 5)) * 10;
    hud.globalAlpha = a;
    setFont(fs + 1);
    const tw = Math.min(hud.measureText(t.msg).width, W - 40);
    panel(W / 2 - tw / 2 - 16, yy - (fs + 12) / 2, tw + 32, fs + 12, (fs + 12) / 2, 'rgba(255,255,255,.88)', null);
    txtFit(t.msg, W / 2, yy + 1, fs + 1, W - 40, '#2c3e70', 'center', null);
    hud.globalAlpha = 1;
  }

  // ---- ダメージの赤いふち ----
  if (Game.hurtFlash > 0) {
    const g = hud.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,40,60,${Game.hurtFlash * 0.45})`);
    hud.fillStyle = g; hud.fillRect(0, 0, W, H);
  }

  if (Game.state === 'seed' && Game.lastSeed) drawSeedGet(W, H, fs);
  if (Game.state === 'clear') drawClear(W, H, fs, small);
  if (Game.state === 'dead') {
    hud.fillStyle = `rgba(30,10,40,${Math.min(0.5, Game.stT * 0.35)})`;
    hud.fillRect(0, 0, W, H);
    const k = Math.min(1, Game.stT * 2);
    txt('ころんは たおれてしまった…', W / 2, H * 0.3 - (1 - k) * 20, clamp(W / 20, 22, 40), '#fff', 'center');
    if (Game.stT > 1.6) drawMenu(MENUS.dead, W / 2, H * 0.45, W, H);
  }
  if (Game.state === 'pause') {
    hud.fillStyle = 'rgba(20,30,60,.55)';
    hud.fillRect(0, 0, W, H);
    const land = W > H;
    const items = MENUS.pause;
    const menuH = items.length * (small ? 44 : 52) + 10;
    if (land && W > 540) {
      // 横長：左に進み具合、右にメニュー
      txt('ポーズ', W * 0.3, H * 0.2, small ? 30 : 40, '#fff', 'center');
      drawProgress(W * 0.3, H * 0.2 + 44, fs);
      drawMenu(items, W * 0.68, Math.max(S.t + 16, (H - menuH) / 2), W * 0.6, H);
    } else {
      // 体力・どんぐり・種の表示の下から並べる（縦向きでは種の表示が左上の3段目にある）
      const top = (portrait ? seedY : T0) + hs + 14 + 10;
      txt('ポーズ', W / 2, top + 20, small ? 28 : 40, '#fff', 'center');
      const y = drawProgress(W / 2, top + 56, fs * 0.85, true);
      drawMenu(items, W / 2, Math.max(y + 10, H - S.b - menuH - 10), W, H);
    }
  }
  if (Game.help) drawHelp(W, H);

  // ---- タッチ操作ボタン ----
  if (Input.touchMode && Game.state === 'play') drawTouchUI();
  // ---- 縦向きの案内 ----
  if (Input.touchMode && portrait && Game.state === 'play' && Game.portraitHintT > 0) {
    hud.globalAlpha = Math.min(1, Game.portraitHintT);
    panel(W / 2 - 130, H * 0.55, 260, 34, 17, 'rgba(255,255,255,.85)', null);
    txt('よこむきにすると 遊びやすいよ', W / 2, H * 0.55 + 18, 14, '#2c3e70', 'center', null);
    hud.globalAlpha = 1;
  }
}

// 集めた種の一覧。compact なら 1 行にまとめる
function drawProgress(cx, y, fs, compact) {
  const left = Level.seeds.filter((s) => !s.got).length;
  const have = Save.count(Game.stageId);
  if (compact) {
    txt(`ひかりの種 ${Game.seeds} / ${Level.seedTotal}（これまで ${have}）　どんぐり ${Game.acorns}`, cx, y, fs, '#9cfff0', 'center');
    return y + fs + 8;
  }
  txt(Level.stage.name + '　これまでに ' + have + ' / ' + Level.seedTotal, cx, y, fs * 0.8, '#ffe9a8', 'center');
  y += fs + 6;
  let yy = y;
  // 画面の高さが足りないときは種の名前を省く
  const got = Level.seeds.length - left;
  const names = y + got * (fs + 6) + fs * 2 + 30 < hudH - Input.safe.b;
  for (const s of Level.seeds) {
    if (!s.got || !names) continue;
    txt('◆ ' + s.name, cx, yy, fs * 0.85, '#9cfff0', 'center'); yy += fs + 6;
  }
  txt('のこり ' + left + ' こ　どんぐり ' + Game.acorns + ' こ', cx, yy + 6, fs * 0.85, '#fff', 'center');
  txt('タイム ' + fmtTime(Game.playTime), cx, yy + fs + 16, fs * 0.85, '#fff', 'center');
  return yy + fs * 2 + 20;
}

function drawTitle(W, H, fs, small) {
  const g = hud.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(30,60,120,.35)');
  hud.fillStyle = g; hud.fillRect(0, 0, W, H);
  const portrait = H > W;
  const ts = clamp(Math.min(W / 11, H / 6), 26, 70);
  const bob = Math.sin(Game.time * 2) * 4;
  const ty = portrait ? H * 0.2 : H * 0.2;
  // ロゴ：1文字ずつ少しずつ揺らす
  txt('ころんの', W / 2, ty - ts * 0.2 + bob, ts * 0.55, '#fff6d8', 'center');
  const title = '空島アドベンチャー';
  setFont(ts);
  const tw = Math.min(hud.measureText(title).width, W - 30);
  const k = tw / hud.measureText(title).width;
  let x = W / 2 - tw / 2;
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    setFont(ts * k);
    const cw = hud.measureText(ch).width;
    const yy = ty + ts * 0.85 + Math.sin(Game.time * 3 + i * 0.6) * 4;
    txt(ch, x + cw / 2, yy, ts * k, i < 2 ? '#8ee0ff' : '#ffd166', 'center', 'rgba(40,50,90,.95)');
    x += cw;
  }
  const menuTop = portrait ? H * 0.46 : ty + ts * 1.8;
  const y = drawMenu(MENUS.title, W / 2, menuTop, W, H);
  const touch = Input.touchMode || Input.hasTouch;
  const hint = touch ? 'ボタンをタップしてね' : 'Enter / スペースで決定　↑↓で えらぶ';
  if (Math.floor(Game.time * 1.5) % 2 === 0) txt(hint, W / 2, y + 12, fs * 0.8, '#fff', 'center');
  let by = H - Input.safe.b - 20;
  // 全ステージでとった種の数
  let got = 0;
  for (const st of STAGES) got += Save.count(st.id);
  if (got) { txt('あつめた ひかりの種 ' + got + ' こ', W / 2, by, fs * 0.8, '#ffe9a8', 'center'); by -= fs + 6; }
  if (touch && portrait) txt('スマホは よこむきが おすすめ', W / 2, by, fs * 0.75, '#fff', 'center');
  if (Game.titleMsgT > 0) {
    hud.globalAlpha = Math.min(1, Game.titleMsgT * 2);
    panel(W / 2 - 120, y + 30, 240, 36, 18, 'rgba(255,255,255,.9)', null);
    txt(Game.titleMsg, W / 2, y + 49, fs * 0.85, '#2c3e70', 'center', null);
    hud.globalAlpha = 1;
  }
  if (Game.state === 'erase') drawEraseConfirm(W, H, fs);
  void small;
}

// セーブを消す前の確認
function drawEraseConfirm(W, H, fs) {
  hud.fillStyle = 'rgba(20,30,60,.6)';
  hud.fillRect(0, 0, W, H);
  const pw = Math.min(W - 30, 420), ph = Math.min(H - 30, 250);
  const px = (W - pw) / 2, py = (H - ph) / 2;
  panel(px, py, pw, ph, 18, 'rgba(255,252,240,.97)', '#ff8a8a');
  txt('きろくを けしますか？', W / 2, py + 30, fs + 2, '#e04a5a', 'center', '#fff');
  txtFit('とった ひかりの種と ベストタイムが ぜんぶ きえます', W / 2, py + 62, fs * 0.8, pw - 30, '#2c3e70', 'center', null);
  drawMenu(MENUS.erase, W / 2, py + 86, pw, H);
}

// ステージ選び：カードを横（せまい縦画面では縦）にならべる
function drawSelect(W, H, fs, small) {
  const S = Input.safe;
  const g = hud.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(20,30,70,.15)');
  g.addColorStop(1, 'rgba(20,30,70,.5)');
  hud.fillStyle = g; hud.fillRect(0, 0, W, H);
  txt('ステージを えらぼう', W / 2, S.t + (small ? 26 : 40), small ? 22 : 30, '#ffd166', 'center');
  for (let i = 0; i < menuRects.length; i++) menuRects[i].on = false;
  const n = STAGES.length;
  const portrait = H > W * 1.1;
  const gap = small ? 10 : 18;
  const top = S.t + (small ? 48 : 72);
  const backH = small ? 38 : 44;
  const availH = H - top - S.b - backH - (small ? 40 : 56);
  let cw, ch;
  if (portrait) { cw = Math.min(W - S.l - S.r - 30, 380); ch = clamp((availH - gap * (n - 1)) / n, 92, 170); }
  else { cw = Math.min((W - S.l - S.r - 40 - gap * (n - 1)) / n, 300); ch = clamp(availH, 120, small ? 170 : 200); }
  const totalW = portrait ? cw : cw * n + gap * (n - 1);
  const x0 = W / 2 - totalW / 2;
  for (let i = 0; i < n; i++) {
    const st = STAGES[i];
    const x = portrait ? x0 : x0 + i * (cw + gap);
    const y = portrait ? top + i * (ch + gap) : top;
    const sel = Game.menuSel === i;
    const open = Save.unlocked(i);
    const sv = Save.st(i);
    const shake = sel && Game.selShake > 0 ? Math.sin(Game.selShake * 60) * 6 * Game.selShake / 0.4 : 0;
    const pop = sel ? 1 + Math.sin(Game.time * 5) * 0.01 : 1;
    hud.save();
    hud.translate(x + cw / 2 + shake, y + ch / 2); hud.scale(pop, pop); hud.translate(-(x + cw / 2), -(y + ch / 2));
    panel(x, y, cw, ch, 16, open ? (sel ? 'rgba(255,250,232,.96)' : 'rgba(255,255,255,.82)') : 'rgba(70,80,110,.82)', sel ? '#ffd166' : 'rgba(255,255,255,.6)');
    if (sel) { hud.lineWidth = 4; hud.strokeStyle = '#ffd166'; rrect(x - 3, y - 3, cw + 6, ch + 6, 18); hud.stroke(); }
    // 色の帯
    hud.fillStyle = open ? st.color : '#8890a8';
    rrect(x + 10, y + 10, cw - 20, small ? 6 : 8, 4); hud.fill();
    const lh = clamp(ch / 6, 15, 30);
    let yy = y + 14 + lh * 0.9;
    txtFit((i + 1) + '. ' + st.name, x + cw / 2, yy, small ? 18 : 22, cw - 20, open ? '#2c3e70' : '#fff', 'center', null);
    yy += lh * 0.95;
    if (open) {
      txtFit(st.sub || '', x + cw / 2, yy, small ? 12 : 14, cw - 20, '#6a7aa0', 'center', null);
      yy += lh;
      const total = st.seedTotal || 0;
      const got = sv.seeds.length;
      // 種のアイコン
      const iconS = clamp((cw - 30) / Math.max(total, 1), 12, 22);
      const ix0 = x + cw / 2 - (total - 1) * iconS / 2;
      for (let k = 0; k < total; k++) drawSeedIcon(ix0 + k * iconS, yy, iconS * 0.85, k < got, false);
      yy += lh * 0.95;
      txtFit('ひかりの種 ' + got + ' / ' + total + (sv.done ? '　クリア！' : ''), x + cw / 2, yy, small ? 14 : 16, cw - 20, sv.done ? '#e07a00' : '#2c3e70', 'center', null);
      yy += lh * 0.85;
      txtFit('ベスト ' + (sv.best ? fmtTime(sv.best) : '--:--.--'), x + cw / 2, yy, small ? 13 : 15, cw - 20, '#7a5230', 'center', null);
    } else {
      yy += lh * 0.4;
      txt('？', x + cw / 2, yy + lh * 0.3, small ? 28 : 38, '#fff', 'center', 'rgba(40,50,90,.9)');
      yy += lh * 1.4;
      const u = st.unlock, need = STAGES[u.stage] ? STAGES[u.stage].name : '';
      txtFit(need + 'で', x + cw / 2, yy, small ? 13 : 15, cw - 20, '#ffe9a8', 'center', null);
      yy += lh * 0.8;
      txtFit('ひかりの種を ' + u.seeds + 'こ 集めると ひらく（いま ' + Save.count(u.stage) + 'こ）', x + cw / 2, yy, small ? 12 : 14, cw - 20, '#ffe9a8', 'center', null);
    }
    hud.restore();
    const r = menuRects[i];
    r.x = x; r.y = y; r.w = cw; r.h = ch; r.on = true;
  }
  // もどる
  const by = portrait ? top + n * (ch + gap) : top + ch + gap + 6;
  const bw = 180, bx = W / 2 - bw / 2;
  const selB = Game.menuSel === n;
  panel(bx, by, bw, backH, backH / 2, selB ? 'rgba(255,209,102,.95)' : 'rgba(255,255,255,.88)', selB ? '#fff' : 'rgba(40,50,90,.35)');
  txt('もどる', W / 2, by + backH / 2 + 1, small ? 15 : 17, selB ? '#5a3300' : '#2c3e70', 'center', null);
  const rb = menuRects[n];
  rb.x = bx; rb.y = by; rb.w = bw; rb.h = backH; rb.on = true;
  const touch = Input.touchMode || Input.hasTouch;
  if (Math.floor(Game.time * 1.5) % 2 === 0) txt(touch ? 'カードを タップして はじめる' : '←→で えらんで Enter / スペースで はじめる', W / 2, Math.min(H - S.b - 16, by + backH + 22), fs * 0.75, '#fff', 'center');
}

function drawSeedGet(W, H, fs) {
  const t = Game.stT;
  const k = Math.min(1, t * 3);
  const bounce = 1 + Math.sin(Math.min(1, t * 2.5) * Math.PI) * 0.25;
  // 縦向きでは左上の種の表示と重ならないように少し下げる
  const cy = H > W ? Math.max(H * 0.22, Input.safe.t + 225) : H * 0.22;
  // 光の筋
  hud.save();
  hud.translate(W / 2, cy);
  hud.rotate(t * 0.6);
  hud.globalAlpha = Math.min(0.3, t) * (t > 2.3 ? Math.max(0, (2.8 - t) * 2) : 1);
  hud.fillStyle = '#fff6b0';
  const rl = Math.max(W, H) * 0.6;
  for (let i = 0; i < 12; i++) {
    hud.rotate(TAU / 12);
    hud.beginPath(); hud.moveTo(0, 0); hud.lineTo(rl, -rl * 0.08); hud.lineTo(rl, rl * 0.08); hud.closePath(); hud.fill();
  }
  hud.restore();
  hud.globalAlpha = 1;
  drawSeedIcon(W / 2, cy - 30, 54 * bounce * k, true, true);
  txt('ひかりの種 ゲット！', W / 2, cy + 40 - (1 - k) * 30, clamp(W / 16, 26, 52) * k * (t < 0.4 ? bounce : 1), '#9cfff0', 'center');
  if (t > 0.4) txt(Game.lastSeed.name, W / 2, cy + 40 + clamp(W / 16, 26, 52) * 0.75 + 6, fs, '#fff', 'center');
  const have = Save.count(Game.stageId);
  if (t > 0.6) txt(Game.lastOld ? 'とったことがある 種（' + have + ' / ' + Level.seedTotal + '）' : have + ' / ' + Level.seedTotal, W / 2, cy + 40 + clamp(W / 16, 26, 52) * 0.75 + fs + 16, Game.lastOld ? fs : fs + 4, Game.lastOld ? '#d8e4ff' : '#ffe08a', 'center');
}

function drawClear(W, H, fs, small) {
  hud.fillStyle = `rgba(255,250,220,${Math.min(0.4, Game.stT * 0.2)})`;
  hud.fillRect(0, 0, W, H);
  const k = Math.min(1, Game.stT * 1.5);
  const cy = H * 0.24;
  txt(Level.stage.name + ' クリア！', W / 2, cy - (1 - k) * 30, clamp(W / 16, 24, 54) * (0.6 + 0.4 * k), '#ffd166', 'center');
  if (Game.stT > 0.8) {
    const pw = Math.min(W - 40, 360), ph = small ? 96 : 120;
    panel(W / 2 - pw / 2, cy + 36, pw, ph, 16, 'rgba(255,255,255,.9)', '#ffd166');
    txt('タイム ' + fmtTime(Game.playTime), W / 2, cy + 36 + ph * 0.28, fs + 4, '#2c3e70', 'center', null);
    if (Game.newRecord) txt('ベスト更新！', W / 2, cy + 36 + ph * 0.52, fs, '#ff5577', 'center', null);
    else if (!Game.fullRun) txtFit('1回で ぜんぶ集めると タイムが のこるよ', W / 2, cy + 36 + ph * 0.52, fs * 0.8, pw - 20, '#6a7aa0', 'center', null);
    else { const b = Save.st(Game.stageId).best; if (b) txt('ベスト ' + fmtTime(b), W / 2, cy + 36 + ph * 0.52, fs * 0.9, '#6a7aa0', 'center', null); }
    txt('どんぐり ' + Game.acorns + ' / ' + Level.acornTotal, W / 2, cy + 36 + ph * 0.78, fs, '#7a5230', 'center', null);
    if (Game.stT > 3) drawMenu(MENUS.clear, W / 2, cy + 36 + ph + 16, W, H);
  }
}

function drawTouchUI() {
  hud.save();
  for (const k in Input.btns) {
    const b = Input.btns[k];
    const r = b.r * (b.down ? 0.92 : 1);
    hud.beginPath();
    hud.arc(b.x, b.y, r, 0, TAU);
    if (b.small) hud.fillStyle = b.down ? 'rgba(255,255,255,.6)' : 'rgba(30,50,100,.35)';
    else hud.fillStyle = b.down ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.2)';
    hud.fill();
    hud.lineWidth = b.small ? 2 : 3;
    hud.strokeStyle = b.col || 'rgba(255,255,255,.8)';
    hud.stroke();
    if (b.small) txt(b.label, b.x, b.y + 1, k === 'pause' ? 16 : 10, '#fff', 'center');
    else txtFit(b.label, b.x, b.y + 1, Math.max(12, b.r * 0.34), b.r * 1.8, '#fff', 'center');
  }
  const R0 = Input.stickR;
  if (Input.stick) {
    const s = Input.stick;
    hud.beginPath(); hud.arc(s.ox, s.oy, R0, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.15)'; hud.fill();
    hud.strokeStyle = 'rgba(255,255,255,.55)'; hud.lineWidth = 2.5; hud.stroke();
    let dx = s.x - s.ox, dy = s.y - s.oy; const d = Math.hypot(dx, dy);
    if (d > R0) { dx *= R0 / d; dy *= R0 / d; }
    hud.beginPath(); hud.arc(s.ox + dx, s.oy + dy, R0 * 0.45, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.7)'; hud.fill();
  } else {
    // さわっていないときは、いつもの場所にうっすら表示
    const hx = Input.stickHome.x, hy = Input.stickHome.y;
    hud.beginPath(); hud.arc(hx, hy, R0, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.08)'; hud.fill();
    hud.strokeStyle = 'rgba(255,255,255,.35)'; hud.lineWidth = 2; hud.stroke();
    hud.beginPath(); hud.arc(hx, hy, R0 * 0.45, 0, TAU);
    hud.fillStyle = 'rgba(255,255,255,.25)'; hud.fill();
    if (Game.playTime < 20) txt('いどう', hx, hy, 13, 'rgba(255,255,255,.9)', 'center');
  }
  hud.restore();
}

// ---------------- メインループ ----------------
let lastT = performance.now();
const debug = { manual: false };
function stepGame(dt) {
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
}
function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.1) dt = 0.1;
  Game.fps = lerp(Game.fps, 1 / Math.max(dt, 1e-3), 0.05);
  const t0 = performance.now();
  if (!debug.manual) stepGame(dt);
  Music.update();
  const t1 = performance.now();
  render();
  const t2 = performance.now();
  drawHud();
  Game.cpuMs = lerp(Game.cpuMs, (t1 - t0) + (performance.now() - t2), 0.05);
  requestAnimationFrame(frame);
}

function boot() {
  try {
    initGL();
    if (R.ok) { buildModels(); buildLevelState(0); }
  } catch (e) {
    R.ok = false;
    console.error(e);
  }
  Cam.eye[0] = 40; Cam.eye[1] = 20; Cam.eye[2] = 40;
  readSafeArea();
  // デバッグ用：KORON.step(秒) で入力を入れたまま時間を進められる（debug.manual=true のとき）
  window.KORON = { Game, P, PL, Cam, Level, World, Input, R, Sound, Music, debug, step: stepGame, camReset, menuRects, Save, STAGES, goSelect, goTitle, buildLevelState };
  requestAnimationFrame(frame);
}
boot();
