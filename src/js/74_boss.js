// ボス「ねじまきフクロウ ホーロック」と、エンディング
//
// ねじまき時計の空島（大きな文字盤）にすむ、ぜんまい仕掛けの大きなフクロウ。せなかに ねじ。
// 体力 6（2 へるごとに こうげきが かわる）。ふらふら（目をまわしている）の間だけ こうげきが きく
//   だい1だんかい：にらむ（赤い線で 向きが見える）→ まっすぐ とっしん → ふちで 目をまわす
//   だい2だんかい：とび上がる → 赤い丸（落ちる場所）→ ドスン ＋ 広がる波（ジャンプでよける）
//                 2回目のドスンで くちばしが ゆかに ささって 目をまわす
//   だい3だんかい：目が光ったあと 星のたま（3回。ジャンプか すき間でよける）→ とっしん／ドスン → 目をまわす
//   目をまわしている間：頭をふむ・ヒップドロップ・パンチ／キック で 1 ダメージ（あとは 1.5 秒むてき）
//   主人公が落ちたら 戦いの最初の足場（階段のおわり）にもどる。たおれたら そのだんかいの はじめから
const BOSSC = { r: 1.75, h: 3.5, hDizzy: 2.5, maxHp: 6, name: 'ねじまきフクロウ ホーロック' };

function makeBoss(cx, top, cz, R, pad) {
  return {
    cx, cz, top, R, pad, x: cx, y: top, z: cz, yaw: Math.atan2(pad[0] - cx, pad[2] - cz),
    hp: BOSSC.maxHp, phase: 1, state: 'sleep', t: 0, active: false, done: false, inv: 0,
    vy: 0, spd: 0, cyc: 0, step: 0, next: null, hx: cx, hz: cz, from: null,
    rings: [], shots: [], wave: 0, flash: 0, squash: 1, keyA: 0, flap: 0, shownHp: BOSSC.maxHp, fxT: 0, phaseUp: false,
  };
}
function bossSet(B, s) { B.state = s; B.t = 0; }
function bossMusic(on) {
  if (typeof Music === 'undefined' || !Music.setStyle) return;
  const st = Level.stage;
  Music.setStyle(on && st.bossMusic ? st.bossMusic : st.music);
}
const bossPhaseOf = (hp) => (hp > 4 ? 1 : hp > 2 ? 2 : 3);
const bossPhaseHp = (ph) => BOSSC.maxHp - (ph - 1) * 2;
// 戦いをやめて 待つ状態にもどす（体力は いまの だんかいの はじめから）
function bossReset(B) {
  B.active = false;
  bossSet(B, 'sleep');
  B.x = B.cx; B.z = B.cz; B.y = B.top; B.vy = 0; B.spd = 0;
  B.hp = bossPhaseHp(B.phase); B.shownHp = B.hp;
  B.rings.length = 0; B.shots.length = 0; B.step = 0; B.cyc = 0; B.inv = 0;
  bossMusic(false);
}
// ふらふら（目をまわす）にする
function bossDizzy(B) {
  bossSet(B, 'dizzy');
  B.spd = 0;
  B.dizzyDur = [0, 3.8, 3.4, 3.0][B.phase];
  Sound.play('land');
  s3tone(500, 180, 0.5, 'square', 0.06);
}
// つぎの こうげき（だんかいごとの順番）
function bossNextAttack(B) {
  if (B.phase === 1) bossSet(B, 'aim');
  else if (B.phase === 2) bossSet(B, 'crouch');
  else { B.next = B.cyc % 2 === 0 ? 'aim' : 'crouch'; bossSet(B, 'barrage'); B.wave = 0; }
}

