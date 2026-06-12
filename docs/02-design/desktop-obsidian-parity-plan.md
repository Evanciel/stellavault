# Stellavault Desktop — Obsidian Parity Upgrade Plan

> 작성: 2026-06-12 · 대상: `packages/desktop` (Electron + React + TipTap v2 + Zustand)
> 근거: 렌더러/IPC/core 인벤토리 분석 + Obsidian 코어 기능 리서치 (help.obsidian.md, obsidianstats.com)
> 전략: Obsidian의 "매일 쓰는 루프"(switcher → capture → link → review)를 따라잡되,
> **@stellavault/core의 미사용 AI 능력(askVault·FSRS decay·gaps·learning path·related)로 차별화**한다.
> Obsidian이 플러그인으로 때우는 영역(Omnisearch=시맨틱 검색, 리뷰 루프)이 우리는 코어에 이미 있다.

---

## 0. 전제: 출하 차단 결함 (Wave 1 이전에 반드시 수정)

| # | 결함 | 위치 | 왜 차단인가 |
|---|------|------|-------------|
| B1 | **Markdown↔HTML 직렬화 부재** — TipTap이 `getHTML()`을 `.md`에 그대로 저장, 읽을 때는 raw markdown을 HTML로 파싱 | `MarkdownEditor.tsx:65`, `EditorArea.tsx:21-25` | 실제 마크다운 노트를 열면 평문으로 깨지고, 저장하면 `.md` 파일이 HTML로 **오염**됨. "로컬 마크다운 신뢰성"은 이 카테고리의 존재 이유 — 이게 없으면 다른 모든 기능이 무의미 |
| B2 | **3D 그래프 항상 빈 화면** — `core.buildGraphData`가 core index.ts에서 미export → `undefined` 호출 → catch → `{nodes:[],edges:[]}` | `core/src/index.ts`, `main/index.ts:261-266` | 한 줄 export 수정. 단, export해도 데이터 shape 불일치(B3)로 크래시 |
| B3 | **GraphPanel 데이터 shape 불일치** — core는 `{label, clusterId, position: undefined}`, 패널은 `{title, cluster, position:[x,y,z]}` 기대 → `position[0]` TypeError | `GraphPanel.tsx:11-17,44` | B2 수정 직후 터지는 후속 크래시 |
| B4 | `prompt()`/`alert()` 잔존 — Electron 메인 스레드 freeze | `CommandPalette.tsx:33,50`, `MarkdownEditor.tsx:191`, `SlashCommands.ts:61` | 이미 `PromptModal`이 있음 — 교체만 하면 됨 |
| B5 | 미저장 변경 가드 없음 (탭 닫기/창 닫기 시 데이터 유실) | `app-store.ts`, `main/index.ts` | 노트 앱의 신뢰 기본기 |

### B1 해법 (아키텍처 결정 → §4-A 참조)
- 채택: **직렬화 레이어** — 읽기: `marked` 또는 `markdown-it`로 md→HTML 후 `setContent`; 쓰기: TipTap JSON→markdown 직렬화.
- 추천 라이브러리: `tiptap-markdown` (TipTap v2 호환, StarterKit+table+tasklist 직렬화 지원) — 자체 serializer 작성 대비 ~90% 절약.
- 신규 파일: `renderer/lib/markdown.ts` (`mdToEditor(md): content`, `editorToMd(editor): string`).
- 수정: `MarkdownEditor.tsx` (onUpdate → `editorToMd`), `EditorArea.tsx` (open 시 `mdToEditor`), `app-store.ts` (tab.content는 항상 markdown 원문 유지).
- 위험: frontmatter는 직렬화 전에 분리 보관(§W1-7 Properties와 연동) — TipTap에 YAML을 넣으면 깨짐. 라운드트립 골든 테스트(`tests/md-roundtrip.test.ts`: 헤딩/표/태스크/코드블록/위키링크 보존) 필수.

---

## 1. Gap Matrix: Obsidian 코어 기능 vs Stellavault Desktop 현황

상태: ✅ 있음 · 🟡 부분 · ❌ 없음 · 💎 = core에 엔진 존재(배선만 필요)

