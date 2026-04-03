# Stellavault 인센티브 멀티 에이전트 브레인스토밍

> **PM Agent Team Brainstorm** | 생성일: 2026-04-02
>
> 기반 분석: `stellavault-incentives.prd.md` (776줄, 인센티브 심층 분석)
> 관련 PRD: `stellavault-advanced.prd.md`, `stellavault-federation.prd.md`
>
> 4개 PM 에이전트 관점: Discovery / Strategy / Research / PRD

---

## Part I: pm-discovery -- 가설 검증 실험 설계

> 프레임워크: Teresa Torres의 Continuous Discovery + Lean Experimentation

### 1. 실험 E1: Knowledge Profile vs LinkedIn 전문성 증명 효과

**가설**: "Knowledge Profile이 LinkedIn의 자기선언형 스킬 목록보다 전문성을 더 객관적이고 설득력 있게 증명한다"

#### 1.1 실험 설계: Paired Evaluation Test

```
실험 대상: 채용 담당자 / 기술 면접관 30명
방법: Within-Subject A/B (같은 사람이 두 포맷을 모두 평가)

Step 1: 가상 후보 5명 프로필 생성
  - LinkedIn 버전: 스킬 목록 + 동료 추천 + 경력
  - Knowledge Profile 버전: 도메인 전문성 점수 + 검색 기여 통계 + Activity Heatmap + 뱃지

Step 2: 채용 담당자에게 순서를 랜덤화하여 제시
  - "이 후보의 Rust 전문성을 1-10으로 평가해주세요"
  - "이 후보를 인터뷰에 초대하시겠습니까?"
  - "두 프로필 중 어떤 것이 전문성을 더 잘 보여줍니까?"

Step 3: 측정 지표
  - 전문성 신뢰도 (1-10 Likert)
  - 인터뷰 초대 의향 (Yes/No)
  - 프로필 간 선호도 (forced choice)
  - 평가 소요 시간 (Knowledge Profile이 더 빠를 것으로 예상)
```

**성공 기준**: Knowledge Profile 선호도 > 60%, 전문성 신뢰도 평균 차이 > 1.5점
**비용**: 낮음 (설문/인터뷰 기반, 프로토타입 불필요)
**기간**: 2주

#### 1.2 보완 실험: Self-Perception Test

```
대상: Obsidian 파워 유저 20명
방법:
  1. 참가자의 vault를 분석하여 가상 Knowledge Profile 생성
  2. "이 프로필이 당신의 전문성을 정확히 반영하나요?" (1-10)
  3. "이 프로필을 동료/채용담당자에게 공유하시겠습니까?" (Yes/No + 이유)
  4. "LinkedIn 프로필보다 이것이 더 정확하다고 느끼십니까?" (Yes/No)

성공 기준: 정확성 7+/10, 공유 의향 > 50%
```

### 2. 실험 E2: Opt-out vs Opt-in 네트워크 성장 비교

**가설**: "Federation 참여 기본값을 opt-out으로 설정하면 opt-in 대비 네트워크 노드 수가 3배 이상 많다"

#### 2.1 실험 설계: Split Cohort Test

```
대상: Stellavault 신규 사용자 200명 (베타 모집)
방법: Between-Subject RCT

Group A (opt-out, n=100):
  - 설치 시 "Federation이 활성화되었습니다. 비활성화하려면 설정에서 변경하세요"
  - 임베딩 공유가 자동 시작
  - 설정 메뉴에 "Federation 끄기" 옵션 존재

Group B (opt-in, n=100):
  - 설치 시 "Federation에 참여하시겠습니까?" 명시적 질문
  - "예"를 선택해야 임베딩 공유 시작
  - 가치 설명 팝업 포함 (동일 조건)

측정 지표 (30일간):
  Primary:
  - 활성 노드 수 (Day 1, 7, 14, 30)
  - Federation 검색 사용 횟수
  Secondary:
  - Federation 끄기/나가기 비율
  - 프라이버시 관련 불만 피드백 수
  - NPS (Day 30)

주의:
  - 프라이버시 고지는 두 그룹 모두 동일하게 제공
  - opt-out 그룹에도 "임베딩만 공유, 원문 미공유" 명확 안내
  - 윤리: opt-out이라도 사용자가 모르게 하면 안 됨
    → "활성화되었습니다" 명시 + 1-click 비활성화 보장
```

**성공 기준**: opt-out 그룹 활성 노드 > opt-in 그룹의 2.5배 (Day 30 기준)
**위험 완화**: opt-out에서 불만율 > 20%이면 중단, opt-in에 가치 설명 개선으로 전환
**기간**: 6주 (모집 2주 + 관찰 4주)

#### 2.2 보완: 프라이버시 인식 사전 조사

```
E2 실행 전, 대상 사용자 50명에게 사전 설문:
  - "임베딩 벡터만 공유된다는 설명이 충분히 안심됩니까?" (1-10)
  - "어떤 추가 보장이 있으면 참여하시겠습니까?" (자유 응답)
  - 결과에 따라 opt-out 그룹의 고지 문구 조정
```

### 3. 실험 E3: 뱃지/리더보드 참여율 A/B 테스트

**가설**: "뱃지+Activity Heatmap이 있으면 주간 검색 서빙 횟수가 40% 이상 증가한다"

#### 3.1 실험 설계: Feature Flag A/B Test

```
대상: 기존 Federation 활성 노드 100개 (최소 2주 사용 이력)
방법: Between-Subject, Feature Flag 기반

Group A (Control, n=50):
  - 현재 상태 유지 (기본 크레딧만 표시)

Group B (Treatment, n=50):
  - 뱃지 시스템 활성화 (8종)
  - Activity Heatmap 표시
  - 주간 임팩트 알림 ("당신의 지식이 N번 검색됨")
  - 도메인 전문가 레벨 표시

측정 지표 (4주간):
  Primary:
  - 주간 검색 서빙 횟수 (Group B / Group A)
  - 노드 온라인 유지 시간
  Secondary:
  - 뱃지 조건 진행률 확인 빈도 (B 그룹만)
  - CLI 사용 빈도 변화
  - 자발적 vault 업데이트 빈도
  - 30일 리텐션

부가 측정 (질적):
  - 4주 후 인터뷰 10명 (B 그룹)
  - "뱃지가 행동에 영향을 미쳤습니까?"
  - "어떤 뱃지/기능이 가장 동기 부여가 되었습니까?"
```

**성공 기준**: 주간 서빙 횟수 > 30% 증가, 리텐션 > 10%p 향상
**주의**: Goodhart's Law 모니터링 -- 서빙 횟수만 증가하고 품질은 하락하는지 확인

#### 3.2 보완: 리더보드 독성 테스트

```
실험 E3 4주 후, Group B를 다시 분할:

Group B1 (n=25): 리더보드 ON (그룹 내 순위 공개)
Group B2 (n=25): 리더보드 OFF (개인 성장 모드만)

2주간 관찰:
  - 참여 행동의 질적 변화 (저품질 서빙 급증 여부)
  - 커뮤니티 감정 분석 (부정적 피드백 빈도)
  - 하위 50% 사용자의 참여 변화 (리더보드가 의욕을 꺾는지)

가설: 상위 사용자에게는 리더보드가 추가 동기, 하위 사용자에게는 역효과
→ "상위 30%에게만 리더보드 표시" 같은 세분화 전략 도출 가능
```

### 4. 콜드 스타트: 첫 100명 확보 전략

**가설**: "Atomic Network 전략(팀/연구실 단위 3-5명)이 개별 초대보다 30일 리텐션이 2배 높다"

#### 4.1 채널별 구체적 전략

