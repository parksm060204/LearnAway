/** Resolve credentials, model and endpoint together for one provider. */
export type AiProvider = 'gemini' | 'openai' | 'deepseek';
export function normalizeAiModel(rawModel?: string): string {
  const model = (rawModel || '').trim();
  return model || 'gemini-3.5-flash';
}

export function resolveAiConfig(env: Record<string, string | undefined>) {
  const value = (key: string) => env[key]?.trim() || '';
  const provider: AiProvider = value('GEMINI_API_KEY') ? 'gemini'
    : value('AI_API_KEY') ? 'gemini'
    : value('OPENAI_API_KEY') ? 'openai'
    : value('DEEPSEEK_API_KEY') ? 'deepseek' : 'gemini';
  const prefix = provider === 'gemini' ? 'GEMINI' : provider === 'openai' ? 'OPENAI' : 'DEEPSEEK';
  const defaults = {
    gemini: { model: 'gemini-3.5-flash', apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    openai: { model: 'gpt-4o-mini', apiBase: 'https://api.openai.com/v1' },
    deepseek: { model: 'deepseek-v4-flash', apiBase: 'https://api.deepseek.com' },
  };
  // Generic AI_* overrides belong only to the generic AI_API_KEY configuration.
  const generic = provider === 'gemini' && !value('GEMINI_API_KEY') && Boolean(value('AI_API_KEY'));
  return {
    provider,
    apiKey: generic ? value('AI_API_KEY') : value(`${prefix}_API_KEY`),
    model: (generic ? value('AI_MODEL') : value(`${prefix}_MODEL`)) || defaults[provider].model,
    apiBase: ((generic ? value('AI_API_BASE') : value(provider === 'openai' ? 'OPENAI_BASE_URL' : `${prefix}_API_BASE`)) || defaults[provider].apiBase).replace(/\/+$/, ''),
  };
}
export const AI_CONFIG = resolveAiConfig(process.env);
export function isAiConfigured(): boolean { return Boolean(AI_CONFIG.apiKey); }
