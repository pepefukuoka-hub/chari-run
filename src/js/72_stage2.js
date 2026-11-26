// ステージ2「こおりの空島」：ゆうやけの空に浮かぶ、雪と氷の島
//
// 地図（上が北＝ -z、右が東＝ +x）
//   中央：雪原（半径24、高さ0）。スタートは南側 (0,14)
//   北  ：風のつり橋（横風がふく。風よけのかげで待つ）→ 北の島 ………… 種0
//   東  ：氷の道 → 凍った池（まんなかの ひびを ヒップドロップ）→ 池の下のほらあな … 種1
//   西  ：氷の柱のぼり（すべる柱を続けてジャンプ）→ 雪山のてっぺん …… 種2
//   南西：雪山から長いすべり台（しゃがんですべって 幅とび）→ 雪すべりの島 … 種3
//   南  ：つららの谷（落ちてくるつらら・穴）→ 奥の高い棚（バク宙）……… 種4
//   南東：ゆきだるん広場（雪玉を投げる ゆきだるんを ぜんぶ たおす）…… 種5
//   北東：動く足場 → 上下する足場 → ぐらぐら足場 → 灯台の島 …………… 種6
defineStage({
  id: 1, name: 'こおりの空島', sub: 'ゆうやけの 雪と氷の島',
  killY: -30, seed: 20261126, seedTotal: 7,
  start: { x: 0, y: 0, z: 14, yaw: Math.PI },
  // 空：上は夕暮れのむらさき、地平線はあかね色、太陽は北西の低いところ
  env: {
    top: [0.2, 0.2, 0.5], bottom: [0.72, 0.56, 0.72], sun: [1.0, 0.5, 0.24],
    fogCol: [0.98, 0.68, 0.55], fog: [40, 145], light: [-0.55, 0.36, -0.75],
  },
  music: { key: -3, bpm: 112 },
  tint: [1.0, 0.9, 0.88],
  cloud: { lo: hex(0xc4a2c6), far: hex(0xf6b496), top: hex(0xffe2d2) },
  titleCam: { r: 62, y: 28, tx: 0, ty: 3, tz: 0 },
  color: '#ffb38a',
  unlock: { stage: 0, seeds: 4 },
  build: buildStage2,
});

// 風のつり橋：風の周期（秒）。しずか → 前ぶれ → 強い風
const WIND = { period: 3.6, calm: 1.5, warn: 0.5, push: 4.2 };
function windGust(t) {
  const p = t % WIND.period, g0 = WIND.calm + WIND.warn;
  if (p < WIND.calm) return 0;
  if (p < g0) return -1; // 前ぶれ（まだ押さない）
  return clamp((p - g0) / 0.15, 0, 1) * clamp((WIND.period - p) / 0.15, 0, 1);
}

