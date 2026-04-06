// 저장 노트용 다국어 문자열 — 사용자 언어에 따라 노트 섹션 제목 결정

export type NoteLocale = 'en' | 'ko' | 'ja' | 'zh';

const strings: Record<NoteLocale, Record<string, string>> = {
  en: {
    'summary': 'Summary',
    'description': 'Description',
    'transcript': 'Transcript',
    'views': 'Views',
    'relatedDocs': 'Related Documents',
    'relatedConcepts': 'Related Concepts',
    'relatedTags': 'Related Tags',
    'source': 'Source',
    'articles': 'Articles',
    'concepts': 'Concepts',
    'exploreFurther': 'Explore Further',
    'noResults': 'No results found',
    'tryDifferent': 'Try different keywords or create a note on this topic.',
    'digDeeper': 'Dig deeper',
    'findGaps': 'Find knowledge gaps',
    'thisConceptAppears': 'This concept appears in',
    'documents': 'documents',
    'compiledFrom': 'Compiled',
    'wikiArticlesFrom': 'wiki articles from',
    'sourceDocuments': 'source documents',
    'staleWarning': "documents haven't been modified in 6+ months. Run `stellavault decay` to review.",
    'gapsFound': 'knowledge gaps found. Start filling the most critical ones.',
    'duplicatesFound': 'duplicate documents detected. Run `stellavault duplicates` to merge.',
    'isolatedFound': 'isolated notes found. Add tags or links to connect them.',
    'healthy': 'Your knowledge base is healthy! Keep it up.',
    'youtubeVideo': 'YouTube video',
  },
  ko: {
    'summary': '핵심 요약',
    'description': '설명',
    'transcript': '영상 내용',
    'views': '조회수',
    'relatedDocs': '관련 문서',
    'relatedConcepts': '관련 개념',
    'relatedTags': '관련 태그',
    'source': '원본',
    'articles': '문서 목록',
    'concepts': '개념',
    'exploreFurther': '더 알아보기',
    'noResults': '검색 결과 없음',
    'tryDifferent': '다른 키워드로 검색하거나, 이 주제에 대한 노트를 작성해보세요.',
    'digDeeper': '더 깊이 알아보기',
    'findGaps': '빠진 지식 찾기',
    'thisConceptAppears': '이 개념이 등장하는 문서',
    'documents': '개',
    'compiledFrom': '컴파일됨',
    'wikiArticlesFrom': '개 위키 문서 생성 (원본',
    'sourceDocuments': '개)',
    'staleWarning': '개 문서가 6개월 이상 수정되지 않았어요. `stellavault decay`로 확인하세요.',
    'gapsFound': '개 지식 빈틈이 발견됐어요. 중요한 것부터 채워보세요.',
    'duplicatesFound': '개 겹치는 문서가 있어요. `stellavault duplicates`로 합치세요.',
    'isolatedFound': '개 떨어진 노트가 있어요. 태그나 링크로 연결하세요.',
    'healthy': '지식이 건강해요! 계속 유지하세요.',
    'youtubeVideo': 'YouTube 영상',
  },
  ja: {
    'summary': '要約',
    'description': '説明',
    'transcript': '内容',
    'views': '再生回数',
    'relatedDocs': '関連ドキュメント',
    'relatedConcepts': '関連コンセプト',
    'source': 'ソース',
    'noResults': '検索結果なし',
    'healthy': 'ナレッジベースは健全です！',
    'youtubeVideo': 'YouTube動画',
  },
  zh: {
    'summary': '摘要',
    'description': '描述',
    'transcript': '内容',
    'views': '观看次数',
    'relatedDocs': '相关文档',
    'relatedConcepts': '相关概念',
    'source': '来源',
    'noResults': '未找到结果',
    'healthy': '知识库很健康！',
    'youtubeVideo': 'YouTube视频',
  },
};

let currentNoteLocale: NoteLocale = 'en';

export function setNoteLocale(locale: NoteLocale): void {
  currentNoteLocale = locale;
}

export function getNoteLocale(): NoteLocale {
  return currentNoteLocale;
}

export function nt(key: string): string {
  return strings[currentNoteLocale]?.[key] ?? strings.en[key] ?? key;
}
