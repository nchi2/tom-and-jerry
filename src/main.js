import * as THREE from 'three';
import GUI from 'lil-gui';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  // 한 방에 죽지 않는다 — 공격을 맞아 체력이 다 깎여야 잡힌다 (원작 프로브가
  // 울트라 두 방을 버티던 것). 죽음이 "한순간의 실수"가 아니라 "누적된 실수"가 된다.
  player: { speed: 6.0, radius: 0.35, graceTime: 1.5, hp: 100, regen: 5, regenDelay: 4, wipeOnCatch: 1 },
  enemy: {
    count: 3,              // 시작 마릿수 (전부 순찰묘)
    attackRange: 0.6, repath: 0.35,
    spawnDelay: 12,
    spread: 5.0,           // 스폰 지점 주변에 흩어지는 반경
    aggroRange: 7.0,       // 추격 중 이 거리 안의 건물에 한눈팔 수 있음
    aggroChance: 0.35,     // 경로 재계산 때 한눈팔 확률
    aggroTime: 4.0,        // 한 번 끌리면 이 시간 동안 유지
    flankRadius: 5.5,      // 목표 둘레 이 반경의 지점을 노리고 접근한다
    probeTurn: 1.1,        // 막혔을 때 접근각을 돌리는 크기(라디안)
    probeHold: 2.5,        // 새 접근각을 유지하는 시간(초)
    drift: 0.35,           // 평상시 접근각이 흐르는 속도(라디안/초)
    giveUpProbes: 3,       // 이만큼 시도해도 막히면 포기하고 서성인다
    prowlTime: 4.0,        // 서성이는 시간 — 플레이어가 확장을 시도할 틈
    attackWindup: 0.45,    // 공격 예비동작 (피할 수 있는 시간)
    attackCooldown: 1.3,   // 공격 간격
  },
  ally: {
    enabled: 1,            // 1=AI 동료 햄스터 (재시작부터). 0=솔로: 잡히면 즉시 전멸
    speed: 6.0, radius: 0.35,
    fleeDist: 4.5,         // 이 거리 안에 적이 오면 도망이 우선
  },
  // ---- 적 3종 ----
  // 통행권(=반지름)과 벽 공격 가능 여부가 종류를 가른다.
  //  순찰묘: 크고 벽 못 부숨 → 벽이 완전한 안전을 줌. 처음부터 등장
  //  날쌘묘: 작고 빠름, 벽 못 부숨 → 2칸 틈을 통과! 넓은 틈의 안전이 깨짐
  //  파괴묘: 제일 크고 느림, 유일하게 벽을 부숨 → 밀폐도 시한부가 됨
  // bldgDps: 건물(창고/공방) 공격력 — 모든 종류가 건물은 부술 수 있다 (원작:
  //          무적 파일런은 못 부숴도 넥서스/생산 건물은 부서짐)
  // hp가 높다 — 처치하려면 탑/방어병에 실제로 투자해야 한다.
  // reward = 처치 시 주는 치즈.
  // dmg = 플레이어/동료에게 한 방에 주는 피해
  chaser: { radius: 1.35, speed: 5.0, bldgDps: 24, hp: 260, reward: 18, dmg: 34 },
  runner: { radius: 0.85, speed: 6.8, bldgDps: 16, hp: 150, reward: 12, dmg: 20 },
  // 자폭고양이 — 벽을 부술 수 있는 유일한 존재. 벽에 붙으면 터지고 자기도 죽는다.
  bomber: { radius: 1.5, speed: 4.6, bldgDps: 40, hp: 200, reward: 30, dmg: 45,
            blastRadius: 1.7, fuse: 0.9 },
  // 벽은 무적이다 (원작 파일런). 부수는 건 자폭고양이의 폭발뿐.
  // 대신 비싸다 — 비용이 곧 "얼마나 넓게 두를 것인가"의 제약.
  wall: { cost: 12, removeCost: 4, cooldown: 0.15, height: 1.1, range: 3.0 },
  // 건물 — 원작의 "넥서스 지을 공간이 필요하다"의 이식.
  // 2x2 발자국이라 광맥을 벽 4개로 두르는 최소 확보가 불가능해지고,
  // 채굴하려면 광맥 곁에 건물이 들어갈 공터까지 함께 감싸야 한다.
  // 건물은 약하다 — 적이 오래 붙들려 있지 않고 금방 정리하고 플레이어에게 온다
  // 치즈 창고 — 치즈를 부리는 곳. 더미에서 일정 거리 떨어뜨려야 지어진다
  // (붙여 지으면 채굴 사거리와 하역 사거리가 겹쳐 '나르는 행위'가 사라진다)
  depot: { cost: 0, hp: 130, dropRange: 2.8, minPileDist: 5.5 },
  // 볼주머니 채굴 (원작 프로브) — 치즈더미에서 캐서 창고까지 날라야 잔고가 된다
  // 스타크래프트 프로브와 같은 리듬: 더미에 붙어 한 짐을 캐고(시간 소요),
  // 창고까지 걸어가서 한 번에 부린다. 왕복 자체가 게임의 박자다.
  carry: {
    playerLoad: 14, workerLoad: 10,
    mineTime: 1.6,      // 한 짐을 캐는 데 걸리는 시간(초)
    range: 2.2,         // 치즈더미에 붙어야 하는 거리
  },
  worker: {
    cost: 30, speed: 4.6, radius: 0.3,
    perPile: 3,         // 치즈더미 하나에 붙을 수 있는 일꾼 수
    max: 12,
  },
  workshop: { cost: 15, hp: 100 },                               // 공방 — 업그레이드는 이 옆에서
  tower: { cost: 35, hp: 110, range: 7.0, dmg: 30, reload: 1.0 }, // 경비탑 — 원작 포토캐논. 던진다
  // 방어병 — 타일에 배치하고 우클릭으로 재배치 명령. 벽 너머로 던진다.
  // 적과 닿으면 즉시 쓰러진다(햄스터니까) → 벽 뒤에 세우는 게 정석
  guard: { cost: 25, range: 7.0, dmg: 26, reload: 1.1, speed: 5.2, radius: 0.35 },
  res: {
    startWalls: 10, wallCost: 5,
    // 치즈더미는 유한하고 다시 차지 않는다. 바닥나면 새 더미를 확보하러 나가야 한다
    // = 영역 확장 압박 (01 문서의 "공간 욕심 vs 벽 길이")
    nodeAmount: 520,
  },
  // 부품 — 밖에 흩어진 픽업으로만 얻는다. 업그레이드 전용 화폐.
  pickup: {
    interval: 14,        // 새 픽업이 생기는 주기(초)
    maxOnMap: 5,         // 동시에 존재할 수 있는 최대 개수
    minPlayerDist: 14,   // 플레이어에게서 이만큼 떨어진 곳에만 생성 (= 위험을 감수해야 함)
    partsEach: 1,        // 부품 상자 하나당 부품
    cheeseEach: 35,      // 치즈 더미 하나당 치즈
    partsRatio: 0.6,     // 부품 상자가 나올 확률
  },
  // 업그레이드 (부품으로 구매, 공방 필요) — 레벨당 증가폭
  upgrade: {
    maxLevel: 5,
    baseCost: 1, costStep: 1,   // n레벨 비용 = baseCost + costStep * n
    mineStep: 0.5,              // 채굴 속도
    speedStep: 0.6,             // 햄스터 이동 속도
    radiusStep: 0.2,            // 채굴 시간 단축(초)
    wallhpStep: 45,             // 새 벽 내구도
    towerStep: 9,               // 경비탑 화력
  },
  threat: {
    interval: 30, speedGain: 0.15, dpsGain: 6, everyLevels: 0, hpGain: 25,
    // 속도는 상한을 둔다 — 적이 플레이어보다 빨라지면 술래잡기가 아니게 된다
    speedCap: 7.2,
    // 원작의 탐욕 페널티: 일정 수를 잡으면 그때 우루루 쏟아진다
    killsPerSurge: 6, surgeSize: 3,
  },
};

// ---- 10 스테이지 (시간 기반) ----
// 각 스테이지는 정해진 시간 동안 지속된다. 시간이 다 되면 다음 스테이지로 넘어가며
// 표대로 적이 증원되고 광맥이 리필된다. 치즈 잔고는 진행과 무관하다 —
// 돈을 모으는 속도가 아니라 "버티는 시간"이 진행이다.
const STAGES = [
  { time: 45, add: {} },                          // 1 — 시작 무리는 enemy.count(순찰묘)
  { time: 50, add: { chaser: 1 } },               // 2
  { time: 55, add: { runner: 1 } },               // 3 — 날쌘묘 첫 등장
  { time: 55, add: { chaser: 1, runner: 1 } },    // 4
  { time: 60, add: { bomber: 1 } },               // 5 — 자폭묘 첫 등장
  { time: 60, add: { chaser: 1, runner: 1 } },    // 6
  { time: 65, add: { bomber: 1 } },               // 7
  { time: 65, add: { runner: 2 } },               // 8
  { time: 70, add: { bomber: 1, runner: 1 } },    // 9
  { time: 75, add: { bomber: 1, chaser: 1 } },    // 10
];

// ---- 건설 핫바 ----
// 숫자키 1~9로 선택하고 클릭/Space로 짓는다 (6~9는 예약 슬롯)
const BUILD_SLOTS = [
  { key: 'wall', label: '벽', size: 1, cost: () => P.wall.cost },
  { key: 'depot', label: '치즈 창고', size: 2, cost: () => P.depot.cost },
  { key: 'workshop', label: '공방', size: 2, cost: () => P.workshop.cost },
  { key: 'tower', label: '경비탑', size: 2, cost: () => P.tower.cost },
  { key: 'worker', label: '일꾼 고용', size: 1, cost: () => P.worker.cost },
  { key: 'guard', label: '방어병', size: 1, cost: () => P.guard.cost },
  { key: 'remove', label: '철거', size: 1, cost: () => P.wall.removeCost },
];
let buildSlot = 0;
let prevWantBuild = false;

// ---- 업그레이드 ----
// 부품(밖에서 주운 것)으로만 산다. P는 그대로 두고 유효값 계산에서 더한다
// (튜닝 슬라이더와 업그레이드가 서로 덮어쓰지 않게).
const UPGRADES = [
  { key: 'mine', label: '채굴 효율', unit: () => `+${P.upgrade.mineStep}/s` },
  { key: 'speed', label: '이동 속도', unit: () => `+${P.upgrade.speedStep}` },
  { key: 'radius', label: '채굴 속도', unit: () => `-${P.upgrade.radiusStep}s` },
  { key: 'wallhp', label: '벽 내구도', unit: () => `+${P.upgrade.wallhpStep}` },
  { key: 'tower', label: '경비탑 화력', unit: () => `+${P.upgrade.towerStep}/s` },
];
const upg = { mine: 0, speed: 0, radius: 0, wallhp: 0, tower: 0 };
let parts = 0;

const upgCost = (lv) => P.upgrade.baseCost + P.upgrade.costStep * lv;
const effMineRate = () => P.res.mineRate + upg.mine * P.upgrade.mineStep;
const effPlayerSpeed = () => P.player.speed + upg.speed * P.upgrade.speedStep;
// 업그레이드는 채굴 '시간'을 줄인다 (레벨당 radiusStep초)
const effMineTime = () => Math.max(P.carry.mineTime - upg.radius * P.upgrade.radiusStep, 0.25);
const effWallHp = () => P.wall.hp + upg.wallhp * P.upgrade.wallhpStep;
const effTowerDmg = () => P.tower.dmg + upg.tower * P.upgrade.towerStep;

// 적 종류 메타 (숫자가 아니라서 P 밖에 둠 — 세팅 스냅샷에 안 섞이게)
const TYPE_INFO = {
  chaser: { label: '순찰묘', canBreak: false },
  runner: { label: '날쌘묘', canBreak: false },
  bomber: { label: '자폭묘', canBreak: true },   // 폭발로만 벽을 부순다
};
// 시작 자원은 "벽 N개분"으로 정의 — 벽 비용을 바꿔도 시작 여유가 유지됨
const startResources = () => P.res.startWalls * P.wall.cost;

