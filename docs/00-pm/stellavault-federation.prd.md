# Stellavault Federation Protocol PRD

> **PM Agent Team Analysis** | Generated: 2026-04-02
>
> Comprehensive product analysis for the Stellavault Federation Protocol -- transforming
> isolated personal knowledge vaults into a privacy-preserving distributed cognition network.
>
> Prior analyses: `stellavault-advanced.prd.md` (Advanced Features, 2026-04-02),
> `core.prd.md` (Phase 4+, 2026-03-30)
>
> GitHub: https://github.com/Evanciel/stellavault

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | Stellavault operates as a powerful but isolated knowledge system. Each user's vault is a cognitive island -- they cannot discover relevant knowledge held by others, identify collective blind spots, or leverage the network effect that makes platforms like Wikipedia or Stack Overflow invaluable. The knowledge management market ($23B in 2025) is dominated by centralized platforms (Notion, Confluence) that require users to surrender data ownership. No solution exists that enables collective intelligence while preserving absolute data sovereignty. |
| **Solution** | The Federation Protocol treats each Stellavault instance as a sovereign node that shares only embedding vectors (never raw text) over a P2P network. Nodes perform cross-vault semantic search, network-level gap detection, and knowledge routing -- enabling collective intelligence without compromising privacy. The protocol uses Hyperswarm for P2P connectivity, differential privacy noise on shared embeddings, a Web of Trust reputation system, and integrates with the existing MCP tool ecosystem so AI agents can access the federated network transparently. |
| **Key Features / UX** | `stellavault federate join` to connect to the network; federated semantic search via existing `search` CLI; network gap heatmap in 3D graph; knowledge routing ("Node C knows about X"); trust scoring; contribution incentives (search credits); AI agent federation via 4 new MCP tools (`federated-search`, `network-gaps`, `route-query`, `trust-score`). |
| **Core Value** | "Your knowledge stays yours. The network's intelligence becomes everyone's. Stellavault Federation turns personal vaults into a distributed brain -- where no one reads your notes, but everyone benefits from your understanding." |

---

## Part I: Discovery Analysis

> Framework: Teresa Torres' Opportunity Solution Tree (5-Step Discovery Chain)

### 1. Brainstorm -- Opportunity Space

| # | Opportunity | Description | User Signal |
|---|-------------|-------------|-------------|
| O1 | **Cross-Vault Knowledge Discovery** | Users cannot find relevant knowledge held by others without manually asking or searching external platforms | "I bet someone has already figured this out" -- common developer sentiment |
| O2 | **Collective Blind Spot Detection** | Individual gap detectors miss systemic knowledge gaps across a community | Communities rediscover the same problems repeatedly |
| O3 | **Privacy-Preserving Knowledge Sharing** | Existing sharing requires exposing raw data (GitHub, wikis, forums) | Reluctance to share proprietary research/notes publicly |
| O4 | **AI Agent Network Access** | AI agents are limited to a single user's knowledge base | Claude/GPT answers limited by individual context window |
| O5 | **Decentralized Knowledge Routing** | No way to know "who knows what" without centralized directories | Expert-finding is a $2B enterprise problem |
| O6 | **Community Knowledge Health** | No metrics for collective knowledge coverage, decay, or growth | Open-source communities lack knowledge observability |
| O7 | **Knowledge Marketplace** | No privacy-preserving way to monetize specialized knowledge | Consultants sell time, not knowledge access |

### 2. Assumptions (Riskiest First)

| # | Assumption | Impact | Uncertainty | Risk Score |
|---|-----------|:------:|:-----------:|:----------:|
| A1 | Users will trust embedding-only sharing as "private enough" | 10 | 9 | **90** |
| A2 | Embedding inversion attacks won't reconstruct meaningful text from shared embeddings | 10 | 8 | **80** |
| A3 | P2P connectivity works reliably for desktop apps behind NAT/firewalls | 8 | 8 | **64** |
| A4 | Users have enough motivation to keep their node online | 7 | 8 | **56** |
| A5 | Cross-model embedding compatibility is achievable (different users may use different models) | 9 | 6 | **54** |
| A6 | Network effects kick in before critical mass (~50 nodes) | 8 | 7 | **56** |
| A7 | Latency for federated search is acceptable (<3s for 20-node network) | 7 | 6 | **42** |
| A8 | Trust/reputation system prevents knowledge spam effectively | 8 | 5 | **40** |

### 3. Prioritized Experiments

| # | Assumption | Experiment | Success Metric | Effort |
|---|-----------|------------|----------------|--------|
| E1 | A1 (Privacy Trust) | User survey: "Would you share embedding vectors if guaranteed no text reconstruction?" + technical demo | >70% "yes" from Obsidian power users | Low |
| E2 | A2 (Inversion Risk) | Attempt embedding inversion on all-MiniLM-L6-v2 384-dim vectors with SOTA attack models | <15% ROUGE-L reconstruction score on 300-token chunks | Medium |
| E3 | A3 (P2P Reliability) | Prototype: 5-node Hyperswarm mesh across different ISPs/NATs, measure connectivity success rate | >85% connection success, <5s peer discovery | Medium |
| E4 | A5 (Embedding Compat) | Test cosine similarity alignment across 3 embedding models using projection matrix | >0.8 correlation after alignment | Low |
| E5 | A6 (Network Effect) | Simulate federated search quality vs. node count using synthetic vault data | Search relevance >60% at 10 nodes, >80% at 50 nodes | Medium |

### 4. Opportunity Solution Tree

```
                    VISION: Distributed Cognition Network
                                    |
            +-----------------------+-----------------------+
            |                       |                       |
     [O1] Cross-Vault        [O3] Privacy-         [O5] Knowledge
     Knowledge Discovery     Preserving Sharing     Routing
            |                       |                       |
     +------+------+         +-----+-----+          +-----+-----+
     |             |         |           |          |           |
  Federated    Network    Embedding   Diff.     Trust        Query
  Semantic     Gap        Sharing     Privacy   Graph        Router
  Search       Heatmap    Protocol    Layer     (WoT)        Agent
     |             |         |           |          |           |
  MCP tool:    3D viz    Hyperswarm  Noise      Vouch      MCP tool:
  federated-   overlay   transport   injection  system     route-query
  search                  + sync     + EGuard   + karma
```

### 5. Top 3 Opportunities Selected

1. **O1 + O3: Federated Semantic Search with Privacy Preservation** -- The core feature. Search across vaults without reading anyone's notes. This is the "10x better" moment.
2. **O5: Knowledge Routing** -- "This question is best answered by Node C" creates immediate, tangible value even for passive participants.
3. **O2 + O6: Network Gap Detection** -- Discovering what the *community* doesn't know (not just you) is uniquely powerful and has no equivalent in existing tools.

---

## Part II: Strategy Analysis

### 6. Value Proposition (JTBD 6-Part Framework)

| Part | Content |
|------|---------|
| **1. Customer** | Technical knowledge workers (developers, researchers, PKM enthusiasts) who use Obsidian vaults as their primary knowledge system |
| **2. Job-to-be-Done** | When I encounter a knowledge gap or question, I want to discover if someone in my trusted network has relevant understanding, so I can learn faster without compromising my privacy or theirs |
| **3. Pain (Current)** | Currently I must: (a) search public internet (noisy, generic), (b) ask colleagues directly (high friction, social cost), (c) post on forums (slow, public). All options either sacrifice privacy or quality. |
| **4. Gain (Future)** | With Federation: instant semantic search across trusted vaults, automatic knowledge routing to the most relevant node, community-wide gap visibility, all while my notes never leave my machine |
| **5. Alternative** | Shared wikis (Notion, Confluence) require centralization. Fediverse (Mastodon, Nostr) shares content, not knowledge structure. Academic federated KG research is enterprise-only. Nothing exists for personal vault federation. |
| **6. Differentiation** | Only solution that combines: (a) embedding-only sharing (privacy by design), (b) existing PKM tool integration (Obsidian), (c) AI agent access via MCP, (d) decentralized architecture (no central server), (e) FSRS-aware knowledge health across the network |

