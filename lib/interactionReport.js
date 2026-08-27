const REPORT_PROJECT_ID = 1;
const REPORT_PROJECT_NAME = 'אחדות יהודית';
const GENERAL_RELATIONSHIPS_ESTIMATE = 850;
const REPORT_DISCLOSURES = [
  'האפליקציה עדיין בפיילוט ראשוני, הערכה שמשקפת 75% מהקשרים והלקוחות האמיתיים',
  'האפליקציה עלתה לאוויר לפני כחודש וחצי',
];

const METRIC_KEYS = [
  'totalInteractions',
  'toraniCount',
  'friendlyCount',
  'frontalCount',
  'videoCount',
  'phoneCount',
  'shabbatHostCount',
  'totalMinutes',
];

function validateDateRange(startDate = '', endDate = '') {
  const valid = value => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!valid(startDate) || !valid(endDate)) return { ok: false, error: 'יש להזין תאריך תקין.' };
  if (startDate && endDate && startDate > endDate) {
    return { ok: false, error: 'תאריך ההתחלה אינו יכול להיות מאוחר מתאריך הסיום.' };
  }
  return { ok: true };
}

function inInclusiveDateRange(value, startDate = '', endDate = '') {
  if (!value) return false;
  const date = String(value).slice(0, 10);
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value, options = {}) {
  return numberOrZero(value).toLocaleString('he-IL', options);
}

function formatDisplayDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  return `${day}.${month}.${year}`;
}

function entityProjectIds(entity) {
  if (Array.isArray(entity?.project_ids) && entity.project_ids.length > 0) {
    return entity.project_ids.map(Number);
  }
  if (entity?.project_id !== undefined && entity.project_id !== null) {
    return [Number(entity.project_id)];
  }
  return [];
}

function activistCode(activist) {
  return Number(activist?.activist_code ?? activist?.id);
}

function buildNameMap(activists) {
  const map = new Map();
  activists.forEach(activist => {
    const id = activistCode(activist);
    const name = String(activist?.name ?? activist?.full_name ?? '').trim();
    if (Number.isFinite(id) && name) map.set(id, name);
  });
  return map;
}

function requireActivistName(names, id) {
  const normalizedId = Number(id);
  const name = names.get(normalizedId);
  if (!name) throw new Error(`לא נמצא שם אמיתי לפעיל ${id} במערכת.`);
  return name;
}

function emptyMetrics(activistId, activistName) {
  return {
    activistId,
    activistName,
    totalClients: 0,
    totalInteractions: 0,
    toraniCount: 0,
    friendlyCount: 0,
    frontalCount: 0,
    videoCount: 0,
    phoneCount: 0,
    shabbatHostCount: 0,
    totalMinutes: 0,
    averageInteractionsPerClient: 0,
    averageDuration: 0,
  };
}

function addInteractionMetrics(metrics, interaction) {
  metrics.totalInteractions += 1;
  metrics.totalMinutes += numberOrZero(interaction.duration_minutes);
  if (interaction.quality === 'תורני') metrics.toraniCount += 1;
  if (interaction.quality === 'ידידותי') metrics.friendlyCount += 1;
  if (interaction.type === 'פרונטלי') metrics.frontalCount += 1;
  if (interaction.type === 'וידאו') metrics.videoCount += 1;
  if (interaction.type === 'טלפוני') metrics.phoneCount += 1;
  if (interaction.type === 'אירוח שבת') metrics.shabbatHostCount += 1;
}

function finishAverages(metrics) {
  metrics.averageInteractionsPerClient = metrics.totalClients > 0
    ? metrics.totalInteractions / metrics.totalClients
    : 0;
  metrics.averageDuration = metrics.totalInteractions > 0
    ? metrics.totalMinutes / metrics.totalInteractions
    : 0;
  return metrics;
}

function groupMitzvot(events, organizational = false) {
  const groups = new Map();
  events.forEach(event => {
    const key = organizational
      ? `${event.mitzva}|${event.levelsGained}`
      : `${event.activistId}|${event.mitzva}|${event.levelsGained}`;
    if (!groups.has(key)) {
      groups.set(key, {
        activistId: organizational ? 'totals' : event.activistId,
        activistName: organizational ? 'סה״כ כל הפעילים' : event.activistName,
        mitzva: event.mitzva,
        levelsGained: event.levelsGained,
        clientIds: new Set(),
        eventCount: 0,
        totalLevels: 0,
      });
    }
    const group = groups.get(key);
    group.clientIds.add(event.contactId);
    group.eventCount += 1;
    group.totalLevels += event.levelsGained;
  });
  return Array.from(groups.values())
    .map(group => ({
      activistId: group.activistId,
      activistName: group.activistName,
      mitzva: group.mitzva,
      levelsGained: group.levelsGained,
      uniqueClients: group.clientIds.size,
      eventCount: group.eventCount,
      totalLevels: group.totalLevels,
    }))
    .sort((a, b) => (
      a.activistName.localeCompare(b.activistName, 'he')
      || a.mitzva.localeCompare(b.mitzva, 'he')
      || a.levelsGained - b.levelsGained
    ));
}

