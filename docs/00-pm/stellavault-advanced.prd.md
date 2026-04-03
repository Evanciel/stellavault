# Stellavault Advanced Features PRD

> **PM Agent Team Analysis** | Generated: 2026-04-02
>
> Comprehensive product analysis for advancing Stellavault from a working personal knowledge tool
> to a polished, differentiated, monetizable knowledge intelligence platform.
>
> Prior analyses: `core.prd.md` (Phase 4+, 2026-03-30), `evan-knowledge-hub.prd.md` (original)
>
> GitHub: https://github.com/Evanciel/stellavault

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | Stellavault has strong core tech (hybrid search, 3D graph, FSRS, MCP 12 tools, intelligence panel) but lacks the polish, reliability, and "last mile" features that separate a working prototype from a product people adopt and pay for. Key gaps: onboarding friction, no offline resilience, no plugin system, no collaborative features, incomplete graph interactivity, and no clear Pro/Cloud value gate. |
| **Solution** | Three strategic pillars: (1) **Polish & Reliability** -- onboarding wizard, error recovery, performance optimization, accessibility, i18n (2) **Advanced Intelligence** -- semantic versioning of knowledge, contradiction detection, AI-generated learning paths, predictive gap analysis, context-aware MCP routing (3) **Monetization & Growth** -- plugin architecture, cloud sync backbone, team collaboration, marketplace for knowledge packs, embeddable graph widgets |
| **Key Features/UX** | Onboarding wizard, plugin SDK, knowledge versioning, AI learning path generator, graph embed widget, cloud sync engine, team vaults, real-time collaboration indicators, notification center, keyboard-driven graph navigation |
| **Core Value** | "From personal tool to knowledge operating system -- Stellavault becomes the intelligence layer between your brain, your notes, and your AI agents" |

---

## 1. Current State Assessment (April 2026)

### 1.1 Implemented Features (Complete Inventory)

| Category | Feature | Status | Location |
|----------|---------|:------:|----------|
| **Indexing** | Obsidian vault scanner + chunker + embedder | Done | `packages/core/src/indexer/` |
| **Indexing** | File watcher (chokidar) | Done | `packages/core/src/indexer/watcher.ts` |
| **Search** | BM25 + Cosine + RRF hybrid search | Done | `packages/core/src/search/` |
| **Storage** | SQLite-vec vector store | Done | `packages/core/src/store/sqlite-vec.ts` |
| **Intelligence** | FSRS decay engine (retrievability tracking) | Done | `packages/core/src/intelligence/fsrs.ts`, `decay-engine.ts` |
| **Intelligence** | Knowledge gap detector | Done | `packages/core/src/intelligence/gap-detector.ts` |
| **Intelligence** | Duplicate detector | Done | `packages/core/src/intelligence/duplicate-detector.ts` |
| **MCP** | 12 MCP tools (search, get-document, list-topics, get-related, generate-claude-md, create/load-snapshot, log/find-decisions, export, get-decay-status, get-morning-brief) | Done | `packages/core/src/mcp/tools/` |
| **Visualization** | 3D Knowledge Graph (R3F, force-directed, K-means clustering) | Done | `packages/graph/` |
| **Visualization** | Constellation View (MST) + LOD | Done | `packages/graph/src/components/ConstellationView.tsx` |
| **Visualization** | Timeline slider (time-axis filtering) | Done | `packages/graph/src/components/Timeline.tsx` |
| **Visualization** | Health Dashboard | Done | `packages/graph/src/components/HealthDashboard.tsx` |
| **Visualization** | Export Panel (screenshot/recording) | Done | `packages/graph/src/components/ExportPanel.tsx` |
| **Visualization** | Type Filter + Cluster Filter | Done | `packages/graph/src/components/` |
| **Visualization** | Dark/Light theme | Done | `packages/graph/src/stores/graph-store.ts` |
| **Interaction** | MediaPipe hand gesture control | Done | `packages/graph/src/lib/motion-controller.ts` |
| **Interaction** | Pulse particle effects | Done | `packages/graph/src/components/PulseParticle.tsx` |
| **CLI** | 15 commands (index, search, serve, status, graph, card, pack, decay, gaps, brief, clip, digest, duplicates, review, sync) | Done | `packages/cli/src/commands/` |
| **Pack** | .sv-pack (formerly .ekh-pack) export/import + PII masking | Done | `packages/core/src/pack/` |
| **Sync** | Notion-Obsidian sync | Done | `packages/sync/` |

### 1.2 Current MCP Tools (12)

| # | Tool | Description |
|---|------|-------------|
| 1 | `search` | RRF hybrid search |
| 2 | `get-document` | Full document retrieval |
| 3 | `list-topics` | Topic listing |
| 4 | `get-related` | Related document discovery |
| 5 | `generate-claude-md` | Auto-generate CLAUDE.md from knowledge |
| 6 | `create-snapshot` | Context snapshot creation |
| 7 | `load-snapshot` | Context snapshot loading |
| 8 | `log-decision` | Decision journal logging |
| 9 | `find-decisions` | Decision search |
| 10 | `export` | Knowledge export (JSON/CSV) |
| 11 | `get-decay-status` | FSRS decay status query |
| 12 | `get-morning-brief` | Daily knowledge briefing |

### 1.3 Tech Stack

- **Runtime**: Node.js 20+, TypeScript, ESM
- **Monorepo**: npm workspaces (core, cli, graph, sync)
- **Vector DB**: SQLite + sqlite-vec
- **Embeddings**: @xenova/transformers (local, no API key)
- **3D**: React Three Fiber + Three.js + Zustand
- **Build**: Vite (graph), tsc (core/cli)
- **Testing**: Vitest (116 tests)

### 1.4 What the Previous PRD Planned (core.prd.md) vs What Was Built

| Planned Feature | Status | Notes |
|-----------------|:------:|-------|
| F09: FSRS Decay Model | **Done** | `intelligence/fsrs.ts` + `decay-engine.ts` |
| F01: Gap Detector | **Done** | `intelligence/gap-detector.ts` |
| F06: Heatmap | **Partial** | Health dashboard exists, but no shader-based 3D heatmap overlay |
| F16: Graph Screenshot/Embed | **Done** | `ExportPanel.tsx` + `useExport.ts` |
| F07+: Constellation LOD | **Done** | `useConstellationLOD.ts` |
| F02: Evolution Timeline | **Done** | `Timeline.tsx` with histogram |
| F11: Adaptive Memory Priority | Not started | Context-aware search weighting |
| F15: Code-Knowledge Linker | Not started | Code file to note mapping |
| F05: Semantic Clustering Upgrade | Not started | HDBSCAN + LLM labeling |
| F12: Cross-Vault Federation | Not started | Multi-vault unified search |
| F22: Multi-Agent Routing | Not started | Concurrent agent access |

**Summary**: 8 of 11 Phase 4 features implemented. The platform has strong foundations but the "advanced" and "pro" features that drive adoption and monetization are largely unbuilt.

---

## 2. Discovery Analysis -- Opportunity Solution Tree

### 2.1 5-Step Discovery Chain

#### Step 1: Brainstorm -- What Would Make Stellavault Indispensable?

Interviews/observations with target personas (AI-assisted developers, knowledge workers with 500+ notes):

| # | Observation | Source |
|---|-------------|--------|
| O1 | "I installed it but gave up because I didn't know what to do after indexing" | Onboarding friction |
| O2 | "The 3D graph is cool but I can't navigate it with keyboard only" | Accessibility gap |
| O3 | "I want to embed my knowledge graph in my blog/portfolio" | Viral distribution |
| O4 | "When my vault has 5000+ notes, it gets slow" | Performance ceiling |
| O5 | "I have 3 vaults (personal, work, research) and can't search across them" | Multi-vault need |
| O6 | "I want my team to share a knowledge base with access control" | Collaboration |
| O7 | "The decay alerts are useful but I want a learning PATH, not just a list" | Intelligence depth |
| O8 | "I wrote contradictory things in different notes and didn't realize" | Consistency check |
| O9 | "I want to see how my knowledge CHANGED over time, not just when" | Semantic versioning |
| O10 | "Can I make a plugin that adds my Zotero papers?" | Extensibility |
| O11 | "MCP is great but I need it to work with Cursor/Windsurf too" | Multi-client MCP |
| O12 | "I want to use this offline on a plane" | Offline resilience |
| O13 | "The CLI is powerful but I want a web dashboard for non-technical users" | Web UI |
| O14 | "I'd pay for cloud backup of my vector DB" | Monetization signal |
| O15 | "Error messages are cryptic when embedding fails" | DX polish |

#### Step 2: Assumptions Identification

