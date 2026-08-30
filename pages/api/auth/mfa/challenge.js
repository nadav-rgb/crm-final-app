import { mfaChallengeSchema } from '../../../../lib/security/schemas.mjs';
import { clientKey, runAuthRoute } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: mfaChallengeSchema, requireSession: true, requireCsrf: true,
    async handler({ req, input, session, runtime }) {
      return runtime.service.challengeMfa(session, input.factorId, { ipKey: clientKey(req) });
    },
  });
}
