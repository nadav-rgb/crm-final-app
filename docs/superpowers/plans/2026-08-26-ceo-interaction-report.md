# CEO Interaction Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CEO-only live Supabase report for project 1 with complete interaction and mitzvot metrics plus one Excel download and one real Hebrew RTL PDF download.

**Architecture:** A JWT-protected API loads project 1 data with the Supabase admin client and passes it to one pure calculation module. The screen, Excel builder, PDF builder, and live artifact generator all consume the exact same calculated report object so numbers cannot diverge.

**Tech Stack:** Next.js 14 Pages Router, React 18, Supabase JS, Node `assert`, ExcelJS, jsPDF, jsPDF-AutoTable, embedded Noto Sans Hebrew TTF, existing CRM CSS tokens.

**Spec:** `docs/superpowers/specs/2026-08-26-ceo-interaction-report-design.md`

## Global Constraints

- The live `projects` table is the authority: “אחדות יהודית” must resolve to numeric `project_id=1`.
- Count every live `interactions` row, including rows with `participants.derived_from`.
- Count every project contact, including `is_active=false`.
- Never use `data/`, seed scripts, demo files, or generated local report files as report inputs.
- Never synthesize activist names. Missing live name mappings are fatal integrity errors.
- Do not load, display, calculate, or export `outcome`.
- Both date endpoints are inclusive; empty endpoints mean unbounded history.
- The screen, Excel, PDF, and summary sentence consume the same report object.
- Exactly one Excel file and one PDF file are produced per export action.
- Non-CEO users receive no report data from the API.
- Preserve all unrelated existing worktree changes.

---

## File Structure

- `lib/interactionReport.js` — pure validation, filtering, aggregation, summaries, and Hebrew sentence construction.
- `lib/interactionReportServer.js` — CEO authorization decision and live Supabase data loading with dependency injection for tests.
- `pages/api/reports/interaction-report.js` — JWT-authenticated HTTP boundary.
- `lib/interactionReportClient.js` — authenticated browser fetch wrapper.
- `lib/interactionReportExcel.js` — ExcelJS workbook builder and one-file browser download.
- `lib/interactionReportPdf.js` — jsPDF/AutoTable builder and one-file browser download.
- `public/fonts/NotoSansHebrew-Regular.ttf` — embedded Hebrew font used by the PDF.
- `pages/interaction-report.jsx` — CEO report page.
- `styles/components.css` — report layout, table, states, responsiveness.
- `components/DesktopLayout.jsx`, `pages/landing.jsx`, `components/MobileBottomNav.jsx` — CEO-only navigation entries.
- `scripts/verify-interaction-report.cjs` — deterministic calculation, authorization, Excel, and PDF regression tests.
- `scripts/generate-interaction-report-files.cjs` — read-only live Supabase loader that writes the final `.xlsx` and `.pdf` artifacts.
- `reports/דו״ח-קשרים-אחדות-יהודית.xlsx`, `reports/דו״ח-קשרים-אחדות-יהודית.pdf` — the final verified live artifacts.

### Task 1: Pure report calculations

**Files:**
- Modify: `lib/interactionReport.js`
- Modify: `scripts/verify-interaction-report.cjs`

**Interfaces:**
- Produces: `validateDateRange(startDate, endDate) -> { ok, error? }`
- Produces: `buildInteractionReport({ project, interactions, contacts, activists, startDate, endDate }) -> Report`
- `Report` contains `meta`, `rows`, `totals`, `summarySentence`, `mitzvotEvents`, `mitzvotRows`, and `mitzvotTotals`.

- [ ] **Step 1: Replace the current fixture with explicit mandatory scenarios**

Use a fixture with project 1, project 2, ten interactions for one contact, inclusive boundary dates, a derived interaction, an inactive contact, duplicated organizational contact references, two mitzvot for one contact, repeated rises, a drop, and an unchanged event. Assert:

```js
assert.equal(row.totalClients, 2);
assert.equal(row.totalInteractions, 10);
assert.equal(report.totals.totalClients, new Set(projectContacts.map(c => c.id)).size);
assert.equal(report.mitzvotEvents.find(e => e.oldLevel === 1 && e.newLevel === 4).levelsGained, 3);
assert.equal(report.mitzvotEvents.some(e => e.newLevel <= e.oldLevel), false);
assert.equal(report.rows.reduce((n, r) => n + r.totalInteractions, 0), report.totals.totalInteractions);
```

- [ ] **Step 2: Run the test and verify the current implementation fails**

Run: `node scripts/verify-interaction-report.cjs`

Expected: non-zero exit because the current code hard-codes project 2 defaults, invents names, counts clients from interactions, omits averages, and omits event detail.

