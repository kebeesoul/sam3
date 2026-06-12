/* ============================================================
   삼국지 디펜스 - 사운드 (Web Audio API 절차 생성)
   외부 에셋 없이 효과음과 동양풍 BGM을 합성한다.
   체인: 소스 → (dry/리버브 wet) → 컴프레서 → 출력
   ============================================================ */

const AudioSys = (() => {
  let ctx = null, master = null, comp = null, wet = null, bgmGain = null, sfxGain = null;
  let muted = false;
  let bgmPlaying = false, bgmTimer = null, bgmNextNote = 0, bgmStep = 0;
  const lastPlayed = {}; // 효과음 스로틀

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 20;
      comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      comp.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(comp);
      // 리버브 (생성한 임펄스 응답)
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(1.8, 2.6);
      wet = ctx.createGain(); wet.gain.value = 0.22;
      wet.connect(conv); conv.connect(master);
      bgmGain = ctx.createGain(); bgmGain.gain.value = 0.20;
      bgmGain.connect(master); bgmGain.connect(wet);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 1.0;
      sfxGain.connect(master); sfxGain.connect(wet);
    } catch (e) { return false; }
    return true;
  }

  function makeImpulse(dur, decay) {
    const sr = ctx.sampleRate, len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  }

  /* ---------------- 합성 도우미 ---------------- */
  function tone(freq, dur, opts = {}) {
    if (!ctx || muted) return;
    const { type = 'square', vol = 0.15, slide = 0, at = 0, detune = 0, out = sfxGain } = opts;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts = {}) {
    if (!ctx || muted) return;
    const { vol = 0.2, at = 0, low = 0, hi = 0, out = sfxGain } = opts;
    const t0 = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    let node = src;
    if (low) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low; node.connect(f); node = f; }
    if (hi) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hi; node.connect(f); node = f; }
    node.connect(g); g.connect(out);
    src.start(t0);
  }

  /* 가야금/고쟁 풍 뜯는 소리: 디튠된 삼각파 2개 + 로우패스 */
  function pluck(freq, dur, vol, at, out) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + Math.max(0, at);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 5, t0);
    f.frequency.exponentialRampToValueAtTime(freq * 1.4, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    f.connect(g); g.connect(out || bgmGain);
    for (const det of [-5, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    // 어택의 '팅' 소리
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'square'; o2.frequency.value = freq * 2;
    g2.gain.setValueAtTime(vol * 0.4, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    o2.connect(g2); g2.connect(out || bgmGain);
    o2.start(t0); o2.stop(t0 + 0.08);
  }

  /* 피리/대금 풍 리드: 사인파 + 비브라토 LFO + 입김 노이즈 */
  function flute(freq, dur, vol, at) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + Math.max(0, at);
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 5.2; lfoG.gain.value = freq * 0.012;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.06);
    g.gain.setValueAtTime(vol, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(bgmGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    noise(Math.min(0.1, dur), { vol: vol * 0.12, at: Math.max(0, at), hi: 3000, out: bgmGain });
  }

  /* 북 (큰북/소고) */
  function drum(at, big) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + Math.max(0, at);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 110 : 180, t0);
    o.frequency.exponentialRampToValueAtTime(big ? 45 : 80, t0 + 0.15);
    g.gain.setValueAtTime(big ? 0.8 : 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (big ? 0.3 : 0.15));
    o.connect(g); g.connect(bgmGain);
    o.start(t0); o.stop(t0 + 0.35);
    noise(big ? 0.12 : 0.05, { vol: big ? 0.25 : 0.12, at: Math.max(0, at), low: 400, out: bgmGain });
  }

  /* 박자목/딱따기 */
  function clave(at) {
    if (!ctx || muted) return;
    tone(1100, 0.04, { type: 'square', vol: 0.06, at, out: bgmGain });
    noise(0.03, { vol: 0.08, at, hi: 2500, out: bgmGain });
  }

  /* ---------------- 효과음 ---------------- */
  const rp = () => 1 + (Math.random() - 0.5) * 0.12; // 피치 랜덤
  const SFX = {
    arrow:   () => { tone(950 * rp(), 0.07, { vol: 0.05, slide: -500 }); noise(0.05, { vol: 0.03, hi: 2400 }); },
    rock:    () => { tone(150 * rp(), 0.2, { type: 'sawtooth', vol: 0.1, slide: -70 }); noise(0.08, { vol: 0.06, low: 600 }); },
    fire:    () => { noise(0.18, { vol: 0.05, low: 1800 }); tone(260 * rp(), 0.2, { type: 'sawtooth', vol: 0.04, slide: -120 }); },
    boom:    () => { noise(0.5, { vol: 0.3, low: 700 }); tone(85, 0.35, { type: 'sine', vol: 0.32, slide: -45 }); tone(60, 0.5, { type: 'sine', vol: 0.2, slide: -25, at: 0.04 }); },
    slash:   () => noise(0.08, { vol: 0.06, hi: 1500 }),
    coin:    () => { tone(1150, 0.06, { type: 'triangle', vol: 0.07 }); tone(1720, 0.1, { type: 'triangle', vol: 0.07, at: 0.06 }); },
    build:   () => { noise(0.06, { vol: 0.1, low: 900 }); tone(310, 0.09, { type: 'triangle', vol: 0.16 }); tone(465, 0.12, { type: 'triangle', vol: 0.16, at: 0.1 }); },
    sell:    () => { tone(465, 0.09, { type: 'triangle', vol: 0.14 }); tone(310, 0.12, { type: 'triangle', vol: 0.14, at: 0.1 }); },
    ult:     () => { tone(180, 0.6, { type: 'sawtooth', vol: 0.22, slide: 560 }); noise(0.5, { vol: 0.14, at: 0.18, low: 2500 }); tone(90, 0.4, { type: 'sine', vol: 0.25, slide: -30, at: 0.1 }); },
    horn:    () => { // 뿔나팔: 배음 두 겹
      for (const [f, v] of [[196, 0.16], [294, 0.08]]) {
        tone(f, 0.55, { type: 'sawtooth', vol: v }); tone(f * 1.5, 0.6, { type: 'sawtooth', vol: v * 0.9, at: 0.35 });
      }
      drum(0.05, true);
    },
    life:    () => { tone(310, 0.2, { type: 'square', vol: 0.18, slide: -160 }); tone(220, 0.25, { type: 'square', vol: 0.12, slide: -120, at: 0.1 }); },
    heroDie: () => { tone(420, 0.45, { type: 'triangle', vol: 0.2, slide: -280 }); noise(0.3, { vol: 0.1, low: 800, at: 0.05 }); },
    levelup: () => [523, 659, 784, 1046].forEach((f, i) => pluck(f, 0.5, 0.2, i * 0.09, sfxGain)),
    win:     () => {
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) => pluck(f, 0.6, 0.22, i * 0.17, sfxGain));
      flute(1046, 1.2, 0.12, 0.85);
      drum(0, true); drum(0.34, false); drum(0.68, true);
    },
    lose:    () => {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, { type: 'sawtooth', vol: 0.13, at: i * 0.3 }));
      drum(0.1, true); drum(0.9, true);
    },
  };

  function play(name, throttleMs = 50) {
    if (!ctx || muted || !SFX[name]) return;
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < throttleMs) return;
    lastPlayed[name] = now;
    try { SFX[name](); } catch (e) { /* 무시 */ }
  }

  /* ============================================================
     BGM: A단조 펜타토닉 (궁상각치우), 64스텝 A/B 2부 구성
     A부: 가야금 합주, B부: 피리 리드가 가세
     ============================================================ */
  const SC = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784, 880];
  // 멜로디 (-1 = 쉼표)
  const MEL_A = [5, -1, 7, 6, 5, -1, 3, -1, 5, 6, 7, -1, 9, -1, 7, 6,
                 5, -1, 3, 2, 3, -1, 5, -1, 2, -1, 1, 2, 0, -1, -1, -1];
  const MEL_B = [9, -1, 10, 9, 7, -1, 6, 5, 6, -1, 7, 9, 7, -1, 6, 5,
                 6, 5, 3, -1, 5, 6, 5, 3, 2, -1, 3, 2, 0, -1, -1, -1];
  // 가야금 반주 아르페지오 (저음역)
  const ARP = [0, 2, 4, 2];
  const STEP = 0.30;
  const LOOP = 64;

  function scheduleBgm() {
    if (!ctx || !bgmPlaying) return;
    while (bgmNextNote < ctx.currentTime + 0.7) {
      const s = bgmStep % LOOP;
      const at = bgmNextNote - ctx.currentTime;
      const inB = s >= 32;
      const mel = inB ? MEL_B[s - 32] : MEL_A[s];

      if (mel >= 0) {
        pluck(SC[mel], STEP * 2.4, 0.32, at);            // 가야금 멜로디
        if (inB) flute(SC[mel], STEP * 1.7, 0.14, at);   // B부: 피리가 같이 연주
      }
      if (s % 2 === 0) pluck(SC[ARP[(s / 2) % 4]] / 2, STEP * 1.8, 0.16, at); // 저음 아르페지오
      if (s % 8 === 0) drum(at, true);                   // 큰북
      if (s % 8 === 4) drum(at, false);                  // 소고
      if (s % 4 === 2) clave(at);                        // 딱따기
      if (s === 30 || s === 62) { drum(at, false); drum(at + STEP * 0.5, false); } // 필인

      bgmNextNote += STEP;
      bgmStep++;
    }
  }

  function startBgm() {
    if (!ensure() || bgmPlaying) return;
    unlock();
    bgmPlaying = true;
    bgmNextNote = ctx.currentTime + 0.1;
    bgmStep = 0;
    bgmTimer = setInterval(scheduleBgm, 200);
  }
  function stopBgm() {
    bgmPlaying = false;
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  return { play, unlock, setMuted, startBgm, stopBgm, get muted() { return muted; } };
})();
