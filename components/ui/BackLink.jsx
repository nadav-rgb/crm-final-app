// components/ui/BackLink.jsx — קישור חזרה/צפייה עם אייקון SVG אמיתי, לא תו-טקסט.
// כלל הכיוון (RTL, אומת אמפירית — ראה docs/superpowers/specs/2026-09-06-rtl-arrow-redesign-design.md):
// "back" (חזרה) = אייקון לפני הטקסט, לא ממוראר, מצביע ימינה — בדיוק כמו כפתור Back ב-iOS/
// אנדרואיד בעברית. "forward" (צפייה/המשך) = אייקון אחרי הטקסט, ממוראר, מצביע שמאלה.
import Link from 'next/link';

function Chevron() {
  return (
    <svg className="chevron" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export default function BackLink({ href, direction = 'back', variant, children, style, onClick }) {
  const isBack = direction === 'back';
  const resolvedVariant = variant || (isBack ? 'button' : 'link');
  const variantClass = resolvedVariant === 'button' ? 'backlink-button' : 'backlink-link';
  const directionClass = isBack ? 'backlink-back' : 'backlink-forward';
  return (
    <Link href={href} className={`${variantClass} ${directionClass}`} style={style} onClick={onClick}>
      {isBack && <Chevron />}
      {children}
      {!isBack && <Chevron />}
    </Link>
  );
}
