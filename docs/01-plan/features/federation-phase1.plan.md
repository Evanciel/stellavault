# Federation Phase 1a — 최소 연결 증명 Plan

> Feature: federation-phase1
> PRD: docs/00-pm/stellavault-federation.prd.md
> Created: 2026-04-02 | Updated: 2026-04-02 (브레인스토밍 반영)

## Executive Summary

| 관점 | 내용 |
|------|------|
| **문제** | Stellavault는 강력하지만 고립된 지식 시스템. 각 사용자의 vault는 인지적 섬 |
| **솔루션** | Hyperswarm P2P로 두 노드를 연결하여 임베딩 기반 연합 시맨틱 검색을 증명 |
| **기능/UX 효과** | `sv federate join` → 피어 발견 → `sv federate search "query"` → 피어의 검색 결과 반환 |
| **핵심 가치** | "P2P 지식 검색이 작동한다"는 기술적 증명. 원문 비공개 상태에서 의미 검색 가능 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 개인 지식의 고립 해소. AI 에이전트의 지식 접근 범위 확장. 프라이버시 보존 집단 지성 |
| **WHO** | Obsidian + MCP 사용하는 개발자 (자기 자신이 첫 번째 테스터) |
| **RISK** | Hyperswarm NAT 통과, 검색 지연, 임베딩 프라이버시 |
| **SUCCESS** | 2개 노드 연결 + 연합 검색 성공 + 원문 비노출 + 3초 내 응답 |
| **SCOPE** | Phase 1a만: P2P 연결 + 연합 검색 + CLI. UI/MCP/Notion파이프라인 제외 |

---

## 1. Phase 분할 전략

### 왜 쪼개는가

원래 Plan은 P2P + 검색 + CLI + MCP + 멀티버스 UI를 한 번에 넣었음.
브레인스토밍 결과: **핵심 가설("P2P 시맨틱 검색이 되는가")을 먼저 증명하고 나머지를 쌓아야 함.**

```
Phase 1a (이번): 연결 증명        "되는지부터 확인"
Phase 1b (다음): 파이프라인+위키   "쓰기 편하게"
Phase 1c (그다음): 멀티버스 UI     "보기 좋게"
```

| Phase | 범위 | 핵심 질문 |
|-------|------|----------|
| **1a** | P2P 연결 + 연합 검색 + CLI | Hyperswarm으로 두 노드가 연결되고 시맨틱 검색이 되는가? |
| **1b** | Notion 자동 파이프라인 + Wiki Guide + MCP도구 | 사용자가 편하게 지식을 넣고 네트워크에 공유할 수 있는가? |
| **1c** | 멀티버스 3D UI + 우주 시각화 | "내 우주 → 다른 우주" 다차원 연결이 직관적으로 보이는가? |

---

## 2. Phase 1a 요구사항 (이번 범위)

### 2.1 포함

| # | 기능 | 설명 |
|---|------|------|
| F1 | **노드 ID** | Ed25519 키페어 생성. ~/.stellavault/federation/identity.json |
| F2 | **P2P 연결** | Hyperswarm join → 피어 디스커버리 → 핸드셰이크 |
| F3 | **연합 검색** | 쿼리 임베딩 → 피어에 전송 → 피어 로컬 검색 → 결과(제목+유사도+50자스니펫) 반환 |
| F4 | **CLI** | `sv federate join`, `leave`, `status`, `peers`, `search` |

### 2.2 제외 (Phase 1b/1c+)

- 멀티버스 3D UI (Phase 1c)
- MCP federated-search 도구 (Phase 1b)
- Notion 자동 파이프라인 (Phase 1b)
- Wiki Guide (Phase 1b)
- 카탈로그 동기화 (검색만 되면 충분)
- Web of Trust, Differential Privacy, 크레딧 (Phase 2)

### 2.3 비기능 요구사항

| 항목 | 기준 |
|------|------|
| 피어 발견 | < 5초 (로컬 네트워크), < 15초 (인터넷) |
| 연합 검색 응답 | < 3초 |
| 프라이버시 | 네트워크로 나가는 것: 쿼리 임베딩 + 결과(제목+유사도+50자). 원문/전체 임베딩 절대 비전송 |
| 오프라인 | 로컬 기능 100% 유지. Federation 끄면 기존 stellavault 그대로 |
| 메모리 | Federation 모듈 < 30MB 추가 |

---

## 3. 브레인스토밍 결과

