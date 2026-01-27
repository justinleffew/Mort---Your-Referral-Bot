import { getSupabaseConfig } from './supabaseClient';

type InvokeOptions<TBody> = {
  functionName: string;
  body: TBody;
  accessToken?: string | null;
};

const buildFunctionUrl = (functionName: string, baseUrl: string) =>
  `${baseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`;

const safeParseJson = (payload: string) => {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

export const invokeEdgeFunction = async <TResponse, TBody>({
  functionName,
  body,
  accessToken,
}: InvokeOptions<TBody>): Promise<TResponse> => {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured.');
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    accept: 'application/json',
    apikey: supabaseAnonKey,
  });

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(buildFunctionUrl(functionName, supabaseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const text = await response.text();
  const parsed = safeParseJson(text);

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error?: string }).error : null) ||
      response.statusText ||
      `Request failed for ${functionName}`;
    throw new Error(message || 'Request failed.');
  }

  return (parsed ?? ({} as TResponse)) as TResponse;
};
