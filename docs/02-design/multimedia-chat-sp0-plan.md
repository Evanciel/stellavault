# 멀티미디어 채팅 SP0 (선결 보안 인프라) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** SP1-3의 전제인 보안 인프라 — SSRF-하드닝 outbound fetcher, 미디어 path-safety, CSP media-src 잠금 — 를 갖춰 멀티미디어/링크 기능이 안전하게 올라갈 토대를 만든다.

**Architecture:** core의 string-only `assertNotPrivateUrl`을 **resolve-then-check-IP**(DNS 조회 후 실제 IP 검사, async)로 하드닝하고 기존 호출처(ingest)를 await로 조율한다. desktop main에 그 검사를 쓰는 `outbound-fetch.ts`(electron net.request + 리다이렉트 매 홉 재검증 + size/timeout/content-type 캡)를 신설한다. path-safety에 `assertInsideDir` + `ALLOWED_MEDIA_EXT` + 매직바이트를 추가하고, renderer CSP에 `media-src 'self' app: blob:`을 추가(원격 origin 금지) + 회귀 테스트로 향후 약화 PR을 CI 차단한다.

**Tech Stack:** node `dns/promises`, electron `net.request`, vitest. SDK-less(전부 표준/electron).

**Scope:** SP0만. SP1(채팅 토대)~SP3(멀티모달)은 SP0 완료 후 다음 사이클. 브랜치 `feat/multimedia-chat`.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/core/src/api/ssrf-guard.ts` | resolve-then-check-IP 순수 가드(테스트 가능) | **신규** |
| `packages/core/src/api/server.ts` | `assertNotPrivateUrl`을 신규 가드로 교체(async) | 수정 |
| `packages/core/src/api/routes/ingest.ts` | 호출처 await 조율(L60·250) | 수정 |
| `packages/core/test/ssrf-guard.test.ts` | SSRF 회귀(rebinding/인코딩/IPv6/리다이렉트) | **신규** |
| `packages/desktop/src/main/outbound-fetch.ts` | electron net.request + 매 홉 IP 재검증 + 캡 | **신규** |
| `packages/desktop/tests/outbound-fetch.test.ts` | 리다이렉트→사설 거부, 캡 | **신규** |
| `packages/desktop/src/main/path-safety.ts` | `assertInsideDir` 추출 + `ALLOWED_MEDIA_EXT` + 매직바이트 + `.svg` 미디어 제외 | 수정 |
| `packages/desktop/tests/path-safety.test.ts`(또는 기존) | 미디어 확장자/매직바이트/traversal | 수정 |
| `packages/desktop/src/renderer/index.html` | CSP `media-src 'self' app: blob:` | 수정 |
| `packages/desktop/tests/csp.test.ts` | media-src 존재 + 원격 origin 미포함 | **신규** |

---

## Task 1: core SSRF 가드 하드닝 (resolve-then-check-IP)

**Files:** Create `packages/core/src/api/ssrf-guard.ts` + `test/ssrf-guard.test.ts`; Modify `server.ts:109`(교체), `routes/ingest.ts:60,250`(await).

- [ ] **Step 1: 실패 테스트** (`ssrf-guard.test.ts`) — `assertPublicUrl(url)`(async)가 다음을 **거부**: `http://localhost`, `http://127.0.0.1`, `http://127.0.0.1.nip.io`(rebinding: DNS가 사설 IP 반환), `http://0x7f.0.0.1`/`http://2130706433`(hex/decimal 인코딩), `http://[::1]`/`http://[::ffff:127.0.0.1]`(IPv6/매핑), `http://169.254.169.254`(메타데이터), `http://10.0.0.1`, `ftp://x`(비-http). **허용**: `https://example.com`. DNS는 주입 가능한 resolver로 모킹(rebinding 케이스는 resolver가 사설 IP 반환하게).
- [ ] **Step 2:** 실패 확인 (`npm run test --workspace=@stellavault/core -- ssrf-guard`).
- [ ] **Step 3: 구현** — `ssrf-guard.ts`: `export async function assertPublicUrl(url, resolver=dns.lookup all)`. ① URL 파싱 + http/https만 ② hostname이 IP 리터럴이면 그대로, 도메인이면 `dns.lookup(host,{all:true})`로 **모든** A/AAAA 조회 ③ 각 IP를 정규화(decimal/hex/IPv6 매핑 → canonical)하고 `isPrivateIp(ip)`(loopback 127/8·::1, RFC1918 10/8·172.16-31·192.168, link-local 169.254/16·fe80::/10, ULA fc00::/7, 0.0.0.0, 매핑 ::ffff:) 검사 ④ 하나라도 사설이면 throw. `isPrivateIp`는 순수 함수로 분리(직접 테스트).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5: server.ts 교체 + ingest await** — `server.ts`의 `assertNotPrivateUrl`을 `assertPublicUrl` 재노출로 교체(주입 시그니처를 async로); `ingest.ts:60·250`을 `await assertPublicUrl(...)`로. tsc 0 + core 테스트 통과.
- [ ] **Step 6: 커밋** — `git commit -m "security(core): resolve-then-check-IP SSRF guard (rebinding/encoding/IPv6)"`.

