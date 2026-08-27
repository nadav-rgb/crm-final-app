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

    return Object.freeze({
      nodeEnv: parsed.NODE_ENV,
      appOrigin,
      supabaseUrl: parsed.SUPABASE_URL,
      supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
      supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    });
  } catch (cause) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid', { cause });
  }
}
