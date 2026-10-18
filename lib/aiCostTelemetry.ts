import { createAdminClient, hasAdminClientConfig } from './supabase/admin';

/**
 * AI Operating Cost & Usage Telemetry Module (Plan 05 - P05-05 & P05-07)
 *
 * Provides:
 * 1. Authoritative pricing tables per model with effective dates and currencies.
 * 2. Deterministic cost calculations (USD and KRW) with actual vs estimated token flags.
 * 3. Server-side recording of all AI calls with user isolation and error tracking.
 * 4. Operator analytics: daily requests, costs, token consumption, failure rates,
 *    operator trial vs personal key consumption, and anomaly detection.
 */

export interface ModelPricing {
  model: string;
  provider: string;
  effectiveDate: string;
  currency: 'USD';
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
  notes?: string;
}

/** Estimated operational exchange rate (1 USD = 1,400 KRW). Explicitly labeled as estimate. */
export const ESTIMATED_KRW_PER_USD = 1400;

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  'deepseek-v4.1-flash': {
    model: 'deepseek-v4.1-flash',
    provider: 'school_gateway',
    effectiveDate: '2026-01-01',
    currency: 'USD',
    costPerMillionInputTokens: 0.14,
    costPerMillionOutputTokens: 0.28,
    notes: 'School BAZE AI Gateway DeepSeek Flash default academic pricing',
  },
  'deepseek-chat': {
    model: 'deepseek-chat',
    provider: 'deepseek',
    effectiveDate: '2026-01-01',
    currency: 'USD',
    costPerMillionInputTokens: 0.14,
    costPerMillionOutputTokens: 0.28,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    provider: 'openai',
    effectiveDate: '2026-01-01',
    currency: 'USD',
    costPerMillionInputTokens: 0.15,
    costPerMillionOutputTokens: 0.60,
  },
  'gpt-4o': {
    model: 'gpt-4o',
    provider: 'openai',
    effectiveDate: '2026-01-01',
    currency: 'USD',
    costPerMillionInputTokens: 2.50,
    costPerMillionOutputTokens: 10.00,
  },
  'gemini-1.5-flash': {
    model: 'gemini-1.5-flash',
    provider: 'google',
    effectiveDate: '2026-01-01',
    currency: 'USD',
    costPerMillionInputTokens: 0.075,
    costPerMillionOutputTokens: 0.30,
  },
};

export const DEFAULT_FALLBACK_PRICING: ModelPricing = {
  model: 'unknown',
  provider: 'unknown',
  effectiveDate: '2026-01-01',
  currency: 'USD',
  costPerMillionInputTokens: 0.15,
  costPerMillionOutputTokens: 0.60,
  notes: 'Fallback pricing applied for unlisted model',
};

export interface CostCalculationResult {
  estimatedCostUsd: number;
  estimatedCostKrw: number;
  pricingModelFound: boolean;
  currency: 'USD';
  effectiveDate: string;
}

/**
 * Calculates estimated AI API cost from input/output tokens.
 * Prioritizes exact model match, falls back to normalized prefix match, then default pricing.
 */
export function calculateAiCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): CostCalculationResult {
  const normModel = (model || '').trim().toLowerCase();
  let pricing = MODEL_PRICING_TABLE[normModel];

  if (!pricing) {
    const matchingKey = Object.keys(MODEL_PRICING_TABLE).find((k) => normModel.includes(k));
    pricing = matchingKey ? MODEL_PRICING_TABLE[matchingKey] : DEFAULT_FALLBACK_PRICING;
  }

  const safeInput = Math.max(0, inputTokens || 0);
  const safeOutput = Math.max(0, outputTokens || 0);

  const inputCost = (safeInput / 1_000_000) * pricing.costPerMillionInputTokens;
  const outputCost = (safeOutput / 1_000_000) * pricing.costPerMillionOutputTokens;
  const totalUsd = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  const totalKrw = Math.round(totalUsd * ESTIMATED_KRW_PER_USD * 100) / 100;

  return {
    estimatedCostUsd: totalUsd,
    estimatedCostKrw: totalKrw,
    pricingModelFound: pricing !== DEFAULT_FALLBACK_PRICING,
    currency: 'USD',
    effectiveDate: pricing.effectiveDate,
  };
}