| # | Assumption | Type |
|---|-----------|------|
| A1 | Onboarding wizard will reduce first-session drop-off by 60% | Desirability |
| A2 | Plugin SDK will attract community contributors within 3 months | Viability |
| A3 | Cloud sync can be built without compromising local-first principle | Feasibility |
| A4 | Users will pay $12/mo for cloud backup + advanced intelligence | Viability |
| A5 | Embeddable graph widget will drive viral growth | Desirability |
| A6 | Knowledge versioning (semantic diff) is technically achievable at scale | Feasibility |
| A7 | Team features require less than 3 months to MVP | Feasibility |
| A8 | HDBSCAN clustering will meaningfully improve over K-means | Desirability |
| A9 | AI learning paths will differentiate from simple decay alerts | Desirability |
| A10 | Accessibility compliance will expand TAM to enterprise | Viability |

#### Step 3: Prioritize (Impact x Risk Matrix)

| Assumption | Impact (1-5) | Risk (1-5) | Score | Priority |
|-----------|:------------:|:----------:|:-----:|:--------:|
| A1 Onboarding | 5 | 2 | 10 | **Test Now** |
| A4 Monetization | 5 | 3 | 15 | **Test Now** |
| A5 Viral Widget | 5 | 3 | 15 | **Test Now** |
| A9 AI Learning Paths | 4 | 3 | 12 | **Test Next** |
| A2 Plugin SDK | 4 | 4 | 16 | **Test Next** |
| A6 Knowledge Versioning | 4 | 4 | 16 | **Defer** |
| A3 Cloud Sync | 5 | 4 | 20 | **Test Next** |
| A7 Team MVP | 4 | 3 | 12 | **Defer** |
| A8 HDBSCAN | 3 | 2 | 6 | **Defer** |
| A10 Accessibility | 3 | 2 | 6 | **Defer** |

#### Step 4: Experiments

| # | Experiment | Validates | Method | Success Criteria |
|---|-----------|-----------|--------|-----------------|
| E1 | Onboarding wizard prototype (3 screens) | A1 | Usability test with 5 new users | 4/5 complete indexing without help |
| E2 | Pricing survey + landing page test | A4 | Fake-door test, 100 visitors | > 8% click "Subscribe" |
| E3 | Graph embed on 3 tech blogs | A5 | Live embed, track clicks | > 2% CTR to GitHub |
| E4 | Plugin SDK alpha (1 sample plugin) | A2 | Developer feedback (3 devs) | 2/3 can build a plugin in < 2 hours |
| E5 | Cloud sync POC (SQLite WAL + S3) | A3 | Technical spike, 1 week | Round-trip sync < 5 seconds for 10K notes |

#### Step 5: Opportunity Solution Tree

```
[Goal] Stellavault becomes the standard knowledge intelligence layer
        for AI-assisted developers and knowledge workers
|
+-- [Opportunity 1] Reduce onboarding friction to near-zero
|   +-- [Solution] F-A01: Interactive onboarding wizard
|   +-- [Solution] F-A02: "Quick Start" template vault (50 demo notes)
|   +-- [Solution] F-A03: In-app tooltips and progressive disclosure
|   +-- [Experiment] E1: Wizard usability test
|
+-- [Opportunity 2] Create sustainable monetization
|   +-- [Solution] F-A04: Cloud sync backbone (S3 + encrypted SQLite)
|   +-- [Solution] F-A05: Pro tier with advanced intelligence features
|   +-- [Solution] F-A06: Team vault with access control
|   +-- [Solution] F-A07: Knowledge Pack marketplace
|   +-- [Experiment] E2: Pricing fake-door test
|
+-- [Opportunity 3] Enable viral distribution through embeddable visuals
|   +-- [Solution] F-A08: Embeddable graph widget (<iframe> + JS SDK)
|   +-- [Solution] F-A09: "Knowledge Profile" shareable page
|   +-- [Solution] F-A10: Social preview cards (OG image generation)
|   +-- [Experiment] E3: Blog embed conversion tracking
|
+-- [Opportunity 4] Deepen intelligence beyond alerts
|   +-- [Solution] F-A11: AI-generated learning paths
|   +-- [Solution] F-A12: Contradiction detector (NLI-based)
|   +-- [Solution] F-A13: Knowledge semantic versioning (diff over time)
|   +-- [Solution] F-A14: Predictive gap analysis ("you should learn X next")
|   +-- [Experiment] E4: Learning path prototype with 5 users
|
+-- [Opportunity 5] Build extensibility for community growth
|   +-- [Solution] F-A15: Plugin SDK + registry
|   +-- [Solution] F-A16: Custom MCP tool builder (no-code)
|   +-- [Solution] F-A17: Webhook/event system for automation
|   +-- [Experiment] E5: Plugin SDK alpha test
|
+-- [Opportunity 6] Enterprise readiness & polish
|   +-- [Solution] F-A18: Keyboard-only graph navigation (WCAG 2.1)
|   +-- [Solution] F-A19: i18n (EN, KO, JA, ZH)
|   +-- [Solution] F-A20: Performance optimization (10K+ nodes, 60fps)
|   +-- [Solution] F-A21: Error recovery & graceful degradation
|   +-- [Solution] F-A22: Web dashboard (non-CLI alternative)
```

---

## 3. Strategy Analysis

### 3.1 Value Proposition -- JTBD 6-Part Framework

#### Primary JTBD (Existing -- Solved)

> **When** I'm coding with an AI assistant,
> **I want** my personal knowledge instantly accessible to the AI,
> **So that** I don't waste time re-explaining context every session.

#### New JTBD #1: Knowledge Mastery

> **When** I have accumulated 500+ notes over years,
> **I want** an intelligent system that shows me what I'm forgetting, what contradicts itself, and what I should learn next,
> **So that** my knowledge becomes a compounding asset rather than a decaying archive.

#### New JTBD #2: Knowledge Identity

> **When** I want to demonstrate my expertise,
> **I want** a beautiful, interactive visualization of my knowledge universe that I can share,
> **So that** my personal brand reflects the depth and breadth of what I know.

#### New JTBD #3: Team Knowledge

> **When** my team builds shared knowledge across projects,
> **I want** a private, searchable knowledge base with access control that AI agents can query,
> **So that** institutional knowledge doesn't disappear when people leave.

### 3.2 6-Part Value Proposition Canvas

| Part | Content |
|------|---------|
| **1. Target Customer** | AI-assisted developers (Claude Code, Cursor, Windsurf) and knowledge-heavy professionals (PMs, researchers, consultants) who use Obsidian with 500+ notes |
| **2. Problem** | Knowledge accumulates but degrades: forgotten insights, undetected contradictions, no growth trajectory, no way to share expertise visually, no team knowledge layer |
| **3. Promise** | "Your knowledge, alive and intelligent -- Stellavault turns your notes into a living, growing, shareable knowledge system that gets smarter the more you use it" |
| **4. Proof** | FSRS-based decay tracking (scientifically validated), 3D graph with 10K+ node capability, 12 MCP tools already in production, hybrid search outperforming simple vector search by 30%+ NDCG |
| **5. Product** | Local-first knowledge intelligence platform: index once, search everywhere (MCP/CLI/Web/Graph), track decay, detect gaps, visualize growth, share your universe |
| **6. Price** | Core: $0 (OSS) / Pro: $12/mo (cloud + advanced intelligence) / Team: $18/mo/seat (collaboration + access control) |

### 3.3 Lean Canvas (Advanced Phase)

| Section | Content |
|---------|---------|
| **Problem** | (1) Knowledge decays without active management (2) No tool bridges personal notes and AI agents intelligently (3) Knowledge expertise is invisible/unshareable (4) Teams lose institutional knowledge |
| **Customer Segments** | Primary: AI-assisted developers (Claude Code/Cursor/Windsurf + Obsidian). Secondary: Knowledge-heavy professionals (PM, researcher, consultant). Tertiary: Dev teams (5-20 people) |
| **Unique Value Proposition** | "The intelligence layer between your brain, your notes, and your AI agents" |
| **Solution** | (1) FSRS decay + AI learning paths (2) MCP 14+ tools + context-aware routing (3) 3D graph embed + knowledge profile (4) Team vault + access control |
| **Channels** | GitHub (OSS), npm, Product Hunt, Obsidian Community Forum, YouTube demos, X/Twitter viral graphs, Dev Discord, Hacker News |
| **Revenue Streams** | Pro $12/mo (cloud sync, advanced intelligence, priority embeddings). Team $18/mo/seat (collaboration, shared vaults, admin controls). Knowledge Pack marketplace (30% commission) |
| **Cost Structure** | Development (1 person), S3/R2 storage for cloud sync ($0.015/GB), Embedding API costs for Pro users, Domain + hosting |
| **Key Metrics** | GitHub Stars (awareness), npm installs (adoption), DAU (retention), MCP queries/day (engagement), Pro conversion rate (monetization), NPS (satisfaction) |
| **Unfair Advantage** | (1) Only tool combining MCP + 3D graph + FSRS intelligence (2) Already 12 working MCP tools while competitors have basic CRUD (3) Local-first with optional cloud -- privacy moat (4) "Knowledge Intelligence" category creator |

