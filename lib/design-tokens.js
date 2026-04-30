/**
 * DESIGN TOKENS — מערכת מקרבים
 * ================================
 * כאן נמצאים כל ערכי העיצוב הבסיסיים.
 * בעתיד: שנה כאן בלבד כדי לעדכן את כל המערכת.
 *
 * קטגוריות:
 *  - colors      : צבעי מותג, ניטרלים, סטטוסים
 *  - typography  : גדלי טקסט ומשקלים
 *  - radius      : עיגול פינות
 *  - shadow      : צלליות
 *  - spacing     : מרווחים
 *  - motion      : אנימציות ומעברים
 */

const tokens = {

  // ── צבעי מותג ───────────────────────────────────────────
  // TODO [future]: החלף ל-palette יוקרתי — כחול כהה / זהב / אפור-לבן
  colors: {
    brand: {
      primary:   '#6c5ce7',   // סגול ראשי — כפתורים, הדגשות
      primaryBg: '#f0effe',   // רקע סגול עדין
      sidebar:   'linear-gradient(180deg, #8b6dd1 0%, #5a4bd1 50%, #4a3bc1 100%)',
    },

    // ניטרלים
    neutral: {
      white:   '#ffffff',
      cream:   '#fffaf5',     // רקע כרטיסים
      bg:      'linear-gradient(160deg, #fff8f0 0%, #fff2e6 50%, #ffead8 100%)',
      border:  'rgba(0,0,0,0.07)',
      text:    {
        primary:   '#1a1a1a',
        secondary: '#555',
        muted:     '#aaa',
        placeholder: '#bbb',
      },
    },

    // סטטוסי לקוח — שמות אחידים בכל המערכת
    // TODO [future]: התאם ל-palette מוסדי (ירוק→כחול, כתום→סגול, אדום→אפור כהה)
    status: {
      'קשר חי':       { bg: '#edfaf1', text: '#27ae60', border: '#27ae60' },
      'קשר מתמשך':    { bg: '#ebf5fb', text: '#2980b9', border: '#3498db' },
      'דורש חידוש':   { bg: '#fff8ec', text: '#d68910', border: '#f39c12' },
      'על סף ניתוק':  { bg: '#fff0f0', text: '#c0392b', border: '#e74c3c' },
      'לשעבר':         { bg: '#f5f5f5', text: '#888',    border: '#ccc'    },
    },

    // צבעי פעולה
    action: {
      success:  '#27ae60',
      warning:  '#f39c12',
      danger:   '#e74c3c',
      info:     '#3498db',
    },
  },

  // ── טיפוגרפיה ───────────────────────────────────────────
  // TODO [future]: עבור ל-Inter / Neue Haas Grotesk לעיצוב מוסדי
  typography: {
    fontFamily: "'Rubik', sans-serif",
    sizes: {
      xs:   11,
      sm:   12,
      base: 13,
      md:   14,
      lg:   15,
      xl:   17,
      '2xl': 20,
      '3xl': 24,
      hero: 52,
    },
    weights: {
      regular: 400,
      medium:  500,
      bold:    700,
    },
    // כלל: bold רק לשמות אנשים וכפתורים ראשיים
  },

  // ── רדיוסים ─────────────────────────────────────────────
  // TODO [future]: הקטן ל-8px/12px לתחושה מוסדית יותר
  radius: {
    sm:   8,
    md:   12,
    lg:   14,
    xl:   16,
    full: 9999,
  },

  // ── צלליות ──────────────────────────────────────────────
  // TODO [future]: הוסף elevation system (0→4 רמות)
  shadow: {
    card:   '0 1px 4px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.03)',
    hover:  '0 4px 16px rgba(0,0,0,0.09)',
    button: '0 2px 8px rgba(108,92,231,0.25)',
    sidebar:'−6px 0 30px rgba(90,75,209,0.2)',
  },

  // ── מרווחים ─────────────────────────────────────────────
  // TODO [future]: עבור ל-8px grid system
  spacing: {
    xs:  4,
    sm:  8,
    md:  12,
    lg:  16,
    xl:  20,
    '2xl': 24,
    '3xl': 28,
    page: 28,   // padding פנימי לדפים
  },

  // ── תנועה ───────────────────────────────────────────────
  // TODO [future]: הגדר easing curves מדויקים (ease-out, spring)
  motion: {
    fast:    '0.15s ease',
    normal:  '0.2s ease',
    slow:    '0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    sidebar: '0.35s cubic-bezier(0.4, 0, 0.2, 1)',
  },

};

module.exports = tokens;
