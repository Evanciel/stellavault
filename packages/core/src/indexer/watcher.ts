// Design Ref: §6.3 — 파일 감시 + 증분 인덱싱 (debounce 5s)

import { watch, type FSWatcher } from 'chokidar';
import { extname } from 'node:path';
import type { Embedder } from './embedder.js';
import type { VectorStore } from '../store/types.js';
import { indexVault, type IndexResult } from './index.js';
import type { ChunkOptions } from './chunker.js';

export interface WatcherOptions {
  vaultPath: string;
  store: VectorStore;
  embedder: Embedder;
  chunkOptions?: Partial<ChunkOptions>;
  debounceMs?: number;
  /**
   * 🔴 결과를 <통째로> 넘긴다. 예전에는 두 필드만 뽑아 넘겨서, 감시자가 만든
   *    미룬 삭제(deferredDeletes)와 "남의 DB 라 아무것도 안 했다"(foreignDb)가
   *    호출부에 <도달하지 못했다> — 배치가 조용히 아무 일도 안 해도 로그는
   *    "0 indexed, 0 unchanged" 로 정상처럼 보였다 (코덱스 10차 P2).
   */
  onReindex?: (result: IndexResult) => void;
}

export function createWatcher(options: WatcherOptions): { start(): void; stop(): void } {
  const { vaultPath, store, embedder, chunkOptions, debounceMs = 5000, onReindex } = options;
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reindexing = false;
  // Codex 2026-05-15: reindex 중 들어온 이벤트를 'drop' 하면 stale DB 가
  // 남음. pendingReindex 로 마킹해서 현재 reindex 종료 직후 한 번 더 돌게.
  let pendingReindex = false;

  async function triggerReindex() {
    if (reindexing) {
      pendingReindex = true;
      return;
    }
    reindexing = true;
    try {
      do {
        pendingReindex = false; // 시작 직전 reset — 이번 iteration 안에서
                                // 새 이벤트가 오면 또 true 가 됨
        const result = await indexVault(vaultPath, { store, embedder, chunkOptions });
        onReindex?.(result);          // 🔴 깎지 않는다 — 여기서 미룬 삭제가 사라졌다
      } while (pendingReindex);
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