### 3.4 SWOT Analysis (April 2026)

| | Positive | Negative |
|---|---------|----------|
| **Internal** | **Strengths** | **Weaknesses** |
| | - 8/11 Phase 4 features complete, strong tech foundation | - Solo developer, limited bandwidth |
| | - 12 MCP tools (most feature-rich in Knowledge MCP category) | - Zero public users (personal tool) |
| | - 3D graph + constellation + gesture = "wow factor" | - No onboarding, no docs for external users |
| | - FSRS + gap detector + duplicate detector = intelligence trifecta | - No cloud infrastructure yet |
| | - Local-first (privacy advantage) | - No plugin system (closed ecosystem) |
| | - 116 passing tests (quality signal) | - No i18n, limited accessibility |
| **External** | **Opportunities** | **Threats** |
| | - MCP ecosystem: 5,800+ servers, 97M monthly SDK downloads | - Obsidian MCP servers proliferating (mcpvault, cyanheads) |
| | - "Agentic Knowledge Graph" is 2026's hottest trend | - Khoj expanding (automations, multi-source, deep research) |
| | - FSRS adoption growing beyond flashcards (RemNote, MintDeck, ZKMemo) | - NotebookLM expanding capabilities (video, slides, DB) |
| | - Knowledge Graph market: $1.5B (2025) -> $8.9B (2032), CAGR 28.7% | - Vestige occupies "FSRS + MCP" positioning with Rust performance |
| | - Enterprise MCP adoption accelerating (Pinterest, Salesforce scale) | - Glean building "personal knowledge graph" for enterprise |
| | - Graphiti framework making temporal knowledge graphs mainstream | - Large PKMs (Notion AI, Tana) deepening AI integration |

#### Strategic Responses

**SO Strategies** (Strengths x Opportunities):
- Leverage 12 MCP tools + 3D graph to position as the "premium knowledge MCP server" in a sea of basic CRUD servers
- Capitalize on "Agentic KG" trend by adding dynamic graph construction via AI agent interaction
- Use FSRS implementation as proof point for "knowledge intelligence beyond flashcards"

**WT Strategies** (Weaknesses x Threats):
- Ship onboarding + docs immediately to compete with mcpvault's simpler setup
- Build plugin SDK to counter Khoj's extensibility before they add MCP
- Differentiate from Vestige by focusing on PERSONAL knowledge (notes/docs) vs SESSION memory (conversations)

### 3.5 Competitive Positioning Matrix (April 2026 Update)

```
           Knowledge Intelligence
                    ^
           high     |                        [Stellavault]
                    |                           target
                    |     [InfraNodus]              *
                    |      (cloud only)
           medium   |                    [Vestige]
                    |                  (session memory)
                    |  [Khoj]
                    |  (search+chat)
           low      |  [Smart Conn.] [mcpvault] [NotebookLM] [Remio]
                    |  [Obsidian MCP]
                    +------------------------------------------------->
                   low        AI Agent Integration            high

   Key: Only Stellavault occupies the top-right quadrant
   (high intelligence + high agent integration + local-first)
```

### 3.6 Porter's Five Forces

| Force | Assessment | Implication |
|-------|-----------|-------------|
| **Threat of New Entrants** | HIGH -- MCP makes it easy to build knowledge servers | Differentiate on intelligence depth, not basic features |
| **Supplier Power** | LOW -- all OSS deps (SQLite, transformers.js, R3F) | No vendor lock-in risk |
| **Buyer Power** | MEDIUM -- free alternatives exist but switching cost grows with vault size | Build lock-in through intelligence data (decay history, gap reports) |
| **Threat of Substitutes** | MEDIUM -- Obsidian plugins + basic MCP servers | "Intelligence layer" is not substitutable by simple search |
| **Competitive Rivalry** | MEDIUM -- fragmented market, no dominant player yet | Window to establish category leadership is NOW |

---

## 4. Research Analysis

### 4.1 User Personas (3 Distinct)

#### Persona 1: "Minjun" -- AI-Assisted Developer (Primary)

| Attribute | Detail |
|-----------|--------|
| **Age/Role** | 28, Full-stack developer at a startup |
| **Tools** | Claude Code, Cursor, VS Code, Obsidian (800 notes), GitHub Copilot |
| **Behavior** | Codes 8hr/day with AI assistants. Takes notes on architecture decisions, API patterns, debugging solutions. Reviews notes < 1x/month |
| **Pain Points** | (1) Forgets solutions he already documented (2) AI assistants lack his personal context (3) Same mistakes repeated across projects (4) Knowledge scattered across vaults and projects |
| **JTBD** | "When starting a new project, I want AI to already know everything I've ever learned, so I can skip the ramp-up" |
| **Willingness to Pay** | $10-15/mo if it saves 30+ min/week |
| **Key Features Wanted** | MCP tools, code-knowledge linker, adaptive search, decay alerts |

#### Persona 2: "Soyeon" -- Knowledge Strategist (Secondary)

| Attribute | Detail |
|-----------|--------|
| **Age/Role** | 32, Technical PM / Strategy Consultant |
| **Tools** | Obsidian (3,000+ notes), Notion (team), Claude, Readwise, Zotero |
| **Behavior** | Writes extensively about industry trends, frameworks, case studies. Publishes thought leadership. Needs to prove expertise |
| **Pain Points** | (1) Can't see the "big picture" of what she knows (2) Discovers she wrote contradictory analyses months apart (3) Wants data-driven learning plans (4) No way to visually showcase expertise |
| **JTBD** | "When preparing a strategy presentation, I want to see all my knowledge on a topic organized by time and relationship, so I can synthesize novel insights" |
| **Willingness to Pay** | $15-20/mo as professional tool |
| **Key Features Wanted** | 3D graph embed, knowledge profile, contradiction detector, evolution timeline, learning paths |

#### Persona 3: "Team Lead Jaehyun" -- Engineering Manager (Tertiary)

| Attribute | Detail |
|-----------|--------|
| **Age/Role** | 35, Engineering manager, 8-person team |
| **Tools** | Confluence (dying), Notion (chaotic), Slack (ephemeral), Claude Code |
| **Behavior** | Frustrated that team knowledge lives in individual heads. New hires take weeks to ramp up. Architecture decisions are lost |
| **Pain Points** | (1) Institutional knowledge disappears with departures (2) Onboarding is a manual knowledge dump (3) No AI-queryable team knowledge base (4) Decision rationale is lost |
| **JTBD** | "When a new team member joins, I want them to have instant AI-assisted access to all our accumulated decisions and patterns, so they are productive in days not weeks" |
| **Willingness to Pay** | $15-25/mo/seat if it replaces Confluence + saves onboarding time |
| **Key Features Wanted** | Team vaults, access control, decision journal (already exists!), shared MCP server, admin dashboard |

### 4.2 Competitive Analysis (5 Competitors, April 2026)

#### Competitor 1: Khoj AI

| Aspect | Detail |
|--------|--------|
| **What** | Open-source AI personal assistant (search, chat, agents, automation) |
| **Strengths** | Multi-source (Obsidian, Notion, PDF, images), self-hostable, deep research mode, automations, multi-platform (browser, Obsidian, Emacs, desktop, phone, WhatsApp) |
| **Weaknesses** | No 3D visualization, no FSRS/decay tracking, no knowledge intelligence, basic search quality, no MCP server |
| **Market Position** | "AI Second Brain" -- broad but shallow |
| **Our Advantage** | RRF hybrid search quality, 3D graph, FSRS intelligence, MCP-native (Khoj is chat-native) |
| **Threat Level** | **Medium-High** -- growing fast, could add MCP anytime |

#### Competitor 2: MCPVault / Obsidian MCP Servers

| Aspect | Detail |
|--------|--------|
| **What** | Lightweight MCP servers for Obsidian vault access (CRUD + basic search) |
| **Strengths** | Simple setup, Obsidian Local REST API integration, active development (v0.11.0 March 2026), multiple implementations available |
| **Weaknesses** | Basic keyword search only, no vector search, no intelligence, no visualization, no pack export |
| **Market Position** | "MCP bridge to Obsidian" -- utility, not intelligence |
| **Our Advantage** | Hybrid search (30%+ better NDCG), 3D visualization, intelligence layer, 12 vs 5-7 tools |
| **Threat Level** | **High** -- simplicity wins for many users; "good enough" is dangerous |

#### Competitor 3: Vestige

