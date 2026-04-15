// Design Ref: §6 — Indexer (scanner: glob + frontmatter 파싱)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import type { Document } from '../types/document.js';

export type SkipReason = 'empty' | 'parse-error' | 'binary' | 'too-large' | 'unreadable';

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail?: string;
}

export interface ScanResult {
  documents: Document[];
  scannedFiles: number;
  skippedFiles: number;
  skipped: SkippedFile[];
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB safeguard

export function scanVault(vaultPath: string): ScanResult {
  const documents: Document[] = [];
  const skipped: SkippedFile[] = [];

  const mdFiles = findMdFiles(vaultPath);

  for (const filePath of mdFiles) {
    const rel = relative(vaultPath, filePath).replace(/\\/g, '/');
    try {
      const stat = statSync(filePath);
      if (stat.size === 0) {
        skipped.push({ path: rel, reason: 'empty' });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: 'too-large', detail: `${stat.size}B` });
        continue;
      }
      const doc = parseDocument(vaultPath, filePath);
      if (!doc.content || doc.content.trim().length === 0) {
        skipped.push({ path: rel, reason: 'empty', detail: 'no content after frontmatter' });
        continue;
      }
      documents.push(doc);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      const reason: SkipReason = /ENOENT|EACCES|EPERM/.test(msg) ? 'unreadable' : 'parse-error';
      skipped.push({ path: rel, reason, detail: msg.slice(0, 200) });
    }
  }

  return { documents, scannedFiles: mdFiles.length, skippedFiles: skipped.length, skipped };
}

function findMdFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'zh-CN') continue;
      findMdFiles(fullPath, files);
    } else if (extname(entry.name) === '.md') {
      files.push(fullPath);
    }
  }
  return files;
}

function parseDocument(vaultPath: string, filePath: string): Document {
  const raw = readFileSync(filePath, 'utf-8');
  const stat = statSync(filePath);
  const { data: frontmatter, content } = matter(raw);

  const relativePath = relative(vaultPath, filePath).replace(/\\/g, '/');
  const id = createHash('sha256').update(relativePath).digest('hex').slice(0, 16);
  const contentHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);

  const title = (frontmatter.title as string)
    ?? extractFirstHeading(content)
    ?? relativePath.replace(/\.md$/, '');

  const tags = extractTags(frontmatter, content);

  if (frontmatter.aliases) {
    const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [frontmatter.aliases];
    for (const alias of aliases) {
      if (typeof alias === 'string' && alias.length > 1) tags.push(alias);
    }
  }

  const source = inferSource(frontmatter, relativePath);
  const type = inferType(frontmatter, relativePath);

  const fmDate = frontmatter.date ?? frontmatter.created ?? frontmatter.created_at;
  const lastModified = fmDate ? new Date(fmDate as string).toISOString() : stat.mtime.toISOString();

  return {
    id,
    filePath: relativePath,
    title,
    content,
    frontmatter,
    tags,
    lastModified,
    contentHash,
    source,
    type,
  };
}

function inferSource(frontmatter: Record<string, unknown>, filePath: string): string {
  if (frontmatter.source && typeof frontmatter.source === 'string') {
    if (frontmatter.source.startsWith('http')) return 'clip';
    return frontmatter.source;
  }
  if (filePath.includes('clips/') || filePath.includes('clip/')) return 'clip';
  if (filePath.includes('PDCA') || filePath.includes('pdca')) return 'local';
  if (frontmatter['x-i18n']) return 'notion';
  if (frontmatter.clipped) return 'clip';
  return 'local';
}

function inferType(frontmatter: Record<string, unknown>, filePath: string): string {
  if (frontmatter.type && typeof frontmatter.type === 'string') return frontmatter.type;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  if (tags.includes('bridge') || tags.includes('auto-generated')) return 'bridge';
  if (tags.includes('clip') || tags.includes('youtube')) return 'clip';
  if (tags.includes('decision')) return 'decision';
  if (filePath.includes('clips/')) return 'clip';
  if (filePath.includes('Decisions/') || filePath.includes('decisions/')) return 'decision';
  if (filePath.includes('Sessions/') || filePath.includes('sessions/')) return 'session';
  if (filePath.includes('Research/')) return 'research';
  if (filePath.includes('Lessons/')) return 'lesson';
  if (filePath.includes('Templates/')) return 'template';
  return 'note';
}

function extractFirstHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractTags(frontmatter: Record<string, unknown>, content: string): string[] {
  const tags = new Set<string>();

  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    fmTags.forEach(t => tags.add(String(t)));
  } else if (typeof fmTags === 'string') {
    fmTags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
  }

  const inlineTags = content.match(/(?:^|\s)#([a-zA-Z가-힣][a-zA-Z가-힣\w-]*)/g);
  if (inlineTags) {
    for (const raw of inlineTags) {
      const tag = raw.trim().slice(1);
      if (/^[0-9a-fA-F]{3,8}$/.test(tag)) continue;
      tags.add(tag);
    }
  }

  return [...tags];
}
