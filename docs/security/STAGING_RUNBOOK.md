# Security Hardening G5 — Isolated Local Runbook

This runbook is executable only after G4 passes and only on a disposable local Supabase stack.
The approved G5 gate does **not** authorize Production or any remote Supabase project. A remote
hostname, a missing confirmation flag, or an ambiguous target is a hard stop.

## Target proof and secret handling

- Never contact a remote Supabase origin; the entire gate is loopback-only.
- Create the stack under the ignored directory
  `.superpowers/sdd/2026-08-27-security-hardening/g5-local/` with a unique project id beginning
  `mekarvim-security-g5-`.
- Accept only exact loopback origins whose URL hostname is `localhost`, `127.0.0.1`, or `[::1]`.
  Hostname suffixes, URL userinfo, non-HTTP schemes, and every remote Supabase hostname are refused.
- Set `SECURITY_TEST_CONFIRM_ISOLATED=true` only in the live-test process. Compare the local origin
  through `SECURITY_TEST_PRODUCTION_COMPARISON_URL`; never load `.env.local`.
- Keep the local publishable key, service-role key, database password, synthetic passwords, JWTs,
  TOTP secret, and cookies in process memory/environment only. Never print or write them to disk.
- Before mutation, record Docker, Supabase CLI, PostgreSQL and image versions without recording keys.
  Verify every container/volume label contains the exact unique project id and every listener is
  loopback-bound.

## Disposable legacy-schema boundary

The repository does not contain the full pre-0018 Production schema. Initialize the disposable
database with `tests/security/fixtures/legacy-security-schema.sql`, then create representative
legacy owner/project rows before applying 0018. This fixture is test-only and is not a migration.
It proves SQL/security behavior against a repository-derived contract; it does not prove
Production parity with an unexported schema.

Capture a sanitized pre-migration inventory of tables, columns, constraints, RLS flags, policies,
grants and functions. A proven `supabase db reset` of this unique disposable project is the backup
and restore mechanism. Demonstrate one reset back to the legacy fixture before relying on it.

## Stop conditions

Stop before the next file on any failed precondition, SQL error, unresolved reference, unexpected
grant/policy diff, owner-mapping gap, duplicate endpoint, parity mismatch, audit failure, or
direct-JWT authorization failure. Apply one migration per command/transaction and capture only a
sanitized inventory diff. Never retry 0021 or 0022 blindly.

For a migration defect: reproduce on the isolated database, write a RED static/live regression,
make the minimum secure fix, recreate the legacy baseline, and restart the complete forward chain.
Never weaken forced RLS, grants, resource-derived authority, fixed `search_path`, or audit atomicity.

## Exact forward order

The machine-readable contract is exported by `scripts/security/provision-test-fixtures.mjs`.
The only forward order is `0018 → 0019 → 0020 → 0021 → 0022 → 0023 → 0024`.

| Step | Preconditions | Required verification before continuing |
| --- | --- | --- |
| 0018 | Legacy fixture loaded; representative UUID-owner backfills exist | private schema revoked; identity mapping unique; every legacy owner/recipient backfill complete |
| 0019 | 0018 inventory green | all classified tables have enabled+forced RLS; grants/policies exact; audit triggers redact row content |
| 0020 | 0019 helper inventory green | all RPC dependencies resolve; fixed search paths; exact service/authenticated grants |
| 0021 | reminder UUID/project mappings complete | constraints/index exact; own/manager cancel succeeds; other recipient/project denied; no broad update/delete |
| 0022 | tour UUID assignment mappings complete | report constraints/index exact; assigned actor succeeds; unassigned/cross-project/reporter forgery denied |
| 0023 | endpoint and UUID owner preflights green | event capability and tenant derive from resource; recipient set exact; spoofed project/recipient denied |
| 0024 | finance source contract and payment config present | output keys exact; role/AAL/filter matrix exact; JS parity exact; search-path hijack denied; audit failure aborts read |

After every step, query `pg_class`, `pg_policies`, `information_schema.role_table_grants`,
`information_schema.routine_privileges`, `pg_proc` and `pg_constraint`. Evidence contains object
names/counts and pass/fail only, never row values.

## Pre-cutover rollback exercise

On a fresh disposable forward state with no application cutover writes, execute
`migrations/rollback/0018-0024-pre-cutover.sql`. Its asserted reverse order is
`0024 → 0023 → 0022 → 0021 → 0020 → 0019 → 0018`. Exercise the session, reminder and tour guards
that must refuse rollback after irreversible state exists. Never use rollback to restore permissive
policies. After the rollback proof, reset the disposable stack and recreate the full forward state
before adversarial tests.

## Synthetic fixture and evidence contract

Use one random UUID `security_run_id`. Provision Project A/B and CEO, Head A/B, Coordinator A,
Activist A1/A2/B1, Finance A, disabled and stale-security-version actors. Add only synthetic
contacts/interactions/meeting houses/reminders/tours/notifications/expenses/bonuses/payment data.
Create Auth users through the local admin API; generated credentials never leave process memory.

Each evidence row is restricted to case ID, actor class, resource class, blocking layer, expected
status and actual status. Reports may add aggregate counts, but never tokens, passwords, cookies,
emails, names, notes, payloads or database rows.

Run the direct PostgREST/JWT, local BFF, finance parity and session suites:

```powershell
npm run test:security -- tests/security/rls-live.test.mjs tests/security/session-live.test.mjs tests/security/db-contracts-live.test.mjs
node scripts/security/verify-rls-live.mjs
node scripts/security/verify-http.mjs
```

Real local TOTP must enroll, challenge, verify, prove AAL1 denial and AAL2 success, rotate the
session, exercise factor reset/unenroll, and erase the secret from memory. If local GoTrue cannot
perform a provider operation, record the exact provider-level blocker; do not invent PASS.

## Exact cleanup and shutdown

1. Show sanitized per-table counts for the exact `security_run_id`.
2. Delete child resources only with `eq('security_run_id', exactRunId)` after the cleanup guard
   validates the UUID and allowlisted table.
3. Delete only Auth users whose metadata has that exact run id; cascading profiles/memberships may
   then be removed. Delete the two exact tagged projects last.
4. Verify every exact-run count is zero, then rerun the anonymous isolation probe and posture
   inventory.
5. Stop/remove only containers and volumes whose verified label contains the unique local project
   id. Confirm no listener for that project remains. Do not prune Docker or delete unrelated
   containers/volumes.

If cleanup cannot prove exact scope, stop and leave the isolated stack for manual review rather
than broadening a deletion predicate.
