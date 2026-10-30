'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

test('release packaging refuses missing signing credentials instead of producing an ad-hoc release',()=>{
  const env={...process.env};
  for(const name of ['MACOS_SIGNING_IDENTITY','MACOS_SIGNING_KEYCHAIN','APPLE_ID','APPLE_TEAM_ID','APPLE_APP_SPECIFIC_PASSWORD']) delete env[name];
  const result=spawnSync(process.execPath,['scripts/package.mjs','--release'],{env,encoding:'utf8',timeout:120000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing release credential: MACOS_SIGNING_IDENTITY/);
});
