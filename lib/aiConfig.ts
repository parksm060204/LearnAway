/**
 * Resolve credentials, model and endpoint together for ONE provider.
 *
 * Provider isolation:
 *  - `AI_PROVIDER` explicitly selects a provider. When set, it wins over the
 *    individual provider keys and NO other provider's key/base/model is read.
 *  - When `AI_PROVIDER` is not set, the legacy key-based inference is preserved.
 *  - A selected provider with a missing key is simply unconfigured; we never
 *    silently fall back to another (paid) provider.
 */
export type AiProvider = 'gemini' | 'openai' | 'deepseek' | 'school_gateway';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  apiBase: string;
  /** Reasoning providers need a larger output budget or they return empty. */
  minOutputTokens: number;
  /** Structured-output mode requested for the school gateway (default none). */
  jsonMode: 'none' | 'json_object';
  /** Set when AI_PROVIDER is present but not a supported value. */
  providerError?: string;
}

interface ProviderDefaults {
  model: string;
  apiBase: string;
  keyEnv: string;
  baseEnv: string;
  modelEnv: string;
}

const PROVIDER_DEFAULTS: Record<AiProvider, ProviderDefaults> = {
  gemini: {
    model: 'gemini-3.5-flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    baseEnv: 'GEMINI_API_BASE',
    modelEnv: 'GEMINI_MODEL',
  },
  openai: {
    model: 'gpt-4o-mini',
    apiBase: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    baseEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
  },
  deepseek: {
    model: 'deepseek-v4-flash',
    apiBase: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseEnv: 'DEEPSEEK_API_BASE',
    modelEnv: 'DEEPSEEK_MODEL',
  },
  // Incheon National University AI:NU BAZE API Gateway.
  school_gateway: {
    model: 'deepseek-v4.1-flash',
    apiBase: 'https://factchat-cloud.mindlogic.ai/v1/gateway',
    keyEnv: 'BAZE_API_KEY',
    baseEnv: 'BAZE_BASE_URL',
    modelEnv: 'BAZE_MODEL',
  },
};

const SCHOOL_GATEWAY_DEFAULT_MIN_OUTPUT_TOKENS = 16000;

const KNOWN_PROVIDERS: AiProvider[] = ['gemini', 'openai', 'deepseek', 'school_gateway'];
const PROVIDER_ALIASES: Record<string, AiProvider> = {
  school_gateway: 'school_gateway',
  school: 'school_gateway',
  baze: 'school_gateway',
  ainu: 'school_gateway',
};

export function normalizeAiModel(rawModel?: string): string {
  const model = (rawModel || '').trim();
  return model || PROVIDER_DEFAULTS.gemini.model;
}

export function resolveAiConfig(env: Record<string, string | undefined>): AiConfig {
  const value = (key: string) => env[key]?.trim() || '';

  const requested = value('AI_PROVIDER').toLowerCase();
  if (requested) {
    const alias = PROVIDER_ALIASES[requested];
    const provider = (alias ?? (KNOWN_PROVIDERS.includes(requested as AiProvider) ? (requested as AiProvider) : null));
    if (!provider) {
      // Unknown AI_PROVIDER: do NOT fall back to another provider's key.
      return {
        provider: requested as AiProvider,
        apiKey: '',
        model: '',
        apiBase: '',
        minOutputTokens: 0,
        jsonMode: 'none',
        providerError: `지원하지 않는 AI_PROVIDER 값입니다: ${value('AI_PROVIDER')}`,
      };
    }
    const defaults = PROVIDER_DEFAULTS[provider];
    const isSchool = provider === 'school_gateway';
    const rawBase = value(defaults.baseEnv) || defaults.apiBase;
    const minRaw = Number(value('BAZE_MIN_OUTPUT_TOKENS'));
    return {
      provider,
      apiKey: value(defaults.keyEnv),
      model: value(defaults.modelEnv) || defaults.model,
      apiBase: rawBase.replace(/\/+$/, ''),
      minOutputTokens: isSchool
        ? (Number.isFinite(minRaw) && minRaw > 0 ? minRaw : SCHOOL_GATEWAY_DEFAULT_MIN_OUTPUT_TOKENS)
        : 0,
      jsonMode: isSchool && value('BAZE_JSON_MODE') === 'json_object' ? 'json_object' : 'none',
    };
  }

  // Legacy behaviour: infer from whichever key exists (kept for compatibility).
  const provider: AiProvider = value('GEMINI_API_KEY') ? 'gemini'
    : value('AI_API_KEY') ? 'gemini'
    : value('OPENAI_API_KEY') ? 'openai'
    : value('DEEPSEEK_API_KEY') ? 'deepseek' : 'gemini';
  const prefix = provider === 'gemini' ? 'GEMINI' : provider === 'openai' ? 'OPENAI' : 'DEEPSEEK';
  const defaults = PROVIDER_DEFAULTS[provider];
  // Generic AI_* overrides belong only to the generic AI_API_KEY configuration.
  const generic = provider === 'gemini' && !value('GEMINI_API_KEY') && Boolean(value('AI_API_KEY'));
  const baseEnv = provider === 'openai' ? 'OPENAI_BASE_URL' : `${prefix}_API_BASE`;
  return {
    provider,
    apiKey: generic ? value('AI_API_KEY') : value(`${prefix}_API_KEY`),
    model: (generic ? value('AI_MODEL') : value(`${prefix}_MODEL`)) || defaults.model,
    apiBase: ((generic ? value('AI_API_BASE') : value(baseEnv)) || defaults.apiBase).replace(/\/+$/, ''),
    minOutputTokens: 0,
    jsonMode: 'none',
  };
}

export const AI_CONFIG = resolveAiConfig(process.env);
export function isAiConfigured(): boolean { return Boolean(AI_CONFIG.apiKey); }
