// WebGL2 描画まわり（シェーダー・メッシュ・描画呼び出し）
// 1フレームの流れ（beginFrame の中で自動的に行う）
//   1. 影の深度テクスチャを作る（太陽から見た正射影。R.drawCasters() で影を落とす物を描く）
//   2. 空を画面いっぱいに描く（グラデーション・太陽のにじみ・うすい雲）
//   3. あとは各ファイルが drawMesh で物を描く（影・トーンマップ・フォグはシェーダーで処理）
const glCanvas = document.getElementById('gl');
const gl = glCanvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

const R = {
  ok: !!gl,
  w: 1, h: 1, dpr: 1,
  vp: M4.ident(),
  view: M4.ident(),
  cam: [0, 0, 0],
  // 太陽の向き（光がやってくる方向）。少し低めにして影を長めに
  light: v3.norm([0.42, 0.72, 0.55]),
  fogCol: [0.78, 0.88, 0.97],   // 地平線の色（フォグの色にもなる）
  fog: [45, 150],
  sky: {
    top: [0.27, 0.55, 0.93],     // 天頂
    bottom: [0.92, 0.95, 0.99],  // 下（雲海のもや）
    sun: [1.0, 0.86, 0.62],      // 太陽のにじみ
  },
  prog: null,
  u: {},
  tmpN: new Float32Array(9),
  drawCalls: 0,
  shadowCalls: 0,
  pass: 'main',                  // 'main' か 'shadow'
  time: 0,
  shadowOn: true,
  sh: null,                      // 影まわり
  skyDrawn: false,
  // 影を落とす物を描く関数（ふだんは render() と同じ順で描く）。差し替えも可
  drawCasters: null,
};

