import * as THREE from 'three';
import GUI from 'lil-gui';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  player: { speed: 6.0, radius: 0.35, graceTime: 1.5 },
  enemy: { speed: 5.0, radius: 0.9, dps: 30, attackRange: 0.6, repath: 0.35, spawnDelay: 12 },
  wall: { hp: 100, cooldown: 0.15, height: 1.1, buildTime: 1.5, range: 3.0 },
  res: { startWalls: 10, mineRate: 1.2, wallCost: 5, nodeAmount: 40 },
  threat: { interval: 25, speedGain: 0.5, dpsGain: 8 },
};
// 시작 자원은 "벽 N개분"으로 정의 — 벽 비용을 바꿔도 시작 여유가 유지됨
const startResources = () => P.res.startWalls * P.res.wallCost;

// ============================================================
// 격자 / 좌표계
//  - 벽 격자: CELLS x CELLS, 한 칸 CS(1.0m)
//  - 내비 격자: 벽 격자의 2배 해상도 (navRes = 0.5m)
// ============================================================
const CELLS = 44;
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

function addObstacle(i, j, bedrock, building = false) {
  const key = cellKey(i, j);
  if (obstacles.has(key)) return null;
  const mat = new THREE.MeshStandardMaterial({
    color: bedrock ? 0x4a4f5c : building ? 0x3f8cff : 0x8fa1b8,
    roughness: 0.9,
    transparent: building,
    opacity: building ? 0.5 : 1,
    emissive: new THREE.Color(building ? 0x1a4a8f : 0x000000),
    emissiveIntensity: building ? 0.6 : 0,
  });
  const mesh = new THREE.Mesh(wallGeo, mat);
  const h = bedrock ? 1.4 : P.wall.height * (building ? 0.15 : 1);
  const w = cellToWorld(i, j);
  mesh.scale.set(CS * 0.98, h, CS * 0.98);
  mesh.position.set(w.x, h / 2, w.z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const ob = {
    i, j,
    hp: building ? P.wall.hp * 0.1 : P.wall.hp,
    maxHp: P.wall.hp,
    bedrock, building, mesh,
  };
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

// ============================================================
// 지형 레이아웃 (44x44) — 파괴 불가
//  설계 규칙 (의도적으로 아주 성기게):
//   1. 방/요새 금지. 지형이 어떤 영역도 감싸지 않는다.
//      → 지형만으로 광맥이 거의 확보되는 "공짜 요새"가 존재하지 않음.
//        광맥 확보 비용은 맵 어디서나 플레이어가 직접 쌓는 벽으로만 지불.
//   2. 뭉치기 금지. 기둥은 전부 1칸. 2x2 이상 덩어리 없음.
//   3. 미로 금지. 벽은 전부 양 끝이 열린 독립 직선 — 항상 돌아갈 수 있다.
//      (적의 "우회 먼저, 부수기는 최후" AI가 실제로 작동하는 조건)
//  남긴 목적: 틈 폭(1칸 vs 2칸) 비교를 눈으로 하게 하는 것.
// ============================================================
const BEDROCK_LAYOUT = [];
{
  const put = (i, j) => {
    if (i >= 0 && j >= 0 && i < CELLS && j < CELLS) BEDROCK_LAYOUT.push([i, j]);
  };
  const hLine = (i0, i1, j, gaps = []) => {
    for (let i = i0; i <= i1; i++) if (!gaps.includes(i)) put(i, j);
  };
  const vLine = (i, j0, j1, gaps = []) => {
    for (let j = j0; j <= j1; j++) if (!gaps.includes(j)) put(i, j);
  };

  // 나란한 두 벽 — 왼쪽은 1칸 틈(플레이어만), 오른쪽은 2칸 틈(적도 통과).
  // 같은 화면에 놓아 "저 틈이 저 놈보다 좁은가"를 비교하게 함.
  vLine(14, 10, 20, [15]);
  vLine(30, 10, 20, [15, 16]);

  // 아래쪽 가로 벽 — 1칸 틈 하나. 양 끝이 열려 있어 우회 가능.
  hLine(12, 24, 30, [18]);

  // 흩어진 낱개 기둥 (엄폐/시야 변화용). 전부 1칸, 서로 멀리.
  put(8, 8); put(36, 8); put(8, 36); put(36, 36);
  put(22, 22); put(24, 6); put(6, 22); put(38, 24); put(24, 38);
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
  refreshReach(); // 벽이 바뀌면 적 도달 가능 영역(자원 확보 판정)도 갱신
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
enemyVis.body.material.transparent = true;

const PLAYER_SPAWN = cellToWorld(22, 22);
const ENEMY_SPAWN = cellToWorld(22, 3);

// 건설 진행 바 (벽 발밑 바닥에 깔림)
const buildBar = new THREE.Group();
{
  const mkPlane = (color, opacity) => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0); // 좌측 끝을 피벗으로 → scale.x = 진행도
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false })
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  const frame = mkPlane(0xe8ecf4, 0.9);
  frame.scale.set(1.16, 0.3, 1);
  frame.position.set(-0.08, 0, 0);
  const bg = mkPlane(0x141822, 1);
  bg.scale.set(1.1, 0.24, 1);
  bg.position.set(-0.05, 0.002, 0);
  const fill = mkPlane(0x6ee07a, 1);
  fill.scale.set(0.001, 0.24, 1);
  fill.position.y = 0.004;
  buildBar.add(frame, bg, fill);
  buildBar.userData.fill = fill;
  buildBar.position.y = 0.04;
  buildBar.renderOrder = 999;
  buildBar.visible = false;
  scene.add(buildBar);
}

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
// 자원 노드 (치즈 광맥)
//  맵에 흩어져 있고, "적이 도달할 수 없게" 벽으로 감싸면
//  자동으로 천천히 채굴된다.
// ============================================================
// 광맥 위치 — 방 안(입구만 막으면 확보) + 개활지(둘러싸야 확보)
// 광맥 배치 규칙:
//  - 맵 외벽(파괴 불가)에서 5칸 이상 → 외벽을 공짜 벽으로 못 씀
//  - 지형에서 3칸 이상 → 지형에 기대어 싸게 감싸는 자리가 없음
//  결과: 어느 광맥이든 확보 비용이 비슷하게 "플레이어가 쌓는 벽"으로만 결정됨
const NODE_LAYOUT = [
  [9, 15], [20, 8], [35, 15],
  [20, 25], [34, 28], [10, 26],
  [30, 35], [12, 36],
];
const nodeGeo = new THREE.OctahedronGeometry(0.32);
const nodes = NODE_LAYOUT.map(([i, j]) => {
  const w = cellToWorld(i, j);
  const mesh = new THREE.Mesh(
    nodeGeo,
    new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.4 })
  );
  mesh.position.set(w.x, 0.35, w.z);
  mesh.castShadow = true;
  scene.add(mesh);
  return { i, j, amount: P.res.nodeAmount, mesh };
});
const nodeAt = (i, j) => nodes.find((n) => n.i === i && n.j === j);
let securedCount = 0;

