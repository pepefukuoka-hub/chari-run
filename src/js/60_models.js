// モデル（主人公・アイテム・敵・飾り）と、それを描く関数
const COL = {
  body: hex(0xffa94d), bodyDk: hex(0xe8862a), belly: hex(0xfff1d6),
  scarf: hex(0x2bb3a3), scarfDk: hex(0x1d8c80),
  eye: hex(0x2a1c18), white: [1, 1, 1], cheek: hex(0xff7b8a),
  foot: hex(0x7a4a2c), hand: hex(0xfff1d6),
  grass: hex(0x7cc95a), grassDk: hex(0x5aa645), dirt: hex(0xb4825a), dirtDk: hex(0x8f6444),
  stone: hex(0xb9b3c4), stoneDk: hex(0x8d879a), wood: hex(0xc58b52), woodDk: hex(0x96633a),
  ice: hex(0xbfe9ff), lava: hex(0xff6a2a),
  acorn: hex(0xc98a3e), acornCap: hex(0x7a5230),
  seed: hex(0x9cfff0), seedCore: hex(0xfff7a8),
  leaf: hex(0x58b85a), leafDk: hex(0x3f9a4c), trunk: hex(0x9a6a42),
  flowerR: hex(0xff6b8b), flowerY: hex(0xffe066), flowerW: hex(0xffffff),
  enemy: hex(0x9b7de0), enemyDk: hex(0x6e55b5), spike: hex(0x5b5566), spikeTip: hex(0xeeeeee),
  heart: hex(0xff4f6d), cloud: hex(0xffffff), water: hex(0x5cc8ff),
};

const Models = {};

