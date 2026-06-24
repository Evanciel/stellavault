# Node Explorer — 설계 (확정 2026-06-17)

웹 옵시디언식 "풀 노드 explorer": 그래프 노드를 클릭하면 우측 패널에서 **본문 편집 + 링크 관계 탐색(백링크/아웃링크/로컬 그래프)** 을 한다. 메인 패널(그래프)은 안 뺏는다.

## 결정 (judge 평가 + 사용자)

- **A안 채택** (judge 31점 1위): 탭형 프리뷰 explorer. 격리된 preview 슬라이스라 B의 이중 버퍼/데이터 손실 위험 회피, C(매 클릭 새 탭)는 "탐색" 요청과 반대.
- **레이아웃**: 세그먼트 탭 `[읽기 · 편집 · 백링크 · 아웃링크 · 로컬그래프]` — 한 번에 하나.
- **클릭 동작**: 백링크/아웃링크/로컬그래프에서 노드 클릭 = **프리뷰 re-center**(같은 패널서 그 노트로 이동, 링크 따라 탐색). `Ctrl/⌘-클릭` = 실제 편집 탭 열기(openFile).
- **패널 폭**: 리사이즈 가능 + 기본 넓게.
- **graft** (judge 권장): B의 `useFocusedNote` 셀렉터 / 갤럭시 meta-edge를 hover 밖 독립 dim-only 레이어 / 위키링크 resolver 공유 / 포커스 시 record-access(FSRS 갱신).

## 작업 분해 (의존 순서)

1. **app-store preview 슬라이스** — `previewNote{filePath,title,content,isDirty}`, `previewSegment`, 액션 `updatePreviewContent`/`markPreviewClean`/`savePreview()`(thunk: vault:write-file→clean), `useFocusedNote()` 셀렉터(preview ?? activeTab).
2. **links-shared.tsx 추출** — BacklinksPanel에서 BacklinksList/RelatedList/NoteRow를 `{title, filePath, onOpen}` prop-driven으로 추출. BacklinksPanel은 이걸 재사용(activeTab + openFile).
3. **LocalGraph.tsx 추출** — GraphPanel의 local 모드(bfsFilter depth-N) 재사용 wrapper, `filePath` center prop. GraphPanel + preview Local 세그먼트 공유.
4. **outlinks 유틸** — preview.content에서 `[[...]]` 파싱(core extractWikilinks 렌더러 카피), title→노드 resolve(+미해결 그룹).
5. **NotePreviewPanel → 세그먼트 explorer** — 헤더(title + dirty dot + Save + "Open ↗") + 세그먼트 strip + body. Edit 세그먼트: MarkdownEditor `readOnly={false}` + onChange→updatePreviewContent + Ctrl+S→savePreview, frontmatter 재조합(EditorArea 패턴). 클릭=re-center, Ctrl=openFile.
6. **갤럭시 meta-edge 복구** — GraphView `visibleEdges`가 galaxy에서 metaEdges 반환. 별도 dim-only lineSegments 레이어(opacity ~0.18, **hover lit 금지** = 옛 breakage 원인), buffer ref 안정(호버 수정과 동일 원칙).
7. **App.tsx 패널 리사이즈** — 우측 패널 드래그 리사이즈 + 기본 넓게, `PANEL_TITLES['note-preview']` → 'Explorer'.

## 인터페이스 (구현 중 정밀화)

- `app-store`: `previewNote: {filePath, title, content, isDirty} | null`; `updatePreviewContent(content)`, `markPreviewClean()`, `savePreview()`; `useFocusedNote() => {filePath, title} | null`.
- `links-shared`: `<RelationLists title filePath onOpen={(filePath,title,ev)=>void} />` (ev로 Ctrl 판별).
- `LocalGraph`: `<LocalGraph filePath depth onOpen />`.
- `outlinks`: `parseOutlinks(content): Array<{raw, target, resolvedPath?}>`.

## 검증

- 단계마다 `npx tsc --noEmit` 0.
- 통합 후 desktop vitest 60+ / smoke 12.
- WebGL/UX는 패키징 빌드 → 사용자 시각 확인 (dev 모드는 type:module 충돌로 안 뜸 — **반드시 `npm run package` 후 Stellavault.exe**).
- 호버-clump 회귀 없는지 갤럭시 엣지 추가 후 재확인.

## 출처
- understand workflow `wf_e2c0eaec` (5 area 매핑), design workflow `wf_b302c446` (3안 + judge).
