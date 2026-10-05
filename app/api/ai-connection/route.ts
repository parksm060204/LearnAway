import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import { isAiConfigured } from '@/lib/aiConfig';
import { verifyGatewayModelForKey } from '@/lib/aiClient';
import {
  DEFAULT_SCHOOL_MODEL,
  SCHOOL_GATEWAY_BASE_URL,
  SCHOOL_GATEWAY_PROVIDER,
  connectionCheckHttpStatus,
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  maskKey,
  operatorFallbackAllowed,
  reasonToCode,
  selectAvailableModel,
  validateApiKeyInput,
} from '@/lib/aiCredentials';

export const dynamic = 'force-dynamic';

const SAFE_COLUMNS = 'provider, model, key_hint, status, last_checked_at';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface SafeConnection {
  connected: boolean;
  provider?: string;
  model?: string;
  keyHint?: string;
  status?: string;
  lastCheckedAt?: string | null;
}

type SafeConnectionRead =
  | { state: 'registered'; connection: SafeConnection }
  | { state: 'unregistered' }
  | { state: 'lookup_failed' };

/** Distinguishes registered / unregistered / lookup failure (never conflate). */
async function readSafeConnection(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<SafeConnectionRead> {
  const { data, error } = await supabase.from('ai_connections').select(SAFE_COLUMNS).maybeSingle();
  if (error) return { state: 'lookup_failed' };
  if (!data) return { state: 'unregistered' };
  const row = data as { provider?: string; model?: string; key_hint?: string; status?: string; last_checked_at?: string | null };
  return {
    state: 'registered',
    connection: {
      connected: true,
      provider: row.provider,
      model: row.model,
      keyHint: row.key_hint,
      status: row.status,
      lastCheckedAt: row.last_checked_at ?? null,
    },
  };
}

async function currentSafeConnection(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<SafeConnection> {
  const read = await readSafeConnection(supabase);
  return read.state === 'registered' ? read.connection : { connected: false };
}

async function loadStoredKey(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const key = getEncryptionKey();
  if (!key) return null;
  const { data, error } = await supabase.rpc('get_ai_connection_secret');
  if (error || !data) return null;
  const secret = data as { ciphertext?: string; iv?: string; tag?: string };
  if (!secret.ciphertext) return null;
  try {
    return decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv || '', tag: secret.tag || '' }, key);
  } catch {
    return null;
  }
}

/** Connection status + operator fallback, without any secret material. */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const supabase = await createClient();
    const read = await readSafeConnection(supabase);
    if (read.state === 'lookup_failed') {
      // A read failure must never look like "not registered".
      return NextResponse.json(
        { success: false, errorCode: 'LOOKUP_FAILED', error: '연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 502 }
      );
    }
    const connection = read.state === 'registered' ? read.connection : { connected: false };
    return NextResponse.json({
      success: true,
      ...connection,
      operatorFallback: operatorFallbackAllowed() && isAiConfigured(),
      encryptionConfigured: Boolean(getEncryptionKey()),
      defaultModel: DEFAULT_SCHOOL_MODEL,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, errorCode: 'LOOKUP_FAILED', error: error instanceof Error ? error.message : '연결 상태를 확인하지 못했습니다.' },
      { status: 502 }
    );
  }
}

/** Verifies a key via the model list. Does NOT save and NEVER runs generation. */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const validation = validateApiKeyInput(asRecord(body)?.apiKey);
  if (!validation.ok) {
    return NextResponse.json({ success: false, errorCode: validation.code, error: validation.message }, { status: 400 });
  }
  const apiKey = validation.apiKey;

  const check = await verifyGatewayModelForKey(apiKey, SCHOOL_GATEWAY_BASE_URL, DEFAULT_SCHOOL_MODEL);
  if (!check.ok) {
    return NextResponse.json(
      { success: false, verified: false, errorCode: reasonToCode(check.reason), error: check.message },
      { status: connectionCheckHttpStatus(check.reason) }
    );
  }
  const models = check.modelIds ?? [];
  const selection = selectAvailableModel(models);
  if (!selection.ok) {
    return NextResponse.json(
      { success: false, verified: false, errorCode: 'NO_MODELS', error: '이 키로 사용할 수 있는 모델이 없습니다.' },
      { status: 400 }
    );
  }
  return NextResponse.json({
    success: true,
    verified: true,
    models,
    defaultModel: selection.model,
    keyHint: maskKey(apiKey),
    warning: check.hasModel ? undefined : `기본 모델 '${DEFAULT_SCHOOL_MODEL}'을(를) 사용할 수 없어 다른 모델을 선택해야 합니다.`,
  });
}

