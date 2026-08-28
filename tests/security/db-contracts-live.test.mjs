import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from '../../scripts/security/verify-rls-live.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires separately approved isolated G5 target' };

function loadFixture() {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_DIRECT_JWT_FIXTURE ?? '{}');
  if (!publishableKey || !fixture.tokens || !fixture.resources) {
    throw new Error('isolated direct-JWT fixture is incomplete');
  }
  const client = (token) => createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    clients: Object.fromEntries(Object.entries(fixture.tokens).map(([key, token]) => [key, client(token)])),
    resources: fixture.resources,
  };
}

async function expectDenied(promise) {
  const { error } = await promise;
  assert.ok(error, 'direct JWT call unexpectedly succeeded');
}

test('direct JWT cannot cross reminder or tour workflow boundaries', live, async () => {
  const { clients, resources } = loadFixture();
  await expectDenied(clients.activistA.from('meeting_reminders')
    .update({ cancelled_at: new Date().toISOString() }).eq('meeting_id', resources.meetingA));
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
    .update({ reported_by_user_id: resources.activistB }).eq('id', resources.tourA));
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

  const { data, error } = await clients.ceoAal2.rpc('app_finance_summary', {
    p_period: resources.period, p_project_id: resources.projectA, p_user_id: null,
  });
  assert.ifError(error);
  for (const row of data ?? []) {
    assert.deepEqual(Object.keys(row).sort(), [
      'activity_total', 'bonus_total', 'expense_total', 'grand_total',
      'name', 'period', 'tour_total', 'user_id',
    ]);
  }
});