function updateBoss(B, dt) {
  const playing = P.state !== 'dead' && P.state !== 'win' && (Game.state === undefined || Game.state === 'play');
  B.t += dt;
  B.inv = Math.max(0, B.inv - dt);
  B.flash = Math.max(0, B.flash - dt * 2.5);
  B.squash = lerp(B.squash, 1, 1 - Math.exp(-dt * 8));
  B.keyA += dt * (B.state === 'dizzy' ? 0.6 : B.state === 'charge' ? 14 : 3);
  B.flap += dt * (B.state === 'hover' || B.state === 'rise' ? 14 : 3);
  B.shownHp = approach(B.shownHp, B.hp, dt * 3);
  if (B.done) return;
  const dxp = P.x - B.cx, dzp = P.z - B.cz, prC = Math.hypot(dxp, dzp);

  // ---- 戦いのはじまり・おわり ----
  if (B.state === 'sleep') {
    B.y = B.top;
    if (playing && P.grounded && prC < B.R - 1.5 && Math.abs(P.y - B.top) < 1.5) {
      B.active = true;
      bossSet(B, 'intro');
      bossMusic(true);
      Game.toast(BOSSC.name + 'が めを さました！', 3);
      Game.toast('目を まわしている間に 頭を ふもう！', 4);
      s3tone(392, 392, 0.25, 'square', 0.07); s3tone(330, 330, 0.4, 'square', 0.07, 0.28);
    }
    return;
  }
  if (B.active && B.state !== 'defeat') {
    if (P.state === 'dead' || (playing && P.grounded && prC > B.R + 1.5)) { bossReset(B); return; }
    if (playing) {
      // 戦いの間は、落ちたら 最初の足場へ
      P.safe[0] = B.pad[0]; P.safe[1] = B.pad[1]; P.safe[2] = B.pad[2];
      if (P.y < B.top - 9) { Game.onFall(); return; }
    }
  }

  const toPyaw = Math.atan2(P.x - B.x, P.z - B.z);
  const turn = (k) => { B.yaw += clamp(angDiff(B.yaw, toPyaw), -k * dt, k * dt); };
  const ph = B.phase;
  switch (B.state) {
    case 'intro':
      turn(3);
      if (B.t > 0.6 && B.t < 1.4) B.y = B.top + Math.sin((B.t - 0.6) / 0.8 * Math.PI) * 2.5;
      else B.y = B.top;
      if (B.t > 1.4 && !B.introLand) { B.introLand = true; B.squash = 0.7; Game.shake = 0.3; Sound.play('pound'); B.rings.push({ x: B.x, z: B.z, r: 1.5, sp: 9, safe: true }); }
      if (B.t > 2.4) { B.introLand = false; bossSet(B, 'idle'); }
      break;
    case 'idle':
      turn(2.2);
      B.y = B.top + Math.abs(Math.sin(B.t * 5)) * 0.25;
      if (B.t > [0, 1.3, 1.0, 0.8][ph]) { B.y = B.top; bossNextAttack(B); }
      break;
    case 'aim': {
      // にらむ：はじめは主人公を追い、最後の 0.45 秒は向きを決めて 動かない（赤い線が明るくなる）
      const dur = ph === 3 ? 0.95 : 1.15;
      if (B.t < dur - 0.45) turn(4);
      B.squash = 0.88;
      if (B.t > dur) { bossSet(B, 'charge'); B.spd = 0; Sound.play('longjump'); s3tone(200, 90, 0.4, 'sawtooth', 0.05); }
      break;
    }
    case 'charge': {
      const vmax = ph === 3 ? 15.5 : 13;
      B.spd = Math.min(vmax, B.spd + 45 * dt);
      B.x += Math.sin(B.yaw) * B.spd * dt; B.z += Math.cos(B.yaw) * B.spd * dt;
      B.y = B.top + Math.abs(Math.sin(B.t * 16)) * 0.15;
      const d = Math.hypot(B.x - B.cx, B.z - B.cz), lim = B.R - 2.2;
      if (d > lim || B.t > 2.5) {
        if (d > lim) { B.x = B.cx + (B.x - B.cx) / d * lim; B.z = B.cz + (B.z - B.cz) / d * lim; }
        B.y = B.top;
        Game.shake = 0.35;
        Fx.burst(B.x + Math.sin(B.yaw) * 1.8, B.top + 1.5, B.z + Math.cos(B.yaw) * 1.8, [1, 0.9, 0.6], 14, 5);
        if (ph === 3) B.cyc++;
        bossDizzy(B);
      }
      break;
    }
    case 'crouch':
      turn(3);
      B.squash = 0.7;
      if (B.t > 0.55) { bossSet(B, 'rise'); Sound.play('jump3'); B.hx = B.x; B.hz = B.z; }
      break;
    case 'rise':
      B.y = B.top + 12 * Math.sin(Math.min(1, B.t / 0.55) * Math.PI / 2);
      if (B.t > 0.55) bossSet(B, 'hover');
      break;
    case 'hover': {
      // 落ちる場所（赤い丸）：はじめは主人公を追い、最後の 0.75 秒は止まる
      const dur = ph === 3 ? 1.6 : 1.9;
      if (B.t < dur - 0.75 && playing) {
        const tx = P.x, tz = P.z;
        const ddx = tx - B.hx, ddz = tz - B.hz, dd = Math.hypot(ddx, ddz);
        const mv = Math.min(dd, 8 * dt);
        if (dd > 1e-4) { B.hx += ddx / dd * mv; B.hz += ddz / dd * mv; }
        const dc = Math.hypot(B.hx - B.cx, B.hz - B.cz), lim = B.R - 2.2;
        if (dc > lim) { B.hx = B.cx + (B.hx - B.cx) / dc * lim; B.hz = B.cz + (B.hz - B.cz) / dc * lim; }
      }
      B.x = lerp(B.x, B.hx, 1 - Math.exp(-dt * 10)); B.z = lerp(B.z, B.hz, 1 - Math.exp(-dt * 10));
      B.y = B.top + 12 + Math.sin(B.t * 4) * 0.3;
      turn(2);
      if (B.t > dur) { bossSet(B, 'slam'); B.x = B.hx; B.z = B.hz; B.vy = -6; }
      break;
    }
    case 'slam':
      B.vy -= 90 * dt;
      B.y += B.vy * dt;
      if (B.y <= B.top) {
        B.y = B.top; B.squash = 0.6;
        Game.shake = 0.45;
        Sound.play('pound');
        s3tone(120, 40, 0.5, 'sine', 0.2);
        Fx.burst(B.x, B.top + 0.3, B.z, [1, 0.85, 0.6], 20, 8);
        B.rings.push({ x: B.x, z: B.z, r: 2.0, sp: 7.5 });
        if (playing && Math.hypot(P.x - B.x, P.z - B.z) < 2.9 && P.y < B.top + 1.5) playerHurt(B.x, B.z);
        if (ph === 2) {
          B.step++;
          if (B.step >= 2) { B.step = 0; bossDizzy(B); } else bossSet(B, 'wait');
        } else { B.cyc++; bossDizzy(B); }
      }
      break;
    case 'wait':
      turn(2);
      if (B.t > 0.8) bossSet(B, 'crouch');
      break;
    case 'barrage': {
      // 0.9 秒 目が光ってから、星のたまを 3回（すき間の場所を少しずつずらす）
      turn(1.5);
      const times = [0.9, 1.55, 2.2];
      if (B.wave < 3 && B.t > times[B.wave]) {
        const n = 8, a0 = B.yaw + B.wave * (TAU / 16) + Math.PI / n;
        for (let i = 0; i < n; i++) {
          const a = a0 + i * TAU / n;
          B.shots.push({ x: B.x + Math.sin(a) * 1.9, z: B.z + Math.cos(a) * 1.9, y: B.top + 0.6, vx: Math.sin(a) * 6.5, vz: Math.cos(a) * 6.5, t: 0 });
        }
        B.wave++;
        B.squash = 1.15;
        Sound.play('kick');
        s3tone(900, 1500, 0.15, 'square', 0.05);
      }
      if (B.t > 2.7) bossSet(B, B.next || 'aim');
      break;
    }
    case 'dizzy':
      B.y = B.top;
      if (B.t > B.dizzyDur) bossSet(B, 'recover');
      break;
    case 'hurt':
      B.y = B.top + Math.max(0, Math.sin(Math.min(1, B.t / 0.5) * Math.PI)) * 1.2;
      if (B.t > 1.3) {
        B.y = B.top;
        if (B.hp <= 0) {
          bossSet(B, 'defeat');
          Game.toast('やったね！ ホーロックの ねじが とまった！', 3);
        } else if (B.phaseUp) {
          B.phaseUp = false;
          bossSet(B, 'roar');
          Game.toast(B.phase === 2 ? 'ホーロックが おこった！ こんどは とび上がるぞ' : 'ホーロックが 本気になった！ 星のたまに 気をつけて', 3.5);
          s3tone(300, 600, 0.5, 'sawtooth', 0.06); s3tone(600, 250, 0.6, 'sawtooth', 0.06, 0.5);
        } else bossSet(B, 'recover');
      }
      break;
    case 'roar':
      B.squash = 1 + Math.sin(B.t * 20) * 0.05;
      if (B.t > 1.6) bossSet(B, 'recover');
      break;
    case 'recover': {
      // まんなかへ ぴょんと もどる
      if (!B.from) B.from = [B.x, B.z];
      const k = Math.min(1, B.t / 0.9);
      B.x = lerp(B.from[0], B.cx, k); B.z = lerp(B.from[1], B.cz, k);
      B.y = B.top + Math.sin(k * Math.PI) * 3;
      turn(3);
      if (k >= 1) { B.from = null; B.y = B.top; B.squash = 0.8; bossSet(B, 'idle'); }
      break;
    }
    case 'defeat':
      B.fxT -= dt;
      if (B.fxT <= 0) {
        B.fxT = 0.16;
        Fx.burst(B.x + (Math.random() - 0.5) * 2.5, B.top + 0.5 + Math.random() * 3, B.z + (Math.random() - 0.5) * 2.5, [1, 0.85, 0.5], 8, 5);
        s3tone(200 + Math.random() * 600, 100, 0.15, 'square', 0.04);
      }
      if (B.t > 2.8) {
        B.done = true; B.active = false;
        B.rings.length = 0; B.shots.length = 0;
        Fx.burst(B.x, B.top + 2, B.z, [1, 0.95, 0.7], 40, 10);
        Game.shake = 0.5;
        bossMusic(false);
        revealSeedMsg(6, 'ホーロックを たおした！ さいごの ひかりの種が あらわれた！');
      }
      break;
  }

  // ---- 広がる波 ----
  for (let i = B.rings.length - 1; i >= 0; i--) {
    const rg = B.rings[i];
    const prev = rg.r;
    rg.r += rg.sp * dt;
    if (!rg.safe && playing && P.inv <= 0 && P.y < B.top + 0.55) {
      const d = Math.hypot(P.x - rg.x, P.z - rg.z);
      if (d > prev - 0.55 && d < rg.r + 0.55) playerHurt(rg.x, rg.z);
    }
    if (rg.r > B.R + 0.5) B.rings.splice(i, 1);
  }
  // ---- 星のたま ----
  for (let i = B.shots.length - 1; i >= 0; i--) {
    const s = B.shots[i];
    s.t += dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    if (playing && Math.hypot(P.x - s.x, P.y + 0.65 - s.y, P.z - s.z) < 0.85) { playerHurt(s.x - s.vx * 0.1, s.z - s.vz * 0.1); Fx.burst(s.x, s.y, s.z, [1, 0.6, 0.7], 6, 3); B.shots.splice(i, 1); continue; }
    if (Math.hypot(s.x - B.cx, s.z - B.cz) > B.R + 1.5 || s.t > 4) B.shots.splice(i, 1);
  }

  // ---- 主人公との当たり ----
  if (!playing || B.state === 'defeat' || !B.active) return;
  const dx = P.x - B.x, dz = P.z - B.z, d = Math.hypot(dx, dz);
  const H = B.state === 'dizzy' ? BOSSC.hDizzy : BOSSC.h;
  const r = BOSSC.r;
  const headY = B.y + H;
  if (B.state === 'dizzy' && B.inv <= 0) {
    const stomp = d < r + 0.35 && P.y > headY - 0.8 && P.y < headY + 1.0 && (P.vy < 0 || P.state === 'pound');
    if (stomp || s3attackHits(B.x, B.y + 1.0, B.z, r + 1.1)) { bossHit(B, stomp, dx, dz, d); return; }
  }
  if (d < r + P.r && P.y < headY - 0.3 && P.y + P.h > B.y) {
    const k = d > 1e-4 ? 1 / d : 0;
    P.x = B.x + (d > 1e-4 ? dx * k : 1) * (r + P.r);
    P.z = B.z + (d > 1e-4 ? dz * k : 0) * (r + P.r);
    if ((B.state === 'charge' || B.state === 'slam') && P.inv <= 0) playerHurt(B.x, B.z);
  } else if (d < r && P.vy < 0 && P.y >= headY - 0.3 && P.y < headY + 0.6) {
    // ふらふらでないときに頭へ乗った：はね返される（ダメージなし）
    s3launch(11);
    P.yaw = Math.atan2(dx, dz); P.speed = 6;
    Sound.play('spring');
  }
}