### 7. Lean Canvas

| Section | Content |
|---------|---------|
| **Problem** | 1. Knowledge is siloed in individual vaults 2. Sharing requires exposing raw data 3. No way to find "who knows what" in a community 4. AI agents limited to single-user context |
| **Customer Segment** | Primary: Obsidian power users in dev/research communities (est. 200K-500K). Secondary: PKM community organizers, study groups, research labs |
| **Unique Value Proposition** | "Collective intelligence, personal sovereignty. Search everyone's understanding without reading anyone's notes." |
| **Solution** | Embedding-only P2P federation with semantic search, knowledge routing, network gap detection, and MCP integration for AI agents |
| **Channels** | Obsidian community (Discord 100K+), PKM Twitter/X, Hacker News, r/ObsidianMD, dev conferences, Plugin marketplace |
| **Revenue Streams** | 1. Premium relay nodes (hosted, always-on) $5/mo 2. Enterprise federation (private networks) $20/user/mo 3. Knowledge marketplace (pay-per-query for premium vaults) 4. Open core: protocol free, managed infrastructure paid |
| **Cost Structure** | 1. Development (P2P networking, privacy layer, trust system) 2. Bootstrap relay infrastructure 3. Security audits (critical for privacy claims) 4. Community building |
| **Key Metrics** | Active nodes, federated searches/day, avg query latency, privacy incident count (must be 0), node uptime %, trust graph density |
| **Unfair Advantage** | 1. Existing Stellavault codebase (19 CLI, 13+ MCP tools, Plugin SDK) 2. SQLite-vec already stores embeddings locally 3. FSRS decay engine uniquely enables "network knowledge health" 4. MCP integration means AI agents get federation for free |

### 8. SWOT Analysis

| | Helpful | Harmful |
|---|---------|---------|
| **Internal** | **Strengths:** Complete local knowledge platform already built; SQLite-vec embeddings ready for sharing; Plugin SDK enables extension; MCP tools provide AI agent integration; MIT license encourages adoption | **Weaknesses:** Single developer; No P2P networking experience in codebase; all-MiniLM-L6-v2 is 384-dim (smaller than production models); No mobile client; No authentication/identity system yet |
| **External** | **Opportunities:** Obsidian has no federation story; PKM market growing 18% CAGR; Fediverse momentum (Bluesky 40M+, Mastodon 10M+) validates decentralization demand; EU data sovereignty regulations; AI agent ecosystem exploding (MCP standard) | **Threats:** Embedding inversion attacks improving (92% reconstruction on 32-token, ROUGE-L 45-50); Obsidian could build native federation; Large players (Notion, Roam) could add P2P; Hyperswarm/libp2p ecosystem volatility; Users may not understand embedding privacy |

**SO Strategies (Strengths x Opportunities):**
- Leverage existing MCP tools + AI agent boom to position as "the federated knowledge layer for AI"
- Use Plugin SDK to let community build federation extensions rapidly

**WT Strategies (Weaknesses x Threats):**
- Invest in embedding privacy research (differential privacy, EGuard projection) before launch to preempt inversion attacks
- Standardize on a single embedding model for v1 to avoid cross-model compatibility issues
- Build relay infrastructure to compensate for NAT/firewall issues

### 9. Strategic Frameworks

#### 9.1 Porter's Five Forces (Federation Market)

| Force | Intensity | Analysis |
|-------|:---------:|----------|
| **Threat of New Entrants** | Medium | P2P + privacy + PKM intersection is technically complex; but Obsidian/Notion could build federation with massive resource advantage |
| **Supplier Power** | Low | All components are open source (Hyperswarm, embedding models, SQLite) |
| **Buyer Power** | High | Users are technically sophisticated, have alternatives, and demand privacy guarantees before trust |
| **Substitute Threat** | Medium | Centralized alternatives (Notion, shared Git repos, Discord search) are "good enough" for many |
| **Competitive Rivalry** | Low | No direct competitor offers embedding-only P2P knowledge federation for personal vaults |

#### 9.2 Blue Ocean Strategy Canvas

| Factor | Centralized KM (Notion) | Fediverse (Mastodon/Nostr) | Stellavault Federation |
|--------|:------------------------:|:--------------------------:|:----------------------:|
| Data Sovereignty | 2 | 8 | **10** |
| Search Quality | 8 | 3 | **7** |
| Privacy Preservation | 3 | 5 | **9** |
| AI Agent Integration | 5 | 1 | **10** |
| Network Effects | 9 | 6 | **4** (initially) |
| Ease of Use | 9 | 4 | **6** |
| Knowledge Structure | 7 | 2 | **9** |
| Collective Intelligence | 6 | 3 | **8** |

**Blue Ocean Factors (create/raise):** AI Agent Network Access, Embedding-Only Privacy, Knowledge Structure Awareness, Distributed FSRS

---

## Part III: Research Analysis

### 10. User Personas

#### Persona 1: "The Prolific Researcher" -- Dr. Maya Chen

| Attribute | Detail |
|-----------|--------|
| **Role** | Computational biology postdoc, 3 years of Obsidian use |
| **Vault Size** | 2,400 notes, 180 tags, daily journaling |
| **JTBD** | When I'm exploring a new research direction, I want to know if others in my lab/field have relevant knowledge in their vaults, so I can avoid duplicating literature reviews and find unexpected connections |
| **Pain Points** | 1. Spends 3h/week searching for knowledge she suspects someone already has 2. Lab wiki is outdated and nobody maintains it 3. Can't search colleagues' notes without awkward "can you send me your notes on X?" conversations |
| **Behaviors** | Indexes every paper she reads; uses FSRS for spaced review; runs morning brief daily; trusts local-first tools |
| **Federation Value** | Would join a research group federation (5-20 nodes); needs strict privacy (unpublished results); values gap detection for identifying under-researched areas |
| **Quote** | "If I could search my entire lab's collective knowledge without anyone seeing my half-formed ideas, that would change how we collaborate." |

#### Persona 2: "The Knowledge Architect" -- James Park

| Attribute | Detail |
|-----------|--------|
| **Role** | Senior developer, team lead, 5 years of PKM practice |
| **Vault Size** | 4,100 notes, complex graph with 15K+ links, multiple plugins |
| **JTBD** | When onboarding new team members or solving novel problems, I want to leverage the distributed expertise across my entire team, so decisions are informed by collective experience rather than whoever is loudest in the meeting |
| **Pain Points** | 1. Team knowledge is fragmented across Notion, Slack, individual vaults 2. Onboarding takes 3 months because institutional knowledge is undocumented 3. Same problems get re-solved every 6 months |
| **Behaviors** | Uses Stellavault MCP tools with Claude daily; runs duplicate detector weekly; maintains decision journal; plugins for Jira and GitHub integration |
| **Federation Value** | Would run a team federation (5-15 nodes); wants knowledge routing ("who on the team knows about X?"); needs enterprise-grade trust model |
| **Quote** | "I've been building my personal knowledge graph for 5 years. Imagine if my team could tap into that without me having to write documentation." |

#### Persona 3: "The Community Curator" -- Ava Okonkwo

