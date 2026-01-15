import React, { useState } from 'react';
import { generateMortgageResponse } from '../services/openaiService';
import { MortgageQueryResponse } from '../types';

const MortgageAssist: React.FC = () => {
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState<MortgageQueryResponse | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        const res = await generateMortgageResponse(query);
        setResponse(res);
        setLoading(false);
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden flex flex-col h-full relative shadow-xl">
            <div className="p-4 border-b border-white/10 bg-slate-800/50 flex justify-between items-center">
                <h2 className="font-bold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    Mortgage Assist
                </h2>
            </div>
            <div className="p-6 space-y-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ask about a mortgage scenario..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white text-sm min-h-[120px] focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-indigo-600 text-white font-black uppercase text-xs py-4 rounded-xl disabled:opacity-60"
                    >
                        {loading ? 'Generating...' : 'Generate Response'}
                    </button>
                </form>

                {response && (
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
            </div>
        </div>
    );
};

export default MortgageAssist;
