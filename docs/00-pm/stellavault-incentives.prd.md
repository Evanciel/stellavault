# Stellavault Federation -- 인센티브 & 참여 동기 분석 PRD

> **PM Agent Team 분석** | 생성일: 2026-04-02
>
> Stellavault Federation Protocol의 핵심 미해결 질문에 대한 심층 분석:
> "사용자가 왜 자신의 지식을 네트워크에 공유해야 하는가?"
>
> 선행 분석: `stellavault-federation.prd.md` (Federation Protocol, 2026-04-02),
> `stellavault-advanced.prd.md` (Advanced Features, 2026-04-02)
>
> GitHub: https://github.com/Evanciel/stellavault

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **문제** | Stellavault Federation은 기술적으로 완성된 P2P 지식 공유 프로토콜이지만, "왜 내 지식을 공유해야 하는가?"에 대한 설득력 있는 답이 부족하다. 기존 PRD의 인센티브 구조(검색 크레딧, 호혜성)는 토렌트의 시딩 비율 강제와 유사한 수준으로, 이것만으로는 자발적 참여를 이끌어내기 어렵다. BitTorrent에서도 85%가 프리라이더이며, 시딩은 소수의 이타적 사용자에 의존한다. 지식은 미디어 파일보다 공유 장벽이 높다 -- 지식은 정체성의 일부이기 때문이다. |
| **분석** | 6개 프레임워크(동기 이론, 네트워크 효과, 게이미피케이션, 문화론, 비교 플랫폼, 보상 모델)를 통해 인센티브 구조를 재설계한다. Stack Overflow, Wikipedia, 오픈소스, 토렌트, LinkedIn, GitHub의 참여 동기를 분석하고, 한국/미국/일본/유럽의 문화적 차이를 반영한 글로벌 전략을 제시한다. |
| **핵심 제안** | "지식 공유"가 아닌 "지식 정체성 구축"으로 프레이밍을 전환한다. 3계층 인센티브(내적 동기 > 사회적 보상 > 기능적 보상)와 "Come for the Tool, Stay for the Network" 전략으로 콜드 스타트를 해결한다. 금전적 보상(토큰/NFT)은 Phase 3 이후로 미루고, 초기에는 전문성 프로필과 기여 가시성에 집중한다. |
| **핵심 가치** | "지식을 공유하는 것이 아니라, 당신이 어떤 전문가인지를 세상에 보여주는 것이다. Federation은 당신의 지적 정체성을 증명하는 분산형 이력서다." |

---

## Part I: 인센티브 구조 심층 분석

### 1. "왜 내 지식을 공유하나?" -- 동기의 분류학

#### 1.1 Self-Determination Theory (SDT) 적용

Deci & Ryan의 자기결정이론에 따르면, 인간의 동기는 3가지 기본 심리적 욕구에서 비롯된다.

| 욕구 | 정의 | Federation에서의 발현 |
|------|------|----------------------|
| **자율성 (Autonomy)** | 행동의 주체가 나 자신이라는 느낌 | 무엇을, 얼마나, 누구에게 공유할지 완전한 통제권. 프라이버시 레벨 설정(paranoid/balanced/open). "나는 강요받지 않고 선택한다" |
| **유능감 (Competence)** | 환경에 효과적으로 대처할 수 있다는 느낌 | 내 지식이 다른 노드의 검색에 도움이 됨을 확인. "당신의 vault가 이번 주 37개 검색에 기여했습니다" 피드백 |
| **관계성 (Relatedness)** | 다른 사람과 연결되어 있다는 느낌 | 연합 그룹 소속감. "maya-lab 그룹의 5명과 지식을 교환하고 있습니다" |

**핵심 통찰**: 외적 보상(크레딧, 토큰)은 이 3가지 욕구를 충족시키지 못하면 역효과를 낸다. 2025년 연구에 따르면 외적 동기가 "통제적(controlling)"으로 인식되면 내적 동기의 긍정적 효과를 오히려 감소시킨다.

#### 1.2 동기 스펙트럼: 외적 vs 내적

```
완전 외적                                                    완전 내적
|---------|---------|---------|---------|---------|---------|
토큰/돈    크레딧    배지/랭킹   평판/인정   호기심     즐거움
          강제        게임화      사회적     탐구욕     Flow 상태
         시딩비율                 자본

  <-- 효과 단기적, 품질 저하 위험           효과 장기적, 자발적 -->
```

| 동기 유형 | 예시 | 지속성 | 품질 영향 | 위험 |
|-----------|------|--------|-----------|------|
| **금전적 보상** | 토큰, 로열티, pay-per-query | 단기 | 부정적 (스팸 유발) | 보상 중단 시 참여 급감, Goodhart's Law |
| **기능적 보상** | 검색 크레딧, 우선 라우팅, 더 많은 노드 접근 | 중기 | 중립 | 무임승차 문제 |
| **사회적 보상** | 평판 점수, 전문가 인증, 프로필 뱃지 | 장기 | 긍정적 | 허영 지표화, 게임화 피로 |
| **내적 동기** | 전문성 과시, 호기심 충족, 커뮤니티 기여감 | 최장기 | 가장 긍정적 | 스케일하기 어려움 |

#### 1.3 비교 플랫폼 분석: 사람들이 무료로 기여하는 이유

##### BitTorrent 시딩 동기

| 요인 | 설명 | Federation 적용 가능성 |
|------|------|----------------------|
| **기본값 관성** | 클라이언트가 자동으로 시딩. 끄려면 수동 조작 필요 | **높음** -- Federation 참여를 기본값으로 (opt-out 설계) |
| **비율 강제** | Private tracker의 시드 비율 요구 (1.0 이상) | **중간** -- 크레딧 시스템으로 유사 구현. 단, 너무 엄격하면 진입 장벽 |
| **사회적 의무감** | "내가 받았으니 돌려줘야 한다" | **높음** -- 호혜성은 지식 공유에도 강력한 동기 |
| **기여 무비용** | 업로드 대역폭 외 추가 비용 없음 | **높음** -- 임베딩 공유는 컴퓨팅/네트워크 비용 극히 미미 |
| **커뮤니티 지위** | Power User, VIP 등급 | **높음** -- 지식 전문가 등급 |

**핵심 교훈**: BitTorrent에서도 85%가 프리라이더다. 시딩은 소수 기여자(~15%)가 담당한다. 하지만 이 15%로도 시스템은 작동한다. Federation도 마찬가지로 소수의 열성 기여자가 네트워크를 지탱하는 구조를 목표로 해야 한다.

##### Stack Overflow

| 요인 | 설명 | Federation 적용 가능성 |
|------|------|----------------------|
| **평판 시스템** | Reputation points, badges, privileges | **높음** -- karma/trust score를 가시적 프로필로 |
| **커리어 시그널링** | SO 프로필을 이력서에 기재 | **매우 높음** -- "지식 전문가" 프로필을 LinkedIn처럼 사용 |
| **권한 해제** | 평판이 높으면 편집, 투표, 모더레이션 가능 | **높음** -- 고신뢰 노드에 특별 기능 (그룹 생성, 릴레이 등) |
| **"답을 아는" 만족감** | 내가 도울 수 있다는 유능감 | **높음** -- "당신의 지식이 검색됨" 알림 |
| **학습 효과** | 답변 작성 과정에서 본인도 학습 | **낮음** -- 임베딩 공유는 수동적 |

