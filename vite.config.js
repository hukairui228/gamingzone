import { defineConfig } from 'vite';
import { copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PAGES=1 → public GitHub Pages build in docs/: code + self-made icons only, never public/assets (game files come from the player's IPA)
const PAGES = !!process.env.PAGES;
const PAGES_FILES = ['manifest.webmanifest', 'sw.js', 'app-icon-192.png', 'app-icon-512.png', 'apple-touch-icon.png'];

const pagesShell = {
  name: 'pages-shell',
  apply: 'build',
  closeBundle() {
    const out = resolve(__dirname, 'docs');
    for (const f of PAGES_FILES) copyFileSync(resolve(__dirname, 'public', f), resolve(out, f));
    writeFileSync(resolve(out, '.nojekyll'), '');
  },
};

export default defineConfig({
  base: './',
  // no auto-reload: several automated test sessions share one dev server
  server: { hmr: false },
  // NO_PUBLIC=1 skips copying the extracted assets (tools/pack_web.py packs them itself)
  publicDir: PAGES || process.env.NO_PUBLIC ? false : 'public',
  worker: { format: 'es' },
  plugins: PAGES ? [pagesShell] : [],
  build: { outDir: PAGES ? 'docs' : 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000, target: 'es2020' },
});
