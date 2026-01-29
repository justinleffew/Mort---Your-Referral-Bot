
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTH_REQUIRED_MESSAGE, generateBrainDumpFollowUps, generateSpeechAudio, processBrainDump } from '../services/openaiService';
import { dataService } from '../services/dataService';
import { getSupabaseClient } from '../services/supabaseClient';

const CommuteMode: React.FC = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [conversationTranscript, setConversationTranscript] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [speechSupported, setSpeechSupported] = useState(true);
    const [speechError, setSpeechError] = useState('');
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [followUpResponse, setFollowUpResponse] = useState('');
    const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
    const [isRefining, setIsRefining] = useState(false);
    const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
    const [selectedVoice, setSelectedVoice] = useState<'alloy' | 'nova'>('nova');
    const [ttsError, setTtsError] = useState('');
    const [voiceAuthMessage, setVoiceAuthMessage] = useState('');
    const [isTtsLoading, setIsTtsLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const followUpTimeoutRef = useRef<number | null>(null);
    const silenceTimeoutRef = useRef<number | null>(null);
    const speechStartRef = useRef<number | null>(null);
    const latestTranscriptRef = useRef<string>('');
    const isRecordingRef = useRef(false);
    const navigate = useNavigate();

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setSpeechSupported(false);
            setShowManualEntry(true);
            return;
        }

        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;

        recognitionRef.current.onresult = (event: any) => {
            let current = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                current += event.results[i][0].transcript;
            }
            const trimmed = current.trim();
            setTranscript(trimmed);
            latestTranscriptRef.current = trimmed;
            if (!speechStartRef.current) {
                speechStartRef.current = Date.now();
            }
            scheduleSilenceStop();
        };

        recognitionRef.current.onerror = (event: any) => {
            setSpeechError(event?.error ? `Speech recognition error: ${event.error}.` : 'Speech recognition encountered an error.');
        };

        recognitionRef.current.onnomatch = () => {
            setSpeechError('No speech could be recognized. Try again or use manual entry.');
        };

        recognitionRef.current.onend = () => {
            if (isRecordingRef.current) {
                setIsRecording(false);
            }
            clearSilenceTimeout();
        };
    }, []);

    const appendToConversation = (newTranscript: string) => {
        const trimmedTranscript = newTranscript.trim();
        if (!trimmedTranscript) {
            return;
        }
        setConversationTranscript((prev) => (prev ? `${prev}\n${trimmedTranscript}` : trimmedTranscript));
    };

    const clearSilenceTimeout = () => {
        if (silenceTimeoutRef.current !== null) {
            window.clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
        }
    };

    const scheduleSilenceStop = () => {
        if (!isRecordingRef.current) {
            return;
        }
        clearSilenceTimeout();
        const elapsed = speechStartRef.current ? Date.now() - speechStartRef.current : 0;
        const delay = elapsed > 8000 ? 2000 : 1200;
        silenceTimeoutRef.current = window.setTimeout(() => {
            const finalTranscript = latestTranscriptRef.current.trim();
            if (finalTranscript) {
                stopRecording(finalTranscript);
            }
        }, delay);
    };

    const stopRecording = (finalTranscript: string) => {
        clearSilenceTimeout();
        recognitionRef.current?.stop();
        setIsRecording(false);
        appendToConversation(finalTranscript);
    };

    const startRecording = () => {
        if (!speechSupported) {
            return;
        }
        if (isRecordingRef.current) {
            return;
        }
        const isFollowUpCycle = conversationTranscript.trim().length > 0 && (followUpQuestions.length > 0 || followUpResponse || isRefining);
        setTranscript('');
        latestTranscriptRef.current = '';
        speechStartRef.current = Date.now();
        if (!isFollowUpCycle) {
            setConversationTranscript('');
            setFollowUpResponse('');
            setFollowUpQuestions([]);
            setIsRefining(false);
        }
        setSpeechError('');
        if (followUpTimeoutRef.current !== null) {
            window.clearTimeout(followUpTimeoutRef.current);
            followUpTimeoutRef.current = null;
        }
        recognitionRef.current?.start();
        setIsRecording(true);
    };

    useEffect(() => {
        if (!conversationTranscript.trim()) {
            setFollowUpResponse('');
            setFollowUpQuestions([]);
            return;
        }

        const delay = conversationTranscript.length > 240 ? 1600 : 1200;
        const timeout = window.setTimeout(async () => {
            setIsRefining(true);
            const followUp = await generateBrainDumpFollowUps(conversationTranscript);
            setFollowUpResponse(followUp.response);
            setFollowUpQuestions(followUp.questions);
            setIsRefining(false);
        }, delay);
        followUpTimeoutRef.current = timeout;

        return () => {
            window.clearTimeout(timeout);
            if (followUpTimeoutRef.current === timeout) {
                followUpTimeoutRef.current = null;
            }
        };
    }, [conversationTranscript]);

    useEffect(() => {
        let active = true;
        const checkVoiceAuth = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) {
                if (active) {
                    setIsVoiceEnabled(false);
                    setVoiceAuthMessage('Sign in to enable voice playback.');
                }
                return;
            }
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
            if (!active) {
                return;
            }
            if (sessionError || !sessionData?.session) {
                setIsVoiceEnabled(false);
                setVoiceAuthMessage(`${AUTH_REQUIRED_MESSAGE} Sign in to enable voice playback.`);
                return;
            }
            setVoiceAuthMessage('');
        };

        checkVoiceAuth();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!isVoiceEnabled) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            return;
        }

        if (isRecording) {
            return;
        }

        if (!followUpResponse.trim()) {
            setAudioUrl(null);
            return;
        }

        let cancelled = false;
        const fetchAudio = async () => {
            setIsTtsLoading(true);
            setTtsError('');
            try {
                const supabase = getSupabaseClient();
                if (!supabase) {
                    setIsVoiceEnabled(false);
                    setVoiceAuthMessage('Sign in to enable voice playback.');
                    setAudioUrl(null);
                    return;
                }
                const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
                if (sessionError || !sessionData?.session) {
                    setIsVoiceEnabled(false);
                    setVoiceAuthMessage(`${AUTH_REQUIRED_MESSAGE} Sign in to enable voice playback.`);
                    setAudioUrl(null);
                    return;
                }
                setVoiceAuthMessage('');
                const { audio, mimeType } = await generateSpeechAudio(followUpResponse, selectedVoice);
                if (cancelled) return;
                const binary = atob(audio);
                const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
                const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
            } catch (error) {
                if (cancelled) return;
                console.error('Failed to generate speech audio', error);
                setTtsError('Voice playback unavailable. Showing text only.');
                setAudioUrl(null);
            } finally {
                if (!cancelled) {
                    setIsTtsLoading(false);
                }
            }
        };

        fetchAudio();

        return () => {
            cancelled = true;
        };
    }, [followUpResponse, isVoiceEnabled, selectedVoice, isRecording]);

    useEffect(() => {
        if (!audioUrl) {
            return;
        }

        if (audioRef.current) {
            audioRef.current.src = audioUrl;
            audioRef.current.play().catch((error) => {
                console.error('Audio playback failed', error);
                setTtsError('Audio playback was blocked. Showing text only.');
            });
        }

        return () => {
            URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);

    const handleProcess = async () => {
        const combinedTranscript = conversationTranscript.trim() || transcript.trim();
        if (!combinedTranscript) return;
        setIsProcessing(true);
        const clients = await processBrainDump(combinedTranscript);
        await dataService.addBrainDumpClients(clients);
        setIsProcessing(false);
        navigate('/');
    };

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    return (
        <div className="min-h-screen bg-slate-950 z-[100] flex flex-col p-8 items-center justify-between animate-in fade-in duration-500 overflow-y-auto">
            {/* Header */}
            <div className="w-full flex justify-between items-center pt-4">
                <button onClick={() => navigate('/')} className="text-slate-500 font-black uppercase text-xs tracking-widest border border-white/5 px-6 py-3 rounded-full">
                    Exit
                </button>
                <div className="flex flex-col items-end">
                    <span className="text-[10px] font-black text-pink-500 uppercase tracking-[0.3em]">Commute Mode</span>
                    <span className="text-white font-bold text-sm">Voice Ingestion Active</span>
                </div>
            </div>

            {/* Main Central Mic Area */}
            <div className="flex-1 flex flex-col items-center justify-center w-full gap-12">
                <div className="text-center space-y-4 max-w-xs">
                    <h2 className="text-4xl font-black text-white leading-tight">Client Brain Dump</h2>
                    <p className="text-slate-400 text-lg font-medium">Just talk. Tell me who they are, when they bought, and what they love.</p>
                </div>

                <button 
                    onClick={startRecording}
                    disabled={!speechSupported}
                    className={`w-56 h-56 rounded-full flex items-center justify-center transition-all duration-700 relative ${isRecording ? 'bg-pink-500 shadow-[0_0_80px_rgba(236,72,153,0.6)]' : 'bg-slate-900 border-4 border-slate-800'} ${speechSupported ? '' : 'opacity-40 cursor-not-allowed'}`}
                >
                    {isRecording && (
                        <>
                            <div className="absolute inset-0 rounded-full animate-ping bg-pink-400 opacity-20"></div>
                            <div className="absolute -inset-8 rounded-full animate-pulse bg-pink-500 opacity-10"></div>
                        </>
                    )}
                    <svg className={`w-24 h-24 ${isRecording ? 'text-white' : 'text-slate-700'}`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                </button>

                {!speechSupported && (
                    <div className="w-full max-w-md rounded-2xl border border-pink-500/40 bg-pink-500/10 px-5 py-4 text-center text-sm text-pink-100">
                        Speech recognition isn’t supported in this browser. Use manual entry below to continue.
                    </div>
                )}

                {speechError && (
                    <div className="w-full max-w-md rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-center text-sm text-amber-100">
                        {speechError}
                    </div>
                )}

                <div className={`w-full max-w-md bg-slate-900/50 border border-white/5 rounded-[2rem] p-6 h-32 overflow-y-auto transition-opacity ${transcript ? 'opacity-100' : 'opacity-20'}`}>
                    <p className="text-slate-200 text-center font-medium leading-relaxed italic">
                        {transcript || "Speak clearly... I'm listening for names, dates, and interests."}
                    </p>
                </div>

                {(isRefining || followUpQuestions.length > 0 || followUpResponse) && (
                    <div className="w-full max-w-md rounded-[2rem] border border-indigo-500/30 bg-slate-950/70 px-6 py-5 text-sm text-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                            <span>Mort Response</span>
                            <div className="flex items-center gap-3">
                                {isRecording && conversationTranscript.trim() && (
                                    <span className="text-slate-500">Listening for follow-up answers…</span>
                                )}
                                {!isRecording && isRefining && <span className="text-slate-500">Listening…</span>}
                                {isTtsLoading && <span className="text-slate-500">Generating audio…</span>}
                                <button
                                    type="button"
                                    onClick={() => setIsVoiceEnabled((prev) => !prev)}
                                    disabled={!!voiceAuthMessage}
                                    className={`rounded-full border border-indigo-400/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200 transition hover:border-indigo-200 hover:text-white ${voiceAuthMessage ? 'cursor-not-allowed opacity-60' : ''}`}
                                >
                                    {isVoiceEnabled ? 'Voice On' : 'Voice Muted'}
                                </button>
                                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">
                                    Voice
                                    <select
                                        value={selectedVoice}
                                        onChange={(event) => setSelectedVoice(event.target.value as 'alloy' | 'nova')}
                                        disabled={!!voiceAuthMessage}
                                        className={`rounded-full border border-indigo-400/40 bg-slate-950/70 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200 ${voiceAuthMessage ? 'cursor-not-allowed opacity-60' : ''}`}
                                    >
                                        <option value="alloy">Alloy</option>
                                        <option value="nova">Nova</option>
                                    </select>
                                </label>
                            </div>
                        </div>
                        {voiceAuthMessage && (
                            <div className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
                                {voiceAuthMessage}
                            </div>
                        )}
                        {ttsError && (
                            <div className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
                                {ttsError}
                            </div>
                        )}
                        <audio ref={audioRef} className="hidden" />
                        <p className="mt-3 text-slate-300">
                            {followUpResponse || 'Tell me specific details so I can trigger real-time moments.'}
                        </p>
                        {followUpQuestions.length > 0 && (
                            <ul className="mt-3 space-y-2 text-slate-100">
                                {followUpQuestions.map(question => (
                                    <li key={question} className="rounded-2xl bg-slate-900/60 px-4 py-2 text-sm font-semibold">
                                        {question}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {!speechSupported && (
                    <button
                        type="button"
                        onClick={() => setShowManualEntry(true)}
                        className="text-xs font-bold uppercase tracking-[0.2em] text-pink-300 hover:text-pink-200"
                    >
                        Use Manual Entry
                    </button>
                )}

                {showManualEntry && (
                    <div className="w-full max-w-md">
                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                            Manual Entry
                        </label>
                        <textarea
                            value={transcript}
                            onChange={(event) => setTranscript(event.target.value)}
                            rows={5}
                            className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-slate-100 focus:border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                            placeholder="Type the client details you would have spoken..."
                        />
                    </div>
                )}
            </div>

            {/* Action Bar */}
            <div className="w-full pb-8 flex flex-col gap-4">
                <button 
                    disabled={!transcript || isProcessing}
                    onClick={handleProcess}
                    className={`w-full py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xl transition-all shadow-2xl ${transcript && !isProcessing ? 'bg-white text-slate-950 active:scale-95' : 'bg-slate-900 text-slate-700 opacity-50 cursor-not-allowed'}`}
                >
                    {isProcessing ? "Processing Brain Dump..." : "Save to Radar"}
                </button>
            </div>
        </div>
    );
};

export default CommuteMode;
