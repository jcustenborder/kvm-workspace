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
  const device = validateDevice({ name: ' Office ', lan: '10.0.1.145', tailnet: 'office-kvm', id: 'a' });
  assert.deepEqual(device, {id:'a',name:'Office',lan:'https://10.0.1.145',tailnet:'https://office-kvm'});
  assert.throws(() => validateDevice({...device,password:'secret'}), /Unexpected/);
  assert.throws(() => validateDevice({id:'b',name:'empty'}), /address/);
  assert.throws(() => validateDevice({name:'',lan:'host'}), /name/);
});

test('editing one device leaves every other record intact and does not impose a device limit', () => {
  let devices = [];
  for (let index = 0; index < 12; index++) devices = updateDevices(devices, {id:String(index),name:`KVM ${index}`,lan:`kvm-${index}`});
  devices = updateDevices(devices, {id:'3',name:'Changed',tailnet:'changed-kvm'});
  assert.equal(devices.length, 12);
  assert.equal(devices[3].name, 'Changed');
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
