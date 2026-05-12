# Federation Security v2 — Ed25519 + 서명된 Protocol

> Feature: federation-security-v2
> PRD: docs/00-pm/stellavault-federation.prd.md
> 선행 Plan: docs/01-plan/features/federation-phase1.plan.md
> Trigger: 2026-05-12 Codex 평가 SECURITY 3/10
> Status: Draft — 검토/확정 필요

## Executive Summary

| 관점 | 내용 |
|------|------|
| **문제** | 현재 "federation crypto"는 가짜 PKI. `publicKey = sha256(secretKey)`라 검증자가 서명자의 secret을 알아야 함. 게다가 protocol 자체가 서명을 안 씀 — 핸드셰이크/leave/search 메시지 모두 unsigned JSON. peerId 위변조, 검색 결과 위변조, 노드 사칭이 전부 가능 |
| **솔루션** | (a) identity를 Ed25519 (X25519는 옵션) 비대칭 키로 교체, (b) 모든 wire-level 메시지에 detached signature 첨부, (c) handshake 시 challenge-response로 peerId↔publicKey 바인딩 증명 |
| **Breaking change** | 기존 identity 파일 `~/.stellavault/federation/identity.json` 포맷 변경, peerId 계산 방식 변경, wire format 변경 → **v0.x federation 노드와 호환 불가**. 단, federation 자체가 사용자 0인 실험 기능이라 마이그레이션 비용 사실상 0 |
| **SCOPE** | identity, sign/verify, node protocol (handshake + 각 메시지) 까지. trust/reputation/credits/sharing 모듈은 다음 phase |

---

## 1. Codex가 지적한 4가지 (전부 이 plan 안에서 해결)

| # | 위치 | 현재 상태 | 목표 |
|---|------|----------|------|
| 1 | `identity.ts:33-35` `publicKey = sha256(secretKey)` | "publicKey"가 secret의 단순 해시 | Ed25519로 진짜 publicKey 도출 |
| 2 | `identity.ts:60-75` `verifySignature(pk, **sk**, msg, sig)` | 검증에 secretKey 필요 (HMAC) | `verifySignature(publicKey, message, signature)` — secretKey 안 받음 |
| 3 | `node.ts:122-131` handshake | peerId/displayName 위변조 가능 | publicKey 첨부 + challenge-response로 binding 증명 |
| 4 | `node.ts:252-256` `sendMessage` | raw JSON, 무서명 | 모든 메시지에 detached Ed25519 signature |

---

## 2. 설계 결정

### 2.1 알고리즘: **Ed25519 (libsodium / `node:crypto`)**

- Node 16+ `crypto.generateKeyPairSync('ed25519')` 가 표준. 외부 의존성 0.
- 키 32B, 서명 64B → JSON.stringify hex로 직렬화 시 메시지당 ~130B 오버헤드. 검색/heartbeat 무시 가능.
- Why not RSA: 키/서명 크기 10배 이상.
- Why not HMAC keep: 검증자가 secret을 알아야 하는 모순이 federation의 정의 자체와 충돌.

### 2.2 peerId 계산
- 기존: `sha256(publicKey).slice(0, 16)` — publicKey가 가짜였을 뿐 알고리즘은 OK
- 새: `sha256(ed25519PublicKey).slice(0, 16)` — 32B public key의 첫 16 hex char
- peerId↔publicKey가 **공개적으로** 일대일이라 검증 가능

### 2.3 Identity 파일 포맷 v2

```json
{
  "version": 2,
  "algorithm": "ed25519",
  "peerId": "abc123...",          // 16 hex
  "publicKey": "<32B hex>",
  "secretKey": "<32B hex, mode 0o600>",
  "displayName": "node-abc123",
  "createdAt": "2026-05-12T..."
}
```

v1 (`version` 필드 없음 또는 알고리즘 = HMAC) 감지 시:
- 사용자에게 1회 경고 + 자동 백업 (`identity.v1.bak.json`)
- 새 v2 키쌍 발급 → 다른 노드와 페어링 다시 필요 (federation 사용자 0이라 영향 없음)

### 2.4 Wire Protocol v2 — signed envelope

```ts
interface SignedEnvelope<T> {
  payload: T;                  // 원래 메시지 본체
  peerId: string;              // 첫 메시지에서 publicKey도 함께 보냄
  signature: string;           // ed25519(secretKey, JSON.stringify(payload))
}
```

- payload는 canonical JSON 직렬화 후 서명 (key 순서 고정)
- 첫 핸드셰이크에서만 `publicKey` 전체 첨부, 이후 메시지에서는 peerId만 (수신자가 peerId→publicKey 캐시)
- 서명 실패 메시지 → 즉시 드롭 + 로그. 연결 끊지는 않음 (DoS 방지)

### 2.5 Handshake — challenge-response binding

```
A → B:  HELLO { peerId_A, publicKey_A, displayName, version }
        + signature_A(payload)

B 검증: hash(publicKey_A).slice(0,16) === peerId_A ?
        verifySignature(publicKey_A, payload, signature) ?
        → 둘 다 OK면 challenge 전송

B → A:  CHALLENGE { nonce_B (32B random) }
        + signature_B(payload)
        + publicKey_B + peerId_B

A → B:  CHALLENGE_RESPONSE { sign(secretKey_A, nonce_B) }
        + signature_A(payload)

B 검증: verifySignature(publicKey_A, nonce_B, response) ?
        → OK면 A는 진짜 publicKey_A의 소유자 → peer로 등록
```

