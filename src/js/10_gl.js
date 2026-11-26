// WebGL2 描画まわり（シェーダー・メッシュ・描画呼び出し）
// 1フレームの流れ（beginFrame の中で自動的に行う）
//   1. 影の深度テクスチャを作る（太陽から見た正射影。R.drawCasters() で影を落とす物を描く）
//   2. あとは各ファイルが drawMesh で物を描く（影・トーンマップ・フォグはシェーダーで処理）
//   3. 空は、ふつうの物を描き終えて半透明に移るとき（setBlend(true) か Sprites.flush）に、
//      まだ何も描かれていない画素にだけ描く（物にかくれる画素の空の計算を省く）
// 速くするしくみ（くわしくは 12_perf.js）
//   - drawMesh は映らない物を飛ばす（メッシュを包む球と視錐台で判定）
//   - 同じメッシュ・同じ色を続けて描くと、まとめて1回（インスタンス描画）で描く
//     → まとめている途中で gl の状態を直接変えるときは、先に flushDraws() を呼ぶこと
//   - 遠くでは mesh.lod（あらいメッシュ）に切りかえる
const glCanvas = document.getElementById('gl');
// アンチエイリアスは作るときにしか決められないので、画質が「低」のときだけ切る（次に開いたときから）
const gl = glCanvas.getContext('webgl2', { antialias: perfWantsAA(), alpha: false, powerPreference: 'high-performance' });
function perfWantsAA() {
  try {
    const q = localStorage.getItem('koron-quality') || 'auto';
    if (q === 'low') return false;
    if (q === 'auto' && Number(localStorage.getItem('koron-perf-tier') || 0) >= 3) return false;
  } catch (e) { /* localStorage が使えないときはそのまま */ }
  return true;
}

