// Fullscreen. iPhone Safari has no fullscreen API for pages: the only way to lose the browser bars is to run the
// game as a home-screen web app. Other browsers (Android, iPad, desktop) get the real fullscreen API on first tap.

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isStandalone = () => !!navigator.standalone ||
  matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsEnabled = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

/** request fullscreen + landscape lock where the browser allows it (must run inside a user gesture) */
export function enterFullscreen() {
  if (isStandalone() || fsEl() || !fsEnabled()) return;
  const de = document.documentElement;
  const p = (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de, { navigationUI: 'hide' });
  Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

let armed = false;
/** browsers with the fullscreen API: go fullscreen on every first tap after leaving it */
export function armAutoFullscreen() {
  if (armed || !fsEnabled()) return;
  armed = true;
  const go = () => { if (!fsEl()) enterFullscreen(); };
  addEventListener('pointerup', go, { capture: true });
  addEventListener('touchend', go, { capture: true });
}

const CSS = `
#a2hs { position: fixed; inset: 0; z-index: 200; display: flex; color: #f4ede6; overflow-y: auto;
  background: radial-gradient(ellipse at 50% 30%, #2b1530, #07060a 70%);
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
#a2hs .card { margin: auto; width: min(620px, 100%); display: flex; flex-direction: column; gap: 12px; }
#a2hs h1 { margin: 0; font-size: 24px; color: #ffcf3a; }
#a2hs ol { margin: 0; padding-left: 22px; line-height: 1.75; font-size: 16px; }
#a2hs ol b { color: #fff; background: #ffffff1f; padding: 1px 6px; border-radius: 5px; }
#a2hs .warn { font-size: 13px; color: #ffb0b0; line-height: 1.6; }
#a2hs .share { display: inline-block; width: 15px; height: 19px; vertical-align: -3px; }
#a2hs button { align-self: center; margin-top: 4px; padding: 9px 18px; border-radius: 10px; border: 1px solid #ffffff40;
  background: transparent; color: #bdb2a9; font-size: 14px; }
@media (max-height: 500px) { #a2hs h1 { font-size: 20px; } #a2hs ol { font-size: 14px; line-height: 1.55; } #a2hs .card { gap: 8px; } }
`;
const SHARE = `<svg class="share" viewBox="0 0 15 19" fill="none" stroke="#4da3ff" stroke-width="1.6"><path d="M7.5 1v11M3.5 5l4-4 4 4M5 8H1.5v10h12V8H10"/></svg>`;

/**
 * iPhone/iPad Safari tab: explain how to install the home-screen app (true fullscreen).
 * Resolves when the player chooses to keep playing in the browser.
 * Home-screen apps on iOS keep their own storage, so the guide comes before the IPA import.
 */
export function iosInstallGuide(alreadyImported) {
  if (!isIOS || isStandalone()) return Promise.resolve();
  try { if (sessionStorage.getItem('gm_a2hs_skip')) return Promise.resolve(); } catch { /* ignore */ }
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'a2hs';
    el.innerHTML = `
      <div class="card">
        <h1>全屏玩：先装到主屏幕</h1>
        <ol>
          <li>点 Safari 的 <b>${SHARE} 分享</b> 按钮（地址栏旁边，或先点「···」再找「分享」）</li>
          <li>往下滑，点 <b>添加到主屏幕</b></li>
          <li>确认 <b>作为网页 App 打开</b> 的开关是打开的，再点 <b>添加</b></li>
          <li>回到桌面，点 <b>孤胆车神</b> 图标打开：没有地址栏和边框，横屏全屏</li>
        </ol>
        <div class="warn">${alreadyImported
          ? '注意：主屏幕 App 和 Safari 的存储是分开的，第一次从桌面打开时需要再选一次 IPA 导入（之后就不用了）。'
          : '建议先装到主屏幕，再从桌面图标打开后导入 IPA：主屏幕 App 和 Safari 的存储是分开的，在这里导入的数据桌面 App 用不了。'}</div>
        <button type="button">先在浏览器里玩（有边框）</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('button').onclick = () => {
      try { sessionStorage.setItem('gm_a2hs_skip', '1'); } catch { /* ignore */ }
      el.remove(); style.remove(); resolve();
    };
  });
}
