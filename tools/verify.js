// 회귀 하니스 (D92 멀티 작업용). `__verify()` 를 브라우저에서 실행한다.
//  A) 150초 무입력 — 에러 0 이 매 커밋의 관문
//  B) 플레이어 명령·작업 경로 전체 (적을 끄고 본다 — 안 그러면 계속 잡혀서 원인이 안 보인다)
//  C) 전투 60초
// 개조·방어병은 **공방이 실존해야** 되므로 순서가 중요하다 (D82 기술 트리).
(() => {
  if (window.__errs) return;
  window.__errs = [];
  window.addEventListener('error', (e) => window.__errs.push('onerror: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => window.__errs.push('reject: ' + e.reason));
  const ce = console.error.bind(console);
  console.error = (...a) => { window.__errs.push(a.map(String).join(' ')); ce(...a); };
})();

// 플레이어 근처에서 조건을 통과하는 가장 가까운 칸
window.__freeCell = (kind, minD = 0) => {
  const g = window.__game;
  const p = g.player;
  const c = g.worldToCell(p.x, p.z);
  let best = null, bd = 1e9;
  for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
    const i = c.i + di, j = c.j + dj;
    if (kind ? g.buildingPlacement(i, j, kind, false) : g.wallSpotOk(i, j)) continue;
    const w = g.cellToWorld(i, j);
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (d < minD || d >= bd) continue;
    bd = d; best = { i, j, d: Math.round(d * 100) / 100 };
  }
  return best;
};

window.__verify = () => {
  const g = window.__game;
  if (!g.started) g.beginMatch();   // 시작 화면을 지나야 시뮬이 돈다 (D93)
  const R = (v) => Math.round(v * 10) / 10;
  const out = [];
  const spawnAt = () => { g.player.x = g.PLAYER_SPAWN.x; g.player.z = g.PLAYER_SPAWN.z; };

  // ---- A. 150초 무입력 ----
  window.__errs.length = 0;
  g.restart();
  g.step(150);
  out.push({ t: 'A.idle150', alive: g.alive, caught: g.caughtCount, en: g.enemies.length, errs: window.__errs.length, msgs: window.__errs.slice(0, 3) });

  // ---- B. 명령·작업 경로 (적 없음) ----
  window.__errs.length = 0;
  // 적을 완전히 없앤다. 네 곳을 다 꺼야 한다 —
  // 마릿수 · 순찰조 · 위협 증원 · **스테이지 표**(spawnStageAdds는 P.enemy.count와 무관하다).
  // spawnDelay를 무한대로 두면 enemyActive()가 false가 되어 스테이지 타이머 자체가 멈춘다.
  const en0 = g.P.enemy.count, pat0 = g.P.patrol.count, grow0 = g.P.threat.everyLevels,
        del0 = g.P.enemy.spawnDelay;
  g.P.enemy.count = 0; g.P.patrol.count = 0; g.P.threat.everyLevels = 0; g.P.enemy.spawnDelay = 1e9;
  g.restart();
  g.setEnemyCount(0);
  g.player.cheese = 6000; g.parts = 200;

  // 1) 채굴 명령 — 더미까지 걸어가 캔다
  const pile = g.nearestPile(g.player.x, g.player.z, 999);
  g.setMineOrder(pile);
  g.step(6);
  out.push({ t: 'B1.mineOrder', order: !!g.playerOrder, job: g.playerJob, carry: R(g.player.carry), en: g.enemies.length });

  // 2) 벽 명령 — 사거리 안 2칸(즉시 시전) + 사거리 밖 1칸(걸어가기)
  g.clearMineOrder();
  spawnAt();
  g.player.carry = 0;
  const wc = g.worldToCell(g.player.x, g.player.z);
  const near = [[wc.i + 1, wc.j], [wc.i, wc.j + 1]].filter(([i, j]) => !g.wallSpotOk(i, j));
  const far = [[wc.i + 4, wc.j + 1]].filter(([i, j]) => !g.wallSpotOk(i, j));
  const walls = [...near, ...far];
  for (const [i, j] of walls) g.wallOrders.push({ i, j });
  const countWalls = () => { let n = 0; for (const ob of g.obstacles.values()) if (!ob.bedrock && !ob.bldgRef) n++; return n; };
  const wall0 = countWalls();
  g.step(2);
  out.push({ t: 'B2a.wallCast', queued: walls.length, left: g.wallOrders.length, built: countWalls() - wall0 });
  g.step(18);
  out.push({ t: 'B2b.wallDone', left: g.wallOrders.length, built: countWalls() - wall0 });

  // 3) 창고
  g.clearWallOrders();
  spawnAt();
  let c = window.__freeCell('depot');
  if (!c) { out.push({ t: 'B3.FAIL', why: 'no depot cell' }); return out; }
  g.startBuild('depot', c.i, c.j);
  const hadJob = !!g.buildJob;
  g.step(12);
  out.push({ t: 'B3.depot', startedJob: hadJob, bldgs: g.buildings.length, job: !!g.buildJob });

  // 4) 공방 (개조·방어병의 전제)
  spawnAt();
  c = window.__freeCell('workshop');
  if (c) { g.startBuild('workshop', c.i, c.j); g.step(12); }
  const ws = g.buildings.find((b) => b.kind === 'workshop');
  out.push({ t: 'B4.workshop', has: !!ws, bldgs: g.buildings.length });

  // 5) 개조 (공방 옆에 서야 한다) — 인덱스 인자다
  if (ws) { g.player.x = ws.cx + 1.2; g.player.z = ws.cz + 1.2; }
  const parts0 = g.parts;
  g.buyUpgrade(0); g.buyUpgrade(2);
  out.push({ t: 'B5.upgrade', speed: g.upg.speed, tower: g.upg.tower, partsSpent: parts0 - g.parts, bldgs: g.buildings.length });

  // 6) 제자리 업그레이드 (F) — 공방 Lv.2
  g.tryUpgradeBuilding();
  const upgStarted = !!g.upgradeJob;
  g.step(25);
  out.push({ t: 'B6.upgJob', started: upgStarted, tier: ws ? ws.tier : null, done: !g.upgradeJob, bldgs: g.buildings.length });

  // 7) 유닛
  g.hireWorker('p');
  g.placeGuard('melee');
  g.step(8);
  out.push({ t: 'B7.units', w: g.workers.length, gu: g.guards.length, bldgs: g.buildings.length, alive: g.alive, caught: g.caughtCount });

  // 8) 잡힘 — 소유자별 소멸 (2단계에서 이 줄이 핵심이 된다)
  const gu0 = g.guards.length, w0 = g.workers.length, b0 = g.buildings.length;
  let walls0 = 0;
  for (const ob of g.obstacles.values()) if (!ob.bedrock && !ob.bldgRef) walls0++;
  g.playerHp = 1;
  g.hurtHamster(g.player, 5);
  let walls1 = 0;
  for (const ob of g.obstacles.values()) if (!ob.bedrock && !ob.bldgRef) walls1++;
  out.push({ t: 'B8.caught', n: g.caughtCount, guards: `${gu0}>${g.guards.length}`,
             workers: `${w0}>${g.workers.length}`, bldgs: `${b0}>${g.buildings.length}`,
             walls: `${walls0}>${walls1}` });   // 솔로는 즉시 소멸 (D95)

  g.step(20);
  out.push({ t: 'B9.end', alive: g.alive, errs: window.__errs.length, msgs: window.__errs.slice(0, 4) });

  // ---- D. 동료 경제 (D92-2단계) ----
  // **이 코드 경로는 한 번도 실행된 적이 없다.** D47이 동료 경제를 들어냈기 때문에
  // placeBuilding(...,'a') / hireWorker('a') / placeGuard(...,ally) 가 전부 죽은 코드였다.
  // 여기서 P2가 될 슬롯을 손으로 돌려 본다. 적은 여전히 꺼져 있다.
  window.__errs.length = 0;
  g.restart();
  g.setEnemyCount(0);
  const a = g.ally;
  a.active = true; a.stunned = false;
  a.ai = false;                        // AI를 끄고 사람처럼 다룬다 (6단계의 예행)
  a.cheese = 6000; a.parts = 200;
  g.player.cheese = 6000;
  // 두 햄스터를 멀리 떼어 놓는다 (자리 다툼이 원인인지 아닌지 구분하려고)
  a.x = g.PLAYER_SPAWN.x + 14; a.z = g.PLAYER_SPAWN.z + 6;

  const aCell = (kind) => {
    const c = g.worldToCell(a.x, a.z);
    let best = null, bd = 1e9;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = c.i + di, j = c.j + dj;
      if (kind ? g.buildingPlacement(i, j, kind, false, a) : g.wallSpotOk(i, j, a)) continue;
      const w = g.cellToWorld(i, j);
      const d = Math.hypot(w.x - a.x, w.z - a.z);
      if (d < bd) { bd = d; best = { i, j }; }
    }
    return best;
  };

  // D1) 동료 창고
  let ac = aCell('depot');
  const aDepot = ac ? g.placeBuilding('depot', ac.i, ac.j, 'a') : null;
  if (aDepot) aDepot.underBuild = false;
  out.push({ t: 'D1.allyDepot', placed: !!aDepot, owner: aDepot && aDepot.owner, cheese: R(a.cheese) });

  // D2) 동료 일꾼 — 자기 창고로 날라야 한다
  const aw = g.hireWorker('a');
  out.push({ t: 'D2.allyWorker', hired: !!aw, owner: aw && aw.owner,
             depotOwner: aw && aw.depot && aw.depot.owner });

  // D3) 동료 공방 + 방어병
  ac = aCell('workshop');
  const aWs = ac ? g.placeBuilding('workshop', ac.i, ac.j, 'a') : null;
  if (aWs) { aWs.underBuild = false; aWs.tier = 1; }
  const ag = g.placeGuard('melee', a);
  out.push({ t: 'D3.allyGuard', ws: !!aWs, guard: !!ag, owner: ag && ag.owner,
             guards: g.guards.length });

  // D4) 동료 벽 명령 — 사람이 조종하는 것처럼
  const awc = g.worldToCell(a.x, a.z);
  let aq = 0;
  for (const [di, dj] of [[1, 0], [0, 1], [-1, 0]]) {
    if (!g.wallSpotOk(awc.i + di, awc.j + dj, a)) { a.wallOrders.push({ i: awc.i + di, j: awc.j + dj }); aq++; }
  }
  const cw = () => { let n = 0; for (const ob of g.obstacles.values()) if (!ob.bedrock && !ob.bldgRef && ob.owner === 'a') n++; return n; };
  const aw0 = cw();
  g.step(20);   // ai=false 이므로 tick이 알아서 updateActor(ally)를 돌린다
  out.push({ t: 'D4.allyWalls', queued: aq, left: a.wallOrders.length, built: cw() - aw0 });

  // D5) 동료 채굴 명령
  const apile = g.nearestPile(a.x, a.z, 999);
  g.setMineOrder(apile, a);
  const ac0 = a.cheese;
  g.step(30);
  out.push({ t: 'D5.allyMine', order: !!a.mineOrder, job: a.job, carry: R(a.carry), mined: R(a.cheese - ac0) });

  // D6) **핵심**: P1이 잡혀도 P2의 군대가 살아 있는가
  const pw = g.hireWorker('p');
  const pg = g.placeGuard('melee', g.player);
  const before = { pw: g.workers.filter((w) => w.owner === 'p').length,
                   aw: g.workers.filter((w) => w.owner === 'a').length,
                   pg: g.guards.filter((x) => x.owner === 'p').length,
                   ag: g.guards.filter((x) => x.owner === 'a').length,
                   ab: g.buildings.filter((b) => b.owner === 'a').length,
                   pb: g.buildings.filter((b) => b.owner === 'p').length };
  g.playerHp = 1;
  g.hurtHamster(g.player, 5);
  const after = { pw: g.workers.filter((w) => w.owner === 'p').length,
                  aw: g.workers.filter((w) => w.owner === 'a').length,
                  pg: g.guards.filter((x) => x.owner === 'p').length,
                  ag: g.guards.filter((x) => x.owner === 'a').length,
                  ab: g.buildings.filter((b) => b.owner === 'a').length,
                  pb: g.buildings.filter((b) => b.owner === 'p').length };
  // 2P에서는 소멸이 **유예**된다 (D95) — 잡힌 직후에는 아직 남아 있고 카운트다운이 돈다
  out.push({ t: 'D6.p1Caught', before, after,
             allyUntouched: after.aw === before.aw && after.ag === before.ag && after.ab === before.ab,
             p1Deferred: g.player.wipeT > 0 && after.pg === before.pg });
  g.step(g.P.coop.wipeGrace + 1);   // 아무도 안 구하면 결국 무너진다
  out.push({ t: 'D6b.graceExpired',
             p1Gone: g.guards.filter((x) => x.owner === 'p').length === 0
                  && g.buildings.filter((b) => b.owner === 'p').length === 0,
             allyStill: g.workers.filter((w) => w.owner === 'a').length === before.aw
                     && g.buildings.filter((b) => b.owner === 'a').length === before.ab });
  out.push({ t: 'D7.end', errs: window.__errs.length, msgs: window.__errs.slice(0, 6) });
  a.ai = true;

  // ---- E. 명령 계층 (D92-3단계) ----
  // **마우스도 카메라도 없이** applyCommand만으로 전부 되어야 한다.
  window.__errs.length = 0;
  g.restart();
  g.setEnemyCount(0);
  const me = g.player;
  me.cheese = 6000; me.parts = 200;
  const cell = (di, dj) => { const c = g.worldToCell(me.x, me.z); return { i: c.i + di, j: c.j + dj }; };
  const nWalls = () => { let n = 0; for (const ob of g.obstacles.values()) if (!ob.bedrock && !ob.bldgRef) n++; return n; };

  const e0 = nWalls();
  g.applyCommand(me, { t: 'wall', ...cell(1, 0) });
  g.applyCommand(me, { t: 'wall', ...cell(0, 1) });
  g.step(8);
  out.push({ t: 'E1.wallCmd', built: nWalls() - e0, left: me.wallOrders.length });

  g.applyCommand(me, { t: 'roll' });
  out.push({ t: 'E2.rollCmd', rolling: me.rollT > 0 });
  g.step(2);

  const bc = window.__freeCell('depot');
  g.applyCommand(me, { t: 'build', kind: 'depot', i: bc.i, j: bc.j });
  g.step(14);
  out.push({ t: 'E3.buildCmd', bldgs: g.buildings.length });

  g.applyCommand(me, { t: 'unit', kind: 'worker' });
  out.push({ t: 'E4.unitCmd', workers: g.workers.length });

  const pl = g.nearestPile(me.x, me.z, 999);
  g.applyCommand(me, { t: 'mine', i: pl.i, j: pl.j });
  out.push({ t: 'E5.mineCmd', order: !!g.playerOrder });
  g.applyCommand(me, { t: 'cancel', lvl: 'mineOrder' });
  out.push({ t: 'E6.cancelCmd', order: !!g.playerOrder });

  // 일꾼에게 id로 명령 (선택 상태를 안 거친다)
  const wk = g.workers.filter((w) => w.owner === 'p');
  g.applyCommand(me, { t: 'unitcmd', act: 'pile', i: pl.i, j: pl.j, ids: wk.map((w) => w.id) });
  out.push({ t: 'E7.unitcmdPile', assigned: wk.filter((w) => w.pile === pl).length });
  const mv = cell(3, 3);
  g.applyCommand(me, { t: 'unitcmd', act: 'move', i: mv.i, j: mv.j, ids: wk.map((w) => w.id) });
  out.push({ t: 'E8.unitcmdMove', goals: wk.filter((w) => w.moveGoal).length });

  // 철거 — 마우스 없이
  const wallOb = [...g.obstacles.values()].find((ob) => !ob.bedrock && !ob.bldgRef && ob.owner === 'p');
  const r0 = nWalls();
  if (wallOb) g.applyCommand(me, { t: 'remove', i: wallOb.i, j: wallOb.j });
  out.push({ t: 'E9.removeCmd', removed: r0 - nWalls() });

  // 공방 → 개조 명령
  const wc2 = window.__freeCell('workshop');
  if (wc2) { g.applyCommand(me, { t: 'build', kind: 'workshop', i: wc2.i, j: wc2.j }); g.step(14); }
  const ws2 = g.buildings.find((b) => b.kind === 'workshop');
  if (ws2) { me.x = ws2.cx + 1.2; me.z = ws2.cz + 1.2; }
  g.applyCommand(me, { t: 'upg', k: 0 });
  g.applyCommand(me, { t: 'f' });
  out.push({ t: 'E10.upgCmd', speed: g.upg.speed, upgJob: !!g.upgradeJob });
  g.applyCommand(me, { t: 'unit', kind: 'melee' });
  out.push({ t: 'E11.guardCmd', guards: g.guards.length, errs: window.__errs.length, msgs: window.__errs.slice(0, 4) });

  // ---- C. 전투 60초 ----
  window.__errs.length = 0;
  g.P.enemy.count = en0; g.P.patrol.count = pat0; g.P.threat.everyLevels = grow0; g.P.enemy.spawnDelay = del0;
  g.restart();
  g.step(60);
  out.push({ t: 'C.combat60', alive: g.alive, caught: g.caughtCount, en: g.enemies.length,
             kills: g.killCount, errs: window.__errs.length, msgs: window.__errs.slice(0, 4) });
  g.restart();
  return out;
};

