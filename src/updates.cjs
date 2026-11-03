'use strict';
const {existsSync}=require('node:fs');
const path=require('node:path');

/** @param {{isPackaged:boolean}} app @param {string} platform @param {string} arch @param {string} resourcesPath */
function updatesEnabled(app,platform,arch,resourcesPath) {
  return app.isPackaged && platform==='darwin' && arch==='arm64' && existsSync(path.join(resourcesPath,'app-update.yml'));
}

/**
 * @param {{updater:import('electron-updater').AppUpdater,dialog:Pick<Electron.Dialog,'showMessageBox'>,
 * menuItem:Electron.MenuItem,logger:Pick<Console,'info'|'error'>}} options
 */
function createUpdates({updater,dialog,menuItem,logger}) {
  updater.autoDownload=false;
  // On macOS this also prevents native Squirrel staging until quitAndInstall().
  updater.autoInstallOnAppQuit=false;
  updater.allowPrerelease=false;
  updater.allowDowngrade=false;
  updater.disableDifferentialDownload=true;
  let busy=false;
  let installing=false;
  let downloaded=false;
  let version='';
  let dismissed='';
  let failure='';
  let available=null;

  function refreshMenu() {
    menuItem.enabled=!busy && !installing;
    menuItem.label=installing ? 'Installing Update…' : busy ? (downloaded ? 'Preparing Update…' : 'Checking / Downloading Update…')
      : failure ? 'Update Failed — Retry…' : downloaded ? 'Install Update and Restart…' : 'Check for Updates…';
  }
  /** @param {unknown} error */
  function recordError(error) {
    failure=error instanceof Error ? error.message : String(error);
    logger.error('[updates] operation failed:',error);
    refreshMenu();
  }
  function showError() {
    return dialog.showMessageBox({type:'error',title:'KVM Workspace Update',message:'Unable to update KVM Workspace',detail:failure,buttons:['OK']});
  }
  updater.on('update-available',(info)=>{available=info;});
  updater.on('error',(error)=>{
    recordError(error);
    if(installing) {
      installing=false;
      refreshMenu();
      void showError().catch(error=>logger.error('[updates] could not show error:',error));
    }
  });

  async function offerInstall() {
    const {response}=await dialog.showMessageBox({type:'question',title:'KVM Workspace Update',
      message:`KVM Workspace ${version} is ready to install`,
      detail:'Installing will restart the application and close all active KVM sessions. Choosing Later will not install the update, even when you quit.',
      buttons:['Install and Restart','Later'],defaultId:1,cancelId:1});
    if(response!==0) return;
    installing=true;
    refreshMenu();
    logger.info('[updates] installation approved:',version);
    updater.quitAndInstall();
  }

  /** @param {boolean} manual */
  async function check(manual=false) {
    if(busy || installing || (downloaded && !manual)) return;
    busy=true;
    failure='';
    refreshMenu();
    let interactive=manual;
    try {
      if(downloaded) { await offerInstall(); return; }
      available=null;
      logger.info('[updates] checking stable releases');
      const result=await updater.checkForUpdates();
      if(!result) throw new Error('Update checking is unavailable for this installation.');
      if(!available) {
        if(manual) await dialog.showMessageBox({type:'info',title:'KVM Workspace Update',message:'KVM Workspace is up to date.',buttons:['OK']});
        return;
      }
      version=available.version;
      if(!manual && version===dismissed) return;
      const {response}=await dialog.showMessageBox({type:'question',title:'KVM Workspace Update',message:`KVM Workspace ${version} is available`,
        detail:'Download this update? Your KVM sessions will stay connected. Installation requires a separate confirmation.',
        buttons:['Download','Later'],defaultId:1,cancelId:1});
      dismissed=version;
      if(response!==0) return;
      interactive=true;
      logger.info('[updates] download approved:',version);
      await updater.downloadUpdate();
      downloaded=true;
      await offerInstall();
    } catch(error) {
      installing=false;
      recordError(error);
      if(interactive) await showError().catch(error=>logger.error('[updates] could not show error:',error));
    } finally {
      busy=false;
      refreshMenu();
    }
  }
  refreshMenu();
  return {check};
}

module.exports={createUpdates,updatesEnabled};
