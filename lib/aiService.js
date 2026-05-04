// lib/aiService.js
export async function summarizeReportText(text, meta = {}) {
  if (!text) return '';
  const res = await fetch('/api/ai-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type: 'base_meeting', meta }),
  });
  const { summary } = await res.json();
  return summary;
}

export async function summarizeInteractionText(text, meta = {}) {
  if (!text) return '';
  const res = await fetch('/api/ai-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type: 'interaction', meta }),
  });
  const { summary } = await res.json();
  return summary;
}