const R = {
  ok: !!gl,
  w: 1, h: 1, dpr: 1,
  vp: M4.ident(),
  view: M4.ident(),
  cam: [0, 0, 0],
  // 太陽の向き（光がやってくる方向）。少し低めにして影を長めに
  light: v3.norm([0.42, 0.72, 0.55]),
  lightCol: [1.0, 0.93, 0.82],   // 陽ざしの色
  ambLo: [0.46, 0.38, 0.3],      // 環境光（下）
  ambHi: [0.58, 0.72, 1.0],      // 環境光（上）
  fogCol: [0.78, 0.88, 0.97],   // 地平線の色（フォグの色にもなる）
  fog: [45, 150],
  sky: {
    top: [0.27, 0.55, 0.93],     // 天頂
    bottom: [0.92, 0.95, 0.99],  // 下（雲海のもや）
    sun: [1.0, 0.86, 0.62],      // 太陽のにじみ
  },
  prog: null,                    // いまの画質のふつうの描画用シェーダー（R.u はその uniform）
  u: {},
  tmpN: new Float32Array(9),
  drawCalls: 0,
  shadowCalls: 0,
  culled: 0,                     // 映らないので飛ばした数（本番＋影）
  tris: 0,                       // 描いた三角形の数（本番＋影）
  planes: new Float32Array(24),  // カメラの視錐台
  shPlanes: new Float32Array(24),// 影の範囲の視錐台
  proj: M4.ident(),
  curVao: null,
  curProg: null,
  q: null,                       // いまの画質の設定（12_perf.js の Perf.tier）
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

// INST を定義すると、行列を頂点属性（1つの物ごと）から読む版になる（まとめ描き用）
const INST_GLSL = `
#ifdef INST
layout(location=3) in vec4 iM0; layout(location=4) in vec4 iM1; layout(location=5) in vec4 iM2; layout(location=6) in vec4 iM3;
layout(location=7) in vec3 iN0; layout(location=8) in vec3 iN1; layout(location=9) in vec3 iN2;
#define MODEL mat4(iM0, iM1, iM2, iM3)
#define NORM mat3(iN0, iN1, iN2)
#else
uniform mat4 uM;
uniform mat3 uN;
#define MODEL uM
#define NORM uN
#endif
`;
const VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
uniform mat4 uVP;
${INST_GLSL}
uniform mat4 uLVP;
uniform float uShOff;
out vec3 vN; out vec3 vC; out vec3 vW; out vec4 vL;
void main(){
  vec4 w = MODEL * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(NORM * aNor);
  vC = aCol;
  // 影のずれ（にきび状の模様）を防ぐため、法線方向に少しずらして影を調べる
  vL = uLVP * vec4(w.xyz + vN * uShOff, 1.0);
  gl_Position = uVP * w;
}`;

// PCF（影のふちをぼかすために影テクスチャを読む回数）は 5 / 3 / 1 を #define で選ぶ
const FS = `
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
uniform vec3 uSunLight; // 陽ざしの色（ステージごと）
uniform vec3 uAmbLo;    // 環境光：下（地面の照り返し）
uniform vec3 uAmbHi;    // 環境光：上（空）
out vec4 o;
${SKY_GLSL}
float shadowAt(){
  if (uShInfo.z < 0.5) return 1.0;
  vec3 s = vL.xyz / vL.w * 0.5 + 0.5;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  float t = uShInfo.x;
#if PCF >= 5
  // PCF：ハードウェアの 2x2 補間 × 5か所で縁をやわらかく
  float sum = texture(uShadow, s) * 2.0;
  sum += texture(uShadow, s + vec3( t * 1.3,  t * 0.6, 0.0));
  sum += texture(uShadow, s + vec3(-t * 0.6,  t * 1.3, 0.0));
  sum += texture(uShadow, s + vec3(-t * 1.3, -t * 0.6, 0.0));
  sum += texture(uShadow, s + vec3( t * 0.6, -t * 1.3, 0.0));
  float sh = sum / 6.0;
#elif PCF >= 3
  // 3か所（三角形に並べる）
  float sum = texture(uShadow, s + vec3(0.0, t * 1.1, 0.0));
  sum += texture(uShadow, s + vec3( t * 0.95, -t * 0.55, 0.0));
  sum += texture(uShadow, s + vec3(-t * 0.95, -t * 0.55, 0.0));
  float sh = sum / 3.0;
#else
  // 1か所（ハードウェアの 2x2 補間だけ）
  float sh = texture(uShadow, s);
#endif
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
  vec3 amb = mix(uAmbLo, uAmbHi, hemi) * 0.42;
  vec3 sun = uSunLight * 0.92;
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
// CLOUDS：0 雲なし / 1 雲の模様を1段だけ / 2 ふつう（3段）
const SKY_FS = `
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
#if CLOUDS > 0
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
#if CLOUDS > 1
    float n = noise(uv) * 0.55 + noise(uv * 2.3 + 3.1) * 0.3 + noise(uv * 5.1 + 7.7) * 0.15;
#else
    float n = noise(uv) * 0.7 + noise(uv * 2.3 + 3.1) * 0.3;
#endif
    float cl = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c = mix(c, vec3(1.0, 0.99, 0.97) + uSunCol * pow(s, 4.0) * 0.15, cl * 0.55);
  }
#endif
  o = vec4(c, 1.0);
}`;

// 影の深度だけを描く
const SH_VS = `
layout(location=0) in vec3 aPos;
uniform mat4 uLVP;
${INST_GLSL}
void main(){ gl_Position = uLVP * MODEL * vec4(aPos, 1.0); }`;
const SH_FS = `
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
// defs: { 名前: 値 } を #define にして頭につける（#version が無いソースのみ）
function withDefs(src, defs) {
  if (src.startsWith('#version')) return src;
  let h = '#version 300 es\n';
  for (const k in defs || {}) h += `#define ${k} ${defs[k]}\n`;
  return h + src;
}
function linkProg(vs, fs, names, defs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, withDefs(vs, defs)));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, withDefs(fs, defs)));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  // uniform の重複設定を省くための控え（同じ値なら送らない）
  return { p, u, tint: [NaN, NaN, NaN], emit: NaN, alpha: NaN };
}

