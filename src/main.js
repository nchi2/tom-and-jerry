import * as THREE from 'three';
import GUI from 'lil-gui';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  player: { speed: 6.0, radius: 0.35, graceTime: 1.5 },
  enemy: {
    count: 3,              // 시작 마릿수 (전부 순찰묘)
    attackRange: 0.6, repath: 0.35,
    spawnDelay: 12,
    spread: 5.0,           // 스폰 지점 주변에 흩어지는 반경
    aggroRange: 7.0,       // 추격 중 이 거리 안의 건물에 한눈팔 수 있음
    aggroChance: 0.35,     // 경로 재계산 때 한눈팔 확률
    aggroTime: 4.0,        // 한 번 끌리면 이 시간 동안 유지
  },
  ally: {
    enabled: 1,            // 1=AI 동료 햄스터 (재시작부터). 0=솔로: 잡히면 즉시 전멸
    speed: 6.0, radius: 0.35,
    followDist: 2.6,       // 이보다 멀면 플레이어를 따라옴
    fleeDist: 4.5,         // 이 거리 안에 적이 오면 도망이 우선
  },
  // ---- 적 3종 ----
  // 통행권(=반지름)과 벽 공격 가능 여부가 종류를 가른다.
  //  순찰묘: 크고 벽 못 부숨 → 벽이 완전한 안전을 줌. 처음부터 등장
  //  날쌘묘: 작고 빠름, 벽 못 부숨 → 2칸 틈을 통과! 넓은 틈의 안전이 깨짐
  //  파괴묘: 제일 크고 느림, 유일하게 벽을 부숨 → 밀폐도 시한부가 됨
  // bldgDps: 건물(창고/공방) 공격력 — 모든 종류가 건물은 부술 수 있다 (원작:
  //          무적 파일런은 못 부숴도 넥서스/생산 건물은 부서짐)
  chaser: { radius: 1.35, speed: 5.0, bldgDps: 15 },
  runner: { radius: 0.85, speed: 6.8, bldgDps: 10 },
  breaker: { radius: 1.6, speed: 4.2, dps: 30, bldgDps: 40 },
  wall: { hp: 100, cooldown: 0.15, height: 1.1, range: 3.0 },
  // 건물 — 원작의 "넥서스 지을 공간이 필요하다"의 이식.
  // 2x2 발자국이라 광맥을 벽 4개로 두르는 최소 확보가 불가능해지고,
  // 채굴하려면 광맥 곁에 건물이 들어갈 공터까지 함께 감싸야 한다.
  depot: { cost: 0, hp: 400, mineRadius: 3.0, storeCap: 30 },    // 치즈 창고 — 무료 (공간이 비용)
  workshop: { cost: 15, hp: 300 },                               // 공방 — 덫/미끼 해금
  res: {
    startWalls: 10, mineRate: 1.2, wallCost: 5, nodeAmount: 40,
    collectRate: 8,      // E 홀드 수확 속도 (초당)
    collectRange: 2.6,   // 창고에서 수확 가능 거리
  },
  tools: {
    trapCost: 8, trapSlow: 0.35, trapTime: 6,     // 끈끈이 덫: 밟는 동안 감속
    decoyCost: 12, decoyTime: 8,                  // 미끼 치즈: 적을 유인
  },
  threat: { interval: 30, speedGain: 0.4, dpsGain: 6, everyLevels: 0 },
};

// ---- 10 스테이지 ----
// 목표: 그 스테이지 동안 "수확한" 치즈 (쓴 것과 무관한 누적량).
// 클리어 시 광맥 매장량이 리필되고(새 치즈가 익음) 적이 표대로 증원된다.
// 새 종류의 첫 등장도 스테이지가 정한다: 3스테이지 날쌘묘, 5스테이지 파괴묘.
const STAGES = [
  { goal: 30,  add: {} },                          // 1 — 시작 무리는 enemy.count(순찰묘)
  { goal: 50,  add: { chaser: 1 } },               // 2
  { goal: 70,  add: { runner: 1 } },               // 3 — 날쌘묘 첫 등장
  { goal: 90,  add: { chaser: 1, runner: 1 } },    // 4
  { goal: 120, add: { breaker: 1 } },              // 5 — 파괴묘 첫 등장
  { goal: 150, add: { chaser: 1, runner: 1 } },    // 6
  { goal: 180, add: { breaker: 1 } },              // 7
  { goal: 220, add: { runner: 2 } },               // 8
  { goal: 260, add: { breaker: 1, runner: 1 } },   // 9
  { goal: 300, add: { breaker: 1, chaser: 1 } },   // 10
];

// ---- 건설 핫바 ----
// 숫자키 1~9로 선택하고 클릭/Space로 짓는다 (6~9는 예약 슬롯)
const BUILD_SLOTS = [
  { key: 'wall', label: '벽', size: 1, cost: () => P.res.wallCost },
  { key: 'depot', label: '치즈 창고', size: 2, cost: () => P.depot.cost },
  { key: 'workshop', label: '공방', size: 2, cost: () => P.workshop.cost },
  { key: 'trap', label: '끈끈이 덫', size: 1, cost: () => P.tools.trapCost },
  { key: 'decoy', label: '미끼 치즈', size: 1, cost: () => P.tools.decoyCost },
];
let buildSlot = 0;
let prevWantBuild = false;

// 적 종류 메타 (숫자가 아니라서 P 밖에 둠 — 세팅 스냅샷에 안 섞이게)
const TYPE_INFO = {
  chaser: { label: '순찰묘', canBreak: false },
  runner: { label: '날쌘묘', canBreak: false },
  breaker: { label: '파괴묘', canBreak: true },
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
  if (ob.mesh) {
    scene.remove(ob.mesh);
    ob.mesh.material.dispose();
  }
}

const WALL_BASE = new THREE.Color(0x8fa1b8);
const WALL_DMG = new THREE.Color(0xd9534f);
function updateWallColor(ob) {
  if (!ob.mesh) return; // 건물 셀은 건물 쪽에서 색을 관리
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

  // 나란한 두 벽 — 왼쪽은 1칸 틈(플레이어만), 오른쪽은 3칸 틈(적도 통과).
  // 같은 화면에 놓아 "저 틈이 저 놈보다 좁은가"를 비교하게 함.
  //
  // 통과 폭은 적 반지름에서 나온다. 기본 r=1.35 → 지름 2.7m 이므로
  //   1칸(1.0m) 막힘 / 2칸(2.0m) 막힘 / 3칸(3.0m) 통과.
  // 적 크기를 슬라이더로 바꾸면 이 교보재의 의미도 같이 바뀐다.
  vLine(14, 10, 20, [15]);
  vLine(30, 10, 20, [14, 15, 16]);

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
let clearNoBldg = null; // 지형+벽만 막힘 — 순찰묘/날쌘묘의 "건물 뚫기" 경로용

// mode: 'all' = 전부 막힘 / 'bed' = 지형만 / 'noBldg' = 지형+벽 (건물은 통과 취급)
function navBlocked(i, j, mode) {
  if (i <= 0 || j <= 0 || i >= NAV - 1 || j >= NAV - 1) return true; // 외곽 림
  const ob = obstacles.get(cellKey(i >> 1, j >> 1));
  if (!ob) return false;
  if (mode === 'bed') return ob.bedrock;
  if (mode === 'noBldg') return ob.bedrock || !ob.bldgRef;
  return true;
}

function computeClearance(mode) {
  const d = new Float32Array(NAV * NAV);
  const INF = 1e9;
  const S2 = Math.SQRT2;
  for (let j = 0; j < NAV; j++)
    for (let i = 0; i < NAV; i++)
      d[j * NAV + i] = navBlocked(i, j, mode) ? 0 : INF;
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
  clearAll = computeClearance('all');
  clearBed = computeClearance('bed');
  clearNoBldg = computeClearance('noBldg');
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
// 모델은 전부 "발밑 반지름 1" 로컬 좌표로 만들고 group.scale = 실제 반지름으로 맞춘다.
// → 보이는 덩치와 충돌 반지름이 항상 일치한다 (크기 비교가 코어이므로 중요).
// 정면은 -Z (기존 회전식 atan2(faceX, faceZ) + PI 과 맞춤).
//
// 아트 방향 (D10): 뭉툭한 저폴리 + 부드러운 셰이딩 + 짧은 팔다리.
const MAT = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...opts });

function buildCreature(parts) {
  const group = new THREE.Group();
  const mats = [];
  for (const p of parts) {
    p.mesh.castShadow = true;
    group.add(p.mesh);
    if (!mats.includes(p.mesh.material)) mats.push(p.mesh.material);
  }
  scene.add(group);
  return {
    group, mats,
    setOpacity(o) {
      for (const m of mats) { m.transparent = o < 1; m.opacity = o; }
    },
    setEmissive(hex, intensity) {
      for (const m of mats) { m.emissive.setHex(hex); m.emissiveIntensity = intensity; }
    },
  };
}

const sphere = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return { mesh: m };
};
const cone = (r, h, mat, x, y, z, rot = 0) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), mat);
  m.position.set(x, y, z);
  m.rotation.x = rot;
  return { mesh: m };
};

