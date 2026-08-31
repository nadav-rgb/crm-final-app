# CRM Mekarvim Security Hardening Evidence Report

Evidence date: 2026-08-31 (Asia/Jerusalem)

Branch: `security/hardening-p0`

Deterministic source/test cutoff before this report update: `543232aba80d58f945d54825a7b51e6ca89ac816`

This report is an engineering evidence record, not an authorization to use real sensitive data,
merge, deploy, or apply a database migration. Static contract evidence is not live database proof.
Database-backed evidence: none in this worktree because G5 did not run.

## Executive Summary

The hardening branch contains source and deterministic-test changes for a same-origin BFF, opaque
server-side sessions, server-derived authorization context, explicit field projections, and a
deny-by-default PostgreSQL/RLS contract. Local deterministic evidence covers implementation-level
authentication/session transitions, RBAC, tenant/resource checks, validation, CSRF, rate limiting,
security headers, finance/report projections, integrations, dependency compatibility, secrets, and
Android boundaries. It does not establish a database or provider runtime result.

The original hardening baseline was commit
`72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`. At that baseline, the recorded dependency audit was
3 Critical, 10 High, and 3 Moderate findings, and the application still relied on browser-held
Supabase authority and permissive database paths. The autonomous night mission began from
`6e3a950c52bc18f7e29730b0e6443762f75b81c1`. Its earlier deterministic/local checkpoint was
`a2af2026de052fd696f948a8375dcec7cc5704f7`; the final scoped re-review source/test checkpoint is
`543232aba80d58f945d54825a7b51e6ca89ac816`. Fresh local audit commands are recorded below; their
registry results are time-bound rather than a claim about deployed software.

G4 has an accepted independent review. G5 remains blocked at the controlled-live boundary because
the local Docker engine was unavailable and no alternative target was proven isolated. As a
result, migrations 0018 through 0024, direct-JWT/PostgREST isolation, provider-backed MFA, and live
cleanup/posture evidence have not been exercised.

The measured harness manifest contains 48 exact unique SEC IDs. It binds a future G5 run to exact
test observations and rejects missing, duplicate, unbound, or non-passing rows; this is static
harness verification, not a live observation.

No migration has been applied. No Supabase environment was contacted. Production is untouched.

## Findings

### Baseline-to-current severity inventory

| Evidence point | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original recorded baseline at `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c` | 3 | 10 | 3 | 0 | 16 |
| Night-mission starting state at `6e3a950c52bc18f7e29730b0e6443762f75b81c1` | 0 | 0 | 2 | 0 | 2 |
| Fresh full audit at the final-fix-wave local cutoff | 0 | 0 | 0 | 0 | 0 |
| Fresh production-only audit at the final-fix-wave local cutoff | 0 | 0 | 0 | 0 | 0 |

### Scoped closeout: C1, I1–I11, M1–M3

The re-review followed the implementation and SQL call paths for every requested finding. The
mapped deterministic suite passed 202 of 202 tests. Two residual authorization defects were proven
with focused failing regressions, corrected minimally, and committed separately before this table
was finalized. `ADDRESSED` means the reviewed source/test defect is addressed; it does not convert
blocked G5 database/provider evidence into a live pass.

