import { SecurityError } from './errors.mjs';
import { isCorrelationId } from './correlation-id.mjs';

const AUDIT_METADATA_KEYS = new Set(['changedFields', 'targetRole', 'source', 'exportFormat']);

export function sanitizeAuditMetadata(input = {}) {
  const output = {};
  if (Array.isArray(input.changedFields)) {
    output.changedFields = input.changedFields
      .filter((value) => typeof value === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(value))
      .slice(0, 100);
  }
  if (typeof input.targetRole === 'string' && ['ceo', 'head', 'coord', 'finance', 'activist'].includes(input.targetRole)) {
    output.targetRole = input.targetRole;
  }
  if (typeof input.source === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(input.source)) output.source = input.source;
  if (typeof input.exportFormat === 'string' && ['csv', 'xlsx', 'pdf'].includes(input.exportFormat)) output.exportFormat = input.exportFormat;
  return Object.fromEntries(Object.entries(output).filter(([key]) => AUDIT_METADATA_KEYS.has(key)));
}

export async function appendAudit(event, { rpc } = {}) {
  if (
    typeof rpc !== 'function'
    || typeof event?.action !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(event.action)
    || typeof event?.resourceType !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(event.resourceType)
    || !['success', 'denied', 'failed'].includes(event?.result)
    || (event?.correlationId != null && !isCorrelationId(event.correlationId))
  ) {
    throw new SecurityError(500, 'AUDIT_INVALID', 'Security audit could not be recorded');
  }
  const params = {
    p_actor_user_id: event.actorUserId ?? null,
    p_effective_role: event.effectiveRole ?? null,
    p_project_id: event.projectId ?? null,
    p_action: event.action,
    p_resource_type: event.resourceType,
    p_resource_id: event.resourceId ?? null,
    p_result: event.result,
    p_reason_code: event.reasonCode ?? null,
    p_correlation_id: event.correlationId ?? null,
    p_session_ref: event.sessionRef ?? null,
    p_metadata: sanitizeAuditMetadata(event.metadata),
  };
  try {
    return await rpc('app_audit_append', params);
  } catch (cause) {
    throw new SecurityError(503, 'AUDIT_UNAVAILABLE', 'Security audit could not be recorded', { cause });
  }
}