/**
 * Fallback token estimation when provider API does not return usage stats.
 * Uses ~1.5 characters per token for mixed Korean/English/math content.
 */
export function estimateTokenCount(text?: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.ceil(trimmed.length / 1.5);
}

export type AiTaskType =
  | 'analyze_concepts'
  | 'generate_problems'
  | 'evaluate_answer'
  | 'transfer_problem'
  | 'logic_questions'
  | 'review_problem_quality'
  | 'unknown';

export type AiCreditSource = 'operator_trial' | 'personal_key';

export type AiTelemetryStatus = 'success' | 'error' | 'timeout' | 'truncated' | 'rate_limited';

export interface AiUsageTelemetryRecord {
  id: string;
  requestId: string;
  userId: string;
  taskType: AiTaskType | string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  isEstimatedTokens: boolean;
  estimatedCostUsd: number;
  estimatedCostKrw: number;
  actualCostUsd?: number;
  executionTimeMs: number;
  status: AiTelemetryStatus;
  errorCode?: string;
  creditSource: AiCreditSource;
  createdAt: string;
}

export interface RecordTelemetryInput {
  requestId?: string;
  userId: string;
  taskType: AiTaskType | string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  inputText?: string;
  outputText?: string;
  executionTimeMs: number;
  status: AiTelemetryStatus;
  errorCode?: string;
  creditSource: AiCreditSource;
  actualCostUsd?: number;
}

// Bounded in-memory store for serverless execution runtime telemetry
const MAX_IN_MEMORY_RECORDS = 1000;
let inMemoryTelemetryRecords: AiUsageTelemetryRecord[] = [];

/**
 * Records an AI usage event into the in-memory telemetry buffer and attempts
 * persistent DB write if Supabase admin credentials are configured.
 * Never throws an unhandled error that would fail the user request.
 */
