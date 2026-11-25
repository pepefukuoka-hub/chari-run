// ステージ「そよかぜ空島」：当たり判定と見た目を同時に組み立てる
const Level = {
  static: null,     // まとめた地形メッシュ
  water: null,
  clouds: [],
  acorns: [], seeds: [], hearts: [], enemies: [], movers: [], springs: [],
  start: { x: 0, y: 0, z: 16, yaw: Math.PI },
  seedTotal: 0, acornTotal: 0,
  signs: [],
};

function buildLevel() {
  World.clear();
  World.killY = -28;
  Object.assign(Level, { acorns: [], seeds: [], hearts: [], enemies: [], movers: [], springs: [], signs: [], clouds: [] });
  const g = new Geo(0.09);
  const rng = makeRng(20261125);

  // ---------- 部品 ----------
  const grassCol = (p, n) => (n[1] > 0.5 ? mixc(COL.grassDk, COL.grass, 0.5 + 0.5 * Math.sin(p[0] * 3.1 + p[2] * 2.3)) : p[1] > 0.75 ? COL.grassDk : COL.dirt);
  const dirtCol = (p) => mixc(COL.dirtDk, COL.dirt, clamp(p[1], 0, 1));

  function island(x, z, r, top, depth = 7) {
    World.cyl(x, z, r, top - depth * 0.6, top, 'grass');
    g.cyl(T(x, top - 0.7, z, r, 0.7, r), grassCol, 32);
    g.cyl(T(x, top - 0.7 - depth, z, r, depth, r), dirtCol, 32, { bottom: 0.18, top: 0.98, caps: false, flat: true });
  }
  function block(cx, cy, cz, sx, sy, sz, kind = 'grass') {
    const s = World.boxC(cx, cy, cz, sx, sy, sz, kind);
    g.box(T(cx, cy, cz, sx, sy, sz), kindColor(kind, sy));
    return s;
  }
  function kindColor(kind) {
    if (kind === 'stone') return (p, n) => (n[1] > 0.5 ? COL.stone : mixc(COL.stoneDk, COL.stone, p[1] + 0.5));
    if (kind === 'wood') return (p, n) => (n[1] > 0.5 ? COL.wood : COL.woodDk);
    if (kind === 'ice') return (p, n) => (n[1] > 0.5 ? COL.ice : shade(COL.ice, 0.85));
    return (p, n) => (n[1] > 0.5 ? COL.grass : p[1] > 0.3 ? COL.grassDk : COL.dirt);
  }
  function stump(x, z, r, top) {
    World.cyl(x, z, r, top - 30, top, 'wood');
    g.cyl(T(x, top - 30, z, r, 30, r), (p, n) => (n[1] > 0.5 ? mixc(COL.wood, hex(0xe9c08a), 0.5) : COL.woodDk), 18, { flat: true });
    // 年輪
    g.cyl(T(x, top, z, r * 0.6, 0.02, r * 0.6), shade(COL.wood, 0.9), 18);
  }
  function tree(x, y, z, s = 1) {
    World.cyl(x, z, 0.45 * s, y, y + 3.2 * s, 'wood');
    g.cyl(T(x, y, z, 0.35 * s, 3.2 * s, 0.35 * s), COL.trunk, 8, { top: 0.7, flat: true });
    const leaf = (p) => mixc(COL.leafDk, COL.leaf, clamp(p[1] * 0.5 + 0.5, 0, 1));
    g.sphere(T(x, y + 3.6 * s, z, 1.6 * s, 1.4 * s, 1.6 * s), leaf, 10, 7, { flat: true });
    g.sphere(T(x + 0.8 * s, y + 3.0 * s, z + 0.4 * s, 1.0 * s, 0.9 * s, 1.0 * s), leaf, 8, 6, { flat: true });
    g.sphere(T(x - 0.7 * s, y + 3.2 * s, z - 0.5 * s, 1.0 * s, 0.9 * s, 1.0 * s), leaf, 8, 6, { flat: true });
    // 木の上にも乗れる
    World.cyl(x, z, 1.3 * s, y + 4.4 * s, y + 4.9 * s, 'grass').noCam = true;
  }
  function pine(x, y, z, s = 1) {
    World.cyl(x, z, 0.4 * s, y, y + 4 * s, 'wood');
    g.cyl(T(x, y, z, 0.3 * s, 1.2 * s, 0.3 * s), COL.trunk, 6);
    for (let i = 0; i < 3; i++) {
      g.cyl(T(x, y + (1 + i * 1.1) * s, z, (1.6 - i * 0.4) * s, 1.8 * s, (1.6 - i * 0.4) * s), (p) => mixc(COL.leafDk, COL.leaf, p[1]), 8, { top: 0, flat: true });
    }
  }
  function rock(x, y, z, s) {
    World.cyl(x, z, s * 0.9, y - 1, y + s * 0.9, 'stone');
    g.sphere(T(x, y, z, s, s * 0.9, s * 0.95, rng() * 3), (p) => mixc(COL.stoneDk, COL.stone, p[1] * 0.5 + 0.5), 7, 5, { flat: true });
  }
  function flower(x, y, z) {
    const c = [COL.flowerR, COL.flowerY, COL.flowerW][Math.floor(rng() * 3)];
    g.cyl(T(x, y, z, 0.03, 0.35, 0.03), COL.leafDk, 4, { caps: false });
    g.sphere(T(x, y + 0.38, z, 0.12, 0.07, 0.12), c, 6, 4, { flat: true });
    g.sphere(T(x, y + 0.4, z, 0.05, 0.05, 0.05), COL.flowerY, 4, 3);
  }
  function tuft(x, y, z) {
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      g.cyl(T(x + Math.cos(a) * 0.12, y, z + Math.sin(a) * 0.12, 0.07, 0.3 + rng() * 0.2, 0.07, a, (rng() - 0.5) * 0.5), COL.grassDk, 3, { top: 0, flat: true, caps: false });
    }
  }
  function fence(x0, z0, x1, z1, y) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.6));
    const ang = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n);
      g.box(T(x, y + 0.5, z, 0.18, 1, 0.18), COL.woodDk);
    }
    const len = Math.hypot(x1 - x0, z1 - z0);
    g.box(T((x0 + x1) / 2, y + 0.75, (z0 + z1) / 2, 0.1, 0.12, len, ang), COL.wood);
    g.box(T((x0 + x1) / 2, y + 0.4, (z0 + z1) / 2, 0.1, 0.12, len, ang), COL.wood);
    // 柵は低い壁として当たり判定
    const s = World.add({ type: 'box', x0: Math.min(x0, x1) - 0.1, x1: Math.max(x0, x1) + 0.1, z0: Math.min(z0, z1) - 0.1, z1: Math.max(z0, z1) + 0.1, y0: y, y1: y + 0.9, kind: 'wood' });
    s.noCam = true;
  }
  const acornAt = (x, y, z) => Level.acorns.push({ x, y: y + 0.6, z, got: false, t: rng() * TAU });
  const acornLine = (x0, y0, z0, x1, y1, z1, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); acornAt(lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t)); } };
  const acornRing = (x, y, z, r, n) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU; acornAt(x + Math.cos(a) * r, y, z + Math.sin(a) * r); } };
  const seedAt = (id, x, y, z, name, hidden = false) => Level.seeds.push({ id, x, y: y + 1.0, z, name, got: false, hidden, t: 0 });
  const heartAt = (x, y, z) => Level.hearts.push({ x, y: y + 0.8, z, got: false, t: rng() * TAU });
  const blobAt = (x, y, z, range = 5) => Level.enemies.push({ type: 'blob', x, y, z, hx: x, hz: z, range, yaw: rng() * TAU, vy: 0, alive: true, t: rng() * 5, state: 'walk', st: 0, squish: 1 });
  const spikyAt = (ax, ay, az, bx, by, bz, speed = 5) => Level.enemies.push({ type: 'spiky', ax, ay, az, bx, by, bz, speed, u: 0, dir: 1, x: ax, y: ay, z: az, alive: true, rot: 0 });

  // ================= 中央の島（はじまりの草原） =================
  island(0, 0, 28, 0, 10);
  // 小さな池（氷のように滑る… ではなく見た目の水たまり）
  g.cyl(T(9, 0.01, 6, 3.2, 0.02, 2.4), hex(0x6fd0ff), 20);

  // 木と飾り
  tree(-6, 0, 12, 1.0); tree(10, 0, 14, 0.9); tree(16, 0, -4, 1.1); tree(-18, 0, 12, 1.2); tree(20, 0, 8, 0.8);
  pine(-22, 0, -6, 1.1); pine(-17, 0, -15, 0.9); pine(14, 0, -16, 1.0); pine(22, 0, -12, 0.8);
  rock(4, 0, 20, 1.2); rock(-12, 0, 20, 0.9); rock(18, 0, 18, 1.4); rock(-24, 0, 4, 1.0);
  for (let i = 0; i < 90; i++) {
    const a = rng() * TAU, r = 3 + rng() * 23;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z + 16) < 7) continue; // 塔の周り
    if (Math.hypot(x + 12, z + 2) < 6) continue; // 切り株の周り
    if (rng() < 0.45) flower(x, 0, z); else tuft(x, 0, z);
  }
  fence(-4, 24, 4, 24, 0);

  // スタート周りのどんぐり
  acornRing(0, 0, 10, 3, 8);
  acornLine(6, 0, 16, 14, 0, 16, 4);

  // ================= ① 切り株の階段 =================
  {
    const cx = -12, cz = -2;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU * 1.1 + 0.5;
      const r = 4.2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const top = 1.1 + i * 1.15;
      stump(x, z, 1.35 - i * 0.03, top);
      if (i % 2 === 1) acornAt(x, top, z);
    }
    stump(cx, cz, 1.8, 10.8);
    seedAt(0, cx, 10.8, cz, '切り株のてっぺん');
  }

  // ================= ② 風の塔（北） =================
  {
    const cx = 0, cz = -17;
    const H = 24;
    World.boxC(cx, H / 2 - 2, cz, 5, H + 4, 5, 'stone');
    g.box(T(cx, H / 2 - 2, cz, 5, H + 4, 5), (p, n) => (n[1] > 0.5 ? COL.stone : mixc(COL.stoneDk, COL.stone, (Math.floor((p[1] + 0.5) * 16) % 2) * 0.4 + 0.5)));
    // 塔のまわりのらせん足場
    const steps = 15;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU * 1.75 + Math.PI / 2;
      const r = 4.6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = 1.4 + i * 1.45;
      const s = block(x, y - 0.3, z, 2.6, 0.6, 2.6, i % 3 === 2 ? 'wood' : 'stone');
      if (i === 6 || i === 11) blobAt(x, y, z, 0.6);
      else if (i % 2 === 0) acornAt(x, y, z);
      if (i === 9) heartAt(x, y, z);
      s.tower = true;
    }
    // 屋上
    block(cx, H + 0.25, cz, 7, 0.5, 7, 'stone');
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(cx + sx * 3.1, H + 1.2, cz + sz * 3.1, 0.8, 1.4, 0.8, 'stone');
    seedAt(1, cx, H + 0.5, cz, '風の塔の屋上');
    // 塔の下から上がる飛び石（ショートカットなし）
    acornLine(0, 0, -8, 0, 0, -12, 3);
  }

  // ================= ③ 東の浮島（動く足場の先） =================
  {
    // 中央島の端から飛び石
    block(31, 0.5, 0, 3, 1, 3, 'wood');
    block(35.5, 1.6, -1.5, 2.6, 0.8, 2.6, 'wood');
    acornLine(31, 1, 0, 35.5, 2, -1.5, 2);
    // 動く足場（左右）
    const mv = { s: World.boxC(42, 2, -1.5, 3.2, 0.6, 3.2, 'wood'), ax: 39.5, bx: 48.5, axis: 'x', speed: 0.5, t: 0, base: [42, 2, -1.5] };
    Level.movers.push(mv);
    acornLine(41, 3.2, -1.5, 47, 3.2, -1.5, 4);
    block(52, 2.4, -1.5, 3, 0.8, 3, 'wood');
    // 上下に動く足場
    const mv2 = { s: World.boxC(56, 3, 3, 2.8, 0.6, 2.8, 'stone'), axis: 'y', ay: 2.5, by: 7, speed: 0.4, t: 0, base: [56, 3, 3] };
    Level.movers.push(mv2);
    island(64, 4, 10, 7.5, 8);
    tree(68, 7.5, 9, 0.9); pine(70, 7.5, 0, 0.9); rock(60, 7.5, 10, 0.9);
    for (let i = 0; i < 20; i++) { const a = rng() * TAU, r = 2 + rng() * 7; flower(64 + Math.cos(a) * r, 7.5, 4 + Math.sin(a) * r); }
    blobAt(62, 7.5, 2, 4); blobAt(66, 7.5, 6, 4);
    acornRing(64, 7.5, 4, 5, 8);
    // 種は台の上
    block(64, 8.5, 4, 3, 2, 3, 'stone');
    seedAt(2, 64, 9.5, 4, '東の浮島');
    // ばね（帰り道）
    Level.springs.push(World.boxC(58, 7.75, 12, 1.6, 0.5, 1.6, 'spring'));
  }

  // ================= ④ 西の坂道と高台 =================
  {
    // 中央島の西端から坂を上る（-x 方向へ、x=-26 で高さ0 → x=-42 で高さ8）
    const rx0 = -42, rx1 = -26, rz0 = -3, rz1 = 3, ra = 8;
    World.ramp(rx0, rz0, rx1, rz1, -3, 'x', ra, 0, 'grass');
    const len = rx1 - rx0, ang = Math.atan2(ra, len), hyp = Math.hypot(len, ra), th = 4;
    const mx = (rx0 + rx1) / 2, mh = ra / 2;
    g.box(T(mx - Math.sin(ang) * th / 2, mh - Math.cos(ang) * th / 2, 0, hyp + 0.4, th, rz1 - rz0, 0, 0, -ang), kindColor('grass'));
    // 坂の上の踊り場と高台
    block(-46, 6, 0, 8, 4, 6, 'grass');
    island(-54, 0, 8, 8, 9);
    pine(-57, 8, -4, 1); pine(-52, 8, 5, 0.8); rock(-58, 8, 4, 1);
    const rampY = (x) => ra * (rx1 - x) / len;
    spikyAt(-41, rampY(-41), 1.5, -27, rampY(-27), 1.5, 7);
    spikyAt(-27, rampY(-27), -1.5, -41, rampY(-41), -1.5, 6);
    for (let i = 0; i < 6; i++) { const x = lerp(-28, -40, i / 5); acornAt(x, rampY(x), 0); }
    seedAt(3, -55, 8, 0, '西の高台');
    heartAt(-52, 8, -3);
  }

  // ================= ⑤ 南のかべキック谷 =================
  {
    // 橋
    block(0, -0.3, 33, 3, 0.6, 10, 'wood');
    for (let i = 0; i < 6; i++) g.box(T(0, 0.02, 28.5 + i * 1.6, 3, 0.04, 0.12), COL.woodDk);
    island(0, 46, 9, 0, 8);
    // 高い壁2枚（すき間 3m）
    block(-2.6, 7, 46, 1.4, 14, 8, 'stone');
    block(2.6, 7, 46, 1.4, 14, 8, 'stone');
    block(0, 14.4, 46, 6.6, 0.8, 8, 'stone');
    seedAt(4, 0, 14.8, 46, '谷のてっぺん');
    acornLine(0, 1, 39, 0, 8, 46, 5);
    blobAt(4, 0, 51, 3);
    tree(-6, 0, 50, 0.8); tree(6, 0, 41, 0.7);
  }

  // ================= ⑥ どんぐりを 50 個集めると現れる種 =================
  seedAt(5, 0, 0, 4, 'どんぐり 50 こ', true);

  // 中央島の敵
  blobAt(-6, 0, -6, 4);
  blobAt(10, 0, -8, 5);
  blobAt(14, 0, 4, 4);
  // ばね（塔の横から高く飛べる）
  Level.springs.push(World.boxC(6, 0.25, -12, 1.6, 0.5, 1.6, 'spring'));
  heartAt(-3, 0, 18);

  // どんぐりの総数
  Level.acornTotal = Level.acorns.length;
  Level.seedTotal = Level.seeds.length;

  // ばねの見た目は動的に描く。動く足場も同様
  Level.static = g.mesh();
  Level.staticTris = g.pos.length / 9;

  // ---- 動く足場のメッシュ ----
  for (const mv of Level.movers) {
    const s = mv.s;
    const sx = s.x1 - s.x0, sy = s.y1 - s.y0, sz = s.z1 - s.z0;
    mv.mesh = new Geo(0.06).box(T(0, 0, 0, sx, sy, sz), kindColor(s.kind)).mesh();
  }
  Models.spring = (() => {
    const gg = new Geo();
    gg.cyl(T(0, 0, 0, 0.8, 0.15, 0.8), COL.stoneDk, 14);
    for (let i = 0; i < 3; i++) gg.torus(T(0, 0.18 + i * 0.12, 0, 0.55, 1, 0.55), COL.spikeTip, 1, 0.08, 14, 5);
    gg.cyl(T(0, 0.5, 0, 0.8, 0.12, 0.8), hex(0xff5a5a), 14);
    return gg.mesh();
  })();

  // ---- 雲（下の雲海と、遠くの雲）----
  {
    const cg = new Geo(0.04);
    const crng = makeRng(7);
    for (let i = 0; i < 70; i++) {
      const a = crng() * TAU, r = 30 + crng() * 140;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = -22 - crng() * 6;
      const s = 6 + crng() * 10;
      cg.sphere(T(x, y, z, s, s * 0.35, s * 0.8, crng() * 3), (p) => mixc(hex(0xdde8f5), COL.cloud, p[1] * 0.5 + 0.5), 10, 6, { flat: true });
    }
    for (let i = 0; i < 18; i++) {
      const a = crng() * TAU, r = 90 + crng() * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 10 + crng() * 35;
      for (let k = 0; k < 3; k++) {
        const s = 4 + crng() * 5;
        cg.sphere(T(x + (k - 1) * s * 0.9, y + crng() * 2, z, s, s * 0.6, s * 0.7), (p) => mixc(hex(0xe8f0fa), COL.cloud, p[1] * 0.5 + 0.5), 10, 6, { flat: true });
      }
    }
    Level.cloudMesh = cg.mesh();
  }
  // 空（大きな球の内側）
  {
    const sg = new Geo();
    sg.sphere(T(0, 0, 0, -1, 1, 1), (p) => {
      const y = p[1];
      if (y > 0) return mixc(hex(0xbfe4ff), hex(0x4f9ae8), Math.pow(y, 0.7));
      return mixc(hex(0xbfe4ff), hex(0xe9f3ff), Math.min(1, -y * 3));
    }, 24, 14);
    Models.sky = sg.mesh();
  }
}

