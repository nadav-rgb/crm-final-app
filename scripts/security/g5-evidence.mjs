import { RLS_PROTECTED_TABLES, SENSITIVE_TABLES } from './verify-rls-live.mjs';

const OBSERVATION_MARKER = 'G5_OBSERVATION ';
const OBSERVABLE_STATUS = new Set(['allowed', 'denied', 'pass', 'fail']);
const DIRECT_ACTIONS = Object.freeze(['select', 'insert', 'update', 'delete']);

const TEST_NAMES = Object.freeze({
  anonymous: 'anonymous isolation denies every classified public surface',
  anonymousMutation: 'direct PostgREST rejects anonymous PII mutation independently of the BFF',
  contacts: 'RLS denies cross-project and cross-activist contact CRUD',
  roles: 'RLS role projection is exact across CEO, Head, Coordinator, Finance and Activist',
  posture: 'service-only posture inventory proves forced RLS without exposing row data',
  tableMatrix: 'direct JWT matrix covers every classified object, direct action and role boundary',
  authority: 'direct JWT rejects old/new-authorized authority transfers and legacy UUID divergence',
  malformed: 'direct JWT rejects malformed tour report JSON and legacy notification routines',
  reminderTour: 'direct JWT cannot cross reminder or tour workflow boundaries',
  exactWorkflow: 'direct JWT permits only the exact reminder-recipient and assigned-tour paths',
  notification: 'direct JWT cannot forge notification event authority or tenant',
  finance: 'direct JWT finance filters only narrow scope and projection keys are exact',
  audit: 'unauthorized direct JWT cannot read the private audit store',
  postgres: 'live PostgreSQL assertions prove search-path and atomic-audit behavior',
  disabled: 'disabled-user JWT cannot read protected rows',
  assurance: 'AAL1 privileged roles are denied while AAL2 is exercised separately',
  bffSession: 'local BFF measures expiry, logout replay, rotation, privilege transition and disabled-user denial',
  bffAbuse: 'local BFF measures foreign-origin CSRF, token mismatch and shared login rate limit',
  totp: 'local GoTrue performs real TOTP enrollment, AAL2 rotation and factor reset',
});

const DIRECT_MATRIX_ROWS = [
  ['SEC-042', 'projects', 'project', 'denied', false],
  ['SEC-043', 'project_memberships', 'membership', 'denied', true],
  ['SEC-044', 'profiles', 'profile', 'denied', true],
  ['SEC-045', 'contacts', 'contact', 'denied', true],
  ['SEC-046', 'interactions', 'interaction', 'denied', true],
  ['SEC-047', 'base_meeting_reports', 'meeting-report', 'denied', true],
  ['SEC-048', 'meeting_houses', 'meeting-house', 'denied', true],
  ['SEC-049', 'meeting_reminders', 'meeting-reminder', 'denied', true],
  ['SEC-050', 'tours', 'tour', 'denied', true],
  ['SEC-051', 'expenses', 'expense', 'denied', true],
  ['SEC-052', 'bonus_cancellations', 'bonus-cancellation', 'denied', true],
  ['SEC-053', 'payment_config', 'payment-config', 'pass', false],
  ['SEC-054', 'notifications', 'notification', 'denied', true],
  ['SEC-055', 'notification_reads', 'notification-read', 'denied', true],
  ['SEC-056', 'push_subscriptions', 'push-subscription', 'denied', true],
  ['SEC-057', 'fcm_tokens', 'fcm-token', 'denied', true],
  ['SEC-058', 'feedback_reports', 'feedback-report', 'denied', true],
  ['SEC-059', 'activist_directory', 'directory', 'denied', false],
];

/**
 * One row per classified public object. The live test must exercise each named
 * direct-JWT operation and, where flagged, a CEO AAL2 old/new-authorized
 * transfer attempt. This manifest is metadata only: evidence is emitted only
 * after the individual runtime assertions have completed.
 */
export const G5_DIRECT_JWT_MATRIX = Object.freeze(DIRECT_MATRIX_ROWS.map(([
  caseId, table, resourceClass, expectedStatus, authorityTransfer,
]) => Object.freeze({
  caseId,
  table,
  resourceClass,
  actorClass: 'activist',
  expectedStatus,
  blockingLayer: table === 'payment_config' ? 'Grant' : 'RLS',
  actions: Object.freeze(RLS_PROTECTED_TABLES.includes(table) ? [...DIRECT_ACTIONS] : ['select']),
  authorityTransfer,
  testName: TEST_NAMES.tableMatrix,
})));

