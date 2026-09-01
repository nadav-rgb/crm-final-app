# CRM Mekarvim Security Hardening Evidence Report

Evidence date: 2026-09-01 (Asia/Jerusalem)

Branch: `security/hardening-p0`

Starting checkpoint: `5340d9763ce27d396bbc79bf33f342933bedceb8`

G5 source/test checkpoint before this report update: `0c6a9ce3703b3b3c71aa475aa803be16024a3a85`

This is a time-bound engineering evidence record. It is not authorization to merge, deploy, use
real sensitive data, or apply these migrations to Production.
Static contract evidence and live database proof are reported separately.

## Executive Summary

A fresh disposable local Supabase project, `mekarvim-security-g5-045d7fa0b448`, was created solely
for CRM Mekarvim G5. Its identity, dedicated ports, exact container labels and loopback-only
listeners were proven before any destructive reset. No existing database was reused.
No remote Supabase environment was contacted. Production is untouched.

Migrations 0018 through 0024 were applied sequentially with a catalog snapshot and verification
after each step, then rolled back, reapplied, and verified again. All 47 migration checks passed.
The measured chain result was: 47/47 migration checks passed.
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
Neither excluded stack was stopped, restarted, queried, migrated, cleaned or
otherwise mutated.

G6 was rerun from a clean install: baseline 51/51, security 324 pass plus 19 explicit local-live
gates and zero failures, focused finance/PDF/Excel 32/32, production Webpack build, HTTP/CSP,
Android debug, secret scans, bundle scan and dependency audits all passed. The 19 deterministic
suite skips are environment gates whose corresponding live tests were measured separately in G5.

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
| `C1` | Broad direct authority/workflow mutation allowed caller-controlled ownership changes. | `bb507ec` | Authority/RLS static suite and direct-JWT G5 matrix | ADDRESSED | Evidence is time-bound to this G5 runtime. |
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
| `M1` | Posture verification tolerated incomplete grants, policies and table posture. | `7463d9e`, `180c90f` | 47 migration checks and final 17/17 forced-RLS probe | ADDRESSED | Catalog evidence is time-bound to G5. |
| `M2` | Caller-controlled forwarding data could fragment rate-limit identity. | `06530d7` | Trusted-client and live shared-bucket tests | ADDRESSED | Trusted-proxy runtime configuration remains operator-controlled. |
| `M3` | Reminder ownership and reads preserved identity ambiguity and excess projection. | `74450ac` | Compatibility suite and live reminder boundaries | ADDRESSED | Evidence is time-bound to G5. |

No open deterministic Critical, High, Moderate or Low dependency finding was observed. Remaining
non-blocking build and Gradle warnings are recorded below as maintenance risks.

## Changes

- Browser authentication and business data use same-origin BFF routes; browser input cannot provide
  authoritative actor, role, project, owner, recipient or audit fields.
- Server sessions are opaque, host-bound, rotated and revocable; provider tokens remain server-side.
- Authorization derives from active membership, role, project, resource ownership and AAL.
- PostgreSQL migrations enable and force RLS on 17 protected tables, narrow grants and install
  actor-derived, resource-derived RPCs with fixed search paths.
- Audit storage is private, append-only through controlled functions and redacted.
- Finance, notification, tour, reminder, governance and reporting projections are allowlisted.
- G5 infrastructure now creates an exact disposable project, enforces loopback Docker publishing,
  measures evidence, performs exact cleanup and proves project-scoped destruction.
- The G5 RED-to-GREEN sequence added 35 commits after the requested starting checkpoint, covering
  entrypoint ownership, loopback binding, migration/posture correctness, TOTP, Finance isolation and
  audit atomicity. Each real defect was committed before recreating and rerunning the disposable DB.

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
| `bonus_cancellations` | Static PASS; live PASS | Enable + force | Approved projection | Derived cancellation RPC | Denied | Denied | Resource and actor derived |
| `payment_config` | Static PASS; live PASS | Enable + force | Approved projection | Service only | Service only | Service only | Narrow Finance projection |
| `notifications` | Static PASS; live PASS | Enable + force | Recipient only | Event RPC only | Denied | Denied | Event/resource-derived payload |
| `notification_reads` | Static PASS; live PASS | Enable + force | Own recipient only | Own marker | Own marker | Own marker | Recipient derived from JWT |
| `push_subscriptions` | Static PASS; live PASS | Enable + force | Own only | Own endpoint | Own endpoint | Own endpoint | No recipient spoofing |
| `fcm_tokens` | Static PASS; live PASS | Enable + force | Own only | Own token row | Own token row | Own token row | No user spoofing |
| `feedback_reports` | Static PASS; live PASS | Enable + force | Reporter/scoped reviewer | Reporter/project derived | Review RPC | Denied | CEO AAL2 or scoped manager |
| `activist_directory` | Static PASS; live PASS | Security-invoker view over protected sources | Role-specific projection | Not applicable | Not applicable | Not applicable | Protected-source RLS |

The final posture inventory contained 23 public tables, 57 policies and 43 functions. Every one of
the 17 protected tables had RLS enabled and forced. Grants and function search paths matched the
approved posture verifier.

## Test Evidence

