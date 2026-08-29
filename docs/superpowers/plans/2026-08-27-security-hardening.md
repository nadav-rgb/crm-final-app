# CRM Mekarvim Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להחליף את אבטחת ה־prototype בארכיטקטורת BFF + Supabase Auth + PostgreSQL RLS, שבה session, tenant isolation, הרשאות, PII, mutations ו־audit נאכפים בשרת ובמסד ומוכחים בבדיקות שליליות.

**Architecture:** הדפדפן מתקשר רק עם API מאותו origin ומחזיק session cookie אטום; Supabase tokens נשמרים מוצפנים בצד השרת. כל business query רץ עם JWT של המשתמש כדי ש־RLS יאכוף מחדש RBAC ו־tenant isolation, בעוד service role מוגבל ל־session/auth/audit/rate-limit/cron wrappers מפורשים.

**Tech Stack:** Next.js 16.3.3 Pages Router על Webpack, React 18.3.1, Node.js 24 built-in test runner עם runtime floor של Node 20.9, Supabase Auth/PostgreSQL/PostgREST, Zod 3.25.76, Web Crypto/Node `crypto`, Capacitor Android 8.

**Spec:** `docs/superpowers/specs/2026-08-27-security-hardening-design.md`

## Global Constraints

- כל 21 המשימות במסמך הן P0 לפני שימוש במידע רגיש אמיתי; אין דילוג ל־feature work אחר.
- ברירת המחדל היא deny ו־fail-closed. כשל config, session, membership, RLS, audit או integration אינו מפעיל fallback מתירני.
- הדפדפן לא יקבל Supabase JWT, service-role key, user directory או גישת PostgREST ישירה.
- cookie הייצור הוא `__Host-mekarvim_session` עם `HttpOnly`, `Secure`, `SameSite=Lax`, ללא `Domain` ועם `Path=/`.
- CEO ו־Project Head דורשים AAL2 לפני PII, reports, mutations או administration.
- session לבעלי הרשאות גבוהות: idle expiry של 30 דקות ו־absolute expiry של 12 שעות; Activist/Coordinator: עד 8 שעות idle ועד 24 שעות absolute; אין “זכור אותי” ב־P0.
- login מוגבל לחמישה ניסיונות ב־15 דקות; password reset לשלושה ניסיונות בשעה; MFA verify לחמישה ניסיונות ב־10 דקות.
- `project_id`, owner, actor, recipient, role, audit fields ו־security version נגזרים בשרת ואינם מתקבלים כסמכות מהלקוח.
- אין `select('*')` ב־production path רגיש; כל query ותגובה משתמשים ב־column allowlist וב־DTO לפי role.
- service role אינו מבצע business CRUD רגיל. חריגה דורשת wrapper ייעודי, allowlist, audit ובדיקה שלילית.
- CSP scripts משתמש ב־`'self'` וב־nonce, ללא `unsafe-eval`; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- responses של identity/PII/report/error מאומת מקבלים `Cache-Control: no-store, private`; אין CORS `*`.
- יעד dependencies הוא אפס Critical ואפס High. Major upgrade אינו מתבצע בלי תכנון נפרד ואישור.
- אין secrets אמיתיים, PII אמיתי, generated reports או credentials בקבצים חדשים.
- migrations נכתבות ומאומתות סטטית ב־branch; אין הרצה על Supabase חי בלי אישור מפורש וגיבוי.
- אין merge ל־main ואין deployment ל־Production. staging deployment או DB test project דורשים אישור נפרד.
- כל משימה מתחילה בבדיקה שנכשלת מהסיבה הצפויה, מסתיימת בבדיקות ירוקות וב־commit קטן, וכוללת rollback point.
- סטייה מה־Design עוצרת את הביצוע ומוחזרת לאישור לפני שינוי קוד.

---

## סדר Gates מחייב

| Gate | משימות | תנאי יציאה |
| --- | --- | --- |
| G0 — Evidence harness | 1 | runner, test matrix ו־baseline machine-readable עוברים |
| G1 — Database contract | 2–3 | migrations idempotent, policy inventory מלא ו־static negative checks עוברים; עדיין לא מופעל חי |
| G2 — Server trust boundary | 4–7 | validation, session, CSRF, rate limit, Auth/MFA, RBAC ו־audit עוברים unit/integration עם fakes |
| G3 — Business authorization | 8–14 | כל domain עבר ל־BFF/user JWT, כולל cross-user/cross-project/mass-assignment tests |
| G4 — Cutover and hardening | 15–19 | אין browser Supabase/PII fallback, headers/secrets/dependencies/Android מאומתים |
| G5 — Controlled staging evidence | 20 | migrations על סביבת בדיקה, שני projects, כל roles ו־attacker suite עוברים |
| G6 — Final evidence | 21 | regression מלא, report, residual risk ו־verdict יחיד; עצירה ללא merge/deploy |

אין להפעיל feature flag של ה־BFF מחוץ לסביבה מקומית לפני G3, ואין להעביר נתונים אמיתיים לפני G6 וביקורת חיצונית.

## מבנה הקבצים המתוכנן

### Security core

- `lib/security/env.mjs` — הפרדה ואימות של server-only/public configuration.
- `lib/security/errors.mjs` — שגיאות stable, redaction ו־correlation IDs.
- `lib/security/http.mjs` — method/content-type/body-limit/no-store/origin wrappers.
- `lib/security/schemas.mjs` — Zod schemas ו־rejection של unknown fields.
- `lib/security/crypto.mjs` — HMAC session IDs והצפנת AES-256-GCM ל־provider tokens.
- `lib/security/cookies.mjs` — serialization/clearing של `__Host-mekarvim_session`.
- `lib/security/csrf.mjs` — issuance/rotation/verification של token הקשור ל־session.
- `lib/security/rate-limit.mjs` — adapter ל־Postgres atomic buckets.
- `lib/security/session-store.mjs` — RPC-only persistence של sessions.
- `lib/security/session.mjs` — create/load/rotate/revoke/expiry/security-version/AAL.
- `lib/security/auth-service.mjs` — login, logout, MFA ו־password recovery orchestration.
- `lib/security/rbac.mjs` — role constants ומטריצת capabilities ללא תלות ב־React.
- `lib/security/request-context.mjs` — identity, memberships, AAL ו־project scope לכל request.
- `lib/security/supabase-user.mjs` — Supabase client עם JWT המשתמש ובלי persistence.
- `lib/security/audit.mjs` — append-only audit writer ו־metadata allowlist.
- `lib/security/api-handler.mjs` — composition של guards ו־error mapping.
- `lib/security/api-client.mjs` — same-origin fetch, CSRF בזיכרון ו־generic response parsing.

### Domain boundaries

- `lib/security/domains/contacts.mjs`, `interactions.mjs`, `governance.mjs`, `meetings.mjs`, `tours.mjs`, `notifications.mjs`, `finance.mjs`, `feedback.mjs` — queries עם column allowlists ו־DTO projections.
- `pages/api/auth/**` — auth/session/MFA/recovery בלבד.
- `pages/api/contacts/**`, `pages/api/interactions/**`, `pages/api/projects/**`, `pages/api/memberships/**` — BFF resources.
- נתיבי API קיימים של meeting houses, tours, reminders, push, reports, feedback ו־cron נשארים בנתיביהם כדי לא לשבור UX, אך עוברים ל־guards ול־repositories החדשים.

### Database and evidence

- `migrations/0018_security_foundation.sql` — memberships, UUID ownership, private session/audit/rate tables ו־backfill assertions.
- `migrations/0019_security_rls.sql` — explicit grants, helpers (כולל `app_has_active_membership`) ו־CRUD policies לכל טבלה/view.
- `migrations/0020_security_rpcs.sql` — session/rate/audit/membership RPCs אטומיים עם grants מצומצמים.
- `migrations/0021_meetings_security.sql` — reminder idempotency/cancellation schema ו־cancel RPC צר; single-apply, not fully idempotent.
- `migrations/0022_tours_security.sql` — tour reporter/cancellation schema ו־report RPC צר; single-apply, not fully idempotent.
- `migrations/0023_notifications_security.sql` — UUID-only ownership ו־event-specific notification authority.
- `migrations/0024_finance_security.sql` — aggregate finance projection, server-derived scope ו־atomic redacted audit.
- `migrations/rollback/0018-0024-pre-cutover.sql` — rollback מוגן לשלב pre-cutover בלבד, בסדר הפוך.
- `tests/security/**/*.test.mjs` — unit/static/API/negative tests.
- `scripts/security/run-tests.mjs` — Node test runner דטרמיניסטי.
- `scripts/security/provision-test-fixtures.mjs` — fixtures בסביבת Supabase test בלבד.
- `scripts/security/verify-rls-live.mjs` — direct JWT/PostgREST adversarial matrix.
- `scripts/security/verify-http.mjs` — headers/CSP/cache/CORS checks נגד build מקומי או staging מאושר.
- `scripts/security/scan-secrets.mjs` ו־`scan-client-bundle.mjs` — פלט location/type/count בלבד.
- `SECURITY_HARDENING_REPORT.md` — ראיות סופיות ו־verdict.

---

### Task 1: G0 — Security Test Runner and Evidence Contract

**Files:**
- Create: `scripts/security/run-tests.mjs`
- Create: `tests/security/harness.test.mjs`
- Create: `tests/security/helpers.mjs`
- Create: `tests/security/fixtures.mjs`
- Create: `docs/security/SECURITY_TEST_MATRIX.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Node.js 24 בלבד.
- Produces: `npm run test:security -- [file...]`; exit `0` רק כאשר כל tests עברו, helpers משותפים, fixtures סינתטיים לשני projects, ו־`docs/security/SECURITY_TEST_MATRIX.md` שממפה requirement למזהה test.

**Dependencies:** אין package חדש.

**External blockers:** אין.

**Rollback point:** revert של commit המשימה מסיר runner ותיעוד בלבד.

- [ ] **Step 1: כתוב בדיקת harness נכשלת**

```js
// tests/security/harness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTestPath } from '../../scripts/security/run-tests.mjs';

test('runner rejects paths outside tests/security', () => {
  assert.throws(() => normalizeTestPath('../.env.local'), /security test path/);
});
```

- [ ] **Step 2: אמת RED**

Run: `node --test tests/security/harness.test.mjs`

Expected: FAIL משום ש־`scripts/security/run-tests.mjs` אינו קיים.

- [ ] **Step 3: מימוש runner ו־package scripts**

```js
// scripts/security/run-tests.mjs
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const securityRoot = path.resolve(repoRoot, 'tests/security');

export function normalizeTestPath(value) {
  const candidate = path.resolve(repoRoot, value);
  const relativeToSecurity = path.relative(securityRoot, candidate);
  if (relativeToSecurity.startsWith('..') || path.isAbsolute(relativeToSecurity) || !candidate.endsWith('.test.mjs')) {
    throw new Error('invalid security test path');
  }
  return path.relative(repoRoot, candidate).replaceAll('\\', '/');
}

