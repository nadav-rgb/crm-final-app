import { timingSafeEqual } from 'node:crypto';
import { SecurityError } from './errors.mjs';

const AI_MAX_CHARS = 8_000;
const SECRET_MIN_LENGTH = 32;

function stableDisabled(message = 'External integration is not enabled') {
  return new SecurityError(503, 'INTEGRATION_DISABLED', message);
}

function cleanExternalText(value) {
  return String(value ?? '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted]')
    .replace(/(?:\+?\d[\d -]{6,}\d)/gu, '[redacted]')
    .replace(/(?:כתובת|address)\s*[:=-]?[^\r\n]*/giu, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, '[redacted]')
    .trim();
}

function boundedJson(value) {
  return cleanExternalText(JSON.stringify(value)).slice(0, AI_MAX_CHARS);
}

export function projectAiPayload(resourceType, resource) {
  if (!resource || typeof resource !== 'object') {
    throw new SecurityError(400, 'AI_RESOURCE_INVALID', 'AI summary resource is invalid');
  }

  if (resourceType === 'interaction') {
    return {
      resourceType,
      content: boundedJson({
        type: resource.type ?? '',
        quality: resource.quality ?? '',
        durationMinutes: resource.duration_minutes ?? null,
        outcome: resource.outcome ?? '',
        report: resource.description ?? resource.notes ?? '',
      }),
    };
  }

  if (resourceType === 'base_meeting') {
    const structured = resource.structured_answers && typeof resource.structured_answers === 'object'
      ? resource.structured_answers
      : null;
    return {
      resourceType,
      content: boundedJson({
        report: structured ?? resource.answers ?? '',
        participantCount: resource.participant_count ?? null,
      }),
    };
  }

  throw new SecurityError(400, 'AI_RESOURCE_INVALID', 'AI summary resource is invalid');
}

export function assertAnthropicEnabled(source = process.env) {
  const key = source.ANTHROPIC_API_KEY;
  if (
    source.ANTHROPIC_AI_ENABLED !== 'true'
    || source.ANTHROPIC_DATA_PROCESSING_APPROVED !== 'true'
    || typeof key !== 'string'
    || key.trim().length < 1
  ) throw stableDisabled('AI summaries are not enabled');
  return { apiKey: key };
}

export function redactExternalError() {
  return new SecurityError(502, 'EXTERNAL_SERVICE_UNAVAILABLE', 'External service is unavailable');
}

function header(req, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(req?.headers ?? {})) {
    if (key.toLowerCase() === expected) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function requireCronAuth(req, configuredSecret = process.env.CRON_SECRET) {
  if (typeof configuredSecret !== 'string' || configuredSecret.length < SECRET_MIN_LENGTH) {
    throw stableDisabled('Cron authentication is not enabled');
  }
  const supplied = String(header(req, 'authorization') ?? '');
  const expected = `Bearer ${configuredSecret}`;
  const suppliedDigest = Buffer.from(supplied);
  const expectedDigest = Buffer.from(expected);
  const sameLength = suppliedDigest.length === expectedDigest.length;
  const padded = Buffer.alloc(expectedDigest.length);
  suppliedDigest.copy(padded, 0, 0, expectedDigest.length);
  if (!timingSafeEqual(padded, expectedDigest) || !sameLength) {
    throw new SecurityError(401, 'CRON_AUTH_DENIED', 'Machine authentication is invalid');
  }
}

function parseServiceAccount(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      !value || typeof value !== 'object'
      || typeof value.client_email !== 'string' || !value.client_email.includes('@')
      || typeof value.private_key !== 'string' || value.private_key.length < 1
    ) return null;
    return { client_email: value.client_email, private_key: value.private_key };
  } catch {
    return null;
  }
}

export function getPrivateSheetsConfig(source = process.env) {
  const sheetId = source.TOURS_SHEET_ID;
  const range = source.TOURS_SHEET_RANGE;
  const serviceAccount = parseServiceAccount(source.SHEETS_SERVICE_ACCOUNT);
  if (
    typeof sheetId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(sheetId)
    || typeof range !== 'string' || !/^[^!\r\n]{1,100}![A-Z]{1,3}:[A-Z]{1,3}$/.test(range)
    || !serviceAccount
  ) throw stableDisabled('Private Google Sheets synchronization is not enabled');
  return Object.freeze({ sheetId, range, serviceAccount: Object.freeze(serviceAccount) });
}

export function assertPrivateGitHubTarget(source = process.env) {
  if (source.FEEDBACK_GITHUB_ENABLED !== 'true') {
    throw stableDisabled('Feedback forwarding is not enabled');
  }
  if (
    source.GITHUB_REPO_VISIBILITY !== 'private'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(source.GITHUB_REPOSITORY ?? ''))
    || typeof source.GITHUB_TOKEN !== 'string' || source.GITHUB_TOKEN.length < 1
  ) throw stableDisabled('Private feedback forwarding is not enabled');
  return { repository: source.GITHUB_REPOSITORY, token: source.GITHUB_TOKEN };
}
