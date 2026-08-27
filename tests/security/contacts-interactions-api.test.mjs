import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activistA, activistB, activistProjectB, coordA, headA, financeA, ceo,
  contactA, contactOwnedByActivistB, contactProjectB, makeContext,
} from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  assertContactAccess,
  createContactCommand,
  updateContactCommand,
  toContactListDto,
  toContactDetailDto,
  checkDuplicateContact,
  escapeHtmlText,
} from '../../lib/security/domains/contacts.mjs';
import {
  createInteractionCommand,
  sanitizeParticipants,
  sanitizeInternalPath,
  toInteractionDto,
} from '../../lib/security/domains/interactions.mjs';
import { contactCreateSchema, contactUpdateSchema, interactionCreateSchema } from '../../lib/security/schemas.mjs';

const rowA = {
  id: contactA.id, project_id: contactA.projectId, assigned_user_id: contactA.assignedUserId,
  name: 'לקוח בדיקה', city: 'עיר בדיקה', status: 'active', next_action_at: null,
  phone: '0500000000', notes: '<script>alert(1)</script>', mitzvot: { demo: 1 }, mitzvot_history: [],
};

function code(expected) {
  return (error) => error instanceof SecurityError && error.code === expected;
}

test('anonymous requests are rejected before contact data access', () => {
  assert.throws(() => assertContactAccess(null, 'read', rowA), code('AUTH_REQUIRED'));
});

test('activist can read own contact', () => {
  assert.doesNotThrow(() => assertContactAccess(makeContext(activistA), 'read', rowA));
});

test('activist receives 404 for another activist in the same project', () => {
  assert.throws(() => assertContactAccess(makeContext(activistA), 'read', {
    ...rowA, id: contactOwnedByActivistB.id, assigned_user_id: activistB.userId,
  }), code('NOT_FOUND'));
});

test('project A actor receives 404 for a project B contact', () => {
  assert.throws(() => assertContactAccess(makeContext(coordA), 'read', {
    ...rowA, id: contactProjectB.id, project_id: activistProjectB.projectId,
    assigned_user_id: activistProjectB.userId,
  }), code('NOT_FOUND'));
});

test('coordinator can read contacts only in an active own-project membership', () => {
  assert.doesNotThrow(() => assertContactAccess(makeContext(coordA), 'read', rowA));
});

test('head AAL2 can perform contact CRUD in own project', () => {
  for (const action of ['read', 'create', 'update', 'delete']) {
    assert.doesNotThrow(() => assertContactAccess(makeContext(headA), action, rowA));
  }
});

test('CEO AAL2 can access cross-project contacts while CEO AAL1 cannot', () => {
  assert.doesNotThrow(() => assertContactAccess(makeContext(ceo), 'read', {
    ...rowA, project_id: activistProjectB.projectId,
  }));
  assert.throws(() => assertContactAccess({ ...makeContext(ceo), aal: 1 }, 'read', rowA), code('MFA_REQUIRED'));
});

test('finance cannot read contact detail or its sensitive projection', () => {
  assert.throws(() => assertContactAccess(makeContext(financeA), 'read', rowA), code('CAPABILITY_DENIED'));
  assert.throws(() => toContactDetailDto(makeContext(financeA), rowA), code('CAPABILITY_DENIED'));
});

test('authority fields in create body are rejected by strict schema', () => {
  for (const field of ['project_id', 'assigned_user_id', 'role']) {
    assert.equal(contactCreateSchema.safeParse({ name: 'בדיקה', [field]: 'attacker' }).success, false);
  }
});

test('activist cannot reassign or move a contact through update body', async () => {
  const ctx = makeContext(activistA);
  for (const input of [
    { assignedUserId: activistB.userId },
    { projectId: activistProjectB.projectId },
    { project_id: activistProjectB.projectId },
  ]) {
    await assert.rejects(() => updateContactCommand(ctx, rowA, input), code('VALIDATION_FAILED'));
  }
});

