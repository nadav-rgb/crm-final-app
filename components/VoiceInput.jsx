// components/VoiceInput.jsx
// Demo speech-to-text button.
// Simulates recording → produces a demo transcript → calls onTranscript(text).
// To connect real Web Speech API or Whisper: replace the setTimeout block.

import { useState } from 'react';

const DEMO_TRANSCRIPT =
  'האווירה במפגש הייתה פתוחה ומקבלת מאוד. השתתפו 8 אנשים. עסקנו בנושא שבת ואחד המשתתפים שיתף שהוא רוצה להתחיל לשמור שבת. הייתה פתיחות גדולה ועניין אמיתי. נקבענו להיפגש שוב בשבוע הבא.';

export default function VoiceInput({ onTranscript, disabled = false }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | done

  function handleClick() {
    if (disabled || phase === 'recording') return;
    setPhase('recording');
    setTimeout(() => {
      setPhase('done');
      onTranscript?.(DEMO_TRANSCRIPT);
      setTimeout(() => setPhase('idle'), 2000);
    }, 2000);
  }

  const look = {
    idle:      { border: '#6c5ce7', bg: '#f0effe', color: '#6c5ce7' },
    recording: { border: '#e74c3c', bg: '#fff0f0', color: '#e74c3c' },
    done:      { border: '#27ae60', bg: '#edfaf1', color: '#27ae60' },
  }[phase];

  const label = {
    idle:      'דיבור לטקסט',
    recording: 'מקליט...',
    done:      'הושלם ✓',
  }[phase];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || phase === 'recording'}
        title={phase === 'idle' ? 'לחץ לדיבור לטקסט (דמו)' : label}
        aria-label={label}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 10,
          border: `1.5px solid ${look.border}`,
          background: look.bg, color: look.color,
          fontSize: 12, fontFamily: 'Rubik, sans-serif', fontWeight: 600,
          cursor: phase === 'recording' ? 'not-allowed' : 'pointer',
          direction: 'rtl', transition: 'all 0.2s',
        }}
      >
        <span style={{ fontSize: 15 }}>{phase === 'done' ? '✓' : '🎤'}</span>
        <span>{label}</span>
      </button>
      <span style={{ fontSize: 11, color: '#bbb', fontFamily: 'Rubik, sans-serif' }}>דמו</span>
    </div>
  );
}
