// chat-session-store tests (SP1 T3, Plan §5/§8/§9⑥⑨).
//
// electron `app.getPath('home')` is mocked to a per-run temp dir BEFORE the dynamic
// import, because the store computes CHAT_DIR = join(home,'.stellavault','chat') at
// module load. Each test imports the store fresh (vi.resetModules) so debounce state
// (the module-level `pending` map) doesn't leak across cases.
//
// Asserts (§9⑥⑨):
//  - filename === randomUUID()+'.json', NEVER title-derived (spy crypto.randomUUID).
//  - isUuid rejects non-UUID ids on load/delete/rename.
//  - assertInsideDir rejects '../' traversal + sibling-prefix bypass.
//  - atomic write produces valid JSON (tmp+rename).
//  - corrupt file → '.broken' quarantine + loadSession returns null (no throw).
//  - redact replaces sk-… / large base64.
//  - citations persisted with title+filePath only (snippet stripped — Decision 2).
//  - debounce fires once per session per window.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
// Per-run home dir. The store joins '.stellavault','chat' onto this.
let HOME: string;
const chatDir = () => join(HOME, '.stellavault', 'chat');

// node:crypto namespace is non-configurable in ESM, so vi.spyOn(randomUUID) fails.
// Mock the module instead so we get a CALL COUNTER on randomUUID — proving filenames
// come from randomUUID (never a title). The factory captures the REAL randomUUID via
// importOriginal and the spy delegates to it (genuine UUIDs, no recursion). The store
// imports { randomUUID } from 'node:crypto' → resolves to this spy.
const { randomUUIDSpy } = vi.hoisted(() => ({ randomUUIDSpy: vi.fn() }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  randomUUIDSpy.mockImplementation(() => actual.randomUUID());
  return { ...actual, randomUUID: randomUUIDSpy };
});

vi.mock('electron', () => ({
  app: { getPath: (_k: string) => HOME },
}));

type Store = typeof import('../src/main/chat-session-store.js');

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import('../src/main/chat-session-store.js');
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function userMsg(text: string, id = 'u1') {
  return { id, role: 'user' as const, text, ts: 1000 };
}
function asstMsg(text: string, id = 'a1') {
  return { id, role: 'assistant' as const, text, ts: 2000 };
}

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), 'sv-chat-store-'));
  randomUUIDSpy.mockClear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    rmSync(HOME, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('chat-session-store: filename = UUID, never title-derived', () => {
  it('renameSession writes a title field but the filename stays the UUID', async () => {
    const store = await freshStore();
    // Seed a session synchronously via the debounce flush.
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('hello world this is a title source')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    expect(existsSync(join(chatDir(), `${UUID_A}.json`))).toBe(true);

    store.renameSession(UUID_A, 'My Custom Title');
    // The on-disk filename is STILL the UUID — no file named after the title exists.
    const files = readdirSync(chatDir());
    expect(files).toContain(`${UUID_A}.json`);
    expect(files.some((f) => f.toLowerCase().includes('custom'))).toBe(false);

    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.title).toBe('My Custom Title');
    expect(parsed.id).toBe(UUID_A);
  });

  it('the persisted tmp filename uses randomUUID (spy), not the title', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('SECRET TITLE STRING')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    // The atomic write derived its tmp suffix from randomUUID — proves filenames are
    // never built from caller-controlled text.
    expect(randomUUIDSpy).toHaveBeenCalled();
    // Final file is the session UUID; no temp/title remnant left behind.
    const files = readdirSync(chatDir());
    expect(files).toEqual([`${UUID_A}.json`]);
    expect(files.some((f) => f.includes('SECRET'))).toBe(false);
  });
});

