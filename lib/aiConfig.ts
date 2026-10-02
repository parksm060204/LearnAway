/**
 * REDCALL Academic AI Service Configuration
 * Provides unified access to Gemini, OpenAI, and DeepSeek model credentials.
 */

export function normalizeAiModel(rawModel?: string): string {
  const m = (rawModel || '').trim();
  if (!m) return 'gemini-3.5-flash';
  // Google Gemini API endpoint uses 'gemini-3.5-flash' for the 3.5 preview model.
  if (m === 'gemini-3.5-preview' || m === 'gemini-3.5-flash-preview' || m === 'gemini-3.5') {
    return 'gemini-3.5-flash';
  }
  return m;
}

const hasGemini = Boolean(
  (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) ||
    (process.env.AI_API_KEY && process.env.AI_API_KEY.trim())
);

const hasOpenAi = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim());

export const AI_CONFIG = {
  apiKey:
    process.env.GEMINI_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    '',
  model: normalizeAiModel(
    process.env.GEMINI_MODEL ||
      process.env.AI_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      (hasOpenAi && !hasGemini && !hasDeepSeek ? 'gpt-4o-mini' : 'gemini-3.5-flash')
  ),
  apiBase:
    process.env.GEMINI_API_BASE ||
    process.env.AI_API_BASE ||
    process.env.OPENAI_BASE_URL ||
    process.env.DEEPSEEK_API_BASE ||
    (hasOpenAi && !hasGemini && !hasDeepSeek
      ? 'https://api.openai.com/v1'
      : 'https://generativelanguage.googleapis.com/v1beta/openai'),
  provider: (hasOpenAi && !hasGemini && !hasDeepSeek
    ? 'openai'
    : hasDeepSeek && !hasGemini
    ? 'deepseek'
    : 'gemini') as 'gemini' | 'openai' | 'deepseek',
};

/**
 * Returns whether the AI service is properly configured with an API key
 */
export function isAiConfigured(): boolean {
  return Boolean(AI_CONFIG.apiKey && AI_CONFIG.apiKey.trim().length > 0);
}

