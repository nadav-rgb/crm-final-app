import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

function functionDefinition(sql, name) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
    'i',
  ));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test('0019 defines the active-membership helper before downstream callers use it', async () => {
  const [rls, rpcs, notifications] = await Promise.all([
    read('migrations/0019_security_rls.sql'),
    read('migrations/0020_security_rpcs.sql'),
    read('migrations/0023_notifications_security.sql'),
  ]);
  const helper = functionDefinition(rls, 'app_has_active_membership');

  assert.match(helper, /auth\.uid\(\)/i);
  assert.match(helper, /pm\.status\s*=\s*'active'/i);
  assert.match(helper, /p\.disabled_at\s+is\s+null/i);
  assert.match(helper, /security\s+definer/i);
  assert.match(helper, /set\s+search_path\s*=\s*pg_catalog,\s*public/i);
  assert.doesNotMatch(helper, /p_(?:user|actor|caller)(?:_id)?\b/i);
  assert.match(rls, /revoke all on function public\.app_has_active_membership\(integer\) from public, anon/i);
  assert.match(rls, /grant execute on function public\.app_has_active_membership\(integer\) to authenticated/i);
  assert.match(rpcs, /public\.app_has_active_membership\(p_project_id\)/i);
  assert.match(notifications, /public\.app_has_active_membership\(/i);
});

test('0019 removes broad reminder mutation and report-field update authority', async () => {
  const sql = await read('migrations/0019_security_rls.sql');

  assert.doesNotMatch(sql, /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+public\.meeting_reminders/i);
  assert.doesNotMatch(sql, /create\s+policy\s+meeting_reminders_(?:update|delete)\b/i);
  assert.doesNotMatch(sql, /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+public\.tours/i);
  assert.doesNotMatch(sql, /grant\s+update\s*\([^)]*(?:report|reported_by|reported_at)[^)]*\)\s+on\s+public\.tours/i);
});

test('0019 security-posture PL/pgSQL body closes before its dollar delimiter', async () => {
  const sql = await read('migrations/0019_security_rls.sql');
  const posture = functionDefinition(sql, 'app_security_posture');
  assert.match(posture, /\bend\s+\$\$;\s*$/i);
});

