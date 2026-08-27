import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { escapeRegex } from './helpers.mjs';

const migrationPath = 'migrations/0018_security_foundation.sql';
const rollbackPath = 'migrations/rollback/0018-0020-pre-cutover.sql';

test('foundation migration creates private security stores and membership authority', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const required = [
    'create table if not exists public.project_memberships',
    'create table if not exists app_private.auth_identities',
    'create table if not exists app_private.auth_sessions',
    'create table if not exists app_private.audit_events',
    'create table if not exists app_private.rate_limit_buckets',
    'add column if not exists assigned_user_id uuid',
    'add column if not exists security_version integer',
    'revoke all on schema app_private from public, anon, authenticated',
  ];

  for (const statement of required) {
    assert.match(migration, new RegExp(escapeRegex(statement), 'i'));
  }
  assert.doesNotMatch(migration, /authenticated_all/i);
});

test('foundation migration backfills every legacy owner and refuses incomplete mappings', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const mappings = [
    ['contacts', 'assigned_user_id'],
    ['interactions', 'actor_user_id'],
    ['base_meeting_reports', 'actor_user_id'],
    ['expenses', 'actor_user_id'],
    ['feedback_reports', 'reporter_user_id'],
    ['notifications', 'recipient_user_id'],
    ['notification_reads', 'recipient_user_id'],
    ['meeting_reminders', 'recipient_user_id'],
    ['push_subscriptions', 'user_id'],
    ['fcm_tokens', 'user_id'],
  ];

  for (const [table, column] of mappings) {
    assert.match(migration, new RegExp(`alter table public\\.${table}[\\s\\S]+${column}`, 'i'));
    assert.match(migration, new RegExp(`security backfill refused: ${table}`, 'i'));
  }
  assert.match(migration, /guide_user_id uuid/i);
  assert.match(migration, /host_user_id uuid/i);
  assert.match(migration, /assigned_user_ids uuid\[\]/i);
});

test('pre-cutover rollback refuses to run after sessions exist and never cascades', async () => {
  const rollback = await readFile(rollbackPath, 'utf8');
  assert.match(rollback, /pre-cutover rollback refused: sessions exist/i);
  assert.match(rollback, /select 1 from app_private\.auth_sessions/i);
  assert.doesNotMatch(rollback, /cascade/i);
});
