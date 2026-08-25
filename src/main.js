import * as THREE from 'three';
import GUI from 'lil-gui';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { net } from './net.js';

// ============================================================
// 튜닝 파라미터 (GUI로 플레이 중 조절)
// ============================================================
const P = {
  // 한 방에 죽지 않는다 — 공격을 맞아 체력이 다 깎여야 잡힌다 (원작 프로브가
  // 울트라 두 방을 버티던 것). 죽음이 "한순간의 실수"가 아니라 "누적된 실수"가 된다.
  player: { speed: 9.0, radius: 0.26, graceTime: 1.5,
            // 적 본진에 떨궈진 직후의 무적(초). **없으면 즉시 다시 잡힌다** —
            // 떨어지는 자리가 고양이 한복판이라 빠져나올 시간이 필요하다 (D95).
            // 예전엔 기절 상태라 안 맞았는데, AI 동료를 걷어내면서 솔로는 기절하지 않는다.
            respawnGrace: 3.0, hp: 100, regen: 5, regenDelay: 4, wipeOnCatch: 1,
            // 이 거리 안에 고양이가 있으면 가장 가까운 은신처를 바닥에 표시한다 (D55-C)
            safeMarkRange: 18,
            // 은신처로 인정하려면 적 도달 영역에서 이만큼 떨어져 있어야 한다(m).
            // 대략 공격 사거리(hr+attackRange)만큼 — 벽 옆 한 칸이 은신처로 잡히면 안 된다
            safeMargin: 1.8,
            // 앞구르기 (D77) — Shift. 구르는 동안 **무적**이라, 적의 예비동작이
            // 끝나기 전에 쓰면 회피가 된다. 쿨다운이 회피의 값이다.
            // 구르기는 **스태미너**로 산다 (D81). 쿨다운만 있으면 리듬만 맞추면
            // 무한히 구를 수 있었다. 총량이 있으면 "언제 쓸지"가 결정이 된다.
            rollDist: 4.2, rollTime: 0.28, rollCool: 0.35,
            stamMax: 100, stamRoll: 34, stamRegen: 13, stamDelay: 0.9,
            // 내 영토 위에서는 기운이 이 배율로 더 빨리 찬다 (D86).
            // 영토의 유일한 실이익 — 일부러 소소하게 뒀다. "쫓기다 내 땅으로 뛰어들면
            // 숨을 돌린다"는 감각만 주고, 경제에는 손대지 않는다(웅크리기를 조장하지 않게).
            terrStamMul: 2.2 },
  enemy: {
    count: 3,              // 시작 마릿수 (전부 순찰묘)
    attackRange: 0.9, repath: 0.35,
    // A* 한 번에 펼칠 수 있는 최대 칸 수 (D79). 도달 불가 목표는 맵 전체를
    // 훑으므로 상한이 없으면 후반에 프레임이 무너진다. 넘으면 최선 근사 경로를 쓴다
    pathBudget: 5000,
    spawnDelay: 12,
    spread: 7.5,           // 스폰 지점 주변에 흩어지는 반경
    aggroRange: 10.5,       // 추격 중 이 거리 안의 건물에 한눈팔 수 있음
    aggroChance: 0.35,     // 경로 재계산 때 한눈팔 확률
    aggroTime: 4.0,        // 한 번 끌리면 이 시간 동안 유지
    flankRadius: 8.25,      // 목표 둘레 이 반경의 지점을 노리고 접근한다
    probeTurn: 1.1,        // 막혔을 때 접근각을 돌리는 크기(라디안)
    probeHold: 2.5,        // 새 접근각을 유지하는 시간(초)
    drift: 0.55,           // 포위 링 전체가 목표 둘레를 도는 속도(라디안/초)
    // 벽에 붙은 목표를 한쪽에서 밀지 말고 **둘러싸고 돌게** 하는 값들 (D49)
    circleTurn: 0.9,       // 막혀 있는 동안 제 슬롯에서 더 밀어붙이는 속도(라디안/초)
    crowdAvoid: 0.45,      // 이미 그 햄스터에 붙은 적 1마리 = 거리 몇 m 상당인가 (×10m)
    targetHold: 3.0,       // 한 번 정한 목표를 유지하는 시간(초) — 갈팡질팡 방지
    // 같은 목표를 1초 더 쫓을 때마다 그 목표가 몇 m 더 멀어 보이는가 (D91).
    // 0이면 예전 동작(한 번 몰리면 계속 몰림). 실측상 0.6은 너무 약해서
    // 25m 차이에서 76:24가 그대로였고, 1.2에서야 55:45로 갈렸다.
    switchPush: 1.2,
    switchCap: 25,          // 피로 상한(m) — 무한히 커지지 않게
    // 이 거리 안이면 피로를 적용하지 않는다 = "잡기 직전엔 안 버린다".
    // **기본 0(끔)이다.** 8로 켜 봤더니 정확히 반대 효과가 났다 — 지적된 "한 명에게
    // 몰린다"의 실체가 **2~3m에서 둘러싸고 도는 상태**(포위 링, D49)라, 붙어 있는 목표를
    // 봐주면 몰림이 그대로 유지된다(쏠림 63%→73%로 오히려 악화). 몰림을 풀려면
    // 붙어 있는 놈도 갈아타야 한다. 실제로 버리는 그림이 이상해 보이면 3~5로 올릴 것.
    engageDist: 0,
    // ---- 지능 (D55) ----
    campTime: 7.0,         // 닿을 길이 없을 때 틈 앞에 자리 잡고 기다리는 시간(초). 0=끔
    memoryTime: 8.0,       // "마지막으로 닿았던 자리"를 기억하는 시간(초)
    leadTime: 0.45,        // 목표의 이동 방향 앞을 노리는 정도(초). 0=현재 위치만
    cutoffShare: 0.34,     // 무리 중 이 비율은 목표가 아니라 **은신처로 가는 길**을 막는다
    cutoffLead: 3.3,       // 차단조가 목표보다 얼마나 앞(은신처 쪽)을 잡는가(m)
    giveUpProbes: 3,       // 이만큼 시도해도 막히면 포기하고 서성인다
    prowlTime: 4.0,        // 서성이는 시간 — 플레이어가 확장을 시도할 틈
    attackWindup: 0.6,     // 공격 예비동작 — 이 동안 몸을 뒤로 빼며 부푼다.
                           //  Shift 구르기로 피할 수 있는 창이다 (D77·D78)
    attackCooldown: 1.3,   // 공격 간격
    // 추격 중인데 이만큼 **한 대도 못 때리면** 목표를 포기하고 건물을 습격한다 (D85).
    // 이게 없으면 은신처 둘레에 뭉쳐 서서 아무것도 안 하는 무리가 된다 —
    // 숨어 있는 게 안전할 수는 있어도 **공짜여서는 안 된다.** 숨으면 살림이 뜯긴다.
    raidPatience: 6.0,
  },
  // 순찰조 (D52) — 웨이브와 별개로 **맵에 상주하는** 고양이.
  // 제 초소 둘레를 돌다가 햄스터를 발견하면 쫓고, 시간이 지나면 초소로 돌아간다.
  // 목적은 "빈 땅이 안전하지 않게" 만드는 것 — 새 더미 확보와 구출 원정을 방해한다.
  // 초소는 맵 전역에 흩어야 한다. 한 구역에 몰리면 나머지 절반이 무주공산이 된다.
  patrol: {
    count: 3,           // 순찰조 마릿수 (재시작부터)
    radius: 10.5,       // 초소 둘레를 도는 반경
    turn: 0.30,         // 도는 속도(라디안/초)
    sight: 16.5,        // 햄스터를 발견하는 거리
    chaseTime: 9.0,     // 발견 후 쫓는 시간(초) — 지나면 초소로 복귀
    leash: 33.0,        // 초소에서 이만큼 벗어나면 무조건 복귀 (시간만으로는 못 끊는다)
    leashCool: 4.0,     // 줄이 끊긴 뒤 다시 발각되지 않는 시간(초)
    postSpread: 0.62,   // 초소를 맵 반지름의 몇 배 위치에 둘지
    minFromSpawn: 24,   // 내 시작 지점에서 최소 이만큼 떨어뜨린다
  },
  // 동료는 경제 활동을 하지 않는다. 벽으로 은신처를 만들어 살아남고,
  // 내가 기절하면 구하러 온다. 그게 전부다 (멀티 구출 루프의 시험용).
  // 동료 슬롯 — **사람이 앉는 자리다** (D95에서 AI를 걷어냈다). 남은 건 몸집뿐.
  ally: { radius: 0.35 },
  // 2인 협동 (D95)
  coop: {
    // 적을 인원수에 맞춰 늘린다. 안 늘리면 표적만 둘이 되어 **2인이 1인보다 쉽다** —
    // 어그로가 갈리니 1.0배는 곧 "한 명당 절반"이다. 1.8이면 대략 1인과 같은 압박.
    enemyScale: 1.8,
    // 잡히면 이 시간 안에 동료가 터치하면 **소멸이 취소된다** (0이면 즉시 소멸 = 솔로와 같음).
    // D7의 "죽음의 사회성"에 처음으로 실제 이해관계를 붙이는 값이다.
    wipeGrace: 20,
    // ---- 건네주기 (D96) ----
    // 살림은 각자다(D43). 대신 **가까이 붙어야만** 옮길 수 있게 해서
    // 두 경제가 합쳐지지 않고 *거래*하게 만든다 — 주러 가는 것 자체가 위험이다.
    giveRange: 2.6,
    giveCheese: 20,    // 한 번에 넘기는 치즈
    giveParts: 1,      // 한 번에 넘기는 부품
    // ---- 도발 (D96) ----
    // 이 게임에서 플레이어는 공격 수단이 없다. 그래서 적에게 할 수 있는 유일한 기여가
    // **"내가 끌기"**다. 춤추는 동안 못 움직이는 게 그 대가다.
    tauntTime: 1.5,    // 춤추는 시간 (그동안 이동 불가 = 무방비)
    tauntCool: 8,      // 재사용 대기
    tauntRange: 18,    // 이 거리 안의 적만 끌린다
    tauntPull: 40,     // 목표 점수에서 빼는 값(m 상당). 클수록 강하게 끌린다
  },
  // ---- 적 3종 ----
  // 통행권(=반지름)과 벽 공격 가능 여부가 종류를 가른다.
  // **크기 기준선 (D74)**: 기둥을 1칸 띄워 세우면 틈이 2.0m다.
  //   순찰묘 지름 1.9 → **들어온다.** 촘촘히(붙여) 세워야 진짜 벽이 된다
  //   날쌘묘 1.26  → 대각 관문(1.12)은 못 지나지만 그 외엔 거의 다 통과
  //   자폭묘 2.3   → 1칸 띄움도 막힌다. 대신 벽을 부순다
  //  순찰묘: 크고 벽 못 부숨 → 벽이 완전한 안전을 줌. 처음부터 등장
  //  날쌘묘: 작고 빠름, 벽 못 부숨 → 2칸 틈을 통과! 넓은 틈의 안전이 깨짐
  //  파괴묘: 제일 크고 느림, 유일하게 벽을 부숨 → 밀폐도 시한부가 됨
  // bldgDps: 건물(창고/공방) 공격력 — 모든 종류가 건물은 부술 수 있다 (원작:
  //          무적 파일런은 못 부숴도 넥서스/생산 건물은 부서짐)
  // hp가 높다 — 처치하려면 탑/방어병에 실제로 투자해야 한다.
  // reward = 처치 시 주는 치즈.
  // dmg = 플레이어/동료에게 한 방에 주는 피해
  chaser: { radius: 0.95, speed: 7.5, bldgDps: 24, hp: 1300, reward: 6, dmg: 34 },
  runner: { radius: 0.63, speed: 10.2, bldgDps: 16, hp: 750, reward: 4, dmg: 20 },
  // 자폭고양이 — 벽을 부술 수 있는 유일한 존재. 벽에 붙으면 터지고 자기도 죽는다.
  // 자폭묘는 느리다 — 다가오는 걸 보고 미리 처리하거나 피할 수 있어야 한다
  bomber: { radius: 1.15, speed: 3.9, bldgDps: 40, hp: 1000, reward: 10, dmg: 45,
            blastRadius: 2.55, fuse: 0.9 },
  // 보스 "톰" — 10스테이지에 쳐들어온다 (D83). 위협 레벨 스케일링에서 제외된
  // 고정 스탯으로 승부한다 (typeMaxHp·건물 dps 가산 둘 다 boss는 예외 처리).
  // canBreak는 자폭묘처럼 자폭하지 않고, 쿨다운마다 막힌 벽 하나를 강타해 부순다
  // (smashCooldown·smashWindup) — 이 전투 한정으로만 벽의 무적성(D30)에 예외를 둔다.
  boss: { radius: 1.75, speed: 3.2, bldgDps: 60, hp: 6000, reward: 0, dmg: 55,
          smashCooldown: 8.0, smashWindup: 0.9,
          // 강타 **몇 번**에 벽이 무너지는가 (D99). 한 방이면 벽을 세우는 행위가
          // 보스 앞에서 무의미해진다 — 한 번 맞고 금이 간 벽은 아직 막고 있으므로
          // "고칠 것인가 물러설 것인가"를 고를 시간이 생긴다.
          smashHits: 2 },
  // 벽은 무적이다 (원작 파일런). 부수는 건 자폭고양이의 폭발뿐.
  // 대신 비싸다 — 비용이 곧 "얼마나 넓게 두를 것인가"의 제약.
  // post = 벽 **원기둥의 지름** (D57·D59·D74). 셀(1.5)보다 작아서 틈이 생긴다:
  //   직교로 붙이면 틈 1.5-1.0 = 0.5    → 플레이어(지름 0.52)도 못 지나감 = 진짜 벽
  //   대각으로 붙이면 √2×1.5-1.0 = 1.12 → **플레이어만 통과**. 여유가 양쪽 0.30m씩
  //   1칸 띄워 세우면 3.0-1.0 = 2.0     → **순찰묘(2.0)도 비집고 들어온다** (D74)
  // post는 셀 크기가 아니라 **플레이어 지름에 묶여 있다**:
  //   틈(CS-post) < 몸 < 관문(√2·CS-post) → post ∈ (CS-몸, √2·CS-몸)
  // 몸을 줄이면 관문/몸 비율이 커져서 **틈 통과가 수월해진다** — 그래서 0.35→0.26.
  // 원작 파일런의 성질이 여기서 나온다: 벽은 문이 아니라 체(sieve)다.
  // 벽은 **가서·바라보고·잠깐 서서** 짓는다 (D58, 원작 프로브).
  //  range 2.0 = 이 안에서만 지어진다 (D69). **자동 이동은 접었다.**
  //   3.2(두 칸)로 늘렸더니 은신처 안에서 안전하게 벽을 늘려갈 수 있게 됐다 —
  //   "위험을 감수하고 빼꼼 나와 확장한다"가 통째로 사라졌다.
  //   2.0이면 은신처 중심(기둥 1.5m)에서 그 너머 칸에 못 닿아, 관문까지 나와야 한다.
  //   자리 잡는 건 플레이어가 WASD로 한다. 자동으로 걸어가 주지 않는다.
  //  castTime 0.3초 = 아주 짧지만 **무방비인 시간**. 이동하면 즉시 취소된다.
  //  벽 뒤에서 잠깐 나와야 하므로, 컨트롤을 놓치면 그 틈에 맞는다 — 그게 목적이다.
  //  crackMax = 자폭묘 폭발을 **몇 번까지 버티는가** (D90). 예전엔 한 방에 사라졌다.
  //   폭발은 벽을 없애는 대신 **금을 낸다.** crackMax번까지는 버티고, 그 다음 폭발에 무너진다.
  //   금 간 벽은 **F로 수리**한다 (repairCost). 자폭묘 하나로 방어선이 뚫리던 걸 막고,
  //   대신 "터진 자리를 제때 메우는" 유지 노동을 만든다.
  wall: { cost: 1, removeCost: 1, cooldown: 0.05, height: 2.0, range: 2.0, post: 1.0,
          castTime: 0.3, crackMax: 2, repairCost: 2 },
  // 건물 — 원작의 "넥서스 지을 공간이 필요하다"의 이식.
  // 2x2 발자국이라 광맥을 벽 4개로 두르는 최소 확보가 불가능해지고,
  // 채굴하려면 광맥 곁에 건물이 들어갈 공터까지 함께 감싸야 한다.
  // 건물은 약하다 — 적이 오래 붙들려 있지 않고 금방 정리하고 플레이어에게 온다
  // 치즈 창고 — 치즈를 부리는 곳. 더미에서 일정 거리 떨어뜨려야 지어진다
  // (붙여 지으면 채굴 사거리와 하역 사거리가 겹쳐 '나르는 행위'가 사라진다)
  depot: { cost: 0, hp: 130, dropRange: 4.2, minPileDist: 6.0 },
  // 볼주머니 채굴 (원작 프로브) — 치즈더미에서 캐서 창고까지 날라야 잔고가 된다
  // 스타크래프트 프로브와 같은 리듬: 더미에 붙어 한 짐을 캐고(시간 소요),
  // 창고까지 걸어가서 한 번에 부린다. 왕복 자체가 게임의 박자다.
  // 한 짐은 **작다**. 한 번 왕복해서 벽 하나를 뽑던 시절엔 채굴이 너무 싸서
  // 왕복이 의미를 잃었다 (2026-08-13, 기존의 20% 수준으로 너프).
  // 대신 더미 매장량을 3배로 늘려 "더미가 금방 마른다"는 부작용을 막았다.
  carry: {
    playerLoad: 3, workerLoad: 2,
    mineTime: 1.6,      // 한 짐을 캐는 데 걸리는 시간(초)
    range: 3.3,         // 치즈더미에 붙어야 하는 거리
  },
  worker: {
    cost: 50, speed: 6.9, radius: 0.3,   // 50 = 가장 먼저 뽑는 것이라 값을 올렸다 (D88)
    perPile: 3,         // 치즈더미 하나에 붙을 수 있는 일꾼 수
    max: 12,
  },
  // 채굴 명령 (원작 프로브 조작) — 더미에 명령을 걸면 알아서 왕복한다.
  //  플레이어: 가까이 가면 뜨는 E, 또는 더미 우클릭. **직접 움직이면 즉시 취소**
  //  일꾼: 드래그 상자 선택(Shift 또는 일꾼 위에서 시작) → 더미 우클릭
  command: {
    promptRange: 6.75,  // 이 거리 안에 더미가 있으면 머리 위에 'E' 안내가 뜬다
    pickRange: 2.7,     // 우클릭이 치즈더미를 집는 허용 반경(m)
    pickPx: 46,         // 유닛을 집는 허용 반경(화면 픽셀) — 카메라 각도와 무관하게
    dragMin: 7,         // 상자 선택으로 인정하는 최소 드래그(픽셀)
  },
  // 공방 — 유일한 기술 구조물(D82). 새 건물을 더 짓는 게 아니라 **제자리에서
  // 레벨업**해서 2차/3차 기술을 연다 (칸수는 늘 2x2). 근처(4m)에서 F로 업그레이드.
  //  tier1(짓자마자): 경비탑 1차 + 근접병   tier2: 경비탑 2차 + 사수   tier3: 경비탑 3차 + 정예병
  // 게이트는 "그 tier 공방이 지금 실존하는가" — 부서지면 즉시 재잠김
  // (U패널 개조처럼 영구 해금이 아니다 — 확인된 설계 선택. 02문서 D82 참고).
  //
  // **공방 업그레이드만 부품을 함께 요구한다** (D84). 부품은 밖에 떨어지는 픽업으로만
  // 얻으므로(안전지대 안에는 절대 안 생김), 기술을 올리려면 반드시 밖에 나가야 한다.
  // 치즈는 안에서 벌 수 있어도 부품은 못 번다 = 웅크리기로는 테크가 안 올라간다.
  // 경비탑 업그레이드는 치즈만 든다 — 부품 관문은 기술 트리의 뿌리(공방)에만 건다.
  workshop: { cost: 15, hp: 100,
              tier2Cost: 80, tier2Parts: 2, tier2Time: 2.5,
              tier3Cost: 250, tier3Parts: 5, tier3Time: 3.5 },
  // 경비탑 — 원작 포토캐논. 던진다. 2x2 고정, 3단계 제자리 업그레이드(D82).
  //  t1(배치 시 기본): 약하고 저렴 — 좁은 구간을 값싸게 메우는 용도
  //  t2(업그레이드): 지금까지의 기본값 그대로. t3(업그레이드): 겁나 세고 겁나 비쌈
  // cost는 t2/t3에서는 "배치값"이 아니라 "그 등급으로 올리는 업그레이드값"이다.
  tower: {
    t1Cost: 20, t1Hp: 70, t1Range: 8.0, t1Dmg: 14, t1Reload: 1.1,
    t2Cost: 60, t2Hp: 110, t2Range: 10.5, t2Dmg: 30, t2Reload: 1.0,
    t3Cost: 1000, t3Hp: 500, t3Range: 16.0, t3Dmg: 130, t3Reload: 0.8,
  },
  // 건물 건설 — 짓는 동안 플레이어는 그 자리에 묶인다 (무방비).
  // ESC로 중단하면 짓던 건물이 펑 터지며 사라지고 자원은 돌려받는다.
  // 경비탑 업그레이드(t1→2, t2→3)도 같은 무방비 채널링을 쓴다.
  //
  // inset = 건물 **충돌 상자**를 셀 경계에서 이만큼 안으로 들인다 (D84).
  // 벽 기둥(D57)이 셀보다 작아서 대각 관문이 생기는 것과 똑같은 원리를 건물에도 준다:
  //   대각으로 붙인 두 건물 사이 = √2 × 2×inset = 0.85m → **플레이어(0.52)만 통과**
  //   (날쌘묘 1.26 · 순찰묘 1.9는 여전히 막힘)
  // 부수 효과: 직교로 1칸 띄운 건물 사이가 1.5 → 2.1m가 되어 순찰묘가 통과한다.
  // 이건 의도한 것이다 — D20의 "건물은 벽의 대용품이 아니다"를 물리로 강제한다.
  // 지형(bedrock)은 그대로 셀을 꽉 채운다. 길찾기 격자도 안 건드렸다 —
  // 새 통행권은 D57과 같이 **물리로 직접 움직이는 플레이어에게만** 생긴다.
  // refundRatio = X 철거로 건물을 부술 때 되찾는 비율 (D90).
  //  건물은 잘못 놓으면 되돌릴 방법이 없었다. 절반을 돌려주면 "옮기자"가 실제 선택이 된다.
  build: { depotTime: 3.0, workshopTime: 3.5, towerTime: 4.0, towerUp2Time: 3.0, towerUp3Time: 4.0,
           inset: 0.3, refundRatio: 0.5 },
  // 방어병 3종 (D51) — 타일에 배치하고 우클릭으로 재배치 명령.
  //  사수  : D29 그대로. 체력 0 = 적과 닿으면 즉사. 벽 뒤에 세워야만 쓸모가 있다
  //  근접병: 체력이 있어 붙어서 버틴다. 사거리가 짧아 몸으로 막는 역할
  //  정예병: 체력이 높아 잘 안 죽는다. 비싸다 — 벽 없이 버티는 값이다
  guard: {
    archerCost: 25, archerRange: 10.5, archerDmg: 26, archerReload: 1.1,
    meleeCost: 30, meleeHp: 90, meleeRange: 1.35, meleeDmg: 34, meleeReload: 0.9,
    eliteCost: 60, eliteHp: 260, eliteRange: 9.0, eliteDmg: 30, eliteReload: 1.0,
    speed: 7.8, radius: 0.35,
    max: 12,
    // 자폭묘를 얼마나 우선해서 때리는가 (1보다 작을수록 우선. 0.4 = 2.5배 가깝게 친다)
    bomberBias: 0.4,
    // 병력이 늘수록 다음 한 명이 비싸진다 (D56) — 치즈→병력→처치→치즈 눈덩이를 끊는다
    costGrowth: 0.15,
  },
  res: {
    // 시작 치즈는 **개수로 직접** 정한다. 예전엔 '벽 N개분'(startWalls × wallCost)이라
    // 벽값을 만질 때마다 시작 자금이 같이 흔들렸다 (벽값 1로 내리니 10치즈가 됐다).
    start: 40,
    startWalls: 10, wallCost: 5,   // (구값 — 지금은 안 쓴다)
    // 치즈더미는 유한하고 다시 차지 않는다. 바닥나면 새 더미를 확보하러 나가야 한다
    // = 영역 확장 압박 (01 문서의 "공간 욕심 vs 벽 길이")
    nodeAmount: 2700,
    // 치즈 지출에 곱해지는 배율 (D88). 값을 하나하나 고치는 대신 지출 지점에서
    // 곱한다 — 기본값을 읽을 수 있게 유지하고, 슬라이더 하나로 전체 물가를 조절한다.
    // **벽과 철거는 여기서 빠진다** (D89) — 벽값은 D62에서 "아껴 쓰는 자원이 아니라
    // 흘리듯 쓰는 동사"로 만들려고 일부러 1로 내린 값이다. 물가 1.5배에 벽까지 태우면
    // 2가 되어(=2배, 이 게임에서 가장 큰 상대 인상폭) 그 의도가 정면으로 깨진다.
    // 물가 인상의 대상은 건물·병력이다 — 벽은 언제나 쉽게 세워져야 한다.
    costScale: 1.5,
    // **영토 면적당 초당 치즈** (D88 실험). 치즈더미 없이 숨어 있어도 소량은 모인다.
    //  ⚠ 위험을 알고 넣은 값이다: D36이 자동 수입(D22)을 없앤 이유가
    //    "경제가 공간과 무관해졌다"였다. 여기서는 **면적에 비례**하므로 반대로
    //    "넓혀야 번다"가 되지만, 너무 크면 채굴 왕복(D36·D41·D53)이 무의미해진다.
    //  기준: 0.003 × 272㎡(13x13 링) ≈ 0.82/s. 일꾼 3명 채굴이 3.2/s이므로 그 1/4 수준.
    //  0으로 두면 이 시스템이 꺼진다.
    terrIncome: 0.003,
  },
  // 부품 — 밖에 흩어진 픽업으로만 얻는다. 업그레이드 전용 화폐.
  // **후반 대응 수단이 여기 걸려 있다** (D87): 적은 스테이지마다 체력이 오르는데
  // (threat.hpGain) 낮은 등급 타워·병력의 화력은 그대로라, 적의 자연회복(초당 2%)조차
  // 못 넘기고 영원히 못 죽이는 구간이 생긴다. 그걸 넘길 유일한 수단이 부품 업그레이드고,
  // 부품은 **적 도달 영역에만** 떨어지므로 결국 밖으로 나가 돌아다녀야 한다.
  // 그래서 스테이지가 오를수록 픽업이 더 자주·더 많이 나온다 — 나갈 값어치가 커진다.
  pickup: {
    interval: 14,        // 새 픽업이 생기는 주기(초)
    stageSpeedup: 0.9,   // 스테이지당 주기 단축(초). 최소 4초까지
    maxOnMap: 5,         // 동시에 존재할 수 있는 최대 개수
    stageOnMap: 0.4,     // 스테이지당 동시 최대 개수 +
    minPlayerDist: 21,   // 플레이어에게서 이만큼 떨어진 곳에만 생성 (= 위험을 감수해야 함)
    partsEach: 1,        // 부품 상자 하나당 부품
    stageParts: 0.34,    // 스테이지당 상자당 부품 + (3스테이지마다 +1)
    cheeseEach: 35,      // 치즈 더미 하나당 치즈
    partsRatio: 0.6,     // 부품 상자가 나올 확률
  },
  // 업그레이드 (부품으로 구매, 공방 필요) — 레벨당 증가폭.
  // **후반의 유일한 화력 대응 수단**이다 (D87). 적 체력은 스테이지마다 오르는데
  // 타워·병력의 기본 화력은 고정이라, 화력 업그레이드 없이는 자연회복도 못 넘긴다.
  // maxLevel을 8로 올린 건 후반에 부품을 쏟아부을 곳이 남아 있어야 하기 때문이다
  // (비용이 레벨당 누진이라 8레벨은 부품 8개 — 아무렇게나 못 찍는다).
  upgrade: {
    maxLevel: 8,
    baseCost: 1, costStep: 1,   // n레벨 비용 = baseCost + costStep * n
    // 부품 → 치즈 환전 (D100). 후반에 부품 수급이 소모처를 넘어선다 —
    // 10스테이지 한 판에만 30개가 들어오는데 그때는 살 게 남아 있지 않다.
    // sellTier 이상 공방이 있어야 열린다: 기술을 다 올린 사람만 쓰는 출구다.
    sellRate: 1000,             // 부품 1개당 치즈
    sellTier: 3,                // 필요한 공방 등급
    speedStep: 0.9,             // 햄스터 이동 속도
    radiusStep: 0.2,            // 채굴 시간 단축(초)
    towerStep: 9,               // 경비탑 화력
    guardStep: 8,               // 방어병 화력 (사수·근접병·정예병 전부)
  },
  // 모든 이동 속도에 곱해지는 배율 (D56).
  // 사람도 고양이도 같이 느려지므로 **상대 속도 관계는 그대로**고 템포만 내려간다.
  // 술래잡기의 판단 시간을 벌어주는 값이라, 손맛에 가장 크게 영향을 준다.
  tempo: { moveScale: 0.75 },
  threat: {
    // speedGain 0 = 후반에도 더 빨라지지 않는다 (2026-08-13).
    // 체력·공격력만 오른다 — 빨라지는 건 "피할 수 없다"가 되어 술래잡기를 깨뜨린다
    interval: 30, speedGain: 0, dpsGain: 6, everyLevels: 0, hpGain: 120,
    // 속도는 상한을 둔다 — 적이 플레이어보다 빨라지면 술래잡기가 아니게 된다
    speedCap: 10.8,
    // 원작의 탐욕 페널티: 일정 수를 잡으면 그때 우루루 쏟아진다
    killsPerSurge: 6, surgeSize: 3,
  },
  // 2P 접속 (D92). 솔로에서는 아무 영향이 없다.
  //  rate        스냅샷 초당 횟수. 실측 ~705B/스냅샷이라 20이면 ~14KB/s
  //  interpDelay 원격 개체를 이만큼 과거로 그린다(초). 지터를 흡수하는 대신 그만큼 늦게 보인다
  //  smoothMax   예측 오차를 이 거리(m) 안에서는 부드럽게 당긴다. 넘으면 즉시 스냅
  //              (잡힘·구출처럼 순간이동에 가까운 사건은 부드럽게 끌면 오히려 이상하다)
  //  fakeLag     인위적 편도 지연(ms) — 손맛 A/B용. Chrome 스로틀은 WebRTC에 안 걸린다
  net: { rate: 20, interpDelay: 0.10, smoothMax: 1.5, fakeLag: 0 },
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
// 숫자키 1~8로 선택하고 클릭/Space로 짓는다. **유닛은 Enter로 뽑는다** (D88).
// 순서는 **실제로 짓는 순서**다 (D88): 벽 → 창고 → 일꾼 → 공방 → 그 뒤로 기술이 열린다.
// 철거는 슬롯에서 뺐다 — X키 전용이다 (슬롯 하나를 늘 잡아먹을 만한 행동이 아니다).
// need: 이 슬롯을 쓰려면 필요한 공방 등급 (0 = 조건 없음). D82의 기술 트리를 핫바에 그대로 비춘다.
const BUILD_SLOTS = [
  { key: 'wall', label: '벽', size: 1, need: 0, cost: () => P.wall.cost },
  { key: 'depot', label: '치즈 창고', size: 2, need: 0, cost: () => cheeseCost(P.depot.cost) },
  { key: 'worker', label: '일꾼 고용', size: 1, need: 0, cost: () => cheeseCost(P.worker.cost) },
  { key: 'workshop', label: '공방', size: 2, need: 0, cost: () => cheeseCost(P.workshop.cost) },
  { key: 'tower', label: '경비탑', size: 2, need: 1, cost: () => cheeseCost(TOWER_TIERS[1].cost()) },
  { key: 'melee', label: '근접병', size: 1, need: 1, cost: () => guardCost('melee', localPlayer().owner) },
  { key: 'archer', label: '사수', size: 1, need: 2, cost: () => guardCost('archer', localPlayer().owner) },
  { key: 'elite', label: '정예병', size: 1, need: 3, cost: () => guardCost('elite', localPlayer().owner) },
];

// 잠긴 이유 (없으면 null) — 핫바와 실제 거부 판정이 같은 함수를 본다
const slotLockReason = (sl) =>
  sl.need > 0 && maxWorkshopTier() < sl.need
    ? (sl.need === 1 ? '공방 필요' : `공방 Lv.${sl.need} 필요`)
    : null;
// 유닛 슬롯 = 자리를 안 찍고 내 옆에서 나오는 것들 (Enter로 생산)
const isUnitSlot = (sl) => !!sl && (sl.key === 'worker' || !!GUARD_TYPES[sl.key]);

// 건물·병력의 치즈 지출은 이 함수를 통과한다 (D88) — 슬라이더 하나로 전체 물가를 조절한다.
// 기본값을 하나하나 고치지 않으므로 "원래 값이 뭐였나"가 소스에 그대로 남는다.
// **벽/철거는 통과시키지 않는다** (D89) — 벽은 늘 값이 1이어야 한다. P.res.costScale 주석 참고.
const cheeseCost = (base) => Math.round(base * P.res.costScale);

// 다음 한 명의 값 — **병종별로 따로** 이미 거느린 수만큼 비싸진다 (D56 → 병종별 분리).
// 예전엔 guards.length(3종 합산)를 봐서 사수 하나 사면 근접병·정예병 값도 같이 올랐다.
const guardCost = (type, owner = 'p') =>
  cheeseCost(GUARD_TYPES[type].cost() *
    Math.pow(1 + P.guard.costGrowth, guards.filter((g) => g.type === type && g.owner === owner).length));
// 방어병 정원도 소유자별이다 (D92-2단계) — 예전엔 guards 전체를 세서
// P2가 뽑는 만큼 P1의 정원이 줄었다
const guardsOf = (owner) => guards.filter((g) => g.owner === owner);

// 공방이 지금 실존하는 최고 tier (0 = 공방 없음). 여러 채 지어도 최고 하나만 있으면
// 통과 — 그 공방이 부서져도 다른 공방이 남아 있으면 해금이 유지된다.
// "실존해야 생산 가능"이 확정 규칙이라(D82), 부서지면 이 값이 즉시 내려간다.
const maxWorkshopTier = () =>
  buildings.reduce((m, b) => (b.kind === 'workshop' && b.tier > m ? b.tier : m), 0);

// 방어병 병종 (D51) — 값은 전부 P.guard에서 읽는다 (튜닝 슬라이더와 세팅 스냅샷 때문).
// reqTier: 이 병종을 뽑으려면 공방이 최소 이 등급이어야 한다 (D82 기술 트리).
const GUARD_TYPES = {
  archer: { label: '사수', body: 0x5f7f3f, helm: 0x44502f, radius: () => P.guard.radius,
            cost: () => P.guard.archerCost, hp: () => 0, melee: false, reqTier: 2,
            range: () => P.guard.archerRange, dmg: () => P.guard.archerDmg,
            reload: () => P.guard.archerReload },
  melee:  { label: '근접병', body: 0x8a5a2b, helm: 0x5c3a18, radius: () => P.guard.radius * 1.15,
            cost: () => P.guard.meleeCost, hp: () => P.guard.meleeHp, melee: true, reqTier: 1,
            range: () => P.guard.meleeRange, dmg: () => P.guard.meleeDmg,
            reload: () => P.guard.meleeReload },
  elite:  { label: '정예병', body: 0x5a6f9f, helm: 0x3c4260, radius: () => P.guard.radius * 1.35,
            cost: () => P.guard.eliteCost, hp: () => P.guard.eliteHp, melee: false, reqTier: 3,
            range: () => P.guard.eliteRange, dmg: () => P.guard.eliteDmg,
            reload: () => P.guard.eliteReload },
};

// 경비탑 3단계 (D82) — 값은 전부 P.tower에서 읽는다. cost는 tier1=배치값,
// tier2/3=그 등급으로 올리는 업그레이드값이다. 칸수는 항상 2x2 — 등급은 제자리에서 오른다.
const TOWER_TIERS = {
  1: { cost: () => P.tower.t1Cost, hp: () => P.tower.t1Hp, range: () => P.tower.t1Range,
       dmg: () => P.tower.t1Dmg, reload: () => P.tower.t1Reload, time: () => 0 },
  2: { cost: () => P.tower.t2Cost, hp: () => P.tower.t2Hp, range: () => P.tower.t2Range,
       dmg: () => P.tower.t2Dmg, reload: () => P.tower.t2Reload, time: () => P.build.towerUp2Time },
  3: { cost: () => P.tower.t3Cost, hp: () => P.tower.t3Hp, range: () => P.tower.t3Range,
       dmg: () => P.tower.t3Dmg, reload: () => P.tower.t3Reload, time: () => P.build.towerUp3Time },
};
// -1 = 아무것도 안 들고 있음 (기본값).
// 숫자키로 들고, ESC로 내려놓는다 — 손에 뭔가 들려 있는 상태가 "예외"여야
// 좌클릭이 실수로 벽을 흘리지 않는다.
let buildSlot = -1;
let prevWantBuild = false;
let prevWantSpawn = false;
// 철거는 핫바 슬롯이 아니라 별도 모드다 (D88) — X로 켜고 끈다
let removeMode = false;
// 유닛이 나올 자리 (고스트가 서는 곳, D91)
const unitGhostAt = { x: 0, z: 0, set(x, z) { this.x = x; this.z = z; } };
const heldSlot = () => (buildSlot >= 0 ? BUILD_SLOTS[buildSlot] : null);

// ---- 업그레이드 ----
// 부품(밖에서 주운 것)으로만 산다. P는 그대로 두고 유효값 계산에서 더한다
// (튜닝 슬라이더와 업그레이드가 서로 덮어쓰지 않게).
// 개조 목록. **'채굴 효율'과 '벽 내구도'는 삭제했다 (D92-1b).**
// 둘 다 존재하지 않는 P 키(P.res.mineRate · P.wall.hp)를 읽어 NaN을 반환했고
// 호출부조차 없었다 — 즉 부품만 먹고 아무 일도 안 하고 있었다.
// 지금 규칙에서는 애초에 성립하지 않는 항목이기도 하다:
//   채굴은 연속이 아니라 이산 왕복이라(D41) '효율'이 아니라 '시간'이 다이얼이고,
//   벽은 무적이라(D30) 내구도라는 값 자체가 없다.
const UPGRADES = [
  { key: 'speed', label: '이동 속도', unit: () => `+${P.upgrade.speedStep}` },
  { key: 'radius', label: '채굴 속도', unit: () => `-${P.upgrade.radiusStep}s` },
  { key: 'tower', label: '경비탑 화력', unit: () => `+${P.upgrade.towerStep}` },
  { key: 'guard', label: '방어병 화력', unit: () => `+${P.upgrade.guardStep}` },
];
const newUpg = () => ({ speed: 0, radius: 0, tower: 0, guard: 0 });

const upgCost = (lv) => P.upgrade.baseCost + P.upgrade.costStep * lv;
// 모든 이동 속도는 이 배율을 통과한다 (D56) — 여기 한 곳만 바꾸면 전체 템포가 바뀐다
const moveScale = () => P.tempo.moveScale;
const effPlayerSpeed = (p = player) => (P.player.speed + p.upg.speed * P.upgrade.speedStep) * moveScale();
const effWorkerSpeed = () => P.worker.speed * moveScale();
const effGuardSpeed = () => P.guard.speed * moveScale();
// 업그레이드는 채굴 '시간'을 줄인다 (레벨당 radiusStep초)
const effMineTime = (p = player) => Math.max(P.carry.mineTime - p.upg.radius * P.upgrade.radiusStep, 0.25);
// 경비탑 화력 업그레이드는 모든 타워·모든 tier에 동일하게 가산된다 (읽는 base만 tier별로 다름)
const effTowerDmg = (tier, p = player) => TOWER_TIERS[tier].dmg() + p.upg.tower * P.upgrade.towerStep;
// 방어병 화력 업그레이드 (D87) — 3병종 전부에 같이 가산된다.
// 후반에 적 체력이 오르면 낮은 병력으로는 자연회복조차 못 넘기므로, 이게 그 대응 수단이다.
const effGuardDmg = (type, p = player) => GUARD_TYPES[type].dmg() + p.upg.guard * P.upgrade.guardStep;

// 적 종류 메타 (숫자가 아니라서 P 밖에 둠 — 세팅 스냅샷에 안 섞이게)
const TYPE_INFO = {
  chaser: { label: '순찰묘', canBreak: false },
  runner: { label: '날쌘묘', canBreak: false },
  bomber: { label: '자폭묘', canBreak: true },   // 폭발로만 벽을 부순다
  boss: { label: '톰', canBreak: true },         // 강타로 벽을 부순다 (자폭 없음, D83)
};
// 시작 자원은 "벽 N개분"으로 정의 — 벽 비용을 바꿔도 시작 여유가 유지됨
const startResources = () => P.res.start;

// ============================================================
// 격자 / 좌표계
//  - 벽 격자: CELLS x CELLS, 한 칸 CS(1.0m)
//  - 내비 격자: 벽 격자의 2배 해상도 (navRes = CS/2)
// ============================================================
// 맵마다 크기가 다르므로 가변. 모든 헬퍼가 호출 시점에 읽는다.
let CELLS = 56;
const CS = 1.5;
let HALF = (CELLS * CS) / 2;
// 내비 격자 해상도 — 셀당 몇 칸인가 (D68).
// 2(0.75m)로는 **대각 관문의 통로 폭 0.52m를 표현할 수 없어서**, 길찾기가
// 은신처 밖으로 나가는 길 자체를 못 찾았다 (기둥 사이로 못 나감).
// 4(0.375m)면 관문이 확실히 잡히고, 직교 틈(통로 0m)은 여전히 막힌다.
const NAVPC = 2;
const navRes = CS / NAVPC;
let NAV = CELLS * NAVPC;

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
  resizeTerritoryOverlay();

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

// ---- 영토 바닥 색칠 (D86) ----
// 나브 격자 한 칸 = 텍스처 한 픽셀. 색을 전부 같게 두고 **알파만** 켜고 끄므로
// 선형 필터링이 가장자리를 부드럽게 번지게 해 준다 (색 번짐 없이 경계만 흐려진다).
// 필드가 바뀔 때만 다시 그린다 — 매 프레임 28,000칸을 훑지 않는다.
const terrCanvas = document.createElement('canvas');
terrCanvas.width = terrCanvas.height = 2;
const terrTex = new THREE.CanvasTexture(terrCanvas);
const terrMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: terrTex, transparent: true, opacity: 0.3, depthWrite: false,
    color: 0xffffff,
  })
);
terrMesh.rotation.x = -Math.PI / 2;
terrMesh.position.y = 0.02;   // 바닥 위, 격자선 아래
terrMesh.renderOrder = 1;
scene.add(terrMesh);

function resizeTerritoryOverlay() {
  terrMesh.scale.set(CELLS * CS, CELLS * CS, 1);
  territoryGen = -1;   // 맵이 바뀌었으니 다시 센다
}

let terrPainted = -1;
function paintTerritory() {
  if (terrPainted === territoryGen) return;
  terrPainted = territoryGen;
  if (terrCanvas.width !== NAV) terrCanvas.width = terrCanvas.height = NAV;
  const g = terrCanvas.getContext('2d');
  const img = g.createImageData(NAV, NAV);
  const d = img.data;
  // 텍스처 (0,0)은 로컬 +Y = 월드 -Z = 나브 z 0 — 그래서 픽셀 좌표가 나브 좌표와 그대로 맞는다
  for (let k = 0; k < NAV * NAV; k++) {
    const o = k * 4;
    d[o] = 0x7a; d[o + 1] = 0xe6; d[o + 2] = 0xa0;
    d[o + 3] = territory && territory[k] ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  terrTex.needsUpdate = true;
}

// ============================================================
// 장애물 (벽 + 지형)
//  key "i,j" -> { i, j, hp, maxHp, bedrock, mesh }
//  bedrock = 파괴 불가 지형 (미리 배치)
// ============================================================
const obstacles = new Map();
// ---- 벽 이벤트 큐 (D92-6단계) ----
// 벽은 300칸까지 가므로 스냅샷에 매번 실을 수 없다. 대신 **바뀔 때만** 보낸다.
// 호스트에서 벽이 생기고/사라지고/금이 갈 때 여기 쌓였다가 다음 스냅샷에 딸려 나간다.
// (건물은 12채뿐이라 그냥 스냅샷에 통째로 싣는다 — 이벤트를 둘 만들 이유가 없다)
let wallEvents = [];
let wallEvMute = 0;   // 초기 생성·맵 재구성처럼 통째로 다시 보낼 때는 개별 이벤트를 막는다
// **접속돼 있을 때만** 쌓는다. 예전엔 솔로에서도 쌓기만 하고 비우는 곳이 없어서
// 벽을 세울 때마다 배열이 자랐다 (아무도 안 읽는 쓰레기).
const wallEv = (e) => { if (!wallEvMute && net.role === 'host' && net.connected) wallEvents.push(e); };
const wallGeo = new THREE.BoxGeometry(1, 1, 1);
// 플레이어 벽은 **원기둥**이다 (D59). 사각 기둥이면 대각 관문이 코너-코너 거리라
// √2×(틈)밖에 안 나오는데, 원이면 중심거리 자체가 √2배로 벌어져 관문이 훨씬 넓다.
//   사각: 대각 관문 = √2(CS-post)          = 0.85  (몸 0.7 → 여유 7.5cm씩, 사실상 못 지나감)
//   원형: 대각 관문 = √2·CS - post         = 1.01  (여유 15cm씩, 실제로 지나갈 수 있다)
const postGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

function addObstacle(i, j, bedrock, building = false, owner = 'p') {
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
  const post = !bedrock && !building;
  const mesh = new THREE.Mesh(post ? postGeo : wallGeo, mat);
  const h = bedrock ? 1.4 : P.wall.height * (building ? 0.15 : 1);
  const w = cellToWorld(i, j);
  // 플레이어 벽만 가느다란 원기둥 — 틈이 보여야 "지나갈 수 있겠다"가 읽힌다
  const side = post ? P.wall.post : CS * 0.98;
  mesh.scale.set(side, h, side);
  mesh.position.set(w.x, h / 2, w.z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const ob = {
    i, j,
    hp: Infinity, maxHp: Infinity,   // 벽은 무적 (자폭묘 폭발로만 사라진다)
    owner,
    bedrock, building, mesh,
  };
  // 소유자별로 색이 달라야 한다 (D96에서 되살림). D95에서 동료 AI 블록을 걷어낼 때
  // 여기 있던 파란 칠이 같이 사라졌는데, 소멸이 소유자별인 지금은
  // **"이 벽이 누구 것인가"가 생사에 걸린 정보**다 — 상대가 잡히면 그 벽만 사라진다.
  if (post && owner === 'a') mat.color.setHex(0x7f93c8);
  obstacles.set(key, ob);
  if (post) wallEv({ a: 1, i, j, o: owner });
  return ob;
}

function removeObstacle(ob) {
  if (!ob.bedrock && !ob.bldgRef) wallEv({ a: 0, i: ob.i, j: ob.j });
  obstacles.delete(cellKey(ob.i, ob.j));
  if (ob.mesh) {
    scene.remove(ob.mesh);
    ob.mesh.material.dispose();
  }
}

const WALL_BASE = new THREE.Color(0x8fa1b8);
const WALL_BASE_A = new THREE.Color(0x7f93c8);   // 동료(P2) 벽은 파랗다 (D96)
const wallBaseOf = (ob) => (ob.owner === 'a' ? WALL_BASE_A : WALL_BASE);
const WALL_DMG = new THREE.Color(0xd9534f);
function updateWallColor(ob) {
  if (!ob.mesh) return; // 건물 셀은 건물 쪽에서 색을 관리
  const t = 1 - ob.hp / ob.maxHp;
  ob.mesh.material.color.copy(wallBaseOf(ob)).lerp(WALL_DMG, t);
}

// ---- 금 간 벽 (D90) ----
// 자폭묘 폭발이 벽을 **없애는 대신 금을 낸다.** 금이 crackMax를 넘으면 무너진다.
// 금이 갈수록 가늘어지고 붉어진다 — "저기 손봐야 한다"가 멀리서도 읽혀야 하므로
// 색만 바꾸지 않고 **굵기**도 줄인다 (실루엣이 변하는 게 가장 눈에 띈다).
const crackedWalls = () =>
  [...obstacles.values()].filter((ob) => !ob.bedrock && !ob.bldgRef && ob.cracks > 0);

function applyCrackVisual(ob) {
  if (!ob.mesh) return;
  const f = (ob.cracks || 0) / Math.max(P.wall.crackMax, 1);   // 0..1
  const side = P.wall.post * (1 - 0.3 * f);
  ob.mesh.scale.set(side, P.wall.height * (1 - 0.12 * f), side);
  ob.mesh.position.y = (P.wall.height * (1 - 0.12 * f)) / 2;
  // 금이 가도 **소유자 색은 유지**한다 — 누구 벽인지가 계속 읽혀야 한다 (D96)
  ob.mesh.material.color.copy(wallBaseOf(ob)).lerp(WALL_DMG, 0.55 * f + 0.25 * (f > 0 ? 1 : 0));
  ob.mesh.material.emissive.setHex(f > 0 ? 0x772222 : 0x000000);
  ob.mesh.material.emissiveIntensity = f > 0 ? 0.35 * f + 0.2 : 0;
}

// 폭발 한 번 = 금 하나. 넘치면 무너진다. 무너졌으면 true를 돌려준다.
// n은 한 번에 내는 금의 수 — 보스 강타는 자폭묘보다 세게 친다 (D99).
function crackWall(ob, n = 1) {
  ob.cracks = (ob.cracks || 0) + n;
  if (ob.cracks > P.wall.crackMax) { removeObstacle(ob); return true; }
  applyCrackVisual(ob);
  wallEv({ a: 2, i: ob.i, j: ob.j, c: ob.cracks });
  return false;
}

function repairWall(ob) {
  ob.cracks = 0;
  applyCrackVisual(ob);
  wallEv({ a: 2, i: ob.i, j: ob.j, c: 0 });
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
    // 단일 맵으로 간다 (D75). 여러 맵은 컨셉만 다르고 실제 플레이가 갈리지 않았다.
    // 넓이는 1.5배(56→84칸 = 126m). 지형은 최소 — 벽을 직접 쌓는 게 이 게임이다.
    name: '허허벌판',
    size: 84,
    floor: 0x2b3040, gridColor: 0x4a5268,
    desc: '넓은 개활지. 지형은 거의 없고 방어선은 전부 내가 세운다',
    playerSpawn: [42, 46], enemySpawn: [42, 8],
    build(t) {
      // 교보재 — 틈 폭이 다른 짧은 벽 세 개. 어느 크기가 뚫는지 눈으로 배운다
      t.vLine(26, 22, 34, [28]);            // 1칸 틈 (나만)
      t.vLine(58, 22, 34, [27, 28]);        // 2칸 틈 (날쌘묘까지)
      t.hLine(34, 50, 58, [41, 42, 43]);    // 3칸 틈 (전부)
      // 낱개 바위 — 시야 가리개 겸 이정표. 드문드문
      for (const [i, j] of [[14, 14], [70, 14], [14, 70], [70, 70],
                            [42, 26], [42, 62], [22, 44], [62, 44],
                            [30, 12], [54, 74], [12, 54], [74, 30]])
        t.put(i, j);
    },
    // 가까운 더미는 작고, 먼 귀퉁이 군집은 크다 — 나갈수록 벌이가 좋다
    nodes: [[34, 38], [50, 38], [34, 52], [50, 52],
            [20, 30], [64, 30], [20, 58], [64, 58],
            [42, 18], [42, 70], [16, 44], [68, 44],
            [8, 8, 1.8], [11, 6, 1.8], [6, 11, 1.8],
            [76, 8, 1.8], [73, 6, 1.8], [78, 11, 1.8],
            [8, 76, 1.8], [11, 78, 1.8], [6, 73, 1.8],
            [76, 76, 1.8], [73, 78, 1.8], [78, 73, 1.8]],
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
let clearHam = null;    // 지형+건물만 막힘 — **햄스터 전용** (기둥은 물리로 비껴간다, D61)

// mode: 'all' = 전부 막힘 / 'bed' = 지형만 / 'noBldg' = 지형+벽 (건물은 통과 취급)
function navBlocked(i, j, mode) {
  if (i <= 0 || j <= 0 || i >= NAV - 1 || j >= NAV - 1) return true; // 외곽 림
  const ob = obstacles.get(cellKey((i / NAVPC) | 0, (j / NAVPC) | 0));
  if (!ob) return false;
  if (mode === 'bed') return ob.bedrock;
  if (mode === 'noBldg') return ob.bedrock || !ob.bldgRef;
  // 'ham' = 햄스터 시야의 통행권 (D61).
  // **플레이어 벽(기둥)은 막지 않는다** — 기둥은 0.9m 원기둥이라 햄스터가 옆으로
  // 비껴 지나갈 수 있는데, 나브 격자(0.75m)로는 그 여백을 표현할 수 없어
  // 셀 전체가 막힌 것으로 보였다. 그러면 길찾기가 "여긴 못 간다"고 하는데
  // 물리는 통과시켜서 **제자리에서 파닥거리는** 현상이 난다.
  // 기둥 회피는 원-원 밀어내기(물리)에 맡기고, 길찾기는 지형·건물만 본다.
  if (mode === 'ham') return ob.bedrock || !!ob.bldgRef;
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

// 기둥의 **실제 원 크기**를 햄스터 필드에 심는다 (D66).
// D61의 clearHam은 기둥을 아예 무시했다. 그래서 A*가 직교 틈(0.6m, 몸 0.7이라
// 물리적으로 못 지나감)을 태연히 관통하는 경로를 내놨고, 물리가 막아서 파닥거렸다.
// 셀 단위로 막으면(D57 이전) 대각 관문까지 막혀서 또 파닥거린다.
// 답은 중간이다: 기둥 주변 나브 칸에 "기둥 표면까지의 실거리"를 기록한다.
//   → 직교 틈 한가운데 칸: 0.75 - 0.45 = 0.3 < 몸 반지름 → 막힘 (물리와 일치)
//   → 대각 관문 한가운데 칸: 1.06 - 0.45 = 0.61 > 몸 반지름 → 통과 (물리와 일치)
// canPass의 격자 보정(navRes*0.5)을 미리 빼서 기둥에 한해 **정확한** 판정이 되게 한다.
function seedPillarClearance(d) {
  const R = P.wall.post / 2;
  const span = Math.ceil((R + 1.2) / navRes);
  for (const ob of obstacles.values()) {
    if (ob.bedrock || ob.bldgRef) continue;
    const w = cellToWorld(ob.i, ob.j);
    const ci = Math.floor((w.x + HALF) / navRes), cj = Math.floor((w.z + HALF) / navRes);
    for (let dj = -span; dj <= span; dj++)
      for (let di = -span; di <= span; di++) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= NAV || nj >= NAV) continue;
        const cx = (ni + 0.5) * navRes - HALF, cz = (nj + 0.5) * navRes - HALF;
        const dist = Math.hypot(cx - w.x, cz - w.z) - R - navRes * 0.5;
        const k = nj * NAV + ni;
        if (dist < d[k]) d[k] = dist;
      }
  }
}

// 벽이 바뀔 때마다 즉시 재계산하면, 벽을 연달아 놓을 때 프레임마다 여러 번 돈다 (D70).
// 더러워졌다고 표시만 해 두고 **프레임당 한 번** 처리한다.
let navDirty = false;
const markNavDirty = () => { navDirty = true; };
function flushNavDirty() {
  if (!navDirty) return;
  navDirty = false;
  refreshClearance();
  repathAll();
}

function refreshClearance(terrainChanged = false) {
  clearAll = computeClearance('all');
  // 'bed'는 지형만 본다 — 벽을 세워도 안 바뀌므로 맵 생성 때만 계산한다
  if (terrainChanged || !clearBed) clearBed = computeClearance('bed');
  clearNoBldg = computeClearance('noBldg');
  clearHam = computeClearance('ham');
  seedPillarClearance(clearHam);
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

// A* 스크래치 버퍼 (D79).
// 예전엔 호출마다 NAV²짜리 배열 3개를 새로 만들고 fill()까지 했다.
// 맵이 84칸(NAV 168 = 28k칸)이 되면서 호출당 ~250KB 할당 + 전체 초기화가 됐고,
// 초당 20여 회 호출되니 GC 압력으로 **시간이 갈수록 느려졌다.**
// 세대 도장(stamp)을 찍어 재사용하면 할당도 초기화도 없다.
let asG = null, asParent = null, asStampG = null, asStampC = null, asGen = 0;
function ensureAstarBuffers() {
  const n = NAV * NAV;
  if (asG && asG.length === n) return;
  asG = new Float32Array(n);
  asParent = new Int32Array(n);
  asStampG = new Int32Array(n);
  asStampC = new Int32Array(n);
  asGen = 0;
}

function astar(start, goal, passFn, extraCostFn, maxIter = P.enemy.pathBudget) {
  ensureAstarBuffers();
  const gen = ++asGen;
  const gx = goal % NAV, gz = (goal / NAV) | 0;
  const h = (idx) => {
    const x = idx % NAV, z = (idx / NAV) | 0;
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  const gOf = (i) => (asStampG[i] === gen ? asG[i] : Infinity);
  const heap = new MinHeap();
  asG[start] = 0; asStampG[start] = gen; asParent[start] = -1;
  heap.push({ i: start, f: h(start) });
  let best = start, bestH = h(start);
  let found = false, iter = 0;
  while (heap.size && iter++ < maxIter) {
    const { i: cur } = heap.pop();
    if (asStampC[cur] === gen) continue;
    asStampC[cur] = gen;
    const hh = h(cur);
    if (hh < bestH) { bestH = hh; best = cur; }
    if (cur === goal) { found = true; break; }
    const cx = cur % NAV, cz = (cur / NAV) | 0;
    for (const [dx, dz, c] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
      const ni = nz * NAV + nx;
      if (asStampC[ni] === gen || !passFn(ni)) continue;
      if (dx !== 0 && dz !== 0) {
        if (!passFn(cz * NAV + nx) || !passFn(nz * NAV + cx)) continue;
      }
      const ng = gOf(cur) + c + extraCostFn(ni);
      if (ng < gOf(ni)) {
        asG[ni] = ng; asStampG[ni] = gen; asParent[ni] = cur;
        heap.push({ i: ni, f: ng + h(ni) });
      }
    }
  }
  const end = found ? goal : best;
  const path = [];
  for (let n = end; n !== -1 && asStampG[n] === gen; n = asParent[n]) path.push(n);
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

function buildCreature(pieces) {
  const group = new THREE.Group();
  const mats = [];
  for (const p of pieces) {
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
  // 다리·발 — 걷는 모션에 쓴다 (D96). 모델은 원래부터 두 발로 서 있었는데
  // 움직일 때 아무것도 안 움직여서 **미끄러지듯** 보였다.
  c.footL = c.group.children[0];
  c.footR = c.group.children[1];
  c.legL = c.group.children[2];
  c.legR = c.group.children[3];
  // 기준 자세를 기억해 둔다 — 모션은 전부 여기서 얼마나 벗어났는가로 준다
  c.rest = {};
  for (const k of ['footL', 'footR', 'legL', 'legR', 'armL', 'armR', 'handL', 'handR'])
    c.rest[k] = c[k].position.clone();
  c.walkPhase = 0;
  return c;
}

// 적 — 같은 저폴리 문법인데 길고 낮고 넓다. 귀가 뾰족하고 눈이 발광.
// 햄스터와 나란히 놨을 때 "폭"이 먼저 읽히도록 몸통을 가로로 넓힘.
// 종류별 팔레트: 실루엣은 같아도 색으로 즉시 구분되게.
const CAT_PALETTES = {
  chaser: { a: 0x8e4257, b: 0xb0596d, eye: 0xffe14d, glow: 0xffc400 }, // 자주색·노란 눈
  runner: { a: 0x4f6d8e, b: 0x7391b5, eye: 0x7dff9a, glow: 0x37e06b }, // 청회색·초록 눈
  bomber: { a: 0x3d2a33, b: 0x7a3320, eye: 0xff7a45, glow: 0xff4400 }, // 흑적색·주황 눈
  boss: { a: 0x241922, b: 0x4a2233, eye: 0xff3355, glow: 0xff0033 },  // "톰" — 짙은 자흑색·핏빛 눈
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
  // userData.keep = 모델을 갈아끼워도 남기는 장식 (투구·어깨 갑주 등).
  // GLB 로딩이 비동기라, 이걸 안 지키면 **맨 처음 만든 유닛만** 장식이 사라진다.
  for (const c of [...vis.group.children]) if (!c.userData.keep) c.visible = false;
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

let PLAYER_SPAWN = cellToWorld(28, 28);
let ENEMY_SPAWN = cellToWorld(28, 4);

// ============================================================
// 플레이어 슬롯 (D92 2인 → D97에서 4인으로)
// ============================================================
// 슬롯은 **처음부터 네 개 만들어 두고** 사람이 앉은 것만 active로 켠다.
// 나중에 늘리는 것보다 이 편이 안전하다 — "정확히 둘"을 전제한 코드가
// 어디에 숨어 있는지 컴파일러가 안 알려주기 때문이다 (D92에서 겪었다).
//
//   owner : 지갑·건물·벽·일꾼을 가르는 태그 (D43). 코드 전반이 이걸 본다.
//           'p'/'a'는 2인 시절 그대로 두고 뒤에 'b','c'를 붙였다 — 기존 세이브·주석과 안 어긋나게
//   local : 이 기계에서 키보드로 조종하는 쪽인가 (참가자에서는 자기 슬롯이 local이 된다)
//   ai    : AI가 운전하는가 (D95에서 AI를 걷어내서 지금은 늘 false지만, 판정은 남겨 둔다)
//   active: 사람이 앉아 있는가
const MAX_PLAYERS = 4;
const OWNERS = ['p', 'a', 'b', 'c'];
// 슬롯 색 — 미니맵 초상과 벽 색이 이걸 따른다. 한눈에 갈려야 한다
const SLOT_FUR = [0xe8b45a, 0xb8b8c4, 0x8fcf9a, 0xc39ae0];   // 갈색 · 회색 · 초록 · 보라
const SLOT_WALL = [0x9fb0c6, 0x7f93c8, 0x86c69a, 0xb192cf];
const SLOT_NAME = ['1P', '2P', '3P', '4P'];

const players = [];
for (let k = 0; k < MAX_PLAYERS; k++) {
  const vis = makeHamster(SLOT_FUR[k]);
  vis.group.scale.setScalar(k === 0 ? P.player.radius : P.ally.radius);
  players.push({
    id: k, slot: k, owner: OWNERS[k], name: SLOT_NAME[k],
    local: k === 0, ai: k !== 0, active: k === 0,
    x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, faceX: 0, faceZ: -1,
    stunned: false, carry: 0,
    vis, bar: null, workBar: null,
  });
}
// 기존 이름은 그대로 남긴다 — `who === player` 같은 동일성 비교가 코드 곳곳에 있다
const player = players[0];
const ally = players[1];
// 지갑(D92-1a) · 개조(1b) · 체력/무적/기절(1c)이 전부 구조체 필드로 들어왔다.
// 예전엔 resources/allyRes, playerHp/allyHp, grace/allyGrace처럼 **같은 개념이 두 벌로
// 흩어져 있었고**, 그래서 한쪽에만 있는 규칙이 생겼다 (구르기 회피가 플레이어 전용이었던 것 등).
for (const p of players) {
  p.cheese = 0;
  p.upg = newUpg();
  p.hp = P.player.hp;
  p.hurtT = 99;
  p.grace = 0;
  p.stunned = false;
  // 구르기·기운 (D81 → D92-1d). rollT>0 이면 구르는 중 = 무적
  p.rollT = 0; p.rollCd = 0; p.rollX = 0; p.rollZ = 0; p.rollSpin = 0;
  p.stamina = P.player.stamMax; p.stamIdle = 0;
  // 지금 하고 있는 나르기 일 (D92-1e). 일꾼이 이미 w.job을 쓰고 있어 이름을 맞췄다
  p.job = null;   // 'mine' | 'drop' | null
  // 채굴 명령과 그 경로 캐시 (D92-1e). 경로는 명령 종류를 안 가리고 공유한다 —
  // 채굴·벽·건물 명령은 동시에 살아 있지 않기 때문이다 (stepToward 주석 참조)
  p.mineOrder = null;      // { pile }
  p.orderPath = [];
  p.orderRepathT = 0;
  // 벽 명령 큐와 시전 상태 (D92-1e)
  p.wallOrders = [];       // [{ i, j }]
  p.wallCast = null;       // { i, j, t } — 이동하면 즉시 null (D58)
  // 건물 명령과 채널링 (D92-1e). buildCooldown은 좌클릭 연타 제한이라
  // 동료의 buildCd(AI 벽 쿨다운)와 이름이 겹치지 않게 풀네임으로 둔다
  p.buildOrder = null;     // { kind, i, j }
  p.buildJob = null;       // { b, t, dur, cost } — 짓는 동안 그 자리에 묶인다 (D44)
  p.buildCooldown = 0;
  p.upgradeJob = null;     // { b, t, dur, cost, parts } — 제자리 업그레이드 채널링 (D82)
  p.parts = 0;             // 부품 (D92-1e). 치즈와 같은 이유로 각자 살림이다 (D43)
  // 이동 입력 — **월드 좌표 단위벡터**다 (D92-1f). 카메라 기준 축이 아니라서
  // 두 사람이 서로 다른 카메라 모드를 써도 시뮬은 영향을 안 받는다
  p.in = { mx: 0, mz: 0 };
  p.harvestPulse = 0;      // 치즈 조각이 도착할 때 튀는 정도 (표현 전용)
  // 원격 구르기 관용 (D92-7단계). 호스트가 ROLL을 받은 시점은 이미 RTT/2 늦었으므로,
  // 그만큼 회피 판정을 더 열어 준다 — 아래 applyCommand 주석 참고
  p.rollGrace = 0;
  p.wipeT = 0;             // >0 이면 소멸 카운트다운 중 (D95)
  p.tauntT = 0; p.tauntCd = 0;   // 도발 춤 / 재사용 대기 (D96)
}
player.cheese = startResources();
const ownerOf = (o) => players[OWNERS.indexOf(o)] || player;
const localPlayer = () => players.find((p) => p.local) || player;
// 사람이 앉아 있는 슬롯들. "정확히 둘"을 전제하지 않으려면 전부 이걸 거쳐야 한다
const humans = () => players.filter((q) => q.active);
const others = (p) => players.filter((q) => q !== p && q.active);
// 건네주기·구출처럼 "가장 가까운 남" 이 필요한 곳
function nearestMate(p, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const q of others(p)) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
// 슬롯이 겹쳐 스폰하지 않게 — 시작 지점 둘레로 흩는다
function spawnSlotAt(k) {
  if (k === 0) return { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z };
  const a = (k - 1) * (Math.PI * 2 / 3) + 0.6;
  return { x: PLAYER_SPAWN.x + Math.cos(a) * 1.8, z: PLAYER_SPAWN.z + Math.sin(a) * 1.8 };
}

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
  Math.min(typeP(e).speed + threatLevel() * P.threat.speedGain, P.threat.speedCap) * moveScale();
const enemyDpsOf = (e) => (typeP(e).dps || 0) + threatLevel() * P.threat.dpsGain;
const canBreakWalls = (e) => TYPE_INFO[e.type].canBreak;
// 보스는 위협 레벨 스케일링에서 제외한다 (D83) — 등장 시점 고정 스탯으로 승부해야
// 생존시간에 안 묻힌다. 나머지 3종은 그대로 위협 레벨을 받는다.
const typeMaxHp = (type) => P[type].hp + (type === 'boss' ? 0 : threatLevel() * P.threat.hpGain);
const enemyMaxHp = (e) => typeMaxHp(e.type);

// 멀티에서 명령·스냅샷이 엔티티를 가리키려면 **이름이 필요하다** (D92-0단계).
// 배열 인덱스는 못 쓴다 — 중간에 하나가 죽으면 그 뒤가 전부 밀린다.
// 재시작해도 다시 쓰지 않는다(계속 증가).
// **적·일꾼·방어병·건물·픽업이 하나의 번호대를 공유한다** — 종류별로 번호가 따로 놀면
// 스냅샷에서 엉뚱한 엔티티에 값을 써 넣는 사고가 나고, 그 증상이 물리 버그처럼 보인다.
let entSeq = 0;
const nextId = () => ++entSeq;
const byId = (arr, id) => arr.find((e) => e.id === id) || null;

// 멀티 상태 (D92). 지금은 솔로 고정 — 5단계에서 net.js가 이걸 채운다.
// isHost가 true면 시뮬레이션을 돌린다. 솔로는 언제나 호스트다.
// 멀티 상태는 src/net.js가 들고 있다 (D92-5단계). 여기서는 net.isHost / net.role만 본다.
// 솔로도 isHost = true다 — 시뮬을 자기가 돌린다는 뜻이지 방을 열었다는 뜻이 아니다.

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
    id: nextId(),             // 포위 링 슬롯을 안정적으로 나누는 데도 쓴다 (증가 순서만 필요)
    approachA: n * 2.399963,  // 접근 각도 = 링 슬롯 + probeOff
    probeOff: 0,              // 제 슬롯에서 벗어난 정도 — 막히면 커지고 풀리면 돌아온다
    orbitDir: n % 2 ? 1 : -1, // 막혔을 때 훑어보는 방향 (좌우로 갈라진다)
    targetSince: 0,           // 지금 목표를 쫓기 시작한 시각 — 집착 피로 계산용 (D91)
    chaseTarget: null,        // 지금 노리는 햄스터 (무리를 갈라놓는 계산에 쓴다)
    probeT: 0,                // 현재 접근각을 유지할 남은 시간
    probes: 0, prowlT: 0, prowlX: 0, prowlZ: 0,
    atkT: 0, windup: 0, lungeT: 0, fuseT: 0, noHitT: 0,
    hitFlash: 0,
    vis, bar: makeBar(0xe0483c, 1.3),
  };
}

// ---- 순찰조 (D52) ----
// 초소를 맵 전역에 황금각으로 흩는다. 내 시작 지점 근처는 피하고,
// 못 서는 자리면 중심 쪽으로 당겨가며 설 수 있는 곳을 찾는다.
function patrolPost(k) {
  const base = k * 2.399963 + 0.7;
  for (let t = 0; t < 12; t++) {
    const a = base + t * 0.5;
    const r = HALF * P.patrol.postSpread * (1 - t * 0.05);
    const x = clamp(Math.cos(a) * r, -HALF + 5, HALF - 5);
    const z = clamp(Math.sin(a) * r, -HALF + 5, HALF - 5);
    if (Math.hypot(x - PLAYER_SPAWN.x, z - PLAYER_SPAWN.z) < P.patrol.minFromSpawn) continue;
    if (clearAll && !canPass(clearAll, worldToNav(x, z), P.chaser.radius)) continue;
    return { x, z };
  }
  return { x: 0, z: 0 };
}

function spawnPatrols() {
  for (let k = 0; k < scaled(P.patrol.count); k++) {
    const post = patrolPost(k);
    const e = makeEnemy('chaser', enemies.length);
    e.patrol = true;
    e.homeX = post.x; e.homeZ = post.z;
    e.patrolA = k * 1.7;
    e.aggroT = 0;
    e.leashCd = 0;
    e.x = post.x; e.z = post.z;
    // 발밑 파란 링 = 순찰조라는 표시 (어그로를 끌어도 잠깐만 쫓아온다)
    const ring = new THREE.Mesh(
      selRingGeo,
      new THREE.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.scale.setScalar(enemyR(e) * 2.1);
    scene.add(ring);
    e.homeRing = ring;
    enemies.push(e);
  }
  refreshReach();
}

function setEnemyCount(count) {
  while (enemies.length < count) enemies.push(makeEnemy('chaser', enemies.length));
  while (enemies.length > count) {
    const e = enemies.pop();
    scene.remove(e.vis.group);
    disposeBar(e.bar);
    if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); }
  }
  refreshReach();
}

// 벽이 바뀌면 전원이 **다음 프레임에 한꺼번에** A*를 돌려 스파이크가 났다 (D70).
// 재계산 주기 안에서 무작위로 흩어 프레임당 한두 마리씩만 돌게 한다.
const repathAll = () => { for (const e of enemies) e.repathT = Math.random() * P.enemy.repath; };

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
// 지갑은 소유자별로 완전히 분리돼 있다 (D43). 이제 구조체 필드를 읽는다 (D92-1a).
const purse = (o) => ownerOf(o).cheese;
const spend = (o, v) => { ownerOf(o).cheese -= v; };
const earn = (o, v) => { ownerOf(o).cheese += v; };

// 적 도달 가능 영역 (내비 격자 flood fill, 적 반지름 기준)
//  → 노드가 이 영역 밖이면 "확보됨"
let enemyReach = null;
let safeField = null;   // 은신처 칸 (enemyReach를 safeMargin만큼 부풀린 여집합)
let safeGen = 0;        // 필드 세대 — 벽이 바뀌거나 재시작하면 오르고, 캐시는 이걸로 무효화한다
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

  // ---- 은신처 필드 (D54) ----
  // enemyReach만으로는 부족하다. 그건 "고양이 **몸 중심**이 올 수 있는 칸"이라,
  // 벽에 딱 붙은 자리도 도달 불가로 잡힌다 — 하지만 거기는 손이 닿아서 안전하지 않다.
  // 그래서 도달 가능 영역을 safeMargin만큼 **부풀린 뒤** 그 밖에 남는 칸만 은신처로 친다.
  // (= 공격 사거리만큼 떨어진 진짜 주머니. 3x3 링 안쪽은 남고, 벽 옆 한 칸은 걸러진다)
  const k = Math.max(1, Math.round(P.player.safeMargin / navRes));
  const safe = new Uint8Array(NAV * NAV);
  for (let z = 0; z < NAV; z++) {
    for (let x = 0; x < NAV; x++) {
      const idx = z * NAV + x;
      if (vis[idx]) continue;
      let ok = true;
      for (let dz = -k; dz <= k && ok; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= NAV) continue;
        for (let dx = -k; dx <= k; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= NAV) continue;
          if (vis[nz * NAV + nx]) { ok = false; break; }
        }
      }
      if (ok) safe[idx] = 1;
    }
  }
  safeField = safe;
  safeGen++;      // 은신처 필드가 바뀌었다 → 캐시 무효화
}

// ---- 영토 (D86) ----
// **"벽으로 안전하게 감싼 땅" = 고양이가 못 오는 칸(safeField) 중 내가 걸어서 갈 수 있는 곳.**
// 새 판정을 하나도 만들지 않았다 — D54의 은신처 필드를 그대로 쓰고 "내가 닿는가"만 얹는다.
// 그래서 공짜로 따라오는 것들:
//   · 벽을 세우면 즉시 늘고, 자폭묘가 뚫으면 **즉시 훅 줄어든다**
//   · 날쌘묘가 등장하면 저절로 줄어든다 (D14를 면적으로 체감하게 된다)
//   · 지형 주머니도 내가 들어갈 수 있으면 영토다 — 누가 만들었는지 구분할 필요가 없다
// 이건 paper.io식 "선을 그으면 내 땅"이 아니라 **통행권의 결과**다. D1이 기각한
// '영역 점유' 코어를 들여오는 게 아니라, 크기 비대칭 코어에서 유도되는 표시일 뿐이다.
let territory = null;     // Uint8Array — 내 영토 칸
let territoryArea = 0;    // ㎡
let territoryGen = -1;

function refreshTerritory() {
  if (!safeField || !clearHam) { territory = null; territoryArea = 0; return; }
  if (territoryGen === safeGen) return;   // 필드가 안 바뀌었으면 다시 안 센다
  territoryGen = safeGen;
  // **내가 지금 어디 서 있는지와 무관하게** 센다 (D90 버그 수정).
  // 예전에는 플레이어에서 BFS로 퍼뜨려 "지금 걸어서 닿는" 안전지대만 영토로 쳤다.
  // 그래서 큰 땅을 만들어 두고 옆에 작은 땅을 이어붙이면, 서 있는 쪽만 내 땅이 되고
  // **원래 큰 땅이 영토에서 빠져 버렸다.** 영토는 "내가 만든 땅"이지
  // "지금 발이 닿는 땅"이 아니다 — 위치 의존을 통째로 없앴다.
  const out = new Uint8Array(NAV * NAV);
  let n = 0;
  for (let k = 0; k < NAV * NAV; k++) {
    if (!safeField[k]) continue;
    if (!canPass(clearHam, k, P.player.radius)) continue;   // 햄스터가 설 수 있는 칸만
    out[k] = 1; n++;
  }
  territory = out;
  territoryArea = n * navRes * navRes;
}

const inTerritory = (x, z) => !!(territory && territory[worldToNav(x, z)]);

// ---- 은신처 판별 (D54) ----
// **은신처는 표시가 아니라 계산이다.**
// enemyReach = 지금 살아 있는 적들이 반지름별로 갈 수 있는 칸의 합집합.
// 그 여집합 중 햄스터가 설 수 있는 칸이 곧 은신처다.
//  · 동료가 지은 3x3 은신처, 내가 1칸 틈으로 막아둔 구역, 지형 주머니가 전부 자동 포함
//  · 벽을 세우거나 자폭묘가 부수면 즉시 갱신된다
//  · **날쌘묘가 등장하면 은신처 집합이 저절로 줄어든다** (D14가 AI에게도 적용된다)
// 코어 규칙에서 파생되므로, 규칙을 바꾸면 AI의 판단도 같이 바뀐다.
let safeCache = { t: -99, gen: -1, x: 0, z: 0, r: 0, cell: null };

function nearestSafeSpot(x, z, r = P.ally.radius) {
  if (!safeField || !clearHam) return null;
  // 짧게 캐시한다 — 프레임마다 전체 BFS를 돌릴 이유가 없다
  // 캐시 무효화 조건이 셋이다. 시간(0.4초)만으로 재면
  //  · 재시작 시 survival이 0으로 돌아가 이전 판 캐시가 통과하고
  //  · 벽을 세워 은신처가 새로 생겨도 낡은 답(주로 null)이 계속 나온다. 둘 다 실제로 났다.
  if (safeCache.gen === safeGen && Math.abs(survival - safeCache.t) < 0.4 && safeCache.r === r
      && Math.hypot(x - safeCache.x, z - safeCache.z) < 1.5) return safeCache.cell;
  const pass = (i) => canPass(clearHam, i, r);
  const start = nearestPassableNav(x, z, pass);
  const seen = new Uint8Array(NAV * NAV);
  const q = [start];
  seen[start] = 1;
  let head = 0, found = null;
  while (head < q.length && head < 9000) {
    const cur = q[head++];
    if (safeField[cur]) { found = cur; break; }
    // **8방향**이어야 한다 (D68). 대각 관문은 대각으로만 지나갈 수 있어서,
    // 4방향 BFS로는 은신처 밖으로 나가는 길을 못 찾는다 (A*는 원래 8방향이다).
    const cx = cur % NAV, cz = (cur / NAV) | 0;
    const push = (n) => { if (!seen[n] && pass(n)) { seen[n] = 1; q.push(n); } };
    const L = cx > 0, R = cx < NAV - 1, U = cz > 0, D = cz < NAV - 1;
    if (L) push(cur - 1);
    if (R) push(cur + 1);
    if (U) push(cur - NAV);
    if (D) push(cur + NAV);
    if (L && U) push(cur - NAV - 1);
    if (R && U) push(cur - NAV + 1);
    if (L && D) push(cur + NAV - 1);
    if (R && D) push(cur + NAV + 1);
  }
  const cell = found === null ? null : navToWorld(found);
  safeCache = { t: survival, gen: safeGen, x, z, r, cell };
  return cell;
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
// target: null이면 캔 햄스터에게, {x,z}면 그 지점(창고)으로 날아간다.
// who는 target이 null일 때 **누구에게 날아가는지** (D92-1f)
function spawnCheeseBit(x, z, target = null, who = player) {
  const m = new THREE.Mesh(bitGeo, bitMat);
  m.scale.setScalar(0.12 + Math.random() * 0.06);
  m.position.set(x, 0.5, z);
  m.castShadow = true;
  scene.add(m);
  cheeseBits.push({
    mesh: m, t: 0,
    dur: 0.55 + Math.random() * 0.25,
    x0: x, z0: z, target, who,
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
      if (!b.target) b.who.harvestPulse = Math.min(b.who.harvestPulse + 0.35, 1); // 도착 → 반응
      continue;
    }
    const gx = b.target ? b.target.x : b.who.x;
    const gz = b.target ? b.target.z : b.who.z;
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
// 소유자 구분은 지붕(포인트)에만 준다 — 건물 전체 색은 종류를 나타내야 하므로
const OWNER_COLOR = { p: 0xffc94d, a: 0x5fa8ff };
const OWNER_LABEL = { p: '내', a: '동료' };
// 경비탑은 P.tower에 .cost/.hp가 없다 (tier별 t1/t2/t3로 나뉘어 있다, D82).
// 새로 짓는 경비탑은 항상 tier1이므로 그 값을 읽는다.
const buildCost = (kind) => cheeseCost(kind === 'tower' ? TOWER_TIERS[1].cost() : P[kind].cost);
const buildHp = (kind) => (kind === 'tower' ? TOWER_TIERS[1].hp() : P[kind].hp);

function buildingAt(i, j) {
  const ob = obstacles.get(cellKey(i, j));
  return ob && ob.bldgRef ? ob.bldgRef : null;
}

function makeBuildingMesh(kind, owner) {
  const info = BLDG_INFO[kind];
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 1.0, 1.9),
    new THREE.MeshStandardMaterial({ color: info.body, roughness: 0.8 })
  );
  body.position.y = 0.5;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.28, 2.05),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(info.roof).lerp(new THREE.Color(OWNER_COLOR[owner] || 0xffffff), 0.55),
      roughness: 0.9,
    })
  );
  // 소유자 깃대 — 멀리서도 누구 건물인지 보이게
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.9, 0.16),
    new THREE.MeshStandardMaterial({
      color: OWNER_COLOR[owner] || 0xffffff,
      emissive: new THREE.Color(OWNER_COLOR[owner] || 0xffffff), emissiveIntensity: 0.45,
    })
  );
  flag.position.set(0.78, 1.7, 0.78);
  flag.castShadow = true;
  g.add(flag);
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

// 공방·경비탑 제자리 업그레이드(D82)의 시각 표현.
// 칸수가 안 바뀌므로 등급을 읽기가 어려웠다 (D88 지적) — 발광 세기만으로는 구분이 안 된다.
// 그래서 **세 가지를 동시에** 준다:
//   1. 등급 핍 — 건물 위에 떠 있는 막대 1/2/3개. 어느 각도에서도 개수를 셀 수 있다
//   2. 지붕 색 — Lv.1 어두움 / Lv.2 밝음 / Lv.3 금색 + 발광
//   3. 기하 — 층이 하나씩 쌓인다 (경비탑은 포탑이 커지고, 공방은 굴뚝이 자란다)
const TIER_COLOR = [0x6a7386, 0x74c7f0, 0xffcc55];   // Lv.1 / 2 / 3
// 핍은 **정육면체**다 — 위에서 봐도(탑다운) 옆에서 봐도(3인칭) 개수가 세진다.
// 세로 막대로 만들었더니 탑다운에서 점으로 보이고, 타워는 포탑 돔에 묻혔다.
const pipGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const tierGeo = new THREE.BoxGeometry(1.0, 0.34, 1.0);

function applyBuildingTierVisual(b) {
  const tier = Math.max(1, Math.min(3, b.tier || 1));
  const col = TIER_COLOR[tier - 1];

  // --- 1. 등급 핍 (건물 위에 뜬 막대 N개) ---
  if (b.pips) { b.mesh.remove(b.pips); b.pips.traverse((o) => o.material?.dispose?.()); }
  const pips = new THREE.Group();
  const pipMat = new THREE.MeshStandardMaterial({
    color: col, emissive: new THREE.Color(col), emissiveIntensity: 0.85, roughness: 0.4,
  });
  for (let k = 0; k < tier; k++) {
    const p = new THREE.Mesh(pipGeo, pipMat);
    p.position.set((k - (tier - 1) / 2) * 0.44, 0, 0);
    pips.add(p);
  }
  // 포탑(경비탑 Lv.3은 y≈2.2까지 올라온다)보다 확실히 위 — 어디서도 안 가려진다
  pips.position.y = 3.1;
  b.mesh.add(pips);
  b.pips = pips;

  // --- 2. 지붕 색 ---
  const roof = b.mesh.children[1];
  roof.material.color.setHex(col);
  if (!roof.material.emissive) roof.material.emissive = new THREE.Color(col);
  else roof.material.emissive.setHex(col);
  roof.material.emissiveIntensity = tier === 3 ? 0.5 : tier === 2 ? 0.22 : 0;

  // --- 3. 기하: 등급마다 한 층 (Lv.1은 없음) ---
  if (b.tiers) { b.mesh.remove(b.tiers); b.tiers.traverse((o) => o.material?.dispose?.()); }
  const stack = new THREE.Group();
  const stackMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.65, metalness: 0.25 });
  for (let k = 1; k < tier; k++) {
    const s = new THREE.Mesh(tierGeo, stackMat);
    s.scale.setScalar(1 - (k - 1) * 0.18);
    s.position.y = 1.3 + (k - 1) * 0.36;
    s.castShadow = true;
    stack.add(s);
  }
  b.mesh.add(stack);
  b.tiers = stack;

  // 경비탑 포탑은 등급만큼 커지고 밝아진다
  if (b.kind === 'tower' && b.mesh.userData.head) {
    const head = b.mesh.userData.head;
    head.scale.setScalar(1 + (tier - 1) * 0.3);
    head.position.y = 1.5 + (tier - 1) * 0.36;
    const horn = head.children[1];
    horn.material.emissiveIntensity = 0.5 + (tier - 1) * 0.6;
    horn.material.color.setHex(tier >= 3 ? 0xffd9a0 : 0xe6e0ff);
  }
}

// 앵커 (i,j) 기준 2x2. 실패 사유를 문자열로 돌려줘서 플래시로 안내
// asOrder=true 면 거리·내 위치를 보지 않는다 (D66) — 명령이 걸어가고 비켜서기 때문.
// 실제 착공(placeBuilding) 시점에는 asOrder=false로 다시 검사한다.
function buildingPlacement(i, j, kind, asOrder = false, p = player) {
  if (i < 0 || j < 0 || i + 1 >= CELLS || j + 1 >= CELLS) return '맵 밖입니다';
  // 경비탑은 공방(어떤 tier든)이 실존해야 새로 지을 수 있다 (D82 기술 트리).
  // 실존 검사라 공방이 부서지면 이 자리에서 즉시 다시 막힌다.
  if (kind === 'tower' && maxWorkshopTier() < 1) return '공방이 필요합니다';
  const cells = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
  for (const [ci, cj] of cells) {
    if (obstacles.has(cellKey(ci, cj))) return '자리가 막혀 있습니다 (2x2 공터 필요)';
    if (nodeAt(ci, cj)) return '광맥 위에는 지을 수 없습니다';
    if (!asOrder && distCellToPoint(ci, cj, p.x, p.z) < P.player.radius + 0.02) return '내가 서 있는 자리입니다';
    for (const e of enemies)
      if (distCellToPoint(ci, cj, e.x, e.z) < enemyR(e) + 0.02) return '적이 서 있는 자리입니다';
  }
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  if (!asOrder && Math.hypot(p.x - cx, p.z - cz) > P.wall.range + 1.2) return '너무 멉니다';
  if (kind === 'depot') {
    for (const n of nodes) {
      const w = cellToWorld(n.i, n.j);
      if (Math.hypot(w.x - cx, w.z - cz) < P.depot.minPileDist)
        return `치즈더미에서 ${P.depot.minPileDist}m 이상 떨어뜨려 지으세요`;
    }
  }
  return null;
}

function placeBuilding(kind, i, j, owner = 'p') {
  const cost = buildCost(kind);
  if (purse(owner) < cost) {
    flashFor(ownerOf(owner), `치즈가 부족합니다 (${BLDG_INFO[kind].label} ${cost})`, '#e05050');
    return null;
  }
  const err = buildingPlacement(i, j, kind, false, ownerOf(owner));
  if (err) { flashFor(ownerOf(owner), err, '#e05050'); return null; }
  spend(owner, cost);
  const b = placeBuildingLocal(kind, i, j, owner, nextId());
  spawnBuildFx(b.cx, b.cz);
  return b;
}

// 순수 생성 — 비용도 자리 검사도 안 본다 (클라가 스냅샷대로 세울 때 쓴다, D92-6단계)
function placeBuildingLocal(kind, i, j, owner, id) {
  const cx = cellToWorld(i, j).x + CS / 2, cz = cellToWorld(i, j).z + CS / 2;
  const mesh = makeBuildingMesh(kind, owner);
  mesh.position.set(cx, 0, cz);
  scene.add(mesh);
  const hp = buildHp(kind);
  // tier: 공방·경비탑만 의미가 있다 (제자리 업그레이드, D82). 새로 지으면 항상 1.
  const b = { kind, id, i, j, owner, cells: [], hp, maxHp: hp, store: 0, mesh, cx, cz, bitT: 0,
              underBuild: false, tier: 1,
              bar: makeBar(owner === 'a' ? 0x5fa8ff : 0x5fd07a, 1.6) };
  for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
    const key = cellKey(ci, cj);
    obstacles.set(key, { i: ci, j: cj, bedrock: false, bldgRef: b, mesh: null });
    b.cells.push(key);
  }
  buildings.push(b);
  markNavDirty();
  if (kind === 'workshop' || kind === 'tower') applyBuildingTierVisual(b);
  return b;
}

function destroyBuilding(b, byEnemy) {
  for (const key of b.cells) obstacles.delete(key);
  if (b.beam) { scene.remove(b.beam); b.beam.material.dispose(); b.beam = null; }
  disposeBar(b.bar);
  scene.remove(b.mesh);
  buildings.splice(buildings.indexOf(b), 1);
  markNavDirty();
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
    updateSelfBuild(b, dt);   // 경비탑은 혼자 지어진다 (D87)
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
function nearestDepot(x, z, owner = 'p') {
  let best = null, bd = Infinity;
  for (const b of buildings) {
    if (b.kind !== 'depot' || b.owner !== owner || b.underBuild) continue;
    const d = Math.hypot(b.cx - x, b.cz - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// 가장 가까운 (아직 남아 있는) 치즈더미
function nearestPile(x, z, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const n of nodes) {
    if (n.amount <= 0) continue;
    const w = cellToWorld(n.i, n.j);
    const d = Math.hypot(w.x - x, w.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// 치즈를 나르는 존재들 (플레이어 + 동료 + 일꾼)
const workers = [];
const carriers = () => [...humans(), ...workers];

// 볼주머니 채굴 (스타 프로브 리듬)
//  더미 옆에서 mineTime 동안 캐서 한 짐(load)을 담고 → 창고까지 날라 한 번에 부린다.
//  반환: 'mine' | 'drop' | null
function doCarryWork(c, dt, load, owner = 'p') {
  c.carry = c.carry || 0;
  c.mineT = c.mineT || 0;

  // 1) 하역 — 창고 옆이면 한 번에 부린다
  const dep = nearestDepot(c.x, c.z, owner);
  if (dep && c.carry > 0 && Math.hypot(dep.cx - c.x, dep.cz - c.z) <= P.depot.dropRange) {
    earn(owner, c.carry);
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

// ---- 채굴 명령 (플레이어) ----
// E 또는 치즈더미 우클릭 → 더미↔창고를 알아서 왕복한다.
// **WASD로 움직이는 순간 취소**돼 자유 이동으로 돌아온다.
// 실제 채굴/하역은 doCarryWork가 그대로 하고, 여기는 발만 대신 움직여 준다.
// 즉 "맡겨두고 다른 걸 하다가, 위험하면 직접 개입해 빼낸다"가 조작의 뼈대다.
function setMineOrder(pile, p = player) {
  if (!pile || pile.amount <= 0) { flashMsg('캘 수 있는 치즈더미가 아닙니다', '#e05050'); return; }
  p.mineOrder = { pile };
  p.orderPath = []; p.orderRepathT = 0;
  flashMsg('자동 채굴 시작 — 움직이면 취소', '#f0c040');
}

function clearMineOrder(msg, p = player) {
  if (!p.mineOrder) return;
  p.mineOrder = null;
  p.orderPath = [];
  if (msg) flashMsg(msg, '#9aa3b2');
}

function toggleMineOrder(p = player) {
  if (p.mineOrder) { clearMineOrder('채굴 명령 취소', p); return; }
  const n = nearestPile(p.x, p.z, P.command.promptRange);
  if (!n) { flashMsg('가까운 곳에 치즈더미가 없습니다', '#e05050'); return; }
  setMineOrder(n, p);
}

// 명령 수행 — 볼주머니가 비었으면 더미로, 찼으면 창고로 걸어간다
// 기둥 회피 조향 (D65).
// 길찾기(clearHam)는 기둥을 아예 무시하므로 **경로가 기둥을 관통**할 수 있다.
// 그대로 밀면 물리가 밀어내고 조향이 다시 밀어붙여 제자리에서 떤다(파닥거림).
// 진행 방향 앞에 있는 기둥을 옆으로 흘려보내는 성분을 더해 준다.
function steerAroundPosts(x, z, dx, dz, r) {
  let sx = dx, sz = dz;
  const need = P.wall.post / 2 + r + 0.15;
  const reach = need + CS * 1.2;
  const c = worldToCell(x, z);
  for (let dj = -2; dj <= 2; dj++)
    for (let di = -2; di <= 2; di++) {
      const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
      if (!ob || ob.bedrock || ob.bldgRef) continue;
      const w = cellToWorld(ob.i, ob.j);
      const ox = w.x - x, oz = w.z - z;
      const ahead = ox * dx + oz * dz;          // 진행 방향 성분 (뒤에 있으면 무시)
      if (ahead <= 0 || ahead > reach) continue;
      const perp = ox * -dz + oz * dx;          // 좌우 성분
      if (Math.abs(perp) >= need) continue;     // 이미 옆으로 충분히 비껴 있다
      const push = (need - Math.abs(perp)) / need;
      const sign = perp >= 0 ? -1 : 1;          // 기둥이 있는 반대쪽으로
      sx += -dz * sign * push * 1.6;
      sz += dx * sign * push * 1.6;
    }
  const l = Math.hypot(sx, sz);
  return l > 1e-6 ? { x: sx / l, z: sz / l } : { x: dx, z: dz };
}

// 목표까지 A*로 한 걸음 걷는다 (명령 수행용 공용 이동). 도착했으면 true.
// 채굴 명령과 벽 명령이 같은 경로 캐시를 쓴다 — 둘은 동시에 살아 있지 않다.
function stepToward(gx, gz, stopAt, dt, p = player) {
  if (Math.hypot(gx - p.x, gz - p.z) <= stopAt) { p.orderPath.length = 0; return true; }
  p.orderRepathT -= dt;
  if (p.orderRepathT <= 0 || !p.orderPath.length) {
    p.orderRepathT = 0.45;
    const pass = (i) => canPass(clearHam, i, P.player.radius);
    const res = astar(nearestPassableNav(p.x, p.z, pass), worldToNav(gx, gz), pass, () => 0);
    p.orderPath = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
  }
  while (p.orderPath.length && Math.hypot(p.x - p.orderPath[0].x, p.z - p.orderPath[0].z) < navRes * 0.9)
    p.orderPath.shift();
  const tx = p.orderPath.length ? p.orderPath[0].x : gx;
  const tz = p.orderPath.length ? p.orderPath[0].z : gz;
  let dx = tx - p.x, dz = tz - p.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.03) {
    dx /= dl; dz /= dl;
    const st = steerAroundPosts(p.x, p.z, dx, dz, P.player.radius);
    p.x += st.x * effPlayerSpeed(p) * dt;
    p.z += st.z * effPlayerSpeed(p) * dt;
    p.faceX = st.x; p.faceZ = st.z;
  }
  return false;
}

// 목표를 지을 수 있는 **가장 가까운 자리**를 찾는다 (D67).
// 목표 좌표로 곧장 A*를 돌리면 "목표 지점까지 가는 경로"가 나온다. 그래서 벽 줄 너머가
// 목표일 때 **줄 끝까지 빙 돌아 밖으로 나가** 노출된 채 짓는 그림이 됐다.
// 실제로 필요한 건 "목표에 손이 닿는 가장 가까운 서 있을 자리"다.
// 내 위치에서 BFS로 넓혀가며 **사거리 안에 드는 첫 칸**을 고르면,
// 벽 이쪽 편이면 이쪽 편에서, 은신처 안이면 목표 쪽 틈에서 빼꼼 내밀고 짓게 된다.
function nearestBuildSpot(tx, tz, r, range, p = player) {
  if (!clearHam) return null;
  const pass = (i) => canPass(clearHam, i, r);
  const start = nearestPassableNav(p.x, p.z, pass);
  const seen = new Uint8Array(NAV * NAV);
  const q = [start];
  seen[start] = 1;
  let head = 0;
  while (head < q.length && head < 5000) {
    const cur = q[head++];
    const w = navToWorld(cur);
    if (Math.hypot(w.x - tx, w.z - tz) <= range) return w;
    // **8방향**이어야 한다 (D68). 대각 관문은 대각으로만 지나갈 수 있어서,
    // 4방향 BFS로는 은신처 밖으로 나가는 길을 못 찾는다 (A*는 원래 8방향이다).
    const cx = cur % NAV, cz = (cur / NAV) | 0;
    const push = (n) => { if (!seen[n] && pass(n)) { seen[n] = 1; q.push(n); } };
    const L = cx > 0, R = cx < NAV - 1, U = cz > 0, D = cz < NAV - 1;
    if (L) push(cur - 1);
    if (R) push(cur + 1);
    if (U) push(cur - NAV);
    if (D) push(cur + NAV);
    if (L && U) push(cur - NAV - 1);
    if (R && U) push(cur - NAV + 1);
    if (L && D) push(cur + NAV - 1);
    if (R && D) push(cur + NAV + 1);
  }
  return null;
}

// ---- 벽 명령 (D60) ----
// 클릭 한 번이면 **거기에 지으러 간다는 명령**이 걸린다. 누르고 있을 필요 없다.
//  · 사거리 밖이어도 된다 — 걸어가서 짓는다
//  · 내가 서 있는 자리도 된다 — **살짝 비켜선 뒤** 짓는다
//  · 여러 번 클릭하면 줄줄이 예약된다 (순서대로)
//  · WASD로 직접 움직이면 전부 취소 (개입이 항상 우선 — 채굴 명령과 같은 규칙)
function clearWallOrders(msg, p = player) {
  if (!p.wallOrders.length && !p.wallCast) return;
  p.wallOrders = [];
  p.wallCast = null;
  if (msg) flashMsg(msg, '#9aa3b2');
}

// 그 칸에 지을 수 있는가 (거리·바라보는 방향은 **명령이 알아서 하므로 보지 않는다**)
// p = 명령을 내리는 쪽. 자기 몸은 비켜서면 되므로 막지 않는다 (updateWallOrder 1단계).
// 막는 건 **다른 햄스터**다 — 예전엔 그게 항상 ally였다 (2P에서는 P1일 수도 있다).
function wallSpotOk(i, j, p = player) {
  if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) return '맵 밖입니다';
  if (obstacles.has(cellKey(i, j))) return '이미 뭔가 있음';
  if (nodeAt(i, j)) return '치즈더미 위';
  const w = cellToWorld(i, j);
  const pr = P.wall.post / 2;
  for (const e of enemies)
    if (Math.hypot(w.x - e.x, w.z - e.z) < pr + enemyR(e) + 0.02) return '적이 서 있는 자리';
  for (const q of players) {
    if (q === p || !q.active) continue;
    const qr = radiusOf(q);
    if (Math.hypot(w.x - q.x, w.z - q.z) < pr + qr + 0.02) return '동료가 서 있는 자리';
  }
  return null;
}

function updateWallOrder(dt, p = player) {
  while (p.wallOrders.length) {
    const o = p.wallOrders[0];
    const err = wallSpotOk(o.i, o.j, p);
    if (err) { p.wallOrders.shift(); p.wallCast = null; continue; }   // 상황이 바뀌었으면 건너뛴다
    if (p.cheese < P.wall.cost) { clearWallOrders('치즈가 부족해 벽 명령을 취소', p); return; }
    const w = cellToWorld(o.i, o.j);
    const dCen = Math.hypot(w.x - p.x, w.z - p.z);
    const tooClose = P.wall.post / 2 + P.player.radius + 0.15;

    // 1) 내가 그 자리에 서 있으면 **살짝 비켜선다** (원작 프로브가 자리를 내주듯)
    if (dCen < tooClose) {
      let ax = p.x - w.x, az = p.z - w.z;
      const al = Math.hypot(ax, az);
      if (al < 1e-4) { ax = p.faceX || 1; az = p.faceZ || 0; }
      else { ax /= al; az /= al; }
      const gx = clamp(w.x + ax * (tooClose + 0.2), -HALF + 1, HALF - 1);
      const gz = clamp(w.z + az * (tooClose + 0.2), -HALF + 1, HALF - 1);
      stepToward(gx, gz, 0.12, dt, p);
      p.wallCast = null;
      return;
    }
    // 2) 아직 멀면 걸어간다
    if (dCen > P.wall.range) {
      // 목표가 아니라 **시공 자리**로 간다 (D67). 0.4초마다 다시 고른다.
      o.spotT = (o.spotT || 0) - dt;
      if (!o.spot || o.spotT <= 0) {
        o.spot = nearestBuildSpot(w.x, w.z, P.player.radius, P.wall.range - navRes * 0.5, p);
        o.spotT = 0.4;
      }
      // 격자에 걸리는 자리를 못 찾으면 목표로 직행한다 (조용히 취소하지 않는다).
      // 어차피 매 프레임 사거리를 연속값으로 다시 재므로, 가까워지면 거기서 짓는다.
      if (o.spot) stepToward(o.spot.x, o.spot.z, 0.18, dt, p);
      else stepToward(w.x, w.z, P.wall.range - 0.05, dt, p);
      p.wallCast = null;
      return;
    }

    // 3) 도착 — 그 칸을 보고 잠깐 서서 짓는다 (무방비 구간)
    const fx = w.x - p.x, fz = w.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    p.faceX = fx / fl; p.faceZ = fz / fl;
    if (!p.wallCast || p.wallCast.i !== o.i || p.wallCast.j !== o.j) p.wallCast = { i: o.i, j: o.j, t: 0 };
    p.wallCast.t += dt;
    if (p.wallCast.t >= P.wall.castTime) {
      p.cheese -= P.wall.cost;
      const ob = addObstacle(o.i, o.j, false, false, p.owner);
      // 프레임당 한 번으로 몰아서 계산한다 (D70). 여기서 직접 부르면 둘이 벽을 도배할 때
      // 같은 프레임에 두 번 도는데, refreshClearance는 28,224칸을 네 번 훑는 함수다.
      markNavDirty();
      ob.mesh.scale.y = 0.02;
      ob.mesh.position.y = 0.01;
      popping.push({ ob, t: 0 });
      spawnBuildFx(w.x, w.z);
      p.wallCast = null;
      p.wallOrders.shift();
    }
    return;
  }
}

// ---- 건물 명령 (D66) ----
// 창고·공방·경비탑도 벽(D60)과 같다: 클릭 = "거기에 지으러 가라".
// 걸어가서, 발자국 위에 서 있었다면 비켜서고, 도착하면 D44의 채널링(3~4초 무방비)을 시작한다.
function updateBuildOrder(dt, p = player) {
  const o = p.buildOrder;
  if (!o || p.buildJob) return;
  const err = buildingPlacement(o.i, o.j, o.kind, true);
  if (err) {
    // 적이 지나가는 중이면 근처에서 기다린다. 자리 자체가 사라졌으면 취소.
    if (err !== '적이 서 있는 자리입니다') {
      p.buildOrder = null;
      flashMsg(`건물 명령 취소 — ${err}`, '#e05050');
      return;
    }
  }
  const cx = cellToWorld(o.i, o.j).x + CS / 2, cz = cellToWorld(o.i, o.j).z + CS / 2;
  const d = Math.hypot(cx - p.x, cz - p.z);
  // 발자국(2x2, 반폭 CS) 위에 서 있으면 비켜선다
  const tooClose = CS + P.player.radius + 0.75;
  if (d < tooClose) {
    let ax = p.x - cx, az = p.z - cz;
    const l = Math.hypot(ax, az);
    if (l < 1e-4) { ax = p.faceX || 1; az = p.faceZ || 0; }
    else { ax /= l; az /= l; }
    stepToward(clamp(cx + ax * (tooClose + 0.3), -HALF + 1, HALF - 1),
               clamp(cz + az * (tooClose + 0.3), -HALF + 1, HALF - 1), 0.15, dt, p);
    return;
  }
  const reach = P.wall.range + CS * 0.5;
  if (d > reach) {
    o.spotT = (o.spotT || 0) - dt;
    if (!o.spot || o.spotT <= 0) {
      o.spot = nearestBuildSpot(cx, cz, P.player.radius, reach - navRes * 0.5, p);
      o.spotT = 0.4;
    }
    if (o.spot) stepToward(o.spot.x, o.spot.z, 0.18, dt, p);
    else stepToward(cx, cz, reach - 0.05, dt, p);
    return;
  }
  if (err) return;   // 사거리엔 왔는데 적이 자리에 있다 — 비킬 때까지 대기
  startBuild(o.kind, o.i, o.j, p);
  p.buildOrder = null;
}

function updateMineOrder(dt, p = player) {
  const dep = nearestDepot(p.x, p.z, p.owner);
  let gx, gz, stopAt;
  if (p.carry > 0) {
    if (!dep) { clearMineOrder('부릴 창고가 없다 — 명령 종료', p); return; }
    gx = dep.cx; gz = dep.cz; stopAt = P.depot.dropRange * 0.7;
  } else {
    const pile = p.mineOrder.pile;
    if (!nodes.includes(pile) || pile.amount <= 0) {
      clearMineOrder('치즈더미가 바닥났다 — 명령 종료', p);
      return;
    }
    const w = cellToWorld(pile.i, pile.j);
    gx = w.x; gz = w.z; stopAt = P.carry.range * 0.7;
  }
  stepToward(gx, gz, stopAt, dt, p);
}

// ---- 'E' 안내 빌보드 ----
// 치즈더미에 다가가면 그 더미 위에 뜬다. "여기서 뭘 할 수 있는지"를
// HUD가 아니라 대상 위에서 알려줘야 처음 보는 사람도 바로 안다.
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 문구 길이에 맞춰 캔버스 폭이 늘어난다 — 업그레이드 안내는 비용·부족한 자원에 따라
// 문구가 달라지므로(D84) 다시 그릴 수 있게 그리기를 따로 뺐다.
function drawKeyPrompt(cv, keyLabel, text, accent) {
  const m = cv.getContext('2d');
  m.font = 'bold 22px system-ui, sans-serif';
  const need = Math.ceil(m.measureText(text).width) + 96;
  if (cv.width !== need) cv.width = need;   // 리사이즈하면 컨텍스트 상태가 초기화된다
  const g = cv.getContext('2d');
  const W = cv.width;
  g.clearRect(0, 0, W, cv.height);
  g.fillStyle = 'rgba(16,20,30,0.85)';
  roundRectPath(g, 3, 3, W - 6, 66, 14); g.fill();
  g.strokeStyle = accent; g.lineWidth = 3;
  roundRectPath(g, 3, 3, W - 6, 66, 14); g.stroke();
  g.fillStyle = accent;
  roundRectPath(g, 18, 15, 42, 42, 8); g.fill();
  g.fillStyle = '#14181f';
  g.font = 'bold 26px Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(keyLabel, 39, 37);
  g.fillStyle = '#f4e7c0';
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(text, 74, 38);
}

function makeKeyPrompt(keyLabel, text, accent) {
  const cv = document.createElement('canvas');
  cv.height = 72;
  drawKeyPrompt(cv, keyLabel, text, accent);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  spr.scale.set(cv.width / 102, 0.7, 1);   // 102 = 원래 비율(256px ↔ 2.5)
  spr.renderOrder = 1002;
  spr.visible = false;
  spr.userData = { cv, tex, key: keyLabel, text, accent };
  scene.add(spr);
  return spr;
}

// 문구가 실제로 바뀔 때만 다시 그린다 — 매 프레임 캔버스를 새로 그리면 비싸다
function setKeyPrompt(spr, text, accent) {
  const u = spr.userData;
  if (u.text === text && u.accent === accent) return;
  u.text = text; u.accent = accent;
  drawKeyPrompt(u.cv, u.key, text, accent);
  u.tex.dispose();
  u.tex = new THREE.CanvasTexture(u.cv);
  spr.material.map = u.tex;
  spr.material.needsUpdate = true;
  spr.scale.set(u.cv.width / 102, 0.7, 1);
}

const minePrompt = makeKeyPrompt('E', '채굴 시작', '#f0c040');
// 볼주머니가 차 있으면 "여기서 더 캘 수 없다"를 그 자리에서 알려준다 (D76).
// 예전엔 아무것도 안 떠서, 첫 더미에서만 게이지가 차는 것처럼 보였다.
const fullPrompt = makeKeyPrompt('▣', '볼주머니 가득 — 창고로', '#7fb0ff');
// 공방·경비탑 제자리 업그레이드 안내 (D82) — 같은 [키] 빌보드 문법.
// 문구가 상황에 따라 바뀐다 (D84): 비용 안내 / 부품·치즈 부족 / 상위 공방 필요.
const upgradePrompt = makeKeyPrompt('F', '업그레이드', '#8fd6ff');

// ---- 은신처 표시 (D55-C) ----
// 쫓기는 중일 때만, 가장 가까운 "고양이가 못 들어오는 칸"을 바닥에 표시한다.
// 동료가 은신처를 지어놔도 플레이어가 그 존재를 모르면 아무 의미가 없었다.
// 이 표시는 코어 규칙(틈이 좁아 못 지나간다)의 결과를 눈으로 보여주는 장치이기도 하다.
const safeMark = (() => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x6ee07a, transparent: true, opacity: 0.75,
                                  depthTest: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  ring.renderOrder = 997;
  g.add(ring);
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.8, 4),
    new THREE.MeshBasicMaterial({ color: 0x6ee07a, transparent: true, opacity: 0.85, depthTest: false })
  );
  pin.rotation.x = Math.PI;
  pin.position.y = 1.9;
  pin.renderOrder = 997;
  g.add(pin);
  g.visible = false;
  scene.add(g);
  return g;
})();

function updateSafeMark() {
  const me = localPlayer();
  let near = Infinity;
  for (const e of enemies) near = Math.min(near, Math.hypot(e.x - me.x, e.z - me.z));
  const chased = alive && !me.stunned && enemyActive() && near < P.player.safeMarkRange;
  const spot = chased ? nearestSafeSpot(me.x, me.z, P.player.radius) : null;
  safeMark.visible = !!spot;
  if (!spot) return;
  safeMark.position.set(spot.x, 0, spot.z);
  safeMark.children[1].position.y = 1.9 + Math.sin(performance.now() * 0.005) * 0.15;
}

function updateMinePrompt() {
  const me = localPlayer();
  const show = alive && !me.stunned && !me.mineOrder && !me.buildJob;
  const n = show ? nearestPile(me.x, me.z, P.command.promptRange) : null;
  const full = !!n && me.carry > 0;
  minePrompt.visible = !!n && !full;
  fullPrompt.visible = full;
  if (!n) return;
  const w = cellToWorld(n.i, n.j);
  const y = 2.4 + Math.sin(performance.now() * 0.004) * 0.09;
  (full ? fullPrompt : minePrompt).position.set(w.x, y, w.z);
}

// ---- 공방·경비탑 제자리 업그레이드 (D82) ----
// 근처(4m)의 tier<3 건물에 [F] 안내가 뜬다. 경비탑은 그 위 tier의 공방이
// 실존해야 잠금이 풀린다 — 공방 자체는 언제나 올릴 수 있다(상위 건물 요구 없음).
function nearestUpgradable(x, z, range) {
  let best = null, bestD = range;
  for (const b of buildings) {
    if (b.kind !== 'workshop' && b.kind !== 'tower') continue;
    if ((b.tier || 1) >= 3) continue;
    const d = Math.hypot(b.cx - x, b.cz - z);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

const towerUpgradeLocked = (b) => b.kind === 'tower' && maxWorkshopTier() < (b.tier || 1) + 1;

// ---- F 키 하나로 두 가지 (D90) ----
// **수리가 업그레이드보다 우선이다** — 금 간 벽은 시간이 급하고 업그레이드는 안 급하다.
// 키를 나누지 않은 이유: 둘 다 "근처 내 구조물에 손을 쓴다"라 같은 동작으로 읽힌다.
function nearestCracked(x, z, range) {
  let best = null, bestD = range;
  for (const ob of obstacles.values()) {
    if (ob.bedrock || ob.bldgRef || !ob.cracks) continue;
    const w = cellToWorld(ob.i, ob.j);
    const d = Math.hypot(w.x - x, w.z - z);
    if (d < bestD) { bestD = d; best = ob; }
  }
  return best;
}

// 지금 F가 무엇을 할지 (없으면 null). 빌보드와 F키가 같은 함수를 본다
function fAction(p = player) {
  const crack = nearestCracked(p.x, p.z, P.wall.range + CS);
  if (crack) {
    const cost = P.wall.repairCost;
    return { kind: 'repair', ob: crack, cost,
             x: cellToWorld(crack.i, crack.j).x, z: cellToWorld(crack.i, crack.j).z,
             label: `벽 수리 (금 ${crack.cracks}/${P.wall.crackMax}) — 치즈 ${cost}`,
             why: p.cheese < cost ? `치즈 ${cost} 필요` : null };
  }
  const b = nearestUpgradable(p.x, p.z, 4.0);
  if (!b) return null;
  const s = upgradeSpec(b);
  return { kind: 'upgrade', b, x: b.cx, z: b.cz,
           label: `${BLDG_INFO[b.kind].label} Lv.${(b.tier || 1) + 1} — 치즈 ${s.cost}` +
                  (s.parts > 0 ? ` · 부품 ${s.parts}` : ''),
           why: upgradeBlockedWhy(b, p) };
}

function updateUpgradePrompt() {
  const me = localPlayer();
  const show = alive && !me.stunned && !me.buildJob && !me.upgradeJob && !me.wallCast;
  const a = show ? fAction(me) : null;
  upgradePrompt.visible = !!a;
  if (!a) return;
  // 못 하면 그 이유를, 할 수 있으면 값을 그대로 보여준다 (D84).
  // 눌러보고 나서야 아는 게 아니라 서 있는 동안 이미 보이게.
  setKeyPrompt(upgradePrompt, a.why || a.label, a.why ? '#ff6b6b' : (a.kind === 'repair' ? '#ffb347' : '#8fd6ff'));
  const y = (a.kind === 'repair' ? 2.4 : 2.9) + Math.sin(performance.now() * 0.0045) * 0.09;
  upgradePrompt.position.set(a.x, y, a.z);
}

// 업그레이드 비용/시간 (D82 → 부품은 D84)
//  공방: 치즈 + **부품** — 부품은 밖에서만 주우므로 기술을 올리려면 반드시 나가야 한다
//  경비탑: 치즈만
// 둘 다 단계가 올라갈수록 비싸진다.
function upgradeSpec(b) {
  const tier = b.tier || 1;
  if (b.kind === 'workshop') {
    return tier === 1
      ? { cost: cheeseCost(P.workshop.tier2Cost), parts: P.workshop.tier2Parts, time: P.workshop.tier2Time }
      : { cost: cheeseCost(P.workshop.tier3Cost), parts: P.workshop.tier3Parts, time: P.workshop.tier3Time };
  }
  const next = TOWER_TIERS[tier + 1];
  return { cost: cheeseCost(next.cost()), parts: 0, time: next.time() };
}

// 지금 이 건물을 못 올리는 이유 (없으면 null). 빌보드 문구와 F키가 같은 함수를 본다 —
// 화면에 보이는 이유와 실제 거부 사유가 어긋나지 않게.
function upgradeBlockedWhy(b, p = player) {
  if (towerUpgradeLocked(b)) return `🔒 공방 Lv.${(b.tier || 1) + 1} 필요`;
  const s = upgradeSpec(b);
  if (p.cheese < s.cost) return `치즈 ${s.cost} 필요 (지금 ${Math.floor(p.cheese)})`;
  if (s.parts > 0 && p.parts < s.parts) return `부품 ${s.parts}개 필요 (지금 ${p.parts})`;
  return null;
}

// F키 — 수리가 우선, 없으면 업그레이드 (D90). 빌보드와 같은 fAction()을 본다
function tryUpgradeBuilding(p = player) {
  if (p.upgradeJob || p.buildJob) return;
  const a = fAction(p);
  if (!a) return;
  if (a.why) { flashMsg(a.why, '#e05050'); return; }
  if (a.kind === 'repair') {
    p.cheese -= a.cost;
    repairWall(a.ob);
    spawnBuildFx(a.x, a.z);
    flashMsg('벽을 수리했다', '#6ee07a');
    return;
  }
  const b = a.b;
  const { cost, parts: needParts, time } = upgradeSpec(b);
  p.cheese -= cost;
  p.parts -= needParts;
  // 경비탑 업그레이드는 **한 번에 펑** — 플레이어를 묶지 않는다 (D88).
  // D87에서 경비탑 건설을 자유롭게 한 것과 같은 이유다: 전투 중에 쓰는 물건이라
  // 그 자리에 묶이면 쓸 수가 없다. 공방 업그레이드는 채널링을 유지한다(기술 결정이니까).
  if (b.kind === 'tower') {
    b.tier = (b.tier || 1) + 1;
    applyBuildingTierVisual(b);
    spawnBuildFx(b.cx, b.cz);
    flashMsg(`${BLDG_INFO[b.kind].label} Lv.${b.tier}!`, '#8fd6ff');
    return;
  }
  p.upgradeJob = { b, t: 0, dur: time, cost, parts: needParts };
  flashMsg(`${BLDG_INFO[b.kind].label} 업그레이드 중 — 움직일 수 없다 (ESC 취소)`, '#9fe8a0');
}

function cancelUpgrade(refund = true, p = player) {
  if (!p.upgradeJob) return;
  const { cost, parts: spentParts } = p.upgradeJob;
  p.upgradeJob = null;
  if (refund) { p.cheese += cost; p.parts += spentParts || 0; }
  flashMsg('업그레이드 취소', '#ffb347');
}

function updateUpgradeJob(dt, p = player) {
  if (!p.upgradeJob) return;
  const { b, dur } = p.upgradeJob;
  if (!buildings.includes(b)) { p.upgradeJob = null; return; }   // 적이 부숨
  p.upgradeJob.t += dt;
  if (p.upgradeJob.t >= dur) {
    b.tier = (b.tier || 1) + 1;
    applyBuildingTierVisual(b);
    flashMsg(`${BLDG_INFO[b.kind].label} Lv.${b.tier}!`, '#8fd6ff');
    p.upgradeJob = null;
  }
}

// ---- 일꾼 햄스터 ----
// 치즈더미 ↔ 창고를 자동으로 왕복한다. 한 더미에 붙을 수 있는 수가 제한돼 있어서
// 더 벌려면 새 더미를 확보해야 한다 = 영역 확장 압박 (원작 구조).
function pileCrowd(n) {
  let c = 0;
  for (const w of workers) if (w.pile === n) c++;
  return c;
}

function hireWorker(owner = 'p') {
  const home = ownerOf(owner);
  const mine = workers.filter((w) => w.owner === owner);
  if (mine.length >= P.worker.max) {
    flashFor(home, '일꾼이 너무 많습니다', '#e05050');
    return null;
  }
  const wcost = cheeseCost(P.worker.cost);
  if (purse(owner) < wcost) {
    flashFor(home, `치즈가 부족합니다 (일꾼 ${wcost})`, '#e05050');
    return null;
  }
  const dep = nearestDepot(home.x, home.z, owner);
  if (!dep) {
    flashFor(home, '내 치즈 창고가 있어야 일꾼을 고용합니다', '#e05050');
    return null;
  }
  spend(owner, wcost);
  // 일꾼도 **내 옆에서** 나온다 (동료 것은 동료 옆에서)
  const sp = spawnSpotNear(home.x, home.z, P.worker.radius, mine.length);
  const w = newWorker(owner, nextId(), sp.x, sp.z);
  w.depot = dep;
  spawnBuildFx(w.x, w.z);
  return w;
}

// 순수 생성 — 비용도 조건도 안 본다. 호스트의 hireWorker와
// **클라이언트의 표시용 껍데기**가 같은 생성자를 쓰게 하려고 갈랐다 (D92-6단계).
function newWorker(owner, id, x, z) {
  const vis = makeCarrierVis(owner === 'a' ? 0x93b0e0 : 0xd9c48a);
  vis.group.scale.setScalar(P.worker.radius);
  const w = {
    kind: 'worker', id, x, z,
    faceX: 0, faceZ: 1, carry: 0, pile: null, job: null, owner,
    // forced = 플레이어가 직접 지정한 더미 (자동 재배치가 덮어쓰지 않는다)
    // moveGoal = 이동 명령 목적지 / idle = 명령을 끝내고 대기 중 (스스로 일하지 않음)
    forced: false, moveGoal: null, idle: false,
    path: [], repathT: 0, vis, ring: makeSelRing(0xf0c040, 0.85), depot: null,
    workBar: makeBar(0xf0c040, 0.9),
  };
  workers.push(w);
  return w;
}

function disposeWorker(w) {
  scene.remove(w.vis.group);
  scene.remove(w.ring);
  w.ring.material.dispose();
  disposeBar(w.workBar);
  selectedUnits.delete(w);
}

function clearWorkers(owner) {
  const keep = [];
  for (const w of workers) {
    if (owner === undefined || w.owner === owner) disposeWorker(w);
    else keep.push(w);
  }
  workers.length = 0;
  workers.push(...keep);
}

// ---- 유닛 선택 & 명령 (스타 방식) ----
// 일꾼과 방어병을 **하나의 선택 집합**으로 다룬다 (D51).
// 빈손일 때는 좌클릭/좌드래그가 곧 선택 커서다 — 손에 뭘 들고 있을 때만 건설이다.
// 한 더미의 정원(P.worker.perPile)은 명령으로도 못 넘는다 — D36의 확장 압박이
// 조작 편의로 무너지면 안 되기 때문이다.
const selectedUnits = new Set();

// 내가 명령할 수 있는 유닛 = **내 소유자 태그가 붙은 것**뿐이다 (D92-2단계).
// 예전엔 일꾼만 'p'로 거르고 방어병은 전부 통과시켰다 (방어병에 owner가 없었으니까).
const myUnits = (p = localPlayer()) => [...workers, ...guards].filter((u) => u.owner === p.owner);
const selWorkers = () => [...selectedUnits].filter((u) => u.kind === 'worker' && workers.includes(u));
const selGuards = () => [...selectedUnits].filter((u) => u.kind === 'guard' && guards.includes(u));

// 유닛 집기는 **화면 좌표**로 한다.
// 지면 좌표로 재면 카메라가 기울수록 몸통과 발밑이 어긋나 빗나가고,
// 3인칭 시점에서는 아예 안 잡혔다.
// 적 집기 — 몸집이 크므로 화면 반경을 넉넉히 준다 (자폭묘를 급하게 찍어야 하니까)
function enemyAtScreen(clientX, clientY, maxPx = P.command.pickPx * 1.6) {
  let best = null, bd = maxPx;
  for (const e of enemies) {
    const s = worldToScreen(e.x, 0.8, e.z);
    if (!s) continue;
    const d = Math.hypot(s.x - clientX, s.y - clientY);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function unitAtScreen(clientX, clientY, maxPx = P.command.pickPx) {
  let best = null, bd = maxPx;
  for (const u of myUnits()) {
    const s = worldToScreen(u.x, 0.55, u.z);
    if (!s) continue;
    const d = Math.hypot(s.x - clientX, s.y - clientY);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function commandWorkersToPile(pile, p = localPlayer(), list = selWorkers()) {
  const pw = cellToWorld(pile.i, pile.j);
  const dep = nearestDepot(pw.x, pw.z, p.owner);   // "가까운 (내) 치즈창고"로 나른다
  let sent = 0, full = 0;
  for (const w of list) {
    if (w.pile !== pile && pileCrowd(pile) >= P.worker.perPile) { full++; continue; }
    w.pile = pile;
    w.forced = true;
    w.idle = false;
    w.moveGoal = null;
    if (dep) w.depot = dep;
    w.path.length = 0; w.repathT = 0;
    sent++;
  }
  if (full) flashFor(p, `${full}명은 못 붙는다 — 한 더미에 ${P.worker.perPile}명까지`, '#e05050');
  else if (sent) flashFor(p, `일꾼 ${sent}명 채굴 시작`, '#f0c040');
  if (sent && !dep) flashFor(p, '내 치즈 창고가 없다 — 캐도 부릴 곳이 없다', '#e05050');
}

// 선택된 유닛 전부에게 이동 명령 (일꾼 + 방어병)
function commandUnitsMove(x, z, list = [...selectedUnits].filter((u) => myUnits().includes(u)), p = localPlayer()) {
  // 여러 명이면 황금각으로 흩어 목표를 준다 (한 점에 겹쳐 서지 않게)
  list.forEach((u, k) => {
    const a = k * 2.399963, r = k === 0 ? 0 : 0.6 * Math.sqrt(k);
    const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
    if (u.kind === 'guard') { u.gx = tx; u.gz = tz; }
    else {
      u.moveGoal = { x: tx, z: tz }; u.idle = false; u.forced = false;
      // **더미 자리를 즉시 놓는다** (D102). 예전엔 `pile`을 쥔 채 떠나서
      // 라벨이 계속 `3/3`이었다 — 목적지에 닿으면 idle이 되어 영영 안 캐는데도
      // 자리는 잡고 있으니, 남은 일꾼을 붙일 수가 없었다.
      u.pile = null;
      u.mineT = 0;
    }
    u.path.length = 0; u.repathT = 0;
  });
  if (list.length) flashFor(p, `${list.length}기 이동`, '#9fe8a0');
  return list.length;
}

// 일꾼이 붙을 치즈더미 고르기 — 자리가 남은 것 중 창고에서 가까운 순
function pickPile(w) {
  let best = null, bd = Infinity;
  const dep = w.depot && buildings.includes(w.depot) ? w.depot : nearestDepot(w.x, w.z, w.owner);
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
      disposeWorker(w);
      workers.splice(workers.indexOf(w), 1);
      flashMsg('일꾼이 잡혔다!', '#ff6b6b');
      continue;
    }

    // 이동 명령이 걸려 있으면 일보다 우선한다 (위험할 때 빼낼 수 있어야 한다)
    if (w.moveGoal && Math.hypot(w.moveGoal.x - w.x, w.moveGoal.z - w.z) < 0.6) {
      w.moveGoal = null; w.idle = true; w.path.length = 0;
    }
    const commanded = !!w.moveGoal || w.idle;

    const did = commanded ? null : doCarryWork(w, dt, P.carry.workerLoad, w.owner);
    w.job = did;

    // 목표: 명령이 있으면 그쪽, 없으면 볼주머니가 찼을 때 창고 / 비었을 때 치즈더미
    let gx, gz;
    if (w.moveGoal) {
      gx = w.moveGoal.x; gz = w.moveGoal.z;
    } else if (w.idle) {
      gx = w.x; gz = w.z;
    } else if (w.carry > 0 || (w.pile && w.pile.amount <= 0)) {
      const dep = w.depot && buildings.includes(w.depot) ? w.depot : nearestDepot(w.x, w.z, w.owner);
      if (!dep) continue;
      w.depot = dep;
      gx = dep.cx; gz = dep.cz;
      if (w.pile && w.pile.amount <= 0) { w.pile = null; w.forced = false; }
    } else {
      if (w.pile && w.pile.amount <= 0) { w.pile = null; w.forced = false; }
      if (!w.pile || (!w.forced && pileCrowd(w.pile) > P.worker.perPile)) w.pile = pickPile(w);
      if (!w.pile) {
        const dep = nearestDepot(w.x, w.z, w.owner);
        if (!dep) continue;
        gx = dep.cx; gz = dep.cz;
      } else {
        const nw = cellToWorld(w.pile.i, w.pile.j);
        gx = nw.x; gz = nw.z;
      }
    }

    // 이동 (목표에 충분히 붙었으면 멈춘다)
    const d = Math.hypot(gx - w.x, gz - w.z);
    const stopAt = w.moveGoal ? 0.35 : (did === 'drop' || did === 'mine' ? 0.1 : 1.5);
    if (d > stopAt) {
      w.repathT -= dt;
      if (w.repathT <= 0 || !w.path.length) {
        w.repathT = 0.5;
        const pass = (i) => canPass(clearHam, i, P.worker.radius);
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
        const st = steerAroundPosts(w.x, w.z, dx, dz, P.worker.radius);
        w.x += st.x * effWorkerSpeed() * dt;
        w.z += st.z * effWorkerSpeed() * dt;
        w.faceX = st.x; w.faceZ = st.z;
      }
      collideWithObstacles(w, P.worker.radius);
    }
    w.vis.group.position.set(w.x, 0, w.z);
    w.vis.group.rotation.y = Math.atan2(w.faceX, w.faceZ) + Math.PI;
    w.ring.position.set(w.x, 0.06, w.z);
    w.ring.visible = selectedUnits.has(w);
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
  // 짓는 중에는 쏘지 않는다 (D84) — 채널링 3~4초가 진짜 무방비여야 한다.
  // 예전엔 착공한 프레임부터 바로 사격해서 "짓는 동안 위험하다"가 성립하지 않았다.
  if (b.underBuild) { b.reload = TOWER_TIERS[b.tier || 1].reload(); return; }
  const T = TOWER_TIERS[b.tier || 1];
  // 사거리 안에서 체력이 가장 적은(= 곧 정리할 수 있는) 적을 노려 던진다
  let target = null, best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - b.cx, e.z - b.cz);
    if (d > T.range()) continue;
    if (e.hp < best) { best = e.hp; target = e; }
  }
  const head = b.mesh.userData.head;
  b.reload = (b.reload || 0) - dt;
  if (!target) return;
  if (head) head.rotation.y = Math.atan2(target.x - b.cx, target.z - b.cz) + Math.PI;
  if (b.reload <= 0) {
    // tier가 오를수록 투사체도 커지고 밝아진다 — "이펙트가 강력해짐"
    lobProjectile(b.cx, 1.5, b.cz, target, effTowerDmg(b.tier || 1, ownerOf(b.owner)),
                  1 + ((b.tier || 1) - 1) * 0.5, b.owner);
    b.reload = T.reload();
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
  let broke = 0, cracked = 0;
  for (let dj = -span; dj <= span; dj++)
    for (let di = -span; di <= span; di++) {
      const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
      if (!ob || ob.bedrock || ob.bldgRef) continue;
      if (distCellToPoint(ob.i, ob.j, e.x, e.z) > R) continue;
      // 벽을 없애는 대신 금을 낸다 (D90) — crackMax를 넘긴 것만 무너진다
      if (crackWall(ob)) broke++; else cracked++;
    }
  // 반경 안의 건물·햄스터도 피해
  for (const b of [...buildings])
    if (Math.hypot(b.cx - e.x, b.cz - e.z) < R + 1.2) damageBuilding(b, P.bomber.dmg * 2);
  // 폭풍도 벽을 넘지 않는다. 벽 제거를 먼저 했으므로, **남아 있는 벽**(지형·건물)만
  // 가려준다 — 자기가 뚫은 구멍으로는 그대로 들이친다
  for (const h of players)
    if (h.active && Math.hypot(h.x - e.x, h.z - e.z) < R + 0.6
        && !segmentBlocked(e.x, e.z, h.x, h.z)) hurtHamster(h, P.bomber.dmg);
  for (const g of [...guards])
    if (Math.hypot(g.x - e.x, g.z - e.z) < R + 0.6 && !segmentBlocked(e.x, e.z, g.x, g.z))
      damageGuard(g, P.bomber.dmg * 3);

  scene.remove(e.vis.group);
  disposeBar(e.bar);
  if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); e.homeRing = null; }
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  if (broke) markNavDirty();
  else refreshReach();
  flashMsg(
    broke ? `자폭! 벽 ${broke}칸이 무너졌다`
      : cracked ? `자폭! 벽 ${cracked}칸에 금이 갔다 — F로 수리`
      : '자폭묘가 터졌다',
    '#ff8b5e');
}

// 적 피해 → 처치. 처치하면 치즈를 준다.
// by = 처치 보상을 받을 사람 (D92-2단계). 예전엔 누가 잡든 P1에게 갔다.
function damageEnemy(e, dmg, by = player) {
  e.hp -= dmg;
  e.hitFlash = 0.15;
  if (e.hp > 0) return;
  const reward = P[e.type].reward;
  by.cheese += reward;
  spawnBuildFx(e.x, e.z);
  for (let k = 0; k < 3; k++) spawnCheeseBit(e.x, e.z, null, by);
  scene.remove(e.vis.group);
  disposeBar(e.bar);
  if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); e.homeRing = null; }
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  killCount++;
  // 보스 처치 = 승리 (D83) — "버티기"가 아니라 "실제로 죽이기"가 승리 조건이 된다.
  // 웨이브 보충·탐욕 서지 대상도 아니다 — 1회성 결전이라 여기서 끝낸다.
  if (e.type === 'boss') {
    victory = true;
    overlayEl.querySelector('h1').textContent = '톰을 막아냈다!';
    document.getElementById('overlay-sub').textContent =
      `${MAPS[mapIndex].name} · ${survival.toFixed(0)}초 · 잡힘 ${caughtCount}회 — R 키로 처음부터`;
    overlayEl.classList.remove('hidden');
    return;
  }
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
// ---- 더미별 일꾼 정원 표시 (D90) ----
// `1/3` `3/3`. 정원(D36)은 확장 압박을 만드는 핵심 규칙인데 **화면에 안 보여서**
// 몇 명이 붙었는지 세어 볼 방법이 없었다. 꽉 차면 붉게 — "다음 더미로 가야 한다"가 읽히게.
const pileLabels = new Map();   // node -> sprite

function pileLabelSprite() {
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 48;
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  spr.scale.set(1.35, 0.68, 1);
  spr.renderOrder = 1001;
  scene.add(spr);
  return { spr, cv, tex, text: '' };
}

function drawPileLabel(L, text, full) {
  if (L.text === text) return;
  L.text = text;
  const g = L.cv.getContext('2d');
  g.clearRect(0, 0, 96, 48);
  g.fillStyle = 'rgba(14,18,28,0.82)';
  roundRectPath(g, 4, 8, 88, 32, 9); g.fill();
  g.strokeStyle = full ? '#ff7a5e' : '#7fb0ff'; g.lineWidth = 2.5;
  roundRectPath(g, 4, 8, 88, 32, 9); g.stroke();
  g.fillStyle = full ? '#ffc0ae' : '#dfe9ff';
  g.font = 'bold 22px "SF Mono", Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 48, 25);
  L.tex.dispose();
  L.tex = new THREE.CanvasTexture(L.cv);
  L.spr.material.map = L.tex;
  L.spr.material.needsUpdate = true;
}

function updatePileLabels() {
  for (const n of nodes) {
    let L = pileLabels.get(n);
    if (!L) { L = pileLabelSprite(); pileLabels.set(n, L); }
    // 고갈된 더미는 표시하지 않는다 (일꾼이 붙을 수 없으니 정보가 아니다)
    if (n.amount <= 0) { L.spr.visible = false; continue; }
    const c = pileCrowd(n);
    const max = P.worker.perPile;
    drawPileLabel(L, `${c}/${max}`, c >= max);
    const w = cellToWorld(n.i, n.j);
    L.spr.visible = true;
    L.spr.position.set(w.x, 1.55, w.z);
  }
}

function clearPileLabels() {
  for (const L of pileLabels.values()) {
    scene.remove(L.spr);
    L.tex.dispose();
    L.spr.material.dispose();
  }
  pileLabels.clear();
}

function updateNodes(dt) {
  updatePileLabels();
  for (const n of nodes) {
    const g = n.mesh;
    const frac = Math.max(n.amount, 0) / (P.res.nodeAmount * (n.mul || 1));
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

function makeGuardVis(type) {
  const T = GUARD_TYPES[type];
  const v = makeHamster(T.body);
  applyModel(v, 'worker', T.body, 0.62);
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: T.helm, roughness: 0.6 })
  );
  helm.position.set(0, 2.5, -0.1);
  helm.castShadow = true;
  helm.userData.keep = true;
  v.group.add(helm);
  // 근접병은 등에 짧은 몽둥이, 정예병은 어깨 갑주 — 멀리서도 병종이 읽히게
  if (type === 'melee') {
    const club = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a22, roughness: 0.9 })
    );
    club.position.set(0.85, 1.5, 0.2);
    club.rotation.z = -0.5;
    club.castShadow = true;
    club.userData.keep = true;
    v.group.add(club);
  }
  if (type === 'elite') {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.55, 1.3),
      new THREE.MeshStandardMaterial({ color: T.helm, roughness: 0.45, metalness: 0.35 })
    );
    pad.position.set(0, 1.8, 0);
    pad.castShadow = true;
    pad.userData.keep = true;
    v.group.add(pad);
  }
  v.group.scale.setScalar(T.radius());
  return v;
}

function makeSelRing(color, scale = 1) {
  const ring = new THREE.Mesh(
    selRingGeo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.scale.setScalar(scale);
  ring.renderOrder = 996;
  ring.visible = false;
  scene.add(ring);
  return ring;
}

// 유닛은 **내 옆에서 나온다** — 자리를 찍을 필요가 없다.
// 건물은 어디에 짓느냐가 전략이지만 병력은 아니고, 전투 중에 타일을 조준하는 건
// 조작 부담만 컸다 (특히 자폭묘가 붙는 순간).
function spawnSpotNear(x, z, r, n = 0) {
  for (let t = 0; t < 24; t++) {
    const a = (n + t) * 2.399963;
    const d = 1.6 + t * 0.18;
    const sx = clamp(x + Math.cos(a) * d, -HALF + 1, HALF - 1);
    const sz = clamp(z + Math.sin(a) * d, -HALF + 1, HALF - 1);
    if (clearHam && !canPass(clearHam, worldToNav(sx, sz), r)) continue;
    return { x: sx, z: sz };
  }
  return { x, z };
}

function placeGuard(type = 'archer', p = player) {
  const T = GUARD_TYPES[type];
  // 기술 트리 게이트 (D82) — 공방이 그 등급 이상 실존해야 뽑을 수 있다
  if (maxWorkshopTier() < T.reqTier) {
    flashFor(p, `${T.label}은 공방 Lv.${T.reqTier}이 필요합니다`, '#e05050');
    return null;
  }
  const mine = guardsOf(p.owner);
  const cost = guardCost(type, p.owner);
  if (p.cheese < cost) { flashFor(p, `치즈가 부족합니다 (${T.label} ${cost})`, '#e05050'); return null; }
  if (mine.length >= P.guard.max) { flashFor(p, `방어병이 너무 많습니다 (최대 ${P.guard.max})`, '#e05050'); return null; }
  const w = spawnSpotNear(p.x, p.z, T.radius(), mine.length);
  p.cheese -= cost;
  const g = newGuard(type, p.owner, nextId(), w.x, w.z);
  spawnBuildFx(w.x, w.z);
  return g;
}

// 순수 생성 (newWorker와 같은 이유로 갈랐다 — D92-6단계)
function newGuard(type, owner, id, x, z) {
  const T = GUARD_TYPES[type];
  const maxHp = T.hp();
  const g = {
    kind: 'guard', id, type, owner, x, z, gx: x, gz: z, faceX: 0, faceZ: 1,
    vis: makeGuardVis(type), ring: makeSelRing(0x9fe8a0, 1.05),
    path: [], repathT: 0, reload: 0, focus: null,
    hp: maxHp, maxHp, bar: maxHp > 0 ? makeBar(0x5fd07a, 1.0) : null, swing: 0,
  };
  guards.push(g);
  return g;
}

// 체력이 있는 병종은 깎이고, 사수(체력 0)는 한 방에 쓰러진다
function damageGuard(g, dmg) {
  if (g.maxHp <= 0) { removeGuard(g, true); return; }
  g.hp -= dmg;
  if (g.hp <= 0) removeGuard(g, true);
}

function removeGuard(g, byEnemy) {
  scene.remove(g.vis.group);
  scene.remove(g.ring);
  g.ring.material.dispose();
  if (g.bar) disposeBar(g.bar);
  const k = guards.indexOf(g);
  if (k >= 0) guards.splice(k, 1);
  selectedUnits.delete(g);
  if (byEnemy) { flashFor(ownerOf(g.owner), `${GUARD_TYPES[g.type].label}이(가) 쓰러졌다!`, '#ff6b6b'); spawnBuildFx(g.x, g.z); }
}

// owner를 주면 그 사람 것만 지운다 (D92-2단계).
// **이 필터가 없어서 P1이 잡히면 P2의 군대까지 통째로 사라졌다.**
function clearGuards(owner) {
  for (const g of [...guards]) if (owner === undefined || g.owner === owner) removeGuard(g, false);
  if (owner === undefined) projectiles.length = 0;
}

// 던지기 — 포물선이라 벽을 넘어간다 (경비탑·방어병 공용)
// scale: 경비탑 tier가 오를수록 투사체가 커지고 밝아지게 (D82 — "이펙트 강력해짐")
// owner = 이 투사체를 쏜 쪽. 처치 보상이 그 사람에게 간다 (D92-2단계)
function lobProjectile(x, y, z, e, dmg, scale = 1, owner = 'p') {
  // 참가자 화면에서는 **경비탑이 아무것도 안 하는 것처럼 보였다** (D101).
  // 시뮬은 호스트만 도니까 updateTower가 클라에서 안 돌고, 그래서 포탑 머리도
  // 안 돌고 투사체도 안 날았다. 피해만 조용히 들어가서 "포탑이 공격을 안 한다"가 된다.
  // 던지는 순간을 그대로 알려 주고, 클라는 **피해 없는 껍데기**로 같은 걸 그린다.
  wallEv({ a: 4, x: r2(x), y: r2(y), z: r2(z), e: e.id, s: scale, o: owner });
  const m = new THREE.Mesh(projGeo, scale > 1 ? projMat.clone() : projMat);
  if (scale > 1) {
    m.material.emissiveIntensity = 0.5 + (scale - 1) * 0.6;
    m.material.color.setHex(scale > 1.5 ? 0xffb347 : 0xffe9a8);
  }
  m.scale.setScalar(scale);
  m.position.set(x, y, z);
  m.castShadow = true;
  scene.add(m);
  projectiles.push({
    mesh: m, t: 0, dur: 0.35 + Math.hypot(e.x - x, e.z - z) * 0.045,
    x0: x, y0: y, z0: z, target: e, dmg, owner,
  });
}

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
      // 클라의 투사체는 껍데기다 (dmg 0). 그래도 damageEnemy를 태우면 처치·보상
      // 경로까지 밟으므로 호스트에서만 때린다 (D101).
      if (q.dmg > 0 && netAuthoring() && q.target && enemies.includes(q.target))
        damageEnemy(q.target, q.dmg, ownerOf(q.owner));
      scene.remove(q.mesh);
      if (q.mesh.material !== projMat) q.mesh.material.dispose();
      projectiles.splice(k, 1);
    }
  }
}

function updateGuards(dt) {
  for (const g of [...guards]) {
    const T = GUARD_TYPES[g.type];
    const gr = T.radius();
    // 적과 접촉 — 사수는 즉사(D29 유지), 체력이 있는 병종은 물어뜯긴다
    for (const e of enemies) {
      if (Math.hypot(g.x - e.x, g.z - e.z) >= gr + enemyR(e) - 0.02) continue;
      if (g.maxHp <= 0) { removeGuard(g, true); break; }
      g.hp -= (typeP(e).bldgDps + (e.type === 'boss' ? 0 : threatLevel() * P.threat.dpsGain)) * dt;
      if (g.hp <= 0) { removeGuard(g, true); break; }
    }
    if (!guards.includes(g)) continue;

    // 집중 공격 명령이 있으면 사거리에 들어갈 때까지 쫓아간다
    if (g.focus && enemies.includes(g.focus)) {
      const fd = Math.hypot(g.focus.x - g.x, g.focus.z - g.z) - enemyR(g.focus);
      if (fd > T.range() * 0.8) {
        const a = Math.atan2(g.x - g.focus.x, g.z - g.focus.z);
        const stand = enemyR(g.focus) + T.range() * 0.6;
        g.gx = clamp(g.focus.x + Math.sin(a) * stand, -HALF + 1, HALF - 1);
        g.gz = clamp(g.focus.z + Math.cos(a) * stand, -HALF + 1, HALF - 1);
      }
    } else if (g.focus) g.focus = null;

    // 명령받은 자리로 이동
    const dGoal = Math.hypot(g.gx - g.x, g.gz - g.z);
    if (dGoal > 0.25) {
      g.repathT -= dt;
      if (g.repathT <= 0 || !g.path.length) {
        g.repathT = 0.4;
        const pass = (i) => canPass(clearHam, i, gr);
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
        const st = steerAroundPosts(g.x, g.z, dx, dz, gr);
        g.x += st.x * effGuardSpeed() * dt;
        g.z += st.z * effGuardSpeed() * dt;
        g.faceX = st.x; g.faceZ = st.z;
      }
      collideWithObstacles(g, gr);
    } else {
      g.path.length = 0;
    }

    // 사거리 안 적을 친다 — 사수/정예병은 던지고(벽을 넘음), 근접병은 후려친다.
    // 거리는 **적의 몸 표면까지**로 잰다. 중심 거리로 재면 반지름 1.35짜리 순찰묘는
    // 몸이 닿아도 중심이 1.7m 밖이라 근접병이 영원히 못 때린다.
    g.reload -= dt;
    if (g.focus && !enemies.includes(g.focus)) g.focus = null;
    let tgt = null, bd = T.range(), best = Infinity;
    // 1) 집중 공격 명령이 살아 있으면 그 적이 최우선
    if (g.focus) {
      const d = Math.hypot(g.focus.x - g.x, g.focus.z - g.z) - enemyR(g.focus);
      if (d < T.range()) { tgt = g.focus; bd = d; }
    }
    // 2) 아니면 사거리 안에서 고른다. **자폭묘가 우선** — 벽을 부수는 유일한 존재라
    //    먼저 끊지 않으면 방어선이 통째로 날아간다 (조작 없이도 그건 해줘야 한다)
    if (!tgt) {
      for (const e of enemies) {
        const d = Math.hypot(e.x - g.x, e.z - g.z) - enemyR(e);
        if (d >= T.range()) continue;
        const score = d * (e.type === 'bomber' ? P.guard.bomberBias : 1);
        if (score < best) { best = score; bd = d; tgt = e; }
      }
    }
    if (tgt) {
      const dc = Math.max(Math.hypot(tgt.x - g.x, tgt.z - g.z), 0.001);
      g.faceX = (tgt.x - g.x) / dc; g.faceZ = (tgt.z - g.z) / dc;
      if (g.reload <= 0) {
        const dmg = effGuardDmg(g.type, ownerOf(g.owner));   // 방어병 화력 업그레이드 반영 (D87)
        if (T.melee) { damageEnemy(tgt, dmg, ownerOf(g.owner)); g.swing = 0.22; }
        else lobProjectile(g.x, 0.9, g.z, tgt, dmg, 1, g.owner);
        g.reload = T.reload();
      }
    }

    // 근접 휘두르기 모션 (앞으로 움찔)
    g.swing = Math.max((g.swing || 0) - dt, 0);
    const lunge = g.swing > 0 ? Math.sin((0.22 - g.swing) / 0.22 * Math.PI) * 0.3 : 0;
    g.vis.group.position.set(g.x + g.faceX * lunge, 0, g.z + g.faceZ * lunge);
    g.vis.group.rotation.y = Math.atan2(g.faceX, g.faceZ) + Math.PI;
    g.vis.group.scale.setScalar(gr);
    g.ring.position.set(g.x, 0.06, g.z);
    g.ring.visible = selectedUnits.has(g);
    if (g.bar) setBar(g.bar, g.hp / g.maxHp, g.x, barY(g.vis), g.z, g.hp < g.maxHp - 0.5);
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
  if (!netAuthoring()) return;   // 스폰은 호스트만 (D92-6단계)
  const spot = randomOpenCell();
  if (!spot) return;
  spawnPickupLocal(Math.random() < P.pickup.partsRatio ? 'parts' : 'cheese', spot.x, spot.z, nextId());
}

// 표시용 생성 — 클라가 스냅샷을 보고 같은 걸 만들 수 있게 갈랐다 (D92-6단계)
function spawnPickupLocal(kind, x, z, id) {
  const isParts = kind === 'parts';
  const mesh = new THREE.Mesh(
    isParts ? partGeo : pileGeo,
    new THREE.MeshStandardMaterial({
      color: isParts ? 0x8fd6ff : 0xffd24a,
      roughness: 0.4,
      emissive: new THREE.Color(isParts ? 0x2b8fd6 : 0xf0b429),
      emissiveIntensity: 0.7,
    })
  );
  mesh.position.set(x, 0.5, z);
  mesh.castShadow = true;
  scene.add(mesh);
  const u = { kind, id, x, z, mesh, t: 0 };
  pickups.push(u);
  return u;
}

// 후반일수록 부품이 더 자주·더 많이 나온다 (D87) — 적이 단단해지는 만큼 밖에 나갈 값어치가 커진다
const effPickupInterval = () =>
  Math.max(P.pickup.interval - (stage - 1) * P.pickup.stageSpeedup, 4);
const effPickupMax = () =>
  Math.round(P.pickup.maxOnMap + (stage - 1) * P.pickup.stageOnMap);
const effPartsEach = () =>
  P.pickup.partsEach + Math.floor((stage - 1) * P.pickup.stageParts);

function updatePickups(dt) {
  pickupT += dt;
  if (pickupT >= effPickupInterval()) {
    pickupT = 0;
    if (pickups.length < effPickupMax()) spawnPickup();
  }
  for (let k = pickups.length - 1; k >= 0; k--) {
    const u = pickups[k];
    u.t += dt;
    u.mesh.rotation.y += dt * 2;
    u.mesh.position.y = 0.5 + Math.sin(u.t * 3) * 0.12;
    // 밟은 쪽이 가져간다 (D92-1e). 예전엔 동료가 밟아도 P1 지갑으로 들어갔는데,
    // 2P에서는 그게 곧 "P2가 주운 부품이 P1 것이 된다"가 된다.
    let taker = null;
    for (const q of players) {
      if (!q.active || q.stunned) continue;
      if (Math.hypot(q.x - u.x, q.z - u.z) < 1.1) { taker = q; break; }
    }
    if (!taker) continue;
    if (u.kind === 'parts') {
      const n = effPartsEach();
      taker.parts += n;
      if (taker.local) flashMsg(`부품 +${n} (U: 업그레이드)`, '#8fd6ff');
    } else {
      taker.cheese += P.pickup.cheeseEach;
      if (taker.local) flashMsg(`치즈 +${P.pickup.cheeseEach}`, '#ffd24a');
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
// 장애물의 실제 물리 반폭 (D57).
// **플레이어가 세운 벽은 셀 전체가 아니라 가운데 기둥**이다 — 원작 파일런처럼.
//   · 직교로 붙인 두 기둥 사이 틈 = CS - post  (플레이어도 못 지나감 = 벽)
//   · 대각으로 붙인 두 기둥 사이 틈 = √2 × (CS - post)  (**플레이어만 통과**)
// 지형(bedrock)과 건물은 예전처럼 셀을 꽉 채운다.
// 충돌 반폭. 지형은 셀을 꽉 채우고, 건물은 inset만큼 안으로 들이며(D84 — 대각 틈이
// 생겨 플레이어만 빠져나간다), 플레이어 벽은 원기둥이라 post/2다 (D57·D59).
const obHalf = (ob) =>
  ob.bedrock ? CS / 2
  : ob.bldgRef ? Math.max(CS / 2 - P.build.inset, 0.1)
  : P.wall.post / 2;

function collideWithObstacles(ent, r) {
  for (let pass = 0; pass < 3; pass++) {
    const c = worldToCell(ent.x, ent.z);
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
        if (!ob) continue;
        const w = cellToWorld(ob.i, ob.j);
        // 기둥(플레이어 벽)은 원기둥 — 원-원 밀어내기
        if (!ob.bedrock && !ob.bldgRef) {
          const pr = P.wall.post / 2;
          let dx = ent.x - w.x, dz = ent.z - w.z;
          let d = Math.hypot(dx, dz);
          const need = pr + r;
          if (d >= need) continue;
          if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
          ent.x = w.x + (dx / d) * need;
          ent.z = w.z + (dz / d) * need;
          continue;
        }
        const h = obHalf(ob);
        const x0 = w.x - h, x1 = w.x + h;
        const z0 = w.z - h, z1 = w.z + h;
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
  if (!ob.bedrock && !ob.bldgRef)
    return Math.max(Math.hypot(ent.x - w.x, ent.z - w.z) - P.wall.post / 2, 0);
  const h = obHalf(ob);
  const px = clamp(ent.x, w.x - h, w.x + h);
  const pz = clamp(ent.z, w.z - h, w.z + h);
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
  for (const q of players) if (q.active && !q.stunned) out.push(q);
  return out;
}

// 햄스터의 이동 속도를 추정해 둔다 (리드 조준용). 매 프레임 한 번.
// 좌표 차분을 지수평활해서 순간적인 흔들림에 적이 휘둘리지 않게 한다.
function trackTargetVelocity(dt) {
  if (dt <= 0) return;
  for (const t of players) {
    if (t.pvx === undefined) { t.pvx = t.x; t.pvz = t.z; t.vx = 0; t.vz = 0; }
    const nx = (t.x - t.pvx) / dt, nz = (t.z - t.pvz) / dt;
    const a = Math.min(1, dt * 6);
    t.vx += (nx - t.vx) * a;
    t.vz += (nz - t.vz) * a;
    t.pvx = t.x; t.pvz = t.z;
  }
}

// 리드 조준 — 목표의 "지금"이 아니라 "곧 있을 자리"를 노린다 (D55-B).
// leadTime이 0이면 예전과 같다. 너무 키우면 도망 자체가 불가능해지므로 슬라이더로 조절.
function aimPoint(t) {
  const lt = P.enemy.leadTime;
  if (!lt) return { x: t.x, z: t.z };
  return {
    x: clamp(t.x + (t.vx || 0) * lt, -HALF + 1, HALF - 1),
    z: clamp(t.z + (t.vz || 0) * lt, -HALF + 1, HALF - 1),
  };
}

// 이 적이 차단조인가 — 링 슬롯 번호로 결정해 무리마다 일정 비율이 배정된다
function isCutoff(enemy, target) {
  if (P.enemy.cutoffShare <= 0) return false;
  const peers = [];
  for (const o of enemies) if (o === enemy || o.chaseTarget === target) peers.push(o);
  if (peers.length < 3) return false;   // 둘뿐이면 둘 다 쫓는 게 낫다
  peers.sort((a, b) => a.id - b.id);
  const k = peers.indexOf(enemy);
  return k / peers.length < P.enemy.cutoffShare;
}

// 노릴 햄스터 고르기 (D49 → D91) — "가장 가까운 하나"로 전원이 몰리지 않게 세 가지를 섞는다.
//  1) 재선택마다 새로 뽑는 편향(pickBias) — 같은 자리에서도 서로 다른 쪽을 본다
//  2) 이미 그쪽을 노리는 적이 많으면 덜 매력적 (crowdAvoid) — 무리가 갈라진다
//  3) **오래 쫓을수록 그 목표가 덜 매력적** (switchPush) — 시간이 지나면 저절로 갈린다
// 멀티에서 플레이어가 늘어나면 이 함수의 후보 목록만 늘어나면 된다.
//
// 3번이 D91에서 추가된 이유: 1·2번만으로는 **한 번 몰리면 계속 몰렸다.**
// targetHold(3초)가 만료돼도 같은 점수식이 다시 돌아 거의 항상 같은 목표가 이겼고,
// allyBias는 스폰 때 고정이라 "플레이어를 선호하는 적"은 평생 그랬다.
// 시간 항이 있어야 목표가 실제로 **돌아간다**.
function pickChaseTarget(enemy) {
  const ts = chaseTargets();
  if (!ts.length) return null;
  // 한 번 정한 목표는 잠깐 유지한다 — 매 재계산마다 흔들리면 제자리에서 갈팡질팡한다
  if (enemy.chaseTarget && ts.includes(enemy.chaseTarget) && survival < (enemy.targetUntil || 0))
    return enemy.chaseTarget;
  // 재선택 시점마다 편향을 새로 뽑는다 (스폰 고정이 아니다).
  // 같은 무리가 매번 다르게 갈리고, 플레이어가 셋 이상이어도 그대로 성립한다.
  const bias = new Map();
  for (const t of ts) bias.set(t, 0.78 + Math.random() * 0.44);
  const stuckT = survival - (enemy.targetSince ?? survival);
  const ct = enemy.chaseTarget;
  const engaged = !!ct &&
    Math.hypot(enemy.x - ct.x, enemy.z - ct.z) < P.enemy.engageDist;
  const score = (t) => {
    let s = Math.hypot(t.x - enemy.x, t.z - enemy.z) * bias.get(t);
    // 도발 중인 햄스터는 **훨씬 가까워 보인다** (D96). 사거리 안에서만 통한다 —
    // 맵 반대편까지 끌면 그건 버튼 하나로 판을 뒤집는 것이지 미끼 플레이가 아니다
    if (t.tauntT > 0 && Math.hypot(t.x - enemy.x, t.z - enemy.z) < P.coop.tauntRange)
      s -= P.coop.tauntPull;
    let crowd = 0;
    for (const o of enemies) if (o !== enemy && o.chaseTarget === t) crowd++;
    // 붐빔은 거리로 환산해 **더한다**. 곱셈이면 코앞(거리≈0)에서 효과가 사라져
    // 결국 전원이 한 명에게 달라붙는다 — 그게 바로 "한쪽에 몰림"의 원인이었다.
    s += crowd * P.enemy.crowdAvoid * 10;
    // 지금 쫓고 있는 놈이면, 쫓은 시간만큼 더 멀어 보이게 한다 = 집착 피로
    // 이미 붙어 있는(= 곧 때릴) 목표는 피로를 안 쌓는다 — 잡기 직전에 안 버린다
    if (t === enemy.chaseTarget && !engaged)
      s += Math.min(stuckT * P.enemy.switchPush, P.enemy.switchCap);
    return s;
  };
  let best = null, bs = Infinity;
  for (const t of ts) { const s = score(t); if (s < bs) { bs = s; best = t; } }
  // 진동 방지는 위의 targetHold가 맡는다. 여기서 여유 마진까지 두면
  // 점수가 엇비슷한 구간(= 갈라져야 할 바로 그 구간)에서 아무도 안 갈라진다.
  enemy.targetUntil = survival + P.enemy.targetHold;
  // 목표가 **실제로 바뀔 때만** 피로를 리셋한다 (재계산마다 리셋하면 항이 죽는다)
  if (best !== enemy.chaseTarget) enemy.targetSince = survival;
  return best;
}

// 포위 링 (D49) — 같은 목표를 노리는 적들에게 **둘레의 균등한 자리**를 배정한다.
// id 순으로 줄 세워 2π/n 간격의 슬롯을 주고, 링 전체를 ringPhase 속도로 돌린다.
//   → 목표를 중심으로 뱅글뱅글 도는 포위진이 된다.
// 서로 밀쳐내는 방식(각도 반발)은 값이 요동쳐서 제자리에서 떠는 것처럼 보였다.
// 슬롯 배정은 결정적이라 흔들리지 않고, 막힌 방향은 뒤의 후보 훑기가 처리한다.
// probeOff는 각자의 흔들림 — 막히면 커져서 제 슬롯 옆을 훑고, 풀리면 슬롯으로 돌아온다.
let ringPhase = 0;

function ringAngleFor(enemy, target) {
  const peers = [];
  for (const o of enemies) if (o === enemy || o.chaseTarget === target) peers.push(o);
  peers.sort((a, b) => a.id - b.id);
  const k = Math.max(0, peers.indexOf(enemy));
  const n = Math.max(1, peers.length);
  return ringPhase + (Math.PI * 2 * k) / n + (enemy.probeOff || 0);
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
  // ---- 순찰조 (D52) ----
  // 시야 안에 햄스터가 들어오면 추격 시간이 채워지고, 그동안은 아래의 일반 추격을 탄다.
  // 시간이 다 되면 제 초소로 돌아가 둘레를 돈다 — "따라오다 포기하고 돌아가는" 그림.
  if (gx === null && enemy.patrol) {
    const hd0 = Math.hypot(enemy.homeX - enemy.x, enemy.homeZ - enemy.z);
    if (hd0 > P.patrol.leash) {
      // 줄이 끊겼다 — 시간이 남았어도 무조건 복귀한다.
      // 시간만으로 끊으면, 쫓아가서 따라잡을 때마다 시야에 다시 걸려 영원히 쫓는다.
      enemy.aggroT = 0;
      enemy.leashCd = P.patrol.leashCool;
    } else if (!(enemy.leashCd > 0)) {
      let sd = P.patrol.sight;
      for (const t of chaseTargets()) {
        const d = Math.hypot(t.x - enemy.x, t.z - enemy.z);
        if (d < sd) { sd = d; enemy.aggroT = P.patrol.chaseTime; }
      }
    }
    if (!(enemy.aggroT > 0)) {
      const hd = hd0;
      let px, pz;
      if (hd > P.patrol.radius * 1.7) {
        px = enemy.homeX; pz = enemy.homeZ;      // 아직 멀다 → 초소로 복귀
      } else {
        for (const off of [0, 0.6, 1.2, 1.9, 2.6, Math.PI]) {
          for (const sgn of off === 0 ? [1] : [1, -1]) {
            const a = enemy.patrolA + sgn * off;
            const cx = clamp(enemy.homeX + Math.cos(a) * P.patrol.radius, -HALF + 1, HALF - 1);
            const cz = clamp(enemy.homeZ + Math.sin(a) * P.patrol.radius, -HALF + 1, HALF - 1);
            if (canPass(clearAll, worldToNav(cx, cz), er)) { px = cx; pz = cz; break; }
          }
          if (px !== undefined) break;
        }
        if (px === undefined) { px = enemy.homeX; pz = enemy.homeZ; }
      }
      enemy.chaseTarget = null;
      enemy.goalX = px; enemy.goalZ = pz;
      const pr = astar(start, worldToNav(px, pz), passAll, () => 0);
      enemy.path = pr.path.map((idx) => ({ ...navToWorld(idx), idx }));
      enemy.aiMode = hd > P.patrol.radius * 1.7 ? '복귀' : '순찰';
      return;
    }
  }

  let chased = null;
  if (gx === null) {
    const tBest = pickChaseTarget(enemy);
    if (!tBest) { enemy.path = []; enemy.aiMode = '배회'; enemy.chaseTarget = null; return; }
    chased = tBest;
    enemy.chaseTarget = tBest;
    enemy.approachA = ringAngleFor(enemy, tBest);

    // ---- 차단조: 목표가 아니라 **목표의 퇴로**를 막는다 (D55-B) ----
    // 도망칠 곳 = 가장 가까운 은신처(적이 못 들어가는 칸). 그 사이를 미리 끊는다.
    // 이게 성립하려면 은신처 판별이 코어 규칙에서 나와야 한다 → nearestSafeSpot.
    if (isCutoff(enemy, tBest)) {
      const safe = nearestSafeSpot(tBest.x, tBest.z, P.player.radius);
      if (safe) {
        let dx = safe.x - tBest.x, dz = safe.z - tBest.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 1.5) {
          const f = Math.min(1, (dl - 0.5) / dl) * Math.min(1, P.enemy.cutoffLead / dl);
          const cx = clamp(tBest.x + dx * f, -HALF + 1, HALF - 1);
          const cz = clamp(tBest.z + dz * f, -HALF + 1, HALF - 1);
          const cIdx = worldToNav(cx, cz);
          if (canPass(clearAll, cIdx, er) && (!enemyReach || enemyReach[cIdx])) {
            enemy.goalX = cx; enemy.goalZ = cz;
            const cr = astar(start, cIdx, passAll, () => 0);
            if (cr.found) {
              enemy.path = cr.path.map((idx) => ({ ...navToWorld(idx), idx }));
              enemy.aiMode = '차단';
              enemy.lostX = tBest.x; enemy.lostZ = tBest.z; enemy.lostT = survival;
              return;
            }
          }
        }
      }
    }

    const aim = aimPoint(tBest);
    const tD = Math.hypot(tBest.x - enemy.x, tBest.z - enemy.z);
    // 직진만 하지 않는다 — 목표 둘레의 "접근 지점"을 노린다 (D28).
    // 각 적이 서로 다른 각도(approachA)를 갖고, 반경은 거리에 비례해 줄어든다.
    // → 멀리서는 서로 다른 방향으로 벌어져 오다가 가까워지며 조여든다(나선형).
    // 접근 반경은 0으로 줄어들지 않는다 (D49).
    // 예전에는 1.5m 안으로 들어오면 전원이 **플레이어의 정확히 같은 좌표**를 노려서
    // 한 점에 뭉쳤다. 최소한 제 몸 반지름만큼 떨어진 둘레 지점을 노리게 두면
    // 공격 사거리(er+hr+0.6) 안에는 여전히 들어오면서 몸은 둘러싸는 모양이 된다.
    const rMin = er * 0.95;
    if (tD < rMin * 0.7) {
      gx = tBest.x; gz = tBest.z;                 // 이미 몸이 겹칠 만큼 붙었으면 직진
    } else {
      // 링의 중심은 목표의 **곧 있을 자리**(리드 조준)다
      // 접근 지점 후보를 접근각에서 좌우로 훑는다 (D49).
      // 한 각도가 막혔다고 바로 "목표 직행"으로 무너지면 전원이 같은 지점으로 몰려
      // 벽 한쪽 면에 정체된다. 설 수 있는 각을 찾을 때까지 둘레를 훑는 게 핵심이다.
      const r = Math.max(rMin, Math.min(P.enemy.flankRadius, tD * 0.55));
      const dir = enemy.orbitDir;
      for (const off of [0, 0.45, 0.95, 1.5, 2.1, Math.PI]) {
        for (const sgn of off === 0 ? [1] : [dir, -dir]) {
          const a = enemy.approachA + sgn * off;
          const ax = clamp(aim.x + Math.cos(a) * r, -HALF + 1, HALF - 1);
          const az = clamp(aim.z + Math.sin(a) * r, -HALF + 1, HALF - 1);
          const idx = worldToNav(ax, az);
          if (!canPass(clearAll, idx, er)) continue;
          if (enemyReach && !enemyReach[idx]) continue;   // 도달 못 하는 구역이면 무의미
          gx = ax; gz = az;
          break;
        }
        if (gx !== null) break;
      }
      if (gx === null) { gx = aim.x; gz = aim.z; }
    }
  }
  enemy.goalX = gx; enemy.goalZ = gz;
  const goal = worldToNav(gx, gz);

  // 근사 도달을 인정할지 판정한다 (D85).
  // A*가 목표에 못 닿아도 "거의 닿았다"(closestWorld < tol)면 추격으로 쳐 줬는데,
  // **은신처 밖에서는 이게 영원히 참이었다** — 고양이가 기둥 바로 앞까지는 가니까.
  // 그 결과 무리가 은신처 둘레에 뭉쳐 선 채 건물 습격으로 넘어가질 않았다.
  // 이제 근사 도달은 **그 자리에서 실제로 손이 닿을 때만** 인정한다.
  // (벽에 등을 붙인 플레이어처럼 격자 오차로 경로가 안 잡히는 경우는 그대로 살아난다)
  //
  // 그리고 **한 대도 못 때린 채 오래 쫓았으면** 근사 도달을 아예 인정하지 않는다 (D85).
  // 은신처는 대각선 시야가 뚫려 있어 "닿을 것 같은데 안 닿는" 상태가 계속 성립한다 —
  // 그 상태로 붙잡혀 있으면 무리 전체가 문 앞에 굳는다. 못 잡겠으면 살림을 뜯으러 간다.
  const frustrated = (enemy.noHitT || 0) > P.enemy.raidPatience && buildings.length > 0;
  const nearOk = (r, tol, target) => {
    if (r.found) return true;
    if (frustrated) return false;
    if (r.closestWorld >= tol || !r.path.length) return false;
    if (!target) return true;                       // 미끼 등 — 예전 동작 유지
    const near = navToWorld(r.path[r.path.length - 1]);
    return !segmentBlocked(near.x, near.z, target.x, target.z);
  };

  // ---- 직행 경로 ----
  let res = astar(start, goal, passAll, () => 0);
  if (nearOk(res, 1.3 + (raiding ? enemyR(enemy) : 0), raiding ? null : chased)) {
    // 닿을 수 있었던 마지막 자리를 기억해 둔다 (나중에 길이 끊기면 여기로 온다)
    if (chased) { enemy.lostX = chased.x; enemy.lostZ = chased.z; enemy.lostT = survival; }
    enemy.campT = 0;
    enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
    enemy.aiMode = raiding ? '습격' : '추격';
    return;
  }
  // 접근 지점까지는 못 가도 목표 본체까지는 갈 수 있는 경우가 있다.
  // 여기서 안 되짚으면 멀쩡히 쫓을 수 있는데도 '돌파/습격'으로 새 버린다.
  if (chased && (gx !== chased.x || gz !== chased.z)) {
    const direct = astar(start, worldToNav(chased.x, chased.z), passAll, () => 0);
    if (nearOk(direct, 1.3, chased)) {
      enemy.lostX = chased.x; enemy.lostZ = chased.z; enemy.lostT = survival;
      enemy.campT = 0;
      enemy.goalX = chased.x; enemy.goalZ = chased.z;
      enemy.path = direct.path.map((idx) => ({ ...navToWorld(idx), idx }));
      enemy.aiMode = '추격';
      return;
    }
    res = direct.closestWorld < res.closestWorld ? direct : res;
  }

  // ---- 돌파 경로: 가로막는 아군 구조물을 부수며 뚫고 온다 ----
  // 파괴묘: 벽+건물 전부 / 순찰묘·날쌘묘: 건물만 (벽은 여전히 절대 못 부숨)
  const obAt = (idx) => obstacles.get(cellKey(((idx % NAV) / NAVPC) | 0, (((idx / NAV) | 0) / NAVPC) | 0));
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
  // 건물마다 A*를 돌리면 건물이 늘수록 재계산이 선형으로 무거워진다 (D79).
  // 가까운 세 개만 본다 — 어차피 먼 건물로는 안 간다.
  let raidBest = null, raidPath = null, raidD = Infinity;
  const raidCands = buildings
    .map((b) => ({ b, d: Math.hypot(b.cx - enemy.x, b.cz - enemy.z) }))
    .sort((a, c) => a.d - c.d).slice(0, 3).map((o) => o.b);
  for (const b of raidCands) {
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
  // ---- 잠복: 틈 앞에 자리 잡고 기다린다 (D55-A) ----
  // 여기까지 왔다 = 목표에 닿는 길이 없다. 예전에는 무작위로 배회했는데,
  // 그건 "포기했다"로 보였다. 대신 **내가 갈 수 있는 곳 중 목표에 가장 가까운 지점**
  // (= 대개 그 좁은 틈의 바로 앞)에 자리를 잡는다.
  // 플레이어는 결국 채굴하러 나와야 하므로, 기다리는 게 실제로 합리적인 행동이다.
  if (chased && P.enemy.campTime > 0) {
    const endIdx = res.path.length ? res.path[res.path.length - 1] : start;
    const camp = navToWorld(endIdx);
    // 목표를 등지고 멀어지는 자리면 잠복할 이유가 없다
    const dCamp = Math.hypot(camp.x - chased.x, camp.z - chased.z);
    const dSelf = Math.hypot(enemy.x - chased.x, enemy.z - chased.z);
    if (dCamp < dSelf + 1.0) {
      if (!(enemy.campT > 0)) enemy.campT = P.enemy.campTime;
      enemy.goalX = camp.x; enemy.goalZ = camp.z;
      enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
      enemy.aiMode = '잠복';
      return;
    }
  }

  // ---- 마지막으로 닿았던 자리 수색 (D55-A) ----
  // 잠복도 못 하면, 최근에 목표에 닿을 수 있었던 지점으로 가서 훑는다.
  if (enemy.lostX !== undefined && survival - enemy.lostT < P.enemy.memoryTime) {
    const lr = astar(start, worldToNav(enemy.lostX, enemy.lostZ), passAll, () => 0);
    if (lr.found) {
      enemy.goalX = enemy.lostX; enemy.goalZ = enemy.lostZ;
      enemy.path = lr.path.map((idx) => ({ ...navToWorld(idx), idx }));
      enemy.aiMode = '수색';
      return;
    }
  }

  enemy.path = res.path.map((idx) => ({ ...navToWorld(idx), idx }));
  enemy.aiMode = '배회';
}

// 두 점 사이에 **막힌 칸이 하나라도 있으면** true.
// 벽 너머 공격을 막는 데 쓴다 — 몸집이 커서 벽 반대편에 있어도 사거리(2.3m) 안에
// 들어오는 일이 생겼고, 그때 벽을 뚫고 때리는 것처럼 보였다.
// 통행 판정(clearance)이 아니라 **셀 점유**로 재는 게 핵심 — 손이 닿느냐의 문제다.
// ignoreBldg: **그 건물 자신은 시야를 가리지 않는다** (D85).
// 건물을 때릴 수 있는지 볼 때 목표는 건물 중심인데, 그 선분은 당연히 그 건물의 칸을
// 지난다. 자기 자신을 장애물로 세면 "건물 앞에 서 있는데 못 때리는" 상태가 된다.
function segmentBlocked(x0, z0, x1, z1, ignoreBldg = null) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ux = dx / len, uz = dz / len;
  const steps = Math.max(1, Math.ceil(len / (CS * 0.4)));
  const checked = new Set();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const c = worldToCell(x0 + dx * t, z0 + dz * t);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const key = cellKey(c.i + di, c.j + dj);
        if (checked.has(key)) continue;
        checked.add(key);
        const ob = obstacles.get(key);
        if (!ob) continue;
        if (ignoreBldg && ob.bldgRef === ignoreBldg) continue;   // 자기 자신은 안 센다
        const w = cellToWorld(ob.i, ob.j);
        // 선분에서 이 장애물 중심까지의 최단 거리
        const proj = clamp((w.x - x0) * ux + (w.z - z0) * uz, 0, len);
        const nx = x0 + ux * proj, nz = z0 + uz * proj;
        if (ob.bedrock || ob.bldgRef) {
          // 건물도 충돌과 같은 inset을 쓴다 (D84) — 안 그러면 대각 틈에 선 플레이어가
          // 아무도 못 때리는 무적 지대가 된다 (기둥에서 겪은 D65와 같은 함정)
          const bh = obHalf(ob);
          if (Math.abs(w.x - nx) <= bh && Math.abs(w.z - nz) <= bh) return true;
        } else if (Math.hypot(w.x - nx, w.z - nz) < P.wall.post / 2) {
          // 기둥은 **원**이다 (D65). 셀로 재면 기둥 옆 빈틈까지 가려져서,
          // 기둥 두 개 사이에 서 있으면 아무도 못 때리는 무적 지대가 생겼다.
          return true;
        }
      }
  }
  return false;
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
    for (let k = 0; k < scaled(cnt); k++) enemies.push(makeEnemy(ty, enemies.length));
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
  const c = { chaser: scaled(P.enemy.count), runner: 0, bomber: 0 };
  for (let k = 0; k < Math.min(stage, STAGES.length); k++)
    for (const [ty, n] of Object.entries(STAGES[k].add)) c[ty] += scaled(n);
  return c;
}

function topUpToCurve() {
  const want = cumulativeComposition();
  const have = { chaser: 0, runner: 0, bomber: 0 };
  // 순찰조는 웨이브 구성과 별개다 (죽여도 웨이브가 대신 채워주지 않는다 = 정리한 보람)
  for (const e of enemies) if (!e.patrol) have[e.type]++;
  let added = 0;
  for (const ty of Object.keys(want))
    while (have[ty] < want[ty]) { enemies.push(makeEnemy(ty, enemies.length)); have[ty]++; added++; }
  if (added) { refreshReach(); flashMsg(`새 무리가 몰려온다! (+${added})`, '#ff8b5e'); }
}

// 10스테이지에 다다르면 톰이 쳐들어온다 — 그 뒤로는 시간이 승리를 안 준다 (D83).
// 보스를 처치해야만 끝난다. 시간이 다 돼도 스테이지는 10에 머물고 전투가 계속될 뿐이다.
function spawnBoss() {
  const b = makeEnemy('boss', enemies.length);
  b.introT = 3.0;   // 등장 경고 후 잠깐 멈춰 있다가 움직이기 시작
  enemies.push(b);
  refreshReach();
}

function advanceStage() {
  if (!netAuthoring()) return;          // 스테이지 진행은 호스트만 (D92-6단계)
  if (stage >= STAGES.length) return;   // 보스만이 승리를 결정한다 — 더 이상 진행 없음
  stage++;
  stageT = 0;
  spawnStageAdds(stage - 1);
  topUpToCurve();   // 처치로 줄어든 만큼 보충 — 처치는 한숨 돌릴 시간을 줄 뿐
  if (stage === STAGES.length) {
    flashMsg('스테이지 10 — 톰이 나타났다!', '#ff4d4d');
    spawnBoss();
  } else {
    flashMsg(`스테이지 ${stage} — ${stageDur()}초 버티기`, '#6ee07a');
  }
}

// 시간 기반 증원은 옵션으로만 남김 (everyLevels=0이면 스테이지 표만 사용)
function updateSpawns() {
  if (!netAuthoring()) return;   // 증원은 호스트만 — 클라가 적을 만들면 id가 충돌한다
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
  // 보스 등장 예고 — 잠깐 멈춰 서 있다가 움직이기 시작한다 (D83)
  if (enemy.introT > 0) { enemy.introT -= dt; return; }
  const er = enemyR(enemy);
  // 체력 아주 느린 자연 회복 (찔끔찔끔 누적으로 죽지 않게 — 처치엔 집중 화력이 필요)
  enemy.hp = Math.min(enemy.hp + enemyMaxHp(enemy) * 0.02 * dt, enemyMaxHp(enemy));
  if (enemy.hitFlash > 0) enemy.hitFlash -= dt;
  // 접근각 = 포위 링 슬롯(planEnemyPath에서 배정) + probeOff.
  // 평상시엔 probeOff가 0으로 잦아들어 제 슬롯을 지키고,
  // 막혀 있는 동안에는 커져서 슬롯 옆을 훑는다 = 벽 앞에서 밀지 않고 돌아본다.
  // 순찰조: 추격 시간이 흐르고, 초소 둘레의 순찰 각도가 돈다
  if (enemy.patrol) {
    if (enemy.aggroT > 0) enemy.aggroT -= dt;
    if (enemy.leashCd > 0) enemy.leashCd -= dt;
    enemy.patrolA += P.patrol.turn * dt;
    if (enemy.homeRing) enemy.homeRing.position.set(enemy.x, 0.05, enemy.z);
  }
  // 잠복 시간이 다 되면 포기하고 서성인다 — 영원히 문 앞을 지키지는 않는다
  if (enemy.campT > 0) {
    enemy.campT -= dt;
    if (enemy.campT <= 0) { enemy.prowlT = P.enemy.prowlTime; enemy.repathT = 0; }
  }
  if (enemy.probeT > 0) enemy.probeT -= dt;
  else enemy.probeOff *= Math.max(0, 1 - dt * 0.8);
  if (enemy.stallT > 0.15) enemy.probeOff += enemy.orbitDir * P.enemy.circleTurn * dt;
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
      const ob = obstacles.get(cellKey(((idx % NAV) / NAVPC) | 0, (((idx / NAV) | 0) / NAVPC) | 0));
      if (!ob || ob.bedrock || !ob.bldgRef) continue;  // 벽은 무적, 건물만
      // 벽 너머로는 못 때린다 (D88) — 거리만 보면 **벽 뒤의 타워가 맞는다.**
      // 파괴 경로가 건물을 지나더라도, 지금 서 있는 자리에서 손이 닿아야 때릴 수 있다
      if (distToObstacle(enemy, ob) <= reach &&
          !segmentBlocked(enemy.x, enemy.z, ob.bldgRef.cx, ob.bldgRef.cz, ob.bldgRef)) {
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
  // 잠복 중에는 "막혔다" 판정을 하지 않는다 — 일부러 멈춰 서 있는 것이다
  if (enemy.stallT > 0.45 && enemy.probeT <= 0 && enemy.aiMode !== '잠복') {
    // 도는 방향을 유지한 채 크게 튼다 — 좌우로 흔들리면 제자리에서 떠는 것처럼 보인다.
    // 가끔은 반대로 돌아 반대편 옆구리도 훑는다.
    if (Math.random() < 0.25) enemy.orbitDir *= -1;
    enemy.probeOff += enemy.orbitDir * (P.enemy.probeTurn * (0.7 + Math.random() * 0.8));
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
      // 목표를 놓는다 — 다음 재선택에서 편향을 새로 뽑으므로(D91) 다른 쪽을 볼 확률이 높다
      enemy.chaseTarget = null;
      enemy.targetSince = survival;
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
    // 건물도 벽 너머로는 못 때린다 (D80) — 햄스터 공격(D56)과 같은 규칙.
    // 단 **그 건물 자신은 빼고** 본다 (D85) — 안 그러면 목표가 스스로를 가린다
    if (dMin <= reach && !segmentBlocked(enemy.x, enemy.z, b.cx, b.cz, b)) bldgTarget = b;
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
    if (bestB && !segmentBlocked(enemy.x, enemy.z, bestB.cx, bestB.cz, bestB)) bldgTarget = bestB;
    else if (!bestB) enemy.attackTarget = bestWall;
  }

  // 파괴 경로상의 건물 셀 — 여기도 시야를 본다 (D88).
  // 예전엔 이 줄에 검사가 없어서 **벽 뒤의 경비탑이 그대로 맞았다.**
  if (!bldgTarget && enemy.attackTarget && enemy.attackTarget.bldgRef) {
    const tb = enemy.attackTarget.bldgRef;
    if (!segmentBlocked(enemy.x, enemy.z, tb.cx, tb.cz, tb)) bldgTarget = tb;
    else enemy.attackTarget = null;
  }

  if (bldgTarget) {
    // 보스는 위협 레벨 가산에서 제외 (D83) — 고정 스탯
    const dpsGain = enemy.type === 'boss' ? 0 : threatLevel() * P.threat.dpsGain;
    damageBuilding(bldgTarget, (typeP(enemy).bldgDps + dpsGain) * dt);
    enemy.attackTarget = null;
  }
  // 벽은 무적이라 때려서 부술 수 없다 — 자폭묘의 폭발만이 벽을 없앤다

  // ---- 햄스터 공격 (한 방 즉사가 아니라 예비동작 → 타격) ----
  // 자폭묘는 때리는 대신 점화한다.
  let hitTarget = null;
  for (const h of chaseTargets()) {
    // ⚠ 동료 몸집이 0.35, 플레이어가 0.26이라 **동료가 35% 큰 히트박스**를 갖는다.
    // 솔로에서는 AI 동료 사정이라 그대로 두지만, 2P에서는 P2가 불리해지므로
    // 세션 시작 때 P.ally.radius를 P.player.radius로 맞춘다 (D92-6단계).
    const hr = h === player ? P.player.radius : P.ally.radius;
    if (Math.hypot(h.x - enemy.x, h.z - enemy.z) >= er + hr + P.enemy.attackRange) continue;
    // 벽 너머로는 못 때린다 — 사거리 안이어도 사이에 막힌 칸이 있으면 무효
    if (segmentBlocked(enemy.x, enemy.z, h.x, h.z)) continue;
    hitTarget = h;
    break;
  }
  // "쫓고는 있는데 한 대도 못 때린" 시간 (D85). 이게 쌓이면 건물을 뜯으러 간다.
  // 때리는 데 성공했거나 이미 습격 중이면 0으로 돌아간다.
  if (hitTarget || enemy.aiMode === '습격' || enemy.aiMode === '파괴') enemy.noHitT = 0;
  else enemy.noHitT = (enemy.noHitT || 0) + dt;
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

  // 보스는 자폭하지 않고, 쿨다운마다 "막힌 벽 하나"를 강타해 부순다 (D83) —
  // 자폭묘처럼 일회성이 아니라 반복 가능하지만, 한 번에 딱 하나만 부순다.
  // 이 전투 한정으로만 벽의 무적성(D30)에 예외를 둔다. 일반 공격(hitTarget)과 독립적이라
  // 위 if/else-if 체인 밖에 둔다 — 보스도 평소엔 그냥 물어뜯는다.
  if (enemy.type === 'boss') {
    enemy.smashCd = Math.max((enemy.smashCd || 0) - dt, 0);
    let smashWall = null;
    if (enemy.smashCd <= 0) {
      const c = worldToCell(enemy.x, enemy.z);
      for (let dj = -2; dj <= 2 && !smashWall; dj++)
        for (let di = -2; di <= 2; di++) {
          const ob = obstacles.get(cellKey(c.i + di, c.j + dj));
          if (!ob || ob.bedrock || ob.bldgRef) continue;
          if (distToObstacle(enemy, ob) <= reach) { smashWall = ob; break; }
        }
    }
    if (smashWall) {
      enemy.smashT = (enemy.smashT || 0) + dt;
      const f = enemy.smashT / P.boss.smashWindup;
      enemy.vis.group.scale.setScalar(enemyR(enemy) * (1 + 0.3 * f));
      if (enemy.smashT >= P.boss.smashWindup) {
        // 한 방에 없애지 않고 **금을 낸다** (D99). smashHits번째에 무너지도록
        // 한 번에 낼 금의 수를 crackMax에서 거꾸로 계산한다 — crackMax를
        // 슬라이더로 만져도 "톰은 두 번"이 유지된다.
        const per = Math.max(1, Math.ceil((P.wall.crackMax + 1) / Math.max(1, P.boss.smashHits)));
        const broke = crackWall(smashWall, per);
        if (broke) markNavDirty();
        spawnBuildFx(enemy.x, enemy.z);
        flashMsg(broke ? '톰이 벽을 강타해 부쉈다!' : '톰이 벽을 내리쳤다 — 금이 갔다',
                 broke ? '#ff4d4d' : '#ffb347');
        enemy.smashT = 0;
        enemy.smashCd = P.boss.smashCooldown;
      }
    } else {
      enemy.smashT = Math.max((enemy.smashT || 0) - dt * 2, 0);
    }
  }
  // 예비동작·타격 모션 (앞으로 움찔 → 덮침)
  if (enemy.lungeT > 0) {
    enemy.lungeT -= dt;
    enemy.vis.group.position.y = Math.sin((0.2 - enemy.lungeT) / 0.2 * Math.PI) * 0.35;
  } else {
    enemy.vis.group.position.y = 0;
    if (enemy.windup > 0) {
      const w = enemy.windup / P.enemy.attackWindup;
      // 뒤로 빼며 부푼다 = "지금 온다"는 신호 (D78). 완료 직전이 가장 크다
      enemy.windupPull = w;
      enemy.vis.group.scale.setScalar(enemyR(enemy) * (1 + w * 0.22));
    } else {
      enemy.windupPull = 0;
      // 자폭묘 점화 중 / 보스 강타 예비동작 중에는 이 리셋이 그 부풀기를 덮으면 안 된다
      if (enemy.type !== 'bomber' && !(enemy.type === 'boss' && enemy.smashT > 0))
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
  // 예비동작 중이면 몸을 뒤로 뺀다 (D78) — 위치 반영은 여기서 한 번에
  const pull = enemy.windupPull || 0;
  enemy.vis.group.position.set(enemy.x - enemy.dirX * pull * 0.55,
                               enemy.vis.group.position.y,
                               enemy.z - enemy.dirZ * pull * 0.55);
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
  // 시작 화면 위에서는 게임 단축키를 받지 않는다 (D93) — 코드 입력칸이 R·P·G를 먹히면 안 된다
  if (!started) return;
  keys.add(e.code);
  if (e.code === 'KeyC') cycleCamera(1);
  // ESC = 한 단계 물러나기. 짓던 것 → 들고 있는 것 → 채굴 명령 → 선택 → 개조 패널
  // ESC = 한 단계 물러나기. 더 물러날 게 없으면 메뉴가 뜬다 (D71)
  if (e.code === 'Escape') {
    // 판정은 내 화면에서(클라도 자기 상태를 알고 있다), 실행은 명령으로 (D92-3단계)
    const me = localPlayer();
    if (menuOpen) setMenu(false);
    else if (me.buildJob) issueCommand({ t: 'cancel', lvl: 'buildJob' });
    else if (me.upgradeJob) issueCommand({ t: 'cancel', lvl: 'upgradeJob' });
    else if (me.buildOrder) issueCommand({ t: 'cancel', lvl: 'buildOrder' });
    else if (me.wallOrders.length) issueCommand({ t: 'cancel', lvl: 'wallOrders' });
    else if (removeMode) { removeMode = false; updateHotbar(); }
    else if (buildSlot >= 0) { buildSlot = -1; updateHotbar(); }
    else if (me.mineOrder) issueCommand({ t: 'cancel', lvl: 'mineOrder' });
    else if (selectedUnits.size) selectedUnits.clear();
    else if (upgOpen) { upgOpen = false; renderUpgrade(); }
    else if (helpOpen) { helpOpen = false; renderHelp(); }
    else setMenu(true);
  }
  if (e.code === 'KeyE' && alive) issueCommand({ t: 'mine' });
  // F — 공방·경비탑 제자리 업그레이드 (R은 이미 재시작에 쓰인다)
  if (e.code === 'KeyF' && alive) issueCommand({ t: 'f' });
  // 0번 = 도발 (D96). 이 게임의 유일한 '공격'이다
  if ((e.code === 'Digit0' || e.code === 'Numpad0') && alive) issueCommand({ t: 'taunt' });
  // 건네주기 — 옆에 붙어야 넘어간다 (D96)
  if (e.code === 'KeyQ' && alive) issueCommand({ t: 'give', k: 'cheese' });
  if (e.code === 'KeyZ' && alive) issueCommand({ t: 'give', k: 'parts' });
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') issueCommand({ t: 'roll' });
  // Tab = 방어병 전원 선택 (전투 중에 상자로 훑을 여유가 없다)
  if (e.code === 'Tab') {
    e.preventDefault();
    selectedUnits.clear();
    const mine = guardsOf(localPlayer().owner);
    for (const gu of mine) selectedUnits.add(gu);
    if (mine.length) selectionMsg();
    else flashMsg('방어병이 없습니다', '#e05050');
  }
  if (e.code === 'KeyU') { upgOpen = !upgOpen; renderUpgrade(); }
  if (e.code === 'KeyH') { helpOpen = !helpOpen; renderHelp(); }
  if (e.code === 'KeyG') setGui(!guiOpen);            // 튜닝 패널 (D91)
  if (e.code === 'F9') { netDevOn = !netDevOn; netDevEl.classList.toggle('on', netDevOn); renderNetDev(); }
  if (e.code === 'Backquote') setHud(!hudOn);         // 좌상단 개발 정보 (D91)
  // 숫자키 = **구매 모드(U)일 때만** 개조 구매, 아니면 건설 슬롯 선택.
  // 공방 옆에서 패널이 저절로 떠도(D88) 숫자키는 핫바를 계속 쓴다 —
  // 안 그러면 내 공방 옆에서 건물을 못 짓는다
  for (let k = 0; k < 8; k++) {
    if (e.code === 'Digit' + (k + 1)) {
      if (upgOpen) issueCommand(k === UPGRADES.length ? { t: 'sell' } : { t: 'upg', k });
      // 같은 숫자를 다시 누르면 내려놓는다 (ESC와 같은 효과)
      else if (k < BUILD_SLOTS.length) {
        removeMode = false;
        buildSlot = buildSlot === k ? -1 : k;
        updateHotbar();
      }
      break;
    }
  }
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyR') issueCommand({ t: 'restart' });
  // X = 철거 모드 토글 (핫바 슬롯을 안 잡아먹는다, D88)
  if (e.code === 'KeyX') { removeMode = !removeMode; if (removeMode) buildSlot = -1; updateHotbar(); }

});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
let mouseDown = false;

// ---- 상자 선택 ----
// 좌클릭은 건설이라 그대로 두고, **Shift를 누른 채 드래그**하거나
// **일꾼 위에서 드래그를 시작**할 때만 선택 상자가 된다.
// (드래그 중에는 건설이 일어나지 않는다 — 벽을 흘리다가 선택이 되면 안 되므로)
let selDrag = null;   // { x0, y0, x1, y1, add, moved }
const selBoxEl = document.getElementById('selbox');
const _projV = new THREE.Vector3();

function worldToScreen(x, y, z) {
  _projV.set(x, y, z).project(activeCam());
  if (_projV.z > 1) return null;           // 카메라 뒤
  return { x: (_projV.x * 0.5 + 0.5) * innerWidth, y: (-_projV.y * 0.5 + 0.5) * innerHeight };
}

function drawSelBox() {
  if (!selDrag) return;
  const x = Math.min(selDrag.x0, selDrag.x1), y = Math.min(selDrag.y0, selDrag.y1);
  selBoxEl.style.left = x + 'px';
  selBoxEl.style.top = y + 'px';
  selBoxEl.style.width = Math.abs(selDrag.x1 - selDrag.x0) + 'px';
  selBoxEl.style.height = Math.abs(selDrag.y1 - selDrag.y0) + 'px';
}

// 좌드래그가 선택 상자가 되는 조건 (D51 · D77에서 보조키를 Ctrl로 옮김):
//  · **빈손이면 언제나** (빈손 = 선택 커서. 건설할 게 손에 없으니 충돌하지 않는다)
//  · 손에 뭘 들고 있어도 Ctrl을 누르거나 유닛 위에서 시작하면 선택
//  (Shift는 구르기에 줬다 — 전투 중에 가장 급한 키라 단독으로 쓴다)
function beginSelectDrag(e) {
  if (!alive) return false;
  const mod = e.ctrlKey || e.metaKey;
  const onUnit = unitAtScreen(e.clientX, e.clientY);
  if (!mod && buildSlot >= 0 && !onUnit) return false;
  // 드래그를 시작한 유닛은 항상 포함한다 — 기준점이 상자 모서리 밖으로
  // 삐져나가 "잡은 놈이 안 잡히는" 일이 없게
  selDrag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY,
              add: mod, moved: false, seed: onUnit || null };
  selBoxEl.style.display = 'block';
  drawSelBox();
  return true;
}

function selectionMsg() {
  const w = selWorkers().length, g = selGuards().length;
  if (!w && !g) return;
  const bits = [];
  if (w) bits.push(`일꾼 ${w}`);
  if (g) bits.push(`방어병 ${g}`);
  flashMsg(`${bits.join(' · ')} 선택 — 우클릭으로 명령`, '#9fe8a0');
}

function finishSelectDrag(e) {
  const d = selDrag;
  selDrag = null;
  selBoxEl.style.display = 'none';
  if (d.moved) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if (!d.add) selectedUnits.clear();
    if (d.seed) selectedUnits.add(d.seed);
    // 발밑과 머리 둘 중 하나만 상자에 들어와도 잡는다 (관대하게)
    const inBox = (s) => s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
    for (const u of myUnits())
      if (inBox(worldToScreen(u.x, 0, u.z)) || inBox(worldToScreen(u.x, 0.9, u.z)))
        selectedUnits.add(u);
  } else {
    const u = unitAtScreen(e.clientX, e.clientY);
    if (u) {
      if (d.add && selectedUnits.has(u)) selectedUnits.delete(u);
      else { if (!d.add) selectedUnits.clear(); selectedUnits.add(u); }
    } else if (!d.add) selectedUnits.clear();
  }
  selectionMsg();
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target !== renderer.domElement) return;
  if (beginSelectDrag(e)) return;     // 선택 드래그 중에는 건설하지 않는다
  mouseDown = true;
});
window.addEventListener('mousemove', (e) => {
  if (!selDrag) return;
  selDrag.x1 = e.clientX; selDrag.y1 = e.clientY;
  if (Math.hypot(selDrag.x1 - selDrag.x0, selDrag.y1 - selDrag.y0) > P.command.dragMin) selDrag.moved = true;
  drawSelBox();
});
window.addEventListener('mouseup', (e) => {
  mouseDown = false;
  if (selDrag && e.button === 0) finishSelectDrag(e);
});
window.addEventListener('contextmenu', (e) => {
  if (e.target === renderer.domElement) e.preventDefault();
});
// 우클릭 = 명령
//  유닛 위 → 선택 / 치즈더미 → 채굴 명령 / 빈 땅 → 선택한 것 전부 이동
window.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || e.target !== renderer.domElement || !alive) return;

  // 1) 유닛 위 → 그 하나만 선택 (화면 좌표로 집는다 — 카메라 각도와 무관)
  const u = unitAtScreen(e.clientX, e.clientY);
  if (u) {
    selectedUnits.clear(); selectedUnits.add(u);
    selectionMsg();
    return;
  }

  // 2) 적 위 → 선택한 방어병 전원 **집중 공격** (자폭묘를 끊는 데 이게 필요하다)
  const foe = enemyAtScreen(e.clientX, e.clientY);
  if (foe && selGuards().length) {
    issueCommand({ t: 'unitcmd', act: 'focus', id: foe.id, ids: selGuards().map((u) => u.id) });
    return;
  }

  const hit = pointerGround(e);
  if (!hit) return;

  // 3) 치즈더미 → 일꾼이 선택돼 있으면 일꾼에게, 아니면 내가 간다
  const pile = nearestPile(hit.x, hit.z, P.command.pickRange);
  if (pile) {
    if (selWorkers().length)
      issueCommand({ t: 'unitcmd', act: 'pile', i: pile.i, j: pile.j, ids: selWorkers().map((u) => u.id) });
    else if (!selGuards().length) issueCommand({ t: 'mine', i: pile.i, j: pile.j });
    else issueCommand({ t: 'unitcmd', act: 'move', i: pile.i, j: pile.j, ids: selGuards().map((u) => u.id) });
    return;
  }

  // 4) 빈 땅 → 선택한 유닛 전부 이동 (집중 공격 명령은 여기서 풀린다)
  const c = worldToCell(hit.x, hit.z);
  if (obstacles.has(cellKey(c.i, c.j))) { flashMsg('그 자리로는 갈 수 없습니다', '#e05050'); return; }
  const ids = [...selectedUnits].filter((u) => myUnits().includes(u)).map((u) => u.id);
  issueCommand({ t: 'unitcmd', act: 'move', i: c.i, j: c.j, ids });
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
// 판이 시작될 때마다 여기로 되돌린다 (D93) — 시점이 판마다 달라지면
// "어째서인지 시점이 바뀐다"가 된다. C로 바꾼 건 그 판 안에서만 유지된다.
const DEFAULT_CAM = 1;   // 쿼터뷰 (스타크래프트풍)
let camIndex = DEFAULT_CAM;
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
  // **로컬 플레이어**를 따라간다 (D92-6단계). 클라에서는 그게 동료 슬롯이다 —
  // player를 그대로 두면 P2 화면이 P1을 따라다닌다
  const me = localPlayer();
  camTarget.lerp(new THREE.Vector3(me.x, 0, me.z), k);

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
    const targetYaw = Math.atan2(me.faceX, me.faceZ);
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
let ghostCell = { i: 0, j: 0, valid: false };

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

// ============================================================
// 시뮬 · 표현 · 로컬 UI 분리 (D92-1f)
//  updateActor(p, dt)  — 시뮬. **p 와 p.in 만 본다.** keys·mouseDown·activeCam() 금지
//  updateActorVis(p)   — 그 햄스터의 모델과 바
//  updateLocalUI(dt)   — 고스트·프롬프트·레이캐스트·핫바. 이 기계의 로컬 플레이어 기준
// 예전엔 셋이 updatePlayer 하나에 섞여 있었고, 그래서 "두 번째 햄스터를 돌린다"가
// 곧 "두 번째 마우스와 두 번째 카메라를 만든다"는 뜻이 됐다.
// ============================================================
const visOf = (p) => p.vis;
const barOf = (p) => p.bar;
const workBarOf = (p) => p.workBar;
const radiusOf = (p) => (p.slot === 0 ? P.player.radius : P.ally.radius);

// 로컬 입력 표본. **카메라와 키보드를 읽는 유일한 곳이다.**
// 카메라 기준 축(moveBasis)을 여기서 월드 좌표 단위벡터로 풀어서 넘기므로,
// 시뮬은 어느 카메라 모드인지 알 필요가 없다 (네트워크로도 이 두 숫자만 간다).
function sampleLocalInput(p = player) {
  const b = moveBasis();
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let mx = b.fx * f + b.rx * r, mz = b.fz * f + b.rz * r;
  const ml = Math.hypot(mx, mz);
  if (ml > 1e-4) { mx /= ml; mz /= ml; } else { mx = 0; mz = 0; }
  p.in.mx = mx; p.in.mz = mz;
}

function updateActor(p, dt) {
  // ---- 기절: 조작 불능, 누워서 동료를 기다린다 ----
  if (p.stunned) { clearMineOrder(undefined, p); return; }

  updateBuild(dt, p);
  updateUpgradeJob(dt, p);

  // ---- 앞구르기 (D77) — 이동보다 우선. 구르는 동안은 조작이 안 먹는다 ----
  if (p.rollCd > 0) p.rollCd -= dt;
  if (p.rollGrace > 0) p.rollGrace -= dt;
  if (p.tauntCd > 0) p.tauntCd -= dt;
  // 도발 중에는 발이 묶인다 — 이게 도발의 대가다 (D96)
  if (p.tauntT > 0) {
    p.tauntT -= dt;
    collideWithObstacles(p, radiusOf(p));
    return;
  }
  // 스태미너 회복 — 구른 직후 잠깐 멈췄다가 찬다
  p.stamIdle += dt;
  if (p.stamIdle > P.player.stamDelay) {
    // 내 영토 위에서는 더 빨리 찬다 (D86) — 영토의 유일한 실이익
    const mul = inTerritory(p.x, p.z) ? P.player.terrStamMul : 1;
    p.stamina = Math.min(p.stamina + P.player.stamRegen * mul * dt, P.player.stamMax);
  }
  if (p.rollT > 0) {
    p.rollT -= dt;
    p.rollSpin += dt * 22;
    const spd = P.player.rollDist / Math.max(P.player.rollTime, 0.01);
    p.x += p.rollX * spd * dt;
    p.z += p.rollZ * spd * dt;
    collideWithObstacles(p, radiusOf(p));
    return;
  }

  // ---- 이동 (건물을 짓거나 업그레이드하는 동안은 묶인다 = 무방비) ----
  if (!p.buildJob && !p.upgradeJob) {
    const mx = p.in.mx, mz = p.in.mz;
    if (mx || mz) {
      // 직접 움직이면 걸어둔 명령은 전부 풀린다 — 개입이 항상 우선이다
      if (p.mineOrder) clearMineOrder('직접 이동 — 채굴 명령 취소', p);
      if (p.wallOrders.length) clearWallOrders('직접 이동 — 벽 명령 취소', p);
      if (p.buildOrder) { p.buildOrder = null; flashMsg('직접 이동 — 건물 명령 취소', '#9aa3b2'); }
      p.wallCast = null;   // 벽은 서 있어야 지어진다 (D58)
      p.x += mx * effPlayerSpeed(p) * dt;
      p.z += mz * effPlayerSpeed(p) * dt;
      p.faceX = mx; p.faceZ = mz;
    } else if (p.buildOrder) {
      updateBuildOrder(dt, p);    // 건물 명령이 최우선 (하나뿐이고 비싸다)
    } else if (p.wallOrders.length) {
      updateWallOrder(dt, p);     // 벽 명령이 채굴보다 우선 (방금 내린 지시니까)
    } else if (p.mineOrder) {
      updateMineOrder(dt, p);
    }
  }
  collideWithObstacles(p, radiusOf(p));
}

// ---- 두 발로 걷는다 (D96) ----
// 모델은 원래부터 두 발로 서 있었는데(makeHamster 주석 참조) 움직일 때 아무것도
// 움직이지 않아서 **미끄러지듯** 보였다. 걸음 위상을 **이동 거리**로 돌린다 —
// 시간으로 돌리면 속도가 바뀔 때 발이 땅에서 미끄러진다.
// 도발(0번) 중이면 걷는 대신 춤을 춘다.
const STRIDE = 1.05;   // 이 거리마다 한 걸음
function animateLegs(p, vis, dt) {
  if (!vis.rest) return;
  const r = vis.rest;
  const put = (k, dx, dy, dz) => {
    vis[k].position.set(r[k].x + dx, r[k].y + dy, r[k].z + dz);
  };

  // ---- 도발 춤 ----
  if (p.tauntT > 0) {
    vis.group.rotation.z = Math.sin(performance.now() * 0.03) * 0.22;
    const u = 1 - p.tauntT / Math.max(P.coop.tauntTime, 0.01);
    const w = performance.now() * 0.02;
    vis.group.rotation.y += Math.sin(w * 1.7) * 0.55;         // 몸을 좌우로 흔든다
    vis.group.position.y += Math.abs(Math.sin(w * 1.4)) * 0.22;
    put('armL', 0, 0.75 + Math.sin(w * 2.1) * 0.28, 0);       // 두 팔 번쩍
    put('armR', 0, 0.75 - Math.sin(w * 2.1) * 0.28, 0);
    put('handL', 0, 1.05 + Math.sin(w * 2.1) * 0.42, 0);
    put('handR', 0, 1.05 - Math.sin(w * 2.1) * 0.42, 0);
    put('legL', 0, Math.max(0, Math.sin(w * 2.1)) * 0.2, 0);
    put('legR', 0, Math.max(0, -Math.sin(w * 2.1)) * 0.2, 0);
    put('footL', 0, Math.max(0, Math.sin(w * 2.1)) * 0.26, 0);
    put('footR', 0, Math.max(0, -Math.sin(w * 2.1)) * 0.26, 0);
    void u;
    return;
  }

  const dx = p.x - (p.visPrevX ?? p.x), dz = p.z - (p.visPrevZ ?? p.z);
  p.visPrevX = p.x; p.visPrevZ = p.z;
  const moved = Math.hypot(dx, dz);
  vis.walkPhase = (vis.walkPhase || 0) + (moved / STRIDE) * Math.PI * 2;
  // 서 있으면 위상을 0으로 되돌린다 (발이 벌어진 채 멈추지 않게)
  const speed = moved / Math.max(dt, 1e-4);
  const amp = Math.min(speed / (P.player.speed * moveScale()), 1);
  if (amp < 0.05) {
    vis.walkPhase = 0;
    vis.group.rotation.z = 0;
    for (const k of ['footL', 'footR', 'legL', 'legR', 'armL', 'armR', 'handL', 'handR']) put(k, 0, 0, 0);
    return;
  }
  const ph = vis.walkPhase;
  // **몸통 모션이 실전에서 유일하게 읽히는 부분이다.** 기본 카메라(쿼터뷰 20m)에서
  // 햄스터는 10픽셀 남짓이라 다리 움직임은 안 보인다. 걸음에 맞춘 상하 반동과
  // 좌우 기울임은 그 거리에서도 "걷고 있다"로 읽힌다.
  vis.group.position.y += Math.abs(Math.sin(ph)) * 0.055 * amp;   // 한 걸음에 한 번 튄다
  vis.group.rotation.z = Math.sin(ph) * 0.07 * amp;               // 좌우로 살짝 흔들
  const sw = Math.sin(ph) * 0.34 * amp;          // 앞뒤 (모델 -z가 정면)
  const lift = Math.max(0, Math.sin(ph)) * 0.22 * amp;
  const lift2 = Math.max(0, -Math.sin(ph)) * 0.22 * amp;
  put('footL', 0, lift, -sw);
  put('footR', 0, lift2, sw);
  put('legL', 0, lift * 0.5, -sw * 0.55);
  put('legR', 0, lift2 * 0.5, sw * 0.55);
  // 팔은 반대로 흔든다 — 그래야 걷는 걸로 읽힌다
  put('armL', 0, 0, sw * 0.5);
  put('armR', 0, 0, -sw * 0.5);
  put('handL', 0, 0, sw * 0.7);
  put('handR', 0, 0, -sw * 0.7);
}

// 표현 — 위치·자세·채굴 리액션·바. 시뮬 값을 읽기만 한다
function updateActorVis(p, dt) {
  const vis = visOf(p);
  const R = radiusOf(p);

  if (p.stunned) {
    vis.group.position.set(p.x, 0.25, p.z);
    vis.group.rotation.x = -Math.PI / 2;
    vis.setOpacity(0.5 + 0.2 * Math.sin(performance.now() * 0.005));
    setBar(barOf(p), 0, 0, 0, 0, false);
    setBar(workBarOf(p), 0, 0, 0, 0, false);
    return;
  }
  vis.setOpacity(1);

  if (p.rollT > 0) {
    vis.group.position.set(p.x, 0.18 + Math.sin((1 - p.rollT / P.player.rollTime) * Math.PI) * 0.22, p.z);
    vis.group.rotation.y = Math.atan2(p.rollX, p.rollZ) + Math.PI;
    vis.group.rotation.x = -p.rollSpin;   // 앞으로 구른다
    return;
  }
  vis.group.rotation.x = 0;
  vis.group.position.set(p.x, 0, p.z);
  vis.group.rotation.y = Math.atan2(p.faceX, p.faceZ) + Math.PI;
  vis.group.rotation.z = 0;

  // ---- 채굴 리액션 ----
  // 치즈 조각이 도착할 때마다 harvestPulse 가 오르고, 그동안 햄스터가
  // 위아래로 통통 튀면서 두 손을 흔든다 = "내가 지금 캐고 있다"
  p.harvestPulse = Math.max(p.harvestPulse - dt * 1.6, 0);
  const t = performance.now() * 0.012;
  const bounce = p.harvestPulse * Math.abs(Math.sin(t * 1.4));
  vis.group.position.y = bounce * 0.18;
  vis.group.scale.set(R * (1 + bounce * 0.06), R * (1 - bounce * 0.08), R * (1 + bounce * 0.06));
  animateLegs(p, vis, dt);
  if (vis.handL) {
    const swing = p.harvestPulse * 0.9;
    vis.armL.position.y += Math.sin(t * 2.2) * swing * 0.22;
    vis.armR.position.y -= Math.sin(t * 2.2) * swing * 0.22;
    vis.handL.position.y += Math.sin(t * 2.2) * swing * 0.34;
    vis.handR.position.y -= Math.sin(t * 2.2) * swing * 0.34;
  }

  // ---- 체력 / 작업 진행 바 ----
  const bar = barOf(p), y = barY(vis);
  setBar(bar, p.hp / P.player.hp, p.x, y, p.z, p.hp < P.player.hp - 0.5);
  const mining = p.job === 'mine';
  const building = !!p.buildJob;
  const upgrading = !!p.upgradeJob;
  const casting = !!p.wallCast;
  setBar(workBarOf(p),
         casting ? p.wallCast.t / P.wall.castTime
                 : building ? p.buildJob.t / p.buildJob.dur
                 : upgrading ? p.upgradeJob.t / p.upgradeJob.dur
                 : (p.mineT || 0) / effMineTime(),
         p.x, y + (bar && bar.visible ? 0.26 : 0), p.z,
         mining || building || upgrading || casting);
}

// ============================================================
// 명령 (D92-3단계)
//  **시뮬을 바꾸는 유일한 입구가 applyCommand다.**
//  로컬 UI가 마우스·화면 좌표·선택 상태를 전부 여기 도달하기 전에 풀어서,
//  명령에는 격자 좌표(i,j)와 엔티티 id만 남는다 — 그대로 네트워크에 실린다.
//  선택 상태는 절대 보내지 않는다 (내 화면에서 누굴 골랐는지는 남의 일이 아니다).
// ============================================================
const unitById = (id) => workers.find((u) => u.id === id) || guards.find((u) => u.id === id) || null;

function queueWall(p, i, j) {
  if (p.wallOrders.some((o) => o.i === i && o.j === j)) return;
  p.wallOrders.push({ i, j });
  if (p.mineOrder) clearMineOrder(undefined, p);
  p.orderPath.length = 0; p.orderRepathT = 0;
}

// 철거 — 예전엔 고스트 그리는 코드 한복판에 섞여 있었다 (마우스가 있어야만 철거가 됐다)
function removeAt(p, i, j) {
  const ob = obstacles.get(cellKey(i, j));
  if (!ob) return;
  const bldg = ob.bldgRef && ob.bldgRef.owner === p.owner ? ob.bldgRef : null;
  const isWall = !ob.bedrock && !ob.bldgRef;
  if (!isWall && !bldg) return;
  const rc = P.wall.removeCost;
  if (p.cheese < rc) return;
  p.cheese -= rc;
  if (bldg) {
    const refund = Math.round(buildCost(bldg.kind) * P.build.refundRatio);
    p.cheese += refund;
    spawnBuildFx(bldg.cx, bldg.cz);
    destroyBuilding(bldg, false);
    flashFor(p, `${BLDG_INFO[bldg.kind].label} 철거 — 치즈 +${refund} 회수`, '#ffb347');
    p.buildCooldown = 0.3;   // 건물은 연타로 지워지지 않게 조금 길게
  } else {
    const w0 = cellToWorld(i, j);
    removeObstacle(ob);
    markNavDirty();
    spawnBuildFx(w0.x, w0.z);
    p.buildCooldown = P.wall.cooldown;
  }
}

function applyCommand(p, c) {
  if (!c) return;
  // 재시작은 죽은 뒤에 쓰는 명령이라 alive 검사보다 먼저 온다
  if (c.t === 'restart') {
    restart();
    if (net.role === 'host' && net.connected) net.send({ k: 'HELLO', full: fullSnapshot() });
    return;
  }
  if (!alive) return;
  switch (c.t) {
    case 'roll':
      startRoll(p);
      // **구르기 무적은 클라를 믿는다** (D92-7단계).
      // 명령이 도착한 시점은 그쪽에서 누른 시점보다 RTT/2 늦다. 그 차이만큼
      // 회피 창을 앞뒤로 늘려 주지 않으면 P2의 구르기는 "가끔 안 먹는" 기술이 된다.
      // 치팅이 가능하지만 방 코드로 친구랑 하는 협동 게임이라 무의미하고,
      // 몇 줄로 손맛이 가장 크게 좋아진다.
      if (!p.local && p.rollT > 0) p.rollGrace = P.player.rollTime + net.rtt / 2000;
      break;
    case 'wall':   queueWall(p, c.i, c.j); break;
    case 'build':
      p.buildOrder = { kind: c.kind, i: c.i, j: c.j };
      p.orderPath.length = 0; p.orderRepathT = 0;
      if (p.mineOrder) clearMineOrder(undefined, p);
      break;
    case 'unit':
      if (c.kind === 'worker') hireWorker(p.owner);
      else if (GUARD_TYPES[c.kind]) placeGuard(c.kind, p);
      break;
    case 'mine': {
      if (c.i === undefined) { toggleMineOrder(p); break; }
      const n = nodeAt(c.i, c.j);
      if (n) setMineOrder(n, p);
      break;
    }
    case 'f':      tryUpgradeBuilding(p); break;
    case 'taunt':  startTaunt(p); break;
    case 'give':   giveTo(p, c.k); break;
    case 'remove': removeAt(p, c.i, c.j); break;
    case 'upg':    buyUpgrade(c.k, p); break;
    case 'sell':   sellParts(p); break;
    case 'cancel':
      if (c.lvl === 'buildJob') cancelBuild(true, p);
      else if (c.lvl === 'upgradeJob') cancelUpgrade(true, p);
      else if (c.lvl === 'buildOrder') { p.buildOrder = null; flashFor(p, '건물 명령 취소', '#9aa3b2'); }
      else if (c.lvl === 'wallOrders') clearWallOrders('벽 명령 취소', p);
      else if (c.lvl === 'mineOrder') clearMineOrder('채굴 명령 취소', p);
      break;
    case 'unitcmd': {
      // 선택이 아니라 **id 목록**으로 온다. 내 것이 아니면 무시한다
      const units = (c.ids || []).map(unitById).filter((u) => u && u.owner === p.owner);
      if (c.act === 'pile') {
        const n = nodeAt(c.i, c.j);
        if (n) commandWorkersToPile(n, p, units.filter((u) => u.kind === 'worker'));
      } else if (c.act === 'move') {
        const w = cellToWorld(c.i, c.j);
        for (const u of units) if (u.kind === 'guard') u.focus = null;
        commandUnitsMove(w.x, w.z, units, p);
      } else if (c.act === 'focus') {
        const foe = enemies.find((e) => e.id === c.id);
        if (!foe) break;
        let n = 0;
        for (const u of units) if (u.kind === 'guard') { u.focus = foe; u.repathT = 0; u.path.length = 0; n++; }
        if (n) flashFor(p, `${n}기 집중 공격 — ${TYPE_INFO[foe.type].label}`, '#ff8b5e');
      }
      break;
    }
  }
}

// 로컬에서 만든 명령을 시뮬로 보낸다. 솔로·호스트면 바로, 클라이언트면 호스트로 (5단계).
function issueCommand(c, p = localPlayer()) {
  if (net.isHost) { applyCommand(p, c); return; }
  // 클라는 **구르기만** 미리 돌린다 (D92-7단계).
  // 구르기는 0.28초짜리 회피 기술이라 왕복을 기다리면 이미 늦다 — 눌렀는데 아무 일도
  // 안 일어나는 0.1초가 그대로 "안 먹었다"로 읽힌다. 호스트는 rollGrace로 이 시차를 인정한다.
  // 나머지(치즈 소비·건설)는 절대 예측하지 않는다 — 이중 지불 고무줄이 지연보다 나쁘다.
  if (c.t === 'roll') startRoll(p);
  if (c.t === 'taunt') startTaunt(p);   // 눌렀는데 0.1초 뒤에 춤추면 우스꽝스러움이 죽는다
  net.send({ k: 'CMD', c });
}

// 로컬 UI — 고스트·프롬프트·레이캐스트·핫바 클릭.
// 시뮬 상태를 **읽기만** 하는 게 아니라 여기서 명령도 건다 (3단계에서 applyCommand로 정리한다).
function updateLocalUI(dt) {
  const me = localPlayer();

  if (me.stunned) {
    ghost.visible = false;
    minePrompt.visible = false;
    fullPrompt.visible = false;
    upgradePrompt.visible = false;
    safeMark.visible = false;
    return;
  }

  const wantBuild = keys.has('Space') || mouseDown;
  const buildPressed = wantBuild && !prevWantBuild; // 눌리는 순간 (연사 방지용)
  prevWantBuild = wantBuild;
  // 유닛 생산은 Enter (D88) — 눌리는 순간에만 한 기
  const wantSpawn = keys.has('Enter') || keys.has('NumpadEnter');
  const spawnPressed = wantSpawn && !prevWantSpawn;
  prevWantSpawn = wantSpawn;

  const prompts = () => { updateMinePrompt(); updateUpgradePrompt(); updateSafeMark(); };

  // 구르는 동안은 아무것도 못 찍는다 (조작이 안 먹는 구간이라 고스트도 숨긴다)
  if (me.rollT > 0) { prompts(); ghost.visible = false; return; }

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
  // ---- 철거 모드 (X) ---- 핫바 슬롯을 안 쓰고 별도 상태로 둔다 (D88)
  if (removeMode) {
    const ob = hasTile ? obstacles.get(cellKey(gi, gj)) : null;
    // 벽뿐 아니라 **일반 건물(창고·공방·경비탑)도 철거된다** (D90).
    // 건물은 잘못 놓으면 되돌릴 방법이 아예 없었다 — 자리를 고쳐 잡을 길을 준다.
    // 되찾는 값(refundRatio)이 있어야 "옮기자"가 실제 선택이 된다.
    const bldg = ob && ob.bldgRef && ob.bldgRef.owner === me.owner ? ob.bldgRef : null;
    const isWall = !!ob && !ob.bedrock && !ob.bldgRef;
    const rc = P.wall.removeCost;
    const refund = bldg ? Math.round(buildCost(bldg.kind) * P.build.refundRatio) : 0;
    const ok = (isWall || !!bldg) && me.cheese >= rc;
    ghostCell = { i: gi, j: gj, valid: ok };
    ghostWhy = ok ? '' :
      (!ob ? '철거할 게 없음'
        : ob.bedrock ? '지형은 못 부순다'
        : ob.bldgRef ? '동료 건물은 못 부순다'
        : '치즈 부족');
    ghost.visible = alive && hasTile;
    const w0 = cellToWorld(gi, gj);
    if (bldg) {   // 건물은 발자국 전체를 비춘다
      ghost.scale.set(CS * 1.98, 1.2, CS * 1.98);
      ghost.position.set(bldg.cx, 0.6, bldg.cz);
    } else {
      ghost.scale.set(P.wall.post, P.wall.height, P.wall.post);
      ghost.position.set(w0.x, P.wall.height / 2, w0.z);
    }
    ghost.material.color.setHex(ok ? 0xffb347 : 0xe05050);
    me.buildCooldown -= dt;
    if (wantBuild && me.buildCooldown <= 0 && ok) issueCommand({ t: 'remove', i: gi, j: gj });
    prompts();
    return;
  }

  const slot = heldSlot();
  // 아무것도 안 들고 있으면 고스트도 없고 좌클릭도 아무 일을 하지 않는다
  if (!slot) {
    ghostCell = { i: gi, j: gj, valid: false };
    ghost.visible = false;
    prompts();
    return;
  }
  const w = cellToWorld(gi, gj);
  const affordable = me.cheese >= slot.cost();
  const lock = slotLockReason(slot);
  let valid = false;
  if (lock) {
    ghostWhy = lock;
  } else if (slot.key === 'worker') {
    valid = affordable && !!nearestDepot(me.x, me.z, me.owner);
    ghostWhy = !affordable ? '치즈 부족' : (valid ? '' : '창고가 필요합니다');
  } else if (GUARD_TYPES[slot.key]) {
    // 유닛은 내 옆에서 나온다 — 자리를 안 찍으므로 타일 유효성도 없다
    valid = affordable && guardsOf(me.owner).length < P.guard.max;
    ghostWhy = !affordable ? '치즈 부족' : (valid ? '' : `방어병 최대 ${P.guard.max}`);
  } else if (hasTile) {
    if (slot.size === 2) {
      const berr = buildingPlacement(gi, gj, slot.key, true);
      valid = affordable && !berr;
      ghostWhy = !affordable ? '치즈 부족' : (berr || '');
    } else {
      // 거리는 보지 않는다 — 명령이 걸어간다 (D73). "거기에 지을 수 있느냐"만 본다
      const err = wallSpotOk(gi, gj, me);
      valid = !err && affordable;
      ghostWhy = !affordable ? '치즈 부족' : (err || '');
    }
  }
  ghostCell = { i: gi, j: gj, valid };
  const unitSlot = isUnitSlot(slot);
  // 유닛 슬롯은 타일을 안 찍는다. 그런데 예전엔 고스트도 안 띄워서
  // **숫자를 눌러 놓고 뭘 해야 하는지 알 수가 없었다** (D91).
  // 이제 **실제로 나올 자리**에 고스트를 세운다 — "여기서 나온다"가 눈에 보이면
  // 클릭이든 Enter든 누르면 된다는 게 저절로 읽힌다.
  if (unitSlot) {
    const r = GUARD_TYPES[slot.key] ? GUARD_TYPES[slot.key].radius() : P.worker.radius;
    const n = GUARD_TYPES[slot.key] ? guardsOf(me.owner).length
                                    : workers.filter((w) => w.owner === me.owner).length;
    const sp = spawnSpotNear(me.x, me.z, r, n);
    unitGhostAt.set(sp.x, sp.z);
    ghost.visible = alive;
    ghost.scale.set(r * 2, r * 2.6, r * 2);
    ghost.position.set(sp.x, r * 1.3, sp.z);
    ghost.material.color.setHex(valid ? 0x6ee07a : 0xe05050);
    // 아래 공통 처리를 건너뛴다 (타일 기반 고스트가 위치를 덮어쓰지 않게)
  } else {
    ghost.visible = alive && hasTile;
    if (slot.size === 2) {
      ghost.scale.set(CS * 1.98, 1.2, CS * 1.98);
      ghost.position.set(w.x + CS / 2, 0.6, w.z + CS / 2);
    } else if (slot.key === 'wall') {
      // 고스트도 기둥 크기로 — 세우기 전에 틈이 얼마나 남는지 보여야 한다
      ghost.scale.set(P.wall.post, P.wall.height, P.wall.post);
      ghost.position.set(w.x, P.wall.height / 2, w.z);
    } else {
      ghost.scale.set(CS * 0.98, P.wall.height, CS * 0.98);
      ghost.position.set(w.x, P.wall.height / 2, w.z);
    }
    ghost.material.color.setHex(valid ? 0x6ee07a : 0xe05050);
  }

  // ---- 즉시 건설 (선택 슬롯) ----
  // 벽: 홀드하면 쿨다운마다 연속 설치 / 건물: 클릭 = 명령 / **유닛: Enter** (D88)
  me.buildCooldown -= dt;
  if (slot.key === 'wall') {
    // 클릭 한 번 = "거기에 지으러 가라" (D60/D73). 사거리는 짧게 두되(D69) 걷는 건 대신해 준다.
    if (buildPressed && valid && hasTile) issueCommand({ t: 'wall', i: gi, j: gj });
  } else if (unitSlot) {
    // **Enter도 되고 좌클릭도 된다** (D91). 고스트가 나올 자리를 이미 보여주므로
    // "어딘가를 찍어야 하나?"로 오해될 일이 없다 — 둘 다 열어 두는 게 손해가 없다
    if (spawnPressed || buildPressed) {
      if (lock) flashMsg(lock, '#e05050');
      else issueCommand({ t: 'unit', kind: slot.key });
    }
  } else if (buildPressed && hasTile && !lock) {
    issueCommand({ t: 'build', kind: slot.key, i: gi, j: gj });
  } else if (buildPressed && lock) {
    flashMsg(lock, '#e05050');
  }

  prompts();
}

// 사람이 운전하는 햄스터인가 (빈 슬롯이 아닌)
const isDriven = (p) => p.active && !p.ai;

// 입력 송신 (D92-6단계) — 바뀌었을 때 + 최소 주기로. 30Hz면 ~180 B/s다.
let inSendT = 0, inLastX = 0, inLastZ = 0;
function sendInput(p, dt) {
  if (net.role !== 'client' || !net.connected) return;
  inSendT -= dt;
  const changed = p.in.mx !== inLastX || p.in.mz !== inLastZ;
  if (!changed && inSendT > 0) return;
  inSendT = 1 / 30;
  inLastX = p.in.mx; inLastZ = p.in.mz;
  net.send({ k: 'IN', mx: p.in.mx, mz: p.in.mz }, true);   // 무순서 — 다음 입력이 덮어쓴다
}

// 이 프레임의 플레이어 처리 한 묶음. 솔로에서는 사람이 player 하나뿐이라
// 순서와 결과가 예전 updatePlayer와 같다.
function updatePlayer(dt) {
  sampleLocalInput(localPlayer());   // 로컬 입력은 로컬 플레이어에게만 (원격은 p.in을 네트워크가 채운다)
  sendInput(localPlayer(), dt);
  for (const p of players) {
    if (!isDriven(p)) continue;
    updateActor(p, dt);
    updateActorVis(p, dt);
  }
  updateLocalUI(dt);
}

// ---- 건물 건설 (시간 소요 · 무방비) ----
// 짓는 동안 플레이어는 그 자리에 묶인다. ESC로 중단하면 펑 터지고 자원을 돌려받는다.
let ghostWhy = '';     // 지금 그 칸에 못 짓는 이유 (HUD 힌트 + 디버그)

function buildTimeOf(kind) {
  return kind === 'depot' ? P.build.depotTime
    : kind === 'workshop' ? P.build.workshopTime : P.build.towerTime;
}

// 경비탑만 **혼자 지어진다** (D87) — 찍어 놓으면 알아서 올라가고 플레이어는 자유다.
// 나머지 건물(창고·공방)은 D44의 채널링(그 자리에 묶임)을 그대로 유지한다.
// 갈린 이유: 창고·공방은 조용할 때 고르는 **정착 결정**이라 3~4초 무방비가 그 값이지만,
// 경비탑은 **고양이가 오는 걸 보고 급하게 세우는 것**이다. 그 순간 4초를 묶으면
// 세우는 행위 자체가 자살이 되어 아무도 안 쓴다.
// 대신 완성 전에는 못 쏘고(D84) 적에게 두들겨 맞으므로, "제때 세웠는가"는 여전히 값이다.
const SELF_BUILD = { tower: true };

function startBuild(kind, i, j, p = player) {
  if (p.buildJob) return;
  const b = placeBuilding(kind, i, j, p.owner);
  if (!b) return;
  b.underBuild = true;
  // 짓는 중에는 반투명 + 낮게 시작
  b.mesh.traverse((o) => {
    if (!o.material) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.45;
  });
  b.mesh.scale.y = 0.25;
  if (SELF_BUILD[kind]) {
    // 진행도를 건물 자신이 들고 간다 → 여러 개가 동시에 올라갈 수 있다
    b.selfT = 0;
    b.selfDur = buildTimeOf(kind);
    flashMsg(`${BLDG_INFO[kind].label} 건설 시작 — 알아서 지어진다`, '#9fe8a0');
    return;
  }
  p.buildJob = { b, t: 0, dur: buildTimeOf(kind), cost: buildCost(kind) };
  flashMsg(`${BLDG_INFO[kind].label} 건설 중 — 움직일 수 없다 (ESC 취소)`, '#9fe8a0');
}

// 완성 처리 — 채널링 건물과 자동 건설 건물이 같은 마무리를 쓴다
function finishBuild(b) {
  b.underBuild = false;
  b.mesh.traverse((o) => { if (o.material) { o.material.transparent = false; o.material.opacity = 1; } });
  b.mesh.scale.y = 1;
  spawnBuildFx(b.cx, b.cz);
  flashMsg(`${BLDG_INFO[b.kind].label} 완성`, '#6ee07a');
}

// 자동 건설 건물의 진행 (매 프레임, updateBuildings에서 호출)
function updateSelfBuild(b, dt) {
  if (!b.underBuild || b.selfDur === undefined) return;
  b.selfT += dt;
  const f = Math.min(b.selfT / b.selfDur, 1);
  b.mesh.scale.y = 0.25 + 0.75 * f;
  if (f >= 1) finishBuild(b);
}

function cancelBuild(refund = true, p = player) {
  if (!p.buildJob) return;
  const { b, cost } = p.buildJob;
  p.buildJob = null;
  if (buildings.includes(b)) {
    spawnBuildFx(b.cx, b.cz);
    spawnBuildFx(b.cx, b.cz);
    destroyBuilding(b, false);
  }
  if (refund) p.cheese += cost;
  flashMsg('건설 취소', '#ffb347');
}

function updateBuild(dt, p = player) {
  if (!p.buildJob) return;
  const { b, dur } = p.buildJob;
  if (!buildings.includes(b)) { p.buildJob = null; return; }   // 적이 부숨
  p.buildJob.t += dt;
  const f = Math.min(p.buildJob.t / dur, 1);
  b.mesh.scale.y = 0.25 + 0.75 * f;
  if (f >= 1) { finishBuild(b); p.buildJob = null; }
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
    markNavDirty();
  }
}

// ============================================================
// GUI
// ============================================================
const gui = new GUI({ title: '튜닝' });

// ---- 자주 만지는 것 ----
// 실제로 플레이하며 반복해서 요청됐던 값들만 위로 꺼냈다.
// 나머지는 전부 아래 '고급' 안에 접혀 있다 — 열어야 보인다.
{
  const f = gui.addFolder('★ 자주 만지는 것');
  f.add({ 다시시작: () => restart() }, '다시시작').name('다시시작 (R)');

  f.add(P.tempo, 'moveScale', 0.3, 1.5, 0.05).name('전체 이동 속도 (템포)');
  f.add(P.player, 'hp', 20, 400, 10).name('내 체력 (재시작부터)');

  f.add(P.wall, 'cost', 0, 40, 1).name('벽 비용');
  f.add(P.wall, 'post', 0.2, 2.2, 0.05).name('벽 기둥 굵기').onChange(() => {
    for (const ob of obstacles.values())
      if (!ob.bedrock && !ob.bldgRef) ob.mesh.scale.set(P.wall.post, P.wall.height, P.wall.post);
  });
  f.add(P.wall, 'castTime', 0, 2, 0.05).name('벽 짓는 시간(무방비)');
  f.add(P.res, 'costScale', 0.5, 3, 0.1).name('★ 전체 치즈 물가 배율');
  f.add(P.res, 'terrIncome', 0, 0.02, 0.001).name('★ 영토 ㎡당 치즈/초 (0=끔)');

  f.add(P.carry, 'playerLoad', 1, 60, 1).name('한 짐 — 나');
  f.add(P.carry, 'workerLoad', 1, 60, 1).name('한 짐 — 일꾼');
  f.add(P.carry, 'mineTime', 0.3, 6, 0.1).name('한 짐 캐는 시간(초)');
  f.add(P.res, 'nodeAmount', 100, 6000, 100).name('더미 매장량 (재시작부터)');
  f.add(P.worker, 'cost', 1, 120, 1).name('일꾼 비용');
  f.add(P.res, 'start', 0, 400, 5).name('시작 치즈 (재시작부터)');

  f.add(P.enemy, 'count', 0, 20, 1).name('적 시작 마릿수').onChange((v) => setEnemyCount(v));
  f.add(P.patrol, 'count', 0, 10, 1).name('순찰조 수 (재시작부터)');
  f.add(P.enemy, 'spawnDelay', 0, 60, 1).name('적 등장까지(초)');
  f.add(P.chaser, 'hp', 100, 4000, 50).name('순찰묘 체력');
  f.add(P.chaser, 'reward', 0, 60, 1).name('처치 보상 (순찰묘)');
  f.add(P.enemy, 'attackRange', 0, 4, 0.1).name('적 공격 사거리(+몸)');
  f.add(P.enemy, 'attackWindup', 0.1, 2, 0.05).name('적 예비동작(피할 시간)');
  f.add(P.chaser, 'radius', 0.3, 3, 0.05).name('순찰묘 몸집');
  f.add(P.player, 'radius', 0.1, 0.8, 0.02).name('내 몸집')
    .onChange((v) => { player.vis.group.scale.setScalar(v); });
  f.add(P.player, 'rollDist', 0, 10, 0.2).name('구르기 거리');
  f.add(P.player, 'rollTime', 0.1, 1, 0.02).name('구르기 시간(무적)');
  f.add(P.player, 'rollCool', 0, 5, 0.1).name('구르기 쿨다운');
  f.add(P.player, 'stamMax', 20, 400, 10).name('기운 최대');
  f.add(P.player, 'stamRoll', 5, 200, 1).name('구르기 소모');
  f.add(P.player, 'stamRegen', 1, 80, 1).name('기운 회복(초당)');
  f.add(P.player, 'terrStamMul', 1, 5, 0.1).name('내 영토 위 기운 회복 배율');
  f.add(terrMesh.material, 'opacity', 0, 1, 0.05).name('영토 색칠 진하기');
  f.add(P.player, 'stamDelay', 0, 4, 0.1).name('회복 시작까지(초)');
  f.add(P.threat, 'hpGain', 0, 400, 10).name('레벨당 적 체력 +');
  f.add(P.threat, 'speedGain', 0, 2, 0.05).name('레벨당 적 속도 + (0=고정)');

  f.add(P.guard, 'max', 1, 40, 1).name('방어병 최대');
  f.add(P.guard, 'costGrowth', 0, 0.6, 0.01).name('방어병 값 상승률');
}

// ---- 고급: 나머지 전부 (기본 접힘) ----
const adv = gui.addFolder('고급 — 전체 설정');

{
  const f = adv.addFolder('플레이어');
  f.add(P.player, 'speed', 1, 18, 0.1).name('이동 속도');
  f.add(P.player, 'radius', 0.15, 0.8, 0.01).name('반지름')
    .onChange((v) => { player.vis.group.scale.setScalar(v); });
  f.add(P.player, 'graceTime', 0, 5, 0.1).name('피격 뒤 무적(초)');
  f.add(P.player, 'respawnGrace', 0, 8, 0.5).name('잡힌 뒤 무적(초)');
  f.add(P.player, 'hp', 20, 400, 10).name('체력 (재시작부터)');
  f.add(P.player, 'regen', 0, 30, 1).name('체력 재생(초당)');
  f.add(P.player, 'regenDelay', 0, 10, 0.5).name('재생 시작까지(초)');
  f.add(P.player, 'wipeOnCatch', 0, 1, 1).name('잡히면 전부 소멸 (원작)');
}
{
  const f = adv.addFolder('멀티 (2P)');
  f.add(P.net, 'rate', 5, 60, 1).name('스냅샷 Hz');
  f.add(P.net, 'interpDelay', 0, 0.3, 0.01).name('보간 지연(초)');
  f.add(P.net, 'smoothMax', 0.2, 5, 0.1).name('오차 스냅 임계(m)');
  f.add(P.net, 'fakeLag', 0, 300, 5).name('인위 지연(ms, 편도)')
    .onChange((v) => { net.fakeLag = v; });
}
{
  const f = adv.addFolder('적 (공통)');
  f.add(P.enemy, 'count', 1, 12, 1).name('시작 마릿수 (순찰묘)')
    .onChange((v) => setEnemyCount(v));
  f.add(P.enemy, 'attackRange', 0.2, 2, 0.05).name('공격 사거리');
  f.add(P.enemy, 'repath', 0.1, 1.5, 0.05).name('경로 재계산 주기');
  f.add(P.enemy, 'spawnDelay', 0, 60, 1).name('등장 딜레이(초)');
  f.add(P.enemy, 'spread', 0, 20, 0.5).name('스폰 흩어짐 (재시작부터)');
  f.add(P.enemy, 'aggroRange', 0, 16, 0.5).name('건물 어그로 시야');
  f.add(P.enemy, 'aggroChance', 0, 1, 0.05).name('한눈팔 확률');
  f.add(P.enemy, 'raidPatience', 1, 20, 0.5).name('못 때리면 건물 뜯으러(초)');
  f.add(P.enemy, 'aggroTime', 1, 12, 0.5).name('어그로 지속(초)');
}
{
  // 종류별 스탯 — 반지름을 바꾸면 그 종류의 모델 크기와 통행권이 같이 바뀐다
  const f = adv.addFolder('적 유형');
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
  const f = adv.addFolder('벽');
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
  const f = adv.addFolder('자원');
  f.add(P.wall, 'cost', 1, 60, 1).name('벽 비용');
  f.add(P.wall, 'removeCost', 0, 30, 1).name('철거 비용');
  f.add(P.wall, 'post', 0.2, 2.2, 0.05).name('벽 기둥 굵기 (틈 = 1-굵기)').onChange(() => {
    for (const ob of obstacles.values())
      if (!ob.bedrock && !ob.bldgRef) ob.mesh.scale.set(P.wall.post, P.wall.height, P.wall.post);
  });
  f.add(P.wall, 'height', 0.4, 3, 0.1).name('벽 높이');
  f.add(P.wall, 'range', 0.5, 9, 0.1).name('벽 설치 거리 (여기까지 걸어간다)');
  f.add(P.wall, 'castTime', 0, 2, 0.05).name('벽 시전 시간(초) — 무방비');
  f.add(P.res, 'start', 0, 400, 5).name('시작 치즈 (재시작부터)');
  f.add(P.res, 'nodeAmount', 50, 2000, 10).name('더미 매장량 (재시작부터)');
}
{
  const f = adv.addFolder('동료 (AI 햄스터)');
  f.add(P.ally, 'radius', 0.15, 0.8, 0.01).name('2P 햄스터 반지름')
    .onChange((v) => { for (const q of players) if (q.slot) q.vis.group.scale.setScalar(v); });
  f.add(P.coop, 'enemyScale', 1, 3, 0.1).name('2P 적 배수 (재시작부터)');
  f.add(P.coop, 'wipeGrace', 0, 60, 1).name('소멸 유예(초) — 구출하면 취소');
  f.add(P.coop, 'giveRange', 1, 8, 0.2).name('건네주기 사거리');
  f.add(P.coop, 'giveCheese', 1, 100, 1).name('한 번에 넘길 치즈');
  f.add(P.coop, 'giveParts', 1, 10, 1).name('한 번에 넘길 부품');
  f.add(P.coop, 'tauntTime', 0.3, 5, 0.1).name('도발 시간(초, 못 움직임)');
  f.add(P.coop, 'tauntCool', 1, 30, 0.5).name('도발 쿨다운');
  f.add(P.coop, 'tauntRange', 4, 40, 1).name('도발 사거리');
  f.add(P.coop, 'tauntPull', 0, 120, 5).name('도발 세기');
}
{
  const f = adv.addFolder('건물 (2번 창고 · 3번 공방)');
  f.add(P.depot, 'cost', 5, 60, 1).name('창고 비용');
  f.add(P.depot, 'hp', 50, 1500, 10).name('창고 내구도 (새 건물부터)');
  f.add(P.depot, 'dropRange', 1, 12, 0.2).name('창고 하역 거리');
  f.add(P.depot, 'minPileDist', 0, 20, 0.5).name('창고-더미 최소 거리');
  f.add(P.carry, 'mineTime', 0.3, 6, 0.1).name('한 짐 캐는 시간(초)');
  f.add(P.carry, 'playerLoad', 2, 60, 1).name('플레이어 한 짐');
  f.add(P.carry, 'workerLoad', 2, 60, 1).name('일꾼 한 짐');
  f.add(P.carry, 'range', 1, 9, 0.1).name('채굴 접근 거리');
  f.add(P.build, 'depotTime', 0.5, 12, 0.5).name('창고 건설 시간(초)');
  f.add(P.build, 'workshopTime', 0.5, 12, 0.5).name('공방 건설 시간(초)');
  f.add(P.build, 'towerTime', 0.5, 12, 0.5).name('경비탑 건설 시간(초)');
  f.add(P.build, 'towerUp2Time', 0.5, 15, 0.5).name('경비탑 Lv.2 업그레이드 시간(초)');
  f.add(P.build, 'towerUp3Time', 0.5, 15, 0.5).name('경비탑 Lv.3 업그레이드 시간(초)');
  f.add(P.workshop, 'cost', 5, 60, 1).name('공방 비용 (배치)');
  f.add(P.workshop, 'hp', 50, 1500, 10).name('공방 내구도 (새 건물부터)');
  f.add(P.workshop, 'tier2Cost', 10, 400, 5).name('공방 Lv.2 업그레이드 치즈');
  f.add(P.workshop, 'tier2Parts', 0, 20, 1).name('공방 Lv.2 업그레이드 부품');
  f.add(P.workshop, 'tier3Cost', 10, 1000, 10).name('공방 Lv.3 업그레이드 치즈');
  f.add(P.workshop, 'tier3Parts', 0, 20, 1).name('공방 Lv.3 업그레이드 부품');
  f.add(P.build, 'inset', 0, 0.6, 0.05).name('건물 충돌 들이기 (대각 틈)');
  f.add(P.tower, 't1Cost', 5, 120, 5).name('경비탑 Lv.1 비용 (배치)');
  f.add(P.tower, 't1Hp', 20, 800, 10).name('경비탑 Lv.1 내구도');
  f.add(P.tower, 't1Range', 2, 24, 0.5).name('경비탑 Lv.1 사거리');
  f.add(P.tower, 't1Dmg', 2, 120, 1).name('경비탑 Lv.1 투척 피해');
  f.add(P.tower, 't1Reload', 0.2, 4, 0.1).name('경비탑 Lv.1 투척 간격');
  f.add(P.tower, 't2Cost', 5, 400, 5).name('경비탑 Lv.2 업그레이드 비용');
  f.add(P.tower, 't2Hp', 20, 1500, 10).name('경비탑 Lv.2 내구도');
  f.add(P.tower, 't2Range', 2, 24, 0.5).name('경비탑 Lv.2 사거리');
  f.add(P.tower, 't2Dmg', 2, 150, 1).name('경비탑 Lv.2 투척 피해');
  f.add(P.tower, 't2Reload', 0.2, 4, 0.1).name('경비탑 Lv.2 투척 간격');
  f.add(P.tower, 't3Cost', 50, 3000, 25).name('경비탑 Lv.3 업그레이드 비용 (겁나 비쌈)');
  f.add(P.tower, 't3Hp', 50, 3000, 10).name('경비탑 Lv.3 내구도');
  f.add(P.tower, 't3Range', 2, 30, 0.5).name('경비탑 Lv.3 사거리');
  f.add(P.tower, 't3Dmg', 2, 300, 1).name('경비탑 Lv.3 투척 피해 (겁나 쎔)');
  f.add(P.tower, 't3Reload', 0.1, 4, 0.1).name('경비탑 Lv.3 투척 간격');
  f.add(P.threat, 'hpGain', 0, 400, 10).name('적 체력 증가/레벨');
  f.add(P.threat, 'speedCap', 3, 21, 0.1).name('적 속도 상한');
  f.add(P.tempo, 'moveScale', 0.3, 1.5, 0.05).name('전체 이동 속도 배율');
  f.add(P.threat, 'killsPerSurge', 1, 30, 1).name('N킬마다 우루루');
  f.add(P.threat, 'surgeSize', 1, 10, 1).name('우루루 마릿수');
}
{
  const f = adv.addFolder('보스 "톰" (10스테이지)');
  f.add(P.boss, 'hp', 500, 30000, 100).name('체력 (위협 레벨 영향 안 받음)');
  f.add(P.boss, 'speed', 0.5, 12, 0.1).name('이동 속도');
  f.add(P.boss, 'radius', 0.5, 3, 0.05).name('몸집');
  f.add(P.boss, 'dmg', 5, 200, 1).name('접촉 피해');
  f.add(P.boss, 'bldgDps', 5, 200, 1).name('건물 공격력');
  f.add(P.boss, 'smashCooldown', 1, 30, 0.5).name('벽 강타 쿨다운(초)');
  f.add(P.boss, 'smashHits', 1, 5, 1).name('벽 강타 몇 번에 부서지나');
  f.add(P.boss, 'smashWindup', 0.2, 3, 0.1).name('벽 강타 예비동작(초)');
}
{
  const f = adv.addFolder('채굴 명령 (E · 우클릭 · 드래그)');
  f.add(P.command, 'promptRange', 1, 18, 0.5).name("'E' 안내가 뜨는 거리");
  f.add(P.command, 'pickRange', 0.5, 7, 0.1).name('우클릭 집는 반경');
  f.add(P.command, 'dragMin', 2, 40, 1).name('상자 선택 최소 드래그(px)');
  f.add(P.worker, 'perPile', 1, 8, 1).name('한 더미당 일꾼 수');
  f.add(P.worker, 'max', 1, 30, 1).name('일꾼 최대');
  f.add(P.worker, 'speed', 1, 18, 0.1).name('일꾼 이동 속도');
  f.add(P.worker, 'cost', 5, 120, 1).name('일꾼 비용');
}
{
  const f = adv.addFolder('방어병 3종 (6 사수 · 7 근접병 · 8 정예병)');
  f.add(P.guard, 'speed', 1, 18, 0.1).name('공통 이동 속도');
  f.add(P.guard, 'max', 1, 40, 1).name('방어병 최대');
  f.add(P.guard, 'costGrowth', 0, 0.6, 0.01).name('한 명 늘 때마다 값 상승률');
  f.add(P.guard, 'bomberBias', 0.1, 2, 0.05).name('자폭묘 우선도(작을수록 우선)');
  f.add(P.guard, 'radius', 0.15, 1, 0.05).name('공통 몸집');
  f.add(P.guard, 'archerCost', 5, 150, 1).name('사수 비용');
  f.add(P.guard, 'archerRange', 2, 24, 0.5).name('사수 사거리');
  f.add(P.guard, 'archerDmg', 2, 120, 1).name('사수 피해');
  f.add(P.guard, 'archerReload', 0.2, 4, 0.1).name('사수 투척 간격');
  f.add(P.guard, 'meleeCost', 5, 150, 1).name('근접병 비용');
  f.add(P.guard, 'meleeHp', 10, 1000, 10).name('근접병 체력');
  f.add(P.guard, 'meleeRange', 0.3, 7, 0.1).name('근접병 사거리(몸 표면 기준)');
  f.add(P.guard, 'meleeDmg', 2, 150, 1).name('근접병 피해');
  f.add(P.guard, 'meleeReload', 0.2, 4, 0.1).name('근접병 공격 간격');
  f.add(P.guard, 'eliteCost', 5, 250, 5).name('정예병 비용');
  f.add(P.guard, 'eliteHp', 10, 2000, 10).name('정예병 체력');
  f.add(P.guard, 'eliteRange', 2, 24, 0.5).name('정예병 사거리');
  f.add(P.guard, 'eliteDmg', 2, 150, 1).name('정예병 피해');
  f.add(P.guard, 'eliteReload', 0.2, 4, 0.1).name('정예병 공격 간격');
}
{
  const f = adv.addFolder('순찰조 (맵 상주)');
  f.add(P.patrol, 'count', 0, 10, 1).name('마릿수 (재시작부터)');
  f.add(P.patrol, 'radius', 2, 24, 0.5).name('순찰 반경');
  f.add(P.patrol, 'turn', 0, 1.5, 0.05).name('도는 속도');
  f.add(P.patrol, 'sight', 3, 36, 0.5).name('발견 거리');
  f.add(P.patrol, 'chaseTime', 1, 30, 0.5).name('추격 지속(초)');
  f.add(P.patrol, 'leash', 5, 90, 1).name('초소에서 벗어나는 한계');
  f.add(P.patrol, 'leashCool', 0, 15, 0.5).name('줄 끊긴 뒤 무시 시간');
  f.add(P.patrol, 'postSpread', 0.2, 0.95, 0.02).name('초소 흩는 반경 (재시작부터)');
  f.add(P.patrol, 'minFromSpawn', 0, 60, 1).name('내 시작점과 최소 거리');
}
{
  const f = adv.addFolder('적 체력 / 보상');
  f.add(P.chaser, 'hp', 100, 4000, 50).name('순찰묘 체력');
  f.add(P.chaser, 'reward', 0, 100, 1).name('순찰묘 처치 보상');
  f.add(P.runner, 'hp', 100, 4000, 50).name('날쌘묘 체력');
  f.add(P.runner, 'reward', 0, 100, 1).name('날쌘묘 처치 보상');
  f.add(P.bomber, 'hp', 100, 4000, 50).name('자폭묘 체력');
  f.add(P.bomber, 'reward', 0, 100, 1).name('자폭묘 처치 보상');
}
{
  // 개조(U 패널) — 후반 화력 대응이 여기 걸려 있다 (D87)
  const f = adv.addFolder('개조 (U · 부품으로 구매)');
  f.add(P.upgrade, 'maxLevel', 1, 20, 1).name('최대 레벨');
  f.add(P.upgrade, 'sellRate', 0, 3000, 50).name('부품 환전 (치즈/개)').onChange(renderUpgrade);
  f.add(P.upgrade, 'sellTier', 1, 3, 1).name('환전 필요 공방 등급').onChange(renderUpgrade);
  f.add(P.upgrade, 'baseCost', 0, 10, 1).name('1레벨 부품 비용');
  f.add(P.upgrade, 'costStep', 0, 5, 1).name('레벨당 비용 증가');
  f.add(P.upgrade, 'towerStep', 0, 60, 1).name('경비탑 화력/레벨');
  f.add(P.upgrade, 'guardStep', 0, 60, 1).name('방어병 화력/레벨');
  f.add(P.upgrade, 'speedStep', 0, 3, 0.1).name('이동 속도/레벨');
  f.add(P.upgrade, 'radiusStep', 0, 1, 0.05).name('채굴 시간 단축/레벨');
}
{
  const f = adv.addFolder('적 접근 방식 (우회 시도)');
  f.add(P.enemy, 'flankRadius', 0, 20, 0.5).name('접근 반경');
  f.add(P.enemy, 'probeTurn', 0.2, 3, 0.1).name('막혔을 때 각도 전환');
  f.add(P.enemy, 'probeHold', 0.5, 8, 0.5).name('새 각도 유지(초)');
  f.add(P.enemy, 'drift', 0, 2, 0.05).name('포위 링 도는 속도');
  f.add(P.enemy, 'circleTurn', 0, 5, 0.1).name('막혔을 때 훑는 속도');
  f.add(P.enemy, 'crowdAvoid', 0, 2, 0.05).name('붐비는 목표 피하기(×10m)');
  f.add(P.enemy, 'targetHold', 0, 10, 0.5).name('목표 유지 시간(초)');
  f.add(P.enemy, 'switchPush', 0, 3, 0.05).name('오래 쫓으면 갈아타기(0=끔)');
  f.add(P.enemy, 'switchCap', 0, 60, 1).name('갈아타기 상한(m)');
  f.add(P.enemy, 'engageDist', 0, 20, 0.5).name('이 거리 안이면 안 갈아탐(m)');
}
{
  const f = adv.addFolder('적 지능 (기억 · 잠복 · 예측 · 차단)');
  f.add(P.enemy, 'campTime', 0, 30, 0.5).name('틈 앞 잠복 시간(0=끔)');
  f.add(P.enemy, 'memoryTime', 0, 30, 0.5).name('마지막 목격 기억(초)');
  f.add(P.enemy, 'leadTime', 0, 1.5, 0.05).name('리드 조준(0=현재 위치)');
  f.add(P.enemy, 'cutoffShare', 0, 0.8, 0.02).name('차단조 비율');
  f.add(P.enemy, 'cutoffLead', 0, 12, 0.2).name('차단 지점 앞당김(m)');
  f.add(P.player, 'safeMarkRange', 0, 45, 1).name('은신처 표시가 뜨는 거리');
  f.add(P.player, 'safeMargin', 0.2, 6, 0.1).name('은신처 인정 여유(m)').onChange(refreshReach);
}
{
  const f = adv.addFolder('픽업 (밖에 나갈 이유)');
  f.add(P.pickup, 'interval', 3, 40, 1).name('생성 주기(초)');
  f.add(P.pickup, 'maxOnMap', 1, 12, 1).name('동시 최대 개수');
  f.add(P.pickup, 'stageSpeedup', 0, 2, 0.1).name('스테이지당 주기 단축(초)');
  f.add(P.pickup, 'stageOnMap', 0, 2, 0.1).name('스테이지당 동시 개수 +');
  f.add(P.pickup, 'stageParts', 0, 2, 0.02).name('스테이지당 상자당 부품 +');
  f.add(P.pickup, 'minPlayerDist', 4, 30, 1).name('플레이어 최소 거리');
  f.add(P.pickup, 'partsRatio', 0, 1, 0.05).name('부품 비율');
  f.add(P.pickup, 'partsEach', 1, 5, 1).name('부품 상자당 부품');
  f.add(P.pickup, 'cheeseEach', 5, 150, 5).name('치즈 더미당 치즈');
}

{
  const f = adv.addFolder('위협 (시간 경과 강화)');
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
  player.vis.group.scale.setScalar(P.player.radius);
  for (const q of players) if (q.slot) q.vis.group.scale.setScalar(P.ally.radius);
  for (const e of enemies) e.vis.group.scale.setScalar(enemyR(e));
  for (const ob of obstacles.values()) {
    // 건물 칸은 `bldgRef`를 달고 **mesh가 null**이다 (건물 쪽에서 그린다).
    // 여기 가드가 `ob.building`이라는 없는 속성을 보고 있어서, 건물이 하나라도
    // 서 있으면 설정을 불러올 때마다 터졌다 — 실제 플레이에서는 늘 서 있다.
    if (ob.bedrock || !ob.mesh) continue;
    ob.mesh.scale.set(P.wall.post, P.wall.height, P.wall.post);
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

// 고급 폴더는 통째로 접어 둔다 — 하위 폴더도 전부 (열어야 보인다)
adv.close();
for (const sub of adv.folders) sub.close();

// ---- 튜닝 패널 / 개발 정보 감추기 (D91) ----
// 튜닝 패널이 우측 상단을 덮어 **치즈 수량이 안 보였다.** 기본은 꺼 두고 G로 켠다.
// 켜져 있는 동안에는 자원 표시가 패널 폭만큼 왼쪽으로 비켜선다 (CSS `body.gui-on`).
// 좌측 상단 개발 정보는 백쿼트(`)로 끈다 — 스크린샷·플레이테스트용.
let guiOpen = false;
function setGui(on) {
  // 2P 참가자는 튜닝 패널을 못 연다 (D92-6단계).
  // P는 접속할 때 호스트 것으로 통째로 맞춰 놓는데(HELLO), 참가자가 슬라이더를 만지면
  // 그 순간부터 두 사람이 **다른 규칙**으로 같은 세계를 보게 된다.
  // 값을 바꾸고 싶으면 방을 연 쪽에서 바꾸면 양쪽에 적용된다.
  if (on && net.role === 'client') { flashMsg('튜닝은 방을 연 쪽에서 (설정이 어긋난다)', '#e05050'); return; }
  guiOpen = on;
  gui.domElement.style.display = on ? '' : 'none';
  document.body.classList.toggle('gui-on', on);
}
setGui(false);

let hudOn = true;
function setHud(on) {
  hudOn = on;
  document.body.classList.toggle('hud-off', !on);
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
const resEl = document.getElementById('res');
const overlayEl = document.getElementById('overlay');
const flashEl = document.getElementById('flash');

// ---- 도움말 — 기본은 한 줄, H로 펼친다 (D88) ----
// 예전엔 16줄이 늘 깔려 있어서 **정작 필요한 정보를 가렸다.** 내용이 많다고 다 보여주면
// 아무것도 안 읽힌다. 접어 두고 필요할 때만 꺼낸다 (ESC 메뉴에서도 열 수 있다).
let helpOpen = false;
const HELP_FULL = [
  '── 조작 ──',
  'WASD 이동 · Shift 앞구르기(무적, 기운 소모) · C 카메라 · P 일시정지 · R 재시작 · ESC 메뉴',
  '1~8 들기 / 같은 숫자 다시 = 내려놓기 · **X 철거 모드**(벽·내 건물 모두, 건물은 절반 환급) · U 개조 · H 이 도움말',
  'G 튜닝 패널 켜기/끄기 · ` (백쿼트) 좌상단 개발 정보 끄기',
  '',
  '── 짓기 ──',
  '벽·건물: 클릭 = "거기에 지으러 가라" 명령 (멀어도 알아서 걸어간다)',
  '벽은 도착 후 0.3초 서서 짓는다 = 무방비. 은신처 안에선 안 닿아 관문으로 빼꼼 나와야 한다',
  '창고·공방은 짓는 동안 그 자리에 묶인다. 경비탑은 찍어 두면 알아서 올라간다 (완성 전엔 못 쏜다)',
  '유닛(일꾼·병력)은 자리를 안 찍는다 — 숫자로 고르면 **나올 자리에 고스트**가 서고, 좌클릭이나 Enter로 생산',
  '',
  '── 코어 규칙 ──',
  '벽은 기둥이다: 직교로 붙이면 아무도 못 지나가고, **대각으로 붙이면 나만 지나간다**',
  '건물도 같다 — 대각으로 붙인 두 건물 사이는 나만 통과한다',
  '벽은 무적이다 — 자폭묘 폭발은 **금만 낸다**(2번까지 버팀). 금 간 벽은 **F로 수리**. 보스의 강타는 한 번에 부순다',
  '초록 바닥 = 내 영토(고양이가 못 오는 땅). 그 위에선 기운이 빨리 차고, 면적만큼 치즈가 쌓인다',
  '',
  '── 경제 · 기술 ──',
  '치즈더미에 다가가 E(또는 더미 우클릭) → 자동 왕복 채굴. 직접 움직이면 즉시 취소',
  '더미 위 `1/3` = 붙은 일꾼 / 정원. 꽉 차면(붉게) 다음 더미를 확보해야 한다',
  '공방을 지어야 경비탑·병력이 열린다 (Lv.1 경비탑·근접병 → Lv.2 사수 → Lv.3 정예병)',
  '근처(4m) 공방·경비탑을 **F로 제자리 업그레이드**. 공방 업그레이드는 치즈+부품이 든다',
  '후반 적은 체력이 오른다 → **밖에 떨어지는 부품**을 주워 U 개조로 화력을 올려야 따라간다',
  '',
  '── 병력 · 적 ──',
  '빈손일 때 좌클릭/드래그 = 유닛 선택 · 우클릭 = 명령(더미=채굴 / 빈 땅=이동) · Tab 방어병 전원',
  '적 우클릭 = 선택한 방어병 집중 공격 · 파란 링 = 순찰조 · 초록 표시 = 은신처',
  '적은 앞을 노리고, 일부는 퇴로를 막고, 못 들어가는 틈 앞에서 기다린다',
  '오래 못 때리면 목표를 놓고 내 건물을 뜯으러 간다 — 숨는 건 공짜가 아니다',
  '10스테이지엔 보스 "톰"이 쳐들어온다. **처치해야 클리어**된다',
  '',
  '── 협동 (2~4인, D92~D97) ──',
  '시작 화면에서 **2인 협동** 또는 **3~4인 협동** → 방 만들기(코드가 나온다) / 방 코드로 참가.',
  '2인 방은 **둘이 붙는 순간** 시작한다. 3~4인 방은 로비에서 기다렸다가 **방장이 시작**을 누른다',
  '게임 중에 부르려면 ESC 메뉴 → 협동',
  '방을 연 쪽이 갈색 햄스터, 들어온 쪽이 회색 햄스터. 살림은 따로다 — 치즈·부품·창고·일꾼·병력 전부 각자',
  '**한쪽이 잡히면 그 사람 것만 무너진다.** 상대는 그대로니까, 가서 몸으로 터치해 구출하면 된다',
  '둘 다 기절하면 전멸. 고양이는 둘 사이에서 목표를 바꾼다 — 한쪽이 끌고 한쪽이 짓는 게 통한다',
  '방을 만든 쪽 화면이 기준이다. 누가 나가도 **남은 사람끼리 계속**하고, 나간 사람 벽도 그대로 남는다',
  '햄스터 색이 곧 슬롯이다 — 1P 갈색 · 2P 회색 · 3P 초록 · 4P 보라. **벽 색도 같이 간다**',
  '**적이 인원수만큼 는다** — 2인 1.8배 · 3인 2.6배 · 4인 3.4배. 어그로가 갈리므로 그래야 압박이 유지된다',
  '**잡혀도 바로 안 무너진다** — 20초 안에 **누구든** 몸으로 터치하면 지은 게 그대로 산다.',
  '  못 구하면 그때 무너진다. 혼자일 때는 예전대로 즉시 무너진다. **전원이 누우면** 전멸',
  '영토 수입은 **내가 세운 벽 비율만큼** 들어온다 — 안 쌓으면 안 번다',
  '우측 하단 미니맵에 서로의 얼굴이 뜬다. 빨갛게 깜빡이면 잡혀서 카운트다운 중이라는 뜻',
  '**0 = 도발**. 춤을 춰서 주변 고양이를 나에게 끌어온다 — 공격이 없는 이 게임의 유일한 공격이다.',
  '  춤추는 동안 **못 움직인다**. 끌어놓고 도망칠 준비가 돼 있어야 한다',
  '**Q = 치즈 건네기 · Z = 부품 건네기.** 옆에 붙어야 넘어가고, **가장 가까운 사람**에게 간다',
  '**F9** — 접속 진단(프레임·RTT·스냅샷·보간 지연·예측 오차). 끊기거나 튈 때 여기부터 본다',
].join('\n');

function renderHelp() {
  helpEl.classList.toggle('open', helpOpen);
  helpEl.textContent = helpOpen ? HELP_FULL : 'H: 조작법 · ESC: 메뉴';
}
renderHelp();

// ---- 자원 — 우측 상단 아이콘 + 수치 (D88) ----
function updateRes() {
  resEl.innerHTML =
    `<div class="r cheese"><span class="ic">🧀</span>${Math.floor(localPlayer().cheese)}</div>` +
    `<div class="r parts"><span class="ic">⚙️</span>${localPlayer().parts}</div>`;
}

let alive = true;
let paused = false;
let survival = 0;
let hudT = 0;
let caughtCount = 0;
// 구르기 상태 (D77): player.rollT>0 이면 구르는 중 = 무적

function startRoll(p = player) {
  if (!alive || p.stunned || p.buildJob || p.rollT > 0 || p.rollCd > 0) return;
  if (p.stamina < P.player.stamRoll) { flashMsg('숨이 찼다', '#e0a050'); return; }
  p.stamina -= P.player.stamRoll;
  p.stamIdle = 0;
  // 방향은 **입력 표본**에서 온다 (D92-1f). 키를 누른 그 프레임에 굴러도 어긋나지
  // 않도록 로컬 플레이어는 여기서 한 번 더 표본을 뜬다 (네트워크 쪽은 p.in이 이미 최신이다).
  if (p.local) sampleLocalInput(p);
  let dx = p.in.mx, dz = p.in.mz;
  if (!dx && !dz) { dx = p.faceX; dz = p.faceZ; }
  p.rollX = dx; p.rollZ = dz;
  p.rollT = P.player.rollTime;
  p.rollCd = P.player.rollCool;
  p.rollSpin = 0;
  p.faceX = dx; p.faceZ = dz;
  // 구르면 걸어둔 명령은 전부 풀린다 (직접 이동과 같은 취급)
  clearMineOrder(undefined, p);
  if (p.wallOrders.length) clearWallOrders(undefined, p);
  p.buildOrder = null;
  p.wallCast = null;
}

// ---- 도발 (D96) ----
// 0번. 춤을 춰서 **주변의 적을 나에게 끌어온다.** 공격이 없는 게임에서 유일한 공격이고,
// 협동에서 유일하게 "상대를 위해 내가 대신 맞아 준다"가 되는 행동이다.
// 춤추는 동안 못 움직이는 게 대가 — 끌어놓고 도망칠 준비가 돼 있어야 한다.
function startTaunt(p = player) {
  if (!alive || p.stunned || p.buildJob || p.upgradeJob || p.rollT > 0 || p.tauntCd > 0) return;
  p.tauntT = P.coop.tauntTime;
  p.tauntCd = P.coop.tauntCool;
  // 걸어둔 명령은 푼다 (직접 개입과 같은 취급)
  clearMineOrder(undefined, p);
  if (p.wallOrders.length) clearWallOrders(undefined, p);
  p.buildOrder = null;
  p.wallCast = null;
  // 사거리 안의 적이 **즉시** 다시 고르게 한다 — targetHold를 안 풀면 최대 3초 늦게 온다
  let pulled = 0;
  for (const e of enemies) {
    if (Math.hypot(e.x - p.x, e.z - p.z) >= P.coop.tauntRange) continue;
    e.targetUntil = 0;
    pulled++;
  }
  flashFor(p, pulled ? `도발! 주변 ${pulled}마리를 끌었다` : '도발했지만 근처에 적이 없다',
           pulled ? '#ffb347' : '#9aa3b2');
}

// ---- 건네주기 (D96) ----
// 가까이 붙어야만 넘어간다. 살림 분리(D43)를 안 깨면서 두 경제가 거래하게 만든다.
function giveTo(p, kind) {
  if (p.stunned) return;
  // 여럿일 수 있으므로 **가장 가까운 사람**에게 준다 (D97)
  const mate = nearestMate(p, P.coop.giveRange);
  if (!mate || mate.stunned) { flashFor(p, '너무 멀다 — 옆에 붙어야 건넨다', '#e05050'); return; }
  if (kind === 'parts') {
    const n = Math.min(P.coop.giveParts, p.parts);
    if (n <= 0) { flashFor(p, '건넬 부품이 없다', '#e05050'); return; }
    p.parts -= n; mate.parts += n;
    flashFor(p, `${mate.name}에게 부품 ${n} 건넸다`, '#8fd6ff');
    flashFor(mate, `${p.name}가 부품 ${n}을 줬다`, '#8fd6ff');
  } else {
    const n = Math.min(P.coop.giveCheese, Math.floor(p.cheese));
    if (n <= 0) { flashFor(p, '건넬 치즈가 없다', '#e05050'); return; }
    p.cheese -= n; mate.cheese += n;
    flashFor(p, `${mate.name}에게 치즈 ${n} 건넸다`, '#ffd24a');
    flashFor(mate, `${p.name}가 치즈 ${n}을 줬다`, '#ffd24a');
  }
  spawnBuildFx((p.x + mate.x) / 2, (p.z + mate.z) / 2);
}

// 화면 흔들림은 **카메라의 상태**지 햄스터의 상태가 아니다 (D92-1e).
// 기계마다 카메라가 하나뿐이고 hurtHamster가 who.local로 이미 거르므로
// 구조체 필드로 쪼갤 이유가 없다 — buildSlot·removeMode와 같은 "클라 로컬 UI" 부류다.
let camShake = 0;
let surgeDone = 0;         // 킬 서지가 몇 번 발동했는지
let flashT = 0;  // 화면 중앙 알림 남은 시간

// 맵을 통째로 다시 만든다. 크기가 바뀌므로 바닥/그리드/림/지형/광맥/스폰을 전부 재생성.
function rebuildWorld(idx) {
  const M = MAPS[idx];
  mapIndex = idx;
  CELLS = M.size;
  HALF = (CELLS * CS) / 2;
  NAV = CELLS * NAVPC;

  // 기존 월드 오브젝트 정리
  for (const b of [...buildings]) destroyBuilding(b, false);
  clearPickups();
  clearGuards();
  clearWorkers();
  for (const ob of [...obstacles.values()]) removeObstacle(ob);
  obstacles.clear();
  clearPileLabels();   // 더미가 사라지면 정원 표시도 같이 (D90)
  for (const n of nodes) { scene.remove(n.mesh); n.mesh.userData.mat.dispose(); }
  nodes.length = 0;
  for (const e of enemies) {
    scene.remove(e.vis.group); disposeBar(e.bar);
    if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); }
  }
  enemies.length = 0;

  buildGround(M.floor, M.gridColor);

  // 지형
  const t = layoutTools();
  M.build(t);
  for (const [i, j] of t.cells) addObstacle(i, j, true);

  // 광맥
  for (const [i, j, mul] of M.nodes) {
    const w = cellToWorld(i, j);
    const mesh = makeCheesePile();
    mesh.position.set(w.x, 0, w.z);
    mesh.scale.setScalar(mul ? 1.25 : 1);   // 군집 더미는 눈에 띄게 크게
    scene.add(mesh);
    nodes.push({ i, j, mul: mul || 1, amount: P.res.nodeAmount * (mul || 1), mesh });
  }

  PLAYER_SPAWN = cellToWorld(M.playerSpawn[0], M.playerSpawn[1]);
  ENEMY_SPAWN = cellToWorld(M.enemySpawn[0], M.enemySpawn[1]);

  clearAll = null; clearBed = null; // 크기가 바뀌었으므로 이전 필드는 버린다
  refreshClearance(true);
}

function setMap(idx) {
  if (!netAuthoring() && net.connected) return;   // 맵은 호스트가 정한다
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
  for (const p of players) p.harvestPulse = 0;
  for (const n of nodes) n.bitT = 0;
  player.cheese = startResources();
  for (const n of nodes) {
    n.amount = P.res.nodeAmount * (n.mul || 1);
    n.mesh.userData.mat.color.setHex(0xf0b429);
  }
  clearPickups();
  clearGuards();
  clearWorkers();
  for (const q of players) { q.mineOrder = null; q.orderPath = []; q.orderRepathT = 0; q.buf = null; }
  renderT = 0; lastSnapT = -1;   // 보간 시계도 새 판에서 다시 맞춘다 (D93)
  if (menuOpen) setMenu(false);
  buildSlot = -1;      // 시작은 빈손 (숫자키로 들고 ESC로 내려놓는다)
  removeMode = false;
  for (const q of players) { q.buildJob = null; q.buildOrder = null; q.buildCooldown = 0; q.upgradeJob = null; }
  territoryGen = -1;   // 영토를 다시 센다 (세대 카운터라 시간으로 재면 안 된다 — D54의 교훈)
  for (const q of players) { q.wallOrders = []; q.wallCast = null; }
  // 구르기·기운은 두 햄스터 모두 초기화 (D92-1d)
  for (const p of players) { p.rollT = 0; p.rollCd = 0; p.rollGrace = 0; p.tauntT = 0; p.tauntCd = 0;
                             p.stamina = P.player.stamMax; p.stamIdle = 99; }
  for (const q of players) { q.cheese = startResources(); q.carry = 0; }
  killCount = 0;
  for (const b of [...buildings]) destroyBuilding(b, false);
  for (const p of players) { p.parts = 0; p.upg = newUpg(); }
  upgOpen = false;
  renderUpgrade();
  stage = 1;
  stageT = 0;
  victory = false;
  growthSpawned = 0;
  // 두 햄스터를 같은 초기 상태로 (D92-1c)
  for (const p of players) { p.hp = P.player.hp; p.hurtT = 99; p.grace = 0; p.stunned = false; p.wipeT = 0; }
  camShake = 0;
  surgeDone = 0;
  // 슬롯마다 제자리에서 시작. 사람이 앉은 슬롯만 켠다 (D97)
  for (const q of players) {
    q.active = q.slot === 0 || !q.ai;
    q.stunned = false;
    const sp = spawnSlotAt(q.slot);
    q.x = sp.x; q.z = sp.z;
    q.faceX = 0; q.faceZ = -1;
    q.vis.group.rotation.x = 0;
    q.vis.group.rotation.z = 0;
    q.vis.setOpacity(1);
    q.vis.group.visible = q.active;
  }
  for (const ob of [...obstacles.values()]) if (!ob.bedrock) removeObstacle(ob);
  refreshClearance();
  // 적 무리 초기화 — 마릿수 슬라이더 변경분도 여기서 반영
  for (const e of enemies) {
    scene.remove(e.vis.group); disposeBar(e.bar);
    if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); }
  }
  enemies.length = 0;
  // 적 스폰은 호스트만 한다 (D92-6단계) — 클라가 만들면 id가 어긋나서
  // 스냅샷이 엉뚱한 개체에 값을 써 넣고, 그 증상이 물리 버그처럼 보인다
  if (netAuthoring()) {
    setEnemyCount(scaled(P.enemy.count));
    spawnPatrols();        // 맵에 상주하는 순찰조 (웨이브와 별개)
  }
  survival = 0;
  caughtCount = 0;
  for (const p of players) p.grace = 0;
  flashT = 0;
  flashEl.style.opacity = '0';
  alive = true;
  overlayEl.classList.add('hidden');
}

// 잡힘 — 죽지 않고 적의 시작 지점으로 끌려간다.
//  (원작 유즈맵처럼: 잡히면 적 본진에 떨궈져 다시 도망쳐 나와야 함)
// 공격을 맞는다 — 체력이 0이 돼야 잡힌다 (한 방 즉사가 아니다)
// 두 햄스터가 **같은 규칙**을 쓴다 (D92-1c).
// 예전엔 who===player 로 갈라져서, 동료에게만 없는 것이 세 개나 있었다:
//   구르기 회피(D77) · 화면 흔들림 · hurtT(재생 지연) 갱신.
// 2P에서는 그게 곧 "P2는 구르기로 못 피한다"가 되므로 하나로 합쳤다.
function hurtHamster(who, dmg) {
  if (!who.active) return;   // 빈 슬롯은 무시
  if (who.grace > 0 || who.stunned) return;
  // 구르는 중이면 **회피** (D77) — 예비동작이 끝나기 전에 굴러야 한다.
  // rollGrace는 원격 플레이어의 지연 보정분이다 (D92-7단계)
  if (who.rollT > 0 || who.rollGrace > 0) { flashFor(who, '회피!', '#8fd6ff'); return; }
  who.hp -= dmg;
  who.hurtT = 0;
  who.grace = 0.35;               // 아주 짧은 피격 무적 — 연타로 순삭되지 않게
  if (who.local) camShake = 0.35;
  if (who.hp <= 0) { who.hp = 0; caught(who); }
}

// 잡힘 — "펑" 하고 적 본진으로 끌려간다.
//  동료 모드: 기절 상태로 눕는다. 동료(또는 플레이어)가 터치하면 부활.
//  모두 기절하면 전멸 = 게임 오버. 동료가 없으면 한 번 잡히면 바로 전멸.
function caught(who) {
  caughtCount++;
  cancelBuild(true, who);   // 각자의 채널링만 취소한다 (D92-1e)
  spawnBuildFx(who.x, who.z); // 잡힌 자리에서 펑
  who.x = ENEMY_SPAWN.x;
  who.z = ENEMY_SPAWN.z + who.slot * 1.2;   // 슬롯마다 조금씩 어긋나게 떨군다
  who.faceX = 0; who.faceZ = 1;
  collideWithObstacles(who, P.player.radius);
  spawnBuildFx(who.x, who.z); // 떨어진 자리에서도 펑
  // 무리 전체가 잠깐 멈칫하고 다시 판단
  for (const e of enemies) {
    e.path = []; e.repathT = 0; e.stallT = 0; e.attackTarget = null; e.raidTarget = null;
  }
  who.hp = P.player.hp; who.hurtT = 99;   // 잡히면 체력은 채워서 부활한다 (D92-1c: 양쪽 동일)
  who.grace = P.player.respawnGrace;      // 빠져나올 시간 (D95)
  // 원작: 잡히면 **그 사람이** 지은 것이 전부 소멸하고 깃발만 남는다 (D7).
  // 소멸은 소유자별이다 (D92-2단계). 벽·건물은 예전에도 소유자를 봤는데
  // 방어병·일꾼만 필터가 없어서, P1이 잡히면 P2의 군대까지 같이 사라졌다.
  // 솔로 동료는 지은 게 없으므로 여기서 아무 일도 안 일어난다.
  // ---- 소멸 (D7) — 2P에서는 **유예된다** (D95) ----
  // 혼자면 예전 그대로 즉시 무너진다. 둘이면 wipeGrace 동안 버티고, 그 안에 동료가
  // 터치하면 취소된다. "잡히면 다 잃는다"(개인 페널티)가
  // **"혼자면 다 잃는다. 친구가 있으면 구할 수 있다"**(사회적)로 바뀐다 — D7의 정체성이다.
  who.carry = 0;
  if (P.player.wipeOnCatch && !who.ai) {
    if (humans().length > 1 && P.coop.wipeGrace > 0) {
      who.wipeT = P.coop.wipeGrace;
      flashFor(who, `${Math.round(P.coop.wipeGrace)}초 안에 구출되지 않으면 전부 무너진다`, '#ffb347');
    } else {
      wipeOwner(who);
    }
  }
  if (who.local) camTarget.set(who.x, 0, who.z); // 카메라가 끌려간 걸 보여줌
  // 혼자면 기절할 이유가 없다 — 구해 줄 사람이 없다 (D95).
  // 원작처럼 **본진에 떨궈지고 다시 시작**한다. 잃은 건 지은 것이고, 판은 계속된다.
  if (humans().length < 2) {
    flashMsg('잡혔다! 적 본진으로 끌려났다', '#ff6b6b');
    return;
  }
  who.stunned = true;
  // **전원이 누우면** 전멸이다 (D97 — 예전엔 "둘 다"였다)
  if (humans().every((q) => q.stunned)) return gameOver();
  if (who.local) flashMsg('잡혔다! 동료가 구하러 올 때까지 기절', '#ff6b6b');
  else flashMsg(`${who.name}가 잡혔다! 적 본진에서 기절 — 구하러 가자`, '#ff6b6b');
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
// 한 사람이 지은 것을 통째로 무너뜨린다 (D7). 소유자별이다 — 상대 것은 안 건드린다.
function wipeOwner(who) {
  let lost = 0;
  // 벽 300칸이 한 프레임에 사라진다. 개별 이벤트 300개를 보내지 않고
  // **소유자 하나짜리 소멸 이벤트**로 대신한다 (D92-6단계)
  wallEvMute++;
  for (const ob of [...obstacles.values()])
    if (!ob.bedrock && !ob.bldgRef && ob.owner === who.owner) { removeObstacle(ob); lost++; }
  wallEvMute--;
  wallEv({ a: 3, o: who.owner });
  for (const b of [...buildings]) if (b.owner === who.owner) destroyBuilding(b, false);
  clearGuards(who.owner);
  clearWorkers(who.owner);
  who.wipeT = 0;
  markNavDirty();
  if (lost || who.local) flashFor(who, `지은 것이 전부 무너졌다 (벽 ${lost}칸)`, '#ff4d4d');
}

// 유예 시간이 흐른다. 다 되면 그때 무너진다 (D95).
function updateWipeGrace(dt) {
  for (const q of players) {
    if (!q.wipeT || q.wipeT <= 0) continue;
    q.wipeT -= dt;
    if (q.wipeT <= 0) { q.wipeT = 0; wipeOwner(q); }
  }
}

function updateRescue() {
  if (humans().length < 2) return;
  const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1.2;
  const save = (who, mine, by) => {
    who.stunned = false;
    who.hp = P.player.hp;
    who.grace = P.player.graceTime;
    spawnBuildFx(who.x, who.z);
    // **구출이 소멸을 취소한다** (D95) — 구하러 가는 것에 처음으로 이해관계가 붙는다
    const saved = who.wipeT > 0;
    who.wipeT = 0;
    if (mine) flashMsg(saved ? '구출됐다! 지은 것도 지켰다' : '구출됐다!', '#6ee07a');
    else if (by && by.local) flashMsg(saved ? `${who.name}를 구했다 — 기지도 지켰다` : `${who.name}를 구출했다!`, '#6ee07a');
    else flashMsg(`${by ? by.name : '누군가'}가 ${who.name}를 구했다`, '#6ee07a');
  };
  // 누구든 누구를 구할 수 있다 (D97). 서 있는 사람이 누운 사람에게 닿으면 된다
  for (const down of players) {
    if (!down.active || !down.stunned) continue;
    for (const up of players) {
      if (up === down || !up.active || up.stunned) continue;
      if (near(up, down)) { save(down, down.local, up); break; }
    }
  }
}

// ---- 업그레이드 패널 (U) ----
const upgEl = document.getElementById('upgrade');
let upgOpen = false;

function buyUpgrade(k, p = player) {
  const u = UPGRADES[k];
  if (!u) return;
  if (!nearWorkshop(p)) { flashMsg('공방 옆에서만 개조할 수 있습니다', '#e05050'); return; }
  const lv = p.upg[u.key];
  if (lv >= P.upgrade.maxLevel) { flashMsg('이미 최대 레벨입니다', '#e05050'); return; }
  const cost = upgCost(lv);
  if (p.parts < cost) { flashMsg(`부품이 부족합니다 (${cost} 필요)`, '#e05050'); return; }
  p.parts -= cost;
  p.upg[u.key] = lv + 1;
  flashMsg(`${u.label} Lv.${lv + 1}!`, '#8fd6ff');
  renderUpgrade();
}

// ---- 부품 → 치즈 (D100) ----
// 부품은 밖에서만 얻는 위험 화폐인데(D22), 후반에는 살 게 없어서 그냥 쌓인다.
// 공방을 끝까지 올린 사람에게만 출구를 하나 열어 준다 — **환전도 공방 옆에서**.
// 그래야 "밖에서 주워 와 공방으로 돌아간다"는 왕복이 끝까지 유지된다.
const canSellParts = (p) => maxWorkshopTier() >= P.upgrade.sellTier;

function sellParts(p = player) {
  if (!nearWorkshop(p)) { flashFor(p, '공방 옆에서만 환전할 수 있습니다', '#e05050'); return; }
  if (!canSellParts(p)) { flashFor(p, `공방 Lv.${P.upgrade.sellTier} 필요`, '#e05050'); return; }
  if (p.parts < 1) { flashFor(p, '부품이 없습니다', '#e05050'); return; }
  p.parts -= 1;
  p.cheese += P.upgrade.sellRate;
  flashFor(p, `부품 1 → 치즈 ${P.upgrade.sellRate}`, '#ffd24a');
  renderUpgrade();
}

// 공방 옆(4m)에 서 있어야 개조할 수 있다 — 공방을 지키고 드나들 이유
function nearWorkshop(p = player) {
  return buildings.some((b) => b.kind === 'workshop' &&
    Math.hypot(b.cx - p.x, b.cz - p.z) < 4.0);
}

// 공방 옆에 가면 **저절로 뜬다** (D88) — 개조가 있다는 걸 몰라서 안 쓰는 게 제일 큰 손실이다.
// 다만 저절로 뜬 상태에서는 **읽기 전용**이고, 숫자키는 계속 핫바를 쓴다.
// (안 그러면 내 공방 옆에서 건물을 못 짓는다) 구매는 U로 명시적으로 켜야 한다.
function renderUpgrade() {
  const me = localPlayer();
  const ws = nearWorkshop(me);
  const show = upgOpen || ws;
  if (!show) { upgEl.style.display = 'none'; return; }
  upgEl.style.display = 'block';
  upgEl.innerHTML =
    `<div class="uhead">개조 · 부품 ${me.parts}` +
    (!ws ? ' · <span class="warn">공방 옆으로 가세요</span>'
         : upgOpen ? ' · <span style="color:#6ee07a">숫자키로 구매 (U 닫기)</span>'
                   : ' · <span class="warn">U를 눌러 구매</span>') + '</div>' +
    UPGRADES.map((u, k) => {
      const lv = me.upg[u.key];
      const max = lv >= P.upgrade.maxLevel;
      const cost = upgCost(lv);
      const can = ws && upgOpen && !max && me.parts >= cost;
      return `<div class="urow${can ? '' : ' dim'}">` +
        `<b>${k + 1}</b> ${u.label} <span class="lv">Lv.${lv}/${P.upgrade.maxLevel}</span>` +
        `<span class="cost">${max ? 'MAX' : `⚙️${cost}`}</span>` +
        `<span class="eff">${u.unit()}</span></div>`;
    }).join('') +
    // 환전 줄 (D100). 공방을 다 올리기 전에는 **왜 못 쓰는지**를 대신 보여준다 —
    // 줄 자체를 숨기면 이런 게 있다는 걸 영영 모른다 (D88과 같은 이유)
    (() => {
      const open = canSellParts(me);
      const can = ws && upgOpen && open && me.parts >= 1;
      return `<div class="urow${can ? '' : ' dim'}">` +
        `<b>${UPGRADES.length + 1}</b> 부품 환전 ` +
        `<span class="lv">${open ? `보유 ⚙️${me.parts}` : `공방 Lv.${P.upgrade.sellTier} 필요`}</span>` +
        `<span class="cost">⚙️1</span>` +
        `<span class="eff">치즈 +${P.upgrade.sellRate}</span></div>`;
    })();
}

const hotbarEl = document.getElementById('hotbar');
function updateHotbar() {
  hotbarEl.innerHTML = BUILD_SLOTS.map((sl, k) => {
    const lock = slotLockReason(sl);
    // 잠긴 슬롯은 값 대신 **왜 못 쓰는지**를 보여준다 (D88) —
    // 비활성이라는 사실만 보여주면 뭘 해야 열리는지 알 수 없다
    if (lock) return `<div class="slot locked"><b>${k + 1}</b>${sl.label}<br><span class="why">${lock}</span></div>`;
    const cost = sl.cost();
    const afford = localPlayer().cheese >= cost;
    const cls = (k === buildSlot ? 'slot sel' : 'slot') + (afford ? '' : ' dim');
    const costTxt = cost > 0 ? `${cost}🧀` : '무료';
    const how = isUnitSlot(sl) ? ' ⏎' : '';
    return `<div class="${cls}"><b>${k + 1}${how}</b>${sl.label}<br>${costTxt}</div>`;
  }).join('') +
  `<div class="slot rm${removeMode ? ' sel' : ''}"><b>X</b>철거<br>${P.wall.removeCost}🧀</div>` +
  `<div class="slot hand${buildSlot < 0 && !removeMode ? ' sel' : ''}"><b>ESC</b>${buildSlot < 0 && !removeMode ? '빈손' : '내려놓기'}<br>—</div>`;
}

function flashMsg(text, color = '#6ee07a') {
  flashEl.textContent = text;
  flashEl.style.color = color;
  flashEl.style.opacity = '1';
  flashT = 2.0;
}

// 소유자가 있는 실패·성공 알림은 **그 사람 화면에만** 떠야 한다 (D92-2단계).
// 안 그러면 P2가 치즈가 모자라 벽을 못 세울 때마다 P1 화면에 빨간 글씨가 뜬다.
// p가 null이면(주인 없는 사건) 그냥 띄운다.
function flashFor(p, text, color = '#6ee07a') {
  if (!p || p.local) { flashMsg(text, color); return; }
  // 호스트가 원격 플레이어 대신 판정하므로, 그 결과는 **그 사람 화면으로만** 보낸다 (D97).
  // 전원 브로드캐스트하면 4인에서 남의 실패 메시지가 내 화면을 덮는다.
  if (net.role === 'host' && net.connected) net.sendTo(p.slot, { k: 'MSG', t: text, c: color });
}


// ---- ESC 메뉴 (D71) ----
// 취소할 게 없을 때 ESC를 누르면 뜬다. 열려 있는 동안 게임은 멈춘다.
const menuEl = document.getElementById('menu');
const mapListEl = document.getElementById('m-maplist');
let menuOpen = false;

function setMenu(on) {
  menuOpen = on;
  menuEl.classList.toggle('on', on);
  mapListEl.classList.remove('on');
  paused = on;
}

function buildMapList() {
  mapListEl.innerHTML = '';
  MAPS.forEach((m, k) => {
    const b = document.createElement('button');
    b.textContent = (k === mapIndex ? '● ' : '') + m.name + ' — ' + m.desc;
    b.style.fontSize = '13px';
    b.style.textAlign = 'left';
    b.onclick = () => { setMenu(false); setMap(k); };
    mapListEl.appendChild(b);
  });
}

document.getElementById('m-resume').onclick = () => setMenu(false);
document.getElementById('m-restart').onclick = () => { setMenu(false); issueCommand({ t: 'restart' }); };
document.getElementById('m-help').onclick = () => { setMenu(false); helpOpen = true; renderHelp(); };
document.getElementById('m-gui').onclick = () => { setGui(!guiOpen); };
document.getElementById('m-maps').onclick = () => { buildMapList(); mapListEl.classList.add('on'); };
document.getElementById('m-quit').onclick = () => {
  setMenu(false);
  alive = false;
  paused = false;
  ghost.visible = false;
  overlayEl.querySelector('h1').textContent = '게임 종료';
  document.getElementById('overlay-sub').textContent =
    `스테이지 ${stage} · ${survival.toFixed(0)}초 생존 — R 키로 다시 시작`;
  overlayEl.classList.remove('hidden');
};

// ============================================================
// 멀티 로비 · 프로토콜 (D92-5·6단계)
//  · 호스트가 시뮬 전체를 돌린다. 클라는 입력을 보내고 상태를 받아 그린다
//  · 접속하면 HELLO로 snapshotSettings()를 통째로 보낸다 —
//    P 동기화 문제가 **기존 함수 재사용으로 통째로 해결된다**
// ============================================================
const netEl = document.getElementById('net');
const netMsgEl = document.getElementById('m-netmsg');

// ---- 시작 화면 (D93) ----
// 페이지를 열면 곧장 솔로가 굴러가던 것을 멈췄다. 그게 멀티를 "이미 돌아가는 판 위에
// 접속을 얹는" 모양으로 만들었고, 실제로 그 때문에 참가자 화면이 안 넘어갔다.
// 이제 **몇 명이 할지 고르기 전에는 시뮬이 시작되지 않는다.**
const startEl = document.getElementById('start');
let started = false;

function showStep(id) {
  for (const el of startEl.querySelectorAll('.step')) el.classList.toggle('on', el.id === id);
}

function openStart(step = 's-mode') {
  started = false;
  paused = true;
  startEl.classList.remove('hidden');
  showStep(step);
}

// 실제로 판을 시작한다. 여기 한 곳만 지나면 되도록 모아 뒀다 —
// 솔로도 2P도 **같은 출발선**(재시작 + 기본 시점)에서 시작해야
// "어째서인지 시점이 바뀐다" 같은 게 안 생긴다.
// fresh=false는 **참가자가 남의 판에 끼어드는 경우**다 (D98). 이때 restart를 돌리면
// 방금 applyFull이 세워 놓은 벽과 건물을 그대로 쓸어버린다 — 첫 접속에는 호스트도
// 막 시작한 참이라 안 보이지만, 끊겼다 다시 붙으면 지어 둔 게 전부 사라진다.
function beginMatch(fresh = true) {
  startEl.classList.add('hidden');
  started = true;
  setMenu(false);
  setCamera(DEFAULT_CAM);
  if (fresh) restart();
}

// ---- 로비 좌석 (D97) ----
// 3~4인 방은 다 모일 때까지 기다려야 하는데, 누가 들어왔는지 안 보이면 기다릴 수가 없다.
function renderLobby() {
  const paint = (el) => {
    if (!el) return;
    el.innerHTML = '';
    for (let k = 0; k < net.maxPlayers; k++) {
      const on = players[k] && players[k].active;
      const d = document.createElement('div');
      d.className = 'seat' + (on ? ' on' : '');
      if (on) d.style.background = '#' + SLOT_FUR[k].toString(16).padStart(6, '0');
      d.innerHTML = `${SLOT_NAME[k]}<span class="who">${on ? (k === net.slot ? '나' : '접속') : '비어 있음'}</span>`;
      el.appendChild(d);
    }
  };
  paint(document.getElementById('s-seats'));
  paint(document.getElementById('s-seats2'));
  const begin = document.getElementById('s-begin');
  if (begin) {
    // 2인 방은 붙는 순간 자동 시작이라 버튼이 필요 없다 (D93 그대로)
    const show = net.role === 'host' && net.maxPlayers > 2 && !started;
    begin.style.display = show ? 'block' : 'none';
    const n = humans().length;
    begin.textContent = n >= net.maxPlayers ? '시작하기 (다 모였다)' : `${n}/${net.maxPlayers} — 지금 시작하기`;
  }
  const lc = document.getElementById('s-lobby-code');
  if (lc) lc.textContent = net.code;
}

function renderNet() {
  const on = net.role !== 'solo';
  netEl.classList.toggle('on', on);
  if (on) {
    const who = net.role === 'host' ? '호스트' : '참가';
    netEl.innerHTML = net.connected
      ? `${who} · 방 <b>${net.code}</b> · ${humans().length}/${net.maxPlayers}명 · ${net.rtt}ms`
      : `${net.status}`;
  }
  netMsgEl.textContent = net.role === 'solo' ? '' : net.status;
  const hm = document.getElementById('s-hostmsg');
  const jm = document.getElementById('s-joinmsg');
  if (net.role === 'host' && !started) {
    document.getElementById('s-code').textContent = net.code || '······';
    hm.textContent = net.status;
    hm.classList.toggle('bad', !net.code);
    renderLobby();
  }
  if (net.role !== 'host' && !started && jm) {
    jm.textContent = net.connected ? '' : net.status;
    jm.classList.toggle('bad', /못|없|막|오류|끊/.test(net.status));
    if (net.connected) renderLobby();   // 참가자도 누가 들어왔는지 봐야 기다릴 수 있다 (D97)
  }
}

// ============================================================
// 접속 개발 패널 (D93) — F9
//  멀티가 붙고 나서 "렉이 심하다"는 지적을 받았는데, 그게 프레임 문제인지
//  스냅샷이 안 오는 건지 보간이 뒤처지는 건지 **화면만 봐서는 구분이 안 됐다.**
//  그래서 원인별로 숫자를 하나씩 띄운다. 여기 뜨는 값의 이름이 곧 의심 목록이다.
// ============================================================
const netDevEl = document.getElementById('netdev');
let netDevOn = false;
// 프레임 시간과 스냅샷 도착을 굴러가는 창으로 센다
const frameMs = [];
let snapTimes = [];
let lastFrameAt = performance.now();

function noteFrame() {
  const now = performance.now();
  frameMs.push(now - lastFrameAt);
  lastFrameAt = now;
  if (frameMs.length > 120) frameMs.shift();
}
function noteSnap() {
  const now = performance.now();
  snapTimes.push(now);
  snapTimes = snapTimes.filter((t) => now - t < 2000);
}

function renderNetDev() {
  if (!netDevOn) return;
  const n = frameMs.length;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const p50 = n ? sorted[n >> 1] : 0;
  const p95 = n ? sorted[Math.floor(n * 0.95)] : 0;
  const fps = p50 > 0 ? Math.round(1000 / p50) : 0;
  const snapHz = (snapTimes.length / 2).toFixed(1);
  const me = localPlayer();
  // 예측 오차 = 내가 그리는 내 위치와 호스트가 말하는 내 위치의 차이
  const err = me.netX !== undefined ? Math.hypot(me.x - me.netX, me.z - me.netZ) : 0;
  // 보간 지연 = 지금 그리는 시각이 최신 스냅보다 얼마나 과거인가
  const behind = lastSnapT >= 0 ? lastSnapT - renderT : 0;
  const cls = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : '');
  netDevEl.innerHTML =
    `<b>F9 접속 진단</b>  ${net.role}${net.connected ? '' : ' (미접속)'}${alive ? '' : '  <span class="warn">판 종료 — 아래 숫자는 멈춘 값</span>'}
` +
    `프레임   ${fps}fps  p50 ${p50.toFixed(1)}ms  <span class="${cls(p95, 20, 33)}">p95 ${p95.toFixed(1)}ms</span>
` +
    `RTT      ${net.rtt}ms   스냅 수신 ${snapHz}/s (목표 ${P.net.rate})
` +
    `채널     ${net.fastOpen ? '무순서 OK' : '<span class="warn">순서채널 폴백</span>'}  대기 ${Math.round(net.buffered/1024)}KB  <span class="${net.dropped ? 'warn' : ''}">버림 ${net.dropped}</span>  재접속 ${net.retries}
` +
    `보간     ${(behind * 1000).toFixed(0)}ms 뒤 (설정 ${(P.net.interpDelay * 1000).toFixed(0)}ms)
` +
    `예측오차 <span class="${cls(err, 0.4, 1.2)}">${err.toFixed(2)}m</span> (스냅 임계 ${P.net.smoothMax}m)
` +
    `개체     적 ${enemies.length} · 일꾼 ${workers.length} · 방어병 ${guards.length} · 벽 ${obstacles.size}` +
    // 브로커 오류는 화면 어디에도 안 나와서 **조용히 방을 죽이고 있었다** (D98)
    (net.errs.length ? `
브로커   <span class="warn">${net.errs.join(' · ')}</span>` : '');
}

// ============================================================
// 미니맵 (D95) — 우측 하단
//  둘이 하려면 **상대가 어디 있는지**를 늘 알아야 한다. 미끼를 끌지 짓고 있을지,
//  구하러 갈 만한 거리인지가 전부 그 한 가지에 걸린다.
//  햄스터는 초상(모델을 한 번 렌더해 만든 원형 아이콘)으로, 나머지는 점으로 그린다.
// ============================================================
const miniEl = document.getElementById('mini');
const miniCtx = miniEl.getContext('2d');
const MINI_PAD = 10;                     // 아이콘이 테두리를 넘지 않게 두는 여백
const avatars = {};

// 햄스터 모델을 작은 오프스크린 렌더로 한 번 찍어 원형 초상으로 만든다.
// 색 원반보다 "누구인지"가 훨씬 빨리 읽힌다. 실패하면 색 원반으로 떨어진다.
function makeAvatar(vis, tint) {
  const S = 96;
  try {
    const rt = new THREE.WebGLRenderTarget(S, S);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const scn = new THREE.Scene();
    scn.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 3);
    scn.add(key);
    const clone = vis.group.clone(true);
    clone.position.set(0, 0, 0);
    clone.scale.setScalar(1);
    clone.rotation.set(0, Math.PI, 0);   // 얼굴이 카메라를 보게
    scn.add(clone);
    cam.position.set(0, 1.35, 3.1);
    cam.lookAt(0, 1.05, 0);
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scn, cam);
    const buf = new Uint8Array(S * S * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
    renderer.setRenderTarget(prevRT);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const img = c.createImageData(S, S);
    // WebGL은 아래에서 위로 읽히므로 뒤집는다
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const a = ((S - 1 - y) * S + x) * 4, b = (y * S + x) * 4;
        img.data[b] = buf[a]; img.data[b+1] = buf[a+1]; img.data[b+2] = buf[a+2]; img.data[b+3] = buf[a+3];
      }
    c.putImageData(img, 0, 0);
    return cv;
  } catch {
    return tint;   // 초상을 못 만들면 색으로
  }
}

function buildAvatars() {
  for (const q of players)
    if (!avatars[q.owner]) avatars[q.owner] = makeAvatar(q.vis, '#' + SLOT_FUR[q.slot].toString(16).padStart(6, '0'));
}

// 정적인 층(영토·벽·치즈더미)은 **바뀔 때만** 다시 그려 오프스크린에 캐시한다.
// 영토는 NAV*NAV(28,224칸)라 매 프레임 훑으면 안 된다.
const miniBg = document.createElement('canvas');
miniBg.width = miniBg.height = 168;
let miniGen = -1, miniWallN = -1, miniT = 0;

function miniProj() {
  const W = miniEl.width;
  const span = HALF * 2;
  const inner = W - MINI_PAD * 2;
  return {
    sx: (x) => MINI_PAD + ((x + HALF) / span) * inner,
    sz: (z) => MINI_PAD + ((z + HALF) / span) * inner,
    inner,
    clamp: (v) => Math.max(MINI_PAD * 0.5, Math.min(W - MINI_PAD * 0.5, v)),
  };
}

function drawMiniBg() {
  const { sx, sz, inner } = miniProj();
  const W = miniEl.width, H = miniEl.height;
  const g = miniBg.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#1b2130';
  g.fillRect(0, 0, W, H);
  // 내 영토 (초록) — 벽으로 만든 땅이 미니맵에서 제일 먼저 읽혀야 한다
  if (territory) {
    g.fillStyle = 'rgba(90, 200, 120, 0.20)';
    const cell = inner / NAV;
    for (let k = 0; k < NAV * NAV; k++) {
      if (!territory[k]) continue;
      const w = navToWorld(k);
      g.fillRect(sx(w.x) - cell / 2, sz(w.z) - cell / 2, cell + 0.6, cell + 0.6);
    }
  }
  // 벽 — 소유자 색 (누가 쌓았는지가 보여야 "저건 내가 지켜야 한다"가 읽힌다)
  for (const ob of obstacles.values()) {
    if (ob.bldgRef) continue;
    g.fillStyle = ob.bedrock ? '#4a4f5c' : ob.owner === 'a' ? '#7f93c8' : '#9fb0c6';
    const w = cellToWorld(ob.i, ob.j);
    g.fillRect(sx(w.x) - 1.2, sz(w.z) - 1.2, 2.4, 2.4);
  }
  // 치즈더미
  for (const n of nodes) {
    if (n.amount <= 0) continue;
    const w = cellToWorld(n.i, n.j);
    g.fillStyle = '#f0b429';
    g.beginPath(); g.arc(sx(w.x), sz(w.z), 2, 0, 7); g.fill();
  }
}

// **렌더 경로에서만** 부른다 (D95). tick 안에 두면 헤드리스 150초 런이
// 미니맵을 9,000번 다시 그리게 된다 — 실제로 그래서 회귀 하니스가 멈췄다.
function drawMini(dt) {
  const on = hudOn && started && alive;
  miniEl.classList.toggle('on', on);
  if (!on) return;
  miniT -= dt;
  if (miniT > 0) return;
  miniT = 1 / 12;                        // 12Hz면 충분하다
  const W = miniEl.width, H = miniEl.height;
  const g = miniCtx;
  const { sx, sz, clamp: clamp2 } = miniProj();
  // 정적 층은 세대가 바뀔 때만
  if (miniGen !== safeGen || miniWallN !== obstacles.size) {
    miniGen = safeGen; miniWallN = obstacles.size;
    drawMiniBg();
  }
  g.clearRect(0, 0, W, H);
  g.drawImage(miniBg, 0, 0);
  // 건물
  for (const b of buildings) {
    g.fillStyle = b.owner === 'a' ? '#5fa8ff' : '#5fd07a';
    g.fillRect(sx(b.cx) - 2.5, sz(b.cz) - 2.5, 5, 5);
  }
  // 적
  g.fillStyle = '#e0483c';
  for (const e of enemies) {
    g.beginPath(); g.arc(clamp2(sx(e.x)), clamp2(sz(e.z)), e.type === 'boss' ? 4 : 2.4, 0, 7); g.fill();
  }
  // 햄스터 — 초상. 맵 밖으로 나가도 테두리에 걸쳐 보이게 clamp 한다
  buildAvatars();
  const me = localPlayer();
  for (const q of players) {
    if (!q.active) continue;
    const art = avatars[q.owner];
    const R = q === me ? 11 : 9;
    const cx = clamp2(sx(q.x)), cy = clamp2(sz(q.z));
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.closePath();
    if (typeof art === 'string') { g.fillStyle = art; g.fill(); }
    else { g.clip(); g.drawImage(art, cx - R, cy - R, R * 2, R * 2); }
    g.restore();
    // 테두리 — 나는 흰색, 동료는 파랑. 기절/소멸 카운트다운 중이면 빨갛게 깜빡인다
    const urgent = q.stunned || q.wipeT > 0;
    g.lineWidth = urgent ? 3 : 2;
    g.strokeStyle = urgent
      ? (Math.sin(performance.now() * 0.012) > 0 ? '#ff4d4d' : '#ffb347')
      : (q === me ? '#ffffff' : '#8fd6ff');
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  }
  g.strokeStyle = '#3a4054';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// 상대에게 넘길 초기 상태. 벽은 이벤트가 아니라 여기서 통째로 간다 (~300칸)
function fullSnapshot() {
  const walls = [];
  for (const ob of obstacles.values())
    if (!ob.bedrock && !ob.bldgRef) walls.push([ob.i, ob.j, ob.owner, ob.cracks || 0]);
  return {
    settings: snapshotSettings(),
    map: mapIndex,
    stage, stageT, survival,
    walls,
    buildings: buildings.map((b) => ({ id: b.id, kind: b.kind, i: b.i, j: b.j, owner: b.owner,
                                       hp: b.hp, tier: b.tier, underBuild: b.underBuild })),
    nodes: nodes.map((n) => n.amount),
  };
}

// 접속 직후 클라가 호스트의 세계를 통째로 받는다.
// **설정 동기화는 공짜다** — snapshotSettings/applySettings를 그대로 재사용한다 (D92-5단계).
function applyFull(f, msg) {
  if (!f) return;
  // 호스트가 알려 준 내 슬롯 (D97). 이걸 받기 전에는 내가 몇 번인지 모른다
  if (msg && msg.you !== undefined) net.slot = msg.you;
  if (msg && msg.max !== undefined) net.maxPlayers = msg.max;
  // 맵이 다르면 통째로 다시 만든다 (setMap의 호스트 가드는 여기선 지나가야 하므로 rebuild 직접)
  if (f.map !== undefined && f.map !== mapIndex) { rebuildWorld(f.map); restart(); }
  else restart();
  if (f.settings) applySettings(f.settings);
  stage = f.stage; stageT = f.stageT; survival = f.survival;
  if (f.nodes) f.nodes.forEach((amt, k) => { if (nodes[k]) nodes[k].amount = amt; });
  // **벽과 건물을 실제로 세운다** (D94). 예전엔 HELLO에 실어 보내 놓고 쓰지를 않았다.
  // 처음 붙을 때는 호스트도 방금 새 판을 연 참이라 티가 안 났지만, 끊겼다 다시 붙으면
  // 참가자만 지어 놓은 게 전부 사라진 세계를 보게 된다.
  wallEvMute++;
  for (const [i, j, owner, cracks] of f.walls || []) {
    const ob = addObstacle(i, j, false, false, owner);
    if (ob && cracks) { ob.cracks = cracks; applyCrackVisual(ob); }
  }
  wallEvMute--;
  for (const b of f.buildings || []) {
    const nb = placeBuildingLocal(b.kind, b.i, b.j, b.owner, b.id);
    nb.hp = b.hp;
    if (b.tier && b.tier !== nb.tier) { nb.tier = b.tier; applyBuildingTierVisual(nb); }
    if (!b.underBuild) finishBuild(nb);
  }
  markNavDirty();
  // 클라는 **자기 슬롯만** 예측한다. 나머지는 스냅샷이 채운다
  P.ally.radius = P.player.radius;
  for (const q of players) q.vis.group.scale.setScalar(radiusOf(q));
  const me = players[net.slot] || ally;
  for (const q of players) q.local = (q === me);
  me.active = true; me.ai = false;
  // 판이 이미 돌고 있으면 바로 들어간다. 아직이면 로비에서 기다린다 (3~4인)
  if (!started && (!msg || msg.started || net.maxPlayers === 2)) beginMatch(false);
  else if (!started) showStep('s-lobby');
  // 재시작 때도 같은 HELLO가 오므로 인사는 처음 한 번만 (안 그러면 매번 화면을 덮는다)
  if (!greeted) { greeted = true; flashMsg('연결됐다! 너는 회색 햄스터다', '#6ee07a'); }
}
let greeted = false;

// 슬롯을 켜고 끈다 (D97). 사람이 앉으면 active, 나가면 빈자리로 돌린다.
function seatPlayer(slot) {
  const q = players[slot];
  if (!q) return null;
  q.ai = false;
  q.active = true;
  q.stunned = false;
  q.local = (slot === net.slot);
  // ⚠ 솔로 균형을 위해 일부러 남겨 둔 두 비대칭을 접속 때만 덮어쓴다 (D92)
  P.ally.radius = P.player.radius;      // 안 맞추면 참가자 히트박스가 35% 크다
  for (const r of players) r.vis.group.scale.setScalar(radiusOf(r));
  if (!started) q.cheese = startResources();
  const sp = spawnSlotAt(slot);
  q.x = sp.x; q.z = sp.z;
  return q;
}

function unseatPlayer(slot) {
  const q = players[slot];
  if (!q || slot === 0) return;
  q.active = false;
  q.ai = true;
  q.local = false;
  q.vis.group.visible = false;
  // 나간 사람 것은 그대로 둔다 — 다시 들어오면 이어서 쓴다.
  // (판 중간에 나갔다고 그 사람 벽까지 무너뜨리면 남은 사람이 통째로 열린다)
}

const netHooks = {
  onStatus: renderNet,

  // ---- 호스트: 참가자 한 명이 들어왔다 ----
  onJoin(slot) {
    net.fakeLag = P.net.fakeLag;
    seatPlayer(slot);
    // 정원이 2인 방은 예전처럼 **붙는 순간 바로 시작**한다 (D93 그대로).
    // 3~4인 방은 다 모일 때까지 기다린다 — 호스트가 로비에서 시작을 누른다.
    const autoStart = net.maxPlayers === 2;
    if (!started && autoStart) beginMatch();
    // 새로 들어온 사람에게만 세계를 통째로 보낸다. 이미 있던 사람은 스냅샷으로 충분하다
    net.sendTo(slot, { k: 'HELLO', you: slot, max: net.maxPlayers, started, full: fullSnapshot() });
    if (started) flashMsg(`${players[slot].name}가 들어왔다`, '#6ee07a');
    renderNet();
    renderLobby();
  },

  // ---- 호스트: 참가자가 나갔다 ----
  onLeave(slot) {
    unseatPlayer(slot);
    if (started) flashMsg(`${players[slot].name}가 나갔다`, '#ffb347');
    renderNet();
    renderLobby();
  },

  // ---- 참가자: 호스트에 붙었다 (슬롯은 HELLO로 온다) ----
  onOpen() {
    net.fakeLag = P.net.fakeLag;
    renderNet();
  },

  // ---- 참가자: 호스트를 잃었다 (D98) ----
  // reason이 '나감'이면 내가 누른 것이라 화면은 부른 쪽이 이미 챙겼다.
  // 그 외에는 **호스트가 사라진 것**이다 — 판 한가운데서 조용히 0번 슬롯을
  // 넘겨받으면 남의 햄스터로 남의 판을 계속하게 된다. 말해 주고 처음으로 돌린다.
  onClose(reason) {
    greeted = false;
    for (const q of players) { q.local = q.slot === 0; if (q.slot) { q.active = false; q.ai = true; q.vis.group.visible = false; } }
    if (reason !== '나감' && started) {
      openStart('s-mode');
      flashMsg('호스트가 나갔다 — 방이 닫혔다', '#ff7a7a');
    }
    renderNet();
    renderLobby();
  },

  onMessage: (m, fromSlot) => onNetMessage(m, fromSlot),
};

function onNetMessage(m, fromSlot) {
  if (!m || !m.k) return;
  // 호스트로 오는 것은 **보낸 사람 슬롯**에 적용해야 한다 (D97).
  // 하나로 뭉뚱그리면 3인부터 입력이 뒤섞인다.
  const from = players[fromSlot] || ally;
  switch (m.k) {
    case 'HELLO':  applyFull(m.full, m); break;
    case 'IN':     from.in.mx = m.mx; from.in.mz = m.mz; break;
    case 'CMD':    applyCommand(from, m.c); break;
    case 'SNAP':   noteSnap(); applySnapshot(m); break;
    case 'MSG':    flashMsg(m.t, m.c); break;
    case 'SET':    applySettings(m.s); break;
    case 'BEGIN':  if (!started) beginMatch(); break;
  }
}

// ============================================================
// 스냅샷 (D92-6단계)
//  호스트만 시뮬을 돌린다. 클라는 이걸 받아 그리기만 한다.
//  · 연속 상태(위치·체력·자원)는 SNAP에 20Hz로
//  · 벽은 wallEvents로 (300칸을 매번 실을 수 없다)
//  · 건물은 12채뿐이라 그냥 SNAP에 통째로 (이벤트 종류를 늘릴 값이 없다)
//  숫자는 배열로 담는다 — 키 이름이 페이로드의 절반을 먹기 때문이다.
// ============================================================
const SNAP_TYPES = ['chaser', 'runner', 'bomber', 'boss'];
const SNAP_GUARDS = ['melee', 'archer', 'elite'];
const r2 = (v) => Math.round(v * 100) / 100;
const jobCode = (j) => (j === 'mine' ? 1 : j === 'drop' ? 2 : 0);
const jobName = (c) => (c === 1 ? 'mine' : c === 2 ? 'drop' : null);

// "내가 세계의 주인인가" — 솔로와 호스트는 true, 클라는 false.
// 스폰·재시작·스테이지 진행을 이걸로 막는다. 클라가 자기 멋대로 적을 만들면
// id가 충돌해서 **물리 버그처럼 보이는 증상**이 난다.
const netAuthoring = () => net.role !== 'client';

// ---- 인원수 배수 (D95) ----
// 사람이 둘이면 적도 늘어야 한다. 안 그러면 표적만 둘로 갈려서 **2인이 1인보다 쉽다** —
// D91의 어그로 회전이 압박을 정확히 반으로 나눠 주기 때문이다.
// 적 수를 정하는 곳이 셋(시작 마릿수·스테이지 표·웨이브 보충)이라 배수를 한 군데로 모았다.
const humanCount = () => humans().length;
// 인원수에 **선형으로** 붙인다 (D97). 2인 1.8배 → 3인 2.6 → 4인 3.4.
// 곱으로 하면(1.8^3 = 5.8) 4인에서 감당이 안 되고, 어그로가 갈리는 만큼만 채우면 되므로
// "한 명 늘 때마다 0.8배씩"이 실제 압박에 가깝다.
const coopScale = () => 1 + Math.max(0, humanCount() - 1) * (P.coop.enemyScale - 1);
const scaled = (n) => Math.round(n * coopScale());

// 호스트가 튜닝 패널을 열고 있는 동안은 P를 계속 흘려 보낸다 (D92-6단계).
// 슬라이더를 만지는 그 순간부터 두 사람이 다른 규칙으로 보게 되므로,
// 열려 있을 때만 0.5초마다 통째로 덮어쓴다. 닫혀 있으면 한 바이트도 안 나간다.
let setT = 0;
function sendSettings(dt) {
  if (net.role !== 'host' || !net.connected || !guiOpen) return;
  setT -= dt;
  if (setT > 0) return;
  setT = 0.5;
  net.send({ k: 'SET', s: snapshotSettings() });
}

let snapT = 0;
function sendSnapshot(dt) {
  if (net.role !== 'host' || !net.connected) return;
  snapT -= dt;
  if (snapT > 0) return;
  snapT = 1 / Math.max(P.net.rate, 1);
  const msg = {
    k: 'SNAP',
    t: r2(survival), st: stage, sT: r2(stageT), al: alive ? 1 : 0, ki: killCount,
    tr: Math.round(territoryArea), vi: victory ? 1 : 0,
    act: players.map((p) => (p.active ? 1 : 0)),
    ps: players.map((p) => [r2(p.x), r2(p.z), r2(p.faceX), r2(p.faceZ), Math.round(p.hp),
                            p.stunned ? 1 : 0, r2(p.rollT), r2(p.rollSpin), r2(p.cheese),
                            p.parts, Math.round(p.stamina), r2(p.carry || 0),
                            r2(p.mineT || 0), jobCode(p.job), r2(p.harvestPulse),
                            p.wallCast ? r2(p.wallCast.t) : -1,
                            p.buildJob ? r2(p.buildJob.t / p.buildJob.dur) : -1,
                            p.upgradeJob ? r2(p.upgradeJob.t / p.upgradeJob.dur) : -1,
                            p.wallOrders.length, p.buildOrder ? 1 : 0, p.mineOrder ? 1 : 0,
                            r2(p.wipeT || 0), r2(p.tauntT || 0)]),
    en: enemies.map((e) => [e.id, r2(e.x), r2(e.z), r2(e.dirX), r2(e.dirZ), Math.round(e.hp),
                            SNAP_TYPES.indexOf(e.type), e.windupPull ? r2(e.windupPull) : 0,
                            e.isAttacking ? 1 : 0]),
    wk: workers.map((w) => [w.id, r2(w.x), r2(w.z), r2(w.faceX), r2(w.faceZ),
                            w.owner === 'a' ? 1 : 0, jobCode(w.job), r2(w.mineT || 0)]),
    gu: guards.map((g) => [g.id, r2(g.x), r2(g.z), r2(g.faceX), r2(g.faceZ), Math.round(g.hp),
                           g.owner === 'a' ? 1 : 0, SNAP_GUARDS.indexOf(g.type), r2(g.swing || 0)]),
    bl: buildings.map((b) => [b.id, b.kind, b.i, b.j, b.owner, Math.round(b.hp), b.tier || 1,
                              b.underBuild ? 1 : 0, Math.round(b.store || 0),
                              b.underBuild && b.selfDur ? r2(b.selfT / b.selfDur) : -1]),
    pu: pickups.map((u) => [u.id, r2(u.x), r2(u.z), u.kind === 'parts' ? 1 : 0]),
    nd: nodes.map((n) => Math.round(n.amount)),
    ev: wallEvents,
  };
  wallEvents = [];
  net.send(msg, true);   // 무순서 채널 — 늦은 스냅샷이 뒤를 막지 않게 (D94)
}

// ---- 원격 개체 보간 (D93) ----
// 예전엔 "마지막으로 받은 위치로 지수 감쇠로 당기기"였는데, 그건 **항상 뒤처진다.**
// 목표가 스냅샷 시점의 위치라 상대가 계속 움직이는 동안 절대 따라잡지 못하고,
// 스냅이 올 때마다 훅 당겨진다 — 그게 "렉이 심하다"로 보인다.
//
// 대신 **스냅샷 두 장 사이를 시간으로 보간**한다. 화면은 호스트보다 interpDelay만큼
// 과거를 그리지만, 속도가 맞아서 부드럽다. 표준적인 맞바꿈이다.
//   b0/b1 = 직전/최신 스냅샷의 (시각, 위치). renderT = 지금 그리는 호스트 시각.
// 표본은 **여러 장 쌓아 둔다.** 두 장만 들고 있으면 커버할 수 있는 시간이 스냅 간격
// 하나뿐이라, interpDelay가 그보다 크면 렌더 시각이 항상 가장 오래된 표본보다 앞서서
// 보간 계수가 0에 붙는다 — 개체가 멈춰 있다가 스냅마다 뚝 뛴다. 실측으로 잡은 버그다
// (119프레임 중 89프레임이 정지, 흔들림 1.79).
const BUF_MAX = 12;
function pushSample(o, t, x, z, fx, fz) {
  if (!o.buf) o.buf = [];
  const last = o.buf[o.buf.length - 1];
  if (last && last.t >= t) return;         // 순서가 뒤집힌 스냅은 버린다
  o.buf.push({ t, x, z, fx, fz });
  if (o.buf.length > BUF_MAX) o.buf.shift();
}

let renderT = 0, lastSnapT = -1;

// 실제로 쓸 지연. 설정값이 스냅 간격보다 너무 작으면 버퍼가 비어 끊기므로
// **최소 1.5 스냅 간격**은 확보한다 (rate를 낮게 돌려도 안 깨지게).
const effInterpDelay = () => Math.max(P.net.interpDelay, 1.5 / Math.max(P.net.rate, 1));

function interpEntity(o) {
  const b = o.buf;
  if (!b || !b.length) return;
  const newest = b[b.length - 1];
  let nx, nz, fx, fz;
  if (renderT >= newest.t) {
    // 표본이 아직 안 왔다 — 지어내지 않고 최신 표본에 머문다
    // (외삽하면 벽을 뚫고 미끄러지는 그림이 나온다)
    nx = newest.x; nz = newest.z; fx = newest.fx; fz = newest.fz;
  } else {
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > renderT) i--;
    const s0 = b[Math.max(i - 1, 0)], s1 = b[i];
    const span = s1.t - s0.t;
    const a = span > 1e-6 ? Math.max(0, Math.min(1, (renderT - s0.t) / span)) : 1;
    nx = s0.x + (s1.x - s0.x) * a;
    nz = s0.z + (s1.z - s0.z) * a;
    if (s1.fx !== undefined && s0.fx !== undefined) {
      fx = s0.fx + (s1.fx - s0.fx) * a;
      fz = s0.fz + (s1.fz - s0.fz) * a;
    }
    // 오래된 표본은 버린다
    if (i > 1) b.splice(0, i - 1);
  }
  // 잡힘·구출처럼 순간이동에 가까운 사건은 보간하면 맵을 가로질러 미끄러진다 — 즉시 스냅
  if (Math.hypot(nx - o.x, nz - o.z) > P.net.smoothMax) { o.x = newest.x; o.z = newest.z; o.buf = [newest]; }
  else { o.x = nx; o.z = nz; }
  if (fx !== undefined) {
    const l = Math.hypot(fx, fz);
    if (l > 1e-4) { o.faceX = fx / l; o.faceZ = fz / l; }
  }
}

// 렌더 시계 — dt로 흐르되 "최신 스냅 − 지연"을 향해 살살 맞춘다.
// 너무 벌어지면(탭이 잠들었다 깨는 등) 그냥 점프한다.
function advanceRenderClock(dt) {
  if (lastSnapT < 0) return;
  renderT += dt;
  const target = lastSnapT - effInterpDelay();
  if (Math.abs(target - renderT) > 0.5) renderT = target;
  else renderT += (target - renderT) * (1 - Math.exp(-4 * dt));
}

// 내 몸은 예측하므로 보간이 아니라 **오차 보정**이다 (D92 예측 규칙)
function pullTo(o, x, z, dt, rate = 12) {
  const d = Math.hypot(x - o.x, z - o.z);
  if (d > P.net.smoothMax) { o.x = x; o.z = z; return; }
  const k = 1 - Math.exp(-rate * dt);
  o.x += (x - o.x) * k;
  o.z += (z - o.z) * k;
}

let lastSnap = null;
let overlayWasVictory = false;
function applySnapshot(m) {
  lastSnap = m;
  if (lastSnapT < 0) renderT = m.t - effInterpDelay();   // 첫 스냅에서 시계를 맞춘다
  lastSnapT = m.t;
  survival = m.t; stage = m.st; stageT = m.sT; killCount = m.ki;
  territoryArea = m.tr; victory = !!m.vi;
  // 게임의 끝은 호스트가 정한다. 클라는 오버레이 문구만 맞춰 준다
  const won = !!m.vi;
  if (!!m.al !== alive || won !== overlayWasVictory) {
    alive = !!m.al;
    overlayWasVictory = won;
    const done = won || !alive;
    overlayEl.classList.toggle('hidden', !done);
    if (done) {
      overlayEl.querySelector('h1').textContent = won ? '톰을 막아냈다!' : '모두 잡혔다!';
      document.getElementById('overlay-sub').textContent = won
        ? `${MAPS[mapIndex].name} · ${survival.toFixed(0)}초 — R 키로 처음부터`
        : `스테이지 ${stage} · ${survival.toFixed(0)}초 생존 — R 키로 다시 시작`;
    }
  }

  // ---- 플레이어 둘 ----
  // 누가 앉아 있는지도 호스트가 정한다 (D97)
  if (m.act) m.act.forEach((on, k) => {
    if (!players[k]) return;
    players[k].active = !!on;
    if (!on) players[k].vis.group.visible = false;
  });
  m.ps.forEach((a, k) => {
    const p = players[k];
    if (!p || !p.active) return;
    p.netX = a[0]; p.netZ = a[1];
    if (!p.local) pushSample(p, m.t, a[0], a[1], a[2], a[3]);
    else { p.faceX = a[2]; p.faceZ = a[3]; }
    p.hp = a[4]; p.stunned = !!a[5];
    p.rollSpin = a[7];
    p.cheese = a[8]; p.parts = a[9]; p.stamina = a[10];
    p.carry = a[11]; p.mineT = a[12]; p.job = jobName(a[13]); p.harvestPulse = a[14];
    // 진행 바를 그리기 위한 최소한의 가짜 작업 상태 (클라는 시뮬을 안 돌린다)
    p.wallCast = a[15] >= 0 ? { i: 0, j: 0, t: a[15] } : null;
    p.buildJob = a[16] >= 0 ? { b: null, t: a[16], dur: 1 } : null;
    p.upgradeJob = a[17] >= 0 ? { b: null, t: a[17], dur: 1 } : null;
    p.wallOrderCount = a[18]; p.hasBuildOrder = !!a[19];
    p.mineOrder = a[20] ? (p.mineOrder || { pile: null }) : null;
    p.wipeT = a[21] || 0;
    if (!p.local) p.tauntT = a[22] || 0;
    // **내 몸은 예측한다** — rollT는 내가 굴린 걸 내가 안다 (D92 예측 규칙)
    if (!p.local) p.rollT = a[6];   // 위치는 보간이 맡는다
  });

  // ---- 적 ----
  syncList(enemies, m.en, (a) => {
    const e = makeEnemy(SNAP_TYPES[a[6]], enemies.length);
    e.id = a[0];
    e.x = a[1]; e.z = a[2];        // 보간 첫 프레임에 스폰 지점에서 미끄러져 오지 않게
    enemies.push(e);
    return e;
  }, (e, a) => {
    pushSample(e, m.t, a[1], a[2]);
    e.dirX = a[3]; e.dirZ = a[4];
    e.hp = a[5]; e.windupPull = a[7]; e.isAttacking = !!a[8];
  }, (e) => {
    scene.remove(e.vis.group); disposeBar(e.bar);
    if (e.homeRing) { scene.remove(e.homeRing); e.homeRing.material.dispose(); }
  });

  syncList(workers, m.wk, (a) => newWorker(a[5] ? 'a' : 'p', a[0], a[1], a[2]),
    (w, a) => { pushSample(w, m.t, a[1], a[2], a[3], a[4]);
                w.job = jobName(a[6]); w.mineT = a[7]; },
    (w) => disposeWorker(w));

  syncList(guards, m.gu, (a) => newGuard(SNAP_GUARDS[a[7]], a[6] ? 'a' : 'p', a[0], a[1], a[2]),
    (g, a) => { pushSample(g, m.t, a[1], a[2], a[3], a[4]);
                g.hp = a[5]; g.swing = a[8]; },
    (g) => { scene.remove(g.vis.group); scene.remove(g.ring); g.ring.material.dispose();
             if (g.bar) disposeBar(g.bar); selectedUnits.delete(g); });

  syncList(buildings, m.bl, (a) => placeBuildingLocal(a[1], a[2], a[3], a[4], a[0]),
    (b, a) => {
      b.hp = a[5];
      if (b.tier !== a[6]) { b.tier = a[6]; applyBuildingTierVisual(b); }
      const wasUnder = b.underBuild;
      b.underBuild = !!a[7];
      b.store = a[8];
      if (a[9] >= 0) b.mesh.scale.y = 0.25 + 0.75 * a[9];
      if (wasUnder && !b.underBuild) finishBuild(b);
    },
    (b) => destroyBuilding(b, false));

  syncList(pickups, m.pu, (a) => spawnPickupLocal(a[3] ? 'parts' : 'cheese', a[1], a[2], a[0]),
    (u, a) => { u.x = a[1]; u.z = a[2]; },
    (u) => { scene.remove(u.mesh); u.mesh.material.dispose(); });

  m.nd.forEach((amt, k) => { if (nodes[k]) nodes[k].amount = amt; });

  // ---- 벽 이벤트 ----
  for (const e of m.ev || []) {
    const ob = obstacles.get(cellKey(e.i, e.j));
    if (e.a === 1) {
      if (!ob) {
        wallEvMute++;
        const nw = addObstacle(e.i, e.j, false, false, e.o);
        wallEvMute--;
        if (nw) { nw.mesh.scale.y = 0.02; nw.mesh.position.y = 0.01; popping.push({ ob: nw, t: 0 }); }
      }
    } else if (e.a === 0) {
      if (ob) { wallEvMute++; removeObstacle(ob); wallEvMute--; }
    } else if (e.a === 2 && ob) {
      ob.cracks = e.c;
      applyCrackVisual(ob);
    } else if (e.a === 4) {
      // 경비탑·사수가 던졌다 (D101) — **그림만** 그린다.
      // dmg 0이라 맞아도 아무 일이 없다. 피해는 호스트가 이미 계산했고
      // 그 결과는 스냅샷의 체력으로 온다.
      const tgt = enemies.find((q) => q.id === e.e);
      if (tgt) {
        lobProjectile(e.x, e.y, e.z, tgt, 0, e.s, e.o);
        // 던진 포탑의 머리를 목표 쪽으로 돌려 준다 — 안 돌면 여전히 죽어 보인다
        let best = null, bd = 2.6;
        for (const b of buildings) {
          if (b.kind !== 'tower') continue;
          const d = Math.hypot(b.cx - e.x, b.cz - e.z);
          if (d < bd) { bd = d; best = b; }
        }
        const head = best && best.mesh.userData.head;
        if (head) head.rotation.y = Math.atan2(tgt.x - best.cx, tgt.z - best.cz) + Math.PI;
      }
    } else if (e.a === 3) {
      // 소유자 하나의 벽을 통째로 (잡힘 소멸)
      wallEvMute++;
      for (const w of [...obstacles.values()])
        if (!w.bedrock && !w.bldgRef && w.owner === e.o) removeObstacle(w);
      wallEvMute--;
      markNavDirty();
    }
  }
}

// 스냅샷의 배열과 로컬 목록을 id로 맞춘다 (없으면 만들고, 남으면 지운다)
function syncList(list, rows, make, apply, dispose) {
  const seen = new Set();
  for (const a of rows) {
    seen.add(a[0]);
    let o = list.find((x) => x.id === a[0]);
    if (!o) { o = make(a); if (!o) continue; }
    apply(o, a);
  }
  for (let k = list.length - 1; k >= 0; k--) {
    if (seen.has(list[k].id)) continue;
    dispose(list[k]);
    list.splice(k, 1);
  }
}

// ---- 시작 화면 버튼 (D93) ----
const $ = (id) => document.getElementById(id);

$('s-solo').onclick = () => {
  net.leave();
  player.local = true; ally.local = false; ally.ai = true;
  beginMatch();
};
// 2인 / 3~4인 모두 같은 흐름을 쓴다. 다른 건 정원(maxPlayers) 하나뿐이다 (D97)
let wantSeats = 2;
$('s-two').onclick = () => { wantSeats = 2; showStep('s-two-menu'); };
$('s-four').onclick = () => showStep('s-size');
$('s-size3').onclick = () => { wantSeats = 3; showStep('s-two-menu'); };
$('s-size4').onclick = () => { wantSeats = 4; showStep('s-two-menu'); };
$('s-back4').onclick = () => showStep('s-mode');
$('s-back1').onclick = () => showStep('s-mode');
$('s-back5').onclick = () => { net.leave(); openStart('s-mode'); renderNet(); };

$('s-create').onclick = () => {
  showStep('s-hosting');
  $('s-code').textContent = '······';
  net.host(wantSeats, netHooks);
  renderNet();
  renderLobby();
};
// 3~4인 방은 방장이 눌러야 시작한다 — 다 안 모여도 지금 시작할 수 있다
$('s-begin').onclick = () => {
  if (net.role !== 'host' || started) return;
  beginMatch();
  net.send({ k: 'BEGIN' });
  for (const l of net.slots()) if (l) net.sendTo(l, { k: 'HELLO', you: l, max: net.maxPlayers, started: true, full: fullSnapshot() });
};
$('s-back2').onclick = () => { net.leave(); showStep('s-two-menu'); renderNet(); };

$('s-joinform').onclick = () => { showStep('s-joining'); $('s-code-in').focus(); };
$('s-back3').onclick = () => { net.leave(); showStep('s-two-menu'); renderNet(); };

function doJoin() {
  const code = $('s-code-in').value.trim();
  if (code.length < 4) { net.status = '여섯 글자 코드를 입력하세요'; renderNet(); return; }
  // 내 슬롯은 호스트가 HELLO로 알려 준다 (D97) — 그전까지는 아무것도 정하지 않는다
  net.join(code, netHooks);
  renderNet();
}
$('s-connect').onclick = doJoin;
$('s-code-in').addEventListener('keydown', (e) => {
  e.stopPropagation();                       // 게임 단축키가 코드 입력을 먹지 않게
  if (e.code === 'Enter' || e.code === 'NumpadEnter') doJoin();
});

// ---- ESC 메뉴의 멀티 항목 ----
$('m-invite').onclick = () => { setMenu(false); net.leave(); openStart('s-two-menu'); renderNet(); };
$('m-leave').onclick = () => {
  net.leave();
  player.local = true; ally.local = false; ally.ai = true;
  setMenu(false);
  renderNet();
};

//  경제 활동 없음. 우선순위:
//   1. 내가 기절 → 구조 (카이팅으로 틈을 만든 뒤 접근)
//   2. 적이 가까움 → 도망 (회피 조향)
//   3. 그 외 → 자기 은신처를 벽으로 만든다
//  은신처는 3x3 링에서 한 칸을 비운 형태 — 1칸 틈이라 고양이는 못 들어오고
//  햄스터만 드나든다. 코어 규칙을 AI가 스스로 이용하는 모습이 보인다.

// ---- 동료 슬롯 (D95에서 AI를 걷어냄) ----
// D21이 AI 동료를 만들 때 스스로 "멀티 전 단계의 실험 장치"라고 적어 뒀다.
// 2P가 붙었으므로 대역은 역할을 다했다. 은신처 짓기·구조 판단·도망 AI 220줄을 걷어낸다.
// **ally 객체는 남는다** — 사람이 앉는 자리다. 아무도 없으면 그냥 비어 있다.
// 그래서 솔로는 이제 진짜 혼자다: 구해 줄 사람이 없다 (D7의 사회성은 2P의 것이 된다).

// 무리 구성을 "순찰묘 3 · 날쌘묘 1" 식으로 요약
function enemyModeSummary() {
  const c = {};
  for (const e of enemies) c[e.type] = (c[e.type] || 0) + 1;
  const bits = Object.entries(c).map(([k, v]) => `${TYPE_INFO[k].label} ${v}`);
  const atk = enemies.filter((e) => e.isAttacking).length;
  const prowl = enemies.filter((e) => e.aiMode === '배회').length;
  const patrol = enemies.filter((e) => e.patrol).length;
  const onHunt = enemies.filter((e) => e.patrol && e.aggroT > 0).length;
  return bits.join(' · ')
    + (patrol ? ` · 순찰 ${patrol}${onHunt ? `(${onHunt}마리 추격 중)` : ''}` : '')
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
  // ---- 좌상단 — 지금 벌어지는 일만 (D88) ----
  // 예전엔 8줄에 모든 걸 쏟아부어서 아무것도 안 읽혔다. 자원은 우상단으로,
  // 조작 설명은 H로 옮기고, 여기는 **상태**만 남긴다:
  //  스테이지 / 적 / 체력·기운 / 영토 / 지금 하는 일.
  const bar = (v, max, on, off) => {
    const n = Math.max(0, Math.min(10, Math.round((v / max) * 10)));
    return on.repeat(n) + off.repeat(10 - n);
  };
  // "지금 하는 일" — 하나만 뜬다. 여러 개가 동시에 참인 경우는 없다
  // 클라에서는 job 객체가 스냅샷이 만든 **진행도만 든 껍데기**라 b가 없다 —
  // 라벨은 있으면 쓰고 없으면 생략한다
  const me = localPlayer();
  const mates = others(me);
  const lbl = (j) => (j && j.b ? BLDG_INFO[j.b.kind].label + ' ' : '');
  const nWall = me.wallOrders.length || me.wallOrderCount || 0;
  const doing =
    me.buildJob ? `🏗 ${lbl(me.buildJob)}건설 ${Math.round(me.buildJob.t / me.buildJob.dur * 100)}% — 움직일 수 없다 (ESC)`
    : me.upgradeJob ? `⬆ ${lbl(me.upgradeJob)}업그레이드 중 — 움직일 수 없다 (ESC)`
    : (me.buildOrder || me.hasBuildOrder) ? `🏗 ${me.buildOrder ? BLDG_INFO[me.buildOrder.kind].label + ' ' : ''}지으러 가는 중`
    : nWall ? `🧱 벽 명령 ${nWall}개${me.wallCast ? ' (세우는 중)' : ''}`
    : me.mineOrder ? '🔁 자동 채굴 중 (움직이면 취소)'
    : me.job === 'mine' ? '⛏ 채굴'
    : me.job === 'drop' ? '📦 하역'
    : removeMode ? '✖ 철거 모드 (X로 끄기)'
    // 유닛 슬롯을 들고 있으면 **무엇을 눌러야 하는지** 말해 준다 (D91).
    // 숫자만 눌러 놓고 다음 동작을 모르겠다는 지적이 있었다
    : isUnitSlot(heldSlot())
      ? `👉 ${heldSlot().label} — 좌클릭 또는 Enter로 생산 (${heldSlot().cost()}🧀)`
    : '';
  const warn = (removeMode || buildSlot >= 0) && !ghostCell.valid && ghostWhy ? `⚠ ${ghostWhy}` : '';

  hudEl.textContent =
    `[스테이지 ${stage}/${STAGES.length}]` +
    (victory ? ' 돌파!' : ` 다음 웨이브 ${Math.max(stageDur() - stageT, 0).toFixed(0)}s`) +
    (waiting ? '' : ` · 위협 Lv.${lvl}`) + '\n' +
    (waiting
      ? `적 등장까지 ${(P.enemy.spawnDelay - survival).toFixed(1)}s — 지금 광맥을 확보하세요\n`
      : `적 ${enemies.length}마리${attacking ? ` · ${attacking}마리 공격 중!` : ''}\n`) +
    `체력 ${bar(me.hp, P.player.hp, '█', '░')} ${Math.ceil(me.hp)}\n` +
    `기운 ${bar(me.stamina, P.player.stamMax, '▰', '▱')} ${Math.ceil(me.stamina)}` +
    (inTerritory(me.x, me.z) ? '  🌿내 땅' : '') + '\n' +
    // 영토 (D86) — 벽으로 감싸 고양이가 못 오게 만든 땅의 넓이
    `영토 ${territoryArea.toFixed(0)}㎡` +
    (wallCount ? ` · 벽 ${wallCount}개` : '') +
    (territoryArea > 0 && P.res.terrIncome > 0
      ? ` · +${(territoryArea * P.res.terrIncome).toFixed(1)}/s` : '') + '\n' +
    `공방 ${maxWorkshopTier() > 0 ? `Lv.${maxWorkshopTier()}` : '없음(4)'}` +
    ` · 일꾼 ${workers.filter((w) => w.owner === me.owner).length}` +
    ` · 방어병 ${guardsOf(me.owner).length}` +
    ` · 볼주머니 ${me.carry ? me.carry.toFixed(0) : 0}/${P.carry.playerLoad}` +
    (selectedUnits.size ? ` · 선택 ${selectedUnits.size}` : '') + '\n' +
    (doing ? doing + '\n' : '') +
    // 협동 — 지금 내가 몇 마리를 끌고 있는가 (미끼가 기여라는 걸 숫자로 보여준다, D96)
    (mates.length ? (() => {
      const on = enemies.filter((e) => e.chaseTarget === me).length;
      const rest = mates.map((q) => `${q.name} ${enemies.filter((e) => e.chaseTarget === q).length}`).join(' · ');
      const cd = me.tauntCd > 0 ? ` · 도발 ${Math.ceil(me.tauntCd)}s` : ' · 0 도발';
      return `🐈 나 ${on} / ${rest}${cd}\n`;
    })() : '') +
    // 옆에 붙었으면 건넬 수 있다
    (!me.stunned && nearestMate(me, P.coop.giveRange)
      ? `🤝 ${nearestMate(me, P.coop.giveRange).name}에게 — Q 치즈 ${P.coop.giveCheese} · Z 부품 ${P.coop.giveParts}\n` : '') +
    (warn ? warn + '\n' : '') +
    // 누운 사람이 여럿일 수 있다 (D97) — 가장 급한 사람부터 보여준다
    (() => {
      const down = mates.filter((q) => q.stunned).sort((a, b) => (a.wipeT || 99) - (b.wipeT || 99));
      if (!down.length) return '';
      const d = down[0];
      const more = down.length > 1 ? ` (외 ${down.length - 1}명)` : '';
      return d.wipeT > 0
        ? `🆘 ${d.name} 기절 — ${Math.ceil(d.wipeT)}초 뒤 기지가 무너진다!${more}\n`
        : `${d.name} 기절 — 구하러 가자!${more}\n`;
    })() +
    (me.stunned ? (me.wipeT > 0 ? `🆘 잡혔다 — ${Math.ceil(me.wipeT)}초 뒤 내 것이 전부 무너진다\n`
                                : '나: 기절!\n') : '') +
    (paused ? '⏸ 일시정지 (P)' : '');
  updateRes();
  renderUpgrade();   // 공방 근처 여부가 걸음마다 바뀌므로 여기서 같이 갱신 (D88)
}

// ============================================================
// 초기화 & 루프
// ============================================================
// 체력/작업 바 (makeBar 정의 이후에 만들어야 한다). 슬롯마다 한 벌씩 (D97)
for (const q of players) {
  q.bar = makeBar(0x5fd07a, q.slot === 0 ? 1.1 : 1.0);
  q.workBar = makeBar(0xf0c040, q.slot === 0 ? 1.1 : 1.0);
  measureTop(q.vis);
}

rebuildWorld(mapIndex);      // 지형·광맥·바닥·스폰 생성 + clearance
restart();                   // 동료·스테이지·업그레이드까지 초기 상태로
updateHotbar();
openStart();                 // **판은 아직 시작하지 않는다** — 몇 명이 할지부터 고른다 (D93)

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  persp.aspect = viewAspect();
  persp.updateProjectionMatrix();
});

// ============================================================
// 클라이언트 프레임 (D92-6단계)
//  **시뮬을 한 줄도 돌리지 않는다.** 자기 몸만 예측하고, 나머지는 스냅샷을 따라간다.
//  그래서 고정 timestep도, 락스텝도, 롤백도 필요가 없다 — 클라는 표시 단말이다.
// ============================================================
function tickClient(dt) {
  const me = localPlayer();
  sampleLocalInput(me);
  sendInput(me, dt);

  if (!paused && alive && started && !me.stunned) {
    // 자기 위치와 구르기만 예측한다. 명령·소비·체력은 예측하지 않는다 —
    // 이중 지불 고무줄이 80ms 지연보다 훨씬 나쁘다 (D92 예측 규칙)
    if (me.rollT > 0) {
      me.rollT -= dt;
      me.rollSpin += dt * 22;
      const spd = P.player.rollDist / Math.max(P.player.rollTime, 0.01);
      me.x += me.rollX * spd * dt;
      me.z += me.rollZ * spd * dt;
      collideWithObstacles(me, radiusOf(me));
    } else if (me.tauntT > 0) {
      me.tauntT -= dt;                   // 발이 묶인다 (호스트와 같은 규칙)
    } else if (me.in.mx || me.in.mz) {
      me.x += me.in.mx * effPlayerSpeed(me) * dt;
      me.z += me.in.mz * effPlayerSpeed(me) * dt;
      me.faceX = me.in.mx; me.faceZ = me.in.mz;
      collideWithObstacles(me, radiusOf(me));
    }
    if (me.rollCd > 0) me.rollCd -= dt;
    if (me.tauntCd > 0) me.tauntCd -= dt;
    // 호스트가 준 위치로 조용히 당겨 온다 (틀렸으면 여기서 새어 나온다)
    if (me.netX !== undefined) pullTo(me, me.netX, me.netZ, dt, 12);
  } else if (me.netX !== undefined) {
    // 기절·게임오버 중에는 **예측하지 않는다.** 예전엔 보정도 같이 건너뛰어서,
    // 잡혀 끌려간 P2가 자기 화면에서는 원래 자리에 남아 있었다 —
    // 구하러 오는 쪽이 엉뚱한 곳을 보게 되는 종류의 버그다.
    me.x = me.netX; me.z = me.netZ;
  }

  // 원격 개체 — 스냅샷 두 장 사이를 시간으로 보간한다 (D93)
  advanceRenderClock(dt);
  for (const list of [enemies, workers, guards]) for (const o of list) interpEntity(o);
  for (const q of players) if (!q.local) interpEntity(q);

  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flashEl.style.opacity = '0'; }
  flushNavDirty();   // 스냅샷이 벽을 바꿨으면 영토·은신처 계산도 따라가야 한다
  updateProjectiles(dt);   // 호스트가 알려 준 투척을 날려 준다 (D101)
  presentWorld(dt);
  for (const q of players) if (q.active) updateActorVis(q, dt);
  for (const q of players) q.vis.group.visible = q.active;
  updateLocalUI(dt);
  updateCheeseBits(dt);
  updateWallPops(dt);
  refreshTerritory();
  paintTerritory();
  updateFx(dt);
  updateCamera(dt);
  noteFrame();
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; updateHUD(); updateHotbar(); renderNet(); renderNetDev(); }
}

// 시뮬이 아니라 **그리기만** 하는 부분 — 클라에서 적·유닛·건물의 모델을 제자리에 놓는다.
// 호스트에서는 각 update* 함수가 이 일을 겸하고 있어서 따로 부르지 않는다.
function presentWorld(dt) {
  for (const e of enemies) {
    e.vis.setOpacity(enemyActive() ? 1 : 0.5);
    const pull = e.windupPull || 0;
    e.vis.group.position.set(e.x - e.dirX * pull * 0.55, 0, e.z - e.dirZ * pull * 0.55);
    e.vis.group.rotation.y = Math.atan2(e.dirX, e.dirZ) + Math.PI;
    e.vis.setEmissive(e.isAttacking ? 0xff2222 : 0x000000, e.isAttacking ? 0.4 : 0);
    setBar(e.bar, e.hp / enemyMaxHp(e), e.x, barY(e.vis), e.z, e.hp < enemyMaxHp(e) - 0.5);
  }
  for (const w of workers) {
    w.vis.group.position.set(w.x, 0, w.z);
    w.vis.group.rotation.y = Math.atan2(w.faceX, w.faceZ) + Math.PI;
    w.ring.position.set(w.x, 0.06, w.z);
    w.ring.visible = selectedUnits.has(w);
    setBar(w.workBar, (w.mineT || 0) / effMineTime(), w.x, barY(w.vis), w.z, w.job === 'mine');
  }
  for (const g of guards) {
    const lunge = g.swing > 0 ? Math.sin((0.22 - g.swing) / 0.22 * Math.PI) * 0.3 : 0;
    g.vis.group.position.set(g.x + g.faceX * lunge, 0, g.z + g.faceZ * lunge);
    g.vis.group.rotation.y = Math.atan2(g.faceX, g.faceZ) + Math.PI;
    g.ring.position.set(g.x, 0.06, g.z);
    g.ring.visible = selectedUnits.has(g);
    if (g.bar) setBar(g.bar, g.hp / g.maxHp, g.x, barY(g.vis), g.z, g.hp < g.maxHp - 0.5);
  }
  for (const b of buildings) setBar(b.bar, b.hp / b.maxHp, b.cx, 1.9, b.cz, b.hp < b.maxHp - 0.5);
  for (const u of pickups) {
    u.t += dt;
    u.mesh.rotation.y += dt * 2;
    u.mesh.position.set(u.x, 0.5 + Math.sin(u.t * 3) * 0.12, u.z);
  }
}

function tick(dt) {
  if (net.role === 'client') { tickClient(dt); return; }
  if (!paused && alive && started) {
    survival += dt;
    updatePlayer(dt);
    for (const p of players) if (p.grace > 0) p.grace -= dt;
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) flashEl.style.opacity = '0';
    }
    // 동료 슬롯은 사람이 앉았을 때만 존재한다 (D95에서 AI를 걷어냈다).
    // updatePlayer가 이미 updateActor로 돌렸으므로 여기서는 보이기만 맞춘다.
    for (const q of players) q.vis.group.visible = q.active;
    updateRescue();
    updateWipeGrace(dt);
    flushNavDirty();           // 이번 프레임에 바뀐 벽을 한 번에 반영 (D70)
    trackTargetVelocity(dt);   // 리드 조준용 속도 추정 (적이 앞을 노린다)
    if (enemyActive()) {
      ringPhase += P.enemy.drift * dt;   // 포위 링 전체가 목표 둘레를 천천히 돈다
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
    // 재생은 두 햄스터가 같은 규칙이다 (D92-1c). 예전엔 동료만 hurtT 게이트가 없어서
    // **맞는 중에도 계속 회복**했다 (대신 0.6배). 2P에서는 그게 그대로 불공평이 된다.
    for (const p of players) {
      if (!p.active) continue;
      p.hurtT += dt;
      if (!p.stunned && p.hurtT > P.player.regenDelay)
        p.hp = Math.min(p.hp + P.player.regen * dt, P.player.hp);
    }
    if (camShake > 0) camShake -= dt * 2;
    updateStageTimer(dt);
    // 나르기는 사람이 모는 햄스터 전부가 한다 (D92-2단계).
    // 솔로에서는 player 하나라 예전과 같다.
    for (const p of players)
      if (p.active) p.job = p.stunned ? null : doCarryWork(p, dt, P.carry.playerLoad, p.owner);
    updateWorkers(dt);
    updateGuards(dt);
    updateProjectiles(dt);
    updateBuildings(dt);
    updateNodes(dt);
    updateCheeseBits(dt);
      updatePickups(dt);
    updateWallPops(dt);
    // 영토 (D86) — 둘 다 세대 카운터로 캐시되어 있어서 바뀔 때만 실제 작업을 한다
    refreshTerritory();
    paintTerritory();
    // 영토 면적당 치즈 수입 (D88 실험) — 치즈더미 없이 숨어 있어도 소량은 모인다.
    // **면적에 비례**하므로 "숨어 있으면 번다"가 아니라 "넓혀야 번다"가 된다.
    // 채굴 왕복(D36)을 대체하지 않도록 일부러 작게 뒀다 (기본값 근거는 P.res.terrIncome 주석).
    // 영토 자체에는 소유자가 없다 (벽 한 줄을 둘이 같이 쌓으면 누구 땅인지 정할 방법이 없다).
    // 그래서 **수입을 벽 기여도로 나눈다** (D95). 균등 분할이던 D92의 타협을 바꾼 것 —
    // 살림이 각자라면 수입도 각자여야 하고, 균등이면 한 명이 안 쌓아도 같이 번다.
    // 혼자면 지분이 1이라 솔로 수입은 그대로다.
    if (P.res.terrIncome > 0) {
      const share = humans();
      const total = territoryArea * P.res.terrIncome * dt;
      if (share.length === 1) share[0].cheese += total;
      else {
        const mine = {}; let all = 0;
        for (const ob of obstacles.values())
          if (!ob.bedrock && !ob.bldgRef) { mine[ob.owner] = (mine[ob.owner] || 0) + 1; all++; }
        // 아직 아무도 안 쌓았으면 반씩 (0으로 나누지 않게)
        for (const q of share) q.cheese += all ? total * ((mine[q.owner] || 0) / all) : total / share.length;
      }
    }
  }
  updateFx(dt);
  updateCamera(dt);
  if (camShake > 0) {
    const c = activeCam();
    c.position.x += (Math.random() - 0.5) * camShake * 0.9;
    c.position.z += (Math.random() - 0.5) * camShake * 0.9;
  }
  noteFrame();
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; updateHUD(); updateHotbar(); renderNet(); renderNetDev(); }
  sendSnapshot(dt);
  sendSettings(dt);
}

// ============================================================
// 루프 (D94에서 창을 내려도 안 멈추게 고침)
//  브라우저는 **숨은 탭의 requestAnimationFrame을 아예 멈춘다.** 그러면 호스트가
//  창을 내리는 순간 시뮬이 정지하고, 상대 화면에서는 세계가 그대로 얼어붙는다.
//  방 코드를 불러 주려면 어차피 창을 옮겨야 하니 실제로 늘 일어나는 일이다.
//  Worker의 타이머는 숨어 있어도 산다(실측 ~13Hz). 그걸 심장박동으로 쓴다.
//  화면은 어차피 안 보이므로 **그릴 필요는 없고, 시뮬만 이어 가면 된다.**
let prevT = performance.now();
let visible = !document.hidden;

function stepBy(elapsedMs, draw) {
  // 한 번에 몰아서 따라잡되 상한을 둔다 (오래 숨어 있었으면 그만큼은 버린다 —
  // 다 따라잡으려다 프레임을 통째로 잡아먹는 죽음의 나선을 피한다)
  let left = Math.min(elapsedMs / 1000, 0.5);
  while (left > 0) {
    const dt = Math.min(left, 1 / 60);
    tick(dt);
    left -= dt;
  }
  if (draw) { drawMini(Math.min(elapsedMs / 1000, 0.5)); faceBars(); renderer.render(scene, activeCam()); }
}

function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) return;          // 숨어 있으면 심장박동이 대신 돈다
  const now = performance.now();
  const el = now - prevT;
  prevT = now;
  stepBy(el, true);
}
loop();

// 숨어 있는 동안만 도는 심장박동. rAF가 살아 있으면 아무 일도 안 한다.
{
  const src = 'let t=null; onmessage=(e)=>{ if(e.data){ t=t||setInterval(()=>postMessage(1),16); }' +
              ' else { clearInterval(t); t=null; } };';
  let beat = null;
  try {
    beat = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    beat.onmessage = () => {
      if (!document.hidden) return;
      const now = performance.now();
      const el = now - prevT;
      prevT = now;
      stepBy(el, false);                // 안 보이는 화면은 안 그린다
    };
  } catch { /* Worker를 못 만들면 예전처럼 rAF만 쓴다 */ }
  const sync = () => {
    visible = !document.hidden;
    prevT = performance.now();          // 돌아왔을 때 큰 dt가 한 번에 들어오지 않게
    if (beat) beat.postMessage(document.hidden ? 1 : 0);
  };
  document.addEventListener('visibilitychange', sync);
  sync();
}

// 자동 검증용 디버그 훅
window.__game = {
  P, player, enemies, obstacles, keys, tick, restart, setCamera, addObstacle,
  refreshClearance, planEnemyPath,
  get alive() { return alive; },
  get resources() { return player.cheese; },
  set resources(v) { player.cheese = v; },
  get caughtCount() { return caughtCount; },
  get grace() { return player.grace; },
  ENEMY_SPAWN, PLAYER_SPAWN,
  snapshotSettings, applySettings, settingsAsSource,
  get DEFAULT_SETTINGS() { return DEFAULT_SETTINGS; },
  get enemyReach() { return enemyReach; },
  nodes, ghost, mouseNDC, CAM_MODES, enemies,
  setEnemyCount, spawnBuildFx, hireWorker, workers, doCarryWork, nearestDepot,
  // 채굴 명령 (E · 우클릭 · 드래그 선택)
  nearestPile, setMineOrder, clearMineOrder, toggleMineOrder, nearestSafeSpot, aimPoint, isCutoff,
  refreshReach, get safeField() { return safeField; }, get safeGen() { return safeGen; },
  refreshTerritory, inTerritory,
  net, byId, get entSeq() { return entSeq; },
  get territory() { return territory; }, get territoryArea() { return territoryArea; },
  sampleLocalInput, updateActor, updateActorVis, updateLocalUI, updatePlayer, startRoll,
  beginMatch, openStart, get started() { return started; }, get paused() { return paused; },
  applySnapshot, fullSnapshot, applyFull, sendSnapshot, drawMini,
  startTaunt, giveTo, humans, others, OWNERS, players, MAX_PLAYERS, nearestMate,
  get playerVis() { return player.vis; },
  get renderT() { return renderT; }, get lastSnapT() { return lastSnapT; },
  applyCommand, issueCommand, queueWall, removeAt, unitById, guardsOf, isDriven, flashFor,
  worldToCell, cellToWorld, buildingPlacement, get CELLS() { return CELLS; }, CS,
  worldToNav, navToWorld, nearestPassableNav, canPass, get clearAll() { return clearAll; }, get NAV() { return NAV; },
  selectedUnits, unitAtScreen, commandWorkersToPile, commandUnitsMove, worldToScreen,
  selWorkers, selGuards, GUARD_TYPES,
  get playerOrder() { return player.mineOrder; },
  get minePromptVisible() { return minePrompt.visible; },
  get safeMarkVisible() { return safeMark.visible; },
  get safeMarkPos() { return { x: safeMark.position.x, z: safeMark.position.z }; },
  get playerJob() { return player.job; },
  get allyRes() { return ally.cheese; }, set allyRes(v) { ally.cheese = v; },
  get buildJob() { return player.buildJob; },
  get wallCast() { return player.wallCast; },
  wallSpotOk, nearestBuildSpot, clearWallOrders,
  get wallOrders() { return player.wallOrders; }, get buildOrder() { return player.buildOrder; },
  get ghostCell() { return ghostCell; }, get ghostWhy() { return ghostWhy; },
  startBuild, cancelBuild,
  buildings, placeBuilding, destroyBuilding, STAGES,
  get stage() { return stage; },
  get stageT() { return stageT; },
  get victory() { return victory; },
  set stageT(v) { stageT = v; },
  advanceStage, stageDur, hasWorkshop, depotCount, maxWorkshopTier, TOWER_TIERS, spawnBoss,
  effTowerDmg, effGuardDmg, effPickupInterval, effPickupMax, effPartsEach, SELF_BUILD,
  tryUpgradeBuilding, cancelUpgrade, nearestUpgradable, upgradeSpec, upgradeBlockedWhy,
  applyBuildingTierVisual, cheeseCost, slotLockReason, BUILD_SLOTS,
  get removeMode() { return removeMode; }, set removeMode(v) { removeMode = v; },
  get upgradePromptText() { return upgradePrompt.userData.text; },
  get upgradePromptVisible() { return upgradePrompt.visible; },
  get upgradeJob() { return player.upgradeJob; },
  pickups, spawnPickup, UPGRADES, buyUpgrade,
  get upg() { return player.upg; },
  guards, projectiles, placeGuard, damageEnemy, topUpToCurve,
  get killCount() { return killCount; },
  get playerHp() { return player.hp; },
  get stamina() { return player.stamina; }, set stamina(v) { player.stamina = v; },
  set playerHp(v) { player.hp = v; },
  get allyHp() { return ally.hp; },
  hurtHamster, detonate, lobProjectile,

  get parts() { return player.parts; }, set parts(v) { player.parts = v; },
  MAPS, get mapIndex() { return mapIndex; }, setMap,
  ally, caught, gameOver,
  get playerStunned() { return player.stunned; },
  set playerStunned(v) { player.stunned = v; },
  get buildSlot() { return buildSlot; },
  set buildSlot(v) { buildSlot = v; },
  get minedCount() { return minedCount; },
  enemyR, unlockedTypes,
  get fxCount() { return fx.length; },
  get cheeseBitCount() { return cheeseBits.length; },
  get harvestPulse() { return player.harvestPulse; },
  setMouse(x, y) { mouseNDC.set(x, y); mouseValid = true; },
  threatLevel, enemySpeedOf, enemyDpsOf,
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) tick(dt);
    faceBars();
    renderer.render(scene, activeCam());
  },
};
