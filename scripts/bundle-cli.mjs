// CLI 번들링 — @stellavault/core를 단일 파일로 번들
// 네이티브 의존성만 external로 남김

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 네이티브 바이너리가 있는 패키지만 external
const external = [
  'better-sqlite3',
  'sqlite-vec',
  '@xenova/transformers',
  'sharp',
  'unpdf',
  'mammoth',
  'officeparser',
  'xlsx',
  'multer',
  'express',
  'cors',
  'chokidar',
  'gray-matter',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
  'chalk',
  'commander',
  'open',
  'ora',
  'hyperswarm',
  'b4a',
];

await build({
  entryPoints: [resolve(root, 'packages/cli/dist/index.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(root, 'dist/stellavault.js'),
  external,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "module";\nconst require = createRequire(import.meta.url);\n',
  },
  logLevel: 'info',
});

console.log('✓ Bundled: dist/stellavault.js');
