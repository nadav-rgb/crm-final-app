import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const fontPath = path.join(root, 'public', 'fonts', 'Assistant-Regular.ttf');
const generatorPath = path.join(root, 'lib', 'interactionReportPdf.js');
const pdf = require(generatorPath);

const baseRow = Object.freeze({
  activistName: 'דוד כהן',
  totalClients: 2,
  totalInteractions: 10,
  toraniCount: 5,
  friendlyCount: 5,
  frontalCount: 3,
  videoCount: 2,
  phoneCount: 3,
  shabbatHostCount: 2,
  totalMinutes: 100,
  averageInteractionsPerClient: 5,
  averageDuration: 10,
});

function buildPdfFixture({ mitzvotRows = 4 } = {}) {
  return {
    meta: {
      projectName: 'אחדות יהודית',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    },
    disclosures: [
      'האפליקציה עדיין בפיילוט ראשוני, הערכה שמשקפת 75% מהקשרים והלקוחות האמיתיים',
      'האפליקציה עלתה לאוויר לפני כחודש וחצי',
    ],
    summarySentence: 'בטווח שנבחר נרשמו 10 קשרים, ובהם 5 קשרים תורניים.',
    rows: [baseRow],
    totals: { ...baseRow, activistName: 'סה״כ כל הפעילים' },
    mitzvotTotals: Array.from({ length: mitzvotRows }, (_, index) => ({
      activistName: `פעיל ${String(index + 1).padStart(3, '0')}`,
      mitzva: `מצווה ${String(index + 1).padStart(3, '0')}`,
      levelsGained: index + 1,
      uniqueClients: index + 2,
      eventCount: index + 3,
      totalLevels: index + 4,
    })),
  };
}

function readFont() {
  assert.equal(fs.existsSync(fontPath), true, 'Assistant TTF must exist');
  return fs.readFileSync(fontPath);
}

function pdfSource(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

function pdfStreams(bytes) {
  const buffer = Buffer.from(bytes);
  const streams = [];
  const streamMarker = Buffer.from('stream\n');
  const endMarker = Buffer.from('endstream');
  let cursor = 0;

  while ((cursor = buffer.indexOf(streamMarker, cursor)) >= 0) {
    const start = cursor + streamMarker.length;
    const end = buffer.indexOf(endMarker, start);
    if (end < 0) break;
    let data = buffer.subarray(start, end);
    while (data.at(-1) === 10 || data.at(-1) === 13) data = data.subarray(0, -1);
    try {
      streams.push(inflateSync(data).toString('latin1'));
    } catch {
      streams.push(data.toString('latin1'));
    }
    cursor = end + endMarker.length;
  }

  return streams;
}

function extractPdfTextRuns(bytes) {
  const streams = pdfStreams(bytes);
  const cmap = streams.find((stream) => stream.includes('begincmap'));
  assert.ok(cmap, 'embedded Assistant font must include a ToUnicode CMap');
  const characters = new Map(
    [...cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4,8})>/gi)].map((match) => [
      match[1].toLowerCase(),
      Buffer.from(match[2], 'hex').swap16().toString('utf16le'),
    ]),
  );

  return streams
    .filter((stream) => stream.includes(' Tj'))
    .flatMap((stream) => [...stream.matchAll(/<([0-9a-f]+)>\s*Tj/gi)])
    .map((match) => match[1].match(/.{4}/g)?.map((code) => characters.get(code.toLowerCase()) || '').join('') || '');
}

function hasTextRun(runs, value) {
  const expected = String(value);
  const reversed = [...expected].reverse().join('');
  return runs.includes(expected) || runs.includes(reversed);
}

function findHeadlessBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

