// lib/notifyRecipients.js — שכבה אחת לכל התראה cross-user בצד-שרת: מי הנמענים, כתיבת פעמון, ו-Push.
// שרת בלבד (משתמש ב-supabase admin + מפתחות VAPID/FCM). אין לייבא מקוד שרץ בדפדפן.
//
// למה זה קיים: עד היום כל מסלול התראה שכפל את אותה לוגיקה (tours/report, base-meetings/notify),
// והמסלולים שנכתבו מהדפדפן (createDemoNotification) כתבו שורת פעמון בלבד — בלי Push בפועל,
// כי sendWebPushToActivist/sendFcmToActivist דורשים סודות שקיימים רק בשרת.
import { sendWebPushToActivist } from './webPushSend';
import { sendFcmToActivist } from './fcmAdmin';

// גוף ההתראה ב-Push מקוצר (סיכומי AI ארוכים) — הטקסט המלא נשאר בשורת הפעמון.
const PUSH_BODY_MAX = 180;

function truncate(text, max = PUSH_BODY_MAX) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// חברות בפרויקט — project_ids גובר, נפילה ל-project_id הבודד.
// חשוב: סינון לפי project_id בלבד מפספס משתמשים רב-פרויקטליים (נדב = project_ids [1,2]).
function memberOfProject(profile, projectId) {
  const ids = Array.isArray(profile.project_ids) && profile.project_ids.length
    ? profile.project_ids
    : (profile.project_id != null ? [profile.project_id] : []);
  return ids.map(Number).includes(Number(projectId));
}

// נמעני-ניהול של פרויקט: מנכ"ל (רואה הכל) + רכז/ראש/כספים החברים בפרויקט, למעט excludeUserId.
// שכפול מכוון של תנאי ה-RPC app_notification_recipients (migration 0015) — ה-RPC עצמו לא שמיש
// כאן: הוא security definer שקורא את ה-JWT של הקורא, ולמפתח service-role אין JWT → יחזיר ריק.
export async function getProjectManagers(supabase, projectId, { excludeUserId = null, roles = null } = {}) {
  const allowedRoles = roles || ['ceo', 'coord', 'head', 'finance'];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, project_id, project_ids')
    .in('role', allowedRoles)
    .not('id', 'is', null);
  if (error) {
    console.error('getProjectManagers failed:', error.message);
    return [];
  }
  return (data || []).filter(p =>
    p.id !== excludeUserId &&
    (p.role === 'ceo' || memberOfProject(p, projectId))
  ).map((p) => ({ user_id: p.id, name: p.name }));
}

// כותב שורת פעמון (upsert לפי client_id) + שולח Push לכל נמען.
// clientId(recipientCode) חייב להיות דטרמיניסטי כדי שריצה חוזרת לא תכפיל התראות.
// best-effort לחלוטין: כשל כאן לא אמור להפיל את הפעולה העסקית שקראה לו.
export async function notifyRecipients(supabase, recipients, { title, body, url, type = 'system', priority = 'normal', clientId }) {
  if (!Array.isArray(recipients) || recipients.length === 0) return [];

  const rows = recipients.map(r => ({
    recipient_user_id: r.user_id,
    client_id: clientId(r.user_id),
    type,
    title,
    body,
    url: url || null,
    priority,
  }));

  const { error } = await supabase.from('notifications').upsert(rows, { onConflict: 'client_id' });
  if (error) console.error('notifyRecipients: bell upsert failed:', error.message);

  const pushBody = truncate(body);
  return Promise.all(
    recipients.map(async (r) => {
      let push = 0;
      try {
        const [web, fcm] = await Promise.all([
          sendWebPushToActivist(supabase, r.user_id, { title, body: pushBody, url: url || '/' }),
          sendFcmToActivist(supabase, r.user_id, { title, body: pushBody, url: url || '/' }),
        ]);
        push = (web?.sent || 0) + (fcm?.sent || 0);
      } catch (e) {
        console.error('notifyRecipients: push delivery failed', e?.message || e);
      }
      return { id: r.user_id, name: r.name || null, push };
    })
  );
}
