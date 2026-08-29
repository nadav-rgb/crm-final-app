import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { parseJson } from '../../../lib/security/http.mjs';
import {
  createBaseReport,
  listBaseReports,
  updateBaseReport,
} from '../../../lib/security/domains/base-reports.mjs';

const objectBody = z.record(z.string(), z.unknown());

export default secureHandler({
  method: ['GET', 'POST', 'PATCH'],
  schema: objectBody,
  maxBytes: 16_384,
  parseBody: (req, schema, options) => req.method === 'GET' ? undefined : parseJson(req, schema, options),
  resourceType: 'base_meeting_report',
}, async (context, input, req) => {
  if (req.method === 'GET') return { reports: await listBaseReports(context) };
  if (req.method === 'POST') return { report: await createBaseReport(context, input) };
  const { id, ...changes } = input ?? {};
  return { report: await updateBaseReport(context, id, changes) };
});