// ---------- シェーダーの種類（画質ごとに必要になったら作る） ----------
const MAIN_UNIFORMS = ['uVP', 'uM', 'uN', 'uLVP', 'uShOff', 'uTint', 'uLight', 'uCam', 'uFogCol', 'uFog', 'uEmit', 'uAlpha',
  'uTime', 'uShadow', 'uShInfo', 'uSkyTop', 'uSkyBot', 'uSunCol', 'uSunLight', 'uAmbLo', 'uAmbHi'];
const progCache = new Map();
function getProg(key, make) {
  let p = progCache.get(key);
  if (!p) { p = make(); progCache.set(key, p); }
  return p;
}
// ふつうの描画（inst: まとめ描き版か, pcf: 影を読む回数）
const mainProg = (inst, pcf) => getProg(`m${inst ? 1 : 0}${pcf}`, () => linkProg(VS, FS, MAIN_UNIFORMS, inst ? { INST: 1, PCF: pcf } : { PCF: pcf }));
const shadowProg = (inst) => getProg(`s${inst ? 1 : 0}`, () => linkProg(SH_VS, SH_FS, ['uLVP', 'uM'], inst ? { INST: 1 } : {}));
const skyProg = (clouds) => getProg(`k${clouds}`, () => linkProg(SKY_VS, SKY_FS, ['uRight', 'uUp', 'uFwd', 'uTime', 'uSkyTop', 'uSkyBot', 'uFogCol', 'uSunCol', 'uLight'], { CLOUDS: clouds }));

function initGL() {
  if (!gl) return;
  R.q = Perf.init();
  applyQuality();
  R.emptyVao = gl.createVertexArray();
  initInstances();
  initSprites();
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  R.drawCasters = R.drawCasters || defaultCasters;
}

