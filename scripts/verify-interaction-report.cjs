const assert = require('node:assert/strict');

const requestedSection = (() => {
  const index = process.argv.indexOf('--section');
  return index >= 0 ? process.argv[index + 1] : 'all';
})();

const tests = [];
function test(section, name, fn) {
  if (requestedSection === 'all' || requestedSection === section) tests.push({ section, name, fn });
}

const project = { id: 1, name: 'אחדות יהודית' };
const activists = [
  { activist_code: 10, name: 'דוד כהן', role: 'activist', project_id: 1, project_ids: [1] },
  { activist_code: 11, name: 'שרה לוי', role: 'activist', project_id: 1, project_ids: [1] },
  { activist_code: 12, name: 'ללא דיווחים', role: 'activist', project_id: 1, project_ids: [1] },
  { activist_code: 13, name: 'פרויקט אחר', role: 'activist', project_id: 2, project_ids: [2] },
];

const contacts = [
  {
    id: 100,
    name: 'לקוח א',
    activist_id: 10,
    project_id: 1,
    is_active: true,
    mitzvot_history: [
      { mitzva: 'שבת', from: 1, to: 4, date: '2026-05-01' },
      { mitzva: 'תפילין', from: 0, to: 1, date: '2026-05-10' },
      { mitzva: 'שבת', from: 4, to: 4, date: '2026-05-15' },
      { mitzva: 'כשרות', from: 2, to: 1, date: '2026-05-16' },
      { mitzva: 'שבת', from: 1, to: 2, date: '2026-05-31' },
    ],
  },
  { id: 101, name: 'לקוח לא פעיל', activist_id: 10, project_id: 1, is_active: false, mitzvot_history: [] },
  { id: 102, name: 'לקוח ב', activist_id: 11, project_id: 1, is_active: true, mitzvot_history: [{ mitzva: 'שבת', from: 0, to: 2, date: '2026-05-20' }] },
  // Duplicate source row protects the organizational DISTINCT contact_id rule.
  { id: 100, name: 'לקוח א', activist_id: 11, project_id: 1, is_active: true, mitzvot_history: [] },
  { id: 200, name: 'לקוח פרויקט אחר', activist_id: 10, project_id: 2, is_active: true, mitzvot_history: [] },
];

const tenSameClientInteractions = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  project_id: 1,
  activist_id: 10,
  contact_id: 100,
  quality: index % 2 === 0 ? 'תורני' : 'ידידותי',
  type: ['פרונטלי', 'וידאו', 'טלפוני', 'אירוח שבת'][index % 4],
  duration_minutes: 10,
  date: index === 0 ? '2026-05-01' : index === 9 ? '2026-05-31' : '2026-05-15',
  ...(index === 8 ? { participants: { derived_from: 999 } } : {}),
}));

const interactions = [
  ...tenSameClientInteractions,
  { id: 20, project_id: 1, activist_id: 11, contact_id: 102, quality: 'רב משתתפים', type: 'פרונטלי', duration_minutes: 30, date: '2026-05-20' },
  { id: 21, project_id: 1, activist_id: 10, contact_id: 100, quality: 'תורני', type: 'טלפוני', duration_minutes: 99, date: '2026-04-30' },
  { id: 22, project_id: 1, activist_id: 10, contact_id: 100, quality: 'תורני', type: 'טלפוני', duration_minutes: 99, date: '2026-06-01' },
  { id: 23, project_id: 2, activist_id: 10, contact_id: 200, quality: 'תורני', type: 'פרונטלי', duration_minutes: 99, date: '2026-05-15' },
];

function buildFixtureReport(overrides = {}) {
  const { buildInteractionReport } = require('../lib/interactionReport');
  return buildInteractionReport({
    project,
    interactions,
    contacts,
    activists,
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    ...overrides,
  });
}

test('calculations', 'exports strict date validation', () => {
  const { validateDateRange } = require('../lib/interactionReport');
  assert.equal(typeof validateDateRange, 'function');
  assert.deepEqual(validateDateRange('2026-06-01', '2026-05-01'), {
    ok: false,
    error: 'תאריך ההתחלה אינו יכול להיות מאוחר מתאריך הסיום.',
  });
});

test('calculations', 'counts ten connections for one unique assigned client and includes inactive clients', () => {
  const report = buildFixtureReport();
  const row = report.rows.find(item => item.activistId === 10);
  assert.equal(row.totalClients, 2);
  assert.equal(row.totalInteractions, 10);
  assert.equal(row.totalMinutes, 100);
  assert.equal(row.averageInteractionsPerClient, 5);
  assert.equal(row.averageDuration, 10);
});