### 3.1 프라이버시 레벨 결정

**선택: 제목 + 유사도 + 50자 스니펫**

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| 임베딩 유사도만 | 최대 프라이버시 | 결과가 유용한지 판단 불가 | X |
| 제목 + 유사도 | 프라이버시 좋음 | "K8s 관련"인건 아는데 뭔 내용인지 모름 | △ |
| **제목 + 유사도 + 50자** | **맥락 파악 가능** | **프라이버시 약간 양보** | **O** |
| 제목 + 전체 스니펫 | 풍부한 정보 | 원문 노출 과다 | X |

**근거**: 50자면 "Kubernetes 무중단 배포 시 rolling update 전략과 readiness probe 설정..." 정도. 핵심 맥락은 파악되지만 전체 가이드를 재구성할 수는 없음.

### 3.2 검색 방식 결정

**선택: 실시간 피어 검색**

| 옵션 | 장점 | 단점 | 판정 |
|------|------|------|------|
| 카탈로그 다운로드 → 로컬 검색 | 빠름, 오프라인 가능 | 임베딩 전체 노출, 저장 공간 | X |
| **실시간 피어 검색** | **프라이버시 최고**, 단순 | **피어 오프라인 시 불가** | **O** |
| 중앙 인덱스 서버 | 안정적 | P2P 철학 위반, 서버 비용 | X |

**흐름:**
```
1. sv federate search "kubernetes deployment"
2. 로컬: 쿼리 → 임베딩 벡터 생성 (384차원)
3. 연결된 모든 피어에게 임베딩 전송 (병렬, 5초 타임아웃)
4. 각 피어: 자기 로컬 DB에서 cosine similarity 검색
5. 각 피어: 상위 결과의 {제목, 유사도, 50자스니펫} 반환
6. 로컬: 모든 피어 결과 병합 → 유사도 내림차순 정렬 → 출력
```

### 3.3 Notion → Obsidian 표준화 (Phase 1b 예정)

**핵심 인사이트: Notion이 "표준화 레이어" 역할을 할 수 있다**

- Notion DB 속성 → frontmatter 자동 매핑
- Notion DB 이름 → vault 폴더 결정
- Notion 태그 → stellavault 태그의 원천
- Notion 템플릿 공유 = Federation 노드 간 태그 체계 자동 통일

이건 Phase 1b에서 `packages/sync/` 확장으로 구현.

### 3.4 YAGNI 검토

Phase 1a에서 **제거한 것들과 이유:**

| 원래 포함 | 제거 이유 |
|----------|----------|
| 멀티버스 UI | 검색이 되는지도 모르는데 UI부터 만들면 안 됨 |
| MCP 도구 | CLI로 증명하고 나서 MCP는 래핑만 하면 됨 |
| 카탈로그 동기화 | 실시간 검색이면 카탈로그 불필요 |
| Notion 파이프라인 | Federation과 독립적. 별도 기능으로 더 가치 |
| 검색 크레딧 | Phase 2 이후. MVP에는 무제한 |

---

## 4. 기술 설계

### 4.1 모듈 구조 (Phase 1a 최소)

```
packages/core/src/federation/
├── index.ts          # Public API
├── identity.ts       # 노드 ID (Ed25519 키페어)
├── node.ts           # FederationNode (Hyperswarm 래퍼)
├── search.ts         # FederatedSearch (피어 검색 + 결과 병합)
└── types.ts          # 공유 타입

packages/cli/src/commands/
└── federate-cmd.ts   # sv federate 서브커맨드
```

**6개 파일.** 이게 전부입니다.

### 4.2 메시지 프로토콜 (JSON)

```typescript
// 핸드셰이크 (연결 직후)
{ type: 'handshake', peerId: string, displayName: string, 
  version: '0.1.0', documentCount: number, topTopics: string[] }

// 검색 쿼리 (요청 측 → 피어)
{ type: 'search_query', queryId: string, 
  embedding: number[],  // 384차원
  limit: number }       // 기본 5

// 검색 결과 (피어 → 요청 측)
{ type: 'search_result', queryId: string,
  results: Array<{ title: string, similarity: number, snippet: string }> }

// 연결 종료
{ type: 'leave', peerId: string }
```

**4개 메시지 타입.** 이게 전부입니다.

### 4.3 연합 검색 상세

