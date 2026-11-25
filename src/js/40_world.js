// 当たり判定の世界（足場＝箱・坂・円柱）
// 箱 : {type:'box', x0,y0,z0,x1,y1,z1}
// 坂 : 箱に ramp:{axis:'x'|'z', a, b}（軸の始点の高さ a → 終点の高さ b、y1 = max(a,b)）
// 円柱: {type:'cyl', x,z,r,y0,y1}
// 回転箱: {type:'obox', cx,cz, hx,hz（半分の大きさ）, ang（Y軸まわりの角度）, y0,y1}
// 共通: kind（'grass' 'stone' 'wood' 'ice' 'spring' 'lava'）, dx,dy,dz（このフレームの移動量）
//       rotY（このフレームの回転量。cx,cz を中心に回る。50_player.js が乗っている主人公を一緒に回す）
const World = {
  solids: [],
  killY: -40,
  clear() { this.solids = []; },
  add(s) {
    s.dx = s.dy = s.dz = 0;
    s.kind = s.kind || 'grass';
    this.solids.push(s);
    return s;
  },
  box(x0, y0, z0, x1, y1, z1, kind) {
    return this.add({ type: 'box', x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), kind });
  },
  // 中心とサイズで箱
  boxC(cx, cy, cz, sx, sy, sz, kind) {
    return this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, kind);
  },
  ramp(x0, z0, x1, z1, y0, axis, a, b, kind) {
    const s = this.box(x0, y0, z0, x1, Math.max(a, b), z1, kind);
    s.ramp = { axis, a, b };
    return s;
  },
  cyl(x, z, r, y0, y1, kind) {
    return this.add({ type: 'cyl', x, z, r, y0, y1, kind });
  },
  // 回転できる箱（中心 cx,cz、大きさ sx×sz、角度 ang）
  obox(cx, cz, sx, sz, ang, y0, y1, kind) {
    const s = this.add({ type: 'obox', cx, cz, hx: sx / 2, hz: sz / 2, ang, y0, y1, kind });
    oboxBounds(s);
    return s;
  },
  move(s, dx, dy, dz) {
    if (s.type === 'cyl') { s.x += dx; s.z += dz; if (s.cx !== undefined) { s.cx = s.x; s.cz = s.z; } }
    else if (s.type === 'obox') { s.cx += dx; s.cz += dz; oboxBounds(s); }
    else { s.x0 += dx; s.x1 += dx; s.z0 += dz; s.z1 += dz; }
    s.y0 += dy; s.y1 += dy;
    s.dx += dx; s.dy += dy; s.dz += dz;
  },
  // Y軸まわりに回す（回転箱・円柱）。乗っている主人公は 50_player.js が rotY を見て一緒に回す
  rotate(s, da) {
    if (s.type === 'obox') { s.ang += da; oboxBounds(s); }
    if (s.type === 'cyl') { s.cx = s.x; s.cz = s.z; s.spin = (s.spin || 0) + da; }
    s.rotY = (s.rotY || 0) + da;
  },
};

// 回転箱：ワールド→箱のローカル座標（M4.rotY と同じ向き）
function oboxLocal(s, x, z) {
  const c = Math.cos(s.ang), sn = Math.sin(s.ang);
  const dx = x - s.cx, dz = z - s.cz;
  return [c * dx - sn * dz, sn * dx + c * dz];
}
// 回転箱を囲む軸平行の箱（x0〜z1）も持っておく（カメラ判定などの大まかな判定用）
function oboxBounds(s) {
  const c = Math.abs(Math.cos(s.ang)), sn = Math.abs(Math.sin(s.ang));
  const ex = c * s.hx + sn * s.hz, ez = sn * s.hx + c * s.hz;
  s.x0 = s.cx - ex; s.x1 = s.cx + ex; s.z0 = s.cz - ez; s.z1 = s.cz + ez;
}

// 上面の高さ
function topAt(s, x, z) {
  if (!s.ramp) return s.y1;
  const r = s.ramp;
  const t = r.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
  return lerp(r.a, r.b, clamp(t, 0, 1)) + (s.y1 - Math.max(r.a, r.b)); // 動く坂にも対応
}

// (x,z) が足場の上か（pad だけ外側まで許す）
function overXZ(s, x, z, pad) {
  if (s.type === 'cyl') return Math.hypot(x - s.x, z - s.z) <= s.r + pad;
  if (s.type === 'obox') {
    if (x < s.x0 - pad || x > s.x1 + pad || z < s.z0 - pad || z > s.z1 + pad) return false;
    const l = oboxLocal(s, x, z);
    return Math.abs(l[0]) <= s.hx + pad && Math.abs(l[1]) <= s.hz + pad;
  }
  return x >= s.x0 - pad && x <= s.x1 + pad && z >= s.z0 - pad && z <= s.z1 + pad;
}

// 足元の地面を探す：yFrom 以下で一番高い上面。戻り値 {y, s} または null
function groundBelow(x, z, yFrom, pad = 0) {
  let best = null;
  for (const s of World.solids) {
    if (s.off) continue;
    if (!overXZ(s, x, z, pad)) continue;
    let top;
    if (s.ramp) top = topAt(s, clamp(x, s.x0, s.x1), clamp(z, s.z0, s.z1));
    else top = s.y1;
    if (top <= yFrom + 1e-4 && (!best || top > best.y)) best = { y: top, s };
  }
  return best;
}

