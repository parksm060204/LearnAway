/**
 * REDCALL Academic AI Service Configuration
 * Provides unified access to DeepSeek and OpenAI model credentials.
 */

const hasDeepSeek = Boolean(
  (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim()) ||
    (process.env.AI_API_KEY && process.env.AI_API_KEY.trim())
);

const hasOpenAi = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

export const AI_CONFIG = {
  apiKey:
    process.env.DEEPSEEK_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '',
  model:
    process.env.DEEPSEEK_MODEL ||
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    (hasOpenAi && !hasDeepSeek ? 'gpt-4o-mini' : 'deepseek-v4-flash'),
  apiBase:
    process.env.DEEPSEEK_API_BASE ||
    process.env.OPENAI_BASE_URL ||
    (hasOpenAi && !hasDeepSeek ? 'https://api.openai.com/v1' : 'https://api.deepseek.com'),
  provider: (hasOpenAi && !hasDeepSeek ? 'openai' : 'deepseek') as 'deepseek' | 'openai',
};

/**
 * Returns whether the AI service is properly configured with an API key
 */
export function isAiConfigured(): boolean {
  return Boolean(AI_CONFIG.apiKey && AI_CONFIG.apiKey.trim().length > 0);
}
