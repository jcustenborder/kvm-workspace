'use strict';
const {AsyncEntry}=require('@napi-rs/keyring');
const {sameOrigin}=require('./model.cjs');

/** @param {string} deviceId @returns {AsyncEntry} */
function passwordEntry(deviceId) {
  return new AsyncEntry('com.scarcemedia.kvm-workspace.password',deviceId);
}

/** @param {Electron.IpcMainInvokeEvent} event @param {Map<string,object>} sessions @param {Array<{id:string,lan:string,tailnet:string}>} devices */
function requirePasswordSession(event,sessions,devices) {
  const item=[...sessions.values()].find(item=>!item.window.isDestroyed() && item.window.webContents===event.sender);
  const device=devices.find(device=>device.id===item?.deviceId);
  if (!item || !device || event.senderFrame!==event.sender.mainFrame ||
      ![device.lan,device.tailnet].includes(item.endpoint) ||
      !sameOrigin(event.senderFrame.url,item.endpoint) || !sameOrigin(event.sender.getURL(),item.endpoint)) {
    throw new Error('Password access requires the current device session.');
  }
  return item;
}

module.exports={passwordEntry,requirePasswordSession};
