'use client';

import React, { useState } from 'react';
import {
  Problem,
  ProblemReportType,
  PROBLEM_REPORT_TYPE_LABELS,
} from '../lib/types';
import {
  AlertTriangle,
  X,
  Send,
  CheckCircle,
  HelpCircle,
  ShieldAlert,
  FileText,
  Clock,
} from 'lucide-react';

interface ProblemReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  problem: Problem;
  attemptId?: string;
  onSubmitReport: (problemId: string, reportData: {
    type: ProblemReportType;
    details: string;
    attemptId?: string;
  }) => { success: boolean; error?: string };
}

const REPORT_TYPE_DESCRIPTIONS: Record<ProblemReportType, string> = {
  missing_or_vague_condition: '전제조건, 정의역, 특수 케이스 제한 등 필수 조건이 빠져있거나 모호함',
  incorrect_model_answer: '해설 또는 모범 답안의 전개 단계, 수식, 최종 결과값에 명백한 오류가 있음',
  rubric_error: '채점 기준의 배점 비중이 불합리하거나, 100점 합계 오류 또는 채점 가이드가 부적절함',
  source_mismatch: '교재 원문 또는 강의록에 기술된 개념/정리와 출제 내용이 일치하지 않음',
  multiple_answers_possible: '단일 정답 또는 명확한 증명을 요구했으나 다른 유효한 정답/접근이 존재함',
  inappropriate_difficulty_or_scope: '시험 범위 밖의 개념이 출제되었거나 학부 학점 수준에 부적합하게 극단적임',
  other: '오탈자, 가독성 훼손, 수식 렌더링 깨짐 등 기타 문제 품질 결함',
};