// ============================================================
// 격자 / 좌표계
//  - 벽 격자: CELLS x CELLS, 한 칸 CS(1.0m)
//  - 내비 격자: 벽 격자의 2배 해상도 (navRes = 0.5m)
// ============================================================
// 맵마다 크기가 다르므로 가변. 모든 헬퍼가 호출 시점에 읽는다.
let CELLS = 56;
const CS = 1.0;
let HALF = (CELLS * CS) / 2;
const navRes = CS / 2;
let NAV = CELLS * 2;

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

// 바닥/그리드/외곽 림 — 맵을 바꿀 때마다 다시 만든다
const groundGroup = new THREE.Group();
scene.add(groundGroup);

function buildGround(floorColor, gridColor) {
  while (groundGroup.children.length) {
    const c = groundGroup.children.pop();
    groundGroup.remove(c);
    c.geometry?.dispose?.();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
  }
  const fl = new THREE.Mesh(
    new THREE.PlaneGeometry(CELLS * CS, CELLS * CS),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 1 })
  );
  fl.rotation.x = -Math.PI / 2;
  fl.receiveShadow = true;
  groundGroup.add(fl);
  const gh = new THREE.GridHelper(CELLS * CS, CELLS, gridColor, gridColor);
  gh.material.opacity = 0.5;
  gh.material.transparent = true;
  gh.position.y = 0.01;
  groundGroup.add(gh);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0x454c5e, roughness: 1 });
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), rimMat);
    m.position.set(x, 0.4, z);
    m.castShadow = m.receiveShadow = true;
    groundGroup.add(m);
  };
  mk(CELLS * CS + 1, 0.5, 0, -HALF - 0.25);
  mk(CELLS * CS + 1, 0.5, 0, HALF + 0.25);
  mk(0.5, CELLS * CS + 1, -HALF - 0.25, 0);
  mk(0.5, CELLS * CS + 1, HALF + 0.25, 0);

  // 그림자 카메라도 맵 크기에 맞춤
  sun.shadow.camera.left = -HALF - 2;
  sun.shadow.camera.right = HALF + 2;
  sun.shadow.camera.top = HALF + 2;
  sun.shadow.camera.bottom = -HALF - 2;
  sun.shadow.camera.updateProjectionMatrix();
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
    hp: Infinity, maxHp: Infinity,   // 벽은 무적 (자폭묘 폭발로만 사라진다)
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
// 맵 3종 — 파괴 불가 지형 + 광맥 배치
//  공통 설계 규칙 (D9, 전 맵 적용):
//   1. 요새 금지 — 지형이 어떤 영역도 감싸지 않는다 (공짜 요새 없음)
//   2. 뭉치기 금지 — 2x2 이상 덩어리 없음, 기둥은 전부 1칸
//   3. 미로 금지 — 모든 벽은 양 끝이 열린 독립 직선. 항상 돌아갈 수 있다
//  광맥은 외벽에서 5칸 이상, 지형에서 3칸 이상 이격 (싸게 감싸는 자리 없음)
//
//  통과 폭은 적 반지름에서 나온다 (r=1.35 → 1·2칸 막힘, 3칸 통과 /
//  날쌘묘 r=0.85 → 2칸 통과 / 파괴묘 r=1.6 → 4칸부터).
//  맵마다 틈 폭 구성이 달라서 "어느 종류가 어디로 들어오는가"가 달라진다.
// ============================================================
function layoutTools() {
  const cells = [];
  const put = (i, j) => {
    if (i >= 0 && j >= 0 && i < CELLS && j < CELLS) cells.push([i, j]);
  };
  const hLine = (i0, i1, j, gaps = []) => {
    for (let i = i0; i <= i1; i++) if (!gaps.includes(i)) put(i, j);
  };
  const vLine = (i, j0, j1, gaps = []) => {
    for (let j = j0; j <= j1; j++) if (!gaps.includes(j)) put(i, j);
  };
  const diag = (i0, j0, len, di, dj, gaps = []) => {
    for (let k = 0; k < len; k++) if (!gaps.includes(k)) put(i0 + k * di, j0 + k * dj);
  };
  return { cells, put, hLine, vLine, diag };
}

const MAPS = [
  {
    name: '허허벌판',
    size: 56,
    floor: 0x2b3040, gridColor: 0x4a5268,
    desc: '원작 기본형. 지형이 거의 없어 벽을 전부 직접 쌓아야 한다',
    playerSpawn: [28, 28], enemySpawn: [28, 4],
    // 성긴 교보재 두 벽 + 낱개 기둥. 나머지는 완전 개활지.
    build(t) {
      // 나란한 두 벽: 왼쪽 1칸 틈(플레이어만) / 오른쪽 3칸 틈(순찰묘도 통과)
      t.vLine(18, 14, 26, [20]);
      t.vLine(38, 14, 26, [19, 20, 21]);
      // 아래쪽 가로 벽 — 2칸 틈 (날쌘묘만 통과)
      t.hLine(16, 32, 38, [24, 25]);
      // 흩어진 낱개 기둥
      for (const [i, j] of [[10, 10], [46, 10], [10, 46], [46, 46],
                            [28, 28], [30, 8], [8, 30], [48, 30], [30, 48]])
        t.put(i, j);
    },
    nodes: [[11, 19], [26, 10], [45, 19], [26, 31], [44, 35],
            [12, 33], [38, 45], [15, 45]],
  },
  {
    name: '협곡',
    size: 56,
    floor: 0x322b2b, gridColor: 0x5c4a44,
    desc: '남북으로 뻗은 능선들. 틈 폭이 1·2·3·4칸으로 달라 어느 종류가 뚫는지가 갈린다',
    playerSpawn: [28, 44], enemySpawn: [28, 5],
    build(t) {
      // 평행 능선 5줄 — 간격 8칸이라 미로가 아니라 회랑으로 읽힌다.
      // 위아래 끝(j<12, j>43)은 열려 있어 언제나 우회 가능.
      t.vLine(10, 12, 43, [27]);              // 1칸 틈 — 플레이어 전용
      t.vLine(19, 12, 43, [26, 27]);          // 2칸 — 날쌘묘까지
      t.vLine(28, 12, 43, [26, 27, 28]);      // 3칸 — 순찰묘까지
      t.vLine(37, 12, 43, [25, 26, 27, 28]);  // 4칸 — 전부 통과
      t.vLine(46, 12, 43, [27]);              // 1칸
      // 회랑을 가로지르는 짧은 턱 (완전 개활 회랑이 되지 않게, 전부 짧고 끝이 열림)
      t.hLine(12, 17, 18);
      t.hLine(30, 35, 36);
      t.hLine(39, 44, 20);
      t.hLine(21, 26, 40);
    },
    nodes: [[14, 24], [23, 33], [32, 21], [41, 33],
            [14, 38], [32, 44], [50, 24], [50, 40]],
  },
  {
    name: '폐허',
    size: 56,
    floor: 0x2a3230, gridColor: 0x46605a,
    desc: '무너진 담장 조각과 기둥이 흩어진 곳. 엄폐가 많아 시야 싸움이 된다',
    playerSpawn: [28, 30], enemySpawn: [6, 6],
    build(t) {
      // 짧게 끊긴 담장 조각들 (전부 3~6칸, 서로 떨어져 있음)
      t.hLine(8, 13, 14);   t.vLine(16, 9, 13);
      t.hLine(22, 27, 10);  t.vLine(31, 12, 17);
      t.hLine(38, 44, 15);  t.vLine(47, 18, 23);
      t.hLine(9, 14, 26);   t.vLine(20, 27, 32);
      t.hLine(26, 31, 36);  t.vLine(36, 30, 35);
      t.hLine(41, 46, 33);  t.vLine(12, 38, 43);
      t.hLine(19, 24, 46);  t.vLine(29, 41, 46);
      t.hLine(36, 41, 44);
      // 무너진 대각 조각 (중간에 틈)
      t.diag(42, 38, 7, 1, 1, [3]);
      t.diag(6, 20, 6, 1, -1, [2]);
      // 낱개 기둥
      for (const [i, j] of [[24, 20], [34, 24], [17, 35], [44, 27],
                            [8, 32], [50, 44], [24, 52], [46, 8]])
        t.put(i, j);
    },
    nodes: [[13, 20], [27, 16], [42, 21], [24, 27],
            [46, 50], [16, 30], [33, 44], [50, 34]],
  },
];
let mapIndex = 0;

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
  bomber: { a: 0x3d2a33, b: 0x7a3320, eye: 0xff7a45, glow: 0xff4400 }, // 흑적색·주황 눈
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

// 나르는 햄스터 비주얼 (동료·일꾼 공용). GLB가 로드되면 교체된다.
function makeCarrierVis(color) {
  const v = makeHamster(color);
  scene.add(v.group);
  applyModel(v, 'worker', color, 0.5);
  return v;
}

// ============================================================
// 외부 모델 (Kenney "Cube Pets", CC0) — public/models/*.glb
//  절차적 모델을 그대로 두고, 로드가 끝나면 메시만 갈아끼운다.
//  실패하면 절차적 모델로 계속 굴러간다 (게임이 에셋에 의존하지 않게).
//  규약은 그대로: 모델을 "발밑 반지름 1"로 정규화하고 정면을 -Z로 맞춘다.
// ============================================================
const MODEL_URL = {
  hamster: 'models/animal-bunny.glb',
  worker: 'models/animal-beaver.glb',
  chaser: 'models/animal-cat.glb',
  runner: 'models/animal-fox.glb',
  bomber: 'models/animal-tiger.glb',
};
const modelCache = {};

function normalizeModel(root) {
  // 크기·중심 정규화: 발밑 반지름 1, 바닥 y=0
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const footprint = Math.max(size.x, size.z) / 2 || 1;
  const g = new THREE.Group();
  root.position.set(-center.x, -box.min.y, -center.z);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const inner = new THREE.Group();
  inner.add(root);
  inner.scale.setScalar(1 / footprint);
  // Kenney 모델은 +Z를 보고 있다 — 우리 규약(-Z)에 맞춰 뒤집는다
  inner.rotation.y = Math.PI;
  g.add(inner);
  return g;
}

function applyModel(vis, key, tint, tintAmt) {
  const url = MODEL_URL[key];
  if (!url) return;
  if (modelCache[key]) { swapVis(vis, modelCache[key], tint, tintAmt); return; }
  new GLTFLoader().load(
    import.meta.env.BASE_URL + url,
    (gltf) => {
      modelCache[key] = normalizeModel(gltf.scene);
      swapVis(vis, modelCache[key], tint, tintAmt);
    },
    undefined,
    () => {}   // 실패하면 절차적 모델 유지
  );
}

// 절차적 파츠를 감추고 모델 클론을 끼운다. vis의 API(setOpacity/setEmissive)는 유지.
function swapVis(vis, template, tint, tintAmt = 0.22) {
  if (vis.modelled) return;
  vis.modelled = true;
  for (const c of [...vis.group.children]) c.visible = false;
  const clone = template.clone(true);
  const mats = [];
  clone.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (tint) o.material.color.lerp(new THREE.Color(tint), tintAmt); // 텍스처를 살리고 종류 구분만
    o.castShadow = true;
    mats.push(o.material);
  });
  vis.group.add(clone);
  vis.mats = mats;
  vis.setOpacity = (o) => { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } };
  vis.setEmissive = (hex, i) => { for (const m of mats) { m.emissive.setHex(hex); m.emissiveIntensity = i; } };
  if (typeof measureTop === 'function') measureTop(vis);
}

const playerVis = makeHamster();
playerVis.group.scale.setScalar(P.player.radius);
applyModel(playerVis, 'hamster', 0xf0c070);
let playerBar = null, playerWorkBar = null, allyBar = null, allyWorkBar = null;

// AI 동료 햄스터 (회색). 잡히면 적 본진에서 기절 — 가서 터치하면 구출.
// 원작 "동료가 와야 부활"(D7)의 솔로용 대역이다.
const allyVis = makeHamster(0xb8b8c4);
allyVis.group.scale.setScalar(P.ally.radius);
applyModel(allyVis, 'hamster', 0x6f86d6, 0.62);
const ally = {
  active: false,
  x: 0, z: 0, faceX: 0, faceZ: -1,
  stunned: false,
  path: [], repathT: 0,
  goalX: 0, goalZ: 0,
  carry: 0, mode: '대기',
};

let PLAYER_SPAWN = cellToWorld(28, 28);
let ENEMY_SPAWN = cellToWorld(28, 4);

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
const enemySpeedOf = (e) =>
  Math.min(typeP(e).speed + threatLevel() * P.threat.speedGain, P.threat.speedCap);
