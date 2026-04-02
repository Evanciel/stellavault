// Design Ref: §12.1 F10 — 컨텍스트 스냅샷 (프로젝트별 지식 묶음)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import type { SearchEngine } from '../../search/index.js';

const SNAPSHOT_DIR = join(homedir(), '.stellavault', 'snapshots');

function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '');
  if (!sanitized) throw new Error('Invalid snapshot name');
  return sanitized;
}

function ensureWithinDir(dir: string, filePath: string): string {
  const resolved = resolve(dir, filePath);
  if (!resolved.startsWith(resolve(dir))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

export const createSnapshotToolDef = {
  name: 'create-snapshot',
  description: '현재 프로젝트 관련 지식을 스냅샷으로 저장합니다. 나중에 load-snapshot으로 즉시 컨텍스트 복원.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: '스냅샷 이름 (예: my-project-v1)' },
      queries: { type: 'array', items: { type: 'string' }, description: '관련 지식 검색 쿼리들' },
    },
    required: ['name', 'queries'],
  },
};

export const loadSnapshotToolDef = {
  name: 'load-snapshot',
  description: '저장된 스냅샷을 로드하여 프로젝트 컨텍스트를 즉시 복원합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: '스냅샷 이름' },
    },
    required: ['name'],
  },
};

export async function handleCreateSnapshot(
  searchEngine: SearchEngine,
  args: { name: string; queries: string[] },
) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const results = [];
  for (const query of args.queries) {
    const hits = await searchEngine.search({ query, limit: 5 });
    results.push(...hits.map(r => ({
      query,
      title: r.document.title,
      filePath: r.document.filePath,
      heading: r.chunk.heading,
      content: r.chunk.content.slice(0, 500),
      score: r.score,
    })));
  }

  // 중복 제거
  const seen = new Set<string>();
  const unique = results.filter(r => {
    const key = `${r.filePath}:${r.heading}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const snapshot = {
    name: args.name,
    createdAt: new Date().toISOString(),
    queries: args.queries,
    results: unique,
  };

  const safeName = sanitizeName(args.name);
  const filePath = ensureWithinDir(SNAPSHOT_DIR, `${safeName}.json`);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

  return { saved: filePath, resultCount: unique.length };
}

export async function handleLoadSnapshot(args: { name: string }) {
  const safeName = sanitizeName(args.name);
  const filePath = ensureWithinDir(SNAPSHOT_DIR, `${safeName}.json`);
  if (!existsSync(filePath)) {
    return { error: `Snapshot not found: ${args.name}` };
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}
