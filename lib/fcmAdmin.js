// lib/fcmAdmin.js — שליחת FCM נייטיב (HTTP v1) למכשירי האפליקציה.
// משלים את ה-web-push הקיים: web-push לדפדפן, FCM לאפליקציית Capacitor.
// no-op בטוח אם FCM_SERVICE_ACCOUNT לא מוגדר (כדי לא לשבור פרוד לפני הגדרת ה-env).
import { JWT } from 'google-auth-library';

let cachedClient = null;
let cachedProjectId = null;

function getServiceAccount() {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error('FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

function getJwtClient() {
  if (cachedClient) return cachedClient;
  const sa = getServiceAccount();
  if (!sa) return null;
  cachedProjectId = sa.project_id;
  cachedClient = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  return cachedClient;
}

// שולח התראת FCM לכל הטוקנים של פעיל. מוחק טוקנים מתים. מחזיר { sent, reason? }.
export async function sendFcmToActivist(supabase, activistId, { title, body, url } = {}) {
  const client = getJwtClient();
  if (!client) return { sent: 0, reason: 'fcm_not_configured' };

  const { data: rows, error } = await supabase
    .from('fcm_tokens')
    .select('token')
    .eq('activist_id', String(activistId));
  if (error) return { sent: 0, reason: error.message };
  if (!rows?.length) return { sent: 0, reason: 'no_tokens' };

  let accessToken;
  try {
    ({ token: accessToken } = await client.getAccessToken());
  } catch (e) {
    console.error('FCM access token failed:', e.message);
    return { sent: 0, reason: 'auth_failed' };
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${cachedProjectId}/messages:send`;
  let sent = 0;

  for (const { token } of rows) {
    const message = {
      message: {
        token,
        notification: { title, body },
        data: { url: url || '/' },
        android: { priority: 'high', notification: { default_sound: true } },
      },
    };
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (r.ok) {
        sent++;
      } else {
        const errBody = await r.json().catch(() => ({}));
        const code =
          errBody?.error?.details?.[0]?.errorCode || errBody?.error?.status || '';
        // טוקן לא תקף/לא רשום → מחיקה כדי לא לנסות שוב
        if (r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
          await supabase.from('fcm_tokens').delete().eq('token', token);
        }
      }
    } catch (e) {
      // שגיאת רשת נקודתית — נמשיך לטוקן הבא
    }
  }

  return { sent };
}
