import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

function triggerStatement(sql, triggerName) {
  return sql.match(new RegExp(`create\\s+trigger\\s+${triggerName}\\b[\\s\\S]*?;`, 'i'))?.[0] ?? '';
}

test('I2 legacy JSONB meeting assignments are normalized before array identity backfill', async () => {
  const sql = await read('migrations/0019_security_rls.sql');

  assert.match(sql, /table_name\s*=\s*'meeting_houses'[\s\S]*?column_name\s*=\s*'assigned_activists'[\s\S]*?udt_name\s*=\s*'jsonb'/i);
  assert.match(sql, /jsonb_typeof\(assigned_activists\)\s*<>\s*'array'/i);
  assert.match(sql, /security migration refused: meeting_houses assigned_activists must be a JSON array/i);
  assert.match(sql, /alter column assigned_activists type integer\[\]/i);
  assert.match(sql, /jsonb_array_elements_text/i);
});

test('I2 scalar compatibility trigger derives either side and rejects deliberate divergence', async () => {
  const sql = await read('migrations/0018_security_foundation.sql');
  const fn = sql.match(/create or replace function app_private\.sync_identity_pair\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';

  assert.match(fn, /returns trigger/i);
  assert.match(fn, /language plpgsql security definer/i);
  assert.match(fn, /set search_path = pg_catalog, public, app_private/i);
  assert.match(fn, /tg_op = 'UPDATE'/i);
  assert.match(fn, /to_jsonb\(old\)/i);
  assert.match(fn, /to_jsonb\(new\)/i);
  assert.match(fn, /jsonb_populate_record\(new/i);
  assert.match(fn, /from public\.profiles/i);
  assert.match(fn, /activist_code/i);
  assert.match(fn, /identity pair divergence/i);
  assert.match(fn, /errcode = '23514'/i);
  assert.match(
    fn,
    /not \(tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed\)/i,
    'a legacy-only update must replace the stale UUID instead of being rejected',
  );
  assert.match(
    fn,
    /not \(tg_op = 'UPDATE' and v_uuid_changed and not v_legacy_changed\)/i,
    'a UUID-only update must replace the stale legacy code instead of being rejected',
  );
  assert.doesNotMatch(fn, /current_setting|set_config|app\.[a-z_]*bypass/i);
  assert.match(sql, /revoke all on function app_private\.sync_identity_pair\(\) from public, anon, authenticated/i);
});

test('I2 every scalar UUID and legacy identity pair has a maintained trigger', async () => {
  const foundation = await read('migrations/0018_security_foundation.sql');
  const rls = await read('migrations/0019_security_rls.sql');
  const scalarPairs = [
    [foundation, 'contacts', 'sync_contacts_identity', 'assigned_user_id', 'activist_id'],
    [foundation, 'interactions', 'sync_interactions_identity', 'actor_user_id', 'activist_id'],
    [foundation, 'base_meeting_reports', 'sync_base_meeting_reports_identity', 'actor_user_id', 'activist_id'],
    [foundation, 'expenses', 'sync_expenses_identity', 'actor_user_id', 'activist_id'],
    [foundation, 'feedback_reports', 'sync_feedback_reports_identity', 'reporter_user_id', 'reporter_id'],
    [foundation, 'notifications', 'sync_notifications_identity', 'recipient_user_id', 'recipient_id'],
    [foundation, 'notification_reads', 'sync_notification_reads_identity', 'recipient_user_id', 'recipient_id'],
    [foundation, 'push_subscriptions', 'sync_push_subscriptions_identity', 'user_id', 'activist_id'],
    [foundation, 'fcm_tokens', 'sync_fcm_tokens_identity', 'user_id', 'activist_id'],
    [foundation, 'tours', 'sync_tours_guide_identity', 'guide_user_id', 'guide_activist_id'],
    [foundation, 'tours', 'sync_tours_host_identity', 'host_user_id', 'host_activist_id'],
    [rls, 'bonus_cancellations', 'sync_bonus_cancellations_identity', 'beneficiary_user_id', 'activist_id'],
    [rls, 'bonus_cancellations', 'sync_bonus_cancellations_actor_identity', 'cancelled_by_user_id', 'cancelled_by'],
  ];

  for (const [sql, table, triggerName, uuidColumn, legacyColumn] of scalarPairs) {
    const statement = triggerStatement(sql, triggerName);
    assert.match(statement, new RegExp(`before\\s+insert\\s+or\\s+update\\s+on\\s+public\\.${table}`, 'i'));
    assert.match(statement, new RegExp(`app_private\\.sync_identity_pair\\('${uuidColumn}',\\s*'${legacyColumn}'\\)`, 'i'));
  }

  const reminder = triggerStatement(foundation, 'sync_meeting_reminders_identity');
  assert.match(reminder, /before insert or update on public\.meeting_reminders/i);
  assert.match(reminder, /app_private\.sync_meeting_reminder_identity\(\)/i);
});

test('I2 assignment-array compatibility rejects nulls, duplicates, over-limit and mismatched sets', async () => {
  const foundation = await read('migrations/0018_security_foundation.sql');
  const rls = await read('migrations/0019_security_rls.sql');
  const fn = foundation.match(/create or replace function app_private\.sync_identity_array_pair\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';

  assert.match(fn, /jsonb_array_elements_text/i);
  assert.match(fn, /> 100/);
  assert.match(fn, /count\(distinct/i);
  assert.match(fn, /is null/i);
  assert.match(fn, /identity array divergence/i);
  assert.match(fn, /errcode = '23514'/i);
  assert.match(
    fn,
    /not \(tg_op = 'UPDATE' and v_uuid_changed <> v_legacy_changed\)/i,
    'a one-sided array update must dual-write rather than compare against the stale side',
  );
  assert.match(
    foundation,
    /create trigger sync_tours_identity[\s\S]*?execute function app_private\.sync_identity_array_pair\('assigned_user_ids',\s*'assigned_activists'\)/i,
  );
  assert.match(
    rls,
    /create trigger sync_meeting_houses_identity[\s\S]*?execute function app_private\.sync_identity_array_pair\('assigned_user_ids',\s*'assigned_activists'\)/i,
  );
});

test('I2 canonical production readers and writers use UUID identities', async () => {
  const [webPush, fcm, reminderCron, nextActionCron, tourSync, crmStore] = await Promise.all([
    read('lib/webPushSend.js'),
    read('lib/fcmAdmin.js'),
    read('pages/api/cron/send-reminders.js'),
    read('pages/api/cron/next-action-reminders.js'),
    read('pages/api/cron/tours-sheet-sync.js'),
    read('lib/CrmStore.jsx'),
  ]);

  for (const source of [webPush, fcm]) {
    assert.match(source, /\.eq\(['"]user_id['"],\s*userId\)/);
    assert.doesNotMatch(source, /\.eq\(['"]activist_id['"]/);
  }

  assert.match(reminderCron, /\.select\(['"]id,type,recipient_user_id,remind_at,sent['"]\)/);
  assert.match(reminderCron, /enqueueServiceNotificationEvent/);
  assert.doesNotMatch(reminderCron, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(reminderCron, /reminder\.(?:coordinator_id|activist_id)/);

  assert.match(nextActionCron, /\.select\(['"]id['"]\)/);
  assert.match(nextActionCron, /eventType:\s*['"]next_action_due['"]/);
  assert.doesNotMatch(nextActionCron, /c\.activist_id/);

  assert.match(tourSync, /\.select\(['"]id,name['"]\)/);
  assert.doesNotMatch(tourSync, /p\.activist_code/);
  for (const column of ['guide_user_id', 'host_user_id', 'assigned_user_ids']) {
    assert.match(tourSync, new RegExp(`${column}:`));
  }
  assert.doesNotMatch(tourSync, /guide_activist_id:\s*guide\.code|host_activist_id:\s*host\.code|assigned_activists:\s*\[\]/);

  assert.match(crmStore, /activist_id:\s*contact\.activistCode/);
  assert.doesNotMatch(crmStore, /activist_id:\s*contact\.assignedUserId/);
});

test('I2 rollback removes every compatibility trigger, constraint and function before UUID columns', async () => {
  const rollback = await read('migrations/rollback/0018-0024-pre-cutover.sql');
  const triggerTables = [
    'contacts', 'interactions', 'base_meeting_reports', 'expenses', 'feedback_reports',
    'notifications', 'notification_reads', 'meeting_reminders', 'push_subscriptions',
    'fcm_tokens', 'tours', 'meeting_houses', 'bonus_cancellations',
  ];
  for (const table of triggerTables) {
    assert.match(rollback, new RegExp(`drop trigger if exists sync_${table}_identity on public\\.${table}`, 'i'));
  }
  assert.match(rollback, /drop function if exists app_private\.sync_meeting_reminder_identity\(\)/i);
  assert.match(rollback, /drop function if exists app_private\.sync_identity_array_pair\(\)/i);
  assert.match(rollback, /drop function if exists app_private\.sync_identity_pair\(\)/i);
  assert.match(rollback, /drop constraint if exists contacts_identity_pair_chk/i);
  assert.ok(
    rollback.indexOf('drop trigger if exists sync_contacts_identity')
      < rollback.indexOf('drop column if exists assigned_user_id'),
    'compatibility objects must be removed before UUID columns',
  );
});