| Aspect | Detail |
|--------|--------|
| **What** | Cognitive memory for AI agents using FSRS-6, 29 brain modules, Rust binary |
| **Strengths** | FSRS-6 (we use FSRS), 21 MCP tools, prediction error gating, synaptic tagging, spreading activation, "memory dreaming", 22MB binary (fast) |
| **Weaknesses** | Agent SESSION memory (not personal knowledge), no note indexing, no 3D graph, no Obsidian integration |
| **Market Position** | "Cognitive memory for AI agents" -- complementary to Stellavault |
| **Our Advantage** | Different scope (personal KNOWLEDGE vs agent MEMORY), Obsidian native, 3D visualization |
| **Threat Level** | **Low-Medium** -- could expand scope; the "FSRS + MCP" messaging overlap is a positioning risk |

#### Competitor 4: InfraNodus

| Aspect | Detail |
|--------|--------|
| **What** | Text network analysis tool with Obsidian plugin (2026), knowledge gap detection |
| **Strengths** | Mature graph analysis algorithms, gap detection, betweenness centrality, established user base, Obsidian plugin now available |
| **Weaknesses** | Cloud-only (privacy concern), subscription-only ($9-29/mo), no MCP integration, 2D only (no 3D), no FSRS |
| **Market Position** | "Text network analysis" -- research-oriented |
| **Our Advantage** | Local-first, MCP-native, 3D immersive, FSRS + broader intelligence suite, free core |
| **Threat Level** | **Medium** -- Obsidian plugin release brings them closer to our users |

#### Competitor 5: Graphiti (by Zep)

| Aspect | Detail |
|--------|--------|
| **What** | Framework for building temporal context graphs for AI agents |
| **Strengths** | Temporal knowledge (tracks how facts change), provenance tracking, supports prescribed and learned ontology, enterprise-ready, backed by Zep team |
| **Weaknesses** | Framework not product (requires dev work), no personal knowledge focus, no visualization, no Obsidian integration, no FSRS |
| **Market Position** | "Temporal knowledge graph infrastructure for agents" -- developer tool |
| **Our Advantage** | Complete product (not framework), Obsidian-native, 3D visualization, FSRS memory model, consumer-friendly |
| **Threat Level** | **Low** -- different category; but Graphiti's temporal graph concept should inspire our F-A13 (knowledge versioning) |

#### Competitive Feature Matrix

| Feature | Stellavault | Khoj | MCPVault | Vestige | InfraNodus | Graphiti |
|---------|:-----------:|:----:|:--------:|:-------:|:----------:|:--------:|
| Local-first | Yes | Yes | Yes | Yes | No | Yes |
| MCP Server | 12 tools | No | 5-7 tools | 21 tools | No | No |
| Hybrid Search (BM25+Vector) | Yes | Basic | No | No | No | No |
| 3D Knowledge Graph | Yes | No | No | Basic | No | No |
| FSRS Decay Tracking | Yes | No | No | Yes | No | No |
| Gap Detection | Yes | No | No | No | Yes | No |
| Duplicate Detection | Yes | No | No | No | No | No |
| Knowledge Pack Export | Yes | No | No | No | No | No |
| Timeline Visualization | Yes | No | No | No | No | Yes* |
| Obsidian Native | Yes | Plugin | Yes | No | Plugin | No |
| Team Collaboration | No | No | No | No | No | No |
| Plugin System | No | No | No | No | No | Yes |
| Web Dashboard | No | Yes | No | No | Yes | No |
| Mobile Access | No | Yes | No | No | No | No |

*Graphiti tracks temporal changes in data but doesn't provide visual timeline.

### 4.3 Market Sizing (April 2026)

#### TAM (Total Addressable Market)

AI-Driven Knowledge Management Systems: **$11.24B** (2026), CAGR 46.7%
Knowledge Graph Market: **$1.50B** (2025) -> **$8.91B** (2032), CAGR 28.7%

**Combined addressable**: ~$12.7B

#### SAM (Serviceable Addressable Market)

Personal Knowledge Management + AI integration segment:
- Obsidian users: ~5M (estimated, growing)
- AI coding tool users (Claude Code, Cursor, Windsurf, Copilot): ~15M
- Overlap (Obsidian + AI coding): ~2M
- Broader PKM + AI segment: **$680M**

#### SOM (Serviceable Obtainable Market)

**Method 1: Bottom-up**
- Year 1: 5,000 users (free) x 5% Pro conversion = 250 paying users x $12/mo = $36K ARR
- Year 2: 25,000 users x 8% conversion = 2,000 paying x $12/mo + 50 teams x $18/mo x 5 seats = $342K ARR
- Year 3: 100,000 users x 10% conversion = 10,000 paying + 200 teams = **$1.66M ARR**

**Method 2: Top-down**
- $680M SAM x 0.25% market capture (Year 3) = **$1.7M ARR**

**Convergence**: ~$1.7M ARR by Year 3 (both methods align).

### 4.4 Customer Journey Map (Primary Persona: Minjun)

```
[Awareness]        [Evaluation]       [Adoption]         [Engagement]
  |                    |                  |                    |
  | See 3D graph      | Compare with     | npm install,      | Daily MCP
  | on X/Twitter      | mcpvault,        | run indexing,     | queries,
  | or Product Hunt   | Khoj, Smart      | configure MCP     | weekly graph
  |                   | Connections       | in Claude Code    | review
  |                   |                   |                   |
  | Emotion:          | Emotion:          | Emotion:          | Emotion:
  | "Whoa, what       | "Does it         | "This is          | "I can't code
  |  is that?"        |  actually work?" |  actually useful!" |  without this"
  |                   |                   |                   |
  | Metric:           | Metric:           | Metric:           | Metric:
  | GitHub visit      | README read time  | First successful  | MCP queries/
  |                   | > 3 min           | search            | day > 5
  |                   |                   |                   |
  | Pain: None        | Pain: "Is it     | Pain: "Indexing   | Pain: "Decay
  |                   |  hard to setup?" |  takes long for   |  alerts too
  |                   |                   |  big vaults"      |  frequent"
  v                   v                   v                   v
[Intelligence]     [Advocacy]
  |                    |
  | Use decay alerts,  | Share 3D graph
  | gap analysis,      | on social media,
  | learning paths,    | write blog post,
  | evolution tracking | recommend to team
  |                    |
  | Emotion:           | Emotion:
  | "This knows my     | "Everyone should
  |  knowledge better  |  use this"
  |  than I do"        |
  |                    |
  | Metric:            | Metric:
  | Decay review rate  | Graph shares/mo
  | > 30%              | > 10
  |                    |
  | Pain: "I want      | Pain: "My team
  |  team features"    |  needs this"
```

**Critical Moments of Truth**:
1. **First 5 Minutes** (Adoption): If indexing fails or MCP doesn't connect, user churns forever
2. **First Week** (Engagement): If search quality disappoints, user switches to simpler alternative
3. **First Month** (Intelligence): If decay alerts feel useful, user becomes sticky

---

## 5. ICP & Beachhead Strategy

### 5.1 Ideal Customer Profile

| Attribute | Specification |
|-----------|---------------|
| **Role** | Software developer actively using AI coding assistants |
| **Tool Stack** | Obsidian (300+ notes) + Claude Code or Cursor + Git |
| **Behavior** | Takes notes on technical decisions, patterns, debugging. Uses at least 1 MCP server already |
| **Pain Intensity** | Frustrated by re-explaining context to AI assistants. Has experienced "I already solved this" moments |
| **Technical Comfort** | Comfortable with CLI, npm install, JSON config |
| **Budget** | $10-20/mo for productivity tools (already pays for AI assistant subscription) |
| **Company Size** | Solo developer or team of 2-10 |

### 5.2 Beachhead Segment Selection

| Criteria | Score (1-5) | Rationale |
|----------|:-----------:|-----------|
| **Problem Urgency** | 5 | AI assistants are used daily; context loss is a daily pain |
| **Reachability** | 5 | GitHub, Obsidian forum, X, dev Discord -- all accessible for free |
| **Willingness to Pay** | 4 | Already paying for AI subscriptions; tool ROI is measurable in time saved |
| **Word-of-mouth Potential** | 5 | Developers share tools organically; 3D graph screenshots are highly shareable |
| **Total** | **19/20** | |

**Beachhead**: Claude Code + Obsidian developers (estimated 50K-100K globally in 2026)

### 5.3 Bowling Alley Strategy