function buildStage2(K) {
  const { g, rng, once, onceStage, kindColor, block, sign, flag, mover, faller, launcher, acornAt, acornLine, acornRing, seedAt, heartAt, hopperAt } = K;
  void onceStage;
  const S2 = Level.s2 = { windT: 0, gustOn: false, slab: null, broken: false, icicles: [], balls: [], lamps: [], crystals: [] };
  Level.arenaSeed = { id: 5, msg: 'ゆきだるんを ぜんぶ たおした！ ひかりの種が あらわれた！' };
  Level.arenaName = 'ゆきだるん';

  // ---------- 色 ----------
  const SNOW = hex(0xf3f7ff), SNOW2 = hex(0xdde6f5), SNOWSH = hex(0xc9d3ea);
  const ROCK = hex(0x8d88a6), ROCKDK = hex(0x5f5a7a), ICE = hex(0xa9e4ff), ICEDK = hex(0x6fbde8);
  const snowTop = (p, n) => (n[1] > 0.5 ? mixc(SNOW2, SNOW, 0.55 + 0.45 * Math.sin(p[0] * 2.1 + p[2] * 1.7)) : p[1] > 0.6 ? SNOW2 : SNOWSH);
  const rockSide = (p) => mixc(ROCKDK, ROCK, clamp(p[1] * 0.9 + 0.1 + 0.12 * Math.sin(p[1] * 11 + p[0]), 0, 1));
  const iceCol = (p, n) => (n[1] > 0.5 ? mixc(ICE, hex(0xe6f8ff), 0.3 + 0.3 * Math.sin(p[0] * 4 + p[2] * 3)) : mixc(ICEDK, ICE, clamp(p[1] + 0.5, 0, 1)));

  // ---------- 部品 ----------
  // 雪の島（円柱）
  function snowIsland(x, z, r, top, depth = 8) {
    World.cyl(x, z, r, top - depth * 0.6, top, 'snow');
    g.cyl(T(x, top - 0.6, z, r, 0.6, r), snowTop, 32);
    g.cyl(T(x, top - 0.6 - depth, z, r * 0.98, depth, r * 0.98), rockSide, 28, { bottom: 0.2, top: 1, caps: false, flat: true });
    // ふちの雪のたれ
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rng() * 0.3;
      g.sphere(T(x + Math.cos(a) * r * 0.97, top - 0.75, z + Math.sin(a) * r * 0.97, 0.9 + rng() * 0.6, 0.45, 0.9 + rng() * 0.6, a), SNOW2, 7, 4, { flat: true });
    }
  }
  // 雪をかぶった箱（当たり判定つき）
  function snowBox(x0, y0, z0, x1, y1, z1, kind = 'snow') {
    const s = World.box(x0, y0, z0, x1, y1, z1, kind);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = Math.abs(x1 - x0), sz = Math.abs(z1 - z0);
    if (kind === 'ice') g.box(T(cx, (y0 + y1) / 2, cz, sx, y1 - y0, sz), iceCol);
    else {
      g.box(T(cx, (y0 + y1) / 2 - 0.15, cz, sx, y1 - y0 - 0.3, sz), rockSide);
      g.box(T(cx, y1 - 0.15, cz, sx + 0.08, 0.3, sz + 0.08), snowTop);
    }
    return s;
  }
  // 雪をかぶった針葉樹
  function snowPine(x, y, z, s = 1) {
    World.cyl(x, z, 0.4 * s, y, y + 4 * s, 'wood');
    g.cyl(T(x, y, z, 0.3 * s, 1.2 * s, 0.3 * s), COL.trunk, 6);
    for (let i = 0; i < 3; i++) {
      const r = (1.6 - i * 0.4) * s, yy = y + (1 + i * 1.1) * s;
      g.cyl(T(x, yy, z, r, 1.8 * s, r), (p) => (p[1] > 0.45 ? SNOW : mixc(hex(0x2f6b5a), hex(0x3f8a6a), p[1] * 2)), 8, { top: 0, flat: true });
    }
  }
  function snowRock(x, y, z, s) {
    World.cyl(x, z, s * 0.9, y - 1, y + s * 0.9, 'stone');
    g.sphere(T(x, y, z, s, s * 0.9, s * 0.95, rng() * 3), (p) => (p[1] > 0.45 ? SNOW : mixc(ROCKDK, ROCK, p[1] * 0.5 + 0.5)), 7, 5, { flat: true });
  }
  // 雪の上のでこぼこ（見た目だけ）
  function drifts(cx, cz, r0, r1, y, n, avoid = []) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = r0 + rng() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      if (rng() < 0.7) g.sphere(T(x, y - 0.05, z, 0.5 + rng() * 0.6, 0.18, 0.4 + rng() * 0.5, rng() * 3), SNOW, 7, 4, { flat: true });
      else g.cyl(T(x, y, z, 0.05, 0.4, 0.05), ROCKDK, 4, { top: 0.2, caps: false }); // かれ枝
    }
  }
  // 灯り（ゆうやけでもぽっと光る。光は drawers で描く）
  function lamp(x, y, z) {
    World.cyl(x, z, 0.16, y, y + 1.6, 'wood').noCam = true;
    g.cyl(T(x, y, z, 0.08, 1.5, 0.08), hex(0x4a3b55), 6);
    g.box(T(x, y + 1.62, z, 0.34, 0.36, 0.34), hex(0xffd38a));
    g.cyl(T(x, y + 1.8, z, 0.26, 0.16, 0.26), hex(0x4a3b55), 6, { top: 0 });
    S2.lamps.push([x, y + 1.62, z]);
  }
  // 氷の結晶（ほんのり光る。drawers で描く）
  function crystal(x, y, z, s, a = 0) { S2.crystals.push({ x, y, z, s, a }); }
  // つらら（近づくとゆれて落ちてくる）。y は根元の高さ
  function icicle(x, y, z) {
    S2.icicles.push({ x, y0: y, z, y, vy: 0, state: 'idle', t: 0, grow: 1 });
  }
  // 雪だるまの敵「ゆきだるん」：その場で向きを変えて、雪玉を山なりに投げてくる
  const snowmanAt = (x, y, z, arena = false) => Level.enemies.push({ type: 'snowman', x, y, z, hx: x, hz: z, yaw: rng() * TAU, alive: true, t: rng() * 5, cd: 1.2 + rng(), wind: 0, squish: 1, arena });

  // ================= 中央の雪原 =================
  snowIsland(0, 0, 24, 0, 10);
  // かまくら（上にも乗れる）
  World.cyl(-9, 7, 2.2, -0.5, 1.9, 'snow');
  g.sphere(T(-9, 0, 7, 2.4, 2.1, 2.4), SNOW, 16, 8, { flat: true });
  g.box(T(-9, 0.6, 9.3, 1.1, 1.2, 0.3), hex(0x3a3450));
  for (let i = 0; i < 4; i++) acornAt(-9 + Math.cos(i * 1.57) * 0.9, 2.1, 7 + Math.sin(i * 1.57) * 0.9); // ひみつ：かまくらの上
  snowPine(9, 0, 9, 1.0); snowPine(14, 0, -3, 1.2); snowPine(-14, 0, -4, 1.1); snowPine(-17, 0, 8, 0.9);
  snowPine(6, 0, -15, 1.0); snowPine(-6, 0, -16, 0.9); snowPine(18, 0, 8, 0.8); snowPine(-4, 0, 20, 0.8);
  snowRock(11, 0, 17, 1.2); snowRock(-20, 0, -2, 1.0); snowRock(16, 0, -12, 0.9);
  drifts(0, 0, 3, 23, 0, 90, [[0, 14, 2], [-9, 7, 3], [0, -22, 3], [22, 0, 3], [0, 22, 3]]);
  lamp(2, 0, -21.5); lamp(-2, 0, -21.5); lamp(21, 0, 2.6); lamp(2.8, 0, 22); lamp(-2.8, 0, 22);
  lamp(15.5, 0, 15.5); lamp(14.5, 0, -15.5); lamp(-15.6, 0, -11.5);
  sign(2.4, 0, 11.5, 0, ['ひかりの種は ぜんぶで 7こ', '氷の上は つるつる すべるよ！']);
  acornRing(0, 0, 8, 2.6, 6);
  acornLine(0, 0, 3, 0, 0, -12, 4);
  hopperAt(10, 0, 2, 3);
  snowmanAt(-11, 0, -2);

  // ================= 種0 北：風のつり橋 =================
  {
    const z0 = -23.4, z1 = -54, hw = 1.3;
    const walls = [-29, -36, -43, -50];
    S2.walls = walls;
    S2.bridge = { x0: -10, x1: 10, z0: z1 + 0.5, z1: z0 - 0.4 };
    // 橋の板：風よけのかげは安全な場所、それ以外は落ちたら戻れない場所（noSafe）
    const cuts = [z0];
    for (const w of walls) cuts.push(w + 1.4, w - 1.4);
    cuts.push(z1);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const s = World.box(-hw, -0.5, b, hw, 0, a, 'wood');
      if (i % 2 === 0) s.noSafe = true;
    }
    const plank = (p, n) => (n[1] > 0.5 ? mixc(COL.woodDk, COL.wood, 0.6) : COL.woodDk);
    for (let z = z0; z > z1; z -= 0.55) g.box(T((rng() - 0.5) * 0.06, -0.12, z - 0.27, hw * 2, 0.24, 0.48, (rng() - 0.5) * 0.04), plank);
    g.box(T(0, -0.4, (z0 + z1) / 2, hw * 1.7, 0.2, Math.abs(z1 - z0)), COL.woodDk);
    // 支柱となわ（見た目だけ。当たり判定はない）
    for (let z = z0 - 1; z > z1; z -= 3.4) {
      for (const sx of [-1, 1]) g.cyl(T(sx * (hw + 0.05), -0.3, z, 0.08, 1.3, 0.08), COL.woodDk, 5);
    }
    for (const sx of [-1, 1]) g.box(T(sx * (hw + 0.05), 0.85, (z0 + z1) / 2, 0.05, 0.05, Math.abs(z1 - z0)), hex(0xc9a77a));
    // 風よけ（西のはしに立つ雪のかべ）。風は西から東へふく
    for (const w of walls) {
      World.box(-hw, 0, w - 1.1, -0.75, 1.5, w + 1.1, 'snow');
      g.box(T(-hw + 0.27, 0.7, w, 0.55, 1.4, 2.2), SNOW2);
      g.sphere(T(-hw + 0.27, 1.4, w, 0.34, 0.25, 1.15), SNOW, 8, 4, { flat: true });
      acornAt(0.2, 0, w);
    }
    acornLine(0, 0, -25.5, 0, 0, -26.8, 2);
    // 北の島
    snowIsland(0, -62, 9, 0, 8);
    snowBox(-1.4, -0.5, -65.4, 1.4, 0.8, -62.6, 'stone');
    seedAt(0, 0, 0.8, -64, '風のつり橋のむこう');
    snowPine(-5, 0, -65, 0.9); snowPine(5.5, 0, -63, 1.0); snowRock(-3.5, 0, -57.5, 0.8);
    drifts(0, -62, 2.5, 8.5, 0, 16, [[0, -64, 2.5]]);
    acornRing(0, 0, -62, 5.2, 7, 0.4);
    snowmanAt(4, 0, -59);
    heartAt(-4.5, 0, -60);
    lamp(-1.8, 0, -54.5); lamp(1.8, 0, -54.5);
    sign(-2.6, 0, -21.2, Math.PI, ['つり橋は 横風が ふく！', '雪が とんできたら 風よけの かげで まとう']);
  }

  // ================= 種1 東：凍った池と ほらあな =================
  {
    // 氷の道（つるつる）
    snowBox(22.5, -0.6, -1.6, 32, 0, 1.6, 'ice');
    acornLine(25, 0, 0, 30, 0, 0, 3);
    // 池の島（まんなかに穴をあけるため、箱を組み合わせる）
    const X0 = 32, X1 = 48, Z0 = -8, Z1 = 8, cx = 40, hh = 1.2, top = 0, bot = -6;
    snowBox(X0, bot, Z0, X1, top, -hh);
    snowBox(X0, bot, hh, X1, top, Z1);
    snowBox(X0, bot, -hh, cx - hh, top, hh);
    snowBox(cx + hh, bot, -hh, X1, top, hh);
    // 池の氷（少しだけ高い。つるつる）
    const ice = (x0, z0, x1, z1) => { World.box(x0, -0.1, z0, x1, 0.02, z1, 'ice'); g.box(T((x0 + x1) / 2, -0.04, (z0 + z1) / 2, x1 - x0, 0.13, z1 - z0), iceCol); };
    ice(34.5, -5.5, 45.5, -hh); ice(34.5, hh, 45.5, 5.5); ice(34.5, -hh, cx - hh, hh); ice(cx + hh, -hh, 45.5, hh);
    // まんなかの ひびの入った氷（ヒップドロップで割れる）
    S2.slab = World.box(cx - hh, -0.3, -hh, cx + hh, 0.02, hh, 'ice');
    S2.slab.noSafe = true;
    for (const [x, z] of [[34, -6.5], [46, -6.5], [34, 6.5], [46, 6.5]]) snowRock(x, 0, z, 0.7);
    snowPine(45.5, 0, -7, 0.8); snowPine(33.5, 0, 7.2, 0.7);
    acornRing(cx, 0.02, 0, 3.6, 8, 0.2);
    sign(31, 0, 3.4, -Math.PI / 2, ['池のまんなかに ひびが…？', '空中で しゃがむと ヒップドロップ']);
    // ほらあな（池の下）
    // 床（ほらあなの中は暗い色の岩）。東の戸口の床もつなげる
    const caveFloor = (p, n) => (n[1] > 0.5 ? mixc(hex(0x5a5878), hex(0x6c6a8c), 0.5 + 0.5 * Math.sin(p[0] * 1.3 + p[2] * 0.9)) : hex(0x3c3858));
    World.box(33, -11, -7, 47, -9, 7, 'stone'); g.box(T(40, -10, 0, 14, 2, 14), caveFloor);
    World.box(47, -11, -1.4, 48, -9, 1.4, 'stone'); g.box(T(47.5, -10, 0, 1, 2, 2.8), caveFloor);
    const wallC = (p) => mixc(hex(0x4a4566), hex(0x6a6488), clamp(p[1] * 0.5 + 0.5 + 0.1 * Math.sin(p[2] * 7), 0, 1));
    const cw = (x0, y0, z0, x1, y1, z1) => { World.box(x0, y0, z0, x1, y1, z1, 'stone'); g.box(T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0), wallC); };
    cw(X0, -11, Z0, X1, -6, -7); cw(X0, -11, 7, X1, -6, Z1); cw(X0, -11, -7, 33, -6, 7);
    cw(47, -11, -7, X1, -6, -1.4); cw(47, -11, 1.4, X1, -6, 7); cw(47, -6.6, -1.4, X1, -6, 1.4);
    // 天井（島の底）の見た目と、氷のつらら（見た目）
    g.box(T(40, -6.05, 0, 14, 0.1, 14), hex(0x3c3858));
    for (let i = 0; i < 16; i++) {
      const x = 34 + rng() * 12, z = -6 + rng() * 12;
      if (Math.abs(x - cx) < 2 && Math.abs(z) < 2) continue;
      const l = 0.4 + rng() * 0.7;
      g.cyl(T(x, -6 - l, z, 0.12 + rng() * 0.1, l, 0.12 + rng() * 0.1), ICE, 6, { bottom: 0, flat: true });
    }
    for (const [x, z, s, a] of [[34.2, -5.6, 1.2, 0.3], [35.5, -6.2, 0.8, 1.2], [45.6, 5.8, 1.1, 0.6], [44, 6.2, 0.7, 2], [34, 5.5, 0.9, 1.4], [46, -5.5, 1, 0.2]]) crystal(x, -9, z, s, a);
    snowBox(35, -9, -5.6, 37, -8.4, -3.4, 'stone');
    seedAt(1, 36, -8.4, -4.5, '池の下のほらあな');
    acornLine(38.5, -9, 1.5, 38.5, -9, 5, 3);
    acornLine(41.5, -9, -1.5, 41.5, -9, -5, 3);
    heartAt(44.5, -9, -4);
    // 出口：東の戸口 → 外の岩だな → ふきあげの穴で池の島へ
    snowBox(48, -11, -2.6, 55.5, -9, 2.6, 'stone');
    launcher(53.6, -9, 0, Math.atan2(-0.85, -0.53), 30, 7);
    acornLine(50.4, -6, 0, 48.6, -1, 0, 3);
  }

  // ================= 種2 西：氷の柱のぼり → 雪山 =================
  const PILLARS = [[-21.6, -14.5, 1.6], [-25, -15.6, 3.2], [-28.4, -16.6, 4.8], [-31.8, -17.2, 6.4], [-35.2, -17, 8.0], [-38.6, -16.4, 9.6], [-42, -17, 11.2]];
  S2.pillars = PILLARS;
  {
    for (const [x, z, top] of PILLARS) {
      World.cyl(x, z, 1.3, top - 16, top, 'ice');
      g.cyl(T(x, top - 16, z, 1.3, 16, 1.3), iceCol, 10, { flat: true });
      g.cyl(T(x, top - 0.02, z, 1.05, 0.04, 1.05), hex(0xe6f8ff), 10);
      acornAt(x, top + 0.4, z);
    }
    sign(-17, 0, -13.2, Math.PI / 2, ['氷の柱は 止まれない！', '着地したら すぐ 次へ ジャンプ']);
    // 雪山（台地）
    snowBox(-56, -10, -23, -44.5, 12, -11);
    for (let i = 0; i < 5; i++) g.sphere(T(-56 + rng() * 11, 12, -23 + rng() * 2, 1.2 + rng(), 0.6, 1, rng() * 3), SNOW, 7, 4, { flat: true });
    snowPine(-54, 12, -21, 1.1); snowPine(-46.5, 12, -21.5, 0.9); snowRock(-55, 12, -14, 0.9);
    crystal(-50, 12, -21, 1.6, 0.4); crystal(-48.6, 12, -20.4, 1.0, 1.5);
    seedAt(2, -50, 12, -18, '雪山のてっぺん');
    heartAt(-46.5, 12, -13);
    acornRing(-50, 12, -18, 2.6, 5, 0.3);
    flag(-45.5, 12, -12, hex(0xffd166));
  }

  // ================= 種3 南西：長いすべり台 → 雪すべりの島 =================
  {
    const x0 = -54, x1 = -49, za = -11, zb = 13, ya = 12, yb = 3.6;
    S2.slide = { x0, x1, za, zb, ya, yb };
    const r = World.ramp(x0, za, x1, zb, yb - 3, 'z', ya, yb, 'snow');
    r.noSafe = true;
    const len = zb - za, ang = Math.atan2(ya - yb, len), hyp = Math.hypot(len, ya - yb);
    const mx = (x0 + x1) / 2, mz = (za + zb) / 2, my = (ya + yb) / 2;
    g.box(T(mx, my - Math.cos(ang) * 0.3, mz + Math.sin(ang) * 0.3, x1 - x0, 0.6, hyp + 0.2, 0, ang), (p, n) => (n[1] > 0.5 ? SNOW : SNOW2));
    // すべり台のみぞの線と、両側のへり（へりにも当たり判定）
    for (const sx of [-1, 1]) {
      const ex = sx < 0 ? x0 - 0.35 : x1 + 0.35;
      World.ramp(ex - 0.35, za, ex + 0.35, zb, yb - 3, 'z', ya + 0.7, yb + 0.7, 'snow').noCam = true;
      g.box(T(ex, my + 0.35, mz, 0.7, 0.7, hyp + 0.2, 0, ang), (p, n) => (n[1] > 0.5 ? SNOW : hex(0x7fb8e8)));
    }
    g.box(T(mx, my + 0.02, mz, 0.12, 0.05, hyp, 0, ang), hex(0xbfe0ff));
    // 支え
    for (let i = 1; i < 5; i++) {
      const z = lerp(za, zb, i / 5), y = lerp(ya, yb, i / 5);
      g.cyl(T(mx, y - 14, z, 0.5, 13.6, 0.5), rockSide, 8, { flat: true });
    }
    // すべる道すじのどんぐり
    for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6; acornAt(mx, lerp(ya, yb, t), lerp(za, zb, t)); }
    // 幅とびの軌道の目安
    for (let i = 0; i < 3; i++) acornAt(mx, yb + 1.0 - i * 1.0, zb + 3.5 + i * 4);
    sign(-47.5, 12, -12.2, 0, ['すべり台は しゃがんで すべろう', 'いきおいのまま 幅とび！']);
    // 雪すべりの島
    const ix = mx, iz = zb + 14.5 + 8;
    snowIsland(ix, iz, 8, 0, 7);
    snowBox(ix - 1.2, -0.5, iz + 1.3, ix + 1.2, 0.6, iz + 3.7, 'stone');
    seedAt(3, ix, 0.6, iz + 2.5, '雪すべりの島');
    snowPine(ix - 4.5, 0, iz + 3, 0.9); snowRock(ix + 4.5, 0, iz + 3.5, 0.9);
    drifts(ix, iz, 2, 7.5, 0, 14, [[ix, iz + 2.5, 2]]);
    acornRing(ix, 0, iz, 4.2, 6, 0.5);
    // 帰り：ふきあげの穴で中央の雪原へ
    const dl = Math.hypot(ix, iz), ux = -ix / dl, uz = -iz / dl;
    launcher(ix + ux * 5, 0, iz + uz * 5, Math.atan2(ux, uz), 27, 28);
    S2.slideLauncher = Level.launchers[Level.launchers.length - 1];
  }

  // ================= 種4 南：つららの谷 =================
  {
    const hw = 2.2, wz0 = 23, wz1 = 58;
    // 床（とちゅうに穴が2つ）
    const floors = [[22, 30], [33.2, 40], [43.2, 52]];
    for (const [a, b] of floors) snowBox(-hw, -4, a, hw, 0, b);
    // 両側の岩のかべ・奥のかべ・高い棚
    const wallC = (p, n) => (n[1] > 0.5 ? SNOW : mixc(ROCKDK, ROCK, clamp(p[1] * 0.6 + 0.4 + 0.12 * Math.sin(p[1] * 9 + p[2] * 2), 0, 1)));
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -6.5 : hw, xb = sx < 0 ? -hw : 6.5;
      World.box(xa, -6, wz0, xb, 9, wz1, 'stone');
      g.box(T((xa + xb) / 2, 1.5, (wz0 + wz1) / 2, xb - xa, 15, wz1 - wz0), wallC);
    }
    World.box(-hw, -6, 56, hw, 9, wz1, 'stone');
    g.box(T(0, 1.5, 57, hw * 2, 15, 2), wallC);
    snowBox(-hw, -4, 52, hw, 4.6, 56, 'stone');
    seedAt(4, 0, 4.6, 54.4, 'つららの谷のおく');
    heartAt(1.2, 4.6, 53);
    // 張り出した岩と、つらら
    const spots = [[1, 26.5], [-1, 28.5], [1, 35], [-1, 37.2], [1, 44.5], [-1, 46.8], [0.9, 49.5]];
    for (const [sx, z] of spots) {
      const x = sx * 1.05;
      const ex = sx > 0 ? hw : -hw;
      g.box(T((ex + x * 0.55) / 2 + sx * 0.1, 6.9, z, Math.abs(ex - x * 0.55) + 0.2, 0.7, 1.8), wallC);
      icicle(x, 6.6, z);
    }
    acornLine(0, 0, 24, 0, 0, 29, 3);
    acornLine(0, 1.6, 31, 0, 1.6, 32.4, 2);
    acornLine(0, 0, 34.5, 0, 0, 39, 3);
    acornLine(0, 1.6, 41, 0, 1.6, 42.4, 2);
    acornLine(0, 0, 44.5, 0, 0, 50.5, 4);
    sign(3.2, 0, 21.4, Math.PI, ['つららの谷：上に 気をつけて 走りぬけよう', 'おくの 高い棚へは バク宙（止まって しゃがみ＋ジャンプ）']);
    lamp(-1.6, 0, 51.5);
  }

  // ================= 種5 南東：ゆきだるん広場 =================
  {
    snowBox(18.6, -1, 18.1, 21.2, 0.4, 20.7);
    snowBox(21.7, -1, 20.4, 24.1, 0.8, 22.8);
    acornAt(19.9, 0.4, 19.4); acornAt(22.9, 0.8, 21.6);
    const ix = 34, iz = 30;
    snowIsland(ix, iz, 10, 1.2, 8);
    // 種が出る台と雪の輪
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.sphere(T(ix + Math.cos(a) * 1.8, 1.2, iz + Math.sin(a) * 1.8, 0.45, 0.3, 0.45), SNOW, 7, 4, { flat: true }); }
    seedAt(5, ix, 1.2, iz, 'ゆきだるん広場', true);
    snowmanAt(ix - 5, 1.2, iz - 3, true); snowmanAt(ix + 4.5, 1.2, iz - 4.5, true); snowmanAt(ix + 3, 1.2, iz + 5.5, true);
    hopperAt(ix - 4, 1.2, iz + 4.5, 2.5, true);
    snowPine(ix + 7, 1.2, iz + 3, 0.9); snowPine(ix - 6.5, 1.2, iz + 6, 0.8); snowRock(ix + 6.5, 1.2, iz - 5, 0.8);
    drifts(ix, iz, 2.5, 9, 1.2, 18, [[ix, iz, 2.4]]);
    acornRing(ix, 1.2, iz, 6.8, 8, 0.2);
    heartAt(ix + 7.5, 1.2, iz - 1);
    sign(17.6, 0, 15.2, Math.PI * 0.75, ['ゆきだるんは 雪玉を なげてくる', 'ぜんぶ たおすと…？ ふんでも パンチでも OK']);
  }

  // ================= 種6 北東：灯台の島 =================
  {
    const zc = -20.5;
    snowBox(19, -1, zc - 1.5, 22, 0.4, zc + 1.5);
    mover(29.5, 0.7, zc, 3, 0.6, 3, 'snow', 'x', 25, 34, 0.42);
    acornLine(26, 1.7, zc, 33, 1.7, zc, 3);
    snowBox(36.5, -1, zc - 1.5, 39.5, 1.0, zc + 1.5, 'stone');
    mover(43.2, 0.7, zc, 2.8, 0.6, 2.8, 'snow', 'y', 0.7, 6.7, 0.38);
    // ぐらぐら足場（乗ると すぐ落ちる）
    const fx = [47.6, 50.8, 54.0];
    for (const x of fx) { faller(x, 7.0, zc, 2.4, 2.4); acornAt(x, 7.3, zc); }
    const ix = 62, iz = -21;
    snowIsland(ix, iz, 6.5, 7, 7);
    // 灯台（てっぺんの灯りは drawers で光らせる）
    World.cyl(ix + 2.2, iz - 1.5, 1.6, 7, 16, 'stone');
    // 赤と白のしま（頂点の色では しまが出ないので、輪切りにして重ねる）
    for (let i = 0; i < 6; i++) {
      const r0 = lerp(1.7, 1.33, i / 6), r1 = lerp(1.7, 1.33, (i + 1) / 6);
      g.cyl(T(ix + 2.2, 7 + i * 1.5, iz - 1.5, r0, 1.5, r0), i % 2 ? hex(0xf2efe8) : hex(0xd85a5a), 14, { top: r1 / r0, flat: true, caps: i === 5 });
    }
    g.cyl(T(ix + 2.2, 16, iz - 1.5, 1.5, 0.3, 1.5), hex(0x4a3b55), 14);
    g.cyl(T(ix + 2.2, 17.4, iz - 1.5, 1.4, 0.8, 1.4), hex(0x4a3b55), 14, { top: 0 });
    S2.beacon = [ix + 2.2, 16.85, iz - 1.5];
    seedAt(6, ix - 2, 7, iz + 1, '灯台の島');
    snowmanAt(ix - 2.5, 7, iz - 3.5);
    heartAt(ix + 2.5, 7, iz + 3);
    acornRing(ix - 2, 7, iz + 1, 2.8, 5, 0.6);
    lamp(ix - 5, 7, iz - 1);
    // 帰り：ふきあげの穴で中央の雪原へ
    const dl = Math.hypot(ix, iz), ux = -ix / dl, uz = -iz / dl;
    launcher(ix + ux * 4.2 + uz * 2.4, 7, iz + uz * 4.2 - ux * 2.4, Math.atan2(ux, uz), 26, 27);
    sign(18.5, 0, -17.6, -Math.PI * 0.75, ['灯台の島へ！', 'ぐらぐら足場は 止まらずに わたろう']);
  }

  // ---- 動く物・飾りのメッシュ（全ステージで使い回す）----
  if (!Models.snowman) buildStage2Models();
  S2.iceSlabMesh = once('s2:slab', () => {
    const gg = new Geo(0.02);
    gg.box(T(0, 0, 0, 2.4, 0.32, 2.4), iceCol);
    const crack = hex(0xffffff);
    gg.box(T(0, 0.17, 0, 2.0, 0.02, 0.07, 0.5), crack);
    gg.box(T(0.3, 0.17, 0.2, 1.3, 0.02, 0.06, -0.9), crack);
    gg.box(T(-0.4, 0.17, -0.3, 0.9, 0.02, 0.06, 1.7), crack);
    gg.box(T(-0.2, 0.17, 0.5, 0.7, 0.02, 0.05, 2.5), crack);
    return gg.mesh();
  });

  // ---------- このステージの仕掛けの動き ----------
  Level.updaters.push(updateStage2);
  Level.drawers.push(drawStage2);
  Level.poundHooks.push((x, y, z) => {
    const s = S2.slab;
    if (S2.broken || !s) return;
    if (x > s.x0 - 0.35 && x < s.x1 + 0.35 && z > s.z0 - 0.35 && z < s.z1 + 0.35 && Math.abs(y - s.y1) < 0.4) {
      S2.broken = true; s.off = true;
      Sound.play('pound');
      Fx.burst((s.x0 + s.x1) / 2, 0.1, (s.z0 + s.z1) / 2, [0.75, 0.95, 1], 22, 7);
      Game.shake = 0.3;
      Game.toast('氷が われた！ 下に ほらあなが…！', 3);
    }
  });
}

