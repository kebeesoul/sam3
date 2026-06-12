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

/* ---------------- 게임 상태 ---------------- */
let G = null;          // 현재 스테이지 런타임 상태
let screen = 'title';  // title | map | dialogue | game
let lastTime = 0;

function newGameState(stage) {
  return {
    stage,
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
    heroDeaths: 0,
    earlyCalls: 0,
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
function makeEnemy(typeId) {
  const base = ENEMY_TYPES[typeId] || BOSS_TYPES[typeId];
  const isBoss = !!BOSS_TYPES[typeId];
  // 스테이지 진행에 따른 약간의 체력 보정 (보스는 스테이지별로 이미 튜닝됨)
  const hpScale = isBoss ? 1 : 1 + G.stage.id * 0.03;
  return {
    typeId, ...base,
    isBoss,
    hp: Math.round(base.hp * hpScale), maxHp: Math.round(base.hp * hpScale),
    progress: 0,
    x: G.stage.path[0][0], y: G.stage.path[0][1],
    slow: 0, stun: 0, burn: 0, burnTime: 0,
    blocker: null,         // 자신을 막고 있는 아군 유닛
    atkCd: 0,
    skillCd: isBoss ? 6 : 0,
    rage: 1,
    wobble: Math.random() * Math.PI * 2,
    dead: false, escaped: false,
  };
}

function queueWave(waveIdx) {
  const wave = G.stage.waves[waveIdx];
  for (const [type, count, interval, delay] of wave) {
    for (let i = 0; i < count; i++) {
      G.spawnQueue.push({ type, at: G.time + delay + i * interval });
    }
  }
  G.spawnQueue.sort((a, b) => a.at - b.at);
}

/* ---------------- 아군 보병 / 영웅 ---------------- */
function makeSoldier(tower, lv, idx) {
  const rp = tower.rally || { x: nearestPathPoint(tower.x, tower.y).x, y: nearestPathPoint(tower.x, tower.y).y };
  const ang = idx * Math.PI;
  return {
    kind: 'soldier', tower,
    hp: lv.soldierHp, maxHp: lv.soldierHp, dmg: lv.soldierDmg,
    x: rp.x + Math.cos(ang) * 14, y: rp.y + Math.sin(ang) * 14,
    homeOff: ang,
    target: null, atkCd: 0, dead: false, respawnT: 0,
  };
}
function nearestPathPoint(x, y) {
  const path = G.stage.path;
  let best = null, bestD = Infinity;
  const total = pathLength(path);
  for (let d = 0; d <= total; d += 10) {
    const p = pointAt(path, d);
    const dd = Math.hypot(p.x - x, p.y - y);
    if (dd < bestD) { bestD = dd; best = { ...p, d }; }
  }
  return best;
}

function spawnHero(heroId) {
  const def = HEROES[heroId];
  const start = pointAt(G.stage.path, pathLength(G.stage.path) * 0.65);
  const xp = save.heroXp[heroId] || 0;
  const level = heroLevel(xp);
  const mul = heroStatMul(level);
  G.hero = {
    kind: 'hero', def,
    level, xp,
    maxHp: Math.round(def.hp * mul), hp: Math.round(def.hp * mul),
    dmgScaled: [def.dmg[0] * mul, def.dmg[1] * mul],
    ultMul: 1 + (level - 1) * 0.06,
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
  let dmg = amount;
  if (!opts.magic) dmg *= (1 - (enemy.shielded ? 0.9 : enemy.armor));
  enemy.hp -= dmg;
  if (opts.burn) { enemy.burn = Math.max(enemy.burn, opts.burn); enemy.burnTime = 3; }
  if (opts.stun) enemy.stun = Math.max(enemy.stun, opts.stun);
  if (enemy.hp <= 0) {
    enemy.dead = true;
    G.gold += enemy.bounty;
    addFloater(enemy.x, enemy.y, `+${enemy.bounty}`, '#ffd700');
    addEffect('poof', enemy.x, enemy.y, 0.4);
    spawnParts(enemy.x, enemy.y - 6, 6, { color: ['#c8b89a', '#a89878', '#888'], size: 3, speed: 50, up: 40, life: 0.5 });
    AudioSys.play('coin', 120);
    // 영웅 경험치: 근처에서 잡으면 전액, 멀면 30% (부대 지원 몫)
    if (G.hero) {
      const near = !G.hero.dead && dist(G.hero, enemy) < 220;
      gainHeroXp(Math.max(1, Math.round(enemy.bounty * (near ? 1 : 0.3))));
    }
    if (enemy.isBoss) {
      addFloater(enemy.x, enemy.y - 20, `${enemy.name} 격파!`, '#ff6b6b', 22);
      G.shake = 0.5;
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
  G.time += dt;
  if (G.shake > 0) G.shake -= dt;

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
    G.enemies.push(makeEnemy(s.type));
  }

  updateEnemies(dt);
  updateTowers(dt);
  updateHero(dt);
  updateProjectiles(dt);

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
  updateHUD();
}

function updateEnemies(dt) {
  const totalLen = pathLength(G.stage.path);
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.wobble += dt * 6;
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
    const p = pointAt(G.stage.path, e.progress);
    e.x = p.x; e.y = p.y;

    if (e.progress >= totalLen) {
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
      if (e.typeId === 'xiahouYuan') { e.slow = 0; e.progress += 40; }
      break; }
    case 'caoRen': e.shielded = true; e.shieldT = 3; break;
    case 'lvBu': { // 주변 아군 일소
      for (const ally of allAllies()) if (dist(ally, e) < 120) { ally.hp -= 70; addEffect('slash', ally.x, ally.y, 0.3); if (ally.hp <= 0) killAlly(ally); }
      G.shake = 0.3;
      break; }
    case 'zhangHe': case 'caoChun': e.progress += 60; addEffect('dash', e.x, e.y, 0.4); break;
    case 'xiahouDun': e.rage = 1.6; break;
    case 'caiMao': { // 수군 소환
      for (let i = 0; i < 2; i++) { const n = makeEnemy('navy'); n.progress = Math.max(0, e.progress - 30 - i * 25); G.enemies.push(n); }
      break; }
    case 'zhangRen': { // 저격
      const targets = allAllies(); if (targets.length) { const t = targets[Math.floor(Math.random() * targets.length)]; t.hp -= 90; addEffect('bolt', t.x, t.y, 0.3); if (t.hp <= 0) killAlly(t); }
      break; }
  }
}

function allAllies() {
  const list = [];
  for (const t of G.towers) for (const s of t.soldiers) if (!s.dead) list.push(s);
  if (G.hero && !G.hero.dead) list.push(G.hero);
  return list;
}
function killAlly(a) {
  a.dead = true;
  a.respawnT = a.kind === 'hero' ? a.def.respawn : TOWER_TYPES.barracks.levels[a.tower.level].respawn;
  for (const e of G.enemies) if (e.blocker === a) e.blocker = null;
  addEffect('poof', a.x, a.y, 0.4);
  if (a.kind === 'hero') {
    G.heroDeaths++;
    AudioSys.play('heroDie');
    addFloater(a.x, a.y, `${a.def.name} 부상! 후방 치료 중...`, '#aaa', 14);
  }
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
      t.cooldown = lv.rate;
      fireProjectile(t, best, lv);
      AudioSys.play(lv.proj, 70);
    }
  }
}

function updateBarracks(t, lv, dt) {
  // 보충
  if (t.soldiers.length < 2) {
    for (let i = t.soldiers.length; i < 2; i++) t.soldiers.push(makeSoldier(t, lv, i));
  }
  for (const s of t.soldiers) {
    if (s.dead) {
      s.respawnT -= dt;
      if (s.respawnT <= 0) {
        Object.assign(s, makeSoldier(t, lv, s.homeOff > 1 ? 1 : 0));
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
      const anchor = { x: rally.x + Math.cos(u.homeOff || 0) * 14, y: rally.y + Math.sin(u.homeOff || 0) * 14 };
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
        dealDamage(e, rollDmg(u.dmg));
        addEffect('slash', e.x, e.y, 0.15, { ang: rand(-1.2, 1.2) });
      }
    }
  } else {
    // 집결지로 복귀
    const hx = rally.x + Math.cos(u.homeOff || 0) * 14, hy = rally.y + Math.sin(u.homeOff || 0) * 14;
    const d = Math.hypot(hx - u.x, hy - u.y);
    if (d > 4) { u.x += (hx - u.x) / d * moveSpeed * dt; u.y += (hy - u.y) / d * moveSpeed * dt; }
  }
}

function updateHero(dt) {
  const h = G.hero;
  if (!h) return;
  if (h.ultCd > 0) h.ultCd -= dt;
  if (h.dead) {
    h.respawnT -= dt;
    if (h.respawnT <= 0) { h.dead = false; h.hp = h.maxHp * 0.6; addFloater(h.x, h.y, `${h.def.name} 복귀!`, '#7bed9f', 15); }
    updateUltBtn();
    return;
  }
  h.hp = Math.min(h.maxHp, h.hp + h.def.regen * dt);

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
        dealDamage(best, rollDmg(h.dmgScaled), { magic: h.def.magic });
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
  h.ultCd = u.cd;
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
        for (const e of G.enemies) if (!e.dead && dist(tgt, e) <= lv.splash) dealDamage(e, rollDmg(lv.dmg), { magic: lv.magic });
      } else {
        dealDamage(tgt, rollDmg(lv.dmg), { magic: lv.magic, burn: lv.burn });
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
  const stars = G.lives >= 18 ? 3 : G.lives >= 10 ? 2 : 1;
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
    const total = pathLength(G.stage.path);
    for (let d = 0; d <= total; d += 16) pathSampleCache.push(pointAt(G.stage.path, d));
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
  ctx.restore();
}

function shadow(x, y, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
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

function drawSpots() {
  const img = Sprites.spot();
  for (let i = 0; i < G.towers.length; i++) {
    const t = G.towers[i];
    if (t.type) continue;
    if (G.selected === i) {
      ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,230,140,0.35)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,110,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    }
    shadow(t.x, t.y + 8, 13);
    drawSprite(img, t.x, t.y + 12, 30);
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
    drawSprite(Sprites.tower(t.type, t.level), t.x, t.y + 18, 62);
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
  const h = G.hero;
  if (h) list.push({ kind: 'hero', u: h, y: h.y });
  list.sort((a, b) => a.y - b.y);

  for (const it of list) {
    const u = it.u;
    if (it.kind === 'enemy') {
      const e = u;
      const frame = Math.floor(e.wobble * 1.6) % 2;
      const ahead = pointAt(G.stage.path, e.progress + 6);
      const face = (e.blocker && !e.blocker.dead) ? (e.blocker.x >= e.x ? 1 : -1) : (ahead.x >= e.x - 0.3 ? 1 : -1);
      const hgt = e.isBoss ? 38 : 26;
      shadow(e.x, e.y + 9, e.isBoss ? 14 : 9);
      if (e.shielded) {
        ctx.beginPath(); ctx.arc(e.x, e.y - 8, 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,180,255,0.28)'; ctx.fill();
        ctx.strokeStyle = 'rgba(160,210,255,0.7)'; ctx.stroke();
      }
      drawSprite(Sprites.unit(e.typeId, frame), e.x, e.y + 9, hgt, face);
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
        drawHpBar(e.x, e.y - hgt + 1, 46, e.hp / e.maxHp, '#e67e22');
      } else {
        drawHpBar(e.x, e.y - hgt + 1, 24, e.hp / e.maxHp);
      }
    } else if (it.kind === 'soldier') {
      const s = u;
      const face = s.target && !s.target.dead ? (s.target.x >= s.x ? 1 : -1) : 1;
      shadow(s.x, s.y + 8, 8);
      drawSprite(Sprites.unit('soldier', Math.floor(G.time * 4 + s.homeOff) % 2), s.x, s.y + 8, 24, face);
      drawHpBar(s.x, s.y - 22, 20, s.hp / s.maxHp, '#4aa4e0');
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
      const face = hh.target && !hh.target.dead ? (hh.target.x >= hh.x ? 1 : -1)
        : (Math.abs(hh.tx - hh.x) > 2 ? (hh.tx >= hh.x ? 1 : -1) : 1);
      // 선택/오라
      ctx.beginPath(); ctx.arc(hh.x, hh.y + 6, 13, 0, Math.PI * 2);
      ctx.strokeStyle = hh.def.color; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
      shadow(hh.x, hh.y + 8, 10);
      const moving = Math.hypot(hh.tx - hh.x, hh.ty - hh.y) > 6 || (hh.target && !hh.target.dead);
      drawSprite(Sprites.unit(hh.def.id, moving ? Math.floor(G.time * 5) % 2 : 0), hh.x, hh.y + 9, 30, face);
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
      ctx.strokeText(`${hh.def.name} Lv.${hh.level}`, hh.x, hh.y - 30);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${hh.def.name} Lv.${hh.level}`, hh.x, hh.y - 30);
      drawHpBar(hh.x, hh.y - 27, 32, hh.hp / hh.maxHp, '#3a9ae8');
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

/* ---------------- 건설 메뉴 ---------------- */
function openBuildMenu(idx) {
  G.selected = idx;
  const t = G.towers[idx];
  const menu = $('#build-menu');
  menu.innerHTML = '';
  menu.style.display = 'block';

  if (!t.type) {
    menu.innerHTML = '<div class="bm-title">건설</div>';
    for (const key of Object.keys(TOWER_TYPES)) {
      const def = TOWER_TYPES[key];
      const cost = def.levels[0].cost;
      const btn = document.createElement('button');
      btn.className = 'bm-btn' + (G.gold < cost ? ' disabled' : '');
      btn.innerHTML = `<span class="bm-icon">${def.icon}</span><span class="bm-name">${def.name}</span><span class="bm-cost">💰${cost}</span>`;
      btn.title = def.desc;
      btn.onclick = () => {
        if (G.gold < cost) return;
        G.gold -= cost;
        t.type = key; t.level = 0; t.cooldown = 0;
        if (key === 'barracks') { t.rally = nearestPathPoint(t.x, t.y); t.soldiers = []; }
        closeBuildMenu();
        updateHUD();
      };
      menu.appendChild(btn);
    }
  } else {
    const def = TOWER_TYPES[t.type];
    menu.innerHTML = `<div class="bm-title">${def.levels[t.level].name} ★${t.level + 1}</div>`;
    if (t.level < def.levels.length - 1) {
      const next = def.levels[t.level + 1];
      const btn = document.createElement('button');
      btn.className = 'bm-btn' + (G.gold < next.cost ? ' disabled' : '');
      btn.innerHTML = `<span class="bm-icon">⬆️</span><span class="bm-name">${next.name}</span><span class="bm-cost">💰${next.cost}</span>`;
      btn.onclick = () => {
        if (G.gold < next.cost) return;
        G.gold -= next.cost;
        t.level++;
        if (t.type === 'barracks') for (const s of t.soldiers) if (!s.dead) { s.maxHp = next.soldierHp; s.hp = next.soldierHp; s.dmg = next.soldierDmg; }
        closeBuildMenu(); updateHUD();
      };
      menu.appendChild(btn);
    }
    // 판매
    let spent = 0;
    for (let l = 0; l <= t.level; l++) spent += def.levels[l].cost;
    const refund = Math.floor(spent * 0.6);
    const sell = document.createElement('button');
    sell.className = 'bm-btn sell';
    sell.innerHTML = `<span class="bm-icon">🗑️</span><span class="bm-name">판매</span><span class="bm-cost">+💰${refund}</span>`;
    sell.onclick = () => {
      G.gold += refund;
      for (const e of G.enemies) if (e.blocker && e.blocker.tower === t) e.blocker = null;
      t.type = null; t.level = 0; t.soldiers = [];
      closeBuildMenu(); updateHUD();
    };
    menu.appendChild(sell);
  }
  // 메뉴 위치
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / W, scaleY = rect.height / H;
  menu.style.left = clamp(t.x * scaleX + rect.left - menu.offsetWidth / 2, 8, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = clamp(t.y * scaleY + rect.top - menu.offsetHeight - 30, 8, window.innerHeight - 60) + 'px';
}
function closeBuildMenu() {
  if (G) G.selected = null;
  $('#build-menu').style.display = 'none';
}

/* ---------------- 캔버스 입력 ---------------- */
let heroSelected = false;
canvas.addEventListener('click', (ev) => {
  if (!G || G.over) return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * W / rect.width;
  const y = (ev.clientY - rect.top) * H / rect.height;

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

  // 영웅 클릭 → 선택
  const h = G.hero;
  if (h && !h.dead && Math.hypot(h.x - x, h.y - y) < HIT_R) {
    heroSelected = !heroSelected;
    closeBuildMenu();
    addFloater(h.x, h.y - 30, heroSelected ? '이동 지점을 클릭' : '대기', '#fff', 13);
    return;
  }
  // 영웅 이동 명령
  if (heroSelected && h && !h.dead) {
    h.tx = clamp(x, 16, W - 16); h.ty = clamp(y, 16, H - 16);
    heroSelected = false;
    return;
  }

  // 건설부지 / 타워 클릭
  for (let i = 0; i < G.towers.length; i++) {
    const t = G.towers[i];
    if (Math.hypot(t.x - x, t.y - y) < HIT_R) {
      openBuildMenu(i);
      return;
    }
  }
  closeBuildMenu();
});

/* ---------------- 다이얼로그 (시나리오) ---------------- */
let dlg = { lines: [], idx: 0, onDone: null };
function showDialogue(lines, onDone) {
  dlg = { lines, idx: 0, onDone };
  showOverlay('dialogue');
  renderDlgLine();
}
function renderDlgLine() {
  const [speaker, text] = dlg.lines[dlg.idx];
  const portraits = { '유비': '👑', '관우': '🟥', '장비': '🐍', '조운': '⚪', '제갈량': '🪶', '조조': '🧔', '도겸': '👴' };
  $('#dlg-portrait').textContent = portraits[speaker] || '🗣️';
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
    const card = document.createElement('div');
    card.className = 'hero-card' + (locked ? ' locked' : '');
    const lv = heroLevel(save.heroXp[id] || 0);
    card.innerHTML = `
      <div class="hc-icon" style="border-color:${hd.color}">${locked ? '🔒' : hd.icon}</div>
      <div class="hc-name">${hd.name} <span class="hc-lv">Lv.${lv}</span></div>
      <div class="hc-title">${hd.title}</div>
      <div class="hc-ult">${hd.ult.icon} ${hd.ult.name}</div>
      <div class="hc-desc">${locked ? `스테이지 ${hd.unlockStage + 1} 클리어 후 해금` : hd.ult.desc}</div>`;
    if (!locked) card.onclick = () => startStage(stage, id);
    wrap.appendChild(card);
  }
  showOverlay('hero-select');
}

/* ---------------- 스테이지 시작 / 맵 ---------------- */
function startStage(stage, heroId) {
  G = newGameState(stage);
  Sprites.invalidate(); pathSampleStage = -1;
  spawnHero(heroId);
  showOverlay(null);
  screen = 'game';
  $('#hud').style.display = 'flex';
  closeBuildMenu();
  heroSelected = false;
  G.speed = 1;
  $('#btn-speed').textContent = '▶ x1';
  AudioSys.startBgm();
  updateHUD();
  updateUltBtn();
}

function showOutro(stage, stars) {
  showDialogue(stage.outro, () => {
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
  $('#hud').style.display = 'none';
  closeBuildMenu();
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
$('#btn-result-retry').onclick = () => showDialogue(STAGES[G.stage.id].intro, () => showHeroSelect(STAGES[G.stage.id]));
$('#btn-result-next').onclick = () => {
  const next = STAGES[G.stage.id + 1];
  if (next) showDialogue(next.intro, () => showHeroSelect(next));
  else showStageMap();
};
$('#btn-result-map').onclick = () => showStageMap();
$('#btn-hero-back').onclick = () => showStageMap();

window.addEventListener('keydown', (e) => {
  if (!G || screen !== 'game') return;
  if (e.key === 'q' || e.key === 'Q' || e.key === ' ') { e.preventDefault(); castUlt(); }
  if (e.key === 'm' || e.key === 'M') $('#btn-sound').onclick();
  if (e.key === 'Escape') closeBuildMenu();
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
