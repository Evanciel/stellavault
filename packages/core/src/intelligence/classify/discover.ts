// Emergent category discovery — PURE function. Clusters the "unowned" notes (those that
// fit no existing category) and proposes new emergent categories labeled from their
// entities. No DB / embedder dependency: the caller gathers docs (getDocumentEmbeddings +
// entities), calls this, then persists via the DAO. Design Ref: §6.2 (emergent discovery).

import { cosineSimilarity, normalizeVector } from '../../utils/math.js';
import { cosineKMeans, meanVector } from './cluster.js';
import type { Category, ClassifyConfig } from './types.js';

export interface DiscoverDoc {
  id: string;
  embedding: number[];
  entities: string[];
  title: string;
}

export interface DiscoverOptions {
  nowIso: string;             // injected timestamp (deterministic / testable)
  maxNewPerRun?: number;      // cap categories created per pass (default 8)
  minClusterSize?: number;    // a cluster needs at least this many notes (default 3)
  mergeThreshold?: number;    // cosine ≥ this between two NEW clusters → merge (default 0.92)
  k?: number;                 // override cluster count (else √(n/5) clamped to [2, maxNew])
}

export interface DiscoverResult {
  newCategories: Category[];
}

function slugify(s: string): string {
  const base = s.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || 'topic';
}

/** Top-N entities by frequency, preserving first-seen order on ties. */
export function topEntities(entities: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const e of entities) {
    const key = e.trim();
    if (!key) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}

/**
 * Discover emergent categories from the unowned subset of `docs`.
 * "Unowned" = best cosine to any existing active category centroid is below `cfg.simFloor`.
 * Returns new `Category` objects (origin 'emergent') with stable, collision-free slugs.
 */
export function discoverCategories(
  docs: DiscoverDoc[],
  existing: Category[],
  cfg: ClassifyConfig,
  opts: DiscoverOptions,
): DiscoverResult {
  const minCluster = opts.minClusterSize ?? 3;
  const maxNew = opts.maxNewPerRun ?? 8;
  const mergeT = opts.mergeThreshold ?? 0.92;

  const activeCentroids = existing
    .filter((c) => c.status === 'active' && c.centroid.length > 0)
    .map((c) => c.centroid);

  const unowned = docs.filter((d) => {
    if (d.embedding.length === 0) return false;
    let best = -Infinity;
    for (const c of activeCentroids) best = Math.max(best, cosineSimilarity(d.embedding, c));
    return best < cfg.simFloor;
  });
  if (unowned.length < minCluster) return { newCategories: [] };

  const heuristicK = Math.max(2, Math.round(Math.sqrt(unowned.length / 5)) || 2);
  const k = Math.min(opts.k ?? heuristicK, maxNew, unowned.length);

  const assign = cosineKMeans(unowned.map((d) => d.embedding), k);

  const usedSlugs = new Set(existing.map((c) => c.id));
  const out: Category[] = [];

  for (let c = 0; c < k; c++) {
    const members = unowned.filter((_, i) => assign[i] === c);
    if (members.length < minCluster) continue;

    const centroid = normalizeVector(meanVector(members.map((m) => m.embedding)));

    // Merge with an already-built NEW category if near-duplicate (k can over-split).
    const dup = out.find((o) => cosineSimilarity(o.centroid, centroid) >= mergeT);
    if (dup) {
      dup.memberCount += members.length;
      continue;
    }

    const keywords = topEntities(members.flatMap((m) => m.entities), 6);
    const label = keywords[0] ?? members[0].title ?? 'topic';
    let slug = slugify(label);
    let i = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(label)}-${i++}`;
    usedSlugs.add(slug);

    out.push({
      id: slug, label, origin: 'emergent', centroid, memberCount: members.length,
      keywords, status: 'active', centroidVersion: 1, createdAt: opts.nowIso, updatedAt: opts.nowIso,
    });
  }

  return { newCategories: out };
}