describe('chat-session-store: isUuid guard on every op', () => {
  const bad = ['not-a-uuid', '../escape', '', 'AAAA', '12345678-1234-1234-1234-1234567890zz'];

  it('saveSession throws synchronously on a non-UUID id', async () => {
    const store = await freshStore();
    for (const id of bad) {
      expect(() => store.saveSession(id, [userMsg('x')])).toThrow(/must be a UUID/);
    }
  });

  it('loadSession throws on a non-UUID id', async () => {
    const store = await freshStore();
    for (const id of bad) {
      expect(() => store.loadSession(id)).toThrow(/must be a UUID/);
    }
  });

  it('renameSession throws on a non-UUID id', async () => {
    const store = await freshStore();
    for (const id of bad) {
      expect(() => store.renameSession(id, 'title')).toThrow(/must be a UUID/);
    }
  });

  it('deleteSession does NOT throw on a non-UUID id (logs + returns)', async () => {
    const store = await freshStore();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const id of bad) {
      expect(() => store.deleteSession(id)).not.toThrow();
    }
    expect(errSpy).toHaveBeenCalled();
  });

  it('isUuid accepts valid v4-shaped ids and rejects junk', async () => {
    const store = await freshStore();
    expect(store.isUuid(UUID_A)).toBe(true);
    expect(store.isUuid(UUID_A.toUpperCase())).toBe(true); // case-insensitive
    expect(store.isUuid('nope')).toBe(false);
    expect(store.isUuid(42 as unknown)).toBe(false);
    expect(store.isUuid(null as unknown)).toBe(false);
  });
});

describe('chat-session-store: assertInsideDir traversal rejection', () => {
  // A non-UUID id is rejected before assertInsideDir even runs, so traversal via the
  // id is doubly-blocked. We assert that the UUID guard catches the classic payloads.
  it('rejects ../ traversal and sibling-prefix attempts (caught by isUuid first)', async () => {
    const store = await freshStore();
    expect(() => store.loadSession('../../etc/passwd')).toThrow(/must be a UUID/);
    expect(() => store.loadSession('..%2f..%2fetc')).toThrow(/must be a UUID/);
    // Sibling-prefix style: a path that, if it slipped past, would resolve next to
    // (not inside) CHAT_DIR. Still not a UUID → rejected.
    expect(() => store.deleteSession('chat-evil')).not.toThrow(); // delete logs, no throw
    expect(() => store.loadSession('chat-evil')).toThrow(/must be a UUID/);
  });

  it('a UUID id resolves strictly inside CHAT_DIR', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('inside')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    const f = join(chatDir(), `${UUID_A}.json`);
    expect(existsSync(f)).toBe(true);
    // Resolved file sits under CHAT_DIR (containment).
    expect(f.startsWith(chatDir())).toBe(true);
  });
});

