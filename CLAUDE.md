# מקרבים — CRM אחדות יהודית

## מה הפרויקט
מערכת CRM לניהול פעילים, לקוחות ובתי מפגש עבור ארגון "אחדות יהודית" ופרויקט "נעים להכיר".
Next.js 14, Pages Router, RTL עברית. **Backend: Supabase (Postgres+Auth+RLS)** — לא localStorage
(השורה הקודמת כאן הייתה לא-מעודכנת). כל טעינת נתונים (contacts/interactions/expenses/
base_meeting_reports/activist_directory) מסוננת בשרת לפי activist_id/project_ids של המשתמש
המחובר (ראה `lib/CrmStore.jsx`, `migrations/0013_activist_isolation_rls.sql`) — בידוד נתונים
בין פעילים הוא דרישת-על, לא רק נוחות UI.

## כללי עבודה — חובה לפני כל שינוי
1. קרא את הקובץ הרלוונטי לפני כל עריכה
2. אחרי כל שינוי: הרץ `npm run build`
3. דווח שגיאות מדויקות אם יש
4. אם הדף קורס: `rm -rf .next` ואז `npm run dev`

### מיגרציות — סוכן AI לא יכול להריץ
`SUPABASE_SECRET_KEY` הוא מפתח PostgREST: הוא עושה CRUD, אבל **לא מריץ DDL**. אין CLI,
אין connection string, ואין `exec_sql` ב-DB. **כל מיגרציה מורצת ידנית ב-SQL Editor על ידי נדב.**
כשכותבים מיגרציה: לומר לו במפורש שהיא ממתינה, ולכתוב את הקוד כך שייכשל **בגלוי ומוסבר**
עד שתרוץ (ולא בשקט). ראה `migrations/README.md` — כולל טבלת מצב מאומתת מול ה-DB.

## מבנה הפרויקט

### דפים (pages/)
- `landing.jsx` — דף הבית, יש בו סרגל צד עצמאי משלו
- `contacts.jsx` — רשימת לקוחות
- `contacts/add.jsx` — הוספת לקוח, מצוות 0-4 חובה
- `contact/[id].jsx` — פרופיל לקוח
- `contact/add-interaction/[id].jsx` — הוספת קשר
- `contact/update-mitzvot/[id].jsx` — עדכון מצוות
- `former-contacts.jsx` — לקוחות לשעבר
- `meeting-houses/index.jsx` — בתי מפגש פעילים בלבד
- `meeting-houses/[id].jsx` — פרטי בית מפגש + 4 מפגשים
- `meeting-houses/new.jsx` — יצירת בית מפגש
- `meeting-houses/completed.jsx` — בתי מפגש שהסתיימו
- `meeting-house-results.jsx` — תוצאות מצטברות
- `base-meetings.jsx` — טופס דיווח מובנה 11 שדות
- `activists.jsx` + `activists/[id].jsx` — פעילים
- `notifications.jsx` — התראות (+ כפתור "שלח התראת ניסיון" לאבחון push במכשיר)
- `payments.jsx` — תשלומים
- `reminders.jsx` — תזכורות
- `today.jsx` — פעולות היום
- `chat.jsx` — צ'אט פעילים
- `feedback.jsx` — תקלות והצעות: פעילים מדווחים באגים/תקיעות/רעיונות,
  רכז/ראש/מנכ"ל מסמנים "נסקר". דורש `migrations/0016_feedback_reports.sql`.
  ⚠️ `migrations/0017_feedback_issue_url.sql` **טרם הורצה** (אומת מול ה-DB ב-2026-08-23:
  `feedback_reports.issue_url` לא קיימת). לכן ה-cron `api/cron/feedback-to-issues`
  נכשל כל לילה ולא נפתח אף GitHub Issue. `scripts/mark-feedback-reviewed.cjs` מסמן
  דיווחים כ"נסקר" אחרי שהם תוקנו.

### קומפוננטים (components/)
- `DesktopLayout.jsx` — לייאאוט ראשי + סרגל צד לכל הדפים חוץ מ-landing
- `ContactCard.jsx`, `ActivistCard.jsx`, `FilterChips.jsx`, `StatusBadge.jsx`
- `ui/` — AppButton, AppCard, AppInput, AppBadge, EmptyState, PageHeader

