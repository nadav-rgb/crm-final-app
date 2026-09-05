# CRM Mekarvim Security Hardening Evidence Report

Evidence date: 2026-09-05 (Asia/Jerusalem)

Branch: `staging/security-integrated`

Initial approved staging source checkpoint: `1be52be54a88b312484d9b53a8dede9c3e0d4230`

Starting checkpoint: `5340d9763ce27d396bbc79bf33f342933bedceb8`

Hardened base: `0153a8acb242d25ee259c2c626bb86c9899d6a95`

Pinned current-main input: `69b4040a993689c63990f3064e58c321254836c5`

Merge base: `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`

Current deployed application source and final G6 test checkpoint: `16c737527911677675b8897a9021b74c806435ab`

Documentation closeout: this non-runtime report/test-contract commit is the final branch HEAD; its exact local/remote
identifier and the current branch Preview are verified after commit and push in the final handoff.

This is a time-bound engineering evidence record. It is not authorization to merge, deploy, use
real sensitive data, or apply these migrations to Production.
Static contract evidence and live database proof are reported separately.

## Executive Summary

A fresh disposable local Supabase project, `mekarvim-security-g5-f513a76122c5`, was created solely
for CRM Mekarvim G5. Its identity, dedicated ports, exact container labels and loopback-only
listeners were proven before any destructive reset. No existing database was reused.
No remote Supabase environment was contacted. Production is untouched.

Migrations 0018 through 0024 were applied sequentially with a catalog snapshot and verification
after each step, then rolled back, reapplied, and verified again. All 49 migration checks passed.
The measured chain result was: 49/49 migration checks passed.
The measured harness manifest contains 48 exact unique SEC IDs.
Database-backed G5 evidence: 48/48 exact cases matched expected outcomes. All 19 previously gated LIVE tests executed against
the isolated project: 19 live tests; 19 pass; 0 skip; 0 fail.

Live database posture — PASS. Live cross-tenant, IDOR, RLS, and provider MFA behavior — PASS.
Finance SQL-versus-JS parity, atomic/redacted audit behavior, session/CSRF/rate-limit transitions,
disabled/stale-user rejection and local GoTrue TOTP/AAL2 behavior all passed. Exact fixture cleanup
reduced every registered primary and derived resource to zero; the post-cleanup probe found
anonymous leaks `0`; 17/17 RLS enabled and forced.

The disposable project was then stopped and removed. The final project-scoped proof was:
Containers `0`; volumes `0`; networks `0`; listeners `0`. Read-only before/after fingerprints for
the excluded `mekusharim` and `shabbat-hosting` stacks matched. All 18/18 excluded container metadata records matched.
Only read-only Docker metadata was inspected. Neither excluded stack was stopped or restarted, and
no container exec, database query, network request, migration, cleanup or mutation targeted either stack.

The pinned current-main commit was merged into the hardened base in a dedicated branch. All 13
known conflicts were resolved by retaining current business behavior behind the hardened BFF/RBAC/
RLS boundary. Generated report binaries and deleted insecure browser paths were not restored.

G6 was rerun from application commit `16c7375`: baseline 124/124, security 353 pass plus 19 explicit
local-live gates and zero failures, activity verification 64/64, focused finance/PDF/Excel 36/36,
production Webpack build, HTTP/CSP,
Android debug, secret scans, bundle scan and dependency audits all passed. The 19 deterministic
suite skips are environment gates whose corresponding live tests were measured separately in G5.

Hosted staging closeout was then performed only against Supabase project
`khnojemwdjkrzjbcryrm` (`mekarvim-staging`, `eu-central-1`) and the Vercel Preview branch
`staging/security-integrated` for project `crm-final-app`. The schema-only baseline and 0018 were
not replayed. Migrations 0019 through 0024 were applied in order with a successful verification
after every step. A real legacy JSONB assignment incompatibility and anonymous legacy auth helper
exposure were fixed RED-to-GREEN in commits `bdbf384`, `1b0be0a` and `38fdd8c` before continuation.

