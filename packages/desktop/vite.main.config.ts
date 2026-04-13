import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// All native + problematic packages that must stay as require() at runtime.
// Vite's Rollup bundler can't handle native addons or some ESM edge cases.
const external = [
  'electron',
  'better-sqlite3',
  'sqlite-vec',
  '@xenova/transformers',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
  'sharp',
  'unpdf',
  'mammoth',
  'officeparser',
  'xlsx',
  'express',
  'cors',
  'multer',
  'chokidar',
  'gray-matter',
  'hyperswarm',
  'b4a',
  'open',
  // Node built-ins
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  build: {
    rollupOptions: { external },
  },
  resolve: {
    conditions: ['node'],
  },
});
