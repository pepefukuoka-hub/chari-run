// 入力（キーボード・タッチ・マウス・ゲームパッド）
// 「押した瞬間」のフラグ（〜P）は 1 フレームだけ立ち、clearPressed() で消える
const hudCanvas = document.getElementById('hud');
const safeEl = document.getElementById('safe');

const Input = {
  mx: 0, my: 0,          // 移動（-1〜1、my>0 が奥）
  jump: false, jumpP: false,
  attack: false, attackP: false,
  crouch: false, crouchP: false,
  camDX: 0, camDY: 0,    // カメラ回転量（ドラッグ。ピクセル）
  camRX: 0, camRY: 0,    // カメラ回転の速さ（右スティック。-1〜1）
  camKey: 0,             // Q/E 長押しによる回転
  zoomP: false, zoomStep: 0,
  camResetP: false,      // カメラを主人公の後ろへ
  pauseP: false,
  anyP: false,           // 何かのボタンが押された（タイトル用）
  // メニュー操作
  upP: false, downP: false, leftP: false, rightP: false, okP: false, backP: false,
  tapP: false, tapX: 0, tapY: 0,  // 画面のタップ／クリック位置（メニュー用）
  touchMode: false,
  hasTouch: ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0,
  padOn: false,
  keys: new Set(),
  // タッチ
  stick: null,           // {id, ox, oy, x, y}
  stickR: 60,            // スティックの半径（画面の大きさで変わる）
  stickHome: { x: 90, y: 300 },
  camTouch: null,        // {id, x, y, sx, sy, t}
  lastCamTap: 0,
  btns: {},              // name -> {x,y,r,label,id,down}
  pad: { jump: false, attack: false, crouch: false },
  safe: { l: 0, r: 0, t: 0, b: 0 },
};

const KEYMAP = {
  jump: ['Space', 'KeyK', 'KeyZ'],
  attack: ['KeyJ', 'KeyX'],
  crouch: ['ShiftLeft', 'ShiftRight', 'KeyL', 'KeyC'],
};
const isKey = (list, code) => list.indexOf(code) >= 0;
const anyKey = (list) => { for (let i = 0; i < list.length; i++) if (Input.keys.has(list[i])) return true; return false; };

window.addEventListener('keydown', (e) => {
  const c = e.code;
  if (c === 'Space' || c.startsWith('Arrow') || c === 'Tab') e.preventDefault();
  if (e.repeat) return;
  Input.keys.add(c);
  Input.touchMode = false;
  if (isKey(KEYMAP.jump, c)) Input.jumpP = true;
  if (isKey(KEYMAP.attack, c)) Input.attackP = true;
  if (isKey(KEYMAP.crouch, c)) Input.crouchP = true;
  if (c === 'KeyR') Input.zoomP = true;
  if (c === 'KeyF' || c === 'Tab') Input.camResetP = true;
  if (c === 'Escape' || c === 'KeyP') Input.pauseP = true;
  if (c === 'Escape' || c === 'Backspace') Input.backP = true;
  if (c === 'ArrowUp' || c === 'KeyW') Input.upP = true;
  if (c === 'ArrowDown' || c === 'KeyS') Input.downP = true;
  if (c === 'ArrowLeft' || c === 'KeyA') Input.leftP = true;
  if (c === 'ArrowRight' || c === 'KeyD') Input.rightP = true;
  if (c === 'Enter' || c === 'Space' || c === 'KeyZ' || c === 'KeyK') Input.okP = true;
  if (c === 'Enter' || isKey(KEYMAP.jump, c)) Input.anyP = true;
  Sound.unlock();
});
window.addEventListener('keyup', (e) => Input.keys.delete(e.code));
window.addEventListener('blur', () => {
  Input.keys.clear();
  releaseAllTouches();
  if (typeof Game !== 'undefined' && Game.state === 'play') Input.pauseP = true; // よそ見したらポーズ
});

// ---- 安全領域（ノッチ）を CSS の env() から読む ----
function readSafeArea() {
  if (!safeEl) return;
  const cs = getComputedStyle(safeEl);
  Input.safe.t = parseFloat(cs.paddingTop) || 0;
  Input.safe.r = parseFloat(cs.paddingRight) || 0;
  Input.safe.b = parseFloat(cs.paddingBottom) || 0;
  Input.safe.l = parseFloat(cs.paddingLeft) || 0;
}