The hosted synthetic run passed direct JWT/PostgREST cross-user and cross-project isolation,
IDOR/BOLA and authority-transfer denial, real TOTP/AAL2, Preview BFF session rotation/CSRF/logout,
Finance SQL-versus-JS parity, audit generation, five-status HTTP/CSP nonce checks and integration
fail-closed behavior. Exact cleanup returned Auth, public fixtures, identities, sessions,
rate-limit buckets and notification outbox rows to zero. The remaining 65 synthetic audit rows
were deleted only by their previously captured UUID list in one transaction: pre-count 65,
deleted-count 65 and exact-UUID residue 0; all audit rows then measured 0. The final posture
remained 17/17 forced RLS, 57 policies, zero forbidden anonymous grants, zero external grants on
`app_private`, zero legacy auth functions and zero staging fixture functions. The final Security
Advisor result was 0 errors, 0 anonymous warnings and 25 approved authenticated-only
SECURITY DEFINER RPC warnings. Exact-deployment Vercel logs contained 0 error/fatal/5xx events.

A final continuation pass found that several older Vercel variables were still jointly targeted
to Preview and Production even though staging overrides masked the Supabase and cron values. Their
values were never read or changed. Target-only API updates removed only the Preview target from
those older entries, leaving their Production target and value intact. The resulting Preview
inventory contains exactly 17 variables, all scoped only to `staging/security-integrated`; no
shared Production credential remains available to Preview.

Vercel adds `no-cache`, `must-revalidate` and `max-age=0` to the application's required `no-store,
private` response. The hosted verifier initially treated that secure superset as a RED exact-string
mismatch. Commit `de71669fdb11c86b6e6f344eee560804d9b31224` added regression coverage that
accepts restrictive additions while still rejecting `public` and `s-maxage`. The focused test, the
complete security suite, local HTTP verification and hosted HTTP verification all returned GREEN.
Final tested application Preview deployment `dpl_A7rmokNxHnLS7ctwQXidmgeUKhFo` is Ready, target
`preview`, from branch `staging/security-integrated` at application commit
`16c737527911677675b8897a9021b74c806435ab`. Its unique URL is
`https://crm-final-4xcgnddlr-nadav-rgbs-projects.vercel.app`.

## Findings

### Severity inventory

| Evidence point | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original recorded dependency baseline | 3 | 10 | 3 | 0 | 16 |
| Fresh full dependency audit | 0 | 0 | 0 | 0 | 0 |
| Fresh production-only dependency audit | 0 | 0 | 0 | 0 | 0 |

### Scoped closeout: C1, I1–I11, M1–M3

`ADDRESSED` means the reviewed defect has deterministic coverage and, where applicable, measured
G5 database/runtime evidence. It does not remove the remaining operational controls listed later.