### 에디터
| Obsidian 기능 | 상태 | 비고 |
|---|---|---|
| Live Preview 편집 | 🟡 | TipTap WYSIWYG는 있으나 md 라운드트립 깨짐(B1) |
| Reading view / Source mode | ❌ | 모드 토글 없음 |
| Slash commands | 🟡 | 12개, Callout 가짜(blockquote+이모지), 이미지 `prompt()` |
| 위키링크 자동완성 | 🟡 | `[[` 트리거 OK, 단 평문 삽입 — **클릭 불가** |
| `[[Note#Heading]]` / `[[Note|alias]]` / 블록참조 | ❌ | |
| 임베드/transclusion `![[ ]]` | ❌ | |
| 수식 (KaTeX) | 🟡 | 소스 텍스트 미숨김, CSS가 CDN(오프라인 깨짐) |
| 첨부 드래그드롭 | 🟡 | 이미지가 base64로 문서에 인라인(볼트 첨부 아님) |

### 링크/그래프
| 기능 | 상태 | 비고 |
|---|---|---|
| 백링크 패널 | 🟡 | 동작하나 매 호출 전체 볼트 brute-force 스캔, 캐시 없음 |
| Unlinked mentions | ❌ | Wave 2 |
| Outgoing links 패널 | ❌ | |
| 이름변경 시 링크 자동 갱신 | ❌ | rename IPC는 있으나 링크 갱신 없음 |
| 글로벌 그래프 | ❌(사실상) | B2/B3로 항상 빈 캔버스 + 렌더링 품질 결함 다수 |
| 로컬 그래프(깊이 슬라이더) | ❌ | |
| 그래프 필터/그룹/포스 | ❌ | |

### 검색/내비게이션
| 기능 | 상태 | 비고 |
|---|---|---|
| 전문 검색 패널(연산자/regex) | ❌ | AI Panel의 시맨틱 검색만 존재 💎(hybrid search가 더 강력 — UI만 없음) |
| 커맨드 팔레트 | 🟡 | 8개 하드코딩, `prompt()/alert()` 사용, 단축키 표시만 |
| 퀵 스위처(fuzzy, open-or-create) | 🟡 | substring만, 제목 충돌 버그, create-on-miss 없음 |
| 탭 (재정렬/히스토리/세션복원) | 🟡 | 기본만 — 드래그/휠클릭닫기/Ctrl+Tab/복원 없음 |
| 분할 뷰 | 🟡 | 2-pane 동작, 같은 파일 동시편집 비동기화, Ctrl+S 범위 버그 |
| 워크스페이스 저장 | ❌ | |

### 사이드바/메타데이터
| 기능 | 상태 | 비고 |
|---|---|---|
| 파일 탐색기 (rename/move/delete/폴더생성/컨텍스트메뉴/DnD) | 🟡 | 읽기 전용 트리. **IPC는 전부 존재**(`vault:rename/delete/create-folder`) — UI만 없음 |
| Outline 패널 | ❌ | |
| Tags 패널 | ❌ | 💎 core가 태그를 이미 인덱싱(SearchResult.tags) |
| 북마크 | ❌ | |
| Properties/frontmatter UI | ❌ | |
| Bases (DB 뷰) | ❌ | Wave 2 (Dataview-lite) |

### 자동화/외관/볼트
| 기능 | 상태 | 비고 |
|---|---|---|
| 템플릿 (`{{date}}` 변수) | ❌ | |
| 데일리 노트 + 캘린더 | ❌ | 리테션 1순위 습관 루프 |
| 설정 UI | ❌ | 설정 화면 자체가 없음. 영속화도 없음(테마/탭/레이아웃 매번 초기화) |
| 테마/액센트 | 🟡 | dark/light CSS 변수 존재, 일부 하드코딩 hex, 영속 안 됨 |
| 단축키 재바인딩 | ❌ | 전역 핸들러조차 없음(Ctrl+B/T 표시만) |
| 볼트 스위처 | ❌ | `~/.stellavault.json` 수동 편집 + 재시작 필요 |
| 파일 복구/휴지통 | ❌ | `vault:delete`가 영구삭제(rmSync) |
| 파일 와처(외부 변경 감지) | ❌ | `file:changed` 이벤트 선언만, 발송 없음 💎(core `createWatcher` 존재) |

### Stellavault 고유 (Obsidian에 없음 — 차별화 자산)
| 기능 | 상태 | 비고 |
|---|---|---|
| 시맨틱 하이브리드 검색 (4-signal RRF) | 🟡 | 엔진 ✅, UI는 AI패널 한 탭. config(`search.weights`/`entityAliases`) 미전달 |
| FSRS 감쇠/리뷰 | 🟡 | Daily Brief top-5 표시만. **`recordAccess` 미호출 → 루프 죽어있음** 💎 |
| Ask your vault (`askVault`, 인용 포함 Q&A) | ❌ | 💎 플래그십 MCP 툴, 데스크톱 UI 전무 — 최고가치 배선 |
| Knowledge gaps / Learning path | ❌ | 💎 `detectKnowledgeGaps`(캐시 있음), `generateLearningPath` 미사용 |
| Related notes (시맨틱) | ❌ | 💎 `getRelated` — 문자열매칭 백링크보다 우월 |
| Draft 생성 | 🟡 | main에서 약하게 재구현 — core `draft-generator` 미사용 |

