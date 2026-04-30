/**
 * AppCard — כרטיס בסיס אחיד
 * ===========================
 * TODO [future]: עדכן כאן — padding, radius, shadow, background
 * 
 * props:
 *   statusKey — מפתח לסטטוס (למשל 'קשר חי') — מוסיף border-right צבעוני
 *   hover     — האם להוסיף אפקט hover
 */
import T from '../../lib/design-tokens';

export default function AppCard({ children, statusKey, hover = true, style, onClick }) {
  const statusColor = statusKey ? T.colors.status[statusKey]?.border : null;

  return (
    <div
      onClick={onClick}
      style={{
        background:   T.colors.neutral.cream,
        borderRadius: T.radius.lg,
        border:       `0.5px solid ${T.colors.neutral.border}`,
        borderRight:  statusColor ? `3px solid ${statusColor}` : `0.5px solid ${T.colors.neutral.border}`,
        boxShadow:    T.shadow.card,
        padding:      `${T.spacing.lg}px`,
        transition:   `box-shadow ${T.motion.normal}, transform ${T.motion.normal}`,
        cursor:       onClick ? 'pointer' : 'default',
        ...style,
      }}
      onMouseEnter={hover ? e => {
        e.currentTarget.style.boxShadow = T.shadow.hover;
        e.currentTarget.style.transform = 'translateY(-1px)';
      } : undefined}
      onMouseLeave={hover ? e => {
        e.currentTarget.style.boxShadow = T.shadow.card;
        e.currentTarget.style.transform = 'translateY(0)';
      } : undefined}
    >
      {children}
    </div>
  );
}
