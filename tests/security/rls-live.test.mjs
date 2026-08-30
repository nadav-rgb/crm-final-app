import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import {
  assertSafeTestTarget,
  verifyAnonymousIsolation,
} from '../../scripts/security/verify-rls-live.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires confirmed isolated G5 loopback target' };
const syntheticProduction = 'https://production-project.invalid';

function loadDirectFixture() {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_DIRECT_JWT_FIXTURE ?? '{}');
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  if (!publishableKey || !fixture.tokens || !fixture.resources) {
    throw new Error('isolated direct-JWT fixture is incomplete');
  }
  const client = (token) => createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    targetUrl,
    resources: fixture.resources,
    clients: Object.fromEntries(Object.entries(fixture.tokens)
      .map(([key, token]) => [key, client(token)])),
  };
}

test('G5 target guard accepts only explicitly confirmed exact loopback origins', () => {
  for (const targetUrl of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ]) {
    assert.doesNotThrow(() => assertSafeTestTarget({
      targetUrl,
      productionUrl: syntheticProduction,
      confirmed: true,
    }));
  }
});

test('G5 target guard rejects production equality, missing confirmation, spoofing and remote targets', () => {
  const rejected = [
    { targetUrl: syntheticProduction, productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'http://localhost:54321', productionUrl: syntheticProduction, confirmed: false },
    { targetUrl: 'http://localhost:54321', productionUrl: syntheticProduction, confirmed: undefined },
    { targetUrl: 'http://localhost.evil.example:54321', productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'http://127.0.0.1.evil.example:54321', productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'http://remote-test.supabase.co', productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'https://remote-test.supabase.co', productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'http://prod.example@localhost:54321', productionUrl: syntheticProduction, confirmed: true },
    { targetUrl: 'ftp://localhost:54321', productionUrl: syntheticProduction, confirmed: true },
  ];

  for (const input of rejected) {
    assert.throws(() => assertSafeTestTarget(input), /refused|confirmation|required/i);
  }
});

test('anonymous isolation denies every classified public surface', live, async () => {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  assert.ok(publishableKey, 'missing local publishable key');

  const results = await verifyAnonymousIsolation({ targetUrl, publishableKey });
  assert.ok(results.length >= 18, 'classified security posture is incomplete');
  assert.equal(results.some((result) => result.leaked), false);
});

test('direct PostgREST rejects anonymous PII mutation independently of the BFF', live, async () => {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  assert.ok(publishableKey, 'missing local publishable key');
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.from('contacts').insert({
    name: 'Synthetic denied actor',
    project_id: -1,
  });
  assert.ok(error, 'anonymous contact mutation unexpectedly succeeded');
});

test('RLS denies cross-project and cross-activist contact CRUD', live, async () => {
  const { clients, resources } = loadDirectFixture();

  const { data: projectBRead, error: projectBReadError } = await clients.activistA
    .from('contacts').select('id').eq('id', resources.contactB);
  assert.ifError(projectBReadError);
  assert.deepEqual(projectBRead, []);

  const { data: activistA2Read, error: activistA2ReadError } = await clients.activistA
    .from('contacts').select('id').eq('id', resources.contactA2);
  assert.ifError(activistA2ReadError);
  assert.deepEqual(activistA2Read, []);

  const { error: insertError } = await clients.activistA.from('contacts').insert({
    project_id: resources.projectB,
    assigned_user_id: resources.activistA,
    name: 'Synthetic forged tenant',
    security_run_id: resources.securityRunId,
  });
  assert.ok(insertError, 'cross-project insert unexpectedly succeeded');

  for (const mutation of [
    clients.activistA.from('contacts').update({ project_id: resources.projectA })
      .eq('id', resources.contactB).select('id'),
    clients.activistA.from('contacts').update({ assigned_user_id: resources.activistA })
      .eq('id', resources.contactA2).select('id'),
    clients.activistA.from('contacts').delete().eq('id', resources.contactB).select('id'),
  ]) {
    const { data, error } = await mutation;
    assert.ok(error || !data?.length, 'cross-authority mutation unexpectedly changed a row');
  }
});

test('RLS role projection is exact across CEO, Head, Coordinator, Finance and Activist', live, async () => {
  const { clients, resources } = loadDirectFixture();

  const ceoRows = await clients.ceoAal2.from('contacts').select('id')
    .in('id', [resources.contactA, resources.contactB]);
  assert.ifError(ceoRows.error);
  assert.equal(ceoRows.data.length, 2);

  for (const actor of ['headAal2', 'coordA']) {
    const allowed = await clients[actor].from('contacts').select('id').eq('id', resources.contactA);
    const denied = await clients[actor].from('contacts').select('id').eq('id', resources.contactB);
    assert.ifError(allowed.error);
    assert.ifError(denied.error);
    assert.equal(allowed.data.length, 1);
    assert.deepEqual(denied.data, []);
  }

  for (const actor of ['headAal1', 'ceoAal1', 'financeA']) {
    const { data, error } = await clients[actor].from('contacts').select('id').limit(1);
    assert.ok(error || !data?.length, `${actor} unexpectedly received contact PII`);
  }
});

test('service-only posture inventory proves forced RLS without exposing row data', live, async () => {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  const serviceRoleKey = process.env.SECURITY_TEST_SUPABASE_SERVICE_ROLE_KEY;
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  assert.ok(serviceRoleKey, 'missing process-local service-role key');
  const service = createClient(targetUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc('app_security_posture');
  assert.ifError(error);
  assert.ok(data.length >= 18);
  for (const row of data) {
    assert.equal(row.rls_enabled, true, `${row.table_name} does not enable RLS`);
    assert.equal(row.rls_forced, true, `${row.table_name} does not force RLS`);
  }
});
