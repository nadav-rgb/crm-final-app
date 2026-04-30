/**
 * AppButton — כפתור בסיס אחיד
 * ==============================
 * TODO [future]: עדכן כאן את עיצוב הכפתורים לכל המערכת
 * variants: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
 * sizes:    'sm' | 'md' | 'lg'
 */
import T from '../../lib/design-tokens';

const SIZES = {
  sm: { padding: '6px 12px',  fontSize: T.typography.sizes.xs   },
  md: { padding: '9px 18px',  fontSize: T.typography.sizes.base },
  lg: { padding: '12px 24px', fontSize: T.typography.sizes.md   },
};

const VARIANTS = {
  primary:   { background: `linear-gradient(135deg, ${T.colors.brand.primary}, #a29bfe)`, color: '#fff', boxShadow: T.shadow.button, border: 'none' },
  secondary: { background: '#fff', color: T.colors.neutral.text.secondary, border: `1.5px solid rgba(0,0,0,0.12)` },
  ghost:     { background: 'transparent', color: T.colors.brand.primary, border: `1.5px solid ${T.colors.brand.primary}` },
  success:   { background: T.colors.action.success, color: '#fff', border: 'none' },
  danger:    { background: 'transparent', color: T.colors.action.danger, border: `1.5px solid ${T.colors.action.danger}` },
};

export default function AppButton({ children, variant = 'secondary', size = 'md', onClick, href, style, disabled, title }) {
  const s = {
    fontFamily: T.typography.fontFamily,
    fontWeight: T.typography.weights.bold,
    borderRadius: T.radius.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: `all ${T.motion.normal}`,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    textDecoration: 'none', opacity: disabled ? 0.5 : 1,
    ...SIZES[size],
    ...VARIANTS[variant],
    ...style,
  };
  if (href) return <a href={href} style={s} onClick={onClick}>{children}</a>;
  return <button style={s} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}
