import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), 'utf8'));
}

test('direct web dependencies use the approved patched pins', async () => {
  const manifest = await readJson('package.json');
  assert.equal(manifest.dependencies.next, '14.2.35');
  assert.equal(manifest.dependencies.jspdf, '3.0.4');
  assert.equal(manifest.dependencies['jspdf-autotable'], '5.0.8');
  assert.equal(manifest.devDependencies?.['@capacitor/assets'], undefined);
});

test('lockfile direct versions agree with the manifest security pins', async () => {
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].dependencies.next, manifest.dependencies.next);
  assert.equal(lock.packages[''].dependencies.jspdf, manifest.dependencies.jspdf);
  assert.equal(lock.packages[''].devDependencies?.['@capacitor/assets'], undefined);
  assert.equal(lock.packages['node_modules/next'].version, '14.2.35');
  assert.equal(lock.packages['node_modules/jspdf'].version, '3.0.4');
  assert.equal(lock.packages['node_modules/jspdf-autotable'].version, '5.0.8');
  assert.equal(lock.packages['node_modules/@capacitor/assets'], undefined);
  assert.equal(lock.packages['node_modules/brace-expansion'].version, '5.0.9');
  assert.equal(lock.packages['node_modules/nanoid'].version, '3.3.18');
  assert.equal(lock.packages['node_modules/tar'].version, '7.5.22');
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');
});