// ---- 프레임 비용 측정 (D92 렉 추적용) ----
// rAF는 숨은 탭에서 멈추므로 tick()을 직접 재서 **CPU 비용만** 본다.
window.__profile = (secs = 4) => {
  const g = window.__game;
  if (!g.started) g.beginMatch();
  const n = Math.round(secs * 60);
  const t = [];
  for (let k = 0; k < n; k++) {
    const a = performance.now();
    g.tick(1 / 60);
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const R = (v) => Math.round(v * 100) / 100;
  return {
    ticks: n,
    avg: R(t.reduce((s, v) => s + v, 0) / n),
    p50: R(t[Math.floor(n * 0.5)]),
    p95: R(t[Math.floor(n * 0.95)]),
    max: R(t[n - 1]),
    role: g.net.role, en: g.enemies.length, walls: [...g.obstacles.values()].length,
  };
};

// 어느 함수가 먹는지 — 이름별 누적 시간
window.__profileParts = (secs = 3) => {
  const g = window.__game;
  if (!g.started) g.beginMatch();
  const acc = {};
  const wrap = (obj, name) => {
    const orig = obj[name];
    if (typeof orig !== 'function' || orig.__wrapped) return;
    const f = function (...a) {
      const t0 = performance.now();
      try { return orig.apply(this, a); } finally { acc[name] = (acc[name] || 0) + (performance.now() - t0); }
    };
    f.__wrapped = true;
    obj[name] = f;
  };
  for (const nm of ['refreshClearance', 'refreshTerritory', 'refreshReach', 'updatePlayer',
                    'updateLocalUI', 'planEnemyPath', 'nearestSafeSpot'])
    if (g[nm]) wrap(g, nm);
  const t0 = performance.now();
  const n = Math.round(secs * 60);
  for (let k = 0; k < n; k++) g.tick(1 / 60);
  const total = performance.now() - t0;
  const out = { totalMs: Math.round(total), perTickMs: Math.round(total / n * 100) / 100 };
  for (const [k, v] of Object.entries(acc)) out[k] = Math.round(v);
  return out;
};

// ---- 원격 개체가 부드러운가 (D93) ----
// 프레임마다 적의 이동량을 재서 **들쭉날쭉한 정도**를 본다.
// 마지막 스냅 위치로 당기기만 하면 스냅 직후에만 크게 튀므로 표준편차가 평균만큼 커진다.
// 시간 보간이 제대로 되면 속도가 일정해서 표준편차가 평균보다 훨씬 작다.
// rAF는 숨은 탭에서 멈추므로 **고정 dt로 직접 tick을 돌리며** 잰다 (타이밍 잡음도 같이 빠진다).
window.__smooth = (secs = 3) => new Promise((res) => {
  const g = window.__game;
  const d = [];
  let prev = null;
  const t0 = performance.now();
  const iv = setInterval(() => {
    for (let k = 0; k < 6; k++) {
      g.tick(1 / 60);
      const e = g.enemies[0];
      if (!e) continue;
      if (prev) d.push(Math.hypot(e.x - prev.x, e.z - prev.z));
      prev = { x: e.x, z: e.z };
    }
    if (performance.now() - t0 < secs * 1000) return;
    clearInterval(iv);
    const n = d.length;
    if (!n) return res('no samples');
    const avg = d.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - avg) ** 2, 0) / n);
    res({ samples: n, avgStep: +avg.toFixed(4), sd: +sd.toFixed(4),
          jitter: avg > 1e-6 ? +(sd / avg).toFixed(2) : null,
          frozen: d.filter((v) => v < 1e-7).length });
  }, 100);
});

