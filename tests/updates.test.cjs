'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createUpdates,updatesEnabled}=require('../src/updates.cjs');

/** @param {number[]} answers */
function setup(answers=[]) {
  const updater=new EventEmitter();
  const effects={checks:0,downloads:0,installs:0,dialogs:[],errors:[]};
  updater.checkForUpdates=async()=>{ effects.checks++; updater.emit('update-available',{version:'0.2.0'}); return {updateInfo:{version:'0.2.0'}}; };
  updater.downloadUpdate=async()=>{ effects.downloads++; return ['/cache/update.zip']; };
  updater.quitAndInstall=()=>{ effects.installs++; };
  const dialog={showMessageBox:async(options)=>{ effects.dialogs.push(options); return {response:answers.shift()??1}; }};
  const menuItem={};
  const controller=createUpdates({updater,dialog,menuItem,logger:{info(){},error(error){effects.errors.push(error);}}});
  return {controller,updater,effects,menuItem};
}

test('checks and Later do not download; manual retry can download but never install without consent',async()=>{
  const {controller,updater,effects,menuItem}=setup([1,0,1,0]);
  await controller.check(false);
  assert.equal(effects.downloads,0);
  await controller.check(false);
  assert.equal(effects.dialogs.length,1);
  await controller.check(true);
  assert.equal(effects.downloads,1);
  assert.equal(effects.installs,0);
  assert.match(menuItem.label,/Install/);
  assert.equal(updater.autoDownload,false);
  assert.equal(updater.autoInstallOnAppQuit,false);
  assert.equal(updater.allowPrerelease,false);
  assert.equal(updater.allowDowngrade,false);
  assert.equal(updater.disableDifferentialDownload,true);
  assert.match(effects.dialogs[2].detail,/KVM sessions/);
  await controller.check(true);
  assert.equal(effects.installs,1);
  assert.equal(effects.downloads,1);
});

test('automatic checks do not nag about a downloaded update',async()=>{
  const {controller,effects}=setup([0,1]);
  await controller.check(false);
  await controller.check(false);
  assert.equal(effects.dialogs.length,2);
  assert.equal(effects.installs,0);
});

test('overlapping actions cannot cause duplicate checks or downloads',async()=>{
  const {controller,updater,effects,menuItem}=setup([0,1]);
  let finish;
  updater.checkForUpdates=()=>new Promise(resolve=>{effects.checks++; finish=()=>{updater.emit('update-available',{version:'0.2.0'});resolve({updateInfo:{version:'0.2.0'}});};});
  const checking=controller.check(true);
  assert.equal(menuItem.enabled,false);
  await controller.check(true);
  assert.equal(effects.checks,1);
  finish();
  await checking;
  assert.equal(effects.downloads,1);
  assert.equal(menuItem.enabled,true);
});

test('background failure stays nonmodal and manual retry recovers',async()=>{
  const {controller,updater,effects,menuItem}=setup();
  updater.checkForUpdates=async()=>{throw new Error('Offline');};
  await controller.check(false);
  assert.equal(effects.dialogs.length,0);
  assert.match(menuItem.label,/Failed/);
  assert.equal(effects.errors.length,1);
  await controller.check(true);
  assert.match(effects.dialogs[0].detail,/Offline/);
  updater.checkForUpdates=async()=>({updateInfo:{version:'0.1.0'}});
  await controller.check(true);
  assert.match(effects.dialogs[1].message,/up to date/);
  assert.match(menuItem.label,/Check for Updates/);
});

test('download and installation failures retain a usable retry action',async()=>{
  const {controller,updater,effects,menuItem}=setup([0,0,0,1,0,0]);
  updater.downloadUpdate=async()=>{throw new Error('Download interrupted');};
  await controller.check(true);
  assert.equal(effects.installs,0);
  assert.match(effects.dialogs[1].detail,/Download interrupted/);
  updater.downloadUpdate=async()=>{effects.downloads++;return ['/cache/update.zip'];};
  await controller.check(true);
  updater.quitAndInstall=()=>{throw new Error('Installation failed');};
  await controller.check(true);
  assert.match(effects.dialogs.at(-1).detail,/Installation failed/);
  assert.equal(menuItem.enabled,true);
});

test('no-update background checks are quiet',async()=>{
  const {controller,updater,effects}=setup();
  updater.checkForUpdates=async()=>({updateInfo:{version:'0.1.0'}});
  await controller.check(false);
  assert.equal(effects.dialogs.length,0);
});

test('only packaged arm64 macOS builds with release configuration enable updating',(t)=>{
  const resources=mkdtempSync(path.join(tmpdir(),'kvm-updates-'));
  t.after(()=>rmSync(resources,{recursive:true,force:true}));
  const app={isPackaged:true};
  assert.equal(updatesEnabled(app,'darwin','arm64',resources),false);
  writeFileSync(path.join(resources,'app-update.yml'),'{}');
  assert.equal(updatesEnabled(app,'darwin','arm64',resources),true);
  assert.equal(updatesEnabled({isPackaged:false},'darwin','arm64',resources),false);
  assert.equal(updatesEnabled(app,'linux','arm64',resources),false);
  assert.equal(updatesEnabled(app,'darwin','x64',resources),false);
});
