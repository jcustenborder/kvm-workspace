'use strict';
const {readFile,writeFile,mkdir,rename,unlink}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {createApi,loadApiToken,rotateApiToken}=require('./api.cjs');
const {serial}=require('./serial.cjs');

/** @param {{directory:string,list:()=>Promise<object[]>,command:(name:string,action:string,body:Record<string,unknown>)=>Promise<object>,port?:number,onError?:(error:Error)=>void}} options */
function createApiSettings({directory,list,command,port=53241,onError=()=>{}}) {
  const file=path.join(directory,'api-settings.json'),queue=`api-settings:${randomUUID()}`;
  let enabled=false,loaded=false,token='',error=null;
  /** @type {import('node:http').Server|null} */
  let server=null;

  async function load() {
    if(loaded) return;
    let saved={enabled:false};
    try {saved=JSON.parse(await readFile(file,'utf8'));}
    catch(failure) {if(failure.code!=='ENOENT') throw failure;}
    if(!saved || typeof saved.enabled!=='boolean' || Object.keys(saved).length!==1) throw new Error('Invalid API settings; expected {"enabled": true or false}.');
    enabled=saved.enabled;loaded=true;
  }
  async function ensureToken() {
    if(!token) token=await loadApiToken(directory);
    return token;
  }
  async function stop() {
    const current=server;
    server=null;
    if(!current) return;
    current.closeAllConnections();
    await new Promise((resolve,reject)=>current.close(failure=>failure?reject(failure):resolve()));
    console.info('[workspace] Local API stopped');
  }
  async function start() {
    if(server?.listening) return;
    await ensureToken();
    const next=createApi({token:()=>token,list,command});
    await new Promise((resolve,reject)=>{
      const failed=failure=>{next.removeListener('listening',listening);reject(failure);};
      const listening=()=>{next.removeListener('error',failed);resolve();};
      next.once('error',failed);next.once('listening',listening);
      next.listen(port,'127.0.0.1');
    });
    server=next;
    next.on('error',failure=>{error=failure.message;onError(failure);});
    console.info('[workspace] Local API listening',next.address());
  }
  /** @param {()=>Promise<unknown>} action */
  function mutate(action) {
    return serial(queue,async()=>{
      try {const result=await action();error=null;return result;}
      catch(failure) {error=failure.message;throw failure;}
    });
  }
  return {
    status:()=>({enabled,running:!!server?.listening,error}),
    address:()=>server?.address(),
    initialize:()=>mutate(async()=>{await load();if(enabled) await start();}),
    /** @param {boolean} value */
    setEnabled:value=>mutate(async()=>{
      if(typeof value!=='boolean') throw new Error('Enable web server must be a boolean.');
      await load();
      const wasRunning=!!server?.listening;
      if(value) await start();else await stop();
      const temporary=`${file}.${randomUUID()}.tmp`;
      try {
        await mkdir(directory,{recursive:true,mode:0o700});
        await writeFile(temporary,JSON.stringify({enabled:value})+'\n',{mode:0o600,flag:'wx'});
        try {await rename(temporary,file);}
        catch(failure) {await unlink(temporary);throw failure;}
      } catch(failure) {
        try {if(wasRunning) await start();else await stop();}
        catch(rollback) {throw new Error(`Could not save API settings: ${failure.message}. Could not restore listener: ${rollback.message}`);}
        throw failure;
      }
      enabled=value;
      console.info('[workspace] Web server setting saved',{enabled});
    }),
    copyToken:()=>mutate(ensureToken),
    regenerateToken:()=>mutate(async()=>{
      token=await rotateApiToken(directory);
      console.info('[workspace] API token regenerated');
    }),
    close:()=>mutate(stop),
  };
}
module.exports={createApiSettings};
