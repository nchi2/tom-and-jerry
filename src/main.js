import * as THREE from 'three';
import GUI from 'lil-gui';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  player: { speed: 6.0, radius: 0.35, graceTime: 1.5 },
  enemy: {
    count: 3,              // 시작 마릿수
    speed: 5.0, radius: 0.9, dps: 30, attackRange: 0.6, repath: 0.35,
    spawnDelay: 12,
    spread: 2.2,           // 스폰 지점 주변에 흩어지는 반경
  },
  wall: { hp: 100, cooldown: 0.15, height: 1.1, range: 3.0 },
  res: { startWalls: 10, mineRate: 1.2, wallCost: 5, nodeAmount: 40 },
  threat: { interval: 25, speedGain: 0.5, dpsGain: 8, everyLevels: 2 },
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
function makeHamster() {
  const fur = MAT(0xe8b45a);
  const cream = MAT(0xf7e3c0);
  const dark = MAT(0x2a2320, { roughness: 0.5 });
  const pink = MAT(0xe89aa8);
  return buildCreature([
    sphere(0.92, fur, 0, 0.82, 0.22, 1, 0.9, 1),        // 몸통 (뒤쪽으로 물림)
    sphere(0.66, cream, 0, 0.62, -0.16, 1, 0.86, 0.8),  // 배
    sphere(0.7, fur, 0, 1.24, -0.78),                   // 머리 (몸통 밖으로 빼냄)
    sphere(0.34, fur, -0.5, 1.1, -0.7, 1, 1, 0.9),      // 볼주머니 L
    sphere(0.34, fur, 0.5, 1.1, -0.7, 1, 1, 0.9),       // 볼주머니 R
    sphere(0.3, pink, -0.46, 1.82, -0.66, 1, 1, 0.45),  // 귀 L
    sphere(0.3, pink, 0.46, 1.82, -0.66, 1, 1, 0.45),   // 귀 R
    sphere(0.32, cream, 0, 1.08, -1.3, 1, 0.85, 1),     // 주둥이
    sphere(0.11, dark, 0, 1.14, -1.58),                 // 코
    sphere(0.14, dark, -0.3, 1.42, -1.28),              // 눈 L
    sphere(0.14, dark, 0.3, 1.42, -1.28),               // 눈 R
    sphere(0.19, cream, -0.46, 0.24, -0.62),            // 앞발 L
    sphere(0.19, cream, 0.46, 0.24, -0.62),             // 앞발 R
    sphere(0.15, pink, 0, 0.78, 1.16, 1, 1, 0.7),       // 꼬리
  ]);
}

