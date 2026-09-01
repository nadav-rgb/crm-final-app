# CRM Mekarvim Pre-Production Security Readiness

Evidence date: 2026-09-01 (Asia/Jerusalem)

This document is a write-only staging and Production operations plan. It does not authorize a
merge, push, staging deployment, Production deployment, remote migration, force-push, or history
rewrite. No Production system was contacted while preparing it.

## Current Security Status

- Reviewed security branch: `security/hardening-p0`.
- Security implementation review HEAD: `9d6aea5cb4e8e18a802080331afce747332b6246`.
- Proven fork commit and current `main` merge-base:
  `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`.
- Current local and remote target: `main` / `origin/main` at
  `69b4040a993689c63990f3064e58c321254836c5`; verified with `git ls-remote`.
- Review range at the implementation checkpoint: 94 branch commits, 241 changed files, 29,560
  insertions and 9,302 deletions.
- Target divergence since the fork: 36 `main` commits versus 94 security-branch commits.
- Final G5 source/test checkpoint: `9d6aea5cb4e8e18a802080331afce747332b6246`.
  The independent review found an authenticated manager INSERT authority gap. A focused regression
  went RED, migration 0019 and the reverse script were fixed in `9d6aea5`, the focused test went
  GREEN, and the complete disposable G5 lifecycle was recreated and rerun from that commit.
- G5: 19/19 live tests, 48/48 adversarial evidence cases, 47/47 migration checks, 17/17
  classified tables with enabled and forced RLS, exact fixture cleanup, and disposable-stack
  teardown at 0 containers / 0 volumes / 0 networks / 0 listeners.
- The claims in `SECURITY_HARDENING_REPORT.md` match the fresh deterministic verification below.
  G5 claims remain time-bound to its destroyed disposable local stack and were not represented as
  a fresh remote or Production result.

## Final Verification

The security-critical migration change required and received a fresh G5 run. G6 was then rerun from
scratch from the same implementation checkpoint plus evidence-only documentation updates.

| Verification | Result | Exact evidence |
| --- | --- | --- |
| `npm ci` | PASS | 277 packages added; 278 audited; 0 vulnerabilities |
| Fresh disposable G5 | PASS | Project `mekarvim-security-g5-5b6553b5dde5`; 19/19 live tests; 48/48 evidence cases; cleanup and destruction exact |
| `npm run test:security` | PASS | 344 total; 325 pass; 19 explicit isolated-live skips; 0 fail |
| G5 correspondence for the 19 skips | PASS | The same 19 gated tests ran live in G5: 19 pass; 0 skip; 0 fail |
| `npm run test:baseline` | PASS | 51/51: Interaction Report 27/27 plus Payments 24/24 |
| Finance/PDF/Excel focused tests | PASS | 32/32; 0 fail |
| `npm run build` | PASS | Next.js 16.3.3 Webpack production build compiled successfully |
| HTTP/CSP verifier | PASS | Exact 200/401/403/404/500; five distinct CSP nonces; required headers |
| HTTP process cleanup | PASS | 0 listeners on `127.0.0.1:43877` after stopping the owned process |
| Client bundle scan | PASS | 0 findings |
| Current/tracked/history secret scans | PASS | 0 findings in all three modes |
| `npm audit --json` | PASS | 0 Critical / High / Moderate / Low; 310 dependency records |
| `npm audit --omit=dev --json` | PASS | 0 Critical / High / Moderate / Low; 310 dependency records |
| Android static hardening | PASS | 6/6 |
| Android debug/unit build | PASS | 169 actionable tasks; 82 executed; 87 up-to-date |
| Android release guard | EXPECTED FAIL | Missing `android/keystore.properties`; no debug-signing fallback |
| `git diff --check` | PASS | No whitespace errors before documentation commit |

Warnings that did not fail verification are tracked under Known Residual Risks; they are not
silently converted into PASS claims.

## Merge Readiness

### Ancestry and target

