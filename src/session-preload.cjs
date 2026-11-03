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

// Keep desired output separate from firmware defaults, Direct mode, and teardown.
// No IPC bridge is exposed to the device's main world.
window.addEventListener('DOMContentLoaded',async () => {
  /** @type {boolean | null} */
  let desired=null;
  let loaded=false, applied=false, userChoice=false, stopped=false, wasDirect=false;
  let deadline=0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  /** @param {string} message */
  function warn(message) {
    console.error('[workspace] sound output:',message);
    const notice=document.createElement('div');
    notice.setAttribute('role','alert');notice.textContent=message;
    notice.style.cssText='position:fixed;bottom:48px;left:16px;z-index:2147483647;padding:10px;background:#432;color:#ffe3b3;font:13px system-ui';
    document.body.append(notice);
  }
  /** @param {Element | null} control @returns {boolean | null} */
  function outputState(control) {
    const use=control?.querySelector('use');
    const href=use?.getAttribute('href') || use?.getAttributeNS('http://www.w3.org/1999/xlink','href');
    return href==='#gl-kvm-sound-full'?true:href==='#gl-kvm-sound-off'?false:null;
  }
  function restore() {
    if (stopped || !loaded) return;
    const stream=document.querySelector('#stream-window');
    if (stream?.classList.contains('is-direct')) {wasDirect=true;applied=false;deadline=0;return;}
    if (wasDirect) {wasDirect=false;applied=false;}
    if (!stream?.classList.contains('stream-window-inited') || applied || desired===null) return;
    const control=document.querySelector('.volume-icon');
    const state=outputState(control);
    if (state!==null && !control.matches('.not-allowed,[disabled],[aria-disabled="true"]')) {
      applied=true;
      if (state!==desired) {
        control.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        timeout=setTimeout(()=>{
          if (!stopped && !document.querySelector('#stream-window.is-direct') && outputState(document.querySelector('.volume-icon'))!==desired) warn('Sound output could not be restored. Use the KVM speaker control to reconnect it.');
        },1000);
      }
      return;
    }
    if (!deadline) deadline=Date.now()+30000;
    if (Date.now()>=deadline) {
      applied=true;
      warn('Sound output could not be restored: the KVM speaker control is unavailable.');
    }
  }
  /** @param {MouseEvent} event */
  function remember(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control=event.target.closest('.volume-icon,.settings .icon-button');
    const before=outputState(control);
    if (before===null || control.matches('.not-allowed,[disabled],[aria-disabled="true"]') || document.querySelector('#stream-window.is-direct')) return;
    userChoice=true;applied=true;
    clearTimeout(timeout);
    timeout=setTimeout(()=>{
      if (stopped) return;
      const enabled=outputState(control);
      if (enabled!==null && enabled!==before) {
        desired=enabled;
        void ipcRenderer.invoke('session:sound-output:set',enabled).catch(error=>warn(`Unable to remember sound output: ${error.message}`));
      }
    },0);
  }
  document.addEventListener('click',remember,true);
  const timer=setInterval(restore,250);
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);clearTimeout(timeout);document.removeEventListener('click',remember,true);},{once:true});
  try {
    const saved=await ipcRenderer.invoke('session:sound-output:get');
    if (!userChoice) desired=saved;
    loaded=true;restore();
  } catch(error) {if (!stopped) warn(`Unable to load sound output preference: ${error.message}`);}
});

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
