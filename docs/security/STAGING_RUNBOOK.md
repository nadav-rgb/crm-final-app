# Security Hardening G5 Migration Runbook

This runbook is planning evidence only. Nothing in it authorizes a migration run. G5 still
requires explicit owner approval, an isolated Supabase test project, a verified non-production
project ref, credentials held only in process environment, and a reviewed backup.

## Stop conditions

Stop before the next file on any failed precondition, SQL error, unresolved function reference,
unexpected grant/policy diff, owner-mapping gap, duplicate endpoint, parity mismatch, audit failure,
or direct-JWT authorization failure. Do not retry `0021` or `0022` blindly: both are single-apply
and not fully idempotent.

## Forward order

The only approved order is `0018 → 0019 → 0020 → 0021 → 0022 → 0023 → 0024`.

| Migration | Dependency and preconditions | Static verification before G5 | Planned isolated live verification | Pre-cutover rollback assertion |
| --- | --- | --- | --- | --- |
| 0018 | Reviewed backup; legacy profile/owner mappings are unique and complete | foundation objects, UUID columns, guards, private-schema revokes | apply once; run every mapping assertion; anonymous probe remains blocked | no `app_private.auth_sessions`; no row depends solely on new UUID columns |
| 0019 | 0018 committed; every sensitive table exists | RLS forced, grants explicit, `app_has_active_membership` defined with fixed search path | two-project role matrix; disabled user denied; helper returns boolean only | remove policies/triggers before helpers; remain fail-closed |
| 0020 | 0019 helper/grant inventory is green | every referenced custom function resolves; service RPC grants exact | session/rate/audit tests and duplicate check under direct JWT | no sessions; drop service/user RPCs before private tables |
| 0021 | 0018 recipient UUID and 0019 reminder project mapping complete | columns/index/format constraint; narrow cancel RPC; no general UPDATE/DELETE | recipient self cancel succeeds; cross-project/other-recipient direct JWT fails; manager matrix exact | no non-null `idempotency_key` or `cancelled_at`; drop RPC/constraint/index/columns |
| 0022 | 0018 tour UUID mapping and 0019 column grants green | reporter/cancellation columns; narrow report RPC; report columns absent from direct UPDATE grant | assigned activist succeeds; unassigned/cross-project/reporter forgery fails; manager cannot forge actor | no new reporter/reason/cancelled data; drop RPC/index/constraints/columns |
| 0023 | 0018 UUID ownership and 0019 helpers green; no missing/duplicate endpoints | legacy mapping/duplicate preflight; event-specific branches; no RLS expansion | cross-project and event-capability attacks fail; recipients equal the resource-derived set | UUID→legacy backfill is complete before `SET NOT NULL`; drop RPC/index |
| 0024 | 0018 memberships/audit storage and all finance source schemas green | strict period, narrowing filters, fixed search path, output allowlist, atomic redacted audit | CEO/Head AAL1 denied; coordinator denied; Finance cross-project and Activist other-user filter forgery denied; output keys exact | no dependent runtime cutover; drop execute grant/function; audit rows may remain |

## Direct-JWT adversarial set

Run `tests/security/db-contracts-live.test.mjs` only after the isolated-target guard succeeds.
Required cases include other-recipient reminder cancel, unassigned/cross-project tour report,
reporter-key injection, unauthorized notification event, forged notification project assertion,
Finance cross-project filter forgery, Activist other-user filter forgery, CEO/Head AAL1 denial,
exact finance output columns, and a PostgreSQL search-path hijack attempt. Record only case IDs and
pass/fail status; never tokens, names, report content, or fixture row values.

## Rollback order

Pre-cutover rollback is `0024 → 0023 → 0022 → 0021 → 0020 → 0019 → 0018` using
`migrations/rollback/0018-0024-pre-cutover.sql`. After application cutover or real writes to new
columns, do not use the SQL rollback: restore the reviewed backup and the previous hardened BFF.
