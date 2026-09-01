# Current Main Security Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate current `main` at `69b4040` into hardened base `0153a8a`, preserving current business behavior through the approved BFF/RPC/RLS architecture and producing fresh G5/G6 evidence.

**Architecture:** Merge current main with a deliberate hardened conflict baseline, then port missing business behavior by conflict group through TDD. Finance remains an aggregate, field-minimized server projection calculated by `app_finance_summary`; browser code consumes only same-origin DTOs, and bonus cancellation is recomputed atomically server-side.

**Tech Stack:** Next.js Pages Router, React, Node test runner, Supabase/PostgreSQL/RLS, Zod, ExcelJS, jsPDF, Android/Gradle, Docker, Supabase CLI 2.115.0.

**Spec:** `docs/superpowers/specs/2026-09-01-current-main-security-integration-design.md`

## Global Constraints

- Hardened base is exactly `0153a8acb242d25ee259c2c626bb86c9899d6a95`.
- Current main is exactly `69b4040a993689c63990f3064e58c321254836c5`.
- Do not modify `main` or `security/hardening-p0`.
- Do not push, deploy, run Production migrations, force-push, or rewrite history.
- Do not touch, stop, migrate, or clean `shabbat-hosting`.
- G5 must use a fresh loopback-only disposable project and synthetic fixtures.
- No browser Supabase business access, browser JWT authority, raw Finance contact PII, localStorage PII, permissive RLS, unbounded privileged reads, or unaudited sensitive mutation.
- Every production behavior change requires a failing test first and a separate meaningful group commit.

---

### Task 1: Pin and document the integration baseline

**Files:**
- Create: `docs/superpowers/specs/2026-09-01-current-main-security-integration-design.md`
- Create: `docs/superpowers/plans/2026-09-01-current-main-security-integration.md`

**Interfaces:**
- Consumes: Git revisions `0153a8a`, `69b4040`, and merge base `72b9196`.
- Produces: the conflict mapping and implementation contract used by all later tasks.

- [ ] **Step 1: Verify identities and cleanliness**

Run:

```powershell
git rev-parse HEAD main origin/main
git merge-base HEAD main
git status --short --branch
git -C ../security-hardening-p0 status --short --branch
```

Expected: integration HEAD and hardened rollback reference at `0153a8a`, main/origin at `69b4040`, merge base `72b9196`, both target worktrees clean.

- [ ] **Step 2: Verify the exact conflict inventory without modifying the tree**

Run:

```powershell
git merge-tree --write-tree 0153a8a 69b4040
```

Expected: exit 1 with exactly 10 content and 3 modify/delete conflicts named in the spec.

- [ ] **Step 3: Commit the approved design and plan**

```powershell
git add docs/superpowers/specs/2026-09-01-current-main-security-integration-design.md docs/superpowers/plans/2026-09-01-current-main-security-integration.md
git commit -m "docs: plan hardened current-main integration"
```

### Task 2: Merge pinned main with the hardened conflict baseline

**Files:**
- Resolve: the 13 paths in the spec conflict table.
- Validate: all paths changed by `72b9196..69b4040`.

**Interfaces:**
- Consumes: the conflict strategy in the spec.
- Produces: a reviewable merge commit with all current-main ancestry and no insecure legacy restoration.

- [ ] **Step 1: Merge without automatic commit**

```powershell
git merge --no-ff --no-commit 69b4040a993689c63990f3064e58c321254836c5
```

Expected: only the pinned 13 conflicts.

- [ ] **Step 2: Resolve each conflict deliberately**

Keep hardened BFF/auth/notification/store/payment page implementations as the initial secure baseline. Keep `lib/paymentConfig.js` and both tracked report binaries deleted. Preserve guarded operational scripts. Do not use a blanket ours/theirs operation; inspect and stage each path individually.

- [ ] **Step 3: Verify the conflict baseline**

```powershell
git diff --check
git diff --name-only --diff-filter=U
```

Expected: no whitespace errors and no unmerged paths.

- [ ] **Step 4: Commit the integration ancestry**

```powershell
git commit -m "merge: integrate current main into hardened baseline"
```

### Task 3: Reconcile Finance rules and cancellation parity

