const {test} = require('node:test');
const assert = require('node:assert/strict');
const {serial} = require('../src/serial.cjs');

test('deletion waits for a pending save; a failed operation does not poison later work',async () => {
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const files=new Map();
  const save=serial('device',async()=>{await pending;files.set('token','encrypted');});
  const remove=serial('device',async()=>{files.delete('token');});
  finish();await Promise.all([save,remove]);
  assert.equal(files.has('token'),false);
  await assert.rejects(serial('inventory',async()=>{throw new Error('disk full');}),/disk full/);
  let committed=false;
  await serial('inventory',async()=>{committed=true;});
  assert.equal(committed,true);
});
