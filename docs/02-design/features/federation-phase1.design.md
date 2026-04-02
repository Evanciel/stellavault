# Federation Phase 1a — Design

> Feature: federation-phase1
> Plan: docs/01-plan/features/federation-phase1.plan.md
> Architecture: Option C (실용적 균형)
> Created: 2026-04-02

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 개인 지식의 고립 해소. P2P 시맨틱 검색이 작동하는지 증명 |
| **WHO** | 자기 자신 (2개 터미널로 테스트) |
| **RISK** | Hyperswarm NAT, 검색 지연, 임베딩 프라이버시 |
| **SUCCESS** | 2 노드 연결 + 연합 검색 + 원문 비노출 + 3초 이내 |
| **SCOPE** | P2P 연결 + 연합 검색 + CLI만. UI/MCP/Notion 제외 |

---

## 1. Overview

Phase 1a는 "P2P 지식 검색이 되는가"를 증명하는 최소 구현.
6개 파일, 4개 메시지 타입, 5개 CLI 서브커맨드.

```
Terminal A                          Terminal B
──────────                          ──────────
sv federate join                    sv federate join
  "Listening..."                      "1 peer found: node-abc"
sv federate peers
  "node-xyz (1,209 docs)"
sv federate search "k8s deploy"
  → 임베딩 생성
  → node-xyz에 전송
  ← node-xyz 응답: "K8s 배포 가이드 (87%) - Kubernetes에서 무중단..."
```

---

## 2. 모듈 설계

### 2.1 파일 구조

```
packages/core/src/federation/
├── types.ts          § 2.2
├── identity.ts       § 3
├── node.ts           § 4
├── search.ts         § 5
└── index.ts          § 2.3

packages/cli/src/commands/
└── federate-cmd.ts   § 6

수정:
├── packages/core/src/index.ts          # federation export 추가
└── packages/cli/src/index.ts           # federate 커맨드 등록
```

### 2.2 타입 정의 (types.ts)

```typescript
export interface NodeIdentity {
  peerId: string;       // SHA256(publicKey).slice(0, 16)
  publicKey: Buffer;
  secretKey: Buffer;
  displayName: string;
  createdAt: string;
}

export interface PeerInfo {
  peerId: string;
  displayName: string;
  documentCount: number;
  topTopics: string[];
  joinedAt: string;
  lastSeen: string;
}

export interface FederatedSearchResult {
  title: string;
  similarity: number;
  snippet: string;       // 원문 첫 50자
  peerId: string;
  peerName: string;
}

// 메시지 프로토콜
export type FederationMessage =
  | { type: 'handshake'; peerId: string; displayName: string; version: string; documentCount: number; topTopics: string[] }
  | { type: 'search_query'; queryId: string; embedding: number[]; limit: number }
  | { type: 'search_result'; queryId: string; results: Array<{ title: string; similarity: number; snippet: string }> }
  | { type: 'leave'; peerId: string };
```

### 2.3 Public API (index.ts)

```typescript
export { getOrCreateIdentity } from './identity.js';
export { FederationNode } from './node.js';
export { FederatedSearch } from './search.js';
export type { NodeIdentity, PeerInfo, FederatedSearchResult, FederationMessage } from './types.js';
```

---

## 3. 노드 ID (identity.ts)

```
책임: Ed25519 키페어 생성, 저장, 로드
저장: ~/.stellavault/federation/identity.json
```

### 인터페이스

```typescript
getOrCreateIdentity(displayName?: string): NodeIdentity
  - identity.json 있으면 로드
  - 없으면 생성 → 저장 → 반환
  - peerId = SHA256(publicKey).hex.slice(0, 16)
```

### 파일 형식

```json
{
  "peerId": "a1b2c3d4e5f67890",
  "publicKey": "hex...",
  "secretKey": "hex...",
  "displayName": "evan-node",
  "createdAt": "2026-04-02T..."
}
```

---

## 4. P2P 노드 (node.ts)

```
책임: Hyperswarm 연결 관리 + 메시지 라우팅
의존: identity.ts
패턴: EventEmitter
```

### 클래스 설계

```typescript
class FederationNode extends EventEmitter {
  // 상태
  private swarm: Hyperswarm | null
  private peers: Map<string, { info: PeerInfo, conn: any }>
  private identity: NodeIdentity
  
  // 생성
  constructor(displayName?: string)
  
  // 라이프사이클
  async join(): Promise<void>           // Hyperswarm 참여
  async joinDirect(host: string, port: number): Promise<void>  // 수동 IP 연결
  async leave(): Promise<void>          // 종료
  
  // 조회
  get peerId(): string
  get peerCount(): number
  get isRunning(): boolean
  getPeers(): PeerInfo[]
  
  // 이벤트
  emit('peer_joined', PeerInfo)
  emit('peer_left', { peerId })
  emit('search_request', { peerId, queryId, embedding, limit, respond })
}
```