// 動く足場・ばねなどの更新
function updateLevel(dt) {
  for (const s of World.solids) { s.dx = s.dy = s.dz = 0; }
  for (const mv of Level.movers) {
    mv.t += dt * mv.speed;
    const k = 0.5 - 0.5 * Math.cos(mv.t * Math.PI); // 0〜1 往復
    const s = mv.s;
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, cz = (s.z0 + s.z1) / 2;
    if (mv.axis === 'x') World.move(s, lerp(mv.ax, mv.bx, k) - cx, 0, 0);
    if (mv.axis === 'z') World.move(s, 0, 0, lerp(mv.az, mv.bz, k) - cz);
    if (mv.axis === 'y') World.move(s, 0, lerp(mv.ay, mv.by, k) - cy, 0);
  }
  for (const s of Level.springs) s.boing = Math.max(0, (s.boing || 0) - dt * 3);
}

function drawLevel() {
  // 空
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  drawMesh(Models.sky, T(R.cam[0], R.cam[1], R.cam[2], 300, 300, 300), WHITE, 1, 1);
  gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
  drawMesh(Level.cloudMesh, T(), WHITE, 0.55, 1);
  drawMesh(Level.static, M4.ident());
  for (const mv of Level.movers) {
    const s = mv.s;
    drawMesh(mv.mesh, T((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2));
  }
  for (const s of Level.springs) {
    const b = s.boing || 0;
    drawMesh(Models.spring, T((s.x0 + s.x1) / 2, s.y0, (s.z0 + s.z1) / 2, 1, 1 + Math.sin(b * 12) * b * 0.6, 1));
  }
}
