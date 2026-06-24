// Agent tool-selection EVAL gate (P1, Design Ref §5 / §10-f LOCKED).
//
// §10-f: 10 fixed prompts, the model must pick the CORRECT tool >= 8/10 with the P1 toolset
// (13 advertised tools). This is the "did adding recall_memory degrade gemma4:e4b's tool
// selection" regression gate. It hits a LIVE local Ollama, so it AUTO-SKIPS when Ollama is
// unreachable (keeps CI + the offline suite green). Run it deliberately with Ollama up:
//
//   OLLAMA_EVAL_MODEL=gemma4:e4b npx vitest run tests/agent-memory-eval.test.ts
//
// It reuses the REAL AGENT_TOOL_SCHEMAS (the 13-tool advertised set) so the eval measures the
// shipped toolset, not a hand-copied one. The Ollama body/parse is inlined (plain fetch + NDJSON)
// so the eval needs neither electron `net` nor the chat-engine module.
import { describe, it, expect, vi } from 'vitest';

// AGENT_TOOL_SCHEMAS pulls the @stellavault/core barrel transitively — stub it (we never execute
// a tool here, only inspect which one the model SELECTS).
vi.mock('@stellavault/core', () => ({ handleLogDecision: vi.fn(), handleFindDecisions: vi.fn() }));

const OLLAMA = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_EVAL_MODEL || 'gemma4:e4b';

async function ollamaReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

const UP = await ollamaReachable();
if (!UP) {
  // eslint-disable-next-line no-console
  console.log(`[agent-memory-eval] SKIPPED — Ollama unreachable at ${OLLAMA}. Start Ollama + 'ollama pull ${MODEL}' to run the §10-f gate.`);
}

// The same agent rules the real loop ships (chat-engine.ts agentSystem), trimmed to what drives
// tool selection. recall_memory facts are deliberately NOT inlined so a memory question must
// route through the tool rather than be answered from the prompt.
const SYSTEM = [
  "You are an AGENT for the user's Stellavault vault (their second brain). You have tools to search/read their notes AND a long-term memory of durable facts about the user.",
  'For the user request, call the SINGLE most appropriate tool. Do not answer from general knowledge when a tool fits.',
  '- recall_memory: durable facts about THIS user (their preferences, hardware, ongoing projects).',
  '- search_vault: find notes by topic. read_note: read one note by path. list_topics: tags/topics.',
  '- find_decisions: past decisions. get_related: notes related to a path. detect_gaps: weakly-linked clusters. learning_path: review queue.',
  '- log_decision: record a NEW decision. create_note/append_note/link_note: write to the vault.',
].join('\n');

interface Probe { prompt: string; expect: string[] }
const PROBES: Probe[] = [
  { prompt: 'What GPU do I have?', expect: ['recall_memory'] },
  { prompt: 'What are my preferred local models?', expect: ['recall_memory'] },
  { prompt: 'Which projects am I currently working on?', expect: ['recall_memory'] },
  { prompt: 'Search my notes about kubernetes networking.', expect: ['search_vault'] },
  { prompt: 'Read the note at Projects/roadmap.md', expect: ['read_note'] },
  { prompt: 'What tags and topics exist across my vault?', expect: ['list_topics'] },
  { prompt: 'What decisions have I recorded about choosing a database?', expect: ['find_decisions'] },
  { prompt: 'Find notes related to Projects/roadmap.md', expect: ['get_related'] },
  { prompt: 'Which notes are most due for review today?', expect: ['learning_path'] },
  { prompt: 'Record a decision: we chose Postgres over MongoDB for ACID guarantees.', expect: ['log_decision', 'create_note'] },
];

/** POST /api/chat (native, stream) and return the name of the FIRST tool_call the model emits,
 *  or '' if it answered without a tool. Parses NDJSON lines for message.tool_calls. */
async function firstToolFor(prompt: string, schemas: unknown[]): Promise<string> {
  const body = {
    model: MODEL,
    stream: true,
    think: false,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    tools: schemas,
  };
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text(); // small responses; buffer then scan NDJSON lines
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      const calls = obj?.message?.tool_calls;
      if (Array.isArray(calls) && calls[0]?.function?.name) return String(calls[0].function.name);
    } catch { /* partial line */ }
  }
  return '';
}

describe.skipIf(!UP)('agent-memory eval — §10-f tool-selection gate (live Ollama)', () => {
  it('picks the correct tool on >= 8/10 P1 prompts (13-tool set)', async () => {
    const { AGENT_TOOL_SCHEMAS } = await import('../src/main/agent-tools.js');
    expect(AGENT_TOOL_SCHEMAS).toHaveLength(13); // P1 advertised count (12 dispatched + set_plan)

    let correct = 0;
    const transcript: string[] = [];
    for (const p of PROBES) {
      let got = '';
      try { got = await firstToolFor(p.prompt, AGENT_TOOL_SCHEMAS); } catch { got = '(error)'; }
      const ok = p.expect.includes(got);
      if (ok) correct++;
      transcript.push(`${ok ? 'PASS' : 'FAIL'}  expected ${p.expect.join('|')} got ${got || '(no tool)'}  — "${p.prompt}"`);
    }
    // eslint-disable-next-line no-console
    console.log(`[agent-memory-eval] ${correct}/${PROBES.length}\n${transcript.join('\n')}`);
    expect(correct).toBeGreaterThanOrEqual(8);
  }, 120_000);
});
