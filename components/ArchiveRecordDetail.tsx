'use client';

import React from 'react';
import { Concept, ReviewEvent, ERROR_TYPE_LABELS } from '../lib/types';
import { MathFormula } from './MathFormula';
import { FileText, ExternalLink, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';

interface ArchiveRecordDetailProps {
  concept: Concept;
  event: ReviewEvent | null;
  onOpenSourceModal: (sourceRef: string) => void;
}

export function ArchiveRecordDetail({
  concept,
  event,
  onOpenSourceModal,
}: ArchiveRecordDetailProps) {
  if (!event) {
    return (
      <div className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 text-xs font-academic-mono text-[#827d73] text-center">
        선택된 이력 기록이 없습니다. 상단 차트에서 점을 선택하세요.
      </div>
    );
  }

  const isAttempt = event.kind === 'attempt' || event.kind === 'review';

  return (
    <div className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs space-y-3.5">
      {/* Archive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#f1ede4]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-academic-mono text-xs font-bold text-[#827d73]">ARCHIVE RECORD</span>
          <span className="text-[#c8c2b5]">|</span>
          <h3 className="text-xs sm:text-sm font-bold text-[#191817] font-academic-serif">
            [Day {event.dayOffset >= 0 ? `+${event.dayOffset}` : event.dayOffset}] {event.title} 정밀 첨삭 기록
          </h3>
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
      <div className="bg-[#faf8f4] border border-[#ded6c8] p-3.5 rounded-xs space-y-1.5">
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
          <div className="pt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-academic-mono text-[#827d73]">
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
          </div>
        )}
      </div>

      {/* Rubric Breakdown Cards */}
      {event.rubricScores && event.rubricScores.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-academic-mono text-[#827d73] font-semibold">
            채점 루브릭 기준별 배점 및 취약 영역 분석:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {event.rubricScores.map((rubric) => (
              <div
                key={rubric.criterionId}
                className={`p-3 rounded-xs border flex flex-col justify-between ${
                  rubric.isVulnerable
                    ? 'border-[#c52828] bg-[#fef2f2]/60'
                    : 'border-[#ded6c8] bg-[#fcfbf9]'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1.5">
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
                    {rubric.score.toFixed(1)} / {rubric.maxScore.toFixed(1)}
                  </span>
                </div>

                {rubric.feedback && (
                  <p className="text-[11px] text-[#57544e] leading-snug line-clamp-2">
                    {rubric.feedback}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
