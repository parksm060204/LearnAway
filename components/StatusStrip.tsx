'use client';

import React from 'react';
import { Subject, Concept } from '../lib/types';
import { calculateDDay } from '../lib/dateUtils';
import { Activity } from 'lucide-react';

interface StatusStripProps {
  subject: Subject;
  concepts: Concept[];
  onOpenSettings: () => void;
}

export function StatusStrip({ subject, concepts, onOpenSettings }: StatusStripProps) {
  const dday = calculateDDay(subject.examAt);

  // Compute average model score for this subject
  const avgScore =
    concepts.length > 0
      ? (concepts.reduce((sum, c) => sum + c.currentScore, 0) / concepts.length).toFixed(1)
      : '0.0';

  const isStable = Number(avgScore) >= 70;

  return (
    <div className="w-full bg-[#f6f3eb] border border-[#e2ded6] px-3.5 py-2 text-[11px] font-academic-mono text-[#57544e] flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3 rounded-xs">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#827d73]" />
          <span className="font-semibold text-[#827d73]">INDEX STATUS:</span>
          <span className={`font-bold ${isStable ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isStable ? 'STABLE' : 'ATTENTION_REQUIRED'}
          </span>
        </div>

        <span className="text-[#c8c2b5]">·</span>

        <div>
          <span className="text-[#827d73]">LAST EVALUATION:</span>{' '}
          <span className="text-[#191817]">
            2026.09.28 10:00:00 KST ({dday.displayBadge} 기준시점)
          </span>
        </div>

        <span className="text-[#c8c2b5]">·</span>

        <div>
          <span className="text-[#827d73]">복습 모델 종합 점수:</span>{' '}
          <span className={`font-bold ${Number(avgScore) < 70 ? 'text-[#c52828]' : 'text-[#191817]'}`}>
            {avgScore}점
          </span>{' '}
          <span className="text-[#827d73]">(안정 기준 70점)</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[#827d73]">
        <button
          onClick={onOpenSettings}
          className="hover:text-[#191817] underline decoration-dotted transition-colors"
        >
          ENGINE: {subject.engineName}
        </button>
      </div>
    </div>
  );
}