---

## 2. 로드맵 (3 Waves)

### Wave 0 — 출하 차단 수정 (선행, ~3일)
§0의 B1~B5. 특히 B1(md 라운드트립)은 Wave 1 전체의 전제.

### Wave 1 — "Table Stakes + AI 차별화" (이번 릴리스, ~4–6주, ~4–5k LOC)
원칙: 기존 아키텍처(단일 Zustand store, 인라인 스타일, 19 IPC 채널) 위에 증분 — 리라우팅/리스타일링 금지.

| # | 항목 | 크기 | 비고 |
|---|------|------|------|
| W1-1 | 설정 시스템 + 설정 UI (테마/에디터/단축키/볼트) | L | 다른 항목의 기반 — 첫 번째로 |
| W1-2 | 외관: light/dark/accent + 하드코딩 hex 제거 + 영속화 | S | W1-1 위에 |
| W1-3 | 파일 작업: 컨텍스트 메뉴(rename/delete/move/new folder/duplicate) + 휴지통 | M | IPC 대부분 존재 |
| W1-4 | 전문 검색 패널 (core hybrid search UI + `tag:`/`path:` 연산자) | M | 💎 Obsidian보다 좋게 만들 수 있는 지점 |
| W1-5 | Outline 패널 | S | |
| W1-6 | Tags 패널 + 태그 클릭→검색 | S | 💎 |
| W1-7 | Frontmatter/Properties 에디터 | M | B1과 강결합 |
| W1-8 | 3D 그래프 수리 + 로컬 그래프 모드 | M | B2/B3 후속 렌더 품질 |
| W1-9 | 위키링크 클릭 내비게이션 + rename 시 링크 갱신 | M | |
| W1-10 | 템플릿 + 데일리 노트(+미니 캘린더) | M | 리텐션 루프 |
| W1-11 | 북마크 패널 | S | |
| W1-12 | 단축키 시스템(전역 등록 + 재바인딩) + 커맨드 레지스트리 | M | 팔레트/스위처 업그레이드 포함 |
| W1-13 | 💎 **Ask 패널** (askVault 배선) | S | 차별화 1순위, 순수 배선 |
| W1-14 | 💎 **FSRS 루프 닫기** (recordAccess on open) + Memory 탭 stub → 리뷰 큐 | S–M | "coming in v0.2" 해소 |
| W1-15 | 💎 파일 와처 (`createWatcher` + chokidar) → 자동 재인덱스 + `file:changed` 발송 | S | 인덱스 stale 해결 |
| W1-16 | 💎 Related notes (getRelated) — 백링크 패널에 탭 추가 | S | |
| W1-17 | 탭/스플릿 다듬기: 미저장 가드, 세션 복원, Ctrl+Tab, 동일파일 동기화 또는 차단 | M | |

> 명시 요청 항목 중 "split view(최소 2-pane)"는 **이미 존재** → W1-17의 버그픽스/다듬기로 흡수.

### Wave 2 — 파워 유저 (다음 릴리스)
- **Dataview-lite**: frontmatter 기반 필터/테이블 뷰(쿼리 블록은 후속) — core store의 SQLite 위에 구현
- **Unlinked mentions**: 백링크 인덱스 구축(brute-force 스캔 → SQLite 링크 테이블)과 함께
- **Embeds/transclusion** `![[ ]]` + `[[Note#Heading]]`
- **Canvas-lite**: JSON Canvas 스펙(.canvas) 읽기/쓰기, react-flow 기반
- **Export/Publish**: HTML/PDF export(`shell` 채널 추가), core `export` 재사용
- **멀티 볼트 스위처**: `vault:switch` IPC + 재초기화 (config 재구조화 필요 — §4-B 선반영)
- 💎 Knowledge gaps 패널 본편 + Learning path + 품질 린트(detectDuplicates/Contradictions)

### Wave 3 — 플랫폼
- 플러그인 API (커맨드 레지스트리 W1-12가 토대), 워크스페이스 저장, 시스템 트레이/글로벌 캡처 핫키, 자동 업데이트, Slides/Web viewer류는 비목표.

---

## 3. Wave 1 상세 (파일·IPC·데이터 흐름·위험)

경로 약칭: `R/` = `packages/desktop/src/renderer/`, `M/` = `packages/desktop/src/main/`, `S/` = `packages/desktop/src/shared/`.

