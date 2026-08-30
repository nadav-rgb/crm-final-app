import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertSafeTestTarget } from '../../scripts/security/verify-rls-live.mjs';

const migrationPath = 'migrations/0019_security_rls.sql';
const sensitiveTables = [
  'projects',
  'project_memberships',
  'profiles',
  'contacts',
  'interactions',
  'base_meeting_reports',
  'meeting_houses',
  'meeting_reminders',
  'tours',
  'expenses',
  'bonus_cancellations',
  'payment_config',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'fcm_tokens',
  'feedback_reports',
];

function policyDefinition(sql, policyName) {
  const match = sql.match(new RegExp(`create policy ${policyName}\\b[\\s\\S]*?;`, 'i'));
  assert.ok(match, `missing policy ${policyName}`);
  return match[0];
}

test('RLS migration forces row security for every sensitive table', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const table of sensitiveTables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.doesNotMatch(sql, /authenticated_all/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test('RLS migration locks helpers, views and audit storage', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /set search_path = pg_catalog, public/i);
  assert.match(sql, /revoke all on function public\.app_has_project_role\(integer,text\[\]\) from public, anon/i);
  assert.match(sql, /alter view public\.activist_directory set \(security_invoker = on\)/i);
  assert.match(sql, /grant execute on function public\.app_security_posture\(\) to service_role/i);
  assert.match(sql, /revoke all on all tables in schema app_private from public, anon, authenticated/i);
});

test('RLS migration attaches atomic redacted audit triggers to sensitive mutations', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /create or replace function app_private\.audit_row_change\(\)/i);
  assert.match(sql, /jsonb_build_object\('changedFields', v_changed_fields\)/i);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*(password|token|phone|notes)/i);
  for (const table of ['contacts', 'interactions', 'project_memberships', 'tours', 'feedback_reports']) {
    assert.match(sql, new RegExp(`create trigger audit_${table}_changes`, 'i'));
  }
});

test('self-service policies require active authorization and limit mutable columns', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  for (const policyName of [
    'projects_select',
    'project_memberships_select',
    'profiles_select',
    'interactions_delete',
    'base_meeting_reports_update',
    'expenses_update',
    'notifications_select',
    'notifications_update',
    'notifications_delete',
    'notification_reads_select',
    'push_subscriptions_select',
    'fcm_tokens_select',
    'feedback_reports_select',
  ]) {
    const definition = policyDefinition(sql, policyName);
    assert.match(
      definition,
      /app_user_active\(\)|app_has_project_role\(|app_is_ceo\(\)/i,
      `${policyName} must not authorize a stale or disabled identity`,
    );
  }

  assert.match(sql, /grant select, delete on public\.notifications to authenticated/i);
  assert.match(sql, /grant update \(read\) on public\.notifications to authenticated/i);
  assert.doesNotMatch(sql, /grant select, update, delete on public\.notifications/i);

  for (const policyName of ['meeting_houses_update', 'tours_update']) {
    const definition = policyDefinition(sql, policyName);
    assert.doesNotMatch(
      definition,
      /assigned_user_ids|guide_user_id|host_user_id/i,
      `${policyName} must not expose broad direct-row updates to assigned users`,
    );
  }
});