| Finding | Original defect | Fix commit(s) | Test evidence | Status | Residual risk |
| --- | --- | --- | --- | --- | --- |
| `C1` | Broad direct authority/workflow mutation allowed caller-controlled ownership changes. | `bb507ec` | `authority-workflow-rpcs.test.mjs`; `migration-rls.test.mjs` | ADDRESSED | Static contract only; G5 database runtime remains unverified. |
| `I1` | CRM/BFF DTO and schema drift dropped operational fields and trusted client-created IDs. | `7eff62a` | `canonical-crm-contract.test.mjs` | ADDRESSED | Static contract only; G5 database runtime remains unverified. |
| `I2` | Legacy numeric identities and provider UUID identities could diverge across scalar and array fields. | `74450ac` | `identity-compatibility.test.mjs` | ADDRESSED | Static migration contract only; G5 database runtime remains unverified. |
| `I3` | Notification callers could supply sensitive or cross-resource delivery content. | `920b336` | `notification-callgraph.test.mjs` | ADDRESSED | Provider delivery runtime and G5 database enforcement remain unverified. |
| `I4` | Protected MFA sessions and abuse controls did not consistently bind assurance, refresh ownership, and shared buckets. | `3e87f92`, `06530d7` | `auth-service.test.mjs`; `session-csrf-rate.test.mjs`; `contacts-interactions-api.test.mjs`; `trusted-client-key.test.mjs` | ADDRESSED | Provider MFA and G5 session runtime remain unverified. |
| `I5` | Required denial audit and governance actor/session attribution could fail open or be forged. | `594983b` | `rbac-context-audit.test.mjs`; `governance-api.test.mjs` | ADDRESSED | Atomic PostgreSQL audit behavior requires G5 runtime proof. |
| `I6` | Coordinators could read raw expenses; the first correction left historical actor-owned rows readable after promotion. | `2050862`, `dc73081` | Focused RED then 22/22 GREEN in `finance-reports-feedback.test.mjs` | ADDRESSED | Static RLS contract only; G5 direct-JWT runtime remains unverified. |
| `I7` | Tour-report notes and JSON admitted unknown fields and insufficient bounds. | `a75c6ab` | `tours-api.test.mjs` | ADDRESSED | Static RPC contract only; G5 database runtime remains unverified. |
| `I8` | Directory and assignment lookups exposed broad profile/membership data. | `ec86c8f` | `governance-api.test.mjs`; `finance-reports-feedback.test.mjs` | ADDRESSED | Static projection contract only; G5 database runtime remains unverified. |
| `I9` | Privileged operational scripts could initialize secrets or remote clients before proving a bounded non-production target. | `9407592` | `operational-scripts.test.mjs` | ADDRESSED | Operator-selected target and external runtime remain residual controls. |
| `I10` | G5 evidence could overcount duplicate or unobserved cases and omit parts of the direct-JWT matrix. | `b2108b6` | `g5-evidence.test.mjs`; `task20-harness.test.mjs` | ADDRESSED | Harness contract is addressed; G5 live execution remains blocked. |
| `I11` | The report overstated evidence boundaries and did not bind exact command/status contracts. | `de92300` and this report update | `report-completeness.test.mjs` | ADDRESSED | Report evidence is time-bound; G5 live proof remains blocked. |
| `M1` | Static posture verification tolerated incomplete or unexpected grants, policies, and table posture. | `7463d9e` | `migration-rls.test.mjs`; `task20-harness.test.mjs` | ADDRESSED | Static verifier only; G5 catalog runtime remains unverified. |
| `M2` | Caller-controlled forwarding data and over-specific addresses could fragment rate-limit identity. | `06530d7` | `trusted-client-key.test.mjs`; `auth-service.test.mjs` | ADDRESSED | Trusted-proxy runtime configuration remains external and time-bound. |
| `M3` | Reminder ownership fields and broad reminder reads preserved identity ambiguity and excess projection. | `74450ac` | `identity-compatibility.test.mjs` | ADDRESSED | Static projection/migration contract only; G5 database runtime remains unverified. |

### Critical

No open Critical code or dependency finding was observed by the fresh deterministic checks. The
source changes address the baseline browser credential/directory exposure, service-role business
shortcut, permissive RLS contract, and Critical dependency findings. Their behavior on an applied
database and real provider remains unverified.

### High

No open High dependency finding was observed locally. Deterministic tests exercise the corrected
source contracts, but the absence of controlled live RLS, cross-tenant, IDOR/BOLA, and provider-MFA
proof is a release-blocking assurance gap. It is tracked as an external blocker rather than
converted into a false local pass.

### Moderate

No Moderate dependency finding remains after the targeted ExcelJS UUID override. Provider-console
configuration, credential rotation/restriction state, and staging behavior remain unverified.

### Low

The build still emits the recorded `optimizeFonts`, middleware-convention, and
`_app.getInitialProps` warnings. Gradle also reports flat-directory/deprecation warnings. These did
not fail the verified builds, but should be addressed as controlled maintenance without changing
security runtime behavior implicitly.

## Changes

### Architecture and controls

- Browser business data and authentication use same-origin APIs; the browser is not an authority
  for user, role, project, owner, actor, recipient, or audit fields.
- Supabase provider tokens remain server-side; business repositories use a user-scoped database
  client so the planned RLS layer independently rechecks authorization.
- Session identifiers are opaque, cookies are host-only and hardened, provider tokens are sealed,
  CSRF is session-bound, and session rotation/revocation/security-version checks fail closed.
- Capability-based RBAC and active project memberships constrain contacts, interactions,
  governance, meetings, tours, notifications, finance, reports, and feedback.
- Validation uses strict allowlists and size bounds; error output, audit metadata, external payloads,
  spreadsheet cells, push content, redirects, cache behavior, CORS, and CSP are constrained.
