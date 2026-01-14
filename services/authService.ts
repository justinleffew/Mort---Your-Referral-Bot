import { getSupabaseClient } from './supabaseClient';

export const authService = {
  signUp: async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase.auth.signUp({ email, password });
  },
  signInWithPassword: async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase.auth.signInWithPassword({ email, password });
  },
  signOut: async () => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase.auth.signOut();
  },
  getSession: async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Failed to load Supabase session', error);
      return null;
    }
    return data.session;
  },
};