// ---- 보간 결정론 테스트 (D93) ----
// 실제 연결로는 못 잰다: 숨은 탭에서 타이머가 1초로 묶여 60fps 표본이 안 나오고,
// 동기 루프 안에서는 메시지가 아예 처리되지 않는다.
// 그래서 **20Hz 스냅샷을 손으로 만들어** 60fps 틱 사이에 끼워 넣고 재는 쪽이 정확하다.
// 등속으로 움직이는 적 하나를 흘려보내고, 클라가 그리는 프레임당 이동량의 흔들림을 본다.
window.__interpTest = (secs = 2, hz = 20) => {
  const g = window.__game;
  if (g.net.role !== 'client') return 'client 에서만 의미가 있다';
  // 적이 아직 없어도 된다 — 스냅샷이 만들게 한다 (그게 클라의 정상 경로다)
  const id = 999001;
  const speed = 6;                       // m/s, 등속
  const dt = 1 / 60, step = 1 / hz;
  let hostT = g.__snapT0 || 100, nextSnap = 0, x = 0;
  const d = [];
  let prev = null;

  const snap = () => ({
    k: 'SNAP', t: +hostT.toFixed(4), st: 1, sT: 0, al: 1, ki: 0, tr: 0, vi: 0,
    ps: g.__lastPs || [[0,0,0,-1,100,0,0,0,0,0,100,0,0,0,0,-1,-1,-1,0,0,0],
                       [1,1,0,-1,100,0,0,0,0,0,100,0,0,0,0,-1,-1,-1,0,0,0]],
    en: [[id, +x.toFixed(3), 5, 1, 0, 100, 0 /* chaser */, 0, 0]],
    wk: [], gu: [], bl: [], pu: [], nd: g.nodes.map((n) => Math.round(n.amount)), ev: [],
  });

  const n = Math.round(secs / dt);
  for (let k = 0; k < n; k++) {
    if (nextSnap <= 0) { g.applySnapshot(snap()); nextSnap = step; }
    nextSnap -= dt; hostT += dt; x += speed * dt;
    g.tick(dt);
    const e = g.enemies.find((q) => q.id === id);
    if (!e) break;
    if (prev !== null) d.push(Math.abs(e.x - prev));
    prev = e.x;
  }
  const m = d.length;
  if (!m) return 'no samples';
  const avg = d.reduce((s, v) => s + v, 0) / m;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - avg) ** 2, 0) / m);
  return {
    samples: m,
    expectedStep: +(speed * dt).toFixed(4),   // 등속이면 프레임당 이 값이 나와야 한다
    avgStep: +avg.toFixed(4),
    sd: +sd.toFixed(4),
    jitter: +(sd / Math.max(avg, 1e-9)).toFixed(3),   // 0에 가까울수록 부드럽다
    frozenFrames: d.filter((v) => v < 1e-6).length,
  };
};

