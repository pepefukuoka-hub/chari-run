// モデル（主人公・アイテム・敵・飾り）と、それを描く関数
// 色はシェーダーで線形化→トーンマップされるので、少し落ち着いた色で決めている
const COL = {
  body: hex(0xffa64a), bodyDk: hex(0xe47f2c), bodyLt: hex(0xffc477), belly: hex(0xfff0d4),
  scarf: hex(0x23b3a4), scarfDk: hex(0x168a80), scarfLt: hex(0xf3eedb),
  eye: hex(0x2a1c18), eyeLo: hex(0x5b3a2c), white: [1, 1, 1], cheek: hex(0xff8a95),
  foot: hex(0xd8752a), hand: hex(0xfff1d6), mouth: hex(0x7a2a2a), tongue: hex(0xff7d8a),
  grass: hex(0x86cf62), grassDk: hex(0x5fab4b), dirt: hex(0xbd8a5e), dirtDk: hex(0x8c6446),
  stone: hex(0xc4bfcc), stoneDk: hex(0x928ca3), wood: hex(0xc99059), woodDk: hex(0x97663f),
  ice: hex(0xc4ecff), lava: hex(0xff6a2a),
  acorn: hex(0xc98a3e), acornDk: hex(0x9a6129), acornCap: hex(0x7a5230), acornCapLt: hex(0x9b7048),
  seed: hex(0x9cfff0), seedDk: hex(0x3fcfc0), seedLt: hex(0xf0fffb), seedCore: hex(0xfff7a8),
  leaf: hex(0x62bf5c), leafDk: hex(0x3f9a4c), trunk: hex(0x9a6a42),
  flowerR: hex(0xff7593), flowerY: hex(0xffe066), flowerW: hex(0xffffff),
  enemy: hex(0xa486e6), enemyDk: hex(0x6c52b0), enemyLt: hex(0xd4c2ff),
  spike: hex(0x4e5068), spikeDk: hex(0x34364a), spikeTip: hex(0xfff3c4),
  heart: hex(0xff4f6d), heartLt: hex(0xff8ea0), cloud: hex(0xffffff), water: hex(0x5cc8ff),
};

const Models = {};

// 球面上にほぼ均等に点を並べる（フィボナッチ球）
function fibPoints(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), ph = i * 2.39996;
    out.push([Math.cos(ph) * r, y, Math.sin(ph) * r]);
  }
  return out;
}
// 向き dir に y 軸を合わせる行列（位置 p）
function alignY(p, dir, sx, sy, sz) {
  const y = v3.norm(dir);
  const a = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = v3.norm(v3.cross(a, y));
  const z = v3.cross(x, y);
  const m = new Float32Array(16);
  m[0] = x[0] * sx; m[1] = x[1] * sx; m[2] = x[2] * sx;
  m[4] = y[0] * sy; m[5] = y[1] * sy; m[6] = y[2] * sy;
  m[8] = z[0] * sz; m[9] = z[1] * sz; m[10] = z[2] * sz;
  m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; m[15] = 1;
  return m;
}

