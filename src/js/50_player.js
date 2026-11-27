// 主人公「ころん」の動きと当たり判定
const PL = {
  R: 0.42, H: 1.3,
  GRAV: 40, MAXFALL: 34,
  WALK: 4.2, RUN: 9.2, ACC: 34, DEC: 30, AIR_ACC: 16,
  TURN: 12,
  J1: 13.2, J2: 15.6, J3: 19.5,
  CHAIN_WIN: 0.24,    // 着地してから次のジャンプで段が上がる受付時間
  // ここから下は追加（手ざわり用）
  COYOTE: 0.1,        // 崖から落ちた直後でもジャンプできる時間
  BUFFER: 0.14,       // ジャンプの先行入力を覚えておく時間
  WALL_WIN: 0.2,      // 壁に当たってから壁キックを受け付ける時間
  WALL_SLIDE: 6.5,    // 壁に押しつけているときの落下速度の上限
  LONG_V: 10.5, LONG_MUL: 1.75,   // 幅とび
  BACK_V: 20.5,       // バク宙
  SIDE_V: 20,         // くるりんジャンプ（切り返し中のジャンプ）
  WALLKICK_V: 15.5, WALLKICK_H: 8.5,
  POUNDJUMP_V: 18,    // ヒップドロップ着地直後のジャンプ
  ICE_ACC: 7, ICE_DEC: 2.2,
};

const P = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
  r: PL.R, h: PL.H,
  yaw: 0,            // 向き（+z 方向が 0、反時計回り）
  speed: 0,          // 水平方向の速さ（向き方向。マイナスは後ろ向きに進む）
  grounded: true, groundS: null,
  state: 'ground',   // ground | air | pound | punch | hurt | dead | win
  jumpN: 0,          // 連続ジャンプの段数
  landT: 0,          // 着地してからの時間
  airT: 0,
  jumpHeld: false,
  stateT: 0,
  flip: 0,           // 三段ジャンプ・バク宙の回転
  flipDir: 1,
  wall: null, wallT: 0,
  hp: 3, maxHp: 3,
  inv: 0,            // 無敵時間
  safe: [0, 0, 0],   // 最後に安全に立った位置
  safeT: 0,
  anim: 0,           // 歩きアニメの位相
  squash: 1,
  crouching: false,
  punchHit: false,
  longJump: false,
  kickT: 0,
  dust: 0,
  // 追加した状態
  coyote: 0,         // 残りコヨーテ時間
  jumpBuf: 0,        // 残り先行入力時間
  attackBuf: 0,
  skidT: 0,          // 切り返しブレーキ中（0 より大きい間）
  skidYaw: 0,        // 切り返したい向き
  sideFlip: false,   // くるりんジャンプ中
  dive: false,       // 空中ダイブ中
  slideT: 0,         // ダイブ着地後のすべり
  poundT: 0,         // ヒップドロップ着地後の受付
  punchN: 0,         // パンチの連続段数
  wallSlide: false,
  slope: 0,          // 足元の坂の傾き（進む向きに上り＝プラス）
  fallFrom: 0,       // 空中で一番高かった所
};

function playerReset(x, y, z, yaw) {
  Object.assign(P, {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, speed: 0, grounded: true, groundS: null, state: 'ground',
    jumpN: 0, landT: 1, airT: 0, flip: 0, wall: null, wallT: 0, inv: 0, stateT: 0, squash: 1,
    crouching: false, longJump: false, kickT: 0, coyote: 0, jumpBuf: 0, attackBuf: 0, skidT: 0,
    sideFlip: false, dive: false, slideT: 0, poundT: 0, punchN: 0, wallSlide: false, fallFrom: y,
  });
  P.safe = [x, y, z];
}

function playerHurt(fromX, fromZ, dmg = 1) {
  if (P.inv > 0 || P.state === 'dead' || P.state === 'win') return;
  P.hp -= dmg;
  Sound.play('hurt');
  Fx.burst(P.x, P.y + 0.8, P.z, [1, 0.9, 0.4], 10, 5);
  Game.shake = 0.35;
  Game.hurtFlash = 1;
  if (P.hp <= 0) { playerDie(); return; }
  const dx = P.x - fromX, dz = P.z - fromZ, d = Math.hypot(dx, dz) || 1;
  // 後ろ向きにはじかれる（向きはそのまま、敵の方を見る）
  P.yaw = Math.atan2(-dx, -dz);
  P.speed = -8;
  P.vx = (dx / d) * 8; P.vz = (dz / d) * 8; P.vy = 9;
  P.grounded = false; P.groundS = null;
  P.state = 'hurt'; P.stateT = 0;
  P.flip = 0; P.longJump = false; P.dive = false; P.skidT = 0;
  P.inv = 2.0;
}

