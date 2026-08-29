async function callAI(apiFetch, resourceType, resourceId) {
  if (typeof apiFetch !== 'function') throw new Error('AI API client is unavailable');
  const result = await apiFetch('/api/ai-summary', {
    method: 'POST',
    body: { resourceType, resourceId },
  });
  return result?.summary ?? '';
}

export function summarizeReportText(apiFetch, resourceId) {
  if (resourceId === undefined || resourceId === null || resourceId === '') return Promise.resolve('');
  return callAI(apiFetch, 'base_meeting', resourceId);
}

export function summarizeInteractionText(apiFetch, resourceId) {
  if (resourceId === undefined || resourceId === null || resourceId === '') return Promise.resolve('');
  return callAI(apiFetch, 'interaction', resourceId);
}
