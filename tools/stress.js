// 배포 전제 부하 시험 — 후반 최악을 만든다
window.__stress = (opts = {}) => {
  const g = window.__game;
  const walls = opts.walls ?? 500, en = opts.en ?? 120;
  if (!g.started) g.beginMatch();
  g.restart();
  g.P.enemy.spawnDelay = 0;
  for (let k = 0; k < 9; k++) g.advanceStage();
  // 벽을 촘촘히 깐다 (후반 방어선)
  let built = 0;
  outer:
  for (let j = 8; j < g.CELLS - 8; j += 2)
    for (let i = 8; i < g.CELLS - 8; i += 2) {
      if (built >= walls) break outer;
      if (g.addObstacle(i, j, false, false, 'p')) built++;
    }
  g.refreshClearance();
  g.setEnemyCount(en);
  g.step(2);
  return { 벽: g.obstacles.size, 적: g.enemies.length, 건물: g.buildings.length };
};

// 프레임을 시뮬/렌더로 갈라 재고, GPU까지 동기화한다
window.__frame = (n = 120) => {
  const g = window.__game, R = g.renderer, gl = R.getContext();
  const S = (v) => Math.round(v * 100) / 100;
  const stat = (t) => { t.sort((a, b) => a - b);
    return { avg: S(t.reduce((a, b) => a + b, 0) / t.length), p50: S(t[t.length >> 1]),
             p95: S(t[Math.floor(t.length * 0.95)]), max: S(t[t.length - 1]) }; };
  const tk = [], rd = [];
  for (let k = 0; k < n; k++) {
    let a = performance.now(); g.tick(1 / 60); tk.push(performance.now() - a);
    a = performance.now(); R.render(g.scene, g.activeCam()); gl.finish(); rd.push(performance.now() - a);
  }
  R.info.reset(); R.render(g.scene, g.activeCam());
  return { tick: stat(tk), render: stat(rd),
           calls: R.info.render.calls, tris: R.info.render.triangles,
           적: g.enemies.length, 벽: g.obstacles.size,
           합계avg: S(stat(tk).avg + stat(rd).avg) };
};

// 시뮬 내부를 함수별로 쪼갠다
window.__simParts = (secs = 2) => {
  const g = window.__game;
  const acc = {}, orig = {};
  const names = ['refreshClearance', 'refreshTerritory', 'refreshReach', 'planEnemyPath',
                 'nearestSafeSpot', 'updatePlayer', 'updateLocalUI', 'astar', 'computeClearance'];
  for (const nm of names) {
    if (typeof g[nm] !== 'function') continue;
    orig[nm] = g[nm];
    const f = orig[nm];
    acc[nm] = 0;
    try {
      Object.defineProperty(g, nm, { configurable: true, writable: true,
        value: function (...a) { const t = performance.now();
          try { return f.apply(this, a); } finally { acc[nm] += performance.now() - t; } } });
    } catch { delete acc[nm]; }
  }
  const n = Math.round(secs * 60), t0 = performance.now();
  for (let k = 0; k < n; k++) g.tick(1 / 60);
  const total = performance.now() - t0;
  for (const nm of Object.keys(orig)) try { g[nm] = orig[nm]; } catch {}
  const out = { 프레임: n, 총ms: Math.round(total), 프레임당ms: Math.round(total / n * 100) / 100 };
  for (const [k, v] of Object.entries(acc))
    if (v > 0.5) out[k] = { 총ms: Math.round(v), 프레임당ms: Math.round(v / n * 1000) / 1000 };
  return out;
};

// 장면 구성 — 무엇이 draw call을 쓰나
window.__sceneBreak = () => {
  const g = window.__game;
  const wall = new Set(); for (const ob of g.obstacles.values()) if (ob.mesh) wall.add(ob.mesh);
  const roots = new Map();
  const tag = (l, n) => { for (const e of l) if (e.vis && e.vis.group) roots.set(e.vis.group, n); };
  tag(g.enemies, '적'); tag(g.workers, '일꾼'); tag(g.guards, '방어병');
  for (const p of g.players) if (p.vis) roots.set(p.vis.group, '플레이어');
  for (const b of g.buildings) if (b.mesh) roots.set(b.mesh, '건물');
  const vis = {}, mats = new Set(), geos = new Set();
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o, label = null;
    while (p) { if (roots.has(p)) { label = roots.get(p); break; } p = p.parent; }
    if (!label) label = wall.has(o) ? '벽·지형' : '기타';
    vis[label] = (vis[label] || 0) + 1;
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m.uuid));
    if (o.geometry) geos.add(o.geometry.uuid);
  });
  return { 보이는메시: vis, 총메시: Object.values(vis).reduce((a, b) => a + b, 0),
           서로다른재질: mats.size, 서로다른지오메트리: geos.size };
};
'stress loaded';

