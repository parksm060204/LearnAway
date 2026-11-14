import { createHash } from 'node:crypto';
import type { AiConfig } from './aiConfig';
import {
  verifyGatewayModelForKey,
  type GatewayModelCheck,
  type GatewayModelCheckReason,
} from './aiClient';
import {
  DEFAULT_SCHOOL_MODEL,
  SCHOOL_GATEWAY_PROVIDER,
  connectionCheckHttpStatus,
  decryptSecret,
  getEncryptionKey,
  lookupConnectionSecret,
  reasonToCode,
  resolveOperatorAiConfig,
  type ConnectionLookup,
} from './aiCredentials';
import {
  toAcademicDifficultyLevel,
  type AcademicDifficultyLevel,
} from './types';

/**
 * Manual AI model selection policy.
 *
 * Policy:
 *  - Difficulty level NEVER forces a model switch.
 *  - Priority on `school_gateway`:
 *      1. Validated explicit per-request `selectedModel`
 *      2. User's saved `ai_connections.model`
 *      3. Operator configured default model (for unregistered trial/fallback)
 *      4. `DEFAULT_SCHOOL_MODEL` (`deepseek-v4.1-flash`)
 *  - Allowed explicit per-request school models: DeepSeek (`deepseek-v4.1-flash`)
 *    and Sonnet (`claude-sonnet-5-5` or server env override).
 *  - Non-school providers (gemini/openai/deepseek): existing single-provider
 *    configuration is preserved; school models cannot be injected.
 *  - Model options (e.g. `minOutputTokens`, `jsonMode`) follow the actually
 *    selected model — DeepSeek's 16000 `minOutputTokens` is NEVER copied to Sonnet.
 *  - Unsupported, forbidden, or unverified models fail explicitly and NEVER
 *    fall back to DeepSeek or another paid model.
 */

export const DEFAULT_SONNET_SCHOOL_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_HIGH_DIFFICULTY_SCHOOL_MODEL = DEFAULT_SONNET_SCHOOL_MODEL;

export const SONNET_MODEL_ENV_KEYS = [
  'BAZE_SONNET_MODEL',
  'AI_SONNET_MODEL',
  'BAZE_HIGH_DIFFICULTY_MODEL',
  'AI_HIGH_DIFFICULTY_MODEL',
] as const;

export interface SchoolModelOption {
  id: string;
  label: string;
  shortName: string;
}

export interface DifficultyResolution {
  level: AcademicDifficultyLevel;
  source: 'explicit_level' | 'legacy_difficulty' | 'fallback';
}

export type GatewayModelAvailabilityResult =
  | {
      ok: true;
      model: string;
      skipped?: boolean;
      modelIds?: string[];
    }
  | {
      ok: false;
      code: string;
      reason: GatewayModelCheckReason;
      status: number;
      message: string;
    };

const UNCONFIRMED_MODEL_PLACEHOLDERS = new Set(['55sonnet', 'sonnet-tbd', 'tbd']);

/**
 * Reads an explicitly confirmed Sonnet model ID from environment variables,
 * falling back to `DEFAULT_SONNET_SCHOOL_MODEL` (`claude-sonnet-5-5`).
 * Rejects unconfirmed placeholders such as `55sonnet`.
 */
export function resolveConfiguredSonnetModel(
  env: Record<string, string | undefined> = process.env
): string {
  for (const key of SONNET_MODEL_ENV_KEYS) {
    const raw = (env[key] || '').trim();
    if (!raw) continue;
    if (UNCONFIRMED_MODEL_PLACEHOLDERS.has(raw.toLowerCase())) continue;
    return raw;
  }
  return DEFAULT_SONNET_SCHOOL_MODEL;
}

export const resolveConfiguredHighDifficultyModel = resolveConfiguredSonnetModel;

export function getAllowedSchoolModels(
  env: Record<string, string | undefined> = process.env
): string[] {
  const sonnet = resolveConfiguredSonnetModel(env);
  return sonnet === DEFAULT_SCHOOL_MODEL ? [DEFAULT_SCHOOL_MODEL] : [DEFAULT_SCHOOL_MODEL, sonnet];
}

