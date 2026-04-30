// components/FilterChips.jsx
// ─────────────────────────────────────────────────────────────
// שינוי עיצוב: ערוך .app-chip, .app-chip--active ב-components.css
// ─────────────────────────────────────────────────────────────

export default function FilterChips({ options, active, onChange }) {
  return (
    <div className="chips">
      {options.map(opt => (
        <button
          key={opt.value}
          className={`app-chip ${active === opt.value ? 'app-chip--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
