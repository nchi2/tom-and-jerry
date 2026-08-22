// ============================================================
// 접속 (D92 2인 → D97에서 최대 4인)
//
// PeerJS의 공용 브로커는 **시그널링만** 한다 — 방 코드로 서로를 찾을 때까지만 쓰고,
// 그 뒤 게임 트래픽은 WebRTC 데이터 채널로 직통이다. 서버를 띄울 필요가 없고
// GitHub Pages 정적 배포 그대로 돌아간다.
//
// 이 파일은 **게임을 모른다.** 봉투(k)와 바이트만 다루고, 내용물 해석은 main.js가 한다.
//
// **별 모양이다** (D97). 호스트가 가운데 있고 참가자들이 각자 호스트에게만 붙는다.
// 참가자끼리는 직접 연결하지 않는다 — 어차피 시뮬은 호스트만 돌리므로 필요가 없고,
// N명이 서로 붙으면 연결이 N²로 늘어난다.
//
// **한 사람당 채널이 둘이다** (D94). 이게 끊김의 핵심이었다:
//   main — 순서 보장. HELLO·명령·이벤트처럼 **순서가 뒤바뀌면 안 되는 것**
//   fast — **무순서**(PeerJS `reliable:false`). SNAP·IN·PING처럼 다음 것이 이전 것을 덮어쓰는 것
// 전부 순서 보장 채널로 보내면 패킷 하나가 늦을 때 그 뒤 스냅샷이 **전부 줄줄이 막힌다**
// (head-of-line blocking). 스냅샷은 전체 상태라 하나 늦어도 다음 게 대신하는데,
// 순서 채널은 그걸 모르고 앞엣것이 도착할 때까지 뒤를 전부 세운다 → "끊기고 렉 걸린다".
//
// 정확히 해 두자면 무순서일 뿐 **재전송이 꺼지는 건 아니다** (PeerJS가 maxRetransmits를
// 안 열어 준다). 늦은 패킷이 뒤를 막는 문제는 사라지고, 잃은 패킷을 다시 보내느라
// 대역폭을 조금 쓰는 것만 남는다. 프로토타입에서는 이 맞바꿈이 맞다.
//
// ⚠ 알려진 한계: TURN 서버가 없다. 대칭 NAT(일부 모바일 캐리어·회사망)에서는
// P2P 연결 자체가 안 뚫리고, 그때 PeerJS가 주는 에러는 불친절하다.
// "연결이 안 돼요"가 이 기능의 가장 흔한 실패 모드이므로 status에 사람 말로 적어 둔다.
// ============================================================

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳 — 전화로 불러 줄 수 있어야 한다
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'tnj-';

// 보낼 게 이 바이트 이상 쌓여 있으면 스냅샷을 버린다.
// 스냅샷 몇 장 분량 — 이보다 쌓였다는 건 링크가 못 따라가고 있다는 뜻이다.
const BUF_LIMIT = 24 * 1024;