// 画質の設定（R.q）に合わせてシェーダーと影テクスチャを用意する。Perf が段階を変えたときにも呼ぶ
function applyQuality() {
  const q = R.q;
  const pcf = q.pcf >= 5 ? 5 : q.pcf >= 3 ? 3 : 1;
  R.main = mainProg(false, pcf);
  R.mainI = mainProg(true, pcf);
  R.shP = shadowProg(false);
  R.shPI = shadowProg(true);
  R.skyP = skyProg(q.clouds);
  R.prog = R.main.p;
  R.u = R.main.u;
  R.curProg = null;
  const size = Math.min(q.shadow, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  if (q.shadow > 0 && (!R.sh || R.sh.size !== size)) initShadow(size);
  R.shadowOn = q.shadow > 0 && !!R.sh && R.sh.ok;
}

// ---------- 影（シャドウマップ） ----------
function initShadow(size) {
  if (R.sh) { gl.deleteTexture(R.sh.tex); gl.deleteFramebuffer(R.sh.fb); }
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
  R.sh = { size, tex, fb, vp: M4.ident(), lv: M4.ident(), proj: M4.ident(), cx: 0, cz: 0, half: 30, texel: 0, ok };
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

const shTmp = { c: [0, 0, 0], up: [0, 1, 0], o: [0, 0, 0], d: [0, 0, 0] };
function shadowPass(eye, target) {
  const S = R.sh;
  // 影の範囲：カメラの注視点より少し前を中心に。遠くから見る時（タイトル）は広く
  // 画質が低いときは範囲をせまくする（同じ解像度でもくっきり、遠くの影は省く）
  const fx = target[0] - eye[0], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fz) || 1;
  const dist = Math.hypot(fx, target[1] - eye[1], fz);
  const k = R.q.shRange;
  let half, cx, cy, cz;
  if (dist > 24) { half = 52 * k; cx = target[0]; cy = target[1]; cz = target[2]; }
  else { half = 26 * k; cx = target[0] + (fx / fl) * 9 * k; cy = target[1] - 1; cz = target[2] + (fz / fl) * 9 * k; }
  const L = R.light;
  const up = Math.abs(L[1]) > 0.99 ? [0, 0, 1] : shTmp.up;
  shTmp.d[0] = -L[0]; shTmp.d[1] = -L[1]; shTmp.d[2] = -L[2];
  const lv = M4.lookAt(shTmp.o, shTmp.d, up, S.lv);
  // テクセル単位で中心をそろえて、動いたときの影のちらつきを防ぐ
  const texel = (half * 2) / S.size;
  shTmp.c[0] = cx; shTmp.c[1] = cy; shTmp.c[2] = cz;
  const c = M4.xform(lv, shTmp.c);
  c[0] = Math.round(c[0] / texel) * texel;
  c[1] = Math.round(c[1] / texel) * texel;
  const proj = M4.ortho(c[0] - half, c[0] + half, c[1] - half, c[1] + half, -c[2] - 90, -c[2] + 90, S.proj);
  M4.mul(proj, lv, S.vp);
  Frustum.fromVP(S.vp, R.shPlanes);
  S.cx = cx; S.cz = cz; S.half = half; S.texel = texel;

  gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
  gl.viewport(0, 0, S.size, S.size);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  for (const P2 of [R.shP, R.shPI]) {
    gl.useProgram(P2.p);
    gl.uniformMatrix4fv(P2.u.uLVP, false, S.vp);
  }
  R.curProg = R.shPI;
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1.2, 2.5);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  R.pass = 'shadow';
  R.shadowCalls = 0;
  try { R.drawCasters(); flushDraws(); } finally {
    Batch.n = 0;
    R.pass = 'main';
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function resizeGL() {
  // 描画解像度：画面の密度（devicePixelRatio）を、画質ごとの上限でおさえる
  R.dpr = Math.min(window.devicePixelRatio || 1, R.q ? R.q.dpr : 2);
  const w = Math.max(1, Math.floor(window.innerWidth * R.dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * R.dpr));
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  R.w = w; R.h = h;
}

// メッシュ（位置・法線・色をまとめた頂点配列）
// c / r：メッシュを包む球（ローカル座標）。カリングに使う
// とても大きいメッシュ（三角形が CHUNK_AUTO.tris 以上で、半径が CHUNK_AUTO.r 以上）は、
// 自動で区画に分ける（地形が大きくなっても、映る区画だけ描く）
const CHUNK_AUTO = { tris: 20000, r: 40, cell: 48 };
function makeMesh(geo, noChunk) {
  const n = geo.pos.length / 3;
  const data = new Float32Array(n * 9);
  const P = geo.pos, N = geo.nor, C = geo.col;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 9, j = i * 3;
    const x = P[j], y = P[j + 1], z = P[j + 2];
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = N[j]; data[o + 4] = N[j + 1]; data[o + 5] = N[j + 2];
    data[o + 6] = C[j]; data[o + 7] = C[j + 1]; data[o + 8] = C[j + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const c = n ? [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] : [0, 0, 0];
  let r = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3, dx = P[j] - c[0], dy = P[j + 1] - c[1], dz = P[j + 2] - c[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r) r = d;
  }
  r = Math.sqrt(r) * 1.001 + 1e-3;
  if (!gl) return { count: n, c, r };
  if (!noChunk && n / 3 >= CHUNK_AUTO.tris && r >= CHUNK_AUTO.r) {
    const ch = makeChunkedMesh(geo, CHUNK_AUTO.cell);
    ch.c = c; ch.r = r;
    return ch;
  }
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
  R.curVao = null;
  return { vao, buf, count: n, c, r, ivao: null };
}

// 大きな形を区画ごとのメッシュに分ける（三角形の重心で振り分け）。
// 戻り値 { chunks: [mesh...], count } は drawMesh にそのまま渡せる（区画ごとにカリングされる）
function makeChunkedMesh(geo, cell = 24) {
  const P = geo.pos, N = geo.nor, C = geo.col;
  const tri = P.length / 9, cells = new Map();
  for (let t = 0; t < tri; t++) {
    const o = t * 9;
    const cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    const key = Math.floor(cx / cell) + ',' + Math.floor(cz / cell);
    let g = cells.get(key);
    if (!g) { g = { pos: [], nor: [], col: [] }; cells.set(key, g); }
    for (let i = 0; i < 9; i++) { g.pos.push(P[o + i]); g.nor.push(N[o + i]); g.col.push(C[o + i]); }
  }
  const chunks = [];
  for (const g of cells.values()) chunks.push(makeMesh(g, true));
  return { chunks, count: geo.pos.length / 3 };
}

// ---------- まとめ描き（インスタンス描画） ----------
// 1つの物ごとに 行列16 + 法線行列9 = 25 個の数を、共有のバッファに順に積む
const INST_FL = 25;
const INST_MAX = 8192;   // 1フレームに積める数（こえたら先頭から使い直す）
const Batch = {
  max: 256,              // 1回にまとめる数
  data: null,
  n: 0, mesh: null, shadow: false,
  tr: 1, tg: 1, tb: 1, emit: 0, alpha: 1,
  ring: 0,               // 共有バッファのどこまで使ったか（物の数）
};
function initInstances() {
  Batch.data = new Float32Array(Batch.max * INST_FL);
  R.instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, R.instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, INST_MAX * INST_FL * 4, gl.DYNAMIC_DRAW);
}
// まとめ描き用の頂点配列（メッシュの頂点＋共有バッファの行列）を、はじめて使うときに作る
function instVao(mesh) {
  if (mesh.ivao) return mesh.ivao;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
  for (let i = 3; i <= 9; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 1); }
  mesh.ivao = vao;
  R.curVao = vao;
  return vao;
}
function useProg(P2) {
  if (R.curProg !== P2) { gl.useProgram(P2.p); R.curProg = P2; }
}
function bindVao(v) {
  if (R.curVao !== v) { gl.bindVertexArray(v); R.curVao = v; }
}
function setMat(P2) {
  // 色・光り方・不透明度は、前と同じなら送らない
  const t = P2.tint;
  if (t[0] !== Batch.tr || t[1] !== Batch.tg || t[2] !== Batch.tb) {
    t[0] = Batch.tr; t[1] = Batch.tg; t[2] = Batch.tb;
    gl.uniform3f(P2.u.uTint, t[0], t[1], t[2]);
  }
  if (P2.emit !== Batch.emit) { P2.emit = Batch.emit; gl.uniform1f(P2.u.uEmit, Batch.emit); }
  if (P2.alpha !== Batch.alpha) { P2.alpha = Batch.alpha; gl.uniform1f(P2.u.uAlpha, Batch.alpha); }
}
const nTmp = new Float32Array(9);
// たまっている物を描く。gl の状態を直接変える前に呼ぶこと
function flushDraws() {
  const B = Batch, n = B.n;
  if (!n || !gl) return;
  B.n = 0;
  const mesh = B.mesh, d = B.data;
  R.tris += (mesh.count / 3) * n;
  // デバッグ用：R.stats = new Map() にすると、メッシュごとの三角形数を数える
  if (R.stats) { const k = (mesh.name || mesh.count / 3) + (B.shadow ? ' 影' : ''); R.stats.set(k, (R.stats.get(k) || 0) + (mesh.count / 3) * n); }
  if (n === 1) {
    if (B.shadow) {
      useProg(R.shP);
      gl.uniformMatrix4fv(R.shP.u.uM, false, d, 0, 16);
    } else {
      useProg(R.main);
      setMat(R.main);
      gl.uniformMatrix4fv(R.main.u.uM, false, d, 0, 16);
      gl.uniformMatrix3fv(R.main.u.uN, false, d, 16, 9);
    }
    bindVao(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  } else {
    const P2 = B.shadow ? R.shPI : R.mainI;
    useProg(P2);
    if (!B.shadow) setMat(P2);
    if (B.ring + n > INST_MAX) B.ring = 0;
    const off = B.ring * INST_FL * 4;
    B.ring += n;
    bindVao(instVao(mesh));
    gl.bindBuffer(gl.ARRAY_BUFFER, R.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, off, d, 0, n * INST_FL);
    const st = INST_FL * 4;
    for (let i = 0; i < 4; i++) gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, st, off + i * 16);
    for (let i = 0; i < 3; i++) gl.vertexAttribPointer(7 + i, 3, gl.FLOAT, false, st, off + 64 + i * 12);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
  }
  if (B.shadow) R.shadowCalls++;
  else R.drawCalls++;
}

