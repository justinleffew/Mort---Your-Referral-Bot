
import React, { useState, useEffect, useRef } from 'react';
import { Contact, ContactNote, GeneratedMessage, RadarState } from '../types';
import { generateRadarMessage, determineAngle } from '../services/geminiService';
import { dataService } from '../services/dataService';

interface RadarCardProps {
    contact: Contact;
    notes: ContactNote[];
    state: RadarState;
    onReachedOut: () => void;
    onDismiss: () => void;
}

const RadarCard: React.FC<RadarCardProps> = ({ contact, notes, state, onReachedOut, onDismiss }) => {
    const [loading, setLoading] = useState(true);
    const [generated, setGenerated] = useState<GeneratedMessage | null>(null);
    const [editedMessage, setEditedMessage] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState<string | null>(null);
    const [showWhy, setShowWhy] = useState(false);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        loadPrompt();
    }, [contact.id]);

    const loadPrompt = async (forceRefresh = false) => {
        setLoading(true);
        const usedAngles = forceRefresh 
            ? [...state.angles_used_json.map(a => a.angle), generated?.angle || ''] 
            : state.angles_used_json.map(a => a.angle);
            
        const angle = determineAngle(contact, notes, usedAngles as any);
        const result = await generateRadarMessage(contact, angle, notes);
        setGenerated(result);
        setEditedMessage(result.message);
        setLoading(false);

        const usedAt = new Date().toISOString();
        await dataService.updateRadarState(contact.id, {
            angles_used_json: [{ angle, used_at: usedAt }],
            ...(forceRefresh
                ? {}
                : {
                    last_prompt_shown_at: usedAt,
                    last_angle: angle,
                    last_reason: result.reason,
                    last_message: result.message
                })
        });
    };

    const selectMessageForManualCopy = () => {
        if (!isEditing) {
            setIsEditing(true);
        }

        setTimeout(() => {
            if (messageRef.current) {
                messageRef.current.focus();
                messageRef.current.select();
            }
        }, 0);
    };

    const handleCopy = async () => {
        setCopyError(null);

        try {
            await navigator.clipboard.writeText(editedMessage);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            setCopied(false);
            setCopyError('Copy failed. Select the message and copy manually.');
            selectMessageForManualCopy();
        }
    };

    if (loading) {
        return (
            <div className="bg-slate-800/40 border border-white/5 rounded-3xl p-6 h-64 animate-pulse">
                <div className="h-6 bg-slate-700/50 rounded-full w-1/2 mb-4"></div>
                <div className="h-32 bg-slate-700/30 rounded-2xl mb-4"></div>
            </div>
        );
    }

    return (
        <div className="bg-slate-800/50 backdrop-blur-lg border border-white/10 rounded-[2.5rem] p-6 shadow-2xl transition-all">
            <div className="flex justify-between items-start mb-4">
                <div className="flex gap-3 items-center">
                    <div className="w-12 h-12 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-black border border-white/10 shadow-lg">
                        {contact.full_name.charAt(0)}
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-lg leading-tight">{contact.full_name}</h3>
                        <div className="flex gap-2 items-center mt-1">
                            {contact.mortgage_inference && (
                                <span className="bg-pink-500/20 text-pink-400 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-pink-500/30">
                                    {contact.mortgage_inference.opportunity_tag}
                                </span>
                            )}
                            {contact.radar_interests.length > 0 && (
                                <span className="bg-cyan-500/20 text-cyan-400 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-cyan-500/30">
                                    {contact.radar_interests[0]}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <button onClick={onDismiss} className="p-2 text-slate-600 hover:text-red-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div className="bg-slate-900/60 rounded-3xl p-5 mb-5 border border-white/5">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">
                        {generated?.angle.replace(/_/g, ' ')}
                    </span>
                    <button onClick={() => setShowWhy(!showWhy)} className="text-[10px] font-bold text-slate-500 hover:text-slate-300">DETAILS</button>
                </div>
                
                {showWhy && (
                    <div className="mb-4 space-y-2 border-l-2 border-pink-500/30 pl-4 py-1">
                        <p className="text-xs text-slate-400 font-medium italic">{generated?.reason}</p>
                        {contact.mortgage_inference && (
                            <p className="text-[10px] text-pink-400/80 font-bold uppercase tracking-tighter">
                                Reasoning: {contact.mortgage_inference.reasoning}
                            </p>
                        )}
                    </div>
                )}

                {isEditing ? (
                    <textarea 
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white text-sm focus:ring-2 focus:ring-pink-500 outline-none resize-none"
                        rows={3}
                        value={editedMessage}
                        onChange={(e) => setEditedMessage(e.target.value)}
                        ref={messageRef}
                    />
                ) : (
                    <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed font-medium" onClick={() => setIsEditing(true)}>
                        {editedMessage}
                    </p>
                )}
            </div>

            <div>
                <div className="flex gap-3">
                    <button 
                        onClick={handleCopy}
                        className={`flex-[2] py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl ${copied ? 'bg-emerald-500 text-white' : 'bg-white text-slate-950'}`}
                    >
                        {copied ? 'Copied' : 'Copy Message'}
                    </button>
                    <button 
                        onClick={onReachedOut}
                        className="flex-1 py-4 bg-slate-900 border border-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:text-white transition-colors"
                    >
                        Sent
                    </button>
                </div>
                {copyError && (
                    <p className="mt-2 text-[10px] font-semibold text-amber-400">
                        {copyError}
                    </p>
                )}
            </div>
        </div>
    );
};

export default RadarCard;