### 연결 흐름

```
join()
  1. Hyperswarm 생성 (maxPeers: 50)
  2. topic = SHA256('stellavault-federation-v1')
  3. swarm.join(topic, { server: true, client: true })
  4. discovery.flushed() 대기

swarm.on('connection', conn)
  5. 핸드셰이크 전송: { type: 'handshake', ...myInfo }
  6. conn.on('data') → handleMessage()

handleMessage(msg)
  switch msg.type:
    'handshake' → peers.set(peerId, { info, conn }) + emit('peer_joined')
    'search_query' → emit('search_request', { ..., respond: fn })
    'search_result' → (FederatedSearch가 처리)
    'leave' → peers.delete() + emit('peer_left')
```

### 수동 IP 연결 (폴백)

```typescript
async joinDirect(host: string, port: number): Promise<void>
  // Hyperswarm 없이 TCP 직접 연결
  // net.connect(port, host) → 같은 핸드셰이크 + 메시지 프로토콜
```

---

## 5. 연합 검색 (search.ts)

```
책임: 쿼리 → 임베딩 → 피어에 전송 → 결과 병합
의존: node.ts, @stellavault/core (embedder, store)
```

### 클래스 설계

```typescript
class FederatedSearch {
  constructor(
    private node: FederationNode,
    private store: VectorStore,       // 로컬 검색 응답용
    private embedder: Embedder,       // 쿼리 임베딩 생성용
  )

  // 연합 검색 (요청 측)
  async search(query: string, options?: { limit?: number; timeout?: number }): Promise<FederatedSearchResult[]>
  
  // 검색 응답 핸들러 등록 (피어 요청 수신 측)
  startResponder(): void
}
```

### search() 상세

```
1. embedding = await embedder.embed(query)          // 384차원
2. queryId = randomUUID()
3. 모든 피어에 병렬 전송:
     { type: 'search_query', queryId, embedding, limit }
4. Promise.allSettled (timeout: 5초)
5. 응답 수집:
     각 피어의 { title, similarity, snippet }
     → peerId, peerName 추가
6. 전체 결과 병합:
     similarity 내림차순 정렬
     상위 limit개 반환
```

### startResponder() 상세

```
node.on('search_request', async (req) => {
  // 받은 임베딩으로 로컬 벡터 DB 검색
  const results = await store.searchSemantic(req.embedding, req.limit);
  
  // 제목 + 유사도 + 50자 스니펫만 추출 (프라이버시)
  const safe = results.map(r => ({
    title: r.document.title,
    similarity: Math.round(r.score * 1000) / 1000,
    snippet: r.chunk.content.slice(0, 50),
  }));
  
  req.respond(safe);
});
```

---

## 6. CLI (federate-cmd.ts)

### 서브커맨드

```
sv federate join [--name <displayName>]
  → FederationNode + FederatedSearch 시작
  → 피어 발견 시 출력: "✦ Peer found: node-abc (47 docs)"
  → Ctrl+C로 종료

sv federate search <query> [--limit N]
  → 실행 중인 노드에서 연합 검색
  → 결과 출력: "🔍 node-abc: 'K8s 가이드' (87%) — Kubernetes에서..."
  → --json 지원

sv federate peers
  → 현재 연결된 피어 목록 출력

sv federate status
  → 내 노드 정보 (peerId, 연결 수, 문서 수)

sv federate leave
  → 네트워크 연결 종료
```

### join 명령어 상세

```
join은 foreground 프로세스로 실행됨 (서버처럼)
  1. identity 로드/생성
  2. store 초기화 (로컬 DB 접근 — 검색 응답용)
  3. embedder 초기화 (쿼리 임베딩용)
  4. FederationNode.join()
  5. FederatedSearch.startResponder()
  6. 이벤트 리스너: peer_joined → 콘솔 출력
  7. Ctrl+C → graceful shutdown

search는 별도 프로세스? 같은 프로세스?
  → 같은 프로세스에서 stdin으로 명령 입력
  → 또는 join 실행 중에 다른 터미널에서 search
  
결정: join이 foreground + 대화형 모드
  join 실행 후 프롬프트가 나옴:
    stellavault federation> search kubernetes
    stellavault federation> peers
    stellavault federation> leave
```

---

## 7. 메시지 프로토콜

### 직렬화

