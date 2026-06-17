// Outgoing wikilinks ([[Target]], [[Target|alias]], [[Target#section]]) parsed
// from a note body — renderer-side copy of core extractWikilinks, used by the
// NotePreviewPanel explorer's Outlinks segment. Resolution (target title ->
// filePath) is done by the caller against the loaded graph node list.

export interface Outlink {
  target: string;    // link target title (before | and #)
  alias?: string;    // display alias after |
  section?: string;  // heading after #
}

export function parseOutlinks(text: string): Outlink[] {
  const out: Outlink[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let target = m[1];
    let alias: string | undefined;
    let section: string | undefined;
    const pipe = target.indexOf('|');
    if (pipe >= 0) { alias = target.slice(pipe + 1).trim() || undefined; target = target.slice(0, pipe); }
    const hash = target.indexOf('#');
    if (hash >= 0) { section = target.slice(hash + 1).trim() || undefined; target = target.slice(0, hash); }
    target = target.trim();
    if (!target) continue;
    const key = `${target.toLowerCase()}#${section ?? ''}`;
    if (seen.has(key)) continue; // dedupe repeated links to the same target
    seen.add(key);
    out.push({ target, alias, section });
  }
  return out;
}

// Obsidian wikilinks resolve by file basename (no extension). Used to index graph
// nodes for outlink/backlink resolution instead of the truncated graph label.
export function noteBasename(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}
