import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { toPaymentConfigDto } from '../../lib/security/domains/finance.mjs';
import { assertSafeTestTarget } from './verify-rls-live.mjs';

const require = createRequire(import.meta.url);
const { calcMonthlyPayment, deriveMitzvotBonuses, deriveToraniBonuses } = require('../../lib/paymentCalc.js');

export const MIGRATION_SEQUENCE = Object.freeze([
  '0018', '0019', '0020', '0021', '0022', '0023', '0024',
]);

const MIGRATIONS = Object.freeze({
  '0018': 'migrations/0018_security_foundation.sql',
  '0019': 'migrations/0019_security_rls.sql',
  '0020': 'migrations/0020_security_rpcs.sql',
  '0021': 'migrations/0021_meetings_security.sql',
  '0022': 'migrations/0022_tours_security.sql',
  '0023': 'migrations/0023_notifications_security.sql',
  '0024': 'migrations/0024_finance_security.sql',
});

function migrationCheck(id, name, sql) {
  return Object.freeze({ id: `${id}-${name}`, sql, expected: 'pass' });
}

const MIGRATION_VERIFICATIONS = Object.freeze({
  '0018': Object.freeze([
    migrationCheck('0018', 'private-schema-revoked', `select case when to_regnamespace('app_private') is not null
      and not has_schema_privilege('anon','app_private','usage')
      and not has_schema_privilege('authenticated','app_private','usage')
      then 'pass' else 'fail' end`),
    migrationCheck('0018', 'owner-backfills-complete', `select case when
      not exists (select 1 from public.contacts where assigned_user_id is null)
      and not exists (select 1 from public.interactions where actor_user_id is null)
      and not exists (select 1 from public.expenses where actor_user_id is null)
      and not exists (select 1 from public.notifications where recipient_user_id is null)
      then 'pass' else 'fail' end`),
    migrationCheck('0018', 'identity-map-unique', `select case when
      (select count(*) from public.profiles where activist_code is not null)
        = (select count(distinct activist_code) from public.profiles where activist_code is not null)
      and not exists (select 1 from public.project_memberships where user_id is null or project_id is null)
      then 'pass' else 'fail' end`),
  ]),
  '0019': Object.freeze([
    migrationCheck('0019', 'all-sensitive-tables-force-rls', `select case when not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any(array['projects','project_memberships','profiles','contacts','interactions','base_meeting_reports','meeting_houses','meeting_reminders','tours','expenses','bonus_cancellations','payment_config','notifications','notification_reads','push_subscriptions','fcm_tokens','feedback_reports'])
      and (not c.relrowsecurity or not c.relforcerowsecurity)) then 'pass' else 'fail' end`),
    migrationCheck('0019', 'grants-exact', `select case when not exists (
      select 1 from information_schema.role_table_grants where table_schema='app_private'
      and grantee in ('anon','authenticated')) then 'pass' else 'fail' end`),
    migrationCheck('0019', 'audit-triggers-redacted', `select case when
      to_regprocedure('app_private.audit_row_change()') is not null
      and (select count(*) from pg_trigger where tgname like 'audit_%_changes' and not tgisinternal) >= 16
      then 'pass' else 'fail' end`),
    migrationCheck('0019', 'posture-callable', `select case when
      (select count(*) from public.app_security_posture()) = 17
      then 'pass' else 'fail' end`),
  ]),
  '0020': Object.freeze([
    migrationCheck('0020', 'rpc-dependencies-resolve', `select case when
      to_regprocedure('public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,boolean,text,timestamptz,integer,timestamptz,timestamptz)') is not null
      and to_regprocedure('public.app_rate_limit_consume(text,integer,integer)') is not null
      then 'pass' else 'fail' end`),
    migrationCheck('0020', 'search-paths-fixed', `select case when not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'app_%'
      and not coalesce(p.proconfig,'{}') && array['search_path=pg_catalog, public','search_path=pg_catalog, public, app_private'])
      then 'pass' else 'fail' end`),
    migrationCheck('0020', 'rpc-grants-exact', `select case when
      has_function_privilege('service_role','public.app_session_load(text)','execute')
      and not has_function_privilege('authenticated','public.app_session_load(text)','execute')
      then 'pass' else 'fail' end`),
  ]),
  '0021': Object.freeze([
    migrationCheck('0021', 'reminder-format-constraint', `select case when
      exists (select 1 from pg_constraint where conname='meeting_reminders_idempotency_format_chk')
      then 'pass' else 'fail' end`),
    migrationCheck('0021', 'cancel-rpc-narrows-authority', `select case when
      to_regprocedure('public.app_cancel_meeting_reminders(text)') is not null
      and has_function_privilege('authenticated','public.app_cancel_meeting_reminders(text)','execute')
      then 'pass' else 'fail' end`),
    migrationCheck('0021', 'no-broad-row-mutation', `select case when
      not has_column_privilege('authenticated','public.meeting_reminders','cancelled_at','update')
      then 'pass' else 'fail' end`),
  ]),
  '0022': Object.freeze([
    migrationCheck('0022', 'tour-report-constraints', `select case when
      exists (select 1 from pg_constraint where conname='tours_status_security_chk')
      and exists (select 1 from pg_constraint where conname='tours_cancellation_reason_len_chk')
      then 'pass' else 'fail' end`),
    migrationCheck('0022', 'report-rpc-derives-actor', `select case when
      to_regprocedure('public.app_submit_tour_report(text,jsonb)') is not null
      then 'pass' else 'fail' end`),
    migrationCheck('0022', 'report-columns-not-broadly-granted', `select case when
      not has_column_privilege('authenticated','public.tours','reported_by_user_id','update')
      then 'pass' else 'fail' end`),
  ]),
  '0023': Object.freeze([
    migrationCheck('0023', 'uuid-ownership-complete', `select case when
      not exists (select 1 from public.notifications where recipient_user_id is null)
      and not exists (select 1 from public.push_subscriptions where user_id is null)
      and not exists (select 1 from public.fcm_tokens where user_id is null)
      then 'pass' else 'fail' end`),
    migrationCheck('0023', 'endpoint-unique', `select case when
      to_regclass('public.push_subscriptions_endpoint_uq') is not null
      then 'pass' else 'fail' end`),
    migrationCheck('0023', 'event-authority-resource-derived', `select case when
      to_regprocedure('public.app_enqueue_notification_event(text,text,integer)') is not null
      and has_function_privilege('authenticated','public.app_enqueue_notification_event(text,text,integer)','execute')
      then 'pass' else 'fail' end`),
  ]),
  '0024': Object.freeze([
    migrationCheck('0024', 'finance-scope-narrows-only', `select case when
      to_regprocedure('public.app_finance_summary(text,integer,uuid)') is not null
      and has_function_privilege('authenticated','public.app_finance_summary(text,integer,uuid)','execute')
      then 'pass' else 'fail' end`),
    migrationCheck('0024', 'projection-allowlisted', `select case when
      pg_get_function_result('public.app_finance_summary(text,integer,uuid)'::regprocedure)
      = 'TABLE(user_id uuid, name text, period text, activity_total numeric, bonus_total numeric, tour_total numeric, expense_total numeric, grand_total numeric, activity_by_type jsonb, bonus_by_type jsonb, unpaid_by_reason jsonb)'
      then 'pass' else 'fail' end`),
    migrationCheck('0024', 'audit-atomic-and-redacted', `select case when
      position('insert into app_private.audit_events' in lower(pg_get_functiondef('public.app_finance_summary(text,integer,uuid)'::regprocedure))) > 0
      and position('rowcount' in lower(pg_get_functiondef('public.app_finance_summary(text,integer,uuid)'::regprocedure))) > 0
      then 'pass' else 'fail' end`),
  ]),
});