**핵심 교훈**: Stack Overflow의 가장 강력한 동기는 "커리어에 도움이 된다"는 것이다. 답변 활동이 채용 시그널로 기능한다. Federation도 "공개 지식 기여 프로필"이 커리어 자산이 되어야 한다.

##### Wikipedia

| 요인 | 설명 | Federation 적용 가능성 |
|------|------|----------------------|
| **사명감** | "인류의 지식을 체계화한다" | **중간** -- "분산형 집단 지성" 비전 |
| **익명성 역설** | 이름 없이도 기여. 순수한 내적 동기 | **낮음** -- Federation은 노드 정체성이 있음 |
| **교정 욕구** | "틀린 정보를 바로잡고 싶다" | **중간** -- 네트워크 갭 탐지와 연결 |
| **소유감** | "내가 작성한 문서"에 대한 자부심 | **높음** -- "내 vault가 이 분야의 핵심 노드" |

**핵심 교훈**: Wikipedia의 편집자는 전체 방문자의 0.02%에 불과하다. 극소수의 열성적 기여자가 시스템을 유지한다. 이 패턴은 Federation에도 그대로 적용된다.

##### 오픈소스 소프트웨어

| 요인 | 설명 | Federation 적용 가능성 |
|------|------|----------------------|
| **"직접 필요해서"** | 자신이 쓸 소프트웨어를 만듦 | **매우 높음** -- Federation 검색 자체가 본인에게도 유용 |
| **미래 임금/채용** | GitHub 프로필이 포트폴리오 | **매우 높음** -- 지식 기여 프로필 |
| **재미/Flow** | 코딩 자체의 즐거움 | **낮음** -- 임베딩 공유에 "재미"는 적음 |
| **선물 경제 (Gift Culture)** | 기여하면 존경받는 문화 | **높음** -- 지식 커뮤니티에서 전문가 인정 |
| **학습** | 다른 사람 코드에서 배움 | **높음** -- 네트워크 검색으로 새로운 관점 발견 |

**핵심 교훈**: 2025년 연구에 따르면 오픈소스에서 내적 동기(재미, 학습)와 외적 동기(커리어)가 공존할 때 가장 효과적이다. 외적 동기가 "통제적"이 아닌 "정보적"으로 인식되면 내적 동기를 오히려 강화한다.

#### 1.4 블록체인 토큰 인센티브의 현실

| 측면 | 연구 결과 | Federation 시사점 |
|------|----------|------------------|
| **단기 효과** | 토큰 보상은 정보 공유 "양"을 증가시킴 | 단기적 노드 수 확대에는 도움 |
| **품질 문제** | 토큰 보상이 있으면 정확도와 맥락화(contextualization)가 감소 | 저품질 vault 스팸 위험 |
| **Goodhart's Law** | "측정이 목표가 되면 좋은 측정이 아니게 된다" | 크레딧/토큰 최적화 > 실제 지식 가치 |
| **토큰 붕괴** | Internet Computer Protocol 등 토큰 가격 폭락 시 사용자 이탈 | 토큰 가치에 의존하는 인센티브는 불안정 |
| **유기적 참여 저하** | 금전 인센티브가 유기적 플랫폼 참여를 구축(crowding out) | 돈으로 온 사용자는 돈이 없으면 떠남 |

**결론**: 블록체인 토큰은 Federation의 초기 인센티브로 부적합하다. 기존 PRD의 크레딧 시스템(로컬, 비블록체인)이 올바른 방향이지만, 크레딧만으로는 충분하지 않다. 사회적/내적 동기를 우선 설계해야 한다.

---

### 2. 네트워크 효과 분석

#### 2.1 노드 수에 따른 가치 변화

```
가치
^
|                                          _____________ 10,000 노드
|                                    _____/              "지식 인터넷"
|                              _____/                     모든 주제 커버
|                        _____/                           AI 에이전트 기본 인프라
|                   ____/
|              ____/                                      100 노드
|         ____/                                           "지식 이웃"
|    ____/                                                특정 분야 충분한 커버리지
|___/                                                     네트워크 효과 체감
|..........                                               10 노드
|  "시작팩"                                               "스터디 그룹"
|  가치 거의 없음                                          가치 존재하지만 제한적
+---------------------------------------------------------> 노드 수
```

| 규모 | 가치 | 한계 | 필요한 것 |
|------|------|------|----------|
| **10 노드** | 소규모 그룹 내 검색. "스터디 그룹" 수준. 특정 프로젝트/연구팀에서는 유용 | 주제 범위가 극히 좁음. 한 명이 떠나면 가치 10% 감소 | 밀접한 관계 (연구실, 팀). 초대 기반. "이 사람들의 지식이 필요하다"는 명확한 필요 |
| **100 노드** | 특정 도메인(예: Rust 생태계, 생물정보학) 커버. 검색 관련성 80%+. 네트워크 갭 탐지 의미 있음 | 여전히 도메인 특화. 일반 지식에는 부족 | 도메인별 연합 그룹. "Rust Federation", "BioInfo Network". 커뮤니티 리더가 그룹을 만들고 초대 |
| **1,000 노드** | 여러 도메인 교차 검색 가능. AI 에이전트가 거의 항상 유용한 결과 반환. 롱테일 지식 커버 시작 | 거버넌스 복잡성 증가. 스팸/저품질 노드 유입 | 자동 평판 관리, 모더레이션 도구, 연합 그룹 계층화 |
| **10,000 노드** | "지식의 인터넷". 대부분의 기술 질문에 대해 관련 노드 발견. 학계, 기업 채택 | 중앙화 압력. 검색 지연. 거버넌스 위기 | 수퍼노드/릴레이 인프라, 분산 거버넌스, 엔터프라이즈 SLA |

#### 2.2 콜드 스타트 전략: Andrew Chen의 "Atomic Network"

Andrew Chen(a16z)의 콜드 스타트 프레임워크를 Federation에 적용:

##### 전략 1: "Come for the Tool, Stay for the Network"

Federation의 가장 큰 장점은 Stellavault가 이미 강력한 단독 도구라는 것이다.

```
Phase 1: Tool (이미 완료)
  사용자가 Stellavault를 개인 지식 관리 도구로 사용
  3D 그래프, FSRS, MCP 도구, 검색 -- 모두 혼자서 가치 있음

Phase 2: Invitation (콜드 스타트)
  "당신의 AI 에이전트가 동료의 지식에도 접근할 수 있다면?"
  1명의 동료 초대 = 즉시 양방향 검색 가능

Phase 3: Network (임계 질량)
  그룹 내 3-5명이 연결되면 가치 급증
  "이번 주에 당신의 vault가 12개 검색에 기여했습니다"

Phase 4: Growth Loop
  가치를 체감한 사용자가 다른 그룹에도 추천
```

##### 전략 2: Atomic Network 정의

Stellavault Federation의 **Atomic Network**(최소 유효 네트워크)는:

| 속성 | 값 | 이유 |
|------|---|------|
| **최소 노드 수** | 3-5명 | 2명은 DM에 불과. 3명부터 "네트워크" 느낌. 5명이면 다양성 확보 |
| **동질성** | 같은 팀/연구실/스터디 그룹 | 관심사 겹침이 높아야 검색 결과가 유용 |
| **관계** | 오프라인에서 이미 아는 사이 | 신뢰 비용 제로. Privacy 우려 최소화 |
| **프로필** | Obsidian 파워 유저, CLI 친숙 | 기술적 허들 낮음 |