- Migrations `0018` through `0024` define the forward schema/RLS/RPC contract, but remain unapplied.
- Client-bundle, repository, history, dependency, HTTP, PDF/Excel, and Android checks are automated.

### Exact remediation commits after the mission starting point

| Commit | Change |
| --- | --- |
| `6886311e4e803ed6034cbbb01655ba7d2fa75ab8` | Patch the ExcelJS UUID dependency with compatibility tests |
| `6fa7c636521d293bfd41af54372dd5771bb25fe9` | Enforce exact HTTP verification statuses |
| `cd7879deeb8e75566270c56e84141b7dbf42f17a` | Preserve hardened error rendering |
| `98dd5252853068f553c8bd396f34f3be4e503fa8` | Add live adversarial verification artifacts |
| `4e253133f32404cc5f1ddb8505a61ae76db27782` | Harden the blocked G5 execution boundary |
| `6245dc6914c89cb7ee199f8d742d6b1ae9cc9e4e` | Correct blocked G5 lifecycle contracts |
| `d0338db44cea9078202595b71b0956ff49a4bf81` | Complete blocked G5 evidence boundaries |
| `c379bb6e741570012c05c49b2ed03014108d8223` | Harden blocked G5 stack lifecycle handling |
| `a2af2026de052fd696f948a8375dcec7cc5704f7` | Support the pinned Supabase SMTP template safely |
| `bb507ec` | C1: remove direct authority/workflow mutation and add immutable source contracts |
| `7eff62a` | I1: reconcile the CRM/BFF schema, DTO, and server-created-ID contract |
| `74450ac` | I2/M3: maintain UUID/legacy pairs and use an exact reminder projection |
| `920b336` | I3: route notifications through resource-derived events and generic push payloads |
| `3e87f92` | I4: correct protected-session assurance and shared abuse-control source contracts |
| `594983b` | I5: make required audit/correlation and governance attribution contracts fail closed |
| `2050862` | I6: deny raw Coordinator expense access |
| `a75c6ab` | I7: make tour-report notes/JSON validation strict |
| `ec86c8f` | I8: replace broad directory access with scoped projections/validation |
| `9407592` | I9: guard service-role operational scripts before environment or remote access |
| `06530d7` | M2: canonicalize trusted rate-limit keys |
| `7463d9e` | M1: make the static security-posture verifier fail closed |
| `b2108b6` | I10: measure the exact G5 evidence manifest and direct-JWT matrix contract |
| `de92300` | I11: correct final-report evidence boundaries and command contracts |
| `dc73081` | I6 closeout: deny historical raw-expense reads after an Activist becomes a Coordinator |
| `543232a` | Close stale-membership owner paths for reminders, tours, bonus cancellations, and feedback |

The report-update commit is intentionally reported in the Git handoff rather than embedded in its
own content-addressed document.

## Authentication & Session

