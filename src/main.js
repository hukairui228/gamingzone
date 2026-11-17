import { Game } from './game.js';

const game = new Game();
window.__game = game;
game.boot().catch((e) => {
  console.error(e);
  const m = document.querySelector('#loading .msg');
  if (m) m.textContent = '载入失败：' + e.message;
});
