// 効果音（WebAudio で合成。外部ファイルは使わない）
// 音の流れ：効果音バス／BGMバス → まとめ（master）→ コンプレッサー → スピーカー
const Sound = {
  ctx: null,
  master: null, sfxBus: null, bgmBus: null, echo: null,
  noiseBuf: null,
  sfxOn: localStorage.getItem('koron-sfx') !== '0' && localStorage.getItem('koron-mute') !== '1',
  bgmOn: localStorage.getItem('koron-bgm') !== '0',
  duck: 1,           // BGM を一時的に小さくする倍率
  lastAcornT: 0, acornChain: 0,
  get muted() { return !this.sfxOn && !this.bgmOn; },

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.55 : 0; this.sfxBus.connect(this.master);
    this.bgmBus = ctx.createGain(); this.bgmBus.gain.value = this.bgmOn ? 0.2 : 0; this.bgmBus.connect(this.master);
    // きらきら音用の短いこだま
    const d = ctx.createDelay(0.5); d.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    this.echo = ctx.createGain(); this.echo.gain.value = 0.5;
    this.echo.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(this.sfxBus);
    // ノイズは一度だけ作って使い回す
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const ch = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    if (typeof Music !== 'undefined') Music.start();
  },
  setSfx(on) {
    this.sfxOn = on;
    localStorage.setItem('koron-sfx', on ? '1' : '0');
    localStorage.removeItem('koron-mute');
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.02);
  },
  setBgm(on) {
    this.bgmOn = on;
    localStorage.setItem('koron-bgm', on ? '1' : '0');
    this.applyBgmGain();
  },
  setDuck(k) {
    if (Math.abs(k - this.duck) < 1e-3) return;
    this.duck = k;
    this.applyBgmGain();
  },
  applyBgmGain() {
    if (this.bgmBus) this.bgmBus.gain.setTargetAtTime(this.bgmOn ? 0.2 * this.duck : 0, this.ctx.currentTime, 0.08);
  },
  // 旧来の切りかえ（全部まとめて）
  setMute(m) { this.setSfx(!m); this.setBgm(!m); },

  // 音を1つ鳴らす：周波数を f0→f1 に変化。o: {type, vol, delay, attack, dest, q(フィルタ), lp}
  tone(f0, f1, dur, type = 'square', vol = 0.2, delay = 0, o) {
    if (!this.ctx || !this.sfxOn) return;
    this.voice(f0, f1, dur, type, vol, delay, o || null, this.sfxBus);
  },
  voice(f0, f1, dur, type, vol, delay, o, bus, when) {
    const ctx = this.ctx;
    const t = (when !== undefined ? when : ctx.currentTime) + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * (o && o.slide ? o.slide : 1));
    if (o && o.detune) osc.detune.value = o.detune;
    const atk = o && o.attack ? o.attack : 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = osc;
    if (o && o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7;
      osc.connect(f); last = f;
    }
    last.connect(g); g.connect(bus);
    if (o && o.echo) g.connect(this.echo);
    osc.start(t); osc.stop(t + dur + 0.03);
  },
  // ノイズ：フィルタの周波数を f0→f1 に動かす（ザッ・シュッ・ドン）
  noise(dur, vol = 0.2, f0 = 800, f1 = f0, type = 'lowpass', delay = 0, q = 0.8) {
    if (!this.ctx || !this.sfxOn) return;
    this.noiseTo(dur, vol, f0, f1, type, delay, q, this.sfxBus, this.ctx.currentTime);
  },
  noiseTo(dur, vol, f0, f1, type, delay, q, bus, when) {
    const ctx = this.ctx;
    const t = when + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },

  play(name, k = 1) {
    if (!this.ctx || !this.sfxOn) return;
    const now = this.ctx.currentTime;
    switch (name) {
      // ジャンプ：段が上がるほど高く明るく
      case 'jump':
        this.tone(300, 620, 0.16, 'triangle', 0.22, 0, { slide: 0.6 });
        this.tone(600, 1240, 0.1, 'square', 0.035, 0, { lp: 2400, slide: 0.6 });
        break;
      case 'jump2':
        this.tone(360, 780, 0.17, 'triangle', 0.22, 0, { slide: 0.6 });
        this.tone(720, 1560, 0.12, 'square', 0.04, 0, { lp: 2800, slide: 0.6 });
        break;
      case 'jump3':
        this.tone(420, 1000, 0.22, 'triangle', 0.22, 0, { slide: 0.5 });
        this.tone(840, 2000, 0.16, 'square', 0.04, 0, { lp: 3000, slide: 0.5 });
        [1319, 1568, 2093].forEach((f, i) => this.tone(f, f, 0.18, 'sine', 0.06, 0.08 + i * 0.05, { echo: true }));
        break;
      case 'flip': // バク宙・くるりんジャンプ
        this.tone(330, 900, 0.25, 'triangle', 0.2, 0, { slide: 0.7 });
        this.noise(0.3, 0.12, 600, 3000, 'bandpass', 0.02, 1.5);
        break;
      case 'longjump':
        this.tone(260, 520, 0.22, 'triangle', 0.2, 0, { slide: 0.8 });
        this.noise(0.28, 0.1, 2500, 700, 'bandpass', 0, 1.2);
        break;
      case 'land': // 着地：ポスッ（k で強さ）
        this.tone(150, 55, 0.12, 'sine', 0.22 * k);
        this.noise(0.08, 0.1 * k, 900, 300);
        break;
      case 'step':
        this.noise(0.035, 0.035 * k, 1800 + Math.random() * 600, 900, 'bandpass', 0, 1.2);
        break;
      case 'skid':
        this.noise(0.28, 0.1, 3200, 1400, 'bandpass', 0, 2);
        this.tone(900, 700, 0.18, 'sawtooth', 0.02, 0, { lp: 1500 });
        break;
      case 'acorn': { // 続けて取ると音が上がる
        if (now - this.lastAcornT < 0.6) this.acornChain = Math.min(this.acornChain + 1, 7); else this.acornChain = 0;
        this.lastAcornT = now;
        const up = Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12][this.acornChain] / 12);
        this.tone(1175 * up, 1175 * up, 0.07, 'square', 0.05, 0, { lp: 4000 });
        this.tone(1568 * up, 1568 * up, 0.22, 'sine', 0.14, 0.055, { echo: true });
        break;
      }
      case 'seed':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
          this.tone(f, f, 0.35, 'triangle', 0.13, i * 0.075, { echo: true });
          this.tone(f * 2, f * 2, 0.2, 'sine', 0.04, i * 0.075 + 0.01);
        });
        break;
      case 'hurt':
        this.tone(520, 180, 0.3, 'square', 0.08, 0, { lp: 1800 });
        this.tone(500, 160, 0.3, 'square', 0.06, 0.02, { lp: 1800, detune: 30 });
        this.noise(0.15, 0.1, 1200, 400);
        break;
      case 'stomp': // ぷにっ
        this.tone(520, 130, 0.14, 'sine', 0.25);
        this.tone(1040, 260, 0.08, 'triangle', 0.08);
        this.noise(0.06, 0.08, 1500, 500);
        break;
      case 'punch':
        this.noise(0.12, 0.13, 900, 3200, 'bandpass', 0, 1.2);
        this.tone(180, 110, 0.07, 'sine', 0.1);
        break;
      case 'punch2':
        this.noise(0.12, 0.13, 1100, 3800, 'bandpass', 0, 1.2);
        this.tone(220, 130, 0.07, 'sine', 0.1);
        break;
      case 'kick':
        this.noise(0.18, 0.15, 700, 3500, 'bandpass', 0, 1.5);
        this.tone(160, 90, 0.1, 'sine', 0.14);
        break;
      case 'hit': // 攻撃が当たった
        this.noise(0.1, 0.25, 2500, 600);
        this.tone(300, 90, 0.12, 'square', 0.08, 0, { lp: 1600 });
        break;
      case 'poundSpin':
        this.noise(0.22, 0.1, 500, 2600, 'bandpass', 0, 2);
        break;
      case 'pound':
        this.tone(130, 38, 0.35, 'sine', 0.4);
        this.noise(0.3, 0.25, 700, 120);
        break;
      case 'wall':
        this.tone(380, 820, 0.12, 'triangle', 0.2, 0, { slide: 0.5 });
        this.noise(0.05, 0.12, 2200, 900);
        break;
      case 'spring':
        this.tone(180, 1000, 0.35, 'sine', 0.22, 0, { slide: 0.5 });
        this.tone(360, 2000, 0.25, 'triangle', 0.05, 0.02, { slide: 0.5 });
        break;
      case 'fall': this.tone(900, 120, 0.9, 'triangle', 0.14); break;
      case 'heart':
        [784, 988, 1319].forEach((f, i) => this.tone(f, f, 0.22, 'sine', 0.13, i * 0.07, { echo: true }));
        break;
      case 'select':
        this.tone(880, 880, 0.06, 'square', 0.05, 0, { lp: 3000 });
        this.tone(1320, 1320, 0.12, 'triangle', 0.1, 0.05);
        break;
      case 'cursor': this.tone(660, 660, 0.05, 'triangle', 0.1); break;
      case 'pause': this.tone(988, 988, 0.08, 'square', 0.04, 0, { lp: 2500 }); this.tone(659, 659, 0.12, 'square', 0.04, 0.08, { lp: 2500 }); break;
      case 'clear':
        [523, 659, 784, 1047, 0, 988, 1047].forEach((f, i) => {
          if (!f) return;
          this.tone(f, f, i === 6 ? 0.9 : 0.28, 'triangle', 0.15, i * 0.14, { echo: true });
          this.tone(f / 2, f / 2, i === 6 ? 0.9 : 0.25, 'square', 0.03, i * 0.14, { lp: 1200 });
        });
        break;
      case 'over':
        [523, 466, 392, 330].forEach((f, i) => this.tone(f, f * 0.98, 0.32, 'triangle', 0.13, i * 0.22));
        break;
    }
  },
};
