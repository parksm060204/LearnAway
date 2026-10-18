'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  BarChart3,
  AlertTriangle,
  RefreshCw,
  Coins,
  Cpu,
  Clock,
  ShieldAlert,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { AiUsageSummary, AiUsageTelemetryRecord } from '../lib/aiCostTelemetry';

interface AdminAiMetricsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminAiMetricsModal({ isOpen, onClose }: AdminAiMetricsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [recentRecords, setRecentRecords] = useState<AiUsageTelemetryRecord[]>([]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ai-metrics?limit=30');
      if (!res.ok) {
        throw new Error(`통계 조회 실패 (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (data.success && data.summary) {
        setSummary(data.summary);
        setRecentRecords(data.recentRecords || []);
      } else {
        throw new Error(data.error || '통계 응답 형식이 올바르지 않습니다.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/ai-metrics?limit=30');
        if (!res.ok) throw new Error(`통계 조회 실패 (HTTP ${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.summary) {
          setSummary(data.summary);
          setRecentRecords(data.recentRecords || []);
          setError(null);
        } else {
          setError(data.error || '통계 응답 형식 오류');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '조회 실패');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white border border-[#c8c2b5] rounded-xs shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col font-sans overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#ded6c8] bg-[#faf8f4] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xs bg-[#191817] text-white flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-academic-serif text-[#191817] flex items-center gap-2">
                <span>AI 운영 비용 및 토큰 계측 대시보드</span>
                <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded-2xs font-bold">
                  운영자 전용
                </span>
              </h2>
              <p className="text-[11px] text-[#57544e]">
                실제 모델별 토큰 사용량, USD/KRW 원가 추정치 및 어뷰징 탐지 현황
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchMetrics}
              disabled={loading}
              className="p-1.5 text-[#57544e] hover:text-[#191817] hover:bg-[#eae6df] rounded-xs transition-colors"
              title="새로고침"
              aria-label="통계 새로고침"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#57544e] hover:text-[#191817] hover:bg-[#eae6df] rounded-xs transition-colors"
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {loading && !summary ? (
            <div className="py-16 text-center text-xs text-[#827d73] space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#c52828]" />
              <p>AI 텔레메트리 지표 집계 중...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xs text-xs text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          ) : summary ? (
            <>
              {/* Anomaly Warning Banner (if any) */}
              {summary.anomalies.length > 0 && (
                <div className="p-3.5 bg-red-50 border border-red-300 rounded-xs text-xs text-red-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-red-800">
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                    <span>비정상 대량 호출 의심 사용자 (Anomaly) 탐지됨 ({summary.anomalies.length}건)</span>
                  </div>
                  {summary.anomalies.map((anom, idx) => (
                    <div key={idx} className="text-[11px] text-red-700 pl-5">
                      · 사용자 [{anom.userId.slice(0, 12)}...]: {anom.reason} ({anom.requestCount}회 요청, {anom.totalTokens.toLocaleString()} 토큰)
                    </div>
                  ))}
                </div>
              )}

              {/* 4 Summary KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                  <span className="text-[10px] font-academic-mono text-[#827d73] uppercase">총 호출 수 / 성공률</span>
                  <div className="text-base font-bold font-academic-mono text-[#191817]">
                    {summary.totalRequests.toLocaleString()}회
                  </div>
                  <div className="text-[11px] text-emerald-700 font-medium">
                    성공률 {(100 - summary.failureRatePercent).toFixed(1)}% (실패 {summary.failedRequests}회)
                  </div>
                </div>

                <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                  <span className="text-[10px] font-academic-mono text-[#827d73] uppercase">소모 토큰 합계</span>
                  <div className="text-base font-bold font-academic-mono text-[#191817]">
                    {Object.values(summary.tokensByModel)
                      .reduce((acc, m) => acc + m.total, 0)
                      .toLocaleString()} 토큰
                  </div>
                  <div className="text-[11px] text-[#57544e]">
                    입출력 실측 및 보수 추정
                  </div>
                </div>

                <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                  <span className="text-[10px] font-academic-mono text-[#827d73] uppercase">누적 총 원가 (USD/KRW)</span>
                  <div className="text-base font-bold font-academic-mono text-[#c52828]">
                    ₩{Math.round(summary.totalCostKrw).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-[#827d73] font-academic-mono">
                    ${summary.totalCostUsd.toFixed(4)} (환율 1,400원)
                  </div>
                </div>

                <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                  <span className="text-[10px] font-academic-mono text-[#827d73] uppercase">비용 주체별 분리</span>
                  <div className="text-xs font-bold text-[#191817] flex items-center justify-between">
                    <span>체험 크레딧:</span>
                    <span className="font-academic-mono text-amber-800">₩{Math.round(summary.operatorTrialConsumption.estimatedCostKrw).toLocaleString()}</span>
                  </div>
                  <div className="text-xs font-bold text-[#191817] flex items-center justify-between">
                    <span>개인 API 키:</span>
                    <span className="font-academic-mono text-emerald-800">₩{Math.round(summary.personalKeyConsumption.estimatedCostKrw).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Task Breakdown & Model Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-white border border-[#ded6c8] rounded-xs space-y-2">
                  <h3 className="text-xs font-bold text-[#191817] flex items-center gap-1.5 border-b border-[#f1ede4] pb-2">
                    <Cpu className="w-3.5 h-3.5 text-[#827d73]" />
                    <span>기능별 호출 건수</span>
                  </h3>
                  <div className="space-y-1.5 pt-1">
                    {Object.entries(summary.requestsByTask).length === 0 ? (
                      <p className="text-xs text-[#827d73]">기록된 작업이 없습니다.</p>
                    ) : (
                      Object.entries(summary.requestsByTask).map(([task, count]) => (
                        <div key={task} className="flex items-center justify-between text-xs">
                          <span className="text-[#57544e] font-academic-mono">{task}</span>
                          <span className="font-bold text-[#191817] font-academic-mono">{count}회</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 bg-white border border-[#ded6c8] rounded-xs space-y-2">
                  <h3 className="text-xs font-bold text-[#191817] flex items-center gap-1.5 border-b border-[#f1ede4] pb-2">
                    <Coins className="w-3.5 h-3.5 text-amber-600" />
                    <span>모델별 원가 및 토큰 현황</span>
                  </h3>
                  <div className="space-y-1.5 pt-1">
                    {Object.entries(summary.tokensByModel).length === 0 ? (
                      <p className="text-xs text-[#827d73]">기록된 모델이 없습니다.</p>
                    ) : (
                      Object.entries(summary.tokensByModel).map(([model, tok]) => {
                        const cost = summary.costByModel[model] || { usd: 0, krw: 0 };
                        return (
                          <div key={model} className="flex items-center justify-between text-xs">
                            <span className="text-[#57544e] font-academic-mono">{model}</span>
                            <span className="font-bold text-[#191817] font-academic-mono">
                              {tok.total.toLocaleString()} 토큰 (₩{Math.round(cost.krw)})
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Recent 10 Telemetry Records Table */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#191817] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#827d73]" />
                    <span>최근 호출 기록 (실시간 링 버퍼)</span>
                  </span>
                  <span className="text-[11px] text-[#827d73] font-academic-mono">
                    최근 {recentRecords.length}건
                  </span>
                </h3>
                <div className="border border-[#ded6c8] rounded-xs overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#faf8f4] border-b border-[#ded6c8] text-[#57544e] font-academic-mono text-[10px]">
                      <tr>
                        <th className="py-2 px-3">시각</th>
                        <th className="py-2 px-3">기능</th>
                        <th className="py-2 px-3">모델</th>
                        <th className="py-2 px-3">크레딧 구분</th>
                        <th className="py-2 px-3 text-right">토큰</th>
                        <th className="py-2 px-3 text-right">소요시간</th>
                        <th className="py-2 px-3 text-center">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f1ede4]">
                      {recentRecords.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-xs text-[#827d73]">
                            아직 텔레메트리 기록이 없습니다. AI 평가나 문제 생성을 실행하면 여기에 기록됩니다.
                          </td>
                        </tr>
                      ) : (
                        recentRecords.slice(0, 10).map((r) => (
                          <tr key={r.id} className="hover:bg-[#faf8f4]">
                            <td className="py-2 px-3 font-academic-mono text-[11px] text-[#827d73] whitespace-nowrap">
                              {r.createdAt ? new Date(r.createdAt).toLocaleTimeString('ko-KR') : '-'}
                            </td>
                            <td className="py-2 px-3 font-academic-mono text-[11px] text-[#191817]">
                              {r.taskType}
                            </td>
                            <td className="py-2 px-3 font-academic-mono text-[11px] text-[#57544e]">
                              {r.model}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`text-[10px] font-academic-mono px-1.5 py-0.5 rounded-2xs border ${
                                r.creditSource === 'personal_key'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}>
                                {r.creditSource === 'personal_key' ? '개인키' : '체험크레딧'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-academic-mono text-[11px]">
                              {r.totalTokens.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-academic-mono text-[11px] text-[#827d73]">
                              {r.executionTimeMs}ms
                            </td>
                            <td className="py-2 px-3 text-center">
                              {r.status === 'success' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline-block" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-600 inline-block" />
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#ded6c8] bg-[#faf8f4] flex items-center justify-between shrink-0 text-xs">
          <span className="text-[#827d73] text-[11px]">
            기본 모델: <strong>deepseek-v4.1-flash</strong> ($0.14/1M in, $0.28/1M out)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