```
FederatedSearch.search(query: string, options?)
  1. embedder.embed(query) → 384차원 벡터
  2. for each connected peer (병렬):
       peer.send({ type: 'search_query', embedding, limit: 5 })
       await response (timeout: 5초)
  3. 모든 결과 병합:
       - 유사도 내림차순 정렬
       - 중복 제거 (같은 제목)
       - 상위 N개 반환
  4. 결과 형태:
       { title, similarity, snippet, peerId, peerName }
```

### 4.4 검색 요청 수신 측 (피어가 되었을 때)

```
node.on('search_request', async (request) => {
  // 받은 임베딩으로 로컬 벡터 DB 검색
  const results = await store.searchSemantic(request.embedding, request.limit);
  
  // 결과에서 제목+유사도+50자만 추출 (원문 비전송)
  const safe = results.map(r => ({
    title: r.document.title,
    similarity: r.score,
    snippet: r.chunk.content.slice(0, 50),
  }));
  
  request.respond(safe);
});
```

---

## 5. 구현 순서

| # | 작업 | 파일 | 예상 |
|---|------|------|------|
| 1 | 타입 정의 | types.ts | 10분 |
| 2 | 노드 ID | identity.ts (이미 있음, 정리) | 10분 |
| 3 | P2P 연결 + 핸드셰이크 | node.ts (이미 있음, 정리) | 20분 |
| 4 | 연합 검색 | search.ts | 30분 |
| 5 | CLI 명령어 | federate-cmd.ts + index.ts 등록 | 20분 |
| 6 | 빌드 체크 + 테스트 | tsc --noEmit | 10분 |

**총 ~100분. 신규 4파일 + 수정 3파일.**

---

## 6. 성공 기준

| # | 기준 | 검증 |
|---|------|------|
| SC1 | 터미널 2개에서 `sv federate join` → 서로 발견됨 | `sv federate peers`에 상대 표시 |
| SC2 | `sv federate search "query"` → 피어 결과 반환 | 제목+유사도+스니펫 출력 |
| SC3 | 네트워크 메시지에 원문 없음 | JSON 메시지 감사 |
| SC4 | 응답 3초 이내 | 타이머 측정 |
| SC5 | Federation 끄면 기존 stellavault 정상 | `sv search` 단독 작동 |

---

## 7. 리스크

| 리스크 | 대응 |
|--------|------|
| Hyperswarm NAT 통과 실패 | 같은 네트워크에서 먼저 테스트. 실패 시 릴레이 고려 |
| 피어 오프라인 | 5초 타임아웃 + 부분 결과 반환 + "N개 피어 중 M개 응답" 표시 |
| 50자 스니펫으로 원문 추론 | Phase 2에서 Differential Privacy 적용 |

---

## 8. Phase 1b/1c 예고

### Phase 1b: 파이프라인 + 위키
- Notion DB → vault 자동 매핑 (packages/sync/ 확장)
- Wiki Guide (vault 구조, 태그 체계, Notion 설정 가이드)
- MCP `federated-search` 도구
- `sv federate search --json` 지원

### Phase 1c: 멀티버스 UI
- MultiverseView.tsx — "My Universe" 대형 구체 + 피어 우주들
- 클릭으로 내 vault 진입, ← Multiverse로 복귀
- 피어 우주 크기=문서 수, 색상=건강도
- graph-store에 viewMode: 'universe' | 'multiverse' 추가

---

## 브레인스토밍 로그

| 결정 | 선택 | 근거 |
|------|------|------|
| 프라이버시 레벨 | 제목+유사도+50자 | 맥락 파악 가능 + 원문 재구성 불가 |
| 스니펫 방식 | 원문 첫 50자 | 실용성 우선. Phase 2에서 DP 노이즈 적용 |
| 검색 방식 | 실시간 피어 검색 | 프라이버시 최고, 카탈로그 불필요 |
| 연결 실패 | 타임아웃 15초 + 수동 IP 폴백 | Phase 1a는 로컬 테스트. 수동 IP는 디버깅용 |
| Phase 분할 | 1a/1b/1c 3단계 | 핵심 가설 먼저 증명 |
| 아키텍처 | Option C (실용적 균형) | 파일별 책임 명확 + 과설계 안 함 |
| 메시지 포맷 | JSON | Phase 1 MVP에 충분, 디버깅 쉬움 |
| Notion 표준화 | Phase 1b로 분리 | Federation과 독립적 가치 |
| 멀티버스 UI | Phase 1c로 분리 | 검색 증명 후 UI |
