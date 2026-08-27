import { SecurityError } from './errors.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApiClient({
  origin = typeof window === 'undefined' ? undefined : window.location.origin,
  getCsrfToken = () => undefined,
  fetchImpl = globalThis.fetch,
} = {}) {
  let base;
  try {
    base = new URL(origin);
    if (base.origin !== origin) throw new Error('origin must be exact');
  } catch (cause) {
    throw new SecurityError(500, 'CLIENT_CONFIG_INVALID', 'Client security configuration is invalid', { cause });
  }
  if (typeof fetchImpl !== 'function') {
    throw new SecurityError(500, 'CLIENT_CONFIG_INVALID', 'Client security configuration is invalid');
  }

  return async function apiFetch(path, { method = 'GET', body, headers = {}, signal, csrf = true } = {}) {
    let target;
    try {
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new Error('relative API path required');
      target = new URL(path, base);
      if (target.origin !== base.origin || !target.pathname.startsWith('/api/')) throw new Error('same-origin API path required');
    } catch (cause) {
      throw new SecurityError(400, 'CLIENT_ORIGIN_DENIED', 'Client request target is not permitted', { cause });
    }

    const normalizedMethod = String(method).toUpperCase();
    const requestHeaders = { Accept: 'application/json' };
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'authorization') {
        throw new SecurityError(400, 'CLIENT_AUTH_HEADER_DENIED', 'Browser authorization headers are not permitted');
      }
      requestHeaders[name] = value;
    }
    let encodedBody;
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      encodedBody = JSON.stringify(body);
    }
    if (!SAFE_METHODS.has(normalizedMethod) && csrf) {
      const csrfToken = getCsrfToken();
      if (typeof csrfToken !== 'string' || csrfToken.length < 16) {
        throw new SecurityError(403, 'CLIENT_CSRF_UNAVAILABLE', 'Request verification is unavailable');
      }
      requestHeaders['X-CSRF-Token'] = csrfToken;
    }

    let response;
    try {
      response = await fetchImpl(target.toString(), {
        method: normalizedMethod,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: requestHeaders,
        body: encodedBody,
        signal,
      });
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(503, 'NETWORK_UNAVAILABLE', 'The server could not be reached', { cause });
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    let payload = null;
    if (contentType.toLowerCase().includes('application/json')) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!response.ok) {
      throw new SecurityError(
        response.status,
        payload?.error?.code ?? 'REQUEST_FAILED',
        payload?.error?.message ?? 'The request could not be completed',
      );
    }
    return payload;
  };
}