| Finding | Original defect | Fix commit(s) | Test evidence | Status | Residual risk |
| --- | --- | --- | --- | --- | --- |
| `C1` | Broad direct authority/workflow mutation allowed caller-controlled ownership changes, including pre-seeding a fabricated derived bonus cancellation. | `bb507ec`, `9d6aea5`, `75bda2a` | Authority/RLS static suite and direct-JWT G5 matrix, including manager-forged INSERT authority, same-project future-key denial and validated derived-candidate RPC | ADDRESSED | Evidence is time-bound to this G5 runtime. |
| `I1` | CRM/BFF DTO and schema drift dropped operational fields and trusted client-created IDs. | `7eff62a` | Canonical CRM contract and migrated synthetic fixtures | ADDRESSED | Evidence is time-bound to the tested runtime contract. |
| `I2` | Legacy numeric identities and provider UUID identities could diverge. | `74450ac` | Compatibility suite and live authority-transfer rejection | ADDRESSED | Evidence is time-bound to the G5 fixtures. |
| `I3` | Notification callers could supply sensitive or cross-resource delivery content. | `920b336` | Notification callgraph and live resource-derived RPC checks | ADDRESSED | External provider runtime remains operator-controlled. |
| `I4` | MFA sessions and abuse controls did not consistently bind assurance and shared buckets. | `3e87f92`, `06530d7` | Session suite plus local GoTrue TOTP/AAL2 G5 proof | ADDRESSED | Provider-console policy is an external runtime control. |
| `I5` | Denial audit and governance actor/session attribution could fail open or be forged. | `594983b`, `0c6a9ce` | Audit suite and transaction-local PostgreSQL assertion | ADDRESSED | Audit evidence is time-bound to G5. |
| `I6` | Coordinators could read raw expenses and historical rows after promotion. | `2050862`, `dc73081` | Finance suite and direct-JWT role projection | ADDRESSED | Finance evidence is time-bound to synthetic G5 data. |
| `I7` | Tour-report notes and JSON admitted unknown fields and insufficient bounds. | `a75c6ab` | Tour API suite and live malformed-report denial | ADDRESSED | Evidence is time-bound to the tested runtime. |
| `I8` | Directory and assignment lookups exposed broad profile/membership data. | `ec86c8f` | Governance/finance suites and live role projection | ADDRESSED | Evidence is time-bound to G5. |
| `I9` | Privileged scripts could initialize secrets or remote clients before target proof. | `9407592` | Operational preflight and exact G5 identity guard | ADDRESSED | Operator target selection remains an operational control. |
| `I10` | G5 evidence could overcount or omit direct-JWT matrix cases. | `b2108b6` and G5 harness fixes | 48 unique measured cases with observed outcomes | ADDRESSED | Evidence manifest is time-bound to this G5 run. |
| `I11` | The report overstated evidence boundaries and lacked exact command contracts. | `de92300` and this update | Report-completeness contract | ADDRESSED | Report evidence remains time-bound. |
| `M1` | Posture verification tolerated incomplete grants, policies and table posture. | `7463d9e`, `180c90f`, `e148ce7` | 49 migration checks and final 17/17 forced-RLS probe | ADDRESSED | Catalog evidence is time-bound to G5. |
| `M2` | Caller-controlled forwarding data could fragment rate-limit identity. | `06530d7` | Trusted-client and live shared-bucket tests | ADDRESSED | Trusted-proxy runtime configuration remains operator-controlled. |
| `M3` | Reminder ownership and reads preserved identity ambiguity and excess projection. | `74450ac` | Compatibility suite and live reminder boundaries | ADDRESSED | Evidence is time-bound to G5. |

No open deterministic Critical, High, Moderate or Low dependency finding was observed. Remaining
non-blocking build and Gradle warnings are recorded below as maintenance risks.

The integration-delta review found five Important issues: unpaginated Finance history, SQL/JS
friendly-window and anchor mismatch, reassigned Torani actor loss, an unreachable Coordinator
cancellation UI, and collapsed notification event semantics. Commit `e148ce7` fixed all five with
RED-to-GREEN regressions. The fixes paginate complete histories, use calendar month ordinals,
preserve historical earning actors, expose only candidate-scoped Coordinator cancellation, and
derive self/management notification recipients from persisted payment facts.

The final independent review of exact report checkpoint `409f077` found zero Critical and zero
Important findings. It rechecked the complete integration delta, all conflict resolutions, the five
fixes above, migration/rollback contracts, Finance parity and report accuracy, and recommended the
integrated branch for staging entry.

## Changes

- Browser authentication and business data use same-origin BFF routes; browser input cannot provide
  authoritative actor, role, project, owner, recipient or audit fields.
- Server sessions are opaque, host-bound, rotated and revocable; provider tokens remain server-side.
- Authorization derives from active membership, role, project, resource ownership and AAL.
- PostgreSQL migrations enable and force RLS on 17 protected tables, narrow grants and install
  actor-derived, resource-derived RPCs with fixed search paths.
- Audit storage is private, append-only through controlled functions and redacted.
- Finance, notification, tour, reminder, governance and reporting projections are allowlisted.
- Current-main short-contact, friendly-window/cap, Torani, Torani-bonus/cancellation, activity,
  unpaid and export behavior now executes through the hardened server-owned Finance boundary.
- G5 infrastructure now creates an exact disposable project, enforces loopback Docker publishing,
  measures evidence, performs exact cleanup and proves project-scoped destruction.
- The integration branch preserves the hardened base as a rollback reference and records the pinned
  current-main merge plus separate Auth, Finance, Activities, reports/exports, UI and review-fix
  commits. Each deterministic integration defect received regression coverage before the final G5.

## Authentication & Session

Local deterministic and G5 evidence covered:

