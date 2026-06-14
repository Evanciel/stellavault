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
    rollupOptions: {
      output: {
        // T2-12: split the heavy, rarely-on-startup deps into their own chunks so
        // they parse/compile lazily (paired with React.lazy on the graph views).
        //   - three/fiber/drei → "three": only needed when the graph opens
        //   - tiptap/prosemirror → "tiptap": the editor, loaded with the first note
        //   - everything else in node_modules → "vendor"
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/three/') ||
            id.includes('/three-stdlib/') ||
            id.includes('@react-three/') ||
            id.includes('/troika') // troika-* text deps if pulled in transitively
          ) {
            return 'three';
          }
          if (id.includes('@tiptap/') || id.includes('prosemirror') || id.includes('tiptap-markdown')) {
            return 'tiptap';
          }
          return 'vendor';
        },
      },
    },
  },
});
