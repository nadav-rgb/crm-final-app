import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { notifyInteractionApi } from '../../lib/notifyApi.js';

test('interaction notification helper matches the strict generic server schema', async () => {
  const calls = [];
  await notifyInteractionApi(async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  }, { interactionId: 42, kind: 'self_payment', amount: 0 });
  assert.deepEqual(calls, [{
    url: '/api/interactions/notify',
    options: { method: 'POST', body: { interactionId: 42, kind: 'self_payment' } },
  }]);
});

test('own dashboard includes the current-main Torani streak bonus without widening its BFF boundary', async () => {
  const source = await readFile(new URL('../../pages/my-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(source, /toraniBonuses/);
  assert.match(source, /const myTorani\s*=\s*toraniBonuses\.filter/);
  assert.match(source, /calcConsultantDashboard\([\s\S]*\{ year, month \}, myTorani\)/);
  assert.doesNotMatch(source, /supabase|getSupabaseClient|Authorization\s*:/);
});

test('zero-rate eligible interaction queues only the generic self event while positive payment also queues management', async () => {
  const [page, notifications] = await Promise.all([
    readFile(new URL('../../pages/contact/add-interaction/[id].jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/notificationDemo.js', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /if \(payableCheck\.payable\)\s*\{[\s\S]*kind:\s*'self_payment'/);
  assert.match(page, /if \(payableCheck\.amount > 0\)\s*\{[\s\S]*kind:\s*'payment'/);
  assert.match(page, /ללא תשלום \(0 ₪\)/);
  assert.match(notifications, /createPaymentInteractionNotifications\(\) \{ return \[\]; \}/);
  assert.doesNotMatch(notifications, /contact\.name|localStorage|sessionStorage|\.from\(/);
});

test('guarded comparison includes Torani bonuses and retains the operational preflight', async () => {
  const source = await readFile(new URL('../../scripts/compare-payment-impact.cjs', import.meta.url), 'utf8');
  assert.match(source, /deriveToraniBonuses\(interactions, contacts\)/);
  assert.match(source, /torani(?:New|Bonuses)\.filter/);
  assert.match(source, /beginOperation/);
  assert.match(source, /createGuardedSupabase/);
});

test('coordinators receive a candidate-only bonus cancellation surface without Finance read access', async () => {
  const [auth, detail, activists, card] = await Promise.all([
    readFile(new URL('../../lib/AuthStore.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../pages/payments/[id].jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../pages/activists.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../components/ActivistCard.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(auth, /seePayments:\s*\['finance',\s*'head',\s*'ceo'\]\.includes\(role\)/);
  assert.match(auth, /cancelBonuses:\s*\['coord',\s*'head',\s*'ceo'\]\.includes\(role\)/);
  assert.match(detail, /const canViewPayment = can\.seePayments/);
  assert.match(detail, /const canCancelBonus = can\.cancelBonuses/);
  assert.match(detail, /if \(canViewPayment\)[\s\S]*\/api\/payments\//);
  assert.match(detail, /if \(canCancelBonus\)[\s\S]*\/api\/payments\/bonus-candidates/);
  assert.match(detail, /canViewPayment\s*&&\s*payment/);
  assert.match(activists, /canCancelBonuses=\{can\.cancelBonuses\}/);
  assert.match(card, /activist\.userId[\s\S]*projectId/);
});
