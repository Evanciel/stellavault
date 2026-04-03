# Stellavault + Stella Network -- 네트워크 우선 실행 로드맵

> **PM Agent Team 통합 분석** | 생성일: 2026-04-02
>
> 4개 PM 에이전트(Discovery, Strategy, Research, PRD)의 관점을 통합한
> "먼저 1,000명 모으고, 그 다음에 돈 번다" 전략의 구체적 실행 로드맵.
>
> 선행 분석: `stellavault-advanced.prd.md`, `stellavault-federation.prd.md`,
> `stellavault-incentives.prd.md`, `stellavault-business-evaluation.md`
>
> GitHub: https://github.com/Evanciel/stellavault

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **현실 인식** | Stellavault는 인상적인 기술 프로토타입(CLI 22개, MCP 13개, 3D 그래프, FSRS, Federation)이지만 사용자 0명, 매출 $0이다. 기술이 아닌 "첫 100명의 실제 사용자"가 현재 가장 중요한 과제다. |
| **핵심 전략** | Phase 1은 100% 무료로 네트워크 성장에 집중. Federation이 아닌 "MCP 지식 도구"로 포지셔닝하여 Obsidian + Claude Code 사용자를 타겟. 콜드 스타트 킬러는 "네트워크 없이도 가치 있는 개인 도구" — Come for the Tool, Stay for the Network. |
| **실행 계획** | 12개월 3-Phase: (1) 0-1,000명 무료 사용자 확보 (2) 1,000-5,000명 프리미엄 전환 시작 (3) 5,000+ 생태계 확장. 각 Phase별 구체적 채널, 메시지, KPI, 비용 구조 포함. |
| **핵심 가치** | "당신의 Obsidian vault를 AI가 진짜로 이해하게 만드는 유일한 도구. Claude가 당신의 과거 결정, 지식 패턴, 학습 상태를 알고 응답한다." |

---

# Part I: Discovery (pm-discovery)

> 첫 사용자를 어디서, 어떻게 모으는가?

## 1. 첫 100명: "수동 1:1" 전략

### 1.1 채널별 구체적 실행 계획

첫 100명은 스케일이 아니라 깊이다. 한 명 한 명 직접 찾아가야 한다.

| # | 채널 | 구체적 행동 | 예상 전환 | 타임라인 |
|---|------|-----------|----------|---------|
| 1 | **Obsidian Forum** | "Share & showcase" 섹션에 주 1회 Stellavault 활용 사례 포스팅. "MCP로 Claude가 내 vault를 검색하게 만든 방법" 등 실용적 튜토리얼 | 포스트당 10-30 조회, 2-5명 시도 | Week 1-8 |
| 2 | **Obsidian Discord** | #plugins-showcase, #tools 채널에서 MCP 관련 질문에 답변하며 자연스럽게 소개. 스팸하지 말 것 — 먼저 커뮤니티에 기여 | 주 1-3명 | Week 1-12 |
| 3 | **r/ObsidianMD** (Reddit) | "How I use MCP to make Claude understand my entire vault" 포스트. Before/After 스크린샷 필수 | 포스트당 5-20 upvotes, 3-10명 시도 | Week 2-8 |
| 4 | **Claude Code Discord / Anthropic Forum** | MCP 도구 데모. "stellavault search" 도구가 Claude의 응답 품질을 어떻게 높이는지 시연 | 주 2-5명 | Week 2-12 |
| 5 | **GitHub Awesome Lists** | awesome-obsidian, awesome-mcp-servers, awesome-knowledge-management에 PR | 1회성이지만 장기 트래픽 | Week 1 |
| 6 | **개인 네트워크** | 개발자 친구/동료에게 직접 설치 도와주기. 설치 과정에서 마찰점 실시간 관찰 | 5-10명 (가장 고품질 피드백) | Week 1-4 |
| 7 | **X (Twitter)** | #ObsidianMD #MCP #PKM 해시태그로 주 2-3회 포스팅. GIF/동영상 클립 (3D 그래프, 검색 데모) | 팔로워 100+ 시 주 2-5명 | Week 1-12 |

### 1.2 첫 100명을 위한 메시지

**핵심 메시지 (한 문장)**:
> "Install Stellavault, index your vault, and Claude will know your past decisions."

**상황별 메시지 변형**:

| 상황 | 메시지 | 왜 이게 통하는가 |
|------|--------|----------------|
| Obsidian Forum | "500개 노트를 Claude에게 가르치는 데 3분 걸렸다. `stellavault index` 한 번이면 MCP로 전체 vault 검색 가능." | Obsidian 사용자의 핵심 욕구: "내 노트를 더 잘 활용하고 싶다" |
| Claude Code Discord | "Claude Code에 MCP 도구 13개를 추가했다. search, decay-status, morning-brief, learning-path... 내 vault가 Claude의 장기 기억이 된다." | MCP 사용자의 핵심 욕구: "AI를 더 똑똑하게 만들고 싶다" |
| Reddit | "Obsidian + Claude 조합 쓰는 사람? Stellavault라는 오픈소스 도구 만들었는데, vault를 인덱싱하면 Claude가 과거에 내가 어떤 결정을 내렸는지까지 알고 답변해준다." | Reddit의 "I made this" 문화에 맞는 겸손한 소개 |
| Hacker News | "Show HN: Stellavault -- Turn your Obsidian vault into a 3D neural knowledge graph with AI-powered search and MCP integration" | HN은 기술적 깊이를 좋아한다. 3D 그래프 + vector search + FSRS 조합 |

### 1.3 첫 100명의 프로필

이 100명은 무작위가 아니다. 정확히 이런 사람들이다:

| 특성 | 조건 |
|------|------|
| **노트 수** | Obsidian vault에 300개+ 노트 |
| **AI 사용** | Claude Code 또는 Claude Desktop을 일상적으로 사용 |
| **CLI 친숙도** | npm install, 터미널 사용에 거부감 없음 |
| **MCP 인식** | MCP가 뭔지 알거나, "AI에 내 데이터를 연결하고 싶다"는 욕구 있음 |
| **OS** | macOS 또는 Linux (Windows는 경로 이슈로 초기 마찰 높음) |

**추정 규모**: 전 세계에 이 조건을 모두 만족하는 사람은 약 **5,000-15,000명**. 이 중 1-2%인 100명을 확보하는 것이 목표.

---

## 2. 100명 → 500명: "콘텐츠 마케팅 + 바이럴 루프" 전략

### 2.1 전략 차이

100명까지는 1:1이었지만, 500명부터는 콘텐츠가 일해야 한다.

| 채널 | 행동 | 전환 기대치 |
|------|------|-----------|
| **Product Hunt 런칭** | 준비기간 4주. 빌더/메이커 50명+ 사전 확보. "MCP Knowledge Graph" 포지셔닝 | 500-2,000 방문, 50-200 설치 |
| **Hacker News Show HN** | 기술적 깊이 강조. "How we built a 3D knowledge graph with vector search and MCP" | 100-500 포인트 시 300-1,000 방문 |
| **YouTube/Loom 데모 영상** | "5분 만에 Obsidian vault를 AI가 이해하게 만들기" — 설치부터 검색까지 라이브 | 영상당 500-2,000 조회 |
| **DEV.to / Hashnode 블로그** | "Building a Personal Knowledge Graph with TypeScript" 시리즈 (3-5편) | 편당 1,000-5,000 조회 |
| **Obsidian Roundup 뉴스레터** | Obsidian Roundup에 소개 요청 (엘리너 코어링에게 DM) | 1회 소개 시 200-500 방문 |

