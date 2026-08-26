const { formatDisplayDate } = require('./interactionReport');

const FONT_NAME = 'NotoSansHebrew';
const FONT_FILE = 'NotoSansHebrew-Regular.ttf';
const FONT_URL = `/fonts/${FONT_FILE}`;

function rangeLabel(report) {
  const { startDate, endDate } = report.meta;
  if (!startDate && !endDate) return 'כל ההיסטוריה הקיימת במערכת';
  return `${startDate ? formatDisplayDate(startDate) : 'תחילת ההיסטוריה'}–${endDate ? formatDisplayDate(endDate) : 'היום'}`;
}

function buildInteractionPdfModel(report) {
  const mainHeaders = [
    'שם הפעיל', 'לקוחות', 'סה״כ קשרים', 'תורני', 'ידידותי', 'פרונטלי',
    'וידאו', 'טלפוני', 'אירוח שבת', 'סך דקות', 'ממוצע ללקוח', 'ממוצע משך',
  ];
  const mainRow = row => [
    row.activistName,
    row.totalClients,
    row.totalInteractions,
    row.toraniCount,
    row.friendlyCount,
    row.frontalCount,
    row.videoCount,
    row.phoneCount,
    row.shabbatHostCount,
    row.totalMinutes,
    Number(row.averageInteractionsPerClient.toFixed(2)),
    Number(row.averageDuration.toFixed(2)),
  ];
  const mitzvotHeaders = ['פעיל', 'מצווה', 'מספר רמות', 'לקוחות ייחודיים', 'אירועי עלייה', 'סך רמות'];
  const mitzvotRow = row => [
    row.activistName,
    row.mitzva,
    row.levelsGained,
    row.uniqueClients,
    row.eventCount,
    row.totalLevels,
  ];
  return {
    projectName: report.meta.projectName,
    range: rangeLabel(report),
    summarySentence: report.summarySentence,
    main: {
      headers: mainHeaders,
      rows: report.rows.map(mainRow),
      totalRow: mainRow(report.totals),
    },
    mitzvot: {
      headers: mitzvotHeaders,
      rows: report.mitzvotTotals.map(mitzvotRow),
    },
  };
}

function binaryToBase64(binary) {
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let output = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(output);
}

async function loadFontBinary(fontBinary) {
  if (fontBinary) return fontBinary;
  const response = await fetch(FONT_URL, { cache: 'force-cache' });
  if (!response.ok) throw new Error('טעינת הגופן העברי ל־PDF נכשלה.');
  return new Uint8Array(await response.arrayBuffer());
}

async function buildInteractionReportPdf(report, { fontBinary } = {}) {
  const [{ jsPDF }, autoTableModule, font] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadFontBinary(fontBinary),
  ]);
  const autoTable = autoTableModule.autoTable || autoTableModule.default;
  const model = buildInteractionPdfModel(report);
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3',
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS(FONT_FILE, binaryToBase64(font));
  doc.addFont(FONT_FILE, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME, 'normal');
  doc.setR2L(true);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const right = pageWidth - 15;
  const purple = [58, 36, 155];
  const lightPurple = [240, 239, 254];

  doc.setTextColor(...purple);
  doc.setFontSize(18);
  doc.text(`דו״ח קשרים — ${model.projectName}`, right, 16, { align: 'right' });
  doc.setTextColor(70, 65, 62);
  doc.setFontSize(10);
  doc.text(`טווח: ${model.range}`, right, 24, { align: 'right' });
  doc.setFontSize(9.5);
  const summaryLines = doc.splitTextToSize(model.summarySentence, pageWidth - 30);
  doc.text(summaryLines, right, 32, { align: 'right', lineHeightFactor: 1.4 });

  const mainStartY = 34 + summaryLines.length * 5;
  autoTable(doc, {
    startY: mainStartY,
    head: [model.main.headers],
    body: [...model.main.rows, model.main.totalRow],
    theme: 'grid',
    margin: { top: 14, right: 12, bottom: 14, left: 12 },
    styles: {
      font: FONT_NAME,
      fontStyle: 'normal',
      fontSize: 7.4,
      cellPadding: 1.5,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak',
      textColor: [35, 31, 29],
      lineColor: [218, 210, 204],
      lineWidth: 0.15,
    },
    headStyles: { fillColor: purple, textColor: [255, 255, 255], font: FONT_NAME, fontStyle: 'normal' },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === model.main.rows.length) {
        data.cell.styles.fillColor = lightPurple;
        data.cell.styles.textColor = purple;
      }
      if (data.column.index === 0) data.cell.styles.halign = 'right';
    },
  });

  doc.addPage('a3', 'landscape');
  doc.setFont(FONT_NAME, 'normal');
  doc.setR2L(true);
  doc.setTextColor(...purple);
  doc.setFontSize(16);
  doc.text('סיכום התקדמות במצוות — כל הפעילים', right, 17, { align: 'right' });
  doc.setTextColor(70, 65, 62);
  doc.setFontSize(10);
  doc.text(`פרויקט: ${model.projectName} · טווח: ${model.range}`, right, 25, { align: 'right' });

  if (model.mitzvot.rows.length > 0) {
    autoTable(doc, {
      startY: 32,
      head: [model.mitzvot.headers],
      body: model.mitzvot.rows,
      theme: 'grid',
      margin: { top: 14, right: 18, bottom: 14, left: 18 },
      styles: {
        font: FONT_NAME,
        fontStyle: 'normal',
        fontSize: 9,
        cellPadding: 2.2,
        halign: 'center',
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: [218, 210, 204],
        lineWidth: 0.15,
      },
      headStyles: { fillColor: purple, textColor: [255, 255, 255], font: FONT_NAME, fontStyle: 'normal' },
      alternateRowStyles: { fillColor: [250, 247, 243] },
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      didParseCell(data) {
        if (data.column.index === 0 || data.column.index === 1) data.cell.styles.halign = 'right';
      },
    });
  } else {
    doc.setTextColor(90, 84, 80);
    doc.setFontSize(11);
    doc.text('אין התקדמויות במצוות בטווח שנבחר.', right, 39, { align: 'right' });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT_NAME, 'normal');
    doc.setR2L(true);
    doc.setTextColor(110, 103, 98);
    doc.setFontSize(8);
    doc.text(`עמוד ${page} מתוך ${pageCount}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

function fileSuffix(report) {
  const { startDate, endDate } = report.meta;
  return startDate || endDate ? `${startDate || 'התחלה'}-${endDate || 'היום'}` : 'כל-ההיסטוריה';
}

async function downloadInteractionReportPdf(report) {
  const bytes = await buildInteractionReportPdf(report);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `דו״ח-קשרים-אחדות-יהודית-${fileSuffix(report)}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

module.exports = {
  buildInteractionPdfModel,
  buildInteractionReportPdf,
  downloadInteractionReportPdf,
};
