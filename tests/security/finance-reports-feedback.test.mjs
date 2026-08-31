import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  activistA, activistB, financeA, headA, headAal1, coordA, ceo, PROJECT_A, PROJECT_B, makeContext,
} from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import paymentCalc from '../../lib/paymentCalc.js';
import { expenseCreateSchema, feedbackCreateSchema } from '../../lib/security/schemas.mjs';
import {
  assertCeoReportAccess,
  assertExpenseAccess,
  bonusCandidateRequestCommand,
  bonusCancellationCommand,
  buildBonusCandidates,
  createExpenseCommand,
  escapeSpreadsheetFormula,
  listExpenses,
  listBonusCandidates,
  listPayments,
  ownBonusCancellationRequest,
  paymentRequestCommand,
  parseBonusKey,
  toExpenseDto,
  toPaymentConfigDto,
  toPaymentDto,
} from '../../lib/security/domains/finance.mjs';
import {
  assertFeedbackReview,
  createFeedbackCommand,
  toFeedbackDto,
} from '../../lib/security/domains/feedback.mjs';

const hasCode = (expected) => (error) => error instanceof SecurityError && error.code === expected;
const { calcMonthlyPayment, deriveMitzvotBonuses, DEFAULTS } = paymentCalc;

test('finance payment projection exposes aggregate fields only and strips contact PII', () => {
  const dto = toPaymentDto({
    user_id: activistA.userId, name: '=Synthetic', period: '2026-08', activity_total: 100,
    bonus_total: 20, tour_total: 30, expense_total: 40, grand_total: 190,
    phone: '0500000000', notes: 'secret', mitzvot: {}, contact_name: 'Hidden',
  });
  assert.deepEqual(Object.keys(dto), [
    'userId', 'name', 'period', 'activityTotal', 'bonusTotal', 'tourTotal', 'expenseTotal', 'grandTotal',
  ]);
  assert.doesNotMatch(JSON.stringify(dto), /0500000000|secret|Hidden|mitzvot/);
});

test('activist can request only own payment and finance is project scoped', () => {
  const own = paymentRequestCommand(makeContext(activistA), { period: '2026-08', userId: activistA.userId });
  assert.equal(own.user_id, activistA.userId);
  assert.throws(
    () => paymentRequestCommand(makeContext(activistA), { period: '2026-08', userId: activistB.userId }),
    hasCode('NOT_FOUND'),
  );
  assert.throws(
    () => paymentRequestCommand(makeContext(financeA), { period: '2026-08', projectId: PROJECT_B }),
    hasCode('NOT_FOUND'),
  );
  assert.throws(
    () => paymentRequestCommand(makeContext(coordA), { period: '2026-08', projectId: PROJECT_A }),
    hasCode('CAPABILITY_DENIED'),
  );
});

test('expense create derives actor and project and rejects authority fields', async () => {
  assert.equal(expenseCreateSchema.safeParse({
    projectId: PROJECT_B, activistId: activistB.userId, amount: 10, occurredOn: '2026-08-20', description: 'Synthetic',
  }).success, false);
  assert.equal(expenseCreateSchema.safeParse({
    amount: 10, category: 'travel', occurredOn: '2026-08-20', notes: 'Synthetic expense',
  }).success, false);
  assert.equal(expenseCreateSchema.safeParse({
    amount: 10, occurredOn: '2999-01-01', description: 'Synthetic expense',
  }).success, false);
  const command = await createExpenseCommand(makeContext(activistA), {
    amount: 10, occurredOn: '2026-08-20', description: 'Synthetic expense',
  }, { activistCode: 7001 });
  assert.deepEqual(command, {
    activist_id: 7001,
    actor_user_id: activistA.userId,
    project_id: PROJECT_A,
    date: '2026-08-20',
    amount: 10,
    description: 'Synthetic expense',
  });
});