export function ProblemReportModal({
  isOpen,
  onClose,
  problem,
  attemptId,
  onSubmitReport,
}: ProblemReportModalProps) {
  const [reportType, setReportType] = useState<ProblemReportType>('missing_or_vague_condition');
  const [details, setDetails] = useState('');
  const [includeAttemptId, setIncludeAttemptId] = useState(Boolean(attemptId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = details.trim();
    if (!trimmed) {
      setSubmissionError('문제의 오류 내용을 구체적으로 작성해 주세요.');
      return;
    }

    if (isSubmitting) return; // Prevent double click
    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const res = onSubmitReport(problem.id, {
        type: reportType,
        details: trimmed,
        attemptId: includeAttemptId && attemptId ? attemptId : undefined,
      });

      if (!res.success) {
        setSubmissionError(res.error || '신고 접수 중 오류가 발생했습니다.');
        setIsSubmitting(false);
        return;
      }

      // Reset and close
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      setSubmissionError(err?.message || '신고 처리 중 오류가 발생했습니다.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#c52828]" />
            <span className="font-academic-mono text-xs text-[#ded6c8]">QUALITY ASSURANCE</span>
            <span className="text-[#827d73]">|</span>
            <h3 className="font-academic-serif text-sm font-bold text-white">
              문제 품질 및 오류 신고
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#ded6c8] hover:text-white p-1 rounded-xs"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {/* Target Problem Summary */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-3.5 rounded-xs space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-academic-mono text-[11px] font-bold text-[#c52828]">
                신고 대상 문제 [v{problem.version || 1}]
              </span>
              <span className="font-academic-mono text-[10.5px] text-[#827d73]">
                출처: {problem.sourceRefs || '교재'}
              </span>
            </div>
            <h4 className="font-bold text-sm text-[#191817] font-academic-serif">
              {problem.title}
            </h4>
            <p className="text-[#57544e] line-clamp-2 korean-prose text-[11.5px]">
              {problem.promptText}
            </p>
          </div>

          {/* Linked Attempt ID (Optional) */}
          {attemptId && (
            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xs text-xs space-y-1">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-blue-950">
                <input
                  type="checkbox"
                  checked={includeAttemptId}
                  onChange={(e) => setIncludeAttemptId(e.target.checked)}
                  className="rounded-2xs border-[#ded6c8] text-[#c52828] focus:ring-[#c52828]"
                />
                <span>현재 풀이 기록 ID 연결하기</span>
                <span className="font-academic-mono text-[11px] text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded-2xs">
                  {attemptId}
                </span>
              </label>
              <p className="text-[11px] text-blue-800 pl-5 leading-relaxed">
                * 풀이 ID를 연결하면 검토자가 귀하의 답안과 AI 채점 결과를 대조하여 채점 기준 및 모범 답안 오류를 더 정확하게 검토할 수 있습니다.
              </p>
            </div>
          )}

          {/* Report Type Selector (7 Categories) */}
          <div className="space-y-2">
            <label className="block text-xs font-academic-mono font-bold text-[#191817]">
              신고 유형 선택 (7가지 분류 기준) <span className="text-[#c52828]">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(Object.keys(PROBLEM_REPORT_TYPE_LABELS) as ProblemReportType[]).map((typeKey) => {
                const isSelected = reportType === typeKey;
                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => setReportType(typeKey)}
                    className={`p-2.5 rounded-xs border text-left transition-colors flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#c52828] bg-[#fef2f2]/60 text-[#191817] shadow-2xs'
                        : 'border-[#ded6c8] bg-white hover:bg-[#faf8f4] text-[#57544e]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className={`font-bold ${isSelected ? 'text-[#c52828]' : 'text-[#191817]'}`}>
                        {PROBLEM_REPORT_TYPE_LABELS[typeKey]}
                      </span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-[#c52828] shrink-0" />
                      )}
                    </div>
                    <span className="text-[10.5px] leading-snug text-[#827d73]">
                      {REPORT_TYPE_DESCRIPTIONS[typeKey]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Problem Details Textarea */}
          <div className="space-y-1.5">
            <label className="block text-xs font-academic-mono font-bold text-[#191817]">
              구체적인 오류 내용 및 수정 제안 <span className="text-[#c52828]">*</span>
            </label>
            <textarea
              value={details}
              onChange={(e) => {
                setDetails(e.target.value);
                if (submissionError) setSubmissionError(null);
              }}
              rows={4}
              placeholder="문제의 어느 부분이 왜 잘못되었는지 구체적으로 적어주세요.&#10;예: 지문에서 'X와 Y가 독립'이라는 전제가 누락되어 결합확률밀도 f(x,y)=f(x)f(y)를 적용할 수 없습니다. / 모범 답안 3번째 줄 적분 계산에서 부호가 반대로 되어 있습니다."
              className="w-full p-3 text-xs border border-[#ded6c8] rounded-xs focus:border-[#191817] focus:ring-1 focus:ring-[#191817] bg-[#fefefe] leading-relaxed resize-y"
            />
          </div>

          {/* Quarantine Warning Banner */}
          <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-xs text-[11px] text-amber-950 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <strong className="block font-bold">출제 일시 제외 및 품질 보증 안내</strong>
              <p className="text-[11px] leading-relaxed text-amber-900">
                신고가 접수되면 해당 문제는 즉시 <span className="font-bold underline">[신고 접수]</span> 상태로 전환되며,
                검토 및 수정·재승인 전까지 오늘의 복습 및 모의시험 출제 목록에서 <strong>자동 제외</strong>됩니다.
                (기존에 제출된 풀이 기록과 점수는 변경 없이 안전하게 보존됩니다.)
              </p>
            </div>
          </div>

          {/* Submission Error Banner */}
          {submissionError && (
            <div className="p-2.5 bg-red-50 border border-red-300 rounded-xs text-xs text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{submissionError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs font-academic-mono transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !details.trim()}
              className="px-5 py-2 text-xs bg-[#c52828] hover:bg-[#a82020] text-white font-bold rounded-xs shadow-xs font-academic-mono transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? '신고 접수 중...' : '문제 오류 신고 제출'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