// ボスに こうげきが 当たった
function bossHit(B, stomp, dx, dz, d) {
  B.hp--;
  B.inv = 1.5; B.flash = 1; B.squash = 0.6;
  const np = bossPhaseOf(B.hp);
  if (np !== B.phase && B.hp > 0) { B.phase = np; B.phaseUp = true; B.cyc = 0; B.step = 0; }
  bossSet(B, 'hurt');
  B.rings.length = 0; B.shots.length = 0;
  Sound.play('stomp'); Sound.play('hit');
  s3tone(700, 200, 0.3, 'square', 0.07);
  Fx.burst(B.x, B.y + 2.6, B.z, [1, 0.9, 0.5], 22, 7);
  Game.shake = 0.4;
  // 主人公は はね返る
  const ax = d > 1e-3 ? dx / d : 0, az = d > 1e-3 ? dz / d : 1;
  if (stomp) { s3launch(15); P.yaw = Math.atan2(ax, az); P.speed = 6; }
  else { P.speed = -4; }
  P.inv = Math.max(P.inv, 0.6);
}

// ---------- ボスの描画 ----------
const BOSS_HURT = [1, 0.55, 0.55], BOSS_EYE = [1, 0.9, 0.35], BOSS_EYE_RED = [1, 0.25, 0.25], BOSS_EYE_DIZZY = [0.6, 0.6, 0.8];
function bossLocal(B, lx, ly, lz) {
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  return [B.x + c * lx + s * lz, B.y + ly, B.z - s * lx + c * lz];
}
function drawBoss(B, t, tint) {
  if (B.done) return;
  if (B.state === 'defeat' && B.t > 2.7) return;
  const dizzy = B.state === 'dizzy';
  const sq = B.squash * (dizzy ? 0.74 : 1);
  const sx = 1 / Math.sqrt(B.squash);
  const sway = dizzy ? Math.sin(t * 4) * 0.12 : B.state === 'defeat' ? Math.sin(t * 40) * 0.06 : 0;
  const blink = B.inv > 0 && Math.floor(t * 14) % 2 === 0;
  const col = blink || B.state === 'defeat' ? BOSS_HURT : tint;
  const m = Tt(B.x, B.y, B.z, sx, sq, sx, B.yaw, dizzy ? 0.25 : 0, sway);
  drawMesh(Models.bossBody, m, col);
  // 目（光る）
  const eyeC = dizzy ? BOSS_EYE_DIZZY : (B.state === 'aim' || B.state === 'hover' || (B.state === 'barrage' && B.t < 2.4) || B.state === 'roar') ? BOSS_EYE_RED : BOSS_EYE;
  for (const side of [-1, 1]) {
    const em = Tt(B.x, B.y, B.z, sx, sq, sx, B.yaw, dizzy ? 0.25 : 0, sway);
    M4.translate(em, side * 0.62, 2.55, 1.38);
    drawMesh(Models.bossEye, em, eyeC, dizzy ? 0.4 : 1);
  }
  // つばさ（ぱたぱた）
  const fl = Math.sin(B.flap) * (B.state === 'hover' || B.state === 'rise' ? 0.7 : 0.15);
  for (const side of [-1, 1]) {
    const wm = Tt(B.x, B.y, B.z, sx, sq, sx, B.yaw, 0, sway);
    M4.translate(wm, side * 1.62, 2.0, -0.1);
    M4.rotZ(wm, side * (0.25 + fl));
    drawMesh(side < 0 ? Models.bossWingL : Models.bossWingR, wm, col);
  }
  // せなかの ねじ
  const km = Tt(B.x, B.y, B.z, sx, sq, sx, B.yaw, 0, sway);
  M4.translate(km, 0, 2.0, -1.62);
  M4.rotZ(km, B.keyA);
  drawMesh(Models.bossKey, km, col, dizzy ? 0.3 : 0);
  drawShadow(B.x, B.y, B.z, 2.0, 0.4);
  // 星のたま
  for (const s of B.shots) drawMesh(Models.s3star, Tt(s.x, s.y, s.z, 0.9, 0.9, 0.9, s.t * 8), [1, 0.5, 0.62], 0.9);
}

