const {
  REPORT_PROJECT_ID,
  REPORT_PROJECT_NAME,
  buildInteractionReport,
  validateDateRange,
} = require('./interactionReport');

function authorizeCeoProfile(profile) {
  if (!profile) return { ok: false, status: 403, error: 'No profile' };
  if (profile.role !== 'ceo') return { ok: false, status: 403, error: 'הדו״ח זמין למנכ״ל בלבד.' };
  return { ok: true };
}

function queryError(label, error) {
  const message = error?.message || 'שגיאה לא ידועה';
  return new Error(`טעינת ${label} נכשלה: ${message}`);
}

async function loadLiveInteractionReport({ supabase, startDate = '', endDate = '' }) {
  const validation = validateDateRange(startDate, endDate);
  if (!validation.ok) throw new Error(validation.error);
  if (!supabase || typeof supabase.from !== 'function') throw new Error('חיבור Supabase אינו זמין.');

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,name')
    .eq('id', REPORT_PROJECT_ID)
    .single();
  if (projectError) throw queryError('הפרויקט', projectError);
  if (Number(project?.id) !== REPORT_PROJECT_ID || String(project?.name) !== REPORT_PROJECT_NAME) {
    throw new Error('הפרויקט “אחדות יהודית” לא נמצא במזהה המאומת 1.');
  }

  const contactsQuery = supabase
    .from('contacts')
    .select('id,name,activist_id,project_id,is_active,mitzvot_history')
    .eq('project_id', REPORT_PROJECT_ID);

  let interactionsQuery = supabase
    .from('interactions')
    .select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
    .eq('project_id', REPORT_PROJECT_ID);
  if (startDate) interactionsQuery = interactionsQuery.gte('date', startDate);
  if (endDate) interactionsQuery = interactionsQuery.lte('date', endDate);

  // profiles ולא activist_directory: זה דו"ח היסטורי, וה-view (מ-0026 ואילך) מסתיר
  // פעילים שנמחקו-רכות. פעיל שנמחק אחרי שכבר דיווח קשרים בטווח התאריכים חייב עדיין
  // להופיע כאן עם שמו האמיתי — אחרת requireActivistName ב-interactionReport.js
  // מקבל את התקלה "לא נמצא שם אמיתי" וזורק שגיאה על דו"ח שהיה תקין ברגע שדווח.
  const activistsQuery = supabase
    .from('profiles')
    .select('activist_code,name,role,project_id,project_ids');

  const [contactsResult, interactionsResult, activistsResult] = await Promise.all([
    contactsQuery,
    interactionsQuery,
    activistsQuery,
  ]);
  if (contactsResult.error) throw queryError('הלקוחות', contactsResult.error);
  if (interactionsResult.error) throw queryError('הקשרים', interactionsResult.error);
  if (activistsResult.error) throw queryError('הפעילים', activistsResult.error);

  return buildInteractionReport({
    project,
    contacts: contactsResult.data || [],
    interactions: interactionsResult.data || [],
    activists: activistsResult.data || [],
    startDate,
    endDate,
  });
}

function oneQueryValue(value) {
  return typeof value === 'string' ? value : '';
}

function createInteractionReportHandler({ requireAuth, getSupabaseAdmin, loadLiveInteractionReport: loadReport = loadLiveInteractionReport }) {
  return async function interactionReportHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'שיטת בקשה לא נתמכת.' });
    }

    const auth = await requireAuth(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'נדרש להתחבר.' });
    const access = authorizeCeoProfile(auth.profile);
    if (!access.ok) return res.status(access.status).json({ error: 'הדו״ח זמין למנכ״ל בלבד.' });

    const startDate = oneQueryValue(req.query?.from);
    const endDate = oneQueryValue(req.query?.to);
    const validation = validateDateRange(startDate, endDate);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const report = await loadReport({
        supabase: getSupabaseAdmin(),
        startDate,
        endDate,
      });
      return res.status(200).json(report);
    } catch (error) {
      console.error('CEO interaction report failed', error);
      return res.status(500).json({ error: error?.message || 'טעינת הדו״ח נכשלה.' });
    }
  };
}

module.exports = {
  authorizeCeoProfile,
  createInteractionReportHandler,
  loadLiveInteractionReport,
};
