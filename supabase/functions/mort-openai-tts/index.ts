import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_VOICE = 'alloy';
const ALLOWED_VOICES = new Set(['alloy', 'nova']);

const getOpenAiKey = () =>
  Deno.env.get('OPENAI_SECRET_KEY') ??
  Deno.env.get('OPENAI_API_KEY');

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const baseHeaders = corsHeaders(origin);
  console.log('mort-openai-tts request', { method: req.method, origin });
  const authHeader = req.headers.get('authorization');

  const optionsResponse = handleOptions(req);
  if (optionsResponse) {
    return optionsResponse;
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.log('mort-openai-tts missing configuration');
    return new Response(JSON.stringify({ error: 'Server configuration missing' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader ?? '' } },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    console.log('mort-openai-tts unauthorized', { authError });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    console.log('mort-openai-tts missing OpenAI key');
    return new Response(JSON.stringify({ error: 'OpenAI key missing' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { text?: string; voice?: string };
  try {
    payload = await req.json();
  } catch {
    console.log('mort-openai-tts invalid payload');
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    console.log('mort-openai-tts missing text');
    return new Response(JSON.stringify({ error: 'Text required' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const voiceInput = typeof payload.voice === 'string' ? payload.voice.trim().toLowerCase() : '';
  const voice = ALLOWED_VOICES.has(voiceInput) ? voiceInput : DEFAULT_VOICE;

  try {
    const response = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice,
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      console.log('mort-openai-tts request failed', { status: response.status });
      return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buffer = await response.arrayBuffer();
    const audio = toBase64(buffer);
    const mimeType = response.headers.get('Content-Type') ?? 'audio/mpeg';

    return new Response(JSON.stringify({ data: { audio, mimeType } }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.log('mort-openai-tts request error', { error });
    return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