const CLEANUP_TABLES = new Set([
  'notification_reads', 'notifications', 'push_subscriptions', 'fcm_tokens',
  'meeting_reminders', 'base_meeting_reports', 'interactions', 'expenses',
  'bonus_cancellations', 'feedback_reports', 'tours', 'meeting_houses', 'contacts',
  'payment_config', 'projects',
]);
const CLEANUP_RESOURCES = [...CLEANUP_TABLES].filter((table) => table !== 'projects');

const EVIDENCE_KEYS = Object.freeze([
  'caseId', 'actorClass', 'resourceClass', 'blockingLayer',
  'expectedStatus', 'actualStatus',
]);
const STATUS = /^(?:allowed|denied|pass|fail|skipped|blocked|2\d\d|4\d\d|5\d\d)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR_CLASSES = new Set([
  'anonymous', 'ceo-aal1', 'ceo-aal2', 'head-aal1', 'head-aal2',
  'coordinator', 'activist', 'finance', 'disabled-user', 'stale-session', 'system',
]);
const RESOURCE_CLASSES = new Set([
  'contact', 'interaction', 'meeting-reminder', 'tour', 'notification',
  'finance-summary', 'session', 'audit', 'security-posture', 'membership',
  'project', 'profile', 'directory', 'meeting-report', 'meeting-house',
  'payment-config', 'notification-read', 'push-subscription', 'fcm-token',
  'feedback-report', 'expense', 'bonus-cancellation', 'authority-transfer',
  'http', 'auth-user',
]);
const BLOCKING_LAYERS = new Set([
  'RLS', 'PostgREST', 'RPC', 'Grant', 'BFF', 'Session', 'CSRF',
  'RateLimit', 'MFA', 'PostgreSQL', 'HTTP',
]);