// ---------- 空とフォグで共通に使う関数 ----------
const SKY_GLSL = `
uniform vec3 uSkyTop;
uniform vec3 uSkyBot;
uniform vec3 uFogCol;
uniform vec3 uSunCol;
uniform vec3 uLight;
vec3 skyColor(vec3 d){
  float y = d.y;
  vec3 c;
  if (y > 0.0) c = mix(uFogCol, uSkyTop, pow(smoothstep(0.0, 1.0, y), 0.55));
  else c = mix(uFogCol, uSkyBot, smoothstep(0.0, -0.35, y));
  float s = max(dot(d, uLight), 0.0);
  c += uSunCol * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.35);
  return c;
}
`;

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
uniform mat4 uVP;
uniform mat4 uM;
uniform mat3 uN;
uniform mat4 uLVP;
uniform float uShOff;
out vec3 vN; out vec3 vC; out vec3 vW; out vec4 vL;
void main(){
  vec4 w = uM * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(uN * aNor);
  vC = aCol;
  // 影のずれ（にきび状の模様）を防ぐため、法線方向に少しずらして影を調べる
  vL = uLVP * vec4(w.xyz + vN * uShOff, 1.0);
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vN; in vec3 vC; in vec3 vW; in vec4 vL;
uniform vec3 uTint;
uniform vec3 uCam;
uniform vec2 uFog;
uniform float uEmit;
uniform float uAlpha;
uniform float uTime;
uniform sampler2DShadow uShadow;
uniform vec3 uShInfo; // x: 1テクセル, y: 影の濃さ, z: 有効なら1
out vec4 o;
${SKY_GLSL}
float shadowAt(){
  if (uShInfo.z < 0.5) return 1.0;
  vec3 s = vL.xyz / vL.w * 0.5 + 0.5;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  float t = uShInfo.x;
  // PCF：ハードウェアの 2x2 補間 × 5か所で縁をやわらかく
  float sum = texture(uShadow, s) * 2.0;
  sum += texture(uShadow, s + vec3( t * 1.3,  t * 0.6, 0.0));
  sum += texture(uShadow, s + vec3(-t * 0.6,  t * 1.3, 0.0));
  sum += texture(uShadow, s + vec3(-t * 1.3, -t * 0.6, 0.0));
  sum += texture(uShadow, s + vec3( t * 0.6, -t * 1.3, 0.0));
  float sh = sum / 6.0;
  // 影の範囲の端ではなめらかに消す
  vec2 e = min(s.xy, 1.0 - s.xy);
  float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  return mix(1.0, sh, edge);
}
// トーンマップ：暗い〜中間はそのまま、明るいところだけなめらかに丸める（色味が変わりにくい）
vec3 tonemap(vec3 x){
  const float a = 0.62;
  vec3 hi = a + (1.0 - a) * (1.0 - exp(-(x - a) / (1.0 - a)));
  return mix(x, hi, step(a, x));
}
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 srgb = vC * uTint;
  vec3 col = pow(max(srgb, 0.0), vec3(2.2)); // 色は線形にして計算する
  // 上向きの面（地面）は、場所によってほんの少し明るさを変えて単調さを減らす
  if (n.y > 0.6 && uEmit < 0.01) {
    float g = sin(vW.x * 0.31 + sin(vW.z * 0.23) * 2.0) * sin(vW.z * 0.27 + sin(vW.x * 0.19) * 2.0);
    col *= 1.0 + g * 0.09 * (n.y - 0.6) * 2.5;
  }
  vec3 v = normalize(uCam - vW);
  float d = dot(n, uLight);
  // ほんのりトゥーン調：明暗の境目を少しだけくっきり
  float wrap = clamp((d + 0.15) / 1.15, 0.0, 1.0);
  float diff = smoothstep(0.02, 0.3, wrap) * 0.65 + wrap * 0.35;
  float sh = shadowAt();
  sh = mix(1.0, sh, uShInfo.y);
  diff *= min(sh, smoothstep(-0.1, 0.12, d) * 0.5 + 0.5);
  // 環境光：上は空の青、下は地面の照り返し
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(vec3(0.46, 0.38, 0.3), vec3(0.58, 0.72, 1.0), hemi) * 0.42;
  vec3 sun = vec3(1.0, 0.93, 0.82) * 0.92;
  // 正面からのやわらかい補助光（逆光でもキャラが暗くなりすぎない）
  vec3 fill = vec3(0.55, 0.6, 0.7) * max(dot(n, v), 0.0) * 0.16;
  vec3 lit = col * (amb + fill + sun * diff);
  // ふちの光（輪郭がふんわり明るく）と、つや
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  lit += fr * (0.06 + 0.12 * sh) * vec3(1.0, 0.95, 0.85) * (0.4 + col);
  vec3 h = normalize(uLight + v);
  lit += pow(max(dot(n, h), 0.0), 48.0) * 0.12 * sh * vec3(1.0, 0.96, 0.9);
  // 水面（水色で上向きの低い面）は少しきらめかせる
  if (n.y > 0.98 && srgb.b > srgb.r + 0.35 && srgb.b > 0.85 && uEmit < 0.01) {
    float wv = sin(vW.x * 3.1 + uTime * 1.7) * sin(vW.z * 2.7 - uTime * 1.3) + sin((vW.x + vW.z) * 5.3 + uTime * 2.3) * 0.5;
    lit += vec3(1.0, 0.98, 0.9) * smoothstep(1.05, 1.35, wv) * 0.6 * sh;
    lit = mix(lit, skyColor(reflect(-v, n)) * 0.8, 0.25);
  }
  vec3 outc = pow(tonemap(lit * 1.0), vec3(1.0 / 2.2));
  outc = mix(outc, srgb, uEmit);
  // フォグ：遠くほど空の色にとける（太陽側は少し暖かい色）
  float dist = length(uCam - vW);
  float f = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  // 下の雲海あたりはもやを濃く
  f = max(f, clamp((-vW.y - 6.0) / 30.0, 0.0, 0.6) * clamp(dist / 60.0, 0.0, 1.0));
  vec3 fc = skyColor(normalize(vW - uCam));
  outc = mix(outc, fc, f * (1.0 - uEmit * 0.5));
  o = vec4(outc, uAlpha);
}`;

// 空：画面いっぱいの三角形1枚。視線の向きから色を決める
const SKY_VS = `#version 300 es
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd;
out vec3 vD;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vD = uFwd + p.x * uRight + p.y * uUp;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;
const SKY_FS = `#version 300 es
precision highp float;
in vec3 vD;
uniform float uTime;
out vec4 o;
${SKY_GLSL}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main(){
  vec3 d = normalize(vD);
  vec3 c = skyColor(d);
  float s = max(dot(d, uLight), 0.0);
  c += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, s) * 0.8; // 太陽の円
  // 高いところのうすい雲（すじ雲）
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
    float n = noise(uv) * 0.55 + noise(uv * 2.3 + 3.1) * 0.3 + noise(uv * 5.1 + 7.7) * 0.15;
    float cl = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c = mix(c, vec3(1.0, 0.99, 0.97) + uSunCol * pow(s, 4.0) * 0.15, cl * 0.55);
  }
  o = vec4(c, 1.0);
}`;

