// components/VoiceInput.jsx
// Round press-and-hold mic button — hold to record, release to stop.
// בדפדפן: Web Speech API (he-IL). באפליקציית Capacitor: STT נייטיב
// (@capacitor-community/speech-recognition), כי Web Speech API לא נתמך ב-WebView.
//
// אבחון: כל גבול מתועד ב-console.log עם הקידומת [VoiceInput] (נראה ב-logcat / chrome://inspect).
// שגיאות מוצגות במלואן ונשארות עד הלחיצה הבאה (לא נעלמות אוטומטית) — כדי לראות את סיבת הכשל.

import { useState, useRef, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

const PULSE_KEYFRAMES = `
@keyframes mic-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(231,76,60,0.45); }
  50%       { transform: scale(1.15); box-shadow: 0 0 0 10px rgba(231,76,60,0); }
}
`;

// הודעת שגיאה קריאה — כולל code אם קיים, כדי שאפשר יהיה לאבחן על המכשיר.
function describeErr(e, fallback = 'שגיאה בהקלטה') {
  if (!e) return fallback;
  const msg  = e.message || (typeof e === 'string' ? e : '') || fallback;
  const code = e.code != null ? ` [${e.code}]` : '';
  return `${msg}${code}`;
}

// מיפוי קודי Web Speech API לעברית (משמר את הקוד הגולמי לאבחון).
function webSpeechError(code) {
  const map = {
    'not-allowed':         'אין הרשאת מיקרופון',
    'service-not-allowed': 'שירות הזיהוי חסום',
    'no-speech':           'לא זוהה דיבור',
    'audio-capture':       'לא נמצא מיקרופון',
    'network':             'שגיאת רשת בזיהוי',
    'aborted':             'ההקלטה בוטלה',
  };
  return `${map[code] || 'שגיאת זיהוי'} [${code}]`;
}

export default function VoiceInput({ onTranscript, disabled = false }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [isSupported, setIsSupported] = useState(null);
  const [isNative, setIsNative] = useState(false);
  const recognitionRef = useRef(null);
  const hasErrorRef = useRef(false);
  const transcriptRef = useRef('');
  const recordingRef = useRef(false); // כוונת המשתמש להקליט (מקור אמת לעצירה — לא תלוי ב-state אסינכרוני)
  const startedRef = useRef(false);   // האם ה-recognizer הנייטיב אכן התחיל (כדי לא לקרוא stop לפני start)

  useEffect(() => {
    if (Capacitor?.isNativePlatform?.()) {
      setIsNative(true);
      setIsSupported(true); // STT נייטיב — זמינות בפועל נבדקת ב-available() בעת הלחיצה
      console.log('[VoiceInput] native platform=', Capacitor.getPlatform());
      // בקשת הרשאת מיקרופון מראש (מנותקת מהלחיצה) — כדי שדיאלוג ההרשאה לא יקפוץ
      // תוך כדי ההקלטה ויגנוב פוקוס מה-WebView (מה ששובר את ה-press-and-hold).
      (async () => {
        try {
          const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
          const perm = await SpeechRecognition.checkPermissions();
          console.log('[VoiceInput] preflight permission=', perm?.speechRecognition);
          if (perm.speechRecognition !== 'granted') {
            const req = await SpeechRecognition.requestPermissions();
            console.log('[VoiceInput] preflight permission after request=', req?.speechRecognition);
          }
        } catch (e) {
          console.warn('[VoiceInput] preflight permission failed', e);
        }
      })();
    } else {
      const supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
      setIsSupported(supported);
      console.log('[VoiceInput] web platform; SpeechRecognition supported=', supported);
    }
  }, []);

  // ניקוי בעת unmount
  useEffect(() => () => {
    recognitionRef.current?.abort?.();
    if (startedRef.current) {
      import('@capacitor-community/speech-recognition')
        .then(({ SpeechRecognition }) => { SpeechRecognition.stop().catch(() => {}); SpeechRecognition.removeAllListeners(); })
        .catch(() => {});
    }
  }, []);

  // ───────── מסלול דפדפן (Web Speech API) ─────────
  function startRecording() {
    if (disabled || recordingRef.current) return;

    recordingRef.current = true;
    hasErrorRef.current = false;
    transcriptRef.current = '';
    setErrorMsg('');

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      recordingRef.current = false;
      hasErrorRef.current = true;
      setErrorMsg('דפדפן זה אינו תומך בהקלטה');
      setPhase('error');
      return;
    }

    const rec = new SR();
    rec.lang = 'he-IL';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => { console.log('[VoiceInput] web onstart'); setPhase('recording'); };

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          transcriptRef.current +=
            (transcriptRef.current ? ' ' : '') + e.results[i][0].transcript;
        }
      }
    };

    rec.onerror = (e) => {
      console.error('[VoiceInput] web onerror', e.error, e);
      hasErrorRef.current = true;
      recordingRef.current = false;
      setErrorMsg(webSpeechError(e.error));
      setPhase('error'); // נשאר עד הלחיצה הבאה — לא נעלם אוטומטית
    };

    rec.onend = () => { console.log('[VoiceInput] web onend'); if (!hasErrorRef.current) finalize(); };

    recognitionRef.current = rec;
    setPhase('recording'); // אופטימי — הג'סטה מיידית
    try {
      rec.start();
    } catch (e) {
      console.error('[VoiceInput] web start threw', e);
      hasErrorRef.current = true;
      recordingRef.current = false;
      setErrorMsg(describeErr(e));
      setPhase('error');
    }
  }

  function stopRecording() {
    recordingRef.current = false;
    recognitionRef.current?.stop();
  }

  // ───────── מסלול נייטיב (Capacitor) ─────────
  async function startNative() {
    if (disabled || recordingRef.current) return;

    recordingRef.current = true;
    startedRef.current = false;
    hasErrorRef.current = false;
    transcriptRef.current = '';
    setErrorMsg('');
    setPhase('recording'); // אופטימי — pointerUp מסתמך על recordingRef, לא על ה-state

    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

      // 1) זמינות הזיהוי במכשיר — סיבת כשל נפוצה (אין שירות זיהוי / נחסם)
      let avail = { available: false };
      try { avail = await SpeechRecognition.available(); }
      catch (err) { console.warn('[VoiceInput] available() threw', err); }
      console.log('[VoiceInput] available=', avail?.available);
      if (!avail?.available) throw new Error('זיהוי דיבור אינו זמין במכשיר זה');

      // 2) הרשאה — לא מבקשים כאן בחסימה (זה היה שובר את הג'סטה). אם אין — הודעה + בקשה לפעם הבאה.
      const perm = await SpeechRecognition.checkPermissions();
      console.log('[VoiceInput] permission=', perm?.speechRecognition);
      if (perm.speechRecognition !== 'granted') {
        recordingRef.current = false;
        hasErrorRef.current = true;
        setErrorMsg('יש לאשר הרשאת מיקרופון ואז ללחוץ שוב');
        setPhase('error');
        SpeechRecognition.requestPermissions().catch(err => console.warn('[VoiceInput] requestPermissions', err));
        return;
      }

      // 3) האזנה לתוצאות חלקיות
      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener('partialResults', (data) => {
        if (data?.matches?.length) {
          transcriptRef.current = data.matches[0];
          console.log('[VoiceInput] partial=', data.matches[0]);
        }
      });

      // המשתמש אולי כבר שחרר בזמן ה-awaits — אל תתחיל הקלטה יתומה
      if (!recordingRef.current) { console.log('[VoiceInput] released before start — aborting'); finalize(); return; }

      // 4) התחלה
      startedRef.current = true;
      console.log('[VoiceInput] starting recognizer (he-IL)');
      await SpeechRecognition.start({ language: 'he-IL', maxResults: 1, partialResults: true, popup: false });

      // אם המשתמש שחרר בדיוק בזמן ש-start נפתר — עצור עכשיו
      if (!recordingRef.current) stopNative();
    } catch (e) {
      console.error('[VoiceInput] native error', e);
      hasErrorRef.current = true;
      recordingRef.current = false;
      startedRef.current = false;
      setErrorMsg(describeErr(e));
      setPhase('error'); // נשאר עד הלחיצה הבאה
    }
  }

  async function stopNative() {
    recordingRef.current = false;
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      if (startedRef.current) {
        try { await SpeechRecognition.stop(); } catch (e) { console.warn('[VoiceInput] stop() threw', e); }
      }
      await SpeechRecognition.removeAllListeners();
    } catch (e) {
      console.warn('[VoiceInput] stopNative cleanup threw', e);
    }
    startedRef.current = false;
    finalize();
  }

  // מסירת התמלול לשדה (משותף לשני המסלולים)
  function finalize() {
    if (hasErrorRef.current) return;
    const text = transcriptRef.current.trim();
    if (text) {
      console.log('[VoiceInput] finalize transcript=', text);
      setPhase('done');
      onTranscript?.(text);
      setTimeout(() => setPhase('idle'), 1200);
    } else {
      console.log('[VoiceInput] finalize — no transcript');
      setPhase('idle');
    }
  }

  function handlePointerDown(e) {
    e.preventDefault();
    if (isNative) startNative();
    else startRecording();
  }

  function handlePointerUp() {
    // מקור האמת לעצירה = recordingRef (סינכרוני), לא ה-state האסינכרוני
    if (!recordingRef.current && !startedRef.current) return;
    if (isNative) stopNative();
    else stopRecording();
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
          fontSize: isError ? 12 : 11, fontFamily: 'Rubik, sans-serif',
          color: isRecording || isError ? '#e74c3c' : isDone ? '#27ae60' : '#aaa',
          direction: 'rtl', textAlign: 'center', maxWidth: 260,
          fontWeight: isError ? 700 : 400, lineHeight: 1.5,
        }}>
          {sublabel}
        </span>
      </div>
    </>
  );
}
