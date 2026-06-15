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
    label: 'Local / OpenAI-compatible', needsKey: false, needsBaseURL: true,
    keyPlaceholder: '(often blank for local)',
    modelHint: `Model name as served (e.g. ${DEFAULT_OLLAMA_MODEL}, mistral, qwen2.5).`,
    keyHint: 'Optional — local servers (Ollama, LM Studio) need no key. Required for Groq / OpenRouter / DeepSeek.',
  },
};
