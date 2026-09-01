import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  listContactsPage,
} from '../../lib/security/domains/contacts.mjs';
import {
  createInteractionCommand,
  listInteractionsPage,
  sanitizeParticipants,
  sanitizeInternalPath,
  toInteractionDto,
} from '../../lib/security/domains/interactions.mjs';
import { contactCreateSchema, contactUpdateSchema, interactionCreateSchema } from '../../lib/security/schemas.mjs';

const rowA = {
  id: contactA.id, project_id: contactA.projectId, assigned_user_id: contactA.assignedUserId,
  name: 'לקוח בדיקה', city: 'עיר בדיקה', is_active: true, next_action_date: null,
  phone: '0500000000', notes: '<script>alert(1)</script>', mitzvot: { demo: 1 }, mitzvot_history: [],
};

function code(expected) {
  return (error) => error instanceof SecurityError && error.code === expected;
}

function pagedDb(rowsByTable, calls = []) {
  return {
    from(table) {
      const filters = [];
      let limit = Infinity;
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); calls.push(['eq', column, value]); return query; },
        in(column, values) { filters.push((row) => values.map(Number).includes(Number(row[column]))); calls.push(['in', column, values]); return query; },
        gt(column, value) { filters.push((row) => Number(row[column]) > Number(value)); calls.push(['gt', column, value]); return query; },
        order(column) { calls.push(['order', column]); return query; },
        limit(value) {
          limit = value;
          calls.push(['limit', value]);
          return Promise.resolve({
            data: (rowsByTable[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, limit),
            error: null,
          });
        },
      };
      return query;
    },
  };
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
  assert.deepEqual(Object.keys(list).sort(), ['assignedUserId', 'city', 'id', 'name', 'nextActionAt', 'projectId', 'status']);
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
  const buckets = [];
  const hidden = await checkDuplicateContact(makeContext(activistA), {
    phone: '0500000000', projectId: activistProjectB.projectId,
  }, {
    ipKey: 'trusted-prefix',
    consumeRate: async (bucket) => { buckets.push(bucket); return { allowed: true }; },
    lookup: async () => { queries += 1; return true; },
  });
  assert.deepEqual(hidden, { duplicate: false });
  assert.equal(queries, 0);
  assert.deepEqual(buckets[0], {
    kind: 'duplicate_lookup',
    key: `${activistA.userId}:${activistProjectB.projectId}:trusted-prefix`,
    limit: 20,
    windowSeconds: 5 * 60,
  });
  await assert.rejects(() => checkDuplicateContact(makeContext(activistA), {
    phone: '0500000000', projectId: activistA.projectId,
  }, {
    ipKey: 'trusted-prefix', consumeRate: async () => ({ allowed: true }),
    lookup: async () => { throw new Error('db down'); },
  }), code('DEPENDENCY_UNAVAILABLE'));
  await assert.rejects(() => checkDuplicateContact(makeContext(activistA), {
    phone: '0500000000', projectId: activistA.projectId,
  }, {
    ipKey: 'trusted-prefix', consumeRate: async () => ({ allowed: false }),
    lookup: async () => false,
  }), code('RATE_LIMITED'));
});

test('duplicate route wires the shared datastore limiter into every lookup', async () => {
  const source = await readFile(new URL('../../pages/api/contacts/check-duplicate.js', import.meta.url), 'utf8');
  assert.match(source, /consumeServerRateLimit/);
  assert.match(source, /clientKey\(req\)/);
  assert.match(source, /consumeRate:\s*consumeServerRateLimit/);
});

test('interaction authority is derived from session and RLS-loaded contact', async () => {
  const command = await createInteractionCommand(makeContext(activistA), rowA, {
    contactId: contactA.id, occurredAt: '2026-08-28T09:00:00.000Z', type: 'שיחה', participantIds: [],
  });
  assert.equal(command.actor_user_id, activistA.userId);
  assert.equal(command.project_id, contactA.projectId);
  assert.equal(command.contact_id, contactA.id);
});

