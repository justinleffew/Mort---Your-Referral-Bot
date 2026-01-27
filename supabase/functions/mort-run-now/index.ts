import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

type Candidate = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cadence_days: number;
  cadence_mode: string;
  safe_mode: boolean;
  home_area_id: string | null;
  notes_count: number;
  last_note_at: string | null;
  last_touch_at: string | null;
  touches_last_365: number;
  days_since_last_touch: number;
};

type NoteRow = {
  contact_id: string;
  body: string;
  created_at: string;
};

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const getOpenAiKey = () =>
  Deno.env.get('OPENAI_SECRET_KEY') ??
  Deno.env.get('OPENAI_API_KEY');

const buildFallbackMessages = (fullName: string) => {
  const firstName = fullName.split(' ')[0] || 'there';
  return [
    `Hi ${firstName}, quick check-in—hope you’re doing well. Happy to help with anything home-related.`,
    `Hi ${firstName}, it’s been a bit since we connected. If anything comes up on the home front, I’m here.`,
    `Hi ${firstName}, seeing some helpful market updates lately. If you want a quick take, happy to share.`,
  ];
};

const parseMessagePayload = (content: string): string[] | null => {
  try {
    const parsed = JSON.parse(content) as { messages?: string[] };
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    const cleaned = parsed.messages.map(message => String(message).trim()).filter(Boolean);
    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
};

const generateMessages = async (candidate: Candidate, notes: NoteRow[]) => {
  const openAiKey = getOpenAiKey();
  const fallback = buildFallbackMessages(candidate.full_name);
  if (!openAiKey) return fallback;

  const snippets = notes
    .slice(0, 3)
    .map(note => `- ${note.body}`)
    .join('\n');

  const reasons = [
    candidate.days_since_last_touch > candidate.cadence_days ? 'Due for touch' : 'Recent touch, still relevant',
    candidate.last_note_at ? 'Recent notes on file' : 'No recent notes',
  ];

  const prompt = `
You are writing concise, helpful outreach texts for a real estate agent.

Contact: ${candidate.full_name}
Recent notes:
${snippets || 'None'}
Reasons: ${reasons.join(', ')}
Safe mode: ${candidate.safe_mode ? 'ON (avoid kids/medical/finance)' : 'OFF'}

Write 3 messages:
1) short
2) medium
3) value-first with insight

Rules:
- Plain text only, no emojis.
- Friendly, low-pressure, no referral asks.
- Avoid sensitive topics if safe mode is ON.

Return JSON only: { "messages": ["...","...","..."] }
  `.trim();

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
      return fallback;
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content ?? '';
    return parseMessagePayload(content) ?? fallback;
  } catch {
    return fallback;
  }
};

const scoreCandidate = (candidate: Candidate) => {
  let score = 0;
  if (candidate.days_since_last_touch > candidate.cadence_days) score += 30;
  score += Math.min(candidate.notes_count, 20);
  if (candidate.days_since_last_touch > 180) score += 15;
  if (candidate.last_note_at) {
    const lastNoteDays = Math.floor(
      (Date.now() - new Date(candidate.last_note_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (lastNoteDays <= 30) score += 10;
  }
  if (candidate.days_since_last_touch < 14) score -= 20;
  return score;
};

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const baseHeaders = corsHeaders(origin);
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('apikey');
  const clientInfo = req.headers.get('x-client-info');
  const contentType = req.headers.get('content-type');
  const accept = req.headers.get('accept');
  console.log('mort-run-now request', {
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

  const userId = authData.user.id;

  const cleanupCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('opportunities')
    .delete()
    .eq('user_id', userId)
    .eq('run_context', 'RUN_NOW')
    .gte('created_at', cleanupCutoff);

  const { data: candidates, error: candidatesError } = await supabase.rpc('run_now_candidates', {
    p_user_id: userId,
  });

  if (candidatesError) {
    return new Response(JSON.stringify({ error: 'Failed to load candidates' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const scored = (candidates as Candidate[]).map(candidate => ({
    ...candidate,
    score: scoreCandidate(candidate),
  }));

  const topCandidates = scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.full_name.localeCompare(b.full_name)))
    .slice(0, 10);

  if (topCandidates.length === 0) {
    return new Response(JSON.stringify({ opportunities: [] }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const contactIds = topCandidates.map(candidate => candidate.id);
  const { data: notesData } = await supabase
    .from('contact_notes')
    .select('contact_id,body,created_at')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false });

  const notesByContact = (notesData as NoteRow[] | null)?.reduce<Record<string, NoteRow[]>>((acc, note) => {
    if (!acc[note.contact_id]) acc[note.contact_id] = [];
    if (acc[note.contact_id].length < 3) acc[note.contact_id].push(note);
    return acc;
  }, {}) ?? {};

  const messages = await Promise.all(
    topCandidates.map(candidate => generateMessages(candidate, notesByContact[candidate.id] ?? []))
  );

  const opportunityPayloads = topCandidates.map((candidate, index) => {
    const cadenceViolation = candidate.days_since_last_touch < candidate.cadence_days;
    const yearCapExceeded = candidate.touches_last_365 >= 4;
    const warningFlags = [
      ...(cadenceViolation ? ['CADENCE_VIOLATION'] : []),
      ...(yearCapExceeded ? ['YEAR_CAP_EXCEEDED'] : []),
      ...(candidate.days_since_last_touch < 14 ? ['TOUCHED_RECENTLY'] : []),
    ];

    const reasons = [
      candidate.days_since_last_touch > candidate.cadence_days ? 'Over cadence' : 'Inside cadence',
      candidate.touches_last_365 >= 4 ? 'High yearly touch count' : 'Within yearly touch cap',
      candidate.last_note_at ? 'Recent notes on file' : 'No recent notes',
    ];

    return {
      user_id: userId,
      contact_id: candidate.id,
      area_id: candidate.home_area_id,
      run_context: 'RUN_NOW',
      score: candidate.score,
      reasons,
      suggested_messages: messages[index],
      warning_flags: warningFlags,
      last_touch_at: candidate.last_touch_at,
      touches_last_365: candidate.touches_last_365,
      cadence_violation: cadenceViolation,
      year_cap_exceeded: yearCapExceeded,
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from('opportunities')
    .insert(opportunityPayloads)
    .select('*');

  if (insertError) {
    return new Response(JSON.stringify({ error: 'Failed to insert opportunities' }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const enriched = (inserted ?? []).map(opportunity => {
    const candidate = topCandidates.find(item => item.id === opportunity.contact_id);
    return {
      ...opportunity,
      contact_full_name: candidate?.full_name,
      cadence_days: candidate?.cadence_days,
      days_since_last_touch: candidate?.days_since_last_touch,
    };
  });

  return new Response(JSON.stringify({ opportunities: enriched }), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
  });
});