**핵심 전략**: "글로벌 Federation"이 아니라 "팀 Federation"부터 시작한다. 5명의 연구실 동료가 연결되는 것이 10,000명의 느슨한 네트워크보다 가치 있다.

##### 전략 3: "Hard Side" 확보

Andrew Chen의 프레임워크에서 "Hard Side"는 네트워크에서 가장 많은 가치를 창출하는 사용자다.

Federation에서 Hard Side = **콘텐츠가 풍부한 vault 소유자**

이들을 확보하기 위한 전략:

| 전략 | 구체적 실행 |
|------|------------|
| **도구 보상** | 프로필 vault가 1,000+ 노트이면 Federation 프리미엄 기능 무료 (릴레이, 분석 대시보드) |
| **가시성 보상** | 기여도 높은 노드가 "Featured Knowledge Node" 목록에 노출 |
| **전문가 인증** | 특정 도메인에서 가장 많은 검색 결과를 제공하는 노드에 "Domain Expert" 뱃지 |
| **얼리 어답터 특권** | 초기 100 노드에게 "Founding Node" 영구 뱃지 + 투표권 |

#### 2.3 "지식 접근"만으로는 부족한 이유

기존 PRD는 "다른 노드의 지식에 접근할 수 있다"를 핵심 가치로 제시한다. 하지만 이것만으로는 부족하다.

| 이유 | 설명 |
|------|------|
| **검색 대안 존재** | Google, ChatGPT, 동료에게 직접 물어보기가 더 쉬울 수 있음 |
| **임베딩 한계** | 제목과 토픽만 보임, 원문은 못 봄 -- 실질적 유용성 의문 |
| **비대칭 가치** | 지식이 적은 사람은 많이 얻지만, 지식이 많은 사람은 덜 얻음 |
| **비용 인식** | "내 지식을 남에게 준다"는 심리적 비용이 있음 (임베딩뿐이라 해도) |

**추가로 필요한 것:**

1. **자기 인식 도구**: "당신의 vault에서 가장 많이 검색되는 토픽은 X입니다" -- 본인의 전문성을 객관적으로 확인
2. **전문성 프로필**: "이 사람은 Rust/WASM/P2P 분야의 전문가입니다" -- 외부에 보여줄 수 있는 프로필
3. **커뮤니티 소속감**: "당신은 Rust Federation의 핵심 기여자입니다" -- 정체성과 소속감
4. **영향력 가시화**: "당신의 지식이 이번 달 142개의 질문 해결에 기여했습니다" -- 유능감 충족

---

### 3. 글로벌 관점 분석

#### 3.1 싸이월드 미니홈피에서 배우는 교훈: "My Universe = 지식 프로필"

싸이월드는 2003-2008년 한국에서 국민 플랫폼이었다. 미니홈피의 핵심은 **디지털 자아 표현**이었다.

| 싸이월드 요소 | 성공 요인 | Federation "Knowledge Home" 적용 |
|-------------|----------|--------------------------------|
| **미니홈피** | 나만의 디지털 공간 꾸미기 | "Knowledge Profile" -- 나의 전문 분야, 기여 이력, vault 통계를 보여주는 공개 프로필 |
| **미니미 (아바타)** | 자기 표현의 즐거움 | "Knowledge Avatar" -- 전문 분야에 따른 시각적 아이덴티티 (그래프 모양, 색상, 테마) |
| **도토리** | 소액 결제로 아이템 구매 | 검색 크레딧 -- 기여로 획득, 프리미엄 기능에 사용 |
| **일촌** | 관계 기반 네트워크 | 연합 그룹 -- 신뢰 기반 지식 네트워크 |
| **방문자 수** | 인기 지표 | "당신의 지식이 N번 검색됨" -- 지적 영향력 지표 |

**싸이월드가 글로벌에서 실패한 이유와 교훈:**

| 실패 요인 | Federation에서의 해결책 |
|-----------|----------------------|
| 폐쇄적 플랫폼 (외부 공유 불가) | 오픈 프로토콜. Knowledge Profile을 웹에서 공유 가능 |
| 문화적 특수성 (한국의 관계 중심 SNS) | 기능적 가치 우선 (검색, AI 에이전트), 소셜은 부가 가치 |
| 기술 혁신 부재 (모바일 전환 실패) | AI/MCP 통합이 핵심 기술적 차별점 |
| Facebook과의 네트워크 효과 경쟁 | "인스타/트위터와 경쟁하지 않음. 지식 인프라라는 새 카테고리" |

**글로벌 성공 전략**: "소셜 네트워크"가 아닌 "지식 인프라"로 포지셔닝. 미니홈피의 "디지털 자아 표현" 동기는 "지적 정체성 표현"으로 전환. 꾸미기 재미 대신 전문성 증명의 실용적 가치.

#### 3.2 LinkedIn 비교: "전문성 과시" 동기의 지식 공유 적용

| 차원 | LinkedIn | Stellavault Federation |
|------|----------|----------------------|
| **핵심 동기** | 채용/이직/네트워킹 | 전문성 증명 + 지식 접근 |
| **프로필** | 경력, 학력, 스킬 | 지식 분야, 기여 이력, 전문 도메인 |
| **검증** | 동료 추천, 스킬 인증 | 검색 기여 통계, 노드 신뢰 점수, 도메인 전문가 뱃지 |
| **콘텐츠** | 글, 공유, 댓글 | 임베딩 (자동), 지식팩 (선택적) |
| **인센티브** | "리크루터가 연락해 올 수 있다" | "AI 에이전트가 당신을 전문가로 추천한다" |

**핵심 통찰**: LinkedIn에서 사람들은 "채용 기회"를 위해 콘텐츠를 작성한다. Federation에서는 **"AI 에이전트가 당신을 전문가로 라우팅한다"**가 동등한 동기가 될 수 있다. Claude가 "이 질문은 Node A의 전문 분야입니다"라고 추천하는 것은 리크루터가 프로필을 찾아오는 것과 같은 사회적 가치를 갖는다.

#### 3.3 GitHub Stars/Contributions: "공개 지식 기여도" 프로필의 가치

GitHub의 기여 그래프(잔디)는 프로필의 핵심 지표가 되었다.

```
GitHub 기여 그래프        →    Stellavault 지식 기여 그래프
XXXXXXXXX                     XXXXXXXXX
XXX XXXXX                     XXX XXXXX  
X XXXXXXX                     X XXXXXXX
XXXXX XXX                     XXXXX XXX
"코드 활동"                    "지식 기여 활동"

GitHub Stars              →    Knowledge Impact Score
"이 프로젝트가 유용했다"        "이 vault가 내 검색에 도움됐다"

GitHub Contributions      →    Federation Contributions
커밋 수, PR, 이슈               검색 기여 수, 검색 크레딧, 도메인 커버리지
```

| GitHub 요소 | Federation 대응 | 가치 |
|------------|----------------|------|
| Contribution Graph | Knowledge Activity Heatmap | 꾸준한 지식 관리 활동 시각화 |
| Stars | Impact Score | "당신의 지식이 유용했다"는 사회적 증명 |
| Followers | Trusted By | "N개 노드가 당신을 신뢰합니다" |
| Pinned Repos | Featured Domains | "내 전문 분야는 X, Y, Z입니다" |
| README Profile | Knowledge Profile | 자기 소개 + 전문 분야 + 기여 통계 |