test('brief interactions enforce the canonical method and fixed duration at the BFF boundary', async () => {
  const base = {
    contactId: contactA.id,
    date: '2026-08-28',
    time: '09:00',
    type: 'קצרצר',
    quality: 'טלפון',
    durationMinutes: 5,
  };
  const command = await createInteractionCommand(makeContext(activistA), rowA, base);
  assert.equal(command.type, 'קצרצר');
  assert.equal(command.quality, 'טלפון');
  assert.equal(command.duration_minutes, 5);
  await assert.rejects(
    () => createInteractionCommand(makeContext(activistA), rowA, { ...base, quality: 'email' }),
    code('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => createInteractionCommand(makeContext(activistA), rowA, { ...base, durationMinutes: 6 }),
    code('VALIDATION_FAILED'),
  );
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

test('contacts and interactions expose stable bounded cursor pages through the BFF domain', async () => {
  const calls = [];
  const interactionRows = Array.from({ length: 135 }, (_, index) => ({
    id: index + 1,
    contact_id: contactA.id,
    actor_user_id: activistA.userId,
    activist_id: 7001,
    project_id: activistA.projectId,
    date: '2026-08-28',
    time: '09:00',
    type: 'טלפוני',
    quality: 'תורני',
    duration_minutes: 20,
    participants: {},
  }));
  const contactRows = Array.from({ length: 105 }, (_, index) => ({
    id: index + 1,
    name: `Synthetic ${index + 1}`,
    city: '',
    is_active: true,
    assigned_user_id: activistA.userId,
    next_action_date: null,
    project_id: activistA.projectId,
  }));
  const context = { ...makeContext(activistA), db: pagedDb({ interactions: interactionRows, contacts: contactRows }, calls) };

  const firstInteractions = await listInteractionsPage(context, { limit: 100 });
  assert.equal(firstInteractions.items.length, 100);
  assert.equal(firstInteractions.nextCursor, '100');
  const secondInteractions = await listInteractionsPage(context, { cursor: firstInteractions.nextCursor, limit: 100 });
  assert.equal(secondInteractions.items.length, 35);
  assert.equal(secondInteractions.nextCursor, null);

  const firstContacts = await listContactsPage(context, { limit: 100 });
  assert.equal(firstContacts.items.length, 100);
  assert.equal(firstContacts.nextCursor, '100');
  assert.ok(calls.some((call) => call[0] === 'limit' && call[1] === 101));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'actor_user_id' && call[2] === activistA.userId));
  assert.ok(calls.some((call) => call[0] === 'gt' && call[1] === 'id' && call[2] === '100'));
});

test('contacts and interactions routes expose cursor pages and the browser drains them through the BFF', async () => {
  const [contactsRoute, interactionsRoute, store] = await Promise.all([
    readFile(new URL('../../pages/api/contacts/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../pages/api/interactions/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/CrmStore.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(contactsRoute, /listContactsPage/);
  assert.match(interactionsRoute, /listInteractionsPage/);
  assert.match(store, /fetchAllApiPages/);
  assert.match(store, /['"]\/api\/interactions['"]/);
  assert.match(store, /deriveToraniBonuses\(interactions, contacts\)/);
  assert.match(store, /mitzvotBonuses, newParticipantBonuses, toraniBonuses,/);
  assert.doesNotMatch(store, /contacts\.map\(contact => apiFetch\(`\/api\/contacts\/\$\{encodeURIComponent\(contact\.id\)\}\/interactions/);
});

test('interaction form preserves current brief-report and three-state payment semantics', async () => {
  const source = await readFile(new URL('../../pages/contact/add-interaction/[id].jsx', import.meta.url), 'utf8');
  assert.match(source, /buildContactContext/);
  assert.match(source, /paidBefore\(draft, myMonthly, contacts, paymentConfig, interactions\)/);
  assert.match(source, /reportKind:\s*'single'/);
  assert.match(source, /kind === 'brief' \? 'קצרצר'/);
  assert.match(source, /form\.reportKind === 'brief' \? form\.contact_method : form\.quality/);
  assert.match(source, /form\.reportKind === 'brief' \? 5 : duration/);
  assert.match(source, /CONFIG\.contactMethods\.map/);
  assert.match(source, /if \(result\.amount > 0\)/);
  assert.match(source, /ללא תשלום \(0 ₪\)/);
  assert.match(source, /notifyInteractionApi\(apiFetch,/);
  assert.doesNotMatch(source, /supabase\./);
});

test('contact update schema stays strict while allowing ordinary editable fields', () => {
  assert.equal(contactUpdateSchema.safeParse({ city: 'עיר חדשה' }).success, true);
  assert.equal(contactUpdateSchema.safeParse({ city: 'עיר', is_active: false }).success, false);
});
