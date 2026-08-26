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