// つらら・風・雪玉の動き（updateLevel から毎フレーム呼ぶ）
function updateStage2(dt) {
  const S2 = Level.s2;
  // 遊んでいる間だけ（タイトル・ステージ選びの背景では 主人公に当たらない）
  const playing = P.state !== 'dead' && P.state !== 'win' && (Game.state === undefined || Game.state === 'play');
  // ---- 風のつり橋 ----
  S2.windT += dt;
  const gust = windGust(S2.windT);
  if (gust > 0 && !S2.gustOn) { S2.gustOn = true; if (Sound.noise && s2near(0, -38, 30)) Sound.noise(1.7, 0.1, 500, 1500, 'bandpass', 0, 0.6); }
  if (gust <= 0) S2.gustOn = false;
  S2.gust = gust;
  const B = S2.bridge;
  if (playing && gust > 0 && P.x > B.x0 && P.x < B.x1 && P.z > B.z0 && P.z < B.z1 && P.y > -8) {
    // 風よけのかげ（かべの東側）にいれば押されない
    const shelter = P.y < 2.4 && P.x > -0.85 && S2.walls.some((w) => Math.abs(P.z - w) < 1.3);
    if (!shelter) P.x += WIND.push * gust * dt;
  }
  // ---- つらら ----
  for (const ic of S2.icicles) {
    ic.t += dt;
    if (ic.state === 'idle') {
      ic.grow = Math.min(1, ic.grow + dt * 1.6);
      if (playing && ic.grow >= 1 && Math.abs(P.x - ic.x) < 2.2 && Math.abs(P.z - ic.z) < 3.0 && P.y < ic.y0 - 1) { ic.state = 'shake'; ic.t = 0; Sound.play('skid'); }
    } else if (ic.state === 'shake') {
      if (ic.t > 0.4) { ic.state = 'fall'; ic.t = 0; ic.vy = 0; }
    } else if (ic.state === 'fall') {
      ic.vy = Math.min(ic.vy + 32 * dt, 30);
      ic.y -= ic.vy * dt;
      const tip = ic.y - 1.25;
      if (playing && Math.abs(P.x - ic.x) < 0.75 && Math.abs(P.z - ic.z) < 0.75 && tip < P.y + P.h && ic.y > P.y + 0.3) {
        playerHurt(ic.x, ic.z);
        shatterIcicle(ic);
        continue;
      }
      const gb = groundBelow(ic.x, ic.z, ic.y, 0);
      if ((gb && tip <= gb.y) || ic.y < World.killY) shatterIcicle(ic, gb ? gb.y : null);
    } else if (ic.state === 'gone' && ic.t > 3) {
      ic.state = 'idle'; ic.t = 0; ic.y = ic.y0; ic.grow = 0;
    }
  }
  // ---- 雪玉 ----
  const balls = S2.balls;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.t += dt;
    const py = b.y;
    b.vy -= 20 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    let hit = false;
    if (playing && Math.hypot(P.x - b.x, P.y + 0.65 - b.y, P.z - b.z) < 0.85) { playerHurt(b.x - b.vx * 0.05, b.z - b.vz * 0.05); hit = true; }
    const gb = !hit && groundBelow(b.x, b.z, py + 0.3, 0);
    if (hit || (gb && b.y - 0.3 <= gb.y) || b.t > 4 || b.y < World.killY) {
      Fx.burst(b.x, b.y, b.z, [1, 1, 1], 6, 3);
      balls.splice(i, 1);
    }
  }
}
function s2near(x, z, r) { return Math.hypot(P.x - x, P.z - z) < r; }
function shatterIcicle(ic, gy) {
  ic.state = 'gone'; ic.t = 0;
  Fx.burst(ic.x, gy !== null && gy !== undefined ? gy + 0.2 : ic.y - 1, ic.z, [0.75, 0.95, 1], 10, 4);
  Sound.play('hit');
}