function playerDie() {
  P.hp = 0;
  P.state = 'dead'; P.stateT = 0;
  P.vx = P.vz = 0; P.vy = 12;
  Game.onDeath();
}

// 入力方向（カメラ基準）→ ワールド方向。毎フレーム同じ入れ物を使う
const inp = { m: 0, ax: 0, az: 0 };
function readInputDir() {
  const m = Math.min(1, Math.hypot(Input.mx, Input.my));
  if (m < 0.05) { inp.m = 0; inp.ax = 0; inp.az = 0; return inp; }
  const cy = Cam.yaw;
  // カメラの前（奥）方向 = (-sin, -cos)（カメラは yaw 方向の後ろにいる）
  const fx = -Math.sin(cy), fz = -Math.cos(cy);
  // 画面の右方向（カメラの右）= (-fz, fx)
  const rx = -fz, rz = fx;
  const ax = fx * Input.my + rx * Input.mx;
  const az = fz * Input.my + rz * Input.mx;
  const l = Math.hypot(ax, az) || 1;
  inp.m = m; inp.ax = ax / l; inp.az = az / l;
  return inp;
}
// 古い名前でも呼べるように
function inputDir() { return readInputDir(); }

function doJump(vy, name) {
  P.vy = vy;
  P.grounded = false;
  P.groundS = null;
  P.state = 'air';
  P.airT = 0;
  P.jumpHeld = true;
  P.jumpBuf = 0; P.coyote = 0;
  P.squash = 1.35;
  P.skidT = 0; P.slideT = 0; P.poundT = 0;
  P.fallFrom = P.y;
  Sound.play(name);
  Fx.dust(P.x, P.y, P.z, 6);
}

function setVelFromYaw() {
  P.vx = Math.sin(P.yaw) * P.speed;
  P.vz = Math.cos(P.yaw) * P.speed;
}

// 足元の坂の傾き（進む向きに対して）。上りがプラス
function slopeAhead() {
  const s = P.groundS;
  if (!s || !s.ramp) return 0;
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
  const x0 = clamp(P.x, s.x0, s.x1), z0 = clamp(P.z, s.z0, s.z1);
  const x1 = clamp(P.x + fx * 0.5, s.x0, s.x1), z1 = clamp(P.z + fz * 0.5, s.z0, s.z1);
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (d < 1e-3) return 0;
  return (topAt(s, x1, z1) - topAt(s, x0, z0)) / d;
}

// 坂の「下り方向」（ワールド）。平らなら null
const downhill = { x: 0, z: 0, k: 0 };
function rampDownhill(s) {
  if (!s || !s.ramp) return null;
  const r = s.ramp;
  const len = r.axis === 'x' ? s.x1 - s.x0 : s.z1 - s.z0;
  const k = (r.b - r.a) / len; // 軸の正方向に進んだときの上がり方
  if (Math.abs(k) < 0.05) return null;
  downhill.x = r.axis === 'x' ? -Math.sign(k) : 0;
  downhill.z = r.axis === 'z' ? -Math.sign(k) : 0;
  downhill.k = Math.abs(k);
  return downhill;
}

function startPunch() {
  P.state = 'punch'; P.stateT = 0; P.punchHit = false;
  P.punchN = 1;
  Sound.play('punch');
  if (P.speed > 5) P.speed += 2;
  P.attackBuf = 0;
}

