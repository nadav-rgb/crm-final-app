import test from 'node:test';
import assert from 'node:assert/strict';

const projectId = 'mekarvim-security-g5-loopback-test';
const allowedPorts = [56321, 56322, 56323, 56324, 56325, 56326, 56327];

test('G5 Docker shim rewrites only exact approved publish mappings to IPv4 loopback', async () => {
  const { rewriteDockerPublishArgs } = await import('../../scripts/security/g5-docker-loopback-shim.mjs');
  const args = [
    'create',
    '--name', `supabase_kong_${projectId}`,
    '--label', `com.supabase.cli.project=${projectId}`,
    '-p', '56321:8000',
    '--publish=56322:5432',
    '-e', 'SYNTHETIC_VALUE=unchanged',
    'synthetic/image:1',
  ];

  assert.deepEqual(rewriteDockerPublishArgs(args, { projectId, allowedPorts }), [
    'create',
    '--name', `supabase_kong_${projectId}`,
    '--label', `com.supabase.cli.project=${projectId}`,
    '-p', '127.0.0.1:56321:8000',
    '--publish=127.0.0.1:56322:5432',
    '-e', 'SYNTHETIC_VALUE=unchanged',
    'synthetic/image:1',
  ]);
});

test('G5 Docker shim refuses unapproved ports, non-loopback hosts and mismatched project identity', async () => {
  const { rewriteDockerPublishArgs } = await import('../../scripts/security/g5-docker-loopback-shim.mjs');
  const exactPrefix = [
    'create', '--name', `supabase_db_${projectId}`,
    '--label', `com.supabase.cli.project=${projectId}`,
  ];
  for (const args of [
    [...exactPrefix, '-p', '54322:5432', 'synthetic/image:1'],
    [...exactPrefix, '-p', '0.0.0.0:56322:5432', 'synthetic/image:1'],
    [...exactPrefix, '-p', '[::]:56322:5432', 'synthetic/image:1'],
    ['create', '--name', `supabase_db_${projectId}`, '-p', '56322:5432', 'synthetic/image:1'],
    [
      'create', '--name', `supabase_db_${projectId}`,
      '--label', 'com.supabase.cli.project=mekarvim-security-g5-other',
      '-p', '56322:5432', 'synthetic/image:1',
    ],
  ]) {
    assert.throws(
      () => rewriteDockerPublishArgs(args, { projectId, allowedPorts }),
      /loopback shim refused/i,
    );
  }
});

test('G5 Docker shim leaves non-publishing Docker commands byte-for-byte unchanged', async () => {
  const { rewriteDockerPublishArgs } = await import('../../scripts/security/g5-docker-loopback-shim.mjs');
  const args = ['container', 'inspect', `supabase_db_${projectId}`];
  assert.deepEqual(rewriteDockerPublishArgs(args, { projectId, allowedPorts }), args);
});
