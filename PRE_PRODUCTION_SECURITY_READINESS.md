# CRM Mekarvim Pre-Production Security Readiness

Evidence date: 2026-09-01 (Asia/Jerusalem)

This document is a write-only staging and Production operations plan. It does not authorize a
merge, push, staging deployment, Production deployment, remote migration, force-push, or history
rewrite. No Production system was contacted while preparing it.

## Current Security Status

- Integration branch: `security/integrate-current-main`.
- Unchanged hardened base: `0153a8acb242d25ee259c2c626bb86c9899d6a95`.
- Integrated implementation review HEAD: `e148ce7f4f92d138cdda049e4e2462f0960ba387`.
- Proven fork and merge-base:
  `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`.
- Pinned current-main input: `69b4040a993689c63990f3064e58c321254836c5`; it is an ancestor
  of the integrated HEAD.
- Integration first-parent commits: `1211a78`, `10a10bb`, `238296f`, `8254c9a`, `b85f29b`,
  `8be993f`, `3271489`, `dd06012`, and `e148ce7`.
- All 13 known conflicts were resolved. The three modify/delete resolutions retained the hardened
  deletion of the legacy payment module and generated PDF/XLSX artifacts while porting business
  behavior into server-owned replacements.
- The integration-delta review reported five Important defects. Commit `e148ce7` closed all five
  with RED-to-GREEN regressions covering complete Finance pagination, SQL/JS calendar parity,
  historical Torani attribution, Coordinator candidate-only cancellation, and notification kinds.
- The final independent review at evidence checkpoint `409f077` reported zero Critical and zero
  Important findings and recommended staging entry.
- Final G5/G6 source/test checkpoint: `e148ce7f4f92d138cdda049e4e2462f0960ba387`.
- G5: 19/19 live tests, 48/48 adversarial evidence cases, 49/49 migration checks, 17/17
  classified tables with enabled and forced RLS, exact fixture cleanup, and disposable-stack
  teardown at 0 containers / 0 volumes / 0 networks / 0 listeners.
- The claims in `SECURITY_HARDENING_REPORT.md` match the fresh deterministic verification below.
  G5 claims remain time-bound to its destroyed disposable local stack and were not represented as
  a fresh remote or Production result.

## Final Verification

The integration changes received a fresh G5 run. G6 was then rerun from a clean detached worktree
at the exact implementation checkpoint before evidence-only documentation updates.

| Verification | Result | Exact evidence |
| --- | --- | --- |
| `npm ci` | PASS | 277 packages added; 278 audited; 0 vulnerabilities |
| Fresh disposable G5 | PASS | Project `mekarvim-security-g5-f513a76122c5`; 19/19 live tests; 48/48 evidence cases; 49/49 migration checks; cleanup and destruction exact |
| `npm run test:security` | PASS | 369 total; 350 pass; 19 explicit isolated-live skips; 0 fail |
| G5 correspondence for the 19 skips | PASS | The same 19 gated tests ran live in G5: 19 pass; 0 skip; 0 fail |
| `npm run test:baseline` | PASS | 124/124: Interaction Report 31/31 plus Payments 93/93 |
| Activity report/workbook verification | PASS | 64/64; 0 fail |
| Finance/PDF/Excel focused tests | PASS | 36/36; 0 fail |
| `npm run build` | PASS | Next.js 16.3.3 Webpack production build compiled successfully |
| HTTP/CSP verifier | PASS | Exact 200/401/403/404/500; five distinct CSP nonces; required headers |
| HTTP process cleanup | PASS | 0 listeners on `127.0.0.1:43877` after stopping the owned process |
| Client bundle scan | PASS | 0 findings |
| Current/tracked/history secret scans | PASS | 0 findings in all three modes |
| `npm audit --json` | PASS | 0 Critical / High / Moderate / Low; 310 dependency records |
| `npm audit --omit=dev --json` | PASS | 0 Critical / High / Moderate / Low; 310 dependency records |
| Android static hardening | PASS | 6/6 |
| Capacitor Android sync | PASS | Pinned CLI generated the ignored bridge files required by a clean worktree |
| Android debug/unit build | PASS | 169 actionable tasks; 169 executed; BUILD SUCCESSFUL |
| Android release guard | EXPECTED FAIL | Missing `android/keystore.properties`; no debug-signing fallback |
| Privileged operational entrypoints | PASS | Seven of seven failed closed without target acknowledgement; no data operation |
| `git diff --check` | PASS | No whitespace errors before documentation commit |

