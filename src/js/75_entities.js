// アイテム・敵の動き
function updateEntities(dt) {
  const px = P.x, py = P.y + 0.65, pz = P.z;
  const alive = P.state !== 'dead' && P.state !== 'win';

  // どんぐり
  for (const a of Level.acorns) {
    if (a.got) continue;
    a.t += dt * 3;
    if (alive && Math.abs(a.x - px) < 1 && Math.abs(a.z - pz) < 1 && Math.abs(a.y - py) < 1.2) {
      const d = Math.hypot(a.x - px, a.y - py, a.z - pz);
      if (d < 1.05) {
        a.got = true;
        Game.acorns++;
        Sound.play('acorn');
        Fx.burst(a.x, a.y, a.z, [1, 0.85, 0.4], 6, 3);
        if (Game.acorns === 50) Game.revealSeed(5);
      }
    }
  }
  // ハート
  for (const h of Level.hearts) {
    if (h.got) continue;
    h.t += dt * 2;
    if (alive && Math.hypot(h.x - px, h.y - py, h.z - pz) < 1.2) {
      h.got = true;
      P.hp = P.maxHp;
      Sound.play('heart');
      Fx.burst(h.x, h.y, h.z, COL.heart, 10, 4);
      Game.toast('ハートで元気いっぱい！');
    }
  }
  // ひかりの種
  for (const s of Level.seeds) {
    if (s.got || s.hidden) continue;
    s.t += dt;
    if (Math.random() < dt * 8) Fx.sparkle(s.x, s.y + 0.7, s.z, [0.8, 1, 0.95]);
    if (alive && Math.hypot(s.x - px, s.y + 0.6 - py, s.z - pz) < 1.5) {
      s.got = true;
      Game.getSeed(s);
    }
  }

  // 敵
  for (const e of Level.enemies) {
    if (!e.alive) {
      e.deadT = (e.deadT || 0) + dt;
      continue;
    }
    if (e.type === 'blob') updateBlob(e, dt);
    else if (e.type === 'spiky') updateSpiky(e, dt);
  }
}

function updateBlob(e, dt) {
  e.t += dt;
  e.squish = lerp(e.squish, 1, dt * 8);
  const dx = P.x - e.x, dz = P.z - e.z;
  const dist = Math.hypot(dx, dz);
  const dy = P.y - e.y;
  // 見つけたら追いかける
  const chase = dist < 9 && Math.abs(dy) < 3 && P.state !== 'dead';
  let speed = 1.6;
  let want = e.yaw;
  if (chase) {
    want = Math.atan2(dx, dz);
    speed = 3.6;
    if (e.state !== 'chase') { e.state = 'chase'; e.vy = 5; e.squish = 1.3; }
  } else {
    e.state = 'walk';
    const hx = e.hx - e.x, hz = e.hz - e.z;
    if (Math.hypot(hx, hz) > e.range) want = Math.atan2(hx, hz);
    else if (Math.sin(e.t * 0.7) > 0.95) want = e.yaw + 0.05;
  }
  e.yaw += clamp(angDiff(e.yaw, want), -dt * 4, dt * 4);
  const nx = e.x + Math.sin(e.yaw) * speed * dt;
  const nz = e.z + Math.cos(e.yaw) * speed * dt;
  // 崖から落ちないように：進む先に地面がなければ止まる
  const gAhead = groundBelow(nx + Math.sin(e.yaw) * 0.6, nz + Math.cos(e.yaw) * 0.6, e.y + 0.5, 0);
  if (gAhead && Math.abs(gAhead.y - e.y) < 0.6) {
    const homeD = Math.hypot(nx - e.hx, nz - e.hz);
    if (homeD < e.range + 6) { e.x = nx; e.z = nz; }
  } else if (!chase) e.yaw += Math.PI * 0.5;
  // 重力
  e.vy -= 30 * dt;
  e.y += e.vy * dt;
  const g = groundBelow(e.x, e.z, e.y + 0.5, 0.3);
  if (g && e.y <= g.y) { e.y = g.y; e.vy = 0; if (g.s.dx || g.s.dz || g.s.dy) { e.x += g.s.dx; e.z += g.s.dz; } }
  if (e.y < World.killY) e.alive = false;
  // 主人公との当たり
  if (P.state === 'dead' || P.inv > 0.0 && P.state === 'hurt') return;
  const r = 0.62 + P.r;
  const pd = Math.hypot(P.x - e.x, P.z - e.z);
  if (pd < r && P.y < e.y + 1.2 && P.y + P.h > e.y) {
    const stomp = (P.vy < 0 && P.y > e.y + 0.55) || P.state === 'pound';
    const hitting = P.state === 'punch' && P.stateT < 0.25 || P.kickT > 0;
    if (stomp) {
      killEnemy(e, 'stomp');
      if (P.state !== 'pound') { P.vy = Input.jump ? 17 : 12; P.state = 'air'; P.jumpHeld = true; P.grounded = false; }
    } else if (hitting) {
      killEnemy(e, 'punch');
    } else if (P.inv <= 0) {
      playerHurt(e.x, e.z);
    }
  } else if (pd < r + 0.9 && P.state === 'punch' && P.stateT < 0.25) {
    // パンチは少し先まで届く
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    if ((e.x - P.x) * fx + (e.z - P.z) * fz > 0 && Math.abs(P.y - e.y) < 1.2) killEnemy(e, 'punch');
  }
}