### לוגיקה (lib/)
- `CrmStore.jsx` — store גלובלי ראשי ⚠️ blast radius רחב, זהירות
- `AuthStore.jsx` — משתמש נוכחי, הרשאות (can.*)
- `meetingHousesStorage.js` — CRUD בתי מפגש, deriveHouseStatus()
- `baseMeetingUtils.js` — buildBaseMeetingsFromHouses()
- `notificationDemo.js` — facade תאימות בזיכרון/דרך BFF לפעמון in-app. **לא שולח Push**
- `security/notification-delivery.mjs` — ⚠️ שרת בלבד: claim אטומי של outbox ושליחת Push גנרית
- `notifyApi.js` — עטיפות לקוח לקריאת endpoints ההתראות
- `aiDemo.js` — סיכומי AI דמו (משותף לדוחות ובתי מפגש שהסתיימו)
- `reminderSchedulerDemo.js`, `activistStats.js`, `paymentCalc.js`

### נתונים (data/)
- `contacts.js`, `interactions.js`, `activists.js`, `users.js`
- `base-meetings.js`, `config.js` (רמות מצוות), `projects.js`

### מוקים (mocks/)
- `mockMeetingHouses.js`, `mockExternalMeetingHouses.js`

## עיצוב וסגנון

### פלטת צבעים
- סגול ראשי: `#3a249b`
- סגול כהה: `#2a1870`
- סגול בהיר: `#6d4eca`
- רקע: `linear-gradient(160deg, #fbf7f1, #f8efe5, #f4e8dc)`

### ניווט — כללים קריטיים
⚠️ **הניווט נמצא ב-3 קבצים. פריט חדש חייב להיכנס לכל השלושה:**
1. `components/DesktopLayout.jsx` — `<NavItem href=... />` (סרגל צד, כל הדפים)
2. `pages/landing.jsx` — `<SideItem icon=... onClick={() => router.push(...)} />` (סרגל צד משוכפל)
3. `components/MobileBottomNav.jsx` — מערך `drawerItems` (מגירת "עוד" במובייל)

**במובייל הסרגל לא נראה כלל** — הוא מוחלף ב-`MobileBottomNav`. פריט שקיים רק בסרגל הוא
בלתי-נגיש לרוב הפעילים, שעובדים מהטלפון. (קרה בפועל ב-2026-07-21 עם עמוד `/feedback`:
ה-build עבר, הפריט הופיע בדסקטופ, ובמובייל פשוט לא היה מסלול לעמוד.)
- `mainItems` ב-`MobileBottomNav` = 4 הפריטים הקבועים בסרגל התחתון. פריט חדש הולך
  ל-`drawerItems`, לא ל-`mainItems`, אלא אם התבקש במפורש.
- לשמור על אותו סדר יחסי בשלוש הרשימות.

**התנהגות הסרגל:**
- overlay קבוע (position: fixed, z-index: 3000)
- רוחב: 64px מכווץ / 240px פתוח
- נפתח `onMouseEnter`, נסגר `onMouseLeave` — לכולם, ללא יוצא מן הכלל
- אייקונים: `lucide-react` (size: 18, strokeWidth: 1.8)

### קבצי עיצוב
- `styles/globals.css`, `styles/tokens.css`, `styles/components.css`

## לוגיקה עסקית חשובה

### התראות — ⚠️ הכלל הכי חשוב במערכת
**פעמון ≠ Push. אלה שני מנגנונים נפרדים, וקל מאוד לחשוב שהתראה "עובדת" כשהיא לא מגיעה לאף מכשיר.**

| | פעמון (in-app) | Push (טלפון/מחשב) |
|---|---|---|
| מה זה | שורה בטבלת `notifications` | web-push + FCM למכשיר |
| נכתב מ | RPC נגזר-משאב בלבד | **שרת בלבד** |
| דורש | — | `SUPABASE_SECRET_KEY` + VAPID/FCM secrets |

