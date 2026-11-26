// ステージ3「ほしぞらの空島」：月あかりの夜空に浮かぶ、星とキノコの島
//
// 地図（上が北＝ -z、右が東＝ +x）
//   中央：ほしみの丘（半径22、高さ0）。スタートは南側 (0,14)
//   北  ：月の池（体がかるくなる）→ ふわふわ足場をのぼって 月見台 …………… 種0
//   東  ：星座の広場（5つの星の石をパンチで光らせる）→ 光の橋 → 星座の島 … 種1
//   南西：ワープの輪（うかんでいる星と同じ色の輪をくぐる）→ ほうき星の岬 … 種2
//   西  ：光るキノコの森（大きなキノコにヒップドロップで大ジャンプ）→ 崖の上 … 種3
//   南東：星くずの原っぱ（星の時計をふむと、45秒で星のかけら6こ。体がかるい）… 種4
//   南  ：星の観覧車（ゴンドラに乗って てっぺんで とびうつる）→ 見はらし台 … 種5
//   北東：星の門（このステージの種4こで開く）→ ねじまき時計の空島（ボス）…… 種6
//   ボスをたおして 種6を取ると エンディング（74_boss.js）
defineStage({
  id: 2, name: 'ほしぞらの空島', sub: '月あかりと 星くずの島',
  killY: -32, seed: 20261127, seedTotal: 7,
  start: { x: 0, y: 0, z: 14, yaw: Math.PI },
  // 夜空：天頂は深い紺、地平線は青むらさき。月あかりは北の高いところから（月の絵は 見やすい低めの高さに描く）
  env: {
    top: [0.03, 0.05, 0.17], bottom: [0.13, 0.12, 0.3], sun: [0.42, 0.48, 0.78],
    fogCol: [0.14, 0.16, 0.36], fog: [55, 175], light: [0.3, 0.78, -0.55],
    lightCol: [0.66, 0.74, 1.0], ambLo: [0.34, 0.28, 0.5], ambHi: [0.4, 0.48, 0.9], // 月の光
  },
  music: { key: 2, bpm: 100 },
  bossMusic: { key: -2, bpm: 152 },  // ボス戦の曲（同じ曲を 調とテンポを変えて）
  endMusic: { key: 5, bpm: 92 },     // エンディング
  tint: [0.9, 0.93, 1.08],
  cloud: { lo: hex(0x232a5c), far: hex(0x343a78), top: hex(0x6a70b4) },
  titleCam: { r: 74, y: 30, tx: 4, ty: 4, tz: -4 },
  color: '#b9a8ff',
  unlock: { stage: 1, seeds: 4 },
  ending: { seed: 6 },               // この種を取るとエンディング
  build: buildStage3,
});

const S3C = {
  LOWG: 22,          // 体がかるくなるエリアで 毎秒たす上向きの速さ（重力 40 → 18）
  GATE_NEED: 4,      // 星の門が開くのに必要な、このステージの種の数
  SHARD_TIME: 45,    // 星のかけら集めの時間（秒）
};
const SQ = Math.SQRT1_2;
const S3COL = {
  red: [1, 0.42, 0.5], blue: [0.42, 0.68, 1], yellow: [1, 0.86, 0.32], white: [0.92, 0.95, 1],
  star: [1, 0.92, 0.55], starOff: [0.42, 0.46, 0.68], tile: [0.55, 0.85, 1], shard: [1, 0.9, 0.45],
};

