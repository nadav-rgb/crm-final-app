const { formatDisplayDate } = require('./interactionReport');

const FONT_NAME = 'Assistant';
const FONT_FILE = 'Assistant-Regular.ttf';
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
    disclosures: report.disclosures || [],
    summarySentence: report.summarySentence,
    analytics: report.analytics,
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

// jsPDF reverses numeric-only runs when global RTL mode is enabled. Supplying
// those runs in reverse preserves their visual left-to-right order in the PDF.
function formatPdfTableValue(value) {
  if (typeof value !== 'number') return value;
  return [...String(value)].reverse().join('');
}

function formatPdfRtlTableRow(row) {
  return row.map(formatPdfTableValue).reverse();
}

function formatPdfRtlTableRows(rows) {
  return rows.map(formatPdfRtlTableRow);
}

function formatPdfRtlBullet(text) {
  return { bullet: '•', text };
}

function drawRtlText(doc, text, right, y, options = {}) {
  doc.setR2L(true);
  doc.text(String(text), right, y, { align: 'right', ...options });
}

function drawPdfNumber(doc, value, x, y, options = {}) {
  doc.setR2L(false);
  doc.text(Number(value).toLocaleString('he-IL'), x, y, { align: 'center', ...options });
  doc.setR2L(true);
}

function drawExecutiveCard(doc, { x, y, width, height, label, value, color, fontName }) {
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...color);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, width, height, 2.5, 2.5, 'FD');
  doc.setFont(fontName, 'normal');
  doc.setTextColor(...color);
  doc.setFontSize(10.5);
  drawRtlText(doc, label, x + width - 5, y + 8);
  doc.setFontSize(21);
  drawPdfNumber(doc, value, x + width / 2, y + 19.5);
}