function killEnemy(e, how) {
  e.alive = false;
  e.deadT = 0;
  e.how = how;
  Sound.play('stomp');
  Fx.burst(e.x, e.y + 0.5, e.z, COL.enemy, 14, 6);
  Game.shake = 0.12;
  // 倒すとどんぐりが出る
  Level.acorns.push({ x: e.x, y: e.y + 0.8, z: e.z, got: false, t: 0, bonus: true });
  Level.acornTotal++;
}

function updateSpiky(e, dt) {
  const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
  e.u += (e.speed / len) * dt * e.dir;
  if (e.u > 1) { e.u = 1; e.dir = -1; }
  if (e.u < 0) { e.u = 0; e.dir = 1; }
  e.x = lerp(e.ax, e.bx, e.u);
  e.z = lerp(e.az, e.bz, e.u);
  const g = groundBelow(e.x, e.z, Math.max(e.ay, e.by) + 2, 0);
  e.y = (g ? g.y : lerp(e.ay, e.by, e.u)) + 0.75;
  e.rot += (e.speed / 0.75) * dt * e.dir;
  e.yaw = Math.atan2(e.bx - e.ax, e.bz - e.az);
  if (P.state === 'dead') return;
  const d = Math.hypot(P.x - e.x, P.y + 0.6 - e.y, P.z - e.z);
  if (d < 0.9 + P.r) playerHurt(e.x, e.z);
}

// ヒップドロップの衝撃：近くの敵を倒す
function poundShock(x, y, z) {
  for (const e of Level.enemies) {
    if (!e.alive || e.type !== 'blob') continue;
    if (Math.hypot(e.x - x, e.z - z) < 2.6 && Math.abs(e.y - y) < 1) killEnemy(e, 'pound');
  }
}

function drawEntities() {
  const t = Game.time;
  for (const a of Level.acorns) {
    if (a.got) continue;
    drawMesh(Models.acorn, T(a.x, a.y + Math.sin(a.t) * 0.12, a.z, 1.2, 1.2, 1.2, a.t * 1.3));
    drawShadow(a.x, a.y, a.z, 0.3, 0.2);
  }
  for (const h of Level.hearts) {
    if (h.got) continue;
    drawMesh(Models.heart, T(h.x, h.y + Math.sin(h.t) * 0.15, h.z, 1.3, 1.3, 1.3, h.t), WHITE, 0.25);
    drawShadow(h.x, h.y, h.z, 0.4, 0.2);
  }
  for (const s of Level.seeds) {
    if (s.got || s.hidden) continue;
    const pulse = 1 + Math.sin(s.t * 4) * 0.06;
    drawMesh(Models.seed, T(s.x, s.y + Math.sin(s.t * 2) * 0.2, s.z, pulse, pulse, pulse, s.t * 1.5), WHITE, 0.55);
    drawShadow(s.x, s.y, s.z, 0.7, 0.25);
  }
  for (const e of Level.enemies) {
    if (!e.alive) {
      if (e.deadT < 0.3 && e.type === 'blob') {
        const k = 1 - e.deadT / 0.3;
        drawMesh(Models.blob, T(e.x, e.y, e.z, 1 + (1 - k) * 0.6, k * 0.3 + 0.05, 1 + (1 - k) * 0.6, e.yaw));
      }
      continue;
    }
    if (e.type === 'blob') {
      const wob = 1 + Math.sin(e.t * (e.state === 'chase' ? 14 : 7)) * 0.06;
      const sq = e.squish * wob;
      drawMesh(Models.blob, T(e.x, e.y, e.z, 1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq), e.yaw));
      drawShadow(e.x, e.y + 0.1, e.z, 0.7);
    } else {
      const m = T(e.x, e.y, e.z, 1, 1, 1, e.yaw);
      M4.rotX(m, e.rot);
      drawMesh(Models.spiky, m);
      drawShadow(e.x, e.y - 0.6, e.z, 0.75);
    }
  }
  void t;
}