**כלל ברזל:** כל התראה עוברת דרך `app_enqueue_notification_event`, שמקבל סוג אירוע ומזהה
משאב בלבד, גוזר נמענים/תוכן/קישור במסד וכותב outbox אטומי. רק השרת רשאי לבצע
`app_claim_notification_delivery` ולשלוח WebPush/FCM. אין לכתוב `notifications` ישירות ואין
להעביר title/body/url/recipient מהלקוח או מ-cron.

**להוסיף מסלול התראה חדש:**
1. להוסיף event allowlisted ב-`app_enqueue_notification_event` עם lookup משאב והרשאה מפורשים
2. עטיפה ב-`lib/notifyApi.js`, וקריאה ממנה בדף — fire-and-forget
3. **אבטחה (חובה):** הלקוח שולח **מזהה בלבד**, לא טקסט ולא רשימת נמענים. ה-RPC קורא את
   השורה, מוודא בעלות ומרכיב את שורת הפעמון בעצמו. ראה `pages/api/interactions/notify.js`.
   ⚠️ **"מה-DB" ≠ "מאומת".** שדה שהמשתמש עצמו כותב (`contacts.name`, `mitzvot_history`,
   `notes`) הוא עדיין קלט שלו — קריאה שלו מהשרת לא הופכת אותו לבטוח. כל ערך כזה שנכנס
   לטקסט ההתראה חייב רשימה לבנה או חסם אורך, אחרת פעיל יכול לשגר טקסט חופשי כ-Push
   לכל צוות הניהול ולמנכ"ל. ראה `pages/api/mitzvot/notify.js` (`KNOWN_MITZVOT`).
4. פרטי העסק וה-deep-link נשארים בשורת הפעמון המאומתת. Payload מסך-הנעילה תמיד גנרי.

**`url` — לאן הלחיצה על ההתראה מובילה**
השדה `url` בשורת `notifications` הוא deep-link, לא קישוט. Push תמיד פותח `/notifications`
כדי לא לחשוף פרטי משאב על מסך הנעילה:

| מסלול | מי מטפל | הערה |
|---|---|---|
| פעמון in-app | `pages/notifications.jsx` → `router.push(n.link)` | |
| דפדפן / PWA | `public/sw.js` → `notificationclick` | פותח את מרכז ההתראות בלבד |
| אפליקציית אנדרואיד | `lib/nativePush.js` → `pushNotificationActionPerformed` | פותח את מרכז ההתראות בלבד |

- **לכוון לפריט, לא לרשימה:** `/contact/{id}`, `/meeting-houses/{id}`, `/tours?tour={id}` —
  לא `/contacts` או `/tours`. ההתראה אומרת "משהו קרה"; המשתמש רוצה לראות **מה**.
- **חריגים לגיטימיים** (יש כאלה — לא כל התראה מצביעה על פריט): פריט שנמחק, משתמש שהוסר
  מהשיבוץ ולכן הפריט מסונן מהרשימה שלו, והתראות-סיכום על כמה פריטים. ראה `api/tours/delete.js`
  ו-`api/tours/update.js` — שניהם מתעדים בהערה למה נשארו גנריים.
- `lib/nativePush.js` מנווט רק לנתיבים שמתחילים ב-`/`. כתובת מלאה ב-`url` פשוט לא תעבוד באפליקציה.
- האפליקציה טוענת את הווב מ-Vercel (`capacitor.config.json` → `server.url`), לכן תיקון JS
  כזה עולה לאוויר **בדיפלוי רגיל — בלי APK חדש ובלי Play Store**.

**מסלולים קיימים:** `api/tours/notify` (יצירת סיור) · `api/tours/report` (דיווח סיור) ·
`api/base-meetings/notify` (דיווח מפגש) · `api/interactions/notify` (סיכום AI + דיווח מזכה) ·
`api/push/send` (שיבוץ + הודעה יזומה, `requireWriteRole`) · `api/cron/*` (תזכורות).
`api/tours/report.js` מחזיק עדיין עותק משלו של לוגיקת הנמענים — לאחד אם נוגעים בו ממילא.

