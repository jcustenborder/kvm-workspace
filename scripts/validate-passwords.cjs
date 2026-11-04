'use strict';
// Synthetic firmware UI; --keychain opts into real native Keychain operations.
const {_electron}=require('playwright-core');
const {mkdtemp,readFile,rm,mkdir}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const {createServer}=require('node:https');
const {X509Certificate,randomUUID}=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');

async function run() {
  const root=path.resolve('investigation/private/tmp');await mkdir(root,{recursive:true,mode:0o700});
  const temporary=await mkdtemp(path.join(root,'kvm-password-test-'));
  const keyPath=path.join(temporary,'key.pem'),certPath=path.join(temporary,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const key=await readFile(keyPath),cert=await readFile(certPath),pin=new X509Certificate(cert).fingerprint256;
  const fixture=`<!doctype html><style>.auth-form-container{padding:20px}</style><div id="app"></div><script>
    window.submissions=0;
    window.login=()=>{
      location.hash='/login';
      document.querySelector('#app').innerHTML='<div class="auth-form-container"><div class="login-form"><form class="login-form"><input type="password" name="passwd"></form><button class="operation-btn">Log In</button></div></div>';
      const input=document.querySelector('input');
      if(location.search.includes('unrecognized')) input.removeAttribute('name');
      let value='';input.addEventListener('input',()=>value=input.value);
      if(location.search.includes('twofa')) input.insertAdjacentHTML('afterend','<input name="twofaCode">');
      document.querySelector('button').onclick=()=>{
        void fetch('/attempt');
        window.loginVisibleOnSubmit=getComputedStyle(document.querySelector('.auth-form-container')).visibility!=='hidden';
        submissions++; const button=document.querySelector('button');button.classList.add('ant-btn-loading');
        setTimeout(()=>{
          if(value==='fixture-only-P@ss"\\u2603' && !location.search.includes('reject')) {
            location.hash='/kvm';document.querySelector('#app').innerHTML='<div id="stream-box" tabindex="0">Authenticated</div>';
          } else {button.classList.remove('ant-btn-loading');button.insertAdjacentHTML('afterend','<div class="ant-message-error">Password rejected</div>');}
        },150);
      };
    };
    if(localStorage.getItem('gl-kvm-token-key')==='fixture-valid-token') {
      location.hash='/kvm';document.querySelector('#app').innerHTML='<div id="stream-box">Authenticated with token</div>';
    } else login();
  </script>`;
  let loginRequests=0;
  const server=createServer({key,cert},(request,response)=>{
    if(request.url==='/attempt') {loginRequests++;response.end('recorded');return;}
    response.writeHead(200,{'content-type':'text/html'});response.end(fixture);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`https://127.0.0.1:${server.address().port}`;
  const tailnet=`https://localhost:${server.address().port}`;
  const ids=[randomUUID(),randomUUID()];
  const electron=await _electron.launch({executablePath:path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),args:[`--user-data-dir=${path.join(temporary,'profile')}`]});
  const realKeychain=process.argv.includes('--keychain');
  try {
    const inventory=await electron.firstWindow();await inventory.waitForSelector('#add-device');
    await electron.evaluate(({app,dialog,safeStorage},{pin,realKeychain})=>{
      dialog.showMessageBox=async (...args)=>({response:args.at(-1).detail?.includes(pin)?1:0});
      globalThis.passwordErrors=[];dialog.showErrorBox=(_title,message)=>passwordErrors.push(message);
      if(!realKeychain) {
        safeStorage.isAsyncEncryptionAvailable=async()=>true;
        safeStorage.decryptStringAsync=async bytes=>{
          globalThis.tokenRestoreStarted=true;
          if(globalThis.tokenRestoreGate)await tokenRestoreGate;
          return {result:Buffer.from(bytes).toString()};
        };
        const passwords=process.mainModule.require(app.getAppPath()+'/src/passwords.cjs');
        globalThis.savedPasswords=new Map();
        passwords.passwordEntry=id=>({
          getPassword:async()=>{if(globalThis.passwordReadFails)throw new Error('Keychain unavailable');if(globalThis.passwordReadGate)await passwordReadGate;return savedPasswords.get(id)??null;},
          setPassword:async value=>{if(globalThis.passwordWriteFails)throw new Error('Keychain locked');savedPasswords.set(id,value);},
          deletePassword:async()=>{if(globalThis.passwordDeleteFails)throw new Error('Keychain locked');return savedPasswords.delete(id);}
        });
      }
    },{pin,realKeychain});
    /** @param {string | null} value */
    const editPassword=async value=>{
      await inventory.locator('[data-action=edit]').first().click();
      await inventory.waitForFunction(()=>document.querySelector('#device-password').value==='');
      if(value===null)await inventory.locator('#device-remove-password').check();
      else await inventory.locator('#device-password').fill(value);
      await inventory.locator('#save-device').click();
      await inventory.locator('#device-dialog').waitFor({state:'hidden'});
      await inventory.waitForFunction(()=>document.querySelector('#device-password').value==='');
    };
    /** @param {string} id @param {string} [route] */
    const open=async(id,route='lan')=>{
      const next=electron.waitForEvent('window');
      await inventory.evaluate(async({id,route})=>window.workspace.open(id,route),{id,route});
      const page=await next;await page.waitForSelector('input[name=passwd]',{state:'attached'});return page;
    };
    await inventory.locator('#add-device').click();
    await inventory.locator('#device-name').fill('Same display name');
    await inventory.locator('#device-lan').fill(endpoint);
    await inventory.locator('#device-tailnet').fill(tailnet);
    await inventory.locator('#device-password').fill('fixture-only-P@ss"\u2603');
    if(!realKeychain) {
      await mkdir(path.join(temporary,'profile','devices.json'));
      await inventory.locator('#save-device').click();
      await inventory.locator('#device-error').filter({hasText:'password was updated'}).waitFor();
      assert.equal((await inventory.evaluate(()=>window.workspace.list())).devices.length,0);
      await rm(path.join(temporary,'profile','devices.json'),{recursive:true});
    }
    await inventory.locator('#save-device').click();
    await inventory.locator('#device-dialog').waitFor({state:'hidden'});
    ids[0]=(await inventory.evaluate(()=>window.workspace.list())).devices[0].id;
    if(!realKeychain) assert.deepEqual(await electron.evaluate(()=>[...savedPasswords.keys()]),[ids[0]],'Retry must reuse the credential ID instead of orphaning the first password');
    await inventory.evaluate(async({id,endpoint,tailnet})=>window.workspace.save({id,name:'Same display name',lan:endpoint,tailnet}),{id:ids[1],endpoint,tailnet});
    let page=await open(ids[0]);
    await page.waitForSelector('#stream-box');
    assert.equal(await page.evaluate(()=>submissions),1);
    assert.equal(await page.evaluate(()=>loginVisibleOnSubmit),false);
    for(const invalid of ['',false,{},42]) {
      await assert.rejects(inventory.evaluate(async({id,endpoint,invalid})=>window.workspace.save({id,name:'Same display name',lan:endpoint,tailnet:''},invalid),{id:ids[0],endpoint,invalid}),/nonempty password/);
    }
    await assert.rejects(inventory.evaluate(async({id,endpoint})=>window.workspace.save({id,name:'',lan:endpoint,tailnet:''},'must-not-save'),{id:ids[0],endpoint}),/device name/);
    const listed=await inventory.evaluate(()=>window.workspace.list());
    const persisted=JSON.parse(await readFile(path.join(temporary,'profile','devices.json'),'utf8'));
    for(const device of [listed.devices[0],persisted.devices[0]]) assert.deepEqual(Object.keys(device).sort(),['id','lan','name','tailnet']);
    await page.reload();await page.waitForSelector('#stream-box');
    console.log('PASS: invalid credential updates and device details cannot replace a working password; inventory contains no credential fields');
    await page.close();
    page=await open(ids[0],'tailnet');
    await page.waitForSelector('#stream-box');
    assert.equal(await page.evaluate(()=>submissions),1);
    assert.equal(await page.evaluate(()=>loginVisibleOnSubmit),false);
    await editPassword('');
    await inventory.locator('[data-action=edit]').first().click();
    await inventory.locator('#device-password').fill('cancelled-wrong-password');
    await inventory.locator('#device-remove-password').check();
    await inventory.locator('#cancel-device').click();
    await inventory.waitForFunction(()=>document.querySelector('#device-password').value==='');
    await page.reload();await page.waitForSelector('#stream-box');
    console.log('PASS: editor save logs in across routes; blank preserves and Cancel discards password edits');
    await page.evaluate(()=>login());await page.waitForSelector('#stream-box');
    assert.equal(await page.evaluate(()=>submissions),2);
    console.log('PASS: SPA session expiry automatically reauthenticates');
    if(!realKeychain) {
      for(const token of ['fixture-valid-token','fixture-expired-token']) {
        await page.close();
        await electron.evaluate(async({app},{id,endpoint,token})=>{
          const fs=process.mainModule.require('node:fs/promises');
          await fs.writeFile(app.getPath('userData')+'/login-'+id+'.encrypted',JSON.stringify({endpoint,storage:{'gl-kvm-token-key':token}}));
          globalThis.tokenRestoreStarted=false;
          globalThis.tokenRestoreGate=new Promise(resolve=>{globalThis.releaseTokenRestore=resolve;});
        },{id:ids[0],endpoint:tailnet,token});
        const before=loginRequests,next=electron.waitForEvent('window');
        const opening=inventory.evaluate(id=>window.workspace.open(id,'tailnet'),ids[0]);
        page=await next;await page.waitForSelector('input[name=passwd]',{state:'attached'});
        await electron.evaluate(async()=>{
          const deadline=Date.now()+5000;
          while(!tokenRestoreStarted) {if(Date.now()>deadline)throw new Error('Token restore did not start');await new Promise(resolve=>setTimeout(resolve,20));}
        });
        assert.equal(await page.evaluate(()=>submissions),0);
        assert.equal(loginRequests,before);
        await electron.evaluate(()=>{releaseTokenRestore();globalThis.tokenRestoreGate=null;});
        await opening;await page.waitForSelector('#stream-box');
        assert.equal(loginRequests-before,token==='fixture-valid-token'?0:1);
      }
      await electron.evaluate(async({app},id)=>process.mainModule.require('node:fs/promises').unlink(app.getPath('userData')+'/login-'+id+'.encrypted'),ids[0]);
      console.log('PASS: token restoration finishes first; valid tokens skip passwords and expired tokens fall back once');
    }
    await page.goto(tailnet+'/?reject=1');await page.waitForSelector('.ant-message-error');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-form-container')).visibility==='visible');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>submissions),1);
    console.log('PASS: rejected password reveals login without retry');
    await inventory.locator('[data-action=edit]').first().click();
    await inventory.locator('#device-password').fill('replacement-rejected');
    await inventory.locator('#device-remove-password').check();
    await inventory.locator('#save-device').click();
    await inventory.locator('#device-dialog').waitFor({state:'hidden'});
    await page.goto(tailnet+'/');await page.waitForSelector('.ant-message-error');
    assert.equal(await page.locator('input[name=passwd]').inputValue(),'replacement-rejected');
    await editPassword('fixture-only-P@ss"\u2603');
    await page.goto(tailnet+'/');await page.waitForSelector('#stream-box');
    console.log('PASS: explicit save replaces a rejected password and can recover');
    await page.goto(tailnet+'/?twofa=1');await page.waitForSelector('input[name=twofaCode]');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-form-container')).visibility==='visible');
    assert.equal(await page.evaluate(()=>submissions),0);
    console.log('PASS: two-factor authentication stays available for manual entry');
    await page.goto(tailnet+'/?unrecognized=1');
    await page.getByRole('status').filter({hasText:'not recognized'}).waitFor();
    assert.equal(await page.locator('input[type=password]').inputValue(),'');
    assert.equal(await page.evaluate(()=>submissions),0);
    console.log('PASS: unrecognized firmware login reports why manual authentication is needed');
    await page.goto(tailnet+'/');await page.waitForSelector('#stream-box');
    await page.evaluate(()=>{login();location.hash='/settings';});
    await page.waitForTimeout(200);
    assert.equal(await page.locator('input[name=passwd]').inputValue(),'');
    assert.equal(await page.evaluate(()=>submissions),1);
    console.log('PASS: firmware-shaped password fields outside the login route are not filled');
    if(!realKeychain) {
      await electron.evaluate(()=>{globalThis.passwordReadFails=true;});
      await page.goto(tailnet+'/');
      await page.getByRole('status',{name:''}).filter({hasText:'could not be loaded'}).waitFor();
      assert.equal(await page.locator('input[name=passwd]').inputValue(),'');
      assert.equal(await page.evaluate(()=>submissions),0);
      await electron.evaluate(()=>{globalThis.passwordReadFails=false;globalThis.passwordReadGate=new Promise(resolve=>{globalThis.releasePasswordRead=resolve;});});
      await page.reload();
      await page.getByRole('status').filter({hasText:'Signing in with'}).waitFor();
      await page.evaluate(()=>{location.hash='/settings';});
      await electron.evaluate(()=>{releasePasswordRead();globalThis.passwordReadGate=null;});
      await page.waitForTimeout(200);
      assert.equal(await page.locator('input[name=passwd]').inputValue(),'');
      assert.equal(await page.evaluate(()=>submissions),0);
      console.log('PASS: Keychain errors and navigation during delayed reads restore manual access without leaking a password');
      await electron.evaluate(()=>{globalThis.passwordReadGate=new Promise(resolve=>{globalThis.releasePasswordRead=resolve;});});
      await page.goto(tailnet+'/');
      await page.getByRole('status').filter({hasText:'timed out'}).waitFor({timeout:20000});
      await page.locator('input[name=passwd]').fill('manual-entry-after-timeout');
      await electron.evaluate(()=>{releasePasswordRead();globalThis.passwordReadGate=null;});
      await page.waitForTimeout(200);
      assert.equal(await page.locator('input[name=passwd]').inputValue(),'manual-entry-after-timeout');
      assert.equal(await page.evaluate(()=>submissions),0);
      console.log('PASS: bounded timeout restores login; a late credential cannot overwrite manual input');
      await electron.evaluate(()=>{globalThis.passwordWriteFails=true;});
      await inventory.locator('[data-action=edit]').first().click();
      await inventory.locator('#device-password').fill('failed-write');
      await inventory.locator('#save-device').click();
      await inventory.locator('#device-error').filter({hasText:'Keychain'}).waitFor();
      assert.equal(await inventory.locator('#device-dialog').isVisible(),true);
      await inventory.locator('#cancel-device').click();
      await electron.evaluate(()=>{globalThis.passwordWriteFails=false;});
      console.log('PASS: Keychain save failures stay visible and retryable in the editor');
      await electron.evaluate(()=>{globalThis.passwordDeleteFails=true;});
      await inventory.locator('[data-action=edit]').first().click();
      await inventory.locator('#device-remove-password').check();
      await inventory.locator('#save-device').click();
      await inventory.locator('#device-error').filter({hasText:'Keychain'}).waitFor();
      await inventory.locator('#cancel-device').click();
      await electron.evaluate(()=>{globalThis.passwordDeleteFails=false;});
      await page.goto(tailnet+'/');await page.waitForSelector('#stream-box');
      console.log('PASS: failed password removal is reported and preserves the working credential');
    }
    await page.close();
    const other=await open(ids[1]);
    await other.getByRole('status').filter({hasText:'No password is saved'}).waitFor();
    await other.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-form-container')).visibility==='visible');
    assert.equal(await other.locator('input[name=passwd]').inputValue(),'');
    assert.equal(await other.evaluate(()=>submissions),0);
    assert.equal(await other.evaluate(()=>typeof window.workspace),'undefined');
    console.log('PASS: identically named devices do not share passwords or expose credential IPC');
    await other.close();
    page=await open(ids[0]);await page.waitForSelector('#stream-box');
    if(!realKeychain) {
      await electron.evaluate(()=>{globalThis.passwordReadGate=new Promise(resolve=>{globalThis.releasePasswordRead=resolve;});});
      await page.evaluate(()=>login());
      await page.getByRole('status').filter({hasText:'Signing in with'}).waitFor();
    }
    const forgetting=editPassword(null);
    if(!realKeychain) {
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-form-container')).visibility==='visible',null,{timeout:3000});
      await electron.evaluate(()=>{releasePasswordRead();globalThis.passwordReadGate=null;});
      await page.waitForTimeout(250);
      assert.equal(await page.locator('input[name=passwd]').inputValue(),'');
    }
    await forgetting;
    await page.evaluate(()=>login());
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-form-container')).visibility==='visible');
    assert.equal(await page.locator('input[name=passwd]').inputValue(),'');
    assert.equal(await page.evaluate(()=>submissions),1);
    assert.deepEqual(await electron.evaluate(()=>passwordErrors),[]);
    console.log('PASS: forgetting the password disables subsequent automatic login');
    await page.close();
    if(!realKeychain) {
      await electron.evaluate(()=>{globalThis.passwordDeleteFails=true;});
      await assert.rejects(inventory.evaluate(id=>window.workspace.remove(id),ids[0]),/Keychain/);
      assert((await inventory.evaluate(()=>window.workspace.list())).devices.some(device=>device.id===ids[0]));
      await electron.evaluate(()=>{globalThis.passwordDeleteFails=false;});
    }
    await inventory.evaluate(id=>window.workspace.remove(id),ids[0]);
    assert(!(await inventory.evaluate(()=>window.workspace.list())).devices.some(device=>device.id===ids[0]));
    console.log('PASS: device removal clears its credential; failed deletion remains retryable');
  } finally {
    try {
      if(realKeychain)await electron.evaluate(async({app},ids)=>{
        const {passwordEntry}=process.mainModule.require(app.getAppPath()+'/src/passwords.cjs');
        for(const id of ids)await passwordEntry(id).deletePassword();
      },ids);
    } finally {
      await electron.close();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});
    }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
