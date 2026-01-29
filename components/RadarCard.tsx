
import React, { useState, useEffect, useRef } from 'react';
import { Contact, ContactNote, GeneratedMessage, RadarState, TouchType } from '../types';
import { generateRadarMessage, determineAngle } from '../services/openaiService';
import { dataService } from '../services/dataService';
import { formatShortDate, getNextTouchDate, getNextTouchStatus } from '../utils/cadence';

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
    const [touchError, setTouchError] = useState<string | null>(null);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);
    const nextTouchDate = getNextTouchDate(contact);
    const nextTouchStatus = getNextTouchStatus(nextTouchDate);

    const nextTouchBadgeStyles = {
        overdue: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        due: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        upcoming: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    }[nextTouchStatus];

    const nextTouchBadgeLabel = {
        overdue: 'Overdue',
        due: 'Due',
        upcoming: 'Upcoming',
    }[nextTouchStatus];

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

    const logTouch = async (type: TouchType) => {
        setTouchError(null);
        try {
            await dataService.addTouch(contact.id, type, {
                channel: 'sms',
                body: editedMessage,
                source: 'radar',
            });
            return true;
        } catch (error) {
            console.warn('Failed to log touch', error);
            setTouchError('Save failed. Please retry.');
            return false;
        }
    };

    const handleCopy = async () => {
        setCopyError(null);

        try {
            await logTouch('text');
            await navigator.clipboard.writeText(editedMessage);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            setCopied(false);
            setCopyError('Copy failed. Select the message and copy manually.');
            selectMessageForManualCopy();
        }
    };

    const handleSent = async () => {
        const saved = await logTouch('text');
        if (!saved) return;
        onReachedOut();
    };

    if (loading) {
        return (
            <div className="bg-surface border border-border rounded-3xl p-6 h-64 shadow-xl">
                <div className="h-6 bg-muted rounded-full w-1/2 mb-4"></div>
                <div className="h-32 bg-muted rounded-2xl mb-4"></div>
            </div>
        );
    }

    return (
        <div className="bg-surface border border-border rounded-[2.5rem] p-6 shadow-2xl transition-all">
            <div className="flex justify-between items-start mb-4">
                <div className="flex gap-3 items-center">
                    <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white font-black border border-border shadow-lg">
                        {contact.full_name.charAt(0)}
                    </div>
                    <div>
                        <h3 className="font-bold text-foreground text-lg leading-tight">{contact.full_name}</h3>
                        <div className="flex flex-wrap gap-2 items-center mt-1">
                            {contact.mortgage_inference && (
                                <span className="bg-secondary text-foreground text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-primary/20">
                                    {contact.mortgage_inference.opportunity_tag}
                                </span>
                            )}
                            {contact.do_not_contact && (
                                <span className="bg-rose-100 text-rose-700 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-rose-200">
                                    Do not contact
                                </span>
                            )}
                            {contact.radar_interests.length > 0 && (
                                <span className="bg-secondary text-foreground text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-primary/20">
                                    {contact.radar_interests[0]}
                                </span>
                            )}
                            <span className="text-xs font-semibold text-muted-foreground">
                                Next touch: {formatShortDate(nextTouchDate)}
                            </span>
                            <span className={`text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border ${nextTouchBadgeStyles}`}>
                                {nextTouchBadgeLabel}
                            </span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss card"
                    className="p-2 text-muted-foreground hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div className="bg-muted rounded-3xl p-5 mb-5 border border-border">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-primary">
                        {generated?.angle.replace(/_/g, ' ')}
                    </span>
                </div>
                
                <div className="mb-4 space-y-2 border-l-2 border-primary/30 pl-4 py-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Why now</p>
                    <p className="text-xs text-muted-foreground font-medium italic">{generated?.reason}</p>
                    {contact.mortgage_inference && (
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">
                            Reasoning: {contact.mortgage_inference.reasoning}
                        </p>
                    )}
                </div>

                {isEditing ? (
                    <textarea 
                        className="w-full bg-surface border border-border rounded-xl p-4 text-foreground text-sm focus:ring-2 focus:ring-primary outline-none resize-none"
                        rows={3}
                        value={editedMessage}
                        onChange={(e) => setEditedMessage(e.target.value)}
                        ref={messageRef}
                    />
                ) : (
                    <p className="text-foreground text-sm whitespace-pre-wrap leading-relaxed font-medium" onClick={() => setIsEditing(true)}>
                        {editedMessage}
                    </p>
                )}
            </div>

            <div>
                <div className="flex gap-3">
                    <button 
                        onClick={handleCopy}
                        disabled={contact.do_not_contact}
                        className={`flex-[2] py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-app ${copied ? 'bg-success text-white' : 'bg-primary text-white'} ${contact.do_not_contact ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                        {copied ? 'Copied' : 'Copy Message'}
                    </button>
                    <button 
                        onClick={handleSent}
                        disabled={contact.do_not_contact}
                        className={`flex-1 py-4 bg-muted border border-border text-muted-foreground rounded-2xl text-xs font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app ${contact.do_not_contact ? 'cursor-not-allowed opacity-50' : 'hover:text-primary'}`}
                    >
                        Sent
                    </button>
                </div>
                {copyError && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                        {copyError}
                    </p>
                )}
                {touchError && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                        {touchError}
                    </p>
                )}
            </div>
        </div>
    );
};

export default RadarCard;