export function makeCode(n = 6) {
  let s = '';
  for (let k = 0; k < n; k++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function bufferedOf(conn) {
  const dc = conn && conn.dataChannel;
  return dc && typeof dc.bufferedAmount === 'number' ? dc.bufferedAmount : 0;
}

export const net = {
  role: 'solo',        // 'solo' | 'host' | 'client'
  isHost: true,        // 솔로도 호스트다 — 시뮬을 자기가 돌리므로
  code: '',
  status: '',          // 사람이 읽을 상태 한 줄 (HUD에 그대로 나간다)
  connected: false,    // 클라: 호스트에 붙었나 / 호스트: 참가자가 하나라도 있나
  maxPlayers: 2,       // 방 정원 (호스트 포함)
  slot: 0,             // 내가 몇 번 슬롯인가. 호스트는 늘 0, 클라는 HELLO로 받는다
  rtt: 0,              // 클라: 호스트와의 왕복 / 호스트: 참가자 중 최댓값
  // 지연 A/B용 (D92-7단계). Chrome의 네트워크 스로틀은 WebRTC에 안 걸리므로
  // 직접 만들어야 한다. 편도 ms.
  fakeLag: 0,
  // 통계
  sent: 0, recv: 0, dropped: 0, buffered: 0, fastOpen: false, retries: 0,

  _peer: null,
  _links: [],        // 호스트: 참가자마다 하나 { peerId, slot, main, fast, rtt, pingAt }
  _self: null,       // 클라: 호스트로 가는 링크 (같은 모양)
  _hooks: {},
  _pingT: null,
  _pingSeq: 0,
  _bye: false,       // 내가 일부러 나갔는가 (그러면 재접속을 시도하지 않는다)
  _tries: 0,

  // 지금 방에 있는 사람 수 (호스트 포함)
  count() {
    if (this.role === 'host') return 1 + this._links.filter((l) => l.main && l.main.open).length;
    return this.connected ? 2 : 1;   // 클라는 방 전체를 모른다 — main.js가 스냅샷으로 안다
  },

  // 지금 차 있는 슬롯 번호들 (호스트 전용)
  slots() {
    return [0, ...this._links.filter((l) => l.main && l.main.open).map((l) => l.slot)].sort();
  },

  // fast = 놓쳐도 되는 것(스냅샷·입력). 늦게 도착한 것보다 버리는 게 낫다.
  // 호스트에서는 **전원에게** 뿌린다.
  send(msg, fast = false) {
    if (this.role === 'client') return this._push(this._self, msg, fast);
    let any = false;
    for (const l of this._links) any = this._push(l, msg, fast) || any;
    return any;
  },

  // 호스트 전용 — 한 사람에게만 (실패 알림처럼 주인이 있는 메시지)
  sendTo(slot, msg, fast = false) {
    if (this.role !== 'host') return false;
    const l = this._links.find((x) => x.slot === slot);
    return l ? this._push(l, msg, fast) : false;
  },

  _push(link, msg, fast) {
    if (!link) return false;
    const c = fast && link.fast && link.fast.open ? link.fast : link.main;
    if (!c || !c.open) return false;
    // ---- 역압 (D94) ----
    // 보낼 게 이미 쌓여 있으면 **스냅샷은 버린다.** 안 버리면 큐가 자라고
    // 지연이 눈덩이처럼 커지다가 채널이 멈춰 버린다. 다음 스냅샷이 어차피 전체 상태다.
    const buf = bufferedOf(c);
    if (buf > this.buffered) this.buffered = buf;
    if (fast && buf > BUF_LIMIT) { this.dropped++; return false; }
    this.sent++;
    if (this.fakeLag > 0) setTimeout(() => { if (c.open) c.send(msg); }, this.fakeLag);
    else c.send(msg);
    return true;
  },

  host(maxPlayers = 2, hooks = {}) {
    this.maxPlayers = Math.max(2, Math.min(4, maxPlayers));
    this._start('host', makeCode(), hooks);
  },

  join(code, hooks = {}) {
    this._start('client', String(code || '').trim().toUpperCase(), hooks);
  },

  leave() {
    this._bye = true;
    this._stopPing();
    for (const l of this._links) closeLink(l);
    closeLink(this._self);
    this._links = []; this._self = null;
    try { if (this._peer) this._peer.destroy(); } catch { /* 이미 파괴됨 */ }
    this._peer = null;
    this.fastOpen = false;
    this.role = 'solo'; this.isHost = true; this.connected = false;
    this.code = ''; this.rtt = 0; this.status = ''; this.slot = 0;
    if (this._hooks.onClose) this._hooks.onClose('나감');
  },

  // ---- 내부 ----
  async _start(role, code, hooks) {
    this.leave();
    this._bye = false;
    this._tries = 0;
    this._hooks = hooks;
    this.role = role;
    this.isHost = role === 'host';
    this.code = code;
    this.slot = role === 'host' ? 0 : -1;   // 클라는 HELLO를 받아야 안다
    this.status = role === 'host' ? '방 여는 중…' : '연결 중…';
    if (hooks.onStatus) hooks.onStatus();

    let Peer;
    try {
      ({ default: Peer } = await import('peerjs'));
    } catch {
      this._fail('네트워크 모듈을 못 불러왔습니다');
      return;
    }

    // 호스트는 방 코드를 그대로 peer id로 쓴다 (그래야 참가자가 찾아온다).
    // 참가자는 아무 id나 받으면 된다.
    const peer = role === 'host' ? new Peer(PREFIX + code) : new Peer();
    this._peer = peer;

    peer.on('error', (err) => {
      const t = err && err.type;
      // 참가자 하나가 사라진 것뿐이면 방은 안 닫는다 (호스트는 계속 기다린다)
      if (this.role === 'host' && t === 'peer-unavailable') return;
      if (t === 'unavailable-id') this._fail('그 방 코드는 이미 쓰이는 중입니다 — 다시 시도하세요');
      else if (t === 'peer-unavailable') this._fail('그런 방이 없습니다 — 코드를 확인하세요');
      else if (t === 'network' || t === 'server-error') this._fail('브로커에 연결하지 못했습니다');
      else if (t === 'webrtc' || t === 'unavailable') this._fail('P2P 연결이 막혔습니다 (회사망·일부 모바일망)');
      else this._fail(`연결 오류: ${t || err}`);
    });

    // 브로커와의 연결이 끊기면 **방 코드가 조용히 죽는다.**
    // 친구를 기다리는 동안(탭을 옮겨 두면 특히) 실제로 일어난다 — 화면은 계속
    // "친구를 기다리는 중"인데 상대에게는 "그런 방이 없습니다"가 뜬다.
    // 이미 붙어 있는 P2P 데이터 채널은 브로커와 무관하므로 게임은 안 끊긴다.
    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      if (!this.connected) this.status = '방 서버와 끊김 — 다시 붙는 중…';
      if (hooks.onStatus) hooks.onStatus();
      try { peer.reconnect(); } catch { /* 이미 파괴됨 */ }
    });

    // 브로커에 다시 붙으면 'open'이 **또** 온다. 리스너를 그때마다 달면
    // 접속 하나에 바인딩이 두 번 돌아 메시지가 이중 처리된다 — 한 번만 단다.
    let wired = false;
    peer.on('open', () => {
      if (role === 'host') {
        this._hostStatus();
        if (wired) return;
        wired = true;
        peer.on('connection', (c) => this._accept(c));
      } else if (!wired) {
        wired = true;
        this._dial(peer, code);
      }
      if (hooks.onStatus) hooks.onStatus();
    });
  },

  _hostStatus() {
    const n = this.count();
    this.status = n >= this.maxPlayers
      ? `방 ${this.code} — ${n}/${this.maxPlayers} 다 모였다`
      : `방 ${this.code} — ${n}/${this.maxPlayers} 기다리는 중`;
  },

  // ---- 호스트: 들어오는 연결을 받는다 ----
  // main과 fast가 따로 도착하고 순서도 보장되지 않으므로 **peer id로 짝을 짓는다.**
  _accept(conn) {
    let link = this._links.find((l) => l.peerId === conn.peer);
    if (!link) {
      // 정원이 찼으면 거절한다. 슬롯은 비어 있는 가장 앞 번호를 준다 —
      // 누가 나갔다 들어와도 번호가 계속 커지지 않게.
      const used = new Set(this._links.map((l) => l.slot));
      let slot = -1;
      for (let k = 1; k < this.maxPlayers; k++) if (!used.has(k)) { slot = k; break; }
      if (slot < 0) { try { conn.close(); } catch { /* 이미 닫힘 */ } return; }
      link = { peerId: conn.peer, slot, main: null, fast: null, rtt: 0, pingAt: new Map() };
      this._links.push(link);
    }
    if (conn.label === 'fast') this._bindFast(link, conn);
    else this._bindMain(link, conn);
  },

  // ---- 참가자: 호스트에게 두 채널을 연다 ----
  _dial(peer, code) {
    const link = { peerId: PREFIX + code, slot: -1, main: null, fast: null, rtt: 0, pingAt: new Map() };
    this._self = link;
    this._bindMain(link, peer.connect(PREFIX + code, { reliable: true, label: 'main' }));
    // fast는 실패해도 게임이 도므로 최선 노력이다
    try { this._bindFast(link, peer.connect(PREFIX + code, { reliable: false, label: 'fast' })); }
    catch { /* 무순서 채널을 못 열면 전부 순서 채널로 간다 */ }
  },

  _bindFast(link, conn) {
    link.fast = conn;
    conn.on('open', () => { this.fastOpen = true; });
    conn.on('data', (msg) => this._onData(link, msg));
    conn.on('close', () => { link.fast = null; this.fastOpen = this._anyFast(); });
    conn.on('error', () => { this.fastOpen = this._anyFast(); });
  },

  _anyFast() {
    if (this.role === 'client') return !!(this._self && this._self.fast && this._self.fast.open);
    return this._links.some((l) => l.fast && l.fast.open);
  },

  _bindMain(link, conn) {
    link.main = conn;
    conn.on('open', () => {
      this.connected = true;
      this._tries = 0;
      this._startPing();
      if (this.role === 'host') {
        this._hostStatus();
        if (this._hooks.onJoin) this._hooks.onJoin(link.slot);
      } else {
        this.status = `연결됨 (방 ${this.code})`;
        if (this._hooks.onOpen) this._hooks.onOpen();
      }
      if (this._hooks.onStatus) this._hooks.onStatus();
    });
    conn.on('data', (msg) => this._onData(link, msg));
    conn.on('close', () => this._onMainClose(link));
    conn.on('error', () => {
      if (this.role !== 'host') { this.status = '연결이 끊겼습니다'; }
      if (this._hooks.onStatus) this._hooks.onStatus();
    });
  },

  _onMainClose(link) {
    if (this.role === 'host') {
      // 참가자 하나가 나갔다. **방은 안 닫는다** — 남은 사람끼리 계속한다
      closeLink(link);
      this._links = this._links.filter((l) => l !== link);
      this.connected = this._links.some((l) => l.main && l.main.open);
      this._hostStatus();
      if (this._hooks.onLeave) this._hooks.onLeave(link.slot);
      if (this._hooks.onStatus) this._hooks.onStatus();
      return;
    }
    this.connected = false;
    this._stopPing();
    // 데이터 채널이 끊겼다고 판이 끝나면 안 된다 (D94).
    // 참가자는 몇 번 다시 걸어 본다 — 호스트는 방을 열어 둔 채 기다리면 그만이다.
    if (!this._bye && this._tries < 3 && this._peer && !this._peer.destroyed) {
      this._tries++; this.retries++;
      this.status = `연결이 끊겼다 — 다시 붙는 중 (${this._tries}/3)`;
      if (this._hooks.onStatus) this._hooks.onStatus();
      setTimeout(() => {
        if (this._bye || this.connected || !this._peer || this._peer.destroyed) return;
        this._dial(this._peer, this.code);
      }, 600 * this._tries);
      return;
    }
    this.status = this._bye ? '' : '호스트와 연결이 끊겼습니다';
    if (this._hooks.onClose) this._hooks.onClose('끊김');
    if (this._hooks.onStatus) this._hooks.onStatus();
  },

  _onData(link, msg) {
    this.recv++;
    if (msg && msg.k === 'PING') { this._push(link, { k: 'PONG', s: msg.s }, true); return; }
    if (msg && msg.k === 'PONG') {
      const t0 = link.pingAt.get(msg.s);
      if (t0 !== undefined) {
        link.rtt = Math.round(performance.now() - t0);
        link.pingAt.delete(msg.s);
        this.rtt = this.role === 'host'
          ? Math.max(0, ...this._links.map((l) => l.rtt))
          : link.rtt;
      }
      return;
    }
    // 호스트는 **누가 보냈는지**를 같이 넘긴다 — 그게 없으면 4인에서 입력이 뒤섞인다
    if (this._hooks.onMessage) this._hooks.onMessage(msg, link.slot);
  },

  _startPing() {
    if (this._pingT) return;
    this._pingT = setInterval(() => {
      const s = ++this._pingSeq;
      const all = this.role === 'client' ? [this._self] : this._links;
      for (const l of all) {
        if (!l) continue;
        l.pingAt.set(s, performance.now());
        // 오래된 표는 버린다 (응답이 안 오면 영원히 남는다)
        if (l.pingAt.size > 8) l.pingAt.delete(l.pingAt.keys().next().value);
        this._push(l, { k: 'PING', s }, true);
      }
      this.buffered = 0;   // 굴러가는 최댓값이라 주기마다 리셋한다
    }, 1000);
  },

  _stopPing() {
    if (this._pingT) clearInterval(this._pingT);
    this._pingT = null;
  },

  _fail(msg) {
    this.status = msg;
    this.connected = false;
    this.role = 'solo'; this.isHost = true;
    if (this._hooks.onStatus) this._hooks.onStatus();
    if (this._hooks.onClose) this._hooks.onClose(msg);
  },
};

function closeLink(l) {
  if (!l) return;
  try { if (l.fast) l.fast.close(); } catch { /* 이미 닫힘 */ }
  try { if (l.main) l.main.close(); } catch { /* 이미 닫힘 */ }
  l.main = null; l.fast = null;
}