test('coordinator is denied raw expenses before a data query and the RLS policy excludes it', async () => {
  const row = { id: 1, actor_user_id: activistA.userId, project_id: PROJECT_A, amount: 10 };
  assert.throws(() => assertExpenseAccess(makeContext(activistA), row, 'delete'), hasCode('CAPABILITY_DENIED'));
  assert.throws(() => assertExpenseAccess(makeContext(coordA), row, 'read'), hasCode('CAPABILITY_DENIED'));
  assert.throws(() => assertExpenseAccess(makeContext(activistB), row, 'delete'), hasCode('NOT_FOUND'));
  assert.throws(() => assertExpenseAccess(makeContext(financeA), { ...row, project_id: PROJECT_B }, 'read'), hasCode('NOT_FOUND'));

  let queryStarted = false;
  await assert.rejects(() => listExpenses({
    ...makeContext(coordA),
    db: { from: () => { queryStarted = true; throw new Error('raw expense query must not run'); } },
  }), hasCode('CAPABILITY_DENIED'));
  assert.equal(queryStarted, false);

  const rls = await readFile(new URL('../../migrations/0019_security_rls.sql', import.meta.url), 'utf8');
  const expenseSelect = rls.match(/create policy expenses_select[\s\S]*?\);/i)?.[0] ?? '';
  assert.match(expenseSelect, /array\['head','finance'\]/i);
  assert.doesNotMatch(expenseSelect, /coord/i);
});

test('expense DTO uses UUID ownership and an explicit field allowlist', () => {
  const dto = toExpenseDto({
    id: 1, activist_id: 7001, actor_user_id: activistA.userId, project_id: PROJECT_A, amount: 12,
    date: '2026-08-20', description: '<script>x</script>', created_at: '2026-08-20T00:00:00Z',
    phone: '0500000000',
  });
  assert.deepEqual(Object.keys(dto), [
    'id', 'userId', 'activistCode', 'projectId', 'amount', 'occurredOn', 'description', 'createdAt',
  ]);
  assert.equal(dto.userId, activistA.userId);
  assert.doesNotMatch(JSON.stringify(dto), /0500000000|<script>/);
});

test('expense repository contract cannot introduce unapproved DB columns or migrations', async () => {
  const source = await readFile(new URL('../../lib/security/domains/finance.mjs', import.meta.url), 'utf8');
  assert.match(source, /id,activist_id,actor_user_id,project_id,date,amount,description,created_at/);
  assert.doesNotMatch(source, /category,occurred_on,notes|occurred_on,notes|\.order\(['"]occurred_on/);
  const migrations = await readdir(new URL('../../migrations/', import.meta.url));
  assert.equal(migrations.some((name) => /^002[5-9]_/.test(name) || /^00[3-9]\d_/.test(name)), false);
});

test('finance repository invokes only app_finance_summary with narrowing arguments', async () => {
  let invocation;
  const db = {
    rpc: async (name, args) => {
      invocation = { name, args };
      return { data: [], error: null };
    },
  };
  await listPayments({ ...makeContext(financeA), db }, { period: '2026-08', projectId: PROJECT_A });
  assert.deepEqual(invocation, {
    name: 'app_finance_summary',
    args: { p_period: '2026-08', p_project_id: PROJECT_A, p_user_id: null },
  });
});

test('payment configuration projection is explicit and own cancellations derive the caller', () => {
  const config = toPaymentConfigDto({
    rate_phone_friendly: 150, rate_phone_torani: 200, rate_video_torani: 250,
    rate_video_friendly: 200, rate_frontal_friendly: 250, rate_frontal_torani: 300,
    rate_multi: 300, rate_shabbat_hosting: 600, cap_phone: 25, cap_frontal: 15,
    cap_multi: 6, cap_contact_frontal_high: 6, cap_contact_phone_high: 10,
    cap_contact_frontal_regular: 6, cap_contact_phone_regular: 10,
    bonus_loyalty_4: 600, bonus_loyalty_6: 850, bonus_mitzvot_level: 600,
    bonus_new_participant: 250, min_duration_minutes: 15, cap_exceed_blocks: false,
    rate_tour_guide: 750, secret: 'hidden',
  });
  assert.deepEqual(Object.keys(config), [
    'BASE_PRICES', 'MONTHLY_CAPS', 'PER_CONTACT_CAPS', 'LEARNING_BONUS',
    'MITZVOT_BONUS_PER_LEVEL', 'NEW_PARTICIPANT_BONUS', 'MIN_DURATION',
    'CAP_EXCEED_BLOCKS', 'TOUR_GUIDE_RATE',
  ]);
  assert.doesNotMatch(JSON.stringify(config), /secret|hidden/);
  assert.deepEqual(
    ownBonusCancellationRequest(makeContext(activistA), { period: '2026-08' }, 7001),
    { user_id: activistA.userId, activist_code: 7001, period: '2026-08', month_key: '2026-7' },
  );
});

test('bonus candidate scope rejects role, AAL and cross-project authority', () => {
  assert.deepEqual(
    bonusCandidateRequestCommand(makeContext(coordA), {
      period: '2026-08', projectId: PROJECT_A, userId: activistA.userId,
    }),
    { period: '2026-08', project_id: PROJECT_A, user_id: activistA.userId },
  );
  assert.throws(
    () => bonusCandidateRequestCommand(makeContext(headAal1), {
      period: '2026-08', projectId: PROJECT_A, userId: activistA.userId,
    }),
    hasCode('MFA_REQUIRED'),
  );
  assert.throws(
    () => bonusCandidateRequestCommand(makeContext(financeA), {
      period: '2026-08', projectId: PROJECT_A, userId: activistA.userId,
    }),
    hasCode('CAPABILITY_DENIED'),
  );
  assert.throws(
    () => bonusCandidateRequestCommand(makeContext(financeA), {
      period: '2026-08', projectId: PROJECT_B, userId: activistA.userId,
    }),
    hasCode('NOT_FOUND'),
  );
  assert.throws(
    () => bonusCandidateRequestCommand(makeContext(coordA), {
      period: '2026-08', projectId: PROJECT_B, userId: activistA.userId,
    }),
    hasCode('NOT_FOUND'),
  );
});

test('coordinator bonus workflow resolves the target through the scoped directory RPC, never raw profiles', async () => {
  const rpcCalls = [];
  const tableReads = [];
  const chain = (result) => ({
    select: () => chain(result),
    eq: () => chain(result),
    gte: () => chain(result),
    lt: () => chain(result),
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  });
  const db = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name !== 'app_project_directory') throw new Error(`unexpected RPC ${name}`);
      return {
        data: [{ user_id: activistA.userId, activist_code: 7001, name: 'Synthetic', role: 'activist' }],
        error: null,
      };
    },
    from: (table) => {
      tableReads.push(table);
      if (table === 'payment_config') {
        return chain({
          data: {
            bonus_loyalty_4: 1, bonus_loyalty_6: 1, bonus_mitzvot_level: 1,
            bonus_new_participant: 1, min_duration_minutes: 15,
          },
          error: null,
        });
      }
      return chain({ data: [], error: null });
    },
  };
  assert.deepEqual(await listBonusCandidates({ ...makeContext(coordA), db }, {
    period: '2026-08', projectId: PROJECT_A, userId: activistA.userId,
  }), []);
  assert.deepEqual(rpcCalls, [{
    name: 'app_project_directory', args: { p_project_id: PROJECT_A },
  }]);
  assert.equal(tableReads.includes('profiles'), false);
});