const BASE_CASES = [
  ['SEC-001', 'anonymous', 'contact', 'RLS', 'denied', TEST_NAMES.anonymous],
  ['SEC-004', 'activist', 'contact', 'RLS', 'denied', TEST_NAMES.contacts],
  ['SEC-008', 'activist', 'contact', 'PostgREST', 'denied', TEST_NAMES.contacts],
  ['SEC-009', 'activist', 'contact', 'RLS', 'denied', TEST_NAMES.contacts],
  ['SEC-010', 'activist', 'contact', 'RLS', 'denied', TEST_NAMES.contacts],
  ['SEC-011', 'coordinator', 'contact', 'RLS', 'pass', TEST_NAMES.roles],
  ['SEC-012', 'head-aal2', 'contact', 'RLS', 'pass', TEST_NAMES.roles],
  ['SEC-013', 'ceo-aal2', 'contact', 'MFA', 'pass', TEST_NAMES.roles],
  ['SEC-014', 'anonymous', 'contact', 'PostgREST', 'denied', TEST_NAMES.anonymousMutation],
  ['SEC-015', 'stale-session', 'session', 'Session', 'denied', TEST_NAMES.bffSession],
  ['SEC-016', 'activist', 'session', 'Session', 'denied', TEST_NAMES.bffSession],
  ['SEC-017', 'activist', 'session', 'Session', 'denied', TEST_NAMES.bffSession],
  ['SEC-021', 'anonymous', 'session', 'RateLimit', 'denied', TEST_NAMES.bffAbuse],
  ['SEC-023', 'system', 'security-posture', 'PostgreSQL', 'pass', TEST_NAMES.posture],
  ['SEC-025', 'finance', 'audit', 'Grant', 'denied', TEST_NAMES.audit],
  ['SEC-026', 'activist', 'session', 'CSRF', 'denied', TEST_NAMES.bffAbuse],
  ['SEC-027', 'head-aal1', 'finance-summary', 'MFA', 'denied', TEST_NAMES.assurance],
  ['SEC-028', 'activist', 'session', 'Session', 'denied', TEST_NAMES.bffSession],
  ['SEC-029', 'disabled-user', 'session', 'Session', 'denied', TEST_NAMES.bffSession],
  ['SEC-037', 'activist', 'meeting-reminder', 'RPC', 'denied', TEST_NAMES.reminderTour],
  ['SEC-038', 'activist', 'tour', 'RPC', 'denied', TEST_NAMES.reminderTour],
  ['SEC-039', 'coordinator', 'notification', 'RPC', 'denied', TEST_NAMES.notification],
  ['SEC-040', 'finance', 'finance-summary', 'RPC', 'pass', TEST_NAMES.finance],
  ['SEC-041', 'ceo-aal2', 'finance-summary', 'PostgreSQL', 'pass', TEST_NAMES.postgres],
  ['SEC-060', 'ceo-aal2', 'authority-transfer', 'PostgREST', 'denied', TEST_NAMES.authority],
  ['SEC-061', 'activist', 'tour', 'RPC', 'denied', TEST_NAMES.malformed],
  ['SEC-062', 'activist', 'notification', 'Grant', 'denied', TEST_NAMES.malformed],
  ['SEC-063', 'activist', 'tour', 'RPC', 'allowed', TEST_NAMES.exactWorkflow],
  ['SEC-064', 'disabled-user', 'contact', 'RLS', 'denied', TEST_NAMES.disabled],
  ['SEC-065', 'head-aal2', 'session', 'MFA', 'pass', TEST_NAMES.totp],
];

export const G5_CASE_MANIFEST = Object.freeze([
  ...BASE_CASES.map(([caseId, actorClass, resourceClass, blockingLayer, expectedStatus, testName]) => Object.freeze({
    caseId, actorClass, resourceClass, blockingLayer, expectedStatus, testName,
  })),
  ...G5_DIRECT_JWT_MATRIX.map((row) => Object.freeze({
    caseId: row.caseId,
    actorClass: row.actorClass,
    resourceClass: row.resourceClass,
    blockingLayer: row.blockingLayer,
    expectedStatus: row.expectedStatus,
    testName: row.testName,
  })),
]);

export const G5_REQUIRED_LIVE_TESTS = Object.freeze([...new Set(
  G5_CASE_MANIFEST.map((row) => row.testName),
)]);

const manifestByCaseId = new Map(G5_CASE_MANIFEST.map((row) => [row.caseId, row]));