### W1-1 설정 시스템 + 설정 UI
- **신규**: `M/settings-store.ts` (JSON 파일 `~/.stellavault/desktop-settings.json`, schema+기본값+마이그레이션; electron-store 미도입 — §4-B), `R/components/settings/SettingsModal.tsx` (탭: General·Editor·Appearance·Hotkeys·Vault·About), `R/stores/settings-store.ts` (Zustand 슬라이스, IPC 동기화)
- **수정**: `M/index.ts` (핸들러 등록), `S/ipc-types.ts`, `preload/index.ts` (allowlist), `App.tsx` (모달 마운트 + 부팅 시 settings load)
- **IPC 추가**: `settings:get` (— → AppSettings), `settings:set` (Partial<AppSettings> → AppSettings), 이벤트 `settings:changed`
- **데이터 흐름**: 부팅 → `settings:get` → Zustand hydrate → UI 변경 → `settings:set` → main이 파일 atomic write(write tmp + rename) → `settings:changed` 브로드캐스트(멀티윈도 대비)
- **포함 설정**: theme/accent, 폰트크기/줄너비/spellcheck, 단축키 맵, vaultPath(읽기전용 표시 + "Change vault…" → 재시작 안내), sidebar/panel width, 데일리노트 폴더·템플릿 경로
- **위험**: 기존 `~/.stellavault.json`(vaultPath/dbPath)과 이원화 — 데스크톱 설정은 별파일로 분리하고 vaultPath는 기존 파일 source-of-truth 유지(충돌 회피). 윈도 bounds 영속도 여기 편승(`M/index.ts` createWindow).

### W1-2 외관 (light/dark/accent)
- **수정**: `R/styles/theme.css` (accent를 `--accent` 변수화, light 보강), `SlashCommands.ts:84-90`·`GraphPanel.tsx:189` 등 하드코딩 hex → CSS 변수 참조, `App.tsx:50` (`data-theme`을 settings에서)
- **흐름**: settings.theme → `data-theme` attr + `--accent` inline var. 시스템 테마 추종 옵션(`nativeTheme` → 이벤트).
- **위험**: raw-DOM 팝업(SlashCommands/Wikilink)은 React 밖 — `cssText` 대신 클래스 부여로 전환해야 테마 반응. 작은 리팩터.

### W1-3 파일 작업 + 휴지통
- **신규**: `R/components/sidebar/ContextMenu.tsx` (재사용 가능한 우클릭 메뉴), `R/components/sidebar/file-ops.ts` (rename/move/delete/duplicate 오케스트레이션 — 열린 탭 경로 갱신 포함)
- **수정**: `FileTree.tsx` (onContextMenu, 인라인 rename input, 폴더에 "New note/folder"), `Sidebar.tsx`, `app-store.ts` (`renameTabPath(old,new)` 액션), `M/index.ts`
- **IPC 추가**: `vault:trash` (filePath → void, `shell.trashItem` 사용 — 기존 `vault:delete`는 유지하되 UI는 trash만 호출), `vault:duplicate` (filePath → newPath), `vault:exists` (path → boolean)
- **수정 IPC**: `vault:create-file`에 exists-check 추가(덮어쓰기 방지 — 현재 silent clobber)
- **흐름**: 우클릭 → ContextMenu → 액션 → IPC → `vault:read-tree` 리프레시 → 열린 탭 경로/제목 동기화 → (W1-9) 링크 갱신 트리거
- **위험**: rename 중 해당 파일이 dirty 탭이면 — 저장 먼저 강제 또는 차단. `ConfirmModal`/`danger` variant 드디어 사용처 생김.

### W1-4 전문 검색 패널
- **신규**: `R/components/panels/SearchPanel.tsx` (입력 + 모드 토글 [Hybrid|Keyword] + 결과 리스트(스니펫 하이라이트, 파일별 그룹) + 정렬)
- **수정**: `App.tsx` (4번째 우측 패널 + Ctrl+Shift+F), `TitleBar.tsx` (토글 아이콘), `M/index.ts`
- **IPC 추가**: `search:query` (query, opts {mode, tags?, pathPrefix?, limit} → SearchResult[] + matchRanges)
- **흐름**: 쿼리 파싱(렌더러에서 `tag:x path:y` 토큰 추출) → core hybrid search(💎 `signalWeights`/`tags` 인자 드디어 전달) → 결과 클릭 → 탭 열기 + (가능하면) 첫 매치로 스크롤
- **차별화**: 기본이 시맨틱+BM25 — Omnisearch(1.6M 다운로드)가 증명한 "Obsidian 검색 불만"을 네이티브로 해소. UI에 "semantic match" 배지로 어필.
- **위험**: main이 core config를 하드코딩 중 — `loadConfig()` 경유로 교체(한 곳 수정, `M/index.ts:39-72`)해 사용자 `search.weights`가 데스크톱에도 적용되게.

