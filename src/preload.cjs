'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('workspace', {
  apiStatus:()=>ipcRenderer.invoke('settings:status'),
  /** @param {boolean} enabled */
  setApiEnabled:enabled=>ipcRenderer.invoke('settings:enabled',enabled),
  copyApiToken:()=>ipcRenderer.invoke('settings:copy-token'),
  regenerateApiToken:()=>ipcRenderer.invoke('settings:regenerate-token'),
  /** @param {'docs'|'openapi.json'} page */
  openApiDocs:page=>ipcRenderer.invoke('settings:docs',page),
  /** @param {()=>void} callback */
  onSettings:callback=>{
    const listener=()=>callback();
    ipcRenderer.on('settings:show',listener);
    return ()=>ipcRenderer.removeListener('settings:show',listener);
  },
  list: () => ipcRenderer.invoke('inventory:list'),
  /** @param {object} device @param {string | null} [passwordChange] */
  save: (device,passwordChange) => ipcRenderer.invoke('inventory:save',device,passwordChange),
  /** @param {string} id */
  remove: (id) => ipcRenderer.invoke('inventory:remove',id),
  /** @param {string} id @param {'lan'|'tailnet'} route */
  open: (id,route) => ipcRenderer.invoke('inventory:open',id,route),
  /** @param {string} id */
  focus: (id) => ipcRenderer.invoke('inventory:focus',id),
  /** @param {() => void} callback */
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inventory:changed',listener);
    return () => ipcRenderer.removeListener('inventory:changed',listener);
  }
});