function buildModels() {
  // ---- ころん本体（足元が原点、前が +z）----
  {
    const g = new Geo();
    const bodyCol = (p, n) => {
      if (n[2] > 0.55 && p[1] < 0.35) return COL.belly; // おなか
      return mixc(COL.bodyDk, COL.body, clamp(p[1] * 0.6 + 0.6, 0, 1));
    };
    g.sphere(T(0, 0.72, 0, 0.56, 0.6, 0.53), bodyCol, 22, 14);
    // 耳（丸い耳）
    for (const sx of [-1, 1]) {
      g.sphere(T(sx * 0.34, 1.22, -0.05, 0.17, 0.2, 0.1, 0, 0, sx * -0.35), COL.body, 12, 8);
      g.sphere(T(sx * 0.34, 1.22, 0.0, 0.1, 0.13, 0.06, 0, 0, sx * -0.35), COL.cheek, 10, 6);
    }
    // 目
    for (const sx of [-1, 1]) {
      g.sphere(T(sx * 0.19, 0.86, 0.45, 0.085, 0.13, 0.06), COL.eye, 10, 8);
      g.sphere(T(sx * 0.17, 0.91, 0.5, 0.03, 0.04, 0.02), COL.white, 6, 4);
      g.sphere(T(sx * 0.33, 0.68, 0.42, 0.08, 0.05, 0.03), COL.cheek, 8, 5);
    }
    // 鼻
    g.sphere(T(0, 0.74, 0.53, 0.05, 0.04, 0.04), COL.eye, 8, 5);
    // マフラー
    g.torus(T(0, 0.42, 0, 1, 1, 1, 0, 0, 0), (p, n) => (n[1] > 0 ? COL.scarf : COL.scarfDk), 0.5, 0.09, 22, 8);
    // しっぽ（丸）
    g.sphere(T(0, 0.38, -0.52, 0.16, 0.16, 0.16), COL.belly, 10, 8);
    Models.body = g.mesh();
  }
  Models.foot = new Geo().sphere(T(0, 0.08, 0.06, 0.15, 0.1, 0.2), COL.foot, 12, 8).mesh();
  Models.hand = new Geo().sphere(T(0, 0, 0, 0.12, 0.12, 0.12), COL.hand, 10, 8).mesh();
  Models.scarfTail = new Geo().box(T(0, -0.18, -0.02, 0.16, 0.36, 0.05), COL.scarf).mesh();

  // ---- どんぐり ----
  {
    const g = new Geo();
    g.sphere(T(0, 0, 0, 0.26, 0.32, 0.26), COL.acorn, 14, 10);
    g.sphere(T(0, 0.17, 0, 0.29, 0.16, 0.29), (p) => (p[1] > 0 ? COL.acornCap : shade(COL.acornCap, 0.8)), 14, 8, { flat: true });
    g.cyl(T(0, 0.28, 0, 0.04, 0.14, 0.04), COL.acornCap, 6);
    Models.acorn = g.mesh();
  }
  // ---- ひかりの種（大きな結晶）----
  {
    const g = new Geo();
    g.cyl(T(0, 0, 0, 0.55, 0.7, 0.55), COL.seed, 6, { bottom: 0.0, top: 1, flat: true, caps: false });
    g.cyl(T(0, 0.7, 0, 0.55, 0.7, 0.55), COL.seed, 6, { bottom: 1, top: 0, flat: true, caps: false });
    g.sphere(T(0, 0.7, 0, 0.22, 0.22, 0.22), COL.seedCore, 8, 6);
    Models.seed = g.mesh();
  }
  // ---- ハート ----
  {
    const g = new Geo();
    g.sphere(T(-0.17, 0.12, 0, 0.22, 0.22, 0.16), COL.heart, 12, 8);
    g.sphere(T(0.17, 0.12, 0, 0.22, 0.22, 0.16), COL.heart, 12, 8);
    g.cyl(T(0, -0.32, 0, 0.32, 0.42, 0.16, 0, 0, 0), COL.heart, 4, { bottom: 0, top: 1, flat: true });
    Models.heart = g.mesh();
  }
  // ---- 敵：もこもこ（踏める）----
  {
    const g = new Geo();
    g.sphere(T(0, 0.55, 0, 0.62, 0.55, 0.62), (p) => mixc(COL.enemyDk, COL.enemy, clamp(p[1] + 0.6, 0, 1)), 16, 10, { flat: true });
    for (const sx of [-1, 1]) {
      g.box(T(sx * 0.22, 0.72, 0.52, 0.12, 0.2, 0.08, 0, 0, sx * 0.4), COL.white);
      g.box(T(sx * 0.2, 0.68, 0.56, 0.06, 0.1, 0.04, 0, 0, sx * 0.4), COL.eye);
      g.box(T(sx * 0.24, 0.9, 0.5, 0.18, 0.05, 0.05, 0, 0, sx * -0.5), COL.eye); // 怒り眉
    }
    g.sphere(T(-0.3, 0.1, 0.1, 0.18, 0.1, 0.24), COL.enemyDk, 8, 6);
    g.sphere(T(0.3, 0.1, 0.1, 0.18, 0.1, 0.24), COL.enemyDk, 8, 6);
    Models.blob = g.mesh();
  }
  // ---- 敵：トゲコロ（踏めない）----
  {
    const g = new Geo();
    g.sphere(T(0, 0, 0, 0.75, 0.75, 0.75), COL.spike, 14, 10, { flat: true });
    const n = 14;
    for (let i = 0; i < n; i++) {
      const th = Math.acos(1 - (2 * (i + 0.5)) / n), ph = i * 2.39996;
      const m = T(0, 0, 0, 1, 1, 1, ph, 0, th);
      M4.translate(m, 0, 0.6, 0);
      M4.scale(m, 0.2, 0.55, 0.2);
      g.cyl(m, (p) => (p[1] > 0.6 ? COL.spikeTip : COL.spike), 5, { top: 0 });
    }
    Models.spiky = g.mesh();
  }
  // ---- 影・粒・輪 ----
  Models.shadow = new Geo().disc(T(), [0, 0, 0], 20).mesh();
  Models.puff = new Geo().sphere(T(), WHITE, 8, 6, { flat: true }).mesh();
  Models.ring = new Geo().torus(T(), WHITE, 1, 0.08, 28, 4).mesh();
  Models.cube = new Geo().box(T(), WHITE).mesh();
  Models.flag = (() => {
    const g = new Geo();
    g.cyl(T(0, 0, 0, 0.08, 3, 0.08), COL.white, 8);
    g.sphere(T(0, 3.05, 0, 0.16, 0.16, 0.16), COL.flowerY, 8, 6);
    return g.mesh();
  })();
  Models.flagCloth = new Geo().box(T(0.5, 2.6, 0, 1, 0.6, 0.05), COL.scarf).mesh();
}

