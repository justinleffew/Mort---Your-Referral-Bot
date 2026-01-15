import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let hasWarnedMissingConfig = false;

export const getSupabaseClient = () => {
  if (supabaseClient) return supabaseClient;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!hasWarnedMissingConfig) {
      console.warn(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Supabase features.'
      );
      hasWarnedMissingConfig = true;
    }
    return null;
  }
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
};

export const isSupabaseConfigured = () => Boolean(getSupabaseClient());
