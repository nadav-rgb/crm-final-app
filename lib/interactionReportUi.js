const REPORT_TABLE_COLUMNS = [
  { key: 'totalClients', label: 'מספר לקוחות כולל' },
  { key: 'totalInteractions', label: 'סך כל הקשרים' },
  { key: 'toraniCount', label: 'קשרים תורניים' },
  { key: 'friendlyCount', label: 'קשרים ידידותיים' },
  { key: 'frontalCount', label: 'קשרים פרונטליים' },
  { key: 'videoCount', label: 'קשרי וידאו' },
  { key: 'phoneCount', label: 'קשרים טלפוניים' },
  { key: 'shabbatHostCount', label: 'אירוחי שבת' },
  { key: 'totalMinutes', label: 'סך דקות הקשר' },
  { key: 'averageInteractionsPerClient', label: 'ממוצע קשרים ללקוח', average: true },
  { key: 'averageDuration', label: 'ממוצע משך קשר', average: true },
];

function canViewInteractionReport(user) {
  return user?.role === 'ceo';
}

function formatReportNumber(value, average = false) {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('he-IL', average
    ? { maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
}

module.exports = {
  REPORT_TABLE_COLUMNS,
  canViewInteractionReport,
  formatReportNumber,
};
