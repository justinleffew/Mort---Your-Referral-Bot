import React, { useState } from 'react';
import { generateGeneralAssistResponse, generateMortgageResponse } from '../services/openaiService';
import { Contact, GeneralAssistResponse, MortgageQueryResponse } from '../types';

type MortgageAssistMode = 'mortgage' | 'general';

interface MortgageAssistProps {
    mode?: MortgageAssistMode;
    contacts?: Contact[];
    personaLabel?: string;
}

const MortgageAssist: React.FC<MortgageAssistProps> = ({
    mode = 'mortgage',
    contacts = [],
    personaLabel,
}) => {
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState<MortgageQueryResponse | null>(null);
    const [generalResponse, setGeneralResponse] = useState<GeneralAssistResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const onboardingMessages = [
        {
            id: 'radar',
            body: "Let's test the Radar. Give me a \"Cold Case\" client—someone you haven't spoken to in 6 months because you don't have a reason to call.\n\nTell me their name and one thing they love. I will draft a text message right now that gives you a perfect excuse to reconnect.",
        },
        {
            id: 'commute',
            body: "Eyes on the road, mind on the deal. I’m ready to take notes.\n\nTell me about the last person you met. What’s their name, what are they looking for, and—most importantly—what is one random thing they mentioned (a hobby, a pet, a sports team)?\n\nTap the mic and just vent. I'll sort the data.",
        },
        {
            id: 'due-this-week',
            body: "Forget filling out forms. Your brain is for closing deals, not data entry.\n\nJust start talking. Think of someone you need to impress this month. Tell me who they are and why they matter. I’ll start your \"Due This Week\" list automatically.\n\nReady? Go.",
        },
    ];
    const [onboardingIndex, setOnboardingIndex] = useState(0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        if (mode === 'mortgage') {
            const res = await generateMortgageResponse(query);
            setResponse(res);
            setGeneralResponse(null);
        } else {
            const res = await generateGeneralAssistResponse(query, contacts, personaLabel);
            setGeneralResponse(res);
            setResponse(null);
        }
        setLoading(false);
    };

    const headerLabel = mode === 'mortgage' ? 'Mortgage Assist' : 'Mort Assist';
    const placeholder = mode === 'mortgage'
        ? 'Ask about a mortgage scenario...'
        : 'Ask about a contact, follow-up ideas, or next steps...';
    const buttonLabel = mode === 'mortgage' ? 'Generate Response' : 'Ask Mort';
    const containerHeight = mode === 'mortgage' ? 'h-full' : '';
    const isOnboardingVisible = mode === 'mortgage';
    const onboardingMessage = onboardingMessages[onboardingIndex];
    const isLastOnboarding = onboardingIndex >= onboardingMessages.length - 1;

    return (
        <div className={`bg-slate-900 border border-white/10 rounded-2xl overflow-hidden flex flex-col ${containerHeight} relative shadow-xl`}>
            <div className="p-4 border-b border-white/10 bg-slate-800/50 flex justify-between items-center">
                <h2 className="font-bold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    {headerLabel}
                </h2>
            </div>
            <div className="p-6 space-y-6">
                {isOnboardingVisible && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-pink-500 to-indigo-600 text-white flex items-center justify-center font-black shadow-xl">
                                M
                            </div>
                            <div className="flex-1 space-y-3">
                                <div className="bg-slate-950/70 border border-white/5 rounded-2xl px-4 py-3 text-sm text-slate-200 shadow-lg">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-pink-400 mb-2">Mort</p>
                                    <p className="whitespace-pre-line leading-relaxed">{onboardingMessage.body}</p>
                                </div>
                                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-slate-500">
                                    <span>Prompt {onboardingIndex + 1} of {onboardingMessages.length}</span>
                                    <button
                                        type="button"
                                        onClick={() => setOnboardingIndex((prev) => Math.min(prev + 1, onboardingMessages.length - 1))}
                                        disabled={isLastOnboarding}
                                        className="text-pink-400 hover:text-pink-300 transition disabled:text-slate-600 disabled:cursor-not-allowed"
                                    >
                                        Refresh prompt
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Record a note"
                                    className="w-full flex items-center justify-center gap-3 bg-slate-950/70 border border-white/10 rounded-2xl py-3 text-slate-200 font-semibold shadow-lg hover:border-pink-500/50 transition animate-pulse"
                                >
                                    <span className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center text-pink-300">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 013 3v6a3 3 0 11-6 0V6a3 3 0 013-3zm0 12v3m0 0h-3m3 0h3" />
                                        </svg>
                                    </span>
                                    Tap to record
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={placeholder}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white text-sm min-h-[120px] focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-indigo-600 text-white font-black uppercase text-xs py-4 rounded-xl disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                        {loading ? 'Generating...' : buttonLabel}
                    </button>
                </form>

                {response && mode === 'mortgage' && (
                    <div className="space-y-4 text-sm text-slate-300">
                        <div className="bg-slate-950/70 border border-white/5 rounded-xl p-4">
                            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Buyer Script</div>
                            <p className="whitespace-pre-wrap">{response.buyer_script}</p>
                        </div>
                        <div className="bg-slate-950/70 border border-white/5 rounded-xl p-4">
                            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Ballpark Numbers</div>
                            <p className="whitespace-pre-wrap">{response.ballpark_numbers}</p>
                        </div>
                        <div className="bg-slate-950/70 border border-white/5 rounded-xl p-4">
                            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Heads Up</div>
                            <p className="whitespace-pre-wrap">{response.heads_up}</p>
                        </div>
                        <div className="bg-slate-950/70 border border-white/5 rounded-xl p-4">
                            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Next Steps</div>
                            <p className="whitespace-pre-wrap">{response.next_steps}</p>
                        </div>
                    </div>
                )}
                {generalResponse && mode === 'general' && (
                    <div className="space-y-4 text-sm text-slate-300">
                        <div className="bg-slate-950/70 border border-white/5 rounded-xl p-4">
                            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Mort Reply</div>
                            <p className="whitespace-pre-wrap">{generalResponse.response}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MortgageAssist;
