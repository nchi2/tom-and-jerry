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
