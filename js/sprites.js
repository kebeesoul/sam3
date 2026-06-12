/* ============================================================
   삼국지 디펜스 - 픽셀아트 스프라이트 (절차 생성)
   외부 이미지 없이 오프스크린 캔버스에 사전 렌더링한다.
   ============================================================ */

const Sprites = (() => {
  const cache = new Map();
  let terrainCache = null, terrainStageId = -1;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 색 보정: hex 색을 amt(-255~255)만큼 밝게/어둡게 */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function mk(w, h, scale, fn) {
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.scale(scale, scale);
    fn(g);
    return c;
  }
  const px = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  /* ============================================================
     사람 스프라이트 (논리 14x19 px, 3배 확대)
     palette: skin, armor, trim, pants, helm('band'|'helm'|'turban'|
              'straw'|'scarf'|'crown'|'scholar'|'wild'), helmColor,
              weapon('sword'|'spear'|'bow'|'staff'|'fan'|'glaive'|'none'),
              beard, cape, plume
     ============================================================ */
  function man(g, p, frame) {
    const f = frame === 1;
    const armor = p.armor, trim = p.trim || shade(p.armor, 50);
    if (p.cape) { px(g, 2, 8, 2, 7, p.cape); px(g, 3, 7, 1, 8, shade(p.cape, -30)); }
    // 다리
    px(g, f ? 4 : 5, 15, 2, 3, p.pants || shade(armor, -50));
    px(g, f ? 8 : 7, 15, 2, 3, p.pants || shade(armor, -50));
    px(g, f ? 4 : 5, 17, 2, 1, '#2a2018');
    px(g, f ? 8 : 7, 17, 2, 1, '#2a2018');
    // 몸통 (갑옷)
    px(g, 4, 8, 6, 7, armor);
    px(g, 4, 8, 6, 1, trim);
    px(g, 4, 12, 6, 1, shade(armor, -40)); // 허리띠
    px(g, 6, 9, 2, 3, shade(armor, 25));   // 가슴판 하이라이트
    // 팔
    px(g, 3, 9, 1, 4, shade(armor, -25));
    px(g, 10, 9, 1, 4, shade(armor, -25));
    px(g, 3, 13, 1, 1, p.skin); px(g, 10, 13, 1, 1, p.skin);
    // 머리
    px(g, 4, 3, 6, 5, p.skin);
    px(g, 5, 5, 1, 1, '#1a1a1a'); px(g, 8, 5, 1, 1, '#1a1a1a'); // 눈
    if (p.beard) { px(g, 5, 7, 4, p.beardLen || 1, p.beard); if ((p.beardLen || 1) > 1) px(g, 6, 8 + (p.beardLen - 2), 2, 2, p.beard); }
    // 머리장식
    const hc = p.helmColor || trim;
    switch (p.helm) {
      case 'band':    px(g, 4, 3, 6, 1, hc); break;
      case 'turban':  px(g, 4, 2, 6, 2, hc); px(g, 3, 3, 1, 2, hc); break;
      case 'helm':
        px(g, 4, 2, 6, 2, hc); px(g, 5, 1, 4, 1, hc);
        px(g, 3, 3, 1, 2, hc); px(g, 10, 3, 1, 2, hc);
        if (p.plume) { px(g, 6, 0, 2, 1, p.plume); px(g, 7, -1 + 1, 1, 1, p.plume); }
        break;
      case 'straw':   px(g, 3, 2, 8, 1, hc); px(g, 5, 1, 4, 1, hc); break;
      case 'scarf':   px(g, 4, 2, 6, 2, hc); px(g, 10, 4, 1, 3, hc); break;
      case 'crown':   px(g, 4, 2, 6, 1, hc); px(g, 5, 1, 1, 1, hc); px(g, 7, 0, 1, 2, hc); px(g, 9, 1, 1, 1, hc); break;
      case 'scholar': px(g, 5, 1, 4, 2, hc); px(g, 6, 0, 2, 1, hc); break;
      case 'wild':    px(g, 3, 2, 8, 2, hc); px(g, 2, 3, 1, 3, hc); px(g, 11, 3, 1, 3, hc); break;
    }
    // 무기 (오른쪽)
    switch (p.weapon) {
      case 'sword':
        px(g, 11, 6, 1, 7, '#cfd8dc'); px(g, 10, 12, 3, 1, '#8a6d2a'); break;
      case 'spear':
        px(g, 11, 1, 1, 14, '#7a5a32'); px(g, 11, 0, 1, 2, '#cfd8dc'); break;
      case 'glaive':
        px(g, 11, 1, 1, 14, '#6a4a28'); px(g, 10, 0, 3, 3, '#b8c4cc'); px(g, 12, 1, 1, 2, '#8a949c'); break;
      case 'bow':
        px(g, 11, 4, 1, 8, '#8a6d2a'); px(g, 12, 5, 1, 6, '#5a4318'); break;
      case 'staff':
        px(g, 11, 2, 1, 13, '#5a4632'); px(g, 10, 1, 3, 2, '#ffd75e'); break;
      case 'fan':
        px(g, 11, 6, 2, 4, '#f5f0e0'); px(g, 11, 10, 1, 2, '#8a6d2a'); break;
      case 'axe':
        px(g, 11, 4, 1, 9, '#6a4a28'); px(g, 10, 3, 3, 2, '#9aa4ac'); break;
    }
    if (p.shield) { px(g, 1, 9, 3, 5, p.shield); px(g, 2, 10, 1, 2, shade(p.shield, 40)); }
  }

  /* 기마 유닛 (논리 20x19) - rider 팔레트로 위에 사람 상반신 */
  function horseman(g, p, frame) {
    const f = frame === 1;
    const hb = p.horse || '#6a4a30';
    // 말 다리
    px(g, 5, 14, 2, 4, shade(hb, f ? -30 : 0));
    px(g, 9, 14, 2, 4, shade(hb, f ? 0 : -30));
    px(g, 13, 14, 2, 4, shade(hb, f ? -30 : 0));
    // 말 몸통
    px(g, 4, 9, 13, 5, hb);
    px(g, 5, 10, 10, 2, shade(hb, 20));
    // 머리/목
    px(g, 15, 5, 3, 5, hb); px(g, 17, 4, 2, 4, hb);
    px(g, 18, 5, 1, 1, '#1a1a1a');
    px(g, 15, 4, 2, 4, shade(hb, -40)); // 갈기
    px(g, 3, 9, 1, 4, shade(hb, -40)); // 꼬리
    // 안장
    px(g, 8, 8, 5, 2, p.saddle || '#8a2e2e');
    // 기수 (상반신)
    px(g, 8, 2, 5, 6, p.armor);
    px(g, 8, 2, 5, 1, p.trim || shade(p.armor, 50));
    px(g, 9, -2 + 2, 3, 3, p.skin); // 머리 y=0..3
    px(g, 9, 0, 3, 1, p.helmColor || p.trim || '#444');
    if (p.weapon === 'spear' || p.weapon === 'glaive') {
      px(g, 14, -1 + 1, 1, 10, '#6a4a28');
      px(g, 13, 0, 3, 1, '#b8c4cc');
    } else {
      px(g, 13, 1, 1, 5, '#cfd8dc');
    }
  }

  /* 공성차 (논리 20x16) */
  function siegeCart(g, p, frame) {
    px(g, 2, 4, 16, 7, '#7a5a36');
    px(g, 2, 4, 16, 2, '#8f6c42');
    px(g, 4, 2, 12, 3, '#6a4a2c');
    px(g, 8, 0, 4, 3, '#5a3e24'); // 지붕 꼭대기
    // 충차 머리
    px(g, 17, 7, 3, 3, '#9aa4ac');
    // 바퀴
    const off = frame === 1 ? 1 : 0;
    for (const wx of [4, 10, 15]) {
      px(g, wx, 11, 4, 4, '#3a2c1c');
      px(g, wx + 1, 12, 2, 2, '#6a543a');
      px(g, wx + 1 + off, 11, 1, 1, '#1c140c');
    }
  }

  /* ---------------- 유닛 팔레트 ---------------- */
  const SKIN = '#e8b88a';
  const UNIT_DEFS = {
    yellowTurban: { kind: 'man', skin: SKIN, armor: '#8a7a4a', trim: '#b09a52', helm: 'turban', helmColor: '#e8c83a', weapon: 'sword' },
    bandit:       { kind: 'man', skin: SKIN, armor: '#5a5248', trim: '#7a7268', helm: 'scarf', helmColor: '#7a3a2a', weapon: 'axe' },
    archerFoot:   { kind: 'man', skin: SKIN, armor: '#4a5a6a', trim: '#6a7e92', helm: 'band', helmColor: '#32404e', weapon: 'bow' },
    infantry:     { kind: 'man', skin: SKIN, armor: '#5a6470', trim: '#8a96a4', helm: 'helm', helmColor: '#46505c', weapon: 'spear', shield: '#3e4854' },
    cavalry:      { kind: 'horse', skin: SKIN, armor: '#4a5a6a', trim: '#7a8a9a', helmColor: '#36424e', weapon: 'spear', horse: '#6a4a30' },
    elite:        { kind: 'man', skin: SKIN, armor: '#7a3a8a', trim: '#b07ac0', helm: 'helm', helmColor: '#5c2a68', plume: '#e8c83a', weapon: 'glaive', shield: '#4a2452' },
    siege:        { kind: 'siege' },
    tigerGuard:   { kind: 'horse', skin: SKIN, armor: '#a4742a', trim: '#e8b84a', helmColor: '#7a5418', weapon: 'glaive', horse: '#3a3a42', saddle: '#c89a3a' },
    navy:         { kind: 'man', skin: SKIN, armor: '#2e6a7a', trim: '#5aa4b8', helm: 'band', helmColor: '#1e4a56', weapon: 'sword', shield: '#1e4a56' },
    shaman:       { kind: 'man', skin: SKIN, armor: '#c8b870', trim: '#e8dca0', helm: 'turban', helmColor: '#e8c83a', weapon: 'staff', beard: '#9a9a9a' },
    // 보스
    zhangJiao:  { kind: 'man', boss: true, skin: '#d8a878', armor: '#c8a830', trim: '#f0d860', helm: 'turban', helmColor: '#f0d020', weapon: 'staff', beard: '#b0b0b0', beardLen: 3, cape: '#a08010' },
    huaXiong:   { kind: 'man', boss: true, skin: '#c89878', armor: '#6a2a2a', trim: '#a04040', helm: 'helm', helmColor: '#4a1c1c', plume: '#e84a3a', weapon: 'glaive', cape: '#5a1c1c' },
    caoRen:     { kind: 'man', boss: true, skin: SKIN, armor: '#3a4a6a', trim: '#6a82aa', helm: 'helm', helmColor: '#2a3852', plume: '#3a6ae8', weapon: 'spear', shield: '#2a3852', cape: '#2a3852' },
    lvBu:       { kind: 'horse', boss: true, skin: '#d8a888', armor: '#3a3a3a', trim: '#e84a3a', helmColor: '#c83a2a', weapon: 'glaive', horse: '#a83a2a', saddle: '#e8c83a' },
    zhangHe:    { kind: 'man', boss: true, skin: SKIN, armor: '#6a5a8a', trim: '#a092c8', helm: 'helm', helmColor: '#4c4068', plume: '#e8e8f0', weapon: 'glaive', cape: '#4c4068' },
    xiahouDun:  { kind: 'horse', boss: true, skin: '#c89878', armor: '#2e4a3a', trim: '#5a8a6a', helmColor: '#1e3428', weapon: 'glaive', horse: '#4a3a2a', saddle: '#2e4a3a' },
    caoChun:    { kind: 'horse', boss: true, skin: SKIN, armor: '#a4742a', trim: '#e8b84a', helmColor: '#7a5418', weapon: 'spear', horse: '#2a2a32', saddle: '#e8b84a' },
    caiMao:     { kind: 'man', boss: true, skin: SKIN, armor: '#1e5a6e', trim: '#4a96b0', helm: 'helm', helmColor: '#143e4c', plume: '#4ad0e8', weapon: 'bow', cape: '#143e4c' },
    zhangRen:   { kind: 'man', boss: true, skin: SKIN, armor: '#4a5a3a', trim: '#7a9260', helm: 'helm', helmColor: '#324028', plume: '#c8e84a', weapon: 'bow', cape: '#324028' },
    xiahouYuan: { kind: 'horse', boss: true, skin: '#c89878', armor: '#7a2e2e', trim: '#c85a4a', helmColor: '#5a1e1e', weapon: 'spear', horse: '#8a6a3a', saddle: '#7a2e2e' },
    // 아군
    soldier:    { kind: 'man', skin: SKIN, armor: '#3a7d44', trim: '#6ab474', helm: 'helm', helmColor: '#2a5c32', weapon: 'spear', shield: '#2a5c32' },
    // 영웅
    liubei:     { kind: 'man', hero: true, skin: SKIN, armor: '#2e6a3a', trim: '#e8c83a', helm: 'crown', helmColor: '#e8c83a', weapon: 'sword', beard: '#3a2c1c', cape: '#e8c83a' },
    guanyu:     { kind: 'man', hero: true, skin: '#c84a3a', armor: '#1e5a2e', trim: '#e8c83a', helm: 'scarf', helmColor: '#1e4a26', weapon: 'glaive', beard: '#1a1a1a', beardLen: 4, cape: '#1e5a2e' },
    zhangfei:   { kind: 'man', hero: true, skin: '#a87858', armor: '#3a2e5a', trim: '#8a7ab8', helm: 'wild', helmColor: '#1a1a1a', weapon: 'spear', beard: '#1a1a1a', beardLen: 3, cape: '#2c2244' },
    zhaoyun:    { kind: 'man', hero: true, skin: SKIN, armor: '#d8dce8', trim: '#3a6ea5', helm: 'helm', helmColor: '#b8c0d4', plume: '#3a6ea5', weapon: 'spear', cape: '#3a6ea5' },
    zhugeliang: { kind: 'man', hero: true, skin: '#e8c8a0', armor: '#e8e4d8', trim: '#5a8a8a', helm: 'scholar', helmColor: '#3a5a5a', weapon: 'fan', beard: '#2a2a2a', beardLen: 2, cape: '#c8d4cc' },
  };

  function unit(key, frame) {
    const ck = `u:${key}:${frame}`;
    if (cache.has(ck)) return cache.get(ck);
    const def = UNIT_DEFS[key] || UNIT_DEFS.bandit;
    let c;
    if (def.kind === 'horse') c = mk(21, 19, 3, g => horseman(g, def, frame));
    else if (def.kind === 'siege') c = mk(20, 18, 3, g => siegeCart(g, def, frame));
    else c = mk(14, 19, 3, g => man(g, def, frame));
    cache.set(ck, c);
    return c;
  }

  /* ============================================================
     타워 스프라이트 (논리 30x34, 2배)
     ============================================================ */
  function pagodaRoof(g, cx, y, w, color) {
    // 위로 들린 처마의 동양식 지붕 한 단
    const d = shade(color, -45), l = shade(color, 30);
    px(g, cx - w / 2, y + 1, w, 2, color);
    px(g, cx - w / 2 - 1, y, 1, 2, d);
    px(g, cx + w / 2, y, 1, 2, d);
    px(g, cx - w / 2 - 2, y - 1, 1, 2, d); // 들린 처마
    px(g, cx + w / 2 + 1, y - 1, 1, 2, d);
    px(g, cx - w / 4, y, w / 2, 1, l);
  }

  const TOWER_BUILDERS = {
    archer: (g, lv) => {
      const wood = ['#8a6a42', '#7a6a52', '#6a5a44'][lv];
      const roof = ['#a23b2e', '#a23b2e', '#2e7a6a'][lv];
      // 석축 기단
      px(g, 7, 27, 16, 6, '#8a8a86'); px(g, 8, 28, 14, 2, '#a0a09a'); px(g, 7, 27, 16, 1, '#b0b0aa');
      // 목조 망루 기둥
      px(g, 9, 16, 2, 11, wood); px(g, 19, 16, 2, 11, wood);
      px(g, 8, 21, 14, 2, shade(wood, -25)); // 가로 보
      // 망루 칸
      px(g, 8, 12, 14, 6, shade(wood, 15));
      px(g, 9, 13, 12, 3, '#2c241a'); // 난간 안쪽
      // 궁수
      px(g, 13, 10, 4, 4, '#3a7d44'); px(g, 14, 8, 2, 2, SKIN); px(g, 17, 8, 1, 5, '#8a6d2a');
      // 지붕
      pagodaRoof(g, 15, 8, 18, roof);
      if (lv >= 1) pagodaRoof(g, 15, 4, 12, roof);
      if (lv >= 2) { pagodaRoof(g, 15, 1, 7, roof); px(g, 14, -1 + 1, 2, 1, '#e8c83a'); }
    },
    barracks: (g, lv) => {
      const wall = ['#9a8a6a', '#8a8276', '#7a7468'][lv];
      const roof = ['#7a8a4a', '#a23b2e', '#3a5a8a'][lv];
      // 본채
      px(g, 5, 17, 22, 14, wall);
      px(g, 5, 17, 22, 2, shade(wall, 25));
      px(g, 13, 23, 5, 8, '#3a2c1c'); // 문
      px(g, 14, 24, 3, 6, '#241c12');
      px(g, 7, 20, 4, 4, '#2c241a'); px(g, 20, 20, 4, 4, '#2c241a'); // 창
      // 지붕
      pagodaRoof(g, 16, 13, 26, roof);
      pagodaRoof(g, 16, 9, 16, roof);
      // 군기
      px(g, 25, 2, 1, 16, '#5a4632');
      px(g, 26, 2, 5, 4, ['#3a7d44', '#c8a830', '#a23b2e'][lv]);
      if (lv >= 2) { pagodaRoof(g, 16, 5, 9, roof); }
    },
    catapult: (g, lv) => {
      const wood = ['#7a5a36', '#6a523a', '#5a4a3e'][lv];
      // 받침대
      px(g, 6, 24, 20, 5, wood); px(g, 6, 24, 20, 1, shade(wood, 25));
      // 바퀴
      px(g, 7, 28, 5, 5, '#3a2c1c'); px(g, 8, 29, 3, 3, '#6a543a');
      px(g, 20, 28, 5, 5, '#3a2c1c'); px(g, 21, 29, 3, 3, '#6a543a');
      // 지지 프레임 (A자)
      px(g, 9, 14, 2, 10, wood); px(g, 21, 14, 2, 10, wood);
      px(g, 10, 12, 12, 2, shade(wood, -20));
      // 투척 팔
      g.save(); g.translate(16, 14); g.rotate(-0.6);
      px(g, -1, -12, 2, 14, shade(wood, 15));
      px(g, -3, -15, 6, 4, '#4a3a28'); // 바구니
      px(g, -2, -14, 4, 2, '#8a8a86'); // 돌
      g.restore();
      if (lv >= 1) { px(g, 8, 23, 2, 2, '#9aa4ac'); px(g, 22, 23, 2, 2, '#9aa4ac'); }
      if (lv >= 2) { px(g, 10, 11, 12, 1, '#e8c83a'); px(g, 15, 5, 2, 2, '#e8c83a'); }
    },
    fire: (g, lv) => {
      const stone = ['#8a7a6a', '#7a6a5e', '#5a5252'][lv];
      const roof = ['#a23b2e', '#8a2e3e', '#c8a830'][lv];
      // 석탑 기둥
      px(g, 10, 16, 12, 16, stone);
      px(g, 10, 16, 12, 2, shade(stone, 25));
      px(g, 12, 20, 8, 2, shade(stone, -30));
      px(g, 12, 26, 8, 2, shade(stone, -30));
      // 화로
      px(g, 8, 11, 16, 5, '#4a3a2a'); px(g, 9, 12, 14, 2, '#2c2018');
      // 불꽃
      px(g, 12, 6, 8, 5, '#e85a1e'); px(g, 13, 4, 6, 4, '#f0922e');
      px(g, 14, 2, 4, 4, '#f8c83a'); px(g, 15, 1, 2, 2, '#fff0a0');
      // 처마 장식
      pagodaRoof(g, 16, 15, 20, roof);
      if (lv >= 2) { px(g, 9, 9, 2, 2, '#f8c83a'); px(g, 21, 9, 2, 2, '#f8c83a'); }
    },
  };

  function tower(type, lv) {
    const ck = `t:${type}:${lv}`;
    if (cache.has(ck)) return cache.get(ck);
    const c = mk(32, 34, 2, g => TOWER_BUILDERS[type](g, lv));
    cache.set(ck, c);
    return c;
  }

  /* 건설 부지 표지 */
  function spot() {
    if (cache.has('spot')) return cache.get('spot');
    const c = mk(24, 22, 2, g => {
      px(g, 4, 14, 16, 6, '#9a8a6a'); px(g, 5, 15, 14, 4, '#b0a07c');
      px(g, 6, 16, 12, 2, '#8a7a5a');
      px(g, 11, 4, 1, 11, '#5a4632');
      px(g, 12, 4, 6, 4, '#c83a2a'); px(g, 12, 4, 6, 1, '#e85a3a');
    });
    cache.set('spot', c);
    return c;
  }

  /* ============================================================
     지형 렌더링 (스테이지당 1회)
     ============================================================ */
  function drawTree(g, x, y, r, type) {
    if (type === 'pine') {
      px(g, x - 1, y - 2, 3, 5, '#5a4328');
      for (let i = 0; i < 3; i++) {
        const w = 14 - i * 4, yy = y - 6 - i * 6;
        g.fillStyle = i % 2 ? '#2e6a3a' : '#256032';
        g.beginPath(); g.moveTo(x - w / 2, yy); g.lineTo(x + w / 2, yy); g.lineTo(x, yy - 8); g.fill();
      }
    } else if (type === 'round') {
      px(g, x - 1, y - 3, 3, 6, '#5a4328');
      g.fillStyle = '#2e7a3e';
      g.beginPath(); g.arc(x, y - 9, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3e9450';
      g.beginPath(); g.arc(x - 2, y - 11, 4, 0, Math.PI * 2); g.fill();
    } else if (type === 'bamboo') {
      for (let i = 0; i < 3; i++) {
        const bx = x + (i - 1) * 4;
        px(g, bx, y - 16 + i * 2, 2, 16 - i * 2, '#5a9a4a');
        px(g, bx, y - 10, 2, 1, '#3a6e30');
        px(g, bx - 2, y - 15 + i * 2, 3, 2, '#6ab45a');
      }
    } else if (type === 'rock') {
      g.fillStyle = '#8a8a82';
      g.beginPath(); g.arc(x, y, 5, Math.PI, 0); g.fill();
      px(g, x - 5, y - 1, 10, 2, '#8a8a82');
      px(g, x - 2, y - 4, 4, 2, '#a4a49a');
    } else if (type === 'tuft') {
      g.fillStyle = '#4a8a3a';
      for (let i = -2; i <= 2; i++) px(g, x + i * 2, y - 3 - Math.abs(i) * -1 + (i % 2), 1, 4);
    } else if (type === 'reed') {
      for (let i = 0; i < 3; i++) {
        px(g, x + i * 3 - 3, y - 10 + i, 1, 10 - i, '#6a8a4a');
        px(g, x + i * 3 - 3, y - 12 + i, 1, 3, '#a89a5a');
      }
    } else if (type === 'hut') {
      px(g, x - 8, y - 8, 16, 8, '#9a8a6a');
      px(g, x - 2, y - 5, 4, 5, '#3a2c1c');
      g.fillStyle = '#7a6a3a';
      g.beginPath(); g.moveTo(x - 11, y - 8); g.lineTo(x + 11, y - 8); g.lineTo(x, y - 16); g.fill();
    } else if (type === 'mtn') {
      g.fillStyle = '#6a6a72';
      g.beginPath(); g.moveTo(x - 18, y); g.lineTo(x + 18, y); g.lineTo(x, y - 22); g.fill();
      g.fillStyle = '#8a8a92';
      g.beginPath(); g.moveTo(x - 7, y - 13); g.lineTo(x + 7, y - 13); g.lineTo(x, y - 22); g.fill();
      g.fillStyle = '#e8e8ec';
      g.beginPath(); g.moveTo(x - 3, y - 18); g.lineTo(x + 3, y - 18); g.lineTo(x, y - 22); g.fill();
    }
  }

  /* 시작 군문(軍門) */
  function drawGate(g, x, y) {
    px(g, x - 16, y - 18, 4, 26, '#7a3a2a');
    px(g, x + 12, y - 18, 4, 26, '#7a3a2a');
    px(g, x - 20, y - 22, 40, 5, '#5a2a1e');
    px(g, x - 22, y - 24, 44, 3, '#8a4a32');
    px(g, x - 18, y - 25, 36, 2, '#a23b2e');
    px(g, x - 6, y - 21, 12, 3, '#e8c83a'); // 현판
  }
  /* 도착 요새 */
  function drawFortress(g, x, y) {
    // 성벽
    px(g, x - 26, y - 10, 52, 18, '#8a8a86');
    px(g, x - 26, y - 10, 52, 3, '#a0a09a');
    for (let i = 0; i < 6; i++) px(g, x - 26 + i * 9, y - 14, 5, 4, '#8a8a86'); // 성가퀴
    px(g, x - 7, y - 4, 14, 12, '#3a2c1c');
    g.fillStyle = '#2a2018'; g.beginPath(); g.arc(x, y - 4, 7, Math.PI, 0); g.fill();
    // 누각
    px(g, x - 14, y - 24, 28, 11, '#9a6a4a');
    px(g, x - 12, y - 22, 24, 7, '#6a4a32');
    pagodaRoof(g, x, y - 28, 34, '#2e6a5a');
    pagodaRoof(g, x, y - 34, 20, '#2e6a5a');
    // 깃발
    px(g, x - 1, y - 44, 1, 10, '#5a4632');
    px(g, x, y - 44, 7, 4, '#3a7d44');
    px(g, x, y - 44, 7, 1, '#e8c83a');
  }

  /* 테마별 잔디 색조 필터 / 장식 구성 */
  const THEME_TINT = {
    plain: null,
    forest: 'hue-rotate(12deg) brightness(0.9) saturate(1.1)',
    mountain: 'saturate(0.72) brightness(0.96)',
    river: 'hue-rotate(-8deg) saturate(1.05)',
  };
  const THEME_DECOS = {
    plain:    [['deco_tree', 56], ['deco_bush', 32], ['deco_rock', 38], ['deco_hut', 58], ['deco_tree', 50], ['deco_bush', 30]],
    forest:   [['deco_pine', 68], ['deco_tree', 56], ['deco_bamboo', 52], ['deco_pine', 60], ['deco_rock', 36], ['deco_bush', 30]],
    mountain: [['deco_mountain', 120], ['deco_pine', 62], ['deco_rock', 42], ['deco_rock', 34], ['deco_pine', 54], ['deco_bush', 28]],
    river:    [['deco_bamboo', 54], ['deco_tree', 52], ['deco_rock', 36], ['deco_bush', 30], ['deco_bamboo', 46], ['deco_hut', 54]],
  };

  function texturesReadyKey() {
    let k = '';
    for (const n of ['tex_grass', 'tex_dirt', 'tex_water']) k += TerrainTex.ready(n) ? '1' : '0';
    for (const n of ['deco_pine', 'deco_tree', 'deco_bamboo', 'deco_rock', 'deco_hut', 'deco_mountain', 'deco_bush', 'deco_gate', 'deco_fortress', 'deco_ship']) {
      k += (typeof SpriteImages !== 'undefined' && SpriteImages.variant(n, null)) ? '1' : '0';
    }
    return k;
  }
  let terrainReadyKey = '';

  function strokePathOn(g, path, wd, col) {
    g.strokeStyle = col; g.lineWidth = wd;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
    g.stroke();
  }

  function drawDecoSprite(g, name, x, y, h, flip, noShadow) {
    const img = SpriteImages.variant(name, null);
    if (!img) return false;
    const sc = h / img.height;
    const w = img.width * sc;
    if (noShadow) {
      // 수면 위: 어두운 반영
      g.fillStyle = 'rgba(10,24,40,0.3)';
      g.beginPath(); g.ellipse(x, y + 3, w * 0.4, w * 0.1, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = 'rgba(20,30,10,0.28)';
      g.beginPath(); g.ellipse(x, y + 2, w * 0.34, w * 0.13, 0, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, -w / 2, -h, w, h);
    g.restore();
    return true;
  }

  /* 장판교: 나무 다리 (수평/수직) */
  function drawBridge(g, b) {
    g.save();
    g.translate(b.x, b.y);
    if (!b.horizontal) g.rotate(Math.PI / 2);
    const L = b.len, HW = 31;
    // 교각 그림자/기둥
    g.fillStyle = 'rgba(20,15,8,0.35)';
    g.fillRect(-L / 2, HW + 2, L, 7);
    g.fillStyle = '#4a3520';
    for (let x = -L / 2 + 12; x < L / 2; x += 36) {
      g.fillRect(x - 4, HW - 4, 9, 16);
      g.fillRect(x - 4, -HW - 10, 9, 12);
    }
    // 상판
    const grad = g.createLinearGradient(0, -HW, 0, HW);
    grad.addColorStop(0, '#9a7a4e'); grad.addColorStop(0.5, '#8a6a42'); grad.addColorStop(1, '#75582f');
    g.fillStyle = grad;
    g.fillRect(-L / 2, -HW, L, HW * 2);
    // 판자 줄눈
    g.strokeStyle = 'rgba(55,38,18,0.5)'; g.lineWidth = 1.4;
    for (let x = -L / 2 + 9; x < L / 2; x += 9) {
      g.beginPath(); g.moveTo(x, -HW + 1); g.lineTo(x, HW - 1); g.stroke();
    }
    // 가장자리 보
    g.fillStyle = '#5e4426';
    g.fillRect(-L / 2, -HW - 3, L, 5);
    g.fillRect(-L / 2, HW - 2, L, 5);
    // 난간 기둥
    g.fillStyle = '#6a4a28';
    for (let x = -L / 2 + 6; x < L / 2; x += 24) {
      g.fillRect(x, -HW - 12, 5, 11);
      g.fillRect(x, HW + 1, 5, 9);
    }
    g.fillStyle = '#7a5a36';
    g.fillRect(-L / 2, -HW - 14, L, 4);
    g.restore();
  }

  /* 농경지: 이랑이 보이는 경작지 */
  function drawField(g, f, rnd) {
    g.save();
    g.translate(f.x, f.y);
    g.rotate(f.a || 0);
    g.fillStyle = 'rgba(178,150,92,0.92)';
    const r = 10;
    g.beginPath();
    g.moveTo(-f.w / 2 + r, -f.h / 2);
    g.arcTo(f.w / 2, -f.h / 2, f.w / 2, f.h / 2, r);
    g.arcTo(f.w / 2, f.h / 2, -f.w / 2, f.h / 2, r);
    g.arcTo(-f.w / 2, f.h / 2, -f.w / 2, -f.h / 2, r);
    g.arcTo(-f.w / 2, -f.h / 2, f.w / 2, -f.h / 2, r);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(95,72,38,0.5)'; g.lineWidth = 2; g.stroke();
    // 이랑
    g.strokeStyle = 'rgba(110,84,46,0.65)'; g.lineWidth = 2.4;
    for (let y = -f.h / 2 + 7; y < f.h / 2 - 3; y += 9) {
      g.beginPath(); g.moveTo(-f.w / 2 + 6, y); g.lineTo(f.w / 2 - 6, y); g.stroke();
    }
    // 새싹
    g.fillStyle = 'rgba(96,150,60,0.9)';
    for (let i = 0; i < f.w * f.h / 260; i++) {
      g.fillRect(-f.w / 2 + 8 + rnd() * (f.w - 16), -f.h / 2 + 5 + Math.floor(rnd() * (f.h / 9)) * 9, 2.5, 4);
    }
    g.restore();
  }

  /* 수면 채우기 (해안/강) + 물가 라인 */
  function fillWater(g, buildEdge, rnd) {
    const waterPat = TerrainTex.pattern(g, 'tex_water', 240);
    g.save();
    buildEdge(g);
    if (waterPat) { g.fillStyle = waterPat; g.globalAlpha = 0.95; g.fill(); g.globalAlpha = 1; }
    else { g.fillStyle = 'rgba(46,108,142,0.85)'; g.fill(); }
    // 깊이감
    g.clip();
    const dg = g.createLinearGradient(0, 0, 0, 600);
    dg.addColorStop(0, 'rgba(0,0,0,0)'); dg.addColorStop(1, 'rgba(8,28,52,0.35)');
    g.fillStyle = dg; g.fillRect(0, 0, 960, 600);
    g.restore();
  }

  function terrain(stage, pathPts) {
    const readyKey = texturesReadyKey();
    if (terrainStageId === stage.id && terrainCache && terrainReadyKey === readyKey) return terrainCache;
    terrainStageId = stage.id;
    terrainReadyKey = readyKey;
    const W = 960, H = 600;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rnd = mulberry32(stage.id * 7919 + 13);
    const th = stage.theme;
    const path = stage.path;

    /* 1) 바닥: 잔디 텍스처 (테마 색조) — 없으면 기존 절차 생성 */
    const grassPat = TerrainTex.pattern(g, 'tex_grass', 230, THEME_TINT[th.deco]);
    if (grassPat) {
      g.fillStyle = grassPat; g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = th.ground; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 1400; i++) {
        const x = rnd() * W, y = rnd() * H, sz = 3 + rnd() * 9;
        g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,240,0.035)' : 'rgba(0,20,0,0.05)';
        g.fillRect(x, y, sz, sz * 0.6);
      }
    }
    // 큰 명암 패치 (지형 입체감)
    for (let i = 0; i < 16; i++) {
      const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 130;
      const pg = g.createRadialGradient(x, y, 0, x, y, r);
      const tint = rnd() > 0.5 ? '255,250,200' : '5,35,15';
      pg.addColorStop(0, `rgba(${tint},0.10)`);
      pg.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = pg;
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
    }

    const map = stage.map || {};
    const inWater = (x, y) => {
      if (map.shoreY != null && y > map.shoreY - 10) return true;
      if (map.river && x > map.river.x0 - 12 && x < map.river.x1 + 12) return true;
      return false;
    };

    /* 1.4) 고원 단차: 절벽 림 + 능선 하이라이트로 높낮이 표현 */
    const hillEdges = []; // 길 경사 표식용 림 정보
    if (map.hills) for (const hl of map.hills) {
      const segs = 26;
      const pts = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const wob = 1 + (rnd() - 0.5) * 0.22;
        pts.push([hl.x + Math.cos(a) * hl.rx * wob, hl.y + Math.sin(a) * hl.ry * wob]);
      }
      hillEdges.push({ hl, pts });
      const blob = (gg) => {
        gg.beginPath();
        gg.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= segs; i++) {
          const p = pts[i % segs], q = pts[(i + 1) % segs];
          gg.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        gg.closePath();
      };
      // 고지대 면: 살짝 밝은 풀 + 위쪽으로 갈수록 밝아지는 경사 그라데이션
      g.save();
      blob(g);
      g.clip();
      g.fillStyle = 'rgba(235,240,205,0.10)';
      g.fillRect(hl.x - hl.rx * 1.4, hl.y - hl.ry * 1.4, hl.rx * 2.8, hl.ry * 2.8);
      const eg = g.createLinearGradient(0, hl.y - hl.ry, 0, hl.y + hl.ry);
      eg.addColorStop(0, 'rgba(255,255,225,0.14)');
      eg.addColorStop(1, 'rgba(15,28,8,0.16)');
      g.fillStyle = eg;
      g.fillRect(hl.x - hl.rx * 1.4, hl.y - hl.ry * 1.4, hl.rx * 2.8, hl.ry * 2.8);
      g.restore();
      // 림: 남측(아래)은 절벽 음영 + 빗금, 북측(위)은 능선 하이라이트
      g.save();
      blob(g);
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(48,36,14,0.42)';
      g.stroke();
      g.restore();
      for (let i = 0; i < segs; i++) {
        const p = pts[i];
        const a = Math.atan2(p[1] - hl.y, (p[0] - hl.x) * (hl.ry / hl.rx));
        if (Math.sin(a) > 0.15) {
          // 절벽 빗금 (아래쪽 림)
          g.strokeStyle = 'rgba(40,30,12,0.5)';
          g.lineWidth = 2;
          for (let k = -1; k <= 1; k++) {
            g.beginPath();
            g.moveTo(p[0] + k * 7, p[1]);
            g.lineTo(p[0] + k * 7 - 2, p[1] + 7 + rnd() * 4);
            g.stroke();
          }
        } else if (Math.sin(a) < -0.3) {
          g.strokeStyle = 'rgba(255,255,225,0.4)';
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(p[0] - 6, p[1] - 2);
          g.lineTo(p[0] + 6, p[1] - 1);
          g.stroke();
        }
      }
    }

    /* 1.5) 농경지 */
    if (map.fields) for (const f of map.fields) drawField(g, f, rnd);

    /* 1.6) 대형 수면: 해안(적벽) */
    if (map.shoreY != null) {
      const sy = map.shoreY;
      const edge = (gg) => {
        gg.beginPath();
        gg.moveTo(0, sy);
        for (let x = 0; x <= W; x += 48) {
          gg.quadraticCurveTo(x + 24, sy + ((x / 48) % 2 ? 14 : -9), x + 48, sy);
        }
        gg.lineTo(W, H); gg.lineTo(0, H); gg.closePath();
      };
      fillWater(g, edge, rnd);
      // 물가 모래톱 + 포말
      g.strokeStyle = 'rgba(214,196,150,0.85)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(0, sy);
      for (let x = 0; x <= W; x += 48) g.quadraticCurveTo(x + 24, sy + ((x / 48) % 2 ? 14 : -9), x + 48, sy);
      g.stroke();
      g.strokeStyle = 'rgba(240,250,250,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, sy + 7);
      for (let x = 0; x <= W; x += 48) g.quadraticCurveTo(x + 24, sy + 7 + ((x / 48) % 2 ? 14 : -9), x + 48, sy + 7);
      g.stroke();
      // 잔물결
      g.strokeStyle = 'rgba(235,245,245,0.3)'; g.lineWidth = 1.6;
      for (let i = 0; i < 26; i++) {
        const wx = rnd() * W, wy = sy + 26 + rnd() * (H - sy - 36);
        g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 11, wy - 3, wx + 22 + rnd() * 14, wy); g.stroke();
      }
    }
    /* 1.7) 대형 수면: 강(장판파) */
    if (map.river) {
      const { x0, x1 } = map.river;
      const edge = (gg) => {
        gg.beginPath();
        gg.moveTo(x0, 0);
        for (let y = 0; y <= H; y += 52) gg.quadraticCurveTo(x0 + ((y / 52) % 2 ? 10 : -7), y + 26, x0, y + 52);
        gg.lineTo(x1, H);
        for (let y = H; y >= 0; y -= 52) gg.quadraticCurveTo(x1 + ((y / 52) % 2 ? -9 : 8), y - 26, x1, y - 52);
        gg.closePath();
      };
      fillWater(g, edge, rnd);
      for (const bx of [x0, x1]) {
        g.strokeStyle = 'rgba(214,196,150,0.8)'; g.lineWidth = 4.5;
        g.beginPath(); g.moveTo(bx, 0);
        for (let y = 0; y <= H; y += 52) g.quadraticCurveTo(bx + ((y / 52) % 2 ? 10 : -7) * (bx === x0 ? 1 : -1), y + 26, bx, y + 52);
        g.stroke();
      }
      g.strokeStyle = 'rgba(235,245,245,0.3)'; g.lineWidth = 1.6;
      for (let i = 0; i < 14; i++) {
        const wx = x0 + 12 + rnd() * (x1 - x0 - 26), wy = rnd() * H;
        g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 9, wy - 3, wx + 18, wy); g.stroke();
      }
    }

    /* 2) 강 테마: 물 텍스처 가장자리 (전용 수면 명세가 없을 때만) */
    if (th.deco === 'river' && map.shoreY == null) {
      const waterPat = TerrainTex.pattern(g, 'tex_water', 240);
      g.save();
      g.beginPath();
      g.moveTo(0, H - 78);
      for (let x = 0; x <= W; x += 40) g.quadraticCurveTo(x + 20, H - 78 + (((x / 40) % 2) ? 12 : -6), x + 40, H - 78);
      g.lineTo(W, H); g.lineTo(0, H); g.closePath();
      if (waterPat) { g.fillStyle = waterPat; g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1; }
      else { g.fillStyle = 'rgba(40,100,140,0.6)'; g.fill(); }
      g.restore();
      g.strokeStyle = 'rgba(230,240,235,0.5)'; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(0, H - 78);
      for (let x = 0; x <= W; x += 40) g.quadraticCurveTo(x + 20, H - 78 + (((x / 40) % 2) ? 12 : -6), x + 40, H - 78);
      g.stroke();
    }

    /* 3) 길: 흙 텍스처를 마스크로 깔고 가장자리 디테일 */
    strokePathOn(g, path, 56, 'rgba(30,22,8,0.30)'); // 부드러운 외곽 음영
    strokePathOn(g, path, 49, 'rgba(58,42,20,0.55)'); // 진한 테두리
    const dirtPat = TerrainTex.pattern(g, 'tex_dirt', 240);
    if (dirtPat) {
      const m = document.createElement('canvas');
      m.width = W; m.height = H;
      const mg = m.getContext('2d');
      strokePathOn(mg, path, 44, '#fff');
      mg.globalCompositeOperation = 'source-in';
      mg.fillStyle = TerrainTex.pattern(mg, 'tex_dirt', 240);
      mg.fillRect(0, 0, W, H);
      g.drawImage(m, 0, 0);
    } else {
      strokePathOn(g, path, 44, th.path);
      strokePathOn(g, path, 28, shade(th.path.startsWith('#') ? th.path : '#c2a878', 12));
    }
    // 다리 (강을 건너는 구간)
    if (map.bridge) drawBridge(g, map.bridge);

    // 닳은 중앙 자국 + 수레바퀴 홈
    strokePathOn(g, path, 13, 'rgba(255,238,190,0.10)');
    strokePathOn(g, path, 30, 'rgba(60,40,15,0.07)');
    // 오르막/내리막 표식: 길이 고원 림을 통과하는 지점에 계단 밴드
    if (map.hills && hillEdges.length) {
      for (const { hl } of hillEdges) {
        for (let i = 1; i < pathPts.length - 1; i++) {
          const p = pathPts[i];
          const nd = Math.hypot((p.x - hl.x) / hl.rx, (p.y - hl.y) / hl.ry);
          if (nd < 0.93 || nd > 1.07) continue;
          const q = pathPts[i + 1];
          const ang = Math.atan2(q.y - p.y, q.x - p.x);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(ang);
          for (let k = 0; k < 4; k++) {
            g.strokeStyle = k % 2 ? 'rgba(70,50,22,0.55)' : 'rgba(235,215,170,0.5)';
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(k * 6 - 9, -19);
            g.lineTo(k * 6 - 9, 19);
            g.stroke();
          }
          g.restore();
          i += 2; // 같은 림에서 과밀 방지
        }
      }
    }

    // 길가 디테일: 자갈, 풀 돋움
    for (const p of pathPts) {
      if (inWater(p.x, p.y)) continue;
      if (rnd() < 0.55) {
        const a = rnd() * Math.PI * 2, d = 14 + rnd() * 9;
        g.fillStyle = `rgba(${100 + rnd() * 40 | 0},${80 + rnd() * 30 | 0},${50 + rnd() * 20 | 0},${0.4 + rnd() * 0.3})`;
        g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.6 + rnd() * 1.8, 1.1 + rnd() * 1.2, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      if (rnd() < 0.3) {
        const side = rnd() > 0.5 ? 1 : -1;
        const a = rnd() * Math.PI * 2;
        const gx = p.x + Math.cos(a) * 24 * side, gy = p.y + Math.sin(a) * 24 * side;
        g.strokeStyle = `rgba(60,${110 + rnd() * 40 | 0},45,0.55)`;
        g.lineWidth = 1.4;
        for (let b = 0; b < 3; b++) {
          g.beginPath();
          g.moveTo(gx + b * 2 - 2, gy + 2);
          g.quadraticCurveTo(gx + b * 2 - 2 + (rnd() - 0.5) * 3, gy - 3, gx + b * 2 - 3 + (rnd() - 0.5) * 4, gy - 6 - rnd() * 3);
          g.stroke();
        }
      }
    }

    /* 4) 장식: 일러스트 스프라이트 (없으면 절차 생성 폴백) */
    const decos = THEME_DECOS[th.deco] || THEME_DECOS.plain;
    const fallback = {
      plain: ['round', 'tuft', 'rock', 'hut', 'tuft', 'round', 'tuft'],
      forest: ['pine', 'round', 'pine', 'tuft', 'rock', 'pine', 'bamboo'],
      mountain: ['mtn', 'pine', 'rock', 'rock', 'pine', 'tuft', 'mtn'],
      river: ['reed', 'round', 'reed', 'rock', 'tuft', 'bamboo', 'reed'],
    }[th.deco] || ['tuft'];
    /* 스프라이트 실제 점유 영역(폭≈높이*0.9, 위로 h)을 기준으로 길/부지 차단 검사 */
    const blocksPath = (x, y, h) =>
      pathPts.some(p => Math.abs(p.x - x) < h * 0.45 + 27 && p.y > y - h - 8 && p.y < y + 16);
    const blocksSpot = (x, y, h) =>
      stage.spots.some(sp => Math.abs(sp[0] - x) < h * 0.45 + 28 && sp[1] > y - h - 8 && sp[1] < y + 22);
    const canPlace = (x, y, h) => !inWater(x, y) && !blocksPath(x, y, h) && !blocksSpot(x, y, h);
    const clearOf = (x, y, r) =>
      !inWater(x, y) &&
      !stage.spots.some(sp => Math.hypot(sp[0] - x, sp[1] - y) < r + 30) &&
      !pathPts.some(p => Math.hypot(p.x - x, p.y - y) < r + 26);
    const placed = [];

    /* 시나리오 대형 지형 */
    if (map.ranges) for (const rg of map.ranges) {
      const [a, b] = rg.along;
      for (let i = 0; i < rg.n; i++) {
        const t = rg.n === 1 ? 0.5 : i / (rg.n - 1);
        const x = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 56;
        const y = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 30;
        const hh = rg.h * (0.8 + rnd() * 0.4);
        if (!canPlace(x, y, hh)) continue;
        placed.push({ name: rg.kind, x, y, h: hh, flip: rnd() > 0.5 });
      }
    }
    if (map.forests) for (const fo of map.forests) {
      for (let i = 0; i < fo.n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * fo.r;
        const x = fo.x + Math.cos(a) * d, y = fo.y + Math.sin(a) * d * 0.7;
        const hh = 50 + rnd() * 34;
        if (!canPlace(x, y, hh)) continue;
        placed.push({ name: fo.kind, x, y, h: hh, flip: rnd() > 0.5 });
      }
    }
    if (map.villages) for (const vg of map.villages) {
      for (let i = 0; i < vg.n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * vg.r;
        const x = vg.x + Math.cos(a) * d, y = vg.y + Math.sin(a) * d * 0.7;
        const hh = 52 + rnd() * 16;
        if (!canPlace(x, y, hh)) continue;
        placed.push({ name: 'deco_hut', x, y, h: hh, flip: rnd() > 0.5 });
      }
    }
    if (map.ships) for (const sh of map.ships) {
      placed.push({ name: 'deco_ship', x: sh.x, y: sh.y, h: sh.h, flip: !!sh.flip, noShadow: true });
    }
    let tries = 0;
    // 가장자리에 큰 장식(산/숲) 우선 배치
    while (placed.length < 14 && tries < 260) {
      tries++;
      const edge = Math.floor(rnd() * 4);
      const x = edge === 0 ? 16 + rnd() * 70 : edge === 1 ? W - 16 - rnd() * 70 : 20 + rnd() * (W - 40);
      const y = edge === 2 ? 22 + rnd() * 60 : edge === 3 ? H - 14 - rnd() * 55 : 30 + rnd() * (H - 60);
      const [name, baseH] = decos[Math.floor(rnd() * 2)]; // 테마 대표 장식
      const hh = baseH * (0.85 + rnd() * 0.45);
      if (!canPlace(x, y, hh)) continue;
      placed.push({ name, x, y, h: hh, flip: rnd() > 0.5 });
    }
    // 내부 산포
    tries = 0;
    while (placed.length < 52 && tries < 600) {
      tries++;
      const x = 20 + rnd() * (W - 40), y = 30 + rnd() * (H - 44);
      const [name, baseH] = decos[Math.floor(rnd() * decos.length)];
      const hh = baseH * (0.7 + rnd() * 0.55);
      if (!canPlace(x, y, hh)) continue;
      placed.push({ name, x, y, h: hh, flip: rnd() > 0.5 });
    }
    placed.sort((a, b) => a.y - b.y);
    let fbIdx = 0;
    for (const d of placed) {
      if (!drawDecoSprite(g, d.name, d.x, d.y, d.h, d.flip, d.noShadow)) {
        if (!d.noShadow) drawTree(g, d.x, d.y, 0, fallback[(fbIdx++) % fallback.length]);
      }
    }
    // 들꽃 (잔디 위 점묘)
    for (let i = 0; i < 64; i++) {
      const x = rnd() * W, y = rnd() * H;
      if (inWater(x, y) || pathPts.some(p => Math.hypot(p.x - x, p.y - y) < 26)) continue;
      g.fillStyle = ['#e8c84a', '#e87a6a', '#f0f0e0', '#c87ae0'][Math.floor(rnd() * 4)];
      g.fillRect(x, y, 2, 2);
    }

    /* 5) 출발 군문 / 도착 요새 (일러스트 우선) */
    const s0 = path[0], e0 = path[path.length - 1];
    const gx = Math.max(40, Math.min(W - 40, s0[0])), gy = Math.max(54, Math.min(H - 8, s0[1] + 26));
    const fx = Math.max(50, Math.min(W - 50, e0[0])), fy = Math.max(64, Math.min(H - 8, e0[1] + 30));
    if (!drawDecoSprite(g, 'deco_gate', gx, gy, 86, false)) drawGate(g, gx, gy - 26);
    if (!drawDecoSprite(g, 'deco_fortress', fx, fy, 104, false)) drawFortress(g, fx, fy - 30);

    /* 6) 비네트 */
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(10,5,0,0.34)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);

    terrainCache = c;
    return c;
  }

  function invalidate() { terrainStageId = -1; terrainCache = null; }

  return { unit, tower, spot, terrain, invalidate, shade };
})();

