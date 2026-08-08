import * as THREE from 'three';
import GUI from 'lil-gui';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  player: { speed: 6.0, radius: 0.35 },
  enemy: { speed: 5.0, radius: 0.9, dps: 30, attackRange: 0.6, repath: 0.35 },
  wall: { hp: 100, cooldown: 0.15, height: 1.1 },
};

// ============================================================
// 격자 / 좌표계
//  - 벽 격자: CELLS x CELLS, 한 칸 CS(1.0m)
//  - 내비 격자: 벽 격자의 2배 해상도 (navRes = 0.5m)
// ============================================================
const CELLS = 26;
const CS = 1.0;
const HALF = (CELLS * CS) / 2;
const navRes = CS / 2;
const NAV = CELLS * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cellKey = (i, j) => i + ',' + j;
const cellToWorld = (i, j) => ({ x: (i + 0.5) * CS - HALF, z: (j + 0.5) * CS - HALF });
const worldToCell = (x, z) => ({
  i: clamp(Math.floor((x + HALF) / CS), 0, CELLS - 1),
  j: clamp(Math.floor((z + HALF) / CS), 0, CELLS - 1),
});
const navToWorld = (idx) => ({
  x: ((idx % NAV) + 0.5) * navRes - HALF,
  z: (((idx / NAV) | 0) + 0.5) * navRes - HALF,
});
const worldToNav = (x, z) => {
  const i = clamp(Math.floor((x + HALF) / navRes), 0, NAV - 1);
  const j = clamp(Math.floor((z + HALF) / navRes), 0, NAV - 1);
  return j * NAV + i;
};

// ============================================================
// 씬 기본
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d24);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3f4a, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(12, 24, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -HALF - 2;
sun.shadow.camera.right = HALF + 2;
sun.shadow.camera.top = HALF + 2;
sun.shadow.camera.bottom = -HALF - 2;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(CELLS * CS, CELLS * CS),
  new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(CELLS * CS, CELLS, 0x4a5268, 0x3a4054);
grid.position.y = 0.01;
scene.add(grid);

// 외곽 림 (시각용 — 충돌은 경계 클램프로 처리)
{
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x454c5e, roughness: 1 });
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), rimMat);
    m.position.set(x, 0.4, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  mk(CELLS * CS + 1, 0.5, 0, -HALF - 0.25);
  mk(CELLS * CS + 1, 0.5, 0, HALF + 0.25);
  mk(0.5, CELLS * CS + 1, -HALF - 0.25, 0);
  mk(0.5, CELLS * CS + 1, HALF + 0.25, 0);
}

// ============================================================
// 장애물 (벽 + 지형)
//  key "i,j" -> { i, j, hp, maxHp, bedrock, mesh }
//  bedrock = 파괴 불가 지형 (미리 배치)
// ============================================================
const obstacles = new Map();
const wallGeo = new THREE.BoxGeometry(1, 1, 1);