export async function main(requested = process.argv.slice(2)) {
  const discovered = requested.length
    ? requested
    : (await readdir(securityRoot, { recursive: true }))
        .filter(value => value.endsWith('.test.mjs'))
        .map(value => path.join('tests/security', value));
  const files = discovered.map(normalizeTestPath).sort();
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
  return result.status ?? 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
```

ה־runner אוסף רק `tests/security/**/*.test.mjs`, ממיין שמות, מריץ `node --test --test-concurrency=1`, ומעביר file arguments רק אחרי `normalizeTestPath`. ב־`package.json` יש להוסיף:

```json
{
  "scripts": {
    "test:security": "node scripts/security/run-tests.mjs",
    "test:baseline": "npm run verify:interaction-report && node scripts/verify-payment-order.cjs"
  }
}
```

- [ ] **Step 4: צור helpers ו־fixtures משותפים**

```js
// tests/security/helpers.mjs
export const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
export const hasCode = expected => error => error?.code === expected;
export const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function fakeReq({ method = 'GET', headers = {}, body, cookies = {} } = {}) {
  return { method, headers, body, cookies, socket: { remoteAddress: '192.0.2.10' } };
}
export function fakeRes() {
  return { statusCode: 200, headers: {}, payload: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; } };
}
export async function call(handler, context, request) {
  const req = { ...fakeReq(request), testContext: context };
  const res = fakeRes();
  await handler(req, res);
  return res;
}
```

```js
// tests/security/fixtures.mjs
export const PROJECT_A = 101;
export const PROJECT_B = 202;
export const activistA = { userId: '00000000-0000-4000-8000-000000000001', role: 'activist', projectId: PROJECT_A, aal: 1 };
export const activistB = { userId: '00000000-0000-4000-8000-000000000002', role: 'activist', projectId: PROJECT_A, aal: 1 };
export const activistProjectB = { userId: '00000000-0000-4000-8000-000000000003', role: 'activist', projectId: PROJECT_B, aal: 1 };
export const coordA = { userId: '00000000-0000-4000-8000-000000000004', role: 'coord', projectId: PROJECT_A, aal: 1 };
export const headA = { userId: '00000000-0000-4000-8000-000000000005', role: 'head', projectId: PROJECT_A, aal: 2 };
export const headAal1 = { ...headA, aal: 1 };
export const financeA = { userId: '00000000-0000-4000-8000-000000000006', role: 'finance', projectId: PROJECT_A, aal: 1 };
export const ceo = { userId: '00000000-0000-4000-8000-000000000007', role: 'ceo', projectId: null, aal: 2 };
export const contactA = { id: '10000000-0000-4000-8000-000000000001', projectId: PROJECT_A, assignedUserId: activistA.userId };
export const contactOwnedByActivistB = { id: '10000000-0000-4000-8000-000000000002', projectId: PROJECT_A, assignedUserId: activistB.userId };
export const contactProjectB = { id: '10000000-0000-4000-8000-000000000003', projectId: PROJECT_B, assignedUserId: activistProjectB.userId };
export const tourProjectB = { id: '20000000-0000-4000-8000-000000000001', projectId: PROJECT_B, assignedUserIds: [activistProjectB.userId] };
export const membershipA = { projectId: PROJECT_A, userId: activistA.userId, role: 'activist' };
export const projectA = { id: PROJECT_A };
export function makeContext(actor) {
  return {
    userId: actor.userId,
    globalRole: actor.role === 'ceo' ? 'ceo' : null,
    memberships: actor.projectId ? [{ projectId: actor.projectId, role: actor.role, status: 'active' }] : [],
    aal: actor.aal
  };
}
```

- [ ] **Step 5: צור matrix עם 25 דרישות המקור ועוד IDs מורחבים**

הפורמט המחייב לכל שורה: `ID | behavior | file | gate | class`. הרשימה המחייבת:

```text
SEC-001 anonymous cannot receive PII
SEC-002 activist sees only allowed contacts
SEC-003 activist cannot read another activist contact
SEC-004 project A cannot read project B
SEC-005 direct URL change cannot bypass authorization
SEC-006 resource ID change cannot bypass authorization
SEC-007 request body cannot escape tenant
SEC-008 insert with client project_id is rejected
SEC-009 cross-tenant update is rejected
SEC-010 cross-tenant delete is rejected
SEC-011 coordinator permissions are exact
SEC-012 Project Head is limited to own project
SEC-013 CEO permissions are exact and require AAL2
SEC-014 anonymous mutation is rejected
SEC-015 expired or invalid session is rejected
SEC-016 logout revokes access
SEC-017 privilege escalation is rejected and sessions rotate
SEC-018 mass assignment is rejected
SEC-019 oversized or malformed input is rejected
SEC-020 XSS payload is not executed or emitted as HTML
SEC-021 rate limiting blocks excess attempts
SEC-022 required security headers are present
SEC-023 every sensitive table has enforced RLS
SEC-024 service-role credential is absent from client bundle
SEC-025 unauthorized user cannot read audit log
SEC-026 foreign Origin and invalid CSRF token are rejected
SEC-027 AAL1 cannot access MFA-protected resources
SEC-028 session fixation and replay after rotation are rejected
SEC-029 disabled user and stale security_version are rejected
SEC-030 notification recipient spoofing and unsafe deep links are rejected
SEC-031 spreadsheet formula injection is neutralized
SEC-032 external integrations fail closed without private configuration
SEC-033 current tree, history output and client bundle do not expose secret values
SEC-034 finance projection excludes contact PII and religious data
SEC-035 Android release rejects debug signing, backup, cleartext and broad FileProvider paths
```

- [ ] **Step 6: אמת GREEN ורגרסיה**

Run: `npm run test:security -- tests/security/harness.test.mjs`

Expected: PASS, test אחד.

Run: `npm run test:baseline`

Expected: 51 בדיקות baseline עוברות.

- [ ] **Step 7: Commit**

```powershell
git add -- package.json scripts/security/run-tests.mjs tests/security/harness.test.mjs tests/security/helpers.mjs tests/security/fixtures.mjs docs/security/SECURITY_TEST_MATRIX.md
git commit -m "test: establish security evidence harness"
```

---

### Task 2: G1 — Identity, Membership, Session and Audit Schema

**Files:**
- Create: `migrations/0018_security_foundation.sql`
- Create: `migrations/rollback/0018-0024-pre-cutover.sql`
- Create: `tests/security/migration-foundation.test.mjs`
- Modify: `migrations/README.md`

**Interfaces:**
- Consumes: `auth.users`, existing `profiles.activist_code`, `profiles.project_id/project_ids` ו־numeric owner columns.
- Produces: `project_memberships`, UUID owner columns, `profiles.global_role/security_version/disabled_at`, ו־private tables `auth_identities`, `auth_sessions`, `audit_events`, `rate_limit_buckets`.

**Dependencies:** Supabase/PostgreSQL DDL; אין package.

**Migration:** file נכתב idempotently אך אינו מורץ חי במשימה זו.

**External blockers:** הפעלה דורשת Supabase SQL Editor, backup וסביבת test.

**Rollback point:** לפני cutover ניתן להריץ rollback רק אם assertions מוכיחים שאין session פעיל ושאין row שנכתב רק בעמודות החדשות; אחרי cutover rollback הוא restore backup + revert application commits.

- [ ] **Step 1: כתוב static tests שנכשלים**

```js
import { escapeRegex } from './helpers.mjs';

const required = [
  'create table if not exists public.project_memberships',
  'create table if not exists app_private.auth_sessions',
  'create table if not exists app_private.audit_events',
  'create table if not exists app_private.rate_limit_buckets',
  'add column if not exists assigned_user_id uuid',
  'add column if not exists security_version integer',
  'revoke all on schema app_private from public, anon, authenticated',
];
for (const sql of required) assert.match(migration, new RegExp(escapeRegex(sql), 'i'));
assert.doesNotMatch(migration, /authenticated_all/i);
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/migration-foundation.test.mjs`

Expected: FAIL משום ש־`0018_security_foundation.sql` אינו קיים.

- [ ] **Step 3: כתוב migration עם ownership UUID מפורש**

ה־migration ייצור את החוזים הבאים:

```sql
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter table public.profiles
  add column if not exists global_role text,
  add column if not exists security_version integer not null default 1,
  add column if not exists disabled_at timestamptz;