| Command | Status | Exact result |
| --- | --- | --- |
| `npm ci` | PASS (exit 0) | 277 packages installed; 278 audited; 0 vulnerabilities |
| `npm run test:baseline` | PASS (exit 0) | 51 total; 51 pass; 0 skip; 0 fail |
| `npm run verify:interaction-report` | PASS (exit 0) | 27 total; 27 pass; 0 skip; 0 fail |
| `node scripts/verify-payment-order.cjs` | PASS (exit 0) | 24 total; 24 pass; 0 skip; 0 fail |
| `npm run test:security` | PASS (exit 0) | 343 total; 324 pass; 19 explicit live skips; 0 fail |
| `node --test tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs` | PASS (exit 0) | 32 total; 32 pass; 0 skip; 0 fail |
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
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (-not (Test-Path -LiteralPath $taskAndroidSdk)) { throw 'Android SDK unavailable' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android testDebugUnitTest assembleDebug` | PASS (exit 0) | BUILD SUCCESSFUL in 27s; 169 actionable tasks; 82 executed; 87 up-to-date |
| `$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (Test-Path -LiteralPath 'android\keystore.properties') { throw 'keystore.properties unexpectedly exists' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android assembleRelease` | EXPECTED FAIL (exit 1) | Release signing configuration missing: android/keystore.properties; assertion PASS |
| `node scripts/security/g5-local-orchestrator.mjs` | PASS (exit 0) | 19 live tests; 19 pass; 0 skip; 0 fail; 48/48 evidence cases; 47/47 migration checks; cleanup clean |
| `node scripts/verify-month-report.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person-level output; no approved isolated source |
| `node scripts/verify-payroll-xlsx.cjs <year> <month>` | NOT RUN | Inspection only: `.env.local`; privileged Supabase; person/payroll output; no approved isolated source |
| `git diff --check` | PASS (exit 0) | 0 whitespace errors; checked before each final report commit |
| `git status --short --branch` | PASS (exit 0) | tracked tree clean after the final-report commit |

G5 used pinned Supabase CLI `2.115.0`.
The exact dedicated listeners were API `56321`; DB `56322`; Studio `56323`; Mail `56324`; shadow `56320`; SMTP `56325`; POP3 `56326`; analytics `56327`;
pooler-disabled reservation `56329`; edge-inspector reservation `56342`; local BFF `56343`.
Published listeners were loopback-only on `127.0.0.1`.

The identity inventory found nine exact-project containers:
`supabase_auth_mekarvim-security-g5-045d7fa0b448`,
`supabase_db_mekarvim-security-g5-045d7fa0b448`,
`supabase_inbucket_mekarvim-security-g5-045d7fa0b448`,
`supabase_kong_mekarvim-security-g5-045d7fa0b448`,
`supabase_pg_meta_mekarvim-security-g5-045d7fa0b448`,
`realtime-dev.supabase_realtime_mekarvim-security-g5-045d7fa0b448`,
`supabase_rest_mekarvim-security-g5-045d7fa0b448`,
`supabase_storage_mekarvim-security-g5-045d7fa0b448`, and
`supabase_studio_mekarvim-security-g5-045d7fa0b448`.

## Negative / Adversarial Tests

Measured denial paths included anonymous table access, direct anonymous PII mutation, cross-project
and cross-activist CRUD, forged tenant/owner/recipient fields, project transfer, legacy-UUID
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
| Supabase JS | `2.105.1`, exact approved pin |
| jsPDF | `4.2.1`, Hebrew/RTL and browser-bundle compatibility passed |
| ExcelJS | `4.4.0`, exact UUID override and workbook round trips passed |
| Capacitor Android/Core/CLI | `8.4.1`, Android debug verification passed |
| npm full audit | 0 Critical; 0 High; 0 Moderate; 0 Low |
| npm production audit | 0 Critical; 0 High; 0 Moderate; 0 Low |

Audit metadata counted 257 production, 54 optional and 310 total dependency records. Registry
evidence is time-bound to the recorded clean install and audit date.

## Secrets

Current-tree, tracked-tree and Git-history scanners each returned zero findings. The built browser
bundle scanner also returned zero findings. G5 credentials, generated passwords, JWTs, TOTP factor
data and exact synthetic identifiers stayed process-local and were not included in the sanitized
evidence manifest or this report.

## External Integrations

Anthropic remains fail-closed unless explicitly enabled with processing approval. Google Sheets
requires the dedicated service account and exact spreadsheet/range allowlist. GitHub feedback
forwarding remains disabled. Notification adapters receive opaque delivery identifiers and construct
generic payloads internally. No external provider delivery was required for the local G5 verdict.

## Android

The six static Android hardening checks passed. The debug unit/build command completed 169 tasks.
Backup and cleartext are disabled, FileProvider is cache-export-scoped, external deep-link entry is
closed, screen capture is prevented and release minification is enabled. The release command failed
at the intended signing guard because `android/keystore.properties` is absent; this proves the build
cannot silently fall back to debug signing and is not a release artifact.

## Remaining Risks

- The evidence is local and time-bound; staging/Production infrastructure, provider-console settings,
  credential rotation and deployed network policy still require environment-owner verification.
- HSTS preload is present in code but still requires staging verification before operational use.
- Next.js reports `optimizeFonts`, middleware-convention and `_app.getInitialProps` warnings.
- Gradle reports flat-directory, SDK XML compatibility and deprecation warnings.
- Real external notification delivery and production signing were intentionally outside this run.
- Month-report and payroll generators were not pointed at privileged/person-level data.

None of these residuals changes the local engineering gate result, but each remains an explicit
deployment or maintenance control.

## External Blockers

No blocker remains for the requested local G5 and G6 closeout. Production access, deployment,
release signing, remote migration and real-data use remain prohibited and were not attempted.

## Rollback

The G5 sequence proved its reverse rollback before a clean final forward application. The disposable
database was then fixture-cleaned and destroyed, so no G5 database state remains to roll back.
Source rollback remains commit-scoped on `security/hardening-p0`; no force push, history rewrite,
merge to `main` or Production deployment occurred.

## Final Verdict

READY FOR SECURITY REVIEW