- unknown-user/bad-password response equivalence and shared login-rate enforcement;
- new opaque session creation, rotation, replay rejection, logout revocation and expiry;
- idle, absolute, disabled-user, stale-security-version and recovery-session denial;
- session-bound CSRF with foreign-origin and mismatched-token rejection;
- Head/CEO AAL1 denial and AAL2 authorization for protected operations;
- real local GoTrue TOTP enrollment, challenge, verification, AAL2 rotation and factor reset.

No provider token, generated credential, factor secret or person-level fixture value is retained in
the report or committed evidence.

## Authorization

The LIVE matrix verified anonymous denial, cross-user and cross-project isolation, same-project
ownership, role projections, membership removal, IDOR/BOLA concealment, authority-transfer denial,
legacy/UUID invariants, notification/reminder/tour workflow boundaries and Finance scope.
Coordinator, Activist, Head, Finance and CEO paths were tested with their required AAL. Direct
PostgREST/JWT observations, not caller attestations, produced the G5 evidence rows.

The classified surface is 17 protected tables plus one classified view. Live anonymous isolation
covered all 18 surfaces; no anonymous row leak was observed before or after fixture cleanup.

## Database / RLS Matrix

| Object | Evidence status | RLS | SELECT | INSERT | UPDATE | DELETE | Relevant RPC/control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `projects` | Static PASS; live PASS | Enable + force | Active scoped membership | Service workflow only | Service workflow only | Service workflow only | Membership-derived project scope |
| `project_memberships` | Static PASS; live PASS | Enable + force | Own/scoped directory | Governance RPC | Governance RPC | Governance RPC | AAL2 and last-CEO guard |
| `profiles` | Static PASS; live PASS | Enable + force | Role-specific projection | Service identity flow | Self-safe fields only | Denied | UUID identity invariant |
| `contacts` | Static PASS; live PASS | Enable + force | Own or scoped manager | Derived actor/project | Own or scoped manager | Audited RPC | Cross-user/project IDOR denial |
| `interactions` | Static PASS; live PASS | Enable + force | Contact-derived scope | Derived actor/contact | Scoped mutation | Audited RPC | Contact authority rechecked |
| `base_meeting_reports` | Static PASS; live PASS | Enable + force | Resource-derived scope | Reporter-derived RPC | Report fields only | Denied | Actor/project/house derived |
| `meeting_houses` | Static PASS; live PASS | Enable + force | Assigned/scoped manager | Manager workflow | Narrow manager workflow | Denied | Assignment validation RPC |
| `meeting_reminders` | Static PASS; live PASS | Enable + force | Exact recipient scope | Scheduler RPC | Denied | Recipient cancel RPC | Recipient and resource derived |
| `tours` | Static PASS; live PASS | Enable + force | Assigned/scoped manager | Manager workflow | Split authority RPCs | Manager RPC | Report/assign/status separation |
| `expenses` | Static PASS; live PASS | Enable + force | Owner or Finance scope | Actor/project derived | Owner-safe fields | Manager audited RPC | Coordinator raw read denied |
| `bonus_cancellations` | Static PASS; live PASS | Enable + force | Approved projection | Validated derived-candidate RPC; no direct table grant | Denied | CEO only | Resource, actor, month, type and amount recomputed |
| `payment_config` | Static PASS; live PASS | Enable + force | Approved projection | Service only | Service only | Service only | Narrow Finance projection |
| `notifications` | Static PASS; live PASS | Enable + force | Recipient only | Event RPC only | Denied | Denied | Event/resource-derived payload |
| `notification_reads` | Static PASS; live PASS | Enable + force | Own recipient only | Own marker | Own marker | Own marker | Recipient derived from JWT |
| `push_subscriptions` | Static PASS; live PASS | Enable + force | Own only | Own endpoint | Own endpoint | Own endpoint | No recipient spoofing |
| `fcm_tokens` | Static PASS; live PASS | Enable + force | Own only | Own token row | Own token row | Own token row | No user spoofing |
| `feedback_reports` | Static PASS; live PASS | Enable + force | Reporter/scoped reviewer | Reporter/project derived | Review RPC | Denied | CEO AAL2 or scoped manager |
| `activist_directory` | Static PASS; live PASS | Security-invoker view over protected sources | Role-specific projection | Not applicable | Not applicable | Not applicable | Protected-source RLS |

