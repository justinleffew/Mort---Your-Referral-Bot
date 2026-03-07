import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

const OPENAI_REALTIME_SESSIONS_URL = 'https://api.openai.com/v1/realtime/sessions';

const getOpenAiKey = () =>
  Deno.env.get('OPENAI_SECRET_KEY') ??
  Deno.env.get('OPENAI_API_KEY');

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

  const optionsResponse = handleOptions(req);
  if (optionsResponse) {
    return optionsResponse;
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openAiKey = getOpenAiKey();
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration missing' }), { status: 500, headers });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Please sign in again.' }), { status: 401, headers });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Please sign in again.' }), { status: 401, headers });
  }

  const sessionPayload = {
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'alloy',
    modalities: ['audio', 'text'],
  };

  try {
    const response = await fetch(OPENAI_REALTIME_SESSIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionPayload),
    });

    const payload = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Realtime session request failed', detail: payload }), {
        status: 500,
        headers,
      });
    }

    return new Response(JSON.stringify({ data: payload }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Realtime session request failed', detail: String(error) }), {
      status: 500,
      headers,
    });
  }
});
