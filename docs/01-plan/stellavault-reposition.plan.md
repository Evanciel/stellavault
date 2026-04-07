# Plan: stellavault-reposition — 전문가 평가 기반 5대 수정

## 작업 순서

### Task 1: 폴더 구조 설정 가능 (21 hardcoded refs → config-driven)
- config.ts에 `folders` 필드 추가
- ingest-pipeline.ts folderMap을 config에서 읽도록 변경
- CLI 명령들(compile, fleeting, autopilot)에서 config 참조
- 기본값은 현행 유지 (raw, _literature, _permanent, _wiki)

### Task 2: 다국어 임베딩 모델 교체
- config.ts 기본값: all-MiniLM-L6-v2 → paraphrase-multilingual-MiniLM-L12-v2
- 둘 다 384차원 → DB 스키마 변경 불필요
- local-embedder.ts 차원 감지 이미 MiniLM 자동 처리

### Task 3: Express — stellavault draft 명령
- wiki-compiler의 CompileResult(articles + concepts) 활용
- 지정 토픽/태그 기반 초안 생성 (rule-based)
- 출력: 블로그/보고서 형태 .md

### Task 4: 리포지셔닝
- package.json description 업데이트
- README.md 리라이트 (핵심 메시지: 자가 컴파일 + MCP)

### Task 5: .npmignore
- PDF, 이미지, docs/ 제외