test('bonus candidates match the legacy key contract and expose no contact PII', () => {
  const contactId = '10000000-0000-4000-8000-000000000001';
  const contacts = [{
    id: contactId, project_id: PROJECT_A, assigned_user_id: activistA.userId, activist_id: 7001,
    name: 'Private Name', phone: '0500000000', joined_at: '2026-08-03', source: 'external',
    referred_by: null, mitzvot_history: [{ mitzva: 'Synthetic', from: 0, to: 1, date: '2026-08-04' }],
  }];
  const interactions = Array.from({ length: 4 }, (_, index) => ({
    id: index + 1, contact_id: contactId, project_id: PROJECT_A, actor_user_id: activistA.userId,
    type: 'פרונטלי', quality: 'תורני', duration_minutes: 30, date: `2026-08-0${index + 1}`, participants: {},
  }));
  const candidates = buildBonusCandidates({
    activistCode: 7001, contacts, interactions,
    config: { bonus_loyalty_4: 600, bonus_loyalty_6: 850, bonus_mitzvot_level: 600, bonus_new_participant: 250, min_duration_minutes: 15 },
    cancelledKeys: new Set(), period: '2026-08',
  });
  assert.deepEqual(candidates.map((candidate) => candidate.key), [
    `7001|בונוס-חדש|${contactId}|2026-7`,
    `7001|בונוס-לימוד-4|${contactId}|2026-7`,
    `7001|בונוס-מצוות|${contactId}|2026-7`,
  ].sort());
  assert.doesNotMatch(JSON.stringify(candidates), /Private Name|0500000000|contactName|phone|notes/);
  assert.equal(parseBonusKey(candidates[0].key).monthKey, '2026-7');
});

