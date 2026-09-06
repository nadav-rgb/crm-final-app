# מחיקה-רכה + שחזור (90 יום) לפעילים ולקוחות — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** רכז/ראש-פרויקט יכולים למחוק פעיל או לקוח; המחיקה הפיכה 90 יום (מסך "סל מיחזור" + שחזור), ורק אחרי זה מחיקה סופית בלחיצה מפורשת. לפי `docs/superpowers/specs/2026-09-06-soft-delete-restore-activists-contacts-design.md`.

**Architecture:** מיגרציה חדשה (`0025`) מוסיפה `is_active`/`deleted_at` ל-`profiles` ו-`deleted_at`/`deleted_via_activist_id` ל-`contacts`. **קריאה** (מסך הסל) היא שאילתת-לקוח ישירה — RLS הקיים (0013) כבר לא מסנן לפי `is_active` בשום מקום, אז רכז/ראש כבר רשאים לראות שורות-מחוקות בפרויקט שלהם. **כתיבה** (מחיקה/שחזור/מחיקה-סופית) עוברת endpoint מיוחס יחיד (`pages/api/admin/soft-delete.js`), אותה תבנית `requireWriteRole`+admin-client מהתוכנית הקודמת.

**Tech Stack:** Next.js Pages Router, Supabase (migration ידנית — ראה ⚠️ ב-Task 1), אין framework בדיקות ל-API/UI בפרויקט הזה — בדיקה ידנית מול dev server.

## Global Constraints

- **אף מיגרציה לא רצה אוטומטית.** נדב מריץ ידנית ב-SQL Editor (ראה `migrations/README.md`). כל קוד שתלוי בעמודות החדשות יכשל בגלוי (שגיאת PostgREST על עמודה לא-קיימת) עד שהמיגרציה תרוץ — זה תקין ומכוון, לא לעטוף בניסיונות "עמידות" שמסתירים את זה.
- **לא נוגעים ב-`interactions` בשום פעולת-מחיקה, אפילו סופית.** ראה נימוק מלא ב-Task 4.
- לא נוגעים ב-`bonus_key` format, ב-RLS הקיים, או בהיסטוריית תשלומים.
- אחרי כל שינוי: `npm run build` נקי.
- ניווט: פריט חדש (`/trash`) חייב להיכנס לשלושת הקבצים (`components/DesktopLayout.jsx`, `pages/landing.jsx`, `components/MobileBottomNav.jsx`) — ל-`drawerItems`, לא `mainItems`.

---

## File Structure

- **Create** `migrations/0025_soft_delete_restore.sql` — עמודות חדשות (⚠️ לא כולל עדכון ה-view `activist_directory`, ראה Task 1).
- **Create** `pages/api/admin/soft-delete.js` — endpoint מיוחס: delete/restore/purge לשני הסוגים.
- **Create** `pages/trash.jsx` — מסך סל-מיחזור.
- **Modify** `pages/contact/[id].jsx` — `doDelete` מנתב coord/head ל-endpoint החדש.
- **Modify** `pages/activists/[id].jsx` — כפתור מחיקה חדש (לא קיים היום).
- **Modify** `components/DesktopLayout.jsx`, `pages/landing.jsx`, `components/MobileBottomNav.jsx` — ניווט ל-`/trash`.

---

### Task 1: מיגרציה — עמודות `is_active`/`deleted_at`

**Files:**
- Create: `migrations/0025_soft_delete_restore.sql`

**Interfaces:**
- Produces: `profiles.is_active` (boolean, default true), `profiles.deleted_at` (timestamptz, null), `contacts.deleted_at` (timestamptz, null), `contacts.deleted_via_activist_id` (integer, null).

⚠️ **מספור 0025, לא 0018:** מיגרציות `0018`-`0024` קיימות היום על ענפים מקומיים אחרים שטרם מוזגו (למשל `security/hardening-p0`) — ראה preflight מ-2026-09-06. `0025` נמנע מהתנגשות מספור עם עבודה מקבילה.

