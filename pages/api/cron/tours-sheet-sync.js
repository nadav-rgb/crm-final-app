// pages/api/cron/tours-sheet-sync.js — Vercel Cron יומי.
// מסנכרן את הסיורים בין ה-CRM לגיליון המשותף של "נעים להכיר".
//
// כלל ההכרעה: כששני הצדדים חלוקים על אותו סיור — ה-CRM מנצח והגיליון מתוקן.
// אין לשורה בגיליון חותמת זמן, אז אי אפשר לדעת מי עודכן אחרון; ל-CRM מחוברים
// השכר, ההתראות וההיסטוריה, ולכן הוא מקור האמת.
//
// שני בלמים מכוונים:
//   1. שורה שהמשפחה המארחת שלה לא מזוהה כפעיל — לא נוצרת, אלא מדווחת.
//      host_activist_id הוא שדה חובה, וסיור בלי מארח הוא סיור שבור.
//   2. תקרה של MAX_CREATES יצירות בריצה — גיליון שנשבר לא יפתח מאות סיורים
//      ולא יפוצץ אנשים אמיתיים ב-Push.
//
// קריאה מהגיליון עובדת בלי הרשאות. כתיבה אליו דורשת service account עם הרשאת
// עריכה; בלעדיו הכיוון הזה מדולג והדוח היומי אומר בדיוק מה חסר.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';
import { formatDateHe } from '../../../lib/formatDate';
import {
  fetchSheetTours, getSheetsToken, getSheetTitle, appendSheetRow, updateSheetRow,
  sheetDateToIso, isoToSheetDate, normalizeName,
  STATUS_TO_SHEET, STATUS_FROM_SHEET,
} from '../../../lib/toursSheet';

const PROJECT_ID = 2;      // נעים להכיר
const MAX_CREATES = 10;

const FIELD_LABELS = {
  date: 'תאריך', time: 'שעה', settlement: 'מיקום',
  guide: 'מדריך', host: 'משפחה מארחת', status: 'סטטוס', notes: 'הערות',
};