function addObstacle(i, j, bedrock) {
  const key = cellKey(i, j);
  if (obstacles.has(key)) return null;
  const mat = new THREE.MeshStandardMaterial({
    color: bedrock ? 0x4a4f5c : 0x8fa1b8,
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(wallGeo, mat);
  const h = bedrock ? 1.4 : P.wall.height;
  const w = cellToWorld(i, j);
  mesh.scale.set(CS * 0.98, h, CS * 0.98);
  mesh.position.set(w.x, h / 2, w.z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const ob = { i, j, hp: P.wall.hp, maxHp: P.wall.hp, bedrock, mesh };
  obstacles.set(key, ob);
  return ob;
}

function removeObstacle(ob) {
  obstacles.delete(cellKey(ob.i, ob.j));
  scene.remove(ob.mesh);
  ob.mesh.material.dispose();
}

const WALL_BASE = new THREE.Color(0x8fa1b8);
const WALL_DMG = new THREE.Color(0xd9534f);
function updateWallColor(ob) {
  const t = 1 - ob.hp / ob.maxHp;
  ob.mesh.material.color.copy(WALL_BASE).lerp(WALL_DMG, t);
}

// 미리 배치된 지형: 1칸 틈("쥐구멍")과 2칸 틈을 비교할 수 있게
const BEDROCK_LAYOUT = [];
{
  // 세로 벽 (왼쪽): j=5..13, 틈 1칸 at j=9
  for (let j = 5; j <= 13; j++) if (j !== 9) BEDROCK_LAYOUT.push([8, j]);
  // 가로 벽 (오른쪽 아래): i=13..22, 틈 2칸 at i=17,18
  for (let i = 13; i <= 22; i++) if (i !== 17 && i !== 18) BEDROCK_LAYOUT.push([i, 17]);
  // 기둥 2x2 (왼쪽 아래)
  BEDROCK_LAYOUT.push([5, 20], [6, 20], [5, 21], [6, 21]);
  // 기둥 2x2 (오른쪽 위)
  BEDROCK_LAYOUT.push([18, 5], [19, 5], [18, 6], [19, 6]);
}

// ============================================================
// clearance 필드 (chamfer distance transform)
//  각 내비 칸 -> 가장 가까운 막힌 칸까지의 거리(월드 단위)
//  clearAll: 지형+벽 기준 / clearBed: 지형만 기준
//  "몸 반지름 r가 이 칸을 지날 수 있는가" = clearance + navRes/2 >= r
// ============================================================
let clearAll = null;
let clearBed = null;

function navBlocked(i, j, bedrockOnly) {
  if (i <= 0 || j <= 0 || i >= NAV - 1 || j >= NAV - 1) return true; // 외곽 림
  const ob = obstacles.get(cellKey(i >> 1, j >> 1));
  if (!ob) return false;
  return bedrockOnly ? ob.bedrock : true;
}

function computeClearance(bedrockOnly) {
  const d = new Float32Array(NAV * NAV);
  const INF = 1e9;
  const S2 = Math.SQRT2;
  for (let j = 0; j < NAV; j++)
    for (let i = 0; i < NAV; i++)
      d[j * NAV + i] = navBlocked(i, j, bedrockOnly) ? 0 : INF;
  // forward pass
  for (let j = 0; j < NAV; j++)
    for (let i = 0; i < NAV; i++) {
      const k = j * NAV + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) v = Math.min(v, d[k - NAV] + 1);
      if (i > 0 && j > 0) v = Math.min(v, d[k - NAV - 1] + S2);
      if (i < NAV - 1 && j > 0) v = Math.min(v, d[k - NAV + 1] + S2);
      d[k] = v;
    }
  // backward pass
  for (let j = NAV - 1; j >= 0; j--)
    for (let i = NAV - 1; i >= 0; i--) {
      const k = j * NAV + i;
      let v = d[k];
      if (i < NAV - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < NAV - 1) v = Math.min(v, d[k + NAV] + 1);
      if (i < NAV - 1 && j < NAV - 1) v = Math.min(v, d[k + NAV + 1] + S2);
      if (i > 0 && j < NAV - 1) v = Math.min(v, d[k + NAV - 1] + S2);
      d[k] = v;
    }
  for (let k = 0; k < d.length; k++) d[k] *= navRes;
  return d;
}

function refreshClearance() {
  clearAll = computeClearance(false);
  clearBed = computeClearance(true);
}

const canPass = (field, idx, r) => field[idx] + navRes * 0.5 >= r;

// ============================================================
// A* (내비 격자, 8방향, 코너 끼임 방지)
// ============================================================
class MinHeap {
  constructor() { this.a = []; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function astar(start, goal, passFn, extraCostFn) {
  const g = new Float32Array(NAV * NAV).fill(Infinity);
  const parent = new Int32Array(NAV * NAV).fill(-1);
  const closed = new Uint8Array(NAV * NAV);
  const gx = goal % NAV, gz = (goal / NAV) | 0;
  const h = (idx) => {
    const x = idx % NAV, z = (idx / NAV) | 0;
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  const heap = new MinHeap();
  g[start] = 0;
  heap.push({ i: start, f: h(start) });
  let best = start, bestH = h(start);
  let found = false, iter = 0;
  while (heap.size && iter++ < 30000) {
    const { i: cur } = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const hh = h(cur);
    if (hh < bestH) { bestH = hh; best = cur; }
    if (cur === goal) { found = true; break; }
    const cx = cur % NAV, cz = (cur / NAV) | 0;
    for (const [dx, dz, c] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
      const ni = nz * NAV + nx;
      if (closed[ni] || !passFn(ni)) continue;
      if (dx !== 0 && dz !== 0) {
        if (!passFn(cz * NAV + nx) || !passFn(nz * NAV + cx)) continue;
      }
      const ng = g[cur] + c + extraCostFn(ni);
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        heap.push({ i: ni, f: ng + h(ni) });
      }
    }
  }
  const end = found ? goal : best;
  const path = [];
  for (let n = end; n !== -1; n = parent[n]) path.push(n);
  path.reverse();
  return { path, found, closestWorld: bestH * navRes };
}

function nearestPassableNav(x, z, passFn) {
  const idx = worldToNav(x, z);
  if (passFn(idx)) return idx;
  const ci = idx % NAV, cj = (idx / NAV) | 0;
  for (let ring = 1; ring <= 5; ring++) {
    for (let dj = -ring; dj <= ring; dj++)
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= NAV || nj >= NAV) continue;
        const n = nj * NAV + ni;
        if (passFn(n)) return n;
      }
  }
  return idx;
}

// ============================================================
// 엔티티
// ============================================================
function makeCapsule(color, radius) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1, 1.2, 8, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  body.castShadow = true;
  body.position.y = 1.6;
  group.add(body);
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x22242c, roughness: 0.6 })
  );
  nose.position.set(0, 1.7, -0.85);
  group.add(nose);
  group.scale.setScalar(radius);
  scene.add(group);
  return { group, body };
}

