import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Download, FileSpreadsheet, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { fetchInteractionReport } from '../lib/interactionReportClient';
import reportCore from '../lib/interactionReport';
import reportUi from '../lib/interactionReportUi';
import { downloadInteractionReportExcel } from '../lib/interactionReportExcel';
import { downloadInteractionReportPdf } from '../lib/interactionReportPdf';

const { validateDateRange } = reportCore;
const { REPORT_TABLE_COLUMNS, canViewInteractionReport, formatReportNumber } = reportUi;

function ProgressTable({ rows, organizational = false }) {
  if (!rows.length) {
    return (
      <div className="interaction-report-empty">
        <CalendarRange size={28} strokeWidth={1.7} aria-hidden="true" />
        <strong>אין התקדמויות במצוות בטווח הזה</strong>
        <span>אפשר להרחיב את טווח התאריכים כדי לראות אירועי עלייה קודמים.</span>
      </div>
    );
  }
  return (
    <div className="interaction-report-table-scroll" tabIndex="0" aria-label={organizational ? 'סיכום התקדמות ארגוני' : 'התקדמות במצוות לפי פעיל'}>
      <table className="interaction-report-table interaction-report-progress-table">
        <thead>
          <tr>
            {!organizational && <th>שם הפעיל</th>}
            <th>מצווה</th>
            <th>מספר רמות שעלו</th>
            <th>לקוחות ייחודיים</th>
            <th>אירועי עלייה</th>
            <th>סך רמות שנוספו</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.activistId}-${row.mitzva}-${row.levelsGained}`}>
              {!organizational && <th scope="row">{row.activistName}</th>}
              <td>{row.mitzva}</td>
              <td>{formatReportNumber(row.levelsGained)}</td>
              <td>{formatReportNumber(row.uniqueClients)}</td>
              <td>{formatReportNumber(row.eventCount)}</td>
              <td>{formatReportNumber(row.totalLevels)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="interaction-report-loading" role="status" aria-live="polite">
      <div className="interaction-report-skeleton wide" />
      <div className="interaction-report-skeleton" />
      <div className="interaction-report-skeleton" />
      <span>טוען את כל נתוני הקשרים מהמערכת…</span>
    </div>
  );
}

export default function InteractionReportPage() {
  const { currentUser, authLoading, apiFetch } = useAuth();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [exporting, setExporting] = useState('');

  const isCeo = canViewInteractionReport(currentUser);
  const dateValidation = useMemo(() => validateDateRange(startDate, endDate), [startDate, endDate]);

  useEffect(() => {
    if (authLoading || !isCeo || !dateValidation.ok) return undefined;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    fetchInteractionReport(apiFetch, { startDate, endDate, signal: controller.signal })
      .then(nextReport => { if (active) setReport(nextReport); })
      .catch(fetchError => {
        if (active && fetchError?.name !== 'AbortError') {
          setReport(null);
          setError(fetchError?.message || 'טעינת הדו״ח נכשלה. אפשר לנסות שוב.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [authLoading, isCeo, startDate, endDate, dateValidation.ok, retryKey, apiFetch]);

  async function handleExport(kind) {
    if (!report || exporting) return;
    setExporting(kind);
    setError('');
    try {
      if (kind === 'excel') await downloadInteractionReportExcel(report);
      else await downloadInteractionReportPdf(report);
    } catch (exportError) {
      setError(exportError?.message || `הפקת קובץ ${kind === 'excel' ? 'Excel' : 'PDF'} נכשלה. אפשר לנסות שוב.`);
    } finally {
      setExporting('');
    }
  }

  const exportActions = (
    <div className="interaction-report-actions" aria-label="הורדת הדו״ח">
      <button type="button" className="interaction-report-button secondary" onClick={() => handleExport('pdf')} disabled={!report || loading || Boolean(exporting)}>
        {exporting === 'pdf' ? <RefreshCw className="spin" size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
        {exporting === 'pdf' ? 'מפיק PDF…' : 'הורדת PDF'}
      </button>
      <button type="button" className="interaction-report-button primary" onClick={() => handleExport('excel')} disabled={!report || loading || Boolean(exporting)}>
        {exporting === 'excel' ? <RefreshCw className="spin" size={17} aria-hidden="true" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
        {exporting === 'excel' ? 'מפיק Excel…' : 'הורדת Excel'}
      </button>
    </div>
  );

  if (!authLoading && !isCeo) {
    return (
      <DesktopLayout title="דו״ח קשרים">
        <main className="interaction-report-page" dir="rtl">
          <section className="interaction-report-access" role="alert">
            <ShieldCheck size={34} strokeWidth={1.6} aria-hidden="true" />
            <h1>הדו״ח זמין למנכ״ל בלבד</h1>
            <p>הנתונים חסומים גם בצד השרת ואינם נשלחים למשתמשים אחרים.</p>
          </section>
        </main>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout
      title="דו״ח קשרים"
      subtitle="אחדות יהודית · תמונת פעילות מלאה"
      actions={exportActions}
    >
      <main className="interaction-report-page" dir="rtl">
        <section className="interaction-report-intro">
          <div>
            <div className="interaction-report-eyebrow"><ShieldCheck size={15} aria-hidden="true" /> דוח הנהלה מאובטח</div>
            <h1>קשרים והתקדמות במצוות</h1>
            <p>כל קשר במערכת נספר, כולל משתתפים נוספים במפגש וכל הלקוחות המשויכים לפרויקט.</p>
          </div>
          <div className="interaction-report-period" aria-label="תקופת הדוח">
            <CalendarRange size={20} strokeWidth={1.7} aria-hidden="true" />
            <div><span>תקופת הדו״ח</span><strong>{report?.meta?.startDate || report?.meta?.endDate ? `${report.meta.startDate || 'תחילת ההיסטוריה'}–${report.meta.endDate || 'היום'}` : 'כל ההיסטוריה'}</strong></div>
          </div>
        </section>

        <section className="interaction-report-filter" aria-label="סינון לפי טווח תאריכים">
          <div className="interaction-report-filter-fields">
            <label>מתאריך<input type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)} /></label>
            <label>עד תאריך<input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          <button type="button" className="interaction-report-clear" onClick={() => { setStartDate(''); setEndDate(''); }}>ניקוי טווח</button>
          {!dateValidation.ok && <p className="interaction-report-filter-error" role="alert">{dateValidation.error}</p>}
        </section>

        {error && (
          <section className="interaction-report-error" role="alert">
            <div><strong>הדו״ח לא נטען במלואו</strong><span>{error}</span></div>
            <button type="button" onClick={() => setRetryKey(key => key + 1)}><RefreshCw size={16} aria-hidden="true" /> ניסיון נוסף</button>
          </section>
        )}

        {(authLoading || loading) && !report ? <LoadingState /> : report && (
          <>
            <section className="interaction-report-summary-band" aria-label="סיכום הדוח">
              <div><span>כל הקשרים</span><strong>{formatReportNumber(report.totals.totalInteractions)}</strong></div>
              <div><span>כל הלקוחות</span><strong>{formatReportNumber(report.totals.totalClients)}</strong></div>
              <div><span>דקות קשר</span><strong>{formatReportNumber(report.totals.totalMinutes)}</strong></div>
              <div><span>אירועי עלייה</span><strong>{formatReportNumber(report.meta.mitzvotEventCount)}</strong></div>
            </section>

            <p className="interaction-report-summary-sentence">{report.summarySentence}</p>

            {report.totals.totalInteractions === 0 && (
              <div className="interaction-report-no-connections">אין קשרים בטווח שנבחר. שורות הפעילים ומספרי הלקוחות עדיין מוצגים במלואם.</div>
            )}

            <section className="interaction-report-section">
              <div className="interaction-report-section-heading">
                <div><h2>סיכום לפי פעיל</h2><p>{formatReportNumber(report.rows.length)} פעילים · כל הרשומות החיות</p></div>
                <Download size={20} strokeWidth={1.7} aria-hidden="true" />
              </div>
              <div className="interaction-report-table-scroll" tabIndex="0" aria-label="טבלת קשרים לפי פעיל">
                <table className="interaction-report-table interaction-report-main-table">
                  <thead><tr><th>שם הפעיל</th>{REPORT_TABLE_COLUMNS.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
                  <tbody>
                    {report.rows.map(row => (
                      <tr key={row.activistId}>
                        <th scope="row">{row.activistName}</th>
                        {REPORT_TABLE_COLUMNS.map(column => <td key={column.key}>{formatReportNumber(row[column.key], column.average)}</td>)}
                      </tr>
                    ))}
                    <tr className="total-row">
                      <th scope="row">סה״כ כל הפעילים</th>
                      {REPORT_TABLE_COLUMNS.map(column => <td key={column.key}>{formatReportNumber(report.totals[column.key], column.average)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="interaction-report-section">
              <div className="interaction-report-section-heading"><div><h2>התקדמות במצוות לפי פעיל</h2><p>לקוחות ייחודיים, אירועי עלייה וסך הרמות שנוספו</p></div></div>
              <ProgressTable rows={report.mitzvotRows} />
            </section>

            <section className="interaction-report-section">
              <div className="interaction-report-section-heading"><div><h2>סיכום התקדמות ארגוני</h2><p>צבירה ייחודית לכל הפעילים לפי מצווה ומספר רמות</p></div></div>
              <ProgressTable rows={report.mitzvotTotals} organizational />
            </section>
          </>
        )}
      </main>
    </DesktopLayout>
  );
}
