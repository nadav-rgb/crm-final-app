// lib/formatDate.js — תצוגת תאריך בפורמט עברי (DD/MM/YYYY) מתוך מחרוזת ISO (YYYY-MM-DD).
// פירוק ידני של המחרוזת (בלי Date/timezone) — דטרמיניסטי בכל סביבה.
export function formatDateHe(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}
