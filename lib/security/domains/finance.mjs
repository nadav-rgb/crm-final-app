import { SecurityError } from '../errors.mjs';
import { authorize } from '../rbac.mjs';
import { bonusCancellationCreateSchema, expenseCreateSchema } from '../schemas.mjs';
import { escapeHtmlText } from './contacts.mjs';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BONUS_TYPES = new Set(['בונוס-לימוד-4', 'בונוס-לימוד-6', 'בונוס-מצוות', 'בונוס-חדש', 'בונוס-תורני']);
const TORANI_BONUS_AMOUNT = 1000;
const TORANI_BONUS_MONTHS = 3;
const ACTIVITY_CATEGORIES = new Map([
  ['phone-friendly', 'טלפוני ידידותי'],
  ['phone-torani', 'טלפוני תורני'],
  ['video-friendly', 'זום ידידותי'],
  ['video-torani', 'זום תורני'],
  ['frontal-friendly', 'פרונטלי ידידותי'],
  ['frontal-torani', 'פרונטלי תורני'],
  ['frontal-multi', 'פרונטלי רב משתתפים'],
  ['shabbat-hosting', 'אירוח שבת'],
]);

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

function membership(context, projectId) {
  return context?.memberships?.find((entry) => entry.status === 'active' && Number(entry.projectId) === Number(projectId));
}

function onlyActiveMembership(context) {
  const active = context?.memberships?.filter((entry) => entry.status === 'active') ?? [];
  if (active.length !== 1) throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  return active[0];
}

export function escapeSpreadsheetFormula(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function assertCeoReportAccess(context) {
  requireContext(context);
  if (context.globalRole !== 'ceo') throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
}

export function paymentRequestCommand(context, input = {}) {
  requireContext(context);
  if (!PERIOD.test(String(input.period ?? ''))) throw new SecurityError(400, 'VALIDATION_FAILED', 'Payment period is invalid');

  const requestedProject = input.projectId == null ? null : Number(input.projectId);
  const requestedUser = input.userId == null ? null : String(input.userId);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return { period: input.period, project_id: requestedProject, user_id: requestedUser };
  }

  const active = requestedProject == null ? onlyActiveMembership(context) : membership(context, requestedProject);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Payment scope was not found');
  if (active.role === 'activist') {
    if (requestedUser && requestedUser !== context.userId) throw new SecurityError(404, 'NOT_FOUND', 'Payment was not found');
    return { period: input.period, project_id: Number(active.projectId), user_id: context.userId };
  }
  if (!authorize(context, 'finance:read', { projectId: active.projectId })) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  return { period: input.period, project_id: Number(active.projectId), user_id: requestedUser };
}

