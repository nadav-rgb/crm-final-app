import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from './env.mjs';
import { SecurityError } from './errors.mjs';

export function createUserSupabase(accessToken, options = {}) {
  const env = options.supabaseUrl ? options : getServerEnv();
  const createClientImpl = options.createClientImpl ?? createClient;
  if (
    typeof accessToken !== 'string' || accessToken.length < 10 || accessToken.length > 8192
    || /[\r\n]/.test(accessToken)
    || typeof env.supabaseUrl !== 'string'
    || typeof env.supabasePublishableKey !== 'string'
  ) {
    throw new SecurityError(500, 'USER_DB_CONFIG_INVALID', 'User database access is unavailable');
  }
  return createClientImpl(env.supabaseUrl, env.supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
