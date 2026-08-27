import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  activistA, coordA, headA, headAal1, financeA, ceo,
  contactOwnedByActivistB, contactA, tourProjectB, membershipA, projectA,
  makeContext,
} from './fixtures.mjs';
import { fakeReq, fakeRes, hasCode } from './helpers.mjs';
import { CAPABILITIES, authorize } from '../../lib/security/rbac.mjs';
import { resolveRequestContext } from '../../lib/security/request-context.mjs';
import { createUserSupabase } from '../../lib/security/supabase-user.mjs';
import { appendAudit, sanitizeAuditMetadata } from '../../lib/security/audit.mjs';
import { secureHandler } from '../../lib/security/api-handler.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';

const denied = [
  [activistA, 'contact:read', contactOwnedByActivistB],
  [coordA, 'tour:update', tourProjectB],
  [headA, 'membership:set-ceo', membershipA],
  [financeA, 'contact:read-sensitive', contactA],
  [headAal1, 'report:read', projectA],
];

for (const [actor, capability, resource] of denied) {
  test(`${actor.role} is denied ${capability} outside exact scope`, () => {
    assert.equal(authorize(makeContext(actor), capability, resource), false);
  });
}

test('capability matrix permits only explicit role, owner, project and AAL combinations', () => {
  assert.ok(CAPABILITIES.has('contact:read'));
  assert.equal(authorize(makeContext(activistA), 'contact:read', contactA), true);
  assert.equal(authorize(makeContext(coordA), 'contact:read-sensitive', contactA), true);
  assert.equal(authorize(makeContext(headA), 'report:read', projectA), true);
  assert.equal(authorize(makeContext(ceo), 'audit:read', { projectId: null }), true);
  assert.equal(authorize({ ...makeContext(ceo), aal: 1 }, 'audit:read', { projectId: null }), false);
  assert.equal(authorize({ ...makeContext(coordA), disabledAt: '2026-08-27T00:00:00Z' }, 'contact:read', contactA), false);
  assert.equal(authorize(makeContext(coordA), 'not:a:capability', contactA), false);
});

test('head cannot self-escalate or manage high membership tiers', () => {
  const context = makeContext(headA);
  assert.equal(authorize(context, 'membership:manage', {
    projectId: headA.projectId, userId: headA.userId, targetRole: 'activist',
  }), false);
  assert.equal(authorize(context, 'membership:manage', {
    projectId: headA.projectId, userId: activistA.userId, targetRole: 'head',
  }), false);
  assert.equal(authorize(context, 'membership:manage', {
    projectId: headA.projectId, userId: activistA.userId, targetRole: 'coord',
  }), true);
});

test('request context derives identity and memberships from session services, never request authority fields', async () => {
  const request = fakeReq({ method: 'POST', body: {
    userId: 'attacker', role: 'ceo', projectId: 999,
  } });
  request.headers['x-request-id'] = 'req_context';
  const session = {
    userId: activistA.userId, accessToken: 'server-user-jwt', aal: 1,
    authState: 'active', securityVersion: 2,
  };
  const db = { kind: 'user-scoped' };
  const context = await resolveRequestContext(request, {
    minimumAal: 1,
    loadSession: async () => session,
    loadIdentity: async () => ({
      userId: activistA.userId, globalRole: null, disabledAt: null,
      securityVersion: 2,
      memberships: [{ projectId: activistA.projectId, role: 'activist', status: 'active' }],
    }),
    createDb: (accessToken) => {
      assert.equal(accessToken, 'server-user-jwt');
      return db;
    },
  });
  assert.equal(context.userId, activistA.userId);
  assert.equal(context.globalRole, null);
  assert.equal(context.memberships[0].projectId, activistA.projectId);
  assert.equal(context.db, db);
  assert.equal(context.requestId, 'req_context');
  assert.doesNotMatch(JSON.stringify(context), /attacker|999/);
});

test('request context denies MFA-required, stale and disabled identities before DB creation', async () => {
  const baseSession = {
    userId: headA.userId, accessToken: 'server-user-jwt', aal: 1,
    authState: 'mfa_required', securityVersion: 4,
  };
  let dbCreated = false;
  await assert.rejects(() => resolveRequestContext(fakeReq(), {
    minimumAal: 2,
    loadSession: async () => baseSession,
    loadIdentity: async () => ({ userId: headA.userId, securityVersion: 4, disabledAt: null, memberships: [] }),
    createDb: () => { dbCreated = true; },
  }), hasCode('MFA_REQUIRED'));
  assert.equal(dbCreated, false);

  for (const identity of [
    { userId: headA.userId, securityVersion: 5, disabledAt: null, memberships: [] },
    { userId: headA.userId, securityVersion: 4, disabledAt: '2026-08-27T00:00:00Z', memberships: [] },
  ]) {
    await assert.rejects(() => resolveRequestContext(fakeReq(), {
      loadSession: async () => ({ ...baseSession, aal: 2, authState: 'active' }),
      loadIdentity: async () => identity,
      createDb: () => { dbCreated = true; },
    }), hasCode('SESSION_INVALID'));
  }
});