// ---- F. 2인 컨텐츠 (D95) ----
// 적 배수 · 소멸 유예 · 구출이 유예를 취소 · 수입 기여도 분배.
// ally를 사람이 앉은 것처럼 다뤄서 (ai=false) 2P 경로를 그대로 밟는다.
window.__coop = () => {
  const g = window.__game;
  g.applySettings(g.DEFAULT_SETTINGS);
  const out = [];
  const R = (v) => Math.round(v * 10) / 10;
  const a = g.ally;

  // --- 적 배수 ---
  a.ai = true; g.beginMatch();
  const soloEn = g.enemies.length;
  a.ai = false; a.active = true; g.beginMatch();
  out.push({ t: 'F1.enemyScale', solo: soloEn, coop: g.enemies.length,
             ratio: R(g.enemies.length / Math.max(soloEn, 1)), want: g.P.coop.enemyScale });

  // --- 소멸 유예 ---
  g.P.enemy.count = 0; g.P.patrol.count = 0; g.P.threat.everyLevels = 0; g.P.enemy.spawnDelay = 1e9;
  g.beginMatch(); g.setEnemyCount(0);
  g.player.cheese = 3000; a.cheese = 3000;
  a.x = g.PLAYER_SPAWN.x + 16; a.z = g.PLAYER_SPAWN.z;
  const nWalls = (o) => { let n = 0; for (const ob of g.obstacles.values())
    if (!ob.bedrock && !ob.bldgRef && ob.owner === o) n++; return n; };
  const c = g.worldToCell(g.player.x, g.player.z);
  let built = 0;
  for (let dj = -2; dj <= 2 && built < 5; dj++) for (let di = -2; di <= 2 && built < 5; di++) {
    if (g.wallSpotOk(c.i + di, c.j + dj, g.player)) continue;
    g.addObstacle(c.i + di, c.j + dj, false, false, 'p'); built++;
  }
  g.playerHp = 1; g.hurtHamster(g.player, 5);
  out.push({ t: 'F2.grace', walls: nWalls('p'), wipeT: R(g.player.wipeT), stunned: g.player.stunned });

  // --- 구출이 취소한다 ---
  a.x = g.player.x + 0.5; a.z = g.player.z + 0.5;
  g.step(0.3);
  out.push({ t: 'F3.rescueCancels', walls: nWalls('p'), wipeT: R(g.player.wipeT),
             stunned: g.player.stunned, saved: nWalls('p') === built });

  // --- 구출 안 하면 결국 무너진다 ---
  a.x = g.PLAYER_SPAWN.x + 20; a.z = g.PLAYER_SPAWN.z + 20;
  g.playerHp = 1; g.player.grace = 0; g.hurtHamster(g.player, 5);
  const t0 = g.player.wipeT;
  g.step(g.P.coop.wipeGrace + 1);
  out.push({ t: 'F4.graceExpires', startedAt: R(t0), walls: nWalls('p'), wipeT: R(g.player.wipeT) });

  // --- 수입은 기여도대로 ---
  g.beginMatch(); g.setEnemyCount(0);
  a.ai = false; a.active = true;
  const cc = g.worldToCell(g.player.x, g.player.z);
  let np = 0, na = 0;
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    if (g.wallSpotOk(cc.i + di, cc.j + dj, g.player)) continue;
    if (np < 9) { g.addObstacle(cc.i + di, cc.j + dj, false, false, 'p'); np++; }
    else if (na < 3) { g.addObstacle(cc.i + di, cc.j + dj, false, false, 'a'); na++; }
  }
  g.refreshClearance(); g.refreshTerritory();
  const p0 = g.player.cheese, a0 = a.cheese;
  g.step(3);
  const dp = g.player.cheese - p0, da = a.cheese - a0;
  out.push({ t: 'F5.incomeByWalls', pWalls: np, aWalls: na,
             pGain: R(dp), aGain: R(da),
             share: dp + da > 0 ? R(dp / (dp + da) * 100) + '%' : 'n/a',
             wantShare: R(np / (np + na) * 100) + '%' });

  a.ai = true; a.active = false;
  return out;
};

