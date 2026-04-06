// 웹 UI용 다국어 번역

export type Locale = 'en' | 'ko' | 'ja' | 'zh';

const strings: Record<Locale, Record<string, string>> = {
  en: {
    // Layout
    'title': 'Stellavault',
    'subtitle': 'Neural Knowledge Graph',
    'search.placeholder': 'Search knowledge...',
    'btn.multiverse': 'Multiverse',
    'btn.motion': 'Motion',
    'btn.semantic': 'AI Semantic',
    'btn.folders': 'Obsidian Folders',
    'btn.stars': 'Stars',
    'btn.clusters': 'Clusters',
    'btn.types': 'Types',
    'btn.timeline': 'Timeline',
    'btn.decay': 'Decay',
    'btn.light': 'Light',
    'btn.dark': 'Dark',
    'btn.heatmap': 'Heatmap',
    'btn.gaps': 'Gaps',
    'btn.export': 'Export',
    'btn.intelligence': 'Intelligence',
    // Status
    'status.docs': 'docs',
    'status.edges': 'edges',
    'status.clusters': 'clusters',
    // Onboarding
    'onboard.welcome': 'Welcome to Stellavault',
    'onboard.welcome.body': 'Your vault is visualized as a neural network. Drag to rotate, scroll to zoom.',
    'onboard.welcome.empty': 'Your vault is empty. Run `stellavault index /path/to/vault` in terminal first.',
    'onboard.search': 'Search by Meaning',
    'onboard.search.body': 'Use the search bar (or press /) to find notes by meaning. Matching nodes will pulse.',
    'onboard.add': 'Add Knowledge',
    'onboard.add.body': 'Click the + button to paste URLs, text, or ideas. Auto-saved to your vault.',
    'onboard.explore': 'Explore Features',
    'onboard.explore.body': 'Try: Heatmap (activity), Gaps (missing links), Timeline (history), Decay (fading memory).',
    'onboard.skip': 'Skip',
    'onboard.next': 'Next',
    'onboard.start': 'Get Started',
    // Ingest
    'ingest.title': 'Add Knowledge',
    'ingest.placeholder': 'Paste URL, text, or type an idea...',
    'ingest.tags': 'tags (comma separated)',
    'ingest.add': 'Add to Vault',
    'ingest.saving': 'Saving...',
    'ingest.saved': 'Saved!',
    'ingest.error': 'Error — Retry',
    'ingest.hint': 'Supports: URLs, YouTube links, plain text, ideas',
    // Intelligence
    'intel.ask': 'Ask',
    'intel.ask.placeholder': 'Ask your vault...',
    'intel.gaps': 'Gaps',
    'intel.duplicates': 'Duplicates',
    'intel.decay': 'Decay',
    'intel.health': 'Health',
    // Multiverse
    'multi.title': 'Stella Network',
    'multi.solo': 'Solo mode — no peers connected',
    'multi.peers': 'peers connected',
    'multi.alone': 'Your universe floats alone — for now.',
    'multi.hint': 'Run `stellavault federate join` to connect.',
    'multi.enter': 'Enter My Universe',
    'multi.click': 'Click "My Universe" to enter your knowledge graph',
  },
  ko: {
    'title': 'Stellavault',
    'subtitle': '뉴럴 지식 그래프',
    'search.placeholder': '지식 검색...',
    'btn.multiverse': '멀티버스',
    'btn.motion': '모션',
    'btn.semantic': 'AI 시맨틱',
    'btn.folders': 'Obsidian 폴더',
    'btn.stars': '별자리',
    'btn.clusters': '클러스터',
    'btn.types': '유형',
    'btn.timeline': '타임라인',
    'btn.decay': '감쇠',
    'btn.light': '라이트',
    'btn.dark': '다크',
    'btn.heatmap': '히트맵',
    'btn.gaps': '갭',
    'btn.export': '내보내기',
    'btn.intelligence': '인텔리전스',
    'status.docs': '문서',
    'status.edges': '연결',
    'status.clusters': '클러스터',
    'onboard.welcome': 'Stellavault에 오신 것을 환영합니다',
    'onboard.welcome.body': '당신의 vault가 뉴럴 네트워크로 시각화되었습니다. 드래그로 회전, 스크롤로 확대.',
    'onboard.welcome.empty': 'vault가 비어있습니다. 터미널에서 `stellavault index /vault경로`를 먼저 실행하세요.',
    'onboard.search': '의미로 검색하기',
    'onboard.search.body': '검색바(또는 / 키)로 의미 기반 검색을 해보세요. 일치 노드가 빛나며 맥동합니다.',
    'onboard.add': '지식 추가하기',
    'onboard.add.body': '+ 버튼을 클릭해서 URL, 텍스트, 아이디어를 바로 입력하세요. 자동 저장됩니다.',
    'onboard.explore': '기능 탐색하기',
    'onboard.explore.body': '히트맵(활동), 갭(누락 연결), 타임라인(이력), 감쇠(잊어가는 기억)을 탐색해보세요.',
    'onboard.skip': '건너뛰기',
    'onboard.next': '다음',
    'onboard.start': '시작하기',
    'ingest.title': '지식 추가',
    'ingest.placeholder': 'URL, 텍스트, 또는 아이디어를 입력...',
    'ingest.tags': '태그 (쉼표로 구분)',
    'ingest.add': 'vault에 추가',
    'ingest.saving': '저장 중...',
    'ingest.saved': '저장 완료!',
    'ingest.error': '오류 — 재시도',
    'ingest.hint': '지원: URL, 유튜브, 텍스트, 아이디어',
    'intel.ask': '질문',
    'intel.ask.placeholder': 'vault에 질문하기...',
    'intel.gaps': '갭',
    'intel.duplicates': '중복',
    'intel.decay': '감쇠',
    'intel.health': '건강',
    'multi.title': 'Stella 네트워크',
    'multi.solo': '솔로 모드 — 연결된 피어 없음',
    'multi.peers': '개 피어 연결됨',
    'multi.alone': '당신의 우주가 홀로 떠있습니다 — 지금은요.',
    'multi.hint': '`stellavault federate join`으로 P2P 네트워크에 연결하세요.',
    'multi.enter': '내 우주로 들어가기',
    'multi.click': '"내 우주"를 클릭해서 지식 그래프에 진입하세요',
  },
  ja: {
    'title': 'Stellavault',
    'subtitle': 'ニューラルナレッジグラフ',
    'search.placeholder': '知識を検索...',
    'btn.multiverse': 'マルチバース',
    'btn.stars': '星座',
    'btn.timeline': 'タイムライン',
    'btn.decay': '減衰',
    'btn.heatmap': 'ヒートマップ',
    'btn.intelligence': 'インテリジェンス',
    'onboard.welcome': 'Stellavaultへようこそ',
    'onboard.skip': 'スキップ',
    'onboard.next': '次へ',
    'onboard.start': '始める',
    'ingest.title': '知識を追加',
    'ingest.add': '保管庫に追加',
  },
  zh: {
    'title': 'Stellavault',
    'subtitle': '神经知识图谱',
    'search.placeholder': '搜索知识...',
    'btn.multiverse': '多元宇宙',
    'btn.stars': '星座',
    'btn.timeline': '时间线',
    'btn.decay': '衰减',
    'btn.heatmap': '热力图',
    'btn.intelligence': '智能',
    'onboard.welcome': '欢迎使用Stellavault',
    'onboard.skip': '跳过',
    'onboard.next': '下一步',
    'onboard.start': '开始',
    'ingest.title': '添加知识',
    'ingest.add': '添加到知识库',
  },
};

let currentLocale: Locale = detectBrowserLocale();

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language?.toLowerCase() ?? '';
  if (lang.startsWith('ko')) return 'ko';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

export function setUiLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem('sv_locale', locale);
}

export function getUiLocale(): Locale {
  const saved = localStorage.getItem('sv_locale') as Locale | null;
  if (saved && strings[saved]) return saved;
  return currentLocale;
}

export function t(key: string): string {
  const locale = getUiLocale();
  return strings[locale]?.[key] ?? strings.en[key] ?? key;
}

export function getAvailableLocales(): Locale[] {
  return ['en', 'ko', 'ja', 'zh'];
}
