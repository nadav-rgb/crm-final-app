import { mfaChallengeSchema } from '../../../../lib/security/schemas.mjs';
import { runAuthRoute } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: mfaChallengeSchema, requireSession: true, requireCsrf: true,
    async handler({ input, session, runtime }) {
      return runtime.service.challengeMfa(session, input.factorId);
    },
  });
}
