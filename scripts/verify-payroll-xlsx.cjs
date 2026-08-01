// scripts/verify-payroll-xlsx.cjs — מאמת את גיליון השכר שיורד מכפתור "ייצוא לאקסל".
// שימוש: node scripts/verify-payroll-xlsx.cjs 2026 7      (שנה, חודש 1-12)
//
// בונה את אותו paymentData שעמוד /payments בונה, מריץ עליו את buildPayrollWorkbook
// האמיתי מ-lib/payrollExcel.js, כותב קובץ, קורא אותו בחזרה ובודק:
//   1. כל שורה מסתכמת: פעילות + בונוסים + סיורים + הוצאות === סה"כ
//   2. סכום עמודת הסה"כ === הסכום שעמוד התשלומים מציג
//   3. הקובץ שנכתב באמת נפתח, עם עברית ונוסחאות SUM תקינות
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { calcMonthlyPayment } = require('../lib/paymentCalc.js');
const { buildPayrollWorkbook, buildPayrollRows } = require('../lib/payrollExcel.js');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const fail = m => { console.error(`\n❌ FAIL — ${m}`); process.exit(1); };

(async () => {
  const year  = Number(process.argv[2] || new Date().getFullYear());
  const month = Number(process.argv[3] || new Date().getMonth() + 1) - 1;
  const monthKey = `${year}-${month}`;
  const startIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endIso   = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, '0')}-01`;

  const [{ data: interactions }, { data: contacts }, { data: activists }, { data: cancellations }, { data: expenses }, { data: tours }] =
    await Promise.all([
      sb.from('interactions').select('*'),
      sb.from('contacts').select('*'),
      sb.from('activist_directory').select('*'),
      sb.from('bonus_cancellations').select('bonus_key'),
      sb.from('expenses').select('*'),
      sb.from('tours').select('*'),
    ]);

  const cancelledKeys = new Set((cancellations || []).map(c => c.bonus_key));

  const newParticipantBonuses = (contacts || [])
    .filter(c => c.activist_id && c.joined_at && (c.source === 'external' || c.referred_by))
    .map(c => { const d = new Date(c.joined_at); return { activist_id: c.activist_id, contact_id: c.id, contactName: c.name, month: `${d.getFullYear()}-${d.getMonth()}` }; });

  const mitzvotBonuses = (contacts || []).flatMap(c => {
    if (!c.activist_id || !Array.isArray(c.mitzvot_history)) return [];
    return c.mitzvot_history.flatMap(h => {
      const from = Number(h?.from ?? 0), to = Number(h?.to ?? 0), diff = to - from;
      if (!h?.mitzva || diff <= 0) return [];
      const d = h.date ? new Date(h.date) : new Date();
      return Array.from({ length: diff }, (_, i) => ({
        activist_id: c.activist_id, contact_id: c.id, contactName: c.name,
        desc: `עליה ב${h.mitzva} מרמה ${from + i} ל-${from + i + 1}`, month: `${d.getFullYear()}-${d.getMonth()}`,
      }));
    });
  });

  // אותו paymentData בדיוק שעמוד /payments בונה
  const paymentData = (activists || [])
    .filter(a => a.role === 'activist')
    .map(a => ({ ...a, id: Number(a.activist_code) }))
    .map(activist => {
      const myMitzvot = mitzvotBonuses.filter(b => Number(b.activist_id) === Number(activist.id) && b.month === monthKey);
      const myNew     = newParticipantBonuses.filter(b => Number(b.activist_id) === Number(activist.id) && b.month === monthKey);
      const result = calcMonthlyPayment(activist.id, interactions || [], contacts || [], myMitzvot, myNew, undefined, cancelledKeys, { year, month });
      const expensesTotal = (expenses || [])
        .filter(x => Number(x.activist_id) === Number(activist.id) && x.date >= startIso && x.date < endIso)
        .reduce((s, x) => s + Number(x.amount || 0), 0);
      const guidedCount = (tours || []).filter(t => t.status === 'completed' && Number(t.guide_activist_id) === Number(activist.id) && t.date >= startIso && t.date < endIso).length;
      const guidePay = guidedCount * 750;
      return { activist, ...result, expensesTotal, guidePay, guidedCount, grandTotal: result.total + expensesTotal + guidePay };
    })
    .filter(d => d.grandTotal !== 0);

  const pageTotal = paymentData.reduce((s, d) => s + d.grandTotal, 0);
  const monthName = MONTH_NAMES[month];

  // --- 1. כל שורה מסתכמת ---
  const rows = buildPayrollRows(paymentData);
  if (rows.length !== paymentData.length) fail(`נבנו ${rows.length} שורות עבור ${paymentData.length} פעילים`);
  for (const r of rows) {
    const sum = r.activity + r.bonuses + r.guide + r.expenses;
    if (sum !== r.total) fail(`${r.name}: ${r.activity}+${r.bonuses}+${r.guide}+${r.expenses} = ${sum} ≠ ${r.total}`);
  }
  console.log(`✅ כל ${rows.length} השורות מסתכמות נכון (פעילות + בונוסים + סיורים + הוצאות = סה"כ)`);

  // --- 2. הסכום תואם לעמוד ---
  const rowsTotal = rows.reduce((s, r) => s + r.total, 0);
  if (rowsTotal !== pageTotal) fail(`סכום הגיליון ${rowsTotal} ≠ הסכום בעמוד ${pageTotal}`);
  console.log(`✅ סכום הגיליון תואם לעמוד התשלומים: ${rowsTotal.toLocaleString()} ₪`);

  // --- 3. הקובץ נכתב ונקרא בחזרה ---
  const wb = await buildPayrollWorkbook(paymentData, monthName, year);
  const outPath = path.join(require('os').tmpdir(), `payroll-${year}-${month}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  const bytes = fs.statSync(outPath).size;

  const ExcelJS = (await import('exceljs')).default;
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(outPath);
  const ws = back.worksheets[0];
  if (!ws) fail('הקובץ שנכתב לא מכיל גיליון');
  if (ws.name !== `תשלומים ${monthName}`) fail(`שם גיליון שגוי: "${ws.name}"`);
  if (!ws.views?.[0]?.rightToLeft) fail('הגיליון לא נשמר כ-RTL');

  const headers = ws.getRow(1).values.slice(1);
  const expectedHeaders = ['שם הפעיל','תשלום פעילות','בונוסים','הדרכת סיורים','החזר הוצאות','סה"כ לתשלום'];
  if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) fail(`כותרות שגויות: ${JSON.stringify(headers)}`);

  // בקריאה חוזרת מקובץ, exceljs לא משחזר את מפתחות העמודות (הם קיימים רק בזיכרון),
  // ולכן הגישה כאן היא לפי אינדקס: 1=שם, 2=פעילות, 3=בונוסים, 4=סיורים, 5=הוצאות, 6=סה"כ.
  const COL = { name: 1, activity: 2, bonuses: 3, guide: 4, expenses: 5, total: 6 };

  // שורת הסיכום היא האחרונה, ובה נוסחת SUM ולא ערך קפוא
  const last = ws.getRow(ws.rowCount);
  if (last.getCell(COL.name).value !== 'סה"כ') fail('שורת הסיכום חסרה');
  const totalCell = last.getCell(COL.total);
  if (!totalCell.formula || !/^SUM\(/.test(totalCell.formula)) fail(`תא הסיכום אינו נוסחת SUM: ${JSON.stringify(totalCell.value)}`);

  // התאים הכספיים נשמרו כמספרים ולא כטקסט
  const firstData = ws.getRow(2);
  for (const key of ['activity','bonuses','guide','expenses','total']) {
    if (typeof firstData.getCell(COL[key]).value !== 'number') fail(`התא ${key} בשורה 2 אינו מספר`);
  }
  if (ws.getColumn(COL.total).numFmt !== '#,##0 ₪') fail('פורמט כספי חסר בעמודת הסה"כ');

  console.log(`✅ הקובץ נכתב (${(bytes/1024).toFixed(1)} KB), נקרא בחזרה, RTL + כותרות + נוסחת SUM (${totalCell.formula}) תקינים`);
  console.log(`✅ תאים כספיים נשמרו כמספרים עם פורמט ₪`);
  console.log(`\nדוגמה — 3 שורות ראשונות:`);
  rows.slice(0, 3).forEach(r => console.log(`   ${r.name.padEnd(20)} פעילות ${String(r.activity).padStart(6)} | בונוסים ${String(r.bonuses).padStart(5)} | סיורים ${String(r.guide).padStart(5)} | הוצאות ${String(r.expenses).padStart(5)} | סה"כ ${String(r.total).padStart(6)}`));
  console.log(`\n📄 ${outPath}`);
  console.log(`\n✅ PASS — גיליון השכר תקין.`);
})().catch(e => fail(e.stack || e.message));