test('Node generator preserves the patched jsPDF report contract', async () => {
  const report = buildPdfFixture({ mitzvotRows: 140 });
  report.mitzvotTotals.forEach((row, index) => {
    row.totalLevels = 700_001 + index;
  });
  const model = pdf.buildInteractionPdfModel(report);
  const bytes = await pdf.buildInteractionReportPdf(report, { fontBinary: readFont() });
  const source = pdfSource(bytes);
  const textRuns = extractPdfTextRuns(bytes);
  const pageCount = (source.match(/\/Type \/Page\b/g) || []).length;

  assert.equal(Buffer.from(bytes).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(bytes.length > 10_000, 'PDF output must not be empty or truncated');
  assert.match(source, /\/MediaBox \[0 0 1190\.5\d* 841\.8\d*/);
  assert.match(source, /\/FontName \/Assistant/);
  assert.ok(1190.55 > 841.89, 'A3 output must remain landscape');
  assert.ok(pageCount > 2, 'production fixture must render across multiple pages');

  const repeatedHeaderCount = textRuns.filter((run) => hasTextRun([run], 'סך רמות')).length;
  assert.equal(repeatedHeaderCount, pageCount - 1, 'mitzvot header must repeat on every continuation page');
  for (const row of report.mitzvotTotals) {
    assert.equal(hasTextRun(textRuns, row.totalLevels), true, `rendered PDF must retain row ${row.totalLevels}`);
  }

  assert.equal(model.main.rows[0][0], 'דוד כהן');
  assert.equal(model.main.rows[0][2], 10);
  assert.equal(model.main.totalRow[2], 10);
  assert.equal(model.summarySentence, report.summarySentence);
  assert.deepEqual(model.disclosures, report.disclosures);
});

test('Assistant font and RTL helpers preserve Hebrew, digits, decimals, and punctuation', async () => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.addFileToVFS('Assistant-Regular.ttf', readFont().toString('base64'));
  doc.addFont('Assistant-Regular.ttf', 'Assistant', 'normal');
  doc.setFont('Assistant', 'normal');

  const metadata = doc.internal.getFont().metadata;
  for (const character of ['ש', 'ם', '1', '7', '.', '״']) {
    assert.ok(metadata.characterToGlyph(character.codePointAt(0)) > 0, `Assistant must contain ${character}`);
  }

  assert.deepEqual(
    pdf.formatPdfRtlTableRow(['שם הפעיל', 234, 13.37]),
    ['73.31', '432', 'שם הפעיל'],
  );
  assert.deepEqual(pdf.formatPdfRtlBullet('טקסט בעברית'), {
    bullet: '•',
    text: 'טקסט בעברית',
  });
});

test('AutoTable preserves every row, repeated headers, row boundaries, and A3 page bounds', async () => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3',
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS('Assistant-Regular.ttf', readFont().toString('base64'));
  doc.addFont('Assistant-Regular.ttf', 'Assistant', 'normal');
  doc.setFont('Assistant', 'normal');
  doc.setR2L(true);

  const logicalHeaders = ['פעיל', 'מצווה', 'מספר רמות', 'לקוחות ייחודיים', 'אירועי עלייה', 'סך רמות'];
  const logicalRows = buildPdfFixture({ mitzvotRows: 140 }).mitzvotTotals.map((row) => [
    row.activistName,
    row.mitzva,
    row.levelsGained,
    row.uniqueClients,
    row.eventCount,
    row.totalLevels,
  ]);
  const renderedRows = new Map();
  const headerPages = new Set();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  autoTable(doc, {
    startY: 32,
    head: [pdf.formatPdfRtlTableRow(logicalHeaders)],
    body: logicalRows.map(pdf.formatPdfRtlTableRow),
    theme: 'grid',
    margin: { top: 14, right: 18, bottom: 14, left: 18 },
    styles: {
      font: 'Assistant',
      fontStyle: 'normal',
      fontSize: 9,
      cellPadding: 2.2,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak',
    },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    didDrawCell(data) {
      const right = data.cell.x + data.cell.width;
      const bottom = data.cell.y + data.cell.height;
      assert.ok(data.cell.x >= 0 && right <= pageWidth + 0.01, 'table cell must remain within horizontal page bounds');
      assert.ok(data.cell.y >= 0 && bottom <= pageHeight - 13.99, 'table cell must remain above the bottom margin');

      if (data.section === 'head' && data.column.index === 0) headerPages.add(data.pageNumber);
      if (data.section === 'body' && data.column.index === 0) {
        const pages = renderedRows.get(data.row.index) || new Set();
        pages.add(data.pageNumber);
        renderedRows.set(data.row.index, pages);
      }
    },
  });

  assert.ok(doc.getNumberOfPages() > 1, 'fixture must force multiple pages');
  assert.equal(headerPages.size, doc.getNumberOfPages(), 'header must be drawn on every table page');
  assert.equal(renderedRows.size, logicalRows.length, 'every fixture row must be drawn');
  assert.deepEqual([...renderedRows.keys()], Array.from({ length: logicalRows.length }, (_, index) => index));
  for (const pages of renderedRows.values()) {
    assert.equal(pages.size, 1, 'rowPageBreak=avoid must keep each fixture row on one page');
  }

  function renderBoundaryRow(rowPageBreak) {
    const boundaryDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    boundaryDoc.addFileToVFS('Assistant-Regular.ttf', readFont().toString('base64'));
    boundaryDoc.addFont('Assistant-Regular.ttf', 'Assistant', 'normal');
    boundaryDoc.setFont('Assistant', 'normal');
    boundaryDoc.setR2L(true);
    const rowPages = new Set();
    const longCell = Array.from({ length: 18 }, () => 'שורה ארוכה לבדיקת מעבר עמוד').join('\n');

    autoTable(boundaryDoc, {
      startY: 220,
      head: [pdf.formatPdfRtlTableRow(logicalHeaders)],
      body: [pdf.formatPdfRtlTableRow(['פעיל גבול', longCell, 1, 2, 3, 4])],
      margin: { top: 14, right: 18, bottom: 14, left: 18 },
      styles: { font: 'Assistant', fontStyle: 'normal', fontSize: 9, cellPadding: 2.2 },
      rowPageBreak,
      showHead: 'everyPage',
      didDrawCell(data) {
        if (data.section === 'body' && data.column.index === 0) rowPages.add(data.pageNumber);
      },
    });
    return rowPages;
  }

  const splitControlPages = renderBoundaryRow('auto');
  const avoidedPages = renderBoundaryRow('avoid');
  assert.ok(splitControlPages.size > 1, 'control row must split when rowPageBreak is not avoid');
  assert.equal(avoidedPages.size, 1, 'rowPageBreak=avoid must move the fitting long row intact');
  assert.ok([...avoidedPages][0] > 1, 'the intact long row must move to the next page');
});

