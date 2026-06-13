/* ============================================================
   삼국지 디펜스 - 게임 엔진
   ============================================================ */

const W = 960, H = 600;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const rand = (a, b) => a + Math.random() * (b - a);
const rollDmg = (d) => rand(d[0], d[1]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- 저장 / 진행 상황 ---------------- */
const SAVE_KEY = 'sam3-defense-save';
function loadSave() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* 무시 */ }
  s = s || {};
  return {
    cleared: s.cleared ?? -1,
    stars: s.stars || {},
    heroXp: s.heroXp || {},        // 영웅별 누적 경험치
    challenges: s.challenges || {}, // 스테이지별 도전 과제 달성 여부
    muted: !!s.muted,
  };
}
function persistSave() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
let save = loadSave();

/* ---------------- 영웅 레벨 ---------------- */
const HERO_MAX_LEVEL = 10;
// 레벨 l → l+1 에 필요한 누적 경험치
function xpForLevel(l) { return 50 * l * l; }
function heroLevel(xp) {
  let l = 1;
  while (l < HERO_MAX_LEVEL && xp >= xpForLevel(l)) l++;
  return l;
}
function heroStatMul(level) { return 1 + (level - 1) * 0.08; }

/* ---------------- 도전 과제 ---------------- */
const CHALLENGES = [
  { id: 'perfect',  icon: '🛡️', name: '완벽 방어',  desc: '목숨을 하나도 잃지 않고 승리' },
  { id: 'immortal', icon: '⚔️', name: '불사 영웅',  desc: '영웅이 한 번도 쓰러지지 않고 승리' },
  { id: 'rush',     icon: '⏱️', name: '속전속결',  desc: '모든 공세를 조기 소집하여 승리' },
];

// 터치 기기에서는 클릭 판정 반경을 넓힌다
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const HIT_R = COARSE ? 32 : 22;
const WAVE_GAP = 10; // '다음 공세까지' 제한 시간(초)

// 타격감: 크리티컬 / 히트스톱
const CRIT_CHANCE = 0.15, CRIT_MULT = 1.9;

/* ---------------- 전투 소모 보급기 (킹덤러쉬식) ---------------- */
const ABILITIES = {
  fire:  { name: '화계(火計)', icon: '🔥', cd: 60, radius: 95, dmg: 110, burn: 12,
           desc: '지정 지점에 불벼락을 떨궈 광역 화염 피해 (쿨타임 60초)' },
  reinf: { name: '원군(援軍)', icon: '🛡️', cd: 120, count: 3, hp: 130, dmg: [8, 13], life: 14,
           desc: '지정 지점에 임시 의용군 3명을 소환 (쿨타임 120초)' },
};

/* ---------------- 게임 상태 ---------------- */
let G = null;          // 현재 스테이지 런타임 상태
let screen = 'title';  // title | map | dialogue | game
let lastTime = 0;

function newGameState(stage) {
  const paths = stage.paths || [stage.path];
  return {
    stage,
    paths,
    gold: stage.gold,
    lives: stage.lives,
    waveIdx: -1,            // 아직 시작 전
    waveTimer: WAVE_GAP,    // 다음 웨이브까지 남은 시간 (최대 10초)
    spawnQueue: [],
    enemies: [],
    towers: stage.spots.map((s, i) => ({ spotIdx: i, x: s[0], y: s[1], type: null, level: 0, cooldown: 0, soldiers: [] })),
    projectiles: [],
    effects: [],
    floaters: [],
    parts: [],
    hero: null,
    selected: null,         // 선택된 건설부지/타워 인덱스
    speed: 1,
    paused: false,
    over: false,
    won: false,
    time: 0,
    shake: 0,
    hitstop: 0,
    heroDeaths: 0,
    earlyCalls: 0,
    combo: 0,
    comboT: 0,
    moraleT: 0,
    reinf: [],
    abilities: { fire: { cd: ABILITIES.fire.cd }, reinf: { cd: ABILITIES.reinf.cd } },
    aiming: null,
    aimX: W / 2, aimY: H / 2,
  };
}

/* ---------------- 경로 도우미 ---------------- */
function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]);
  return len;
}
function pointAt(path, d) {
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]);
    if (d <= seg) {
      const t = seg === 0 ? 0 : d / seg;
      return { x: path[i-1][0] + (path[i][0] - path[i-1][0]) * t,
               y: path[i-1][1] + (path[i][1] - path[i-1][1]) * t };
    }
    d -= seg;
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1] };
}

/* ---------------- 적 생성 ---------------- */
// 난이도 글로벌 배수 (전반적 상향)
const ENEMY_HP_MUL = 1.15, ENEMY_DMG_MUL = 1.3, BOSS_HP_MUL = 1.8, BOSS_DMG_MUL = 1.25, TOWER_DMG_MUL = 0.9;
function makeEnemy(typeId, pathId = 0) {
  const base = ENEMY_TYPES[typeId] || BOSS_TYPES[typeId];
  const isBoss = !!BOSS_TYPES[typeId];
  const path = G.paths[pathId] || G.paths[0];
  const hpScale = isBoss ? BOSS_HP_MUL : (1.08 + G.stage.id * 0.07) * ENEMY_HP_MUL;
  const hp = Math.round(base.hp * hpScale);
  const dm = isBoss ? BOSS_DMG_MUL : ENEMY_DMG_MUL;
  const dmg = [base.dmg[0] * dm, base.dmg[1] * dm];
  return {
    typeId, ...base,
    isBoss, dmg, pathId, path,
    hp, maxHp: hp,
    progress: 0,
    x: path[0][0], y: path[0][1],
    slow: 0, stun: 0, burn: 0, burnTime: 0, flash: 0,
    blocker: null,
    atkCd: 0,
    skillCd: isBoss ? 6 : 0,
    rage: 1,
    wobble: Math.random() * Math.PI * 2,
    dead: false, escaped: false,
  };
}

function queueWave(waveIdx) {
  const wave = G.stage.waves[waveIdx];
  const np = G.paths.length;
  for (const [type, count, interval, delay, pathId] of wave) {
    for (let i = 0; i < count; i++) {
      // 경로가 여럿이면 그룹을 입구에 라운드로빈 분산 (보스는 0번 경로)
      const pid = pathId != null ? pathId : (BOSS_TYPES[type] ? 0 : (np > 1 ? i % np : 0));
      G.spawnQueue.push({ type, at: G.time + delay + i * interval, pathId: pid });
    }
  }
  G.spawnQueue.sort((a, b) => a.at - b.at);
}

/* ---------------- 아군 보병 / 영웅 ---------------- */
function makeSoldier(tower, lv, idx, count) {
  const rp = tower.rally || nearestPathPoint(tower.x, tower.y);
  const n = count || lv.count || 2;
  const ang = n <= 1 ? 0 : idx * (Math.PI * 2 / n) + Math.PI / 2;
  const rad = n >= 3 ? 18 : 14;
  return {
    kind: 'soldier', tower, idx,
    hp: lv.soldierHp, maxHp: lv.soldierHp, dmg: lv.soldierDmg,
    x: rp.x + Math.cos(ang) * rad, y: rp.y + Math.sin(ang) * rad,
    homeOff: ang, anchorRad: rad,
    target: null, atkCd: 0, dead: false, respawnT: 0,
  };
}
function nearestPathPoint(x, y) {
  let best = null, bestD = Infinity;
  for (const path of G.paths) {
    const total = pathLength(path);
    for (let d = 0; d <= total; d += 10) {
      const p = pointAt(path, d);
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < bestD) { bestD = dd; best = { x: p.x, y: p.y, d }; }
    }
  }
  return best;
}

/* 막사 사거리 안에서 창병 집결지를 옮긴다 (경로 위로 스냅) */
function setRally(t, x, y) {
  const range = TOWER_TYPES.barracks.levels[t.level].range;
  let best = null, bestD = Infinity;
  for (const path of G.paths) {
    const total = pathLength(path);
    for (let d = 0; d <= total; d += 8) {
      const p = pointAt(path, d);
      if (Math.hypot(p.x - t.x, p.y - t.y) > range) continue;
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < bestD) { bestD = dd; best = { x: p.x, y: p.y, d }; }
    }
  }
  if (!best) {
    // 사거리 안에 경로가 없으면 클릭 지점을 사거리로 클램프
    const a = Math.atan2(y - t.y, x - t.x);
    const r = Math.min(Math.hypot(x - t.x, y - t.y), range);
    best = { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r };
  }
  t.rally = best;
}

function spawnHero(heroId) {
  const def = HEROES[heroId];
  const start = pointAt(G.paths[0], pathLength(G.paths[0]) * 0.65);
  const xp = save.heroXp[heroId] || 0;
  const level = heroLevel(xp);
  let mul = heroStatMul(level);
  // 이 전장의 인연(특수 영웅): 능력 강화
  const special = G.stage.specialHero === heroId;
  const hpBuff = special ? 1.3 : 1, dmgBuff = special ? 1.25 : 1;
  G.hero = {
    kind: 'hero', def,
    level, xp, special,
    maxHp: Math.round(def.hp * mul * hpBuff), hp: Math.round(def.hp * mul * hpBuff),
    dmgScaled: [def.dmg[0] * mul * dmgBuff, def.dmg[1] * mul * dmgBuff],
    ultMul: (1 + (level - 1) * 0.06) * (special ? 1.2 : 1),
    ultCdMul: special ? 0.75 : 1,
    x: start.x, y: start.y - 40, tx: start.x, ty: start.y - 40,
    target: null, atkCd: 0,
    ultCd: 0, dead: false, respawnT: 0,
  };
}

function gainHeroXp(amount) {
  const h = G.hero;
  if (!h || amount <= 0) return;
  const before = h.level;
  h.xp += amount;
  const after = heroLevel(h.xp);
  if (after > before) {
    h.level = after;
    const mul = heroStatMul(after);
    h.maxHp = Math.round(h.def.hp * mul);
    h.hp = h.maxHp; // 레벨업 시 완전 회복
    h.dmgScaled = [h.def.dmg[0] * mul, h.def.dmg[1] * mul];
    h.ultMul = 1 + (after - 1) * 0.06;
    addFloater(h.x, h.y - 36, `LEVEL UP! Lv.${after}`, '#ffd700', 18);
    addEffect('ring', h.x, h.y, 0.6, { radius: 60, color: '#ffd700' });
    AudioSys.play('levelup');
  }
  save.heroXp[h.def.id] = h.xp;
}