// ゆきだるん：主人公の方を向き、近ければ雪玉を山なりに投げる。踏む・パンチ・ヒップドロップでたおせる
function updateSnowman(e, dt) {
  e.t += dt;
  e.squish = lerp(e.squish, 1, dt * 8);
  const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz), dy = P.y - e.y;
  const see = dist < 14 && Math.abs(dy) < 6 && P.state !== 'dead' && P.state !== 'win';
  if (see) e.yaw += clamp(angDiff(e.yaw, Math.atan2(dx, dz)), -dt * 3, dt * 3);
  else e.yaw += dt * 0.3;
  e.cd -= dt;
  if (e.wind > 0) {
    // 投げる前の ふりかぶり（0.45秒）
    e.wind -= dt;
    if (e.wind <= 0) {
      const T0 = 0.6 + dist * 0.035;
      const sx = e.x + Math.sin(e.yaw) * 0.6, sy = e.y + 1.6, sz = e.z + Math.cos(e.yaw) * 0.6;
      const tx = P.x, ty = P.y + 0.65, tz = P.z;
      Level.s2.balls.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / T0, vy: (ty - sy + 0.5 * 20 * T0 * T0) / T0, vz: (tz - sz) / T0, t: 0 });
      Sound.play('punch');
      e.squish = 0.85;
    }
  } else if (see && e.cd <= 0 && dist > 2.2 && dist < 13) {
    e.wind = 0.45; e.cd = 2.6;
  }
  // 足元（動く足場にも乗れるように）
  const gb = groundBelow(e.x, e.z, e.y + 0.5, 0.3);
  if (gb) { e.y = gb.y; e.x += gb.s.dx; e.z += gb.s.dz; }
  else { e.y -= 10 * dt; if (e.y < World.killY) e.alive = false; }
  enemyTouch(e, 0.68, 1.9);
}