const playerVis = makeCapsule(0xf5c542, P.player.radius);
const enemyVis = makeCapsule(0xd9455f, P.enemy.radius);

const PLAYER_SPAWN = cellToWorld(5, 9);
const ENEMY_SPAWN = cellToWorld(21, 21);

const player = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, faceX: 0, faceZ: -1 };
const enemy = {
  x: ENEMY_SPAWN.x, z: ENEMY_SPAWN.z,
  path: [],           // [{x, z, idx}]
  aiMode: '추격',      // 추격 / 파괴 / 배회
  repathT: 0,
  attackTarget: null, // 공격 중인 벽
  stallT: 0,
  prevX: ENEMY_SPAWN.x, prevZ: ENEMY_SPAWN.z,
};

// 벽 설치 미리보기 (고스트)
const ghost = new THREE.Mesh(
  wallGeo,
  new THREE.MeshStandardMaterial({ color: 0x6ee07a, transparent: true, opacity: 0.35 })
);
scene.add(ghost);

// ============================================================
// 물리: 원 vs 벽 AABB (밀어내기)
//  → "덩치가 커서 좁은 틈을 못 지나감"의 근본 구현.
//  틈의 반폭 < 반지름이면 양쪽 벽이 동시에 밀어내서 물리적으로 통과 불가.
// ============================================================
function collideWithObstacles(ent, r) {
  for (let pass = 0; pass < 3; pass++) {
    const c = worldToCell(ent.x, ent.z);
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
        if (!ob) continue;
        const w = cellToWorld(ob.i, ob.j);
        const x0 = w.x - CS / 2, x1 = w.x + CS / 2;
        const z0 = w.z - CS / 2, z1 = w.z + CS / 2;
        const px = clamp(ent.x, x0, x1);
        const pz = clamp(ent.z, z0, z1);
        let dx = ent.x - px, dz = ent.z - pz;
        let d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 < 1e-9) {
          // 중심이 AABB 내부 — 가장 얕은 축으로 탈출
          const exL = ent.x - x0, exR = x1 - ent.x;
          const ezT = ent.z - z0, ezB = z1 - ent.z;
          const m = Math.min(exL, exR, ezT, ezB);
          if (m === exL) ent.x = x0 - r;
          else if (m === exR) ent.x = x1 + r;
          else if (m === ezT) ent.z = z0 - r;
          else ent.z = z1 + r;
        } else {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          ent.x += dx * push;
          ent.z += dz * push;
        }
      }
  }
  ent.x = clamp(ent.x, -HALF + r, HALF - r);
  ent.z = clamp(ent.z, -HALF + r, HALF - r);
}