// 予兆・波・目のまわる星など（スプライト。drawStage3 から 主の段階だけ呼ぶ）
function drawBossFx(B, t) {
  const top = B.top;
  // とっしんの向き（赤い線）。最後の 0.45 秒は明るく速く点滅
  if (B.state === 'aim') {
    const dur = B.phase === 3 ? 0.95 : 1.15, lock = B.t > dur - 0.45;
    const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
    const a = lock ? 0.55 + 0.35 * Math.sin(t * 30) : 0.25 + 0.15 * Math.sin(t * 10);
    for (let d = 2; d < B.R + 2; d += 1.0) {
      const x = B.x + fx * d, z = B.z + fz * d;
      if (Math.hypot(x - B.cx, z - B.cz) > B.R - 0.3) break;
      Sprites.add(x, top + 0.06, z, 1.9, 5, 1, 0.2, 0.25, a);
    }
  }
  // 落ちる場所（赤い丸）
  if (B.state === 'hover' || B.state === 'slam') {
    const dur = B.phase === 3 ? 1.6 : 1.9, lock = B.state === 'slam' || B.t > dur - 0.75;
    const k = lock ? 0.6 + 0.3 * Math.sin(t * 30) : 0.35;
    Sprites.add(B.hx, top + 0.07, B.hz, 2.9 / 0.8, 4, 1, 0.25, 0.25, k);
    Sprites.add(B.hx, top + 0.06, B.hz, 3.2, 5, 1, 0.2, 0.2, k * 0.6);
  }
  // 広がる波：地面の輪と、ふちの光の粒（高さの目安）
  for (const rg of B.rings) {
    const a = rg.safe ? 0.4 : 0.85;
    Sprites.add(rg.x, top + 0.08, rg.z, rg.r / 0.8, 4, 1, 0.7, 0.35, a);
    const n = Math.min(48, Math.max(12, Math.round(rg.r * 4)));
    for (let i = 0; i < n; i++) {
      const an = i * TAU / n + t;
      Sprites.add(rg.x + Math.cos(an) * rg.r, top + 0.3, rg.z + Math.sin(an) * rg.r, 0.45, 1, 1, 0.75, 0.4, a * 0.7);
    }
  }
  // 星のたまの光
  for (const s of B.shots) Sprites.add(s.x, s.y, s.z, 1.5, 1, 1, 0.45, 0.6, 0.6);
  if (B.done) return;
  // 目の光
  const dizzy = B.state === 'dizzy';
  const red = B.state === 'aim' || B.state === 'hover' || (B.state === 'barrage' && B.t < 2.4) || B.state === 'roar';
  const eyeH = 2.55 * (dizzy ? 0.74 : 1);
  for (const side of [-1, 1]) {
    const p = bossLocal(B, side * 0.62, eyeH, 1.5);
    Sprites.add(p[0], p[1], p[2], red ? 1.6 : 1.1, 1, red ? 1 : 1, red ? 0.3 : 0.9, red ? 0.3 : 0.45, dizzy ? 0.15 : 0.55);
  }
  // 星のたまの前の ため（光がふくらむ）
  if (B.state === 'barrage' && B.t < 0.9) Sprites.add(B.x, top + 2, B.z, 2 + B.t * 5, 1, 1, 0.5, 0.6, 0.25 + B.t * 0.4);
  // 目をまわしている：頭の上を 星がまわる＋ねらいどころの光
  if (dizzy) {
    const hy = B.y + BOSSC.hDizzy + 0.5;
    for (let i = 0; i < 4; i++) {
      const an = t * 4 + i * TAU / 4;
      Sprites.add(B.x + Math.cos(an) * 1.1, hy + Math.sin(an * 2) * 0.12, B.z + Math.sin(an) * 1.1, 0.7, 2, 1, 0.95, 0.5, 0.9, an);
    }
    const rk = fract(t * 1.5);
    Sprites.add(B.x, B.y + BOSSC.hDizzy + 0.05, B.z, 0.8 + rk * 1.6, 4, 0.6, 1, 0.9, (1 - rk) * 0.9);
  }
  if (B.state === 'sleep') {
    // ねている：Z のかわりに 小さな星が のぼる
    for (let i = 0; i < 3; i++) {
      const k = fract(t * 0.4 + i / 3);
      Sprites.add(B.x + 0.6 + k * 1.2, B.y + 3.6 + k * 2, B.z, 0.3 + k * 0.4, 2, 0.8, 0.85, 1, (1 - k) * 0.8, k * 3);
    }
  }
}

