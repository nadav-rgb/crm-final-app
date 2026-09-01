import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activistA, makeContext, PROJECT_A } from './fixtures.mjs';
import {
  enqueueInteractionNotification,
  enqueueNotificationEvent,
} from '../../lib/security/domains/notifications.mjs';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const DELIVERY_ID = '90000000-0000-4000-8000-000000000001';

test('I3 production notification routes use the one resource-derived event contract', async () => {
  const cases = [
    ['pages/api/base-meetings/notify.js', 'base_meeting_reported'],
    ['pages/api/tours/notify.js', 'tour_created'],
  ];
  for (const [path, eventType] of cases) {
    const source = await read(path);
    assert.match(source, /enqueueNotificationEvent/);
    assert.match(source, new RegExp(`eventType:\\s*['"]${eventType}['"]`));
    assert.doesNotMatch(source, /enqueue_(?:interaction|base_meeting|tour)_notification/);
    assert.doesNotMatch(source, /p_(?:display_amount|title|body|recipient)/i);
  }
  const interaction = await read('pages/api/interactions/notify.js');
  assert.match(interaction, /enqueueInteractionNotification/);
  assert.doesNotMatch(interaction, /eventType:\s*['"]interaction_created['"]/);
  assert.doesNotMatch(interaction, /amount\s*:/i);
});

test('interaction notification kinds map to distinct opaque RPC events', async () => {
  const calls = [];
  const context = {
    ...makeContext(activistA),
    db: {
      from(table) {
        assert.equal(table, 'interactions');
        const result = { data: { id: 42, project_id: PROJECT_A }, error: null };
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => result,
        };
        return query;
      },
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: DELIVERY_ID, error: null };
      },
    },
  };
  for (const kind of ['summary', 'self_payment', 'payment']) {
    await enqueueInteractionNotification(context, { interactionId: 42, kind }, {
      dispatch: async () => ({ queued: 1 }),
    });
  }
  assert.deepEqual(calls, [
    ['app_enqueue_notification_event', {
      p_event_type: 'interaction_summary', p_resource_id: '42', p_project_id: PROJECT_A,
    }],
    ['app_enqueue_notification_event', {
      p_event_type: 'interaction_self_payment', p_resource_id: '42', p_project_id: PROJECT_A,
    }],
    ['app_enqueue_notification_event', {
      p_event_type: 'interaction_payment', p_resource_id: '42', p_project_id: PROJECT_A,
    }],
  ]);
});