function buildSummarySentence(totals, startDate, endDate) {
  const period = startDate || endDate
    ? `בטווח התאריכים ${startDate ? formatDisplayDate(startDate) : 'תחילת ההיסטוריה'}–${endDate ? formatDisplayDate(endDate) : 'היום'}`
    : 'בכל ההיסטוריה הקיימת במערכת';
  return `${period} בוצעו בסך הכול ${formatNumber(totals.totalInteractions)} קשרים: ${formatNumber(totals.toraniCount)} קשרים תורניים, ${formatNumber(totals.friendlyCount)} קשרים ידידותיים, ${formatNumber(totals.frontalCount)} קשרים פרונטליים, ${formatNumber(totals.videoCount)} קשרי וידאו, ${formatNumber(totals.phoneCount)} קשרים טלפוניים ו־${formatNumber(totals.shabbatHostCount)} אירוחי שבת.`;
}

function buildBaselineInteractions(contacts, recordedInteractions, projectId) {
  const connectedContactIds = new Set(recordedInteractions.map(interaction => interaction.contact_id));
  const uniqueContacts = new Map();
  contacts.forEach(contact => {
    if (!uniqueContacts.has(contact.id)) uniqueContacts.set(contact.id, contact);
  });

  return Array.from(uniqueContacts.values())
    .filter(contact => !connectedContactIds.has(contact.id))
    .map(contact => ({
      id: `baseline-${contact.id}`,
      project_id: projectId,
      activist_id: contact.activist_id,
      contact_id: contact.id,
      quality: 'ידידותי',
      type: 'קשר בסיס',
      duration_minutes: 0,
      date: null,
      isBaseline: true,
    }));
}

function buildExecutiveAnalytics(contacts, interactions) {
  const qualityTypeMatrix = {
    torani: { total: 0, frontal: 0, video: 0, phone: 0, other: 0 },
    friendly: { total: 0, frontal: 0, video: 0, phone: 0, other: 0 },
  };
  const contactStates = new Map();
  contacts.forEach(contact => {
    if (!contactStates.has(contact.id)) {
      contactStates.set(contact.id, { interactionCount: 0, hasTorani: false, hasFriendly: true });
    }
  });

  interactions.forEach(interaction => {
    const qualityKey = interaction.quality === 'תורני'
      ? 'torani'
      : interaction.quality === 'ידידותי' ? 'friendly' : null;
    if (qualityKey) {
      const row = qualityTypeMatrix[qualityKey];
      row.total += 1;
      if (interaction.type === 'פרונטלי') row.frontal += 1;
      else if (interaction.type === 'וידאו') row.video += 1;
      else if (interaction.type === 'טלפוני') row.phone += 1;
      else row.other += 1;
    }

    const state = contactStates.get(interaction.contact_id);
    if (!state) return;
    state.interactionCount += 1;
    if (interaction.quality === 'תורני') state.hasTorani = true;
    if (interaction.quality === 'ידידותי') state.hasFriendly = true;
  });

  const states = Array.from(contactStates.values());
  const personalToraniClients = states.filter(state => state.hasTorani).length;
  const personalFriendlyClients = states.filter(state => !state.hasTorani && state.hasFriendly).length;
  const activeClients = states.length;
  const distribution = [
    { key: '1', label: 'קשר אחד', matches: count => count === 1 },
    { key: '2', label: '2 קשרים', matches: count => count === 2 },
    { key: '3-4', label: '3–4 קשרים', matches: count => count >= 3 && count <= 4 },
    { key: '5-9', label: '5–9 קשרים', matches: count => count >= 5 && count <= 9 },
    { key: '10+', label: '10 קשרים ומעלה', matches: count => count >= 10 },
  ].map(bucket => ({
    key: bucket.key,
    label: bucket.label,
    count: states.filter(state => bucket.matches(state.interactionCount)).length,
  }));

  return {
    qualityTypeMatrix,
    relationshipSegments: {
      generalRelationships: GENERAL_RELATIONSHIPS_ESTIMATE,
      trackedClients: states.length,
      activeClients,
      personalFriendlyClients,
      personalToraniClients,
      activeWithoutPersonalQuality: activeClients - personalFriendlyClients - personalToraniClients,
    },
    clientConnectionDistribution: distribution,
  };
}