// ボスの体力ゲージ（画面の上のほう）
function drawBossGauge(B, W, H, fs, small) {
  if (!B.active && !(B.state === 'defeat' && !B.done)) return;
  const S = Input.safe;
  const portrait = H > W;
  const bw = clamp(W * 0.46, 220, 420), bh = small ? 14 : 18;
  const y0 = S.t + (portrait ? 168 : small ? 62 : 72);
  const x0 = W / 2 - bw / 2;
  panel(x0 - 12, y0 - 4, bw + 24, bh + (small ? 30 : 36), 14, 'rgba(30,20,70,.6)', 'rgba(255,220,140,.8)');
  txtFit(BOSSC.name, W / 2, y0 + (small ? 9 : 11), small ? 13 : 15, bw, '#ffe9a8', 'center');
  const by = y0 + (small ? 19 : 23);
  rrect(x0, by, bw, bh, bh / 2);
  hud.fillStyle = 'rgba(10,10,30,.75)'; hud.fill();
  const k = clamp(B.shownHp / BOSSC.maxHp, 0, 1);
  if (k > 0) {
    rrect(x0 + 2, by + 2, (bw - 4) * k, bh - 4, (bh - 4) / 2);
    hud.fillStyle = B.flash > 0 && Math.floor(Game.time * 20) % 2 === 0 ? '#ffffff' : B.hp <= 2 ? '#ff5a6e' : B.hp <= 4 ? '#ffb347' : '#8ee06a';
    hud.fill();
  }
  // 2 ずつの区切り（だんかい）
  hud.fillStyle = 'rgba(30,20,70,.9)';
  for (let i = 1; i < BOSSC.maxHp; i++) hud.fillRect(x0 + bw * i / BOSSC.maxHp - 1, by + 1, i % 2 === 0 ? 3 : 1.5, bh - 2);
  void fs;
}

