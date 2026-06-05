// Upgrade B2 — entity extraction for the entity-linking search signal.
//
// Hybrid strategy: a curated Obsidian vault already encodes a hand-made entity
// graph via [[wikilinks]], #tags, and headings. We promote those to retrieval
// entities (primary, high precision), and fall back to lightweight Title-Case /
// acronym noun-phrase detection for prose that isn't explicitly linked.
// No NER model, no new dependency — fully local, deterministic, and (crucially)
// language-agnostic: Korean/CJK vaults still get wikilink/tag/heading entities
// even though Title-Case heuristics only fire on Latin script.

export interface EntityInput {
  content: string;
  heading?: string;
  title?: string;
  tags?: string[];
}

/** Per-chunk cap so the entity table stays lean and the signal stays precise. */
const MAX_ENTITIES_PER_CHUNK = 30;
/** Cap on query-side candidate terms (short queries → small set). */
const MAX_QUERY_TERMS = 64;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you',
  'are', 'was', 'not', 'but', 'all', 'can', 'has', 'have', 'will', 'what',
  'when', 'which', 'their', 'them', 'these', 'those', 'then', 'than', 'about',
  'over', 'more', 'most', 'some', 'such', 'also', 'how', 'why', 'does', 'did',
  'who', 'where', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'or', 'as',
]);

/**
 * Normalize an entity string: strip punctuation to spaces, collapse whitespace,
 * trim, lowercase. (B2.1) Punctuation stripping makes stored entities symmetric
 * with query tokenization (extractQueryTerms also strips non-alphanumerics), so a
 * heading/title like "AI Destiny (운명 프리즘)" stores as "ai destiny 운명 프리즘"
 * instead of keeping the parens that blocked exact matching. Takes effect on the
 * next reindex; existing indexes are bridged by fuzzy matching in searchEntities.
 */
function normalize(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isMeaningful(n: string): boolean {
  if (n.length < 2) return false;
  if (STOPWORDS.has(n)) return false;
  return true;
}

/** Extract wikilink targets: [[Target]], [[Target|alias]], [[Target#section]]. */
export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let target = m[1];
    const pipe = target.indexOf('|');
    if (pipe >= 0) target = target.slice(0, pipe);
    const hash = target.indexOf('#');
    if (hash >= 0) target = target.slice(0, hash);
    target = target.trim();
    if (target) out.push(target);
  }
  return out;
}

/** Inline #tags within content (e.g. "#knowledge-management"). */
function extractInlineTags(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)#([A-Za-z][\w/-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/[/_-]/g, ' '));
  return out;
}

/** Title-Case multi-word phrases + ALL-CAPS acronyms (Latin script only). */
function extractNounPhrases(text: string): string[] {
  const out: string[] = [];
  const cleaned = text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  // "Reciprocal Rank Fusion" — 2..5 consecutive Title-Case words
  const tc = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = tc.exec(cleaned)) !== null) out.push(m[1]);
  // "RRF", "FSRS", "MCP" — 2..6 uppercase letters
  const ac = /\b([A-Z]{2,6})\b/g;
  while ((m = ac.exec(cleaned)) !== null) out.push(m[1]);
  return out;
}

/**
 * Index-time: extract high-precision entities for a chunk.
 * Primary signals (curated graph): wikilinks, tags, heading, title.
 * Fallback: Title-Case / acronym noun phrases in the content + heading.
 */
export function extractEntities(input: EntityInput): string[] {
  const set = new Set<string>();
  const add = (s: string) => {
    const n = normalize(s);
    if (isMeaningful(n)) set.add(n);
  };

  // Primary — curated graph
  for (const w of extractWikilinks(input.content)) add(w);
  for (const t of input.tags ?? []) add(t.replace(/^#/, '').replace(/[/_-]/g, ' '));
  for (const t of extractInlineTags(input.content)) add(t);
  if (input.heading) add(input.heading);
  if (input.title) add(input.title);

  // Fallback — noun phrases / acronyms
  for (const p of extractNounPhrases(input.content)) add(p);
  if (input.heading) for (const p of extractNounPhrases(input.heading)) add(p);

  return [...set].slice(0, MAX_ENTITIES_PER_CHUNK);
}

/**
 * Query-time: generate candidate entity terms from a query, matched (exact,
 * normalized) against the stored entity vocabulary. Handles lowercase queries
 * (where Title-Case heuristics fail) via word n-grams, plus wikilinks/acronyms.
 */
export function extractQueryTerms(query: string): string[] {
  const set = new Set<string>();

  for (const w of extractWikilinks(query)) {
    const n = normalize(w);
    if (n) set.add(n);
  }
  for (const a of query.match(/\b[A-Z]{2,6}\b/g) ?? []) set.add(a.toLowerCase());

  // Word n-grams (1..4) — Unicode-aware so CJK/accented queries tokenize too.
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.every((w) => STOPWORDS.has(w))) continue;
      if (n > 1 && (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[gram.length - 1]))) continue;
      const phrase = gram.join(' ');
      if (phrase.length >= 2) set.add(phrase);
    }
  }

  return [...set].slice(0, MAX_QUERY_TERMS);
}
