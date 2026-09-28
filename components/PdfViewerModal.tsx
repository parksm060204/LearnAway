'use client';

import React from 'react';
import { MathFormula } from './MathFormula';
import { X, BookOpen, ExternalLink, Printer } from 'lucide-react';

interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceRef: string;
  conceptTitle?: string;
}

export function PdfViewerModal({
  isOpen,
  onClose,
  sourceRef,
  conceptTitle,
}: PdfViewerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-3xl bg-white border border-[#c8c2b5] rounded-xs shadow-xl my-auto overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold truncate max-w-[450px]">
              원문 교재 및 강의자료 열람: {sourceRef}
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reader Document Body */}
        <div className="p-6 overflow-y-auto space-y-4 font-sans text-xs sm:text-sm text-[#191817] leading-relaxed bg-[#fdfcfb]">
          <div className="border-b border-[#ded6c8] pb-3 flex items-center justify-between text-xs text-[#827d73] font-academic-mono">
            <span>참조 위치: § {sourceRef}</span>
            <span>연결 개념: {conceptTitle || '대학 논술 학습 자료'}</span>
          </div>

          <div className="space-y-4 font-academic-serif">
            <h2 className="text-base sm:text-lg font-bold text-[#191817] border-l-2 border-[#c52828] pl-3">
              제3장 조건부분포 및 조건부 기댓값 (Law of Iterated Expectations)
            </h2>

            <p className="text-justify font-sans text-xs sm:text-sm text-[#33302b]">
              확률변수 X와 Y가 연속형 결합확률밀도함수 f(x,y)를 가질 때, 주어진 X=x 조건 하에서 Y의 조건부 기댓값 E[Y|X=x]는 다음과 같이 적분 형태로 정의된다.
            </p>

            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-center overflow-x-auto my-2">
              <MathFormula
                math="E[Y|X=x] = \int_{-\infty}^{\infty} y f_{Y|X}(y|x) \, dy = \int_{-\infty}^{\infty} y \frac{f_{X,Y}(x,y)}{f_X(x)} \, dy"
                displayMode
              />
            </div>

            <h4 className="font-bold text-sm text-[#191817] pt-2">정리 3.4 (반복 기댓값의 법칙, Tower Property)</h4>
            <p className="font-sans text-xs sm:text-sm text-[#33302b]">
              만약 <MathFormula math="E[|Y|] < \infty" /> 이 성립하면, 다음이 성립한다:
            </p>

            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-center overflow-x-auto my-2">
              <MathFormula math="E\big[E[Y|X]\big] = E[Y]" displayMode />
            </div>

            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xs text-xs space-y-1 font-sans">
              <div className="font-bold text-amber-900 font-academic-mono">
                [교재 각주 및 시험 출제 주의사항]
              </div>
              <p className="text-amber-800 leading-relaxed">
                적분 순서를 교환하기 위해서는 <strong>푸비니 정리(Fubini&apos;s Theorem)</strong>의 절대수렴 조건인 <MathFormula math="\iint |y| f_{X,Y}(x,y) \, dx \, dy < \infty" /> 가 전제되어야 합니다. 대학 기말/중간 논술형 시험에서는 이 절대수렴 조건의 명시 여부가 핵심 감점 포인트로 작용합니다.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#faf8f4] border-t border-[#ded6c8] px-5 py-3 flex items-center justify-between text-xs">
          <span className="font-academic-mono text-[#827d73]">
            VIEWER MODE: ACADEMIC_PAGE_PREVIEW
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#191817] text-white hover:bg-[#33302b] rounded-xs font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