export function toPaymentDto(row) {
  const activityByType = jsonValue(row.activity_by_type, [])
    .filter((item) => item && ACTIVITY_CATEGORIES.has(item.key))
    .slice(0, ACTIVITY_CATEGORIES.size)
    .map((item) => ({
      key: item.key,
      label: ACTIVITY_CATEGORIES.get(item.key),
      count: Math.max(0, Number.parseInt(item.count ?? 0, 10) || 0),
      unitRate: Number.isFinite(Number(item.unitRate)) ? Number(item.unitRate) : 0,
      total: Number.isFinite(Number(item.total)) ? Number(item.total) : 0,
    }));
  const bonusByType = jsonValue(row.bonus_by_type, [])
    .filter((item) => item && BONUS_TYPES.has(item.type))
    .slice(0, BONUS_TYPES.size)
    .map((item) => ({
      type: item.type,
      count: Math.max(0, Number.parseInt(item.count ?? 0, 10) || 0),
      total: Number.isFinite(Number(item.total)) ? Number(item.total) : 0,
    }));
  const unpaidByReason = jsonValue(row.unpaid_by_reason, [])
    .filter((item) => item && typeof item.reason === 'string' && /^[a-z0-9-]{1,40}$/.test(item.reason))
    .slice(0, 16)
    .map((item) => ({
      reason: item.reason,
      label: escapeHtmlText(escapeSpreadsheetFormula(String(item.label ?? '').slice(0, 160))),
      count: Math.max(0, Number.parseInt(item.count ?? 0, 10) || 0),
    }));
  return {
    userId: row.user_id,
    name: escapeHtmlText(escapeSpreadsheetFormula(row.name ?? '')),
    period: row.period,
    activityTotal: Number(row.activity_total ?? 0),
    bonusTotal: Number(row.bonus_total ?? 0),
    tourTotal: Number(row.tour_total ?? 0),
    expenseTotal: Number(row.expense_total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    activityByType,
    bonusByType,
    unpaidByReason,
  };
}

export function toPaymentConfigDto(row) {
  return {
    BASE_PRICES: {
      'טלפוני-ידידותי': Number(row.rate_phone_friendly),
      'טלפוני-תורני': Number(row.rate_phone_torani),
      'וידאו-תורני': Number(row.rate_video_torani),
      'וידאו-ידידותי': Number(row.rate_video_friendly),
      'פרונטלי-ידידותי': Number(row.rate_frontal_friendly),
      'פרונטלי-תורני': Number(row.rate_frontal_torani),
      'פרונטלי-רב משתתפים': Number(row.rate_multi),
      'אירוח שבת': Number(row.rate_shabbat_hosting),
    },
    MONTHLY_CAPS: {
      phone: Number(row.cap_phone), frontal: Number(row.cap_frontal), multi: Number(row.cap_multi),
    },
    PER_CONTACT_CAPS: {
      high: { frontal: Number(row.cap_contact_frontal_high), phone: Number(row.cap_contact_phone_high) },
      regular: { frontal: Number(row.cap_contact_frontal_regular), phone: Number(row.cap_contact_phone_regular) },
    },
    LEARNING_BONUS: { 4: Number(row.bonus_loyalty_4), 6: Number(row.bonus_loyalty_6) },
    MITZVOT_BONUS_PER_LEVEL: Number(row.bonus_mitzvot_level),
    NEW_PARTICIPANT_BONUS: Number(row.bonus_new_participant),
    MIN_DURATION: Number(row.min_duration_minutes),
    CAP_EXCEED_BLOCKS: Boolean(row.cap_exceed_blocks),
    TOUR_GUIDE_RATE: Number(row.rate_tour_guide),
  };
}

export async function createExpenseCommand(context, input, dependencies = {}) {
  requireContext(context);
  const parsed = expenseCreateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const active = dependencies.membership ?? onlyActiveMembership(context);
  const resource = { projectId: active.projectId, actorUserId: context.userId };
  if (!authorize(context, 'expense:create', resource)) throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  const activistCode = Number(dependencies.activistCode);
  if (!Number.isInteger(activistCode) || activistCode <= 0) {
    throw new SecurityError(409, 'IDENTITY_MAPPING_REQUIRED', 'Expense identity mapping is unavailable');
  }
  return {
    activist_id: activistCode,
    actor_user_id: context.userId,
    project_id: Number(active.projectId),
    date: parsed.data.occurredOn,
    amount: parsed.data.amount,
    description: parsed.data.description,
  };
}

export function assertExpenseAccess(context, row, action = 'read') {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const active = membership(context, row?.project_id);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Expense was not found');
  if (active.role === 'activist' && row?.actor_user_id !== context.userId) throw new SecurityError(404, 'NOT_FOUND', 'Expense was not found');
  if (action === 'delete') {
    if (active.role === 'head' && context.aal >= 2) return;
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  if (action === 'read') {
    if (active.role === 'activist' || authorize(context, 'finance:read', { projectId: row.project_id })) return;
  } else if (authorize(context, `expense:${action}`, { projectId: row.project_id, actorUserId: row.actor_user_id })) return;
  throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
}

export function assertExpenseListAccess(context) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const hasRawExpenseScope = (context.memberships ?? []).some((entry) => (
    entry.status === 'active' && (
      entry.role === 'activist'
      || authorize(context, 'finance:read', { projectId: entry.projectId })
    )
  ));
  if (!hasRawExpenseScope) throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
}

export function toExpenseDto(row) {
  return {
    id: row.id,
    userId: row.actor_user_id,
    activistCode: row.activist_id == null ? null : Number(row.activist_id),
    projectId: Number(row.project_id),
    amount: Number(row.amount),
    occurredOn: row.date,
    description: escapeHtmlText(row.description ?? ''),
    createdAt: row.created_at ?? null,
  };
}

export function parseBonusKey(value) {
  if (typeof value !== 'string' || value.length > 512) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Bonus key is invalid');
  }
  const [rawCode, type, contactId, monthKey, ...extra] = value.split('|');
  const activistCode = Number(rawCode);
  const match = /^(\d{4})-(\d{1,2})$/.exec(monthKey ?? '');
  const month = Number(match?.[2]);
  if (extra.length > 0 || !Number.isInteger(activistCode) || activistCode <= 0
    || !BONUS_TYPES.has(type) || !/^[A-Za-z0-9_-]{1,128}$/.test(contactId ?? '')
    || !match || month < 0 || month > 11) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Bonus key is invalid');
  }
  return {
    activistCode, type, contactId, monthKey,
    period: `${match[1]}-${String(month + 1).padStart(2, '0')}`,
  };
}