- [ ] **Step 3: Implement strict date validation and name integrity**

Implement strict ISO validation without timezone conversion:

```js
function validateDateRange(startDate = '', endDate = '') {
  const valid = value => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!valid(startDate) || !valid(endDate)) return { ok: false, error: 'יש להזין תאריך תקין.' };
  if (startDate && endDate && startDate > endDate) return { ok: false, error: 'תאריך ההתחלה אינו יכול להיות מאוחר מתאריך הסיום.' };
  return { ok: true };
}
```

Build a `Map(Number(activist_code) -> trimmed name)` and throw an integrity error for every activist id in contacts/interactions that has no real name.

- [ ] **Step 4: Implement rows and totals from the correct sources**

Use contacts for `totalClients`, interactions for all interaction metrics, and the union of project activists plus ids appearing in live data. Do not filter `is_active`. Count derived rows normally. Recompute organizational averages from organizational numerators and denominators.

- [ ] **Step 5: Implement detailed mitzvot events and grouped summaries**

Normalize each valid rising history item to:

```js
{
  activistId, activistName, contactId, contactName,
  mitzva, oldLevel, newLevel,
  levelsGained: newLevel - oldLevel,
  date
}
```

Group per activist by `activistId|mitzva|levelsGained` and organizationally by `mitzva|levelsGained`, keeping `uniqueClients`, `eventCount`, and `totalLevels`.

- [ ] **Step 6: Implement the summary sentence and metadata**

Build the Hebrew sentence only from `totals`; set metadata to `projectId: 1`, live project name, the selected range, and record counts. Do not reference `outcome`.

- [ ] **Step 7: Run calculation tests**

Run: `node scripts/verify-interaction-report.cjs --section calculations`

Expected: all calculation/date/name/history tests pass.

### Task 2: CEO-only server API

**Files:**
- Create: `lib/interactionReportServer.js`
- Create: `pages/api/reports/interaction-report.js`
- Create: `lib/interactionReportClient.js`
- Modify: `scripts/verify-interaction-report.cjs`

**Interfaces:**
- Consumes: `buildInteractionReport(...)`, `validateDateRange(...)` from Task 1.
- Produces: `authorizeCeoProfile(profile) -> { ok, status, error? }`.
- Produces: `loadLiveInteractionReport({ supabase, startDate, endDate }) -> Report`.
- Produces: `fetchInteractionReport({ startDate, endDate }) -> Promise<Report>`.

- [ ] **Step 1: Write failing authorization and query tests**

Add assertions for missing profile, activist, coordinator, and CEO:

```js
assert.deepEqual(authorizeCeoProfile(null), { ok: false, status: 403, error: 'No profile' });
assert.equal(authorizeCeoProfile({ role: 'activist' }).status, 403);
assert.equal(authorizeCeoProfile({ role: 'ceo' }).ok, true);
```

Use a fake Supabase dependency to prove the loader requests project 1, all contacts without `is_active` filtering, interaction date `gte/lte`, and activist directory names.

- [ ] **Step 2: Run server tests and verify failure**

Run: `node scripts/verify-interaction-report.cjs --section server`

Expected: fail because server helpers and endpoint do not exist.

- [ ] **Step 3: Implement the injected server loader**

Query only required columns:

```js
projects: 'id,name'
contacts: 'id,name,activist_id,project_id,is_active,mitzvot_history'
interactions: 'id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants'
activist_directory: 'activist_code,name,role,project_id,project_ids'
```

Verify the returned live project row is exactly id 1 / “אחדות יהודית”. Throw a clear Hebrew error on any query failure or name-integrity failure.

- [ ] **Step 4: Implement the API route**

Accept `GET` only. Call existing `requireAuth(req)`, reject non-CEO with `403`, validate query dates, call the injected loader with `getSupabaseAdmin()`, set `Cache-Control: no-store`, and return JSON. Never return raw contact phone, notes, descriptions, outcomes, or auth details.

- [ ] **Step 5: Implement the authenticated client wrapper**

Use `authHeader()` and `fetch('/api/reports/interaction-report?...')`. Convert 400/401/403/500 responses into Hebrew `Error` messages for the page.

- [ ] **Step 6: Run server tests**

Run: `node scripts/verify-interaction-report.cjs --section server`

Expected: authorization, validation, query-scope, and no-sensitive-field assertions pass.

### Task 3: One Excel workbook

**Files:**
- Modify: `lib/interactionReportExcel.js`
- Modify: `scripts/verify-interaction-report.cjs`

**Interfaces:**
- Consumes: `Report` from Task 1.
- Produces: `buildInteractionWorkbook(report) -> Promise<ExcelJS.Workbook>`.
- Produces: `createInteractionWorkbookBuffer(report) -> Promise<Buffer|ArrayBuffer>`.
- Produces: `downloadInteractionReportExcel(report) -> Promise<void>`.