const enemyDpsOf = (e) => (typeP(e).dps || 0) + threatLevel() * P.threat.dpsGain;
const canBreakWalls = (e) => TYPE_INFO[e.type].canBreak;
const typeMaxHp = (type) => P[type].hp + threatLevel() * P.threat.hpGain;
const enemyMaxHp = (e) => typeMaxHp(e.type);

function makeEnemy(type, n) {
  const p = enemySpawnPos(n);
  const vis = makeCat(type);
  applyModel(vis, type, CAT_PALETTES[type] ? CAT_PALETTES[type].a : null);
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
    hp: typeMaxHp(type),
    approachA: n * 2.399963,  // 접근 각도 — 막히면 돌려서 다른 방향으로 시도
    probeT: 0,                // 현재 접근각을 유지할 남은 시간
    probes: 0, prowlT: 0, prowlX: 0, prowlZ: 0, preferAlly: false,
    atkT: 0, windup: 0, lungeT: 0, fuseT: 0,
    hitFlash: 0,
    vis, bar: makeBar(0xe0483c, 1.3),
  };
}

function setEnemyCount(count) {
  while (enemies.length < count) enemies.push(makeEnemy('chaser', enemies.length));
  while (enemies.length > count) {
    const e = enemies.pop();
    scene.remove(e.vis.group);
    disposeBar(e.bar);
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
// 치즈 더미 — 쐐기 조각 여러 개가 쌓인 덩어리. 잔량에 따라 조각이 사라진다.
function makeCheesePile() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf0b429, roughness: 0.45,
    emissive: new THREE.Color(0xf0b429), emissiveIntensity: 0,
  });
  const wedge = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 10, 1, false, 0, Math.PI * 0.62);
  const spots = [
    [0, 0.17, 0, 0, 1.0], [-0.34, 0.16, 0.2, 2.1, 0.85], [0.36, 0.15, -0.16, 4.0, 0.8],
    [0.06, 0.48, 0.1, 1.2, 0.72], [-0.2, 0.45, -0.26, 3.4, 0.6], [0.1, 0.74, -0.05, 5.1, 0.5],
  ];
  for (const [x, y, z, ry, sc] of spots) {
    const m = new THREE.Mesh(wedge, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.scale.setScalar(sc);
    m.castShadow = true;
    g.add(m);
  }
  g.userData.mat = mat;
  return g;
}
const nodes = [];   // rebuildWorld에서 채운다
const nodeAt = (i, j) => nodes.find((n) => n.i === i && n.j === j);
let minedCount = 0; // 지금 채굴 중인 광맥 수 (HUD용)
let killCount = 0;  // 처치한 적 수 (HUD용)
let playerJob = null; // 'mine' | 'drop' | null

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
  tower: { label: '경비탑', body: 0x7a6ea8, roof: 0x40386b },
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
  if (kind === 'tower') {
    // 포탑 머리 — 조준 대상 쪽으로 돈다 (연출 전용)
    const head = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xb9aee8, roughness: 0.5 })
    );
    dome.castShadow = true;
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.9, 10),
      new THREE.MeshStandardMaterial({
        color: 0xe6e0ff, roughness: 0.4,
        emissive: new THREE.Color(0x6c5ce7), emissiveIntensity: 0.5,
      })
    );
    horn.rotation.x = -Math.PI / 2;
    horn.position.z = -0.7;
    head.add(dome, horn);
    head.position.y = 1.5;
    g.add(head);
    g.userData.head = head;
  }
  return g;
}

// 앵커 (i,j) 기준 2x2. 실패 사유를 문자열로 돌려줘서 플래시로 안내
function buildingPlacement(i, j, kind) {
  if (i < 0 || j < 0 || i + 1 >= CELLS || j + 1 >= CELLS) return '맵 밖입니다';
  const cells = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
  for (const [ci, cj] of cells) {
    if (obstacles.has(cellKey(ci, cj))) return '자리가 막혀 있습니다 (2x2 공터 필요)';
    if (nodeAt(ci, cj)) return '광맥 위에는 지을 수 없습니다';
    if (distCellToPoint(ci, cj, player.x, player.z) < P.player.radius + 0.02) return '내가 서 있는 자리입니다';
    for (const e of enemies)
      if (distCellToPoint(ci, cj, e.x, e.z) < enemyR(e) + 0.02) return '적이 서 있는 자리입니다';
  }
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  if (Math.hypot(player.x - cx, player.z - cz) > P.wall.range + 1.2) return '너무 멉니다';
  if (kind === 'depot') {
    for (const n of nodes) {
      const w = cellToWorld(n.i, n.j);
      if (Math.hypot(w.x - cx, w.z - cz) < P.depot.minPileDist)
        return `치즈더미에서 ${P.depot.minPileDist}m 이상 떨어뜨려 지으세요`;
    }
  }
  return null;
}

