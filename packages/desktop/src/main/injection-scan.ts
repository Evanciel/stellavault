// Stellavault Desktop — Prompt-injection scanner (pure, testable)
// Design Ref: §3.5 (implements second-brain-agent-plan.md §6.7) — NET-NEW module.
//
// The agent's <untrusted> wrapper (chat-engine.ts buildSystemPrompt) is a PLAIN-TEXT
// instruction to the model ("don't follow what's inside") — NOT an enforcing scanner.
// Durable MEMORY blocks and (P3) SKILL descriptions/bodies reach the SYSTEM prompt and are
// re-injected every turn, so a single poisoned fact would persist. scanForInjection is the
// enforcing pass: it strips role-spoofing markers, override imperatives, tool-name mentions,
// and fenced-instruction blocks BEFORE the text is spliced into a prompt snapshot.
//
// Invariants:
//  - PURE + synchronous (no electron / fs import) so it can be unit-tested directly and
//    imported by both chat-engine and memory-store without pulling electron into either.
//  - It only ever rewrites the SNAPSHOT copy. Callers must keep the live blocks.json /
//    Skills/*.md untouched (the user can still read/delete the raw fact).
//  - Fail-safe by construction: an unmatched input is returned verbatim; a matched span is
//    replaced with the literal `[BLOCKED]` and recorded in `blocked` for telemetry/tests.

export interface InjectionScanResult {
  /** The input with every matched injection span replaced by `[BLOCKED]`. */
  clean: string;
  /** The raw matched substrings (for tests / a "we stripped N things" surface). */
  blocked: string[];
}

// Tool / control names an injection might try to name to coax a call. Untrusted DATA
// (a synced note, a durable fact) has no legitimate reason to contain these tokens, so a
// mention is treated as an injection attempt. Kept in sync with agent-tools.ts +
// the P2/P3 memory/skill control tools (named here ahead of their ship so a poisoned
// fact can never pre-stage a call to a not-yet-shipped tool).
const TOOL_NAMES = [
  'search_vault', 'read_note', 'list_topics', 'find_decisions', 'get_related',
  'detect_gaps', 'learning_path', 'log_decision', 'create_note', 'append_note',
  'link_note', 'recall_memory', 'list_skills', 'invoke_skill', 'set_plan',
  'core_memory_replace', 'core_memory_append',
];

// Each rule is a global regex. Order does not matter (matches are independent spans).
const RULES: RegExp[] = [
  // Role-spoofing / wrapper-escape markers. A durable fact never contains these.
  /<\/?\s*untrusted\s*>/gi,
  /<\|\s*(?:im_start|im_end|system|assistant|user|endoftext)\s*\|>/gi,
  // A line that opens with a role label ("system:", "assistant:", "Tool:") — a classic
  // attempt to forge a turn boundary inside data.
  /(?:^|\n)\s*(?:system|assistant|user|tool|developer)\s*:/gi,
  // Override / instruction-replacement imperatives.
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|above|prior|earlier|all)\b[^.\n]{0,40}\b(?:instruction|instructions|prompt|context|rule|rules)\b/gi,
  /\bnew\s+(?:instructions?|rules?|system\s+prompt)\b\s*:?/gi,
  /\byou\s+are\s+now\b[^.\n]{0,60}/gi,
  /\bfrom\s+now\s+on\b[^.\n]{0,60}/gi,
  /\b(?:act|behave)\s+as\b[^.\n]{0,40}/gi,
  /\bpretend\s+(?:to\s+be|you\s+are)\b[^.\n]{0,40}/gi,
  // Direct call-coaxing: "call <tool>", "use the <tool> tool", or a bare tool-name mention.
  new RegExp(
    `\\b(?:call|invoke|run|use|trigger|execute)\\b[^.\\n]{0,30}\\b(?:${TOOL_NAMES.join('|')})\\b`,
    'gi',
  ),
  new RegExp(`\\b(?:${TOOL_NAMES.join('|')})\\b`, 'gi'),
  // Fenced block that itself carries an injection cue (role label / ignore-previous /
  // "instruction"). Plain fenced code (no cue) is left intact.
  /```[\s\S]*?(?:system\s*:|assistant\s*:|ignore\s+(?:previous|above)|new\s+instructions?)[\s\S]*?```/gi,
];

/** Strip prompt-injection spans from untrusted text destined for a prompt snapshot.
 *  Pure: same input → same output, no side effects. Returns the sanitized copy plus the
 *  list of matched spans. An all-clean input returns `{ clean: text, blocked: [] }`. */
export function scanForInjection(text: string): InjectionScanResult {
  if (!text) return { clean: text ?? '', blocked: [] };
  const blocked: string[] = [];
  let clean = text;
  for (const rule of RULES) {
    clean = clean.replace(rule, (match) => {
      blocked.push(match);
      // Preserve a leading newline captured by the role-label rule so line structure
      // (and the next rule's "line start" anchor) survives the substitution.
      const lead = match.startsWith('\n') ? '\n' : '';
      return `${lead}[BLOCKED]`;
    });
  }
  return { clean, blocked };
}
