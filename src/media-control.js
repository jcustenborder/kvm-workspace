(() => {
  if (window.__workspaceCapture) return;
  const devices = navigator.mediaDevices;
  if (!devices) return;
  const originalCapture = devices.getUserMedia.bind(devices);
  /** @type {string | null} */
  let microphone = null;
  /** @type {Promise<string> | null} */
  let pendingChoice = null;
  let speaker = 'default';

  /** @param {MediaDeviceInfo[]} choices @param {string} title @param {string} button @returns {Promise<string>} */
  function choose(choices,title,button) {
    return new Promise((resolve,reject) => {
      const dialog = document.createElement('dialog');
      dialog.id='workspace-audio-choice';
      dialog.style.cssText='padding:24px;border:1px solid #667;border-radius:12px;background:#181c24;color:#eee;font:14px system-ui;max-width:460px';
      const heading=document.createElement('h2'); heading.textContent=title; heading.style.fontSize='18px';
      const help=document.createElement('p'); help.textContent='This choice applies only to this KVM window. Keyboard focus does not change audio routing.';
      const select=document.createElement('select'); select.style.cssText='width:100%;margin:12px 0;padding:8px'; select.setAttribute('aria-label',title);
      const defaultOption=document.createElement('option');defaultOption.value='default';defaultOption.textContent='System Default';select.append(defaultOption);
      choices.filter(choice=>choice.deviceId!=='default' && choice.deviceId!=='communications').forEach((choice,index) => {
        const option=document.createElement('option');option.value=choice.deviceId;option.textContent=choice.label||`Audio device ${index+1}`;select.append(option);
      });
      const cancel=document.createElement('button');cancel.textContent='Cancel';
      const use=document.createElement('button');use.textContent=button;use.style.cssText='margin-left:12px;padding:6px 12px';
      const abort=() => {dialog.close();dialog.remove();reject(new DOMException('Audio selection cancelled.','NotAllowedError'));};
      cancel.onclick=abort;dialog.addEventListener('cancel',event=>{event.preventDefault();abort();},{once:true});
      use.onclick=() => {const value=select.value;dialog.close();dialog.remove();resolve(value);};
      dialog.append(heading,help,select,cancel,use);document.body.append(dialog);dialog.showModal();select.focus();
    });
  }

  /** @param {MediaStreamConstraints} constraints @returns {Promise<MediaStream>} */
  devices.getUserMedia = async function(constraints) {
    if (!constraints?.audio) return originalCapture(constraints);
    const audio = typeof constraints.audio === 'object' ? {...constraints.audio} : {};
    if (microphone === null) {
      // Labels require OS permission. Never return this provisional stream to
      // the device or attach it to a peer connection before the user's choice.
      if (!pendingChoice) pendingChoice=(async () => {
        const provisional=await originalCapture({audio,video:false});
        try { return await choose((await devices.enumerateDevices()).filter(device=>device.kind==='audioinput'),'Microphone for this KVM','Use Microphone'); }
        finally { provisional.getTracks().forEach(track=>track.stop()); }
      })();
      try { microphone=await pendingChoice; } finally { pendingChoice=null; }
    }
    audio.deviceId={exact:microphone};
    const stream=await originalCapture({...constraints,audio});
    stream.getAudioTracks().forEach(track=>track.addEventListener('ended',() => {
      microphone=null;
      const notice=document.createElement('div');
      notice.setAttribute('role','alert');notice.textContent='Microphone disconnected. Turn microphone and speaker off, then enable them to choose a new input.';
      notice.style.cssText='position:fixed;bottom:48px;left:16px;z-index:2147483647;padding:10px;background:#432;color:#ffe3b3;font:13px system-ui';document.body.append(notice);
    },{once:true}));
    return stream;
  };

  /** @param {HTMLMediaElement} audio */
  async function applySpeaker(audio) {
    if (typeof audio.setSinkId === 'function') await audio.setSinkId(speaker);
  }
  window.__workspaceCapture={
    resetMicrophone() { microphone=null; },
    async chooseSpeaker() {
      const choices=(await devices.enumerateDevices()).filter(device=>device.kind==='audiooutput');
      speaker=await choose(choices,'Speaker for this KVM','Use Speaker');
      await Promise.all([...document.querySelectorAll('audio')].map(applySpeaker));
    }
  };
  const observeAudio = () => new MutationObserver(records=>{
    for(const record of records) for(const node of record.addedNodes) {
      if(node instanceof HTMLAudioElement) void applySpeaker(node).catch(error=>console.error('Speaker selection failed:',error.name));
      if(node instanceof Element) for(const audio of node.querySelectorAll('audio')) void applySpeaker(audio).catch(error=>console.error('Speaker selection failed:',error.name));
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
  if(document.documentElement) observeAudio(); else document.addEventListener('DOMContentLoaded',observeAudio,{once:true});
})();