function placeBuilding(kind, i, j) {
  const cost = P[kind].cost;
  if (resources < cost) { flashMsg(`치즈가 부족합니다 (${BLDG_INFO[kind].label} ${cost})`, '#e05050'); return null; }
  const err = buildingPlacement(i, j, kind);
  if (err) { flashMsg(err, '#e05050'); return null; }
  resources -= cost;
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  const mesh = makeBuildingMesh(kind);
  mesh.position.set(cx, 0, cz);
  scene.add(mesh);
  const b = { kind, i, j, cells: [], hp: P[kind].hp, maxHp: P[kind].hp, store: 0, mesh, cx, cz, bitT: 0,
              bar: makeBar(0x5fd07a, 1.6) };
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
  if (b.beam) { scene.remove(b.beam); b.beam.material.dispose(); b.beam = null; }
  disposeBar(b.bar);
  scene.remove(b.mesh);
  buildings.splice(buildings.indexOf(b), 1);
  refreshClearance();
  repathAll();
  if (byEnemy) flashMsg(`${BLDG_INFO[b.kind].label}가 파괴됐다!`, '#ff6b6b');
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

// 창고는 이제 "치즈를 부리는 곳"이다 (원작 넥서스).
// 캐는 주체는 플레이어와 일꾼이고, 창고까지 날라야 잔고가 된다.
function updateBuildings(dt) {
  minedCount = 0;
  for (const b of buildings) {
    setBar(b.bar, b.hp / b.maxHp, b.cx, 1.9, b.cz, b.hp < b.maxHp - 0.5);
    if (b.kind === 'tower') { updateTower(b, dt); continue; }
    if (b.kind !== 'depot') continue;
    const busy = carriers().some((c) => c.job === 'mine' && c.depot === b);
    if (busy) minedCount++;
    const roof = b.mesh.children[1];
    roof.material.emissive.setHex(0xf0b429);
    roof.material.emissiveIntensity =
      busy ? 0.25 + 0.25 * Math.abs(Math.sin(performance.now() * 0.006)) : 0.08;
  }
}

// 가장 가까운 창고
function nearestDepot(x, z) {
  let best = null, bd = Infinity;
  for (const b of buildings) {
    if (b.kind !== 'depot') continue;
    const d = Math.hypot(b.cx - x, b.cz - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// 치즈를 나르는 존재들 (플레이어 + 동료 + 일꾼)
const workers = [];
const carriers = () => [player, ...(ally.active ? [ally] : []), ...workers];

// 볼주머니 채굴 (스타 프로브 리듬)
//  더미 옆에서 mineTime 동안 캐서 한 짐(load)을 담고 → 창고까지 날라 한 번에 부린다.
//  반환: 'mine' | 'drop' | null
function doCarryWork(c, dt, load) {
  c.carry = c.carry || 0;
  c.mineT = c.mineT || 0;

  // 1) 하역 — 창고 옆이면 한 번에 부린다
  const dep = nearestDepot(c.x, c.z);
  if (dep && c.carry > 0 && Math.hypot(dep.cx - c.x, dep.cz - c.z) <= P.depot.dropRange) {
    resources += c.carry;
    for (let k = 0; k < 3; k++) spawnCheeseBit(c.x, c.z, { x: dep.cx, z: dep.cz });
    c.carry = 0;
    c.mineT = 0;
    return 'drop';
  }

  // 2) 채굴 — 볼주머니가 비어 있을 때만. 한 짐을 캐는 데 시간이 걸린다
  if (c.carry <= 0) {
    for (const n of nodes) {
      if (n.amount <= 0) continue;
      const w = cellToWorld(n.i, n.j);
      if (Math.hypot(w.x - c.x, w.z - c.z) > P.carry.range) continue;
      c.mineT += dt;
      n.beingMined = true;
      if (c.mineT >= effMineTime()) {
        const got = Math.min(load, n.amount);
        n.amount -= got;
        c.carry = got;
        c.mineT = 0;
        for (let k = 0; k < 2; k++) spawnCheeseBit(w.x, w.z, { x: c.x, z: c.z });
      }
      return 'mine';
    }
  }
  c.mineT = 0;
  return null;
}

// ---- 일꾼 햄스터 ----
// 치즈더미 ↔ 창고를 자동으로 왕복한다. 한 더미에 붙을 수 있는 수가 제한돼 있어서
// 더 벌려면 새 더미를 확보해야 한다 = 영역 확장 압박 (원작 구조).
function pileCrowd(n) {
  let c = 0;
  for (const w of workers) if (w.pile === n) c++;
  return c;
}

function hireWorker() {
  if (workers.length >= P.worker.max) { flashMsg('일꾼이 너무 많습니다', '#e05050'); return null; }
  if (resources < P.worker.cost) { flashMsg(`치즈가 부족합니다 (일꾼 ${P.worker.cost})`, '#e05050'); return null; }
  const dep = nearestDepot(player.x, player.z);
  if (!dep) { flashMsg('치즈 창고가 있어야 일꾼을 고용합니다', '#e05050'); return null; }
  resources -= P.worker.cost;
  const vis = makeCarrierVis(0xd9c48a);
  vis.group.scale.setScalar(P.worker.radius);
  const w = {
    x: dep.cx + (Math.random() - 0.5) * 2, z: dep.cz + 1.6 + Math.random(),
    faceX: 0, faceZ: 1, carry: 0, pile: null, job: null,
    path: [], repathT: 0, vis, depot: dep, workBar: makeBar(0xf0c040, 0.9),
  };
  workers.push(w);
  spawnBuildFx(w.x, w.z);
  return w;
}

function clearWorkers() {
  for (const w of workers) { scene.remove(w.vis.group); disposeBar(w.workBar); }
  workers.length = 0;
}

// 일꾼이 붙을 치즈더미 고르기 — 자리가 남은 것 중 창고에서 가까운 순
function pickPile(w) {
  let best = null, bd = Infinity;
  const dep = w.depot && buildings.includes(w.depot) ? w.depot : nearestDepot(w.x, w.z);
  if (!dep) return null;
  w.depot = dep;
  for (const n of nodes) {
    if (n.amount <= 0) continue;
    if (n !== w.pile && pileCrowd(n) >= P.worker.perPile) continue;
    const nw = cellToWorld(n.i, n.j);
    // 일꾼은 적에게 잡히므로, 창고에서 가까운 더미를 선호한다
    const d = Math.hypot(nw.x - dep.cx, nw.z - dep.cz);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function updateWorkers(dt) {
  for (const w of [...workers]) {
    // 적과 닿으면 쓰러진다 (햄스터니까)
    let dead = false;
    for (const e of enemies)
      if (Math.hypot(w.x - e.x, w.z - e.z) < P.worker.radius + enemyR(e) - 0.02) { dead = true; break; }
    if (dead) {
      spawnBuildFx(w.x, w.z);
      scene.remove(w.vis.group);
      disposeBar(w.workBar);
      workers.splice(workers.indexOf(w), 1);
      flashMsg('일꾼이 잡혔다!', '#ff6b6b');
      continue;
    }

    const did = doCarryWork(w, dt, P.carry.workerLoad);
    w.job = did;

    // 목표: 볼주머니가 찼으면 창고로, 아니면 치즈더미로
    let gx, gz;
    if (w.carry > 0 || (w.pile && w.pile.amount <= 0)) {
      const dep = w.depot && buildings.includes(w.depot) ? w.depot : nearestDepot(w.x, w.z);
      if (!dep) continue;
      w.depot = dep;
      gx = dep.cx; gz = dep.cz;
      if (w.pile && w.pile.amount <= 0) w.pile = null;
    } else {
      if (!w.pile || w.pile.amount <= 0 || pileCrowd(w.pile) > P.worker.perPile) w.pile = pickPile(w);
      if (!w.pile) {
        const dep = nearestDepot(w.x, w.z);
        if (!dep) continue;
        gx = dep.cx; gz = dep.cz;
      } else {
        const nw = cellToWorld(w.pile.i, w.pile.j);
        gx = nw.x; gz = nw.z;
      }
    }

    // 이동 (목표에 충분히 붙었으면 멈춘다)
    const d = Math.hypot(gx - w.x, gz - w.z);
    const stopAt = did === 'drop' || did === 'mine' ? 0.1 : 1.5;
    if (d > stopAt) {
      w.repathT -= dt;
      if (w.repathT <= 0 || !w.path.length) {
        w.repathT = 0.5;
        const pass = (i) => canPass(clearAll, i, P.worker.radius);
        const res = astar(nearestPassableNav(w.x, w.z, pass), worldToNav(gx, gz), pass, () => 0);
        w.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
      }
      while (w.path.length && Math.hypot(w.x - w.path[0].x, w.z - w.path[0].z) < navRes * 0.9) w.path.shift();
      const tx = w.path.length ? w.path[0].x : gx;
      const tz = w.path.length ? w.path[0].z : gz;
      let dx = tx - w.x, dz = tz - w.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.03) {
        dx /= dl; dz /= dl;
        w.x += dx * P.worker.speed * dt;
        w.z += dz * P.worker.speed * dt;
        w.faceX = dx; w.faceZ = dz;
      }
      collideWithObstacles(w, P.worker.radius);
    }
    w.vis.group.position.set(w.x, 0, w.z);
    w.vis.group.rotation.y = Math.atan2(w.faceX, w.faceZ) + Math.PI;
    setBar(w.workBar, (w.mineT || 0) / effMineTime(), w.x, barY(w.vis), w.z, did === 'mine');
    // 볼주머니가 찰수록 통통해진다
    const f = w.carry / P.carry.workerLoad;
    w.vis.group.scale.setScalar(P.worker.radius * (1 + f * 0.18));
  }
}

// ---- 경비탑 ----
// 사거리 안의 적 체력을 깎아 **처치한다**. 적은 체력이 높아서(260~420) 탑 하나로는
// 오래 걸리고, 처치하면 치즈를 준다 (D27). 웨이브는 스테이지마다 다시 채워지므로
// 처치가 압박을 영구히 없애지는 않는다.
function updateTower(b, dt) {
  // 사거리 안에서 체력이 가장 적은(= 곧 정리할 수 있는) 적을 노려 던진다
  let target = null, best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - b.cx, e.z - b.cz);
    if (d > P.tower.range) continue;
    if (e.hp < best) { best = e.hp; target = e; }
  }
  const head = b.mesh.userData.head;
  b.reload = (b.reload || 0) - dt;
  if (!target) return;
  if (head) head.rotation.y = Math.atan2(target.x - b.cx, target.z - b.cz) + Math.PI;
  if (b.reload <= 0) {
    lobProjectile(b.cx, 1.5, b.cz, target, effTowerDmg());
    b.reload = P.tower.reload;
  }
}

// 자폭묘 폭발 — 벽을 부수는 유일한 수단. 자기도 죽는다.
function detonate(e) {
  const R = P.bomber.blastRadius;
  spawnBuildFx(e.x, e.z);
  spawnBuildFx(e.x, e.z);
  // 반경 안의 플레이어 벽 제거 (지형은 무사)
  const c = worldToCell(e.x, e.z);
  const span = Math.ceil(R) + 1;
  let broke = 0;
  for (let dj = -span; dj <= span; dj++)
    for (let di = -span; di <= span; di++) {
      const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
      if (!ob || ob.bedrock || ob.bldgRef) continue;
      if (distCellToPoint(ob.i, ob.j, e.x, e.z) > R) continue;
      removeObstacle(ob);
      broke++;
    }
  // 반경 안의 건물·햄스터도 피해
  for (const b of [...buildings])
    if (Math.hypot(b.cx - e.x, b.cz - e.z) < R + 1.2) damageBuilding(b, P.bomber.dmg * 2);
  for (const h of [player, ally])
    if (h.active !== false && Math.hypot(h.x - e.x, h.z - e.z) < R + 0.6) hurtHamster(h, P.bomber.dmg);
  for (const g of [...guards])
    if (Math.hypot(g.x - e.x, g.z - e.z) < R + 0.6) removeGuard(g, true);

  scene.remove(e.vis.group);
  disposeBar(e.bar);
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  if (broke) { refreshClearance(); repathAll(); }
  else refreshReach();
  flashMsg(broke ? `자폭! 벽 ${broke}칸이 날아갔다` : '자폭묘가 터졌다', '#ff8b5e');
}

// 적 피해 → 처치. 처치하면 치즈를 준다.
function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.hitFlash = 0.15;
  if (e.hp > 0) return;
  const reward = P[e.type].reward;
  resources += reward;
  spawnBuildFx(e.x, e.z);
  for (let k = 0; k < 3; k++) spawnCheeseBit(e.x, e.z, null);
  scene.remove(e.vis.group);
  disposeBar(e.bar);
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  killCount++;
  flashMsg(`${TYPE_INFO[e.type].label} 처치! 치즈 +${reward}`, '#bfaaff');
  refreshReach();
  // 원작의 탐욕 페널티 — 일정 수를 잡으면 그때 우루루 쏟아진다.
  // 많이 잡을수록 빨리 몰린다 = "멈출 줄 아는 게 실력"
  if (P.threat.killsPerSurge > 0 &&
      Math.floor(killCount / P.threat.killsPerSurge) > surgeDone) {
    surgeDone++;
    const pool = unlockedTypes();
    for (let k = 0; k < P.threat.surgeSize; k++)
      enemies.push(makeEnemy(pool[Math.floor(Math.random() * pool.length)], enemies.length));
    refreshReach();
    flashMsg(`너무 많이 잡았다 — 무리가 몰려온다! (+${P.threat.surgeSize})`, '#ff4d4d');
  }
}

// 광맥은 시각 전용 — 채굴 주체는 창고다.
// 잔량이 줄면 위쪽 조각부터 사라져서 "먹히고 있다"가 눈에 보인다.
function updateNodes(dt) {
  for (const n of nodes) {
    const g = n.mesh;
    const frac = Math.max(n.amount, 0) / P.res.nodeAmount;
    const keep = Math.max(1, Math.ceil(frac * g.children.length));
    g.children.forEach((c, k) => { c.visible = n.amount > 0 && k < keep; });
    const mat = g.userData.mat;
    if (n.amount <= 0) {
      mat.color.setHex(0x555a66);
      mat.emissiveIntensity = 0;
      g.children[0].visible = true;
      g.children[0].scale.setScalar(0.45);
      g.rotation.y += dt * 0.2;
      continue;
    }
    mat.color.setHex(0xf0b429);
    if (n.beingMined) {
      g.rotation.y += dt * 1.6;
      const bob = Math.abs(Math.sin(performance.now() * 0.006));
      g.position.y = bob * 0.14;
      mat.emissiveIntensity = 0.25 + 0.35 * bob;
    } else {
      g.rotation.y += dt * 0.3;
      g.position.y = 0;
      mat.emissiveIntensity = 0;
    }
    n.beingMined = false;
  }
}

// ============================================================
// 방어병 — 배치하고 명령하는 유닛 (D29)
//  · 타일에 배치 (핫바). 우클릭으로 선택 → 다른 타일 우클릭으로 이동 명령
//  · 사거리 안 적에게 물건을 던진다. 투사체는 벽을 넘어간다
//  · 적과 닿으면 즉시 쓰러진다 — 벽 뒤에 세워야 오래 산다
// ============================================================
const guards = [];
const projectiles = [];
const projGeo = new THREE.SphereGeometry(0.16, 8, 6);
const projMat = new THREE.MeshStandardMaterial({
  color: 0xffe9a8, roughness: 0.5,
  emissive: new THREE.Color(0xd8a63a), emissiveIntensity: 0.5,
});
const selRingGeo = new THREE.RingGeometry(0.5, 0.62, 20);
let selectedGuard = null;

function makeGuardVis() {
  const v = makeHamster(0x6f8f4f);
  applyModel(v, 'worker', 0x5f7f3f, 0.62);            // 군용 올리브색
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x44502f, roughness: 0.6 })
  );
  helm.position.set(0, 2.55, -0.1);
  helm.castShadow = true;
  v.group.add(helm);
  v.group.scale.setScalar(P.guard.radius);
  return v;
}

