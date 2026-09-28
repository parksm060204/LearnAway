/**
 * REDCALL Academic AI Service Configuration
 * Provides unified access to DeepSeek and AI model credentials.
 */

export const AI_CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '',
  model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-flash',
  apiBase: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
};

/**
 * Returns whether the AI service is properly configured with an API key
 */
export function isAiConfigured(): boolean {
  return Boolean(AI_CONFIG.apiKey && AI_CONFIG.apiKey.trim().length > 0);
}
