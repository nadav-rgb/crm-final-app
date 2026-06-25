// lib/apiAuth.js — מחזיר Authorization header עם ה-JWT של המשתמש המחובר.
// משמש את כל קריאות ה-fetch ל-API routes שדורשים אימות.
import { getSupabaseClient } from './supabaseClient';

export async function authHeader() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
