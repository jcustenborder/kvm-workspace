'use strict';

/** @param {string} value @returns {string} */
function normalizeEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a device address.');
  const text = value.trim();
  let url;
  try { url = new URL(text.includes('://') ? text : `https://${text}`); }
  catch { throw new Error('Enter a valid HTTPS address, IP address, or MagicDNS name.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS device address without credentials, paths, queries, or fragments.');
  }
  return url.origin;
}

/** @param {unknown} value @returns {{id:string,name:string,lan:string,tailnet:string}} */
function validateDevice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid device record.');
  const record = /** @type {Record<string, unknown>} */ (value);
  if (Object.keys(record).some((key) => !['id','name','lan','tailnet'].includes(key))) throw new Error('Unexpected device field; credentials are not device-list data.');
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 80) throw new Error('Enter a device name of up to 80 characters.');
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id)) throw new Error('Invalid device ID.');
  const lan = record.lan ? normalizeEndpoint(/** @type {string} */ (record.lan)) : '';
  const tailnet = record.tailnet ? normalizeEndpoint(/** @type {string} */ (record.tailnet)) : '';
  if (!lan && !tailnet) throw new Error('Enter at least one LAN or tailnet address.');
  return { id:record.id, name:record.name.trim(), lan, tailnet };
}

/** @param {string} candidate @param {string} expected @returns {boolean} */
function sameOrigin(candidate, expected) {
  try {
    const a = new URL(candidate), b = new URL(expected);
    return a.protocol === 'https:' && b.protocol === 'https:' && a.origin === b.origin;
  } catch { return false; }
}

/** @param {Record<string,string>} pins @param {string} endpoint @param {string} fingerprint @returns {boolean} */
function certificateMatches(pins, endpoint, fingerprint) {
  return /^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/.test(fingerprint) && pins[endpoint] === fingerprint;
}

/** @param {Array<{id:string,name:string,lan:string,tailnet:string}>} devices @param {unknown} value */
function updateDevices(devices, value) {
  const device = validateDevice(value);
  const index = devices.findIndex((item) => item.id === device.id);
  const result = devices.slice();
  if (index < 0) result.push(device); else result[index] = device;
  return result;
}

/** @param {unknown} value @returns {{devices:Array<{id:string,name:string,lan:string,tailnet:string}>,pins:Record<string,string>}} */
function validateInventory(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.devices)) throw new Error('Invalid saved device inventory.');
  if (!value.pins || typeof value.pins !== 'object' || Array.isArray(value.pins)) throw new Error('Invalid saved certificate trust.');
  const devices=value.devices.map(validateDevice);
  if (new Set(devices.map(device=>device.id)).size !== devices.length) throw new Error('Duplicate saved device identities.');
  const pins=Object.fromEntries(Object.entries(value.pins).map(([endpoint,fingerprint])=>{
    if (normalizeEndpoint(endpoint)!==endpoint || typeof fingerprint!=='string' || !/^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/.test(fingerprint)) throw new Error('Invalid saved certificate fingerprint.');
    return [endpoint,fingerprint];
  }));
  return {devices,pins};
}

module.exports = {normalizeEndpoint,validateDevice,validateInventory,sameOrigin,certificateMatches,updateDevices};
