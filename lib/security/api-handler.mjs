import { randomUUID } from 'node:crypto';
import { assertSameOrigin, parseJson, sendJson } from './http.mjs';
import { mapError, SecurityError } from './errors.mjs';
import { resolveRequestContext } from './request-context.mjs';
import { verifyCsrf } from './csrf.mjs';
import { authorize } from './rbac.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUDITED_DENIALS = new Set(['CAPABILITY_DENIED', 'MFA_REQUIRED', 'CSRF_DENIED', 'RATE_LIMITED']);

function requestId(req) {
  const supplied = req.headers?.['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export function secureHandler(options, businessHandler) {
  if (typeof businessHandler !== 'function') throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  const expectedMethods = new Set(Array.isArray(options.method) ? options.method : [options.method]);
  const resolveContextFn = options.resolveContext ?? resolveRequestContext;
  const verifyCsrfFn = options.verifyCsrf ?? verifyCsrf;
  const parseBody = options.parseBody ?? parseJson;
  const authorizeFn = options.authorize ?? authorize;

  return async function securedRoute(req, res) {
    const correlationId = requestId(req);
    let context;
    try {
      if (!expectedMethods.has(req.method)) {
        res.setHeader('Allow', [...expectedMethods].join(', '));
        throw new SecurityError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed');
      }
      if (!SAFE_METHODS.has(req.method)) {
        (options.assertOrigin ?? assertSameOrigin)(req, { appOrigin: options.appOrigin });
      }
      context = await resolveContextFn(req, { minimumAal: options.minimumAal ?? 1 });
      if ((context?.aal ?? 0) < (options.minimumAal ?? 1)) {
        throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
      }
      if (!SAFE_METHODS.has(req.method)) {
        verifyCsrfFn(req, context.session, options.csrfEnv ?? options.env ?? {});
      }
      if (typeof options.consumeRate === 'function') {
        const rate = await options.consumeRate(context, req);
        if (!rate?.allowed) throw new SecurityError(429, 'RATE_LIMITED', 'Too many requests');
      }
      const input = options.schema ? await parseBody(req, options.schema, { maxBytes: options.maxBytes }) : undefined;
      if (options.capability) {
        const resource = typeof options.resource === 'function'
          ? await options.resource(context, input, req)
          : options.resource;
        if (!authorizeFn(context, options.capability, resource)) {
          throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
        }
      }
      const response = await businessHandler(context, input, req, res);
      if (response === undefined || res.writableEnded) return;
      return sendJson(res, response.status ?? 200, response.payload ?? response, { requestId: correlationId });
    } catch (caught) {
      let error = caught;
      if (AUDITED_DENIALS.has(error?.code) && typeof options.appendAudit === 'function') {
        try {
          await options.appendAudit({
            actorUserId: context?.userId ?? null,
            effectiveRole: context?.globalRole ?? context?.memberships?.[0]?.role ?? null,
            action: 'authorization.denied', resourceType: options.resourceType ?? 'request',
            result: 'denied', reasonCode: error.code, correlationId,
            sessionRef: context?.session?.idHash?.slice(0, 16), metadata: {},
          });
        } catch (auditError) {
          error = auditError;
        }
      }
      const mapped = mapError(error, correlationId);
      return sendJson(res, mapped.status, mapped.payload, { requestId: correlationId });
    }
  };
}