### W1-5 Outline 패널
- **신규**: `R/components/panels/OutlinePanel.tsx`
- **수정**: `App.tsx`, `TitleBar.tsx`
- **IPC**: 불필요 — 활성 탭의 markdown content(store에 있음)에서 헤딩 정규식 파싱, 클릭 시 TipTap 헤딩 위치로 scroll (editor 인스턴스 ref를 store 또는 context로 노출: `app-store.ts`에 `activeEditorRef` 추가)
- **위험**: 에디터 ref 공유는 split view에서 활성 pane 추적 필요 — `EditorArea`가 focus된 pane을 store에 기록.

### W1-6 Tags 패널
- **신규**: `R/components/panels/TagsPanel.tsx` (태그+카운트, 중첩 `a/b` 트리, 클릭→SearchPanel에 `tag:x` 주입)
- **IPC 추가**: `tags:list` (— → {tag, count}[]) — core store SQLite의 태그 컬럼 집계 쿼리(💎 인덱스에 이미 존재, main에서 ~20줄)
- **위험**: 인덱스 기준이라 미인덱스 신규 노트의 태그 누락 — W1-15(와처 자동 재인덱스)가 해소.

### W1-7 Frontmatter/Properties 에디터
- **신규**: `R/components/editor/PropertiesEditor.tsx` (에디터 상단 접이식 key-value 그리드; text/list/number/checkbox/date 타입 추론), `R/lib/frontmatter.ts` (`gray-matter` 래핑: parse/stringify)
- **수정**: `EditorArea.tsx` (open 시 frontmatter 분리 → PropertiesEditor에 전달, save 시 재결합), `app-store.ts` (`OpenTab`에 `frontmatter: Record<string,unknown>` 추가)
- **IPC**: 불필요
- **흐름**: `vault:read-file` → gray-matter parse → {frontmatter, body} → body만 TipTap, frontmatter는 그리드 → Ctrl+S 시 `matter.stringify(editorToMd(), frontmatter)`
- **위험**: B1 직렬화와 한 몸 — **B1 머지 후 착수**. YAML 보존성(주석/순서)은 gray-matter 한계 — 키 순서 유지만 보장, 주석 유실은 알려진 제약으로 문서화.

### W1-8 3D 그래프 수리 + 로컬 그래프
- **수정**: `core/src/index.ts` (한 줄: `buildGraphData` export — B2), `R/components/panels/GraphPanel.tsx` 전면 보수:
  1. IPC 결과 매핑(label→title, clusterId→cluster, position 없으면 `hash(id)` 시드 결정적 배치 — 재오픈 시 레이아웃 안정)
  2. `pointsMaterial` → 원형 스프라이트 ShaderMaterial(per-vertex size 동작, hover 확대 실제 반영) 또는 InstancedMesh(8k 노드까지 OK)
  3. hover 시 buffer 재할당 제거(useMemo deps에서 hovered 제외, uniform/instance attr만 갱신)
  4. 엣지 opacity 0.12→0.35 + accent 색
  5. 자동회전 → idle 5초 후에만 + 감속
  6. drei `<Text>` 호버 라벨 → HTML 오버레이 div (troika worker/CDN 폰트 CSP 문제 제거)
  7. `<GraphScene>` ErrorBoundary 래핑
  8. **로컬 그래프 모드**: 토글 [Global|Local] + 깊이 슬라이더(1–3) — 활성 노트 기준 BFS 필터(렌더러에서 edges로 계산, IPC 변경 불필요), zoom-to-fit 버튼
- **package.json**: `three` `^0.175.0` → `^0.170.0` (중복 three 제거)
- **위험**: 8k+ 문서 볼트 성능 — 글로벌 모드에 노드 수 상한+"top-N by degree" 필터 기본값. 셰이더 작업이 미지수면 InstancedMesh 폴백.