// 햄스터 — 둥글고 낮고 뭉툭. 볼주머니 때문에 얼굴이 몸에 파묻힌 실루엣.
function makeHamster(furColor = 0xe8b45a) {
  const fur = MAT(furColor);
  const cream = MAT(0xf7e3c0);
  const dark = MAT(0x2a2320, { roughness: 0.5 });
  const pink = MAT(0xe89aa8);
  // 두 발로 선 자세. 위에서 봐도 발밑 폭은 반지름 1을 넘지 않는다.
  const c = buildCreature([
    sphere(0.26, cream, -0.4, 0.16, -0.16, 1, 0.62, 1.5),  // 발 L
    sphere(0.26, cream, 0.4, 0.16, -0.16, 1, 0.62, 1.5),   // 발 R
    sphere(0.28, fur, -0.36, 0.5, 0.02, 1, 1.15, 1),       // 다리 L
    sphere(0.28, fur, 0.36, 0.5, 0.02, 1, 1.15, 1),        // 다리 R
    sphere(0.84, fur, 0, 1.24, 0.04, 1.16, 1.32, 1),       // 몸통 (선 자세 = 세로로 김)
    sphere(0.62, cream, 0, 1.14, -0.44, 1.08, 1.3, 0.72),  // 배
    sphere(0.64, fur, 0, 2.34, -0.1),                      // 머리
    sphere(0.33, fur, -0.5, 2.2, -0.24, 1, 1, 0.95),       // 볼주머니 L
    sphere(0.33, fur, 0.5, 2.2, -0.24, 1, 1, 0.95),        // 볼주머니 R
    sphere(0.29, pink, -0.44, 2.9, 0.02, 1, 1, 0.45),      // 귀 L
    sphere(0.29, pink, 0.44, 2.9, 0.02, 1, 1, 0.45),       // 귀 R
    sphere(0.31, cream, 0, 2.2, -0.62, 1, 0.86, 1),        // 주둥이
    sphere(0.1, dark, 0, 2.25, -0.9),                      // 코
    sphere(0.14, dark, -0.28, 2.52, -0.56),                // 눈 L
    sphere(0.14, dark, 0.28, 2.52, -0.56),                 // 눈 R
    sphere(0.21, fur, -0.86, 1.38, -0.12, 1, 1.25, 1),     // 팔 L
    sphere(0.21, fur, 0.86, 1.38, -0.12, 1, 1.25, 1),      // 팔 R
    sphere(0.18, cream, -0.9, 0.98, -0.24),                // 손 L
    sphere(0.18, cream, 0.9, 0.98, -0.24),                 // 손 R
    sphere(0.17, pink, 0, 1.0, 0.86, 1, 1, 0.7),           // 꼬리
  ]);
  // 손 = 채굴/환호 모션에서 흔들 부위
  c.handL = c.group.children[17];
  c.handR = c.group.children[18];
  c.armL = c.group.children[15];
  c.armR = c.group.children[16];
  return c;
}

// 적 — 같은 저폴리 문법인데 길고 낮고 넓다. 귀가 뾰족하고 눈이 발광.
// 햄스터와 나란히 놨을 때 "폭"이 먼저 읽히도록 몸통을 가로로 넓힘.
// 종류별 팔레트: 실루엣은 같아도 색으로 즉시 구분되게.
const CAT_PALETTES = {
  chaser: { a: 0x8e4257, b: 0xb0596d, eye: 0xffe14d, glow: 0xffc400 }, // 자주색·노란 눈
  runner: { a: 0x4f6d8e, b: 0x7391b5, eye: 0x7dff9a, glow: 0x37e06b }, // 청회색·초록 눈
  breaker: { a: 0x3d2a33, b: 0x5c3a46, eye: 0xff7a45, glow: 0xff4400 }, // 흑적색·주황 눈
};

function makeCat(type = 'chaser') {
  const pal = CAT_PALETTES[type] || CAT_PALETTES.chaser;
  const furA = MAT(pal.a);
  const furB = MAT(pal.b);
  const dark = MAT(0x241a1e, { roughness: 0.5 });
  const eye = MAT(pal.eye, { emissive: new THREE.Color(pal.glow), emissiveIntensity: 0.9 });
  return buildCreature([
    sphere(0.94, furA, 0, 0.8, 0.34, 1, 0.78, 1.05),    // 몸통 (뒤쪽으로 물림)
    sphere(0.62, furB, 0, 0.6, -0.2, 1, 0.78, 0.85),    // 가슴
    sphere(0.66, furA, 0, 1.24, -0.95),                 // 머리 (몸통 밖으로 빼냄)
    cone(0.28, 0.56, furA, -0.4, 1.78, -0.9),           // 귀 L
    cone(0.28, 0.56, furA, 0.4, 1.78, -0.9),            // 귀 R
    sphere(0.32, furB, 0, 1.06, -1.42, 1.15, 0.8, 0.85), // 주둥이
    sphere(0.1, dark, 0, 1.12, -1.7),                   // 코
    sphere(0.16, eye, -0.28, 1.36, -1.42),              // 눈 L
    sphere(0.16, eye, 0.28, 1.36, -1.42),               // 눈 R
    sphere(0.23, furA, -0.6, 0.22, -0.5, 1, 1.1, 1),    // 앞다리 L
    sphere(0.23, furA, 0.6, 0.22, -0.5, 1, 1.1, 1),     // 앞다리 R
    sphere(0.25, furA, -0.62, 0.24, 0.86, 1, 1.1, 1),   // 뒷다리 L
    sphere(0.25, furA, 0.62, 0.24, 0.86, 1, 1.1, 1),    // 뒷다리 R
    sphere(0.19, furA, 0, 1.02, 1.28, 0.8, 0.8, 1),     // 꼬리 1
    sphere(0.15, furA, 0, 1.4, 1.56, 0.7, 0.7, 0.9),    // 꼬리 2
    sphere(0.11, furB, 0, 1.68, 1.66, 0.7, 0.7, 0.7),   // 꼬리 끝
  ]);
}

const playerVis = makeHamster();
playerVis.group.scale.setScalar(P.player.radius);

// AI 동료 햄스터 (회색). 잡히면 적 본진에서 기절 — 가서 터치하면 구출.
// 원작 "동료가 와야 부활"(D7)의 솔로용 대역이다.
const allyVis = makeHamster(0xb8b8c4);
allyVis.group.scale.setScalar(P.ally.radius);
const ally = {
  active: false,
  x: 0, z: 0, faceX: 0, faceZ: -1,
  stunned: false,
  path: [], repathT: 0,
  goalX: 0, goalZ: 0,
};

const PLAYER_SPAWN = cellToWorld(22, 22);
const ENEMY_SPAWN = cellToWorld(22, 3);

const player = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, faceX: 0, faceZ: -1 };

// ---- 적 무리 ----
// 각자 자기 경로/AI 상태를 따로 가진다. 서로 밀어내기(분리)만 공유.
const enemies = [];

// 스폰 지점 주변에 겹치지 않게 흩뿌림
function enemySpawnPos(n) {
  if (n === 0) return { x: ENEMY_SPAWN.x, z: ENEMY_SPAWN.z };
  const a = n * 2.399963; // 황금각 — 규칙적 격자 느낌 없이 고르게 퍼짐
  const r = P.enemy.spread * Math.sqrt(n / Math.max(P.enemy.count, 1));
  return {
    x: clamp(ENEMY_SPAWN.x + Math.cos(a) * r, -HALF + 1, HALF - 1),
    z: clamp(ENEMY_SPAWN.z + Math.sin(a) * r, -HALF + 1, HALF - 1),
  };
}

// 종류별 스탯 접근자 — 위협 레벨 보정 포함
const typeP = (e) => P[e.type];
const enemyR = (e) => typeP(e).radius;
const enemySpeedOf = (e) => typeP(e).speed + threatLevel() * P.threat.speedGain;
const enemyDpsOf = (e) => (typeP(e).dps || 0) + threatLevel() * P.threat.dpsGain;
const canBreakWalls = (e) => TYPE_INFO[e.type].canBreak;

function makeEnemy(type, n) {
  const p = enemySpawnPos(n);
  const vis = makeCat(type);
  vis.group.scale.setScalar(P[type].radius);
  vis.setOpacity(0.15);
  return {
    type,
    x: p.x, z: p.z,
    path: [],           // [{x, z, idx}]
    aiMode: '추격',      // 추격 / 파괴 / 배회
    goalX: 0, goalZ: 0, // planEnemyPath가 정한 목적지 (플레이어 또는 미끼)
    repathT: Math.random() * P.enemy.repath, // 재계산 타이밍을 흩어 프레임 부하 분산
    attackTarget: null, // 공격 중인 벽
    stallT: 0,
    prevX: p.x, prevZ: p.z,
    dirX: 0, dirZ: 1,
    vis,
  };
}

function setEnemyCount(count) {
  while (enemies.length < count) enemies.push(makeEnemy('chaser', enemies.length));
  while (enemies.length > count) {
    const e = enemies.pop();
    scene.remove(e.vis.group);
  }
  refreshReach();
}

const repathAll = () => { for (const e of enemies) e.repathT = 0; };

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
let storedTotal = 0;   // 모든 광맥 저장고 합 (HUD용)
let collecting = false; // 지금 수확 중인가 (E 홀드 + 사거리 내)

// 적 도달 가능 영역 (내비 격자 flood fill, 적 반지름 기준)
//  → 노드가 이 영역 밖이면 "확보됨"
let enemyReach = null;
function refreshReach() {
  if (!clearAll) return;  // clearance 필드가 아직 없으면 건너뜀 (초기화 순서 보호)
  // 반지름이 다르면 지나갈 수 있는 칸도 다르다.
  // 반지름별로 따로 flood fill 하고 합집합을 취한다.
  //  → 광맥은 "어떤 종류의 어떤 적도 도달 못 할 때"만 확보로 친다.
  //  (날쌘묘가 등장하면 2칸 틈으로 뚫려서, 넓게 막았던 확보가 깨질 수 있다)
  const vis = new Uint8Array(NAV * NAV);
  const radii = [...new Set(enemies.map((e) => enemyR(e)))];
  for (const r of radii) {
    const pass = (i) => canPass(clearAll, i, r);
    const seen = new Uint8Array(NAV * NAV);
    const stack = [];
    for (const e of enemies) {
      if (enemyR(e) !== r) continue;
      const start = nearestPassableNav(e.x, e.z, pass);
      if (pass(start) && !seen[start]) { seen[start] = 1; stack.push(start); }
    }
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur % NAV, cz = (cur / NAV) | 0;
      if (cx > 0 && !seen[cur - 1] && pass(cur - 1)) { seen[cur - 1] = 1; stack.push(cur - 1); }
      if (cx < NAV - 1 && !seen[cur + 1] && pass(cur + 1)) { seen[cur + 1] = 1; stack.push(cur + 1); }
      if (cz > 0 && !seen[cur - NAV] && pass(cur - NAV)) { seen[cur - NAV] = 1; stack.push(cur - NAV); }
      if (cz < NAV - 1 && !seen[cur + NAV] && pass(cur + NAV)) { seen[cur + NAV] = 1; stack.push(cur + NAV); }
    }
    for (let k = 0; k < vis.length; k++) if (seen[k]) vis[k] = 1;
  }
  enemyReach = vis;
}