function buildStage3(K) {
  const { g, rng, once, kindColor, sign, mover, launcher, acornAt, acornLine, acornRing, seedAt, heartAt, blobAt, hopperAt } = K;
  const S3 = Level.s3 = {
    zones: [], glows: [], stars: [], litOrder: [], btiles: [], bridgeOn: false, bridgeT: 0,
    rings: [], hints: [], warpCd: 0, shrooms: [], pend: null,
    shards: [], shardOn: false, shardT: 0, shardDone: false, clock: null, lastTick: 0,
    wheel: null, gond: [], gate: null, gtiles: [], gateOpen: false, gateT: 0, gateArmed: true,
    boss: null, inZone: false, floats: [],
  };
  Level.hud = drawStage3Hud;

  // ---------- 色 ----------
  const NG1 = hex(0x4a5aa6), NG2 = hex(0x6476c4), NSOIL = hex(0x3c356a), NSOIL2 = hex(0x272250);
  const MOON = hex(0xb4bce4), MOONDK = hex(0x7a82b2), ROCK = hex(0x6e6aa2), ROCKDK = hex(0x45417a);
  const nightGrass = (p, n) => (n[1] > 0.5 ? mixc(NG1, NG2, 0.5 + 0.5 * Math.sin(p[0] * 2.7 + p[2] * 1.9)) : p[1] > 0.7 ? NG1 : NSOIL);
  const soilSide = (p) => mixc(NSOIL2, NSOIL, clamp(p[1] * 0.9 + 0.1 + 0.1 * Math.sin(p[1] * 10 + p[0] * 2), 0, 1));
  const moonTop = (p, n) => (n[1] > 0.5 ? mixc(MOONDK, MOON, 0.7 + 0.3 * Math.sin(p[0] * 5 + p[2] * 4)) : MOONDK);
  const rockCol = (p) => mixc(ROCKDK, ROCK, clamp(p[1] * 0.6 + 0.5, 0, 1));

  // ---------- 部品 ----------
  const glow = (x, y, z, size, c, a = 0.5) => S3.glows.push([x, y, z, size, c[0], c[1], c[2], a, rng() * TAU]);
  function nightIsland(x, z, r, top, depth = 8) {
    World.cyl(x, z, r, top - depth * 0.6, top, 'grass');
    g.cyl(T(x, top - 0.6, z, r, 0.6, r), nightGrass, 32);
    g.cyl(T(x, top - 0.6 - depth, z, r * 0.98, depth, r * 0.98), soilSide, 28, { bottom: 0.2, top: 1, caps: false, flat: true });
    // 島の下の 光る結晶（見た目だけ）
    const n = Math.max(3, Math.round(r * 0.6));
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, rr = r * (0.25 + rng() * 0.45), l = 1.5 + rng() * 2.5;
      const cx = x + Math.cos(a) * rr, cz = z + Math.sin(a) * rr, cy = top - 0.6 - depth * (0.75 - rr / r * 0.4);
      g.cyl(T(cx, cy - l, cz, 0.35, l, 0.35, rng() * 3), hex(0x9fb8ff), 5, { bottom: 0, flat: true });
      if (i % 2 === 0) glow(cx, cy - l * 0.6, cz, 1.6, [0.55, 0.7, 1], 0.35);
    }
  }
  // 月の石の道・台（当たり判定つき）
  function moonBlock(cx, cy, cz, sx, sy, sz, kind = 'stone') {
    const s = World.boxC(cx, cy, cz, sx, sy, sz, kind);
    g.box(T(cx, cy, cz, sx, sy, sz), moonTop);
    return s;
  }
  // 回転した月の石の板（ang は 70_level.js の oblock と同じ決まり）
  function moonOBlock(cx, cz, sx, sz, ang, y0, y1) {
    const s = World.obox(cx, cz, sx, sz, ang, y0, y1, 'stone');
    g.box(T(cx, (y0 + y1) / 2, cz, sx, y1 - y0, sz, ang), moonTop);
    return s;
  }
  function starTree(x, y, z, s = 1) {
    World.cyl(x, z, 0.4 * s, y, y + 3 * s, 'wood');
    g.cyl(T(x, y, z, 0.3 * s, 3 * s, 0.3 * s), hex(0x5a4470), 7, { top: 0.6, flat: true });
    const leaf = (p) => mixc(hex(0x23406e), hex(0x3c67a6), clamp(p[1] * 0.5 + 0.5, 0, 1));
    g.sphere(T(x, y + 3.4 * s, z, 1.6 * s, 1.3 * s, 1.6 * s), leaf, 10, 7, { flat: true });
    g.sphere(T(x + 0.8 * s, y + 2.8 * s, z + 0.3 * s, 1.0 * s, 0.8 * s, 1.0 * s), leaf, 8, 6, { flat: true });
    // 星の実（光る）
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      const fx = x + Math.cos(a) * 1.3 * s, fz = z + Math.sin(a) * 1.3 * s, fy = y + (2.8 + rng() * 1.2) * s;
      g.sphere(T(fx, fy, fz, 0.16, 0.16, 0.16), hex(0xfff2a0), 6, 4);
      glow(fx, fy, fz, 0.8, [1, 0.9, 0.5], 0.4);
    }
  }
  function nightRock(x, y, z, s) {
    World.cyl(x, z, s * 0.9, y - 1, y + s * 0.9, 'stone');
    g.sphere(T(x, y, z, s, s * 0.9, s * 0.95, rng() * 3), rockCol, 7, 5, { flat: true });
  }
  // 光るキノコ（飾り。乗れない小さいもの）
  const SHROOM_COLS = [[0.45, 1, 0.9], [1, 0.55, 0.85], [0.6, 0.75, 1], [1, 0.9, 0.45]];
  function tinyShroom(x, y, z, s) {
    const c = SHROOM_COLS[Math.floor(rng() * SHROOM_COLS.length)];
    g.cyl(T(x, y, z, 0.06 * s, 0.35 * s, 0.06 * s), hex(0xe8e2ff), 5, { caps: false });
    g.sphere(T(x, y + 0.36 * s, z, 0.22 * s, 0.13 * s, 0.22 * s), shade(c, 0.95), 7, 4, { flat: true });
    glow(x, y + 0.4 * s, z, 0.45 * s, c, 0.2);
  }
  // 草と小さなキノコをまく（avoid の中には置かない）
  function scatterNight(cx, cz, r0, r1, y, n, avoid = []) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = r0 + rng() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      if (rng() < 0.3) tinyShroom(x, y, z, 0.8 + rng() * 0.7);
      else for (let k = 0; k < 3; k++) {
        const b = rng() * TAU;
        g.cyl(T(x + Math.cos(b) * 0.12, y, z + Math.sin(b) * 0.12, 0.07, 0.28 + rng() * 0.2, 0.07, b, (rng() - 0.5) * 0.5), NG1, 3, { top: 0, flat: true, caps: false });
      }
    }
  }
  // 灯り（月の石の柱と星のランプ）
  function starLamp(x, y, z) {
    World.cyl(x, z, 0.18, y, y + 1.6, 'stone').noCam = true;
    g.cyl(T(x, y, z, 0.1, 1.5, 0.1), MOONDK, 6);
    g.sphere(T(x, y + 1.68, z, 0.2, 0.2, 0.2), hex(0xfff2b0), 8, 5);
    glow(x, y + 1.68, z, 1.4, [1, 0.88, 0.55], 0.55);
  }
  // 体がかるくなるエリア（円柱）。見た目の粒は drawers で描く
  const zone = (x, z, r, y0, y1, base) => S3.zones.push({ x, z, r, y0, y1, base });

  // ================= 中央：ほしみの丘 =================
  nightIsland(0, 0, 22, 0, 10);
  starTree(-9, 0, 8, 1); starTree(10, 0, 9, 0.9); starTree(-13, 0, -6, 1.1); starTree(15, 0, -4, 1.0); starTree(-4, 0, -15, 0.8);
  nightRock(6, 0, 17, 1.1); nightRock(-17, 0, 3, 0.9); nightRock(17, 0, -2, 0.8);
  scatterNight(0, 0, 3, 21, 0, 120, [[0, 14, 2], [0, -21, 3], [21, 0, 3], [-21, 0, 3], [0, 21, 3], [15, 15, 3], [-15, 15, 3], [15, -15, 3]]);
  starLamp(2.2, 0, -20.5); starLamp(-2.2, 0, -20.5); starLamp(20.5, 0, 2.4); starLamp(-20.5, 0, -2.4); starLamp(2.4, 0, 20.5); starLamp(-2.4, 0, 20.5);
  sign(2.4, 0, 11.5, 0, ['ひかりの種は ぜんぶで 7こ', '北東の 星の門は 種を 4こ 集めると ひらく']);
  acornRing(0, 0, 9, 2.6, 6);
  acornLine(0, 0, 4, 0, 0, -12, 4);
  blobAt(8, 0, -4, 4); blobAt(-9, 0, -1, 4);
  heartAt(-6, 0, 16);

  // ================= 種0 北：月の池 → ふわふわ足場 → 月見台 =================
  {
    const cx = 0, cz = -46;
    moonBlock(0, -0.3, -29.3, 4, 0.6, 16.4);
    acornLine(0, 0, -24, 0, 0, -34, 4);
    // 月の池（まわりは体がかるい）
    World.cyl(cx, cz, 9, -6, 0, 'stone');
    g.cyl(T(cx, -0.5, cz, 9, 0.5, 9), moonTop, 32);
    g.cyl(T(cx, -6.5, cz, 8.8, 6, 8.8), rockCol, 24, { bottom: 0.3, caps: false, flat: true });
    g.cyl(T(cx, 0.01, cz, 4, 0.02, 4), hex(0x7f9cff), 24);   // 池（光る水面は drawers で）
    g.cyl(T(cx, 0.015, cz, 3.3, 0.02, 3.3), hex(0xa8c0ff), 24);
    zone(cx, cz, 13.5, -14, 40, 0);
    acornRing(cx, 0, cz, 6.2, 6, 0.3);
    // ふわふわ足場（上下にゆれる）：らせんに 5 つ、4.5m ずつ高くなる
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + i * TAU / 5, r = 6.6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, top = 4.5 * (i + 1);
      S3.floats.push(mover(x, top - 0.3, z, 3, 0.6, 3, 'cloud', 'y', top - 0.3 - 0.35, top - 0.3 + 0.35, 0.32, i * 0.37));
      acornAt(x, top + 0.6, z);
    }
    // 月見台（てっぺん）
    const tt = 26.5;
    World.cyl(cx, cz, 2.6, tt - 1.2, tt, 'stone');
    g.cyl(T(cx, tt - 1.2, cz, 2.6, 1.2, 2.6), moonTop, 20, { bottom: 0.4, flat: true });
    g.torus(T(cx, tt + 0.05, cz, 1, 1, 1), hex(0xf0c75a), 2.45, 0.12, 24, 6);
    glow(cx, tt + 0.3, cz, 4, [0.7, 0.8, 1], 0.25);
    seedAt(0, cx, tt, cz, '月見台のてっぺん');
    acornRing(cx, tt, cz, 1.7, 4, 0.8);
    sign(-2.6, 0, -23, Math.PI, ['月の池のまわりは 体が かるくなる！', 'ふわふわ足場を のぼって 月見台へ']);
    heartAt(4.5, 0, -50);
  }

  // ================= 種1 東：星座の広場 → 光の橋 → 星座の島 =================
  {
    moonBlock(26, -0.3, 0, 9, 0.6, 4);
    acornLine(23, 0, 0, 29, 0, 0, 3);
    nightIsland(38, 0, 9, 0, 8);
    // 星の石（台の高さはいろいろ）。パンチで光る
    const STONES = [[33, -4.5, 0], [36, -7, 1.4], [40.5, -6, 2.3], [44, -2.5, 1.4], [41, 4, 0]];
    for (const [x, z, h] of STONES) {
      if (h > 0) {
        World.boxC(x, h / 2 - 1, z, 2.6, h + 2, 2.6, 'stone');
        g.box(T(x, h / 2 - 1, z, 2.6, h + 2, 2.6), moonTop);
      }
      World.cyl(x, z, 0.45, h, h + 1.05, 'stone');
      g.cyl(T(x, h, z, 0.45, 1.05, 0.45), rockCol, 8, { top: 0.7, flat: true });
      S3.stars.push({ x, z, base: h, y: h + 1.7, lit: false, t: rng() * 5 });
    }
    acornAt(36, 1.4, -5.8); acornAt(40.5, 2.3, -4.8);
    acornRing(38, 0, 0, 4.5, 6, 0.2);
    blobAt(36, 0, 4, 2.5);
    heartAt(34, 0, 5);
    // 光の橋（星を全部つなぐと 西から順にあらわれる）
    for (let i = 0; i < 6; i++) {
      const x = 47.5 + i * 2.5;
      const s = World.boxC(x, -0.2, 0, 2.3, 0.4, 2.4, 'stone');
      s.off = true;
      S3.btiles.push({ s, x, k: i });
      acornAt(x, 0.4, 0);
    }
    // 星座の島
    nightIsland(66, 0, 6, 0, 7);
    g.cyl(T(67, 0, 0, 1.3, 0.3, 1.3), moonTop, 16);
    World.cyl(67, 0, 1.3, -1, 0.3, 'stone');
    seedAt(1, 67, 0.3, 0, '星座の島');
    starTree(68, 0, -3.5, 0.8);
    acornRing(66, 0, 0, 3.8, 5, 0.9);
    sign(31, 0, 3.2, -Math.PI / 2, ['5つの 星の石を パンチで 光らせよう', 'ぜんぶ つなぐと…？（高い石は ジャンプで台へ）']);
  }

  // ================= 種3 西：光るキノコの森 → 崖の上 =================
  {
    moonBlock(-26, -0.3, 0, 9, 0.6, 5);
    acornLine(-23, 0, 0, -29, 0, 0, 3);
    nightIsland(-40, 0, 11, 0, 9);
    // きのこの崖（高さ10）
    World.box(-58, -9, -6.5, -47, 10, 6.5, 'stone');
    g.box(T(-52.5, 0.5, 0, 11, 19, 13), (p, n) => (n[1] > 0.5 ? NG2 : mixc(ROCKDK, ROCK, clamp(p[1] * 0.5 + 0.5 + 0.12 * Math.sin(p[1] * 13 + p[2] * 3), 0, 1))));
    // 崖の横にはえた 光るキノコ（飾り）
    for (let i = 0; i < 7; i++) {
      const y = 1.5 + i * 1.2, z = -5 + rng() * 10;
      g.cyl(T(-46.9, y, z, 0.6, 0.12, 0.6, 0, 0, Math.PI / 2 * 0.15), hex(0x7fffe0), 8);
      glow(-46.6, y + 0.1, z, 1.0, [0.45, 1, 0.9], 0.45);
    }
    // 大きなキノコ（ヒップドロップで 大ジャンプ）と 小さなキノコ（ふつうに はねる）
    const shroom = (x, z, r, top, big) => {
      const s = World.cyl(x, z, r, -1, top, 'wood');
      s.noSafe = true;
      g.cyl(T(x, 0, z, r * 0.32, top - 0.5, r * 0.32), hex(0xece6ff), 10, { flat: true });
      const c = big ? [0.4, 1, 0.88] : [1, 0.55, 0.85];
      g.sphere(T(x, top - 0.35, z, r * 1.05, 0.55, r * 1.05), (p, n) => (n[1] > 0.3 ? shade(c, 0.95) : shade(c, 0.6)), 14, 6, { flat: true });
      for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + rng(); g.sphere(T(x + Math.cos(a) * r * 0.6, top + 0.08, z + Math.sin(a) * r * 0.6, 0.18, 0.08, 0.18), WHITE, 6, 3); }
      S3.shrooms.push({ s, x, z, r, top, big, boing: 0, c });
      glow(x, top + 0.2, z, r * 2.2, c, big ? 0.4 : 0.3);
    };
    shroom(-43, 0, 1.6, 1.4, true);
    shroom(-35, -6, 1.2, 1.1, false); shroom(-37.5, 6, 1.2, 1.1, false); shroom(-32.5, 4.5, 1.0, 0.9, false);
    acornLine(-35, 3.2, -6, -35, 4.4, -6, 2); acornLine(-37.5, 3.2, 6, -37.5, 4.4, 6, 2); acornAt(-32.5, 3.2, 4.5);
    acornLine(-43, 4, 0, -43, 9.5, 0, 4);
    starTree(-36, 0, 9.2, 0.8); nightRock(-31, 0, -8, 0.8);
    scatterNight(-40, 0, 2, 10, 0, 40, [[-43, 0, 2.4], [-35, -6, 1.8], [-37.5, 6, 1.8], [-32.5, 4.5, 1.6], [-36, 9.2, 1.5]]);
    seedAt(3, -52.5, 10, 0, 'キノコの崖の上');
    acornRing(-52.5, 10, 0, 2.6, 5, 0.4);
    hopperAt(-38, 0, -3, 3);
    sign(-30.5, 0, -3.6, Math.PI / 2, ['キノコに のると はねる！', '大きなキノコに ヒップドロップで 大ジャンプ']);
  }

  // ================= 種2 南西：ワープの輪 → ほうき星の岬 =================
  {
    const dx = -SQ, dz = SQ, ang = Math.atan2(-dz, dx), yawSW = Math.atan2(dx, dz);
    moonOBlock(dx * 25, dz * 25, 10, 3.2, ang, -0.6, 0);
    for (let i = 0; i < 3; i++) acornAt(dx * (22 + i * 3), 0, dz * (22 + i * 3));
    // はじめの島 A（星は青）
    const A = [dx * 35, dz * 35];
    nightIsland(A[0], A[1], 6.5, 0, 7);
    // 島 B（星は黄）、ほうき星の岬 C
    const B = [-54, 54], Bt = 3, C = [-80, 28], Ct = 6;
    nightIsland(B[0], B[1], 6.5, Bt, 7);
    nightIsland(C[0], C[1], 7, Ct, 8);
    const entryA = [dx * 30.5, 0, dz * 30.5, yawSW];
    const yawB = -Math.PI / 2, entryB = [B[0] + 3, Bt, B[1], yawB];
    const yawC = Math.PI * 0.25, entryC = [C[0] - 3.5 * Math.sin(yawC), Ct, C[1] - 3.5 * Math.cos(yawC), yawC];
    const home = [0, 0, 7, Math.PI];
    // 輪を並べる。cols の i 番目の輪は to[i] へ
    const ringRow = (cx, cz, top, yaw, cols, tos, msgs) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
      cols.forEach((col, i) => {
        const off = (i - (cols.length - 1) / 2) * 3.2;
        const x = cx + fx * 3 + sx * off, z = cz + fz * 3 + sz * off;
        S3.rings.push({ x, y: top + 1.45, z, yaw, col: S3COL[col], name: col, to: tos[i], msg: msgs[i], spin: rng() * TAU });
        g.cyl(T(x, top, z, 0.9, 0.12, 0.9), MOONDK, 12);
      });
    };
    ringRow(A[0], A[1], 0, yawSW, ['red', 'blue', 'yellow'], [entryA, entryB, entryA], ['ちがう輪だった… もどされた', '星と同じ色の輪で 正解！', 'ちがう輪だった… もどされた']);
    ringRow(B[0], B[1], Bt, yawB, ['blue', 'yellow', 'red'], [entryA, entryC, entryA], ['ちがう輪だった… はじめの島に もどされた', 'また正解！ ほうき星の岬へ！', 'ちがう輪だった… はじめの島に もどされた']);
    ringRow(C[0], C[1], Ct, yawC, ['white'], [home], ['ほしみの丘へ もどった']);
    // 正解の色を教える星（島の上に うかぶ）
    S3.hints.push({ x: A[0] - dx * 1.5, y: 6.2, z: A[1] - dz * 1.5, col: S3COL.blue });
    S3.hints.push({ x: B[0] + 1.5, y: Bt + 6.2, z: B[1], col: S3COL.yellow });
    seedAt(2, C[0], Ct, C[1], 'ほうき星の岬');
    acornRing(A[0], 0, A[1], 3.2, 3, 0.4);
    acornRing(B[0], Bt, B[1], 3.0, 4, 0.2);
    acornRing(C[0], Ct, C[1], 3.4, 5, 0.6);
    starTree(C[0] + 3.5, Ct, C[1] - 3.5, 0.8);
    heartAt(C[0] - 3, Ct, C[1] + 3);
    hopperAt(B[0] - 2, Bt, B[1] + 3, 2);
    sign(dx * 21 + SQ * 2.4, 0, dz * 21 + SQ * 2.4, yawSW + Math.PI, ['ワープの輪：うかんでいる 星と', '同じ色の輪を くぐろう']);
  }

  // ================= 種4 南東：星くずの原っぱ（時間内に かけら6こ） =================
  {
    const ex = SQ, ez = SQ, ang = Math.atan2(-ez, ex);
    moonOBlock(ex * 24, ez * 24, 8, 3.2, ang, -0.6, 0);
    for (let i = 0; i < 3; i++) acornAt(ex * (21.5 + i * 2.5), 0, ez * (21.5 + i * 2.5));
    const E = [ex * 32, ez * 32];
    nightIsland(E[0], E[1], 6, 0, 7);
    // 星の時計（ふむと 始まる）
    const cs = World.cyl(E[0], E[1], 1.3, -0.4, 0.15, 'stone');
    S3.clock = cs;
    g.cyl(T(E[0], -0.4, E[1], 1.3, 0.55, 1.3), hex(0xf0c75a), 20);
    g.cyl(T(E[0], 0.15, E[1], 1.1, 0.02, 1.1), hex(0xfff4d8), 20);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.box(T(E[0] + Math.cos(a) * 0.9, 0.17, E[1] + Math.sin(a) * 0.9, 0.08, 0.02, 0.2, -a + Math.PI / 2), hex(0x3c356a)); }
    seedAt(4, E[0], 0.15, E[1], '星くずの原っぱ', true);
    // 体がかるいエリアと ふわふわ足場
    const Z = [ex * 50, ez * 50];
    zone(Z[0], Z[1], 15, -14, 30, null);
    const PADS = [[7, 200, 1.5], [9.5, 245, 3.5], [6.5, 300, 5.5], [0, 0, 7], [7, 35, 4.5], [9.5, 85, 2.5], [7.5, 140, 6], [12, 120, 8.5]];
    PADS.forEach(([r, deg, top], i) => {
      const a = deg * Math.PI / 180;
      const x = Z[0] + Math.cos(a) * r, z = Z[1] + Math.sin(a) * r;
      S3.floats.push(mover(x, top - 0.3, z, 3, 0.6, 3, 'cloud', 'y', top - 0.3 - 0.3, top - 0.3 + 0.3, 0.3, i * 0.5));
      acornAt(x, top + 0.5, z);
      if (i !== 0 && i !== 4) S3.shards.push({ x, y: top + 1.6, z, got: false, t: rng() * 5 });
    });
    sign(E[0] - 3.6, 0, E[1] - 1.5, -Math.PI * 0.75, ['星の時計を ふむと スタート！', '45びょうで 星のかけらを 6こ 集めよう']);
    blobAt(E[0] + 2.5, 0, E[1] - 3, 2);
  }

  // ================= 種5 南：星の観覧車 → 見はらし台 =================
  {
    moonBlock(0, -0.3, 26.3, 4, 0.6, 10);
    acornLine(0, 0, 23, 0, 0, 29, 3);
    moonBlock(0, -0.3, 34.05, 8, 0.6, 5.1);
    acornAt(-2.5, 0, 33.5); acornAt(2.5, 0, 33.5);
    const W0 = { cx: 0, cy: 10.3, cz: 38.6, R: 9, a: 0, w: 0.3 };
    S3.wheel = W0;
    for (let i = 0; i < 6; i++) {
      const a0 = -Math.PI / 2 + i * TAU / 6;
      const s = World.boxC(W0.cx + Math.cos(a0) * W0.R, W0.cy + Math.sin(a0) * W0.R, W0.cz, 2.8, 0.5, 2.8, 'wood');
      s.noSafe = true;
      S3.gond.push({ s, a0 });
    }
    // 観覧車の足（見た目だけ。うしろ側）
    for (const sx of [-1, 1]) {
      const len = Math.hypot(7, 22.3), ang = Math.atan2(7 * sx, 22.3);
      g.box(T(sx * 3.5, -0.85, 41.2, 0.5, len, 0.5, 0, 0, ang), hex(0x8a7fc0));
    }
    // 見はらし台（てっぺんの先）
    moonBlock(0, 18.1, 44.5, 6, 1.0, 6);
    g.cyl(T(0, -12, 44.5, 1.2, 29.6, 1.2), rockCol, 10, { top: 1.6, flat: true });
    seedAt(5, 0, 18.6, 44.2, '観覧車の見はらし台');
    acornAt(-2, 18.6, 43); acornAt(2, 18.6, 43); acornAt(0, 18.6, 42.3);
    // 帰り：流れ星の発射台で ほしみの丘へ
    launcher(0, 18.6, 46.5, Math.PI, 12, 28.5);
    S3.wheelLauncher = Level.launchers[Level.launchers.length - 1];
    sign(2.6, 0, 31.4, Math.PI, ['星の観覧車：ゴンドラに のって', 'てっぺんで 奥の台へ とびうつろう']);
  }

  // ================= 種6 北東：星の門 → ねじまき時計の空島（ボス） =================
  {
    const fx = SQ, fz = -SQ, qx = SQ, qz = SQ, ang = Math.atan2(-fz, fx);
    const at = (r, side = 0) => [fx * r + qx * side, fz * r + qz * side];
    // 門の柱とアーチ（島のふち）
    for (const sd of [-2.4, 2.4]) {
      const [x, z] = at(20.6, sd);
      World.cyl(x, z, 0.55, 0, 5, 'stone');
      g.cyl(T(x, 0, z, 0.55, 5, 0.55), moonTop, 10, { flat: true });
      g.sphere(T(x, 5.2, z, 0.5, 0.5, 0.5), hex(0xf0c75a), 8, 6);
    }
    const [gx, gz] = at(20.6);
    g.box(T(gx, 5.3, gz, 0.5, 0.5, 5.4, ang), hex(0xf0c75a));
    // 門のあかり（集めた種の数だけ光る）
    const lamps = [];
    for (let i = 0; i < S3C.GATE_NEED; i++) { const [x, z] = at(20.6, (i - 1.5) * 1.1); lamps.push([x, 4.7, z]); g.sphere(T(x, 4.7, z, 0.22, 0.22, 0.22), hex(0x5a5f90), 8, 5); }
    S3.gate = { x: gx, z: gz, ang, lamps };
    // 門が開くと あらわれる光の階段（島 → 空の階段）
    for (let k = 0; k < 7; k++) {
      const r = 22.6 + k * 1.3, top = 0.375 * (k + 1);
      const [x, z] = at(r);
      const s = World.obox(x, z, 1.42, 3, ang, top - 0.4, top, 'stone');
      s.off = true;
      S3.gtiles.push({ s, x, z, top, k });
    }
    // 空の階段（月の石）。門の先 8m 以上はなれている
    for (let k = 0; k < 8; k++) {
      const r = 31.5 + k * 1.6, top = 3.0 + k * 0.4;
      const [x, z] = at(r);
      moonOBlock(x, z, 1.9, 3.2, ang, top - 0.8, top);
      if (k % 2 === 1) acornAt(x, top, z);
    }
    { const [x, z] = at(37.9); heartAt(x, 4.6, z); }
    // ねじまき時計の空島（大きな時計の文字盤）
    const [ax, az] = at(56.5), top = 6, R = 13.5;
    World.cyl(ax, az, R, -3, top, 'stone');
    g.cyl(T(ax, top - 0.5, az, R, 0.5, R), (p, n) => (n[1] > 0.5 ? hex(0xcfc6ae) : hex(0xa8864a)), 40);
    g.cyl(T(ax, -6, az, R * 0.98, 5.5, R * 0.98), rockCol, 32, { bottom: 0.25, caps: false, flat: true });
    g.torus(T(ax, top + 0.02, az, 1, 1, 1), hex(0xc9a25a), R - 0.35, 0.22, 48, 6);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, big = i % 3 === 0;
      g.box(T(ax + Math.cos(a) * (R - 1.4), top + 0.02, az + Math.sin(a) * (R - 1.4), big ? 0.5 : 0.3, 0.06, big ? 1.6 : 1.0, -a + Math.PI / 2), hex(0x3c356a));
    }
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + 0.2; glow(ax + Math.cos(a) * (R + 0.2), top - 0.6, az + Math.sin(a) * (R + 0.2), 1.6, [1, 0.85, 0.5], 0.45); }
    const [px, pz] = at(45.2);
    seedAt(6, ax, top, az, 'ねじまき時計の空島', true);
    Level.seeds[Level.seeds.length - 1].ending = true;
    S3.boss = makeBoss(ax, top, az, R, [px, top, pz, Math.atan2(fx, fz)]);
    const [sx2, sz2] = at(18.2, 3.2);
    sign(sx2, 0, sz2, Math.atan2(-fx, -fz), ['星の門：この島の ひかりの種を', '4こ 集めると ひらく']);
  }

  // ---- このステージのモデル（全ステージで使い回す）----
  if (!Models.s3star) buildStage3Models();
  if (!Models.bossBody) buildBossModels();
  S3.tileMesh = once('s3:tile', () => new Geo(0.02).box(T(0, 0, 0, 2.3, 0.4, 2.4), (p, n) => (n[1] > 0.5 ? hex(0xd8f0ff) : hex(0x8fb8ff))).mesh());
  S3.gtileMesh = once('s3:gtile', () => new Geo(0.02).box(T(0, 0, 0, 1.42, 0.4, 3), (p, n) => (n[1] > 0.5 ? hex(0xe8dcff) : hex(0xa890ff))).mesh());
  void kindColor;

  // ---------- 仕掛けの動き ----------
  Level.updaters.push(updateStage3);
  Level.drawers.push(drawStage3);
  Level.poundHooks.push((x, y, z) => {
    for (const m of S3.shrooms) {
      if (Math.hypot(x - m.x, z - m.z) < m.r + 0.3 && Math.abs(y - m.top) < 0.25) {
        S3.pend = { s: m.s, v: m.big ? 30 : 21, m };
        return;
      }
    }
  });
}