function placeGuard(i, j) {
  if (resources < P.guard.cost) { flashMsg(`치즈가 부족합니다 (방어병 ${P.guard.cost})`, '#e05050'); return null; }
  if (obstacles.has(cellKey(i, j)) || nodeAt(i, j)) { flashMsg('그 자리에는 세울 수 없습니다', '#e05050'); return null; }
  const w = cellToWorld(i, j);
  if (Math.hypot(player.x - w.x, player.z - w.z) > P.wall.range + 1.0) { flashMsg('너무 멉니다', '#e05050'); return null; }
  resources -= P.guard.cost;
  const vis = makeGuardVis();
  const ring = new THREE.Mesh(
    selRingGeo,
    new THREE.MeshBasicMaterial({ color: 0x9fe8a0, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 996;
  ring.visible = false;
  scene.add(ring);
  const g = { x: w.x, z: w.z, gx: w.x, gz: w.z, faceX: 0, faceZ: 1, vis, ring, path: [], repathT: 0, reload: 0 };
  guards.push(g);
  spawnBuildFx(w.x, w.z);
  return g;
}

function removeGuard(g, byEnemy) {
  scene.remove(g.vis.group);
  scene.remove(g.ring);
  g.ring.material.dispose();
  const k = guards.indexOf(g);
  if (k >= 0) guards.splice(k, 1);
  if (selectedGuard === g) selectedGuard = null;
  if (byEnemy) { spawnBuildFx(g.x, g.z); flashMsg('방어병이 쓰러졌다!', '#ff6b6b'); }
}

function clearGuards() {
  for (const g of [...guards]) removeGuard(g, false);
  projectiles.length = 0;
}

function guardAtWorld(x, z) {
  let best = null, bd = 1.1;
  for (const g of guards) {
    const d = Math.hypot(g.x - x, g.z - z);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

// 던지기 — 포물선이라 벽을 넘어간다 (경비탑·방어병 공용)
function lobProjectile(x, y, z, e, dmg) {
  const m = new THREE.Mesh(projGeo, projMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  scene.add(m);
  projectiles.push({
    mesh: m, t: 0, dur: 0.35 + Math.hypot(e.x - x, e.z - z) * 0.045,
    x0: x, y0: y, z0: z, target: e, dmg,
  });
}
const throwAt = (g, e) => lobProjectile(g.x, 0.9, g.z, e, P.guard.dmg);

function updateProjectiles(dt) {
  for (let k = projectiles.length - 1; k >= 0; k--) {
    const q = projectiles[k];
    q.t += dt;
    const p = Math.min(q.t / q.dur, 1);
    const tx = q.target && enemies.includes(q.target) ? q.target.x : q.mesh.position.x;
    const tz = q.target && enemies.includes(q.target) ? q.target.z : q.mesh.position.z;
    q.mesh.position.set(
      q.x0 + (tx - q.x0) * p,
      q.y0 + Math.sin(p * Math.PI) * 1.6,   // 포물선 — 벽을 넘어간다
      q.z0 + (tz - q.z0) * p
    );
    q.mesh.rotation.x += dt * 10;
    if (p >= 1) {
      if (q.target && enemies.includes(q.target)) damageEnemy(q.target, q.dmg);
      scene.remove(q.mesh);
      projectiles.splice(k, 1);
    }
  }
}

function updateGuards(dt) {
  for (const g of [...guards]) {
    // 적과 접촉 → 즉시 쓰러짐
    for (const e of enemies) {
      if (Math.hypot(g.x - e.x, g.z - e.z) < P.guard.radius + enemyR(e) - 0.02) {
        removeGuard(g, true);
        break;
      }
    }
    if (!guards.includes(g)) continue;

    // 명령받은 자리로 이동
    const dGoal = Math.hypot(g.gx - g.x, g.gz - g.z);
    if (dGoal > 0.25) {
      g.repathT -= dt;
      if (g.repathT <= 0 || !g.path.length) {
        g.repathT = 0.4;
        const pass = (i) => canPass(clearAll, i, P.guard.radius);
        const res = astar(nearestPassableNav(g.x, g.z, pass), worldToNav(g.gx, g.gz), pass, () => 0);
        g.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
      }
      while (g.path.length && Math.hypot(g.x - g.path[0].x, g.z - g.path[0].z) < navRes * 0.9) g.path.shift();
      const tx = g.path.length ? g.path[0].x : g.gx;
      const tz = g.path.length ? g.path[0].z : g.gz;
      let dx = tx - g.x, dz = tz - g.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.03) {
        dx /= dl; dz /= dl;
        g.x += dx * P.guard.speed * dt;
        g.z += dz * P.guard.speed * dt;
        g.faceX = dx; g.faceZ = dz;
      }
      collideWithObstacles(g, P.guard.radius);
    } else {
      g.path.length = 0;
    }

    // 사거리 안 적에게 투척 (가장 가까운 적)
    g.reload -= dt;
    let tgt = null, bd = P.guard.range;
    for (const e of enemies) {
      const d = Math.hypot(e.x - g.x, e.z - g.z);
      if (d < bd) { bd = d; tgt = e; }
    }
    if (tgt) {
      g.faceX = (tgt.x - g.x) / bd; g.faceZ = (tgt.z - g.z) / bd;
      if (g.reload <= 0) { throwAt(g, tgt); g.reload = P.guard.reload; }
    }

    g.vis.group.position.set(g.x, 0, g.z);
    g.vis.group.rotation.y = Math.atan2(g.faceX, g.faceZ) + Math.PI;
    g.ring.position.set(g.x, 0.06, g.z);
    g.ring.visible = selectedGuard === g;
  }
}

// ============================================================
// 체력바 / 진행바 — 엔티티 머리 위에 뜨는 얇은 빌보드
//  아군(플레이어·동료·건물) 초록 / 적 빨강 / 채굴 진행 노랑.
//  가득 찬 체력바는 감춰서 화면이 지저분해지지 않게 한다.
// ============================================================
const bars = [];
const barGeo = new THREE.PlaneGeometry(1, 1);
barGeo.translate(0.5, 0, 0);   // 좌측 끝이 피벗 → scale.x = 비율

function makeBar(color, width = 1.0) {
  const g = new THREE.Group();
  const mk = (c, op, w, h, z) => {
    const m = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: op, depthTest: false, depthWrite: false,
    }));
    m.scale.set(w, h, 1);
    m.position.set(-w / 2, 0, z);
    m.renderOrder = 1000;
    return m;
  };
  const bg = mk(0x101520, 0.72, width * 1.06, 0.15, 0);
  const fill = mk(color, 0.95, width, 0.11, 0.001);
  g.add(bg, fill);
  g.userData = { fill, width, color };
  g.visible = false;
  scene.add(g);
  bars.push(g);
  return g;
}

// frac 0~1. show=false면 숨긴다
function setBar(g, frac, x, y, z, show = true) {
  if (!g) return;
  g.visible = show && frac > 0.001;
  if (!g.visible) return;
  const f = Math.max(0, Math.min(1, frac));
  const { fill, width } = g.userData;
  fill.scale.x = width * f;
  fill.position.x = -width / 2;
  g.position.set(x, y, z);
}

function disposeBar(g) {
  if (!g) return;
  scene.remove(g);
  g.children.forEach((c) => c.material.dispose());
  const k = bars.indexOf(g);
  if (k >= 0) bars.splice(k, 1);
}

// 매 프레임 카메라를 향하게 (빌보드)
function faceBars() {
  const q = activeCam().quaternion;
  for (const g of bars) if (g.visible) g.quaternion.copy(q);
}

// 모델 높이를 재서 머리 위 위치를 잡는다 (스케일이 바뀌어도 비율로 유지)
function measureTop(vis) {
  const box = new THREE.Box3().setFromObject(vis.group);
  const sc = vis.group.scale.y || 1;
  vis.topRatio = (box.max.y - vis.group.position.y) / sc;
  if (!isFinite(vis.topRatio) || vis.topRatio <= 0) vis.topRatio = 2.5;
}
const barY = (vis) => (vis.topRatio || 2.5) * (vis.group.scale.y || 1) + 0.3;

// ============================================================
// 픽업 — 밖에 나갈 이유 (D22)
//  창고 수입이 자동이 되면서 안전지대 안에만 있어도 치즈가 쌓인다.
//  그래서 "위험을 감수하고 나가야만 얻는 것"을 따로 만든다:
//   부품 상자 = 업그레이드 전용 화폐 (안에서는 절대 안 나옴)
//   치즈 더미 = 즉시 목돈
//  플레이어에게서 최소 거리 밖, 적이 도달 가능한 개활지에만 생긴다.
// ============================================================
const pickups = [];
const partGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const pileGeo = new THREE.DodecahedronGeometry(0.42);
let pickupT = 0;

function randomOpenCell() {
  for (let tries = 0; tries < 120; tries++) {
    const i = 2 + Math.floor(Math.random() * (CELLS - 4));
    const j = 2 + Math.floor(Math.random() * (CELLS - 4));
    if (obstacles.has(cellKey(i, j)) || nodeAt(i, j)) continue;
    const w = cellToWorld(i, j);
    if (Math.hypot(w.x - player.x, w.z - player.z) < P.pickup.minPlayerDist) continue;
    // 적이 갈 수 있는 곳 = 안전지대 밖 (여기가 핵심 조건)
    if (enemyReach && !enemyReach[worldToNav(w.x, w.z)]) continue;
    return { i, j, x: w.x, z: w.z };
  }
  return null;
}

function spawnPickup() {
  const spot = randomOpenCell();
  if (!spot) return;
  const isParts = Math.random() < P.pickup.partsRatio;
  const mesh = new THREE.Mesh(
    isParts ? partGeo : pileGeo,
    new THREE.MeshStandardMaterial({
      color: isParts ? 0x8fd6ff : 0xffd24a,
      roughness: 0.4,
      emissive: new THREE.Color(isParts ? 0x2b8fd6 : 0xf0b429),
      emissiveIntensity: 0.7,
    })
  );
  mesh.position.set(spot.x, 0.5, spot.z);
  mesh.castShadow = true;
  scene.add(mesh);
  pickups.push({ kind: isParts ? 'parts' : 'cheese', x: spot.x, z: spot.z, mesh, t: 0 });
}

function updatePickups(dt) {
  pickupT += dt;
  if (pickupT >= P.pickup.interval) {
    pickupT = 0;
    if (pickups.length < P.pickup.maxOnMap) spawnPickup();
  }
  for (let k = pickups.length - 1; k >= 0; k--) {
    const u = pickups[k];
    u.t += dt;
    u.mesh.rotation.y += dt * 2;
    u.mesh.position.y = 0.5 + Math.sin(u.t * 3) * 0.12;
    // 플레이어 또는 동료가 밟으면 획득
    const got = Math.hypot(player.x - u.x, player.z - u.z) < 1.1
      || (ally.active && !ally.stunned && Math.hypot(ally.x - u.x, ally.z - u.z) < 1.1);
    if (!got) continue;
    if (u.kind === 'parts') {
      parts += P.pickup.partsEach;
      flashMsg(`부품 +${P.pickup.partsEach} (U: 업그레이드)`, '#8fd6ff');
    } else {
      resources += P.pickup.cheeseEach;
      flashMsg(`치즈 +${P.pickup.cheeseEach}`, '#ffd24a');
    }
    spawnBuildFx(u.x, u.z);
    scene.remove(u.mesh);
    u.mesh.material.dispose();
    pickups.splice(k, 1);
  }
}

function clearPickups() {
  for (const u of pickups) { scene.remove(u.mesh); u.mesh.material.dispose(); }
  pickups.length = 0;
  pickupT = 0;
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
  {
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
  if (gx === null && enemy.prowlT > 0) {
    // 포기하고 서성이는 중 — 근처를 어슬렁거린다
    gx = clamp(enemy.prowlX, -HALF + 1, HALF - 1);
    gz = clamp(enemy.prowlZ, -HALF + 1, HALF - 1);
    enemy.goalX = gx; enemy.goalZ = gz;
    const pr = astar(start, worldToNav(gx, gz), passAll, () => 0);
    enemy.path = pr.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = '서성임';
    return;
  }
  if (gx === null) {
    const ts = chaseTargets();
    if (!ts.length) { enemy.path = []; enemy.aiMode = '배회'; return; }
    let tBest = ts[0], tD = Infinity;
    for (const t of ts) {
      let dd = Math.hypot(t.x - enemy.x, t.z - enemy.z);
      // 한 번 포기한 뒤에는 다른 햄스터 쪽을 더 매력적으로 본다
      if (enemy.preferAlly && t === ally) dd *= 0.55;
      if (!enemy.preferAlly && t === player) dd *= 0.85;
      if (dd < tD) { tD = dd; tBest = t; }
    }
    tD = Math.hypot(tBest.x - enemy.x, tBest.z - enemy.z);
    // 직진만 하지 않는다 — 목표 둘레의 "접근 지점"을 노린다 (D28).
    // 각 적이 서로 다른 각도(approachA)를 갖고, 반경은 거리에 비례해 줄어든다.
    // → 멀리서는 서로 다른 방향으로 벌어져 오다가 가까워지며 조여든다(나선형).
    //   막히면 각도를 크게 돌려 다른 방향에서 다시 시도한다.
    if (tD < 1.5) {
      gx = tBest.x; gz = tBest.z;                 // 코앞이면 직진
    } else {
      const r = Math.min(P.enemy.flankRadius, tD * 0.55);
      const ax = clamp(tBest.x + Math.cos(enemy.approachA) * r, -HALF + 1, HALF - 1);
      const az = clamp(tBest.z + Math.sin(enemy.approachA) * r, -HALF + 1, HALF - 1);
      // 접근 지점이 내 몸집으로 설 수 없는 자리면 그냥 목표 직행
      if (canPass(clearAll, worldToNav(ax, az), er)) { gx = ax; gz = az; }
      else { gx = tBest.x; gz = tBest.z; }
    }
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
let stage = 1;        // 1..10
let stageT = 0;       // 이번 스테이지 경과 시간
let victory = false;

const stageDur = () => STAGES[Math.min(stage, STAGES.length) - 1].time;

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

// 시간이 다 되면 다음 스테이지 (치즈 잔고와 무관)
function updateStageTimer(dt) {
  if (victory || !enemyActive()) return;
  stageT += dt;
  if (stageT >= stageDur()) advanceStage();
}

// 스테이지 표가 의도한 누적 구성. 처치로 줄어들었으면 웨이브 때 다시 채운다.
function cumulativeComposition() {
  const c = { chaser: P.enemy.count, runner: 0, bomber: 0 };
  for (let k = 0; k < Math.min(stage, STAGES.length); k++)
    for (const [ty, n] of Object.entries(STAGES[k].add)) c[ty] += n;
  return c;
}

function topUpToCurve() {
  const want = cumulativeComposition();
  const have = { chaser: 0, runner: 0, bomber: 0 };
  for (const e of enemies) have[e.type]++;
  let added = 0;
  for (const ty of Object.keys(want))
    while (have[ty] < want[ty]) { enemies.push(makeEnemy(ty, enemies.length)); have[ty]++; added++; }
  if (added) { refreshReach(); flashMsg(`새 무리가 몰려온다! (+${added})`, '#ff8b5e'); }
}

function advanceStage() {
  if (stage >= STAGES.length) {
    victory = true;
    overlayEl.querySelector('h1').textContent = '10 스테이지 돌파!';
    document.getElementById('overlay-sub').textContent =
      `${MAPS[mapIndex].name} · ${survival.toFixed(0)}초 · 잡힘 ${caughtCount}회 — R 키로 처음부터`;
    overlayEl.classList.remove('hidden');
    return;
  }
  stage++;
  stageT = 0;
  spawnStageAdds(stage - 1);
  topUpToCurve();   // 처치로 줄어든 만큼 보충 — 처치는 한숨 돌릴 시간을 줄 뿐
  flashMsg(`스테이지 ${stage} — ${stageDur()}초 버티기`, '#6ee07a');
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
  // 체력 아주 느린 자연 회복 (찔끔찔끔 누적으로 죽지 않게 — 처치엔 집중 화력이 필요)
  enemy.hp = Math.min(enemy.hp + enemyMaxHp(enemy) * 0.02 * dt, enemyMaxHp(enemy));
  if (enemy.hitFlash > 0) enemy.hitFlash -= dt;
  if (enemy.probeT > 0) enemy.probeT -= dt;
  else enemy.approachA += P.enemy.drift * dt;
  if (enemy.prowlT > 0) {
    enemy.prowlT -= dt;
    if (enemy.prowlT <= 0) enemy.repathT = 0;   // 서성임 끝 → 다시 추격
  }   // 천천히 돌며 계속 각도를 바꿔 본다
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
  const spd = enemySpeedOf(enemy);
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
      if (!ob || ob.bedrock || !ob.bldgRef) continue;  // 벽은 무적, 건물만
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
  // 막혔다 → 접근각을 크게 돌려 "다른 방향에서 다시" 시도한다.
  // 벽에 부딪힌 채 같은 자리를 파는 대신 옆구리를 노리는 움직임이 여기서 나온다.
  if (enemy.stallT > 0.45 && enemy.probeT <= 0) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    enemy.approachA += dir * (P.enemy.probeTurn * (0.7 + Math.random() * 0.8));
    enemy.probeT = P.enemy.probeHold;
    enemy.repathT = 0;
    enemy.stallT = 0;
    enemy.probes = (enemy.probes || 0) + 1;
    // 몇 번 시도해도 안 되면 포기하고 서성인다 — 플레이어가 확장을 시도할 틈
    if (enemy.probes >= P.enemy.giveUpProbes) {
      enemy.probes = 0;
      enemy.prowlT = P.enemy.prowlTime;
      enemy.prowlCount = (enemy.prowlCount || 0) + 1;
      enemy.prowlX = enemy.x + (Math.random() - 0.5) * 10;
      enemy.prowlZ = enemy.z + (Math.random() - 0.5) * 10;
      enemy.preferAlly = !enemy.preferAlly;   // 다음엔 다른 햄스터를 노려본다
    }
  }
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
      if (!ob.bldgRef) continue;   // 벽은 무적 — 건물만 노린다
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
  }
  // 벽은 무적이라 때려서 부술 수 없다 — 자폭묘의 폭발만이 벽을 없앤다

  // ---- 햄스터 공격 (한 방 즉사가 아니라 예비동작 → 타격) ----
  // 자폭묘는 때리는 대신 점화한다.
  let hitTarget = null;
  for (const h of chaseTargets()) {
    const hr = h === player ? P.player.radius : P.ally.radius;
    if (Math.hypot(h.x - enemy.x, h.z - enemy.z) < er + hr + P.enemy.attackRange) { hitTarget = h; break; }
  }
  enemy.atkT = (enemy.atkT || 0) - dt;
  // 자폭묘는 "앞을 막은 벽"에도 점화한다 — 벽이 무적이라 이게 유일한 돌파 수단
  let blockingWall = null;
  if (enemy.type === 'bomber') {
    const c = worldToCell(enemy.x, enemy.z);
    for (let dj = -2; dj <= 2 && !blockingWall; dj++)
      for (let di = -2; di <= 2; di++) {
        const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
        if (!ob || ob.bedrock || ob.bldgRef) continue;
        if (distToObstacle(enemy, ob) <= reach) { blockingWall = ob; break; }
      }
    // 길이 뚫려 있으면(추격 중) 굳이 안 터진다 — 막혔을 때만
    if (blockingWall && enemy.aiMode === '추격' && enemy.stallT < 0.3) blockingWall = null;
  }
  if (enemy.type === 'bomber' && (hitTarget || bldgTarget || blockingWall)) {
    // 점화: fuse 동안 부풀었다가 터진다 (피할 시간을 준다)
    enemy.fuseT = (enemy.fuseT || 0) + dt;
    const f = enemy.fuseT / P.bomber.fuse;
    enemy.vis.group.scale.setScalar(enemyR(enemy) * (1 + 0.25 * f));
    if (enemy.fuseT >= P.bomber.fuse) { detonate(enemy); return; }
  } else if (enemy.type === 'bomber') {
    enemy.fuseT = Math.max((enemy.fuseT || 0) - dt * 2, 0);
    enemy.vis.group.scale.setScalar(enemyR(enemy));
  } else if (hitTarget) {
    if (enemy.atkT <= 0) {
      enemy.windup = (enemy.windup || 0) + dt;
      if (enemy.windup >= P.enemy.attackWindup) {
        hurtHamster(hitTarget, typeP(enemy).dmg);
        enemy.windup = 0;
        enemy.atkT = P.enemy.attackCooldown;
        enemy.lungeT = 0.2;
      }
    }
  } else {
    enemy.windup = 0;
  }
  // 예비동작·타격 모션 (앞으로 움찔 → 덮침)
  if (enemy.lungeT > 0) {
    enemy.lungeT -= dt;
    enemy.vis.group.position.y = Math.sin((0.2 - enemy.lungeT) / 0.2 * Math.PI) * 0.35;
  } else {
    enemy.vis.group.position.y = 0;
    if (enemy.windup > 0) {
      const w = enemy.windup / P.enemy.attackWindup;
      enemy.vis.group.scale.setScalar(enemyR(enemy) * (1 - 0.08 * w));  // 웅크림
    } else if (enemy.type !== 'bomber') {
      enemy.vis.group.scale.setScalar(enemyR(enemy));
    }
  }

  // 공격 중 = 빨간 펄스 / 탑에 맞는 중 = 보라 섬광 / 스태미나 낮음 = 옅은 발광
  const stFrac = enemy.hp / enemyMaxHp(enemy);
  if (enemy.hitFlash > 0) {
    enemy.vis.setEmissive(0xbfaaff, 0.9);
  } else if (bldgTarget || enemy.attackTarget) {
    enemy.vis.setEmissive(0xff2222, 0.35 + 0.25 * Math.sin(performance.now() * 0.02));
  } else if (stFrac < 0.6) {
    enemy.vis.setEmissive(0x8f7bd8, (1 - stFrac) * 0.5);
  } else {
    enemy.vis.setEmissive(0x000000, 0);
  }
  enemy.isAttacking = !!(bldgTarget || enemy.attackTarget);

  setBar(enemy.bar, enemy.hp / enemyMaxHp(enemy), enemy.x, barY(enemy.vis), enemy.z,
         enemy.hp < enemyMaxHp(enemy) - 0.5);
  enemy.vis.group.position.set(enemy.x, 0, enemy.z);
  if (dl > 0.05) {
    enemy.dirX = dx; enemy.dirZ = dz;
    enemy.vis.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
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
  if (e.code === 'KeyU') { upgOpen = !upgOpen; renderUpgrade(); }
  // 숫자키 = 업그레이드 패널이 열려 있으면 구매, 아니면 건설 슬롯 선택
  for (let k = 0; k < 9; k++) {
    if (e.code === 'Digit' + (k + 1)) {
      if (upgOpen) buyUpgrade(k);
      else if (k < BUILD_SLOTS.length) { buildSlot = k; updateHotbar(); }
      break;
    }
  }
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyX') { buildSlot = BUILD_SLOTS.findIndex(b => b.key === 'remove'); updateHotbar(); }

});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
let mouseDown = false;
window.addEventListener('mousedown', (e) => { if (e.button === 0 && e.target === renderer.domElement) mouseDown = true; });
window.addEventListener('mouseup', () => (mouseDown = false));
window.addEventListener('contextmenu', (e) => {
  if (e.target === renderer.domElement) e.preventDefault();
});
// 우클릭 = 방어병 명령 (좌클릭은 건설이라 충돌을 피함)
window.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || e.target !== renderer.domElement || !alive) return;
  const hit = pointerGround(e);
  if (!hit) return;
  const g = guardAtWorld(hit.x, hit.z);
  if (g) { selectedGuard = g; flashMsg('방어병 선택 — 우클릭으로 이동 명령', '#9fe8a0'); return; }
  if (selectedGuard) {
    const c = worldToCell(hit.x, hit.z);
    if (obstacles.has(cellKey(c.i, c.j))) { flashMsg('그 자리로는 갈 수 없습니다', '#e05050'); return; }
    const w = cellToWorld(c.i, c.j);
    selectedGuard.gx = w.x; selectedGuard.gz = w.z;
    selectedGuard.repathT = 0;
    selectedGuard.path.length = 0;
  }
});