// ---- 채굴 연출 ----
// 확보된 광맥에서 치즈 조각이 튀어나와 플레이어에게 날아온다.
// "지금 내가 캐고 있다"를 눈으로 알리는 장치 (수치는 이미 HUD에 있으므로
//  여기서는 흐름 자체가 보이게 하는 게 목적).
const cheeseBits = [];
const bitGeo = new THREE.BoxGeometry(1, 1, 1);
const bitMat = new THREE.MeshStandardMaterial({
  color: 0xffd24a, roughness: 0.45,
  emissive: new THREE.Color(0xf0b429), emissiveIntensity: 0.4,
});
let harvestPulse = 0;   // 치즈가 도착할 때 플레이어가 튀는 정도

// target: null이면 플레이어에게, {x,z}면 그 지점(창고)으로 날아간다
function spawnCheeseBit(x, z, target = null) {
  const m = new THREE.Mesh(bitGeo, bitMat);
  m.scale.setScalar(0.12 + Math.random() * 0.06);
  m.position.set(x, 0.5, z);
  m.castShadow = true;
  scene.add(m);
  cheeseBits.push({
    mesh: m, t: 0,
    dur: 0.55 + Math.random() * 0.25,
    x0: x, z0: z, target,
    ax: x + (Math.random() - 0.5) * 2.4,
    az: z + (Math.random() - 0.5) * 2.4,
    spin: (Math.random() - 0.5) * 12,
  });
}

function updateCheeseBits(dt) {
  for (let k = cheeseBits.length - 1; k >= 0; k--) {
    const b = cheeseBits[k];
    b.t += dt;
    const p = b.t / b.dur;
    if (p >= 1) {
      scene.remove(b.mesh);
      cheeseBits.splice(k, 1);
      if (!b.target) harvestPulse = Math.min(harvestPulse + 0.35, 1); // 플레이어 도착 → 반응
      continue;
    }
    const gx = b.target ? b.target.x : player.x;
    const gz = b.target ? b.target.z : player.z;
    // 출발 → (튀어오른 지점) → 목적지 로 이어지는 2차 베지어
    const q = 1 - p;
    const tx = b.x0 * q * q + b.ax * 2 * q * p + gx * p * p;
    const tz = b.z0 * q * q + b.az * 2 * q * p + gz * p * p;
    b.mesh.position.set(tx, 0.5 + Math.sin(p * Math.PI) * 1.1, tz);
    b.mesh.rotation.x += b.spin * dt;
    b.mesh.rotation.y += b.spin * 0.7 * dt;
    b.mesh.scale.setScalar((0.12 + 0.06) * (1 - p * 0.5));
  }
}

// ============================================================
// 건물 — 원작의 "공간이 필요하다"의 이식 (D17)
//  치즈 창고(B, 2x2): 사거리 안 광맥을 자동 채굴해 저장. 옆에서 E 홀드로 수확
//  공방(T, 2x2): 존재해야 덫/미끼 사용 가능
//  - 2x2 발자국 = 광맥을 최소 벽으로 감싸는 대신, 건물 들어갈 공터까지
//    함께 확보해야 한다. "공간 확보"가 채굴의 선행 조건이 되는 지점.
//  - 모든 적 종류가 건물은 공격할 수 있다 (벽은 파괴묘만).
//    원작: 무적 파일런 + 부서지는 넥서스/생산 건물 구조의 이식.
// ============================================================
const buildings = []; // { kind, i, j, cells:[key], hp, maxHp, store, mesh, cx, cz }
const BLDG_INFO = {
  depot: { label: '치즈 창고', body: 0xd9a13b, roof: 0x8a6420 },
  workshop: { label: '공방', body: 0x4f8f8a, roof: 0x2c524e },
};

function buildingAt(i, j) {
  const ob = obstacles.get(cellKey(i, j));
  return ob && ob.bldgRef ? ob.bldgRef : null;
}

function makeBuildingMesh(kind) {
  const info = BLDG_INFO[kind];
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 1.0, 1.9),
    new THREE.MeshStandardMaterial({ color: info.body, roughness: 0.8 })
  );
  body.position.y = 0.5;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.28, 2.05),
    new THREE.MeshStandardMaterial({ color: info.roof, roughness: 0.9 })
  );
  roof.position.y = 1.14;
  body.castShadow = roof.castShadow = true;
  body.receiveShadow = true;
  g.add(body, roof);
  g.userData.body = body;
  return g;
}

// 앵커 (i,j) 기준 2x2. 실패 사유를 문자열로 돌려줘서 플래시로 안내
function buildingPlacement(i, j) {
  if (i < 0 || j < 0 || i + 1 >= CELLS || j + 1 >= CELLS) return '맵 밖입니다';
  const cells = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
  for (const [ci, cj] of cells) {
    if (obstacles.has(cellKey(ci, cj))) return '자리가 막혀 있습니다 (2x2 공터 필요)';
    if (nodeAt(ci, cj)) return '광맥 위에는 지을 수 없습니다';
    if (traps.has(cellKey(ci, cj))) return '덫 위에는 지을 수 없습니다';
    if (distCellToPoint(ci, cj, player.x, player.z) < P.player.radius + 0.02) return '내가 서 있는 자리입니다';
    for (const e of enemies)
      if (distCellToPoint(ci, cj, e.x, e.z) < enemyR(e) + 0.02) return '적이 서 있는 자리입니다';
  }
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  if (Math.hypot(player.x - cx, player.z - cz) > P.wall.range + 1.2) return '너무 멉니다';
  return null;
}

function placeBuilding(kind, i, j) {
  const cost = P[kind].cost;
  if (resources < cost) { flashMsg(`치즈가 부족합니다 (${BLDG_INFO[kind].label} ${cost})`, '#e05050'); return null; }
  const err = buildingPlacement(i, j);
  if (err) { flashMsg(err, '#e05050'); return null; }
  resources -= cost;
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  const mesh = makeBuildingMesh(kind);
  mesh.position.set(cx, 0, cz);
  scene.add(mesh);
  const b = { kind, i, j, cells: [], hp: P[kind].hp, maxHp: P[kind].hp, store: 0, mesh, cx, cz, bitT: 0 };
  for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
    const key = cellKey(ci, cj);
    obstacles.set(key, { i: ci, j: cj, bedrock: false, bldgRef: b, mesh: null });
    b.cells.push(key);
  }
  buildings.push(b);
  refreshClearance();
  repathAll();
  spawnBuildFx(cx, cz);
  return b;
}

function destroyBuilding(b, byEnemy) {
  for (const key of b.cells) obstacles.delete(key);
  scene.remove(b.mesh);
  buildings.splice(buildings.indexOf(b), 1);
  refreshClearance();
  repathAll();
  if (byEnemy) {
    const lost = b.store > 0.5 ? ` (저장 치즈 ${b.store.toFixed(0)} 소실!)` : '';
    flashMsg(`${BLDG_INFO[b.kind].label}가 파괴됐다!${lost}`, '#ff6b6b');
  }
}

function damageBuilding(b, dmg) {
  b.hp -= dmg;
  const t = 1 - Math.max(b.hp, 0) / b.maxHp;
  b.mesh.userData.body.material.color
    .setHex(BLDG_INFO[b.kind].body).lerp(new THREE.Color(0xd9534f), t * 0.8);
  b.mesh.position.y = Math.sin(performance.now() * 0.05) * 0.04;
  if (b.hp <= 0) destroyBuilding(b, true);
}

const hasWorkshop = () => buildings.some((b) => b.kind === 'workshop');
const depotCount = () => buildings.filter((b) => b.kind === 'depot').length;

// 창고 채굴: 사거리 안 광맥에서 저장고로
function updateBuildings(dt) {
  storedTotal = 0;
  for (const b of buildings) {
    if (b.kind !== 'depot') continue;
    storedTotal += b.store;
    const fill = b.store / P.depot.storeCap;
    // 저장량 표시: 지붕 발광, 가득 차면 깜빡임 = "수확하러 와"
    const roof = b.mesh.children[1];
    roof.material.emissive.setHex(0xf0b429);
    roof.material.emissiveIntensity =
      fill >= 1 ? 0.5 + 0.4 * Math.abs(Math.sin(performance.now() * 0.012)) : fill * 0.5;
    if (b.store >= P.depot.storeCap) continue;
    for (const n of nodes) {
      if (n.amount <= 0) continue;
      const w = cellToWorld(n.i, n.j);
      if (Math.hypot(w.x - b.cx, w.z - b.cz) > P.depot.mineRadius) continue;
      const got = Math.min(P.res.mineRate * dt, n.amount, P.depot.storeCap - b.store);
      n.amount -= got;
      b.store += got;
      n.beingMined = true;
      b.bitT += dt;
      if (b.bitT >= 1 / Math.max(P.res.mineRate, 0.2)) {
        b.bitT = 0;
        spawnCheeseBit(w.x, w.z, { x: b.cx, z: b.cz });
      }
      if (b.store >= P.depot.storeCap) break;
    }
  }
}

// 광맥은 이제 시각 전용 — 채굴 주체는 창고다
function updateNodes(dt) {
  for (const n of nodes) {
    const m = n.mesh;
    if (n.amount <= 0) {
      m.material.color.setHex(0x555a66);
      m.material.emissiveIntensity = 0;
      m.scale.setScalar(0.4);
      m.position.y = 0.35;
      continue;
    }
    const base = 0.5 + 0.5 * (n.amount / P.res.nodeAmount);
    m.material.color.setHex(0xf0b429);
    m.material.emissive.setHex(0xf0b429);
    if (n.beingMined) {
      m.rotation.y += dt * 5.0;
      const bob = Math.abs(Math.sin(performance.now() * 0.006));
      m.position.y = 0.35 + bob * 0.2;
      m.scale.setScalar(base * (1 + 0.08 * bob));
      m.material.emissiveIntensity = 0.4 + 0.3 * bob;
    } else {
      m.rotation.y += dt * 1.5;
      m.position.y = 0.35;
      m.scale.setScalar(base);
      m.material.emissiveIntensity = 0;
    }
    n.beingMined = false; // 다음 프레임에 updateBuildings가 다시 세움
  }
}

// ============================================================
// 도구 — 벽과 같은 "공간 조작" 문법의 소모품 (D3 유지: 공격 수단 아님)
//  끈끈이 덫(Q): 밟은 적을 감속. 밟히는 동안만 닳음
//  미끼 치즈(F): 모든 적이 플레이어 대신 미끼로 몰려감. 시간이 지나면(적이
//               옆에서 먹으면 더 빨리) 사라짐 — 수확 원정길을 여는 용도
// ============================================================
const traps = new Map();  // "i,j" -> { i, j, mesh, left }
const decoys = [];        // { x, z, mesh, left }
const trapGeo = new THREE.BoxGeometry(CS * 0.92, 0.06, CS * 0.92);
const decoyGeo = new THREE.OctahedronGeometry(0.55);