function updatePlayer(dt) {
  P.stateT += dt;
  P.inv = Math.max(0, P.inv - dt);
  P.squash = lerp(P.squash, 1, 1 - Math.exp(-dt * 12));
  // 先行入力を覚える
  if (Input.jumpP) P.jumpBuf = PL.BUFFER; else P.jumpBuf = Math.max(0, P.jumpBuf - dt);
  if (Input.attackP) P.attackBuf = 0.12; else P.attackBuf = Math.max(0, P.attackBuf - dt);
  if (!Input.jump) P.jumpHeld = false;

  if (P.state === 'dead') {
    P.vy -= PL.GRAV * 0.6 * dt;
    P.y += P.vy * dt;
    P.flip += dt * 6;
    return;
  }
  if (P.state === 'win') {
    P.vx = P.vz = 0; P.speed = 0;
    P.anim += dt * 6;
    P.jumpBuf = 0;
    return;
  }

  readInputDir();
  const onGround = P.grounded;

  // 動く足場に乗っていたら一緒に動く
  if (onGround && P.groundS) {
    P.x += P.groundS.dx; P.y += P.groundS.dy; P.z += P.groundS.dz;
    if (P.groundS.rotY) {
      const s = P.groundS, c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
      const rx = P.x - s.cx, rz = P.z - s.cz;
      P.x = s.cx + rx * c + rz * sn; P.z = s.cz - rx * sn + rz * c;
      P.yaw += s.rotY;
    }
  }

  P.crouching = onGround && Input.crouch && P.state === 'ground' && P.skidT <= 0;
  P.wallSlide = false;

  // ---------- 地上 ----------
  if (P.state === 'ground') {
    P.landT += dt;
    P.poundT = Math.max(0, P.poundT - dt);
    const ice = P.groundS && P.groundS.kind === 'ice';
    P.slope = slopeAhead();

    if (P.skidT > 0) {
      // 切り返しブレーキ：前を向いたまま急停止。この間にジャンプで「くるりんジャンプ」
      P.skidT -= dt;
      P.speed = approach(P.speed, 0, PL.DEC * 2.2 * dt);
      if (Math.random() < dt * 40) Fx.skid(P.x, P.y, P.z);
      if (P.skidT <= 0 || P.speed <= 0.5) {
        P.skidT = 0;
        P.yaw = P.skidYaw;
        P.speed = Math.min(P.speed, 1.5);
      }
      setVelFromYaw();
    } else if (ice) {
      groundIce(dt);
    } else {
      groundNormal(dt);
    }
    P.anim += dt * (2 + Math.abs(P.speed) * 1.5);
    // 足音（左右の足が着くたび）
    if (P.speed > 1.2 && !P.crouching) {
      const ph = Math.floor(P.anim / Math.PI);
      if (ph !== P.stepPh) { P.stepPh = ph; Sound.play('step', clamp(P.speed / PL.RUN, 0.4, 1)); }
    }
    if (P.speed > 7 && Math.random() < dt * 10) Fx.dust(P.x, P.y, P.z, 1);

    if (P.jumpBuf > 0) groundJump();
    else if (P.attackBuf > 0 && P.skidT <= 0) startPunch();
  }
  // ---------- パンチ（3回まで続けられる。3回目はまわしげり） ----------
  else if (P.state === 'punch') {
    P.speed = approach(P.speed, 0, (P.punchN === 3 ? 10 : 14) * dt);
    if (inp.m > 0 && P.stateT < 0.1) {
      // 出だしだけ少し向きを変えられる
      const want = Math.atan2(inp.ax, inp.az);
      P.yaw += clamp(angDiff(P.yaw, want), -PL.TURN * dt, PL.TURN * dt);
    }
    setVelFromYaw();
    P.anim += dt * 4;
    const len = P.punchN === 3 ? 0.42 : 0.32;
    if (P.attackBuf > 0 && P.stateT > 0.1 && P.punchN < 3) {
      P.punchN++;
      P.stateT = 0; P.punchHit = false; P.attackBuf = 0;
      if (P.punchN === 3) {
        P.kickT = 0.32; P.speed = Math.max(P.speed, 0) + 3; P.flip = 0; Sound.play('kick');
      } else { P.speed = Math.max(P.speed, 0) + 1.5; Sound.play('punch2'); }
    } else if (P.stateT > len) { P.state = 'ground'; P.punchN = 0; }
    if (P.jumpBuf > 0 && P.grounded) { P.state = 'ground'; P.punchN = 0; groundJump(); }
  }
  // ---------- 空中 ----------
  else if (P.state === 'air' || P.state === 'hurt') {
    P.airT += dt;
    P.coyote = Math.max(0, P.coyote - dt);
    if (P.state === 'air') airControl(dt);
    if (P.flip) P.flip += dt * (P.sideFlip ? 11 : 9.5) * P.flipDir;
    let g = PL.GRAV;
    if (P.state === 'air' && !P.jumpHeld && P.vy > 4 && !P.flip && !P.longJump) g *= 2.2; // 早く離すと低く
    P.vy = Math.max(P.vy - g * dt, -PL.MAXFALL);
    if (P.wallSlide && P.vy < -PL.WALL_SLIDE) P.vy = approach(P.vy, -PL.WALL_SLIDE, 120 * dt);
    if (P.y > P.fallFrom) P.fallFrom = P.y;
  }
  // ---------- ヒップドロップ ----------
  else if (P.state === 'pound') {
    if (P.stateT < 0.24) { P.vy = 0; P.flip = (P.stateT / 0.24) * TAU; P.squash = 0.9; }
    else { P.flip = 0; P.vy = -32; }
    P.vx = P.vz = 0;
  }

  P.kickT = Math.max(0, P.kickT - dt);

  moveAndCollide(dt);

  // 安全な位置を記録（落下したときの復帰用）
  if (P.grounded && P.groundS && !P.groundS.dx && !P.groundS.dz && !P.groundS.dy && P.groundS.kind !== 'lava' && !P.groundS.noSafe) {
    P.safeT += dt;
    if (P.safeT > 0.3) { P.safe[0] = P.x; P.safe[1] = P.y; P.safe[2] = P.z; }
  } else P.safeT = 0;

  if (P.y < World.killY) Game.onFall();
}

