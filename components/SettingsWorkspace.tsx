'use client';

import React, { useState } from 'react';
import type { Material, RetentionModelSettings, Subject } from '../lib/types';
import { DEFAULT_RETENTION_SETTINGS } from '../lib/retentionModel';
import { AiConnectionSection } from './AiConnectionSection';
import { MaterialPolicySection } from './MaterialPolicySection';
import { DataManagementSection, type MigrationUiBlock } from './DataManagementSection';
import { RemindersSection } from './RemindersSection';
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
  Bell,
  BarChart3,
} from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  SectionCard,
  WorkspaceHeader,
} from './ui/WorkspacePrimitives';

export interface SettingsWorkspaceProps {
  settings: RetentionModelSettings;
  onSaveSettings: (settings: RetentionModelSettings) => void;
  materials: Material[];
  subjects: Subject[];
  onRestoreMaterials: (restored: Material[]) => boolean | Promise<boolean>;
  migrationBlocks: MigrationUiBlock[];
  currentUserEmail?: string | null;
  onLogout?: () => void;
  isLoggingOut?: boolean;
  onOpenAiMetrics?: () => void;
}

export function SettingsWorkspace({
  settings,
  onSaveSettings,
  materials,
  subjects,
  onRestoreMaterials,
  migrationBlocks,
  currentUserEmail,
  onLogout,
  isLoggingOut = false,
  onOpenAiMetrics,
}: SettingsWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<'api' | 'reminders' | 'policy' | 'data' | 'model' | 'account'>('api');

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

  const navItems = [
    { id: 'api' as const, label: 'AI API 연결', icon: Key },
    { id: 'reminders' as const, label: '복습 알림 설정', icon: Bell },
    { id: 'policy' as const, label: '자료 저장 정책', icon: Database },
    { id: 'data' as const, label: '데이터 이관·백업', icon: Database },
    { id: 'model' as const, label: '망각곡선 모델', icon: Sliders },
    { id: 'account' as const, label: '계정', icon: User },
  ];

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <WorkspaceHeader
        icon={<Settings className="w-5 h-5" />}
        title="환경 설정 및 시스템 관리"
        subtitle="API 연결 · 복습 알림 · 자료 저장 정책 · 데이터 백업 및 복원 · 망각곡선 모델"
      />

      {/* Main Settings Navigation & Content Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* Navigation Sidebar (3 cols) */}
        <SectionCard padding="none" className="md:col-span-3 p-2 flex md:flex-col gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSubTab(item.id)}
                className={`shrink-0 md:w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xs font-semibold whitespace-nowrap transition-colors text-left ${
                  isActive
                    ? 'bg-[#191817] text-white'
                    : 'text-[#57544e] hover:bg-[#faf8f4] hover:text-[#191817]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#827d73]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {onOpenAiMetrics && (
            <div className="hidden md:block pt-2 border-t border-[#f1ede4] mt-2">
              <button
                type="button"
                onClick={onOpenAiMetrics}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-xs font-semibold text-[#191817] bg-[#faf8f4] hover:bg-[#f4f1ea] border border-[#ded6c8] transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#c52828]" />
                  <span>AI 운영/비용 지표</span>
                </span>
                <Badge variant="neutral">관리자</Badge>
              </button>
            </div>
          )}
        </SectionCard>

        {/* Content Pane (9 cols) */}
        <SectionCard padding="md" className="md:col-span-9 sm:p-6">
          {activeSubTab === 'api' && (
            <div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-4 pb-2 border-b border-[#f1ede4]">
                AI API 연결 설정 (학교 BAZE Gateway / DeepSeek)
              </h3>
              <AiConnectionSection />

              {onOpenAiMetrics && (
                <div className="mt-4 p-3 bg-purple-50/70 border border-purple-200 rounded-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-purple-950 block">AI 운영 호출량 및 비용 지표 대시보드</span>
                    <span className="text-[11px] text-purple-800">
                      총 호출 수, 토큰 사용량, 성공률, USD/KRW 예상 비용 및 이상 호출 현황을 실시간 조회합니다.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAiMetrics}
                    className="px-3 py-1.5 text-xs font-bold bg-purple-800 hover:bg-purple-900 text-white rounded-xs shadow-2xs shrink-0 transition-colors"
                  >
                    지표 보기
                  </button>
                </div>
              )}
            </div>
          )}

          {activeSubTab === 'reminders' && (
            <div>
              <RemindersSection currentUserEmail={currentUserEmail} />
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
                  <label htmlFor="model-tau-input" className="block text-xs text-[#57544e] mb-1 font-semibold">
                    기억 안정성 상수 τ (Tau, 일 단위)
                  </label>
                  <Input
                    id="model-tau-input"
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="30"
                    value={tau}
                    onChange={(e) => setTau(parseFloat(e.target.value) || 1)}
                    required
                  />
                  <p className="text-xs text-[#827d73] mt-1">
                    기본값: 2.0일 (값이 클수록 초기 망각 속도가 완만해짐)
                  </p>
                </div>

                <div>
                  <label htmlFor="model-alpha-input" className="block text-xs text-[#57544e] mb-1 font-semibold">
                    감쇠 거듭제곱 지수 α (Alpha)
                  </label>
                  <Input
                    id="model-alpha-input"
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="3.0"
                    value={alpha}
                    onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.5)}
                    required
                  />
                  <p className="text-xs text-[#827d73] mt-1">
                    기본값: 0.65 (멱법칙 망각의 급격성 정도)
                  </p>
                </div>

                <div>
                  <label htmlFor="model-threshold-input" className="block text-xs text-[#57544e] mb-1 font-semibold">
                    복습 권장 임계점 R_th (%)
                  </label>
                  <Input
                    id="model-threshold-input"
                    type="number"
                    min="30"
                    max="90"
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 60)}
                    required
                  />
                  <p className="text-xs text-[#827d73] mt-1">
                    기본값: 60% (이 지한선 이하로 예측 잔존율이 떨어지면 오늘 복습으로 추천)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button type="submit" variant="primary" size="md">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>설정 저장</span>
                  </Button>

                  <Button type="button" variant="secondary" size="md" onClick={handleResetModelDefaults}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>기본값 복원</span>
                  </Button>

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
                  <div className="text-[#827d73] text-xs">로그인된 계정</div>
                  <div className="font-bold text-[#191817]">{currentUserEmail || '계정 정보 없음'}</div>
                </div>

                {onLogout && (
                  <div className="mt-3">
                    <Button
                      variant="danger"
                      size="md"
                      onClick={onLogout}
                      disabled={isLoggingOut}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
                    </Button>
                  </div>
                )}
              </div>

            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
