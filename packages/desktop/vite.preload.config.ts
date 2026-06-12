import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
      output: {
        // plugin-vite's default is '[name].js' → src/preload/index.ts becomes
        // .vite/build/index.js, which COLLIDES with the main bundle (same name,
        // same outDir) — whichever builds last silently erases the other, so the
        // packaged app had no preload at all (renderer crash → black window).
        entryFileNames: 'preload.js',
      },
    },
  },
});
