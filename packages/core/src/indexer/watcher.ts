// Design Ref: §6.3 — 파일 감시 + 증분 인덱싱 (debounce 5s)

import { watch, type FSWatcher } from 'chokidar';
import { extname } from 'node:path';
import type { Embedder } from './embedder.js';
import type { VectorStore } from '../store/types.js';
import { indexVault } from './index.js';
import type { ChunkOptions } from './chunker.js';

export interface WatcherOptions {
  vaultPath: string;
  store: VectorStore;
  embedder: Embedder;
  chunkOptions?: Partial<ChunkOptions>;
  debounceMs?: number;
  onReindex?: (result: { indexed: number; skipped: number }) => void;
}

export function createWatcher(options: WatcherOptions): { start(): void; stop(): void } {
  const { vaultPath, store, embedder, chunkOptions, debounceMs = 5000, onReindex } = options;
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reindexing = false;

  async function triggerReindex() {
    if (reindexing) return;
    reindexing = true;
    try {
      const result = await indexVault(vaultPath, { store, embedder, chunkOptions });
      onReindex?.({ indexed: result.indexed, skipped: result.skipped });
    } finally {
      reindexing = false;
    }
  }

  function scheduleReindex() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => triggerReindex(), debounceMs);
  }

  return {
    start() {
      watcher = watch(vaultPath, {
        ignored: /(^|[\/\\])\.|node_modules/,
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('all', (event, path) => {
        if (extname(path) !== '.md') return;
        if (['add', 'change', 'unlink'].includes(event)) {
          scheduleReindex();
        }
      });
    },

    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
    },
  };
}