// 地上のふつうの走り
function groundNormal(dt) {
  let slideDown = null;
  // しゃがんだまま坂にいると、すべり降りる
  if (P.crouching) slideDown = rampDownhill(P.groundS);
  if (slideDown && slideDown.k > 0.2) {
    const want = Math.atan2(slideDown.x, slideDown.z);
    P.yaw += clamp(angDiff(P.yaw, want), -6 * dt, 6 * dt);
    P.speed = Math.min(P.speed + 22 * slideDown.k * dt, PL.RUN * 1.3);
    if (Math.random() < dt * 20) Fx.dust(P.x, P.y, P.z, 1);
    setVelFromYaw();
    return;
  }
  if (P.slideT > 0) {
    // ダイブ着地後のおなかすべり
    P.slideT -= dt;
    P.speed = approach(P.speed, 0, 12 * dt);
    if (Math.random() < dt * 25) Fx.skid(P.x, P.y, P.z);
    setVelFromYaw();
    return;
  }
  if (inp.m > 0) {
    let target = P.crouching ? PL.WALK * 0.35 * inp.m : lerp(PL.WALK * 0.5, PL.RUN, smooth(inp.m)) * (inp.m > 0.15 ? 1 : 0.4);
    // 坂：上りは少し遅く、下りは少し速く
    if (P.slope > 0.05) target *= 1 - Math.min(0.35, P.slope * 0.6);
    else if (P.slope < -0.05) target *= 1 + Math.min(0.2, -P.slope * 0.4);
    const want = Math.atan2(inp.ax, inp.az);
    const diff = angDiff(P.yaw, want);
    if (Math.abs(diff) > 2.3 && P.speed > 5.5 && !P.crouching) {
      // 急な切り返し：ブレーキ（スキッド）
      P.skidT = 0.32; P.skidYaw = want;
      Sound.play('skid');
      Fx.dust(P.x, P.y, P.z, 3);
    } else {
      // 速いほど曲がりにくいが、止まっているときはすぐ向く
      const turn = PL.TURN * dt * (P.speed > 7 ? 0.75 : P.speed < 1.5 ? 2 : 1);
      P.yaw += clamp(diff, -turn, turn);
      // 大きく曲がっている間は少しだけ減速（曲がりやすく）
      if (Math.abs(diff) > 1.2 && P.speed > 4) target = Math.min(target, P.speed - 4 * dt);
      // 動き出しはすぐに歩きの速さへ
      if (P.speed < PL.WALK * 0.5 * inp.m && target > P.speed) P.speed = Math.max(P.speed, Math.min(target, PL.WALK * 0.5 * inp.m));
      P.speed = approach(P.speed, target, (target > P.speed ? PL.ACC : PL.DEC) * dt);
    }
  } else {
    P.speed = approach(P.speed, 0, PL.DEC * dt);
  }
  setVelFromYaw();
}

