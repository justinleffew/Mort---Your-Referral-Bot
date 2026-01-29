import { invokeEdgeFunction } from './edgeFunctions';
import { EDGE_FUNCTIONS } from './edgeFunctionConfig';
import { NewsEvent } from '../types';

type NewsSearchResponse = {
  events?: NewsEvent[];
};

export const searchNewsEvents = async ({
  interest,
  location,
  limit = 5,
}: {
  interest: string;
  location?: string;
  limit?: number;
}): Promise<NewsEvent[]> => {
  if (!interest.trim()) return [];
  try {
    const payload = await invokeEdgeFunction<NewsSearchResponse, { interest: string; location?: string; limit?: number }>({
      functionName: EDGE_FUNCTIONS.NEWS_SEARCH,
      body: {
        interest: interest.trim(),
        location: location?.trim() || undefined,
        limit,
      },
    });
    return payload.events ?? [];
  } catch (error) {
    console.warn('News search failed', error);
    return [];
  }
};
