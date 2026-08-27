import { z } from 'zod';
import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { listNotifications, markNotificationsRead } from '../../../lib/security/domains/notifications.mjs';

const schema = z.object({ ids: z.array(z.union([z.string().uuid(), z.number().int().positive()])).min(1).max(200) }).strict();

export default secureHandler({
  method: ['GET', 'POST'], schema, resourceType: 'notification',
  parseBody: (req, bodySchema, options) => req.method === 'POST' ? parseJson(req, bodySchema, options) : undefined,
}, async (context, input, req) => req.method === 'GET'
  ? { notifications: await listNotifications(context) }
  : markNotificationsRead(context, input.ids));
