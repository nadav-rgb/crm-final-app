// components/ClientSearchSelect.jsx
// בורר לקוח יחיד עם חיפוש — מחליף <select> ילידי בשורות המשתתפים של מפגש רב-משתתפים.
// דיווח מוטי גלעד (2026-07-29): "צריך לבחור לקוח מרשימה ולא כל הלקוחות מופיעים".
// ה-select הילידי במובייל נפתח כגלגלת שקשה לסרוק, ובלי חיפוש קל להחמיץ שם ברשימה
// של עשרים לקוחות. כאן מקלידים חלק מהשם ורואים את ההתאמות.
//
// props:
//   options      — [{ id, name, city }] הלקוחות שניתן לבחור
//   value        — מזהה הלקוח שנבחר (string או number), '' כשאין
//   onChange(id) — נקרא עם המזהה כמחרוזת, כדי להתאים לחוזה של <select> שהוחלף
//   placeholder  — טקסט השדה הריק
import { useState, useMemo } from 'react';

export default function ClientSearchSelect({ options = [], value = '', onChange, placeholder = 'חפש לקוח בשם...' }) {
  const [query, setQuery] = useState('');
  const [open,  setOpen]  = useState(false);

  const selected = useMemo(
    () => options.find(o => String(o.id) === String(value)) || null,
    [options, value]
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return options.slice(0, 12); // ריק = 12 הראשונים, שיהיה מה ללחוץ בלי להקליד
    return options.filter(o => (o.name || '').includes(q)).slice(0, 12);
  }, [options, query]);

  // נבחר כבר לקוח — מציגים אותו כ"שבב" עם כפתור החלפה, לא שדה חיפוש פתוח.
  if (selected) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: '#f0effe', border: '1.5px solid #d9d4f7', minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#4b3ba8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected.name}
        </span>
        <button type="button" onClick={() => { onChange && onChange(''); setQuery(''); setOpen(true); }}
          style={{ marginRight: 'auto', border: 'none', background: 'none', color: '#6c5ce7', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}>
          החלף
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
      <input
        type="text"
        className="form-input"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // השהיה קצרה: בלעדיה ה-blur סוגר את הרשימה לפני שה-click על פריט נרשם
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={{ marginBottom: 0 }}
      />

      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, marginTop: 4, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto' }}>
          {results.map(o => (
            <button
              key={o.id}
              type="button"
              onMouseDown={() => { onChange && onChange(String(o.id)); setQuery(''); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'right', border: 'none', borderBottom: '0.5px solid #f2f2f2', background: '#fff', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#333' }}
            >
              <b>{o.name}</b>
              {o.city ? <span style={{ color: '#aaa', fontSize: 12 }}> · {o.city}</span> : null}
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && results.length === 0 && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, marginTop: 4, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 10, padding: '10px 12px', color: '#aaa', fontSize: 12.5, lineHeight: 1.5 }}>
          אין לקוח כזה ברשימה שלך — רשום אותו בשדה "משתתפים נוספים" למטה.
        </div>
      )}
    </div>
  );
}
