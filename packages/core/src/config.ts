// Design Ref: §10.2 — 설정 파일 구조 (.stellavault.json 로더)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

export interface FolderNames {
  fleeting: string;
  literature: string;
  permanent: string;
  wiki: string;
}

export interface StellavaultConfig {
  vaultPath: string;
  dbPath: string;
  folders: FolderNames;
  embedding: {
    model: 'local' | 'openai';
    localModel: string;
  };
  chunking: {
    maxTokens: number;
    overlap: number;
    minTokens: number;
  };
  search: {
    defaultLimit: number;
    rrfK: number;
    /** B3 §4 — per-signal RRF weights (semantic/bm25/entity). */
    weights?: { semantic?: number; bm25?: number; entity?: number };
    /** B3 §1.3 — strength of the FSRS recency multiplier (0 = off). */
    recencyWeight?: number;
    /** B2.2 — cross-lingual / abbreviation synonym groups for entity matching,
     *  e.g. { "자비스": ["jarvis"] }. Query terms expand to their synonyms. */
    entityAliases?: Record<string, string[]>;
  };
  mcp: {
    mode: 'stdio' | 'sse';
    port: number;
  };
}

export const DEFAULT_FOLDERS: FolderNames = {
  fleeting: 'raw',
  literature: '_literature',
  permanent: '_permanent',
  wiki: '_wiki',
};

const DEFAULT_CONFIG: StellavaultConfig = {
  vaultPath: '',
  dbPath: join(homedir(), '.stellavault', 'index.db'),
  folders: { ...DEFAULT_FOLDERS },
  embedding: {
    model: 'local',
    localModel: 'paraphrase-multilingual-MiniLM-L12-v2',
  },
  chunking: {
    maxTokens: 300,
    overlap: 50,
    minTokens: 50,
  },
  search: {
    defaultLimit: 10,
    rrfK: 60,
    weights: { semantic: 1.0, bm25: 1.0, entity: 1.5 }, // B2.1: entity leads (per-doc cap prevents flooding)
    recencyWeight: 0.2,                                  // B3 §1.3 (±10% bound)
    entityAliases: {},                                   // B2.2 — user-defined synonym groups
  },
  mcp: {
    mode: 'stdio',
    port: 3333,
  },
};

/**
 * .stellavault.json 파일을 찾아 로드합니다.
 * 탐색 순서: cwd → home directory → defaults
 */
export function loadConfig(configPath?: string): StellavaultConfig {
  const paths = configPath
    ? [resolve(configPath)]
    : [
        resolve(process.cwd(), '.stellavault.json'),
        join(homedir(), '.stellavault.json'),
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      return mergeConfig(DEFAULT_CONFIG, raw);
    }
  }

  return { ...DEFAULT_CONFIG };
}

function mergeConfig(defaults: StellavaultConfig, overrides: Partial<StellavaultConfig>): StellavaultConfig {
  return {
    vaultPath: overrides.vaultPath ?? defaults.vaultPath,
    dbPath: overrides.dbPath ?? defaults.dbPath,
    folders: { ...defaults.folders, ...overrides.folders },
    embedding: { ...defaults.embedding, ...overrides.embedding },
    chunking: { ...defaults.chunking, ...overrides.chunking },
    search: {
      ...defaults.search,
      ...overrides.search,
      // B3 §4 — deep-merge weights so a partial override keeps the other defaults.
      weights: { ...defaults.search.weights, ...overrides.search?.weights },
      // B2.2 — merge alias groups (override wins per-key).
      entityAliases: { ...defaults.search.entityAliases, ...overrides.search?.entityAliases },
    },
    mcp: { ...defaults.mcp, ...overrides.mcp },
  };
}

export interface SearchWeightConfig {
  semantic: number;
  bm25: number;
  entity: number;
  recency: number;
}

/**
 * Design Ref: B3 §4 — resolve final search weights from config + env overrides.
 * Pure and env-injectable for testability. Env vars override config; invalid,
 * empty, or out-of-range values fall back to config (then research-backed
 * defaults). Per project rule env values are .trim()'d and guarded;
 * recency is clamped to [0, 1].
 */
export function resolveSearchWeights(
  config: StellavaultConfig,
  env: Record<string, string | undefined> = process.env,
): SearchWeightConfig {
  const base: SearchWeightConfig = {
    semantic: config.search.weights?.semantic ?? 1.0,
    bm25: config.search.weights?.bm25 ?? 1.0,
    entity: config.search.weights?.entity ?? 1.5,
    recency: config.search.recencyWeight ?? 0.2,
  };
  const parse = (raw: string | undefined, min: number, max: number): number | undefined => {
    const s = String(raw ?? '').trim();
    if (s === '') return undefined; // unset/empty → keep config (Number('') is 0, not NaN)
    const n = Number(s);
    if (!Number.isFinite(n) || n < min) return undefined;
    return Math.min(n, max);
  };
  return {
    semantic: parse(env.STELLAVAULT_W_SEMANTIC, 0, Infinity) ?? base.semantic,
    bm25: parse(env.STELLAVAULT_W_BM25, 0, Infinity) ?? base.bm25,
    entity: parse(env.STELLAVAULT_W_ENTITY, 0, Infinity) ?? base.entity,
    recency: parse(env.STELLAVAULT_RECENCY_WEIGHT, 0, 1) ?? base.recency,
  };
}