// ころんを描く
function drawPlayer() {
  if (P.inv > 0 && P.state !== 'dead' && Math.floor(P.inv * 14) % 2 === 0) return;
  const m = M4.ident();
  M4.translate(m, P.x, P.y, P.z);
  M4.rotY(m, P.yaw);
  // 回転（宙返り・ヒップドロップ）
  if (P.flip) {
    M4.translate(m, 0, 0.7, 0);
    M4.rotX(m, P.flip);
    M4.translate(m, 0, -0.7, 0);
  }
  // 状態ごとの姿勢
  let lean = 0, bob = 0, sq = P.squash;
  const walk = P.state === 'ground' && P.speed > 0.3;
  if (walk) {
    bob = Math.abs(Math.sin(P.anim)) * 0.08 * clamp(P.speed / 4, 0, 1);
    lean = clamp(P.speed / PL.RUN, 0, 1) * 0.22;
  }
  if (P.longJump) lean = 1.1;
  if (P.state === 'punch') lean = 0.25;
  if (P.crouching) sq = Math.min(sq, 0.72);
  if (P.state === 'dead') { M4.translate(m, 0, 0.7, 0); M4.rotZ(m, P.flip); M4.translate(m, 0, -0.7, 0); }
  M4.translate(m, 0, bob, 0);
  M4.rotX(m, lean);
  const sx = 1 / Math.sqrt(sq);
  M4.scale(m, sx, sq, sx);

  drawMesh(Models.body, m);

  // 足
  const ph = P.anim;
  const air = !P.grounded;
  for (const side of [-1, 1]) {
    const f = M4.copy(m);
    let swing = walk ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 0.5 * clamp(P.speed / 5, 0.3, 1) : 0;
    let lift = walk ? Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI))) * 0.1 : 0;
    if (air) { swing = side * 0.35; lift = 0.12; }
    if (P.state === 'pound') { swing = 0; lift = 0.3; }
    M4.translate(f, side * 0.24, 0.05 + lift, swing * 0.35);
    M4.rotX(f, -swing * 0.6);
    drawMesh(Models.foot, f);
  }
  // 手
  for (const side of [-1, 1]) {
    const hnd = M4.copy(m);
    let fx = side * 0.6, fy = 0.6, fz = 0.05;
    if (walk) fz += Math.sin(ph + (side > 0 ? Math.PI : 0)) * 0.22 * clamp(P.speed / 5, 0.3, 1);
    if (air && P.state !== 'pound') { fy = 0.95; fx = side * 0.66; }
    if (P.state === 'punch') {
      const k = Math.sin(clamp(P.stateT / 0.32, 0, 1) * Math.PI);
      if (side > 0) { fz = 0.1 + k * 0.6; fy = 0.65; fx = 0.3; }
    }
    if (P.kickT > 0 && side > 0) { fz = 0.6; fy = 0.4; }
    if (P.state === 'win') { fy = 1.2 + Math.sin(P.anim) * 0.1; fx = side * 0.55; }
    M4.translate(hnd, fx, fy, fz);
    drawMesh(Models.hand, hnd);
  }
  // マフラーのしっぽ（なびく）
  const sp = Math.hypot(P.vx, P.vz);
  const tail = M4.copy(m);
  M4.translate(tail, 0.18, 0.42, -0.5);
  M4.rotX(tail, -clamp(sp / PL.RUN, 0, 1) * 1.1 - (air ? 0.6 : 0) + Math.sin(Game.time * 12) * 0.12);
  drawMesh(Models.scarfTail, tail);
}

// 丸い影を地面に落とす
function drawShadow(x, y, z, r, a = 0.32) {
  const g = groundBelow(x, z, y + 0.2, 0);
  if (!g) return;
  const h = y - g.y;
  const k = clamp(1 - h / 14, 0.25, 1);
  const m = T(x, g.y + 0.03, z, r * (0.6 + 0.4 * k), 1, r * (0.6 + 0.4 * k));
  drawMesh(Models.shadow, m, [0, 0, 0], 1, a * k);
}

// ---------- 粒子 ----------
const Fx = {
  list: [],
  add(o) { if (this.list.length < 260) this.list.push(o); },
  dust(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 1 + Math.random() * 2;
      this.add({ x: x + Math.cos(a) * 0.3, y: y + 0.1, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * s, life: 0.5, max: 0.5, size: 0.18 + Math.random() * 0.12, col: [0.95, 0.92, 0.85], grav: -2, alpha: 0.8 });
    }
  },
  skid(x, y, z) { if (Math.random() < 0.5) this.dust(x, y, z, 1); },
  burst(x, y, z, col, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.random() * Math.PI - Math.PI / 2, s = sp * (0.5 + Math.random() * 0.7);
      this.add({ x, y, z, vx: Math.cos(a) * Math.cos(b) * s, vy: Math.sin(b) * s + 2, vz: Math.sin(a) * Math.cos(b) * s, life: 0.6, max: 0.6, size: 0.12 + Math.random() * 0.1, col, grav: 10, alpha: 1, emit: 1 });
    }
  },
  sparkle(x, y, z, col) {
    this.add({ x: x + (Math.random() - 0.5), y: y + (Math.random() - 0.5), z: z + (Math.random() - 0.5), vx: 0, vy: 0.8, vz: 0, life: 0.7, max: 0.7, size: 0.1, col, grav: 0, alpha: 1, emit: 1 });
  },
  ring(x, y, z) { this.add({ ring: true, x, y, z, life: 0.4, max: 0.4, size: 0.5, col: [1, 1, 1] }); },
  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      if (p.ring) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  },
  draw() {
    for (const p of this.list) {
      const k = p.life / p.max;
      if (p.ring) {
        const r = p.size + (1 - k) * 3.5;
        drawMesh(Models.ring, T(p.x, p.y, p.z, r, 1, r), p.col, 1, k * 0.8);
      } else {
        const s = p.size * (0.4 + 0.6 * k);
        drawMesh(Models.puff, T(p.x, p.y, p.z, s, s, s), p.col, p.emit ? 1 : 0.3, p.alpha * Math.min(1, k * 2));
      }
    }
  },
};
