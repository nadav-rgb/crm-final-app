import { randomUUID } from 'node:crypto';
import { assertSameOrigin, parseJson, sendJson } from '../../../lib/security/http.mjs';
import { mapError, SecurityError } from '../../../lib/security/errors.mjs';
import { getDefaultAuthRuntime, loadAuthSession } from '../../../lib/security/auth-service.mjs';
import { verifyCsrf } from '../../../lib/security/csrf.mjs';
import { clearSessionCookie, readSessionCookie, serializeSessionCookie } from '../../../lib/security/cookies.mjs';

export function requestId(req) {
  const supplied = req.headers?.['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

export function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const value = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? 'unknown';
  return value.slice(0, 128);
}

export function setSessionCookie(res, rawId, env) {
  res.setHeader('Set-Cookie', serializeSessionCookie(rawId, { production: env.nodeEnv === 'production' }));
}

export function clearAuthCookie(res, env) {
  res.setHeader('Set-Cookie', clearSessionCookie({ production: env.nodeEnv === 'production' }));
}

export function rawSessionCookie(req, env) {
  return readSessionCookie(req, { production: env.nodeEnv === 'production' });
}

export function publicAuthResult(result) {
  const { cookieValue, ...payload } = result;
  return payload;
}

export async function runAuthRoute(req, res, {
  method,
  schema,
  requireSession = false,
  requireCsrf = false,
  handler,
}) {
  const correlationId = requestId(req);
  try {
    if (req.method !== method) {
      res.setHeader('Allow', method);
      throw new SecurityError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) assertSameOrigin(req);
    const runtime = getDefaultAuthRuntime();
    const session = requireSession ? await loadAuthSession(req) : null;
    if (requireCsrf) verifyCsrf(req, session, { sessionIdPepper: runtime.env.sessionIdPepper });
    const input = schema ? await parseJson(req, schema) : undefined;
    const response = await handler({ req, res, input, session, runtime, correlationId });
    if (response === undefined || res.writableEnded) return;
    return sendJson(res, response.status ?? 200, response.payload ?? response, { requestId: correlationId });
  } catch (error) {
    const mapped = mapError(error, correlationId);
    return sendJson(res, mapped.status, mapped.payload, { requestId: correlationId });
  }
}
