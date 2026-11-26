// ステージ「そよかぜ空島」：当たり判定と見た目を同時に組み立てる
//
// 地図（上が北＝ -z、右が東＝ +x）
//   中央：はじまりの草原（半径28、高さ0）。スタートは南側 (0,16)
//   北  ：風の塔（らせん足場 → 落ちる足場 → バク宙で屋上）……… 種1
//   北西：見晴らしの崖と風車（3段ジャンプ）……………………… 種0
//   東  ：動く足場 → 回る橋 → 上下する足場 → 東の浮島 ………… 種2
//   西  ：トゲコロの坂 → 高台（敵を全部たおすと出る）………… 種3
//   南  ：橋 → えんとつ島（えんとつの中を壁キック）…………… 種4
//   中央：どんぐり50こで出る ……………………………………………… 種5
//   南西：幅とびの桟橋 → ちぎれ雲の小島（帰りは風の筒）……… 種6
//   南東：杭3本をヒップドロップ → 雲の飛び石が浮かぶ → 小屋の島 … 種7
//   ひみつ：中央の島の北東のがけ下に小さな足場（どんぐり・ハート・ばね）
const Level = {
  static: null,     // まとめた地形メッシュ
  water: null,
  clouds: [],
  acorns: [], seeds: [], hearts: [], enemies: [], movers: [], springs: [],
  spinners: [], fallers: [], stakes: [], risers: [], launchers: [], mills: [], flags: [],
  start: { x: 0, y: 0, z: 16, yaw: Math.PI },
  seedTotal: 0, acornTotal: 0,
  signs: [],
  stakeDone: false, arenaDone: false,
  _cache: null,     // 2回目以降の組み立てではメッシュを作り直さない
};

// 2回目以降の組み立て用：形状を作らない Geo の代わり
const NOGEO = { box() { return this; }, cyl() { return this; }, sphere() { return this; }, disc() { return this; }, torus() { return this; } };

// ステージの一覧（id の順）。各ステージは defineStage で登録する
//   id, name, killY（落下とみなす高さ）, start（スタート位置）, env（空・霧・光）, music（BGM の調とテンポ）,
//   tint（地形・敵にかける色）, titleCam（タイトル・ステージ選びの背景のカメラ）, unlock（開く条件）, build(K)
//   ending: {seed}（この種を取るとエンディング。74_boss.js）。build の中で Level.hud = 関数(W,H,fs,small) を入れると、遊んでいる間の画面に描ける。
//   Level.hudActive = 関数() が true の間は、HUD を毎フレーム全体で描き直す（ない場合は hud があればいつも）
const STAGES = [];
function defineStage(def) { STAGES[def.id] = def; return def; }

// ステージの空・霧・光を R に入れる（R の中身を書きかえる。10_gl.js が毎フレーム読む）
function applyStageEnv(st) {
  const e = st.env;
  if (!e || typeof R === 'undefined' || !R.sky) return;
  R.sky.top = e.top.slice(); R.sky.bottom = e.bottom.slice(); R.sky.sun = e.sun.slice();
  R.fogCol = e.fogCol.slice(); R.fog = e.fog.slice();
  R.light = v3.norm(e.light.slice());
  const d = ENV_DEFAULT || {};
  R.lightCol = (e.lightCol || d.lightCol || R.lightCol).slice();
  R.ambLo = (e.ambLo || d.ambLo || R.ambLo).slice();
  R.ambHi = (e.ambHi || d.ambHi || R.ambHi).slice();
}

