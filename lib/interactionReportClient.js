export async function fetchInteractionReport(apiFetch, { startDate = '', endDate = '', signal } = {}) {
  const query = new URLSearchParams();
  if (startDate) query.set('from', startDate);
  if (endDate) query.set('to', endDate);
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch(`/api/reports/interaction-report${suffix}`, { method: 'GET', signal });
}
