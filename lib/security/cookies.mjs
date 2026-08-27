import { SecurityError } from './errors.mjs';

export const productionCookie = Object.freeze({
  name: '__Host-mekarvim_session',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  domain: undefined,
});

const developmentCookie = Object.freeze({ ...productionCookie, name: 'mekarvim_session', secure: false });

function cookieDefinition(production) {
  return production ? productionCookie : developmentCookie;
}

function validOpaqueId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,172}$/.test(value);
}

export function serializeSessionCookie(rawId, { production = process.env.NODE_ENV === 'production' } = {}) {
  if (!validOpaqueId(rawId)) {
    throw new SecurityError(500, 'SESSION_COOKIE_INVALID', 'Server session configuration is invalid');
  }
  const definition = cookieDefinition(production);
  const parts = [
    `${definition.name}=${rawId}`,
    `Path=${definition.path}`,
    'HttpOnly',
    `SameSite=${definition.sameSite}`,
  ];
  if (definition.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ production = process.env.NODE_ENV === 'production' } = {}) {
  const definition = cookieDefinition(production);
  const parts = [
    `${definition.name}=`,
    `Path=${definition.path}`,
    'HttpOnly',
    `SameSite=${definition.sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (definition.secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(req, { production = process.env.NODE_ENV === 'production' } = {}) {
  const name = cookieDefinition(production).name;
  let value = req?.cookies?.[name];
  if (!value && typeof req?.headers?.cookie === 'string') {
    for (const part of req.headers.cookie.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) value = rest.join('=');
    }
  }
  if (!validOpaqueId(value)) {
    throw new SecurityError(401, 'SESSION_INVALID', 'Session is invalid');
  }
  return value;
}
