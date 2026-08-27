import { createClient } from '@supabase/supabase-js';

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
  if (!target.hostname.endsWith('.supabase.co') && target.hostname !== 'localhost') {
    throw new Error('refused unknown test target');
  }
}

export async function verifyAnonymousIsolation({ targetUrl, publishableKey }) {
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tables = [
    'contacts',
    'interactions',
    'meeting_houses',
    'base_meeting_reports',
    'profiles',
    'push_subscriptions',
    'meeting_reminders',
    'audit_events',
  ];
  const results = [];

  for (const table of tables) {
    const { data, error } = await client.from(table).select('*').limit(1);
    const leaked = !error && Array.isArray(data) && data.length > 0;
    results.push({ table, blocked: Boolean(error) || data?.length === 0, leaked });
  }
  return results;
}

async function main() {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
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
