// components/VoiceInput.jsx
// הקלטה קולית בסגנון Family: לחיצה קצרה להפעלה/כיבוי (toggle), תמלול חי על המסך,
// צלילי start/stop (sounds/rec-*.mp3), ואקולייזר.
//   • דפדפן: Web Speech API (he-IL) — interimResults לתמלול חי.
//   • אפליקציית Capacitor: STT נייטיב (@capacitor-community/speech-recognition).
// אבחון: כל גבול מתועד ב-console.log עם הקידומת [VoiceInput] (logcat / chrome://inspect),
// והתמלול החי מוצג על המסך — אם הוא מופיע, המנוע עובד.

import { useState, useRef, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

const KEYFRAMES = `
@keyframes vi-eq    { 0%,100%{transform:scaleY(0.25)} 50%{transform:scaleY(1)} }
@keyframes vi-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,0.40)} 50%{box-shadow:0 0 0 14px rgba(231,76,60,0)} }
@keyframes vi-spin  { to{transform:rotate(360deg)} }
`;

function describeErr(e, fallback = 'שגיאה בהקלטה') {
  if (!e) return fallback;
  const msg  = e.message || (typeof e === 'string' ? e : '') || fallback;
  const code = e.code != null ? ` [${e.code}]` : '';
  return `${msg}${code}`;
}

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
  const [phase, setPhase] = useState('idle'); // idle | recording | processing | done | error
  const [liveText, setLiveText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSupported, setIsSupported] = useState(null);
  const [isNative, setIsNative] = useState(false);

  const recognitionRef  = useRef(null);
  const recordingRef    = useRef(false); // המשתמש במצב הקלטה (מקור אמת — לא תלוי ב-state אסינכרוני)
  const startedRef      = useRef(false); // ה-recognizer הנייטיב אכן התחיל
  const finishingRef    = useRef(false); // נעילת re-entry ל-finishNative (tap + auto-stop)
  const transcriptRef   = useRef('');
  const hasErrorRef     = useRef(false);
  const finalResolveRef = useRef(null);  // משתחרר כשהתוצאה הסופית מגיעה אחרי stop()
  const committedRef    = useRef(false); // ה-commit רץ פעם אחת לכל סשן (מונע מצב 'מעבד' תקוע / כפילות)
  const startSndRef     = useRef(null);
  const stopSndRef      = useRef(null);

  // טעינת צלילים מראש
  useEffect(() => {
    try {
      startSndRef.current = new Audio('/sounds/rec-start.mp3');
      stopSndRef.current  = new Audio('/sounds/rec-stop.mp3');
      startSndRef.current.preload = 'auto';
      stopSndRef.current.preload  = 'auto';
    } catch (_) {}
  }, []);
  function playSound(ref) {
    try { const a = ref.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); } } catch (_) {}
  }

  // זיהוי פלטפורמה + בקשת הרשאת מיקרופון מראש בנייטיב (מנותקת מהלחיצה)
  useEffect(() => {
    if (Capacitor?.isNativePlatform?.()) {
      setIsNative(true);
      setIsSupported(true);
      console.log('[VoiceInput] native platform=', Capacitor.getPlatform());
      (async () => {
        try {
          const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
          const perm = await SpeechRecognition.checkPermissions();
          console.log('[VoiceInput] preflight permission=', perm?.speechRecognition);
          if (perm.speechRecognition !== 'granted') {
            const req = await SpeechRecognition.requestPermissions();
            console.log('[VoiceInput] preflight permission after request=', req?.speechRecognition);
          }
        } catch (e) { console.warn('[VoiceInput] preflight permission failed', e); }
      })();
    } else {
      const supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
      setIsSupported(supported);
      console.log('[VoiceInput] web platform; SpeechRecognition supported=', supported);
    }
  }, []);

  // ניקוי בעת unmount
  useEffect(() => () => {
    try { recognitionRef.current?.abort?.(); } catch (_) {}
    if (startedRef.current) {
      import('@capacitor-community/speech-recognition')
        .then(({ SpeechRecognition }) => { SpeechRecognition.stop().catch(() => {}); SpeechRecognition.removeAllListeners(); })
        .catch(() => {});
    }
  }, []);

  // ───────── מסלול נייטיב (Capacitor) ─────────
  async function startNative() {
    if (recordingRef.current) return;
    recordingRef.current = true;
    startedRef.current   = false;
    finishingRef.current = false;
    committedRef.current = false;
    hasErrorRef.current  = false;
    transcriptRef.current = '';
    setLiveText('');
    setErrorMsg('');
    setPhase('recording');
    playSound(startSndRef);

    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

      let avail = { available: false };
      try { avail = await SpeechRecognition.available(); }
      catch (err) { console.warn('[VoiceInput] available() threw', err); }
      console.log('[VoiceInput] available=', avail?.available);
      if (!avail?.available) throw new Error('זיהוי דיבור אינו זמין במכשיר זה');

      const perm = await SpeechRecognition.checkPermissions();
      console.log('[VoiceInput] permission=', perm?.speechRecognition);
      if (perm.speechRecognition !== 'granted') {
        recordingRef.current = false;
        hasErrorRef.current  = true;
        setErrorMsg('יש לאשר הרשאת מיקרופון ואז להקיש שוב');
        setPhase('error');
        SpeechRecognition.requestPermissions().catch(err => console.warn('[VoiceInput] requestPermissions', err));
        return;
      }

      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener('partialResults', (data) => {
        if (data?.matches?.length) {
          transcriptRef.current = data.matches[0];
          setLiveText(data.matches[0]);
          console.log('[VoiceInput] partial/result=', data.matches[0]);
          if (finalResolveRef.current) { const r = finalResolveRef.current; finalResolveRef.current = null; r(); }
        }
      });
      await SpeechRecognition.addListener('listeningState', (data) => {
        console.log('[VoiceInput] listeningState=', data?.status);
        // ה-recognizer סיים מעצמו (שקט) — סיים וקבע את התמלול
        if (data?.status === 'stopped' && recordingRef.current) finishNative();
      });

      if (!recordingRef.current) { console.log('[VoiceInput] stopped before start'); finishNative(); return; }

      startedRef.current = true;
      console.log('[VoiceInput] starting recognizer (he-IL)');
      await SpeechRecognition.start({ language: 'he-IL', maxResults: 1, partialResults: true, popup: false });
    } catch (e) {
      console.error('[VoiceInput] native start error', e);
      hasErrorRef.current = true;
      recordingRef.current = false;
      startedRef.current = false;
      setErrorMsg(describeErr(e));
      setPhase('error');
      setLiveText('');
    }
  }

  // ממתין לתוצאה הסופית: Android שולח onResults רק *אחרי* stopListening (מאות ms).
  function waitForFinalResult() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; finalResolveRef.current = null; resolve(); };
      finalResolveRef.current = finish;
      setTimeout(finish, 1500);
    });
  }

  async function finishNative() {
    if (finishingRef.current) return;
    if (!recordingRef.current && !startedRef.current) return;
    finishingRef.current = true;
    recordingRef.current = false;
    setPhase('processing');
    // שעון-בטיחות: גם אם import/stop/removeAllListeners נתקעים — לא נשארים ב'מעבד' לנצח.
    const watchdog = setTimeout(() => { console.warn('[VoiceInput] finish watchdog fired'); finishingRef.current = false; commit(); }, 2500);
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      if (startedRef.current) {
        console.log('[VoiceInput] stop() — awaiting final onResults');
        try { await SpeechRecognition.stop(); } catch (e) { console.warn('[VoiceInput] stop() threw', e); }
      }
      await waitForFinalResult();                              // לא להסיר listeners לפני onResults הסופי
      SpeechRecognition.removeAllListeners().catch(() => {});  // fire-and-forget — לא לחסום את הסיום (מקור ההיתקעות)
    } catch (e) {
      console.warn('[VoiceInput] finishNative threw', e);
    }
    clearTimeout(watchdog);
    startedRef.current   = false;
    finishingRef.current = false;
    playSound(stopSndRef);
    commit();
  }

  // ───────── מסלול דפדפן (Web Speech API) ─────────
  function startWeb() {
    if (recordingRef.current) return;
    recordingRef.current = true;
    committedRef.current = false;
    hasErrorRef.current  = false;
    transcriptRef.current = '';
    setLiveText('');
    setErrorMsg('');
    playSound(startSndRef);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      recordingRef.current = false;
      hasErrorRef.current  = true;
      setErrorMsg('דפדפן זה אינו תומך בהקלטה');
      setPhase('error');
      return;
    }

    const rec = new SR();
    rec.lang = 'he-IL';
    rec.continuous = true;
    rec.interimResults = true; // תמלול חי
    rec.maxAlternatives = 1;

    rec.onstart = () => { console.log('[VoiceInput] web onstart'); setPhase('recording'); };
    rec.onresult = (e) => {
      let interim = '';
      let final = transcriptRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += (final ? ' ' : '') + tr;
        else interim += tr;
      }
      transcriptRef.current = final;
      setLiveText((final + (interim ? ' ' + interim : '')).trim());
    };
    rec.onerror = (e) => {
      console.error('[VoiceInput] web onerror', e.error);
      hasErrorRef.current = true;
      recordingRef.current = false;
      setErrorMsg(webSpeechError(e.error));
      setPhase('error');
    };
    rec.onend = () => {
      console.log('[VoiceInput] web onend');
      if (!hasErrorRef.current) { recordingRef.current = false; playSound(stopSndRef); commit(); }
    };

    recognitionRef.current = rec;
    setPhase('recording');
    try { rec.start(); }
    catch (e) {
      console.error('[VoiceInput] web start threw', e);
      hasErrorRef.current = true;
      recordingRef.current = false;
      setErrorMsg(describeErr(e));
      setPhase('error');
    }
  }

  function stopWeb() {
    recordingRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) {} // → onend → commit
  }

  // מסירת התמלול לשדה — אידמפוטנטי (פעם אחת לסשן) ותמיד מסיים את מצב 'מעבד'.
  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    setLiveText('');
    const text = transcriptRef.current.trim();
    transcriptRef.current = '';
    if (text) {
      console.log('[VoiceInput] commit=', text);
      onTranscript?.(text);
      setPhase('done');
      setTimeout(() => setPhase('idle'), 900);
    } else {
      console.log('[VoiceInput] commit — empty');
      setErrorMsg('לא זוהה דיבור — נסה שוב');
      setPhase('error');
      setTimeout(() => setPhase('idle'), 2000); // אוטו-ניקוי — לא נשארים תקועים
    }
  }

  // לחיצה קצרה — toggle
  function handleTap() {
    if (disabled || phase === 'processing' || phase === 'done') return;
    if (isNative) { recordingRef.current ? finishNative() : startNative(); }
    else          { recordingRef.current ? stopWeb()      : startWeb();   }
  }

  if (isSupported === null) return null;

  if (!isSupported) {
    return (
      <p style={{ fontSize: 12, color: '#e74c3c', fontFamily: 'Rubik, sans-serif', direction: 'rtl', margin: '6px 0 0' }}>
        דפדפן זה אינו תומך בהקלטה — נסה Chrome או Safari
      </p>
    );
  }

  const isRecording  = phase === 'recording';
  const isProcessing = phase === 'processing';
  const isDone       = phase === 'done';
  const isError      = phase === 'error';

  const bgColor =
    isRecording  ? '#e74c3c' :
    isProcessing ? '#6d4eca' :
    isDone       ? '#27ae60' :
    isError      ? '#e74c3c' :
                   '#3a249b';

  const sublabel =
    isRecording  ? 'מקליט... הקש לסיום' :
    isProcessing ? 'מעבד...' :
    isError      ? errorMsg :
    isDone       ? 'נוסף ✓' :
                   'הקש כדי להקליט';

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11, marginTop: 12 }}>

        {/* אקולייזר — בזמן הקלטה */}
        {isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26 }} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <span key={i} style={{
                width: 4, height: 22, borderRadius: 2, background: '#e74c3c',
                transformOrigin: 'center', animation: `vi-eq 0.8s ease-in-out ${(i * 0.09).toFixed(2)}s infinite`,
              }} />
            ))}
          </div>
        )}

        {/* כפתור */}
        <button
          type="button"
          onClick={handleTap}
          disabled={disabled || isDone || isProcessing}
          aria-label={isRecording ? 'מקליט — הקש לסיום' : 'הקש כדי להקליט'}
          style={{
            width: 68, height: 68, borderRadius: '50%', border: 'none',
            background: bgColor, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: disabled || isDone || isProcessing ? 'default' : 'pointer',
            animation: isRecording ? 'vi-pulse 1.1s ease-in-out infinite' : 'none',
            boxShadow: isRecording ? '0 0 0 0 rgba(231,76,60,0.45)' : '0 4px 18px rgba(58,36,155,0.28)',
            transition: 'background 0.2s', WebkitUserSelect: 'none', userSelect: 'none',
          }}
        >
          {isProcessing
            ? <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', display: 'inline-block', animation: 'vi-spin 0.7s linear infinite' }} />
            : isDone
            ? <span style={{ fontSize: 26 }}>✓</span>
            : <Mic size={28} strokeWidth={2} />}
        </button>

        {/* סטטוס */}
        <span style={{
          fontSize: isError ? 12 : 11, fontFamily: 'Rubik, sans-serif',
          color: isRecording || isError ? '#e74c3c' : isDone ? '#27ae60' : isProcessing ? '#6d4eca' : '#aaa',
          direction: 'rtl', textAlign: 'center', maxWidth: 280, fontWeight: isError ? 700 : 400, lineHeight: 1.5,
        }}>
          {sublabel}
        </span>

        {/* תמלול חי */}
        {(isRecording || isProcessing) && liveText && (
          <div style={{
            width: '100%', maxWidth: 520, background: '#fff', border: '1px solid #eee', borderRadius: 12,
            padding: '10px 13px', fontSize: 13.5, color: '#333', lineHeight: 1.65, direction: 'rtl',
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          }}>
            {liveText}
          </div>
        )}
      </div>
    </>
  );
}
