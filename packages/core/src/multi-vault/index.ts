// Cross-Vault Federation (P3-F24)
// 한 사람의 여러 vault를 통합 검색

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { VectorStore } from '../store/types.js';
import type { Embedder } from '../indexer/embedder.js';
import type { ScoredChunk } from '../types/chunk.js';

export interface VaultEntry {
  id: string;          // short alias
  name: string;        // display name
  path: string;        // vault path
  dbPath: string;      // index.db path
  shared: boolean;     // 공유 허용 여부 (Federation에서)
  addedAt: string;
}

export interface CrossVaultSearchResult {
  vaultId: string;
  vaultName: string;
  title: string;
  score: number;
  snippet: string;
  filePath: string;
}

const VAULTS_FILE = join(homedir(), '.stellavault', 'vaults.json');

function loadVaults(): VaultEntry[] {
  if (!existsSync(VAULTS_FILE)) return [];
  return JSON.parse(readFileSync(VAULTS_FILE, 'utf-8'));
}

function saveVaults(vaults: VaultEntry[]): void {
  mkdirSync(join(homedir(), '.stellavault'), { recursive: true });
  writeFileSync(VAULTS_FILE, JSON.stringify(vaults, null, 2), 'utf-8');
}

export function addVault(id: string, name: string, vaultPath: string, dbPath: string, shared = false): VaultEntry {
  const vaults = loadVaults();
  if (vaults.some(v => v.id === id)) {
    throw new Error(`Vault "${id}" already exists`);
  }
  const entry: VaultEntry = { id, name, path: vaultPath, dbPath, shared, addedAt: new Date().toISOString() };
  vaults.push(entry);
  saveVaults(vaults);
  return entry;
}

export function removeVault(id: string): boolean {
  const vaults = loadVaults();
  const filtered = vaults.filter(v => v.id !== id);
  if (filtered.length === vaults.length) return false;
  saveVaults(filtered);
  return true;
}

export function listVaults(): VaultEntry[] {
  return loadVaults();
}

export function getVault(id: string): VaultEntry | undefined {
  return loadVaults().find(v => v.id === id);
}

// 모든 vault를 통합 검색
export async function searchAllVaults(
  query: string,
  embedder: Embedder,
  createStore: (dbPath: string) => VectorStore,
  options: { limit?: number } = {},
): Promise<CrossVaultSearchResult[]> {
  const { limit = 10 } = options;
  const vaults = loadVaults();
  const results: CrossVaultSearchResult[] = [];

  // 쿼리 임베딩 (한 번만)
  const embedding = await embedder.embed(query);

  // 각 vault에서 병렬 검색
  const searches = vaults.map(async (vault) => {
    try {
      if (!existsSync(vault.dbPath)) return;

      const store = createStore(vault.dbPath);
      await store.initialize();

      const scored = await store.searchSemantic(embedding, limit);

      for (const s of scored) {
        const chunk = await store.getChunk(s.chunkId);
        if (!chunk) continue;
        const doc = await store.getDocument(chunk.documentId);

        results.push({
          vaultId: vault.id,
          vaultName: vault.name,
          title: doc?.title ?? 'Untitled',
          score: s.score,
          snippet: chunk.content.slice(0, 80),
          filePath: doc?.filePath ?? '',
        });
      }

      await store.close();
    } catch {
      // vault 접근 실패 시 건너뜀
    }
  });

  await Promise.allSettled(searches);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