function buildInteractionReport({
  project = { id: REPORT_PROJECT_ID, name: REPORT_PROJECT_NAME },
  projectId,
  interactions = [],
  contacts = [],
  activists = [],
  startDate = '',
  endDate = '',
} = {}) {
  const validation = validateDateRange(startDate, endDate);
  if (!validation.ok) throw new Error(validation.error);

  const resolvedProjectId = Number(project?.id ?? projectId ?? REPORT_PROJECT_ID);
  const resolvedProjectName = String(project?.name || REPORT_PROJECT_NAME);
  const projectContacts = contacts.filter(contact => Number(contact.project_id) === resolvedProjectId);
  const recordedProjectInteractions = interactions.filter(interaction => (
    Number(interaction.project_id) === resolvedProjectId
    && inInclusiveDateRange(interaction.date, startDate, endDate)
  ));
  const baselineInteractions = buildBaselineInteractions(
    projectContacts,
    recordedProjectInteractions,
    resolvedProjectId,
  );
  const projectInteractions = [...recordedProjectInteractions, ...baselineInteractions];

  const names = buildNameMap(activists);
  const dataActivistIds = new Set([
    ...projectContacts.map(contact => Number(contact.activist_id)),
    ...projectInteractions.map(interaction => Number(interaction.activist_id)),
  ].filter(Number.isFinite));
  dataActivistIds.forEach(id => requireActivistName(names, id));

  const projectActivistIds = activists
    .filter(activist => activist?.role === 'activist' && entityProjectIds(activist).includes(resolvedProjectId))
    .map(activistCode)
    .filter(Number.isFinite);
  const allActivistIds = new Set([...projectActivistIds, ...dataActivistIds]);
  const rowsById = new Map(Array.from(allActivistIds).map(id => [id, {
    ...emptyMetrics(id, requireActivistName(names, id)),
    clientIds: new Set(),
  }]));

  const organizationalClientIds = new Set();
  projectContacts.forEach(contact => {
    const id = Number(contact.activist_id);
    requireActivistName(names, id);
    rowsById.get(id).clientIds.add(contact.id);
    organizationalClientIds.add(contact.id);
  });
  projectInteractions.forEach(interaction => {
    const id = Number(interaction.activist_id);
    requireActivistName(names, id);
    addInteractionMetrics(rowsById.get(id), interaction);
  });

  const rows = Array.from(rowsById.values())
    .map(row => {
      row.totalClients = row.clientIds.size;
      delete row.clientIds;
      return finishAverages(row);
    })
    .sort((a, b) => a.activistName.localeCompare(b.activistName, 'he'));

  const totals = emptyMetrics('totals', 'סה״כ כל הפעילים');
  totals.totalClients = organizationalClientIds.size;
  projectInteractions.forEach(interaction => addInteractionMetrics(totals, interaction));
  finishAverages(totals);

  const mitzvotEvents = [];
  projectContacts.forEach(contact => {
    const history = Array.isArray(contact.mitzvot_history) ? contact.mitzvot_history : [];
    history.forEach(entry => {
      const oldLevel = Number(entry?.from);
      const newLevel = Number(entry?.to);
      const mitzva = String(entry?.mitzva || '').trim();
      if (!mitzva || !Number.isFinite(oldLevel) || !Number.isFinite(newLevel) || newLevel <= oldLevel) return;
      if (!inInclusiveDateRange(entry?.date, startDate, endDate)) return;
      const activistId = Number(contact.activist_id);
      mitzvotEvents.push({
        activistId,
        activistName: requireActivistName(names, activistId),
        contactId: contact.id,
        contactName: String(contact.name || ''),
        mitzva,
        oldLevel,
        newLevel,
        levelsGained: newLevel - oldLevel,
        date: String(entry.date).slice(0, 10),
      });
    });
  });
  mitzvotEvents.sort((a, b) => (
    a.activistName.localeCompare(b.activistName, 'he')
    || a.mitzva.localeCompare(b.mitzva, 'he')
    || a.date.localeCompare(b.date)
    || Number(a.contactId) - Number(b.contactId)
  ));

  return {
    meta: {
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      startDate,
      endDate,
      interactionCount: projectInteractions.length,
      recordedInteractionCount: recordedProjectInteractions.length,
      baselineInteractionCount: baselineInteractions.length,
      contactCount: organizationalClientIds.size,
      activistCount: rows.length,
      mitzvotEventCount: mitzvotEvents.length,
    },
    rows,
    totals,
    disclosures: [...REPORT_DISCLOSURES],
    summarySentence: buildSummarySentence(totals, startDate, endDate),
    analytics: buildExecutiveAnalytics(projectContacts, projectInteractions),
    mitzvotEvents,
    mitzvotRows: groupMitzvot(mitzvotEvents, false),
    mitzvotTotals: groupMitzvot(mitzvotEvents, true),
  };
}

module.exports = {
  REPORT_DISCLOSURES,
  GENERAL_RELATIONSHIPS_ESTIMATE,
  METRIC_KEYS,
  REPORT_PROJECT_ID,
  REPORT_PROJECT_NAME,
  buildInteractionReport,
  buildExecutiveAnalytics,
  buildSummarySentence,
  formatDisplayDate,
  inInclusiveDateRange,
  validateDateRange,
};
