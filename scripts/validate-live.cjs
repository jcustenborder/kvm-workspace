'use strict';
// Opt-in live test. Credentials stay in process memory, never in reports or source.
const {_electron} = require('playwright-core');
const {mkdtemp,writeFile,mkdir,rm,readFile} = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');

async function run() {
  const endpoint = process.env.KVM_TEST_URL;
  const password = process.env.KVM_PASSWORD;
  const pin = process.env.KVM_TEST_CERT_SHA256;
  if (!endpoint || !password || !pin) throw new Error('Set KVM_TEST_URL, KVM_PASSWORD and KVM_TEST_CERT_SHA256 for the explicitly selected live device.');
  const seconds=Number(process.env.KVM_TEST_SECONDS || (process.env.KVM_TEST_AUDIO==='1' ? 30 : 10));
  if (!Number.isFinite(seconds) || seconds<10 || seconds>3600) throw new Error('KVM_TEST_SECONDS must be between 10 and 3600.');
  const temporaryRoot=path.resolve('investigation/private/tmp');
  await mkdir(temporaryRoot,{recursive:true,mode:0o700});
  const profile = await mkdtemp(path.join(temporaryRoot,'kvm-workspace-live-'));
  const started = performance.now();
  const childEnvironment={...process.env};delete childEnvironment.KVM_PASSWORD;
  const electron = await _electron.launch({env:childEnvironment,executablePath:path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/MacOS/KVM Workspace'),
    args:[`--user-data-dir=${profile}`],timeout:30000});
  const route = process.env.KVM_TEST_ROUTE === 'tailnet' ? 'tailnet' : 'lan';
  const report = {platform:'M4 Max / macOS 26.6.2',scenario:`One real KVM, ${route}, packaged arm64 app`,launchedAt:new Date().toISOString(),samples:[],errors:[]};
  let devicePage;
  let restoreMicrophone = false;
  try {
    const inventory = await electron.firstWindow();
    await inventory.waitForSelector('#add-device');
    report.interactiveMs = Math.round(performance.now()-started);
    // Native dialogs are automated only for this exact pre-inspected certificate.
    await electron.evaluate(({dialog},fingerprint) => {
      dialog.showMessageBox = async (...args) => {
        const options = args[args.length-1];
        if (options.title === 'Verify KVM certificate' && options.detail.includes(fingerprint)) return {response:1,checkboxChecked:false};
        if (options.title === 'Session capture permission') return {response:1,checkboxChecked:false};
        return {response:0,checkboxChecked:false};
      };
      dialog.showErrorBox = (_title,message) => { console.error('Validation operation error:',message); };
    },pin);
    await electron.context().addInitScript(() => {
      const peers = [];
      const hid = [];
      const moves=[];let lastMove=null;
      window.addEventListener('mousemove',event=>{
        const box=event.target.getBoundingClientRect();
        lastMove={x:event.clientX,y:event.clientY,id:event.target.id,tag:event.target.tagName,left:box.left,top:box.top,width:box.width,height:box.height};
      },true);
      const inspect = payload => {
        let bytes;
        if (payload instanceof ArrayBuffer && payload.byteLength <= 16) bytes=[...new Uint8Array(payload)];
        else if (ArrayBuffer.isView(payload) && payload.byteLength <= 16) bytes=[...new Uint8Array(payload.buffer,payload.byteOffset,payload.byteLength)];
        else if (typeof payload === 'string') {
          try { const event=JSON.parse(payload); if(event.event_type==='key' && event.event?.key==='ShiftLeft') hid.push([1,Number(event.event.state)]); } catch { /* Not a JSON HID message. */ }
        }
        if(bytes) {hid.push(bytes);if(bytes[0]===3)moves.push({bytes,move:lastMove});}
        if (hid.length > 100) hid.shift();
        if (moves.length > 100) moves.shift();
      };
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(payload) { inspect(payload); return send.call(this,payload); };
      const wsSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function(payload) { inspect(payload); return wsSend.call(this,payload); };
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Original,{construct(target,args) { const peer=new target(...args); peers.push(peer); return peer; }});
      window.__workspaceProbe = {peers,hid,moves};
    });
    await inventory.evaluate(async (url) => {
      await window.workspace.save({id:'live-device',name:'RM1PE — live validation',lan:url,tailnet:''});
    },endpoint);
    const connected = performance.now();
    const next = electron.waitForEvent('window');
    await inventory.evaluate(() => window.workspace.open('live-device','lan'));
    const device = await next;
    devicePage = device;
    device.on('pageerror', error => console.error('Device script error:',error.message));
    await device.waitForURL(url => url.origin === new URL(endpoint).origin);
    await device.locator('input[type=password]').fill(password);
    await device.getByText('Log In',{exact:true}).click();
    await device.waitForFunction(() => { const video=document.querySelector('video'); return video?.readyState >= 2 && video.videoWidth > 0; },null,{timeout:60000});
    report.firstUsableFrameMs = Math.round(performance.now()-connected);
    report.deviceTailnet = await device.evaluate(async () => {
      const status=await (await fetch('/api/tailscale/status')).json();
      const login=await (await fetch('/api/tailscale/login_status')).json();
      return {running:status.result?.running,state:login.result?.status,ipv4:login.result?.ipv4};
    });
    report.savedStreamSettings=await device.evaluate(async()=>{
      const response=await (await fetch('/api/system/get_config')).json();
      const config=response.result?.config || {};
      return Object.fromEntries(['stream_quality','video_mode','video_format','venc_mode','video_processing','orientation'].filter(key=>key in config).map(key=>[key,config[key]]));
    });
    report.versions = await electron.evaluate(() => ({electron:process.versions.electron,chromium:process.versions.chrome,arch:process.arch}));
    report.appAsarSHA256=createHash('sha256').update(await readFile('build/KVM Workspace-darwin-arm64/KVM Workspace.app/Contents/Resources/app.asar')).digest('hex');
    report.gpuFeatures = await electron.evaluate(({app}) => app.getGPUFeatureStatus());
    await (await electron.browserWindow(device)).evaluate(win=>win.focus());
    await device.locator('#stream-box').focus();
    await device.keyboard.down('Shift');
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).focus());
    await device.waitForTimeout(200);
    report.hidRelease = await device.evaluate(()=>window.__workspaceProbe.hid.filter(bytes=>bytes[0]===1));
    console.log('HID modifier verification:',report.hidRelease);
    // Only a nonprinting modifier is exercised; no text or host shortcut is sent.
    assert(report.hidRelease.some(bytes=>bytes[1]===1),'HID modifier down must be sent');
    assert(report.hidRelease.some(bytes=>bytes[1]===0),'HID modifier release must be sent on native-window blur');
    report.pointerChecks=[];
    /** @param {string} phase */
    const verifyPointer=async phase=>{
      await (await electron.browserWindow(device)).evaluate(win=>win.focus());
      await device.locator('#stream-box').focus();
      const rectangle=await device.locator('video').evaluate(video=>{
        const box=video.getBoundingClientRect(),scale=Math.min(box.width/video.videoWidth,box.height/video.videoHeight);
        const width=video.videoWidth*scale,height=video.videoHeight*scale;
        return {left:box.left+(box.width-width)/2,top:box.top+(box.height-height)/2,width,height,dpr:devicePixelRatio};
      });
      const layout=await device.evaluate(()=>Object.fromEntries(['stream-window','stream-box','video-wrapper','stream-video'].map(id=>{
        const element=document.getElementById(id),style=getComputedStyle(element),box=element.getBoundingClientRect();
        return [id,{offsetWidth:element.offsetWidth,offsetHeight:element.offsetHeight,left:box.left,top:box.top,width:box.width,height:box.height,transform:style.transform,transition:style.transitionDuration}];
      })));
      for(const [fx,fy] of [[0.15,0.2],[0.5,0.5],[0.85,0.8]]) {
        const x=Math.round(rectangle.left+rectangle.width*fx),y=Math.round(rectangle.top+rectangle.height*fy);
        await device.evaluate(()=>{window.__workspaceProbe.moves.length=0;});
        await device.mouse.move(x,y);
        await device.waitForFunction(({x,y})=>window.__workspaceProbe.moves.some(record=>record.move?.x===x&&record.move?.y===y),{x,y},{timeout:3000});
        const observation=await device.evaluate(({x,y})=>window.__workspaceProbe.moves.find(record=>record.move?.x===x&&record.move?.y===y),{x,y});
        const bytes=observation.bytes;
        assert(bytes?.length===5,'Absolute mouse HID packet must be observed');
        const actualX=Buffer.from(bytes).readInt16BE(1),actualY=Buffer.from(bytes).readInt16BE(3);
        const expectedX=Math.round((x-rectangle.left)/rectangle.width*65535-32768),expectedY=Math.round((y-rectangle.top)/rectangle.height*65535-32768);
        report.pointerChecks.push({phase,dpr:rectangle.dpr,rectangle,layout,move:observation.move,point:[x,y],expected:[expectedX,expectedY],actual:[actualX,actualY]});
        assert(Math.abs(actualX-expectedX)<=Math.ceil(65535/rectangle.width)*2,'Absolute X mapping must match contained video CSS pixels');
        assert(Math.abs(actualY-expectedY)<=Math.ceil(65535/rectangle.height)*2,'Absolute Y mapping must match contained video CSS pixels');
      }
    };
    await verifyPointer('initial-window');
    if (process.env.KVM_TEST_AUDIO === '1') {
      report.usbBefore = await device.evaluate(async () => (await (await fetch('/api/system/otg_functions')).json()).result);
      await device.locator('.icon-text').filter({hasText:/^Session$/}).click();
      const audio = device.locator('.settings .collapse-panel-container').filter({has:device.locator('.collapse-panel-title').filter({hasText:/^Audio/})});
      const mic = audio.locator('.pb-3.flex-btw').filter({hasText:'Microphone'});
      if (!report.usbBefore.enable_mic) {
        restoreMicrophone = true;
        await mic.getByText('Enable',{exact:true}).click();
        await device.waitForFunction(async () => (await (await fetch('/api/system/otg_functions')).json()).result.enable_mic === true,null,{timeout:30000});
      }
      await mic.locator('.icon-button').click();
      await audio.locator('.pb-3.flex-btw').filter({hasText:'Speaker'}).locator('.icon-button').click();
      await device.getByRole('button',{name:'Use Microphone',exact:true}).click();
      await device.waitForFunction(() => window.__workspaceProbe?.peers.some(peer => peer.getSenders().some(sender => sender.track?.kind==='audio' && sender.track.enabled)),null,{timeout:45000});
      report.usbDuring = await device.evaluate(async () => (await (await fetch('/api/system/otg_functions')).json()).result);
      for (const key of ['enable_keyboard','enable_mouse','enable_mouse_alt','enable_mtp','enable_camera','start_cdrom','start_flash']) assert.equal(report.usbBefore[key],report.usbDuring[key],`USB ${key} must not change`);
      await device.locator('.icon-text').filter({hasText:/^Session$/}).click();
      await device.locator('.settings').waitFor({state:'hidden'});
    }
    /** @param {string} phase */
    const sample = async (phase) => {
      const media = await device.evaluate(async () => {
        const result = {page:document.body.innerText.match(/V\d+\.\d+\.\d+[^\n]*/)?.[0],videos:[],peers:[]};
        for(const video of document.querySelectorAll('video')) {
          const quality=video.getVideoPlaybackQuality();
          result.videos.push({width:video.videoWidth,height:video.videoHeight,paused:video.paused,readyState:video.readyState,frames:quality.totalVideoFrames,dropped:quality.droppedVideoFrames});
        }
        for(const peer of window.__workspaceProbe?.peers || []) {
          const stats=await peer.getStats(); const rows=[];
          let selected;
          stats.forEach(row => {
            if(row.type==='transport' && row.selectedCandidatePairId) selected=stats.get(row.selectedCandidatePairId);
            if(row.type==='inbound-rtp'||row.type==='outbound-rtp') {
              const codec=stats.get(row.codecId);
              const picked={};
              for(const key of ['type','kind','framesDecoded','framesPerSecond','framesDropped','bytesReceived','bytesSent','packetsLost','jitter','jitterBufferDelay','jitterBufferEmittedCount','decoderImplementation','powerEfficientDecoder','frameWidth','frameHeight','totalDecodeTime','totalSamplesReceived','concealedSamples','totalSamplesSent']) if(row[key]!==undefined) picked[key]=row[key];
              picked.codec=codec?.mimeType;rows.push(picked);
            }
          });
          const candidate = id => {
            const entry=stats.get(id); if(!entry)return null;
            const address=entry.address || entry.ip || '';
            const pieces=address.split('.').map(Number);
            const addressClass=pieces[0]===100 && pieces[1]>=64 && pieces[1]<=127 ? 'tailscale' : pieces[0]===10 || (pieces[0]===192&&pieces[1]===168) || (pieces[0]===172&&pieces[1]>=16&&pieces[1]<=31) ? 'private-lan' : address.endsWith('.local') ? 'mdns' : address ? 'public-or-other' : 'not-exposed';
            return {type:entry.candidateType,protocol:entry.protocol,addressClass};
          };
          result.peers.push({state:peer.connectionState,ice:peer.iceConnectionState,selectedPair:selected?{local:candidate(selected.localCandidateId),remote:candidate(selected.remoteCandidateId),roundTripSeconds:selected.currentRoundTripTime}:null,senders:peer.getSenders().map(sender => sender.track ? {kind:sender.track.kind,enabled:sender.track.enabled,state:sender.track.readyState}:null),stats:rows});
        }
        return result;
      });
      const processes = await electron.evaluate(({app}) => app.getAppMetrics().map(item => ({pid:item.pid,type:item.type,cpu:item.cpu.percentCPUUsage,workingSetKiB:item.memory.workingSetSize,privateKiB:item.memory.privateBytes})));
      report.samples.push({phase,elapsedMs:Math.round(performance.now()-connected),media,processes});
    };
    await sample('foreground');
    await electron.evaluate(({BrowserWindow}) => { const windows=BrowserWindow.getAllWindows(); const device=windows.find(win=>win.webContents.getURL().startsWith('https:')); device.setSize(900,650); windows.find(win=>win.webContents.getURL().startsWith('file:')).focus(); });
    // The deployed firmware's layout watcher is trailing-debounced by 300 ms.
    await device.waitForTimeout(750);
    await verifyPointer('resized-window');
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).focus());
    for(let elapsed=0;elapsed<seconds;elapsed+=10) {
      await new Promise(resolve=>setTimeout(resolve,Math.min(10,seconds-elapsed)*1000));
      await sample('resized-unfocused');
    }
    const before=report.samples[0],after=report.samples.at(-1);
    assert(after.media.videos[0].frames > before.media.videos[0].frames,'Unfocused video must continue receiving frames');
    assert(after.media.videos[0].width===1920,'Resizing must not reduce remote stream resolution');
    if (process.env.KVM_TEST_AUDIO === '1') {
      const audio=after.media.peers.flatMap(peer=>peer.stats).filter(row=>row.kind==='audio');
      assert(audio.some(row=>row.type==='outbound-rtp' && row.bytesSent>0),'Local microphone must send RTP');
      assert(audio.some(row=>row.type==='inbound-rtp' && row.bytesReceived>0),'Remote speaker must receive RTP');
      // Restore only the temporary USB change made by this validation.
      if (!report.usbBefore.enable_mic) {
        await device.evaluate(async () => {
          const response=await fetch('/api/system/otg_functions?enable_mic=false',{method:'POST'});
          if(!response.ok) throw new Error('Unable to restore microphone USB flag');
        });
      }
      report.usbAfter = await device.evaluate(async () => (await (await fetch('/api/system/otg_functions')).json()).result);
      restoreMicrophone = false;
    }
    await device.close();
    await new Promise(resolve => setTimeout(resolve,3000));
    report.afterClose = await electron.evaluate(({app}) => app.getAppMetrics().map(item => ({type:item.type,cpu:item.cpu.percentCPUUsage,workingSetKiB:item.memory.workingSetSize})));
    report.completedAt = new Date().toISOString();
    await mkdir('investigation/private',{recursive:true});
    const reportPath = `investigation/private/live-${route}-${process.env.KVM_TEST_AUDIO === '1' ? 'audio' : 'video'}.json`;
    await writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify({reportPath,scenario:report.scenario,appAsarSHA256:report.appAsarSHA256,interactiveMs:report.interactiveMs,firstUsableFrameMs:report.firstUsableFrameMs,
      sampleCount:report.samples.length,observedSeconds:seconds,deviceTailnet:report.deviceTailnet,savedStreamSettings:report.savedStreamSettings,
      pointerChecks:report.pointerChecks.map(({phase,dpr,expected,actual})=>({phase,dpr,expected,actual})),
      microphoneUSBRestored:report.usbAfter?.enable_mic===report.usbBefore?.enable_mic,completedAt:report.completedAt},null,2));
  } catch (error) {
    if(report.pointerChecks) console.error('Pointer diagnostics:',JSON.stringify(report.pointerChecks,null,2));
    console.error(JSON.stringify(await electron.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(win => ({title:win.getTitle(),url:win.webContents.getURL().split('?')[0],loading:win.webContents.isLoading()}))),null,2));
    for (const page of electron.windows()) if (page.url().startsWith('https:')) console.error('Device page state:',(await page.locator('body').innerText()).slice(0,500));
    throw error;
  } finally {
    try {
      if (restoreMicrophone && devicePage && !devicePage.isClosed()) {
        await devicePage.evaluate(async () => {
          const response=await fetch('/api/system/otg_functions?enable_mic=false',{method:'POST'});
          if(!response.ok) throw new Error('Microphone USB restoration failed; inspect the device USB settings.');
        });
      }
    } finally { await electron.close(); await rm(profile,{recursive:true,force:true}); }
  }
}
run().catch(error => { console.error(error.message); process.exitCode=1; });