// ============================================================
// 성능 회귀 관문 (D133)
//  "최적화가 무효화되진 않았나"를 **사람의 주의력에 맡기지 않는다.**
//  시각 작업(텍스처·모델 교체)을 한 뒤 이걸 돌려 통과하는지 본다.
//
//  ⚠ draw call은 **카메라가 뭘 비추느냐**에 따라 달라진다 — 반드시 카메라를 고정한다.
//  ⚠ 그림자맵이 갱신되는 프레임에만 그림자 패스(수백 call)가 붙는다.
//     둘 다 재고 각각 따로 본다.
//  ⚠ GLB는 비동기로 온다. 로드 전에 재면 절차적 폴백(마리당 16메시)을 재게 된다.
// ============================================================
window.__perfBaseline = {
  // 아래 값은 D131까지 최적화한 뒤의 실측(적 200·벽 520, 고정 카메라).
  // 여유를 두되, 구조가 무너지면(인스턴싱 해제 등) 반드시 걸리게 잡았다.
  // 실측(적 199·벽 540, 고정 카메라): 정상 410 · 그림자 703 · tick p95 7.8ms
  // 상한은 실측 +15% 정도. 구조가 무너지면(인스턴싱 해제 = 벽 500장이 500 call)
  // 두세 배로 튀므로 반드시 걸린다. 잔가지 변동으로는 안 걸린다.
  instancedMeshes: 3,        // 성한 기둥 · 금 간 기둥 · 지형
  maxEnemyMeshes: 2,         // GLB 병합 결과 마리당 1 (여유 1)
  maxCallsSteady: 470,       // 그림자 갱신 없는 프레임
  maxCallsShadow: 800,       // 그림자 갱신 프레임
  // ⚠ tick은 **기기 부하에 크게 흔들린다.** 같은 빌드가 4ms도 14ms도 나온다
  //    (함정 8). 그래서 상한을 느슨하게 둔다 — 진짜 회귀(예: A* 예산을 없애면
  //    115ms까지 갔다)는 여전히 걸리고, 잡음으로는 안 걸린다.
  //    **믿을 신호는 draw call과 구조 검사다** — 그쪽은 기기와 무관하다.
  maxTickP95: 25,            // ms (참고용. 걸리면 짝지어 다시 재 볼 것)
};

window.__perfGuard = async (opts = {}) => {
  const g = window.__game, R = g.renderer;
  const B = Object.assign({}, window.__perfBaseline, opts.baseline || {});
  window.__stress({ walls: 520, en: 200 });
  // GLB가 올 때까지 기다린다 — 안 그러면 폴백을 재게 된다
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    const e = g.enemies.find((x) => x.type === 'chaser');
    let n = 0; if (e) e.vis.group.traverse((o) => { if (o.isMesh && o.visible) n++; });
    if (n <= B.maxEnemyMeshes) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  for (let k = 0; k < 150; k++) g.tick(1 / 60);
  g.syncWallInstances();
  // **카메라 고정** — 맵 한가운데를 위에서 넓게 본다
  const cam = g.activeCam();
  cam.position.set(0, 42, 30); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();

  const sun = g.scene.children.find((o) => o.isDirectionalLight);
  sun.shadow.needsUpdate = true;
  R.info.reset(); R.render(g.scene, cam);
  const callsShadow = R.info.render.calls;
  R.info.reset(); R.render(g.scene, cam);
  const callsSteady = R.info.render.calls;

  let im = 0;
  g.scene.traverse((o) => { if (o.isInstancedMesh && o.visible) im++; });
  let enemyMeshes = 0;
  const e0 = g.enemies.find((x) => x.type === 'chaser');
  if (e0) e0.vis.group.traverse((o) => { if (o.isMesh && o.visible) enemyMeshes++; });

  const T = [];
  for (let k = 0; k < 300; k++) { const a = performance.now(); g.tick(1 / 60); T.push(performance.now() - a); }
  T.sort((a, b) => a - b);
  const p95 = Math.round(T[285] * 100) / 100;

  const checks = [
    ['벽 인스턴싱 유지', im === B.instancedMeshes, `${im}개 (기대 ${B.instancedMeshes})`],
    ['적 GLB 병합 유지', enemyMeshes <= B.maxEnemyMeshes, `마리당 ${enemyMeshes}메시 (상한 ${B.maxEnemyMeshes})`],
    ['draw call (정상)', callsSteady <= B.maxCallsSteady, `${callsSteady} (상한 ${B.maxCallsSteady})`],
    ['draw call (그림자)', callsShadow <= B.maxCallsShadow, `${callsShadow} (상한 ${B.maxCallsShadow})`],
    ['tick p95', p95 <= B.maxTickP95, `${p95}ms (상한 ${B.maxTickP95})`],
  ];
  const fails = checks.filter((c) => !c[1]);
  return {
    통과: fails.length === 0,
    실패: fails.map((c) => `${c[0]} — ${c[2]}`),
    항목: checks.map((c) => `${c[1] ? '✓' : '✗'} ${c[0]}: ${c[2]}`),
    적: g.enemies.length, 벽: g.obstacles.size,
  };
};
'perfGuard loaded';