test('calculations', 'includes both date endpoints and excludes outside dates and another project', () => {
  const report = buildFixtureReport();
  assert.equal(report.totals.totalInteractions, 11);
  assert.equal(report.meta.interactionCount, 11);
});

test('calculations', 'counts derived participant rows as full connections', () => {
  const report = buildFixtureReport();
  const row = report.rows.find(item => item.activistId === 10);
  assert.equal(row.totalInteractions, 10);
  assert.equal(row.frontalCount + row.videoCount + row.phoneCount + row.shabbatHostCount, 10);
});

test('calculations', 'keeps quality and type as independent dimensions', () => {
  const report = buildFixtureReport();
  assert.equal(report.totals.toraniCount, 5);
  assert.equal(report.totals.friendlyCount, 5);
  assert.equal(report.totals.frontalCount, 4);
  assert.equal(report.totals.totalInteractions, 11);
});

test('calculations', 'deduplicates organizational clients by contact_id rather than summing rows', () => {
  const report = buildFixtureReport();
  assert.equal(report.rows.find(item => item.activistId === 10).totalClients, 2);
  assert.equal(report.rows.find(item => item.activistId === 11).totalClients, 2);
  assert.equal(report.totals.totalClients, 3);
});

test('calculations', 'creates detailed mitzvot rise events and ignores unchanged levels and drops', () => {
  const report = buildFixtureReport();
  assert.equal(report.mitzvotEvents.length, 4);
  assert.equal(report.mitzvotEvents.find(event => event.oldLevel === 1 && event.newLevel === 4).levelsGained, 3);
  assert.equal(report.mitzvotEvents.filter(event => event.contactId === 100 && event.mitzva === 'שבת').length, 2);
  assert.equal(report.mitzvotEvents.some(event => event.newLevel <= event.oldLevel), false);
  assert.equal(new Set(report.mitzvotEvents.filter(event => event.contactId === 100).map(event => event.mitzva)).size, 2);
});

test('calculations', 'keeps row totals and organizational totals consistent', () => {
  const report = buildFixtureReport();
  assert.equal(report.rows.reduce((sum, row) => sum + row.totalInteractions, 0), report.totals.totalInteractions);
  assert.equal(report.rows.reduce((sum, row) => sum + row.totalMinutes, 0), report.totals.totalMinutes);
  assert.equal(report.totals.averageInteractionsPerClient, 11 / 3);
  assert.equal(report.totals.averageDuration, 130 / 11);
});

test('calculations', 'includes zero rows for project activists without activity', () => {
  const report = buildFixtureReport();
  const row = report.rows.find(item => item.activistId === 12);
  assert.equal(row.activistName, 'ללא דיווחים');
  assert.equal(row.totalClients, 0);
  assert.equal(row.totalInteractions, 0);
});

test('calculations', 'fails instead of inventing an activist name', () => {
  assert.throws(
    () => buildFixtureReport({ interactions: [...interactions, { ...interactions[0], id: 999, activist_id: 99 }] }),
    /לא נמצא שם אמיתי לפעיל 99/,
  );
});

test('calculations', 'builds the Hebrew summary sentence from actual totals', () => {
  const report = buildFixtureReport();
  assert.match(report.summarySentence, /01\.05\.2026–31\.05\.2026/);
  assert.match(report.summarySentence, /11 קשרים/);
  assert.match(report.summarySentence, /5 קשרים תורניים/);
});

function loadServerModule() {
  try {
    return require('../lib/interactionReportServer');
  } catch (_error) {
    return null;
  }
}

