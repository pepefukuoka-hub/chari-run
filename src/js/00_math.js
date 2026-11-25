// 数学ユーティリティ（ベクトル・行列）
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const smooth = (t) => t * t * (3 - 2 * t);
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
// 疑似乱数（シード固定。ステージの飾りを毎回同じ配置にするため）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const v3 = {
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};

// 4x4行列（列優先, Float32Array）。translate などは右から掛ける（m = m * X）
const M4 = {
  ident(out = new Float32Array(16)) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },
  copy(a, out = new Float32Array(16)) { out.set(a); return out; },
  mul(a, b, out = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
    return m;
  },
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
    return m;
  },
  lookAt(e, c, u) {
    const z = v3.norm(v3.sub(e, c));
    const x = v3.norm(v3.cross(u, z));
    const y = v3.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -v3.dot(x, e); m[13] = -v3.dot(y, e); m[14] = -v3.dot(z, e); m[15] = 1;
    return m;
  },
  translate(m, x, y, z) {
    for (let i = 0; i < 4; i++) m[12 + i] += m[i] * x + m[4 + i] * y + m[8 + i] * z;
    return m;
  },
  rotY(m, a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 4; i++) {
      const a0 = m[i], a2 = m[8 + i];
      m[i] = a0 * c - a2 * s;
      m[8 + i] = a0 * s + a2 * c;
    }
    return m;
  },
  rotX(m, a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 4; i++) {
      const a1 = m[4 + i], a2 = m[8 + i];
      m[4 + i] = a1 * c + a2 * s;
      m[8 + i] = -a1 * s + a2 * c;
    }
    return m;
  },
  rotZ(m, a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 4; i++) {
      const a0 = m[i], a1 = m[4 + i];
      m[i] = a0 * c + a1 * s;
      m[4 + i] = -a0 * s + a1 * c;
    }
    return m;
  },
  scale(m, x, y, z) {
    for (let i = 0; i < 4; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; }
    return m;
  },
  // 法線用 3x3（上3x3の逆転置）
  normal3(m, out = new Float32Array(9)) {
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1;
    const k = 1 / det;
    out[0] = A * k; out[1] = B * k; out[2] = C * k;
    out[3] = -(b * i - c * h) * k; out[4] = (a * i - c * g) * k; out[5] = -(a * h - b * g) * k;
    out[6] = (b * f - c * e) * k; out[7] = -(a * f - c * d) * k; out[8] = (a * e - b * d) * k;
    return out;
  },
  xform(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
};
