import { z } from 'zod';
import { SecurityError } from './errors.mjs';

const PUBLIC_SECRET_NAME = /^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE|PRIVATE|SESSION|PEPPER|CRON|ANTHROPIC|VAPID_PRIVATE)/i;

function exactOrigin(value, { allowLocalHttp }) {
  try {
    const parsed = new URL(value);
    const localHttp = allowLocalHttp
      && parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.origin !== value || (parsed.protocol !== 'https:' && !localHttp)) return false;
    return parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.string().max(2048).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).max(4096).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).max(4096).optional(),
  SESSION_ID_PEPPER: z.string().min(32).max(4096).optional(),
  SESSION_TOKEN_ENCRYPTION_KEY_V1: z.string().min(43).max(128).optional(),
  SESSION_TOKEN_KEY_VERSION: z.string().regex(/^1$/).optional(),
  SECURITY_BFF_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  PASSWORD_RESET_REDIRECT_URL: z.string().url().optional(),
}).passthrough();

export function getServerEnv(source = process.env) {
  try {
    for (const [name, value] of Object.entries(source)) {
      if (value && PUBLIC_SECRET_NAME.test(name)) {
        throw new Error(`server-only setting is exposed with a public prefix: ${name}`);
      }
    }

    const parsed = baseSchema.parse(source);
    const appOrigin = parsed.APP_ORIGIN
      ?? (parsed.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');
    if (!appOrigin || !exactOrigin(appOrigin, { allowLocalHttp: parsed.NODE_ENV !== 'production' })) {
      throw new Error('APP_ORIGIN must be an exact permitted origin');
    }

    if (parsed.NODE_ENV === 'production') {
      for (const value of [
        parsed.SUPABASE_URL,
        parsed.SUPABASE_PUBLISHABLE_KEY,
        parsed.SUPABASE_SERVICE_ROLE_KEY,
        parsed.SESSION_ID_PEPPER,
        parsed.SESSION_TOKEN_ENCRYPTION_KEY_V1,
        parsed.SESSION_TOKEN_KEY_VERSION,
      ]) {
        if (!value) throw new Error('required production server setting is missing');
      }
    }
    if (parsed.SUPABASE_URL && !exactOrigin(parsed.SUPABASE_URL, { allowLocalHttp: parsed.NODE_ENV !== 'production' })) {
      throw new Error('SUPABASE_URL must be an exact origin');
    }
    if (parsed.SESSION_TOKEN_ENCRYPTION_KEY_V1) {
      const decoded = Buffer.from(parsed.SESSION_TOKEN_ENCRYPTION_KEY_V1, 'base64url');
      if (decoded.length !== 32) throw new Error('session token key must decode to 32 bytes');
    }
    const passwordResetRedirectUrl = parsed.PASSWORD_RESET_REDIRECT_URL
      ?? `${appOrigin}/api/auth/password-reset/verify`;
    const resetUrl = new URL(passwordResetRedirectUrl);
    if (resetUrl.origin !== appOrigin || resetUrl.pathname !== '/api/auth/password-reset/verify') {
      throw new Error('password reset redirect must use the approved same-origin callback');
    }

    return Object.freeze({
      nodeEnv: parsed.NODE_ENV,
      appOrigin,
      supabaseUrl: parsed.SUPABASE_URL,
      supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
      supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
      sessionIdPepper: parsed.SESSION_ID_PEPPER,
      sessionTokenKeyVersion: Number(parsed.SESSION_TOKEN_KEY_VERSION ?? 1),
      sessionTokenKeys: Object.freeze({ 1: parsed.SESSION_TOKEN_ENCRYPTION_KEY_V1 }),
      securityBffAuthEnabled: parsed.SECURITY_BFF_AUTH_ENABLED === 'true',
      passwordResetRedirectUrl,
    });
  } catch (cause) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid', { cause });
  }
}