**결론**: "공개 지식 기여도 프로필"은 매우 가치 있다. 개발자 문화에서 GitHub 잔디가 이미 사회적 화폐로 기능하는 것처럼, "지식 잔디"도 같은 역할을 할 수 있다. 단, LinkedIn/GitHub은 이미 "경력 도구"로 인식되지만, Stellavault는 아직 이 인식이 없다 -- 이를 만들어야 한다.

#### 3.4 문화권별 참여 동기 차이

Hofstede의 문화 차원 이론과 최근 연구를 결합하여 분석:

| 차원 | 한국 (IDV: 18) | 미국 (IDV: 91) | 일본 (IDV: 46) | 유럽 (다양) |
|------|----------------|----------------|----------------|------------|
| **주요 동기** | 소속감, 커뮤니티 인정, 관계 | 개인 브랜딩, 커리어, 자기 표현 | 품질/장인정신, 커뮤니티 의무, 조화 | 프라이버시, 데이터 주권, 실용성 |
| **공유 트리거** | "우리 팀/그룹에 도움이 된다" | "내 프로필이 돋보인다" | "완벽하게 정리된 것만 공유한다" | "내 데이터 통제권이 보장된다면" |
| **공유 장벽** | "남들 눈치, 미완성 공유 부담" | "시간 투자 대비 ROI 불분명" | "불완전한 지식 공유는 수치" | "GDPR, 프라이버시 침해 우려" |
| **효과적 인센티브** | 그룹 내 기여 순위, 팀 뱃지, 함께 성장하는 느낌 | 개인 Impact Score, "Featured Expert", 커리어 연동 | 도메인 마스터 인증, 품질 등급, 꾸준함 보상 | 투명한 데이터 사용, opt-in 세분화, 기능적 보상 우선 |
| **Federation 전략** | "팀 Federation" 강조. 그룹 성과 대시보드 | "Knowledge Profile" 강조. 개인 전문가 브랜딩 | "Quality Score" 강조. 꼼꼼한 분류/태깅 보상 | "Privacy Dashboard" 강조. 세분화된 공유 통제 |

**글로벌 전략 종합:**

```
한국        → "함께 성장하는 지식 커뮤니티" (We grow together)
미국        → "당신의 지적 브랜드를 구축하세요" (Build your knowledge brand)
일본        → "장인의 지식이 인정받는 곳" (Crafted knowledge, honored expertise)
유럽        → "당신의 데이터, 당신의 규칙" (Your data, your rules)
```

**구현 시사점**: Federation의 UI/UX에서 문화별 "온보딩 내러티브"를 다르게 설정할 수 있다. 핵심 기능은 같되, 가치 제안의 프레이밍을 로케일에 따라 조정.

---

### 4. 보상 모델 제안

#### 4.1 3계층 인센티브 아키텍처

기존 PRD의 "검색 크레딧"을 3계층 시스템으로 확장:

```
Layer 3: 내적 동기 (Foundation) -- 장기적, 자발적
  |  "나는 전문가다", "우리 그룹이 성장한다", "호기심이 충족된다"
  |
Layer 2: 사회적 보상 (Engagement) -- 중기적, 가시적
  |  프로필, 뱃지, 랭킹, 전문가 인증, 그룹 내 지위
  |
Layer 1: 기능적 보상 (Activation) -- 단기적, 즉각적
  |  검색 크레딧, 우선 라우팅, 프리미엄 기능 해제
  |
Base: 기본 가치 (단독 도구로서의 가치)
  Stellavault 자체가 강력한 개인 지식 관리 도구
```

#### 4.2 Layer 1: 기능적 보상 (기존 크레딧 시스템 개선)

| 요소 | 현재 (PRD) | 개선안 | 이유 |
|------|-----------|--------|------|
| 크레딧 시작 | 100 | 200 (+ 그룹 보너스 50) | 초기 체험 기간 확대. 가치를 느끼기 전에 크레딧 소진 방지 |
| 크레딧 소비 | 검색 1회 = 1 크레딧 | 검색 1회 = 0.5 크레딧 (그룹 내 무료) | 그룹 내 검색 장벽 제거. 그룹 간 검색만 크레딧 소비 |
| 크레딧 획득 | 검색 서빙 = 1 크레딧 | 서빙 + 품질 보너스 + 연속 기여 보너스 | 양질의 결과와 꾸준한 참여 장려 |
| 0 크레딧 시 | 검색 가능하나 낮은 우선순위 | 그룹 내 검색은 항상 가능, 공개 검색만 제한 | 너무 엄격하면 이탈 |
| **새로 추가** | 없음 | **기능 해제 크레딧**: 500 크레딧으로 네트워크 분석 대시보드 해제, 1000 크레딧으로 커스텀 연합 그룹 생성 | 크레딧의 용도 다양화 |

#### 4.3 Layer 2: 사회적 보상 (새로 설계)

##### 4.3.1 Knowledge Profile (공개 프로필)

```yaml
# Node Profile: james-park-dev
identity:
  display_name: "James Park"
  node_id: "abc123..."
  member_since: "2026-04"
  founding_node: true  # 초기 100 노드

expertise:
  domains:
    - name: "Rust/WebAssembly"
      confidence: 0.92
      search_served: 847
      rank: "#3 in Rust Federation"
    - name: "P2P Networking"
      confidence: 0.85
      search_served: 312
    - name: "System Design"
      confidence: 0.78
      search_served: 201

impact:
  total_searches_served: 1,360
  unique_nodes_helped: 47
  knowledge_quality_score: 4.7/5.0
  uptime_percentage: 94.2%

badges:
  - "Founding Node"          # 초기 100 노드
  - "Domain Expert: Rust"    # Rust 분야 상위 10%
  - "Reliable Node"          # 90일 연속 온라인
  - "Knowledge Bridge"       # 3개 이상 도메인 연결
  - "Community Pillar"       # 10+ 노드에서 vouch 받음

activity_heatmap: [...365 days of contribution data...]
```

##### 4.3.2 뱃지 시스템

2025년 ISR(Information Systems Research) 연구 기반으로 설계:
- **Valence (고가치 뱃지)** > Volume (뱃지 수) > Variety (뱃지 종류)
- 희귀한 뱃지가 장기 동기 부여에 가장 효과적

| 뱃지 | 조건 | 희귀도 | 동기 유형 |
|------|------|--------|----------|
| **Founding Node** | 초기 100 노드 | 전설 | 얼리 어답터 자부심 |
| **Domain Expert** | 특정 도메인 상위 10% 기여 | 영웅 | 유능감 |
| **Knowledge Bridge** | 3+ 도메인에서 기여 | 영웅 | 다학제 전문성 |
| **Reliable Node** | 90일 연속 온라인 유지 | 희귀 | 꾸준함 |
| **Community Pillar** | 10+ 노드의 vouch 보유 | 희귀 | 사회적 인정 |
| **Gap Filler** | 네트워크 갭 탐지에 의한 지식 추가 5회+ | 보통 | 커뮤니티 기여 |
| **Curator** | Knowledge Pack 공유 3개+ | 보통 | 공유 문화 |
| **Newcomer Guide** | 5+ 신규 노드를 vouch | 보통 | 멘토링 |

##### 4.3.3 리더보드 (문화별 차별화)

