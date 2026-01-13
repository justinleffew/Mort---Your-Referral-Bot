import React, { useState, useRef, useEffect } from 'react';
import { generateMortgageResponse, getAi } from '../services/geminiService';
import { MortgageQueryResponse } from '../types';
import { LiveServerMessage, Modality } from "@google/genai";

const MortgageAssist: React.FC = () => {
    // Text Mode State
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState<MortgageQueryResponse | null>(null);
    const [loading, setLoading] = useState(false);

    // Live Mode State
    const [isLiveMode, setIsLiveMode] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    
    // Audio Refs
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const sessionRef = useRef<any>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    // Clean up on unmount
    useEffect(() => {
        return () => {
            stopLiveSession();
        };
    }, []);

    const toggleLiveMode = async () => {
        if (isLiveMode) {
            stopLiveSession();
            setIsLiveMode(false);
        } else {
            setIsLiveMode(true);
            await startLiveSession();
        }
    };

    const stopLiveSession = () => {
        setIsConnected(false);
        
        // Close session
        if (sessionRef.current) {
             sessionRef.current = null;
        }

        // Stop input
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (inputAudioContextRef.current) {
            inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }

        // Stop output
        sourcesRef.current.forEach(source => source.stop());
        sourcesRef.current.clear();
        if (outputAudioContextRef.current) {
            outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
    };

    const startLiveSession = async () => {
        const ai = getAi();
        if (!ai) {
            alert("Please set API Key in settings first.");
            setIsLiveMode(false);
            return;
        }

        try {
            // Setup Audio Contexts
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
            outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
            nextStartTimeRef.current = 0;

            // Get Mic Stream
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Connect to Gemini Live
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                    systemInstruction: {
                        parts: [{ text: "You are Mort, a conservative, calm mortgage assistant for a real estate agent. You are speaking to the agent, NOT the homebuyer. Always refer to the homebuyer as 'your client' or 'the buyer'. Never use 'you' when referring to the person buying the home (e.g. never say 'your credit profile'). Keep answers concise. Do not predict rates." }]
                    },
                },
                callbacks: {
                    onopen: () => {
                        console.log('Gemini Live Connected');
                        setIsConnected(true);

                        // Start Input Streaming
                        if (!inputAudioContextRef.current) return;
                        const source = inputAudioContextRef.current.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmData = encodePCM(inputData);
                            
                            sessionPromise.then((session) => {
                                session.sendRealtimeInput({
                                    media: {
                                        mimeType: 'audio/pcm;rate=16000',
                                        data: pcmData
                                    }
                                });
                            });
                        };

                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         // Handle Audio Output
                         const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                         if (base64Audio && outputAudioContextRef.current) {
                            const ctx = outputAudioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                            
                            const audioBuffer = await decodeAudioData(
                                decodeBase64(base64Audio),
                                ctx,
                                24000,
                                1
                            );

                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(ctx.destination); // Simple connection to output
                            
                            source.addEventListener('ended', () => {
                                sourcesRef.current.delete(source);
                            });
                            
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                         }
                         
                         // Handle Interruption
                         if (message.serverContent?.interrupted) {
                            sourcesRef.current.forEach(s => s.stop());
                            sourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                         }
                    },
                    onclose: () => {
                        console.log('Gemini Live Closed');
                        setIsConnected(false);
                    },
                    onerror: (e) => {
                        console.error('Gemini Live Error', e);
                        setIsConnected(false);
                    }
                }
            });

            sessionRef.current = sessionPromise;

        } catch (e) {
            console.error("Failed to start live session", e);
            alert("Could not start audio session. Check permissions.");
            setIsLiveMode(false);
            stopLiveSession();
        }
    };

    // Text Handler
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
            {/* Header */}
            <div className="p-4 border-b border-white/10 bg-slate-800/50 flex justify-between items-center">
                <h2 className="font-bold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    Mortgage Assist
                </h2>
                <button 
                    onClick={toggleLiveMode}
                    className={`p-2 rounded-full transition-all ${isLiveMode ? 'bg-red-500/20 text-red-500 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600'}`}
                    title={isLiveMode ? "End Voice Session" : "Start Voice Session"}
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                </button>
            </div>
            
            {/* Live Mode Overlay */}
            {isLiveMode ? (
                <div className="flex-grow flex flex-col items-center justify-center p-8 text-center space-y-6 bg-slate-900/95 absolute inset-0 z-20 backdrop-blur-sm">
                    <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${isConnected ? 'bg-pink-500/10 shadow-[0_0_50px_rgba(236,72,153,0.3)]' : 'bg-slate-800'}`}>
                         <div className={`w-20 h-20 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 transition-transform duration-300 flex items-center justify-center ${isConnected ? 'animate-pulse' : 'opacity-50'}`}>
                            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                         </div>
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-xl tracking-tight">
                            {isConnected ? "Listening..." : "Connecting..."}
                        </h3>
                        <p className="text-sm text-slate-400 mt-2">
                            Ask about rates, scripts, or advice.
                        </p>
                    </div>
                    <button onClick={toggleLiveMode} className="text-sm text-red-400 hover:text-red-300 font-bold border border-red-500/30 px-6 py-2 rounded-full hover:bg-red-500/10 transition-colors">
                        End Session
                    </button>
                </div>
            ) : (
                /* Text Mode UI */
                <>
                    <div className="p-4 flex-grow overflow-y-auto">
                        {!response && !loading && (
                            <div className="text-center text-slate-600 text-sm mt-12 flex flex-col items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                                </div>
                                Try "Client asking about 7% rates"
                            </div>
                        )}

                        {loading && (
                            <div className="space-y-4 animate-pulse mt-4">
                                <div className="h-4 bg-slate-800 rounded w-3/4"></div>
                                <div className="h-4 bg-slate-800 rounded w-1/2"></div>
                                <div className="h-20 bg-slate-800 rounded w-full"></div>
                            </div>
                        )}

                        {response && (
                            <div className="space-y-5 text-sm">
                                <Section title="What to say" content={response.buyer_script} color="text-pink-100" />
                                <Section title="Ballpark Numbers" content={response.ballpark_numbers} color="text-cyan-100" />
                                <Section title="Heads Up" content={response.heads_up} color="text-amber-100" />
                                <Section title="Next Step" content={response.next_steps} color="text-slate-300" italic />
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-white/10 bg-slate-900">
                        <form onSubmit={handleSubmit} className="relative">
                            <input
                                type="text"
                                placeholder="Type a question..."
                                className="w-full pl-4 pr-12 py-3.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-shadow placeholder-slate-500"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                            <button 
                                type="submit"
                                disabled={loading}
                                className="absolute right-2 top-2 p-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50 transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                            </button>
                        </form>
                    </div>
                </>
            )}
        </div>
    );
};

const Section = ({ title, content, color, italic }: any) => {
    let borderColor = 'border-slate-700';
    let titleColor = 'text-slate-400';
    
    if (title === 'What to say') { borderColor = 'border-pink-500/30'; titleColor = 'text-pink-400'; }
    if (title === 'Ballpark Numbers') { borderColor = 'border-cyan-500/30'; titleColor = 'text-cyan-400'; }
    if (title === 'Heads Up') { borderColor = 'border-amber-500/30'; titleColor = 'text-amber-400'; }

    return (
        <div>
            <h4 className={`text-xs font-bold uppercase tracking-widest mb-2 ${titleColor}`}>{title}</h4>
            <div className={`${color} ${italic ? 'italic' : ''} leading-relaxed bg-slate-800/50 p-3 rounded-lg border ${borderColor} backdrop-blur-sm`}>
                {content}
            </div>
        </div>
    );
}

// --- Audio Utils ---

function decodeBase64(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function encodePCM(inputData: Float32Array): string {
    const l = inputData.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        // Clamp and convert float (-1.0 to 1.0) to int16
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Convert ArrayBuffer to binary string
    let binary = '';
    const bytes = new Uint8Array(int16.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export default MortgageAssist;