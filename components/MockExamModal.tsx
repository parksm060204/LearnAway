'use client';

import React from 'react';
import { Subject, Concept } from '../lib/types';
import { X, Award, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface MockExamModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concepts: Concept[];
  onStartExamReview: () => void;
}

export function MockExamModal({
  isOpen,
  onClose,
  subject,
  concepts,
  onStartExamReview,
}: MockExamModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-[#c8c2b5] rounded-xs shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">
              {subject.name} 정규 모의고사 시뮬레이션
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs font-sans">
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-3.5 rounded-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-academic-mono text-[11px] font-bold text-[#c52828]">
                실전 종합 모의평가 스펙
              </span>
              <span className="text-[11px] font-academic-mono text-[#827d73]">
                고사장: {subject.location || '지정 강의실'}
              </span>
            </div>

            <div className="space-y-1 text-[#191817]">
              <div>• 총 출제 범위: <strong>{subject.scope}</strong></div>
              <div>• 평가 시간: <strong>100분 (서술 4문항, 엄밀 수식/알고리즘 증명 2문항)</strong></div>
              <div>• 취약 영역 가중 출제: 현재 복습 대상 토픽 위주로 자동 편성</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="font-academic-mono text-[11px] text-[#827d73] font-semibold">
              포함 단원 및 추적 개념 ({concepts.length}개):
            </span>
            <div className="p-2 border border-[#ded6c8] rounded-xs bg-[#fdfcfb] space-y-1 max-h-36 overflow-y-auto">
              {concepts.map((c) => (
                <div key={c.id} className="flex justify-between items-center text-[11px]">
                  <span className="font-medium text-[#191817]">{c.title}</span>
                  <span className="font-academic-mono text-[#827d73]">
                    현재 SCORE: {Math.round(c.currentScore)}점
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xs text-[11px] text-blue-900 leading-relaxed">
            ※ 실전 시험과 동일한 타이머 및 루브릭 첨삭 환경이 제공됩니다. 개별 개념 복습 완료 후 실전 모의고사를 시작하는 것을 권장합니다.
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              닫기
            </button>
            <button
              onClick={() => {
                onClose();
                onStartExamReview();
              }}
              className="px-4 py-2 text-xs bg-[#c52828] hover:bg-[#a82020] text-white font-bold rounded-xs shadow-xs"
            >
              취약 개념 복습 세션으로 이동
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
