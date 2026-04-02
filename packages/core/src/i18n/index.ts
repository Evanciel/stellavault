// i18n Foundation (F-A19)
// Simple string externalization for CLI and Graph UI

export type Locale = 'en' | 'ko' | 'ja' | 'zh';

const strings: Record<Locale, Record<string, string>> = {
  en: {
    'init.welcome': 'Stellavault Setup Wizard',
    'init.tagline': "Notes die in folders. Let's bring yours to life.",
    'init.step1': 'Where is your Obsidian vault?',
    'init.step2': 'Indexing your vault',
    'init.step3': 'Try your first search',
    'init.done': 'Setup complete!',
    'index.complete': 'Indexing complete',
    'search.no_results': 'No results found.',
    'decay.report_title': 'Knowledge Decay Report',
    'decay.tip': 'Search a topic to refresh decaying knowledge',
    'learn.title': 'Your Learning Path',
    'learn.all_clear': 'All clear! Your knowledge is in great shape.',
    'contradictions.title': 'potential contradictions found',
    'contradictions.none': 'No contradictions detected. Your knowledge is consistent!',
    'graph.title': 'Stellavault',
    'graph.subtitle': 'Neural Knowledge Graph',
    'error.vault_not_found': 'Vault not found',
    'error.db_init_failed': 'Database initialization failed',
    'error.embedder_failed': 'Embedding model failed to load',
  },
  ko: {
    'init.welcome': 'Stellavault 설정 마법사',
    'init.tagline': '노트는 폴더에서 죽습니다. 당신의 지식을 살려봅시다.',
    'init.step1': 'Obsidian vault 경로가 어디인가요?',
    'init.step2': 'vault 인덱싱 중',
    'init.step3': '첫 번째 검색을 해보세요',
    'init.done': '설정 완료!',
    'index.complete': '인덱싱 완료',
    'search.no_results': '검색 결과가 없습니다.',
    'decay.report_title': '지식 감쇠 리포트',
    'decay.tip': '검색하면 감쇠 중인 지식이 리프레시됩니다',
    'learn.title': '당신의 학습 경로',
    'learn.all_clear': '모든 지식이 건강합니다!',
    'contradictions.title': '개의 잠재적 모순 발견',
    'contradictions.none': '모순이 없습니다. 지식이 일관됩니다!',
    'graph.title': 'Stellavault',
    'graph.subtitle': '뉴럴 지식 그래프',
    'error.vault_not_found': 'vault를 찾을 수 없습니다',
    'error.db_init_failed': '데이터베이스 초기화 실패',
    'error.embedder_failed': '임베딩 모델 로딩 실패',
  },
  ja: {
    'init.welcome': 'Stellavault セットアップウィザード',
    'init.tagline': 'ノートはフォルダで死にます。あなたの知識を生かしましょう。',
    'graph.title': 'Stellavault',
    'graph.subtitle': 'ニューラルナレッジグラフ',
    'search.no_results': '検索結果がありません。',
  },
  zh: {
    'init.welcome': 'Stellavault 设置向导',
    'init.tagline': '笔记在文件夹中消亡。让你的知识活起来。',
    'graph.title': 'Stellavault',
    'graph.subtitle': '神经知识图谱',
    'search.no_results': '没有搜索结果。',
  },
};

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string, fallback?: string): string {
  return strings[currentLocale]?.[key] ?? strings.en[key] ?? fallback ?? key;
}

export function detectLocale(): Locale {
  const env = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || '';
  if (env.startsWith('ko')) return 'ko';
  if (env.startsWith('ja')) return 'ja';
  if (env.startsWith('zh')) return 'zh';
  return 'en';
}