### 2.2 바이럴 루프 설계

```
사용자가 Stellavault 설치
  ↓
3D 그래프가 "와" 모먼트 생성
  ↓
스크린샷/GIF를 SNS에 공유 (자연 발생)
  ↓
"이게 뭐야?" → stellavault.dev 방문
  ↓
설치 → 본인 vault도 그래프로 보기
  ↓
반복
```

**핵심**: 3D 그래프는 생산성 도구가 아니라 **"와" 모먼트 생성기**다. Business evaluation에서 "한 번 보고 안 본다"고 했지만, 그 "한 번 보는 순간"의 시각적 임팩트가 바이럴의 핵심이다. 스크린샷이 곧 마케팅이다.

**그래프 공유 기능 (필수 구현)**:
- `stellavault graph --export png` -- 고화질 스크린샷 1-click
- 우하단에 "Made with Stellavault" 워터마크
- 그래프 이미지 클릭 시 stellavault.dev로 이동하는 OG 메타 태그
- "Share my graph" 버튼 → Twitter/Reddit/Discord 공유 원클릭

---

## 3. 500명 → 1,000명: "커뮤니티 + Federation 소개"

### 3.1 전략 차이

500명이면 커뮤니티가 자생할 조건이 된다.

| 행동 | 구체적 실행 |
|------|-----------|
| **Discord 서버 개설** | #general, #showcase, #feature-requests, #mcp-tips, #federation-beta 채널 |
| **주간 뉴스레터** | "This Week in Stellavault" — 새 기능, 커뮤니티 사용 사례, 팁 |
| **Federation 베타** | "함께 테스트할 5명의 얼리 어답터 모집" — Discord에서 지원 받기 |
| **GitHub Sponsors 시작** | $5/월 Supporter, $12/월 Pro — 아직 기능 차등은 없고 뱃지만 제공 |
| **"Founding Node" 프로그램** | 첫 100 Federation 노드에게 영구 뱃지 + 향후 Pro 50% 할인 |

### 3.2 커뮤니티 건강 지표

| 지표 | 500명 시점 목표 | 측정 방법 |
|------|---------------|---------|
| WAU (주간 활성) | 100+ | CLI 텔레메트리 (opt-in) |
| GitHub Issues | 주 5-10개 | GitHub API |
| Discord 메시지 | 일 20+ | Discord 분석 |
| MCP 도구 호출 수 | 일 500+ | opt-in 텔레메트리 |
| 3D 그래프 스크린샷 공유 | 주 10+ | #showcase 채널 |

---

## 4. "네트워크가 비어있을 때도 가치 있는 기능" (콜드 스타트 킬러)

이것이 가장 중요하다. Federation이 10개 노드일 때, 100개 노드일 때 — 이전에 가치가 있어야 사람들이 온다.

### 4.1 네트워크 없이도 가치 있는 기능 (이미 구현됨)

| 기능 | 개인 가치 | 현재 상태 |
|------|----------|---------|
| **MCP 13개 도구** | Claude가 내 vault를 검색/분석/요약 | 구현 완료 |
| **FSRS 감쇠 추적** | 잊고 있는 노트 리마인드 | 구현 완료 |
| **Morning Brief** | 매일 아침 지식 브리핑 | 구현 완료 |
| **Gap Detector** | 내 지식의 빈 곳 발견 | 구현 완료 |
| **3D Knowledge Graph** | 지식 구조 시각화 | 구현 완료 |
| **Contradiction Detector** | 자기 모순 발견 | 구현 완료 |
| **Learning Path** | FSRS 기반 복습 경로 | 구현 완료 |
| **Decay Status** | 지식 건강 점검 | 구현 완료 |

**핵심 통찰**: Stellavault는 이미 콜드 스타트 킬러를 갖고 있다. 문제는 이것들의 존재를 사람들이 모른다는 것이다.

### 4.2 Federation 노드 수별 부가 가치

| 노드 수 | 추가되는 가치 | "이 네트워크에 참여해야 하는 이유" |
|---------|-------------|-------------------------------|
| **1 (나만)** | 없음 — 개인 도구로 사용 | "아직 Federation 안 써도 됩니다. 개인 도구만으로 충분히 가치 있습니다." |
| **3-5 (팀)** | 팀원의 지식 검색. "야, 그거 어디 정리했어?" 대신 `stellavault search "deploy config"` | "팀원 3명만 연결하면 Slack 검색보다 나은 지식 검색이 됩니다." |
| **10 (스터디 그룹)** | 특정 주제(Rust, ML 등)에서 유의미한 커버리지. 갭 탐지가 그룹 수준으로 작동 | "스터디 그룹 전체의 지식 지도를 볼 수 있습니다. 누가 뭘 아는지." |
| **100 (도메인 커뮤니티)** | 도메인별 검색 관련성 80%+. "이 질문은 Node C가 잘 알아요" 라우팅 가능 | "Rust 커뮤니티에서 가장 풍부한 지식을 가진 사람이 누군지 네트워크가 알려줍니다." |
| **1,000 (생태계)** | 다중 도메인 교차 검색. AI 에이전트의 기본 지식 인프라 | "당신의 AI 에이전트가 1,000명의 전문가 지식에 접근합니다." |

---

## 5. 검증해야 할 가설 3개 + 실험 설계

### 가설 1: "MCP 도구 13개가 주 30분 이상의 시간을 절약한다"

**왜 중요한가**: Business evaluation이 지적했듯이, 유일한 경쟁 우위인 "개인 컨텍스트"가 실제로 시간을 절약하는지 증명해야 한다. 이것이 증명되지 않으면 모든 것이 무너진다.

| 항목 | 내용 |
|------|------|
| **실험** | 첫 20명 사용자에게 2주간 사용 후 설문. "Stellavault MCP 도구 사용 전후로 AI 코딩/작문 효율이 어떻게 변했나?" |
| **측정** | (1) 자기 보고 시간 절약 (2) MCP 도구 호출 빈도 (3) "내일부터 못 쓰면 어떻겠나?" 1-10점 |
| **성공 기준** | 70%+ 사용자가 "주 30분 이상 절약" 응답. NPS 40+ |
| **실패 시** | 메시지 변경 — "시간 절약"이 아닌 "AI 응답 품질 향상"으로 가치 재정의 |
| **노력** | 낮음 (설문 + 텔레메트리) |

### 가설 2: "3D 그래프 스크린샷이 바이럴 루프를 만든다"

**왜 중요한가**: 무료 사용자 확보의 핵심 엔진이 "시각적 임팩트 → SNS 공유 → 새 사용자"인데, 이게 실제로 작동하는지 확인해야 한다.

| 항목 | 내용 |
|------|------|
| **실험** | "Share your knowledge graph" 캠페인. Discord #showcase + Twitter #StellavaultGraph. 2주간 실행 |
| **측정** | (1) 공유된 스크린샷 수 (2) 스크린샷에서 stellavault.dev로의 유입 (referrer 추적) (3) 유입 → 설치 전환율 |
| **성공 기준** | 공유 20건+, 유입 100+, 전환율 10%+ |
| **실패 시** | 바이럴 루프를 그래프가 아닌 "AI 대화 스크린샷" (Claude가 내 노트를 참조하며 답변하는 장면)으로 전환 |
| **노력** | 낮음 (Export 기능 이미 존재, 워터마크 + OG 태그 추가만 필요) |

