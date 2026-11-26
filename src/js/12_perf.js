// 画質の段階と、fps を見ながらの自動調整
// 段階（0 がいちばんきれい）。auto のときは 0〜3 を行き来し、手動のときは 高=0 / 中=1 / 低=2 に固定する
//   dpr     描画解像度の上限（devicePixelRatio をこの値でおさえる）
//   shadow  影テクスチャの一辺（0 で影なし）
//   pcf     影のふちをぼかす読み取り回数（5 / 3 / 1）
//   shRange 影を描く範囲の倍率（せまいほど同じ解像度でくっきり、遠くの影は省く）
//   fx      粒子の量の倍率
//   clouds  空のすじ雲（2 ふつう / 1 簡単 / 0 なし）
//   lodK    あらいメッシュに切りかえる距離の倍率（大きいほど近くから切りかえる）
const PERF_TIERS = [
  { name: '高', dpr: 2, shadow: 2048, pcf: 5, shRange: 1, fx: 1, clouds: 2, lodK: 1 },
  { name: '中', dpr: 1.5, shadow: 1024, pcf: 3, shRange: 0.9, fx: 0.75, clouds: 2, lodK: 1.5 },
  { name: '低', dpr: 1, shadow: 1024, pcf: 1, shRange: 0.75, fx: 0.5, clouds: 1, lodK: 2.5 },
  { name: '最低', dpr: 0.75, shadow: 512, pcf: 1, shRange: 0.6, fx: 0.35, clouds: 0, lodK: 4 },
];
const PERF_MODES = ['auto', 'high', 'mid', 'low'];
const PERF_MODE_TIER = { high: 0, mid: 1, low: 2 };