test('C1 direct grants cannot transfer authority or bypass protected workflows', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const rpcSql = await readFile('migrations/0020_security_rpcs.sql', 'utf8');
  const meetingSql = await readFile('migrations/0021_meetings_security.sql', 'utf8');
  const tourSql = await readFile('migrations/0022_tours_security.sql', 'utf8');
  const rollbackSql = await readFile('migrations/rollback/0018-0024-pre-cutover.sql', 'utf8');

  for (const table of [
    'contacts', 'interactions', 'base_meeting_reports', 'meeting_houses',
    'tours', 'expenses', 'feedback_reports',
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`grant\\s+(?:select\\s*,\\s*)?(?:insert\\s*,\\s*)?update(?:\\s*,\\s*delete)?\\s+on\\s+public\\.${table}\\s+to\\s+authenticated`, 'i'),
      `${table} must not retain table-wide authenticated UPDATE`,
    );
  }

  assert.match(sql, /create or replace function app_private\.enforce_immutable_columns\(\)/i);
  const immutableFunction = sql.match(
    /create or replace function app_private\.enforce_immutable_columns\(\)[\s\S]*?\$\$;/i,
  )?.[0] ?? '';
  assert.match(immutableFunction, /current_user\s+not\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i);
  assert.doesNotMatch(immutableFunction, /current_setting|set_config/i, 'caller-settable GUC must not bypass immutability');
  const immutableAuthority = new Map([
    ['contacts', ['project_id', 'assigned_user_id', 'activist_id']],
    ['interactions', ['project_id', 'contact_id', 'actor_user_id', 'activist_id']],
    ['base_meeting_reports', ['project_id', 'actor_user_id', 'activist_id']],
    ['meeting_houses', ['project_id', 'assigned_user_ids', 'assigned_activists', 'status']],
    ['meeting_reminders', ['project_id', 'recipient_user_id', 'coordinator_id', 'activist_id', 'cancelled_at']],
    ['tours', [
      'project_id', 'guide_user_id', 'host_user_id', 'assigned_user_ids',
      'guide_activist_id', 'host_activist_id', 'assigned_activists', 'status',
      'report', 'reported_by_user_id', 'reported_at', 'cancellation_reason',
    ]],
    ['expenses', ['project_id', 'actor_user_id', 'activist_id']],
    ['bonus_cancellations', [
      'project_id', 'beneficiary_user_id', 'cancelled_by_user_id',
      'activist_id', 'cancelled_by', 'bonus_key',
    ]],
    ['notifications', ['recipient_user_id', 'recipient_id']],
    ['notification_reads', ['recipient_user_id', 'recipient_id', 'notification_id']],
    ['push_subscriptions', ['user_id', 'activist_id']],
    ['fcm_tokens', ['user_id', 'activist_id']],
    ['feedback_reports', ['project_id', 'reporter_user_id', 'reporter_id', 'status', 'reviewed_at']],
  ]);
  for (const [table, fields] of immutableAuthority) {
    const trigger = sql.match(new RegExp(
      `create trigger enforce_${table}_immutable_authority[\\s\\S]*?;`, 'i',
    ))?.[0];
    assert.ok(trigger, `missing immutable-authority trigger for ${table}`);
    for (const field of fields) assert.match(trigger, new RegExp(`'${field}'`, 'i'));
  }

  for (const [policyName, forbiddenRoles] of [
    ['interactions_delete', ['activist']],
    ['expenses_delete', ['activist']],
    ['bonus_cancellations_delete', ['head', 'coord']],
  ]) {
    const definition = policyDefinition(sql, policyName);
    for (const role of forbiddenRoles) {
      assert.doesNotMatch(definition, new RegExp(`'${role}'`, 'i'), `${policyName} exposes unsafe ${role} delete`);
    }
  }

  for (const functionName of [
    'app_reassign_contact', 'app_soft_delete_contact', 'app_delete_interaction',
    'app_link_contact_tour', 'app_delete_expense', 'app_review_feedback',
  ]) {
    assert.match(rpcSql, new RegExp(`create or replace function public\\.${functionName}\\b`, 'i'));
  }
  assert.match(meetingSql, /create or replace function public\.app_assign_meeting_house\b/i);
  for (const functionName of ['app_assign_tour', 'app_cancel_tour', 'app_delete_tour']) {
    assert.match(tourSql, new RegExp(`create or replace function public\\.${functionName}\\b`, 'i'));
  }
  for (const functionName of [
    'app_reassign_contact', 'app_soft_delete_contact', 'app_link_contact_tour', 'app_delete_interaction',
    'app_delete_expense', 'app_review_feedback', 'app_assign_meeting_house',
    'app_assign_tour', 'app_cancel_tour', 'app_delete_tour',
  ]) {
    assert.match(
      rollbackSql,
      new RegExp(`drop function if exists public\\.${functionName}\\b`, 'i'),
      `rollback must remove ${functionName}`,
    );
  }
  assert.match(rollbackSql, /drop function if exists app_private\.enforce_immutable_columns\(\)/i);
  for (const table of immutableAuthority.keys()) {
    assert.match(
      rollbackSql,
      new RegExp(`drop trigger if exists enforce_${table}_immutable_authority on public\\.${table}`, 'i'),
      `rollback must remove ${table} immutable-authority trigger`,
    );
  }
});

test('pre-cutover rollback removes RLS policies before dependent helpers', async () => {
  const rollback = await readFile('migrations/rollback/0018-0024-pre-cutover.sql', 'utf8');
  const policyCleanup = rollback.search(/select tablename, policyname from pg_policies/i);
  const helperDrop = rollback.search(/drop function if exists public\.app_has_project_role/i);

  assert.ok(policyCleanup >= 0, 'rollback must explicitly remove the hardened policy set');
  assert.ok(helperDrop >= 0, 'rollback must remove the hardened authorization helpers');
  assert.ok(policyCleanup < helperDrop, 'policies must be removed before their helper dependencies');
  assert.doesNotMatch(rollback, /\bcascade\b/i);
});

test('live verifier refuses an unconfirmed or production target', () => {
  assert.throws(
    () => assertSafeTestTarget({ targetUrl: 'https://test.supabase.co', productionUrl: 'https://prod.supabase.co', confirmed: false }),
    /isolated test target confirmation required/,
  );
  assert.throws(
    () => assertSafeTestTarget({
      targetUrl: 'https://prod.supabase.co',
      productionUrl: 'https://prod.supabase.co',
      confirmed: true,
      expectedProjectId: 'mekarvim-security-g5-production-refusal',
      expectedApiPort: 54321,
    }),
    /refused production target/,
  );
});
