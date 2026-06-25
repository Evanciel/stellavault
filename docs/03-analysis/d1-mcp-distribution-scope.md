# D1 — MCP-as-distribution 스코프 (2026-06-25, 울트라코드 wf_040ba793)

> 사용자 요청 = "먼저 스코핑(코드 산출물 파악)". 본 문서는 D1을 **실제 코드/설정 산출물** vs **순수 GTM**으로 분리한 스코프 + 권고. 구현은 별도 승인 후.

## 전략 통찰 (리서치)
**공식 MCP 레지스트리(`server.json` + `mcpName`)가 upstream 피드** — Glama·PulseMCP·mcp.so가 이를 크롤. 이 한 레코드만 깨끗이 만들면 다운스트림 리스팅이 대부분 자동 흐름. → `server.json` + `mcpName`이 단일 최고 레버리지.

## A. 코드/설정 산출물 (in-repo, 빌드 가능)

| 산출물 | 파일 | 노력 | 가치 |
|---|---|---|---|
| **`mcpName` + 키워드 확장** | `package.json` (name 근처 `mcpName: "io.github.Evanciel/stellavault"` · keywords) | S | **high** |
| **`server.json`** (공식 레지스트리 매니페스트) | `/server.json` (신규) | S | **high** |
| **`glama.json`** (Glama 소유권 클레임) | `/glama.json` (신규) | S | **high** |
| **`smithery.yaml`** (stdio-claim) | `/smithery.yaml` (신규) | S | med |
| MCP-first README 리프레임 | `README.md` (상단 quickstart·deeplink 배지·nav 재정렬·copy-paste JSON) | M | med |
| 5-클라이언트 setup 스모크 | `tests/smoke.mjs` (현재 cursor만) | M | med (정확성, 발견성 아님) |
| CI publish 워크플로우 | `.github/workflows/mcp-registry-publish.yml` (OIDC) | M | med (GTM 자동화) |

### 핵심 스키마 (server.json — 리서치 인용)
- `$schema`: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` (⚠ PREVIEW — 구현 시 **라이브 스키마 재확인**)
- `name` = `io.github.Evanciel/stellavault` (== `mcpName`, GitHub 로그인 무료 소유권 검증)
- `description`, `repository{url, source:'github'}`, `version` (== package.json, lockstep 필수)
- `packages: [{ registryType:'npm', identifier:'stellavault', version:'0.8.4', transport:{type:'stdio'} }]` — 기존 `stellavault serve`(mcp-clients.ts:55-59)와 1:1

## B. 순수 GTM (코드 아님)
- `mcp-publisher init/login github/publish` 1회(서버.json 라이브 게시, 휴먼리뷰 큐 없음, GitHub 로그인 소유권)
- Glama/Smithery/PulseMCP/mcp.so 리스팅 클레임·설명 수정
- punkpeye/awesome-mcp-servers PR (**Glama 리스팅 선행 게이트**)
- GitHub repo Topics/About 설정
- 런치 포스트(r/mcp·r/ClaudeAI·r/ObsidianMD·HN·X)
- (리스팅 라이브 후) install-count 배지 배선

## 정직성 플래그
- `files[]`에 매니페스트 추가 ≈ 무가치 (레포 루트 = GitHub raw로 읽힘, npm tarball 아님)
- install-count 배지 = GTM 게이트(리스팅 라이브 전 렌더 불가) → 정적 레지스트리/deeplink 배지만 선행
- CI publish 워크플로우·Smithery hosted = "config로 위장한 GTM/리팩터" → 발견성 직접 향상 아님

## 권고
**BUILD NOW (~반나절, S, 엔지니어링 리스크 0):** `mcpName`+키워드 · `server.json` · `glama.json` · `smithery.yaml`(stdio-claim). 4개 전부 기존 stdio `serve`와 1:1 매핑 순수 config 작성. 유일 주의 = PREVIEW 스키마 신선도(라이브 fetch 후 작성).
**BUILD NEXT:** README MCP-first 리프레임(M).
**DEFER:** 5-클라이언트 스모크·CI publish·Smithery hosted.

## 리스크
- 레지스트리 PREVIEW → 스키마/CLI 플래그 변동 가능, 구현 시 재검증
- 버전 lockstep: server.json `version`/`packages[].version` == package.json, npm 게시가 레지스트리 레코드보다 선행
- mcpName namespace = `io.github.Evanciel/*` 고정(브랜드 네임스페이스는 DNS/.well-known 의존 → 범위 외)
- 검증 필요 갭: npx cold-cache `serve` 핸드셰이크 지연 · repo Topics 설정 여부 · resolveServeCommand global-only 가정(mcp-clients.ts:53-60)이 server.json runtime_hint와 호환되는지