The branch reflog records creation from `HEAD` at `72b9196…`. That commit is also the current
`git merge-base security/hardening-p0 main`. The historical branch name attached to `HEAD` at the
creation instant is not retained by Git, but ancestry proves the fork commit and `main` is the
current local and remote integration target.

### Conflict simulation

`git merge-tree --write-tree --messages main security/hardening-p0` exited 1 with 13 conflicts:

- Content: `lib/AuthStore.jsx`, `lib/CrmStore.jsx`, `lib/notificationDemo.js`,
  `pages/contact/add-interaction/[id].jsx`, `pages/my-dashboard.jsx`, `pages/payments.jsx`,
  `pages/payments/[id].jsx`, `scripts/compare-payment-impact.cjs`,
  `scripts/verify-month-report.cjs`, and `scripts/verify-payroll-xlsx.cjs`.
- Modify/delete: `lib/paymentConfig.js`, `reports/דו״ח-קשרים-אחדות-יהודית.pdf`, and
  `reports/דו״ח-קשרים-אחדות-יהודית.xlsx`.

Conflict risk is **HIGH** because authentication/client authority and payment logic are both in the
conflict set. The generated PDF/XLSX conflict must be resolved in favor of keeping generated reports
out of Git; a requested live report is regenerated locally under the repository's report workflow.

The current target also contains Finance behavior not represented by the isolated hardened branch:
friendly eligibility windows, a friendly-frontal cap, non-payable `קצרצר`, transition-to-Torani,
the three-month `בונוס-תורני`, and activity-by-type/unpaid export rows. Migration 0024 currently
projects the older aggregate model, and the hardened cancellation parser does not accept
`בונוס-תורני`. This is a deterministic integration blocker: the target rules must be ported through
the server-owned Finance projection and cancellation/export paths, then SQL-versus-JS parity and
PDF/Excel verification must be rerun on the integrated candidate.

No accidental build output, signing material, secret, `.next` output, APK/AAB, or G5 runtime artifact
was added by the security range. Added files top out below 100 KiB. The two legacy `0002_*` migration
prefixes already existed at the fork; security migrations `0018` through `0024` are unique and
strictly sequential. No security-blocking TODO/FIXME/debug statement or temporary enabled external
integration was found.

### Exact merge strategy

Do not rebase 93 commits and do not squash away the security evidence history. Resolve the target
divergence once in a dedicated integration branch and preserve a merge commit:

1. Re-run `git ls-remote origin refs/heads/main`; abort if it no longer equals the reviewed target.
2. Create an annotated rollback tag on the target SHA and another on the reviewed security SHA.
   Suggested names: `pre-security-hardening-main-20260901` and
   `security-hardening-reviewed-20260901`.
3. Create `integration/security-hardening-p0-staging` from `security/hardening-p0`.
4. Merge the pinned target SHA `69b4040a993689c63990f3064e58c321254836c5` with `--no-ff`.
5. Resolve all 13 conflicts once. Preserve opaque BFF sessions, no browser Supabase authority,
   server-derived tenant/owner fields, and fail-closed integrations. Port the target's newer payment
   rules and report calculations through the hardened server/domain boundary. Keep
   `lib/paymentConfig.js` deleted unless its newer business constants are moved into an approved
   server-safe module. Keep generated report binaries untracked.
6. Review every auto-merged target change, not only conflict markers. Run the complete verification
   matrix from this document.
7. Because the resolution necessarily changes Auth/CRM/payment security-critical paths, create a
   fresh disposable G5 stack and repeat migrations 0018-0024, all 19 live tests, cleanup, and G6.
8. Only after a clean integration review, create an annotated staging-candidate tag and open the
   integration branch for merge into `main`. Do not fast-forward an unreviewed conflict resolution.

The current branch is therefore evidence-complete in isolation but is not yet an integrated staging
candidate against current `main`.

## Staging Checklist

`REQUIRES CONFIG` and `REQUIRES OWNER ACTION` items are fail-closed dependencies, not permission to
invent credentials. `BLOCKER` means the staging candidate must not be deployed until closed.

