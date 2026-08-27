import { passwordResetRequestSchema } from '../../../../lib/security/schemas.mjs';
import { clientKey, runAuthRoute } from '../_shared.mjs';

export default function handler(req, res) {
  return runAuthRoute(req, res, {
    method: 'POST', schema: passwordResetRequestSchema,
    async handler({ input, runtime }) {
      return runtime.service.requestPasswordReset({ ...input, ipKey: clientKey(req) });
    },
  });
}
