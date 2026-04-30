/**
 * AppInput — שדה קלט אחיד
 * ========================
 * TODO [future]: עדכן כאן את עיצוב כל שדות הקלט
 */
import T from '../../lib/design-tokens';

export default function AppInput({ label, error, required, style, ...props }) {
  return (
    <div style={{ marginBottom: error ? 4 : T.spacing.md }}>
      {label && (
        <label style={{
          display: 'block', fontSize: T.typography.sizes.base,
          fontWeight: T.typography.weights.bold, color: T.colors.neutral.text.secondary,
          marginBottom: T.spacing.sm, fontFamily: T.typography.fontFamily,
        }}>
          {label} {required && <span style={{ color: T.colors.action.danger }}>*</span>}
        </label>
      )}
      <input
        {...props}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: `10px ${T.spacing.md}px`,
          fontSize: T.typography.sizes.md,
          fontFamily: T.typography.fontFamily,
          border: `1.5px solid ${error ? T.colors.action.danger : '#ebebeb'}`,
          borderRadius: T.radius.md,
          background: '#fafafa', color: T.colors.neutral.text.primary,
          direction: 'rtl', outline: 'none',
          transition: `all ${T.motion.fast}`,
          ...style,
        }}
        onFocus={e => { e.target.style.borderColor = T.colors.brand.primary; e.target.style.boxShadow = `0 0 0 3px ${T.colors.brand.primaryBg}`; }}
        onBlur={e => { e.target.style.borderColor = error ? T.colors.action.danger : '#ebebeb'; e.target.style.boxShadow = 'none'; }}
      />
      {error && <span style={{ fontSize: T.typography.sizes.xs, color: T.colors.action.danger, marginTop: 4, display: 'block', fontFamily: T.typography.fontFamily }}>{error}</span>}
    </div>
  );
}