### W1-9 위키링크 내비게이션 + rename 링크 갱신
- **신규**: `R/components/editor/WikilinkNode.ts` (TipTap inline node `wikilink` {target, alias}, 렌더: accent 클릭 가능 span, Ctrl+클릭 또는 클릭 → 탭 열기, 미존재 노트면 create-on-click)
- **수정**: `WikilinkSuggestion.ts` (평문 대신 wikilink 노드 삽입), `R/lib/markdown.ts` (직렬화: 노드 ↔ `[[target|alias]]` — tiptap-markdown 커스텀 룰), `M/index.ts`
- **IPC 추가**: `vault:update-links` (oldTitle, newTitle → changedCount) — main에서 볼트 워크 + `[[old…]]` 치환(정규식: `[[old]]`, `[[old|`, `[[old#`)
- **흐름**: W1-3 rename → 확인 다이얼로그 "N개 링크 갱신?" → `vault:update-links` → 열린 탭 중 변경 파일 reload
- **위험**: 치환 안전성(코드블록 내 `[[ ]]` 오치환) — 라인 기반 + 코드펜스 상태 추적. 백링크 인덱스화는 Wave 2로 미루고 현 brute-force 유지(이 채널도 같은 워커 공유).

### W1-10 템플릿 + 데일리 노트
- **신규**: `R/lib/templates.ts` (`{{title}} {{date:FMT}} {{time}}` 치환), `R/components/sidebar/CalendarWidget.tsx` (월 그리드, 노트 존재 도트, 클릭→데일리 열기/생성), `M/index.ts`에 템플릿 폴더 읽기
- **수정**: `Sidebar.tsx` (캘린더 접이식 섹션), 커맨드 레지스트리(W1-12)에 "Open today's daily note" + 단축키, settings(폴더/포맷/템플릿 경로)
- **IPC 추가**: `vault:list-files` (dirPath, ext? → string[]) — 템플릿 열거 + 캘린더 도트용 (기존 list-notes는 제목만이라 부족)
- **흐름**: Ctrl+D(가칭) → `Daily/{{date:YYYY-MM-DD}}.md` 존재확인(`vault:exists`) → 없으면 템플릿 적용 생성 → 탭 열기
- **위험**: 낮음. 날짜 포맷은 `dayjs` 1개 의존 추가(이미 transitively 있을 가능성 — 확인 후).

### W1-11 북마크
- **신규**: `R/components/sidebar/BookmarksSection.tsx` (Sidebar 내 섹션 — 우측 패널 아님)
- **저장**: settings 파일 내 `bookmarks: {type:'note'|'search', path|query, label}[]` (W1-1 재사용, 신규 IPC 불필요)
- **수정**: ContextMenu(W1-3)에 "Bookmark", SearchPanel에 "Save search", `Sidebar.tsx`
- **위험**: 없음. 헤딩/블록 북마크는 비목표(Wave 2).

### W1-12 단축키 시스템 + 커맨드 레지스트리
- **신규**: `R/lib/commands.ts` (커맨드 레지스트리: `{id, title, run, defaultKeys}` — **Wave 3 플러그인 API의 토대**), `R/lib/hotkeys.ts` (window keydown 단일 리스너, settings의 키맵 적용, 입력 필드 가드)
- **수정**: `CommandPalette.tsx` (하드코딩 8개 → 레지스트리 전체 + fuzzy + `prompt/alert` 제거), `QuickSwitcher.tsx` (fuzzy 매칭(uFuzzy 또는 자체 subsequence), **경로 표시로 제목충돌 해소**, **미일치 시 Shift+Enter create-on-miss**), `EditorArea.tsx` (Ctrl+S를 전역 핸들러로 이관 — 활성 pane의 탭 저장), SettingsModal Hotkeys 탭(재바인딩 + 충돌 감지)
- **라이브러리 결정**: §4-C — 외부 lib 없이 자체 ~150줄 (mousetrap류는 유지보수 정체)
- **위험**: TipTap 내부 단축키(Ctrl+B 등)와 전역 핸들러 충돌 — 에디터 focus 시 에디터 우선, 레지스트리는 비편집 커맨드 위주.

### W1-13 💎 Ask 패널 (차별화 플래그십)
- **수정**: `R/components/panels/AIPanel.tsx` (Search 탭 위에 "Ask" 탭 — 질문 입력 → 답변 + 인용 노트 리스트(클릭→열기)), `M/index.ts`
- **IPC 추가**: `core:ask` (question → {answer, citations: {filePath,title,snippet}[]})
- **흐름**: core `askVault` 직호출 — **순수 배선, 알고리즘 0**
- **위험**: 응답 지연(임베딩 검색+합성) — 스트리밍 없으면 로딩 스켈레톤 + AbortController. core ask가 LLM 의존이면 로컬-only 경로 확인 필요(아닐 시 "출처 패키지" 형태로 폴백).