function buildLevel(id) {
  if (id === undefined || id === null) id = Level.stageId || 0;
  const st = STAGES[id] || STAGES[0];
  Level.stageId = st.id; Level.stage = st;
  World.clear();
  World.killY = st.killY;
  Object.assign(Level, {
    acorns: [], seeds: [], hearts: [], enemies: [], movers: [], springs: [], signs: [], clouds: [],
    spinners: [], fallers: [], stakes: [], risers: [], launchers: [], mills: [], flags: [],
    stakeDone: false, arenaDone: false,
    updaters: [], drawers: [], poundHooks: [], acornSeed: null, arenaSeed: null, hud: null, hudActive: null,
    tint: st.tint || WHITE,
    start: Object.assign({}, st.start),
  });
  applyStageEnv(st);
  // 地形メッシュはステージごと、共通の部品（ばね・杭など）は全ステージで使い回す
  const caches = Level._caches || (Level._caches = {});
  const cache = caches[st.id] || (caches[st.id] = {});
  const shared = Level._shared || (Level._shared = {});
  const g = cache.static ? NOGEO : new Geo(0.09);
  const rng = makeRng(st.seed || 20261125);
  const once = (key, make) => shared[key] || (shared[key] = make());
  const onceStage = (key, make) => cache[key] || (cache[key] = make());

  // ---------- 部品 ----------
  const grassCol = (p, n) => (n[1] > 0.5 ? mixc(COL.grassDk, COL.grass, 0.5 + 0.5 * Math.sin(p[0] * 3.1 + p[2] * 2.3)) : p[1] > 0.75 ? COL.grassDk : COL.dirt);
  const dirtCol = (p) => mixc(COL.dirtDk, COL.dirt, clamp(p[1], 0, 1));
  const rockCol = (p) => mixc(COL.stoneDk, COL.stone, clamp(p[1] * 0.8 + 0.2 + 0.15 * Math.sin(p[1] * 9), 0, 1));

  function island(x, z, r, top, depth = 7) {
    World.cyl(x, z, r, top - depth * 0.6, top, 'grass');
    g.cyl(T(x, top - 0.7, z, r, 0.7, r), grassCol, 32);
    g.cyl(T(x, top - 0.7 - depth, z, r, depth, r), dirtCol, 32, { bottom: 0.18, top: 0.98, caps: false, flat: true });
  }
  function kindColor(kind) {
    if (kind === 'stone') return (p, n) => (n[1] > 0.5 ? COL.stone : mixc(COL.stoneDk, COL.stone, p[1] + 0.5));
    if (kind === 'wood') return (p, n) => (n[1] > 0.5 ? COL.wood : COL.woodDk);
    if (kind === 'ice') return (p, n) => (n[1] > 0.5 ? COL.ice : shade(COL.ice, 0.85));
    if (kind === 'cloud') return (p, n) => (n[1] > 0.5 ? COL.cloud : hex(0xd6e4f4));
    if (kind === 'snow') return (p, n) => (n[1] > 0.5 ? hex(0xf4f8ff) : p[1] > 0.3 ? hex(0xdfe8f6) : hex(0x8a8fa8));
    return (p, n) => (n[1] > 0.5 ? COL.grass : p[1] > 0.3 ? COL.grassDk : COL.dirt);
  }
  function block(cx, cy, cz, sx, sy, sz, kind = 'grass') {
    const s = World.boxC(cx, cy, cz, sx, sy, sz, kind);
    g.box(T(cx, cy, cz, sx, sy, sz), kindColor(kind));
    return s;
  }
  // 回転した向きの動かない板（桟橋など）
  function oblock(cx, cz, sx, sz, ang, y0, y1, kind = 'stone') {
    const s = World.obox(cx, cz, sx, sz, ang, y0, y1, kind);
    g.box(T(cx, (y0 + y1) / 2, cz, sx, y1 - y0, sz, ang), kindColor(kind));
    return s;
  }
  function stump(x, z, r, top, depth = 30) {
    World.cyl(x, z, r, top - depth, top, 'wood');
    g.cyl(T(x, top - depth, z, r, depth, r), (p, n) => (n[1] > 0.5 ? mixc(COL.wood, hex(0xe9c08a), 0.5) : COL.woodDk), 18, { flat: true });
    g.cyl(T(x, top, z, r * 0.62, 0.02, r * 0.62), hex(0xd9a86c), 18); // 年輪
    g.cyl(T(x, top + 0.005, z, r * 0.5, 0.02, r * 0.5), hex(0xf0cf98), 18);
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
    return y + 4.9 * s;
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
  // 花と草をまく（avoid: [[x,z,r],...] の中には置かない）
  function scatter(cx, cz, r0, r1, y, n, avoid = []) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = r0 + rng() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const k = rng();
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      if (k < 0.45) flower(x, y, z); else tuft(x, y, z);
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
    // 柵は低い壁として当たり判定（軸にそった柵だけ）
    const s = World.add({ type: 'box', x0: Math.min(x0, x1) - 0.1, x1: Math.max(x0, x1) + 0.1, z0: Math.min(z0, z1) - 0.1, z1: Math.max(z0, z1) + 0.1, y0: y, y1: y + 0.9, kind: 'wood' });
    s.noCam = true;
  }
  // 看板：近づくとヒントが出る
  function sign(x, y, z, yaw, lines) {
    World.cyl(x, z, 0.18, y, y + 1.1, 'wood').noCam = true;
    g.cyl(T(x, y, z, 0.09, 1.25, 0.09), COL.woodDk, 6);
    g.box(T(x, y + 1.3, z, 1.3, 0.8, 0.12, yaw), (p, n) => (Math.abs(n[2]) > 0.5 ? hex(0xf3d7a6) : COL.wood));
    g.box(T(x + Math.sin(yaw) * 0.07, y + 1.38, z + Math.cos(yaw) * 0.07, 0.9, 0.08, 0.02, yaw), COL.woodDk);
    g.box(T(x + Math.sin(yaw) * 0.07, y + 1.2, z + Math.cos(yaw) * 0.07, 0.7, 0.08, 0.02, yaw), COL.woodDk);
    Level.signs.push({ x, y, z, lines, armed: true });
  }
  // 小屋（屋根も坂として乗れる）
  function hut(x, y, z, sx, sz, wall) {
    World.boxC(x, y + 1.1, z, sx, 2.2, sz, 'wood');
    g.box(T(x, y + 1.1, z, sx, 2.2, sz), (p, n) => (n[1] > 0.5 ? COL.woodDk : mixc(hex(0xf2e2c4), hex(0xe6cfa8), (Math.floor((p[0] + p[2] + 1) * 6) % 2))));
    // 扉と窓
    g.box(T(x, y + 0.75, z + sz / 2 + 0.02, 0.8, 1.5, 0.05), COL.woodDk);
    g.box(T(x + sx * 0.3, y + 1.4, z + sz / 2 + 0.02, 0.55, 0.5, 0.05), hex(0x7fd3ff));
    // 屋根（x 方向に山形）
    const hw = sx / 2 + 0.35, rise = 1.1;
    World.ramp(x - hw, z - sz / 2 - 0.3, x, z + sz / 2 + 0.3, y + 2.2 - 0.3, 'x', y + 2.2, y + 2.2 + rise, 'wood').noCam = true;
    World.ramp(x, z - sz / 2 - 0.3, x + hw, z + sz / 2 + 0.3, y + 2.2 - 0.3, 'x', y + 2.2 + rise, y + 2.2, 'wood').noCam = true;
    const ang = Math.atan2(rise, hw), len = Math.hypot(hw, rise);
    const roofC = (p, n) => (n[1] > 0.3 ? (wall || hex(0xe0614a)) : hex(0xa8432f));
    g.box(T(x - hw / 2, y + 2.2 + rise / 2, z, len + 0.1, 0.18, sz + 0.6, 0, 0, ang), roofC);
    g.box(T(x + hw / 2, y + 2.2 + rise / 2, z, len + 0.1, 0.18, sz + 0.6, 0, 0, -ang), roofC);
    // えんとつ
    g.box(T(x + hw * 0.45, y + 3.2, z - sz * 0.2, 0.4, 0.9, 0.4), COL.stone);
  }
  // 旗（ゴールの目印）。布は動的に描く
  function flag(x, y, z, col) {
    World.cyl(x, z, 0.12, y, y + 3.4, 'wood').noCam = true;
    g.cyl(T(x, y, z, 0.07, 3.4, 0.07), COL.white, 8);
    g.sphere(T(x, y + 3.45, z, 0.15, 0.15, 0.15), COL.flowerY, 8, 6);
    Level.flags.push({ x, y: y + 3.25, z, col: col || COL.scarf, t: rng() * 5 });
  }
  // 風車（羽根は動的に描く）。向き yaw に羽根が向く
  function windmill(x, y, z, yaw) {
    World.cyl(x, z, 1.25, y, y + 5, 'stone');
    g.cyl(T(x, y, z, 1.35, 5, 1.35), (p, n) => (n[1] > 0.5 ? COL.stone : mixc(hex(0xf6efe2), hex(0xe2d6c2), (Math.floor(p[1] * 6) % 2))), 12, { top: 0.72, flat: true });
    g.cyl(T(x, y + 5, z, 1.2, 1.4, 1.2), hex(0xd8604a), 12, { top: 0, flat: true });
    g.box(T(x + Math.sin(yaw) * 1.0, y + 1.0, z + Math.cos(yaw) * 1.0, 0.8, 1.6, 0.8, yaw), COL.woodDk);
    Level.mills.push({ x: x + Math.sin(yaw) * 1.25, y: y + 4.6, z: z + Math.cos(yaw) * 1.25, yaw, a: 0 });
  }
  // 動く足場（往復）
  function mover(cx, cy, cz, sx, sy, sz, kind, axis, a, b, speed, t0 = 0) {
    const s = World.boxC(cx, cy, cz, sx, sy, sz, kind);
    s.noSafe = true;
    const mv = { s, axis, speed, t: t0 };
    if (axis === 'x') { mv.ax = a; mv.bx = b; }
    if (axis === 'z') { mv.az = a; mv.bz = b; }
    if (axis === 'y') { mv.ay = a; mv.by = b; }
    Level.movers.push(mv);
    return mv;
  }
  // 回る橋（中心のまわりを回り続ける細長い板）
  function spinner(cx, top, cz, sx, sz, speed, kind = 'wood') {
    const s = World.obox(cx, cz, sx, sz, 0, top - 0.5, top, kind);
    s.noSafe = true; s.noCam = true;
    Level.spinners.push({ s, speed, mesh: null, sx, sz });
    // 軸の飾り
    g.cyl(T(cx, top - 6, cz, 0.35, 5.6, 0.35), COL.stoneDk, 8);
    return s;
  }
  // 乗るとぐらぐらして落ちる足場
  function faller(cx, top, cz, sx, sz) {
    const s = World.boxC(cx, top - 0.3, cz, sx, 0.6, sz, 'wood');
    s.noSafe = true;
    Level.fallers.push({ s, base: s.y0, state: 'idle', t: 0, vy: 0, sx, sz });
    return s;
  }
  // ヒップドロップで打ちこむ杭（地面 y から 0.9 出ている）
  function stake(x, y, z) {
    const s = World.cyl(x, z, 0.55, y - 2, y + 0.9, 'wood');
    s.noCam = true;
    Level.stakes.push({ s, x, z, ground: y, down: false });
    // 杭のまわりの土
    g.cyl(T(x, y + 0.01, z, 0.95, 0.03, 0.95), COL.dirtDk, 12);
  }
  // 杭を全部打つと雲の下から浮かんでくる足場
  function riser(cx, top, cz, sx, sz) {
    const s = World.boxC(cx, top - 0.35 - 30, cz, sx, 0.7, sz, 'cloud');
    s.off = true;
    Level.risers.push({ s, top, t: 0, active: false, sx, sz });
  }
  // 風の筒：乗ると決まった向きへ大きく飛ばされる（帰り道用）
  function launcher(x, y, z, yaw, vy, sp) {
    const s = World.cyl(x, z, 0.95, y - 0.6, y + 0.2, 'stone');
    s.noSafe = true;
    s.launch = { yaw, vy, sp };
    g.cyl(T(x, y - 0.6, z, 1.15, 0.75, 1.15), COL.stoneDk, 14, { flat: true });
    Level.launchers.push({ s, x, y: y + 0.2, z, yaw, t: 0 });
  }

  const acornAt = (x, y, z) => Level.acorns.push({ x, y: y + 0.6, z, got: false, t: rng() * TAU });
  const acornLine = (x0, y0, z0, x1, y1, z1, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); acornAt(lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t)); } };
  const acornRing = (x, y, z, r, n, a0 = 0) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU + a0; acornAt(x + Math.cos(a) * r, y, z + Math.sin(a) * r); } };
  const seedAt = (id, x, y, z, name, hidden = false) => Level.seeds.push({ id, x, y: y + 1.0, z, name, got: false, hidden, t: 0 });
  const heartAt = (x, y, z) => Level.hearts.push({ x, y: y + 0.8, z, got: false, t: rng() * TAU });
  const blobAt = (x, y, z, range = 5, arena = false) => Level.enemies.push({ type: 'blob', x, y, z, hx: x, hz: z, range, yaw: rng() * TAU, vy: 0, alive: true, t: rng() * 5, state: 'walk', st: 0, squish: 1, arena });
  const spikyAt = (ax, ay, az, bx, by, bz, speed = 5) => Level.enemies.push({ type: 'spiky', ax, ay, az, bx, by, bz, speed, u: 0, dir: 1, x: ax, y: ay, z: az, alive: true, rot: 0 });
  const hopperAt = (x, y, z, range = 4, arena = false) => Level.enemies.push({ type: 'hopper', x, y, z, hx: x, hz: z, range, yaw: rng() * TAU, vx: 0, vz: 0, vy: 0, air: false, alive: true, t: rng() * 5, st: 0.5 + rng(), squish: 1, arena });

  const K = { st, g, rng, once, onceStage, grassCol, dirtCol, rockCol, island, kindColor, block, oblock, stump, tree, pine, rock, flower, tuft, scatter, fence, sign, hut, flag, windmill, mover, spinner, faller, stake, riser, launcher, acornAt, acornLine, acornRing, seedAt, heartAt, blobAt, spikyAt, hopperAt };
  st.build(K);

  // どんぐりの総数
  Level.acornTotal = Level.acorns.length;
  Level.seedTotal = Level.seeds.length;
  st.seedTotal = Level.seedTotal;

  // まとめた地形メッシュ（2回目以降は作り直さない）
  if (!cache.static) { cache.static = g.mesh(); cache.staticTris = g.pos.length / 9; }
  Level.static = cache.static;
  Level.staticTris = cache.staticTris;

  // ---- 動く物のメッシュ ----
  const boxMesh = (sx, sy, sz, kind, jit = 0.06) => once(`box:${sx}:${sy}:${sz}:${kind}`, () => new Geo(jit).box(T(0, 0, 0, sx, sy, sz), kindColor(kind)).mesh());
  for (const mv of Level.movers) {
    const s = mv.s;
    mv.mesh = boxMesh(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0, s.kind);
  }
  for (const sp of Level.spinners) {
    sp.mesh = once(`spin:${sp.sx}:${sp.sz}:${sp.s.kind}`, () => {
      const gg = new Geo(0.06);
      gg.box(T(0, 0, 0, sp.sx, 0.5, sp.sz), kindColor(sp.s.kind));
      for (let i = 0; i < 9; i++) gg.box(T(-sp.sx / 2 + 0.6 + i * ((sp.sx - 1.2) / 8), 0.26, 0, 0.12, 0.03, sp.sz), COL.woodDk);
      gg.cyl(T(0, 0.25, 0, 0.5, 0.08, 0.5), hex(0xffd166), 12);
      return gg.mesh();
    });
  }
  for (const f of Level.fallers) {
    f.mesh = once(`fall:${f.sx}:${f.sz}`, () => {
      const gg = new Geo(0.12);
      gg.box(T(0, 0, 0, f.sx, 0.6, f.sz), (p, n) => (n[1] > 0.5 ? hex(0xd9a066) : hex(0xa36a3a)));
      gg.box(T(0.3, 0.31, -0.2, 1.4, 0.02, 0.08, 0.6), hex(0x6b4325)); // ひび
      gg.box(T(-0.4, 0.31, 0.4, 0.9, 0.02, 0.08, -0.9), hex(0x6b4325));
      return gg.mesh();
    });
  }
  for (const r of Level.risers) {
    r.mesh = once(`rise:${r.sx}:${r.sz}`, () => {
      const gg = new Geo(0.03);
      gg.box(T(0, 0, 0, r.sx, 0.7, r.sz), kindColor('cloud'));
      for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.7], [-0.7, 0.8], [0.8, 0.8]]) gg.sphere(T(ox, -0.2, oz, 0.75, 0.5, 0.75), COL.cloud, 8, 5, { flat: true });
      return gg.mesh();
    });
  }
  Models.stake = once('stake', () => {
    const gg = new Geo(0.08);
    gg.cyl(T(0, 0, 0, 0.55, 2.7, 0.55), (p, n) => (n[1] > 0.5 ? hex(0xe9c08a) : COL.woodDk), 10, { flat: true });
    gg.cyl(T(0, 2.7, 0, 0.62, 0.2, 0.62), hex(0xd8604a), 10, { flat: true });
    return gg.mesh();
  });
  Models.spring = once('spring', () => {
    const gg = new Geo();
    gg.cyl(T(0, 0, 0, 0.8, 0.15, 0.8), COL.stoneDk, 14);
    for (let i = 0; i < 3; i++) gg.torus(T(0, 0.18 + i * 0.12, 0, 0.55, 1, 0.55), COL.spikeTip, 1, 0.08, 14, 5);
    gg.cyl(T(0, 0.5, 0, 0.8, 0.12, 0.8), hex(0xff5a5a), 14);
    return gg.mesh();
  });
  Models.launcher = once('launcher', () => {
    const gg = new Geo();
    gg.cyl(T(0, -0.15, 0, 0.95, 0.15, 0.95), hex(0x7fd3ff), 16);
    // 進む向き（+z）の矢印
    gg.box(T(0, 0.02, -0.15, 0.3, 0.05, 0.9), COL.white);
    gg.box(T(0.22, 0.02, 0.35, 0.18, 0.05, 0.6, 0.7), COL.white);
    gg.box(T(-0.22, 0.02, 0.35, 0.18, 0.05, 0.6, -0.7), COL.white);
    return gg.mesh();
  });
  Models.millBlades = once('mill', () => {
    const gg = new Geo();
    gg.cyl(T(0, 0, 0, 0.35, 0.4, 0.35, 0, Math.PI / 2), COL.woodDk, 10);
    for (let i = 0; i < 4; i++) {
      const m = T(0, 0, 0.25, 1, 1, 1, 0, 0, (i * Math.PI) / 2);
      const arm = M4.copy(m); M4.translate(arm, 0, 2.0, 0); M4.scale(arm, 0.12, 4, 0.08);
      gg.box(arm, COL.woodDk);
      const sail = M4.copy(m); M4.translate(sail, 0.38, 2.4, 0.02); M4.scale(sail, 0.7, 3, 0.04);
      gg.box(sail, hex(0xfaf3e6));
    }
    return gg.mesh();
  });
  Models.flagCloth2 = once('flagcloth', () => new Geo().box(T(0, 0, 0, 1, 1, 1), WHITE).mesh());
  if (!Models.hopper) buildLevelModels();

  // ---- 雲（下の雲海と、遠くの雲）----
  const cc = st.cloud || { lo: hex(0xdde8f5), far: hex(0xe8f0fa), top: COL.cloud };
  Level.cloudMesh = onceStage('clouds', () => {
    const cg = new Geo(0.04);
    const crng = makeRng(7);
    for (let i = 0; i < 70; i++) {
      const a = crng() * TAU, r = 30 + crng() * 140;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = -22 - crng() * 6;
      const s = 6 + crng() * 10;
      cg.sphere(T(x, y, z, s, s * 0.35, s * 0.8, crng() * 3), (p) => mixc(cc.lo, cc.top, p[1] * 0.5 + 0.5), 10, 6, { flat: true });
    }
    for (let i = 0; i < 18; i++) {
      const a = crng() * TAU, r = 110 + crng() * 50;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 10 + crng() * 35;
      for (let k = 0; k < 3; k++) {
        const s = 4 + crng() * 5;
        cg.sphere(T(x + (k - 1) * s * 0.9, y + crng() * 2, z, s, s * 0.6, s * 0.7), (p) => mixc(cc.far, cc.top, p[1] * 0.5 + 0.5), 10, 6, { flat: true });
      }
    }
    return cg.mesh();
  });
  // 空（大きな球の内側）
  Models.sky = once('sky', () => {
    const sg = new Geo();
    sg.sphere(T(0, 0, 0, -1, 1, 1), (p) => {
      const y = p[1];
      if (y > 0) return mixc(hex(0xbfe4ff), hex(0x4f9ae8), Math.pow(y, 0.7));
      return mixc(hex(0xbfe4ff), hex(0xe9f3ff), Math.min(1, -y * 3));
    }, 24, 14);
    return sg.mesh();
  });
}

