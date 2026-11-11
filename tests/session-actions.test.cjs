'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sessionAction}=require('../src/session-actions.cjs');

function firmware() {
  let jiggle=false,jiggleDisabled=false,ocr=false,ocrHidden=false,direct=false;
  const stream={classList:{contains:name=>name==='stream-window-inited'||name==='is-direct'&&direct}};
  const label={textContent:'Mouse Jiggle'};
  const cursor={closest:()=>({querySelector:()=>({textContent:'Show Local Cursor'})})};
  const jiggleControl={
    matches:()=>jiggleDisabled,
    closest:()=>({querySelector:()=>label}),
    getAttribute:name=>name==='aria-checked'?String(jiggle):null,
    dispatchEvent:()=>queueMicrotask(()=>{jiggle=!jiggle;}),
  };
  const speaker={matches:()=>false,querySelector:()=>({getAttribute:()=> '#gl-kvm-sound-off',getAttributeNS:()=>null})};
  const ocrButton={matches:()=>false,dispatchEvent:()=>queueMicrotask(()=>{ocr=true;})};
  const canvas={getClientRects:()=>ocr?[{}]:[],checkVisibility:()=>ocr&&!ocrHidden};
  const controls=[cursor,jiggleControl];
  global.MouseEvent=class MouseEvent {};
  global.document={
    querySelector:selector=>({'#stream-window':stream,'.volume-icon':speaker,'.ocr-box button':ocrButton,'#gl-kvm-ocr-canvas':canvas}[selector]||null),
    querySelectorAll:selector=>selector==='.remote-device-setting button[role="switch"]'?controls:[],
  };
  return {label,controls,setDirect:value=>{direct=value;},disableJiggle:()=>{jiggleDisabled=true;},hideOcr:()=>{ocrHidden=true;}};
}

test('firmware actions observe and toggle Mouse Jiggle and trigger OCR',async()=>{
  const page=firmware();
  assert.deepEqual(await sessionAction('read',{}),{enabled:false,mouseJiggleEnabled:false});
  assert.deepEqual(await sessionAction('mouse-jiggle/toggle',{}),{enabled:true});
  assert.deepEqual(await sessionAction('mouse-jiggle/toggle',{}),{enabled:false});
  assert.deepEqual(await sessionAction('ocr',{}),{triggered:true});
  page.label.textContent='Unknown';
  assert.deepEqual(await sessionAction('read',{}),{enabled:false,mouseJiggleEnabled:null});
  await assert.rejects(sessionAction('mouse-jiggle/toggle',{}),/Mouse Jiggle control is not ready/);
});

test('firmware actions fail closed for ambiguous switches and hidden OCR',async()=>{
  const page=firmware();
  page.setDirect(true);
  assert.deepEqual(await sessionAction('read',{}),{enabled:null,mouseJiggleEnabled:false});
  page.controls.push(page.controls[1]);
  assert.deepEqual(await sessionAction('read',{}),{enabled:null,mouseJiggleEnabled:null});
  await assert.rejects(sessionAction('mouse-jiggle/toggle',{}),/Mouse Jiggle control is not ready/);
  page.hideOcr();
  await assert.rejects(sessionAction('ocr',{}),/OCR interface could not be confirmed/);
});

test('firmware actions treat disabled Mouse Jiggle as unavailable',async()=>{
  const page=firmware();
  page.disableJiggle();
  assert.deepEqual(await sessionAction('read',{}),{enabled:false,mouseJiggleEnabled:null});
  await assert.rejects(sessionAction('mouse-jiggle/toggle',{}),/Mouse Jiggle control is not ready/);
});
