'use strict';
const {keys}=require('./keys.cjs');
const name={type:'string',minLength:1,maxLength:63,pattern:'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'};
const empty={type:'object',properties:{},additionalProperties:false};
const bodies={
  start:{type:'object',properties:{route:{type:'string',enum:['lan','tailnet']}},required:['route'],additionalProperties:false},
  end:empty,focus:empty,'speaker/toggle':empty,'mouse-jiggle/toggle':empty,ocr:empty,
  'send-keys':{type:'object',properties:{keys:{type:'array',items:{type:'string',enum:Object.keys(keys)},minItems:1,maxItems:16,uniqueItems:true}},required:['keys'],additionalProperties:false},
  speaker:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},
};
const session={type:'object',required:['name','state','route','speaker','mouseJiggle'],properties:{
  name:{type:'string',description:'Device name; legacy invalid/duplicate names must be repaired in the desktop editor before targeting.'},
  state:{type:'string',enum:['open','closed'],description:'Window state, not proof of authenticated or connected firmware.'},
  route:{type:['string','null'],enum:['lan','tailnet',null]},
  speaker:{type:'object',required:['enabled'],properties:{enabled:{type:['boolean','null'],description:'Observed firmware state; null when closed, Direct mode or unavailable.'}}},
  mouseJiggle:{type:'object',required:['enabled'],properties:{enabled:{type:['boolean','null'],description:'Observed firmware state; null when closed, unready or unavailable.'}}},
}};
const enabled={type:'object',required:['enabled'],properties:{enabled:{type:'boolean'}}};
const triggered={type:'object',required:['triggered'],properties:{triggered:{type:'boolean',const:true}}};
const error={type:'object',required:['error'],properties:{error:{type:'string'}}};
/** @param {object} schema @returns {object} */
function json(schema) {return {'application/json':{schema}};}
/** @param {string} summary @param {object} schema @param {boolean} [named] @returns {object} */
function operation(summary,schema,named=false) {
  const responses={'200':{description:'Success',content:json(schema)}};
  for(const [code,description] of Object.entries({400:'Invalid request',401:'Bearer token required',403:'Origin or Host rejected',404:'Not found',405:'Method not allowed',409:'Session closed, unready, ambiguous or route conflict',413:'Request body exceeds 16 KiB',415:'JSON content type required',500:'Operation failed'})) responses[code]={description,content:json(error)};
  return {summary,...(named?{parameters:[{name:'name',in:'path',required:true,schema:name}]}:{}),responses};
}
const paths={
  '/openapi.json':{get:{...operation('Read this OpenAPI document',{type:'object'}),security:[]}},
  '/sessions':{get:{...operation('List all saved devices and their session state',{type:'array',items:session}),parameters:[{name:'state',in:'query',schema:{type:'string',enum:['open']},description:'Omit to list all devices.'}]}},
  '/sessions/{name}':{get:operation('Read a named session',session,true)},
};
for(const [action,schema] of Object.entries(bodies)) {
  const method=action==='speaker'?'put':'post';
  paths[`/sessions/{name}/${action}`]={[method]:{
    ...operation({start:'Start on an explicit route; same route is idempotent, different route conflicts',end:'Release input and close; already closed succeeds',focus:'Show, restore and focus an open session','send-keys':'Press a combination and release in reverse order; MetaLeft is the Windows key',speaker:'Set, confirm and remember speaker state','speaker/toggle':'Toggle, confirm and remember speaker state','mouse-jiggle/toggle':'Toggle and confirm the firmware Mouse Jiggle state',ocr:'Open the firmware OCR selection interface'}[action],action.startsWith('speaker')||action.startsWith('mouse-jiggle')?enabled:action==='ocr'?triggered:session,true),
    requestBody:{required:!!schema.required,content:json(schema)},
  }};
}
const document={openapi:'3.1.0',info:{title:'KVM Workspace Local API',version:'1.1.0',description:'Enable the loopback-only server in Settings. The schema and /docs are public; session calls require the bearer token copied from Settings. Start may require desktop certificate approval and manual login; open means a window exists. Commands are serialized per device. Browser calls are restricted to the documentation origin.'},servers:[{url:'http://127.0.0.1:53241'}],security:[{bearerAuth:[]}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}}},paths};
module.exports={document,bodies};
