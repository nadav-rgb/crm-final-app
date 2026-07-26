// lib/tourAudience.js — מי מקבל התראה על שינוי בסיור.
// קהל הסיור = המשפחה המארחת + המדריך (אם פעיל שלנו) + המשובצים + ניהול הפרויקט.
// נשלף פעם אחת ומשמש גם לניסוח ההודעה (שמות לפי קוד) וגם לרשימת הנמענים.
//
// שרת בלבד — מקבל supabase admin. update.js עדיין מחזיק גרסה משלו כי היא שזורה
// בחישוב "מי נכנס/יצא מתפקיד"; לאחד כשנוגעים בו ממילא.
import { getProjectManagers } from './notifyRecipients';

export async function getTourAudience(admin, tour, { exclude = [] } = {}) {
  const { data: profiles } = await admin
    .from('profiles')
    .select('activist_code, name, role, project_id, project_ids')
    .not('activist_code', 'is', null);

  const nameByCode = {};
  (Array.isArray(profiles) ? profiles : []).forEach(p => { nameByCode[Number(p.activist_code)] = p.name; });
  const codeName = code => (code == null ? '' : (nameByCode[Number(code)] || `פעיל ${code}`));

  const codes = new Set();
  if (tour.host_activist_id)  codes.add(Number(tour.host_activist_id));
  if (tour.guide_activist_id) codes.add(Number(tour.guide_activist_id));
  (Array.isArray(tour.assigned_activists) ? tour.assigned_activists : []).forEach(c => codes.add(Number(c)));

  const managers = await getProjectManagers(admin, tour.project_id ?? 2);
  managers.forEach(m => codes.add(Number(m.activist_code)));

  exclude.filter(c => c != null).forEach(c => codes.delete(Number(c)));

  const recipients = [...codes]
    .filter(c => !Number.isNaN(c))
    .map(c => ({ activist_code: c, name: codeName(c) }));

  return { codeName, recipients };
}