function buildModels() {
  // ================= ころん（足元が原点、前が +z）=================
  {
    const g = new Geo();
    // 頭と体がひとつになった、おもちのような丸い体
    const head = (p) => {
      if (p[1] > 0.55) return mixc(COL.body, COL.bodyLt, (p[1] - 0.55) * 1.6);
      return mixc(COL.bodyDk, COL.body, clamp(p[1] * 0.7 + 0.75, 0, 1));
    };
    g.sphere(T(0, 0.7, 0, 0.6, 0.6, 0.56), head, 28, 18);
    // 下側のふくらみ（おなかは白っぽい）
    const lower = (p) => {
      const base = mixc(COL.bodyDk, COL.body, clamp(p[1] * 0.5 + 0.6, 0, 1));
      const k = smooth(clamp((p[2] - 0.25) / 0.3, 0, 1)) * smooth(clamp((0.85 - Math.abs(p[1] + 0.05)) / 0.25, 0, 1));
      return mixc(base, COL.belly, k);
    };
    g.sphere(T(0, 0.42, 0, 0.57, 0.4, 0.53), lower, 26, 14);
    // 口のまわり（ふっくらした白いマズル）
    g.sphere(T(0, 0.66, 0.44, 0.22, 0.14, 0.12), COL.belly, 16, 10);
    // 鼻
    g.sphere(T(0, 0.725, 0.555, 0.05, 0.035, 0.035), COL.eye, 10, 6);
    g.sphere(T(-0.015, 0.735, 0.585, 0.014, 0.01, 0.006), COL.white, 5, 3);
    // ほっぺ
    for (const sx of [-1, 1]) g.sphere(T(sx * 0.35, 0.7, 0.425, 0.095, 0.058, 0.035, sx * 0.72), COL.cheek, 12, 6);
    // マフラー（しま模様）
    const stripe = (p) => {
      const u = Math.atan2(p[2], p[0]);
      return Math.floor((u / Math.PI) * 5 + 10) % 2 ? COL.scarf : mixc(COL.scarf, COL.scarfLt, 0.75);
    };
    g.torus(T(0, 0.5, 0, 1, 1, 0.97, 0, -0.06), stripe, 0.565, 0.1, 30, 10);
    // 結び目（背中側）
    g.sphere(T(0.2, 0.49, -0.56, 0.11, 0.1, 0.09, 0.4), COL.scarf, 10, 8);
    // 頭のてっぺんのくるんとした毛
    g.arc(T(0, 1.36, 0.02, 1, 1, 1, Math.PI / 2), COL.bodyLt, 0.075, 0.026, -0.9, Math.PI * 0.95, 10, 6);
    Models.body = g.mesh();
  }
  // 目（1つぶん）：黒目に大小2つのハイライト
  Models.eye = new Geo()
    .sphere(T(0, 0, 0, 0.088, 0.13, 0.052), (p) => mixc(COL.eye, COL.eyeLo, clamp(-p[1] * 1.4 - 0.2, 0, 1)), 14, 10)
    .sphere(T(0.026, 0.05, 0.042, 0.034, 0.038, 0.02), COL.white, 8, 6)
    .sphere(T(-0.028, -0.045, 0.045, 0.016, 0.016, 0.01), COL.white, 6, 4)
    .mesh();
  // にっこり目（^）と、ぎゅっと目
  Models.eyeHappy = new Geo().arc(T(0, -0.03, 0), COL.eye, 0.065, 0.019, 0.15, Math.PI - 0.15, 10, 5).mesh();
  // ぎゅっと目（> の形。左目は 180° 回して < にする）
  {
    const g = new Geo();
    const p0 = [-0.045, 0.045, 0], p1 = [0.04, 0, 0], p2 = [-0.045, -0.045, 0];
    for (const [a, c] of [[p0, p1], [p2, p1]]) {
      const d = v3.sub(c, a);
      g.cyl(alignY(a, d, 0.019, v3.len(d), 0.019), COL.eye, 6);
      g.sphere(T(a[0], a[1], a[2], 0.019, 0.019, 0.019), COL.eye, 6, 4);
    }
    g.sphere(T(p1[0], p1[1], p1[2], 0.02, 0.02, 0.02), COL.eye, 6, 4);
    Models.eyeX = g.mesh();
  }
  // 口（ω の形）と、開いた口
  {
    const g = new Geo();
    for (const sx of [-1, 1]) g.arc(T(sx * 0.034, 0, 0), COL.eye, 0.034, 0.011, Math.PI + 0.15, TAU - 0.1, 8, 5);
    Models.mouth = g.mesh();
    const o = new Geo();
    o.sphere(T(0, 0, 0, 0.065, 0.055, 0.03), COL.mouth, 12, 8);
    o.sphere(T(0, -0.025, 0.012, 0.04, 0.022, 0.02), COL.tongue, 10, 6);
    Models.mouthOpen = o.mesh();
  }
  // 耳（根もとが原点）
  Models.ear = new Geo()
    .sphere(T(0, 0.13, 0, 0.17, 0.165, 0.08), (p) => mixc(COL.body, COL.bodyLt, p[1] * 0.5 + 0.3), 14, 10)
    .sphere(T(0, 0.13, 0.04, 0.1, 0.1, 0.05), COL.cheek, 12, 8)
    .mesh();
  // しっぽ（ふわふわの丸）
  Models.tail = new Geo().sphere(T(0, 0, 0, 0.15, 0.14, 0.14), (p) => mixc(COL.body, COL.belly, p[2] * -0.5 + 0.5), 12, 8).mesh();
  // 足（底はクリーム色）、手
  Models.foot = new Geo().sphere(T(0, 0.085, 0.05, 0.155, 0.1, 0.205), (p, n) => (n[1] < -0.55 ? COL.belly : mixc(COL.foot, COL.body, p[1] * 0.5 + 0.5)), 14, 8).mesh();
  Models.hand = new Geo().sphere(T(0, 0, 0, 0.12, 0.12, 0.12), (p) => (p[1] < -0.35 || p[2] > 0.55 ? COL.belly : COL.body), 12, 8).mesh();
  // マフラーのしっぽ（上端が原点、下へ垂れる。先はしま）
  Models.scarfTail = new Geo()
    .cyl(T(0, -0.3, 0, 0.08, 0.3, 0.028), (p) => (p[1] < 0.18 ? COL.scarfLt : COL.scarf), 10)
    .mesh();

  // ================= どんぐり =================
  {
    const g = new Geo();
    const nut = (p) => mixc(COL.acornDk, COL.acorn, clamp(p[1] * 0.6 + 0.6, 0, 1));
    g.sphere(T(0, -0.02, 0, 0.26, 0.31, 0.26), nut, 16, 12);
    g.cyl(T(0, -0.36, 0, 0.06, 0.08, 0.06), COL.acornDk, 6, { top: 0.2, bottom: 1 }); // とがった先
    // 帽子（あみ目もよう）
    const cap = (p, n) => {
      const u = Math.atan2(p[2], p[0]);
      const k = (Math.floor(u * 2.6 + p[1] * 6) + Math.floor(u * 2.6 - p[1] * 6)) % 2 === 0;
      return n[1] < -0.2 ? shade(COL.acornCap, 0.75) : k ? COL.acornCapLt : COL.acornCap;
    };
    g.sphere(T(0, 0.15, 0, 0.3, 0.17, 0.3), cap, 16, 8, { flat: true });
    g.cyl(T(0, 0.28, 0, 0.035, 0.13, 0.035, 0, 0, 0.25), COL.acornCap, 6);
    Models.acorn = g.mesh();
  }
  // ================= ひかりの種（芽の出た光る結晶）=================
  {
    const g = new Geo();
    const cry = (p) => {
      const y = p[1];
      return y < 1 ? mixc(COL.seedDk, COL.seed, y) : mixc(COL.seed, COL.seedLt, y - 1);
    };
    // 下は短め、上は長めの8角すい2つ
    const lo = (p) => cry([0, p[1] * 0.75, 0]);
    const hi = (p) => cry([0, 0.75 + p[1] * 1.25, 0]);
    g.cyl(T(0, 0, 0, 0.5, 0.55, 0.5), lo, 8, { bottom: 0, top: 1, flat: true, caps: false });
    g.cyl(T(0, 0.55, 0, 0.5, 0.95, 0.5), hi, 8, { bottom: 1, top: 0, flat: true, caps: false });
    // 寄りそう小さな結晶
    for (const [sx, sz, s, rz] of [[0.38, 0.1, 0.45, -0.5], [-0.33, -0.15, 0.38, 0.55]]) {
      const m = T(sx, 0.28, sz, 1, 1, 1, 0, 0, rz);
      g.cyl(M4.scale(M4.copy(m), 0.2 * s / 0.45, 0.25 * s / 0.45, 0.2 * s / 0.45), lo, 6, { bottom: 0, top: 1, flat: true, caps: false });
      const m2 = M4.translate(M4.copy(m), 0, 0.25 * s / 0.45, 0);
      g.cyl(M4.scale(m2, 0.2 * s / 0.45, 0.5 * s / 0.45, 0.2 * s / 0.45), hi, 6, { bottom: 1, top: 0, flat: true, caps: false });
    }
    // てっぺんの小さな芽（双葉）
    g.cyl(T(0, 1.42, 0, 0.025, 0.16, 0.025), COL.leafDk, 5);
    for (const sx of [-1, 1]) g.sphere(T(sx * 0.11, 1.6, 0, 0.12, 0.035, 0.07, 0, 0, sx * -0.35), COL.leaf, 10, 6);
    Models.seed = g.mesh();
  }
  // ================= ハート =================
  {
    const g = new Geo();
    const hc = (p) => mixc(COL.heart, COL.heartLt, clamp(p[1] * 0.6 + 0.2, 0, 1));
    for (const sx of [-1, 1]) g.sphere(T(sx * 0.13, 0.02, 0, 0.19, 0.31, 0.15, 0, 0, sx * -0.72), hc, 16, 12);
    g.sphere(T(-0.16, 0.16, 0.115, 0.05, 0.035, 0.02, 0, 0, 0.6), COL.white, 8, 4);
    Models.heart = g.mesh();
  }
  // ================= 敵：もこもこ（ふわふわの紫。踏める）=================
  {
    const g = new Geo();
    const fur = (p) => mixc(COL.enemyDk, COL.enemy, clamp(p[1] * 0.5 + 0.55, 0, 1));
    g.sphere(T(0, 0.56, 0, 0.6, 0.52, 0.6), fur, 18, 12);
    // まわりにふわふわの玉をくっつけて、もこもこの輪郭に
    for (const q of fibPoints(30)) {
      if (q[1] < -0.35) continue;
      if (q[2] > 0.45 && Math.abs(q[0]) < 0.62 && q[1] < 0.55) continue; // 顔はあける
      const p = [q[0] * 0.58, 0.56 + q[1] * 0.5, q[2] * 0.58];
      const s = 0.2 + (q[1] + 1) * 0.04;
      const lt = clamp(q[1] * 0.5 + 0.5, 0, 1);
      g.sphere(T(p[0], p[1], p[2], s, s * 0.9, s), (pp) => mixc(COL.enemyDk, mixc(COL.enemy, COL.enemyLt, lt * 0.45), clamp(pp[1] * 0.5 + 0.5 + lt * 0.3, 0, 1)), 10, 7);
    }
    // 目（白目＋黒目）と、怒りまゆ
    for (const sx of [-1, 1]) {
      g.sphere(T(sx * 0.2, 0.66, 0.5, 0.13, 0.15, 0.08, sx * 0.3), COL.white, 12, 8);
      g.sphere(T(sx * 0.17, 0.63, 0.57, 0.06, 0.08, 0.04, sx * 0.3), COL.eye, 10, 6);
      g.sphere(T(sx * 0.155, 0.66, 0.6, 0.02, 0.022, 0.01), COL.white, 6, 4);
      g.box(T(sx * 0.22, 0.83, 0.55, 0.2, 0.05, 0.06, sx * 0.3, 0, sx * -0.45), COL.enemyDk);
    }
    // 口とキバ
    g.arc(T(0, 0.48, 0.585, 1, 1, 1, 0, -0.2), COL.eye, 0.07, 0.014, 0.3, Math.PI - 0.3, 8, 4);
    g.cyl(T(0.05, 0.47, 0.595, 0.025, 0.05, 0.02, 0, Math.PI), COL.white, 5, { top: 0 });
    // 足
    for (const sx of [-1, 1]) g.sphere(T(sx * 0.28, 0.09, 0.1, 0.17, 0.1, 0.22), COL.enemyDk, 10, 6);
    Models.blob = g.mesh();
  }
  // ================= 敵：トゲコロ（トゲ玉。踏めない）=================
  {
    const g = new Geo();
    g.sphere(T(0, 0, 0, 0.66, 0.66, 0.66), (p) => mixc(COL.spikeDk, COL.spike, p[1] * 0.4 + 0.6), 16, 12);
    for (const q of fibPoints(26)) {
      const m = alignY([q[0] * 0.55, q[1] * 0.55, q[2] * 0.55], q, 0.17, 0.52, 0.17);
      g.cyl(m, (p) => (p[1] > 0.62 ? COL.spikeTip : mixc(COL.spike, hex(0x8a8ca8), p[1])), 7, { top: 0, caps: false });
    }
    Models.spiky = g.mesh();
  }
  // ---- 影・粒・輪（他のファイルからも使う）----
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

// ---------- ころんを描く ----------
// P の状態を読んで、姿勢・表情・マフラーのなびきを決める。
// ポーズが切り替わるときは、前のポーズから短い時間で混ぜてつなぐ（PoseMix）。
// drawPlayer は影用（R.pass === 'shadow'）と本番で1フレームに2回呼ばれるので、
// 混ぜ具合や「直前に何をしたか」の記録は本番の描画のときだけ進める。
const POSE_N = 24; // 手(3×2) 足(4×2) と、体の角度・位置・耳 10こ
const PoseMix = {
  key: '',                         // いまのポーズの名前
  from: new Float32Array(POSE_N),  // 切り替わる直前に描いていたポーズ
  last: new Float32Array(POSE_N),  // 前のフレームに描いたポーズ
  cur: new Float32Array(POSE_N),   // 作業用
  fade: 1, dur: 0.1,
  lastNow: 0,
  wallSide: 1,                     // 壁ずり落ち：壁が体の右(+1)か左(-1)か
  wasWall: false, wallKickT: 9,    // 壁キックしてからの時間
  wasPoundT: 0, poundJump: false,  // ヒップドロップ後の大ジャンプ中
  sideFrom: Math.PI,               // くるりんジャンプ：もとの向きと新しい向きの差
};
// ポーズごとのつなぎ時間（秒）。書いていないものは 0.1
const POSE_DUR = {
  skid: 0.05, side: 0.06, dive: 0.07, slide: 0.06, bslide: 0.12, p1: 0.04, p2: 0.04, p3: 0.05,
  kick: 0.04, wall: 0.1, wkick: 0.06, up: 0.05, ground: 0.08, pland: 0.04, pjump: 0.06, pspin: 0.05, pound: 0.05,
};
function poseDur(from, to) {
  if (from === 'slide' && to === 'ground') return 0.22; // おなかすべりから、よいしょと起きあがる
  if (from === 'skid' && to === 'ground') return 0.14;
  if (from === 'wall') return 0.08;
  return POSE_DUR[to] || 0.1;
}

function drawPlayer() {
  if (P.inv > 0 && P.state !== 'dead' && Math.floor(P.inv * 14) % 2 === 0) return;
  const shadowPass = R.pass === 'shadow';
  const PM = PoseMix;
  const t = Game.time;
  const st = P.state;
  const air = !P.grounded && st !== 'win' && st !== 'dead';
  // 本番の描画のときだけ時間を進める（影用では進めない）
  let dt = 0, snap = PM.key === '';
  if (!shadowPass) {
    const now = performance.now() / 1000;
    const gap = now - PM.lastNow;
    if (gap > 0.5) snap = true; // しばらく描いていなかった（タイトルなど）
    dt = clamp(gap, 0, 0.1);
    PM.lastNow = now;
    // ---- 直前にしたことを覚える ----
    // 壁キック：壁にくっついていた次の瞬間に、上へはね返った
    if (!air) PM.wallKickT = 9;
    else if (PM.wasWall && !P.wall && P.vy > 8 && P.airT < 0.08) PM.wallKickT = 0;
    else PM.wallKickT += dt;
    PM.wasWall = air && !!P.wall;
    // ヒップドロップ着地の直後に跳んだ
    if (!air) PM.poundJump = false;
    else if (PM.wasPoundT > 0 && P.flip && P.vy > 10) PM.poundJump = true;
    PM.wasPoundT = P.grounded ? P.poundT : 0;
    // ブレーキ中：くるりんジャンプしたときに、もとの向きから回って見せるため
    if (P.skidT > 0) PM.sideFrom = -angDiff(P.yaw, P.skidYaw) || Math.PI;
  }
  const ph = P.anim;
  const hsp = Math.hypot(P.vx, P.vz);
  // 崖から歩いて出た直後（コヨーテ時間）は、まだ走りの形のまま
  const coyote = air && st === 'air' && P.coyote > 0 && P.vy <= 0 && !P.flip;
  const groundLike = st === 'ground' || st === 'punch' || coyote;
  const run = groundLike && Math.abs(P.speed) > 0.3 ? clamp(Math.abs(P.speed) / PL.RUN, 0.25, 1) : 0;
  const flipping = air && P.flip && Math.abs(P.flip) < TAU * 0.92;
  const curling = flipping && !P.sideFlip && !PM.poundJump;
  const poundSpin = st === 'pound' && P.stateT < 0.22;

  // ---- 体の姿勢 ----
  let lean = 0, roll = 0, twist = 0, bob = 0, sq = P.squash;
  let pitch = 0;          // 体のまん中を軸に前へ倒す（ダイブ・おなかすべり）
  let yawOff = 0;         // 向きのずらし（壁ずり落ち）
  let offX = 0, offZ = 0; // 体の位置のずらし（壁から少しはなす）
  let spin = 0;           // その場での1回転（まわしげり）。1回転で元にもどるので混ぜない
  let eyes = 'open', mouth = 'smile', earX = 0, earZ = 0;
  let key = 'ground';
  // 手足の位置（side=+1 が右）
  const hands = [[-0.6, 0.56, 0.04], [0.6, 0.56, 0.04]];
  const feet = [[-0.23, 0, 0, 0], [0.23, 0, 0, 0]]; // x, y, z, 角度

  if (groundLike) {
    // 呼吸
    sq *= 1 + Math.sin(t * 3.2) * 0.022;
    hands[0][1] += Math.sin(t * 3.2) * 0.015; hands[1][1] += Math.sin(t * 3.2) * 0.015;
    if (run) {
      const s1 = Math.sin(ph), c1 = Math.cos(ph);
      bob = Math.abs(Math.sin(ph)) * 0.11 * run;
      lean = run * 0.3;
      roll = s1 * 0.07 * run;
      twist = s1 * 0.16 * run;
      sq *= 1 + (Math.abs(c1) - 0.5) * 0.06 * run; // 一歩ごとに少し伸び縮み
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1, s = sd * s1, c = sd * c1;
        feet[i][2] = s * 0.34 * run;
        feet[i][1] = Math.max(0, c) * 0.2 * run;
        feet[i][3] = -c * 0.6 * run;
        hands[i][2] = -s * 0.32 * run + 0.02;
        hands[i][1] = 0.55 + Math.abs(s) * 0.06 * run;
        hands[i][0] = sd * (0.6 - 0.05 * run);
      }
      earX = -0.35 * run + Math.sin(ph * 2) * 0.12 * run;
    } else {
      // 立ち止まり：ときどき耳がぴくっと動く
      const tw = (t % 4.3) < 0.18 ? Math.sin((t % 4.3) / 0.18 * Math.PI) * 0.3 : 0;
      earZ = tw;
    }
    if (coyote) { mouth = 'open'; hands[0][1] += 0.12; hands[1][1] += 0.12; } // あれっ、足もとがない
  }
  if (st === 'ground') {
    if (P.skidT > 0) {
      // ブレーキ：前に出した足でふんばって、体は後ろへのけぞる。手はばたばた
      key = 'skid';
      const wob = Math.sin(t * 38) * 0.06;
      lean = -0.42; bob = -0.02; sq *= 0.93;
      roll = wob * 0.5;
      twist = clamp(angDiff(P.yaw, P.skidYaw), -1, 1) * 0.22; // 行きたい方へ少し顔を向ける
      feet[0] = [-0.27, -0.17, 0.4, -0.2];  // 前の足：つま先を上げて地面をける
      feet[1] = [0.25, 0.02, -0.02, 0.42];  // 後ろの足：ぺたっと地面に
      hands[0] = [-0.74, 0.92 + wob, -0.2]; hands[1] = [0.74, 0.92 - wob, -0.2];
      eyes = 'hurt'; mouth = 'open'; earX = 0.8; earZ = 0.15;
    } else if (P.slideT > 0) {
      // おなかすべり：腹ばいで両手を前へ、足は後ろでぱたぱた
      key = 'slide';
      pitch = 1.25;
      sq = lerp(sq, 1, 0.6);
      roll = Math.sin(t * 16) * 0.05;
      hands[0] = [-0.4, 1.2, 0.56]; hands[1] = [0.4, 1.2, 0.56];
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        const kk = Math.sin(t * 14 + i * Math.PI); // ひざを曲げて、足のうらを上に向けてぱたぱた
        feet[i] = [sd * 0.2, -0.02 + kk * 0.04, -0.32 - kk * 0.06, 1.85 + kk * 0.4];
      }
      eyes = 'happy'; mouth = 'open'; earX = -0.9;
    } else if (P.crouching && P.groundS && P.groundS.ramp && P.speed > 3) {
      // しゃがんで坂すべり：おしりですべって、両手をあげる
      key = 'bslide';
      lean = -0.28; sq = Math.min(sq, 0.82);
      roll = Math.sin(t * 9) * 0.05;
      feet[0] = [-0.22, -0.06, 0.36, -0.45]; feet[1] = [0.22, -0.06, 0.36, -0.45];
      hands[0] = [-0.62, 1.0, 0.02]; hands[1] = [0.62, 1.0, 0.02];
      eyes = 'happy'; mouth = 'open'; earX = -0.55;
    } else if (P.poundT > 0) {
      // ヒップドロップの着地：足をひらいて、どすん
      key = 'pland';
      feet[0] = [-0.33, 0, 0.06, 0]; feet[1] = [0.33, 0, 0.06, 0];
      hands[0] = [-0.7, 0.4, 0.14]; hands[1] = [0.7, 0.4, 0.14];
      eyes = 'hurt'; mouth = 'open'; earX = 0.6; earZ = 0.25;
    } else if (P.crouching) {
      key = 'crouch';
      sq = Math.min(sq, 0.74);
      hands[0] = [-0.55, 0.34, 0.2]; hands[1] = [0.55, 0.34, 0.2];
      earX = 0.7;
    }
  }
  if (air && st !== 'pound' && !coyote) {
    const up = P.vy > 0;
    key = up ? 'up' : 'down';
    sq *= 1 + clamp(P.vy * 0.006, -0.06, 0.1);
    mouth = up ? 'open' : 'smile';
    if (up) {
      // 上昇中：両手を上げてばんざい、足は前後に
      hands[0] = [-0.58, 0.98, 0.0]; hands[1] = [0.58, 0.98, 0.0];
      if (P.jumpN === 2) { hands[0] = [-0.7, 0.8, -0.05]; hands[1] = [0.42, 1.05, 0.15]; }
      feet[0] = [-0.22, 0.14, 0.18, -0.5]; feet[1] = [0.22, 0.04, -0.16, 0.4];
      earX = -0.4;
    } else {
      // 落下中：手を広げて、耳がふわっと
      const fl = Math.sin(t * 22) * 0.04;
      hands[0] = [-0.7, 0.82 + fl, 0.02]; hands[1] = [0.7, 0.82 - fl, 0.02];
      feet[0] = [-0.24, 0.02, 0.08, 0.3]; feet[1] = [0.24, 0.06, -0.04, -0.2];
      earX = 0.22;
    }
    if (P.longJump && !P.dive) {
      // 幅とび：体を前に倒し、手を前に伸ばす
      key = 'long';
      lean = 1.15;
      hands[0] = [-0.42, 0.75, 0.42]; hands[1] = [0.42, 0.75, 0.42];
      feet[0] = [-0.22, 0.12, -0.25, 0.9]; feet[1] = [0.22, 0.12, -0.25, 0.9];
      earX = -0.6;
      mouth = 'open';
    }
    if (PM.wallKickT < 0.32 && P.vy > 0 && !flipping) {
      // 壁キックの直後：手を前に、足は後ろへけり出した形で、壁からぴょーん
      key = 'wkick';
      lean = 0.3 * (1 - PM.wallKickT / 0.32);
      hands[0] = [-0.6, 1.05, 0.22]; hands[1] = [0.6, 1.05, 0.22];
      feet[0] = [-0.2, 0.16, -0.34, 0.95]; feet[1] = [0.2, 0.06, -0.26, 0.7];
      eyes = 'open'; mouth = 'open'; earX = -0.7;
    }
    if (curling) {
      // 宙返り中は丸くなる
      key = 'curl';
      hands[0] = [-0.45, 0.6, 0.38]; hands[1] = [0.45, 0.6, 0.38];
      feet[0] = [-0.2, 0.22, 0.25, -1.0]; feet[1] = [0.2, 0.22, 0.25, -1.0];
      eyes = 'happy';
      earX = -0.5;
    } else if (flipping && P.sideFlip) {
      // くるりんジャンプ：手足を大の字に広げて、横向きにくるっと（回転は下の行列で）
      key = 'side';
      hands[0] = [-0.8, 0.98, 0.04]; hands[1] = [0.8, 0.98, 0.04];
      feet[0] = [-0.34, 0.03, 0, 0.15]; feet[1] = [0.34, 0.03, 0, 0.15];
      eyes = 'happy'; mouth = 'open'; earX = -0.2; earZ = 0.35;
    } else if (flipping && PM.poundJump) {
      // ヒップドロップ後の大ジャンプ：両手をそろえてまっすぐ上へ、きりもみ回転
      key = 'pjump';
      sq *= 1.08;
      hands[0] = [-0.22, 1.33, 0.03]; hands[1] = [0.22, 1.33, 0.03];
      feet[0] = [-0.1, -0.05, 0, 0.4]; feet[1] = [0.1, -0.05, 0, 0.4];
      eyes = 'happy'; mouth = 'open'; earX = -0.35;
    }
    if (P.kickT > 0 && !P.dive) {
      // 空中キック：片足をぴんと前へ、体は少し後ろへ
      key = 'kick';
      feet[1] = [0.18, 0.4, 0.55, -1.35]; feet[0] = [-0.2, 0.2, -0.12, 0.5];
      hands[0] = [-0.66, 0.85, -0.12]; hands[1] = [0.6, 0.72, -0.2];
      lean = -0.3;
      eyes = 'hurt'; mouth = 'open'; earX = 0.4;
    }
    if (P.dive) {
      // ダイブ：体を前へ倒し、両手を頭の先へのばして飛びこむ
      key = 'dive';
      lean = 0;
      pitch = 1.0 + clamp(-P.vy * 0.025, -0.15, 0.25);
      sq = lerp(sq, 1.06, 0.7);
      hands[0] = [-0.32, 1.36, 0.34]; hands[1] = [0.32, 1.36, 0.34];
      feet[0] = [-0.2, 0.04, -0.16, 1.1]; feet[1] = [0.2, 0.1, -0.12, 1.25];
      eyes = 'open'; mouth = 'open'; earX = -0.9;
    }
    if (P.wallSlide && P.wall) {
      // 壁ずり落ち：体を横向きにして壁に手と足をつき、ずずずと落ちる
      key = 'wall';
      const W = Math.atan2(-P.wall.nx, -P.wall.nz); // 壁の方向
      if (!shadowPass && PM.key !== 'wall') PM.wallSide = angDiff(P.yaw, W) >= 0 ? 1 : -1;
      const sd = PM.wallSide, A = 1.1;
      yawOff = angDiff(P.yaw, W - sd * A);
      const wx = sd * Math.sin(A), wz = Math.cos(A); // 体から見た壁の方向
      offX = -wx * 0.16; offZ = -wz * 0.16;
      const jit = Math.sin(t * 34) * 0.012;
      bob = jit;
      lean = -0.1; roll = sd * 0.12;
      const iw = sd > 0 ? 1 : 0;
      hands[iw] = [wx * 0.58, 1.02 + jit, wz * 0.58];
      hands[1 - iw] = [-sd * 0.7, 0.74, 0.16];
      feet[iw] = [wx * 0.44, 0.3, wz * 0.44, -0.4];
      feet[1 - iw] = [-sd * 0.2, -0.02, -0.04, 0.25];
      eyes = 'hurt'; mouth = 'smile';
      earX = 0.35 + Math.sin(t * 25) * 0.1;
    }
  }
  if (st === 'pound') {
    if (poundSpin) {
      key = 'pspin';
      hands[0] = [-0.45, 0.62, 0.36]; hands[1] = [0.45, 0.62, 0.36];
      feet[0] = [-0.2, 0.24, 0.26, -1.0]; feet[1] = [0.2, 0.24, 0.26, -1.0];
      eyes = 'happy';
    } else {
      // 急降下：足をそろえて下へ、手は上へ
      key = 'pound';
      sq *= 1.1;
      hands[0] = [-0.42, 1.08, -0.05]; hands[1] = [0.42, 1.08, -0.05];
      feet[0] = [-0.13, -0.04, 0, 0.15]; feet[1] = [0.13, -0.04, 0, 0.15];
      eyes = 'hurt';
      earX = 0.5;
    }
  }
  if (st === 'punch') {
    const n = P.punchN || 1;
    mouth = 'open';
    if (n < 3) {
      // 1発目は右手、2発目は左手のストレート。すばやく出して、ゆっくりもどす
      key = 'p' + n;
      const s = P.stateT, T0 = 0.07;
      const k = s < T0 ? smooth(s / T0) : 1 - smooth(clamp((s - T0) / 0.25, 0, 1)) * 0.8;
      const sd = n === 1 ? 1 : -1;
      const iP = n === 1 ? 1 : 0, iB = 1 - iP;
      hands[iP] = [sd * (0.3 - k * 0.1), 0.68, 0.14 + k * 0.64];
      hands[iB] = [-sd * 0.56, 0.6, -0.05 - 0.2 * k];
      twist = -sd * k * 0.5;
      lean = 0.2 * k;
      roll = sd * 0.04 * k;
      feet[iB][2] = 0.16 * k; feet[iP][2] = -0.12 * k;
      if (n === 2) eyes = 'hurt';
    } else {
      // 3発目：まわしげり。その場で1回転しながら、右足を横へのばす
      key = 'p3';
      const u = clamp(P.stateT / 0.42, 0, 1);
      spin = -smooth(clamp(u / 0.78, 0, 1)) * TAU;
      const ext = Math.sin(clamp(u / 0.85, 0, 1) * Math.PI);
      feet[1] = [0.28 + ext * 0.56, 0.06 + ext * 0.4, 0.04 + ext * 0.12, -0.2 - ext * 0.5];
      feet[0] = [-0.14, 0, 0.02, 0.05];
      hands[0] = [-0.48, 0.78, 0.28]; hands[1] = [0.58, 0.84, -0.18];
      lean = -0.08 * ext; roll = ext * 0.3; bob = ext * 0.1;
      twist = 0;
      eyes = 'hurt'; earX = 0.3 * ext; earZ = 0.3 * ext;
    }
  }
  if (st === 'hurt' || st === 'dead') {
    key = 'hurt';
    const fl = Math.sin(t * 30) * 0.06;
    lean = -0.35;
    hands[0] = [-0.72, 0.95 + fl, 0.05]; hands[1] = [0.72, 0.95 - fl, 0.05];
    feet[0] = [-0.25, 0.1, 0.18, -0.6]; feet[1] = [0.25, 0.05, 0.1, -0.4];
    eyes = 'hurt'; mouth = 'open'; earX = 0.4;
  }
  if (st === 'win') {
    // 勝利ポーズ：ぴょんぴょん跳ねて、両手を上げる
    key = 'win';
    const hop = Math.abs(Math.sin(ph * 0.75));
    bob = hop * 0.32;
    sq *= 1 + (hop - 0.5) * 0.14;
    const w = Math.sin(ph * 2) * 0.08;
    hands[0] = [-0.52, 1.18 - w, 0.08]; hands[1] = [0.52, 1.18 + w, 0.08];
    feet[0] = [-0.22, hop * 0.06, 0.05, -0.3 * hop]; feet[1] = [0.22, hop * 0.06, 0.05, -0.3 * hop];
    eyes = 'happy'; mouth = 'open';
    roll = Math.sin(ph * 0.75) * 0.08;
    earX = -0.2 * hop; earZ = 0.15 * hop;
  }

  // ---- 前のポーズからなめらかにつなぐ ----
  {
    const c = PM.cur;
    c.set(hands[0], 0); c.set(hands[1], 3); c.set(feet[0], 6); c.set(feet[1], 10);
    c[14] = lean; c[15] = roll; c[16] = twist; c[17] = bob; c[18] = pitch;
    c[19] = yawOff; c[20] = offX; c[21] = offZ; c[22] = earX; c[23] = earZ;
    if (!shadowPass) {
      if (snap) { PM.key = key; PM.fade = 1; }
      else if (key !== PM.key) { PM.dur = poseDur(PM.key, key); PM.key = key; PM.from.set(PM.last); PM.fade = 0; }
      PM.fade = Math.min(1, PM.fade + dt / PM.dur);
    }
    if (PM.fade < 1) {
      const w = smooth(PM.fade), f = PM.from;
      for (let i = 0; i < POSE_N; i++) c[i] = f[i] + (c[i] - f[i]) * w;
    }
    if (!shadowPass) PM.last.set(c);
    for (let i = 0; i < 3; i++) { hands[0][i] = c[i]; hands[1][i] = c[3 + i]; }
    for (let i = 0; i < 4; i++) { feet[0][i] = c[6 + i]; feet[1][i] = c[10 + i]; }
    lean = c[14]; roll = c[15]; twist = c[16]; bob = c[17]; pitch = c[18];
    yawOff = c[19]; offX = c[20]; offZ = c[21]; earX = c[22]; earZ = c[23];
  }

  // ---- 体の行列 ----
  const m = M4.ident();
  M4.translate(m, P.x, P.y, P.z);
  M4.rotY(m, P.yaw + yawOff + spin);
  if (P.flip && st !== 'dead') {
    // 宙返り：回りすぎないよう1回転でとめ、終わりぎわはゆっくり
    const a = Math.min(Math.abs(P.flip), TAU);
    const e = a < TAU * 0.85 ? a : TAU * 0.85 + (a - TAU * 0.85) * 0.6 + smooth((a - TAU * 0.85) / (TAU * 0.15)) * TAU * 0.06;
    M4.translate(m, 0, 0.65, 0);
    if (P.sideFlip) {
      // くるりんジャンプ：もとの向きからくるっと振り向きつつ、横に1回転
      M4.rotY(m, PM.sideFrom * (1 - smooth(clamp(a / (TAU * 0.6), 0, 1))));
      M4.rotZ(m, (PM.sideFrom >= 0 ? 1 : -1) * e);
    } else if (PM.poundJump) {
      M4.rotY(m, -e); // きりもみ
    } else {
      M4.rotX(m, Math.sign(P.flip) * e);
    }
    M4.translate(m, 0, -0.65, 0);
  }
  if (st === 'dead') { M4.translate(m, 0, 0.7, 0); M4.rotZ(m, P.flip); M4.translate(m, 0, -0.7, 0); }
  M4.translate(m, offX, bob, offZ);
  if (twist) M4.rotY(m, twist);
  if (lean) M4.rotX(m, lean);
  if (pitch) { M4.translate(m, 0, 0.6, 0); M4.rotX(m, pitch); M4.translate(m, 0, -0.6, 0); }
  if (roll) M4.rotZ(m, roll);
  // つぶれ・伸び（体積を保つように横も変える）
  const sxz = 1 / Math.sqrt(sq);
  const body = M4.copy(m);
  M4.scale(body, sxz, sq, sxz);
  drawMesh(Models.body, body);

  // ---- 顔 ----
  if (!shadowPass) {
    // まばたき：3.4秒ごと、ときどき2回
    const bt = (t + 0.4) % 3.4, cyc = Math.floor((t + 0.4) / 3.4);
    let blink = 1;
    if (bt < 0.14) blink = 0.08 + Math.abs(bt - 0.07) / 0.07 * 0.92;
    else if (cyc % 3 === 1 && bt > 0.24 && bt < 0.38) blink = 0.08 + Math.abs(bt - 0.31) / 0.07 * 0.92;
    if (P.crouching) blink = Math.min(blink, 0.55);
    for (const sd of [-1, 1]) {
      const e = M4.copy(body);
      M4.translate(e, sd * 0.2, 0.86, 0.474);
      M4.rotY(e, sd * 0.36);
      if (eyes === 'open') {
        M4.scale(e, 1, blink, 1);
        drawMesh(Models.eye, e);
      } else if (eyes === 'happy') {
        M4.translate(e, 0, -0.01, 0.04);
        drawMesh(Models.eyeHappy, e);
      } else {
        // ぎゅっと目（> <）
        M4.translate(e, 0, 0, 0.045);
        if (sd > 0) M4.rotZ(e, Math.PI);
        drawMesh(Models.eyeX, e);
      }
    }
    const mo = M4.copy(body);
    if (mouth === 'open') {
      M4.translate(mo, 0, 0.625, 0.545);
      M4.rotX(mo, -0.25);
      drawMesh(Models.mouthOpen, mo);
    } else {
      M4.translate(mo, 0, 0.675, 0.565);
      M4.rotX(mo, -0.3);
      drawMesh(Models.mouth, mo);
    }
  }
  // ---- 耳 ----
  for (const sd of [-1, 1]) {
    const e = M4.copy(body);
    M4.translate(e, sd * 0.3, 1.1, -0.04);
    M4.rotZ(e, sd * (-0.42 - earZ));
    M4.rotX(e, -0.1 + earX);
    drawMesh(Models.ear, e);
  }
  // ---- しっぽ ----
  {
    const tl = M4.copy(body);
    M4.translate(tl, 0, 0.34, -0.53);
    M4.rotY(tl, Math.sin(t * (run ? 14 : 5)) * 0.3);
    drawMesh(Models.tail, tl);
  }
  // ---- 足 ----
  for (let i = 0; i < 2; i++) {
    const f = M4.copy(m);
    const [fx, fy, fz, fa] = feet[i];
    M4.translate(f, fx, fy, fz);
    if (fa) M4.rotX(f, fa);
    M4.scale(f, Math.min(1.1, sxz), 1, 1);
    drawMesh(Models.foot, f);
  }
  // ---- 手（体のつぶれに合わせて高さも動かす）----
  for (let i = 0; i < 2; i++) {
    const hd = M4.copy(m);
    const [hx, hy, hz] = hands[i];
    M4.translate(hd, hx * sxz, hy * sq, hz);
    drawMesh(Models.hand, hd);
  }
  // ---- マフラーのしっぽ（2本。速さと落下でなびく）----
  {
    const wind = clamp(hsp / PL.RUN, 0, 1) + (air ? clamp(Math.abs(P.vy) / 20, 0, 0.7) : 0);
    for (const sd of [-1, 1]) {
      const fl1 = Math.sin(t * 13 + sd) * (0.08 + wind * 0.14);
      const fl2 = Math.sin(t * 15 + 1.3 + sd) * (0.12 + wind * 0.22);
      const s = M4.copy(body);
      M4.translate(s, 0.2 + sd * 0.05, 0.47, -0.6);
      M4.rotY(s, 0.25 + sd * 0.22);
      M4.rotZ(s, sd * 0.12);
      M4.rotX(s, 0.25 + wind * 1.05 + fl1);
      drawMesh(Models.scarfTail, s);
      M4.translate(s, 0, -0.28, 0);
      M4.rotX(s, 0.1 + wind * 0.35 + fl2);
      M4.scale(s, 0.92, 0.85, 1);
      drawMesh(Models.scarfTail, s);
    }
  }
}

