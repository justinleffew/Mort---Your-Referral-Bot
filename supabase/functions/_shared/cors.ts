const ALLOWED_ORIGINS = new Set([
  'https://mort-your-referral-bot.vercel.app',
]);

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (ALLOWED_ORIGINS.has(origin)) return true;
    if (hostname === 'localhost') return true;
    return hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
};

const resolveOrigin = (origin: string | null) => {
  if (!origin) return '*';
  return isAllowedOrigin(origin) ? origin : 'null';
};

export const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': resolveOrigin(origin),
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

export const handleOptions = (req: Request) => {
  if (req.method !== 'OPTIONS') return null;
  const origin = req.headers.get('origin');
  return new Response('ok', { status: 200, headers: corsHeaders(origin) });
};
