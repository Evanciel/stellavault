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
    'subtitle': '내 지식 우주',
    'search.placeholder': '무엇이든 검색해보세요...',
    'btn.multiverse': '다른 우주 보기',
    'btn.motion': '손동작',
    'btn.semantic': 'AI 검색',
    'btn.folders': '폴더별 보기',
    'btn.stars': '별자리',
    'btn.clusters': '주제 묶음',
    'btn.types': '종류',
    'btn.timeline': '시간순',
    'btn.decay': '잊고 있는 것',
    'btn.light': '밝게',
    'btn.dark': '어둡게',
    'btn.heatmap': '자주 보는 것',
    'btn.gaps': '빠진 지식',
    'btn.export': '내보내기',
    'btn.intelligence': '내 지식 분석',
    'status.docs': '개 노트',
    'status.edges': '개 연결',
    'status.clusters': '개 주제',
    'onboard.welcome': 'Stellavault에 오신 걸 환영해요',
    'onboard.welcome.body': '노트들이 우주처럼 펼쳐져 있어요. 마우스로 드래그하면 회전, 스크롤하면 확대돼요.',
    'onboard.welcome.empty': '아직 노트가 없어요. 터미널에서 `stellavault index /내vault경로`를 먼저 실행해주세요.',
    'onboard.search': '의미로 찾기',
    'onboard.search.body': '검색창에 궁금한 걸 입력하면, 단어가 아닌 의미로 찾아줘요. 관련 노트가 반짝이며 빛나요.',
    'onboard.add': '새 지식 넣기',
    'onboard.add.body': '오른쪽 아래 + 버튼을 누르면 URL, 글, 아이디어를 바로 넣을 수 있어요. 자동으로 정리돼요.',
    'onboard.explore': '이것저것 둘러보기',
    'onboard.explore.body': '"자주 보는 것"으로 활동량을, "빠진 지식"으로 놓친 연결을, "시간순"으로 변화 이력을, "잊고 있는 것"으로 복습할 노트를 확인하세요.',
    'onboard.skip': '건너뛰기',
    'onboard.next': '다음',
    'onboard.start': '시작할게요',
    'ingest.title': '새 지식 넣기',
    'ingest.placeholder': 'URL, 글, 떠오른 생각을 여기에...',
    'ingest.tags': '태그 (쉼표로 구분)',
    'ingest.add': '저장하기',
    'ingest.saving': '저장하는 중...',
    'ingest.saved': '저장했어요!',
    'ingest.error': '실패 — 다시 시도',
    'ingest.hint': 'URL, 유튜브 링크, 글, 아이디어 모두 가능해요',
    'intel.ask': '질문하기',
    'intel.ask.placeholder': '내 노트에 뭐든 물어보세요...',
    'intel.gaps': '빠진 지식',
    'intel.duplicates': '겹치는 노트',
    'intel.decay': '잊고 있는 것',
    'intel.health': '지식 건강도',
    'multi.title': 'Stella 네트워크',
    'multi.solo': '혼자 떠 있는 중 — 아직 연결된 사람이 없어요',
    'multi.peers': '명이 연결됨',
    'multi.alone': '지금은 혼자지만, 곧 다른 우주와 만날 수 있어요.',
    'multi.hint': '터미널에서 `stellavault federate join`을 실행하면 다른 사람과 연결돼요.',
    'multi.enter': '내 우주로 들어가기',
    'multi.click': '"내 우주"를 클릭하면 내 지식 그래프로 돌아가요',
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