export function createSecurityRunId() {
  return randomUUID();
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(value ?? '').toUpperCase().replaceAll('=', '').replace(/[^A-Z2-7]/g, '');
  if (!normalized) throw new Error('invalid TOTP secret encoding');
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('invalid TOTP secret encoding');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

export function buildMigrationPlan(schemaFixture) {
  if (schemaFixture !== 'tests/security/fixtures/legacy-security-schema.sql') {
    throw new Error('migration plan refused: unexpected legacy schema fixture');
  }
  return MIGRATION_SEQUENCE.map((id) => Object.freeze({
    id,
    file: MIGRATIONS[id],
    stopOnFailure: true,
    verifications: [...MIGRATION_VERIFICATIONS[id]],
  }));
}

export function buildSyntheticFixtureBlueprint(securityRunId) {
  if (!UUID.test(securityRunId)) {
    throw new Error('fixture plan refused: invalid security run id');
  }
  return Object.freeze({
    securityRunId,
    projects: Object.freeze([{ alias: 'projectA' }, { alias: 'projectB' }]),
    actors: Object.freeze([
      { alias: 'ceo', role: 'ceo', aal: 2 },
      { alias: 'headA', role: 'head', project: 'projectA', aal: 2 },
      { alias: 'headB', role: 'head', project: 'projectB', aal: 2 },
      { alias: 'coordA', role: 'coord', project: 'projectA', aal: 1 },
      { alias: 'activistA1', role: 'activist', project: 'projectA', aal: 1 },
      { alias: 'activistA2', role: 'activist', project: 'projectA', aal: 1 },
      { alias: 'activistB1', role: 'activist', project: 'projectB', aal: 1 },
      { alias: 'financeA', role: 'finance', project: 'projectA', aal: 1 },
      { alias: 'disabled', role: 'activist', project: 'projectA', state: 'disabled', aal: 1 },
      { alias: 'staleSecurityVersion', role: 'activist', project: 'projectA', state: 'stale', aal: 1 },
      // Exists only as a valid auth.users FK target for an attempted direct-JWT
      // profile insert. It deliberately has no profile or membership row.
      { alias: 'unlinked', role: 'none', aal: 1 },
    ]),
    resources: Object.freeze([
      'contacts', 'interactions', 'meetingHouses', 'meetingReminders', 'tours',
      'notifications', 'expenses', 'bonusCancellations', 'paymentConfig',
    ]),
  });
}

export function buildLegacyFixtureRows(runId, actorIds) {
  if (!UUID.test(runId ?? '')) throw new Error('legacy fixture refused: invalid security run id');
  const requiredActors = [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion',
  ];
  if (requiredActors.some((alias) => !UUID.test(actorIds?.[alias] ?? ''))) {
    throw new Error('legacy fixture refused: synthetic actor map is incomplete');
  }

  const projectA = 1;
  const projectB = 2;
  const codes = Object.freeze({
    headA: 1001, headB: 1002, coordA: 1003, financeA: 1004,
    activistA1: 1101, activistA2: 1102, activistB1: 1201,
    disabled: 1103, staleSecurityVersion: 1104,
  });
  const profile = (alias, role, projectId = null) => ({
    id: actorIds[alias],
    name: `Synthetic ${alias}`,
    role,
    project_id: projectId,
    project_ids: projectId ? [projectId] : [],
    activist_code: codes[alias] ?? null,
    security_run_id: runId,
  });
  const contactA = 910001;
  const contactA2 = 910002;
  const contactB = 910003;
  const contactFriendlyExpired = 910004;
  const contactToraniTransition = 910005;
  const contactFriendlyCap = 910006;
  const contactToraniStreak = 910007;
  const contactCancelledStreak = 910008;
  const contactShort = 910009;
  const meetingA = `security-${runId}-meeting-a`;
  const meetingB = `security-${runId}-meeting-b`;
  const tourA = `security-${runId}-tour-a`;
  const tourB = `security-${runId}-tour-b`;
  const tourReportA = `security-${runId}-tour-report-a`;

  return Object.freeze({
    projects: [
      { id: projectA, name: 'Synthetic Project A', security_run_id: runId },
      { id: projectB, name: 'Synthetic Project B', security_run_id: runId },
    ],
    profiles: [
      profile('ceo', 'ceo'),
      profile('headA', 'head', projectA),
      profile('headB', 'head', projectB),
      profile('coordA', 'coord', projectA),
      profile('activistA1', 'activist', projectA),
      profile('activistA2', 'activist', projectA),
      profile('activistB1', 'activist', projectB),
      profile('financeA', 'finance', projectA),
      profile('disabled', 'activist', projectA),
      profile('staleSecurityVersion', 'activist', projectA),
    ],
    contacts: [
      {
        id: contactA, project_id: projectA, activist_id: codes.activistA1,
        name: 'Synthetic Contact A1', high_potential: true,
        mitzvot_history: [
          { mitzva: 'synthetic', from: 0, to: 1, date: '2026-08-10' },
          { mitzva: 'synthetic', from: 1, to: 3, date: '2026-08-20' },
        ],
        joined_at: '2026-08-02', source: 'external', security_run_id: runId,
      },
      {
        id: contactA2, project_id: projectA, activist_id: codes.activistA2,
        name: 'Synthetic Contact A2', high_potential: false,
        mitzvot_history: [], joined_at: '2026-08-03', source: 'internal', security_run_id: runId,
      },
      {
        id: contactB, project_id: projectB, activist_id: codes.activistB1,
        name: 'Synthetic Contact B1', high_potential: false,
        mitzvot_history: [], joined_at: '2026-08-04', source: 'internal', security_run_id: runId,
      },
      ...[
        [contactFriendlyExpired, '2026-05-01'],
        [contactToraniTransition, '2026-07-01'],
        [contactFriendlyCap, '2026-08-01'],
        [contactToraniStreak, '2026-06-01'],
        [contactCancelledStreak, '2026-06-01'],
        [contactShort, '2026-08-01'],
      ].map(([id, joined_at]) => ({
        id, project_id: projectA, activist_id: codes.activistA1,
        name: `Synthetic Finance Contact ${id}`, high_potential: false,
        mitzvot_history: [], joined_at, source: 'internal', security_run_id: runId,
      })),
    ],
    interactions: [
      {
        id: 920001, contact_id: contactA, project_id: projectA,
        activist_id: codes.activistA1, type: 'טלפוני', quality: 'ידידותי',
        duration_minutes: 20, date: '2026-08-05', participants: {}, security_run_id: runId,
      },
      {
        id: 920002, contact_id: contactA2, project_id: projectA,
        activist_id: codes.activistA2, type: 'פרונטלי', quality: 'תורני',
        duration_minutes: 45, date: '2026-08-06', participants: {}, security_run_id: runId,
      },
      {
        id: 920003, contact_id: contactB, project_id: projectB,
        activist_id: codes.activistB1, type: 'וידאו', quality: 'ידידותי',
        duration_minutes: 30, date: '2026-08-07', participants: {}, security_run_id: runId,
      },
      ...[
        [920004, contactFriendlyExpired, 'וידאו', 'ידידותי', '2026-08-04'],
        [920005, contactToraniTransition, 'וידאו', 'תורני', '2026-08-15'],
        [920006, contactToraniTransition, 'טלפוני', 'ידידותי', '2026-08-16'],
        [920007, contactFriendlyCap, 'פרונטלי', 'ידידותי', '2026-08-01'],
        [920008, contactFriendlyCap, 'פרונטלי', 'ידידותי', '2026-08-02'],
        [920009, contactFriendlyCap, 'פרונטלי', 'ידידותי', '2026-08-03'],
        [920010, contactToraniStreak, 'טלפוני', 'תורני', '2026-06-10'],
        [920011, contactToraniStreak, 'וידאו', 'תורני', '2026-07-10'],
        [920012, contactToraniStreak, 'טלפוני', 'תורני', '2026-08-10'],
        [920013, contactCancelledStreak, 'טלפוני', 'תורני', '2026-06-11'],
        [920014, contactCancelledStreak, 'וידאו', 'תורני', '2026-07-11'],
        [920015, contactCancelledStreak, 'וידאו', 'תורני', '2026-08-11'],
        [920016, contactShort, 'קצרצר', 'ידידותי', '2026-08-05'],
      ].map(([id, contact_id, type, quality, date]) => ({
        id, contact_id, project_id: projectA, activist_id: codes.activistA1,
        type, quality, duration_minutes: 20, date, participants: {}, security_run_id: runId,
      })),
    ],
    base_meeting_reports: [
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA1, security_run_id: runId },
      { id: randomUUID(), project_id: projectB, activist_id: codes.activistB1, security_run_id: runId },
    ],
    meeting_houses: [
      { id: meetingA, project_id: projectA, assigned_activists: [codes.activistA1], security_run_id: runId },
      { id: meetingB, project_id: projectB, assigned_activists: [codes.activistB1], security_run_id: runId },
    ],
    meeting_reminders: [
      {
        id: randomUUID(), meeting_id: meetingA, type: 'activist', coordinator_id: null,
        activist_id: String(codes.activistA1), remind_at: '2026-08-15T10:00:00Z', security_run_id: runId,
      },
      {
        id: randomUUID(), meeting_id: meetingB, type: 'activist', coordinator_id: null,
        activist_id: String(codes.activistB1), remind_at: '2026-08-15T11:00:00Z', security_run_id: runId,
      },
    ],
    tours: [
      {
        id: tourA, project_id: projectA, tour_number: 'SYN-A', settlement: 'Synthetic A',
        date: '2026-08-20', start_time: '10:00:00', guide_name: 'Synthetic activistA1',
        guide_activist_id: codes.activistA1, host_activist_id: codes.activistA2,
        assigned_activists: [codes.activistA1], status: 'upcoming', security_run_id: runId,
      },
      {
        id: tourB, project_id: projectB, tour_number: 'SYN-B', settlement: 'Synthetic B',
        date: '2026-08-21', start_time: '11:00:00', guide_name: 'Synthetic activistB1',
        guide_activist_id: codes.activistB1, host_activist_id: null,
        assigned_activists: [codes.activistB1], status: 'upcoming', security_run_id: runId,
      },
      {
        id: tourReportA, project_id: projectA, tour_number: 'SYN-REPORT-A', settlement: 'Synthetic A',
        date: '2026-09-20', start_time: '12:00:00', guide_name: 'Synthetic activistA1',
        guide_activist_id: codes.activistA1, host_activist_id: null,
        assigned_activists: [codes.activistA1], status: 'upcoming', security_run_id: runId,
      },
    ],
    expenses: [
      { id: 930001, project_id: projectA, activist_id: codes.activistA1, date: '2026-08-12', amount: 17, description: 'Synthetic expense A', security_run_id: runId },
      { id: 930002, project_id: projectB, activist_id: codes.activistB1, date: '2026-08-13', amount: 19, description: 'Synthetic expense B', security_run_id: runId },
    ],
    bonus_cancellations: [
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA2, cancelled_by: codes.coordA, bonus_key: `${codes.activistA2}|synthetic|2026-7`, security_run_id: runId },
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA1, cancelled_by: codes.coordA, bonus_key: `${codes.activistA1}|בונוס-תורני|${contactCancelledStreak}|2026-7`, security_run_id: runId },
    ],
    payment_config: [{
      id: 1,
      rate_phone_friendly: 10, rate_phone_torani: 12,
      rate_video_friendly: 14, rate_video_torani: 16,
      rate_frontal_friendly: 18, rate_frontal_torani: 20,
      rate_multi: 22, rate_shabbat_hosting: 24, rate_tour_guide: 26,
      min_duration_minutes: 10, cap_phone: 20, cap_frontal: 20, cap_multi: 20,
      cap_contact_phone_high: 5, cap_contact_phone_regular: 3,
      cap_contact_frontal_high: 5, cap_contact_frontal_regular: 3,
      bonus_loyalty_6: 60, bonus_loyalty_4: 40,
      bonus_mitzvot_level: 5, bonus_new_participant: 7, security_run_id: runId,
    }],
    notifications: [
      { id: randomUUID(), recipient_id: String(codes.activistA1), client_id: `security-${runId}-notification-a`, type: 'system', title: 'Synthetic update', body: 'Synthetic generic body', url: '/notifications', priority: 'normal', read: false, security_run_id: runId },
      { id: randomUUID(), recipient_id: String(codes.activistB1), client_id: `security-${runId}-notification-b`, type: 'system', title: 'Synthetic update', body: 'Synthetic generic body', url: '/notifications', priority: 'normal', read: false, security_run_id: runId },
    ],
    notification_reads: [
      { id: randomUUID(), recipient_id: String(codes.activistA1), security_run_id: runId },
      { id: randomUUID(), recipient_id: String(codes.activistB1), security_run_id: runId },
    ],
    push_subscriptions: [
      { id: randomUUID(), activist_id: String(codes.activistA1), subscription: { endpoint: `https://example.invalid/${runId}/a` }, security_run_id: runId },
      { id: randomUUID(), activist_id: String(codes.activistB1), subscription: { endpoint: `https://example.invalid/${runId}/b` }, security_run_id: runId },
    ],
    fcm_tokens: [
      { id: randomUUID(), activist_id: String(codes.activistA1), token: `synthetic-${runId}-a`, security_run_id: runId },
      { id: randomUUID(), activist_id: String(codes.activistB1), token: `synthetic-${runId}-b`, security_run_id: runId },
    ],
    feedback_reports: [
      { id: randomUUID(), project_id: projectA, reporter_id: codes.activistA1, security_run_id: runId },
      { id: randomUUID(), project_id: projectB, reporter_id: codes.activistB1, security_run_id: runId },
    ],
  });
}