export function getSchoolModelOptions(
  env: Record<string, string | undefined> = process.env
): SchoolModelOption[] {
  const sonnet = resolveConfiguredSonnetModel(env);
  const options: SchoolModelOption[] = [
    {
      id: DEFAULT_SCHOOL_MODEL,
      shortName: 'DeepSeek',
      label: `DeepSeek (${DEFAULT_SCHOOL_MODEL})`,
    },
  ];
  if (sonnet !== DEFAULT_SCHOOL_MODEL) {
    options.push({
      id: sonnet,
      shortName: 'Sonnet',
      label: `Sonnet (${sonnet})`,
    });
  }
  return options;
}

export function isDeepSeekModel(modelId: string): boolean {
  return (modelId || '').trim().toLowerCase().includes('deepseek');
}

export function validateRequestedModelInput(
  raw: unknown
):
  | { ok: true; model?: string }
  | { ok: false; code: 'INVALID_MODEL_SELECTION'; status: 400; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, model: undefined };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'INVALID_MODEL_SELECTION',
      status: 400,
      message: '요청한 AI 모델 형식이 올바르지 않습니다.',
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, model: undefined };
  }
  if (
    trimmed.length > 128 ||
    /[\r\n\t]/.test(trimmed) ||
    trimmed.includes('://') ||
    UNCONFIRMED_MODEL_PLACEHOLDERS.has(trimmed.toLowerCase())
  ) {
    return {
      ok: false,
      code: 'INVALID_MODEL_SELECTION',
      status: 400,
      message: '허용되지 않는 AI 모델 이름입니다.',
    };
  }
  return { ok: true, model: trimmed };
}

