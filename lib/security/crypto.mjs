import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { SecurityError } from './errors.mjs';

const TOKEN_FORMAT = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function asKey(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== 'string') return Buffer.alloc(0);
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return Buffer.alloc(0);
  }
}

function requireAesKey(value) {
  const key = asKey(value);
  if (key.length !== 32) {
    throw new SecurityError(500, 'TOKEN_KEY_INVALID', 'Server security configuration is invalid');
  }
  return key;
}

export function randomOpaque(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaque(value, pepper) {
  if (typeof value !== 'string' || value.length < 1 || typeof pepper !== 'string' || pepper.length < 32) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  return createHmac('sha256', pepper).update(value, 'utf8').digest('base64url');
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function sealToken(plaintext, keyValue, version) {
  if (typeof plaintext !== 'string' || plaintext.length < 1 || !Number.isSafeInteger(version) || version < 1) {
    throw new SecurityError(500, 'TOKEN_ENCRYPT_FAILED', 'Server token encryption failed');
  }
  try {
    const key = requireAesKey(keyValue);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`mekarvim-session-token:v${version}`, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v${version}.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
  } catch (cause) {
    if (cause instanceof SecurityError) throw cause;
    throw new SecurityError(500, 'TOKEN_ENCRYPT_FAILED', 'Server token encryption failed', { cause });
  }
}

export function openToken(sealed, keys) {
  const match = typeof sealed === 'string' ? sealed.match(TOKEN_FORMAT) : null;
  if (!match) {
    throw new SecurityError(401, 'TOKEN_DECRYPT_FAILED', 'Session is invalid');
  }
  const version = Number(match[1]);
  const keyValue = keys?.[version];
  if (!keyValue) {
    throw new SecurityError(401, 'TOKEN_KEY_UNAVAILABLE', 'Session is invalid');
  }
  try {
    const key = requireAesKey(keyValue);
    const iv = Buffer.from(match[2], 'base64url');
    const encrypted = Buffer.from(match[3], 'base64url');
    const tag = Buffer.from(match[4], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) throw new Error('invalid token envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`mekarvim-session-token:v${version}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (cause) {
    throw new SecurityError(401, 'TOKEN_DECRYPT_FAILED', 'Session is invalid', { cause });
  }
}
