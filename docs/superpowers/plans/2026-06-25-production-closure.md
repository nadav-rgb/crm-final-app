# CRM מקרבים — תכנית יישום: סגירה לפרודקשן + Capacitor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להביא את ה-CRM למצב production-ready (אבטחה, יציבות, ניקוי דמו) ולספק מעטפת Capacitor OTA לאנדרואיד.

**Architecture:** Next.js 14 Pages Router + Supabase. RLS מופעל על כל הטבלאות; ה-API routes הכותבים משתמשים ב-service-role דרך `requireWriteRole`. התראות עוברות מ-localStorage לטבלת Supabase. מעטפת Capacitor טוענת את האתר החי (`server.url`).

**Tech Stack:** Next.js 14, @supabase/supabase-js, web-push, @capacitor/core+android, node+pg (להרצת מיגרציות).

**אימות:** לפרויקט אין מסגרת בדיקות אוטומטית. אימות = (א) סקריפטי probe ב-node מול Supabase, (ב) `npm run build`, (ג) E2E ידני על המכשיר/דפדפן. כל task כולל צעד אימות קונקרטי.

**ספריית מיגרציות:** `migrations/` (חדשה). הרצה דרך `scripts/run-sql.mjs` (נוצר ב-Task 1) שמשתמש ב-`pg` מול connection string.

**דרישה מקדימה חוסמת:** מחרוזת חיבור ישירה ל-Postgres (Supabase → Settings → Database → Connection string, מצב "Session"/URI). תישמר ב-`.env.local` כ-`DEV_DB_URL`. ללא זה — הרצת המיגרציות ידנית ב-SQL Editor.

---

## שלב 1 — אבטחה (חוסם פרודקשן)

### Task 1: תשתית הרצת מיגרציות SQL

**Files:**
- Create: `scripts/run-sql.mjs`
- Modify: `.env.local` (הוספת `DEV_DB_URL`)
- Modify: `package.json` (תלות `pg`)

- [ ] **Step 1: התקנת pg**

Run: `npm i pg`

- [ ] **Step 2: כתיבת הרץ המיגרציות**

Create `scripts/run-sql.mjs`:

```js
// scripts/run-sql.mjs — מריץ קובץ SQL בודד מול Postgres של Supabase.
// שימוש: node scripts/run-sql.mjs migrations/0001_rls.sql
import fs from 'fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/run-sql.mjs <file.sql>'); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const conn = env.DEV_DB_URL;
if (!conn) { console.error('Missing DEV_DB_URL in .env.local'); process.exit(1); }

const sql = fs.readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log(`OK — applied ${file}`);
} catch (e) {
  console.error(`FAILED ${file}:`, e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
```

- [ ] **Step 3: הוספת DEV_DB_URL ל-.env.local**

הוסף שורה ל-`.env.local` (ערך מ-Supabase → Settings → Database):
`DEV_DB_URL=postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:5432/postgres`
(אם אין — דלג והרץ SQL ידנית ב-SQL Editor.)

- [ ] **Step 4: אימות חיבור**

Create `scripts/probe-rls.mjs` (probe אנונימי לשימוש חוזר):

```js
// scripts/probe-rls.mjs — קורא טבלאות עם anon key ללא התחברות. כל שורה שחוזרת = דליפה.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth:{persistSession:false}});
const tables = ['contacts','interactions','meeting_houses','meeting_reports','profiles','push_subscriptions','meeting_reminders','activist_directory'];
let leak = false;
for (const t of tables){
  const { data, error } = await sb.from(t).select('*').limit(3);
  if (error) console.log(`${t.padEnd(22)} blocked/err: ${error.code||''}`);
  else { if (data.length) leak = true; console.log(`${t.padEnd(22)} returned ${data.length} ${data.length?'<-- LEAK':''}`); }
}
process.exit(leak ? 1 : 0);
```

Run: `node scripts/probe-rls.mjs`
Expected (לפני התיקון): `contacts` ו-`interactions` מציגים `<-- LEAK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-sql.mjs scripts/probe-rls.mjs package.json package-lock.json
git commit -m "chore: SQL migration runner + anon RLS probe"
```

---

### Task 2: הפעלת RLS + policies על כל הטבלאות

