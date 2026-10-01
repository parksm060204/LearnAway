import React, { useState } from 'react';
import {
  Concept,
  ReviewEvent,
  Attempt,
  Problem,
  ProblemReportType,
  ERROR_TYPE_LABELS,
  METHOD_REASON_RATING_LABELS,
  isProblemAvailableForPractice,
} from '../lib/types';
import { ProblemReportModal } from './ProblemReportModal';
import {
  FileText,
  ExternalLink,
  AlertTriangle,
  Eye,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Compass,
  BrainCircuit,
} from 'lucide-react';

interface ArchiveRecordDetailProps {
  concept: Concept;
  event: ReviewEvent | null;
  attempts?: Attempt[];
  problems?: Problem[];
  onOpenSourceModal: (sourceRef: string) => void;
  onReportProblem?: (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => { success: boolean; error?: string };
  onOpenLogicStrengthen?: (attempt: Attempt) => void;
}

export function ArchiveRecordDetail({
  concept,
  event,
  attempts = [],
  problems = [],
  onOpenSourceModal,
  onReportProblem,
  onOpenLogicStrengthen,
}: ArchiveRecordDetailProps) {
  const [isAttemptExpanded, setIsAttemptExpanded] = useState(false);
  const [isModelAnswerExpanded, setIsModelAnswerExpanded] = useState(false);
  const [showLatestProblemDiff, setShowLatestProblemDiff] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  if (!event || concept.status === 'unstudied') {
    return (
      <div className="w-full bg-white border border-[#e2ded6] rounded-xs p-5 text-xs text-[#57544e] space-y-2 shadow-2xs">
        <div className="flex items-center gap-2 font-academic-mono text-xs font-bold text-[#191817] pb-2 border-b border-[#f1ede4]">
          <span className="font-academic-mono text-xs font-bold text-[#827d73]">CONCEPT OVERVIEW</span>
          <span className="text-[#c8c2b5]">|</span>
          <span className="font-academic-serif">{concept.title}</span>
          <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
            {concept.status === 'unstudied' ? '미학습 상태' : '이력 대기'}
          </span>
        </div>
        {concept.description && (
          <p className="text-xs leading-relaxed text-[#2e2c29]">{concept.description}</p>
        )}
        {concept.coreDefinitionFormulaOrAlgorithm && (
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded font-academic-mono text-xs overflow-x-auto whitespace-pre-wrap">
            {concept.coreDefinitionFormulaOrAlgorithm}
          </div>
        )}
        <div className="text-[11px] font-academic-mono text-[#827d73] pt-1">
          {concept.status === 'unstudied'
            ? '사용자 자료에서 추출 승인된 개념입니다. 학습 완료 등록 전까지는 임의의 복습 점수가 생성되지 않습니다.'
            : '선택된 이력 기록이 없습니다.'}
        </div>
      </div>
    );
  }

  const isAttempt = event.kind === 'attempt' || event.kind === 'review';

  // Find linked attempt if available
  const matchingAttempt = attempts.find(
    (a) =>
      (event.attemptId && a.id === event.attemptId) ||
      (a.conceptId === concept.id && a.at === event.at)
  );

  // 답안 논리 강화는 확정 저장된 AI 평가 Attempt에서만 시작한다.
  // 평가 초안/데모 기록/품질 검토 중 문제는 제외한다.
  const matchingProblem = matchingAttempt
    ? problems.find((p) => p.id === matchingAttempt.problemId)
    : undefined;
  const canStrengthen = Boolean(
    matchingAttempt &&
      onOpenLogicStrengthen &&
      matchingAttempt.isAiEvaluated === true &&
      matchingAttempt.needsReview !== true &&
      matchingProblem &&
      matchingProblem.isDemo !== true &&
      isProblemAvailableForPractice(matchingProblem)
  );

  return (
    <div id="archive-record-detail" className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs space-y-3.5 scroll-mt-20">
      {/* Archive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#f1ede4]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-academic-mono text-xs font-bold text-[#827d73]">ARCHIVE RECORD</span>
          <span className="text-[#c8c2b5]">|</span>
          <h3 className="text-xs sm:text-sm font-bold text-[#191817] font-academic-serif">
            [Day {event.dayOffset >= 0 ? `+${event.dayOffset}` : event.dayOffset}] {event.title} 정밀 첨삭 기록
          </h3>
          {event.needsReview && (
            <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded-2xs font-semibold">
              검토 필요
            </span>
          )}
        </div>

        {/* Source link */}
        <button
          onClick={() => onOpenSourceModal(event.sourceRef || concept.chapterRef)}
          className="flex items-center gap-1.5 text-xs text-[#57544e] hover:text-[#c52828] font-academic-mono transition-colors self-start sm:self-auto group"
        >
          <FileText className="w-3.5 h-3.5 text-[#827d73] group-hover:text-[#c52828]" />
          <span>SOURCE: {event.sourceRef || concept.chapterRef}</span>
          <ExternalLink className="w-3 h-3 text-[#827d73] group-hover:text-[#c52828]" />
        </button>
      </div>

      {/* Evaluation Summary */}
      <div className="bg-[#faf8f4] border border-[#ded6c8] p-3.5 rounded-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-academic-mono text-[11px] font-bold text-[#827d73] uppercase tracking-wider">
            EVALUATION SUMMARY:
          </span>
          {event.errorType && event.errorType !== 'none' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-academic-mono px-2 py-0.5 rounded-xs bg-[#fef2f2] border border-[#fecaca] text-[#c52828] font-semibold">
              <AlertTriangle className="w-3 h-3" />
              진단 오답 유형: {ERROR_TYPE_LABELS[event.errorType]}
            </span>
          )}
        </div>

        <p className="text-sm sm:text-base text-[#191817] leading-[1.75] korean-prose font-medium">
          &ldquo;{event.evaluationSummary || event.notes || '기록된 정밀 첨삭 요약이 없습니다.'}&rdquo;
        </p>

        {/* Confidence and Hint metrics if available */}
        {isAttempt && (
          <div className="pt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-academic-mono text-[#827d73] border-t border-[#f1ede4]">
            {event.confidence !== undefined && (
              <span>
                자가 확신도:{' '}
                <strong className="text-[#191817]">
                  {'★'.repeat(event.confidence)}{'☆'.repeat(5 - event.confidence)} ({event.confidence}/5)
                </strong>
              </span>
            )}
            {event.hintCount !== undefined && (
              <span>
                열람 힌트 수: <strong className="text-[#191817]">{event.hintCount}개</strong>
              </span>
            )}
            {event.resultScore !== undefined && (
              <span>
                획득 점수:{' '}
                <strong className="text-[#c52828] font-bold">{event.resultScore}점</strong>
              </span>
            )}
          </div>
        )}

        {/* Strengths & Critical Improvements callout */}
        {(event.strengths || event.criticalImprovements) && (
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs border-t border-[#f1ede4]">
            {event.strengths && (
              <div className="p-2 bg-emerald-50/60 border border-emerald-200 rounded-2xs">
                <span className="font-bold text-emerald-950 text-[10.5px] block font-academic-mono">
                  ✓ 잘한 점:
                </span>
                <span className="text-[11px] text-emerald-900">{event.strengths}</span>
              </div>
            )}
            {event.criticalImprovements && (
              <div className="p-2 bg-amber-50/60 border border-amber-200 rounded-2xs">
                <span className="font-bold text-amber-950 text-[10.5px] block font-academic-mono">
                  ▲ 보완할 점:
                </span>
                <span className="text-[11px] text-amber-900">{event.criticalImprovements}</span>
              </div>
            )}
          </div>
        )}

        {canStrengthen && matchingAttempt && (
          <div className="pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={() => onOpenLogicStrengthen!(matchingAttempt)}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#191817] hover:bg-[#33302b] rounded-xs transition-colors"
            >
              <BrainCircuit className="w-3.5 h-3.5 text-amber-400" />
              <span>답안 논리 강화 세션 시작 (질문 → 보완 답안 → 지연 재도전)</span>
            </button>
          </div>
        )}
      </div>

      {/* Rubric Breakdown Cards */}
      {event.rubricScores && event.rubricScores.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-academic-mono text-[#827d73] font-semibold">
            채점 루브릭 기준별 배점 및 세부 분석:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {event.rubricScores.map((rubric) => (
              <div
                key={rubric.criterionId}
                className={`p-3 rounded-xs border flex flex-col justify-between space-y-1.5 ${
                  rubric.isVulnerable
                    ? 'border-[#c52828] bg-[#fef2f2]/60'
                    : 'border-[#ded6c8] bg-[#fcfbf9]'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <span
                    className={`text-xs font-bold leading-tight ${
                      rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'
                    }`}
                  >
                    {rubric.label}
                  </span>
                  <span
                    className={`font-academic-mono text-xs font-bold shrink-0 ${
                      rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'
                    }`}
                  >
                    {rubric.score.toFixed(1)} / {rubric.maxScore.toFixed(1)}점
                  </span>
                </div>

                {rubric.feedback && (
                  <p className="text-[11px] text-[#57544e] leading-snug">
                    {rubric.feedback}
                  </p>
                )}

                {rubric.evidenceQuote && (
                  <div className="text-[10px] text-[#827d73] border-t border-[#f1ede4] pt-1">
                    <span className="font-mono">근거: </span>
                    <span className="italic line-clamp-2">&ldquo;{rubric.evidenceQuote}&rdquo;</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage 4 & 6: Re-view Full Saved Attempt Section with Problem Versioning */}
      {matchingAttempt && (() => {
        const matchedProblem = problems.find((p) => p.id === matchingAttempt.problemId);
        const attemptVersion = matchingAttempt.problemVersion || 1;
        const currentVersion = matchedProblem?.version || 1;
        const isProblemRevised = Boolean(matchedProblem && currentVersion > attemptVersion);
        const isQuarantined = Boolean(
          matchedProblem &&
          (matchedProblem.qualityStatus === 'reported' ||
            matchedProblem.qualityStatus === 'under_review' ||
            matchedProblem.qualityStatus === 'review_after_edit' ||
            matchedProblem.qualityStatus === 'suspended')
        );

        return (
          <div className="border border-[#ded6c8] rounded-xs bg-[#faf8f4] overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAttemptExpanded(!isAttemptExpanded)}
              className="w-full px-4 py-2 bg-[#f6f3eb] hover:bg-[#ece6da] flex items-center justify-between text-xs transition-colors"
            >
              <div className="flex items-center gap-2 font-bold text-[#191817]">
                <Eye className="w-3.5 h-3.5 text-[#c52828]" />
                <span>당시 제출 답안 전문 및 평가 상세 기록 열람</span>
                <span className="text-[10px] font-academic-mono bg-[#ded6c8] text-[#57544e] px-1.5 py-0.2 rounded-2xs font-semibold">
                  풀이 당시 문제 v{attemptVersion}
                </span>
                {isProblemRevised && (
                  <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded-2xs font-semibold">
                    이후 v{currentVersion}로 수정됨
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-academic-mono text-[#827d73]">
                <span>{isAttemptExpanded ? '접기' : '풀이 전문 확인'}</span>
                {isAttemptExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </div>
            </button>

            {isAttemptExpanded && (
              <div className="p-4 space-y-3.5 border-t border-[#ded6c8] bg-white text-xs">
                {/* Revised Problem Notice (Requirement: Show that problem was revised, keep past score) */}
                {isProblemRevised && (
                  <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-xs text-xs text-amber-950 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-700" />
                        <span>문제 개정 알림 (풀이 당시: v{attemptVersion} → 현재 최신: v{currentVersion})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowLatestProblemDiff(!showLatestProblemDiff)}
                        className="text-[11px] font-academic-mono text-amber-900 underline hover:text-[#c52828]"
                      >
                        {showLatestProblemDiff ? '풀이 당시 내용만 보기' : '최신 수정본과 비교하기'}
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      이 문제는 제출 이후 오류 수정 등을 거쳐 최신 버전으로 개정되었습니다.
                      당시 획득 점수(<strong>{matchingAttempt.calculatedScore}점</strong>)와 작성 답안은 과거 풀이 시점의 문제 규격을 기준으로
                      <strong> 조용히 재채점되거나 덮어쓰이지 않고 안전하게 보존</strong>됩니다.
                    </p>

                    {showLatestProblemDiff && matchedProblem && (
                      <div className="mt-2 p-2.5 bg-white border border-amber-200 rounded-xs space-y-1.5">
                        <div className="font-academic-mono text-[10.5px] font-bold text-amber-800 uppercase">
                          현재 최신 수정본 [v{matchedProblem.version}] 내용:
                        </div>
                        <div className="font-bold text-[#191817] text-xs font-academic-serif">
                          {matchedProblem.title}
                        </div>
                        <p className="text-[11.5px] text-[#2e2c29] leading-relaxed whitespace-pre-wrap">
                          {matchedProblem.promptText}
                        </p>
                        <div className="pt-1 text-[10.5px] font-academic-mono text-[#827d73]">
                          최신 모범 답안: {matchedProblem.modelAnswer.slice(0, 120)}...
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Quarantined Problem Notice */}
                {isQuarantined && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xs text-xs text-red-900 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-red-600" />
                      <span>이 문제는 현재 품질 신고 검토 또는 수정 진행 중입니다.</span>
                    </div>
                    <span className="font-academic-mono text-[10.5px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded-2xs">
                      출제 일시 제외됨
                    </span>
                  </div>
                )}

                {/* Problem Statement Snapshot */}
                {(matchingAttempt.problemTitleSnapshot || matchingAttempt.problemPromptSnapshot) && (
                  <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-academic-mono text-[11px] font-bold text-[#827d73] uppercase">
                        풀이 당시 문제 지문 [v{attemptVersion}]:
                      </div>
                      {matchedProblem && (
                        <button
                          type="button"
                          onClick={() => setIsReportModalOpen(true)}
                          className="flex items-center gap-1 text-[11px] font-academic-mono text-amber-700 hover:text-amber-900 underline"
                        >
                          <ShieldAlert className="w-3 h-3 text-amber-600" />
                          <span>이 문제 오류 신고</span>
                        </button>
                      )}
                    </div>
                    {matchingAttempt.problemTitleSnapshot && (
                      <h4 className="font-bold text-sm text-[#191817] font-academic-serif">
                        {matchingAttempt.problemTitleSnapshot}
                      </h4>
                    )}
                    {matchingAttempt.problemPromptSnapshot && (
                      <p className="text-xs text-[#2e2c29] leading-relaxed korean-prose whitespace-pre-wrap">
                        {matchingAttempt.problemPromptSnapshot}
                      </p>
                    )}
                  </div>
                )}

                {/* User Answer Text */}
                <div className="space-y-1">
                  <span className="font-academic-mono text-[11px] font-bold text-[#57544e] block">
                    학생이 제출한 답안 전문 (풀이 및 결론):
                  </span>
                  <div className="p-3.5 bg-[#fcfbf9] border border-[#ded6c8] rounded-xs font-serif text-xs leading-relaxed text-[#191817] whitespace-pre-wrap selection:bg-amber-100">
                    {matchingAttempt.answer}
                  </div>
                </div>

                {/* Stage 8: User Method Selection Reason Text */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-academic-mono text-[11px] font-bold text-[#57544e] flex items-center gap-1">
                      <Compass className="w-3.5 h-3.5 text-indigo-700" />
                      <span>작성한 방법 선택 이유 (WHY THIS METHOD):</span>
                    </span>
                    {matchingAttempt.isReasonNotApplicable ? (
                      <span className="text-[10px] font-mono bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded-2xs font-semibold">
                        방법 선택 해당 없음 지정
                      </span>
                    ) : matchingAttempt.solvingReason ? (
                      <span className="text-[10px] font-mono bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.2 rounded-2xs font-semibold">
                        이유 서술 작성됨
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded-2xs">
                        이유 진단 없음 (8단계 이전 기록)
                      </span>
                    )}
                  </div>

                  {matchingAttempt.isReasonNotApplicable ? (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xs text-xs text-amber-950">
                      <strong>해당 없음 사유: </strong>
                      <span>{matchingAttempt.reasonNotApplicableJustification || '사유 서술 없음'}</span>
                    </div>
                  ) : matchingAttempt.solvingReason ? (
                    <div className="p-3 bg-[#fbfbfe] border border-indigo-200/80 rounded-xs text-xs leading-relaxed text-[#191817] whitespace-pre-wrap">
                      {matchingAttempt.solvingReason}
                    </div>
                  ) : (
                    <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] text-[11px] text-[#827d73] rounded-xs font-academic-mono">
                      이유 진단 없음 (8단계 이전 풀이 기록 - 과거 점수 및 사건 안전하게 보존)
                    </div>
                  )}
                </div>

                {/* Stage 8: Method Selection Reason Diagnosis Display */}
                {matchingAttempt.methodSelectionDiagnosis ? (
                  <div className="border border-indigo-200 bg-indigo-50/40 p-3.5 rounded-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-indigo-200/80 pb-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-950 font-academic-serif">
                        <Compass className="w-3.5 h-3.5 text-indigo-700" />
                        <span>방법 선택 이유 진단 결과 (독립 평가)</span>
                      </div>
                      <span className="text-[10.5px] font-academic-mono text-indigo-900 font-semibold">
                        {matchingAttempt.methodSelectionDiagnosis.isApplicable ? '방법 평가 적용 문항' : '해당 없음 검토'}
                      </span>
                    </div>

                    {matchingAttempt.methodSelectionDiagnosis.applicabilityAssessment && (
                      <div className="p-2 bg-white/90 border border-indigo-100 rounded-xs text-xs text-indigo-950">
                        <strong className="text-[10.5px] font-mono text-indigo-800">AI 평가 판단: </strong>
                        <span>{matchingAttempt.methodSelectionDiagnosis.applicabilityAssessment}</span>
                      </div>
                    )}

                    {/* Criteria Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {matchingAttempt.methodSelectionDiagnosis.criteria.map((crit) => {
                        const badgeColor =
                          crit.rating === 'proficient'
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            : crit.rating === 'partially_met'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : crit.rating === 'needs_improvement'
                            ? 'bg-rose-100 text-rose-900 border-rose-300'
                            : 'bg-gray-100 text-gray-700 border-gray-300';

                        return (
                          <div key={crit.key} className="bg-white p-2.5 rounded-xs border border-indigo-100 space-y-1.5 shadow-2xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[11px] text-[#191817]">{crit.label}</span>
                              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-2xs border ${badgeColor}`}>
                                {METHOD_REASON_RATING_LABELS[crit.rating] || crit.rating}
                              </span>
                            </div>
                            <div className="text-[10.5px] text-[#57544e]">
                              <span className="font-mono text-[#827d73]">근거: </span>
                              <span className="italic line-clamp-2">&ldquo;{crit.evidence}&rdquo;</span>
                            </div>
                            <p className="text-[11px] text-[#191817] bg-[#fbfbfe] p-1.5 rounded-2xs border border-indigo-50">
                              {crit.feedback}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {matchingAttempt.methodSelectionDiagnosis.summary && (
                      <div className="p-2.5 bg-white border border-indigo-200/70 rounded-xs text-xs text-[#191817]">
                        <strong className="block text-[11px] font-mono text-indigo-900 mb-0.5">이유 진단 종합 총평:</strong>
                        <span>{matchingAttempt.methodSelectionDiagnosis.summary}</span>
                      </div>
                    )}

                    {/* Improvements and Next Concepts */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {matchingAttempt.methodSelectionDiagnosis.suggestedImprovements?.length > 0 && (
                        <div className="p-2.5 bg-white border border-indigo-100 rounded-xs space-y-1">
                          <strong className="text-[10.5px] font-mono text-indigo-900 block">✍️ 보완 제안 문장:</strong>
                          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-[#2e2c29]">
                            {matchingAttempt.methodSelectionDiagnosis.suggestedImprovements.map((s, idx) => (
                              <li key={idx} className="leading-snug">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {matchingAttempt.methodSelectionDiagnosis.nextConceptsToReview?.length > 0 && (
                        <div className="p-2.5 bg-white border border-indigo-100 rounded-xs space-y-1">
                          <strong className="text-[10.5px] font-mono text-indigo-900 block">📚 다음에 확인할 개념:</strong>
                          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-[#2e2c29]">
                            {matchingAttempt.methodSelectionDiagnosis.nextConceptsToReview.map((c, idx) => (
                              <li key={idx} className="leading-snug">{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Model Answer Toggle if snapshot available */}
                {matchingAttempt.modelAnswerSnapshot && (
                  <div className="border border-[#ded6c8] rounded-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setIsModelAnswerExpanded(!isModelAnswerExpanded)}
                      className="w-full px-3 py-1.5 bg-[#f6f3eb] hover:bg-[#ede8dc] flex items-center justify-between text-[11px] font-academic-mono transition-colors"
                    >
                      <span className="font-bold text-[#57544e]">
                        출제자 모범 답안 스냅샷 (풀이 당시 v{attemptVersion})
                      </span>
                      <span className="text-[#827d73]">
                        {isModelAnswerExpanded ? '답안 접기' : '모범 답안 보기'}
                      </span>
                    </button>
                    {isModelAnswerExpanded && (
                      <div className="p-3 bg-white text-xs leading-relaxed text-[#191817] whitespace-pre-wrap border-t border-[#ded6c8]">
                        {matchingAttempt.modelAnswerSnapshot}
                      </div>
                    )}
                  </div>
                )}

                {/* Static Analysis Notice if available */}
                {matchingAttempt.staticAnalysisNotice && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-2xs text-[10.5px] text-amber-950 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                    <span>{matchingAttempt.staticAnalysisNotice}</span>
                  </div>
                )}

                {/* Report Action Footer */}
                {matchedProblem && (
                  <div className="pt-2 border-t border-[#f1ede4] flex items-center justify-between">
                    <span className="text-[10.5px] font-academic-mono text-[#827d73]">
                      풀이 ID: {matchingAttempt.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsReportModalOpen(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-xs transition-colors"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      <span>이 문제/채점 오류 신고하기</span>
                    </button>
                  </div>
                )}

                {/* Problem Report Modal */}
                {isReportModalOpen && matchedProblem && (
                  <ProblemReportModal
                    isOpen={isReportModalOpen}
                    onClose={() => setIsReportModalOpen(false)}
                    problem={matchedProblem}
                    attemptId={matchingAttempt.id}
                    onSubmitReport={(probId, reportData) => {
                      if (onReportProblem) {
                        return onReportProblem(probId, reportData);
                      }
                      return { success: false, error: '신고 핸들러가 연결되지 않았습니다.' };
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
