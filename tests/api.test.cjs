'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,stat,chmod,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {request}=require('node:http');
const {createApi,loadApiToken}=require('../src/api.cjs');

test('token is persistent, private and corrupt tokens fail instead of silently rotating',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'kvm-api-'));
  try {
    const token=await loadApiToken(directory);
    assert.match(token,/^[a-f0-9]{64}$/);
    assert.equal(await loadApiToken(directory),token);
    const file=path.join(directory,'api-token');
    assert.equal((await stat(file)).mode&0o777,0o600);
    assert.equal((await readFile(file,'utf8')).trim(),token);
    await chmod(file,0o644);
    await assert.rejects(loadApiToken(directory),/owner-only/);
    await chmod(file,0o600);
    await writeFile(file,'bad-token');
    await assert.rejects(loadApiToken(directory),/token/i);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('HTTP API authenticates every route, validates before dispatch and emits a usable OpenAPI contract',async t=>{
  const token='a'.repeat(64);
  const records=[{name:'laptop',state:'open',route:'lan',speaker:{enabled:false}},{name:'desktop',state:'closed',route:null,speaker:{enabled:null}}];
  let commands=0;
  const server=createApi({token,list:async()=>records,command:async(name,action,body)=>{
    commands++;
    if(name==='missing') throw Object.assign(new Error('No device.'),{status:404});
    if(action==='speaker'||action==='speaker/toggle') return {enabled:action==='speaker'?body.enabled:true};
    return records[0];
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(url,method='GET',body,headers={})=>fetch(base+url,{method,headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await fetch(base+'/sessions')).status,401);
  assert.equal((await fetch(base+'/openapi.json')).status,401);
  assert.equal((await call('/sessions','GET',undefined,{authorization:'Bearer wrong'})).status,401);
  assert.equal((await call('/sessions','GET',undefined,{authorization:`Bearer ${'b'.repeat(64)}`})).status,401);
  assert.equal((await call('/sessions/laptop/speaker/toggle','POST',undefined,{authorization:''})).status,401);
  assert.equal((await call('/sessions','GET',undefined,{origin:'https://evil.example'})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{
    request(base+'/sessions',{headers:{host:'evil.example',authorization:`Bearer ${token}`}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject).end();
  }),403);
  assert.deepEqual(await (await call('/sessions')).json(),records);
  assert.deepEqual(await (await call('/sessions?state=open')).json(),[records[0]]);
  assert.deepEqual(await (await call('/sessions/laptop')).json(),records[0]);
  assert.equal((await call('/sessions/missing')).status,404);
  for(const [url,method,body] of [
    ['/sessions/laptop/start','POST',{}],['/sessions/laptop/start','POST',{route:'auto'}],
    ['/sessions/laptop/start','POST',{route:'lan',extra:true}],['/sessions/laptop/send-keys','POST',{keys:[]}],
    ['/sessions/laptop/send-keys','POST',{keys:['MetaLeft','bogus']}],['/sessions/laptop/send-keys','POST',{keys:['KeyD','KeyD']}],
    ['/sessions/laptop/speaker','PUT',{enabled:'false'}],['/sessions/laptop/end','POST',{extra:1}],
    ['/sessions?state=bad','GET'],['/sessions?unknown=1','GET'],['/sessions/UPPER','GET'],
  ]) assert.equal((await call(url,method,body)).status,400,`${method} ${url}`);
  assert.equal(commands,0,'invalid bodies must not reach session controls');
  assert.equal((await call('/sessions/laptop/send-keys','PUT',{keys:['KeyD']})).status,405);
  assert.equal((await call('/sessions/laptop/nope','POST',{})).status,404);
  assert.equal((await call('/sessions/laptop/speaker','PUT',{enabled:false})).status,200);
  assert.deepEqual(await (await call('/sessions/laptop/speaker/toggle','POST')).json(),{enabled:true});
  for(const action of ['start','end','focus','send-keys']) {
    assert.equal((await call(`/sessions/laptop/${action}`,'POST',action==='start'?{route:'lan'}:action==='send-keys'?{keys:['MetaLeft','KeyD']}:undefined)).status,200);
  }
  assert.equal((await call('/sessions/missing/end','POST')).status,404);
  assert.equal((await fetch(base+'/sessions/laptop/start',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{'})).status,400);
  assert.equal((await call('/sessions/laptop/start','POST',{route:'x'.repeat(17000)})).status,413);
  const document=await (await call('/openapi.json')).json();
  assert.equal(document.openapi,'3.1.0');
  assert.deepEqual(document.security,[{bearerAuth:[]}]);
  assert.equal(document.components.securitySchemes.bearerAuth.scheme,'bearer');
  for(const route of ['start','end','focus','send-keys','speaker/toggle']) assert(document.paths[`/sessions/{name}/${route}`].post.responses['200']);
  assert.equal(document.paths['/sessions/{name}/start'].post.requestBody.required,true);
  assert.deepEqual(document.paths['/sessions/{name}/start'].post.requestBody.content['application/json'].schema.required,['route']);
});
