'use strict';
// Packaged-app lifecycle test against a synthetic HTTPS page, not KVM hardware.
const {_electron} = require('playwright-core');
const {mkdtemp,readFile,rm,mkdir,writeFile,rename} = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
const {createServer} = require('node:https');
const {X509Certificate} = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');

async function run() {
  const temporaryRoot=path.resolve('investigation/private/tmp');
  await mkdir(temporaryRoot,{recursive:true,mode:0o700});
  const temporary = await mkdtemp(path.join(temporaryRoot,'kvm-window-test-'));
  const keyPath=path.join(temporary,'key.pem'), certPath=path.join(temporary,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const certificate=await readFile(certPath), key=await readFile(keyPath);
  const pin=new X509Certificate(certificate).fingerprint256;
  const html=`<!doctype html><title>Synthetic session fixture</title><div id="stream-box" tabindex="0" style="width:500px;height:300px">Synthetic input surface</div><script>
    window.headCaptureInstalled=!!window.__workspaceCapture;
    window.events=[]; for(const type of ['keydown','keyup','mousedown','mouseup','blur']) window.addEventListener(type,event=>events.push({type:event.type,key:event.code,button:event.button}),true);
    window.loadId=crypto.randomUUID(); document.querySelector('#stream-box').focus();
  </script>`;
  const server=createServer({key,cert:certificate},(_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`https://127.0.0.1:${server.address().port}`;
  let crossPortRequests=0;
  const otherServer=createServer({key,cert:certificate},(_request,response)=>{crossPortRequests++;response.end('cross-port');});
  await new Promise(resolve=>otherServer.listen(0,'127.0.0.1',resolve));
  const otherEndpoint=`https://127.0.0.1:${otherServer.address().port}`;
  const report={scenario:'Synthetic page, three isolated windows; not three live KVMs',checks:[],at:new Date().toISOString()};
  const electron=await _electron.launch({executablePath:path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[`--user-data-dir=${path.join(temporary,'profile')}`]});
  let diagnostics='';electron.process().stderr.on('data',chunk=>{diagnostics+=chunk.toString();});
  electron.on('window',page=>page.on('console',message=>{diagnostics+=`\n${message.type()}: ${message.text()}`;}));
  try {
    const inventory=await electron.firstWindow();
    await inventory.waitForSelector('#add-device');
    await electron.evaluate(({dialog},fingerprint)=>{
      dialog.showMessageBox=async (...args)=>({response:args.at(-1).detail?.includes(fingerprint)?1:0,checkboxChecked:false});
      dialog.showErrorBox=(_title,message)=>{throw new Error(message);};
    },pin);
    const windows=[];
    for(let index=0;index<3;index++) {
      const next=electron.waitForEvent('window');
      await inventory.evaluate(async ({id,url})=>{await window.workspace.save({id,name:`Fixture ${id}`,lan:url,tailnet:''});await window.workspace.open(id,'lan');},{id:String(index),url:endpoint});
      const page=await next;
      await page.waitForURL(endpoint+'/');
      await page.locator('#stream-box').waitFor();
      windows.push(page);
    }
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).sessions.length,3);
    report.checks.push('three simultaneous independent native session windows');
    assert.equal(await windows[0].evaluate(()=>headCaptureInstalled),true);
    report.checks.push('capture wrapper installed before firmware document scripts');
    await windows[0].evaluate(async url=>{try{await fetch(url,{mode:'no-cors'});}catch{}},otherEndpoint);
    assert.equal(crossPortRequests,0);
    report.checks.push('selected certificate trust cannot authorize another port');
    await inventory.evaluate(async ({lan,tailnet})=>window.workspace.save({id:'0',name:'Fixture 0',lan,tailnet}),{lan:endpoint,tailnet:otherEndpoint});
    await assert.rejects(inventory.evaluate(()=>window.workspace.open('0','tailnet')),/another route/);
    report.checks.push('different route cannot falsely report success for an existing LAN window');
    const savedPath=await electron.evaluate(({app})=>app.getPath('userData')+'/devices.json');
    await rename(savedPath,savedPath+'.original');await mkdir(savedPath);
    await assert.rejects(inventory.evaluate(url=>window.workspace.save({id:'0',name:'Rejected edit',lan:url,tailnet:''}),endpoint));
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).devices.find(item=>item.id==='0').name,'Fixture 0');
    await rm(savedPath,{recursive:true});await rename(savedPath+'.original',savedPath);
    await inventory.evaluate(url=>window.workspace.save({id:'2',name:'Fixture 2',lan:url,tailnet:''}),endpoint);
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).devices.find(item=>item.id==='0').name,'Fixture 0');
    report.checks.push('failed atomic inventory writes do not publish or leak into later saves');
    await windows[1].evaluate(()=>localStorage.setItem('gl-kvm-token-key','fixture-token-not-a-real-login'));
    await (await electron.browserWindow(windows[1])).evaluate(win=>win.focus());
    await electron.evaluate(({Menu})=>Menu.getApplicationMenu().items.find(item=>item.label==='Session').submenu.items.find(item=>item.label==='Save This Login Securely').click());
    const encryptedPath=savedPath.replace(/devices\.json$/,'login-1.encrypted');
    let encrypted;
    console.log('Validating Keychain-backed login storage; macOS authorization may be required.');
    for(let attempt=0;attempt<900;attempt++) {
      try {encrypted=await readFile(encryptedPath);break;} catch(error) {if(error.code!=='ENOENT')throw error;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(encrypted?.length>0,'Keychain-backed token file must be written');
    assert.equal(encrypted.includes(Buffer.from('fixture-token-not-a-real-login')),false);
    report.checks.push('saved login uses real macOS Keychain-backed encryption, not plaintext');
    for(let index=0;index<3;index++) await windows[index].evaluate(id=>localStorage.setItem('partition-test',id),String(index));
    for(let index=0;index<3;index++) assert.equal(await windows[index].evaluate(()=>localStorage.getItem('partition-test')),String(index));
    assert.equal(await windows[0].evaluate(()=>typeof window.workspace),'undefined');
    assert.equal(await windows[0].evaluate(()=>typeof require),'undefined');
    report.checks.push('same-origin pages have independent storage and no privileged bridge');
    await (await electron.browserWindow(windows[0])).evaluate(win=>win.focus());
    await windows[0].locator('#stream-box').focus();
    await windows[0].keyboard.down('Shift');
    await (await electron.browserWindow(windows[1])).evaluate(win=>win.focus());
    await windows[0].waitForFunction(()=>events.some(event=>event.type==='keyup'&&event.key==='ShiftLeft'));
    assert.equal(await windows[2].evaluate(()=>events.some(event=>event.type==='keydown'&&event.key==='ShiftLeft')),false);
    report.checks.push('held modifier released on focus change without broadcasting input');
    const loadIds=await Promise.all(windows.map(page=>page.evaluate(()=>loadId)));
    await electron.evaluate(({BrowserWindow})=>{const target=BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('Fixture 1'));target.setSize(800,600);});
    assert.equal(await windows[1].evaluate(()=>loadId),loadIds[1]);
    await windows[1].reload();
    assert.notEqual(await windows[1].evaluate(()=>loadId),loadIds[1]);
    assert.equal(await windows[0].evaluate(()=>loadId),loadIds[0]);
    assert.equal(await windows[2].evaluate(()=>loadId),loadIds[2]);
    report.checks.push('resize preserves connection; reload affects one window only');
    await windows[1].close();
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).sessions.length,2);
    assert.equal(await windows[0].evaluate(()=>loadId),loadIds[0]);
    const reopened=electron.waitForEvent('window');
    await inventory.evaluate(()=>window.workspace.open('1','lan'));
    const fresh=await reopened;await fresh.waitForURL(endpoint+'/');
    await fresh.waitForFunction(()=>localStorage.getItem('gl-kvm-token-key')==='fixture-token-not-a-real-login',null,{timeout:90000});
    await fresh.waitForLoadState('networkidle');
    assert.equal(await fresh.evaluate(()=>localStorage.getItem('partition-test')),null);
    report.checks.push('encrypted saved login restores only to its device endpoint');
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).sessions.length,3);
    report.checks.push('close cleans session storage; reopening leaves other windows intact');
    const auxiliary=electron.waitForEvent('window');
    await windows[0].evaluate(()=>window.open('/aux'));
    const child=await auxiliary;await child.waitForURL(endpoint+'/aux');
    await child.evaluate(()=>window.addEventListener('beforeunload',event=>{event.preventDefault();event.returnValue='stay';}));
    const childClosed=child.waitForEvent('close');
    await windows[0].close();
    await childClosed;
    report.checks.push('owning session destroys auxiliary windows despite unload vetoes');
    const credentialPath=savedPath.replace(/devices\.json$/,'login-0.encrypted');
    await mkdir(credentialPath);
    await assert.rejects(inventory.evaluate(()=>window.workspace.remove('0')));
    assert((await inventory.evaluate(()=>window.workspace.list())).devices.some(item=>item.id==='0'));
    await rm(credentialPath,{recursive:true});
    const removal=await inventory.evaluate(async()=>{
      const removing=window.workspace.remove('0');
      const opening=window.workspace.open('0','lan').then(()=>({allowed:true}),error=>({error:error.message}));
      await removing;return opening;
    });
    assert.equal(removal.allowed,undefined);
    assert(removal.error);
    assert(!(await inventory.evaluate(()=>window.workspace.list())).devices.some(item=>item.id==='0'));
    report.checks.push('failed credential deletion is retryable; concurrent removal blocks opening');
    await mkdir('investigation/private',{recursive:true});
    await writeFile('investigation/private/window-validation.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } catch (error) {
    console.error('Synthetic app diagnostics:',diagnostics.slice(-5000));
    console.error(JSON.stringify(await electron.evaluate(async ({BrowserWindow})=>Promise.all(BrowserWindow.getAllWindows().map(async win=>({title:win.getTitle(),focused:win.isFocused(),events:await win.webContents.executeJavaScript('({events:window.events || [],helper:!!window.__workspaceCapture,media:typeof navigator.mediaDevices})'),arguments:win.webContents.getLastWebPreferences().additionalArguments?.map(arg=>arg.slice(0,25))})))),null,2));
    throw error;
  } finally {
    await electron.close();
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>otherServer.close(resolve));
    await rm(temporary,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
