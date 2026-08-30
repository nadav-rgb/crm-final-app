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
      /app_user_active\(\)|app_has_project_role\(/i,
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
