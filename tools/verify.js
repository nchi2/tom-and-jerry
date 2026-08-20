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
             walls: `${walls0}>${walls1}` });

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
  out.push({ t: 'D6.p1Caught', before, after, allySurvived:
             after.aw === before.aw && after.ag === before.ag && after.ab === before.ab,
             p1Wiped: after.pw === 0 && after.pg === 0 && after.pb === 0 });
  out.push({ t: 'D7.end', errs: window.__errs.length, msgs: window.__errs.slice(0, 6) });
  a.ai = true;

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
