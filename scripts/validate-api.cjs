'use strict';
// Real Electron + HTTP against synthetic firmware. Never sends input to hardware.
const {_electron}=require('playwright-core');
const {createServer}=require('node:https');
const {mkdtemp,mkdir,readFile,writeFile,rm}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const {X509Certificate}=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');

async function run() {
  const root=path.resolve('investigation/private/tmp');
  await mkdir(root,{recursive:true,mode:0o700});
  const directory=await mkdtemp(path.join(root,'api-'));
  const profile=path.join(directory,'profile');await mkdir(profile);
  const certFile=path.join(directory,'cert.pem'),keyFile=path.join(directory,'key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const cert=await readFile(certFile),key=await readFile(keyFile);
  const html=`<!doctype html><title>API fixture</title>
    <button class="volume-icon"><svg><use href="#gl-kvm-sound-off"/></svg></button>
    <div class="remote-device-setting">
      <div class="item flex-btw"><div class="label text-2">Show Local Cursor</div><button role="switch" aria-checked="true"></button></div>
      <div class="item flex-btw"><div class="label text-2">Mouse Jiggle</div><button id="mouse-jiggle" role="switch" aria-checked="false"></button></div>
    </div>
    <div class="ocr-box"><button id="ocr">Capture</button></div><canvas id="gl-kvm-ocr-canvas" style="display:none"></canvas>
    <div id="stream-window" class="stream-window-inited"><div id="stream-box" tabindex="0">Remote input</div></div>
    <script>
    window.events=[];window.output=false;window.blockSpeaker=false;window.blockMouseJiggle=false;window.mouseJiggleClicks=0;window.blockOcr=false;window.ocrClicks=0;
    if(location.search.includes('warming'))document.querySelector('#stream-window').classList.remove('stream-window-inited');
    window.setOutput=value=>{output=value;document.querySelector('use').setAttribute('href',value?'#gl-kvm-sound-full':'#gl-kvm-sound-off');};
    document.querySelector('.volume-icon').onclick=()=>{if(!blockSpeaker)queueMicrotask(()=>setOutput(!output));};
    document.querySelector('#mouse-jiggle').onclick=event=>{mouseJiggleClicks++;if(!blockMouseJiggle)queueMicrotask(()=>event.currentTarget.setAttribute('aria-checked',event.currentTarget.getAttribute('aria-checked')==='false'));};
    document.querySelector('#ocr').onclick=()=>{ocrClicks++;if(!blockOcr)queueMicrotask(()=>document.querySelector('#gl-kvm-ocr-canvas').style.display='block');};
    for(const type of ['keydown','keyup'])document.querySelector('#stream-box').addEventListener(type,event=>events.push({type,code:event.code,meta:event.metaKey,ctrl:event.ctrlKey,keyCode:event.keyCode}));
    </script>`;
  const fixture=createServer({cert,key},(_request,response)=>response.end(html));
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const endpoint=`https://127.0.0.1:${fixture.address().port}`;
  const savedFile=path.join(profile,'devices.json');
  await writeFile(savedFile,JSON.stringify({devices:[{id:'a',name:'laptop',lan:endpoint,tailnet:endpoint},{id:'b',name:'desktop',lan:endpoint,tailnet:''}],pins:{[endpoint]:new X509Certificate(cert).fingerprint256}}));
  const source=process.argv.includes('--source');
  let electron;
  try {
    electron=await _electron.launch({executablePath:source?require('electron'):path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[...(source?[path.resolve('.')]:[]),`--user-data-dir=${profile}`]});
    electron.process().stderr.on('data',chunk=>{if(process.env.KVM_API_DEBUG) process.stderr.write(chunk);});
    const inventory=await electron.firstWindow();await inventory.waitForSelector('#add-device');
    await electron.evaluate(({dialog})=>{dialog.showErrorBox=(_title,message)=>console.error('Validation application error:',message);});
    await inventory.locator('#settings').click({timeout:3000});
    await inventory.waitForSelector('#settings-dialog[open]');
    assert.equal(await inventory.locator('#api-enabled').isChecked(),false);
    await assert.rejects(fetch('http://127.0.0.1:53241/openapi.json'));
    await inventory.locator('#copy-api-token').click();
    await inventory.waitForFunction(()=>document.querySelector('#settings-feedback').textContent==='Token copied.');
    const oldToken=await electron.evaluate(({clipboard})=>clipboard.readText());
    assert.match(oldToken,/^[a-f0-9]{64}$/);
    await inventory.locator('#api-enabled').check();
    await inventory.waitForFunction(()=>document.querySelector('#api-status').textContent.includes('Listening'));
    await inventory.locator('#regenerate-api-token').click();
    await inventory.waitForFunction(()=>document.querySelector('#settings-feedback').textContent.includes('regenerated'));
    await inventory.locator('#copy-api-token').click();
    await inventory.waitForFunction(()=>document.querySelector('#settings-feedback').textContent==='Token copied.');
    const token=await electron.evaluate(({clipboard})=>clipboard.readText());
    assert.notEqual(token,oldToken);
    assert.equal((await fetch('http://127.0.0.1:53241/sessions',{headers:{authorization:`Bearer ${oldToken}`}})).status,401);
    await inventory.locator('#close-settings').click();
    // Exercise the native menu entry as well as the workspace button.
    await electron.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('settings').click());
    await inventory.waitForSelector('#settings-dialog[open]');
    await inventory.keyboard.press('Escape');
    await inventory.waitForSelector('#settings-dialog:not([open])',{state:'attached'});
    const docsWindow=electron.waitForEvent('window');
    await electron.evaluate(({BrowserWindow})=>{const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});void win.loadURL('http://127.0.0.1:53241/docs');});
    const docs=await docsWindow;
    await docs.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:53241'?route.continue():route.abort());
    await docs.reload();
    await docs.getByRole('heading',{name:'KVM Workspace Local API'}).waitFor();
    await docs.locator('.scheme-container .authorize').click();
    await docs.locator('.auth-container input').fill(token);
    await docs.locator('.auth-btn-wrapper .authorize').click();
    await docs.getByRole('button',{name:'Close',exact:true}).click();
    const listOperation=docs.locator('.opblock').filter({has:docs.locator('[data-path="/sessions"]')});
    await listOperation.locator('.opblock-summary').click();
    await listOperation.getByRole('button',{name:'Try it out'}).click();
    await listOperation.getByRole('button',{name:'Execute',exact:true}).click();
    await listOperation.locator('.responses-inner .response-col_status').filter({hasText:'200'}).first().waitFor();
    assert.match(await listOperation.locator('.highlight-code').first().textContent(),/laptop/);
    await docs.reload();
    await docs.waitForFunction(()=>window.ui?.authSelectors.authorized().size===0);
    await docs.close();
    const call=async(url,method='GET',body)=>{
      const response=await fetch('http://127.0.0.1:53241'+url,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      if(process.env.KVM_API_DEBUG) console.log(method,url,response.status);
      return {status:response.status,body:await response.json()};
    };
    assert.equal((await fetch('http://127.0.0.1:53241/sessions')).status,401);
    assert.deepEqual((await call('/sessions')).body,[{name:'laptop',state:'closed',route:null,speaker:{enabled:null},mouseJiggle:{enabled:null}},{name:'desktop',state:'closed',route:null,speaker:{enabled:null},mouseJiggle:{enabled:null}}]);
    assert.equal((await call('/sessions/laptop/start','POST',{})).status,400);
    const next=electron.waitForEvent('window');
    assert.equal((await call('/sessions/laptop/start','POST',{route:'lan'})).status,200);
    const laptop=await next;await laptop.waitForSelector('#stream-box');
    assert.equal(await laptop.evaluate(()=>typeof window.__workspaceSessionAction),'undefined','Device scripts must not see the isolated control entry point');
    assert.equal((await call('/sessions?state=open')).body.length,1);
    const second=electron.waitForEvent('window');
    assert.equal((await call('/sessions/desktop/start','POST',{route:'lan'})).status,200);
    const desktop=await second;await desktop.waitForSelector('#stream-box');
    assert.equal((await call('/sessions/laptop/start','POST',{route:'lan'})).status,200);
    assert.equal((await call('/sessions/laptop/start','POST',{route:'tailnet'})).status,409);
    assert.equal((await call('/sessions/desktop/start','POST',{route:'tailnet'})).status,409);
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).focus());
    const focusedBefore=await electron.evaluate(({BrowserWindow})=>BrowserWindow.getFocusedWindow()?.id??null);
    assert.equal((await call('/sessions/laptop/send-keys','POST',{keys:['MetaLeft','KeyD']})).status,200);
    assert.deepEqual(await laptop.evaluate(()=>events),[
      {type:'keydown',code:'MetaLeft',meta:true,ctrl:false,keyCode:91},
      {type:'keydown',code:'KeyD',meta:true,ctrl:false,keyCode:68},
      {type:'keyup',code:'KeyD',meta:true,ctrl:false,keyCode:68},
      {type:'keyup',code:'MetaLeft',meta:false,ctrl:false,keyCode:91},
    ]);
    assert.deepEqual(await desktop.evaluate(()=>events),[]);
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getFocusedWindow()?.id??null),focusedBefore,'Sending keys must not steal native focus');
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,false);
    assert.deepEqual((await call('/sessions/laptop/mouse-jiggle/toggle','POST')).body,{enabled:true});
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,true);
    await laptop.locator('#mouse-jiggle').click();
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,false,'Read live manual Mouse Jiggle changes');
    const jiggles=await Promise.all([call('/sessions/laptop/mouse-jiggle/toggle','POST'),call('/sessions/laptop/mouse-jiggle/toggle','POST')]);
    assert.deepEqual(jiggles.map(result=>result.body.enabled),[true,false]);
    await laptop.evaluate(()=>{blockMouseJiggle=true;});
    const jiggleClicks=await laptop.evaluate(()=>mouseJiggleClicks);
    assert.equal((await call('/sessions/laptop/mouse-jiggle/toggle','POST')).status,409);
    assert.equal(await laptop.evaluate(()=>mouseJiggleClicks),jiggleClicks+1,'A failed Mouse Jiggle toggle must click only once');
    await laptop.evaluate(()=>{blockMouseJiggle=false;document.querySelector('#mouse-jiggle').closest('.item').querySelector('.label').textContent='Unknown';});
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,null);
    assert.equal((await call('/sessions/laptop/mouse-jiggle/toggle','POST')).status,409);
    await laptop.evaluate(()=>{document.querySelector('#mouse-jiggle').closest('.item').querySelector('.label').textContent='Mouse Jiggle';});
    assert.deepEqual((await call('/sessions/laptop/ocr','POST')).body,{triggered:true});
    assert.equal(await laptop.evaluate(()=>ocrClicks),1);
    await laptop.evaluate(()=>{document.querySelector('#gl-kvm-ocr-canvas').style.display='none';blockOcr=true;});
    assert.equal((await call('/sessions/laptop/ocr','POST')).status,409);
    assert.equal(await laptop.evaluate(()=>ocrClicks),2,'A failed OCR trigger must click only once');
    assert.deepEqual((await call('/sessions/laptop/speaker/toggle','POST')).body,{enabled:true});
    assert.equal((await call('/sessions/laptop')).body.speaker.enabled,true);
    assert.equal(JSON.parse(await readFile(savedFile,'utf8')).soundOutputs.a,true);
    assert.deepEqual((await call('/sessions/laptop/speaker','PUT',{enabled:false})).body,{enabled:false});
    assert.equal(await laptop.evaluate(()=>output),false);
    await laptop.locator('.volume-icon').click();
    assert.equal((await call('/sessions/laptop')).body.speaker.enabled,true,'Read live manual changes');
    const toggles=await Promise.all([call('/sessions/laptop/speaker/toggle','POST'),call('/sessions/laptop/speaker/toggle','POST')]);
    assert.deepEqual(toggles.map(result=>result.body.enabled),[false,true]);
    assert.equal((await call('/sessions/desktop')).body.speaker.enabled,false,'Other session audio must be untouched');
    await laptop.evaluate(()=>{blockSpeaker=true;});
    assert.equal((await call('/sessions/laptop/speaker/toggle','POST')).status,409);
    assert.equal(JSON.parse(await readFile(savedFile,'utf8')).soundOutputs.a,true,'Unconfirmed changes must not overwrite saved intent');
    await laptop.evaluate(()=>{blockSpeaker=false;blockOcr=false;document.querySelector('#gl-kvm-ocr-canvas').style.display='none';document.querySelector('#stream-window').classList.add('is-direct');});
    assert.equal((await call('/sessions/laptop')).body.speaker.enabled,null);
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,false);
    assert.deepEqual((await call('/sessions/laptop/mouse-jiggle/toggle','POST')).body,{enabled:true});
    assert.deepEqual((await call('/sessions/laptop/ocr','POST')).body,{triggered:true});
    assert.equal((await call('/sessions/laptop/speaker/toggle','POST')).status,409);
    await laptop.evaluate(()=>document.querySelector('#stream-window').classList.remove('is-direct'));
    await laptop.goto(endpoint+'/?warming=1');
    assert.equal((await call('/sessions/laptop/speaker/toggle','POST')).status,409);
    assert.equal((await call('/sessions/laptop')).body.mouseJiggle.enabled,null);
    assert.equal((await call('/sessions/laptop/mouse-jiggle/toggle','POST')).status,409);
    assert.equal((await call('/sessions/laptop/ocr','POST')).status,409);
    await laptop.evaluate(()=>document.querySelector('#stream-window').classList.add('stream-window-inited'));
    await laptop.waitForFunction(()=>output,null,{timeout:3000});
    assert.equal((await call('/sessions/laptop')).body.speaker.enabled,true,'A premature API request must not suppress saved-state restoration');
    const native=await electron.browserWindow(laptop);await native.evaluate(win=>win.minimize());
    assert.equal((await call('/sessions/laptop/focus','POST')).status,200);
    assert.equal(await native.evaluate(win=>!win.isMinimized()&&win.isVisible()),true);
    await inventory.evaluate(url=>window.workspace.save({id:'a',name:'renamed-laptop',lan:url,tailnet:url}),endpoint);
    assert.equal((await inventory.evaluate(()=>window.workspace.list())).sessions.find(item=>item.deviceId==='a').name,'renamed-laptop');
    assert.equal((await call('/sessions/laptop')).status,404);
    assert.equal((await call('/sessions/renamed-laptop')).body.state,'open');
    const popup=electron.waitForEvent('window');
    await laptop.evaluate(()=>{window.onbeforeunload=()=>false;window.open('/child');});
    const child=await popup;await child.waitForLoadState();
    await child.evaluate(()=>{window.onbeforeunload=()=>false;});
    const childClosed=child.waitForEvent('close');
    assert.equal((await call('/sessions/renamed-laptop/end','POST')).body.state,'closed');
    await childClosed;
    assert.equal((await call('/sessions/renamed-laptop/end','POST')).status,200);
    for(const action of ['focus','send-keys','speaker/toggle','mouse-jiggle/toggle','ocr']) assert.equal((await call(`/sessions/renamed-laptop/${action}`,'POST',action==='send-keys'?{keys:['KeyD']}:undefined)).status,409);
    assert.equal((await call('/sessions/renamed-laptop')).body.speaker.enabled,null);
    assert.equal((await call('/sessions/renamed-laptop')).body.mouseJiggle.enabled,null);
    assert.equal((await call('/sessions/missing/end','POST')).status,404);
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.getTitle().startsWith('desktop')).webContents.executeJavaScriptInIsolatedWorld(999,[{code:'void(window.__workspaceSessionAction=()=>new Promise(()=>{}))'}]));
    const list=await call('/sessions');
    assert.equal(list.status,200,'An unresolved renderer must not hang the complete session list');
    assert.equal(list.body.find(item=>item.name==='desktop').speaker.enabled,null);
    assert.equal(list.body.find(item=>item.name==='desktop').mouseJiggle.enabled,null);
    assert.equal((await call('/sessions/desktop/send-keys','POST',{keys:['KeyD']})).status,409);
    assert.equal((await call('/sessions/desktop/end','POST')).status,409,'Failed input release must be explicit');
    assert.equal((await call('/sessions/desktop')).body.state,'closed','End must disconnect even an unresponsive session');
    await electron.close();
    electron=await _electron.launch({executablePath:source?require('electron'):path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[...(source?[path.resolve('.')]:[]),`--user-data-dir=${profile}`]});
    const restarted=await electron.firstWindow();await restarted.waitForSelector('#settings');
    assert.equal((await call('/sessions')).status,200,'Enabled preference and rotated token survive restart');
    await restarted.locator('#settings').click();
    await restarted.locator('#api-enabled').uncheck();
    await restarted.waitForFunction(()=>document.querySelector('#api-status').textContent==='Web server is off.');
    for(const route of ['/sessions','/docs','/openapi.json']) await assert.rejects(fetch('http://127.0.0.1:53241'+route));
    await electron.close();
    electron=await _electron.launch({executablePath:source?require('electron'):path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[...(source?[path.resolve('.')]:[]),`--user-data-dir=${profile}`]});
    const disabled=await electron.firstWindow();await disabled.waitForSelector('#settings');
    await disabled.locator('#settings').click();
    assert.equal(await disabled.locator('#api-enabled').isChecked(),false);
    await assert.rejects(fetch('http://127.0.0.1:53241/docs'));
    console.log('API integration passed: settings/menu, default-off and restart persistence, clipboard/rotation, offline Swagger authorization and Try it out, HTTP auth, session lifecycle, focus, input, audio and errors. Synthetic firmware only.');
  } finally {
    if(electron) {
      const timer=setTimeout(()=>electron.process().kill('SIGKILL'),5000);
      try {await electron.close();} finally {clearTimeout(timer);}
    }
    await new Promise(resolve=>fixture.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