**Files:**
- Modify: `lib/paymentCalc.js`
- Modify: `lib/security/domains/finance.mjs`
- Modify: `migrations/0024_finance_security.sql`
- Modify: `migrations/rollback/0018-0024-pre-cutover.sql`
- Modify: `tests/security/finance-reports-feedback.test.mjs`
- Modify: `tests/security/migration-rls.test.mjs`
- Create: `tests/security/current-main-finance-parity.test.mjs`

**Interfaces:**
- Consumes: current-main JS constants and rules from the spec.
- Produces: `app_finance_summary` safe aggregates, Torani candidates/cancellation, and JS/SQL parity fixtures.

- [ ] **Step 1: Write failing canonical JS and BFF tests**

Use literal fixtures that assert: three-month friendly window, qualifying Torani transition, two frontal-friendly cap, `קצרצר` denial, one-time three-month Torani bonus, grouped mitzvot bonuses, new rates, exact bonus key, safe aggregate DTO keys, and no contact PII.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/security/current-main-finance-parity.test.mjs tests/security/finance-reports-feedback.test.mjs tests/security/migration-rls.test.mjs
```

Expected: failures naming missing SQL parity, Torani candidate/cancellation, and safe aggregate fields.

- [ ] **Step 3: Implement the minimum server integration**

Extend migration 0024 and `finance.mjs` with the exact contract from the spec. Keep DTOs explicit and candidate data free of contact PII. Extend rollback for changed rate data.

- [ ] **Step 4: Run GREEN and the main payment verifier**

```powershell
node --test tests/security/current-main-finance-parity.test.mjs tests/security/finance-reports-feedback.test.mjs tests/security/migration-rls.test.mjs
node scripts/verify-payment-order.cjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/paymentCalc.js lib/security/domains/finance.mjs migrations/0024_finance_security.sql migrations/rollback/0018-0024-pre-cutover.sql tests/security/current-main-finance-parity.test.mjs tests/security/finance-reports-feedback.test.mjs tests/security/migration-rls.test.mjs
git commit -m "feat: reconcile current finance rules through hardened RPC"
```

### Task 4: Reconcile activities, interaction UI, and complete-history reads

**Files:**
- Modify: `lib/CrmStore.jsx`
- Modify: `lib/security/domains/interactions.mjs`
- Modify: `pages/contact/add-interaction/[id].jsx`
- Modify: `tests/security/contacts-interactions-api.test.mjs`
- Create: `tests/security/current-main-interaction-parity.test.mjs`

**Interfaces:**
- Consumes: `קצרצר`, `contactMethods`, `deriveToraniBonuses`, and the existing BFF interaction DTO.
- Produces: BFF-only short-contact persistence and complete scoped interaction history.

- [ ] **Step 1: Write failing behavior tests**

Assert that short-contact requests persist `type='קצרצר'`, only allow the approved method values, remain non-payable, reject authority fields, and that the repository paginates until an empty page without widening scope.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/security/current-main-interaction-parity.test.mjs tests/security/contacts-interactions-api.test.mjs
```

Expected: missing paging/short-mode integration failures.

- [ ] **Step 3: Implement the minimum BFF-compatible port**

Add complete-history paging inside the user-scoped domain/repository, derive Torani bonuses from scoped rows where the UI needs preview data, and port the short-contact form without direct Supabase access.

- [ ] **Step 4: Run GREEN and build**

```powershell
node --test tests/security/current-main-interaction-parity.test.mjs tests/security/contacts-interactions-api.test.mjs
npm run build
```

Expected: all tests and production build pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/CrmStore.jsx lib/security/domains/interactions.mjs pages/contact/add-interaction/[id].jsx tests/security/current-main-interaction-parity.test.mjs tests/security/contacts-interactions-api.test.mjs
git commit -m "feat: port current interaction behavior to BFF"
```

### Task 5: Reconcile safe activity exports and reports

**Files:**
- Modify: `lib/activityByTypeExcel.js`
- Modify: `lib/security/domains/finance.mjs`
- Modify: `pages/payments.jsx`
- Modify: `pages/payments/[id].jsx`
- Modify: `scripts/verify-activity-report.cjs`
- Modify: `scripts/verify-month-report.cjs`
- Modify: `scripts/verify-payroll-xlsx.cjs`
- Modify: `tests/security/exceljs-uuid-compatibility.test.mjs`
- Create: `tests/security/current-main-activity-export.test.mjs`

**Interfaces:**
- Consumes: safe `activityByType`, `bonusByType`, and `unpaidByReason` payment DTO arrays.
- Produces: individual and combined RTL workbooks without raw contact or per-interaction religious history.

- [ ] **Step 1: Write failing workbook and projection tests**

Use hand-derived aggregate fixtures to assert eight ordered categories, zero-count categories, Torani bonus grouping, expenses/guide totals, unpaid reason counts, combined organizational formulas, RTL sheets, formula escaping, and absence of names/contact IDs/notes.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/security/current-main-activity-export.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs
node scripts/verify-activity-report.cjs
```