// ステージ専用のモデル（新しい敵など）
function buildLevelModels() {
  // ---- 敵：ぴょんまる（はねて近づいてくる。踏める）----
  const g = new Geo();
  const body = hex(0x6fcf7f), bodyDk = hex(0x3f9a5a);
  g.sphere(T(0, 0.5, 0, 0.5, 0.46, 0.5), (p) => (p[2] > 0.55 && p[1] < 0.1 ? hex(0xeafbe0) : mixc(bodyDk, body, clamp(p[1] + 0.7, 0, 1))), 14, 10, { flat: true });
  for (const sx of [-1, 1]) {
    g.sphere(T(sx * 0.2, 0.7, 0.4, 0.15, 0.17, 0.1), COL.white, 10, 6);
    g.sphere(T(sx * 0.2, 0.68, 0.48, 0.07, 0.09, 0.05), COL.eye, 8, 5);
    g.sphere(T(sx * 0.27, 0.08, 0.12, 0.17, 0.08, 0.24), hex(0xffb347), 8, 5); // 足
  }
  g.box(T(0, 0.45, 0.5, 0.18, 0.06, 0.04), COL.eye); // 口
  // 頭の葉っぱ
  g.cyl(T(0, 0.92, 0, 0.04, 0.25, 0.04), bodyDk, 5);
  g.sphere(T(0.15, 1.15, 0, 0.2, 0.05, 0.1, 0, 0, 0.4), COL.leaf, 8, 4);
  g.sphere(T(-0.15, 1.15, 0, 0.2, 0.05, 0.1, 0, 0, -0.4), COL.leaf, 8, 4);
  Models.hopper = g.mesh();
}

