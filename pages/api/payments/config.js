import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { getPaymentConfig } from '../../../lib/security/domains/finance.mjs';

export default secureHandler({ method: 'GET', resourceType: 'payment_config' }, async (context) => ({
  config: await getPaymentConfig(context),
}));
