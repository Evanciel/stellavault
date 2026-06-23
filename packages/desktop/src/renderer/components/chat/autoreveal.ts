// Split-view auto-reveal logic (SP-H/I) — pure, so the invariants are unit-tested without a
// React render harness. A successful WRITE tool reveals the graph so the user watches the
// second brain grow as the agent/distiller writes notes.

/** Tools that mutate the vault. A successful one is a candidate for revealing the graph. */
export const AGENT_WRITE_TOOLS = new Set(['create_note', 'append_note', 'link_note', 'log_decision']);

/**
 * Should a successful tool-result auto-reveal the graph panel? All guards must hold:
 *  - it's a successful WRITE (a read tool never reveals);
 *  - we haven't already auto-revealed this session (`alreadyOpened`);
 *  - variant === 'main' — the panel-variant chat lives IN the right panel, so revealing the
 *    graph there would unmount the chat and abort its own stream mid-write;
 *  - rightPanel === 'none' — never steal a panel the user explicitly chose, nor re-grab one
 *    they deliberately closed.
 */
export function shouldAutoRevealGraph(opts: {
  ok: boolean; toolName: string; alreadyOpened: boolean; variant: 'panel' | 'main'; rightPanel: string;
}): boolean {
  return opts.ok && AGENT_WRITE_TOOLS.has(opts.toolName) && !opts.alreadyOpened
    && opts.variant === 'main' && opts.rightPanel === 'none';
}