Expected: the imported current-main raw-breakdown workbook contract fails the hardened aggregate fixture.

- [ ] **Step 3: Implement safe aggregate workbook adapters and UI**

Adapt the workbook builder to safe payment DTOs, add locked export buttons to both payment pages, and keep all operational verification scripts guarded and bounded.

- [ ] **Step 4: Run GREEN**

```powershell
node --test tests/security/current-main-activity-export.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs
node scripts/verify-activity-report.cjs
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/activityByTypeExcel.js lib/security/domains/finance.mjs pages/payments.jsx pages/payments/[id].jsx scripts/verify-activity-report.cjs scripts/verify-month-report.cjs scripts/verify-payroll-xlsx.cjs tests/security/current-main-activity-export.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs
git commit -m "feat: add field-minimized activity exports"
```

### Task 6: Reconcile remaining UI and compatibility behavior

**Files:**
- Modify: `lib/notificationDemo.js`
- Modify: `pages/my-dashboard.jsx`
- Modify: `scripts/compare-payment-impact.cjs`
- Modify: `tests/security/client-boundary.test.mjs`
- Create: `tests/security/current-main-ui-compat.test.mjs`

**Interfaces:**
- Consumes: payable zero-rate result, aggregate payment DTO, guarded comparison harness.
- Produces: correct zero-rate messaging, Torani aggregate display, and guarded parity comparison.

- [ ] **Step 1: Write failing UI semantic tests**

Assert three distinct payment states: positive eligible, zero-rate eligible, and rejected. Assert the browser never receives raw contact Finance fields and the comparison script includes Torani bonuses without bypassing its operational guard.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/security/current-main-ui-compat.test.mjs tests/security/client-boundary.test.mjs tests/security/operational-scripts.test.mjs
```

Expected: zero-rate and Torani comparison behavior failures.

- [ ] **Step 3: Implement minimum semantic ports**

Keep generic notification content and BFF pages; port only the zero-rate state and guarded Torani comparison.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node --test tests/security/current-main-ui-compat.test.mjs tests/security/client-boundary.test.mjs tests/security/operational-scripts.test.mjs
git add lib/notificationDemo.js pages/my-dashboard.jsx scripts/compare-payment-impact.cjs tests/security/current-main-ui-compat.test.mjs tests/security/client-boundary.test.mjs
git commit -m "fix: preserve current-main UI semantics securely"
```

### Task 7: Run the complete static/local gate

**Files:**
- Verify only unless a deterministic defect is found.

**Interfaces:**
- Consumes: integrated group commits.
- Produces: reproducible static/local evidence with zero failures.

- [ ] **Step 1: Install from lockfile and run security/baseline/business tests**

```powershell
npm ci
npm run test:security
npm run test:baseline
node scripts/verify-activity-report.cjs
node scripts/verify-month-report.cjs --help
node scripts/verify-payroll-xlsx.cjs --help
```

Operational scripts must fail closed without an explicit approved target; deterministic fixtures cover their calculation paths.

- [ ] **Step 2: Run the production build and HTTP/CSP verifier**

```powershell
npm run build
node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs
$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs
```

Expected: build succeeds and the verifier proves exact 200/401/403/404/500 responses, restrictive headers, and unique CSP nonces.

- [ ] **Step 3: Run bundle, secret, dependency, and Android checks**

```powershell
node scripts/security/scan-client-bundle.mjs
node scripts/security/scan-secrets.mjs --current
node scripts/security/scan-secrets.mjs --tracked
node scripts/security/scan-secrets.mjs --history
npm audit --json
npm audit --omit=dev --json
node --test tests/security/android-hardening.test.mjs
$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (-not (Test-Path -LiteralPath $taskAndroidSdk)) { throw 'Android SDK unavailable' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android testDebugUnitTest assembleDebug
$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; if (Test-Path -LiteralPath 'android\keystore.properties') { throw 'keystore.properties unexpectedly exists' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android assembleRelease
git diff --check
```

