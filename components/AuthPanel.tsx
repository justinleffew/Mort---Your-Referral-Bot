import React, { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AuthPanelProps {
  supabase: SupabaseClient | null;
}

const AuthPanel: React.FC<AuthPanelProps> = ({ supabase }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const configuredRedirect = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();

  const getEmailRedirectTo = () => {
    if (!configuredRedirect) {
      return `${window.location.origin}/#/auth/callback`;
    }

    try {
      const redirectUrl = new URL(configuredRedirect);
      if (redirectUrl.hash || redirectUrl.pathname !== '/') {
        return configuredRedirect;
      }
      redirectUrl.hash = '#/auth/callback';
      return redirectUrl.toString();
    } catch {
      return `${configuredRedirect.replace(/\/+$/, '')}/#/auth/callback`;
    }
  };

  useEffect(() => {
    const storedMessage = localStorage.getItem('mort_auth_message');
    if (storedMessage) {
      setMessage(storedMessage);
      localStorage.removeItem('mort_auth_message');
    }
  }, []);

  const handleSignUp = async () => {
    if (!supabase || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    const emailRedirectTo = getEmailRedirectTo();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          mort_persona: 'realtor',
        },
      },
    });
    if (signUpError) {
      setError(signUpError.message);
    } else if (data.user && !data.session) {
      setMessage('Check your email to confirm your account. Open the link to finish signing up.');
    } else {
      setMessage('Sign up complete. You are now signed in.');
    }
    setIsSubmitting(false);
  };

  const handleSignIn = async () => {
    if (!supabase || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
    }
    setIsSubmitting(false);
  };

  return (
    <section className="max-w-md mx-auto p-6 pb-0">
      <div className="bg-slate-900/60 border border-white/10 rounded-[2.5rem] p-8 shadow-2xl space-y-6">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Secure Access</p>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter mt-2">Sign In</h2>
          <p className="text-xs text-slate-400 mt-2">Create an account or use your email to continue.</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>
        </div>
        <div className="grid gap-3">
          <button
            onClick={handleSignUp}
            disabled={!email || !password || !supabase}
            className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black uppercase text-xs py-4 rounded-2xl transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {isSubmitting ? 'Working...' : 'Sign Up'}
          </button>
          <button
            onClick={handleSignIn}
            disabled={!email || !password || !supabase}
            className="w-full bg-slate-800 text-white font-black uppercase text-xs py-4 rounded-2xl border border-white/10 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {isSubmitting ? 'Working...' : 'Sign In'}
          </button>
        </div>
        {(message || error) && (
          <div className={`text-xs font-bold ${error ? 'text-red-400' : 'text-emerald-400'}`}>
            {error ?? message}
          </div>
        )}
      </div>
    </section>
  );
};

export default AuthPanel;
