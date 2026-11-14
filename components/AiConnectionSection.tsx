'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Eye, EyeOff, Check, Trash2, RefreshCw, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react';
import { useTrialCredits, notifyTrialCreditsUpdated } from '../lib/trialCreditsClient';

type ConnectionStatus = 'unregistered' | 'checking' | 'checked' | 'connected' | 'failed';

interface SchoolModelOption {
  id: string;
  label: string;
  shortName: string;
}

interface ConnectionState {
  connected: boolean;
  provider?: string;
  model?: string;
  keyHint?: string;
  status?: string;
  lastCheckedAt?: string | null;
  operatorFallback?: boolean;
  operatorProvider?: string;
  operatorModel?: string;
  encryptionConfigured?: boolean;
  defaultModel?: string;
  availableSchoolModels?: SchoolModelOption[];
  models?: string[];
}

const DEFAULT_MODEL = 'deepseek-v4.1-flash';
const DEFAULT_SONNET_MODEL = 'claude-sonnet-5-5';

function formatModelOptionLabel(modelId: string, availableSchoolModels?: SchoolModelOption[]): string {
  const matched = availableSchoolModels?.find((m) => m.id === modelId);
  if (matched) {
    return modelId === DEFAULT_MODEL ? `${matched.label} · 기본 권장` : matched.label;
  }
  if (modelId === DEFAULT_MODEL) return `DeepSeek (${modelId}) · 기본 권장`;
  if (modelId === DEFAULT_SONNET_MODEL) return `Sonnet (${modelId})`;
  return modelId;
}

function formatWhen(value?: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ko-KR');
  } catch {
    return value;
  }
}