| 리더보드 유형 | 대상 문화 | 표시 방식 |
|-------------|----------|----------|
| **그룹 리더보드** | 한국, 일본 | 그룹 내 기여 순위. 이름 대신 아바타. "이번 주 우리 그룹의 MVP" |
| **개인 리더보드** | 미국 | 도메인별 전문가 순위. "Rust 분야 Top 10 Contributors" |
| **품질 리더보드** | 일본, 유럽 | 검색 품질 점수 기반. 양보다 질. "가장 정확한 검색 결과를 제공하는 노드" |
| **영향력 리더보드** | 글로벌 | "당신의 지식이 영향을 준 고유 노드 수" -- 양이 아닌 범위 |

**주의**: Stack Overflow 연구에서 리더보드가 "얕은 답변 남발" 행동을 유발한다는 것이 확인됨. 따라서:
- 양(검색 서빙 수)보다 질(검색 결과 유용성 피드백)을 기준으로 랭킹
- 기본 표시를 "개인 성장" (자신의 과거 대비)으로, "타인 비교"는 opt-in
- 뱃지 획득 후 활동이 감소하는 "badge fatigue" 방지 위해 뱃지에 유지 조건 추가

##### 4.3.4 "지식 전문가" 인증의 사회적 가치

| 인증 수준 | 조건 | 사회적 가치 | 기능적 특권 |
|-----------|------|------------|------------|
| **Contributor** | 50+ 검색 서빙 | "이 분야에 기여하고 있음" | 기본 프로필 |
| **Specialist** | 500+ 검색 서빙 + 도메인 상위 30% | "이 분야의 전문가" | 그룹 생성, 초대 코드 발급 |
| **Expert** | 2,000+ 검색 서빙 + 도메인 상위 10% + 5+ vouch | "이 분야의 최고 전문가" | 프리미엄 기능 무료, 네트워크 거버넌스 투표권 |
| **Mentor** | Expert + 5+ 노드를 Guide | "후배 전문가를 키우는 멘토" | Expert 특권 + 멘토 전용 대시보드 |

**LinkedIn 연동 가능성**: 향후 "Stellavault Domain Expert: Rust" 인증을 LinkedIn 프로필에 표시할 수 있다면, 지식 기여의 커리어 가치가 실질적으로 증가한다.

#### 4.4 Layer 3: 내적 동기 촉진

내적 동기는 "설계"할 수 없지만 "환경"을 만들 수 있다.

| 내적 동기 | 촉진 환경 |
|-----------|----------|
| **자기 발견** | "당신의 vault에서 가장 고유한 지식은 X 분야입니다 -- 네트워크의 다른 노드에는 이 주제가 거의 없습니다" |
| **호기심** | "이번 주 네트워크에서 가장 많이 검색된 토픽: Y. 당신의 vault에 관련 내용이 있을 수 있습니다" |
| **연결의 기쁨** | "당신의 Rust/WASM 지식이 BioInfo 연구자의 질문에 도움이 되었습니다 -- 예상치 못한 연결!" |
| **성장 가시화** | "지난 3개월간 당신의 vault 커버리지: 12개 도메인 → 15개 도메인. 새로운 분야: WebGPU" |
| **임팩트 가시화** | "당신의 지식이 이번 달 142건의 검색에 기여했습니다. 47개의 서로 다른 노드가 당신의 전문성을 활용했습니다" |

#### 4.5 지식팩 NFT + 로열티의 현실성 평가

| 측면 | 평가 | 상세 |
|------|------|------|
| **기술적 가능성** | 가능 | 지식팩(.sv-pack)에 NFT 메타데이터 연결, 다운로드 시 소액 결제 |
| **시장 현실** | 부정적 | 2024-2025 NFT 시장 폭락. "NFT"라는 단어 자체에 부정적 인식 |
| **대상 사용자 적합성** | 낮음 | 개발자/연구자는 NFT에 회의적. "오픈소스 정신"과 충돌 |
| **로열티 모델** | 이론적 가치 있음 | "다운로드당 $0.50" 모델은 가능하나, 결제 인프라 복잡성 |
| **타이밍** | Phase 3+ 이후 | 네트워크가 충분히 성장한 후(1,000+ 노드) 실험 가치 |
| **대안** | 구독 모델이 현실적 | "프리미엄 vault 접근" 월 $5로 시작, NFT보다 익숙한 모델 |

**권장**: NFT 라벨링을 피하되, "디지털 지식 자산의 출처 증명과 사용 추적" 기능은 유지. "NFT"가 아니라 "Knowledge Attribution"으로 프레이밍.

---

### 5. 위험 분석 및 균형점

#### 5.1 인센티브 스펙트럼 위험 분석

```
인센티브 없음                    적절한 균형                    과도한 인센티브
(현재 위험)                     (목표)                        (역효과 위험)
     |                            |                               |
 네트워크 텅 빔            자발적 참여 + 품질 유지           스팸, 조작, 내적 동기 구축
 프리라이더만 존재          다양한 동기 공존                  돈 따라 오고 돈 따라 감
 콜드 스타트 실패           지속 가능한 성장                  품질 하락, 신뢰 붕괴
```

#### 5.2 시나리오별 위험과 대응

| 시나리오 | 위험 | 발생 확률 | 영향 | 대응 |
|----------|------|----------|------|------|
| **인센티브 전무** | 초기 채택자 이후 성장 정체. 10-20 노드에서 멈춤 | 높음 | 치명적 | 최소한 Layer 1(기능적 보상) + 기본 프로필 필요 |
| **크레딧만 존재** | 크레딧 농사(bulk import 저품질 문서로 크레딧 획득) | 중간 | 높음 | Proof of Knowledge 요구 + 품질 가중치 |
| **금전 인센티브 도입** | 저품질 스팸 vault 폭증. "크레딧 팜" 봇 출현 | 높음 | 치명적 | Phase 1에서는 금전 인센티브 제외. 사회적 보상 우선 |
| **과도한 게이미피케이션** | 뱃지/랭킹에만 최적화. 실제 지식 가치와 괴리 | 중간 | 중간 | 뱃지 기준을 "질" 기반으로. 주기적 기준 리셋 |
| **문화 부적합** | 특정 문화권에서 리더보드가 역효과 (일본: 눈에 띄기 싫음) | 중간 | 중간 | 문화별 UI 커스터마이징. 기본값을 "개인 성장" 모드로 |
| **프라이버시 우려** | "내 전문 분야가 공개되는 것" 자체에 거부감 | 높음 | 높음 | 프로필 공개 수준 세분화 (비공개/그룹 내/공개) |

#### 5.3 Goodhart's Law 방지 전략

"측정이 목표가 되면, 좋은 측정이 아니게 된다"

| 잘못된 지표 | 유발 행동 | 개선된 지표 |
|------------|----------|------------|
| 검색 서빙 수 | 대량 저품질 문서 인덱싱 | 검색 결과 유용성 피드백 점수 |
| 크레딧 잔액 | 크레딧 저축만 하고 검색 안 함 | 크레딧 회전율 (획득/소비 비율) |
| 뱃지 수 | 뱃지 조건만 겨우 충족하는 행동 | 뱃지에 유지 조건 추가 (30일 연속 충족) |
| 온라인 시간 | 빈 노드 켜놓기 | 실제 검색 응답률 (온라인 중 응답한 비율) |
| 노드 수 | 한 사람이 여러 노드 운영 | 고유 vault 크기 + 다양성 점수 |

---

### 6. 종합 인센티브 설계: 로드맵

#### Phase 1: 기반 (Month 1-3) -- "Tool First"