// 氷の上：勢い（速度ベクトル）が残り、ゆっくりしか変わらない
function groundIce(dt) {
  let tx = 0, tz = 0;
  if (inp.m > 0) {
    const sp = lerp(PL.WALK * 0.5, PL.RUN * 1.1, smooth(inp.m));
    tx = inp.ax * sp; tz = inp.az * sp;
    const want = Math.atan2(inp.ax, inp.az);
    P.yaw += clamp(angDiff(P.yaw, want), -PL.TURN * 0.6 * dt, PL.TURN * 0.6 * dt);
  }
  const k = (inp.m > 0 ? PL.ICE_ACC : PL.ICE_DEC) * dt;
  const dx = tx - P.vx, dz = tz - P.vz, d = Math.hypot(dx, dz);
  if (d > k) { P.vx += (dx / d) * k; P.vz += (dz / d) * k; } else { P.vx = tx; P.vz = tz; }
  // speed は「向き方向の速さ」としておく（見た目・ジャンプ用）
  const v = Math.hypot(P.vx, P.vz);
  P.speed = v * Math.max(0, Math.cos(angDiff(P.yaw, Math.atan2(P.vx, P.vz))));
  if (v > 4 && Math.abs(angDiff(P.yaw, Math.atan2(P.vx, P.vz))) > 1 && Math.random() < dt * 15) Fx.skid(P.x, P.y, P.z);
}

// 地上（またはコヨーテ時間中）のジャンプ。技の分かれ道
function groundJump() {
  const ice = P.groundS && P.groundS.kind === 'ice';
  if (ice) {
    // 氷の上では、すべっている向きに跳ぶ
    const v = Math.hypot(P.vx, P.vz);
    if (v > 1) { P.yaw = Math.atan2(P.vx, P.vz); P.speed = v; }
  }
  P.sideFlip = false; P.dive = false;
  if (P.skidT > 0) {
    // くるりんジャンプ（切り返しの途中で跳ぶと、くるっと向きを変えて高く跳ぶ）
    P.yaw = P.skidYaw;
    P.speed = 3.5;
    setVelFromYaw();
    doJump(PL.SIDE_V, 'flip');
    P.flip = 0.001; P.flipDir = -1; P.sideFlip = true;
    P.jumpN = 0;
    Fx.burst(P.x, P.y + 0.3, P.z, [1, 1, 1], 8, 4);
  } else if (P.poundT > 0) {
    // ヒップドロップ着地のすぐ後のジャンプ：高く跳ねる
    P.speed = Math.min(P.speed, 2);
    setVelFromYaw();
    doJump(PL.POUNDJUMP_V, 'jump3');
    P.flip = 0.001; P.flipDir = 1;
    P.jumpN = 0;
  } else if (P.crouching && P.speed > 4.5) {
    // 幅とび
    P.speed = Math.max(P.speed, 8) * PL.LONG_MUL;
    setVelFromYaw();
    doJump(PL.LONG_V, 'longjump');
    P.longJump = true;
    P.jumpN = 0;
  } else if (P.crouching) {
    // バク宙
    P.speed = -4;
    setVelFromYaw();
    doJump(PL.BACK_V, 'flip');
    P.flip = 0.001; P.flipDir = -1;
    P.jumpN = 0;
  } else {
    const chain = P.landT < PL.CHAIN_WIN && P.speed > 3 && P.jumpN > 0 && P.jumpN < 3;
    P.jumpN = chain ? P.jumpN + 1 : 1;
    if (P.jumpN === 3 && P.speed < 6) P.jumpN = 1;
    const vy = [0, PL.J1, PL.J2, PL.J3][P.jumpN] + Math.max(0, P.speed) * 0.12;
    doJump(vy, ['', 'jump', 'jump2', 'jump3'][P.jumpN]);
    if (P.jumpN === 3) { P.flip = 0.001; P.flipDir = 1; }
  }
}

