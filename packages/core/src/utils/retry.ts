// Error Recovery System (F-A02) — retry with exponential backoff + meaningful messages

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: Error, attempt: number, maxRetries: number) => void;
}

const DEFAULT_OPTIONS: Required<Pick<RetryOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs'>> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxRetries) break;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      options.onRetry?.(lastError, attempt + 1, maxRetries);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError!;
}

export class StellavaultError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'StellavaultError';
  }

  format(): string {
    const lines = [`Error [${this.code}]: ${this.message}`];
    if (this.suggestion) lines.push(`  Fix: ${this.suggestion}`);
    if (this.cause) lines.push(`  Cause: ${this.cause.message}`);
    return lines.join('\n');
  }
}

export function wrapError(err: unknown, code: string, suggestion?: string): StellavaultError {
  const cause = err instanceof Error ? err : new Error(String(err));
  return new StellavaultError(cause.message, code, suggestion, cause);
}

// Common error factories
export const errors = {
  vaultNotFound: (path: string) =>
    new StellavaultError(`Vault not found: ${path}`, 'VAULT_NOT_FOUND', 'Check the path exists and contains .md files'),

  dbInitFailed: (err: unknown) =>
    wrapError(err, 'DB_INIT_FAILED', 'Delete ~/.stellavault/index.db and re-index'),

  embedderFailed: (err: unknown) =>
    wrapError(err, 'EMBEDDER_FAILED', 'Check disk space and try again. The model downloads on first run (~80MB)'),

  indexingFailed: (file: string, err: unknown) =>
    wrapError(err, 'INDEX_FAILED', `Skipping "${file}". Re-run indexing to retry failed files`),

  searchFailed: (err: unknown) =>
    wrapError(err, 'SEARCH_FAILED', 'Re-index your vault: stellavault index <path>'),

  configInvalid: (field: string) =>
    new StellavaultError(`Invalid config: ${field}`, 'CONFIG_INVALID', 'Check ~/.stellavault.json format'),

  apiServerFailed: (port: number, err: unknown) =>
    wrapError(err, 'API_SERVER_FAILED', `Port ${port} may be in use. Try: stellavault graph --port ${port + 1}`),
};
