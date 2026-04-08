// stellavault ingest — 통합 인제스트 (URL, 텍스트, 파일 → 자동 분류 저장)

import chalk from 'chalk';
import { loadConfig, ingest, promoteNote } from '@stellavault/core';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve, join } from 'node:path';
import type { IngestInput } from '@stellavault/core';

export async function ingestCommand(input: string, options: { tags?: string; stage?: string; title?: string }) {
  if (!input) {
    console.error(chalk.yellow('Usage: stellavault ingest <url|file|text|folder/> [--tags t1,t2]'));
    process.exit(1);
  }

  // 배치 모드: 폴더 경로이면 내부 파일 전부 처리
  if (existsSync(input) && statSync(input).isDirectory()) {
    const files = readdirSync(input)
      .filter(f => /\.(md|txt|pdf|docx|pptx|xlsx|xls|csv|json|xml|html|htm|yaml|yml|rtf)$/i.test(f))
      .map(f => join(input, f));

    if (files.length === 0) {
      console.error(chalk.yellow(`No supported files found in ${input}`));
      process.exit(1);
    }

    console.log(chalk.dim(`Batch ingest: ${files.length} files from ${input}\n`));
    let success = 0;
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.split(/[/\\]/).pop() ?? file;
      const progress = `[${i + 1}/${files.length}]`;
      process.stderr.write(`\r${chalk.dim(progress)} ${name}...`);
      try {
        await ingestSingleFile(file, options);
        success++;
      } catch (err) {
        failed.push(`${name}: ${err instanceof Error ? err.message : 'error'}`);
      }
    }
    process.stderr.write('\r' + ' '.repeat(80) + '\r');
    console.log(chalk.green(`Batch complete: ${success}/${files.length} files ingested`));
    if (failed.length > 0) {
      console.log(chalk.yellow(`\nFailed (${failed.length}):`));
      for (const f of failed) console.log(chalk.yellow(`  - ${f}`));
    }
    return;
  }

  await ingestSingleFile(input, options);
}

/** 캐시된 config (배치 시 반복 로드 방지) */
let _configCache: ReturnType<typeof loadConfig> | null = null;
function getConfig() { return _configCache ?? (_configCache = loadConfig()); }

/** 단일 파일/URL/텍스트 인제스트 (배치에서 재사용) */
async function ingestSingleFile(input: string, options: { tags?: string; stage?: string; title?: string }) {
  const config = getConfig();
  const tags = options.tags?.split(',').map(t => t.trim()) ?? [];
  const stage = (options.stage ?? 'fleeting') as 'fleeting' | 'literature' | 'permanent';

  // 입력 타입 감지
  let ingestInput: IngestInput;

  if (/^https?:\/\//.test(input)) {
    // URL
    const isYouTube = /youtube\.com\/watch|youtu\.be\//.test(input);

    // SSRF 방지: private IP 차단
    try {
      const url = new URL(input);
      const host = url.hostname;
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost|::1)/i.test(host)) {
        console.error(chalk.yellow('Private/local URLs are not allowed for security.'));
        process.exit(1);
      }
    } catch { /* invalid URL, will fail at fetch */ }

    if (isYouTube) {
      // YouTube: 전용 추출기 사용 (메타데이터 + 자막 + 타임스탬프)
      try {
        const { extractYouTubeContent, formatYouTubeNote } = await import('@stellavault/core/intelligence/youtube-extractor');
        const ytContent = await extractYouTubeContent(input);
        const body = formatYouTubeNote(ytContent);
        ingestInput = {
          type: 'youtube',
          content: input + '\n' + body,
          tags: [...tags, ...ytContent.tags.filter((t: string) => !tags.includes(t))],
          stage: stage === 'fleeting' ? 'literature' : stage, // YouTube는 literature로 자동 승격
          title: options.title ?? ytContent.title,
          source: input,
        };
      } catch (err) {
        console.error(chalk.yellow(`YouTube extraction failed, falling back to basic URL. (${err instanceof Error ? err.message : 'error'})`));
        ingestInput = {
          type: 'youtube',
          content: input + '\n',
          tags,
          stage,
          title: options.title,
          source: input,
        };
      }
    } else {
      // 일반 URL: HTML → 텍스트 변환
      let content = input + '\n';
      try {
        const resp = await fetch(input, { signal: AbortSignal.timeout(15000) });
        const html = (await resp.text()).slice(0, 500000); // 500KB max
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        content += text;
      } catch (err) {
        console.error(chalk.yellow(`Web fetch failed: saving URL only. (${err instanceof Error ? err.message : 'network error'})`));
      }
      ingestInput = {
        type: 'url',
        content,
        tags,
        stage,
        title: options.title,
        source: input,
      };
    }
  } else if (existsSync(input)) {
    // 파일
    const ext = extname(input).toLowerCase();
    const binaryExts = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.xls']);
    const structuredExts = new Set(['.json', '.csv', '.xml', '.html', '.htm', '.yaml', '.yml', '.rtf']);

    if (binaryExts.has(ext)) {
      // 바이너리 파일: 전용 파서로 텍스트 추출
      try {
        const { extractFileContent } = await import('@stellavault/core/intelligence/file-extractors');
        const extracted = await extractFileContent(resolve(input));
        console.log(chalk.dim(`  Extracted ${extracted.metadata.wordCount} words from ${ext} file`));
        ingestInput = {
          type: extracted.sourceFormat as IngestInput['type'],
          content: extracted.text,
          tags: [...tags, extracted.sourceFormat],
          stage,  // 제텔카스텐: 모든 인풋은 fleeting에서 시작
          title: options.title ?? extracted.metadata.title,
          source: input,
        };
      } catch (err) {
        console.error(chalk.yellow(`Binary file extraction failed, saving as-is. (${err instanceof Error ? err.message : 'error'})`));
        ingestInput = {
          type: 'file',
          content: readFileSync(input, 'utf-8'),
          tags,
          stage,
          title: options.title,
          source: input,
        };
      }
    } else if (structuredExts.has(ext)) {
      // 구조화 파일: 전용 파서로 포맷 보존
      try {
        const { extractFileContent } = await import('@stellavault/core/intelligence/file-extractors');
        const extracted = await extractFileContent(resolve(input));
        console.log(chalk.dim(`  Extracted ${extracted.metadata.wordCount} words from ${ext} file`));
        ingestInput = {
          type: 'file' as IngestInput['type'],
          content: extracted.text,
          tags: [...tags, ext.slice(1)],
          stage,
          title: options.title ?? extracted.metadata.title,
          source: input,
        };
      } catch (err) {
        const fileContent = readFileSync(input, 'utf-8');
        ingestInput = { type: 'file', content: fileContent, tags, stage, title: options.title, source: input };
      }
    } else {
      // 텍스트 파일: 기존 동작
      const fileContent = readFileSync(input, 'utf-8');
      ingestInput = {
        type: 'file',
        content: fileContent,
        tags,
        stage,
        title: options.title,
        source: input,
      };
    }
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
  console.log(chalk.dim('  Wiki: auto-compiled'));
  console.log('');
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
