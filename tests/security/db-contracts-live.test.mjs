import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { computeDeterministicFinanceExpected } from '../../scripts/security/provision-test-fixtures.mjs';
import {
  createLocalPostgresAdapter,
  runDirectNotificationAssertions,
  runDirectPostgresAssertions,
} from '../../scripts/security/g5-local-orchestrator.mjs';
import { observeG5Case } from '../../scripts/security/g5-evidence.mjs';
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

function observeG5CaseInTest(testContext, caseId, actualStatus) {
  return observeG5Case(caseId, actualStatus, { testName: testContext.name });
}

const financeKeys = [
  'activity_by_type', 'activity_total', 'bonus_by_type', 'bonus_total',
  'expense_total', 'grand_total', 'name', 'period', 'tour_total',
  'unpaid_by_reason', 'user_id',
];

function assertFinanceProjection(rows) {
  for (const row of rows ?? []) assert.deepEqual(Object.keys(row).sort(), financeKeys);
}

function financeParityMismatch(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
    return 'row-count';
  }
  for (let index = 0; index < expected.length; index += 1) {
    for (const key of financeKeys) {
      if (!isDeepStrictEqual(actual[index]?.[key], expected[index]?.[key])) {
        return key.replaceAll('_', '-');
      }
    }
  }
  return null;
}

async function atSafeCheckpoint(name, action) {
  try {
    return await action();
  } catch {
    throw new Error(`G5_SAFE_CHECKPOINT:${name}`);
  }
}

function failSafeCheckpoint(name) {
  throw new Error(`G5_SAFE_CHECKPOINT:${name}`);
}

test('direct JWT cannot cross reminder or tour workflow boundaries', live, async (t) => {
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
  observeG5CaseInTest(t, 'SEC-037', 'denied');
  observeG5CaseInTest(t, 'SEC-038', 'denied');
});

test('direct JWT rejects malformed tour report JSON and legacy notification routines', live, async (t) => {
  const { clients, resources } = loadFixture();
  for (const report of [
    null,
    [],
    {},
    { notes: null },
    { notes: '' },
    { notes: ' ' },
    { notes: 'x'.repeat(4001) },
    { notes: 'synthetic valid-looking notes', unexpected: true },
  ]) {
    await expectDenied(clients.activistA.rpc('app_submit_tour_report', {
      p_tour_id: resources.tourAssignedA,
      p_report: report,
    }));
  }
  for (const legacyRoutine of [
    'enqueue_interaction_notification',
    'enqueue_base_meeting_notification',
    'enqueue_tour_notification',
    'app_notification_recipients',
  ]) {
    await expectDenied(clients.activistA.rpc(legacyRoutine, {}));
  }
  observeG5CaseInTest(t, 'SEC-061', 'denied');
  observeG5CaseInTest(t, 'SEC-062', 'denied');
});

test('direct JWT permits only the exact reminder-recipient and assigned-tour paths', live, async (t) => {
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
  observeG5CaseInTest(t, 'SEC-063', 'allowed');
});

test('direct JWT cannot forge notification event authority or tenant', live, async (t) => {
  const { clients, resources } = loadFixture();
  await expectDenied(clients.financeA.rpc('app_enqueue_notification_event', {
    p_event_type: 'tour_created', p_resource_id: resources.tourA, p_project_id: resources.projectA,
  }));
  await expectDenied(clients.coordA.rpc('app_enqueue_notification_event', {
    p_event_type: 'tour_created', p_resource_id: resources.tourB, p_project_id: resources.projectA,
  }));
  observeG5CaseInTest(t, 'SEC-039', 'denied');
});