const WHITE = [1, 1, 1];
const ZERO3 = [0, 0, 0];
// メッシュを1つ描く。opt: tint, emit, alpha
// 影の段階では、光るもの（emit > 0.5）・半透明・空は影を落とさない
// 実際に描くのは、ちがうメッシュ・ちがう色が来たときか flushDraws() のとき（行列はここで写す）
function drawMesh(mesh, m, tint = WHITE, emit = 0, alpha = 1) {
  if (!gl || !mesh || !mesh.count) return;
  if (mesh === Models.sky && R.skyDrawn) return; // 空は自前で描いている
  if (mesh.chunks) {
    for (let i = 0; i < mesh.chunks.length; i++) drawMesh(mesh.chunks[i], m, tint, emit, alpha);
    return;
  }
  const shadow = R.pass === 'shadow';
  if (shadow && (emit > 0.5 || alpha < 0.99)) return;
  // 映らない物は飛ばす（影の段階では、影の範囲に入らない物）
  const c = mesh.c || ZERO3;
  const wx = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
  const wy = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
  const wz = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
  const rad = (mesh.r ?? 1e9) * M4.maxScale(m);
  if (!Frustum.sphere(shadow ? R.shPlanes : R.planes, wx, wy, wz, rad)) { R.culled++; return; }
  // 遠くはあらいメッシュに（影の段階では近めから）
  if (mesh.lod) {
    const e = R.cam, dx = wx - e[0], dy = wy - e[1], dz = wz - e[2];
    const d2 = (dx * dx + dy * dy + dz * dz) * (shadow ? 4 : 1) * R.q.lodK;
    for (const L of mesh.lod) if (d2 > L.d * L.d) mesh = L.mesh;
  }
  const B = Batch;
  if (B.n && (B.mesh !== mesh || B.shadow !== shadow || B.n >= B.max ||
    (!shadow && (B.tr !== tint[0] || B.tg !== tint[1] || B.tb !== tint[2] || B.emit !== emit || B.alpha !== alpha)))) flushDraws();
  if (!B.n) {
    B.mesh = mesh; B.shadow = shadow;
    B.tr = tint[0]; B.tg = tint[1]; B.tb = tint[2]; B.emit = emit; B.alpha = alpha;
  }
  const o = B.n * INST_FL, d = B.data;
  for (let i = 0; i < 16; i++) d[o + i] = m[i];
  if (!shadow) {
    M4.normal3(m, nTmp);
    for (let i = 0; i < 9; i++) d[o + 16 + i] = nTmp[i];
  }
  B.n++;
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
  flushDraws();
  gl.useProgram(R.prog);
  R.curProg = R.main;
}