## Task 2: desktop outbound-fetch (매 홉 재검증 + 캡)

**Files:** Create `packages/desktop/src/main/outbound-fetch.ts` + `tests/outbound-fetch.test.ts`.

- [ ] **Step 1: 실패 테스트** — `safeFetch(url, {maxBytes, timeoutMs, allowedContentTypes})`: ① 시작 URL `assertPublicUrl` 통과 ② 리다이렉트 응답(3xx Location) 매 홉 `assertPublicUrl` 재검증(사설로 리다이렉트→거부), `maxRedirects≤2` 초과→거부 ③ `content-length`/누적 바이트 > maxBytes→abort ④ timeout→abort ⑤ content-type 화이트리스트 외→거부. electron `net.request` 모킹.
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현** — `outbound-fetch.ts`: electron `net.request`로 수동 리다이렉트(`redirect:'manual'`), 매 홉 `assertPublicUrl`, 바이트 누적 캡+`req.abort()`, `setTimeout` idle, content-type 검사. 반환 `{buffer, contentType, finalUrl}`.
- [ ] **Step 4:** 통과 확인 (`npm run test --workspace=@stellavault/desktop -- outbound-fetch`).
- [ ] **Step 5: 커밋** — `"feat(desktop): SSRF-hardened outbound-fetch (per-hop revalidation + caps)"`.

## Task 3: path-safety 미디어 확장 (assertInsideDir + 매직바이트)

**Files:** Modify `main/path-safety.ts`; Test `tests/path-safety.test.ts`(기존 보강).

- [ ] **Step 1: 실패 테스트** — ① `assertInsideDir(root, p)`: root 밖 `..`/절대경로 throw, root 내 허용(assertInsideVault를 이걸로 재구현해도 기존 테스트 통과) ② `ALLOWED_MEDIA_EXT`에 `.mp3/.m4a/.wav/.ogg/.webm/.mp4/.mov` 포함, `.svg` **제외**(미디어/직접-open 금지) ③ `sniffMediaType(bytes)`: PNG(89 50 4E 47)/JPEG(FF D8 FF)/MP4(ftyp)/WebM(1A 45 DF A3) 매직바이트 인식, 확장자-내용 불일치 거부.
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현** — `assertInsideDir(root,p)` 일반화 추출 후 `assertInsideVault`는 `assertInsideDir(vaultPath, filePath)` 위임. `ALLOWED_MEDIA_EXT` Set + `sniffMediaType` 매직바이트 맵 + `assertMediaMatches(ext, bytes)`.
- [ ] **Step 4:** 통과 확인 + 기존 path-safety 테스트 회귀 없음.
- [ ] **Step 5: 커밋** — `"feat(desktop): assertInsideDir + ALLOWED_MEDIA_EXT + magic-byte sniff"`.

## Task 4: CSP media-src 잠금 + 회귀 테스트

**Files:** Modify `renderer/index.html`(CSP meta); Create `tests/csp.test.ts`.

- [ ] **Step 1: 실패 테스트** — `csp.test.ts`: `index.html`을 읽어 CSP 파싱 → ① `media-src`에 `'self' app: blob:` 포함 ② `img-src`/`media-src`/`connect-src` 어디에도 `http://`/`https://` 원격 origin 미포함(향후 "https 이미지 허용" PR을 CI 차단). 
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3: 구현** — `index.html` CSP meta에 `media-src 'self' app: blob:` 추가(기존 default-src/img-src/script-src 유지, 원격 origin 추가 금지).
- [ ] **Step 4:** 통과 확인.
- [ ] **Step 5: 커밋** — `"security(desktop): CSP media-src lock + regression test"`.

## Task 5: 통합 검증 + 호출처 조율 확인

- [ ] **Step 1:** `npx tsc --noEmit -p packages/desktop/tsconfig.json` → 0; core tsc → 0
- [ ] **Step 2:** core vitest + desktop vitest + `node tests/smoke.mjs` → 전부 PASS
- [ ] **Step 3:** **SSRF 회귀 단언** 확인(rebinding/decimal·hex/IPv6/리다이렉트→사설 거부), **CSP 회귀** 확인
- [ ] **Step 4:** `assertPublicUrl` 호출처 전수 확인 — `core/api/routes/ingest.ts`(L60·250 await됨), second-brain `engine.ts`(SSRF P2 연기 표면이 이제 가드 사용하도록 메모/조율). 누락 호출처 없음 grep 확인
- [ ] **Step 5:** 최종 커밋 — SP0 완료

## Notes
- core 가드는 **async**(DNS resolve 필요) — 호출처 await 전환이 핵심(sync→async breaking, ingest 2곳 + server 주입 시그니처).
- `.svg`는 미디어/직접-open에서 제외(스크립트 임베드 위험). 이미지 첨부의 svg 허용 여부는 SP2에서 sanitize와 함께 재검토.
- 다음 사이클: SP1(chat-engine SSE + 멀티턴 + 채팅 UI + 세션store), 이후 SP2/SP3.
