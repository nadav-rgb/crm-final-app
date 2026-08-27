import { clearAuthCookie, runAuthRoute } from './_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', requireSession: true, requireCsrf: true,
    async handler({ session, runtime }) {
      await runtime.service.logout(session);
      clearAuthCookie(res, runtime.env);
      return { ok: true };
    },
  });
}
