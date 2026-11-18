import { modeReady } from './assets.js';

function bootError(e) {
  console.error(e);
  const m = document.querySelector('#loading .msg');
  if (m) m.textContent = '载入失败：' + e.message;
}

(async () => {
  // packs (claude deploy) / http (dev server) / local (imported IPA in IndexedDB) / none → import screen
  const mode = await modeReady;
  const fs = await import('./fullscreen.js');
  fs.armAutoFullscreen();
  if (mode === 'none' || mode === 'local') {
    const loading = document.getElementById('loading');
    if (loading) loading.style.visibility = 'hidden';
    await fs.iosInstallGuide(mode === 'local');
    if (loading) loading.style.visibility = '';
  }
  if (mode === 'none') {
    const loading = document.getElementById('loading');
    if (loading) loading.style.visibility = 'hidden';
    await (await import('./importer.js')).runImport();
    if (loading) loading.style.visibility = '';
  }
  const { Game } = await import('./game.js');
  const game = new Game();
  window.__game = game;
  await game.boot();
})().catch(bootError);

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