⚠️ **`activist_directory` (ה-view שממנו נטענים כל הפעילים) לא מתעדכן במיגרציה הזו.** אין CLI/`exec_sql` בפרויקט (ראה `migrations/README.md`) כדי לשלוף את הגדרת ה-view הקיימת בבטחה — צריך קודם שמישהו ירוץ ב-SQL Editor:
```sql
select pg_get_viewdef('public.activist_directory'::regclass, true);
```
ויתעד את התוצאה. בלעדיה, `create or replace view` עלול להשמיט בטעות עמודה קיימת שצרכן אחר מסתמך עליה. **המשמעות המעשית:** אחרי המיגרציה הזו, מחיקת פעיל תעדכן את `profiles.is_active` נכון (וכל שאר הלוגיקה בתוכנית תעבוד), אבל **הפעיל ימשיך להופיע ברשימת הפעילים** (`pages/activists.jsx`) עד שה-view גם יתעדכן בנפרד — ראה ⚠️ מקביל ב-Task 3.

- [ ] **Step 1: כתוב את קובץ המיגרציה**

```sql
-- migrations/0025_soft_delete_restore.sql
-- מחיקה-רכה + שחזור (90 יום) לפעילים ולקוחות, בהרשאת רכז/ראש-פרויקט (2026-09-06).
--
-- profiles: אין להם היום שום עמודת סטטוס בכלל (הטבלה קדמה לתיקיית המיגרציות).
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists deleted_at timestamptz null;

-- contacts: is_active כבר קיים (0002_contacts_softdelete.sql). מוסיפים deleted_at
-- (לחישוב חלון-90-יום) ו-deleted_via_activist_id (מסמן "נמחק כתוצאת-לוואי של מחיקת
-- הפעיל X" — קריטי לשחזור מדויק: שחזור פעיל משחזר *רק* לקוחות עם הסימון הזה שווה
-- למזהה שלו, לא לקוחות שהפעיל מחק בעצמו בנפרד, לפני או אחרי).
alter table public.contacts add column if not exists deleted_at timestamptz null;
alter table public.contacts add column if not exists deleted_via_activist_id integer null;

-- ⚠️ activist_directory (view) לא מעודכן כאן במכוון — ראה הערת ⚠️ בראש התוכנית.
-- לאחר שמישהו מריץ `select pg_get_viewdef('public.activist_directory'::regclass, true);`
-- ומספק את התוצאה, יתווסף כאן (או במיגרציה נפרדת) `create or replace view` שחושף גם
-- is_active וגם deleted_at, ומסנן is_active=true כברירת מחדל.
```

- [ ] **Step 2: הודע לנדב במפורש שהמיגרציה ממתינה**

בסיום התוכנית (אחרי Task 6), הדוח הסופי חייב לכלול: (א) שיש להריץ את `migrations/0025_soft_delete_restore.sql` ב-SQL Editor של Supabase לפני שהתכונה תעבוד בפועל, (ב) שיש להריץ קודם את שאילתת `pg_get_viewdef` ולהעביר את התוצאה כדי שהצעד הבא (עדכון ה-view) יוכל להיכתב בבטחה. עד אז, כל הקוד ש-Task 2 ואילך כותבים ייכשל בגלוי מול Supabase אמיתי (שגיאת PostgREST "column does not exist") — זה מכוון, לא לעטוף בניסיון "עמידות".

- [ ] **Step 3: Commit**

```bash
git add migrations/0025_soft_delete_restore.sql
git commit -m "chore: prepare (not run) migration for soft-delete/restore columns"
```

---

### Task 2: `pages/api/admin/soft-delete.js` — מחיקה/שחזור ללקוחות

**Files:**
- Create: `pages/api/admin/soft-delete.js`

**Interfaces:**
- Produces: `POST /api/admin/soft-delete` עם body `{ entity: 'contact', action: 'delete' | 'restore', id }`. מחזיר `{ error: null }` בהצלחה. (וריאנט `entity: 'activist'` וריאנט `action: 'purge'` נוספים ב-Tasks 3-4 — הקובץ נבנה הדרגתית.)

⚠️ **תלוי ב-Task 1 (מיגרציה) כדי לעבוד בפועל מול Supabase אמיתי** — אבל הקוד עצמו נכתב ונבדק-build עכשיו; אין סיבה לחכות למיגרציה כדי לכתוב קוד תקין.

- [ ] **Step 1: כתוב את הקובץ (מחיקה/שחזור ללקוח בלבד בשלב זה)**

