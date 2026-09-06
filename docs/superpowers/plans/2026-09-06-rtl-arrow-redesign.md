# עיצוב מחדש של חצי-ניווט RTL — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** קומפוננטה אחת (`BackLink`) מחליפה את כל 15 המופעים של חצי-טקסט (←/→) בתבנית חזרה/צפייה, עם כיוון-חץ נכון ל-RTL (אומת אמפירית — ראה ספק); + חץ מותאם ל-9 קבצים עם `<select>` טבעי. לפי `docs/superpowers/specs/2026-09-06-rtl-arrow-redesign-design.md` והארטיפקט המאושר: https://claude.ai/code/artifact/e4556db3-93bd-4872-93f0-80b0e6f1bc2d

**Architecture:** `components/ui/BackLink.jsx` — קומפוננטה אחת, `direction="back"|"forward"` קובע כיוון-גליף+מיקום (שני צירים נפרדים: `variant` קובע עיצוב buttonlike/linklike, `direction` קובע איזה צד האייקון + לאן הוא מצביע). CSS ב-`styles/components.css`, לא inline — תואם לדפוס `.btn` הקיים. `<select>` מקבל `appearance:none` + אותו chevron כ-`background-image`.

**Tech Stack:** Next.js Pages Router, CSS גלובלי (`styles/components.css`), אין framework בדיקות ל-UI — בדיקה ידנית מול dev server + `npm run build`.

## Global Constraints