function distToObstacle(ent, ob) {
  const w = cellToWorld(ob.i, ob.j);
  const px = clamp(ent.x, w.x - CS / 2, w.x + CS / 2);
  const pz = clamp(ent.z, w.z - CS / 2, w.z + CS / 2);
  return Math.hypot(ent.x - px, ent.z - pz);
}

// ============================================================
// 적 AI
//  1) clearAll 기준으로 "내 덩치가 지나갈 수 있는 길"만 A* 탐색
//  2) 길이 없으면 → 플레이어 벽에 비용을 얹은 돌파 경로 탐색, 막는 벽 공격
//  3) 그래도 없으면(지형만으로 막힘) → 최대한 접근해서 배회
// ============================================================
function planEnemyPath() {
  const er = P.enemy.radius;
  const passAll = (i) => canPass(clearAll, i, er);
  const passBed = (i) => canPass(clearBed, i, er);
  const start = nearestPassableNav(enemy.x, enemy.z, passAll);
  const goal = worldToNav(player.x, player.z);

  const res = astar(start, goal, passAll, () => 0);
  if (res.found || res.closestWorld < 1.3) {
    enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = '추격';
    return;
  }
  // 막혀 있음 → 플레이어가 지은 벽을 부수는 경로 (지형은 못 부숨)
  const wallAt = (idx) => {
    const ob = obstacles.get(cellKey((idx % NAV) >> 1, ((idx / NAV) | 0) >> 1));
    return ob && !ob.bedrock ? ob : null;
  };
  const res2 = astar(start, goal, passBed, (idx) => (wallAt(idx) ? 80 : 0));
  if (res2.found && res2.path.some((idx) => wallAt(idx))) {
    enemy.path = res2.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = '파괴';
    return;
  }
  enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
  enemy.aiMode = '배회';
}

function segmentClearFor(x0, z0, x1, z1, r) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / (navRes * 0.6)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const idx = worldToNav(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (!canPass(clearAll, idx, r)) return false;
  }
  return true;
}

