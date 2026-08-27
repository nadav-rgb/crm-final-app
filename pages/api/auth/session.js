import { publicAuthResult, rawSessionCookie, runAuthRoute, setSessionCookie } from './_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'GET',
    async handler({ runtime }) {
      const result = await runtime.service.resume(rawSessionCookie(req, runtime.env));
      setSessionCookie(res, result.cookieValue, runtime.env);
      return publicAuthResult(result);
    },
  });
}
