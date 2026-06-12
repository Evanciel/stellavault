import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    // Monorepo hoisting hazard: tiptap-markdown lives in the ROOT node_modules
    // where @tiptap/core is v3 (graph package), while desktop nests v2. Without
    // dedupe the bundle gets BOTH cores → duplicate ProseMirror plugin crashes.
    // Same story for three (graph uses a different minor).
    dedupe: [
      '@tiptap/core',
      '@tiptap/pm',
      '@tiptap/suggestion',
      'prosemirror-state',
      'prosemirror-model',
      'prosemirror-view',
      'prosemirror-transform',
      'three',
    ],
  },
  plugins: [react()],
  build: {
    target: 'chrome130',
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
});
