import { AI_CONFIG, isAiConfigured, type AiConfig } from './aiConfig';

/**
 * Shared SERVER-side AI chat client. All API routes call models through this
 * module so provider selection, auth headers, request options, retries, output
 * budgets and error classification stay in one place.
 *
 * The API key is only ever sent in a request header and is never returned to
 * the browser or written to logs in clear text.
 */

export type AiErrorCode =
  | 'unconfigured'
  | 'bad_request'
  | 'auth'
  | 'credit'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'provider'
  | 'timeout'
  | 'network'
  | 'empty'
  | 'truncated'
  | 'invalid_json';

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiChatError {
  code: AiErrorCode;
  message: string;
  status?: number;
}

export type AiChatResult =
  | { ok: true; content: string; model: string; usage?: AiUsage }
  | { ok: false; error: AiChatError };

export interface AiChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Request a JSON response format where the provider supports it. */
  json?: boolean;
  timeoutMs?: number;
  /** Short task label used only for sanitized usage logging. */
  label?: string;
}

const USER_AGENT = 'LearnAway/1.0';
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 45000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The Gateway chat endpoint needs a trailing slash; other providers do not. */
export function buildChatEndpoint(provider = AI_CONFIG.provider, apiBase = AI_CONFIG.apiBase): string {
  const base = apiBase.replace(/\/+$/, '');
  return provider === 'school_gateway' ? `${base}/chat/completions/` : `${base}/chat/completions`;
}

export function buildModelsEndpoint(apiBase = AI_CONFIG.apiBase): string {
  return `${apiBase.replace(/\/+$/, '')}/models/?type=llm`;
}

/** Remove anything resembling the API key / bearer token from a string. */
export function sanitizeAiText(raw: string, apiKey: string = AI_CONFIG.apiKey): string {
  let out = (raw || '').slice(0, 600);
  if (apiKey) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
  out = out.replace(/"?(api[_-]?key|authorization|token)"?\s*[:=]\s*"[^"]*"/gi, '$1: "[redacted]"');
  return out;
}

function buildRequestBody(options: AiChatOptions, config: AiConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;

  // Manage output budget per task. Reasoning models (school gateway) need a
  // larger budget or the provider returns an empty/truncated answer.
  const requested = options.maxOutputTokens ?? 0;
  const budget = Math.max(requested, config.minOutputTokens || 0);
  if (budget > 0) body.max_tokens = budget;

  // Structured output. Unverified providers get NO response_format unless the
  // school gateway explicitly opts in via BAZE_JSON_MODE.
  if (options.json) {
    if (config.provider === 'school_gateway') {
      if (config.jsonMode === 'json_object') body.response_format = { type: 'json_object' };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  // NOTE: never send Gemini-only thinking_budget/thinking_level, and never copy
  // another model's reasoning options.
  return body;
}

function classifyStatus(status: number): AiErrorCode {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'auth';
  if (status === 402) return 'credit';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  return 'provider';
}

function errorMessage(code: AiErrorCode, status?: number): string {
  switch (code) {
    case 'unconfigured':
      return 'AI API 키/제공자가 설정되지 않았습니다. 서버 환경 변수를 확인해 주세요.';
    case 'bad_request':
      return `AI 요청이 거부되었습니다 (HTTP ${status}). 모델 옵션 또는 입력 형식을 확인해 주세요.`;
    case 'auth':
      return `AI 인증에 실패했습니다 (HTTP ${status}). 등록한 API 키가 올바른지 확인해 주세요.`;
    case 'credit':
      return `AI 크레딧이 부족합니다 (HTTP ${status}). 키를 발급한 계정의 크레딧을 충전한 뒤 다시 시도해 주세요.`;
    case 'forbidden':
      return `AI 접근 권한이 없습니다 (HTTP ${status}). 모델·조직 권한이 활성화되어 있는지, 요청이 차단되지 않았는지 확인해 주세요.`;
    case 'not_found':
      return `AI 모델 또는 경로를 찾을 수 없습니다 (HTTP ${status}). 모델 이름/엔드포인트를 확인해 주세요.`;
    case 'rate_limit':
      return `AI 호출 제한을 초과했습니다 (HTTP ${status}). 잠시 후 다시 시도해 주세요.`;
    case 'provider':
      return `AI 제공자/Gateway 오류가 발생했습니다 (HTTP ${status}).`;
    case 'timeout':
      return 'AI 요청 시간이 초과되었습니다. 요청이 처리되었을 수 있으므로 결과를 확인하기 전에 무조건 재호출하지 마세요.';
    case 'network':
      return 'AI 네트워크 연결에 실패했습니다.';
    case 'empty':
      return 'AI 응답이 비어 있습니다.';
    case 'truncated':
      return 'AI 응답이 출력 토큰 한도로 잘렸습니다. 출력 예산을 늘려 주세요.';
    case 'invalid_json':
      return 'AI 응답을 JSON으로 해석하지 못했습니다.';
    default:
      return 'AI 호출에 실패했습니다.';
  }
}

/** HTTP status returned to the application caller for a provider error. */
export function httpStatusForAiError(code: AiErrorCode): number {
  switch (code) {
    case 'bad_request':
    case 'not_found':
      return 400;
    case 'rate_limit':
      return 429;
    default:
      return 502;
  }
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 30) * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30000));
  return null;
}