test('oversized notes are rejected before repository mutation', () => {
  assert.equal(contactCreateSchema.safeParse({ name: 'בדיקה', notes: 'x'.repeat(4_001) }).success, false);
  assert.equal(interactionCreateSchema.safeParse({
    contactId: contactA.id, occurredAt: new Date().toISOString(), type: 'שיחה', notes: 'x'.repeat(4_001),
  }).success, false);
});

test('list projection excludes PII and detail escapes untrusted text', () => {
  const list = toContactListDto(rowA);
  assert.deepEqual(Object.keys(list).sort(), ['assignedUserId', 'city', 'id', 'name', 'nextActionAt', 'status']);
  assert.equal(JSON.stringify(list).includes('0500000000'), false);
  const detail = toContactDetailDto(makeContext(activistA), rowA);
  assert.equal(detail.notes, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtmlText('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});

test('contact create derives project and activist owner from active membership', async () => {
  const command = await createContactCommand(makeContext(activistA), { name: 'בדיקה' });
  assert.equal(command.project_id, activistA.projectId);
  assert.equal(command.assigned_user_id, activistA.userId);
  assert.equal('projectId' in command, false);
});

test('duplicate lookup does not enumerate inaccessible projects and fails closed', async () => {
  let queries = 0;
  const hidden = await checkDuplicateContact(makeContext(activistA), {
    phone: '0500000000', projectId: activistProjectB.projectId,
  }, { lookup: async () => { queries += 1; return true; } });
  assert.deepEqual(hidden, { duplicate: false });
  assert.equal(queries, 0);
  await assert.rejects(() => checkDuplicateContact(makeContext(activistA), {
    phone: '0500000000', projectId: activistA.projectId,
  }, { lookup: async () => { throw new Error('db down'); } }), code('DEPENDENCY_UNAVAILABLE'));
});

test('interaction authority is derived from session and RLS-loaded contact', async () => {
  const command = await createInteractionCommand(makeContext(activistA), rowA, {
    contactId: contactA.id, occurredAt: '2026-08-28T09:00:00.000Z', type: 'שיחה', participantIds: [],
  });
  assert.equal(command.actor_user_id, activistA.userId);
  assert.equal(command.project_id, contactA.projectId);
  assert.equal(command.contact_id, contactA.id);
});

test('interaction schema and sanitizers reject smuggled authority and unsafe links', () => {
  assert.equal(interactionCreateSchema.safeParse({
    contactId: contactA.id, occurredAt: '2026-08-28T09:00:00.000Z', type: 'שיחה',
    project_id: contactA.projectId,
  }).success, false);
  assert.throws(() => sanitizeInternalPath('javascript:alert(1)'), code('UNSAFE_REDIRECT'));
  assert.throws(() => sanitizeInternalPath('//evil.invalid/path'), code('UNSAFE_REDIRECT'));
  assert.equal(sanitizeInternalPath('/contacts?tab=active'), '/contacts?tab=active');
  assert.deepEqual(sanitizeParticipants([contactA.id, contactA.id]), [contactA.id]);
});

test('interaction DTO is explicit and escapes notes', () => {
  const dto = toInteractionDto({
    id: '30000000-0000-4000-8000-000000000001', contact_id: contactA.id,
    actor_user_id: activistA.userId, project_id: contactA.projectId,
    occurred_at: '2026-08-28T09:00:00.000Z', type: 'שיחה', notes: '<b>raw</b>', participants: [],
  });
  assert.equal(dto.notes, '&lt;b&gt;raw&lt;/b&gt;');
  assert.equal('project_id' in dto, false);
  assert.equal('actor_user_id' in dto, false);
});

test('contact update schema stays strict while allowing ordinary editable fields', () => {
  assert.equal(contactUpdateSchema.safeParse({ city: 'עיר חדשה' }).success, true);
  assert.equal(contactUpdateSchema.safeParse({ city: 'עיר', is_active: false }).success, false);
});