function placeTrap(i, j) {
  if (!hasWorkshop()) { flashMsg('공방(T)이 있어야 덫을 만들 수 있습니다', '#e05050'); return false; }
  const key = cellKey(i, j);
  if (traps.has(key) || obstacles.has(key) || nodeAt(i, j)) return false;
  if (resources < P.tools.trapCost) return false;
  resources -= P.tools.trapCost;
  const w = cellToWorld(i, j);
  const mesh = new THREE.Mesh(
    trapGeo,
    new THREE.MeshStandardMaterial({
      color: 0x59c9a5, roughness: 0.5, transparent: true, opacity: 0.85,
      emissive: new THREE.Color(0x2a8f6e), emissiveIntensity: 0.35,
    })
  );
  mesh.position.set(w.x, 0.03, w.z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  traps.set(key, { i, j, mesh, left: P.tools.trapTime });
  return true;
}

function removeTrap(tr) {
  traps.delete(cellKey(tr.i, tr.j));
  scene.remove(tr.mesh);
  tr.mesh.material.dispose();
}

function placeDecoy(i, j) {
  if (!hasWorkshop()) { flashMsg('공방(T)이 있어야 미끼를 만들 수 있습니다', '#e05050'); return false; }
  if (obstacles.has(cellKey(i, j)) || nodeAt(i, j)) return false;
  if (resources < P.tools.decoyCost) return false;
  resources -= P.tools.decoyCost;
  const w = cellToWorld(i, j);
  const mesh = new THREE.Mesh(
    decoyGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffe066, roughness: 0.35,
      emissive: new THREE.Color(0xf0b429), emissiveIntensity: 0.8,
    })
  );
  mesh.position.set(w.x, 0.5, w.z);
  mesh.castShadow = true;
  scene.add(mesh);
  decoys.push({ x: w.x, z: w.z, mesh, left: P.tools.decoyTime });
  repathAll();  // 모두 미끼 쪽으로 재계산
  return true;
}

function updateDecoys(dt) {
  for (let k = decoys.length - 1; k >= 0; k--) {
    const d = decoys[k];
    let eat = 1;  // 기본 부패 1배
    for (const e of enemies)
      if (Math.hypot(e.x - d.x, e.z - d.z) < enemyR(e) + 1.0) eat += 1; // 먹는 중
    d.left -= dt * eat;
    d.mesh.rotation.y += dt * 3;
    d.mesh.scale.setScalar(Math.max(d.left / P.tools.decoyTime, 0.1));
    if (d.left <= 0) {
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      decoys.splice(k, 1);
      repathAll();  // 미끼가 사라졌으니 다시 플레이어에게
    }
  }
}