Warnings that did not fail verification are tracked under Known Residual Risks; they are not
silently converted into PASS claims.

## Merge Readiness

### Completed integration

The branch was created from hardened HEAD `0153a8a`, and merge commit `10a10bb` incorporated the
pinned current-main SHA. The merge retained explicit parentage for review and rollback. All conflict
groups were resolved with current business behavior behind opaque same-origin sessions, server-
derived tenant/actor authority, field-minimized DTOs, audited RPCs and forced RLS.

Finance parity now covers friendly calendar windows, per-contact and monthly caps, non-payable
`קצרצר`, Torani transitions and streak bonuses, cancellation keys/beneficiaries, reassignment,
activity/unpaid calculations, and RTL/formula-safe exports. Large histories paginate beyond the
PostgREST row cap. The browser never receives raw contact or religious-history Finance inputs.

The integration range contains no generated report binary, signing material, secret, APK/AAB or G5
runtime evidence. The two legacy `0002_*` prefixes still predate the hardening chain; migrations
0018 through 0024 remain the sole sequential security chain and were replayed live.

## Staging Checklist

`REQUIRES CONFIG` and `REQUIRES OWNER ACTION` items are fail-closed dependencies, not permission to
invent credentials. `BLOCKER` means the staging candidate must not be deployed until closed.

| Item | Status | Required staging action and proof |
| --- | --- | --- |
| Resolve current `main` divergence | READY | Pinned target is integrated; all 13 conflicts are resolved and G5/G6 were rerun |
| Reconcile target Finance rules | READY | Eligibility, caps, קצרצר, Torani, cancellation, activity/unpaid exports and SQL-versus-JS parity are proven |
| Final independent integration review | READY | Zero Critical and zero Important findings at evidence checkpoint `409f077`; all five prior Important findings verified closed |
| Core server environment | REQUIRES CONFIG | Set exact HTTPS `APP_ORIGIN`; staging `SUPABASE_URL`, publishable and service-role keys server-side; 32+ character session pepper; one 32-byte base64url token key; key version `1`; same-origin reset callback; BFF auth and contacts flags `true` |
| Supabase Auth project settings | REQUIRES OWNER ACTION | Record Site URL, allowed redirect list, email/reset configuration, JWT/refresh settings and signup policy; use only the staging project |
| MFA/TOTP | REQUIRES OWNER ACTION | Enable TOTP enroll and verify in staging; prove Head/CEO AAL1 denial, enrollment/challenge, AAL2 success, session rotation and factor reset with synthetic users |
| Redirect URLs | REQUIRES CONFIG | `PASSWORD_RESET_REDIRECT_URL` must be the exact staging origin plus `/api/auth/password-reset/verify`; Dashboard allowlist must contain that exact URL and no wildcard |
| Shared rate-limit store | READY | Migration 0020 installs the Postgres/RPC store; verify `app_rate_limit_consume`, shared login/MFA buckets, 429 behavior and fail-closed 503 on store failure |
| Google/Firebase restrictions | REQUIRES OWNER ACTION | Restrict the tracked public Firebase client configuration by Android package/signing certificate and allowed APIs in Google Cloud/Firebase consoles |
| Private Google Sheet integration | REQUIRES OWNER ACTION | Use a dedicated service account, private sheet share, exact spreadsheet ID and exact `Sheet!A:Z`-style range; no public CSV or anyone-with-link fallback |
| Anthropic | REQUIRES OWNER ACTION | Keep disabled unless a key, explicit feature enablement and recorded data-processing approval are all present; run a redaction/size-limit staging test before enablement |
| GitHub feedback | READY | Keep disabled and omit token/repository settings. Any future enablement requires a private repository and least-privilege token plus a separate review |
| Web Push / FCM server credentials | REQUIRES CONFIG | Configure VAPID public/private pair and mailto server-side, dedicated FCM service account, and verify generic lock-screen payload plus dead-token cleanup |
| HSTS and subdomains | REQUIRES OWNER ACTION | Verify the live staging header and every owned staging subdomain. Do not submit a preload request until the Production registrable domain and all subdomains are approved |
| Android release/device test | REQUIRES OWNER ACTION | Provide the release keystore outside Git, complete `keystore.properties`, run release build, verify certificate/package restrictions, and test MFA/session/push on a real device |
| Staging database migration operator | REQUIRES OWNER ACTION | Provide SQL Editor/direct Postgres owner access, validated backup/restore capability and a named operator; service-role keys cannot execute this DDL |