function drawHorizontalBar(doc, { label, value, maxValue, right, y, barWidth, color, fontName }) {
  const width = maxValue > 0 ? (value / maxValue) * barWidth : 0;
  doc.setFont(fontName, 'normal');
  doc.setTextColor(48, 43, 55);
  doc.setFontSize(9);
  drawRtlText(doc, label, right, y + 3.8);
  const barRight = right - 42;
  doc.setFillColor(232, 234, 242);
  doc.roundedRect(barRight - barWidth, y, barWidth, 5, 1.2, 1.2, 'F');
  if (width > 0) {
    doc.setFillColor(...color);
    doc.roundedRect(barRight - width, y, width, 5, 1.2, 1.2, 'F');
  }
  doc.setTextColor(...color);
  doc.setFontSize(9.5);
  drawPdfNumber(doc, value, barRight - barWidth - 8, y + 4.1);
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
  let contentY = 31;
  doc.setTextColor(...purple);
  doc.setFontSize(9.5);
  model.disclosures.forEach(note => {
    const disclosure = formatPdfRtlBullet(note);
    const noteLines = doc.splitTextToSize(disclosure.text, pageWidth - 36);
    doc.text(disclosure.bullet, right, contentY, { align: 'right' });
    doc.text(noteLines, right - 4, contentY, { align: 'right', lineHeightFactor: 1.35 });
    contentY += noteLines.length * 4.5 + 1;
  });
  doc.setFontSize(9.5);
  doc.setTextColor(70, 65, 62);
  const summaryLines = doc.splitTextToSize(model.summarySentence, pageWidth - 30);
  doc.text(summaryLines, right, contentY + 1, { align: 'right', lineHeightFactor: 1.4 });

  const mainStartY = contentY + 3 + summaryLines.length * 5;
  autoTable(doc, {
    startY: mainStartY,
    head: [formatPdfRtlTableRow(model.main.headers)],
    body: formatPdfRtlTableRows([...model.main.rows, model.main.totalRow]),
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
      if (data.column.index === model.main.headers.length - 1) data.cell.styles.halign = 'right';
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
      head: [formatPdfRtlTableRow(model.mitzvot.headers)],
      body: formatPdfRtlTableRows(model.mitzvot.rows),
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
        if (data.column.index >= model.mitzvot.headers.length - 2) data.cell.styles.halign = 'right';
      },
    });
  } else {
    doc.setTextColor(90, 84, 80);
    doc.setFontSize(11);
    doc.text('אין התקדמויות במצוות בטווח שנבחר.', right, 39, { align: 'right' });
  }

  doc.addPage('a3', 'landscape');
  doc.setFont(FONT_NAME, 'normal');
  doc.setR2L(true);
  const analytics = model.analytics;
  const segments = analytics.relationshipSegments;
  const matrix = analytics.qualityTypeMatrix;
  const indigo = [79, 70, 229];
  const teal = [15, 118, 110];
  const amber = [217, 119, 6];
  const ink = [33, 31, 45];
  const soft = [248, 250, 252];

  doc.setFillColor(...soft);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  doc.setTextColor(...purple);
  doc.setFontSize(18);
  drawRtlText(doc, 'תמונת מצב מנהלים', right, 17);
  doc.setTextColor(83, 76, 92);
  doc.setFontSize(10);
  drawRtlText(doc, `פרויקט: ${model.projectName} · טווח: ${model.range}`, right, 25);

  const cardGap = 5;
  const cardWidth = (pageWidth - 30 - cardGap * 3) / 4;
  const cardY = 33;
  const cards = [
    { label: 'לקוחות פעילים בקשר', value: segments.activeClients, color: purple },
    { label: 'קשרים תורניים', value: matrix.torani.total, color: indigo },
    { label: 'קשרים ידידותיים', value: matrix.friendly.total, color: teal },
    { label: 'סך כל הקשרים', value: model.main.totalRow[2], color: amber },
  ];
  cards.forEach((card, index) => drawExecutiveCard(doc, {
    x: pageWidth - 15 - cardWidth - index * (cardWidth + cardGap),
    y: cardY,
    width: cardWidth,
    height: 25,
    ...card,
    fontName: FONT_NAME,
  }));

  const panelY = 67;
  const panelHeight = 99;
  const panelGap = 8;
  const panelWidth = (pageWidth - 30 - panelGap) / 2;
  const qualityPanelX = pageWidth - 15 - panelWidth;
  const distributionPanelX = 15;
  [qualityPanelX, distributionPanelX].forEach(x => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(221, 226, 236);
    doc.roundedRect(x, panelY, panelWidth, panelHeight, 3, 3, 'FD');
  });

  doc.setTextColor(...purple);
  doc.setFontSize(13);
  drawRtlText(doc, 'קשרים לפי איכות ואופן הקשר', qualityPanelX + panelWidth - 7, panelY + 10);
  doc.setFontSize(8.5);
  doc.setTextColor(...indigo);
  drawRtlText(doc, '■ תורני', qualityPanelX + panelWidth - 7, panelY + 18);
  doc.setTextColor(...teal);
  drawRtlText(doc, '■ ידידותי', qualityPanelX + panelWidth - 48, panelY + 18);
  const qualityRows = [
    ['פרונטלי', matrix.torani.frontal, matrix.friendly.frontal],
    ['וידאו', matrix.torani.video, matrix.friendly.video],
    ['טלפוני', matrix.torani.phone, matrix.friendly.phone],
    ['סוגים נוספים', matrix.torani.other, matrix.friendly.other],
  ];
  const qualityMax = Math.max(1, ...qualityRows.flatMap(([, torani, friendly]) => [torani, friendly]));
  qualityRows.forEach(([label, toraniValue, friendlyValue], index) => {
    const baseY = panelY + 27 + index * 16;
    drawHorizontalBar(doc, {
      label: `תורני · ${label}`,
      value: toraniValue,
      maxValue: qualityMax,
      right: qualityPanelX + panelWidth - 7,
      y: baseY,
      barWidth: panelWidth - 73,
      color: indigo,
      fontName: FONT_NAME,
    });
    drawHorizontalBar(doc, {
      label: `ידידותי · ${label}`,
      value: friendlyValue,
      maxValue: qualityMax,
      right: qualityPanelX + panelWidth - 7,
      y: baseY + 7,
      barWidth: panelWidth - 73,
      color: teal,
      fontName: FONT_NAME,
    });
  });
  doc.setTextColor(101, 94, 110);
  doc.setFontSize(8);
  drawRtlText(doc, 'קשר בסיס ידידותי נספר ללקוח ללא קשר מתועד; ״נוספים״ כוללים אירוח שבת וסוגי קשר נוספים.', qualityPanelX + panelWidth - 7, panelY + panelHeight - 6);

  doc.setTextColor(...purple);
  doc.setFontSize(13);
  drawRtlText(doc, 'התפלגות לקוחות לפי מספר קשרים', distributionPanelX + panelWidth - 7, panelY + 10);
  const distributionMax = Math.max(1, ...analytics.clientConnectionDistribution.map(bucket => bucket.count));
  analytics.clientConnectionDistribution.forEach((bucket, index) => drawHorizontalBar(doc, {
    label: bucket.label,
    value: bucket.count,
    maxValue: distributionMax,
    right: distributionPanelX + panelWidth - 7,
    y: panelY + 22 + index * 11.5,
    barWidth: panelWidth - 73,
    color: amber,
    fontName: FONT_NAME,
  }));
  doc.setTextColor(101, 94, 110);
  doc.setFontSize(8);
  drawRtlText(doc, `סה״כ ${segments.trackedClients} לקוחות מתועדים ב־CRM; כל לקוח נספר לפחות כקשר בסיס אחד.`, distributionPanelX + panelWidth - 7, panelY + panelHeight - 6);

  const diagramY = 177;
  doc.setTextColor(...purple);
  doc.setFontSize(13);
  drawRtlText(doc, 'מפת עומק הקשר עם הלקוחות', right, diagramY);
  const generalWidth = 150;
  const generalX = (pageWidth - generalWidth) / 2;
  drawExecutiveCard(doc, {
    x: generalX,
    y: diagramY + 8,
    width: generalWidth,
    height: 28,
    label: 'קשר כללי · נתון הנהלה משוער',
    value: segments.generalRelationships,
    color: purple,
    fontName: FONT_NAME,
  });
  doc.setDrawColor(...purple);
  doc.setLineWidth(0.7);
  doc.line(pageWidth / 2, diagramY + 36, pageWidth / 2, diagramY + 46);
  doc.line(pageWidth / 2, diagramY + 46, pageWidth / 2 - 72, diagramY + 46);
  doc.line(pageWidth / 2, diagramY + 46, pageWidth / 2 + 72, diagramY + 46);
  doc.line(pageWidth / 2 - 72, diagramY + 46, pageWidth / 2 - 72, diagramY + 52);
  doc.line(pageWidth / 2 + 72, diagramY + 46, pageWidth / 2 + 72, diagramY + 52);
  drawExecutiveCard(doc, {
    x: pageWidth / 2 + 9,
    y: diagramY + 52,
    width: 126,
    height: 28,
    label: 'קשר אישי תורני',
    value: segments.personalToraniClients,
    color: indigo,
    fontName: FONT_NAME,
  });
  drawExecutiveCard(doc, {
    x: pageWidth / 2 - 135,
    y: diagramY + 52,
    width: 126,
    height: 28,
    label: 'קשר אישי ידידותי',
    value: segments.personalFriendlyClients,
    color: teal,
    fontName: FONT_NAME,
  });
  doc.setTextColor(...ink);
  doc.setFontSize(8.5);
  const segmentNote = 'ה־850 הוא נתון הנהלה משוער וכולל את קבוצות הקשר האישי. כל לקוח מתועד נחשב לפחות לקשר בסיס ידידותי; קשר תורני אחד לפחות מסווג אותו כ״אישי תורני״.';
  const noteLines = doc.splitTextToSize(segmentNote, pageWidth - 50);
  doc.text(noteLines, right, diagramY + 89, { align: 'right', lineHeightFactor: 1.35 });

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
  formatPdfRtlTableRow,
  formatPdfTableValue,
  formatPdfRtlBullet,
};
