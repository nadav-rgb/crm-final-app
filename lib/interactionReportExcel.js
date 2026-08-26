const { formatDisplayDate } = require('./interactionReport');

const PURPLE = 'FF3A249B';
const PURPLE_LIGHT = 'FFF0EFFE';
const WHITE = 'FFFFFFFF';
const BORDER = 'FFE1D9D1';

function reportRangeLabel(report) {
  const { startDate, endDate } = report.meta;
  if (!startDate && !endDate) return 'כל ההיסטוריה הקיימת במערכת';
  return `${startDate ? formatDisplayDate(startDate) : 'תחילת ההיסטוריה'}–${endDate ? formatDisplayDate(endDate) : 'היום'}`;
}

function styleWorksheet(sheet, { headerRow = 3, widths = [] } = {}) {
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRow, activeCell: `A${headerRow + 1}` }];
  sheet.properties = { ...(sheet.properties || {}), pageSetUpPr: { fitToPage: true } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: PURPLE } };
  sheet.getRow(1).height = 24;
  sheet.getRow(2).font = { size: 11, color: { argb: 'FF5E5650' } };
  const heading = sheet.getRow(headerRow);
  heading.font = { bold: true, color: { argb: WHITE } };
  heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
  heading.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  heading.height = 34;
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: Math.max(1, widths.length) } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.eachCell(cell => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: BORDER } },
      };
    });
  });
}

function highlightTotalRow(row) {
  row.font = { bold: true, color: { argb: PURPLE } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } };
}

async function buildInteractionWorkbook(report) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CRM מקרבים';
  workbook.company = report.meta.projectName;
  workbook.subject = 'דו״ח קשרים והתקדמות במצוות';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const title = `דו״ח קשרים — ${report.meta.projectName}`;
  const range = reportRangeLabel(report);

  const summary = workbook.addWorksheet('סיכום לפי פעיל');
  summary.addRow([title]);
  summary.addRow([`טווח: ${range}`]);
  summary.addRow([
    'שם הפעיל', 'מספר לקוחות כולל', 'סך כל הקשרים', 'קשרים תורניים', 'קשרים ידידותיים',
    'קשרים פרונטליים', 'קשרי וידאו', 'קשרים טלפוניים', 'אירוחי שבת', 'סך דקות הקשר',
    'ממוצע קשרים ללקוח', 'ממוצע משך קשר',
  ]);
  report.rows.forEach(row => summary.addRow([
    row.activistName, row.totalClients, row.totalInteractions, row.toraniCount, row.friendlyCount,
    row.frontalCount, row.videoCount, row.phoneCount, row.shabbatHostCount, row.totalMinutes,
    row.averageInteractionsPerClient, row.averageDuration,
  ]));
  const totals = report.totals;
  const totalRow = summary.addRow([
    'סה״כ כל הפעילים', totals.totalClients, totals.totalInteractions, totals.toraniCount, totals.friendlyCount,
    totals.frontalCount, totals.videoCount, totals.phoneCount, totals.shabbatHostCount, totals.totalMinutes,
    totals.averageInteractionsPerClient, totals.averageDuration,
  ]);
  highlightTotalRow(totalRow);
  styleWorksheet(summary, { headerRow: 3, widths: [25, 17, 15, 15, 16, 17, 13, 15, 14, 16, 21, 18] });
  summary.getColumn(11).numFmt = '0.00';
  summary.getColumn(12).numFmt = '0.00';

  const events = workbook.addWorksheet('התקדמות במצוות');
  events.addRow([`${title} — אירועי התקדמות`]);
  events.addRow([`טווח: ${range}`]);
  events.addRow(['שם הפעיל', 'שם הלקוח', 'contact_id', 'מצווה', 'רמה קודמת', 'רמה חדשה', 'מספר רמות שעלו', 'תאריך השינוי']);
  report.mitzvotEvents.forEach(event => events.addRow([
    event.activistName, event.contactName, event.contactId, event.mitzva,
    event.oldLevel, event.newLevel, event.levelsGained, formatDisplayDate(event.date),
  ]));
  styleWorksheet(events, { headerRow: 3, widths: [24, 24, 14, 20, 14, 14, 19, 17] });

  const mitzvotSummary = workbook.addWorksheet('סיכום מצוות');
  mitzvotSummary.addRow([`${title} — סיכום מצוות`]);
  mitzvotSummary.addRow([`טווח: ${range}`]);
  mitzvotSummary.addRow(['שם הפעיל', 'מצווה', 'מספר רמות שעלו', 'לקוחות ייחודיים', 'מספר אירועי עלייה', 'סך כל הרמות שנוספו']);
  report.mitzvotRows.forEach(row => mitzvotSummary.addRow([
    row.activistName, row.mitzva, row.levelsGained, row.uniqueClients, row.eventCount, row.totalLevels,
  ]));
  report.mitzvotTotals.forEach(row => {
    const aggregateRow = mitzvotSummary.addRow([
      row.activistName, row.mitzva, row.levelsGained, row.uniqueClients, row.eventCount, row.totalLevels,
    ]);
    highlightTotalRow(aggregateRow);
  });
  styleWorksheet(mitzvotSummary, { headerRow: 3, widths: [24, 20, 19, 18, 20, 21] });

  const organizational = workbook.addWorksheet('סיכום ארגוני');
  organizational.addRow([title]);
  organizational.addRow([`טווח: ${range}`]);
  organizational.addRow(['מדד', 'ערך']);
  [
    ['מספר לקוחות ייחודיים', totals.totalClients],
    ['סך כל הקשרים', totals.totalInteractions],
    ['קשרים תורניים', totals.toraniCount],
    ['קשרים ידידותיים', totals.friendlyCount],
    ['קשרים פרונטליים', totals.frontalCount],
    ['קשרי וידאו', totals.videoCount],
    ['קשרים טלפוניים', totals.phoneCount],
    ['אירוחי שבת', totals.shabbatHostCount],
    ['סך דקות הקשר', totals.totalMinutes],
    ['ממוצע קשרים ללקוח', totals.averageInteractionsPerClient],
    ['ממוצע משך קשר', totals.averageDuration],
    ['משפט סיכום', report.summarySentence],
  ].forEach(values => organizational.addRow(values));
  styleWorksheet(organizational, { headerRow: 3, widths: [30, 110] });
  organizational.getColumn(2).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  organizational.getRow(organizational.rowCount).height = 54;

  return workbook;
}

async function createInteractionWorkbookBuffer(report) {
  const workbook = await buildInteractionWorkbook(report);
  return workbook.xlsx.writeBuffer();
}

function reportFileSuffix(report) {
  const { startDate, endDate } = report.meta;
  return startDate || endDate ? `${startDate || 'התחלה'}-${endDate || 'היום'}` : 'כל-ההיסטוריה';
}

async function downloadInteractionReportExcel(report) {
  const buffer = await createInteractionWorkbookBuffer(report);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `דו״ח-קשרים-אחדות-יהודית-${reportFileSuffix(report)}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

module.exports = {
  buildInteractionWorkbook,
  createInteractionWorkbookBuffer,
  downloadInteractionReportExcel,
  reportRangeLabel,
};
