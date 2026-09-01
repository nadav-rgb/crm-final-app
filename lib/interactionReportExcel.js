const { formatDisplayDate } = require('./interactionReport');

const PURPLE = 'FF3A249B';
const PURPLE_LIGHT = 'FFF0EFFE';
const WHITE = 'FFFFFFFF';
const BORDER = 'FFE1D9D1';
const INDIGO = 'FF4F46E5';
const TEAL = 'FF0F766E';
const AMBER = 'FFD97706';
const INK = 'FF211F2D';
const SOFT_BG = 'FFF8FAFC';

function reportRangeLabel(report) {
  const { startDate, endDate } = report.meta;
  if (!startDate && !endDate) return 'כל ההיסטוריה הקיימת במערכת';
  return `${startDate ? formatDisplayDate(startDate) : 'תחילת ההיסטוריה'}–${endDate ? formatDisplayDate(endDate) : 'היום'}`;
}

function styleWorksheet(sheet, { headerRow = 3, widths = [], filterColumns = widths.length } = {}) {
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRow, activeCell: `A${headerRow + 1}` }];
  sheet.properties = { ...(sheet.properties || {}), pageSetUpPr: { fitToPage: true } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: PURPLE } };
  sheet.getRow(1).height = 24;
  sheet.getRow(2).font = { size: 11, color: { argb: 'FF5E5650' } };
  for (let rowNumber = 3; rowNumber < headerRow - 1; rowNumber += 1) {
    if (widths.length > 1) sheet.mergeCells(rowNumber, 1, rowNumber, widths.length);
    const noteRow = sheet.getRow(rowNumber);
    noteRow.font = { bold: true, size: 11, color: { argb: 'FF6D4ECA' } };
    noteRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F5FF' } };
    noteRow.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    noteRow.height = 25;
  }
  const heading = sheet.getRow(headerRow);
  heading.font = { bold: true, color: { argb: WHITE } };
  heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
  heading.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  heading.height = 34;
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: Math.max(1, filterColumns) } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < headerRow) return;
    row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.eachCell(cell => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: BORDER } },
      };
    });
  });
}

function mergeAndStyle(sheet, range, value, style = {}) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0]);
  cell.value = value;
  Object.assign(cell, style);
  return cell;
}

function cardStyles(color, value = false) {
  return {
    font: { bold: true, size: value ? 22 : 11, color: { argb: value ? WHITE : color } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: value ? color : 'FFF7F5FF' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    },
  };
}

function addKpiCard(sheet, titleRange, valueRange, title, value, color) {
  mergeAndStyle(sheet, titleRange, title, cardStyles(color, false));
  mergeAndStyle(sheet, valueRange, value, cardStyles(color, true));
}

function addCellBar(sheet, row, { label, value, maxValue, color, startColumn = 5, endColumn = 14 }) {
  mergeAndStyle(sheet, `A${row}:C${row}`, label, {
    font: { bold: true, size: 11, color: { argb: INK } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  });
  sheet.getCell(row, 4).value = value;
  sheet.getCell(row, 4).font = { bold: true, size: 12, color: { argb: color } };
  sheet.getCell(row, 4).alignment = { horizontal: 'center', vertical: 'middle' };
  const segmentCount = endColumn - startColumn + 1;
  const filled = maxValue > 0 ? Math.round((value / maxValue) * segmentCount) : 0;
  for (let column = startColumn; column <= endColumn; column += 1) {
    const active = column - startColumn < filled;
    const cell = sheet.getCell(row, column);
    cell.value = null;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: active ? color : 'FFE8EAF2' } };
    cell.border = { right: { style: 'thin', color: { argb: WHITE } } };
  }
  sheet.getRow(row).height = 20;
}

