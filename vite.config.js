import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // no auto-reload: several automated test sessions share one dev server
  server: { hmr: false },
  // NO_PUBLIC=1 skips copying the extracted assets (tools/pack_web.py packs them itself)
  publicDir: process.env.NO_PUBLIC ? false : 'public',
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000, target: 'es2020' },
});
