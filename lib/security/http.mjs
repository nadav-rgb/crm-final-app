import { ZodError } from 'zod';
import { getServerEnv } from './env.mjs';
import { SecurityError } from './errors.mjs';
import { normalizeCorrelationId } from './correlation-id.mjs';

export const DEFAULT_MAX_JSON_BYTES = 65_536;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(req, name) {
  if (typeof req.get === 'function') return req.get(name);
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() === expected) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

async function readBody(req, maxBytes) {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
    try {
      return Buffer.from(JSON.stringify(req.body), 'utf8');
    } catch (cause) {
      throw new SecurityError(400, 'INVALID_JSON', 'Request body is not valid JSON', { cause });
    }
  }

  if (!req?.[Symbol.asyncIterator]) {
    throw new SecurityError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new SecurityError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

export async function parseJson(req, schema, { maxBytes = DEFAULT_MAX_JSON_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_JSON_BYTES) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }

  const contentType = String(header(req, 'content-type') ?? '').toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new SecurityError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  const body = await readBody(req, maxBytes);
  if (body.length > maxBytes) {
    throw new SecurityError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch (cause) {
    throw new SecurityError(400, 'INVALID_JSON', 'Request body is not valid JSON', { cause });
  }

  try {
    return schema.parse(value);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new SecurityError(400, 'VALIDATION_FAILED', 'Request validation failed', { cause });
    }
    throw cause;
  }
}

export function assertSameOrigin(req, { appOrigin } = {}) {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  const expected = appOrigin ?? getServerEnv().appOrigin;
  const supplied = header(req, 'origin');
  let normalized;
  try {
    normalized = supplied ? new URL(supplied).origin : undefined;
  } catch {
    normalized = undefined;
  }
  if (!supplied || normalized !== supplied || normalized !== expected) {
    throw new SecurityError(403, 'ORIGIN_DENIED', 'Request origin is not permitted');
  }
}

export function sendJson(res, status, payload, { requestId } = {}) {
  const correlationId = normalizeCorrelationId(requestId ?? payload?.requestId);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Request-Id', correlationId);
  return res.status(status).json(payload);
}