| # | 채널 | 구체적 행동 | 메시지 | 목표 인원 | 예상 전환율 |
|---|------|-----------|--------|----------|------------|
| C1 | **Obsidian Discord** (#plugin-dev, #workflow-share) | "Stellavault Federation 비공개 베타 -- 당신의 AI 에이전트가 동료의 지식에도 접근" | "CLI 하나로 팀 지식이 연결됩니다. 비공개 베타 신청 →" | 30명 | 15% (200명 도달 기준) |
| C2 | **Claude Code 커뮤니티** (Discord/Forum) | MCP 도구 데모 -- "Claude가 팀 전체의 vault를 검색합니다" | "stellavault federate join -- Claude에게 팀의 지식을 선물하세요" | 20명 | 25% (MCP 유저는 전환율 높음) |
| C3 | **대학 연구실 직접 접근** | 한국/미국 CS 연구실 10곳 직접 이메일 -- "논문 리뷰 노트를 팀과 공유" | "연구실 5명이 연결되면 논문 검색이 5배 빨라집니다" | 25명 (5개 연구실 x 5명) |  10% (이메일 기반) |
| C4 | **Hacker News Show HN** | Federation + Privacy 기술 데모 영상 + HN 포스트 | "Show HN: P2P knowledge sharing where nobody reads your notes" | 15명 | 3% (HN 500 upvote 기준) |
| C5 | **Product Hunt Launch** | Stellavault Advanced + Federation 동시 런칭 | "Your knowledge, alive and intelligent -- now connected" | 10명 | 2% |

#### 4.2 Atomic Network Seeding 전략

```
Phase 0: 내부 시드 (Week 1-2)
  - Stellavault 개발팀 + 가까운 개발자 동료 5명
  - 실제 사용하며 UX 이슈 발견
  - "Founding Node" 뱃지 발급

Phase 1: 첫 Atomic Network 3개 (Week 3-6)
  - Target 1: Obsidian Discord의 "PKM 스터디 그룹" 5명
  - Target 2: Claude Code MCP 개발자 팀 5명
  - Target 3: 대학 CS 연구실 1곳 5명

  각 그룹에 제공:
  - 1:1 온보딩 지원 (Zoom 15분)
  - 그룹 Federation 자동 설정 스크립트
  - 2주간 주간 피드백 세션
  - "Founding Node" 뱃지

Phase 2: 유기적 확산 (Week 7-12)
  - Phase 1 사용자들이 각자 1명씩 초대하도록
  - 초대자에게 "Newcomer Guide" 뱃지 부여
  - 각 Atomic Network가 2-3명 성장 → 총 30-40명

Phase 3: 공개 베타 (Week 13+)
  - HN/PH 런칭
  - Phase 1-2의 사용 사례를 블로그/영상으로
  - 목표: 100 노드 돌파
```

#### 4.3 초대 메커니즘 구체화

```
# 그룹 초대 CLI 명령
sv federate invite --group maya-lab --count 5

# 출력:
#   초대 링크 생성됨: https://stellavault.dev/join/abc123
#   이 링크로 가입한 노드는 자동으로 maya-lab 그룹에 참여합니다.
#   초대 코드: SV-MAYA-2026 (5회 사용 가능)
#
#   공유 메시지 (복사됨):
#   "Stellavault Federation에 초대합니다!
#    당신의 AI 에이전트가 우리 팀의 지식에 접근할 수 있게 됩니다.
#    당신의 노트는 절대 공유되지 않습니다 -- 임베딩 벡터만 사용합니다.
#    가입: https://stellavault.dev/join/abc123"
```

### 5. Opportunity Solution Tree -- 인센티브 가설 검증

```
                      "지식 정체성 구축"이 핵심 동기인가?
                                    |
          +-------------------------+-------------------------+
          |                         |                         |
   [E1] Knowledge Profile     [E2] Opt-out vs          [E3] 뱃지/리더보드
   전문성 증명 효과             Opt-in 성장률             참여율 영향
          |                         |                         |
     +----+----+             +------+------+           +------+------+
     |         |             |             |           |             |
  LinkedIn   Self        Opt-out       Privacy      뱃지만      뱃지+
  비교 평가   Perception  30일 노드수   불만율        A/B        리더보드
                                                                 독성 test
          |                         |                         |
   [결과 시나리오]            [결과 시나리오]            [결과 시나리오]
   ✅ 선호 >60%:             ✅ 3배 차이:              ✅ +40% 서빙:
   → Profile을 핵심          → Opt-out 기본값          → 뱃지 시스템
     기능으로 승격             확정                      Phase 2 론칭
   ❌ 선호 <40%:             ❌ 불만 >20%:             ❌ 품질 하락:
   → 전문성 증명 방식          → Opt-in + 가치           → 뱃지 기준을
     재설계                    설명 강화                  "질" 기반으로 변경
```

---

## Part II: pm-strategy -- 비즈니스 모델 통합 전략

> 프레임워크: JTBD + Lean Canvas + Porter's Five Forces + SWOT

### 1. Free/Pro/Expert/Team 티어와 인센티브 연결

#### 1.1 티어별 인센티브 매핑

| 인센티브 요소 | Free (OSS) | Pro ($12/mo) | Team ($18/mo/seat) | Enterprise (Custom) |
|-------------|-----------|-------------|-------------------|-------------------|
| **Federation 참여** | 기본 참여 (5 노드 제한) | 무제한 노드 연결 | 팀 전용 Federation + 공개 참여 | 프라이빗 Federation + SLA |
| **Knowledge Profile** | 기본 프로필 (통계 3개) | 전체 프로필 + 커스텀 테마 | 팀 프로필 페이지 | 기업 지식 디렉토리 |
| **뱃지** | 2종 (Founding, Contributor) | 전체 8종 | 팀 전용 뱃지 3종 추가 | 커스텀 뱃지 생성 |
| **Activity Heatmap** | 최근 30일 | 전체 기간 + 분석 | 팀 통합 히트맵 | 부서별 히트맵 |
| **리더보드** | 공개 리더보드 열람만 | 개인/그룹 리더보드 | 팀 내부 리더보드 | 조직 전체 리더보드 |
| **검색 크레딧** | 100 시작 / 월 50 보충 | 500 시작 / 무제한 그룹내 | 무제한 | 무제한 + API 접근 |
| **도메인 인증** | Contributor만 | Expert까지 | 팀 인증 시스템 | 기업 스킬 매트릭스 연동 |
| **임팩트 알림** | 주간 요약 (이메일) | 실시간 + 주간 + 월간 | 팀 임팩트 대시보드 | 경영진 리포트 |
| **Network Analytics** | 없음 | 기본 분석 | 팀 지식 건강도 | 조직 지식 감사 |

#### 1.2 핵심 전환 트리거: "Free에서 Pro로"

```
전환 시나리오 1: Federation 노드 제한
  Free 사용자가 6번째 노드 연결 시도
  → "5 노드 제한에 도달했습니다. Pro로 업그레이드하면 무제한 연결이 가능합니다."
  → 이미 Federation의 가치를 체감한 사용자 → 높은 전환율 예상

전환 시나리오 2: Knowledge Profile 완성
  Free 사용자가 프로필을 공유하려 할 때
  → "기본 프로필(3개 통계)이 공유됩니다. Pro로 업그레이드하면 전체 프로필
     (도메인 점수, 뱃지, 히트맵, 커스텀 테마)을 공유할 수 있습니다."
  → "전문가로 보이고 싶다"는 내적 동기 활용

전환 시나리오 3: 뱃지 한계
  Free 사용자가 3번째 뱃지 조건 달성 시
  → "축하합니다! 'Domain Expert' 뱃지를 획득할 수 있습니다.
     Pro 플랜에서 전체 8종 뱃지를 수집하세요."
  → 수집 욕구 + 게이미피케이션 락인

전환 시나리오 4: 임팩트 가시성
  Free 사용자의 주간 리포트에
  → "이번 주 당신의 지식이 23번 검색되었습니다.
     Pro에서는 실시간 알림과 상세 분석을 확인할 수 있습니다."
  → "내가 이렇게 도움이 됐다니" → 상세 데이터에 대한 호기심
```

#### 1.3 "Pro Value Gate" 원칙 적용

기존 advanced PRD의 원칙: "Free tier is genuinely useful. Pro tier unlocks features that grow in value the more you use the tool."

인센티브에 적용:
- **Free는 참여의 가치를 체험**하기에 충분해야 한다 (5 노드, 기본 뱃지, 주간 요약)
- **Pro는 "더 깊이, 더 넓게"를 원하는 사용자**를 위한 것 (무제한, 전체 분석, 전체 뱃지)
- Free에서 Pro 전환의 핵심은 "기능 차단"이 아니라 **"이미 느낀 가치를 확장"**

### 2. Knowledge Profile이 유료 전환을 돕는 방법

#### 2.1 전환 퍼널 분석

```
Stage 1: Awareness (인식)
  사용자가 처음 Knowledge Profile을 봄
  → "내가 Rust 분야 상위 15%라고?"
  → 자기 인식의 변화 → Stellavault에 대한 긍정적 감정

Stage 2: Engagement (참여)
  프로필을 꾸미고 싶다 / 공유하고 싶다
  → Free 프로필의 한계를 인식
  → "전체 프로필을 보여주고 싶다"

Stage 3: Conversion (전환)
  Pro 구독 → 전체 프로필 해금
  → Knowledge Profile URL을 LinkedIn/GitHub에 공유
  → 프로필이 "사회적 자본"이 됨 → 구독 해지 비용 높아짐

Stage 4: Retention (유지)
  프로필 통계가 매주 업데이트됨
  → "내 전문성 점수가 올라가고 있다"
  → 구독을 해지하면 프로필이 기본으로 돌아감
  → 해지 심리적 비용 > 월 $12
```

#### 2.2 LinkedIn 연동 전략

```yaml
# Knowledge Profile → LinkedIn 연동 시나리오
연동 방식:
  - "Stellavault Domain Expert: Rust" 인증 배지를 LinkedIn에 표시
  - Knowledge Profile URL을 LinkedIn 프로필 링크에 추가
  - Activity Heatmap 이미지를 LinkedIn 포스트로 공유

기술 구현:
  - Open Badges 2.0 표준 활용 (IMS Global)
  - Verifiable Credentials (W3C) 형식으로 인증 발급
  - LinkedIn의 "Add a section" → "Licenses & certifications" 연동

비즈니스 가치:
  - 매 LinkedIn 공유 = Stellavault 무료 홍보
  - "인증 뱃지가 LinkedIn에 표시됨" = Pro 구독의 체감 가치 증가
  - 채용 담당자가 Knowledge Profile URL 클릭 → 바이럴 유입
```

### 3. "지식 정체성"의 B2B/Enterprise 역할

#### 3.1 Enterprise Federation에서의 Knowledge Profile

```
개인 사용자:                    기업 사용자:
"나는 Rust 전문가"              "우리 팀에 Rust 전문가가 3명"

Knowledge Profile               Enterprise Knowledge Directory
  ↓                               ↓
커리어 시그널링                  인적 자원 관리 도구
  ↓                               ↓
Pro $12/mo                       Enterprise Custom/year
```

| B2B 사용 사례 | Knowledge Profile 역할 | 가치 |
|-------------|---------------------|------|
| **온보딩** | 신입이 "팀에서 누가 뭘 아는지" 즉시 파악 | 온보딩 시간 30% 단축 (산업 평균 기준 추정) |
| **프로젝트 배정** | PM이 "이 프로젝트에 필요한 전문성을 가진 사람" 검색 | 적합 인재 배정 시간 단축 |
| **지식 감사** | "우리 팀에 빠져있는 도메인" 자동 탐지 | Gap Analysis → 교육/채용 결정 근거 |
| **퇴사 영향 분석** | "이 사람이 떠나면 어떤 도메인이 약해지나" | 지식 리스크 관리 |
| **M&A 실사** | "인수 대상 팀의 지식 역량 프로파일" | 기술 실사의 객관적 데이터 |

#### 3.2 Enterprise Pricing 근거

```
ROI 계산:
  - Enterprise KM 솔루션 평균 비용: $50-200/user/year (Confluence, Notion 등)
  - Stellavault Enterprise 예상 가격: $240/user/year ($20/mo/seat)

가치 비교:
  - Confluence: 정적 문서 관리
  - Stellavault Enterprise: 동적 지식 지능 + 자동 전문성 매핑 + AI 에이전트 통합
  
차별점 "지식 정체성":
  - Confluence에는 없음: "누가 뭘 아는지" 자동 탐지
  - Notion에는 없음: AI 에이전트가 팀 지식을 검색하는 MCP 인프라
  - 이것이 가격 프리미엄의 근거
```

### 4. 경쟁 해자 (Moat) 분석

#### 4.1 Khoj/Anytype/Obsidian 대비 인센티브 해자

| 경쟁사 | 현재 인센티브/소셜 기능 | Stellavault의 차별화 |
|--------|---------------------|-------------------|
| **Khoj** | AI 검색 특화, 개인 도구, 소셜 기능 없음 | Knowledge Profile + Federation = 개인에서 네트워크로 확장 |
| **Anytype** | P2P 동기화, "Object-oriented" PKM, Space 공유 | Stellavault는 "지식을 공유"가 아니라 "지식 정체성을 구축". 임베딩만 공유하는 프라이버시 모델 |
| **Obsidian (자체)** | Vault 로컬, Publish (정적 사이트), Sync (파일 동기화) | Stellavault는 Obsidian의 데이터 위에 지능 계층 + 소셜 계층을 추가 |
| **Logseq** | 오픈소스 PKM, 커뮤니티 기반, 소셜 기능 없음 | 동일 오픈소스 정신 + Federation이라는 "함께 사용하면 더 강력한" 네트워크 효과 |
| **Notion** | 팀 협업 중심, 중앙화, API 풍부 | Stellavault는 "데이터 주권 + 분산형". 지식이 서버가 아닌 내 컴퓨터에 |

#### 4.2 인센티브 구조가 만드는 3중 해자

```
해자 1: 데이터 네트워크 효과 (Data Network Effect)
  - 사용자가 많을수록 Federation 검색 결과가 풍부해짐
  - 검색 결과가 좋을수록 사용자가 더 참여
  - → 선순환. 후발주자가 "빈 네트워크"로 경쟁해야 함

해자 2: 사회적 자본 (Social Capital Lock-in)
  - Knowledge Profile에 축적된 뱃지, 인증, 도메인 점수
  - 이것을 버리고 다른 도구로 이동하는 비용이 높음
  - LinkedIn 프로필에 "Domain Expert: Rust" 인증이 표시된 상태에서 해지?
  - → 전환 비용이 $12/mo보다 높아짐

해자 3: AI 에이전트 통합 (Ecosystem Lock-in)
  - Claude, GPT 등 AI 에이전트가 MCP로 Stellavault를 사용 중
  - Federation 검색이 에이전트의 일상 워크플로우에 통합
  - → "AI 에이전트의 기본 지식 인프라"가 되면 전환 불가
```

### 5. SWOT + 전략 매트릭스

| | **강점 (S)** | **약점 (W)** |
|---|---|---|
| | S1: 이미 작동하는 강력한 단독 도구 (12 MCP, 3D graph) | W1: 1인 개발, 리소스 한계 |
| | S2: 프라이버시 모델 (임베딩만 공유) 차별화 | W2: Federation/인센티브 미구현 (설계만) |
| | S3: "지식 정체성"이라는 새로운 카테고리 정의 | W3: 사용자 0명 (콜드 스타트) |
| | S4: Claude Code/MCP 생태계와의 밀접한 통합 | W4: CLI 기반 → 비기술 사용자 진입 장벽 |
| **기회 (O)** | **SO 전략** | **WO 전략** |
| O1: AI 에이전트 시장 급성장 | SO1: MCP Federation을 "AI의 기본 지식 인프라"로 포지셔닝 | WO1: Claude Code 커뮤니티를 첫 Atomic Network로 활용 (콜드 스타트 해결) |
| O2: 개발자 브랜딩 트렌드 (GitHub 잔디 문화) | SO2: Knowledge Heatmap을 "지식 잔디"로 마케팅 | WO2: Obsidian 플러그인으로 GUI 진입점 확보 |
| O3: Enterprise KM 시장 $23B | SO3: 지식 감사/온보딩을 Enterprise 핵심 가치로 | WO3: YC/VC 펀딩으로 팀 확장 → Enterprise 영업 |
| O4: 프라이버시 규제 강화 (GDPR+) | SO4: "데이터 주권"을 규제 준수의 장점으로 | WO4: 자동화 테스트 강화로 1인 개발 품질 유지 |
| **위협 (T)** | **ST 전략** | **WT 전략** |
| T1: Obsidian이 자체 Federation 출시 가능 | ST1: 임베딩 기반 프라이버시가 Obsidian Sync와 근본적으로 다름을 강조 | WT1: Obsidian 생태계 의존도를 낮추고 범용 PKM 지원으로 확장 |
| T2: 대기업의 AI+KM 진출 (MS Copilot+, Google NotebookLM) | ST2: "분산형"이 대기업과의 근본적 차별점. "당신의 데이터는 MS 서버에 없다" | WT2: 오픈소스 커뮤니티 해자 구축 (대기업이 카피해도 커뮤니티는 못 카피) |
| T3: 네트워크 효과 부족으로 Federation 실패 | ST3: "Tool First" — Federation 없이도 가치 있는 도구. 실패해도 개인 도구로 존속 | WT3: 최악의 경우 Federation 포기, 개인 지식 관리 도구로 피벗 |

---

## Part III: pm-research -- 인센티브 실효성 검증 리서치

> 프레임워크: 사용자 인터뷰 + 벤치마크 분석 + 문화권 데이터

### 1. 사용자 인터뷰 질문 설계 (5명)

#### 1.1 대상 프로필

| # | 대상 | 배경 | 선정 이유 |
|---|------|------|----------|
| P1 | Stack Overflow 상위 답변자 | 5,000+ 평판, 주 5시간+ 답변 활동 | "왜 무료로 지식을 공유하나" 직접 경험 |
| P2 | GitHub 오픈소스 메인테이너 | 1,000+ 스타 프로젝트, 2년+ 유지 | 장기적 무보수 기여 동기 |
| P3 | Obsidian 파워 유저 (한국) | 1,000+ 노트, 한국 PKM 커뮤니티 활동 | 한국형 지식 공유 동기 + 커뮤니티 역할 |
| P4 | 기업 KM 담당자 | Confluence/Notion 관리 경험 | B2B 관점 + 조직 내 지식 공유 장벽 |
| P5 | 학계 연구자 (미국/유럽) | 논문 50+ 편, 오픈 사이언스 옹호자 | 학술 지식 공유 동기 + 프라이버시 민감도 |

#### 1.2 인터뷰 가이드 (30분, 반구조화)

**Opening (5분)**
```
1. 당신의 지식 관리 방식을 간단히 설명해주세요.
   (어떤 도구를 쓰나요? 노트를 어떻게 정리하나요?)

2. 지난 한 달간 다른 사람에게 전문 지식을 공유한 적이 있나요?
   (어떤 채널로? 어떤 형태로?)
```

**Core Questions -- 동기 탐색 (15분)**
```
3. [SO 답변자에게] "Stack Overflow에서 답변을 쓸 때, 마지막으로 느꼈던 감정은 무엇인가요?"
   → Follow-up: "그 답변이 아무런 반응을 못 받았다면 계속 쓸 건가요?"
   → Follow-up: "SO 평판 점수가 커리어에 실질적으로 도움이 된 적이 있나요?"

4. [모든 대상] "당신의 전문 분야와 지식의 깊이를 객관적으로 증명할 수 있는 방법이 있나요?"
   → Follow-up: "LinkedIn의 스킬 목록이 정확하다고 생각하나요?"
   → Follow-up: "지식의 깊이를 자동으로 분석해서 프로필로 보여주는 도구가 있다면 사용하시겠나요?"

5. [모든 대상] "당신의 노트/문서에서 '임베딩 벡터'만 -- 원문은 절대 공유되지 않는 조건으로 --
    다른 사람의 AI 에이전트가 검색할 수 있게 한다면?"
   → Follow-up: "어떤 조건이면 동의하시겠나요? (같은 팀만? 같은 분야만? 누구든?)"
   → Follow-up: "그 대가로 다른 사람의 지식에도 접근할 수 있다면?"

6. [한국 유저에게] "지식 공유에서 '팀/그룹'의 역할은 어떤가요?"
   → Follow-up: "개인 랭킹 vs 그룹 성과, 어떤 게 더 동기 부여가 되나요?"
```

**인센티브 프로빙 (7분)**
```
7. [카드 소팅 기법] 다음 8가지 인센티브를 매력도 순으로 정렬해주세요:
   a. 검색 크레딧 (다른 사람 지식 검색 가능)
   b. "Domain Expert" 뱃지 (프로필에 표시)
   c. Activity Heatmap (GitHub 잔디처럼)
   d. 주간 임팩트 알림 ("당신의 지식이 N번 도움이 됨")
   e. 그룹 내 기여 순위
   f. 프리미엄 기능 해제 (분석 대시보드 등)
   g. Knowledge Profile (공개 전문성 페이지)
   h. 커리어 인증 (LinkedIn 연동 가능)

   → "1순위를 선택한 이유는?"
   → "가장 매력 없는 것은? 그 이유는?"

8. [모든 대상] "이런 시스템에서 당신이 가장 우려하는 점은?"
   → 프라이버시? 게임화 피로? 시간 투자? 불공정한 측정?
```

**Closing (3분)**
```
9. 한 문장으로: "당신이 지식을 공유하는 가장 큰 이유는 ___입니다."

10. Stellavault Federation에 대해 추가로 궁금한 점이나 제안이 있나요?
```

### 2. "왜 Stack Overflow에 답변을 쓰는가" → Stellavault 적용

#### 2.1 SO 답변 동기 분석 (2025 연구 기반)

| 동기 카테고리 | SO에서의 발현 | Stellavault에서의 대응 설계 |
|-------------|-------------|-------------------------|
| **커리어 시그널링** | SO 프로필을 이력서에 기재. 채용 담당자가 SO 활동을 참고 | Knowledge Profile을 "지식 이력서"로. LinkedIn 연동. "AI가 당신을 전문가로 라우팅" |
| **유능감 (Competence)** | "나는 이 문제의 답을 안다"는 만족감. 답변이 채택되면 강화 | "당신의 지식이 47개 노드의 검색에 기여했습니다" 알림. Domain Expert 뱃지 |
| **평판 점수 (Gamification)** | 숫자로 보이는 평판. 특정 점수에 특권 해제 (편집, 투표 등) | 뱃지 + 인증 레벨 (Contributor → Expert). 레벨에 따른 기능 해제 |
| **호혜성** | "나도 도움받았으니 돌려줘야" | "당신도 다른 노드의 지식에 접근할 수 있습니다" |
| **학습 효과** | 답변을 작성하면서 본인도 정리/학습 | 제한적 -- 임베딩 공유는 수동적. 대안: "네트워크 검색으로 새 관점 발견" |
| **눈에 띄고 싶음** | 특히 초기 유저. "내 답변이 주목받길" | Activity Heatmap + 프로필 공개 + Featured Expert |

**핵심 차이점과 대응:**

SO와 Stellavault의 근본적 차이는 "기여의 수동성"이다. SO에서는 답변을 "작성"해야 하지만, Federation에서는 임베딩이 "자동으로" 공유된다. 이 차이가 의미하는 것:

```
SO: 높은 기여 비용 → 강한 동기 필요 → 평판/커리어가 강력한 동기
    답변 작성 15분 = "내가 투자한 시간의 가치를 인정받고 싶다"

Federation: 낮은 기여 비용 → 약한 동기로도 충분 → 자동 참여 + 피드백이 핵심
    임베딩 공유 0분 = "추가 노력 없이 전문가로 인정받는다"

→ 전략: SO처럼 "기여를 강요"하지 말고, "자동 기여 + 가시적 인정"에 집중
```

### 3. 게이미피케이션 벤치마크 분석

#### 3.1 Duolingo 성공 사례 → Stellavault 적용

| Duolingo 메커니즘 | 효과 | Stellavault 적용 | 적용 가능성 |
|-------------------|------|-----------------|------------|
| **Streak (연속 학습일)** | 7일 스트릭 유저는 3.6x 높은 참여율. 900만 유저가 1년+ 스트릭 유지 | **"Knowledge Streak"** -- 연속 N일 노드 온라인 유지 + 검색 서빙. "7일 스트릭 달성!" | 높음 -- 노드 온라인 유지를 "스트릭"으로 게임화 |
| **Streak Freeze** | 스트릭 중단 위기 시 "Freeze" 사용 → 이탈율 21% 감소 | **"Node Freeze"** -- 여행/휴가 시 3일간 스트릭 보호. 크레딧 50으로 구매 | 높음 -- 이탈 방지에 효과적 |
| **XP + Leaderboard** | XP 리더보드가 40% 참여율 증가 | **"Knowledge XP"** -- 검색 서빙, 새 노트 추가, 뱃지 획득에 XP. 주간 리그 | 중간 -- 리더보드 독성 주의 필요 |
| **Hearts (실수 제한)** | 실수에 비용을 부과하여 신중한 학습 유도 | **적용 안 함** -- 지식 공유에 "벌칙"은 역효과 | 낮음 |
| **Daily Quest** | 매일 작은 목표 → 성취감 루프 | **"Daily Knowledge Quest"** -- "오늘 1개 노트 업데이트" 또는 "1번 네트워크 검색" | 중간 -- "해야 할 일"이 되면 역효과 |
| **League/Promotion** | 주간 리그 + 승격/강등 → 매주 새 목표 | **"Monthly Knowledge League"** -- 월간 리그 (주간은 너무 잦음). 리그 내 5명 단위 | 낮음 -- 지식 도구에 강등은 부자연스러움 |

**Duolingo에서 배울 핵심**: "스트릭"이 가장 강력한 리텐션 메커니즘이다. 노드 온라인 유지를 스트릭으로 게임화하면, "어제까지 14일 연속이었는데 끄기 아까움" 심리가 작동한다.

#### 3.2 Strava 성공 사례 → Stellavault 적용

| Strava 메커니즘 | 효과 | Stellavault 적용 | 적용 가능성 |
|----------------|------|-----------------|------------|
| **Kudos (좋아요)** | 2025년 140억+ Kudos 상호작용. 20% 전년 대비 증가 | **"Thanks" 반응** -- 검색 결과가 유용했을 때 서빙 노드에 Thanks 전송 | 높음 -- 가장 자연스러운 사회적 피드백 |
| **Segments (구간 경쟁)** | 특정 구간에서의 기록 경쟁 → 반복 참여 | **"Domain Segments"** -- 도메인별 기여도 랭킹. "Rust 구간 1위" | 중간 -- 도메인별 경쟁은 건전할 수 있음 |
| **Personal Best** | 개인 최고 기록 → 자기와의 경쟁 | **"Personal Impact Best"** -- "이번 주 최다 검색 서빙! 지난주보다 30% 증가" | 높음 -- 타인 비교보다 자기 성장이 건전 |
| **Clubs** | 관심사 기반 그룹 → 소속감 | **Federation Group** -- 이미 설계됨. 그룹 성과 대시보드 추가 | 높음 |
| **Year in Review** | 연간 활동 요약 → 공유 바이럴 | **"Year in Knowledge"** -- 연간 지식 기여 요약 카드. "2026년에 당신의 지식이 1,200번 검색되었습니다" → SNS 공유 | 매우 높음 -- 바이럴 성장 엔진 |

**Strava에서 배울 핵심**: "Kudos(Thanks)"와 "Year in Review"가 가장 적용 가능성이 높다. Thanks는 인간적 피드백을 제공하고, Year in Review는 바이럴 성장의 핵심 엔진이 된다.

#### 3.3 GitHub 기여 문화 → Stellavault 적용

| GitHub 메커니즘 | 연구 결과 | Stellavault 적용 | 적용 가능성 |
|----------------|----------|-----------------|------------|
| **Contribution Graph (잔디)** | 개발자 사이에서 사회적 화폐로 기능. "잔디가 비면 불안" | **Knowledge Activity Heatmap** -- 이미 PRD에 설계됨. GitHub 잔디와 동일한 시각적 언어 | 매우 높음 -- 개발자에게 익숙한 UI 패턴 |
| **Profile Badges** | 연구: 배지에 대한 부정적 의견 우세. "shameful", "trivial" 우려 | **뱃지 설계 주의** -- 너무 쉬운 뱃지는 가치 하락. "Founding Node"처럼 희귀 뱃지에 집중 | 중간 -- 뱃지 남발 금지 |
| **Stars** | 프로젝트 품질의 사회적 신호 | **Impact Score** -- 다른 노드의 "Thanks" 수를 집계한 점수 | 높음 |
| **Pinned Repos** | 자기가 자랑하고 싶은 프로젝트를 프로필에 고정 | **Featured Domains** -- Knowledge Profile에 자신의 핵심 전문 분야 3개를 고정 | 높음 |
| **README Profile** | 개인 프로필 페이지 커스터마이징 | **Knowledge Profile 커스터마이징** -- Pro 기능으로 테마, 소개글, 대표 도메인 선택 | 높음 |

**GitHub에서 배울 핵심**: 연구에 따르면 뱃지에 대한 개발자 커뮤니티의 시선이 의외로 부정적이다. "쉬운 뱃지"는 오히려 역효과를 낼 수 있다. Stellavault는 "희귀하고 의미 있는 뱃지"에 집중해야 한다.

### 4. 문화권별 인센티브 민감도 심층 데이터

#### 4.1 한국 (IDV: 18 -- 집단주의)

| 특성 | 데이터/근거 | Stellavault 인센티브 전략 |
|------|-----------|------------------------|
| **순위 경쟁** | 네이버 카페 등급 시스템 (새싹→열매→우수). 카페 내 등급이 사회적 지위 | **그룹 내 기여 등급** -- 하지만 "등급"보다 "역할"로 프레이밍. "그룹의 Rust 전문가" |
| **그룹 소속감** | 카카오 오픈채팅 그룹 활발. "우리 팀" 정체성 강함 | **그룹 성과 대시보드** 우선. "우리 그룹이 이번 달 Top 10" |
| **체면 (Face)** | 미완성/부족한 지식 공유에 대한 심리적 장벽 높음 | **자동 공유(임베딩)** 강점 강조. "정리 안 된 노트도 OK -- 임베딩만 공유됩니다" |
| **"같이 해야 재미"** | 함께 성장하는 느낌이 중요. 개인 성취보다 "우리" | **팀 Federation 온보딩**: "동료 3명과 함께 시작하세요" |
| **싸이월드 미니홈피 DNA** | 디지털 자아 표현 욕구 (미니홈피, 카카오 프로필) | **Knowledge Profile 꾸미기** -- 테마, 대표 도메인, 아바타 (Pro) |

#### 4.2 미국 (IDV: 91 -- 개인주의)

| 특성 | 데이터/근거 | Stellavault 인센티브 전략 |
|------|-----------|------------------------|
| **개인 브랜딩** | LinkedIn 프로필 최적화 문화. "Personal Brand" 개념 보편적 | **Knowledge Profile → LinkedIn 연동**이 핵심. "당신의 전문성을 증명하세요" |
| **커리어 시그널링** | GitHub 잔디가 채용에 실질적 영향. SO 프로필이 면접에 활용됨 | **"지식 잔디"를 커리어 자산으로** 마케팅 |
| **Self-made 서사** | "혼자 힘으로" 성공 스토리를 선호 | **개인 Impact Score** 강조. "당신 혼자서 142개 검색에 기여" |
| **공정성 (Fairness)** | 보상이 기여에 비례해야 한다는 강한 기대 | **투명한 크레딧 시스템** + 품질 가중치. "게임하기 어려운 지표" |
| **오픈소스 Gift Economy** | 기여→인정→기회의 선순환에 익숙 | **Federation 기여 = 오픈소스 기여와 같은 문화적 프레이밍** |

#### 4.3 일본 (IDV: 46 -- 균형)

| 특성 | 데이터/근거 | Stellavault 인센티브 전략 |
|------|-----------|------------------------|
| **장인정신 (Craftsmanship)** | Qiita(기술 블로그)에서 "잘 정리된 글"에 높은 가치. 불완전한 공유는 수치 | **Quality Score 강조**. "가장 정확한 검색 결과를 제공하는 노드" 인증 |
| **겸양 (Modesty)** | "눈에 띄기 싫음". 개인 리더보드에 이름 노출 거부감 | **리더보드 기본 OFF**. 표시할 때도 닉네임/아바타 사용. "개인 성장" 모드 기본 |
| **커뮤니티 의무** | "みんなのために(모두를 위해)" 정신 | **"커뮤니티 기여" 프레이밍**. "あなたの知識がコミュニティに貢献しています" |
| **꾸준함 보상** | Duolingo 일본 시장에서 스트릭이 매우 효과적 | **Knowledge Streak**이 일본에서 특히 효과적일 것으로 예상 |
| **완벽주의** | "공유하기 전에 완벽해야" → 공유 장벽 높음 | **"임베딩은 자동" 강조**. "ノートの品質は関係ありません -- 知識の深さが重要です" |

#### 4.4 유럽 (다양, 프라이버시 중심)

| 특성 | 데이터/근거 | Stellavault 인센티브 전략 |
|------|-----------|------------------------|
| **GDPR 민감도** | 데이터 관련 서비스에 대한 높은 경계심 | **프라이버시 대시보드** 핵심. "정확히 무엇이 공유되고 있는지" 투명하게 표시 |
| **데이터 주권** | "내 데이터는 내 서버에" 선호. Self-hosted 솔루션 인기 | **"분산형"이 핵심 가치**. "데이터가 서버를 떠나지 않습니다" |
| **실용주의** | 게이미피케이션보다 기능적 보상 선호 | **기능 해제를 핵심 인센티브로**. 뱃지/리더보드는 부가 옵션 |
| **오픈소스 문화** | 유럽의 강한 FOSS 커뮤니티 (독일, 네덜란드 특히) | **오픈소스 프로토콜 강조**. 코드 감사 가능성 |
| **Work-Life Balance** | "게임화가 일을 더 시키려는 트릭" 인식 가능 | **"자동 기여"와 "opt-in 게이미피케이션"** 분리 |

#### 4.5 문화권별 온보딩 내러티브 요약

```
한국 (ko-KR):
  "함께 성장하는 지식 커뮤니티에 오신 것을 환영합니다.
   동료들과 함께 지식을 연결하고, 우리 그룹의 지식을 키워보세요."
  → CTA: "팀원 초대하기"

미국 (en-US):
  "Build your knowledge brand.
   Your expertise, proven by real impact -- not self-declared skills."
  → CTA: "Create your Knowledge Profile"

일본 (ja-JP):
  "あなたの知識が、コミュニティの力になります。
   丁寧に積み上げた知識が、正しく評価される場所です。"
  → CTA: "ナレッジプロフィールを確認する"

유럽 (en-EU / de-DE):
  "Your knowledge stays on your machine. Always.
   Share only what you choose. Control every byte."
  → CTA: "Review Privacy Settings"
```

---

## Part IV: pm-prd -- PRD 통합 + 구체적 스펙

> 프레임워크: 기존 PRD 통합 + 기능 스펙 + 구현 로드맵

### 1. stellavault-advanced.prd.md 인센티브 통합

#### 1.1 추가할 섹션: "Tier 5: Incentive & Social Layer"

기존 advanced PRD에는 Tier 1-4 (Polish, Pro/Cloud, Intelligence, Team)가 있다. 인센티브 기능을 **Tier 5**로 추가:

| Feature ID | 이름 | 설명 | 우선순위 | 복잡도 | 차별화 |
|-----------|------|------|---------|--------|-------|
| F-A23 | **Knowledge Profile Page** | 공개 URL (stellavault.dev/u/username). 도메인 점수, 뱃지, 히트맵, 임팩트 통계. Free: 3개 통계. Pro: 전체 + 커스텀 테마 | P1 | Medium | 5/5 |
| F-A24 | **Badge System** | 8종 뱃지 (4단계 희귀도). 획득 조건 자동 감지. 유지 조건 (30일). 뱃지 "빛바래기" (6개월 비활동) | P1 | Medium | 4/5 |
| F-A25 | **Activity Heatmap** | GitHub 잔디 스타일. 365일 기여 시각화. CLI + Web Profile 모두 표시. Free: 30일. Pro: 전체 기간 | P1 | Low | 4/5 |
| F-A26 | **Impact Notifications** | "당신의 지식이 N번 검색됨" 주간 요약. Pro: 실시간 + 상세 분석 | P0 | Low | 3/5 |
| F-A27 | **Domain Certification** | 4단계 인증 (Contributor→Specialist→Expert→Mentor). 자동 승격. Open Badges 2.0 표준 | P2 | High | 5/5 |
| F-A28 | **Thanks Reaction** | 검색 결과에 "Thanks" 반응. 서빙 노드에 전달. Impact Score에 반영 | P1 | Low | 3/5 |
| F-A29 | **Knowledge Streak** | 연속 노드 온라인일 카운트. Streak Freeze (크레딧 50). 7일/30일/90일 마일스톤 | P2 | Medium | 3/5 |
| F-A30 | **Year in Knowledge** | 연간 활동 요약 카드. SNS 공유 가능. 자동 생성 (12월) | P3 | Medium | 4/5 |
| F-A31 | **Cultural Onboarding** | 로케일 기반 온보딩 내러티브 분기 (ko/en-US/ja/en-EU). 기능 동일, 프레이밍 차별화 | P2 | Low | 3/5 |

#### 1.2 기존 Knowledge Profile (F-A09)과의 통합

기존 advanced PRD의 F-A09 "Knowledge Profile Page"를 인센티브 시스템과 통합:

```
기존 F-A09:
  - 공개 URL
  - top topics, knowledge stats, interactive mini-graph, decay health score

통합 후 F-A09 + F-A23:
  - 공개 URL + 인센티브 통합
  - Knowledge Profile = 기존 통계 + 뱃지 표시 + Activity Heatmap + Impact Score
  - Federation 기여 데이터 포함
  - 도메인 인증 레벨 표시
```

### 2. stellavault-federation.prd.md 참여 동기 통합

#### 2.1 추가할 섹션: "Participation Incentive Layer"

기존 federation PRD의 크레딧 시스템(Section 7.6)을 확장:

```
기존:
  - 검색 서빙 1회 = 1 크레딧
  - 검색 사용 1회 = -1 크레딧
  - 시작 100 크레딧
  - 0 크레딧 = 검색 가능하나 낮은 우선순위

확장:
  - 시작 200 크레딧 (+ 그룹 보너스 50)
  - 그룹 내 검색 = 무료
  - 그룹 간 검색 = 0.5 크레딧
  - 품질 보너스: Thanks 받으면 +0.5 크레딧 추가
  - 연속 기여 보너스: 7일 연속 서빙 → 10% 보너스
  - 기능 해제: 500 크레딧 = 분석 대시보드, 1000 크레딧 = 그룹 생성
```

### 3. Knowledge Profile 구체적 스펙

#### 3.1 API 엔드포인트

```
# Knowledge Profile API (MCP Tool + CLI + REST)

## MCP Tool: knowledge-profile
Parameters:
  - node_id: string (optional, default: self)
  - include_badges: boolean (default: true)
  - include_heatmap: boolean (default: false)
  - format: "summary" | "full" | "public"

Response:
  {
    identity: { display_name, node_id, member_since, founding_node },
    expertise: [{ domain, confidence, search_served, rank }],
    impact: { total_searches_served, unique_nodes_helped, quality_score, uptime_pct },
    badges: [{ id, name, rarity, earned_at, maintained }],
    heatmap: [{ date, searches_served, searches_made, unique_helped }],  // 365 entries
    streak: { current, longest, freeze_available }
  }

## CLI Commands
sv federate profile                    # 내 프로필 보기
sv federate profile --public           # 공개 프로필 생성/갱신
sv federate profile --format json      # JSON 출력
sv federate profile --node <id>        # 다른 노드 프로필 조회
sv federate profile --share            # 공유 가능 URL 생성

## REST API (Web Profile)
GET /api/v1/profile/:node_id           # 공개 프로필 조회
GET /api/v1/profile/:node_id/heatmap   # 히트맵 데이터
GET /api/v1/profile/:node_id/badges    # 뱃지 목록
```

#### 3.2 데이터 모델 (TypeScript)

```typescript
// packages/core/src/federation/incentive/types.ts

interface KnowledgeProfile {
  // Identity
  nodeId: string;
  displayName: string;
  memberSince: string;  // ISO 8601
  isFoundingNode: boolean;
  
  // Expertise (auto-detected from vault analysis)
  domains: DomainExpertise[];
  
  // Impact metrics
  impact: {
    totalSearchesServed: number;
    uniqueNodesHelped: number;
    qualityScore: number;  // 0.0 - 5.0
    uptimePercentage: number;
  };
  
  // Social
  badges: EarnedBadge[];
  certificationLevel: 'none' | 'contributor' | 'specialist' | 'expert' | 'mentor';
  
  // Activity
  streak: {
    current: number;  // consecutive days
    longest: number;
    freezeAvailable: boolean;
  };
  heatmap: DailyActivity[];  // last 365 days
  
  // Privacy
  visibility: 'private' | 'group' | 'public';
}

interface DomainExpertise {
  domain: string;       // e.g., "Rust/WebAssembly"
  confidence: number;   // 0.0 - 1.0, auto-calculated
  searchServed: number;
  rankInDomain: number | null;  // null if not enough data
  topTopics: string[];  // top 5 topics within domain
}

interface Badge {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  icon: string;  // emoji or icon name
  criteria: BadgeCriteria;
  maintainDays: number;  // 0 = permanent
}

interface EarnedBadge {
  badge: Badge;
  earnedAt: string;
  maintainedUntil: string | null;
  isFaded: boolean;  // true if maintenance condition not met for 6 months
}

interface DailyActivity {
  date: string;  // YYYY-MM-DD
  searchesServed: number;
  searchesMade: number;
  uniqueNodesHelped: number;
  qualityAvg: number;
  thanksReceived: number;
}

interface BadgeCriteria {
  type: 'threshold' | 'streak' | 'social' | 'special';
  conditions: Record<string, number | string>;
  // e.g., { type: 'threshold', conditions: { searches_served: 50 } }
  // e.g., { type: 'streak', conditions: { consecutive_days: 90 } }
  // e.g., { type: 'social', conditions: { vouches_received: 10 } }
  // e.g., { type: 'special', conditions: { node_order: 100 } }  // first 100 nodes
}
```

#### 3.3 UI 컴포넌트 (Web Profile)

```
Knowledge Profile Page Layout:
+-------------------------------------------------------------------+
|  [Avatar/Icon]  James Park                                         |
|  Founding Node | Expert: Rust | Reliable Node                     |
|  Member since April 2026                                           |
+-------------------------------------------------------------------+
|                                                                    |
|  +----- Expertise Domains -----+  +----- Impact Stats -----------+|
|  | Rust/WebAssembly    0.92    |  | Searches Served: 1,360       ||
|  | ██████████████░░ #3 in Rust |  | Nodes Helped: 47             ||
|  |                             |  | Quality Score: 4.7/5.0       ||
|  | P2P Networking      0.85   |  | Uptime: 94.2%                ||
|  | ████████████░░░░            |  |                              ||
|  |                             |  | Streak: 42 days              ||
|  | System Design       0.78   |  | Longest: 67 days             ||
|  | ██████████░░░░░░            |  |                              ||
|  +-----------------------------+  +------------------------------+|
|                                                                    |
|  +----- Activity Heatmap (365 days) ----------------------------+|
|  | Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec   ||
|  | ░░░░ ████ ████ ████ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░||
|  | ░░░░ ████ ████ ████ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░||
|  | ░░░░ ████ ████ ████ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░||
|  | (intensity = searches served per day)                         ||
|  +--------------------------------------------------------------+|
|                                                                    |
|  +----- Badges ------------------------------------------------+|
|  | [*] Founding Node    [*] Domain Expert: Rust                 ||
|  | [*] Reliable Node    [*] Knowledge Bridge                    ||
|  | [*] Community Pillar [ ] Gap Filler (progress: 3/5)          ||
|  +--------------------------------------------------------------+|
+-------------------------------------------------------------------+
```

### 4. 뱃지 시스템 구체적 스펙

#### 4.1 전체 뱃지 목록 (8종 + 3 팀 전용)

| # | ID | 이름 | 아이콘 | 희귀도 | 획득 조건 | 유지 조건 | 설명 |
|---|-----|------|--------|--------|----------|----------|------|
| 1 | `founding-node` | Founding Node | 별 | Legendary | 초기 100 노드 | 영구 | 선구자. 돌이킬 수 없는 역사의 일부 |
| 2 | `domain-expert` | Domain Expert | 왕관 | Epic | 특정 도메인 상위 10% + 500+ 서빙 | 30일 연속 충족 | 이 분야의 진정한 전문가 |
| 3 | `knowledge-bridge` | Knowledge Bridge | 다리 | Epic | 3+ 도메인에서 각 100+ 서빙 | 30일 연속 충족 | 다학제 지식의 연결자 |
| 4 | `reliable-node` | Reliable Node | 방패 | Rare | 90일 연속 온라인 | 활동 중 유지 | 믿을 수 있는 지식의 원천 |
| 5 | `community-pillar` | Community Pillar | 기둥 | Rare | 10+ 노드의 vouch | vouch 유지 | 커뮤니티가 인정한 핵심 노드 |
| 6 | `gap-filler` | Gap Filler | 퍼즐 | Common | 네트워크 갭 탐지 후 관련 지식 추가 5회 | 없음 | 네트워크의 빈 곳을 채우는 기여자 |
| 7 | `curator` | Curator | 책 | Common | Knowledge Pack 공유 3개+ | 없음 | 지식 정리의 달인 |
| 8 | `newcomer-guide` | Newcomer Guide | 나침반 | Common | 5+ 신규 노드를 vouch | 없음 | 새로운 사람을 이끄는 안내자 |
| 9 | `team-mvp` | Team MVP | 트로피 | Rare | 팀 내 월간 최다 기여 | 월간 갱신 | 이번 달의 팀 MVP (Team 전용) |
| 10 | `team-synergy` | Team Synergy | 고리 | Rare | 팀 5명 전원 주간 활성 달성 | 주간 갱신 | 함께 빛나는 팀 (Team 전용) |
| 11 | `team-mentor` | Team Mentor | 등대 | Epic | 팀 내 3+ 멤버의 도메인 점수 상승에 기여 | 없음 | 팀원을 성장시키는 멘토 (Team 전용) |

#### 4.2 뱃지 획득 로직

```typescript
// packages/core/src/federation/incentive/badge-engine.ts

interface BadgeEngine {
  // 매일 자정에 실행: 모든 뱃지 조건 체크
  evaluateAllBadges(nodeId: string): Promise<BadgeEvaluation[]>;
  
  // 특정 뱃지 조건 확인
  checkBadgeCriteria(nodeId: string, badgeId: string): Promise<{
    eligible: boolean;
    progress: number;  // 0.0 - 1.0
    remaining: string; // "37 more searches needed"
  }>;
  
  // 뱃지 수여
  awardBadge(nodeId: string, badgeId: string): Promise<void>;
  
  // 유지 조건 체크 (6개월 미충족 시 fade)
  checkMaintenanceConditions(): Promise<FadedBadge[]>;
}

// Badge evaluation 순서:
// 1. 일일 activity_heatmap 집계 완료 후
// 2. checkBadgeCriteria for each badge
// 3. eligible && not yet earned → awardBadge + 알림
// 4. earned && maintenance_not_met for 180 days → fade
```

#### 4.3 뱃지 표시 방법

```
CLI 표시:
  $ sv federate profile
  
  === Knowledge Profile: james-park-dev ===
  
  [*] Founding Node  [*] Domain Expert: Rust  [*] Reliable Node
  [*] Knowledge Bridge  [*] Community Pillar
  [ ] Gap Filler (3/5)  [ ] Curator (1/3)  [ ] Newcomer Guide (2/5)
  
  Streak: 42 days | Quality: 4.7/5.0 | Impact: 1,360 searches served

Web Profile 표시:
  - 뱃지 아이콘 + 이름
  - 희귀도별 색상: Common(회색), Rare(파랑), Epic(보라), Legendary(금)
  - 클릭 시 획득 조건 + 획득일 표시
  - Faded 뱃지: 50% 투명도 + "Reactivate by..." 안내

알림:
  - 뱃지 획득 시: "축하합니다! 'Domain Expert: Rust' 뱃지를 획득했습니다!"
  - 뱃지 Fade 경고 (30일 전): "'Reliable Node' 뱃지가 30일 후 비활성화됩니다."
```

### 5. Activity Heatmap 스펙

#### 5.1 데이터 수집

```typescript
// packages/core/src/federation/incentive/heatmap.ts

interface HeatmapCollector {
  // 매 검색 서빙 시 호출
  recordActivity(event: {
    type: 'search_served' | 'search_made' | 'thanks_received' | 'note_updated';
    nodeId: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }): Promise<void>;
  
  // 일일 집계 (자정에 실행)
  aggregateDaily(nodeId: string, date: string): Promise<DailyActivity>;
  
  // 히트맵 데이터 조회
  getHeatmap(nodeId: string, options: {
    days: number;      // 30 (Free) or 365 (Pro)
    granularity: 'day' | 'week';
  }): Promise<DailyActivity[]>;
}
```

#### 5.2 CLI 표시

```
$ sv federate heatmap

  Knowledge Activity Heatmap (last 90 days)
  
  Mon  ░░██████░░████░░██░░░░████████████████░░████████░░██████████████████░░████
  Tue  ░░████████████░░██░░░░████████████████████████████░░██████████████████████
  Wed  ██████████████████░░████████████████████████████████████████████████████████
  Thu  ████████████████████████████████████████████░░████████████████████████████
  Fri  ████████████░░██████░░████████████████████████████░░████████████████████
  Sat  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  Sun  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

  Legend: ░ 0  ▒ 1-5  ▓ 6-20  █ 21+  (searches served per day)
  
  Total: 892 searches served | Average: 9.9/day | Best day: Mar 15 (47)
```

#### 5.3 웹 컴포넌트

```
React 컴포넌트: <ActivityHeatmap />

Props:
  - data: DailyActivity[] (365 entries)
  - colorScheme: 'green' (GitHub) | 'blue' (ocean) | 'purple' (cosmic)  // Pro only
  - tooltipFormat: (day: DailyActivity) => string
  - interactive: boolean (click to see daily detail)

SVG 렌더링:
  - 52 columns (weeks) x 7 rows (days)
  - Cell size: 11px x 11px, gap: 2px
  - Color intensity: 5단계 (0, 1-5, 6-15, 16-30, 31+)
  - Month labels on top
  - Day labels on left (Mon, Wed, Fri)

파일 위치: packages/graph/src/components/ActivityHeatmap.tsx
```

### 6. 12주 구현 로드맵 (인센티브 기능)

#### 6.1 Phase 1: 기반 (Week 1-4)

| 주차 | 기능 | 세부 작업 | 산출물 |
|------|------|----------|--------|
| **W1** | 데이터 모델 | `activity_heatmap`, `badges`, `node_badges` 테이블 생성. TypeScript 타입 정의 | DB 스키마 + 타입 파일 |
| **W1** | 임팩트 알림 (F-A26) | 검색 서빙 시 카운터 업데이트. 주간 집계 쿼리. CLI `sv federate impact` | 가장 낮은 복잡도, 가장 높은 동기 부여 효과 |
| **W2** | Activity Heatmap (F-A25) | 일별 활동 집계. CLI 히트맵 표시. HeatmapCollector 구현 | CLI `sv federate heatmap` |
| **W2** | 크레딧 시스템 개선 | 그룹 내 무료 검색. 품질 보너스. 연속 기여 보너스 | 기존 크레딧 로직 확장 |
| **W3** | Thanks 반응 (F-A28) | 검색 결과에 Thanks 전송 프로토콜. 서빙 노드에 전달. Impact Score 반영 | P2P 메시지 타입 추가 |
| **W3** | Knowledge Profile 기본 (F-A23) | 프로필 데이터 모델. 도메인 자동 탐지 (vault 분석). CLI `sv federate profile` | 기본 프로필 조회 |
| **W4** | Founding Node 뱃지 | 뱃지 테이블 + 초기 100 노드 감지 로직. 뱃지 수여 + 알림 | 얼리 어답터 인센티브 |
| **W4** | 통합 테스트 | Phase 1 전체 기능 E2E 테스트. 크레딧 + 임팩트 + 히트맵 연동 확인 | 테스트 스위트 |

#### 6.2 Phase 2: 소셜 (Week 5-8)

| 주차 | 기능 | 세부 작업 | 산출물 |
|------|------|----------|--------|
| **W5** | 뱃지 시스템 (F-A24) | BadgeEngine 구현. 8종 뱃지 조건 로직. 일일 평가 스케줄러 | 뱃지 자동 수여 |
| **W5** | 뱃지 유지/Fade | 유지 조건 체크. 6개월 비활동 시 Fade 처리. 경고 알림 | Fade 로직 |
| **W6** | Knowledge Profile 전체 (F-A23) | 공개 프로필 생성. 뱃지 + 히트맵 + 임팩트 통합 표시 | `--public` 옵션 |
| **W6** | 도메인 인증 (F-A27) | Contributor/Specialist 자동 승격. 인증 기준 로직. CLI `sv federate certification` | 4단계 인증 |
| **W7** | Knowledge Streak (F-A29) | 연속일 카운트. Streak Freeze 구현 (크레딧 50). 마일스톤 알림 | 스트릭 시스템 |
| **W7** | 그룹 리더보드 | 그룹 내 기여 순위 계산. opt-in 설정. CLI `sv federate leaderboard` | 그룹 경쟁 |
| **W8** | MCP 도구 확장 | `knowledge-profile`, `network-impact`, `domain-experts` 3개 MCP 도구 | MCP 통합 |
| **W8** | 통합 테스트 | Phase 2 전체 E2E. 뱃지 수여 시나리오. 프로필 공개/비공개 전환 | 테스트 스위트 |

#### 6.3 Phase 3: 성장 (Week 9-12)

| 주차 | 기능 | 세부 작업 | 산출물 |
|------|------|----------|--------|
| **W9** | 문화별 온보딩 (F-A31) | 로케일 감지. 4개 문화권 내러티브. 온보딩 플로우 분기 | i18n 온보딩 |
| **W9** | Web Profile 페이지 | ActivityHeatmap React 컴포넌트. 프로필 웹 페이지 렌더링 | 공개 URL |
| **W10** | Year in Knowledge (F-A30) | 연간 요약 생성기. 카드 이미지 렌더링. 공유 URL | 바이럴 엔진 |
| **W10** | Free/Pro 인센티브 게이트 | Free 제한 (5 노드, 2 뱃지, 30일 히트맵). Pro 해금 로직 | 전환 트리거 |
| **W11** | LinkedIn 연동 준비 | Open Badges 2.0 발급. Verifiable Credentials 형식. 공유 메타데이터 | 인증 발급 |
| **W11** | 팀 전용 뱃지 3종 | Team MVP, Team Synergy, Team Mentor 로직 | Team 티어 가치 |
| **W12** | 성능 최적화 + 보안 | 히트맵 데이터 압축. 프로필 캐싱. Rate limiting. Privacy 감사 | 프로덕션 준비 |
| **W12** | 최종 통합 테스트 | 전체 인센티브 시스템 E2E. 부하 테스트. 문화별 온보딩 테스트 | 릴리스 준비 |

#### 6.4 구현 우선순위 의존성 그래프

```
W1: 데이터 모델 ─────────────────────────────────────────────────→
    ↓
W1: 임팩트 알림 (F-A26) ←── 가장 먼저 (동기 부여 효과 최고, 복잡도 최저)
    ↓
W2: Activity Heatmap (F-A25) ←── 임팩트 데이터 기반
W2: 크레딧 개선 ←── 독립적
    ↓
W3: Thanks 반응 (F-A28) ←── 임팩트 + 크레딧에 연결
W3: Profile 기본 (F-A23) ←── 히트맵 + 임팩트 통합
    ↓
W5: 뱃지 시스템 (F-A24) ←── 프로필에 표시
    ↓
W6: Profile 전체 + 도메인 인증 ←── 뱃지 + 인증 통합
    ↓
W7: Streak (F-A29) + 리더보드 ←── 독립적이나 프로필 연동
    ↓
W9-12: 문화별 UX + Web + Pro 게이트 + 연동 ←── 모든 기능 완성 후
```

---

## Part V: 구현 우선순위 Top 5 + 종합

### Top 5 우선순위 기능 선정

| 순위 | 기능 | 이유 | 예상 효과 | 구현 주차 |
|------|------|------|----------|----------|
| **1** | **임팩트 알림 (F-A26)** | 최저 복잡도, 최고 동기 부여 효과. "당신의 지식이 N번 검색됨" 피드백은 SDT의 유능감을 직접 충족. Duolingo의 "스트릭 시작" 역할 -- 사용자에게 "가치 있는 일을 하고 있다"는 첫 신호. 코드 변경량도 적어 1주 이내 구현 가능 | 리텐션 +15%p (추정). 유능감 충족으로 자발적 참여 증가. "아, 내가 도움이 되고 있구나" 인식 | W1 |
| **2** | **Activity Heatmap (F-A25)** | GitHub 잔디와 동일한 시각적 언어 → 개발자에게 친숙. 구현 복잡도 낮음 (일별 집계 + 시각화). 임팩트 알림의 데이터를 시각적으로 확장. "지식 잔디"로 마케팅 가능. 스트릭/꾸준함 동기를 자연스럽게 유발 | 일간 노드 활성 시간 +20% (추정). SNS 공유 시 바이럴 효과. "잔디를 비우기 싫어" 심리 | W2 |
| **3** | **Thanks 반응 (F-A28)** | Strava의 Kudos(140억+ 상호작용)에서 검증된 패턴. 인간적 피드백이 숫자보다 강력. 구현 간단 (P2P 메시지 1종 추가). 임팩트 알림에 "47번 검색 + 12개 Thanks" 추가 → 사회적 보상 계층 활성화 | 사회적 유대감 형성. 검색 품질 간접 피드백. "누군가 고마워했다" → 내적 동기 강화 | W3 |
| **4** | **Knowledge Profile 기본 (F-A23)** | "나는 어떤 전문가인가" 자기 인식의 시작점. 도메인 자동 탐지가 핵심 가치 -- 사용자가 모르던 자신의 전문성 발견. Free에서 Pro 전환의 핵심 트리거 ("전체 프로필을 보여주고 싶다"). 콜드 스타트 시 "Founding Node" 표시의 기반 | 자기 인식 변화 → 정체성 동기 활성화. Pro 전환율 +5%p (추정). LinkedIn 공유 시 무료 마케팅 | W3-W6 |
| **5** | **뱃지 시스템 (F-A24)** | ISR 2025 연구: 희귀 뱃지가 장기 동기 부여에 가장 효과적. 8종 뱃지는 다양한 동기 유형(얼리어답터, 전문성, 꾸준함, 사회성)을 커버. "Founding Node" 뱃지는 콜드 스타트의 핵심 당근. GitHub 연구의 교훈: 쉬운 뱃지 금지 → 희귀도 중심 설계로 회피 | 장기 참여 +25% (추정). 수집 욕구 → Pro 전환 트리거. 뱃지가 프로필의 "사회적 화폐" | W4-W5 |

### 선정 근거 종합

```
우선순위 원칙:
  1. "자동 기여 + 가시적 인정" (PRD 핵심 원칙 #5, #6)
  2. 낮은 복잡도 먼저 (1인 개발 리소스 제약)
  3. SDT 3요소 순서: 유능감(임팩트) → 관계성(Thanks) → 자율성(Profile)
  4. 데이터 의존성: 하위 기능이 상위 기능의 데이터를 활용
  5. 전환 퍼널: Free에서 가치 체험 → Pro로 확장

탈락 기능과 이유:
  - Knowledge Streak (W7): 효과적이나 뱃지+히트맵이 먼저 있어야 의미
  - Cultural Onboarding (W9): 사용자 0명 상태에서는 글로벌화보다 첫 100명 확보가 우선
  - Year in Knowledge (W10): 1년치 데이터가 쌓여야 의미 있음
  - LinkedIn 연동 (W11): 외부 연동은 핵심 기능 안정화 이후
  - 리더보드 (W7): GitHub 연구에서 부정적 반응 확인 → opt-in으로 나중에
```

---

## 참고 자료 (Research에서 활용)

**게이미피케이션 벤치마크:**
- [Duolingo Gamification Secrets (Orizon)](https://www.orizon.co/blog/duolingos-gamification-secrets) -- 스트릭이 60% 참여율 증가, 7일 스트릭 유저 3.6x 리텐션
- [Duolingo Customer Retention Strategy 2026 (Propel)](https://www.trypropel.ai/resources/duolingo-customer-retention-strategy) -- DAU/MAU 37%, Streak Freeze 이탈율 21% 감소
- [Strava Gamification Case Study (Trophy)](https://trophy.so/blog/strava-gamification-case-study) -- Kudos 140억+ 상호작용, 1시간 활동/2분 앱 사용
- [Strava Community & Gamification (Latana)](https://resources.latana.com/post/strava-deep-dive/) -- 클럽 기반 소속감, Personal Best 자기 경쟁
- [GitHub Gamification Case Study (Trophy)](https://trophy.so/blog/github-gamification-case-study) -- 기여 그래프가 핵심, 뱃지에 대한 부정적 의견 우세
- [GitHub Badge Exploratory Analysis (ScienceDirect 2024)](https://www.sciencedirect.com/science/article/pii/S0950584924001666) -- 쉬운 뱃지는 "shameful", opt-out 증가
- [2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025/) -- 수동 소비 > 능동 답변, 커리어 동기 지속

**문화적 차이:**
- [Culture impacts gamification strategies (WARC)](https://www.warc.com/NewsAndOpinion/News/Culture_impacts_gamification_strategies/38785) -- 문화별 게이미피케이션 반응 차이
- [Gamification in Asia (Politics East Asia)](https://www.politicseastasia.com/studying/gamification-in-asia/) -- 아시아 게이미피케이션 특수성

**PRD 내부 참조:**
- `stellavault-incentives.prd.md` -- ISR 2025 뱃지 연구, SDT 이론, Hofstede 문화 차원
- `stellavault-advanced.prd.md` -- Free/Pro/Team 티어 구조, F-A09 Knowledge Profile
- `stellavault-federation.prd.md` -- 크레딧 시스템, Trust/Reputation, P2P 프로토콜

---

**PM Agent Team**: 이 브레인스토밍은 [pm-skills](https://github.com/phuryn/pm-skills) by Pawel Huryn (MIT License)의 프레임워크를 참조하여 Discovery(실험 설계), Strategy(비즈니스 통합), Research(벤치마크+인터뷰), PRD(통합 스펙)의 4개 관점으로 작성되었습니다.
