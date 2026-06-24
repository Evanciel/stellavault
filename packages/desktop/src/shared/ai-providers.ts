// Shared AI-provider metadata — NO electron import, so it is safe in BOTH the main
// process (llm-synthesizer) and the renderer (Settings AI tab). Single source of truth
// for the provider enum + per-provider default model / base URL / UI hints.

export type AiProvider = 'none' | 'anthropic' | 'openai' | 'openai-compatible' | 'google';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-fable-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

// Anthropic Messages API version header. Single source of truth shared by
// modelsListRequest (below), llm-synthesizer (Ask/Wiki buffered), and chat-engine
// (SP1 streaming) — verified current 2026-06-22 (claude-api skill).
export const ANTHROPIC_VERSION = '2023-06-01';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  none: '',
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  'openai-compatible': DEFAULT_OLLAMA_MODEL,
  google: DEFAULT_GEMINI_MODEL,
};

export interface ProviderMeta {
  label: string;
  needsKey: boolean;
  needsBaseURL: boolean;
  keyPlaceholder: string;
  modelHint: string;
  keyHint: string;
}

export const PROVIDER_META: Record<AiProvider, ProviderMeta> = {
  none: {
    label: 'None (extractive only)', needsKey: false, needsBaseURL: false,
    keyPlaceholder: '', modelHint: '', keyHint: '',
  },
  anthropic: {
    label: 'Anthropic (Claude)', needsKey: true, needsBaseURL: false,
    keyPlaceholder: 'sk-ant-…', modelHint: `Claude model id. Default ${DEFAULT_ANTHROPIC_MODEL}.`,
    keyHint: 'Sent only to api.anthropic.com.',
  },
  openai: {
    label: 'OpenAI (GPT)', needsKey: true, needsBaseURL: false,
    keyPlaceholder: 'sk-…', modelHint: `OpenAI model id. Default ${DEFAULT_OPENAI_MODEL}.`,
    keyHint: 'Sent only to api.openai.com.',
  },
  google: {
    label: 'Google (Gemini)', needsKey: true, needsBaseURL: false,
    keyPlaceholder: 'AIza…', modelHint: `Gemini model id. Default ${DEFAULT_GEMINI_MODEL}.`,
    keyHint: 'Sent only to generativelanguage.googleapis.com.',
  },
  'openai-compatible': {
    label: 'Local (Ollama / LM Studio)', needsKey: false, needsBaseURL: true,
    keyPlaceholder: '(often blank for local)',
    modelHint: `Model name as served (e.g. ${DEFAULT_OLLAMA_MODEL}, mistral, qwen2.5). Or click "Load" to list installed models.`,
    keyHint: 'Optional — local servers (Ollama, LM Studio) need no key. Required for Groq / OpenRouter / DeepSeek.',
  },
};

// Sensible per-provider model lists shown in the Settings dropdown BEFORE a live
// fetch — so the dropdown is useful offline / before "Load models" is clicked.
// "Load" hits the provider's own API for the real, always-current list.
export const MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
  none: [],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o1', 'gpt-4.1', 'gpt-4.1-mini'],
  google: ['gemini-2.0-flash', 'gemini-2.0-pro-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  'openai-compatible': ['llama3.1', 'qwen2.5', 'mistral', 'phi3'],
};

/** True when `baseURL` (or the Ollama default when blank) targets a LOOPBACK host —
 *  i.e. a local model server we could offer to start. Remote openai-compatible hosts
 *  (Groq / OpenRouter / DeepSeek) return false so the UI never offers to "start Ollama"
 *  for a server it can't possibly launch. */
export function isLocalProviderUrl(baseURL: string): boolean {
  const raw = (baseURL || OLLAMA_BASE_URL).trim();
  let host: string;
  try {
    // URL.hostname returns IPv6 literals bracketed ("[::1]") — strip the brackets so
    // the loopback comparison below matches the bare "::1".
    host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost')
  );
}

// Valid key-accepting providers (excludes 'none', which never stores a key).
export const KEY_PROVIDERS: ReadonlySet<string> = new Set<string>([
  'anthropic', 'openai', 'openai-compatible', 'google',
] satisfies AiProvider[]);

/** Type-guard: is `p` a valid, key-accepting AiProvider (not 'none')? */
export function isValidProvider(p: string): p is Exclude<AiProvider, 'none'> {
  return KEY_PROVIDERS.has(p);
}

// Build the "list models" HTTP request for a provider. Called in the MAIN process
// (the renderer can't fetch the provider cross-origin under CSP). Returns null when
// the provider has no listing endpoint (none) or a required key is missing.
export function modelsListRequest(
  provider: AiProvider, apiKey: string, baseURL: string,
): { url: string; headers: Record<string, string> } | null {
  const key = (apiKey || '').trim();
  switch (provider) {
    case 'openai':
      if (!key) return null;
      return { url: `${OPENAI_BASE_URL}/models`, headers: { Authorization: `Bearer ${key}` } };
    case 'openai-compatible': {
      const base = (baseURL || OLLAMA_BASE_URL).replace(/\/+$/, '');
      return { url: `${base}/models`, headers: key ? { Authorization: `Bearer ${key}` } : {} };
    }
    case 'anthropic':
      if (!key) return null;
      return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } };
    case 'google':
      if (!key) return null;
      return { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, headers: {} };
    default:
      return null;
  }
}

// Parse a provider's models response into chat-capable model ids (sorted, de-duped).
export function parseModelsResponse(provider: AiProvider, json: unknown): string[] {
  const j = (json ?? {}) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
  let ids: string[];
  if (provider === 'google') {
    ids = (j.models ?? [])
      .map((m) => String(m?.name ?? '').replace(/^models\//, ''))
      .filter((n) => n.includes('gemini'));
  } else {
    // OpenAI-shaped { data: [{ id }] } — openai, openai-compatible (Ollama/LM Studio), anthropic.
    ids = (j.data ?? []).map((m) => String(m?.id ?? '')).filter(Boolean);
    if (provider === 'openai') ids = ids.filter((id) => /^(gpt-|o\d|chatgpt)/i.test(id));
  }
  return [...new Set(ids)].sort();
}