// 主人公を上へはね上げる（キノコ・ボスをふんだとき）
function s3launch(v) {
  P.grounded = false; P.groundS = null;
  P.state = 'air'; P.airT = 0; P.stateT = 0;
  P.vy = v; P.jumpHeld = true; P.flip = 0.001; P.flipDir = 1;
  P.jumpN = 0; P.fallFrom = P.y; P.poundT = 0; P.longJump = false; P.dive = false;
  P.coyote = 0; P.jumpBuf = 0;
}
// パンチ・キックがその場所に届いているか（reach: 届く距離）
function s3attackHits(x, y, z, reach) {
  const atk = (P.state === 'punch' && P.stateT < 0.25) || P.kickT > 0;
  if (!atk) return false;
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
  if (d > reach || y < P.y - 0.6 || y > P.y + 2.2) return false;
  if (P.kickT > 0 && d < reach * 0.8) return true; // まわしげり・空中キックは まわり全部に当たる
  return d < 0.3 || (dx * Math.sin(P.yaw) + dz * Math.cos(P.yaw)) / d > 0.25;
}
function s3tone(f0, f1, dur, type, vol, delay) { if (typeof Sound.tone === 'function') Sound.tone(f0, f1, dur, type, vol, delay || 0); }
// このステージの種をいくつ持っているか（これまでの分も。ボスの種はのぞく）
function s3seedsHave() {
  let n = 0;
  for (const s of Level.seeds) if (!s.ending && (s.got || s.old)) n++;
  return n;
}

