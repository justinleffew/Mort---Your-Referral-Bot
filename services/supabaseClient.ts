import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let hasWarnedMissingConfig = false;

export const getSupabaseConfig = () => {
  // Support Vercel/Supabase integration env vars to avoid falling back to local storage in production.
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.SUPABASE_ANON_KEY;
  return { supabaseUrl, supabaseAnonKey };
};

export const getSupabaseClient = () => {
  if (supabaseClient) return supabaseClient;
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!hasWarnedMissingConfig) {
      console.warn(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Supabase features.'
      );
      hasWarnedMissingConfig = true;
    }
    return null;
  }
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      headers: {
        apikey: supabaseAnonKey,
      },
    },
  });
  return supabaseClient;
};

export const isSupabaseConfigured = () => Boolean(getSupabaseClient());
