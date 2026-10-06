'use client';

import React, { useState } from 'react';
import type { Material, RetentionModelSettings, Subject } from '../lib/types';
import { DEFAULT_RETENTION_SETTINGS } from '../lib/retentionModel';
import { AiConnectionSection } from './AiConnectionSection';
import { MaterialPolicySection } from './MaterialPolicySection';
import { DataManagementSection, type MigrationUiBlock } from './DataManagementSection';
import {
  Settings,
  Key,
  Database,
  Sliders,
  User,
  RotateCcw,
  Check,
  Info,
  LogOut,
} from 'lucide-react';

export interface SettingsWorkspaceProps {
  settings: RetentionModelSettings;
  onSaveSettings: (settings: RetentionModelSettings) => void;
  onResetData: () => void;
  materials: Material[];
  subjects: Subject[];
  onRestoreMaterials: (restored: Material[]) => boolean | Promise<boolean>;
  migrationBlocks: MigrationUiBlock[];
  currentUserEmail?: string | null;
  onLogout?: () => void;
  isLoggingOut?: boolean;
}

export function SettingsWorkspace({
  settings,
  onSaveSettings,
  onResetData,
  materials,
  subjects,
  onRestoreMaterials,
  migrationBlocks,
  currentUserEmail,
  onLogout,
  isLoggingOut = false,
}: SettingsWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<'api' | 'policy' | 'data' | 'model' | 'account'>('api');

  // Retention model state
  const [tau, setTau] = useState(settings.tau);
  const [alpha, setAlpha] = useState(settings.alpha);
  const [threshold, setThreshold] = useState(settings.threshold);
  const [modelSaved, setModelSaved] = useState(false);

  const handleSaveModel = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      tau: Number(tau),
      alpha: Number(alpha),
      threshold: Number(threshold),
    });
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 3000);
  };

  const handleResetModelDefaults = () => {
    setTau(DEFAULT_RETENTION_SETTINGS.tau);
    setAlpha(DEFAULT_RETENTION_SETTINGS.alpha);
    setThreshold(DEFAULT_RETENTION_SETTINGS.threshold);
  };

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <div className="bg-white border border-[#e2ded6] rounded-xs p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#c52828]" />
            <div>
              <h2 className="text-base sm:text-lg font-bold font-academic-serif text-[#191817]">
                환경 설정 및 시스템 관리
              </h2>
              <p className="text-xs text-[#827d73] font-academic-mono">
                API 연결 · 자료 저장 정책 · 데이터 백업 및 복원 · 망각곡선 모델 파라미터
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Settings Navigation & Content Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* Navigation Sidebar (3 cols) */}
        <div className="md:col-span-3 bg-white border border-[#e2ded6] rounded-xs p-2 shadow-2xs space-y-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('api')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold transition-colors text-left ${
              activeSubTab === 'api'
                ? 'bg-[#191817] text-white'
                : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
            }`}
          >
            <Key className="w-4 h-4 text-amber-500" />
            <span>AI API 연결</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('policy')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold transition-colors text-left ${
              activeSubTab === 'policy'
                ? 'bg-[#191817] text-white'
                : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
            }`}
          >
            <Database className="w-4 h-4 text-blue-500" />
            <span>자료 저장 정책</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('data')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold transition-colors text-left ${
              activeSubTab === 'data'
                ? 'bg-[#191817] text-white'
                : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
            }`}
          >
            <Database className="w-4 h-4 text-emerald-500" />
            <span>데이터 이관·백업</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('model')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold transition-colors text-left ${
              activeSubTab === 'model'
                ? 'bg-[#191817] text-white'
                : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
            }`}
          >
            <Sliders className="w-4 h-4 text-purple-500" />
            <span>망각곡선 모델</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('account')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold transition-colors text-left ${
              activeSubTab === 'account'
                ? 'bg-[#191817] text-white'
                : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
            }`}
          >
            <User className="w-4 h-4 text-indigo-500" />
            <span>계정 및 초기화</span>
          </button>
        </div>

        {/* Content Pane (9 cols) */}
        <div className="md:col-span-9 bg-white border border-[#e2ded6] rounded-xs p-5 sm:p-6 shadow-2xs">
          {activeSubTab === 'api' && (
            <div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-4 pb-2 border-b border-[#f1ede4]">
                AI API 연결 설정 (학교 BAZE Gateway / DeepSeek)
              </h3>
              <AiConnectionSection />
            </div>
          )}

          {activeSubTab === 'policy' && (
            <div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-4 pb-2 border-b border-[#f1ede4]">
                자료 저장 정책 및 동기화 설정
              </h3>
              <MaterialPolicySection />
            </div>
          )}

          {activeSubTab === 'data' && (
            <div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-4 pb-2 border-b border-[#f1ede4]">
                데이터 이관 및 백업/복원
              </h3>
              <DataManagementSection
                materials={materials}
                subjects={subjects}
                onRestoreMaterials={onRestoreMaterials}
                migrations={migrationBlocks}
              />
            </div>
          )}

          {activeSubTab === 'model' && (
            <div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-4 pb-2 border-b border-[#f1ede4]">
                복습 감쇠 모델 파라미터 (망각곡선 수식 설정)
              </h3>

              <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1.5 text-[#57544e] mb-4">
                <div className="flex items-center gap-1.5 font-academic-mono text-[11px] font-bold text-[#827d73]">
                  <Info className="w-3.5 h-3.5 text-blue-600" />
                  <span>학술 시연용 망각곡선 모델 안내</span>
                </div>
                <p className="leading-relaxed text-[11px]">
                  수식: <strong>R(t) = S0 · (1 + t/τ)^(-α)</strong>
                  <br />
                  본 파라미터는 대학 시험 준비 스케줄링 시연을 위한 수학적 감쇠 모형이며, 상대적 복습 우선순위 산출 지수입니다.
                </p>
              </div>

              <form onSubmit={handleSaveModel} className="space-y-4 max-w-lg text-xs">
                <div>
                  <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
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
                    className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
                  />
                  <p className="text-[10px] text-[#827d73] mt-1">
                    기본값: 2.0일 (값이 클수록 초기 망각 속도가 완만해짐)
                  </p>
                </div>

                <div>
                  <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                    감쇠 거듭제곱 지수 α (Alpha):
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="3.0"
                    value={alpha}
                    onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.5)}
                    required
                    className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
                  />
                  <p className="text-[10px] text-[#827d73] mt-1">
                    기본값: 0.65 (멱법칙 망각의 급격성 정도)
                  </p>
                </div>

                <div>
                  <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                    복습 권장 임계점 R_th (%):
                  </label>
                  <input
                    type="number"
                    min="30"
                    max="90"
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 60)}
                    required
                    className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
                  />
                  <p className="text-[10px] text-[#827d73] mt-1">
                    기본값: 60% (이 지한선 이하로 예측 잔존율이 떨어지면 오늘 복습으로 추천)
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs flex items-center gap-1.5 shadow-xs transition-colors"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>설정 저장</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetModelDefaults}
                    className="px-3 py-2 bg-[#faf8f4] hover:bg-[#f1ede4] border border-[#ded6c8] text-[#57544e] rounded-xs flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>기본값 복원</span>
                  </button>

                  {modelSaved && (
                    <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> 저장 완료
                    </span>
                  )}
                </div>
              </form>
            </div>
          )}

          {activeSubTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-2 pb-2 border-b border-[#f1ede4]">
                  계정 정보
                </h3>
                <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-xs space-y-1">
                  <div className="text-[#827d73] font-academic-mono text-[11px]">로그인된 이메일</div>
                  <div className="font-bold text-[#191817]">{currentUserEmail || '계정 정보 없음'}</div>
                </div>

                {onLogout && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={onLogout}
                      disabled={isLoggingOut}
                      className="px-3.5 py-1.5 bg-[#faf8f4] hover:bg-red-50 text-red-700 border border-[#ded6c8] hover:border-red-300 rounded-xs text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-[#f1ede4]">
                <h3 className="font-academic-serif font-bold text-sm text-[#c52828] mb-1">
                  위험 구역: 시연 데이터 초기화
                </h3>
                <p className="text-xs text-[#57544e] mb-3 leading-relaxed">
                  이 기기의 로컬에 저장된 학습 이력, 풀이 시도 및 사용자 입력 데이터를 초기 데모 상태로 재설정합니다.
                </p>
                <button
                  type="button"
                  onClick={onResetData}
                  className="px-3.5 py-1.5 bg-[#c52828] hover:bg-[#a81f1f] text-white rounded-xs text-xs font-bold transition-colors shadow-2xs"
                >
                  초기 데모 데이터로 재설정
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