export async function recordAiUsageTelemetry(input: RecordTelemetryInput): Promise<AiUsageTelemetryRecord> {
  const isEstimated = input.inputTokens === undefined || input.outputTokens === undefined;
  const inputTokens = input.inputTokens ?? estimateTokenCount(input.inputText);
  const outputTokens = input.outputTokens ?? estimateTokenCount(input.outputText);
  const totalTokens = inputTokens + outputTokens;

  const cost = calculateAiCost(input.model, inputTokens, outputTokens);
  const recordId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `telemetry_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const record: AiUsageTelemetryRecord = {
    id: recordId,
    requestId: input.requestId || recordId,
    userId: input.userId || 'anonymous',
    taskType: input.taskType || 'unknown',
    provider: input.provider || 'school_gateway',
    model: input.model || 'deepseek-v4.1-flash',
    inputTokens,
    outputTokens,
    totalTokens,
    isEstimatedTokens: isEstimated,
    estimatedCostUsd: cost.estimatedCostUsd,
    estimatedCostKrw: cost.estimatedCostKrw,
    actualCostUsd: input.actualCostUsd,
    executionTimeMs: Math.max(0, input.executionTimeMs || 0),
    status: input.status,
    errorCode: input.errorCode,
    creditSource: input.creditSource,
    createdAt: new Date().toISOString(),
  };

  // 1. In-memory append (bounded)
  inMemoryTelemetryRecords.push(record);
  if (inMemoryTelemetryRecords.length > MAX_IN_MEMORY_RECORDS) {
    inMemoryTelemetryRecords = inMemoryTelemetryRecords.slice(-MAX_IN_MEMORY_RECORDS);
  }

  // 2. Best-effort DB persistence via admin client
  if (hasAdminClientConfig()) {
    try {
      const admin = createAdminClient();
      await admin.from('ai_usage_telemetry').insert({
        id: record.id,
        request_id: record.requestId,
        user_id: record.userId,
        task_type: record.taskType,
        provider: record.provider,
        model: record.model,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        total_tokens: record.totalTokens,
        is_estimated_tokens: record.isEstimatedTokens,
        estimated_cost_usd: record.estimatedCostUsd,
        estimated_cost_krw: record.estimatedCostKrw,
        execution_time_ms: record.executionTimeMs,
        status: record.status,
        error_code: record.errorCode || null,
        credit_source: record.creditSource,
        created_at: record.createdAt,
      });
    } catch {
      // Telemetry persistence failure must never fail the underlying learning feature.
    }
  }

  return record;
}

export interface TelemetryFilter {
  startDate?: string;
  endDate?: string;
  userId?: string;
  taskType?: string;
  creditSource?: AiCreditSource;
}

export interface DailyAiMetric {
  date: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
  costKrw: number;
}

export interface AiUsageAnomaly {
  userId: string;
  reason: string;
  requestCount: number;
  totalTokens: number;
  period: string;
}

export interface AiUsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failureRatePercent: number;
  requestsByTask: Record<string, number>;
  tokensByModel: Record<string, { input: number; output: number; total: number }>;
  costByModel: Record<string, { usd: number; krw: number }>;
  totalCostUsd: number;
  totalCostKrw: number;
  operatorTrialConsumption: {
    requests: number;
    tokens: number;
    estimatedCostUsd: number;
    estimatedCostKrw: number;
  };
  personalKeyConsumption: {
    requests: number;
    tokens: number;
    estimatedCostUsd: number;
    estimatedCostKrw: number;
  };
  dailyMetrics: DailyAiMetric[];
  anomalies: AiUsageAnomaly[];
}

/**
 * Aggregates usage metrics from in-memory records (or passed records).
 */
export function getAiUsageSummary(
  filter?: TelemetryFilter,
  records: AiUsageTelemetryRecord[] = inMemoryTelemetryRecords
): AiUsageSummary {
  let filtered = [...records];

  if (filter?.userId) {
    filtered = filtered.filter((r) => r.userId === filter.userId);
  }
  if (filter?.taskType) {
    filtered = filtered.filter((r) => r.taskType === filter.taskType);
  }
  if (filter?.creditSource) {
    filtered = filtered.filter((r) => r.creditSource === filter.creditSource);
  }
  if (filter?.startDate) {
    const startMs = new Date(filter.startDate).getTime();
    filtered = filtered.filter((r) => new Date(r.createdAt).getTime() >= startMs);
  }
  if (filter?.endDate) {
    const endMs = new Date(filter.endDate).getTime();
    filtered = filtered.filter((r) => new Date(r.createdAt).getTime() <= endMs);
  }

  const totalRequests = filtered.length;
  let successfulRequests = 0;
  let failedRequests = 0;
  let totalCostUsd = 0;
  let totalCostKrw = 0;

  const requestsByTask: Record<string, number> = {};
  const tokensByModel: Record<string, { input: number; output: number; total: number }> = {};
  const costByModel: Record<string, { usd: number; krw: number }> = {};

  const operatorTrialConsumption = {
    requests: 0,
    tokens: 0,
    estimatedCostUsd: 0,
    estimatedCostKrw: 0,
  };

  const personalKeyConsumption = {
    requests: 0,
    tokens: 0,
    estimatedCostUsd: 0,
    estimatedCostKrw: 0,
  };

  const dailyMap = new Map<string, { requests: number; totalTokens: number; costUsd: number; costKrw: number }>();
  const userRequestMap = new Map<string, { count: number; tokens: number }>();

  for (const r of filtered) {
    if (r.status === 'success') {
      successfulRequests += 1;
    } else {
      failedRequests += 1;
    }

    totalCostUsd += r.estimatedCostUsd;
    totalCostKrw += r.estimatedCostKrw;

    // Requests by task
    requestsByTask[r.taskType] = (requestsByTask[r.taskType] || 0) + 1;

    // Tokens by model
    if (!tokensByModel[r.model]) {
      tokensByModel[r.model] = { input: 0, output: 0, total: 0 };
    }
    tokensByModel[r.model].input += r.inputTokens;
    tokensByModel[r.model].output += r.outputTokens;
    tokensByModel[r.model].total += r.totalTokens;

    // Cost by model
    if (!costByModel[r.model]) {
      costByModel[r.model] = { usd: 0, krw: 0 };
    }
    costByModel[r.model].usd = Math.round((costByModel[r.model].usd + r.estimatedCostUsd) * 1_000_000) / 1_000_000;
    costByModel[r.model].krw = Math.round((costByModel[r.model].krw + r.estimatedCostKrw) * 100) / 100;

    // Credit source consumption
    if (r.creditSource === 'operator_trial') {
      operatorTrialConsumption.requests += 1;
      operatorTrialConsumption.tokens += r.totalTokens;
      operatorTrialConsumption.estimatedCostUsd += r.estimatedCostUsd;
      operatorTrialConsumption.estimatedCostKrw += r.estimatedCostKrw;
    } else {
      personalKeyConsumption.requests += 1;
      personalKeyConsumption.tokens += r.totalTokens;
      personalKeyConsumption.estimatedCostUsd += r.estimatedCostUsd;
      personalKeyConsumption.estimatedCostKrw += r.estimatedCostKrw;
    }

    // Daily metric
    const dateKey = r.createdAt.substring(0, 10);
    const day = dailyMap.get(dateKey) || { requests: 0, totalTokens: 0, costUsd: 0, costKrw: 0 };
    day.requests += 1;
    day.totalTokens += r.totalTokens;
    day.costUsd += r.estimatedCostUsd;
    day.costKrw += r.estimatedCostKrw;
    dailyMap.set(dateKey, day);

    // User aggregation for anomaly detection
    const u = userRequestMap.get(r.userId) || { count: 0, tokens: 0 };
    u.count += 1;
    u.tokens += r.totalTokens;
    userRequestMap.set(r.userId, u);
  }

  // Format daily metrics sorted by date
  const dailyMetrics: DailyAiMetric[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      requests: d.requests,
      totalTokens: d.totalTokens,
      costUsd: Math.round(d.costUsd * 1_000_000) / 1_000_000,
      costKrw: Math.round(d.costKrw * 100) / 100,
    }));

  // Detect abnormal patterns (e.g., > 100 requests or > 500k tokens per user in sample)
  const anomalies: AiUsageAnomaly[] = [];
  for (const [userId, u] of userRequestMap.entries()) {
    if (u.count > 100) {
      anomalies.push({
        userId,
        reason: '단기간 비정상 대량 요청 감지 (요청 100건 초과)',
        requestCount: u.count,
        totalTokens: u.tokens,
        period: 'recorded_window',
      });
    } else if (u.tokens > 500_000) {
      anomalies.push({
        userId,
        reason: '비정상 대용량 토큰 소비 감지 (50만 토큰 초과)',
        requestCount: u.count,
        totalTokens: u.tokens,
        period: 'recorded_window',
      });
    }
  }

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    failureRatePercent: totalRequests > 0 ? Math.round((failedRequests / totalRequests) * 10000) / 100 : 0,
    requestsByTask,
    tokensByModel,
    costByModel,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    totalCostKrw: Math.round(totalCostKrw * 100) / 100,
    operatorTrialConsumption: {
      requests: operatorTrialConsumption.requests,
      tokens: operatorTrialConsumption.tokens,
      estimatedCostUsd: Math.round(operatorTrialConsumption.estimatedCostUsd * 1_000_000) / 1_000_000,
      estimatedCostKrw: Math.round(operatorTrialConsumption.estimatedCostKrw * 100) / 100,
    },
    personalKeyConsumption: {
      requests: personalKeyConsumption.requests,
      tokens: personalKeyConsumption.tokens,
      estimatedCostUsd: Math.round(personalKeyConsumption.estimatedCostUsd * 1_000_000) / 1_000_000,
      estimatedCostKrw: Math.round(personalKeyConsumption.estimatedCostKrw * 100) / 100,
    },
    dailyMetrics,
    anomalies,
  };
}

/** Clears in-memory telemetry records (for test isolation and test suite teardown). */
export function clearTelemetryStore(): void {
  inMemoryTelemetryRecords = [];
}

/** Returns read-only slice of in-memory telemetry records. */
export function getInMemoryTelemetryRecords(): readonly AiUsageTelemetryRecord[] {
  return inMemoryTelemetryRecords;
}