export function assertBonusCancellationAccess(context, resource) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const active = membership(context, resource?.project_id ?? resource?.projectId);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Bonus was not found');
  if (active.role === 'head' && context.aal < 2) {
    throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  }
  if (!authorize(context, 'bonus:cancel', { projectId: active.projectId })) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
}

export function bonusCandidateRequestCommand(context, input = {}) {
  requireContext(context);
  if (!PERIOD.test(String(input.period ?? '')) || !UUID.test(String(input.userId ?? ''))) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Bonus query is invalid');
  }
  const requestedProject = input.projectId == null ? null : Number(input.projectId);
  if (requestedProject != null && (!Number.isInteger(requestedProject) || requestedProject <= 0)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Bonus query is invalid');
  }
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return { period: input.period, project_id: requestedProject, user_id: input.userId };
  }

  const active = requestedProject == null
    ? (context.memberships ?? []).filter((entry) => entry.status === 'active' && ['coord', 'head'].includes(entry.role))
    : [membership(context, requestedProject)].filter(Boolean);
  if (active.length === 0 && requestedProject != null) throw new SecurityError(404, 'NOT_FOUND', 'Bonus scope was not found');
  if (active.length !== 1) {
    const hasAnyActiveMembership = (context.memberships ?? []).some((entry) => entry.status === 'active');
    throw new SecurityError(hasAnyActiveMembership ? 403 : 400,
      hasAnyActiveMembership ? 'CAPABILITY_DENIED' : 'PROJECT_REQUIRED', 'Access is denied');
  }
  if (active[0].role === 'head' && context.aal < 2) {
    throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  }
  if (!['coord', 'head'].includes(active[0].role)) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  return { period: input.period, project_id: Number(active[0].projectId), user_id: input.userId };
}

