'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Module=require('node:module');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createUpdates}=require('../src/updates.cjs');

test('pinned MacUpdater uses stable GitHub metadata and defers native staging until explicit install',async(t)=>{
  const directory=await mkdtemp(path.join(tmpdir(),'kvm-native-update-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const native=new EventEmitter();
  let nativeChecks=0;
  let nativeInstalls=0;
  native.setFeedURL=()=>{};
  native.checkForUpdates=()=>{nativeChecks++;};
  native.quitAndInstall=()=>{nativeInstalls++;};
  const load=Module._load;
  t.mock.method(Module,'_load',function(request,...args){return request==='electron' ? {autoUpdater:native} : load.call(this,request,...args);});
  const {MacUpdater}=require('electron-updater/out/MacUpdater');
  const config=path.join(directory,'app-update.yml');
  await writeFile(config,JSON.stringify({provider:'github',owner:'jcustenborder',repo:'kvm-workspace',updaterCacheDirName:'kvm-workspace-updater'}));
  const updater=new MacUpdater(null,{version:'0.1.0',name:'KVM Workspace',isPackaged:true,userDataPath:directory,appUpdateConfigPath:config,whenReady:async()=>{}});
  t.after(()=>{if(updater.server?.listening) updater.server.close();});
  updater.logger={info(){},warn(){},error(){},debug(){}};
  let latest='0.2.0';
  const requests=[];
  updater.httpExecutor={request:async(options)=>{
    requests.push(options.path);
    if(options.path.endsWith('.atom')) return '<feed><entry><title>Prerelease</title><link href="https://github.com/jcustenborder/kvm-workspace/releases/tag/v0.3.0-beta.1"/><content>Beta</content></entry><entry><title>Stable</title><link href="https://github.com/jcustenborder/kvm-workspace/releases/tag/v0.2.0"/><content>Stable release</content></entry></feed>';
    if(options.path.endsWith('/latest')) return JSON.stringify({tag_name:`v${latest}`});
    assert.match(options.path,/\/download\/v[\d.]+\/latest-mac.yml$/);
    return JSON.stringify({version:latest,files:[{url:`KVM-Workspace-v${latest}-macos-arm64.zip`,sha512:'digest',size:3}]});
  }};
  const prompts=[];
  const controller=createUpdates({updater,menuItem:{},logger:{info(){},error(){}},dialog:{showMessageBox:async(options)=>{prompts.push(options);return {response:1};}}});
  await controller.check(true);
  assert.match(prompts[0].message,/0.2.0/);
  assert.equal(requests.some(url=>url.includes('beta')),false);
  assert.equal(requests.some(url=>url.endsWith('.zip')),false);
  latest='0.0.9';
  await controller.check(true);
  assert.match(prompts[1].message,/up to date/);
  const archive=path.join(directory,'update.zip');
  await writeFile(archive,'abc');
  // Characterize the pinned macOS handoff, keeping its loopback server real.
  await updater.updateDownloaded({url:new URL('https://github.com/update.zip'),info:{size:3}},
    {version:'0.2.0',files:[],downloadedFile:archive});
  assert.equal(nativeChecks,0,'download must not stage an install on normal quit');
  assert.equal(nativeInstalls,0);
  updater.quitAndInstall();
  assert.equal(nativeChecks,1);
  assert.equal(nativeInstalls,0,'restart must wait for native staging');
  native.emit('update-downloaded');
  assert.equal(nativeInstalls,1);
});