| Attribute | Detail |
|-----------|--------|
| **Role** | Open-source maintainer, conference speaker, PKM evangelist |
| **Vault Size** | 1,800 notes focused on web development, public-facing knowledge |
| **JTBD** | When I'm building educational content or answering community questions, I want to discover what topics my community collectively understands well and where there are gaps, so I can create the most impactful content |
| **Pain Points** | 1. No visibility into community's collective knowledge landscape 2. Creates content that duplicates what others have already written 3. Community Q&A (Discord, Reddit) is ephemeral and unsearchable |
| **Behaviors** | Publishes subset of vault via Obsidian Publish; active in 3 Discord communities; uses knowledge packs (.sv-pack) to share curated collections |
| **Federation Value** | Would join public interest group federations (50-200 nodes); wants network gap heatmap for content planning; fine with more permissive sharing |
| **Quote** | "I want to see the knowledge map of my entire community -- where we're deep, where we're shallow, and what's missing entirely." |

### 11. Competitive Landscape (5 Competitors)

#### 11.1 Competitor Matrix

| # | Competitor | Category | Data Sharing Model | Privacy | P2P | AI Integration | Knowledge Structure |
|---|-----------|----------|-------------------|:-------:|:---:|:--------------:|:------------------:|
| C1 | **Solid (Inrupt/MIT)** | Decentralized Data | Full data in pods, app-level access control | High | No (server-based pods) | None | Generic (RDF) |
| C2 | **AT Protocol (Bluesky)** | Federated Social | Full content in Personal Data Servers | Medium | No (relay-based) | Minimal | Social graph only |
| C3 | **Nostr** | Decentralized Messaging | Full content to relays | Low-Medium | Relay-based | None | None |
| C4 | **Anytype** | Local-first Knowledge | Synced encrypted objects | High | IPFS-based sync | None | Object graph |
| C5 | **Logseq** | Local-first Knowledge | Git-based sharing (manual) | High (local) | No | Minimal | Page graph |

#### 11.2 Detailed Analysis

**C1: Solid Project (Tim Berners-Lee / Inrupt)**
- *Model:* Users store data in "pods" on servers they control. Apps request access via WebID authentication.
- *Strengths:* W3C standards (RDF, SPARQL), backed by Tim Berners-Lee, enterprise partnerships (BBC, NHS).
- *Weaknesses:* Requires server infrastructure for pods, RDF complexity alienates mainstream developers, no semantic search capability, no embedding/AI integration.
- *Federation Gap:* Shares actual data (not embeddings). Privacy depends on access control, not architectural privacy. No knowledge-specific features.

**C2: AT Protocol (Bluesky)**
- *Model:* Personal Data Servers (PDS) store user data, Relays aggregate, AppViews render. Being standardized at IETF (Jan 2026).
- *Strengths:* Proven at scale (40M+ users), portable identity, algorithmic choice (40K+ feeds), active development.
- *Weaknesses:* Designed for social content, not knowledge. Relay architecture requires significant infrastructure. No semantic search. Full content is shared.
- *Federation Gap:* Content-centric, not knowledge-centric. No embeddings, no gap detection, no FSRS. Identity model (DIDs) is reusable though.

**C3: Nostr Protocol**
- *Model:* Simple relay architecture -- clients publish signed events, relays store and forward. Minimal relay logic.
- *Strengths:* Extreme simplicity, censorship resistant, $10M+ funding (Jack Dorsey), growing ecosystem.
- *Weaknesses:* No semantic understanding, relay spam problem, no knowledge structure, no search quality guarantees.
- *Federation Gap:* Transmits "notes and other stuff" -- raw content, not knowledge representations. Could be used as a transport layer, but would need everything else built on top.

**C4: Anytype**
- *Model:* Local-first with IPFS-based encrypted sync. Object-based (not markdown). Closed source.
- *Strengths:* Smooth UX, strong encryption, IPFS backbone, growing user base.
- *Weaknesses:* Closed ecosystem, no plugin system, no AI/MCP integration, sync is replication not federation, no cross-user search.
- *Federation Gap:* Syncs your data across your devices, doesn't federate across users. No embedding sharing, no collective intelligence features.

**C5: Logseq**
- *Model:* Local markdown/org-mode files. Sharing via Git or manual export. Open source.
- *Strengths:* Open source, strong outliner, active community, Logseq Sync (paid).
- *Weaknesses:* No vector search, no embedding support, no federation protocol, limited AI integration, sync is device-sync not user-federation.
- *Federation Gap:* Pure local tool with no network story. Would need to build everything from scratch.

#### 11.3 Competitive Positioning

```
                    HIGH PRIVACY
                         |
          Stellavault    |    Anytype
          Federation *   |    (sync only)
                         |
    KNOWLEDGE --------+--+--+--------- CONTENT
    STRUCTURED        |     |          UNSTRUCTURED
                      |     |
          Solid       |    Nostr
          (RDF pods)  |    (relay msgs)
                      |
                    LOW PRIVACY
                    
                    AT Protocol
                    (PDS + Relays)
```

Stellavault Federation uniquely occupies the **high privacy + knowledge structured** quadrant.

### 12. Market Sizing

#### 12.1 TAM/SAM/SOM (Dual Method)

**Method 1: Top-Down**

| Level | Calculation | Value |
|-------|-------------|-------|
| **TAM** | Global Knowledge Management Software Market (2026) | $16-26B |
| **SAM** | Personal Knowledge Management segment (~8% of KM market) x Obsidian-compatible users | $1.3-2.1B |
| **SOM** | PKM power users willing to use P2P federation (2% of Obsidian users, est. 2M total) x $60/yr | **$2.4M** (Year 1) |

**Method 2: Bottom-Up**

| Level | Calculation | Value |
|-------|-------------|-------|
| **TAM** | 2M Obsidian users x $120/yr (avg knowledge tool spend) | $240M |
| **SAM** | 500K power users (daily, 1000+ notes) x $120/yr | $60M |
| **SOM** | 2,000 early adopter nodes (Year 1) x $60/yr avg (mix of free/premium) | **$120K** (Year 1) |
| **SOM Y3** | 20,000 nodes x $80/yr avg (network effects, enterprise) | **$1.6M** (Year 3) |

#### 12.2 Realistic Assessment

The honest picture: this is a niche-within-a-niche initially. The real opportunity is not revenue from individual users but becoming infrastructure for AI-powered collective intelligence. If AI agents routinely search federated knowledge networks, the value shifts from "personal productivity tool" to "knowledge infrastructure" -- a much larger market.

### 13. Customer Journey Map (Primary Persona: Dr. Maya Chen)

```
Stage         | Discover              | Evaluate               | Onboard                | Daily Use              | Advocate
--------------|-----------------------|------------------------|------------------------|------------------------|------------------
Action        | Sees "federated       | Reads docs, checks     | `sv federate init`     | Searches across lab    | Recommends to
              | search" in release    | privacy model,         | Creates node identity  | vaults daily.          | colleagues,
              | notes / HN post      | reviews inversion      | Joins lab federation   | Reviews network gaps   | writes blog post,
              |                       | attack research        | (invite link)          | weekly. AI agent       | creates .sv-pack
              |                       |                        |                        | uses federated-search  | for public sharing
--------------|-----------------------|------------------------|------------------------|------------------------|------------------
Touchpoint    | GitHub release,       | Docs site, privacy     | CLI wizard,            | CLI + MCP tools,       | Community Discord,
              | Obsidian Discord,     | whitepaper, community  | peer invitation        | 3D graph with          | conference talk,
              | HN front page         | trust signals          | system                 | network overlay        | Twitter/X thread
--------------|-----------------------|------------------------|------------------------|------------------------|------------------
Emotion       | Curiosity +           | Cautious optimism,     | Slight anxiety         | Delight when finding   | Pride in being
              | excitement            | privacy concerns       | ("is this really       | relevant knowledge     | early adopter,
              |                       |                        | safe?")                | from peer vault        | missionary zeal
--------------|-----------------------|------------------------|------------------------|------------------------|------------------
Pain Point    | "Is this real or      | "Can embeddings be     | "Setup seems           | "Latency is higher     | "Hard to explain
              | vaporware?"           | reversed?"             | complex"               | than local search"     | embedding privacy
              |                       |                        |                        |                        | to non-technical"
--------------|-----------------------|------------------------|------------------------|------------------------|------------------
Opportunity   | Clear demo video,     | Privacy whitepaper     | One-command join,      | <2s federated search,  | Explainer video,
              | comparison table      | with attack test       | sensible defaults,     | progressive loading,   | shareable privacy
              |                       | results                | trust wizard           | clear source labels    | audit report
```

