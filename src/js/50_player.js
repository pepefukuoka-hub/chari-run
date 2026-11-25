// 主人公「ころん」の動きと当たり判定
const PL = {
  R: 0.42, H: 1.3,
  GRAV: 40, MAXFALL: 34,
  WALK: 4.2, RUN: 9.2, ACC: 34, DEC: 30, AIR_ACC: 16,
  TURN: 12,
  J1: 13.2, J2: 15.6, J3: 19.5,
  CHAIN_WIN: 0.2,
};

const P = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
  r: PL.R, h: PL.H,
  yaw: 0,            // 向き（+z 方向が 0、反時計回り）
  speed: 0,          // 水平方向の速さ
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
  dust: 0,
};

function playerReset(x, y, z, yaw) {
  Object.assign(P, {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, speed: 0, grounded: true, groundS: null, state: 'ground',
    jumpN: 0, landT: 1, airT: 0, flip: 0, wall: null, wallT: 0, inv: 0, stateT: 0, squash: 1,
    crouching: false, longJump: false,
  });
  P.safe = [x, y, z];
}

function playerHurt(fromX, fromZ, dmg = 1) {
  if (P.inv > 0 || P.state === 'dead' || P.state === 'win') return;
  P.hp -= dmg;
  Sound.play('hurt');
  Fx.burst(P.x, P.y + 0.8, P.z, [1, 0.9, 0.4], 10, 5);
  Game.shake = 0.35;
  if (P.hp <= 0) { playerDie(); return; }
  const dx = P.x - fromX, dz = P.z - fromZ, d = Math.hypot(dx, dz) || 1;
  P.vx = (dx / d) * 8; P.vz = (dz / d) * 8; P.vy = 9;
  P.grounded = false;
  P.state = 'hurt'; P.stateT = 0;
  P.inv = 2.0;
}

function playerDie() {
  P.hp = 0;
  P.state = 'dead'; P.stateT = 0;
  P.vx = P.vz = 0; P.vy = 12;
  Game.onDeath();
}

// 入力方向（カメラ基準）→ ワールド方向
function inputDir() {
  const m = Math.min(1, Math.hypot(Input.mx, Input.my));
  if (m < 0.05) return { m: 0, ax: 0, az: 0 };
  const cy = Cam.yaw;
  // カメラの前（奥）方向 = (-sin, -cos)（カメラは yaw 方向の後ろにいる）
  const fx = -Math.sin(cy), fz = -Math.cos(cy);
  const rx = -fz, rz = fx;
  let ax = fx * Input.my - rx * Input.mx;
  let az = fz * Input.my - rz * Input.mx;
  const l = Math.hypot(ax, az) || 1;
  return { m, ax: ax / l, az: az / l };
}

function doJump(vy, name) {
  P.vy = vy;
  P.grounded = false;
  P.groundS = null;
  P.state = 'air';
  P.airT = 0;
  P.jumpHeld = true;
  P.squash = 1.35;
  Sound.play(name);
  Fx.dust(P.x, P.y, P.z, 6);
}

