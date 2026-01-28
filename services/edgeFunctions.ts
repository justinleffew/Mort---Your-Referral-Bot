import { getSupabaseClient } from './supabaseClient';

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

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body ?? {},
  });
  if (error) {
    throw new Error(error.message || `Request failed for ${functionName}`);
  }

  return (data ?? ({} as TResponse)) as TResponse;
};