// 화면 좌표 → 바닥 평면 교점
function pointerGround(ev) {
  const ndc = new THREE.Vector2(
    (ev.clientX / innerWidth) * 2 - 1,
    -(ev.clientY / innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, activeCam());
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

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
      player.x += mx * effPlayerSpeed() * dt;
      player.z += mz * effPlayerSpeed() * dt;
      player.faceX = mx; player.faceZ = mz;
    }
  }
  collideWithObstacles(player, P.player.radius);

  playerVis.group.position.set(player.x, 0, player.z);
  playerVis.group.rotation.y = Math.atan2(player.faceX, player.faceZ) + Math.PI;

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

  // ---- 체력 / 채굴 진행 바 ----
  {
    const y = barY(playerVis);
    setBar(playerBar, playerHp / P.player.hp, player.x, y, player.z,
           !playerStunned && playerHp < P.player.hp - 0.5);
    const mining = playerJob === 'mine';
    setBar(playerWorkBar, (player.mineT || 0) / effMineTime(),
           player.x, y + (playerBar && playerBar.visible ? 0.26 : 0), player.z, mining);
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
  if (hasTile && slot.key === 'remove') {
    const ob = obstacles.get(cellKey(gi, gj));
    valid = !!ob && !ob.bedrock && !ob.bldgRef && affordable;
  } else if (slot.key === 'worker') {
    valid = affordable && !!nearestDepot(player.x, player.z);
  } else if (hasTile) {
    if (slot.size === 2) {
      valid = affordable && !buildingPlacement(gi, gj, slot.key);
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
;
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
  ghost.material.color.setHex(
    slot.key === 'remove' ? (valid ? 0xffb347 : 0xe05050) : (valid ? 0x6ee07a : 0xe05050)
  );

  // ---- 즉시 건설 (선택 슬롯) ----
  // 벽: 홀드하면 쿨다운마다 연속 설치 / 나머지: 누르는 순간 1회
  buildCooldown -= dt;
  if (slot.key === 'wall') {
    if (wantBuild && buildCooldown <= 0 && valid) {
      resources -= P.wall.cost;
      const ob = addObstacle(gi, gj, false);
      refreshClearance();
      repathAll();
      ob.mesh.scale.y = 0.02;
      ob.mesh.position.y = 0.01;
      popping.push({ ob, t: 0 });
      spawnBuildFx(w.x, w.z);
      buildCooldown = P.wall.cooldown;
    }
  } else if (slot.key === 'remove') {
    if (wantBuild && buildCooldown <= 0 && valid) {
      const ob = obstacles.get(cellKey(gi, gj));
      resources -= P.wall.removeCost;
      removeObstacle(ob);
      refreshClearance();
      repathAll();
      spawnBuildFx(w.x, w.z);
      buildCooldown = P.wall.cooldown;
    }
  } else if (buildPressed && hasTile) {
    if (slot.key === 'depot') placeBuilding('depot', gi, gj);
    else if (slot.key === 'workshop') placeBuilding('workshop', gi, gj);
    else if (slot.key === 'tower') placeBuilding('tower', gi, gj);
    else if (slot.key === 'guard') placeGuard(gi, gj);
    else if (slot.key === 'worker') hireWorker();
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
  f.add(P.player, 'graceTime', 0, 5, 0.1).name('피격 뒤 무적(초)');
  f.add(P.player, 'hp', 20, 400, 10).name('체력 (재시작부터)');
  f.add(P.player, 'regen', 0, 30, 1).name('체력 재생(초당)');
  f.add(P.player, 'regenDelay', 0, 10, 0.5).name('재생 시작까지(초)');
  f.add(P.player, 'wipeOnCatch', 0, 1, 1).name('잡히면 전부 소멸 (원작)');
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
  const f3 = f.addFolder('자폭묘 (폭발로 벽 파괴)');
  f3.add(P.bomber, 'radius', 0.4, 3.0, 0.05).name('반지름').onChange(radiusChanged('bomber'));
  f3.add(P.bomber, 'speed', 2, 14, 0.1).name('이동 속도');
  f3.add(P.bomber, 'blastRadius', 0.5, 5, 0.1).name('폭발 반경');
  f3.add(P.bomber, 'fuse', 0.2, 3, 0.1).name('점화 시간(초)');
}
{
  const f = gui.addFolder('벽');
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
  f.add(P.wall, 'cost', 1, 60, 1).name('벽 비용');
  f.add(P.wall, 'removeCost', 0, 30, 1).name('철거 비용');
  f.add(P.res, 'startWalls', 0, 30, 1).name('시작 벽 개수분 (재시작부터)');
  f.add(P.res, 'nodeAmount', 50, 2000, 10).name('더미 매장량 (재시작부터)');
}
{
  const f = gui.addFolder('동료 (AI 햄스터)');
  f.add(P.ally, 'enabled', 0, 1, 1).name('사용 (재시작부터, 0=솔로)');
  f.add(P.ally, 'speed', 2, 12, 0.1).name('이동 속도');
  f.add(P.ally, 'fleeDist', 1, 10, 0.1).name('도망 시작 거리');
}
{
  const f = gui.addFolder('건물 (2번 창고 · 3번 공방)');
  f.add(P.depot, 'cost', 5, 60, 1).name('창고 비용');
  f.add(P.depot, 'hp', 50, 1500, 10).name('창고 내구도 (새 건물부터)');
  f.add(P.depot, 'dropRange', 1, 8, 0.2).name('창고 하역 거리');
  f.add(P.depot, 'minPileDist', 0, 14, 0.5).name('창고-더미 최소 거리');
  f.add(P.carry, 'mineTime', 0.3, 6, 0.1).name('한 짐 캐는 시간(초)');
  f.add(P.carry, 'playerLoad', 2, 60, 1).name('플레이어 한 짐');
  f.add(P.carry, 'workerLoad', 2, 60, 1).name('일꾼 한 짐');
  f.add(P.carry, 'range', 1, 6, 0.1).name('채굴 접근 거리');
  f.add(P.workshop, 'cost', 5, 60, 1).name('공방 비용');
  f.add(P.workshop, 'hp', 50, 1500, 10).name('공방 내구도 (새 건물부터)');
  f.add(P.tower, 'cost', 5, 120, 5).name('경비탑 비용');
  f.add(P.tower, 'hp', 50, 1500, 10).name('경비탑 내구도 (새 건물부터)');
  f.add(P.tower, 'range', 2, 16, 0.5).name('경비탑 사거리');
  f.add(P.tower, 'dmg', 2, 120, 1).name('경비탑 투척 피해');
  f.add(P.tower, 'reload', 0.2, 4, 0.1).name('경비탑 투척 간격');
  f.add(P.threat, 'hpGain', 0, 120, 5).name('적 체력 증가/레벨');
  f.add(P.threat, 'speedCap', 3, 14, 0.1).name('적 속도 상한');
  f.add(P.threat, 'killsPerSurge', 1, 30, 1).name('N킬마다 우루루');
  f.add(P.threat, 'surgeSize', 1, 10, 1).name('우루루 마릿수');
}
{
  const f = gui.addFolder('방어병 (우클릭 명령)');
  f.add(P.guard, 'cost', 5, 100, 1).name('비용');
  f.add(P.guard, 'range', 2, 16, 0.5).name('투척 사거리');
  f.add(P.guard, 'dmg', 2, 100, 1).name('투척 피해');
  f.add(P.guard, 'reload', 0.2, 4, 0.1).name('투척 간격(초)');
  f.add(P.guard, 'speed', 1, 12, 0.1).name('이동 속도');
}
{
  const f = gui.addFolder('적 체력 / 보상');
  f.add(P.chaser, 'hp', 30, 900, 10).name('순찰묘 체력');
  f.add(P.chaser, 'reward', 0, 100, 1).name('순찰묘 처치 보상');
  f.add(P.runner, 'hp', 30, 900, 10).name('날쌘묘 체력');
  f.add(P.runner, 'reward', 0, 100, 1).name('날쌘묘 처치 보상');
  f.add(P.bomber, 'hp', 30, 900, 10).name('자폭묘 체력');
  f.add(P.bomber, 'reward', 0, 100, 1).name('자폭묘 처치 보상');
}
{
  const f = gui.addFolder('적 접근 방식 (우회 시도)');
  f.add(P.enemy, 'flankRadius', 0, 14, 0.5).name('접근 반경');
  f.add(P.enemy, 'probeTurn', 0.2, 3, 0.1).name('막혔을 때 각도 전환');
  f.add(P.enemy, 'probeHold', 0.5, 8, 0.5).name('새 각도 유지(초)');
  f.add(P.enemy, 'drift', 0, 2, 0.05).name('평상시 각도 흐름');
}
{
  const f = gui.addFolder('픽업 (밖에 나갈 이유)');
  f.add(P.pickup, 'interval', 3, 40, 1).name('생성 주기(초)');
  f.add(P.pickup, 'maxOnMap', 1, 12, 1).name('동시 최대 개수');
  f.add(P.pickup, 'minPlayerDist', 4, 30, 1).name('플레이어 최소 거리');
  f.add(P.pickup, 'partsRatio', 0, 1, 0.05).name('부품 비율');
  f.add(P.pickup, 'partsEach', 1, 5, 1).name('부품 상자당 부품');
  f.add(P.pickup, 'cheeseEach', 5, 150, 5).name('치즈 더미당 치즈');
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

{
  const f = gui.addFolder('맵');
  const sel = { map: MAPS[mapIndex].name };
  f.add(sel, 'map', MAPS.map((m) => m.name)).name('맵 선택 (재시작됨)')
    .onChange((name) => setMap(MAPS.findIndex((m) => m.name === name)));
  f.add({ 다시시작: () => restart() }, '다시시작').name('현재 맵 재시작 (R)');
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
  'WASD 이동 · 1~6 건설 선택 → 클릭/Space 설치 (6=철거) · U: 개조 (공방 옆에서)\n' +
  '벽은 무적이다 — 자폭묘의 폭발만이 벽을 없앤다. 벽을 잘 두르는 게 전부\n' +
  '한 방에 죽지 않는다. 공격을 맞아 체력이 다 깎여야 잡힌다 (예비동작 때 피할 것)\n' +
  '많이 잡으면 무리가 몰려온다 — 절제도 실력 · 우클릭: 방어병 이동 명령 · C 카메라 · R 재시작';

let alive = true;
let paused = false;
let survival = 0;
let hudT = 0;
let caughtCount = 0;
let playerStunned = false; // 동료 모드에서 잡힌 상태 — 동료가 와서 깨워야 함
let playerHp = 100;
let allyHp = 100;
let playerHurtT = 99;      // 마지막 피격 후 경과 (재생 시작 판정)
let camShake = 0;
let surgeDone = 0;         // 킬 서지가 몇 번 발동했는지
let grace = 0;   // 구출/시작 직후 짧은 무적 (초)
let flashT = 0;  // 화면 중앙 알림 남은 시간

// 맵을 통째로 다시 만든다. 크기가 바뀌므로 바닥/그리드/림/지형/광맥/스폰을 전부 재생성.
function rebuildWorld(idx) {
  const M = MAPS[idx];
  mapIndex = idx;
  CELLS = M.size;
  HALF = (CELLS * CS) / 2;
  NAV = CELLS * 2;

  // 기존 월드 오브젝트 정리
  for (const b of [...buildings]) destroyBuilding(b, false);
  clearPickups();
  clearGuards();
  clearWorkers();
  for (const ob of [...obstacles.values()]) removeObstacle(ob);
  obstacles.clear();
  for (const n of nodes) { scene.remove(n.mesh); n.mesh.userData.mat.dispose(); }
  nodes.length = 0;
  for (const e of enemies) { scene.remove(e.vis.group); disposeBar(e.bar); }
  enemies.length = 0;

  buildGround(M.floor, M.gridColor);

  // 지형
  const t = layoutTools();
  M.build(t);
  for (const [i, j] of t.cells) addObstacle(i, j, true);

  // 광맥
  for (const [i, j] of M.nodes) {
    const w = cellToWorld(i, j);
    const mesh = makeCheesePile();
    mesh.position.set(w.x, 0, w.z);
    scene.add(mesh);
    nodes.push({ i, j, amount: P.res.nodeAmount, mesh });
  }

  PLAYER_SPAWN = cellToWorld(M.playerSpawn[0], M.playerSpawn[1]);
  ENEMY_SPAWN = cellToWorld(M.enemySpawn[0], M.enemySpawn[1]);

  clearAll = null; // 크기가 바뀌었으므로 이전 필드는 버린다
  refreshClearance();
}

function setMap(idx) {
  rebuildWorld(((idx % MAPS.length) + MAPS.length) % MAPS.length);
  restart();
  flashMsg(`${MAPS[mapIndex].name} — ${MAPS[mapIndex].desc}`, '#6ee07a');
}

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
    n.mesh.userData.mat.color.setHex(0xf0b429);
  }
  clearPickups();
  clearGuards();
  clearWorkers();
  player.carry = 0;
  ally.carry = 0;
  killCount = 0;
  for (const b of [...buildings]) destroyBuilding(b, false);
  parts = 0;
  for (const k of Object.keys(upg)) upg[k] = 0;
  upgOpen = false;
  renderUpgrade();
  stage = 1;
  stageT = 0;
  victory = false;
  growthSpawned = 0;
  playerStunned = false;
  playerHp = P.player.hp;
  allyHp = P.player.hp;
  playerHurtT = 99;
  camShake = 0;
  surgeDone = 0;
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
  for (const e of enemies) { scene.remove(e.vis.group); disposeBar(e.bar); }
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
// 공격을 맞는다 — 체력이 0이 돼야 잡힌다 (한 방 즉사가 아니다)
function hurtHamster(who, dmg) {
  if (who === player) {
    if (grace > 0 || playerStunned) return;
    playerHp -= dmg;
    playerHurtT = 0;
    grace = 0.35;                 // 아주 짧은 피격 무적 — 연타로 순삭되지 않게
    camShake = 0.35;
    if (playerHp <= 0) { playerHp = 0; caught(player); }
  } else {
    if (!ally.active || ally.stunned || allyGrace > 0) return;
    allyHp -= dmg;
    allyGrace = 0.35;
    if (allyHp <= 0) { allyHp = 0; caught(ally); }
  }
}

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
  if (who === player) { playerHp = P.player.hp; playerHurtT = 99; }
  else allyHp = P.player.hp;
  // 원작: 잡히면 지은 것이 전부 소멸하고 깃발만 남는다 (D7).
  // 플레이어가 잡혔을 때만 — 동료는 지은 게 없다.
  if (who === player && P.player.wipeOnCatch) {
    let lost = 0;
    for (const ob of [...obstacles.values()]) if (!ob.bedrock && !ob.bldgRef) { removeObstacle(ob); lost++; }
    for (const b of [...buildings]) destroyBuilding(b, false);
    clearGuards();
    clearWorkers();
    player.carry = 0;
    refreshClearance();
    repathAll();
    if (lost) flashMsg(`잡혔다! 지은 것이 전부 무너졌다 (벽 ${lost}칸)`, '#ff4d4d');
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
    playerHp = P.player.hp;
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

// ---- 업그레이드 패널 (U) ----
const upgEl = document.getElementById('upgrade');
let upgOpen = false;

function buyUpgrade(k) {
  const u = UPGRADES[k];
  if (!u) return;
  if (!nearWorkshop()) { flashMsg('공방 옆에서만 개조할 수 있습니다', '#e05050'); return; }
  const lv = upg[u.key];
  if (lv >= P.upgrade.maxLevel) { flashMsg('이미 최대 레벨입니다', '#e05050'); return; }
  const cost = upgCost(lv);
  if (parts < cost) { flashMsg(`부품이 부족합니다 (${cost} 필요)`, '#e05050'); return; }
  parts -= cost;
  upg[u.key] = lv + 1;
  flashMsg(`${u.label} Lv.${lv + 1}!`, '#8fd6ff');
  renderUpgrade();
}

// 공방 옆(4m)에 서 있어야 개조할 수 있다 — 공방을 지키고 드나들 이유
function nearWorkshop() {
  return buildings.some((b) => b.kind === 'workshop' &&
    Math.hypot(b.cx - player.x, b.cz - player.z) < 4.0);
}

function renderUpgrade() {
  if (!upgOpen) { upgEl.style.display = 'none'; return; }
  upgEl.style.display = 'block';
  const ws = nearWorkshop();
  upgEl.innerHTML =
    `<div class="uhead">개조 (U 닫기) · 부품 ${parts}` +
    (ws ? '' : ' · <span class="warn">공방 옆으로 가세요</span>') + '</div>' +
    UPGRADES.map((u, k) => {
      const lv = upg[u.key];
      const max = lv >= P.upgrade.maxLevel;
      const cost = upgCost(lv);
      const can = ws && !max && parts >= cost;
      return `<div class="urow${can ? '' : ' dim'}">` +
        `<b>${k + 1}</b> ${u.label} <span class="lv">Lv.${lv}/${P.upgrade.maxLevel}</span>` +
        `<span class="cost">${max ? 'MAX' : `부품 ${cost}`}</span>` +
        `<span class="eff">${u.unit()}</span></div>`;
    }).join('');
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


// ---- 동료 AI (자율) ----
//  추종하지 않는다. 스스로 치즈를 캐서 창고에 나르고, 적이 오면 도망치고,
//  플레이어가 기절하면 구조하러 온다. 구조가 끝나면 다시 자기 일로 돌아간다.
let allyGrace = 0;
function updateAlly(dt) {
  if (!ally.active) {
    allyVis.group.visible = false;
    setBar(allyBar, 0, 0, 0, 0, false);
    setBar(allyWorkBar, 0, 0, 0, 0, false);
    return;
  }
  allyVis.group.visible = true;
  if (allyGrace > 0) allyGrace -= dt;

  if (ally.stunned) {
    setBar(allyBar, 0, 0, 0, 0, false);
    setBar(allyWorkBar, 0, 0, 0, 0, false);
    allyVis.group.position.set(ally.x, 0.25, ally.z);
    allyVis.group.rotation.x = -Math.PI / 2;
    allyVis.setOpacity(0.5 + 0.2 * Math.sin(performance.now() * 0.005));
    return;
  }
  allyVis.group.rotation.x = 0;
  allyVis.setOpacity(1);

  // 가장 가까운 적
  let eBest = null, eD = Infinity;
  for (const e of enemies) {
    const dd = Math.hypot(e.x - ally.x, e.z - ally.z);
    if (dd < eD) { eD = dd; eBest = e; }
  }

  // ---- 목표 결정 (우선순위: 구조 > 도망 > 자기 일) ----
  let gx, gz, urgent = false;
  if (playerStunned) {
    ally.mode = '구조';
    urgent = true;
    gx = player.x; gz = player.z;
    // 적이 붙어 있으면 카이팅으로 틈을 만든 뒤 접근
    if (eBest && eD < P.ally.fleeDist * 0.9) {
      const ax = ally.x - eBest.x, az = ally.z - eBest.z;
      const l = Math.hypot(ax, az) || 1;
      gx = clamp(ally.x + (ax / l) * 5 + (player.x - ally.x) * 0.25, -HALF + 1, HALF - 1);
      gz = clamp(ally.z + (az / l) * 5 + (player.z - ally.z) * 0.25, -HALF + 1, HALF - 1);
    }
  } else if (eBest && eD < P.ally.fleeDist) {
    ally.mode = '도망';
    urgent = true;
    const ax = ally.x - eBest.x, az = ally.z - eBest.z;
    const l = Math.hypot(ax, az) || 1;
    gx = clamp(ally.x + (ax / l) * 7, -HALF + 1, HALF - 1);
    gz = clamp(ally.z + (az / l) * 7, -HALF + 1, HALF - 1);
  } else {
    // 자기 일: 볼주머니가 찼으면 창고로, 아니면 치즈더미로
    const job = doCarryWork(ally, dt, P.carry.workerLoad);
    ally.mode = job === 'mine' ? '채굴' : job === 'drop' ? '하역' : '이동';
    const dep = nearestDepot(ally.x, ally.z);
    if (ally.carry > 0 && dep) {
      gx = dep.cx; gz = dep.cz;
    } else {
      // 사람이 덜 붙은 더미를 고른다
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (n.amount <= 0) continue;
        const nw = cellToWorld(n.i, n.j);
        const d = Math.hypot(nw.x - ally.x, nw.z - ally.z) + pileCrowd(n) * 6;
        if (d < bd) { bd = d; best = n; }
      }
      if (best) { const nw = cellToWorld(best.i, best.j); gx = nw.x; gz = nw.z; }
      else if (dep) { gx = dep.cx; gz = dep.cz; }
      else { gx = ally.x; gz = ally.z; }
    }
    if (job) { // 일하는 중이면 그 자리에 선다
      allyVis.group.position.set(ally.x, 0, ally.z);
      allyVis.group.rotation.y = Math.atan2(ally.faceX, ally.faceZ) + Math.PI;
      const f = (ally.carry || 0) / P.carry.workerLoad;
      allyVis.group.scale.setScalar(P.ally.radius * (1 + f * 0.18));
      updateAllyBars(job === 'mine');
      return;
    }
  }

  // ---- 이동 ----
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
    // 회피 조향 — 가까운 적을 밀어내는 벡터를 섞는다
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
  const f = (ally.carry || 0) / P.carry.workerLoad;
  allyVis.group.scale.setScalar(P.ally.radius * (1 + f * 0.18));
  updateAllyBars(false);
}

function updateAllyBars(mining) {
  const y = barY(allyVis);
  setBar(allyBar, allyHp / P.player.hp, ally.x, y, ally.z,
         !ally.stunned && allyHp < P.player.hp - 0.5);
  setBar(allyWorkBar, (ally.mineT || 0) / effMineTime(),
         ally.x, y + (allyBar && allyBar.visible ? 0.26 : 0), ally.z, mining && !ally.stunned);
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
    `[${MAPS[mapIndex].name}] 스테이지 ${stage}/${STAGES.length}` +
    (victory ? ' · 돌파!' : ` — 다음 웨이브까지 ${Math.max(stageDur() - stageT, 0).toFixed(0)}s`) + '\n' +
    `치즈: ${resources.toFixed(0)} · 부품: ${parts} (U 개조) · 창고 ${depotCount()}개 · 일꾼 ${workers.length}` +
    ` · 볼주머니 ${player.carry ? player.carry.toFixed(0) : 0}/${P.carry.playerLoad}` +
    (playerJob === 'mine' ? ' ⛏채굴' : playerJob === 'drop' ? ' 📦하역' : '') +
    (hasWorkshop() ? ' · 공방 ✓' : ' · 공방 없음(3)') +
    (guards.length ? ` · 방어병 ${guards.length}` : '') +
    (killCount ? ` · 처치 ${killCount}` : '') + '\n' +
    (waiting ? '' : `위협 Lv.${lvl} (다음 강화 ${nextIn.toFixed(0)}s)\n`) +
    `체력: ${'█'.repeat(Math.max(0, Math.round(playerHp / P.player.hp * 10)))}${'░'.repeat(10 - Math.max(0, Math.round(playerHp / P.player.hp * 10)))} ${Math.ceil(playerHp)}/${P.player.hp}\n` +
    (ally.active ? `동료: ${ally.stunned ? '기절 — 구하러 가자!' : `${ally.mode} (체력 ${Math.ceil(allyHp)})`}${playerStunned ? ' · 나: 기절!' : ''}\n` : '') +
    `생존: ${survival.toFixed(1)}s · 벽 ${wallCount}개 · 잡힘 ${caughtCount}회` +
    (grace > 0 ? ` · 무적 ${grace.toFixed(1)}s` : '') +
    (paused ? '\n⏸ 일시정지 (P)' : '');
}

// ============================================================
// 초기화 & 루프
// ============================================================
// 체력/작업 바 (makeBar 정의 이후에 만들어야 한다)
playerBar = makeBar(0x5fd07a, 1.1);
playerWorkBar = makeBar(0xf0c040, 1.1);
allyBar = makeBar(0x5fd07a, 1.0);
allyWorkBar = makeBar(0xf0c040, 1.0);
measureTop(playerVis); measureTop(allyVis);

rebuildWorld(mapIndex);      // 지형·광맥·바닥·스폰 생성 + clearance
restart();                   // 동료·스테이지·업그레이드까지 초기 상태로
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
      // 접촉 즉사는 없다 — updateEnemy 안의 공격 로직이 체력을 깎는다
    } else {
      // 등장 대기: 스폰 지점에서 반투명하게 예고
      const t = survival / Math.max(P.enemy.spawnDelay, 0.001);
      for (const e of enemies) {
        e.vis.setOpacity(0.15 + 0.35 * t);
        e.vis.group.position.set(e.x, 0, e.z);
      }
    }
    // 체력 재생 (한동안 안 맞으면 서서히 회복)
    playerHurtT += dt;
    if (!playerStunned && playerHurtT > P.player.regenDelay)
      playerHp = Math.min(playerHp + P.player.regen * dt, P.player.hp);
    if (ally.active && !ally.stunned)
      allyHp = Math.min(allyHp + P.player.regen * 0.6 * dt, P.player.hp);
    if (camShake > 0) camShake -= dt * 2;
    updateStageTimer(dt);
    playerJob = playerStunned ? null : doCarryWork(player, dt, P.carry.playerLoad);
    updateWorkers(dt);
    updateGuards(dt);
    updateProjectiles(dt);
    updateBuildings(dt);
    updateNodes(dt);
    updateCheeseBits(dt);
      updatePickups(dt);
    updateWallPops(dt);
  }
  updateFx(dt);
  updateCamera(dt);
  if (camShake > 0) {
    const c = activeCam();
    c.position.x += (Math.random() - 0.5) * camShake * 0.9;
    c.position.z += (Math.random() - 0.5) * camShake * 0.9;
  }
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
  faceBars();
  renderer.render(scene, activeCam());
}
loop();

// 자동 검증용 디버그 훅
window.__game = {
  P, player, enemies, obstacles, keys, tick, restart, setCamera, addObstacle,
  refreshClearance, planEnemyPath,
  get alive() { return alive; },
  get resources() { return resources; },
  set resources(v) { resources = v; },
  get caughtCount() { return caughtCount; },
  get grace() { return grace; },
  ENEMY_SPAWN, PLAYER_SPAWN,
  snapshotSettings, applySettings, settingsAsSource,
  get DEFAULT_SETTINGS() { return DEFAULT_SETTINGS; },
  get enemyReach() { return enemyReach; },
  nodes, ghost, mouseNDC, CAM_MODES, enemies,
  setEnemyCount, spawnBuildFx, hireWorker, workers, doCarryWork, nearestDepot,
  get playerJob() { return playerJob; },
  buildings, placeBuilding, destroyBuilding, STAGES,
  get stage() { return stage; },
  get stageT() { return stageT; },
  get victory() { return victory; },
  set stageT(v) { stageT = v; },
  advanceStage, stageDur, hasWorkshop, depotCount,
  pickups, spawnPickup, upg, UPGRADES, buyUpgrade,
  guards, projectiles, placeGuard, damageEnemy, topUpToCurve,
  get killCount() { return killCount; },
  get playerHp() { return playerHp; },
  set playerHp(v) { playerHp = v; },
  get allyHp() { return allyHp; },
  hurtHamster, detonate, lobProjectile,
  get selectedGuard() { return selectedGuard; },
  set selectedGuard(v) { selectedGuard = v; },
  get parts() { return parts; }, set parts(v) { parts = v; },
  MAPS, get mapIndex() { return mapIndex; }, setMap,
  ally, updateAlly, caught, gameOver,
  get playerStunned() { return playerStunned; },
  set playerStunned(v) { playerStunned = v; },
  get buildSlot() { return buildSlot; },
  set buildSlot(v) { buildSlot = v; },
  get minedCount() { return minedCount; },
  enemyR, unlockedTypes,
  get fxCount() { return fx.length; },
  get cheeseBitCount() { return cheeseBits.length; },
  get harvestPulse() { return harvestPulse; },
  setMouse(x, y) { mouseNDC.set(x, y); mouseValid = true; },
  threatLevel, enemySpeedOf, enemyDpsOf,
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    faceBars();
    renderer.render(scene, activeCam());
  },
};
