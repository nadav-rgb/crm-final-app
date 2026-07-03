// lib/projectUtils.js — בדיקת חברות של פעיל/משתמש בפרויקט (תמיכה ברב-פרויקטלי).
// פעיל נושא project_ids (מ-activist_directory / profiles); fallback ל-project_id היחיד.
import { PAID_PROJECT_IDS } from './paymentCalc';

// האם המשתמש/פעיל חבר בפרויקט בתשלום כלשהו (אחדות/נעים להכיר)?
// קובע גישה לדשבורד הכספים, פעולות היום ולוגיקת התשלום בטפסים.
export function inAnyPaidProject(entity) {
  const ids = Array.isArray(entity?.project_ids) && entity.project_ids.length > 0
    ? entity.project_ids
    : (entity?.project_id ? [entity.project_id] : []);
  return ids.some(p => PAID_PROJECT_IDS.includes(Number(p)));
}

export function inProject(entity, projectId) {
  if (projectId === null || projectId === undefined || projectId === 0) return true; // "כל הפרויקטים"
  const ids = Array.isArray(entity?.project_ids) && entity.project_ids.length > 0
    ? entity.project_ids
    : (entity?.project_id ? [entity.project_id] : []);
  return ids.map(Number).includes(Number(projectId));
}
