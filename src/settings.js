'use strict';
/** @typedef {{enabled:boolean,running:boolean,error:string|null}} ApiStatus */
/** @type {Window & {workspace:{apiStatus:()=>Promise<ApiStatus>,setApiEnabled:(enabled:boolean)=>Promise<void>,copyApiToken:()=>Promise<void>,regenerateApiToken:()=>Promise<void>,openApiDocs:(page:'docs'|'openapi.json')=>Promise<void>,onSettings:(callback:()=>void)=>()=>void}}} */
const host=window;
const api=host.workspace;
const dialog=/** @type {HTMLDialogElement} */(document.querySelector('#settings-dialog'));
const fields=/** @type {HTMLFieldSetElement} */(document.querySelector('#settings-fields'));
const enabled=/** @type {HTMLInputElement} */(document.querySelector('#api-enabled'));
const status=document.querySelector('#api-status');
const error=document.querySelector('#settings-error');
const feedback=document.querySelector('#settings-feedback');
let busy=false;

async function refresh() {
  const state=await api.apiStatus();
  enabled.checked=state.enabled;
  status.textContent=state.running?'Listening on http://127.0.0.1:53241':state.enabled?'Web server failed to start. Turn off or retry enabling.':'Web server is off.';
  for(const id of ['open-api-docs','open-api-schema']) document.querySelector('#'+id).disabled=!state.running;
  document.querySelector('#retry-api').hidden=!state.enabled||state.running;
  if(state.error) {error.textContent=state.error;error.hidden=false;}
}

/** @param {()=>Promise<unknown>} action @param {string} [message] */
async function run(action,message='') {
  if(busy) return;
  busy=true;fields.disabled=true;error.hidden=true;feedback.textContent='';
  document.querySelector('#close-settings').disabled=true;
  dialog.setAttribute('aria-busy','true');
  try {await action();feedback.textContent=message;}
  catch(failure) {error.textContent=failure.message;error.hidden=false;}
  finally {
    try {await refresh();}
    catch(failure) {error.textContent=failure.message;error.hidden=false;}
    busy=false;fields.disabled=false;dialog.setAttribute('aria-busy','false');
    document.querySelector('#close-settings').disabled=false;
  }
}

function show() {
  if(!dialog.open) dialog.showModal();
  void run(async()=>{});
}
document.querySelector('#settings').addEventListener('click',show);
enabled.addEventListener('change',()=>{const value=enabled.checked;void run(()=>api.setApiEnabled(value));});
document.querySelector('#retry-api').addEventListener('click',()=>void run(()=>api.setApiEnabled(true)));
document.querySelector('#copy-api-token').addEventListener('click',()=>void run(()=>api.copyApiToken(),'Token copied.'));
document.querySelector('#regenerate-api-token').addEventListener('click',()=>void run(()=>api.regenerateApiToken(),'Token regenerated. Copy the new token to update your clients.'));
document.querySelector('#open-api-docs').addEventListener('click',()=>void run(()=>api.openApiDocs('docs')));
document.querySelector('#open-api-schema').addEventListener('click',()=>void run(()=>api.openApiDocs('openapi.json')));
document.querySelector('#close-settings').addEventListener('click',()=>dialog.close());
dialog.addEventListener('cancel',event=>{if(busy) event.preventDefault();});
const unsubscribe=api.onSettings(show);
window.addEventListener('pagehide',unsubscribe,{once:true});
