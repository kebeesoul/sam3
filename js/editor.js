/* ============================================================
   맵 에디터 (전장지도 → 🛠 맵 에디터)
   - 10개 스테이지의 길/부지/성채/자연물을 자유롭게 편집
   - 편집 결과는 localStorage에 저장되어 실제 플레이에 반영(newGameState가 getOverride 사용)
   - 좌표는 각 스테이지의 '월드 좌표'(확대 적용 후)를 사용
   ============================================================ */
const MapEditor = (() => {
  const KEY = 'sam3-mapedit-v1';
  const DECO_KINDS = [
    { kind: 'deco_tree', name: '나무', h: 60 },
    { kind: 'deco_pine', name: '소나무', h: 66 },
    { kind: 'deco_bamboo', name: '대나무', h: 56 },
    { kind: 'deco_bush', name: '덤불', h: 34 },
    { kind: 'deco_grove', name: '숲', h: 120 },
    { kind: 'deco_rock', name: '바위', h: 44 },
    { kind: 'deco_mountain', name: '산', h: 110 },
    { kind: 'deco_peak2', name: '쌍봉', h: 100 },
    { kind: 'deco_range_snow', name: '설산', h: 150 },
    { kind: 'deco_range_rock', name: '암산', h: 150 },
    { kind: 'deco_hut', name: '민가', h: 60 },
    { kind: 'deco_ship', name: '군선', h: 90 },
  ];
  const DECO_H = {}; DECO_KINDS.forEach(d => DECO_H[d.kind] = d.h);
  const TOOLS = [
    { id: 'move', name: '이동/선택', hint: '핸들을 끌어 위치 이동 · 빈 곳 드래그=화면 이동' },
    { id: 'path', name: '길 추가', hint: '클릭하여 활성 경로에 점 추가(끝에 이어짐)' },
    { id: 'spot', name: '부지 추가', hint: '클릭하여 건설부지 추가' },
    { id: 'fort', name: '성채 추가', hint: '클릭하여 성채 추가' },
    { id: 'deco', name: '자연 추가', hint: '팔레트에서 종류 선택 후 클릭하여 배치' },
    { id: 'delete', name: '삭제', hint: '클릭한 핸들(길점/부지/성채/자연)을 삭제' },
  ];

  let store = loadStore();
  const E = {
    stageId: 0, tool: 'move', decoKind: 'deco_tree', activePath: 0,
    snap: false, work: null, cam: { x: 0, y: 0 }, drag: null, dirty: false, hover: null,
  };

  function loadStore() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function saveStore() { localStorage.setItem(KEY, JSON.stringify(store)); }
  function getOverride(id) { return store[id] || null; }

  function defaultWork(id) {
    const s = (typeof WORLD_SCALE !== 'undefined' && WORLD_SCALE[id] != null) ? WORLD_SCALE[id] : 1;
    const scaled = scaleStage(STAGES[id], s);
    const world = scaled.world;
    const paths = (scaled.paths || [scaled.path]).map(p => p.map(pt => [Math.round(pt[0]), Math.round(pt[1])]));
    const spots = placeSpots(paths, scaled.map, world).map(sp => [sp[0], sp[1]]);
    const forts = fortPositions(paths, world).map(f => [Math.round(f.x), Math.round(f.y)]);
    return { world: { w: world.w, h: world.h }, paths, spots, forts, decos: [], hideNature: false };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function initWork(id) {
    E.stageId = id;
    E.work = store[id] ? clone(store[id]) : defaultWork(id);
    if (!E.work.decos) E.work.decos = [];
    E.activePath = 0;
    E.cam = { x: Math.round((E.work.world.w - W) / 2), y: Math.round((E.work.world.h - H) / 2) };
    E.dirty = false;
  }

  /* ---------------- 좌표/카메라 ---------------- */
  function s2w(ev) {
    const r = canvas.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * W / r.width, sy = (ev.clientY - r.top) * H / r.height;
    return { x: sx + E.cam.x, y: sy + E.cam.y, sx, sy };
  }
  const SNAP = 10;
  function snap(v) { return E.snap ? Math.round(v / SNAP) * SNAP : Math.round(v); }
  function clampCam() {
    const M = 160, wld = E.work.world;
    E.cam.x = clamp(E.cam.x, -M, Math.max(-M, wld.w - W + M));
    E.cam.y = clamp(E.cam.y, -M, Math.max(-M, wld.h - H + M));
  }

  /* ---------------- 핸들 탐색 ---------------- */
  function findHandle(p) {
    const w = E.work;
    for (let i = w.decos.length - 1; i >= 0; i--) { const d = w.decos[i]; if (Math.hypot(d.x - p.x, d.y - p.y) < Math.max(18, (d.h || 60) * 0.32)) return { type: 'deco', idx: i }; }
    for (let i = 0; i < w.forts.length; i++) { const f = w.forts[i]; if (Math.hypot(f[0] - p.x, f[1] - p.y) < 32) return { type: 'fort', idx: i }; }
    for (let i = 0; i < w.spots.length; i++) { const s = w.spots[i]; if (Math.hypot(s[0] - p.x, s[1] - p.y) < 22) return { type: 'spot', idx: i }; }
    for (let pi = 0; pi < w.paths.length; pi++) {
      const path = w.paths[pi];
      for (let ni = 0; ni < path.length; ni++) { if (Math.hypot(path[ni][0] - p.x, path[ni][1] - p.y) < 13) return { type: 'node', pi, idx: ni }; }
    }
    return null;
  }
  function moveHandle(h, x, y) {
    const w = E.work;
    if (h.type === 'deco') { w.decos[h.idx].x = x; w.decos[h.idx].y = y; }
    else if (h.type === 'fort') { w.forts[h.idx] = [x, y]; }
    else if (h.type === 'spot') { w.spots[h.idx] = [x, y]; }
    else if (h.type === 'node') { w.paths[h.pi][h.idx] = [x, y]; }
    E.dirty = true;
  }
  function deleteHandle(h) {
    const w = E.work;
    if (h.type === 'deco') w.decos.splice(h.idx, 1);
    else if (h.type === 'fort') w.forts.splice(h.idx, 1);
    else if (h.type === 'spot') w.spots.splice(h.idx, 1);
    else if (h.type === 'node') {
      w.paths[h.pi].splice(h.idx, 1);
      if (w.paths[h.pi].length < 2 && w.paths.length > 1) { w.paths.splice(h.pi, 1); E.activePath = 0; }
    }
    E.dirty = true; updateStatus();
  }

  /* ---------------- 입력 ---------------- */
  function onDown(ev) {
    if (screen !== 'editor') return;
    const p = s2w(ev);
    E.drag = { sx: p.sx, sy: p.sy, camX: E.cam.x, camY: E.cam.y, moved: false, handle: null };
    if (E.tool === 'move') { E.drag.handle = findHandle(p); }
  }
  function onMove(ev) {
    if (screen !== 'editor') return;
    const p = s2w(ev);
    E.hover = findHandle(p);
    if (!E.drag || !(ev.buttons & 1 || ev.pressure > 0)) return;
    const dx = p.sx - E.drag.sx, dy = p.sy - E.drag.sy;
    if (!E.drag.moved && Math.hypot(dx, dy) > 5) E.drag.moved = true;
    if (!E.drag.moved) return;
    if (E.drag.handle) { moveHandle(E.drag.handle, snap(p.x), snap(p.y)); }
    else { E.cam.x = E.drag.camX - dx; E.cam.y = E.drag.camY - dy; clampCam(); }
  }
  function onUp(ev) {
    if (screen !== 'editor' || !E.drag) return;
    const wasDrag = E.drag.moved; const grabbed = E.drag.handle; E.drag = null;
    if (wasDrag) return; // 드래그였으면 클릭 동작 없음
    const p = s2w(ev); const x = snap(p.x), y = snap(p.y);
    const w = E.work;
    if (E.tool === 'delete') { const h = findHandle(p); if (h) deleteHandle(h); return; }
    if (E.tool === 'path') {
      if (!w.paths.length) w.paths.push([]);
      w.paths[E.activePath].push([x, y]); E.dirty = true; updateStatus(); return;
    }
    if (E.tool === 'spot') { w.spots.push([x, y]); E.dirty = true; updateStatus(); return; }
    if (E.tool === 'fort') { w.forts.push([x, y]); E.dirty = true; updateStatus(); return; }
    if (E.tool === 'deco') { w.decos.push({ kind: E.decoKind, x, y, h: DECO_H[E.decoKind] || 60 }); E.dirty = true; updateStatus(); return; }
    // move tool, click on handle: 활성 경로 전환
    if (grabbed && grabbed.type === 'node') { E.activePath = grabbed.pi; updateStatus(); }
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  /* ---------------- 렌더 ---------------- */
  function deco(kind, x, y, h) {
    const img = (typeof SpriteImages !== 'undefined') && SpriteImages.variant(kind, null);
    if (img) { ctx.globalAlpha = 1; drawIllust(img, x, y, h); }
    else { ctx.fillStyle = 'rgba(120,160,90,0.8)'; ctx.fillRect(x - h * 0.2, y - h, h * 0.4, h); }
  }
  function drawRoad(path, active) {
    if (path.length < 2) return;
    const th = STAGES[E.stageId].theme;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
    ctx.strokeStyle = 'rgba(60,40,20,0.55)'; ctx.lineWidth = 52; ctx.stroke();
    ctx.strokeStyle = th.path || '#cdb58a'; ctx.lineWidth = 44; ctx.stroke();
    if (active) { ctx.strokeStyle = 'rgba(255,220,120,0.25)'; ctx.lineWidth = 6; ctx.stroke(); }
  }
  function grid(wld) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = 0; x <= wld.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, wld.h); ctx.stroke(); }
    for (let y = 0; y <= wld.h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(wld.w, y); ctx.stroke(); }
  }
  function dot(x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function label(x, y, text, color) {
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y);
  }
  function render() {
    if (!E.work) return;
    clampCam();
    const wld = E.work.world, th = STAGES[E.stageId].theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a140c'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-E.cam.x, -E.cam.y);
    // 월드 배경
    ctx.fillStyle = th.ground || '#3f7d3a'; ctx.fillRect(0, 0, wld.w, wld.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, wld.w - 2, wld.h - 2);
    if (E.snap) grid(wld);
    // 길
    for (let pi = 0; pi < E.work.paths.length; pi++) drawRoad(E.work.paths[pi], pi === E.activePath);
    // 게이트(출발)
    for (const p of E.work.paths) if (p.length) deco('deco_gate', p[0][0], p[0][1] + 18, 78);
    // 자연물
    for (const d of E.work.decos) deco(d.kind, d.x, d.y, d.h || 60);
    // 성채
    for (const f of E.work.forts) deco('deco_fortress', f[0], f[1] + 40, 120);
    // 부지
    for (let i = 0; i < E.work.spots.length; i++) {
      const s = E.work.spots[i];
      deco('deco_spot', s[0], s[1] + 22, 50);
      dot(s[0], s[1], 5, '#ffe082', '#7a5b15');
    }
    // 핸들 오버레이
    for (let pi = 0; pi < E.work.paths.length; pi++) {
      const path = E.work.paths[pi], active = pi === E.activePath;
      ctx.globalAlpha = 1;
      for (let ni = 0; ni < path.length; ni++) {
        const n = path[ni];
        dot(n[0], n[1], active ? 7 : 5, active ? '#ffd24a' : 'rgba(200,200,200,0.7)', '#222');
        if (ni === 0) label(n[0], n[1] - 12, '출발', '#9fe0ff');
        if (ni === path.length - 1) label(n[0], n[1] - 12, '도착', '#ff9f9f');
      }
    }
    for (const f of E.work.forts) dot(f[0], f[1], 8, 'rgba(120,180,255,0.9)', '#103');
    // 호버 강조
    if (E.hover) {
      const hp = hoverPos(E.hover);
      if (hp) { ctx.globalAlpha = 1; dot(hp[0], hp[1], 12, 'rgba(255,255,255,0.0)', E.tool === 'delete' ? '#ff5a5a' : '#fff'); }
    }
    ctx.restore();
    // 화면 고정 안내
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tool = TOOLS.find(t => t.id === E.tool);
    ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgba(20,12,6,0.7)'; ctx.fillRect(0, H - 24, W, 24);
    ctx.globalAlpha = 1; label(W / 2, H - 8, `[${tool.name}] ${tool.hint}`, '#ffe9a8');
  }
  function hoverPos(h) {
    const w = E.work;
    if (h.type === 'deco') return [w.decos[h.idx].x, w.decos[h.idx].y];
    if (h.type === 'fort') return w.forts[h.idx];
    if (h.type === 'spot') return w.spots[h.idx];
    if (h.type === 'node') return w.paths[h.pi][h.idx];
    return null;
  }

  /* ---------------- UI ---------------- */
  let ui = null;
  function buildUI() {
    if (ui) return;
    ui = document.createElement('div');
    ui.id = 'editor-ui';
    const stageOpts = STAGES.map(s => `<option value="${s.id}">${s.id + 1}. ${s.name}</option>`).join('');
    const toolBtns = TOOLS.map(t => `<button class="ed-btn ed-tool" data-tool="${t.id}">${t.name}</button>`).join('');
    const pal = DECO_KINDS.map(d => `<button class="ed-pal" data-kind="${d.kind}" title="${d.name}">${d.name}</button>`).join('');
    ui.innerHTML = `
      <div class="ed-row">
        <b class="ed-h">🛠 맵 에디터</b>
        <select id="ed-stage">${stageOpts}</select>
        <span class="ed-tools">${toolBtns}</span>
        <label class="ed-chk"><input type="checkbox" id="ed-snap"> 격자맞춤</label>
        <span class="ed-sp"></span>
        <button class="ed-btn" id="ed-addpath">+경로</button>
        <button class="ed-btn" id="ed-delpath">-경로</button>
        <select id="ed-activepath"></select>
        <span class="ed-sp"></span>
        <button class="ed-btn save" id="ed-save">💾 저장</button>
        <button class="ed-btn" id="ed-test">▶ 테스트</button>
        <button class="ed-btn" id="ed-export">⤓ 내보내기</button>
        <button class="ed-btn danger" id="ed-reset">↺ 기본값</button>
        <button class="ed-btn" id="ed-close">✕ 닫기</button>
      </div>
      <div class="ed-row ed-palrow" id="ed-palrow">${pal}</div>
      <div class="ed-row ed-status" id="ed-status"></div>`;
    document.body.appendChild(ui);

    ui.querySelector('#ed-stage').onchange = (e) => switchStage(+e.target.value);
    ui.querySelectorAll('.ed-tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    ui.querySelectorAll('.ed-pal').forEach(b => b.onclick = () => { E.decoKind = b.dataset.kind; refreshUI(); });
    ui.querySelector('#ed-snap').onchange = (e) => { E.snap = e.target.checked; };
    ui.querySelector('#ed-addpath').onclick = () => { E.work.paths.push([[E.cam.x + W / 2 - 60, E.cam.y + H / 2], [E.cam.x + W / 2 + 60, E.cam.y + H / 2]]); E.activePath = E.work.paths.length - 1; E.dirty = true; refreshUI(); };
    ui.querySelector('#ed-delpath').onclick = () => { if (E.work.paths.length > 1) { E.work.paths.splice(E.activePath, 1); E.activePath = 0; E.dirty = true; refreshUI(); } };
    ui.querySelector('#ed-activepath').onchange = (e) => { E.activePath = +e.target.value; };
    ui.querySelector('#ed-save').onclick = saveCurrent;
    ui.querySelector('#ed-test').onclick = testPlay;
    ui.querySelector('#ed-export').onclick = exportJSON;
    ui.querySelector('#ed-reset').onclick = resetStage;
    ui.querySelector('#ed-close').onclick = close;
  }
  function setTool(t) { E.tool = t; refreshUI(); }
  function refreshUI() {
    if (!ui) return;
    ui.querySelector('#ed-stage').value = E.stageId;
    ui.querySelector('#ed-snap').checked = E.snap;
    ui.querySelectorAll('.ed-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === E.tool));
    ui.querySelectorAll('.ed-pal').forEach(b => b.classList.toggle('active', b.dataset.kind === E.decoKind));
    ui.querySelector('#ed-palrow').style.display = E.tool === 'deco' ? 'flex' : 'none';
    const apSel = ui.querySelector('#ed-activepath');
    apSel.innerHTML = E.work.paths.map((p, i) => `<option value="${i}">경로 ${i + 1} (${p.length}점)</option>`).join('');
    apSel.value = E.activePath;
    updateStatus();
  }
  function updateStatus() {
    if (!ui) return;
    const w = E.work;
    ui.querySelector('#ed-status').innerHTML =
      `길 ${w.paths.length} · 부지 ${w.spots.length} · 성채 ${w.forts.length} · 자연 ${w.decos.length} · 월드 ${w.world.w}×${w.world.h}` +
      (E.dirty ? ' · <span class="ed-dirty">● 저장 안 됨</span>' : ' · <span class="ed-saved">저장됨</span>');
  }

  /* ---------------- 액션 ---------------- */
  function switchStage(id) {
    if (E.dirty && !confirm('저장하지 않은 변경이 있습니다. 다른 스테이지로 이동할까요?')) { refreshUI(); return; }
    initWork(id); refreshUI();
  }
  function saveCurrent() {
    store[E.stageId] = clone(E.work); saveStore(); E.dirty = false; updateStatus();
    toast('이 스테이지 맵을 저장했습니다 — 플레이에 반영됩니다');
  }
  function resetStage() {
    if (!confirm('이 스테이지를 기본 맵으로 되돌립니다. (저장된 편집 삭제)')) return;
    delete store[E.stageId]; saveStore(); initWork(E.stageId); refreshUI();
    toast('기본 맵으로 되돌렸습니다');
  }
  function exportJSON() {
    const json = JSON.stringify(store, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    console.log('[MapEditor] 저장된 모든 편집:\n' + json);
    toast('편집 JSON을 클립보드/콘솔에 복사했습니다');
  }
  function testPlay() {
    saveCurrent();
    const st = STAGES[E.stageId];
    close(true);
    if (typeof startStage === 'function') startStage(st, st.specialHero || 'liubei');
  }
  function toast(msg) {
    let t = document.getElementById('ed-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ed-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function open() {
    buildUI();
    initWork(0);
    screen = 'editor';
    if (typeof showOverlay === 'function') showOverlay(null);
    ['#hud', '#ability-bar', '#btn-ult', '#sel-panel'].forEach(s => { const el = document.querySelector(s); if (el) el.style.display = 'none'; });
    document.body.classList.add('editing');
    ui.style.display = 'flex';
    refreshUI();
  }
  function close(skipMap) {
    if (!skipMap && E.dirty && !confirm('저장하지 않은 변경이 있습니다. 편집기를 닫을까요?')) return;
    document.body.classList.remove('editing');
    if (ui) ui.style.display = 'none';
    if (!skipMap && typeof showStageMap === 'function') showStageMap();
  }

  return { open, render, getOverride };
})();
