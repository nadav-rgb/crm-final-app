import { mfaCodeSchema } from '../../../../lib/security/schemas.mjs';
import { clientKey, publicAuthResult, runAuthRoute, setSessionCookie } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: mfaCodeSchema, requireSession: true, requireCsrf: true,
    async handler({ req, input, session, runtime }) {
      const result = await runtime.service.verifyMfa(session, input, { ipKey: clientKey(req) });
      setSessionCookie(res, result.cookieValue, runtime.env);
      return publicAuthResult(result);
    },
  });
}