describe('chat-session-store: atomic write + load round-trip', () => {
  it('produces valid JSON and round-trips messages', async () => {
    const store = await freshStore();
    const msgs = [userMsg('question'), asstMsg('answer')];
    vi.useFakeTimers();
    store.saveSession(UUID_A, msgs);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const f = join(chatDir(), `${UUID_A}.json`);
    const parsed = JSON.parse(readFileSync(f, 'utf-8'));
    expect(parsed.id).toBe(UUID_A);
    expect(parsed.messages).toHaveLength(2);
    expect(typeof parsed.updated).toBe('number');

    const loaded = store.loadSession(UUID_A);
    expect(loaded).not.toBeNull();
    expect(loaded![0].text).toBe('question');
    expect(loaded![1].text).toBe('answer');

    // No leftover .tmp files after the atomic rename.
    expect(readdirSync(chatDir()).some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('mkdir creates the chat dir with 0o700 (mode bits asserted on POSIX)', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('x')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    expect(existsSync(chatDir())).toBe(true);
    // Windows ignores POSIX mode bits, so only assert them where they're meaningful.
    if (process.platform !== 'win32') {
      expect(statSync(chatDir()).mode & 0o777).toBe(0o700);
    }
  });
});

describe('chat-session-store: incomplete + citations survive save→load round-trip', () => {
  it('loadSession preserves incomplete flag and redacted (title+filePath) citations', async () => {
    const store = await freshStore();
    const assistant = {
      id: 'a1',
      role: 'assistant' as const,
      text: 'partial answer',
      ts: 2000,
      incomplete: true,
      citations: [{ title: 'Note A', filePath: '/vault/a.md', snippet: 'SECRET SNIPPET' }],
    };
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('q'), assistant]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const loaded = store.loadSession(UUID_A);
    expect(loaded).not.toBeNull();
    expect(loaded![1].incomplete).toBe(true);
    expect(loaded![1].citations).toEqual([{ title: 'Note A', filePath: '/vault/a.md' }]);
    // Snippet body never reached disk, so it can't come back on load.
    expect((loaded![1].citations as any)[0].snippet).toBeUndefined();
  });
});

describe('path-safety: assertInsideDir containment (direct)', () => {
  it('rejects sibling-prefix and ../ escapes, allows the root and children', async () => {
    const { assertInsideDir } = await import('../src/main/path-safety.js');
    const root = join(tmpdir(), 'v');
    // Sibling-prefix bypass: /v vs /v-evil must be rejected (the guard's raison d'être).
    expect(() => assertInsideDir(root, `${root}-evil${sep}x`)).toThrow(/outside directory/);
    expect(() => assertInsideDir(root, join(root, '..', 'etc', 'passwd'))).toThrow(/outside directory/);
    // Root itself and a legitimate child are allowed.
    expect(assertInsideDir(root, root)).toBe(root);
    expect(assertInsideDir(root, join(root, 'child.json'))).toBe(join(root, 'child.json'));
  });
});

describe('chat-session-store: corrupt file quarantine', () => {
  it('loadSession returns null and quarantines a corrupt file (.broken), no throw', async () => {
    const store = await freshStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Hand-write a corrupt file with a valid UUID name.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(chatDir(), { recursive: true });
    const f = join(chatDir(), `${UUID_A}.json`);
    writeFileSync(f, '{ this is not valid json ', 'utf-8');

    let result: unknown;
    expect(() => {
      result = store.loadSession(UUID_A);
    }).not.toThrow();
    expect(result).toBeNull();
    expect(existsSync(f)).toBe(false); // moved aside
    expect(existsSync(`${f}.broken`)).toBe(true); // quarantined, not deleted
  });

  it('listSessions skips + quarantines corrupt files without throwing', async () => {
    const store = await freshStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { mkdirSync } = await import('node:fs');
    mkdirSync(chatDir(), { recursive: true });
    // One good session.
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('good one')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    // One corrupt session.
    writeFileSync(join(chatDir(), `${UUID_B}.json`), 'NOT JSON', 'utf-8');

    let rows: ReturnType<Store['listSessions']>;
    expect(() => {
      rows = store.listSessions();
    }).not.toThrow();
    expect(rows!.map((r) => r.id)).toEqual([UUID_A]);
    expect(existsSync(join(chatDir(), `${UUID_B}.json.broken`))).toBe(true);
  });
});

describe('chat-session-store: redact (defense-in-depth)', () => {
  it('replaces sk-… keys and large base64 blobs before persist', async () => {
    const store = await freshStore();
    const longB64 = 'A'.repeat(1500); // > 1366 base64 chars → blob
    const msgs = [
      userMsg('here is my key sk-ant-abcdefghijklmnopqrstuvwxyz0123 and more'),
      asstMsg(`blob: ${longB64}`),
    ];
    vi.useFakeTimers();
    store.saveSession(UUID_A, msgs);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    const dump = JSON.stringify(parsed);
    expect(dump).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz0123');
    expect(dump).not.toContain(longB64);
    expect(parsed.messages[0].text).toContain('[redacted]');
    expect(parsed.messages[1].text).toContain('[redacted]');
  });

  it('replaces AIza… Google keys', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('AIzaSyA1234567890abcdefghijklmnopqrstuv')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.messages[0].text).toContain('[redacted]');
    expect(parsed.messages[0].text).not.toContain('AIzaSyA1234567890abcdefghijklmnopqrstuv');
  });
});

