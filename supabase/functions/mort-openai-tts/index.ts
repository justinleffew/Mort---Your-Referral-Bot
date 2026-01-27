import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_VOICE = 'alloy';
const ALLOWED_VOICES = new Set(['alloy', 'nova']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-supabase-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server configuration missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI key missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { text?: string; voice?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return new Response(JSON.stringify({ error: 'Text required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buffer = await response.arrayBuffer();
    const audio = toBase64(buffer);
    const mimeType = response.headers.get('Content-Type') ?? 'audio/mpeg';

    return new Response(JSON.stringify({ data: { audio, mimeType } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
