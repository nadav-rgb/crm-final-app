// lib/toursSheet.js — הגשר לגיליון המשותף של "נעים להכיר" (סיורים).
//
// קריאה: ייצוא CSV הציבורי — עובד בלי שום הרשאה כל עוד הגיליון משותף-בלינק.
// כתיבה: Sheets API v4 עם service account. משתמש ב-SHEETS_SERVICE_ACCOUNT אם הוגדר,
// ואחרת נופל ל-FCM_SERVICE_ACCOUNT הקיים — כך שדי לשתף את הגיליון עם אותה כתובת
// (ולהפעיל Google Sheets API באותו פרויקט GCP) בלי להקים service account נוסף.
//
// שרת בלבד.
import { JWT } from 'google-auth-library';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// כותרות העמודות בגיליון. ההצלבה היא לפי שם ולא לפי מיקום — סדר העמודות יכול להשתנות.
export const SHEET_HEADERS = {
  tourNumber: 'מספר סיור',
  date:       'תאריך',
  time:       'שעה',
  settlement: 'מיקום',
  guide:      'מדריך',
  host:       'משפחה מארחת',
  status:     'סטטוס',
  notes:      'הערות',
};

export const STATUS_TO_SHEET   = { upcoming: 'מתוכנן', completed: 'התקיים', cancelled: 'בוטל' };
export const STATUS_FROM_SHEET = { 'מתוכנן': 'upcoming', 'התקיים': 'completed', 'בוטל': 'cancelled' };

// --- המרות ---------------------------------------------------------------

// DD/MM/YYYY → YYYY-MM-DD. מחזיר '' אם לא מזוהה, כדי שהמתקשר יוכל לדווח במקום לנחש.
export function sheetDateToIso(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return '';
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isoToSheetDate(iso) {
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// השוואת שמות: רווחים כפולים, גרשיים שונים ורווחים בקצוות לא אמורים להפיל התאמה.
export function normalizeName(value) {
  return String(value || '')
    .replace(/[‘’׳']/g, "'")
    .replace(/[“”״"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- CSV -----------------------------------------------------------------

// פרסר קטן שמכבד שדות במרכאות — הערות בעברית מכילות פסיקים, ופיצול נאיבי היה שובר שורות.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

// מושך את הגיליון ומחזיר { headerRow, columns, rows }.
// rowNumber = מספר השורה בגיליון עצמו (כותרת = 1), לצורך כתיבה חזרה לאותה שורה.
export async function fetchSheetTours({ sheetId, gid = '0' } = {}) {
  if (!sheetId) throw new Error('חסר TOURS_SHEET_ID');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`קריאת הגיליון נכשלה (HTTP ${res.status}). ודא שהשיתוף "כל מי שיש לו הקישור" עדיין פעיל.`);
  }
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    throw new Error('הגיליון החזיר דף HTML במקום CSV — כנראה השיתוף בלינק בוטל.');
  }

  const table = parseCsv(text);
  if (table.length === 0) throw new Error('הגיליון ריק');

  const headerRow = table[0].map(h => String(h).trim());
  const columns = {};
  Object.entries(SHEET_HEADERS).forEach(([key, label]) => {
    columns[key] = headerRow.findIndex(h => h === label);
  });

  const missing = Object.entries(columns).filter(([, idx]) => idx === -1).map(([k]) => SHEET_HEADERS[k]);
  if (missing.length) throw new Error(`חסרות עמודות בגיליון: ${missing.join(', ')}`);

  const rows = table.slice(1).map((cells, i) => ({
    rowNumber:  i + 2,
    tourNumber: String(cells[columns.tourNumber] ?? '').trim(),
    date:       String(cells[columns.date] ?? '').trim(),
    time:       String(cells[columns.time] ?? '').trim(),
    settlement: String(cells[columns.settlement] ?? '').trim(),
    guide:      String(cells[columns.guide] ?? '').trim(),
    host:       String(cells[columns.host] ?? '').trim(),
    status:     String(cells[columns.status] ?? '').trim(),
    notes:      String(cells[columns.notes] ?? '').trim(),
  })).filter(r => r.tourNumber);

  return { headerRow, columns, rows };
}

// --- כתיבה (דורשת service account) ---------------------------------------

function getServiceAccount() {
  const raw = process.env.SHEETS_SERVICE_ACCOUNT || process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

let cachedClient = null;

// מחזיר { ok, token } או { ok: false, reason } — reason מנוסח כדי שיופיע בדוח היומי
// ויגיד בדיוק מה חסר, במקום להיכשל בשקט.
export async function getSheetsToken() {
  const sa = getServiceAccount();
  if (!sa) {
    return { ok: false, reason: 'לא הוגדר SHEETS_SERVICE_ACCOUNT (ואין FCM_SERVICE_ACCOUNT) — כתיבה לגיליון מושבתת' };
  }
  if (!sa.client_email || !sa.private_key) {
    return { ok: false, reason: 'ה-service account חסר client_email או private_key' };
  }
  try {
    cachedClient ??= new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const { token } = await cachedClient.getAccessToken();
    if (!token) return { ok: false, reason: 'קבלת access token מגוגל נכשלה' };
    return { ok: true, token, email: sa.client_email };
  } catch (e) {
    return { ok: false, reason: `אימות מול גוגל נכשל: ${e.message}` };
  }
}

// שם הלשונית לפי gid — ה-values API עובד עם שמות, לא עם gid.
export async function getSheetTitle({ sheetId, gid, token }) {
  const res = await fetch(`${SHEETS_API}/${sheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = res.status === 403
      ? `שתף את הגיליון עם ה-service account כ"עורך"`
      : await res.text().catch(() => '');
    throw new Error(`קריאת מבנה הגיליון נכשלה (HTTP ${res.status}). ${detail}`);
  }
  const data = await res.json();
  const match = (data.sheets || []).find(s => String(s.properties?.sheetId) === String(gid));
  return match?.properties?.title || data.sheets?.[0]?.properties?.title || 'Sheet1';
}

// בונה מערך תאים לפי סדר העמודות שנקרא בפועל מהגיליון
function buildRowCells({ headerRow, columns, values }) {
  const cells = new Array(headerRow.length).fill('');
  Object.entries(columns).forEach(([key, idx]) => {
    if (idx >= 0) cells[idx] = values[key] ?? '';
  });
  return cells;
}

export async function appendSheetRow({ sheetId, title, token, headerRow, columns, values }) {
  const range = `${title}!A:${String.fromCharCode(64 + Math.max(headerRow.length, 1))}`;
  const res = await fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [buildRowCells({ headerRow, columns, values })] }),
    },
  );
  if (!res.ok) throw new Error(`הוספת שורה נכשלה (HTTP ${res.status}) ${await res.text().catch(() => '')}`);
  return true;
}

export async function updateSheetRow({ sheetId, title, token, headerRow, columns, values, rowNumber }) {
  const lastCol = String.fromCharCode(64 + Math.max(headerRow.length, 1));
  const range = `${title}!A${rowNumber}:${lastCol}${rowNumber}`;
  const res = await fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [buildRowCells({ headerRow, columns, values })] }),
    },
  );
  if (!res.ok) throw new Error(`עדכון שורה ${rowNumber} נכשל (HTTP ${res.status}) ${await res.text().catch(() => '')}`);
  return true;
}
