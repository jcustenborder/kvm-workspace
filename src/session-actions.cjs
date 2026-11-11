'use strict';
// Serialized into the sandboxed preload. Browser-only; no Node/Electron access.
/** @param {string} action @param {{enabled?:boolean,keys?:Array<{code:string,key:string,keyCode:number}>}} payload @returns {Promise<object>} */
async function sessionAction(action,payload) {
  const stream=document.querySelector('#stream-window');
  const ready=stream?.classList.contains('stream-window-inited');
  /** @returns {boolean|null} */
  function speakerState() {
    if(!ready || stream.classList.contains('is-direct')) return null;
    const control=document.querySelector('.volume-icon');
    if(!control || control.matches('.not-allowed,[disabled],[aria-disabled="true"]')) return null;
    const use=control.querySelector('use');
    const icon=use?.getAttribute('href')||use?.getAttributeNS('http://www.w3.org/1999/xlink','href');
    return icon==='#gl-kvm-sound-full'?true:icon==='#gl-kvm-sound-off'?false:null;
  }
  /** @returns {Element|null} */
  function mouseJiggleControl() {
    const controls=[...document.querySelectorAll('.remote-device-setting button[role="switch"]')].filter(control=>control.closest('.item')?.querySelector('.label')?.textContent.trim()==='Mouse Jiggle');
    return controls.length===1?controls[0]:null;
  }
  /** @returns {boolean|null} */
  function mouseJiggleState() {
    if(!ready) return null;
    const control=mouseJiggleControl();
    if(!control || control.matches('[disabled],[aria-disabled="true"]')) return null;
    const checked=control.getAttribute('aria-checked');
    return checked==='true'?true:checked==='false'?false:null;
  }
  if(action==='read') return {enabled:speakerState(),mouseJiggleEnabled:mouseJiggleState()};
  if(action==='speaker'||action==='speaker/toggle') {
    const before=speakerState();
    if(before===null) throw new Error('KVM speaker control is not ready.');
    const desired=action==='speaker'?payload.enabled:!before;
    if(before!==desired) document.querySelector('.volume-icon').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const deadline=Date.now()+1500;
    do {
      if(speakerState()===desired) return {enabled:desired};
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(Date.now()<deadline);
    throw new Error('KVM speaker change could not be confirmed.');
  }
  if(action==='mouse-jiggle/toggle') {
    const control=mouseJiggleControl(),before=mouseJiggleState();
    if(!control || before===null) throw new Error('KVM Mouse Jiggle control is not ready.');
    control.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const deadline=Date.now()+1500;
    do {
      if(mouseJiggleState()===!before) return {enabled:!before};
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(Date.now()<deadline);
    throw new Error('KVM Mouse Jiggle change could not be confirmed.');
  }
  if(action==='ocr') {
    const control=document.querySelector('.ocr-box button'),canvas=document.querySelector('#gl-kvm-ocr-canvas');
    const active=()=>canvas?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})===true;
    if(!ready || !control || !canvas || control.matches('[disabled],[aria-disabled="true"]') || active()) throw new Error('KVM OCR control is not ready.');
    control.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const deadline=Date.now()+1500;
    do {
      if(active()) return {triggered:true};
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(Date.now()<deadline);
    throw new Error('KVM OCR interface could not be confirmed.');
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