```js
// pages/api/admin/soft-delete.js — מחיקה-רכה/שחזור/מחיקה-סופית לפעילים ולקוחות,
// בהרשאת רכז/ראש-פרויקט/מנכ"ל. אותה תבנית requireWriteRole+admin-client כמו
// pages/api/interactions/manage.js — לא נוגעים ב-RLS.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';

function projectIdsOf(profile) {
  if (Array.isArray(profile.project_ids) && profile.project_ids.length > 0) return profile.project_ids.map(Number);
  return profile.project_id ? [Number(profile.project_id)] : [];
}

async function assertProjectAccess(admin, auth, projectId) {
  if (auth.profile.role === 'ceo') return null;
  if (!projectIdsOf(auth.profile).includes(Number(projectId))) {
    return { status: 403, error: 'הישות הזו לא בפרויקט שלך' };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { entity, action, id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!['contact', 'activist'].includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
  if (!['delete', 'restore'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const admin = getSupabaseAdmin();

  if (entity === 'contact') {
    const { data: contact, error: readErr } = await admin.from('contacts').select('id, project_id').eq('id', id).single();
    if (readErr || !contact) return res.status(404).json({ error: 'Contact not found' });
    const accessErr = await assertProjectAccess(admin, auth, contact.project_id);
    if (accessErr) return res.status(accessErr.status).json({ error: accessErr.error });

    if (action === 'delete') {
      const { error } = await admin.from('contacts').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      const { error } = await admin.from('contacts').update({ is_active: true, deleted_at: null }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ error: null });
  }

  return res.status(400).json({ error: 'activist entity not yet supported' }); // Task 3
}
```

- [ ] **Step 2: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 3: Commit**

```bash
git add pages/api/admin/soft-delete.js
git commit -m "feat: add contact soft-delete/restore endpoint for coord/head"
```

---

### Task 3: הרחבה ל-`activist` — מחיקה/שחזור עם cascade ללקוחות

**Files:**
- Modify: `pages/api/admin/soft-delete.js`

**Interfaces:**
- Consumes: `assertProjectAccess`, `projectIdsOf` מ-Task 2.
- Produces: `entity: 'activist'` תומך עכשיו ב-`delete`/`restore`, כולל cascade ל-`contacts.deleted_via_activist_id`.

⚠️ **תלוי ב-Task 1 השלם (כולל עדכון ה-view `activist_directory`) כדי "להיעלם מהתצוגה" בפועל.** בלי עדכון ה-view, הפעיל *יסומן* נכון ב-`profiles` אבל **ימשיך להופיע** ב-`pages/activists.jsx` (כי הטעינה שם עוברת דרך ה-view, לא דרך הטבלה ישירות — ראה `lib/CrmStore.jsx:270-306`). מסמנים את זה כאן במפורש, לא מתעלמים ולא "פותרים" בעקיפין (כמו לשנות את שאילתת ה-view-loading לקרוא מ-`profiles` ישירות — זה שינוי ארכיטקטוני נפרד, לא כלול בהיקף).

⚠️ **מפתח:** `id` שמגיע מה-client עבור `entity: 'activist'` הוא **`activist_code`** (int) — אומת ישירות ב-`pages/activists/[id].jsx:98`: `activist.id === Number(a.activist_code)`, ואותו דבר ב-`contacts.activist_id`/`interactions.activist_id` בכל שאר האפליקציה. `profiles.id` (uuid, מפתח Auth) הוא פנימי ולא נחשף ללקוח — נשלף בשרת רק כשצריך (ל-`admin.auth.admin.deleteUser` ב-Task 4).

- [ ] **Step 1: הרחב את הענף `entity === 'activist'`**

שנה את השורה האחרונה (`return res.status(400).json({ error: 'activist entity not yet supported' });`) ל:

