// First-run screen: the player picks their own Gangstar IPA; everything is converted and stored on the device.
import * as store from './store.js';
import { useLocalAssets } from './assets.js';

const CSS = `
#importer { position: fixed; inset: 0; z-index: 50; background: radial-gradient(ellipse at 50% 30%, #2b1530, #07060a 70%); color: #f4ede6;
  display: flex; align-items: center; justify-content: center; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  overflow-y: auto; }
#importer .card { width: min(560px, 100%); display: flex; flex-direction: column; gap: 14px; }
#importer h1 { margin: 0; font: 900 clamp(34px, 7vw, 58px) / 1 "Arial Black", Impact, sans-serif; letter-spacing: 4px; transform: skewX(-8deg);
  color: #fff; text-shadow: 4px 4px 0 #ff2f87, 8px 8px 0 #000; }
#importer h2 { margin: -4px 0 6px; font-size: 18px; font-weight: 600; letter-spacing: 6px; color: #ffcf3a; }
#importer ol { margin: 0; padding-left: 20px; line-height: 1.7; font-size: 15px; color: #d9cfc6; }
#importer ol b { color: #fff; }
#importer .pick { position: relative; display: block; text-align: center; padding: 16px 20px; border-radius: 14px; border: 0; cursor: pointer;
  font: 700 20px -apple-system, "PingFang SC", sans-serif; color: #fff; background: linear-gradient(135deg, #ff2f87, #ff7a3a); box-shadow: 0 6px 24px #ff2f8755; }
#importer .pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
#importer .pick:focus-within { outline: 3px solid #ffcf3a; }
#importer .bar { height: 10px; border-radius: 6px; background: #ffffff1a; overflow: hidden; }
#importer .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff2f87, #ffcf3a); transition: width .3s; }
#importer .msg { font-size: 14px; color: #cbbfb5; min-height: 1.4em; }
#importer .err { font-size: 14px; color: #ff8a8a; white-space: pre-wrap; }
#importer .note { font-size: 12px; color: #9a8f86; line-height: 1.6; }
#importer [hidden] { display: none !important; }
`;

/** Show the import screen; resolves once the IPA is converted and stored (assets switch to local mode). */
export function runImport() {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'importer';
    el.innerHTML = `
      <div class="card">
        <h1>GANGSTAR</h1><h2>孤胆车神：雄霸迈阿密</h2>
        <ol>
          <li>用 Safari 下载你自己的 <b>Gangstar: Miami Vindication</b> 的 IPA 文件，存到「文件」App（下载完成后在「文件 → 下载项」里）。</li>
          <li>点下面的按钮，在「文件」里选中这个 <b>.ipa</b>。</li>
          <li>城市、车辆、角色、贴图和声音会在手机本地解包，只需一次，约几分钟；导入期间请保持屏幕常亮、不要切出页面。</li>
        </ol>
        <label class="pick" id="imp-pick">选择 IPA 文件<input type="file" id="imp-file" accept=".ipa,application/octet-stream,application/zip"></label>
        <div class="bar" id="imp-bar" hidden><i></i></div>
        <div class="msg" id="imp-msg" aria-live="polite"></div>
        <div class="err" id="imp-err" hidden></div>
        <div class="note">游戏素材只保存在这台设备的浏览器里，不会上传到任何服务器。导入后可以离线游玩；添加到主屏幕可全屏运行。</div>
      </div>`;
    document.body.appendChild(el);
    const $ = (id) => el.querySelector(id);
    const input = $('#imp-file');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      $('#imp-err').hidden = true;
      $('#imp-pick').hidden = true;
      $('#imp-bar').hidden = false;
      $('#imp-msg').textContent = `正在读取 ${file.name}（${(file.size / 1e6).toFixed(0)} MB）…`;
      let lock = null;
      try { lock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
      await store.persist();
      const t0 = performance.now();
      const worker = new Worker(new URL('./importer.worker.js', import.meta.url), { type: 'module' });
      const fail = (message) => {
        worker.terminate();
        lock?.release?.().catch?.(() => {});
        $('#imp-err').hidden = false;
        $('#imp-err').textContent = `导入失败：${message}\n请确认选择的是 Gangstar: Miami Vindication 的 IPA，再试一次。`;
        $('#imp-pick').hidden = false;
        $('#imp-bar').hidden = true;
        input.value = '';
      };
      worker.onerror = (ev) => fail(ev.message || '转换线程出错');
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'progress') {
          if (typeof m.p === 'number') $('#imp-bar i').style.width = Math.round(Math.max(0, Math.min(1, m.p)) * 100) + '%';
          if (m.msg) $('#imp-msg').textContent = m.msg;
        } else if (m.type === 'error') {
          console.error(m.stack || m.message);
          fail(m.message);
        } else if (m.type === 'done') {
          worker.terminate();
          lock?.release?.().catch?.(() => {});
          $('#imp-bar i').style.width = '100%';
          $('#imp-msg').textContent = `导入完成（${Math.round((performance.now() - t0) / 1000)} 秒）`;
          window.__importSeconds = (performance.now() - t0) / 1000;
          useLocalAssets();
          setTimeout(() => { el.remove(); style.remove(); resolve(); }, 400);
        }
      };
      worker.postMessage({ file });
    });
  });
}

/** settings → 重新导入: forget the imported files and show the import screen again */
export async function reimport() {
  await store.clear();
  location.reload();
}
