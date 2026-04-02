// Contradiction Detector (F-A12)
// Finds potentially contradicting statements across notes
// Uses embedding similarity + negation pattern detection

import type { VectorStore } from '../store/types.js';

export interface ContradictionPair {
  docA: { id: string; title: string; filePath: string; statement: string };
  docB: { id: string; title: string; filePath: string; statement: string };
  similarity: number;
  confidence: number; // 0-1, how likely this is a real contradiction
  type: 'negation' | 'value_conflict' | 'temporal' | 'semantic';
}

// Negation/opposition patterns
const NEGATION_PAIRS = [
  ['should', 'should not'], ['must', 'must not'], ['always', 'never'],
  ['best', 'worst'], ['good', 'bad'], ['correct', 'incorrect'],
  ['true', 'false'], ['increase', 'decrease'], ['enable', 'disable'],
  ['recommended', 'not recommended'], ['use', 'avoid'],
  ['prefer', 'avoid'], ['do', "don't"], ['is', "isn't"],
  ['can', "can't"], ['will', "won't"], ['important', 'unimportant'],
  ['필요', '불필요'], ['해야', '하면 안'], ['좋', '나쁜'], ['맞', '틀'],
];

function extractKeyStatements(content: string): string[] {
  return content
    .split(/[.\n!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 200)
    .filter(s => {
      const lower = s.toLowerCase();
      return /should|must|always|never|best|important|recommend|prefer|avoid|필요|해야|좋|나쁜/.test(lower);
    })
    .slice(0, 10); // max 10 statements per document
}

function detectNegationConflict(stmtA: string, stmtB: string): { isConflict: boolean; confidence: number; type: ContradictionPair['type'] } {
  const a = stmtA.toLowerCase();
  const b = stmtB.toLowerCase();

  // Check negation pairs
  for (const [pos, neg] of NEGATION_PAIRS) {
    if ((a.includes(pos) && b.includes(neg)) || (a.includes(neg) && b.includes(pos))) {
      // Check if they're talking about the same subject (share words)
      const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
      const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      const minSize = Math.min(wordsA.size, wordsB.size) || 1;
      const subjectOverlap = overlap / minSize;

      if (subjectOverlap > 0.2) {
        return { isConflict: true, confidence: Math.min(0.5 + subjectOverlap * 0.5, 0.95), type: 'negation' };
      }
    }
  }

  // Check numeric value conflicts (e.g., "timeout should be 30s" vs "timeout should be 5s")
  const numsA = a.match(/\d+/g);
  const numsB = b.match(/\d+/g);
  if (numsA && numsB) {
    const wordsA = new Set(a.replace(/\d+/g, '').split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.replace(/\d+/g, '').split(/\s+/).filter(w => w.length > 3));
    const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
    if (overlap >= 2 && numsA[0] !== numsB[0]) {
      return { isConflict: true, confidence: 0.6, type: 'value_conflict' };
    }
  }

  return { isConflict: false, confidence: 0, type: 'semantic' };
}

export async function detectContradictions(
  store: VectorStore,
  limit = 20,
): Promise<ContradictionPair[]> {
  const docs = await store.getAllDocuments();
  const embeddings = await store.getDocumentEmbeddings();

  if (docs.length < 2) return [];

  // Build document vectors + key statements
  const docData = new Map<string, { vec: number[]; title: string; filePath: string; statements: string[] }>();
  for (const doc of docs) {
    const vec = embeddings.get(doc.id);
    if (!vec) continue;
    const statements = extractKeyStatements(doc.content);
    if (statements.length === 0) continue;
    docData.set(doc.id, { vec: Array.from(vec), title: doc.title, filePath: doc.filePath, statements });
  }

  const ids = [...docData.keys()];
  const results: ContradictionPair[] = [];

  // Compare documents with moderate similarity (same topic, possibly conflicting)
  for (let i = 0; i < ids.length && results.length < limit * 3; i++) {
    for (let j = i + 1; j < ids.length && results.length < limit * 3; j++) {
      const a = docData.get(ids[i])!;
      const b = docData.get(ids[j])!;
      const sim = cosineSim(a.vec, b.vec);

      // Sweet spot: similar enough to be same topic, not identical
      if (sim < 0.3 || sim > 0.9) continue;

      // Compare statements
      for (const stmtA of a.statements) {
        for (const stmtB of b.statements) {
          const { isConflict, confidence, type } = detectNegationConflict(stmtA, stmtB);
          if (isConflict && confidence >= 0.5) {
            results.push({
              docA: { id: ids[i], title: a.title, filePath: a.filePath, statement: stmtA },
              docB: { id: ids[j], title: b.title, filePath: b.filePath, statement: stmtB },
              similarity: Math.round(sim * 1000) / 1000,
              confidence: Math.round(confidence * 100) / 100,
              type,
            });
          }
        }
      }
    }
  }

  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
