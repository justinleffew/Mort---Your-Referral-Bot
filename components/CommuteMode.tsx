
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { processBrainDump } from '../services/geminiService';
import { dataService } from '../services/dataService';

const CommuteMode: React.FC = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const recognitionRef = useRef<any>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            
            recognitionRef.current.onresult = (event: any) => {
                let current = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    current += event.results[i][0].transcript;
                }
                setTranscript(current);
            };
        }
    }, []);

    const toggleRecording = () => {
        if (isRecording) {
            recognitionRef.current?.stop();
            setIsRecording(false);
        } else {
            setTranscript('');
            recognitionRef.current?.start();
            setIsRecording(true);
        }
    };

    const handleProcess = async () => {
        if (!transcript) return;
        setIsProcessing(true);
        const clients = await processBrainDump(transcript);
        dataService.addBrainDumpClients(clients);
        setIsProcessing(false);
        navigate('/');
    };

    return (
        <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col p-8 items-center justify-between animate-in fade-in duration-500">
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
                    onClick={toggleRecording}
                    className={`w-56 h-56 rounded-full flex items-center justify-center transition-all duration-700 relative ${isRecording ? 'bg-pink-500 shadow-[0_0_80px_rgba(236,72,153,0.6)]' : 'bg-slate-900 border-4 border-slate-800'}`}
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

                <div className={`w-full max-w-md bg-slate-900/50 border border-white/5 rounded-[2rem] p-6 h-32 overflow-y-auto transition-opacity ${transcript ? 'opacity-100' : 'opacity-20'}`}>
                    <p className="text-slate-200 text-center font-medium leading-relaxed italic">
                        {transcript || "Speak clearly... I'm listening for names, dates, and interests."}
                    </p>
                </div>
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
