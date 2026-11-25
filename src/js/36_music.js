// BGM「そよかぜのさんぽ道」（このゲームのために作ったオリジナル曲。WebAudio で合成してループ）
// 8分音符を 1 マスとして、少し先まで予約して鳴らす（毎フレーム Music.update を呼ぶ）
const Music = (() => {
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const freq = (name) => {
    const m = /^([A-G][b#]?)(\d)$/.exec(name);
    return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
  };
  // メロディ（1小節 = 8 マス。'-' はのばす、'.' は休み）
  const MELODY = [
    'C5 . A4 C5 F5 - E5 D5', 'C5 - A4 - D5 . C5 A4', 'Bb4 . D5 F5 G5 - F5 D5', 'E5 - C5 - G4 . . .',
    'C5 . A4 C5 F5 - G5 A5', 'G5 - E5 C5 A4 . C5 E5', 'D5 - F5 D5 E5 - G5 E5', 'F5 - - . C5 . . .',
    'D5 . D5 F5 Bb5 - A5 G5', 'G5 . E5 G5 C6 - Bb5 G5', 'A5 - G5 E5 C5 - E5 G5', 'F5 - E5 D5 A4 - . .',
    'Bb4 . D5 G5 F5 . D5 Bb4', 'C5 . E5 G5 Bb5 - A5 G5', 'A5 - F5 C5 D5 E5 F5 G5', 'A5 - G5 - E5 . C5 .',
  ];
  // 和音（小節ごと。2つあるときは前半・後半）
  const CHORDS = [
    ['F'], ['Dm'], ['Bb'], ['C'], ['F'], ['Am'], ['Bb', 'C'], ['F'],
    ['Bb'], ['C'], ['Am'], ['Dm'], ['Gm'], ['C'], ['F'], ['C7'],
  ];
  const CH = {
    F: ['F2', 'A3', 'C4', 'F4'], Dm: ['D2', 'F3', 'A3', 'D4'], Bb: ['Bb1', 'D3', 'F3', 'Bb3'], C: ['C2', 'E3', 'G3', 'C4'],
    Am: ['A1', 'E3', 'A3', 'C4'], Gm: ['G1', 'G3', 'Bb3', 'D4'], C7: ['C2', 'E3', 'Bb3', 'C4'],
  };
  // 文字列を前もって数値にしておく（鳴らすときに文字列処理をしない）
  const mel = [];
  for (const bar of MELODY) {
    const toks = bar.split(' ');
    for (let i = 0; i < 8; i++) {
      const t = toks[i];
      if (t === '-' || t === '.') { mel.push({ f: 0, len: 0, rest: t === '.' }); continue; }
      let len = 1;
      while (i + len < 8 && toks[i + len] === '-') len++;
      mel.push({ f: freq(t), len, rest: false });
    }
  }
  const chordAt = [];
  CHORDS.forEach((cs) => {
    for (let i = 0; i < 8; i++) {
      const name = cs.length === 2 ? cs[i < 4 ? 0 : 1] : cs[0];
      chordAt.push(CH[name].map(freq));
    }
  });
  const STEPS = mel.length; // 128
  const BPM = 128;
  const STEP = 60 / BPM / 2;

  const M = {
    playing: false, step: 0, next: 0, mode: 'play',
    start() {
      if (!Sound.ctx || this.playing) return;
      this.playing = true; this.step = 0; this.next = Sound.ctx.currentTime + 0.15;
    },
    stop() { this.playing = false; },
    update() {
      const ctx = Sound.ctx;
      if (!ctx || !this.playing || ctx.state !== 'running') return;
      if (!Sound.bgmOn) { this.next = ctx.currentTime + 0.1; return; } // 止めている間は進めない
      // タブを離れていたら先頭からではなく今から再開
      if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.05;
      while (this.next < ctx.currentTime + 0.25) {
        this.playStep(this.step, this.next);
        this.step = (this.step + 1) % STEPS;
        this.next += STEP;
      }
    },
    playStep(i, t) {
      const bus = Sound.bgmBus;
      const s8 = i % 8;
      const ch = chordAt[i];
      // メロディ：やわらかい矩形波＋1オクターブ下の三角波
      const n = mel[i];
      if (n.f) {
        const d = n.len * STEP * 0.92;
        Sound.voice(n.f, n.f, d + 0.05, 'square', 0.07, 0, { lp: 2200, attack: 0.01 }, bus, t);
        Sound.voice(n.f * 0.5, n.f * 0.5, d + 0.05, 'triangle', 0.09, 0, { attack: 0.01 }, bus, t);
      }
      // ベース：ルート→5度（ぽんぽん跳ねる）
      if (s8 % 2 === 0) {
        const root = ch[0];
        const f = s8 === 2 || s8 === 6 ? root * 1.5 : root;
        Sound.voice(f, f, STEP * 1.6, 'triangle', 0.32, 0, { attack: 0.005 }, bus, t);
      }
      // 和音のきざみ（裏拍）
      if (s8 % 2 === 1) {
        for (let k = 1; k < 4; k++) Sound.voice(ch[k], ch[k], STEP * 0.7, 'square', 0.022, 0, { lp: 1600, attack: 0.004 }, bus, t);
      }
      // 打楽器：バスドラ（1・3拍目）、シェイカー（毎回）、スネア（2・4拍目）
      if (s8 === 0 || s8 === 4) Sound.voice(150, 45, 0.16, 'sine', 0.45, 0, null, bus, t);
      Sound.noiseTo(0.04, s8 % 2 ? 0.05 : 0.03, 7000, 7000, 'highpass', 0, 0.7, bus, t);
      if (s8 === 2 || s8 === 6) Sound.noiseTo(0.12, 0.09, 1800, 1200, 'bandpass', 0, 0.9, bus, t);
    },
  };
  return M;
})();
