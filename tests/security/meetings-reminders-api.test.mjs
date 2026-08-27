import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activistA, activistB, activistProjectB, coordA, headA, PROJECT_A, PROJECT_B, makeContext,
} from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  assertHouseAccess,
  assignHouseCommand,
  createBaseReportCommand,
  scheduleReminderCommand,
  cancelReminderCommand,
  reminderIdempotencyKey,
} from '../../lib/security/domains/meetings.mjs';
import { meetingHouseCommandSchema, reminderScheduleSchema } from '../../lib/security/schemas.mjs';

const houseA = {
  id: '40000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  assigned_user_ids: [activistA.userId], status: 'active',
};
const houseB = {
  id: '40000000-0000-4000-8000-000000000002', project_id: PROJECT_B,
  assigned_user_ids: [activistProjectB.userId], status: 'active',
};
const reportA = {
  id: '50000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  house_id: houseA.id, actor_user_id: activistA.userId,
};
const hasCode = (expected) => (error) => error instanceof SecurityError && error.code === expected;

test('coordinator A cannot assign a project B house', async () => {
  await assert.rejects(() => assignHouseCommand(makeContext(coordA), houseB, {
    assignedUserIds: [activistProjectB.userId],
  }, { areActiveMembers: async () => true }), hasCode('NOT_FOUND'));
});

test('activist cannot report an unassigned meeting house', async () => {
  await assert.rejects(() => createBaseReportCommand(makeContext(activistB), houseA, {
    occurredAt: '2026-08-28T10:00:00.000Z', notes: 'דיווח בדיקה',
  }), hasCode('NOT_FOUND'));
});

test('report ID belonging to another activist is concealed', () => {
  assert.throws(() => assertHouseAccess(makeContext(activistB), 'report', houseA), hasCode('NOT_FOUND'));
});

test('schedule command rejects arbitrary recipient and derives assigned actor', async () => {
  assert.equal(reminderScheduleSchema.safeParse({ meetingId: reportA.id, recipientUserId: activistB.userId }).success, false);
  const command = await scheduleReminderCommand(makeContext(activistA), reportA, houseA, { meetingId: reportA.id });
  assert.equal(command.recipient_user_id, activistA.userId);
  assert.equal(command.project_id, PROJECT_A);
  assert.equal('recipientUserId' in command, false);
});

test('user cannot cancel another recipient reminder', async () => {
  await assert.rejects(() => cancelReminderCommand(makeContext(activistB), {
    id: '60000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
    recipient_user_id: activistA.userId, meeting_id: reportA.id,
  }), hasCode('NOT_FOUND'));
});

test('meeting body cannot move project or smuggle status/assignments', () => {
  for (const field of ['projectId', 'project_id', 'status', 'assigned_activists']) {
    assert.equal(meetingHouseCommandSchema.safeParse({ settlement: 'בדיקה', [field]: PROJECT_B }).success, false);
  }
});

test('anonymous report notification is denied before resource access', async () => {
  await assert.rejects(() => createBaseReportCommand(null, houseA, {
    occurredAt: '2026-08-28T10:00:00.000Z', notes: 'דיווח בדיקה',
  }), hasCode('AUTH_REQUIRED'));
});

test('replayed schedule uses the same idempotency key and returns conflict on duplicate', async () => {
  const first = reminderIdempotencyKey(reportA.id, activistA.userId);
  const replay = reminderIdempotencyKey(reportA.id, activistA.userId);
  assert.equal(first, replay);
  await assert.rejects(() => scheduleReminderCommand(makeContext(activistA), reportA, houseA, {
    meetingId: reportA.id,
  }, { existingKey: first }), hasCode('REMINDER_CONFLICT'));
});

test('manager assignment accepts only active members in the same project', async () => {
  let received;
  const command = await assignHouseCommand(makeContext(headA), houseA, {
    assignedUserIds: [activistA.userId, activistB.userId],
  }, { areActiveMembers: async (projectId, ids) => { received = { projectId, ids }; return true; } });
  assert.equal(received.projectId, PROJECT_A);
  assert.deepEqual(command.assigned_user_ids, [activistA.userId, activistB.userId]);
  await assert.rejects(() => assignHouseCommand(makeContext(headA), houseA, {
    assignedUserIds: [activistProjectB.userId],
  }, { areActiveMembers: async () => false }), hasCode('VALIDATION_FAILED'));
});

test('base report derives actor, project and house and rejects authority fields', async () => {
  const command = await createBaseReportCommand(makeContext(activistA), houseA, {
    occurredAt: '2026-08-28T10:00:00.000Z', notes: '<script>plain</script>',
  });
  assert.equal(command.actor_user_id, activistA.userId);
  assert.equal(command.project_id, PROJECT_A);
  assert.equal(command.house_id, houseA.id);
  assert.equal(command.notes, '<script>plain</script>');
  await assert.rejects(() => createBaseReportCommand(makeContext(activistA), houseA, {
    occurredAt: '2026-08-28T10:00:00.000Z', notes: 'x', project_id: PROJECT_B,
  }), hasCode('VALIDATION_FAILED'));
});

test('meeting business routes use secureHandler/user DB and scheduler uses RPC only', async () => {
  const files = [
    '../../pages/api/meeting-houses/assign.js', '../../pages/api/meeting-houses/upsert.js',
    '../../pages/api/reminders/schedule.js', '../../pages/api/reminders/cancel.js',
    '../../pages/api/base-meetings/notify.js', '../../lib/meetingReminderScheduler.js',
  ];
  const sources = await Promise.all(files.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources.slice(0, 5)) {
    assert.doesNotMatch(source, /getSupabaseAdmin|service_role|Authorization:\s*`Bearer/);
  }
  assert.match(sources[5], /\.rpc\('app_schedule_meeting_reminders'/);
  assert.doesNotMatch(sources[5], /\.from\(/);
});