- **כלל הכיוון (קבוע, לא לשנות):** `direction="back"` → אייקון **לפני** הטקסט (קצה ימין ב-RTL), **לא ממוראר** (מצביע ימינה). `direction="forward"` → אייקון **אחרי** הטקסט (קצה שמאל), **ממוראר** (`scaleX(-1)`, מצביע שמאלה). אומת אמפירית ב-3 סבבי מדידת-פיקסלים בזמן העיצוב (`getScreenCTM`) — לא לשנות בלי לחזור על אותה בדיקה.
- כל הצבעים/ריווח/רדיוס מגיעים מ-`styles/tokens.css` הקיים (`var(--color-brand-primary)` וכו') — לא לקודד ערכים חדשים.
- אחרי כל שינוי: `npm run build` נקי.
- לא בונים dark mode לאפליקציה עצמה.

---

## File Structure

- **Create** `components/ui/BackLink.jsx` — הקומפוננטה.
- **Modify** `styles/components.css` — CSS ל-`BackLink` + ל-`<select>`.
- **Modify** `components/DesktopLayout.jsx` — משתמש ב-`BackLink` במקום הכפתור הקיים.
- **Modify** 9 קבצים — `backLabel` בלי חץ-טקסט (ראה טבלה, Task 2).
- **Modify** 7 קבצים — קישור "צפייה" עובר ל-`<BackLink direction="forward">` (ראה טבלה, Task 3).
- **Modify** 3 קבצים — קישורים אד-הוק (Task 4).
- **Modify** 9 קבצים עם `<select>` (Task 5).

---

### Task 1: `components/ui/BackLink.jsx` + CSS

**Files:**
- Create: `components/ui/BackLink.jsx`
- Modify: `styles/components.css`

**Interfaces:**
- Produces: `<BackLink href={string} direction="back"|"forward" variant?="button"|"link" style?={object}>{children}</BackLink>`. ברירת מחדל: `direction="back"` → `variant="button"`; `direction="forward"` → `variant="link"` (ניתן לדרוס עם `variant` מפורש, למשל לקישורים אד-הוקיים ב-Task 4 שצריכים רקע שונה).

- [ ] **Step 1: כתוב את הקומפוננטה**

```jsx
// components/ui/BackLink.jsx — קישור חזרה/צפייה עם אייקון SVG אמיתי, לא תו-טקסט.
// כלל הכיוון (RTL, אומת אמפירית — ראה docs/superpowers/specs/2026-09-06-rtl-arrow-redesign-design.md):
// "back" (חזרה) = אייקון לפני הטקסט, לא ממוראר, מצביע ימינה — בדיוק כמו כפתור Back ב-iOS/
// אנדרואיד בעברית. "forward" (צפייה/המשך) = אייקון אחרי הטקסט, ממוראר, מצביע שמאלה.
import Link from 'next/link';

function Chevron() {
  return (
    <svg className="chevron" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export default function BackLink({ href, direction = 'back', variant, children, style }) {
  const isBack = direction === 'back';
  const resolvedVariant = variant || (isBack ? 'button' : 'link');
  const variantClass = resolvedVariant === 'button' ? 'backlink-button' : 'backlink-link';
  const directionClass = isBack ? 'backlink-back' : 'backlink-forward';
  return (
    <Link href={href} className={`${variantClass} ${directionClass}`} style={style}>
      {isBack && <Chevron />}
      {children}
      {!isBack && <Chevron />}
    </Link>
  );
}
```

- [ ] **Step 2: הוסף CSS ל-`styles/components.css`**

הוסף בסוף הקובץ:

```css
/* ── BackLink (components/ui/BackLink.jsx) ───────────────────────────────
   direction קובע כיוון-גליף + איזה צד (לא variant — buttonlike ולinklike
   יכולים לשאת כל כיוון, למשל קישור אד-הוק עם variant="link" ו-direction="back"). */
.backlink-button, .backlink-link {
  display: inline-flex; align-items: center; font-family: inherit; text-decoration: none; cursor: pointer;
}
.backlink-button {
  gap: 6px; padding: 7px 14px 7px 16px; border-radius: var(--radius-full);
  border: 1px solid transparent; background: var(--color-bg-white);
  color: var(--color-brand-primary); font-size: 13.5px; font-weight: 600;
  box-shadow: var(--shadow-xs);
  transition: background var(--motion-fast), box-shadow var(--motion-fast), border-color var(--motion-fast);
}
.backlink-button:hover, .backlink-button:focus-visible {
  background: var(--color-brand-light); border-color: var(--color-brand-primary); box-shadow: var(--shadow-brand);
}
.backlink-link {
  gap: 4px; color: var(--color-text-muted); font-size: 13.5px; font-weight: 500;
  transition: color var(--motion-fast);
}
.backlink-link:hover, .backlink-link:focus-visible { color: var(--color-brand-primary); }
.backlink-button .chevron, .backlink-link .chevron { flex-shrink: 0; transition: transform var(--motion-fast); }
.backlink-forward .chevron { transform: scaleX(-1); }
.backlink-back:hover .chevron, .backlink-back:focus-visible .chevron { transform: translateX(3px); }
.backlink-forward:hover .chevron, .backlink-forward:focus-visible .chevron { transform: scaleX(-1) translateX(3px); }
```

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות (הקומפוננטה עדיין לא בשימוש בשום מקום — רק מוודאים שהיא מתקמפלת).

- [ ] **Step 4: Commit**

```bash
git add components/ui/BackLink.jsx styles/components.css
git commit -m "feat: add BackLink component with correct RTL arrow direction"
```

---

### Task 2: `DesktopLayout.jsx` + 9 קבצים — כפתור-חזרה ראשי

**Files:**
- Modify: `components/DesktopLayout.jsx:286-294`
- Modify: 9 קבצים (טבלה למטה)

**Interfaces:**
- Consumes: `BackLink` מ-Task 1.
- Produces: `<DesktopLayout backHref backLabel>` **אותה חתימה בדיוק** כלפי חוץ — אף call-site לא צריך לדעת ש-`DesktopLayout` עבר ל-`BackLink` פנימית. **אבל** `backLabel` חייב מעכשיו להיות **בלי חץ-טקסט** (הקומפוננטה מוסיפה אותו) — זה כן דורש עריכה בכל אחד מ-9 הקוראים.

- [ ] **Step 1: עדכן את `components/DesktopLayout.jsx` (שורות 286-294)**

מצא (שורות 286-294 בדיוק):
```jsx
            {backHref && (
              <Link href={backHref} style={{ textDecoration: 'none' }}>
                <button style={{ padding: '6px 14px', borderRadius: 10, border: '1.5px solid #e8e8e8', background: '#fff', color: '#6c5ce7', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo, sans-serif', transition: 'all 0.18s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f0effe'; e.currentTarget.style.borderColor = '#6c5ce7'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e8e8e8'; }}>
                  {backLabel || '← חזרה'}
                </button>
              </Link>
            )}
```
שנה ל:
```jsx
            {backHref && <BackLink href={backHref} direction="back">{backLabel || 'חזרה'}</BackLink>}
```
והוסף import בראש הקובץ: `import BackLink from './ui/BackLink';`

- [ ] **Step 2: עדכן את 9 המחרוזות — הסר את החץ**

לכל קובץ, מצא את המחרוזת המדויקת (עמודה שמאלית) והחלף במחרוזת בלי חץ (עמודה ימנית) — **אין שינוי אחר בשורה, רק תוכן המחרוזת**:

| קובץ:שורה | לפני | אחרי |
|---|---|---|
| `pages/former-contacts.jsx:26` | `backLabel="← חזרה ללקוחות"` | `backLabel="חזרה ללקוחות"` |
| `pages/contacts/add.jsx:192` | `backLabel="← חזרה ללקוחות"` | `backLabel="חזרה ללקוחות"` |
| `pages/payments/[id].jsx:97` | `backLabel="← חזרה לתשלומים"` | `backLabel="חזרה לתשלומים"` |
| `pages/payments/[id].jsx:106` | `backLabel="← חזרה לתשלומים"` | `backLabel="חזרה לתשלומים"` |
| `pages/payments/[id].jsx:112` | `backLabel="← חזרה לתשלומים"` | `backLabel="חזרה לתשלומים"` |
| `pages/contact/add-interaction/[id].jsx:89` | `backLabel="← חזרה"` | `backLabel="חזרה"` |
| `pages/contact/add-interaction/[id].jsx:546` | `backLabel="← חזרה"` | `backLabel="חזרה"` |
| `pages/contact/update-mitzvot/[id].jsx:71` | `backLabel="חזרה ←"` | `backLabel="חזרה"` |
| `pages/meeting-houses/[id].jsx:76` | `backLabel="חזרה לבתי מפגש"` | (ללא שינוי — אין חץ) |
| `pages/meeting-houses/[id].jsx:189` | `'חזרה לבתי מפגש שהסתיימו' : 'חזרה לבתי מפגש חדשים'` | (ללא שינוי — אין חץ) |
| `pages/meeting-houses/new.jsx:105` | `backLabel="חזרה לבתי מפגש"` | (ללא שינוי — אין חץ) |

עבור `pages/activists/[id].jsx:121` ו-`pages/contact/[id].jsx:213-218 (זזו מ-193-198 עקב תוכנית 1)` — אלה טרנרים בני כמה ענפים, לא מחרוזת יחידה. הסר את `'← '` מתחילת **כל** ענף:

`pages/activists/[id].jsx:121`:
```js
  const backLabel = from === 'contact-detail' && contactId ? '← חזרה ללקוח' : '← חזרה לפעילים';
```
ל:
```js
  const backLabel = from === 'contact-detail' && contactId ? 'חזרה ללקוח' : 'חזרה לפעילים';
```

`pages/contact/[id].jsx:213-218 (זזו מ-193-198 עקב תוכנית 1)`:
```js
  const backLabel = from === 'activist' && activistId ? '← חזרה לפעיל'
                  : from === 'landing'                 ? '← חזרה למרכז הפעילות'
                  : from === 'personal'                ? '← חזרה לאזור האישי'
                  : from === 'reminders'               ? '← חזרה לתזכורות'
                  : from === 'former'                  ? '← חזרה ללקוחות לשעבר'
                  : '← חזרה ללקוחות';
```
ל:
```js
  const backLabel = from === 'activist' && activistId ? 'חזרה לפעיל'
                  : from === 'landing'                 ? 'חזרה למרכז הפעילות'
                  : from === 'personal'                ? 'חזרה לאזור האישי'
                  : from === 'reminders'               ? 'חזרה לתזכורות'
                  : from === 'former'                  ? 'חזרה ללקוחות לשעבר'
                  : 'חזרה ללקוחות';
```

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 4: בדיקה ידנית**

`npm run dev` — פתח כל אחד מ-11 הדפים (9 מהטבלה + 2 מהטרנרים) ווודא: הכפתור מוצג כ-פיל'ז עם אייקון SVG (לא תו טקסט), האייקון בקצה ימין, מצביע ימינה, נודד קלות בהובר.

- [ ] **Step 5: Commit**

```bash
git add components/DesktopLayout.jsx pages/former-contacts.jsx pages/contacts/add.jsx "pages/payments/[id].jsx" "pages/contact/add-interaction/[id].jsx" "pages/contact/update-mitzvot/[id].jsx" "pages/activists/[id].jsx" "pages/contact/[id].jsx"
git commit -m "feat: replace back-button text arrows with BackLink component"
```

---

### Task 3: 7 קבצים — קישור "צפייה" (שורתי)

**Files:** ראה טבלה.

**Interfaces:**
- Consumes: `BackLink` מ-Task 1, `direction="forward"`.

⚠️ **זה גם שינוי ויזואלי, לא רק תיקון-חץ:** כל 7 המופעים משתמשים היום ב-`className="btn btn-primary"` — כפתור-פיל'ז מלא, בולט. `BackLink direction="forward"` (ברירת מחדל `variant="link"`) הוא **שקט**, בלי מסגרת/רקע — בהשראת `linear.app/changelog` (אושר בארטיפקט). זו ירידה מכוונת בבולטות הוויזואלית של הקישורים האלה, לא רק החלפת סמל.

| קובץ:שורה | לפני | אחרי |
|---|---|---|
| `components/ActivistCard.jsx:53` | `<Link href={...} className="btn btn-primary">צפייה בפרופיל ←</Link>` | `<BackLink href={...} direction="forward">צפייה בפרופיל</BackLink>` |
| `pages/activists.jsx:172` | `<Link href={...} className="btn btn-primary">צפייה ←</Link>` | `<BackLink href={...} direction="forward">צפייה</BackLink>` |
| `pages/activists/[id].jsx:243` | `<Link href={...} className="btn btn-primary" style={{...}}>צפייה ←</Link>` | `<BackLink href={...} direction="forward">צפייה</BackLink>` (הסר את ה-`style` הישן — `BackLink` כבר קובע `font-size`/`padding` משלו) |
| `pages/contacts.jsx:277` | `<Link href={...} className="btn btn-primary">צפייה →</Link>` | `<BackLink href={...} direction="forward">צפייה</BackLink>` |
| `components/ContactCard.jsx:53` | `<Link href={...} className="btn btn-primary">צפייה</Link>` (בלי חץ) | `<BackLink href={...} direction="forward">צפייה</BackLink>` |
| `pages/former-contacts.jsx:63` | `<Link href={...} className="btn btn-primary">צפייה</Link>` | `<BackLink href={...} direction="forward">צפייה</BackLink>` |
| `pages/contact/update-mitzvot/[id].jsx:65` | `<Link href={...} className="btn btn-primary">חזרה לפרופיל</Link>` | `<BackLink href={...} direction="back">חזרה לפרופיל</BackLink>` (⚠️ זו בפועל פעולת-**חזרה**, לא צפייה-קדימה — למרות המיקום ברשימת "קישורי צפייה" בחקירה המקורית. `direction="back"` נכון כאן, לא `forward`.) |

- [ ] **Step 1: קרא את כל 7 השורות המדויקות (עם 3-5 שורות הקשר סביב כל אחת) לפני העריכה**

השמות/props המדויקים של `href` בכל קובץ לא תועדו כאן במלואם (רק תוכן ה-`children`/`className`) — ודא שאתה משמר את ה-`href` המקורי בכל שורה, רק מחליף את ה-`<Link className="btn btn-primary">...</Link>` ב-`<BackLink href={...same href...} direction="...">...</BackLink>`. הוסף `import BackLink from '.../ui/BackLink';` (נתיב יחסי מתאים לכל קובץ) בכל אחד מ-7 הקבצים.

- [ ] **Step 2: בצע את ההחלפות לפי הטבלה**

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 4: בדיקה ידנית**

פתח `/contacts`, `/activists`, פרופיל פעיל, פרופיל לקוח-לשעבר — ודא שקישורי "צפייה" מוצגים שקטים (בלי מסגרת), עם אייקון בקצה שמאל מצביע שמאלה, נודד בהובר, והניווט עצמו עדיין עובד (לוחצים ומגיעים לדף הנכון).

- [ ] **Step 5: Commit**

```bash
git add components/ActivistCard.jsx pages/activists.jsx "pages/activists/[id].jsx" pages/contacts.jsx components/ContactCard.jsx pages/former-contacts.jsx "pages/contact/update-mitzvot/[id].jsx"
git commit -m "feat: replace view-link text arrows with BackLink component"
```

---

### Task 4: 3 קבצים — קישורים אד-הוק

**Files:** ראה פירוט.

⚠️ שלושת אלה שומרים על **הרקע/צבע הייחודי** שלהם (למשל רקע כהה על באנר סגול) — משתמשים ב-`variant` + `style` מפורשים במקום ברירת המחדל, לא בעיצוב ה-`backlink-link` השקט הרגיל (שלא יתאים על רקע כהה).

- [ ] **Step 1: `pages/payments/[id].jsx:122-124`**

מצא:
```jsx
<Link href={`/activists/${activist.id}`} style={{ color:'#fff', fontSize:12, fontWeight:700, textDecoration:'none', background:'rgba(255,255,255,0.18)', borderRadius:10, padding:'8px 14px' }}>
  לפרופיל הפעיל ←
</Link>
```
שנה ל:
```jsx
<BackLink href={`/activists/${activist.id}`} direction="forward" variant="link"
  style={{ color:'#fff', background:'rgba(255,255,255,0.18)', borderRadius:10, padding:'8px 14px' }}>
  לפרופיל הפעיל
</BackLink>
```
הוסף import: `import BackLink from '../../components/ui/BackLink';`

- [ ] **Step 2: `pages/contact/[id].jsx:289-294` (זזו מ-258-263 עקב תוכנית 1)**

מצא:
```jsx
<Link href={`/activists/${owner.id}?from=contact-detail&contactId=${contact.id}`} style={{ color: '#534ab7', textDecoration: 'none', fontWeight: 500 }}>
  {owner.name} ←
</Link>
```
שנה ל:
```jsx
<BackLink href={`/activists/${owner.id}?from=contact-detail&contactId=${contact.id}`} direction="forward" variant="link" style={{ color: '#534ab7' }}>
  {owner.name}
</BackLink>
```
(import כבר קיים בקובץ הזה מ-Task 2/6 בתוכניות אחרות — ודא שלא כפול.)

- [ ] **Step 3: `pages/meeting-houses/completed.jsx:224-226`**

מצא:
```jsx
<Link href={`/meeting-houses/${house.id}`} style={{ color: '#6c5ce7', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
  לדף הבית מפגש המלא →
</Link>
```
שנה ל:
```jsx
<BackLink href={`/meeting-houses/${house.id}`} direction="forward" variant="link" style={{ color: '#6c5ce7', fontSize: 12, fontWeight: 600 }}>
  לדף הבית מפגש המלא
</BackLink>
```
הוסף import: `import BackLink from '../../components/ui/BackLink';`

- [ ] **Step 4: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 5: Commit**

```bash
git add "pages/payments/[id].jsx" "pages/contact/[id].jsx" pages/meeting-houses/completed.jsx
git commit -m "feat: replace ad-hoc arrow links with BackLink component"
```

---

### Task 5: `<select>` — חץ מותאם

**Files:**
- Modify: `styles/components.css` (חיפוש `.form-input` הקיים)
- Modify: קבצי `<select>` עם style אינליין (יזוהו ב-Step 1)

**Interfaces:**
- Produces: כל `<select>` עם `className="form-input"` מקבל את החץ החדש אוטומטית דרך ה-CSS. `<select>`-ים עם style אינליין ייחודי צריכים תוספת ידנית לכל אחד.

- [ ] **Step 1: זהה אילו מ-9 הקבצים משתמשים ב-`form-input` מול style אינליין**

Run:
```bash
grep -n "<select" pages/my-dashboard.jsx pages/payments.jsx "pages/contact/update-mitzvot/[id].jsx" "pages/contact/add-interaction/[id].jsx" pages/tours.jsx pages/base-meetings.jsx "pages/contact/[id].jsx" pages/meeting-houses/index.jsx pages/contacts/add.jsx
```
לכל תוצאה: אם יש `className="form-input"` (או דומה) — לא צריך שינוי פרטני, ה-CSS ב-Step 2 מכסה אותו. אם יש `style={{...}}` בלבד (בלי `form-input`) — רשום את הקובץ:שורה לרשימה נפרדת לטיפול ב-Step 3.

- [ ] **Step 2: הוסף CSS לחץ מותאם על `.form-input` מסוג select**

מצא את הגדרת `.form-input` הקיימת ב-`styles/components.css` (או `styles/globals.css` — איפה שהיא בפועל, `grep -n "\.form-input" styles/*.css` לפני העריכה). הוסף מיד אחריה:

```css
select.form-input {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: left 10px center;
  padding-left: 30px;
}
```
(חץ פונה מטה, `polyline points="6 9 12 15 18 9"` — אותו סגנון SVG כמו `BackLink`, זווית שונה. `%23` = `#` מקודד ל-data URI.)

- [ ] **Step 3: טפל בכל select עם style אינליין בנפרד (מ-Step 1)**

לכל קובץ:שורה שזוהה — קרא את ה-style האינליין המדויק, והוסף לתוכו את אותם 5 מאפיינים מ-Step 2 (`appearance`, `WebkitAppearance`, `backgroundImage` עם אותו data URI, `backgroundRepeat`, `backgroundPosition`, `paddingLeft`) בתוך אובייקט ה-`style` הקיים (לא להחליף את שאר המאפיינים כמו `border`/`borderRadius`/`fontSize` שכבר שם).

- [ ] **Step 4: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 5: בדיקה ידנית**

פתח את `pages/contacts/add.jsx` (יש בו 2 selects, אחד עם `form-input` ואחד עם style אינליין ייחודי — ראה חקירה מקורית) וודא ששניהם מציגים חץ-כלפי-מטה עקבי, לא חץ-ברירת-מחדל של הדפדפן.

- [ ] **Step 6: Commit**

```bash
git add styles/components.css pages/my-dashboard.jsx pages/payments.jsx "pages/contact/update-mitzvot/[id].jsx" "pages/contact/add-interaction/[id].jsx" pages/tours.jsx pages/base-meetings.jsx "pages/contact/[id].jsx" pages/meeting-houses/index.jsx pages/contacts/add.jsx
git commit -m "feat: replace native select browser arrow with custom chevron"
```