```js
  // entity === 'activist' — id הוא activist_code (int), לא profiles.id (uuid).
  const { data: activist, error: readErr } = await admin.from('profiles').select('id, project_id, project_ids').eq('activist_code', id).single();
  if (readErr || !activist) return res.status(404).json({ error: 'Activist not found' });
  const activistProjectIds = Array.isArray(activist.project_ids) && activist.project_ids.length > 0
    ? activist.project_ids : (activist.project_id ? [activist.project_id] : []);
  // מנכ"ל תמיד; רכז/ראש רק אם משתפים לפחות פרויקט אחד עם הפעיל.
  if (auth.profile.role !== 'ceo') {
    const callerIds = projectIdsOf(auth.profile);
    const shares = activistProjectIds.some(p => callerIds.includes(Number(p)));
    if (!shares) return res.status(403).json({ error: 'הפעיל הזה לא בפרויקט שלך' });
  }

  if (action === 'delete') {
    const now = new Date().toISOString();
    const { error: profErr } = await admin.from('profiles').update({ is_active: false, deleted_at: now }).eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // cascade: רק לקוחות שהיו פעילים ברגע המחיקה — לא "מחייה" בטעות לקוח שהפעיל
    // עצמו כבר מחק קודם (ראה deleted_via_activist_id בהערת המיגרציה, Task 1).
    // deleted_via_activist_id מאוחסן גם הוא כ-activist_code, לעקביות עם contacts.activist_id.
    const { error: contactsErr } = await admin.from('contacts')
      .update({ is_active: false, deleted_at: now, deleted_via_activist_id: id })
      .eq('activist_id', id).eq('is_active', true);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
  } else {
    const { error: profErr } = await admin.from('profiles').update({ is_active: true, deleted_at: null }).eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // שחזור הפוך מדויק: רק לקוחות שהוסתרו *כתוצאה* מהמחיקה הזו — לא נוגע בלקוח
    // שהפעיל מחק בעצמו בנפרד (ה-flag deleted_via_activist_id הוא ההבחנה).
    const { error: contactsErr } = await admin.from('contacts')
      .update({ is_active: true, deleted_at: null, deleted_via_activist_id: null })
      .eq('deleted_via_activist_id', id);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
  }
  return res.status(200).json({ error: null });
```

- [ ] **Step 2: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 3: Commit**

```bash
git add pages/api/admin/soft-delete.js
git commit -m "feat: add activist soft-delete/restore with cascading contact hide"
```

---

### Task 4: פעולת `purge` — מחיקה סופית אחרי 90 יום

**Files:**
- Modify: `pages/api/admin/soft-delete.js`

**Interfaces:**
- Produces: `action: 'purge'` (בנוסף ל-`delete`/`restore`) לשני הסוגים.

⚠️ **`interactions` לא נמחקות בשום מקרה, גם כאן.** הן נשארות ב-DB, מצביעות על `activist_id`/`contact_id` שכבר לא קיימים — יתומות ובלתי-נגישות מכל מסך (אין דרך ניווט אליהן ברגע שהפעיל/הלקוח נעלמו), אבל לא נהרסות. זו בדיוק ההיסטוריה שמזינה דוחות-שכר של חודשים שכבר שולמו — מחיקה פיזית שלה הייתה הרס בלתי-הפיך של רשומת-שכר אמיתית. **לפני שממשיכים:** בדוק (לא ניחוש) אם יש FK constraint בין `interactions.activist_id`/`contact_id` לבין `profiles`/`contacts` עם `on delete restrict` — אם כן, ה-DELETE הפיזי למטה ייכשל בבירור אם יש עדיין קשרים תלויים, מה שבפועל *מחזק* את ההחלטה הזו (אפשר לתעד את זה ב-commit message).

- [ ] **Step 1: הוסף את שער-90-הימים + פעולת ה-purge**

בראש ה-handler, אחרי בדיקת `if (!['delete', 'restore'].includes(action))`, שנה ל:
```js
  if (!['delete', 'restore', 'purge'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
```

הוסף פונקציית עזר אחרי `assertProjectAccess`:
```js
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
function purgeEligible(deletedAt) {
  if (!deletedAt) return false;
  return Date.now() - new Date(deletedAt).getTime() >= NINETY_DAYS_MS;
}
```

בענף `entity === 'contact'`, אחרי הבדיקה `if (readErr || !contact)`, עדכן את ה-`select` לכלול `deleted_at`:
```js
    const { data: contact, error: readErr } = await admin.from('contacts').select('id, project_id, deleted_at').eq('id', id).single();
```
ואחרי בדיקת ה-access, הוסף לפני ה-`if (action === 'delete')` הקיים:
```js
    if (action === 'purge') {
      if (!purgeEligible(contact.deleted_at)) return res.status(409).json({ error: 'עדיין לא עברו 90 יום מהמחיקה' });
      const { error } = await admin.from('contacts').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ error: null });
    }
```