## Production Migration Runbook

This section is **write only**. It must first be executed successfully in the integrated staging
candidate. Production execution requires a separate owner-approved change window.

### Immutable migration artifacts

| Migration | SHA-256 |
| --- | --- |
| `0018_security_foundation.sql` | `2582A8852D70B174D7012B837ADBDEDD37BE162DF044566C556CC9D8588B981B` |
| `0019_security_rls.sql` | `D3FD11EE7BB77156556F3F7E7D2BF8682D53E28D70030124890FB473B18A2727` |
| `0020_security_rpcs.sql` | `05D7548646A94D3676FD5451ECD702AA963447D9DABD2941F7070F886D59D879` |
| `0021_meetings_security.sql` | `3D2E433D25D74FB1F03F85A7175F63E233CD00B3F02F6808DE31D971CA91215E` |
| `0022_tours_security.sql` | `A9FE77350DD1E1932C0A979E6D793D0B394874EF950AF0403FD3EA8C94504169` |
| `0023_notifications_security.sql` | `FD13797D2B4F6558B15F907C09B8E743540B3056FF20B7C850C1753BA2B50D3A` |
| `0024_finance_security.sql` | `53C312649446ECB159B50F0A6894D3D6D00D3A484CBFE38ECDC3DE1FD442591C` |
| Pre-cutover reverse script | `9484260E8436BD83E3EF4181E55713CE9893CFDC051155B7192CB8C77B338B11` |

### Common preflight and execution contract

1. Pin the reviewed application commit, all file hashes above, staging evidence, named operator,
   maintenance window and rollback owner in the change record.
2. Confirm the exact Production project ref independently; prove it is not staging or a local project.
   This identification step does not authorize mutation.
3. Freeze application and cron writes. Record active connection/session counts and the current
   schema/policy/grant/function catalog.
4. Confirm both pre-existing `0002_*` migrations and migrations through `0017` are present in the
   database baseline. Do not infer state from filenames alone.
5. Create backup `B0`: provider snapshot/PITR checkpoint plus encrypted full logical schema+data
   backup. Record checksum, storage location, retention, operator, timestamp and a completed restore
   rehearsal against staging.
6. Apply one complete file at a time in the only allowed order
   `0018 -> 0019 -> 0020 -> 0021 -> 0022 -> 0023 -> 0024`. Every file already contains
   `BEGIN`/`COMMIT`; never paste only a fragment or add `COMMIT` after an error.
7. On any SQL error, leave the transaction aborted, issue `ROLLBACK` if the client has not already
   done so, capture SQLSTATE and sanitized object name, and stop. Never continue to the next file.
8. After each committed file, run its verification and take the named pre-next-step backup/catalog
   checkpoint. Never retry 0021 or 0022 blindly.

### 0018 - Security foundation

- **Preconditions:** complete legacy schema through 0017; unique normalized usernames; every legacy
  owner/recipient/guide/host/assignment maps to one `auth.users` UUID; no unmapped row.
- **Backup:** `B0` full backup immediately before 0018.
- **Expected changes:** private schema; project memberships; identity/session/audit/rate-limit
  tables; UUID ownership columns; compatibility constraints/triggers; backfill indexes; private
  grants revoked.
- **Verification:** zero null or divergent legacy/UUID mappings; validated compatibility constraints;
  unique identities; private schema inaccessible to `public`, `anon`, and `authenticated`.
- **Failure condition:** any duplicate username, missing mapping, divergent identity pair, invalid
  constraint, unexpected table shape or grant. Roll back the 0018 transaction and stop.
