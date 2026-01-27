import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const getOpenAiKey = () =>
  Deno.env.get('OPENAI_SECRET_KEY') ??
  Deno.env.get('OPENAI_API_KEY');

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const baseHeaders = corsHeaders(origin);
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('apikey');
  const clientInfo = req.headers.get('x-client-info');
  const contentType = req.headers.get('content-type');
  const accept = req.headers.get('accept');
  console.log('mort-openai request', {
    method: req.method,
    origin,
    headers: {
      authorization: authHeader,
      apikey: apiKeyHeader,
      'x-client-info': clientInfo,
      'content-type': contentType,
      accept,
    },
  });

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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI key missing' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { prompt?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Prompt required' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid OpenAI response' }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: parsed }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'OpenAI request failed' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