- [ ] **Step 1: Write failing workbook tests**

Assert exactly these sheet names:

```js
assert.deepEqual(
  workbook.worksheets.map(s => s.name),
  ['סיכום לפי פעיל', 'התקדמות במצוות', 'סיכום מצוות', 'סיכום ארגוני']
);
```

Assert the filtered totals, one detailed mitzvot event, numeric cell types, `rightToLeft`, frozen heading row, widths, and the exact summary sentence.

- [ ] **Step 2: Run Excel tests and verify failure**

Run: `node scripts/verify-interaction-report.cjs --section excel`

Expected: fail because the current workbook has only three incomplete sheets and lacks averages/event detail.

- [ ] **Step 3: Implement the four sheets**

Create one shared styling helper. Add title/range rows, freeze the actual header row, apply `autoFilter`, format dates as `dd.mm.yyyy`, keep all metrics numeric, and include every required column and organizational summary.

- [ ] **Step 4: Implement one-file download**

Create exactly one Blob URL and one anchor click per invocation. Revoke the URL in `finally`. Use a stable Hebrew filename with selected dates or `כל-ההיסטוריה`.

- [ ] **Step 5: Run Excel tests**

Run: `node scripts/verify-interaction-report.cjs --section excel`

Expected: all workbook structure and number tests pass.

### Task 4: One real Hebrew RTL PDF

