'use strict';
// Packaged-app lifecycle test against a synthetic HTTPS page, not KVM hardware.
const {_electron} = require('playwright-core');
const {mkdtemp,readFile,rm,mkdir,writeFile,rename} = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
const {createServer} = require('node:https');
const {X509Certificate} = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');

/** @param {number} pid @param {string} [selection] @returns {string[]} */
function nativeWindowMenu(pid,selection) {
  const action=selection
    ? `click menu item ${JSON.stringify(selection)} of menu 1 of menu bar item "Window" of menu bar 1\nreturn "selected"`
    : 'set entries to name of every menu item of menu 1 of menu bar item "Window" of menu bar 1\nclick menu bar item "Window" of menu bar 1\nreturn entries';
  const script=`tell application "System Events"
    tell (first application process whose unix id is ${pid})
      set frontmost to true
      click menu bar item "Window" of menu bar 1
      ${action}
    end tell
  end tell`;
  return execFileSync('osascript',['-e',script],{encoding:'utf8',timeout:15000}).trim().split(', ');
}

async function run() {
  // Hosted runners cannot approve Accessibility or Keychain authorization dialogs.
  const ci=process.argv.includes('--ci');
  const temporaryRoot=path.resolve('investigation/private/tmp');
  await mkdir(temporaryRoot,{recursive:true,mode:0o700});
  const temporary = await mkdtemp(path.join(temporaryRoot,'kvm-window-test-'));
  const keyPath=path.join(temporary,'key.pem'), certPath=path.join(temporary,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const certificate=await readFile(certPath), key=await readFile(keyPath);
  const pin=new X509Certificate(certificate).fingerprint256;
  const html=`<!doctype html><title>Synthetic session fixture</title>
    <span class="volume-icon"><svg width="22" height="22" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#gl-kvm-sound-off"/></svg></span>
    <div class="settings"><button class="icon-button" aria-label="Speaker"><svg width="22" height="22" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#gl-kvm-sound-off"/></svg></button></div>
    <div id="stream-window"><div id="stream-box" tabindex="0" style="width:500px;height:300px">Synthetic input surface</div></div><script>
    window.headCaptureInstalled=!!window.__workspaceCapture;
    window.events=[]; for(const type of ['keydown','keyup','mousedown','mouseup','blur']) window.addEventListener(type,event=>events.push({type:event.type,key:event.code,button:event.button}),true);
    window.loadId=crypto.randomUUID(); document.querySelector('#stream-box').focus();
    window.output=false; window.outputClicks=0; window.captureAttempts=0;
    navigator.mediaDevices.getUserMedia=async()=>{captureAttempts++;throw new Error('Sound restoration must not capture');};
    // Vue commits the speaker icon after the synchronous state toggle.
    window.setOutput=enabled=>{output=enabled;queueMicrotask(()=>{for(const use of document.querySelectorAll('use')) use.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',output?'#gl-kvm-sound-full':'#gl-kvm-sound-off');});};
    for(const control of document.querySelectorAll('.volume-icon,.icon-button')) control.addEventListener('click',()=>{outputClicks++;setOutput(!output);});
    window.setReady=()=>document.querySelector('#stream-window').classList.add('stream-window-inited');
  </script>`;
  const server=createServer({key,cert:certificate},(_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`https://127.0.0.1:${server.address().port}`;
  let crossPortRequests=0;
  const otherServer=createServer({key,cert:certificate},(_request,response)=>{crossPortRequests++;response.end('cross-port');});
  await new Promise(resolve=>otherServer.listen(0,'127.0.0.1',resolve));
  const otherEndpoint=`https://127.0.0.1:${otherServer.address().port}`;
  const report={scenario:'Synthetic page, three isolated windows; not three live KVMs',checks:[],at:new Date().toISOString()};
  const source=process.argv.includes('--source');
  const launchOptions={executablePath:source?require('electron'):path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[...(source?[path.resolve('.')]:[]),`--user-data-dir=${path.join(temporary,'profile')}`]};
  let electron=await _electron.launch(launchOptions);
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
      await inventory.evaluate(async ({id,url})=>{await window.workspace.save({id,name:`fixture-${id}`,lan:url,tailnet:''});await window.workspace.open(id,'lan');},{id:String(index),url:endpoint});
      const page=await next;
      await page.waitForURL(endpoint+'/');
      await page.locator('#stream-box').waitFor();
      windows.push(page);
    }
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).sessions.length,3);
    report.checks.push('three simultaneous independent native session windows');
    await windows[0].evaluate(()=>setReady());
    await windows[0].locator('.volume-icon').click();
    const savedPath=await electron.evaluate(({app})=>app.getPath('userData')+'/devices.json');
    // A missing preference save is observable on disk, not just in a test double.
    await windows[0].waitForFunction(()=>{
      const icon=document.querySelector('.volume-icon use');
      return icon.getAttributeNS('http://www.w3.org/1999/xlink','href')==='#gl-kvm-sound-full';
    });
    let savedOn=false;
    for(let attempt=0;attempt<50;attempt++) {
      if(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs?.['0']===true) {savedOn=true;break;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert(savedOn,'Explicit output enable must persist to the owning KVM');
    const rejected=await electron.evaluate(async ({ipcMain,BrowserWindow})=>{
      const session=BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('fixture-0')).webContents;
      const inventory=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).webContents;
      const read=ipcMain._invokeHandlers.get('session:sound-output:get');
      const write=ipcMain._invokeHandlers.get('session:sound-output:set');
      const results=[];
      for(const [handler,event,value] of [
        [read,{sender:inventory,senderFrame:inventory.mainFrame}],
        [write,{sender:session,senderFrame:session.mainFrame},'true'],
        [read,{sender:session,senderFrame:inventory.mainFrame}],
        [read,{sender:session,senderFrame:{url:'https://wrong-origin.test'}}]
      ]) {
        try {await handler(event,value);results.push(false);} catch {results.push(true);}
      }
      return results;
    });
    assert.deepEqual(rejected,[true,true,true,true]);
    await windows[0].evaluate(()=>{const frame=document.createElement('iframe');frame.src='/frame';document.body.append(frame);});
    await windows[0].frameLocator('iframe').locator('#stream-box').waitFor();
    assert.equal(await electron.evaluate(async ({ipcMain,BrowserWindow})=>{
      const sender=BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('fixture-0')).webContents;
      try {await ipcMain._invokeHandlers.get('session:sound-output:get')({sender,senderFrame:sender.mainFrame.frames[0]});return false;} catch {return true;}
    }),true,'Same-origin subframes must not read session preferences');
    const specialWindow=electron.waitForEvent('window');
    await inventory.evaluate(async url=>{await window.workspace.save({id:'toString',name:'special-identity',lan:url,tailnet:''});await window.workspace.open('toString','lan');},endpoint);
    const special=await specialWindow;await special.waitForURL(endpoint+'/');
    assert.equal(await electron.evaluate(({ipcMain,BrowserWindow})=>{
      const sender=BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('special-identity')).webContents;
      return ipcMain._invokeHandlers.get('session:sound-output:get')({sender,senderFrame:sender.mainFrame});
    }),null,'A device without a saved choice must not inherit object prototype values');
    await special.close();await inventory.evaluate(()=>window.workspace.remove('toString'));
    await windows[0].reload();
    assert.equal(await windows[0].evaluate(()=>output),false,'Startup default must remain off before readiness');
    await windows[0].evaluate(()=>setReady());
    await windows[0].waitForFunction(()=>output);
    assert.equal(await windows[0].evaluate(()=>outputClicks),1);
    assert.equal(await windows[1].evaluate(()=>output),false,'Other devices must remain off');
    await windows[0].evaluate(()=>{document.querySelector('#stream-window').classList.add('is-direct');setOutput(false);});
    await windows[0].waitForTimeout(350);
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs['0'],true);
    await windows[0].evaluate(()=>document.querySelector('#stream-window').classList.remove('is-direct'));
    await windows[0].waitForFunction(()=>output);
    await windows[0].locator('[aria-label="Speaker"]').click();
    await windows[0].waitForTimeout(350);
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs['0'],false,'Settings speaker off must persist');
    await windows[0].reload();await windows[0].evaluate(()=>setReady());
    await windows[0].waitForTimeout(350);
    assert.equal(await windows[0].evaluate(()=>outputClicks),0,'Remembered off must not toggle');
    await windows[0].locator('.volume-icon').click();
    await windows[0].waitForTimeout(350);
    await windows[0].close();
    const soundReopen=electron.waitForEvent('window');
    await inventory.evaluate(()=>window.workspace.open('0','lan'));
    windows[0]=await soundReopen;await windows[0].waitForURL(endpoint+'/');
    await windows[0].evaluate(()=>setReady());await windows[0].waitForFunction(()=>output);
    assert.equal(await windows[0].evaluate(()=>captureAttempts),0);
    assert.equal(await windows[0].evaluate(()=>typeof window.workspace),'undefined');
    await windows[0].reload();
    await windows[0].evaluate(()=>{document.querySelector('.volume-icon').classList.add('not-allowed');setReady();});
    await windows[0].waitForTimeout(350);
    assert.equal(await windows[0].evaluate(()=>outputClicks),0,'Disabled speaker controls must not be toggled');
    await windows[0].evaluate(()=>document.querySelector('.volume-icon').classList.remove('not-allowed'));
    await windows[0].waitForFunction(()=>output);
    await windows[0].reload();
    await windows[0].evaluate(()=>{
      document.querySelector('.volume-icon use').setAttributeNS('http://www.w3.org/1999/xlink','xlink:href','#unknown-speaker-icon');
      setReady();
    });
    await windows[0].getByRole('alert').filter({hasText:'speaker control is unavailable'}).waitFor({timeout:35000});
    assert.equal(await windows[0].evaluate(()=>outputClicks),0,'Unknown firmware controls must not be toggled');
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs['0'],true,'Restoration failure must preserve intent');
    await windows[0].evaluate(()=>setOutput(false));
    await windows[0].waitForTimeout(350);
    assert.equal(await windows[0].evaluate(()=>outputClicks),0,'Failed restoration must stop attempting');
    await windows[0].locator('.volume-icon').click();
    await windows[0].waitForTimeout(350);
    report.checks.push('sound output persists per device, restores on reload/reopen, respects off and Direct mode, and never captures microphone/camera');
    if(!ci) {
      const titles=await Promise.all(windows.map(async page=>(await electron.browserWindow(page)).evaluate(win=>win.getTitle())));
      const menu=nativeWindowMenu(electron.process().pid);
      for(const title of titles) assert(menu.includes(title),`Native Window menu must list ${title}; received ${JSON.stringify(menu)}`);
      await (await electron.browserWindow(windows[0])).evaluate(win=>win.minimize());
      nativeWindowMenu(electron.process().pid,titles[0]);
      await (await electron.browserWindow(windows[0])).evaluate(async win=>{
        const deadline=Date.now()+5000;
        while(Date.now()<deadline) {
          if(!win.isMinimized() && win.isFocused()) return;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw new Error('Selecting a Window menu entry must restore and focus its native window');
      });
      await windows[2].close();
      assert.equal(nativeWindowMenu(electron.process().pid).includes(titles[2]),false,'Closed sessions must leave the native Window menu');
      const menuReopen=electron.waitForEvent('window');
      await inventory.evaluate(()=>window.workspace.open('2','lan'));
      windows[2]=await menuReopen;
      await windows[2].waitForURL(endpoint+'/');
      await windows[2].locator('#stream-box').waitFor();
      assert(nativeWindowMenu(electron.process().pid).includes(titles[2]),'Reopened sessions must return to the native Window menu');
      report.checks.push('native Window menu lists sessions, restores/focuses selections, and tracks close/reopen');
      if(process.argv.includes('--menu-only')) {console.log(JSON.stringify(report,null,2));return;}
    }
    assert.equal(await windows[0].evaluate(()=>headCaptureInstalled),true);
    report.checks.push('capture wrapper installed before firmware document scripts');
    await windows[0].evaluate(async url=>{try{await fetch(url,{mode:'no-cors'});}catch{}},otherEndpoint);
    assert.equal(crossPortRequests,0);
    report.checks.push('selected certificate trust cannot authorize another port');
    await inventory.evaluate(async ({lan,tailnet})=>window.workspace.save({id:'0',name:'fixture-0',lan,tailnet}),{lan:endpoint,tailnet:otherEndpoint});
    await assert.rejects(inventory.evaluate(()=>window.workspace.open('0','tailnet')),/another route/);
    report.checks.push('different route cannot falsely report success for an existing LAN window');
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs['0'],true,'Inventory edit must preserve sound preference');
    await rename(savedPath,savedPath+'.original');await mkdir(savedPath);
    await assert.rejects(inventory.evaluate(url=>window.workspace.save({id:'0',name:'rejected-edit',lan:url,tailnet:''}),endpoint));
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).devices.find(item=>item.id==='0').name,'fixture-0');
    await rm(savedPath,{recursive:true});await rename(savedPath+'.original',savedPath);
    await inventory.evaluate(url=>window.workspace.save({id:'2',name:'fixture-2',lan:url,tailnet:''}),endpoint);
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).devices.find(item=>item.id==='0').name,'fixture-0');
    report.checks.push('failed atomic inventory writes do not publish or leak into later saves');
    if(!ci) {
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
    }
    for(let index=0;index<3;index++) await windows[index].evaluate(id=>localStorage.setItem('partition-test',id),String(index));
    for(let index=0;index<3;index++) assert.equal(await windows[index].evaluate(()=>localStorage.getItem('partition-test')),String(index));
    assert.equal(await windows[0].evaluate(()=>typeof window.workspace),'undefined');
    assert.equal(await windows[0].evaluate(()=>typeof require),'undefined');
    report.checks.push('same-origin pages have independent storage and no privileged bridge');
    // macOS does not activate a background app when only BrowserWindow.focus runs.
    await electron.evaluate(({app})=>app.focus({steal:true}));
    await (await electron.browserWindow(windows[0])).evaluate(win=>win.focus());
    await windows[0].waitForFunction(()=>document.hasFocus());
    await windows[0].locator('#stream-box').focus();
    await windows[0].keyboard.down('Shift');
    await (await electron.browserWindow(windows[1])).evaluate(win=>win.focus());
    await windows[1].waitForFunction(()=>document.hasFocus());
    await windows[0].waitForFunction(()=>events.some(event=>event.type==='keyup'&&event.key==='ShiftLeft'));
    assert.equal(await windows[2].evaluate(()=>events.some(event=>event.type==='keydown'&&event.key==='ShiftLeft')),false);
    report.checks.push('held modifier released on focus change without broadcasting input');
    const loadIds=await Promise.all(windows.map(page=>page.evaluate(()=>loadId)));
    await electron.evaluate(({BrowserWindow})=>{const target=BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('fixture-1'));target.setSize(800,600);});
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
    if(!ci) await fresh.waitForFunction(()=>localStorage.getItem('gl-kvm-token-key')==='fixture-token-not-a-real-login',null,{timeout:90000});
    await fresh.waitForLoadState('networkidle');
    assert.equal(await fresh.evaluate(()=>localStorage.getItem('partition-test')),null);
    if(!ci) report.checks.push('encrypted saved login restores only to its device endpoint');
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
    assert.equal(Object.hasOwn(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs,'0'),false);
    report.checks.push('failed credential deletion is retryable; concurrent removal blocks opening');
    await fresh.evaluate(()=>setReady());await fresh.locator('.volume-icon').click();
    await windows[2].evaluate(()=>setReady());
    await windows[2].locator('.volume-icon').click();await windows[2].waitForTimeout(350);
    await windows[2].locator('.volume-icon').click();
    await fresh.waitForTimeout(350);
    await electron.close();
    electron=await _electron.launch(launchOptions);
    await electron.evaluate(({dialog})=>{dialog.showErrorBox=(_title,message)=>{throw new Error(message);};});
    const restartedInventory=await electron.firstWindow();await restartedInventory.waitForSelector('#add-device');
    const restartedWindow=electron.waitForEvent('window');
    await restartedInventory.evaluate(()=>window.workspace.open('1','lan'));
    const restored=await restartedWindow;await restored.waitForURL(endpoint+'/');
    await restored.evaluate(()=>setReady());await restored.waitForFunction(()=>output);
    assert.equal(await restored.evaluate(()=>captureAttempts),0);
    const restartedOffWindow=electron.waitForEvent('window');
    await restartedInventory.evaluate(()=>window.workspace.open('2','lan'));
    const restoredOff=await restartedOffWindow;await restoredOff.waitForURL(endpoint+'/');
    await restoredOff.evaluate(()=>setReady());await restoredOff.waitForTimeout(350);
    assert.equal(await restoredOff.evaluate(()=>outputClicks),0,'Explicit off must survive app restart');
    assert.equal(JSON.parse(await readFile(savedPath,'utf8')).soundOutputs['2'],false);
    report.checks.push('remembered sound output restores after full application restart');
    if(ci) report.skipped=['native Window menu (requires Accessibility approval)','Keychain login encryption/restoration (requires authorization)'];
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
