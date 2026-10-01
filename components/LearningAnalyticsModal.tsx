'use client';

import React, { useMemo, useState } from 'react';
import {
  Attempt,
  Concept,
  MockExamSession,
  PersonalizationCorrectionState,
  PersonalizationSettings,
  Problem,
  ProblemDifficulty,
  ProblemType,
  Subject,
  PERSONALIZATION_RULE_VERSION,
  REVIEW_TENDENCY_LABELS,
  ReviewTendency,
  PROBLEM_DIFFICULTY_LABELS,
} from '../lib/types';
import {
  ANALYTICS_EXCLUSION_LABELS,
  ANALYTICS_PERIOD_LABELS,
  AnalyticsPeriod,
  buildLearningAnalyticsReport,
  CONFIDENCE_ALIGNMENT_RULES,
} from '../lib/learningAnalytics';
import { PERSONALIZATION_CONSTANTS } from '../lib/personalization';
import { formatSeoulDate } from '../lib/dateUtils';
import {
  X,
  BarChart3,
  Sliders,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Info,
  RotateCcw,
  ArrowRight,
  ShieldAlert,
  Calendar,
  RefreshCw,
  Check,
} from 'lucide-react';

const PROBLEM_TYPE_LABELS: Record<ProblemType | 'unknown', string> = {
  essay_descriptive: '논술·서술형',
  calc_derivation: '계산 유도형',
  proof_counterexample: '증명·반례',
  error_spotting: '오류 검증형',
  impl_descriptive: '구현 서술형',
  algorithm_optimization: '알고리즘 최적화',
  complexity_proof: '복잡도 증명',
  debug_counterexample: '디버깅·반례',
  unknown: '유형 미확인',
};

function difficultyLabel(difficulty: ProblemDifficulty | 'unknown'): string {
  if (difficulty === 'unknown') return '난도 미확인';
  return PROBLEM_DIFFICULTY_LABELS[difficulty] || difficulty;
}

interface LearningAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  concepts: Concept[];
  problems: Problem[];
  attempts: Attempt[];
  mockExams: MockExamSession[];
  activeSubjectId: string;
  personalizationSettings: PersonalizationSettings;
  correctionState: PersonalizationCorrectionState;
  onUpdatePersonalizationSettings: (settings: PersonalizationSettings) => void;
  onResetPersonalizationSettings: () => void;
  onRecalculateCorrection: () => void;
  onOpenRecord: (subjectId: string, conceptId: string, attemptId?: string) => void;
}