---

## Part IV: Go-To-Market Strategy

### 14. Ideal Customer Profile (ICP)

| Attribute | Specification |
|-----------|---------------|
| **Role** | Developer, researcher, or knowledge worker who uses Obsidian daily |
| **Vault Maturity** | 500+ notes, 6+ months of active use |
| **Technical Comfort** | Runs CLI tools, understands basic networking concepts |
| **Privacy Stance** | Values data sovereignty, skeptical of cloud-first solutions |
| **Community** | Active in at least one knowledge-sharing community (Discord, Slack, research lab) |
| **Pain Intensity** | Has searched for knowledge they suspect someone else already has at least 3x/month |
| **Tool Spend** | Currently pays for Obsidian Sync ($4/mo) or similar; willing to pay $5-10/mo for federation |

### 15. Beachhead Segment

| Criterion | Score (1-10) | Rationale |
|-----------|:------------:|-----------|
| **Urgency** | 8 | Developer teams using Claude Code + Obsidian feel the "isolated vault" pain daily |
| **Accessibility** | 9 | Already users of Stellavault or Obsidian + CLI tools; reachable via existing channels |
| **Willingness to Pay** | 6 | Developers pay for tools but expect open source core; premium relay/enterprise has WTP |
| **Word of Mouth** | 9 | Developers are the most prolific tech evangelists; PKM community is vocal and connected |

**Selected Beachhead:** Claude Code + Obsidian developers who use MCP tools daily.

**Why:** They already use Stellavault's MCP integration. Adding `federated-search` to their existing AI workflow requires zero behavior change. The AI agent becomes the primary consumer of federation, making adoption frictionless -- the human doesn't even need to think about federation; their AI agent just gets smarter answers.

### 16. GTM Strategy

#### 16.1 Launch Phases

| Phase | Timeline | Action | Success Metric |
|-------|----------|--------|----------------|
| **Alpha** | Month 1-2 | 5-10 hand-picked nodes (developer friends, lab members). CLI only. Direct feedback loop. | 5+ active nodes, <3s federated search, 0 privacy incidents |
| **Beta** | Month 3-4 | Open to Obsidian Discord community. Invite-only federation groups. Privacy whitepaper published. | 50+ nodes, 3+ federation groups, community feedback integrated |
| **Public** | Month 5-6 | General release. Hosted relay option. Enterprise private federation offering. HN/ProductHunt launch. | 200+ nodes, $500+ MRR from premium relays, press coverage |
| **Growth** | Month 7-12 | Plugin marketplace for federation extensions. Knowledge marketplace experiment. Partnership with Obsidian team. | 1000+ nodes, $2K+ MRR, ecosystem emerging |

#### 16.2 Channels

| Channel | Strategy | Expected Impact |
|---------|----------|-----------------|
| **Obsidian Discord** (100K+ members) | Announce in #plugins, demo video, AMA | High -- direct access to ICP |
| **Hacker News** | "Show HN: P2P knowledge federation that shares embeddings, not notes" | High -- viral potential for technical audience |
| **r/ObsidianMD** (200K+) | Tutorial posts, comparison with alternatives | Medium |
| **Dev Twitter/X** | Thread on embedding privacy, demo clips | Medium |
| **Conference talks** | PKM Summit, local meetups, Obsidian community events | Low (slow) but high trust |
| **MCP Directory** | List federated-search tools in MCP tool registries | Medium -- reaches AI agent users |

### 17. Battlecards

#### 17.1 vs. Shared Notion Workspace

| Dimension | Notion | Stellavault Federation |
|-----------|--------|----------------------|
| Privacy | Data on Notion servers, accessible to Notion employees | Embeddings only shared, raw text never leaves device |
| Ownership | Notion owns the platform, can change terms | User owns data, protocol is open |
| AI Integration | Notion AI (proprietary, limited) | MCP tools (open, works with any AI) |
| Offline | Limited offline mode | Full offline, federation is additive |
| Cost | $8-15/user/mo | Free core, $5/mo premium relay |
| **When we win** | Privacy-conscious teams, open-source communities, researchers |
| **When they win** | Enterprise teams needing real-time collaboration, non-technical users |

#### 17.2 vs. Self-Hosted Wiki (MediaWiki, BookStack)

| Dimension | Self-Hosted Wiki | Stellavault Federation |
|-----------|-----------------|----------------------|
| Content Model | Full text shared, everyone reads everything | Embeddings only, semantic similarity without content access |
| Maintenance | Server admin required, updates, backups | Zero infrastructure (P2P), each node self-manages |
| Search | Keyword-based | Semantic + hybrid (BM25 + cosine + RRF) |
| Knowledge Health | None | FSRS decay tracking, gap detection, network health metrics |
| **When we win** | Teams who want searchability without full content exposure |
| **When they win** | Teams who need full content collaboration and editing |

### 18. Growth Loops

```
+----> User A indexes vault
|             |
|      Joins federation
|             |
|      AI agent finds answers from Node B
|             |
|      User A experiences "wow, the network knows!"
|             |
|      Shares experience (Twitter, Discord)
|             |
|      User C sees testimonial, indexes their vault
|             |
+------<------+

Secondary loop:
+----> More nodes = better search quality
|             |
|      Better search = more AI agent value
|             |
|      More AI value = more users adopt MCP tools
|             |
|      More MCP users = more federation nodes
|             |
+------<------+
```

---

## Part V: PRD -- Federation Protocol Specification

### 19. Protocol Architecture

#### 19.1 System Overview

```
+------------------+     Embedding Exchange      +------------------+
|  Stellavault     |  <========================> |  Stellavault     |
|  Node A          |     (Hyperswarm P2P)        |  Node B          |
|                  |                              |                  |
|  [SQLite-vec]    |     Query + Results          |  [SQLite-vec]    |
|  [FSRS Engine]   |  <========================> |  [FSRS Engine]   |
|  [MCP Server]    |     (Protobuf over Noise)    |  [MCP Server]    |
|  [Plugin SDK]    |                              |  [Plugin SDK]    |
+--------+---------+     Trust Attestations       +--------+---------+
         |            <========================>           |
         |                                                 |
    [AI Agent]                                        [AI Agent]
    (Claude/GPT)                                      (Claude/GPT)
         |                                                 |
    Uses MCP tools:                                   Uses MCP tools:
    - federated-search                                - federated-search
    - network-gaps                                    - route-query
    - route-query                                     - trust-score
    - trust-score
```

#### 19.2 Protocol Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Transport** | Hyperswarm (Kademlia DHT + NAT hole-punching) | P2P connectivity, peer discovery |
| **Encryption** | Noise Protocol (via Hyperswarm) | End-to-end encryption for all communication |
| **Serialization** | Protocol Buffers (protobuf) | Efficient binary encoding for embeddings and queries |
| **Identity** | Ed25519 keypairs + optional DID:key | Node identity and message signing |
| **Privacy** | Differential privacy (Gaussian noise) + optional EGuard projection | Embedding perturbation before sharing |
| **Trust** | Web of Trust (vouch + karma) | Reputation management, Sybil resistance |
| **Application** | Stellavault Federation Protocol (SFP) | Semantic search, gap detection, knowledge routing |
| **Integration** | MCP Tools + Plugin Events | AI agent access + extensibility |

### 20. P2P Protocol: Hyperswarm

