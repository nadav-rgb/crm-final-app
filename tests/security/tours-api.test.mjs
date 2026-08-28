import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activistA, activistProjectB, coordA, headA, financeA, ceo, PROJECT_A, PROJECT_B, makeContext,
} from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  assertTourAccess,
  assignTourCommand,
  createTourCommand,
  updateTourCommand,
  submitTourReportCommand,
  cancelTourCommand,
  deleteTourCommand,
  toTourDto,
} from '../../lib/security/domains/tours.mjs';
import { tourCommandSchema, tourUpdateCommandSchema, tourReportCommandSchema } from '../../lib/security/schemas.mjs';

const tourA = {
  id: '70000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
  assigned_user_ids: [activistA.userId], guide_user_id: activistA.userId,
  host_user_id: null, status: 'upcoming', report: null,
};
const tourB = {
  id: '70000000-0000-4000-8000-000000000002', project_id: PROJECT_B,
  assigned_user_ids: [activistProjectB.userId], guide_user_id: activistProjectB.userId,
  host_user_id: null, status: 'upcoming', report: null,
};
const hasCode = (expected) => (error) => error instanceof SecurityError && error.code === expected;

test('head A cannot access or delete tour B', async () => {
  assert.throws(() => assertTourAccess(makeContext(headA), 'delete', tourB), hasCode('NOT_FOUND'));
  await assert.rejects(() => deleteTourCommand(makeContext(headA), tourB, { linkedContacts: 0 }), hasCode('NOT_FOUND'));
});

test('coordinator A cannot update tour B', async () => {
  await assert.rejects(() => updateTourCommand(makeContext(coordA), tourB, { settlement: 'שינוי' }), hasCode('NOT_FOUND'));
});

test('unassigned activist cannot submit a tour report', async () => {
  await assert.rejects(() => submitTourReportCommand(makeContext(activistA), tourB, { notes: 'דיווח' }), hasCode('NOT_FOUND'));
});

test('activist cannot change guide or assignments', async () => {
  for (const body of [
    { guide_user_id: activistProjectB.userId },
    { guideUserId: activistProjectB.userId },
    { assignedUserIds: [activistProjectB.userId] },
  ]) {
    assert.equal(tourUpdateCommandSchema.safeParse(body).success, false);
  }
});

test('delete body cannot smuggle contact or project from another tenant', () => {
  assert.equal(tourCommandSchema.safeParse({ title: 'סיור', contactId: '10000000-0000-4000-8000-000000000003' }).success, false);
  assert.equal(tourCommandSchema.safeParse({ title: 'סיור', project_id: PROJECT_B }).success, false);
});

test('status, assignment and report are rejected from ordinary update', () => {
  for (const body of [{ status: 'completed' }, { assigned_user_ids: [] }, { report: {} }, { projectId: PROJECT_B }]) {
    assert.equal(tourUpdateCommandSchema.safeParse(body).success, false);
  }
});

test('unsafe report content and authority fields are rejected', async () => {
  assert.equal(tourReportCommandSchema.safeParse({ notes: 'x', url: 'javascript:alert(1)' }).success, false);
  assert.equal(tourReportCommandSchema.safeParse({ notes: 'x', reportedBy: ceo.userId }).success, false);
  await assert.rejects(() => submitTourReportCommand(makeContext(activistA), { ...tourA, status: 'cancelled' }, { notes: 'דיווח' }), hasCode('TOUR_CANCELLED'));
});

test('repeated cancel is a conflict and does not mutate again', async () => {
  await assert.rejects(() => cancelTourCommand(makeContext(coordA), { ...tourA, status: 'cancelled' }, { reason: 'כפול' }), hasCode('TOUR_ALREADY_CANCELLED'));
});

test('manager assignment accepts only active same-project members', async () => {
  const command = await assignTourCommand(makeContext(headA), tourA, {
    assignedUserIds: [activistA.userId],
  }, { areActiveMembers: async (projectId, ids) => projectId === PROJECT_A && ids[0] === activistA.userId });
  assert.deepEqual(command.assigned_user_ids, [activistA.userId]);
  await assert.rejects(() => assignTourCommand(makeContext(headA), tourA, {
    assignedUserIds: [activistProjectB.userId],
  }, { areActiveMembers: async () => false }), hasCode('VALIDATION_FAILED'));
});

test('create derives project and separates assignment/status/report authority', async () => {
  const command = await createTourCommand(makeContext(coordA), {
    title: 'סיור בדיקה', settlement: 'יישוב', date: '2026-09-01',
  });
  assert.equal(command.project_id, PROJECT_A);
  assert.equal(command.status, 'upcoming');
  assert.equal('report' in command, false);
  assert.equal('assigned_user_ids' in command, false);
});

test('finance receives aggregate projection without tour operational details', () => {
  const dto = toTourDto(makeContext(financeA), { ...tourA, title: 'פרטי', notes: 'רגיש', settlement: 'יישוב' });
  assert.deepEqual(dto, { id: tourA.id, projectId: PROJECT_A, status: 'upcoming', payableCount: 0 });
});

test('tour business routes contain no service-role table access', async () => {
  const names = ['assign', 'cancel', 'delete', 'notify', 'report', 'update', 'upsert'];
  for (const name of names) {
    const source = await readFile(new URL(`../../pages/api/tours/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /getSupabaseAdmin|\.auth\.getUser|Authorization\s*:/);
  }
  const domain = await readFile(new URL('../../lib/security/domains/tours.mjs', import.meta.url), 'utf8');
  assert.match(domain, /\.rpc\(['"]app_submit_tour_report['"]/);
});