```
JSON + newline delimiter
각 메시지: JSON.stringify(msg) + '\n'
파싱: data.toString().split('\n').filter(Boolean).map(JSON.parse)
```

### 메시지 크기 제한

| 메시지 | 최대 크기 |
|--------|----------|
| handshake | ~500B |
| search_query | ~1.6KB (384 float × 4B + 메타) |
| search_result | ~2KB (5결과 × 제목+50자) |
| leave | ~50B |

### 에러 처리

```
- JSON 파싱 실패 → 무시 (malformed 메시지)
- 알 수 없는 type → 무시
- 타임아웃 (5초) → 해당 피어 결과 제외, 나머지로 응답
- 연결 끊김 → peers에서 제거 + peer_left 이벤트
```

---

## 8. 데이터 흐름도

```
     [Terminal A: sv federate join]
              │
              ├─ identity.json 로드/생성
              ├─ Hyperswarm join (topic: SHA256('stellavault-federation-v1'))
              ├─ store.initialize() (로컬 DB)
              ├─ embedder.initialize() (MiniLM)
              │
              │  ←── conn ──→  [Terminal B: sv federate join]
              │
              ├─ SEND: { type: 'handshake', peerId: 'abc', docs: 1209, topics: ['k8s','ml'] }
              ├─ RECV: { type: 'handshake', peerId: 'xyz', docs: 47, topics: ['devops'] }
              │
              │  [사용자: search "kubernetes"]
              │
              ├─ embedder.embed("kubernetes") → [0.12, -0.34, ...]
              ├─ SEND: { type: 'search_query', queryId: 'q1', embedding: [...], limit: 5 }
              │
              │  [Terminal B 수신: search_query]
              │  store.searchSemantic(embedding, 5)
              │  → results.map(r => { title, similarity, snippet: r.content.slice(0,50) })
              │  SEND: { type: 'search_result', queryId: 'q1', results: [...] }
              │
              ├─ RECV: search_result
              ├─ 결과 출력:
              │    🔍 node-xyz: "K8s 배포 가이드" (87%)
              │       Kubernetes에서 무중단 배포를 위해 Rolling Update...
```

---

## 9. 보안 고려사항

| 위협 | Phase 1a 대응 | Phase 2 대응 |
|------|-------------|-------------|
| 원문 유출 | 50자 스니펫만 전송 | Differential Privacy |
| 쿼리 추적 | 쿼리 임베딩만 전송 (원문 X) | 쿼리에도 DP 노이즈 |
| 악의적 피어 | 없음 (신뢰 환경) | Web of Trust |
| 메시지 도청 | Hyperswarm Noise 암호화 (내장) | 추가 암호화 레이어 |

---

## 10. 테스트 계획

### 10.1 수동 테스트 (Phase 1a 검증)

```bash
# 터미널 A: 첫 번째 노드
cd /path/to/vault-a
sv federate join --name "node-alpha"

# 터미널 B: 두 번째 노드 (같은 PC, 다른 vault)
cd /path/to/vault-b  
sv federate join --name "node-beta"

# 터미널 A에서:
federation> peers                    # SC1: node-beta 표시
federation> search "kubernetes"      # SC2: node-beta 결과 반환
```

### 10.2 검증 항목

| SC | 검증 | 방법 |
|----|------|------|
| SC1 | 피어 발견 | peers 명령 |
| SC2 | 연합 검색 | search 명령 + 결과 확인 |
| SC3 | 원문 비노출 | 메시지 로깅 검사 |
| SC4 | 3초 이내 | 검색 시간 측정 |
| SC5 | 오프라인 정상 | join 안 하고 sv search 실행 |

---

## 11. Implementation Guide

### 11.1 구현 순서

| # | 모듈 | 파일 | 의존성 |
|---|------|------|--------|
| M1 | 타입 + ID | types.ts, identity.ts | 없음 |
| M2 | P2P 노드 | node.ts | M1 |
| M3 | 연합 검색 | search.ts | M2 |
| M4 | CLI + 통합 | federate-cmd.ts, index.ts 수정 | M1-M3 |

### 11.2 Module Map

```
M1: types.ts + identity.ts  (기반)
 ↓
M2: node.ts                 (P2P 연결)
 ↓
M3: search.ts               (연합 검색)
 ↓
M4: federate-cmd.ts          (CLI 통합)
```

### 11.3 Session Guide

| 세션 | 모듈 | 예상 |
|------|------|------|
| Session 1 | M1 + M2 | 30분 |
| Session 2 | M3 + M4 | 40분 |
| Session 3 | 빌드 + 테스트 | 20분 |
