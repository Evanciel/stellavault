# claude-obsidian vs Stellavault — 비교 분석

> 2026-08-25. 대상: [AgriciDaniel/claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) (v2.1.0) vs Stellavault v0.9.0 / desktop-v0.5.0.
> 조사 방법: GitHub UI/API/raw 소스 웹 페치 (클론 없음). 수치는 2026-08-25 기준.

## 0. 한 줄 요약

**같은 Karpathy "LLM 위키" 패러다임을 정반대 아키텍처로 구현한 직접 경쟁자.** claude-obsidian은 *Claude Code 위에 얹는 스킬/프롬프트 레이어 + 견고한 Python 트랜잭션 코어*(자체 LLM·UI·서버 없음)이고, Stellavault는 *자체 MCP 서버 + CLI + Electron 앱 + 로컬 LLM 에이전트*를 가진 독립 제품이다. 저쪽의 해자는 **쓰기 안전성(트랜잭션 엔진)과 출처 레저(provenance)**, 우리의 해자는 **시맨틱 검색·FSRS 감쇠·앱 UI·로컬 LLM 에이전트·한국어·Windows 네이티브**다.

## 1. 정체성

| | claude-obsidian | Stellavault |
|---|---|---|
| 형태 | Claude Code **플러그인** (15 스킬 + 2 훅 + 3 서브에이전트) | **MCP 서버**(21툴) + CLI(39+) + **Electron 앱** + 3D 그래프 |
| LLM | 없음 — 사용자의 Claude Code 세션에 탑승 | 로컬 Ollama(gemma4) 기본 + Anthropic/OpenAI/ChatGPT-OAuth 선택 |
| UI | 없음 — Obsidian은 순수 뷰어, 조작은 터미널 | 데스크탑 앱(에디터·채팅·그래프·설정), PWA/Publish |
| 스택 | Python 3.11+ / Bash | Node 20+ / TypeScript / ESM 모노레포 |
| 배포 | git clone + `--plugin-dir` (PyPI/npm 미게시) | npm `stellavault`, 공식 MCP 레지스트리, GH 릴리스(Win/Linux) |
| 라이선스 | MIT | (우리 리포 라이선스) |

**성숙도**: ★12,145 / fork 1,353, 2026-04-07 생성(약 4.5개월), 릴리스 9회, 사실상 1인 개발(231커밋 + claude 봇 12커밋), 마지막 푸시 2026-08-01. **4.5개월에 12k 스타는 매우 빠른 성장 — 위협으로 간주해야 할 트랙션.**

## 2. 축별 비교

### 2.1 검색/리트리벌 — **Stellavault 우위**
- 저쪽: **로컬 BM25**(표준 라이브러리, `.vault-meta/` 일회용 인덱스) + 문단 청킹 + 페이지 프리픽스. 코사인 리랭크는 **옵션**(Ollama + nomic-embed ~1GB 별도 설치). 벡터 DB 없음. 임베딩 실패 시 BM25 순서로 폴백.
- 우리: **시맨틱(다국어 임베더, API 키 0) + BM25 + 엔티티 3-way 가중 RRF** + FSRS retrievability 후처리 + entityAliases + fuzzy 엔티티. sqlite-vec 영구 인덱스, 증분 인덱싱. **설치 즉시 시맨틱이 기본** — 저쪽은 기본이 순수 BM25라 교차언어·유사어 리콜에서 구조적으로 밀린다(한국어 질의→영문 노트 매칭은 임베딩 없이는 불가).
- 단, 저쪽의 "인덱스는 언제든 버려도 되는 런타임 상태" 설계는 손상 복구가 단순하다는 장점.