// 적 — 같은 저폴리 문법인데 길고 낮고 넓다. 귀가 뾰족하고 눈이 발광.
// 햄스터와 나란히 놨을 때 "폭"이 먼저 읽히도록 몸통을 가로로 넓힘.
function makeCat() {
  const furA = MAT(0x8e4257);
  const furB = MAT(0xb0596d);
  const dark = MAT(0x241a1e, { roughness: 0.5 });
  const eye = MAT(0xffe14d, { emissive: new THREE.Color(0xffc400), emissiveIntensity: 0.9 });
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

function makeEnemy(n) {
  const p = enemySpawnPos(n);
  const vis = makeCat();
  vis.group.scale.setScalar(P.enemy.radius);
  vis.setOpacity(0.15);
  return {
    x: p.x, z: p.z,
    path: [],           // [{x, z, idx}]
    aiMode: '추격',      // 추격 / 파괴 / 배회
    repathT: Math.random() * P.enemy.repath, // 재계산 타이밍을 흩어 프레임 부하 분산
    attackTarget: null, // 공격 중인 벽
    stallT: 0,
    prevX: p.x, prevZ: p.z,
    dirX: 0, dirZ: 1,
    vis,
  };
}

function setEnemyCount(count) {
  while (enemies.length < count) enemies.push(makeEnemy(enemies.length));
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
let securedCount = 0;

// 적 도달 가능 영역 (내비 격자 flood fill, 적 반지름 기준)
//  → 노드가 이 영역 밖이면 "확보됨"
let enemyReach = null;
function refreshReach() {
  if (!clearAll) return;  // clearance 필드가 아직 없으면 건너뜀 (초기화 순서 보호)
  const er = P.enemy.radius;
  const pass = (i) => canPass(clearAll, i, er);
  const vis = new Uint8Array(NAV * NAV);
  const stack = [];
  // 모든 적에서 동시에 퍼뜨린다 (합집합).
  // → 광맥은 "어떤 적도 도달 못 할 때"만 확보로 친다.
  for (const e of enemies) {
    const start = nearestPassableNav(e.x, e.z, pass);
    if (pass(start) && !vis[start]) { vis[start] = 1; stack.push(start); }
  }
  while (stack.length) {
    const cur = stack.pop();
    const cx = cur % NAV, cz = (cur / NAV) | 0;
    if (cx > 0 && !vis[cur - 1] && pass(cur - 1)) { vis[cur - 1] = 1; stack.push(cur - 1); }
    if (cx < NAV - 1 && !vis[cur + 1] && pass(cur + 1)) { vis[cur + 1] = 1; stack.push(cur + 1); }
    if (cz > 0 && !vis[cur - NAV] && pass(cur - NAV)) { vis[cur - NAV] = 1; stack.push(cur - NAV); }
    if (cz < NAV - 1 && !vis[cur + NAV] && pass(cur + NAV)) { vis[cur + NAV] = 1; stack.push(cur + NAV); }
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
function planEnemyPath(enemy) {
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

// 시간이 지나면 마릿수도 는다 (everyLevels = 0 이면 안 늘어남)
function targetEnemyCount() {
  const per = P.threat.everyLevels;
  return P.enemy.count + (per > 0 ? Math.floor(threatLevel() / per) : 0);
}

// 적끼리 겹치지 않게 서로 밀어냄 — 한 덩어리로 뭉쳐 다니는 걸 막는다
function separateEnemies() {
  const r = P.enemy.radius;
  for (let a = 0; a < enemies.length; a++)
    for (let b = a + 1; b < enemies.length; b++) {
      const e1 = enemies[a], e2 = enemies[b];
      let dx = e2.x - e1.x, dz = e2.z - e1.z;
      let d = Math.hypot(dx, dz);
      const min = r * 1.75;
      if (d >= min) continue;
      if (d < 1e-4) { dx = 0.01; dz = 0; d = 0.01; }
      const push = ((min - d) / d) * 0.5;
      e1.x -= dx * push; e1.z -= dz * push;
      e2.x += dx * push; e2.z += dz * push;
    }
  for (const e of enemies) collideWithObstacles(e, r);
}

function updateEnemy(enemy, dt) {
  const er = P.enemy.radius;
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
      repathAll();          // 길이 뚫렸으니 무리 전체가 다시 판단
      enemy.attackTarget = null;
    }
  }

  // 공격 중 표시 (몸 색 펄스)
  if (enemy.attackTarget) {
    enemy.vis.setEmissive(0xff2222, 0.35 + 0.25 * Math.sin(performance.now() * 0.02));
  } else {
    enemy.vis.setEmissive(0x000000, 0);
  }

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
  const wantBuild = keys.has('Space') || mouseDown;

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
  let hitsEnemy = false;
  for (const e of enemies)
    if (distCellToPoint(gi, gj, e.x, e.z) < P.enemy.radius + 0.02) { hitsEnemy = true; break; }
  const affordable = resources >= P.res.wallCost;
  ghostCell = {
    i: gi, j: gj,
    valid: hasTile && inRange && !occupied && !onNode && !hitsPlayer && !hitsEnemy && affordable,
  };
  ghost.visible = alive && hasTile;
  ghost.scale.set(CS * 0.98, P.wall.height, CS * 0.98);
  ghost.position.set(w.x, P.wall.height / 2, w.z);
  ghost.material.color.setHex(ghostCell.valid ? 0x6ee07a : 0xe05050);

  // ---- 즉시 건설 ----
  // 클릭한 프레임에 벽이 완성되고 충돌/길찾기에 바로 반영된다.
  // 이펙트(펑)는 그 뒤에 얹히는 연출일 뿐 게임 상태를 지연시키지 않는다.
  buildCooldown -= dt;
  if (wantBuild && buildCooldown <= 0 && ghostCell.valid) {
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
  const f = gui.addFolder('적');
  f.add(P.enemy, 'count', 1, 12, 1).name('시작 마릿수')
    .onChange((v) => setEnemyCount(Math.max(v, targetEnemyCount())));
  f.add(P.enemy, 'speed', 2, 14, 0.1).name('이동 속도');
  f.add(P.enemy, 'radius', 0.4, 2.2, 0.05).name('반지름 (덩치)')
    .onChange((v) => {
      for (const e of enemies) e.vis.group.scale.setScalar(v);
      refreshReach();
      repathAll();
    });
  f.add(P.enemy, 'dps', 5, 150, 1).name('벽 공격력(초당)');
  f.add(P.enemy, 'attackRange', 0.2, 2, 0.05).name('공격 사거리');
  f.add(P.enemy, 'repath', 0.1, 1.5, 0.05).name('경로 재계산 주기');
  f.add(P.enemy, 'spawnDelay', 0, 60, 1).name('등장 딜레이(초)');
  f.add(P.enemy, 'spread', 0, 8, 0.2).name('스폰 흩어짐 (재시작부터)');
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
  for (const e of enemies) e.vis.group.scale.setScalar(P.enemy.radius);
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
const overlayEl = document.getElementById('overlay');
const flashEl = document.getElementById('flash');
helpEl.textContent =
  'WASD 이동 · 마우스로 타일 선택 → 클릭/Space: 벽 즉시 건설 · X 벽 제거\n' +
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
  for (const f of [...fx]) { scene.remove(f.mesh); f.mesh.material.dispose(); }
  fx.length = 0;
  popping.length = 0;
  resources = startResources();
  for (const n of nodes) {
    n.amount = P.res.nodeAmount;
    n.mesh.material.color.setHex(0xf0b429);
  }
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
function caught() {
  caughtCount++;
  player.x = ENEMY_SPAWN.x; // 적 시작 지점으로 강제 이동
  player.z = ENEMY_SPAWN.z;
  player.faceX = 0; player.faceZ = 1;
  collideWithObstacles(player, P.player.radius);
  camTarget.set(player.x, 0, player.z); // 카메라 순간이동 (끌려간 게 보이게)
  grace = P.player.graceTime;           // 짧은 무적 — 즉시 재포획 방지
  // 무리 전체가 잠깐 멈칫하고 다시 판단
  for (const e of enemies) {
    e.path = []; e.repathT = 0; e.stallT = 0; e.attackTarget = null;
  }
  flashEl.textContent = `잡혔다! 적 본진으로 끌려감 (${caughtCount}회)`;
  flashEl.style.color = '#ff6b6b';
  flashEl.style.opacity = '1';
  flashT = 1.6;
}

// 무리의 AI 상태를 "추격 2 · 파괴 1" 식으로 요약
function enemyModeSummary() {
  const c = {};
  for (const e of enemies) c[e.aiMode] = (c[e.aiMode] || 0) + 1;
  const parts = Object.entries(c).map(([k, v]) => `${k} ${v}`);
  const atk = enemies.filter((e) => e.attackTarget).length;
  return parts.join(' · ') + (atk ? ` (${atk}마리 벽 부수는 중!)` : '');
}

function updateHUD() {
  const mode = CAM_MODES[camIndex];
  let wallCount = 0;
  for (const ob of obstacles.values()) if (!ob.bedrock) wallCount++;
  const lvl = threatLevel();
  const nextIn = P.threat.interval - ((survival - P.enemy.spawnDelay) % P.threat.interval);
  const waiting = !enemyActive();
  const attacking = enemies.filter((e) => e.attackTarget).length;
  hudEl.textContent =
    `카메라: ${mode.name}\n` +
    (waiting
      ? `적 ${enemies.length}마리 등장까지 ${(P.enemy.spawnDelay - survival).toFixed(1)}s — 지금 광맥을 확보하세요\n`
      : `적 ${enemies.length}마리: ${enemyModeSummary()}\n`) +
    `치즈: ${resources.toFixed(1)} · 확보한 광맥 ${securedCount}/${nodes.length}\n` +
    (waiting ? '' : `위협 Lv.${lvl} (다음 강화 ${nextIn.toFixed(0)}s) · 적 속도 ${enemySpeed().toFixed(1)}\n`) +
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
    if (enemyActive()) {
      // 위협 레벨에 따라 마릿수가 늘면 스폰 지점에서 추가 투입
      const want = targetEnemyCount();
      if (enemies.length < want) {
        while (enemies.length < want) enemies.push(makeEnemy(enemies.length));
        refreshReach();
        flashEl.textContent = `적이 늘었다! (${enemies.length}마리)`;
        flashEl.style.color = '#ffb347';
        flashEl.style.opacity = '1';
        flashT = 1.6;
      }
      for (const e of enemies) {
        e.vis.setOpacity(1);
        updateEnemy(e, dt);
      }
      separateEnemies();
      for (const e of enemies) e.vis.group.position.set(e.x, 0, e.z);
      if (grace <= 0) {
        for (const e of enemies) {
          const d = Math.hypot(player.x - e.x, player.z - e.z);
          if (d < P.player.radius + P.enemy.radius - 0.02) { caught(); break; }
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
    updateNodes(dt);
    updateWallPops(dt);
  }
  updateFx(dt);
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
  P, player, enemies, obstacles, keys, tick, restart, setCamera, addObstacle,
  refreshClearance, planEnemyPath,
  get alive() { return alive; },
  get resources() { return resources; },
  get caughtCount() { return caughtCount; },
  get grace() { return grace; },
  ENEMY_SPAWN, PLAYER_SPAWN,
  snapshotSettings, applySettings, settingsAsSource,
  get DEFAULT_SETTINGS() { return DEFAULT_SETTINGS; },
  get securedCount() { return securedCount; },
  get enemyReach() { return enemyReach; },
  nodes, ghost, mouseNDC, CAM_MODES, enemies,
  setEnemyCount, targetEnemyCount, spawnBuildFx,
  get fxCount() { return fx.length; },
  setMouse(x, y) { mouseNDC.set(x, y); mouseValid = true; },
  threatLevel, enemySpeed, enemyDps,
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    renderer.render(scene, activeCam());
  },
};