// ---- G. 2인 상호작용 (D96) ----
// 건네주기(가까이) · 도발(어그로 당기기 + 이동 봉쇄) · 걷는 모션
window.__interact = () => {
  const g = window.__game;
  g.applySettings(g.DEFAULT_SETTINGS);
  const out = [];
  const R = (v) => Math.round(v * 10) / 10;
  const a = g.ally;

  g.P.enemy.count = 0; g.P.patrol.count = 0; g.P.threat.everyLevels = 0; g.P.enemy.spawnDelay = 1e9;
  a.ai = false; a.active = true;
  g.beginMatch(); g.setEnemyCount(0);
  g.player.cheese = 200; g.player.parts = 5; a.cheese = 0; a.parts = 0;

  // --- 멀면 안 넘어간다 ---
  a.x = g.PLAYER_SPAWN.x + 20; a.z = g.PLAYER_SPAWN.z;
  g.applyCommand(g.player, { t: 'give', k: 'cheese' });
  out.push({ t: 'G1.tooFar', pCheese: R(g.player.cheese), aCheese: R(a.cheese) });

  // --- 붙으면 넘어간다 ---
  a.x = g.player.x + 1.0; a.z = g.player.z;
  g.applyCommand(g.player, { t: 'give', k: 'cheese' });
  g.applyCommand(g.player, { t: 'give', k: 'parts' });
  out.push({ t: 'G2.given', pCheese: R(g.player.cheese), aCheese: R(a.cheese),
             pParts: g.player.parts, aParts: a.parts });

  // --- 없으면 못 준다 ---
  a.parts = 0; g.player.parts = 0;
  g.applyCommand(g.player, { t: 'give', k: 'parts' });
  out.push({ t: 'G3.nothingToGive', aParts: a.parts });

  // --- 도발: 어그로가 나에게 온다 ---
  g.P.enemy.count = 4; g.P.enemy.spawnDelay = 0;
  g.beginMatch();
  a.ai = false; a.active = true;
  // 적을 동료 쪽에 몰아 두고, 플레이어는 조금 떨어진 곳에
  a.x = g.PLAYER_SPAWN.x; a.z = g.PLAYER_SPAWN.z;
  g.player.x = g.PLAYER_SPAWN.x + 8; g.player.z = g.PLAYER_SPAWN.z;
  for (const e of g.enemies) { e.x = a.x + (Math.random() - 0.5) * 3; e.z = a.z + 2; e.targetUntil = 0; }
  g.step(2);
  const onAllyBefore = g.enemies.filter((e) => e.chaseTarget === a).length;
  const onMeBefore = g.enemies.filter((e) => e.chaseTarget === g.player).length;
  g.applyCommand(g.player, { t: 'taunt' });
  const rooted = { tauntT: R(g.player.tauntT), cd: R(g.player.tauntCd) };
  // 어그로는 **도발이 끝나기 전에** 재야 한다 (끝나면 피로·붐빔이 다시 흩는다)
  g.step(0.8);
  const onMeDuring = g.enemies.filter((e) => e.chaseTarget === g.player).length;
  const onAllyDuring = g.enemies.filter((e) => e.chaseTarget === a).length;
  out.push({ t: 'G4.tauntPullsAggro', ...rooted,
             onMe: `${onMeBefore}>${onMeDuring}`, onAlly: `${onAllyBefore}>${onAllyDuring}`,
             pulledOffMate: onAllyDuring < onAllyBefore });

  // --- 쿨다운 중엔 안 된다 ---
  // --- 도발 중에는 못 움직인다 (적 없이 재야 잡힘 순간이동과 안 섞인다) ---
  g.P.enemy.count = 0; g.P.enemy.spawnDelay = 1e9;
  g.beginMatch(); g.setEnemyCount(0);
  g.player.tauntCd = 0;
  g.applyCommand(g.player, { t: 'taunt' });
  const x0 = g.player.x;
  g.keys.add('KeyD');          // ⚠ p.in 직접 대입은 sampleLocalInput이 덮어쓴다
  g.step(1.0);
  const movedWhileTaunting = R(Math.abs(g.player.x - x0));
  g.step(1.0);                 // 도발이 끝난 뒤에는 움직여야 한다
  const movedAfter = R(Math.abs(g.player.x - x0));
  g.keys.delete('KeyD');
  out.push({ t: 'G5.rootedThenFree', movedWhileTaunting, movedAfter,
             rootWorks: movedWhileTaunting < 0.2 && movedAfter > 1 });

  // --- 쿨다운 중엔 안 된다 ---
  const cd = g.player.tauntCd;
  const before5 = g.player.tauntT;
  g.applyCommand(g.player, { t: 'taunt' });
  out.push({ t: 'G5b.cooldown', cdWas: R(cd),
             refused: g.player.tauntT <= Math.max(before5, 0) + 0.001 });

  // --- 걷는 모션이 실제로 움직이는가 ---
  // 적을 치우고 새 판에서 잰다 — 앞 단계에서 잡혀 기절해 있으면 표현이 안 돈다
  g.P.enemy.count = 0; g.P.enemy.spawnDelay = 1e9;
  g.beginMatch(); g.setEnemyCount(0);
  const vis = g.playerVis;
  g.player.tauntT = 0; g.player.tauntCd = 0;
  g.keys.add('KeyD');
  g.step(0.4);
  const f1 = vis.footL.position.z;
  g.step(0.25);
  const f2 = vis.footL.position.z;
  g.keys.delete('KeyD');
  g.step(1.0);
  const f3 = vis.footL.position.z;
  out.push({ t: 'G6.walkCycle', movingLegsDiffer: Math.abs(f1 - f2) > 0.01,
             restsWhenStopped: Math.abs(f3 - vis.rest.footL.z) < 0.001 });

  a.ai = true; a.active = false;
  return out;
};