test('user Supabase client uses only publishable key, user JWT and non-persistent auth', () => {
  const calls = [];
  const client = createUserSupabase('synthetic-user-jwt', {
    supabaseUrl: 'https://synthetic.supabase.co',
    supabasePublishableKey: 'synthetic-publishable-key',
    createClientImpl: (...args) => { calls.push(args); return { kind: 'client' }; },
  });
  assert.deepEqual(client, { kind: 'client' });
  assert.equal(calls[0][0], 'https://synthetic.supabase.co');
  assert.equal(calls[0][1], 'synthetic-publishable-key');
  assert.equal(calls[0][2].global.headers.Authorization, 'Bearer synthetic-user-jwt');
  assert.equal(calls[0][2].auth.persistSession, false);
  assert.equal(calls[0][2].auth.autoRefreshToken, false);
  assert.doesNotMatch(JSON.stringify(calls), /service.role|SUPABASE_SECRET_KEY/i);
});

test('audit metadata is allowlisted and append never sends raw sensitive fields', async () => {
  const metadata = sanitizeAuditMetadata({
    changedFields: ['status'], targetRole: 'coord', source: 'api', exportFormat: 'xlsx',
    password: 'secret', token: 'jwt', phone: '0500000000', notes: 'private',
    body: { raw: true }, authorization: 'Bearer token', error: new Error('raw upstream'),
  });
  assert.deepEqual(metadata, {
    changedFields: ['status'], targetRole: 'coord', source: 'api', exportFormat: 'xlsx',
  });
  const calls = [];
  await appendAudit({
    actorUserId: activistA.userId, action: 'authorization.denied',
    resourceType: 'contact', resourceId: contactA.id, result: 'denied',
    reasonCode: 'CAPABILITY_DENIED', metadata,
  }, { rpc: async (name, params) => { calls.push({ name, params }); return 'audit-id'; } });
  assert.equal(calls[0].name, 'app_audit_append');
  assert.doesNotMatch(JSON.stringify(calls), /password|token|0500000000|private|raw upstream|"authorization"|Bearer\s/i);
});

test('secure handler executes fail-closed guards in the required order', async () => {
  const order = [];
  const handler = secureHandler({
    method: 'POST',
    schema: z.object({ value: z.string() }).strict(),
    minimumAal: 2,
    appOrigin: 'https://crm.example.test',
    resolveContext: async () => { order.push('session'); return { ...makeContext(headA), session: { csrfHash: 'hash' } }; },
    verifyCsrf: () => order.push('csrf'),
    consumeRate: async () => { order.push('rate'); return { allowed: true }; },
    parseBody: async () => { order.push('schema'); return { value: 'ok' }; },
    appendAudit: async () => order.push('audit'),
  }, async () => { order.push('handler'); return { ok: true }; });
  const req = fakeReq({ method: 'POST', headers: { origin: 'https://crm.example.test' }, body: '{}' });
  const res = fakeRes();
  await handler(req, res);
  assert.deepEqual(order, ['session', 'csrf', 'rate', 'schema', 'handler']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store, private');
});

test('secure handler stops before parsing on origin, session, AAL or CSRF denial', async () => {
  const cases = [
    { name: 'origin', req: fakeReq({ method: 'POST', headers: { origin: 'https://evil.invalid' } }), expected: 'ORIGIN_DENIED' },
    { name: 'session', req: fakeReq({ method: 'POST', headers: { origin: 'https://crm.example.test' } }), sessionError: new SecurityError(401, 'SESSION_INVALID', 'Session is invalid'), expected: 'SESSION_INVALID' },
    { name: 'aal', req: fakeReq({ method: 'POST', headers: { origin: 'https://crm.example.test' } }), context: makeContext(headAal1), expected: 'MFA_REQUIRED' },
    { name: 'csrf', req: fakeReq({ method: 'POST', headers: { origin: 'https://crm.example.test' } }), csrfError: new SecurityError(403, 'CSRF_DENIED', 'Request verification failed'), expected: 'CSRF_DENIED' },
  ];
  for (const item of cases) {
    let parsed = false;
    const handler = secureHandler({
      method: 'POST', schema: z.object({}).strict(), minimumAal: 2,
      appOrigin: 'https://crm.example.test',
      resolveContext: async () => {
        if (item.sessionError) throw item.sessionError;
        return item.context ?? makeContext(headA);
      },
      verifyCsrf: () => { if (item.csrfError) throw item.csrfError; },
      consumeRate: async () => ({ allowed: true }),
      parseBody: async () => { parsed = true; return {}; },
      appendAudit: async () => {},
    }, async () => ({ ok: true }));
    const res = fakeRes();
    await handler(item.req, res);
    assert.equal(res.payload.error.code, item.expected, item.name);
    assert.equal(parsed, false, item.name);
  }
});
