<div align="center">

<img src="images/banner.svg" alt="Stellavault — 무엇이든 던지면 스스로 지식으로 컴파일됩니다" width="100%" />

**Claude가 기억하는 로컬 우선 세컨드 브레인.**<br/>
Karpathy의 자기 컴파일 위키 × 제텔카스텐 — 완전 로컬, 볼트 비파괴, MCP 네이티브.

[![MCP server](https://img.shields.io/badge/MCP-server-2761e8?logo=anthropic&logoColor=white)](#mcp-연동-21개-도구) [![npm](https://img.shields.io/npm/v/stellavault)](https://www.npmjs.com/package/stellavault) [![CI](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml/badge.svg)](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml) [![tests](https://img.shields.io/badge/tests-245%20passing-brightgreen)]() [![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)]() [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh.md)

[**🤖 Claude / Cursor에 추가**](#mcp-연동-21개-도구) · [**⬇ 데스크톱 앱**](https://github.com/Evanciel/stellavault/releases/tag/desktop-v0.3.0) · [**⚡ 빠른 시작**](#설치) · [**🌐 라이브 데모**](https://evanciel.github.io/stellavault/)

</div>

> **Claude가 내 볼트를 읽게 하는 한 줄 명령:**
>
> ```bash
> npx -y stellavault setup    # Claude Code / Desktop, Cursor, Windsurf, VS Code에 MCP 서버 연결
> ```

**스스로 컴파일하는 세컨드 브레인.** Stellavault는 "지식이 어떻게 살아 숨 쉬고 자라야 하는가"에 대한 두 가지 아이디어를 하나로 녹였습니다:

- 🧠 **Karpathy의 자기 컴파일 위키** — 무엇이든(PDF, 유튜브 링크, 스쳐 가는 생각) 던져 넣으면 자동으로 추출돼 `raw/`에 쌓이고, 다시 개념과 백링크가 정리된 깔끔한 `_wiki/`로 **컴파일**됩니다. 지식이 폴더 속에서 썩는 게 아니라, 쌓일수록 스스로 다시 컴파일됩니다.
- 🕸️ **제텔카스텐(Zettelkasten)** — 원자적 노트, `[[위키링크]]`, 그리고 저절로 자라나는 연결. 폴더 트리가 아니라 *아이디어의 그물망*이 당신의 사고를 구조화하는 진짜 뼈대가 됩니다.

이 둘을 하나의 로컬 우선 지식 도구로 합쳤습니다 — 본격 마크다운 에디터, 3D 신경망 그래프, 하이브리드 AI 검색, 간격 반복(spaced repetition) 기억 감쇠까지. 그리고 이 모든 것이 **데스크톱 앱**, **CLI**, **Obsidian 플러그인**, 그리고 **Claude가 당신의 볼트(vault) 전체를 읽게 해주는 MCP 서버**로 제공됩니다. 클라우드도, API 키도 없고, 원본 파일은 절대 수정되지 않습니다.

<p align="center">
  <img src="images/screenshots/graph-main-2.png" alt="3D 지식 그래프" width="820" />
  <br><em>당신의 볼트가 하나의 신경망으로. 로컬 우선, 클라우드 불필요.</em>
</p>

## 목차

[하이라이트](#하이라이트) · [왜 Stellavault?](#왜-stellavault인가) · [설치](#설치) · [에디터](#에디터) · [파이프라인](#파이프라인) · [인텔리전스](#인텔리전스) · [검색과 랭킹](#검색과-랭킹) · [MCP 연동](#mcp-연동-21개-도구) · [3D 시각화](#3d-시각화) · [설정](#설정) · [성능](#성능) · [기술 스택](#기술-스택) · [보안](#보안) · [문제 해결](#문제-해결)

## 하이라이트

- 🧠 **스스로 컴파일됩니다.** PDF, 유튜브 링크, 어설픈 메모 한 줄 — 무엇이든 던지면 `raw/`로 추출한 뒤 개념과 백링크가 정리된 깔끔한 `_wiki/`로 *컴파일*합니다. 쌓일수록 스스로 정리되는 지식.
- 🔍 **진짜로 찾아내는 검색.** 의미(시맨틱) + 정확한 키워드(BM25) + 당신의 `[[위키링크]]` / `#태그`를 **가중 RRF**로 융합하고, FSRS 기억 모델로 재정렬해 *지금 쓰고 있는* 노트를 위로 띄웁니다. 50+ 언어, 완전 로컬, API 키 0개.
- 🌌 **당신의 머릿속을 3D로.** 실시간 신경망 그래프(React Three Fiber) — 클러스터 색상, 별자리, 히트맵, 타임라인, 멀티버스 P2P 뷰. 아는 것의 *형태*를 눈으로 보는 방법.
- 🤖 **Claude가 볼트 전체를 읽습니다.** 일급 **MCP 서버**(21개 도구): Claude Code·Claude Desktop·Cursor·Windsurf·VS Code에서 검색·질의·초안·점검·분석을 바로.
- ⏳ **절대 *조용히* 잊지 않습니다.** FSRS 기억 감쇠가 곧 잃을 진짜 노트를 띄우고, 볼트 전반의 지식 공백·모순·중복까지 탐지합니다.
- 🔒 **로컬 우선. 볼트 비파괴. 키 0개.** 로컬 임베딩 + 온디바이스 벡터 스토어, 원본 파일은 **절대 수정되지 않습니다.** 당신이 옵트인하지 않는 한 아무것도 기기를 떠나지 않습니다.

## 왜 Stellavault인가

대부분의 도구는 *쓰기*, *찾기*, *기억하기* 중 하나를 고르게 만듭니다. Stellavault는 셋 다 합니다 — 로컬에서, 그리고 Claude가 읽을 수 있는 방식으로.

| | **Stellavault** | Obsidian | Notion | 직접 만든 RAG |
|---|:---:|:---:|:---:|:---:|
| 로컬 우선, 오프라인 작동 | ✅ | ✅ | ☁️ 클라우드 | ⚠️ 대개 클라우드 |
| API 키 없는 시맨틱 검색 | ✅ | ⚠️ 플러그인+키 | 💰 유료 AI | ⚠️ 키 필요 |
| 원본 파일 비수정 | ✅ | ✅ | ❌ 독자 포맷 | ➖ |
| 자기 컴파일 (수집 → 위키) | ✅ | ❌ | ❌ | ❌ |
| 3D 지식 그래프 | ✅ | 2D / 플러그인 | ❌ | ❌ |
| 간격 반복 감쇠 (FSRS) | ✅ | ⚠️ 플러그인 | ❌ | ❌ |
| 공백·모순·중복 탐지 | ✅ | ❌ | ❌ | ❌ |
| MCP 네이티브 (Claude가 볼트 읽기) | ✅ | ➖ 커뮤니티 | ☁️ 클라우드 | ➖ |

> [!NOTE]
> 양자택일이 아닙니다 — Stellavault는 **Obsidian 안에서** [플러그인](https://github.com/Evanciel/stellavault-obsidian)으로도 돌아갑니다. 쓰던 에디터는 그대로, 두뇌만 더하세요.

## 설치

### 데스크톱 앱 (추천 — 클릭 한 번)

<table>
  <tr>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.3.0/Stellavault-win32-x64-0.3.0.zip"><br/><b>⬇ Windows용 다운로드</b><br/><sub>x64 · 273 MB · ZIP</sub></a></td>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.3.0/Stellavault-linux-x64-0.3.0.zip"><br/><b>⬇ Linux용 다운로드</b><br/><sub>x64 · 243 MB · ZIP</sub></a></td>
    <td align="center"><br/><b>macOS</b><br/><sub>곧 출시</sub></td>
  </tr>
</table>

> [!TIP]
> 다운로드 → 압축 해제 → `stellavault.exe`(Windows) 또는 `stellavault`(Linux) 실행 → 노트 폴더 선택 → 완료.

### CLI (개발자용)

```bash
npm install -g stellavault    # 또는: npx stellavault
stellavault init              # 대화형 설정 (3분): 볼트 색인 + AI 클라이언트 연결
stellavault setup             # Claude Code/Desktop, Cursor, Windsurf, VS Code 연결 (명령 한 번)
stellavault graph             # 브라우저에서 3D 그래프 실행
```

> Node.js 20+ 필요. 문제가 있으면 `stellavault doctor`로 진단하세요.

### Obsidian 플러그인

1. [stellavault-obsidian 릴리스](https://github.com/Evanciel/stellavault-obsidian/releases/latest)에서 `main.js` + `manifest.json` + `styles.css` 다운로드
2. `.obsidian/plugins/stellavault/` 에 배치
3. 설정 → 커뮤니티 플러그인에서 활성화
4. 볼트 폴더에서 API 시작: `npx stellavault graph`

---

## 에디터

본격 마크다운 에디터 — Obsidian에 견줄 수준입니다.

<details>
<summary><b>전체 서식 & 블록 지원</b> — 표, 코드, KaTeX, 슬래시 명령어, 위키링크, 분할 보기… <i>(펼치기)</i></summary>

<br/>

| 기능 | 상태 |
|---------|--------|
| 굵게, 기울임, 밑줄, 취소선 | ✅ |
| 제목 1–6단계 | ✅ |
| 불릿 · 번호 · 작업 목록 (중첩 체크박스) | ✅ |
| 표 (생성, 열 너비 조절, 행·열 추가/삭제) | ✅ |
| 구문 강조 코드 블록 (40+ 언어) | ✅ |
| 이미지 (URL, 클립보드 붙여넣기, 드래그 앤 드롭) | ✅ |
| KaTeX 수식 렌더링 (`$E=mc^2$` 인라인, `$$...$$` 디스플레이) | ✅ |
| `/슬래시 명령어` (12종 블록, 퍼지 검색) | ✅ |
| `[[위키링크]]` 자동완성 | ✅ |
| 분할 보기 (수직 + 수평, Ctrl+\\) | ✅ |
| 텍스트 정렬 (왼쪽 / 가운데 / 오른쪽) | ✅ |
| 하이라이트, 위첨자, 아래첨자 | ✅ |
| 스마트 타이포그래피 (둥근 따옴표, em/en 대시) | ✅ |
| 수평선 | ✅ |

</details>

---

## 파이프라인

```
수집 ──→ 정리 ──→ 정제 ──→ 표현
(Capture ──→ Organize ──→ Distill ──→ Express)

무엇이든 던져 넣기 → 자동 추출 → raw/ → 컴파일 → _wiki/ → 초안
```

Karpathy의 자기 컴파일 지식 아키텍처에서 영감을 받았습니다.

### 14가지 포맷 수집(Ingest)

| 입력 | 방법 |
|-------|-----|
| PDF, DOCX, PPTX, XLSX | `stellavault ingest report.pdf` |
| JSON, CSV, XML, YAML, HTML, RTF | `stellavault ingest data.json` |
| YouTube | `stellavault ingest https://youtu.be/...` — 자막 + 타임스탬프 |
| URL | `stellavault ingest https://...` — HTML → 마크다운 |
| 텍스트 | `stellavault ingest "떠오른 생각"` |
| 폴더 | `stellavault ingest ./papers/` — 모든 파일 일괄 처리 |
| 데스크톱 / 웹 UI | 파일을 직접 드래그 앤 드롭 |

### 표현(Express): 지식을 끄집어내기

```bash
stellavault draft "AI" --format blog      # 볼트 기반 블로그 글
stellavault draft "AI" --format outline   # 구조화된 아웃라인
stellavault draft "AI" --ai              # Claude API 강화 ($0.03)
```

또는 데스크톱 앱의 **Express 탭**에서 주제를 입력하고 포맷을 고르면, 볼트에 근거한 초안을 생성합니다. `_drafts/`에 저장하고 인라인으로 편집하세요.

---

## 인텔리전스

> Obsidian에는 플러그인을 써도 **존재하지 않는** 기능들입니다.

| 기능 | 명령 / 데스크톱 | 설명 |
|---------|-------------------|-------------|
| **기억 감쇠(Memory Decay)** | `stellavault decay` / Memory 탭 | FSRS 기반 — 당신이 잊어가고 있는 실제 노트를 보여줍니다 |
| **지식 공백(Knowledge Gaps)** | `stellavault gaps` | 주제 클러스터 사이의 약한 연결을 탐지 |
| **모순(Contradictions)** | `stellavault contradictions` | 볼트 전반의 상충하는 진술을 발견 |
| **중복(Duplicates)** | `stellavault duplicates` | 유사도 점수와 함께 거의 동일한 노트 탐지 |
| **건강 점검(Health Check)** | `stellavault lint` | 볼트 건강 점수 집계 (0–100) |
| **학습 경로(Learning Path)** | `stellavault learn` | AI 맞춤형 복습 추천 |
| **데일리 브리핑** | 데스크톱 앱 홈 화면 | 푸시형: 앱을 켜면 감쇠 상위 노트 + 통계 표시 |
| **자동 태깅** | 수집 시 자동 | 콘텐츠 기반 키워드 추출 + 카테고리 규칙 |
| **자기 컴파일** | `stellavault compile` | raw/ → _wiki/ 로, 개념 추출 + 백링크 자동 생성 |

---

## 검색과 랭킹

여러 신호를 **가중 RRF(Reciprocal Rank Fusion)**로 융합하는 하이브리드 검색 — 개인 지식 볼트에 맞춰 튜닝되었고, 완전 로컬, API 키 0개:

| 신호 | 포착하는 것 | 기본 가중치 |
|--------|------------------|---------------:|
| **시맨틱**(dense) | 의미; 다국어 (50+ 언어) | `1.0` |
| **BM25**(키워드) | 정확한 용어, 코드, 이름 | `1.0` |
| **엔티티 링킹** | 당신의 `[[위키링크]]`, `#태그`, 제목, 헤딩 — 큐레이션된 그래프 | `1.5` |
| **FSRS 최신성** | 당신이 지금 쓰고 있거나 잊어가는 노트를 부드럽게 띄움 | `±10%` |

- **엔티티 매칭**은 퍼지 부분 문자열 + 구두점 정규화 매칭으로 자연어 쿼리를 해석합니다(한국어 / CJK 친화적). 또한 **문서당 다양성 캡(per-document diversity cap)**으로 큰 노트 하나가 상위 결과를 도배하지 못하게 합니다.
- **최신성**은 단순 파일 수정 시각(mtime)이 아니라 감쇠 엔진과 동일한 FSRS 기억 모델을 재사용합니다 — 잊어가는 노트는 다시 떠오르고, 이미 숙달한 오래된 노트가 단지 오래됐다는 이유로 묻히지 않습니다.
- **적응형 리랭크**(장시간 실행 MCP 서버)는 현재 세션 맥락(최근 태그 / 경로)으로 결과를 추가 보정합니다.
- 모든 가중치는 볼트별로, 또는 환경 변수로 **튜닝 가능**합니다 — [설정](#설정) 참조.

---

## MCP 연동 (21개 도구)

```bash
stellavault setup            # 명령 한 번 → Claude Code, Claude Desktop, Cursor, Windsurf, VS Code
# 또는 Claude Code만 연결:
claude mcp add stellavault -- stellavault serve
```

<details>
<summary>수동 설정 (모든 MCP 클라이언트) — 복사-붙여넣기 JSON</summary>

```json
{
  "mcpServers": {
    "stellavault": {
      "command": "npx",
      "args": ["-y", "stellavault", "serve"]
    }
  }
}
```

[MCP 레지스트리](https://registry.modelcontextprotocol.io)에 `io.github.Evanciel/stellavault`로 등록 (Glama·Smithery·mcp.so에서도 발견 가능).
</details>

Claude가 당신의 볼트를 직접 검색·질의·초안 작성·점검·분석할 수 있습니다. 검색은 전체 하이브리드 파이프라인을 실행합니다 — 시맨틱 + BM25 + 엔티티 링킹에 대한 **가중 RRF**, 여기에 **FSRS 최신성**과 세션 적응형 리랭크까지(자세히는 [검색과 랭킹](#검색과-랭킹)).

| 도구 | 하는 일 |
|------|-------------|
| `search` | 가중 RRF (시맨틱 + BM25 + 엔티티) + FSRS 최신성 + 적응형 리랭크 |
| `ask` | 볼트 근거 기반 Q&A |
| `generate-draft` | 당신의 지식으로 AI 초안 작성 |
| `get-decay-status` | 기억 감쇠 리포트 (FSRS) |
| `detect-gaps` | 지식 공백 분석 |
| `create-knowledge-node` | AI가 위키 품질의 노트 생성 |
| `federated-search` | 여러 볼트에 걸친 P2P 검색 |
| + 14개 더 | 문서, 주제, 결정, 스냅샷, 내보내기 |

---

## 3D 시각화

- 클러스터 색상이 입혀진 신경망 그래프 (React Three Fiber)
- 별자리 보기 (MST 별 패턴)
- 히트맵 오버레이 + 타임라인 슬라이더 + 감쇠 오버레이
- 멀티버스 보기 — P2P 네트워크 속 하나의 우주가 된 당신의 볼트
- 다크/라이트 테마

<table>
  <tr>
    <td width="50%"><img src="images/screenshots/graph-heatmap.png" alt="히트맵 오버레이" /><br/><sub><b>히트맵</b> — 클러스터별 연결 밀도</sub></td>
    <td width="50%"><img src="images/screenshots/graph-timeline.png" alt="타임라인 슬라이더" /><br/><sub><b>타임라인</b> — 볼트가 자라는 모습을 시간순으로</sub></td>
  </tr>
  <tr>
    <td><img src="images/screenshots/search-active.png" alt="시맨틱 검색 하이라이트" /><br/><sub><b>검색</b> — 그래프 안에서 시맨틱 매치 하이라이트</sub></td>
    <td><img src="images/screenshots/multiverse-view.png" alt="멀티버스 P2P 보기" /><br/><sub><b>멀티버스</b> — 궤도를 도는 우주가 된 연합 볼트들</sub></td>
  </tr>
</table>

---

## 지금 바로 체험 (데모 볼트)

```bash
npx stellavault index --vault ./examples/demo-vault   # 샘플 노트 10개 색인
npx stellavault search "vector database"               # 시맨틱 검색
npx stellavault graph                                  # 3D 그래프 시각화
```

데모 볼트에는 Vector Database, Knowledge Graph, Spaced Repetition, RAG, MCP 등 서로 연결된 노트가 들어 있어 모든 기능을 즉시 둘러보기에 좋습니다.

---

## 시작 가이드

### 데스크톱 앱

1. **다운로드** → 압축 해제 → 실행
2. 첫 실행 시 노트 폴더를 선택하라고 안내합니다
3. 노트가 사이드바에 나타납니다 — 클릭해서 열기
4. `Ctrl+P`로 빠른 파일 전환
5. 타이틀 바의 ✦ 클릭 → AI 패널 (시맨틱 검색, 통계, 초안)
6. ◉ 클릭 → 3D 그래프

### CLI

```bash
npm install -g stellavault
stellavault init                          # 설정 마법사
stellavault search "machine learning"     # 시맨틱 검색
stellavault ingest paper.pdf              # 지식 추가
stellavault graph                         # 브라우저에서 3D 그래프
stellavault brief                         # 아침 브리핑
stellavault decay                         # 무엇을 잊어가고 있나요?
```

### 키보드 단축키 (데스크톱)

| 단축키 | 동작 |
|----------|--------|
| `Ctrl+P` | 빠른 전환 (퍼지 파일 검색) |
| `Ctrl+Shift+P` | 명령 팔레트 (모든 동작) |
| `Ctrl+S` | 현재 노트 저장 |
| `Ctrl+\` | 분할 보기 토글 |
| `Ctrl+B` | 굵게 |
| `Ctrl+I` | 기울임 |
| `Ctrl+U` | 밑줄 |
| `Ctrl+E` | 인라인 코드 |
| `/` | 슬래시 명령어 (줄 시작에서) |
| `[[` | 위키링크 자동완성 |

### 빠른 참조

| 동작 | 데스크톱 | CLI |
|--------|---------|-----|
| 노트 검색 | Ctrl+P 또는 AI 패널 | `stellavault search "query"` |
| 노트 추가 | + Note 버튼 또는 드래그 앤 드롭 | `stellavault ingest "text"` |
| 3D 그래프 보기 | ◉ 버튼 | `stellavault graph` |
| 기억 감쇠 | AI 패널 → Memory | `stellavault decay` |
| 초안 생성 | AI 패널 → Draft | `stellavault draft "topic"` |
| 건강 점검 | AI 패널 → Stats | `stellavault lint` |

---

## 설정

Stellavault는 `./.stellavault.json`(또는 `~/.stellavault.json`)을 읽습니다. 검색 랭킹은 전부 튜닝 가능하며, 합리적인 기본값이 바로 작동합니다:

```jsonc
{
  "search": {
    "rrfK": 60,
    "weights": { "semantic": 1.0, "bm25": 1.0, "entity": 1.5 },
    "recencyWeight": 0.2,                          // FSRS 최신성 강도; 0 = 끔
    "entityAliases": { "k8s": ["kubernetes"] }     // 동의어 / 교차언어 그룹 (정확 일치만)
  }
}
```

환경 변수는 설정을 덮어씁니다 (가드와 함께 파싱):

| 환경 변수 | 효과 |
|---------|--------|
| `STELLAVAULT_W_SEMANTIC` / `_BM25` / `_ENTITY` | 신호별 RRF 가중치 (예: `STELLAVAULT_W_ENTITY=2.0`으로 엔티티 공격적 노출) |
| `STELLAVAULT_RECENCY_WEIGHT` | 최신성 강도 `0`–`1` (`0`은 비활성화) |
| `STELLAVAULT_DB_PATH` | 색인 DB 위치 재지정 |
| `STELLAVAULT_WATCH` | `serve` 실행 중 자동 재색인 파일 워처를 끄려면 `0` |

> 참고: 교차언어 재현율(예: 한국어 쿼리로 영어 노트 찾기)은 다국어 임베딩 모델이 자동 처리합니다 — `entityAliases`는 큐레이션된 엔티티 그래프(태그 / 위키링크)와 약어에 대한 선택적 정밀도 부스트입니다.

---

## 성능

합성 볼트로 테스트 — 일반적 사용에서 모든 작업이 1초 미만:

| 작업 | 100개 문서 | 500개 문서 | 1000개 문서 |
|-----------|----------|----------|-----------|
| 스토어 초기화 | 15ms | 15ms | 16ms |
| 일괄 upsert | 12ms | 102ms | ~200ms |
| 검색 (BM25) | <1ms | <1ms | <1ms |
| 전체 문서 조회 | <1ms | 2ms | ~4ms |
| 124K 내적 연산 | — | 36ms | — |

직접 벤치마크 실행:

```bash
node tests/stress.mjs 500     # 합성 문서 500개로 테스트
```

핵심 최적화:
- **HNSW 그래프 구축** — 200+ 문서에 sqlite-vec KNN (O(n·K·log n) vs O(n²))
- 사전 정규화 벡터: 코사인 유사도 → 단일 내적
- 배치 임베딩 로딩 (배치당 500개, RAM 오버플로 방지)
- 작은 볼트(< 200 문서)는 상삼각 브루트포스
- 타입드 배열로 O(n) K-Means 중심 갱신

---

## 기술 스택

| 계층 | 기술 |
|-------|------|
| 데스크톱 | Electron + React + TipTap (15개 확장) + Zustand |
| 런타임 | Node.js 20+ (ESM, TypeScript) |
| 벡터 스토어 | SQLite-vec (로컬, 무설정) |
| 임베딩 | MiniLM-L12-v2 (로컬, 50+ 언어, 배치 처리) |
| 검색 | 가중 RRF (시맨틱 + BM25 + 엔티티) + FSRS 최신성 |
| 수식 | KaTeX (인라인 + 디스플레이) |
| 코드 | lowlight / highlight.js (40+ 언어) |
| 3D | React Three Fiber + Three.js |
| AI | MCP (21개 도구) + Anthropic SDK |
| P2P | Hyperswarm (선택, 차분 프라이버시) |
| CI | GitHub Actions (Node 20 + 22) |

---

## 보안

- **로컬 우선** — `--ai`를 쓰지 않는 한 데이터가 기기를 떠나지 않습니다
- **볼트 파일 절대 미수정** — SQLite로 색인할 뿐 원본은 그대로
- **Electron 샌드박스 활성화** — 렌더러가 축소된 OS 권한으로 실행
- **IPC 경로 검증** — 모든 파일 작업이 볼트 루트 안에 머무름
- **API 인증 토큰** — 세션별, 헤더 전용(`X-Stellavault-Token`). 토큰 엔드포인트는 동일 출처(same-origin)만 허용
- **CORS 허용 목록** — 기본은 `localhost` / `127.0.0.1`만; MCP HTTP 전송은 옵트인
- **SSRF 방어** — URL 수집 시 사설 IP 차단
- **E2E 암호화** — 클라우드 동기화에 AES-256-GCM

### 페더레이션 (실험적, 기본 비활성화)

P2P 시맨틱 검색은 **옵트인 실험 기능**으로 제공됩니다. 기본 설치는 어떤 swarm에도 가입하지 않으며 데이터를 절대 공유하지 않습니다.

명시적으로 활성화:

```bash
# PowerShell
$env:STELLAVAULT_FEDERATION_EXPERIMENTAL = "1"

# bash / zsh
export STELLAVAULT_FEDERATION_EXPERIMENTAL=1

stellavault federate join
```

활성화되면 페더레이션은 Ed25519 신원과 서명된 봉투(signed envelope), 상호 챌린지-응답 핸드셰이크, 봉투별 리플레이 논스, 핸드셰이크 타임아웃, 피어별 레이트 리미팅, 그리고 수신 전용 공유 기본값(`myNodeLevel=0`)을 사용합니다. 실제로 제목/스니펫을 피어와 공유하려면 페더레이션 프롬프트에서 `set-level 1+`을 실행하세요.

> [!WARNING]
> **업그레이드 안내 (v0.7.4)** — 페더레이션 와이어 포맷이 v2.0 → v2.1(봉투 단위 논스)로 올라갔습니다. v0.7.3 노드와는 호환되지 않습니다. 기존 `~/.stellavault/federation/sharing.json`은 더 안전한 기본값으로 자동 다운그레이드되지 **않으니**, 이전에 옵트인했다면 `myNodeLevel`을 다시 점검하세요.

전체 내용은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 문제 해결

```bash
stellavault doctor    # 설정, 볼트, DB, 모델, Node 버전 점검
```

자주 묻는 문제:
- **"Command not found"** → `npm i -g stellavault@latest`
- **"API server not found"** → `npx stellavault graph`
- **빈 그래프** → `stellavault index`
- **첫 실행이 느림** → AI 모델 ~30MB를 최초 1회 다운로드

## 기여

이슈와 풀 리퀘스트를 환영합니다. 시작은 [CONTRIBUTING.md](CONTRIBUTING.md)를, 취약점 제보는 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

MIT — 전체 소스 코드를 감사(audit)할 수 있습니다.

## 링크

- **[⬇ 데스크톱 앱 다운로드](https://github.com/Evanciel/stellavault/releases/tag/desktop-v0.3.0)**
- [랜딩 페이지](https://evanciel.github.io/stellavault/)
- [Obsidian 플러그인](https://github.com/Evanciel/stellavault-obsidian)
- [npm](https://www.npmjs.com/package/stellavault)
- [GitHub 릴리스](https://github.com/Evanciel/stellavault/releases)
- [보안 정책](SECURITY.md)

---

<div align="center">

**도움이 되셨나요?** ⭐ [**Stellavault에 스타**](https://github.com/Evanciel/stellavault) — 연결된 노트로 사고하는 더 많은 사람에게 닿는 데 큰 힘이 됩니다.

<sub>세컨드 브레인을 만드는 사람들을 위해 ✦로 빚었습니다. · <a href="https://github.com/Evanciel/stellavault/releases">다운로드</a> · <a href="#mcp-연동-21개-도구">Claude 연결</a> · <a href="https://github.com/Evanciel/stellavault/issues">이슈 제보</a></sub>

</div>