test('browser download API contract creates a valid PDF Blob in a Node DOM harness', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  const font = readFont();
  let capturedBlob;
  let clicked = false;
  let appended = false;
  let removed = false;
  let revoked = false;
  const anchor = {
    href: '',
    download: '',
    click() { clicked = true; },
    remove() { removed = true; },
  };

  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/fonts/Assistant-Regular.ttf');
      assert.deepEqual(options, { cache: 'force-cache' });
      return {
        ok: true,
        async arrayBuffer() {
          return font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        },
      };
    };
    globalThis.document = {
      createElement(tag) {
        assert.equal(tag, 'a');
        return anchor;
      },
      body: {
        appendChild(value) {
          assert.equal(value, anchor);
          appended = true;
        },
      },
    };
    URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return 'blob:jspdf-compatibility';
    };
    URL.revokeObjectURL = (url) => {
      assert.equal(url, 'blob:jspdf-compatibility');
      revoked = true;
    };
    globalThis.setTimeout = (callback) => {
      callback();
      return 0;
    };

    await pdf.downloadInteractionReportPdf(buildPdfFixture());

    assert.ok(capturedBlob instanceof Blob);
    assert.equal(capturedBlob.type, 'application/pdf');
    assert.equal(Buffer.from(await capturedBlob.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(anchor.href, 'blob:jspdf-compatibility');
    assert.match(anchor.download, /^דו״ח-קשרים-אחדות-יהודית-.+\.pdf$/);
    assert.equal(clicked && appended && removed && revoked, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    globalThis.setTimeout = originalSetTimeout;
  }
});