### W1-14 💎 FSRS 루프 닫기 + 리뷰 큐
- **수정**: `M/index.ts` (탭 활성화 시 `decayEngine.recordAccess(docId)` 호출 채널, 부팅 시 `initializeNewDocuments`+`computeAll` 스케줄), `AIPanel.tsx` Memory 탭 ("coming in v0.2" stub → 리뷰 큐: 감쇠순 리스트 + "Reviewed" 버튼=recordAccess + retrievability 게이지), `DailyBrief.tsx` (Review 항목 클릭 시에도 기록)
- **IPC 추가**: `core:record-access` (filePath → void), `core:decay-list` (limit, threshold → DecayItem[]; 기존 decay-top 일반화)
- **위험**: main의 `createMcpServer` decayEngine 미연결 이슈(메모리 노트 기지)와 별개 — 데스크톱은 `createKnowledgeHub` lazy getter 경유라 독립 동작. 노트 열람=리뷰로 칠지 정책: **열람=약한 access, 명시 Reviewed=강한 review**로 이원화(FSRS grade 파라미터 활용).

### W1-15 💎 파일 와처 + 자동 재인덱스
- **수정**: `M/index.ts` — core `createWatcher`(존재) 또는 chokidar로 볼트 watch → 디바운스 후 (a) 해당 파일 incremental index, (b) `file:changed` 이벤트 발송(이미 선언/allowlist 완료, 발송만 없음). `vault:write-file` 후에도 동일 트리거.
- **수정(렌더러)**: `App.tsx:38-43` 기존 `file:changed` 구독 활용 — 열린 탭이면서 not-dirty면 reload, dirty면 충돌 배지(외부변경 경고)
- **IPC**: 신규 없음(이벤트 기존 선언 재활용)
- **위험**: 자기 자신의 저장이 와처에 재감지되는 에코 루프 — 저장 직후 1s 무시 윈도 또는 mtime 비교. 대량 외부 sync(노션 데몬) 시 디바운스 배치 필수.

### W1-16 💎 Related notes
- **수정**: `BacklinksPanel.tsx` → 탭 2개 [Backlinks | Related], `M/index.ts`
- **IPC 추가**: `core:related` (filePath, limit → SearchResult[]) — core `getRelated` 직배선
- **위험**: 없음 수준. 미인덱스 노트는 빈 결과 — W1-15가 보완.

### W1-17 탭/스플릿 다듬기
- **수정**: `app-store.ts` (탭 세션을 settings에 영속 — 재시작 복원), `TabBar.tsx` (휠클릭 닫기, dirty 탭 닫기 시 ConfirmModal, 드래그 재정렬), `EditorArea.tsx` (동일 파일 양pane: **차단**이 1차 — "이미 다른 pane에 열림" 포커스 이동; 라이브 동기화(Y.js류)는 비목표), `M/index.ts` (close 요청 시 dirty 탭 있으면 렌더러에 확인 위임 — `window:close-request` 이벤트 + `window:confirm-close` IPC), Ctrl+Tab 사이클(W1-12 레지스트리)
- **위험**: 창닫기 인터셉트는 `e.preventDefault()` + 렌더러 왕복 — 타임아웃 폴백(3s 무응답 시 그냥 닫기) 필수.

### Wave 1 구현 순서 (의존성)
```
Wave 0 (B1~B5)
 → W1-1 설정  → W1-2 외관, W1-11 북마크, W1-17 세션복원
 → W1-12 커맨드/단축키 → 팔레트/스위처/데일리 단축키
 → W1-3 파일작업 → W1-9 링크갱신
 → B1 → W1-7 Properties, W1-9 위키링크 노드
 → W1-15 와처 → W1-6 태그 신선도, W1-16/W1-4 인덱스 신선도
 → 독립 병렬 가능: W1-4, W1-5, W1-8, W1-10, W1-13, W1-14, W1-16
```

### 신규 IPC 채널 총괄 (Wave 1: +13)
`settings:get/set`, `vault:trash`, `vault:duplicate`, `vault:exists`, `vault:list-files`, `vault:update-links`, `search:query`, `tags:list`, `core:ask`, `core:record-access`, `core:decay-list`, `core:related` (+이벤트 `settings:changed`, 기존 `file:changed` 활성화). 전부 `S/ipc-types.ts` + `preload` allowlist 동시 갱신 — 기존 패턴 그대로.

---

## 4. 아키텍처 결정 (필요 결정 사항)

### A. Markdown 직렬화 — `tiptap-markdown` 채택
- 결정: TipTap v2용 `tiptap-markdown` + 커스텀 룰(wikilink, math, callout). store의 `OpenTab.content`는 **항상 markdown 원문**(HTML 아님)으로 단일화.
- 대안 기각: (a) 자체 prosemirror-markdown serializer — 표/태스크리스트 룰 작성 비용 과다; (b) CodeMirror로 에디터 교체(Obsidian 방식) — Wave 1 범위 초과, TipTap 투자 폐기.
- 가드: 라운드트립 골든 테스트를 smoke에 편입(`tests/smoke.mjs` 게이트 활용).

