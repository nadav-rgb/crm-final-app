import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { toPaymentDto } from '../../lib/security/domains/finance.mjs';

const require = createRequire(import.meta.url);
const {
  deriveActivityByTypeFromPayment,
  buildActivityWorkbook,
  buildCombinedActivityWorkbook,
} = require('../../lib/activityByTypeExcel.js');

const EXPECTED_TYPES = [
  'טלפוני ידידותי', 'טלפוני תורני', 'זום ידידותי', 'זום תורני',
  'פרונטלי ידידותי', 'פרונטלי תורני', 'פרונטלי רב משתתפים', 'אירוח שבת',
];

function safePayment(overrides = {}) {
  return toPaymentDto({
    user_id: '10000000-0000-4000-8000-000000000001',
    name: '=HYPERLINK("https://evil.invalid")',
    period: '2026-08',
    activity_total: 1_350,
    bonus_total: 2_450,
    tour_total: 750,
    expense_total: 400,
    grand_total: 4_950,
    activity_by_type: [
      { key: 'phone-friendly', count: 2, unitRate: 0, total: 0, contactName: 'Private Person' },
      { key: 'phone-torani', count: 3, unitRate: 150, total: 450, contactId: 'secret-id' },
      { key: 'frontal-torani', count: 3, unitRate: 300, total: 900, notes: 'Private note' },
    ],
    bonus_by_type: [
      { type: 'בונוס-לימוד-4', count: 1, total: 600, contactId: 'secret-id' },
      { type: 'בונוס-לימוד-6', count: 1, total: 850 },
      { type: 'בונוס-תורני', count: 1, total: 1_000 },
    ],
    unpaid_by_reason: [
      { reason: 'short-contact', label: '=HYPERLINK("https://evil.invalid")', count: 2, notes: 'Private note' },
      { reason: 'friendly-window', label: 'מעבר לחלון הזכאות', count: 1 },
    ],
    ...overrides,
  });
}

function allCellValues(workbook) {
  const values = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  }
  return values;
}

test('safe payment aggregates preserve ordered activity, bonuses, unpaid reasons, and totals', () => {
  const payment = safePayment();
  const data = deriveActivityByTypeFromPayment(payment);
  assert.deepEqual(data.typeRows.map((row) => row.label), EXPECTED_TYPES);
  assert.deepEqual(data.typeRows.map((row) => row.count), [2, 3, 0, 0, 0, 3, 0, 0]);
  assert.deepEqual(data.typeRows.map((row) => row.total), [0, 450, 0, 0, 0, 900, 0, 0]);
  assert.deepEqual(data.bonusRows, [
    { label: 'בונוס לימוד', count: 2, detail: '', amount: 1_450 },
    { label: 'בונוס תורני', count: 1, detail: '', amount: 1_000 },
  ]);
  assert.deepEqual(data.unpaidByReason, [
    { reason: '&#39;=HYPERLINK(&quot;https://evil.invalid&quot;)', count: 2 },
    { reason: 'מעבר לחלון הזכאות', count: 1 },
  ]);
  assert.equal(data.unpaidCount, 3);
  assert.equal(data.meetingsTotal, 1_350);
  assert.equal(data.grandTotal, 4_950);
  assert.doesNotMatch(JSON.stringify(data), /Private Person|secret-id|Private note|contactName|contactId|notes/);
});

test('individual and combined activity workbooks remain RTL, formula-safe, and PII-free', async () => {
  const payment = safePayment();
  const data = deriveActivityByTypeFromPayment(payment);
  const individual = await buildActivityWorkbook(payment.name, 'אוגוסט', 2026, data);
  assert.equal(individual.worksheets[0].views[0].rightToLeft, true);
  const individualValues = allCellValues(individual);
  assert.doesNotMatch(JSON.stringify(individualValues), /Private Person|secret-id|Private note/);
  assert.ok(individualValues.some((value) => typeof value === 'string' && value.includes('&#39;=HYPERLINK')));
  for (const value of individualValues) {
    if (value && typeof value === 'object' && 'formula' in value) assert.match(value.formula, /^(SUM\(|[A-Z]\d+(?:\+[A-Z]\d+)+)/);
  }

  const combined = await buildCombinedActivityWorkbook([
    { activistName: payment.name, data },
    { activistName: 'פעיל שני', data: deriveActivityByTypeFromPayment(safePayment({ name: 'פעיל שני' })) },
  ], 'אוגוסט', 2026);
  assert.equal(combined.worksheets.length, 3);
  assert.ok(combined.worksheets.every((sheet) => sheet.views[0].rightToLeft));
  assert.ok(allCellValues(combined).some((value) => value && typeof value === 'object' && /\+/.test(value.formula || '')));
});

test('payment pages export only field-minimized aggregate DTOs', async () => {
  const [listPage, detailPage] = await Promise.all([
    readFile(new URL('../../pages/payments.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../pages/payments/[id].jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(listPage, /deriveActivityByTypeFromPayment/);
  assert.match(detailPage, /deriveActivityByTypeFromPayment/);
  assert.doesNotMatch(listPage, /contactName|contact_id|\.notes/);
  assert.doesNotMatch(detailPage, /contactName|contact_id|\.notes/);
  assert.doesNotMatch(listPage, /supabase|calcMonthlyPayment/);
  assert.doesNotMatch(detailPage, /supabase|calcMonthlyPayment/);
});
