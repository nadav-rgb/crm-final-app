import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), 'utf8'));
}

function versionAtLeast(actual, minimum) {
  const current = actual.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const currentPart = current[index] ?? 0;
    const requiredPart = required[index] ?? 0;
    if (currentPart !== requiredPart) return currentPart > requiredPart;
  }
  return true;
}

test('direct web dependencies use the approved patched pins', async () => {
  const manifest = await readJson('package.json');
  assert.equal(manifest.dependencies.next, '16.3.3');
  assert.equal(manifest.dependencies.jspdf, '4.2.1');
  assert.equal(manifest.dependencies['jspdf-autotable'], '5.0.8');
  assert.equal(manifest.devDependencies?.['@capacitor/assets'], undefined);
});

test('Next uses the approved Node floor and explicit Webpack scripts', async () => {
  const manifest = await readJson('package.json');
  assert.equal(manifest.engines?.node, '>=20.9.0');
  assert.equal(manifest.scripts.dev, 'next dev --webpack');
  assert.equal(manifest.scripts.build, 'next build --webpack');
  assert.equal(manifest.scripts.start, 'next start');
  assert.equal(manifest.dependencies.react, '^18');
  assert.equal(manifest.dependencies['react-dom'], '^18');
});

test('lockfile direct versions agree with the manifest security pins', async () => {
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].dependencies.next, manifest.dependencies.next);
  assert.equal(lock.packages[''].dependencies.jspdf, manifest.dependencies.jspdf);
  assert.equal(lock.packages[''].devDependencies?.['@capacitor/assets'], undefined);
  assert.equal(lock.packages['node_modules/next'].version, '16.3.3');
  assert.equal(lock.packages['node_modules/react'].version, '18.3.1');
  assert.equal(lock.packages['node_modules/react-dom'].version, '18.3.1');
  assert.equal(versionAtLeast(lock.packages['node_modules/postcss'].version, '8.5.23'), true);
  assert.equal(lock.packages['node_modules/jspdf'].version, '4.2.1');
  assert.equal(lock.packages['node_modules/jspdf-autotable'].version, '5.0.8');
  assert.equal(lock.packages['node_modules/@capacitor/assets'], undefined);
  assert.equal(lock.packages['node_modules/brace-expansion'].version, '5.0.9');
  assert.equal(lock.packages['node_modules/nanoid'].version, '3.3.18');
  assert.equal(lock.packages['node_modules/tar'].version, '7.5.22');
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');
});