function periodBounds(period) {
  if (!PERIOD.test(String(period ?? ''))) throw new SecurityError(400, 'VALIDATION_FAILED', 'Payment period is invalid');
  const [year, oneBasedMonth] = period.split('-').map(Number);
  const nextYear = oneBasedMonth === 12 ? year + 1 : year;
  const nextMonth = oneBasedMonth === 12 ? 1 : oneBasedMonth + 1;
  return {
    start: `${year}-${String(oneBasedMonth).padStart(2, '0')}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
    monthKey: `${year}-${oneBasedMonth - 1}`,
  };
}

export function ownBonusCancellationRequest(context, input = {}, activistCode) {
  requireContext(context);
  const { monthKey } = periodBounds(input.period);
  const code = Number(activistCode);
  if (!Number.isInteger(code) || code <= 0) {
    throw new SecurityError(409, 'IDENTITY_MAPPING_REQUIRED', 'Payment identity mapping is unavailable');
  }
  return { user_id: context.userId, activist_code: code, period: input.period, month_key: monthKey };
}

function jsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function inPeriod(value, start, end) {
  const date = typeof value === 'string' ? value.slice(0, 10) : '';
  return date >= start && date < end;
}

export function buildBonusCandidates({ activistCode, contacts = [], interactions = [], config, cancelledKeys = new Set(), period }) {
  const { start, end, monthKey } = periodBounds(period);
  if (!Number.isInteger(Number(activistCode)) || Number(activistCode) <= 0 || !config) {
    throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Bonus data is unavailable');
  }
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const candidates = new Map();
  const add = (type, contactId, amount) => {
    const key = `${Number(activistCode)}|${type}|${contactId}|${monthKey}`;
    if (cancelledKeys.has(key)) return;
    const numericAmount = Number(amount ?? 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;
    const existing = candidates.get(key);
    candidates.set(key, { key, type, amount: numericAmount + Number(existing?.amount ?? 0) });
  };

  const learningCounts = new Map();
  for (const interaction of interactions) {
    const participants = jsonValue(interaction.participants, {});
    if (!contactById.has(String(interaction.contact_id)) || !inPeriod(interaction.date, start, end)
      || participants?.derived_from || interaction.quality !== 'תורני'
      || !['פרונטלי', 'וידאו'].includes(interaction.type)
      || Number(interaction.duration_minutes ?? 0) < Number(config.min_duration_minutes ?? 15)) continue;
    const key = String(interaction.contact_id);
    learningCounts.set(key, (learningCounts.get(key) ?? 0) + 1);
  }
  for (const [contactId, count] of learningCounts) {
    if (count >= 6) add('בונוס-לימוד-6', contactId, config.bonus_loyalty_6);
    else if (count >= 4) add('בונוס-לימוד-4', contactId, config.bonus_loyalty_4);
  }

  for (const contact of contacts) {
    const contactId = String(contact.id);
    const mitzvotInMonth = new Set();
    for (const event of jsonValue(contact.mitzvot_history, [])) {
      const eventDate = typeof event?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(event.date)
        ? event.date : new Date().toISOString();
      if (event?.mitzva && Number(event.to ?? 0) > Number(event.from ?? 0) && inPeriod(eventDate, start, end)) {
        mitzvotInMonth.add(String(event.mitzva));
      }
    }
    for (const _mitzva of mitzvotInMonth) add('בונוס-מצוות', contactId, config.bonus_mitzvot_level);
    if (inPeriod(contact.joined_at, start, end) && (contact.source === 'external' || contact.referred_by != null)) {
      add('בונוס-חדש', contactId, config.bonus_new_participant);
    }
  }

  const toraniMonths = new Map();
  for (const interaction of interactions) {
    const contactId = String(interaction.contact_id ?? '');
    const participants = jsonValue(interaction.participants, {});
    if (!contactById.has(contactId) || participants?.derived_from || interaction.quality !== 'תורני'
      || Number(interaction.duration_minutes ?? 0) < Number(config.min_duration_minutes ?? 15)) continue;
    const match = /^(\d{4})-(\d{2})-\d{2}/.exec(String(interaction.date ?? ''));
    if (!match) continue;
    const ordinal = Number(match[1]) * 12 + Number(match[2]) - 1;
    if (!toraniMonths.has(contactId)) toraniMonths.set(contactId, new Set());
    toraniMonths.get(contactId).add(ordinal);
  }
  const [periodYear, periodMonth] = period.split('-').map(Number);
  const requestedOrdinal = periodYear * 12 + periodMonth - 1;
  for (const [contactId, ordinals] of toraniMonths) {
    const sorted = [...ordinals].sort((left, right) => left - right);
    let run = 0;
    let previous = null;
    let completion = null;
    for (const ordinal of sorted) {
      run = previous != null && ordinal === previous + 1 ? run + 1 : 1;
      previous = ordinal;
      if (run >= TORANI_BONUS_MONTHS) {
        completion = ordinal;
        break;
      }
    }
    if (completion === requestedOrdinal) add('בונוס-תורני', contactId, TORANI_BONUS_AMOUNT);
  }
  return [...candidates.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function bonusCancellationCommand(context, input, dependencies = {}) {
  requireContext(context);
  const parsed = bonusCancellationCreateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const key = parseBonusKey(parsed.data.bonusKey);
  const { contact, candidate } = dependencies;
  if (!contact || String(contact.id) !== key.contactId
    || Number(contact.activist_id) !== key.activistCode
    || contact.assigned_user_id == null || candidate?.key !== parsed.data.bonusKey) {
    throw new SecurityError(404, 'NOT_FOUND', 'Bonus was not found');
  }
  assertBonusCancellationAccess(context, contact);
  const actorActivistCode = dependencies.actorActivistCode == null ? null : Number(dependencies.actorActivistCode);
  if (actorActivistCode != null && (!Number.isInteger(actorActivistCode) || actorActivistCode <= 0)) {
    throw new SecurityError(409, 'IDENTITY_MAPPING_REQUIRED', 'Actor identity mapping is unavailable');
  }
  return {
    bonus_key: parsed.data.bonusKey,
    activist_id: key.activistCode,
    project_id: Number(contact.project_id),
    desc: key.type,
    amount: Number(candidate.amount),
    cancelled_by: actorActivistCode,
    beneficiary_user_id: contact.assigned_user_id,
    cancelled_by_user_id: context.userId,
  };
}

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

const EXPENSE_COLUMNS = 'id,activist_id,actor_user_id,project_id,date,amount,description,created_at';

export async function listExpenses(context) {
  requireContext(context);
  assertExpenseListAccess(context);
  const { data, error } = await context.db.from('expenses').select(EXPENSE_COLUMNS).order('date', { ascending: false });
  dbError(error);
  return (data ?? []).map((row) => { assertExpenseAccess(context, row, 'read'); return toExpenseDto(row); });
}

export async function createExpense(context, input) {
  const { data: profile, error: profileError } = await context.db.from('profiles')
    .select('id,activist_code').eq('id', context.userId).maybeSingle();
  dbError(profileError);
  if (!profile) throw new SecurityError(409, 'IDENTITY_MAPPING_REQUIRED', 'Expense identity mapping is unavailable');
  const command = await createExpenseCommand(context, input, { activistCode: profile.activist_code });
  const { data, error } = await context.db.from('expenses').insert(command).select(EXPENSE_COLUMNS).single();
  dbError(error);
  return toExpenseDto(data);
}

export async function deleteExpense(context, id) {
  const { data: row, error: readError } = await context.db.from('expenses').select(EXPENSE_COLUMNS).eq('id', id).maybeSingle();
  dbError(readError);
  if (!row) throw new SecurityError(404, 'NOT_FOUND', 'Expense was not found');
  assertExpenseAccess(context, row, 'delete');
  const { data, error } = await context.db.rpc('app_delete_expense', { p_expense_id: id });
  dbError(error);
  if (data !== true) throw new SecurityError(404, 'NOT_FOUND', 'Expense was not found');
  return { deleted: true };
}

export async function listPayments(context, input) {
  const command = paymentRequestCommand(context, input);
  const { data, error } = await context.db.rpc('app_finance_summary', {
    p_period: command.period, p_project_id: command.project_id, p_user_id: command.user_id,
  });
  dbError(error);
  return (data ?? []).map(toPaymentDto);
}

const BONUS_CONTACT_COLUMNS = 'id,project_id,assigned_user_id,activist_id,joined_at,source,referred_by,mitzvot_history';
const BONUS_INTERACTION_COLUMNS = 'id,contact_id,project_id,actor_user_id,type,quality,duration_minutes,date,participants';
const BONUS_CONFIG_COLUMNS = 'bonus_loyalty_4,bonus_loyalty_6,bonus_mitzvot_level,bonus_new_participant,min_duration_minutes';
const PAYMENT_CONFIG_COLUMNS = [
  'rate_phone_friendly','rate_phone_torani','rate_video_torani','rate_video_friendly',
  'rate_frontal_friendly','rate_frontal_torani','rate_multi','rate_shabbat_hosting',
  'cap_phone','cap_frontal','cap_multi','cap_contact_frontal_high','cap_contact_phone_high',
  'cap_contact_frontal_regular','cap_contact_phone_regular','bonus_loyalty_4','bonus_loyalty_6',
  'bonus_mitzvot_level','bonus_new_participant','min_duration_minutes','cap_exceed_blocks','rate_tour_guide',
].join(',');

export async function getPaymentConfig(context) {
  requireContext(context);
  const { data, error } = await context.db.from('payment_config')
    .select(PAYMENT_CONFIG_COLUMNS).eq('id', 1).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Payment configuration is unavailable');
  return toPaymentConfigDto(data);
}

export async function listOwnBonusCancellations(context, input) {
  requireContext(context);
  const { data: profile, error: profileError } = await context.db.from('profiles')
    .select('id,activist_code').eq('id', context.userId).maybeSingle();
  dbError(profileError);
  if (!profile) throw new SecurityError(409, 'IDENTITY_MAPPING_REQUIRED', 'Payment identity mapping is unavailable');
  const command = ownBonusCancellationRequest(context, input, profile.activist_code);
  const { data, error } = await context.db.from('bonus_cancellations').select('bonus_key')
    .eq('beneficiary_user_id', command.user_id)
    .like('bonus_key', `${command.activist_code}|%|${command.month_key}`);
  dbError(error);
  const keys = [];
  for (const row of data ?? []) {
    try {
      const parsed = parseBonusKey(row.bonus_key);
      if (parsed.activistCode === command.activist_code && parsed.monthKey === command.month_key) keys.push(row.bonus_key);
    } catch { /* Ignore malformed legacy markers instead of exposing them. */ }
  }
  return keys;
}

async function scopedDirectoryProfile(context, projectId, userId) {
  if (projectId == null) {
    if (context.globalRole !== 'ceo' || context.aal < 2) {
      throw new SecurityError(404, 'NOT_FOUND', 'Bonus scope was not found');
    }
    const { data, error } = await context.db.from('profiles')
      .select('id,activist_code').eq('id', userId).maybeSingle();
    dbError(error);
    return data;
  }
  const { data, error } = await context.db.rpc('app_project_directory', {
    p_project_id: Number(projectId),
  });
  dbError(error);
  const row = (data ?? []).find((entry) => entry.user_id === userId);
  return row ? { id: row.user_id, activist_code: row.activist_code } : null;
}

async function bonusSourceRows(context, command) {
  const target = await scopedDirectoryProfile(context, command.project_id, command.user_id);
  if (!target || target.activist_code == null) throw new SecurityError(404, 'NOT_FOUND', 'Bonus scope was not found');

  let contactQuery = context.db.from('contacts').select(BONUS_CONTACT_COLUMNS)
    .eq('assigned_user_id', command.user_id);
  if (command.project_id != null) contactQuery = contactQuery.eq('project_id', command.project_id);
  const { data: contacts, error: contactError } = await contactQuery;
  dbError(contactError);
  for (const contact of contacts ?? []) assertBonusCancellationAccess(context, contact);

  let interactionQuery = context.db.from('interactions').select(BONUS_INTERACTION_COLUMNS)
    .eq('actor_user_id', command.user_id);
  if (command.project_id != null) interactionQuery = interactionQuery.eq('project_id', command.project_id);
  const { data: interactions, error: interactionError } = await interactionQuery;
  dbError(interactionError);

  const { data: config, error: configError } = await context.db.from('payment_config')
    .select(BONUS_CONFIG_COLUMNS).eq('id', 1).maybeSingle();
  dbError(configError);
  if (!config) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Bonus data is unavailable');
  return { target, contacts: contacts ?? [], interactions: interactions ?? [], config };
}

export async function listBonusCandidates(context, input) {
  const command = bonusCandidateRequestCommand(context, input);
  const source = await bonusSourceRows(context, command);
  const preliminary = buildBonusCandidates({
    activistCode: source.target.activist_code,
    contacts: source.contacts,
    interactions: source.interactions,
    config: source.config,
    period: command.period,
  });
  if (preliminary.length === 0) return [];
  const { data: cancellations, error } = await context.db.from('bonus_cancellations')
    .select('bonus_key').in('bonus_key', preliminary.map((candidate) => candidate.key));
  dbError(error);
  const cancelledKeys = new Set((cancellations ?? []).map((row) => row.bonus_key));
  return buildBonusCandidates({
    activistCode: source.target.activist_code,
    contacts: source.contacts,
    interactions: source.interactions,
    config: source.config,
    cancelledKeys,
    period: command.period,
  });
}

export async function createBonusCancellation(context, input) {
  const parsedKey = parseBonusKey(input?.bonusKey);
  const { data: contact, error: contactError } = await context.db.from('contacts')
    .select(BONUS_CONTACT_COLUMNS).eq('id', parsedKey.contactId).maybeSingle();
  dbError(contactError);
  if (!contact || Number(contact.activist_id) !== parsedKey.activistCode) {
    throw new SecurityError(404, 'NOT_FOUND', 'Bonus was not found');
  }
  assertBonusCancellationAccess(context, contact);

  const { data: existing, error: existingError } = await context.db.from('bonus_cancellations')
    .select('id').eq('bonus_key', input.bonusKey).maybeSingle();
  dbError(existingError);
  if (existing) throw new SecurityError(409, 'BONUS_ALREADY_CANCELLED', 'Bonus is already cancelled');

  const candidates = await listBonusCandidates(context, {
    period: parsedKey.period,
    projectId: Number(contact.project_id),
    userId: contact.assigned_user_id,
  });
  const candidate = candidates.find((item) => item.key === input.bonusKey);
  if (!candidate) throw new SecurityError(404, 'NOT_FOUND', 'Bonus was not found');

  const { data, error } = await context.db.rpc('app_cancel_bonus', { p_bonus_key: input.bonusKey });
  if (error?.code === '23505') throw new SecurityError(409, 'BONUS_ALREADY_CANCELLED', 'Bonus is already cancelled');
  dbError(error);
  if (data !== true) throw new SecurityError(404, 'NOT_FOUND', 'Bonus was not found');
  return { cancelled: true, bonus: { key: input.bonusKey, type: candidate.type, amount: candidate.amount } };
}