// 頭上の天井
function ceilingAbove(x, z, yHead, yHeadNew, pad) {
  let best = null;
  for (const s of World.solids) {
    if (s.off) continue;
    if (!overXZ(s, x, z, -pad)) continue;
    if (s.y0 >= yHead - 1e-3 && s.y0 < yHeadNew && (!best || s.y0 < best)) best = s.y0;
  }
  return best;
}

// 横方向の押し戻し。p:{x,y,z,r,h}。戻り値：一番強く当たった壁 {nx,nz,s} または null
const STEP_H = 0.45;
function pushOutXZ(p) {
  let wall = null, wallPush = 0;
  for (let iter = 0; iter < 2; iter++) {
    for (const s of World.solids) {
      if (s.off) continue;
      if (p.y + p.h <= s.y0 + 0.02) continue;
      let cx, cz;
      if (s.type === 'obox') {
        // ローカル座標で箱と同じ計算をして、法線をワールドに戻す
        if (p.y >= s.y1 - STEP_H) continue;
        if (p.x < s.x0 - p.r || p.x > s.x1 + p.r || p.z < s.z0 - p.r || p.z > s.z1 + p.r) continue;
        const l = oboxLocal(s, p.x, p.z);
        const qx = clamp(l[0], -s.hx, s.hx), qz = clamp(l[1], -s.hz, s.hz);
        const ex = l[0] - qx, ez = l[1] - qz;
        const e2 = ex * ex + ez * ez;
        if (e2 >= p.r * p.r) continue;
        let lnx, lnz, push;
        if (e2 > 1e-10) { const d = Math.sqrt(e2); lnx = ex / d; lnz = ez / d; push = p.r - d; }
        else {
          const ml = l[0] + s.hx, mr = s.hx - l[0], mb = l[1] + s.hz, mf = s.hz - l[1];
          const m = Math.min(ml, mr, mb, mf);
          if (m === ml) { lnx = -1; lnz = 0; } else if (m === mr) { lnx = 1; lnz = 0; } else if (m === mb) { lnx = 0; lnz = -1; } else { lnx = 0; lnz = 1; }
          push = m + p.r;
        }
        const c = Math.cos(s.ang), sn = Math.sin(s.ang);
        const nx = c * lnx + sn * lnz, nz = -sn * lnx + c * lnz;
        p.x += nx * push; p.z += nz * push;
        if (push > wallPush) { wallPush = push; wall = { nx, nz, s }; }
        continue;
      }
      if (s.type === 'cyl') {
        const dx = p.x - s.x, dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d >= s.r + p.r) continue;
        if (p.y >= s.y1 - STEP_H) continue;
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        const push = s.r + p.r - d;
        p.x += nx * push; p.z += nz * push;
        if (push > wallPush) { wallPush = push; wall = { nx, nz, s }; }
        continue;
      }
      cx = clamp(p.x, s.x0, s.x1); cz = clamp(p.z, s.z0, s.z1);
      const top = s.ramp ? topAt(s, cx, cz) : s.y1;
      if (p.y >= top - STEP_H) continue;
      if (s.ramp && p.y + p.h <= s.y0) continue;
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= p.r * p.r) continue;
      let nx, nz, push;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = p.r - d;
      } else {
        // 中心が箱の中：一番近い辺へ出す
        const l = p.x - s.x0, r = s.x1 - p.x, b = p.z - s.z0, f = s.z1 - p.z;
        const m = Math.min(l, r, b, f);
        if (m === l) { nx = -1; nz = 0; } else if (m === r) { nx = 1; nz = 0; } else if (m === b) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        push = m + p.r;
      }
      p.x += nx * push; p.z += nz * push;
      if (push > wallPush) { wallPush = push; wall = { nx, nz, s }; }
    }
  }
  return wall;
}

// 線分とワールドの交差（カメラのめり込み防止用）。戻り値 t（0〜1）
function raycast(a, b) {
  let tMin = 1;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  for (const s of World.solids) {
    if (s.noCam || s.off) continue;
    let x0, x1, z0, z1;
    if (s.type === 'cyl') { x0 = s.x - s.r * 0.8; x1 = s.x + s.r * 0.8; z0 = s.z - s.r * 0.8; z1 = s.z + s.r * 0.8; }
    else { x0 = s.x0; x1 = s.x1; z0 = s.z0; z1 = s.z1; }
    const lo = [x0, s.y0, z0], hi = [x1, s.ramp ? (s.y0 + s.y1) / 2 : s.y1, z1];
    let t0 = 0, t1 = tMin, hit = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (a[i] < lo[i] || a[i] > hi[i]) { hit = false; break; }
      } else {
        let ta = (lo[i] - a[i]) / d[i], tb = (hi[i] - a[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
    }
    if (hit && t0 > 0 && t0 < tMin) tMin = t0;
  }
  return tMin;
}
