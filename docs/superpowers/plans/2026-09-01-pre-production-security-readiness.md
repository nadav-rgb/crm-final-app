# Pre-Production Security Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independently verify the complete security-hardening branch, prove its merge and staging readiness, and publish an evidence-backed staging and Production migration runbook without merging or deploying.

**Architecture:** Treat the Git fork point and immutable branch diff as the review boundary, keep the independent review read-only, and collect fresh command evidence on the current HEAD. Produce one readiness document that separates code readiness from owner-managed staging configuration and Production migration operations.

**Tech Stack:** Git, Node.js/npm, Next.js, Supabase/PostgreSQL migrations, Docker metadata, Android Gradle, Markdown.

**Spec:** `C:/Users/nadav/.codex/attachments/0b3b4986-8b43-45af-a77a-524cb0c105ed/pasted-text.txt`

## Global Constraints

- Do not merge, push, deploy staging, deploy Production, run Production migrations, alter Production Supabase, force-push, or rewrite history.
- Fix only deterministic Critical or Important merge blockers; document Minor or speculative findings.
- Rerun G5 if security-critical DB or auth code changes after the recorded G5 PASS; this condition
  was met by the independently identified direct-INSERT authority fix in `9d6aea5`.
- The final verdict is exactly `READY TO ENTER STAGING` or `NOT READY TO ENTER STAGING` and applies only to staging entry.

---

### Task 1: Recover the exact Git review boundary

**Files:**
- Inspect: Git refs, reflogs, ancestry, and `SECURITY_HARDENING_REPORT.md`
- Create: none

**Interfaces:**
- Consumes: branch `security/hardening-p0` and current local refs
- Produces: exact fork SHA, target SHA, commit range, and diff inventory

- [ ] **Step 1: Verify branch, HEAD, and worktree state**

```powershell
git status --short --branch
git rev-parse HEAD
git branch --show-current
```

- [ ] **Step 2: Derive the fork point from ancestry and reflog evidence**

```powershell
git merge-base security/hardening-p0 main
git reflog show security/hardening-p0
git rev-list --left-right --count main...security/hardening-p0
```

- [ ] **Step 3: Inventory the full fork-to-HEAD diff**

```powershell
git diff --stat 72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..HEAD
git diff --name-status 72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..HEAD
git log --oneline 72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..HEAD
```

### Task 2: Complete one independent read-only security review

**Files:**
- Inspect: every file changed in `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..9d6aea5cb4e8e18a802080331afce747332b6246`
- Create: none

**Interfaces:**
- Consumes: immutable Git range and the user's security-review checklist
- Produces: severity-classified findings with file/line evidence and merge assessment

- [ ] **Step 1: Dispatch a read-only reviewer with the exact SHA range**

```text
Review auth/session, MFA/AAL, RBAC, tenant isolation, RLS, immutable authority fields,
service-role and browser boundaries, CSRF/rate limits, audit, finance, notifications,
integrations, secrets, headers, Android, migrations 0018-0024, and rollback safety.
```

- [ ] **Step 2: Validate every Critical or Important finding locally**

```powershell
git diff 72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..9d6aea5cb4e8e18a802080331afce747332b6246 -- lib migrations pages android scripts/security tests/security
```

- [ ] **Step 3: Use RED-fix-GREEN only for a verified blocker**

```powershell
npm run test:security
npm run build
git diff --check
```

### Task 3: Run fresh final verification

**Files:**
- Inspect: `package.json`, security tests, Android project, and generated `.next` bundle
- Create: ignored build artifacts only

**Interfaces:**
- Consumes: final source HEAD
- Produces: exact test, build, scan, audit, HTTP/CSP, and Android results

- [ ] **Step 1: Reinstall the locked dependency graph**

```powershell
npm ci
```

- [ ] **Step 2: Run security, baseline, and focused report/finance/export tests**

```powershell
npm run test:security
npm run test:baseline
node --test tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs
```

- [ ] **Step 3: Build and verify HTTP/CSP through the synthetic launcher**

```powershell
npm run build
node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs
$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs
```

- [ ] **Step 4: Run secret, bundle, dependency, and Android checks**

```powershell
node scripts/security/scan-client-bundle.mjs
node scripts/security/scan-secrets.mjs --current
node scripts/security/scan-secrets.mjs --tracked
node scripts/security/scan-secrets.mjs --history
npm audit --json
npm audit --omit=dev --json
node --test tests/security/android-hardening.test.mjs
android\gradlew.bat -p android testDebugUnitTest assembleDebug
```

### Task 4: Establish merge readiness without merging

**Files:**
- Inspect: complete diff, migration directory, ignored/untracked files, and merge-tree output
- Create: none

**Interfaces:**
- Consumes: current `main`, fork point, and final security HEAD
- Produces: conflict list, migration-order proof, artifact scan, and exact merge strategy

- [ ] **Step 1: Simulate the merge against current local `main`**

```powershell
git merge-tree $(git merge-base main HEAD) main HEAD
```

- [ ] **Step 2: Audit migration numbering and file lifecycle changes**

```powershell
git diff --name-status --find-renames 72b9196f22812e5dc2452efe33f1fbbf23f3dd4c..HEAD
Get-ChildItem migrations | Sort-Object Name
```

- [ ] **Step 3: Scan for artifacts, debug code, flags, and security blockers**

```powershell
git ls-files | rg "(?:\.log$|\.apk$|\.aab$|\.jks$|\.keystore$|node_modules|\.next/)"
rg -n "TODO|FIXME|DEBUG|SECURITY_BFF_.*false|disabled" --glob '!node_modules/**' --glob '!.next/**'
git diff --check
```

### Task 5: Publish the staging and Production runbooks

**Files:**
- Create: `PRE_PRODUCTION_SECURITY_READINESS.md`
- Modify: this plan only to mark executed steps complete

**Interfaces:**
- Consumes: review findings, fresh verification, merge simulation, migration SQL, and environment contracts
- Produces: the exact readiness document requested by the user

- [ ] **Step 1: Document the current status and fresh evidence**

```markdown
## Current Security Status
## Final Verification
## Merge Readiness
```

- [ ] **Step 2: Classify every staging configuration item**

```markdown
## Staging Checklist
## External Configuration Required
```

- [ ] **Step 3: Write migration-by-migration Production and rollback procedures**

```markdown
## Production Migration Runbook
## Rollback Plan
## Known Residual Risks
```

- [ ] **Step 4: Record exactly one staging-entry verdict**

```markdown
## Go / No-Go
NOT READY TO ENTER STAGING
```

### Task 6: Commit documentation and verify the final HEAD

**Files:**
- Commit: `PRE_PRODUCTION_SECURITY_READINESS.md`
- Commit: `docs/superpowers/plans/2026-09-01-pre-production-security-readiness.md`

**Interfaces:**
- Consumes: completed documentation and verified findings
- Produces: clean final branch state and final handoff

- [ ] **Step 1: Validate document completeness and secret hygiene**

```powershell
rg -n "^## " PRE_PRODUCTION_SECURITY_READINESS.md
node scripts/security/scan-secrets.mjs --current
git diff --check
```

- [ ] **Step 2: Commit documentation only**

```powershell
git add PRE_PRODUCTION_SECURITY_READINESS.md docs/superpowers/plans/2026-09-01-pre-production-security-readiness.md
git commit -m "docs: record pre-production security readiness"
```

- [ ] **Step 3: Re-run final document and Git checks**

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check
```
