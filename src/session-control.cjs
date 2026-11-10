'use strict';
const {sameOrigin}=require('./model.cjs');
const {apiError}=require('./api.cjs');
/** @type {WeakMap<object,{generation:number}>} */
const active=new WeakMap();

/** @param {object} item @param {string} action @param {object} [payload] @returns {Promise<object>} */
async function runSessionAction(item,action,payload={}) {
  if(item.window.isDestroyed()) throw apiError(409,'Session is closed.');
  const contents=item.window.webContents,generation=item.generation;
  if(contents.isLoadingMainFrame() || !sameOrigin(contents.getURL(),item.endpoint)) throw apiError(409,'KVM page is not ready.');
  if(active.get(item)?.generation===generation) throw apiError(409,'KVM renderer is busy; reconnect or end the session if it remains unresponsive.');
  const task={generation};active.set(item,task);
  const deadline=Date.now()+3000;
  // The deadline is checked inside the renderer too: queued work must not send
  // delayed keys after the caller has already received a timeout.
  const code=`(async()=>{
    if(Date.now()>=${deadline})throw new Error('Session operation expired.');
    if(location.origin!==${JSON.stringify(new URL(item.endpoint).origin)})throw new Error('KVM page changed.');
    ${action==='release'?"window.__workspaceReleaseInput?.();return {};":`if(!window.__workspaceSessionAction)throw new Error('KVM page is not ready.');return window.__workspaceSessionAction(${JSON.stringify(action)},${JSON.stringify(payload)});`}
  })()`;
  let operation;
  try {operation=contents.executeJavaScriptInIsolatedWorld(999,[{code}]);}
  catch(error) {active.delete(item);throw apiError(409,error.message);}
  const clear=()=>{if(active.get(item)===task) active.delete(item);};
  // Keep the guard until execution really settles, even if the HTTP wait times
  // out. A timeout is not cancellation; subsequent commands must not overlap it.
  operation.then(clear,clear);
  let timer;
  try {
    const result=await Promise.race([operation,new Promise((_resolve,reject)=>{
      timer=setTimeout(()=>reject(apiError(409,'KVM operation timed out; state may have changed. Reconnect or end the session.')),3000);
    })]).catch(error=>{throw apiError(409,error.message);});
    if(item.window.isDestroyed() || generation!==item.generation || !sameOrigin(contents.getURL(),item.endpoint)) throw apiError(409,'KVM page changed during the operation.');
    return result;
  } finally {clearTimeout(timer);}
}

/** @param {object} item @returns {Promise<void>} */
async function endSession(item) {
  if(item.window.isDestroyed()) return;
  try {
    if(!item.window.webContents.isLoadingMainFrame() && sameOrigin(item.window.webContents.getURL(),item.endpoint)) await runSessionAction(item,'release');
  } finally {
    // Explicit API end cannot be vetoed by firmware beforeunload handlers.
    // If input release fails, still disconnect but report that error to the caller.
    if(!item.window.isDestroyed()) item.window.destroy();
  }
}
module.exports={runSessionAction,endSession};