// 丸い影を地面に落とす（着地位置の目安。本物の影と重なるので控えめ）
function drawShadow(x, y, z, r, a = 0.32) {
  if (R.pass === 'shadow') return;
  const g = groundBelow(x, z, y + 0.2, 0);
  if (!g) return;
  const h = y - g.y;
  const k = clamp(1 - h / 14, 0.25, 1);
  Sprites.add(x, g.y + 0.03, z, r * 1.25 * (0.6 + 0.4 * k), 3, 0.12, 0.1, 0.2, a * k * 0.8);
}

// ---------- 粒子 ----------
// 種類：ふつうの粒（土ぼこり）／光る粒（emit）／星（star）／輪（ring）／閃光（flash）
const Fx = {
  list: [],
  add(o) { if (this.list.length < 400) this.list.push(o); },
  dust(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 1 + Math.random() * 2;
      this.add({ x: x + Math.cos(a) * 0.3, y: y + 0.12, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.4, vz: Math.sin(a) * s, life: 0.55, max: 0.55, size: 0.2 + Math.random() * 0.14, col: [0.96, 0.92, 0.84], grav: -1.5, alpha: 0.55, drag: 3 });
    }
  },
  skid(x, y, z) { if (Math.random() < 0.5) this.dust(x, y, z, 1); },
  burst(x, y, z, col, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.random() * Math.PI - Math.PI / 2, s = sp * (0.5 + Math.random() * 0.7);
      this.add({ x, y, z, vx: Math.cos(a) * Math.cos(b) * s, vy: Math.sin(b) * s + 2, vz: Math.sin(a) * Math.cos(b) * s, life: 0.6, max: 0.6, size: 0.12 + Math.random() * 0.1, col, grav: 10, alpha: 1, emit: 1, star: i % 3 === 0, drag: 1.5, rot: Math.random() * TAU });
    }
    // はじける瞬間の光
    this.add({ flash: true, x, y, z, life: 0.22, max: 0.22, size: 0.5 + sp * 0.12, col: mixc(col, [1, 1, 1], 0.5) });
    if (n >= 10) this.add({ ring: true, air: true, x, y, z, life: 0.35, max: 0.35, size: 0.3, col: mixc(col, [1, 1, 1], 0.4) });
  },
  sparkle(x, y, z, col) {
    this.add({ x: x + (Math.random() - 0.5), y: y + (Math.random() - 0.5), z: z + (Math.random() - 0.5), vx: 0, vy: 0.8, vz: 0, life: 0.7, max: 0.7, size: 0.1, col, grav: 0, alpha: 1, emit: 1, star: true, rot: Math.random() * TAU });
  },
  ring(x, y, z) { this.add({ ring: true, x, y, z, life: 0.45, max: 0.45, size: 0.5, col: [1, 0.97, 0.9] }); },
  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      if (p.ring || p.flash) continue;
      p.vy -= p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  },
  draw() {
    for (const p of this.list) {
      const k = p.life / p.max;
      const c = p.col;
      if (p.ring) {
        const r = p.size + (1 - k) * (p.air ? 1.8 : 3.5);
        Sprites.add(p.x, p.y + 0.06, p.z, r, 4, c[0], c[1], c[2], k * 0.9);
        if (p.air) Sprites.add(p.x, p.y, p.z, r * 0.8, 1, c[0], c[1], c[2], k * 0.25);
      } else if (p.flash) {
        Sprites.add(p.x, p.y, p.z, p.size * (1.2 + (1 - k) * 1.5), 1, c[0], c[1], c[2], k * 0.6);
      } else if (p.emit) {
        const s = p.size * (0.5 + 0.5 * k);
        const a = p.alpha * Math.min(1, k * 2.5);
        if (p.star) Sprites.add(p.x, p.y, p.z, s * 3.6, 2, c[0], c[1], c[2], a, (p.rot || 0) + (1 - k) * 2);
        else Sprites.add(p.x, p.y, p.z, s * 2.4, 1, c[0], c[1], c[2], a);
      } else {
        // 土ぼこり：ふくらみながら消える
        const s = p.size * (0.7 + (1 - k) * 1.1);
        Sprites.add(p.x, p.y, p.z, s * 1.5, 0, c[0], c[1], c[2], p.alpha * Math.min(1, k * 1.8) * 0.85);
      }
    }
    this.drawGlows();
    Sprites.flush();
  },
  // ひかりの種・ハートのまわりの光（75_entities.js の描く位置に合わせる）
  drawGlows() {
    if (typeof Level === 'undefined') return;
    const t = Game.time;
    for (const s of Level.seeds) {
      if (s.got || s.hidden) continue;
      const y = s.y + Math.sin(s.t * 2) * 0.2;
      const pulse = 0.85 + Math.sin(s.t * 4) * 0.15;
      Sprites.add(s.x, y + 0.75, s.z, 2.2 * pulse, 1, 0.4, 1, 0.85, 0.32);
      Sprites.add(s.x, y + 0.8, s.z, 2.0, 2, 0.8, 1, 0.95, 0.3, t * 0.6);
      Sprites.add(s.x, y + 0.8, s.z, 1.5, 2, 0.8, 1, 0.95, 0.2, -t * 0.9 + 0.7);
      const g = groundBelow(s.x, s.z, s.y + 0.5, 0);
      if (g) {
        Sprites.add(s.x, g.y + 0.05, s.z, 1.4 * pulse, 5, 0.4, 1, 0.85, 0.4);
        const rk = (t * 0.7 + s.id * 0.3) % 1;
        Sprites.add(s.x, g.y + 0.06, s.z, 0.4 + rk * 1.0, 4, 0.6, 1, 0.9, (1 - rk) * 0.6);
      }
    }
    for (const h of Level.hearts) {
      if (h.got) continue;
      Sprites.add(h.x, h.y + Math.sin(h.t) * 0.15, h.z, 1.1, 1, 1, 0.45, 0.55, 0.3);
    }
  },
};