### B. 설정 영속화 — 자체 JSON 스토어 (`~/.stellavault/desktop-settings.json`)
- 결정: electron-store 미도입(의존 최소, 스키마 단순). atomic write(tmp+rename), 버전 필드+마이그레이션 함수. 기존 `~/.stellavault.json`(vaultPath/dbPath)은 **건드리지 않음** — 데스크톱 UI 설정과 볼트 부트스트랩 설정의 생명주기 분리(글로벌 노하우 "서로 다른 생명주기 데이터 분리" 원칙).
- Wave 2 멀티볼트 대비: 설정에 `perVault: { [vaultPath]: {...} }` 네임스페이스 예약.

### C. 단축키 — 자체 경량 구현 + 커맨드 레지스트리
- 결정: 외부 lib(mousetrap/hotkeys-js — 유지보수 정체) 대신 ~150줄 자체: window keydown 1개, `mod+key` 정규화, settings 키맵, 충돌 감지. 모든 액션은 커맨드 레지스트리(`R/lib/commands.ts`) 경유 — 팔레트·단축키·메뉴가 같은 소스 공유, **Wave 3 플러그인 API의 공개 표면이 됨**.

### D. 검색 패널 — core hybrid search 재사용 + 렌더러측 연산자 파싱
- 결정: 새 검색엔진 만들지 않음. `tag:`/`path:` 토큰은 렌더러에서 파싱해 core 검색 opts로 전달, 본문은 hybrid(semantic+BM25+entity+recency)로. regex/`line:` 등 Obsidian 전체 연산자는 비목표(Wave 2+). main의 core 초기화를 `loadConfig()` 경유로 바꿔 사용자 `search.weights`/`entityAliases` 존중.

### E. 테마 — CSS 변수 단일 체계 유지 (Tailwind 미도입)
- 결정: 기존 `theme.css` 변수 확장(`--accent` 추가, light 보강). 인라인 스타일 95%를 한 번에 걷어내지 않음 — **신규 컴포넌트만 CSS 변수+클래스**, 기존은 하드코딩 hex 발견 시 점진 교체. raw-DOM 팝업은 클래스 기반으로 전환.

### F. 그래프 — 데스크톱 자체 GraphPanel 유지 (@stellavault/graph 미임베드)
- 결정: graph 패키지는 TipTap v3/three 0.170/Vite 독립앱 — 임베드 시 버전 충돌·HTTP 서버 의존. 데스크톱 패널을 §W1-8대로 수리. position은 `hash(id)` 결정적 시드(코어는 position을 절대 안 보냄을 계약으로 명문화 — `GraphData` 타입 주석).

### G. 삭제 — 휴지통 우선 (`shell.trashItem`)
- 결정: UI의 모든 삭제는 `vault:trash`. 영구삭제 IPC는 유지하되 UI 미노출. 자체 `.trash/` 폴더 방식 기각(OS 휴지통이 사용자 기대와 일치, 구현 0).

### H. FSRS 접근 기록 정책
- 결정: 노트 열람 = 약한 access(자동), Memory 탭 "Reviewed" = 명시 review(강한 grade). 열람만으로 retrievability가 과도 회복되는 인플레 방지.

---

## 5. 리스크 총괄 & 게이트

| 리스크 | 완화 |
|---|---|
| B1 직렬화가 기존 사용자 노트 손상 | 골든 라운드트립 테스트 + 첫 저장 전 `.bak` 백업 옵션(settings) |
| 와처 에코 루프/대량 sync 폭주 | 저장 직후 무시 윈도 + 디바운스 배치 + 인덱싱 큐 |
| 그래프 셰이더 미지수 | InstancedMesh 폴백 경로 명시 |
| IPC 13개 추가로 preload allowlist 누락 | `S/ipc-types.ts` ↔ preload allowlist 일치 검사 스크립트를 smoke에 추가 |
| Wave 1 비대화 | W1-9(링크갱신)·W1-17(드래그 재정렬)은 컷 후보 1순위 — 나머지는 독립적이라 부분 출하 가능 |

**Quality Gate**: 각 항목 머지 전 `node tests/smoke.mjs`(라운드트립·IPC allowlist 케이스 추가) + Threat Model Gate(특히 `vault:update-links`의 경로/치환 안전성, settings 파일 atomic write).
