// components/ActivistSearchSelect.jsx
// שדה "פעיל אחראי" — חיפוש פעיל בשם עברי מתוך הרשימה האמיתית (activist_directory).
// בחירה אחת בלבד. מציג אישור "הפעיל שנבחר: [שם]".
// props:
//   activists        — מערך הפעילים האמיתי (useCrm().activists)
//   selectedId        — מזהה הפעיל שנבחר (activist_code) או null
//   onSelect(id)      — נקרא בעת בחירת פעיל
//   onConfirm()       — אופציונלי: נקרא בלחיצה על "שבץ פעיל"
//   confirmLabel      — טקסט כפתור האישור (ברירת מחדל: "שבץ פעיל אחראי")
//   disabledIds       — מזהים שכבר משובצים (לא יוצגו בתוצאות)
import { useState, useMemo } from 'react';

export default function ActivistSearchSelect({
  activists = [],
  selectedId = null,
  onSelect,
  onConfirm,
  confirmLabel = 'שבץ פעיל אחראי',
  disabledIds = [],
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => activists.find(a => Number(a.id) === Number(selectedId)) || null,
    [activists, selectedId]
  );

  const results = useMemo(() => {
    const q = query.trim();
    const blocked = new Set((disabledIds || []).map(Number));
    return activists
      .filter(a => a.role === 'activist' && !blocked.has(Number(a.id)))
      .filter(a => !q || (a.name || '').includes(q))
      .slice(0, 8);
  }, [activists, query, disabledIds]);

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#2d1f5e', marginBottom: 6 }}>
        פעיל אחראי
      </label>

      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="הקלד שם פעיל לחיפוש..."
        style={{ width: '100%', border: '1.5px solid #e8e8e8', borderRadius: 10, padding: '10px 12px', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }}
      />

      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, marginTop: 4, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 260, overflowY: 'auto' }}>
          {results.map(a => (
            <button
              key={a.id}
              type="button"
              onMouseDown={() => { onSelect && onSelect(Number(a.id)); setQuery(''); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'right', border: 'none', borderBottom: '0.5px solid #f2f2f2', background: '#fff', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#333' }}
            >
              <b>{a.name}</b>
              {a.city ? <span style={{ color: '#aaa', fontSize: 12 }}> · {a.city}</span> : null}
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && results.length === 0 && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, marginTop: 4, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 10, padding: '10px 12px', color: '#aaa', fontSize: 13 }}>
          לא נמצא פעיל בשם זה
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, background: '#f0fdf4', border: '0.5px solid #cdeedb' }}>
          <div style={{ fontSize: 13, color: '#1f7a45', fontWeight: 800 }}>
            הפעיל שנבחר: {selected.name}
          </div>
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              style={{ border: 'none', borderRadius: 8, padding: '8px 14px', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, cursor: 'pointer', background: '#27ae60', color: '#fff' }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