function computeApiKeyFingerprint(rawKey: string | undefined): string | undefined {
  if (!rawKey) return undefined;
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

function extractLookupKeyFingerprint(lookup: ConnectionLookup, env: Record<string, string | undefined>): string | undefined {
  if (lookup.status !== 'registered') return undefined;
  const secret = lookup.secret as { ciphertext?: string; iv?: string; tag?: string; apiKey?: string };
  if (typeof secret.apiKey === 'string' && secret.apiKey) {
    return computeApiKeyFingerprint(secret.apiKey);
  }
  if (secret.ciphertext && secret.iv && secret.tag) {
    try {
      const encKey = getEncryptionKey(env);
      if (!encKey) return undefined;
      return computeApiKeyFingerprint(
        decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, tag: secret.tag }, encKey)
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export type EffectiveModelResolutionSuccess = {
  ok: true;
  provider: string;
  effectiveModel: string;
  defaultModel: string;
  requestedModel?: string;
  expectedSource: 'user' | 'operator';
  expectedKeyFingerprint?: string;
  lookup: ConnectionLookup;
};

export type EffectiveModelResolution =
  | EffectiveModelResolutionSuccess
  | {
      ok: false;
      code: string;
      status: number;
      message: string;
    };

/**
 * Resolves the effective AI model for a request BEFORE task registration /
 * inputIdentifier calculation so different models produce isolated taskIds.
 *
 * Priority:
 *  1. Validated explicit `requestedModel`
 *  2. User's saved `ai_connections.model`
 *  3. Operator's configured default model
 *  4. `DEFAULT_SCHOOL_MODEL` (`deepseek-v4.1-flash`)
 */
export async function resolveEffectiveModelForRequest(params: {
  userId: string;
  requestedModel?: unknown;
  lookupFn?: (userId?: string) => Promise<ConnectionLookup>;
  env?: Record<string, string | undefined>;
}): Promise<EffectiveModelResolution> {
  const env = params.env ?? process.env;
  const validated = validateRequestedModelInput(params.requestedModel);
  if (!validated.ok) {
    return validated;
  }
  const requestedModel = validated.model;

  const lookupFn = params.lookupFn ?? lookupConnectionSecret;
  const lookup = await lookupFn(params.userId);
  if (lookup.status === 'lookup_failed') {
    return {
      ok: false,
      code: 'LOOKUP_FAILED',
      status: 502,
      message: 'AI API 연결 정보를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  let provider: string;
  let defaultModel: string;
  const expectedSource: 'user' | 'operator' = lookup.status === 'registered' ? 'user' : 'operator';
  const expectedKeyFingerprint = extractLookupKeyFingerprint(lookup, env);

  if (lookup.status === 'registered') {
    provider = (lookup.secret.provider || '').trim() || SCHOOL_GATEWAY_PROVIDER;
    defaultModel = (lookup.secret.model || '').trim() || DEFAULT_SCHOOL_MODEL;
  } else {
    const opConfig = resolveOperatorAiConfig(env);
    provider = opConfig?.provider || SCHOOL_GATEWAY_PROVIDER;
    defaultModel = (opConfig?.model || '').trim() || DEFAULT_SCHOOL_MODEL;
  }

  if (requestedModel) {
    if (provider !== SCHOOL_GATEWAY_PROVIDER) {
      if (requestedModel !== defaultModel) {
        return {
          ok: false,
          code: 'MODEL_SELECTION_NOT_SUPPORTED_FOR_PROVIDER',
          status: 400,
          message: `현재 비학교 AI 제공자(${provider})가 설정되어 있어 학교 BAZE 모델('${requestedModel}')을 선택할 수 없습니다.`,
        };
      }
      return {
        ok: true,
        provider,
        effectiveModel: defaultModel,
        defaultModel,
        requestedModel,
        expectedSource,
        expectedKeyFingerprint,
        lookup,
      };
    }

    const allowed = getAllowedSchoolModels(env);
    if (!allowed.includes(requestedModel) && requestedModel !== defaultModel) {
      return {
        ok: false,
        code: 'INVALID_MODEL_SELECTION',
        status: 400,
        message: `허용되지 않은 학교 BAZE 모델입니다: '${requestedModel}'. (선택 가능: ${allowed.join(', ')})`,
      };
    }

    return {
      ok: true,
      provider,
      effectiveModel: requestedModel,
      defaultModel,
      requestedModel,
      expectedSource,
      expectedKeyFingerprint,
      lookup,
    };
  }

  return {
    ok: true,
    provider,
    effectiveModel: defaultModel,
    defaultModel,
    expectedSource,
    expectedKeyFingerprint,
    lookup,
  };
}

export type ManualModelSelectionResult =
  | { ok: true; config: AiConfig }
  | { ok: false; code: string; status: number; message: string };

/**
 * Applies a validated manual model selection onto `baseConfig` without
 * copying DeepSeek-specific `minOutputTokens`/`jsonMode` options to Sonnet.
 */
export function selectAiConfigForManualModel(options: {
  baseConfig: AiConfig;
  requestedModel?: string | null;
  allowedExtraModel?: string | null;
  env?: Record<string, string | undefined>;
}): ManualModelSelectionResult {
  const { baseConfig, requestedModel, allowedExtraModel, env = process.env } = options;
  const validated = validateRequestedModelInput(requestedModel);
  if (!validated.ok) {
    return validated;
  }
  const explicit = validated.model;

  if (baseConfig.provider !== SCHOOL_GATEWAY_PROVIDER) {
    if (explicit && explicit !== baseConfig.model) {
      return {
        ok: false,
        code: 'MODEL_SELECTION_NOT_SUPPORTED_FOR_PROVIDER',
        status: 400,
        message: `현재 비학교 AI 제공자(${baseConfig.provider})가 설정되어 있어 학교 BAZE 모델('${explicit}')을 선택할 수 없습니다.`,
      };
    }
    return { ok: true, config: baseConfig };
  }

  let targetModel: string;
  if (explicit) {
    const allowed = getAllowedSchoolModels(env);
    const savedBaseModel = (baseConfig.model || '').trim();
    const extraModel = (allowedExtraModel || '').trim();
    if (!allowed.includes(explicit) && explicit !== savedBaseModel && explicit !== extraModel) {
      return {
        ok: false,
        code: 'INVALID_MODEL_SELECTION',
        status: 400,
        message: `허용되지 않은 학교 BAZE 모델입니다: '${explicit}'. (선택 가능: ${allowed.join(', ')})`,
      };
    }
    targetModel = explicit;
  } else {
    targetModel = (baseConfig.model || '').trim() || DEFAULT_SCHOOL_MODEL;
  }

  if (isDeepSeekModel(targetModel)) {
    const minRaw = Number(env.BAZE_MIN_OUTPUT_TOKENS);
    const deepSeekMin =
      baseConfig.minOutputTokens > 0
        ? baseConfig.minOutputTokens
        : Number.isFinite(minRaw) && minRaw > 0
        ? minRaw
        : 16000;
    const deepSeekJson =
      baseConfig.jsonMode === 'json_object' || env.BAZE_JSON_MODE === 'json_object'
        ? 'json_object'
        : 'none';
    return {
      ok: true,
      config: {
        ...baseConfig,
        model: targetModel,
        minOutputTokens: deepSeekMin,
        jsonMode: deepSeekJson,
      },
    };
  }

  // Sonnet and other non-DeepSeek models must NOT inherit DeepSeek's 16000 minOutputTokens or jsonMode.
  return {
    ok: true,
    config: {
      ...baseConfig,
      model: targetModel,
      minOutputTokens: 0,
      jsonMode: 'none',
    },
  };
}

/**
 * Selects the AiConfig for the user's chosen/default model and, for
 * `school_gateway`, verifies via read-only `GET /models/?type=llm` that the
 * target model is enabled for the key without falling back to another model.
 */
export async function resolveAndVerifyManualModelConfig(params: {
  baseConfig: AiConfig;
  requestedModel?: unknown;
  pinnedResolution?: EffectiveModelResolutionSuccess;
  credSource?: 'user' | 'operator';
  env?: Record<string, string | undefined>;
  verifyFn?: (apiKey: string, apiBase: string, model: string) => Promise<GatewayModelCheck>;
}): Promise<ManualModelSelectionResult> {
  const { pinnedResolution, credSource } = params;
  let effectiveRequestedModel = params.requestedModel;

  if (pinnedResolution) {
    if (credSource && credSource !== pinnedResolution.expectedSource) {
      return {
        ok: false,
        code: 'AI_CONNECTION_CHANGED_CONFLICT',
        status: 409,
        message: '요청 처리 중 AI 연결 상태(개인 키/체험 모드)가 변경되었습니다. 최신 설정으로 다시 시도해 주세요.',
      };
    }
    if (params.baseConfig.provider !== pinnedResolution.provider) {
      return {
        ok: false,
        code: 'AI_CONNECTION_CHANGED_CONFLICT',
        status: 409,
        message: '요청 처리 중 AI 제공자가 변경되었습니다. 최신 설정으로 다시 시도해 주세요.',
      };
    }
    if (
      pinnedResolution.expectedSource === 'user' &&
      pinnedResolution.expectedKeyFingerprint !== undefined &&
      computeApiKeyFingerprint(params.baseConfig.apiKey) !== pinnedResolution.expectedKeyFingerprint
    ) {
      return {
        ok: false,
        code: 'AI_CONNECTION_CHANGED_CONFLICT',
        status: 409,
        message: '요청 처리 중 API 키가 변경되었습니다. 기존 키와 혼용하지 않기 위해 요청을 중단했습니다. 다시 시도해 주세요.',
      };
    }
    if (
      pinnedResolution.provider !== SCHOOL_GATEWAY_PROVIDER &&
      params.baseConfig.model !== pinnedResolution.effectiveModel
    ) {
      return {
        ok: false,
        code: 'AI_CONNECTION_CHANGED_CONFLICT',
        status: 409,
        message: '요청 처리 중 기본 AI 모델이 변경되었습니다. 최신 설정으로 다시 시도해 주세요.',
      };
    }
    // Pin to the exact model hashed into inputIdentifier/taskId even if default model changed mid-flight.
    effectiveRequestedModel = pinnedResolution.effectiveModel;
  }

  const validated = validateRequestedModelInput(effectiveRequestedModel);
  if (!validated.ok) {
    return validated;
  }

  const selection = selectAiConfigForManualModel({
    baseConfig: params.baseConfig,
    requestedModel: validated.model,
    allowedExtraModel: pinnedResolution?.defaultModel,
    env: params.env,
  });
  if (!selection.ok) {
    return selection;
  }

  if (selection.config.provider === SCHOOL_GATEWAY_PROVIDER) {
    const avail = await verifySelectedModelOnGateway(selection.config, params.verifyFn);
    if (!avail.ok) {
      return {
        ok: false,
        code: avail.code,
        status: avail.status,
        message: avail.message,
      };
    }
  }

  return { ok: true, config: selection.config };
}

/**
 * Resolves `AcademicDifficultyLevel` (1~5) from explicit numeric level or
 * legacy difficulty string without losing the Level 3/4 boundary.
 */
export function resolveDifficultyLevelFromInput(input: {
  difficultyLevel?: unknown;
  difficulty?: unknown;
  fallbackLevel?: AcademicDifficultyLevel;
}): DifficultyResolution {
  const { difficultyLevel, difficulty, fallbackLevel = 3 } = input;

  if (
    typeof difficultyLevel === 'number' &&
    Number.isFinite(difficultyLevel)
  ) {
    return {
      level: toAcademicDifficultyLevel(difficultyLevel),
      source: 'explicit_level',
    };
  }

  if (typeof difficultyLevel === 'string' && difficultyLevel.trim() !== '') {
    const trimmed = difficultyLevel.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return {
        level: toAcademicDifficultyLevel(Number(trimmed)),
        source: 'explicit_level',
      };
    }
    return {
      level: toAcademicDifficultyLevel(trimmed),
      source: 'legacy_difficulty',
    };
  }

  if (typeof difficulty === 'string' && difficulty.trim() !== '') {
    return {
      level: toAcademicDifficultyLevel(difficulty),
      source: 'legacy_difficulty',
    };
  }

  return {
    level: fallbackLevel,
    source: 'fallback',
  };
}

/**
 * Extracts authoritative problem difficulty from a server-verified problem row,
 * snapshot, or frozen mock-exam item.
 */
export function extractAuthoritativeProblemDifficulty(
  source: Record<string, unknown> | null | undefined,
  fallbackLevel: AcademicDifficultyLevel = 3
): DifficultyResolution {
  if (!source) {
    return { level: fallbackLevel, source: 'fallback' };
  }
  return resolveDifficultyLevelFromInput({
    difficultyLevel: source.difficultyLevel ?? source.difficulty_level,
    difficulty: source.difficulty,
    fallbackLevel,
  });
}

/**
 * Verifies that the selected model is actually enabled on the school BAZE
 * Gateway for the given AiConfig (user key or operator key) using the
 * read-only `GET /models/?type=llm` metadata endpoint (no paid generation).
 * Never falls back to another model on failure or missing model.
 */
export async function verifySelectedModelOnGateway(
  config: AiConfig,
  verifyFn: (apiKey: string, apiBase: string, model: string) => Promise<GatewayModelCheck> = verifyGatewayModelForKey
): Promise<GatewayModelAvailabilityResult> {
  if (config.provider !== SCHOOL_GATEWAY_PROVIDER) {
    return { ok: true, model: config.model, skipped: true };
  }

  const check = await verifyFn(config.apiKey, config.apiBase, config.model);
  if (!check.ok) {
    return {
      ok: false,
      code: reasonToCode(check.reason),
      reason: check.reason,
      status: connectionCheckHttpStatus(check.reason),
      message: check.message,
    };
  }

  if (!check.hasModel) {
    return {
      ok: false,
      code: 'MODEL_NOT_AVAILABLE',
      reason: 'not_found',
      status: 400,
      message: `모델 '${config.model}'이(가) 현재 BAZE API 키에서 지원되지 않습니다. 다른 유료 모델로 자동 전환하지 않습니다.`,
    };
  }

  return {
    ok: true,
    model: config.model,
    modelIds: check.modelIds,
  };
}

export type DbProblemDifficultyLookup =
  | { ok: true; found: true; difficultyLevel: AcademicDifficultyLevel }
  | { ok: true; found: false }
  | { ok: false; status: number; error: string };

/**
 * Looks up a problem's authoritative difficulty from `problems` when a
 * `problemId` is supplied, enforcing ownership/demo access (rejecting
 * `user_id === null` when `is_demo` is false, and rejecting unfound IDs
 * unless `isProvisionalLocal === true`).
 */
export async function lookupAuthoritativeProblemDifficultyById(
  supabase: { from?: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> } } } } | null | undefined,
  userId: string,
  problemId?: string | null,
  options?: { isProvisionalLocal?: boolean }
): Promise<DbProblemDifficultyLookup> {
  const id = typeof problemId === 'string' ? problemId.trim() : '';
  if (!id) return { ok: true, found: false };

  if (!supabase || typeof supabase.from !== 'function') {
    return {
      ok: false,
      status: 500,
      error: 'DB 조회 인터페이스를 사용할 수 없어 문제 난이도를 검증할 수 없습니다.',
    };
  }

  let data: unknown;
  let error: { message?: string } | null = null;
  try {
    const res = await supabase
      .from('problems')
      .select('id, user_id, is_demo, payload')
      .eq('id', id)
      .maybeSingle();
    data = res?.data;
    error = res?.error ?? null;
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: `문제 난이도 조회 중 오류가 발생했습니다: ${err instanceof Error ? err.message : 'DB 오류'}.`,
    };
  }

  if (error) {
    return {
      ok: false,
      status: 500,
      error: `문제 난이도 조회 실패: ${error.message || 'DB 오류'}.`,
    };
  }

  if (!data || typeof data !== 'object') {
    if (options?.isProvisionalLocal === true) {
      return { ok: true, found: false };
    }
    return {
      ok: false,
      status: 404,
      error: '해당 문제를 찾을 수 없거나 접근 권한이 없습니다.',
    };
  }

  const row = data as { user_id?: string | null; is_demo?: boolean | null; payload?: Record<string, unknown> | null };
  const isAllowed =
    Boolean(row.is_demo) ||
    (typeof row.user_id === 'string' && row.user_id.length > 0 && row.user_id === userId);
  if (!isAllowed) {
    return {
      ok: false,
      status: 404,
      error: '해당 문제에 대한 접근 권한이 없거나 다른 사용자의 문제입니다.',
    };
  }

  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  const resolved = extractAuthoritativeProblemDifficulty(payload, 3);
  return { ok: true, found: true, difficultyLevel: resolved.level };
}

