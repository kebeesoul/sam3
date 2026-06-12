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

  function terrain(stage, pathPts) {
    if (terrainStageId === stage.id && terrainCache) return terrainCache;
    terrainStageId = stage.id;
    const W = 960, H = 600;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rnd = mulberry32(stage.id * 7919 + 13);
    const th = stage.theme;

    // 1) 바닥: 두 톤 체커 + 노이즈 패치
    g.fillStyle = th.ground;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * W, y = rnd() * H, s = 3 + rnd() * 9;
      g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,240,0.035)' : 'rgba(0,20,0,0.05)';
      g.fillRect(x, y, s, s * 0.6);
    }
    // 큰 명암 패치 (지형 입체감)
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 120;
      const pg = g.createRadialGradient(x, y, 0, x, y, r);
      const tint = rnd() > 0.5 ? '255,250,210' : '10,40,20';
      pg.addColorStop(0, `rgba(${tint},0.10)`);
      pg.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = pg;
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
    }
    // 들꽃
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = rnd() * H;
      g.fillStyle = ['#e8c84a', '#e87a6a', '#f0f0e0', '#c87ae0'][Math.floor(rnd() * 4)];
      g.fillRect(x, y, 2, 2);
      g.fillStyle = 'rgba(20,60,20,0.5)';
      g.fillRect(x, y + 2, 1, 3);
    }
    // 풀 무늬
    g.fillStyle = 'rgba(0,40,0,0.12)';
    for (let i = 0; i < 320; i++) {
      const x = rnd() * W, y = rnd() * H;
      g.fillRect(x, y, 2, 4); g.fillRect(x + 3, y + 1, 2, 3);
    }
    // 강 테마: 화면 가장자리 물
    if (th.deco === 'river') {
      const grad = g.createLinearGradient(0, H - 90, 0, H);
      grad.addColorStop(0, 'rgba(30,90,130,0)');
      grad.addColorStop(1, 'rgba(30,90,130,0.55)');
      g.fillStyle = grad; g.fillRect(0, H - 90, W, 90);
      g.fillStyle = 'rgba(180,220,240,0.25)';
      for (let i = 0; i < 40; i++) g.fillRect(rnd() * W, H - 60 + rnd() * 55, 10 + rnd() * 18, 2);
    }

    // 2) 길
    const path = stage.path;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const stroke = (wd, col) => {
      g.strokeStyle = col; g.lineWidth = wd;
      g.beginPath(); g.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
      g.stroke();
    };
    stroke(50, 'rgba(0,0,0,0.25)');
    stroke(44, shade(th.path.startsWith('#') ? th.path : '#c2a878', -35));
    stroke(38, th.path);
    stroke(26, shade(th.path.startsWith('#') ? th.path : '#c2a878', 12));
    // 자갈/바퀴자국
    for (const p of pathPts) {
      if (rnd() < 0.4) {
        g.fillStyle = `rgba(90,70,40,${0.15 + rnd() * 0.2})`;
        g.fillRect(p.x + (rnd() - 0.5) * 22, p.y + (rnd() - 0.5) * 22, 3 + rnd() * 3, 2 + rnd() * 2);
      }
    }

    // 3) 장식
    const decos = {
      plain:    ['round', 'tuft', 'rock', 'hut', 'tuft', 'round', 'tuft'],
      forest:   ['pine', 'round', 'pine', 'tuft', 'rock', 'pine', 'bamboo'],
      mountain: ['mtn', 'pine', 'rock', 'rock', 'pine', 'tuft', 'mtn'],
      river:    ['reed', 'round', 'reed', 'rock', 'tuft', 'bamboo', 'reed'],
    }[th.deco] || ['tuft'];
    const clearOf = (x, y) =>
      !stage.spots.some(s => Math.hypot(s[0] - x, s[1] - y) < 46) &&
      !pathPts.some(p => Math.hypot(p.x - x, p.y - y) < 42);
    let placed = 0, tries = 0;
    while (placed < 44 && tries < 520) {
      tries++;
      const x = 20 + rnd() * (W - 40), y = 30 + rnd() * (H - 40);
      if (!clearOf(x, y)) continue;
      drawTree(g, x, y, 0, decos[Math.floor(rnd() * decos.length)]);
      placed++;
    }

    // 4) 출발 군문 / 도착 요새
    const s0 = path[0], e0 = path[path.length - 1];
    drawGate(g, Math.max(34, Math.min(W - 34, s0[0])), Math.max(40, Math.min(H - 12, s0[1])));
    drawFortress(g, Math.max(40, Math.min(W - 40, e0[0])), Math.max(50, Math.min(H - 16, e0[1])));

    // 5) 비네트
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
