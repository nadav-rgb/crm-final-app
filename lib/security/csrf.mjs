import { constantTimeEqual, hashOpaque, randomOpaque } from './crypto.mjs';
import { SecurityError } from './errors.mjs';

function requestHeader(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function issueCsrf(session, env) {
  const token = randomOpaque(32);
  const csrfHash = hashOpaque(`csrf:${token}`, env.sessionIdPepper);
  session.csrfToken = token;
  session.csrfHash = csrfHash;
  return token;
}

export function verifyCsrf(req, session, env) {
  const supplied = requestHeader(req, 'x-csrf-token');
  let candidateHash;
  try {
    candidateHash = supplied ? hashOpaque(`csrf:${supplied}`, env.sessionIdPepper) : '';
  } catch {
    candidateHash = '';
  }
  if (!session?.csrfHash || !constantTimeEqual(candidateHash, session.csrfHash)) {
    throw new SecurityError(403, 'CSRF_DENIED', 'Request verification failed');
  }
  return true;
}
