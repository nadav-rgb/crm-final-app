import { mapError, SecurityError } from '../../../../lib/security/errors.mjs';
import { sendJson } from '../../../../lib/security/http.mjs';
import { getDefaultAuthRuntime } from '../../../../lib/security/auth-service.mjs';
import { requestId, setSessionCookie } from '../_shared.mjs';

export default async function handler(req, res) {
  const correlationId = requestId(req);
  try {
    if (req.method !== 'GET') throw new SecurityError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed');
    const tokenHash = typeof req.query?.token_hash === 'string' ? req.query.token_hash : '';
    if (!/^[A-Za-z0-9_-]{32,4096}$/.test(tokenHash)) {
      throw new SecurityError(400, 'RECOVERY_INVALID', 'Recovery link is invalid');
    }
    const runtime = getDefaultAuthRuntime();
    const session = await runtime.service.authorizeRecoverySession(tokenHash, 'password:complete');
    setSessionCookie(res, session.id, runtime.env);
    res.statusCode = 303;
    res.setHeader('Location', '/reset-password');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end();
  } catch (error) {
    const mapped = mapError(error, correlationId);
    return sendJson(res, mapped.status, mapped.payload, { requestId: correlationId });
  }
}
