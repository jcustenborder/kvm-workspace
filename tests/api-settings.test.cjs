'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,mkdir,rename,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {createServer}=require('node:http');

/** @param {import('node:test').TestContext} t */
async function setup(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'kvm-settings-'));
  const {createApiSettings}=require('../src/api-settings.cjs');
  const settings=createApiSettings({directory,list:async()=>[],command:async()=>({}),port:0});
  t.after(async()=>{await settings.close();await rm(directory,{recursive:true,force:true});});
  return {directory,settings};
}

test('API is default-off, toggles immediately, persists and rotates while running or stopped',async t=>{
  const {directory,settings}=await setup(t);
  await settings.initialize();
  assert.deepEqual(settings.status(),{enabled:false,running:false,error:null});
  await assert.rejects(readFile(path.join(directory,'api-token')),{code:'ENOENT'});
  const old=await settings.copyToken();
  await settings.setEnabled(true);
  const base=`http://127.0.0.1:${settings.address().port}`;
  const call=token=>fetch(base+'/sessions',{headers:{authorization:`Bearer ${token}`}});
  assert.equal((await call(old)).status,200);
  await settings.regenerateToken();
  const token=await settings.copyToken();
  assert.notEqual(token,old);
  assert.equal((await call(old)).status,401);
  assert.equal((await call(token)).status,200);
  await settings.close();
  await settings.initialize();
  assert.equal(settings.status().running,true);
  assert.equal(await settings.copyToken(),token);
  await settings.setEnabled(false);
  await assert.rejects(fetch(base+'/openapi.json'));
  await settings.initialize();
  assert.equal(settings.status().running,false);
  await settings.regenerateToken();
  assert.notEqual(await settings.copyToken(),token);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'api-settings.json'),'utf8')),{enabled:false});
});

test('failed preference writes roll back the listener and failed rotation keeps the old token',async t=>{
  const {directory,settings}=await setup(t);
  await settings.initialize();
  await mkdir(path.join(directory,'api-settings.json'));
  await assert.rejects(settings.setEnabled(true));
  assert.equal(settings.status().running,false);
  assert.equal(settings.status().enabled,false);
  await rm(path.join(directory,'api-settings.json'),{recursive:true});
  await settings.setEnabled(true);
  await rm(path.join(directory,'api-settings.json'));
  await mkdir(path.join(directory,'api-settings.json'));
  await assert.rejects(settings.setEnabled(false));
  assert.equal(settings.status().running,true);
  assert.equal(settings.status().enabled,true);
  const token=await settings.copyToken();
  await rename(path.join(directory,'api-token'),path.join(directory,'saved-token'));
  await mkdir(path.join(directory,'api-token'));
  await assert.rejects(settings.regenerateToken());
  assert.equal(await settings.copyToken(),token);
  assert.equal((await fetch(`http://127.0.0.1:${settings.address().port}/sessions`,{headers:{authorization:`Bearer ${token}`}})).status,200);
});

test('port conflicts are visible and retryable without losing enabled intent',async t=>{
  const {directory}=await setup(t);
  const blocker=createServer();
  await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>blocker.close(resolve)));
  await writeFile(path.join(directory,'api-settings.json'),JSON.stringify({enabled:true}));
  const {createApiSettings}=require('../src/api-settings.cjs');
  const settings=createApiSettings({directory,list:async()=>[],command:async()=>({}),port:blocker.address().port});
  t.after(()=>settings.close());
  await assert.rejects(settings.initialize(),/EADDRINUSE/);
  assert.equal(settings.status().enabled,true);
  assert.equal(settings.status().running,false);
  assert.match(settings.status().error,/EADDRINUSE/);
  await new Promise(resolve=>blocker.close(resolve));
  await settings.setEnabled(true);
  assert.equal(settings.status().running,true);
  assert.equal(settings.status().error,null);
});

test('malformed saved preferences fail explicitly without overwriting them',async t=>{
  const {directory,settings}=await setup(t);
  await writeFile(path.join(directory,'api-settings.json'),'{"enabled":"yes"}');
  await assert.rejects(settings.initialize(),/Invalid API settings/);
  await assert.rejects(settings.setEnabled(true),/Invalid API settings/);
  assert.equal(await readFile(path.join(directory,'api-settings.json'),'utf8'),'{"enabled":"yes"}');
});
