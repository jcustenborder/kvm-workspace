'use strict';
// Serialized into the sandboxed preload. Browser-only; no Node/Electron access.
/** @param {string} action @param {{enabled?:boolean,keys?:Array<{code:string,key:string,keyCode:number}>}} payload @returns {Promise<object>} */
async function sessionAction(action,payload) {
  const stream=document.querySelector('#stream-window');
  const ready=stream?.classList.contains('stream-window-inited');
  /** @returns {boolean|null} */
  function state() {
    if(!ready || stream.classList.contains('is-direct')) return null;
    const control=document.querySelector('.volume-icon');
    if(!control || control.matches('.not-allowed,[disabled],[aria-disabled="true"]')) return null;
    const use=control.querySelector('use');
    const icon=use?.getAttribute('href')||use?.getAttributeNS('http://www.w3.org/1999/xlink','href');
    return icon==='#gl-kvm-sound-full'?true:icon==='#gl-kvm-sound-off'?false:null;
  }
  if(action==='read') return {enabled:state()};
  if(action==='speaker'||action==='speaker/toggle') {
    const before=state();
    if(before===null) throw new Error('KVM speaker control is not ready.');
    const desired=action==='speaker'?payload.enabled:!before;
    if(before!==desired) document.querySelector('.volume-icon').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const deadline=Date.now()+1500;
    do {
      if(state()===desired) return {enabled:desired};
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(Date.now()<deadline);
    throw new Error('KVM speaker change could not be confirmed.');
  }
  if(action!=='send-keys') throw new Error('Unknown session action.');
  const target=document.querySelector('#stream-box');
  if(!ready || !target) throw new Error('KVM keyboard is not ready.');
  target.focus();
  const held=[];
  /** @param {string} type @param {{code:string,key:string,keyCode:number}} item */
  function emit(type,item) {
    const flags={};
    for(const [prefix,property] of [['Meta','metaKey'],['Control','ctrlKey'],['Alt','altKey'],['Shift','shiftKey']]) flags[property]=held.some(key=>key.code.startsWith(prefix));
    target.dispatchEvent(new KeyboardEvent(type,{...item,...flags,which:item.keyCode,location:item.code.endsWith('Right')?2:item.code.endsWith('Left')?1:0,bubbles:true,cancelable:true}));
  }
  try {
    for(const item of payload.keys) {held.push(item);emit('keydown',item);}
  } finally {
    while(held.length) {const item=held.pop();emit('keyup',item);}
  }
  return {};
}
module.exports={sessionAction};