// ---- タッチ用ボタン配置（CSSピクセル） ----
// 右手の親指が「ジャンプ」に乗っている前提で、パンチは左、しゃがむは上に置く
function layoutTouch(w, h) {
  readSafeArea();
  const S = Input.safe;
  const s = Math.min(w, h);
  const land = w > h;
  const r = clamp(s * (land ? 0.105 : 0.1), 34, 58);
  // 横持ちは親指の付け根に近い角へ寄せる（すき間を小さく）
  const mg = land ? Math.max(6, r * 0.12) : Math.max(14, r * 0.35);
  const right = w - S.r - mg;
  const bottom = h - S.b - mg;
  const jr = r * 1.3;
  const jx = right - jr, jy = bottom - jr;
  const old = Input.btns;
  Input.btns = {
    jump: { x: jx, y: jy, r: jr, label: 'ジャンプ', col: '#ffd166' },
    // 横持ち：ジャンプを右下の角に置き、パンチは左に、しゃがむは左ななめ上に（角をかこむ扇形）
    attack: land
      ? { x: jx - (jr + r * 0.95 + 10), y: jy + jr * 0.3, r: r * 0.95, label: 'パンチ', col: '#ff8a7a' }
      : { x: jx - jr - r * 1.25, y: jy + jr * 0.25, r: r * 0.95, label: 'パンチ', col: '#ff8a7a' },
    crouch: land
      ? { x: jx - (jr + r * 0.9 + 10) * 0.42, y: jy - (jr + r * 0.9 + 10) * 0.9, r: r * 0.9, label: 'しゃがむ', col: '#8fd3ff' }
      : { x: jx + jr * 0.15, y: jy - jr - r * 1.15, r: r * 0.9, label: 'しゃがむ', col: '#8fd3ff' },
    pause: { x: w - S.r - 34, y: S.t + 32, r: 22, label: 'Ⅱ', small: true },
    camera: { x: w - S.r - 88, y: S.t + 32, r: 22, label: 'カメラ', small: true },
  };
  for (const k in Input.btns) {
    const b = Input.btns[k];
    b.id = old[k] ? old[k].id : null;
    b.down = old[k] ? old[k].down : false;
  }
  Input.stickR = clamp(s * 0.14, 46, 74);
  // スティックの定位置：横持ちは左下の角へ寄せる
  Input.stickHome.x = S.l + Input.stickR + (land ? 14 : 34);
  Input.stickHome.y = h - S.b - Input.stickR - (land ? 10 : 30);
}

// いちばん近いボタン（当たり判定は見た目より少し大きめ）
function hitBtn(x, y) {
  let best = null, bd = 1e9;
  for (const k in Input.btns) {
    const b = Input.btns[k];
    const d = Math.hypot(x - b.x, y - b.y);
    const reach = b.small ? b.r + 14 : b.r * 1.22;
    if (d < reach && d / reach < bd) { bd = d / reach; best = k; }
  }
  return best;
}

function pressBtn(name, down) {
  if (name === 'jump') { if (down) { Input.jumpP = true; Input.anyP = true; } Input.pad.jump = down; }
  if (name === 'attack') { if (down) Input.attackP = true; Input.pad.attack = down; }
  if (name === 'crouch') { if (down) Input.crouchP = true; Input.pad.crouch = down; }
  if (name === 'pause' && down) Input.pauseP = true;
  if (name === 'camera' && down) Input.camResetP = true;
}

function releaseAllTouches() {
  Input.stick = null; Input.camTouch = null;
  for (const k in Input.btns) {
    const b = Input.btns[k];
    if (b.down) pressBtn(k, false);
    b.id = null; b.down = false;
  }
}

function setTap(x, y) { Input.tapP = true; Input.tapX = x; Input.tapY = y; }

hudCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  Input.touchMode = true;
  Sound.unlock();
  const w = window.innerWidth;
  const playing = typeof Game !== 'undefined' && Game.state === 'play';
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    if (!playing) { setTap(x, y); Input.anyP = true; continue; }
    const b = hitBtn(x, y);
    if (b && Input.btns[b].id === null) {
      Input.btns[b].id = t.identifier;
      Input.btns[b].down = true;
      pressBtn(b, true);
    } else if (x < w * 0.5 && !Input.stick) {
      // 左半分：さわった所がスティックの中心（浮動スティック）
      Input.stick = { id: t.identifier, ox: x, oy: y, x, y };
    } else if (!Input.camTouch) {
      const now = performance.now();
      Input.camTouch = { id: t.identifier, x, y, sx: x, sy: y, t: now };
    }
  }
}, { passive: false });

hudCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    if (Input.stick && t.identifier === Input.stick.id) {
      Input.stick.x = x; Input.stick.y = y;
      continue;
    }
    if (Input.camTouch && t.identifier === Input.camTouch.id) {
      Input.camDX += x - Input.camTouch.x;
      Input.camDY += y - Input.camTouch.y;
      Input.camTouch.x = x; Input.camTouch.y = y;
      continue;
    }
    // ボタンからボタンへ指をすべらせる
    //（「しゃがむ」を押したままジャンプへすべらせると、幅とび・バク宙ができる）
    let owns = false;
    for (const k in Input.btns) if (Input.btns[k].id === t.identifier) owns = true;
    if (!owns) continue;
    const over = hitBtn(x, y);
    for (const k in Input.btns) {
      const b = Input.btns[k];
      if (b.id === t.identifier && k !== over && k !== 'crouch' && !b.small) {
        b.id = null; b.down = false; pressBtn(k, false);
      }
    }
    if (over && !Input.btns[over].small && Input.btns[over].id === null) {
      Input.btns[over].id = t.identifier; Input.btns[over].down = true; pressBtn(over, true);
    }
  }
}, { passive: false });

function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (Input.stick && t.identifier === Input.stick.id) Input.stick = null;
    if (Input.camTouch && t.identifier === Input.camTouch.id) {
      const c = Input.camTouch;
      const now = performance.now();
      // 右側を軽く 2 回タップでカメラを後ろへ
      if (now - c.t < 250 && Math.hypot(c.x - c.sx, c.y - c.sy) < 12) {
        if (now - Input.lastCamTap < 380) { Input.camResetP = true; Input.lastCamTap = 0; } else Input.lastCamTap = now;
      }
      Input.camTouch = null;
    }
    for (const k in Input.btns) {
      const b = Input.btns[k];
      if (b.id === t.identifier) { b.id = null; b.down = false; pressBtn(k, false); }
    }
  }
}
hudCanvas.addEventListener('touchend', touchEnd, { passive: false });
hudCanvas.addEventListener('touchcancel', touchEnd, { passive: false });
// iOS のピンチ拡大・ダブルタップ拡大を止める
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// マウス：ドラッグでカメラ回転、ホイールで遠近、クリックでメニュー
let mouseDrag = null;
hudCanvas.addEventListener('mousedown', (e) => {
  if (Input.touchMode && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
  Sound.unlock();
  mouseDrag = { x: e.clientX, y: e.clientY };
  setTap(e.clientX, e.clientY);
  Input.anyP = true;
});
window.addEventListener('mousemove', (e) => {
  if (!mouseDrag) return;
  Input.camDX += e.clientX - mouseDrag.x;
  Input.camDY += e.clientY - mouseDrag.y;
  mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
});
window.addEventListener('mouseup', () => { mouseDrag = null; });
hudCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  Input.zoomStep += e.deltaY > 0 ? 1 : -1;
}, { passive: false });
hudCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ゲームパッド（標準配置）：A=ジャンプ B/X=パンチ L/ZL/ZR=しゃがむ R=遠近 Y/セレクト=カメラ スタート=ポーズ
let padPrev = { j: false, a: false, c: false, p: false, r: false, cam: false, u: false, d: false, l: false, rt: false, b: false };
const padNow = { j: false, a: false, c: false, p: false, r: false, cam: false, u: false, d: false, l: false, rt: false, b: false };
let stickMenuY = 0, stickMenuX = 0;