function updateStage3(dt) {
  const S3 = Level.s3;
  const playing = P.state !== 'dead' && P.state !== 'win' && (Game.state === undefined || Game.state === 'play');
  S3.warpCd = Math.max(0, S3.warpCd - dt);

  // ---- 体がかるくなるエリア ----
  S3.inZone = false;
  for (const zn of S3.zones) {
    if (Math.hypot(P.x - zn.x, P.z - zn.z) < zn.r && P.y > zn.y0 && P.y < zn.y1) { S3.inZone = true; break; }
  }
  if (S3.inZone && (P.state === 'air' || P.state === 'hurt')) P.vy += S3C.LOWG * dt;

  // ---- キノコ：ヒップドロップは大ジャンプ、ふつうの着地は小さく はねる ----
  if (S3.pend) {
    const pd = S3.pend;
    S3.pend = null;
    if (P.grounded && P.groundS === pd.s) {
      s3launch(pd.v);
      pd.m.boing = 1;
      Sound.play('spring');
      s3tone(300, 1200, 0.35, 'triangle', 0.12);
      Fx.burst(pd.m.x, pd.m.top + 0.3, pd.m.z, pd.m.c, 18, 6);
    }
  } else if (P.grounded && P.state === 'ground' && P.landT < 0.02) {
    for (const m of S3.shrooms) {
      if (P.groundS !== m.s) continue;
      s3launch(m.big ? 13 : 15.5);
      m.boing = 1;
      Sound.play('spring');
      Fx.burst(P.x, m.top + 0.2, P.z, m.c, 6, 3);
      break;
    }
  }
  for (const m of S3.shrooms) m.boing = Math.max(0, m.boing - dt * 3);

  // ---- 星の石：パンチで光る。全部光ると光の橋 ----
  for (const st of S3.stars) {
    st.t += dt;
    if (st.lit || !playing) continue;
    if (s3attackHits(st.x, st.base + 0.6, st.z, 1.55)) {
      st.lit = true;
      S3.litOrder.push(st);
      Sound.play('hit');
      s3tone(660 + S3.litOrder.length * 110, 1320 + S3.litOrder.length * 110, 0.3, 'triangle', 0.1);
      Fx.burst(st.x, st.y, st.z, S3COL.star, 16, 5);
      const left = S3.stars.filter((q) => !q.lit).length;
      if (left > 0) Game.toast(`星が ひかった！ あと ${left} こ`, 2);
      else {
        S3.bridgeOn = true; S3.bridgeT = 0;
        Sound.play('seed');
        Game.toast('星座が つながった！ 東に 光の橋が かかった！', 4);
      }
    }
  }
  if (S3.bridgeOn) {
    S3.bridgeT += dt;
    for (const b of S3.btiles) {
      if (b.s.off && S3.bridgeT > 0.6 + b.k * 0.25) { b.s.off = false; Fx.burst(b.x, 0, 0, S3COL.tile, 6, 3); s3tone(880 + b.k * 80, 880 + b.k * 80, 0.12, 'sine', 0.06); }
    }
  }

  // ---- ワープの輪 ----
  if (playing && S3.warpCd <= 0) {
    const py = P.y + 0.65;
    for (const rg of S3.rings) {
      const nx = Math.sin(rg.yaw), nz = Math.cos(rg.yaw);
      const rx = P.x - rg.x, ry = py - rg.y, rz = P.z - rg.z;
      const along = rx * nx + rz * nz, side = rx * nz - rz * nx;
      if (Math.abs(along) < 0.5 && Math.hypot(side, ry) < 1.05) {
        const [tx, ty, tz, tyaw] = rg.to;
        Fx.burst(P.x, py, P.z, rg.col, 16, 6);
        playerReset(tx, ty, tz, tyaw);
        P.inv = 0.5;
        if (typeof camReset === 'function') camReset();
        S3.warpCd = 1.0;
        Sound.play('seed');
        s3tone(1400, 300, 0.4, 'sine', 0.1);
        Fx.burst(tx, ty + 0.8, tz, rg.col, 20, 6);
        Game.toast(rg.msg, 2.5);
        break;
      }
    }
  }
  for (const rg of S3.rings) rg.spin += dt * 1.2;

  // ---- 星くずの原っぱ（時間内に かけらを集める）----
  if (!S3.shardDone) {
    if (!S3.shardOn && playing && P.grounded && P.groundS === S3.clock) {
      S3.shardOn = true; S3.shardT = S3C.SHARD_TIME; S3.lastTick = S3C.SHARD_TIME;
      for (const sh of S3.shards) sh.got = false;
      Sound.play('select');
      s3tone(523, 1046, 0.3, 'square', 0.05);
      Game.toast(`スタート！ ${S3C.SHARD_TIME}びょうで 星のかけらを ${S3.shards.length}こ 集めよう`, 3);
    }
    if (S3.shardOn) {
      if (playing) S3.shardT -= dt;
      const py = P.y + 0.65;
      for (const sh of S3.shards) {
        sh.t += dt;
        if (sh.got || !playing) continue;
        if (Math.hypot(sh.x - P.x, sh.y - py, sh.z - P.z) < 1.2) {
          sh.got = true;
          const n = S3.shards.filter((q) => q.got).length;
          Sound.play('acorn');
          s3tone(880 + n * 120, 1760 + n * 120, 0.18, 'triangle', 0.08);
          Fx.burst(sh.x, sh.y, sh.z, S3COL.shard, 12, 4);
          if (n < S3.shards.length) Game.toast(`星のかけら ${n} / ${S3.shards.length}`, 1.6);
        }
      }
      const sec = Math.ceil(S3.shardT);
      if (sec !== S3.lastTick && (sec === 30 || sec === 20 || sec === 10 || sec <= 5) && sec > 0) { S3.lastTick = sec; s3tone(1200, 1200, 0.06, 'square', 0.04); }
      if (S3.shards.every((q) => q.got)) {
        S3.shardOn = false; S3.shardDone = true;
        revealSeedMsg(4, '星のかけらを ぜんぶ 集めた！ 星の時計に ひかりの種が あらわれた！');
      } else if (S3.shardT <= 0) {
        S3.shardOn = false;
        Sound.play('hurt');
        Game.toast('時間切れ… 星の時計を もういちど ふもう', 3);
      }
    }
  }

  // ---- 星の観覧車 ----
  const W0 = S3.wheel;
  W0.a += W0.w * dt;
  for (const gd of S3.gond) {
    const a = gd.a0 + W0.a, s = gd.s;
    const x = W0.cx + Math.cos(a) * W0.R, y = W0.cy + Math.sin(a) * W0.R;
    World.move(s, x - (s.x0 + s.x1) / 2, y - (s.y0 + s.y1) / 2, 0);
  }

  // ---- 星の門 ----
  const G = S3.gate;
  const have = s3seedsHave();
  G.have = have;
  if (!S3.gateOpen && have >= S3C.GATE_NEED) {
    S3.gateOpen = true; S3.gateT = 0;
    if (playing) { Sound.play('seed'); Game.toast('星の門が ひらいた！ 北東の空へ 光の階段が のびる', 4); }
  }
  if (S3.gateOpen) {
    S3.gateT += dt;
    for (const gt of S3.gtiles) {
      if (gt.s.off && S3.gateT > 0.4 + gt.k * 0.2) { gt.s.off = false; if (playing) Fx.burst(gt.x, gt.top, gt.z, [0.8, 0.7, 1], 6, 3); }
    }
  } else if (playing) {
    const d = Math.hypot(P.x - G.x, P.z - G.z);
    if (d < 3.5 && S3.gateArmed) { S3.gateArmed = false; Sound.play('select'); Game.toast(`星の門：ひかりの種が あと ${S3C.GATE_NEED - have} こ ひつよう`, 3); }
    else if (d > 7) S3.gateArmed = true;
  }

  // ---- ボス ----
  if (S3.boss) updateBoss(S3.boss, dt);
}

