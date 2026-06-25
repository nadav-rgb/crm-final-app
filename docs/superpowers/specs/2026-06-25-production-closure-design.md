# CRM מקרבים — תוכנית סגירה לפרודקשן + מעטפת Capacitor

תאריך: 2026-06-25
סטטוס: spec מאושר לעבודה

## מטרה
להביא את ה-CRM של "אחדות יהודית" למצב **production-ready מלא** ולספק **אפליקציית Capacitor (מעטפת OTA)**.
הפרויקט הוא beta חי עם 3 בודקים, Supabase backend אמיתי, deploy ל-`https://crm-final-app.vercel.app/`.

## עדיפויות (לפי החלטת המשתמש, בסדר)
1. אבטחת נתונים (RLS) — חוסם פרודקשן
2. יציבות ובאגים
3. ניקוי קוד דמו
4. ביצועים ו-UX

## ממצאי אודיט (מעוגנים בקוד/DB, 2026-06-25)
- **Build**: עובר נקי (`next build` exit 0).
- **RLS דליפה (קריטי)**: משתמש אנונימי (ללא התחברות) קורא דרך ה-API הציבורי את `contacts` ו-`interactions` — PII אמיתי (שמות/טלפונים). `meeting_houses`/`profiles`/`push_subscriptions` החזירו 0 שורות (ריק או מוגן — לאמת).
- **API ללא auth**: `pages/api/push/subscribe.js`, `pages/api/reminders/schedule.js`, `pages/api/reminders/cancel.js`, `pages/api/ai-summary.js` משתמשים ב-admin client (service role) ללא בדיקת הרשאה. (`meeting-houses/assign|upsert`, `push/send`, `cron/send-reminders` — מאובטחים.)
- **`.env.local` לא בגיט** ומעולם לא היה (ב-`.gitignore`). אין דליפת מפתחות. אין צורך ב-rotation.
- **קוד דמו ב-localStorage**: `notificationDemo.js` (התראות in-app), `reminderSchedulerDemo.js` (שלבי תזכורת), `aiDemo.js` (AI keyword-matching). `chatDemo.js` — dead code, הצ'אט מוסתר "בקרוב".
- **פיצול מקור-אמת**: `pages/meeting-houses/completed.jsx:29` קורא רק localStorage (`getMeetingHouses()`) ומתעלם מ-Supabase.
- **שאריות**: console.log אבחון ב-`lib/paymentCalc.js` (`[CALC-DIAG]`) ו-`pages/payments.jsx` (`[PAY-DIAG]`); `CRON_SECRET` חלש.
- **WIP לא מקומיט (גמור)**: כפתור יציאה במובייל, push אמיתי בשיבוץ (`pages/api/push/send.js` חדש), ניקוי לוגיקת הוספת לקוח.

## החלטות מוצר
- **התראות**: לחבר ל-Supabase (טבלת `notifications` אמיתית, נשמרת בין מכשירים). מחליף את `notificationDemo.js` (localStorage).
- **AI**: נשאר keyword-matching (`aiDemo.js`). לא בסקופ.
- **RLS**: מיגרציות SQL שאני כותב; הרצה דרך node+pg מול connection string ישיר, או הדבקה ב-Supabase SQL Editor אם אין connection string.
- **Capacitor**: מעטפת OTA — `server.url = https://crm-final-app.vercel.app/`. git push → עדכון אוטומטי, כמו family/insurance.

## ארכיטקטורת השינויים

