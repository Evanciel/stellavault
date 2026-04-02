# Stellavault — Notion 연동 설정 가이드

## 개요

Stellavault는 Notion에서 작성한 내용을 Obsidian vault로 자동 동기화합니다.
두 가지 모드가 있습니다:

| 모드 | 스크립트 | 설명 |
|------|---------|------|
| **기본** | `sync-to-obsidian.mjs` | 페이지 계층을 그대로 마크다운으로 변환 |
| **구조화** | `structured-sync.mjs` | DB 속성→frontmatter, DB이름→폴더 자동 매핑 |

## 1단계: Notion Integration 생성

1. https://www.notion.so/my-integrations 접속
2. "New Integration" 클릭
3. 이름: `Stellavault Sync`
4. Capabilities: Read content, Read comments
5. "Submit" → API Key 복사

## 2단계: 페이지 공유

동기화할 Notion 페이지에서:
1. 우측 상단 `...` → "Connections" → "Stellavault Sync" 추가
2. 하위 페이지에도 자동 적용됨

## 3단계: 환경변수 설정

```bash
cd packages/sync
cp .env.example .env
```

`.env` 편집:
```
NOTION_API_KEY=ntn_your_key_here
NOTION_ROOT_PAGE_ID=your_page_id_here
OBSIDIAN_PATH=/path/to/your/obsidian/vault
```

**Page ID 찾기**: Notion 페이지 URL에서 마지막 32자
`https://notion.so/My-Page-abc123def456...` → `abc123def456...`

## 4단계: 동기화 실행

### 기본 모드
```bash
node sync-to-obsidian.mjs
```

### 구조화 모드 (권장)
```bash
node structured-sync.mjs
```

구조화 모드는 Notion DB의 속성을 frontmatter로 변환합니다:
- `Tags` 속성 → `tags: [tag1, tag2]`
- `Type` 속성 → `type: note`
- DB 이름 → vault 폴더 자동 결정

## 5단계: 인덱싱

동기화 후 반드시 인덱싱:
```bash
stellavault index /path/to/vault
```

## 자동 동기화 (선택)

### cron 설정 (Linux/Mac)
```bash
# 매 시간 동기화
0 * * * * cd /path/to/packages/sync && node structured-sync.mjs >> /tmp/sv-sync.log 2>&1
```

### Task Scheduler (Windows)
`node setup-scheduler.mjs` 실행

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| "NOTION_API_KEY 필요" | .env 파일 확인 |
| "페이지를 찾을 수 없음" | Integration이 페이지에 연결됐는지 확인 |
| "DB 없음" | 루트 페이지 하위에 Database가 있어야 구조화 모드 작동 |
| frontmatter 누락 | Notion DB에 Tags/Type 속성 추가 |
