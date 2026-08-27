import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activistA, activistB, coordA, PROJECT_A, PROJECT_B, makeContext } from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  normalizeInternalPath,
  toPushPayload,
  registerWebSubscriptionCommand,
  registerFcmTokenCommand,
  notificationEventCommand,
  assertNotificationOwner,
  toNotificationDto,
} from '../../lib/security/domains/notifications.mjs';
import { notificationEventSchema, ownedPushSubscriptionSchema, ownedFcmTokenSchema } from '../../lib/security/schemas.mjs';

const hasCode = (expected) => (error) => error instanceof SecurityError && error.code === expected;

test('user cannot register web subscription for another user', async () => {
  assert.equal(ownedPushSubscriptionSchema.safeParse({
    userId: activistB.userId,
    endpoint: 'https://push.example.invalid/a', keys: { p256dh: 'a', auth: 'b' },
  }).success, false);
  const command = await registerWebSubscriptionCommand(makeContext(activistA), {
    endpoint: 'https://push.example.invalid/a', keys: { p256dh: 'a', auth: 'b' },
  });
  assert.equal(command.user_id, activistA.userId);
});

test('user cannot register FCM token for another user', async () => {
  assert.equal(ownedFcmTokenSchema.safeParse({ userId: activistB.userId, token: 'x'.repeat(64), platform: 'android' }).success, false);
  const command = await registerFcmTokenCommand(makeContext(activistA), { token: 'x'.repeat(64), platform: 'android' });
  assert.equal(command.user_id, activistA.userId);
});

test('manager cannot send arbitrary recipient, title or body', async () => {
  for (const input of [
    { eventType: 'tour_created', resourceId: '70000000-0000-4000-8000-000000000001', recipientUserId: activistB.userId },
    { eventType: 'tour_created', resourceId: '70000000-0000-4000-8000-000000000001', title: 'spoof' },
    { eventType: 'tour_created', resourceId: '70000000-0000-4000-8000-000000000001', body: 'spoof' },
  ]) assert.equal(notificationEventSchema.safeParse(input).success, false);
});

test('unsafe deep links are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.invalid', 'https://evil.invalid', '/\\evil']) {
    assert.throws(() => normalizeInternalPath(url), hasCode('UNSAFE_REDIRECT'));
  }
  assert.equal(normalizeInternalPath('/notifications?tab=unread'), '/notifications?tab=unread');
});

test('cross-project notification target is concealed', async () => {
  await assert.rejects(() => notificationEventCommand(makeContext(coordA), {
    eventType: 'tour_created', resourceId: '70000000-0000-4000-8000-000000000002',
  }, { projectId: PROJECT_B }), hasCode('NOT_FOUND'));
});

test('lock-screen push payload is generic and contains no PII', () => {
  const sensitive = { title: 'לקוח 0500000000', body: 'מצווה וטלפון 0500000000', url: '/contact/secret', priority: 'high' };
  const payload = toPushPayload(sensitive);
  assert.deepEqual(payload, {
    title: 'מקרבים', body: 'יש עדכון חדש במערכת', url: '/notifications', urgent: true,
  });
  assert.doesNotMatch(JSON.stringify(payload), /0500000000|מצווה|contact\/secret/);
});

test('notification owner can read own row and other recipient receives 404', () => {
  const row = { id: '80000000-0000-4000-8000-000000000001', recipient_user_id: activistA.userId, title: 'עדכון', body: 'פרטים', url: '/notifications' };
  assert.doesNotThrow(() => assertNotificationOwner(makeContext(activistA), row));
  assert.throws(() => assertNotificationOwner(makeContext(activistB), row), hasCode('NOT_FOUND'));
  assert.equal(toNotificationDto(makeContext(activistA), row).title, 'עדכון');
});

test('direct notification insertion fields are not accepted from browser', () => {
  assert.equal(notificationEventSchema.safeParse({
    eventType: 'tour_created', resourceId: '70000000-0000-4000-8000-000000000001',
    recipient_user_id: activistB.userId, client_id: 'spoof', read: false,
  }).success, false);
});

test('notification event derives allowed project and internal path from resource', async () => {
  const command = await notificationEventCommand(makeContext(coordA), {
    eventType: 'meeting_house_assigned', resourceId: '40000000-0000-4000-8000-000000000001',
  }, { projectId: PROJECT_A, url: '/meeting-houses/40000000-0000-4000-8000-000000000001' });
  assert.equal(command.actor_user_id, coordA.userId);
  assert.equal(command.project_id, PROJECT_A);
  assert.match(command.url, /^\/meeting-houses\//);
});

test('push and notification business routes contain no admin CRUD', async () => {
  const files = [
    'push/register-fcm', 'push/send', 'push/status', 'push/subscribe', 'push/test', 'mitzvot/notify',
  ];
  for (const name of files) {
    const source = await readFile(new URL(`../../pages/api/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /getSupabaseAdmin|\.auth\.getUser|Authorization\s*:/);
  }
});

test('service worker normalizes notification click targets against current origin', async () => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /new URL\([^,]+,\s*self\.location\.origin\)/);
  assert.match(source, /target\.origin !== self\.location\.origin/);
  assert.doesNotMatch(source, /clients\.openWindow\(url\)/);
  assert.doesNotMatch(source, /data\.(?:title|body)/);
  assert.match(source, /showNotification\(['"]מקרבים['"]/);
  assert.match(source, /body:\s*['"]יש עדכון חדש במערכת['"]/);
});

test('browser push adapters use the opaque-session api client and never an authorization header', async () => {
  for (const file of ['../../lib/pushClient.js', '../../lib/nativePush.js', '../../components/PushRegistrationMount.jsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /authHeader|Authorization\s*:/);
  }
  const web = await readFile(new URL('../../lib/pushClient.js', import.meta.url), 'utf8');
  const native = await readFile(new URL('../../lib/nativePush.js', import.meta.url), 'utf8');
  assert.match(web, /apiFetch\('\/api\/push\/(?:status|subscribe)'/);
  assert.match(native, /apiFetch\('\/api\/push\/register-fcm'/);
});

test('notification browser cache contains no PII and performs no direct Supabase notification CRUD', async () => {
  const source = await readFile(new URL('../../lib/notificationDemo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|getSupabaseClient|\.from\(['"]notifications['"]\)|\.from\(['"]notification_reads['"]\)/);
});

test('notification migration cuts writes over to UUID ownership and generic server-derived content', async () => {
  const sql = await readFile(new URL('../../migrations/0023_notifications_security.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.notifications alter column recipient_id drop not null/i);
  assert.match(sql, /alter table public\.push_subscriptions alter column activist_id drop not null/i);
  assert.match(sql, /alter table public\.fcm_tokens alter column activist_id drop not null/i);
  assert.match(sql, /'יש עדכון חדש במערכת'/);
  assert.doesNotMatch(sql, /p_(?:recipient|title|body|url)\b/i);
});