// 影の深度だけを描く
const SH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLVP;
uniform mat4 uM;
void main(){ gl_Position = uLVP * uM * vec4(aPos, 1.0); }`;
const SH_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function linkProg(vs, fs, names) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

function initGL() {
  if (!gl) return;
  const main = linkProg(VS, FS, ['uVP', 'uM', 'uN', 'uLVP', 'uShOff', 'uTint', 'uLight', 'uCam', 'uFogCol', 'uFog', 'uEmit', 'uAlpha',
    'uTime', 'uShadow', 'uShInfo', 'uSkyTop', 'uSkyBot', 'uSunCol']);
  R.prog = main.p;
  R.u = main.u;
  R.skyP = linkProg(SKY_VS, SKY_FS, ['uRight', 'uUp', 'uFwd', 'uTime', 'uSkyTop', 'uSkyBot', 'uFogCol', 'uSunCol', 'uLight']);
  R.emptyVao = gl.createVertexArray();
  initShadow();
  initSprites();
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  R.drawCasters = R.drawCasters || defaultCasters;
}

// ---------- 影（シャドウマップ） ----------
function initShadow() {
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  const size = Math.min(touch ? 1024 : 2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const prog = linkProg(SH_VS, SH_FS, ['uLVP', 'uM']);
  R.sh = { size, tex, fb, prog, vp: M4.ident(), cx: 0, cz: 0, half: 30, texel: 0, ok };
  R.shadowOn = ok;
  // 影テクスチャは 1 番に固定してつないでおく
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.activeTexture(gl.TEXTURE0);
}

// 影を落とす物（90_game.js の render() と同じ順・同じ条件）
function defaultCasters() {
  if (typeof drawLevel === 'function') drawLevel();
  if (typeof Game !== 'undefined' && Game.state !== 'title' && typeof drawPlayer === 'function') drawPlayer();
  if (typeof drawEntities === 'function') drawEntities();
}

function shadowPass(eye, target) {
  const S = R.sh;
  // 影の範囲：カメラの注視点より少し前を中心に。遠くから見る時（タイトル）は広く
  const fx = target[0] - eye[0], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fz) || 1;
  const dist = Math.hypot(fx, target[1] - eye[1], fz);
  let half, cx, cy, cz;
  if (dist > 24) { half = 52; cx = target[0]; cy = target[1]; cz = target[2]; }
  else { half = 26; cx = target[0] + (fx / fl) * 9; cy = target[1] - 1; cz = target[2] + (fz / fl) * 9; }
  const L = R.light;
  const up = Math.abs(L[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const lv = M4.lookAt([0, 0, 0], [-L[0], -L[1], -L[2]], up);
  // テクセル単位で中心をそろえて、動いたときの影のちらつきを防ぐ
  const texel = (half * 2) / S.size;
  const c = M4.xform(lv, [cx, cy, cz]);
  c[0] = Math.round(c[0] / texel) * texel;
  c[1] = Math.round(c[1] / texel) * texel;
  const proj = M4.ortho(c[0] - half, c[0] + half, c[1] - half, c[1] + half, -c[2] - 90, -c[2] + 90);
  S.vp = M4.mul(proj, lv);
  S.cx = cx; S.cz = cz; S.half = half; S.texel = texel;

  gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
  gl.viewport(0, 0, S.size, S.size);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(S.prog.p);
  gl.uniformMatrix4fv(S.prog.u.uLVP, false, S.vp);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1.2, 2.5);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  R.pass = 'shadow';
  R.shadowCalls = 0;
  try { R.drawCasters(); } finally {
    R.pass = 'main';
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function resizeGL() {
  R.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(window.innerWidth * R.dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * R.dpr));
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  R.w = w; R.h = h;
}

// メッシュ（位置・法線・色をまとめた頂点配列）
function makeMesh(geo) {
  const n = geo.pos.length / 3;
  const data = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    data.set(geo.pos.slice(i * 3, i * 3 + 3), i * 9);
    data.set(geo.nor.slice(i * 3, i * 3 + 3), i * 9 + 3);
    data.set(geo.col.slice(i * 3, i * 3 + 3), i * 9 + 6);
  }
  if (!gl) return { count: n };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
  gl.bindVertexArray(null);
  return { vao, count: n };
}

const WHITE = [1, 1, 1];
// メッシュを1つ描く。opt: tint, emit, alpha
// 影の段階では、光るもの（emit > 0.5）・半透明・空は影を落とさない
function drawMesh(mesh, m, tint = WHITE, emit = 0, alpha = 1) {
  if (!gl || !mesh || !mesh.count) return;
  if (mesh === Models.sky && R.skyDrawn) return; // 空は beginFrame で描いている
  if (R.pass === 'shadow') {
    if (emit > 0.5 || alpha < 0.99) return;
    const S = R.sh;
    // 影の範囲から遠い物は飛ばす（移動していない物＝地形は必ず描く）
    if (m[12] || m[14]) {
      const dx = m[12] - S.cx, dz = m[14] - S.cz, r = S.half * 1.45 + 6;
      if (dx * dx + dz * dz > r * r) return;
    }
    gl.uniformMatrix4fv(S.prog.u.uM, false, m);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    R.shadowCalls++;
    return;
  }
  gl.uniformMatrix4fv(R.u.uM, false, m);
  gl.uniformMatrix3fv(R.u.uN, false, M4.normal3(m, R.tmpN));
  gl.uniform3fv(R.u.uTint, tint);
  gl.uniform1f(R.u.uEmit, emit);
  gl.uniform1f(R.u.uAlpha, alpha);
  gl.bindVertexArray(mesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  R.drawCalls++;
}

function setSkyUniforms(u) {
  gl.uniform3fv(u.uSkyTop, R.sky.top);
  gl.uniform3fv(u.uSkyBot, R.sky.bottom);
  gl.uniform3fv(u.uFogCol, R.fogCol);
  gl.uniform3fv(u.uSunCol, R.sky.sun);
  gl.uniform3fv(u.uLight, R.light);
}

// メイン描画用の状態に戻す（別のシェーダーを使ったあとに呼ぶ）
function useMainProgram() {
  gl.useProgram(R.prog);
}

function beginFrame(eye, target, fovy) {
  resizeGL();
  R.time = typeof Game !== 'undefined' ? Game.time : performance.now() / 1000;
  R.drawCalls = 0;
  Sprites.clear();
  // 1. 影
  if (R.shadowOn && R.sh) shadowPass(eye, target);
  // 2. 空
  gl.viewport(0, 0, R.w, R.h);
  gl.clearColor(R.fogCol[0], R.fogCol[1], R.fogCol[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const asp = R.w / R.h;
  const proj = M4.persp(fovy, asp, 0.1, 400);
  R.view = M4.lookAt(eye, target, [0, 1, 0]);
  R.vp = M4.mul(proj, R.view);
  R.cam = eye;
  R.fovy = fovy;
  const V = R.view, ty = Math.tan(fovy / 2), tx = ty * asp;
  R.camRight = [V[0], V[4], V[8]];
  R.camUp = [V[1], V[5], V[9]];
  R.camFwd = [-V[2], -V[6], -V[10]];
  gl.useProgram(R.skyP.p);
  gl.uniform3f(R.skyP.u.uRight, V[0] * tx, V[4] * tx, V[8] * tx);
  gl.uniform3f(R.skyP.u.uUp, V[1] * ty, V[5] * ty, V[9] * ty);
  gl.uniform3fv(R.skyP.u.uFwd, R.camFwd);
  gl.uniform1f(R.skyP.u.uTime, R.time);
  setSkyUniforms(R.skyP.u);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.bindVertexArray(R.emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  R.skyDrawn = true;
  R.drawCalls++;
  // 3. ふつうの物
  gl.useProgram(R.prog);
  gl.uniformMatrix4fv(R.u.uVP, false, R.vp);
  gl.uniform3fv(R.u.uCam, eye);
  gl.uniform2fv(R.u.uFog, R.fog);
  gl.uniform1f(R.u.uTime, R.time);
  setSkyUniforms(R.u);
  gl.uniform1i(R.u.uShadow, 1);
  if (R.shadowOn && R.sh) {
    gl.uniformMatrix4fv(R.u.uLVP, false, R.sh.vp);
    gl.uniform1f(R.u.uShOff, R.sh.texel * 1.6);
    gl.uniform3f(R.u.uShInfo, 1 / R.sh.size, 0.78, 1);
  } else gl.uniform3f(R.u.uShInfo, 0, 0, 0);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

function setBlend(on) {
  if (on) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
  } else {
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

// ワールド座標→画面座標（CSSピクセル）。後ろ側なら null
function project(p) {
  const m = R.vp;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 0.01) return null;
  return [((x / w) * 0.5 + 0.5) * (R.w / R.dpr), (0.5 - (y / w) * 0.5) * (R.h / R.dpr)];
}

// ---------- スプライト（粒・光・足元の丸影をまとめて1回で描く） ----------
// 種類 kind: 0 ふわっとした粒 / 1 光（加算）/ 2 きらきら星（加算）/ 3 地面の丸影 / 4 地面の光の輪（加算）/ 5 地面の光だまり（加算）
const SP_VS = `#version 300 es
layout(location=0) in vec3 aC;
layout(location=1) in vec2 aO;
layout(location=2) in vec4 aCol;
layout(location=3) in vec3 aK; // x: 大きさ, y: 種類, z: 回転
uniform mat4 uVP;
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uCam;
out vec2 vUV; out vec4 vCol; flat out int vKind;
void main(){
  int k = int(aK.y + 0.5);
  float c = cos(aK.z), s = sin(aK.z);
  vec2 o = vec2(aO.x * c - aO.y * s, aO.x * s + aO.y * c);
  vec3 w;
  if (k >= 3) w = aC + vec3(o.x, 0.0, o.y) * aK.x;
  else {
    w = aC + (uRight * o.x + uUp * o.y) * aK.x;
    // 光はカメラ側へ少し寄せて、地面に刺さって切れないように
    if (k == 1) w += normalize(uCam - aC) * min(aK.x * 0.5, 1.5);
  }
  vUV = aO; vCol = aCol; vKind = k;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const SP_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vCol; flat in int vKind;
out vec4 o;
void main(){
  float r = length(vUV);
  if (r > 1.0) discard;
  float a;
  vec3 c = vCol.rgb;
  if (vKind == 0) {
    a = 1.0 - smoothstep(0.35, 1.0, r);
    c *= 0.86 + 0.22 * (vUV.y * 0.5 + 0.5); // 上が明るい
  } else if (vKind == 1) {
    a = exp(-r * r * 5.0) * 0.9 + exp(-r * r * 30.0) * 0.5;
  } else if (vKind == 2) {
    vec2 q = abs(vUV);
    a = exp(-q.x * 14.0) * exp(-q.y * 2.2) + exp(-q.y * 14.0) * exp(-q.x * 2.2);
    a = a * 0.9 + exp(-r * r * 18.0) * 0.8;
  } else if (vKind == 3) {
    a = 1.0 - smoothstep(0.15, 1.0, r);
    a *= a;
  } else if (vKind == 4) {
    a = exp(-pow((r - 0.8) * 9.0, 2.0));
  } else {
    a = (1.0 - smoothstep(0.0, 1.0, r));
    a *= a;
  }
  o = vec4(c, a * vCol.a);
}`;

const Sprites = {
  max: 1400,
  fl: 12,          // 1頂点あたりの数
  data: null,
  n: [0, 0, 0],    // 0: 丸影 / 1: ふつう / 2: 加算 の数
  lists: null,
  clear() { this.n[0] = this.n[1] = this.n[2] = 0; },
  // 1枚追加。layer は描く順番（0 丸影 → 1 ふつう → 2 加算）
  add(x, y, z, size, kind, r, g, b, a, rot = 0) {
    if (!this.lists) return;
    const layer = kind === 3 ? 0 : kind === 0 ? 1 : 2;
    const i = this.n[layer];
    if (i >= this.max) return;
    this.n[layer]++;
    const d = this.lists[layer];
    let o = i * 6 * this.fl;
    for (const [ox, oy] of SP_CORNERS) {
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = ox; d[o + 4] = oy;
      d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a;
      d[o + 9] = size; d[o + 10] = kind; d[o + 11] = rot;
      o += this.fl;
    }
  },
  // たまった物を描く（setBlend(true) の中で呼ぶ）
  flush() {
    if (!gl || !this.lists) return;
    const tot = this.n[0] + this.n[1] + this.n[2];
    if (!tot) return;
    const P2 = this.prog;
    gl.useProgram(P2.p);
    gl.uniformMatrix4fv(P2.u.uVP, false, R.vp);
    gl.uniform3fv(P2.u.uRight, R.camRight);
    gl.uniform3fv(P2.u.uUp, R.camUp);
    gl.uniform3fv(P2.u.uCam, R.cam);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (let layer = 0; layer < 3; layer++) {
      const n = this.n[layer];
      if (!n) continue;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lists[layer], 0, n * 6 * this.fl);
      if (layer === 2) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (layer === 0) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4); }
      gl.drawArrays(gl.TRIANGLES, 0, n * 6);
      if (layer === 0) gl.disable(gl.POLYGON_OFFSET_FILL);
      R.drawCalls++;
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.clear();
    useMainProgram();
  },
};
const SP_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

function initSprites() {
  Sprites.prog = linkProg(SP_VS, SP_FS, ['uVP', 'uRight', 'uUp', 'uCam']);
  Sprites.lists = [0, 1, 2].map(() => new Float32Array(Sprites.max * 6 * Sprites.fl));
  Sprites.vao = gl.createVertexArray();
  gl.bindVertexArray(Sprites.vao);
  Sprites.buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, Sprites.buf);
  gl.bufferData(gl.ARRAY_BUFFER, Sprites.max * 6 * Sprites.fl * 4, gl.DYNAMIC_DRAW);
  const st = Sprites.fl * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 20);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 36);
  gl.bindVertexArray(null);
}
