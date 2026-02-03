import { getSupabaseClient, getSupabaseConfig } from './supabaseClient';

type InvokeOptions<TBody> = {
  functionName: string;
  body: TBody;
};

export const invokeEdgeFunction = async <TResponse, TBody>({
  functionName,
  body,
}: InvokeOptions<TBody>): Promise<TResponse> => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error('Unable to check authentication status.');
  }
  if (!sessionData?.session) {
    throw new Error('Authentication required to call edge functions.');
  }

  const { supabaseAnonKey } = getSupabaseConfig();
  if (!supabaseAnonKey) {
    throw new Error('Supabase anon key is not configured.');
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body ?? {},
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: supabaseAnonKey,
    },
  });
  if (error) {
    throw new Error(error.message || `Request failed for ${functionName}`);
  }

  return (data ?? ({} as TResponse)) as TResponse;
};
