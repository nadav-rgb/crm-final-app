import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeReq, fakeRes, hasCode } from './helpers.mjs';
import { getServerEnv } from '../../lib/security/env.mjs';
import { SecurityError, mapError } from '../../lib/security/errors.mjs';
import { assertSameOrigin, parseJson, sendJson } from '../../lib/security/http.mjs';
import {
  aiSummarySchema,
  contactCreateSchema,
  feedbackCreateSchema,
  loginSchema,
  paginationSchema,
  pushSubscriptionSchema,
  tourCreateSchema,
} from '../../lib/security/schemas.mjs';

const APP_ORIGIN = 'https://crm.example.test';

test('production configuration fails closed without an exact application origin', () => {
  assert.throws(
    () => getServerEnv({ NODE_ENV: 'production' }),
    hasCode('CONFIG_INVALID'),
  );
  assert.throws(
    () => getServerEnv({
      NODE_ENV: 'production',
      APP_ORIGIN: '*',
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-public',
    }),
    hasCode('CONFIG_INVALID'),
  );
});

test('unknown authority fields and excessive nested collections are rejected', () => {
  assert.equal(contactCreateSchema.safeParse({
    name: 'Synthetic Contact',
    project_id: 2,
    role: 'ceo',
  }).success, false);

  assert.equal(tourCreateSchema.safeParse({
    projectId: 1,
    title: 'Synthetic Tour',
    assignedUserIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
  }).success, false);

  assert.equal(paginationSchema.safeParse({ limit: 101 }).success, false);
});

test('schema limits reject oversized secrets and free text', () => {
  assert.equal(loginSchema.safeParse({
    email: 'person@example.test',
    password: 'x'.repeat(129),
  }).success, false);
  assert.equal(feedbackCreateSchema.safeParse({
    projectId: 1,
    category: 'bug',
    message: 'x'.repeat(4001),
  }).success, false);
  assert.equal(aiSummarySchema.safeParse({
    resourceType: 'contact',
    resourceId: crypto.randomUUID(),
    text: 'x'.repeat(8001),
  }).success, false);
});

test('oversized JSON is rejected before schema parsing', async () => {
  let parsed = false;
  const schema = {
    parse() {
      parsed = true;
      return {};
    },
  };
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(65_537) }),
  });

  await assert.rejects(
    () => parseJson(req, schema, { maxBytes: 65_536 }),
    hasCode('PAYLOAD_TOO_LARGE'),
  );
  assert.equal(parsed, false);
});

test('non-JSON, malformed JSON and invalid schema payloads fail with stable codes', async () => {
  await assert.rejects(
    () => parseJson(fakeReq({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }), contactCreateSchema),
    hasCode('UNSUPPORTED_MEDIA_TYPE'),
  );
  await assert.rejects(
    () => parseJson(fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    }), contactCreateSchema),
    hasCode('INVALID_JSON'),
  );
  await assert.rejects(
    () => parseJson(fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: '' }),
    }), contactCreateSchema),
    hasCode('VALIDATION_FAILED'),
  );
});

test('foreign, wildcard and missing mutation origins are rejected', () => {
  for (const origin of ['https://evil.invalid', '*', 'null']) {
    assert.throws(
      () => assertSameOrigin(fakeReq({ method: 'POST', headers: { origin } }), { appOrigin: APP_ORIGIN }),
      hasCode('ORIGIN_DENIED'),
    );
  }
  assert.throws(
    () => assertSameOrigin(fakeReq({ method: 'POST' }), { appOrigin: APP_ORIGIN }),
    hasCode('ORIGIN_DENIED'),
  );
  assert.doesNotThrow(() => assertSameOrigin(
    fakeReq({ method: 'POST', headers: { origin: APP_ORIGIN } }),
    { appOrigin: APP_ORIGIN },
  ));
});

test('public errors and JSON responses never serialize causes or cache sensitive data', () => {
  const error = new SecurityError(403, 'DENIED', 'Access denied', {
    cause: new Error('database credential detail'),
  });
  const mapped = mapError(error, 'req_synthetic');
  assert.deepEqual(mapped, {
    status: 403,
    payload: {
      error: { code: 'DENIED', message: 'Access denied' },
      requestId: 'req_synthetic',
    },
  });
  assert.doesNotMatch(JSON.stringify(mapped), /credential|cause|stack/i);

  const unknown = mapError(new Error('private upstream response'), 'req_unknown');
  assert.equal(unknown.status, 500);
  assert.equal(unknown.payload.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(unknown), /private upstream response/i);

  const res = fakeRes();
  sendJson(res, 401, mapped.payload, { requestId: 'req_synthetic' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['cache-control'], 'no-store, private');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-request-id'], 'req_synthetic');
});

test('push subscription schema rejects recipient spoofing fields', () => {
  const result = pushSubscriptionSchema.safeParse({
    endpoint: 'https://push.example.test/subscription',
    keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' },
    userId: crypto.randomUUID(),
    recipientId: crypto.randomUUID(),
  });
  assert.equal(result.success, false);
});
