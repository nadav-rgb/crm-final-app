/**
 * AppBadge — תגית סטטוס אחידה
 * =============================
 * TODO [future]: עדכן כאן את גדלי ועיצובי התגיות
 * 
 * statusKey — מפתח מ-design-tokens.colors.status
 * או: bg + color ידני
 */
import T from '../../lib/design-tokens';

export default function AppBadge({ statusKey, children, bg, color, style }) {
  const s = statusKey ? T.colors.status[statusKey] : null;
  return (
    <span style={{
      display:      'inline-block',
      padding:      '3px 10px',
      borderRadius: T.radius.full,
      fontSize:     T.typography.sizes.xs,
      fontWeight:   T.typography.weights.bold,
      fontFamily:   T.typography.fontFamily,
      whiteSpace:   'nowrap',
      background:   bg ?? s?.bg ?? T.colors.neutral.cream,
      color:        color ?? s?.text ?? T.colors.neutral.text.muted,
      ...style,
    }}>
      {children ?? statusKey}
    </span>
  );
}