// ---------- 描画 ----------
// 月の絵の向き：月あかり（R.light）と同じ方位で、見上げなくても見える高さ（22度）
const s3moonV = [0, 0, 0];
function s3MoonDir() {
  const L = R.light, h = Math.hypot(L[0], L[2]) || 1;
  s3moonV[0] = L[0] / h * 0.927; s3moonV[1] = 0.375; s3moonV[2] = L[2] / h * 0.927;
  return s3moonV;
}
const S3_STARS = [];   // 夜空の星（向き・大きさ・色）。はじめに1回だけ作る
function s3MakeSky() {
  const rr = makeRng(42);
  for (let i = 0; i < 260; i++) {
    const y = 0.03 + Math.pow(rr(), 0.8) * 0.97, a = rr() * TAU, h = Math.sqrt(1 - y * y);
    const big = rr() < 0.12;
    const k = rr();
    S3_STARS.push({ x: Math.cos(a) * h, y, z: Math.sin(a) * h, s: big ? 2.2 + rr() * 1.6 : 0.8 + rr() * 0.9, ph: rr() * TAU, sp: 1 + rr() * 2.5, r: k < 0.3 ? 1 : 0.85, g: 0.9, b: k > 0.7 ? 0.75 : 1 });
  }
}
function drawStage3(t, tint) {
  const S3 = Level.s3;
  if (!S3) return;
  const shadow = R.pass === 'shadow';
  // 月（光の来る方向の遠く）
  if (!shadow) {
    const M = s3MoonDir(), c = R.cam;
    drawMesh(Models.s3moon, Tt(c[0] + M[0] * 230, c[1] + M[1] * 230, c[2] + M[2] * 230, 13, 13, 13, Math.atan2(-M[0], -M[2])), WHITE, 1);
  }
  // 星の石の上の星
  for (const st of S3.stars) {
    const spin = st.lit ? t * 1.6 : t * 0.3;
    drawMesh(Models.s3star, Tt(st.x, st.y + Math.sin(st.t * 2) * 0.08, st.z, 1.1, 1.1, 1.1, spin), st.lit ? S3COL.star : S3COL.starOff, st.lit ? 0.6 : 0.15);
  }
  // 光の橋・光の階段
  for (const b of S3.btiles) { if (!b.s.off) drawMesh(S3.tileMesh, Tt(b.x, -0.2, 0), S3COL.tile, 0.45); }
  for (const gt of S3.gtiles) { if (!gt.s.off) drawMesh(S3.gtileMesh, Tt(gt.x, gt.top - 0.2, gt.z, 1, 1, 1, gt.s.ang), [0.85, 0.75, 1], 0.45); }
  // ワープの輪・正解の星
  for (const rg of S3.rings) drawMesh(Models.s3ring, Tt(rg.x, rg.y, rg.z, 1, 1, 1, rg.yaw, 0, rg.spin), rg.col, 0.8);
  for (const h of S3.hints) drawMesh(Models.s3star, Tt(h.x, h.y + Math.sin(t * 1.5) * 0.3, h.z, 2.4, 2.4, 2.4, t * 0.8), h.col, 0.9);
  // 星のかけら
  if (S3.shardOn) for (const sh of S3.shards) { if (!sh.got) drawMesh(Models.s3star, Tt(sh.x, sh.y + Math.sin(sh.t * 3) * 0.15, sh.z, 0.75, 0.75, 0.75, sh.t * 2.5), S3COL.shard, 0.9); }
  // キノコのぷるん（ヒップドロップ・着地のとき 上に光の輪）
  // 観覧車
  const W0 = S3.wheel;
  drawMesh(Models.s3wheel, Tt(W0.cx, W0.cy, W0.cz + 1.8, 1, 1, 1, 0, 0, W0.a), tint);
  for (const gd of S3.gond) { const s = gd.s; drawMesh(Models.s3gond, Tt((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2), tint); }
  // ボス
  if (S3.boss) drawBoss(S3.boss, t, tint);
  if (shadow) return;

  // ---- ここから下は光・粒（スプライト）----
  // 夜空の星（カメラを中心にした遠くの球の上）
  if (!S3_STARS.length) s3MakeSky();
  const c = R.cam, q = Perf.q.fx;
  const nStar = q >= 1 ? S3_STARS.length : Math.round(S3_STARS.length * (0.5 + q * 0.5));
  for (let i = 0; i < nStar; i++) {
    const s = S3_STARS[i];
    const tw = 0.65 + 0.35 * Math.sin(t * s.sp + s.ph);
    Sprites.add(c[0] + s.x * 190, c[1] + s.y * 190 - 8, c[2] + s.z * 190, s.s * (0.85 + tw * 0.3), 2, s.r, s.g, s.b, 0.55 + tw * 0.45, s.ph);
  }
  // 月の光のにじみ
  const M = s3MoonDir();
  Sprites.add(c[0] + M[0] * 200, c[1] + M[1] * 200, c[2] + M[2] * 200, 36, 1, 0.75, 0.82, 1, 0.4);
  Sprites.add(c[0] + M[0] * 200, c[1] + M[1] * 200, c[2] + M[2] * 200, 70, 1, 0.5, 0.6, 1, 0.15);
  // ふわふわ足場の下の 雲
  for (const mv of S3.floats) {
    const s = mv.s, x = (s.x0 + s.x1) / 2, y = s.y0, z = (s.z0 + s.z1) / 2;
    if (Math.abs(x - c[0]) + Math.abs(z - c[2]) > 120) continue;
    for (let k = 0; k < 5; k++) {
      const an = k * TAU / 5 + x;
      Sprites.add(x + Math.cos(an) * 1.3, y + 0.05 + Math.sin(t * 1.3 + k) * 0.06, z + Math.sin(an) * 1.3, 0.95, 0, 0.82, 0.86, 1, 0.85);
    }
    Sprites.add(x, y - 0.2, z, 2.4, 1, 0.6, 0.7, 1, 0.22);
  }
  // ランプ・キノコ・木の実の光
  // （カメラのすぐ近くの光は 画面いっぱいに広がって白っぽくなるので うすくする）
  for (const gw of S3.glows) {
    const dx = gw[0] - c[0], dy = gw[1] - c[1], dz = gw[2] - c[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 110) continue;
    const k = 0.85 + Math.sin(t * 2 + gw[8]) * 0.15, near = Math.min(1, (d - 1.5) / 6);
    if (near <= 0) continue;
    Sprites.add(gw[0], gw[1], gw[2], gw[3] * k, 1, gw[4], gw[5], gw[6], gw[7] * near);
  }
  for (const m of S3.shrooms) if (m.boing > 0) Sprites.add(m.x, m.top + 0.08, m.z, m.r * (1.3 + (1 - m.boing) * 1.8), 4, m.c[0], m.c[1], m.c[2], m.boing);
  // 星の石：光っていれば光。光った順に 星座の線でつなぐ
  for (const st of S3.stars) {
    if (st.lit) { Sprites.add(st.x, st.y, st.z, 2.2, 1, 1, 0.85, 0.45, 0.35); Sprites.add(st.x, st.y, st.z, 1.9, 2, 1, 0.95, 0.7, 0.45, t); }
    else Sprites.add(st.x, st.y, st.z, 1.2, 1, 0.5, 0.55, 0.9, 0.25 + 0.1 * Math.sin(st.t * 3));
  }
  const lo = S3.litOrder;
  for (let i = 1; i < lo.length; i++) {
    const a = lo[i - 1], b = lo[i];
    const n = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 2));
    for (let k = 1; k < n; k++) {
      const u = k / n, fl = 0.6 + 0.4 * Math.sin(t * 6 - k * 0.7);
      Sprites.add(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u), 0.35, 1, 1, 0.92, 0.6, 0.6 * fl);
    }
  }
  for (const b of S3.btiles) if (!b.s.off) Sprites.add(b.x, 0.05, 0, 1.8, 5, 0.55, 0.85, 1, 0.35);
  for (const gt of S3.gtiles) if (!gt.s.off) Sprites.add(gt.x, gt.top + 0.05, gt.z, 1.5, 5, 0.75, 0.6, 1, 0.35);
  // ワープの輪の光と、輪の中のうず
  for (const rg of S3.rings) {
    Sprites.add(rg.x, rg.y, rg.z, 2.2, 1, rg.col[0], rg.col[1], rg.col[2], 0.35);
    for (let k = 0; k < 6; k++) {
      const a = rg.spin * 2 + k * TAU / 6, r = 0.45 + 0.35 * fract(t * 0.7 + k / 6);
      const sx = Math.cos(rg.yaw), sz = -Math.sin(rg.yaw);
      Sprites.add(rg.x + sx * Math.cos(a) * r, rg.y + Math.sin(a) * r, rg.z + sz * Math.cos(a) * r, 0.22, 2, rg.col[0], rg.col[1], rg.col[2], 0.8, a);
    }
  }
  for (const h of S3.hints) Sprites.add(h.x, h.y, h.z, 5, 1, h.col[0], h.col[1], h.col[2], 0.45);
  // 星くず：時計とかけら
  if (S3.clock && !S3.shardDone) {
    const s = S3.clock;
    if (!S3.shardOn) { const rk = fract(t * 0.6); Sprites.add(s.x, 0.18, s.z, 0.6 + rk * 1.6, 4, 1, 0.85, 0.45, (1 - rk) * 0.8); }
    else for (const sh of S3.shards) if (!sh.got) Sprites.add(sh.x, sh.y, sh.z, 1.8, 1, 1, 0.85, 0.4, 0.5);
  }
  // 星の門（閉じている間は光のかべ）とあかり
  const G = S3.gate;
  for (let i = 0; i < G.lamps.length; i++) {
    const l = G.lamps[i], on = i < (G.have || 0);
    Sprites.add(l[0], l[1], l[2], on ? 1.4 : 0.6, 1, on ? 0.5 : 0.4, on ? 1 : 0.45, on ? 0.9 : 0.7, on ? 0.7 : 0.3);
  }
  if (!S3.gateOpen) {
    const fx = Math.cos(G.ang + Math.PI / 2), fz = -Math.sin(G.ang + Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const u = (i % 6) / 5 - 0.5, v = Math.floor(i / 6);
      Sprites.add(G.x + fx * u * 4.2, 0.6 + v * 1.2 + Math.sin(t * 2 + i) * 0.15, G.z + fz * u * 4.2, 1.5, 1, 0.65, 0.5, 1, 0.3);
      Sprites.add(G.x + fx * u * 4.2, 0.6 + v * 1.2 + Math.sin(t * 3 + i * 1.7) * 0.4, G.z + fz * u * 4.2, 0.3, 2, 0.9, 0.8, 1, 0.8, t + i);
    }
  }
  // 体がかるいエリアの ふわふわ のぼる光の粒
  for (const zn of S3.zones) {
    const dc = Math.hypot(c[0] - zn.x, c[2] - zn.z);
    if (dc > 110) continue;
    const n = Math.round(40 * Math.max(0.4, q));
    for (let i = 0; i < n; i++) {
      const h1 = fract(Math.sin(i * 12.9898 + zn.x) * 43758.5), h2 = fract(Math.sin(i * 78.233 + zn.z) * 12345.6);
      const a = h1 * TAU, r = Math.sqrt(h2) * zn.r;
      const y = (zn.base === null ? -4 : zn.base) + wrapM(h1 * 30 + t * (0.8 + h2), 26);
      Sprites.add(zn.x + Math.cos(a) * r, y, zn.z + Math.sin(a) * r, 0.16 + h2 * 0.12, 2, 0.7, 0.85, 1, 0.65, a);
    }
    if (zn.base !== null) { const rk = fract(t * 0.25); Sprites.add(zn.x, zn.base + 0.05, zn.z, 4 + rk * 6, 4, 0.6, 0.75, 1, (1 - rk) * 0.5); }
  }
  // 月の池の水面の光
  Sprites.add(0, 0.05, -46, 4.2, 5, 0.55, 0.7, 1, 0.35);
  // ボスの光（予兆など）
  if (S3.boss) drawBossFx(S3.boss, t);
}