### 가설 3: "Federation 3-5명 팀 연결이 Slack 검색보다 유용하다"

**왜 중요한가**: Federation의 최소 유효 가치(Atomic Network)가 실제로 존재하는지 확인. Business evaluation이 "누가 이걸 원하는가?"라고 물었는데, 실제로 테스트해봐야 한다.

| 항목 | 내용 |
|------|------|
| **실험** | 개발자 3-5명 그룹 2개 모집. 2주간 Federation 사용. 비교군: 같은 질문을 Slack/이메일로 해결 |
| **측정** | (1) Federation 검색 유용성 1-10점 (2) "Slack 검색 vs Stellavault 검색" 직접 비교 (3) "계속 쓰겠는가?" |
| **성공 기준** | 80%+ 가 "유용하다" (6점+). 50%+ 가 "Slack보다 낫다" |
| **실패 시** | Federation을 "팀 도구"가 아닌 "개인 멀티 vault 도구"로 피봇 — 자기 Obsidian + Notion 동시 검색 |
| **노력** | 중간 (사용자 모집 + 온보딩 필요) |

---

# Part II: Strategy (pm-strategy)

> Phase별 무엇을, 언제, 얼마에 제공하는가?

## 6. Phase 1: 무료 성장기 (0-1,000명, Month 1-6)

### 6.1 무료로 주는 것 (전부)

**원칙: Phase 1에서는 아무것도 유료가 아니다. 모든 기능이 무료다.**

| 기능 | 현재 상태 | Phase 1 제공 |
|------|----------|-------------|
| CLI 22개 커맨드 | 구현 완료 | 무료 |
| MCP 13개 도구 | 구현 완료 | 무료 |
| 3D Knowledge Graph | 구현 완료 | 무료 |
| FSRS 감쇠 추적 | 구현 완료 | 무료 |
| Gap/Contradiction/Duplicate 탐지 | 구현 완료 | 무료 |
| Federation P2P | 구현 완료 | 무료 |
| Knowledge Pack 공유 | 구현 완료 | 무료 |
| Morning Brief | 구현 완료 | 무료 |
| Learning Path | 구현 완료 | 무료 |
| **Obsidian Plugin** | 미구현 | **Phase 1 핵심 개발 (필수)** |
| **stellavault.dev 랜딩** | 미구현 | **Phase 1 핵심 개발 (필수)** |

### 6.2 Phase 1 기간

**6개월** (Month 1-6). 1,000명 도달 또는 6개월 중 먼저 오는 시점에서 Phase 2로 전환.

1,000명 도달이 6개월 안에 안 되면? Phase 1을 연장한다. **무료 기간의 조기 종료는 없다.**

### 6.3 Phase 1 KPI (North Star Metric)

**North Star: 주간 MCP 도구 호출 수 (Weekly MCP Tool Invocations)**

이유: MCP 도구를 호출한다 = AI가 내 vault를 참조한다 = 핵심 가치를 체험하고 있다. 설치 수나 GitHub stars는 허영 지표다. "실제로 쓰고 있는가?"가 핵심이다.

| KPI | 목표 (Month 6) | 측정 방법 |
|-----|:---------------:|---------|
| **주간 MCP 호출 수** | 5,000+/주 | opt-in 텔레메트리 |
| 총 설치 수 | 1,000+ | npm 다운로드 + GitHub releases |
| WAU (주간 활성 사용자) | 200+ | CLI 텔레메트리 (opt-in) |
| GitHub Stars | 1,000+ | GitHub API |
| Discord 멤버 | 300+ | Discord 분석 |
| NPS | 40+ | 분기별 설문 |

---

## 7. Phase 2: 프리미엄 전환기 (1,000-5,000명, Month 7-12)

### 7.1 유료 전환 시점 판단

**과금 시작 조건 (3개 모두 충족)**:

1. WAU 200+ (사용자가 실제로 쓰고 있다)
2. NPS 40+ (사용자가 만족하고 있다)
3. "Pro 기능이 있으면 돈을 내겠다"고 응답한 사용자 50명+ (WTP 확인)

### 7.2 무료 vs 유료 기능 분리

**원칙: 코어 기능은 영원히 무료. 유료는 "power user 편의 + 클라우드 + 팀".**

| 기능 | Free (영구) | Pro ($8/월) |
|------|:-----------:|:----------:|
| CLI 전체 | O | O |
| MCP 13 도구 | O | O |
| 3D Graph (로컬) | O | O |
| FSRS 감쇠 | O | O |
| 모든 Intelligence (gap, contradiction, duplicate) | O | O |
| Federation P2P (기본) | O | O |
| Knowledge Pack 공유 | O | O |
| **Cloud Sync (cross-device)** | X | **O** |
| **Vault 5개+ 동시 인덱싱** | X (3개까지) | **O (무제한)** |
| **우선 Federation 라우팅** | X | **O** |
| **Knowledge Profile 커스터마이징** | X (기본) | **O (전체)** |
| **Advanced Graph Themes** | X (기본 1개) | **O (10개+)** |
| **Export 워터마크 제거** | X | **O** |
| **이메일 Morning Brief** | X (CLI만) | **O (이메일 배달)** |
| **API 접근 (웹훅, 자동화)** | X | **O** |
| **Pro 배지** | X | **O** |

**가격 설정 근거**: $8/월은 Obsidian Sync ($4), InfraNodus ($9-29), Mem ($8-10) 범위 내. $12가 아닌 $8로 시작하는 이유 — 전환율을 최대화하기 위해. 후에 기능 추가하며 $12로 올릴 수 있다.

### 7.3 "무료 → 유료 전환" 트리거 설계

LinkedIn Premium의 "누가 내 프로필을 봤는지 보려면 Premium으로" 모델을 참고.

| # | 트리거 상황 | 메시지 | 전환 기대 |
|---|----------|-------|---------|
| 1 | **4번째 vault 인덱싱 시도** | "3개까지 무료입니다. 모든 vault를 연결하려면 Pro를 사용하세요." | 높음 (이미 3개를 쓸 정도로 투자한 사용자) |
| 2 | **다른 기기에서 접근 시도** | "Cloud Sync로 어디서든 접근하세요. Pro에서 가능합니다." | 높음 (실제 필요 느끼는 순간) |
| 3 | **Graph Export 시** | "Pro에서 워터마크 없는 고화질 이미지를 받으세요." | 중간 |
| 4 | **Federation 검색 결과 5건 초과** | "더 많은 네트워크 결과를 보려면 Pro의 우선 라우팅을 사용하세요." | 중간 |
| 5 | **"당신의 지식이 이번 주 N번 검색되었습니다"** | "Knowledge Profile을 커스터마이징하여 더 많은 노드에 노출하세요." | 중간-낮음 |

### 7.4 Phase 2 KPI

**North Star: Monthly Recurring Revenue (MRR)**