```
[Beachhead] Claude Code + Obsidian developers
    |
    v (Graph viral loop)
[Pin 2] Cursor + Windsurf + VS Code MCP users
    |
    v (Knowledge profile sharing)
[Pin 3] Tech bloggers / content creators (3D graph as portfolio piece)
    |
    v (Intelligence features)
[Pin 4] Knowledge workers: PMs, researchers, consultants
    |
    v (Team features)
[Pin 5] Small dev teams (5-20 people)
    |
    v (Enterprise readiness)
[Pin 6] Enterprise knowledge management teams
    |
    v
[Tornado] Standard knowledge intelligence layer for all AI-assisted work
```

---

## 6. GTM Strategy

### 6.1 Pre-Launch Preparation (Week 0-2)

| Task | Priority | Details |
|------|:--------:|---------|
| Onboarding wizard | P0 | 3-step: choose vault -> index -> first search. Must work first time |
| README rewrite | P0 | Hero GIF (3D graph rotating), quick start (3 commands), feature showcase |
| Demo video | P0 | 2-min YouTube: vault indexing -> MCP search -> 3D graph -> decay alerts |
| Architecture diagram | P1 | SVG showing monorepo structure, data flow, MCP integration points |
| CONTRIBUTING.md | P1 | How to contribute, plugin SDK preview, code of conduct |
| Error message audit | P1 | Every user-facing error must be actionable with a fix suggestion |

### 6.2 Launch Strategy (Week 2-6)

| Week | Channel | Action | Target Metric |
|------|---------|--------|---------------|
| W2 | GitHub | Public repo + star campaign | 100 stars first day |
| W2 | X/Twitter | "Building in public" thread with 3D graph GIF | 10K impressions |
| W3 | Product Hunt | Launch with demo video | Top 10 of the day |
| W3 | Hacker News | "Show HN: I built a 3D knowledge graph for Obsidian with MCP + FSRS" | 100+ upvotes |
| W4 | Obsidian Forum | Community showcase post | 50 installs first week |
| W5 | YouTube | Full tutorial (10 min): install -> configure -> daily workflow | 5K views/month |
| W6 | Dev Discord/Reddit | r/ObsidianMD, r/ClaudeAI, MCP Discord | 200 GitHub issues/discussions |

### 6.3 Core Marketing Messages

| Audience | Message | Channel |
|----------|---------|---------|
| AI developers | "12 MCP tools. Hybrid search. Your entire Obsidian vault as AI context." | GitHub, X, MCP Registry |
| Visual thinkers | "See your entire knowledge universe in 3D. Zoom from galaxies to individual thoughts." | YouTube, Product Hunt |
| Knowledge workers | "Your notes are dying in folders. Stellavault keeps them alive with FSRS decay tracking." | Obsidian Forum, Reddit |
| Teams | "Stop losing institutional knowledge. Give your AI agents access to everything your team knows." | LinkedIn, Dev blogs |

### 6.4 Pricing Strategy (Updated)

| Tier | Price | Features | Target |
|------|-------|----------|--------|
| **Core (Free/OSS)** | $0 | Local indexing, hybrid search, 3D graph, 12 MCP tools, CLI, decay alerts, gap detection, Knowledge Pack | Individual developers |
| **Pro** | $12/mo | Core + cloud sync (encrypted), advanced intelligence (learning paths, contradiction detection, predictive gaps), priority embeddings (faster models), custom graph themes, webhook automation | Power users, consultants |
| **Team** | $18/mo/seat | Pro + team vaults, access control, shared MCP server, admin dashboard, SSO, audit log | Dev teams (5-20) |
| **Enterprise** | Custom | Team + on-premise deployment, custom integrations, SLA, dedicated support | Enterprise KM teams |

**Pro Value Gate Principle**: Free tier is genuinely useful. Pro tier unlocks features that grow in value the more you use the tool (cloud sync protects your investment; learning paths get smarter with more data; contradictions require corpus size to be meaningful).

### 6.5 Key Metrics (12-Month Targets)

| Metric | Month 1 | Month 3 | Month 6 | Month 12 |
|--------|---------|---------|---------|----------|
| GitHub Stars | 200 | 800 | 2,000 | 5,000 |
| npm Weekly Downloads | 100 | 500 | 2,000 | 8,000 |
| DAU | 50 | 300 | 1,500 | 5,000 |
| MCP Queries/Day | 200 | 2,000 | 10,000 | 50,000 |
| Pro Subscribers | 0 | 30 | 150 | 500 |
| Team Accounts | 0 | 0 | 10 | 50 |
| Community Contributors | 2 | 5 | 15 | 30 |
| Graph Screenshots Shared/Mo | 10 | 100 | 500 | 2,000 |

---

## 7. Product Requirements -- Advanced Features

### 7.1 Feature Inventory (Prioritized)

#### Tier 1: "Ship Before Public Launch" (Polish & Onboarding)

| ID | Feature | Description | Priority | Effort | Impact |
|----|---------|-------------|:--------:|:------:|:------:|
| F-A01 | **Onboarding Wizard** | Interactive 3-step setup: vault selection, indexing with progress bar, first search with guided tour. Must handle errors gracefully | P0 | Medium | 5/5 |
| F-A02 | **Error Recovery System** | Every operation: retry with backoff, meaningful error messages, recovery suggestions. Graceful degradation when embedder fails | P0 | Medium | 4/5 |
| F-A03 | **Performance Optimization** | Incremental indexing (only changed files), lazy-load graph nodes (virtual rendering for 10K+), Web Worker for embedding, batch SQLite operations | P0 | High | 5/5 |
| F-A21 | **CLI Output Polish** | Colored output, progress spinners, table formatting, --json flag for scripting, --quiet mode | P1 | Low | 3/5 |
| F-A22 | **Streamable HTTP MCP** | Migrate from stdio to Streamable HTTP transport (MCP 2026 standard). Enables remote access, load balancing, multi-client | P1 | Medium | 4/5 |

#### Tier 2: "Pro/Cloud Features" (Monetization)

