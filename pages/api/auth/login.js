import { loginSchema } from '../../../lib/security/schemas.mjs';
import { clientKey, publicAuthResult, runAuthRoute, setSessionCookie } from './_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: loginSchema,
    async handler({ input, runtime }) {
      const result = await runtime.service.login({ ...input, ipKey: clientKey(req) });
      setSessionCookie(res, result.cookieValue, runtime.env);
      return publicAuthResult(result);
    },
  });
}