בענף `entity === 'activist'`, עדכן את ה-`select` הראשוני לכלול `deleted_at` (ה-`select` הקיים כבר מחזיר `id` — זה ה-`profiles.id`/uuid, נשמר לשימוש ב-`deleteUser` למטה; החיפוש עצמו הוא לפי `activist_code`, ראה Task 3):
```js
  const { data: activist, error: readErr } = await admin.from('profiles').select('id, project_id, project_ids, deleted_at').eq('activist_code', id).single();
```
והוסף, אחרי בדיקת שיתוף-הפרויקט ולפני `if (action === 'delete')`:
```js
  if (action === 'purge') {
    if (!purgeEligible(activist.deleted_at)) return res.status(409).json({ error: 'עדיין לא עברו 90 יום מהמחיקה' });
    const { error: contactsErr } = await admin.from('contacts').delete().eq('deleted_via_activist_id', id);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
    const { error: profErr } = await admin.from('profiles').delete().eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // deleteUser דורש את ה-Auth user id (uuid) — activist.id מה-select למעלה, לא את
    // ה-activist_code (id, פרמטר הבקשה). לא חוסם על כשל: הפרופיל כבר נמחק בהצלחה.
    const { error: authErr } = await admin.auth.admin.deleteUser(activist.id);
    if (authErr) console.error('Profile deleted but auth user deletion failed', authErr);
    return res.status(200).json({ error: null });
  }
```

- [ ] **Step 2: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 3: Commit**

```bash
git add pages/api/admin/soft-delete.js
git commit -m "feat: add purge action (final deletion after 90-day window)"
```

---

### Task 5: `pages/trash.jsx` — מסך סל-מיחזור

**Files:**
- Create: `pages/trash.jsx`
- Modify: `lib/AuthStore.jsx:166-175` (`can.*`) — הוספת `can.manageDeleted`

**Interfaces:**
- Consumes: `soft-delete` endpoint (Tasks 2-4), `authHeader()` מ-`lib/apiAuth.js`.
- Produces: עמוד `/trash`.

⚠️ **הקריאה (רשימת הנמחקים) היא שאילתת-לקוח ישירה, לא endpoint** — RLS הקיים (`contacts_select`/`profiles_select`, migration 0013) כבר לא מסנן לפי `is_active`, אז רכז/ראש כבר רשאים לראות שורות עם `is_active=false` בפרויקט שלהם בלי שינוי RLS. רק הכתיבה (שחזור/מחיקה-סופית) עוברת את ה-endpoint.

- [ ] **Step 1: הוסף `can.manageDeleted` ל-`lib/AuthStore.jsx`**

בתוך אובייקט ה-`can` (שורות 166-175), הוסף שורה (אותם roles כמו `requireWriteRole`):
```js
    manageDeleted:          ['coord', 'head', 'ceo'].includes(role),
```

- [ ] **Step 2: כתוב את `pages/trash.jsx`**

