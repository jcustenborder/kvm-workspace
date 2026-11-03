'use strict';
const {createReadStream}=require('node:fs');
const {stat}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');

/** @param {string} version @param {string} archivePath */
async function createMetadata(version,archivePath) {
  if(typeof version!=='string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected a stable version (major.minor.patch).');
  const url=path.basename(archivePath);
  if(url!==`KVM-Workspace-v${version}-macos-arm64.zip`) throw new Error('Unexpected update archive name for this version.');
  const {size}=await stat(archivePath);
  if(size===0) throw new Error('Update archive is empty.');
  const hash=createHash('sha512');
  for await(const chunk of createReadStream(archivePath)) hash.update(chunk);
  const sha512=hash.digest('base64');
  return {version,files:[{url,sha512,size}],path:url,sha512,releaseDate:new Date().toISOString()};
}

if(require.main===module) {
  createMetadata(process.argv[2],process.argv[3]).then(metadata=>console.log(JSON.stringify(metadata,null,2)))
    .catch(error=>{console.error('[update-metadata]',error);process.exitCode=1;});
}
module.exports={createMetadata};