| KPI | 목표 (Month 12) | 비고 |
|-----|:----------------:|------|
| **MRR** | $800-2,000 | Pro 100-250명 x $8 |
| Pro 전환율 | 3-5% | WAU 기준 |
| Churn Rate | <5%/월 | |
| 총 사용자 | 3,000-5,000 | |
| WAU | 500+ | |
| Federation 노드 | 50+ | |
| GitHub Stars | 3,000-5,000 | |

---

## 8. Phase 3: 생태계 확장 (5,000+, Year 2)

### 8.1 추가 수익원

| 수익원 | 설명 | 예상 MRR 기여 |
|--------|------|:-------------:|
| **Team Plan ($15/user/월)** | 팀 vault 공유, 공동 갭 분석, 팀 대시보드 | $3,000-10,000 |
| **Knowledge Pack Marketplace** | 크리에이터가 전문 지식팩 판매 (30% 수수료) | $500-2,000 |
| **Hosted Federation Relay** | 항상 온라인인 릴레이 노드 호스팅 ($3/월) | $300-1,000 |
| **Enterprise Self-Hosted** | 기업 내부 Federation ($20/user/월, 최소 10석) | $2,000-10,000 |
| **Plugin SDK Marketplace** | 커뮤니티 플러그인 유료 판매 (30% 수수료) | $200-1,000 |

### 8.2 Phase 3 KPI

**North Star: Net Revenue Retention (NRR)**

| KPI | 목표 (Year 2 end) | 비고 |
|-----|:------------------:|------|
| **NRR** | 110%+ | 기존 고객이 더 많이 지불 (Team으로 업그레이드 등) |
| ARR | $120K-300K | |
| 총 사용자 | 10,000+ | |
| Federation 노드 | 500+ | |
| Marketplace 크리에이터 | 50+ | |

---

## 9. 비용 구조 (Phase별)

### Phase 1 (Month 1-6): 최소 비용

| 항목 | 월 비용 | 비고 |
|------|:-------:|------|
| 도메인 (stellavault.dev) | $2 | Cloudflare |
| 호스팅 (랜딩 페이지) | $0 | Cloudflare Pages (무료) |
| CDN | $0 | Cloudflare (무료) |
| npm 배포 | $0 | 공개 패키지 |
| GitHub | $0 | 오픈소스 |
| **총** | **~$2/월** | |

**Phase 1의 유일한 비용은 도메인이다.** 서버가 필요 없다 (모두 로컬).

### Phase 2 (Month 7-12): Cloud 인프라 추가

| 항목 | 월 비용 | 비고 |
|------|:-------:|------|
| 도메인 | $2 | |
| Cloudflare R2 (Cloud Sync) | $20-100 | 사용량 비례 |
| Vercel/Cloudflare (Stella Hub) | $20 | |
| Stripe 수수료 | MRR의 2.9% | |
| 이메일 (Resend/Postmark) | $10-25 | Morning Brief 배달 |
| **총** | **$52-147/월** | |

**Break-even**: Pro 7-19명에서 인프라 비용 회수. Pro 100명이면 인프라 비용 대비 5-10배 수익.

### Phase 3 (Year 2): 팀/엔터프라이즈 인프라

| 항목 | 월 비용 | 비고 |
|------|:-------:|------|
| Phase 2 비용 | $150 | |
| Federation Relay 서버 | $50-200 | 호스팅 relay 수에 비례 |
| DB (Supabase/Planetscale) | $25-100 | |
| 모니터링 (Sentry) | $26 | |
| **총** | **$250-476/월** | |

---

# Part III: Research (pm-research)

> 커뮤니티 규모, 채널, True Fan 정의

## 10. Obsidian 커뮤니티 실제 규모 + 접근 채널

| 채널 | 규모 (2026.04) | 특성 | 접근 전략 |
|------|:-------------:|------|---------|
| **Obsidian 전체 사용자** | ~1.5M 활성 (YoY +22%) | 데스크톱 중심, 개발자/연구자/작가 | 가장 큰 풀이지만 직접 접근 불가 |
| **Obsidian Forum** | 수만 명 활성 | 플러그인 개발자, 파워 유저 중심. 질 높은 토론 | #Share & Showcase, #Plugins |
| **Obsidian Discord** | 100K+ 멤버 | 실시간 채팅. 초보부터 고급까지 | #plugins-showcase, #tools |
| **r/ObsidianMD** (Reddit) | 추정 200K+ 구독자 | 사용 사례, 워크플로우, 비교 | "I made this" 포스트 |
| **Obsidian Plugin 생태계** | 2,749 플러그인, 1억+ 총 다운로드 | kepano 발표: 2026년 플러그인 강화 | 플러그인으로 배포가 가장 큰 채널 |
| **Obsidian Roundup** | 구독자 수천 명 | 주간 뉴스레터, 엘리너 코어링 운영 | 피처 요청 |
| **PKM Weekly** | 구독자 수백-수천 명 | PKM 전반 뉴스레터 | 기고 또는 언급 |
| **YouTube PKM 크리에이터** | 채널당 10K-500K 구독자 | Nicole van der Hoeven, Danny Hatcher 등 | 제품 리뷰 요청 |

**핵심 수치**: Obsidian 플러그인 총 다운로드 1억+. Top 10 플러그인은 200만-500만 다운로드. 신규 플러그인은 주당 5개, 업데이트는 주당 71개. **Obsidian 플러그인으로 배포하면 수만-수십만 명에게 자동 노출된다.**

---

## 11. MCP 개발자 커뮤니티 실제 규모 + 접근 채널

| 채널 | 규모 (2026.04) | 특성 | 접근 전략 |
|------|:-------------:|------|---------|
| **MCP SDK 월간 다운로드** | 97M (2026.03) | CI/CD 포함, 실사용자는 훨씬 적음 | npm 패키지 의존성으로 노출 |
| **MCP 커뮤니티 서버** | 5,800+ | 개발자 도구 1,200+, 비즈니스 앱 950+ | mcp.so, mcpservers.org 등록 |
| **Obsidian MCP 서버** | 10+ (주요 5-6개) | mcp-obsidian, obsidian-mcp-tools, claudesidian 등 | 경쟁 겸 협력 관계 |
| **Claude Code 사용자** | 추정 500K-1M | Claude Pro/Team 구독자 중 CLI 사용자 | Claude Code Discord, Anthropic Forum |
| **GitHub MCP 저장소** | 수천 개 | awesome-mcp-servers 3K+ stars | Awesome list 등록 |

**핵심 수치**: MCP 서버 5,800+ 중 Obsidian 관련은 10여 개. Stellavault의 13개 MCP 도구는 양적으로 최대 수준이며, `search`, `get-decay-status`, `get-morning-brief`, `learning-path` 등 지능형 도구 조합은 차별화 포인트.

---

## 12. PKM 커뮤니티 Top 10

