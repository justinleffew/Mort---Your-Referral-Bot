export const EDGE_FUNCTIONS = {
  OPENAI: 'mort-openai',
  OPENAI_TTS: 'mort-openai-tts',
  RUN_NOW: 'mort-run-now',
  NEWS_SEARCH: 'mort-news-search',
} as const;

export const EDGE_FUNCTION_PATHS = {
  OPENAI: '/functions/v1/mort-openai',
  OPENAI_TTS: '/functions/v1/mort-openai-tts',
  RUN_NOW: '/functions/v1/mort-run-now',
  NEWS_SEARCH: '/functions/v1/mort-news-search',
} as const;
