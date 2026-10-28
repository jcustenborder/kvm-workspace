'use strict';
/** @type {Map<string,Promise<unknown>>} */
const pending=new Map();
/** @template T @param {string} key @param {() => Promise<T>} operation @returns {Promise<T>} */
async function serial(key,operation) {
  const prior=pending.get(key) || Promise.resolve();
  const current=prior.catch(()=>{}).then(operation);
  pending.set(key,current);
  try { return await current; }
  finally { if(pending.get(key)===current) pending.delete(key); }
}
module.exports={serial};