/* ============================================================
   지형 텍스처 로더 (잔디/흙길/물 — 시임리스 타일 패턴)
   ============================================================ */
const TerrainTex = (() => {
  const NAMES = ['tex_grass', 'tex_dirt', 'tex_water'];
  const store = {};
  const patCache = new Map();
  const hasImage = typeof Image !== 'undefined';
  for (const name of NAMES) {
    if (!hasImage) { store[name] = { ready: false }; continue; }
    const img = new Image();
    const entry = { img, ready: false };
    img.onload = () => { entry.ready = true; };
    img.onerror = () => { entry.ready = false; };
    img.src = `assets/img/${name}.png`;
    store[name] = entry;
  }
  /* 타일 크기/필터 변형을 적용한 캔버스 패턴 */
  function pattern(g, name, tile = 220, filter = null) {
    const e = store[name];
    if (!e || !e.ready) return null;
    const key = `${name}|${tile}|${filter || ''}`;
    let c = patCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = tile; c.height = tile;
      const cg = c.getContext('2d');
      if (filter) cg.filter = filter;
      cg.imageSmoothingEnabled = true;
      cg.drawImage(e.img, 0, 0, tile, tile);
      patCache.set(key, c);
    }
    return g.createPattern(c, 'repeat');
  }
  function ready(name) { const e = store[name]; return !!(e && e.ready); }
  return { pattern, ready };
})();

