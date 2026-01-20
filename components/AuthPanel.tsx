import React, { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AuthPanelProps {
  supabase: SupabaseClient | null;
}

const AuthPanel: React.FC<AuthPanelProps> = ({ supabase }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [persona, setPersona] = useState('realtor');
  const [showPersonaModal, setShowPersonaModal] = useState(false);
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
          mort_persona: persona,
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

  const handleSignUpClick = () => {
    if (!email || !password || !supabase || isSubmitting) return;
    setShowPersonaModal(true);
  };

  const handlePersonaConfirm = () => {
    setShowPersonaModal(false);
    void handleSignUp();
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
            onClick={handleSignUpClick}
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
      {showPersonaModal && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowPersonaModal(false)}></div>
          <div className="relative w-full max-w-sm rounded-[2.5rem] border border-white/10 bg-slate-900 p-8 shadow-2xl space-y-5">
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Set your Mort persona</p>
              <h3 className="text-xl font-black text-white uppercase tracking-tighter mt-2">How do you use Mort?</h3>
              <p className="text-xs text-slate-400 mt-2">We’ll tailor your experience after sign up.</p>
            </div>
            <div className="grid gap-2 text-left text-xs font-bold">
              {[
                { value: 'realtor', label: 'Realtor' },
                { value: 'business_owner', label: 'Business Owner' },
                { value: 'executive', label: 'Executive' },
                { value: 'connector', label: 'Connector' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPersona(option.value)}
                  className={`w-full rounded-2xl border px-4 py-3 uppercase tracking-widest transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                    persona === option.value
                      ? 'border-pink-500 bg-pink-500/10 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3">
              <button
                onClick={handlePersonaConfirm}
                className="w-full rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 py-4 text-xs font-black uppercase text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Continue to Sign Up
              </button>
              <button
                onClick={() => setShowPersonaModal(false)}
                className="w-full rounded-2xl border border-white/10 py-3 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AuthPanel;
