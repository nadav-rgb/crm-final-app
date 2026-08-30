import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { computeDeterministicFinanceExpected } from '../../scripts/security/provision-test-fixtures.mjs';
import {
  createLocalPostgresAdapter,
  runDirectPostgresAssertions,
} from '../../scripts/security/g5-local-orchestrator.mjs';
import { loadVerifiedLocalTarget } from '../../scripts/security/verify-rls-live.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires confirmed isolated G5 loopback target' };

function loadFixture() {
  const target = loadVerifiedLocalTarget();
  const { targetUrl } = target;
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_DIRECT_JWT_FIXTURE ?? '{}');
  if (!publishableKey || !fixture.tokens || !fixture.resources?.actorIds
    || !fixture.resources?.securityRunId) {
    throw new Error('isolated direct-JWT fixture is incomplete');
  }
  const client = (token) => createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    clients: Object.fromEntries(Object.entries(fixture.tokens).map(([key, token]) => [key, client(token)])),
    resources: fixture.resources,
    target,
  };
}

async function expectDenied(promise) {
  const { error } = await promise;
  assert.ok(error, 'direct JWT call unexpectedly succeeded');
}

async function expectNoRows(promise) {
  const { data, error } = await promise;
  assert.ok(error || !data?.length, 'direct row mutation unexpectedly changed a protected row');
}

async function expectAllowed(promise) {
  const { data, error } = await promise;
  assert.ifError(error);
  return data;
}

const financeKeys = [
  'activity_total', 'bonus_total', 'expense_total', 'grand_total',
  'name', 'period', 'tour_total', 'user_id',
];

function assertFinanceProjection(rows) {
  for (const row of rows ?? []) assert.deepEqual(Object.keys(row).sort(), financeKeys);
}

test('direct JWT cannot cross reminder or tour workflow boundaries', live, async () => {
  const { clients, resources } = loadFixture();
  await expectNoRows(clients.activistA.from('meeting_reminders')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('meeting_id', resources.meetingA).select('id'));
  await expectDenied(clients.activistA.rpc('app_cancel_meeting_reminders', {
    p_meeting_id: resources.meetingB,
  }));
  await expectDenied(clients.activistA.rpc('app_submit_tour_report', {
    p_tour_id: resources.tourB,
    p_report: { notes: 'synthetic isolated-test report' },
  }));
  await expectDenied(clients.coordA.rpc('app_submit_tour_report', {
    p_tour_id: resources.tourA,
    p_report: { notes: 'synthetic isolated-test report', reportedBy: resources.activistB },
  }));
  await expectDenied(clients.coordA.from('tours')
    .update({ reported_by_user_id: resources.activistB }).eq('id', resources.tourA).select('id'));
});

test('direct JWT permits only the exact reminder-recipient and assigned-tour paths', live, async () => {
  const { clients, resources } = loadFixture();
  const cancelled = await expectAllowed(clients.activistA.rpc('app_cancel_meeting_reminders', {
    p_meeting_id: resources.meetingA,
  }));
  assert.equal(typeof cancelled, 'number');

  const tours = await expectAllowed(clients.activistA.rpc('app_submit_tour_report', {
    p_tour_id: resources.tourAssignedA,
    p_report: { notes: 'synthetic isolated report', participantCount: 2, outcome: 'synthetic' },
  }));
  assert.equal(tours?.[0]?.reported_by_user_id, resources.activistA);
  assert.equal(tours?.[0]?.project_id, resources.projectA);
});

test('direct JWT cannot forge notification event authority or tenant', live, async () => {
  const { clients, resources } = loadFixture();
  await expectDenied(clients.financeA.rpc('app_enqueue_notification_event', {
    p_event_type: 'tour_created', p_resource_id: resources.tourA, p_project_id: resources.projectA,
  }));
  await expectDenied(clients.coordA.rpc('app_enqueue_notification_event', {
    p_event_type: 'tour_created', p_resource_id: resources.tourB, p_project_id: resources.projectA,
  }));
});

test('direct JWT finance filters only narrow scope and projection keys are exact', live, async () => {
  const { clients, resources } = loadFixture();
  const financeExpected = computeDeterministicFinanceExpected({
    runId: resources.securityRunId,
    actorIds: resources.actorIds,
  });
  await expectDenied(clients.financeA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectB, p_user_id: null,
  }));
  await expectDenied(clients.activistA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: resources.activistB,
  }));
  await expectDenied(clients.headAal1.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: null,
  }));
  await expectDenied(clients.ceoAal1.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: null, p_user_id: null,
  }));
  await expectDenied(clients.coordA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: null,
  }));

  const expectedByActor = {
    ceoAal2: financeExpected.byActor.ceoAal2ProjectA,
    headAal2: financeExpected.byActor.headAal2,
    financeA: financeExpected.byActor.financeA,
    activistA: financeExpected.byActor.activistA,
  };
  for (const actor of Object.keys(expectedByActor)) {
    const data = await expectAllowed(clients[actor].rpc('app_finance_summary', {
      p_period: resources.period,
      p_project_id: resources.projectA,
      p_user_id: actor === 'activistA' ? resources.activistA : null,
    }));
    assertFinanceProjection(data);
    assert.deepEqual(data, expectedByActor[actor]);
  }
});

test('unauthorized direct JWT cannot read the private audit store', live, async () => {
  const { clients } = loadFixture();
  await expectDenied(clients.financeA.schema('app_private').from('audit_events').select('id').limit(1));
  await expectDenied(clients.activistA.schema('app_private').from('audit_events').select('id').limit(1));
});

test('live PostgreSQL assertions prove search-path and atomic-audit behavior', live, async () => {
  const { resources, target } = loadFixture();
  const financeExpected = computeDeterministicFinanceExpected({
    runId: resources.securityRunId,
    actorIds: resources.actorIds,
  });
  const dockerExecutable = process.env.SECURITY_TEST_DOCKER_CLI;
  assert.ok(dockerExecutable, 'absolute local Docker CLI path missing');
  const database = createLocalPostgresAdapter({
    repoRoot: process.cwd(),
    target: target.safety,
    dockerExecutable,
  });
  const assertions = await runDirectPostgresAssertions({
    database,
    actorId: resources.actorIds.ceo,
    projectId: resources.projectA,
    expectedRows: financeExpected.byActor.ceoAal2ProjectA.length,
    period: resources.period,
  });
  assert.deepEqual(assertions, {
    searchPathHijack: 'pass',
    financeAuditFailure: 'pass',
    unauditedRowsReturned: 0,
  });
});