const headlessBrowser = findHeadlessBrowser();
test('real browser bundle generates the production PDF through the btoa path', {
  skip: headlessBrowser ? false : 'Chrome or Edge is required for real browser PDF verification',
}, async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-jspdf-browser-'));
  const entryPath = path.join(temporaryRoot, 'entry.js');
  const bundlePath = path.join(temporaryRoot, 'bundle.js');
  const htmlPath = path.join(temporaryRoot, 'index.html');
  const profilePath = path.join(temporaryRoot, 'browser-profile');
  const browserReport = buildPdfFixture({ mitzvotRows: 80 });
  const entry = `
    const { buildInteractionReportPdf } = require(${JSON.stringify(generatorPath)});
    const fontBinary = Uint8Array.from(atob(${JSON.stringify(readFont().toString('base64'))}), character => character.charCodeAt(0));
    const report = ${JSON.stringify(browserReport)};
    (async () => {
      const bytes = await buildInteractionReportPdf(report, { fontBinary });
      const source = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      const result = {
        ok: true,
        signature: source.slice(0, 5),
        byteLength: bytes.byteLength,
        blobSize: blob.size,
        blobType: blob.type,
        pageCount: (source.match(/\\/Type \\/Page\\b/g) || []).length,
        assistantEmbedded: source.includes('/FontName /Assistant'),
        usedBrowserBase64Path: typeof Buffer === 'undefined',
      };
      URL.revokeObjectURL(objectUrl);
      document.body.dataset.result = btoa(JSON.stringify(result));
    })().catch(error => {
      document.body.dataset.error = btoa(String(error && error.stack || error));
    });
  `;

  try {
    fs.writeFileSync(entryPath, entry, 'utf8');
    fs.writeFileSync(htmlPath, '<!doctype html><html><body><script src="./bundle.js"></script></body></html>', 'utf8');

    const webpackBridge = require('next/dist/compiled/webpack/webpack');
    await new Promise((resolve, reject) => {
      webpackBridge.webpack({
        mode: 'production',
        target: ['web', 'es2020'],
        devtool: false,
        entry: entryPath,
        output: {
          path: temporaryRoot,
          filename: path.basename(bundlePath),
          chunkFilename: '[name].js',
          publicPath: '',
        },
        optimization: { minimize: false },
        plugins: [new webpackBridge.LimitChunkCountPlugin({ maxChunks: 1 })],
      }, (error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors()) {
          return reject(new Error(stats.toString({ all: false, errors: true, warnings: true })));
        }
        return resolve();
      });
    });

    const browser = spawnSync(headlessBrowser, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--allow-file-access-from-files',
      `--user-data-dir=${profilePath}`,
      '--virtual-time-budget=10000',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

    assert.equal(browser.status, 0, browser.stderr || browser.error?.message);
    const encodedResult = browser.stdout.match(/data-result="([^"]+)"/)?.[1];
    const encodedError = browser.stdout.match(/data-error="([^"]+)"/)?.[1];
    assert.equal(encodedError, undefined, encodedError ? Buffer.from(encodedError, 'base64').toString('utf8') : '');
    assert.ok(encodedResult, `browser result missing from DOM: ${browser.stdout.slice(-1000)}`);
    const result = JSON.parse(Buffer.from(encodedResult, 'base64').toString('utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.signature, '%PDF-');
    assert.ok(result.byteLength > 10_000);
    assert.equal(result.blobSize, result.byteLength);
    assert.equal(result.blobType, 'application/pdf');
    assert.ok(result.pageCount > 2);
    assert.equal(result.assistantEmbedded, true);
    assert.equal(result.usedBrowserBase64Path, true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('PDF generator keeps the restricted output and feature surface', () => {
  const source = fs.readFileSync(generatorPath, 'utf8');
  const outputCalls = [...source.matchAll(/doc\s*(?:\.\s*output|\[\s*['"]output['"]\s*\])\s*\(/g)];
  const outputModes = [...source.matchAll(/doc\.output\(\s*(['"])([^'"]+)\1\s*\)/g)].map((match) => match[2]);

  assert.equal(outputCalls.length, 1, 'generator must have exactly one statically-auditable output call');
  assert.deepEqual(outputModes, ['arraybuffer']);
  assert.doesNotMatch(source, /pdfobjectnewwindow|pdfjsnewwindow|dataurlnewwindow|datauristring|dataurlstring/i);
  assert.doesNotMatch(source, /(?:\.|\[\s*['"])(?:addJS|html)(?:['"]\s*\])?\s*\(|AcroForm|FreeText/i);
  assert.equal((source.match(/rowPageBreak:\s*['"]avoid['"]/g) || []).length, 2);
  assert.equal((source.match(/showHead:\s*['"]everyPage['"]/g) || []).length, 2);
  assert.equal((source.match(/\bautoTable\(doc,\s*\{/g) || []).length, 2);
});