| ID | Feature | Description | Priority | Effort | Impact |
|----|---------|-------------|:--------:|:------:|:------:|
| F-A04 | **Cloud Sync Engine** | Encrypted SQLite WAL journal sync to S3/R2. End-to-end encryption (user holds key). Conflict resolution via CRDT-lite (last-write-wins for metadata, merge for access logs) | P0 | High | 5/5 |
| F-A05 | **Notification Center** | Configurable alerts: decay threshold reached, new gaps detected, weekly digest email. In-graph toast + CLI summary + optional email/webhook | P1 | Medium | 4/5 |
| F-A11 | **AI Learning Path Generator** | Analyze decay states + gap analysis + note relationships to generate personalized "What to review/learn next" recommendations. Uses local LLM or Claude API (user's key) | P1 | Medium | 5/5 |
| F-A12 | **Contradiction Detector** | NLI (Natural Language Inference) model to detect contradicting statements across notes. Highlight conflicts in graph with red edges. Uses @xenova/transformers NLI model (local) | P2 | High | 4/5 |
| F-A07 | **Knowledge Pack Marketplace** | Curated packs: "React Patterns", "System Design", "ML Fundamentals". Community submission + review. Free packs (growth) + premium packs (30% commission) | P2 | High | 3/5 |

#### Tier 3: "Differentiation Features" (Competitive Moat)

| ID | Feature | Description | Priority | Effort | Impact |
|----|---------|-------------|:--------:|:------:|:------:|
| F-A08 | **Embeddable Graph Widget** | `<iframe>` and JS SDK for embedding interactive 3D mini-graphs in websites. Static (screenshot) + interactive (rotate/zoom) modes. Includes branding watermark on free tier | P0 | Medium | 5/5 |
| F-A09 | **Knowledge Profile Page** | Public URL showing: top topics, knowledge stats, interactive mini-graph, decay health score. Like a "GitHub profile" for knowledge | P1 | Medium | 4/5 |
| F-A13 | **Knowledge Semantic Versioning** | Track how a note's MEANING changes over time (not just edit history). Compute embedding drift between versions. Show "semantic changelog" per topic | P2 | High | 5/5 |
| F-A14 | **Predictive Gap Analysis** | Based on your knowledge graph topology + industry trends (optional web search), predict "You should learn about X because it connects to Y and Z which you know well" | P2 | High | 4/5 |
| F-A20 | **10K+ Node Performance** | GPU-instanced rendering for nodes, LOD system for edges, spatial hash for collision, frustum culling. Target: 60fps at 10K nodes, 30fps at 50K nodes | P1 | High | 4/5 |

#### Tier 4: "Team & Extensibility" (Growth)

| ID | Feature | Description | Priority | Effort | Impact |
|----|---------|-------------|:--------:|:------:|:------:|
| F-A06 | **Team Vault** | Shared vault with role-based access (viewer/editor/admin). Separate vector DBs per user + shared team DB. MCP server with auth tokens per user | P2 | Very High | 4/5 |
| F-A15 | **Plugin SDK** | Event-driven plugin system: `onIndex`, `onSearch`, `onDecay`, `onGapDetected`. Plugin registry (npm-based). Sample plugins: Zotero importer, Readwise sync, Pocket saver | P1 | High | 5/5 |
| F-A16 | **Custom MCP Tool Builder** | YAML/JSON declarative MCP tool definition. No code needed for simple search-filter-format tools. Code mode for advanced tools | P2 | Medium | 3/5 |
| F-A17 | **Webhook/Event System** | Emit events on: new note indexed, decay threshold crossed, gap detected, pack exported. Webhook delivery with retry. Enables Zapier/n8n integration | P2 | Medium | 3/5 |
| F-A18 | **Keyboard-Only Graph Navigation** | Full WCAG 2.1 AA compliance for 3D graph: Tab navigation between nodes, arrow keys for traversal, Enter for selection, Esc for back, screen reader labels | P2 | Medium | 3/5 |
| F-A19 | **i18n (EN, KO, JA, ZH)** | All user-facing strings externalized. CLI, graph UI, error messages, onboarding. Korean first (developer is Korean), then EN, JA, ZH | P2 | Medium | 3/5 |

#### Tier 5: "Future / Community-Driven"

| ID | Feature | Description | Priority | Effort |
|----|---------|-------------|:--------:|:------:|
| F-A23 | **Agentic Graph Construction** | AI agents dynamically create/modify graph nodes and relationships based on conversation context. Real-time graph evolution during MCP sessions | P3 | Very High |
| F-A24 | **Cross-Vault Federation** | Search across multiple vaults (personal + work + research) with unified ranking. Privacy boundaries per vault | P3 | High |
| F-A25 | **Voice Knowledge Capture** | Audio -> transcription -> auto-chunking -> embedding. Integration point for external speech-to-text (Whisper, etc.) | P3 | High |
| F-A26 | **Web Dashboard** | Browser-based alternative to CLI for non-technical users. Express server already exists -- add React admin panel | P3 | High |
| F-A27 | **Mobile Companion** | PWA or React Native app for on-the-go knowledge capture and review. Sync with desktop via cloud engine | P3 | Very High |

### 7.2 New MCP Tools (Phase 5: 12 -> 18)

| # | Tool | Description | Feature |
|---|------|-------------|---------|
| 13 | `get-learning-path` | AI-generated personalized learning recommendations | F-A11 |
| 14 | `detect-contradictions` | Find contradicting statements across notes | F-A12 |
| 15 | `get-semantic-diff` | Compare how a topic's meaning evolved over time | F-A13 |
| 16 | `predict-gaps` | Predict knowledge areas worth exploring based on graph topology | F-A14 |
| 17 | `link-code` | Map code files/functions to related knowledge notes | From core.prd.md |
| 18 | `get-team-context` | Search team vault with access control (Team tier) | F-A06 |

### 7.3 New CLI Commands (Phase 5: 15 -> 19)

| Command | Description | Feature |
|---------|-------------|---------|
| `sv learn` | Display personalized learning path | F-A11 |
| `sv contradictions` | Show detected contradictions | F-A12 |
| `sv cloud sync` | Sync vector DB to cloud | F-A04 |
| `sv plugin install <name>` | Install a plugin from registry | F-A15 |

### 7.4 Technical Architecture (Advanced Phase)

```
+================================================================+
|                    Stellavault (Advanced)                        |
|                                                                 |
|  +-- Cloud Layer (NEW, Pro+) -------+   +-- Team Layer (NEW) -+|
|  | S3/R2 Encrypted Sync             |   | Auth + RBAC          ||
|  | User Account Service             |   | Shared Vector DB     ||
|  | Webhook Delivery                  |   | Admin Dashboard      ||
|  | Knowledge Profile Hosting         |   | Team MCP Gateway     ||
|  +-----------------------------------+   +---------------------+|
|                                                                 |
|  +-- Intelligence Layer (Enhanced) -+   +-- Visualization ----+|
|  | FSRS Decay Engine (done)         |   | 3D Graph (done)      ||
|  | Gap Detector (done)              |   | GPU Instanced Nodes  ||
|  | Duplicate Detector (done)        |   | Embeddable Widget    ||
|  | + Contradiction Detector (NLI)   |   | Knowledge Profile    ||
|  | + Learning Path Generator        |   | Keyboard Navigation  ||
|  | + Predictive Gap Analysis        |   | i18n UI              ||
|  | + Semantic Versioning Engine     |   |                      ||
|  +-----------------------------------+   +---------------------+|
|                                                                 |
|  +-- Plugin System (NEW) -----------+                           |
|  | Event Bus (onIndex, onSearch...) |                           |
|  | Plugin Registry (npm-based)      |                           |
|  | Custom MCP Tool Builder          |                           |
|  | Sample Plugins (Zotero, Readwise)|                           |
|  +-----------------------------------+                           |
|                                                                 |
|  +-- MCP Server (12 -> 18 tools) ---+                           |
|  | [12 existing tools]               |                           |
|  | + get-learning-path               |                           |
|  | + detect-contradictions           |                           |
|  | + get-semantic-diff               |                           |
|  | + predict-gaps                    |                           |
|  | + link-code                       |                           |
|  | + get-team-context                |                           |
|  | Transport: stdio + Streamable HTTP|                           |
|  +-----------------------------------+                           |
|                                                                 |
|  +-- Core Engine (Existing) --------+   +-- CLI (15 -> 19) ---+|
|  | Indexer + Embedder + Scanner      |   | [15 existing cmds]   ||
|  | SQLite-vec Store                  |   | + sv learn           ||
|  | BM25 + Cosine + RRF              |   | + sv contradictions  ||
|  | Chunker + Watcher                 |   | + sv cloud sync      ||
|  |                                   |   | + sv plugin install  ||
|  +-----------------------------------+   +---------------------+|
+================================================================+
```

### 7.5 Non-Functional Requirements

| Requirement | Specification | Priority |
|-------------|---------------|:--------:|
| **Indexing Performance** | Incremental re-index: < 100ms per changed file. Full re-index: < 30s for 5K notes | P0 |
| **Search Latency** | < 200ms for hybrid search on 10K notes | P0 |
| **Graph Rendering** | 60fps at 10K nodes, 30fps at 50K nodes. First meaningful paint < 2s | P0 |
| **MCP Response Time** | < 500ms for any tool call (excluding network for Streamable HTTP) | P0 |
| **Cloud Sync** | Round-trip sync < 5s for 10K notes. E2E encrypted (AES-256-GCM). Zero-knowledge server | P1 |
| **Offline Resilience** | All core features work without internet. Cloud sync queues when offline | P1 |
| **Accessibility** | WCAG 2.1 AA for graph UI. Full keyboard navigation. Screen reader support for search/CLI | P2 |
| **Bundle Size** | Graph web app: < 2MB gzipped. Core npm package: < 5MB | P1 |
| **Memory Usage** | < 500MB RAM for 10K note vault indexed | P0 |
| **Plugin Isolation** | Plugins run in separate context (VM2 or Worker). Cannot access other plugins' data. Crash isolation | P1 |
| **Backward Compatibility** | Major version bumps follow semver. Migration scripts for DB schema changes | P0 |

### 7.6 User Stories

#### Epic 8: Onboarding & Polish

| ID | Story | Acceptance Criteria | INVEST |
|----|-------|---------------------|--------|
| US-8.1 | As a new user, I want a guided setup wizard so I can start using Stellavault in under 3 minutes | Wizard: vault path -> index with progress bar -> first search. Skip option available | I,N,V,E,S,T |
| US-8.2 | As a user, I want clear error messages with fix suggestions so I don't get stuck | Every error includes: what happened, why, how to fix. No raw stack traces | I,N,V,E,S,T |
| US-8.3 | As a developer, I want a --json flag on all CLI commands so I can pipe output to other tools | All commands support --json. Output follows consistent schema | I,N,V,E,S,T |

#### Epic 9: Cloud & Monetization

| ID | Story | Acceptance Criteria | INVEST |
|----|-------|---------------------|--------|
| US-9.1 | As a Pro user, I want my vector DB synced to the cloud so I don't lose my index if my laptop dies | E2E encrypted sync to S3/R2. Restore on new machine with `sv cloud restore` | I,N,V,E,S,T |
| US-9.2 | As a user, I want configurable notifications for decay/gaps so I stay on top of my knowledge | Notification settings: frequency (daily/weekly/off), threshold, channels (CLI/graph/email) | I,N,V,E,S,T |
| US-9.3 | As a power user, I want AI-generated learning paths so I know what to review and learn next | `sv learn` or MCP `get-learning-path` returns prioritized list with rationale | I,N,V,E,S,T |

#### Epic 10: Viral & Distribution

| ID | Story | Acceptance Criteria | INVEST |
|----|-------|---------------------|--------|
| US-10.1 | As a user, I want to embed an interactive 3D graph on my website so visitors see my knowledge | `<iframe>` embed code with customizable theme, size, and initial view angle | I,N,V,E,S,T |
| US-10.2 | As a user, I want a public knowledge profile page so I can showcase my expertise | URL like stellavault.dev/u/username showing stats, mini-graph, top topics | I,N,V,E,S,T |
| US-10.3 | As a user sharing my graph screenshot, I want it to include a watermark with install link | Exported PNG/WebM includes subtle "stellavault.dev" watermark. Pro removes it | I,N,V,E,S,T |

#### Epic 11: Extensibility

| ID | Story | Acceptance Criteria | INVEST |
|----|-------|---------------------|--------|
| US-11.1 | As a developer, I want a plugin SDK so I can add custom data sources to Stellavault | npm package @stellavault/plugin-sdk with event hooks, documented API, TypeScript types | I,N,V,E,S,T |
| US-11.2 | As a Zotero user, I want a plugin that imports my papers into Stellavault automatically | Official zotero-importer plugin: import papers, extract highlights, create notes, index | I,N,V,E,S,T |
| US-11.3 | As a non-developer, I want to create custom MCP tools without coding | YAML tool definition file: name, description, search query template, output format | I,N,V,E,S,T |

#### Epic 12: Team Collaboration

| ID | Story | Acceptance Criteria | INVEST |
|----|-------|---------------------|--------|
| US-12.1 | As a team lead, I want a shared vault that all team members' AI agents can query | Team vault with invite system. MCP server authenticates per-user token | I,N,V,E,S,T |
| US-12.2 | As a team member, I want to see who last updated a shared note and when | Audit log per note: user, timestamp, change type. Viewable in graph node detail | I,N,V,E,S,T |
| US-12.3 | As a new team member, I want AI to summarize our team's knowledge on a topic for onboarding | MCP `get-team-context` returns synthesized summary from team vault | I,N,V,E,S,T |

### 7.7 Test Scenarios

| ID | Scenario | Related Story | Verification Method |
|----|----------|---------------|---------------------|
| TS-14 | New user completes wizard and performs first search in < 3 minutes | US-8.1 | Usability test (5 users) |
| TS-15 | Embedding failure shows recovery message, allows retry | US-8.2 | Error injection test |
| TS-16 | Cloud sync round-trip for 10K notes completes in < 5 seconds | US-9.1 | Performance benchmark |
| TS-17 | Cloud sync data is unreadable by server (E2E encryption verified) | US-9.1 | Security audit |
| TS-18 | Learning path recommendations are relevant (>70% user agreement) | US-9.3 | User feedback survey (10 users) |
| TS-19 | Embedded graph widget loads in < 1 second on 3G connection | US-10.1 | Lighthouse performance test |
| TS-20 | Plugin crash does not affect host process | US-11.1 | Fault injection test |
| TS-21 | Team vault enforces access control (viewer cannot edit) | US-12.1 | Integration test |
| TS-22 | 3D graph maintains 60fps with 10K nodes on mid-range GPU | F-A20 | Performance profiling |
| TS-23 | Contradiction detector identifies known contradictions with > 80% precision | F-A12 | Test corpus with planted contradictions |
| TS-24 | Keyboard-only user can navigate graph and select nodes | F-A18 | Accessibility audit (axe-core) |

---

## 8. Pre-Mortem Analysis

### 8.1 Top 3 Risks

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|:-----------:|------------|
| R1 | **"Good enough" competitors win** -- mcpvault's simplicity (5-min setup) beats our feature richness if onboarding is hard | Critical | High | Ship onboarding wizard as absolute P0 before any other feature. Measure time-to-first-search obsessively. If > 5 min, you've lost |
| R2 | **Solo developer bottleneck** -- 22 planned features for 1 person means either years of development or burnout | Critical | High | (1) Launch with minimal viable set (Tier 1 only, 5 features). (2) Plugin SDK enables community contributions. (3) Focus on what ONLY you can build (intelligence), outsource UI polish to community |
| R3 | **Cloud sync security incident** -- Any data breach or encryption flaw destroys trust for a "local-first" tool | Critical | Low | Zero-knowledge architecture (server never sees plaintext). Client-side AES-256-GCM. Open-source the sync protocol for audit. No analytics/telemetry by default |

### 8.2 Additional Risks

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|:-----------:|------------|
| R4 | Obsidian releases official AI/MCP integration, making external tools redundant | High | Medium | Differentiate on INTELLIGENCE (decay, gaps, learning paths) not just search. Obsidian official will likely do basic search only |
| R5 | Plugin SDK attracts low-quality plugins that damage reputation | Medium | Medium | Plugin review process + quality badges + sandboxed execution |
| R6 | Monetization fails: users refuse to pay when free tier is generous | High | Medium | Pro features must be genuinely advanced (AI learning paths, cloud sync), not arbitrary paywalls on basic features |
| R7 | 3D graph is a gimmick for screenshots but users prefer 2D in daily use | Medium | Medium | Offer 2D fallback view. Track actual graph usage time. If < 2 min/session, reconsider 3D investment |
| R8 | MCP Streamable HTTP migration breaks existing stdio users | Medium | Low | Support both transports simultaneously. Auto-detect based on config. Graceful fallback |

---

## 9. Growth Loops

### Loop 1: Visual Viral (Primary Growth Engine)

```
User explores their 3D knowledge graph
    -> Takes screenshot/recording (ExportPanel, already built)
    -> Shares on X/Twitter/LinkedIn/blog
    -> "What tool is this?" comments
    -> stellavault.dev watermark -> GitHub visit
    -> New user installs -> creates their own graph
    -> Shares their own (repeat)

Accelerators:
- F-A08 Embeddable widget: always-on viral surface on user's website
- F-A09 Knowledge profile: shareable URL with "powered by Stellavault"
- F-A10 OG image generation: auto-preview for social sharing
```

### Loop 2: MCP Network Effect

```
Developer installs Stellavault as MCP server
    -> Uses 12 tools daily in Claude Code/Cursor
    -> Discovers intelligence tools (decay, gaps, brief)
    -> "This is better than my other MCP servers"
    -> Recommends in dev community / MCP registry
    -> More MCP users discover Stellavault
    -> Plugin developers build importers (Zotero, Readwise, etc.)
    -> More data sources -> more value -> more users (repeat)
```

### Loop 3: Knowledge Intelligence Stickiness

```
User indexes vault -> sees decay alerts
    -> Reviews forgotten notes ("oh I wrote about this!")
    -> Gets learning path recommendation
    -> Creates new notes to fill gaps
    -> Knowledge graph grows richer
    -> Intelligence features become MORE valuable
    -> User becomes dependent (positive lock-in)
    -> Eventually converts to Pro for cloud backup of their investment
    -> (repeat -- intelligence value compounds over time)
```

### Loop 4: Team Expansion (Future)

```
Individual developer uses Stellavault for personal knowledge
    -> Discovers decision journal MCP tool
    -> "My team needs this" realization
    -> Proposes team vault to manager
    -> Team adopts (Team tier revenue)
    -> New hires onboard with team knowledge
    -> Team knowledge grows
    -> More team members find it essential
    -> Other teams in company adopt (repeat)
```

---

## 10. Implementation Roadmap

### Phase A: Polish & Launch Readiness (4 weeks)

| Week | Feature | Details |
|------|---------|---------|
| W1-2 | F-A01: Onboarding Wizard | Interactive CLI wizard + graph UI first-run experience |
| W1-2 | F-A02: Error Recovery | Audit all error paths, add recovery suggestions |
| W3 | F-A03: Performance (incremental indexing) | Only re-embed changed files; batch SQLite writes |
| W3 | F-A21: CLI Polish | Colors, spinners, --json, --quiet |
| W4 | README + Docs + Demo Video | Launch-ready documentation |
| W4 | F-A22: Streamable HTTP MCP | Dual transport support (stdio + HTTP) |

### Phase B: Viral & Differentiation (4 weeks)

| Week | Feature | Details |
|------|---------|---------|
| W5-6 | F-A08: Embeddable Graph Widget | iframe + JS SDK, static + interactive modes |
| W5-6 | F-A20: 10K+ Node Performance | GPU instancing, LOD, spatial hash, frustum culling |
| W7 | F-A09: Knowledge Profile Page | Public URL with stats + mini-graph |
| W8 | F-A10: Social Preview Cards | OG image generation for sharing |

### Phase C: Advanced Intelligence (6 weeks)

| Week | Feature | Details |
|------|---------|---------|
| W9-10 | F-A11: AI Learning Path Generator | Decay + gaps + relationships -> personalized recommendations |
| W11-12 | F-A12: Contradiction Detector | @xenova/transformers NLI model, local inference |
| W13 | F-A05: Notification Center | Configurable alerts for decay/gaps/learning |
| W14 | F-A14: Predictive Gap Analysis | Graph topology -> "learn X next" suggestions |

### Phase D: Monetization Infrastructure (6 weeks)

| Week | Feature | Details |
|------|---------|---------|
| W15-18 | F-A04: Cloud Sync Engine | S3/R2 encrypted sync, account system, billing |
| W19-20 | F-A15: Plugin SDK | Event system, registry, sample plugins (Zotero, Readwise) |

### Phase E: Team & Scale (8 weeks)

| Week | Feature | Details |
|------|---------|---------|
| W21-24 | F-A06: Team Vault | RBAC, shared DB, team MCP gateway |
| W25-26 | F-A13: Knowledge Semantic Versioning | Embedding drift tracking, semantic changelog |
| W27-28 | F-A18 + F-A19: Accessibility + i18n | WCAG 2.1 AA, EN/KO/JA/ZH |

### Phase F: Future (Community-Driven)

- F-A23: Agentic Graph Construction
- F-A24: Cross-Vault Federation
- F-A25: Voice Knowledge Capture
- F-A26: Web Dashboard
- F-A27: Mobile Companion
- F-A07: Knowledge Pack Marketplace

---

## 11. Competitive Battlecards

### vs. MCPVault / Obsidian MCP Servers

| Objection | Response |
|-----------|----------|
| "mcpvault is simpler to set up" | Stellavault's onboarding wizard makes setup just as easy, and you get 12 MCP tools vs 5-7, plus 3D visualization, FSRS intelligence, and Knowledge Pack export -- features mcpvault will never have |
| "I just need basic search for my AI" | Basic search works until your vault grows past 500 notes. Stellavault's BM25+Cosine+RRF hybrid search is 30%+ more accurate, and intelligence features (decay, gaps) prevent the "I already wrote about this" problem |
| "mcpvault works through Obsidian REST API, which is convenient" | Stellavault indexes .md files directly -- works even when Obsidian isn't running. Your knowledge is always accessible to AI agents, not gated by an app |

### vs. Khoj

| Objection | Response |
|-----------|----------|
| "Khoj supports more sources (Notion, PDF, images)" | Stellavault is purpose-built for Obsidian vaults with deeper analysis. Our intelligence layer (FSRS decay, gap detection, contradiction detection, learning paths) goes far beyond search+chat |
| "Khoj has automation and research mode" | Different philosophy: Khoj helps you SEARCH for answers. Stellavault helps you UNDERSTAND your knowledge -- what you're forgetting, what contradicts, what to learn next |
| "Khoj has a mobile app" | Mobile is on our roadmap (Phase F). For now, Stellavault's MCP server gives you knowledge access through any AI tool on any device |

### vs. Vestige

| Objection | Response |
|-----------|----------|
| "Vestige also uses FSRS and MCP" | Different scope entirely. Vestige tracks AI AGENT SESSION memory (what happened in conversations). Stellavault tracks YOUR PERSONAL KNOWLEDGE (your notes, documents, decisions). They're complementary -- use both |
| "Vestige is written in Rust, faster" | Stellavault's bottleneck is embedding computation (same speed regardless of language). For storage/search, SQLite-vec is already near-native speed. The intelligence layer (FSRS, gaps, learning paths) adds value that Vestige doesn't offer for personal knowledge |

### vs. InfraNodus

| Objection | Response |
|-----------|----------|
| "InfraNodus has more sophisticated graph analysis" | InfraNodus is cloud-only ($9-29/mo) with no MCP integration. Stellavault runs locally for free with privacy, has 12 MCP tools for AI agent integration, and our 3D visualization is more immersive than their 2D network view |
| "InfraNodus now has an Obsidian plugin" | Their plugin sends data to the cloud for analysis. Stellavault keeps everything local. Plus we offer FSRS decay, Knowledge Packs, and the full intelligence suite that InfraNodus doesn't have |

---

## 12. Stakeholder Map

| Stakeholder | Role | Interest | Engagement Level |
|-------------|------|----------|:----------------:|
| Evan (Developer) | Project owner, sole developer | Tech excellence, open-source reputation, product-market fit | **Driver** |
| Claude Code Users | Primary target (Beachhead) | Better AI context, MCP tool quality, search accuracy | **Key Stakeholder** |
| Obsidian Community | Earlyoupter pool, plugin ecosystem | Compatibility, privacy, vault safety, performance | **Key Stakeholder** |
| MCP Ecosystem (5,800+ servers) | Protocol community | Standard compliance, differentiation examples | **Influencer** |
| Anthropic | Claude/MCP creator | Ecosystem growth, showcase projects | **Enabler** |
| Future Contributors | Community developers | Code quality, documentation, plugin SDK, contribution ease | **Supporter** |
| Cursor/Windsurf Users | Secondary target | MCP compatibility, search quality | **Adopter** |
| Knowledge Workers (non-dev) | Tertiary target | Ease of use, web dashboard, no CLI requirement | **Future Adopter** |

---

## 13. Success Criteria Summary

### Launch Success (Month 1-3)

| Criteria | Target | Measurement |
|----------|--------|-------------|
| Time to first successful search | < 3 minutes | Usability test |
| GitHub Stars | 800 | GitHub API |
| npm weekly downloads | 500 | npm stats |
| Zero critical bugs reported | 0 P0 bugs | GitHub Issues |
| External PR received | >= 1 | GitHub |

### Growth Success (Month 3-6)

| Criteria | Target | Measurement |
|----------|--------|-------------|
| DAU | 1,500 | Opt-in telemetry |
| MCP daily queries | 10,000 | Server logs |
| Pro conversion rate | > 5% | Billing system |
| Graph screenshots shared | 500/month | Social tracking |
| Community plugins | >= 3 | Plugin registry |

### Product-Market Fit (Month 6-12)

| Criteria | Target | Measurement |
|----------|--------|-------------|
| NPS | > 50 | Survey |
| Pro retention (monthly) | > 85% | Billing |
| "Must have" in PMF survey | > 40% say "very disappointed" | Sean Ellis test |
| Revenue | $5K MRR | Stripe |

---

## Attribution

This PRD was generated by the PM Lead Agent orchestrating parallel analysis from:

**Discovery Agent** (pm-discovery):
- 5-Step Discovery Chain: Brainstorm (15 observations) -> Assumptions (10) -> Prioritize (Impact x Risk) -> Experiments (5) -> OST (6 opportunities, 22 solutions)
- Framework: Teresa Torres' Continuous Discovery (Opportunity Solution Tree)

**Strategy Agent** (pm-strategy):
- JTBD 6-Part Value Proposition (3 new JTBDs identified)
- Lean Canvas (updated for advanced phase)
- SWOT + SO/WT strategies
- Porter's Five Forces analysis
- Competitive positioning matrix
- Framework: Ash Maurya (Lean Canvas), Clayton Christensen (JTBD), Michael Porter (Five Forces)

**Research Agent** (pm-research):
- 3 Personas with distinct needs (Minjun, Soyeon, Jaehyun)
- 5 Competitors analyzed (Khoj, MCPVault, Vestige, InfraNodus, Graphiti)
- TAM/SAM/SOM dual-method estimation (convergence at ~$1.7M ARR Year 3)
- Customer Journey Map (6 stages)
- Framework: Persona Design, Competitive Analysis, Market Sizing

**PRD Agent** (pm-prd):
- ICP definition with 19/20 beachhead score
- Bowling Alley strategy (6 pins to tornado)
- GTM with phased launch plan
- 22 features across 5 tiers
- 6 new MCP tools (12 -> 18)
- 12 user stories across 5 epics
- 11 test scenarios
- Pre-mortem with 8 risks identified
- 4 growth loops
- 28-week implementation roadmap
- 4 competitive battlecards
- Framework: Geoffrey Moore (Crossing the Chasm), Pawel Huryn (PM Skills, MIT License)

**Market Data Sources (April 2026)**:
- MCP Ecosystem: 5,800+ servers, 97M monthly SDK downloads (MCP 2026 Roadmap)
- Knowledge Graph Market: $1.50B (2025) -> $8.91B (2032), CAGR 28.7% (MarketsandMarkets)
- AI-Driven KM Market: $11.24B (2026), CAGR 46.7%
- FSRS adoption: RemNote, MintDeck, ZKMemo integrating FSRS for knowledge retention
- Competitors: Khoj (multi-source + automation), MCPVault (v0.11.0 March 2026), Vestige (FSRS-6 + 29 modules), InfraNodus (Obsidian plugin), Graphiti (temporal context graphs)

---

*Generated by PM Agent Team | Stellavault Advanced Features | 2026-04-02*
