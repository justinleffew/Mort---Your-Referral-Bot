import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UI_LABELS } from '../utils/uiLabels';
import {
  ContactDraft,
  formatPhoneDisplay,
  getEmptyDraft,
  RealtimeVoiceSession,
  TranscriptEntry,
  VoiceUiState,
} from '../services/realtimeVoiceService';

const statusCopy: Record<VoiceUiState, string> = {
  idle: 'Tap to speak',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Error',
};

const CommuteMode: React.FC = () => {
  const navigate = useNavigate();
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceUiState>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [draft, setDraft] = useState<ContactDraft>(getEmptyDraft());
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partialUser, setPartialUser] = useState('');
  const [partialAssistant, setPartialAssistant] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const hasMinimum = useMemo(
    () => Boolean(draft.full_name || draft.phone || draft.email),
    [draft.email, draft.full_name, draft.phone],
  );

  useEffect(() => {
    const session = new RealtimeVoiceSession({
      onStateChange: (state, detail) => {
        setVoiceState(state);
        setStatusDetail(detail ?? '');
      },
      onDraftChange: setDraft,
      onSessionStatus: setStatusDetail,
      onTranscript: (entry) => {
        if (entry.partial && entry.role === 'user') {
          setPartialUser((prev) => prev + entry.text);
          return;
        }
        if (entry.partial && entry.role === 'assistant') {
          setPartialAssistant((prev) => prev + entry.text);
          return;
        }

        if (entry.role === 'user') {
          setPartialUser('');
        }
        if (entry.role === 'assistant') {
          setPartialAssistant('');
        }
        setTranscript((prev) => [...prev.slice(-24), entry]);
      },
    });
    sessionRef.current = session;

    return () => {
      session.cleanup();
      sessionRef.current = null;
    };
  }, []);

  const handleToggleVoice = async () => {
    setSaveMessage('');
    if (!sessionRef.current) {
      return;
    }

    if (voiceState === 'idle' || voiceState === 'error') {
      await sessionRef.current.start();
      return;
    }

    await sessionRef.current.stop();
  };

  const handleSave = async () => {
    if (!sessionRef.current || !hasMinimum || isSaving) {
      return;
    }
    setSaveMessage('');
    setIsSaving(true);
    try {
      const saved = await sessionRef.current.saveDraft();
      setSaveMessage(saved ? 'Contact saved.' : 'Need a name, phone, or email before saving.');
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save contact.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-app z-[100] flex flex-col p-6 md:p-8 items-center gap-6 overflow-y-auto">
      <div className="w-full max-w-5xl flex justify-between items-center pt-2">
        <button onClick={() => navigate('/')} className="text-muted-foreground font-black uppercase text-xs tracking-widest border border-border px-5 py-2 rounded-full hover:bg-secondary/60">
          Exit
        </button>
        <div className="text-right">
          <span className="text-[10px] font-black text-primary uppercase tracking-[0.3em]">Voice Capture</span>
          <p className="text-foreground font-bold text-sm">{UI_LABELS.ingestion} Realtime</p>
        </div>
      </div>

      <div className="w-full max-w-5xl grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-border bg-surface p-6 md:p-8 space-y-6">
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-black text-foreground">Contact Voice Mode</h2>
            <p className="text-muted-foreground font-medium">Brain dump naturally. Mort keeps listening until you stop.</p>
          </div>

          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={handleToggleVoice}
              className={`w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 relative ${voiceState === 'listening' ? 'bg-primary shadow-[0_0_80px_rgba(37,99,235,0.35)] text-white' : 'bg-muted border-4 border-border text-foreground'}`}
            >
              <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-primary">{statusCopy[voiceState]}</p>
              <p className="text-sm text-muted-foreground mt-1">{statusDetail || 'Open voice mode and start talking.'}</p>
              <p className="text-xs text-muted-foreground mt-1">{voiceState === 'idle' ? 'Tap to speak' : 'Tap to stop'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">Live Transcript</h3>
            <div className="rounded-2xl border border-border bg-muted p-4 h-72 overflow-y-auto space-y-3">
              {transcript.map((entry) => (
                <div key={entry.id} className={`text-sm ${entry.role === 'assistant' ? 'text-primary font-semibold' : 'text-foreground'}`}>
                  <span className="mr-2 text-[10px] uppercase tracking-widest opacity-70">{entry.role}</span>
                  {entry.text}
                </div>
              ))}
              {partialUser && (
                <div className="text-sm text-foreground italic">
                  <span className="mr-2 text-[10px] uppercase tracking-widest opacity-70">user</span>
                  {partialUser}
                </div>
              )}
              {partialAssistant && (
                <div className="text-sm text-primary font-semibold italic">
                  <span className="mr-2 text-[10px] uppercase tracking-widest opacity-70">assistant</span>
                  {partialAssistant}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 md:p-7 space-y-4">
          <h3 className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">Contact Draft (Realtime)</h3>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <DraftRow label="Full name" value={draft.full_name} />
            <DraftRow label="Phone" value={formatPhoneDisplay(draft.phone)} />
            <DraftRow label="Email" value={draft.email} />
            <DraftRow label="Company" value={draft.company} />
            <DraftRow label="City" value={draft.city} />
            <DraftRow label="Tags" value={draft.tags.join(', ')} />
            <DraftRow label="Interests" value={draft.interests.join(', ')} />
            <DraftRow label="Relationship" value={draft.relationship_context} />
            <DraftRow label="Source" value={draft.source} />
            <DraftRow label="Follow-up reason" value={draft.follow_up_reason} />
            <DraftRow label="Notes" value={draft.notes} multiline />
          </div>

          <div className="rounded-2xl border border-border bg-muted p-3 text-xs text-muted-foreground">
            Save is enabled once at least one field exists: full name, phone, or email.
          </div>

          {saveMessage && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
              {saveMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasMinimum || isSaving}
            className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.25em] transition ${hasMinimum && !isSaving ? 'bg-primary text-white hover:opacity-90' : 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'}`}
          >
            {isSaving ? 'Saving…' : `Save to ${UI_LABELS.radar}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const DraftRow = ({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) => (
  <div className="rounded-2xl border border-border bg-muted px-3 py-2">
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
    <p className={`${multiline ? 'whitespace-pre-wrap min-h-10' : ''} mt-1 text-foreground font-medium`}>{value || '—'}</p>
  </div>
);

export default CommuteMode;