// 種を出す（メッセージつき）
function revealSeedMsg(id, msg) {
  const s = Level.seeds.find((q) => q.id === id);
  if (!s || !s.hidden) return;
  s.hidden = false;
  Sound.play('seed');
  Fx.burst(s.x, s.y + 0.7, s.z, [0.7, 1, 0.95], 24, 6);
  Game.toast(msg, 4);
}

// 動く足場・ばねなどの更新
function updateLevel(dt) {
  for (const s of World.solids) { s.dx = s.dy = s.dz = 0; if (s.rotY) s.rotY = 0; }
  for (const mv of Level.movers) {
    mv.t += dt * mv.speed;
    const k = 0.5 - 0.5 * Math.cos(mv.t * Math.PI); // 0〜1 往復
    const s = mv.s;
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, cz = (s.z0 + s.z1) / 2;
    if (mv.axis === 'x') World.move(s, lerp(mv.ax, mv.bx, k) - cx, 0, 0);
    if (mv.axis === 'z') World.move(s, 0, 0, lerp(mv.az, mv.bz, k) - cz);
    if (mv.axis === 'y') World.move(s, 0, lerp(mv.ay, mv.by, k) - cy, 0);
  }
  // 回る橋
  for (const sp of Level.spinners) World.rotate(sp.s, sp.speed * dt);
  // 落ちる足場：乗る → ぐらぐら（1秒）→ 落ちる → 消える → 元の場所に戻る
  const onS = P.grounded ? P.groundS : null;
  for (const f of Level.fallers) {
    const s = f.s;
    f.t += dt;
    if (f.state === 'idle') {
      if (onS === s) { f.state = 'shake'; f.t = 0; Sound.play('land'); }
    } else if (f.state === 'shake') {
      if (f.t > 1.0) { f.state = 'fall'; f.t = 0; f.vy = 0; }
    } else if (f.state === 'fall') {
      f.vy = Math.min(f.vy + 30 * dt, 30);
      World.move(s, 0, -f.vy * dt, 0);
      if (f.t > 2.2) { f.state = 'gone'; f.t = 0; s.off = true; }
    } else if (f.state === 'gone' && f.t > 2.5) {
      // 主人公が元の場所にいなければ戻す
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const inside = Math.abs(P.x - cx) < f.sx / 2 + 0.6 && Math.abs(P.z - cz) < f.sz / 2 + 0.6 && Math.abs(P.y - f.base) < 2;
      if (!inside) {
        World.move(s, 0, f.base - s.y0, 0);
        s.dy = 0;
        s.off = false; f.state = 'idle'; f.t = 0;
        Fx.burst(cx, s.y1, cz, [1, 0.95, 0.8], 6, 2);
      }
    }
  }
  // 杭：打ちこまれたら沈む
  for (const st of Level.stakes) {
    const s = st.s;
    if (st.down && s.y1 > st.ground + 0.06) World.move(s, 0, -Math.min(dt * 7, s.y1 - (st.ground + 0.06)), 0);
  }
  // 雲の飛び石：下から浮かんでくる
  for (const r of Level.risers) {
    if (!r.active) continue;
    r.t += dt;
    const s = r.s;
    const k = clamp(r.t / 1.6, 0, 1);
    const want = r.top - 30 * Math.pow(1 - k, 3);
    if (r.t <= 0) continue;
    s.off = false;
    World.move(s, 0, want - s.y1, 0);
  }
  // 風の筒：乗ったら飛ばす
  for (const L of Level.launchers) {
    L.t += dt;
    if (P.grounded && P.groundS === L.s && (P.state === 'ground' || P.state === 'punch')) {
      const k = L.s.launch;
      P.grounded = false; P.groundS = null;
      P.state = 'air'; P.airT = 0; P.stateT = 0;
      P.yaw = k.yaw; P.speed = k.sp;
      P.vx = Math.sin(k.yaw) * k.sp; P.vz = Math.cos(k.yaw) * k.sp; P.vy = k.vy;
      P.longJump = true; P.jumpHeld = true; P.flip = 0.001; P.flipDir = 1; P.jumpN = 0;
      Sound.play('spring');
      Fx.burst(L.x, L.y + 0.3, L.z, [0.7, 0.9, 1], 16, 6);
    }
  }
  for (const m of Level.mills) m.a += dt * 0.9;
  // ステージ専用の仕掛け（つらら・風など）
  for (const f of Level.updaters) f(dt);
  for (const f of Level.flags) f.t += dt;
  for (const s of Level.springs) s.boing = Math.max(0, (s.boing || 0) - dt * 3);
}