| # | 커뮤니티/플랫폼 | 추정 규모 | 특성 | Stellavault 적합도 |
|---|---------------|----------|------|:------------------:|
| 1 | **Obsidian** | 1.5M+ 활성 | 마크다운, 로컬 우선, 플러그인 | **최고** |
| 2 | **Notion** | 수천만 | 클라우드, 올인원, 팀 중심 | 낮음 (경쟁자) |
| 3 | **Logseq** | 수십만 | 오픈소스, outliner, 로컬 | 높음 (유사 철학) |
| 4 | **Roam Research** | 수만 | 선구자, 학술/연구 | 중간 |
| 5 | **r/PKMS** (Reddit) | 추정 100K+ | PKM 전반 토론 | 높음 |
| 6 | **Tana** | 수만 | AI 네이티브, 구조화 | 중간 |
| 7 | **Capacities** | 수만 | 객체 기반 노트 | 중간 |
| 8 | **Heptabase** | 수만 | 시각적 학습 | 중간 |
| 9 | **Anytype** | 수만 | 오픈소스, 로컬 우선, P2P | 높음 (유사 철학) |
| 10 | **Zettelkasten.de** | 수천 | 학술적 PKM 커뮤니티 | 중간 |

---

## 13. Product Hunt / Hacker News 런칭 전략

### 13.1 Product Hunt

**타이밍**: Month 3-4 (최소 200명 사용자 확보 후). 초기 지지자 확보가 핵심.

**2026년 Product Hunt 현실**:
- 하루 500+ 제출. 경쟁 치열
- "pay-to-win" 동학 존재 — 커뮤니티 미리 확보 필수
- 오픈소스 개발자 도구는 여전히 강세 (Appwrite Sites: #1 Product of the Day)

**성공 사례 벤치마크**:

| 프로젝트 | 결과 | 성공 요인 |
|---------|------|---------|
| Appwrite Sites | #1 Product of Day, Week, Month | "open-source Vercel alternative" — 명확한 포지셔닝 |
| Lingo.dev | #2 Product of Day, #1 Dev Tool | Mega Launch Week 활용, 사전 모멘텀 |
| Supabase | 역대 Top Dev Tool | 지속적 반복 런칭 (5회+) |

**Stellavault 런칭 전략**:

| 항목 | 실행 |
|------|------|
| **태그라인** | "Turn your Obsidian vault into a 3D neural knowledge graph -- with 13 MCP tools for AI" |
| **사전 준비 (4주)** | Discord 200명+, 메이커 50명+ 사전 알림 등록 |
| **비주얼** | 3D 그래프 GIF (첫 이미지), MCP 도구 데모 영상, 설치→검색 3분 튜토리얼 |
| **런칭 요일** | 화요일 PST 00:01 (경쟁 적절 + 주 초 트래픽 높음) |
| **팔로업** | 모든 댓글 1시간 내 답변. 기술적 질문 상세 답변 |

### 13.2 Hacker News

**타이밍**: Product Hunt 1-2주 후 (모멘텀 이어가기).

**포맷**: `Show HN: Stellavault -- Open-source knowledge graph with 13 MCP tools, 3D viz, and FSRS memory decay`

**HN 성공 요인**:
- 기술적 깊이 (vector search + BM25 RRF, FSRS 알고리즘, Hyperswarm P2P)
- 오픈소스
- "I built this" 정직함
- 댓글에서의 기술 토론 참여

**기대**: 100-500 포인트 → 300-2,000 방문 → 50-200 설치

---

## 14. "1,000 True Fans" -- Stellavault의 True Fan

Kevin Kelly의 "1,000 True Fans" 이론을 Stellavault에 적용.

### 14.1 True Fan 프로필

Stellavault의 True Fan은 이런 사람이다:

> **"Obsidian에 500개+ 노트를 쌓아온 개발자/연구자. Claude Code를 매일 사용한다. MCP를 통해 AI가 자신의 지식을 이해하기를 원한다. 지식 관리에 주 2시간 이상 투자한다. 'Second Brain' 철학을 실천하고 있다."**

| 속성 | 구체적 |
|------|-------|
| **직업** | 소프트웨어 엔지니어, 연구자, 테크 리더, DevRel |
| **노트 수** | 500-5,000개 |
| **Obsidian 사용기간** | 1년+ |
| **AI 도구** | Claude Code, Cursor, Windsurf 중 하나 이상 매일 사용 |
| **결제 의향** | 도구에 $8-20/월 지출 가능. 이미 Obsidian Sync, Notion, GitHub Copilot 등 유료 구독 중 |
| **커뮤니티 참여** | Reddit, Discord, 블로그 중 하나 이상에서 활동 |
| **운영 체제** | macOS 65%, Linux 25%, Windows 10% |

### 14.2 True Fan이 기꺼이 지불하는 것

| 가치 | 왜 돈을 내는가 |
|------|-------------|
| **"Claude가 내 과거 결정을 안다"** | AI 코딩 시 일관성 향상 — 시간 절약의 핵심 |
| **"잊고 있던 노트를 리마인드"** | FSRS 감쇠 알림 — 지식 유지의 안도감 |
| **"내 지식 지도를 볼 수 있다"** | 3D 그래프 — 메타 인지의 즐거움 |
| **"팀원의 지식도 검색"** | Federation — 팀 생산성 향상 |
| **"어디서든 접근"** | Cloud Sync — 편의성 |

### 14.3 True Fan 도달 경로

```
전 세계 Obsidian 활성 사용자: ~1,500,000명
  ↓ (CLI 사용 가능한 파워 유저: ~10%)
~150,000명
  ↓ (AI 코딩 도구 사용: ~30%)
~45,000명
  ↓ (MCP 인식/사용: ~20%)
~9,000명
  ↓ (Stellavault 인지 + 설치: ~10%)
~900명
  ↓ (Pro 전환: ~30% — True Fan이므로 높은 전환율)
~270 True Fans (Pro)

Target: Year 1 end → 300 True Fans = $2,400/월 MRR
```

---

# Part IV: PRD (pm-prd)

> 실행에 필요한 구체적 기능 목록과 스펙

## 15. Phase 1에 필요한 최소 기능 목록

### 15.1 지금 구현된 기능 분류

**Phase 1 필수 (이미 구현) -- 유지/안정화만**:

| # | 기능 | 이유 |
|---|------|------|
| 1 | `stellavault index` | 핵심 진입점. vault 인덱싱 |
| 2 | `stellavault search` | 핵심 가치. MCP search 도구와 연결 |
| 3 | MCP search, get-document, list-topics, get-related | Claude가 vault를 이해하는 핵심 4도구 |
| 4 | MCP get-decay-status, get-morning-brief | 리텐션 도구 — 매일 돌아올 이유 |
| 5 | `stellavault status` | 건강 체크 |
| 6 | `stellavault serve` | MCP 서버 시작 |
| 7 | 3D Knowledge Graph | 바이럴 루프의 핵심 |
| 8 | FSRS 감쇠 엔진 | 차별화 기능 |

**Phase 1 필수 (신규 개발) -- 반드시 만들어야**:

| # | 기능 | 왜 필수인가 | 예상 노력 |
|---|------|-----------|---------|
| 1 | **stellavault.dev 랜딩 페이지** | 설치 전환의 유일한 게이트. Product Hunt/HN 트래픽 수신 | 1-2주 |
| 2 | **Obsidian 플러그인 MVP** | CLI 없이 사용 가능하게. 설치 마찰 95% 제거 | 3-4주 |
| 3 | **Onboarding 개선** | `stellavault init` 이 wizard 형태로 안내. 설치 → 인덱싱 → MCP 설정까지 | 1주 |
| 4 | **Graph Export + Watermark** | 바이럴 루프의 핵심 기능 | 2-3일 |
| 5 | **opt-in 텔레메트리** | KPI 측정 없이는 의사결정 불가 | 1주 |
| 6 | **README/Docs 정비** | GitHub 첫 인상. 설치부터 가치 체험까지 3분 경로 | 1주 |

**나중에 해도 되는 것 (Phase 2-3)**:

| # | 기능 | 왜 나중인가 |
|---|------|-----------|
| 1 | Cloud Sync | Pro 기능. Phase 1에서는 로컬만 |
| 2 | Team Vault | 사용자 기반 필요 |
| 3 | Plugin SDK | 생태계 필요 |
| 4 | Marketplace | 크리에이터 필요 |
| 5 | Enterprise 기능 (RBAC, SSO) | 너무 이르다 |
| 6 | Voice Capture | 니치 |
| 7 | PWA | 모바일은 나중 |
| 8 | Webhooks | 자동화는 파워 유저용 |
| 9 | i18n (다국어) | 영어 먼저 |
| 10 | Semantic Versioning | 파워 유저용 |

**과감히 안 해도 되는 것 (재평가 필요)**:

| # | 기능 | 비고 |
|---|------|------|
| 1 | Federation Phase 2 (Multiverse UI, Notion 파이프라인) | 10노드 이전에는 의미 없음 |
| 2 | Agentic Graph | AI 에이전트가 그래프를 직접 탐색 — 사용자 수 확보 후 |
| 3 | Web Dashboard | 로컬 CLI + 그래프로 충분 |
| 4 | Knowledge Pack Marketplace | 크리에이터 0명인 마켓은 빈 식당 |

---

### 15.2 Stella Hub MVP 스펙

**역할**: 가벼운 중앙 서비스. 계정, 결제, 프로필, 텔레메트리.

**기술 스택**: Next.js 14+ (App Router) + Stripe + Supabase (or Cloudflare D1)

**최소 기능**:

| 기능 | 설명 | 엔드포인트 |
|------|------|----------|
| **회원가입/로그인** | GitHub OAuth (메인) + 이메일 | `/auth/github`, `/auth/email` |
| **프로필** | Knowledge Profile — 전문 분야, 기여 통계, 공개 vault 통계 | `/profile/{username}` |
| **Pro 구독** | Stripe Checkout → Pro 활성화 | `/api/billing/checkout` |
| **텔레메트리 수신** | opt-in 사용 통계 수신 | `/api/telemetry` |
| **API 키 발급** | Pro 사용자용 API 키 | `/api/keys` |
| **Cloud Sync 엔드포인트** | R2 presigned URL 발급 (Pro만) | `/api/sync/upload`, `/api/sync/download` |
| **Federation Registry** | 노드 등록/디스커버리 (Hyperswarm 보조) | `/api/federation/register` |
| **대시보드** | 내 사용 통계, 구독 관리, Federation 상태 | `/dashboard` |

**DB 스키마 (최소)**:

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  github_id TEXT UNIQUE,
  email TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  plan TEXT DEFAULT 'free', -- 'free' | 'pro' | 'team'
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- profiles (Knowledge Profile)
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  bio TEXT,
  domains TEXT[], -- ['rust', 'p2p', 'ml']
  vault_note_count INTEGER DEFAULT 0,
  federation_contributions INTEGER DEFAULT 0,
  public BOOLEAN DEFAULT true
);

-- subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active' | 'canceled' | 'past_due'
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- api_keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  key_hash TEXT NOT NULL,
  name TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- telemetry (익명, opt-in)
CREATE TABLE telemetry_events (
  id UUID PRIMARY KEY,
  anonymous_id TEXT NOT NULL, -- hashed machine id
  event_type TEXT NOT NULL, -- 'mcp_call' | 'cli_cmd' | 'graph_open'
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- federation_nodes
CREATE TABLE federation_nodes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  node_id TEXT UNIQUE NOT NULL, -- Hyperswarm public key
  display_name TEXT,
  domains TEXT[],
  trust_score REAL DEFAULT 40,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**배포**: Vercel (Next.js) + Supabase (DB) + Cloudflare R2 (Cloud Sync 스토리지) + Stripe (결제)

**예상 개발 기간**: 3-4주 (MVP)

---

### 15.3 stellavault.dev 랜딩 페이지 스펙

**기술 스택**: Next.js (Stella Hub과 동일 프로젝트) + Tailwind CSS + Framer Motion

**페이지 구조**:

```
stellavault.dev/
  ├── / (랜딩)
  │   ├── Hero: "Your Obsidian vault, understood by AI"
  │   │   ├── 3D 그래프 인터랙티브 데모 (WebGL, 축소판)
  │   │   ├── "npm install -g stellavault" CTA
  │   │   ├── GitHub stars 배지
  │   │   └── "Open Source | MIT License"
  │   │
  │   ├── Problem: "Your AI doesn't know you"
  │   │   └── Before/After 비교 (Claude without context vs with Stellavault)
  │   │
  │   ├── Features (4개만):
  │   │   ├── 1. 13 MCP Tools (gif: Claude가 vault 검색하는 데모)
  │   │   ├── 2. 3D Knowledge Graph (인터랙티브 데모)
  │   │   ├── 3. FSRS Memory Decay (heatmap 시각화)
  │   │   └── 4. Federation (아이콘 + "Coming: connect with your team")
  │   │
  │   ├── Installation: 3-step (npm install → init → serve)
  │   │
  │   ├── Testimonials (초기에는 제작자 사용 사례)
  │   │
  │   └── Footer: GitHub, Discord, Twitter, Docs
  │
  ├── /docs (문서)
  ├── /pricing (Phase 2에 추가)
  └── /profile/{username} (Knowledge Profile — Phase 2)
```

**핵심 디자인 원칙**:
1. **3초 규칙**: 방문 3초 내에 "이게 뭐하는 건지" 알 수 있어야
2. **어두운 테마**: 개발자 대상. 밝은 테마는 토글로
3. **인터랙티브 3D 그래프**: Hero 영역에 실제 그래프 (축소판, 성능 최적화)
4. **"npm install" 원클릭 복사**: 설치 마찰 최소화
5. **로딩 3초 이내**: Core Web Vitals 최적화

**예상 개발 기간**: 1-2주

---

### 15.4 Obsidian 플러그인 MVP 스펙

**왜 플러그인이 필수인가**:
- Obsidian 플러그인 마켓플레이스는 2,749개 플러그인, 1억+ 총 다운로드
- **플러그인 = Obsidian의 자체 마케팅 채널**. 등록만 하면 수만 명에게 노출
- CLI 설치 → 터미널 → MCP 설정의 3단계 마찰을 "플러그인 설치 1-click"으로 줄임
- "CLI에 익숙하지 않은" 80%의 Obsidian 사용자에게 접근 가능

**기술 스택**: Obsidian Plugin API + TypeScript

**MVP 기능**:

| # | 기능 | 설명 | 우선순위 |
|---|------|------|:-------:|
| 1 | **One-click Index** | 현재 vault를 자동 인덱싱 (Stellavault Core를 번들하거나 로컬 서버 호출) | P0 |
| 2 | **Search Panel** | 사이드바에서 시맨틱 검색. Obsidian의 기본 검색보다 나은 결과 | P0 |
| 3 | **MCP Server 관리** | "Start MCP Server" / "Stop MCP Server" 버튼. 설정 UI | P0 |
| 4 | **3D Graph View** | Obsidian 내 탭으로 3D 그래프 표시 (기존 graph 패키지 재사용) | P1 |
| 5 | **Decay Status 패널** | 사이드바에 감쇠 중인 노트 목록 | P1 |
| 6 | **Morning Brief 노트** | 매일 아침 브리핑을 Daily Note에 자동 추가 | P1 |
| 7 | **Gap Detector UI** | 지식 갭을 사이드바에 표시 | P2 |

**구현 전략**:
- Option A: Stellavault Core를 번들 (큰 플러그인, 하지만 독립적)
- Option B: 로컬 Stellavault CLI를 호출 (가벼운 플러그인, 하지만 CLI 설치 필요)
- **추천: Option B** — 초기에는 CLI 설치를 가이드하되, 플러그인 UI에서 모든 것을 조작. 향후 Core 번들로 전환.

**Obsidian 플러그인 마켓플레이스 등록 요건**:
- 공개 GitHub 리포
- manifest.json, main.js, styles.css
- 코드 리뷰 통과 (1-2주)

**예상 개발 기간**: 3-4주 (MVP, Option B)

---

## 16. 12개월 로드맵 (월별 마일스톤)

### Month 1: 기반 정비

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| README 재작성 | GitHub README.md | 설치→검색→MCP 설정까지 3분 경로 |
| stellavault.dev 랜딩 | 라이브 웹사이트 | 3초 규칙 통과, CWV 양호 |
| `stellavault init` wizard 개선 | CLI 업데이트 | 초기 설정 5분 내 완료 |
| Graph Export + Watermark | CLI/Graph 업데이트 | PNG 출력 + 워터마크 |
| Awesome list PR | awesome-obsidian, awesome-mcp | PR 머지 |
| opt-in 텔레메트리 기초 | 코어 업데이트 | 이벤트 수집 시작 |

**KPI**: GitHub Stars 50+, 첫 외부 사용자 5명+

### Month 2: 커뮤니티 씨앗

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| Obsidian Forum 튜토리얼 2개 | 포럼 포스트 | 각 20+ 조회 |
| Reddit 포스트 2개 | r/ObsidianMD, r/PKMS | 각 10+ upvotes |
| Claude/MCP 커뮤니티 소개 | 포럼/Discord 포스트 | 반응 확인 |
| Obsidian 플러그인 개발 시작 | 개발 브랜치 | P0 기능 50% |
| 첫 20명 사용자 인터뷰 시작 | 설문 결과 | 가설 1 검증 시작 |

**KPI**: 외부 사용자 30+, GitHub Issues 10+

### Month 3: Product Hunt 준비 + 플러그인 베타

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| Obsidian 플러그인 MVP 완성 | 플러그인 베타 | P0 기능 100% |
| 베타 테스터 모집 | Discord 20명 | 피드백 10건+ |
| Product Hunt 사전 준비 | Maker 프로필, 지지자 50명 | 런칭 준비 완료 |
| 영상 콘텐츠 제작 | YouTube/Loom 데모 3개 | 각 100+ 조회 |
| DEV.to 기술 블로그 2편 | 블로그 포스트 | 각 500+ 조회 |

**KPI**: 외부 사용자 80+, Discord 멤버 50+

### Month 4: Product Hunt 런칭

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| **Product Hunt 런칭** | #Top 10 Dev Tool | 500+ upvotes |
| Hacker News Show HN | HN 포스트 | 100+ 포인트 |
| Obsidian 플러그인 마켓 등록 | 공식 플러그인 | 리뷰 통과 |
| 가설 1 결과 분석 | 검증 보고서 | Go/No-go 결정 |

**KPI**: 총 사용자 300+, GitHub Stars 500+, 플러그인 다운로드 500+

### Month 5: 리텐션 + 안정화

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| 사용자 피드백 기반 개선 | 버그 수정 + UX 개선 | Top 10 이슈 해결 |
| 리텐션 분석 | DAU/WAU 트렌드 | 리텐션 곡선 확인 |
| 주간 뉴스레터 시작 | "This Week in Stellavault" | 구독자 100+ |
| Federation 베타 테스트 | 5명 x 2그룹 | 가설 3 검증 |
| Stella Hub 개발 시작 | MVP 브랜치 | DB 스키마 + Auth |

**KPI**: WAU 100+, 1주차 리텐션 30%+

### Month 6: 1,000명 도달 + Pro 준비

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| Stella Hub MVP | 라이브 서비스 | Auth + Profile + 텔레메트리 |
| Knowledge Profile v1 | 공개 프로필 페이지 | 프로필 생성 가능 |
| Pro 기능 구현 시작 | Cloud Sync 프로토타입 | R2 연동 |
| 가격 테스트 | 설문 + 랜딩 가격 A/B | WTP 확인 |
| GitHub Sponsors 시작 | 후원 페이지 | 첫 스폰서 |

**KPI**: 총 사용자 1,000+, WAU 200+, GitHub Stars 1,000+, NPS 40+

### Month 7: Pro 런칭

| 작업 | 산출물 | 완료 기준 |
|------|-------|---------|
| **Pro 구독 런칭** | Stripe 연동, 결제 | 첫 Pro 가입자 |
| Cloud Sync 출시 | Pro 기능 | 멀티 디바이스 동기화 |
| Pro 온보딩 플로우 | 전환 퍼널 | 3-5% 전환율 |
| 2차 Product Hunt 런칭 | "Stellavault Pro" | 추가 노출 |

**KPI**: Pro 10+, MRR $80+

### Month 8-9: 성장 가속

| 작업 | 산출물 |
|------|-------|
| Federation 공개 출시 | 누구나 Federation 참여 |
| Knowledge Profile 확장 | 전문 분야, 기여 통계, 뱃지 |
| 팀 Plan 개발 시작 | Team vault 공유 |
| 커뮤니티 이벤트 | "Knowledge Graph Week" |
| Obsidian Roundup/PKM Weekly 피처 | 뉴스레터 소개 |

**KPI**: 총 사용자 2,000+, Pro 50+, Federation 노드 20+

### Month 10-11: Team + 생태계

| 작업 | 산출물 |
|------|-------|
| **Team Plan 런칭** | $15/user/월 |
| Plugin SDK v1 | 커뮤니티 플러그인 가능 |
| Knowledge Pack Marketplace v1 | 크리에이터 업로드 + 판매 |
| 학술/연구 커뮤니티 파트너십 | 대학/연구소 파일럿 |

**KPI**: 총 사용자 3,000+, Pro 100+, Team 고객 5+, MRR $1,500+

### Month 12: Year 1 총결

| 작업 | 산출물 |
|------|-------|
| Year 1 회고 + Year 2 계획 | 전략 문서 |
| 커뮤니티 감사 이벤트 | 기여자 인정 |
| Enterprise 파일럿 탐색 | 기업 2-3곳 접촉 |

**Year 1 최종 KPI**:

| 지표 | 낙관적 | 현실적 | 최악 |
|------|:------:|:------:|:----:|
| 총 사용자 | 5,000+ | 2,000-3,000 | 500-1,000 |
| Pro 유료 | 250+ | 100-150 | 30-50 |
| MRR | $2,000+ | $800-1,200 | $240-400 |
| GitHub Stars | 5,000+ | 2,000-3,000 | 500-1,000 |
| Federation 노드 | 100+ | 30-50 | 5-10 |
| Obsidian 플러그인 다운로드 | 20,000+ | 5,000-10,000 | 1,000-3,000 |
| NPS | 50+ | 40-50 | 30-40 |

---

# Part V: 리스크 및 대응

## 17. Pre-mortem: 실패 시나리오 Top 5

### 시나리오 1: "설치 마찰로 사용자 0명" (확률: 높음)

**원인**: npm install → CLI → MCP 설정의 3단계가 비개발자에게 너무 어렵다.
**징후**: 설치 수 많으나 MCP 도구 호출 0, GitHub Issues에 "how to set up" 질문 폭주.
**대응**:
- Obsidian 플러그인으로 마찰 95% 제거 (Month 3-4)
- `stellavault init` wizard를 대화형으로 개선 (Month 1)
- 3분 설치 영상 제작 (Month 2)

### 시나리오 2: "가치를 못 느끼고 1주 내 이탈" (확률: 중간-높음)

**원인**: MCP 도구의 가치가 즉각적이지 않다. 인덱싱 후 "그래서?" 모먼트.
**징후**: WAU/DAU 비율 급감, 1주 리텐션 20% 미만.
**대응**:
- "First Search Moment" 강제: 설치 직후 검색 예시 자동 실행
- Morning Brief를 기본 활성화: 매일 아침 가치 리마인드
- "Your vault in numbers" 대시보드: 즉각적 시각적 피드백

### 시나리오 3: "솔로 개발자 번아웃" (확률: 매우 높음)

**원인**: 22개 CLI, 13개 MCP, 3D 그래프, Federation, 플러그인, Hub... 한 명이 유지 불가.
**징후**: 이슈 응답 지연, 업데이트 간격 2주+, 코드 품질 저하.
**대응**:
- **Phase 1에서 범위 축소**: Federation/Hub/Marketplace는 뒤로
- **코어만 유지**: index, search, MCP, graph, decay — 이 5개만 100% 안정
- **기여자 확보**: "Good First Issue" 라벨링, CONTRIBUTING.md 정비
- **자동화**: CI/CD, 자동 테스트, dependabot

### 시나리오 4: "경쟁자가 같은 기능 구현" (확률: 중간)

**원인**: Khoj (21K stars)나 Obsidian 공식이 MCP + FSRS 통합 출시.
**징후**: 경쟁 제품 발표, 사용자 유입 둔화.
**대응**:
- **선점**: Phase 1에서 최대한 빨리 Obsidian 플러그인 등록. 먼저 자리 잡기
- **깊이로 차별화**: 13개 MCP 도구의 지능적 조합은 쉽게 복제 불가
- **커뮤니티 모트**: 충성 사용자 100명이 최고의 방어

### 시나리오 5: "Federation에 아무도 참여하지 않음" (확률: 높음)

**원인**: Business evaluation의 경고 — "누가 자기 지식을 P2P로 공유하려 하는가?"
**징후**: 6개월간 Federation 노드 10개 미만.
**대응**:
- **피봇**: "P2P Federation"이 아닌 "팀 내부 Federation"으로 스코프 축소
- **대안**: Federation 대신 "멀티 vault 통합 검색"(자기 Obsidian + Notion 동시 검색)
- **수용**: Federation을 Year 2 기능으로 재분류. Phase 1은 개인 도구에만 집중

---

## 18. 핵심 의사결정 트리

```
사용자 0명인 지금, 뭘 먼저 하나?
│
├─ [1] stellavault.dev 랜딩 페이지 (Week 1-2)
│   └─ 트래픽 수신 준비
│
├─ [2] README + Docs 정비 (Week 1-2)
│   └─ GitHub 첫 인상
│
├─ [3] Obsidian Forum/Reddit/Discord 포스팅 시작 (Week 2+)
│   └─ 수동 1:1로 첫 30명
│
├─ [4] Obsidian 플러그인 개발 (Week 2-6)
│   └─ 설치 마찰 제거
│
├─ [5] Product Hunt/HN 런칭 (Month 4)
│   └─ 100 → 500명 점프
│
├─ [6] Stella Hub MVP (Month 5-6)
│   └─ Pro 준비
│
└─ [7] Pro 런칭 (Month 7)
    └─ 첫 매출
```

---

## 19. 성공/실패 판단 기준

| 시점 | 성공 | 경고 | 실패 |
|------|------|------|------|
| **Month 3** | 사용자 100+, GitHub Issues 활발 | 50-100 사용자, 낮은 참여 | 30 미만, 피드백 0 |
| **Month 6** | 1,000+, NPS 40+, 바이럴 관찰 | 300-500, 성장 둔화 | 100 미만, 리텐션 5% 미만 |
| **Month 9** | Pro 50+, MRR $400+ | Pro 10-30, 전환율 2% 미만 | Pro 5 미만 |
| **Month 12** | Pro 100+, MRR $800+, 커뮤니티 자생 | Pro 30-50, 성장 불확실 | Pro 10 미만, 번아웃 |

**Month 6에서 사용자 100명 미만이면**:
1. 가설 재검토: "이 제품이 문제를 풀고 있는가?"
2. 피봇 고려: "MCP Knowledge Server" (Stellavault 코어를 범용 MCP 지식 서버로)
3. 또는: 사이드 프로젝트로 유지하며 학습/포트폴리오 가치 수확

---

## 20. Attribution

이 분석은 다음 프레임워크와 데이터를 활용했습니다:

**PM Frameworks**:
- Teresa Torres, Opportunity Solution Tree (5-Step Discovery Chain)
- Andrew Chen, "The Cold Start Problem" (Atomic Network, Hard Side)
- Kevin Kelly, "1,000 True Fans"
- Strategyzer, Value Proposition Canvas
- Ash Maurya, Lean Canvas
- Pawel Huryn, JTBD 6-Part Value Proposition

**시장 데이터 (2026.04)**:
- Obsidian: ~1.5M 활성 사용자, 2,749 플러그인, 1억+ 총 다운로드 (fueler.io, obsidianstats.com, kepano X)
- MCP: 97M 월간 SDK 다운로드, 5,800+ 서버 (digitalapplied.com, pento.ai, cdata.com)
- SaaS Freemium 전환율: 3-5% (firstpagesage.com, 2026 보고서)
- Product Hunt: 500+ 일간 제출, Appwrite/Lingo.dev 사례 (producthunt.com, purshology.com)

**선행 분석**:
- `stellavault-advanced.prd.md` -- 22 features, 5 tiers
- `stellavault-federation.prd.md` -- Hyperswarm P2P, WoT
- `stellavault-incentives.prd.md` -- 3-layer incentives, SDT, cultural analysis
- `stellavault-business-evaluation.md` -- Score 3.5/10, No-Go as business

---

> **PM Agent Team 분석 완료.**
>
> 이 문서는 "이대로 실행하면 된다" 수준의 구체성을 목표로 작성되었습니다.
> 단, 모든 가설은 실제 사용자 데이터로 검증되어야 하며, 첫 100명의 피드백이
> 이 로드맵의 60%를 변경시킬 수 있습니다. 계획은 계획일 뿐, 실행하며 조정하세요.
