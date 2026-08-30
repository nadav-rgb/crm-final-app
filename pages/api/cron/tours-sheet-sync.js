// pages/api/cron/tours-sheet-sync.js — Vercel Cron יומי.
// מסנכרן את הסיורים בין ה-CRM לגיליון המשותף של "נעים להכיר".
//
// כלל ההכרעה: כששני הצדדים חלוקים על אותו סיור — ה-CRM מנצח והגיליון מתוקן.
// אין לשורה בגיליון חותמת זמן, אז אי אפשר לדעת מי עודכן אחרון; ל-CRM מחוברים
// השכר, ההתראות וההיסטוריה, ולכן הוא מקור האמת.
//
// שני בלמים מכוונים:
//   1. שורה שהמשפחה המארחת שלה לא מזוהה כפעיל — לא נוצרת, אלא מדווחת.
//      host_user_id הוא שדה חובה, וסיור בלי מארח הוא סיור שבור.
//   2. תקרה של MAX_CREATES יצירות בריצה — גיליון שנשבר לא יפתח מאות סיורים
//      ולא יפוצץ אנשים אמיתיים ב-Push.
//
// שני הכיוונים דורשים service account ייעודי וגיליון/טווח allowlisted.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';
import { formatDateHe } from '../../../lib/formatDate';
import { getPrivateSheetsConfig, redactExternalError, requireCronAuth } from '../../../lib/security/external-data.mjs';
import {
  fetchSheetTours, getSheetsToken, appendSheetRow, updateSheetRow,
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
function crmToSheetValues(tour, userName) {
  return {
    tourNumber: String(tour.tour_number || '').trim(),
    date:       isoToSheetDate(tour.date),
    time:       String(tour.start_time || '').trim(),
    settlement: String(tour.settlement || '').trim(),
    guide:      tour.guide_user_id ? userName(tour.guide_user_id) : String(tour.guide_name || '').trim(),
    host:       tour.host_user_id ? userName(tour.host_user_id) : '',
    status:     STATUS_TO_SHEET[tour.status] || 'מתוכנן',
    notes:      String(tour.notes || '').trim(),
  };
}

export default async function handler(req, res) {
  try {
    requireCronAuth(req);
  } catch (error) {
    return res.status(error?.status ?? 401).json({ error: { code: error?.code ?? 'CRON_AUTH_DENIED', message: error?.publicMessage ?? 'Machine authentication is invalid' } });
  }

  let config;
  let auth;
  let sheet;
  try {
    config = getPrivateSheetsConfig(process.env);
    auth = await getSheetsToken(config);
    sheet = await fetchSheetTours({
      sheetId: config.sheetId, range: config.range, token: auth.token,
    });
  } catch (caught) {
    const error = caught?.code === 'INTEGRATION_DISABLED' ? caught : redactExternalError(caught);
    return res.status(error.status).json({ error: { code: error.code, message: error.publicMessage } });
  }

  const admin = getSupabaseAdmin();
  const created = [], pushedToSheet = [], corrected = [], skipped = [];

  const { data: tours, error: toursErr } = await admin
    .from('tours')
    .select('id,tour_number,settlement,date,start_time,guide_name,guide_user_id,host_user_id,assigned_user_ids,status,notes,project_id')
    .eq('project_id', PROJECT_ID);
  if (toursErr) return res.status(503).json({ error: { code: 'DATA_UNAVAILABLE', message: 'Data service is unavailable' } });

  const { data: profiles } = await admin
    .from('profiles').select('id,name').not('id', 'is', null);

  const nameByUserId = {};
  const usersByName = {};
  (profiles || []).forEach(p => {
    nameByUserId[p.id] = p.name;
    (usersByName[normalizeName(p.name)] ??= []).push({ userId: p.id });
  });
  const userName = userId => (userId == null ? '' : (nameByUserId[userId] || 'פעיל'));
  // התאמת שם → UUID. שם שמופיע פעמיים נחשב לא-חד-משמעי ולא מוכרע בניחוש.
  function resolve(name) {
    const hits = usersByName[normalizeName(name)];
    if (!hits) return { ok: false, reason: 'לא נמצא' };
    if (hits.length > 1) return { ok: false, reason: 'יותר מפעיל אחד בשם הזה' };
    return { ok: true, ...hits[0] };
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
      guide_name: guide.ok ? userName(guide.userId) : row.guide,
      guide_user_id: guide.ok ? guide.userId : null,
      host_user_id: host.userId,
      assigned_user_ids: [],
      status: STATUS_FROM_SHEET[row.status] || 'upcoming',
      notes: row.notes || '',
      project_id: PROJECT_ID,
    };

    const { error: insErr } = await admin.from('tours').upsert(newTour, { onConflict: 'id' });
    if (insErr) { skipped.push(`סיור ${row.tourNumber}: יצירה נכשלה`); continue; }

    created.push({ tourNumber: row.tourNumber, settlement: row.settlement, date: iso, tour: newTour });
    crmByNumber.set(row.tourNumber, newTour);

    // התראה רק למי שיש לו תפקיד בסיור. הרכזים מקבלים דוח מסכם אחד בסוף, לא הודעה לכל סיור.
    const roleTargets = [];
    roleTargets.push({ userId: host.userId, role: 'המשפחה המארחת' });
    if (guide.ok && guide.userId !== host.userId) roleTargets.push({ userId: guide.userId, role: 'המדריך' });

    for (const t of roleTargets) {
      await notifyRecipients(admin, [{ user_id: t.userId, name: userName(t.userId) }], {
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
  let writeFailed = false;
  try {
      for (const tour of crmByNumber.values()) {
        const values = crmToSheetValues(tour, userName);
        const row = sheetByNumber.get(values.tourNumber);

        if (!row) {
          // סיור שנוצר ב-CRM ואינו בגיליון. (סיור שזה עתה נוצר *מ*הגיליון כבר שם.)
          if (created.some(c => c.tourNumber === values.tourNumber)) continue;
          await appendSheetRow({ sheetId: config.sheetId, range: config.range, token: auth.token, headerRow: sheet.headerRow, columns: sheet.columns, values });
          pushedToSheet.push(values.tourNumber);
          continue;
        }

        const diffs = Object.keys(FIELD_LABELS).filter(k => String(row[k] || '').trim() !== String(values[k] || '').trim());
        if (diffs.length === 0) continue;

        await updateSheetRow({
          sheetId: config.sheetId, range: config.range, token: auth.token,
          headerRow: sheet.headerRow, columns: sheet.columns, values, rowNumber: row.rowNumber,
        });
        corrected.push(`סיור ${values.tourNumber}: ${diffs.map(d => FIELD_LABELS[d]).join(', ')}`);
      }
  } catch {
    writeFailed = true;
  }

  // --- דוח יומי לרכזים ----------------------------------------------------
  const lines = [];
  if (created.length)       lines.push(`נוצרו ב-CRM מהגיליון: ${created.map(c => c.tourNumber).join(', ')}`);
  if (pushedToSheet.length) lines.push(`נוספו לגיליון: ${pushedToSheet.join(', ')}`);
  if (corrected.length)     lines.push(`תוקנו בגיליון לפי ה-CRM — ${corrected.join(' · ')}`);
  if (skipped.length)       lines.push(`דורש טיפול ידני: ${skipped.join(' · ')}`);
  if (writeFailed) lines.push('כתיבה לגיליון נכשלה; נדרש טיפול בתצורת האינטגרציה');

  const summary = {
    created: created.length,
    pushedToSheet: pushedToSheet.length,
    corrected: corrected.length,
    skipped: skipped.length,
    writeFailed,
  };

  // שקט כשהכל מסונכרן — התראה יומית שאומרת "אין שינוי" מאמנת אנשים להתעלם ממנה
  if (lines.length === 0) return res.status(200).json({ ok: true, ...summary, quiet: true });

  const managers = await getProjectManagers(admin, PROJECT_ID);
  const today = new Date().toISOString().slice(0, 10);
  const notified = await notifyRecipients(
    admin,
    managers,
    {
      title: 'סנכרון סיורים מול הגיליון',
      body: lines.join('. '),
      url: '/tours',
      type: 'system',
      priority: skipped.length || writeFailed ? 'high' : 'normal',
      clientId: c => `tours_sheet_sync_${today}_${c}`,
    },
  );

  return res.status(200).json({ ok: true, ...summary, lines, notified: notified.length });
}