| 요소 | 구현 | 목표 |
|------|------|------|
| **기본 크레딧 시스템** | 현재 PRD 대로 + 그룹 내 무료 검색 | 기능적 호혜성 확립 |
| **기본 프로필** | 노드 ID, 전문 도메인 자동 탐지, 기여 통계 | "나는 어떤 전문가인가" 자각 |
| **Founding Node 뱃지** | 초기 100 노드에 영구 뱃지 | 얼리 어답터 확보 |
| **임팩트 알림** | "당신의 지식이 N번 검색됨" 주간 요약 | 유능감 자극 |
| **Atomic Network 포커스** | 팀/연구실 단위 3-5명 연합 | 콜드 스타트 해결 |

#### Phase 2: 참여 (Month 4-6) -- "Network Effect"

| 요소 | 구현 | 목표 |
|------|------|------|
| **뱃지 시스템** | 8종 뱃지 (희귀도 기반) | 장기 참여 동기 |
| **Knowledge Profile** | 공개 프로필 페이지 (선택적) | 전문성 과시 동기 |
| **그룹 리더보드** | 그룹 내 기여 순위 (opt-in) | 소속감 + 건전한 경쟁 |
| **도메인 전문가 인증** | Contributor/Specialist 등급 | 사회적 인정 |
| **Knowledge Activity Heatmap** | GitHub 잔디와 같은 기여 시각화 | 꾸준함 동기 |
| **그룹 성과 대시보드** | "우리 그룹이 이번 달 500건 검색에 기여" | 집단적 성취감 |

#### Phase 3: 성장 (Month 7-12) -- "Knowledge Economy"

| 요소 | 구현 | 목표 |
|------|------|------|
| **Expert/Mentor 인증** | 상위 10% 전문가 등급 | 커리어 가치 |
| **Knowledge Marketplace** | 프리미엄 vault 접근 구독 모델 | 수익 창출 시작 |
| **Knowledge Pack 로열티** | 지식팩 다운로드당 소액 수익 | 콘텐츠 크리에이터 동기 |
| **외부 프로필 연동** | LinkedIn, GitHub에 Federation 인증 표시 | 사회적 가치 확대 |
| **거버넌스 투표** | Expert 이상 노드의 프로토콜 결정 참여 | 소유감, 장기 커미트먼트 |
| **문화별 UI 커스터마이징** | 로케일 기반 온보딩 내러티브 차별화 | 글로벌 확장 |

---

### 7. 핵심 인사이트 정리

#### 7.1 "왜 공유하나?"에 대한 최종 답변

사람들이 무료로 지식을 공유하는 진짜 이유는 **돈이나 크레딧이 아니다**.

```
토렌트 시더    → "나도 받았으니 돌려줘야지" (호혜성) + "귀찮아서 안 끔" (관성)
SO 답변자     → "내가 전문가임을 증명한다" (유능감) + "이직에 도움" (커리어)
위키 편집자    → "인류 지식에 기여한다" (사명감) + "틀린 거 못 참음" (교정 욕구)
OSS 기여자    → "내가 필요한 걸 만든다" (자기 필요) + "GitHub 잔디" (사회적 증명)
```

Federation에서 가장 강력한 동기 조합:

1. **"내 AI가 더 똑똑해진다"** -- 자기 필요 충족 (OSS와 같은 동기)
2. **"나는 이 분야의 전문가다"** -- 정체성 확인 (LinkedIn과 같은 동기)
3. **"우리 그룹이 함께 성장한다"** -- 소속감 (한국형 커뮤니티 동기)
4. **"기여가 자동이라 추가 노력이 없다"** -- 관성 (토렌트와 같은 동기)

#### 7.2 결정적 설계 원칙

| # | 원칙 | 근거 |
|---|------|------|
| 1 | **Opt-out > Opt-in** | 토렌트의 자동 시딩처럼, Federation 참여를 기본값으로. "공유하지 않으려면" 수동 해제 |
| 2 | **사회적 보상 > 금전적 보상** | 토큰/NFT는 역효과 위험. 프로필/뱃지/인증이 더 지속적 |
| 3 | **그룹 > 글로벌** | 콜드 스타트는 3-5명 Atomic Network로 해결. "글로벌 지식 네트워크"는 결과지 목표가 아님 |
| 4 | **질 > 양** | 모든 지표를 "유용성"과 "품질"에 가중치. Goodhart's Law 방지 |
| 5 | **자동 > 수동** | 임베딩 공유는 자동. 추가 노력 없는 기여가 참여율을 높임 |
| 6 | **피드백 > 보상** | "당신의 지식이 47개 노드에 도움" 피드백이 크레딧 100개보다 동기 부여 효과 높음 |
| 7 | **문화 적응** | 리더보드, 프로필, 온보딩 내러티브를 문화별로 조정 |

#### 7.3 "단순 지식 접근"을 넘어: 최종 가치 제안

기존 PRD: "다른 노드의 지식에 접근할 수 있다"

개선된 가치 제안:

> **"Stellavault Federation은 당신의 지적 정체성을 증명하는 분산형 이력서다.**
> 당신이 어떤 분야의 전문가인지를 코드 기여(GitHub)나 자기 선언(LinkedIn)이 아닌,
> 실제 지식의 깊이와 다른 사람에게 미친 영향으로 증명한다.
> 공유하는 것은 임베딩뿐이다 -- 아무도 당신의 노트를 읽지 못한다.
> 하지만 네트워크는 당신이 어떤 전문가인지를 알게 된다."

---

### 8. 데이터 모델 확장 (기존 Federation PRD 보완)

기존 `federation.db`에 추가되어야 할 테이블:

```sql
-- 뱃지 정의
CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rarity TEXT CHECK(rarity IN ('common', 'rare', 'epic', 'legendary')),
  icon TEXT,
  criteria_json TEXT NOT NULL,  -- 뱃지 획득 조건 JSON
  maintain_days INTEGER DEFAULT 0  -- 유지 조건 (0=영구)
);

-- 노드별 획득 뱃지
CREATE TABLE node_badges (
  node_id TEXT NOT NULL,
  badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  maintained_until TEXT,  -- 유지 조건 만료일
  PRIMARY KEY (node_id, badge_id)
);

-- 도메인 전문가 인증
CREATE TABLE domain_certifications (
  node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  level TEXT CHECK(level IN ('contributor', 'specialist', 'expert', 'mentor')),
  confidence REAL,
  search_served INTEGER DEFAULT 0,
  quality_score REAL DEFAULT 0,
  certified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, domain)
);

-- 검색 품질 피드백
CREATE TABLE search_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  serving_node_id TEXT NOT NULL,
  requesting_node_id TEXT NOT NULL,
  helpful BOOLEAN,  -- 결과가 유용했는지
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 지식 활동 히트맵 (일별 집계)
CREATE TABLE activity_heatmap (
  node_id TEXT NOT NULL,
  date TEXT NOT NULL,  -- YYYY-MM-DD
  searches_served INTEGER DEFAULT 0,
  searches_made INTEGER DEFAULT 0,
  unique_nodes_helped INTEGER DEFAULT 0,
  quality_avg REAL DEFAULT 0,
  PRIMARY KEY (node_id, date)
);

-- 그룹 성과
CREATE TABLE group_stats (
  group_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_searches INTEGER DEFAULT 0,
  total_nodes_active INTEGER DEFAULT 0,
  avg_quality REAL DEFAULT 0,
  top_domains TEXT,  -- JSON array
  PRIMARY KEY (group_id, date)
);

-- 주간 임팩트 요약 (노드별)
CREATE TABLE weekly_impact (
  node_id TEXT NOT NULL,
  week_start TEXT NOT NULL,  -- YYYY-MM-DD (Monday)
  searches_served INTEGER DEFAULT 0,
  unique_nodes_helped INTEGER DEFAULT 0,
  top_domain TEXT,
  new_badges TEXT,  -- JSON array of badge_ids
  PRIMARY KEY (node_id, week_start)
);
```

