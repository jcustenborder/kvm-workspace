'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {runSessionAction,endSession}=require('../src/session-control.cjs');

test('stalled renderer calls time out, reject further work, and cannot execute late input',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const pending=Promise.withResolvers();
  let script,actions=0;
  const window={isDestroyed:()=>false,webContents:{getURL:()=> 'https://kvm.test',isLoadingMainFrame:()=>false,executeJavaScriptInIsolatedWorld:(_world,scripts)=>{script=scripts[0].code;return pending.promise;}}};
  const item={window,endpoint:'https://kvm.test',generation:0};
  const operation=runSessionAction(item,'send-keys',{});
  const rejected=assert.rejects(operation,/timed out/i);
  t.mock.timers.tick(3001);await rejected;
  await assert.rejects(runSessionAction(item,'send-keys',{}),/busy/i);
  const browser={Date,location:{origin:'https://kvm.test'},window:{__workspaceSessionAction:async()=>{actions++;return {};}}};
  pending.resolve(vm.runInNewContext(script,browser));
  await pending.promise.catch(()=>{});
  assert.equal(actions,0,'Expired renderer dispatch must not send late keys');
  window.webContents.executeJavaScriptInIsolatedWorld=()=>Promise.resolve({enabled:true});
  assert.deepEqual(await runSessionAction(item,'read'),{enabled:true},'Settling the old call releases the busy guard');
});

test('navigation allows recovery without an old operation clearing the new guard',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const old=Promise.withResolvers(),current=Promise.withResolvers();
  const item={generation:0,endpoint:'https://kvm.test',window:{isDestroyed:()=>false,webContents:{getURL:()=> 'https://kvm.test',isLoadingMainFrame:()=>false,executeJavaScriptInIsolatedWorld:()=>old.promise}}};
  const first=runSessionAction(item,'read');const firstRejected=assert.rejects(first,/timed out/i);
  t.mock.timers.tick(3001);await firstRejected;
  item.generation++;
  item.window.webContents.executeJavaScriptInIsolatedWorld=()=>current.promise;
  const second=runSessionAction(item,'read');
  old.resolve({enabled:false});await old.promise;
  await assert.rejects(runSessionAction(item,'read'),/busy/i);
  current.resolve({enabled:true});assert.deepEqual(await second,{enabled:true});
});

test('ending releases input before destroying a window even when close could be vetoed',async()=>{
  let released=false,destroyed=false;
  const item={generation:0,endpoint:'https://kvm.test',window:{isDestroyed:()=>destroyed,destroy:()=>{assert.equal(released,true);destroyed=true;},webContents:{getURL:()=> 'https://kvm.test',isLoadingMainFrame:()=>false,executeJavaScriptInIsolatedWorld:async(_world,scripts)=>vm.runInNewContext(scripts[0].code,{Date,location:{origin:'https://kvm.test'},window:{__workspaceReleaseInput:()=>{released=true;}}})}}};
  await endSession(item);assert.equal(destroyed,true);
});
