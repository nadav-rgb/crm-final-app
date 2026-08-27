import { passwordResetCompleteSchema } from '../../../../lib/security/schemas.mjs';
import { clearAuthCookie, runAuthRoute } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: passwordResetCompleteSchema, requireSession: true, requireCsrf: true,
    async handler({ input, session, runtime }) {
      const result = await runtime.service.completePasswordReset(session, input.password);
      clearAuthCookie(res, runtime.env);
      return result;
    },
  });
}
