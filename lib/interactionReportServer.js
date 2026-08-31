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

function boundedQuery(query, maxRows) {
  return typeof query?.limit === 'function' ? query.limit(maxRows + 1) : query;
}

function boundedRows(rows, maxRows, label) {
  if (!Array.isArray(rows) || rows.length > maxRows) {
    throw new Error(`טעינת ${label} חרגה מהיקף המאושר.`);
  }
  return rows;
}

function validateMaxRows(maxRows) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10_000) {
    throw new Error('היקף הדו״ח אינו מאושר.');
  }
}

async function loadLiveInteractionReport({ supabase, startDate = '', endDate = '', maxRows = 10_000 }) {
  const validation = validateDateRange(startDate, endDate);
  if (!validation.ok) throw new Error(validation.error);
  if (!supabase || typeof supabase.from !== 'function') throw new Error('חיבור Supabase אינו זמין.');
  validateMaxRows(maxRows);

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,name')
    .eq('id', REPORT_PROJECT_ID)
    .single();
  if (projectError) throw queryError('הפרויקט', projectError);
  if (Number(project?.id) !== REPORT_PROJECT_ID || String(project?.name) !== REPORT_PROJECT_NAME) {
    throw new Error('הפרויקט “אחדות יהודית” לא נמצא במזהה המאומת 1.');
  }

  let contactsQuery = supabase
    .from('contacts')
    .select('id,name,activist_id,project_id,is_active,mitzvot_history')
    .eq('project_id', REPORT_PROJECT_ID);

  let interactionsQuery = supabase
    .from('interactions')
    .select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
    .eq('project_id', REPORT_PROJECT_ID);
  if (startDate) interactionsQuery = interactionsQuery.gte('date', startDate);
  if (endDate) interactionsQuery = interactionsQuery.lte('date', endDate);

  let activistsQuery = supabase
    .from('activist_directory')
    .select('activist_code,name,role,project_id,project_ids');

  contactsQuery = boundedQuery(contactsQuery, maxRows);
  interactionsQuery = boundedQuery(interactionsQuery, maxRows);
  activistsQuery = boundedQuery(activistsQuery, maxRows);
  const [contactsResult, interactionsResult, activistsResult] = await Promise.all([
    contactsQuery, interactionsQuery, activistsQuery,
  ]);
  if (contactsResult.error) throw queryError('הלקוחות', contactsResult.error);
  if (interactionsResult.error) throw queryError('הקשרים', interactionsResult.error);
  if (activistsResult.error) throw queryError('הפעילים', activistsResult.error);

  return buildInteractionReport({
    project,
    contacts: boundedRows(contactsResult.data || [], maxRows, 'הלקוחות'),
    interactions: boundedRows(interactionsResult.data || [], maxRows, 'הקשרים'),
    activists: boundedRows(activistsResult.data || [], maxRows, 'הפעילים'),
    startDate,
    endDate,
  });
}

// Production BFF loader: every query runs through the caller-scoped Supabase
// client from RequestContext. It avoids the legacy directory view and projects
// only the fields required by the report engine.
async function loadScopedInteractionReport({ supabase, startDate = '', endDate = '', maxRows = 10_000 }) {
  const validation = validateDateRange(startDate, endDate);
  if (!validation.ok) throw new Error(validation.error);
  if (!supabase || typeof supabase.from !== 'function') throw new Error('חיבור נתונים אינו זמין.');
  validateMaxRows(maxRows);

  const projectQuery = supabase.from('projects').select('id,name')
    .eq('id', REPORT_PROJECT_ID).single();
  const contactsQuery = supabase.from('contacts')
    .select('id,name,activist_id,project_id,is_active,mitzvot_history')
    .eq('project_id', REPORT_PROJECT_ID);
  let interactionsQuery = supabase.from('interactions')
    .select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
    .eq('project_id', REPORT_PROJECT_ID);
  if (startDate) interactionsQuery = interactionsQuery.gte('date', startDate);
  if (endDate) interactionsQuery = interactionsQuery.lte('date', endDate);
  let profilesQuery = supabase.from('profiles').select('id,activist_code,name,global_role');
  let membershipsQuery = supabase.from('project_memberships')
    .select('user_id,project_id,role,status').eq('status', 'active');
  const boundedProjectQuery = boundedQuery(projectQuery, maxRows);
  const boundedContactsQuery = boundedQuery(contactsQuery, maxRows);
  const boundedInteractionsQuery = boundedQuery(interactionsQuery, maxRows);
  profilesQuery = boundedQuery(profilesQuery, maxRows);
  membershipsQuery = boundedQuery(membershipsQuery, maxRows);

  const [projectResult, contactsResult, interactionsResult, profilesResult, membershipsResult] = await Promise.all([
    boundedProjectQuery, boundedContactsQuery, boundedInteractionsQuery, profilesQuery, membershipsQuery,
  ]);
  if (projectResult.error) throw queryError('הפרויקט', projectResult.error);
  if (contactsResult.error) throw queryError('הלקוחות', contactsResult.error);
  if (interactionsResult.error) throw queryError('הקשרים', interactionsResult.error);
  if (profilesResult.error) throw queryError('הפעילים', profilesResult.error);
  if (membershipsResult.error) throw queryError('שיוכי הפרויקט', membershipsResult.error);
  const project = projectResult.data;
  if (Number(project?.id) !== REPORT_PROJECT_ID || String(project?.name) !== REPORT_PROJECT_NAME) {
    throw new Error('הפרויקט המבוקש אינו זמין.');
  }

  const membershipsByUser = new Map();
  for (const membership of boundedRows(membershipsResult.data || [], maxRows, 'שיוכי הפרויקט')) {
    const rows = membershipsByUser.get(membership.user_id) || [];
    rows.push(membership);
    membershipsByUser.set(membership.user_id, rows);
  }
  const activists = boundedRows(profilesResult.data || [], maxRows, 'הפעילים')
    .filter(profile => profile.activist_code != null)
    .map(profile => {
      const memberships = membershipsByUser.get(profile.id) || [];
      const reportMembership = memberships.find(row => Number(row.project_id) === REPORT_PROJECT_ID);
      return {
        activist_code: profile.activist_code,
        name: profile.name,
        role: profile.global_role === 'ceo' ? 'ceo' : reportMembership?.role ?? null,
        project_id: reportMembership?.project_id ?? null,
        project_ids: memberships.map(row => Number(row.project_id)),
      };
    });

  return buildInteractionReport({
    project,
    contacts: boundedRows(contactsResult.data || [], maxRows, 'הלקוחות'),
    interactions: boundedRows(interactionsResult.data || [], maxRows, 'הקשרים'),
    activists,
    startDate,
    endDate,
  });
}

function oneQueryValue(value) {
  return typeof value === 'string' ? value : '';
}

function createInteractionReportHandler({ requireAuth, getRequestDb, loadLiveInteractionReport: loadReport = loadScopedInteractionReport }) {
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

    res.setHeader('Cache-Control', 'no-store, private');
    try {
      if (typeof getRequestDb !== 'function') throw new Error('Request-scoped data access is unavailable');
      const report = await loadReport({
        supabase: getRequestDb(req, auth),
        startDate,
        endDate,
      });
      return res.status(200).json(report);
    } catch (error) {
      console.error('CEO interaction report failed', error);
      return res.status(500).json({ error: 'טעינת הדו״ח נכשלה.' });
    }
  };
}

module.exports = {
  authorizeCeoProfile,
  createInteractionReportHandler,
  loadLiveInteractionReport,
  loadScopedInteractionReport,
};
