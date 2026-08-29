// lib/toursSheet.js — הגשר לגיליון המשותף של "נעים להכיר" (סיורים).
//
// קריאה וכתיבה: Google Sheets API v4 עם service account ייעודי וגיליון/טווח
// allowlisted. אין CSV ציבורי ואין fallback ל-credentials של אינטגרציה אחרת.
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

// מושך טווח פרטי ומאומת ומחזיר { headerRow, columns, rows }.
// rowNumber = מספר השורה בגיליון עצמו (כותרת = 1), לצורך כתיבה חזרה לאותה שורה.
export async function fetchSheetTours({ sheetId, range, token, fetchImpl = fetch } = {}) {
  if (!sheetId || !range || !token) throw new Error('private sheet configuration required');
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
  if (!res.ok) throw new Error('private sheet read failed');
  const data = await res.json();
  const table = Array.isArray(data?.values) ? data.values : [];
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

// --- אימות וכתיבה ---------------------------------------------------------

let cachedClient = null;

// מחזיר { ok, token } או { ok: false, reason } — reason מנוסח כדי שיופיע בדוח היומי
// ויגיד בדיוק מה חסר, במקום להיכשל בשקט.
export async function getSheetsToken({ serviceAccount } = {}) {
  const sa = serviceAccount;
  if (!sa?.client_email || !sa?.private_key) throw new Error('private sheet credentials required');
  try {
    cachedClient ??= new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const { token } = await cachedClient.getAccessToken();
    if (!token) throw new Error('private sheet token unavailable');
    return { token };
  } catch {
    throw new Error('private sheet authentication failed');
  }
}

// בונה מערך תאים לפי סדר העמודות שנקרא בפועל מהגיליון
function buildRowCells({ headerRow, columns, values }) {
  const cells = new Array(headerRow.length).fill('');
  Object.entries(columns).forEach(([key, idx]) => {
    if (idx >= 0) cells[idx] = values[key] ?? '';
  });
  return cells;
}

export async function appendSheetRow({ sheetId, range, token, headerRow, columns, values }) {
  const res = await fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [buildRowCells({ headerRow, columns, values })] }),
    },
  );
  if (!res.ok) throw new Error('private sheet append failed');
  return true;
}

export async function updateSheetRow({ sheetId, range, token, headerRow, columns, values, rowNumber }) {
  const title = range.slice(0, range.lastIndexOf('!'));
  const columnRange = range.slice(range.lastIndexOf('!') + 1);
  const firstCol = columnRange.split(':')[0];
  const lastCol = String.fromCharCode(64 + Math.max(headerRow.length, 1));
  const rowRange = `${title}!${firstCol}${rowNumber}:${lastCol}${rowNumber}`;
  const res = await fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(rowRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [buildRowCells({ headerRow, columns, values })] }),
    },
  );
  if (!res.ok) throw new Error('private sheet update failed');
  return true;
}
