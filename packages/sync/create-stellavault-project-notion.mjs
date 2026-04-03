import { Client } from '@notionhq/client';

const notion = new Client({ auth: 'process.env.NOTION_TOKEN' });
const PARENT_PAGE_ID = '330dcee017df808d92d4d9ff46fa7697';

function h2(t) { return { type: 'heading_2', heading_2: { rich_text: [{ text: { content: t } }] } }; }
function p(t) { return { type: 'paragraph', paragraph: { rich_text: [{ text: { content: t } }] } }; }
function d() { return { type: 'divider', divider: {} }; }
function callout(t, e = '💡') { return { type: 'callout', callout: { rich_text: [{ text: { content: t } }], icon: { emoji: e } } }; }

function table(headers, rows) {
  return {
    type: 'table', table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: false,
      children: [
        { type: 'table_row', table_row: { cells: headers.map(h => [{ type: 'text', text: { content: h } }]) } },
        ...rows.map(row => ({
          type: 'table_row', table_row: { cells: row.map(c => [{ type: 'text', text: { content: c } }]) }
        })),
      ],
    }
  };
}

function columnList(columns) {
  return {
    type: 'column_list', column_list: {
      children: columns.map(col => ({
        type: 'column', column: { children: col }
      }))
    }
  };
}

async function main() {
  console.log('Creating Stellavault project page...');

  const part1 = [
    // Callout header
    callout('Stellavault — Notes die in folders. Stellavault keeps your knowledge alive.', '🧠'),

    // 프로젝트 개요
    h2('프로젝트 개요'),
    table(['항목', '내용'], [
      ['프로젝트명', 'Stellavault (스텔라볼트)'],
      ['유형', '개인 지식 인텔리전스 플랫폼 (오픈소스 + Pro)'],
      ['목적', 'Obsidian vault를 벡터화하여 3D 시각화, AI 시맨틱 검색, 기억 감쇠 추적, MCP로 AI 에이전트 연결'],
      ['대상', 'AI 개발자, 지식 노동자, Obsidian 사용자'],
      ['핵심 가치', '지식 간 연결 자동 발견 + 잊혀가는 지식 감지 + AI 에이전트에 지식 접속'],
      ['라이선스', 'MIT (오픈소스)'],
      ['GitHub', 'github.com/Evanciel/stellavault'],
      ['CLI', 'stellavault (alias: sv) — 19개 명령어'],
      ['MCP', '13+ tools — Claude Code 등 AI 에이전트 연동'],
    ]),
    d(),

    // 핵심 기능
    h2('핵심 기능'),
    columnList([
      [
        callout('3D Knowledge Graph\nReact Three Fiber 기반 뉴럴 네트워크 시각화\nConstellation View + LOD 3단계\nTimeline 슬라이더 + Type/Source 필터', '🌐'),
      ],
      [
        callout('AI Semantic Search\nBM25 + Cosine + RRF 하이브리드\n384차원 로컬 벡터 임베딩\n시맨틱 + 키워드 융합', '🔍'),
      ],
    ]),
    columnList([
      [
        callout('Intelligence Layer\nFSRS 기억 감쇠 추적\n갭 탐지 + 모순 탐지\n중복 탐지 + 예측적 갭 분석\nAI 학습 경로 생성', '🧬'),
      ],
      [
        callout('MCP + Plugin\n13개 MCP 도구 (AI 에이전트 연동)\nPlugin SDK (이벤트 버스)\nWebhook 시스템\n커스텀 MCP 도구 빌더 (YAML)', '🔌'),
      ],
    ]),
    d(),

    // 기술 스택
    h2('기술 스택'),
    table(['카테고리', '기술', '버전 / 비고'], [
      ['Runtime', 'Node.js (ESM)', '20+'],
      ['Language', 'TypeScript', 'Strict mode'],
      ['Monorepo', 'npm workspaces', '4 packages (core, cli, graph, sync)'],
      ['Vector DB', 'SQLite-vec (better-sqlite3)', '384차원 임베딩'],
      ['Embedding', '@xenova/transformers', 'all-MiniLM-L6-v2 (로컬, API 키 불필요)'],
      ['Search', 'BM25 + Cosine + RRF', 'K=60, 하이브리드 퓨전'],
      ['3D 시각화', 'React Three Fiber + drei + Three.js', 'R3F 9.0 / Three 0.170'],
      ['State', 'Zustand', '5.0'],
      ['Memory Model', 'FSRS (Free Spaced Repetition)', 'SM2 알고리즘 변형'],
      ['AI 연동', 'MCP (@modelcontextprotocol/sdk)', 'stdio + Streamable HTTP'],
      ['Build', 'Vite (graph) + tsc (core/cli)', 'Vite 6.0'],
      ['Testing', 'Vitest', '116 tests'],
    ]),
    d(),

    // 규모 지표
    h2('규모 지표'),
    columnList([
      [
        callout('코드 규모\n175+ 소스 파일\n30,000+ LOC (TypeScript)\n4 workspace packages\n19 CLI 명령어\n13+ MCP 도구', '📊'),
      ],
      [
        callout('기능 현황\nPRD 22개 기능 중 18개 구현\nP0 (4/4) + P1 (7/7) + P2 (7/7)\nIntelligence 모듈 8개\ni18n 4개 언어 (en/ko/ja/zh)', '✅'),
      ],
      [
        callout('아키텍처\nHybrid Search (BM25+Vector+RRF)\nPlugin SDK + Webhook\nEmbed Widget (iframe)\nStreamable HTTP MCP\nKeyboard Navigation', '🏗️'),
      ],
    ]),
  ];

  const page = await notion.pages.create({
    parent: { page_id: PARENT_PAGE_ID },
    icon: { emoji: '🧠' },
    properties: { title: [{ text: { content: 'Stellavault (AI 지식 그래프 플랫폼)' } }] },
    children: part1,
  });
  console.log(`Page created: ${page.url}`);

  // Part 2: 하위 페이지들
  // 기술 아키텍처
  await notion.pages.create({
    parent: { page_id: page.id },
    properties: { title: [{ text: { content: '기술 아키텍처' } }] },
    children: [
      h2('Monorepo 구조'),
      { type: 'code', code: { rich_text: [{ text: { content:
`stellavault/
├── packages/
│   ├── core/       벡터 검색 엔진 + MCP 서버 + REST API + Intelligence
│   │   ├── indexer/       Vault 스캐너 + 청킹 + 임베딩
│   │   ├── search/        BM25 + Cosine + RRF
│   │   ├── store/         SQLite-vec 벡터 스토어
│   │   ├── intelligence/  FSRS + Gap + Duplicate + Contradiction + Learning Path
│   │   ├── mcp/           MCP 서버 (13+ tools) + Custom Tool Builder
│   │   ├── plugins/       Plugin SDK + Webhook Manager
│   │   ├── api/           REST API + Graph Data + Embed + Profile
│   │   ├── pack/          Knowledge Pack (.sv-pack)
│   │   ├── i18n/          다국어 (en/ko/ja/zh)
│   │   └── utils/         Error Recovery (retry + StellavaultError)
│   ├── cli/        19 CLI 명령어
│   │   └── commands/  init, index, search, graph, serve, decay, learn,
│   │                  brief, digest, review, gaps, duplicates, contradictions,
│   │                  clip, sync, card, status, pack
│   ├── graph/      3D Knowledge Graph (React Three Fiber)
│   │   ├── components/  Layout, Graph3D, GraphNodes, GraphEdges,
│   │   │                SearchBar, ClusterFilter, TypeFilter, Timeline,
│   │   │                HealthDashboard, ToolsPanel, NodeDetail, etc.
│   │   ├── hooks/       useGraph, useSearch, useLayout, useDecay,
│   │   │                useKeyboardNav, useExport, useMotion, usePulse
│   │   ├── stores/      Zustand graph-store (전체 상태 관리)
│   │   └── embed/       EmbedGraph (iframe 위젯)
│   └── sync/       Notion-Obsidian 동기화
└── scripts/        api-only.mjs` } }], language: 'plain text' } },
      d(),
      h2('Intelligence Layer'),
      table(['모듈', '기능', '파일'], [
        ['FSRS Decay Engine', '기억 감쇠 추적 (SM2 알고리즘)', 'intelligence/fsrs.ts + decay-engine.ts'],
        ['Gap Detector', '클러스터 간 지식 갭 탐지', 'intelligence/gap-detector.ts'],
        ['Duplicate Detector', '벡터 유사도 기반 중복 탐지', 'intelligence/duplicate-detector.ts'],
        ['Contradiction Detector', '모순 진술 탐지 (NLI 패턴)', 'intelligence/contradiction-detector.ts'],
        ['Learning Path', 'AI 학습 경로 생성', 'intelligence/learning-path.ts'],
        ['Predictive Gaps', '그래프 토폴로지 기반 예측', 'intelligence/predictive-gaps.ts'],
        ['Semantic Versioning', '임베딩 드리프트 추적', 'intelligence/semantic-versioning.ts'],
        ['Notifications', '설정 가능한 알림 시스템', 'intelligence/notifications.ts'],
      ]),
      d(),
      h2('MCP Tools (13+)'),
      table(['#', 'Tool', '기능'], [
        ['1', 'search', 'RRF 하이브리드 검색'],
        ['2', 'get-document', '문서 전문 조회'],
        ['3', 'list-topics', '토픽 클라우드'],
        ['4', 'get-related', '관련 문서 탐색'],
        ['5', 'generate-claude-md', 'CLAUDE.md 자동 생성'],
        ['6', 'create-snapshot', '컨텍스트 스냅샷'],
        ['7', 'load-snapshot', '스냅샷 복원'],
        ['8', 'log-decision', '기술 결정 기록'],
        ['9', 'find-decisions', '결정 검색'],
        ['10', 'export', 'JSON/CSV 내보내기'],
        ['11', 'get-decay-status', '기억 감쇠 리포트'],
        ['12', 'get-morning-brief', '아침 지식 브리핑'],
        ['13', 'get-learning-path', 'AI 학습 경로 추천'],
      ]),
    ],
  });
  console.log('  + 기술 아키텍처');

  // PDCA 산출물 요약
  await notion.pages.create({
    parent: { page_id: page.id },
    properties: { title: [{ text: { content: 'PDCA 산출물 요약' } }] },
    children: [
      h2('PM 분석'),
      table(['문서', '내용'], [
        ['core.prd.md', 'Phase 4 기능 분석 (FSRS, 갭 탐지, 클리핑 등)'],
        ['stellavault-advanced.prd.md', 'Advanced 22 features PRD (P0-P3, 5 tiers)'],
        ['stellavault-federation.prd.md', 'Federation Protocol PRD (P2P 분산 지식 네트워크)'],
      ]),
      d(),
      h2('구현 완료 기능 (18/22)'),
      table(['Tier', '기능', '상태'], [
        ['P0', 'F-A01 Onboarding Wizard (stellavault init)', '✅'],
        ['P0', 'F-A02 Error Recovery System (withRetry + StellavaultError)', '✅'],
        ['P0', 'F-A03 Performance Optimization (인덱서 resilience)', '✅'],
        ['P0', 'F-A08 Embeddable Graph Widget (/api/embed)', '✅'],
        ['P1', 'F-A21 CLI Output Polish (--json, --quiet)', '✅'],
        ['P1', 'F-A11 AI Learning Path Generator (sv learn + MCP)', '✅'],
        ['P1', 'F-A05 Notification Center', '✅'],
        ['P1', 'F-A09 Knowledge Profile (/api/profile)', '✅'],
        ['P1', 'F-A22 Streamable HTTP MCP', '✅'],
        ['P1', 'F-A20 10K+ Performance (maxVisibleNodes)', '✅'],
        ['P1', 'F-A15 Plugin SDK (PluginManager + 이벤트 버스)', '✅'],
        ['P2', 'F-A12 Contradiction Detector', '✅'],
        ['P2', 'F-A17 Webhook/Event System', '✅'],
        ['P2', 'F-A16 Custom MCP Tool Builder (YAML)', '✅'],
        ['P2', 'F-A18 Keyboard Graph Navigation', '✅'],
        ['P2', 'F-A13 Semantic Versioning (임베딩 드리프트)', '✅'],
        ['P2', 'F-A14 Predictive Gap Analysis', '✅'],
        ['P2', 'F-A19 i18n (en/ko/ja/zh)', '✅'],
      ]),
      d(),
      h2('미구현 (인프라 필요)'),
      table(['기능', '필요 인프라', '상태'], [
        ['F-A04 Cloud Sync Engine', 'S3/R2 스토리지', '대기'],
        ['F-A06 Team Vault', '인증 서버', '대기'],
        ['F-A07 Pack Marketplace', '웹 서비스', '대기'],
        ['P3 (5건)', '장기 비전', '대기'],
      ]),
    ],
  });
  console.log('  + PDCA 산출물 요약');

  // 기능 상세
  await notion.pages.create({
    parent: { page_id: page.id },
    properties: { title: [{ text: { content: '기능 상세 명세' } }] },
    children: [
      h2('CLI 명령어 (19개)'),
      table(['명령어', '기능'], [
        ['sv init', '인터랙티브 3단계 셋업 위저드'],
        ['sv index <path>', 'Obsidian vault 벡터화 인덱싱'],
        ['sv search <query>', '터미널 시맨틱 검색'],
        ['sv graph', '3D Knowledge Graph + API 서버 실행'],
        ['sv serve', 'MCP 서버 (stdio)'],
        ['sv status', '인덱스 상태 확인'],
        ['sv decay', '기억 감쇠 리포트'],
        ['sv learn', 'AI 학습 경로 추천'],
        ['sv brief', '오늘의 지식 브리핑'],
        ['sv digest', '주간 활동 리포트'],
        ['sv review', 'FSRS 기반 일일 리뷰 세션'],
        ['sv gaps', '지식 갭 탐지'],
        ['sv duplicates', '중복 노트 탐지'],
        ['sv contradictions', '모순 진술 탐지'],
        ['sv clip <url>', '웹/YouTube 클리핑'],
        ['sv sync', 'Notion → Obsidian 동기화'],
        ['sv card', 'SVG 프로필 카드 생성'],
        ['sv pack <cmd>', 'Knowledge Pack 관리'],
      ]),
      d(),
      h2('3D Graph UI 컴포넌트'),
      table(['컴포넌트', '기능'], [
        ['Graph3D', 'R3F Canvas + OrbitControls + 자동 회전'],
        ['GraphNodes', 'Points 클라우드 렌더링 + 클러스터 색상 + Decay 오버레이'],
        ['ConstellationView', 'MST 기반 별자리 뷰 + LOD 3단계'],
        ['SearchBar', '시맨틱 검색 + 검색 히스토리 드롭다운'],
        ['ClusterFilter', '클러스터 토글 필터'],
        ['TypeFilter', 'source/type 필터 드롭다운'],
        ['Timeline', '날짜 범위 슬라이더 + 히스토그램'],
        ['HealthDashboard', '종합 건강도 (decay/gaps/dups/growth)'],
        ['ToolsPanel', 'Intelligence 6탭 (Gaps/Duplicates/Decay/Clip/Sync/Health)'],
        ['NodeDetail', '노드 상세 패널 + 관련 문서 + Obsidian 열기'],
        ['EmbedGraph', 'iframe 임베드용 미니 그래프'],
      ]),
      d(),
      h2('API Endpoints'),
      table(['Method', 'Path', '기능'], [
        ['GET', '/api/graph', '전체 그래프 데이터 (cached)'],
        ['GET', '/api/search', 'RRF 하이브리드 검색'],
        ['GET', '/api/document/:id', '문서 전문 + 관련 문서'],
        ['GET', '/api/stats', '인덱스 통계'],
        ['GET', '/api/decay', '기억 감쇠 리포트'],
        ['GET', '/api/duplicates', '중복 노트 탐지'],
        ['GET', '/api/gaps', '지식 갭 리포트'],
        ['GET', '/api/health', '종합 건강도 대시보드'],
        ['GET', '/api/profile', '지식 프로필 (공개용)'],
        ['GET', '/api/embed', '임베드용 경량 그래프'],
        ['GET', '/api/profile-card', 'SVG 프로필 카드'],
        ['POST', '/api/clip', '웹 클리핑'],
        ['POST', '/api/sync', 'Notion 동기화 트리거'],
        ['POST', '/api/duplicates/merge', '중복 노트 병합'],
        ['POST', '/api/gaps/create-bridge', '갭 브릿지 노트 생성'],
      ]),
    ],
  });
  console.log('  + 기능 상세 명세');

  // Next Steps
  await notion.pages.create({
    parent: { page_id: page.id },
    properties: { title: [{ text: { content: '🔮 Next: Stella Network (Federation)' } }] },
    children: [
      callout('Stellavault의 다음 단계: 분산 지식 네트워크 (Federation Protocol)', '🌐'),
      p('각 Stellavault 인스턴스를 P2P 노드로 연결하여 "지식 토렌트" 구현.'),
      p('임베딩만 공유 (원문 비공개), AI 에이전트가 집단 지성에 접근.'),
      p('상세: Stella Network 페이지 참조'),
      d(),
      h2('Git History'),
      table(['Commit', '내용'], [
        ['94dceb4', 'feat: initial release of Stellavault'],
        ['d1b01c6', 'docs: rewrite README with core value proposition'],
        ['9b8caac', 'feat: P0 features (init, error recovery, perf, embed)'],
        ['1a72d52', 'feat: P1 features (CLI polish, learning path, notifications, profile, HTTP MCP, plugin SDK)'],
        ['6175b80', 'feat: P2 features (contradictions, webhooks, custom MCP, keyboard nav, semantic versioning, predictive gaps, i18n)'],
      ]),
    ],
  });
  console.log('  + Next Steps');

  console.log(`\n✅ Done! ${page.url}`);
}

main().catch(console.error);
