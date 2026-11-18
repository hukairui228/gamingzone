const i=navigator.userAgent,d=/iPhone|iPad|iPod/.test(i)||/Macintosh/.test(i)&&navigator.maxTouchPoints>1,o=()=>!!navigator.standalone||matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches,r=()=>document.fullscreenElement||document.webkitFullscreenElement,l=()=>!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);function c(){if(o()||r()||!l())return;const e=document.documentElement,n=(e.requestFullscreen||e.webkitRequestFullscreen)?.call(e,{navigationUI:"hide"});Promise.resolve(n).then(()=>screen.orientation?.lock?.("landscape").catch(()=>{})).catch(()=>{})}let s=!1;function u(){if(s||!l())return;s=!0;const e=()=>{r()||c()};addEventListener("pointerup",e,{capture:!0}),addEventListener("touchend",e,{capture:!0})}const p=`
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
`,f='<svg class="share" viewBox="0 0 15 19" fill="none" stroke="#4da3ff" stroke-width="1.6"><path d="M7.5 1v11M3.5 5l4-4 4 4M5 8H1.5v10h12V8H10"/></svg>';function h(e){if(!d||o())return Promise.resolve();try{if(sessionStorage.getItem("gm_a2hs_skip"))return Promise.resolve()}catch{}return new Promise(n=>{const a=document.createElement("style");a.textContent=p,document.head.appendChild(a);const t=document.createElement("div");t.id="a2hs",t.innerHTML=`
      <div class="card">
        <h1>全屏玩：先装到主屏幕</h1>
        <ol>
          <li>点 Safari 的 <b>${f} 分享</b> 按钮（地址栏旁边，或先点「···」再找「分享」）</li>
          <li>往下滑，点 <b>添加到主屏幕</b></li>
          <li>确认 <b>作为网页 App 打开</b> 的开关是打开的，再点 <b>添加</b></li>
          <li>回到桌面，点 <b>孤胆车神</b> 图标打开：没有地址栏和边框，横屏全屏</li>
        </ol>
        <div class="warn">${e?"注意：主屏幕 App 和 Safari 的存储是分开的，第一次从桌面打开时需要再选一次 IPA 导入（之后就不用了）。":"建议先装到主屏幕，再从桌面图标打开后导入 IPA：主屏幕 App 和 Safari 的存储是分开的，在这里导入的数据桌面 App 用不了。"}</div>
        <button type="button">先在浏览器里玩（有边框）</button>
      </div>`,document.body.appendChild(t),t.querySelector("button").onclick=()=>{try{sessionStorage.setItem("gm_a2hs_skip","1")}catch{}t.remove(),a.remove(),n()}})}export{u as armAutoFullscreen,c as enterFullscreen,h as iosInstallGuide,d as isIOS,o as isStandalone};
