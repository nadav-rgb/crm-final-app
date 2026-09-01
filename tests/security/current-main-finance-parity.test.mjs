import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  buildBonusCandidates,
  parseBonusKey,
  toPaymentDto,
} from '../../lib/security/domains/finance.mjs';

const require = createRequire(import.meta.url);
const payment = require('../../lib/paymentCalc.js');

const CONTACT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';

function toraniFixture() {
  return {
    activistCode: 7001,
    contacts: [{
      id: CONTACT_ID,
      project_id: 1,
      assigned_user_id: USER_ID,
      activist_id: 7001,
      joined_at: '2026-05-01',
      source: 'internal',
      referred_by: null,
      mitzvot_history: [],
    }],
    interactions: [
      { id: 1, contact_id: CONTACT_ID, project_id: 1, actor_user_id: USER_ID, type: 'טלפוני', quality: 'תורני', duration_minutes: 30, date: '2026-06-10', participants: {} },
      { id: 2, contact_id: CONTACT_ID, project_id: 1, actor_user_id: USER_ID, type: 'וידאו', quality: 'תורני', duration_minutes: 30, date: '2026-07-10', participants: {} },
      { id: 3, contact_id: CONTACT_ID, project_id: 1, actor_user_id: USER_ID, type: 'פרונטלי', quality: 'תורני', duration_minutes: 30, date: '2026-08-10', participants: {} },
    ],
    config: {
      bonus_loyalty_4: 600,
      bonus_loyalty_6: 850,
      bonus_mitzvot_level: 600,
      bonus_new_participant: 250,
      min_duration_minutes: 15,
    },
    period: '2026-08',
  };
}

test('current-main JS contract retains exact rates, eligibility, short-contact and Torani bonus behavior', () => {
  assert.equal(payment.DEFAULTS.BASE_PRICES['טלפוני-ידידותי'], 0);
  assert.equal(payment.DEFAULTS.BASE_PRICES['טלפוני-תורני'], 150);
  assert.equal(payment.DEFAULTS.BASE_PRICES['וידאו-תורני'], 200);

  const contact = { id: 1, joined_at: '2026-05-01', high_potential: false };
  const friendly = {
    id: 10, contact_id: 1, activist_id: 7001, project_id: 1,
    type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 30, date: '2026-08-01',
  };
  const context = payment.buildContactContext(contact, 1, 7001, [friendly]);
  assert.deepEqual(
    payment.calcInteractionPayment(friendly, [], false, [], payment.DEFAULTS, context),
    { amount: 0, payable: false, reason: 'קשר ידידותי — מעבר לחלון הזכאות של 3 חודשים מתחילת הקשר' },
  );
  assert.deepEqual(
    payment.calcInteractionPayment({ ...friendly, type: 'קצרצר', quality: 'טלפון' }, [], false, [], payment.DEFAULTS, context),
    { amount: 0, payable: false, reason: 'קשר קצרצר — אינו מזכה בתשלום' },
  );

  const bonuses = payment.deriveToraniBonuses(toraniFixture().interactions.map((row) => ({
    ...row, activist_id: 7001,
  })), [{ id: CONTACT_ID, activist_id: 7001, name: 'Synthetic' }]);
  assert.deepEqual(bonuses.map(({ activist_id, contact_id, amount, month }) => ({ activist_id, contact_id, amount, month })), [{
    activist_id: 7001,
    contact_id: CONTACT_ID,
    amount: 1000,
    month: '2026-7',
  }]);
});

test('hardened bonus candidates expose a Torani candidate only in the first streak completion month', () => {
  const fixture = toraniFixture();
  const candidates = buildBonusCandidates(fixture);
  assert.deepEqual(candidates, [{
    key: `7001|בונוס-תורני|${CONTACT_ID}|2026-7`,
    type: 'בונוס-תורני',
    amount: 1000,
  }]);

  assert.deepEqual(buildBonusCandidates({ ...fixture, period: '2026-09' }), []);
  assert.deepEqual(buildBonusCandidates({
    ...fixture,
    interactions: [fixture.interactions[0], { ...fixture.interactions[2], date: '2026-08-10' }],
  }), []);
});

test('Torani bonus cancellation key remains parseable under the historical key contract', () => {
  assert.deepEqual(parseBonusKey(`7001|בונוס-תורני|${CONTACT_ID}|2026-7`), {
    activistCode: 7001,
    type: 'בונוס-תורני',
    contactId: CONTACT_ID,
    monthKey: '2026-7',
    period: '2026-08',
  });
});

test('payment DTO exposes only safe aggregate export rows and strips injected raw activity data', () => {
  const dto = toPaymentDto({
    user_id: USER_ID,
    name: '=Synthetic Activist',
    period: '2026-08',
    activity_total: 450,
    bonus_total: 1000,
    tour_total: 0,
    expense_total: 20,
    grand_total: 1470,
    activity_by_type: [{ key: 'phone-torani', label: 'טלפוני תורני', count: 3, unitRate: 150, total: 450, contactName: 'Private Name' }],
    bonus_by_type: [{ type: 'בונוס-תורני', count: 1, total: 1000, contactId: CONTACT_ID }],
    unpaid_by_reason: [{ reason: 'short', label: 'פחות ממשך המינימום', count: 2, notes: 'Private note' }],
    interactions: [{ contact_name: 'Private Name', phone: '0500000000', quality: 'תורני' }],
  });

  assert.deepEqual(dto, {
    userId: USER_ID,
    name: '&#39;=Synthetic Activist',
    period: '2026-08',
    activityTotal: 450,
    bonusTotal: 1000,
    tourTotal: 0,
    expenseTotal: 20,
    grandTotal: 1470,
    activityByType: [{ key: 'phone-torani', label: 'טלפוני תורני', count: 3, unitRate: 150, total: 450 }],
    bonusByType: [{ type: 'בונוס-תורני', count: 1, total: 1000 }],
    unpaidByReason: [{ reason: 'short', label: 'פחות ממשך המינימום', count: 2 }],
  });
  assert.doesNotMatch(JSON.stringify(dto), /Private Name|0500000000|Private note|contactId|interactions/);
});

test('0024 and its rollback encode the current-main Finance cutover without a new migration', async () => {
  const migration = await readFile(new URL('../../migrations/0024_finance_security.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../../migrations/rollback/0018-0024-pre-cutover.sql', import.meta.url), 'utf8');

  assert.match(migration, /activity_by_type\s+jsonb/i);
  assert.match(migration, /bonus_by_type\s+jsonb/i);
  assert.match(migration, /unpaid_by_reason\s+jsonb/i);
  assert.match(migration, /בונוס-תורני/);
  assert.match(migration, /קצרצר/);
  assert.match(migration, /rate_phone_friendly\s*=\s*0/i);
  assert.match(migration, /rate_phone_torani\s*=\s*150/i);
  assert.match(migration, /rate_video_torani\s*=\s*200/i);
  assert.match(rollback, /rate_phone_friendly\s*=\s*150/i);
  assert.match(rollback, /rate_phone_torani\s*=\s*200/i);
  assert.match(rollback, /rate_video_torani\s*=\s*250/i);
});

test('guarded Finance verification scripts include the current-main Torani bonus input', async () => {
  for (const relative of [
    '../../scripts/compare-payment-impact.cjs',
    '../../scripts/verify-month-report.cjs',
    '../../scripts/verify-payroll-xlsx.cjs',
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /deriveToraniBonuses\(interactions, contacts/);
    assert.match(source, /torani\w*\.filter\([\s\S]*?bonus\.month === monthKey/);
  }
});
