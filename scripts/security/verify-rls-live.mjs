import { createClient } from '@supabase/supabase-js';

export const SENSITIVE_TABLES = Object.freeze([
  'projects',
  'project_memberships',
  'profiles',
  'contacts',
  'interactions',
  'base_meeting_reports',
  'meeting_houses',
  'meeting_reminders',
  'tours',
  'expenses',
  'bonus_cancellations',
  'payment_config',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'fcm_tokens',
  'feedback_reports',
  'activist_directory',
]);

export function assertSafeTestTarget({ targetUrl, productionUrl, confirmed }) {
  if (confirmed !== true) {
    throw new Error('isolated test target confirmation required');
  }
  if (!targetUrl || !productionUrl) {
    throw new Error('test and production target URLs are required');
  }

  const target = new URL(targetUrl);
  const production = new URL(productionUrl);
  if (target.origin === production.origin) {
    throw new Error('refused production target');
  }
  if (target.username || target.password) {
    throw new Error('refused target URL credentials');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('refused non-HTTP test target');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('refused non-loopback test target');
  }

  return Object.freeze({ origin: target.origin, hostname: target.hostname });
}

export async function verifyAnonymousIsolation({ targetUrl, publishableKey }) {
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const results = [];

  for (const table of SENSITIVE_TABLES) {
    const { data, error } = await client.from(table).select('*').limit(1);
    const leaked = !error && Array.isArray(data) && data.length > 0;
    results.push({ table, blocked: Boolean(error) || data?.length === 0, leaked });
  }
  return results;
}

async function main() {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  assertSafeTestTarget({
    targetUrl,
    productionUrl,
    confirmed: process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true',
  });

  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error('missing test publishable key');
  const results = await verifyAnonymousIsolation({ targetUrl, publishableKey });
  for (const result of results) {
    process.stdout.write(`${result.table}: ${result.blocked ? 'blocked' : 'LEAK'}\n`);
  }
  if (results.some((result) => result.leaked)) process.exitCode = 1;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  await main();
}
