import { Client } from '@notionhq/client';

const notion = new Client({ auth: 'process.env.NOTION_TOKEN' });
const PARENT_PAGE_ID = '330dcee017df808d92d4d9ff46fa7697';

function h1(t) { return { type: 'heading_1', heading_1: { rich_text: [{ text: { content: t } }] } }; }
function h2(t) { return { type: 'heading_2', heading_2: { rich_text: [{ text: { content: t } }] } }; }
function h3(t) { return { type: 'heading_3', heading_3: { rich_text: [{ text: { content: t } }] } }; }
function p(t) { return { type: 'paragraph', paragraph: { rich_text: [{ text: { content: t } }] } }; }
function q(t) { return { type: 'quote', quote: { rich_text: [{ text: { content: t } }] } }; }
function b(t) { return { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: t } }] } }; }
function d() { return { type: 'divider', divider: {} }; }
function callout(t, e = '💡') { return { type: 'callout', callout: { rich_text: [{ text: { content: t } }], icon: { emoji: e } } }; }
function code(t) { return { type: 'code', code: { rich_text: [{ text: { content: t } }], language: 'plain text' } }; }

async function main() {
  console.log('Creating Stella Network...');

  const part1 = [
    callout('Your knowledge stays yours. The network\'s intelligence becomes everyone\'s.', '🌐'),
    d(),
    h1('Executive Summary'),
    p('Stella Network는 각 개인의 Stellavault 인스턴스를 하나의 노드로 연결하는 분산 지식 네트워크입니다. 임베딩 벡터만 공유하여 원문 프라이버시를 보장하면서, AI 에이전트가 집단 지성에 접근할 수 있게 합니다.'),
    q('"지식 토렌트" — 토렌트가 파일을 공유하듯, Stella Network는 지식의 의미(벡터)를 공유합니다. 원문은 절대 나가지 않습니다.'),
    d(),
    h1('핵심 가치 제안'),
    h2('문제'),
    b('개인 지식은 고립된 섬 — 내 Obsidian vault는 나만 접근 가능'),
    b('중앙화 AI(ChatGPT, Notion AI)는 내 데이터를 서버에 넘겨야 함'),
    b('팀 간 지식 사일로 — Confluence 검색이 안 되는 보편적 고통'),
    b('$23B 지식 관리 시장을 중앙 플랫폼이 독점'),
    h2('솔루션'),
    b('각 Stellavault = 하나의 소버린 노드 (데이터 주권 보장)'),
    b('임베딩 벡터만 P2P로 공유 (원문 비공개, Differential Privacy)'),
    b('AI 에이전트(MCP)가 연합 네트워크를 시맨틱 검색'),
    b('Web of Trust로 노드 신뢰도 관리'),
    d(),
    h1('비즈니스 모델'),
    h2('3-Layer 수익 구조'),
    b('Layer 1 (단기): Tool — Stellavault Pro 개인 구독'),
    b('Layer 2 (중기): Federation — Enterprise 팀 라이선스 + Hub 노드'),
    b('Layer 3 (장기): Knowledge Economy — 지식 거래 플랫폼'),
    h2('가격 체계'),
    b('Free $0 — 로컬 전체 + 커뮤니티 연합 읽기 10회/일'),
    b('Pro $12/월 — 무제한 연합 검색 + Cloud Sync + 고급 인텔리전스'),
    b('Expert Node $29/월 — 인증 전문가 노드 + 지식팩 판매 + 프로필'),
    b('Team $18/인/월 — 프라이빗 연합 + 관리자 대시보드 + RBAC'),
    b('Enterprise 커스텀 — 온프레미스 + SLA + SSO'),
    h2('추가 수익원'),
    b('Knowledge Pack 마켓플레이스 — 판매가 30% 수수료'),
    b('Hub 노드 호스팅 — 관리형 $49/월'),
    b('API 과금 — 외부 AI 에이전트 연합 검색 시 토큰당'),
    b('인증 프로그램 — Stellavault Certified Expert $99/년'),
    h2('수익 예측'),
    b('Year 1: Pro 200명 + Team 5사 = ~$13K ARR'),
    b('Year 2: Pro 2K + Team 30사 + Expert 100 = ~$150K ARR'),
    b('Year 3: + Enterprise + Marketplace = $500K-1M ARR'),
    d(),
    h1('기술 아키텍처'),
    h2('Federation Protocol'),
    code('Node A (ML전문가)  <-- 임베딩만 교환 -->  Node B (DevOps)\nSQLite-vec (원문)      Hyperswarm P2P        SQLite-vec (원문)\nMCP 13+ tools         Protobuf + Noise       MCP 13+ tools\n+ federated-search    Ed25519 서명           + federated-search\n+ route-query         Diff Privacy           + network-gaps'),
    h2('프라이버시 보장'),
    b('원문 절대 비공개 — 임베딩 벡터만 공유'),
    b('Differential Privacy — 노이즈 추가로 원문 복원 불가'),
    b('EGuard — 임베딩 변환 레이어 (역변환 방지)'),
    b('공유 범위를 태그/폴더 단위로 직접 선택'),
    h2('기술 스택'),
    b('P2P: Hyperswarm (NAT traversal + DHT)'),
    b('직렬화: Protobuf (효율적 임베딩 전송)'),
    b('암호화: Noise Protocol + Ed25519'),
    b('검색: 분산 시맨틱 라우팅 (multi-hop)'),
    b('AI: MCP 4개 신규 도구 (federated-search, network-gaps, route-query, trust-score)'),
    d(),
    h1('토렌트 vs Stella Network'),
    b('BitTorrent: 같은 파일을 여러 명이 복제'),
    b('Stella Network: 서로 다른 지식을 가진 노드들이 보완'),
    callout('복제가 아니라 보완. 노드가 많을수록 더 똑똑해진다.', '💡'),
    d(),
    h1('블록체인 전략'),
    h2('2-Track 접근'),
    callout('블록체인 없어도 100% 작동. 토큰은 선택적 레이어.', '⚠️'),
    h3('Track A: 크레딧 시스템 (즉시)'),
    b('지식 공유 1건 = 10 크레딧 / 연합 검색 1건 = 1 크레딧 소모'),
    b('Hub 노드 DB로 관리 — 99%에게 충분'),
    h3('Track B: 온체인 토큰 (선택적)'),
    b('$STELLA 토큰 (Base/Solana L2) + 크레딧-토큰 브릿지'),
    b('지식팩 NFT — 소유권 + 자동 로열티'),
    h3('킬러 시나리오'),
    p('전문가가 지식팩 NFT 발행 → 검색에서 사용될 때마다 자동 로열티 → 지식 정리 = 패시브 인컴. 이것이 "지식의 저작권 + 자동 과금"이다.'),
  ];

  const page = await notion.pages.create({
    parent: { page_id: PARENT_PAGE_ID },
    icon: { emoji: '🌐' },
    properties: { title: [{ text: { content: 'Stella Network — 분산 지식 인텔리전스 플랫폼' } }] },
    children: part1,
  });
  console.log(`Page created: ${page.url}`);

  const part2 = [
    d(),
    h1('시장 진입 전략'),
    h2('Phase별 확장'),
    b('Phase 1 (지금): 개인 도구 — Stellavault 사용자 확보'),
    b('Phase 2 (6-12개월): Enterprise Federation — 기업 내부 연합 → 첫 수익'),
    b('Phase 3 (12-18개월): 커뮤니티 연합 오픈 — 네트워크 효과'),
    b('Phase 4 (18-36개월): 지식 경제 — 전문가 노드, 팩 마켓, 토큰'),
    h2('Beachhead'),
    b('Claude Code + Obsidian MCP 개발자 — 이미 MCP 사용, 온보딩 마찰 최소'),
    b('Obsidian 커뮤니티 수백만 명이 vault 보유'),
    h2('콜드 스타트 해결'),
    b('Enterprise Federation 먼저 — 회사 내부 5-10개 노드'),
    b('Knowledge Pack 시딩 — 공개 지식팩으로 초기 가치'),
    b('Stellavault Pro 유저 자동 연합 옵트인'),
    d(),
    h1('경쟁 분석'),
    b('Solid (Tim Berners-Lee) — 분산 데이터, 지식 특화 X'),
    b('AT Protocol (Bluesky) — 소셜 미디어 특화, 지식 그래프 X'),
    b('Nostr — 최소주의, 시맨틱 검색 X'),
    b('Anytype — P2P 노트, 벡터 검색/MCP X'),
    callout('유일하게 "임베딩 시맨틱 연합 검색 + AI 에이전트 + 프라이버시 보존"을 동시 제공', '🎯'),
    d(),
    h1('리스크 & 대응'),
    b('콜드 스타트 → Enterprise 먼저 + Pack 시딩'),
    b('임베딩 품질 차이 → 신뢰도 스코어링 + 품질 필터'),
    b('P2P 수익화 → Hub 노드 유료 모델'),
    b('프라이버시 사고 → DP + EGuard + 제3자 감사'),
    b('"왜 공유?" → 크레딧 인센티브 + 전문가 인증'),
    b('Web3 거부감 → Track A 기본, Track B 선택적'),
    d(),
    h1('구현 로드맵'),
    b('Week 1-3: P2P 연결 + 임베딩 동기화 프로토콜'),
    b('Week 4-6: 연합 시맨틱 검색 + 라우팅'),
    b('Week 7-9: Web of Trust + 프라이버시 레이어'),
    b('Week 10-11: 3D 네트워크 시각화 + MCP 통합'),
    b('Week 12+: Enterprise Federation MVP + 파일럿'),
    d(),
    h1('현재 상태 (2026-04-02)'),
    b('Stellavault 코어: GitHub 공개 (github.com/Evanciel/stellavault)'),
    b('CLI 19개, MCP 13+, PRD 22기능 중 18개 구현'),
    b('Federation Protocol PRD 작성 완료'),
    b('다음: Federation Phase 1 구현 시작'),
    d(),
    q('Notes die in folders. Stella Network makes collective intelligence accessible to everyone — without giving up ownership of a single word.'),
  ];

  await notion.blocks.children.append({ block_id: page.id, children: part2 });
  console.log('✅ Done! ' + page.url);
}

main().catch(console.error);