function updatePlayer(dt) {
  P.stateT += dt;
  P.inv = Math.max(0, P.inv - dt);
  P.squash = lerp(P.squash, 1, 1 - Math.exp(-dt * 12));

  if (P.state === 'dead') {
    P.vy -= PL.GRAV * 0.6 * dt;
    P.y += P.vy * dt;
    P.flip += dt * 6;
    return;
  }
  if (P.state === 'win') {
    P.vx = P.vz = 0;
    P.anim += dt * 6;
    return;
  }

  const inp = inputDir();
  const onGround = P.grounded;

  // 動く足場に乗っていたら一緒に動く
  if (onGround && P.groundS) {
    P.x += P.groundS.dx; P.y += P.groundS.dy; P.z += P.groundS.dz;
    if (P.groundS.rotY) {
      const s = P.groundS, c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
      const rx = P.x - s.cx, rz = P.z - s.cz;
      P.x = s.cx + rx * c + rz * sn; P.z = s.cz - rx * sn + rz * c;
      P.yaw -= s.rotY;
    }
  }

  P.crouching = onGround && Input.crouch && (P.state === 'ground');

  // ---------- 地上 ----------
  if (P.state === 'ground') {
    P.landT += dt;
    const ice = P.groundS && P.groundS.kind === 'ice';
    let target = 0;
    if (inp.m > 0) {
      target = P.crouching ? PL.WALK * 0.35 * inp.m : lerp(PL.WALK * 0.5, PL.RUN, smooth(inp.m)) * (inp.m > 0.15 ? 1 : 0.4);
      const want = Math.atan2(inp.ax, inp.az);
      const diff = angDiff(P.yaw, want);
      // 急な切り返しはその場で向きを変える（減速）
      if (Math.abs(diff) > 2.6 && P.speed > 5) {
        P.speed = approach(P.speed, 0, PL.DEC * 2 * dt);
        if (P.speed < 2) P.yaw = want;
        Fx.skid(P.x, P.y, P.z);
      } else {
        const turn = PL.TURN * (ice ? 0.35 : 1) * dt * (P.speed > 7 ? 0.7 : 1);
        P.yaw += clamp(diff, -turn, turn);
        P.speed = approach(P.speed, target, (target > P.speed ? PL.ACC : PL.DEC) * (ice ? 0.25 : 1) * dt);
      }
    } else {
      P.speed = approach(P.speed, 0, PL.DEC * (ice ? 0.15 : 1) * dt);
    }
    P.vx = Math.sin(P.yaw) * P.speed;
    P.vz = Math.cos(P.yaw) * P.speed;
    P.anim += dt * (2 + P.speed * 1.5);
    if (P.speed > 7 && Math.random() < dt * 10) Fx.dust(P.x, P.y, P.z, 1);

    if (Input.jumpP) {
      if (P.crouching && P.speed > 4.5) {
        // 幅とび
        P.speed = Math.max(P.speed, 8) * 1.75;
        P.vx = Math.sin(P.yaw) * P.speed; P.vz = Math.cos(P.yaw) * P.speed;
        doJump(10.5, 'jump2');
        P.longJump = true;
        P.jumpN = 0;
      } else if (P.crouching) {
        // バク宙
        P.speed = -4;
        P.vx = Math.sin(P.yaw) * P.speed; P.vz = Math.cos(P.yaw) * P.speed;
        doJump(20.5, 'jump3');
        P.flip = 0.001; P.flipDir = -1;
        P.jumpN = 0;
      } else {
        const chain = P.landT < PL.CHAIN_WIN && P.speed > 3;
        P.jumpN = chain ? Math.min(P.jumpN + 1, 3) : 1;
        if (P.jumpN === 3 && P.speed < 6) P.jumpN = 1;
        const vy = [0, PL.J1, PL.J2, PL.J3][P.jumpN] + P.speed * 0.12;
        doJump(vy, ['', 'jump', 'jump2', 'jump3'][P.jumpN]);
        if (P.jumpN === 3) { P.flip = 0.001; P.flipDir = 1; }
      }
    } else if (Input.attackP) {
      P.state = 'punch'; P.stateT = 0; P.punchHit = false;
      Sound.play('punch');
      if (P.speed > 5) P.speed += 2;
    }
  }
  // ---------- パンチ ----------
  else if (P.state === 'punch') {
    P.speed = approach(P.speed, 0, 14 * dt);
    P.vx = Math.sin(P.yaw) * P.speed; P.vz = Math.cos(P.yaw) * P.speed;
    if (P.stateT > 0.32) P.state = 'ground';
    if (Input.jumpP && P.grounded) { P.state = 'ground'; doJump(PL.J1, 'jump'); P.jumpN = 1; }
  }
  // ---------- 空中 ----------
  else if (P.state === 'air' || P.state === 'hurt') {
    P.airT += dt;
    if (P.state === 'air') {
      // 空中での制御（向きは少しだけ変わる）
      if (inp.m > 0 && !P.longJump) {
        const fwd = Math.sin(P.yaw) * inp.ax + Math.cos(P.yaw) * inp.az;
        const side = Math.cos(P.yaw) * inp.ax - Math.sin(P.yaw) * inp.az;
        P.speed = approach(P.speed, PL.RUN * Math.max(0.35, fwd) * inp.m, PL.AIR_ACC * dt * (fwd < 0 ? 1.6 : 1));
        P.yaw += side * dt * 2.2 * (P.flip ? 0.3 : 1);
      } else if (inp.m > 0 && P.longJump) {
        const side = Math.cos(P.yaw) * inp.ax - Math.sin(P.yaw) * inp.az;
        P.yaw += side * dt * 1.2;
      }
      P.vx = Math.sin(P.yaw) * P.speed;
      P.vz = Math.cos(P.yaw) * P.speed;
      // ジャンプボタンを早く離すと低く
      if (!Input.jump) P.jumpHeld = false;
      if (!P.jumpHeld && P.vy > 4 && !P.flip) P.vy -= PL.GRAV * 1.2 * dt;
      // 壁キック
      if (P.wall && P.wallT < 0.16 && Input.jumpP && P.airT > 0.05) {
        const w = P.wall;
        P.yaw = Math.atan2(w.nx, w.nz);
        P.speed = 8.5;
        P.vx = w.nx * 8.5; P.vz = w.nz * 8.5;
        doJump(15.5, 'wall');
        P.jumpN = 0; P.longJump = false; P.flip = 0;
        Fx.burst(P.x - w.nx * 0.4, P.y + 0.9, P.z - w.nz * 0.4, [1, 1, 1], 6, 3);
        P.wall = null;
      } else if (Input.crouchP) {
        // ヒップドロップ
        P.state = 'pound'; P.stateT = 0;
        P.vx = P.vz = 0; P.speed = 0; P.vy = 0; P.flip = 0;
        P.longJump = false;
      } else if (Input.attackP && P.airT > 0.05 && !P.longJump) {
        // 空中キック（少し浮く）
        P.vy = Math.max(P.vy, 4);
        P.punchHit = false;
        P.kickT = 0.3;
        Sound.play('punch');
      }
    }
    if (P.flip) P.flip += dt * 9.5 * P.flipDir;
    P.vy = Math.max(P.vy - PL.GRAV * dt, -PL.MAXFALL);
  }
  // ---------- ヒップドロップ ----------
  else if (P.state === 'pound') {
    if (P.stateT < 0.22) { P.vy = 0; P.flip = (P.stateT / 0.22) * TAU; }
    else { P.flip = 0; P.vy = -32; }
  }

  P.kickT = Math.max(0, (P.kickT || 0) - dt);

  moveAndCollide(dt);

  // 安全な位置を記録（落下したときの復帰用）
  if (P.grounded && P.groundS && !P.groundS.dx && !P.groundS.dz && !P.groundS.dy && P.groundS.kind !== 'lava' && !P.groundS.noSafe) {
    P.safeT += dt;
    if (P.safeT > 0.3) P.safe = [P.x, P.y, P.z];
  } else P.safeT = 0;

  if (P.y < World.killY) Game.onFall();
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
        P.speed = -3; Sound.play('land'); Game.shake = 0.12;
      }
      P.vx -= vn * wall.nx; P.vz -= vn * wall.nz;
      if (P.state !== 'ground') {
        const along = Math.hypot(P.vx, P.vz);
        if (P.state === 'air') P.speed = Math.min(P.speed, along + 1);
      }
    }
    if (!P.grounded && (P.state === 'air') && P.vy < 6) { P.wall = wall; P.wallT = 0; }
  }
  if (P.wall) { P.wallT += dt; if (P.wallT > 0.2) P.wall = null; }

  // 縦方向
  if (P.grounded) {
    const g = groundBelow(P.x, P.z, P.y + STEP_H, P.r * 0.5);
    if (g && P.y - g.y <= 0.5 && P.vy <= 0) {
      P.y = g.y; P.groundS = g.s; P.vy = 0;
    } else {
      P.grounded = false; P.groundS = null;
      if (P.state === 'ground' || P.state === 'punch') { P.state = 'air'; P.airT = 0; P.jumpHeld = false; }
      P.vy = Math.max(P.vy, 0) * 0 + Math.min(P.vy, 0);
    }
  } else {
    const ny = P.y + P.vy * dt;
    if (P.vy > 0) {
      const c = ceilingAbove(P.x, P.z, P.y + P.h, ny + P.h, P.r * 0.3);
      if (c !== null) { P.y = c - P.h; P.vy = -1; }
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
  P.grounded = true; P.groundS = s; P.vy = 0;
  P.landT = 0; P.flip = 0; P.wall = null;
  P.squash = 0.7;
  if (s.kind === 'spring') {
    P.state = 'air'; P.grounded = false; P.groundS = null;
    P.vy = 27; P.airT = 0; P.jumpHeld = true; P.flip = 0.001; P.flipDir = 1;
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
    P.stateT = -0.15;
    return;
  }
  if (P.longJump) { P.speed *= 0.45; P.longJump = false; }
  if (P.state === 'hurt') { P.speed = 0; P.vx = P.vz = 0; }
  if (fallV < -8) { Sound.play('land'); Fx.dust(P.x, P.y, P.z, 5); }
  if (fallV < -30) Game.shake = 0.15;
  P.state = 'ground';
  P.speed = Math.max(0, P.speed);
}
