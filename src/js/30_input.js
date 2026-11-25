// 入力（キーボード・タッチ・マウス・ゲームパッド）
const hudCanvas = document.getElementById('hud');

const Input = {
  mx: 0, my: 0,          // 移動（-1〜1、my>0 が奥）
  jump: false, jumpP: false,
  attackP: false,
  crouch: false, crouchP: false,
  camDX: 0, camDY: 0,    // カメラ回転量（このフレーム分）
  camKey: 0,             // Q/E 長押しによる回転
  zoomP: false,
  pauseP: false,
  anyP: false,           // 何かのボタンが押された（タイトル用）
  touchMode: false,
  keys: new Set(),
  // タッチ
  stick: null,           // {id, ox, oy, x, y}
  camTouch: null,        // {id, x, y}
  btns: {},              // name -> {x,y,r, id, down}
  pad: { jump: false, attack: false, crouch: false },
};

const KEYMAP = {
  jump: ['Space', 'KeyK', 'KeyZ'],
  attack: ['KeyJ', 'KeyX'],
  crouch: ['ShiftLeft', 'ShiftRight', 'KeyL', 'KeyC'],
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); return; }
  Input.keys.add(e.code);
  Input.touchMode = false;
  if (KEYMAP.jump.includes(e.code)) Input.jumpP = true;
  if (KEYMAP.attack.includes(e.code)) Input.attackP = true;
  if (KEYMAP.crouch.includes(e.code)) Input.crouchP = true;
  if (e.code === 'KeyR') Input.zoomP = true;
  if (e.code === 'Escape' || e.code === 'KeyP') Input.pauseP = true;
  if (e.code === 'Enter' || KEYMAP.jump.includes(e.code)) Input.anyP = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  Sound.unlock();
});
window.addEventListener('keyup', (e) => Input.keys.delete(e.code));
window.addEventListener('blur', () => Input.keys.clear());

// ---- タッチ用ボタン配置（CSSピクセル） ----
function layoutTouch(w, h) {
  const s = Math.min(w, h);
  const r = clamp(s * 0.085, 30, 52);
  const pad = r * 0.6;
  Input.btns = {
    jump: { x: w - pad - r, y: h - pad - r, r: r * 1.15, label: 'ジャンプ' },
    attack: { x: w - pad - r * 3.3, y: h - pad - r * 0.6, r: r * 0.9, label: 'パンチ' },
    crouch: { x: w - pad - r * 0.9, y: h - pad - r * 3.4, r: r * 0.85, label: 'しゃがむ' },
    pause: { x: w - 36, y: 36, r: 22, label: 'Ⅱ' },
    camera: { x: 36, y: 36, r: 22, label: '◎' },
  };
  for (const k in Input.btns) Object.assign(Input.btns[k], { id: null, down: false });
}

function hitBtn(x, y) {
  for (const k in Input.btns) {
    const b = Input.btns[k];
    if (Math.hypot(x - b.x, y - b.y) < b.r * 1.2) return k;
  }
  return null;
}

function pressBtn(name, down) {
  if (name === 'jump') { if (down) { Input.jumpP = true; Input.anyP = true; } Input.pad.jump = down; }
  if (name === 'attack') { if (down) Input.attackP = true; Input.pad.attack = down; }
  if (name === 'crouch') { if (down) Input.crouchP = true; Input.pad.crouch = down; }
  if (name === 'pause' && down) Input.pauseP = true;
  if (name === 'camera' && down) Input.zoomP = true;
}

hudCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  Input.touchMode = true;
  Sound.unlock();
  const w = window.innerWidth;
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    const b = Game.state === 'play' ? hitBtn(x, y) : null;
    if (b) {
      Input.btns[b].id = t.identifier;
      Input.btns[b].down = true;
      pressBtn(b, true);
    } else if (x < w * 0.45 && !Input.stick && Game.state === 'play') {
      Input.stick = { id: t.identifier, ox: x, oy: y, x, y };
    } else if (!Input.camTouch) {
      Input.camTouch = { id: t.identifier, x, y, sx: x, sy: y, t: performance.now() };
      Input.anyP = true;
    }
  }
}, { passive: false });

hudCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (Input.stick && t.identifier === Input.stick.id) {
      Input.stick.x = t.clientX; Input.stick.y = t.clientY;
    } else if (Input.camTouch && t.identifier === Input.camTouch.id) {
      Input.camDX += t.clientX - Input.camTouch.x;
      Input.camDY += t.clientY - Input.camTouch.y;
      Input.camTouch.x = t.clientX; Input.camTouch.y = t.clientY;
    }
  }
}, { passive: false });

function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (Input.stick && t.identifier === Input.stick.id) Input.stick = null;
    if (Input.camTouch && t.identifier === Input.camTouch.id) Input.camTouch = null;
    for (const k in Input.btns) {
      const b = Input.btns[k];
      if (b.id === t.identifier) { b.id = null; b.down = false; pressBtn(k, false); }
    }
  }
}
hudCanvas.addEventListener('touchend', touchEnd, { passive: false });
hudCanvas.addEventListener('touchcancel', touchEnd, { passive: false });

// マウス：ドラッグでカメラ回転、クリックでタイトル開始
let mouseDrag = null;
hudCanvas.addEventListener('mousedown', (e) => {
  Sound.unlock();
  mouseDrag = { x: e.clientX, y: e.clientY };
  Input.anyP = true;
});
window.addEventListener('mousemove', (e) => {
  if (!mouseDrag) return;
  Input.camDX += e.clientX - mouseDrag.x;
  Input.camDY += e.clientY - mouseDrag.y;
  mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
});
window.addEventListener('mouseup', () => { mouseDrag = null; });
hudCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

let padPrev = {};
function pollInput() {
  const k = Input.keys;
  let x = 0, y = 0;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
  if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
  Input.camKey = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

  if (Input.stick) {
    const maxR = 60;
    let dx = Input.stick.x - Input.stick.ox, dy = Input.stick.y - Input.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > maxR) { // スティックの原点を指に追従させる
      Input.stick.ox += (dx / d) * (d - maxR);
      Input.stick.oy += (dy / d) * (d - maxR);
      dx = Input.stick.x - Input.stick.ox; dy = Input.stick.y - Input.stick.oy;
    }
    const m = Math.min(1, d / maxR);
    if (d > 6) { x = (dx / (d || 1)) * m; y = (-dy / (d || 1)) * m; }
  }

  let jumpHeld = KEYMAP.jump.some((c) => k.has(c)) || Input.pad.jump;
  let crouchHeld = KEYMAP.crouch.some((c) => k.has(c)) || Input.pad.crouch;

  // ゲームパッド
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const am = Math.hypot(ax, ay);
    if (am > 0.18) { const s = Math.min(1, (am - 0.18) / 0.75) / am; x = ax * s; y = -ay * s; }
    const cx = gp.axes[2] || 0, cy = gp.axes[3] || 0;
    if (Math.abs(cx) > 0.2) Input.camDX += cx * 9;
    if (Math.abs(cy) > 0.2) Input.camDY += cy * 6;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const now = { j: b(0), a: b(2) || b(1), c: b(6) || b(7) || b(4), p: b(9), r: b(5) };
    if (now.j && !padPrev.j) { Input.jumpP = true; Input.anyP = true; }
    if (now.a && !padPrev.a) Input.attackP = true;
    if (now.c && !padPrev.c) Input.crouchP = true;
    if (now.p && !padPrev.p) Input.pauseP = true;
    if (now.r && !padPrev.r) Input.zoomP = true;
    jumpHeld = jumpHeld || now.j;
    crouchHeld = crouchHeld || now.c;
    padPrev = now;
    break;
  }

  Input.mx = x; Input.my = y;
  Input.jump = jumpHeld;
  Input.crouch = crouchHeld;
}

function clearPressed() {
  Input.jumpP = Input.attackP = Input.crouchP = Input.zoomP = Input.pauseP = Input.anyP = false;
  Input.camDX = Input.camDY = 0;
}
