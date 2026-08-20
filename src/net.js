// ============================================================
// 2P 접속 (D92-5단계)
//
// PeerJS의 공용 브로커는 **시그널링만** 한다 — 방 코드로 서로를 찾을 때까지만 쓰고,
// 그 뒤 게임 트래픽은 WebRTC 데이터 채널로 직통이다. 서버를 띄울 필요가 없고
// GitHub Pages 정적 배포 그대로 돌아간다.
//
// 이 파일은 **게임을 모른다.** 봉투(k)와 바이트만 다루고, 내용물 해석은 main.js가 한다.
// 그래서 main.js가 6,400줄이어도 여기는 짧게 유지된다.
//
// ⚠ 알려진 한계: TURN 서버가 없다. 대칭 NAT(일부 모바일 캐리어·회사망)에서는
// P2P 연결 자체가 안 뚫리고, 그때 PeerJS가 주는 에러는 불친절하다.
// "연결이 안 돼요"가 이 기능의 가장 흔한 실패 모드이므로 status에 사람 말로 적어 둔다.
// ============================================================

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳 — 전화로 불러 줄 수 있어야 한다
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'tnj-';

export function makeCode(n = 6) {
  let s = '';
  for (let k = 0; k < n; k++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export const net = {
  role: 'solo',        // 'solo' | 'host' | 'client'
  isHost: true,        // 솔로도 호스트다 — 시뮬을 자기가 돌리므로
  code: '',
  rtt: 0,
  status: '',          // 사람이 읽을 상태 한 줄 (HUD에 그대로 나간다)
  connected: false,
  // 지연 A/B용 (D92-7단계). Chrome의 네트워크 스로틀은 WebRTC에 안 걸리므로
  // 직접 만들어야 한다. 편도 ms.
  fakeLag: 0,
  // 통계
  sent: 0, recv: 0, sentBytes: 0, recvBytes: 0,

  _peer: null,
  _conn: null,
  _hooks: {},
  _pingT: null,
  _pingSeq: 0,
  _pingAt: new Map(),

  send(msg) {
    const c = this._conn;
    if (!c || !c.open) return false;
    this.sent++;
    // 크기 통계는 JSON 길이로 어림잡는다 (실제 전송은 BinaryPack이라 이보다 작다)
    this.sentBytes += approxSize(msg);
    if (this.fakeLag > 0) setTimeout(() => { if (c.open) c.send(msg); }, this.fakeLag);
    else c.send(msg);
    return true;
  },

  host(hooks = {}) {
    this._start('host', makeCode(), hooks);
  },

  join(code, hooks = {}) {
    this._start('client', String(code || '').trim().toUpperCase(), hooks);
  },

  leave() {
    this._stopPing();
    try { if (this._conn) this._conn.close(); } catch { /* 이미 닫힘 */ }
    try { if (this._peer) this._peer.destroy(); } catch { /* 이미 파괴됨 */ }
    this._conn = null; this._peer = null;
    this.role = 'solo'; this.isHost = true; this.connected = false;
    this.code = ''; this.rtt = 0; this.status = '';
    if (this._hooks.onClose) this._hooks.onClose('나감');
  },

  // ---- 내부 ----
  async _start(role, code, hooks) {
    this.leave();
    this._hooks = hooks;
    this.role = role;
    this.isHost = role === 'host';
    this.code = code;
    this.status = role === 'host' ? '방 여는 중…' : '연결 중…';
    if (hooks.onStatus) hooks.onStatus();

    let Peer;
    try {
      ({ default: Peer } = await import('peerjs'));
    } catch (e) {
      this._fail('네트워크 모듈을 못 불러왔습니다');
      return;
    }

    // 호스트는 방 코드를 그대로 peer id로 쓴다 (그래야 클라가 찾아온다).
    // 클라는 아무 id나 받으면 된다.
    const peer = role === 'host' ? new Peer(PREFIX + code) : new Peer();
    this._peer = peer;

    peer.on('error', (err) => {
      const t = err && err.type;
      if (t === 'unavailable-id') this._fail('그 방 코드는 이미 쓰이는 중입니다 — 다시 시도하세요');
      else if (t === 'peer-unavailable') this._fail('그런 방이 없습니다 — 코드를 확인하세요');
      else if (t === 'network' || t === 'server-error') this._fail('브로커에 연결하지 못했습니다');
      else if (t === 'webrtc' || t === 'unavailable') this._fail('P2P 연결이 막혔습니다 (회사망·일부 모바일망)');
      else this._fail(`연결 오류: ${t || err}`);
    });

    // 브로커와의 연결이 끊기면 **방 코드가 조용히 죽는다.**
    // 친구를 기다리는 동안(탭을 옮겨 두면 특히) 실제로 일어난다 — 화면은 계속
    // "친구를 기다리는 중"인데 상대에게는 "그런 방이 없습니다"가 뜬다.
    // P2P 데이터 채널은 살아 있으므로, 이미 붙어 있으면 게임은 안 끊긴다.
    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      this.status = this.connected ? this.status : '방 서버와 끊김 — 다시 붙는 중…';
      if (hooks.onStatus) hooks.onStatus();
      try { peer.reconnect(); } catch { /* 이미 파괴됨 */ }
    });

    // 브로커에 다시 붙으면 'open'이 **또** 온다. 리스너를 그때마다 달면
    // 접속 하나에 _bind가 두 번 돌아 메시지가 이중 처리된다 — 한 번만 단다.
    let wired = false;
    peer.on('open', () => {
      if (role === 'host') {
        this.status = this.connected ? `연결됨 (방 ${code})` : `방 ${code} — 친구를 기다리는 중`;
        if (hooks.onStatus) hooks.onStatus();
        if (wired) return;
        wired = true;
        peer.on('connection', (c) => {
          if (this._conn && this._conn.open) { c.close(); return; }   // 2인만 (D92)
          this._bind(c);
        });
      } else if (!wired) {
        wired = true;
        this._bind(peer.connect(PREFIX + code, { reliable: true }));
      }
    });
  },

  _bind(conn) {
    this._conn = conn;
    conn.on('open', () => {
      this.connected = true;
      this.status = `연결됨 (방 ${this.code})`;
      this._startPing();
      if (this._hooks.onOpen) this._hooks.onOpen();
      if (this._hooks.onStatus) this._hooks.onStatus();
    });
    conn.on('data', (msg) => {
      this.recv++;
      this.recvBytes += approxSize(msg);
      if (msg && msg.k === 'PING') { this.send({ k: 'PONG', s: msg.s }); return; }
      if (msg && msg.k === 'PONG') {
        const t0 = this._pingAt.get(msg.s);
        if (t0 !== undefined) { this.rtt = Math.round(performance.now() - t0); this._pingAt.delete(msg.s); }
        return;
      }
      if (this._hooks.onMessage) this._hooks.onMessage(msg);
    });
    conn.on('close', () => {
      this.connected = false;
      this.status = '상대가 나갔습니다';
      this._stopPing();
      if (this._hooks.onClose) this._hooks.onClose('상대 나감');
      if (this._hooks.onStatus) this._hooks.onStatus();
    });
    conn.on('error', () => {
      this.status = '연결이 끊겼습니다';
      if (this._hooks.onStatus) this._hooks.onStatus();
    });
  },

  _startPing() {
    this._stopPing();
    this._pingT = setInterval(() => {
      const s = ++this._pingSeq;
      this._pingAt.set(s, performance.now());
      // 오래된 표는 버린다 (응답이 안 오면 영원히 남는다)
      if (this._pingAt.size > 8) this._pingAt.delete(this._pingAt.keys().next().value);
      this.send({ k: 'PING', s });
    }, 1000);
  },

  _stopPing() {
    if (this._pingT) clearInterval(this._pingT);
    this._pingT = null;
    this._pingAt.clear();
  },

  _fail(msg) {
    this.status = msg;
    this.connected = false;
    this.role = 'solo'; this.isHost = true;
    if (this._hooks.onStatus) this._hooks.onStatus();
    if (this._hooks.onClose) this._hooks.onClose(msg);
  },
};

// 대략적인 바이트 수 — 예산이 맞는지 보려는 용도지 정확할 필요는 없다
function approxSize(o) {
  try { return JSON.stringify(o).length; } catch { return 0; }
}