// ヒップドロップで杭を打つ（75_entities.js の poundShock から呼ぶ）
function poundStakes(x, y, z) {
  for (const st of Level.stakes) {
    if (st.down) continue;
    const s = st.s;
    if (Math.hypot(x - s.x, z - s.z) < s.r + 0.45 && Math.abs(y - s.y1) < 0.35) {
      st.down = true;
      Sound.play('stomp');
      Fx.burst(s.x, s.y1, s.z, [0.9, 0.75, 0.5], 12, 5);
      const left = Level.stakes.filter((q) => !q.down).length;
      if (left > 0) Game.toast(`杭を打った！ あと ${left} 本`, 2);
      else if (!Level.stakeDone) {
        Level.stakeDone = true;
        Level.risers.forEach((r, i) => { r.active = true; r.t = -i * 0.45; });
        Sound.play('seed');
        Game.toast('南東の雲の下から 飛び石が うかんできた！', 4);
      }
    }
  }
}

const FALL_TINT = [1, 0.85, 0.75], STAKE_TINT = [0.85, 0.85, 0.85];
function drawLevel() {
  // 空
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  drawMesh(Models.sky, T(R.cam[0], R.cam[1], R.cam[2], 300, 300, 300), WHITE, 1, 1);
  gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
  drawMesh(Level.cloudMesh, T(), WHITE, 0.55, 1);
  const tint = Level.tint;
  drawMesh(Level.static, M4.ident(), tint);
  const t = Game.time;
  for (const mv of Level.movers) {
    const s = mv.s;
    drawMesh(mv.mesh, T((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2), tint);
  }
  for (const sp of Level.spinners) {
    const s = sp.s;
    drawMesh(sp.mesh, T(s.cx, (s.y0 + s.y1) / 2, s.cz, 1, 1, 1, s.ang), tint);
  }
  for (const f of Level.fallers) {
    if (f.state === 'gone') continue;
    const s = f.s;
    const sh = f.state === 'shake' ? 0.08 : 0;
    drawMesh(f.mesh, T((s.x0 + s.x1) / 2 + Math.sin(t * 60) * sh, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2 + Math.cos(t * 53) * sh), f.state === 'idle' ? tint : FALL_TINT);
  }
  for (const r of Level.risers) {
    if (r.s.off) continue;
    const s = r.s;
    drawMesh(r.mesh, T((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2 + Math.sin(t * 1.6 + s.x0) * 0.04, (s.z0 + s.z1) / 2), tint);
  }
  for (const st of Level.stakes) {
    const s = st.s;
    drawMesh(Models.stake, T(s.x, s.y1 - 2.9, s.z), st.down ? STAKE_TINT : tint);
  }
  for (const L of Level.launchers) {
    const k = 0.5 + 0.5 * Math.sin(L.t * 5);
    drawMesh(Models.launcher, T(L.x, L.y, L.z, 1, 1, 1, L.yaw), WHITE, 0.2 + k * 0.4);
  }
  for (const m of Level.mills) {
    const mm = T(m.x, m.y, m.z, 1, 1, 1, m.yaw);
    M4.rotZ(mm, m.a);
    drawMesh(Models.millBlades, mm, tint);
  }
  // 旗の布：細い帯を波打たせる
  for (const f of Level.flags) {
    const n = 5, w = 1.3 / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const wave = Math.sin(f.t * 5 - i * 0.9) * 0.18 * u;
      drawMesh(Models.flagCloth2, T(f.x + 0.08 + u * 1.3, f.y - 0.35 - u * 0.08, f.z + wave, w * 1.02, 0.72 - u * 0.1, 0.05, Math.sin(f.t * 5 - i * 0.9) * 0.3), f.col);
    }
  }
  for (const s of Level.springs) {
    const b = s.boing || 0;
    drawMesh(Models.spring, T((s.x0 + s.x1) / 2, s.y0, (s.z0 + s.z1) / 2, 1, 1 + Math.sin(b * 12) * b * 0.6, 1), tint);
  }
  // ステージ専用の物
  for (const f of Level.drawers) f(t, tint);
}


// ================= ステージ1「そよかぜ空島」 =================
// 起動したときの R の空・霧・光を、このステージの色として覚えておく
const ENV_DEFAULT = typeof R !== 'undefined' && R.sky ? { top: R.sky.top.slice(), bottom: R.sky.bottom.slice(), sun: R.sky.sun.slice(), fogCol: R.fogCol.slice(), fog: R.fog.slice(), light: R.light.slice(), lightCol: R.lightCol.slice(), ambLo: R.ambLo.slice(), ambHi: R.ambHi.slice() } : null;
defineStage({
  id: 0, name: 'そよかぜ空島', sub: 'はじまりの草原と 風の塔',
  killY: -28, seed: 20261125, seedTotal: 8,
  start: { x: 0, y: 0, z: 16, yaw: Math.PI },
  env: ENV_DEFAULT,
  music: { key: 0, bpm: 128 },
  titleCam: { r: 46, y: 22, tx: 0, ty: 4, tz: -4 },
  color: '#8ee0ff',
  build: buildStage1,
});
function buildStage1(K) {
  const { g, rng, once, onceStage, grassCol, dirtCol, rockCol, island, kindColor, block, oblock, stump, tree, pine, rock, flower, tuft, scatter, fence, sign, hut, flag, windmill, mover, spinner, faller, stake, riser, launcher, acornAt, acornLine, acornRing, seedAt, heartAt, blobAt, spikyAt, hopperAt } = K;
  void once; void onceStage;
  Level.acornSeed = { n: 50, id: 5, msg: 'どんぐり50こ！ スタート地点に ひかりの種が あらわれた！' };
  Level.arenaSeed = { id: 3, msg: '高台の敵を ぜんぶ たおした！ ひかりの種が あらわれた！' };

  // ================= 中央の島（はじまりの草原） =================
  island(0, 0, 28, 0, 10);
  // 池（見た目だけ）
  g.cyl(T(9, 0.01, 6, 3.2, 0.02, 2.4), hex(0x6fd0ff), 20);
  g.cyl(T(9, 0.015, 6, 2.6, 0.02, 1.9), hex(0x8fe0ff), 20);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; rock(9 + Math.cos(a) * 3.4, -0.25, 6 + Math.sin(a) * 2.6, 0.35); }

  // 木と飾り（崖・塔・杭・桟橋の近くには置かない）
  const topTree = tree(-8, 0, 11, 1.0);
  tree(10, 0, -8, 1.0); tree(17, 0, -2, 1.1); tree(21, 0, 8, 0.8); tree(-21, 0, 9, 1.1); tree(-4, 0, 23, 0.8);
  pine(-8, 0, -21, 1.1); pine(11, 0, -19, 1.0); pine(21, 0, -13, 0.9); pine(-24, 0, -12, 0.9); pine(-13, 0, -16, 0.8);
  rock(4, 0, 23, 1.2); rock(23, 0, 15, 1.4); rock(-20, 0, -19, 1.0); rock(16, 0, -14, 0.8);
  scatter(0, 0, 3, 26, 0, 110, [[-17, -6, 7], [0, -17, 7.5], [9, 6, 3.8], [15, 17, 4], [-17, 17, 4], [0, 16, 2]]);
  fence(-6, 25, 6, 25, 0);
  fence(-6, 25, -6, 21.5, 0);
  fence(6, 25, 6, 21.5, 0);

  // スタート周りのどんぐり
  acornRing(0, 0, 10, 3, 8);
  acornLine(0, 0, 4, 0, 0, -7, 5);              // 塔への道しるべ
  for (let i = 0; i < 3; i++) acornAt(-8 + (i - 1) * 0.7, topTree, 11); // ひみつ：木の上
  sign(2.2, 0, 13.5, 0, ['ひかりの種は ぜんぶで 8こ', '塔や崖にのぼって 島を見わたそう']);

  // 中央の島の敵
  blobAt(-5, 0, -6, 4);
  blobAt(13, 0, -5, 4);
  blobAt(14, 0, 4, 3.5);
  hopperAt(-9, 0, 20, 3);

  // ================= 種0 見晴らしの崖と風車（3段ジャンプ） =================
  {
    const cx = -17, cz = -6, r = 5.5, top = 4.4;
    World.cyl(cx, cz, r, -3, top, 'grass');
    g.cyl(T(cx, top - 0.5, cz, r, 0.5, r), grassCol, 24);
    g.cyl(T(cx, -0.2, cz, r * 1.04, top - 0.3, r * 1.04), rockCol, 18, { top: 0.96, flat: true, caps: false });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.3; rock(cx + Math.cos(a) * (r + 0.2), 0, cz + Math.sin(a) * (r + 0.2), 0.45 + rng() * 0.25); }
    windmill(cx - 1.8, top, cz - 1.8, Math.PI * 0.25);
    scatter(cx, cz, 0.5, 4.5, top, 14, [[cx - 1.8, cz - 1.8, 1.8]]);
    seedAt(0, cx + 2, top, cz + 1.6, '見晴らしの崖');
    acornRing(cx + 0.6, top, cz + 0.6, 3.2, 6, 0.6);
    // 助走路のどんぐり（東から西へ走って3段ジャンプ）
    acornLine(-2, 0, -5, -9, 0, -5.5, 5);
    sign(-7, 0, -1.5, Math.PI / 2, ['崖の上へは 3だんジャンプ！', '走りながら 着地に合わせて ジャンプを3回']);
  }

  // ================= 種1 風の塔（らせん → 落ちる足場 → バク宙） =================
  {
    const cx = 0, cz = -17, half = 2.5, H = 20;
    World.boxC(cx, H / 2 - 2, cz, half * 2, H + 4, half * 2, 'stone');
    g.box(T(cx, H / 2 - 2, cz, half * 2, H + 4, half * 2), (p, n) => (n[1] > 0.5 ? COL.stone : mixc(COL.stoneDk, COL.stone, (Math.floor((p[1] + 0.5) * 14) % 2) * 0.4 + 0.5)));
    // 窓と屋上のふち飾り
    for (const [wx, wz, wy] of [[0, half + 0.02, 6], [half + 0.02, 0, 11], [0, -half - 0.02, 15], [-half - 0.02, 0, 9]]) {
      g.box(T(cx + wx, wy, cz + wz, wx ? 0.05 : 0.9, 1.3, wz ? 0.05 : 0.9), hex(0x4a5a7a));
    }
    g.box(T(cx, H - 0.1, cz, half * 2 + 0.3, 0.2, half * 2 + 0.3), hex(0xd8604a));
    // らせん足場：12段。0 段目は南側、最後（11段目）は北側にくる
    const steps = 12, r = 4.6;
    for (let i = 0; i < steps; i++) {
      const a = Math.PI / 2 + (i / (steps - 1)) * TAU * 1.5;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const top = 1.3 + i * 1.3;
      if (i >= 7 && i <= 10) {
        faller(x, top, z, 2.5, 2.5);
        acornAt(x, top + 0.3, z);
      } else {
        block(x, top - 0.3, z, 2.6, 0.6, 2.6, i % 3 === 2 ? 'wood' : 'stone');
        if (i === 3 || i === 6) blobAt(x, top, z, 0.6);
        else if (i === 5) heartAt(x, top, z);
        else if (i % 2 === 0 && i < 7) acornAt(x, top, z);
      }
    }
    flag(cx + 1.7, H, cz - 1.7, hex(0xff6b6b));
    seedAt(1, cx - 0.5, H, cz + 0.5, '風の塔のてっぺん');
    sign(3.5, 0, -10.8, 0, ['ぐらぐら足場は すぐ落ちる！', '最後は 止まって しゃがみ＋ジャンプで バク宙']);
  }

  // ================= 種2 東の浮島（動く足場 → 回る橋 → 上下の足場） =================
  {
    block(31, 0.5, 0, 3, 1, 3, 'wood');
    block(35.5, 1.6, -1.5, 2.6, 0.8, 2.6, 'wood');
    acornLine(31, 1, 0, 35.5, 2, -1.5, 2);
    // 左右に動く足場
    mover(42, 2, -1.5, 3.2, 0.6, 3.2, 'wood', 'x', 39.5, 48.5, 0.45);
    acornLine(41, 3.0, -1.5, 47, 3.0, -1.5, 4);
    block(52, 2.0, -1.5, 3, 0.6, 3, 'stone');
    // 回る橋（長さ10）
    spinner(59, 2.3, -1.5, 10, 2.2, 0.55);
    acornLine(57, 2.3, -1.5, 61, 2.3, -1.5, 3);
    block(66.5, 2.0, -1.5, 3, 0.6, 3, 'stone');
    // 上下に動く足場
    mover(70, 2, -1.5, 2.8, 0.6, 2.8, 'stone', 'y', 2.0, 7.2, 0.4);
    island(80, 4, 9, 7.5, 8);
    hut(84.5, 7.5, 9, 3.2, 2.6, hex(0x5aa0e0));
    pine(86, 7.5, -1, 0.9); tree(74.5, 7.5, 9, 0.8); rock(77, 7.5, 11, 0.8);
    scatter(80, 4, 2.5, 8, 7.5, 26, [[80, 4, 2.4], [84.5, 9, 3]]);
    blobAt(77, 7.5, 0, 3); blobAt(83, 7.5, 4, 3);
    spikyAt(75, 7.5, 8.2, 85, 7.5, 8.2, 3.5);
    acornRing(80, 7.5, 4, 4.2, 8, 0.4);
    heartAt(86.5, 7.5, 3.5);
    block(80, 8.5, 4, 3, 2, 3, 'stone');
    seedAt(2, 80, 9.5, 4, '東の浮島');
    sign(25, 0, -3.2, -Math.PI / 2, ['東の浮島へ！', '動く足場と 回る橋を 乗りついでいこう']);
  }

  // ================= 種3 西の高台（敵を全部たおす） =================
  {
    // 中央島の西端から坂を上る（x=-26 で高さ0 → x=-42 で高さ8）
    const rx0 = -42, rx1 = -26, rz0 = -3.6, rz1 = 3.6, ra = 8;
    World.ramp(rx0, rz0, rx1, rz1, -3, 'x', ra, 0, 'grass');
    const len = rx1 - rx0, ang = Math.atan2(ra, len), hyp = Math.hypot(len, ra), th = 4;
    const mx = (rx0 + rx1) / 2, mh = ra / 2;
    g.box(T(mx - Math.sin(ang) * th / 2, mh - Math.cos(ang) * th / 2, 0, hyp + 0.4, th, rz1 - rz0, 0, 0, -ang), kindColor('grass'));
    // 坂の真ん中の道（石だたみの見た目）
    for (let i = 0; i < 9; i++) {
      const x = lerp(-27.5, -40.5, i / 8), y = ra * (rx1 - x) / len;
      g.box(T(x, y + 0.02, 0, 1.1, 0.06, 1.2, 0, 0, -ang), COL.stone);
    }
    block(-46, 6, 0, 8, 4, 7.2, 'grass');
    island(-57, 0, 10, 8, 9);
    pine(-61, 8, -7, 1); pine(-53, 8, 8, 0.8); pine(-64, 8, 4, 1.1); rock(-62, 8, -2, 1);
    scatter(-57, 0, 2, 9.5, 8, 30, [[-57, 0, 2]]);
    // 種が出る場所の石の輪
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.box(T(-57 + Math.cos(a) * 1.8, 8.08, Math.sin(a) * 1.8, 0.7, 0.16, 0.7, a), COL.stone); }
    const rampY = (x) => ra * (rx1 - x) / len;
    spikyAt(-41, rampY(-41), 2.3, -27, rampY(-27), 2.3, 6.5);
    spikyAt(-27, rampY(-27), -2.3, -41, rampY(-41), -2.3, 5.5);
    for (let i = 0; i < 6; i++) { const x = lerp(-28, -40, i / 5); acornAt(x, rampY(x), 0); }
    // 高台の敵（全部たおすと種）
    blobAt(-54, 8, -4, 3, true); blobAt(-60, 8, 3, 3, true); blobAt(-58, 8, -5, 3, true);
    hopperAt(-55, 8, 4, 3, true); hopperAt(-61, 8, -2, 3, true);
    acornRing(-57, 8, 0, 6.5, 6, 0.3);
    seedAt(3, -57, 8, 0, '西の高台', true);
    heartAt(-50, 8, -5);
    sign(-24, 0, 4.6, Math.PI / 2, ['トゲコロは 踏めない！ 坂の真ん中を進もう', '高台の敵を ぜんぶ たおすと…？']);
  }

  // ================= 種4 南のえんとつ島（壁キック） =================
  {
    block(0, -0.3, 33, 3, 0.6, 10, 'wood');
    for (let i = 0; i < 6; i++) g.box(T(0, 0.02, 28.5 + i * 1.8, 3, 0.04, 0.12), COL.woodDk);
    fence(-1.6, 28.6, -1.6, 37.4, 0);
    fence(1.6, 28.6, 1.6, 37.4, 0);
    island(0, 46, 9, 0, 8);
    // えんとつ（内側 3.6 四方、高さ 10.5）。北側の下に入口
    const H = 10.5, cz = 47, inr = 1.8, w = 1.2;
    const wallC = (p, n) => (n[1] > 0.5 ? COL.stone : mixc(hex(0xc9775a), hex(0xb0644c), (Math.floor((p[1] + 0.5) * 18) % 2)));
    const wb = (x0, y0, z0, x1, y1, z1) => { World.box(x0, y0, z0, x1, y1, z1, 'stone'); g.box(T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0), wallC); };
    wb(-inr - w, 0, cz - inr - w, -inr, H, cz + inr + w);   // 西
    wb(inr, 0, cz - inr - w, inr + w, H, cz + inr + w);     // 東
    wb(-inr, 0, cz + inr, inr, H, cz + inr + w);            // 南
    wb(-inr, 0, cz - inr - w, -0.95, H, cz - inr);          // 北（入口の左右と上）
    wb(0.95, 0, cz - inr - w, inr, H, cz - inr);
    wb(-0.95, 2.4, cz - inr - w, 0.95, H, cz - inr);
    // てっぺんのテラス
    const d = 2.6, ty = H - 0.5;
    const deck = (x0, z0, x1, z1) => block((x0 + x1) / 2, ty + 0.25, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, 'wood');
    deck(-inr - w - d, cz - inr - w - d, inr + w + d, cz - inr - w);
    deck(-inr - w - d, cz + inr + w, inr + w + d, cz + inr + w + d);
    deck(-inr - w - d, cz - inr - w, -inr - w, cz + inr + w);
    deck(inr + w, cz - inr - w, inr + w + d, cz + inr + w);
    flag(-4.6, H, cz + 4.4, hex(0xffd166));
    seedAt(4, 0, H, cz + 4.3, 'えんとつのてっぺん');
    // えんとつの中のどんぐり（上へ導く）
    acornLine(0, 2.5, cz, 0, 8.5, cz, 4);
    acornLine(0, 0, 38.5, 0, 0, 42.5, 3);
    acornRing(0, H, cz, 4.6, 6, 0.5);
    hopperAt(-5, 0, 40.5, 2.5); blobAt(5.5, 0, 41, 2.5);
    tree(-6.5, 0, 51, 0.8); pine(6.5, 0, 51, 0.8);
    heartAt(4, 0, 53);
    scatter(0, 46, 6.5, 8.5, 0, 22);
    sign(2.6, 0, 26.2, Math.PI, ['えんとつの中で かべキック！', '壁に当たった瞬間に ジャンプ']);
  }

  // ================= 種5 どんぐり 50 こで現れる =================
  seedAt(5, 0, 0, 5.5, 'どんぐり 50 こ', true);

  // ================= 種6 南西：幅とびの桟橋 → ちぎれ雲の小島 =================
  {
    const dx = -Math.SQRT1_2, dz = Math.SQRT1_2;       // 南西の向き
    const qx = Math.SQRT1_2, qz = Math.SQRT1_2;        // 横の向き
    const at = (r, side = 0) => [dx * r + qx * side, dz * r + qz * side];
    const ang = Math.atan2(-dz, dx);
    // 桟橋：r=23〜30（島のふちから 2m つき出す）、高さ 2
    const [px, pz] = at(26.5);
    oblock(px, pz, 7, 3, ang, -1, 2, 'stone');
    for (let i = 0; i < 4; i++) { const [x, z] = at(23.5 + i * 2); g.box(T(x, 2.02, z, 0.15, 0.04, 3, ang), COL.stoneDk); }
    const [ex, ez] = at(30);
    g.cyl(T(ex + qx * 1.3, 2, ez + qz * 1.3, 0.12, 0.9, 0.12), COL.woodDk, 6);
    g.cyl(T(ex - qx * 1.3, 2, ez - qz * 1.3, 0.12, 0.9, 0.12), COL.woodDk, 6);
    for (let i = 0; i < 3; i++) { const [x, z] = at(24 + i * 2.5); acornAt(x, 2, z); }
    // 幅とびの軌道にどんぐり（目安）
    for (let i = 0; i < 4; i++) { const r = 31.5 + i * 2.1; const [x, z] = at(r); acornAt(x, 2 + 1.2 * Math.sin((i + 1) / 5 * Math.PI) - i * 0.5, z); }
    // ちぎれ雲の小島：中心 r=44.5、半径 5.5、高さ -1（桟橋より 3 低い・すき間 9.0）
    const [ix, iz] = at(44.5);
    island(ix, iz, 5.5, -1, 6);
    stump(ix + qx * 0.5, iz + qz * 0.5, 1.1, 0.2, 2);
    seedAt(6, ix + qx * 0.5, 0.2, iz + qz * 0.5, 'ちぎれ雲の小島');
    pine(ix + dx * 2.5 - qx * 2.5, -1, iz + dz * 2.5 - qz * 2.5, 0.8);
    scatter(ix, iz, 1.5, 5, -1, 14, [[ix + qx * 0.5, iz + qz * 0.5, 1.4]]);
    acornRing(ix + qx * 0.5, -1, iz + qz * 0.5, 2.6, 3, 1.0);
    // 帰り道：風の筒（中央の島へ飛ばす）
    const [lx, lz] = at(42.0, 2.8);
    launcher(lx, -1, lz, Math.atan2(-dx, -dz), 22, 17);
    const [sx, sz] = at(21, -2.6);
    sign(sx, 0, sz, Math.atan2(dx, dz) + Math.PI, ['走りながら しゃがんで ジャンプで 幅とび！', '帰りは 風の筒に 乗ろう']);
  }

  // ================= 種7 南東：杭を打つと雲の飛び石が浮かぶ =================
  {
    stake(12, 0, 18.5); stake(15.5, 0, 14.5); stake(18, 0, 19.5);
    acornAt(12, 0.9, 18.5); acornAt(15.5, 0.9, 14.5); acornAt(18, 0.9, 19.5);
    const ex = Math.SQRT1_2, ez = Math.SQRT1_2, qx = Math.SQRT1_2, qz = -Math.SQRT1_2;
    const at = (r, side = 0) => [ex * r + qx * side, ez * r + qz * side];
    [[31, 1.0, 0.8], [34.5, 2.0, -0.8], [38, 3.0, 0.8], [41.5, 4.0, -0.6]].forEach(([r, top, side]) => {
      const [x, z] = at(r, side);
      riser(x, top, z, 2.5, 2.5);
      acornAt(x, top, z);
    });
    const [ix, iz] = at(50.9);
    island(ix, iz, 6, 5, 7);
    hut(ix + 1.5, 5, iz + 2.2, 3, 2.4);
    flag(ix - 3, 5, iz - 2, hex(0x9b7de0));
    seedAt(7, ix - 1.5, 5, iz - 0.5, '雲の上の小屋');
    blobAt(ix + 2, 5, iz - 3, 1.5);
    scatter(ix, iz, 2, 5.5, 5, 14, [[ix + 1.5, iz + 2.2, 2.6]]);
    sign(10.5, 0, 22, Math.PI, ['3本の杭を ヒップドロップで 打ちこもう', '（空中で しゃがむ）']);
  }

  // ================= ひみつ：北東のがけ下 =================
  {
    const a = -0.93, r = 31.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    block(x, -3.8, z, 5.2, 0.6, 5.2, 'stone');
    g.cyl(T(x, -6.5, z, 2.2, 2.4, 2.2), rockCol, 7, { top: 1.2, bottom: 0.2, flat: true });
    acornRing(x, -3.5, z, 1.4, 5);
    heartAt(x + 1.5, -3.5, z - 1.5);
    Level.springs.push(World.boxC(x - 1.4, -3.25, z + 1.4, 1.6, 0.5, 1.6, 'spring'));
  }

}
