/**
 * PageHeader — כותרת עמוד אחידה
 * ================================
 * TODO [future]: עדכן כאן את עיצוב כותרות הדפים
 */
import T from '../../lib/design-tokens';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(12px)',
      borderBottom: `0.5px solid ${T.colors.neutral.border}`,
      padding: `${T.spacing.lg}px ${T.spacing.page}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div>
        <div style={{
          fontSize: T.typography.sizes['2xl'],
          fontWeight: T.typography.weights.bold,
          color: '#2d1f5e',
          letterSpacing: '-0.3px',
          fontFamily: T.typography.fontFamily,
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: T.typography.sizes.sm,
            color: '#b8a8e0',
            marginTop: 3,
            fontWeight: T.typography.weights.regular,
            fontFamily: T.typography.fontFamily,
          }}>{subtitle}</div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: T.spacing.sm }}>{actions}</div>}
    </div>
  );
}
