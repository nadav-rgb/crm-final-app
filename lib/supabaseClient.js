// lib/supabaseClient.js — browser Supabase client (publishable key)
import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: true, autoRefreshToken: true } }
    );
  }
  return client;
}
