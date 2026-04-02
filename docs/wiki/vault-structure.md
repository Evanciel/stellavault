# Stellavault — 권장 Vault 구조 가이드

## 왜 구조가 중요한가

Stellavault는 임베딩 기반 시맨틱 검색이라 폴더 구조에 의존하지 않습니다.
하지만 잘 정리된 vault는:
- 검색 품질 향상 (명확한 태그 → 정확한 클러스터링)
- Federation에서 태그 체계 일관성
- Notion 자동 동기화 시 폴더 매핑 용이

## 권장 폴더 구조

```
vault/
├── 01_Knowledge/       정리된 지식 노트 (핵심)
│   ├── programming/
│   ├── devops/
│   └── architecture/
├── 02_Projects/        프로젝트별 메모
│   ├── project-a/
│   └── meetings/
├── 03_Daily/           일일 노트 (날짜별)
├── 04_Resources/       외부 자료 (clip, research)
│   └── clips/          sv clip으로 저장된 파일
├── 05_Templates/       템플릿 (인덱싱 제외 권장)
└── 06_Archive/         아카이브 (인덱싱 제외 권장)
```

## Notion DB 매핑

Structured Sync (`node structured-sync.mjs`) 사용 시 Notion DB 이름이 vault 폴더를 결정합니다:

| Notion DB 이름 | → Vault 폴더 |
|---------------|-------------|
| Projects | 02_Projects/ |
| Research | 04_Resources/ |
| Meeting Notes | 02_Projects/meetings/ |
| Daily Journal | 03_Daily/ |
| Knowledge | 01_Knowledge/ |
| Resources | 04_Resources/ |
| (기타) | 01_Knowledge/{DB이름}/ |

## Frontmatter 표준

모든 노트에 아래 frontmatter를 권장합니다:

```yaml
---
title: "노트 제목"
source: local          # local | notion | clip | bridge
type: note             # note | clip | sync | bridge | decision
tags: [tag1, tag2]     # 검색 + 클러스터링에 활용
created: 2026-04-02
---
```

### source 값 설명
- `local` — Obsidian에서 직접 작성
- `notion` — Notion에서 동기화
- `clip` — `sv clip`으로 웹에서 클리핑
- `bridge` — 갭 탐지기가 자동 생성한 브릿지 노트

### type 값 설명
- `note` — 일반 지식 노트
- `clip` — 웹/YouTube 클리핑
- `sync` — Notion 동기화 노트
- `bridge` — 지식 갭 브릿지
- `decision` — 기술 결정 기록

## 태그 체계 가이드

### 계층형 태그 (권장)
```
#programming/javascript
#programming/typescript
#devops/kubernetes
#devops/docker
```

### Federation에서의 태그
Federation 네트워크에서 태그는 "이 노드가 어떤 분야에 강한지" 판단하는 기준입니다.
일관된 태그 체계 → 더 정확한 지식 라우팅.

**Notion 템플릿을 팀원과 공유하면 태그 체계가 자동으로 통일됩니다.**

## 인덱싱 제외

`.stellavault.json`에서 제외할 폴더를 지정할 수 있습니다:

```json
{
  "vaultPath": "/path/to/vault",
  "excludeFolders": ["05_Templates", "06_Archive", ".obsidian"]
}
```

## Quick Start

```bash
# 1. vault 구조 생성 (자동)
stellavault init

# 2. Notion에서 구조화 동기화
cd packages/sync && node structured-sync.mjs

# 3. 인덱싱
stellavault index /path/to/vault

# 4. 확인
stellavault status
```