// ボスのモデル
function buildBossModels() {
  const IND = hex(0x4d4f96), INDDK = hex(0x33346e), BRASS = hex(0xd8b25e), BRASSDK = hex(0x9c7a36), ORANGE = hex(0xff9a4a), CREAM = hex(0xf6efd8);
  {
    const g = new Geo();
    // 体（たまご形）。おなかは時計の文字盤
    g.sphere(T(0, 1.75, 0, 1.75, 1.75, 1.65), (p) => (Math.abs(p[1] + 0.48) < 0.06 ? BRASS : mixc(INDDK, IND, clamp(p[1] * 0.6 + 0.6, 0, 1))), 22, 14);
    const fy = 1.22, fr = 0.86;
    g.cyl(T(0, fy, 1.24, fr, 0.36, fr, 0, Math.PI / 2), (p, n) => (Math.abs(n[1]) > 0.5 ? CREAM : BRASS), 24);
    g.torus(T(0, fy, 1.6, 1, 1, 1, 0, Math.PI / 2), BRASS, fr, 0.07, 24, 5);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.box(T(Math.cos(a) * fr * 0.78, fy + Math.sin(a) * fr * 0.78, 1.61, 0.07, i % 3 === 0 ? 0.2 : 0.11, 0.03, 0, 0, a + Math.PI / 2), INDDK); }
    g.box(T(0.15, fy + 0.13, 1.63, 0.06, 0.38, 0.03, 0, 0, -0.6), INDDK);   // 時計のはり
    g.box(T(-0.1, fy - 0.09, 1.63, 0.06, 0.27, 0.03, 0, 0, -2.3), INDDK);
    g.sphere(T(0, fy, 1.65, 0.07, 0.07, 0.04), BRASS, 6, 4);
    // 目のまわり（真ちゅうのふち）
    for (const sx of [-1, 1]) {
      g.cyl(T(sx * 0.62, 2.55, 1.18, 0.56, 0.22, 0.56, 0, Math.PI / 2), CREAM, 16);
      g.torus(T(sx * 0.62, 2.55, 1.4, 1, 1, 1, 0, Math.PI / 2), BRASS, 0.52, 0.09, 18, 5);
      // 耳の羽根（とがり）
      g.cyl(T(sx * 0.95, 3.0, 0.1, 0.34, 0.9, 0.24, 0, 0, -sx * 0.45), (p) => mixc(INDDK, IND, p[1]), 6, { top: 0, flat: true });
      // 足
      g.sphere(T(sx * 0.7, 0.12, 0.7, 0.42, 0.16, 0.5), ORANGE, 8, 5, { flat: true });
      for (let k = -1; k <= 1; k++) g.cyl(T(sx * 0.7 + k * 0.2, 0.08, 1.1, 0.07, 0.25, 0.07, 0, Math.PI / 2), hex(0xe07a30), 5, { top: 0 });
    }
    // くちばし
    g.cyl(T(0, 2.15, 1.45, 0.22, 0.5, 0.18, 0, Math.PI / 2), ORANGE, 8, { top: 0, flat: true });
    // 頭の歯車
    g.cyl(T(0, 3.38, 0, 0.55, 0.16, 0.55), BRASS, 14);
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.box(T(Math.cos(a) * 0.6, 3.46, Math.sin(a) * 0.6, 0.2, 0.15, 0.2, -a), BRASSDK); }
    g.sphere(T(0, 3.56, 0, 0.18, 0.18, 0.18), hex(0xfff2a0), 8, 5);
    // びょう
    for (let i = 0; i < 10; i++) { const a = i * TAU / 10 + 0.3; g.sphere(T(Math.cos(a) * 1.56, 0.92, Math.sin(a) * 1.48, 0.07, 0.07, 0.07), BRASS, 5, 3); }
    Models.bossBody = g.mesh();
  }
  Models.bossEye = new Geo().sphere(T(0, 0, 0, 0.36, 0.36, 0.12), (p) => (p[2] > 0.6 && Math.hypot(p[0], p[1]) < 0.35 ? hex(0x2a1c18) : hex(0xffe27a)), 14, 8).mesh();
  // つばさ（肩が原点、下へたれる）
  for (const side of [-1, 1]) {
    const g = new Geo();
    g.sphere(T(side * 0.15, -0.65, 0, 0.28, 0.95, 0.75, 0, 0, side * 0.1), (p) => mixc(INDDK, IND, clamp(p[1] * 0.5 + 0.6, 0, 1)), 10, 7, { flat: true });
    for (let k = 0; k < 3; k++) g.box(T(side * 0.33, -0.5 - k * 0.35, 0, 0.04, 0.05, 1.0 - k * 0.2), BRASS);
    if (side < 0) Models.bossWingL = g.mesh(); else Models.bossWingR = g.mesh();
  }
  // せなかの ねじ（じくは -z 向き。つまみは じくを ふくむ面）
  {
    const g = new Geo();
    g.cyl(T(0, 0, 0, 0.13, 0.9, 0.13, 0, -Math.PI / 2), BRASSDK, 8);
    g.cyl(T(0, 0, -0.85, 0.22, 0.2, 0.22, 0, -Math.PI / 2), BRASS, 10);
    for (const sx of [-1, 1]) g.torus(T(sx * 0.42, 0, -1.1, 1, 1, 1, 0, 0, 0), BRASS, 0.36, 0.1, 14, 6);
    Models.bossKey = g.mesh();
  }
}