const Perf = {
  mode: 'auto',
  tier: 0,          // いまの段階の番号
  q: PERF_TIERS[0], // いまの段階の設定（R.q と同じ）
  fxMax: 400,       // 粒子の上限
  // 自動調整の記録
  last: 0,          // 前のフレームの時刻
  winT: 0, winN: 0, // 集計中の時間（ミリ秒）とフレーム数
  slowN: 0,         // 集計中の「重いフレーム」（30fps を下回った）の数
  graceT: 0,        // 段階を変えた直後など、測らない時間（ミリ秒）
  startT: 0,        // 自動調整を始めた時刻
  fps: 60,          // 直近の集計の fps
  lowWins: 0,       // 続けて遅かった集計の数
  goodT: 0,         // 続けて速かった時間（ミリ秒）
  upHold: [10000, 10000, 10000, 10000], // その段階へ上げるのに必要な、速い状態の長さ（失敗すると倍に）
  upAt: -1, upFrom: -1, // 最後に上げた時刻と、上げる前の段階
  downFps: 0,       // 最後に下げる直前の fps
  noGain: 0,        // 下げても速くならなかった回数（画面のリフレッシュが 30Hz などに固定されている）
  floor: 99,        // 自動でここより下げない（速くならないと分かったとき）
  changes: 0,       // 段階を変えた回数（記録用）
  log: [],          // 変えたときの記録（デバッグ用）

  init() {
    try {
      const m = localStorage.getItem('koron-quality');
      if (PERF_MODES.includes(m)) this.mode = m;
    } catch (e) { /* 保存できない環境 */ }
    this.tier = this.mode === 'auto' ? this.guessTier() : PERF_MODE_TIER[this.mode];
    this.q = PERF_TIERS[this.tier];
    this.fxMax = Math.round(400 * this.q.fx);
    this.graceT = 1500; // 読みこみ直後は重いので少し待つ
    return this.q;
  },
  // 自動のときの最初の段階：前回落ち着いた段階があればそこから。なければ端末から見当をつける
  guessTier() {
    let saved = NaN;
    try { saved = Number(localStorage.getItem('koron-perf-tier')); } catch (e) { /* なし */ }
    if (saved >= 0 && saved < PERF_TIERS.length) return Math.max(0, saved - 0); // 前回の段階から
    const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    const px = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) ** 2;
    let t = touch ? 1 : 0;
    if (px > 5e6) t = Math.max(t, 1); // 4K などとても大きい画面
    // ソフトウェア描画（GPU なし）なら、はじめから軽く
    try {
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|software/i.test(name)) t = 2;
    } catch (e) { /* 取れなくてもよい */ }
    return t;
  },
  label() {
    if (this.mode === 'auto') return '自動（' + PERF_TIERS[this.tier].name + '）';
    return PERF_TIERS[PERF_MODE_TIER[this.mode]].name;
  },
  // メニューから：自動 → 高 → 中 → 低 → 自動 …
  cycle() { this.setMode(PERF_MODES[(PERF_MODES.indexOf(this.mode) + 1) % PERF_MODES.length]); },
  setMode(m) {
    if (!PERF_MODES.includes(m)) return;
    this.mode = m;
    try { localStorage.setItem('koron-quality', m); } catch (e) { /* 保存できない */ }
    this.floor = 99; this.noGain = 0; this.lowWins = 0; this.goodT = 0;
    this.upHold.fill(10000);
    this.setTier(m === 'auto' ? this.tier : PERF_MODE_TIER[m], 'manual');
  },
  setTier(t, why) {
    t = clamp(t, 0, PERF_TIERS.length - 1);
    if (t === this.tier && R.q === PERF_TIERS[t]) return;
    this.log.push({ t: Math.round(performance.now()), from: this.tier, to: t, fps: Math.round(this.fps), why });
    if (this.log.length > 20) this.log.shift();
    this.tier = t;
    this.q = PERF_TIERS[t];
    this.fxMax = Math.round(400 * this.q.fx);
    this.changes++;
    if (R.ok && gl) { flushDraws(); R.q = this.q; applyQuality(); }
    this.graceT = 700; // シェーダーを作り直す分の引っかかりは数えない
    this.winT = this.winN = this.slowN = 0;
    if (this.mode === 'auto') { try { localStorage.setItem('koron-perf-tier', String(t)); } catch (e) { /* なし */ } }
  },

  // 毎フレーム beginFrame から呼ぶ。前のフレームからの時間で fps を集計し、段階を上げ下げする
  frameStart() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.startT) this.startT = now;
    // 裏に回っていた・止まっていたときは数えない
    if (dt <= 0 || dt > 250 || document.hidden) { this.winT = this.winN = this.slowN = 0; return; }
    if (this.graceT > 0) { this.graceT -= dt; return; }
    this.winT += dt; this.winN++;
    if (dt > 34) this.slowN++;
    // 最初の 8 秒は 1 秒ごと、あとは 2 秒ごとに判断する
    const early = now - this.startT < 8000;
    if (this.winT < (early ? 1000 : 2000)) return;
    const fps = (this.winN * 1000) / this.winT;
    const slowRate = this.slowN / this.winN;
    const winT = this.winT;
    this.winT = this.winN = this.slowN = 0;
    this.fps = fps;
    if (this.mode !== 'auto') return;
    this.judge(fps, slowRate, winT, early, now);
  },
  judge(fps, slowRate, winT, early, now) {
    // 下げた直後：速くなったかを確かめる
    if (this.downFps) {
      if (fps < this.downFps * 1.08) this.noGain++;
      else this.noGain = 0;
      this.downFps = 0;
      if (this.noGain >= 2) {
        // 2回下げても速くならない → 画面が 30Hz などに固定されている。2段もどして、ここより下げない
        this.noGain = 0;
        this.floor = Math.max(0, this.tier - 2);
        this.setTier(this.floor, 'capped');
        return;
      }
    }
    // 遅い：最初の数秒は1回で、プレイ中は2回続けて（大きく遅いときは1回で）下げる
    const slow = fps < 50 || slowRate > 0.1;
    if (slow) {
      this.goodT = 0;
      this.lowWins++;
      if ((early || fps < 40 || this.lowWins >= 2) && this.tier < PERF_TIERS.length - 1 && this.tier < this.floor) {
        // 上げてすぐ遅くなった → その段階へ上げるのは、次からもっと長く待つ
        if (this.upAt > 0 && now - this.upAt < 20000 && this.upFrom === this.tier + 1) this.upHold[this.tier] = Math.min(this.upHold[this.tier] * 2, 160000);
        this.upAt = -1;
        this.downFps = fps;
        this.lowWins = 0;
        // とても遅いときは2段とばす
        this.setTier(this.tier + (fps < 24 && this.tier < PERF_TIERS.length - 2 ? 2 : 1), 'slow');
      }
      return;
    }
    this.lowWins = 0;
    // 速い（ほぼ 60fps 以上で、引っかかりもない）状態が続いたら1段上げてみる
    if (fps >= 57 && slowRate < 0.02) this.goodT += winT;
    else this.goodT = 0;
    if (this.tier > 0 && this.goodT >= this.upHold[this.tier - 1]) {
      this.goodT = 0;
      this.upAt = now; this.upFrom = this.tier;
      this.setTier(this.tier - 1, 'fast');
    }
  },
  // デバッグ用（KORON.Perf.info()）
  info() {
    return {
      mode: this.mode, tier: this.tier, name: PERF_TIERS[this.tier].name, fps: Math.round(this.fps),
      dpr: R.dpr, size: R.w + 'x' + R.h, shadow: R.shadowOn ? R.sh.size : 0, pcf: this.q.pcf,
      draws: R.drawCalls, shadowDraws: R.shadowCalls, culled: R.culled, tris: Math.round(R.tris),
      sprites: Sprites.lastN, spritesCulled: Sprites.culled, fxMax: this.fxMax, changes: this.changes,
    };
  },
};
// window.KORON（90_game.js で作る）に Perf を足す
setTimeout(() => { if (window.KORON) window.KORON.Perf = Perf; }, 0);
