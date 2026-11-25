// カメラ（主人公の後ろを追いかける。ドラッグ・Q/E・右スティックで回せる）
// 考え方：
//  ・ふだんは「ひもでつながったカメラ」：前の位置から主人公へ引っぱられるだけなので、
//    横に走ると自然に回り、手前に走っても勝手にぐるっと回らない
//  ・しばらく手で回していないときだけ、走っている向きの後ろへ「ゆっくり」寄せる
//  ・上下は「最後に立っていた高さ」を基準にして、ジャンプのたびに揺れない
//  ・壁や塔の中に入らないよう、5本の線で調べて手前に寄る
const Cam = {
  yaw: Math.PI, pitch: 0.38, dist: 10.5,
  zoomLv: 1, dists: [6.5, 10.5, 15],
  tx: 0, ty: 0, tz: 0,
  eye: [0, 5, 10],
  target: [0, 0, 0],
  manualT: 9,
  fov: 0.95,
  shown: 10.5,
  override: null,  // 演出用 {eye, target}
  baseY: 0,        // 上下の基準（最後に立っていた高さ）
  lastWant: 0, vWantS: 0,
  vy: 0,           // 注視点の上下の速さ（ばね）
  resetT: 0,       // 後ろへ回り込み中
  pitchAuto: 0.36,
  aheadX: 0, aheadZ: 0,
  distS: 10.5,
};
const camWant = [0, 0, 0];
const camTmpA = [0, 0, 0], camTmpB = [0, 0, 0];

function camReset() {
  Cam.yaw = P.yaw + Math.PI;
  Cam.tx = P.x; Cam.ty = P.y + 1.2; Cam.tz = P.z;
  Cam.baseY = P.y; Cam.vy = 0; Cam.lastWant = P.y + 1.2; Cam.vWantS = 0;
  Cam.pitch = 0.36;
  Cam.dist = Cam.distS = Cam.dists[Cam.zoomLv];
  Cam.shown = Cam.dist;
  Cam.manualT = 9;
  Cam.aheadX = Cam.aheadZ = 0;
  Cam.override = null;
}

// 線分 a→b とワールドの交差（カメラ用）。円柱はきちんと丸で、細い柱・飾りは無視する
function camRay(ax, ay, az, bx, by, bz) {
  let tMin = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const sol = World.solids;
  for (let i = 0; i < sol.length; i++) {
    const s = sol[i];
    if (s.noCam || s.off) continue; // 消えている足場には当たらない
    if (s.type === 'cyl') {
      if (s.r < 0.8) continue; // 木の幹などは無視（見えなくなっても一瞬）
      // XZ 平面で円と交差
      const ox = ax - s.x, oz = az - s.z;
      const A = dx * dx + dz * dz;
      const C = ox * ox + oz * oz - s.r * s.r;
      let t0;
      if (C <= 0) t0 = 0; // 始点が円の中（主人公が円柱の上にいるときなど）
      else {
        if (A < 1e-9) continue;
        const B = ox * dx + oz * dz;
        const disc = B * B - A * C;
        if (disc < 0) continue;
        t0 = (-B - Math.sqrt(disc)) / A;
        if (t0 < 0 || t0 >= tMin) continue;
      }
      // その点の高さが円柱の高さの範囲内か（上面を少し下げて、乗っているときに引っかからない）
      const y = ay + dy * t0;
      if (y < s.y0 || y > s.y1 - 0.05) {
        // 上面・下面から入る場合
        const yc = dy > 0 ? s.y0 : s.y1 - 0.05;
        if (Math.abs(dy) < 1e-9) continue;
        const tc = (yc - ay) / dy;
        if (tc <= 0 || tc >= tMin) continue;
        const px = ax + dx * tc - s.x, pz = az + dz * tc - s.z;
        if (px * px + pz * pz > s.r * s.r) continue;
        if (C <= 0 && tc < 0.02) continue;
        tMin = tc;
        continue;
      }
      if (t0 > 0.001) tMin = t0;
      continue;
    }
    // 箱（坂は上面の真ん中の高さまで）
    const x0 = s.x0, x1 = s.x1, z0 = s.z0, z1 = s.z1, y0 = s.y0;
    const y1 = s.ramp ? (s.y0 + s.y1) * 0.5 : s.y1 - 0.05;
    if (x1 - x0 < 0.5 && z1 - z0 < 0.5) continue;
    let t0 = 0, t1 = tMin;
    // x
    if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) continue; }
    else {
      let ta = (x0 - ax) / dx, tb = (x1 - ax) / dx;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) continue; }
    else {
      let ta = (y0 - ay) / dy, tb = (y1 - ay) / dy;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) continue; }
    else {
      let ta = (z0 - az) / dz, tb = (z1 - az) / dz;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (t0 > 0.001 && t0 < tMin) tMin = t0;
  }
  return tMin;
}

