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
      if (redirectUrl.hash) {
        return configuredRedirect;
      }
      if (redirectUrl.pathname.includes('/auth/callback')) {
        // Ensure hash-based callback so Vercel never serves a 404 for /auth/callback.
        return `${redirectUrl.origin}/#/auth/callback`;
      }
      if (redirectUrl.pathname !== '/') {
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
      <div className="bg-surface border border-border rounded-[2.5rem] p-8 shadow-2xl space-y-6">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Secure Access</p>
          <h2 className="text-2xl font-black text-foreground uppercase tracking-tighter mt-2">Sign In</h2>
          <p className="text-xs text-muted-foreground mt-2">Create an account or use your email to continue.</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full bg-muted border border-border rounded-2xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full bg-muted border border-border rounded-2xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="••••••••"
            />
          </div>
        </div>
        <div className="grid gap-3">
          <button
            onClick={handleSignUp}
            disabled={!email || !password || !supabase}
            className="w-full bg-primary text-white font-black uppercase text-xs py-4 rounded-2xl transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            {isSubmitting ? 'Working...' : 'Sign Up'}
          </button>
          <button
            onClick={handleSignIn}
            disabled={!email || !password || !supabase}
            className="w-full bg-muted text-foreground font-black uppercase text-xs py-4 rounded-2xl border border-border transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            {isSubmitting ? 'Working...' : 'Sign In'}
          </button>
        </div>
        {(message || error) && (
          <div className={`text-xs font-bold ${error ? 'text-rose-600' : 'text-success'}`}>
            {error ?? message}
          </div>
        )}
      </div>
    </section>
  );
};

export default AuthPanel;