**RLS על `notifications` (0013):** SELECT/UPDATE רק לשורות של עצמך; INSERT פתוח בכוונה.
התראת broadcast (`user_id: null`) **לא נכתבת ל-Supabase כלל** — אל תשתמש בה.

**אבחון "לא מקבל התראות":** קודם כפתור "שלח התראת ניסיון" ב-`/notifications`. אם גם הוא לא
מגיע — הבעיה בתשתית (הרשאת דפדפן / אין מנוי ב-`push_subscriptions`/`fcm_tokens` / מפתחות
בפרודקשן), ולא בקוד המסלול. אי אפשר לאמת התראה לנמען אחר מהדפדפן — RLS מסתיר את שורותיו.

### מנוע התשלום (`lib/paymentCalc.js`) — שלושה כללים שקל לשבור
**1. הקצאת מכסה לפי ערך, לא לפי תאריך.** `comparePaymentOrder` (מחיר יורד → תאריך עולה
→ id עולה) הוא הסדר היחיד שבו מותר לעבד קשרים חודשיים. מיון כרונולוגי גורם לקשר זול
בתחילת החודש לתפוס משבצת מקשר יקר בסופו (דיווח אלעזר באום, 2026-07-31).
כל צרכן חייב להשתמש באותו comparator — `calcMonthlyPayment`, `getMonthlyTotalForActivist`,
`lib/activistStats.js`, והתצוגה המקדימה ב-`pages/contact/add-interaction/[id].jsx`.
אי-התאמה כאן = הטופס מזהיר "חרגת" על קשר שהמנוע כן משלם עליו.

**2. בונוס-מצוות אחד לכל אירוע-עליה, לא לכל רמה.** `deriveMitzvotBonuses` ב-`paymentCalc.js`
הוא **מקור-האמת היחיד** — `lib/CrmStore.jsx` ושלושת סקריפטי ה-`verify-*` צורכים אותו.
היה משוכפל בשלושה מקומות, ושינוי מדיניות באחד השאיר את השאר מדווחים סכום אחר.
קפיצה 0→4 בשמירה אחת = 600 ₪, לא 2,400. (דיווח מוטי גלעד, 2026-08-02.)
⚠️ **פורמט `bonus_key` לא משתנה** — `${activistId}|${type}|${contactId}|${monthKey}` עם
`monthKey` = `${year}-${month}` (month 0-indexed). יש שורות `bonus_cancellations` חיות בפורמט
הזה; שינוי הפורמט מחזיר לחיים בונוסים שכבר בוטלו.

**3. תקרה סופרת מפגשים ש*שולמו*, לא מפגשים שדווחו.** כל לולאה שקוראת ל-`calcInteractionPayment`
מצטברת `if (result.payable)` בלבד. אחרת קשר שנדחה על תקרת-הלקוח ממשיך לתפוס משבצת בתקרה
החודשית וחוסם מפגש מזכה אחר — הפעיל מפסיד כסף על דיווח שלא קיבל עליו אגורה. בשילוב עם
הקצאה-לפי-ערך זה יכול היה לשלם *פחות* מהסדר הכרונולוגי הישן.

**4. שורה נגזרת ממפגש רב-משתתפים אינה דיווח.** `isDerivedInteraction` (יש לה
`participants.derived_from`) — מוחרגת מכל תשלום, תקרה ובונוס, **וגם מכל מונה-תצוגה**
(`pages/index.jsx`, `my-activities`, `landing`, `activistStats`). בלי ההחרגה בתצוגה,
מפגש אחד עם 2 לקוחות נראה כ-3 דיווחים (דיווחי 28-30.7).

**כל שינוי במנוע:** `node scripts/verify-payment-order.cjs` (10 בדיקות, בלי DB), ואם השינוי
נוגע בכסף — גם `node scripts/compare-payment-impact.cjs <שנה> <חודש>` שמריץ את המנוע של
`main` ואת החדש על אותם נתוני אמת ומדפיס למי הסכום זז.