function inPeriod(date, period) {
  return typeof date === 'string' && date.slice(0, 7) === period;
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);
}

const FINANCE_ACTIVITY_CATEGORIES = Object.freeze([
  ['phone-friendly', 'טלפוני-ידידותי', 'טלפוני', 'ידידותי'],
  ['phone-torani', 'טלפוני-תורני', 'טלפוני', 'תורני'],
  ['video-friendly', 'וידאו-ידידותי', 'וידאו', 'ידידותי'],
  ['video-torani', 'וידאו-תורני', 'וידאו', 'תורני'],
  ['frontal-friendly', 'פרונטלי-ידידותי', 'פרונטלי', 'ידידותי'],
  ['frontal-torani', 'פרונטלי-תורני', 'פרונטלי', 'תורני'],
  ['frontal-multi', 'פרונטלי-רב משתתפים', 'פרונטלי', 'רב משתתפים'],
  ['shabbat-hosting', 'אירוח שבת', 'אירוח שבת', null],
]);

const FINANCE_BONUS_TYPES = Object.freeze([
  'בונוס-לימוד-4', 'בונוס-לימוד-6', 'בונוס-מצוות', 'בונוס-חדש', 'בונוס-תורני',
]);

const UNPAID_LABELS = Object.freeze({
  'short-contact': 'קשר קצרצר — אינו מזכה בתשלום',
  'min-duration': 'פחות ממשך המינימום',
  'friendly-window': 'קשר ידידותי מעבר לחלון הזכאות',
  'torani-transition': 'הלקוח כבר עבר לקשר תורני',
  'friendly-frontal-cap': 'חריגה ממכסת ידידותי-פרונטלי',
  'monthly-cap': 'חריגה מהמכסה החודשית',
  'contact-cap': 'חריגה מהמכסה מול לקוח',
  'unknown-type': 'סוג קשר אינו מזכה',
  'not-payable': 'הקשר אינו מזכה בתשלום',
});