// ---- H. 3~4인 (D97) ----
// 접속 없이 슬롯만 켜서 **게임 로직이 N명을 견디는지** 본다.
// 네트워크는 별도 (탭 3~4개로 손으로 확인).
window.__manyPlayers = () => {
  const g = window.__game;
  const out = [];
  // 앞 단계가 적을 꺼 놓고 끝났을 수 있다 — 순서에 안 휘둘리게 여기서 기본값을 복구한다
  g.applySettings(g.DEFAULT_SETTINGS);
  const R = (v) => Math.round(v * 10) / 10;
  const seat = (n) => {
    g.players.forEach((q, k) => { q.ai = k >= n; q.active = k < n; q.local = k === 0; });
    g.beginMatch();
    g.players.forEach((q, k) => { q.ai = k >= n; q.active = k < n; });
  };

  // --- 적이 인원수만큼 는다 ---
  const counts = [];
  for (const n of [1, 2, 3, 4]) {
    g.P.enemy.spawnDelay = 0;
    seat(n);
    counts.push({ n, enemies: g.enemies.length, humans: g.humans().length });
  }
  out.push({ t: 'H1.scaling', counts });

  // --- 4인: 추격 목표가 넷으로 갈리는가 ---
  seat(4);
  g.players.forEach((q, k) => {
    const a = k * Math.PI / 2;
    q.x = g.PLAYER_SPAWN.x + Math.cos(a) * 12; q.z = g.PLAYER_SPAWN.z + Math.sin(a) * 12;
  });
  for (const e of g.enemies) e.targetUntil = 0;
  g.step(6);
  const spread = g.players.map((q) => g.enemies.filter((e) => e.chaseTarget === q).length);
  out.push({ t: 'H2.aggroSpread', perPlayer: spread,
             distinctTargets: spread.filter((v) => v > 0).length });

  // --- 소유자 넷이 각자 벽/건물을 갖는다 ---
  g.P.enemy.count = 0; g.P.patrol.count = 0; g.P.enemy.spawnDelay = 1e9;
  seat(4); g.setEnemyCount(0);
  const owners = g.OWNERS;
  g.players.forEach((q) => { q.cheese = 500; });
  const built = {};
  g.players.forEach((q, k) => {
    const c = g.worldToCell(q.x, q.z);
    let n = 0;
    for (let dj = -2; dj <= 2 && n < 3 + k; dj++) for (let di = -2; di <= 2 && n < 3 + k; di++) {
      if (g.wallSpotOk(c.i + di, c.j + dj, q)) continue;
      g.addObstacle(c.i + di, c.j + dj, false, false, q.owner); n++;
    }
    built[q.owner] = n;
  });
  const wallsBy = (o) => [...g.obstacles.values()].filter((w) => !w.bedrock && !w.bldgRef && w.owner === o).length;
  out.push({ t: 'H3.fourOwners', built, onMap: owners.map((o) => `${o}:${wallsBy(o)}`).join(' ') });

  // --- 한 명이 잡혀도 나머지 셋은 멀쩡 ---
  const p2 = g.players[1];
  const before = owners.map(wallsBy);
  p2.hp = 1; g.hurtHamster(p2, 5);
  g.step(g.P.coop.wipeGrace + 1);
  const after = owners.map(wallsBy);
  out.push({ t: 'H4.oneWipedOnly', before, after,
             onlySlot1Gone: after[1] === 0 && after[0] === before[0] && after[2] === before[2] && after[3] === before[3] });

  // --- 전멸은 전원이 누웠을 때만 ---
  seat(4);
  g.players.forEach((q) => { q.stunned = false; });
  for (let k = 0; k < 3; k++) { g.players[k].hp = 1; g.hurtHamster(g.players[k], 5); }
  const aliveWith3Down = g.alive;
  g.players[3].hp = 1; g.hurtHamster(g.players[3], 5);
  out.push({ t: 'H5.gameOverOnlyWhenAllDown', aliveWith3Down, aliveWith4Down: g.alive });

  // --- 아무나 아무나를 구할 수 있다 ---
  seat(4);
  g.players.forEach((q) => { q.stunned = false; q.wipeT = 0; });
  const down = g.players[2];
  down.hp = 1; g.hurtHamster(down, 5);
  const wasStunned = down.stunned;
  const saver = g.players[3];
  saver.x = down.x + 0.5; saver.z = down.z + 0.5;
  g.step(0.2);
  out.push({ t: 'H6.anyoneRescues', wasStunned, nowStunned: down.stunned, savedWipe: R(down.wipeT) });

  g.players.forEach((q, k) => { q.ai = k > 0; q.active = k === 0; q.local = k === 0; });
  return out;
};
