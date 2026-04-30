/**
 * EmptyState — מצב ריק אחיד
 * ==========================
 * TODO [future]: עדכן כאן את עיצוב מצבי הריק
 */
import T from '../../lib/design-tokens';

export default function EmptyState({ icon = '📭', title, subtitle }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: `${T.spacing['3xl']}px ${T.spacing['2xl']}px`,
      color: T.colors.neutral.text.muted,
      fontFamily: T.typography.fontFamily,
    }}>
      <div style={{ fontSize: 44, marginBottom: T.spacing.md }}>{icon}</div>
      {title && <div style={{ fontSize: T.typography.sizes.lg, fontWeight: T.typography.weights.bold, color: T.colors.neutral.text.secondary, marginBottom: T.spacing.xs }}>{title}</div>}
      {subtitle && <div style={{ fontSize: T.typography.sizes.base, color: T.colors.neutral.text.muted }}>{subtitle}</div>}
    </div>
  );
}
