# מקרבים — CRM אחדות יהודית

## מה הפרויקט
מערכת CRM לניהול פעילים, לקוחות ובתי מפגש עבור ארגון "אחדות יהודית".
Next.js 14, Pages Router, RTL עברית, localStorage בלבד (אין backend).

## כללי עבודה — חובה לפני כל שינוי
1. קרא את הקובץ הרלוונטי לפני כל עריכה
2. אחרי כל שינוי: הרץ `npm run build`
3. דווח שגיאות מדויקות אם יש
4. אם הדף קורס: `rm -rf .next` ואז `npm run dev`

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
- `notifications.jsx` — התראות
- `payments.jsx` — תשלומים
- `reminders.jsx` — תזכורות
- `today.jsx` — פעולות היום
- `chat.jsx` — צ'אט פעילים

### קומפוננטים (components/)
- `DesktopLayout.jsx` — לייאאוט ראשי + סרגל צד לכל הדפים חוץ מ-landing
- `ContactCard.jsx`, `ActivistCard.jsx`, `FilterChips.jsx`, `StatusBadge.jsx`
- `ui/` — AppButton, AppCard, AppInput, AppBadge, EmptyState, PageHeader

### לוגיקה (lib/)
- `CrmStore.jsx` — store גלובלי ראשי ⚠️ blast radius רחב, זהירות
- `AuthStore.jsx` — משתמש נוכחי, הרשאות (can.*)
- `meetingHousesStorage.js` — CRUD בתי מפגש, deriveHouseStatus()
- `baseMeetingUtils.js` — buildBaseMeetingsFromHouses()
- `notificationDemo.js` — התראות in-app, localStorage
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

### סרגל הצד — כללים קריטיים
- **נמצא ב-2 מקומות**: `components/DesktopLayout.jsx` וגם `pages/landing.jsx`
- כל שינוי בסרגל חייב להיות בשני הקבצים
- overlay קבוע (position: fixed, z-index: 3000)
- רוחב: 64px מכווץ / 240px פתוח
- נפתח `onMouseEnter`, נסגר `onMouseLeave` — לכולם, ללא יוצא מן הכלל
- אייקונים: `lucide-react` (size: 18, strokeWidth: 1.8)

### קבצי עיצוב
- `styles/globals.css`, `styles/tokens.css`, `styles/components.css`

## לוגיקה עסקית חשובה

### בתי מפגש
- בית עובר ל-`completed` רק **7 ימים** אחרי תאריך המפגש הרביעי
- שיוך פעיל לבית → יוצר התראה אוטומטית דרך `notificationDemo`
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

## משתמשי דמו
- מנכ"ל: `ceo / ceo123`
- רכז: `coord1 / coord123`
- פעיל: `activist1 / activist123`
