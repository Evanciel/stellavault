// CLI 번들링 — @stellavault/core를 단일 파일로 번들
// 네이티브 의존성만 external로 남김

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, readdirSync, copyFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read version from root package.json and inject at bundle time.
// This removes the hardcoded `.version('0.5.0')` drift problem.
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const SV_VERSION = rootPkg.version;

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
  define: {
    __SV_VERSION__: JSON.stringify(SV_VERSION),
  },
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "module";\nconst require = createRequire(import.meta.url);\n',
  },
  logLevel: 'info',
});

console.log(`✓ Bundled: dist/stellavault.js (v${SV_VERSION})`);

// Copy pre-built graph UI (vite build output) into dist/graph-ui/.
// This is what `stellavault graph` serves statically when installed from npm.
// Without this, the CLI falls back to spawning `npx vite` from a source tree
// that doesn't exist after `npm install`.
//
// NOTE: we intentionally avoid `cpSync({recursive:true})` here — on Windows
// it segfaults intermittently on this tree. Manual walk is stable.
function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

const graphDist = resolve(root, 'packages/graph/dist');
const graphUiOut = resolve(root, 'dist/graph-ui');

if (existsSync(graphDist)) {
  if (existsSync(graphUiOut)) rmSync(graphUiOut, { recursive: true, force: true });
  copyDirRecursive(graphDist, graphUiOut);
  console.log(`✓ Copied graph UI → dist/graph-ui/`);
} else {
  console.warn('⚠ packages/graph/dist not found — build @stellavault/graph first (vite build)');
  console.warn('  Published package will not include the 3D UI.');
  process.exit(1);
}
