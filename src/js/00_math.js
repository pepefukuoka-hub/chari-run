// 保存場所：localStorage が使えない環境（プライベートモード、埋め込み表示など）でも止まらないように、
// 使えないときはメモリに保存する（その場合、ページを閉じると消える）
const store = (() => {
  try {
    const s = window.localStorage;
    s.setItem('koron-test', '1'); s.removeItem('koron-test');
    return s;
  } catch (e) {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  }
})();
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
  // persp / ortho / lookAt は out を渡すと新しい配列を作らずに書きこむ（毎フレームの生成を減らす）
  persp(fovy, asp, n, f, out) {
    const t = 1 / Math.tan(fovy / 2), m = out ? out.fill(0) : new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
    return m;
  },
  ortho(l, r, b, t, n, f, out) {
    const m = out ? out.fill(0) : new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
    return m;
  },
  lookAt(e, c, u, out) {
    const z = v3.norm(v3.sub(e, c));
    const x = v3.norm(v3.cross(u, z));
    const y = v3.cross(z, x);
    const m = out ? out.fill(0) : new Float32Array(16);
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
  // 行列の拡大率のうち一番大きいもの（包む球の半径を出すのに使う）
  maxScale(m) {
    const a = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const b = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
    const c = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
    return Math.sqrt(a > b ? (a > c ? a : c) : b > c ? b : c);
  },
  xform(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
};

// 視錐台（カメラや影の範囲に映る空間）。vp 行列から6枚の面を取り出し、球が入るかを調べる
const Frustum = {
  // out: Float32Array(24)（面ごとに nx, ny, nz, d）
  fromVP(m, out) {
    for (let i = 0; i < 6; i++) {
      const r = i >> 1, s = i & 1 ? -1 : 1;
      let x = m[3] + s * m[r], y = m[7] + s * m[4 + r], z = m[11] + s * m[8 + r], w = m[15] + s * m[12 + r];
      const l = Math.hypot(x, y, z) || 1;
      out[i * 4] = x / l; out[i * 4 + 1] = y / l; out[i * 4 + 2] = z / l; out[i * 4 + 3] = w / l;
    }
    return out;
  },
  // 中心 (x,y,z)・半径 r の球が少しでも中にあれば true
  sphere(pl, x, y, z, r) {
    for (let i = 0; i < 24; i += 4) if (pl[i] * x + pl[i + 1] * y + pl[i + 2] * z + pl[i + 3] < -r) return false;
    return true;
  },
};
