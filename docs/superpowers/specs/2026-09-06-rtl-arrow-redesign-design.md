# עיצוב מחדש של חצי-ניווט RTL — מפרט תכנון

## מטרה

נדב לא אוהב את חצי-הטקסט (←/→) שמופיעים בעוד המון מקומות באפליקציה, ומבקש להחליף אותם בלחצן מעוצב יפה, בהשראת אתרים מובילים. בדיקה חשפה שזו לא רק שאלת-יופי — בחלק מהמקומות **החץ מצביע לכיוון ההפוך** מהמוסכמה הנכונה ל-RTL.

## החלטה שאושרה בשיחה

היקף: **כל חץ באפליקציה** — גם קישורי טקסט (← →) וגם אייקונים, לא רק תבנית-החזרה שבתמונות שנדב שלח.

## ממצאי חקירה (אומתו בקוד + מדידת-פיקסלים אמפירית בדפדפן)

### א. חצי-טקסט (←/→) — 15 קבצים, 3 דפוסים

ראו טבלה מלאה ב[ארטיפקט שפורסם](https://claude.ai/code/artifact/e4556db3-93bd-4872-93f0-80b0e6f1bc2d) (נשלח לנדב, מכיל את כל הרשימה + הדגמה חיה):

1. **`DesktopLayout` backHref/backLabel** (`components/DesktopLayout.jsx:286-294`) — 9 קבצים: `former-contacts.jsx:26`, `contacts/add.jsx:192`, `payments/[id].jsx:97,106,112`, `contact/add-interaction/[id].jsx:89,546`, `activists/[id].jsx:121`, `contact/[id].jsx:193-198`, `meeting-houses/[id].jsx:76,189`, `meeting-houses/new.jsx:105`, `update-mitzvot/[id].jsx:71`.
2. **מחלקת `.btn` / קישור "צפייה"** — 7 קבצים: `ActivistCard.jsx:53`, `activists.jsx:172`, `activists/[id].jsx:243`, `contacts.jsx:277`, `ContactCard.jsx:53`, `former-contacts.jsx:63`, `update-mitzvot/[id].jsx:65`.
3. **style אינליין אד-הוק** — 3 קבצים: `payments/[id].jsx:122-124`, `contact/[id].jsx:258-263`, `meeting-houses/completed.jsx:224-226`.

⚠️ **הכלל שגילינו (קריטי לתיקון):** ב-JS string בודד בתוך container עם `dir="rtl"`, מיקום החץ (ימין/שמאל) נקבע **אך ורק** לפי סדר-המקור (prefix→קצה ימין, suffix→קצה שמאל) — **לא** לפי כיוון הגליף עצמו. אומת אמפירית ב-3 סבבי מדידה נפרדים (`getBoundingClientRect`/`getScreenCTM`, לא ניחוש חזותי — הוכחתי לעצמי טעות סימן פעמיים תוך כדי). המשמעות המעשית: ברוב הקבצים (`'← [טקסט]'`, prefix) החץ **כן** יושב בקצה הנכון (ימין, קצה-מוביל ב-RTL) — אבל **מצביע לכיוון הלא-נכון** (שמאלה, פנימה לתוך הכפתור, במקום החוצה). המוסכמה הנכונה (זהה ל-Back ב-iOS/אנדרואיד בעברית): **"חזרה" מצביע ימינה, "צפייה/קדימה" מצביע שמאלה.**

### ב. אייקונים — נבדק, אין בכלל

חיפשתי כל import מ-`lucide-react` בפרויקט (5 קבצים בסך הכול: `DesktopLayout.jsx`, `MobileBottomNav.jsx`, `landing.jsx`, `interaction-report.jsx`, `VoiceInput.jsx`). **אף אחד מהם לא מייבא Chevron/Arrow/Move/Corner** — כל האייקונים הם אייקוני-קטגוריה (Home, Bell, Star וכו') לתפריט הצד. גם אין שום CSS triangle-hack (`border: transparent` trick) בשום מקום. **המסקנה: אין אף חץ-אייקון מותאם-אישית באפליקציה כיום.**

### ג. חצי `<select>` טבעיים — 9 קבצים, זו התוספת האמיתית

`grep <select>` מצא 9 קבצים: `my-dashboard.jsx`, `payments.jsx`, `update-mitzvot/[id].jsx`, `add-interaction/[id].jsx`, `tours.jsx`, `base-meetings.jsx`, `contact/[id].jsx`, `meeting-houses/index.jsx`, `contacts/add.jsx`. רובם עם מחלקה משותפת `form-input` (למשל `contacts/add.jsx:328`), חלק עם style אינליין ייחודי (`contacts/add.jsx:369`). לחץ ברירת-המחדל של `<select>` הוא **חץ-הדפדפן**, לא טקסט ולא SVG — תיקון אחר מסוג: אי אפשר לשים React child בתוך `<select>`, צריך `appearance: none` + חץ מוזרק כ-`background-image` (SVG כ-data URI).

## ארכיטקטורה — 3 חלקים

### 1. `components/ui/BackLink.jsx` (חדש) — מחליף את דפוסים א' ו-ב'

קומפוננטה אחת, שני וריאנטים (`variant="button" | "link"`), אייקון SVG אמיתי (lucide `ChevronRight`/`ChevronLeft` בפועל — לא polyline ידני כמו בדמו) ב-`currentColor`. logic הכיוון קבוע בקומפוננטה עצמה — קורא לא בוחר גליף/מיקום ידנית, רק `direction="back" | "forward"`:

```jsx
// direction="back": אייקון ChevronRight, כ-DOM ראשון (קצה ימין), variant="button" ברירת מחדל
// direction="forward": אייקון ChevronLeft, כ-DOM אחרון (קצה שמאל), variant="link" ברירת מחדל
<BackLink href="/contacts" direction="back">חזרה ללקוחות</BackLink>
<BackLink href={`/activists/${id}`} direction="forward" variant="link">צפייה בפרופיל</BackLink>
```

עיצוב מדויק (מהארטיפקט המאושר): `variant="button"` = פיל'ז לבן, `border-radius: var(--radius-full)`, `box-shadow: var(--shadow-sm)`, טקסט `var(--color-brand-primary)` 13.5px/600; הובר: `var(--color-brand-light)` + `var(--shadow-brand)` + האייקון נודד 3px לכיוון-ההצבעה שלו. `variant="link"` = בלי מסגרת/רקע, טקסט `var(--color-text-muted)` 13.5px/500 שהופך ל-`var(--color-brand-primary)` בהובר בלבד (בהשראת קישור ה-back ב-`linear.app/changelog`: flex, gap 4px, אייקון 15px, לא צועק כברירת מחדל).

**כל 16 המופעים (9+7) עוברים ל-`<BackLink>`.** ל-3 המופעים האד-הוקיים (חלק ג' בחקירה) — אותו דבר, `variant="link"` עם ה-style הספציפי שלהם (צבע/רקע שונה) מועבר כ-`className`/`style` נוסף אם צריך לשמר הבדל ויזואלי מכוון (כמו הרקע הכהה ב-`payments/[id].jsx:122`).

### 2. עדכון `.form-input[type=select]` / select styling — חלק ג'

ב-`styles/components.css` (או המקום שבו `.form-input` מוגדר): הוספת
```css
select.form-input, select[style] /* אלה עם style אינליין */ {
  appearance: none;
  background-image: url("data:image/svg+xml,..."); /* אותו chevron-down, muted */
  background-repeat: no-repeat;
  background-position: left 12px center; /* RTL: תמיד בצד שמאל של השדה */
  padding-left: 32px; /* מקום לאייקון */
}
```
⚠️ ה-`<select>`-ים עם style אינליין ייחודי (כמו `contacts/add.jsx:369`) צריכים את אותה תוספת ידנית בכל אחד — לא עוברים דרך מחלקה משותפת. רשימה מדויקת תיכתב בתוכנית המימוש אחרי סריקה נוספת של כל 9 הקבצים לזיהוי אילו מהם ad-hoc.

### 3. בדיקות

- `npm run build` נקי.
- בדיקה ויזואלית ידנית (dev server, לא production — אין login זמין לבדיקה הזאת) בכל אחד מ-3 סוגי-המופעים אחרי ההחלפה: כפתור-חזרה, קישור-צפייה, select.
- בדיקת light+dark אם רלוונטי (לאפליקציה עצמה אין dark mode היום — לא נדרש).

## מחוץ להיקף

- לא בונים dark mode לאפליקציה עצמה (רק לארטיפקט-ההדגמה היה dark מטעמי כללי-Artifact).
- לא נוגעים בעיצוב הסרגל הצדדי/האייקונים הקטגוריאליים (Home, Bell וכו') — אלה לא "חצי ניווט", לא רלוונטיים לבקשה.