function addExecutiveDashboard(sheet, report, startRow) {
  const { analytics, totals } = report;
  const { qualityTypeMatrix: matrix, relationshipSegments: segments } = analytics;
  const titleStyle = {
    font: { bold: true, size: 16, color: { argb: WHITE } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  };
  mergeAndStyle(sheet, `A${startRow}:N${startRow}`, 'תמונת מצב מנהלים', titleStyle);
  sheet.getRow(startRow).height = 30;
  mergeAndStyle(sheet, `A${startRow + 1}:N${startRow + 1}`, 'ניתוח איכות הקשר, אופן הקשר ועומק הקשר עם הלקוחות', {
    font: { size: 11, color: { argb: 'FF5E5650' } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  });

  addKpiCard(sheet, `A${startRow + 3}:C${startRow + 3}`, `A${startRow + 4}:C${startRow + 5}`, 'לקוחות פעילים בקשר', segments.activeClients, PURPLE);
  addKpiCard(sheet, `D${startRow + 3}:F${startRow + 3}`, `D${startRow + 4}:F${startRow + 5}`, 'קשרים תורניים', matrix.torani.total, INDIGO);
  addKpiCard(sheet, `G${startRow + 3}:I${startRow + 3}`, `G${startRow + 4}:I${startRow + 5}`, 'קשרים ידידותיים', matrix.friendly.total, TEAL);
  addKpiCard(sheet, `J${startRow + 3}:N${startRow + 3}`, `J${startRow + 4}:N${startRow + 5}`, 'סך כל הקשרים', totals.totalInteractions, AMBER);

  const qualityTitleRow = startRow + 7;
  mergeAndStyle(sheet, `A${qualityTitleRow}:N${qualityTitleRow}`, 'קשרים לפי איכות ואופן הקשר', {
    font: { bold: true, size: 13, color: { argb: PURPLE } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  });
  const qualityRows = [
    ['תורני · פרונטלי', matrix.torani.frontal, INDIGO],
    ['ידידותי · פרונטלי', matrix.friendly.frontal, TEAL],
    ['תורני · וידאו', matrix.torani.video, INDIGO],
    ['ידידותי · וידאו', matrix.friendly.video, TEAL],
    ['תורני · טלפוני', matrix.torani.phone, INDIGO],
    ['ידידותי · טלפוני', matrix.friendly.phone, TEAL],
    ['תורני · סוגים נוספים', matrix.torani.other, INDIGO],
    ['ידידותי · קשר בסיס / סוגים נוספים', matrix.friendly.other, TEAL],
  ];
  const qualityMax = Math.max(1, ...qualityRows.map(([, value]) => value));
  qualityRows.forEach(([label, value, color], index) => addCellBar(sheet, qualityTitleRow + 2 + index, {
    label, value, maxValue: qualityMax, color,
  }));
  mergeAndStyle(sheet, `A${qualityTitleRow + 11}:N${qualityTitleRow + 11}`, 'קשר בסיס ידידותי נספר ללקוח ללא קשר מתועד; סוגים נוספים כוללים אירוח שבת וכל סוג שאינו פרונטלי, וידאו או טלפוני.', {
    font: { italic: true, size: 10, color: { argb: 'FF6B6574' } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  });

  const distributionTitleRow = qualityTitleRow + 13;
  mergeAndStyle(sheet, `A${distributionTitleRow}:N${distributionTitleRow}`, 'התפלגות לקוחות לפי מספר קשרים', {
    font: { bold: true, size: 13, color: { argb: PURPLE } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } },
    alignment: { horizontal: 'right', vertical: 'middle' },
  });
  const distributionMax = Math.max(1, ...analytics.clientConnectionDistribution.map(bucket => bucket.count));
  analytics.clientConnectionDistribution.forEach((bucket, index) => addCellBar(sheet, distributionTitleRow + 2 + index, {
    label: bucket.label,
    value: bucket.count,
    maxValue: distributionMax,
    color: AMBER,
  }));

  const diagramTitleRow = distributionTitleRow + 10;
  mergeAndStyle(sheet, `A${diagramTitleRow}:N${diagramTitleRow}`, 'מפת עומק הקשר עם הלקוחות', titleStyle);
  addKpiCard(sheet, `C${diagramTitleRow + 2}:L${diagramTitleRow + 2}`, `C${diagramTitleRow + 3}:L${diagramTitleRow + 4}`, 'קשר כללי · נתון הנהלה משוער', segments.generalRelationships, PURPLE);
  mergeAndStyle(sheet, `F${diagramTitleRow + 5}:I${diagramTitleRow + 5}`, '↓ מידע מתועד ב־CRM', {
    font: { bold: true, size: 11, color: { argb: PURPLE } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  addKpiCard(sheet, `A${diagramTitleRow + 6}:F${diagramTitleRow + 6}`, `A${diagramTitleRow + 7}:F${diagramTitleRow + 8}`, 'קשר אישי תורני', segments.personalToraniClients, INDIGO);
  addKpiCard(sheet, `I${diagramTitleRow + 6}:N${diagramTitleRow + 6}`, `I${diagramTitleRow + 7}:N${diagramTitleRow + 8}`, 'קשר אישי ידידותי', segments.personalFriendlyClients, TEAL);
  mergeAndStyle(sheet, `A${diagramTitleRow + 10}:N${diagramTitleRow + 10}`, 'המאגר הכללי הוא נתון הנהלה משוער. כל לקוח מתועד נחשב לפחות לקשר בסיס ידידותי; קשר תורני אחד לפחות מסווג אותו כ״אישי תורני״.', {
    font: { size: 10, color: { argb: 'FF5E5650' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT_BG } },
    alignment: { horizontal: 'right', vertical: 'middle', wrapText: true },
  });
  sheet.getRow(diagramTitleRow + 10).height = 38;
  sheet.pageSetup.printArea = `A1:N${diagramTitleRow + 10}`;
}

function addReportHeading(sheet, title, range, disclosures) {
  sheet.addRow([title]);
  sheet.addRow([`טווח: ${range}`]);
  disclosures.forEach(note => sheet.addRow([`\u200F•\u00A0${note}`]));
  sheet.addRow([]);
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
  const disclosures = report.disclosures || [];

  const summary = workbook.addWorksheet('סיכום לפי פעיל');
  addReportHeading(summary, title, range, disclosures);
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
  styleWorksheet(summary, { headerRow: 6, widths: [25, 17, 15, 15, 16, 17, 13, 15, 14, 16, 21, 18] });
  summary.getColumn(11).numFmt = '0.00';
  summary.getColumn(12).numFmt = '0.00';

  const events = workbook.addWorksheet('התקדמות במצוות');
  addReportHeading(events, `${title} — אירועי התקדמות`, range, disclosures);
  events.addRow(['שם הפעיל', 'שם הלקוח', 'contact_id', 'מצווה', 'רמה קודמת', 'רמה חדשה', 'מספר רמות שעלו', 'תאריך השינוי']);
  report.mitzvotEvents.forEach(event => events.addRow([
    event.activistName, event.contactName, event.contactId, event.mitzva,
    event.oldLevel, event.newLevel, event.levelsGained, formatDisplayDate(event.date),
  ]));
  styleWorksheet(events, { headerRow: 6, widths: [24, 24, 14, 20, 14, 14, 19, 17] });

  const mitzvotSummary = workbook.addWorksheet('סיכום מצוות');
  addReportHeading(mitzvotSummary, `${title} — סיכום מצוות`, range, disclosures);
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
  styleWorksheet(mitzvotSummary, { headerRow: 6, widths: [24, 20, 19, 18, 20, 21] });

  const organizational = workbook.addWorksheet('סיכום ארגוני');
  addReportHeading(organizational, title, range, disclosures);
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
  styleWorksheet(organizational, {
    headerRow: 6,
    filterColumns: 2,
    widths: [18, 18, 18, 13, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
  });
  organizational.getColumn(2).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  const organizationalSummaryRow = organizational.rowCount;
  organizational.mergeCells(`B${organizationalSummaryRow}:N${organizationalSummaryRow}`);
  organizational.getRow(organizationalSummaryRow).height = 54;
  addExecutiveDashboard(organizational, report, organizationalSummaryRow + 3);

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
