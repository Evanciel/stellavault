// stellavault ingest — 통합 인제스트 (URL, 텍스트, 파일 → 자동 분류 저장)

import chalk from 'chalk';
import { loadConfig, ingest, promoteNote } from '@stellavault/core';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { IngestInput } from '@stellavault/core';

export async function ingestCommand(input: string, options: { tags?: string; stage?: string; title?: string }) {
  if (!input) {
    console.error(chalk.yellow('Usage: stellavault ingest <url|file|text> [--tags t1,t2] [--stage fleeting|literature|permanent]'));
    process.exit(1);
  }

  const config = loadConfig();
  const tags = options.tags?.split(',').map(t => t.trim()) ?? [];
  const stage = (options.stage ?? 'fleeting') as 'fleeting' | 'literature' | 'permanent';

  // 입력 타입 감지
  let ingestInput: IngestInput;

  if (/^https?:\/\//.test(input)) {
    // URL
    const isYouTube = /youtube\.com\/watch|youtu\.be\//.test(input);
    let content = input + '\n';

    // SSRF 방지: private IP 차단
    try {
      const url = new URL(input);
      const host = url.hostname;
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost|::1)/i.test(host)) {
        console.error(chalk.yellow('Private/local URLs are not allowed for security.'));
        process.exit(1);
      }
    } catch { /* invalid URL, will fail at fetch */ }

    // 웹 페이지 내용 가져오기 시도
    try {
      const resp = await fetch(input);
      const html = await resp.text();
      // 간단한 HTML → 텍스트 변환
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
      content += text;
    } catch { /* URL만 저장 */ }

    ingestInput = {
      type: isYouTube ? 'youtube' : 'url',
      content,
      tags,
      stage,
      title: options.title,
      source: input,
    };
  } else if (existsSync(input)) {
    // 파일
    const ext = extname(input).toLowerCase();
    const fileContent = readFileSync(input, 'utf-8');
    ingestInput = {
      type: ext === '.pdf' ? 'pdf-text' : 'file',
      content: fileContent,
      tags,
      stage,
      title: options.title,
      source: input,
    };
  } else {
    // 플레인 텍스트
    ingestInput = {
      type: 'text',
      content: input,
      tags,
      stage,
      title: options.title,
    };
  }

  const result = ingest(config.vaultPath, ingestInput);

  console.log(chalk.green(`Ingested: ${result.title}`));
  console.log(chalk.dim(`  Stage: ${result.stage}`));
  console.log(chalk.dim(`  Saved: ${result.savedTo}`));
  console.log(chalk.dim(`  Words: ${result.wordCount}`));
  if (result.indexCode) console.log(chalk.dim(`  Index: ${result.indexCode}`));
  if (result.tags.length > 0) console.log(chalk.dim(`  Tags: ${result.tags.join(', ')}`));
  console.log('');
  console.log(chalk.dim('Run `stellavault compile` to process into wiki.'));
  console.log(chalk.dim('Run `stellavault autopilot` for full pipeline.'));
}

export async function promoteCommand(filePath: string, options: { to: string }) {
  const config = loadConfig();
  const target = options.to as 'fleeting' | 'literature' | 'permanent';

  if (!['fleeting', 'literature', 'permanent'].includes(target)) {
    console.error(chalk.red('--to must be: fleeting, literature, or permanent'));
    process.exit(1);
  }

  const newPath = promoteNote(config.vaultPath, filePath, target);
  console.log(chalk.green(`Promoted to ${target}: ${newPath}`));
}