#### 20.1 Why Hyperswarm (not libp2p or WebRTC)

| Criterion | Hyperswarm | libp2p | WebRTC Direct |
|-----------|:----------:|:------:|:-------------:|
| NAT Hole-Punching | Built-in, battle-tested | Added later, less reliable | Requires STUN/TURN |
| Desktop-Native | Yes (Node.js first) | Yes (multi-language) | Browser-first |
| Complexity | Low (~500 LOC to integrate) | High (modular, many deps) | Medium |
| DHT Peer Discovery | Built-in Kademlia | Built-in but heavier | None (needs signaling) |
| Connection Speed | <5s typical | 5-15s typical | 2-10s + STUN overhead |
| Stream Multiplexing | Via Hypercore Protocol | Via yamux/mplex | Via data channels |
| Ecosystem Fit | Hypercore (perfect for append-only logs) | IPFS (content-addressed) | None |
| Maturity | 7+ years, Dat/Hypercore ecosystem | 10+ years, IPFS ecosystem | 15+ years, ubiquitous |

**Decision:** Hyperswarm wins on simplicity, NAT handling, and desktop-native fit. Stellavault is a Node.js CLI/desktop tool -- Hyperswarm is purpose-built for this. libp2p's browser-first optimizations and modular complexity are unnecessary overhead.

**Fallback:** If Hyperswarm becomes unmaintained, the transport layer is abstracted behind a `FederationTransport` interface, allowing migration to libp2p.

#### 20.2 Network Topology

```
                 [Bootstrap DHT Nodes]
                   (3-5 always-on)
                  /       |        \
                 /        |         \
           [Node A]---[Node B]---[Node C]
               \         |         /
                \        |        /
                 [Node D]---[Node E]
                       |
                    [Node F]
                  (premium relay)
```

- **Bootstrap nodes:** Minimal always-on DHT nodes for initial peer discovery. Do NOT store data. Can be community-run.
- **Regular nodes:** User's Stellavault instances. Come and go. Share embeddings when online.
- **Premium relays:** Optional always-on nodes that cache embedding indices for offline nodes ($5/mo service).

#### 20.3 Connection Flow

```
1. Node A starts Stellavault with federation enabled
2. Node A announces to DHT: "I'm part of federation-group:<topic-hash>"
3. DHT returns peers who announced the same topic
4. Node A connects to peers via Noise-encrypted TCP (hole-punched)
5. Handshake: exchange node identity (Ed25519 pubkey), capabilities, embedding model info
6. Mutual authentication: verify signatures, check trust score
7. Ready for queries
```

### 21. Embedding Sharing Protocol

#### 21.1 What Gets Shared (and What Doesn't)

| Shared | NOT Shared |
|--------|-----------|
| Embedding vectors (384-dim float32, DP-perturbed) | Raw text content |
| Document metadata: title, topic tags, word count | Full document body |
| FSRS retrievability scores (aggregate) | Personal annotations, highlights |
| Knowledge gap regions (cluster centroids) | File paths, folder structure |
| Timestamp of last update | Edit history |
| Node capability declaration | User identity details |

#### 21.2 Embedding Sync Protocol

```protobuf
// stellavault-federation.proto

syntax = "proto3";

package stellavault.federation;

// Node announces its embedding catalogue
message EmbeddingCatalogue {
  string node_id = 1;           // Ed25519 public key (hex)
  uint64 version = 2;           // Monotonic version counter
  uint32 embedding_dim = 3;     // e.g., 384 for all-MiniLM-L6-v2
  string embedding_model = 4;   // Model identifier for compatibility
  uint32 document_count = 5;    // Total documents in vault
  repeated TopicSummary topics = 6;
  bytes signature = 7;          // Ed25519 signature over fields 1-6
}

message TopicSummary {
  string topic = 1;             // Topic tag
  uint32 count = 2;             // Documents in this topic
  repeated float centroid = 3;  // Cluster centroid (DP-perturbed)
  float avg_retrievability = 4; // FSRS average for this topic
}

// Federated search query
message SearchQuery {
  string query_id = 1;          // UUID
  string requester_id = 2;      // Node ID
  repeated float query_embedding = 3;  // Query vector (384-dim)
  uint32 limit = 4;             // Max results per node
  float min_similarity = 5;     // Threshold (default 0.5)
  repeated string topic_filter = 6;    // Optional topic filter
  uint32 hop_limit = 7;         // Max forwarding hops (default 2)
  bytes signature = 8;
}

// Search result from a remote node
message SearchResult {
  string query_id = 1;
  string responder_id = 2;
  repeated ScoredDocument documents = 3;
  uint32 total_searched = 4;    // How many docs were searched
  uint64 latency_ms = 5;
  bytes signature = 6;
}

message ScoredDocument {
  string document_id = 1;       // Opaque ID (not file path)
  string title = 2;
  repeated string topics = 3;
  float similarity_score = 4;
  float retrievability = 5;     // FSRS score
  uint32 word_count = 6;
  string last_updated = 7;      // ISO 8601
  // NOTE: No content field. Never transmitted.
}

// Knowledge routing
message RouteQuery {
  string query_id = 1;
  repeated float query_embedding = 2;
  uint32 max_routes = 3;
}

message RouteResult {
  string query_id = 1;
  repeated NodeRoute routes = 2;
}

message NodeRoute {
  string node_id = 1;
  float relevance_score = 2;    // Based on topic centroid similarity
  repeated string relevant_topics = 3;
  float trust_score = 4;
  bool online = 5;
}

// Trust attestation
message TrustAttestation {
  string attester_id = 1;       // Who is vouching
  string attestee_id = 2;       // Who is being vouched for
  float trust_level = 3;        // 0.0 to 1.0
  string reason = 4;            // Optional
  string timestamp = 5;
  bytes signature = 6;
}
```

#### 21.3 Sync Strategy

**Initial Sync:**
1. On first connection to a peer, exchange `EmbeddingCatalogue` messages
2. Each node stores peer catalogues in a local `federation.db` (separate SQLite)
3. No bulk embedding transfer -- only catalogues (topic summaries + centroids)

**Query-Time Fetching:**
- When a federated search query arrives, the responding node computes similarity against its LOCAL embeddings
- Only top-K results (metadata only) are returned
- This avoids transferring full embedding sets between nodes

**Incremental Updates:**
- Nodes broadcast `CatalogueUpdate` messages when their vault changes (debounced, max 1/hour)
- Updates contain only changed topic summaries, not full catalogue
- Version counter ensures ordering

**Offline Handling:**
- Each node caches peer catalogues locally
- Cached catalogues used for knowledge routing even when peer is offline
- Premium relays maintain always-fresh catalogues for their subscribers

### 22. Privacy Layer

#### 22.1 Threat Model

| Threat | Severity | Mitigation |
|--------|:--------:|-----------|
| **Embedding Inversion Attack** | Critical | Differential privacy noise + EGuard projection + small model (384-dim is harder to invert than 1024/1536-dim) |
| **Membership Inference** | High | Noise injection ensures plausible deniability about specific documents |
| **Topic Fingerprinting** | Medium | Topic centroids are aggregated (not per-document), DP noise applied |
| **Traffic Analysis** | Medium | Cover traffic (random queries at intervals), onion routing for sensitive queries |
| **Malicious Node** | High | Trust system, query rate limiting, anomaly detection |
| **Network Metadata** | Low | Hyperswarm Noise encryption, no central server logging |

#### 22.2 Differential Privacy Implementation