function createFakeSupabase(tableRows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, columns: '', filters: [] };
      calls.push(call);
      const query = {
        select(columns) { call.columns = columns; return query; },
        eq(column, value) { call.filters.push(['eq', column, value]); return query; },
        gte(column, value) { call.filters.push(['gte', column, value]); return query; },
        lte(column, value) { call.filters.push(['lte', column, value]); return query; },
        single() {
          const rows = tableRows[table] || [];
          return Promise.resolve({ data: rows[0] || null, error: rows.length ? null : { message: 'not found' } });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: tableRows[table] || [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

test('server', 'authorizes only a CEO profile', () => {
  const server = loadServerModule();
  assert.ok(server, 'interactionReportServer module must exist');
  assert.deepEqual(server.authorizeCeoProfile(null), { ok: false, status: 403, error: 'No profile' });
  assert.equal(server.authorizeCeoProfile({ role: 'activist' }).status, 403);
  assert.equal(server.authorizeCeoProfile({ role: 'coord' }).status, 403);
  assert.deepEqual(server.authorizeCeoProfile({ role: 'ceo' }), { ok: true });
});

test('server', 'loads live project 1 data without filtering inactive contacts', async () => {
  const server = loadServerModule();
  assert.ok(server, 'interactionReportServer module must exist');
  const supabase = createFakeSupabase({
    projects: [{ id: 1, name: 'אחדות יהודית' }],
    contacts: contacts.filter(contact => contact.project_id === 1),
    interactions,
    activist_directory: activists,
  });
  const report = await server.loadLiveInteractionReport({
    supabase,
    startDate: '2026-05-01',
    endDate: '2026-05-31',
  });
  assert.equal(report.meta.projectId, 1);
  assert.equal(report.totals.totalClients, 3);
  assert.equal(report.totals.totalInteractions, 11);
  const contactsCall = supabase.calls.find(call => call.table === 'contacts');
  assert.equal(contactsCall.filters.some(([, column]) => column === 'is_active'), false);
  const interactionsCall = supabase.calls.find(call => call.table === 'interactions');
  assert.deepEqual(interactionsCall.filters.filter(([kind]) => kind === 'gte' || kind === 'lte'), [
    ['gte', 'date', '2026-05-01'],
    ['lte', 'date', '2026-05-31'],
  ]);
});

test('server', 'rejects a non-CEO before loading any report data', async () => {
  const server = loadServerModule();
  assert.ok(server, 'interactionReportServer module must exist');
  let loadCalls = 0;
  const handler = server.createInteractionReportHandler({
    requireAuth: async () => ({ ok: true, profile: { role: 'activist' } }),
    getSupabaseAdmin: () => ({}),
    loadLiveInteractionReport: async () => { loadCalls += 1; return {}; },
  });
  const req = { method: 'GET', headers: {}, query: {} };
  const res = createResponseRecorder();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(loadCalls, 0);
  assert.deepEqual(res.body, { error: 'הדו״ח זמין למנכ״ל בלבד.' });
});

test('server', 'rejects an inverted date range with a Hebrew 400 response', async () => {
  const server = loadServerModule();
  assert.ok(server, 'interactionReportServer module must exist');
  const handler = server.createInteractionReportHandler({
    requireAuth: async () => ({ ok: true, profile: { role: 'ceo' } }),
    getSupabaseAdmin: () => ({}),
    loadLiveInteractionReport: async () => ({}),
  });
  const req = { method: 'GET', headers: {}, query: { from: '2026-06-01', to: '2026-05-01' } };
  const res = createResponseRecorder();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'תאריך ההתחלה אינו יכול להיות מאוחר מתאריך הסיום.' });
});

test('excel', 'creates exactly four required RTL worksheets', async () => {
  const { buildInteractionWorkbook } = require('../lib/interactionReportExcel');
  const workbook = await buildInteractionWorkbook(buildFixtureReport());
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'סיכום לפי פעיל',
    'התקדמות במצוות',
    'סיכום מצוות',
    'סיכום ארגוני',
  ]);
  workbook.worksheets.forEach(sheet => {
    assert.equal(sheet.views[0].rightToLeft, true);
    assert.equal(sheet.views[0].state, 'frozen');
    assert.ok(sheet.views[0].ySplit >= 3);
  });
});

test('excel', 'writes all main metrics and keeps averages numeric', async () => {
  const { buildInteractionWorkbook } = require('../lib/interactionReportExcel');
  const workbook = await buildInteractionWorkbook(buildFixtureReport());
  const sheet = workbook.getWorksheet('סיכום לפי פעיל');
  assert.deepEqual(sheet.getRow(3).values.slice(1), [
    'שם הפעיל', 'מספר לקוחות כולל', 'סך כל הקשרים', 'קשרים תורניים', 'קשרים ידידותיים',
    'קשרים פרונטליים', 'קשרי וידאו', 'קשרים טלפוניים', 'אירוחי שבת', 'סך דקות הקשר',
    'ממוצע קשרים ללקוח', 'ממוצע משך קשר',
  ]);
  const davidRow = sheet.getRows(4, sheet.rowCount - 3).find(row => row.getCell(1).value === 'דוד כהן');
  assert.equal(davidRow.getCell(2).value, 2);
  assert.equal(davidRow.getCell(3).value, 10);
  assert.equal(typeof davidRow.getCell(11).value, 'number');
  assert.equal(typeof davidRow.getCell(12).value, 'number');
});

