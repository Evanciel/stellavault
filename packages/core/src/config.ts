// Design Ref: §10.2 — 설정 파일 구조 (.stellavault.json 로더)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

export interface StellavaultConfig {
  vaultPath: string;
  dbPath: string;
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
  };
  mcp: {
    mode: 'stdio' | 'sse';
    port: number;
  };
}

const DEFAULT_CONFIG: StellavaultConfig = {
  vaultPath: '',
  dbPath: join(homedir(), '.stellavault', 'index.db'),
  embedding: {
    model: 'local',
    localModel: 'all-MiniLM-L6-v2',
  },
  chunking: {
    maxTokens: 300,
    overlap: 50,
    minTokens: 50,
  },
  search: {
    defaultLimit: 10,
    rrfK: 60,
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
    embedding: { ...defaults.embedding, ...overrides.embedding },
    chunking: { ...defaults.chunking, ...overrides.chunking },
    search: { ...defaults.search, ...overrides.search },
    mcp: { ...defaults.mcp, ...overrides.mcp },
  };
}