이게 끝나면 양쪽 모두 상대의 peerId↔publicKey가 진짜인지 확신함. 이후 sendMessage는 single-signature only.

---

## 3. 변경 범위 (file: line)

| 파일 | 변경 |
|------|------|
| `packages/core/src/federation/identity.ts` | 전면 재작성 — keypair generation, sign/verify, identity file v1→v2 마이그레이션 |
| `packages/core/src/federation/types.ts` | `SignedEnvelope<T>`, `Challenge`, `ChallengeResponse` 메시지 타입 추가 |
| `packages/core/src/federation/node.ts:122-258` | `handleConnection`에 challenge-response state machine 추가. `sendMessage`가 자동으로 서명. 수신 시 자동으로 검증. peerId 캐시 도입 |
| `packages/core/src/federation/index.ts` | 필요 시 export 정리 |
| `packages/core/tests/federation-identity.test.ts` (신규) | Ed25519 sign/verify, 위변조 거부, v1 마이그레이션 |
| `packages/core/tests/federation-protocol.test.ts` (신규) | handshake 4-step, signature 검증 실패 시 드롭, replay 방지 |
| `~/.stellavault/federation/identity.json` | runtime 마이그레이션 (사용자 vault 영향 없음) |

---

## 4. 작업 분할 (Sprint)

| Step | 작업 | 추정 시간 |
|------|------|-----------|
| 1 | `identity.ts` Ed25519 재작성 + v1 마이그레이션 + 테스트 | 45m |
| 2 | `types.ts`에 `SignedEnvelope<T>` + challenge 타입 | 10m |
| 3 | `node.ts` outbound: sendMessage가 서명 자동 첨부 | 20m |
| 4 | `node.ts` inbound: 서명 검증 + drop unsigned + peerId 캐시 | 30m |
| 5 | `node.ts` handshake → challenge-response 4-step | 45m |
| 6 | replay 방지: nonce 사용 추적 (최근 N개 LRU) | 20m |
| 7 | `federation-protocol.test.ts` — 위변조/replay 시나리오 | 30m |
| 8 | smoke 통과 + manual 2-node 테스트 | 30m |
| **합계** | | **~4시간** |

---

## 5. Acceptance Criteria

- [ ] `identity.ts`의 `verifySignature(publicKey, message, signature)` 시그니처 — secretKey **인자 없음**
- [ ] v1 identity 파일이 자동으로 v2로 마이그레이션 (백업 후 재발급)
- [ ] handshake 4-step이 RTT 1회 내 완료 (HELLO+CHALLENGE 한 쌍, RESPONSE 한 쌍 — 실제로는 2 RTT)
- [ ] 위변조된 peerId(=publicKey 해시 불일치)는 handshake 직후 거부
- [ ] 다른 노드 keypair로 서명한 메시지는 수신자가 즉시 드롭 + 카운터 증가
- [ ] 같은 nonce 재사용 시 replay 거부
- [ ] tsc clean, smoke 11/11 유지, federation 신규 테스트 추가분 전부 PASS
- [ ] Codex가 지적한 `identity.ts:33-35, 60-75`와 `node.ts:122-131, 252-256` 라인이 새 구조로 교체됨

---

## 6. Out of scope (다음 plan)

- `trust.ts` / `reputation.ts` / `credits.ts` 의 평판/포인트 — 신원이 진짜 되어야 의미 있는데 이 plan은 신원만
- `sharing.ts` / `privacy.ts` 의 embedding-only sharing + differential privacy — 별개 위협 모델
- 키 회전(rotation) / 키 폐기 목록(revocation) — federation 사용자 ≥10명 되면 다시 평가
- onion / mixnet 같은 메타데이터 보호 — 같은 시점 평가

---

## 7. Risk

| Risk | 완화 |
|------|------|
| Ed25519를 안 쓰는 OSS 호환 노드와 못 붙음 | 사용자 0이라 OK. v2가 첫 사용자 기준이 됨 |
| canonical JSON 직렬화가 양쪽에서 다르면 서명 검증 실패 | `JSON.stringify`를 양쪽 동일 구현으로 강제 (sort keys 옵션 명시) |
| node.ts state machine이 기존 buffer 파싱과 충돌 | Step 5 작업 시 명시적 fsm 도입 (idle → awaiting_challenge → awaiting_response → ready) |
| HMAC 잔재 호출이 다른 곳에 있을 가능성 | grep 결과 identity.ts 외 0건이지만 step 1에서 한 번 더 확인 |

---

## 8. Open Questions (구현 시작 전 확정)

1. **알고리즘 final**: Ed25519 OK? 또는 X25519 키도 만들어서 향후 e2ee까지 대비?
   → 권장: **Ed25519만**. e2ee는 plan 밖.
2. **identity v1 발견 시 동작**: 자동 마이그레이션 (백업+재발급) vs CLI에서 사용자가 명시 동의?
   → 권장: **자동**. 사용자 0이라 의식 안 함.
3. **Wire format**: line-delimited JSON 유지 vs MessagePack/CBOR?
   → 권장: **JSON 유지** (이번 plan은 보안만, format 변경은 별개).
4. **replay window**: 최근 nonce 몇 개 기억할지? LRU 1000개?
   → 권장: **LRU 1000개** (메모리 32KB, 충분).
