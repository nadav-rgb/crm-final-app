import { mfaEnrollSchema } from '../../../../lib/security/schemas.mjs';
import { runAuthRoute } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: mfaEnrollSchema, requireSession: true, requireCsrf: true,
    async handler({ session, runtime }) {
      const enrollment = await runtime.service.enrollMfa(session);
      return { factorId: enrollment.factorId, qrCode: enrollment.qrCode };
    },
  });
}