/** Saves (or re-saves) the encrypted connection after verification. */
export async function PUT(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'ENCRYPTION_NOT_CONFIGURED',
        error: '서버 암호화 키(AI_CREDENTIAL_ENCRYPTION_KEY)가 설정되지 않아 안전하게 저장할 수 없습니다.',
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const record = asRecord(body);
  const providedKey = validateApiKeyInput(record?.apiKey);
  if (record?.apiKey !== undefined && !providedKey.ok) {
    return NextResponse.json({ success: false, errorCode: providedKey.code, error: providedKey.message }, { status: 400 });
  }
  const newKey = providedKey.ok ? providedKey.apiKey : '';
  const requestedModel = asString(record?.model);

  try {
    const supabase = await createClient();
    const apiKey = newKey || (await loadStoredKey(supabase));
    if (!apiKey) {
      return NextResponse.json(
        { success: false, errorCode: 'EMPTY_KEY', error: '등록할 API 키가 없습니다. 키를 입력해 주세요.' },
        { status: 400 }
      );
    }

    // Verify against the live model list before saving anything.
    const check = await verifyGatewayModelForKey(apiKey, SCHOOL_GATEWAY_BASE_URL, requestedModel || DEFAULT_SCHOOL_MODEL);
    if (!check.ok) {
      return NextResponse.json(
        { success: false, verified: false, errorCode: reasonToCode(check.reason), error: check.message },
        { status: connectionCheckHttpStatus(check.reason) }
      );
    }
    const selection = selectAvailableModel(check.modelIds ?? [], requestedModel || undefined);
    if (!selection.ok) {
      const message = selection.code === 'NO_MODELS'
        ? '이 키로 사용할 수 있는 모델이 없습니다.'
        : `선택한 모델 '${requestedModel}'은(는) 이 키로 사용할 수 없습니다.`;
      return NextResponse.json({ success: false, verified: false, errorCode: selection.code, error: message }, { status: 400 });
    }
    const model = selection.model;

    if (!newKey) {
      // Model-only update: keep the stored ciphertext.
      const { error } = await supabase.rpc('touch_ai_connection', { p_status: 'connected', p_model: model });
      if (error) throw new Error(error.message);
    } else {
      const encrypted = encryptSecret(apiKey, encryptionKey);
      const { error } = await supabase.rpc('save_ai_connection', {
        p_provider: SCHOOL_GATEWAY_PROVIDER,
        p_base_url: SCHOOL_GATEWAY_BASE_URL,
        p_model: model,
        p_key_hint: maskKey(apiKey),
        p_ciphertext: encrypted.ciphertext,
        p_iv: encrypted.iv,
        p_tag: encrypted.tag,
      });
      if (error) throw new Error(error.message);
    }

    const connection = await currentSafeConnection(supabase);
    return NextResponse.json({ success: true, ...connection, models: check.modelIds ?? [] });
  } catch (error) {
    return NextResponse.json(
      { success: false, errorCode: 'SAVE_FAILED', error: error instanceof Error ? error.message : 'API 연결을 저장하지 못했습니다.' },
      { status: 500 }
    );
  }
}

/** Removes the encrypted key and the connection cache. */
export async function DELETE() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('delete_ai_connection');
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'API 연결을 삭제하지 못했습니다.' },
      { status: 500 }
    );
  }
}
