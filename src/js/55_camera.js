// カメラ（主人公の後ろを追いかける。ドラッグ・Q/E・右スティックで回せる）
const Cam = {
  yaw: Math.PI, pitch: 0.38, dist: 10.5,
  zoomLv: 1, dists: [7, 10.5, 15],
  tx: 0, ty: 0, tz: 0,
  eye: [0, 5, 10],
  manualT: 9,
  fov: 0.95,
  shown: 10.5,
  override: null,  // 演出用 {eye, target}
};

function camReset() {
  Cam.yaw = P.yaw + Math.PI;
  Cam.tx = P.x; Cam.ty = P.y + 1.2; Cam.tz = P.z;
  Cam.pitch = 0.38;
  Cam.shown = Cam.dist;
  Cam.manualT = 9;
}

function updateCamera(dt) {
  if (Input.zoomP) {
    Cam.zoomLv = (Cam.zoomLv + 1) % 3;
    Sound.play('select');
  }
  Cam.dist = Cam.dists[Cam.zoomLv];

  // 手動操作
  const sens = Input.touchMode ? 0.008 : 0.006;
  if (Input.camDX || Input.camDY || Input.camKey) {
    Cam.yaw -= Input.camDX * sens + Input.camKey * dt * 2.4;
    Cam.pitch = clamp(Cam.pitch + Input.camDY * sens * 0.8, -0.15, 1.2);
    Cam.manualT = 0;
  } else Cam.manualT += dt;

  // 自動で後ろに回り込む（走っている時だけ、ゆっくり）
  if (Cam.manualT > 1.2 && P.state !== 'dead') {
    const sp = Math.hypot(P.vx, P.vz);
    const behind = P.yaw + Math.PI;
    const d = angDiff(Cam.yaw, behind);
    // 横向きに走るとカメラがゆっくり回る。正面に向かって走るときはあまり回さない
    const k = clamp(sp / PL.RUN, 0, 1) * (Math.abs(d) > 2.4 ? 0.15 : 1);
    Cam.yaw += d * k * dt * 1.4;
    Cam.pitch = lerp(Cam.pitch, P.grounded ? 0.36 : 0.42, dt * 0.8);
  }

  // 注視点：上下はゆっくり追従（ジャンプで画面が揺れないように）
  const ty = P.y + 1.2;
  Cam.tx = lerp(Cam.tx, P.x, 1 - Math.exp(-dt * 10));
  Cam.tz = lerp(Cam.tz, P.z, 1 - Math.exp(-dt * 10));
  const vyRate = P.grounded || P.y < Cam.ty - 3 ? 6 : 2.2;
  Cam.ty = lerp(Cam.ty, ty, 1 - Math.exp(-dt * vyRate));
  if (P.state === 'dead') Cam.ty = Math.max(Cam.ty, World.killY + 6);

  // めり込み防止
  const target = [Cam.tx, Cam.ty, Cam.tz];
  const cp = Math.cos(Cam.pitch), sp = Math.sin(Cam.pitch);
  const want = [
    Cam.tx + Math.sin(Cam.yaw) * cp * Cam.dist,
    Cam.ty + sp * Cam.dist,
    Cam.tz + Math.cos(Cam.yaw) * cp * Cam.dist,
  ];
  const t = raycast(target, want);
  const dWant = Cam.dist * Math.max(0.18, t - 0.04);
  Cam.shown = dWant < Cam.shown ? lerp(Cam.shown, dWant, 1 - Math.exp(-dt * 25)) : lerp(Cam.shown, dWant, 1 - Math.exp(-dt * 3));
  let eye = [
    Cam.tx + Math.sin(Cam.yaw) * cp * Cam.shown,
    Cam.ty + sp * Cam.shown,
    Cam.tz + Math.cos(Cam.yaw) * cp * Cam.shown,
  ];
  let tgt = target;
  if (Cam.override) { eye = Cam.override.eye; tgt = Cam.override.target; }
  if (Game.shake > 0) {
    const s = Game.shake * 0.5;
    eye = [eye[0] + (Math.random() - 0.5) * s, eye[1] + (Math.random() - 0.5) * s, eye[2] + (Math.random() - 0.5) * s];
  }
  Cam.eye = eye;
  Cam.target = tgt;
}