function updateEnemy(dt) {
  const er = P.enemy.radius;
  enemy.repathT -= dt;
  if (enemy.repathT <= 0) {
    enemy.repathT = P.enemy.repath;
    planEnemyPath();
  }

  // 웨이포인트 소비 + 시야 단축 (추격 모드에서만)
  while (enemy.path.length && Math.hypot(enemy.x - enemy.path[0].x, enemy.z - enemy.path[0].z) < navRes * 0.9)
    enemy.path.shift();
  if (enemy.aiMode === '추격') {
    while (
      enemy.path.length > 1 &&
      segmentClearFor(enemy.x, enemy.z, enemy.path[1].x, enemy.path[1].z, er)
    )
      enemy.path.shift();
  }

  // 이동 방향
  let tx, tz;
  if (enemy.path.length) {
    tx = enemy.path[0].x; tz = enemy.path[0].z;
  } else if (enemy.aiMode !== '배회') {
    tx = player.x; tz = player.z; // 마지막 구간은 직진
  } else {
    tx = enemy.x; tz = enemy.z;
  }
  let dx = tx - enemy.x, dz = tz - enemy.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.05) {
    dx /= dl; dz /= dl;
    enemy.x += dx * P.enemy.speed * dt;
    enemy.z += dz * P.enemy.speed * dt;
  }
  collideWithObstacles(enemy, er);

  // 벽 공격: (a) 파괴 경로상 다음 벽  (b) 정체 시 근처 벽
  enemy.attackTarget = null;
  const reach = er + P.enemy.attackRange;
  if (enemy.aiMode === '파괴') {
    for (let k = 0; k < Math.min(enemy.path.length, 6); k++) {
      const idx = enemy.path[k].idx;
      const ob = obstacles.get(cellKey((idx % NAV) >> 1, ((idx / NAV) | 0) >> 1));
      if (ob && !ob.bedrock && distToObstacle(enemy, ob) <= reach) {
        enemy.attackTarget = ob;
        break;
      }
    }
  }
  // 정체 감지 → 손 닿는 벽 아무거나 공격
  // (배회 중에도 유지: 벽 1개를 부숴 1칸 틈이 생겨도 몸이 안 들어가면
  //  옆의 벽을 마저 부숴 틈을 넓히는 행동이 여기서 나옴)
  const moved = Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ);
  if (moved < P.enemy.speed * dt * 0.3) enemy.stallT += dt;
  else enemy.stallT = 0;
  enemy.prevX = enemy.x; enemy.prevZ = enemy.z;
  if (!enemy.attackTarget && enemy.stallT > 0.6) {
    let best = null, bestD = reach + 0.4;
    for (const ob of obstacles.values()) {
      if (ob.bedrock) continue;
      const d = distToObstacle(enemy, ob);
      if (d < bestD) { bestD = d; best = ob; }
    }
    enemy.attackTarget = best;
  }

  if (enemy.attackTarget) {
    const ob = enemy.attackTarget;
    ob.hp -= P.enemy.dps * dt;
    updateWallColor(ob);
    ob.mesh.position.y = (ob.mesh.scale.y / 2) + Math.sin(performance.now() * 0.05) * 0.03;
    if (ob.hp <= 0) {
      removeObstacle(ob);
      refreshClearance();
      enemy.repathT = 0;
      enemy.attackTarget = null;
    }
  }

  // 공격 중 표시 (몸 색 펄스)
  const em = enemyVis.body.material;
  if (enemy.attackTarget) {
    em.emissive.setHex(0xff2222);
    em.emissiveIntensity = 0.4 + 0.3 * Math.sin(performance.now() * 0.02);
  } else {
    em.emissiveIntensity = 0;
  }

  enemyVis.group.position.set(enemy.x, 0, enemy.z);
  if (dl > 0.05) enemyVis.group.rotation.y = Math.atan2(dx, -dz) + Math.PI;
}

// ============================================================
// 입력
// ============================================================
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyC') cycleCamera(1);
  if (e.code === 'Digit1') setCamera(0);
  if (e.code === 'Digit2') setCamera(1);
  if (e.code === 'Digit3') setCamera(2);
  if (e.code === 'Digit4') setCamera(3);
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyX') removeGhostWall();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
let mouseDown = false;
window.addEventListener('mousedown', (e) => { if (e.button === 0 && e.target === renderer.domElement) mouseDown = true; });
window.addEventListener('mouseup', () => (mouseDown = false));

// ============================================================
// 카메라 후보 4종
// ============================================================
const persp = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);

const CAM_MODES = [
  {
    key: 'topdown', name: '탑다운 (정사영)', type: 'ortho',
    params: { viewHalf: 11, lerp: 8 },
  },
  {
    key: 'quarter', name: '쿼터뷰 (스타크래프트풍)', type: 'persp',
    params: { pitch: 55, yaw: 0, dist: 20, fov: 45, lerp: 8 },
  },
  {
    key: 'action', name: '근접 탑다운 팔로우', type: 'persp',
    params: { pitch: 74, yaw: 0, dist: 13, fov: 60, lerp: 9 },
  },
  {
    key: 'chase', name: '추격 3인칭 (햄스터 뒤)', type: 'persp',
    params: { pitch: 22, dist: 6, fov: 72, lerp: 10 },
  },
];
let camIndex = 0;
let chaseYaw = Math.PI; // 플레이어 시선 따라가는 요
const camTarget = new THREE.Vector3(player.x, 0, player.z);

