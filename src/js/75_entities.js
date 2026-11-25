// アイテム・敵の動き
function updateEntities(dt) {
  const px = P.x, py = P.y + 0.65, pz = P.z;
  const alive = P.state !== 'dead' && P.state !== 'win';

  // 看板：近づくとヒント
  for (const sg of Level.signs) {
    const d = Math.hypot(sg.x - P.x, sg.z - P.z);
    if (sg.armed && alive && d < 2.3 && Math.abs(P.y - sg.y) < 2) {
      sg.armed = false;
      Sound.play('select');
      for (const l of sg.lines) Game.toast(l, 4.5);
    } else if (!sg.armed && d > 6) sg.armed = true;
  }
  // 西の高台：印のついた敵を全部たおすと種
  if (!Level.arenaDone) {
    const arena = Level.enemies.filter((e) => e.arena);
    if (arena.length && arena.every((e) => !e.alive)) {
      Level.arenaDone = true;
      revealSeedMsg(3, '高台の敵を ぜんぶ たおした！ ひかりの種が あらわれた！');
    }
  }

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
    else if (e.type === 'hopper') updateHopper(e, dt);
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
  enemyTouch(e, 0.62, 1.2);
}

// 踏める敵と主人公の当たり（rad: 半径, hgt: 高さ）
function enemyTouch(e, rad, hgt) {
  if (P.state === 'dead' || P.inv > 0.0 && P.state === 'hurt') return;
  const r = rad + P.r;
  const pd = Math.hypot(P.x - e.x, P.z - e.z);
  if (pd < r && P.y < e.y + hgt && P.y + P.h > e.y) {
    const stomp = (P.vy < 0 && P.y > e.y + hgt * 0.45) || P.state === 'pound';
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

// ぴょんまる：止まって力をためて、主人公のほうへぴょんと跳ぶ。崖の外へは跳ばない
function updateHopper(e, dt) {
  e.t += dt;
  e.squish = lerp(e.squish, 1, dt * 8);
  const dx = P.x - e.x, dz = P.z - e.z;
  const dist = Math.hypot(dx, dz);
  const chase = dist < 10 && Math.abs(P.y - e.y) < 3 && P.state !== 'dead';
  if (!e.air) {
    e.st -= dt;
    const want = chase ? Math.atan2(dx, dz) : e.yaw;
    e.yaw += clamp(angDiff(e.yaw, want), -dt * 5, dt * 5);
    if (e.st < 0.25) e.squish = Math.min(e.squish, 0.75); // ためる
    if (e.st <= 0) {
      let yaw = e.yaw;
      const hx = e.hx - e.x, hz = e.hz - e.z;
      if (!chase && Math.hypot(hx, hz) > e.range) yaw = Math.atan2(hx, hz);
      else if (!chase) yaw = e.yaw + (Math.random() - 0.5) * 2.5;
      const hop = chase ? 2.4 : 1.6;
      const lx = e.x + Math.sin(yaw) * hop, lz = e.z + Math.cos(yaw) * hop;
      const gl2 = groundBelow(lx, lz, e.y + 1.0, 0);
      const far = Math.hypot(lx - e.hx, lz - e.hz) > e.range + 4;
      if (gl2 && Math.abs(gl2.y - e.y) < 1.0 && !far) {
        e.yaw = yaw;
        e.air = true; e.vy = 9.5;
        const T2 = (2 * 9.5) / 30;
        e.vx = (Math.sin(yaw) * hop) / T2; e.vz = (Math.cos(yaw) * hop) / T2;
        e.squish = 1.35;
        e.st = 0.7 + Math.random() * 0.6;
      } else {
        e.yaw = Math.atan2(hx, hz) + (Math.random() - 0.5);
        e.st = 0.4;
      }
    }
    const g = groundBelow(e.x, e.z, e.y + 0.5, 0.3);
    if (g) { e.y = g.y; e.x += g.s.dx; e.z += g.s.dz; }
    else { e.air = true; e.vx = e.vz = 0; }
  } else {
    const prevY = e.y;
    e.x += e.vx * dt; e.z += e.vz * dt;
    e.vy -= 30 * dt;
    e.y += e.vy * dt;
    if (e.vy < 0) {
      const g = groundBelow(e.x, e.z, prevY + 0.05, 0.3);
      if (g && e.y <= g.y) { e.y = g.y; e.air = false; e.vx = e.vz = 0; e.squish = 0.6; }
    }
  }
  if (e.y < World.killY) e.alive = false;
  enemyTouch(e, 0.52, 1.1);
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
  if (e.arena) {
    const left = Level.enemies.filter((q) => q.arena && q.alive).length;
    if (left > 0) Game.toast(`高台の敵 のこり ${left} ひき`, 2);
  }
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
  poundStakes(x, y, z);
  for (const e of Level.enemies) {
    if (!e.alive || e.type === 'spiky') continue;
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
      if (e.deadT < 0.3 && e.type !== 'spiky') {
        const k = 1 - e.deadT / 0.3;
        drawMesh(e.type === 'blob' ? Models.blob : Models.hopper, T(e.x, e.y, e.z, 1 + (1 - k) * 0.6, k * 0.3 + 0.05, 1 + (1 - k) * 0.6, e.yaw));
      }
      continue;
    }
    if (e.type === 'hopper') {
      const sq = e.squish;
      drawMesh(Models.hopper, T(e.x, e.y, e.z, 1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq), e.yaw));
      drawShadow(e.x, e.y + 0.1, e.z, 0.6);
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
