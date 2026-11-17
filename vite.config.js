import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // no auto-reload: several automated test sessions share one dev server
  server: { hmr: false },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000, target: 'es2020' },
});