/* ---------------- 전투 처리 ---------------- */
function dealDamage(enemy, amount, opts = {}) {
  if (enemy.dead) return;
  const crit = opts.crit || (opts.canCrit && Math.random() < CRIT_CHANCE);
  let dmg = amount * (crit ? CRIT_MULT : 1);
  if (!opts.magic) dmg *= (1 - (enemy.shielded ? 0.9 : enemy.armor));
  enemy.hp -= dmg;
  enemy.flash = 0.1;
  if (opts.burn) { enemy.burn = Math.max(enemy.burn, opts.burn); enemy.burnTime = 3; }
  if (opts.stun) enemy.stun = Math.max(enemy.stun, opts.stun);
  if (!enemy.isBoss && !enemy.noFight && enemy.hp > 0) {
    enemy.progress = Math.max(0, enemy.progress - (crit ? 5 : 2));
  }
  if (opts.canCrit || opts.showDmg) {
    if (crit) {
      addFloater(enemy.x + rand(-6, 6), enemy.y - 34, `${Math.round(dmg)}!`, '#ff5a3a', 19);
      G.hitstop = Math.max(G.hitstop, 0.05);
      G.shake = Math.max(G.shake, 0.18);
      spawnParts(enemy.x, enemy.y - 12, 5, { color: ['#ffd75e', '#ff7a4a'], size: 3, speed: 90, up: 30, life: 0.4 });
    } else {
      addFloater(enemy.x + rand(-5, 5), enemy.y - 30, `${Math.round(dmg)}`, '#fff', 12);
    }
  }
  if (enemy.hp <= 0) {
    enemy.dead = true;
    G.gold += enemy.bounty;
    addFloater(enemy.x, enemy.y, `+${enemy.bounty}`, '#ffd700');
    addEffect('poof', enemy.x, enemy.y, 0.4);
    spawnParts(enemy.x, enemy.y - 6, 6, { color: ['#c8b89a', '#a89878', '#888'], size: 3, speed: 50, up: 40, life: 0.5 });
    AudioSys.play('coin', 120);
    G.combo++; G.comboT = 2.2;
    if (G.combo >= 3) {
      const bonus = G.combo >= 12 ? 4 : G.combo >= 7 ? 3 : G.combo >= 4 ? 1 : 0;
      if (bonus > 0) G.gold += bonus;
    }
    if (G.hero) {
      const near = !G.hero.dead && dist(G.hero, enemy) < 220;
      gainHeroXp(Math.max(1, Math.round(enemy.bounty * (near ? 1 : 0.3))));
    }
    if (enemy.isBoss) {
      addFloater(enemy.x, enemy.y - 20, `${enemy.name} 격파!`, '#ff6b6b', 22);
      G.shake = 0.5; G.hitstop = Math.max(G.hitstop, 0.14);
      spawnParts(enemy.x, enemy.y - 8, 26, { color: ['#ffd75e', '#f8922e', '#fff0c0'], size: 4, speed: 130, up: 60, life: 0.9 });
      AudioSys.play('boom');
    }
  }
}

function addFloater(x, y, text, color, size = 13) {
  G.floaters.push({ x, y, text, color, size, t: 1.2 });
}
function addEffect(type, x, y, dur, extra = {}) {
  G.effects.push({ type, x, y, t: dur, dur, ...extra });
}

function fireProjectile(from, target, lvDef) {
  G.projectiles.push({
    x: from.x, y: from.y - 14, target,
    speed: lvDef.proj === 'rock' ? 200 : 420,
    lvDef,
    arc: lvDef.proj === 'rock',
    t: 0,
    sx: from.x, sy: from.y - 14,
  });
}

/* ---------------- 업데이트 루프 ---------------- */
function update(dt) {
  if (!G || G.paused || G.over) return;
  dt *= G.speed;
  if (G.hitstop > 0) { G.hitstop -= dt; dt *= 0.12; }
  G.time += dt;
  if (G.shake > 0) G.shake -= dt;
  if (G.moraleT > 0) G.moraleT -= dt;
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
  for (const k in G.abilities) if (G.abilities[k].cd > 0) G.abilities[k].cd -= dt;

  // 웨이브 진행
  if (G.waveIdx < 0 || (G.spawnQueue.length === 0 && G.enemies.length === 0)) {
    if (G.waveIdx >= G.stage.waves.length - 1 && G.waveIdx >= 0) {
      winStage(); return;
    }
    if (G.waveTimer > WAVE_GAP) G.waveTimer = WAVE_GAP; // 웨이브 사이 간격은 10초로 제한
    G.waveTimer -= dt;
    if (G.waveTimer <= 0) startNextWave();
  }

  // 스폰
  while (G.spawnQueue.length && G.spawnQueue[0].at <= G.time) {
    const s = G.spawnQueue.shift();
    G.enemies.push(makeEnemy(s.type, s.pathId));
  }

  updateEnemies(dt);
  updateTowers(dt);
  updateReinforcements(dt);
  updateHero(dt);
  updateProjectiles(dt);
  updateAbilityBar();
  refreshSelPanel();

  // 파티클
  for (const p of G.parts) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.grav * dt;
  }
  G.parts = G.parts.filter(p => p.life > 0);

  // 이펙트 / 텍스트
  G.effects = G.effects.filter(e => (e.t -= dt) > 0);
  G.floaters = G.floaters.filter(f => { f.t -= dt; f.y -= 24 * dt; return f.t > 0; });

  updateHUD();
}

function startNextWave() {
  G.waveIdx++;
  queueWave(G.waveIdx);
  G.waveTimer = 999;
  addFloater(W / 2, 80, `${G.waveIdx + 1}번째 공세!`, '#fff', 26);
  AudioSys.play('horn');
  maybeEvent();
  updateHUD();
}

/* 전투 중 랜덤 이벤트: 3번째 공세부터, 약 40% 확률 */
function maybeEvent() {
  if (G.waveIdx < 2 || Math.random() > 0.4) return;
  const roll = Math.random();
  if (roll < 0.34) {
    addFloater(W / 2, 120, '⚔ 복병 출현!', '#ff6b6b', 22);
    AudioSys.play('horn');
    for (let i = 0; i < 4; i++) { const e = makeEnemy('cavalry'); e.progress = -i * 16; G.enemies.push(e); }
  } else if (roll < 0.7) {
    const g = 35 + G.stage.id * 6;
    G.gold += g;
    addFloater(W / 2, 120, `🌾 군량 보급 +${g}`, '#ffd700', 22);
    AudioSys.play('coin');
  } else {
    G.moraleT = 8;
    addFloater(W / 2, 120, '🚩 사기충천! 공격 속도 상승', '#7bed9f', 22);
    AudioSys.play('levelup');
  }
}