### טפסים — מנעול שליחה חובה
לטופס דיווח הקשר לא היה מנעול, והכפתור נשאר לחיץ לאורך כמה `await`. תוצאה בנתוני אמת:
6 קבוצות דיווחים כפולים, 10 שורות עודפות, 5 פעילים — כולן בהפרש 0.3–20 שניות. אחת מהן
מפגש רב-משתתפים ×3 = 900 ₪ במקום 300. **כל טופס שכותב ל-DB חייב `saving` + `disabled`,
ולא להציג "נשמר" לפני שהתקבל `{ error: null }`.** ב-`add-interaction` יש גם אישור-שכפול
(אותו לקוח+תאריך+סוג+איכות+תיאור → דורש לחיצה שנייה מודעת).
`scripts/find-duplicate-interactions.cjs` מאתר כפילויות קיימות; `--delete` מוחק אותן.

### בתי מפגש
- בית עובר ל-`completed` רק **7 ימים** אחרי תאריך המפגש הרביעי
- שיוך פעיל לבית → התראה + Push דרך `api/push/send` (`sendAssignmentPushApi`)
- `meetingHousesStorage.js` הוא מקור האמת לסטטוס

### דוחות בסיס (structured_answers)
שדות: `arrival_time`, `participant_count`, `gender_distribution`,
`religious_distribution`, `age_distribution`, `diversity_level`,
`facilitation_quality`, `facilitation_notes`, `atmosphere` (multi-select),
`group_progress`, `personal_connections_status`,
`personal_connections_notes` (חובה אם סטטוס = כן/בתהליך), `general_notes`
- תאימות לאחור: דוחות ישנים עם שדה `answers` (טקסט) עדיין נתמכים

### הרשאות (AuthStore — can.*)
- `can.seeMeetingHouses` — רכז, מנהל, מנכ"ל, כספים
- `can.addContact` — פעיל ומעלה
- `can.seeActivists` — ראש פרויקט ומעלה
- `can.seePayments` — כספים ומנכ"ל

### מצוות
- סולם 0-4 לפי מגדר
- הגדרות ב-`data/config.js` (CONFIG.mitzvotMale / CONFIG.mitzvotFemale)
- כל שדות המצוות חובה בהוספת לקוח

## חוזה Security Hardening — סביבת ריצה וסודות
- הדפדפן ניגש לנתונים רק דרך BFF באותו origin ומשתמש ב-session cookies אטומים. אין גישת
  Supabase ישירה מה-client, אין service-role בדפדפן ואין שמירת PII ב-`localStorage`.
- רק שמות שמתחילים ב-`NEXT_PUBLIC_` מותרים ב-client bundle. כל השאר, ובפרט
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, מפתחות session, cron, GitHub,
  Anthropic, VAPID, FCM ו-Sheets, הם server-only. `SUPABASE_SECRET_KEY` נשאר שם-תאימות
  ל-cron ישן בלבד ואסור לחשוף אותו לציבור.
- `.env.example` מגדיר שמות משתנים בלבד. לעולם אין להכניס ערכים אמיתיים, קבצי `.env`,
  מפתחות חתימה, service-account, דוחות שנוצרו, coverage או logs ל-Git.
- לפני commit מריצים `node scripts/security/scan-secrets.mjs --current --tracked` ואחרי
  build גם `node scripts/security/scan-client-bundle.mjs`. סקירת היסטוריה מתבצעת עם
  `node scripts/security/scan-secrets.mjs --history`; ממצא היסטורי מחייב בדיקה וסבב
  החלפה/ביטול אצל הספק. אין לבצע history rewrite בלי אישור מפורש.
- `android/app/google-services.json` הוא Firebase client config ציבורי, לא service account.
  יש להגביל את היישום לפי package name, חתימות SHA וה-API הרלוונטי במסוף Google/Firebase;
  אימות ההגבלות הוא gate חיצוני ואינו נפתר בהסתרת הקובץ.
- migrations `0018`–`0024` הן רצף Security Hardening ממתין. אין להריץ אותן אלא במסגרת G5
  מבוקרת, לפי הסדר וה-rollbacks המתועדים ב-`migrations/README.md`.