**Files:**
- Create: `migrations/0001_rls.sql`

הרציונל: כל גישת קריאה/כתיבה מה-client צריכה משתמש מחובר. ה-API routes משתמשים ב-service-role שעוקף RLS, כך שהפעלת RLS לא שוברת אותם. ה-client קורא `contacts`/`interactions`/`meeting_reports`/`activist_directory` ישירות עם ה-JWT של המשתמש — לכן policy `SELECT` ל-`authenticated`.

- [ ] **Step 1: כתיבת המיגרציה**

Create `migrations/0001_rls.sql`:

```sql
-- 0001_rls.sql — הפעלת RLS וחסימת גישה אנונימית על כל טבלאות הנתונים.
-- מודל: כל משתמש מחובר (authenticated) רשאי לקרוא; כתיבה ישירה נחסמת
-- (כתיבות עוברות דרך API routes עם service-role שעוקף RLS).

-- פונקציית עזר: idempotent enable
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','interactions','meeting_reports','meeting_houses',
    'profiles','push_subscriptions','meeting_reminders'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- contacts
drop policy if exists "auth read contacts" on public.contacts;
create policy "auth read contacts" on public.contacts
  for select to authenticated using (true);

-- interactions
drop policy if exists "auth read interactions" on public.interactions;
create policy "auth read interactions" on public.interactions
  for select to authenticated using (true);

-- meeting_reports
drop policy if exists "auth read meeting_reports" on public.meeting_reports;
create policy "auth read meeting_reports" on public.meeting_reports
  for select to authenticated using (true);

-- meeting_houses
drop policy if exists "auth read meeting_houses" on public.meeting_houses;
create policy "auth read meeting_houses" on public.meeting_houses
  for select to authenticated using (true);

-- profiles — משתמש קורא רק את עצמו
drop policy if exists "self read profile" on public.profiles;
create policy "self read profile" on public.profiles
  for select to authenticated using (id = auth.uid());

-- push_subscriptions — נכתב/נקרא רק דרך service-role; אין policy ל-authenticated → חסום
-- meeting_reminders — service-role בלבד → אין policy → חסום
```