test('excel', 'writes detailed mitzvot events and the organizational sentence', async () => {
  const { buildInteractionWorkbook } = require('../lib/interactionReportExcel');
  const report = buildFixtureReport();
  const workbook = await buildInteractionWorkbook(report);
  const progress = workbook.getWorksheet('התקדמות במצוות');
  const eventRow = progress.getRows(4, progress.rowCount - 3).find(row => row.getCell(3).value === 100 && row.getCell(4).value === 'שבת' && row.getCell(5).value === 1 && row.getCell(6).value === 4);
  assert.ok(eventRow);
  assert.equal(eventRow.getCell(7).value, 3);
  const organizational = workbook.getWorksheet('סיכום ארגוני');
  const values = organizational.getRows(1, organizational.rowCount).flatMap(row => row.values);
  assert.ok(values.includes(report.summarySentence));
});

function loadPdfModule() {
  try {
    return require('../lib/interactionReportPdf');
  } catch (_error) {
    return null;
  }
}

test('pdf', 'builds a complete main-table and mitzvot PDF model from the filtered report', () => {
  const pdf = loadPdfModule();
  assert.ok(pdf, 'interactionReportPdf module must exist');
  const report = buildFixtureReport();
  const model = pdf.buildInteractionPdfModel(report);
  assert.equal(model.main.headers.length, 12);
  assert.equal(model.main.rows.find(row => row[0] === 'דוד כהן')[2], 10);
  assert.equal(model.main.totalRow[2], 11);
  assert.equal(model.summarySentence, report.summarySentence);
  assert.ok(model.mitzvot.rows.some(row => row[0] === 'סה״כ כל הפעילים' && row[1] === 'שבת'));
});

test('pdf', 'creates a real PDF byte stream with the embedded Hebrew font', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pdf = loadPdfModule();
  assert.ok(pdf, 'interactionReportPdf module must exist');
  const fontPath = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansHebrew-Regular.ttf');
  assert.equal(fs.existsSync(fontPath), true, 'Hebrew TTF must exist');
  const bytes = await pdf.buildInteractionReportPdf(buildFixtureReport(), { fontBinary: fs.readFileSync(fontPath) });
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(bytes.length > 10_000);
});

function loadUiModule() {
  try {
    return require('../lib/interactionReportUi');
  } catch (_error) {
    return null;
  }
}

test('ui', 'exposes the complete 12-column CEO table model', () => {
  const ui = loadUiModule();
  assert.ok(ui, 'interactionReportUi module must exist');
  assert.equal(ui.REPORT_TABLE_COLUMNS.length, 11);
  assert.equal(ui.REPORT_TABLE_COLUMNS[0].key, 'totalClients');
  assert.equal(ui.REPORT_TABLE_COLUMNS.at(-1).key, 'averageDuration');
  assert.equal(1 + ui.REPORT_TABLE_COLUMNS.length, 12);
});

test('ui', 'allows only the CEO role to request the screen data', () => {
  const ui = loadUiModule();
  assert.ok(ui, 'interactionReportUi module must exist');
  assert.equal(ui.canViewInteractionReport({ role: 'ceo' }), true);
  assert.equal(ui.canViewInteractionReport({ role: 'head' }), false);
  assert.equal(ui.canViewInteractionReport({ role: 'coord' }), false);
  assert.equal(ui.canViewInteractionReport({ role: 'activist' }), false);
  assert.equal(ui.canViewInteractionReport(null), false);
});

test('ui', 'formats counts and averages in Hebrew without losing precision rules', () => {
  const ui = loadUiModule();
  assert.ok(ui, 'interactionReportUi module must exist');
  assert.equal(ui.formatReportNumber(1234), '1,234');
  assert.equal(ui.formatReportNumber(11 / 3, true), '3.67');
  assert.equal(ui.formatReportNumber(0, true), '0');
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS [${item.section}] ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL [${item.section}] ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failed > 0) {
    console.error(`interaction report verification: ${failed} failed`);
    process.exit(1);
  }
  console.log(`interaction report verification: PASS (${tests.length} tests)`);
}

main();
