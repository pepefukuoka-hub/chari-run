// 形状づくり（箱・円柱・球などを組み合わせて1つのメッシュにまとめる）
// 色は [r,g,b] か、{top, side, bottom} か、関数 (ローカル位置, 法線) => [r,g,b]
class Geo {
  constructor(jit = 0) { this.pos = []; this.nor = []; this.col = []; this.jit = jit; }

  _tri(m, nm, a, b, c, na, nb, nc, ca, cb, cc) {
    for (const [p, n, k] of [[a, na, ca], [b, nb, cb], [c, nc, cc]]) {
      const w = M4.xform(m, p);
      this.pos.push(w[0], w[1], w[2]);
      const nx = nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2];
      const ny = nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2];
      const nz = nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      this.nor.push(nx / l, ny / l, nz / l);
      if (this.jit) {
        // 位置に応じて色を少しゆらす（のっぺり感を減らす）
        const hsh = Math.sin(w[0] * 12.9898 + w[1] * 78.233 + w[2] * 37.719) * 43758.5453;
        const j = 1 + (hsh - Math.floor(hsh) - 0.5) * this.jit;
        this.col.push(k[0] * j, k[1] * j, k[2] * j);
      } else this.col.push(k[0], k[1], k[2]);
    }
  }

  static pick(color, p, n) {
    if (typeof color === 'function') return color(p, n);
    if (Array.isArray(color)) return color;
    if (n[1] > 0.5) return color.top || color.side;
    if (n[1] < -0.5) return color.bottom || color.side;
    return color.side;
  }

  // 単位立方体（-0.5〜0.5）
  box(m, color) {
    const nm = M4.normal3(m);
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, u, v] of faces) {
      const c = (su, sv) => [
        n[0] * 0.5 + u[0] * su * 0.5 + v[0] * sv * 0.5,
        n[1] * 0.5 + u[1] * su * 0.5 + v[1] * sv * 0.5,
        n[2] * 0.5 + u[2] * su * 0.5 + v[2] * sv * 0.5,
      ];
      const p00 = c(-1, -1), p10 = c(1, -1), p11 = c(1, 1), p01 = c(-1, 1);
      // 面の向きをそろえる（外向き反時計回り）
      const cr = v3.cross(v3.sub(p10, p00), v3.sub(p11, p00));
      const flip = v3.dot(cr, n) < 0;
      const k = (p) => Geo.pick(color, p, n);
      if (!flip) {
        this._tri(m, nm, p00, p10, p11, n, n, n, k(p00), k(p10), k(p11));
        this._tri(m, nm, p00, p11, p01, n, n, n, k(p00), k(p11), k(p01));
      } else {
        this._tri(m, nm, p00, p11, p10, n, n, n, k(p00), k(p11), k(p10));
        this._tri(m, nm, p00, p01, p11, n, n, n, k(p00), k(p01), k(p11));
      }
    }
    return this;
  }

  // 円柱（半径1、高さ y=0〜1）。opt.top: 上の半径比（0で円すい）, opt.flat: 角ばった陰影
  cyl(m, color, seg = 16, opt = {}) {
    const nm = M4.normal3(m);
    const rt = opt.top ?? 1, rb = opt.bottom ?? 1;
    const caps = opt.caps ?? true;
    const slope = rb - rt; // 側面法線の y 成分
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const b0 = [c0 * rb, 0, s0 * rb], b1 = [c1 * rb, 0, s1 * rb];
      const t0 = [c0 * rt, 1, s0 * rt], t1 = [c1 * rt, 1, s1 * rt];
      let n0 = v3.norm([c0, slope, s0]), n1 = v3.norm([c1, slope, s1]);
      if (opt.flat) {
        const am = (a0 + a1) / 2;
        n0 = n1 = v3.norm([Math.cos(am), slope, Math.sin(am)]);
      }
      const k = (p, n) => Geo.pick(color, p, n);
      this._tri(m, nm, b0, t1, b1, n0, n1, n1, k(b0, n0), k(t1, n1), k(b1, n1));
      if (rt > 0) this._tri(m, nm, b0, t0, t1, n0, n0, n1, k(b0, n0), k(t0, n0), k(t1, n1));
      if (caps) {
        const up = [0, 1, 0], dn = [0, -1, 0];
        if (rt > 0) {
          const ct = [0, 1, 0];
          this._tri(m, nm, ct, t1, t0, up, up, up, k(ct, up), k(t1, up), k(t0, up));
        }
        const cb = [0, 0, 0];
        this._tri(m, nm, cb, b0, b1, dn, dn, dn, k(cb, dn), k(b0, dn), k(b1, dn));
      }
    }
    return this;
  }

  // 球（半径1）
  sphere(m, color, seg = 16, rings = 10, opt = {}) {
    const nm = M4.normal3(m);
    const P = (i, j) => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * TAU;
      return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        let na = a, nb = b, nc = c, nd = d;
        if (opt.flat) {
          const f = v3.norm([a[0] + b[0] + c[0] + d[0], a[1] + b[1] + c[1] + d[1], a[2] + b[2] + c[2] + d[2]]);
          na = nb = nc = nd = f;
        }
        const k = (p, n) => Geo.pick(color, p, n);
        if (j > 0) this._tri(m, nm, a, b, d, na, nb, nd, k(a, na), k(b, nb), k(d, nd));
        if (j < rings - 1) this._tri(m, nm, b, c, d, nb, nc, nd, k(b, nb), k(c, nc), k(d, nd));
      }
    }
    return this;
  }

  // 平らな円（上向き、半径1）
  disc(m, color, seg = 20) {
    const nm = M4.normal3(m);
    const up = [0, 1, 0];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const p0 = [Math.cos(a0), 0, Math.sin(a0)], p1 = [Math.cos(a1), 0, Math.sin(a1)];
      const c0 = Geo.pick(color, [0, 0, 0], up);
      this._tri(m, nm, [0, 0, 0], p1, p0, up, up, up, c0, Geo.pick(color, p1, up), Geo.pick(color, p0, up));
    }
    return this;
  }

  // 輪（ドーナツ型、XZ平面）
  torus(m, color, R0 = 1, r0 = 0.25, seg = 20, tube = 8) {
    const nm = M4.normal3(m);
    const P = (i, j) => {
      const u = (i / seg) * TAU, v = (j / tube) * TAU;
      const cx = Math.cos(u), cz = Math.sin(u);
      const n = [Math.cos(v) * cx, Math.sin(v), Math.cos(v) * cz];
      return [[cx * R0 + n[0] * r0, n[1] * r0, cz * R0 + n[2] * r0], n];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < tube; j++) {
        const [a, na] = P(i, j), [b, nb] = P(i + 1, j), [c, nc] = P(i + 1, j + 1), [d, nd] = P(i, j + 1);
        const k = (p, n) => Geo.pick(color, p, n);
        this._tri(m, nm, a, d, b, na, nd, nb, k(a, na), k(d, nd), k(b, nb));
        this._tri(m, nm, b, d, c, nb, nd, nc, k(b, nb), k(d, nd), k(c, nc));
      }
    }
    return this;
  }

  // 弧（XY平面の輪の一部。表情の線などに使う）。a0〜a1 はラジアン、正面は +z
  arc(m, color, R0 = 1, r0 = 0.2, a0 = 0, a1 = Math.PI, seg = 10, tube = 6) {
    const nm = M4.normal3(m);
    const P = (i, j) => {
      const u = a0 + (i / seg) * (a1 - a0), v = (j / tube) * TAU;
      const cx = Math.cos(u), cy = Math.sin(u);
      const n = [Math.cos(v) * cx, Math.cos(v) * cy, Math.sin(v)];
      return [[cx * R0 + n[0] * r0, cy * R0 + n[1] * r0, n[2] * r0], n];
    };
    const k = (p, n) => Geo.pick(color, p, n);
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < tube; j++) {
        const [a, na] = P(i, j), [b, nb] = P(i + 1, j), [c, nc] = P(i + 1, j + 1), [d, nd] = P(i, j + 1);
        this._tri(m, nm, a, b, d, na, nb, nd, k(a, na), k(b, nb), k(d, nd));
        this._tri(m, nm, b, c, d, nb, nc, nd, k(b, nb), k(c, nc), k(d, nd));
      }
    }
    // 両端を丸くふさぐ
    for (const [u, s] of [[a0, -1], [a1, 1]]) {
      const cx = Math.cos(u) * R0, cy = Math.sin(u) * R0;
      const sm = M4.ident();
      M4.translate(sm, cx, cy, 0);
      this.sphere(M4.mul(m, M4.scale(sm, r0, r0, r0)), color, 6, 4);
      void s;
    }
    return this;
  }

  mesh() { return makeMesh(this); }
}

// 行列を手早く作るための小道具
function T(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  const m = M4.ident();
  M4.translate(m, x, y, z);
  if (ry) M4.rotY(m, ry);
  if (rx) M4.rotX(m, rx);
  if (rz) M4.rotZ(m, rz);
  M4.scale(m, sx, sy, sz);
  return m;
}

// 色ユーティリティ
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
