import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

type NewsEvent = {
  title: string;
  url: string;
  source: string;
  published_at: string;
  relevance: string;
};

type GdeltArticle = {
  title?: string;
  url?: string;
  seendate?: string;
  sourcecountry?: string;
  domain?: string;
};

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

const buildQuery = (interest: string, location?: string) => {
  const cleanedInterest = interest.trim();
  const cleanedLocation = location?.trim();
  return cleanedLocation ? `${cleanedInterest} ${cleanedLocation}` : cleanedInterest;
};

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  const baseHeaders = corsHeaders(origin);
  const authHeader = req.headers.get('authorization');
  console.log('mort-news-search request', { method: req.method, origin });

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
    console.log('mort-news-search missing configuration');
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
    console.log('mort-news-search unauthorized', { authError });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: { interest?: string; location?: string; limit?: number };
  try {
    payload = await req.json();
  } catch {
    console.log('mort-news-search invalid payload');
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const interest = typeof payload.interest === 'string' ? payload.interest.trim() : '';
  const location = typeof payload.location === 'string' ? payload.location.trim() : '';
  const limit = typeof payload.limit === 'number' && payload.limit > 0 ? Math.min(payload.limit, 10) : 5;
  if (!interest) {
    return new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const query = buildQuery(interest, location);
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    maxrecords: String(limit),
    sort: 'DateDesc',
    timespan: '30d',
    format: 'json',
  });

  try {
    const response = await fetch(`${GDELT_BASE}?${params.toString()}`);
    if (!response.ok) {
      console.log('mort-news-search request failed', { status: response.status });
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const json = await response.json();
    const articles = Array.isArray(json?.articles) ? (json.articles as GdeltArticle[]) : [];
    const relevance = location
      ? `Matches interest "${interest}" and location "${location}".`
      : `Matches interest "${interest}".`;

    const events: NewsEvent[] = articles
      .map(article => ({
        title: article.title || 'Untitled',
        url: article.url || '',
        source: article.domain || article.sourcecountry || 'Unknown',
        published_at: article.seendate || new Date().toISOString(),
        relevance,
      }))
      .filter(event => event.url);

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.log('mort-news-search request error', { error });
    return new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
