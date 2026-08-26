import { authHeader } from './apiAuth';

export async function fetchInteractionReport({ startDate = '', endDate = '', signal } = {}) {
  const query = new URLSearchParams();
  if (startDate) query.set('from', startDate);
  if (endDate) query.set('to', endDate);
  const suffix = query.toString() ? `?${query}` : '';
  const response = await fetch(`/api/reports/interaction-report${suffix}`, {
    method: 'GET',
    headers: await authHeader(),
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 403
      ? 'הדו״ח זמין למנכ״ל בלבד.'
      : response.status === 401
        ? 'יש להתחבר מחדש כדי לצפות בדו״ח.'
        : 'טעינת הדו״ח נכשלה.';
    throw new Error(payload.error || fallback);
  }
  return payload;
}
