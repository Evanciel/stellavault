# D1 MCP-as-distribution — GTM 실행 체크리스트

> npm `stellavault@0.8.5` 게시 완료 + 레지스트리 매니페스트(server.json/glama.json/smithery.yaml) 머지 완료.
> 이 문서 = 남은 **외부 게시/홍보**의 정확한 명령 + 붙여넣기용 초안. 대부분 본인 GitHub/사이트 로그인 필요.

---

## ✅ 이미 완료 (코드/자동)
- npm `stellavault@0.8.5` publish + GitHub 릴리즈 `v0.8.5`
- `server.json`(공식 레지스트리 매니페스트, `io.github.Evanciel/stellavault`) · `glama.json` · `smithery.yaml` (repo 루트)
- `package.json` `mcpName` + 확장 키워드
- MCP-first README(en/ko/ja/zh) + 랜딩(en/ko) + 1줄 install(`npx -y stellavault setup`)
- **GitHub repo Topics 20개 갱신** (mcp-server, model-context-protocol, claude, anthropic, second-brain 등)

---

## 1. 공식 MCP 레지스트리 게시 (최우선 — 다른 사이트가 이걸 크롤)

> ⚠ 레지스트리는 PREVIEW. 게시 전 `server.json` 스키마/CLI 플래그를 https://github.com/modelcontextprotocol/registry 에서 재확인.

```bash
# 1) publisher CLI 설치
npm i -g @modelcontextprotocol/publisher   # 또는: brew install mcp-publisher / GitHub releases 바이너리

# 2) GitHub 로그인 (device-code OAuth — 브라우저에서 코드 승인) — 본인 수행
mcp-publisher login github

# 3) repo 루트에서 게시 (server.json을 읽음)
cd /path/to/stellavault
mcp-publisher publish
```
- `io.github.Evanciel/*` 네임스페이스 = GitHub 로그인만으로 소유권 증명(도메인 불필요).
- 게시 후 https://registry.modelcontextprotocol.io/v0/servers?search=stellavault 에서 확인.
- **검증 규칙**: `server.json`의 `version`/`packages[].version`(0.8.5)이 npm 게시 버전과 일치해야 통과(이미 lockstep). npm은 0.8.5 게시 완료.

## 2. 리스팅 클레임 (각 사이트 로그인 — 본인 수행)
대부분 자동 크롤되므로 "소유권 클레임 + 설명 다듬기"만:
- **Glama** (glama.ai): `glama.json` 커밋됨 → "Claim ownership" 플로우. (awesome-mcp PR의 선행 조건)
- **Smithery** (smithery.ai): `smithery.yaml` 기반 자동 리스팅 클레임.
- **PulseMCP** (pulsemcp.com/servers): 자동 크롤 리스팅 클레임.
- **mcp.so**: Submit 버튼 → name/description/connection 정보 제출.

## 3. awesome-mcp-servers PR (Glama 리스팅 라이브 후)
> punkpeye/awesome-mcp-servers 의 해당 카테고리(예: Knowledge & Memory)에 알파벳 순 삽입.
> 제출 전 라이브 README의 이모지/마커 범례 확인. **Glama 링크가 GitHub 링크 바로 뒤에 와야 함.**

붙여넣기용 엔트리 (포맷은 라이브 README에 맞춰 조정):
```markdown
- [Evanciel/stellavault](https://github.com/Evanciel/stellavault) 🎖️ 📇 🏠 - Self-compiling knowledge MCP server for your Obsidian vault — search, ask, draft, and analyze your notes (21 tools). Local-first, no API keys, files never modified.
```
(범례: 🎖️ official/featured는 빼고, 📇 TypeScript · 🏠 local 등 라이브 범례 기준으로 표기)

## 4. 런치 포스트 초안
→ [launch-posts-mcp.md](launch-posts-mcp.md) (r/mcp · r/ClaudeAI · r/ObsidianMD · HN Show · X 스레드)

---

## 남은 것 (본인 결정)
- code-signing: Azure Trusted Signing (~$10/월) → SmartScreen 통과 (데스크탑 unsigned 설치 경고 제거)
