export interface SchoolModelOption {
  id: string;
  label: string;
  shortName: string;
}

export const DEFAULT_SCHOOL_MODEL_OPTIONS: SchoolModelOption[] = [
  { id: 'deepseek-v4.1-flash', shortName: 'DeepSeek', label: 'DeepSeek (deepseek-v4.1-flash)' },
  { id: 'claude-sonnet-5-5', shortName: 'Sonnet', label: 'Sonnet (claude-sonnet-5-5)' },
];

export type ModelLookupStatus = 'loading' | 'ready' | 'error';

export interface AiConnectionLookupPayload {
  success?: boolean;
  error?: string;
  connected?: boolean;
  model?: string | null;
  defaultModel?: string | null;
  operatorProvider?: string | null;
  operatorModel?: string | null;
  availableSchoolModels?: SchoolModelOption[];
}

export interface AppliedAiConnectionState {
  nonSchoolProviderInfo: { provider: string; model?: string } | null;
  availableModels: SchoolModelOption[];
  savedDefaultModel: string;
  nextSelectedModel: string;
}

/**
 * Resolves UI model options and default selection from `GET /api/ai-connection`
 * while preserving any in-flight user selection (`userModifiedModel === true`)
 * and keeping already-saved valid school models selectable without rewriting
 * them to DeepSeek.
 */
export function applyAiConnectionLookup(
  data: AiConnectionLookupPayload,
  currentSelectedModel: string,
  userModifiedModel: boolean
): AppliedAiConnectionState {
  const baseOptions: SchoolModelOption[] =
    Array.isArray(data.availableSchoolModels) && data.availableSchoolModels.length > 0
      ? data.availableSchoolModels
      : DEFAULT_SCHOOL_MODEL_OPTIONS;

  if (!data.connected && data.operatorProvider && data.operatorProvider !== 'school_gateway') {
    return {
      nonSchoolProviderInfo: {
        provider: data.operatorProvider,
        model: data.operatorModel || undefined,
      },
      availableModels: baseOptions,
      savedDefaultModel: data.operatorModel || 'deepseek-v4.1-flash',
      nextSelectedModel: currentSelectedModel,
    };
  }

  const rawCandidate =
    (data.connected ? data.model : undefined) ||
    data.operatorModel ||
    data.defaultModel ||
    'deepseek-v4.1-flash';
  const savedModel = String(rawCandidate || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';

  const options = baseOptions.some((o) => o.id === savedModel)
    ? baseOptions
    : [
        ...baseOptions,
        {
          id: savedModel,
          shortName: savedModel,
          label: `${savedModel} (저장된 기존 모델)`,
        },
      ];

  return {
    nonSchoolProviderInfo: null,
    availableModels: options,
    savedDefaultModel: savedModel,
    nextSelectedModel: userModifiedModel ? currentSelectedModel : savedModel,
  };
}