// 空中での操作
function airControl(dt) {
  // コヨーテジャンプ（崖から出た直後）
  if (P.jumpBuf > 0 && P.coyote > 0) {
    P.state = 'ground'; P.landT = 1; P.crouching = false;
    groundJump();
    return;
  }
  if (inp.m > 0 && !P.longJump && !P.dive) {
    const fwd = Math.sin(P.yaw) * inp.ax + Math.cos(P.yaw) * inp.az;
    const side = Math.cos(P.yaw) * inp.ax - Math.sin(P.yaw) * inp.az;
    P.speed = approach(P.speed, PL.RUN * Math.max(0.35, fwd) * inp.m, PL.AIR_ACC * dt * (fwd < 0 ? 1.6 : 1));
    P.yaw += side * dt * 2.4 * (P.flip ? 0.3 : 1);
  } else if (inp.m > 0) {
    const side = Math.cos(P.yaw) * inp.ax - Math.sin(P.yaw) * inp.az;
    P.yaw += side * dt * 1.2;
  }
  setVelFromYaw();

  // 壁にくっついて落ちるときは少しゆっくり（壁キックしやすく）
  if (P.wall && P.wallT < 0.05 && P.vy < 0 && inp.m > 0) {
    const into = -(inp.ax * P.wall.nx + inp.az * P.wall.nz);
    if (into > 0.3) {
      P.wallSlide = true;
      if (Math.random() < 0.3) Fx.skid(P.x - P.wall.nx * 0.4, P.y + 0.6, P.z - P.wall.nz * 0.4);
    }
  }

  if (P.wall && P.wallT < PL.WALL_WIN && P.jumpBuf > 0 && P.airT > 0.04) {
    // 壁キック
    const w = P.wall;
    P.yaw = Math.atan2(w.nx, w.nz);
    P.speed = PL.WALLKICK_H;
    setVelFromYaw();
    doJump(PL.WALLKICK_V, 'wall');
    P.jumpN = 0; P.longJump = false; P.dive = false; P.flip = 0; P.sideFlip = false;
    P.squash = 0.8;
    Fx.burst(P.x - w.nx * 0.4, P.y + 0.9, P.z - w.nz * 0.4, [1, 1, 1], 8, 3);
    P.wall = null;
    Game.shake = Math.max(Game.shake, 0.06);
  } else if (Input.crouchP && P.airT > 0.04) {
    // ヒップドロップ
    P.state = 'pound'; P.stateT = 0;
    P.vx = P.vz = 0; P.speed = 0; P.vy = 0; P.flip = 0;
    P.longJump = false; P.dive = false; P.sideFlip = false;
    Sound.play('poundSpin');
  } else if (P.attackBuf > 0 && P.airT > 0.05 && !P.longJump && !P.dive) {
    P.attackBuf = 0;
    if (P.speed > 6.5 && !P.flip) {
      // ダイブ（前へ飛びこむ）
      P.dive = true; P.longJump = true;
      P.speed = Math.min(Math.max(P.speed + 3, 11), 13);
      P.vy = Math.max(P.vy, 5);
      P.kickT = 0.35; P.punchHit = false;
      setVelFromYaw();
      Sound.play('longjump');
    } else {
      // 空中キック（少し浮く）
      P.vy = Math.max(P.vy, 4);
      P.punchHit = false;
      P.kickT = 0.3;
      Sound.play('kick');
    }
  }
}