function updateEnemies(dt) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.wobble += dt * 6;
    if (e.flash > 0) e.flash -= dt;
    // 화상
    if (e.burnTime > 0) {
      e.burnTime -= dt;
      e.hp -= e.burn * dt;
      if (e.hp <= 0) { dealDamage(e, 9999, { magic: true }); continue; }
    }
    if (e.stun > 0) { e.stun -= dt; continue; }
    if (e.shielded) { e.shieldT -= dt; if (e.shieldT <= 0) e.shielded = false; }

    // 보스 스킬
    if (e.isBoss) updateBossSkill(e, dt);

    // 막혀있으면 전투
    if (e.blocker && !e.blocker.dead) {
      e.atkCd -= dt;
      if (e.atkCd <= 0 && !e.noFight) {
        e.atkCd = 1.0;
        e.blocker.hp -= rollDmg(e.dmg) * (e.rage || 1);
        addEffect('slash', e.blocker.x, e.blocker.y, 0.2, { ang: rand(-1.2, 1.2) });
        if (e.blocker.hp <= 0) killAlly(e.blocker);
      }
      continue;
    }
    e.blocker = null;

    // 이동
    const slowMul = e.slow > 0 ? 0.5 : 1;
    if (e.slow > 0) e.slow -= dt;
    e.progress += e.speed * slowMul * dt;
    const p = pointAt(e.path, e.progress);
    e.x = p.x; e.y = p.y;

    if (e.progress >= pathLength(e.path)) {
      e.escaped = true; e.dead = true;
      G.lives -= e.livesCost;
      addFloater(e.x, e.y, `-${e.livesCost} ❤️`, '#ff5555', 16);
      AudioSys.play('life');
      if (G.lives <= 0) { loseStage(); return; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function updateBossSkill(e, dt) {
  e.skillCd -= dt;
  if (e.skillCd > 0) return;
  e.skillCd = 8;
  const sk = BOSS_TYPES[e.typeId].skill;
  addFloater(e.x, e.y - 26, sk.name + '!', '#ff9f43', 16);
  switch (e.typeId) {
    case 'zhangJiao': { // 주변 아군 번개
      for (const ally of allAllies()) if (dist(ally, e) < 140) { ally.hp -= 35; addEffect('bolt', ally.x, ally.y, 0.3); if (ally.hp <= 0) killAlly(ally); }
      break; }
    case 'huaXiong': case 'xiahouYuan': { // 강타
      if (e.blocker && !e.blocker.dead) { e.blocker.hp -= 80; addEffect('slash', e.blocker.x, e.blocker.y, 0.3); if (e.blocker.hp <= 0) killAlly(e.blocker); }
      if (e.typeId === 'xiahouYuan') { e.slow = 0; e.progress += 28; }
      break; }
    case 'caoRen': e.shielded = true; e.shieldT = 3; break;
    case 'lvBu': { // 주변 아군 일소
      for (const ally of allAllies()) if (dist(ally, e) < 120) { ally.hp -= 70; addEffect('slash', ally.x, ally.y, 0.3); if (ally.hp <= 0) killAlly(ally); }
      G.shake = 0.3;
      break; }
    case 'zhangHe': case 'caoChun': e.progress += 60; addEffect('dash', e.x, e.y, 0.4); break;
    case 'xiahouDun': e.rage = 1.6; break;
    case 'caiMao': { // 수군 소환
      for (let i = 0; i < 2; i++) { const n = makeEnemy('navy', e.pathId); n.progress = Math.max(0, e.progress - 30 - i * 25); G.enemies.push(n); }
      break; }
    case 'zhangRen': { // 저격
      const targets = allAllies(); if (targets.length) { const t = targets[Math.floor(Math.random() * targets.length)]; t.hp -= 90; addEffect('bolt', t.x, t.y, 0.3); if (t.hp <= 0) killAlly(t); }
      break; }
  }
}

function allAllies() {
  const list = [];
  for (const t of G.towers) for (const s of t.soldiers) if (!s.dead) list.push(s);
  for (const r of G.reinf) if (!r.dead) list.push(r);
  if (G.hero && !G.hero.dead) list.push(G.hero);
  return list;
}
function killAlly(a) {
  a.dead = true;
  for (const e of G.enemies) if (e.blocker === a) e.blocker = null;
  addEffect('poof', a.x, a.y, 0.4);
  if (a.kind === 'hero') {
    a.respawnT = a.def.respawn;
    G.heroDeaths++;
    AudioSys.play('heroDie');
    addFloater(a.x, a.y, `${a.def.name} 부상! 후방 치료 중...`, '#aaa', 14);
  } else if (!a.temp) {
    a.respawnT = TOWER_TYPES.barracks.levels[a.tower.level].respawn;
  }
}

/* ---------------- 임시 원군(보급기) ---------------- */
function makeReinf(x, y, idx) {
  const a = ABILITIES.reinf;
  const ang = idx * 2.1;
  return {
    kind: 'soldier', temp: true,
    hp: a.hp, maxHp: a.hp, dmg: a.dmg,
    x: x + Math.cos(ang) * 18, y: y + Math.sin(ang) * 18,
    homeOff: ang, anchorRad: 18, rally: { x, y },
    target: null, atkCd: 0, dead: false, life: a.life,
  };
}
function updateReinforcements(dt) {
  for (const u of G.reinf) {
    if (u.dead) continue;
    u.life -= dt;
    if (u.life <= 0) {
      u.dead = true;
      for (const e of G.enemies) if (e.blocker === u) e.blocker = null;
      addEffect('poof', u.x, u.y, 0.4);
      continue;
    }
    combatUnit(u, u.rally, 130, 78, dt);
  }
  G.reinf = G.reinf.filter(u => !u.dead);
}

/* ---------------- 보급기 발동 ---------------- */
function resolveAbility(key, x, y) {
  const a = ABILITIES[key], st = G.abilities[key];
  if (st.cd > 0) return false;
  st.cd = a.cd;
  if (key === 'fire') {
    addEffect('fireRain', x, y, 1.0, { radius: a.radius });
    addEffect('boom', x, y, 0.4, { radius: a.radius });
    spawnParts(x, y, 24, { color: ['#ffd75e', '#f8922e', '#ff5a2a'], size: 4, speed: 130, up: 50, life: 0.8 });
    G.shake = 0.4; G.hitstop = Math.max(G.hitstop, 0.06);
    AudioSys.play('ult');
    for (const e of G.enemies) if (!e.dead && dist({ x, y }, e) <= a.radius) dealDamage(e, a.dmg, { magic: true, burn: a.burn, showDmg: true });
  } else if (key === 'reinf') {
    for (let i = 0; i < a.count; i++) G.reinf.push(makeReinf(x, y, i));
    addEffect('ring', x, y, 0.5, { radius: 50, color: '#7bed9f' });
    AudioSys.play('build');
  }
  addFloater(x, y - 40, a.name + '!', '#ffe9a8', 16);
  updateHUD();
  return true;
}

function updateTowers(dt) {
  for (const t of G.towers) {
    if (!t.type) continue;
    const def = TOWER_TYPES[t.type];
    const lv = def.levels[t.level];

    if (t.type === 'barracks') { updateBarracks(t, lv, dt); continue; }

    t.cooldown -= dt;
    if (t.cooldown > 0) continue;
    // 가장 진행이 빠른 적 조준
    let best = null;
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (dist(t, e) <= lv.range && (!best || e.progress > best.progress)) best = e;
    }
    if (best) {
      t.cooldown = lv.rate * (G.moraleT > 0 ? 0.6 : 1);
      fireProjectile(t, best, lv);
      AudioSys.play(lv.proj, 70);
    }
  }
}

function updateBarracks(t, lv, dt) {
  const cnt = lv.count || 2;
  // 보충 (업그레이드로 인원이 늘면 자동 충원)
  while (t.soldiers.length < cnt) t.soldiers.push(makeSoldier(t, lv, t.soldiers.length, cnt));
  for (const s of t.soldiers) {
    if (s.dead) {
      s.respawnT -= dt;
      if (s.respawnT <= 0) {
        Object.assign(s, makeSoldier(t, lv, s.idx != null ? s.idx : 0, cnt));
      }
      continue;
    }
    s.hp = Math.min(s.maxHp, s.hp + 2 * dt); // 자연 회복
    combatUnit(s, t.rally || nearestPathPoint(t.x, t.y), lv.range, 60, dt, t);
  }
}

/* 근접 아군 공통 행동: 집결지 주변의 적과 교전 */
function combatUnit(u, rally, engageRange, moveSpeed, dt, tower) {
  // 교전 대상 탐색
  if (!u.target || u.target.dead || u.target.blocker !== u) {
    u.target = null;
    for (const e of G.enemies) {
      if (e.dead || e.noFight && false) continue;
      if ((e.blocker && e.blocker !== u) || e.stun > 0) continue;
      const anchor = { x: rally.x + Math.cos(u.homeOff || 0) * (u.anchorRad || 14), y: rally.y + Math.sin(u.homeOff || 0) * (u.anchorRad || 14) };
      if (dist(anchor, e) <= engageRange && (!e.blocker || e.blocker === u)) {
        u.target = e; e.blocker = u; break;
      }
    }
  }
  if (u.target) {
    const e = u.target;
    const d = dist(u, e);
    if (d > 20) {
      u.x += (e.x - u.x) / d * moveSpeed * dt;
      u.y += (e.y - u.y) / d * moveSpeed * dt;
    } else {
      u.atkCd -= dt;
      if (u.atkCd <= 0) {
        u.atkCd = 1.0;
        dealDamage(e, rollDmg(u.dmg), { canCrit: u.kind === 'hero' });
        if (u.kind === 'hero') {
          u.attackT = HERO_ATK_DUR;
          u.attackFace = e.x >= u.x ? 1 : -1;
          const st = HERO_STRIKE[u.def.id];
          addEffect('heroStrike', e.x, e.y, 0.3, { ...st, ang: Math.atan2(e.y - u.y, e.x - u.x) });
          AudioSys.play('slash', 90);
        } else {
          addEffect('slash', e.x, e.y, 0.15, { ang: rand(-1.2, 1.2) });
        }
      }
    }
  } else {
    // 집결지로 복귀
    const hx = rally.x + Math.cos(u.homeOff || 0) * (u.anchorRad || 14), hy = rally.y + Math.sin(u.homeOff || 0) * (u.anchorRad || 14);
    const d = Math.hypot(hx - u.x, hy - u.y);
    if (d > 4) { u.x += (hx - u.x) / d * moveSpeed * dt; u.y += (hy - u.y) / d * moveSpeed * dt; }
  }
}

function updateHero(dt) {
  const h = G.hero;
  if (!h) return;
  if (h.ultCd > 0) h.ultCd -= dt;
  if (h.attackT > 0) h.attackT -= dt;
  if (h.dead) {
    h.respawnT -= dt;
    if (h.respawnT <= 0) { h.dead = false; h.hp = h.maxHp * 0.6; addFloater(h.x, h.y, `${h.def.name} 복귀!`, '#7bed9f', 15); }
    updateUltBtn();
    return;
  }
  h.hp = Math.min(h.maxHp, h.hp + h.def.regen * dt);

  // 인접한 적이 있으면 멈춰서 교전 (근접 영웅)
  if (!h.def.ranged) {
    for (const e of G.enemies) {
      if (e.dead || (e.blocker && e.blocker !== h)) continue;
      if (dist(h, e) < 34) { h.tx = h.x; h.ty = h.y; break; }
    }
  }
  // 이동 명령 우선
  const dMove = Math.hypot(h.tx - h.x, h.ty - h.y);
  if (dMove > 6) {
    h.x += (h.tx - h.x) / dMove * h.def.speed * dt;
    h.y += (h.ty - h.y) / dMove * h.def.speed * dt;
    if (h.target) { if (h.target.blocker === h) h.target.blocker = null; h.target = null; }
    updateUltBtn();
    return;
  }

  if (h.def.ranged) {
    // 원거리 영웅 (제갈량)
    h.atkCd -= dt;
    if (h.atkCd <= 0) {
      let best = null;
      for (const e of G.enemies) if (!e.dead && dist(h, e) <= h.def.range && (!best || e.progress > best.progress)) best = e;
      if (best) {
        h.atkCd = 1.0;
        dealDamage(best, rollDmg(h.dmgScaled), { magic: h.def.magic, canCrit: true });
        h.attackT = HERO_ATK_DUR;
        h.attackFace = best.x >= h.x ? 1 : -1;
        const st = HERO_STRIKE[h.def.id];
        addEffect('heroStrike', best.x, best.y, 0.32, { ...st, ang: Math.atan2(best.y - h.y, best.x - h.x) });
        addEffect('bolt', best.x, best.y, 0.25);
      }
    }
  } else {
    h.homeOff = 0;
    h.dmg = h.dmgScaled;
    combatUnit(h, { x: h.tx, y: h.ty }, 90, h.def.speed, dt);
  }
  updateUltBtn();
}

function castUlt() {
  const h = G.hero;
  if (!h || h.dead || h.ultCd > 0) return;
  const u = h.def.ult;
  h.ultCd = u.cd * (h.ultCdMul || 1);
  h.attackT = 0.55;
  addFloater(h.x, h.y - 30, u.name + '!!', '#ffd700', 20);
  G.shake = 0.35;
  AudioSys.play('ult');
  const ultDmg = u.dmg * h.ultMul;
  switch (u.type) {
    case 'aoe':
      addEffect('ring', h.x, h.y, 0.5, { radius: u.radius, color: h.def.color });
      for (const e of G.enemies) if (!e.dead && dist(h, e) <= u.radius) dealDamage(e, ultDmg, { magic: true, stun: u.stun });
      break;
    case 'globalStun':
      addEffect('roar', h.x, h.y, 0.7);
      for (const e of G.enemies) if (!e.dead) dealDamage(e, ultDmg, { magic: true, stun: u.stun });
      break;
    case 'charge': {
      // 진행방향: 가장 가까운 적 무리 쪽으로
      let tgt = null;
      for (const e of G.enemies) if (!e.dead && (!tgt || dist(h, e) < dist(h, tgt))) tgt = e;
      const ang = tgt ? Math.atan2(tgt.y - h.y, tgt.x - h.x) : 0;
      const ex = h.x + Math.cos(ang) * u.length, ey = h.y + Math.sin(ang) * u.length;
      addEffect('chargeLine', h.x, h.y, 0.5, { ex, ey });
      for (const e of G.enemies) {
        if (e.dead) continue;
        // 선분과의 거리
        const t = clamp(((e.x - h.x) * (ex - h.x) + (e.y - h.y) * (ey - h.y)) / (u.length * u.length), 0, 1);
        const px = h.x + (ex - h.x) * t, py = h.y + (ey - h.y) * t;
        if (Math.hypot(e.x - px, e.y - py) < 40) dealDamage(e, ultDmg, { magic: true, stun: 0.5 });
      }
      h.x = clamp(ex, 20, W - 20); h.y = clamp(ey, 20, H - 20);
      h.tx = h.x; h.ty = h.y;
      break; }
    case 'fireRain': {
      // 적이 가장 밀집한 지점
      let cx = h.x, cy = h.y, bestN = -1;
      for (const e of G.enemies) {
        let n = 0;
        for (const o of G.enemies) if (!o.dead && dist(e, o) < u.radius) n++;
        if (n > bestN) { bestN = n; cx = e.x; cy = e.y; }
      }
      addEffect('fireRain', cx, cy, 1.0, { radius: u.radius });
      for (const e of G.enemies) if (!e.dead && dist({ x: cx, y: cy }, e) <= u.radius) dealDamage(e, ultDmg, { magic: true, burn: u.burn });
      break; }
  }
  updateUltBtn();
}

function updateProjectiles(dt) {
  for (const p of G.projectiles) {
    const tgt = p.target;
    if (tgt.dead) { p.hit = true; continue; }
    const d = dist(p, tgt);
    const step = p.speed * dt;
    if (d <= step + 6) {
      p.hit = true;
      const lv = p.lvDef;
      if (lv.splash) {
        addEffect('boom', tgt.x, tgt.y, 0.35, { radius: lv.splash });
        spawnParts(tgt.x, tgt.y, 12, { color: ['#8a7a5a', '#6a5a44', '#f0a050'], size: 3.5, speed: 110, up: 70, life: 0.6 });
        AudioSys.play('boom', 150);
        for (const e of G.enemies) if (!e.dead && dist(tgt, e) <= lv.splash) dealDamage(e, rollDmg(lv.dmg) * TOWER_DMG_MUL, { magic: lv.magic, canCrit: true });
      } else {
        dealDamage(tgt, rollDmg(lv.dmg) * TOWER_DMG_MUL, { magic: lv.magic, burn: lv.burn, canCrit: true });
        if (lv.proj === 'fire') addEffect('flame', tgt.x, tgt.y, 0.25);
      }
    } else {
      p.x += (tgt.x - p.x) / d * step;
      p.y += (tgt.y - p.y) / d * step;
    }
  }
  G.projectiles = G.projectiles.filter(p => !p.hit);
}

/* ---------------- 승리 / 패배 ---------------- */
function winStage() {
  if (G.over) return;
  G.over = true; G.won = true;
  AudioSys.stopBgm();
  AudioSys.play('win');
  const stars = G.lives >= 3 ? 3 : G.lives >= 2 ? 2 : 1;
  const sid = G.stage.id;
  save.cleared = Math.max(save.cleared, sid);
  save.stars[sid] = Math.max(save.stars[sid] || 0, stars);
  // 도전 과제 판정
  const ch = save.challenges[sid] || {};
  G.newlyDone = [];
  if (G.lives >= G.stage.lives) { if (!ch.perfect) G.newlyDone.push('perfect'); ch.perfect = true; }
  if (G.heroDeaths === 0)       { if (!ch.immortal) G.newlyDone.push('immortal'); ch.immortal = true; }
  if (G.earlyCalls >= G.stage.waves.length) { if (!ch.rush) G.newlyDone.push('rush'); ch.rush = true; }
  save.challenges[sid] = ch;
  if (G.hero) save.heroXp[G.hero.def.id] = G.hero.xp;
  persistSave();
  setTimeout(() => showOutro(G.stage, stars), 600);
}
function loseStage() {
  if (G.over) return;
  G.over = true; G.won = false;
  AudioSys.stopBgm();
  AudioSys.play('lose');
  // 패배해도 쌓은 경험치의 절반은 보존
  if (G.hero) {
    const prev = save.heroXp[G.hero.def.id] || 0;
    save.heroXp[G.hero.def.id] = Math.max(prev, prev + Math.floor((G.hero.xp - prev) / 2));
    persistSave();
  }
  setTimeout(() => {
    $('#result').classList.remove('win'); $('#result').classList.add('lose');
    $('#result-title').textContent = '패배...';
    $('#result-stars').textContent = '💀';
    $('#result-msg').textContent = '본진이 함락되었습니다. 다시 도전하십시오!';
    $('#result-challenges').innerHTML = '';
    $('#btn-result-next').style.display = 'none';
    showOverlay('result');
  }, 600);
}

/* ============================================================
   렌더링 (픽셀아트 스프라이트 기반)
   ============================================================ */
let pathSampleCache = null, pathSampleStage = -1;
function pathSamples() {
  if (pathSampleStage !== G.stage.id) {
    pathSampleStage = G.stage.id;
    pathSampleCache = [];
    for (const path of G.paths) {
      const total = pathLength(path);
      for (let d = 0; d <= total; d += 16) pathSampleCache.push(pointAt(path, d));
    }
  }
  return pathSampleCache;
}

function draw() {
  if (!G) return;
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-4, 4) * G.shake, rand(-4, 4) * G.shake);
  ctx.drawImage(Sprites.terrain(G.stage, pathSamples()), 0, 0);
  drawSpots();
  drawTowers();
  drawUnits();
  drawProjectiles();
  drawParticles();
  drawEffects();
  drawFloaters();
  drawWaveBanner();
  drawCombo();
  drawAiming();
  ctx.restore();
}