```
Privacy Budget: epsilon = 1.0 (configurable per node)

For each shared embedding vector e:
1. Compute sensitivity: delta_f = max L2 change from adding/removing one document
2. Generate Gaussian noise: n ~ N(0, sigma^2 * I)
   where sigma = delta_f * sqrt(2 * ln(1.25 / delta)) / epsilon
3. Perturbed embedding: e' = e + n
4. Normalize: e'' = e' / ||e'||

For topic centroids:
- Apply DP to cluster centroids (not individual embeddings)
- Higher noise budget (epsilon = 2.0) since centroids are less sensitive

User-configurable privacy levels:
- "paranoid"  : epsilon = 0.1 (very noisy, lower search quality)
- "balanced"  : epsilon = 1.0 (default, good privacy/quality tradeoff)
- "open"      : epsilon = 10.0 (minimal noise, best search quality)
- "public"    : No DP (for intentionally public knowledge vaults)
```

#### 22.3 EGuard Projection (Optional, Advanced)

For users requiring stronger guarantees:
- Train a transformer-based projection network that maps embeddings to a privacy-preserving subspace
- This projection blocks >95% of inversion attacks while maintaining >98% search accuracy
- Ships as a pre-trained model in the federation package
- Adds ~50ms latency per query

#### 22.4 Embedding Model Considerations

The current default model `all-MiniLM-L6-v2` (384-dim) has a natural privacy advantage:
- Smaller dimension = less information = harder to invert
- 2024 research shows 92% reconstruction on 32-token inputs with larger models; 384-dim models show significantly lower reconstruction rates
- For v1, standardizing on this model avoids cross-model alignment complexity
- Future: support model registry with verified alignment matrices

### 23. Search Routing

#### 23.1 How "This Question is Best Answered by Node C" Works

```
Query Routing Algorithm:

1. User on Node A asks: "What are best practices for CRISPR primer design?"

2. Node A computes query embedding: q = embed("CRISPR primer design...")

3. Node A checks LOCAL catalogue cache for all known nodes:
   For each node N in federation:
     For each topic T in N.catalogue:
       score(N, T) = cosine(q, T.centroid) * T.count * N.trust_score * uptime_factor(N)

4. Rank nodes by max topic score:
   Node C: 0.89 (topic: "molecular-biology", 340 docs, trust: 0.95)
   Node B: 0.72 (topic: "genetics", 120 docs, trust: 0.88)
   Node E: 0.45 (topic: "lab-protocols", 80 docs, trust: 0.91)

5. Send SearchQuery to top-K nodes (default K=5, configurable)

6. Merge results using RRF (same algorithm as local hybrid search):
   For each result across all nodes:
     rrf_score = sum(1 / (k + rank_in_node)) * node_trust_weight

7. Return merged results to user/AI agent
```

#### 23.2 Multi-Hop Routing

For large networks (>50 nodes):
- Direct connections are limited (each node connects to ~20 peers max)
- Queries include `hop_limit` (default 2)
- Each relay node can forward the query to its own peers
- Results flow back along the same path
- Loop detection via `query_id` deduplication

### 24. Trust Model

#### 24.1 Web of Trust

```
Trust Score Computation:

trust(A, B) = direct_trust(A, B) * 0.6 + transitive_trust(A, B) * 0.3 + karma(B) * 0.1

Where:
- direct_trust: Explicit vouch from A to B (0.0 - 1.0)
- transitive_trust: max(trust(A, C) * trust(C, B)) for all C
  (trust decays multiplicatively through hops, max 3 hops)
- karma: Global reputation based on:
  * Uptime percentage (30%)
  * Search result quality feedback (40%)
  * Node age (10%)
  * Vouch count (20%)
```

#### 24.2 Trust Operations

| Operation | Description | CLI Command |
|-----------|-------------|-------------|
| **Vouch** | Explicitly trust a node | `sv federate vouch <node-id> --level 0.8` |
| **Revoke** | Remove trust attestation | `sv federate revoke <node-id>` |
| **Block** | Block a node (zero trust, no queries) | `sv federate block <node-id>` |
| **Inspect** | View a node's trust chain | `sv federate trust <node-id>` |

#### 24.3 Sybil Resistance

- **Proof of Knowledge:** New nodes must have a vault with >100 documents and >30 days of indexing history before joining federation
- **Vouch Requirement:** At least 1 vouch from an existing node with trust >0.5
- **Rate Limiting:** New nodes limited to 10 queries/hour for first 7 days
- **Anomaly Detection:** Sudden bulk document additions trigger review flag

### 25. Incentive Structure

#### 25.1 Why Share Knowledge?

| Incentive | Mechanism | Appeal |
|-----------|-----------|--------|
| **Reciprocity** | "You can only search as many nodes as you serve. Free-loaders get limited results." | Core game theory |
| **Reputation** | High-trust, high-quality nodes get priority routing and visibility | Social capital |
| **Discovery** | "What knowledge do I have that others find valuable?" -- insight into your own expertise | Self-knowledge |
| **Network Quality** | More nodes = better search for everyone (network effect) | Collective benefit |
| **Premium Revenue** | High-quality vaults can opt into knowledge marketplace (pay-per-query) | Financial |

#### 25.2 Search Credits System

```
Each node earns 1 credit for every search it serves.
Each node spends 1 credit for every federated search it makes.
New nodes start with 100 credits.
Credits are local accounting (not blockchain, not transferable).
Nodes with 0 credits can still search but are deprioritized in routing.
Premium relay subscribers get unlimited credits.
```

### 26. AI Agent Integration (MCP Tools)

#### 26.1 New MCP Tools for Federation

| # | Tool | Description | Parameters |
|---|------|-------------|------------|
| 1 | `federated-search` | Search across all connected federation nodes | `query`, `limit`, `topic_filter`, `min_trust` |
| 2 | `network-gaps` | Identify knowledge gaps across the entire federation | `depth` (topic granularity), `min_nodes` |
| 3 | `route-query` | Find which nodes are most relevant for a given topic | `query`, `max_routes` |
| 4 | `trust-score` | Get trust information about a node | `node_id` |

#### 26.2 AI Agent Experience

Before Federation:
```
User: "What are the best practices for CRISPR primer design?"
Claude: [searches local vault → no relevant results]
       "I don't have information about CRISPR in your vault."
```

After Federation:
```
User: "What are the best practices for CRISPR primer design?"
Claude: [calls federated-search → finds results from 3 nodes]
       "Based on knowledge from your federation network:
        - Node 'maya-lab' has 12 documents on CRISPR protocols (trust: 0.95)
        - Node 'genetics-group' has 5 related documents (trust: 0.88)
        
        Key topics found across the network:
        1. Guide RNA design parameters (3 nodes, high confidence)
        2. Off-target analysis methods (2 nodes)
        3. Delivery optimization (1 node)
        
        Note: I can see titles and topics but not the actual content.
        Would you like me to explore any of these topics further?"
```

#### 26.3 Plugin Events for Federation

New plugin events added to the Plugin SDK:

| Event | Trigger | Data |
|-------|---------|------|
| `onFederatedSearch` | When a federated search is performed | Query, results, latency |
| `onPeerConnect` | When a new peer connects | Peer ID, trust score |
| `onPeerDisconnect` | When a peer disconnects | Peer ID, reason |
| `onTrustChange` | When trust score changes | Node ID, old/new trust |
| `onNetworkGap` | When a network-level gap is detected | Gap region, severity |

### 27. CLI Commands