function unpaidReasonKey(reason = '') {
  if (reason.includes('קשר קצרצר')) return 'short-contact';
  if (reason.includes('פחות מ-')) return 'min-duration';
  if (reason.includes('מעבר לחלון הזכאות')) return 'friendly-window';
  if (reason.includes('כבר עבר לקשר תורני')) return 'torani-transition';
  if (reason.includes('מכסת 2 קשרים ידידותיים-פרונטליים')) return 'friendly-frontal-cap';
  if (reason.includes('חודשית') || reason.includes('חודשיים') || reason.includes('רב-משתתפים')) return 'monthly-cap';
  if (reason.includes('עם לקוח זה')) return 'contact-cap';
  if (reason.includes('סוג קשר')) return 'unknown-type';
  return 'not-payable';
}

function financeAggregateProjection(payment, config) {
  const paid = payment.breakdown.filter((entry) => entry.type === 'קשר');
  const activity_by_type = FINANCE_ACTIVITY_CATEGORIES.map(([key, configKey, type, quality]) => {
    const count = paid.filter((entry) => entry.interactionType === type
      && (quality === null || entry.quality === quality)).length;
    const unitRate = Number(config.BASE_PRICES[configKey] ?? 0);
    return { key, count, unitRate, total: count * unitRate };
  });
  const bonus_by_type = FINANCE_BONUS_TYPES.map((type) => {
    const entries = payment.breakdown.filter((entry) => entry.type === type);
    return { type, count: entries.length, total: sum(entries, (entry) => entry.amount) };
  }).filter((entry) => entry.count > 0);
  const unpaidCounts = new Map();
  for (const entry of payment.unpaid) {
    const key = unpaidReasonKey(entry.reason);
    unpaidCounts.set(key, (unpaidCounts.get(key) ?? 0) + 1);
  }
  const unpaid_by_reason = [...unpaidCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, label: UNPAID_LABELS[reason], count }));
  return { activity_by_type, bonus_by_type, unpaid_by_reason };
}

