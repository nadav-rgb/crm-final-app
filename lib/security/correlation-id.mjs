const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestIds = new WeakMap();

export function normalizeCorrelationId(value) {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : globalThis.crypto.randomUUID();
}

export function requestCorrelationId(req) {
  if (req && typeof req === 'object' && requestIds.has(req)) return requestIds.get(req);
  const supplied = req?.headers?.['x-request-id'];
  const correlationId = normalizeCorrelationId(
    Array.isArray(supplied) ? undefined : supplied,
  );
  if (req && typeof req === 'object') requestIds.set(req, correlationId);
  return correlationId;
}

export function isCorrelationId(value) {
  return typeof value === 'string' && UUID.test(value);
}