```jsx
// pages/trash.jsx — סל מיחזור: פעילים ולקוחות שנמחקו, ניתנים לשחזור 90 יום.
import { useState, useEffect } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import { authHeader } from '../lib/apiAuth';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
function daysLeft(deletedAt) {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((NINETY_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
}

export default function Trash() {
  const { can, currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(null); // { entity, id, name }

  async function load() {
    if (!currentUser) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: contacts }, { data: activists }] = await Promise.all([
      supabase.from('contacts').select('id, name, deleted_at').not('deleted_at', 'is', null),
      currentUser.role === 'ceo' || currentUser.role === 'coord' || currentUser.role === 'head'
        ? supabase.from('profiles').select('id, name, deleted_at').not('deleted_at', 'is', null)
        : Promise.resolve({ data: [] }),
    ]);
    const combined = [
      ...(contacts || []).map(c => ({ entity: 'contact', id: c.id, name: c.name, deletedAt: c.deleted_at })),
      ...(activists || []).map(a => ({ entity: 'activist', id: a.id, name: a.name, deletedAt: a.deleted_at })),
    ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    setRows(combined);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentUser]);

  async function callAction(entity, id, action) {
    setBusyId(id);
    const res = await fetch('/api/admin/soft-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ entity, id, action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) { alert(body.error || 'הפעולה נכשלה'); return; }
    setConfirmPurge(null);
    await load();
  }

  if (!can.manageDeleted) {
    return <DesktopLayout title="סל מיחזור"><p style={{ padding: 24 }}>אין לך הרשאה לצפות בעמוד הזה.</p></DesktopLayout>;
  }

  return (
    <DesktopLayout title="סל מיחזור">
      <div style={{ padding: 24 }}>
        {loading && <p>טוען…</p>}
        {!loading && rows.length === 0 && <p>אין פריטים מחוקים כרגע.</p>}
        {!loading && rows.map(r => {
          const left = daysLeft(r.deletedAt);
          return (
            <div key={`${r.entity}-${r.id}`} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.name} <span style={{ fontSize: 12, color: '#aaa' }}>({r.entity === 'activist' ? 'פעיל' : 'לקוח'})</span></div>
                <div style={{ fontSize: 12, color: '#888' }}>נמחק ב-{new Date(r.deletedAt).toLocaleDateString('he-IL')} · {left > 0 ? `נותרו ${left} ימים לשחזור` : 'תם חלון השחזור'}</div>
              </div>
              {left > 0 ? (
                <button className="btn" disabled={busyId === r.id} onClick={() => callAction(r.entity, r.id, 'restore')}>↺ שחזור</button>
              ) : (
                <button className="btn" style={{ color: '#a32d2d', borderColor: '#d98a8a' }} disabled={busyId === r.id}
                  onClick={() => setConfirmPurge(r)}>🗑️ מחיקה סופית</button>
              )}
            </div>
          );
        })}
      </div>

      {confirmPurge && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}
          onClick={() => setConfirmPurge(null)}>
          <div className="card" style={{ padding: 24, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginTop: 0 }}>
              למחוק לצמיתות את <strong>{confirmPurge.name}</strong>?
              {confirmPurge.entity === 'activist' && ' כל אנשי הקשר שנמחקו יחד איתו יימחקו לצמיתות גם הם.'}
              {' '}לא ניתן לבטל פעולה זו.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmPurge(null)}>ביטול</button>
              <button className="btn" style={{ background: '#a32d2d', color: '#fff' }}
                onClick={() => callAction(confirmPurge.entity, confirmPurge.id, 'purge')}>מחק לצמיתות</button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}
```

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 4: Commit**

```bash
git add pages/trash.jsx lib/AuthStore.jsx
git commit -m "feat: add trash page for restoring/purging soft-deleted activists and contacts"
```

---

### Task 6: כפתורי מחיקה — ניתוב + הוספה, וניווט

**Files:**
- Modify: `pages/contact/[id].jsx` (`doDelete`, שורות 130-135 (זזו מ-124-129 עקב תוכנית 1))
- Modify: `pages/activists/[id].jsx` — כפתור מחיקה חדש (לא קיים היום)
- Modify: `components/DesktopLayout.jsx`, `pages/landing.jsx`, `components/MobileBottomNav.jsx` — ניווט

**Interfaces:**
- Consumes: `soft-delete` endpoint, `authHeader()`.

- [ ] **Step 1: `pages/contact/[id].jsx` — נתב `doDelete` ל-endpoint עבור coord/head**

מצא (שורות 130-135, אחרי שינויי תוכנית 1):
```js
  async function doDelete() {
    setBusy(true);
    await deleteContact(contact.id);
    setBusy(false);
    router.push('/contacts');
  }
```
שנה ל:
```js
  async function doDelete() {
    setBusy(true);
    if (currentUser?.role === 'coord' || currentUser?.role === 'head') {
      const res = await fetch('/api/admin/soft-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ entity: 'contact', id: contact.id, action: 'delete' }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error || 'המחיקה נכשלה'); setBusy(false); return; }
    } else {
      await deleteContact(contact.id);
    }
    setBusy(false);
    router.push('/contacts');
  }
```
והוסף import בראש הקובץ: `import { authHeader } from '../../lib/apiAuth';`

- [ ] **Step 2: `pages/activists/[id].jsx` — הוסף כפתור מחיקה**

`authHeader` **כבר מיובא** בקובץ (שורה 8) — אין צורך בimport נוסף. `useState` **כבר מיובא** (שורה 2). הוסף את שני ה-hooks **מיד אחרי** שורה 91 (`const canSendNotification = ...;`) — **לפני** בדיקת `if (!can.seeActivists)` בשורה 94 (כללי hooks: לפני כל early return, בדיוק כמו ההערה המקבילה ב-`pages/contact/[id].jsx:24`):

