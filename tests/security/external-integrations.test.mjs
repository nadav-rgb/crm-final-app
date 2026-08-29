import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertAnthropicEnabled,
  assertPrivateGitHubTarget,
  getPrivateSheetsConfig,
  projectAiPayload,
  redactExternalError,
  requireCronAuth,
} from '../../lib/security/external-data.mjs';
import { fetchSheetTours } from '../../lib/toursSheet.js';

const hasCode = (code) => (error) => error?.code === code;

test('AI payload is an allowlisted projection with sensitive identifiers redacted and an 8000 character cap', () => {
  const payload = projectAiPayload('interaction', {
    id: '10000000-0000-4000-8000-000000000001',
    project_id: 101,
    actor_user_id: '00000000-0000-4000-8000-000000000001',
    type: 'פגישה',
    quality: 'טובה',
    notes: `כתובת: רחוב הדוגמה 7\nטלפון 050-123-4567\n${'א'.repeat(9_000)}`,
    phone: '050-999-9999',
    full_history: ['private'],
  });

  assert.deepEqual(Object.keys(payload).sort(), ['content', 'resourceType']);
  assert.equal(payload.resourceType, 'interaction');
  assert.ok(payload.content.length <= 8_000);
  assert.match(payload.content, /פגישה/);
  assert.doesNotMatch(JSON.stringify(payload), /10000000-0000|00000000-0000|050[- ]|רחוב הדוגמה|full_history|project_id|actor_user_id/);
});

test('Anthropic is disabled unless key, explicit enablement and data-processing approval are all present', () => {
  for (const source of [
    {},
    { ANTHROPIC_API_KEY: 'synthetic-key' },
    { ANTHROPIC_API_KEY: 'synthetic-key', ANTHROPIC_AI_ENABLED: 'true' },
  ]) assert.throws(() => assertAnthropicEnabled(source), hasCode('INTEGRATION_DISABLED'));

  assert.deepEqual(assertAnthropicEnabled({
    ANTHROPIC_API_KEY: 'synthetic-key',
    ANTHROPIC_AI_ENABLED: 'true',
    ANTHROPIC_DATA_PROCESSING_APPROVED: 'true',
  }), { apiKey: 'synthetic-key' });
});

test('external errors are reduced to a stable response without upstream text', () => {
  const error = redactExternalError(new Error('provider token invalid: synthetic-secret'));
  assert.equal(error.code, 'EXTERNAL_SERVICE_UNAVAILABLE');
  assert.equal(error.status, 502);
  assert.doesNotMatch(`${error.message} ${error.cause ?? ''}`, /token invalid|synthetic-secret/);
});

test('cron authentication fails closed and accepts only the exact bearer secret', () => {
  const secret = 'synthetic-cron-secret-with-sufficient-length';
  assert.doesNotThrow(() => requireCronAuth({ headers: { authorization: `Bearer ${secret}` } }, secret));
  assert.throws(
    () => requireCronAuth({ headers: { authorization: 'Bearer wrong' } }, secret),
    hasCode('CRON_AUTH_DENIED'),
  );
  assert.throws(
    () => requireCronAuth({ headers: {} }, ''),
    hasCode('INTEGRATION_DISABLED'),
  );
});

test('Google Sheets requires a dedicated service account and exact spreadsheet/range allowlist', () => {
  assert.throws(() => getPrivateSheetsConfig({
    TOURS_SHEET_ID: 'sheet-allowed',
    TOURS_SHEET_RANGE: 'Tours!A:H',
  }), hasCode('INTEGRATION_DISABLED'));

  assert.throws(() => getPrivateSheetsConfig({
    TOURS_SHEET_ID: 'sheet-allowed',
    TOURS_SHEET_RANGE: 'Tours!A:H',
    FCM_SERVICE_ACCOUNT: '{"client_email":"wrong-purpose"}',
  }), hasCode('INTEGRATION_DISABLED'));

  const config = getPrivateSheetsConfig({
    TOURS_SHEET_ID: 'sheet-allowed',
    TOURS_SHEET_RANGE: 'Tours!A:H',
    SHEETS_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sheet@example.invalid', private_key: 'synthetic' }),
  });
  assert.equal(config.sheetId, 'sheet-allowed');
  assert.equal(config.range, 'Tours!A:H');
  assert.equal(config.serviceAccount.client_email, 'sheet@example.invalid');
});

test('sheet reads use authenticated Sheets API values endpoint and the exact configured range', async () => {
  const calls = [];
  const result = await fetchSheetTours({
    sheetId: 'sheet-allowed',
    range: 'Tours!A:H',
    token: 'synthetic-access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ values: [
          ['מספר סיור', 'תאריך', 'שעה', 'מיקום', 'מדריך', 'משפחה מארחת', 'סטטוס', 'הערות'],
          ['17', '29/08/2026', '10:00', 'מקום', 'מדריך', 'מארח', 'מתוכנן', ''],
        ] }),
      };
    },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/sheet-allowed\/values\/Tours!A%3AH$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-access-token');
  assert.doesNotMatch(calls[0].url, /docs\.google\.com|export\?format=csv/);
});

test('GitHub feedback forwarding remains disabled and rejects a public target contract', () => {
  assert.throws(() => assertPrivateGitHubTarget({}), hasCode('INTEGRATION_DISABLED'));
  assert.throws(() => assertPrivateGitHubTarget({
    FEEDBACK_GITHUB_ENABLED: 'true',
    GITHUB_REPO_VISIBILITY: 'public',
    GITHUB_REPOSITORY: 'org/repo',
    GITHUB_TOKEN: 'synthetic',
  }), hasCode('INTEGRATION_DISABLED'));
});

test('all sensitive cron routes delegate machine authentication to the shared guard', async () => {
  for (const file of [
    '../../pages/api/cron/send-reminders.js',
    '../../pages/api/cron/next-action-reminders.js',
    '../../pages/api/cron/tours-sheet-sync.js',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /requireCronAuth/);
    assert.doesNotMatch(source, /authorization\s*!==\s*`Bearer\s+\$\{process\.env\.CRON_SECRET\}`/);
  }
});

test('AI browser contract sends a resource reference only and active route uses the hardened boundary', async () => {
  const route = await readFile(new URL('../../pages/api/ai-summary.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../../lib/aiService.js', import.meta.url), 'utf8');
  assert.match(route, /secureHandler/);
  assert.match(route, /projectAiPayload/);
  assert.match(route, /appendServerAudit/);
  assert.doesNotMatch(route, /req\.body|error\.message|console\.error\([^)]*data/);
  assert.doesNotMatch(client, /authHeader|\{\s*text,\s*type,\s*meta/);
  assert.match(client, /resourceType[\s\S]*resourceId/);
});

test('feedback forwarding endpoint performs no reads, token handling or network calls', async () => {
  const source = await readFile(new URL('../../pages/api/cron/feedback-to-issues.js', import.meta.url), 'utf8');
  assert.match(source, /FEATURE_DISABLED/);
  assert.doesNotMatch(source, /getSupabaseAdmin|api\.github\.com|GITHUB_TOKEN|feedback_reports|fetch\(/);
});