function updateCamera(dt) {
  // ---- 遠近 ----
  if (Input.zoomP) { Cam.zoomLv = (Cam.zoomLv + 1) % 3; Sound.play('cursor'); }
  if (Input.zoomStep) { Cam.zoomLv = clamp(Cam.zoomLv + Input.zoomStep, 0, 2); }
  Cam.dist = Cam.dists[Cam.zoomLv];
  Cam.distS = lerp(Cam.distS, Cam.dist, 1 - Math.exp(-dt * 6));

  // ---- 手動操作 ----
  const W = window.innerWidth, H = window.innerHeight;
  // タッチは画面の大きさに合わせる（横いっぱいなぞると約 1 周弱）
  const sens = Input.touchMode ? 6.5 / Math.max(W, H, 320) : 0.0055;
  let manual = false;
  if (Input.camDX || Input.camDY) {
    Cam.yaw -= Input.camDX * sens;
    Cam.pitch += Input.camDY * sens * 0.75;
    manual = true;
  }
  if (Input.camKey) { Cam.yaw -= Input.camKey * dt * 2.6; manual = true; }
  if (Input.camRX || Input.camRY) {
    Cam.yaw -= Input.camRX * Math.abs(Input.camRX) * dt * 3.4;
    Cam.pitch += Input.camRY * dt * 1.6;
    manual = true;
  }
  Cam.pitch = clamp(Cam.pitch, -0.12, 1.25);
  if (manual) { Cam.manualT = 0; Cam.resetT = 0; } else Cam.manualT += dt;

  if (Input.camResetP) { Cam.resetT = 0.6; Sound.play('cursor'); }

  // ---- 注視点（左右） ----
  const sp = Math.hypot(P.vx, P.vz);
  // 進む方向を少し先まで見せる
  const ahead = P.state === 'dead' ? 0 : clamp(sp / PL.RUN, 0, 1.3) * 1.1;
  const ax = sp > 0.1 ? (P.vx / sp) * ahead : 0, az = sp > 0.1 ? (P.vz / sp) * ahead : 0;
  Cam.aheadX = lerp(Cam.aheadX, ax, 1 - Math.exp(-dt * 2.5));
  Cam.aheadZ = lerp(Cam.aheadZ, az, 1 - Math.exp(-dt * 2.5));
  const oldTx = Cam.tx, oldTz = Cam.tz;
  Cam.tx = lerp(Cam.tx, P.x + Cam.aheadX, 1 - Math.exp(-dt * 9));
  Cam.tz = lerp(Cam.tz, P.z + Cam.aheadZ, 1 - Math.exp(-dt * 9));

  // ---- 注視点（上下）：立った高さを基準に、ばねでなめらかに ----
  if (P.state === 'dead') {
    // たおれたら、その高さで止める（島をつきぬけて雲の下まで追いかけない）。落ちてたおれたときは雲の上から見る
    Cam.baseY = Math.max(Cam.baseY, World.killY + 6);
  }
  else if (P.grounded) Cam.baseY = P.y;
  else if (P.y < Cam.baseY) Cam.baseY = P.y;                   // 下へ落ちるときはついていく
  else if (P.y > Cam.baseY + 3.2) Cam.baseY = P.y - 3.2;       // ばね・壁キックで高く上がるとき
  const tyWant = Cam.baseY + 1.2;
  // 目標の動く速さ（落下中などは追いかけ遅れが出ないように足す。段差で一気に変わったときは使わない）
  let vWant = (tyWant - Cam.lastWant) / Math.max(dt, 1e-4);
  if (Math.abs(tyWant - Cam.lastWant) > 0.3) vWant = 0;
  Cam.lastWant = tyWant;
  Cam.vWantS = lerp(Cam.vWantS, vWant, 1 - Math.exp(-dt * 8));
  // 臨界減衰ばね（行きすぎず、急に止まらない）。主人公が画面の端に近いほど固く
  const off = Math.abs(P.y + 1.2 - Cam.ty);
  const w = 5 + clamp((off - 2) / 2, 0, 1) * 3;
  const acc = w * w * (tyWant - Cam.ty) + 2 * w * (Cam.vWantS - Cam.vy);
  Cam.vy += acc * dt;
  Cam.ty += Cam.vy * dt;

  // ---- 向き：ひもでつながったカメラ ----
  if (!manual && Cam.resetT <= 0 && P.state !== 'dead') {
    // 前のフレームのカメラ位置から、動いた注視点を見たときの角度
    const ex = oldTx + Math.sin(Cam.yaw) * Cam.distS, ez = oldTz + Math.cos(Cam.yaw) * Cam.distS;
    const lx = ex - Cam.tx, lz = ez - Cam.tz;
    if (lx * lx + lz * lz > 0.01) Cam.yaw += angDiff(Cam.yaw, Math.atan2(lx, lz));
  }
  // ---- 手で動かしていない間だけ、ゆっくり後ろへ寄せる ----
  if (Cam.resetT > 0) {
    Cam.resetT -= dt;
    Cam.yaw += angDiff(Cam.yaw, P.yaw + Math.PI) * (1 - Math.exp(-dt * 10));
    Cam.pitch = lerp(Cam.pitch, 0.36, 1 - Math.exp(-dt * 8));
  } else if (Cam.manualT > 1.6 && P.state !== 'dead') {
    const d = angDiff(Cam.yaw, P.yaw + Math.PI);
    // 手前（カメラの方）へ走るときは回さない。横〜奥へ走っているときだけ
    if (P.grounded && sp > 4 && Math.abs(d) < 2.0) {
      Cam.yaw += d * clamp(sp / PL.RUN, 0, 1) * dt * 0.7;
    }
    // 上下の角度：高い所から下を見るときは少し見下ろす
    let pw = 0.36;
    if (!P.grounded && P.vy < -10) pw = 0.55;
    Cam.pitchAuto = lerp(Cam.pitchAuto, pw, 1 - Math.exp(-dt * 1.5));
    if (Cam.manualT > 3) Cam.pitch = lerp(Cam.pitch, Cam.pitchAuto, 1 - Math.exp(-dt * 0.8));
  }

  // ---- めり込み防止 ----
  const cp = Math.cos(Cam.pitch), spi = Math.sin(Cam.pitch);
  const dist = Cam.distS;
  const ox = Math.sin(Cam.yaw) * cp, oy = spi, oz = Math.cos(Cam.yaw) * cp;
  camWant[0] = Cam.tx + ox * dist; camWant[1] = Cam.ty + oy * dist; camWant[2] = Cam.tz + oz * dist;
  // 中心と、横・上下にずらした 4 本（画面の端が壁に入らないように）
  const rx = Math.cos(Cam.yaw) * 0.35, rz = -Math.sin(Cam.yaw) * 0.35;
  let t = camRay(Cam.tx, Cam.ty, Cam.tz, camWant[0], camWant[1], camWant[2]);
  t = Math.min(t, camRay(Cam.tx, Cam.ty, Cam.tz, camWant[0] + rx, camWant[1], camWant[2] + rz) + 0.04);
  t = Math.min(t, camRay(Cam.tx, Cam.ty, Cam.tz, camWant[0] - rx, camWant[1], camWant[2] - rz) + 0.04);
  t = Math.min(t, camRay(Cam.tx, Cam.ty, Cam.tz, camWant[0], camWant[1] + 0.3, camWant[2]) + 0.04);
  t = Math.min(t, camRay(Cam.tx, Cam.ty, Cam.tz, camWant[0], camWant[1] - 0.3, camWant[2]) + 0.04);
  const dWant = Math.max(0.4, dist * clamp(t, 0, 1) - 0.3);
  // さえぎられたらすぐ手前へ（壁の中を映さない）、離れるときはゆっくり
  Cam.shown = dWant < Cam.shown ? dWant : lerp(Cam.shown, dWant, 1 - Math.exp(-dt * 2.5));
  const eye = camTmpA;
  eye[0] = Cam.tx + ox * Cam.shown;
  eye[1] = Cam.ty + oy * Cam.shown;
  eye[2] = Cam.tz + oz * Cam.shown;
  // 地面の下に入らない
  const g = groundBelow(eye[0], eye[2], eye[1] + 0.6, 0.1);
  if (g && eye[1] < g.y + 0.4) eye[1] = g.y + 0.4;

  const tgt = camTmpB;
  tgt[0] = Cam.tx; tgt[1] = Cam.ty; tgt[2] = Cam.tz;
  if (Cam.override) {
    eye[0] = Cam.override.eye[0]; eye[1] = Cam.override.eye[1]; eye[2] = Cam.override.eye[2];
    tgt[0] = Cam.override.target[0]; tgt[1] = Cam.override.target[1]; tgt[2] = Cam.override.target[2];
  }
  if (Game.shake > 0) {
    const s = Math.min(Game.shake, 0.4) * 0.5;
    eye[0] += (Math.random() - 0.5) * s; eye[1] += (Math.random() - 0.5) * s; eye[2] += (Math.random() - 0.5) * s;
  }
  // 描画側に渡す（中身だけ書きかえる）
  Cam.eye[0] = eye[0]; Cam.eye[1] = eye[1]; Cam.eye[2] = eye[2];
  Cam.target[0] = tgt[0]; Cam.target[1] = tgt[1]; Cam.target[2] = tgt[2];
}