// ================= エンディング =================
// 最後の種（ステージの ending.seed）を取ると Game.state = 'ending'。カメラが空島をまわり、
// 「あそんでくれて ありがとう」と、全ステージの集めた種・このプレイのどんぐりとタイムを出す。そのあとタイトルへ
const Ending = { fw: 0, ov: { eye: [0, 0, 0], target: [0, 0, 0] } };
function startEnding() {
  const wasClear = Game.state === 'clear';
  Game.state = 'ending'; Game.stT = 0; Game.menuSel = 0;
  P.state = 'win';
  Ending.fw = 1.5;
  Sound.setDuck(1);
  const st = Level.stage;
  if (typeof Music !== 'undefined' && Music.setStyle && st.endMusic) Music.setStyle(st.endMusic);
  if (!wasClear) setTimeout(() => Sound.play('clear'), 500);
}
function updateEnding(dt) {
  const t = Game.stT;
  updatePlayer(dt);
  updateLevel(dt);
  // カメラ：はじめは ころんを うつし、だんだん はなれて 空島を ぐるりと まわる
  const ov = Ending.ov;
  const k = smooth(clamp((t - 1.5) / 5, 0, 1));
  const a = P.yaw + t * 0.13;
  const r = lerp(7, 82, k), cy = lerp(P.y + 2.4, 34 + Math.sin(t * 0.2) * 5, k);
  const cx = lerp(P.x, 6, k), cz = lerp(P.z, -6, k);
  ov.eye[0] = cx + Math.sin(a) * r; ov.eye[1] = cy; ov.eye[2] = cz + Math.cos(a) * r;
  ov.target[0] = cx; ov.target[1] = lerp(P.y + 1.8, 2, k); ov.target[2] = cz;
  Cam.override = ov;
  updateCamera(dt);
  // はなび（星の色）
  Ending.fw -= dt;
  if (Ending.fw <= 0) {
    Ending.fw = 0.45 + Math.random() * 0.6;
    const cols = [[1, 0.9, 0.5], [0.6, 1, 0.9], [1, 0.6, 0.85], [0.6, 0.75, 1]];
    const an = Math.random() * TAU, rr = 10 + Math.random() * 35;
    Fx.burst(6 + Math.cos(an) * rr, 22 + Math.random() * 18, -6 + Math.sin(an) * rr, cols[Math.floor(Math.random() * cols.length)], 30, 10);
    s3tone(180 + Math.random() * 80, 60, 0.35, 'sine', 0.12);
  }
  if (t > 6 && (Input.okP || Input.tapP || Input.jumpP || Input.backP || Input.pauseP)) { Sound.play('select'); goTitle(); return; }
  if (t > 60) goTitle();
}
function drawEnding(W, H, fs, small) {
  const t = Game.stT;
  const g = hud.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(10,10,40,.25)');
  g.addColorStop(1, `rgba(10,10,40,${Math.min(0.55, t * 0.12)})`);
  hud.fillStyle = g; hud.fillRect(0, 0, W, H);
  if (t < 4.5) {
    hud.globalAlpha = Math.min(1, t * 2, (4.5 - t) * 1.5);
    txtFit('ころんは さいごの ひかりの種を とりもどした！', W / 2, H * 0.16, small ? 18 : 24, W - 30, '#ffe9a8', 'center');
    hud.globalAlpha = 1;
  }
  if (t > 3.2) {
    const k = Math.min(1, (t - 3.2) * 1.2);
    hud.globalAlpha = k;
    const title = 'あそんでくれて ありがとう';
    const ts = clamp(Math.min(W / 13, H / 9), 22, 56);
    setFont(ts);
    const full = hud.measureText(title).width;
    const sc = Math.min(1, (W - 30) / full);
    let x = W / 2 - full * sc / 2;
    const ty = H * 0.17;
    const cols = ['#ffd166', '#9cfff0', '#ffb0d8', '#b9c8ff'];
    for (let i = 0; i < title.length; i++) {
      const ch = title[i];
      setFont(ts * sc);
      const cw = hud.measureText(ch).width;
      txt(ch, x + cw / 2, ty + Math.sin(t * 3 + i * 0.5) * 4, ts * sc, cols[i % cols.length], 'center', 'rgba(30,30,80,.95)');
      x += cw;
    }
    hud.globalAlpha = 1;
  }
  if (t > 5) {
    hud.globalAlpha = Math.min(1, (t - 5) * 1.5);
    const n = STAGES.length;
    const lh = small ? 22 : 28;
    const pw = Math.min(W - 30, 540), ph = lh * (n + 3) + 26;
    const px = W / 2 - pw / 2, py = Math.min(H * 0.3, H - Input.safe.b - ph - 40);
    panel(px, py, pw, ph, 16, 'rgba(255,252,240,.92)', '#ffd166');
    const f = small ? 13 : 16;
    let y = py + 18 + lh / 2;
    let sum = 0, tot = 0;
    for (let i = 0; i < n; i++) {
      const st = STAGES[i], sv = Save.st(i);
      const got = sv.seeds.length, all = st.seedTotal || 0;
      sum += got; tot += all;
      txtFit((i + 1) + '. ' + st.name, px + 16, y, f, pw * 0.42, '#2c3e70', 'left', null);
      txtFit('ひかりの種 ' + got + ' / ' + all, px + pw * 0.5, y, f, pw * 0.26, got >= all ? '#e07a00' : '#2c3e70', 'left', null);
      txtFit('ベスト ' + (sv.best ? fmtTime(sv.best) : '--:--.--'), px + pw - 16, y, f * 0.9, pw * 0.24, '#7a5230', 'right', null);
      y += lh;
    }
    hud.fillStyle = 'rgba(40,50,90,.2)'; hud.fillRect(px + 14, y - lh / 2 + 2, pw - 28, 2);
    y += 6;
    txtFit('あつめた ひかりの種　ぜんぶで ' + sum + ' / ' + tot, W / 2, y, f + 1, pw - 24, '#1f9e8f', 'center', null);
    y += lh;
    txtFit('このプレイ　どんぐり ' + Game.acorns + ' こ　タイム ' + fmtTime(Game.playTime), W / 2, y, f, pw - 24, '#7a5230', 'center', null);
    hud.globalAlpha = 1;
  }
  if (t > 6 && Math.floor(Game.time * 1.5) % 2 === 0) {
    const touch = Input.touchMode || Input.hasTouch;
    txt(touch ? 'タップで タイトルへ' : 'Enter / スペースで タイトルへ', W / 2, H - Input.safe.b - 22, fs * 0.8, '#fff', 'center');
  }
}
