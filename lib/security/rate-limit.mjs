import { hashOpaque } from './crypto.mjs';
import { SecurityError } from './errors.mjs';

export async function consumeRateLimit(key, limit, windowSeconds, { store, pepper }) {
  if (
    typeof key !== 'string' || key.length < 1 || key.length > 1024
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000
    || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400
    || typeof store?.consumeRateLimit !== 'function'
  ) {
    throw new SecurityError(500, 'RATE_LIMIT_CONFIG_INVALID', 'Server security configuration is invalid');
  }
  const bucketHash = hashOpaque(`rate:${key}`, pepper);
  try {
    const result = await store.consumeRateLimit(bucketHash, limit, windowSeconds);
    if (!result || typeof result.allowed !== 'boolean') throw new Error('invalid rate limit result');
    return {
      allowed: result.allowed,
      count: Number(result.count),
      retryAfterSeconds: Number(result.retryAfterSeconds ?? 0),
    };
  } catch (cause) {
    if (cause instanceof SecurityError) throw cause;
    throw new SecurityError(503, 'RATE_LIMIT_UNAVAILABLE', 'Request cannot be processed safely', { cause });
  }
}