export function computeDeterministicFinanceExpected({ runId, actorIds }) {
  const fixture = buildLegacyFixtureRows(runId, actorIds);
  const config = toPaymentConfigDto({
    ...fixture.payment_config[0],
    // Migration 0024 is applied after the legacy fixture is seeded.
    rate_phone_friendly: 0,
    rate_phone_torani: 150,
    rate_video_torani: 200,
  });
  const period = '2026-08';
  const periodInput = { year: 2026, month: 7 };
  const mitzvot = deriveMitzvotBonuses(fixture.contacts, config.MITZVOT_BONUS_PER_LEVEL);
  const torani = deriveToraniBonuses(fixture.interactions, fixture.contacts, 1000, 3, config);
  const newParticipants = fixture.contacts
    .filter((contact) => inPeriod(contact.joined_at, period)
      && (contact.source === 'external' || contact.referred_by != null))
    .map((contact) => ({
      activist_id: contact.activist_id,
      contact_id: contact.id,
      contactName: contact.name,
    }));
  const cancelled = new Set(fixture.bonus_cancellations.map((row) => row.bonus_key));
  const activists = fixture.profiles.filter((profile) => profile.role === 'activist'
    && actorIds.disabled !== profile.id);

  const rows = activists.map((profile) => {
    const actorMitzvot = mitzvot.filter((bonus) => Number(bonus.activist_id) === Number(profile.activist_code)
      && bonus.month === '2026-7');
    const actorNewParticipants = newParticipants
      .filter((bonus) => Number(bonus.activist_id) === Number(profile.activist_code));
    const payment = calcMonthlyPayment(
      profile.activist_code,
      fixture.interactions,
      fixture.contacts,
      actorMitzvot,
      actorNewParticipants,
      config,
      cancelled,
      periodInput,
      torani.filter((bonus) => Number(bonus.activist_id) === Number(profile.activist_code)
        && bonus.month === '2026-7'),
    );
    const activityTotal = sum(payment.breakdown.filter((entry) => entry.type === 'קשר'), (entry) => entry.amount);
    const bonusTotal = sum(payment.breakdown.filter((entry) => entry.type !== 'קשר'), (entry) => entry.amount);
    const expenseTotal = sum(fixture.expenses.filter((expense) =>
      Number(expense.activist_id) === Number(profile.activist_code) && inPeriod(expense.date, period)),
    (expense) => expense.amount);
    const tourTotal = fixture.tours.filter((tour) =>
      Number(tour.guide_activist_id) === Number(profile.activist_code)
      && tour.status === 'completed' && inPeriod(tour.date, period)).length * config.TOUR_GUIDE_RATE;
    return {
      user_id: profile.id,
      name: profile.name,
      period,
      activity_total: activityTotal,
      bonus_total: bonusTotal,
      tour_total: tourTotal,
      expense_total: expenseTotal,
      grand_total: activityTotal + bonusTotal + tourTotal + expenseTotal,
      ...financeAggregateProjection(payment, config),
      project_id: profile.project_id,
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.user_id.localeCompare(right.user_id));
  const projected = (projectId) => rows.filter((row) => row.project_id === projectId)
    .map(({ project_id: _projectId, ...row }) => row);
  const projectA = projected(1);
  const projectB = projected(2);
  return Object.freeze({
    projectA: Object.freeze(projectA),
    projectB: Object.freeze(projectB),
    all: Object.freeze([...projectA, ...projectB].sort((left, right) =>
      left.name.localeCompare(right.name) || left.user_id.localeCompare(right.user_id))),
    byActor: Object.freeze({
      activistA: Object.freeze(projectA.filter((row) => row.user_id === actorIds.activistA1)),
      headAal2: Object.freeze(projectA),
      financeA: Object.freeze(projectA),
      ceoAal2ProjectA: Object.freeze(projectA),
    }),
  });
}

function safeDatabaseCode(error) {
  return /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error?.code ?? '')
    ? error.code
    : 'UNKNOWN';
}

function safeAuthFailure(error) {
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(error?.code ?? '') ? error.code : 'UNKNOWN';
  const status = Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 'UNKNOWN';
  return `${code} status ${status}`;
}

export async function waitForLegacySchemaCache({
  client,
  tables,
  maxAttempts = 100,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!client || !Array.isArray(tables) || tables.length < 1
    || new Set(tables).size !== tables.length
    || tables.some((table) => !/^[a-z][a-z0-9_]{0,62}$/.test(table))
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100
    || typeof pause !== 'function') {
    throw new Error('legacy schema cache readiness refused invalid boundary');
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let pending = null;
    for (const table of tables) {
      const { error } = await client.from(table).select('security_run_id').limit(1);
      if (!error) continue;
      const code = safeDatabaseCode(error);
      if (!['PGRST204', 'PGRST205'].includes(code)) {
        throw new Error(`legacy schema cache stopped at ${table} [${code}]`);
      }
      pending = { table, code };
      break;
    }
    if (!pending) return;
    if (attempt === maxAttempts) {
      throw new Error(`legacy schema cache not ready at ${pending.table} [${pending.code}]`);
    }
    await pause(100);
  }
}

export async function provisionLegacyDatabase({
  client, runId, actorIds, targetUrl, productionUrl, confirmed,
  expectedProjectId, expectedApiPort, stackIdentity, rowsByTable: suppliedRows,
}) {
  assertSafeTestTarget({
    targetUrl, productionUrl, confirmed, expectedProjectId, expectedApiPort, stackIdentity,
  });
  if (!client) throw new Error('legacy fixture refused: local service client required');
  const rowsByTable = suppliedRows ?? buildLegacyFixtureRows(runId, actorIds);
  if (rowsByTable?.projects?.[0]?.security_run_id !== runId
    || rowsByTable?.profiles?.some((row) => row.security_run_id !== runId)) {
    throw new Error('legacy fixture refused: prebuilt rows do not match exact run');
  }
  await waitForLegacySchemaCache({ client, tables: Object.keys(rowsByTable) });
  for (const [table, rows] of Object.entries(rowsByTable)) {
    const { error } = await client.from(table).insert(rows);
    if (error) {
      const safeCode = safeDatabaseCode(error);
      throw new Error(`legacy fixture stopped at ${table} [${safeCode}]`);
    }
  }
  const actorCodes = Object.fromEntries(Object.entries(actorIds).flatMap(([alias, actorId]) => {
    const code = rowsByTable.profiles.find((profile) => profile.id === actorId)?.activist_code;
    return Number.isSafeInteger(code) ? [[alias, code]] : [];
  }));
  return Object.freeze({
    securityRunId: runId,
    projectA: rowsByTable.projects[0].id,
    projectB: rowsByTable.projects[1].id,
    contactA: rowsByTable.contacts[0].id,
    contactA2: rowsByTable.contacts[1].id,
    contactB: rowsByTable.contacts[2].id,
    interactionA: rowsByTable.interactions[0].id,
    interactionB: rowsByTable.interactions[2].id,
    baseMeetingReportA: rowsByTable.base_meeting_reports[0].id,
    baseMeetingReportB: rowsByTable.base_meeting_reports[1].id,
    meetingA: rowsByTable.meeting_houses[0].id,
    meetingB: rowsByTable.meeting_houses[1].id,
    meetingReminderA: rowsByTable.meeting_reminders[0].id,
    meetingReminderB: rowsByTable.meeting_reminders[1].id,
    tourA: rowsByTable.tours[0].id,
    tourAssignedA: rowsByTable.tours[2].id,
    tourB: rowsByTable.tours[1].id,
    expenseA: rowsByTable.expenses[0].id,
    expenseB: rowsByTable.expenses[1].id,
    bonusCancellationA: rowsByTable.bonus_cancellations[0].id,
    paymentConfigId: rowsByTable.payment_config[0].id,
    notificationA: rowsByTable.notifications[0].id,
    notificationB: rowsByTable.notifications[1].id,
    notificationReadA: rowsByTable.notification_reads[0].id,
    notificationReadB: rowsByTable.notification_reads[1].id,
    pushSubscriptionA: rowsByTable.push_subscriptions[0].id,
    pushSubscriptionB: rowsByTable.push_subscriptions[1].id,
    fcmTokenA: rowsByTable.fcm_tokens[0].id,
    fcmTokenB: rowsByTable.fcm_tokens[1].id,
    feedbackReportA: rowsByTable.feedback_reports[0].id,
    feedbackReportB: rowsByTable.feedback_reports[1].id,
    activistA: actorIds.activistA1,
    activistB: actorIds.activistB1,
    actorCodes: Object.freeze(actorCodes),
    rowsByTable,
    period: '2026-08',
  });
}

export function assertCleanupScope({ runId, table }) {
  if (!UUID.test(runId ?? '') || !CLEANUP_TABLES.has(table)) {
    throw new Error('cleanup refused: exact run id and allowlisted table required');
  }
  return Object.freeze({ runId, table, column: 'security_run_id' });
}

export function sanitizeEvidenceRows(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence refused: array required');
  return rows.map((row) => {
    const sanitized = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, row?.[key]]));
    if (!/^SEC-\d{3}(?:-[A-Z0-9-]+)?$/.test(sanitized.caseId ?? '')
      || !STATUS.test(String(sanitized.expectedStatus ?? ''))
      || !STATUS.test(String(sanitized.actualStatus ?? ''))
      || !ACTOR_CLASSES.has(sanitized.actorClass)
      || !RESOURCE_CLASSES.has(sanitized.resourceClass)
      || !BLOCKING_LAYERS.has(sanitized.blockingLayer)) {
      throw new Error('evidence refused: invalid or sensitive-shaped case data');
    }
    return sanitized;
  });
}