// ステージ3の画面表示：星くずの時間とボスの体力（90_game.js の drawHud から Level.hud として呼ぶ）
function drawStage3Hud(W, H, fs, small) {
  const S3 = Level.s3;
  if (!S3) return;
  if (S3.shardOn) {
    const n = S3.shards.filter((q) => q.got).length;
    const y = Input.safe.t + (small ? 84 : 96);
    const msg = `星のかけら ${n} / ${S3.shards.length}　のこり ${Math.max(0, Math.ceil(S3.shardT))} びょう`;
    setFont(fs);
    const w = hud.measureText(msg).width + 30;
    panel(W / 2 - w / 2, y - (fs + 12) / 2, w, fs + 12, (fs + 12) / 2, 'rgba(40,30,90,.55)', 'rgba(255,230,150,.8)');
    txt(msg, W / 2, y + 1, fs, S3.shardT < 10 ? '#ff9f9f' : '#ffe9a8', 'center');
  }
  if (S3.boss) drawBossGauge(S3.boss, W, H, fs, small);
}

// ステージ3のモデル（星・輪・観覧車・月）
function buildStage3Models() {
  // 星（XY 平面の 5つのとがり）
  {
    const g = new Geo();
    const c = (p) => mixc(hex(0xffe9a0), hex(0xffffff), clamp(p[1] * 0.5 + 0.5, 0, 1));
    for (let i = 0; i < 5; i++) g.cyl(T(0, 0, 0, 0.24, 0.62, 0.14, 0, 0, -i * TAU / 5), c, 4, { top: 0, flat: true });
    g.sphere(T(0, 0, 0, 0.3, 0.3, 0.17), c, 8, 5, { flat: true });
    Models.s3star = g.mesh();
  }
  // ワープの輪（XY 平面。正面は +z）
  {
    const g = new Geo();
    g.torus(T(0, 0, 0, 1, 1, 1, 0, Math.PI / 2), (p) => mixc(hex(0xc0c8ff), hex(0xffffff), clamp(p[1] * 0.5 + 0.5, 0, 1)), 1.25, 0.13, 30, 8);
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4; g.sphere(T(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0, 0.2, 0.2, 0.2), WHITE, 6, 4); }
    Models.s3ring = g.mesh();
  }
  // 観覧車のゴンドラ（上は乗れる床）
  {
    const g = new Geo(0.02);
    g.box(T(0, 0, 0, 2.8, 0.5, 2.8), (p, n) => (n[1] > 0.5 ? hex(0xf4e8c2) : hex(0xc9a25a)));
    g.box(T(0, 0.27, 0, 2.2, 0.04, 2.2), hex(0xe8d6a0));
    g.box(T(0, 0.1, 1.6, 0.25, 0.25, 0.5), hex(0xc9a25a));            // 輪へのうで
    g.sphere(T(0, -0.35, 0, 0.3, 0.3, 0.3), hex(0xfff2a0), 8, 5);      // 下の星のランプ
    Models.s3gond = g.mesh();
  }
  // 観覧車の輪（XY 平面、半径 9）
  {
    const g = new Geo();
    const gold = hex(0xd8b25e), dk = hex(0x8a7fc0);
    g.torus(T(0, 0, 0, 1, 1, 1, 0, Math.PI / 2), gold, 9, 0.22, 56, 6);
    g.torus(T(0, 0, 0, 1, 1, 1, 0, Math.PI / 2), dk, 3.2, 0.16, 24, 6);
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * TAU / 6;
      g.box(T(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0, 9, 0.18, 0.18, 0, 0, a), dk);
      g.sphere(T(Math.cos(a) * 9, Math.sin(a) * 9, 0, 0.42, 0.42, 0.42), hex(0xfff2a0), 8, 5);
    }
    g.cyl(T(0, 0, 0.8, 1.0, 1.6, 1.0, 0, Math.PI / 2), gold, 12);
    for (let i = 0; i < 5; i++) g.cyl(T(0, 0, 0.82, 0.5, 0.7, 0.2, 0, 0, -i * TAU / 5), hex(0xfff2a0), 4, { top: 0, flat: true });
    Models.s3wheel = g.mesh();
  }
  // 月（もようつき）
  {
    const g = new Geo();
    g.sphere(T(0, 0, 0, 1, 1, 1), hex(0xfff6dc), 20, 12);
    for (const [x, y, z, s] of [[0.3, 0.35, 0.86, 0.22], [-0.4, -0.2, 0.86, 0.3], [0.1, -0.5, 0.82, 0.16], [-0.2, 0.55, 0.78, 0.14]]) g.sphere(T(x, y, z, s, s, s * 0.4), hex(0xe2d6b8), 8, 5);
    Models.s3moon = g.mesh();
  }
}
