// Tiny fuzzy subsequence scorer (W1-12) — no deps, shared by the command
// palette and quick switcher. Higher score = better match; null = no match.

export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;

  // Strong signals first.
  const exactIdx = t.indexOf(q);
  if (exactIdx === 0) return 1000 - t.length;
  if (exactIdx > 0) return 500 - exactIdx - t.length * 0.1;

  // Subsequence walk: reward consecutive runs and word-boundary hits.
  let score = 0;
  let ti = 0;
  let prevHit = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    score += idx === prevHit + 1 ? 8 : 1;                       // consecutive bonus
    if (idx === 0 || /[\s\-_/.]/.test(t[idx - 1])) score += 6;  // word start bonus
    prevHit = idx;
    ti = idx + 1;
  }
  return score - t.length * 0.1;
}

/** Filter + rank items by a fuzzy query over the string `key` extracts. */
export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): T[] {
  if (!query) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
