'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('stapler retries only CloudKit errors, waits between attempts, and preserves failures',()=>{
  const script=path.resolve(__dirname,'../scripts/stapler.sh');
  for(const [codes,status,events] of [
    ['0',0,['call:stapler validate App With Spaces.app']],
    ['68 68 0',0,['call:stapler validate App With Spaces.app','sleep:20','call:stapler validate App With Spaces.app','sleep:20','call:stapler validate App With Spaces.app']],
    ['68 68 68 0',68,['call:stapler validate App With Spaces.app','sleep:20','call:stapler validate App With Spaces.app','sleep:20','call:stapler validate App With Spaces.app']],
    ['65 0',65,['call:stapler validate App With Spaces.app']],
    ['68 65 0',65,['call:stapler validate App With Spaces.app','sleep:20','call:stapler validate App With Spaces.app']],
  ]) {
    const result=spawnSync('bash',['-c',`
      read -ra codes <<< "$2"
      calls=0
      xcrun() { printf 'call:%s\\n' "$*"; local code="\${codes[$calls]}"; calls=$((calls+1)); return "$code"; }
      sleep() { printf 'sleep:%s\\n' "$*"; }
      source "$1" validate 'App With Spaces.app'
    `,'test',script,codes],{encoding:'utf8'});
    assert.equal(result.status,status,result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'),events);
  }
});
