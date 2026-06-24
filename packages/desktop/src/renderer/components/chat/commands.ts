// Slash-command registry for the chat composer (premium part 4). Pure + dependency-free so it
// is unit-tested directly. ChatView owns the single runCommand(cmd,arg) dispatcher; BOTH the
// "/" popover and the quick-button bar call it → one code path.

export type CommandAction = 'prefill' | 'toggle' | 'run' | 'send';

export interface SlashCommand {
  id: string;
  aliases?: string[];
  titleKey: string;        // i18n key for the label (also the quick-bar pill text)
  descKey: string;         // i18n key for the menu description
  action: CommandAction;
  takesArg?: boolean;      // /search <q>, /note <title>
  /** prefill template; {arg} is replaced with the typed argument (or '' ). */
  template?: string;
  /** which toggle/run this maps to — interpreted by ChatView's runCommand. */
  handler?: 'rag' | 'agent' | 'distill' | 'image' | 'new' | 'clear';
}

export interface CommandCtx {
  visionOn: boolean;       // /image is only meaningful on a vision provider
  canNewSession: boolean;  // ChatPanel provided onNewSession
  canClearChat: boolean;   // ChatPanel provided onClearChat
}

export const COMMANDS: SlashCommand[] = [
  { id: 'summarize', titleKey: 'panel.ai.cmd.summarize.title', descKey: 'panel.ai.cmd.summarize.desc', action: 'prefill', template: 'Summarize my recent notes' },
  { id: 'search', aliases: ['find'], titleKey: 'panel.ai.cmd.search.title', descKey: 'panel.ai.cmd.search.desc', action: 'prefill', takesArg: true, template: 'Search my vault for: {arg}' },
  { id: 'note', titleKey: 'panel.ai.cmd.note.title', descKey: 'panel.ai.cmd.note.desc', action: 'prefill', takesArg: true, template: 'Create a note about {arg}' },
  { id: 'agent', titleKey: 'panel.ai.cmd.agent.title', descKey: 'panel.ai.cmd.agent.desc', action: 'toggle', handler: 'agent' },
  { id: 'rag', titleKey: 'panel.ai.cmd.rag.title', descKey: 'panel.ai.cmd.rag.desc', action: 'toggle', handler: 'rag' },
  { id: 'distill', titleKey: 'panel.ai.cmd.distill.title', descKey: 'panel.ai.cmd.distill.desc', action: 'toggle', handler: 'distill' },
  { id: 'image', titleKey: 'panel.ai.cmd.image.title', descKey: 'panel.ai.cmd.image.desc', action: 'run', handler: 'image' },
  { id: 'new', titleKey: 'panel.ai.cmd.new.title', descKey: 'panel.ai.cmd.new.desc', action: 'run', handler: 'new' },
  { id: 'clear', titleKey: 'panel.ai.cmd.clear.title', descKey: 'panel.ai.cmd.clear.desc', action: 'run', handler: 'clear' },
];

/** A command is visible only when its prerequisite (vision / parent callback) is satisfied. */
function isVisible(cmd: SlashCommand, ctx: CommandCtx): boolean {
  if (cmd.handler === 'image') return ctx.visionOn;
  if (cmd.handler === 'new') return ctx.canNewSession;
  if (cmd.handler === 'clear') return ctx.canClearChat;
  return true;
}

/** Parse a composer value: is it a leading-'/' command line? Anchored to index 0 of the WHOLE
 *  value so a '/' mid-text or on line 2 (a path / code) never hijacks. */
export function parseSlash(value: string): { isSlash: boolean; token: string; arg: string } {
  if (value[0] !== '/') return { isSlash: false, token: '', arg: '' };
  const firstLine = value.split('\n', 1)[0].slice(1); // drop the leading '/'
  const sp = firstLine.indexOf(' ');
  if (sp === -1) return { isSlash: true, token: firstLine, arg: '' };
  return { isSlash: true, token: firstLine.slice(0, sp), arg: firstLine.slice(sp + 1).trim() };
}

/** Visible commands whose id/alias prefix-matches `query` (case-insensitive). '' → all visible. */
export function matchCommands(query: string, ctx: CommandCtx): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return COMMANDS.filter((c) => isVisible(c, ctx)).filter((c) => {
    if (!q) return true;
    return c.id.startsWith(q) || (c.aliases ?? []).some((a) => a.startsWith(q));
  });
}

/** Fill a command's template with the typed argument. */
export function applyTemplate(cmd: SlashCommand, arg: string): string {
  if (!cmd.template) return '';
  return cmd.template.replace('{arg}', arg).trim();
}

// ── Quick-button bar ──────────────────────────────────────────────────────────
export const QUICK_BAR_IDS = ['summarize', 'search', 'note', 'distill'];
export const QUICK_BAR_ADAPTIVE = false; // fixed pinned set (buttons don't move under the finger)
const FREQ_KEY = 'sv.chat.cmdFreq';

/** Silently accumulate command usage (so adaptivity can flip on later with real data). */
export function bumpFreq(id: string): void {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    const freq: Record<string, number> = raw ? JSON.parse(raw) : {};
    freq[id] = (freq[id] ?? 0) + 1;
    localStorage.setItem(FREQ_KEY, JSON.stringify(freq));
  } catch { /* storage unavailable — non-fatal */ }
}

/** The quick-bar command set: the fixed pinned ids, visibility-filtered. (Adaptive mode would
 *  reorder by frequency with QUICK_BAR_IDS as the floor — off in v1.) */
export function topQuickBar(ctx: CommandCtx): SlashCommand[] {
  const byId = new Map(COMMANDS.map((c) => [c.id, c]));
  return QUICK_BAR_IDS.map((id) => byId.get(id)).filter((c): c is SlashCommand => !!c && isVisible(c, ctx));
}
