'use strict';
// Sandboxed, isolated preload. No native API or IPC capability is exposed to the device.
const {ipcRenderer,contextBridge} = require('electron');
const mediaArgument=process.argv.find(argument=>argument.startsWith('--workspace-media='));
if (mediaArgument) {
  const source=new TextDecoder().decode(Uint8Array.from(atob(mediaArgument.slice('--workspace-media='.length)),character=>character.charCodeAt(0)));
  // Synchronous main-world installation precedes firmware head scripts. The
  // function contains browser-only code and exposes no native capability.
  contextBridge.executeInMainWorld({func:new Function(source)});
}
/** @type {Map<number,Element>} */
const buttons = new Map();
/** @type {Map<string,{key:string,code:string,target:EventTarget}>} */
const keys = new Map();
window.addEventListener('mousedown',(event) => { if (event.target instanceof Element) buttons.set(event.button,event.target); },true);
window.addEventListener('mouseup',(event) => { buttons.delete(event.button); },true);
window.addEventListener('keydown',(event) => { if (!event.repeat && event.target instanceof EventTarget) keys.set(event.code,{key:event.key,code:event.code,target:event.target}); },true);
window.addEventListener('keyup',(event) => { keys.delete(event.code); },true);
function releaseButtons() {
  for (const [button,target] of buttons) target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button,buttons:0}));
  buttons.clear();
}
window.addEventListener('mouseout',(event) => {
  const stream = event.target instanceof Element ? event.target.closest('#stream-box') : null;
  if (stream && !(event.relatedTarget instanceof Node && stream.contains(event.relatedTarget))) releaseButtons();
},true);
function releaseInput() {
  releaseButtons();
  for (const {key,code,target} of keys.values()) target.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key,code}));
  keys.clear();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (document.pointerLockElement) document.exitPointerLock();
}
ipcRenderer.on('session:release-input',releaseInput);
window.addEventListener('blur',releaseInput);
window.addEventListener('pagehide',releaseInput);

// A frame counter is a liveness signal; document load alone is not one.
window.addEventListener('DOMContentLoaded',() => {
  const badge = document.createElement('div');
  badge.setAttribute('role','status');
  badge.style.cssText='position:fixed;right:12px;top:60px;z-index:2147483647;padding:5px 9px;border-radius:6px;background:#342b13;color:#ffe0a0;font:12px system-ui;pointer-events:none';
  document.body.append(badge);
  let lastFrame = -1, lastChange = performance.now(), hadVideo = false;
  const timer = setInterval(() => {
    const video = document.querySelector('video');
    const canvas = document.querySelector('#stream-canvas');
    if (canvas && canvas.getClientRects().length && getComputedStyle(canvas).visibility !== 'hidden') {
      badge.textContent='Direct mode — audio unavailable; frame liveness not monitored'; badge.style.display='block'; return;
    }
    const frames = video?.getVideoPlaybackQuality().totalVideoFrames ?? 0;
    if (frames !== lastFrame && frames > 0) { lastChange=performance.now(); lastFrame=frames; hadVideo=true; }
    const stale = hadVideo && performance.now()-lastChange>5000;
    if (stale) { badge.textContent='No recent frames — video may be stalled'; badge.style.display='block'; }
    else if (hadVideo && video?.readyState >= 2) badge.style.display='none';
    else { badge.textContent=document.querySelector('input[type=password]') ? 'Authentication required' : 'Waiting for live video'; badge.style.display='block'; }
  },1000);
  window.addEventListener('pagehide',() => clearInterval(timer),{once:true});
});