The final posture inventory contained 23 public tables, 57 policies and 46 functions. Every one of
the 17 protected tables had RLS enabled and forced. Grants and function search paths matched the
approved posture verifier.

## Test Evidence

| Command | Status | Exact result |
| --- | --- | --- |
| `npm ci` | PASS (exit 0) | 277 packages installed; 278 audited; 0 vulnerabilities |
| `npm run test:baseline` | PASS (exit 0) | 124 total; 124 pass; 0 skip; 0 fail |
| `npm run verify:interaction-report` | PASS (exit 0) | 31 total; 31 pass; 0 skip; 0 fail |
| `node scripts/verify-payment-order.cjs` | PASS (exit 0) | 93 total; 93 pass; 0 skip; 0 fail |
| `node scripts/verify-activity-report.cjs` | PASS (exit 0) | 64 total; 64 pass; 0 skip; 0 fail |
| `npm run test:security` | PASS (exit 0) | 372 total; 353 pass; 19 explicit live skips; 0 fail |
| `node --test tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs` | PASS (exit 0) | 36 total; 36 pass; 0 skip; 0 fail |
| `npm run test:security -- tests/security/report-completeness.test.mjs` | PASS (exit 0) | 8 total; 8 pass; 0 skip; 0 fail |
| `npm run build` | PASS (exit 0) | Next.js 16.3.3 Webpack production build; compiled successfully |
| `node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs` | PASS (owned process started) | Next.js ready on 127.0.0.1:43877 |
| `$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs` | PASS (exit 0) | exact 200/401/403/404/500; required headers; five unique nonces; verifier PASS |
| `Ctrl+C` to the owned launcher; `Get-NetTCPConnection -LocalPort 43877 -State Listen` | PASS (cleanup check) | 0 listeners |
| `node scripts/security/scan-client-bundle.mjs` | PASS (exit 0) | 0 findings; client-bundle clean |
| `node scripts/security/scan-secrets.mjs --current` | PASS (exit 0) | 0 findings; secret-scan clean |
| `node scripts/security/scan-secrets.mjs --tracked` | PASS (exit 0) | 0 findings; secret-scan clean |
| `node scripts/security/scan-secrets.mjs --history` | PASS (exit 0) | 0 findings; secret-scan clean |
| `npm audit --json` | PASS (exit 0) | 0 Critical; 0 High; 0 Moderate; 0 Low; 0 total; 310 dependencies in metadata |
| `npm audit --omit=dev --json` | PASS (exit 0) | 0 Critical; 0 High; 0 Moderate; 0 Low; 0 total; 310 dependencies in metadata |
| `node --test tests/security/android-hardening.test.mjs` | PASS (exit 0) | 6 total; 6 pass; 0 skip; 0 fail |
| `npx --no-install cap sync android` | PASS (exit 0) | Generated the ignored pinned Capacitor bridge files required by a clean detached worktree |
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (-not (Test-Path -LiteralPath $taskAndroidSdk)) { throw 'Android SDK unavailable' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android testDebugUnitTest assembleDebug` | PASS (exit 0) | BUILD SUCCESSFUL in 27s; 169 actionable tasks; 108 executed; 61 up-to-date |
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (Test-Path -LiteralPath 'android\keystore.properties') { throw 'keystore.properties unexpectedly exists' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android assembleRelease` | EXPECTED FAIL (exit 1) | Release signing configuration missing: android/keystore.properties; assertion PASS |
| `node scripts/security/g5-local-orchestrator.mjs` | PASS (exit 0) | 19 live tests; 19 pass; 0 skip; 0 fail; 48/48 evidence cases; 49/49 migration checks; cleanup clean |
| Exact-target hosted staging verifier with process-local credentials | PASS (exit 0) | RLS/JWT/IDOR/BOLA; MFA/AAL/session; Finance SQL/JS parity; audit; HTTP/CSP; integrations fail-closed; exact cleanup |
| Supabase final staging posture and cleanup SQL | PASS | 17/17 forced RLS; 0 private client grants; 0 anonymous SECURITY DEFINER grants; 0 fixture functions; all synthetic and private resource counts 0 |
| Vercel Preview environment target audit | PASS | 17 variables; every entry is Preview-only and branch-only; shared Production credentials removed from Preview by target-only updates |
| `npx vercel inspect <branch-preview-url>` | PASS | project `crm-final-app`; deployment `dpl_A7rmokNxHnLS7ctwQXidmgeUKhFo`; target `preview`; status Ready; branch and application commit `16c7375` verified |
| Hosted `node scripts/security/verify-http.mjs` | PASS (exit 0) | exact 200/401/403/404/500; unique CSP nonces; `no-store` + `private`; no `public`/`s-maxage` |
| Agent-browser QA at 390x844 and 1440x900 | PASS | Hebrew RTL login rendered; form state worked; no horizontal overflow and no console/page errors at either viewport |
| Vercel and Supabase staging review | PASS | Exact-deployment Vercel query found 0 error/fatal/5xx events; final Advisor found 0 errors, 0 anonymous warnings and 25 approved authenticated-only RPC warnings |
| Seven privileged operational scripts without target acknowledgements | PASS (fail-closed) | All seven exited 1 before environment loading or any data operation |
| `node scripts/verify-month-report.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person-level output; no approved isolated source |
| `node scripts/verify-payroll-xlsx.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person/payroll output; no approved isolated source |
| `git diff --check` | PASS (exit 0) | 0 whitespace errors; checked before each final report commit |
| `git status --short --branch` | PASS (exit 0) | tracked tree clean after the final-report commit |

### Vercel Preview Isolation Evidence

| Checkpoint | Sanitized result |
| --- | --- |
| Before separation | 11 older entries targeted both Preview and Production; credential values remained unread. |
| Target-only update | Each update sent only `target: ["production"]`; no value field, key replacement or environment-type change was sent. |
| After separation | 17 Preview entries remained, all limited to `staging/security-integrated`, with 0 unscoped Preview entries and 0 Preview-plus-Production entries. |
| Deployment order | The environment audit preceded target separation, the post-change audit followed it, and only then was tested application Preview deployment `dpl_A7rmokNxHnLS7ctwQXidmgeUKhFo` created at 2026-09-05 21:44:45 +03:00. |

G5 used pinned Supabase CLI `2.115.0`.
The exact dedicated listeners were API `60321`; DB `60322`; Studio `60323`; Mail `60324`; shadow `60320`; SMTP `60325`; POP3 `60326`; analytics `60327`;
pooler-disabled reservation `60329`; edge-inspector reservation `60342`; local BFF `60343`.
Published listeners were loopback-only on `127.0.0.1`.

The identity inventory found twelve exact-project containers:
`supabase_analytics_mekarvim-security-g5-f513a76122c5`,
`supabase_auth_mekarvim-security-g5-f513a76122c5`,
`supabase_db_mekarvim-security-g5-f513a76122c5`,
`supabase_edge_runtime_mekarvim-security-g5-f513a76122c5`,
`supabase_inbucket_mekarvim-security-g5-f513a76122c5`,
`supabase_kong_mekarvim-security-g5-f513a76122c5`,
`supabase_pg_meta_mekarvim-security-g5-f513a76122c5`,
`supabase_realtime_mekarvim-security-g5-f513a76122c5`,
`supabase_rest_mekarvim-security-g5-f513a76122c5`,
`supabase_storage_mekarvim-security-g5-f513a76122c5`,
`supabase_studio_mekarvim-security-g5-f513a76122c5`, and
`supabase_vector_mekarvim-security-g5-f513a76122c5`.

## Negative / Adversarial Tests

Measured denial paths included anonymous table access, direct anonymous PII mutation, cross-project
and cross-activist CRUD, manager-forged actor/contact/house/assignee/beneficiary and tour-state
INSERTs, direct bonus-cancellation INSERT, same-project nonexistent/future bonus cancellation,
forged tenant/owner/recipient fields, project transfer, legacy-UUID
divergence, disabled/stale JWTs, AAL1 privileged access, another recipient's reminder cancellation,
unassigned tour reporting, arbitrary notification events, private audit reads and Coordinator raw
Finance access. Expected denials were observed as RLS empty/denied results, stable concealed 404s,
403/401 responses or constrained RPC failures, according to the case contract.

The local PostgreSQL assertions also proved fixed search paths and atomic audit rollback behavior.
Finance summary parity covered CEO, Head, Finance and Activist projections, Coordinator denial,
multi-project scope, caps, expenses, bonuses, tours and totals with zero unexplained logical delta.

## Dependencies

| Package/control | Verified state |
| --- | --- |
| Next.js | `16.3.3`, exact pin, Webpack build passed |
| Supabase JS | Manifest range `^2.105.1`; lockfile resolved `2.105.1` for this verification |
| jsPDF | `4.2.1`, Hebrew/RTL and browser-bundle compatibility passed |
| ExcelJS | `4.4.0`, exact UUID override and workbook round trips passed |
| Capacitor Android/Core/CLI | `8.4.1`, Android debug verification passed |
| xmldom transitive override | `0.9.12`; RED audit advisory for `<=0.9.11` remediated; full and production audits returned 0 findings |
| npm full audit | 0 Critical; 0 High; 0 Moderate; 0 Low |
| npm production audit | 0 Critical; 0 High; 0 Moderate; 0 Low |

Audit metadata counted 257 production, 54 optional and 310 total dependency records. Registry
evidence is time-bound to the recorded clean install and audit date.

## Secrets

Current-tree, tracked-tree and Git-history scanners each returned zero findings. The built browser
bundle scanner also returned zero findings. G5 credentials, generated passwords, JWTs, TOTP factor
data and exact synthetic identifiers stayed process-local and were not included in the sanitized
evidence manifest or this report.

The Vercel CLI-created `.env.local` contained a temporary OIDC value, was never tracked, and was
deleted before the final current-tree scan. The five staging-only secret variables remain Vercel
Preview branch secrets and were never printed or written into the repository. Older provider,
Supabase, cron and public variables that were jointly scoped to Preview and Production are now
Production-only; their values were not read or changed during target separation.

## External Integrations

Anthropic remains fail-closed unless explicitly enabled with processing approval. Google Sheets
requires the dedicated service account and exact spreadsheet/range allowlist. GitHub feedback
forwarding remains disabled. Notification adapters receive opaque delivery identifiers and construct
generic payloads internally. No external provider delivery was required for the local G5 verdict.

For the hosted Preview, Anthropic and GitHub feedback are explicitly disabled; no staging Sheets,
VAPID or FCM credentials are present. Unauthenticated cron calls returned 401 and feedback forwarding
returned its stable 503 disabled response. All such integrations therefore remained fail-closed.

## Android

The six static Android hardening checks passed. The debug unit/build command completed 169 tasks.
Backup and cleartext are disabled, FileProvider is cache-export-scoped, external deep-link entry is
closed, screen capture is prevented and release minification is enabled. The release command failed
at the intended signing guard because `android/keystore.properties` is absent; this proves the build
cannot silently fall back to debug signing and is not a release artifact.

## Remaining Risks

- Evidence remains time-bound; Production infrastructure, provider-console settings, credential
  rotation and deployed network policy still require environment-owner approval and verification.
- HSTS preload was verified on staging; browser-preload-list admission remains an external process.
- Next.js reports `optimizeFonts`, middleware-convention and `_app.getInitialProps` warnings.
- Gradle reports flat-directory, SDK XML compatibility and deprecation warnings.
- Real external notification delivery and production signing were intentionally outside this run.
- Month-report and payroll generators were not pointed at privileged/person-level data.

None of these residuals changes the local engineering gate result, but each remains an explicit
deployment or maintenance control.

## External Blockers

No blocker remains for the requested local G5/G6 and hosted staging closeout. Production access,
deployment, migration, secret reuse and real-data use remain prohibited and were not attempted.

## Rollback

The G5 sequence proved its reverse rollback before a clean final forward application. The disposable
database was then fixture-cleaned and destroyed, so no G5 database state remains to roll back.
Source rollback remains commit-scoped: `0153a8a` is the unchanged hardened reference and the
integration commits can be reverted normally on `security/integrate-current-main`. No force push,
history rewrite, merge to `main` or Production deployment occurred.

## Final Verdict

READY FOR PRODUCTION APPROVAL

Hosted staging approval status (2026-09-05): confirmed by the final verdict above.
