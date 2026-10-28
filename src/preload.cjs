'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('workspace', {
  list: () => ipcRenderer.invoke('inventory:list'),
  /** @param {object} device */
  save: (device) => ipcRenderer.invoke('inventory:save',device),
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
