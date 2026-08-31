# Security Hardening G5 — Isolated Local Runbook

This runbook is executable only after G4 passes and only on a disposable local Supabase stack.
The approved G5 gate does **not** authorize Production or any remote Supabase project. A remote
hostname, a missing confirmation flag, or an ambiguous target is a hard stop.

## Target proof and secret handling

- Never contact a remote Supabase origin; the entire gate is loopback-only.
- Create the stack under the ignored directory
  `.superpowers/sdd/2026-08-27-security-hardening/g5-local/` with a unique project id beginning
  `mekarvim-security-g5-`.
- Accept only the canonical root origin on the captured API port whose URL hostname is `localhost`,
  `127.0.0.1`, or `[::1]`. Paths, queries, fragments, HTTPS, wrong ports, hostname suffixes, URL
  userinfo, and every remote Supabase hostname are refused.
- Before every mutation, inspect Docker directly. Require exactly one database, Kong, Auth and
  PostgREST container with the unique project label/name, and require Kong's captured API port to
  be loopback-bound. A caller-supplied identity verdict is never accepted.
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

The machine-readable contract is exported by `scripts/security/provision-test-fixtures.mjs` and
executed by `scripts/security/g5-local-orchestrator.mjs`.
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

The only supported executable path owns stack creation, reset, forward/rollback/forward migration,
actor/token provisioning, local BFF startup, live suites, sanitized evidence, exact cleanup and
verified stack shutdown. Supply only absolute local executable paths and non-secret port choices;
do not supply fixture JSON, expected finance rows, PostgreSQL verdicts, session verdicts, tokens or
credentials. The runner never loads `.env.local`.

```powershell
$env:SECURITY_TEST_EXECUTE_LOCAL_G5 = 'true'
$env:SECURITY_TEST_SUPABASE_CLI = 'C:\absolute\path\to\supabase.exe'
$env:SECURITY_TEST_DOCKER_CLI = 'C:\absolute\path\to\docker.exe'
node scripts/security/g5-local-orchestrator.mjs
```

The runner launches the three live suites itself and derives evidence only after their child
process exits successfully. Failure output is not copied into the report because the child holds
process-memory credentials. Per-step PostgreSQL checks and sanitized inventories are executed
directly; the operator does not write pass/fail JSON.

Real local TOTP must enroll, challenge, verify, prove AAL1 denial and AAL2 success, rotate the
session, exercise factor reset/unenroll, and erase the secret from memory. If local GoTrue cannot
perform a provider operation, record the exact provider-level blocker; do not invent PASS.

## Exact cleanup and shutdown

1. Build one in-process exact registry for every seeded public row, derived membership, private
   Auth identity, Auth user, session hash, audit event id and rate-bucket hash.
2. Count every exact selector and refuse cleanup if any selector is not unique. Delete private
   FK blockers and dependent public rows first, profiles/memberships next, exact Auth users after
   their audit references, and the two exact projects last.
3. Inventory and delete any audit rows created by cleanup itself in a second exact derived-resource
   pass; verify every registry selector is zero and every private-resource inventory is empty.
4. Capture the sanitized post-cleanup posture inventory. No row values or identifiers enter evidence.
5. Stop/remove only containers and volumes whose verified label contains the unique local project
   id. Confirm no listener for that project remains. Do not prune Docker or delete unrelated
   containers/volumes.

If cleanup cannot prove exact scope, stop and leave the isolated stack for manual review rather
than broadening a deletion predicate.