test('bonus candidate totals stay in parity with the existing payment engine fixture', () => {
  const contactId = 9001;
  const contacts = [{
    id: contactId, project_id: 1, assigned_user_id: activistA.userId, activist_id: 7001,
    name: 'Synthetic', high_potential: false, joined_at: '2026-08-03', source: 'external',
    referred_by: null, mitzvot_history: [{ mitzva: 'Synthetic', from: 0, to: 1, date: '2026-08-04' }],
  }];
  const interactions = Array.from({ length: 4 }, (_, index) => ({
    id: index + 1, contact_id: contactId, project_id: 1, activist_id: 7001,
    actor_user_id: activistA.userId, type: 'פרונטלי', quality: 'תורני',
    duration_minutes: 30, date: `2026-08-0${index + 1}`, participants: {},
  }));
  const configRow = {
    bonus_loyalty_4: 600, bonus_loyalty_6: 850, bonus_mitzvot_level: 600,
    bonus_new_participant: 250, min_duration_minutes: 15,
  };
  const engineConfig = {
    ...DEFAULTS,
    LEARNING_BONUS: { 4: configRow.bonus_loyalty_4, 6: configRow.bonus_loyalty_6 },
    MITZVOT_BONUS_PER_LEVEL: configRow.bonus_mitzvot_level,
    NEW_PARTICIPANT_BONUS: configRow.bonus_new_participant,
    MIN_DURATION: configRow.min_duration_minutes,
  };
  const engine = calcMonthlyPayment(
    7001,
    interactions,
    contacts,
    deriveMitzvotBonuses(contacts, configRow.bonus_mitzvot_level),
    [{ activist_id: 7001, contact_id: contactId, contactName: 'Synthetic', month: '2026-7' }],
    engineConfig,
    new Set(),
    { year: 2026, month: 7 },
  );
  const candidates = buildBonusCandidates({
    activistCode: 7001, contacts, interactions, config: configRow,
    cancelledKeys: new Set(), period: '2026-08',
  });
  const engineBonusTotal = engine.breakdown
    .filter((item) => item.type.startsWith('בונוס-'))
    .reduce((sum, item) => sum + Number(item.amount), 0);
  assert.equal(candidates.reduce((sum, item) => sum + item.amount, 0), engineBonusTotal);
});

test('bonus cancellation derives all authority fields and rejects a forged resource', () => {
  const contact = {
    id: '10000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
    assigned_user_id: activistA.userId, activist_id: 7001,
  };
  const candidate = {
    key: `7001|בונוס-לימוד-4|${contact.id}|2026-7`, type: 'בונוס-לימוד-4', amount: 600,
  };
  assert.deepEqual(
    bonusCancellationCommand(makeContext(headA), { bonusKey: candidate.key }, {
      contact, candidate, actorActivistCode: 9001,
    }),
    {
      bonus_key: candidate.key,
      activist_id: 7001,
      project_id: PROJECT_A,
      desc: 'בונוס-לימוד-4',
      amount: 600,
      cancelled_by: 9001,
      beneficiary_user_id: activistA.userId,
      cancelled_by_user_id: headA.userId,
    },
  );
  assert.throws(
    () => bonusCancellationCommand(makeContext(headA), {
      bonusKey: candidate.key, projectId: PROJECT_B, beneficiaryUserId: activistB.userId,
    }, { contact, candidate, actorActivistCode: 9001 }),
    hasCode('VALIDATION_FAILED'),
  );
  assert.throws(
    () => bonusCancellationCommand(makeContext(headA), { bonusKey: candidate.key }, {
      contact: { ...contact, project_id: PROJECT_B }, candidate, actorActivistCode: 9001,
    }),
    hasCode('NOT_FOUND'),
  );
  assert.throws(
    () => bonusCancellationCommand(makeContext(activistA), { bonusKey: candidate.key }, {
      contact, candidate, actorActivistCode: 7001,
    }),
    hasCode('CAPABILITY_DENIED'),
  );
  assert.throws(
    () => bonusCancellationCommand({ ...makeContext(ceo), aal: 1 }, { bonusKey: candidate.key }, {
      contact, candidate, actorActivistCode: 9002,
    }),
    hasCode('MFA_REQUIRED'),
  );
});

test('interaction report is CEO AAL2 only', () => {
  assert.doesNotThrow(() => assertCeoReportAccess(makeContext(ceo)));
  assert.throws(() => assertCeoReportAccess({ ...makeContext(ceo), aal: 1 }), hasCode('MFA_REQUIRED'));
  assert.throws(() => assertCeoReportAccess(makeContext(headA)), hasCode('CAPABILITY_DENIED'));
  assert.throws(() => assertCeoReportAccess(makeContext(coordA)), hasCode('CAPABILITY_DENIED'));
});