export function AiConnectionSection() {
  const [status, setStatus] = useState<ConnectionStatus>('unregistered');
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [keyHint, setKeyHint] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelSaveBusy, setModelSaveBusy] = useState(false);
  const [modelSaveStatus, setModelSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [modelSaveMessage, setModelSaveMessage] = useState('');
  const trialCredits = useTrialCredits();

  const resetInput = () => {
    setApiKey('');
    setShowKey(false);
    setModels([]);
    setSelectedModel(DEFAULT_MODEL);
    setKeyHint('');
    setModelsError('');
    setModelSaveStatus('idle');
    setModelSaveMessage('');
  };

  const fetchStoredKeyModels = async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const res = await fetch('/api/ai-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useStoredKey: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setModelsError(data.error || '사용 가능한 모델 목록을 불러오지 못했습니다.');
        return;
      }
      const list: string[] = Array.isArray(data.models) ? data.models : [];
      if (list.length === 0) {
        setModelsError('이 API 키에서 사용할 수 있는 모델이 확인되지 않았습니다.');
        return;
      }
      setModels(list);
      setModelsError('');
    } catch {
      setModelsError('네트워크 오류로 모델 목록을 불러오지 못했습니다.');
    } finally {
      setModelsLoading(false);
    }
  };

  const load = async () => {
    try {
      const res = await fetch('/api/ai-connection', { method: 'GET' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus('failed');
        setMessage(data.error || '연결 상태를 확인하지 못했습니다.');
        return;
      }
      setConnection(data);
      if (data.connected) {
        setStatus('connected');
        setSelectedModel(data.model || data.defaultModel || DEFAULT_MODEL);
        setMessage('');
        void fetchStoredKeyModels();
      } else {
        setStatus('unregistered');
      }
    } catch {
      setStatus('failed');
      setMessage('네트워크 오류로 연결 상태를 확인하지 못했습니다.');
    }
  };

  useEffect(() => {
    // Defer the initial fetch so the effect body itself never sets state
    // synchronously (avoids cascading renders on mount).
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = async () => {
    if (busy) return;
    if (!apiKey.trim()) {
      setStatus('failed');
      setMessage('API 키를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('checking');
    setMessage('');
    try {
      const res = await fetch('/api/ai-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus('failed');
        setMessage(data.error || '연결 확인에 실패했습니다.');
        return;
      }
      const list: string[] = Array.isArray(data.models) ? data.models : [];
      setModels(list);
      setKeyHint(data.keyHint || '');
      setSelectedModel(data.defaultModel || (list.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : list[0] || DEFAULT_MODEL));
      setStatus('checked');
      setMessage(data.warning || `인증 확인 완료 · 사용 가능한 모델 ${list.length}개`);
    } catch {
      setStatus('failed');
      setMessage('네트워크 오류로 연결 확인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDefaultModel = async () => {
    if (busy || modelSaveBusy || !selectedModel) return;
    setModelSaveBusy(true);
    setModelSaveStatus('idle');
    setModelSaveMessage('');
    try {
      const res = await fetch('/api/ai-connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setModelSaveStatus('error');
        setModelSaveMessage(data.error || '기본 모델을 저장하지 못했습니다.');
        return;
      }
      setConnection((prev) => ({ ...(prev || { connected: true }), ...data }));
      if (Array.isArray(data.models) && data.models.length > 0) {
        setModels(data.models);
      }
      setSelectedModel(data.model || selectedModel);
      setModelSaveStatus('saved');
      setModelSaveMessage(`기본 모델 '${data.model || selectedModel}'이(가) 서버에 저장되었습니다.`);
    } catch {
      setModelSaveStatus('error');
      setModelSaveMessage('네트워크 오류로 기본 모델을 저장하지 못했습니다.');
    } finally {
      setModelSaveBusy(false);
    }
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/ai-connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() || undefined, model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus('failed');
        setMessage(data.error || '연결을 저장하지 못했습니다.');
        return;
      }
      setConnection(data);
      setStatus('connected');
      setReplacing(false);
      resetInput();
      setSelectedModel(data.model || selectedModel || DEFAULT_MODEL);
      if (Array.isArray(data.models) && data.models.length > 0) {
        setModels(data.models);
      }
      notifyTrialCreditsUpdated();
      setMessage('API 연결이 저장되었습니다. 키는 브라우저에 저장되지 않습니다.');
    } catch {
      setStatus('failed');
      setMessage('네트워크 오류로 연결을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecheck = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/ai-connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: connection?.model || DEFAULT_MODEL }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus('failed');
        setMessage(data.error || '연결을 다시 확인하지 못했습니다.');
        return;
      }
      setConnection(data);
      setStatus('connected');
      setMessage('연결이 정상입니다.');
    } catch {
      setStatus('failed');
      setMessage('네트워크 오류로 연결을 다시 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    if (!window.confirm('등록한 API 연결과 암호화된 키를 삭제할까요?')) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/ai-connection', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage(data.error || '연결을 삭제하지 못했습니다.');
        return;
      }
      setConnection({ connected: false, operatorFallback: connection?.operatorFallback });
      setStatus('unregistered');
      resetInput();
      notifyTrialCreditsUpdated();
      setMessage('API 연결이 삭제되었습니다.');
    } catch {
      setMessage('네트워크 오류로 연결을 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const showKeyInput = replacing || status !== 'connected';
  const statusLabel: Record<ConnectionStatus, string> = {
    unregistered: '미등록',
    checking: '확인 중…',
    checked: '확인됨 (저장 필요)',
    connected: '연결됨',
    failed: '확인 실패',
  };
  const statusColor =
    status === 'connected'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : status === 'failed'
      ? 'bg-red-50 text-red-800 border-red-200'
      : 'bg-[#faf8f4] text-[#57544e] border-[#ded6c8]';

  return (
    <section className="border border-[#ded6c8] rounded-xs bg-white" aria-label="내 AI API 연결">
      <div className="bg-[#191817] text-white px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#c52828]" />
          <h4 className="text-xs font-bold">내 AI API 연결 (인천대 AI:NU BAZE Gateway)</h4>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-xs border ${statusColor}`}>{statusLabel[status]}</span>
      </div>

      <div className="p-4 space-y-3 text-xs">
        {/* Trial Credits Overview Card */}
        <div
          className={`p-3 rounded-xs border space-y-1.5 ${
            trialCredits.hasPersonalKey
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : trialCredits.balance > 0
              ? 'bg-amber-50/70 border-amber-200 text-amber-950'
              : 'bg-red-50/70 border-red-200 text-red-950'
          }`}
        >
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-1.5">
              <Sparkles className={`w-4 h-4 ${trialCredits.hasPersonalKey ? 'text-emerald-600' : trialCredits.balance > 0 ? 'text-amber-600' : 'text-red-500'}`} />
              <span>
                {trialCredits.hasPersonalKey
                  ? '내 API 사용 중 · 체험 크레딧 차감 없음'
                  : `AI 체험 ${trialCredits.granted}회 제공 (남은 체험: ${trialCredits.balance}회)`}
              </span>
            </div>
            {!trialCredits.hasPersonalKey && (
              <span className="font-academic-mono text-[11px] px-1.5 py-0.5 rounded-2xs bg-white/80 border border-current">
                잔여 {trialCredits.balance} / {trialCredits.granted}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[#57544e]">
            {trialCredits.hasPersonalKey
              ? '개인 API 키가 정상 등록되어 있어 모든 AI 작업은 내 계정의 BAZE 크레딧을 사용하며, 제공된 체험 크레딧은 차감되지 않고 보존됩니다.'
              : trialCredits.balance > 0
              ? '신규 가입자 혜택으로 개인 API 키 없이 운영자 Gemini API를 통해 핵심 AI 기능(개념 분석 1건, 고난도 문제 생성 1건, 답안 AI 정밀 평가 1건)을 3회까지 무료로 체험할 수 있습니다. (자료당 최대 2청크, 생성 2문항 한도)'
              : '체험 크레딧 3회가 모두 소진되었습니다. AI 개념 분석, 문제 출제, 답안 정밀 평가를 계속 이용하시려면 본인의 BAZE API 키를 등록해 주세요.'}
          </p>
        </div>

        <p className="text-[11px] text-[#57544e] leading-relaxed">
          내 학교 API 키를 등록하면 AI 호출 크레딧이 <strong>키를 발급한 계정</strong>에서 차감됩니다. 키는 서버에서
          암호화되어 저장되며 브라우저로 다시 전송되지 않고 <code>localStorage</code>에도 저장되지 않습니다.
        </p>

        <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-[11px] text-[#57544e]">
          {connection?.connected || !connection?.operatorProvider || connection.operatorProvider === 'school_gateway' ? (
            <>
              기본 AI 모델 선택: 학교 BAZE Gateway 사용 시 아래에서 기본 모델을 직접 고를 수 있으며, 문제 생성 및 답안 채점 화면에서도{' '}
              <strong className="font-academic-mono text-[#191817]">DeepSeek ({DEFAULT_MODEL})</strong>과{' '}
              <strong className="font-academic-mono text-[#191817]">Sonnet ({DEFAULT_SONNET_MODEL})</strong> 중 원하는 모델을 직접 선택해 실행할 수 있습니다.
            </>
          ) : (
            <>
              현재 비학교 제공자(<strong className="font-academic-mono text-[#191817]">{connection.operatorProvider}</strong>
              {connection.operatorModel ? ` · ${connection.operatorModel}` : ''})가 설정되어 있어 학교 모델을 별도로 선택할 수 없으며 기존 제공자 모델이 유지됩니다.
            </>
          )}
        </div>

        {status === 'connected' && !replacing && (
          <div className="space-y-2.5 p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>연결됨 · {connection?.keyHint || '••••'}</span>
              </div>
              {connection?.lastCheckedAt && (
                <span className="text-[10.5px] text-[#827d73]">마지막 확인: {formatWhen(connection.lastCheckedAt)}</span>
              )}
            </div>
            <p className="text-[11px] text-[#57544e]">
              현재 저장된 기본 모델: <strong className="font-academic-mono text-[#191817]">{connection?.model || DEFAULT_MODEL}</strong>
            </p>

            <div className="space-y-1.5 pt-1 border-t border-[#e5dfd3]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="connected-default-model-select" className="font-semibold text-[#191817]">
                  기본 AI 모델 변경 (API 키 재입력 불필요)
                </label>
                <button
                  type="button"
                  onClick={() => void fetchStoredKeyModels()}
                  disabled={modelsLoading || modelSaveBusy || busy}
                  className="text-[10.5px] text-[#57544e] hover:text-[#191817] underline disabled:opacity-50"
                >
                  {modelsLoading ? '목록 확인 중…' : '사용 가능 모델 새로고침'}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  id="connected-default-model-select"
                  aria-label="기본 AI 모델 선택"
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    setModelSaveStatus('idle');
                    setModelSaveMessage('');
                  }}
                  disabled={modelSaveBusy || busy}
                  className="flex-1 p-2 border border-[#ded6c8] rounded-xs bg-white font-mono text-[11px]"
                >
                  {Array.from(
                    new Set(
                      models.length > 0
                        ? [connection?.model || DEFAULT_MODEL, ...models].filter(Boolean)
                        : [connection?.model || DEFAULT_MODEL, DEFAULT_MODEL, DEFAULT_SONNET_MODEL].filter(Boolean)
                    )
                  ).map((m) => (
                    <option key={m} value={m}>
                      {formatModelOptionLabel(m, connection?.availableSchoolModels)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleSaveDefaultModel()}
                  disabled={modelSaveBusy || busy || !selectedModel || selectedModel === connection?.model}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs disabled:opacity-50 shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{modelSaveBusy ? '저장 중…' : '기본 모델 저장'}</span>
                </button>
              </div>
              {modelsError && (
                <div className="p-2 bg-red-50 border border-red-200 rounded-xs text-[11px] text-red-800 flex items-center justify-between gap-2" role="alert">
                  <span>{modelsError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchStoredKeyModels()}
                    disabled={modelsLoading}
                    className="px-2 py-0.5 border border-red-300 rounded-xs bg-white text-red-800 font-semibold shrink-0"
                  >
                    다시 시도
                  </button>
                </div>
              )}
              {modelSaveMessage && (
                <p
                  role="status"
                  className={`p-2 border rounded-xs text-[11px] ${
                    modelSaveStatus === 'error'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}
                >
                  {modelSaveMessage}
                </p>
              )}
            </div>
          </div>
        )}

        {showKeyInput && (
          <>
            <label className="block font-semibold text-[#191817]">
              BAZE API 키
              <div className="flex gap-1.5 mt-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="BAZE > API Gateway에서 발급한 키"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '키 숨기기' : '키 표시'}
                  className="px-2 border border-[#ded6c8] rounded-xs text-[#57544e] hover:bg-[#faf8f4]"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCheck}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
                <span>{status === 'checking' ? '확인 중…' : '연결 확인'}</span>
              </button>
              {replacing && (
                <button
                  type="button"
                  onClick={() => { setReplacing(false); resetInput(); setMessage(''); }}
                  className="px-3 py-1.5 border border-[#ded6c8] rounded-xs text-[#57544e]"
                >
                  취소
                </button>
              )}
            </div>
          </>
        )}

        {status === 'checked' && models.length > 0 && (
          <div className="space-y-2">
            <label className="block font-semibold text-[#191817]">
              사용할 모델
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="block w-full mt-1 p-2 border border-[#ded6c8] rounded-xs bg-white font-mono text-[11px]"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {formatModelOptionLabel(m, connection?.availableSchoolModels)}
                  </option>
                ))}
              </select>
            </label>
            {keyHint && <p className="text-[10.5px] text-[#827d73]">키 식별: {keyHint}</p>}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#c52828] text-white font-bold rounded-xs disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> 이 연결 저장
            </button>
          </div>
        )}

        {status === 'connected' && !replacing && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-[#f1ede4]">
            <button type="button" onClick={handleRecheck} disabled={busy} className="px-3 py-1.5 border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4]">
              다시 확인
            </button>
            <button type="button" onClick={() => setReplacing(true)} disabled={busy} className="px-3 py-1.5 border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4]">
              키 교체
            </button>
            <button type="button" onClick={handleDelete} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#fecaca] text-[#c52828] rounded-xs hover:bg-[#fef2f2]">
              <Trash2 className="w-3.5 h-3.5" /> 연결 삭제
            </button>
          </div>
        )}

        {message && (
          <p className={`p-2 border rounded-xs text-[11px] flex items-start gap-1.5 ${status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-[#faf8f4] border-[#ded6c8] text-[#57544e]'}`} role="status">
            {status === 'failed' && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            <span>{message}</span>
          </p>
        )}

        {status !== 'connected' && connection?.operatorFallback && (
          <p className="text-[10.5px] text-[#827d73]">
            운영자 기본 키가 설정되어 있어 일부 AI 기능은 동작할 수 있지만, 내 키를 등록하면 내 크레딧으로 청구됩니다.
          </p>
        )}
      </div>
    </section>
  );
}