// ייצוג הסיור מה-CRM בשפת הגיליון — כדי שההשוואה תהיה תפוח מול תפוח
function crmToSheetValues(tour, codeName) {
  return {
    tourNumber: String(tour.tour_number || '').trim(),
    date:       isoToSheetDate(tour.date),
    time:       String(tour.start_time || '').trim(),
    settlement: String(tour.settlement || '').trim(),
    guide:      tour.guide_activist_id ? codeName(tour.guide_activist_id) : String(tour.guide_name || '').trim(),
    host:       tour.host_activist_id ? codeName(tour.host_activist_id) : '',
    status:     STATUS_TO_SHEET[tour.status] || 'מתוכנן',
    notes:      String(tour.notes || '').trim(),
  };
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sheetId = process.env.TOURS_SHEET_ID;
  const gid = process.env.TOURS_SHEET_GID || '0';
  if (!sheetId) {
    return res.status(500).json({ error: 'חסר TOURS_SHEET_ID ב-env' });
  }

  const admin = getSupabaseAdmin();
  const created = [], pushedToSheet = [], corrected = [], skipped = [];

  let sheet;
  try {
    sheet = await fetchSheetTours({ sheetId, gid });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  const { data: tours, error: toursErr } = await admin
    .from('tours').select('*').eq('project_id', PROJECT_ID);
  if (toursErr) return res.status(500).json({ error: toursErr.message });

  const { data: profiles } = await admin
    .from('profiles').select('activist_code, name').not('activist_code', 'is', null);

  const nameByCode = {};
  const codesByName = {};
  (profiles || []).forEach(p => {
    nameByCode[Number(p.activist_code)] = p.name;
    (codesByName[normalizeName(p.name)] ??= []).push(Number(p.activist_code));
  });
  const codeName = code => (code == null ? '' : (nameByCode[Number(code)] || `פעיל ${code}`));
  // התאמת שם → קוד. שם שמופיע פעמיים נחשב לא-חד-משמעי ולא מוכרע בניחוש.
  function resolve(name) {
    const hits = codesByName[normalizeName(name)];
    if (!hits) return { ok: false, reason: 'לא נמצא' };
    if (hits.length > 1) return { ok: false, reason: 'יותר מפעיל אחד בשם הזה' };
    return { ok: true, code: hits[0] };
  }

  const crmByNumber = new Map();
  (tours || []).forEach(t => crmByNumber.set(String(t.tour_number || '').trim(), t));

  const sheetByNumber = new Map();
  sheet.rows.forEach(r => {
    if (sheetByNumber.has(r.tourNumber)) {
      skipped.push(`סיור ${r.tourNumber}: מופיע יותר מפעם אחת בגיליון (שורה ${r.rowNumber})`);
      return;
    }
    sheetByNumber.set(r.tourNumber, r);
  });

  // --- כיוון 1: גיליון → CRM (יצירה) --------------------------------------
  for (const row of sheetByNumber.values()) {
    if (crmByNumber.has(row.tourNumber)) continue;

    if (created.length >= MAX_CREATES) {
      skipped.push(`סיור ${row.tourNumber}: נעצר בתקרת ${MAX_CREATES} יצירות לריצה`);
      continue;
    }

    const iso = sheetDateToIso(row.date);
    if (!iso) { skipped.push(`סיור ${row.tourNumber}: תאריך "${row.date}" לא בפורמט DD/MM/YYYY`); continue; }
    if (!row.settlement) { skipped.push(`סיור ${row.tourNumber}: אין מיקום`); continue; }

    const host = resolve(row.host);
    if (!host.ok) { skipped.push(`סיור ${row.tourNumber}: משפחה מארחת "${row.host}" — ${host.reason}`); continue; }

    // מדריך חיצוני הוא מצב לגיטימי ב-CRM: שם חופשי בלי שיוך לפעיל
    const guide = row.guide ? resolve(row.guide) : { ok: false };

    const newTour = {
      id: `tour-sheet-${row.tourNumber}`,   // דטרמיניסטי — ריצה חוזרת לא תכפיל
      tour_number: row.tourNumber,
      settlement: row.settlement,
      date: iso,
      start_time: row.time || '',
      guide_name: guide.ok ? codeName(guide.code) : row.guide,
      guide_activist_id: guide.ok ? guide.code : null,
      host_activist_id: host.code,
      assigned_activists: [],
      status: STATUS_FROM_SHEET[row.status] || 'upcoming',
      notes: row.notes || '',
      project_id: PROJECT_ID,
    };

    const { error: insErr } = await admin.from('tours').upsert(newTour, { onConflict: 'id' });
    if (insErr) { skipped.push(`סיור ${row.tourNumber}: יצירה נכשלה — ${insErr.message}`); continue; }

    created.push({ tourNumber: row.tourNumber, settlement: row.settlement, date: iso, tour: newTour });
    crmByNumber.set(row.tourNumber, newTour);

    // התראה רק למי שיש לו תפקיד בסיור. הרכזים מקבלים דוח מסכם אחד בסוף, לא הודעה לכל סיור.
    const roleTargets = [];
    roleTargets.push({ code: host.code, role: 'המשפחה המארחת' });
    if (guide.ok && guide.code !== host.code) roleTargets.push({ code: guide.code, role: 'המדריך' });

    for (const t of roleTargets) {
      await notifyRecipients(admin, [{ activist_code: t.code, name: codeName(t.code) }], {
        title: 'שובצת לסיור',
        body: `נקבעת בתור ${t.role} בסיור ${row.tourNumber} ב${row.settlement} בתאריך ${formatDateHe(iso)}.`,
        url: `/tours?tour=${newTour.id}`,
        type: 'assignment',
        priority: 'high',
        clientId: c => `tour_sheet_created_${row.tourNumber}_${c}`,
      });
    }
  }

  // --- כיוון 2: CRM → גיליון (הוספה ותיקון) -------------------------------
  const auth = await getSheetsToken();
  let writeDisabledReason = auth.ok ? null : auth.reason;
  // הכתובת שאיתה צריך לשתף את הגיליון. נחשפת כאן בכוונה — היא לא סוד, בניגוד למפתח
  // שלצידה ב-service account, ובלעדיה אין דרך לדעת את מי להוסיף כעורך.
  const serviceAccountEmail = auth.email || null;

  if (auth.ok) {
    try {
      const title = await getSheetTitle({ sheetId, gid, token: auth.token });

      for (const tour of crmByNumber.values()) {
        const values = crmToSheetValues(tour, codeName);
        const row = sheetByNumber.get(values.tourNumber);

        if (!row) {
          // סיור שנוצר ב-CRM ואינו בגיליון. (סיור שזה עתה נוצר *מ*הגיליון כבר שם.)
          if (created.some(c => c.tourNumber === values.tourNumber)) continue;
          await appendSheetRow({ sheetId, title, token: auth.token, headerRow: sheet.headerRow, columns: sheet.columns, values });
          pushedToSheet.push(values.tourNumber);
          continue;
        }

        const diffs = Object.keys(FIELD_LABELS).filter(k => String(row[k] || '').trim() !== String(values[k] || '').trim());
        if (diffs.length === 0) continue;

        await updateSheetRow({
          sheetId, title, token: auth.token,
          headerRow: sheet.headerRow, columns: sheet.columns, values, rowNumber: row.rowNumber,
        });
        corrected.push(`סיור ${values.tourNumber}: ${diffs.map(d => FIELD_LABELS[d]).join(', ')}`);
      }
    } catch (e) {
      writeDisabledReason = e.message;
    }
  }

  // --- דוח יומי לרכזים ----------------------------------------------------
  const lines = [];
  if (created.length)       lines.push(`נוצרו ב-CRM מהגיליון: ${created.map(c => c.tourNumber).join(', ')}`);
  if (pushedToSheet.length) lines.push(`נוספו לגיליון: ${pushedToSheet.join(', ')}`);
  if (corrected.length)     lines.push(`תוקנו בגיליון לפי ה-CRM — ${corrected.join(' · ')}`);
  if (skipped.length)       lines.push(`דורש טיפול ידני: ${skipped.join(' · ')}`);
  if (writeDisabledReason) {
    lines.push(`כתיבה לגיליון מושבתת: ${writeDisabledReason}`
      + (serviceAccountEmail ? ` (שתף את הגיליון כעורך עם ${serviceAccountEmail})` : ''));
  }

  const summary = {
    created: created.length,
    pushedToSheet: pushedToSheet.length,
    corrected: corrected.length,
    skipped: skipped.length,
    writeDisabledReason,
    serviceAccountEmail,
  };

  // שקט כשהכל מסונכרן — התראה יומית שאומרת "אין שינוי" מאמנת אנשים להתעלם ממנה
  if (lines.length === 0) return res.status(200).json({ ok: true, ...summary, quiet: true });

  const managers = await getProjectManagers(admin, PROJECT_ID);
  const today = new Date().toISOString().slice(0, 10);
  const notified = await notifyRecipients(
    admin,
    managers.map(m => ({ activist_code: Number(m.activist_code), name: m.name })),
    {
      title: 'סנכרון סיורים מול הגיליון',
      body: lines.join('. '),
      url: '/tours',
      type: 'system',
      priority: skipped.length || writeDisabledReason ? 'high' : 'normal',
      clientId: c => `tours_sheet_sync_${today}_${c}`,
    },
  );

  return res.status(200).json({ ok: true, ...summary, lines, notified: notified.length });
}
