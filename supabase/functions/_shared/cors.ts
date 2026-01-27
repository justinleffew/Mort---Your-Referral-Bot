const ALLOWED_ORIGINS = new Set([
  'https://mort-your-referral-bot.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]);

const resolveOrigin = (origin: string | null) => {
  if (!origin) return '*';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin.startsWith('http://localhost:')) return origin;
  return '*';
};

export const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': resolveOrigin(origin),
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-client-info, accept',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
});

export const handleOptions = (req: Request) => {
  if (req.method !== 'OPTIONS') return null;
  const origin = req.headers.get('origin');
  return new Response('ok', { status: 200, headers: corsHeaders(origin) });
};
