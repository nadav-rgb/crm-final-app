// scripts/probe-rls.mjs — קורא טבלאות עם anon key ללא התחברות. כל שורה שחוזרת = דליפת RLS.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const tables = ['contacts', 'interactions', 'meeting_houses', 'base_meeting_reports', 'profiles', 'push_subscriptions', 'meeting_reminders', 'activist_directory'];
let leak = false;
console.log('=== ANONYMOUS read probe (no login) — any returned row = LEAK ===');
for (const t of tables) {
  const { data, error } = await sb.from(t).select('*').limit(3);
  if (error) console.log(`${t.padEnd(22)} blocked/err: ${error.code || ''} ${error.message}`);
  else { if (data.length) leak = true; console.log(`${t.padEnd(22)} returned ${data.length} ${data.length ? '<-- LEAK' : '(ok)'}`); }
}
process.exit(leak ? 1 : 0);