### 9. CLI 확장 (기존 Federation PRD 보완)

기존 14개 CLI 명령에 추가:

| # | 명령 | 설명 | 예시 |
|---|------|------|------|
| 15 | `sv federate profile` | 내 Knowledge Profile 보기 | `sv federate profile` |
| 16 | `sv federate profile --public` | 공개 프로필 생성/업데이트 | `sv federate profile --public` |
| 17 | `sv federate badges` | 획득 뱃지 목록 | `sv federate badges` |
| 18 | `sv federate impact` | 주간 임팩트 요약 | `sv federate impact` |
| 19 | `sv federate leaderboard` | 그룹 내 리더보드 | `sv federate leaderboard --group maya-lab` |
| 20 | `sv federate domains` | 내 전문 도메인 분석 | `sv federate domains` |
| 21 | `sv federate certification` | 도메인 인증 상태 | `sv federate certification` |

### 10. MCP 도구 확장

기존 4개 Federation MCP 도구에 추가:

| # | 도구 | 설명 | 파라미터 |
|---|------|------|---------|
| 5 | `knowledge-profile` | 노드의 Knowledge Profile 조회 | `node_id`, `include_badges` |
| 6 | `network-impact` | 네트워크 내 임팩트 통계 | `time_range`, `group_id` |
| 7 | `domain-experts` | 특정 도메인의 전문가 노드 목록 | `domain`, `min_level`, `limit` |

### 11. Pre-Mortem 분석

| # | 위험 | 발생 시나리오 | 확률 | 영향 | 완화 전략 |
|---|------|-------------|------|------|----------|
| 1 | **프로필이 개인정보 노출** | Knowledge Profile에서 전문 분야 추론으로 개인 식별 가능 | 중간 | 높음 | 프로필 공개 수준 3단계(비공개/그룹/공개). 도메인 일반화 옵션 (예: "Programming" 대신 "Technology") |
| 2 | **뱃지 농사** | 뱃지 조건만 겨우 충족하고 빠지는 반복 행동 | 높음 | 중간 | 유지 조건 추가. 30일 연속 충족 필요. 뱃지 "빛바래기" (6개월 비활동 시 회색 처리) |
| 3 | **리더보드 독성** | 경쟁이 과열되어 커뮤니티 분위기 악화 | 중간 | 높음 | 기본 비활성화 (opt-in). 절대 수치 대신 백분위. "개인 성장" 모드 기본 |
| 4 | **인센티브 중독** | 보상이 목적이 되어 인센티브 제거 시 참여 급감 | 중간 | 치명적 | Layer 3(내적 동기) 우선 설계. 보상은 "인식"이지 "목적"이 아님을 강조 |
| 5 | **문화 부적합** | 한국 출시 후 미국 확장 시 인센티브 구조 부적합 | 중간 | 중간 | 초기부터 문화별 온보딩 내러티브 분기. A/B 테스트 |

### 12. 성공 지표

| 지표 | Phase 1 목표 | Phase 2 목표 | Phase 3 목표 | 측정 방법 |
|------|-------------|-------------|-------------|----------|
| **월간 활성 노드** | 50 | 200 | 1,000 | 최근 30일 내 1회 이상 검색 서빙 |
| **노드당 평균 검색 서빙** | 10/주 | 30/주 | 100/주 | activity_heatmap 집계 |
| **프리라이더 비율** | <60% | <40% | <30% | 크레딧 소비만 하고 서빙 0인 노드 비율 |
| **검색 품질 점수** | 3.5/5.0 | 4.0/5.0 | 4.5/5.0 | search_feedback 집계 |
| **프로필 생성율** | N/A | 30% | 50% | 공개 프로필 생성한 노드 비율 |
| **뱃지 획득율** | N/A | 2.0 뱃지/노드 | 3.5 뱃지/노드 | 노드당 평균 뱃지 수 |
| **30일 리텐션** | 40% | 55% | 70% | 가입 30일 후 활성 비율 |
| **NPS** | 20+ | 40+ | 60+ | 분기별 설문 |

---

### 13. 테스트 시나리오

| # | 시나리오 | 조건 | 행동 | 예상 결과 |
|---|---------|------|------|----------|
| T-1 | 신규 노드 온보딩 | vault 1,000+ 노트 | Federation 참여 | 시작 크레딧 200, 전문 도메인 자동 탐지, 환영 알림 |
| T-2 | 첫 검색 서빙 | 다른 노드가 검색 | 자동 응답 | 크레딧 +1, "당신의 지식이 도움이 되었습니다" 알림 |
| T-3 | 뱃지 획득 | 50번째 검색 서빙 | 자동 체크 | "Contributor" 뱃지 획득, 축하 알림 |
| T-4 | 주간 임팩트 리포트 | 1주일 활동 후 | 월요일 자동 생성 | 검색 서빙 수, 도움받은 노드 수, 상위 도메인 포함 |
| T-5 | Knowledge Profile 생성 | 사용자 명령 | `sv federate profile --public` | 공개 프로필 생성, 도메인/뱃지/통계 포함 |
| T-6 | 그룹 리더보드 | 그룹 5+ 노드 활성 | `sv federate leaderboard` | 그룹 내 기여 순위 (이번 주 기준) |
| T-7 | 품질 피드백 | 검색 결과 수신 | 유용성 평가 | 서빙 노드의 quality_score 업데이트 |
| T-8 | 문화별 온보딩 | locale=ko-KR | 첫 실행 | "함께 성장하는 지식 커뮤니티" 내러티브 |
| T-9 | 문화별 온보딩 | locale=en-US | 첫 실행 | "Build your knowledge brand" 내러티브 |
| T-10 | 뱃지 유지 조건 | 90일 미활동 | 자동 체크 | "Reliable Node" 뱃지 회색 처리, 복원 안내 |

---

### 14. 기술 결정 기록

| 결정 | 선택 | 대안 | 근거 |
|------|------|------|------|
| 토큰 인센티브 | Phase 1에서 제외 | 블록체인 토큰 | 연구에 따르면 금전 인센티브가 내적 동기를 구축(crowd out). 초기에는 사회적 보상 우선 |
| 리더보드 기본값 | 비활성 (opt-in) | 기본 활성 | Stack Overflow 연구: 리더보드가 얕은 기여 행동 유발. 개인 성장 모드를 기본으로 |
| 뱃지 설계 | 고가치/희귀 뱃지 중심 | 많은 종류의 저가치 뱃지 | ISR 2025 연구: valence(고가치) > volume(수량). 희귀 뱃지가 장기 동기 부여에 효과적 |
| 프로필 공개 | 3단계 선택 (비공개/그룹/공개) | 전체 공개 | 일본/유럽 사용자의 프라이버시 우려. 점진적 공개로 신뢰 구축 |
| 그룹 내 검색 | 크레딧 무료 | 동일 크레딧 소비 | Atomic Network에서 마찰 최소화. 그룹 내 가치 체험이 콜드 스타트 핵심 |
| 문화별 UI | 온보딩 내러티브 분기 | 단일 글로벌 UI | Hofstede 연구 + 싸이월드 글로벌 실패 교훈. 기능은 같되 프레이밍만 조정 |