function syntheticCredential() {
  return randomBytes(32).toString('base64url');
}

function serviceClient({
  targetUrl, productionUrl, confirmed, expectedProjectId, expectedApiPort, stackIdentity,
  serviceRoleKey,
}) {
  assertSafeTestTarget({
    targetUrl, productionUrl, confirmed, expectedProjectId, expectedApiPort, stackIdentity,
  });
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length < 20) {
    throw new Error('fixture provisioning refused: local service credential required in process memory');
  }
  return createClient(targetUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Creates synthetic Auth identities only. The returned credentials are deliberately
 * process-local and must be consumed by the same live-test process, never serialized.
 */
export async function createSyntheticAuthActorsWithClient({
  client, runId, targetUrl, productionUrl, confirmed,
  expectedProjectId, expectedApiPort, stackIdentity,
}) {
  assertSafeTestTarget({
    targetUrl, productionUrl, confirmed, expectedProjectId, expectedApiPort, stackIdentity,
  });
  if (!client?.auth?.admin || !UUID.test(runId ?? '')) {
    throw new Error('fixture provisioning refused: local admin client and exact run id required');
  }
  const blueprint = buildSyntheticFixtureBlueprint(runId);
  const actors = new Map();
  const createdUserIds = [];

  for (const actor of blueprint.actors) {
    const password = syntheticCredential();
    const email = `security-${runId}-${actor.alias.toLowerCase()}@example.invalid`;
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { security_run_id: runId, fixture_alias: actor.alias },
    });
    if (error || !data.user) {
      let cleanupFailed = false;
      for (const userId of createdUserIds.reverse()) {
        const cleanup = await client.auth.admin.deleteUser(userId);
        cleanupFailed ||= Boolean(cleanup.error);
      }
      if (cleanupFailed) {
        throw new Error(`fixture provisioning cleanup failed after actor ${actor.alias}`);
      }
      throw new Error(`fixture provisioning stopped at actor ${actor.alias}`);
    }
    createdUserIds.push(data.user.id);
    actors.set(actor.alias, Object.freeze({
      alias: actor.alias,
      id: data.user.id,
      email,
      password,
      role: actor.role,
      project: actor.project,
      state: actor.state,
      aal: actor.aal,
    }));
  }

  return Object.freeze({ runId, blueprint, actors, client });
}