### 2.2 볼트 쓰기 안전성 — **claude-obsidian 우위 (이 리포의 최대 자산)**
`transaction.py`(~2000줄)는 "AI가 노트에 쓴다" 부류를 훨씬 넘는 프로덕션급 파일시스템 트랜잭션 엔진:
- 읽기 시점 **SHA-256 프리컨디션 해시** → 드래프트 번들 → **사람이 플랜 검사** → 원자 적용 → 오퍼레이션 ID. 도중 파일이 바뀌면 덮어쓰지 않고 **충돌로 승격**(`FILE_CHANGED_DURING_READ`, exit 75).
- fcntl 볼트 락 + stale 감지, `.vault-meta/transactions` 저널, 파일별 백업, 디렉토리 FD + `os.replace()` 원자 스왑, 결정적 크래시 복구(`transaction recover`).
- 경로 안전: 심링크 거부, `O_NOFOLLOW`/`O_DIRECTORY`로 TOCTOU 방어, NFC 정규화, casefold 충돌 감지, Windows 예약이름 차단, **inode 피닝**(플랜 승인↔실행 사이 볼트 루트 스왑 감지), 예약 경로 쓰기 금지.
- `init`/`adopt`는 **dry-run-first**: JSON 플랜의 SHA-256을 승인해야 적용.

우리의 대응물(guardedWrite 사이드카 충돌감지, confirmWrites 게이트, 원자쓰기 일부)은 존재하지만 이 수준의 저널/복구/inode-피닝은 없다. **흡수 후보 1순위.**

### 2.3 출처/근거(provenance) — **claude-obsidian 우위**
- 버전드 JSON 스키마의 **source ledger + claim ledger**: 출처 해시·권위 수준·리뷰 상태·갱신 주기·독립성 키, 주장별 위험도·**지지/반박 증거 링크**·신뢰도. "고위험 주장은 독립 출처 2개 필요, 반박 증거는 계속 보이게 유지, 지어낸 인용보다 근거 있는 거절을 선호."
- 우리: 인용은 [[위키링크]] + 검색 스니펫 수준. 결정저널/ADR은 있으나 주장 단위 증거 추적은 없음. **Wiki Synthesis에 접목할 흡수 후보 2순위.**

### 2.4 메모리/지식 생명주기 — **Stellavault 우위**
- 저쪽: SessionStart 컨텍스트 주입 + `wiki-fold`(작업 로그의 추출적 롤업, "DragonScale"). 감쇠·복습 개념 없음.
- 우리: **FSRS 감쇠 + Again/Hard/Good/Easy 채점 + learning_path + detect_gaps + 프로액티브 출하(넛지/칩)**. "잊혀가는 지식을 다시 밀어주는" pull→push 루프는 저쪽에 구조적으로 없다(LLM 세션에 탑승하는 형태라 데몬이 없음).