```js
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
```

הוסף **מיד אחרי** שורה 99 (`if (!activist) return ...;`) — כלומר אחרי ש-`activist` בטוח קיים:

```js
  async function doDeleteActivist() {
    setBusy(true);
    const res = await fetch('/api/admin/soft-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ entity: 'activist', id: activist.id, action: 'delete' }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { alert(body.error || 'המחיקה נכשלה'); return; }
    router.push('/activists');
  }
```

הוסף כפתור, **מיד אחרי** שורה 140 (`{canSendNotification && <SendNotificationBox activist={activist} />}`):

```jsx
          {can.manageDeleted && (
            <button onClick={() => setConfirmDel(true)} className="btn"
              style={{ width: '100%', marginBottom: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#a32d2d', borderColor: '#d98a8a' }}>
              🗑️ מחיקת פעיל
            </button>
          )}
```

הוסף מודל-אישור, **מיד לפני** שורה 254 (`</DesktopLayout>`, אחרי שה-`</div>` הסוגר את ה-grid נסגר בשורה 253):

```jsx
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}
          onClick={() => setConfirmDel(false)}>
          <div style={{ padding: 24, maxWidth: 380, background: '#fff', borderRadius: 16 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginTop: 0 }}>
              למחוק את <strong>{activist.name}</strong>? כל אנשי הקשר שלו ({ownedContacts.length}) יוסתרו יחד איתו.
              ניתן לשחזר תוך 90 יום דרך סל המיחזור.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmDel(false)} disabled={busy}>ביטול</button>
              <button className="btn" style={{ background: '#a32d2d', color: '#fff' }} disabled={busy} onClick={doDeleteActivist}>מחק</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: ניווט — 3 קבצים**

ב-`components/DesktopLayout.jsx`: הוסף `Trash2` לרשימת ה-imports מ-`lucide-react` (השורה `Home, User, Users, Calendar, UserPlus, ...`), והוסף **מיד אחרי** שורת ה-`NavItem` של `/payments` (שורה 172-173, `{can.seePayments && (...)});`):
```jsx
          {can.manageDeleted && (
            <NavItem href="/trash" icon={<Trash2 {...ICO} />} label="סל מיחזור" open={open} active={router.pathname === '/trash'} onActivate={() => setOpen(true)} />
          )}
```

ב-`pages/landing.jsx`: הוסף `Trash2` לאותה רשימת imports, והוסף **מיד אחרי** שורת ה-`SideItem` של `/payments` (שורה 244-246):
```jsx
          {can.manageDeleted && (
            <SideItem icon={<Trash2 {...ICO} />} label="סל מיחזור" open={open} onClick={() => router.push('/trash')} />
          )}
```

ב-`components/MobileBottomNav.jsx`: הוסף `Trash2` לאותה רשימת imports, והוסף שורה חדשה במערך `drawerItems` (שורה 36-46), **אחרי** שורת `seePayments`:
```js
    can.manageDeleted && { href: '/trash', icon: <Trash2 {...ICO} />, label: 'סל מיחזור' },
```

- [ ] **Step 4: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 5: בדיקה ידנית מלאה (אחרי שנדב מריץ את המיגרציה + עדכון ה-view)**

1. כ-coord: מחק לקוח → נעלם מהרשימה, מופיע ב-`/trash` עם "נותרו 90 ימים". שחזר → חוזר לרשימה.
2. כ-coord: מחק פעיל עם 2 לקוחות פעילים → הפעיל *וה-2 לקוחות* נעלמים; שחזר את הפעיל → כל ה-3 חוזרים ביחד.
3. עדכן ידנית `deleted_at` בשורה ל-91 יום אחורה (ב-SQL Editor) → כפתור "שחזור" נעלם מה-UI, "מחיקה סופית" מופיע; לחיצה עליו מוחקת לצמיתות.

- [ ] **Step 6: Commit**

```bash
git add "pages/contact/[id].jsx" "pages/activists/[id].jsx" components/DesktopLayout.jsx pages/landing.jsx components/MobileBottomNav.jsx
git commit -m "feat: wire delete buttons to soft-delete endpoint, add trash page navigation"
```
