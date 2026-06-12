/* ============================================================
   삼국지 디펜스 - 사운드 (Web Audio API 절차 생성)
   외부 에셋 없이 효과음과 펜타토닉 BGM을 합성한다.
   ============================================================ */

const AudioSys = (() => {
  let ctx = null, master = null, bgmGain = null;
  let muted = false;
  let bgmPlaying = false, bgmTimer = null, bgmNextNote = 0, bgmStep = 0;
  const lastPlayed = {}; // 효과음 스로틀

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.16;
      bgmGain.connect(master);
    } catch (e) { return false; }
    return true;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  function tone(freq, dur, opts = {}) {
    if (!ctx || muted) return;
    const { type = 'square', vol = 0.15, slide = 0, at = 0 } = opts;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts = {}) {
    if (!ctx || muted) return;
    const { vol = 0.2, at = 0, low = false } = opts;
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
    if (low) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 500;
      src.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    src.start(t0);
  }

  const SFX = {
    arrow:   () => tone(900, 0.06, { vol: 0.05, slide: -400 }),
    rock:    () => tone(140, 0.18, { type: 'sawtooth', vol: 0.1, slide: -60 }),
    fire:    () => { noise(0.14, { vol: 0.04 }); tone(240, 0.18, { type: 'sawtooth', vol: 0.04, slide: -100 }); },
    boom:    () => { noise(0.4, { vol: 0.22, low: true }); tone(80, 0.3, { type: 'sine', vol: 0.25, slide: -40 }); },
    slash:   () => noise(0.07, { vol: 0.05 }),
    coin:    () => { tone(1100, 0.06, { vol: 0.06 }); tone(1600, 0.09, { vol: 0.06, at: 0.06 }); },
    build:   () => { tone(300, 0.08, { type: 'triangle', vol: 0.15 }); tone(450, 0.1, { type: 'triangle', vol: 0.15, at: 0.09 }); },
    sell:    () => { tone(450, 0.08, { type: 'triangle', vol: 0.13 }); tone(300, 0.1, { type: 'triangle', vol: 0.13, at: 0.09 }); },
    ult:     () => { tone(200, 0.5, { type: 'sawtooth', vol: 0.2, slide: 500 }); noise(0.4, { vol: 0.12, at: 0.15 }); },
    horn:    () => { tone(220, 0.45, { type: 'sawtooth', vol: 0.14 }); tone(330, 0.5, { type: 'sawtooth', vol: 0.12, at: 0.3 }); },
    life:    () => { tone(300, 0.18, { type: 'square', vol: 0.18, slide: -150 }); },
    heroDie: () => { tone(400, 0.4, { type: 'triangle', vol: 0.18, slide: -250 }); },
    levelup: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.14, at: i * 0.09 })); },
    win:     () => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.18, at: i * 0.16 })); },
    lose:    () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', vol: 0.14, at: i * 0.28 })); },
  };

  function play(name, throttleMs = 50) {
    if (!ctx || muted || !SFX[name]) return;
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < throttleMs) return;
    lastPlayed[name] = now;
    try { SFX[name](); } catch (e) { /* 무시 */ }
  }

  /* ---- BGM: 궁상각치우 5음계 순환 멜로디 ---- */
  // A 단조 펜타토닉 (중국 전통 5음계 느낌)
  const SCALE = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784];
  const MELODY = [5, 7, 6, 5, 3, 5, 2, 0, 3, 5, 6, 7, 9, 7, 6, 5,
                  5, 3, 2, 3, 5, 6, 5, 3, 2, 0, 1, 2, 3, 2, 0, -1];
  const STEP = 0.32;

  function scheduleBgm() {
    if (!ctx || !bgmPlaying) return;
    while (bgmNextNote < ctx.currentTime + 0.6) {
      const idx = MELODY[bgmStep % MELODY.length];
      const at = bgmNextNote - ctx.currentTime;
      if (idx >= 0) {
        // 멜로디 (얼후/피리 느낌의 삼각파)
        bgmTone(SCALE[idx], STEP * 0.95, 'triangle', 0.5, at);
      }
      if (bgmStep % 4 === 0) bgmTone(SCALE[0] / 2, STEP * 3.4, 'sine', 0.35, at); // 베이스 드론
      if (bgmStep % 8 === 4) bgmNoiseHit(at); // 북소리
      bgmNextNote += STEP;
      bgmStep++;
    }
  }
  function bgmTone(freq, dur, type, vol, at) {
    const t0 = ctx.currentTime + Math.max(0, at);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(bgmGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function bgmNoiseHit(at) {
    const t0 = ctx.currentTime + Math.max(0, at);
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.55;
    src.connect(f); f.connect(g); g.connect(bgmGain);
    src.start(t0);
  }

  function startBgm() {
    if (!ensure() || bgmPlaying) return;
    unlock();
    bgmPlaying = true;
    bgmNextNote = ctx.currentTime + 0.1;
    bgmStep = 0;
    bgmTimer = setInterval(scheduleBgm, 250);
  }
  function stopBgm() {
    bgmPlaying = false;
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  return { play, unlock, setMuted, startBgm, stopBgm, get muted() { return muted; } };
})();
