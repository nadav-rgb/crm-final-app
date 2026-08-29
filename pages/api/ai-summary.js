import { secureHandler } from '../../lib/security/api-handler.mjs';
import { appendServerAudit, consumeServerRateLimit } from '../../lib/security/auth-service.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  assertAnthropicEnabled,
  projectAiPayload,
  redactExternalError,
} from '../../lib/security/external-data.mjs';
import { aiSummarySchema } from '../../lib/security/schemas.mjs';

const INTERACTION_COLUMNS = 'id,project_id,actor_user_id,type,quality,duration_minutes,outcome,description,notes';
const BASE_MEETING_COLUMNS = 'id,project_id,actor_user_id,structured_answers,answers,participant_count';

const SYSTEM_PROMPTS = Object.freeze({
  interaction: 'סכם דיווח קשר בעברית בארבע נקודות קצרות: תוכן, תוכן תורני, איכות הקשר ומשתתפים נוספים. אל תמציא מידע.',
  base_meeting: 'סכם דיווח מפגש בסיס בדיוק בשלושה משפטים קצרים בעברית: מהות המפגש, פרטים תפעוליים והערכת התקדמות הקשר. אל תמציא מידע.',
});

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

function canReadAiResource(context, row) {
  if (context.globalRole === 'ceo') return context.aal >= 2;
  if (row.actor_user_id === context.userId) return true;
  const membership = context.memberships?.find((entry) => (
    entry.status === 'active' && Number(entry.projectId) === Number(row.project_id)
  ));
  if (membership?.role === 'coord') return true;
  if (membership?.role === 'head') return context.aal >= 2;
  return false;
}

async function loadAuthorizedResource(context, input) {
  const table = input.resourceType === 'interaction' ? 'interactions' : 'base_meeting_reports';
  const columns = input.resourceType === 'interaction' ? INTERACTION_COLUMNS : BASE_MEETING_COLUMNS;
  const { data, error } = await context.db.from(table).select(columns).eq('id', input.resourceId).maybeSingle();
  dbError(error);
  if (!data || !canReadAiResource(context, data)) {
    throw new SecurityError(404, 'NOT_FOUND', 'AI summary resource was not found');
  }
  return { table, row: data };
}

async function callAnthropic(apiKey, payload) {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 450,
        system: SYSTEM_PROMPTS[payload.resourceType],
        messages: [{ role: 'user', content: payload.content }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('provider response rejected');
    const data = await response.json();
    const summary = data?.content?.[0]?.text;
    if (typeof summary !== 'string' || summary.trim().length < 1 || summary.length > 4_000) {
      throw new Error('provider response invalid');
    }
    return summary.trim();
  } catch {
    throw redactExternalError();
  }
}

export default secureHandler({
  method: 'POST',
  schema: aiSummarySchema,
  maxBytes: 1_024,
  resourceType: 'ai_summary',
  consumeRate: (context) => consumeServerRateLimit({
    kind: 'ai-summary', key: context.userId, limit: 10, windowSeconds: 3_600,
  }),
}, async (context, input) => {
  const { apiKey } = assertAnthropicEnabled(process.env);
  const resource = await loadAuthorizedResource(context, input);
  const payload = projectAiPayload(input.resourceType, resource.row);

  await appendServerAudit({
    actorUserId: context.userId,
    effectiveRole: context.globalRole ?? context.memberships?.[0]?.role ?? null,
    projectId: resource.row.project_id,
    action: 'external.ai_summary.authorized',
    resourceType: input.resourceType,
    resourceId: String(resource.row.id),
    result: 'success',
    reasonCode: 'CONSENT_AND_DPA_APPROVED',
    correlationId: context.requestId,
    sessionRef: context.session?.idHash?.slice(0, 16),
    metadata: { source: 'anthropic-consent' },
  });

  const summary = await callAnthropic(apiKey, payload);
  const { data, error } = await context.db.from(resource.table).update({ ai_summary: summary })
    .eq('id', resource.row.id).select('id').maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'AI summary resource was not found');
  return { summary };
});