- **Rollback:** transaction rollback while 0018 is in flight. After commit but before cutover, use
  only the complete reviewed reverse script from a fully known chain state or restore `B0`.
- **No safe schema rollback after:** the first application session, UUID-only business write,
  membership change or security event is accepted. The reverse script refuses if sessions exist.
- **Immediate monitoring:** migration SQLSTATE, lock time, connection saturation, null mapping counts,
  constraint failures and private-schema privilege probes.

### 0019 - Forced RLS, grants and audit triggers

- **Preconditions:** 0018 verification green; meeting-house/reminder/bonus UUID backfills complete;
  required `anon`, `authenticated`, and `service_role` roles present.
- **Backup:** `B1`, a new logical/catalog checkpoint after 0018 and before 0019.
- **Expected changes:** enabled and forced RLS on all 17 classified tables; exact grants and policies;
  OLD-to-NEW immutable-authority triggers; authenticated INSERT validators deriving actors and
  checking referenced project authority/initial state; no authenticated direct INSERT grant on
  derived bonus cancellations; security-invoker directory helpers; redacted atomic audit triggers;
  service-only `app_security_posture`.
- **Verification:** call `app_security_posture` as service role; require 17/17 enabled+forced, no
  public/anon table or column grant, exact authenticated column grants/policies, fixed function
  search paths, anonymous denial, representative role projections, and denial of manager-forged
  actor/contact/house/assignee/beneficiary and tour-state INSERTs, including same-project fabricated
  bonus-cancellation keys.
- **Failure condition:** unknown/missing table, extra policy/grant, permissive-all predicate, missing
  trigger, failed posture call or unexpected anonymous access. Roll back the 0019 transaction.
- **Rollback:** transaction rollback before commit. Pre-cutover reverse-script rollback removes
  hardened policies before helpers and leaves authenticated tables revoked; never restore permissive
  policies ad hoc.
- **No safe schema rollback after:** traffic relies on hardened policies or audit events are required
  for accountability. Roll forward or restore a reviewed backup rather than re-open broad access.
- **Immediate monitoring:** 401/403/404/42501 rates by endpoint, RLS errors, audit insert failures,
  policy latency, DB CPU and connection use.

### 0020 - Session, rate, audit and governance RPCs

- **Preconditions:** 0019 posture green; every referenced helper/function resolves; service and user
  roles have exactly the expected grants; BFF remains disabled during migration.
- **Backup:** `B2` after 0019 and before 0020.
- **Expected changes:** service-only identity and opaque-session lifecycle RPCs; refresh lock/CAS;
  MFA-state persistence; shared rate-limit RPC; append-only audit RPC; atomic membership governance;
  narrow authenticated workflow RPCs.
- **Verification:** catalog exact signatures/grants and fixed `search_path`; synthetic create/load/
  touch/rotate/revoke session lifecycle; refresh loser cannot call provider; rate bucket blocks the
  sixth login; governance rejects self-escalation/last-CEO removal; audit failure aborts mutation.
- **Failure condition:** missing dependency, unexpected EXECUTE grant, mutable search path, non-atomic
  audit/governance behavior, refresh race or rate-store failure. Roll back 0020 and stop.
- **Rollback:** transaction rollback before commit. Pre-cutover reverse script may drop the RPCs only
  while there are no app sessions and no application cutover.
- **No safe schema rollback after:** any new opaque session exists or the BFF is enabled. The reverse
  script intentionally refuses when `app_private.auth_sessions` contains a row.
- **Immediate monitoring:** login/MFA/session error rates, rate-limit counts, refresh contention,
  audit append failures, revoked-session reuse and 503 fail-closed responses.

### 0021 - Meeting security

- **Preconditions:** reminder recipient/project UUID mappings complete; no duplicate idempotency key;
  0020 verification green. This migration is single-apply and not fully idempotent.
- **Backup:** `B3` after 0020 and before 0021.
- **Expected changes:** reminder idempotency and cancellation columns/constraints/index; narrow
  meeting-house assignment and recipient-derived cancellation RPCs.
- **Verification:** exact index and constraint; replay conflict; own/manager cancellation succeeds;
  another recipient/project is denied; no broad UPDATE/DELETE grant.
