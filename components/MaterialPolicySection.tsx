'use client';

import React, { useEffect, useState } from 'react';
import { HardDrive, ShieldCheck, Info, AlertTriangle } from 'lucide-react';
import type { MaterialStoragePolicy } from '../lib/types';
import { loadDefaultMaterialPolicy, saveDefaultMaterialPolicy } from '../lib/materialPolicy';
import { estimateLocalStorageUsage, requestPersistentStorage } from '../lib/materialStorage';
import { subscribeStorageScope } from '../lib/storageScope';

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function MaterialPolicySection() {
  const [policy, setPolicy] = useState<MaterialStoragePolicy>(() => loadDefaultMaterialPolicy());
  const [usage, setUsage] = useState<{ supported: boolean; usage?: number; quota?: number }>({ supported: false });
  const [persistState, setPersistState] = useState<'idle' | 'granted' | 'denied' | 'unsupported'>('idle');
  const [saveError, setSaveError] = useState('');

  // Re-read the account-scoped policy whenever the account (storage scope)
  // changes, so another account's setting is never shown here. The initial
  // useState value already reflects the scope active at mount.
  useEffect(() => {
    const unsubscribe = subscribeStorageScope(() => {
      setPolicy(loadDefaultMaterialPolicy());
      setSaveError('');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void estimateLocalStorageUsage().then(setUsage);
  }, []);

  const update = (next: MaterialStoragePolicy) => {
    setPolicy(next);
    const saved = saveDefaultMaterialPolicy(next);
    setSaveError(saved ? '' : '설정을 이 기기에 저장하지 못했습니다. 다시 시도해 주세요.');
  };
  const syncBody = policy.syncBody;
  const backupOriginal = policy.backupOriginal;

  const pct = usage.supported && usage.quota ? Math.min(100, Math.round(((usage.usage ?? 0) / usage.quota) * 100)) : null;

  return (
    <section className="border border-[#ded6c8] rounded-xs bg-white" aria-label="자료 저장 정책">
      <div className="bg-[#191817] text-white px-4 py-2.5 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-[#c52828]" />
        <h4 className="text-xs font-bold">자료 저장 정책 (새 자료 기본값)</h4>
      </div>
      <div className="p-4 space-y-3 text-xs">
        <p className="text-[11px] text-[#57544e] leading-relaxed">
          기본은 <strong>로컬 보관</strong>입니다. PDF 원본과 변환 본문은 이 기기(IndexedDB)에만 저장되고, 서버에는
          학습 연결에 필요한 메타데이터만 저장됩니다. 아래를 켜면 새 자료에 한해 선택한 항목만 클라우드로 전송합니다
          (기존 자료의 저장 방식은 바뀌지 않습니다).
        </p>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={syncBody} onChange={(e) => update({ syncBody: e.target.checked, backupOriginal })} className="mt-0.5" />
          <span>
            <span className="font-semibold text-[#191817]">변환 본문 클라우드 동기화</span>
            <span className="block text-[10.5px] text-[#827d73]">Markdown·전사본·페이지를 다른 기기에서도 열 수 있게 업로드합니다.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={backupOriginal} onChange={(e) => update({ syncBody, backupOriginal: e.target.checked })} className="mt-0.5" />
          <span>
            <span className="font-semibold text-[#191817]">PDF 원본 클라우드 백업</span>
            <span className="block text-[10.5px] text-[#827d73]">원본 파일을 비공개 버킷에 백업합니다. 로컬 삭제 시 복원할 수 있습니다.</span>
          </span>
        </label>

        {!syncBody && !backupOriginal && (
          <p className="flex items-center gap-1.5 text-[10.5px] text-emerald-700">
            <ShieldCheck className="w-3.5 h-3.5" /> 로컬 전용 · 서버에는 메타데이터만 저장됩니다.
          </p>
        )}

        {saveError && (
          <p role="alert" className="flex items-center gap-1.5 p-2 bg-red-50 border border-red-200 text-red-800 rounded-xs text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
          </p>
        )}

        <div className="pt-2 border-t border-[#f1ede4] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#57544e]">
            <Info className="w-3.5 h-3.5 text-blue-600" /> 이 기기 저장 공간
          </div>
          {usage.supported ? (
            <p className="text-[11px] text-[#57544e]">
              사용 {formatBytes(usage.usage)} / 할당 {formatBytes(usage.quota)}
              {pct !== null ? ` (${pct}%)` : ''}
            </p>
          ) : (
            <p className="text-[11px] text-[#827d73]">이 브라우저는 저장 공간 조회를 지원하지 않습니다.</p>
          )}
          <button
            type="button"
            onClick={() => void requestPersistentStorage().then(setPersistState)}
            className="px-3 py-1.5 border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4]"
          >
            영속 저장 요청
          </button>
          {persistState === 'granted' && <span className="ml-2 text-[11px] text-emerald-700">영속 저장 허용됨</span>}
          {persistState === 'denied' && <span className="ml-2 text-[11px] text-[#827d73]">거부됨(브라우저 정책) · 성공을 보장하지 않습니다</span>}
          {persistState === 'unsupported' && <span className="ml-2 text-[11px] text-[#827d73]">지원되지 않습니다</span>}
        </div>
      </div>
    </section>
  );
}