### שלב 1 — אבטחה (חוסם פרודקשן)
**1.1 RLS migrations** (`migrations/0001_rls.sql` או דומה):
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` על: `contacts`, `interactions`, `meeting_houses`, `profiles`, `push_subscriptions`, `meeting_reports`, וכל טבלה נוספת עם נתונים.
- Policies: קריאה/כתיבה רק ל-`authenticated` עם role/project מתאים. ה-API routes הכותבים משתמשים ב-service role (עוקף RLS) — לכן ה-RLS מגן על הגישה ה-client-side הישירה.
- אימות אמפירי לאחר ההרצה: probe אנונימי חוזר 0/blocked על כל הטבלאות.
- **דרישה מקדימה**: connection string ישיר ל-Postgres (Supabase → Settings → Database) או הרצה ידנית ב-SQL Editor.

**1.2 הקשחת API routes**:
- `reminders/schedule.js`, `reminders/cancel.js` → `requireWriteRole(req)` (כמו meeting-houses).
- `push/subscribe.js` → אימות שה-JWT תקף ושה-`activistId` תואם למשתמש המחובר (פעיל רושם רק את עצמו).
- `ai-summary.js` → `requireWriteRole` או אימות משתמש מחובר (הגנה על קרדיט Anthropic).

**1.3 `CRON_SECRET`** → מחרוזת אקראית 32+ תווים (ב-Vercel env + `.env.local`).

### שלב 2 — יציבות וקוד דמו
- **2.1** קומיט ה-WIP הקיים (יציאה + push-בשיבוץ + ניקוי לקוח) כקומיט קוהרנטי.
- **2.2** `completed.jsx` → לקרוא מ-Supabase (אותה לוגיקת merge כמו שאר דפי בתי המפגש).
- **2.3** הסרת console.log האבחון (`[CALC-DIAG]`, `[PAY-DIAG]`).
- **2.4** **התראות → Supabase**: טבלת `notifications` (id, user_id/activist_id, type, title, body, url, read, created_at) + RLS. שכבת `lib/notifications.js` (CRUD מול Supabase) מחליפה את `notificationDemo.js`. עדכון הקוראים: `DesktopLayout`, `landing`, `notifications.jsx`, ויצרני ההתראות (`base-meetings`, `add-interaction`, שיבוץ בתי מפגש, `reminderSchedulerDemo`). `chatDemo.js` נמחק.

### שלב 3 — מעטפת Capacitor OTA
- `npm i @capacitor/core @capacitor/cli @capacitor/android`.
- `capacitor.config.json`: `appId` (לדוגמה `com.achdutyehudit.crm`), `appName` "מקרבים", `server.url = https://crm-final-app.vercel.app/`, `server.cleartext=false`.
- `npx cap add android`, בניית APK דרך JBR של Android Studio (כמו insurance/family).
- `android/` ב-`.gitignore` עם תיעוד שחזור, או commit מלא — לפי הדפוס הקיים בפרויקטים האחרים.
- אין הפצה אוטומטית — APK למכשיר המשתמש בלבד עד אישור מפורש.

### שלב 4 — QA + ביצועים
- מעבר E2E על: כניסה (3 חשבונות בודקים), הוספת לקוח, הוספת קשר, שיבוץ פעיל לבית מפגש (כולל push), דוח בסיס, תשלומים, התראות (לאחר מעבר ל-Supabase).
- ליטוש UX קל היכן שעולה (optimistic UI / מהירות טעינה) — בלי לפתוח סקופ עיצוב גדול.

## טיפול בשגיאות
- מיגרציות RLS: בדיקת idempotency (`drop policy if exists` לפני create). אימות אמפירי חובה אחרי הרצה.
- API auth: החזרת 401/403 עקבית, ללא חשיפת פרטי שגיאה.
- התראות Supabase: fallback שקט אם הקריאה נכשלת (לא לשבור את ה-UI).

## בדיקות / קריטריון הצלחה
1. probe אנונימי → 0 שורות/blocked על כל הטבלאות.
2. כל route תחת `pages/api/` מאמת הרשאה לפני שימוש ב-admin client.
3. `next build` עובר.
4. התראות נשמרות ונקראות מ-Supabase בין שני מכשירים.
5. `completed.jsx` מציג בתי מפגש שהושלמו מ-Supabase.
6. APK של Capacitor נטען ומציג את האתר החי; git push מעדכן.
7. מעבר E2E על הזרימות המרכזיות — ירוק.

## מחוץ לסקופ (YAGNI)
- AI אמיתי (נשאר keyword-matching).
- צ'אט פעילים (מוסתר "בקרוב").
- iOS (אנדרואיד בלבד כרגע).
- עיצוב מחדש גדול.