const camTmp = { up: [0, 1, 0] };
function beginFrame(eye, target, fovy) {
  Perf.frameStart();
  resizeGL();
  R.time = typeof Game !== 'undefined' ? Game.time : performance.now() / 1000;
  R.drawCalls = 0; R.culled = 0; R.tris = 0; Sprites.culled = 0;
  R.curVao = null; R.curProg = null;
  gl.bindVertexArray(null);
  Batch.n = 0; Batch.ring = 0;
  Sprites.clear();
  const asp = R.w / R.h;
  const proj = M4.persp(fovy, asp, 0.1, 400, R.proj);
  R.view = M4.lookAt(eye, target, camTmp.up, R.view);
  M4.mul(proj, R.view, R.vp);
  Frustum.fromVP(R.vp, R.planes);
  R.cam = eye;
  R.fovy = fovy;
  // 1. 影
  if (R.shadowOn && R.sh) shadowPass(eye, target);
  // 2. 画面を消す（空は半透明の前に描く → drawSky）
  gl.viewport(0, 0, R.w, R.h);
  gl.clearColor(R.fogCol[0], R.fogCol[1], R.fogCol[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const V = R.view;
  R.camRight = [V[0], V[4], V[8]];
  R.camUp = [V[1], V[5], V[9]];
  R.camFwd = [-V[2], -V[6], -V[10]];
  R.skyDrawn = true;   // Models.sky は drawMesh で描かない（自前で描く）
  R.skyPending = true;
  // 3. ふつうの物（まとめ描き版にも同じ値を入れる）
  for (const P2 of [R.mainI, R.main]) {
    gl.useProgram(P2.p);
    const u = P2.u;
    gl.uniformMatrix4fv(u.uVP, false, R.vp);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform2fv(u.uFog, R.fog);
    gl.uniform1f(u.uTime, R.time);
    setSkyUniforms(u);
    gl.uniform3fv(u.uSunLight, R.lightCol);
    gl.uniform3fv(u.uAmbLo, R.ambLo);
    gl.uniform3fv(u.uAmbHi, R.ambHi);
    gl.uniform1i(u.uShadow, 1);
    if (R.shadowOn && R.sh) {
      gl.uniformMatrix4fv(u.uLVP, false, R.sh.vp);
      gl.uniform1f(u.uShOff, R.sh.texel * 1.6);
      gl.uniform3f(u.uShInfo, 1 / R.sh.size, 0.78, 1);
    } else gl.uniform3f(u.uShInfo, 0, 0, 0);
  }
  R.curProg = R.main;
  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

// 空：画面いっぱいの三角形1枚。深度が奥（まだ何も描かれていない画素）にだけ描く
function drawSky() {
  if (!R.skyPending) return;
  R.skyPending = false;
  flushDraws();
  const V = R.view, ty = Math.tan(R.fovy / 2), tx = ty * (R.w / R.h);
  const P2 = R.skyP;
  gl.useProgram(P2.p);
  R.curProg = null;
  gl.uniform3f(P2.u.uRight, V[0] * tx, V[4] * tx, V[8] * tx);
  gl.uniform3f(P2.u.uUp, V[1] * ty, V[5] * ty, V[9] * ty);
  gl.uniform3fv(P2.u.uFwd, R.camFwd);
  gl.uniform1f(P2.u.uTime, R.time);
  setSkyUniforms(P2.u);
  gl.disable(gl.BLEND);
  gl.depthMask(false);
  gl.depthFunc(gl.LESS);
  bindVao(R.emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  R.drawCalls++;
  useMainProgram();
}

function setBlend(on) {
  flushDraws();
  if (on) {
    drawSky();
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
  culled: 0,
  lastN: 0,        // 前回描いた枚数（記録用）
  add(x, y, z, size, kind, r, g, b, a, rot = 0) {
    if (!this.lists) return;
    // 画面に映らない粒は積まない（光はカメラ側へ寄せるので少し大きめに見る）
    if (!Frustum.sphere(R.planes, x, y, z, size * 1.5 + 0.5)) { this.culled++; return; }
    const layer = kind === 3 ? 0 : kind === 0 ? 1 : 2;
    const i = this.n[layer];
    if (i >= this.max) return;
    this.n[layer]++;
    const d = this.lists[layer], fl = this.fl;
    let o = i * 6 * fl;
    for (let k = 0; k < 12; k += 2) {
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = SP_CORNERS[k]; d[o + 4] = SP_CORNERS[k + 1];
      d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a;
      d[o + 9] = size; d[o + 10] = kind; d[o + 11] = rot;
      o += fl;
    }
  },
  // たまった物を描く（setBlend(true) の中で呼ぶ）
  flush() {
    if (!gl || !this.lists) return;
    flushDraws();
    drawSky();
    const tot = this.n[0] + this.n[1] + this.n[2];
    this.lastN = tot;
    if (!tot) return;
    const P2 = this.prog;
    gl.useProgram(P2.p);
    gl.uniformMatrix4fv(P2.u.uVP, false, R.vp);
    gl.uniform3fv(P2.u.uRight, R.camRight);
    gl.uniform3fv(P2.u.uUp, R.camUp);
    gl.uniform3fv(P2.u.uCam, R.cam);
    R.curProg = null;
    bindVao(this.vao);
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
    this.clear();
    useMainProgram();
  },
};
const SP_CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

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