### 2.5 에이전트/자동화 — 구조가 다름 (엇갈린 우위)
- 저쪽: 에이전트 = **호스트의 것**(Claude Code가 곧 에이전트). 스킬 3개 서브에이전트(verifier/wiki-ingest/wiki-lint). 다중 호스트 포터빌리티(AGENTS.md·GEMINI.md·.cursor/.windsurf rules — Codex/Gemini/Cursor/Windsurf에서도 동작 주장). **호스트 LLM 성능 = 프런티어 모델이라 지능 상한이 높다.**
- 우리: **인프로세스 에이전트 루프**(plan→act, 툴 자가복구, deny-with-reason, steer, 확인게이트, 스킬 인보크) — LLM이 로컬 gemma4여도 돌고, 프런티어 전환도 됨(#14). 앱 안에서 완결.
- 함의: 저쪽은 "Claude Code 구독자"가 전제, 우리는 **구독 없이도**($0 로컬) 동작. 반대로 저쪽은 프런티어 지능이 기본값.

### 2.6 미디어/인제스트
- 저쪽: 이미지/PDF/EPUB은 **메타데이터-온리**(해시·크기, 의미 추출 없음), URL/YouTube/OCR은 사용자 구성 "external runner" 필요. 경계를 README에 정직하게 명시.
- 우리: URL/클립/미디어 인제스트 파이프라인 + SSRF 가드 + 매직바이트 검증, Notion↔Obsidian 동기화(별도 데몬). 멀티모달은 SP2/SP3 예정.

### 2.7 플랫폼 — **Stellavault 우위**
- 저쪽: **네이티브 Windows는 읽기 전용**(`ERR UNSUPPORTED_PLATFORM`), 쓰기는 WSL 필수. 한국어 등 i18n 없음.
- 우리: Windows 네이티브 완전 지원(주 개발 환경), 한국어 i18n 453키, 다국어 임베더.

### 2.8 릴리스 엔지니어링 — claude-obsidian 우위 (소소하지만 배울 것)
바이트 재현 가능한 zip + `release audit` + SHA256SUMS + RELEASE_MANIFEST.json + CI 재현성 검증. 1인 프로젝트치고 이례적으로 꼼꼼. 우리 릴리스는 서명/재현성 검증이 아직 없음.

## 3. 위협 평가

- **직접 경쟁 맞음**: 같은 페러다임(Karpathy LLM 위키), 같은 비파괴 원칙("볼트는 평범한 Markdown 디렉토리"), 같은 로컬-퍼스트 수사. 스타 성장 속도(4.5개월 12k)는 우리보다 훨씬 빠르다 — "Claude Code 사용자"라는 이미 뜨거운 유통 채널에 올라탄 덕.
- **그러나 비치헤드가 다르다**: 저쪽의 사용자는 *이미 Claude Code를 쓰는 개발자*다. 터미널 없이는 아무것도 못 하고, Windows 쓰기도 안 된다. 우리의 비치헤드(일반 유저, 앱 더블클릭, 한국어)와 겹치는 면적은 생각보다 작다.
- **단일 실패점**: 1인 개발 + Claude Code 플러그인 API에 전면 의존(훅/스킬 스펙 변경 리스크) + LLM 없음(호스트 구독 필수). 우리는 독립 실행형.
- **주의 신호**: 마지막 푸시 2026-08-01 이후 잠잠(약 3주). 유지 동력 관찰 필요.

## 4. 흡수 후보 (우선순위)

1. **프리컨디션 해시 + 충돌 승격** — guardedWrite/에이전트 쓰기에 "읽은 시점 해시 → 적용 시점 검증 → 다르면 충돌" 도입. 구현 작고 효과 큼.
2. **claim/source 레저 라이트** — Wiki Synthesis 인용에 출처 해시·지지/반박 구분 필드. "반박 증거를 숨기지 않는다" 원칙 채택.
3. **dry-run-first 셋업** — `init`/adopt류 작업에 플랜 JSON+해시 승인 패턴 (우리 온보딩 ①과 결합).
4. **릴리스 재현성 감사** — SHA256SUMS + manifest 검증 스텝을 CI에.
5. **경로 안전 디테일** — casefold 충돌·Windows 예약이름·inode 피닝 중 우리 path-safety에 빠진 항목 보강.

**비흡수**: 다중 호스트 스킬 포터빌리티(AGENTS.md류) — 우리는 독립 앱/MCP가 축이라 레인 밖. BM25-온리 전환 — 우리 시맨틱 기본이 해자.

## 5. 결론

claude-obsidian은 "**엔지니어링 윤리가 뛰어난 스킬 레이어**"고, Stellavault는 "**지식 생명주기를 가진 독립 제품**"이다. 저쪽이 앞선 두 축(트랜잭션 쓰기, 프로버넌스)은 우리 로드맵에 흡수 가능하고, 우리가 앞선 축(시맨틱 검색, 감쇠/복습, 앱 UI, 로컬 LLM, 한국어, Windows)은 저쪽 아키텍처(호스트 탑승형)로는 따라오기 어렵다. **경쟁 전략은 정면 대결이 아니라: (1) 저쪽의 안전성 표준을 빠르게 흡수해 "안전성 열위" 서사를 차단하고, (2) 감쇠·프로액티브·앱·한국어라는 저쪽이 구조적으로 못 하는 축으로 분리하는 것.**