export function LearningAnalyticsModal({
  isOpen,
  onClose,
  subjects,
  concepts,
  problems,
  attempts,
  mockExams,
  activeSubjectId,
  personalizationSettings,
  correctionState,
  onUpdatePersonalizationSettings,
  onResetPersonalizationSettings,
  onRecalculateCorrection,
  onOpenRecord,
}: LearningAnalyticsModalProps) {
  const [subjectFilter, setSubjectFilter] = useState<'all' | string>('all');
  const [period, setPeriod] = useState<AnalyticsPeriod>('last30');

  const report = useMemo(() => {
    if (!isOpen) return null;
    return buildLearningAnalyticsReport({
      attempts,
      mockExams,
      problems,
      subjects,
      concepts,
      subjectId: subjectFilter,
      period,
      referenceDate: new Date(),
    });
  }, [isOpen, attempts, mockExams, problems, subjects, concepts, subjectFilter, period]);

  if (!isOpen) return null;

  const reportData = report!;
  const { performance, vulnerabilities, confidence, records, excludedInPeriod, collection } = reportData;
  const excludedEntries = (Object.keys(ANALYTICS_EXCLUSION_LABELS) as (keyof typeof ANALYTICS_EXCLUSION_LABELS)[])
    .map((reason) => ({ reason, label: ANALYTICS_EXCLUSION_LABELS[reason], count: collection.excludedByReason[reason] }))
    .filter((e) => e.count > 0);

  const changeIcon =
    performance.change.status === 'improved' ? (
      <TrendingUp className="w-4 h-4 text-emerald-600" />
    ) : performance.change.status === 'declined' ? (
      <TrendingDown className="w-4 h-4 text-red-600" />
    ) : performance.change.status === 'stable' ? (
      <Minus className="w-4 h-4 text-stone-500" />
    ) : (
      <Info className="w-4 h-4 text-blue-600" />
    );

  const setTendency = (tendency: ReviewTendency) => {
    onUpdatePersonalizationSettings({ ...personalizationSettings, tendency, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="학습 분석">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-y-auto bg-[#faf8f4] border border-[#c8c2b5] shadow-xl rounded-xs">
        <header className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#c52828]" />
            <h2 className="font-academic-serif text-sm font-bold">학습 분석 · 개인별 복습 추천</h2>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-4 sm:p-5 space-y-4 text-xs">
          {/* Section 1: Filters */}
          <section className="bg-white border border-[#e2ded6] rounded-xs p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-academic-mono text-[11px] text-[#57544e]">과목 필터</span>
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="border border-[#ded6c8] rounded-xs px-2 py-1 bg-white text-[#191817]"
                >
                  <option value="all">전 과목</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-[10.5px] text-[#827d73]">
                  활성 과목: {subjects.find((s) => s.id === activeSubjectId)?.name || '-'}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {(Object.keys(ANALYTICS_PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-2.5 py-1 rounded-xs border text-[11px] font-semibold transition-colors ${
                      period === p
                        ? 'bg-[#191817] text-white border-[#191817]'
                        : 'bg-white text-[#57544e] border-[#ded6c8] hover:bg-[#faf8f4]'
                    }`}
                  >
                    {ANALYTICS_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {/* Exclusion audit */}
            <div className="pt-2 border-t border-[#f1ede4] text-[10.5px] font-academic-mono text-[#57544e] space-y-1">
              <div className="flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  분석 제외 기록: <strong className="text-[#191817]">{excludedInPeriod.length}건</strong> (기간 내) ·
                  초기 학습 {collection.eventStats.initialStudyCount}건 · 복습 이벤트 {collection.eventStats.reviewCount}건 ·
                  예정/미루기 제외 {collection.eventStats.scheduledExcludedCount}건 · 데모 이벤트 제외 {collection.eventStats.demoEventExcludedCount}건 ·
                  보완 풀이 {collection.assistedRevisionCount}건(독립 성과 제외) · 지연 재도전 {collection.rechallengeCount}건(독립 포함)
                </span>
              </div>
              {excludedEntries.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {excludedEntries.map((e) => (
                    <span key={e.reason} className="bg-[#f6f3eb] border border-[#ded6c8] px-1.5 py-0.5 rounded-2xs">
                      {e.label}: {e.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {records.length === 0 ? (
            <section className="bg-white border border-dashed border-[#c8c2b5] rounded-xs p-6 text-center space-y-2">
              <Info className="w-6 h-6 text-[#827d73] mx-auto" />
              <p className="text-[#191817] font-semibold">선택한 조건에 분석할 실제 학습 기록이 없습니다.</p>
              <p className="text-[#57544e] leading-relaxed">
                분석은 사용자가 확인·저장한 실제 풀이와 기록이 완료된 모의시험만 대상으로 합니다. 문제를 풀고 저장하거나 모의시험 결과를 확정하면
                여기에 반영됩니다. 예시 수치로 채우지 않습니다.
              </p>
            </section>
          ) : (
            <>
              {/* Section 2: Actual performance */}
              <section className="bg-white border border-[#e2ded6] rounded-xs p-3 space-y-3">
                <header className="flex items-center gap-1.5 font-bold text-[#191817]">
                  <Target className="w-4 h-4 text-[#c52828]" />
                  <span>1. 실제 풀이 성과 (관측값)</span>
                </header>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <MetricTile label="유효 풀이 수" value={`${performance.totalCount}건`} />
                  <MetricTile label="힌트 없이 제출" value={`${Math.round(performance.hintFreeRatio * 100)}%`} sub={`${performance.hintFreeCount}/${performance.totalCount}`} />
                  <MetricTile label="평균 평가 점수" value={performance.averageScore === null ? '-' : `${performance.averageScore}점`} />
                  <MetricTile label="유효 기록 기간" value={`${collection.eventStats.initialStudyCount + collection.eventStats.reviewCount} 학습 이벤트`} />
                </div>

                {/* Change */}
                <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs flex items-start gap-2">
                  {changeIcon}
                  <div className="space-y-0.5">
                    <div className="font-semibold text-[#191817]">
                      성과 변화:{' '}
                      {performance.change.status === 'improved'
                        ? '상승'
                        : performance.change.status === 'declined'
                        ? '하락'
                        : performance.change.status === 'stable'
                        ? '유지'
                        : '판단 보류'}
                      {performance.change.delta !== null && ` (Δ ${performance.change.delta > 0 ? '+' : ''}${performance.change.delta}점)`}
                    </div>
                    <p className="text-[#57544e]">{performance.change.note}</p>
                    <p className="text-[10.5px] text-[#827d73] font-academic-mono">
                      최근 표본 {performance.change.sampleSizeRecent} / 이전 표본 {performance.change.sampleSizePrevious} · 비교 가능 유형·난도 {performance.change.comparableGroups}개
                    </p>
                  </div>
                </div>

                {/* By type */}
                <div className="space-y-1">
                  <div className="font-academic-mono text-[11px] text-[#57544e] uppercase tracking-wider">2. 문제 유형별 성과 (유형·난도별 분리)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border border-[#ede8de]">
                      <thead className="bg-[#f6f3eb] font-academic-mono text-[#57544e]">
                        <tr>
                          <th className="text-left px-2 py-1">유형</th>
                          <th className="text-left px-2 py-1">난도</th>
                          <th className="text-right px-2 py-1">풀이</th>
                          <th className="text-right px-2 py-1">평균</th>
                          <th className="text-right px-2 py-1">범위</th>
                          <th className="text-right px-2 py-1">힌트 없음</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performance.byType.map((t) => (
                          <tr key={`${t.problemType}-${t.difficulty}`} className="border-t border-[#f1ede4]">
                            <td className="px-2 py-1 text-[#191817]">{PROBLEM_TYPE_LABELS[t.problemType]}</td>
                            <td className="px-2 py-1 text-[#57544e]">{difficultyLabel(t.difficulty)}</td>
                            <td className="px-2 py-1 text-right">{t.count}</td>
                            <td className="px-2 py-1 text-right font-semibold">{t.averageScore}</td>
                            <td className="px-2 py-1 text-right text-[#827d73]">{t.minScore}~{t.maxScore}</td>
                            <td className="px-2 py-1 text-right">{t.hintFreeCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-[#827d73]">* 난도·유형이 다른 점수는 서로 직접 비교하지 않습니다.</p>
                </div>

                {/* Error counts */}
                <div className="space-y-1">
                  <div className="font-academic-mono text-[11px] text-[#57544e] uppercase tracking-wider">오류 유형별 횟수·비율</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {performance.errorCounts.map((e) => (
                      <div key={e.errorType} className="bg-[#faf8f4] border border-[#ede8de] rounded-xs p-2">
                        <div className="text-[#57544e] text-[10.5px]">{e.label}</div>
                        <div className="font-bold text-[#191817]">{e.count}건 · {Math.round(e.ratio * 100)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Section 3: Repeated vulnerabilities */}
              <section className="bg-white border border-[#e2ded6] rounded-xs p-3 space-y-3">
                <header className="flex items-center gap-1.5 font-bold text-[#191817]">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>3. 반복 오류와 취약점</span>
                </header>

                <div className="space-y-1">
                  <div className="font-academic-mono text-[11px] text-[#57544e] uppercase tracking-wider">같은 개념에서 반복되는 오류</div>
                  {vulnerabilities.repeatedErrors.length === 0 ? (
                    <p className="text-[#827d73] text-[11px]">반복되는 오류 패턴이 아직 없습니다.</p>
                  ) : (
                    <ul className="space-y-1">
                      {vulnerabilities.repeatedErrors.map((e) => (
                        <li key={`${e.conceptId}-${e.errorType}`} className="flex items-center justify-between gap-2 bg-[#faf8f4] border border-[#ede8de] rounded-xs px-2 py-1.5">
                          <span>
                            <strong className="text-[#191817]">{e.conceptName}</strong> · {e.label} · {e.count}회 · 서로 다른 문제 {e.problemIds.length}개
                          </span>
                          <button
                            onClick={() => onOpenRecord(reportData.records.find((r) => r.primaryConceptId === e.conceptId)?.subjectId || activeSubjectId, e.conceptId)}
                            className="shrink-0 flex items-center gap-1 text-[10.5px] text-[#c52828] hover:underline"
                          >
                            기록 보기 <ArrowRight className="w-3 h-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="font-academic-mono text-[11px] text-[#57544e] uppercase tracking-wider">문제별 취약 루브릭 (문제 간 기준을 합치지 않음)</div>
                  {vulnerabilities.vulnerableRubricsByProblem.length === 0 ? (
                    <p className="text-[#827d73] text-[11px]">취약 루브릭 감점이 아직 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {vulnerabilities.vulnerableRubricsByProblem.map((p) => (
                        <li key={p.problemId} className="bg-[#faf8f4] border border-[#ede8de] rounded-xs p-2">
                          <div className="font-semibold text-[#191817] line-clamp-1">{p.problemTitle}</div>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {p.criteria.map((c) => (
                              <span key={c.label} className="bg-white border border-red-200 text-red-800 px-1.5 py-0.5 rounded-2xs text-[10.5px]">
                                {c.label} · 감점 {c.vulnerableCount}회 · 평균 {c.averageScore}/{c.maxScore}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="font-academic-mono text-[11px] text-[#57544e] uppercase tracking-wider">풀이 방법 선택·설명의 반복 어려움 (8단계 진단)</div>
                  {vulnerabilities.recordsWithDiagnosisCount === 0 ? (
                    <p className="text-[#827d73] text-[11px]">이유 진단이 있는 기록이 없습니다. (진단 없음은 낮은 평가로 간주하지 않습니다)</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {vulnerabilities.methodDifficulties.map((m) => (
                        <div key={m.criterionKey} className="bg-[#faf8f4] border border-[#ede8de] rounded-xs p-2">
                          <div className="text-[#57544e] text-[10.5px]">{m.label}</div>
                          <div className="font-bold text-[#191817]">보완 {m.needsImprovementCount} · 부분 {m.partialCount}</div>
                          <div className="text-[10px] text-[#827d73]">평가 가능 {m.applicableCount}건</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-[#827d73]">
                    진단 있음 {vulnerabilities.recordsWithDiagnosisCount}건 · 진단 없음 {vulnerabilities.recordsWithoutDiagnosisCount}건
                  </p>
                </div>
              </section>

              {/* Section 4: Confidence vs evaluation */}
              <section className="bg-white border border-[#e2ded6] rounded-xs p-3 space-y-3">
                <header className="flex items-center gap-1.5 font-bold text-[#191817]">
                  <Minus className="w-4 h-4 text-indigo-600" />
                  <span>4. 자신감과 평가 결과 비교</span>
                </header>

                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border border-[#ede8de]">
                    <thead className="bg-[#f6f3eb] font-academic-mono text-[#57544e]">
                      <tr>
                        <th className="text-left px-2 py-1">자신감</th>
                        <th className="text-right px-2 py-1">기록 수</th>
                        <th className="text-right px-2 py-1">평균 평가 점수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confidence.buckets.map((b) => (
                        <tr key={b.confidence} className="border-t border-[#f1ede4]">
                          <td className="px-2 py-1">{'★'.repeat(b.confidence)} ({b.confidence})</td>
                          <td className="px-2 py-1 text-right">{b.count}</td>
                          <td className="px-2 py-1 text-right font-semibold">{b.averageScore ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="bg-red-50/60 border border-red-200 rounded-xs p-2 space-y-1">
                    <div className="font-semibold text-red-900">높은 자신감 · 반복적 낮은 점수</div>
                    {confidence.overconfident.length === 0 ? (
                      <p className="text-[11px] text-red-800/80">해당 패턴 없음</p>
                    ) : (
                      <ul className="text-[11px] text-red-900 space-y-0.5">
                        {confidence.overconfident.map((p) => (
                          <li key={p.conceptId}>{p.conceptName}: {p.occurrences}회 · 평균 {p.averageScore}점</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="bg-emerald-50/60 border border-emerald-200 rounded-xs p-2 space-y-1">
                    <div className="font-semibold text-emerald-900">낮은 자신감 · 안정적 높은 점수</div>
                    {confidence.underconfident.length === 0 ? (
                      <p className="text-[11px] text-emerald-800/80">해당 패턴 없음</p>
                    ) : (
                      <ul className="text-[11px] text-emerald-900 space-y-0.5">
                        {confidence.underconfident.map((p) => (
                          <li key={p.conceptId}>{p.conceptName}: {p.occurrences}회 · 평균 {p.averageScore}점</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-[#827d73] leading-relaxed">
                  {CONFIDENCE_ALIGNMENT_RULES.description}
                  <br />
                  복합 문제의 평가는 문항 전체 점수이며, 연결된 각 개념을 개별 평가한 점수로 표시하지 않습니다.
                </p>
              </section>
            </>
          )}

          {/* Section 5: Personalization */}
          <section className="bg-white border border-[#e2ded6] rounded-xs p-3 space-y-3">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-[#191817]">
                <Sliders className="w-4 h-4 text-[#c52828]" />
                <span>5. 개인별 복습 설정과 적용 근거</span>
              </div>
              <button
                onClick={onRecalculateCorrection}
                className="flex items-center gap-1 px-2 py-1 text-[10.5px] border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4]"
              >
                <RefreshCw className="w-3 h-3" /> 보정 다시 계산
              </button>
            </header>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 p-2 border border-[#ede8de] rounded-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={personalizationSettings.enabled}
                  onChange={(e) =>
                    onUpdatePersonalizationSettings({ ...personalizationSettings, enabled: e.target.checked, updatedAt: new Date().toISOString() })
                  }
                />
                <span>개인별 추천 사용</span>
              </label>

              <label className="flex items-center gap-2 p-2 border border-[#ede8de] rounded-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={personalizationSettings.autoAdjust}
                  onChange={(e) =>
                    onUpdatePersonalizationSettings({ ...personalizationSettings, autoAdjust: e.target.checked, updatedAt: new Date().toISOString() })
                  }
                />
                <span>자동 보정 사용</span>
              </label>

              <div className="p-2 border border-[#ede8de] rounded-xs space-y-1">
                <span className="text-[10.5px] text-[#827d73]">복습 성향</span>
                <div className="flex gap-1">
                  {(Object.keys(REVIEW_TENDENCY_LABELS) as ReviewTendency[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTendency(t)}
                      className={`px-2 py-1 rounded-xs border text-[10.5px] ${
                        personalizationSettings.tendency === t
                          ? 'bg-[#191817] text-white border-[#191817]'
                          : 'bg-white border-[#ded6c8] hover:bg-[#faf8f4]'
                      }`}
                    >
                      {REVIEW_TENDENCY_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[10.5px] text-[#827d73]">
                자동 보정은 최근 {PERSONALIZATION_CONSTANTS.WINDOW_DAYS}일 기록, 과목당 풀이 {PERSONALIZATION_CONSTANTS.MIN_ATTEMPTS_PER_SUBJECT}건, 학습 날짜 {PERSONALIZATION_CONSTANTS.MIN_DISTINCT_DAYS_PER_SUBJECT}일, 서로 다른 문제 {PERSONALIZATION_CONSTANTS.MIN_DISTINCT_PROBLEMS_PER_SUBJECT}개를 요구합니다.
                배율은 {PERSONALIZATION_CONSTANTS.MULTIPLIER_MIN}~{PERSONALIZATION_CONSTANTS.MULTIPLIER_MAX}로 제한됩니다. (학술 상수 아닌 초기 제품 설정)
              </p>
              <button
                onClick={onResetPersonalizationSettings}
                className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10.5px] text-[#c52828] border border-[#fecaca] rounded-xs hover:bg-[#fef2f2]"
              >
                <RotateCcw className="w-3 h-3" /> 보정값 초기화
              </button>
            </div>

            {/* Correction state details */}
            <div className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-academic-mono text-[10.5px] bg-white border border-[#e2ded6] px-1.5 py-0.5 rounded-2xs">
                  규칙 버전: {correctionState.ruleVersion || PERSONALIZATION_RULE_VERSION}
                </span>
                <span className="font-academic-mono text-[10.5px] bg-white border border-[#e2ded6] px-1.5 py-0.5 rounded-2xs">
                  계산 시각: {formatCorrectionTime(correctionState.computedAt)}
                </span>
                <span className={`font-academic-mono text-[10.5px] px-1.5 py-0.5 rounded-2xs border ${
                  correctionState.appliedMultiplier < 1
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : correctionState.appliedMultiplier > 1
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-white text-[#57544e] border-[#e2ded6]'
                }`}>
                  적용 배율 x{correctionState.appliedMultiplier.toFixed(2)} (성향 x{correctionState.tendencyMultiplier.toFixed(2)} · 자동 x{correctionState.autoMultiplier.toFixed(2)})
                </span>
                <span className={`font-academic-mono text-[10.5px] px-1.5 py-0.5 rounded-2xs border ${
                  correctionState.dataSufficient ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-stone-100 text-stone-700 border-stone-300'
                }`}>
                  {correctionState.dataSufficient ? '자동 보정 근거 확보' : '데이터 부족 (기본 추천 유지)'}
                </span>
              </div>

              <div className="text-[10.5px] text-[#57544e] font-academic-mono">
                사용 기록 {correctionState.usedAttemptCount}건 · 서로 다른 학습 날짜 {correctionState.usedDistinctDays}일 · 서로 다른 문제 {correctionState.usedDistinctProblems}개 · 참조 ID {correctionState.basisRefs.length}건
              </div>

              <ul className="text-[11px] text-[#57544e] space-y-0.5 list-disc pl-4">
                {correctionState.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>

              {correctionState.perSubject.length > 0 && (
                <div className="overflow-x-auto pt-1">
                  <table className="w-full text-[10.5px] border border-[#ede8de] bg-white">
                    <thead className="bg-[#f6f3eb] font-academic-mono text-[#57544e]">
                      <tr>
                        <th className="text-left px-2 py-1">과목</th>
                        <th className="text-right px-2 py-1">기록</th>
                        <th className="text-right px-2 py-1">날짜</th>
                        <th className="text-right px-2 py-1">문제</th>
                        <th className="text-right px-2 py-1">평균</th>
                        <th className="text-right px-2 py-1">힌트의존</th>
                        <th className="text-left px-2 py-1">방향</th>
                      </tr>
                    </thead>
                    <tbody>
                      {correctionState.perSubject.map((s) => (
                        <tr key={s.subjectId} className="border-t border-[#f1ede4]">
                          <td className="px-2 py-1">{s.subjectName}{!s.eligible && ' (기록 부족)'}</td>
                          <td className="px-2 py-1 text-right">{s.attemptCount}</td>
                          <td className="px-2 py-1 text-right">{s.distinctDays}</td>
                          <td className="px-2 py-1 text-right">{s.distinctProblems}</td>
                          <td className="px-2 py-1 text-right">{s.recentAverageScore ?? '-'}</td>
                          <td className="px-2 py-1 text-right">{Math.round(s.hintDependencyRatio * 100)}%</td>
                          <td className="px-2 py-1">
                            {s.direction === 'shorten' ? '단축' : s.direction === 'lengthen' ? '연장' : '유지'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-[10px] text-[#827d73] leading-relaxed">
              ※ 개인별 보정은 <strong>추천 간격만</strong> 조정합니다. 실제 점수, 과거 이벤트, 저장된 평가는 변경되지 않습니다. 복합 문제는 연결된 각 개념을 개별 평가하지 않습니다.
            </p>
          </section>

          {/* Record links footer */}
          <section className="bg-[#f6f3eb] border border-[#ded6c8] rounded-xs p-3">
            <div className="flex items-center gap-1.5 font-academic-mono text-[11px] text-[#57544e] mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> 분석에 사용된 실제 풀이 기록
            </div>
            <ul className="space-y-1 max-h-44 overflow-y-auto">
              {records
                .slice()
                .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                .map((r) => (
                  <li key={r.recordId} className="flex items-center justify-between gap-2 bg-white border border-[#ede8de] rounded-xs px-2 py-1">
                    <span className="line-clamp-1">
                      <span className="text-[#827d73] font-academic-mono text-[10.5px]">{formatSeoulDate(r.at, { includeYear: true })}</span>{' '}
                      <strong className="text-[#191817]">{r.problemTitle}</strong> · {PROBLEM_TYPE_LABELS[r.problemType]} · {r.score}점
                      {r.isComposite && <span className="ml-1 text-[10px] text-indigo-700">[복합·전체점수]</span>}
                      {r.source === 'mock_exam' && <span className="ml-1 text-[10px] text-purple-700">[모의시험]</span>}
                    </span>
                    <button
                      onClick={() => onOpenRecord(r.subjectId, r.primaryConceptId, r.attemptId)}
                      className="shrink-0 flex items-center gap-1 text-[10.5px] text-[#c52828] hover:underline"
                    >
                      기록 보기 <ArrowRight className="w-3 h-3" />
                    </button>
                  </li>
                ))}
            </ul>
          </section>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs">
              <Check className="w-3.5 h-3.5 text-emerald-400" /> 닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCorrectionTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '-';
  return `${formatSeoulDate(iso, { includeYear: true })} ${date.toLocaleTimeString('ko-KR', { hour12: false })}`;
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#faf8f4] border border-[#ede8de] rounded-xs p-2">
      <div className="text-[10.5px] text-[#827d73]">{label}</div>
      <div className="font-bold text-[#191817]">{value}</div>
      {sub && <div className="text-[10px] text-[#827d73] font-academic-mono">{sub}</div>}
    </div>
  );
}
