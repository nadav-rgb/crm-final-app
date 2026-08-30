import test from 'node:test';
import assert from 'node:assert/strict';
import { activistA, activistB, coordA, headA, PROJECT_A, makeContext } from './fixtures.mjs';
import { softDeleteContact, updateContact } from '../../lib/security/domains/contacts.mjs';
import { deleteInteraction } from '../../lib/security/domains/interactions.mjs';
import { assignHouse, upsertHouse } from '../../lib/security/domains/meetings.mjs';
import { assignTour, cancelTour, deleteTour } from '../../lib/security/domains/tours.mjs';
import { deleteExpense } from '../../lib/security/domains/finance.mjs';
import { reviewFeedback } from '../../lib/security/domains/feedback.mjs';

const contact = {
  id: '10000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  assigned_user_id: activistA.userId, name: 'Synthetic', city: '', is_active: true,
  phone: null, notes: '', mitzvot: {}, mitzvot_history: [],
};
const interaction = {
  id: '20000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  contact_id: contact.id, actor_user_id: activistA.userId, date: '2026-08-01',
  type: 'phone', quality: 'friendly', duration_minutes: 10, participants: {},
};
const house = {
  id: '50000000-0000-4000-8000-000000000001', project_id: PROJECT_A, settlement: 'Synthetic', city: 'Synthetic',
  status: 'active', assigned_user_ids: [activistA.userId], meetings: [],
};
const tour = {
  id: '60000000-0000-4000-8000-000000000001', project_id: PROJECT_A, tour_number: 'T-1', settlement: 'Synthetic',
  date: '2026-08-01', start_time: null, guide_name: 'Synthetic',
  guide_user_id: activistA.userId, host_user_id: null,
  assigned_user_ids: [activistA.userId], status: 'upcoming', notes: '', report: null,
};
const expense = {
  id: '30000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  actor_user_id: activistA.userId, activist_id: 7001, date: '2026-08-01', amount: 10,
  description: 'Synthetic', created_at: '2026-08-01T00:00:00.000Z',
};
const feedback = {
  id: '40000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  reporter_user_id: activistA.userId, category: 'other', message: 'Synthetic',
  status: 'open', reviewer_note: null, created_at: '2026-08-01T00:00:00.000Z', reviewed_at: null,
};

function createDb() {
  const calls = [];
  const rows = {
    contacts: contact,
    interactions: interaction,
    meeting_houses: house,
    tours: tour,
    expenses: expense,
    feedback_reports: feedback,
    project_memberships: [
      { user_id: activistA.userId }, { user_id: activistB.userId },
    ],
  };
  const from = (table) => {
    const state = { table, operation: 'select', payload: null, count: false };
    const result = () => ({
      data: state.count ? null : rows[table],
      count: state.count ? 0 : undefined,
      error: null,
    });
    const builder = {
      select(_columns, options = {}) { state.count = options.count === 'exact'; return builder; },
      eq() { return builder; },
      in() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle: async () => result(),
      single: async () => result(),
      update(payload) { state.operation = 'update'; state.payload = payload; calls.push({ table, operation: 'update', payload }); return builder; },
      upsert(payload) { state.operation = 'upsert'; state.payload = payload; calls.push({ table, operation: 'upsert', payload }); return builder; },
      delete() { state.operation = 'delete'; calls.push({ table, operation: 'delete' }); return builder; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return builder;
  };
  const rpc = async (name, args) => {
    calls.push({ operation: 'rpc', name, args });
    return { data: true, error: null };
  };
  return { from, rpc, calls };
}

function assertOnlyRpcMutation(db, expectedName) {
  assert.equal(db.calls.some((call) => call.operation === 'rpc' && call.name === expectedName), true);
  assert.deepEqual(db.calls.filter((call) => ['update', 'delete'].includes(call.operation)), []);
}

test('contact reassignment and soft delete use audited authority RPCs', async () => {
  const reassignmentDb = createDb();
  await updateContact({ ...makeContext(coordA), db: reassignmentDb }, contact.id, {
    assignedUserId: activistB.userId,
  }, { isActiveMember: async () => true });
  assertOnlyRpcMutation(reassignmentDb, 'app_reassign_contact');

  const deleteDb = createDb();
  await softDeleteContact({ ...makeContext(headA), db: deleteDb }, contact.id);
  assertOnlyRpcMutation(deleteDb, 'app_soft_delete_contact');
});

test('interaction and expense hard deletes use manager-only audited RPCs', async () => {
  const interactionDb = createDb();
  await deleteInteraction({ ...makeContext(headA), db: interactionDb }, interaction.id);
  assertOnlyRpcMutation(interactionDb, 'app_delete_interaction');

  const expenseDb = createDb();
  await deleteExpense({ ...makeContext(headA), db: expenseDb }, expense.id);
  assertOnlyRpcMutation(expenseDb, 'app_delete_expense');
});

test('meeting and tour authority transitions use narrow RPCs', async () => {
  const houseDb = createDb();
  await assignHouse({ ...makeContext(coordA), db: houseDb }, house.id, {
    assignedUserIds: [activistA.userId, activistB.userId],
  });
  assertOnlyRpcMutation(houseDb, 'app_assign_meeting_house');

  const upsertDb = createDb();
  await upsertHouse({ ...makeContext(coordA), db: upsertDb }, {
    id: house.id,
    settlement: 'Synthetic updated',
    assignedUserIds: [activistA.userId, activistB.userId],
    meetings: [],
  });
  assert.equal(upsertDb.calls.some((call) => call.operation === 'rpc' && call.name === 'app_assign_meeting_house'), true);
  assert.equal(upsertDb.calls.some((call) => call.operation === 'upsert'), false);
  for (const call of upsertDb.calls.filter((entry) => entry.operation === 'update')) {
    assert.equal(['project_id', 'assigned_user_ids', 'assigned_activists', 'status']
      .some((field) => Object.hasOwn(call.payload, field)), false);
  }

  for (const [actor, operation, expectedName] of [
    [coordA, (ctx) => assignTour(ctx, tour.id, { assignedUserIds: [activistA.userId, activistB.userId] }), 'app_assign_tour'],
    [coordA, (ctx) => cancelTour(ctx, tour.id, { reason: 'Synthetic reason' }), 'app_cancel_tour'],
    [headA, (ctx) => deleteTour(ctx, tour.id), 'app_delete_tour'],
  ]) {
    const db = createDb();
    await operation({ ...makeContext(actor), db });
    assertOnlyRpcMutation(db, expectedName);
  }
});

test('feedback review uses the actor-derived workflow RPC', async () => {
  const db = createDb();
  await reviewFeedback({ ...makeContext(headA), db }, { id: feedback.id, status: 'reviewed' });
  assertOnlyRpcMutation(db, 'app_review_feedback');
});