function activeCam() {
  return CAM_MODES[camIndex].type === 'ortho' ? ortho : persp;
}

function setCamera(i) {
  camIndex = ((i % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
  buildCamFolder();
}
function cycleCamera(d) { setCamera(camIndex + d); }

function updateCamera(dt) {
  const mode = CAM_MODES[camIndex];
  const p = mode.params;
  const k = 1 - Math.exp(-p.lerp * dt);
  camTarget.lerp(new THREE.Vector3(player.x, 0, player.z), k);

  if (mode.type === 'ortho') {
    const aspect = innerWidth / innerHeight;
    ortho.left = -p.viewHalf * aspect;
    ortho.right = p.viewHalf * aspect;
    ortho.top = p.viewHalf;
    ortho.bottom = -p.viewHalf;
    ortho.updateProjectionMatrix();
    ortho.position.set(camTarget.x, 50, camTarget.z);
    ortho.up.set(0, 0, -1);
    ortho.lookAt(camTarget.x, 0, camTarget.z);
    return;
  }

  if (persp.fov !== p.fov) { persp.fov = p.fov; persp.updateProjectionMatrix(); }

  if (mode.key === 'chase') {
    // 플레이어 진행 방향 뒤에서 따라감
    const targetYaw = Math.atan2(player.faceX, player.faceZ);
    let diff = targetYaw - chaseYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    chaseYaw += diff * (1 - Math.exp(-6 * dt));
    const pr = (p.pitch * Math.PI) / 180;
    const hd = p.dist * Math.cos(pr);
    const ht = p.dist * Math.sin(pr);
    persp.position.set(
      camTarget.x - Math.sin(chaseYaw) * hd,
      ht + 0.6,
      camTarget.z - Math.cos(chaseYaw) * hd
    );
    persp.up.set(0, 1, 0);
    persp.lookAt(camTarget.x + Math.sin(chaseYaw) * 2, 0.8, camTarget.z + Math.cos(chaseYaw) * 2);
    return;
  }

  const pr = (p.pitch * Math.PI) / 180;
  const yr = ((p.yaw ?? 0) * Math.PI) / 180;
  const hd = p.dist * Math.cos(pr);
  persp.position.set(
    camTarget.x + Math.sin(yr) * hd,
    p.dist * Math.sin(pr),
    camTarget.z + Math.cos(yr) * hd
  );
  persp.up.set(0, 1, 0);
  persp.lookAt(camTarget.x, 0, camTarget.z);
}

// 이동 입력의 기준 축 (카메라 기준)
function moveBasis() {
  const mode = CAM_MODES[camIndex];
  if (mode.type === 'ortho') {
    return { fx: 0, fz: -1, rx: 1, rz: 0 };
  }
  const dir = new THREE.Vector3();
  persp.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-4) return { fx: 0, fz: -1, rx: 1, rz: 0 };
  dir.normalize();
  return { fx: dir.x, fz: dir.z, rx: -dir.z, rz: dir.x };
}

// ============================================================
// 플레이어
// ============================================================
let buildCooldown = 0;
let ghostCell = { i: 0, j: 0, valid: false };

function updatePlayer(dt) {
  const b = moveBasis();
  let mx = 0, mz = 0;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  mx = b.fx * f + b.rx * r;
  mz = b.fz * f + b.rz * r;
  const ml = Math.hypot(mx, mz);
  if (ml > 1e-4) {
    mx /= ml; mz /= ml;
    player.x += mx * P.player.speed * dt;
    player.z += mz * P.player.speed * dt;
    player.faceX = mx; player.faceZ = mz;
  }
  collideWithObstacles(player, P.player.radius);

  playerVis.group.position.set(player.x, 0, player.z);
  playerVis.group.rotation.y = Math.atan2(player.faceX, player.faceZ) + Math.PI;

  // ---- 벽 설치 고스트: 바라보는 방향의 옆 칸 ----
  const pc = worldToCell(player.x, player.z);
  const oi = Math.round(player.faceX), oj = Math.round(player.faceZ);
  let gi = pc.i + oi, gj = pc.j + oj;
  gi = clamp(gi, 0, CELLS - 1); gj = clamp(gj, 0, CELLS - 1);
  const key = cellKey(gi, gj);
  const w = cellToWorld(gi, gj);
  const occupied = obstacles.has(key);
  // 설치 시 플레이어/적이 벽 안에 갇히지 않게
  const hitsPlayer = distCellToPoint(gi, gj, player.x, player.z) < P.player.radius + 0.02;
  const hitsEnemy = distCellToPoint(gi, gj, enemy.x, enemy.z) < P.enemy.radius + 0.02;
  ghostCell = { i: gi, j: gj, valid: !occupied && !hitsPlayer && !hitsEnemy };
  ghost.visible = alive;
  ghost.scale.set(CS * 0.98, P.wall.height, CS * 0.98);
  ghost.position.set(w.x, P.wall.height / 2, w.z);
  ghost.material.color.setHex(ghostCell.valid ? 0x6ee07a : 0xe05050);

  buildCooldown -= dt;
  if ((keys.has('Space') || mouseDown) && buildCooldown <= 0 && ghostCell.valid) {
    addObstacle(gi, gj, false);
    refreshClearance();
    enemy.repathT = 0;
    buildCooldown = P.wall.cooldown;
  }
}

function distCellToPoint(i, j, x, z) {
  const w = cellToWorld(i, j);
  const px = clamp(x, w.x - CS / 2, w.x + CS / 2);
  const pz = clamp(z, w.z - CS / 2, w.z + CS / 2);
  return Math.hypot(x - px, z - pz);
}

function removeGhostWall() {
  const ob = obstacles.get(cellKey(ghostCell.i, ghostCell.j));
  if (ob && !ob.bedrock) {
    removeObstacle(ob);
    refreshClearance();
    enemy.repathT = 0;
  }
}

// ============================================================
// GUI
// ============================================================
const gui = new GUI({ title: '튜닝' });
{
  const f = gui.addFolder('플레이어');
  f.add(P.player, 'speed', 2, 14, 0.1).name('이동 속도');
  f.add(P.player, 'radius', 0.15, 0.8, 0.01).name('반지름')
    .onChange((v) => playerVis.group.scale.setScalar(v));
}
{
  const f = gui.addFolder('적');
  f.add(P.enemy, 'speed', 2, 14, 0.1).name('이동 속도');
  f.add(P.enemy, 'radius', 0.4, 2.2, 0.05).name('반지름 (덩치)')
    .onChange((v) => { enemyVis.group.scale.setScalar(v); enemy.repathT = 0; });
  f.add(P.enemy, 'dps', 5, 150, 1).name('벽 공격력(초당)');
  f.add(P.enemy, 'attackRange', 0.2, 2, 0.05).name('공격 사거리');
  f.add(P.enemy, 'repath', 0.1, 1.5, 0.05).name('경로 재계산 주기');
}
{
  const f = gui.addFolder('벽');
  f.add(P.wall, 'hp', 20, 500, 5).name('내구도 (새 벽부터)');
  f.add(P.wall, 'cooldown', 0, 1, 0.05).name('설치 쿨다운');
  f.add(P.wall, 'height', 0.4, 3, 0.1).name('높이').onChange((h) => {
    for (const ob of obstacles.values()) {
      if (ob.bedrock) continue;
      ob.mesh.scale.y = h;
      ob.mesh.position.y = h / 2;
    }
  });
}
let camFolder = null;
const camSelector = { mode: CAM_MODES[0].name };
gui.add(camSelector, 'mode', CAM_MODES.map((m) => m.name)).name('카메라 (C키)')
  .onChange((name) => setCamera(CAM_MODES.findIndex((m) => m.name === name)));

function buildCamFolder() {
  if (camFolder) camFolder.destroy();
  const mode = CAM_MODES[camIndex];
  camSelector.mode = mode.name;
  gui.controllers.forEach((c) => c.updateDisplay());
  camFolder = gui.addFolder('카메라 설정: ' + mode.name);
  const p = mode.params;
  if ('viewHalf' in p) camFolder.add(p, 'viewHalf', 5, 22, 0.5).name('시야 반경');
  if ('dist' in p) camFolder.add(p, 'dist', 3, 40, 0.5).name('거리');
  if ('pitch' in p) camFolder.add(p, 'pitch', 10, 89, 1).name('내려보는 각도');
  if ('yaw' in p) camFolder.add(p, 'yaw', -180, 180, 1).name('회전');
  if ('fov' in p) camFolder.add(p, 'fov', 20, 110, 1).name('화각(FOV)');
  camFolder.add(p, 'lerp', 1, 20, 0.5).name('카메라 반응 속도');
}
buildCamFolder();

// ============================================================
// HUD / 게임 흐름
// ============================================================
const hudEl = document.getElementById('hud');
const helpEl = document.getElementById('help');
const overlayEl = document.getElementById('overlay');
helpEl.textContent =
  'WASD 이동 · Space/클릭 벽 설치 · X 벽 제거\n' +
  'C 또는 1~4 카메라 전환 · P 일시정지 · R 재시작';

let alive = true;
let paused = false;
let survival = 0;
let hudT = 0;

function restart() {
  for (const ob of [...obstacles.values()]) if (!ob.bedrock) removeObstacle(ob);
  refreshClearance();
  player.x = PLAYER_SPAWN.x; player.z = PLAYER_SPAWN.z;
  player.faceX = 0; player.faceZ = -1;
  enemy.x = ENEMY_SPAWN.x; enemy.z = ENEMY_SPAWN.z;
  enemy.path = []; enemy.repathT = 0; enemy.stallT = 0; enemy.attackTarget = null;
  enemy.prevX = enemy.x; enemy.prevZ = enemy.z;
  survival = 0;
  alive = true;
  overlayEl.classList.add('hidden');
}

function die() {
  alive = false;
  ghost.visible = false;
  document.getElementById('overlay-sub').textContent =
    `${survival.toFixed(1)}초 생존 — R 키로 다시 시작`;
  overlayEl.classList.remove('hidden');
}

function updateHUD() {
  const mode = CAM_MODES[camIndex];
  let wallCount = 0;
  for (const ob of obstacles.values()) if (!ob.bedrock) wallCount++;
  hudEl.textContent =
    `카메라: ${mode.name}\n` +
    `적 상태: ${enemy.aiMode}${enemy.attackTarget ? ' (벽 부수는 중!)' : ''}\n` +
    `생존: ${survival.toFixed(1)}s · 벽 ${wallCount}개` +
    (paused ? '\n⏸ 일시정지 (P)' : '');
}

// ============================================================
// 초기화 & 루프
// ============================================================
for (const [i, j] of BEDROCK_LAYOUT) addObstacle(i, j, true);
refreshClearance();

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  persp.aspect = innerWidth / innerHeight;
  persp.updateProjectionMatrix();
});

function tick(dt) {
  if (!paused && alive) {
    survival += dt;
    updatePlayer(dt);
    updateEnemy(dt);
    const d = Math.hypot(player.x - enemy.x, player.z - enemy.z);
    if (d < P.player.radius + P.enemy.radius - 0.02) die();
  }
  updateCamera(dt);
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; updateHUD(); }
}

let prevT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - prevT) / 1000, 0.05);
  prevT = now;
  tick(dt);
  renderer.render(scene, activeCam());
}
loop();

// 자동 검증용 디버그 훅
window.__game = {
  P, player, enemy, obstacles, keys, tick, restart, setCamera, addObstacle,
  refreshClearance, planEnemyPath,
  get alive() { return alive; },
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    renderer.render(scene, activeCam());
  },
};