function clearTools() {
  for (const tr of [...traps.values()]) removeTrap(tr);
  for (const d of decoys) { scene.remove(d.mesh); d.mesh.material.dispose(); }
  decoys.length = 0;
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
// 살아있고 기절 안 한 햄스터들 (적의 추격 대상)
function chaseTargets() {
  const out = [];
  if (!playerStunned) out.push(player);
  if (ally.active && !ally.stunned) out.push(ally);
  return out;
}

function planEnemyPath(enemy) {
  const er = enemyR(enemy);
  const passAll = (i) => canPass(clearAll, i, er);
  const start = nearestPassableNav(enemy.x, enemy.z, passAll);

  // ---- 목표 선택 ----
  // 1) 미끼 치즈 (강제 유인)
  // 2) 어그로 유지 중인 건물 / 새로 눈에 띈 건물 (확률)
  // 3) 가장 가까운 햄스터 (플레이어/동료 중 기절 안 한 쪽)
  let gx = null, gz = null, raiding = false;
  let bestD = Infinity;
  for (const d of decoys) {
    const dd = Math.hypot(d.x - enemy.x, d.z - enemy.z);
    if (dd < bestD) { bestD = dd; gx = d.x; gz = d.z; }
  }
  if (gx === null) {
    // 어그로: 쫓는 중에도 시야에 건물이 들어오면 한눈판다
    if (enemy.raidTarget && buildings.includes(enemy.raidTarget) && survival < enemy.raidUntil) {
      raiding = true;
    } else {
      enemy.raidTarget = null;
      if (Math.random() < P.enemy.aggroChance) {
        let bBest = null, bD = P.enemy.aggroRange;
        for (const b of buildings) {
          const dd = Math.hypot(b.cx - enemy.x, b.cz - enemy.z);
          if (dd < bD) { bD = dd; bBest = b; }
        }
        if (bBest) {
          enemy.raidTarget = bBest;
          enemy.raidUntil = survival + P.enemy.aggroTime;
          raiding = true;
        }
      }
    }
    if (raiding) { gx = enemy.raidTarget.cx; gz = enemy.raidTarget.cz; }
  }
  if (gx === null) {
    const ts = chaseTargets();
    if (!ts.length) { enemy.path = []; enemy.aiMode = '배회'; return; }
    let tBest = ts[0], tD = Infinity;
    for (const t of ts) {
      const dd = Math.hypot(t.x - enemy.x, t.z - enemy.z);
      if (dd < tD) { tD = dd; tBest = t; }
    }
    gx = tBest.x; gz = tBest.z;
  }
  enemy.goalX = gx; enemy.goalZ = gz;
  const goal = worldToNav(gx, gz);

  // ---- 직행 경로 ----
  const res = astar(start, goal, passAll, () => 0);
  if (res.found || res.closestWorld < 1.3 + (raiding ? enemyR(enemy) : 0)) {
    enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = raiding ? '습격' : '추격';
    return;
  }

  // ---- 돌파 경로: 가로막는 아군 구조물을 부수며 뚫고 온다 ----
  // 파괴묘: 벽+건물 전부 / 순찰묘·날쌘묘: 건물만 (벽은 여전히 절대 못 부숨)
  const obAt = (idx) => obstacles.get(cellKey((idx % NAV) >> 1, ((idx / NAV) | 0) >> 1));
  const canBreakOb = (ob) =>
    ob && !ob.bedrock && (canBreakWalls(enemy) || !!ob.bldgRef);
  const passBreak = canBreakWalls(enemy)
    ? (i) => canPass(clearBed, i, er)
    : (i) => canPass(clearNoBldg, i, er);
  const res2 = astar(start, goal, passBreak, (idx) => (canBreakOb(obAt(idx)) ? 80 : 0));
  if (res2.found && res2.path.some((idx) => canBreakOb(obAt(idx)))) {
    enemy.path = res2.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = '파괴';
    return;
  }

  // ---- 뚫을 수도 없음 → 도달 가능한 건물이라도 (습격) ----
  let raidBest = null, raidPath = null, raidD = Infinity;
  for (const b of buildings) {
    const bres = astar(start, worldToNav(b.cx, b.cz), passAll, () => 0);
    if (bres.closestWorld < 1.6 + enemyR(enemy)) {
      const dd = Math.hypot(b.cx - enemy.x, b.cz - enemy.z);
      if (dd < raidD) { raidD = dd; raidBest = b; raidPath = bres.path; }
    }
  }
  if (raidBest) {
    enemy.path = raidPath.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = '습격';
    enemy.raidTarget = raidBest;
    enemy.raidUntil = survival + P.enemy.aggroTime;
    enemy.goalX = raidBest.cx; enemy.goalZ = raidBest.cz;
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
// ---- 시간에 따른 적 투입 ----
//  1) 스테이지 표(STAGES)가 증원과 새 종류 등장을 결정한다
//  2) everyLevels(옵션, 기본 0)가 켜져 있으면 위협 레벨마다 +1마리 추가
let growthSpawned = 0;

// ---- 스테이지 상태 ----
let stage = 1;            // 1..10
let stageCollected = 0;   // 이번 스테이지에 "수확한" 치즈 (소비와 무관한 누적)
let victory = false;

const stageGoal = () => STAGES[Math.min(stage, STAGES.length) - 1].goal;

// 지금까지의 스테이지 표에 등장한 종류들 (증원 스폰 풀)
function unlockedTypes() {
  const out = new Set(['chaser']);
  for (let k = 0; k < Math.min(stage, STAGES.length); k++)
    for (const ty of Object.keys(STAGES[k].add)) out.add(ty);
  return [...out];
}

// 스테이지 시작 증원: 표의 add 대로 스폰. 새 종류면 등장 플래시
function spawnStageAdds(idx) {
  const add = STAGES[idx].add;
  const before = new Set(enemies.map((e) => e.type));
  for (const [ty, cnt] of Object.entries(add))
    for (let k = 0; k < cnt; k++) enemies.push(makeEnemy(ty, enemies.length));
  refreshReach();
  for (const ty of Object.keys(add))
    if (!before.has(ty)) flashMsg(`새로운 적 등장: ${TYPE_INFO[ty].label}!`, '#ff8b5e');
}

function advanceStage() {
  if (stage >= STAGES.length) {
    victory = true;
    overlayEl.querySelector('h1').textContent = '10 스테이지 클리어!';
    document.getElementById('overlay-sub').textContent =
      `${survival.toFixed(0)}초 · 잡힘 ${caughtCount}회 — R 키로 처음부터`;
    overlayEl.classList.remove('hidden');
    return;
  }
  stage++;
  stageCollected = 0;
  for (const n of nodes) n.amount = P.res.nodeAmount; // 새 치즈가 익음
  spawnStageAdds(stage - 1);
  flashMsg(`스테이지 ${stage} — 목표 치즈 ${stageGoal()}`, '#6ee07a');
}

// 시간 기반 증원은 옵션으로만 남김 (everyLevels=0이면 스테이지 표만 사용)
function updateSpawns() {
  const per = P.threat.everyLevels;
  const growthTarget = per > 0 ? Math.floor(threatLevel() / per) : 0;
  while (growthSpawned < growthTarget) {
    growthSpawned++;
    const pool = unlockedTypes();
    const ty = pool[Math.floor(Math.random() * pool.length)];
    enemies.push(makeEnemy(ty, enemies.length));
    refreshReach();
    flashMsg(`적이 늘었다! (${enemies.length}마리)`, '#ffb347');
  }
}

// 적끼리 겹치지 않게 서로 밀어냄 — 한 덩어리로 뭉쳐 다니는 걸 막는다
function separateEnemies() {
  for (let a = 0; a < enemies.length; a++)
    for (let b = a + 1; b < enemies.length; b++) {
      const e1 = enemies[a], e2 = enemies[b];
      let dx = e2.x - e1.x, dz = e2.z - e1.z;
      let d = Math.hypot(dx, dz);
      const min = (enemyR(e1) + enemyR(e2)) * 0.875;
      if (d >= min) continue;
      if (d < 1e-4) { dx = 0.01; dz = 0; d = 0.01; }
      const push = ((min - d) / d) * 0.5;
      e1.x -= dx * push; e1.z -= dz * push;
      e2.x += dx * push; e2.z += dz * push;
    }
  for (const e of enemies) collideWithObstacles(e, enemyR(e));
}

function updateEnemy(enemy, dt) {
  const er = enemyR(enemy);
  enemy.repathT -= dt;
  if (enemy.repathT <= 0) {
    enemy.repathT = P.enemy.repath;
    planEnemyPath(enemy);
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
    tx = enemy.goalX; tz = enemy.goalZ; // 마지막 구간은 직진 (플레이어 또는 미끼)
  } else {
    tx = enemy.x; tz = enemy.z;
  }
  // 끈끈이 덫: 밟고 있는 동안 감속 + 덫이 닳는다
  let spd = enemySpeedOf(enemy);
  const ec = worldToCell(enemy.x, enemy.z);
  const tr = traps.get(cellKey(ec.i, ec.j));
  if (tr) {
    spd *= P.tools.trapSlow;
    tr.left -= dt;
    if (tr.left <= 0) removeTrap(tr);
  }
  let dx = tx - enemy.x, dz = tz - enemy.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.05) {
    dx /= dl; dz /= dl;
    enemy.x += dx * spd * dt;
    enemy.z += dz * spd * dt;
  }
  collideWithObstacles(enemy, er);

  // 벽 공격: (a) 파괴 경로상 다음 벽  (b) 정체 시 근처 벽
  enemy.attackTarget = null;
  const reach = er + P.enemy.attackRange;
  if (enemy.aiMode === '파괴') {
    for (let k = 0; k < Math.min(enemy.path.length, 6); k++) {
      const idx = enemy.path[k].idx;
      const ob = obstacles.get(cellKey((idx % NAV) >> 1, ((idx / NAV) | 0) >> 1));
      if (!ob || ob.bedrock) continue;
      if (!canBreakWalls(enemy) && !ob.bldgRef) continue; // 순찰/날쌘은 벽 스킵
      if (distToObstacle(enemy, ob) <= reach) {
        enemy.attackTarget = ob;
        break;
      }
    }
  }
  // 정체 감지
  const moved = Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ);
  if (moved < spd * dt * 0.3) enemy.stallT += dt;
  else enemy.stallT = 0;
  enemy.prevX = enemy.x; enemy.prevZ = enemy.z;

  // 우회 우선 원칙:
  //  - 추격 중(우회로 있음) 정체 → 벽을 부수지 말고 경로 재계산부터
  //  - 습격: 목표 건물이 손에 닿으면 공격 (모든 종류)
  //  - 파괴묘만: 오래 막히면 손 닿는 벽 공격
  //  - 순찰묘/날쌘묘는 벽은 절대 건드리지 않는다 (건물만 공격 가능)
  if (enemy.aiMode === '추격' && enemy.stallT > 0.4) enemy.repathT = 0;
  const stallLimit = enemy.aiMode === '추격' ? 2.5 : 0.6;

  // 습격 대상 건물이 손에 닿는가
  let bldgTarget = null;
  if (enemy.aiMode === '습격' && enemy.raidTarget && buildings.includes(enemy.raidTarget)) {
    const b = enemy.raidTarget;
    let dMin = Infinity;
    for (const key of b.cells) {
      const ob = obstacles.get(key);
      if (ob) dMin = Math.min(dMin, distToObstacle(enemy, ob));
    }
    if (dMin <= reach) bldgTarget = b;
  }
  // 정체 폴백: 손 닿는 건물은 모든 종류가 공격, 벽은 파괴묘만
  if (!bldgTarget && !enemy.attackTarget && enemy.stallT > stallLimit) {
    let bestWall = null, bestB = null, bestD = reach + 0.4;
    for (const ob of obstacles.values()) {
      if (ob.bedrock) continue;
      if (!ob.bldgRef && !canBreakWalls(enemy)) continue;
      const d = distToObstacle(enemy, ob);
      if (d < bestD) {
        bestD = d;
        if (ob.bldgRef) { bestB = ob.bldgRef; bestWall = null; }
        else { bestWall = ob; bestB = null; }
      }
    }
    if (bestB) bldgTarget = bestB;
    else enemy.attackTarget = bestWall;
  }

  if (!bldgTarget && enemy.attackTarget && enemy.attackTarget.bldgRef)
    bldgTarget = enemy.attackTarget.bldgRef; // 파괴 경로상의 건물 셀

  if (bldgTarget) {
    damageBuilding(bldgTarget, (typeP(enemy).bldgDps + threatLevel() * P.threat.dpsGain) * dt);
    enemy.attackTarget = null;
  } else if (enemy.attackTarget) {
    const ob = enemy.attackTarget;
    if (!obstacles.has(cellKey(ob.i, ob.j))) {
      enemy.attackTarget = null; // 이미 사라진 벽
    } else {
      ob.hp -= enemyDpsOf(enemy) * dt;
      updateWallColor(ob);
      ob.mesh.position.y = (ob.mesh.scale.y / 2) + Math.sin(performance.now() * 0.05) * 0.03;
      if (ob.hp <= 0) {
        removeObstacle(ob);
        refreshClearance();
        repathAll();          // 길이 뚫렸으니 무리 전체가 다시 판단
        enemy.attackTarget = null;
      }
    }
  }

  // 공격 중 표시 (몸 색 펄스)
  if (bldgTarget || enemy.attackTarget) {
    enemy.vis.setEmissive(0xff2222, 0.35 + 0.25 * Math.sin(performance.now() * 0.02));
  } else {
    enemy.vis.setEmissive(0x000000, 0);
  }
  enemy.isAttacking = !!(bldgTarget || enemy.attackTarget);

  enemy.vis.group.position.set(enemy.x, 0, enemy.z);
  if (dl > 0.05) {
    enemy.dirX = dx; enemy.dirZ = dz;
    enemy.vis.group.rotation.y = Math.atan2(dx, -dz) + Math.PI;
  }
}

// ============================================================
// 입력
// ============================================================
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyC') cycleCamera(1);
  // 숫자키 = 건설 슬롯 선택 (카메라는 C키/드롭다운으로)
  for (let k = 0; k < 9; k++) {
    if (e.code === 'Digit' + (k + 1)) {
      if (k < BUILD_SLOTS.length) { buildSlot = k; updateHotbar(); }
      break;
    }
  }
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
// 창이 숨겨지거나 최소화되면 innerWidth/innerHeight가 0이 되어
// 투영 행렬이 NaN이 된다 (마우스 레이캐스트까지 같이 죽음). 안전한 기본값으로 막는다.
const viewAspect = () => (innerWidth > 0 && innerHeight > 0 ? innerWidth / innerHeight : 16 / 9);

const persp = new THREE.PerspectiveCamera(50, viewAspect(), 0.1, 200);
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
let camIndex = 1; // 기본 = 쿼터뷰 (2번)
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
    const aspect = viewAspect();
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
let resources = startResources();

// ============================================================
// 설치 이펙트 — "펑"
//  게임플레이상 벽은 즉시 완성이다. 아래는 순수 연출이며
//  충돌/길찾기는 addObstacle 시점에 이미 반영돼 있다.
// ============================================================
const fx = [];
const ringGeo = new THREE.RingGeometry(0.45, 0.62, 28);
const dustGeo = new THREE.BoxGeometry(1, 1, 1);

function spawnBuildFx(x, z) {
  // 바닥 충격파 링
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 0.95,
      depthTest: false, side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  ring.renderOrder = 998;
  scene.add(ring);
  fx.push({ mesh: ring, t: 0, dur: 0.4, kind: 'ring' });

  // 흙먼지 파편
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 2.2 + Math.random() * 2.6;
    const m = new THREE.Mesh(
      dustGeo,
      new THREE.MeshBasicMaterial({ color: 0xdfe7f2, transparent: true, opacity: 0.9 })
    );
    const s = 0.08 + Math.random() * 0.1;
    m.scale.setScalar(s);
    m.position.set(x, 0.2 + Math.random() * 0.3, z);
    scene.add(m);
    fx.push({
      mesh: m, t: 0, dur: 0.45 + Math.random() * 0.2, kind: 'dust',
      vx: Math.cos(a) * sp, vy: 2.6 + Math.random() * 2.2, vz: Math.sin(a) * sp,
      spin: (Math.random() - 0.5) * 14,
    });
  }
}

function updateFx(dt) {
  for (let k = fx.length - 1; k >= 0; k--) {
    const f = fx[k];
    f.t += dt;
    const p = f.t / f.dur;
    if (p >= 1) {
      scene.remove(f.mesh);
      f.mesh.material.dispose();
      fx.splice(k, 1);
      continue;
    }
    if (f.kind === 'ring') {
      f.mesh.scale.setScalar(0.5 + p * 2.6);
      f.mesh.material.opacity = 0.95 * (1 - p) ** 1.5;
    } else {
      f.vy -= 14 * dt;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y = Math.max(f.mesh.position.y + f.vy * dt, 0.04);
      f.mesh.position.z += f.vz * dt;
      f.mesh.rotation.x += f.spin * dt;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.material.opacity = 0.9 * (1 - p);
    }
  }
}

// 벽이 솟아오르는 팝 애니메이션 (0.16초, 연출 전용)
const popping = [];
function updateWallPops(dt) {
  for (let k = popping.length - 1; k >= 0; k--) {
    const w = popping[k];
    w.t += dt;
    const p = Math.min(w.t / 0.16, 1);
    // 살짝 오버슈트했다가 제자리
    const e = p < 1 ? 1.14 * Math.sin((p * Math.PI) / 2) - 0.14 * Math.sin(p * Math.PI) : 1;
    const h = P.wall.height * Math.max(e, 0.02);
    if (!obstacles.has(cellKey(w.ob.i, w.ob.j))) { popping.splice(k, 1); continue; }
    w.ob.mesh.scale.y = h;
    w.ob.mesh.position.y = h / 2;
    if (p >= 1) popping.splice(k, 1);
  }
}

