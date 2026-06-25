// lib/aiService.js
import { authHeader } from './apiAuth';

async function callAI(text, type, meta) {
  const res = await fetch('/api/ai-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ text, type, meta }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.summary ?? '';
}

export async function summarizeReportText(text, meta = {}) {
  if (!text) return '';
  return callAI(text, 'base_meeting', meta);
}

export async function summarizeInteractionText(text, meta = {}) {
  if (!text) return '';
  return callAI(text, 'interaction', meta);
}
