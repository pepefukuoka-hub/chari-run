// 効果音（WebAudio で合成。外部ファイルは使わない）
const Sound = {
  ctx: null,
  master: null,
  muted: localStorage.getItem('koron-mute') === '1',
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  },
  setMute(m) {
    this.muted = m;
    localStorage.setItem('koron-mute', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  // 音を1つ鳴らす：周波数を f0→f1 に変化
  tone(f0, f1, dur, type = 'square', vol = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t);
  },
  play(name) {
    switch (name) {
      case 'jump': this.tone(330, 660, 0.14, 'square', 0.12); break;
      case 'jump2': this.tone(392, 880, 0.16, 'square', 0.12); break;
      case 'jump3': this.tone(440, 1320, 0.28, 'square', 0.13); this.tone(660, 1760, 0.2, 'triangle', 0.08, 0.06); break;
      case 'land': this.noise(0.06, 0.12, 500); break;
      case 'acorn': this.tone(988, 988, 0.06, 'square', 0.1); this.tone(1319, 1319, 0.16, 'square', 0.1, 0.06); break;
      case 'seed': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.16, i * 0.09)); break;
      case 'hurt': this.tone(400, 90, 0.35, 'sawtooth', 0.14); break;
      case 'stomp': this.tone(220, 60, 0.15, 'square', 0.16); this.noise(0.1, 0.15, 900); break;
      case 'punch': this.noise(0.08, 0.2, 1500); this.tone(200, 120, 0.08, 'square', 0.08); break;
      case 'pound': this.noise(0.25, 0.3, 400); this.tone(120, 40, 0.25, 'sine', 0.3); break;
      case 'wall': this.tone(500, 900, 0.1, 'square', 0.1); break;
      case 'spring': this.tone(200, 900, 0.3, 'sine', 0.2); break;
      case 'fall': this.tone(800, 100, 0.8, 'triangle', 0.15); break;
      case 'heart': this.tone(660, 990, 0.2, 'sine', 0.15); break;
      case 'select': this.tone(660, 660, 0.08, 'square', 0.08); break;
      case 'clear': [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.16, i * 0.15)); break;
    }
  },
};