function updatePlayer(dt) {
  // ---- 기절: 조작 불능, 누워서 동료를 기다린다 ----
  if (playerStunned) {
    playerVis.group.position.set(player.x, 0.25, player.z);
    playerVis.group.rotation.x = -Math.PI / 2;
    playerVis.mats?.forEach?.(() => {});
    playerVis.setOpacity(0.5 + 0.2 * Math.sin(performance.now() * 0.005));
    ghost.visible = false;
    collecting = false;
    return;
  }
  playerVis.group.rotation.x = 0;
  playerVis.setOpacity(1);

  const wantBuild = keys.has('Space') || mouseDown;
  const buildPressed = wantBuild && !prevWantBuild; // 눌리는 순간 (연사 방지용)
  prevWantBuild = wantBuild;

  // ---- 이동 (건설이 즉시라 이동을 막는 구간이 없다) ----
  {
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

  // ---- 수확 (E 홀드, 창고 사거리 내) ----
  // 창고 저장고 → 주머니. 수확량이 스테이지 목표에 카운트된다.
  collecting = false;
  if (keys.has('KeyE')) {
    for (const b of buildings) {
      if (b.kind !== 'depot' || b.store <= 0.01) continue;
      let dMin = Infinity;
      for (const key of b.cells) {
        const ob = obstacles.get(key);
        if (ob) dMin = Math.min(dMin, distCellToPoint(ob.i, ob.j, player.x, player.z));
      }
      if (dMin > P.res.collectRange) continue;
      const got = Math.min(P.res.collectRate * dt, b.store);
      b.store -= got;
      resources += got;
      stageCollected += got;
      collecting = true;
      b.cBitT = (b.cBitT || 0) + dt;
      if (b.cBitT >= 0.12) { b.cBitT = 0; spawnCheeseBit(b.cx, b.cz); }
      break; // 한 번에 한 창고
    }
    if (!victory && stageCollected >= stageGoal()) advanceStage();
  }

  // ---- 채굴 리액션 ----
  // 치즈 조각이 도착할 때마다 harvestPulse 가 오르고, 그동안 햄스터가
  // 위아래로 통통 튀면서 두 손을 흔든다 = "내가 지금 캐고 있다"
  harvestPulse = Math.max(harvestPulse - dt * 1.6, 0);
  const t = performance.now() * 0.012;
  const bounce = harvestPulse * Math.abs(Math.sin(t * 1.4));
  playerVis.group.position.y = bounce * 0.18;
  playerVis.group.scale.set(
    P.player.radius * (1 + bounce * 0.06),
    P.player.radius * (1 - bounce * 0.08),
    P.player.radius * (1 + bounce * 0.06)
  );
  if (playerVis.handL) {
    const swing = harvestPulse * 0.9;
    playerVis.armL.position.y = 1.38 + Math.sin(t * 2.2) * swing * 0.22;
    playerVis.armR.position.y = 1.38 - Math.sin(t * 2.2) * swing * 0.22;
    playerVis.handL.position.y = 0.98 + Math.sin(t * 2.2) * swing * 0.34;
    playerVis.handR.position.y = 0.98 - Math.sin(t * 2.2) * swing * 0.34;
  }

  // ---- 건설 고스트: 마우스가 가리키는 타일 + 선택 슬롯의 발자국 ----
  let gi = ghostCell.i, gj = ghostCell.j, hasTile = false;
  if (mouseValid) {
    raycaster.setFromCamera(mouseNDC, activeCam());
    if (raycaster.ray.intersectPlane(groundPlane, mouseHit)) {
      const c = worldToCell(mouseHit.x, mouseHit.z);
      gi = c.i; gj = c.j;
      hasTile = true;
    }
  }
  const slot = BUILD_SLOTS[buildSlot];
  const w = cellToWorld(gi, gj);
  const affordable = resources >= slot.cost();
  let valid = false;
  if (hasTile) {
    if (slot.size === 2) {
      valid = affordable && !buildingPlacement(gi, gj);
    } else {
      const occupied = obstacles.has(cellKey(gi, gj));
      const inRange = distCellToPoint(gi, gj, player.x, player.z) <= P.wall.range;
      const onNode = !!nodeAt(gi, gj);
      const hitsPlayer = distCellToPoint(gi, gj, player.x, player.z) < P.player.radius + 0.02;
      let hitsEnemy = false;
      for (const e of enemies)
        if (distCellToPoint(gi, gj, e.x, e.z) < enemyR(e) + 0.02) { hitsEnemy = true; break; }
      const allyBlock = ally.active && distCellToPoint(gi, gj, ally.x, ally.z) < P.ally.radius + 0.02
        && slot.key === 'wall';
      valid = inRange && !occupied && !onNode && !hitsPlayer && !hitsEnemy && !allyBlock && affordable
        && (slot.key !== 'trap' || !traps.has(cellKey(gi, gj)));
    }
  }
  ghostCell = { i: gi, j: gj, valid };
  ghost.visible = alive && hasTile;
  if (slot.size === 2) {
    ghost.scale.set(CS * 1.98, slot.key === 'wall' ? P.wall.height : 1.2, CS * 1.98);
    ghost.position.set(w.x + CS / 2, 0.6, w.z + CS / 2);
  } else if (slot.key === 'trap' || slot.key === 'decoy') {
    ghost.scale.set(CS * 0.9, 0.15, CS * 0.9);
    ghost.position.set(w.x, 0.08, w.z);
  } else {
    ghost.scale.set(CS * 0.98, P.wall.height, CS * 0.98);
    ghost.position.set(w.x, P.wall.height / 2, w.z);
  }
  ghost.material.color.setHex(valid ? 0x6ee07a : 0xe05050);

  // ---- 즉시 건설 (선택 슬롯) ----
  // 벽: 홀드하면 쿨다운마다 연속 설치 / 나머지: 누르는 순간 1회
  buildCooldown -= dt;
  if (slot.key === 'wall') {
    if (wantBuild && buildCooldown <= 0 && valid) {
      resources -= P.res.wallCost;
      const ob = addObstacle(gi, gj, false);
      refreshClearance();
      repathAll();
      ob.mesh.scale.y = 0.02;
      ob.mesh.position.y = 0.01;
      popping.push({ ob, t: 0 });
      spawnBuildFx(w.x, w.z);
      buildCooldown = P.wall.cooldown;
    }
  } else if (buildPressed && hasTile) {
    if (slot.key === 'depot') placeBuilding('depot', gi, gj);
    else if (slot.key === 'workshop') placeBuilding('workshop', gi, gj);
    else if (slot.key === 'trap') placeTrap(gi, gj);
    else if (slot.key === 'decoy') placeDecoy(gi, gj);
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
    repathAll();
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
  const f = gui.addFolder('적 (공통)');
  f.add(P.enemy, 'count', 1, 12, 1).name('시작 마릿수 (순찰묘)')
    .onChange((v) => setEnemyCount(v));
  f.add(P.enemy, 'attackRange', 0.2, 2, 0.05).name('공격 사거리');
  f.add(P.enemy, 'repath', 0.1, 1.5, 0.05).name('경로 재계산 주기');
  f.add(P.enemy, 'spawnDelay', 0, 60, 1).name('등장 딜레이(초)');
  f.add(P.enemy, 'spread', 0, 14, 0.5).name('스폰 흩어짐 (재시작부터)');
  f.add(P.enemy, 'aggroRange', 0, 16, 0.5).name('건물 어그로 시야');
  f.add(P.enemy, 'aggroChance', 0, 1, 0.05).name('한눈팔 확률');
  f.add(P.enemy, 'aggroTime', 1, 12, 0.5).name('어그로 지속(초)');
}
{
  // 종류별 스탯 — 반지름을 바꾸면 그 종류의 모델 크기와 통행권이 같이 바뀐다
  const f = gui.addFolder('적 유형');
  const radiusChanged = (type) => () => {
    for (const e of enemies) if (e.type === type) e.vis.group.scale.setScalar(P[type].radius);
    refreshReach();
    repathAll();
  };
  const f1 = f.addFolder('순찰묘 (벽 못 부숨)');
  f1.add(P.chaser, 'radius', 0.4, 3.0, 0.05).name('반지름').onChange(radiusChanged('chaser'));
  f1.add(P.chaser, 'speed', 2, 14, 0.1).name('이동 속도');
  const f2 = f.addFolder('날쌘묘 (작고 빠름)');
  f2.add(P.runner, 'radius', 0.4, 3.0, 0.05).name('반지름').onChange(radiusChanged('runner'));
  f2.add(P.runner, 'speed', 2, 14, 0.1).name('이동 속도');
  const f3 = f.addFolder('파괴묘 (벽 부숨)');
  f3.add(P.breaker, 'radius', 0.4, 3.0, 0.05).name('반지름').onChange(radiusChanged('breaker'));
  f3.add(P.breaker, 'speed', 2, 14, 0.1).name('이동 속도');
  f3.add(P.breaker, 'dps', 5, 150, 1).name('벽 공격력(초당)');
}
{
  const f = gui.addFolder('벽');
  f.add(P.wall, 'hp', 20, 500, 5).name('내구도 (새 벽부터)');
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
  f.add(P.res, 'collectRate', 1, 30, 0.5).name('수확 속도(E 홀드)');
  f.add(P.res, 'collectRange', 0.8, 6, 0.1).name('수확 사거리');
}
{
  const f = gui.addFolder('동료 (AI 햄스터)');
  f.add(P.ally, 'enabled', 0, 1, 1).name('사용 (재시작부터, 0=솔로)');
  f.add(P.ally, 'speed', 2, 12, 0.1).name('이동 속도');
  f.add(P.ally, 'followDist', 1, 8, 0.1).name('따라오는 거리');
  f.add(P.ally, 'fleeDist', 1, 10, 0.1).name('도망 시작 거리');
}
{
  const f = gui.addFolder('건물 (2번 창고 · 3번 공방)');
  f.add(P.depot, 'cost', 5, 60, 1).name('창고 비용');
  f.add(P.depot, 'hp', 50, 1500, 10).name('창고 내구도 (새 건물부터)');
  f.add(P.depot, 'mineRadius', 1, 8, 0.5).name('창고 채굴 사거리');
  f.add(P.depot, 'storeCap', 5, 120, 5).name('창고 저장 상한');
  f.add(P.workshop, 'cost', 5, 60, 1).name('공방 비용');
  f.add(P.workshop, 'hp', 50, 1500, 10).name('공방 내구도 (새 건물부터)');
}
{
  const f = gui.addFolder('도구 (4번 덫 · 5번 미끼) — 공방 필요');
  f.add(P.tools, 'trapCost', 1, 30, 1).name('덫 비용');
  f.add(P.tools, 'trapSlow', 0.1, 0.9, 0.05).name('덫 감속 배율');
  f.add(P.tools, 'trapTime', 1, 20, 0.5).name('덫 지속(밟는 동안)');
  f.add(P.tools, 'decoyCost', 1, 40, 1).name('미끼 비용');
  f.add(P.tools, 'decoyTime', 2, 30, 1).name('미끼 지속(초)');
}
{
  const f = gui.addFolder('위협 (시간 경과 강화)');
  f.add(P.threat, 'interval', 5, 90, 1).name('강화 주기(초)');
  f.add(P.threat, 'speedGain', 0, 2, 0.05).name('속도 증가/레벨');
  f.add(P.threat, 'dpsGain', 0, 40, 1).name('공격력 증가/레벨');
  f.add(P.threat, 'everyLevels', 0, 6, 1).name('N레벨마다 +1마리 (0=안 늘어남)');
}

// ============================================================
// 세팅 내보내기 / 불러오기
//  플레이 중 맞춘 값을 그대로 복사 → 소스의 P 기본값으로 붙여넣기 위한 기능.
//  카메라 파라미터도 함께 담긴다.
// ============================================================
function snapshotSettings() {
  const cams = {};
  for (const m of CAM_MODES) cams[m.key] = { ...m.params };
  const out = { camera: cams };
  for (const k of Object.keys(P)) out[k] = { ...P[k] };
  return out;
}

// 소스에 그대로 붙여넣을 수 있는 형태로 출력
function settingsAsSource(s) {
  const line = (obj) =>
    Object.entries(obj).map(([k, v]) => `${k}: ${+v.toFixed(3)}`).join(', ');
  let out = 'const P = {\n';
  for (const k of Object.keys(P))
    if (s[k]) out += `  ${k}: { ${line(s[k])} },\n`;
  out += '};\n\n// 카메라 기본값\n';
  for (const [key, p] of Object.entries(s.camera))
    out += `// ${key}: { ${line(p)} }\n`;
  return out;
}

function applySettings(s) {
  for (const k of Object.keys(P))
    if (s[k]) Object.assign(P[k], s[k]);
  if (s.camera)
    for (const m of CAM_MODES) if (s.camera[m.key]) Object.assign(m.params, s.camera[m.key]);
  // 슬라이더 표시 갱신 + 값에 연동된 것들 반영
  playerVis.group.scale.setScalar(P.player.radius);
  for (const e of enemies) e.vis.group.scale.setScalar(enemyR(e));
  for (const ob of obstacles.values()) {
    if (ob.bedrock || ob.building) continue;
    ob.mesh.scale.y = P.wall.height;
    ob.mesh.position.y = P.wall.height / 2;
  }
  repathAll();
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
const camSelector = { mode: CAM_MODES[camIndex].name };
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
const overlayEl = document.getElementById('overlay');
const flashEl = document.getElementById('flash');
helpEl.textContent =
  'WASD 이동 · 1~5 건설 선택 → 클릭/Space 설치 · X: 벽 제거 · E 홀드: 창고에서 수확\n' +
  '광맥 옆에 창고(무료)를 지어야 채굴됨 · 수확량이 스테이지 목표 · 덫·미끼는 공방 필요\n' +
  '고양이는 쫓아오다 가로막는 건물을 부수고, 눈에 띄면 한눈판다 (벽은 파괴묘만 부숨)\n' +
  '잡히면 펑! 본진에서 기절 — 동료가 터치하면 구출. 모두 잡히면 끝 · C 카메라 · P 일시정지 · R 재시작';

let alive = true;
let paused = false;
let survival = 0;
let hudT = 0;
let caughtCount = 0;
let playerStunned = false; // 동료 모드에서 잡힌 상태 — 동료가 와서 깨워야 함
let grace = 0;   // 구출/시작 직후 짧은 무적 (초)
let flashT = 0;  // 화면 중앙 알림 남은 시간

function restart() {
  for (const f of [...fx]) { scene.remove(f.mesh); f.mesh.material.dispose(); }
  fx.length = 0;
  popping.length = 0;
  for (const b of cheeseBits) scene.remove(b.mesh);
  cheeseBits.length = 0;
  harvestPulse = 0;
  for (const n of nodes) n.bitT = 0;
  resources = startResources();
  for (const n of nodes) {
    n.amount = P.res.nodeAmount;
    n.mesh.material.color.setHex(0xf0b429);
  }
  clearTools();
  for (const b of [...buildings]) destroyBuilding(b, false);
  stage = 1;
  stageCollected = 0;
  victory = false;
  growthSpawned = 0;
  playerStunned = false;
  allyGrace = 0;
  ally.active = !!P.ally.enabled;
  ally.stunned = false;
  ally.path = [];
  ally.x = PLAYER_SPAWN.x + 1.4;
  ally.z = PLAYER_SPAWN.z + 0.6;
  allyVis.group.rotation.x = 0;
  allyVis.setOpacity(1);
  playerVis.group.rotation.x = 0;
  playerVis.setOpacity(1);
  for (const ob of [...obstacles.values()]) if (!ob.bedrock) removeObstacle(ob);
  refreshClearance();
  player.x = PLAYER_SPAWN.x; player.z = PLAYER_SPAWN.z;
  player.faceX = 0; player.faceZ = -1;
  // 적 무리 초기화 — 마릿수 슬라이더 변경분도 여기서 반영
  for (const e of enemies) scene.remove(e.vis.group);
  enemies.length = 0;
  setEnemyCount(P.enemy.count);
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
// 잡힘 — "펑" 하고 적 본진으로 끌려간다.
//  동료 모드: 기절 상태로 눕는다. 동료(또는 플레이어)가 터치하면 부활.
//  모두 기절하면 전멸 = 게임 오버. 동료가 없으면 한 번 잡히면 바로 전멸.
function caught(who) {
  caughtCount++;
  spawnBuildFx(who.x, who.z); // 잡힌 자리에서 펑
  who.x = ENEMY_SPAWN.x;
  who.z = ENEMY_SPAWN.z + (who === ally ? 1.2 : 0);
  who.faceX = 0; who.faceZ = 1;
  collideWithObstacles(who, P.player.radius);
  spawnBuildFx(who.x, who.z); // 떨어진 자리에서도 펑
  // 무리 전체가 잠깐 멈칫하고 다시 판단
  for (const e of enemies) {
    e.path = []; e.repathT = 0; e.stallT = 0; e.attackTarget = null; e.raidTarget = null;
  }
  const soloMode = !ally.active;
  if (who === player) {
    playerStunned = true;
    camTarget.set(player.x, 0, player.z); // 카메라가 끌려간 걸 보여줌
    if (soloMode || ally.stunned) return gameOver();
    flashMsg('잡혔다! 동료가 구하러 올 때까지 기절', '#ff6b6b');
  } else {
    ally.stunned = true;
    ally.path = [];
    if (playerStunned) return gameOver();
    flashMsg('동료가 잡혔다! 적 본진에서 기절 — 구하러 가자', '#ff6b6b');
  }
}

function gameOver() {
  alive = false;
  ghost.visible = false;
  overlayEl.querySelector('h1').textContent = '모두 잡혔다!';
  document.getElementById('overlay-sub').textContent =
    `스테이지 ${stage} · ${survival.toFixed(0)}초 생존 · 잡힘 ${caughtCount}회 — R 키로 다시 시작`;
  overlayEl.classList.remove('hidden');
}

// 구출: 기절한 쪽에 다른 햄스터가 닿으면 부활
function updateRescue() {
  if (!ally.active) return;
  const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1.2;
  if (playerStunned && !ally.stunned && near(ally, player)) {
    playerStunned = false;
    grace = P.player.graceTime;
    spawnBuildFx(player.x, player.z);
    flashMsg('구출됐다!', '#6ee07a');
  }
  if (ally.stunned && !playerStunned && near(player, ally)) {
    ally.stunned = false;
    allyGrace = P.player.graceTime;
    spawnBuildFx(ally.x, ally.z);
    flashMsg('동료를 구출했다!', '#6ee07a');
  }
}

// ---- 동료 AI ----
//  기절 → 눕기 / 플레이어 기절 → 구조하러 이동 / 적 접근 → 도망 /
//  그 외 → 플레이어 따라다니기. 이동은 자기 반지름 기준 A* + 웨이포인트.
let allyGrace = 0;
function updateAlly(dt) {
  if (!ally.active) { allyVis.group.visible = false; return; }
  allyVis.group.visible = true;
  if (allyGrace > 0) allyGrace -= dt;

  if (ally.stunned) {
    // 기절 연출: 눕고 반투명 맥동
    allyVis.group.position.set(ally.x, 0.25, ally.z);
    allyVis.group.rotation.x = -Math.PI / 2;
    allyVis.setOpacity(0.5 + 0.2 * Math.sin(performance.now() * 0.005));
    return;
  }
  allyVis.group.rotation.x = 0;
  allyVis.setOpacity(1);

  // 목표 결정
  let gx = player.x, gz = player.z, urgent = false;
  let eBest0 = null, eD0 = Infinity;
  for (const e of enemies) {
    const dd = Math.hypot(e.x - ally.x, e.z - ally.z);
    if (dd < eD0) { eD0 = dd; eBest0 = e; }
  }
  if (playerStunned) {
    // 구조: 적이 붙어 있으면 카이팅으로 떼어내고, 틈이 나면 달려간다.
    // 동료가 적보다 약간 빨라서 시간이 지나면 반드시 틈이 생긴다.
    if (eBest0 && eD0 < P.ally.fleeDist * 0.9) {
      const ax = ally.x - eBest0.x, az = ally.z - eBest0.z;
      const l = Math.hypot(ax, az) || 1;
      // 도망가되 플레이어 쪽으로 살짝 휘게 (원을 그리며 접근)
      gx = clamp(ally.x + (ax / l) * 5 + (player.x - ally.x) * 0.25, -HALF + 1, HALF - 1);
      gz = clamp(ally.z + (az / l) * 5 + (player.z - ally.z) * 0.25, -HALF + 1, HALF - 1);
    }
    urgent = true;
  } else {
    // 도망: 가장 가까운 적이 너무 가까우면 반대쪽으로
    const eBest = eBest0, eD = eD0;
    if (eBest && eD < P.ally.fleeDist) {
      const ax = ally.x - eBest.x, az = ally.z - eBest.z;
      const l = Math.hypot(ax, az) || 1;
      gx = clamp(ally.x + (ax / l) * 6, -HALF + 1, HALF - 1);
      gz = clamp(ally.z + (az / l) * 6, -HALF + 1, HALF - 1);
      urgent = true;
    } else if (Math.hypot(player.x - ally.x, player.z - ally.z) < P.ally.followDist) {
      ally.path = [];
      allyVis.group.position.set(ally.x, 0, ally.z);
      allyVis.group.rotation.y = Math.atan2(ally.faceX, ally.faceZ) + Math.PI;
      return; // 충분히 가까움 — 대기
    }
  }
  ally.goalX = gx; ally.goalZ = gz;

  // 경로 (플레이어와 같은 몸집이라 1칸 틈도 지나다닌다)
  ally.repathT -= dt;
  if (ally.repathT <= 0 || !ally.path.length) {
    ally.repathT = urgent ? 0.25 : 0.5;
    const r = P.ally.radius;
    const pass = (i) => canPass(clearAll, i, r);
    const res = astar(nearestPassableNav(ally.x, ally.z, pass), worldToNav(gx, gz), pass, () => 0);
    ally.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
  }
  while (ally.path.length && Math.hypot(ally.x - ally.path[0].x, ally.z - ally.path[0].z) < navRes * 0.9)
    ally.path.shift();
  const tx = ally.path.length ? ally.path[0].x : gx;
  const tz = ally.path.length ? ally.path[0].z : gz;
  let dx = tx - ally.x, dz = tz - ally.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.05) {
    dx /= dl; dz /= dl;
    // 회피 조향: 가까운 적을 밀어내는 벡터를 섞는다.
    // 구조하러 갈 때도 정면 돌파 대신 스치듯 우회하는 움직임이 나온다.
    let rx = 0, rz = 0;
    for (const e of enemies) {
      const ex = ally.x - e.x, ez = ally.z - e.z;
      const ed = Math.hypot(ex, ez);
      const danger = enemyR(e) + 2.6;
      if (ed < danger && ed > 1e-3) {
        const wgt = (danger - ed) / danger;
        rx += (ex / ed) * wgt * 1.6;
        rz += (ez / ed) * wgt * 1.6;
      }
    }
    dx += rx; dz += rz;
    const l2 = Math.hypot(dx, dz) || 1;
    dx /= l2; dz /= l2;
    ally.x += dx * P.ally.speed * dt;
    ally.z += dz * P.ally.speed * dt;
    ally.faceX = dx; ally.faceZ = dz;
  }
  collideWithObstacles(ally, P.ally.radius);
  allyVis.group.position.set(ally.x, 0, ally.z);
  allyVis.group.rotation.y = Math.atan2(ally.faceX, ally.faceZ) + Math.PI;
}

const hotbarEl = document.getElementById('hotbar');
function updateHotbar() {
  hotbarEl.innerHTML = BUILD_SLOTS.map((sl, k) => {
    const cost = sl.cost();
    const afford = resources >= cost;
    const cls = (k === buildSlot ? 'slot sel' : 'slot') + (afford ? '' : ' dim');
    const costTxt = cost > 0 ? `${cost}치즈` : '무료';
    return `<div class="${cls}"><b>${k + 1}</b>${sl.label}<br>${costTxt}</div>`;
  }).join('');
}

function flashMsg(text, color = '#6ee07a') {
  flashEl.textContent = text;
  flashEl.style.color = color;
  flashEl.style.opacity = '1';
  flashT = 2.0;
}

// 무리 구성을 "순찰묘 3 · 날쌘묘 1" 식으로 요약
function enemyModeSummary() {
  const c = {};
  for (const e of enemies) c[e.type] = (c[e.type] || 0) + 1;
  const parts = Object.entries(c).map(([k, v]) => `${TYPE_INFO[k].label} ${v}`);
  const atk = enemies.filter((e) => e.isAttacking).length;
  const prowl = enemies.filter((e) => e.aiMode === '배회').length;
  return parts.join(' · ')
    + (prowl ? ` · 막힘 ${prowl}` : '')
    + (atk ? ` · ${atk}마리 벽 부수는 중!` : '');
}

function updateHUD() {
  const mode = CAM_MODES[camIndex];
  let wallCount = 0;
  for (const ob of obstacles.values()) if (!ob.bedrock && !ob.bldgRef) wallCount++;
  const lvl = threatLevel();
  const nextIn = P.threat.interval - ((survival - P.enemy.spawnDelay) % P.threat.interval);
  const waiting = !enemyActive();
  const attacking = enemies.filter((e) => e.isAttacking).length;
  hudEl.textContent =
    `카메라: ${mode.name}\n` +
    (waiting
      ? `적 ${enemies.length}마리 등장까지 ${(P.enemy.spawnDelay - survival).toFixed(1)}s — 지금 광맥을 확보하세요\n`
      : `적 ${enemies.length}마리: ${enemyModeSummary()}\n`) +
    `스테이지 ${stage}/${STAGES.length} — 수확 ${stageCollected.toFixed(0)}/${stageGoal()}` +
    (victory ? ' · 클리어!' : '') + '\n' +
    `치즈: ${resources.toFixed(1)} · 창고 ${depotCount()}개` +
    (storedTotal > 0.5 ? ` (저장 ${storedTotal.toFixed(0)}${collecting ? ' ⛏ 수확 중!' : ' — 가서 E)'}` : '') +
    (hasWorkshop() ? ' · 공방 ✓' : ' · 공방 없음(T)') + '\n' +
    (waiting ? '' : `위협 Lv.${lvl} (다음 강화 ${nextIn.toFixed(0)}s)\n`) +
    (ally.active ? `동료: ${ally.stunned ? '기절 — 구하러 가자!' : '동행 중'}${playerStunned ? ' · 나: 기절!' : ''}\n` : '') +
    `생존: ${survival.toFixed(1)}s · 벽 ${wallCount}개 · 잡힘 ${caughtCount}회` +
    (grace > 0 ? ` · 무적 ${grace.toFixed(1)}s` : '') +
    (paused ? '\n⏸ 일시정지 (P)' : '');
}

// ============================================================
// 초기화 & 루프
// ============================================================
for (const [i, j] of BEDROCK_LAYOUT) addObstacle(i, j, true);
refreshClearance();          // clearAll 먼저 — refreshReach가 이걸 읽는다
setEnemyCount(P.enemy.count);
restart();                   // 동료·스테이지·핫바까지 한 번에 초기 상태로
updateHotbar();

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  persp.aspect = viewAspect();
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
    updateAlly(dt);
    updateRescue();
    if (enemyActive()) {
      updateSpawns();   // 스테이지 외 추가 증원 (옵션)
      for (const e of enemies) {
        e.vis.setOpacity(1);
        updateEnemy(e, dt);
      }
      separateEnemies();
      for (const e of enemies) e.vis.group.position.set(e.x, 0, e.z);
      for (const e of enemies) {
        if (!alive) break;
        const er2 = enemyR(e);
        if (grace <= 0 && !playerStunned &&
            Math.hypot(player.x - e.x, player.z - e.z) < P.player.radius + er2 - 0.02) {
          caught(player);
        }
        if (alive && ally.active && !ally.stunned && allyGrace <= 0 &&
            Math.hypot(ally.x - e.x, ally.z - e.z) < P.ally.radius + er2 - 0.02) {
          caught(ally);
        }
      }
    } else {
      // 등장 대기: 스폰 지점에서 반투명하게 예고
      const t = survival / Math.max(P.enemy.spawnDelay, 0.001);
      for (const e of enemies) {
        e.vis.setOpacity(0.15 + 0.35 * t);
        e.vis.group.position.set(e.x, 0, e.z);
      }
    }
    updateBuildings(dt);
    updateNodes(dt);
    updateCheeseBits(dt);
    updateDecoys(dt);
    updateWallPops(dt);
  }
  updateFx(dt);
  updateCamera(dt);
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; updateHUD(); updateHotbar(); }
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
  P, player, enemies, obstacles, keys, tick, restart, setCamera, addObstacle,
  refreshClearance, planEnemyPath,
  get alive() { return alive; },
  get resources() { return resources; },
  get caughtCount() { return caughtCount; },
  get grace() { return grace; },
  ENEMY_SPAWN, PLAYER_SPAWN,
  snapshotSettings, applySettings, settingsAsSource,
  get DEFAULT_SETTINGS() { return DEFAULT_SETTINGS; },
  get enemyReach() { return enemyReach; },
  nodes, ghost, mouseNDC, CAM_MODES, enemies,
  setEnemyCount, spawnBuildFx, placeTrap, placeDecoy, traps, decoys,
  buildings, placeBuilding, destroyBuilding, STAGES,
  get stage() { return stage; },
  get stageCollected() { return stageCollected; },
  get victory() { return victory; },
  set stageCollected(v) { stageCollected = v; },
  advanceStage, stageGoal, hasWorkshop, depotCount,
  ally, updateAlly, caught, gameOver,
  get playerStunned() { return playerStunned; },
  set playerStunned(v) { playerStunned = v; },
  get buildSlot() { return buildSlot; },
  set buildSlot(v) { buildSlot = v; },
  get storedTotal() { return storedTotal; },
  get collecting() { return collecting; },
  enemyR, unlockedTypes,
  get fxCount() { return fx.length; },
  get cheeseBitCount() { return cheeseBits.length; },
  get harvestPulse() { return harvestPulse; },
  setMouse(x, y) { mouseNDC.set(x, y); mouseValid = true; },
  threatLevel, enemySpeedOf, enemyDpsOf,
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    renderer.render(scene, activeCam());
  },
};