The BFF authenticates against Supabase Auth on the server. The browser receives only an opaque
`__Host-mekarvim_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no
`Domain`. Provider access/refresh material is sealed at rest with versioned authenticated
encryption and is never returned to browser code.

Session loading source code validates revocation, idle and absolute expiry, disabled-user state,
`security_version`, authentication state, and AAL. Login, MFA completion, recovery/privilege
transitions, and token refresh have deterministic source/test contracts for security-state rotation;
logout revokes server state before clearing the cookie. CSRF tokens are bound to a session and
rotate with it. Shared fail-closed rate-limit and refresh-claim/CAS behavior is tested locally in
the implementation; provider-backed persistence and factor lifecycle have not been measured.

Deterministic tests prove the named implementation behavior: generic login failure, cookie/session
mechanics, ciphertext tamper rejection, fixation/replay rejection, expiry, revocation,
disabled/stale-user rejection, CSRF mismatch, rate-limit boundaries, and AAL gates. They do not
prove the Supabase provider's live TOTP enrollment/challenge behavior. CEO and Project Head AAL2
provider behavior is therefore unverified until a controlled isolated target is available.

## Authorization

Authorization derives identity, global role, active memberships, AAL, and user-scoped database
context on the server. Request path/project identifiers narrow a query but never grant authority.
Unknown or security-sensitive authority fields in a body are rejected rather than trusted.

| Role | Enforced scope | Sensitive-data rule |
| --- | --- | --- |
| CEO | Organization-wide, only with AAL2 for protected operations | Full required business projection; never authentication secrets |
| Project Head | Active memberships in owned projects, with AAL2 for protected operations | Project-scoped PII and governed lower-role membership operations |
| Coordinator | Active project memberships | Operational project projection; no role administration or hard delete authority |
| Activist | Active project memberships and assigned/owned resources | Assigned contacts and self-created operational records only |
| Finance | Active project memberships | Aggregate payment/expense projection without contact or religious PII |

Deterministic API/domain tests cover source-level same-project cross-user access, cross-project IDs,
direct URL changes, forged body authority, privilege escalation, notification recipients, finance
narrowing, and field projection. Live cross-tenant, IDOR, RLS, and provider MFA behavior is UNVERIFIED.

## Database / RLS Matrix

The static migration contract classifies 17 protected tables plus one classified view. Each table
is declared with RLS enabled and forced, and the view is `security_invoker`. The status in every row
below means source/static-test evidence only; no row is a claim about a running database. The
inventory, grant, policy, and immutable-column source assertions are exercised by
`tests/security/rls-live.test.mjs`, `tests/security/g5-evidence.test.mjs`, and the migration-static
tests selected by `npm run test:security`; they are not database-backed results.

| Object | Evidence status | RLS | SELECT | INSERT | UPDATE | DELETE | Relevant RPC/control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `projects` | Static PASS; live UNVERIFIED | Enable + force | CEO or active member scope | CEO | CEO | CEO | Server project allowlist; `app_is_ceo` |
| `project_memberships` | Static PASS; live UNVERIFIED | Enable + force | Self, CEO, or scoped Head | No direct grant | No direct grant | No direct grant | Service-only `app_membership_change`; anti-self-escalation and session invalidation |
| `profiles` | Static PASS; live UNVERIFIED | Enable + force | Self, CEO, or scoped directory projection | Provisioning only | Non-authority self fields/RPC-governed security state | Provisioning only | `app_user_security_invalidate`; field projection |
| `contacts` | Static PASS; live UNVERIFIED | Enable + force | CEO; Head/Coordinator project; assigned Activist | Same authorized scope with derived tenant/owner | Limited business columns; immutable authority trigger | CEO | `check_contact_duplicate`; BFF field allowlists |
| `interactions` | Static PASS; live UNVERIFIED | Enable + force | CEO; managers in project; actor on assigned contact | Actor/project/contact derived | Limited business columns; immutable authority trigger | CEO/Head or constrained actor workflow | Row audit trigger and user-scoped repository |
| `base_meeting_reports` | Static PASS; live UNVERIFIED | Enable + force | Project managers or assigned actor | Derived project/actor | Limited business columns; immutable authority trigger | CEO/Head scope | Row audit trigger and meeting command validation |
| `meeting_houses` | Static PASS; live UNVERIFIED | Enable + force | Project/assignment scope | CEO/Head/Coordinator in project | Limited business columns; immutable authority trigger | CEO/Head project | Assignment/resource checks; row audit trigger |
| `meeting_reminders` | Static PASS; live UNVERIFIED | Enable + force | Recipient or project managers | Authorized workflow with derived recipient | No broad direct grant | No broad direct grant | `app_cancel_meeting_reminders`; idempotency/cancellation controls |
| `tours` | Static PASS; live UNVERIFIED | Enable + force | Managers in project or assigned Activist | CEO/Head/Coordinator project | Limited non-report columns; immutable authority/workflow trigger | CEO/Head project | `app_submit_tour_report` derives reporter; cancellation controls |
| `expenses` | Static PASS; live UNVERIFIED | Enable + force | Self or CEO/Head/Finance project scope | Self with derived project/actor | Self-pending or authorized project workflow | Self-pending or CEO/Head policy | User-scoped repository and row audit trigger |
| `bonus_cancellations` | Static PASS; live UNVERIFIED | Enable + force | Self or management/finance scope | Authorized approver only | No direct grant | CEO-only direct delete | Candidate/resource validation and row audit trigger |
| `payment_config` | Static PASS; live UNVERIFIED | Enable + force | Active authenticated projection | CEO | CEO | No direct grant | Explicit payment projection |
| `notifications` | Static PASS; live UNVERIFIED | Enable + force | Recipient only | No direct grant | Recipient read-state column only | Recipient/expiry workflow | `app_enqueue_notification_event` derives project and recipients |
| `notification_reads` | Static PASS; live UNVERIFIED | Enable + force | Recipient only | Recipient equals caller | Recipient equals caller | Recipient equals caller | Caller-derived ownership |
| `push_subscriptions` | Static PASS; live UNVERIFIED | Enable + force | Owner only | Owner equals caller | Limited payload column; immutable owner trigger | Owner/service cleanup | Generic payload and internal-link allowlist |
| `fcm_tokens` | Static PASS; live UNVERIFIED | Enable + force | Owner only | Owner equals caller | Limited token/platform fields; immutable owner trigger | Owner/service cleanup | Server-derived recipient and provider wrapper |
| `feedback_reports` | Static PASS; live UNVERIFIED | Enable + force | Creator, CEO, or scoped Head | Actor/project derived | Reviewer or constrained creator workflow | CEO | External forwarding disabled/fail closed; row audit trigger |
| `activist_directory` | Static PASS; live UNVERIFIED | Security-invoker view over protected sources | Membership/finance-specific projection | Not applicable | Not applicable | Not applicable | No independent authority; source-table RLS applies |

Private supporting objects are outside the exposed `public` data surface. Static migrations revoke
their tables from `public`, `anon`, and `authenticated`:

| Private object | Static control | Authorized path | Live status |
| --- | --- | --- | --- |
| `auth_identities` | Private schema; no direct client grant | Service-only identity resolution | UNVERIFIED |
| `auth_sessions` | Private schema; encrypted provider material and hashed opaque IDs | Service-only create/load/touch/rotate/revoke/refresh RPCs | UNVERIFIED |
| `audit_events` | Private append storage; redacted metadata | Service-only append plus controlled row triggers | UNVERIFIED |
| `rate_limit_buckets` | Private atomic bucket storage | Service-only atomic consume RPC | UNVERIFIED |

The static suite verifies migration ordering, object inventory, forbidden permissive predicates,
fixed search paths, narrow grants, `WITH CHECK` contracts, RPC dependencies, audit redaction, and
pre-cutover rollback ordering. Live database posture is UNVERIFIED. No live RLS table count is
reported.

## Test Evidence

Fresh final-fix-wave verification was performed from the reviewed source/test checkpoint
`543232aba80d58f945d54825a7b51e6ca89ac816` and the report/test correction in this change. The full
security suite contains 19 explicit live skips; they are skips, not passes. Commands below are
literal sanitized reproductions of the commands used in this Windows worktree. Android SDK
variables were set only in the Gradle process. The loopback launcher used synthetic settings and a
closed loopback provider URL; it did not contact Supabase.

| Command | Status | Exact result |
| --- | --- | --- |
| `npm ci` | PASS (exit 0) | 277 packages installed; 278 audited; 0 vulnerabilities; deprecation warnings only |
| `npm run test:baseline` | PASS (exit 0) | 51 total; 51 pass; 0 skip; 0 fail (27 interaction + 24 payment) |
| `npm run verify:interaction-report` | PASS (exit 0) | 27 total; 27 pass; 0 skip; 0 fail |
| `node scripts/verify-payment-order.cjs` | PASS (exit 0) | 24 total; 24 pass; 0 skip; 0 fail |
| `npm run test:security` | PASS (exit 0) | 329 total; 310 pass; 19 explicit live skips; 0 fail; known module-type and synthetic-fixture LF-to-CRLF warnings only |
| `node --test tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs` | PASS (exit 0) | 32 total; 32 pass; 0 skip; 0 fail |
| `npm run test:security -- tests/security/report-completeness.test.mjs` | PASS (exit 0) | 7 total; 7 pass; 0 skip; 0 fail; scoped-table RED was 7 total, 6 pass, 1 missing-table failure |
| `npm run build` | PASS (exit 0) | Next.js 16.3.3 Webpack production build; known `optimizeFonts`, middleware-convention, and `_app.getInitialProps` warnings only |
| `node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs` | PASS (owned process started) | Synthetic production server ready on `127.0.0.1:43877`; pre-start listener count 0 |
| `$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs` | PASS (exit 0) | exact 200/401/403/404/500; required headers; five unique nonces; no wildcard CORS; verifier PASS |
| `Ctrl+C` to the owned launcher; `Get-NetTCPConnection -LocalPort 43877 -State Listen` | PASS (cleanup check) | Owned launcher stopped; 0 listeners on port 43877 |
| `node scripts/security/scan-client-bundle.mjs` | PASS (exit 0) | 0 findings; `client-bundle clean` |
| `node scripts/security/scan-secrets.mjs --current` | PASS (exit 0) | 0 findings; `secret-scan clean` |
| `node scripts/security/scan-secrets.mjs --tracked` | PASS (exit 0) | 0 findings; `secret-scan clean` |
| `node scripts/security/scan-secrets.mjs --history` | PASS (exit 0) | 0 findings; `secret-scan clean` |
| `npm audit --json` | PASS (exit 0) | 0 Critical; 0 High; 0 Moderate; 0 Low; 0 total; 310 dependencies in metadata |
| `npm audit --omit=dev --json` | PASS (exit 0) | 0 Critical; 0 High; 0 Moderate; 0 Low; 0 total; 310 dependencies in metadata |
| `node --test tests/security/android-hardening.test.mjs` | PASS (exit 0) | 6 total; 6 pass; 0 skip; 0 fail |
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (-not (Test-Path -LiteralPath $taskAndroidSdk)) { throw 'Android SDK unavailable' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android testDebugUnitTest assembleDebug` | PASS (exit 0) | Process-only SDK environment; BUILD SUCCESSFUL in 11s; 169 actionable tasks (82 executed, 87 up-to-date); Gradle deprecation warning only |
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (Test-Path -LiteralPath 'android\keystore.properties') { throw 'keystore.properties unexpectedly exists' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android assembleRelease` | EXPECTED FAIL (exit 1) | Release signing configuration missing: android/keystore.properties; assertion PASS; failure occurred at the intended signing guard |
| `node scripts/security/g5-local-orchestrator.mjs` | BLOCKED (NOT RUN) | 19 live cases remained explicit skips; Docker API pipe `dockerDesktopLinuxEngine` was absent and the daemon was unavailable; no isolated target; no migration or live case ran |
| `node scripts/verify-month-report.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person-level output; no approved isolated source |
| `node scripts/verify-payroll-xlsx.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person/payroll output; no approved isolated source |
| `git diff --check` | PASS (exit 0) | 0 whitespace errors; checked before each final report commit |
| `git status --short --branch` | PASS (exit 0) | `## security/hardening-p0`; tracked tree clean after the final-report commit |

The earlier accepted Task-20 blocked-boundary review independently recorded 264 total security
tests, 248 passes, 16 explicit live skips, and no failures. It predates the I10 manifest expansion.
The G5 harness now names 19 future live tests in a 48-case measured manifest and remains guarded;
it was not invoked against any database in this task.

## Negative / Adversarial Tests

The table separates deterministic local outcomes from live cases that remain unproven. Actor and
resource names are synthetic classes only.

| Case | Actor/resource | Layer | Expected outcome | Evidence status |
| --- | --- | --- | --- | --- |
| Anonymous PII read | Anonymous / protected row | PostgreSQL RLS | Denied | UNVERIFIED live; static policy contract only |
| Same-project other-owner contact | Activist / another assigned contact | BFF repository + RBAC | Concealed 404 | PASS deterministic |
| Cross-project resource ID | Coordinator / other project resource | BFF repository + RBAC | Concealed 404 | PASS deterministic |
| Client authority fields | Authenticated actor / create or update body | Strict schema | 400 before database write | PASS deterministic |
| Cross-tenant insert/update/delete | Authenticated actor / other tenant row | PostgreSQL RLS `USING` + `WITH CHECK` | Denied | UNVERIFIED live; static contract only |
| Foreign-origin mutation | Anonymous browser class / logout | Origin guard | 403 | PASS exact loopback HTTP |
| Cross-session CSRF | Authenticated actor / mutation | Session-bound CSRF | Denied | PASS deterministic |
| Expired, revoked, disabled, or stale session | Authenticated actor / protected route | Session service | Denied | PASS deterministic |
| AAL1 protected operation | CEO/Head class / PII, report, mutation | Request context + capability gate | MFA required | PASS deterministic; provider-live UNVERIFIED |
| Membership self-escalation | Head/Activist class / governance mutation | Capability + service RPC contract | 403/denied | PASS deterministic |
| Notification recipient or URL spoof | Authenticated actor / notification event | Schema + domain + RPC contract | 400/403/denied | PASS deterministic |
| Finance scope/filter forgery | Finance/Coordinator class / aggregate report | Capability + caller-derived RPC arguments | Denied or narrowed | PASS deterministic |
| Audit read by ordinary user | Authenticated actor / audit storage | Private schema + grants | Denied | Static PASS; live UNVERIFIED |
| Direct PostgREST bypass | Authenticated role classes / classified surfaces | User JWT + PostgreSQL RLS | Denied outside exact scope | UNVERIFIED live; measured harness contract only |
| RLS ownership transfer | Authenticated actor / tenant-owner columns | Column grants + immutable trigger/RPC | Denied | UNVERIFIED live; source/static contract only |
| Unsafe external configuration | Server integration / missing or public target | Integration guard | Disabled/fail closed | PASS deterministic |
| Secret leakage to client | Browser bundle / server-only categories | Bundle scanner | No finding | PASS local build scan |

## Dependencies

Fresh installed versions and both audit modes were inspected after `npm ci`:

| Package | Installed version | Control/evidence |
| --- | --- | --- |
| Node.js | 24.18.0 | Satisfies the declared `>=20.9.0` floor |
| Next.js | 16.3.3 | Exact pin; Webpack build passed |
| React / ReactDOM | 18.3.1 / 18.3.1 | Version preserved across the Next upgrade |
| PostCSS | 8.5.23 | Patched transitive version under Next |
| jsPDF / AutoTable | 4.2.1 / 5.0.8 | Exact pins; Node/browser/PDF/RTL compatibility passed |
| ExcelJS | 4.4.0 | Production report and payroll workbooks reopened successfully |
| UUID under ExcelJS | 11.1.1 | Targeted override; one overridden copy; conditional-formatting path passed |
| Capacitor Android / CLI / Core | 8.4.1 / 8.4.1 / 8.4.1 | Static and debug/unit Android verification passed |
| Supabase JavaScript client | 2.105.1 | Server/user-client boundary tests passed; no live provider claim |
| Zod | 3.25.76 | Strict input validation tests passed |

Audit counts are exactly 0 Critical, 0 High, 0 Moderate, 0 Low, and 0 total in both full and
production-only modes. Audit results are time-bound registry evidence, not a permanent guarantee.

## Secrets

Fresh current-tree, tracked-file, Git-history, and built-client scans each returned zero findings.
The scanners report only category/location/count metadata and never values. No credential, JWT,
session identifier, MFA seed, cookie, signing material, or person-level evidence is included here.

Server-only configuration remains environment-only. Firebase client configuration is treated as
public application configuration and still requires owner confirmation of console-side API and
application restrictions. Provider credential rotation/restriction status was not observable from
the repository and remains an owner action.

## External Integrations

| Integration | Deterministic control | Live/provider status |
| --- | --- | --- |
| Anthropic | Opt-in server projection, redaction, size/rate/timeout controls, fail closed without configuration | Consent/DPA/configuration and provider behavior UNVERIFIED |
| Google Sheets | Private service-account adapter and exact sheet/range allowlist; public CSV fallback rejected | Credentials, private-sheet access, and provider behavior UNVERIFIED |
| GitHub feedback | Disabled by default; private-target requirement; redacted payload contract | Private repository/token scope or permanent disable decision UNVERIFIED |
| Push/FCM/VAPID | Source/test contract derives tokens/recipients and accepts only a generic lock-screen payload with internal deep links | Console restrictions, device delivery, and token lifecycle UNVERIFIED |
| Scheduled jobs | Timing-safe machine authentication and fail-closed missing configuration | Approved staging scheduler behavior UNVERIFIED |

No external integration endpoint was contacted during this final fix wave.

## Android

Static evidence confirms backup and cleartext are disabled, FileProvider is limited to the dedicated
cache export directory, external browser deep-link entry points are absent, WebView file/content
access and mixed content are disabled, capture is blocked for the activity, R8 full mode is enabled,
and release cannot fall back to debug signing.

The six static checks passed. After explicitly pointing Gradle at the installed local SDK, debug
unit/build verification completed successfully. A release request with no signing configuration
failed with the exact fail-closed message and produced no release. Signed-release installation,
device behavior, remote WebView behavior, notification delivery, and store signing remain
UNVERIFIED.

## Remaining Risks

- The hardened migrations exist only as reviewed files. A real database may contain schema, grants,
  policies, functions, views, or data-shape differences that static tests cannot observe.
- Direct JWT/PostgREST cross-user and cross-project enforcement, immutable-authority behavior,
  anonymous posture, audit privacy, finance parity, and cleanup remain unproven against PostgreSQL.
- Supabase TOTP enrollment/challenge, AAL2 claims, password recovery, provider refresh/revocation,
  and dashboard settings remain unproven end to end.
- Staging CSP/HSTS/cache/CORS behavior, external provider configuration, mobile device behavior, and
  provider-side key restrictions have not been verified.
- Build and Gradle warnings are residual maintenance risks even though the verified commands pass.
- Dependency audit results can change as advisories evolve; scheduled re-audit remains necessary.

## External Blockers

1. The Docker daemon remains down. The exact blocker is the zero-byte, non-directory runtime
   reparse/socket artifact
   `C:\Users\nadav\AppData\Local\Docker\run\dockerInference`. Windows returned error 1920 for both
   authorized narrow literal-entry mechanisms: `fsutil reparsepoint delete` and an in-memory Win32
   `CreateFileW` delete-on-close attempt using `FILE_FLAG_OPEN_REPARSE_POINT`. Neither mechanism
   opened or removed the entry, and no neighboring artifact was modified.
2. No compatible installed local container runtime, standalone PostgreSQL/Supabase stack, or
   independent full-stack WSL distribution exists. No configured or provable dedicated TEST
   Supabase target exists. The cached pinned Supabase CLI payload is not a substitute for its
   unavailable container engine. No migration or live G5 case ran.
3. The required next action is separately authorized elevated/offline repair limited to the exact
   `dockerInference` entry (potentially after a host reboot), or separately authorized provisioning
   of a compatible isolated runtime. Never use a broad reset, recursive delete, prune, Docker data
   directory removal, volume removal, or WSL removal as a substitute.
4. After an isolated runtime is proven, capture the required pre-migration snapshot/backup, then
   execute the guarded G5 orchestrator in
   the sole approved order `0018` through `0024`, stopping on any failed verification.
5. Complete all 19 currently skipped live cases, including direct-JWT/PostgREST RLS, cross-tenant,
   IDOR/BOLA, audit, finance parity, cleanup, and post-cleanup posture evidence.
6. Enable and validate Supabase TOTP/AAL2, password recovery, redirect, refresh, revocation, disabled
   user, and stale-security-version behavior in the isolated target.
7. Verify staging headers/HSTS and configured Anthropic, private Sheets, private-or-disabled GitHub,
   push, scheduler, Firebase restrictions, and mobile-device behavior without using Production.
8. Confirm provider credential rotation/restriction status in the relevant consoles. Values must not
   be copied into reports or Git.
9. After all controlled evidence is green, obtain independent security review and explicit owner
   authorization before any Production migration, deployment, or real-data use.

## Rollback

No rollback was executed. Database rollback is authorized only for the disposable/pre-cutover test
state after exact backup and guard checks. It uses
`migrations/rollback/0018-0024-pre-cutover.sql` in reverse order and never restores a permissive
policy as an emergency shortcut.

| Migration/change | Pre-cutover rollback contract |
| --- | --- |
| `0024_finance_security` | Disable finance/export paths, remove the aggregate function and its narrow grants/audit dependencies after verifying no dependent use |
| `0023_notifications_security` | Disable delivery, remove event RPC/index/UUID-only ownership additions only after dependency and data guards pass |
| `0022_tours_security` | Disable tour mutations, remove report RPC, constraints/indexes, then added columns; do not retry or drop around written data |
| `0021_meetings_security` | Disable reminder scheduling, remove cancel RPC, constraints/indexes, then added columns after idempotency/data guards |
| `0020_security_rpcs` | Revoke/expire application sessions and disable BFF auth before removing service RPCs; never fall back to browser JWT auth |
| `0019_security_rls` | Remove hardened policies before helper functions only in the disposable restore path; do not re-enable broad legacy policies with sensitive data |
| `0018_security_foundation` | Allowed only when no application session or new-column-only data exists; otherwise restore the verified backup and revert application commits |

Major dependency rollback points are exact commits:

| Commit | Rollback consequence |
| --- | --- |
| `416cdb1a7027d0418960c81e65daa4c13a64cee6` | Reverts the initial Critical web dependency remediation; real-data use remains blocked until a safe alternative is verified |
| `d6c401d7f8263317440d1169033f834a3658acbe` | Reverts the jsPDF 4.2.1 upgrade and compatibility suite; PDF/report use remains disabled until replaced safely |
| `6e3a950c52bc18f7e29730b0e6443762f75b81c1` | Reverts the Next 16.3.3/PostCSS remediation; deployment remains blocked until patched replacement evidence exists |
| `6886311e4e803ed6034cbbb01655ba7d2fa75ab8` | Reverts the ExcelJS UUID 11.1.1 override; spreadsheet use remains blocked until a safe compatibility path is verified |

Git rollback is a normal revert of the relevant branch commit after review. It is not a reset,
history rewrite, force push, Production action, or permission to restore an insecure client path.

## Final Verdict

NOT READY FOR REAL SENSITIVE DATA