| # | Command | Description | Example |
|---|---------|-------------|---------|
| 1 | `sv federate init` | Initialize federation (generate keypair, create federation.db) | `sv federate init` |
| 2 | `sv federate join <group>` | Join a federation group by invite code | `sv federate join maya-lab-abc123` |
| 3 | `sv federate leave <group>` | Leave a federation group | `sv federate leave maya-lab-abc123` |
| 4 | `sv federate status` | Show federation status (peers, groups, trust) | `sv federate status` |
| 5 | `sv federate search <query>` | Federated search (also works via existing `sv search --federated`) | `sv federate search "CRISPR primers"` |
| 6 | `sv federate vouch <node>` | Vouch for a node | `sv federate vouch abc123 --level 0.9` |
| 7 | `sv federate revoke <node>` | Revoke trust | `sv federate revoke abc123` |
| 8 | `sv federate block <node>` | Block a node | `sv federate block abc123` |
| 9 | `sv federate trust <node>` | Inspect trust chain | `sv federate trust abc123` |
| 10 | `sv federate gaps` | Show network-level knowledge gaps | `sv federate gaps --depth 2` |
| 11 | `sv federate nodes` | List known nodes with trust scores | `sv federate nodes` |
| 12 | `sv federate invite` | Generate invite code for current group | `sv federate invite --group maya-lab` |
| 13 | `sv federate privacy` | Show/set privacy level | `sv federate privacy --level balanced` |
| 14 | `sv federate credits` | Show search credit balance | `sv federate credits` |

### 28. Data Model

#### 28.1 Federation Database (federation.db -- separate from main index.db)

```sql
-- Node identity
CREATE TABLE node_identity (
  node_id TEXT PRIMARY KEY,          -- Ed25519 public key (hex)
  private_key BLOB NOT NULL,         -- Encrypted private key
  display_name TEXT,
  created_at TEXT NOT NULL,
  privacy_level TEXT DEFAULT 'balanced'
);

-- Known peers
CREATE TABLE peers (
  node_id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen TEXT,
  last_catalogue_version INTEGER DEFAULT 0,
  embedding_model TEXT,
  embedding_dim INTEGER,
  document_count INTEGER DEFAULT 0,
  trust_score REAL DEFAULT 0.0,
  is_blocked INTEGER DEFAULT 0,
  joined_at TEXT NOT NULL
);

-- Federation groups
CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,         -- SHA256 of group name + creator
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  invite_code TEXT UNIQUE
);

-- Group membership
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',        -- 'admin', 'member'
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, node_id)
);

-- Trust attestations
CREATE TABLE trust_attestations (
  attester_id TEXT NOT NULL,
  attestee_id TEXT NOT NULL,
  trust_level REAL NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  signature BLOB NOT NULL,
  PRIMARY KEY (attester_id, attestee_id)
);

-- Cached peer catalogues (for routing when peers are offline)
CREATE TABLE peer_catalogues (
  node_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  document_count INTEGER,
  centroid BLOB,                     -- Float32 array (DP-perturbed)
  avg_retrievability REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (node_id, topic)
);

-- Search credits
CREATE TABLE credits (
  node_id TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 100,
  total_earned INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0
);

-- Query log (local only, for analytics)
CREATE TABLE query_log (
  query_id TEXT PRIMARY KEY,
  query_text TEXT,
  nodes_queried INTEGER,
  results_returned INTEGER,
  latency_ms INTEGER,
  timestamp TEXT NOT NULL
);
```

### 29. Implementation Roadmap

#### Phase 0: Foundation (2 weeks)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 0.1 | Transport abstraction | `FederationTransport` interface + Hyperswarm implementation | `packages/core/src/federation/transport.ts` |
| 0.2 | Identity system | Ed25519 keypair generation, node identity management | `packages/core/src/federation/identity.ts` |
| 0.3 | Federation config | Extend `.stellavault.json` with federation settings | `packages/core/src/config.ts` (modify) |
| 0.4 | Federation database | Create and manage `federation.db` | `packages/core/src/federation/store.ts` |
| 0.5 | Protobuf schemas | Define all message types | `packages/core/src/federation/proto/` |

#### Phase 1: Core Federation (3 weeks)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 1.1 | Peer discovery | Hyperswarm DHT announcement + peer connection | `packages/core/src/federation/discovery.ts` |
| 1.2 | Embedding catalogue | Generate and exchange catalogues | `packages/core/src/federation/catalogue.ts` |
| 1.3 | Federated search | Cross-node semantic search with RRF merge | `packages/core/src/federation/search.ts` |
| 1.4 | Privacy layer | Differential privacy noise injection | `packages/core/src/federation/privacy.ts` |
| 1.5 | CLI commands | `federate init`, `join`, `search`, `status` | `packages/cli/src/commands/federate.ts` |

#### Phase 2: Trust & Routing (2 weeks)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 2.1 | Trust system | Web of Trust with vouch/revoke/block | `packages/core/src/federation/trust.ts` |
| 2.2 | Knowledge routing | Route queries to most relevant nodes | `packages/core/src/federation/router.ts` |
| 2.3 | Search credits | Credit accounting system | `packages/core/src/federation/credits.ts` |
| 2.4 | CLI commands | `vouch`, `revoke`, `block`, `trust`, `credits` | `packages/cli/src/commands/federate.ts` (extend) |

#### Phase 3: Intelligence & MCP (2 weeks)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 3.1 | Network gap detection | Aggregate gaps across federation | `packages/core/src/federation/gaps.ts` |
| 3.2 | MCP tools | 4 new federation tools | `packages/core/src/mcp/tools/federation.ts` |
| 3.3 | Plugin events | 5 new federation events | `packages/core/src/plugins/index.ts` (extend) |
| 3.4 | 3D graph overlay | Network topology + gap heatmap in graph view | `packages/graph/src/components/FederationOverlay.tsx` |

#### Phase 4: Polish & Security (2 weeks)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 4.1 | EGuard projection | Optional advanced privacy layer | `packages/core/src/federation/eguard.ts` |
| 4.2 | Offline resilience | Cache handling, reconnection, stale data management | `packages/core/src/federation/resilience.ts` |
| 4.3 | Premium relay | Hosted relay service foundation | `packages/core/src/federation/relay.ts` |
| 4.4 | Security audit | Penetration testing on embedding privacy claims | External |
| 4.5 | Documentation | Protocol spec, privacy whitepaper, user guide | `docs/federation/` |

**Total estimated timeline: 11 weeks**

### 30. Success Criteria

| # | Metric | Target (Alpha) | Target (Public) |
|---|--------|:--------------:|:---------------:|
| S1 | Federated search latency | <5s (5 nodes) | <3s (20 nodes) |
| S2 | Privacy: embedding inversion ROUGE-L | <10% | <5% (with EGuard) |
| S3 | P2P connection success rate | >80% | >90% |
| S4 | Search relevance (MRR@10) | >0.5 | >0.7 |
| S5 | Active federation nodes | 5+ | 200+ |
| S6 | Privacy incidents | 0 | 0 |
| S7 | Node uptime (avg) | >60% | >70% |
| S8 | Trust system false positive rate | <10% | <5% |

### 31. Pre-Mortem Analysis

| # | Risk | Probability | Impact | Mitigation |
|---|------|:-----------:|:------:|-----------|
| R1 | **Embedding inversion breakthrough** makes "embeddings-only" privacy claim invalid | Medium | Critical | EGuard projection as defense-in-depth; monitor inversion research; design protocol to support future zero-knowledge approaches; privacy level controls let users add more noise |
| R2 | **No one keeps nodes online** -- network is empty most of the time | High | High | Premium relay service; "sunrise/sunset sync" model (nodes sync when online, relay caches); mobile companion app (future); incentive credits |
| R3 | **Cross-model embedding incompatibility** -- users with different models can't search each other | Medium | High | v1 standardizes on all-MiniLM-L6-v2; future: model registry with pre-computed alignment matrices; embedding translation proxy |
| R4 | **NAT/firewall blocks P2P** in corporate/university networks | High | Medium | WebSocket relay fallback; TURN-style relay for blocked networks; premium relay subscription |
| R5 | **Trust system gamed** by Sybil attacks | Low | High | Proof of Knowledge requirement; vouch chains; rate limiting; anomaly detection |
| R6 | **Search quality disappointing** due to DP noise | Medium | Medium | Tunable epsilon; A/B testing noise levels; EGuard (better quality than raw noise); user education on privacy/quality tradeoff |

