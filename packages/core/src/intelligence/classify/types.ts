// Classification engine types — local-embedding-first note categorization.
// Design Ref: §6.2 (second-brain-autocapture-design.md) — Category model + smart-auto gate.
//
// These types are pure data (no store/embedder/desktop dependency) so the classifier
// stays a unit-testable pure function and core remains LLM/desktop-agnostic.

export type CategoryOrigin = 'emergent' | 'user' | 'seed';

/** Deterministic override — evaluated BEFORE embedding similarity (intent beats fuzzy). */
export interface CategoryRule {
  kind: 'tag' | 'pathPrefix' | 'sourceType' | 'titleRegex' | 'frontmatterKey';
  value: string; // tag name | path prefix | source type | regex | "key" or "key=value"
}

/** A first-class, persisted category with an embedding centroid. Supports all three
 *  taxonomy modes via `origin` (emergent | user | seed). */
export interface Category {
  id: string;                 // stable slug, never renumbered (unlike kMeans indices)
  label: string;
  origin: CategoryOrigin;
  centroid: number[];         // embedder-dim vector (MiniLM-L12 = 384); DAO persists as Float32 BLOB
  memberCount: number;
  keywords: string[];         // aggregated entities — feed lexical bonus + labeling
  folder?: string;            // folder-mirror mode target leaf
  parentId?: string;
  rules?: CategoryRule[];     // deterministic overrides (origin user/seed), evaluated FIRST
  status: 'active' | 'merged' | 'archived';
  mergedInto?: string;        // when status==='merged'
  threshold?: number;         // per-category override of cfg.simFloor
  pinned?: boolean;           // anchor — never auto merge/split/rename
  centroidVersion: number;    // bumped on every centroid evolution
  createdAt: string;
  updatedAt: string;
}

/** Tunable knobs. Mirrors the search-weights config pattern (env-overridable, clamped). */
export interface ClassifyConfig {
  tau: { auto: number; review: number }; // confidence band thresholds
  simFloor: number;                       // min cosine to assign a category at all
  marginScale: number;                    // gap-to-runner-up scale for the margin term
  lexWeight: number;                      // weight of the entity↔keyword jaccard bonus
  wFit: number;                           // weight of the fit term
  wMargin: number;                        // weight of the margin term
  topN: number;                           // alternatives surfaced for the review queue
  taxonomyMode: 'emergent' | 'user' | 'hybrid';
  llmEnabled: boolean;                    // auto-true iff an AI provider key is configured
  autoMoveScope: 'managed' | 'off' | 'all';
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  tau: { auto: 0.78, review: 0.55 },
  simFloor: 0.30,
  marginScale: 0.15,
  lexWeight: 0.10,
  wFit: 0.6,
  wMargin: 0.4,
  topN: 3,
  taxonomyMode: 'emergent',
  llmEnabled: false,
  autoMoveScope: 'managed',
};

/** Everything the classifier needs about a note — no store/embedder dependency. */
export interface NoteCtx {
  embedding: number[];
  entities: string[];
  tags: string[];
  title: string;
  path?: string;              // vault-relative, forward slashes
  sourceType?: string;        // e.g. 'pdf' | 'url' | 'youtube' | 'text'
  frontmatter?: Record<string, unknown>;
}

export type ClassifyMethod = 'rule' | 'embedding' | 'llm' | 'manual';

/** Smart-auto routing band (Design §6.2 three-way gate). */
export type ClassifyBand = 'auto' | 'review' | 'review-cold';

export interface ClassifyResult {
  categoryId: string | null;  // null => nothing cleared simFloor (a "+ New category" candidate)
  confidence: number;         // 0..1
  method: ClassifyMethod;
  band: ClassifyBand;
  alternatives: { id: string; sim: number }[]; // top-N by similarity (review-queue chips)
}

// ─── Classify journal (audit trail + review queue, persisted; Design §6.3) ───
// SQLite `classify_journal` is the authoritative review-queue + audit log. A row is
// written for EVERY classification decision (auto-filed or review-pending) BEFORE the
// filesystem move, so a crash mid-move is detectable/reversible.
export type JournalStatus = 'auto-filed' | 'review-pending' | 'confirmed' | 'corrected' | 'skipped';

export interface JournalEntry {
  id: string;                 // stable id (e.g. capture id / ULID)
  notePath: string;           // absolute path of the created note
  categoryId: string | null;
  confidence: number;
  method: ClassifyMethod;
  band: ClassifyBand;
  status: JournalStatus;
  alternatives: { id: string; sim: number }[]; // top-N suggestions for the review card
  stage?: string;             // fleeting | literature | permanent
  prevPath?: string;          // pre-move path (undo)
  source?: string;            // drop | mcp | clip
  decidedAt: string;          // ISO
  decidedBy?: 'auto' | 'user';
}
