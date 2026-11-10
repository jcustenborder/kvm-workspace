const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEndpoint, validateDevice, validateInventory, sameOrigin, certificateMatches, updateDevices } = require('../src/model.cjs');

test('saved LAN, MagicDNS and IPv6 endpoints normalize without accepting credentials or injected paths', () => {
  assert.equal(normalizeEndpoint('10.0.1.145'), 'https://10.0.1.145');
  assert.equal(normalizeEndpoint(' kvm-home.tailnet.ts.net:8443/ '), 'https://kvm-home.tailnet.ts.net:8443');
  assert.equal(normalizeEndpoint('[fd7a:115c:a1e0::1]'), 'https://[fd7a:115c:a1e0::1]');
  for (const bad of ['http://example.com', 'https://user:secret@host', 'https://host/api', 'https://host/?token=secret', 'file:///tmp/a', 'https://host/#a', 'a b']) {
    assert.throws(() => normalizeEndpoint(bad), Error);
  }
});

test('device records preserve names/routes but cannot retain plaintext credential fields', () => {
  const device = validateDevice({ name: 'office', lan: '10.0.1.145', tailnet: 'office-kvm', id: 'a' });
  assert.deepEqual(device, {id:'a',name:'office',lan:'https://10.0.1.145',tailnet:'https://office-kvm'});
  assert.throws(() => validateDevice({...device,password:'secret'}), /Unexpected/);
  assert.throws(() => validateDevice({id:'b',name:'empty'}), /address/);
  assert.throws(() => validateDevice({name:'',lan:'host'}), /name/);
});

test('editing one device leaves every other record intact and does not impose a device limit', () => {
  let devices = [];
  for (let index = 0; index < 12; index++) devices = updateDevices(devices, {id:String(index),name:`kvm-${index}`,lan:`kvm-${index}`});
  devices = updateDevices(devices, {id:'3',name:'changed',tailnet:'changed-kvm'});
  assert.equal(devices.length, 12);
  assert.equal(devices[3].name, 'changed');
  assert.equal(devices[2].lan, 'https://kvm-2');
  assert.equal(devices[3].lan, '');
});

test('remote origins cannot acquire local IPC or another device permission through a prefix match', () => {
  assert.equal(sameOrigin('https://kvm.test/#/login', 'https://kvm.test'), true);
  assert.equal(sameOrigin('https://kvm.test.evil.test/', 'https://kvm.test'), false);
  assert.equal(sameOrigin('https://kvm.test:8443/', 'https://kvm.test'), false);
  assert.equal(sameOrigin('file:///tmp/a', 'file:///tmp/b'), false);
  assert.equal(sameOrigin('not a URL', 'https://kvm.test'), false);
});

test('certificate pins are exact endpoint and SHA256 matches; absent/rotated pins fail closed', () => {
  const fingerprint = 'A1:'.repeat(31) + 'A1';
  const pins = {'https://kvm.test':fingerprint};
  assert.equal(certificateMatches(pins, 'https://kvm.test', fingerprint), true);
  assert.equal(certificateMatches(pins, 'https://other.test', fingerprint), false);
  assert.equal(certificateMatches(pins, 'https://kvm.test', 'B2:'.repeat(31) + 'B2'), false);
  assert.equal(certificateMatches({}, 'https://kvm.test', fingerprint), false);
});

test('corrupt persisted trust and duplicate device identities fail instead of being silently discarded', () => {
  assert.throws(()=>validateInventory({devices:[],pins:[]}),/trust/);
  assert.throws(()=>validateInventory({devices:[],pins:{'https://kvm.test':'not-a-sha256'}}),/fingerprint/);
  assert.throws(()=>validateInventory({devices:[{id:'a',name:'A',lan:'host'},{id:'a',name:'B',lan:'other'}],pins:{}}),/Duplicate/);
  assert.deepEqual(validateInventory({devices:[{id:'a',name:'A',lan:'host'}],pins:{}}),{devices:[{id:'a',name:'A',lan:'https://host',tailnet:''}],pins:{}});
});

test('sound output choices survive inventory round trips and edits, with strict per-device boolean values', () => {
  const devices=[{id:'a',name:'A',lan:'https://a',tailnet:''},{id:'b',name:'B',lan:'https://b',tailnet:''}];
  const saved={devices,pins:{},soundOutputs:{a:true,b:false}};
  assert.deepEqual(validateInventory(JSON.parse(JSON.stringify(saved))),saved);
  assert.deepEqual(validateInventory({...saved,devices:updateDevices(devices,{...devices[0],name:'renamed'})}).soundOutputs,{a:true,b:false});
  for(const soundOutputs of [null,[],true,{a:'true'},{a:1},{a:null},{missing:true}]) {
    assert.throws(()=>validateInventory({...saved,soundOutputs}),/sound output/i);
  }
});

test('all device saves require unique DNS-label names; legacy inventories remain repairable', () => {
  const device={id:'a',name:'laptop-1',lan:'host'};
  for(const name of ['Office','office mac',' office','office ','-office','office-','a.b','a_b','a'.repeat(64),'']) {
    assert.throws(()=>validateDevice({...device,name}),/name/i);
  }
  for(const name of ['a','0','a'.repeat(63),'jeremy-laptop-x']) assert.equal(validateDevice({...device,name}).name,name);
  assert.throws(()=>updateDevices([device],{...device,id:'b'}),/unique/i);
  assert.equal(updateDevices([device],device).length,1);
  const legacy=validateInventory({devices:[{...device,name:'Office Mac'},{...device,id:'b',name:'Office Mac'}],pins:{},soundOutputs:{a:true}});
  assert.equal(legacy.devices[0].name,'Office Mac');
  assert.equal(updateDevices(legacy.devices,{...device,name:'office-mac'})[0].id,'a');
});