describe('chat-session-store: citation persistence = title+filePath only (Decision 2)', () => {
  it('strips snippet bodies from citations at rest', async () => {
    const store = await freshStore();
    const assistant = {
      id: 'a1',
      role: 'assistant' as const,
      text: 'grounded answer',
      ts: 2000,
      citations: [
        { title: 'Note A', filePath: '/vault/a.md', snippet: 'PRIVATE EXCERPT BODY' },
        { title: 'Note B', filePath: '/vault/b.md', snippet: 'ANOTHER SECRET SNIPPET' },
      ],
    };
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('q'), assistant]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const raw = readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8');
    expect(raw).not.toContain('PRIVATE EXCERPT BODY');
    expect(raw).not.toContain('ANOTHER SECRET SNIPPET');
    const parsed = JSON.parse(raw);
    const cites = parsed.messages[1].citations;
    expect(cites).toHaveLength(2);
    expect(cites[0]).toEqual({ title: 'Note A', filePath: '/vault/a.md' });
    expect(cites[0].snippet).toBeUndefined();
    expect(cites[1]).toEqual({ title: 'Note B', filePath: '/vault/b.md' });
  });
});

describe('chat-session-store: per-session debounce', () => {
  it('fires once per session per window (rapid saves coalesce)', async () => {
    const store = await freshStore();
    randomUUIDSpy.mockClear(); // randomUUID is called once per atomic write (tmp suffix)
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('v1')]);
    store.saveSession(UUID_A, [userMsg('v2')]);
    store.saveSession(UUID_A, [userMsg('v3')]);
    // Before the window elapses, nothing written.
    expect(existsSync(join(chatDir(), `${UUID_A}.json`))).toBe(false);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    // Exactly one write happened → exactly one tmp-suffix randomUUID call.
    expect(randomUUIDSpy).toHaveBeenCalledTimes(1);
    // The last value wins.
    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.messages[0].text).toBe('v3');
  });

  it('different sessions debounce independently', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('a')]);
    store.saveSession(UUID_B, [userMsg('b')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    expect(existsSync(join(chatDir(), `${UUID_A}.json`))).toBe(true);
    expect(existsSync(join(chatDir(), `${UUID_B}.json`))).toBe(true);
  });

  it('rename while a save is pending is NOT clobbered by the later flush', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    // Save scheduled but not yet flushed (still pending).
    store.saveSession(UUID_A, [userMsg('hello world title source')]);
    // Rename in the same window — must survive the pending flush.
    store.renameSession(UUID_A, 'Custom Pinned Title');
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.title).toBe('Custom Pinned Title'); // not the derived title
  });

  it('rename of a brand-new (not-yet-flushed) session applies on the next save', async () => {
    const store = await freshStore();
    vi.spyOn(console, 'error').mockImplementation(() => {}); // rename-before-file logs benignly
    vi.useFakeTimers();
    // File does not exist yet; rename must not be a silent no-op.
    store.saveSession(UUID_A, [userMsg('first message')]);
    store.renameSession(UUID_A, 'Early Title');
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.title).toBe('Early Title');
  });

  it('a later save after a rename keeps the custom title (override persists)', async () => {
    const store = await freshStore();
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('v1')]);
    vi.advanceTimersByTime(800);
    store.renameSession(UUID_A, 'Pinned');
    // Another turn saves — derived title would be 'v2', but the override must win.
    store.saveSession(UUID_A, [userMsg('v2 longer first message text')]);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();

    const parsed = JSON.parse(readFileSync(join(chatDir(), `${UUID_A}.json`), 'utf-8'));
    expect(parsed.title).toBe('Pinned');
    expect(parsed.messages[0].text).toBe('v2 longer first message text');
  });

  it('deleteSession cancels a pending save so it is not re-created', async () => {
    const store = await freshStore();
    vi.spyOn(console, 'error').mockImplementation(() => {}); // unlink of never-written file logs benignly
    vi.useFakeTimers();
    store.saveSession(UUID_A, [userMsg('pending')]);
    store.deleteSession(UUID_A); // cancels the pending timer
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    expect(existsSync(join(chatDir(), `${UUID_A}.json`))).toBe(false);
  });
});