export async function callAiChat(
  options: AiChatOptions,
  config: AiConfig = AI_CONFIG
): Promise<AiChatResult> {
  if (!config.apiKey) {
    return { ok: false, error: { code: 'unconfigured', message: errorMessage('unconfigured') } };
  }

  const endpoint = buildChatEndpoint(config.provider, config.apiBase);
  const body = JSON.stringify(buildRequestBody(options, config));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempt = 0;

  while (attempt <= MAX_RATE_LIMIT_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const aborted = err instanceof Error && err.name === 'AbortError';
      const code: AiErrorCode = aborted ? 'timeout' : 'network';
      // Timeouts may have been processed and charged: never auto-retry.
      return { ok: false, error: { code, message: errorMessage(code) } };
    }

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? 500 * 2 ** attempt;
      try { await response.text(); } catch { /* ignore */ }
      clearTimeout(timeoutId);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch { detail = response.statusText; }
      clearTimeout(timeoutId);
      const code = classifyStatus(response.status);
      if (code === 'provider' || code === 'rate_limit') {
        const safe = sanitizeAiText(detail, config.apiKey);
        if (safe) console.warn(`[ai:${options.label ?? 'call'}] provider error ${response.status}: ${safe}`);
      }
      return { ok: false, error: { code, message: errorMessage(code, response.status), status: response.status } };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      clearTimeout(timeoutId);
      return { ok: false, error: { code: 'invalid_json', message: errorMessage('invalid_json') } };
    }
    clearTimeout(timeoutId);

    const data = payload as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const usage: AiUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    if (usage) {
      console.log(
        `[ai:${options.label ?? 'call'}] provider=${config.provider} model=${config.model}` +
          ` tokens=${usage.promptTokens ?? '?'}/${usage.completionTokens ?? '?'}/${usage.totalTokens ?? '?'}`
      );
    }

    if (choice?.finish_reason === 'length') {
      return { ok: false, error: { code: 'truncated', message: errorMessage('truncated') } };
    }
    if (!content.trim()) {
      return { ok: false, error: { code: 'empty', message: errorMessage('empty') } };
    }
    return { ok: true, content, model: config.model, usage };
  }

  return { ok: false, error: { code: 'rate_limit', message: errorMessage('rate_limit') } };
}

export type GatewayModelCheckReason =
  | 'ok'
  | 'not_configured'
  | 'auth'
  | 'credit'
  | 'forbidden'
  | 'rate_limit'
  | 'provider'
  | 'network'
  | 'not_found';

export interface GatewayModelCheck {
  ok: boolean;
  hasModel: boolean;
  status?: number;
  modelIds?: string[];
  reason: GatewayModelCheckReason;
  message: string;
}

/**
 * Verifies a key and lists the models enabled for it via GET /models/?type=llm.
 * A 403 is NOT blindly treated as a bad key: it can mean the model is not
 * enabled for the org, an excluded model, or that the request was blocked
 * before reaching the gateway.
 */
export async function verifyGatewayModelForKey(
  apiKey: string,
  apiBase: string,
  model: string
): Promise<GatewayModelCheck> {
  if (!apiKey) {
    return { ok: false, hasModel: false, reason: 'not_configured', message: 'school_gateway 키가 설정되지 않았습니다.' };
  }
  const url = buildModelsEndpoint(apiBase);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return { ok: false, hasModel: false, reason: 'network', message: `모델 목록 조회 네트워크 실패: ${sanitizeAiText(err instanceof Error ? err.message : '', apiKey)}` };
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { detail = ''; }
    const safe = sanitizeAiText(detail, apiKey);
    if (response.status === 401) {
      return { ok: false, hasModel: false, status: 401, reason: 'auth', message: '인증 실패(401): 키가 이 배포(factchat-cloud)에 발급된 유효한 키인지 확인하세요.' };
    }
    if (response.status === 402) {
      return { ok: false, hasModel: false, status: 402, reason: 'credit', message: '크레딧 부족(402): 키를 발급한 계정의 크레딧을 충전하세요.' };
    }
    if (response.status === 403) {
      const blocked = /1010|cloudflare|not available through the gateway|not enabled for your tenant/i.test(detail);
      return {
        ok: false, hasModel: false, status: 403, reason: 'forbidden',
        message:
          '권한 거부(403): 잘못된 키가 아니라 모델이 조직에 활성화되지 않았거나, 게이트웨이 API 대상이 아닌 모델이거나, 게이트웨이 도달 전 요청이 차단되었을 수 있습니다.' +
          (blocked ? ` (${safe})` : ''),
      };
    }
    if (response.status === 429) {
      return { ok: false, hasModel: false, status: 429, reason: 'rate_limit', message: '호출 제한(429): 잠시 후 다시 시도하세요.' };
    }
    return { ok: false, hasModel: false, status: response.status, reason: 'provider', message: `모델 목록 조회 실패 (HTTP ${response.status}): ${safe}` };
  }

  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  const list = (payload as { data?: { id?: unknown }[] } | null)?.data ?? [];
  const modelIds = Array.isArray(list) ? list.map((m) => String(m?.id ?? '')).filter(Boolean) : [];
  const hasModel = modelIds.includes(model);
  return {
    ok: true,
    hasModel,
    status: 200,
    modelIds,
    reason: hasModel ? 'ok' : 'not_found',
    message: hasModel ? `모델 '${model}' 사용 가능` : `모델 '${model}'이(가) 이 키의 목록에 없습니다.`,
  };
}

/** Convenience wrapper for the operator-configured key. */
export async function verifyGatewayModel(model = AI_CONFIG.model): Promise<GatewayModelCheck> {
  if (!isAiConfigured() || AI_CONFIG.provider !== 'school_gateway') {
    return { ok: false, hasModel: false, reason: 'not_configured', message: 'school_gateway 제공자/키가 설정되지 않았습니다.' };
  }
  return verifyGatewayModelForKey(AI_CONFIG.apiKey, AI_CONFIG.apiBase, model);
}