Expected: zero scan findings, zero dependency vulnerabilities, Android debug success, and release failure only at the documented missing `android/keystore.properties` guard.

### Task 8: Independent integration review

**Files:**
- Review range: `0153a8acb242d25ee259c2c626bb86c9899d6a95..HEAD`.

**Interfaces:**
- Consumes: exact integrated commit and mission/spec.
- Produces: severity-ranked deterministic findings.

- [ ] **Step 1: Request independent review**

Review security regression, lost main behavior, Finance parity, auth/session, tenant/RLS/RPC boundaries, Torani/mitzvot cancellation, exports, and deleted legacy paths.

- [ ] **Step 2: Fix only deterministic Critical/Important findings using RED/GREEN**

Create a reproducing test, run it failing, apply the minimum fix, run it passing, and commit. Document Minor/speculative items without an infinite loop.

### Task 9: Run fresh disposable G5 LIVE

**Files:**
- Verify: migrations `0018` through `0024`, rollback, fixtures, evidence manifest, and cleanup.

**Interfaces:**
- Consumes: a fresh project ID `mekarvim-security-g5-*`, unique loopback ports, pinned Supabase CLI 2.115.0, and Docker loopback shim.
- Produces: 19/19 live, 48/48 adversarial, 47/47 migration checks, Finance SQL-vs-JS parity, and exact zero-leftover teardown proof.

- [ ] **Step 1: Prove target identity and non-interference**

Inventory existing containers/listeners, prove the fresh project name/config/container labels/ports, prove loopback-only bindings, and prove neither existing `mekusharim` nor `shabbat-hosting` matches the target.

- [ ] **Step 2: Run the configured orchestrator**

Use the repository G5 entrypoint with a fresh run UUID and no caller-provided verdict. Apply and verify 0018->0024 sequentially, provision only synthetic fixtures, run live/adversarial/session/MFA/Finance/audit cases, clean exact fixtures, rerun posture, roll back/reapply as the harness requires, and destroy only the fresh project.

- [ ] **Step 3: Prove cleanup**

Verify zero target containers, volumes, networks, listeners, Auth users, registry rows, and synthetic rows. Re-inventory both protected existing stacks unchanged.

### Task 10: Run fresh G6 and close documentation

**Files:**
- Modify: `SECURITY_HARDENING_REPORT.md`
- Modify: `PRE_PRODUCTION_SECURITY_READINESS.md`

**Interfaces:**
- Consumes: exact integrated implementation commit and fresh G5 evidence.
- Produces: integrated-current-main G6 evidence and one staging verdict.

- [ ] **Step 1: Create a clean detached verification worktree at the integrated commit**

Run G6 from that clean tree, not from cached build state.

- [ ] **Step 2: Re-run all G6 evidence**

```powershell
npm ci
npm run test:security
npm run test:baseline
node scripts/verify-activity-report.cjs
node --test tests/security/current-main-finance-parity.test.mjs tests/security/current-main-activity-export.test.mjs tests/security/current-main-interaction-parity.test.mjs tests/security/current-main-ui-compat.test.mjs tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs
npm run build
node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs
$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs
node scripts/security/scan-client-bundle.mjs
node scripts/security/scan-secrets.mjs --current
node scripts/security/scan-secrets.mjs --tracked
node scripts/security/scan-secrets.mjs --history
npm audit --json
npm audit --omit=dev --json
node --test tests/security/android-hardening.test.mjs
$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\gradlew.bat -p android testDebugUnitTest assembleDebug
git diff --check
```

Expected: all deterministic tests, build, HTTP, Android debug, scans, and audits pass with zero failures and zero vulnerabilities.

- [ ] **Step 3: Update both reports**

Record hardened base, main, integrated commit, conflict resolution table, group commits, parity evidence, independent review, G5 identity/results/cleanup, G6 results, audit results, Git state, and only real blockers.

- [ ] **Step 4: Verify report contracts and commit**

```powershell
npm run test:security
git diff --check
git add SECURITY_HARDENING_REPORT.md PRE_PRODUCTION_SECURITY_READINESS.md
git commit -m "docs: close integrated staging readiness"
git status --short --branch
```

Expected: report tests pass and worktree is clean. The final report states exactly `READY TO ENTER STAGING` only if every completion criterion in the spec is met; otherwise exactly `NOT READY TO ENTER STAGING`.
