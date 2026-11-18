import{p as f,u as c,c as x}from"./index-CMI6zOUF.js";const h=`
#importer { position: fixed; inset: 0; z-index: 50; background: radial-gradient(ellipse at 50% 30%, #2b1530, #07060a 70%); color: #f4ede6;
  display: flex; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  overflow-y: auto; }
#importer .card { margin: auto; width: min(560px, 100%); display: flex; flex-direction: column; gap: 14px; }
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
@media (max-height: 500px) {
  #importer .card { gap: 8px; width: min(680px, 100%); }
  #importer h1 { font-size: 32px; } #importer h2 { font-size: 14px; margin: 0; }
  #importer ol { font-size: 13px; line-height: 1.5; } #importer .pick { padding: 11px; font-size: 17px; }
}
#importer [hidden] { display: none !important; }
`;function u(){return new Promise(l=>{const p=document.createElement("style");p.textContent=h,document.head.appendChild(p);const r=document.createElement("div");r.id="importer",r.innerHTML=`
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
        <div class="note">游戏素材只保存在这台设备的浏览器里，不会上传到任何服务器。导入后可以离线游玩。</div>
      </div>`,document.body.appendChild(r);const e=t=>r.querySelector(t),n=e("#imp-file");n.addEventListener("change",async()=>{const t=n.files&&n.files[0];if(!t)return;e("#imp-err").hidden=!0,e("#imp-pick").hidden=!0,e("#imp-bar").hidden=!1,e("#imp-msg").textContent=`正在读取 ${t.name}（${(t.size/1e6).toFixed(0)} MB）…`;let s=null;try{s=await navigator.wakeLock?.request("screen")}catch{}await f();const m=performance.now(),a=new Worker(new URL(""+new URL("importer.worker-BnNy8qKW.js",import.meta.url).href,import.meta.url),{type:"module"}),d=o=>{a.terminate(),s?.release?.().catch?.(()=>{}),e("#imp-err").hidden=!1,e("#imp-err").textContent=`导入失败：${o}
请确认选择的是 Gangstar: Miami Vindication 的 IPA，再试一次。`,e("#imp-pick").hidden=!1,e("#imp-bar").hidden=!0,n.value=""};a.onerror=o=>d(o.message||"转换线程出错"),a.onmessage=o=>{const i=o.data;i.type==="progress"?(typeof i.p=="number"&&(e("#imp-bar i").style.width=Math.round(Math.max(0,Math.min(1,i.p))*100)+"%"),i.msg&&(e("#imp-msg").textContent=i.msg)):i.type==="error"?(console.error(i.stack||i.message),d(i.message)):i.type==="done"&&(a.terminate(),s?.release?.().catch?.(()=>{}),e("#imp-bar i").style.width="100%",e("#imp-msg").textContent=`导入完成（${Math.round((performance.now()-m)/1e3)} 秒）`,window.__importSeconds=(performance.now()-m)/1e3,c(),setTimeout(()=>{r.remove(),p.remove(),l()},400))},a.postMessage({file:t})})})}async function b(){await x(),location.reload()}export{b as reimport,u as runImport};