export async function resolveProblemDifficultyForRoute(params: {
  createClientFn: () => Promise<Parameters<typeof lookupAuthoritativeProblemDifficultyById>[0]>;
  userId: string;
  problemId?: string | null;
  isProvisionalLocal?: boolean;
  fallbackDifficultyLevel?: unknown;
  fallbackDifficulty?: unknown;
}): Promise<{ ok: true; difficultyLevel: AcademicDifficultyLevel } | { ok: false; status: number; error: string }> {
  const fallbackLevel = resolveDifficultyLevelFromInput({
    difficultyLevel: params.fallbackDifficultyLevel,
    difficulty: params.fallbackDifficulty,
    fallbackLevel: 3,
  }).level;

  const id = typeof params.problemId === 'string' ? params.problemId.trim() : '';
  if (!id) {
    return { ok: true, difficultyLevel: fallbackLevel };
  }

  let supabase: Parameters<typeof lookupAuthoritativeProblemDifficultyById>[0];
  try {
    supabase = await params.createClientFn();
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: `DB 연결을 초기화하지 못했습니다: ${err instanceof Error ? err.message : 'DB 오류'}.`,
    };
  }

  const dbDiff = await lookupAuthoritativeProblemDifficultyById(supabase, params.userId, id, {
    isProvisionalLocal: params.isProvisionalLocal,
  });
  if (!dbDiff.ok) {
    const errRes = dbDiff as { ok: false; status: number; error: string };
    return { ok: false, status: errRes.status, error: errRes.error };
  }
  if (dbDiff.found) {
    return { ok: true, difficultyLevel: dbDiff.difficultyLevel };
  }
  return { ok: true, difficultyLevel: fallbackLevel };
}