test('direct JWT finance filters only narrow scope and projection keys are exact', live, async (t) => {
  const { clients, resources } = loadFixture();
  const financeExpected = computeDeterministicFinanceExpected({
    runId: resources.securityRunId,
    actorIds: resources.actorIds,
  });
  await atSafeCheckpoint('finance-deny-cross-project', () => expectDenied(clients.financeA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectB, p_user_id: null,
  })));
  await atSafeCheckpoint('finance-deny-cross-user', () => expectDenied(clients.activistA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: resources.activistB,
  })));
  await atSafeCheckpoint('finance-deny-head-aal1', () => expectDenied(clients.headAal1.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: null,
  })));
  await atSafeCheckpoint('finance-deny-ceo-aal1', () => expectDenied(clients.ceoAal1.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: null, p_user_id: null,
  })));
  await atSafeCheckpoint('finance-deny-coordinator', () => expectDenied(clients.coordA.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: null,
  })));

  const expectedByActor = {
    ceoAal2: financeExpected.byActor.ceoAal2ProjectA,
    headAal2: financeExpected.byActor.headAal2,
    financeA: financeExpected.byActor.financeA,
    activistA: financeExpected.byActor.activistA,
  };
  const checkpointByActor = {
    ceoAal2: 'finance-allow-ceo-aal2',
    headAal2: 'finance-allow-head-aal2',
    financeA: 'finance-allow-finance',
    activistA: 'finance-allow-activist',
  };
  for (const actor of Object.keys(expectedByActor)) {
    const checkpoint = checkpointByActor[actor];
    let response;
    try {
      response = await clients[actor].rpc('app_finance_summary', {
        p_period: resources.period,
        p_project_id: resources.projectA,
        p_user_id: actor === 'activistA' ? resources.activistA : null,
      });
    } catch {
      failSafeCheckpoint(`${checkpoint}-rpc`);
    }
    if (response?.error) failSafeCheckpoint(`${checkpoint}-rpc`);
    const data = response?.data;
    try {
      assertFinanceProjection(data);
    } catch {
      failSafeCheckpoint(`${checkpoint}-projection`);
    }
    const mismatch = financeParityMismatch(data, expectedByActor[actor]);
    if (mismatch) failSafeCheckpoint(`${checkpoint}-parity-${mismatch}`);
    assert.deepEqual(data, expectedByActor[actor]);
  }
  observeG5CaseInTest(t, 'SEC-040', 'pass');
});

test('unauthorized direct JWT cannot read the private audit store', live, async (t) => {
  const { clients } = loadFixture();
  await expectDenied(clients.financeA.schema('app_private').from('audit_events').select('id').limit(1));
  await expectDenied(clients.activistA.schema('app_private').from('audit_events').select('id').limit(1));
  observeG5CaseInTest(t, 'SEC-025', 'denied');
});

test('live PostgreSQL assertions prove search-path and atomic-audit behavior', live, async (t) => {
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
  let assertions;
  let notificationAssertions;
  try {
    assertions = await runDirectPostgresAssertions({
      database,
      actorId: resources.actorIds.ceo,
      projectId: resources.projectA,
      expectedRows: financeExpected.byActor.ceoAal2ProjectA.length,
      period: resources.period,
    });
    notificationAssertions = await runDirectNotificationAssertions({
      database,
      actorId: resources.actorIds.activistA1,
      headId: resources.actorIds.headA,
      coordinatorId: resources.actorIds.coordA,
      projectId: resources.projectA,
      zeroRateInteractionId: resources.interactionA,
      positiveInteractionId: resources.interactionPositivePayment,
      ineligibleInteractionId: resources.interactionIneligiblePayment,
    });
  } catch (error) {
    if (/search-path/i.test(error?.message ?? '')) failSafeCheckpoint('postgres-search-path');
    if (/finance audit/i.test(error?.message ?? '')) failSafeCheckpoint('postgres-finance-audit');
    failSafeCheckpoint('postgres-result-shape');
  }
  try {
    assert.deepEqual(assertions, {
      searchPathHijack: 'pass',
      financeAuditFailure: 'pass',
      unauditedRowsReturned: 0,
    });
    assert.deepEqual(notificationAssertions, {
      zeroRateSelfOnly: 'pass',
      positiveManagementOnly: 'pass',
      persistedFactDenials: 'pass',
    });
  } catch {
    failSafeCheckpoint('postgres-result-shape');
  }
  observeG5CaseInTest(t, 'SEC-041', 'pass');
});
