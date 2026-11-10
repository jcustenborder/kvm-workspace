'use strict';
// Sandboxed, isolated preload. No native API or IPC capability is exposed to the device.
const {ipcRenderer,contextBridge} = require('electron');
const actionsArgument=process.argv.find(argument=>argument.startsWith('--workspace-actions='));
const runSessionAction=actionsArgument?new Function(`return (${new TextDecoder().decode(Uint8Array.from(atob(actionsArgument.slice('--workspace-actions='.length)),character=>character.charCodeAt(0)))})`)():null;
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
// These properties exist only in the isolated world, never in device scripts.
window.__workspaceReleaseInput=releaseInput;
ipcRenderer.on('session:release-input',releaseInput);
window.addEventListener('blur',releaseInput);
window.addEventListener('pagehide',releaseInput);

// Keep desired output separate from firmware defaults, Direct mode, and teardown.
// No IPC bridge is exposed to the device's main world.
window.addEventListener('DOMContentLoaded',async () => {
  /** @type {boolean | null} */
  let desired=null;
  let loaded=false, applied=false, userChoice=false, stopped=false, wasDirect=false, apiChanging=false;
  let deadline=0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  /** @param {string} action @param {object} payload */
  window.__workspaceSessionAction=async(action,payload)=>{
    if(!runSessionAction) throw new Error('Session actions are unavailable.');
    if(action==='send-keys') releaseInput();
    const changing=action==='speaker'||action==='speaker/toggle';
    if(changing) apiChanging=true;
    try {
      const result=await runSessionAction(action,payload);
      if(changing) {desired=result.enabled;loaded=true;userChoice=true;applied=true;clearTimeout(timeout);}
      return result;
    } finally {if(changing) apiChanging=false;}
  };
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
    if (stopped || !loaded || apiChanging) return;
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
          if (!stopped && !apiChanging && !document.querySelector('#stream-window.is-direct') && outputState(document.querySelector('.volume-icon'))!==desired) warn('Sound output could not be restored. Use the KVM speaker control to reconnect it.');
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

// Credential IPC exists only in this isolated preload, never in the device world.
window.addEventListener('DOMContentLoaded',()=>{
  let attempted=false,pending=false,submitted=false,sawLoading=false,version=0;
  /** @type {HTMLElement | null} */
  let container=null,status=null;
  let originalVisibility='',deadline;
  /** @param {string} message */
  function showStatus(message) {
    if(!status) {
      status=document.createElement('div');status.setAttribute('role','status');
      status.style.cssText='position:fixed;inset:30% 15% auto;text-align:center;font:16px system-ui;z-index:2147483647;pointer-events:none';
      document.body.append(status);
    }
    if(status.textContent!==message) status.textContent=message;
    status.hidden=false;
  }
  /** @param {string} [message] */
  function reveal(message='') {
    version++;pending=false;clearTimeout(deadline);
    if(container) container.style.visibility=originalVisibility;
    if(status) {status.textContent=message;status.hidden=!message;}
  }
  function inspect() {
    const login=/^#\/login(?:[?]|$)/.test(location.hash) || location.pathname==='/login';
    if(!login) {
      if(pending) reveal();
      attempted=false;status?.remove();status=null;container=null;return;
    }
    if(pending) {
      if(submitted) {
        const button=container?.querySelector('button.operation-btn');
        const loading=button?.classList.contains('ant-btn-loading');
        if(loading) sawLoading=true;
        if(container?.querySelector('input:is([name=twofaCode], #form_item_twofaCode)') || document.querySelector('.ant-message-error,.ant-form-item-has-error') ||
            (sawLoading && !loading)) reveal('Automatic sign-in did not complete. Sign in manually or update the password under Devices → Edit.');
      }
      return;
    }
    if(attempted) return;
    // Ant Design's rendered inputs use form_item_* IDs, without name attributes.
    const inputs=document.querySelectorAll('.auth-form-container input:is([name=passwd], #form_item_passwd)');
    const input=inputs.length===1 ? inputs[0] : null;
    const next=input?.closest('.auth-form-container');
    const button=next?.querySelector('button.operation-btn');
    if(!(input instanceof HTMLInputElement) || !(next instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
      if(document.querySelector('input[type=password]')) showStatus('This device login form is not recognized for automatic sign-in. Sign in manually.');
      return;
    }
    if(next.querySelector('.ant-spin-spinning') || button.disabled) return;
    attempted=true;
    // Never replace a password the user has already started entering.
    if(input.value) return;
    container=next;originalVisibility=container.style.visibility;
    container.style.visibility='hidden';
    showStatus('Signing in with the saved device password…');
    pending=true;submitted=false;sawLoading=false;
    const current=++version;
    deadline=setTimeout(()=>reveal('Automatic sign-in timed out. Sign in manually.'),15000);
    void ipcRenderer.invoke('session:password').then(password=>{
      if(current!==version || !input.isConnected || !/^#\/login(?:[?]|$)/.test(location.hash) && location.pathname!=='/login') return;
      if(!password) {reveal('No password is saved for this device. Set it under Devices → Edit, then reconnect, or sign in manually.');return;}
      if(input.value) {reveal();return;}
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,password);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      if(container.querySelector('input:is([name=twofaCode], #form_item_twofaCode)')) {reveal('Enter your two-factor code, then choose Log In.');return;}
      submitted=true;button.click();
    }).catch(()=>{
      if(current===version) reveal('The saved password could not be loaded. Check macOS Keychain or sign in manually.');
    });
  }
  const observer=new MutationObserver(inspect);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled']});
  window.addEventListener('hashchange',inspect);
  window.addEventListener('popstate',inspect);
  window.addEventListener('input',event=>{if(pending && event.isTrusted)reveal();},true);
  ipcRenderer.on('session:password-forgotten',()=>{attempted=true;reveal();});
  window.addEventListener('pagehide',()=>{reveal();observer.disconnect();},{once:true});
  inspect();
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