/* ============================================================
   일러스트 스프라이트 로더 (assets/img/*.png, 없으면 픽셀아트 폴백)
   - 알파 바운딩박스를 계산해 여백을 자동 트림
   - hue-rotate 등 CSS 필터 변형을 오프스크린에 1회 렌더해 캐시
   ============================================================ */
const SpriteImages = (() => {
  const NAMES = [
    'tower_archer', 'tower_barracks', 'tower_catapult', 'tower_fire',
    'unit_yellowturban', 'unit_infantry', 'unit_archer', 'unit_cavalry',
    'unit_siege', 'unit_soldier', 'unit_general',
    'hero_liubei', 'hero_guanyu', 'hero_zhangfei', 'hero_zhaoyun', 'hero_zhugeliang',
    'deco_pine', 'deco_tree', 'deco_bamboo', 'deco_rock', 'deco_hut',
    'deco_mountain', 'deco_bush', 'deco_gate', 'deco_fortress', 'deco_ship',
  ];
  const store = {};   // name -> { img, ready, bx, by, bw, bh }
  const varCache = new Map();

  function trimBox(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
      for (let y = 0; y < c.height; y += 2) {
        for (let x = 0; x < c.width; x += 2) {
          if (d[(y * c.width + x) * 4 + 3] > 24) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX <= minX || maxY <= minY) return { bx: 0, by: 0, bw: img.width, bh: img.height };
      return { bx: minX, by: minY, bw: maxX - minX + 2, bh: maxY - minY + 2 };
    } catch (e) {
      return { bx: 0, by: 0, bw: img.width, bh: img.height };
    }
  }

  const hasImage = typeof Image !== 'undefined';
  for (const name of NAMES) {
    if (!hasImage) { store[name] = { ready: false }; continue; }
    const img = new Image();
    const entry = { img, ready: false, bx: 0, by: 0, bw: 0, bh: 0 };
    img.onload = () => { Object.assign(entry, trimBox(img)); entry.ready = true; };
    img.onerror = () => { entry.ready = false; };
    img.src = `assets/img/${name}.png`;
    store[name] = entry;
  }

  /* 변형 스프라이트: 트림된 영역을 (필터 적용해) 오프스크린에 굽는다 */
  function variant(name, filter) {
    const e = store[name];
    if (!e || !e.ready) return null;
    const key = name + '|' + (filter || '');
    if (varCache.has(key)) return varCache.get(key);
    const c = document.createElement('canvas');
    c.width = e.bw; c.height = e.bh;
    const g = c.getContext('2d');
    if (filter) g.filter = filter;
    g.drawImage(e.img, e.bx, e.by, e.bw, e.bh, 0, 0, e.bw, e.bh);
    varCache.set(key, c);
    return c;
  }

  return { variant };
})();