function assertManifest() {
  if (G5_CASE_MANIFEST.length < 25 || manifestByCaseId.size !== G5_CASE_MANIFEST.length) {
    throw new Error('G5 evidence manifest must contain at least 25 exact unique case IDs');
  }
  const expectedTables = new Set(SENSITIVE_TABLES);
  if (G5_DIRECT_JWT_MATRIX.length !== expectedTables.size
    || new Set(G5_DIRECT_JWT_MATRIX.map((row) => row.table)).size !== expectedTables.size
    || G5_DIRECT_JWT_MATRIX.some((row) => !expectedTables.has(row.table))) {
    throw new Error('G5 direct-JWT matrix must cover every classified object exactly once');
  }
  for (const row of G5_DIRECT_JWT_MATRIX) {
    const expectedActions = RLS_PROTECTED_TABLES.includes(row.table) ? DIRECT_ACTIONS : ['select'];
    if (row.actions.length !== expectedActions.length
      || row.actions.some((action, index) => action !== expectedActions[index])) {
      throw new Error(`G5 direct-JWT matrix action coverage is incomplete for ${row.table}`);
    }
    if (!['projects', 'payment_config', 'activist_directory'].includes(row.table)
      && row.authorityTransfer !== true) {
      throw new Error(`G5 direct-JWT matrix lacks authority-transfer coverage for ${row.table}`);
    }
  }
  for (const row of G5_CASE_MANIFEST) {
    if (!/^SEC-\d{3}$/.test(row.caseId)
      || !OBSERVABLE_STATUS.has(row.expectedStatus)
      || typeof row.testName !== 'string' || row.testName.length < 10) {
      throw new Error('G5 evidence manifest contains an invalid case definition');
    }
  }
}

assertManifest();

function parseObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('G5 observation is invalid');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'actualStatus' || keys[1] !== 'caseId' || keys[2] !== 'testName'
    || typeof value.caseId !== 'string' || !OBSERVABLE_STATUS.has(value.actualStatus)
    || typeof value.testName !== 'string' || value.testName.length < 10 || value.testName.length > 200) {
    throw new Error('G5 observation is invalid');
  }
  return Object.freeze({
    caseId: value.caseId,
    actualStatus: value.actualStatus,
    testName: value.testName,
  });
}

/**
 * Emits a sanitized, test-bound observation only inside the exact isolated
 * runtime. Call this after the case's real assertion, never before it.
 */
export function observeG5Case(caseId, actualStatus, {
  env = process.env,
  emit = (line) => console.log(line),
  testName,
} = {}) {
  if (env?.SECURITY_TEST_CONFIRM_ISOLATED !== 'true') {
    throw new Error('G5 observation refused outside the confirmed isolated gate');
  }
  const definition = manifestByCaseId.get(caseId);
  if (!definition || !OBSERVABLE_STATUS.has(actualStatus)) {
    throw new Error('G5 observation refused unknown case or status');
  }
  if (testName !== definition.testName) {
    throw new Error('G5 observation refused mismatched live test binding');
  }
  const observation = parseObservation({
    caseId,
    actualStatus,
    testName,
  });
  emit(`${OBSERVATION_MARKER}${JSON.stringify(observation)}`);
  return observation;
}

export function parseG5ObservationsFromTap(tap) {
  if (typeof tap !== 'string') throw new Error('G5 TAP observation stream is invalid');
  const observations = [];
  for (const line of tap.split(/\r?\n/)) {
    const match = /^\s*#?\s*G5_OBSERVATION\s+(\{.*\})\s*$/.exec(line);
    if (!match) continue;
    let parsed;
    try { parsed = JSON.parse(match[1]); } catch { throw new Error('G5 TAP observation is invalid'); }
    observations.push(parseObservation(parsed));
  }
  return Object.freeze(observations);
}

export function buildMeasuredEvidenceRows({ observations, passedTests } = {}) {
  if (!Array.isArray(observations) || !(passedTests instanceof Set)) {
    throw new Error('G5 measured evidence requires observations and passed tests');
  }
  const observedByCase = new Map();
  for (const rawObservation of observations) {
    const observation = parseObservation(rawObservation);
    const definition = manifestByCaseId.get(observation.caseId);
    if (!definition) throw new Error(`G5 measured evidence contains unknown case ${observation.caseId}`);
    if (observedByCase.has(observation.caseId)) {
      throw new Error(`G5 measured evidence contains duplicate case ${observation.caseId}`);
    }
    if (observation.testName !== definition.testName) {
      throw new Error(`G5 measured evidence test binding mismatch for ${observation.caseId}`);
    }
    if (observation.actualStatus !== definition.expectedStatus) {
      throw new Error(`G5 measured evidence outcome mismatch for ${observation.caseId}`);
    }
    if (!passedTests.has(definition.testName)) {
      throw new Error(`G5 measured evidence test did not pass for ${observation.caseId}`);
    }
    observedByCase.set(observation.caseId, observation);
  }
  const missing = G5_CASE_MANIFEST.filter((definition) => !observedByCase.has(definition.caseId));
  if (missing.length) {
    throw new Error(`G5 measured evidence is incomplete: missing ${missing.map((row) => row.caseId).join(',')}`);
  }
  return Object.freeze(G5_CASE_MANIFEST.map((definition) => Object.freeze({
    caseId: definition.caseId,
    actorClass: definition.actorClass,
    resourceClass: definition.resourceClass,
    blockingLayer: definition.blockingLayer,
    expectedStatus: definition.expectedStatus,
    actualStatus: observedByCase.get(definition.caseId).actualStatus,
  })));
}
