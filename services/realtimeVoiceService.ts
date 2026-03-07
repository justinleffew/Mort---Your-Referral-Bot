import { dataService } from './dataService';
import { invokeEdgeFunction } from './edgeFunctions';
import { EDGE_FUNCTIONS } from './edgeFunctionConfig';

export type VoiceUiState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export type ContactDraft = {
  full_name: string;
  phone: string;
  email: string;
  company: string;
  city: string;
  tags: string[];
  interests: string[];
  notes: string;
  relationship_context: string;
  source: string;
  follow_up_reason: string;
};

export type TranscriptEntry = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  partial?: boolean;
};

export type VoiceCallbacks = {
  onStateChange: (state: VoiceUiState, detail?: string) => void;
  onDraftChange: (draft: ContactDraft) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onSessionStatus: (status: string) => void;
};

type RealtimeTokenResponse = {
  data?: {
    client_secret?: { value?: string };
  };
};

const DEFAULT_DRAFT: ContactDraft = {
  full_name: '',
  phone: '',
  email: '',
  company: '',
  city: '',
  tags: [],
  interests: [],
  notes: '',
  relationship_context: '',
  source: '',
  follow_up_reason: '',
};

const MINIMUM_REQUIRED_FIELDS: (keyof Pick<ContactDraft, 'full_name' | 'phone' | 'email'>)[] = ['full_name', 'phone', 'email'];
const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const normalizePhone = (value: string) => value.replace(/\D/g, '').slice(0, 10);

const mergeUnique = (base: string[], incoming: string[]) => {
  const values = [...base, ...incoming]
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
};

const canSaveDraft = (draft: ContactDraft) => MINIMUM_REQUIRED_FIELDS.some((field) => Boolean(draft[field]));

const buildSessionPrompt = () => `
You are Mort, a voice-first realtor CRM assistant that captures contacts conversationally.

GOAL
- Let the user naturally brain-dump details.
- Keep a live structured contact draft using tool calls.

STYLE
- Do not confirm every field.
- Be concise and action oriented.
- Ask only one short next question when required.
- If data is clear, acknowledge and continue.

RISK RULES
- Explicitly confirm only when confidence is low or when high-risk data is uncertain.
- Phone numbers: normalize digits only in tool payload; speak in formatted style only when needed.

SAVE RULES
- Use finalize_contact when user asks to save, or when enough information exists and user intent to save is clear.
- Minimum viable contact is at least one of: full_name, phone, email.
- Otherwise continue drafting.

STRUCTURED FIELDS
full_name, phone, email, company, city, tags, interests, notes, relationship_context, source, follow_up_reason.
`;