---

### 15. Stakeholder Map

| 이해관계자 | 관심사 | 영향력 | 참여 전략 |
|-----------|--------|--------|----------|
| **얼리 어답터 (PKM 파워 유저)** | Federation의 실용적 가치, 프라이버시 | 높음 | Founding Node 특권, 직접 피드백 루프 |
| **연구실/팀 리더** | 팀 생산성, 지식 공유 효율 | 높음 | 팀 Federation 패키지, 그룹 분석 대시보드 |
| **커뮤니티 리더 (Discord 모드, 컨퍼런스 스피커)** | 커뮤니티 가치, 콘텐츠 | 높음 | 커뮤니티 Federation 그룹 지원, 발표 자료 제공 |
| **개발자 (일반)** | 커리어 가치, 도구 품질 | 중간 | Knowledge Profile의 커리어 활용, GitHub/LinkedIn 연동 |
| **기업 (잠재)** | 팀 지식 관리, 온보딩 효율 | 낮음 (초기) | Enterprise Federation 로드맵 공유, 사례 연구 |
| **프라이버시 옹호자** | 데이터 주권, 임베딩 안전성 | 중간 | 프라이버시 백서, 오픈소스 감사 가능, 투명한 데이터 흐름 |

---

### Attribution

이 분석은 다음 프레임워크와 연구를 참조하였습니다:

**이론적 프레임워크:**
- Self-Determination Theory (Deci & Ryan) -- 내적/외적 동기 분류
- Hofstede Cultural Dimensions -- 문화별 인센티브 차이
- Andrew Chen, "The Cold Start Problem" (a16z) -- 콜드 스타트/Atomic Network
- Goodhart's Law -- 지표 게임화 방지

**학술 연구:**
- [ISR 2025: Badge System Design and Knowledge Sharing](https://pubsonline.informs.org/doi/abs/10.1287/isre.2023.0091) -- 뱃지 볼륨/가치/다양성 효과
- [2025 Pilot Study: Intrinsic and Extrinsic Motivation in Open Source](https://www.researchgate.net/publication/388431319) -- OSS 동기 상호작용
- [Blockchain Tokens for Knowledge Sharing](https://www.sciencedirect.com/org/science/article/pii/S1546223423000436) -- 토큰 인센티브 효과와 한계
- [ETH Zurich: Cryptoeconomic Token Incentives](https://www.research-collection.ethz.ch/server/api/core/bitstreams/c473af22-6153-4cf9-9fce-6e054c40e8b7/content) -- 블록체인 인센티브 실효성
- [FLOSS Developer Motivation](https://link.springer.com/article/10.1007/s12130-006-1002-x) -- 오픈소스 기여 동기 분류
- [Stack Overflow Careers and Motivation](https://www.sole-jole.org/assets/docs/15443.pdf) -- SO 답변자 커리어 동기
- [Cultural Dimensions: US, Korea, Japan](https://pmc.ncbi.nlm.nih.gov/articles/PMC5440576/) -- 문화별 개인주의/집단주의 변화
- [Cyworld Global Expansion Failure](https://www.grin.com/document/140972) -- 싸이월드 미국 시장 진출 실패 분석

**비교 플랫폼:**
- BitTorrent seeding dynamics (ETH Zurich Master Thesis, Patrick Moor)
- Stack Overflow gamification research
- Wikipedia contributor psychology (MIT Open Access, 2025)
- GitHub contribution culture and career signaling

**PM Agent Team**: 이 분석은 [pm-skills](https://github.com/phuryn/pm-skills) by Pawel Huryn (MIT License)의 프레임워크를 참조하여 Discovery, Strategy, Research, Go-To-Market, Execution 구조로 작성되었습니다.

---

## Appendix: 멀티 에이전트 브레인스토밍 결과 요약 (2026-04-02)

> 상세 내용: `stellavault-incentives-brainstorm.md`

### A.1 가설 검증 실험 3종 (pm-discovery)

| 실험 | 가설 | 방법 | 성공 기준 | 기간 |
|------|------|------|----------|------|
| E1: Knowledge Profile vs LinkedIn | KP가 전문성을 더 객관적으로 증명 | 채용담당자 30명 Paired Evaluation | KP 선호 >60% | 2주 |
| E2: Opt-out vs Opt-in | Opt-out이 노드 수 3x 이상 | 200명 Between-Subject RCT | Opt-out 그룹 2.5x | 6주 |
| E3: 뱃지/리더보드 효과 | 뱃지+Heatmap이 서빙 40%+ 증가 | 100 노드 Feature Flag A/B | 서빙 +30%, 리텐션 +10%p | 4주 |

### A.2 비즈니스 통합 핵심 (pm-strategy)

- **Free→Pro 전환 트리거 4종**: 노드 제한(5개), 프로필 완성, 뱃지 한계(2종), 임팩트 상세
- **3중 해자**: 데이터 네트워크 효과 + 사회적 자본 Lock-in + AI 에이전트 생태계
- **Enterprise 가치**: Knowledge Profile이 "조직 지식 디렉토리"로 → 온보딩 30% 단축, 퇴사 영향 분석

### A.3 게이미피케이션 벤치마크 핵심 (pm-research)

| 플랫폼 | 핵심 교훈 | Stellavault 적용 |
|--------|----------|-----------------|
| Duolingo | 스트릭이 3.6x 리텐션, Streak Freeze가 이탈 21% 감소 | Knowledge Streak + Node Freeze |
| Strava | Kudos 140억+, Year in Review 바이럴 | Thanks 반응 + Year in Knowledge |
| GitHub | 잔디가 사회적 화폐, 쉬운 뱃지는 역효과 | Activity Heatmap + 희귀 뱃지 집중 |
| Stack Overflow | 수동 소비 > 능동 기여, 커리어 시그널링 핵심 | 자동 기여 + LinkedIn 연동 |

### A.4 구현 우선순위 Top 5 (pm-prd)

| 순위 | 기능 | 근거 | 구현 주차 |
|------|------|------|----------|
| 1 | 임팩트 알림 | 최저 복잡도 + SDT 유능감 직접 충족 | W1 |
| 2 | Activity Heatmap | GitHub 잔디 패턴, 개발자 친숙, 스트릭 유도 | W2 |
| 3 | Thanks 반응 | Strava Kudos 검증, 사회적 보상 시작 | W3 |
| 4 | Knowledge Profile | 정체성 동기 활성화, Pro 전환 핵심 | W3-W6 |
| 5 | 뱃지 시스템 | ISR 연구 기반 희귀 뱃지, 장기 참여 | W4-W5 |

### A.5 12주 로드맵

```
Phase 1 (W1-4): 기반  ── 임팩트 알림, 히트맵, Thanks, 프로필 기본, Founding Node 뱃지
Phase 2 (W5-8): 소셜  ── 뱃지 시스템, 프로필 전체, 도메인 인증, Streak, 리더보드, MCP
Phase 3 (W9-12): 성장 ── 문화별 온보딩, Web Profile, Year in Knowledge, Pro 게이트, LinkedIn
```
