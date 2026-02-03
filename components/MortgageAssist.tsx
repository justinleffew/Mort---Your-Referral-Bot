import React, { useState, useRef, useEffect } from 'react';
import { generateMortgageResponse } from '../services/openaiService';
import { MortgageQueryResponse } from '../types';

interface MortgageAssistProps {}

const MortgageAssist: React.FC<MortgageAssistProps> = () => {
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState<MortgageQueryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [copiedSection, setCopiedSection] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        const res = await generateMortgageResponse(query);
        if (isMountedRef.current) {
            setResponse(res);
            setLoading(false);
        }
    };

    const headerLabel = 'Mortgage Assist';
    const placeholder = 'Ask about a mortgage scenario...';
    const buttonLabel = 'Generate Response';
    const containerHeight = 'h-full';

    const handleCopy = async () => {
        if (!response?.response) return;
        await navigator.clipboard.writeText(response.response);
        setCopiedSection('response');
        setTimeout(() => setCopiedSection(null), 2000);
    };

    return (
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden flex flex-col ${containerHeight} relative shadow-xl`}>
            <div className="p-4 border-b border-border bg-muted flex justify-between items-center">
                <h2 className="font-bold text-foreground flex items-center gap-2">
                    <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    {headerLabel}
                </h2>
            </div>
            <div className="p-6 space-y-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={placeholder}
                        className="w-full bg-muted border border-border rounded-xl p-4 text-foreground text-sm min-h-[120px] focus:ring-2 focus:ring-primary outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary text-white font-black uppercase text-xs py-4 rounded-xl disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                    >
                        {loading ? 'Generating...' : buttonLabel}
                    </button>
                </form>

                {response && (
                    <div className="bg-muted border border-border rounded-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">Response</div>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="text-xs font-black uppercase tracking-widest text-primary inline-flex items-center gap-1"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h10v10H8z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 16H5a2 2 0 01-2-2V5a2 2 0 012-2h9a2 2 0 012 2v1" />
                                </svg>
                                {copiedSection === 'response' ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <p className="whitespace-pre-wrap text-base text-foreground leading-relaxed">{response.response}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MortgageAssist;