export class RealtimeVoiceSession {
  private callbacks: VoiceCallbacks;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private draft: ContactDraft = { ...DEFAULT_DRAFT };
  private destroyed = false;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private persistedContactId: string | null = null;

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;
  }

  getDraft() {
    return this.draft;
  }

  async start() {
    this.destroyed = false;
    this.manuallyClosed = false;
    this.callbacks.onStateChange('connecting');
    this.callbacks.onSessionStatus('Connecting to realtime voice…');

    try {
      await this.connect();
      this.callbacks.onSessionStatus('Connected. Speak naturally.');
    } catch (error) {
      this.callbacks.onStateChange('error', error instanceof Error ? error.message : 'Connection failed');
      this.scheduleReconnect();
    }
  }

  async stop() {
    this.manuallyClosed = true;
    this.cleanup();
    this.callbacks.onStateChange('idle');
    this.callbacks.onSessionStatus('Voice stopped.');
  }

  async saveDraft() {
    return this.persistDraft(true);
  }

  private async connect() {
    const tokenPayload = await invokeEdgeFunction<RealtimeTokenResponse, Record<string, never>>({
      functionName: EDGE_FUNCTIONS.OPENAI_REALTIME_SESSION,
      body: {},
    });
    const ephemeralToken = tokenPayload?.data?.client_secret?.value;
    if (!ephemeralToken) {
      throw new Error('Failed to start voice session.');
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.peer = new RTCPeerConnection();
    this.remoteAudioEl = new Audio();
    this.remoteAudioEl.autoplay = true;

    this.peer.ontrack = (event) => {
      if (this.remoteAudioEl) {
        this.remoteAudioEl.srcObject = event.streams[0];
      }
    };

    this.peer.onconnectionstatechange = () => {
      const state = this.peer?.connectionState;
      if (state === 'connected') {
        this.callbacks.onStateChange('listening');
      }
      if (state === 'failed' || state === 'disconnected') {
        this.callbacks.onSessionStatus('Connection dropped. Reconnecting…');
        this.scheduleReconnect();
      }
    };

    this.localStream.getTracks().forEach((track) => {
      this.peer?.addTrack(track, this.localStream as MediaStream);
    });

    this.channel = this.peer.createDataChannel('oai-events');
    this.channel.onopen = () => {
      this.sendEvent({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          instructions: buildSessionPrompt(),
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 450,
            create_response: true,
          },
          tools: [
            {
              type: 'function',
              name: 'update_contact_draft',
              description: 'Update draft contact fields incrementally as the user speaks.',
              parameters: {
                type: 'object',
                properties: {
                  fields: {
                    type: 'object',
                    properties: {
                      full_name: { type: 'string' },
                      phone: { type: 'string' },
                      email: { type: 'string' },
                      company: { type: 'string' },
                      city: { type: 'string' },
                      tags: { type: 'array', items: { type: 'string' } },
                      interests: { type: 'array', items: { type: 'string' } },
                      notes: { type: 'string' },
                      relationship_context: { type: 'string' },
                      source: { type: 'string' },
                      follow_up_reason: { type: 'string' },
                    },
                  },
                  append_notes: { type: 'string' },
                  confidence: { type: 'number' },
                },
                required: ['fields'],
              },
            },
            {
              type: 'function',
              name: 'finalize_contact',
              description: 'Request contact save when user confirms save intent and minimum data exists.',
              parameters: {
                type: 'object',
                properties: {
                  should_save: { type: 'boolean' },
                  reason: { type: 'string' },
                },
                required: ['should_save'],
              },
            },
          ],
          tool_choice: 'auto',
        },
      });

      this.sendEvent({
        type: 'response.create',
        response: {
          instructions: 'Greet the user briefly and invite them to describe a contact naturally.',
        },
      });
    };

    this.channel.onmessage = (event) => {
      this.handleServerEvent(event.data);
    };

    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);

    const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ephemeralToken}`,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    });

    if (!sdpResponse.ok) {
      throw new Error('Voice handshake failed.');
    }

    const answerSdp = await sdpResponse.text();
    await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  private async handleFinalizeTool(args: { should_save?: boolean; reason?: string }) {
    if (!args.should_save) {
      return;
    }
    const saved = await this.persistDraft(false);
    if (!saved) {
      this.callbacks.onTranscript({ id: crypto.randomUUID(), role: 'system', text: 'Need a name, phone, or email before saving.' });
    } else {
      this.callbacks.onTranscript({ id: crypto.randomUUID(), role: 'system', text: args.reason || 'Contact saved.' });
    }
  }

  private async persistDraft(force = false) {
    if (!canSaveDraft(this.draft)) {
      return false;
    }
    if (!force && this.persistedContactId) {
      return true;
    }

    const contact = await dataService.addContact({
      full_name: this.draft.full_name || 'Unknown',
      phone: this.draft.phone,
      email: this.draft.email,
      location_context: this.draft.city,
      radar_interests: this.draft.interests,
      tags: this.draft.tags,
    });

    const noteParts = [
      this.draft.company ? `Company: ${this.draft.company}` : '',
      this.draft.relationship_context ? `Relationship: ${this.draft.relationship_context}` : '',
      this.draft.source ? `Source: ${this.draft.source}` : '',
      this.draft.follow_up_reason ? `Follow-up reason: ${this.draft.follow_up_reason}` : '',
      this.draft.notes ? `Notes: ${this.draft.notes}` : '',
    ].filter(Boolean);

    if (noteParts.length > 0) {
      await dataService.addNote(contact.id, noteParts.join('\n'));
    }

    this.persistedContactId = contact.id;
    return true;
  }

  private handleServerEvent(raw: string) {
    try {
      const event = JSON.parse(raw);

      if (event.type === 'input_audio_buffer.speech_started') {
        this.callbacks.onStateChange('listening');
        this.sendEvent({ type: 'response.cancel' });
      }

      if (event.type === 'response.created') {
        this.callbacks.onStateChange('thinking');
      }

      if (event.type === 'response.audio.delta') {
        this.callbacks.onStateChange('speaking');
      }

      if (event.type === 'response.audio.done') {
        this.callbacks.onStateChange('listening');
      }

      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        this.callbacks.onTranscript({ id: 'user-live', role: 'user', text: event.delta ?? '', partial: true });
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const transcript = String(event.transcript ?? '').trim();
        if (transcript) {
          this.callbacks.onTranscript({ id: crypto.randomUUID(), role: 'user', text: transcript });
        }
      }

      if (event.type === 'response.audio_transcript.delta') {
        this.callbacks.onTranscript({ id: 'assistant-live', role: 'assistant', text: event.delta ?? '', partial: true });
      }

      if (event.type === 'response.audio_transcript.done') {
        const transcript = String(event.transcript ?? '').trim();
        if (transcript) {
          this.callbacks.onTranscript({ id: crypto.randomUUID(), role: 'assistant', text: transcript });
        }
      }

      if (event.type === 'response.function_call_arguments.done') {
        const toolName = String(event.name ?? '');
        const args = JSON.parse(String(event.arguments ?? '{}'));
        if (toolName === 'update_contact_draft') {
          const fields = args.fields ?? {};
          this.draft = {
            ...this.draft,
            ...fields,
            phone: fields.phone ? normalizePhone(String(fields.phone)) : this.draft.phone,
            tags: mergeUnique(this.draft.tags, Array.isArray(fields.tags) ? fields.tags.map(String) : []),
            interests: mergeUnique(this.draft.interests, Array.isArray(fields.interests) ? fields.interests.map(String) : []),
            notes: [this.draft.notes, String(fields.notes ?? ''), String(args.append_notes ?? '')].filter(Boolean).join('\n').trim(),
          };
          this.callbacks.onDraftChange(this.draft);
        }

        if (toolName === 'finalize_contact') {
          this.handleFinalizeTool(args).catch((error) => {
            this.callbacks.onSessionStatus(error instanceof Error ? error.message : 'Failed to save contact.');
          });
        }

        this.sendEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: event.call_id,
            output: JSON.stringify({ ok: true }),
          },
        });
        this.sendEvent({ type: 'response.create' });
      }
    } catch (error) {
      console.warn('Realtime event parse failed', error);
    }
  }

  private sendEvent(event: unknown) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(event));
    }
  }

  private scheduleReconnect() {
    if (this.destroyed || this.manuallyClosed || this.reconnectTimer !== null) {
      return;
    }
    this.cleanup();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => undefined);
    }, 1200);
  }

  cleanup() {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.remoteAudioEl) {
      this.remoteAudioEl.pause();
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl = null;
    }
  }
}

export const formatPhoneDisplay = (digits: string) => {
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const getEmptyDraft = (): ContactDraft => ({ ...DEFAULT_DRAFT });