create table if not exists public.project_memberships (
  project_id bigint not null references public.projects(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('head','coord','activist','finance')),
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists app_private.auth_sessions (
  session_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_key_version integer not null,
  csrf_hash text not null,
  aal smallint not null check (aal in (1,2)),
  security_version integer not null,
  auth_state text not null check (auth_state in ('active','mfa_required','recovery')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text
);

create table if not exists app_private.auth_identities (
  normalized_username text primary key check (normalized_username = lower(btrim(normalized_username))),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  login_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  effective_role text,
  project_id bigint references public.projects(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  result text not null check (result in ('success','denied','failed')),
  reason_code text,
  correlation_id uuid,
  session_ref text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table if not exists app_private.rate_limit_buckets (
  bucket_hash text primary key,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0),
  blocked_until timestamptz,
  expires_at timestamptz not null
);

create index if not exists auth_sessions_expiry_idx
  on app_private.auth_sessions (absolute_expires_at) where revoked_at is null;
create index if not exists audit_events_actor_time_idx
  on app_private.audit_events (actor_user_id, occurred_at desc);
create index if not exists rate_limit_expiry_idx
  on app_private.rate_limit_buckets (expires_at);
```

יש להוסיף UUID columns/backfill לכל mapping: `contacts.assigned_user_id`, `interactions.actor_user_id`, `base_meeting_reports.actor_user_id`, `expenses.actor_user_id`, `feedback_reports.reporter_user_id`, `notifications.recipient_user_id`, `notification_reads.recipient_user_id`, `meeting_reminders.recipient_user_id`, `push_subscriptions.user_id`, `fcm_tokens.user_id`, ו־`tours.guide_user_id/host_user_id/assigned_user_ids`. כל backfill מצטרף ל־`profiles.activist_code`. לכל table יופעל guard במבנה המלא הבא, עם שמות העמודות המתאימים:

```sql
update public.contacts c
set assigned_user_id = p.id
from public.profiles p
where c.activist_id = p.activist_code and c.assigned_user_id is null;

do $$ begin
  if exists (
    select 1 from public.contacts c
    where c.activist_id is not null and c.assigned_user_id is null
  ) then
    raise exception 'security backfill refused: contacts owner mapping missing';
  end if;
end $$;
```

- [ ] **Step 4: הוסף audit ו־rate table constraints**

`audit_events` יהיה append-only עם `actor_user_id`, `effective_role`, `project_id`, `action`, `resource_type/id`, `result`, `reason_code`, `correlation_id`, `session_ref`, `metadata jsonb` ו־timestamp. `rate_limit_buckets` יקבל `bucket_hash`, `window_started_at`, `count`, `blocked_until` ו־expiry index. אין raw IP, username, token או request body.

- [ ] **Step 5: כתוב rollback guard ותעד status**

ה־rollback יתחיל ב־assertion הבא ולא יכיל `cascade`:

```sql
do $$ begin
  if exists (select 1 from app_private.auth_sessions) then
    raise exception 'pre-cutover rollback refused: sessions exist';
  end if;
end $$;
```

ב־`migrations/README.md` יש לרשום `0018` כ־“לא הורץ — נדרש G5”.

- [ ] **Step 6: אמת GREEN ו־diff**

Run: `npm run test:security -- tests/security/migration-foundation.test.mjs`

Expected: PASS לכל object, revoke, backfill assertion ו־rollback guard.

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```powershell
git add -- migrations/0018_security_foundation.sql migrations/rollback/0018-0024-pre-cutover.sql migrations/README.md tests/security/migration-foundation.test.mjs
git commit -m "feat: define hardened identity and session schema"
```

---

### Task 3: G1 — Explicit Grants, RLS Policies and Security Inventory

**Files:**
- Create: `migrations/0019_security_rls.sql`
- Create: `tests/security/migration-rls.test.mjs`
- Create: `scripts/security/verify-rls-live.mjs`
- Modify: `migrations/README.md`

**Interfaces:**
- Consumes: Task 2 UUID ownership ו־`project_memberships`.
- Produces: `app_is_ceo()`, `app_has_project_role(bigint,text[])`, explicit SELECT/INSERT/UPDATE/DELETE policies, `app_security_posture()` ל־service role בלבד, ו־live verifier contract.

**Dependencies:** Task 2.

**Migration:** file בלבד עד G5.

**External blockers:** JWT fixture credentials וסביבת Supabase test.

**Rollback point:** pre-cutover rollback משחזר snapshot של policy names/grants שנלקח בתחילת migration; אין שחזור של `authenticated_all` בסביבה עם PII.

- [ ] **Step 1: כתוב policy completeness tests שנכשלים**

```js
const sensitive = [
  'projects','project_memberships','profiles','contacts','interactions',
  'base_meeting_reports','meeting_houses','meeting_reminders','tours','expenses',
  'bonus_cancellations','payment_config','notifications','notification_reads',
  'push_subscriptions','fcm_tokens','feedback_reports'
];
for (const table of sensitive) {
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
}
assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/migration-rls.test.mjs`

Expected: FAIL על migration חסר.

- [ ] **Step 3: כתוב helpers נעולים**

```sql
create or replace function public.app_has_project_role(p_project_id bigint, p_roles text[])
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.project_memberships pm
    join public.profiles p on p.id = auth.uid()
    where pm.project_id = p_project_id and pm.user_id = auth.uid()
      and pm.status = 'active' and pm.role = any(p_roles) and p.disabled_at is null
      and (pm.role <> 'head' or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;
revoke all on function public.app_has_project_role(bigint,text[]) from public, anon;
grant execute on function public.app_has_project_role(bigint,text[]) to authenticated;
```

`app_is_ceo()` ידרוש `profiles.global_role='ceo'`, משתמש לא חסום ו־JWT `aal='aal2'` לפעולות מוגנות. helper לקריאה עצמית לא יעקוף disable/security state.

- [ ] **Step 4: כתוב policies מפורשות לכל CRUD**

לכל טבלה יש להסיר את כל policies הקודמות בשמות מפורשים וליצור policies נפרדות. דוגמת contacts המחייבת את יתר הדפוס:

```sql
create policy contacts_select on public.contacts for select to authenticated using (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_insert on public.contacts for insert to authenticated with check (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_update on public.contacts for update to authenticated
using (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
)
with check (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_delete on public.contacts for delete to authenticated using (public.app_is_ceo());
```

במימוש אין להשאיר comments במקום predicates: יש לשכפל את predicate המלא ב־`USING` וב־`WITH CHECK`. Finance לא מקבל SELECT על contacts/interactions אלא RPC מצרפי. notifications מקבל INSERT רק דרך RPC; audit/session/rate אינם ב־public grants.

הוסף trigger function אטומי ל־audit של mutations מוצלחים. הוא שומר רק שמות שדות ששונו, לא values:

```sql
create or replace function app_private.audit_row_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, app_private as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changed_fields text[] := case when tg_op = 'UPDATE' then array(
    select key from jsonb_each(to_jsonb(new)) n(key,value)
    where to_jsonb(old) -> key is distinct from n.value
    order by key
  ) else array[]::text[] end;
begin
  insert into app_private.audit_events
    (actor_user_id, project_id, action, resource_type, resource_id, result, metadata)
  values
    (auth.uid(), nullif(v_row ->> 'project_id','')::bigint,
     lower(tg_op), tg_table_name, v_row ->> 'id', 'success',
     jsonb_build_object('changedFields', v_changed_fields));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
```

Attach AFTER INSERT/UPDATE/DELETE triggers ל־projects, project_memberships, profiles, contacts, interactions, base_meeting_reports, meeting_houses, meeting_reminders, tours, expenses, bonus_cancellations, payment_config, notifications, push_subscriptions, fcm_tokens ו־feedback_reports. static test מוודא שכל table ברשימה מחובר. auth failures, denials ו־external actions נכתבים דרך `app_audit_append`; successful row mutation אינו נכתב שוב ב־API.

- [ ] **Step 5: הוסף inventory assertion ו־live verifier**

`app_security_posture()` יחזיר רק ל־service_role: table, `relrowsecurity`, `relforcerowsecurity`, commands ו־policy count. הוא ייכשל אם קיימת public table ללא classification או policy עם `qual/with_check = true`.

`verify-rls-live.mjs` יקבל רק `SECURITY_TEST_*` variables, יסרב אם URL שווה ל־`NEXT_PUBLIC_SUPABASE_URL`, ויריץ JWT של CEO/head/coord/activist/finance מול two-project fixture.

- [ ] **Step 6: אמת GREEN**

Run: `npm run test:security -- tests/security/migration-rls.test.mjs`

Expected: PASS עבור 17 הטבלאות, views כ־security invoker, revoke של helpers והיעדר permissive-all.

- [ ] **Step 7: Commit**

```powershell
git add -- migrations/0019_security_rls.sql migrations/README.md tests/security/migration-rls.test.mjs scripts/security/verify-rls-live.mjs
git commit -m "feat: enforce explicit tenant RLS policies"
```

---

### Task 4: G2 — Server Environment, Validation, Errors and HTTP Guard

**Files:**
- Create: `lib/security/env.mjs`
- Create: `lib/security/errors.mjs`
- Create: `lib/security/http.mjs`
- Create: `lib/security/schemas.mjs`
- Create: `tests/security/http-validation.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Next API `req/res`.
- Produces: `getServerEnv()`, `SecurityError`, `parseJson(req,schema,{maxBytes})`, `assertSameOrigin(req)`, `sendJson(res,status,payload)`, `mapError(error,requestId)`.

**Dependencies:** `zod@3.25.76`, installed with `--save-exact`.

**External blockers:** production origin list values; code uses `APP_ORIGIN` and fails startup when absent in Production.

**Rollback point:** revert commit; no DB state.

- [ ] **Step 1: כתוב negative tests לפני המימוש**

```js
import { fakeReq } from './helpers.mjs';

test('unknown authority fields are rejected', async () => {
  const result = contactCreateSchema.safeParse({ name: 'א', project_id: 2, role: 'ceo' });
  assert.equal(result.success, false);
});
test('oversized JSON is rejected before business handler', async () => {
  const req = fakeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(65537) });
  await assert.rejects(() => parseJson(req, contactCreateSchema, { maxBytes: 65536 }),
    error => error.code === 'PAYLOAD_TOO_LARGE');
});
test('foreign origin is rejected', () => {
  const req = fakeReq({ method: 'POST', headers: { origin: 'https://evil.invalid' } });
  assert.throws(() => assertSameOrigin(req), /ORIGIN_DENIED/);
});
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/http-validation.test.mjs`

Expected: FAIL על modules חסרים.

- [ ] **Step 3: התקן Zod וממש contracts**

Run: `npm.cmd install --save-exact zod@3.25.76`

`SecurityError` כולל רק `status`, `code`, `publicMessage`; `cause` אינו serialized. `sendJson` מוסיף `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` ו־request id. `parseJson` דורש JSON content type, מודד bytes, ומשתמש ב־`.strict()` לכל object schema.

- [ ] **Step 4: הגדר schemas מדויקים**

```js
export const contactCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().max(4000).optional(),
  assignedUserId: z.string().uuid().optional()
}).strict();
```

יש ליצור schemas עבור login, MFA code, reset, IDs, dates, pagination, interactions, meetings, tours, expenses, feedback, push ו־AI. Arrays מוגבלים ל־100, notes ל־4,000, AI text ל־8,000, feedback ל־4,000 ו־request רגיל ל־64 KiB.

- [ ] **Step 5: אמת GREEN ו־build**

Run: `npm run test:security -- tests/security/http-validation.test.mjs`

Expected: PASS לכל malformed/unknown/oversized/origin case.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- package.json package-lock.json lib/security/env.mjs lib/security/errors.mjs lib/security/http.mjs lib/security/schemas.mjs tests/security/http-validation.test.mjs
git commit -m "feat: add fail-closed HTTP validation boundary"
```

---

### Task 5: G2 — Opaque Sessions, Token Encryption, CSRF and Shared Rate Limits

**Files:**
- Create: `migrations/0020_security_rpcs.sql`
- Create: `lib/security/crypto.mjs`
- Create: `lib/security/cookies.mjs`
- Create: `lib/security/csrf.mjs`
- Create: `lib/security/rate-limit.mjs`
- Create: `lib/security/session-store.mjs`
- Create: `lib/security/session.mjs`
- Create: `tests/security/session-csrf-rate.test.mjs`
- Modify: `migrations/rollback/0018-0024-pre-cutover.sql`
- Modify: `migrations/README.md`

**Interfaces:**
- Produces: `createSession(input)`, `loadSession(req)`, `rotateSession(session,reason)`, `revokeSession(session,reason)`, `issueCsrf(session)`, `verifyCsrf(req,session)`, `consumeRateLimit(key,limit,windowSeconds)`.
- Session result: `{idHash,userId,accessToken,refreshToken,aal,authState,securityVersion,csrfHash,idleExpiresAt,absoluteExpiresAt}`; raw provider tokens קיימים בזיכרון request בלבד.

**Dependencies:** Tasks 2 ו־4; `SESSION_ID_PEPPER`, `SESSION_TOKEN_ENCRYPTION_KEY_V1` ו־`SESSION_TOKEN_KEY_VERSION=1` בסביבה.

**Migration:** RPCs service-only; אין live run עד G5.

**External blockers:** secret generation/storage ב־Vercel ו־Supabase test.

**Rollback point:** revoke all sessions, clear cookie, disable auth feature flag, then revert commit; אין fallback ל־localStorage JWT.

- [ ] **Step 1: כתוב tests שליליים**

```js
test('tampered ciphertext fails closed', () => {
  const sealed = sealToken('secret', key, 1);
  assert.throws(() => openToken(sealed.slice(0, -1) + 'A', { 1: key }), /TOKEN_DECRYPT_FAILED/);
});
test('expired and revoked sessions are denied', async () => {
  await assert.rejects(() => loadSession(req, fakeStore({ revokedAt: now })), hasCode('SESSION_INVALID'));
});
test('csrf token from another session is denied', () => {
  assert.throws(() => verifyCsrf(reqWith(tokenA), sessionB), /CSRF_DENIED/);
});
test('sixth login attempt is blocked in the same window', async () => {
  assert.equal((await consumeSixTimes()).last.allowed, false);
});
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/session-csrf-rate.test.mjs`

Expected: FAIL על exports חסרים.

- [ ] **Step 3: מימוש crypto/cookie/session**

`session id` ו־CSRF נוצרים ב־`randomBytes(32)`. session cookie מכיל base64url id גולמי בלבד; DB שומר `HMAC-SHA-256(SESSION_ID_PEPPER,id)`. provider tokens מוצפנים ב־AES-256-GCM עם IV אקראי, auth tag ו־key version.

```js
export const productionCookie = {
  name: '__Host-mekarvim_session', httpOnly: true, secure: true,
  sameSite: 'Lax', path: '/', domain: undefined
};
```

`loadSession` בודק revoke, idle/absolute expiry, `profiles.disabled_at`, `security_version`, ומרענן Supabase token single-flight. שינוי privilege/MFA/password מסובב session id ו־CSRF.

- [ ] **Step 4: מימוש RPCs אטומיים**

`0020` ייצור RPCs service-role בלבד: `app_session_create/load/touch/rotate/revoke`, `app_rate_limit_consume`, `app_audit_append`, `app_membership_change`. כל function עם fixed `search_path`, revoke מ־public/anon/authenticated, validation פנימי ו־transactional update. rate RPC משתמש ב־database time ובמבנה האטומי הבא:

```sql
insert into app_private.rate_limit_buckets
  (bucket_hash, window_started_at, count, blocked_until)
values
  (p_bucket_hash, now(), 1, null)
on conflict (bucket_hash) do update set
  window_started_at = case
    when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
      then now() else app_private.rate_limit_buckets.window_started_at end,
  count = case
    when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
      then 1 else app_private.rate_limit_buckets.count + 1 end,
  blocked_until = case
    when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
      then null
    when app_private.rate_limit_buckets.count + 1 > p_limit
      then app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds)
      else app_private.rate_limit_buckets.blocked_until end;
```

- [ ] **Step 5: אמת GREEN**

Run: `npm run test:security -- tests/security/session-csrf-rate.test.mjs`

Expected: PASS עבור tamper, fixation, replay, expiry, revoke, cross-session CSRF ו־limits 5/15m, 3/1h, 5/10m.

- [ ] **Step 6: Commit**

```powershell
git add -- migrations/0020_security_rpcs.sql migrations/README.md lib/security/crypto.mjs lib/security/cookies.mjs lib/security/csrf.mjs lib/security/rate-limit.mjs lib/security/session-store.mjs lib/security/session.mjs tests/security/session-csrf-rate.test.mjs
git commit -m "feat: add opaque revocable server sessions"
```

---

### Task 6: G2 — Supabase Auth, MFA and Password Recovery BFF

**Files:**
- Create: `lib/security/auth-service.mjs`
- Create: `lib/security/api-client.mjs`
- Create: `pages/api/auth/login.js`
- Create: `pages/api/auth/logout.js`
- Create: `pages/api/auth/session.js`
- Create: `pages/api/auth/mfa/enroll.js`
- Create: `pages/api/auth/mfa/challenge.js`
- Create: `pages/api/auth/mfa/verify.js`
- Create: `pages/api/auth/password-reset/request.js`
- Create: `pages/api/auth/password-reset/verify.js`
- Create: `pages/api/auth/password-reset/complete.js`
- Create: `components/auth/MfaEnrollment.jsx`
- Create: `components/auth/MfaChallenge.jsx`
- Create: `pages/reset-password.jsx`
- Create: `tests/security/auth-service.test.mjs`
- Modify: `lib/AuthStore.jsx`
- Modify: `pages/login.jsx`
- Modify: `pages/_app.jsx`

**Interfaces:**
- Consumes: Task 5 sessions/rate limits; Supabase Auth server adapter.
- Produces: `createAuthService({identityStore,provider,sessions,rateLimiter,audit,clock})` ו־AuthStore state `{currentUser,projects,csrfToken,requiresMfa,authLoading}`.

**Dependencies:** Tasks 4–5; Supabase Auth TOTP and recovery redirect configuration.

**External blockers:** Dashboard MFA enablement, email provider ו־allowed redirect `/api/auth/password-reset/verify`.

**Rollback point:** disable `SECURITY_BFF_AUTH_ENABLED`, revoke newly created app sessions, revert commit. ה־legacy browser auth אינו מופעל מחוץ ל־local test.

- [ ] **Step 1: כתוב auth negative tests**

```js
test('unknown username and bad password have identical public response', async () => {
  assert.deepEqual(await loginPublic(unknown), await loginPublic(badPassword));
});
test('head at AAL1 receives only mfa_required state', async () => {
  const result = await service.login(headCredentials);
  assert.deepEqual(pick(result, ['authState','aal']), { authState: 'mfa_required', aal: 1 });
  assert.equal(result.profile.pii, undefined);
});
test('logout revokes server session before clearing cookie', async () => {
  await service.logout(session);
  await assert.rejects(() => service.getSession(session.cookie), hasCode('SESSION_INVALID'));
});
test('recovery token cannot become a business session', async () => {
  await assert.rejects(() => service.authorizeRecoverySession(recovery, 'contacts:read'), hasCode('AUTH_SCOPE_DENIED'));
});
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/auth-service.test.mjs`

Expected: FAIL על auth service חסר.

- [ ] **Step 3: מימוש server-only auth orchestration**

login מנרמל username, צורך rate bucket, פותר identity בטבלה פרטית, קורא `signInWithPassword` בשרת, טוען self profile דרך user JWT, קובע AAL/auth state, יוצר app session ומחזיר profile projection + CSRF. אין email directory או provider token בתגובה.

MFA משתמש ב־`auth.mfa.enroll/challenge/verify`; verify מוצלח מסובב session. CEO/head AAL1 נחסם מכל route פרט ל־session/MFA/logout. reset request generic; callback מחליף token חד־פעמי ל־recovery-scoped session ומבצע `303` ל־URL נקי; complete משנה password, מעלה `security_version` ומבטל sessions.

- [ ] **Step 4: החלף AuthStore בלי localStorage/Supabase client**

```js
async function login(username, password) {
  const result = await apiFetch('/api/auth/login', { method: 'POST', body: { username, password } });
  setCsrfToken(result.csrfToken);
  setCurrentUser(result.user ?? null);
  setRequiresMfa(result.authState === 'mfa_required');
  return result.ok;
}
```

הסר `USERNAME_TO_EMAIL`, `resolveEmail`, `getSession`, `onAuthStateChange` ו־demo passwords מהמסך. `_app` מציג MFA gate לפני `CrmProvider` ו־business components.

- [ ] **Step 5: אמת GREEN, bundle absence ו־build**

Run: `npm run test:security -- tests/security/auth-service.test.mjs`

Expected: PASS עבור enumeration, AAL1, fixation, logout, disabled user, recovery scope ו־rate limit.

Run: `npm run build`

Expected: exit 0; `rg "USERNAME_TO_EMAIL|ceo123|coord123|activist123" .next/static` מחזיר exit 1.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/security/auth-service.mjs lib/security/api-client.mjs lib/AuthStore.jsx pages/_app.jsx pages/login.jsx pages/reset-password.jsx pages/api/auth components/auth tests/security/auth-service.test.mjs
git commit -m "feat: move authentication and MFA behind the BFF"
```

---

### Task 7: G2 — Request Context, RBAC, User-Scoped Supabase and Audit

**Files:**
- Create: `lib/security/rbac.mjs`
- Create: `lib/security/request-context.mjs`
- Create: `lib/security/supabase-user.mjs`
- Create: `lib/security/audit.mjs`
- Create: `lib/security/api-handler.mjs`
- Create: `tests/security/rbac-context-audit.test.mjs`

**Interfaces:**
- Produces: `CAPABILITIES`, `authorize(context,capability,resource)`, `resolveRequestContext(req,{minimumAal})`, `createUserSupabase(accessToken)`, `appendAudit(event)`, `secureHandler(options,handler)`.
- `RequestContext`: `{requestId,userId,globalRole,memberships,aal,session,db}`; role/project/body values אינם מועתקים מהבקשה.

**Dependencies:** Tasks 3–6.

**External blockers:** אין ל־unit tests; live audit RPC waits for G5.

**Rollback point:** revert wrapper migration commit לפני domain cutover.

- [ ] **Step 1: כתוב matrix ו־negative tests**

```js
import { makeContext, activistA, coordA, headA, headAal1, financeA,
  contactOwnedByActivistB, contactA, tourProjectB, membershipA, projectA } from './fixtures.mjs';

const denied = [
  [activistA,'contact:read',contactOwnedByActivistB],
  [coordA,'tour:update',tourProjectB],
  [headA,'membership:set-ceo',membershipA],
  [financeA,'contact:read-sensitive',contactA],
  [headAal1,'report:read',projectA]
];
for (const [actor,capability,resource] of denied) {
  test(`${actor.role} denied ${capability}`, () => assert.equal(authorize(makeContext(actor), capability, resource), false));
}
```

בדיקה נוספת מוודאת ש־`createUserSupabase` משתמש ב־publishable key + `Authorization: Bearer <user JWT>` ו־`persistSession:false`, ולעולם לא קורא `SUPABASE_SECRET_KEY`.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/rbac-context-audit.test.mjs`

Expected: FAIL על modules חסרים.

- [ ] **Step 3: מימוש capability matrix ו־request context**

הגדר capabilities מפורשים: contacts/interactions/meetings/tours CRUD, finance projections, reports, membership tiers, notification targets ו־audit read. `authorize` דורש active membership ו־resource.projectId equality; CEO override דורש AAL2 ו־user לא disabled.

`secureHandler` מבצע בסדר קבוע: method → origin → session → AAL → CSRF עבור mutation → rate limit → schema → handler → redacted response/error. authorization denial, auth event ו־external action נכתבים דרך `appendAudit` ללא resource payload; successful DB mutation נרשם אטומית על ידי trigger משימה 3 כדי למנוע mutation ללא audit או כפילות.

- [ ] **Step 4: מימוש audit allowlist**

```js
const AUDIT_METADATA_KEYS = new Set(['changedFields','targetRole','source','exportFormat']);
export function sanitizeAuditMetadata(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => AUDIT_METADATA_KEYS.has(key)));
}
```

tests יחפשו וידחו `password`, `token`, `phone`, `notes`, `body`, `authorization` ו־raw error.

- [ ] **Step 5: אמת GREEN**

Run: `npm run test:security -- tests/security/rbac-context-audit.test.mjs`

Expected: PASS לכל role/scope/AAL/audit case.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/security/rbac.mjs lib/security/request-context.mjs lib/security/supabase-user.mjs lib/security/audit.mjs lib/security/api-handler.mjs tests/security/rbac-context-audit.test.mjs
git commit -m "feat: centralize server RBAC and audit enforcement"
```

---

### Task 8: G3 — Contacts and Interactions BFF with PII Projection

**Files:**
- Create: `lib/security/domains/contacts.mjs`
- Create: `lib/security/domains/interactions.mjs`
- Create: `pages/api/contacts/index.js`
- Create: `pages/api/contacts/[id].js`
- Create: `pages/api/contacts/[id]/interactions.js`
- Create: `pages/api/interactions/[id].js`
- Create: `tests/security/contacts-interactions-api.test.mjs`
- Modify: `pages/api/contacts/check-duplicate.js`
- Modify: `pages/api/interactions/notify.js`
- Modify: `lib/CrmStore.jsx`
- Modify: `pages/contacts.jsx`
- Modify: `pages/contacts/add.jsx`
- Modify: `pages/contact/[id].jsx`
- Modify: `pages/contact/add-interaction/[id].jsx`
- Modify: `pages/contact/update-mitzvot/[id].jsx`
- Modify: `pages/former-contacts.jsx`

**Interfaces:**
- Consumes: `secureHandler`, `RequestContext`, user-scoped `db`.
- Produces: `listContacts(ctx,query)`, `getContact(ctx,id)`, `createContact(ctx,input)`, `updateContact(ctx,id,input)`, `softDeleteContact(ctx,id)`, interaction CRUD ו־role-specific DTOs.

**Dependencies:** G2 complete; RLS migration file present.

**External blockers:** live RLS proof waits for G5.

**Rollback point:** feature flag `SECURITY_BFF_CONTACTS_ENABLED`; revert commit before enabling. אין fallback אחרי live cutover.

- [ ] **Step 1: כתוב API tests לפני repository**

מקרי חובה: anonymous 401; activist own 200; activist other same-project 404; project A → B 404; coord own project 200; head own project CRUD; CEO cross-project AAL2; finance detail 403; body עם `project_id/assigned_user_id/role` 400; update tenant/owner 400; oversized notes 413; XSS נשמר plain ומוחזר escaped; duplicate lookup אינו מגלה project אחר.

```js
test('activist cannot reassign a contact through request body', async () => {
  const response = await call(updateContactHandler, activistA, {
    id: contactA.id, body: { assignedUserId: activistB.userId }
  });
  assert.equal(response.status, 400);
  assert.equal(fakeDb.updateCalls.length, 0);
});
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/contacts-interactions-api.test.mjs`

Expected: FAIL על repository/routes חסרים.

- [ ] **Step 3: מימוש repository עם projections**

list DTO כולל רק `id,name,city,status,assignedUserId,nextActionAt` בהתאם ל־role. detail DTO מוסיף phone/notes/mitzvot/history רק לאחר `authorize`. Finance אינו קורא table. כל create גוזר project מה־active membership; activist owner הוא `ctx.userId`; head/coord יכולים לבחור assignee רק לאחר membership lookup באותו project.

interactions גוזרים `actor_user_id=ctx.userId` ו־project/contact מה־contact loaded דרך RLS. `participants`, formula-leading export text ו־unsafe URLs עוברים validation/sanitization.

- [ ] **Step 4: חבר APIs ו־client**

API routes משתמשים ב־`secureHandler` ולא ב־`getSupabaseAdmin`. `CrmStore` טוען contacts/interactions דרך `apiFetch`; mutations מעדכנות cache רק אחרי 2xx. רכיבי React ממשיכים להסתיר controls לפי `can`, אך השרת הוא authority.

- [ ] **Step 5: אמת GREEN ורגרסיית UX**

Run: `npm run test:security -- tests/security/contacts-interactions-api.test.mjs`

Expected: PASS לכל 14+ cases, כולל IDOR/mass assignment.

Run: `npm run verify:interaction-report`

Expected: 27/27 PASS.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/security/domains/contacts.mjs lib/security/domains/interactions.mjs pages/api/contacts pages/api/interactions lib/CrmStore.jsx pages/contacts.jsx pages/contacts/add.jsx pages/contact pages/former-contacts.jsx tests/security/contacts-interactions-api.test.mjs
git commit -m "feat: enforce contact and interaction tenant isolation"
```

---

### Task 9: G3 — Projects, Memberships and Profile Governance

**Files:**
- Create: `lib/security/domains/governance.mjs`
- Create: `pages/api/projects/index.js`
- Create: `pages/api/memberships/index.js`
- Create: `pages/api/memberships/[userId].js`
- Create: `pages/api/profiles/[userId].js`
- Create: `tests/security/governance-api.test.mjs`
- Modify: `pages/activists.jsx`
- Modify: `pages/activists/[id].jsx`
- Modify: `components/ActivistSearchSelect.jsx`
- Modify: `components/DesktopLayout.jsx`
- Modify: `components/MobileBottomNav.jsx`
- Modify: `pages/landing.jsx`

**Interfaces:**
- Produces: project/member directory projections ו־`changeMembership(ctx,command)` דרך audited RPC.

**Dependencies:** Tasks 3, 6, 7.

**External blockers:** provisioning of real auth users remains a controlled admin operation.

**Rollback point:** disable governance mutations; retain read-only self/project projections; revert UI commit.

- [ ] **Step 1: כתוב privilege-escalation tests**

מקרים: user modifies own role; head assigns CEO; head changes other project; coord changes membership; body forges `createdBy`; suspended membership reads data; CEO AAL1 mutation; duplicate membership; last CEO removal. כולם חייבים להיחסם או לדרוש validated CEO AAL2 transaction.

```js
test('project head cannot grant head or ceo', async () => {
  for (const role of ['head','ceo']) {
    assert.equal((await changeAs(headA, { userId: activistA, projectId: A, role })).status, 403);
  }
});
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/governance-api.test.mjs`

Expected: FAIL על governance module חסר.

- [ ] **Step 3: מימוש projections ו־RPC command**

CEO AAL2 מנהל כל role; Head AAL2 בפרויקט יכול ליצור/לעדכן רק Activist/Coordinator באותו project ואינו משנה את עצמו. Coord מקבל directory שמי בלבד; Activist self בלבד; Finance directory `{userId,name,activistCode}` הנדרש לתשלום בלי contact fields. כל שינוי מעלה `security_version`, מבטל sessions מושפעים וכותב audit באותה transaction.

- [ ] **Step 4: חבר UI לרשימת projects מורשית**

`switchProject` מקבל רק IDs שהגיעו מ־`/api/projects`; אין import מ־`data/projects.js` כסמכות. navigation נשאר UX layer ומסתמך על capabilities מה־session projection.

- [ ] **Step 5: אמת GREEN ו־build**

Run: `npm run test:security -- tests/security/governance-api.test.mjs`

Expected: PASS לכל role/tenant/self-escalation/session-revocation case.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/security/domains/governance.mjs pages/api/projects pages/api/memberships pages/api/profiles pages/activists.jsx pages/activists/[id].jsx components/ActivistSearchSelect.jsx components/DesktopLayout.jsx components/MobileBottomNav.jsx pages/landing.jsx tests/security/governance-api.test.mjs
git commit -m "feat: enforce governed project memberships"
```

---

### Task 10: G3 — Meeting Houses, Base Reports and Reminders

**Files:**
- Create: `lib/security/domains/meetings.mjs`
- Create: `tests/security/meetings-reminders-api.test.mjs`
- Create: `migrations/0021_meetings_security.sql`
- Modify: `pages/api/meeting-houses/_auth.js`
- Modify: `pages/api/meeting-houses/assign.js`
- Modify: `pages/api/meeting-houses/upsert.js`
- Modify: `pages/api/base-meetings/notify.js`
- Modify: `pages/api/reminders/schedule.js`
- Modify: `pages/api/reminders/cancel.js`
- Modify: `lib/meetingReminderScheduler.js`
- Modify: `lib/meetingHousesSupabase.js`
- Modify: `lib/CrmStore.jsx`
- Modify: `pages/base-meetings.jsx`
- Modify: `pages/meeting-houses/index.jsx`
- Modify: `pages/meeting-houses/[id].jsx`
- Modify: `pages/meeting-houses/new.jsx`
- Modify: `pages/meeting-houses/completed.jsx`
- Modify: `pages/meeting-house-results.jsx`
- Modify: `pages/reminders.jsx`

**Interfaces:**
- Produces: project-scoped house/report/reminder commands; recipient נגזר מ־assignment; cancel עובר רק דרך `app_cancel_meeting_reminders(p_meeting_id)` שטוען את rows, גוזר recipient/project ומשנה `cancelled_at` בלבד.

**Dependencies:** Tasks 7 ו־9.

**External blockers:** live scheduler validation needs staging cron approval.

**Rollback point:** disable reminder cron and meeting mutation feature flags; לפני cutover בלבד ודא שאין `idempotency_key`/`cancelled_at`, הסר RPC → constraint/index → columns; לאחר cutover restore backup.

- [ ] **Step 1: כתוב BOLA tests**

מקרים: coord A assigns house B; activist reports unassigned house; report ID from another activist; schedule arbitrary recipient; cancel another recipient reminder; body changes project; anonymous notify; replay duplicate schedule. expected 401/404/409 ללא DB write.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/meetings-reminders-api.test.mjs`

Expected: FAIL על domain חסר.

- [ ] **Step 3: מימוש domain ו־API guards**

house נטען דרך `project_id` + membership; assignments נבדקים מול active members באותו project. report actor/project/house נגזרים בשרת. reminder recipient/meeting נגזרים מ־report/assignment; client אינו שולח authority fields. idempotency key מונע schedule כפול.

- [ ] **Step 4: הסר fallback רגיש מהלקוח**

הסר שימוש production ב־`meetingHousesStorage`/localStorage. מצבי offline מציגים שגיאה או cached non-PII shell בלבד; אין טעינת mocks כאשר DB/API נכשל.

- [ ] **Step 5: אמת GREEN ו־build**

Run: `npm run test:security -- tests/security/meetings-reminders-api.test.mjs`

Expected: PASS לכל BOLA/replay/tenant case.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- migrations/0021_meetings_security.sql lib/security/domains/meetings.mjs pages/api/meeting-houses pages/api/base-meetings pages/api/reminders lib/meetingReminderScheduler.js lib/meetingHousesSupabase.js lib/CrmStore.jsx pages/base-meetings.jsx pages/meeting-houses pages/meeting-house-results.jsx pages/reminders.jsx tests/security/meetings-reminders-api.test.mjs
git commit -m "feat: isolate meeting and reminder workflows"
```

---

### Task 11: G3 — Tours Assignment, Updates, Reports and Deletion

**Files:**
- Create: `lib/security/domains/tours.mjs`
- Create: `tests/security/tours-api.test.mjs`
- Create: `migrations/0022_tours_security.sql`
- Modify: `pages/api/tours/assign.js`
- Modify: `pages/api/tours/cancel.js`
- Modify: `pages/api/tours/delete.js`
- Modify: `pages/api/tours/notify.js`
- Modify: `pages/api/tours/report.js`
- Modify: `pages/api/tours/update.js`
- Modify: `pages/api/tours/upsert.js`
- Modify: `lib/toursSupabase.js`
- Modify: `lib/tourAudience.js`
- Modify: `pages/tours.jsx`

**Interfaces:**
- Produces: `getTour`, `createTour`, `assignTour`, `updateTour`, `cancelTour`, `submitTourReport`, `deleteTour` עם project/assignment authorization. הגשת report עוברת דרך `app_submit_tour_report`; reporter נגזר מ־`auth.uid()` ו־report columns אינם נכללים ב־direct UPDATE grants.

**Dependencies:** Tasks 7 ו־9.

**External blockers:** אין ל־unit; sheet sync מטופל במשימה 14.

**Rollback point:** disable tour mutations; לפני cutover ודא שאין data חדש ב־`reported_by_user_id`/`cancellation_reason`/`cancelled`, הסר RPC → index/constraints → columns; לאחר cutover restore backup.

- [ ] **Step 1: כתוב cross-project ו־mass-assignment tests**

מקרים: head A tour B; coord A update B; activist unassigned report; activist changes `guide_user_id`; delete with contact from another project; status/assignment smuggled into update; unsafe report content; repeated cancel. ודא שאין service-role business query.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/tours-api.test.mjs`

Expected: FAIL.

- [ ] **Step 3: מימוש repository ו־DTOs**

create/update schemas מפרידים editable fields מ־status/assignment/report. UUID assignees נפתרים רק מתוך active memberships של אותו project. Activist מקבל רק tours שהוקצה אליהם; managers מקבלים project list; finance מקבל tour count/pay projection בלבד.

- [ ] **Step 4: חבר routes/UI והסר admin CRUD**

כל route משתמש ב־`ctx.db` user client. notification נשלחת רק לאחר mutation מוצלח וליעדים שנגזרו מה־tour. delete הוא CEO/head AAL2 בלבד או soft delete לפי schema.

- [ ] **Step 5: אמת GREEN**

Run: `npm run test:security -- tests/security/tours-api.test.mjs`

Expected: PASS לכל IDOR/status/assignment/delete/report case.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- migrations/0022_tours_security.sql lib/security/domains/tours.mjs pages/api/tours lib/toursSupabase.js lib/tourAudience.js pages/tours.jsx tests/security/tours-api.test.mjs
git commit -m "feat: enforce tour resource authorization"
```

---

### Task 12: G3 — Notifications, Push Tokens and Safe Deep Links

**Files:**
- Create: `lib/security/domains/notifications.mjs`
- Create: `tests/security/notifications-push-api.test.mjs`
- Create: `migrations/0023_notifications_security.sql`
- Modify: `pages/api/push/register-fcm.js`
- Modify: `pages/api/push/send.js`
- Modify: `pages/api/push/status.js`
- Modify: `pages/api/push/subscribe.js`
- Modify: `pages/api/push/test.js`
- Modify: `pages/api/mitzvot/notify.js`
- Modify: `lib/notifyRecipients.js`
- Modify: `lib/fcmAdmin.js`
- Modify: `lib/webPushSend.js`
- Modify: `lib/notificationDemo.js`
- Modify: `lib/pushClient.js`
- Modify: `public/sw.js`
- Modify: `pages/notifications.jsx`

**Interfaces:**
- Produces: owner-only token CRUD, service/RPC-only notification insertion, generic lock-screen payload ו־`normalizeInternalPath(value)`. ה־RPC גוזר project/recipients מה־resource, בודק capability נפרד לכל event, ו־`p_project_id` הוא narrowing assertion בלבד.

**Dependencies:** Tasks 7–11.

**External blockers:** FCM/VAPID key restriction and staging push device.

**Rollback point:** disable push delivery while retaining in-app notifications; revoke tokens if ownership backfill fails.

- [ ] **Step 1: כתוב spoofing/XSS tests**

מקרים: user registers token for another user; manager sends arbitrary recipient/body; `javascript:`/`data:`/`//evil` deep links; cross-project target; notification insert direct; user reads another recipient; lock-screen body contains phone/contact/mitzva. כולם denied או projected generic.

```js
for (const url of ['javascript:alert(1)','data:text/html,x','//evil.invalid','https://evil.invalid']) {
  assert.throws(() => normalizeInternalPath(url), /UNSAFE_REDIRECT/);
}
assert.equal(toPushPayload(sensitive).body, 'יש עדכון חדש במערכת');
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/notifications-push-api.test.mjs`

Expected: FAIL.

- [ ] **Step 3: מימוש owner/service boundaries**

subscription/token owner נגזר מ־session; send route אינו מקבל title/body/recipient חופשיים אלא `{eventType,resourceId}` ומפיק payload מ־resource מורשה. notifications נכתבות דרך RPC שמוודא recipient membership/assignment וכותב audit.

- [ ] **Step 4: הקשח service worker ו־client**

service worker פותח רק relative allowlisted path תחת origin הנוכחי. local notification caches כוללים IDs/read state בלבד או מוסרים; content נטען מחדש אחרי session validation.

- [ ] **Step 5: אמת GREEN**

Run: `npm run test:security -- tests/security/notifications-push-api.test.mjs`

Expected: PASS לכל spoofing/PII/deep-link/owner case.

- [ ] **Step 6: Commit**

```powershell
git add -- migrations/0023_notifications_security.sql lib/security/domains/notifications.mjs pages/api/push pages/api/mitzvot/notify.js lib/notifyRecipients.js lib/fcmAdmin.js lib/webPushSend.js lib/notificationDemo.js lib/pushClient.js public/sw.js pages/notifications.jsx tests/security/notifications-push-api.test.mjs
git commit -m "feat: secure notification and push delivery"
```

---

### Task 13: G3 — Finance, Expenses, Payments, Reports and Feedback

**Files:**
- Create: `lib/security/domains/finance.mjs`
- Create: `lib/security/domains/feedback.mjs`
- Create: `pages/api/expenses/index.js`
- Create: `pages/api/expenses/[id].js`
- Create: `pages/api/payments/index.js`
- Create: `pages/api/payments/[userId].js`
- Create: `pages/api/feedback/index.js`
- Create: `tests/security/finance-reports-feedback.test.mjs`
- Create: `migrations/0024_finance_security.sql`
- Modify: `pages/api/reports/interaction-report.js`
- Modify: `lib/interactionReportServer.js`
- Modify: `pages/expenses.jsx`
- Modify: `pages/payments.jsx`
- Modify: `pages/payments/[id].jsx`
- Modify: `pages/interaction-report.jsx`
- Modify: `pages/feedback.jsx`

**Interfaces:**
- Produces: Finance DTO ללא contact PII; self/project expense commands; CEO/Head AAL2 reports; actor-derived feedback. `app_finance_summary` מחזירה allowlist מצרפי בלבד ומבצעת audit אטומי ומצונזר.

**Dependencies:** Tasks 7–9 ושרשרת DB ‏0018–0024. סכמת `expenses` הקנונית נשארת `date,amount,description,project_id,actor_user_id,activist_id`; שמות DTO מודרניים ממופים ב־repository בלבד, ללא schema migration או dual-write.

**External blockers:** live export validation uses approved Supabase test data; production report generation remains disabled until G5.

**Rollback point:** disable export/mutations and revert commit; generated files אינם persisted.

- [ ] **Step 1: כתוב field-level ו־tenant tests**

מקרים: Finance sees aggregate/name/payment only; no phone/notes/mitzvot/contact names; activist sees own payment/expenses; project A finance cannot B; body forges activist/project/amount fields; report head/coord denied; CEO AAL1 denied; feedback reporter/project forgery; spreadsheet formula prefixes escaped.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/finance-reports-feedback.test.mjs`

Expected: FAIL.

- [ ] **Step 3: מימוש projections ו־server exports**

Finance query משתמש ב־RPC מצרפי עם columns `userId,name,period,activityTotal,bonusTotal,tourTotal,expenseTotal,grandTotal`; אין join שמחזיר contact rows. expense actor/project נגזרים. interaction report דורש CEO+AAL2 ומחזיר `no-store`; Excel/PDF formula injection guard מוסיף `'` למחרוזת שמתחילה ב־`=,+,-,@`.

- [ ] **Step 4: חבר feedback ל־BFF**

create feedback גוזר reporter/project מה־session; creator רואה שלו, CEO רואה הכל, Head רואה project scope. error/upstream fields אינם מוחזרים. GitHub forwarding מטופל בנפרד במשימה 14 ונשאר disabled.

- [ ] **Step 5: אמת GREEN ורגרסיית reports/payments**

Run: `npm run test:security -- tests/security/finance-reports-feedback.test.mjs`

Run: `npm run verify:interaction-report`

Run: `node scripts/verify-payment-order.cjs`

Expected: כל security tests עוברים; 27 + 24 baseline tests עוברים.

- [ ] **Step 6: Commit**

```powershell
git add -- migrations/0024_finance_security.sql lib/security/domains/finance.mjs lib/security/domains/feedback.mjs pages/api/expenses pages/api/payments pages/api/feedback pages/api/reports/interaction-report.js lib/interactionReportServer.js pages/expenses.jsx pages/payments pages/interaction-report.jsx pages/feedback.jsx tests/security/finance-reports-feedback.test.mjs
git commit -m "feat: minimize financial and report data exposure"
```

---

### Task 14: G3 — External Integrations Fail Closed

**Files:**
- Create: `lib/security/external-data.mjs`
- Create: `tests/security/external-integrations.test.mjs`
- Modify: `pages/api/ai-summary.js`
- Modify: `lib/aiService.js`
- Modify: `lib/toursSheet.js`
- Modify: `pages/api/cron/tours-sheet-sync.js`
- Modify: `pages/api/cron/feedback-to-issues.js`
- Modify: `vercel.json`

**Interfaces:**
- Produces: `projectAiPayload`, `redactExternalError`, private Google Sheets adapter, sanitized/disabled GitHub bridge, `requireCronAuth`.

**Dependencies:** Tasks 4, 7, 11, 13.

**External blockers:** Google service account + private sheet; private GitHub repo/token or explicit permanent disable; Anthropic DPA/consent decision.

**Rollback point:** integrations remain disabled; rollback never returns to public CSV or PII GitHub issues.

- [ ] **Step 1: כתוב exfiltration/fail-closed tests**

מקרים: AI payload excludes phone/address/IDs/full history and caps 8,000 chars; missing Anthropic key disables; sheet adapter rejects public CSV mode; missing Google credentials performs zero DB writes; GitHub public repo mode rejected; issue body excludes reporter name/id/project/message raw; cron secret compared timing-safe; upstream errors redacted.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/external-integrations.test.mjs`

Expected: FAIL.

- [ ] **Step 3: הקשח AI ו־Google Sheets**

AI requires authorized resource ID, loads text server-side, projects required fields, records consent/audit, rate limits and times out. Google read/write uses OAuth service account and exact allowlist `TOURS_SHEET_ID` + range; remove unauthenticated CSV fetch. Missing config returns stable disabled status and no mutation.

- [ ] **Step 4: בטל או צמצם GitHub bridge**

ברירת המחדל `FEEDBACK_GITHUB_ENABLED=false`. הפעלה דורשת `GITHUB_REPO_VISIBILITY=private`; payload מכיל category, internal opaque reference ו־redacted summary בלבד. אם visibility אינה מאומתת, cron נכשל סגור לפני SELECT של feedback text.

- [ ] **Step 5: אמת GREEN**

Run: `npm run test:security -- tests/security/external-integrations.test.mjs`

Expected: PASS לכל no-config/public-target/PII/upstream case.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/security/external-data.mjs pages/api/ai-summary.js lib/aiService.js lib/toursSheet.js pages/api/cron/tours-sheet-sync.js pages/api/cron/feedback-to-issues.js vercel.json tests/security/external-integrations.test.mjs
git commit -m "feat: fail closed at external data boundaries"
```

---

### Task 15: G4 — Complete Browser Cutover and Remove PII Fallbacks

**Files:**
- Create: `tests/security/client-boundary.test.mjs`
- Create: `scripts/security/scan-client-bundle.mjs`
- Modify: `lib/CrmStore.jsx`
- Modify: all pages/components still reported by `rg -l "getSupabaseClient|supabase\.from|localStorage|sessionStorage" pages components lib`
- Delete: `lib/supabaseClient.js`
- Delete: `lib/apiAuth.js`
- Delete when unreferenced: `lib/meetingHousesStorage.js`, `lib/reminderTrigger.js`
- Delete or replace with clearly synthetic test fixtures: `data/contacts.js`, `data/interactions.js`, `data/messages.js`, `data/base-meetings.js`
- Delete tracked sensitive/generated artifacts: `scripts/contacts_seed.sql`, `scripts/contacts_seed_beta.sql`, `reports/דו״ח-קשרים-אחדות-יהודית.pdf`, `reports/דו״ח-קשרים-אחדות-יהודית.xlsx`

**Interfaces:**
- Consumes: all G3 BFF APIs.
- Produces: browser bundle עם `apiFetch` בלבד לנתונים רגישים; no PII persistence.

**Dependencies:** Tasks 8–14 all green.

**External blockers:** none for local cutover.

**Rollback point:** revert entire cutover commit only before any real data is introduced; after deployment, rollback requires previous hardened BFF version, not legacy auth.

- [ ] **Step 1: כתוב boundary scan שנכשל**

```js
const forbidden = [
  /getSupabaseClient/, /persistSession\s*:\s*true/, /authHeader\(/,
  /localStorage\.(setItem|getItem).*?(contact|interaction|report|notification)/i,
  /USERNAME_TO_EMAIL/, /ceo123|coord123|activist123/
];
for (const pattern of forbidden) assert.doesNotMatch(clientSources, pattern);
```

הבדיקה גם מוודאת שאין imports מ־PII data arrays ושאין `getSupabaseAdmin` ב־business route שאינו allowlisted auth/session/audit/rate/cron wrapper.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/client-boundary.test.mjs`

Expected: FAIL עם רשימת המיקומים הנוכחיים, ללא הדפסת PII.

- [ ] **Step 3: השלם page-by-page cutover**

העבר dashboard, today, my-activities, chat, base meetings, tours, reminders, notifications, payments ו־feedback ל־BFF DTOs. אין catch שמחזיר demo data. network error מציג error state ושומר רק non-sensitive UI preferences.

- [ ] **Step 4: הסר legacy files ו־artifacts**

לפני delete הרץ `rg` לכל import. מחק רק קבצים ללא consumer production. Test fixtures עוברים ל־`tests/fixtures/synthetic/` עם שמות/טלפונים דמיוניים שאינם דומים לנתוני אמת. generated reports מוסרים מה־index ולא מהיסטוריה; history cleanup נשאר blocker נפרד.

צור `scan-client-bundle.mjs` עם allowlist ריקה כברירת מחדל ועם categories קבועות:

```js
export const CLIENT_FORBIDDEN = [
  ['service-key-name', /SUPABASE_SECRET_KEY/g],
  ['server-secret-name', /SESSION_TOKEN_ENCRYPTION_KEY|SESSION_ID_PEPPER|CRON_SECRET|VAPID_PRIVATE_KEY/g],
  ['legacy-user-directory', /USERNAME_TO_EMAIL|achdut-crm\.test/g],
  ['bearer-token', /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g]
];
```

הסקריפט סורק רק `.next/static`, מדפיס category + relative file, ואינו מדפיס match.

- [ ] **Step 5: אמת GREEN ו־bundle scan**

Run: `npm run test:security -- tests/security/client-boundary.test.mjs`

Run: `npm run build`

Run: `node scripts/security/scan-client-bundle.mjs`

Expected: no browser Supabase auth/data, service key, demo password, user directory או tracked PII fallback.

- [ ] **Step 6: Commit**

```powershell
git add -A -- lib pages components data scripts reports tests/security/client-boundary.test.mjs
git commit -m "refactor: remove browser data and auth authority"
```

---

### Task 16: G4 — CSP, Security Headers, CORS and Cache Controls

**Files:**
- Create: `middleware.js`
- Create: `scripts/security/verify-http.mjs`
- Create: `tests/security/headers-cors-cache.test.mjs`
- Modify: `pages/_document.jsx`
- Modify: `next.config.js`

**Interfaces:**
- Produces: per-request nonce, CSP builder, common headers, exact-origin handling ו־HTTP verifier.

**Dependencies:** Task 15 so CSP validates the final client.

**External blockers:** HSTS preload/subdomain approval; staging URL for remote verification.

**Rollback point:** revert header commit only in local/staging; Production relaxation requires security review, not emergency wildcard.

- [ ] **Step 1: כתוב header tests**

בדוק CSP directives, nonce uniqueness, no `unsafe-eval`, frame ancestors none, nosniff, referrer, permissions, no wildcard ACAO, `Vary: Origin` when allowed, and `no-store, private` on 200/401/403/404/500 API responses.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/headers-cors-cache.test.mjs`

Expected: FAIL משום שאין headers.

- [ ] **Step 3: מימוש nonce CSP ו־headers**

```js
const directives = [
  "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`,
  "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'none'", "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'", "connect-src 'self'"
];
```

`connect-src` מקבל רק origins שנדרשים בפועל אחרי ה־BFF; Supabase/Anthropic/Google אינם נגישים מהדפדפן. `_document` מעביר nonce ל־`NextScript`. microphone permission הוא `self` בלבד; שאר capabilities מושבתים. `poweredByHeader:false`.

ה־response headers המדויקים:

```js
[
  ['Content-Security-Policy', directives.join('; ')],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), geolocation=(), payment=(), microphone=(self)'],
  ['X-Frame-Options', 'DENY']
]
```

HSTS עם `includeSubDomains; preload` מופעל רק לאחר אישור G5 שכל subdomain הוא HTTPS; עד אז staging verifier מסמן אותו כ־external blocker ולא מחליף אותו בערך חלש.

- [ ] **Step 4: מימוש verifier מקומי**

`verify-http.mjs` מפעיל נגד `SECURITY_HTTP_BASE_URL`, דורש HTTPS מחוץ ל־localhost, ובודק `/`, `/api/auth/session`, 404 ו־mutation rejection. הוא מדפיס headers בלבד, בלי bodies.

- [ ] **Step 5: אמת GREEN ו־build/start smoke**

Run: `npm run test:security -- tests/security/headers-cors-cache.test.mjs`

Run: `npm run build`

Run against local `next start`: `node scripts/security/verify-http.mjs`

Expected: כל headers קיימים; no wildcard; cache private/no-store.

- [ ] **Step 6: Commit**

```powershell
git add -- middleware.js pages/_document.jsx next.config.js scripts/security/verify-http.mjs tests/security/headers-cors-cache.test.mjs
git commit -m "feat: enforce browser and transport security headers"
```

---

### Task 17: G4 — Repository Hygiene and Secret Scanning

**Files:**
- Create: `.env.example`
- Create: `scripts/security/scan-secrets.mjs`
- Modify: `scripts/security/scan-client-bundle.mjs`
- Create: `tests/security/secret-hygiene.test.mjs`
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: scanners שמחזירים nonzero על credential pattern ומדפיסים רק category, path, line number ו־hash prefix שאינו reversible.

**Dependencies:** Task 15 removes known current-tree issues.

**External blockers:** credential rotation, Firebase restrictions ו־Git history rewrite require provider/owner actions.

**Rollback point:** scanner commit reversible; files שהוסרו מה־index נשארים recoverable ב־Git. אין history rewrite במשימה.

- [ ] **Step 1: כתוב scanner-output tests**

בדוק detection של synthetic secret, redaction של הערך, `.env.*` ignore עם exception ל־`.env.example`, generated reports/logs/coverage/signing files, וסריקה של tracked files + `.next/static`. בדוק שה־scanner אינו קורא מחוץ לריפו.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/secret-hygiene.test.mjs`

Expected: FAIL על scanner/ignore חסרים.

- [ ] **Step 3: הרחב ignore ו־env contract**

```gitignore
.env
.env.*
!.env.example
.next/
coverage/
*.log
reports/*.pdf
reports/*.xlsx
android/*.jks
android/*.keystore
android/key.properties
```

`.env.example` מכיל names בלבד ומסמן server-only: Supabase URL/publishable/secret, session pepper/key versioned, app origin, cron, Anthropic, Google, GitHub, VAPID/FCM. אין sample token שנראה אמיתי.

- [ ] **Step 4: מימוש current/history/bundle scans**

history scan משתמש ב־`git log -p --all` אך parser לעולם אינו מדפיס matching value. findings קיימים מקבלים type/location/rotation flag. `android/app/google-services.json` מסווג public client config ומחייב restriction; signing/private keys אסורים.

- [ ] **Step 5: אמת GREEN או evidence-blocked**

Run: `npm run test:security -- tests/security/secret-hygiene.test.mjs`

Run: `node scripts/security/scan-secrets.mjs --current --tracked --history`

Run after build: `node scripts/security/scan-client-bundle.mjs`

Expected: current/client scans נקיים. Historical findings יכולים להישאר רק עם location/type/rotation blocker; במקרה זה final verdict אינו READY עד rotation מתועדת.

- [ ] **Step 6: Commit**

```powershell
git add -- .gitignore .env.example CLAUDE.md scripts/security/scan-secrets.mjs scripts/security/scan-client-bundle.mjs tests/security/secret-hygiene.test.mjs
git commit -m "chore: enforce secret and artifact hygiene"
```

---

### Task 18: G4 — Controlled Dependency Remediation

**Files:**
- Create: `tests/security/dependency-policy.test.mjs`
- Create: `tests/security/jspdf-compatibility.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/superpowers/specs/2026-08-27-security-hardening-design.md`
- Modify: `docs/superpowers/plans/2026-08-27-security-hardening.md`

**Interfaces:**
- Produces: patched lockfile ו־policy test שאוסר known direct vulnerable versions.

**Dependencies:** כל functional tests של G3 זמינים כדי לזהות regression.

**External blockers:** advisory ללא fix מקבל residual-risk decision. חריגות major ל־`jspdf@4.2.1` ול־`next@16.3.3` אושרו במפורש ב־2026-08-30 כקבוצות remediation נפרדות; הן אינן מאשרות React, ReactDOM, ExcelJS, UUID או major אחר.

**Rollback point:** commit נפרד לכל dependency group: Next, PDF, Capacitor assets. revert group אם regression, וה־verdict נשאר not ready עד fix חלופי.

- [ ] **Step 1: כתוב version policy test**

```js
assert.equal(pkg.dependencies.next, '16.3.3');
assert.equal(pkg.engines.node, '>=20.9.0');
assert.equal(pkg.scripts.dev, 'next dev --webpack');
assert.equal(pkg.scripts.build, 'next build --webpack');
assert.equal(pkg.scripts.start, 'next start');
assert.equal(pkg.dependencies.react, '^18');
assert.equal(pkg.dependencies['react-dom'], '^18');
assert.equal(pkg.dependencies.jspdf, '4.2.1');
assert.equal(pkg.dependencies['jspdf-autotable'], '5.0.8');
assert.equal(pkg.devDependencies?.['@capacitor/assets'], undefined);
```

הבדיקה גם קוראת lockfile ומוודאת ש־Next/jsPDF תואמים ל־manifest pins, ש־React/ReactDOM בפועל נשארו `18.3.1`, וש־PostCSS הטרנזיטיבי אינו נמוך מ־`8.5.23`.

- [ ] **Step 2: אמת RED ותעד audit לפני**

Run: `npm run test:security -- tests/security/dependency-policy.test.mjs`

Expected ב־remediation המאושר ל־PDF: שתי בדיקות policy נכשלות על manifest/lockfile שמכילים `jspdf@3.0.4`; focused compatibility tests עוברים מול ההתנהגות הקיימת לפני השדרוג.

Expected ב־remediation המאושר ל־Next: policy נכשלת על Next `<16.3.3`, PostCSS `<8.5.23`, Node floor חסר/נמוך או scripts שאינם explicit Webpack. React/ReactDOM אינם משתנים.

Run: `npm audit --json`

Historical baseline בתחילת התוכנית: 3 Critical, 10 High, 3 Moderate. Baseline לפני follow-up של jsPDF ב־2026-08-30: 1 Critical, 2 High ו־2 Moderate.

- [ ] **Step 3: שדרג קבוצות קטנות**

Run: `npm.cmd install --save-exact next@16.3.3`

לפני ואחרי ההתקנה יש לאמת `npm ls next react react-dom postcss`: עותק יחיד של Next, React/ReactDOM `18.3.1`, PostCSS `>=8.5.23`, וללא peer conflict. סקריפטי dev/build עוברים ל־Webpack מפורש ונוסף `engines.node: >=20.9.0`. אין codemod, App Router migration או המרת `middleware.js` ל־`proxy.js` במסגרת הקבוצה.

Run: `npm run build && npm run test:baseline && npm run test:security`

לאחר build יש לאמת 32 מסלולי Pages כולל `/404` הסינתטי ו־56 מסלולי API, `next start` עם CSP nonce ייחודי וכותרות security/cache מלאות, cross-origin rejection, auth/session regressions, client render, bundle/secret scans, `npx --no-install cap sync android` ללא native drift, `testDebugUnitTest`, `assembleDebug` ו־release fail-closed ללא keystore. אזהרת `optimizeFonts` או deprecation של middleware שאינה שוברת build מתועדת ואינה מרחיבה scope.

Run: `npm.cmd install --save-exact jspdf@4.2.1`

אין לשנות את `jspdf-autotable@5.0.8`. יש לאמת `npm ls jspdf jspdf-autotable` מציג עותק יחיד compatible/deduped.

Run: `node --test --test-concurrency=1 tests/security/dependency-policy.test.mjs tests/security/jspdf-compatibility.test.mjs`

Run: `npm run verify:interaction-report && npm run build`

ה־focused tests מכסים Node/browser generation, חתימת PDF, Assistant/Hebrew/RTL/מספרים ופיסוק, A3 landscape, AutoTable רב־עמודים, repeated headers, `rowPageBreak`, page bounds, שלמות rows והגבלת output/API surface. אם נדרש שינוי runtime ב־`lib/interactionReportPdf.js`, עוצרים לפני השינוי ומחזירים analysis לאישור.

אם `@capacitor/assets` אינו מיובא ב־runtime או scripts פעילים, Run: `npm.cmd uninstall --save-dev @capacitor/assets`; assets שכבר tracked נשמרים. `exceljs@4.4.0` נשאר pinned אם ה־Moderate transitive advisory דורש downgrade לא בטוח; אין קריאת XLSX לא מהימן והסיכון מתועד.

- [ ] **Step 4: אמת audit ו־regression**

Run: `npm ci`

Run: `npm run test:baseline`

Run: `npm run test:security`

Run: `npm run build`

Run: `npm audit --json`

Expected: אפס Critical ואפס High. Moderate שנותר מפורט עם package/path/reachability; כשל ביעד עוצר G4.

אחרי קבוצת jsPDF בלבד, Expected: ה־Critical של jsPDF נעלם; 2 High של Next/PostCSS ו־2 Moderate של ExcelJS/UUID יכולים להישאר. זהו מצב ביניים בלבד ו־G4 נשאר `BLOCKED` עד הקבוצות המאושרות הבאות.

אחרי קבוצת Next בלבד, Expected: Next/PostCSS אינם מופיעים עוד כ־Critical/High; audit מלא ו־`--omit=dev` מציגים `0 Critical / 0 High / 2 Moderate`, כאשר רק ExcelJS/UUID נשארים לדיון נפרד ומחוץ לקומיט זה. הקומיט אינו משנה לבדו את סטטוס G4 ואינו מתחיל או מאשר את G5.

- [ ] **Step 5: Commit נפרד לכל קבוצה**

```powershell
git add -- package.json package-lock.json tests/security/dependency-policy.test.mjs tests/security/jspdf-compatibility.test.mjs docs/superpowers/specs/2026-08-27-security-hardening-design.md docs/superpowers/plans/2026-08-27-security-hardening.md
git commit -m "fix: upgrade jsPDF to patched major"
```

```powershell
git add -- package.json package-lock.json tests/security/dependency-policy.test.mjs tests/security/jspdf-compatibility.test.mjs docs/superpowers/specs/2026-08-27-security-hardening-design.md docs/superpowers/plans/2026-08-27-security-hardening.md
git commit -m "fix: upgrade Next to patched LTS"
```

---

### Task 19: G4 — Android and Capacitor Hardening

**Files:**
- Create: `android/app/src/main/res/xml/network_security_config.xml`
- Create: `tests/security/android-hardening.test.mjs`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/xml/file_paths.xml`
- Modify: `android/app/build.gradle`
- Modify: `android/app/proguard-rules.pro`
- Modify: `android/gradle.properties`

**Interfaces:**
- Produces: no backup, no cleartext, scoped FileProvider, fail-on-missing-release-keystore, minified release.

**Dependencies:** Task 18 removes build-time asset dependency; Android SDK/Gradle for full build.

**External blockers:** release keystore credentials and signed staging device test.

**Rollback point:** revert Android commit for local debug only; no release artifact is published.

- [ ] **Step 1: כתוב manifest/Gradle static tests**

בדוק `android:allowBackup="false"`, `usesCleartextTraffic="false"`, network config, absence of `<external-path path=".">`, release signing ללא debug fallback, `minifyEnabled true` ו־`shrinkResources true`.

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/android-hardening.test.mjs`

Expected: FAIL על כל ההגדרות החלשות הקיימות.

- [ ] **Step 3: הקשח manifest/provider/network**

FileProvider יחשוף רק `cache-path name="secure_exports" path="exports/"`; אין root/external wildcard. network config permits system trust anchors ב־HTTPS ואוסר cleartext. production activity מקבל secure-window flag למסכים רגישים דרך `MainActivity` אם WebView callback מאפשר זאת.

- [ ] **Step 4: הקשח release build**

Gradle זורק `GradleException` כאשר `key.properties` חסר ל־release. אין `signingConfig signingConfigs.debug`. enable minify/shrink ו־ProGuard rules נדרשים ל־Capacitor/push/Supabase serialization.

- [ ] **Step 5: אמת GREEN ו־Android build כאשר SDK זמין**

Run: `npm run test:security -- tests/security/android-hardening.test.mjs`

Run: `android\gradlew.bat -p android testDebugUnitTest assembleDebug`

Expected: static tests ו־debug build עוברים. Release build ללא keystore חייב להיכשל עם ההודעה המפורשת; signed release נבדק רק עם credentials מאושרים.

- [ ] **Step 6: Commit**

```powershell
git add -- android tests/security/android-hardening.test.mjs
git commit -m "fix: harden Android data and release boundaries"
```

---

### Task 20: G5 — Controlled Test-Environment Migration and Adversarial Suite

**Files:**
- Create: `scripts/security/provision-test-fixtures.mjs`
- Create: `tests/security/rls-live.test.mjs`
- Create: `tests/security/session-live.test.mjs`
- Create: `docs/security/STAGING_RUNBOOK.md`
- Modify: `scripts/security/verify-rls-live.mjs`
- Modify: `docs/security/SECURITY_TEST_MATRIX.md`

**Interfaces:**
- Consumes: isolated Supabase test project, migrations 0018–0024, local/staging BFF URL.
- Produces: two-project fixture IDs, role credentials in environment only, machine-readable pass/fail summary ללא PII.

**Dependencies:** G0–G4 complete.

**External blockers:** explicit approval, test project credentials, SQL migration access, optional staging deployment. Production target is rejected by hostname/project-ref guard.

**Rollback point:** delete only fixture users/rows tagged by random `security_run_id` in the test project; restore DB snapshot if migration verification fails; no Production mutation.

- [ ] **Step 1: כתוב environment refusal test**

```js
test('fixture provisioner refuses production project ref', () => {
  assert.throws(() => assertSafeTestTarget({ targetRef: productionRef, productionRef }), /REFUSED_PRODUCTION/);
});
```

Live test files remain skipped unless `SECURITY_TEST_CONFIRM_ISOLATED=true` and target ref differs from production.

- [ ] **Step 2: אמת RED locally**

Run: `npm run test:security -- tests/security/rls-live.test.mjs tests/security/session-live.test.mjs`

Expected: tests skip with explicit isolated-environment reason; refusal unit case passes.

- [ ] **Step 3: לאחר אישור בלבד, backup והרץ migrations על test project**

Runbook order: capture `pg_policies/grants/functions` snapshot → DB backup → `0018` + foundation assertions → `0019` + helper/RLS matrix → `0020` + RPC dependency/grant checks → `0021` + reminder cancel direct-JWT matrix → `0022` + tour report direct-JWT matrix → `0023` + endpoint/notification authority checks → `0024` + finance parity/output/audit checks. כל failure עוצר לפני הקובץ הבא; אין retry עיוור ל־0021/0022.

- [ ] **Step 4: provision synthetic actors/resources**

צור CEO AAL2, head A/head B, coord A, activist A1/A2/B1, finance A, disabled user; projects A/B; contacts/interactions/tours/reminders לכל tenant. passwords נוצרים אקראית, נשמרים process memory/env זמני בלבד ונמחקים בסוף.

- [ ] **Step 5: הרץ 25 דרישות חובה והרחבות attacker mindset**

Run: `node scripts/security/verify-rls-live.mjs`

Run: `npm run test:security -- tests/security/rls-live.test.mjs tests/security/session-live.test.mjs`

Run against approved local/staging BFF: `node scripts/security/verify-http.mjs`

Expected: anonymous PII/mutation denied; all cross-user/project/URL/ID/body/insert/update/delete denied; coordinator/head/CEO exact; expired/logout/escalation denied; mass assignment/malformed/XSS/rate/headers/audit/bundle checks pass. כל SEC-001..SEC-025 מקבל evidence row.

- [ ] **Step 6: cleanup and re-run anonymous probe**

cleanup query מוגבלת ל־`security_run_id` המדויק ומוודאת count לפני delete. לאחר cleanup, `scripts/probe-rls.mjs` ו־security posture חייבים להישאר ירוקים.

- [ ] **Step 7: Commit code/runbook בלבד**

```powershell
git add -- scripts/security/provision-test-fixtures.mjs scripts/security/verify-rls-live.mjs tests/security/rls-live.test.mjs tests/security/session-live.test.mjs docs/security/STAGING_RUNBOOK.md docs/security/SECURITY_TEST_MATRIX.md
git commit -m "test: add live adversarial security verification"
```

אין commit של credentials, fixture output או DB dump.

---

### Task 21: G6 — Final Regression, Evidence Report and Verdict

**Files:**
- Create: `SECURITY_HARDENING_REPORT.md`
- Create: `tests/security/report-completeness.test.mjs`
- Modify: `docs/security/SECURITY_TEST_MATRIX.md`

**Interfaces:**
- Consumes: outputs של כל gates.
- Produces: report מלא ו־verdict יחיד: `READY FOR SECURITY REVIEW` או `NOT READY FOR REAL SENSITIVE DATA`.

**Dependencies:** Tasks 1–20.

**External blockers:** כל G5 test שלא הורץ, rotation שלא בוצעה, MFA/config שלא אומתו, Critical/High dependency או migration שלא הופעלה בסביבה הנבחנת מחייבים verdict של not ready.

**Rollback point:** report commit אינו משנה runtime. branch נעצר ללא merge/deploy.

- [ ] **Step 1: כתוב report completeness test לפני report**

```js
import { escapeRegex } from './helpers.mjs';

const headings = [
  'Executive Summary','Findings','Changes','Authentication & Authorization Model',
  'Database / RLS Matrix','Test Evidence','Negative Security Tests','Dependency Audit',
  'Secrets','Remaining Risks','External Blockers','Rollback','Final Verdict'
];
for (const heading of headings) assert.match(report, new RegExp(`^## ${escapeRegex(heading)}$`, 'm'));
assert.equal((report.match(/READY FOR SECURITY REVIEW|NOT READY FOR REAL SENSITIVE DATA/g) ?? []).length, 1);
assert.doesNotMatch(report, /password\s*[:=]|Bearer\s+[A-Za-z0-9._-]+|SUPABASE_SECRET_KEY\s*=/i);
```

- [ ] **Step 2: אמת RED**

Run: `npm run test:security -- tests/security/report-completeness.test.mjs`

Expected: FAIL משום שה־report אינו קיים.

- [ ] **Step 3: הרץ regression מלא ואסוף רק evidence מצונזר**

Run: `npm ci`

Run: `npm run test:baseline`

Run: `npm run test:security`

Run: `npm run verify:interaction-report`

Run: `node scripts/verify-month-report.cjs 2026 7` נגד סביבת test/approved read-only source, עם שמות מצונזרים.

Run: `node scripts/verify-payroll-xlsx.cjs 2026 7`, output ל־Temp בלבד ופלט שמות מצונזר.

Run: `npm run build`

Run: `node scripts/security/scan-secrets.mjs --current --tracked --history`

Run: `node scripts/security/scan-client-bundle.mjs`

Run: `npm audit --json`

Run: `node scripts/security/verify-rls-live.mjs` ו־`verify-http.mjs` רק בסביבה המאושרת.

- [ ] **Step 4: כתוב report עם matrices ו־counts מדויקים**

לכל finding: severity, affected asset, exploit path, remediation, evidence ו־residual risk. מטריצת DB כוללת כל table/object מ־`app_security_posture()` עם RLS ו־CRUD. Negative tests מציינים actor/resource/layer/status ללא PII. Secrets מציינים type/location/rotation בלבד. Changes כוללים commits, files ו־migrations.

- [ ] **Step 5: קבע verdict ללא ניסוח ביניים**

`READY FOR SECURITY REVIEW` מותר רק אם G0–G6 ירוקים, RLS live עבר, MFA AAL2 אומת, current/client secret scans נקיים, build/regression עברו ואפס Critical/High. אחרת נכתב `NOT READY FOR REAL SENSITIVE DATA` עם blockers מדויקים.

- [ ] **Step 6: אמת report ו־Git state**

Run: `npm run test:security -- tests/security/report-completeness.test.mjs`

Run: `git diff --check`

Run: `git status --short --branch`

Expected: report test PASS; רק קבצי המשימה staged; branch הוא `security/hardening-p0`; אין merge/deployment evidence.

- [ ] **Step 7: Commit ועצירה**

```powershell
git add -- SECURITY_HARDENING_REPORT.md docs/security/SECURITY_TEST_MATRIX.md tests/security/report-completeness.test.mjs
git commit -m "docs: record security hardening evidence"
```

בסיום מדווחים: branch, commit, total tests, security tests, `npm audit`, מספר טבלאות RLS, Critical/High שנותרו, blockers ו־verdict. עוצרים וממתינים לאישור; אין merge ואין Production deployment.

---

## Coverage Index מול ה־Design המאושר

| Design requirement | Tasks |
| --- | --- |
| BFF trust boundary, validation, errors | 4, 7, 15 |
| Supabase Auth, opaque session, logout, fixation, revoke | 5–6, 20 |
| MFA AAL2 | 6–7, 20 |
| RBAC CEO/Head/Coord/Activist/Finance | 7–13, 20 |
| Multi-tenant + IDOR/BOLA + body tampering | 3, 8–13, 20 |
| RLS all sensitive tables/views and grants | 2–3, 20 |
| PII inventory, field projection, no browser fallback | 8, 13, 15 |
| CSRF, CORS, rate limits | 4–5, 16, 20 |
| Security headers/CSP/cache | 16, 20 |
| Audit trail and protected audit log | 2, 5, 7, 20 |
| Secrets/repository/history/bundle | 15, 17, 21 |
| Dependency audit and controlled upgrades | 18, 21 |
| Anthropic/Sheets/GitHub/Push boundaries | 12, 14 |
| Android hardening | 19 |
| 25 mandatory tests + adversarial/regression | 1, 8–20 |
| Rollback, blockers, final evidence/verdict | every task, 20–21 |

## Review Gates and Stop Conditions

- כל RED test חייב להיכשל בגלל behavior חסר, לא syntax/config מקרי.
- כל GREEN task עובר גם tests קשורים קודמים; regression מבודד אינו מספיק.
- migration assertion, RLS inventory, MFA AAL2, secret scan או Critical/High dependency שנכשלו עוצרים את ה־Gate.
- שינוי שמחייב browser JWT, service-role business CRUD, permissive policy, public sheet, PII push או CORS wildcard הוא סטייה מה־Design ואסור לביצוע ללא מסמך שינוי ואישור.
- external blocker משבית את היכולת fail-closed; הוא אינו נפתר בערך דמה או fallback.
- commits נשארים ב־`security/hardening-p0`; אין merge, push כפוי, history rewrite או deployment ללא הוראה מפורשת.