function pollInput() {
  const k = Input.keys;
  let x = 0, y = 0;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
  if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
  Input.camKey = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  Input.camRX = 0; Input.camRY = 0;

  if (Input.stick) {
    const maxR = Input.stickR;
    let dx = Input.stick.x - Input.stick.ox, dy = Input.stick.y - Input.stick.oy;
    let d = Math.hypot(dx, dy);
    if (d > maxR) { // スティックの中心を指に追従させる（指が外へ出ても操作が続く）
      Input.stick.ox += (dx / d) * (d - maxR);
      Input.stick.oy += (dy / d) * (d - maxR);
      dx = Input.stick.x - Input.stick.ox; dy = Input.stick.y - Input.stick.oy;
      d = maxR;
    }
    // 遊び（デッドゾーン）を引いてから 0〜1 に。半分くらい倒すと歩き、端まで倒すと走る
    const dead = maxR * 0.12;
    const m = clamp((d - dead) / (maxR * 0.8 - dead), 0, 1);
    if (m > 0) { x = (dx / d) * m; y = (-dy / d) * m; }
  }

  let jumpHeld = anyKey(KEYMAP.jump) || Input.pad.jump;
  let crouchHeld = anyKey(KEYMAP.crouch) || Input.pad.crouch;
  let attackHeld = anyKey(KEYMAP.attack) || Input.pad.attack;

  // ゲームパッド
  const gps = navigator.getGamepads ? navigator.getGamepads() : null;
  if (gps) {
    for (let i = 0; i < gps.length; i++) {
      const gp = gps[i];
      if (!gp || !gp.connected) continue;
      Input.padOn = true;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const am = Math.hypot(ax, ay);
      if (am > 0.18) { const s = Math.min(1, (am - 0.18) / 0.72) / am; x = ax * s; y = -ay * s; Input.touchMode = false; }
      const cx = gp.axes[2] || 0, cy = gp.axes[3] || 0;
      const dz = (v) => (Math.abs(v) < 0.2 ? 0 : (v - Math.sign(v) * 0.2) / 0.8);
      Input.camRX = dz(cx); Input.camRY = dz(cy);
      const b = (n) => !!(gp.buttons[n] && gp.buttons[n].pressed);
      padNow.j = b(0); padNow.a = b(2) || b(1); padNow.b = b(1); padNow.c = b(6) || b(7) || b(4);
      padNow.p = b(9); padNow.r = b(5); padNow.cam = b(3) || b(8);
      padNow.u = b(12); padNow.d = b(13); padNow.l = b(14); padNow.rt = b(15);
      // 十字キーでも移動
      if (padNow.u || padNow.d || padNow.l || padNow.rt) {
        x = (padNow.rt ? 1 : 0) - (padNow.l ? 1 : 0); y = (padNow.u ? 1 : 0) - (padNow.d ? 1 : 0);
        if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      }
      if (padNow.j && !padPrev.j) { Input.jumpP = true; Input.anyP = true; Input.okP = true; }
      if (padNow.a && !padPrev.a) Input.attackP = true;
      if (padNow.b && !padPrev.b) Input.backP = true;
      if (padNow.c && !padPrev.c) Input.crouchP = true;
      if (padNow.p && !padPrev.p) { Input.pauseP = true; Input.anyP = true; }
      if (padNow.r && !padPrev.r) Input.zoomP = true;
      if (padNow.cam && !padPrev.cam) Input.camResetP = true;
      if (padNow.u && !padPrev.u) Input.upP = true;
      if (padNow.d && !padPrev.d) Input.downP = true;
      if (padNow.l && !padPrev.l) Input.leftP = true;
      if (padNow.rt && !padPrev.rt) Input.rightP = true;
      // 左スティックでもメニューを選べる
      const sy = ay > 0.6 ? 1 : ay < -0.6 ? -1 : 0, sx = ax > 0.6 ? 1 : ax < -0.6 ? -1 : 0;
      if (sy && sy !== stickMenuY) { if (sy > 0) Input.downP = true; else Input.upP = true; }
      if (sx && sx !== stickMenuX) { if (sx > 0) Input.rightP = true; else Input.leftP = true; }
      stickMenuY = sy; stickMenuX = sx;
      jumpHeld = jumpHeld || padNow.j;
      crouchHeld = crouchHeld || padNow.c;
      attackHeld = attackHeld || padNow.a;
      for (const key in padNow) padPrev[key] = padNow[key];
      break;
    }
  }

  Input.mx = x; Input.my = y;
  Input.jump = jumpHeld;
  Input.crouch = crouchHeld;
  Input.attack = attackHeld;
}

function clearPressed() {
  Input.jumpP = Input.attackP = Input.crouchP = Input.zoomP = Input.pauseP = Input.anyP = false;
  Input.upP = Input.downP = Input.leftP = Input.rightP = Input.okP = Input.backP = false;
  Input.tapP = false; Input.camResetP = false;
  Input.camDX = Input.camDY = 0;
  Input.zoomStep = 0;
}