// 적 도달 가능 영역 (내비 격자 flood fill, 적 반지름 기준)
//  → 노드가 이 영역 밖이면 "확보됨"
let enemyReach = null;
function refreshReach() {
  const er = P.enemy.radius;
  const pass = (i) => canPass(clearAll, i, er);
  const start = nearestPassableNav(enemy.x, enemy.z, pass);
  const vis = new Uint8Array(NAV * NAV);
  if (pass(start)) {
    const stack = [start];
    vis[start] = 1;
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur % NAV, cz = (cur / NAV) | 0;
      if (cx > 0 && !vis[cur - 1] && pass(cur - 1)) { vis[cur - 1] = 1; stack.push(cur - 1); }
      if (cx < NAV - 1 && !vis[cur + 1] && pass(cur + 1)) { vis[cur + 1] = 1; stack.push(cur + 1); }
      if (cz > 0 && !vis[cur - NAV] && pass(cur - NAV)) { vis[cur - NAV] = 1; stack.push(cur - NAV); }
      if (cz < NAV - 1 && !vis[cur + NAV] && pass(cur + NAV)) { vis[cur + NAV] = 1; stack.push(cur + NAV); }
    }
  }
  enemyReach = vis;
}

function updateNodes(dt) {
  securedCount = 0;
  for (const n of nodes) {
    const m = n.mesh;
    if (n.amount <= 0) {
      m.material.color.setHex(0x555a66);
      m.material.emissiveIntensity = 0;
      m.scale.setScalar(0.4);
      continue;
    }
    const w = cellToWorld(n.i, n.j);
    const secured = enemyReach && !enemyReach[worldToNav(w.x, w.z)];
    m.scale.setScalar(0.5 + 0.5 * (n.amount / P.res.nodeAmount));
    m.rotation.y += dt * 1.5;
    if (secured) {
      securedCount++;
      const got = Math.min(P.res.mineRate * dt, n.amount);
      resources += got;
      n.amount -= got;
      m.material.emissive.setHex(0xf0b429);
      m.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(performance.now() * 0.008);
    } else {
      m.material.emissiveIntensity = 0;
    }
  }
}

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
  refreshReach(); // 적이 다른 영역으로 이동했을 수도 있으니 주기적으로 갱신
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