**Files:**
- Create: `lib/interactionReportPdf.js`
- Create: `public/fonts/NotoSansHebrew-Regular.ttf`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/verify-interaction-report.cjs`

**Interfaces:**
- Consumes: `Report` from Task 1 and the embedded TTF bytes.
- Produces: `buildInteractionReportPdf(report, { fontBinary? }) -> Promise<Uint8Array>`.
- Produces: `downloadInteractionReportPdf(report) -> Promise<void>`.

- [ ] **Step 1: Add dependencies and the licensed font asset**

Install pinned compatible releases of `jspdf` and `jspdf-autotable`. Download Noto Sans Hebrew Regular TTF from the official Google Fonts repository and retain its OFL license notice under `public/fonts/`.

- [ ] **Step 2: Write failing PDF tests**

Assert:

```js
const bytes = await buildInteractionReportPdf(report, { fontBinary });
assert.equal(Buffer.from(bytes).subarray(0, 5).toString('ascii'), '%PDF-');
assert.ok(bytes.length > 10_000);
```

Instrument the builder or expose pure table row builders to assert the filtered totals, date range, summary sentence, all 13 main-table columns, and mitzvot summary rows are supplied to the PDF.

- [ ] **Step 3: Run PDF tests and verify failure**

Run: `node scripts/verify-interaction-report.cjs --section pdf`

Expected: fail because a real PDF builder does not exist.

- [ ] **Step 4: Implement font embedding and RTL PDF generation**

Load the TTF as binary, add it with `addFileToVFS`/`addFont`, call `setR2L(true)`, and use the Hebrew font for every title, cell, header, and footer. Use a landscape page format large enough for all columns, right/center alignment, repeated headers, `rowPageBreak: 'avoid'`, line wrapping, and page numbers.

- [ ] **Step 5: Implement one-file download**

Create exactly one PDF Blob and one anchor click. Do not invoke print dialogs. Keep the button locked until generation and download setup finish.

- [ ] **Step 6: Run PDF tests**

Run: `node scripts/verify-interaction-report.cjs --section pdf`

Expected: PDF signature, size, report content plumbing, and one-file behavior tests pass.

### Task 5: CEO report screen and navigation

**Files:**
- Modify: `pages/interaction-report.jsx`
- Modify: `styles/components.css`
- Modify: `components/DesktopLayout.jsx`
- Modify: `pages/landing.jsx`
- Modify: `components/MobileBottomNav.jsx`
- Modify: `scripts/verify-interaction-report.cjs`

**Interfaces:**
- Consumes: `fetchInteractionReport`, `downloadInteractionReportExcel`, `downloadInteractionReportPdf`.
- Produces: `/interaction-report` CEO UI.

- [ ] **Step 1: Add a failing source-level access/navigation test**

Assert the page imports the API client rather than `useCrm`, both export builders are wired, and all three navigation files contain a CEO-gated `/interaction-report` entry.

- [ ] **Step 2: Run UI wiring tests and verify failure**

Run: `node scripts/verify-interaction-report.cjs --section ui`

Expected: fail because the current page reads `CrmStore`, lacks PDF generation, and navigation is incomplete.

- [ ] **Step 3: Implement data loading and date validation**

Wait for auth restoration. For non-CEO users show the denial state and make no report request. For CEO users fetch all history on first load, then refetch on valid date changes with request cancellation or stale-response protection. Provide retry and clear-range actions.

- [ ] **Step 4: Implement the complete table and summary**

Render activist name plus: total clients, total interactions, two quality columns, four type columns, total minutes, average interactions per client, average duration. Render the organizational total as the last table row and display `summarySentence` verbatim.

- [ ] **Step 5: Implement mitzvot sections and states**

Show grouped activist progress and organizational progress with unique clients, event count, levels gained, and total levels. Distinguish no interactions from no mitzvot progress. Use Hebrew number formatting.

- [ ] **Step 6: Wire exactly two export buttons**

Use separate visible labels but one shared `exporting` state that disables both buttons. Show a clear Hebrew error on failure and always unlock in `finally`.

- [ ] **Step 7: Complete responsive CRM styling**

Use existing design tokens, full RTL, readable desktop spacing, horizontal table scrolling at 390/768px, accessible focus states, sticky headers, and loading/error/empty cards. Do not add sample values or hard-coded report numbers.

- [ ] **Step 8: Complete CEO-only navigation**

Add the same relative position and CEO gating to DesktopLayout, landing sidebar, and MobileBottomNav drawer. The API remains the security boundary.

- [ ] **Step 9: Run UI wiring tests**

Run: `node scripts/verify-interaction-report.cjs --section ui`

Expected: all access, data-source, export-button, and navigation assertions pass.

### Task 6: Live artifact generation

**Files:**
- Modify: `scripts/generate-interaction-report-files.cjs`
- Delete or replace: `scripts/generate-interaction-report-pdf.py`
- Generate: `reports/דו״ח-קשרים-אחדות-יהודית.xlsx`
- Generate: `reports/דו״ח-קשרים-אחדות-יהודית.pdf`

**Interfaces:**
- Consumes: live Supabase environment, `loadLiveInteractionReport`, Excel builder, PDF builder.
- Produces: exactly two final report files and a compact JSON verification summary without personal contact details.

- [ ] **Step 1: Rewrite the generator to use the live server loader**

Load `.env.local`, create the Supabase admin client, call `loadLiveInteractionReport({ startDate: '', endDate: '' })`, and write one XLSX buffer plus one PDF byte array. Never import `data/`, `mocks/`, seed SQL, or a local JSON input.

- [ ] **Step 2: Add generation integrity guards**

Before writing, require project id/name match, non-zero live contacts/interactions, no missing activist names, totals equal row sums, and both output buffers have the expected file signatures.

- [ ] **Step 3: Generate the files**

Run: `node scripts/generate-interaction-report-files.cjs`

Expected: writes only `reports/דו״ח-קשרים-אחדות-יהודית.xlsx` and `reports/דו״ח-קשרים-אחדות-יהודית.pdf` plus prints counts and paths.

- [ ] **Step 4: Programmatically reopen both files**

Read the workbook with ExcelJS and assert four sheets, numeric totals, RTL views, and frozen headings. Open the PDF with an available PDF parser/rendering dependency, assert page count and render representative pages to images for visual inspection.

### Task 7: Full verification and visual review

**Files:**
- Modify only files required by failures discovered during verification.

- [ ] **Step 1: Run the complete report suite**

Run: `npm run verify:interaction-report`

Expected: all calculation, server, Excel, PDF, and UI tests pass.

- [ ] **Step 2: Run the full production build**

Run: `npm run build`

Expected: Next.js build completes successfully with `/interaction-report` and `/api/reports/interaction-report`.

- [ ] **Step 3: Start the app and authenticate as CEO**

Run the local app, log in using the existing Supabase CEO account, open `/interaction-report`, and verify the live totals match the generated artifacts.

- [ ] **Step 4: Verify non-CEO denial**

Authenticate with an activist account, request the page and API, and confirm the API returns `403` with no report payload.

- [ ] **Step 5: Capture visual checks at required widths**

Capture 390px, 768px, and 1440px screenshots. Verify RTL, date fields, horizontal scrolling, sticky header/total row, no clipping, loading/error states, and exactly two export buttons.

- [ ] **Step 6: Visually inspect Excel and PDF artifacts**

Open the generated XLSX and PDF. Verify Hebrew order, RTL, headings, numeric formatting, all four sheets, repeated PDF headers, landscape layout, readable text, page numbers, and no clipped columns or rows.

- [ ] **Step 7: Record evidence and final file list**

Run `git status --short` and `git diff --stat`, list every modified/generated file, and preserve unrelated pre-existing changes. Report exact command results and direct absolute links to the final Excel and PDF files.
