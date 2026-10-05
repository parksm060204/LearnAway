'use client';

import React, { useState } from 'react';
import { RetentionModelSettings } from '../lib/types';
import { DEFAULT_RETENTION_SETTINGS } from '../lib/retentionModel';
import { X, Settings, RotateCcw, Check, Info } from 'lucide-react';
import { AiConnectionSection } from './AiConnectionSection';
import { MaterialPolicySection } from './MaterialPolicySection';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: RetentionModelSettings;
  onSaveSettings: (settings: RetentionModelSettings) => void;
  onResetData: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onResetData,
}: SettingsModalProps) {
  const [tau, setTau] = useState(settings.tau);
  const [alpha, setAlpha] = useState(settings.alpha);
  const [threshold, setThreshold] = useState(settings.threshold);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      tau: Number(tau),
      alpha: Number(alpha),
      threshold: Number(threshold),
    });
    onClose();
  };

  const handleResetToDefaults = () => {
    setTau(DEFAULT_RETENTION_SETTINGS.tau);
    setAlpha(DEFAULT_RETENTION_SETTINGS.alpha);
    setThreshold(DEFAULT_RETENTION_SETTINGS.threshold);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-[#c8c2b5] rounded-xs shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">
              복습 감쇠 모델 및 시연 엔진 설정
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs font-sans">
          {/* Transparent Notice */}
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1.5 text-[#57544e]">
            <div className="flex items-center gap-1.5 font-academic-mono text-[11px] font-bold text-[#827d73]">
              <Info className="w-3.5 h-3.5 text-blue-600" />
              <span>학술 시연용 망각곡선 모델 안내</span>
            </div>
            <p className="leading-relaxed text-[11px]">
              수식: <strong>R(t) = S0 · (1 + t/τ)^(-α)</strong>
              <br />
              본 파라미터는 대학 시험 준비 스케줄링 시연을 위한 수학적 감쇠 모형이며, 실제 생체 기억률의 절대 측정치가 아닌 상대적 복습 우선순위 산출 지수입니다.
            </p>
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              기억 안정성 상수 τ (Tau, 일 단위):
            </label>
            <input
              type="number"
              step="0.1"
              min="0.5"
              max="30"
              value={tau}
              onChange={(e) => setTau(parseFloat(e.target.value) || 1)}
              required
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
            <span className="text-[10.5px] text-[#827d73]">
              기본값: 3.5일 (성공적 복습 시마다 안정 계수가 점진적으로 스케일업됩니다)
            </span>
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              감쇠 멱지수 α (Alpha, 감쇠 속도):
            </label>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="2.0"
              value={alpha}
              onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.1)}
              required
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
            <span className="text-[10.5px] text-[#827d73]">
              기본값: 0.45 (값이 클수록 시간이 지남에 따라 점수가 가파르게 감쇠합니다)
            </span>
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              임계 복습 권장 기준점 (Critical Threshold Score):
            </label>
            <input
              type="number"
              step="1"
              min="10"
              max="90"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value) || 50)}
              required
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
            <span className="text-[10.5px] text-[#827d73]">
              기본값: 50.0점 (점수가 이 임계치 아래로 떨어지면 &apos;복습 대상&apos; 위험 배지가 점등됩니다)
            </span>
          </div>

          {/* Reset initial demo data */}
          <div className="pt-2 border-t border-[#f1ede4] flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (confirm('모든 사용자 학습 기록과 설정을 초기 데모 데이터로 재설정하시겠습니까?')) {
                  onResetData();
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#c52828] hover:bg-[#fef2f2] border border-[#fecaca] rounded-xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>초기 데모 데이터로 복원</span>
            </button>

            <button
              type="button"
              onClick={handleResetToDefaults}
              className="text-xs text-[#827d73] hover:text-[#191817] underline"
            >
              파라미터 기본값 복원
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>설정 저장</span>
            </button>
          </div>
        </form>

        {/* My AI API connection */}
        <div className="px-5 pb-5 space-y-4">
          <AiConnectionSection />
          <MaterialPolicySection />
        </div>
      </div>
    </div>
  );
}
