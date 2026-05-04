// lib/aiService.js
// AI service layer — infrastructure placeholder.
// All functions work today using the keyword-based demo in aiDemo.js.
// To connect real Claude / Whisper: set NEXT_PUBLIC_AI_ENABLED=true and
// implement the /api/ai-summary and /api/transcribe routes.

import { summarizeBaseMeetingDemo, summarizeInteractionDemo } from './aiDemo';

const AI_ENABLED = process.env.NEXT_PUBLIC_AI_ENABLED === 'true';

// ── Speech-to-text ─────────────────────────────────────────────────────────

// Placeholder for future Whisper / Web Speech API transcription.
// audioBlob: Blob from MediaRecorder (not used yet).
// Returns a demo string today; will return real transcript when connected.
export async function transcribeSpeechPlaceholder(audioBlob) {
  if (AI_ENABLED) {
    // Future: POST audioBlob to /api/transcribe (Whisper API, server-side)
    // const form = new FormData();
    // form.append('audio', audioBlob, 'recording.webm');
    // const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    // const { transcript } = await res.json();
    // return transcript;
  }
  return '[תמלול דמו — בעתיד יוחלף ב-Whisper API]';
}

// ── Text summarization ─────────────────────────────────────────────────────

// Summarizes a submitted base meeting report.
// text: plain text (output of structuredToText or raw notes).
// meta: { meeting_place_number, meeting_place_city, meeting_number, activist_name }
export async function summarizeReportText(text, meta = {}) {
  if (!text) return '';
  if (AI_ENABLED) {
    const res = await fetch('/api/ai-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, type: 'base_meeting', meta }),
    });
    const { summary } = await res.json();
    return summary;
  }
  return summarizeBaseMeetingDemo(text, meta);
}

// Summarizes a contact interaction report.
// text: activist's free-text notes.
// meta: { contactName, type, quality }
export async function summarizeInteractionText(text, meta = {}) {
  if (!text) return '';
  if (AI_ENABLED) {
    const res = await fetch('/api/ai-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, type: 'interaction', meta }),
    });
    const { summary } = await res.json();
    return summary;
  }
  return summarizeInteractionDemo(text, meta);
}