export async function createDirectJwtFixture({ actors, createClientForActor, database }) {
  const required = [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion',
  ];
  if (!(actors instanceof Map) || required.some((alias) => !UUID.test(actors.get(alias)?.id ?? ''))
    || typeof createClientForActor !== 'function'
    || typeof database?.disableProfile !== 'function'
    || typeof database?.bumpSecurityVersion !== 'function') {
    throw new Error('direct-JWT fixture refused: local actor state is incomplete');
  }

  const tokens = {};
  const tokenNames = Object.freeze({
    coordA: 'coordA',
    activistA1: 'activistA',
    activistA2: 'activistA2',
    activistB1: 'activistB',
    financeA: 'financeA',
    disabled: 'disabled',
    staleSecurityVersion: 'staleSecurityVersion',
  });

  for (const alias of required) {
    const actor = actors.get(alias);
    const client = createClientForActor(actor);
    const signedIn = await client.auth.signInWithPassword({
      email: actor.email,
      password: actor.password,
    });
    const aal1 = signedIn?.data?.session?.access_token;
    if (signedIn?.error || !aal1) {
      throw new Error(`direct-JWT fixture stopped at ${alias} AAL1 [${safeAuthFailure(signedIn?.error)}]`);
    }

    if (alias === 'ceo' || alias === 'headA') {
      const prefix = alias === 'ceo' ? 'ceo' : 'head';
      tokens[`${prefix}Aal1`] = aal1;
      let factorId;
      try {
        const enrolled = await client.auth.mfa.enroll({
          factorType: 'totp', friendlyName: `security-direct-${alias}`,
        });
        factorId = enrolled?.data?.id;
        const secret = enrolled?.data?.totp?.secret;
        if (enrolled?.error || !factorId || !secret) {
          throw new Error(`direct-JWT fixture stopped at ${alias} enrollment [${safeAuthFailure(enrolled?.error)}]`);
        }
        const verified = await client.auth.mfa.challengeAndVerify({
          factorId,
          code: generateTotpCode(secret),
        });
        const aal2 = verified?.data?.access_token;
        if (verified?.error || !aal2) {
          throw new Error(`direct-JWT fixture stopped at ${alias} AAL2 [${safeAuthFailure(verified?.error)}]`);
        }
        tokens[`${prefix}Aal2`] = aal2;
      } finally {
        if (factorId) {
          const reset = await client.auth.mfa.unenroll({ factorId });
          if (reset?.error) {
            throw new Error(`direct-JWT fixture factor cleanup failed at ${alias} [${safeAuthFailure(reset.error)}]`);
          }
        }
        await client.auth.signOut({ scope: 'local' });
      }
    } else {
      if (tokenNames[alias]) tokens[tokenNames[alias]] = aal1;
      await client.auth.signOut({ scope: 'local' });
    }
  }

  await database.disableProfile(actors.get('disabled').id);
  await database.bumpSecurityVersion(actors.get('staleSecurityVersion').id);
  return Object.freeze({ tokens: Object.freeze(tokens) });
}

export async function provisionSyntheticAuthActors(options) {
  const client = serviceClient(options);
  const runId = options.runId ?? createSecurityRunId();
  return createSyntheticAuthActorsWithClient({
    client,
    runId,
    targetUrl: options.targetUrl,
    productionUrl: options.productionUrl,
    confirmed: options.confirmed,
    expectedProjectId: options.expectedProjectId,
    expectedApiPort: options.expectedApiPort,
    stackIdentity: options.stackIdentity,
  });
}

export async function cleanupSyntheticFixtures({
  client, runId, targetUrl, productionUrl, confirmed,
  expectedProjectId, expectedApiPort, stackIdentity,
}) {
  assertSafeTestTarget({
    targetUrl, productionUrl, confirmed, expectedProjectId, expectedApiPort, stackIdentity,
  });
  if (!client || !UUID.test(runId ?? '')) {
    throw new Error('cleanup refused: client and exact run id required');
  }
  const counts = {};
  for (const table of CLEANUP_RESOURCES) {
    const scope = assertCleanupScope({ runId, table });
    const { count: before, error: countError } = await client
      .from(scope.table).select('*', { count: 'exact', head: true }).eq(scope.column, scope.runId);
    if (countError) throw new Error(`cleanup stopped while counting ${scope.table}`);
    const { error: deleteError } = await client
      .from(scope.table).delete().eq(scope.column, scope.runId);
    if (deleteError) throw new Error(`cleanup stopped while deleting ${scope.table}`);
    const { count: after, error: verifyError } = await client
      .from(scope.table).select('*', { count: 'exact', head: true }).eq(scope.column, scope.runId);
    if (verifyError || after !== 0) throw new Error(`cleanup verification failed for ${scope.table}`);
    counts[scope.table] = Object.freeze({ before: before ?? 0, after: after ?? 0 });
  }

  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error('cleanup stopped while listing synthetic users');
  const users = data.users.filter((user) => user.user_metadata?.security_run_id === runId);
  for (const user of users) {
    const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error('cleanup stopped while deleting an exact synthetic user');
  }
  counts.authUsers = Object.freeze({ before: users.length, after: 0 });

  const projectScope = assertCleanupScope({ runId, table: 'projects' });
  const { count: projectsBefore, error: projectCountError } = await client
    .from('projects').select('*', { count: 'exact', head: true })
    .eq(projectScope.column, projectScope.runId);
  if (projectCountError) throw new Error('cleanup stopped while counting projects');
  const { error: projectDeleteError } = await client
    .from('projects').delete().eq(projectScope.column, projectScope.runId);
  if (projectDeleteError) throw new Error('cleanup stopped while deleting projects');
  const { count: projectsAfter, error: projectVerifyError } = await client
    .from('projects').select('*', { count: 'exact', head: true })
    .eq(projectScope.column, projectScope.runId);
  if (projectVerifyError || projectsAfter !== 0) throw new Error('cleanup verification failed for projects');
  counts.projects = Object.freeze({ before: projectsBefore ?? 0, after: projectsAfter ?? 0 });
  return Object.freeze(counts);
}

async function main() {
  const { runConfiguredLocalG5 } = await import('./g5-local-orchestrator.mjs');
  const result = await runConfiguredLocalG5();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