| Item | Status | Required staging action and proof |
| --- | --- | --- |
| Resolve current `main` divergence | BLOCKER | Resolve the 13 conflicts on the integration branch, review auto-merges, rerun G5/G6, and tag the verified candidate |
| Reconcile target Finance rules | BLOCKER | Port current `main` eligibility/cap/non-payable/Torani rules and activity/unpaid exports into the hardened server projection; update cancellation validation; prove SQL-versus-JS and PDF/Excel parity |
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
| `0018_security_foundation.sql` | `6B3CC9126A45EFB8E632E49B40DD7908DFCACB1480E48DD092918F13381CC954` |
| `0019_security_rls.sql` | `921FD013CE56906C4DC758E1D05FE4ACA9054F1833329CBA2D30CB1B46ED4002` |
| `0020_security_rpcs.sql` | `D0BFDB753A3E60083660409E088559B30F8B44284D015B0DD9E605E82EA54F23` |
| `0021_meetings_security.sql` | `458F0406B5E9FBEE8AE3B68CD48C9EC9BDBA2881FA10BEDB5E722C2A2CEBEF3E` |
| `0022_tours_security.sql` | `405516128815C6F8C6CED6D54BD10DD251F9C9880B2320FEE3850B1DB41A6C04` |
| `0023_notifications_security.sql` | `B64756E61D53A678000900E2AFF5D88C2B41FDE17E2C92A99328FB4F36FEC1EB` |
| `0024_finance_security.sql` | `9F89DFF958F0F1297FEF2606B4B6C7B0975C925330C9075ABACDF45E46122A3F` |
| Pre-cutover reverse script | `DC0690B2F03CE556A18D58D3F90E0B1A938FEADCBF5A67641FA7FA0E88D4513E` |

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
  checking referenced project authority/initial state; security-invoker directory helpers; redacted
  atomic audit triggers; service-only `app_security_posture`.
- **Verification:** call `app_security_posture` as service role; require 17/17 enabled+forced, no
  public/anon table or column grant, exact authenticated column grants/policies, fixed function
  search paths, anonymous denial, representative role projections, and denial of manager-forged
  actor/contact/house/assignee/beneficiary and tour-state INSERTs.
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
- **Expected changes:** one fixed-search-path `app_finance_summary` function returning only eight
  declared aggregate columns with caller-derived role/project/actor scope and atomic redacted audit.
- **Verification:** exact output keys; CEO/Head/Finance/Activist scopes and Coordinator denial;
  month/project/actor narrowing; SQL-versus-JS parity; search-path hijack denial; audit failure aborts
  the read contract.
- **Failure condition:** missing source/config, unexpected output key, unexplained parity delta,
  over-broad role scope, mutable search path or non-atomic audit. Roll back 0024 and stop.
- **Rollback:** transaction rollback before commit. Before application cutover, drop the function via
  the reviewed reverse script or restore `B6`.
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

- Before integration, create annotated tags on the exact target and reviewed security SHAs. Do not
  move or overwrite tags.
- If conflict resolution fails review, delete only the disposable integration branch and return to
  the immutable reviewed security tag; do not rewrite `security/hardening-p0`.
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

- Thirteen unresolved conflicts separate the reviewed security branch from current `main`; the
  combined code has not been built, G5-tested or independently reviewed.
- Current `main` Finance rules and export requirements are not yet represented by migration 0024 and
  the hardened Finance/cancellation boundary; parity of the integrated behavior is therefore unproven.
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

NOT READY TO ENTER STAGING

Exact blockers:

1. Resolve the 13 `main` integration conflicts and review all automatic merges without weakening
   the hardened BFF/RLS/authority model.
2. Reconcile current `main` Finance eligibility, cap, non-payable, Torani bonus/cancellation and
   activity/unpaid export behavior through the hardened server projection, then prove parity.
3. Rerun the complete independent security review, fresh G5 disposable LIVE workflow and G6 from the
   resolved integration commit; only that verified commit may be tagged as the staging candidate.
