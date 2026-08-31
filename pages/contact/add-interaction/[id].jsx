// pages/contact/add-interaction/[id].jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../../data/config';
import { useCrm } from '../../../lib/CrmStore';
import { useAuth } from '../../../lib/AuthStore';
import { calcInteractionPayment, paidBefore, buildContactContext, PAID_PROJECT_IDS } from '../../../lib/paymentCalc';
import DesktopLayout from '../../../components/DesktopLayout';
import { summarizeInteractionText } from '../../../lib/aiService';
import { createPaymentInteractionNotifications, createDemoNotification } from '../../../lib/notificationDemo';
import { notifyInteractionApi } from '../../../lib/notifyApi';
import VoiceInput from '../../../components/VoiceInput';
import ClientSearchSelect from '../../../components/ClientSearchSelect';

const TODAY = new Date().toISOString().split('T')[0];

// הוספת ימים לתאריך ISO (YYYY-MM-DD) בלי להיגרר לאזור-זמן: בונים את התאריך מחלקיו
// ולא מ-new Date(iso), שמתפרש כ-UTC וקופץ יום אחורה בישראל.
function addDaysIso(iso, days) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const EMPTY = {
  type: '', quality: '', outcome: 'חיובי', date: TODAY,
  long_enough: null,
  notes: '', description: '', ai_summary: '',
  // ברירת מחדל: שבוע מהיום. מתעדכנת אוטומטית כשמשנים את תאריך הקשר (setDate).
  next_action: '', next_action_date: addDaysIso(TODAY, 7),
  // אופי הדיווח — שלושה מצבים בלעדיים, ר' setReportKind. 'single' = קשר עם לקוח בודד
  // (ברירת המחדל, מקביל ל-multi:false הישן), 'multi' = מפגש רב משתתפים, 'brief' = קשר קצרצר.
  reportKind: 'single', participant_count: '', // מפגש רב משתתפים — קומפוננטה נפרדת
  contact_method: '', // אמצעי קשר — למצב 'brief' בלבד (dropdown יחיד, ר' CONFIG.contactMethods)
  participant_clients: [], participant_external: [], // שמות משתתפים — רב משתתפים (עדכונים אימיוטביליים בלבד!)
};