הערה: אם ה-client קורא ישירות מטבלאות נוספות (לאמת בעת ביצוע ע"י grep `.from('` ב-`lib/` ו-`pages/`), הוסף להן policy `for select to authenticated using (true)`. טבלה ללא שום policy + RLS פעיל = חסומה לכולם חוץ מ-service-role.

- [ ] **Step 2: אימות שאין טבלאות client נוספות שנשברות**

Run: `grep -rno "\.from('[a-z_]*'" lib pages | sort -u`
Expected: רשימת כל הטבלאות שה-client ניגש אליהן. כל טבלה שמופיעה ב-`lib/CrmStore.jsx` או בקריאה ישירה מ-client (לא מ-`pages/api/`) חייבת policy `SELECT` במיגרציה. עדכן את המיגרציה אם חסר.

- [ ] **Step 3: הרצת המיגרציה**

Run: `node scripts/run-sql.mjs migrations/0001_rls.sql`
Expected: `OK — applied migrations/0001_rls.sql`
(ללא `DEV_DB_URL`: הדבק את תוכן הקובץ ב-Supabase SQL Editor והרץ.)

- [ ] **Step 4: אימות אמפירי שהדליפה נסגרה**

Run: `node scripts/probe-rls.mjs`
Expected: אף טבלה לא מציגה `LEAK`. exit code 0.

- [ ] **Step 5: אימות שהאפליקציה עדיין עובדת למשתמש מחובר**

Run: `npm run build` → Expected: עובר.
ידנית: התחבר כ-`coord1`/`ceo`, ודא שעמודי לקוחות/בתי מפגש/תשלומים עדיין טוענים נתונים (ה-JWT מאפשר את ה-SELECT policies).

- [ ] **Step 6: Commit**

```bash
git add migrations/0001_rls.sql
git commit -m "feat(security): enable RLS + authenticated-read policies, close anon PII leak"
```

---

### Task 3: הקשחת API routes ללא auth

**Files:**
- Modify: `pages/api/reminders/schedule.js`
- Modify: `pages/api/reminders/cancel.js`
- Modify: `pages/api/push/subscribe.js`
- Modify: `pages/api/ai-summary.js`

הדפוס הקיים: `import { requireWriteRole } from '../meeting-houses/_auth';` ואז בדיקה. ה-client חייב לשלוח `Authorization: Bearer <jwt>`. נוסיף גם הזרקת ה-header בצד הלקוח אם חסר (לאמת בעת ביצוע ב-`lib/pushClient.js` ו-`lib/reminderTrigger.js`).

- [ ] **Step 1: הקשחת reminders/schedule.js**

הוסף בראש ה-handler (אחרי בדיקת method), עם import:

```js
import { requireWriteRole } from '../meeting-houses/_auth';
// ...
  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
```

- [ ] **Step 2: הקשחת reminders/cancel.js**

זהה ל-Step 1 — אותו import ואותן 2 שורות בראש ה-handler.

- [ ] **Step 3: הקשחת push/subscribe.js**

פעיל רושם את עצמו — נדרש משתמש מחובר, אך לא בהכרח write-role. נאמת JWT בלבד ונוודא שה-`activistId` תואם לפרופיל המבקש:

```js
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
// בתוך handler, אחרי בדיקת method:
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  const admin = getSupabaseAdmin();
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !userData?.user) return res.status(401).json({ error: 'Invalid token' });
  const { data: profile } = await admin.from('profiles')
    .select('activist_code').eq('id', userData.user.id).single();
  if (!profile || String(profile.activist_code) !== String(req.body.activistId)) {
    return res.status(403).json({ error: 'activistId mismatch' });
  }
```
(לאמת בעת ביצוע ששדה הקישור הוא `activist_code` — אם שונה, התאם.)

- [ ] **Step 4: הקשחת ai-summary.js**

הוסף בראש ה-handler אימות משתמש מחובר (הגנה על קרדיט Anthropic). אותו דפוס JWT כמו Step 3 (ללא בדיקת activistId — מספיק שמחובר):

```js
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  const { data: u, error: e } = await getSupabaseAdmin().auth.getUser(token);
  if (e || !u?.user) return res.status(401).json({ error: 'Invalid token' });
```

- [ ] **Step 5: עדכון הקוראים בצד-לקוח לשלוח Bearer**

לאמת ולתקן את הקריאות ל-4 ה-routes כך שיכללו `Authorization`. הדפוס הקיים: `...(await authHeader())` ב-`meetingHousesSupabase.js`. אתר את `authHeader`/דרך השגת ה-JWT (`supabase.auth.getSession()`), והוסף לכל fetch אל `/api/reminders/*`, `/api/push/subscribe`, `/api/ai-summary`.

Run: `grep -rn "api/reminders\|api/push/subscribe\|api/ai-summary" lib pages | grep fetch`
לכל תוצאה — ודא שה-headers כוללים Authorization.

- [ ] **Step 6: אימות**

Run: `npm run build` → Expected: עובר.
ידנית/curl: קריאה ל-`/api/ai-summary` ללא Bearer → 401. עם משתמש מחובר באפליקציה: סיכום AI עדיין עובד; שיבוץ→תזכורת עדיין נקבעת.

- [ ] **Step 7: Commit**

```bash
git add pages/api/reminders pages/api/push/subscribe.js pages/api/ai-summary.js lib
git commit -m "feat(security): require auth on reminders, push/subscribe, ai-summary routes"
```

---

### Task 4: חיזוק CRON_SECRET

**Files:**
- Modify: `.env.local`, Vercel env (ידני)

- [ ] **Step 1: יצירת secret חזק**

Run: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

- [ ] **Step 2: עדכון**

עדכן `CRON_SECRET` ב-`.env.local` ובפאנל Vercel (Settings → Environment Variables) לערך החדש. ודא שה-cron job/הקורא משתמש באותו ערך.

- [ ] **Step 3: אימות**

Run: `npm run build`. אחרי deploy — ודא שה-cron עדיין רץ (לוג Vercel) או קריאה ידנית עם ה-secret החדש מחזירה 200.

---

## שלב 2 — יציבות וקוד דמו

### Task 5: קומיט ה-WIP הקיים

**Files:**
- Existing changes: `components/MobileBottomNav.jsx`, `lib/CrmStore.jsx`, `lib/meetingHousesSupabase.js`, `pages/meeting-houses/[id].jsx`, `pages/meeting-houses/index.jsx`, `pages/api/push/send.js`

- [ ] **Step 1: סקירת השינויים**

Run: `git diff --stat && git status -s`
Expected: כפתור יציאה (נייד), push-בשיבוץ, ניקוי הוספת לקוח, `push/send.js` חדש.

- [ ] **Step 2: build**

Run: `npm run build` → Expected: עובר.

- [ ] **Step 3: Commit**

```bash
git add components/MobileBottomNav.jsx lib/CrmStore.jsx lib/meetingHousesSupabase.js pages/meeting-houses/ pages/api/push/send.js
git commit -m "feat: mobile logout button + real push on activist assignment + contact-insert cleanup"
```

---

### Task 6: תיקון completed.jsx לקרוא מ-Supabase

**Files:**
- Modify: `pages/meeting-houses/completed.jsx`

הבעיה: שורה ~29 קוראת `getMeetingHouses()` (localStorage בלבד). שאר דפי בתי המפגש משתמשים ב-`fetchMeetingHousesFromSupabase()` עם fallback. נשכפל את אותו דפוס merge.

- [ ] **Step 1: קריאת הדפוס הקיים**

Read `pages/meeting-houses/index.jsx` שורות ~30-40 (לוגיקת `loadHouses` עם `fetchMeetingHousesFromSupabase` + fallback ל-`getMeetingHouses`).

- [ ] **Step 2: החלת אותו דפוס ב-completed.jsx**

החלף את הטעינה ב-`completed.jsx` כך שתביא מ-Supabase תחילה (`fetchMeetingHousesFromSupabase()`), עם fallback ל-`getMeetingHouses()`, ואז סנן ל-`deriveHouseStatus(h) === 'completed'`. שמור על אותו useEffect/state כמו ב-index.jsx.

- [ ] **Step 3: אימות**

Run: `npm run build` → Expected: עובר.
ידנית: בית מפגש שהושלם ב-Supabase (מפגש רביעי + 7 ימים) מופיע בעמוד "הסתיימו".

- [ ] **Step 4: Commit**

```bash
git add pages/meeting-houses/completed.jsx
git commit -m "fix: completed meeting-houses page reads from Supabase, not only localStorage"
```

---

### Task 7: הסרת console.log אבחון

**Files:**
- Modify: `lib/paymentCalc.js` (שורות `[CALC-DIAG]`)
- Modify: `pages/payments.jsx` (שורות `[PAY-DIAG]`)

- [ ] **Step 1: איתור**

Run: `grep -rn "CALC-DIAG\|PAY-DIAG" lib pages`

- [ ] **Step 2: הסרה**

מחק את כל שורות ה-`console.log` עם `[CALC-DIAG]`/`[PAY-DIAG]` ואת משתני ה-`step1/step2/step3` ב-`calcMonthlyPayment` שמשמשים רק ללוג (ה-`monthlyInteractions` האמיתי מחושב בנפרד מהם — ודא שלא נשבר).

- [ ] **Step 3: אימות**

Run: `grep -rn "DIAG" lib pages` → Expected: ריק.
Run: `npm run build` → Expected: עובר.

- [ ] **Step 4: Commit**

```bash
git add lib/paymentCalc.js pages/payments.jsx
git commit -m "chore: remove payment diagnostic console.logs"
```

---

### Task 8: B1 — הבהרת כללי-תשלום ותיקון

> **חסם:** הקוד הנוכחי מגדיר `PER_CONTACT_CAPS.regular = { frontal: 2, phone: 4 }`, ולכן המפגש הפרונטלי ה-3 עם לקוח רגיל מוחזר "חרגת ממגבלת מפגשים עם לקוח זה" = ללא תשלום. הבודקים ציפו שישולם + בונוס. בנוסף, "מפגש שבועי" אינו סוג קיים. **זו אי-התאמה בכללי-העסק, לא תקלת קוד.** נדרשת הבהרה רשמית מהארגון לפני שינוי.

**Files:**
- Modify: `lib/paymentCalc.js` (אחרי הבהרת הכללים)

- [ ] **Step 1: השג את מסמך כללי-התשלום הרשמי**

הצג למשתמש את הכללים שהקוד מיישם כיום (מ-`BASE_PRICES`, `MONTHLY_CAPS`, `PER_CONTACT_CAPS`, `LEARNING_BONUS`) ובקש אישור/תיקון: מהי מגבלת המפגשים ללקוח? האם יש תשלום על מפגש שבועי? מהו בונוס "אחרי 3 מפגשים"?

- [ ] **Step 2: שחזור הבאג מול נתוני אמת**

השתמש ב-superpowers:systematic-debugging. כתוב `scripts/debug-payment.mjs` שטוען interactions אמיתיים של פעיל בודק מ-Supabase ומריץ את `calcMonthlyPayment`, ומדפיס את ה-`reason` לכל interaction. אתר אילו מפגשים מוחזרים `payable:false` ולמה.

- [ ] **Step 3: תיקון לפי הכללים המאושרים**

עדכן את הקבועים/הלוגיקה ב-`paymentCalc.js` כדי שיתאימו לכללים המאושרים מ-Step 1. אם נדרש סוג "מפגש שבועי" או בונוס-3-מפגשים — הוסף בהתאם להגדרה.

- [ ] **Step 4: אימות**

הרץ שוב את `scripts/debug-payment.mjs` — המפגשים שאמורים להיות מזכים מחזירים `payable:true` עם הסכום הנכון.
Run: `npm run build` → Expected: עובר.
ידנית: עמוד תשלומים לפעיל הבודק מציג את הסכומים הצפויים.

- [ ] **Step 5: Commit**

```bash
git add lib/paymentCalc.js scripts/debug-payment.mjs
git commit -m "fix(payments): align interaction payment rules with org spec (B1)"
```

---

### Task 9: B2 — סימון משימה/תזכורת כ"בוצע"

**Files:**
- לאמת בעת ביצוע: היכן "איחור"/תזכורות מוצגות — `pages/reminders.jsx` ו/או `pages/today.jsx`, `lib/getReminders.js`.

- [ ] **Step 1: איתור התצוגה**

Run: `grep -rln "איחור\|overdue\|תזכור" pages lib`
זהה את הקומפוננטה שמציגה פריט כ"איחור" ואת מקור הנתון (Supabase `meeting_reminders` או נגזר).

- [ ] **Step 2: הוספת פעולת "סמן כבוצע"**

הוסף כפתור "בוצע ✓" לכל פריט באיחור. הפעולה מעדכנת את המקור: אם זו תזכורת מ-`meeting_reminders`, קריאה ל-`/api/reminders/cancel` (שכבר מסמן `sent:true`) או endpoint דומה; אם זו משימה נגזרת (דיווח חסר), עדכון השדה המתאים ב-Supabase. עדכון optimistic של ה-UI.

- [ ] **Step 3: אימות**

Run: `npm run build` → Expected: עובר.
ידנית: פריט באיחור → לחיצה "בוצע" → נעלם מרשימת האיחורים ולא חוזר אחרי reload.

- [ ] **Step 4: Commit**

```bash
git add pages lib
git commit -m "feat: mark overdue task/reminder as done (B2)"
```

---

### Task 10: F1 — עריכת ומחיקת לקוח

**Files:**
- Modify: `lib/CrmStore.jsx` (הוספת `updateContact`, `deleteContact`)
- Modify: `pages/contact/[id].jsx` (כפתורי עריכה/מחיקה)
- אופציונלי: עמוד/מודאל עריכה בדומה ל-`pages/contacts/add.jsx`

מחיקה = soft-delete (לא DELETE פיזי) כדי למנוע אובדן נתונים. נבדוק אם קיימת עמודת `is_active`/`deleted_at` ב-`contacts`; אם לא — נוסיף מיגרציה.

- [ ] **Step 1: בדיקת סכמה**

Run: `node -e "import('@supabase/supabase-js')"` — או בדוק עמודות `contacts` ב-`toContactRow` ב-`CrmStore.jsx`. אם אין `is_active` — צור `migrations/0002_contacts_soft_delete.sql`:

```sql
alter table public.contacts add column if not exists is_active boolean not null default true;
```
Run: `node scripts/run-sql.mjs migrations/0002_contacts_soft_delete.sql`

- [ ] **Step 2: פונקציות store**

ב-`lib/CrmStore.jsx` הוסף `updateContact(id, fields)` (קיים כבר `updateContactFieldsInSupabase` — עטוף אותו לעדכון state + DB) ו-`deleteContact(id)` שמעדכן `is_active=false` ב-Supabase ומסיר מה-state. ודא שטעינת הלקוחות מסננת `is_active !== false`.

- [ ] **Step 3: UI**

ב-`pages/contact/[id].jsx` הוסף כפתור "עריכה" (פותח טופס עם ערכים קיימים, שומר דרך `updateContact`) וכפתור "מחיקה" (אישור → `deleteContact`). הגבל מחיקה לפי הרשאה (`can.*` המתאים — לאמת ב-`AuthStore`).

- [ ] **Step 4: אימות**

Run: `node scripts/probe-rls.mjs` (ודא שלא נפתחה דליפה חדשה).
Run: `npm run build` → Expected: עובר.
ידנית: עריכת שם/טלפון נשמרת אחרי reload; מחיקה מסירה את הלקוח מהרשימה ואינו חוזר.

- [ ] **Step 5: Commit**

```bash
git add lib/CrmStore.jsx pages/contact/[id].jsx migrations/0002_contacts_soft_delete.sql
git commit -m "feat: edit + soft-delete existing contacts (F1)"
```

---

### Task 11: התראות → Supabase (החלפת notificationDemo)

**Files:**
- Create: `migrations/0003_notifications.sql`
- Create: `lib/notifications.js`
- Modify: קוראים — `components/DesktopLayout.jsx`, `pages/landing.jsx`, `pages/notifications.jsx`
- Modify: יצרנים — `pages/base-meetings.jsx`, `pages/contact/add-interaction/[id].jsx`, `pages/meeting-houses/index.jsx`, `pages/meeting-houses/[id].jsx`, `lib/reminderSchedulerDemo.js`
- Delete: `lib/chatDemo.js` (dead code)

- [ ] **Step 1: טבלת notifications**

Create `migrations/0003_notifications.sql`:

```sql
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id text not null,        -- activist_code / user identifier
  type text not null,
  title text not null,
  body text,
  url text,
  priority text default 'normal',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
drop policy if exists "auth read own notifications" on public.notifications;
create policy "auth read own notifications" on public.notifications
  for select to authenticated using (true);
```
Run: `node scripts/run-sql.mjs migrations/0003_notifications.sql`
(כתיבה תיעשה דרך service-role ב-route, או policy insert ל-authenticated — לאמת לפי איך היצרנים רצים. אם היצרנים רצים בצד-לקוח, הוסף policy `for insert to authenticated with check (true)`.)

- [ ] **Step 2: שכבת lib/notifications.js**

Create `lib/notifications.js` עם אותו ממשק שמשמש היום מ-`notificationDemo.js` (לאמת את החתימות: `createDemoNotification`, `getNotificationsForUser`, `getNotificationTypeLabel`, `createBaseMeetingSubmittedNotifications`, `createPaymentInteractionNotifications`), אך CRUD מול Supabase במקום localStorage. שמור שמות פונקציות זהים כדי למזער שינויי קוראים.

```js
// lib/notifications.js — התראות מגובות Supabase (מחליף notificationDemo.js)
import { getSupabaseClient } from './supabaseClient';

export async function createNotification({ recipientId, type, title, body, url, priority='normal' }) {
  const sb = getSupabaseClient();
  const { error } = await sb.from('notifications').insert({
    recipient_id: String(recipientId), type, title, body, url, priority,
  });
  if (error) console.error('createNotification failed', error);
}

export async function getNotificationsForUser(recipientId) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('notifications')
    .select('*').eq('recipient_id', String(recipientId)).order('created_at',{ascending:false}).limit(100);
  if (error) { console.error('getNotifications failed', error); return []; }
  return data || [];
}

export async function markNotificationRead(id) {
  const sb = getSupabaseClient();
  await sb.from('notifications').update({ read: true }).eq('id', id);
}

// שמור על מיפוי הסוגים הקיים מ-notificationDemo.js:
export { getNotificationTypeLabel } from './notificationDemo';
```
(ה-`getNotificationTypeLabel` הוא מיפוי טקסט טהור — מותר לייבא מ-notificationDemo או להעתיק. שאר הפונקציות הספציפיות כמו `createBaseMeetingSubmittedNotifications` — עטוף סביב `createNotification`.)

- [ ] **Step 3: עדכון הקוראים**

החלף את ה-imports בכל הקוראים מ-`notificationDemo` ל-`lib/notifications`. הפוך את הקריאות ל-async (`await`/`useEffect`). הקוראים שמציגים רשימה (`DesktopLayout`, `landing`, `notifications.jsx`) — טען דרך `getNotificationsForUser` ב-`useEffect` עם state.

Run: `grep -rln "notificationDemo" pages components lib`
עדכן כל קובץ ברשימה (חוץ מ-`notificationDemo.js` עצמו, שאפשר להשאיר רק כמקור `getNotificationTypeLabel`, או למחוק אם הכל הועבר).

- [ ] **Step 4: מחיקת chatDemo**

Run: `grep -rln "chatDemo" pages components lib`
Expected: רק `pages/chat.jsx`. החלף את `INITIAL_CHAT_MESSAGES` במערך ריק מקומי ב-`chat.jsx` ומחק את `lib/chatDemo.js`.

- [ ] **Step 5: אימות**

Run: `node scripts/probe-rls.mjs` → אין דליפה.
Run: `npm run build` → Expected: עובר.
ידנית: שבץ פעיל לבית מפגש במכשיר א' → ההתראה מופיעה במכשיר ב' אחרי כניסה (נשמרת בענן, לא localStorage).

- [ ] **Step 6: Commit**

```bash
git add migrations/0003_notifications.sql lib/notifications.js pages components
git rm lib/chatDemo.js
git commit -m "feat: persist notifications to Supabase (cross-device), remove chatDemo dead code"
```

---

## שלב 3 — מעטפת Capacitor OTA

### Task 12: הגדרת Capacitor + בניית APK

**Files:**
- Create: `capacitor.config.json`
- Create: `android/` (נוצר ע"י cap)
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: התקנה**

Run: `npm i @capacitor/core && npm i -D @capacitor/cli && npx cap init "מקרבים" "com.achdutyehudit.crm" --web-dir=public`
(web-dir אינו בשימוש אמיתי כי טוענים server.url, אך cap דורש ערך.)

- [ ] **Step 2: config עם server.url**

Create/ערוך `capacitor.config.json`:

```json
{
  "appId": "com.achdutyehudit.crm",
  "appName": "מקרבים",
  "webDir": "public",
  "server": {
    "url": "https://crm-final-app.vercel.app/",
    "cleartext": false
  }
}
```

- [ ] **Step 3: הוספת אנדרואיד**

Run: `npm i @capacitor/android && npx cap add android`

- [ ] **Step 4: gitignore**

הוסף ל-`.gitignore`: `android/` (כמו בפרויקטים האחרים) ותעד את פקודות השחזור בקובץ `CAPACITOR.md` קצר, או commit מלא של `android/` — לפי הדפוס בפרויקט insurance-leads/family.

- [ ] **Step 5: בניית APK**

Run (עם JBR של Android Studio בנתיב, כמו בפרויקטים האחרים):
`cd android && ./gradlew assembleDebug`
Expected: `android/app/build/outputs/apk/debug/app-debug.apk` נוצר.

- [ ] **Step 6: אימות על המכשיר**

התקן ידנית למכשיר המשתמש בלבד (אין הפצה אוטומטית): `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
ודא: האפליקציה נטענת ומציגה את האתר החי; התחברות עובדת; **בדוק B3 — הקלדה במיקרופון (הרשאה נייטיב)**.

- [ ] **Step 7: Commit**

```bash
git add capacitor.config.json package.json package-lock.json .gitignore CAPACITOR.md
git commit -m "feat: Capacitor OTA Android shell loading live Vercel site"
```

---

## שלב 4 — QA + UX

### Task 13: U1 — קוביות סטטיסטיקה לחיצות

**Files:**
- Modify: `pages/landing.jsx` (קוביות מרכז הפעילות + אזור אישי)

- [ ] **Step 1: איתור הקוביות**

Run: `grep -n "סהכ לקוחות\|סה\"כ\|קשרים" pages/landing.jsx`
זהה את אלמנטי הקוביות.

- [ ] **Step 2: הפיכה לקישורים**

עטוף כל קוביה ב-`<Link href=...>` ליעד המתאים: "סהכ לקוחות" → `/contacts`, "קשרים" → רלוונטי, וכו'. שמור על העיצוב (cursor:pointer, hover קל).

- [ ] **Step 3: אימות**

Run: `npm run build` → Expected: עובר.
ידנית: לחיצה על כל קוביה מנווטת לעמוד הנכון.

- [ ] **Step 4: Commit**

```bash
git add pages/landing.jsx
git commit -m "feat(ux): stat tiles navigate to relevant pages (U1)"
```

---

### Task 14: U2 — גילוי עדכון מצוות

**Files:**
- Modify: `pages/contact/[id].jsx` (הבלטת כניסה ל-`update-mitzvot`)

- [ ] **Step 1: בדיקת הכניסה הקיימת**

Read `pages/contact/[id].jsx` — אתר את הקישור ל-`update-mitzvot/[id]`. ודא שהוא קיים אך לא בולט.

- [ ] **Step 2: הבלטה**

הפוך את הכניסה ל"עדכון התקדמות רוחנית" לכפתור ברור ומובחן בכרטיס הלקוח (כותרת + אייקון), לא קישור טקסט נסתר.

- [ ] **Step 3: אימות**

Run: `npm run build` → Expected: עובר.
ידנית: בפרופיל לקוח, "עדכון התקדמות רוחנית" נראה לעין וקליק מוביל לעמוד עדכון המצוות.

- [ ] **Step 4: Commit**

```bash
git add pages/contact/[id].jsx
git commit -m "feat(ux): make spiritual-progress (mitzvot) update discoverable (U2)"
```

---

### Task 15: מעבר E2E סופי + deploy

- [ ] **Step 1: probe אבטחה אחרון**

Run: `node scripts/probe-rls.mjs` → Expected: 0 דליפות.

- [ ] **Step 2: build**

Run: `npm run build` → Expected: עובר נקי.

- [ ] **Step 3: E2E ידני על הזרימות המרכזיות**

עבור (כ-`coord1` וכ-`activist1`): כניסה · הוספת לקוח · עריכת/מחיקת לקוח · הוספת קשר · שיבוץ פעיל לבית מפגש (+push) · דוח בסיס · סימון "בוצע" · עמוד תשלומים · התראות חוצות-מכשיר · קוביות לחיצות · עדכון מצוות.

- [ ] **Step 4: deploy**

```bash
git push origin main
```
ודא ב-Vercel שה-deploy עבר; ודא שמשתני הסביבה החדשים (`CRON_SECRET`) מוגדרים בפרוד. המעטפת ה-OTA מתעדכנת אוטומטית מהאתר החי.

---

## Self-Review — כיסוי מול ה-spec

- שלב 1 אבטחה: RLS (Task 2) ✓ · API hardening (Task 3) ✓ · CRON_SECRET (Task 4) ✓
- שלב 2 יציבות+דמו: WIP commit (Task 5) ✓ · completed.jsx (Task 6) ✓ · console.log (Task 7) ✓ · התראות→Supabase (Task 11) ✓
- הערות בודקים: B1 (Task 8) ✓ · B2 (Task 9) ✓ · B3 (Task 12 Step 6) ✓ · F1 (Task 10) ✓ · U1 (Task 13) ✓ · U2 (Task 14) ✓ · F2 נדחה (לא task) ✓
- שלב 3 Capacitor (Task 12) ✓
- שלב 4 QA+UX (Tasks 13-15) ✓

**חסמים ידועים שדורשים קלט שלך:** (1) `DEV_DB_URL` להרצת מיגרציות [Task 1]. (2) כללי-התשלום הרשמיים ל-B1 [Task 8 Step 1].
