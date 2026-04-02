# Jarvis System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE                                  │
│                                                                          │
│   🎤 Voice         💬 Chat          🖥️ Desktop        📱 Mobile         │
│   (Whisper/        (Terminal/       (Electron/        (Future)           │
│    Web Speech)      Web UI)          Tauri)                              │
└─────────────┬──────────┬──────────────┬─────────────────────────────────┘
              │          │              │
              ▼          ▼              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     JARVIS AGENT CORE                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Agent Orchestrator                             │    │
│  │              (Claude Agent SDK / Claude API)                     │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │    │
│  │  │ Intent   │  │ Context  │  │ Task     │  │ Memory   │       │    │
│  │  │ Router   │  │ Manager  │  │ Planner  │  │ Manager  │       │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                     MCP Protocol (stdio / HTTP)                         │
│                              │                                          │
│  ┌───────────────────────────┴────────────────────────────────────┐    │
│  │                    MCP Server Registry                          │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │              KNOWLEDGE (지식)                             │   │    │
│  │  │                                                          │   │    │
│  │  │  ┌─────────────────────────────────────────────────┐    │   │    │
│  │  │  │  🧠 Evan Knowledge Hub (ekh MCP)                │    │   │    │
│  │  │  │                                                  │    │   │    │
│  │  │  │  Intelligence Layer                              │    │   │    │
│  │  │  │  ├── FSRS Decay Engine (기억 감쇠)               │    │   │    │
│  │  │  │  ├── Gap Detector (지식 빈틈) [Phase 4c]        │    │   │    │
│  │  │  │  └── Evolution Tracker (변화 추적) [Phase 4c]   │    │   │    │
│  │  │  │                                                  │    │   │    │
│  │  │  │  Core Engine                                     │    │   │    │
│  │  │  │  ├── RRF Hybrid Search (BM25+Cosine)            │    │   │    │
│  │  │  │  ├── MCP 11 Tools                                │    │   │    │
│  │  │  │  ├── Knowledge Pack (.ekh-pack)                  │    │   │    │
│  │  │  │  └── SQLite-vec Store                            │    │   │    │
│  │  │  │                                                  │    │   │    │
│  │  │  │  Visualization                                   │    │   │    │
│  │  │  │  ├── 3D Neural Graph (R3F)                       │    │   │    │
│  │  │  │  ├── Constellation LOD                           │    │   │    │
│  │  │  │  └── Export (PNG/WebM)                           │    │   │    │
│  │  │  └──────────────────────────────────────────────────┘    │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │              PRODUCTIVITY (생산성)                        │   │    │
│  │  │                                                          │   │    │
│  │  │  📧 Gmail MCP          일정/메일 관리, 자동 회신         │   │    │
│  │  │  📝 Notion MCP         프로젝트/작업 관리, 문서 생성     │   │    │
│  │  │  📅 Calendar MCP       일정 조회/생성 [NEW]              │   │    │
│  │  │  ✅ Todoist/Linear     태스크 추적 [NEW]                 │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │              CREATION (창작)                              │   │    │
│  │  │                                                          │   │    │
│  │  │  🎨 Figma MCP          UI/UX 디자인 연동                 │   │    │
│  │  │  🖼️ Canva MCP          그래픽/프레젠테이션               │   │    │
│  │  │  💻 Code MCP           코드 생성/리뷰 [NEW]             │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │              AUTOMATION (자동화)                          │   │    │
│  │  │                                                          │   │    │
│  │  │  🌐 Playwright MCP     웹 브라우징/스크래핑/QA           │   │    │
│  │  │  🏠 Home MCP           IoT/스마트홈 제어 [NEW]           │   │    │
│  │  │  💰 Finance MCP        가계부/투자 조회 [NEW]            │   │    │
│  │  │  🔔 Notification MCP   푸시 알림/리마인더 [NEW]          │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘

                              │
                              ▼

┌──────────────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                        │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Obsidian     │  │ Jarvis       │  │ ekh          │  │ Logs       │ │
│  │ Vault        │  │ Memory DB    │  │ Vector DB    │  │ & Audit    │ │
│  │ (.md files)  │  │ (sessions,   │  │ (SQLite-vec) │  │ Trail      │ │
│  │              │  │  preferences,│  │              │  │            │ │
│  │              │  │  routines)   │  │              │  │            │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### "내일 회의 준비해줘"
```
Voice → Intent Router → Task Planner
  ├── Calendar MCP: 내일 회의 조회
  ├── ekh MCP: 회의 관련 지식 검색 (get-related)
  ├── Gmail MCP: 참석자 최근 메일 확인
  ├── Notion MCP: 회의 안건 문서 생성
  └── Notification MCP: 30분 전 리마인더 설정
```

### "잊어가는 지식 알려줘"
```
Voice → Intent Router → ekh MCP
  ├── get-decay-status: R < 0.5 노트 20개
  ├── Context Manager: 최근 작업 컨텍스트 매칭
  └── Voice TTS: "OAuth 관련 노트를 75일간 안 보셨습니다. 리뷰할까요?"
```

### "이번 달 지출 정리해줘"
```
Voice → Intent Router → Task Planner
  ├── Finance MCP: 이번 달 거래 내역 조회
  ├── Notion MCP: 가계부 페이지 업데이트
  └── Voice TTS: "이번 달 총 지출 ₩1,234,000입니다. 가장 큰 항목은..."
```

## Jarvis vs OpenClaw

| | OpenClaw | Jarvis |
|---|---------|--------|
| **목적** | 범용 AI 에이전트 프레임워크 | 개인 생활 자동화 에이전트 |
| **지식** | 없음 | ekh 통합 (1,200+ 노트, 감쇠 추적) |
| **음성** | 지원 | 핵심 인터페이스 |
| **MCP** | Gateway 기반 | 직접 연결 (이미 5개 연결) |
| **규모** | 기업/팀용 | 개인용 (1인) |
| **복잡도** | 높음 (마이크로서비스) | 낮음 (단일 Node.js) |

## Tech Stack (Proposed)

| Layer | Technology |
|-------|-----------|
| Agent | Claude Agent SDK / Claude API |
| Voice STT | Whisper (local) or Web Speech API |
| Voice TTS | Coqui TTS (local) or Web Speech API |
| MCP | @modelcontextprotocol/sdk |
| Runtime | Node.js ESM + TypeScript |
| Desktop | Electron or Tauri |
| Memory | SQLite (sessions, preferences, routines) |
| Knowledge | ekh MCP (external, already running) |