function drawSnowman(e, tint) {
  const lean = e.wind > 0 ? Math.sin((0.45 - e.wind) / 0.45 * Math.PI) * -0.25 : 0;
  const bob = 1 + Math.sin(e.t * 3) * 0.02;
  const sq = e.squish * bob;
  drawMesh(Models.snowman, T(e.x, e.y, e.z, 1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq), e.yaw, lean), tint);
  drawShadow(e.x, e.y + 0.1, e.z, 0.8);
}

// つらら・割れる氷・光・雪のふる様子
function drawStage2(t, tint) {
  const S2 = Level.s2;
  if (!S2) return;
  if (!S2.broken && S2.slab) {
    const s = S2.slab;
    drawMesh(S2.iceSlabMesh, T((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2), tint);
  }
  for (const ic of S2.icicles) {
    if (ic.state === 'gone') continue;
    const sh = ic.state === 'shake' ? Math.sin(t * 70) * 0.07 : 0;
    const k = ic.grow;
    drawMesh(Models.icicle, T(ic.x + sh, ic.y, ic.z, k, k, k), ic.state === 'shake' ? ICICLE_WARN : tint, 0.15);
  }
  for (const b of S2.balls) drawMesh(Models.snowball, T(b.x, b.y, b.z, 1, 1, 1, b.t * 6), WHITE, 0.2);
  for (const c of S2.crystals) drawMesh(Models.crystal, T(c.x, c.y, c.z, c.s, c.s, c.s, c.a), WHITE, 0.45);
  if (R.pass === 'shadow') return;
  // 灯り・灯台の光
  for (const l of S2.lamps) Sprites.add(l[0], l[1], l[2], 1.1 + Math.sin(t * 3 + l[0]) * 0.06, 1, 1, 0.78, 0.45, 0.45);
  if (S2.beacon) {
    const b = S2.beacon;
    Sprites.add(b[0], b[1], b[2], 4.5 + Math.sin(t * 2) * 0.4, 2, 1, 0.85, 0.5, 0.75);
    Sprites.add(b[0] + Math.sin(t * 1.2) * 2.2, b[1], b[2] + Math.cos(t * 1.2) * 2.2, 2.4, 2, 1, 0.9, 0.6, 0.5);
  }
  for (const c of S2.crystals) Sprites.add(c.x, c.y + c.s * 0.8, c.z, c.s * 2.2, 2, 0.5, 0.85, 1, 0.35);
  // ふる雪：カメラのまわりの箱の中で、時間から位置を決める（状態を持たない）
  const cx = R.cam[0], cy = R.cam[1], cz = R.cam[2];
  const wx = S2.gust > 0 && cz < -18 && cz > -60 ? S2.gust * 9 : 0;
  for (let i = 0; i < 160; i++) {
    const h1 = fract(Math.sin(i * 12.9898) * 43758.5), h2 = fract(Math.sin(i * 78.233) * 12345.6), h3 = fract(Math.sin(i * 39.425) * 24634.6);
    const x = cx + wrapM(h1 * 44 + t * (0.6 + wx) + Math.sin(t * 0.8 + i) * 0.4 - cx, 44) - 22;
    const y = cy + 14 - wrapM(h2 * 28 + t * (1.2 + h3 * 0.8), 28);
    const z = cz + wrapM(h3 * 44 + t * 0.3 - cz, 44) - 22;
    Sprites.add(x, y, z, 0.07 + h3 * 0.06, 1, 1, 1, 1, 0.75);
  }
  // 風のつり橋：強い風の雪けむり
  if (S2.gust !== 0) {
    const k = S2.gust < 0 ? 0.25 : S2.gust;
    for (let i = 0; i < 46; i++) {
      const h1 = fract(Math.sin(i * 3.17) * 9182.7), h2 = fract(Math.sin(i * 7.71) * 5531.3);
      const x = -9 + wrapM(h1 * 18 + t * (S2.gust < 0 ? 5 : 15), 18);
      const z = -24 - h2 * 30, y = -0.3 + fract(h1 * 7.3) * 2.6;
      Sprites.add(x, y, z, 0.35 + h2 * 0.3, 0, 1, 1, 1, 0.35 * k);
    }
  }
}
const ICICLE_WARN = [1, 0.75, 0.75];
const fract = (v) => v - Math.floor(v);
const wrapM = (v, m) => ((v % m) + m) % m;

// ステージ2の新しいモデル（全ステージで共通に使える）
function buildStage2Models() {
  // ---- ゆきだるん：雪玉2段の からだ、青い毛糸のぼうし、えだの手 ----
  {
    const g = new Geo();
    const snow = (p) => mixc(hex(0xdfe6f6), hex(0xffffff), clamp(p[1] * 0.6 + 0.6, 0, 1));
    g.sphere(T(0, 0.62, 0, 0.68, 0.62, 0.68), snow, 16, 10);
    g.sphere(T(0, 1.5, 0, 0.47, 0.44, 0.47), snow, 14, 9);
    for (const sx of [-1, 1]) {
      g.sphere(T(sx * 0.17, 1.6, 0.39, 0.07, 0.09, 0.05), COL.eye, 8, 5);         // 目
      g.box(T(sx * 0.18, 1.74, 0.38, 0.16, 0.035, 0.03, 0, 0, sx * -0.35), COL.eye); // おこりまゆ
      g.sphere(T(sx * 0.3, 1.43, 0.32, 0.08, 0.05, 0.03), hex(0xffa0b0), 6, 4);   // ほっぺ
      // えだの手
      const arm = T(sx * 0.6, 0.95, 0, 1, 1, 1, 0, 0, sx * -1.0);
      M4.scale(arm, 0.05, 0.55, 0.05);
      g.cyl(arm, hex(0x6b4a33), 5);
      g.cyl(T(sx * 0.98, 1.2, 0, 0.035, 0.22, 0.035, 0, 0, sx * -0.3), hex(0x6b4a33), 4);
    }
    g.box(T(0, 1.4, 0.44, 0.16, 0.04, 0.03), COL.eye); // への字の口
    g.cyl(T(0, 1.52, 0.42, 0.06, 0.2, 0.06, 0, Math.PI / 2), hex(0x9d8cd8), 6, { top: 0 }); // 紫の石の はな
    // ぼうし（青い毛糸）とぽんぽん
    g.cyl(T(0, 1.78, 0, 0.42, 0.36, 0.42), (p) => (p[1] < 0.3 ? hex(0x2f7fc4) : hex(0x4fa8e6)), 14, { top: 0.55 });
    g.sphere(T(0, 2.2, 0, 0.14, 0.14, 0.14), COL.white, 8, 6);
    // ボタンの石
    for (let i = 0; i < 2; i++) g.sphere(T(0, 0.55 + i * 0.3, 0.66 - i * 0.04, 0.07, 0.07, 0.04), hex(0x4a4566), 6, 4);
    Models.snowman = g.mesh();
  }
  Models.snowball = new Geo().sphere(T(0, 0, 0, 0.28, 0.28, 0.28), (p) => mixc(hex(0xd8e2f4), COL.white, p[1] * 0.5 + 0.5), 10, 6, { flat: true }).mesh();
  // つらら（根元が原点、下へのびる）
  Models.icicle = new Geo().cyl(T(0, -1.25, 0, 0.3, 1.25, 0.3), (p) => mixc(hex(0xe8f8ff), hex(0x8fd3ff), clamp(-p[1], 0, 1)), 7, { bottom: 0, flat: true }).cyl(T(0, -0.1, 0, 0.42, 0.18, 0.42), hex(0xf3f7ff), 7).mesh();
  // 氷の結晶（ほらあな・雪山の飾り）
  {
    const g = new Geo();
    const c = (p) => mixc(hex(0x7fd0ff), hex(0xe8fbff), clamp(p[1] * 0.7, 0, 1));
    g.cyl(T(0, 0, 0, 0.3, 1.3, 0.3), c, 6, { top: 0, flat: true });
    g.cyl(T(0.32, 0, 0.1, 0.2, 0.85, 0.2, 0, 0, -0.45), c, 6, { top: 0, flat: true });
    g.cyl(T(-0.28, 0, -0.12, 0.22, 0.95, 0.22, 0, 0.3, 0.4), c, 6, { top: 0, flat: true });
    g.cyl(T(0.05, 0, -0.32, 0.16, 0.6, 0.16, 0, -0.5, 0), c, 6, { top: 0, flat: true });
    Models.crystal = g.mesh();
  }
}
