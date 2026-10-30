'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planRelease}=require('../scripts/release-version.cjs');

test('automatic releases start at the package version and advance numerically past reserved stable tags',()=>{
  assert.equal(planRelease('0.1.0',[],'new-commit').version,'0.1.0');
  const releases=[
    {tag_name:'v0.1.9',target_commitish:'old-commit',draft:false},
    {tag_name:'v0.1.2',target_commitish:'older-commit',draft:false},
    {tag_name:'v0.1.10',target_commitish:'failed-commit',draft:true},
    {tag_name:'v9.0.0-beta.1',target_commitish:'beta',draft:false},
  ];
  assert.equal(planRelease('0.1.0',releases,'new-commit').version,'0.1.11');
  assert.equal(planRelease('0.2.0',releases,'new-commit').version,'0.2.0');
});

test('reruns reuse the release for the exact commit and distinguish drafts from published releases',()=>{
  for(const draft of [true,false]) {
    assert.deepEqual(planRelease('0.1.0',[
      {tag_name:'v0.1.3',target_commitish:'same-commit',draft},
      {tag_name:'v0.1.4',target_commitish:'another-commit',draft:false},
    ],'same-commit'),{version:'0.1.3',tag:'v0.1.3',exists:true,published:!draft});
  }
});

test('automatic releases reject non-stable package versions and missing commit identity',()=>{
  assert.throws(()=>planRelease('0.1.0-beta.1',[],'commit'),/stable package version/);
  assert.throws(()=>planRelease('0.1.0',[],''),/commit/);
});