test('interaction report active loader uses user-scoped tables and explicit projections', async () => {
  const server = await readFile(new URL('../../lib/interactionReportServer.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../../pages/api/reports/interaction-report.js', import.meta.url), 'utf8');
  assert.match(server, /function loadScopedInteractionReport/);
  assert.match(server, /from\(['"]profiles['"]\)[\s\S]*select\(['"]id,activist_code,name,global_role['"]\)/);
  assert.match(server, /from\(['"]project_memberships['"]\)[\s\S]*select\(['"]user_id,project_id,role,status['"]\)/);
  assert.doesNotMatch(server, /loadScopedInteractionReport[\s\S]*?select\(['"]\*['"]\)/);
  assert.doesNotMatch(server, /getSupabaseAdmin/);
  assert.match(route, /loadScopedInteractionReport/);
});

test('spreadsheet formula prefixes are escaped before export', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd']) assert.equal(escapeSpreadsheetFormula(value), `'${value}`);
  assert.equal(escapeSpreadsheetFormula('Synthetic'), 'Synthetic');
  assert.equal(escapeSpreadsheetFormula(42), 42);
});

test('feedback reporter and project are derived and cannot be forged', async () => {
  assert.equal(feedbackCreateSchema.safeParse({
    projectId: PROJECT_B, reporterId: activistB.userId, category: 'bug', message: 'Synthetic',
  }).success, false);
  const command = await createFeedbackCommand(makeContext(activistA), { category: 'bug', message: 'Synthetic' });
  assert.equal(command.reporter_user_id, activistA.userId);
  assert.equal(command.project_id, PROJECT_A);
  assert.equal(command.status, 'open');
});

test('feedback review is limited to CEO AAL2 or scoped project managers', () => {
  const row = { id: '90000000-0000-4000-8000-000000000001', project_id: PROJECT_A, reporter_user_id: activistA.userId };
  assert.doesNotThrow(() => assertFeedbackReview(makeContext(headA), row));
  assert.doesNotThrow(() => assertFeedbackReview(makeContext(coordA), row));
  assert.throws(() => assertFeedbackReview(makeContext(activistA), row), hasCode('CAPABILITY_DENIED'));
  assert.throws(() => assertFeedbackReview(makeContext(financeA), { ...row, project_id: PROJECT_B }), hasCode('NOT_FOUND'));
});

test('feedback DTO escapes untrusted text and omits upstream fields', () => {
  const dto = toFeedbackDto(makeContext(activistA), {
    id: '90000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
    reporter_user_id: activistA.userId, category: 'bug', message: '<img src=x>', status: 'open',
    created_at: '2026-08-20T00:00:00Z', issue_url: 'https://public.example/secret', upstream_error: 'token',
  });
  assert.match(dto.message, /&lt;img/);
  assert.doesNotMatch(JSON.stringify(dto), /public\.example|upstream|token/);
});

test('Task 14 feedback forwarding remains disabled and fail closed', async () => {
  const source = await readFile(new URL('../../pages/api/cron/feedback-to-issues.js', import.meta.url), 'utf8');
  assert.match(source, /FEATURE_DISABLED/);
  assert.doesNotMatch(source, /getSupabaseAdmin|api\.github\.com|GITHUB_TOKEN|\.from\(['"]feedback_reports['"]\)/);
});

test('finance report and feedback business routes use secure handlers without admin CRUD', async () => {
  const files = [
    '../../pages/api/expenses/index.js', '../../pages/api/expenses/[id].js',
    '../../pages/api/payments/index.js', '../../pages/api/payments/[userId].js',
    '../../pages/api/payments/bonus-candidates.js', '../../pages/api/payments/cancel-bonus.js',
    '../../pages/api/payments/cancellations.js', '../../pages/api/payments/config.js',
    '../../pages/api/feedback/index.js', '../../pages/api/reports/interaction-report.js',
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /secureHandler/);
    assert.doesNotMatch(source, /getSupabaseAdmin|Authorization\s*:|\.auth\.getUser/);
  }
});

test('browser finance and feedback pages contain no direct Supabase CRUD or bearer helper', async () => {
  for (const file of [
    '../../pages/expenses.jsx', '../../pages/payments.jsx', '../../pages/payments/[id].jsx',
    '../../pages/my-dashboard.jsx', '../../pages/feedback.jsx', '../../lib/interactionReportClient.js',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /getSupabaseClient|authHeader|\.from\(['"](?:expenses|feedback_reports|bonus_cancellations)['"]\)/);
  }
  const feedbackSource = await readFile(new URL('../../pages/feedback.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(feedbackSource, /PGRST205|feedback_reports|err\.message|issue_url|github/i);
  const crmSource = await readFile(new URL('../../lib/CrmStore.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(crmSource, /loadPaymentConfig/);
});