function drawCombo() {
  if (G.combo < 3) return;
  const pulse = 1 + Math.max(0, 0.3 - (2.2 - G.comboT)) * 1.5;
  ctx.save();
  ctx.translate(64, 92);
  ctx.scale(pulse, pulse);
  ctx.font = 'bold 22px "Noto Serif KR", serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = G.combo >= 12 ? '#ff5a3a' : G.combo >= 7 ? '#ffb03a' : '#ffe27a';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 4;
  ctx.strokeText(`連環 x${G.combo}`, 0, 0);
  ctx.fillText(`連環 x${G.combo}`, 0, 0);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,226,122,0.7)';
  ctx.fillRect(64, 100, clamp(G.comboT / 2.2, 0, 1) * 90, 3);
}

function drawAiming() {
  if (!G.aiming) return;
  const x = G.aimX, y = G.aimY;
  const a = ABILITIES[G.aiming];
  ctx.save();
  if (G.aiming === 'fire') {
    ctx.beginPath(); ctx.arc(x, y, a.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,90,40,0.18)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,60,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.stroke();
  } else {
    for (let i = 0; i < a.count; i++) {
      const ang = i * 2.1;
      ctx.beginPath(); ctx.arc(x + Math.cos(ang) * 16, y + Math.sin(ang) * 16, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(123,237,159,0.3)'; ctx.fill();
      ctx.strokeStyle = 'rgba(123,237,159,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.font = '24px serif'; ctx.textAlign = 'center';
  ctx.fillText(a.icon, x, y - (G.aiming === 'fire' ? a.radius + 6 : 30));
  ctx.restore();
}

function shadow(x, y, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* 바닥에 깔리는 타원형 링 (원근감 있는 선택/표식 마커) */
function drawGroundRing(cx, cy, rx, ry, color, alpha = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  const grad = ctx.createRadialGradient(0, 0, rx * 0.5, 0, 0, rx);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0)');
  grad.addColorStop(1, color);
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3; ctx.strokeStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = alpha * 0.7;
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.ellipse(0, -1, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  ctx.restore();
}

function drawSprite(img, x, y, targetH, face = 1) {
  const s = targetH / img.height;
  const w = img.width * s, h = img.height * s;
  ctx.save();
  ctx.translate(x, y);
  if (face < 0) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

/* 일러스트 스프라이트: 발 기준점(x,y), 좌우 반전, 걷기 스웨이(라디안) */
function drawIllust(img, x, y, targetH, face = 1, sway = 0) {
  const s = targetH / img.height;
  const w = img.width * s, h = img.height * s;
  ctx.save();
  ctx.translate(x, y);
  if (sway) ctx.rotate(sway);
  if (face < 0) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

/* 일러스트 매핑: [기본 스프라이트, 색조 필터] — 필터로 변형 타입을 만든다 */
const UNIT_ILLUST = {
  yellowTurban: ['unit_yellowturban', null],
  bandit:       ['unit_yellowturban', 'grayscale(0.55) brightness(0.82)'],
  archerFoot:   ['unit_archer', null],
  shaman:       ['unit_archer', 'hue-rotate(55deg) saturate(1.6) brightness(1.15)'],
  infantry:     ['unit_infantry', null],
  navy:         ['unit_infantry', 'hue-rotate(135deg) saturate(1.2)'],
  elite:        ['unit_infantry', 'hue-rotate(65deg) saturate(1.5)'],
  cavalry:      ['unit_cavalry', null],
  tigerGuard:   ['unit_cavalry', 'hue-rotate(-150deg) saturate(1.45) brightness(0.92)'],
  siege:        ['unit_siege', null],
};
const BOSS_ILLUST_HUE = {
  zhangJiao: 'hue-rotate(55deg) saturate(1.6) brightness(1.2)',
  huaXiong: null,
  caoRen: 'hue-rotate(195deg)',
  lvBu: 'saturate(1.7) brightness(1.05)',
  zhangHe: 'hue-rotate(255deg)',
  xiahouDun: 'hue-rotate(120deg) brightness(0.9)',
  caoChun: 'hue-rotate(40deg) saturate(1.3)',
  caiMao: 'hue-rotate(175deg) saturate(1.2)',
  zhangRen: 'hue-rotate(90deg) brightness(0.95)',
  xiahouYuan: 'hue-rotate(-18deg) saturate(1.45)',
};
const TOWER_ILLUST = { archer: 'tower_archer', barracks: 'tower_barracks', catapult: 'tower_catapult', fire: 'tower_fire' };
/* 영웅별 무기 궤적 이펙트 (공격 시) */
const HERO_STRIKE = {
  liubei:     { kind: 'dualArc', color: '#ffe27a', color2: '#7adf8a' }, // 쌍고검 교차 베기
  guanyu:     { kind: 'arc',     color: '#ff6a4a', color2: '#9be87a' }, // 청룡언월도 횡베기
  zhangfei:   { kind: 'thrust',  color: '#caa6ff', color2: '#7a5aac' }, // 장팔사모 찌르기
  zhaoyun:    { kind: 'thrust',  color: '#eaf6ff', color2: '#6ab2ff' }, // 용담창 찌르기
  zhugeliang: { kind: 'glyph',   color: '#6ae8d8', color2: '#bff7ef' }, // 술법 문양
};
const HERO_ATK_DUR = 0.38;
const TOWER_LV_FX = ['brightness(0.92)', null, 'saturate(1.2) brightness(1.07)'];

function drawSpots() {
  const img = Sprites.spot();
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 3);
  for (let i = 0; i < G.towers.length; i++) {
    const t = G.towers[i];
    if (t.type) continue;
    // 건설 가능 표시: 바닥 타원 링 (맥동/선택)
    drawGroundRing(t.x, t.y + 15, 31, 13, '#ffe082', G.selected === i ? 1 : 0.45 + pulse * 0.3);
    shadow(t.x, t.y + 13, 16);
    drawSprite(img, t.x, t.y + 17, 50);
  }
}

function drawTowers() {
  for (let i = 0; i < G.towers.length; i++) {
    const t = G.towers[i];
    if (!t.type) continue;
    const def = TOWER_TYPES[t.type];
    const lv = def.levels[t.level];
    if (G.selected === i) {
      ctx.beginPath(); ctx.arc(t.x, t.y, lv.range, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      if (t.type === 'barracks' && t.rally) {
        ctx.strokeStyle = 'rgba(120,220,140,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(t.rally.x, t.rally.y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
    shadow(t.x, t.y + 14, 19);
    const tImg = SpriteImages.variant(TOWER_ILLUST[t.type], TOWER_LV_FX[t.level]);
    if (tImg) drawIllust(tImg, t.x, t.y + 18, 60 + t.level * 5);
    else drawSprite(Sprites.tower(t.type, t.level), t.x, t.y + 18, 62);
    // 레벨 표식 (금색 마름모)
    for (let s = 0; s <= t.level; s++) {
      ctx.save();
      ctx.translate(t.x - t.level * 5 + s * 10, t.y - 40);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd75e'; ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
      ctx.strokeStyle = 'rgba(60,40,0,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(-2.6, -2.6, 5.2, 5.2);
      ctx.restore();
    }
  }
}

function drawHpBar(x, y, w, ratio, color = '#5ec43a') {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = '#3a1410';
  ctx.fillRect(x - w / 2, y, w, 3);
  ctx.fillStyle = ratio > 0.4 ? color : '#e74c3c';
  ctx.fillRect(x - w / 2, y, w * clamp(ratio, 0, 1), 3);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - w / 2, y, w * clamp(ratio, 0, 1), 1);
}

function miniFlame(x, y, t) {
  const fl = Math.sin(t * 14) * 1.5;
  ctx.fillStyle = '#e85a1e'; ctx.fillRect(x - 3, y - 5 + fl * 0.3, 6, 5);
  ctx.fillStyle = '#f8c83a'; ctx.fillRect(x - 1.5, y - 7 + fl * 0.5, 3, 4);
}

function drawUnits() {
  const list = [];
  for (const e of G.enemies) if (!e.dead) list.push({ kind: 'enemy', u: e, y: e.y });
  for (const t of G.towers) for (const s of t.soldiers) if (!s.dead) list.push({ kind: 'soldier', u: s, y: s.y });
  for (const r of G.reinf) if (!r.dead) list.push({ kind: 'soldier', u: r, y: r.y });
  const h = G.hero;
  if (h) list.push({ kind: 'hero', u: h, y: h.y });
  list.sort((a, b) => a.y - b.y);

  for (const it of list) {
    const u = it.u;
    if (it.kind === 'enemy') {
      const e = u;
      const frame = Math.floor(e.wobble * 1.6) % 2;
      const ahead = pointAt(e.path, e.progress + 6);
      const face = (e.blocker && !e.blocker.dead) ? (e.blocker.x >= e.x ? 1 : -1) : (ahead.x >= e.x - 0.3 ? 1 : -1);
      const map = e.isBoss ? ['unit_general', BOSS_ILLUST_HUE[e.typeId]] : UNIT_ILLUST[e.typeId];
      const uImg = map ? SpriteImages.variant(map[0], map[1]) : null;
      const hgt = uImg ? (e.isBoss ? 82 : 52) : (e.isBoss ? 62 : 42);
      shadow(e.x, e.y + 11, e.isBoss ? 23 : 16);
      if (e.shielded) {
        ctx.beginPath(); ctx.arc(e.x, e.y - 10, 26, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,180,255,0.28)'; ctx.fill();
        ctx.strokeStyle = 'rgba(160,210,255,0.7)'; ctx.stroke();
      }
      if (uImg) {
        const sway = (e.stun > 0 || (e.blocker && !e.blocker.dead)) ? 0 : Math.sin(e.wobble * 1.8) * 0.07;
        const bob = Math.abs(Math.sin(e.wobble * 1.8)) * 1.8;
        drawIllust(uImg, e.x, e.y + 10 - bob, hgt, face, sway);
        if (e.flash > 0) {
          const wImg = SpriteImages.variant(map[0], 'brightness(0) invert(1)');
          if (wImg) { ctx.globalAlpha = clamp(e.flash / 0.1, 0, 1) * 0.85; drawIllust(wImg, e.x, e.y + 10 - bob, hgt, face, sway); ctx.globalAlpha = 1; }
        }
      } else {
        drawSprite(Sprites.unit(e.typeId, frame), e.x, e.y + 10, hgt, face);
      }
      if (e.burnTime > 0) miniFlame(e.x, e.y - hgt + 4, G.time);
      if (e.stun > 0) {
        for (let k = 0; k < 3; k++) {
          const a = G.time * 5 + k * 2.1;
          ctx.fillStyle = '#ffe96a';
          ctx.fillRect(e.x + Math.cos(a) * 9 - 1.5, e.y - hgt + 2 + Math.sin(a) * 3 - 1.5, 3, 3);
        }
      }
      if (e.isBoss) {
        // 보스 명패
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        const nw = ctx.measureText(e.name).width + 12;
        ctx.fillStyle = 'rgba(20,8,4,0.8)';
        roundRect(e.x - nw / 2, e.y - hgt - 16, nw, 14, 4); ctx.fill();
        ctx.strokeStyle = '#a23b2e'; ctx.lineWidth = 1;
        roundRect(e.x - nw / 2, e.y - hgt - 16, nw, 14, 4); ctx.stroke();
        ctx.fillStyle = '#ffd9a0';
        ctx.fillText(e.name, e.x, e.y - hgt - 5);
        drawHpBar(e.x, e.y - hgt + 1, 66, e.hp / e.maxHp, '#e67e22');
      } else {
        drawHpBar(e.x, e.y - hgt + 1, 38, e.hp / e.maxHp);
      }
    } else if (it.kind === 'soldier') {
      const s = u;
      const face = s.target && !s.target.dead ? (s.target.x >= s.x ? 1 : -1) : 1;
      shadow(s.x, s.y + 10, 13);
      const filter = s.temp ? 'saturate(1.5) brightness(1.18)' : null;
      const sImg = SpriteImages.variant('unit_soldier', filter);
      if (s.temp) drawGroundRing(s.x, s.y + 10, 16, 7, '#7bed9f', clamp(s.life / ABILITIES.reinf.life, 0.25, 1));
      if (sImg) drawIllust(sImg, s.x, s.y + 10, 44, face, Math.sin(G.time * 6 + s.homeOff) * 0.04);
      else drawSprite(Sprites.unit('soldier', Math.floor(G.time * 4 + s.homeOff) % 2), s.x, s.y + 10, 38, face);
      drawHpBar(s.x, s.y - 34, 30, s.hp / s.maxHp, s.temp ? '#7bed9f' : '#4aa4e0');
    } else {
      const hh = u;
      if (hh.dead) {
        ctx.globalAlpha = 0.55;
        ctx.font = '18px serif'; ctx.textAlign = 'center';
        ctx.fillText('⛺', hh.x, hh.y + 5);
        ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(Math.ceil(hh.respawnT) + 's', hh.x, hh.y + 18);
        ctx.globalAlpha = 1;
        continue;
      }
      const attacking = hh.attackT > 0;
      const face = attacking && hh.attackFace ? hh.attackFace
        : hh.target && !hh.target.dead ? (hh.target.x >= hh.x ? 1 : -1)
        : (Math.abs(hh.tx - hh.x) > 2 ? (hh.tx >= hh.x ? 1 : -1) : 1);
      // 오라: 바닥 타원 링
      drawGroundRing(hh.x, hh.y + 12, 25, 10, hh.def.color, (G.sel && G.sel.ref === hh) ? 1 : 0.8);
      shadow(hh.x, hh.y + 12, 16);
      const moving = Math.hypot(hh.tx - hh.x, hh.ty - hh.y) > 6 || (hh.target && !hh.target.dead);
      const baseImg = SpriteImages.variant('hero_' + hh.def.id, null);
      const atkImg = attacking ? SpriteImages.variant('hero_' + hh.def.id + '_atk', null) : null;
      const hImg = atkImg || baseImg;
      if (hImg) {
        if (attacking) {
          const k = clamp(1 - hh.attackT / HERO_ATK_DUR, 0, 1);
          const lunge = Math.sin(k * Math.PI) * 12;
          const tilt = Math.sin(k * Math.PI) * 0.11;
          drawIllust(hImg, hh.x + lunge * face, hh.y + 12, 60, face, tilt);
        } else {
          const sway = moving ? Math.sin(G.time * 9) * 0.06 : Math.sin(G.time * 2.2) * 0.018;
          drawIllust(hImg, hh.x, hh.y + 12, 58, face, sway);
        }
      } else {
        drawSprite(Sprites.unit(hh.def.id, moving ? Math.floor(G.time * 5) % 2 : 0), hh.x, hh.y + 12, 48, face);
      }
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
      const hname = (hh.special ? '⭐ ' : '') + `${hh.def.name} Lv.${hh.level}`;
      ctx.strokeText(hname, hh.x, hh.y - 52);
      ctx.fillStyle = hh.special ? '#ffe27a' : '#fff';
      ctx.fillText(hname, hh.x, hh.y - 52);
      drawHpBar(hh.x, hh.y - 48, 46, hh.hp / hh.maxHp, '#3a9ae8');
      if (Math.hypot(hh.tx - hh.x, hh.ty - hh.y) > 8) {
        ctx.beginPath(); ctx.arc(hh.tx, hh.ty, 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }
}

function drawProjectiles() {
  for (const p of G.projectiles) {
    const tgt = p.target;
    if (p.lvDef.proj === 'arrow') {
      const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-5, 0); ctx.stroke();
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(-6, -1, 10, 2);
      ctx.fillStyle = '#d8dce0'; ctx.fillRect(4, -1.5, 4, 3);
      ctx.restore();
    } else if (p.lvDef.proj === 'rock') {
      const total = Math.hypot(tgt.x - p.sx, tgt.y - p.sy) || 1;
      const traveled = Math.hypot(p.x - p.sx, p.y - p.sy);
      const tt = clamp(traveled / total, 0, 1);
      const arcH = Math.min(70, total * 0.3);
      const yo = -arcH * Math.sin(Math.PI * tt);
      shadow(p.x, p.y + 4, 6 * (1 - Math.sin(Math.PI * tt) * 0.5));
      ctx.fillStyle = '#6a6a64';
      ctx.beginPath(); ctx.arc(p.x, p.y + yo, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8e8e86';
      ctx.beginPath(); ctx.arc(p.x - 1.5, p.y + yo - 1.5, 3, 0, Math.PI * 2); ctx.fill();
    } else { // fire
      ctx.fillStyle = 'rgba(240,120,30,0.35)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f8922e';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe48a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.5) spawnParts(p.x, p.y, 1, { color: '#f8a83a', size: 2, speed: 12, life: 0.3, grav: -20 });
    }
  }
}

/* ---------------- 파티클 ---------------- */
function spawnParts(x, y, n, opt = {}) {
  for (let i = 0; i < n; i++) {
    const a = opt.angle != null ? opt.angle + rand(-0.5, 0.5) : rand(0, Math.PI * 2);
    const sp = (opt.speed || 60) * rand(0.4, 1.2);
    G.parts.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opt.up || 0),
      grav: opt.grav != null ? opt.grav : 140,
      life: (opt.life || 0.6) * rand(0.6, 1.2), maxLife: opt.life || 0.6,
      color: Array.isArray(opt.color) ? opt.color[Math.floor(Math.random() * opt.color.length)] : (opt.color || '#c8b89a'),
      size: (opt.size || 3) * rand(0.7, 1.3),
    });
  }
}

function drawParticles() {
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawEffects() {
  for (const ef of G.effects) {
    const k = 1 - ef.t / ef.dur;
    switch (ef.type) {
      case 'heroStrike': {
        const sweep = Math.min(1, k * 1.6);
        ctx.save();
        ctx.translate(ef.x, ef.y - 6);
        ctx.lineCap = 'round';
        if (ef.kind === 'arc') {
          // 넓은 횡베기 호 (관우)
          ctx.rotate(ef.ang);
          for (const [r, w, c] of [[17, 5, ef.color], [12, 3, ef.color2]]) {
            ctx.strokeStyle = c; ctx.globalAlpha = (1 - k);
            ctx.lineWidth = w * (1 - k * 0.5);
            ctx.beginPath(); ctx.arc(0, 0, r + k * 8, -1.5, -1.5 + 3.0 * sweep); ctx.stroke();
          }
        } else if (ef.kind === 'dualArc') {
          // 쌍검 교차 베기 (유비)
          ctx.rotate(ef.ang);
          ctx.globalAlpha = (1 - k);
          ctx.strokeStyle = ef.color; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(0, -3, 13 + k * 6, -2.2, -2.2 + 2.6 * sweep); ctx.stroke();
          ctx.strokeStyle = ef.color2; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 3, 13 + k * 6, 2.2, 2.2 - 2.6 * sweep, true); ctx.stroke();
        } else if (ef.kind === 'thrust') {
          // 창 찌르기 섬광 (장비/조운)
          ctx.rotate(ef.ang);
          const len = 26 * sweep;
          ctx.globalAlpha = (1 - k);
          const lg = ctx.createLinearGradient(-len, 0, 8, 0);
          lg.addColorStop(0, 'rgba(0,0,0,0)');
          lg.addColorStop(1, ef.color);
          ctx.strokeStyle = lg; ctx.lineWidth = 5 * (1 - k * 0.4);
          ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(8, 0); ctx.stroke();
          ctx.fillStyle = ef.color2;
          ctx.beginPath(); ctx.arc(8, 0, 4.5 * (1 - k), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(8, 0, 2 * (1 - k), 0, Math.PI * 2); ctx.fill();
        } else if (ef.kind === 'glyph') {
          // 술법 문양 (제갈량)
          ctx.globalAlpha = (1 - k);
          ctx.strokeStyle = ef.color; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(0, 0, 8 + k * 16, 0, Math.PI * 2); ctx.stroke();
          ctx.save();
          ctx.rotate(k * 2.4);
          ctx.strokeStyle = ef.color2; ctx.lineWidth = 1.8;
          ctx.strokeRect(-(6 + k * 10), -(6 + k * 10), (6 + k * 10) * 2, (6 + k * 10) * 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        break; }
      case 'slash': {
        ctx.save();
        ctx.translate(ef.x, ef.y - 6);
        ctx.rotate(ef.ang || -0.5);
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 10 + k * 6, -0.7, 0.9); ctx.stroke();
        ctx.strokeStyle = `rgba(255,220,160,${(1 - k) * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 7 + k * 6, -0.7, 0.9); ctx.stroke();
        ctx.restore();
        break; }
      case 'poof':
        for (let i = 0; i < 4; i++) {
          const a = i * 1.6 + 0.4;
          ctx.fillStyle = `rgba(200,190,170,${(1 - k) * 0.6})`;
          ctx.beginPath();
          ctx.arc(ef.x + Math.cos(a) * k * 14, ef.y - 4 + Math.sin(a) * k * 9, 4 * (1 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'boom': {
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius * k, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,150,60,${0.4 * (1 - k)})`; ctx.fill();
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius * k * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,220,150,${0.8 * (1 - k)})`; ctx.lineWidth = 3; ctx.stroke();
        if (k < 0.25) {
          ctx.fillStyle = `rgba(255,240,200,${1 - k * 4})`;
          ctx.beginPath(); ctx.arc(ef.x, ef.y, 12, 0, Math.PI * 2); ctx.fill();
        }
        break; }
      case 'flame':
        miniFlame(ef.x, ef.y - k * 8, G.time);
        break;
      case 'bolt': {
        ctx.strokeStyle = `rgba(255,236,120,${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ef.x - 3, ef.y - 22);
        ctx.lineTo(ef.x + 3, ef.y - 12);
        ctx.lineTo(ef.x - 2, ef.y - 10);
        ctx.lineTo(ef.x + 2, ef.y);
        ctx.stroke();
        break; }
      case 'ring': {
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius * k, 0, Math.PI * 2);
        ctx.strokeStyle = ef.color || '#fff'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius * k * 0.75, 0, Math.PI * 2);
        ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
        break; }
      case 'roar': {
        for (let i = 0; i < 3; i++) {
          const rr = (k + i * 0.25) % 1;
          ctx.beginPath(); ctx.arc(ef.x, ef.y, 20 + rr * 180, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(180,140,255,${(1 - rr) * 0.5})`;
          ctx.lineWidth = 5 * (1 - rr);
          ctx.stroke();
        }
        break; }
      case 'chargeLine': {
        ctx.strokeStyle = `rgba(150,200,255,${1 - k})`;
        ctx.lineWidth = 12 * (1 - k) + 2;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ef.x, ef.y); ctx.lineTo(ef.ex, ef.ey); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.8})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.moveTo(ef.x, ef.y); ctx.lineTo(ef.ex, ef.ey); ctx.stroke();
        break; }
      case 'fireRain': {
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,90,30,${0.3 * (1 - k)})`; ctx.fill();
        for (let i = 0; i < 8; i++) {
          const a = i * 0.785 + (i % 2) * 0.4;
          const fx = ef.x + Math.cos(a) * ef.radius * (0.25 + (i % 3) * 0.25);
          const fy = ef.y + Math.sin(a) * ef.radius * 0.5;
          const drop = k * 90 - 70 + (i % 4) * 16;
          if (drop < 0) {
            ctx.strokeStyle = 'rgba(255,170,60,0.9)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(fx - 4, fy + drop - 14); ctx.lineTo(fx, fy + drop); ctx.stroke();
            ctx.fillStyle = '#ffe48a';
            ctx.beginPath(); ctx.arc(fx, fy + drop, 3, 0, Math.PI * 2); ctx.fill();
          } else {
            miniFlame(fx, fy, G.time + i);
          }
        }
        break; }
      case 'dash': {
        ctx.fillStyle = `rgba(220,220,220,${(1 - k) * 0.5})`;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(ef.x - k * 30 - i * 8, ef.y, 4 - i, 0, Math.PI * 2); ctx.fill();
        }
        break; }
    }
  }
}

function drawFloaters() {
  for (const f of G.floaters) {
    ctx.font = `bold ${f.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(f.t, 0, 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

function drawWaveBanner() {
  if ((G.waveIdx < 0 || (G.spawnQueue.length === 0 && G.enemies.length === 0)) && !G.over && G.waveIdx < G.stage.waves.length - 1) {
    const bw = 320, bx = W / 2 - bw / 2, by = 12;
    // 나무 현판
    const grad = ctx.createLinearGradient(0, by, 0, by + 40);
    grad.addColorStop(0, '#6a4a2c'); grad.addColorStop(0.5, '#54381e'); grad.addColorStop(1, '#3e2814');
    ctx.fillStyle = grad;
    roundRect(bx, by, bw, 40, 8); ctx.fill();
    ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = 2;
    roundRect(bx, by, bw, 40, 8); ctx.stroke();
    ctx.strokeStyle = 'rgba(232,200,58,0.5)'; ctx.lineWidth = 1;
    roundRect(bx + 3, by + 3, bw - 6, 34, 6); ctx.stroke();
    // 시간 게이지
    const ratio = clamp(G.waveTimer / WAVE_GAP, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(bx + 14, by + 27, bw - 28, 6, 3); ctx.fill();
    ctx.fillStyle = '#e8a83a';
    roundRect(bx + 14, by + 27, (bw - 28) * ratio, 6, 3); ctx.fill();
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`⚔ 다음 공세까지 ${Math.ceil(G.waveTimer)}초 — 클릭하여 즉시 출전 (+금)`, W / 2, by + 19);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================================================
   UI / 화면 전환
   ============================================================ */
function showOverlay(id) {
  $$('.overlay').forEach(o => o.classList.remove('active'));
  if (id) $('#' + id).classList.add('active');
}

function updateHUD() {
  $('#hud-gold').textContent = Math.floor(G.gold);
  $('#hud-lives').textContent = G.lives;
  $('#hud-wave').textContent = `${Math.max(1, G.waveIdx + 1)} / ${G.stage.waves.length}`;
  $('#hud-stage').textContent = G.stage.name;
}

function updateUltBtn() {
  const btn = $('#btn-ult');
  const h = G.hero;
  if (!h) { btn.style.display = 'none'; return; }
  btn.style.display = 'flex';
  const ready = h.ultCd <= 0 && !h.dead;
  btn.classList.toggle('ready', ready);
  $('#ult-icon').textContent = h.def.ult.icon;
  $('#ult-cd').textContent = ready ? '준비!' : (h.dead ? '부상' : Math.ceil(h.ultCd) + 's');
}

function updateAbilityBar() {
  const bar = $('#ability-bar');
  if (!G) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  for (const key of Object.keys(ABILITIES)) {
    const a = ABILITIES[key], st = G.abilities[key];
    const el = $('#abil-' + key);
    if (!el) continue;
    const ready = st.cd <= 0;
    el.classList.toggle('ready', ready);
    el.classList.toggle('aiming', G.aiming === key);
    el.classList.toggle('disabled', !ready);
    el.querySelector('.ab-cd').textContent = ready ? '준비' : Math.ceil(st.cd) + 's';
  }
}

/* ============================================================
   선택 패널 (하단 중앙) — 유닛/타워 스펙 + 건설/업그레이드/판매
   ============================================================ */
function towerStatHtml(t) {
  const def = TOWER_TYPES[t.type], lv = def.levels[t.level];
  const chips = [];
  if (t.type === 'barracks') {
    chips.push(`🛡 병력 ${lv.soldierHp}`, `⚔ ${lv.soldierDmg[0]}~${lv.soldierDmg[1]}`, `↔ ${lv.range}`);
  } else {
    chips.push(`⚔ ${lv.dmg[0]}~${lv.dmg[1]}`, `↔ ${lv.range}`, `⏱ ${(1 / lv.rate).toFixed(1)}/s`);
    if (lv.splash) chips.push(`💥 ${lv.splash}`);
    if (lv.burn) chips.push(`🔥 ${lv.burn}`);
  }
  return chips.map(c => `<span class="sp-chip">${c}</span>`).join('');
}

function selectAt(kind, i, ref) {
  G.sel = { kind, i, ref };
  G.selected = (kind === 'tower' || kind === 'spot') ? i : null;
  renderSelPanel();
}
function selectClear() {
  if (G) { G.sel = null; G.selected = null; G.selUI = null; }
  renderSelPanel();
}

function renderSelPanel() {
  const panel = $('#sel-panel');
  const sel = G && G.sel;
  panel.style.display = 'flex';
  if (!sel) {
    panel.innerHTML = '<div class="sp-empty">유닛·타워를 눌러 정보를 보거나, 빈 곳을 눌러 영웅을 이동하세요</div>';
    if (G) G.selUI = null;
    return;
  }
  panel.innerHTML = '';
  G.selUI = { costBtns: [], hpEl: null, ref: sel.ref, kind: sel.kind, i: sel.i };

  if (sel.kind === 'spot') {
    const t = G.towers[sel.i];
    const head = document.createElement('div'); head.className = 'sp-head';
    head.innerHTML = `<span class="sp-title">진지 구축</span>`;
    panel.appendChild(head);
    const row = document.createElement('div'); row.className = 'sp-build-row';
    for (const key of Object.keys(TOWER_TYPES)) {
      const def = TOWER_TYPES[key], cost = def.levels[0].cost;
      const btn = document.createElement('button');
      btn.className = 'sp-build';
      btn.innerHTML = `<span class="sp-bic"><img src="assets/img/icon_${key}.jpg" alt="" onerror="this.outerHTML='${def.icon}'"></span><span class="sp-bnm">${def.name}</span><span class="sp-bc">💰${cost}</span>`;
      btn.title = def.desc;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (G.gold < cost) return;
        G.gold -= cost;
        t.type = key; t.level = 0; t.cooldown = 0;
        if (key === 'barracks') { t.rally = nearestPathPoint(t.x, t.y); t.soldiers = []; }
        AudioSys.play('build');
        updateHUD();
        selectAt('tower', sel.i, t);
      };
      G.selUI.costBtns.push({ el: btn, cost });
      row.appendChild(btn);
    }
    panel.appendChild(row);

  } else if (sel.kind === 'tower') {
    const t = G.towers[sel.i], def = TOWER_TYPES[t.type];
    const head = document.createElement('div'); head.className = 'sp-head';
    head.innerHTML = `<span class="sp-title">${def.levels[t.level].name} <span class="sp-star">${'★'.repeat(t.level + 1)}</span></span>` +
      (t.type === 'barracks' ? `<span class="sp-hint">사거리 안을 클릭 → 집결지 이동 🚩</span>` : '');
    panel.appendChild(head);
    const stats = document.createElement('div'); stats.className = 'sp-stats';
    stats.innerHTML = towerStatHtml(t);
    panel.appendChild(stats);
    const acts = document.createElement('div'); acts.className = 'sp-acts';
    if (t.level < def.levels.length - 1) {
      const next = def.levels[t.level + 1];
      const up = document.createElement('button');
      up.className = 'sp-act up';
      up.innerHTML = `⬆ ${next.name} <b>💰${next.cost}</b>`;
      up.onclick = (e) => {
        e.stopPropagation();
        if (G.gold < next.cost) return;
        G.gold -= next.cost; t.level++;
        if (t.type === 'barracks') for (const s of t.soldiers) if (!s.dead) { s.maxHp = next.soldierHp; s.hp = next.soldierHp; s.dmg = next.soldierDmg; }
        AudioSys.play('build'); updateHUD();
        selectAt('tower', sel.i, t);
      };
      G.selUI.costBtns.push({ el: up, cost: next.cost });
      acts.appendChild(up);
    }
    let spent = 0; for (let l = 0; l <= t.level; l++) spent += def.levels[l].cost;
    const refund = Math.floor(spent * 0.6);
    const sell = document.createElement('button');
    sell.className = 'sp-act sell';
    sell.innerHTML = `🗑 판매 <b>+💰${refund}</b>`;
    sell.onclick = (e) => {
      e.stopPropagation();
      G.gold += refund;
      for (const en of G.enemies) if (en.blocker && en.blocker.tower === t) en.blocker = null;
      t.type = null; t.level = 0; t.soldiers = [];
      AudioSys.play('sell'); updateHUD();
      selectClear();
    };
    acts.appendChild(sell);
    panel.appendChild(acts);

  } else {
    // 유닛/영웅 스펙
    const u = sel.ref;
    const head = document.createElement('div'); head.className = 'sp-head';
    let title, sub = '';
    if (sel.kind === 'enemy') { title = u.name + (u.isBoss ? ` <span class="sp-boss">${BOSS_TYPES[u.typeId].title}</span>` : ''); }
    else if (sel.kind === 'hero') { title = `${u.def.name} <span class="sp-star">Lv.${u.level}</span>`; if (u.special) sub = `<span class="sp-special">⭐ 이 전장의 인연 (능력 강화)</span>`; }
    else { title = u.temp ? '의용군(원군)' : '창병'; }
    head.innerHTML = `<span class="sp-title">${title}</span>${sub}`;
    panel.appendChild(head);
    const stats = document.createElement('div'); stats.className = 'sp-stats';
    const chips = [];
    const hp = `<span class="sp-chip" id="sp-hp">❤ ${Math.max(0, Math.round(u.hp))}/${Math.round(u.maxHp)}</span>`;
    chips.push(hp);
    if (sel.kind === 'enemy') {
      chips.push(`⚔ ${Math.round(u.dmg[0])}~${Math.round(u.dmg[1])}`, `👟 ${u.speed}`, `🛡 ${Math.round((u.armor || 0) * 100)}%`);
    } else if (sel.kind === 'hero') {
      chips.push(`⚔ ${Math.round(u.dmgScaled[0])}~${Math.round(u.dmgScaled[1])}`, `✦ ${u.def.ult.name}`);
    } else {
      chips.push(`⚔ ${u.dmg[0]}~${u.dmg[1]}`);
    }
    stats.innerHTML = chips.join('');
    panel.appendChild(stats);
    G.selUI.hpEl = $('#sp-hp');
  }
}

// 매 프레임: 금액에 따른 버튼 활성화 + 유닛 HP/사망 갱신
function refreshSelPanel() {
  if (!G) return;
  const sel = G.sel, ui = G.selUI;
  if (!sel || !ui) return;
  if (sel.kind === 'spot' && G.towers[sel.i].type) { selectAt('tower', sel.i, G.towers[sel.i]); return; }
  if (sel.kind === 'tower' && !G.towers[sel.i].type) { selectClear(); return; }
  if ((sel.kind === 'enemy' || sel.kind === 'soldier') && (sel.ref.dead || sel.ref.hp <= 0)) { selectClear(); return; }
  for (const b of ui.costBtns) b.el.classList.toggle('poor', G.gold < b.cost);
  if (ui.hpEl) {
    const u = sel.ref;
    ui.hpEl.textContent = `❤ ${Math.max(0, Math.round(u.hp))}/${Math.round(u.maxHp)}`;
  }
}

/* ---------------- 캔버스 입력 ---------------- */
canvas.addEventListener('click', (ev) => {
  if (!G || G.over) return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * W / rect.width;
  const y = (ev.clientY - rect.top) * H / rect.height;

  // 보급기 조준 모드: 지점 클릭 시 발동
  if (G.aiming) {
    resolveAbility(G.aiming, clamp(x, 0, W), clamp(y, 0, H));
    G.aiming = null;
    return;
  }

  // 웨이브 조기 시작 배너
  if ((G.waveIdx < 0 || (G.spawnQueue.length === 0 && G.enemies.length === 0)) && G.waveIdx < G.stage.waves.length - 1) {
    if (x > W / 2 - 150 && x < W / 2 + 150 && y > 14 && y < 48) {
      const bonus = Math.floor(G.waveTimer * 2);
      if (bonus > 0) { G.gold += bonus; addFloater(W / 2, 70, `조기 출전 보너스 +${bonus}`, '#ffd700', 15); }
      G.earlyCalls++;
      startNextWave();
      return;
    }
  }

  // 1) 건설부지 / 타워 (빈 부지는 넓은 판정)
  for (let i = 0; i < G.towers.length; i++) {
    const t = G.towers[i];
    const r = t.type ? HIT_R : HIT_R + 14;
    if (Math.hypot(t.x - x, t.y - y) < r) { selectAt(t.type ? 'tower' : 'spot', i, t); return; }
  }
  // 2) 영웅 클릭 → 스펙
  const h = G.hero;
  if (h && !h.dead && Math.hypot(h.x - x, h.y - y) < HIT_R + 4) { selectAt('hero', -1, h); return; }
  // 3) 적군 클릭 → 스펙 (가장 가까운)
  let be = null, bd = HIT_R + 6;
  for (const e of G.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; be = e; } }
  if (be) { selectAt('enemy', -1, be); return; }
  // 4) 아군 병사/원군 클릭 → 스펙
  let ba = null, bad = HIT_R + 2;
  const allies = [];
  for (const t of G.towers) for (const s of t.soldiers) if (!s.dead) allies.push(s);
  for (const rr of G.reinf) if (!rr.dead) allies.push(rr);
  for (const s of allies) { const d = Math.hypot(s.x - x, s.y - y); if (d < bad) { bad = d; ba = s; } }
  if (ba) { selectAt('soldier', -1, ba); return; }

  // 5) 빈 곳: 막사 선택 중이면 집결지 이동, 아니면 영웅 이동
  if (G.sel && G.sel.kind === 'tower') {
    const t = G.towers[G.sel.i];
    if (t && t.type === 'barracks') {
      const range = TOWER_TYPES.barracks.levels[t.level].range;
      if (Math.hypot(t.x - x, t.y - y) <= range + 36) {
        setRally(t, x, y);
        addFloater(t.rally.x, t.rally.y - 16, '집결지 이동', '#7bed9f', 13);
        return;
      }
    }
  }
  if (h && !h.dead) { h.tx = clamp(x, 16, W - 16); h.ty = clamp(y, 16, H - 16); }
  selectClear();
});

canvas.addEventListener("mousemove", (ev) => {
  if (!G || !G.aiming) return;
  const rect = canvas.getBoundingClientRect();
  G.aimX = (ev.clientX - rect.left) * W / rect.width;
  G.aimY = (ev.clientY - rect.top) * H / rect.height;
});
canvas.addEventListener('contextmenu', (ev) => {
  if (G && G.aiming) { ev.preventDefault(); G.aiming = null; }
});

/* ---------------- 보급기 버튼 ---------------- */
function toggleAiming(key) {
  if (!G || G.over) return;
  const st = G.abilities[key];
  if (st.cd > 0) { addFloater(W / 2, 70, '재사용 대기 중 ' + Math.ceil(st.cd) + 's', '#ff8a6a', 15); return; }
  G.aiming = G.aiming === key ? null : key;
}
for (const key of Object.keys(ABILITIES)) {
  const el = $('#abil-' + key);
  if (el) {
    el.title = `${ABILITIES[key].name} — ${ABILITIES[key].desc}`;
    el.querySelector('.ab-ic').textContent = ABILITIES[key].icon;
    el.onclick = (e) => { e.stopPropagation(); toggleAiming(key); };
  }
}

/* ---------------- 다이얼로그 (시나리오) ---------------- */
let dlg = { lines: [], idx: 0, onDone: null };
function showDialogue(lines, onDone) {
  dlg = { lines, idx: 0, onDone };
  showOverlay('dialogue');
  renderDlgLine();
}
const PORTRAIT_FILES = { '유비': 'liubei', '관우': 'guanyu', '장비': 'zhangfei', '조운': 'zhaoyun', '제갈량': 'zhugeliang', '조조': 'caocao', '도겸': 'taoqian' };
const PORTRAIT_EMOJI = { '유비': '👑', '관우': '🟥', '장비': '🐍', '조운': '⚪', '제갈량': '🪶', '조조': '🧔', '도겸': '👴' };
function portraitHtml(key, fallback) {
  if (!key) return `<span class="pt-fb">${fallback}</span>`;
  return `<img src="assets/img/portrait_${key}.jpg" alt="" onerror="this.outerHTML='<span class=&quot;pt-fb&quot;>${fallback}</span>'">`;
}

function renderDlgLine() {
  const [speaker, text] = dlg.lines[dlg.idx];
  $('#dlg-portrait').innerHTML = portraitHtml(PORTRAIT_FILES[speaker], PORTRAIT_EMOJI[speaker] || '🗣️');
  $('#dlg-speaker').textContent = speaker;
  $('#dlg-text').textContent = text;
  $('#dlg-progress').textContent = `${dlg.idx + 1} / ${dlg.lines.length}`;
}
$('#dialogue').addEventListener('click', () => {
  dlg.idx++;
  if (dlg.idx >= dlg.lines.length) {
    const cb = dlg.onDone;
    dlg.onDone = null;
    if (cb) cb();
  } else renderDlgLine();
});

/* ---------------- 영웅 선택 ---------------- */
let pendingStage = null;
function showHeroSelect(stage) {
  pendingStage = stage;
  const wrap = $('#hero-list');
  wrap.innerHTML = '';
  for (const id of Object.keys(HEROES)) {
    const hd = HEROES[id];
    const locked = hd.unlockStage > save.cleared + 1 || hd.unlockStage > stage.id;
    const special = stage.specialHero === id;
    const card = document.createElement('div');
    card.className = 'hero-card' + (locked ? ' locked' : '') + (special ? ' special' : '');
    const lv = heroLevel(save.heroXp[id] || 0);
    card.innerHTML = `
      ${special ? '<div class="hc-bond">⭐ 이 전장의 인연</div>' : ''}
      <div class="hc-icon" style="border-color:${hd.color}">${locked ? '<span class="pt-fb">🔒</span>' : portraitHtml(id, hd.icon)}</div>
      <div class="hc-name">${hd.name} <span class="hc-lv">Lv.${lv}</span></div>
      <div class="hc-title">${hd.title}</div>
      <div class="hc-ult">${hd.ult.icon} ${hd.ult.name}</div>
      <div class="hc-desc">${locked ? `스테이지 ${hd.unlockStage + 1} 클리어 후 해금` : (special ? '능력 강화: 체력·공격력·필살기 ↑, 쿨타임 ↓' : hd.ult.desc)}</div>`;
    if (!locked) card.onclick = () => startStage(stage, id);
    wrap.appendChild(card);
  }
  showOverlay('hero-select');
}

/* ---------------- 스테이지 시작 / 맵 ---------------- */
function startStage(stage, heroId) {
  G = newGameState(stage);
  G.heroId = heroId;
  Sprites.invalidate(); pathSampleStage = -1;
  spawnHero(heroId);
  showOverlay(null);
  screen = 'game';
  $('#hud').style.display = 'flex';
  selectClear();
  G.speed = 1;
  $('#btn-speed').textContent = '▶ x1';
  AudioSys.startBgm();
  updateHUD();
  updateUltBtn();
  updateAbilityBar();
}

function showOutro(stage, stars) {
  showDialogue(stage.outro, () => {
    $('#result').classList.remove('lose'); $('#result').classList.add('win');
    $('#result-title').textContent = '승리!';
    $('#result-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    $('#result-msg').textContent = stage.id >= STAGES.length - 1
      ? '모든 스테이지를 클리어했습니다! 유비는 한중왕에 올랐습니다. 천하통일의 꿈은 계속됩니다...'
      : `${stage.name} 클리어! 다음 전장이 기다립니다.`;
    renderResultChallenges(stage.id);
    $('#btn-result-next').style.display = stage.id >= STAGES.length - 1 ? 'none' : 'inline-block';
    showOverlay('result');
  });
}

function showStageMap() {
  screen = 'map';
  AudioSys.stopBgm();
  G = null;
  $("#hud").style.display = "none";
  $("#ability-bar").style.display = "none";
  $("#btn-ult").style.display = "none";
  $("#sel-panel").style.display = "none";
  const wrap = $('#stage-list');
  wrap.innerHTML = '';
  for (const st of STAGES) {
    const locked = st.id > save.cleared + 1;
    const stars = save.stars[st.id] || 0;
    const card = document.createElement('div');
    card.className = 'stage-card' + (locked ? ' locked' : '') + (st.id === save.cleared + 1 ? ' next' : '');
    card.innerHTML = `
      <div class="sc-num">${st.id + 1}</div>
      <div class="sc-body">
        <div class="sc-name">${locked ? '???' : st.name}</div>
        <div class="sc-sub">${locked ? '이전 전투를 승리하세요' : st.subtitle}</div>
      </div>
      <div class="sc-right">
        <div class="sc-stars">${stars ? '⭐'.repeat(stars) : (locked ? '🔒' : '')}</div>
        <div class="sc-badges">${locked ? '' : CHALLENGES.map(c => `<span class="${(save.challenges[st.id] || {})[c.id] ? 'on' : 'off'}" title="${c.name}: ${c.desc}">${c.icon}</span>`).join('')}</div>
      </div>`;
    if (!locked) {
      card.onclick = () => showDialogue(st.intro, () => showHeroSelect(st));
    }
    wrap.appendChild(card);
  }
  showOverlay('stage-map');
}

function renderResultChallenges(sid) {
  const ch = save.challenges[sid] || {};
  $('#result-challenges').innerHTML = '<div class="ch-title">도전 과제</div>' + CHALLENGES.map(c => {
    const done = !!ch[c.id];
    const isNew = G && G.newlyDone && G.newlyDone.includes(c.id);
    return `<div class="ch-item ${done ? 'done' : ''}">${c.icon} ${c.name}${isNew ? ' <b>NEW!</b>' : ''}<span class="ch-desc">${c.desc}</span></div>`;
  }).join('');
}

/* ---------------- 버튼 바인딩 ---------------- */
AudioSys.setMuted(save.muted);
function syncSoundBtn() { $('#btn-sound').textContent = AudioSys.muted ? '🔇' : '🔊'; }
syncSoundBtn();
$('#btn-sound').onclick = () => {
  save.muted = !save.muted;
  AudioSys.setMuted(save.muted);
  persistSave();
  syncSoundBtn();
};
document.addEventListener('pointerdown', () => AudioSys.unlock(), { passive: true });

$('#btn-start').onclick = () => showStageMap();
$('#btn-ult').onclick = (e) => { e.stopPropagation(); castUlt(); };
$('#btn-speed').onclick = () => {
  G.speed = G.speed === 1 ? 2 : 1;
  $('#btn-speed').textContent = G.speed === 2 ? '⏩ x2' : '▶ x1';
};
$('#btn-pause').onclick = () => {
  G.paused = !G.paused;
  $('#btn-pause').textContent = G.paused ? '▶ 재개' : '⏸ 정지';
};
$('#btn-quit').onclick = () => { if (confirm('전투를 포기하고 지도로 돌아갑니까?')) showStageMap(); };
$('#btn-restart').onclick = () => { if (G && confirm('이 전투를 처음부터 다시 시작합니까?')) startStage(G.stage, G.heroId); };
$('#btn-result-retry').onclick = () => showDialogue(STAGES[G.stage.id].intro, () => showHeroSelect(STAGES[G.stage.id]));
$('#btn-result-next').onclick = () => {
  const next = STAGES[G.stage.id + 1];
  if (next) showDialogue(next.intro, () => showHeroSelect(next));
  else showStageMap();
};
$('#btn-result-map').onclick = () => showStageMap();
$('#btn-hero-back').onclick = () => showStageMap();
$('#btn-reset').onclick = () => {
  if (!confirm('모든 진행 상황(클리어·별·영웅 성장)을 삭제하고 처음부터 시작합니다. 계속할까요?')) return;
  localStorage.removeItem(SAVE_KEY);
  save = loadSave();
  showStageMap();
};

window.addEventListener('keydown', (e) => {
  if (!G || screen !== 'game') return;
  if (e.key === 'q' || e.key === 'Q' || e.key === ' ') { e.preventDefault(); castUlt(); }
  if (e.key === '1') toggleAiming('fire');
  if (e.key === '2') toggleAiming('reinf');
  if (e.key === 'm' || e.key === 'M') $('#btn-sound').onclick();
  if (e.key === 'Escape') { G.aiming = null; selectClear(); }
});

/* ---------------- 메인 루프 ---------------- */
function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
  lastTime = ts;
  if (screen === 'game') {
    update(dt);
    draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 초기 화면
showOverlay('title');
