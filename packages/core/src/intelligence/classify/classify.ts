// Local-first note classifier — PURE + SYNCHRONOUS + OFFLINE.
// Precedence: deterministic rule (conf 1.0) → embedding nearest-centroid + confidence.
// The optional LLM tie-break (ambiguous band only) is applied by the CALLER so this
// core stays pure and always works without an API key (the product moat).
// Design Ref: §6.2 — second-brain-autocapture-design.md.

import { cosineSimilarity } from '../../utils/math.js';
import type { Category, ClassifyBand, ClassifyConfig, ClassifyResult, NoteCtx } from './types.js';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Jaccard overlap of two string sets (case-insensitive, trimmed). */
export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const norm = (s: string): string => s.trim().toLowerCase();
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Does any of the category's deterministic rules match this note? */
function matchesRule(ctx: NoteCtx, cat: Category): boolean {
  if (!cat.rules || cat.rules.length === 0) return false;
  for (const r of cat.rules) {
    switch (r.kind) {
      case 'tag':
        if (ctx.tags.some((t) => t.toLowerCase() === r.value.toLowerCase())) return true;
        break;
      case 'pathPrefix':
        if (ctx.path && ctx.path.replace(/\\/g, '/').startsWith(r.value)) return true;
        break;
      case 'sourceType':
        if (ctx.sourceType && ctx.sourceType === r.value) return true;
        break;
      case 'titleRegex':
        try {
          if (new RegExp(r.value, 'i').test(ctx.title)) return true;
        } catch {
          /* invalid regex → skip this rule, never throw on the hot path */
        }
        break;
      case 'frontmatterKey': {
        const eq = r.value.indexOf('=');
        const key = eq === -1 ? r.value : r.value.slice(0, eq);
        const want = eq === -1 ? undefined : r.value.slice(eq + 1);
        const fm = ctx.frontmatter ?? {};
        const have = fm[key];
        if (want === undefined) {
          if (have != null && have !== false && have !== '') return true;
        } else if (String(have) === want) {
          return true;
        }
        break;
      }
    }
  }
  return false;
}

/** Map (categoryId, confidence) → smart-auto band. null category is always cold. */
function bandFor(categoryId: string | null, conf: number, cfg: ClassifyConfig): ClassifyBand {
  if (!categoryId) return 'review-cold';
  if (conf >= cfg.tau.auto) return 'auto';
  if (conf >= cfg.tau.review) return 'review';
  return 'review-cold';
}

/**
 * Classify a note against the active category set.
 *
 * Returns `categoryId: null` when nothing clears `simFloor` (the note becomes a
 * "+ New category" candidate in the review queue). `confidence` is a 0..1 blend of
 * fit (how close to the winning centroid), margin (how much it beats the runner-up),
 * and a lexical bonus (entity↔keyword overlap). The caller uses `band` to route:
 * `auto` → file silently, `review`/`review-cold` → review queue.
 */
export function classifyLocal(ctx: NoteCtx, categories: Category[], cfg: ClassifyConfig): ClassifyResult {
  const active = categories.filter((c) => c.status === 'active');

  // (A) Deterministic rules win outright — intent beats fuzzy similarity.
  for (const cat of active) {
    if (matchesRule(ctx, cat)) {
      return { categoryId: cat.id, confidence: 1, method: 'rule', band: 'auto', alternatives: [{ id: cat.id, sim: 1 }] };
    }
  }

  // (B) Embedding nearest-centroid. No embedding or no categories → cold (new-category candidate).
  if (ctx.embedding.length === 0 || active.length === 0) {
    return { categoryId: null, confidence: 0, method: 'embedding', band: 'review-cold', alternatives: [] };
  }

  const scored = active
    .map((c) => ({ id: c.id, sim: cosineSimilarity(ctx.embedding, c.centroid), cat: c }))
    .sort((a, b) => b.sim - a.sim);

  const top = scored[0];
  const runnerUp = scored[1];
  const floor = top.cat.threshold ?? cfg.simFloor;

  // (C) confidence = wFit·fit + wMargin·margin + lexBonus.
  const fit = clamp01((top.sim - floor) / (1 - floor));
  const margin = runnerUp ? clamp01((top.sim - runnerUp.sim) / cfg.marginScale) : 1;
  const lexBonus = cfg.lexWeight * jaccard(ctx.entities, top.cat.keywords);
  const confidence = clamp01(cfg.wFit * fit + cfg.wMargin * margin + lexBonus);

  const categoryId = top.sim >= floor ? top.id : null;
  const alternatives = scored.slice(0, Math.max(1, cfg.topN)).map((s) => ({ id: s.id, sim: s.sim }));

  return { categoryId, confidence, method: 'embedding', band: bandFor(categoryId, confidence, cfg), alternatives };
}