- **Failure condition:** constraint/index collision, inconsistent authority, duplicate key or any
  unauthorized cancellation. Roll back the transaction; do not retry without restoring `B3` or an
  approved corrective review.
- **Rollback:** transaction rollback before commit. Pre-cutover reverse script may remove the columns
  only while every `idempotency_key` and `cancelled_at` is null.
- **No safe schema rollback after:** the first non-null idempotency or cancellation value.
- **Immediate monitoring:** reminder scheduling/cancellation errors, duplicate conflicts, queue depth,
  recipient concealment and notification side effects.

### 0022 - Tour security

- **Preconditions:** tour guide/host/assignment UUID contract green; no incompatible status/report
  data; 0021 verified. This migration is single-apply and not fully idempotent.
- **Backup:** `B4` after 0021 and before 0022.
- **Expected changes:** reporter UUID and cancellation-reason fields, status/length constraints and
  index; narrow assign/cancel/delete/report RPCs with resource-derived authority.
- **Verification:** assigned actor report succeeds; unassigned/cross-project/report-forgery cases are
  denied; blank/oversized/extra report JSON rejected; assignment and cancellation scopes exact.
- **Failure condition:** constraint collision, incompatible legacy row, authority inconsistency or
  unexpected cross-project success. Roll back; never retry blindly.
- **Rollback:** transaction rollback before commit. Pre-cutover reverse script may remove new tour
  fields only if no reporter, cancellation reason or cancelled status exists.
- **No safe schema rollback after:** the first secured report/cancellation write.
- **Immediate monitoring:** report/cancel/assign failure rates, 403/404 concealment, status transitions,
  audit rows and notification event generation.

### 0023 - Notification security

- **Preconditions:** every notification/push/FCM row has UUID ownership; no empty or duplicate push
  endpoint; required resource event dependencies resolve.
- **Backup:** `B5` after 0022 and before 0023.
- **Expected changes:** nullable legacy compatibility owners after UUID proof; unique endpoint index;
  removal of legacy notification routines; private generic-delivery outbox; resource-derived event
  enqueue and service-only claim RPCs.
- **Verification:** exact routine inventory and grants; recipient/project/content cannot be forged;
  recipient set derives from resource; opaque claim returns generic payload only; cross-project and
  legacy routine calls fail; outbox is private.
- **Failure condition:** missing UUID mapping, duplicate endpoint, surviving legacy overload, broad
  outbox privilege or forged event success. Roll back 0023 and stop.
- **Rollback:** transaction rollback before commit. Pre-cutover reverse script restores legacy owner
  values only when every UUID maps back and removes the outbox/routines.
- **No safe schema rollback after:** the first UUID-only endpoint/notification or delivery outbox item
  that cannot be represented in legacy columns.
- **Immediate monitoring:** enqueue/claim errors, queue age/depth, generic payload conformance, dead
  token cleanup, provider failures and cross-project denials.

### 0024 - Finance projection

- **Preconditions:** finance source tables and `payment_config` complete; `app_private.audit_events`
  available; deterministic JS parity fixture is green; 0023 verified.
- **Backup:** `B6` after 0023 and before 0024.
- **Expected changes:** fixed-search-path `app_finance_summary` returning only eight declared
  aggregate columns with caller-derived role/project/actor scope and atomic redacted audit; plus
  `app_cancel_bonus`, which recomputes the exact derived candidate and server-owned cancellation row.
- **Verification:** exact output keys; CEO/Head/Finance/Activist scopes and Coordinator denial;
  month/project/actor narrowing; SQL-versus-JS parity; search-path hijack denial; audit failure aborts
  the read contract; direct table INSERT denial; valid candidate success; duplicate and same-project
  nonexistent/future candidate denial.
- **Failure condition:** missing source/config, unexpected output key, unexplained parity delta,
  over-broad role scope, mutable search path or non-atomic audit. Roll back 0024 and stop.
- **Rollback:** transaction rollback before commit. Before application cutover, drop both 0024
  functions via the reviewed reverse script or restore `B6`.
- **No safe schema rollback after:** the application is cut over to the aggregate RPC and old finance
  access paths are removed. Roll back the application first or roll forward.
