// Investigation-only: no reference code is imported or executed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { extractFile, listPackage } from '../.rea/node_modules/@electron/asar/lib/asar.js';

const archive = '/Applications/GLKVM.app/Contents/Resources/app.asar';
const root = resolve('investigation/extracted');
const safePath = (path) => {
  const destination = resolve(root, path.replace(/^\//, ''));
  assert(destination.startsWith(root + sep), 'Archive member escapes output root');
  return destination;
};
assert.throws(() => safePath('../../escape'));
assert.equal(safePath('/package.json'), root + '/package.json');

const paths = listPackage(archive).filter((path) =>
  !path.includes('/node_modules/') && /\.(json|js|mjs|cjs|html|css|map)$/.test(path));
for (const path of paths) {
  const destination = safePath(path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, extractFile(archive, path.replace(/^\//, '')));
}
const manifest = JSON.parse(extractFile(archive, 'package.json').toString());
console.log(JSON.stringify({ archive, selectedFiles: paths, manifest }, null, 2));

// Report shapes only: profile values may contain tokens, passwords, or names.
const profile = JSON.parse(readFileSync('/Users/jeremy/Library/Application Support/gl-kvm/GLKVM.json', 'utf8'));
const shape = (value, depth = 0) => {
  if (value === null) return 'null';
  if (depth > 4) return typeof value;
  if (Array.isArray(value)) return { count: value.length, item: value.length ? shape(value[0], depth + 1) : null };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth + 1)]));
  return typeof value;
};
console.log(JSON.stringify({ profileShape: shape(profile) }, null, 2));