export default function AddInteractionPage() {
  const router    = useRouter();
  const { id }    = router.query;
  const contactId = Number(id);
  const { contacts, interactions, addInteraction, addParticipantInteractions, updateInteraction, paymentConfig } = useCrm();
  const { currentUser, activeProject } = useAuth();
  const contact = contacts.find(c => c.id === contactId);

  const [form,      setForm]      = useState(EMPTY);
  const [errors,    setErrors]    = useState({});
  const [success,   setSuccess]   = useState(false);
  const [toast,     setToast]     = useState(null); // התראת תקרה/בונוס
  // מנעול שליחה. handleSubmit הוא async עם כמה await, והכפתור נשאר לחיץ עד setSuccess —
  // לחיצה חוזרת בזמן ההמתנה יצרה שני דיווחים על אותו קשר (איתי רוזן, 14.8 14:53,
  // הפרש 2.9 שניות בין שתי השורות. דיווח מוטי גלעד).
  const [saving,    setSaving]    = useState(false);
  // אישור-שכפול: הפעיל לחץ "שמור" על דיווח שנראה זהה לדיווח קיים. מנעול saving לא
  // מכסה את המקרה הזה — האפליקציה נתקעה, הפעיל חזר למסך ודיווח שוב מטופס חדש.
  // מחזיק את ה-id של הדיווח שאושר, ולא boolean: דגל בוליאני היה נשאר דלוק אחרי האישור
  // ומכבה את ההגנה לשארית הסשן, גם אחרי שהפעיל שינה לגמרי את מה שהוא כותב.
  const [dupConfirmedId, setDupConfirmedId] = useState(null);
  // התוצאה שננעלה ברגע השמירה. חובה: addInteraction מכניס את השורה ל-store אופטימית,
  // הקומפוננטה מתרנדרת מחדש, ואז הקשר שהרגע נשמר נספר כ"קשר קודם" מול עצמו — מסך
  // ההצלחה היה מציג "✗ חרגת ממגבלת מפגשים עם לקוח זה" על מפגש שהמנוע כן שילם עליו.
  const [savedResult, setSavedResult] = useState(null);

  if (!contact) {
    return <DesktopLayout title="הוסף קשר"><div style={{ padding: 40, color: '#aaa' }}>לקוח לא נמצא</div></DesktopLayout>;
  }

  // Security: activist can only report for their own contact
  if (currentUser?.role === 'activist' && contact.activist_id !== currentUser.id) {
    return (
      <DesktopLayout title="הוספת קשר" backHref={`/contact/${contactId}`} backLabel="← חזרה">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 15 }}>אין הרשאה — לא ניתן לדווח קשר עבור לקוח שאינו שלך</div>
        </div>
      </DesktopLayout>
    );
  }

  // פרויקט בתשלום: אחדות יהודית (1) או נעים להכיר (2) — כללי תשלום זהים, תקרות משותפות.
  // השם isAchdut נשמר היסטורית; המשמעות בפועל = "פרויקט מזכה בתשלום".
  const isAchdut = PAID_PROJECT_IDS.includes(activeProject?.id) || PAID_PROJECT_IDS.includes(contact.project_id);

  // משך מזכה — נגזר מהקונפיג (MIN_DURATION+1) ולא מספר קבוע, כדי שיתאים תמיד לסף שהמנוע אוכף.
  const MIN_DUR = paymentConfig.MIN_DURATION ?? 15;
  const QUALIFYING_DUR = MIN_DUR + 1;

  // Live payment calculation
  const duration = form.long_enough === 'yes' ? QUALIFYING_DUR : form.long_enough === 'no' ? 5 : 0;
  const currentMonthKey = form.date?.slice(0, 7);
  // "קשרים קודמים" חייב להיבנות בדיוק כמו במנוע (calcMonthlyPayment), אחרת הטופס מזהיר "חרגת"
  // על קשר שהמנוע כן משלם עליו (דיווח מוטי גלעד, 2026-07-21). שני ההבדלים שהיו:
  //   1. בלי סינון פרויקט — קשרים מפרויקט לא-מזכה נספרו לתוך התקרה.
  //   2. בלי חיתוך לפי סדר ההקצאה — קשר שמוקצה אחרי החדש נספר כ"קודם".
  // מאז 2026-08 המנוע מקצה מכסה לפי ערך ולא לפי תאריך, ולכן "קודם" נגזר מאותו comparator
  // ולא מהשוואת תאריכים. הטיוטה מקבלת id מקסימלי כדי שתיקבע אחרונה בשוויון מלא.
  const draft = { type: form.type, quality: form.quality, date: form.date, id: Number.MAX_SAFE_INTEGER };
  const myMonthly = interactions.filter(i =>
    i.activist_id === currentUser?.id && i.date?.slice(0, 7) === currentMonthKey);
  // paidBefore מריץ את לולאת ההקצאה של המנוע עצמו ומחזיר רק את הקשרים ש*זוכו* לפני
  // הטיוטה. סינון ידני כאן תמיד יסטה מהמנוע ברגע שכללי התקרה משתנים — וזה מה שקרה:
  // ספירה של כל הדיווחים (גם אלה שנדחו) הזהירה "חרגת" על קשר שהמנוע כן משלם עליו,
  // ועם CAP_EXCEED_BLOCKS דלוק אפילו חסמה אותו לגמרי.
  // הפרמטר החמישי (כל ה-interactions, לא רק myMonthly) — כדי ש-paidBefore יוכל לבנות
  // contactContext נכון *לכל קשר קודם שהוא בעצמו בודק*: בלעדיו חלון-3-החודשים ומעבר-
  // לתורני לא רואים מעבר לגבול החודש הנוכחי בזמן שהיא מחשבת את הקשרים הקודמים.
  const previousActivistMonthly = paidBefore(draft, myMonthly, contacts, paymentConfig, interactions);
  const previousContactMonthly  = previousActivistMonthly.filter(i => i.contact_id === contactId);
  const isShabbat = form.type === 'אירוח שבת';
  // "רב משתתפים" עבר לקומפוננטה נפרדת (setReportKind) — לא מוצג עוד כאיכות רגילה כדי למנוע כפילות.
  const qualityOptions = CONFIG.interactionQuality;
  const QUALITY_LABELS = { [CONFIG.interactionQualityMulti]: 'מפגש רב משתתפים' };
  // בחירת משתתפים מהלקוחות של הפעיל — בלי הלקוח שעליו מדווחים, ממוין עברית
  const clientOptions = contacts
    .filter(c => c.id !== contactId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  // תווית תיאור לפי סוג קשר — override map (דפוס QUALITY_LABELS)
  const DESCRIPTION_LABELS       = { 'אירוח שבת': 'תיאור חוויות השבת' };
  const DESCRIPTION_PLACEHOLDERS = { 'אירוח שבת': 'ספר על השבת — מי התארח, איך הייתה האווירה, מה במיוחד ריגש...' };
  const descriptionLabel       = DESCRIPTION_LABELS[form.type] ?? 'תיאור המפגש';
  const descriptionPlaceholder = DESCRIPTION_PLACEHOLDERS[form.type] ?? 'תאר את המפגש בפירוט — מי הלקוח, מה דובר, מה הפוטנציאל...';
  // contactContext לתצוגה המקדימה — כל קשרי הפעיל עם הלקוח הזה, לא רק החודש הנוכחי
  // (myMonthly), כדי שחלון-3-חודשים ומעבר-לתורני יעבדו נכון גם לקוח ותיק. interactions
  // עצמו עלול להיות רב-פעילי (רכז/כספים/ראש-תחום/מנכ"ל — ראה scopeQueryToUser
  // ב-CrmStore.jsx), ולכן buildContactContext מסנן גם activist_id, לא רק contact_id.
  const contactContext = buildContactContext(contact, contactId, currentUser?.id, interactions);
  // "איכות"/"משך" לצורך התצוגה-המקדימה וזיהוי-כפילות — קשר קצרצר לא משתמש ב-form.quality/
  // duration (אלה נשארים ריקים/לא-רלוונטיים במצב הזה, ר' setReportKind): האיכות האמיתית
  // היא הבחירה מ-dropdown אמצעי-הקשר (contact_method), והמשך קבוע 5 לפי הגדרת המשימה.
  const effectiveQuality  = form.reportKind === 'brief' ? form.contact_method : form.quality;
  const effectiveDuration = form.reportKind === 'brief' ? 5 : duration;
  // קצרצר לא תלוי בבחירת type/quality/long_enough הרגילים — הוא תמיד payable:false
  // בזכות הבדיקה המפורשת ב-calcInteractionPayment, גם כש-contact_method עוד ריק
  // (לא נבחר) — הבדיקה שם קודמת לכל שימוש ב-quality, ולכן לא זורקת שגיאה.
  const payableCheckReady = form.reportKind === 'brief'
    ? isAchdut
    : isAchdut && form.type && (form.quality || isShabbat) && form.long_enough;
  const payableCheck = payableCheckReady
    ? calcInteractionPayment(
        { type: form.type, quality: effectiveQuality, duration_minutes: effectiveDuration, date: form.date },
        previousContactMonthly,
        contact.high_potential,
        previousActivistMonthly,
        paymentConfig,
        contactContext
      )
    : null;

  // דיווח קיים שנראה זהה לזה שבטופס: אותו לקוח, אותו תאריך, אותו סוג/איכות ואותו תיאור.
  // התיאור הוא שדה חובה וטקסט חופשי — שני דיווחים אמיתיים על אותו לקוח באותו יום כמעט
  // לעולם לא יישאו בדיוק את אותו טקסט, ולכן זה סימן מובהק לשכפול ולא לפעילות כפולה.
  const existingDuplicate = interactions.find(i =>
    Number(i.activist_id) === Number(currentUser?.id) &&
    Number(i.contact_id) === contactId &&
    i.date === form.date &&
    i.type === form.type &&
    // effectiveQuality ולא form.quality: במצב 'brief' האיכות האמיתית היא contact_method
    // (form.quality נשאר ריק במצב הזה, ר' setReportKind) — בלעדי זה שני קשרי-קצרצר
    // זהים לא היו מזוהים ככפילות.
    (i.quality || '') === (effectiveQuality || '') &&
    (i.description || '').trim() === form.description.trim() &&
    form.description.trim() !== ''
  );

  // חריגה מתקרת-ערוץ חודשית — נגזרת ישירות מהחלטת המנוע (payableCheck), כך שתמיד עקבית איתו.
  // המנוע מחזיר reason עם המילה "חודשית" / "רב-משתתפים" כשהקשר נדחה בגלל תקרת ערוץ.
  const monthlyCapExceeded = isAchdut && payableCheck && !payableCheck.payable &&
    /חודשית|רב-משתתפים/.test(payableCheck.reason || '');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  // תאריך הקשר. תאריך היעד נגזר ממנו — שבוע קדימה, הקצב המקובל אצל הפעילים — ולא
  // מ"היום". פעיל שמדווח באיחור על קשר מתחילת החודש קיבל טווח שמתחיל היום, ולכן
  // "תאריך היעד הבא הוא כבר היה" (דיווח שירה שם טוב, 2026-07-30).
  function setDate(value) {
    setForm(prev => {
      const next = { ...prev, date: value };
      if (value && (!prev.next_action_date || prev.next_action_date === addDaysIso(prev.date, 7))) {
        next.next_action_date = addDaysIso(value, 7);
      }
      return next;
    });
    setErrors(prev => ({ ...prev, date: undefined, next_action_date: undefined }));
  }

  function handleTypeChange(t) {
    const wasShabbat = form.type === 'אירוח שבת';
    set('type', t);
    if (t === 'אירוח שבת') {
      // אירוח שבת — אין איכות קשר (תעריף קבוע); מנקים בחירה קודמת
      set('quality', '');
      // שאלת המשך לא רלוונטית לשבת (כל שבת מעל 15 דקות) — נקבע אוטומטית "מעל המינימום"
      set('long_enough', 'yes');
      // מונה נקי — שלא ידלוף ערך שהוקלד קודם במצב רב-משתתפים
      set('participant_count', '');
    } else {
      // איפוס ערכים אוטומטיים בעת יציאה משבת
      if (wasShabbat) { set('long_enough', null); set('participant_count', ''); }
      // "רב משתתפים" רלוונטי רק לפרונטלי — מנקים אם עברו לסוג אחר
      if (t !== 'פרונטלי' && form.quality === CONFIG.interactionQualityMulti) set('quality', '');
    }
  }

  // אופי הדיווח — שלושה מצבים בלעדיים: 'single' (קשר עם לקוח בודד) / 'multi' (מפגש רב
  // משתתפים) / 'brief' (קשר קצרצר). מאחורי הקלעים 'multi' הוא קשר פרונטלי באיכות "רב
  // משתתפים" (מלגה קבועה 300 ₪ עם תקרה חודשית) ו-'brief' הוא type='קצרצר' (לעולם לא
  // מזכה — ראה lib/paymentCalc.js), כדי לשמר את מנוע התשלום בלי מסלול נפרד לכל מצב.
  // החליף את toggleMulti(on) הבוליאני — אותה לוגיקת איפוס בדיוק, מורחבת למצב השלישי.
  function setReportKind(kind) {
    setForm(prev => {
      if (prev.reportKind === kind) return prev; // לחיצה חוזרת על המצב הפעיל — לא מוחקים שורות שהוזנו
      return {
        ...prev,
        reportKind: kind,
        type:    kind === 'multi' ? 'פרונטלי' : kind === 'brief' ? 'קצרצר' : '',
        quality: kind === 'multi' ? CONFIG.interactionQualityMulti : '',
        // אמצעי-קשר רלוונטי רק במצב 'brief' — בחירה מפורשת מחדש בכל כניסה, כמו quality.
        contact_method: '',
        // שורה ריקה ראשונה כבר פתוחה — שהפעיל יראה מיד את הרשימה, בלי לנחש
        participant_clients:  kind === 'multi' ? [''] : [],
        participant_external: kind === 'multi' ? [''] : [],
        // אם עברו לכאן משבת — מאפסים ערכים אוטומטיים של שבת (משך + מונה לקוחות)
        long_enough:       prev.type === 'אירוח שבת' ? null : prev.long_enough,
        participant_count: prev.type === 'אירוח שבת' ? ''   : prev.participant_count,
      };
    });
    setErrors({});
  }

  // עוזרי שורות משתתפים — תמיד יוצרים מערך חדש (לא לגעת ב-EMPTY המשותף)
  function setParticipantRow(field, idx, value) {
    setForm(prev => { const rows = [...prev[field]]; rows[idx] = value; return { ...prev, [field]: rows }; });
  }
  function addParticipantRow(field) {
    setForm(prev => ({ ...prev, [field]: [...prev[field], ''] }));
  }
  function removeParticipantRow(field, idx) {
    setForm(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  }

  function handleVoiceTranscript(text) {
    const updated = form.description ? form.description + '\n' + text : text;
    set('description', updated);
  }

  function validate() {
    const e = {};
    if (form.reportKind === 'multi') {
      if (!form.participant_count || Number(form.participant_count) < 2) e.participant_count = 'נא לציין מספר משתתפים (2 ומעלה)';
    } else if (form.reportKind === 'brief') {
      // קצרצר — רק אמצעי הקשר נדרש. type/quality/long_enough מוגדרים אוטומטית
      // (ר' setReportKind/handleSubmit) ולא רלוונטיים לוולידציה של המצב הזה.
      if (!form.contact_method)                 e.contact_method = 'נא לבחור אמצעי קשר';
    } else {
      if (!form.type)                            e.type         = 'נא לבחור סוג קשר';
      if (!form.quality && !isShabbat)           e.quality      = 'נא לבחור איכות קשר';
      if (isShabbat && (!form.participant_count || Number(form.participant_count) < 1))
                                                 e.participant_count = 'נא לציין כמה לקוחות היו אצלך בשבת';
    }
    if (!form.description?.trim())               e.description  = `${descriptionLabel} הוא שדה חובה`;
    if (!form.date)                              e.date         = 'נא לבחור תאריך';
    if (form.date > TODAY)                       e.date         = 'תאריך לא יכול להיות בעתיד';
    if (isAchdut && form.reportKind !== 'brief' && !form.long_enough)
                                                 e.long_enough  = 'נא לציין משך הקשר';
    if (!form.next_action?.trim())               e.next_action  = 'נא לתאר את הפעולה הבאה';
    if (!form.next_action_date)                  e.next_action_date = 'נא לבחור תאריך יעד';
    // הגבול היחיד: תאריך היעד לא מקדים את הקשר עצמו. תאריך שכבר עבר מותר בכוונה —
    // דיווח מאוחר על קשר מתחילת החודש שקבע פעולה שבועית (דיווח שירה שם טוב, 30.7).
    else if (form.date && form.next_action_date < form.date)
                                                 e.next_action_date = 'תאריך היעד לא יכול להקדים את תאריך הקשר';
    return e;
  }

  async function handleSubmit() {
    if (saving) return; // הדיווח כבר בדרך — לחיצה חוזרת לא יוצרת שורה שנייה
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    // שכבת הגנה שנייה מפני דיווח כפול. סריקה על נתוני אמת (23.8) מצאה 6 קבוצות
    // כפולות ו-10 שורות עודפות אצל 5 פעילים, כולן בהפרש 0.3–20 שניות — כלומר לחיצות
    // חוזרות על כפתור שלא הגיב. אחת מהן היא מפגש רב-משתתפים ×3 = 900 ₪ במקום 300.
    // מנעול saving מכסה לחיצה כפולה באותו מסך; זה מכסה גם דיווח חוזר מטופס חדש.
    if (existingDuplicate && dupConfirmedId !== existingDuplicate.id) {
      setDupConfirmedId(existingDuplicate.id);
      setToast({ kind: 'warn', text: 'כבר קיים דיווח זהה על לקוח זה באותו תאריך, עם אותו תיאור. אם זה באמת דיווח נוסף — לחץ "שמור בכל זאת".' });
      return;
    }

    setSaving(true);
    // ננעל *לפני* השמירה, כשהחישוב עוד לא רואה את השורה החדשה כ"קודמת" של עצמה.
    setSavedResult(payableCheck);
    // מסמן שהשורה כבר נחתה ב-DB. אם משהו *אחרי* השמירה נופל (התראה, בונוס, סיכום),
    // ההודעה חייבת לומר "נשמר" ולא "נסה שוב" — אחרת הפעיל מדווח פעם שנייה על מה
    // שכבר קיים, וזו בדיוק הכפילות שכל התיקון הזה נועד למנוע.
    let rowSaved = false;
    // try/finally: בלי זה, throw כלשהו (למשל fetch שנקטע באמצע ה-insert) משאיר את
    // saving=true לנצח — שני הכפתורים disabled, הטופס מת, והפעיל מרענן ומדווח שוב.
    try {

      // צבירת הודעות התראה — כדי שחריגת-תקרה ובונוס באותו דיווח לא ידרסו זה את זה.
      const messages = [];

      // חריגה מתקרת הערוץ החודשית (נגזר מהמנוע)
      if (monthlyCapExceeded) {
        if (paymentConfig.CAP_EXCEED_BLOCKS) {
          setToast({ kind: 'block', text: `שים לב: עברת את גג המפגשים המאושר לחודש זה עבור סוג פעילות זה. הדיווח נחסם.` });
          return; // חסימה — לפי דגל הקונפיג
        }
        messages.push({ kind: 'warn', text: `שים לב: עברת את גג המפגשים המאושר לחודש זה עבור סוג פעילות זה. הקשר יישמר אך לא יזכה בתשלום.` });
      }

      // איסוף משתתפים למבנה מובנה (עמודת participants) — שורות ריקות מסוננות, שמות לא חובה
      const participantClients = form.participant_clients
        .filter(v => v !== '')
        .map(v => { const c = contacts.find(x => String(x.id) === String(v)); return { id: c?.id ?? Number(v), name: c?.name ?? '' }; });
      const participantExternal = form.participant_external.map(s => s.trim()).filter(Boolean);
      const participantsData = form.reportKind === 'multi'
        ? { count: Number(form.participant_count) || null, clients: participantClients, external: participantExternal }
        : isShabbat
          ? { count: Number(form.participant_count) || null, clients: [], external: [] }
          : null;

      // שיקוף לתוך notes — המונה והשמות נראים בכל מקום שמציג הערות, בלי UI נוסף
      // הלקוח שממנו נכנסו לטופס הוא משתתף לכל דבר — בלעדיו המונה והשמות לא מסתדרים,
      // והפעיל רואה מפגש שהוא עצמו לא מופיע בו.
      const participantNames = [contact.name, ...participantClients.map(p => p.name), ...participantExternal].filter(Boolean);
      const baseNotes = form.notes.trim();
      const notesFinal = form.reportKind === 'multi'
        ? `👥 מפגש רב משתתפים · ${form.participant_count} משתתפים${participantNames.length ? ` · משתתפים: ${participantNames.join(', ')}` : ''}${baseNotes ? `\n${baseNotes}` : ''}`
        : isShabbat
          ? `🍷 אירוח שבת · ${form.participant_count} לקוחות${baseNotes ? `\n${baseNotes}` : ''}`
          : baseNotes;

      const interactionPayload = {
        id:               Date.now(),
        contact_id:       contactId,
        activist_id:      currentUser.id,
        // קצרצר: type/quality/duration_minutes קבועים (לא נלקחים מהטופס הרגיל) — ר'
        // תוכנית המשימה. effectiveQuality/effectiveDuration כבר פותרים את זה לפי reportKind
        // (מוגדרים למעלה, ליד payableCheck) — form.type עצמו כבר 'קצרצר' דרך setReportKind.
        type:             form.type,
        quality:          effectiveQuality,
        duration_minutes: effectiveDuration,
        outcome:          form.outcome,
        date:             form.date,
        time:             new Date().toTimeString().slice(0, 5),
        notes:            notesFinal,
        description:      form.description.trim(),
        ai_summary:       form.ai_summary.trim(),
        next_action:      form.next_action.trim(),
        next_action_date: form.next_action_date,
        ...(participantsData ? { participants: participantsData } : {}),
      };

      // await: ההתראות בצד-שרת קוראות את השורה מה-DB, אז היא חייבת לנחות קודם.
      // ה-state כבר עודכן בתוך addInteraction לפני ה-await — המסך לא ממתין.
      const { error: saveError } = await addInteraction(interactionPayload);

      // כשל שמירה — עד היום המסך הציג "הקשר תועד!" גם כשה-insert נכשל, והפעיל
      // חשב שדיווח. עכשיו הטופס נשאר פתוח עם הודעה, והמנעול נפתח לניסיון חוזר.
      if (saveError) {
        setToast({ kind: 'block', text: `הדיווח לא נשמר: ${saveError.message || 'שגיאת רשת'}. הנתונים נשארו בטופס — נסה שוב.` });
        return;
      }
      rowSaved = true;

      // מפגש רב-משתתפים — שורת קשר נגזרת לכל לקוח נוסף שהשתתף, כדי שגם אצלו הקשר ייספר
      // ולא יידרדר ל"על סף ניתוק". התשלום לא מושפע: המפגש מזכה פעם אחת בלבד (paymentCalc).
      if (form.reportKind === 'multi' && participantClients.length > 0) {
        const { error: partError } = await addParticipantInteractions(interactionPayload, participantClients.map(p => p.id));
        // כשל כאן לא מבטל את המפגש עצמו — הוא כבר נשמר ומשולם. אבל בלי חיווי,
        // המשתתף שלא נרשם ממשיך להידרדר ל"על סף ניתוק" בלי שאף אחד ידע.
        if (partError) {
          messages.push({ kind: 'warn', text: 'המפגש נשמר, אבל לא כל המשתתפים נרשמו אצל הלקוחות שלהם. בדוק בכרטיסי הלקוחות והשלם ידנית אם צריך.' });
        }
      }

      // סיכום AI אוטומטי — מיועד לרכז בלבד (הפעיל לא רואה אותו). fire-and-forget:
      // לא חוסם את השמירה, וכשל AI מאבד רק את הסיכום — הקשר כבר נשמר.
      summarizeInteractionText(interactionPayload.description, {
        // effectiveQuality ולא form.quality: במצב 'brief' זה נשאר ריק (ר' setReportKind) —
        // בלעדי זה סיכום ה-AI היה מקבל "קצרצר " בלי אמצעי הקשר בפועל.
        contactName: contact.name, type: form.type, quality: effectiveQuality,
      }).then(async summary => {
        if (!summary) return;
        // await + בדיקת שגיאה לפני ההתראה: השרת קורא את ai_summary מה-DB, אז אם השמירה
        // לא נחתה (או שה-insert של הקשר עוד באוויר) ההתראה תצא ריקה או תיכשל ב-404.
        const { error } = await updateInteraction(interactionPayload.id, { ai_summary: summary });
        if (error) return;
        notifyInteractionApi({ interactionId: interactionPayload.id, kind: 'summary' });
      }).catch(() => {});

      if (isAchdut && payableCheck) {
        // התראה לפעיל עצמו (פעמון מקומי) — הוא כבר מול המסך, לא צריך Push.
        createPaymentInteractionNotifications({
          interaction: interactionPayload,
          contact,
          activist: currentUser,
          paymentResult: payableCheck,
        });
        if (payableCheck.payable && payableCheck.amount > 0) {
          // Push לפעיל עצמו על אותה שורת פעמון — רק השרת יכול לשלוח Push (VAPID/FCM לא
          // קיימים בדפדפן). ה-client_id זהה לשורה שנכתבה למעלה, אז זו לא התראה שנייה.
          // רק לדיווח מזכה: על דיווח שלא זיכה, שורת הפעמון של הדפדפן מפרטת גם את
          // סיבת אי-הזכאות, וכתיבה מהשרת הייתה דורסת אותה בטקסט דל יותר.
          notifyInteractionApi({
            interactionId: interactionPayload.id,
            kind: 'self_payment',
            amount: payableCheck.amount,
          });

          // התראה + Push לניהול הפרויקט — צד-שרת.
          notifyInteractionApi({
            interactionId: interactionPayload.id,
            kind: 'payment',
            amount: payableCheck.amount,
          });
        }
      }

      // התראת בונוס עומק-לקוח — 4 / 6 מפגשי לימוד מצטברים מול אותו לקוח (תואם למנוע התשלום).
      if (isAchdut) {
        const isLearning = form.quality === 'תורני' && (form.type === 'פרונטלי' || form.type === 'וידאו') && duration >= MIN_DUR;
        if (isLearning) {
          const priorLearning = previousContactMonthly.filter(i =>
            i.quality === 'תורני' && (i.type === 'פרונטלי' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= MIN_DUR).length;
          const count = priorLearning + 1;
          let msg = null, amount = 0;
          if (count === 6)      { msg = `מצוין! הגעת ל-6 מפגשים עם ${contact.name}. הנך זכאי לבונוס משופר!`; amount = paymentConfig.LEARNING_BONUS[6]; }
          else if (count === 4) { msg = `כל הכבוד! הגעת ל-4 מפגשים עם ${contact.name}. הנך זכאי לבונוס!`;      amount = paymentConfig.LEARNING_BONUS[4]; }
          if (msg) {
            messages.push({ kind: 'bonus', text: msg });
            // מפתח-חודש ב-id כדי שכל אבן-דרך חודשית תישמר כהתראה נפרדת (לא תידרס בין חודשים).
            createDemoNotification({
              id: `loyalty-bonus-${count}-${contactId}-${currentUser.id}-${currentMonthKey}`,
              type: 'paid_interaction',
              title: count === 6 ? '🏆 בונוס משופר!' : '🎁 בונוס!',
              body: `${msg} (${amount.toLocaleString()} ₪)`,
              user_id: currentUser.id,
              project_id: 1,
              priority: 'high',
              link: '/my-dashboard',
            });
          }
        }
      }

      // הצגת התראה משולבת. בונוס גובר ויזואלית, ואחריו **כל** האזהרות — לא רק הראשונה:
      // דיווח יכול לצבור גם חריגת-תקרה וגם כשל ברישום משתתפים, ואזהרה שנבלעת מחזירה
      // בדיוק את הכשל השקט שהיא נועדה להסיר.
      if (messages.length > 0) {
        const bonusMsg = messages.find(m => m.kind === 'bonus');
        const warns    = messages.filter(m => m.kind === 'warn');
        const ordered  = [...(bonusMsg ? [bonusMsg] : []), ...warns];
        setToast({ kind: bonusMsg ? 'bonus' : 'warn', text: ordered.map(m => m.text).join('\n') });
      }

      setSuccess(true);
    } catch (err) {
      if (rowSaved) {
        // הקשר כבר ב-DB; מה שנפל הוא שלב שאחריו (התראה/בונוס/סיכום). מציגים את מסך
        // ההצלחה, כי "נסה שוב" כאן היה מייצר דיווח כפול.
        console.error('הקשר נשמר, אבל שלב אחרי השמירה נכשל', err);
        setSuccess(true);
      } else {
        setToast({ kind: 'block', text: `שמירת הדיווח נכשלה: ${err?.message || 'שגיאה לא צפויה'}. הנתונים נשארו בטופס — נסה שוב.` });
      }
    } finally {
      setSaving(false);
    }
  }

  const card = {
    background: '#fffaf5', borderRadius: 14, padding: '16px 18px', marginBottom: 12,
    border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };

  const TOAST_STYLES = {
    bonus: { bg: '#fffaf0', border: '#f0d98a', color: '#b06b00' },
    warn:  { bg: '#fff8ec', border: '#f3c77a', color: '#d68910' },
    block: { bg: '#fff0f0', border: '#e0a0a0', color: '#c0392b' },
  };
  const toastEl = toast ? (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
                  background: (TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).bg,
                  border: `1px solid ${(TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).border}`,
                  color: (TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).color,
                  borderRadius: 14, padding: '12px 18px', maxWidth: 440, width: 'calc(100% - 32px)',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.15)', display: 'flex', gap: 12, alignItems: 'center',
                  fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
      <span style={{ flex: 1, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{toast.text}</span>
      <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>✕</button>
    </div>
  ) : null;

  if (success) return (
    <DesktopLayout title="קשר נוסף בהצלחה">
      {toastEl}
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ marginBottom: 8 }}>הקשר תועד!</h2>
        {/* savedResult ולא payableCheck: אחרי השמירה הקשר החדש כבר ב-store, ו-payableCheck
            היה סופר אותו כ"קשר קודם" מול עצמו ומדווח חריגה על מפגש ששולם. */}
        {isAchdut && savedResult && (
          <div style={{ fontSize: 14, color: savedResult.payable ? '#27ae60' : '#888', marginBottom: 8, fontWeight: 700 }}>
            {savedResult.payable
              ? `✓ קשר מזכה בתשלום — ${savedResult.amount} ₪`
              : `✗ ${savedResult.reason || 'קשר זה אינו מזכה בתשלום'}`}
          </div>
        )}
        <p style={{ fontSize: 14, color: '#aaa', marginBottom: 28 }}>הקשר עם {contact.name} נשמר.</p>
        <Link href={`/contact/${contactId}`} className="btn btn-primary" style={{ textDecoration: 'none', padding: '10px 24px' }}>
          חזרה לפרופיל הלקוח
        </Link>
      </div>
    </DesktopLayout>
  );

  return (
    <DesktopLayout title={`קשר חדש — ${contact.name}`} backHref={`/contact/${contactId}`} backLabel="← חזרה">
      {toastEl}
      <div style={{ maxWidth: 560 }}>

        {/* אופי הדיווח — קשר עם לקוח בודד / מפגש רב משתתפים (קומפוננטה נפרדת) / קשר קצרצר */}
        <div style={card}>
          <label className="form-label">אופי הדיווח</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            {[{ v: 'single', l: '👤 קשר עם לקוח' }, { v: 'multi', l: '👥 מפגש רב משתתפים' }, { v: 'brief', l: '⚡ קשר קצרצר' }].map(({ v, l }) => (
              <button key={v} type="button" onClick={() => setReportKind(v)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${form.reportKind === v ? '#6c5ce7' : '#e8e8e8'}`,
                  background: form.reportKind === v ? '#f0effe' : '#fafafa',
                  color: form.reportKind === v ? '#6c5ce7' : '#555',
                  fontWeight: form.reportKind === v ? 700 : 400,
                  fontFamily: 'Rubik,sans-serif', fontSize: 13, transition: 'all 0.18s',
                }}>
                {l}
              </button>
            ))}
          </div>
          {form.reportKind === 'multi' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, color: '#6c5ce7', fontWeight: 700, marginBottom: 10 }}>
                פרונטלי · רב משתתפים · מלגה קבועה 300 ₪ (תקרה חודשית)
              </div>
              <label className="form-label">מספר משתתפים <span style={{ color: '#e24b4a' }}>*</span></label>
              <input type="number" min="2" className={`form-input ${errors.participant_count ? 'form-error' : ''}`}
                placeholder="כמה משתתפים היו במפגש?" value={form.participant_count}
                onChange={e => set('participant_count', e.target.value)} />
              {errors.participant_count && <span className="error-msg">{errors.participant_count}</span>}

              {/* משתתפים מהלקוחות שלך — בורר עם חיפוש (ClientSearchSelect).
                  היה כאן <select> ילידי: במובייל הוא נפתח כגלגלת שקשה לסרוק, ובלי חיפוש
                  קל להחמיץ שם ברשימה ארוכה (דיווח מוטי גלעד, 2026-07-29). */}
              <div style={{ marginTop: 14 }}>
                <label className="form-label">משתתפים מהלקוחות שלך <span style={{ color: '#999', fontWeight: 400 }}>(לא חובה)</span></label>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>
                  כאן מופיעים הלקוחות שלך בלבד. מי שאינו ברשימה — רשום אותו בשדה "משתתפים נוספים" למטה.
                </div>
                {form.participant_clients.map((val, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <ClientSearchSelect
                      value={val}
                      onChange={v => setParticipantRow('participant_clients', idx, v)}
                      options={clientOptions.filter(c => String(c.id) === String(val) || !form.participant_clients.includes(String(c.id)))}
                    />
                    <button type="button" aria-label="הסר משתתף" onClick={() => removeParticipantRow('participant_clients', idx)}
                      style={{ border: '1.5px solid #e8e8e8', background: '#fafafa', color: '#c0392b', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => addParticipantRow('participant_clients')}
                  style={{ border: '1.5px dashed #6c5ce7', background: '#f0effe', color: '#6c5ce7', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>+ הוסף משתתף</button>
              </div>

              {/* משתתפים נוספים שאינם ברשימת הלקוחות — טקסט חופשי */}
              <div style={{ marginTop: 14 }}>
                <label className="form-label">משתתפים נוספים — כל מי שאינו ברשימת הלקוחות שלך <span style={{ color: '#999', fontWeight: 400 }}>(לא חובה)</span></label>
                {form.participant_external.map((val, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input type="text" className="form-input" placeholder="שם המשתתף" value={val}
                      onChange={e => setParticipantRow('participant_external', idx, e.target.value)} />
                    <button type="button" aria-label="הסר משתתף" onClick={() => removeParticipantRow('participant_external', idx)}
                      style={{ border: '1.5px solid #e8e8e8', background: '#fafafa', color: '#c0392b', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0 }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => addParticipantRow('participant_external')}
                  style={{ border: '1.5px dashed #6c5ce7', background: '#f0effe', color: '#6c5ce7', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>+ הוסף משתתף</button>
              </div>
            </div>
          )}
          {/* קשר קצרצר — dropdown יחיד (אמצעי קשר) בלבד. סוג-קשר/איכות/משך מוסתרים
              לגמרי במצב הזה (מוגדרים אוטומטית: type='קצרצר', duration_minutes=5,
              ר' setReportKind + handleSubmit) — לעולם לא מזכה בתשלום. */}
          {form.reportKind === 'brief' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, color: '#6c5ce7', fontWeight: 700, marginBottom: 10 }}>
                קשר קצרצר · אינו מזכה בתשלום
              </div>
              <label className="form-label">אמצעי קשר <span style={{ color: '#e24b4a' }}>*</span></label>
              <select className={`form-input ${errors.contact_method ? 'form-error' : ''}`}
                value={form.contact_method} onChange={e => set('contact_method', e.target.value)}
                style={{ width: '100%', fontFamily: 'inherit' }}>
                <option value="">בחר אמצעי קשר…</option>
                {CONFIG.contactMethods.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {errors.contact_method && <span className="error-msg">{errors.contact_method}</span>}
            </div>
          )}
        </div>

        {/* סוג קשר — לקשר עם לקוח בודד בלבד (לא במפגש רב-משתתפים ולא בקשר קצרצר) */}
        {form.reportKind === 'single' && (
        <div style={card}>
          <label className="form-label">סוג קשר <span style={{ color: '#e24b4a' }}>*</span></label>
          <div className="chip-group">
            {CONFIG.interactionTypes.map(t => (
              <button key={t} type="button"
                className={`chip ${form.type === t ? 'chip-active' : ''}`}
                onClick={() => handleTypeChange(t)}>
                {t}
              </button>
            ))}
          </div>
          {errors.type && <span className="error-msg">{errors.type}</span>}
        </div>
        )}

        {/* איכות קשר — לא רלוונטי לאירוח שבת (תעריף קבוע), למפגש רב משתתפים, או לקשר קצרצר */}
        {form.reportKind === 'single' && !isShabbat && (
        <div style={card}>
          <label className="form-label">איכות הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
          <div className="chip-group">
            {qualityOptions.map(q => (
              <button key={q} type="button"
                className={`chip ${form.quality === q ? 'chip-active' : ''}`}
                onClick={() => set('quality', q)}>
                {QUALITY_LABELS[q] ?? q}
              </button>
            ))}
          </div>
          {errors.quality && <span className="error-msg">{errors.quality}</span>}
        </div>
        )}

        {/* אירוח שבת — כמה לקוחות התארחו (שאלת המשך מיותרת בשבת; נקבעת אוטומטית) */}
        {isShabbat && (
          <div style={card}>
            <label className="form-label">כמה לקוחות היו אצלך בשבת? <span style={{ color: '#e24b4a' }}>*</span></label>
            <input type="number" min="1" className={`form-input ${errors.participant_count ? 'form-error' : ''}`}
              placeholder="מספר הלקוחות שהתארחו אצלך" value={form.participant_count}
              onChange={e => set('participant_count', e.target.value)} />
            {errors.participant_count && <span className="error-msg">{errors.participant_count}</span>}
            {payableCheck && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: payableCheck.payable ? '#edfaf1' : '#f5f5f5', color: payableCheck.payable ? '#27ae60' : '#888' }}>
                {payableCheck.payable
                  ? `✓ קשר מזכה בתשלום — ${payableCheck.amount} ₪`
                  : `✗ ${payableCheck.reason || 'לא מזכה בתשלום'}`}
              </div>
            )}
          </div>
        )}

        {/* משך זמן — אחדות יהודית בלבד; לא בשבת (נקבע אוטומטית, כל שבת מעל המינימום)
            ולא בקשר קצרצר (קבוע 5 דקות — לא שאלה בטופס, ר' setReportKind) */}
        {isAchdut && !isShabbat && form.reportKind !== 'brief' && (
          <div style={card}>
            <label className="form-label">משך זמן הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ v: 'yes', l: `מעל ${MIN_DUR} דקות ✓` }, { v: 'no', l: `פחות מ-${MIN_DUR} דקות` }].map(({ v, l }) => (
                <button key={v} type="button" onClick={() => set('long_enough', v)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer',
                    border: `1.5px solid ${form.long_enough === v ? '#6c5ce7' : '#e8e8e8'}`,
                    background: form.long_enough === v ? '#f0effe' : '#fafafa',
                    color: form.long_enough === v ? '#6c5ce7' : '#555',
                    fontWeight: form.long_enough === v ? 700 : 400,
                    fontFamily: 'Rubik,sans-serif', fontSize: 13, transition: 'all 0.18s',
                  }}>
                  {l}
                </button>
              ))}
            </div>
            {errors.long_enough && <span className="error-msg">{errors.long_enough}</span>}
            {payableCheck && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: payableCheck.payable ? '#edfaf1' : '#f5f5f5', color: payableCheck.payable ? '#27ae60' : '#888' }}>
                {payableCheck.payable
                  ? `✓ קשר מזכה בתשלום — ${payableCheck.amount} ₪`
                  : `✗ ${payableCheck.reason || 'לא מזכה בתשלום'}`}
              </div>
            )}
          </div>
        )}

        {/* תאריך */}
        <div style={card}>
          <label className="form-label">תאריך <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="date" className={`form-input ${errors.date ? 'form-error' : ''}`}
            value={form.date} max={TODAY} onChange={e => setDate(e.target.value)} />
          {errors.date && <span className="error-msg">{errors.date}</span>}
        </div>

        {/* תיאור המפגש (באירוח שבת: תיאור חוויות השבת) */}
        <div style={card}>
          <label className="form-label">{descriptionLabel} <span style={{ color: '#e24b4a' }}>*</span></label>
          <textarea className={`form-textarea ${errors.description ? 'form-error' : ''}`} rows={4}
            placeholder={descriptionPlaceholder}
            value={form.description} onChange={e => set('description', e.target.value)} />
          {errors.description && <span className="error-msg">{errors.description}</span>}
          <VoiceInput onTranscript={handleVoiceTranscript} />
        </div>

        {/* פעולה הבאה — חובה תמיד */}
        <div style={card}>
          <label className="form-label">פעולה הבאה <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="text" className={`form-input ${errors.next_action ? 'form-error' : ''}`}
            placeholder="למשל: לתאם פגישה..."
            value={form.next_action} onChange={e => set('next_action', e.target.value)}
            style={{ marginBottom: 10 }} />
          {errors.next_action && <span className="error-msg">{errors.next_action}</span>}
          <label className="form-label">תאריך יעד <span style={{ color: '#e24b4a' }}>*</span></label>
          {/* min = תאריך הקשר, לא "היום": קשר שדווח באיחור צריך תאריך-יעד יחסי אליו
              (דיווח שירה שם טוב, 2026-07-30 — "בדכ הקשר הוא שבועי"). */}
          <input type="date" className={`form-input ${errors.next_action_date ? 'form-error' : ''}`}
            value={form.next_action_date} min={form.date}
            onChange={e => set('next_action_date', e.target.value)} />
          {errors.next_action_date && <span className="error-msg">{errors.next_action_date}</span>}
          {form.next_action_date && form.next_action_date < TODAY && (
            <span style={{ fontSize: 12, color: '#d68910', display: 'block', marginTop: 4 }}>
              התאריך כבר עבר — התזכורת תופיע מיד.
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setForm(EMPTY)} disabled={saving}>נקה</button>
          {/* disabled בזמן השמירה — לחיצה כפולה יצרה שני דיווחים על אותו קשר (14.8) */}
          <button className="btn btn-primary" style={{ flex: 2, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}
            onClick={handleSubmit} disabled={saving}>
            {/* התווית חוזרת ל"שמור קשר" ברגע שהעריכה כבר לא זהה לדיווח שאושר */}
            {saving ? 'שומר…' : (existingDuplicate && dupConfirmedId === existingDuplicate.id) ? 'שמור בכל זאת' : 'שמור קשר'}
          </button>
        </div>

      </div>
    </DesktopLayout>
  );
}