function moveAndCollide(dt) {
  const prevY = P.y;
  const steps = 3;
  const h = dt / steps;
  let wall = null;
  for (let i = 0; i < steps; i++) {
    P.x += P.vx * h;
    P.z += P.vz * h;
    const w = pushOutXZ(P);
    if (w) wall = w;
  }
  // 壁に当たったら速度を壁沿いに
  if (wall) {
    const vn = P.vx * wall.nx + P.vz * wall.nz;
    if (vn < 0) {
      if (P.state === 'ground' && P.speed > 6 && vn < -6 && Math.abs(vn) > P.speed * 0.85) {
        // 走って壁に正面衝突：はね返る
        P.speed = -3; Sound.play('land', 0.8); Game.shake = 0.12; P.skidT = 0;
      }
      P.vx -= vn * wall.nx; P.vz -= vn * wall.nz;
      if (P.state !== 'ground') {
        const along = Math.hypot(P.vx, P.vz);
        if (P.state === 'air') P.speed = Math.min(P.speed, along + 1);
        if (P.dive) { P.dive = false; P.longJump = false; P.speed = -2; P.vy = Math.min(P.vy, 2); }
      }
    }
    if (!P.grounded && P.state === 'air' && P.vy < 6) { P.wall = wall; P.wallT = 0; }
  }
  if (P.wall) { P.wallT += dt; if (P.wallT > PL.WALL_WIN) P.wall = null; }

  // 縦方向
  if (P.grounded) {
    const g = groundBelow(P.x, P.z, P.y + STEP_H, P.r * 0.5);
    if (g && P.y - g.y <= 0.5 && P.vy <= 0) {
      P.y = g.y; P.groundS = g.s; P.vy = 0;
    } else {
      // 足場から出た：コヨーテ時間のはじまり
      P.grounded = false; P.groundS = null;
      if (P.state === 'ground' || P.state === 'punch') {
        P.coyote = P.skidT > 0 || P.slideT > 0 ? 0.05 : PL.COYOTE;
        P.state = 'air'; P.airT = 0; P.jumpHeld = false;
        P.skidT = 0; P.slideT = 0; P.punchN = 0;
        P.fallFrom = P.y;
        if (P.speed < 0) P.speed *= 0.5;
      }
      P.vy = Math.min(P.vy, 0);
    }
  } else {
    const ny = P.y + P.vy * dt;
    if (P.vy > 0) {
      const c = ceilingAbove(P.x, P.z, P.y + P.h, ny + P.h, P.r * 0.3);
      if (c !== null) { P.y = c - P.h; P.vy = -1; Sound.play('land', 0.5); }
      else P.y = ny;
    } else {
      const g = groundBelow(P.x, P.z, prevY + 0.05, P.r * 0.5);
      if (g && ny <= g.y) { P.y = g.y; landOn(g.s); }
      else P.y = ny;
    }
  }
}

function landOn(s) {
  const fallV = P.vy;
  const drop = P.fallFrom - P.y;
  P.grounded = true; P.groundS = s; P.vy = 0;
  P.landT = 0; P.flip = 0; P.wall = null; P.coyote = 0;
  P.sideFlip = false;
  P.squash = clamp(1 + fallV * 0.012, 0.6, 0.85);
  P.fallFrom = P.y;
  if (s.kind === 'spring') {
    P.state = 'air'; P.grounded = false; P.groundS = null;
    P.vy = 27; P.airT = 0; P.jumpHeld = true; P.flip = 0.001; P.flipDir = 1;
    P.longJump = false; P.dive = false;
    s.boing = 1;
    Sound.play('spring');
    return;
  }
  if (s.kind === 'lava') {
    playerHurt(P.x + Math.sin(P.yaw), P.z + Math.cos(P.yaw));
    P.vy = 16; P.grounded = false; P.groundS = null; P.state = 'hurt';
    return;
  }
  if (P.state === 'pound') {
    Sound.play('pound');
    Game.shake = 0.3;
    Fx.ring(P.x, P.y + 0.05, P.z);
    Fx.dust(P.x, P.y, P.z, 14);
    Game.onPound(P.x, P.y, P.z);
    P.state = 'ground'; P.speed = 0; P.landT = 1;
    P.stateT = 0;
    P.poundT = 0.28; // この間にジャンプすると高く跳ねる
    P.squash = 0.55;
    return;
  }
  if (P.dive) {
    // ダイブの着地：おなかですべる
    P.dive = false; P.longJump = false;
    P.slideT = 0.4; P.speed = Math.min(P.speed, 10);
    Sound.play('land', 0.8);
    Fx.dust(P.x, P.y, P.z, 6);
  }
  if (P.longJump) { P.speed *= 0.45; P.longJump = false; }
  if (P.state === 'hurt') { P.speed = 0; P.vx = P.vz = 0; }
  if (fallV < -8) {
    Sound.play('land', clamp(-fallV / 30, 0.35, 1));
    Fx.dust(P.x, P.y, P.z, fallV < -22 ? 9 : 5);
  }
  if (fallV < -30 || drop > 9) { Game.shake = Math.max(Game.shake, 0.15); P.squash = 0.6; }
  P.state = 'ground';
  P.speed = Math.max(0, P.speed);
  P.skidT = 0;
}
