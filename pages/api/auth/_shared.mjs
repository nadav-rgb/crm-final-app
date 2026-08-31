import { assertSameOrigin, parseJson, sendJson } from '../../../lib/security/http.mjs';
import { mapError, SecurityError } from '../../../lib/security/errors.mjs';
import { getDefaultAuthRuntime, loadAuthSession } from '../../../lib/security/auth-service.mjs';
import { verifyCsrf } from '../../../lib/security/csrf.mjs';
import { clearSessionCookie, readSessionCookie, serializeSessionCookie } from '../../../lib/security/cookies.mjs';
import { requestCorrelationId } from '../../../lib/security/correlation-id.mjs';
import { isIP } from 'node:net';

export function requestId(req) {
  return requestCorrelationId(req);
}

function canonicalIpv4Prefix(value) {
  const octets = value.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return null;
  const numbers = octets.map(Number);
  if (numbers.some((octet) => octet > 255)) return null;
  return `ip4:${numbers[0]}.${numbers[1]}.${numbers[2]}.0/24`;
}

function canonicalIpv6Prefix(value) {
  let address = value.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return canonicalIpv4Prefix(mapped[1]);
  if (isIP(address) !== 6 || address.includes('%')) return null;

  if (address.includes('.')) {
    const separator = address.lastIndexOf(':');
    const ipv4 = canonicalIpv4Prefix(address.slice(separator + 1));
    if (!ipv4) return null;
    const octets = address.slice(separator + 1).split('.').map(Number);
    address = `${address.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)
    || [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right].map((part) => part.padStart(4, '0'));
  return `ip6:${groups.slice(0, 3).join(':')}:${groups[3].slice(0, 2)}00::/56`;
}

function canonicalIpPrefix(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return null;
  const candidate = value.trim();
  if (!candidate || candidate.includes(',') || candidate.includes('\n') || candidate.includes('\r')) return null;
  return canonicalIpv4Prefix(candidate) ?? canonicalIpv6Prefix(candidate);
}

function singleHeader(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? null : value;
}

export function clientKey(req, { isVercel = process.env.VERCEL === '1' } = {}) {
  // Vercel documents this header as the stable client address when a proxy can
  // rewrite x-forwarded-for. Never accept either forwarded header off-platform.
  const platformAddress = isVercel
    ? canonicalIpPrefix(singleHeader(req.headers, 'x-vercel-forwarded-for'))
    : null;
  const socketAddress = canonicalIpPrefix(req.socket?.remoteAddress);
  return platformAddress ?? socketAddress ?? 'ip:unknown';
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
