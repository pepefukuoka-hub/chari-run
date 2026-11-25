// WebGL2 描画まわり（シェーダー・メッシュ・描画呼び出し）
const glCanvas = document.getElementById('gl');
const gl = glCanvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

const R = {
  ok: !!gl,
  w: 1, h: 1, dpr: 1,
  vp: M4.ident(),
  view: M4.ident(),
  cam: [0, 0, 0],
  light: v3.norm([0.45, 0.85, 0.3]),
  fogCol: [0.62, 0.8, 0.95],
  fog: [45, 150],
  prog: null,
  u: {},
  tmpN: new Float32Array(9),
  drawCalls: 0,
};

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
uniform mat4 uVP;
uniform mat4 uM;
uniform mat3 uN;
out vec3 vN; out vec3 vC; out vec3 vW;
void main(){
  vec4 w = uM * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(uN * aNor);
  vC = aCol;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vC; in vec3 vW;
uniform vec3 uTint;
uniform vec3 uLight;
uniform vec3 uCam;
uniform vec3 uFogCol;
uniform vec2 uFog;
uniform float uEmit;
uniform float uAlpha;
out vec4 o;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 col = vC * uTint;
  float d = dot(n, uLight);
  float diff = smoothstep(-0.05, 0.6, d) * 0.85 + max(d, 0.0) * 0.15;
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(vec3(0.42, 0.36, 0.46), vec3(0.66, 0.76, 0.9), hemi);
  vec3 v = normalize(uCam - vW);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.22;
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * 0.12;
  vec3 lit = col * (amb * 0.72 + vec3(1.0, 0.95, 0.86) * diff * 0.78) + (rim + spec) * vec3(1.0, 0.97, 0.92);
  lit = mix(lit, col, uEmit);
  float dist = length(uCam - vW);
  float f = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  lit = mix(lit, uFogCol, f * f * (1.0 - uEmit * 0.5));
  o = vec4(lit, uAlpha);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function initGL() {
  if (!gl) return;
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  R.prog = p;
  for (const n of ['uVP', 'uM', 'uN', 'uTint', 'uLight', 'uCam', 'uFogCol', 'uFog', 'uEmit', 'uAlpha']) {
    R.u[n] = gl.getUniformLocation(p, n);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
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
function drawMesh(mesh, m, tint = WHITE, emit = 0, alpha = 1) {
  if (!gl || !mesh || !mesh.count) return;
  gl.uniformMatrix4fv(R.u.uM, false, m);
  gl.uniformMatrix3fv(R.u.uN, false, M4.normal3(m, R.tmpN));
  gl.uniform3fv(R.u.uTint, tint);
  gl.uniform1f(R.u.uEmit, emit);
  gl.uniform1f(R.u.uAlpha, alpha);
  gl.bindVertexArray(mesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  R.drawCalls++;
}

function beginFrame(eye, target, fovy) {
  resizeGL();
  gl.viewport(0, 0, R.w, R.h);
  gl.clearColor(R.fogCol[0], R.fogCol[1], R.fogCol[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const proj = M4.persp(fovy, R.w / R.h, 0.1, 400);
  R.view = M4.lookAt(eye, target, [0, 1, 0]);
  R.vp = M4.mul(proj, R.view);
  R.cam = eye;
  R.drawCalls = 0;
  gl.useProgram(R.prog);
  gl.uniformMatrix4fv(R.u.uVP, false, R.vp);
  gl.uniform3fv(R.u.uLight, R.light);
  gl.uniform3fv(R.u.uCam, eye);
  gl.uniform3fv(R.u.uFogCol, R.fogCol);
  gl.uniform2fv(R.u.uFog, R.fog);
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