// 적 등장 전 준비 시간 — 이 동안 광맥을 확보해 둘 수 있다
const enemyActive = () => survival >= P.enemy.spawnDelay;

// 위협 레벨: 적이 등장한 뒤부터 시간이 지날수록 강해짐
function threatLevel() {
  return Math.max(0, Math.floor((survival - P.enemy.spawnDelay) / P.threat.interval));
}
function enemySpeed() {
  return P.enemy.speed + threatLevel() * P.threat.speedGain;
}
function enemyDps() {
  return P.enemy.dps + threatLevel() * P.threat.dpsGain;
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
    enemy.x += dx * enemySpeed() * dt;
    enemy.z += dz * enemySpeed() * dt;
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
  // 정체 감지
  const moved = Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ);
  if (moved < enemySpeed() * dt * 0.3) enemy.stallT += dt;
  else enemy.stallT = 0;
  enemy.prevX = enemy.x; enemy.prevZ = enemy.z;

  // 우회 우선 원칙:
  //  - 추격 중(우회로 있음) 정체 → 벽을 부수지 말고 경로 재계산부터
  //  - 그래도 오래(>2.5s) 막혀 있으면 안전장치로 공격 허용
  //  - 파괴/배회(우회로 없음) 정체 → 손 닿는 벽 공격
  //    (배회 중 공격 유지: 벽 1개를 부숴 1칸 틈이 생겨도 몸이 안 들어가면
  //     옆의 벽을 마저 부숴 틈을 넓히는 행동이 여기서 나옴)
  if (enemy.aiMode === '추격' && enemy.stallT > 0.4) enemy.repathT = 0;
  const stallLimit = enemy.aiMode === '추격' ? 2.5 : 0.6;
  if (!enemy.attackTarget && enemy.stallT > stallLimit) {
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
    ob.hp -= enemyDps() * dt;
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

// 마우스 → 바닥 평면 레이캐스트 (타일 선택)
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseHit = new THREE.Vector3();
let mouseValid = false;
window.addEventListener('mousemove', (e) => {
  mouseNDC.x = (e.clientX / innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;
  mouseValid = true;
});

// ============================================================
// 카메라 후보 4종
// ============================================================
const persp = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);

const CAM_MODES = [
  {
    key: 'topdown', name: '탑다운 (정사영)', type: 'ortho',
    params: { viewHalf: 13, lerp: 8 },
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
let buildJob = null; // { ob, t } — 건설 중인 벽
let resources = startResources();

function cancelBuild(refund) {
  if (!buildJob) return;
  const ob = buildJob.ob;
  if (obstacles.has(cellKey(ob.i, ob.j))) {
    removeObstacle(ob);
    refreshClearance();
    enemy.repathT = 0;
  }
  if (refund) resources += P.res.wallCost;
  buildJob = null;
}

function updatePlayer(dt) {
  const wantBuild = keys.has('Space') || mouseDown;

  // ---- 건설 진행 (홀드 유지 필요 — 놓으면 취소·환불, 적이 부수면 실패) ----
  if (buildJob) {
    if (!obstacles.has(cellKey(buildJob.ob.i, buildJob.ob.j))) {
      buildJob = null; // 적이 건설 중인 벽을 파괴함
    } else if (!wantBuild) {
      cancelBuild(true);
    } else {
      buildJob.t += dt;
      const ob = buildJob.ob;
      ob.hp = Math.min(ob.hp + (ob.maxHp * 0.9 * dt) / P.wall.buildTime, ob.maxHp);
      const prog = Math.min(buildJob.t / P.wall.buildTime, 1);
      ob.mesh.scale.y = P.wall.height * (0.15 + 0.85 * prog);
      ob.mesh.position.y = ob.mesh.scale.y / 2;
      // 발밑 진행 바 + 남은 시간
      const bw = cellToWorld(ob.i, ob.j);
      buildBar.visible = true;
      buildBar.position.set(bw.x - 0.5, 0.04, bw.z + CS * 0.62);
      buildBar.userData.fill.scale.x = Math.max(prog, 0.001);
      const sp = new THREE.Vector3(bw.x, 0.05, bw.z + CS * 0.62).project(activeCam());
      buildTimerEl.style.display = 'block';
      buildTimerEl.style.left = `${((sp.x + 1) / 2) * innerWidth}px`;
      buildTimerEl.style.top = `${((-sp.y + 1) / 2) * innerHeight + 14}px`;
      buildTimerEl.textContent = `${Math.max(P.wall.buildTime - buildJob.t, 0).toFixed(1)}s`;
      if (buildJob.t >= P.wall.buildTime) {
        ob.building = false;
        ob.mesh.material.transparent = false;
        ob.mesh.material.opacity = 1;
        ob.mesh.material.color.setHex(0x8fa1b8);
        ob.mesh.material.emissiveIntensity = 0;
        updateWallColor(ob);
        buildJob = null;
        buildCooldown = P.wall.cooldown;
      }
    }
  }

  if (!buildJob) {
    buildBar.visible = false;
    buildTimerEl.style.display = 'none';
  }

  // ---- 이동 (건설 중에는 무방비 — 이동 불가) ----
  const rooted = !!buildJob;
  if (!rooted) {
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
  }
  collideWithObstacles(player, P.player.radius);

  playerVis.group.position.set(player.x, 0, player.z);
  playerVis.group.rotation.y = Math.atan2(player.faceX, player.faceZ) + Math.PI;

  // ---- 채널링 시각 표시 (몸 발광) ----
  const pm = playerVis.body.material;
  if (buildJob) {
    pm.emissive.setHex(0x3f8cff);
    pm.emissiveIntensity = 0.4 + 0.25 * Math.sin(performance.now() * 0.015);
  } else {
    pm.emissiveIntensity = 0;
  }

  // ---- 벽 설치 고스트: 마우스가 가리키는 타일 (설치 사거리 내) ----
  let gi = ghostCell.i, gj = ghostCell.j, hasTile = false;
  if (mouseValid) {
    raycaster.setFromCamera(mouseNDC, activeCam());
    if (raycaster.ray.intersectPlane(groundPlane, mouseHit)) {
      const c = worldToCell(mouseHit.x, mouseHit.z);
      gi = c.i; gj = c.j;
      hasTile = true;
    }
  }
  const key = cellKey(gi, gj);
  const w = cellToWorld(gi, gj);
  const occupied = obstacles.has(key);
  const inRange = distCellToPoint(gi, gj, player.x, player.z) <= P.wall.range;
  const onNode = !!nodeAt(gi, gj);
  // 설치 시 플레이어/적이 벽 안에 갇히지 않게
  const hitsPlayer = distCellToPoint(gi, gj, player.x, player.z) < P.player.radius + 0.02;
  const hitsEnemy = distCellToPoint(gi, gj, enemy.x, enemy.z) < P.enemy.radius + 0.02;
  const affordable = resources >= P.res.wallCost;
  ghostCell = {
    i: gi, j: gj,
    valid: hasTile && inRange && !occupied && !onNode && !hitsPlayer && !hitsEnemy && affordable,
  };
  ghost.visible = alive && !buildJob && hasTile;
  ghost.scale.set(CS * 0.98, P.wall.height, CS * 0.98);
  ghost.position.set(w.x, P.wall.height / 2, w.z);
  ghost.material.color.setHex(ghostCell.valid ? 0x6ee07a : 0xe05050);

  // ---- 건설 시작 (자원 선지불) ----
  buildCooldown -= dt;
  if (!buildJob && wantBuild && buildCooldown <= 0 && ghostCell.valid) {
    resources -= P.res.wallCost;
    const ob = addObstacle(gi, gj, false, true);
    refreshClearance();
    enemy.repathT = 0;
    buildJob = { ob, t: 0 };
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
  f.add(P.player, 'graceTime', 0, 5, 0.1).name('잡힌 뒤 무적(초)');
}
{
  const f = gui.addFolder('적');
  f.add(P.enemy, 'speed', 2, 14, 0.1).name('이동 속도');
  f.add(P.enemy, 'radius', 0.4, 2.2, 0.05).name('반지름 (덩치)')
    .onChange((v) => { enemyVis.group.scale.setScalar(v); enemy.repathT = 0; });
  f.add(P.enemy, 'dps', 5, 150, 1).name('벽 공격력(초당)');
  f.add(P.enemy, 'attackRange', 0.2, 2, 0.05).name('공격 사거리');
  f.add(P.enemy, 'repath', 0.1, 1.5, 0.05).name('경로 재계산 주기');
  f.add(P.enemy, 'spawnDelay', 0, 60, 1).name('등장 딜레이(초)');
}
{
  const f = gui.addFolder('벽');
  f.add(P.wall, 'hp', 20, 500, 5).name('내구도 (새 벽부터)');
  f.add(P.wall, 'buildTime', 0.2, 5, 0.1).name('건설 시간(초)');
  f.add(P.wall, 'range', 1, 8, 0.5).name('설치 사거리');
  f.add(P.wall, 'cooldown', 0, 1, 0.05).name('설치 쿨다운');
  f.add(P.wall, 'height', 0.4, 3, 0.1).name('높이').onChange((h) => {
    for (const ob of obstacles.values()) {
      if (ob.bedrock) continue;
      ob.mesh.scale.y = h;
      ob.mesh.position.y = h / 2;
    }
  });
}
{
  const f = gui.addFolder('자원');
  f.add(P.res, 'mineRate', 0.2, 10, 0.1).name('채굴 속도(광맥당 초당)');
  f.add(P.res, 'wallCost', 1, 30, 1).name('벽 비용');
  f.add(P.res, 'startWalls', 0, 30, 1).name('시작 벽 개수분 (재시작부터)');
  f.add(P.res, 'nodeAmount', 5, 200, 5).name('광맥 매장량 (재시작부터)');
}
{
  const f = gui.addFolder('위협 (시간 경과 강화)');
  f.add(P.threat, 'interval', 5, 90, 1).name('강화 주기(초)');
  f.add(P.threat, 'speedGain', 0, 2, 0.05).name('속도 증가/레벨');
  f.add(P.threat, 'dpsGain', 0, 40, 1).name('공격력 증가/레벨');
}

// ============================================================
// 세팅 내보내기 / 불러오기
//  플레이 중 맞춘 값을 그대로 복사 → 소스의 P 기본값으로 붙여넣기 위한 기능.
//  카메라 파라미터도 함께 담긴다.
// ============================================================
function snapshotSettings() {
  const cams = {};
  for (const m of CAM_MODES) cams[m.key] = { ...m.params };
  return {
    player: { ...P.player },
    enemy: { ...P.enemy },
    wall: { ...P.wall },
    res: { ...P.res },
    threat: { ...P.threat },
    camera: cams,
  };
}

// 소스에 그대로 붙여넣을 수 있는 형태로 출력
function settingsAsSource(s) {
  const line = (obj) =>
    Object.entries(obj).map(([k, v]) => `${k}: ${+v.toFixed(3)}`).join(', ');
  let out = 'const P = {\n';
  for (const k of ['player', 'enemy', 'wall', 'res', 'threat'])
    out += `  ${k}: { ${line(s[k])} },\n`;
  out += '};\n\n// 카메라 기본값\n';
  for (const [key, p] of Object.entries(s.camera))
    out += `// ${key}: { ${line(p)} }\n`;
  return out;
}

function applySettings(s) {
  for (const k of ['player', 'enemy', 'wall', 'res', 'threat'])
    if (s[k]) Object.assign(P[k], s[k]);
  if (s.camera)
    for (const m of CAM_MODES) if (s.camera[m.key]) Object.assign(m.params, s.camera[m.key]);
  // 슬라이더 표시 갱신 + 값에 연동된 것들 반영
  playerVis.group.scale.setScalar(P.player.radius);
  enemyVis.group.scale.setScalar(P.enemy.radius);
  for (const ob of obstacles.values()) {
    if (ob.bedrock || ob.building) continue;
    ob.mesh.scale.y = P.wall.height;
    ob.mesh.position.y = P.wall.height / 2;
  }
  enemy.repathT = 0;
  refreshAllControllers();
}

function refreshAllControllers() {
  const walk = (f) => {
    f.controllers.forEach((c) => c.updateDisplay());
    f.folders.forEach(walk);
  };
  walk(gui);
}

const DEFAULT_SETTINGS = snapshotSettings(); // 모듈 초기화 시점 = 소스의 기본값

const settingsIO = {
  복사() {
    const src = settingsAsSource(snapshotSettings());
    const json = JSON.stringify(snapshotSettings());
    const text = src + '\n// --- 아래 한 줄은 "불러오기"용 ---\n' + json;
    navigator.clipboard.writeText(text).then(
      () => { flashEl.textContent = '설정을 클립보드에 복사했습니다'; flashEl.style.color = '#6ee07a'; flashEl.style.opacity = '1'; flashT = 2.0; },
      () => { console.log(text); alert('클립보드 접근 실패 — 콘솔에 출력했습니다.'); }
    );
    console.log(text);
  },
  불러오기() {
    const raw = prompt('설정 JSON을 붙여넣으세요 (복사한 텍스트의 마지막 줄)');
    if (!raw) return;
    try {
      const start = raw.indexOf('{');
      applySettings(JSON.parse(raw.slice(start)));
      flashEl.textContent = '설정을 적용했습니다';
      flashEl.style.color = '#6ee07a';
      flashEl.style.opacity = '1';
      flashT = 2.0;
    } catch (e) {
      alert('JSON 파싱 실패: ' + e.message);
    }
  },
  기본값으로() {
    applySettings(DEFAULT_SETTINGS);
    flashEl.textContent = '기본값으로 되돌렸습니다';
    flashEl.style.color = '#6ee07a';
    flashEl.style.opacity = '1';
    flashT = 2.0;
  },
};
{
  const f = gui.addFolder('세팅 저장/불러오기');
  f.add(settingsIO, '복사').name('현재 설정 복사 (붙여넣기용)');
  f.add(settingsIO, '불러오기').name('설정 붙여넣어 적용');
  f.add(settingsIO, '기본값으로').name('기본값으로 되돌리기');
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
  if ('viewHalf' in p) camFolder.add(p, 'viewHalf', 5, 34, 0.5).name('시야 반경');
  if ('dist' in p) camFolder.add(p, 'dist', 3, 60, 0.5).name('거리');
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
const buildTimerEl = document.getElementById('buildtimer');
const overlayEl = document.getElementById('overlay');
const flashEl = document.getElementById('flash');
helpEl.textContent =
  'WASD 이동 · 마우스로 타일 선택 → 클릭/Space 홀드: 벽 건설 (놓으면 취소) · X 벽 제거\n' +
  '노란 광맥을 벽으로 감싸 적이 못 오게 하면 자동 채굴됨\n' +
  '잡히면 죽지 않고 적 시작 지점으로 끌려감 — 거기서 다시 도망쳐 나와야 함\n' +
  'C 또는 1~4 카메라 전환 · P 일시정지 · R 재시작';

let alive = true;
let paused = false;
let survival = 0;
let hudT = 0;
let caughtCount = 0;
let grace = 0;   // 잡힌 직후 짧은 무적 (초)
let flashT = 0;  // 화면 중앙 알림 남은 시간

function restart() {
  buildJob = null;
  buildBar.visible = false;
  buildTimerEl.style.display = 'none';
  enemyVis.body.material.transparent = true;
  enemyVis.body.material.opacity = 0.15;
  resources = startResources();
  for (const n of nodes) {
    n.amount = P.res.nodeAmount;
    n.mesh.material.color.setHex(0xf0b429);
  }
  for (const ob of [...obstacles.values()]) if (!ob.bedrock) removeObstacle(ob);
  refreshClearance();
  player.x = PLAYER_SPAWN.x; player.z = PLAYER_SPAWN.z;
  player.faceX = 0; player.faceZ = -1;
  enemy.x = ENEMY_SPAWN.x; enemy.z = ENEMY_SPAWN.z;
  enemy.path = []; enemy.repathT = 0; enemy.stallT = 0; enemy.attackTarget = null;
  enemy.prevX = enemy.x; enemy.prevZ = enemy.z;
  survival = 0;
  caughtCount = 0;
  grace = 0;
  flashT = 0;
  flashEl.style.opacity = '0';
  alive = true;
  overlayEl.classList.add('hidden');
}

// 잡힘 — 죽지 않고 적의 시작 지점으로 끌려간다.
//  (원작 유즈맵처럼: 잡히면 적 본진에 떨궈져 다시 도망쳐 나와야 함)
function caught() {
  caughtCount++;
  cancelBuild(true);        // 건설 중이었다면 취소 + 환불
  player.x = ENEMY_SPAWN.x; // 적 시작 지점으로 강제 이동
  player.z = ENEMY_SPAWN.z;
  player.faceX = 0; player.faceZ = 1;
  collideWithObstacles(player, P.player.radius);
  camTarget.set(player.x, 0, player.z); // 카메라 순간이동 (끌려간 게 보이게)
  grace = P.player.graceTime;           // 짧은 무적 — 즉시 재포획 방지
  // 적은 제자리(자기 시작 지점 근처)에서 잠깐 멈칫
  enemy.path = []; enemy.repathT = 0; enemy.stallT = 0; enemy.attackTarget = null;
  flashEl.textContent = `잡혔다! 적 본진으로 끌려감 (${caughtCount}회)`;
  flashEl.style.color = '#ff6b6b';
  flashEl.style.opacity = '1';
  flashT = 1.6;
}

function updateHUD() {
  const mode = CAM_MODES[camIndex];
  let wallCount = 0;
  for (const ob of obstacles.values()) if (!ob.bedrock) wallCount++;
  const lvl = threatLevel();
  const nextIn = P.threat.interval - ((survival - P.enemy.spawnDelay) % P.threat.interval);
  const waiting = !enemyActive();
  hudEl.textContent =
    `카메라: ${mode.name}\n` +
    (waiting
      ? `적 등장까지 ${(P.enemy.spawnDelay - survival).toFixed(1)}s — 지금 광맥을 확보하세요\n`
      : `적 상태: ${enemy.aiMode}${enemy.attackTarget ? ' (벽 부수는 중!)' : ''}\n`) +
    `치즈: ${resources.toFixed(1)} · 확보한 광맥 ${securedCount}/${nodes.length}\n` +
    (buildJob ? `벽 건설 중 ${((buildJob.t / P.wall.buildTime) * 100) | 0}% (무방비!)\n` : '') +
    (waiting ? '' : `위협 Lv.${lvl} (다음 강화 ${nextIn.toFixed(0)}s) · 적 속도 ${enemySpeed().toFixed(1)}\n`) +
    `생존: ${survival.toFixed(1)}s · 벽 ${wallCount}개 · 잡힘 ${caughtCount}회` +
    (grace > 0 ? ` · 무적 ${grace.toFixed(1)}s` : '') +
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
    if (grace > 0) grace -= dt;
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) flashEl.style.opacity = '0';
    }
    if (enemyActive()) {
      updateEnemy(dt);
      const d = Math.hypot(player.x - enemy.x, player.z - enemy.z);
      if (grace <= 0 && d < P.player.radius + P.enemy.radius - 0.02) caught();
    } else {
      // 등장 대기: 스폰 지점에서 반투명하게 예고
      const t = survival / Math.max(P.enemy.spawnDelay, 0.001);
      enemyVis.body.material.opacity = 0.15 + 0.35 * t;
      enemyVis.group.position.set(enemy.x, 0, enemy.z);
    }
    if (enemyActive() && enemyVis.body.material.transparent) {
      enemyVis.body.material.transparent = false;
      enemyVis.body.material.opacity = 1;
    }
    updateNodes(dt);
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
  get resources() { return resources; },
  get caughtCount() { return caughtCount; },
  get grace() { return grace; },
  ENEMY_SPAWN, PLAYER_SPAWN,
  snapshotSettings, applySettings, settingsAsSource,
  get DEFAULT_SETTINGS() { return DEFAULT_SETTINGS; },
  get buildJob() { return buildJob; },
  get securedCount() { return securedCount; },
  get enemyReach() { return enemyReach; },
  nodes, ghost, mouseNDC, CAM_MODES, buildBar,
  setMouse(x, y) { mouseNDC.set(x, y); mouseValid = true; },
  threatLevel, enemySpeed, enemyDps,
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    renderer.render(scene, activeCam());
  },
};