test('I3 migration inventories and drops legacy routines before installing an opaque outbox', async () => {
  const sql = await read('migrations/0023_notifications_security.sql');
  for (const routine of [
    'enqueue_interaction_notification',
    'enqueue_base_meeting_notification',
    'enqueue_tour_notification',
    'app_notification_recipients',
  ]) {
    assert.match(sql, new RegExp(`'${routine}'`, 'i'));
  }
  assert.match(sql, /from pg_proc/i);
  assert.match(sql, /revoke all on function/i);
  assert.match(sql, /drop function/i);
  assert.match(sql, /create table if not exists app_private\.notification_delivery_outbox/i);
  assert.match(sql, /create or replace function public\.app_enqueue_notification_event[\s\S]*?returns uuid/i);
  assert.match(sql, /v_is_service boolean := coalesce\(auth\.role\(\) = 'service_role', false\)/i);
  assert.match(sql, /if not coalesce\(v_allowed, false\) then/i);
  assert.match(sql, /app_private\.interaction_payment_fact\(p_resource_id,\s*v_actor\)/i);
  assert.match(sql, /p_event_type in \('interaction_self_payment','interaction_payment'\)[\s\S]*v_payment_payable/i);
  assert.match(sql, /p_event_type = 'interaction_self_payment' or v_payment_amount > 0/i);
  assert.match(sql, /interaction_summary','interaction_payment'[\s\S]*pm\.role in \('head','coord'\)/i);
  const financeSql = await read('migrations/0024_finance_security.sql');
  assert.match(financeSql, /create or replace function app_private\.interaction_payment_fact\([\s\S]*?p_interaction_id text,[\s\S]*?p_actor uuid/i);
  assert.match(financeSql, /order by base_amount desc,\s*i\.date asc nulls last,\s*i\.id::text asc/i);
  assert.match(sql, /create or replace function public\.app_claim_notification_delivery/i);
  assert.match(sql, /coalesce\(auth\.role\(\), ''\)\s*<>\s*'service_role'/i);
  assert.match(sql, /grant execute on function public\.app_claim_notification_delivery\(uuid\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.app_claim_notification_delivery\(uuid\) to authenticated/i);
});

test('I3 user enqueue passes only an opaque delivery ID into server dispatch', async () => {
  const rpcCalls = [];
  const dispatched = [];
  const context = {
    ...makeContext(activistA),
    db: {
      rpc: async (name, args) => {
        rpcCalls.push([name, args]);
        return { data: DELIVERY_ID, error: null };
      },
    },
  };
  const result = await enqueueNotificationEvent(
    context,
    { eventType: 'self_test', resourceId: activistA.userId },
    { dispatch: async (deliveryId) => {
      dispatched.push(deliveryId);
      return { queued: 1, sent: 2, web: 1, fcm: 1, devices: 2 };
    } },
  );
  assert.equal(rpcCalls[0][0], 'app_enqueue_notification_event');
  assert.deepEqual(dispatched, [DELIVERY_ID]);
  assert.deepEqual(result, { queued: 1, sent: 2, web: 1, fcm: 1, devices: 2 });
});

test('I3 delivery claim is service-only and adapters receive no notification content', async () => {
  const { dispatchNotificationDelivery } = await import('../../lib/security/notification-delivery.mjs');
  const sent = [];
  const serviceClient = {
    rpc: async (name, args) => {
      assert.equal(name, 'app_claim_notification_delivery');
      assert.deepEqual(args, { p_delivery_id: DELIVERY_ID });
      return {
        data: [
          { user_id: activistA.userId, priority: 'high' },
          { user_id: '00000000-0000-4000-8000-000000000002', priority: 'normal' },
        ],
        error: null,
      };
    },
  };
  const result = await dispatchNotificationDelivery(DELIVERY_ID, {
    serviceClient,
    sendWeb: async (_client, userId, options) => { sent.push(['web', userId, options]); return { sent: 1, devices: 1 }; },
    sendFcm: async (_client, userId, options) => { sent.push(['fcm', userId, options]); return { sent: 1 }; },
  });
  assert.equal(result.queued, 2);
  assert.equal(result.sent, 4);
  assert.deepEqual(sent[0][2], { priority: 'high' });
  assert.equal(JSON.stringify(sent).includes('title'), false);
  assert.equal(JSON.stringify(sent).includes('body'), false);
  assert.equal(JSON.stringify(sent).includes('url'), false);
});

test('I3 WebPush and FCM adapters construct the generic payload internally', async () => {
  const [web, fcm] = await Promise.all([read('lib/webPushSend.js'), read('lib/fcmAdmin.js')]);
  for (const source of [web, fcm]) {
    assert.match(source, /toPushPayload/);
    assert.match(source, /\{\s*priority\s*\}\s*=\s*\{\}/);
    assert.doesNotMatch(source, /\{\s*title\s*,\s*body\s*,\s*url\s*\}/);
  }
  assert.doesNotMatch(web, /JSON\.stringify\(payloadObj\)/);
  assert.doesNotMatch(fcm, /notification:\s*\{\s*title,\s*body\s*\}/);
});

test('I3 cron and sheet workflows enqueue service events without direct notification CRUD', async () => {
  const cases = [
    ['pages/api/cron/send-reminders.js', ['base_report_reminder', 'missing_report']],
    ['pages/api/cron/next-action-reminders.js', ['next_action_due']],
    ['pages/api/cron/tours-sheet-sync.js', ['tour_created', 'tour_sheet_sync']],
  ];
  for (const [path, events] of cases) {
    const source = await read(path);
    assert.match(source, /enqueueServiceNotificationEvent/);
    for (const event of events) assert.match(source, new RegExp(`['"]${event}['"]`));
    assert.doesNotMatch(source, /\.from\(['"]notifications['"]\)/);
    assert.doesNotMatch(source, /sendWebPushToActivist|sendFcmToActivist|notifyRecipients/);
  }
});

test('I3 service event set is not accepted by the browser notification schema', async () => {
  const { notificationEventSchema } = await import('../../lib/security/schemas.mjs');
  for (const eventType of ['base_report_reminder', 'missing_report', 'next_action_due', 'tour_sheet_sync']) {
    assert.equal(notificationEventSchema.safeParse({ eventType, resourceId: String(PROJECT_A) }).success, false);
  }
});

test('I3 rollback removes the claim routine and private outbox', async () => {
  const rollback = await read('migrations/rollback/0018-0024-pre-cutover.sql');
  assert.match(rollback, /revoke all on function public\.app_claim_notification_delivery\(uuid\)/i);
  assert.match(rollback, /drop function if exists public\.app_claim_notification_delivery\(uuid\)/i);
  assert.match(rollback, /drop table if exists app_private\.notification_delivery_outbox/i);
});
