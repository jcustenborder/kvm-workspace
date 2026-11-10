'use strict';
const {createServer}=require('node:http');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {mkdir,open}=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {validDeviceName}=require('./model.cjs');
const {keys}=require('./keys.cjs');
const {document,bodies}=require('./openapi.cjs');

/** @param {number} status @param {string} message @returns {Error & {status:number}} */
function apiError(status,message) {return Object.assign(new Error(message),{status});}

/** @param {string} directory @returns {Promise<string>} */
async function loadApiToken(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'api-token');
  let handle;
  try {
    handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await handle.writeFile(randomBytes(32).toString('hex')+'\n');}
    finally {await handle.close();}
  } catch(error) {if(error.code!=='EEXIST') throw error;}
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    if(!info.isFile() || info.size>128 || info.uid!==process.getuid() || (info.mode&0o077)!==0) throw new Error('API token file must be owner-only (chmod 600).');
    const token=(await handle.readFile('utf8')).trim();
    if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid API token file; remove it to generate a new token and update clients.');
    return token;
  } finally {await handle.close();}
}

/** @param {import('node:http').IncomingMessage} request @returns {Promise<Record<string,unknown>>} */
async function readBody(request) {
  let length=0;
  const chunks=[];
  for await(const chunk of request) {
    length+=chunk.length;
    if(length>16384) throw apiError(413,'Request body exceeds 16 KiB.');
    chunks.push(chunk);
  }
  if(!length) return {};
  if(request.headers['content-type']?.split(';')[0].trim()!=='application/json') throw apiError(415,'Use application/json.');
  let body;
  try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw apiError(400,'Invalid JSON body.');}
  if(!body || typeof body!=='object' || Array.isArray(body)) throw apiError(400,'Expected a JSON object.');
  return body;
}

/** @param {{token:string,list:()=>Promise<object[]>,command:(name:string,action:string,body:Record<string,unknown>)=>Promise<object>}} options @returns {import('node:http').Server} */
function createApi({token,list,command}) {
  const expected=Buffer.from(`Bearer ${token}`);
  const server=createServer(async(request,response)=>{
    response.setHeader('Content-Type','application/json');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    try {
      if(request.headers.origin!==undefined || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host || '')) throw apiError(403,'Only local non-browser clients are allowed.');
      const supplied=Buffer.from(request.headers.authorization || '');
      if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) {
        response.setHeader('WWW-Authenticate','Bearer');throw apiError(401,'A valid bearer token is required.');
      }
      const url=new URL(request.url,'http://127.0.0.1');
      if([...url.searchParams.keys()].some(key=>url.pathname!=='/sessions'||key!=='state') || (url.search && (url.searchParams.getAll('state').length!==1 || url.searchParams.get('state')!=='open'))) throw apiError(400,'Only /sessions?state=open is supported.');
      let result;
      if(url.pathname==='/openapi.json'||url.pathname==='/sessions') {
        if(request.method!=='GET') {response.setHeader('Allow','GET');throw apiError(405,'Use GET.');}
        result=url.pathname==='/openapi.json'?document:(await list()).filter(item=>!url.search || item.state==='open');
      } else {
        const match=/^\/sessions\/([^/]+)(?:\/(start|end|focus|send-keys|speaker|speaker\/toggle))?$/.exec(url.pathname);
        if(!match) throw apiError(404,'Unknown endpoint.');
        const [,name,action]=match;
        if(!validDeviceName(name)) throw apiError(400,'Rename this device to a DNS-label name in the desktop editor.');
        const method=!action?'GET':action==='speaker'?'PUT':'POST';
        if(request.method!==method) {response.setHeader('Allow',method);throw apiError(405,`Use ${method}.`);}
        if(!action) {
          const matches=(await list()).filter(item=>item.name===name);
          if(matches.length>1) throw apiError(409,'Duplicate device name; rename it in the desktop editor.');
          if(!matches.length) throw apiError(404,'Device not found.');
          result=matches[0];
        } else {
          const body=await readBody(request), schema=bodies[action];
          if(Object.keys(body).some(key=>!Object.hasOwn(schema.properties,key)) || schema.required?.some(key=>!Object.hasOwn(body,key))) throw apiError(400,'Missing or unexpected request fields.');
          if(action==='start' && !['lan','tailnet'].includes(body.route)) throw apiError(400,'Choose route lan or tailnet.');
          if(action==='speaker' && typeof body.enabled!=='boolean') throw apiError(400,'enabled must be a boolean.');
          if(action==='send-keys' && (!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>16||new Set(body.keys).size!==body.keys.length||body.keys.some(key=>typeof key!=='string'||!Object.hasOwn(keys,key)))) throw apiError(400,'Supply 1–16 unique supported KeyboardEvent codes; see /openapi.json.');
          result=await command(name,action,body);
        }
      }
      response.end(JSON.stringify(result));
    } catch(error) {
      response.statusCode=error.status || 500;
      if(response.statusCode===500) console.error('[workspace] API operation failed:',error);
      response.end(JSON.stringify({error:response.statusCode===500?'Operation failed; check application logs.':error.message}));
    }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  server.setTimeout(120000,socket=>socket.destroy());
  return server;
}
module.exports={createApi,loadApiToken,apiError};