### 32. User Stories

| # | As a... | I want to... | So that... | Acceptance Criteria |
|---|---------|-------------|-----------|-------------------|
| US-1 | Stellavault user | Initialize federation on my node with one command | I can start participating in the network | `sv federate init` generates keypair, creates federation.db, announces to DHT |
| US-2 | Research lab member | Join a private federation group via invite code | I can search my lab's collective knowledge | Invite code joins group, peer discovery starts, search returns results from group members |
| US-3 | Knowledge worker | Run a federated search from CLI | I find relevant knowledge across the network | `sv search --federated "topic"` returns merged results from multiple nodes with source attribution |
| US-4 | AI agent (Claude) | Call `federated-search` MCP tool | I can answer questions using the federation's collective knowledge | MCP tool returns scored results with node attribution, topics, and trust scores |
| US-5 | Privacy-conscious user | Set my privacy level to "paranoid" | My embeddings have maximum noise protection | `sv federate privacy --level paranoid` sets epsilon=0.1, search still works but with lower precision |
| US-6 | Community leader | See knowledge gaps across the entire federation | I can identify what topics our community lacks | `sv federate gaps` shows network-level gap regions, severity, and which nodes have partial coverage |
| US-7 | Node operator | Vouch for trusted peers | The trust network grows organically | `sv federate vouch <id> --level 0.9` creates signed attestation, peer's trust score updates |
| US-8 | Developer | Build a federation plugin | I can extend federation behavior (custom routing, analytics) | Plugin SDK emits `onFederatedSearch`, `onPeerConnect` events with correct data |

### 33. Test Scenarios

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| T-1 | Basic federation search | 3 nodes online, each with 100+ docs | Node A searches "machine learning" | Results from all 3 nodes merged by RRF, latency <5s |
| T-2 | Privacy verification | Node with DP epsilon=1.0 | Attempt embedding inversion attack on shared embeddings | ROUGE-L reconstruction <10% |
| T-3 | Offline node handling | Node B goes offline | Node A searches | Cached catalogue used for routing, results from online nodes only, no errors |
| T-4 | Trust filtering | Node C has trust 0.3 | Federated search with min_trust=0.5 | Node C excluded from results |
| T-5 | Knowledge routing | 5 nodes, each specialized in different topics | Route query "CRISPR primers" | Returns top 3 nodes ranked by topic relevance |
| T-6 | Sybil resistance | Attacker creates 10 new nodes | Attempts to flood network | Blocked: <100 docs, no vouches, rate limited |
| T-7 | MCP integration | Claude connected via MCP | Calls federated-search tool | Returns structured results with attribution |
| T-8 | NAT hole-punching | 2 nodes behind different NATs | Attempt P2P connection | Successful connection via Hyperswarm DHT relay |
| T-9 | Credit system | Node A has 0 credits | Attempts federated search | Search works but deprioritized (slower, fewer results) |
| T-10 | Network gap detection | 10 nodes, all lacking "quantum computing" coverage | Run network gaps | "quantum computing" identified as network gap |

### 34. Stakeholder Map

| Stakeholder | Interest | Influence | Strategy |
|-------------|----------|:---------:|----------|
| **Obsidian Users** | Privacy, search quality, ease of use | High | Early access, community-driven development, transparent privacy audits |
| **AI Agent Developers** | MCP tool quality, reliable federation search | High | Clean MCP tool API, documentation, example prompts |
| **PKM Community** | Collective intelligence, knowledge health | Medium | Blog posts, conference talks, gap detection demos |
| **Privacy Researchers** | Embedding privacy claims, differential privacy implementation | Medium | Open source privacy layer, invite academic review, bug bounty |
| **Obsidian Team** | Ecosystem compatibility, no conflicts | Medium | Complementary positioning (plugin-level, not fork-level) |
| **Enterprise IT** | Data governance, private federation, audit trails | Low (initially) | Enterprise tier with compliance features (Phase 4+) |

---

## Appendix

### A. Technology Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| P2P Protocol | Hyperswarm | Best NAT handling, Node.js native, simplest integration |
| Serialization | Protobuf | Efficient for embedding vectors (384 float32 = 1.5KB), schema evolution support |
| Identity | Ed25519 + optional DID:key | Fast signing, small keys, DID compatibility for future interop |
| Privacy | Differential Privacy (Gaussian) + optional EGuard | Proven theory, tunable, EGuard for advanced users |
| Trust | Web of Trust (vouch + karma) | Decentralized, no central authority, organic growth |
| Embedding Model (v1) | all-MiniLM-L6-v2 (384-dim) | Already in use, smaller dim = better privacy, sufficient quality |
| Storage | Separate federation.db (SQLite) | Isolation from main index.db, independent lifecycle |

### B. Configuration Extension

```json
// .stellavault.json additions
{
  "federation": {
    "enabled": false,
    "privacy": "balanced",
    "maxPeers": 20,
    "queryTimeout": 5000,
    "hopLimit": 2,
    "creditStartBalance": 100,
    "bootstrapNodes": [
      "/dns4/bootstrap1.stellavault.dev/tcp/49737",
      "/dns4/bootstrap2.stellavault.dev/tcp/49737"
    ],
    "relay": {
      "enabled": false,
      "url": null
    }
  }
}
```

### C. Glossary

| Term | Definition |
|------|-----------|
| **Federation** | A network of Stellavault nodes that cooperate while maintaining independence |
| **Node** | A single Stellavault instance running federation |
| **Embedding Catalogue** | Summary of a node's knowledge (topic centroids, counts, FSRS scores) |
| **DP (Differential Privacy)** | Mathematical framework for adding noise to data while preserving statistical utility |
| **EGuard** | Transformer-based projection network that blocks embedding inversion attacks |
| **Hyperswarm** | P2P networking library with built-in DHT and NAT hole-punching |
| **Noise Protocol** | Cryptographic handshake framework for secure channels |
| **Web of Trust** | Decentralized trust model where nodes vouch for each other |
| **Search Credits** | Local accounting system that incentivizes serving search queries |
| **Premium Relay** | Always-on node that caches catalogues for offline nodes (paid service) |
| **SFP** | Stellavault Federation Protocol |

### D. References and Inspiration

| Source | Relevance |
|--------|-----------|
| [AT Protocol](https://atproto.com/) | PDS architecture, DID identity model, relay pattern |
| [Nostr](https://nostr.com/) | Event-signed architecture, relay simplicity, key-based identity |
| [Solid Project](https://solidproject.org/) | Data pod concept, W3C standards, access control model |
| [Hyperswarm](https://github.com/holepunchto/hyperswarm) | P2P transport, DHT, NAT hole-punching |
| [EGuard (2024)](https://arxiv.org/abs/2411.05034) | Embedding privacy via projection networks |
| [Embedding Inversion Attacks (ACL 2024)](https://aclanthology.org/2024.acl-long.230/) | Threat model for shared embeddings |
| [FSRS Algorithm](https://github.com/open-spaced-repetition/fsrs4anki) | Spaced repetition for knowledge health tracking |

### E. Attribution

This PRD was generated by the PM Agent Team integrating frameworks from [pm-skills](https://github.com/phuryn/pm-skills) by Pawel Huryn (MIT License):

- **Discovery**: Teresa Torres' Opportunity Solution Tree (5-Step Discovery Chain)
- **Strategy**: JTBD 6-Part Value Proposition + Lean Canvas + SWOT + Porter's Five Forces + Blue Ocean
- **Research**: Persona Generation + Competitive Analysis + TAM/SAM/SOM (Dual Method) + Customer Journey Map
- **Execution**: ICP + Beachhead Segment + GTM Strategy + Battlecards + Growth Loops + Pre-Mortem + User Stories + Test Scenarios + Stakeholder Map
