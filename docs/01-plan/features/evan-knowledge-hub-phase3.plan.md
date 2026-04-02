# Evan Knowledge Hub Phase 3 — Knowledge Pack

> **Summary**: 지식을 표준 패키지로 내보내고 가져와서 에이전트/팀원 간 경험을 이식하는 포맷
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 개인 지식이 로컬 벡터 DB에 갇혀있어 팀원/에이전트 간 경험 공유 불가. 다른 환경에서 지식 재활용 불가능 |
| **Solution** | .ekh-pack 표준 포맷으로 지식 청크를 패키징. CLI `ekh pack create/export/import`로 생성·공유·병합. PII 자동 마스킹 |
| **Function/UX** | `ekh pack create "react-patterns" --from-search "React"` → 파일 생성 → Git/USB로 공유 → 상대방 `ekh pack import` → 즉시 검색 가능 |
| **Core Value** | "경험의 이식" — senior의 10년 경험을 junior의 MCP에 로딩. 마켓플레이스 없이 파일 기반으로 자유롭게 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 지식이 로컬에 갇혀 팀/에이전트 간 공유 불가 |
| **WHO** | 팀 개발자, 오픈소스 커뮤니티, 도메인 전문가 |
| **RISK** | PII 유출 (이름/이메일/API키), 임베딩 모델 불일치, 대용량 팩 |
| **SUCCESS** | pack create <10초, import 후 검색 정확도 유지, PII 0건 |
| **SCOPE** | .ekh-pack 포맷 + CLI 5명령 + PII 마스킹. 마켓플레이스는 범위 밖 |

---

## 1. Scope

### 1.1 In Scope

| ID | Feature | Priority |
|----|---------|:--------:|
| F21-1 | `.ekh-pack.json` 표준 포맷 정의 | P0 |
| F21-2 | `ekh pack create <name>` — 검색/클러스터 기반 팩 생성 | P0 |
| F21-3 | `ekh pack export <name> -o <path>` — 파일로 내보내기 | P0 |
| F21-4 | `ekh pack import <path>` — 파일에서 가져오기 → 벡터 DB 병합 | P0 |
| F21-5 | `ekh pack list` — 설치된 팩 목록 | P0 |
| F21-6 | `ekh pack info <name>` — 팩 상세 정보 | P1 |
| F21-7 | PII 자동 마스킹 (이름/이메일/URL/API키) | P0 |
| F21-8 | 라이선스 명시 필수 | P0 |

### 1.2 Out of Scope

- 마켓플레이스 / 온라인 팩 레지스트리
- 임베딩 벡터만 공유 (원문 없이) — Phase 3.5
- 암호화 동기화

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|:--------:|
| FR-01 | `ekh pack create <name> --from-search <query>` — 검색 결과에서 팩 생성 | P0 |
| FR-02 | `ekh pack create <name> --from-cluster <id>` — 클러스터에서 팩 생성 | P0 |
| FR-03 | 팩에 청크 content + embedding + metadata 포함 | P0 |
| FR-04 | PII 감지 (regex: 이메일, URL, API키 패턴) → `[REDACTED]`로 마스킹 | P0 |
| FR-05 | `ekh pack export` → .ekh-pack 파일 생성 (JSON) | P0 |
| FR-06 | `ekh pack import` → 팩 청크를 벡터 DB에 병합 (pack_ prefix) | P0 |
| FR-07 | 임베딩 모델 불일치 감지 → 경고 + 재임베딩 옵션 | P1 |
| FR-08 | `ekh pack list` — ~/.ekh/packs/ 디렉토리 스캔 | P0 |
| FR-09 | 라이선스 필드 필수 (MIT, CC-BY 등) | P0 |

### 2.2 Non-Functional Requirements

| Category | Criteria | Target |
|----------|----------|--------|
| Performance | 100 청크 팩 생성 | < 10초 |
| Security | PII 마스킹 정확도 | > 95% |
| Compatibility | 다른 ekh 인스턴스에서 import | 100% |
| Size | 1000 청크 팩 | < 10MB |

---

## 3. Success Criteria

| ID | Criteria |
|----|----------|
| SC-01 | `ekh pack create` → .ekh-pack 파일 생성 <10초 |
| SC-02 | `ekh pack import` 후 검색 결과에 팩 청크 포함 |
| SC-03 | PII 마스킹: 이메일/API키 0건 노출 |
| SC-04 | 임베딩 모델 불일치 시 경고 표시 |
| SC-05 | `ekh pack list` 설치된 팩 목록 정상 표시 |

---

## 4. Architecture

```
packages/core/src/
├── pack/                    [NEW]
│   ├── types.ts             KnowledgePack, PackChunk 타입
│   ├── creator.ts           검색/클러스터 → 팩 생성
│   ├── exporter.ts          팩 → .ekh-pack 파일
│   ├── importer.ts          .ekh-pack → 벡터 DB 병합
│   ├── pii-masker.ts        PII 감지 + 마스킹
│   └── index.ts             barrel export

packages/cli/src/commands/
│   └── pack-cmd.ts          ekh pack create/export/import/list/info
```

---

## 5. Implementation Roadmap

| Module | Scope Key | Description | Effort |
|--------|-----------|-------------|:------:|
| 팩 타입 + PII 마스커 | `module-1` | types.ts + pii-masker.ts | Small |
| 팩 생성 + 내보내기 | `module-2` | creator.ts + exporter.ts | Medium |
| 팩 가져오기 + 병합 | `module-3` | importer.ts + DB 병합 | Medium |
| CLI 명령어 + 테스트 | `module-4` | pack-cmd.ts + 5개 테스트 | Medium |

### Session Plan

| Session | Scope | 내용 |
|---------|-------|------|
| **Session 1** | `module-1,module-2` | 타입 + PII + 생성 + 내보내기 |
| **Session 2** | `module-3,module-4` | 가져오기 + CLI + 테스트 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial Phase 3 Plan | Evan (KHS) |