- **Immediate monitoring:** finance RPC latency/error rate, scope denials, audit write failures,
  aggregate parity sampling and absence of PII fields.

### Completion checkpoint

After 0024, run the complete posture, direct-JWT, role/AAL, Finance parity, audit atomicity and cleanup
suite with synthetic staging data. Take `B7`, the post-chain backup/catalog snapshot, before enabling
BFF flags or staging traffic. Any discrepancy is a stop condition; no Production deployment follows
automatically from a successful migration.

## External Configuration Required

- **Server environment:** exact staging origins and Supabase project values; service-role and
  compatibility secret names server-only; independently generated session pepper and token key;
  BFF flags; exact reset callback; optional cron secret of at least 32 characters.
- **Supabase Dashboard:** staging Site URL and exact redirect allowlist, TOTP enrollment and
  verification, email reset flow, accepted password/signup/JWT/refresh policy, and a named owner.
- **Google/Firebase:** client API/application restrictions, service accounts for FCM and the private
  Sheet, exact Sheet share and range.
- **Push:** staging VAPID pair and mailto, FCM service account, real-browser and real-device test.
- **Anthropic:** remain disabled unless data-processing approval and key ownership are recorded.
- **GitHub:** remain disabled. Enabling is a separate private-repository/least-privilege review.
- **Android:** release keystore and passwords supplied outside Git; signing certificate registered
  with Google/Firebase; release and device acceptance tests.
- **Infrastructure:** staging HTTPS origin, HSTS/subdomain inventory, log/alert access, backup/PITR
  owner and tested restore path.

## Rollback Plan

### Source and integration

- Preserve hardened commit `0153a8a` and pinned current-main commit `69b4040` as immutable rollback
  references. Do not move or overwrite them.
- If the integrated candidate fails review, abandon only `security/integrate-current-main` and
  return to the unchanged hardened reference; do not rewrite `security/hardening-p0`.
- If a merged candidate must be backed out, create a normal revert of the merge commit with
  `git revert -m 1`; never reset or force-push shared history.
- Disable an unsafe staging BFF path fail-closed; never restore client-only auth, browser service
  credentials or permissive RLS as a fallback.

### Database

- A failure inside any migration's transaction uses transaction rollback and stops the chain.
- Before application cutover and only while every guard condition remains true, the reviewed reverse
  script may run once in exact order `0024 -> 0023 -> 0022 -> 0021 -> 0020 -> 0019 -> 0018`.
- The reverse script is not a general Production down-migration. It refuses sessions, reminder
  idempotency/cancellation data, tour report/cancellation data, and missing legacy notification owner
  mappings.
- After any point of no safe schema rollback, do not run the reverse script. Roll back the application
  first, restore the named backup/PITR point, or deploy an independently reviewed roll-forward fix.
- Never restore old permissive policies by hand. After restore, rerun anonymous isolation, forced-RLS
  posture, grants, functions and audit verification before traffic resumes.

## Known Residual Risks

- G5 used a repository-derived legacy schema fixture because the complete Production schema export
  is not in the repository. Production preflight must reconcile the real catalog and mappings.
- The two pre-existing `0002_*` filenames are a legacy numbering ambiguity. Both are recorded as
  applied in the repository README, but the target database must prove both objects before 0018.
- Migrations 0021 and 0022 are single-apply and not fully idempotent; blind retry is prohibited.
- Local G5 evidence is time-bound. Staging provider consoles, real notification delivery, external
  services, credential rotation and Production data shape were intentionally not proven.
- HSTS preload code is present, but operational subdomain/preload readiness requires owner review.
- Android release signing material is absent; only the fail-closed guard and debug build were proven.
- Next.js reports `optimizeFonts`, middleware-convention and `_app.getInitialProps` warnings. Gradle
  reports flat-directory, SDK XML and deprecation warnings.
- Production report generators were not run against privileged person-level data during this review.

## Go / No-Go

READY TO ENTER STAGING

No deterministic local code, integration, migration, security-review, G5 or G6 blocker remains.
The external configuration and owner-action controls above are required during staging entry; this
verdict does not authorize a merge to `main`, push, deployment, remote migration or Production use.
