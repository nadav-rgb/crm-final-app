// components/VoiceInput.jsx
// Round press-and-hold mic button — hold to record, release to stop.
// Uses Web Speech API (he-IL). Works on Chrome Android, Safari iOS 14.5+.

import { useState, useRef, useEffect } from 'react';
import { Mic } from 'lucide-react';

const PULSE_KEYFRAMES = `
@keyframes mic-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(231,76,60,0.45); }
  50%       { transform: scale(1.15); box-shadow: 0 0 0 10px rgba(231,76,60,0); }
}
`;

export default function VoiceInput({ onTranscript, disabled = false }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [isSupported, setIsSupported] = useState(null);
  const recognitionRef = useRef(null);
  const hasErrorRef = useRef(false);
  const transcriptRef = useRef('');

  useEffect(() => {
    setIsSupported('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  function startRecording() {
    if (disabled || phase === 'recording') return;

    hasErrorRef.current = false;
    transcriptRef.current = '';
    setErrorMsg('');

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();

    rec.lang = 'he-IL';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setPhase('recording');

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          transcriptRef.current +=
            (transcriptRef.current ? ' ' : '') + e.results[i][0].transcript;
        }
      }
    };

    rec.onerror = (e) => {
      hasErrorRef.current = true;
      const msg =
        e.error === 'not-allowed' ? 'אין הרשאה למיקרופון' :
        e.error === 'no-speech'   ? 'לא זוהה דיבור' :
                                    'שגיאה בהקלטה';
      setErrorMsg(msg);
      setPhase('error');
      setTimeout(() => { setPhase('idle'); setErrorMsg(''); }, 3000);
    };

    rec.onend = () => {
      if (hasErrorRef.current) return;
      const text = transcriptRef.current.trim();
      if (text) {
        setPhase('done');
        onTranscript?.(text);
        setTimeout(() => setPhase('idle'), 1500);
      } else {
        setPhase('idle');
      }
    };

    recognitionRef.current = rec;
    rec.start();
  }

  function stopRecording() {
    recognitionRef.current?.stop();
  }

  function handlePointerDown(e) {
    e.preventDefault();
    startRecording();
  }

  function handlePointerUp() {
    if (phase === 'recording') stopRecording();
  }

  if (isSupported === null) return null;

  if (!isSupported) {
    return (
      <p style={{
        fontSize: 12, color: '#e74c3c',
        fontFamily: 'Rubik, sans-serif',
        direction: 'rtl', margin: '6px 0 0',
      }}>
        דפדפן זה אינו תומך בהקלטה — נסה Chrome או Safari
      </p>
    );
  }

  const isRecording = phase === 'recording';
  const isDone      = phase === 'done';
  const isError     = phase === 'error';

  const bgColor =
    isRecording ? '#e74c3c' :
    isDone      ? '#27ae60' :
    isError     ? '#e74c3c' :
                  '#3a249b';

  const sublabel =
    isRecording ? 'מקליט... שחרר לסיום' :
    isError     ? errorMsg :
    isDone      ? 'הושלם ✓' :
                  'לחץ והחזק להקלטה';

  return (
    <>
      <style>{PULSE_KEYFRAMES}</style>
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 10, marginTop: 10,
      }}>
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          disabled={disabled || isDone}
          aria-label={isRecording ? 'מקליט — שחרר לסיום' : 'לחץ והחזק להקלטה'}
          style={{
            width: 64, height: 64,
            borderRadius: '50%',
            border: 'none',
            background: bgColor,
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: disabled || isDone ? 'default' : 'pointer',
            animation: isRecording ? 'mic-pulse 0.85s ease-in-out infinite' : 'none',
            boxShadow: isRecording
              ? '0 0 0 0 rgba(231,76,60,0.45)'
              : '0 4px 18px rgba(58,36,155,0.28)',
            transition: 'background 0.2s',
            WebkitUserSelect: 'none', userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {isDone
            ? <span style={{ fontSize: 24 }}>✓</span>
            : <Mic size={27} strokeWidth={2} />
          }
        </button>
        <span style={{
          fontSize: 11, fontFamily: 'Rubik, sans-serif',
          color: isRecording || isError ? '#e74c3c' : isDone ? '#27ae60' : '#aaa',
          direction: 'rtl',
        }}>
          {sublabel}
        </span>
      </div>
    </>
  );
}