test('0021 exposes only a row-derived reminder-cancel boundary', async () => {
  const [sql, route] = await Promise.all([
    read('migrations/0021_meetings_security.sql'),
    read('pages/api/reminders/cancel.js'),
  ]);
  const fn = functionDefinition(sql, 'app_cancel_meeting_reminders');

  assert.match(fn, /auth\.uid\(\)/i);
  assert.match(fn, /from\s+public\.meeting_reminders/i);
  assert.match(fn, /for\s+update/i);
  assert.match(fn, /recipient_user_id/i);
  assert.match(fn, /project_id/i);
  assert.match(fn, /set\s+cancelled_at\s*=\s*now\(\)/i);
  assert.doesNotMatch(fn, /p_(?:recipient|project|actor|user)(?:_id)?\b/i);
  assert.doesNotMatch(fn, /\bset\s+(?:recipient_user_id|project_id)\s*=/i);
  assert.match(sql, /revoke all on function public\.app_cancel_meeting_reminders\(text\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.app_cancel_meeting_reminders\(text\) to authenticated/i);
  assert.match(route, /\.rpc\(['"]app_cancel_meeting_reminders['"]/);
  assert.doesNotMatch(route, /\.from\(['"]meeting_reminders['"]\)[\s\S]*?\.update\(/);
});

test('0022 report submission derives reporter and mutates only report fields', async () => {
  const [sql, domain] = await Promise.all([
    read('migrations/0022_tours_security.sql'),
    read('lib/security/domains/tours.mjs'),
  ]);
  const fn = functionDefinition(sql, 'app_submit_tour_report');

  assert.match(fn, /auth\.uid\(\)/i);
  assert.match(fn, /from\s+public\.tours/i);
  assert.match(fn, /for\s+update/i);
  assert.match(fn, /assigned_user_ids|guide_user_id|host_user_id/i);
  assert.match(fn, /reported_by_user_id\s*=\s*auth\.uid\(\)/i);
  assert.doesNotMatch(fn, /p_(?:project|reporter|reported_by|actor|user)(?:_id)?\b/i);
  assert.match(fn, /set\s+report\s*=\s*p_report[\s\S]*reported_at\s*=\s*now\(\)[\s\S]*status\s*=\s*'completed'/i);
  assert.match(sql, /revoke all on function public\.app_submit_tour_report\(text,jsonb\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.app_submit_tour_report\(text,jsonb\) to authenticated/i);
  assert.match(domain, /\.rpc\(['"]app_submit_tour_report['"]/);
});

test('0023 derives tenant and recipients from event-specific resources', async () => {
  const sql = await read('migrations/0023_notifications_security.sql');
  const fn = functionDefinition(sql, 'app_enqueue_notification_event');

  assert.match(sql, /duplicate push endpoints/i);
  assert.match(sql, /notification recipient mapping missing/i);
  assert.match(sql, /push subscription owner mapping missing/i);
  assert.match(sql, /fcm token owner mapping missing/i);
  assert.match(fn, /p_event_type\s+not\s+in/i);
  assert.match(fn, /select[\s\S]*project_id[\s\S]*from\s+public\.(?:meeting_houses|tours|interactions|base_meeting_reports|contacts)/i);
  assert.match(fn, /p_project_id\s+is\s+not\s+null[\s\S]*p_project_id\s*<>\s*v_project_id/i);
  assert.match(fn, /meeting_house_assigned[\s\S]*app_has_project_role/i);
  assert.match(fn, /tour_reported[\s\S]*(?:assigned_user_ids|guide_user_id|host_user_id)/i);
  assert.match(fn, /interaction_created[\s\S]*actor_user_id/i);
  assert.match(fn, /base_meeting_reported[\s\S]*actor_user_id/i);
  assert.match(fn, /mitzvot_updated[\s\S]*assigned_user_id/i);
  assert.doesNotMatch(fn, /p_(?:recipient|title|body|url)\b/i);
  assert.doesNotMatch(sql, /create\s+policy|alter\s+policy/i);
});

test('0024 finance summary narrows scope and returns only the approved projection', async () => {
  const sql = await read('migrations/0024_finance_security.sql');
  const fn = functionDefinition(sql, 'app_finance_summary');
  const cancelFn = functionDefinition(sql, 'app_cancel_bonus');

  assert.match(fn, /p_period\s+text[\s\S]*p_project_id\s+integer[\s\S]*p_user_id\s+uuid/i);
  assert.match(fn, /p_period\s*!~\s*'\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$'/i);
  for (const column of [
    'user_id', 'name', 'period', 'activity_total', 'bonus_total', 'tour_total',
    'expense_total', 'grand_total', 'activity_by_type', 'bonus_by_type', 'unpaid_by_reason',
  ]) {
    assert.match(fn, new RegExp(`\\b${column}\\b`, 'i'));
  }
  for (const forbidden of ['phone', 'notes', 'mitzvot_history', 'interaction_text', 'contact_name']) {
    assert.doesNotMatch(fn.match(/returns\s+table\s*\([\s\S]*?\)/i)?.[0] ?? '', new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
  assert.match(fn, /coalesce\(auth\.jwt\(\)\s*->>\s*'aal',[\s\S]*'aal2'/i);
  assert.match(fn, /pm\.role\s*=\s*'finance'/i);
  assert.match(fn, /pm\.role\s*=\s*'activist'/i);
  assert.match(fn, /from\s+public\.projects/i);
  assert.doesNotMatch(fn, /v_effective_projects\s*:=\s*array\s*\[\s*1\s*,\s*2\s*\]/i);
  assert.match(fn, /p_project_id[\s\S]*(?:any\s*\(v_effective_projects\)|unnest\(v_effective_projects\))/i);
  assert.match(fn, /p_user_id[\s\S]*active[\s\S]*project_memberships/i);
  assert.match(fn, /insert\s+into\s+app_private\.audit_events/i);
  assert.match(fn, /security\s+definer/i);
  assert.match(fn, /set\s+search_path\s*=\s*pg_catalog,\s*public,\s*app_private/i);
  assert.doesNotMatch(fn, /\bexecute\b|format\s*\(/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.expenses/i);
  assert.match(sql, /revoke all on function public\.app_finance_summary\(text,integer,uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.app_finance_summary\(text,integer,uuid\) to authenticated/i);

  assert.match(cancelFn, /auth\.uid\(\)/i);
  assert.match(cancelFn, /regexp_split_to_array\(p_bonus_key,\s*'\\\|'\)/i);
  assert.match(cancelFn, /from\s+public\.contacts[\s\S]*for\s+update/i);
  assert.match(cancelFn, /assigned_user_id[\s\S]*activist_id[\s\S]*project_id/i);
  assert.match(cancelFn, /pm\.role\s+in\s*\('head',\s*'coord'\)/i);
  assert.match(cancelFn, /global_role\s*=\s*'ceo'[\s\S]*'aal2'/i);
  assert.match(cancelFn, /'בונוס-לימוד-4'[\s\S]*'בונוס-לימוד-6'[\s\S]*'בונוס-מצוות'[\s\S]*'בונוס-חדש'/i);
  assert.match(cancelFn, /from\s+public\.interactions/i);
  assert.match(cancelFn, /jsonb_array_elements\(coalesce\(v_contact\.mitzvot_history/i);
  assert.match(cancelFn, /v_contact\.joined_at[\s\S]*v_contact\.source[\s\S]*v_contact\.referred_by/i);
  assert.match(cancelFn, /insert\s+into\s+public\.bonus_cancellations[\s\S]*bonus_key[\s\S]*beneficiary_user_id[\s\S]*cancelled_by_user_id/i);
  assert.doesNotMatch(cancelFn, /p_(?:project|beneficiary|activist|actor|cancelled_by|amount|desc)(?:_id)?\b/i);
  assert.match(sql, /revoke all on function public\.app_cancel_bonus\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.app_cancel_bonus\(text\) to authenticated/i);
});

test('official G5 chain and reverse rollback cover every migration exactly once', async () => {
  const [plan, readme, matrix, runbook, rollback] = await Promise.all([
    read('docs/superpowers/plans/2026-08-27-security-hardening.md'),
    read('migrations/README.md'),
    read('docs/security/SECURITY_TEST_MATRIX.md'),
    read('docs/security/STAGING_RUNBOOK.md'),
    read('migrations/rollback/0018-0024-pre-cutover.sql'),
  ]);
  const forward = /0018[\s\S]*0019[\s\S]*0020[\s\S]*0021[\s\S]*0022[\s\S]*0023[\s\S]*0024/i;
  const reverse = /0024[\s\S]*0023[\s\S]*0022[\s\S]*0021[\s\S]*0020[\s\S]*0019[\s\S]*0018/i;

  assert.match(plan, forward);
  assert.match(readme, forward);
  assert.match(runbook, forward);
  assert.match(rollback, reverse);
  assert.match(readme, /0021[\s\S]*single-apply[\s\S]*not fully idempotent/i);
  assert.match(readme, /0022[\s\S]*single-apply[\s\S]*not fully idempotent/i);
  assert.match(matrix, /direct JWT/i);
  assert.match(runbook, /cross-project|filter forgery/i);
  assert.match(rollback, /rollback refused:[\s\S]*(?:idempotency|cancelled_at)/i);
  assert.match(rollback, /rollback refused:[\s\S]*(?:reported_by_user_id|cancellation_reason)/i);
  assert.match(rollback, /drop function if exists public\.app_cancel_bonus\(text\)/i);
  assert.doesNotMatch(rollback, /\bcascade\b/i);
});
