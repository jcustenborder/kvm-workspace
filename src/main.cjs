'use strict';
const {app,BrowserWindow,Menu,dialog,ipcMain,session,shell,safeStorage,systemPreferences} = require('electron');
const {readFile,writeFile,mkdir,rename,unlink} = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID,X509Certificate} = require('node:crypto');
const {validateInventory,updateDevices,sameOrigin,certificateMatches} = require('./model.cjs');
const {serial} = require('./serial.cjs');

app.setName('KVM Workspace');
const ownsInstance=app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance',() => showInventory());
// Visible sessions must continue media processing independently of keyboard focus.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const inventoryURL = pathToFileURL(path.join(__dirname,'index.html')).href;
/** @type {Electron.BrowserWindow | null} */
let inventory = null;
/** @type {{devices:Array<{id:string,name:string,lan:string,tailnet:string}>,pins:Record<string,string>}} */
let data = {devices:[],pins:{}};
/** @type {Map<string,{id:string,deviceId:string,name:string,endpoint:string,window:Electron.BrowserWindow,session:Electron.Session}>} */
const sessions = new Map();
/** @type {Map<string,Promise<void>>} */
const cleanupTasks = new Map();
const pendingOpens = new Set();
const pendingRemovals = new Set();

/** @returns {string} */
function dataPath() { return path.join(app.getPath('userData'),'devices.json'); }
/** @param {(current:typeof data) => typeof data} mutate @returns {Promise<void>} */
async function updateData(mutate) {
  await serial('inventory',async () => {
    const next=mutate(data);
    await mkdir(app.getPath('userData'),{recursive:true,mode:0o700});
    const temporary = `${dataPath()}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600,flag:'wx'});
    try { await rename(temporary,dataPath()); }
    catch(error) { await unlink(temporary); throw error; }
    data=next;
    changed();
  });
}
function changed() { inventory?.webContents.send('inventory:changed'); }
/** @param {unknown} error */
function report(error) {
  console.error('[workspace] operation failed:', error instanceof Error ? error.message : 'Unknown error');
  dialog.showErrorBox('KVM Workspace',error instanceof Error ? error.message : 'Operation failed.');
}

function showInventory() {
  if (inventory && !inventory.isDestroyed()) { inventory.show(); inventory.focus(); return; }
  inventory = new BrowserWindow({width:890,height:680,minWidth:620,minHeight:460,title:'KVM Workspace',backgroundColor:'#11141b',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  inventory.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  inventory.webContents.on('will-navigate',(event) => event.preventDefault());
  inventory.on('closed',() => { inventory = null; });
  void inventory.loadURL(inventoryURL).catch(report);
}

/** @param {Electron.IpcMainInvokeEvent} event */
function requireInventory(event) {
  if (!inventory || event.sender !== inventory.webContents || event.senderFrame !== inventory.webContents.mainFrame || event.senderFrame.url !== inventoryURL) {
    throw new Error('This operation is available only from the device inventory.');
  }
}

/** @param {string} endpoint @param {string} pem @returns {Promise<void>} */
async function approveCertificate(endpoint,pem) {
  const certificate = new X509Certificate(pem);
  if (certificateMatches(data.pins,endpoint,certificate.fingerprint256)) return;
  const response = await dialog.showMessageBox({type:'warning',title:'Verify KVM certificate',
    message:`Trust this certificate for ${endpoint}?`,detail:`Device certificate: ${certificate.subject}\nValid: ${certificate.validFrom} — ${certificate.validTo}\nSHA-256:\n${certificate.fingerprint256}\n\nCompare this fingerprint with your device before accepting. A changed certificate will require approval again.`,
    buttons:['Cancel','Trust this device certificate'],defaultId:0,cancelId:0,noLink:true});
  if (response.response !== 1) throw new Error('Device certificate was not trusted.');
  await updateData(current=>({...current,pins:{...current.pins,[endpoint]:certificate.fingerprint256}}));
}

/** @param {{id:string,name:string,lan:string,tailnet:string}} device @param {string} endpoint */
async function openSession(device,endpoint) {
  await cleanupTasks.get(device.id);
  const mediaControl = await readFile(path.join(__dirname,'media-control.js'),'utf8');
  const current=data.devices.find(item=>item.id===device.id);
  if (!current || ![current.lan,current.tailnet].includes(endpoint)) throw new Error('Device addresses changed while opening. Open it again from the inventory.');
  const existing = [...sessions.values()].find((item) => item.deviceId === device.id);
  if (existing) {
    if (existing.endpoint!==endpoint) throw new Error('This device is open using another route. Close its current window before switching LAN/Tailnet.');
    existing.window.show(); existing.window.focus(); return;
  }
  const id = randomUUID();
  // Reuse each device's context after cleanup instead of retaining a new Chromium
  // partition on every reopen. Different devices never share browser state.
  const isolated = session.fromPartition(`kvm-device-${device.id}`,{cache:false});
  isolated.webRequest.onBeforeRequest((details,callback) => {
    const request=new URL(details.url), selected=new URL(endpoint);
    if(request.protocol==='wss:') request.protocol='https:';
    // This URL-aware guard runs before TLS. A host-only verifier must never
    // authorize another port using the selected endpoint's certificate pin.
    callback({cancel:request.hostname===selected.hostname && request.origin!==selected.origin});
  });
  isolated.setCertificateVerifyProc((request,callback) => {
    try {
      const certificate = new X509Certificate(request.certificate.data);
      const hostMatches = request.hostname === new URL(endpoint).hostname.replace(/^\[|\]$/g,'');
      if (!hostMatches) { callback(request.errorCode === 0 ? 0 : -2); return; }
      if ((!data.pins[endpoint] && request.errorCode === 0) || certificateMatches(data.pins,endpoint,certificate.fingerprint256)) { callback(0); return; }
      // Rejecting in this verifier does not reach certificate-error in Chromium.
      // Approval must finish here, before any authenticated request is sent.
      void approveCertificate(endpoint,request.certificate.data).then(() => callback(0)).catch(() => callback(-2));
    } catch { callback(-2); }
  });
  const win = new BrowserWindow({width:1280,height:800,minWidth:640,minHeight:420,title:`${device.name} — ${new URL(endpoint).host}`,
    backgroundColor:'#101217',tabbingIdentifier:id,
    webPreferences:{session:isolated,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,
      autoplayPolicy:'no-user-gesture-required',preload:path.join(__dirname,'session-preload.cjs'),
      additionalArguments:[`--workspace-media=${Buffer.from(mediaControl).toString('base64')}`]}});
  const item = {id,deviceId:device.id,name:device.name,endpoint,window:win,session:isolated};
  /** @type {Set<Electron.BrowserWindow>} */
  const auxiliary = new Set();
  sessions.set(id,item);
  changed();
  /** @type {Set<string>} */
  const grants = new Set();
  let documentGeneration=0;
  win.webContents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame) => {
    if (isMainFrame && !isInPlace) {documentGeneration++;grants.clear();}
  });
  const harmless = new Set(['fullscreen','pointerLock','keyboardLock','clipboard-sanitized-write','local-network','local-network-access']);
  isolated.setPermissionCheckHandler((contents,permission,origin,details) => {
    if (contents !== win.webContents || !sameOrigin(origin,endpoint)) return false;
    return harmless.has(permission) || grants.has(permission) || (permission === 'media' && grants.has(details.mediaType || ''));
  });
  isolated.setPermissionRequestHandler((contents,permission,callback,details) => {
    const generation=documentGeneration;
    const current=()=>!win.isDestroyed() && generation===documentGeneration;
    if (contents !== win.webContents || !sameOrigin(details.requestingUrl,endpoint) || details.isMainFrame === false) { callback(false); return; }
    if (harmless.has(permission)) { callback(true); return; }
    if (permission === 'clipboard-read' || permission === 'speaker-selection') {
      void dialog.showMessageBox(win,{message:`Allow ${device.name} to ${permission === 'clipboard-read' ? 'read your clipboard for remote paste' : 'select a local speaker'}?`,buttons:['Don’t Allow','Allow for this session'],defaultId:0,cancelId:0})
        .then((result) => { const allowed=result.response===1 && current(); if(allowed) grants.add(permission); callback(allowed); }).catch(() => callback(false));
      return;
    }
    if (permission !== 'media' || !('mediaTypes' in details) || !details.mediaTypes.length) { callback(false); return; }
    const types = details.mediaTypes;
    void (async () => {
      const decision = await dialog.showMessageBox(win,{type:'question',title:'Session capture permission',
        message:`Allow ${device.name} to use your ${types.includes('video') ? 'camera' : 'microphone'}?`,
        detail:'Capture is granted only to this KVM window. Change mute and audio routing in its Audio controls. Switching keyboard focus does not change this permission.',
        buttons:['Don’t Allow','Allow for this session'],defaultId:0,cancelId:0});
      if (decision.response !== 1 || !current()) { callback(false); return; }
      for (const type of types) {
        const media = type === 'video' ? 'camera' : 'microphone';
        if (!(await systemPreferences.askForMediaAccess(media)) || !current()) { callback(false); return; }
        grants.add(type);
      }
      callback(true);
    })().catch((error) => { callback(false); report(error); });
  });
  win.webContents.on('will-navigate',(event,url) => { if (!sameOrigin(url,endpoint)) event.preventDefault(); });
  win.webContents.on('will-redirect',(event,url) => { if (!sameOrigin(url,endpoint)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({url}) => {
    if (sameOrigin(url,endpoint)) return {action:'allow',overrideBrowserWindowOptions:{width:1000,height:650,title:`${device.name} — Tool`,webPreferences:{session:isolated,contextIsolation:true,nodeIntegration:false,sandbox:true}}};
    void dialog.showMessageBox(win,{message:'Open external link in your browser?',detail:new URL(url).origin,buttons:['Cancel','Open'],defaultId:0,cancelId:0})
      .then((result) => { if (result.response === 1 && /^https?:/.test(url)) return shell.openExternal(url); }).catch(report);
    return {action:'deny'};
  });
  win.webContents.on('did-create-window',(child) => {
    auxiliary.add(child);
    child.webContents.on('will-navigate',(event,url) => { if (!sameOrigin(url,endpoint)) event.preventDefault(); });
    child.webContents.on('will-redirect',(event,url) => { if (!sameOrigin(url,endpoint)) event.preventDefault(); });
    child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    child.on('closed',() => auxiliary.delete(child));
  });
  win.on('page-title-updated',(event) => { event.preventDefault(); });
  win.webContents.on('focus',() => win.webContents.setIgnoreMenuShortcuts(true));
  win.webContents.on('blur',() => win.webContents.setIgnoreMenuShortcuts(false));
  win.on('blur',() => { win.webContents.send('session:release-input'); });
  win.on('close',() => { win.webContents.send('session:release-input'); for (const child of auxiliary) child.destroy(); });
  win.on('closed',() => {
    grants.clear(); sessions.delete(id); changed();
    isolated.removeListener('will-download',onDownload);
    const cleanup = isolated.closeAllConnections().then(() => isolated.clearStorageData());
    cleanupTasks.set(device.id,cleanup);
    void cleanup.catch(report);
  });
  /** @param {Electron.Event} _event @param {Electron.DownloadItem} download */
  const onDownload = (_event,download) => {
    download.once('done',(_e,state) => { if (state !== 'completed') report(new Error(`Download ${state}.`)); });
  };
  isolated.on('will-download',onDownload);
  await win.loadURL(endpoint).catch((error) => { if (error.code !== 'ERR_ABORTED') report(new Error(`Unable to load ${device.name}: ${error.code || error.message}`)); });
  let restoreStage='reading encrypted file';
  try {
    const saved = await readFile(path.join(app.getPath('userData'),`login-${device.id}.encrypted`));
    restoreStage='checking macOS Keychain availability';
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('macOS Keychain encryption is unavailable; the saved login was not loaded.');
    restoreStage='decrypting saved login';
    const decrypted=await safeStorage.decryptStringAsync(saved);
    restoreStage='parsing saved login';
    const login = JSON.parse(decrypted.result);
    if (login.endpoint !== endpoint || !login.storage || typeof login.storage !== 'object') return;
    const storage = Object.entries(login.storage).filter(([key,value]) => ['gl-kvm-token-key','gl-kvm-token-keys'].includes(key) && typeof value === 'string');
    restoreStage='restoring device authentication storage';
    await win.webContents.executeJavaScript(`for (const [key,value] of ${JSON.stringify(storage)}) localStorage.setItem(key,value)`);
    win.reload();
  } catch (error) { if (error.code !== 'ENOENT') report(new Error(`Saved login failed while ${restoreStage} (${error.name}). Use Session → Forget Saved Login, then sign in again.`,{cause:error})); }
}

/** @returns {{id:string,deviceId:string,name:string,endpoint:string,window:Electron.BrowserWindow,session:Electron.Session} | undefined} */
function focusedSession() {
  const win = BrowserWindow.getFocusedWindow();
  return [...sessions.values()].find((item) => item.window === win);
}

async function saveLogin() {
  const item = focusedSession();
  if (!item) return;
  if (!sameOrigin(item.window.webContents.getURL(),item.endpoint)) throw new Error('Open the device before saving its login.');
  await serial(`credentials:${item.deviceId}`,async()=>{
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('macOS Keychain encryption is unavailable. No credentials were saved.');
    const storage = await item.window.webContents.executeJavaScript(`Object.fromEntries(['gl-kvm-token-key','gl-kvm-token-keys'].map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>value))`);
    if (!Object.keys(storage).length) throw new Error('Sign in to this KVM before saving its login.');
    if (!data.devices.some(device=>device.id===item.deviceId)) throw new Error('This device is no longer saved.');
    const bytes = await safeStorage.encryptStringAsync(JSON.stringify({endpoint:item.endpoint,storage}));
    await writeFile(path.join(app.getPath('userData'),`login-${item.deviceId}.encrypted`),bytes,{mode:0o600});
  });
  if (!item.window.isDestroyed()) await dialog.showMessageBox(item.window,{message:'Login saved using macOS Keychain-backed encryption.',detail:'The device may still expire or revoke the session. No password is retained.'});
}

async function forgetLogin() {
  const item = focusedSession();
  if (!item) return;
  await serial(`credentials:${item.deviceId}`,async()=>{
    try { await unlink(path.join(app.getPath('userData'),`login-${item.deviceId}.encrypted`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  if (!item.window.isDestroyed()) await dialog.showMessageBox(item.window,{message:'Saved login removed.',detail:'Your current session remains connected.'});
}

ipcMain.handle('inventory:list',(event) => {
  requireInventory(event);
  return {devices:data.devices,sessions:[...sessions.values()].map(({id,deviceId,name,endpoint}) => ({id,deviceId,name,endpoint}))};
});
ipcMain.handle('inventory:save',async (event,value) => { requireInventory(event); await updateData(current=>({...current,devices:updateDevices(current.devices,value)})); });
ipcMain.handle('inventory:remove',async (event,id) => {
  requireInventory(event);
  if (pendingOpens.has(id) || [...sessions.values()].some((item) => item.deviceId === id)) throw new Error('Close this device’s session before removing it.');
  if (!data.devices.some((item) => item.id === id)) throw new Error('This device is no longer saved.');
  if (pendingRemovals.has(id)) throw new Error('This device is already being removed.');
  pendingRemovals.add(id);
  try {
    await serial(`credentials:${id}`,async()=>{
      try { await unlink(path.join(app.getPath('userData'),`login-${id}.encrypted`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await updateData(current=>({...current,devices:current.devices.filter(item=>item.id!==id)}));
    });
  } finally { pendingRemovals.delete(id); }
});
ipcMain.handle('inventory:open',async (event,id,route) => {
  requireInventory(event);
  if (pendingRemovals.has(id)) throw new Error('This device is being removed.');
  if (!['lan','tailnet'].includes(route)) throw new Error('Choose LAN or Tailnet.');
  const device = data.devices.find((item) => item.id === id);
  if (!device || !device[route]) throw new Error('No saved address for this route.');
  if (pendingOpens.has(id)) throw new Error('This device is already opening.');
  pendingOpens.add(id);
  try { await openSession(device,device[route]); }
  finally { pendingOpens.delete(id); }
});
ipcMain.handle('inventory:focus',(event,id) => { requireInventory(event); const item=sessions.get(id); if(!item) throw new Error('This window has already closed.'); item.window.show(); item.window.focus(); });

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  try {
    data = validateInventory(JSON.parse(await readFile(dataPath(),'utf8')));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'File',submenu:[{label:'Device Inventory',accelerator:'CommandOrControl+Shift+D',click:showInventory},{role:'close'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'Session',submenu:[{label:'Reconnect This Window',click:() => { const win=BrowserWindow.getFocusedWindow(); if (win && win !== inventory) win.reload(); }},
      {label:'Save This Login Securely',click:() => { void saveLogin().catch(report); }},
      {label:'Forget Saved Login',click:() => { void forgetLogin().catch(report); }},
      {label:'Release Keyboard and Mouse',click:() => { focusedSession()?.window.webContents.send('session:release-input'); }},
      {label:'Choose Microphone on Next Capture',click:() => { const item=focusedSession(); if(item) void item.window.webContents.executeJavaScript('window.__workspaceCapture?.resetMicrophone()').catch(report); }},
      {label:'Choose Local Speaker…',click:() => { const item=focusedSession(); if(item) void item.window.webContents.executeJavaScript('window.__workspaceCapture?.chooseSpeaker()',true).catch(report); }},
      {role:'togglefullscreen'},{role:'toggleDevTools'}]},
    {role:'windowMenu'}
  ]));
  showInventory();
  app.on('activate',showInventory);
}).catch((error) => { report(error); app.quit(); });
app.on('window-all-closed',() => { /* macOS keeps the application and inventory menu available. */ });
