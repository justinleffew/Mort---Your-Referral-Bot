import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = () => {
  if (supabaseClient) return supabaseClient;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://comvwdgnerueecrsjxsw.supabase.co';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_X1I1LOGsqpKj9gcY-qYQ8A_jW-2z8OZ';
  if (!supabaseUrl || !supabaseAnonKey) return null;
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
};

export const isSupabaseConfigured = () => Boolean(getSupabaseClient());
