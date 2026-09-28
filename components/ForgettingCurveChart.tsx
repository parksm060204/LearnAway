'use client';

import React, { useMemo } from 'react';
import { Concept, RetentionModelSettings, ReviewEvent } from '../lib/types';
import {
  generateConceptTrajectory,
  DEFAULT_RETENTION_SETTINGS,
} from '../lib/retentionModel';
import { Layers, Grid } from 'lucide-react';

interface ForgettingCurveChartProps {
  concept: Concept;
  comparedConcepts?: Concept[];
  isComparisonMode: boolean;
  onToggleComparisonMode: () => void;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  settings?: RetentionModelSettings;
  examDayOffset?: number;
}

export function ForgettingCurveChart({
  concept,
  comparedConcepts = [],
  isComparisonMode,
  onToggleComparisonMode,
  selectedEventId,
  onSelectEvent,
  settings = DEFAULT_RETENTION_SETTINGS,
  examDayOffset = 14,
}: ForgettingCurveChartProps) {
  // SVG Canvas configuration
  const width = 760;
  const height = 340;
  const padding = { top: 35, right: 40, bottom: 45, left: 45 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Determine X range: from earliest event (or min -10) to exam day (default +14)
  const allEvents = concept.events || [];
  const minDay = useMemo(() => {
    let m = -9;
    allEvents.forEach((e) => {
      if (e.dayOffset < m) m = e.dayOffset;
    });
    return Math.min(m - 1, -10);
  }, [allEvents]);

  const maxDay = Math.max(examDayOffset, 14);
  const totalDays = maxDay - minDay;

  // Coordinate conversion helpers
  const dayToX = (day: number) => {
    return padding.left + ((day - minDay) / totalDays) * plotWidth;
  };

  const scoreToY = (score: number) => {
    // 0 is bottom, 100 is top
    const clamped = Math.min(100, Math.max(0, score));
    return padding.top + plotHeight - (clamped / 100) * plotHeight;
  };

  // Trajectory calculation for primary selected concept
  const trajectory = useMemo(() => {
    return generateConceptTrajectory(concept, settings, maxDay);
  }, [concept, settings, maxDay]);

  // Comparison trajectories
  const comparedTrajectories = useMemo(() => {
    if (!isComparisonMode || comparedConcepts.length === 0) return [];
    return comparedConcepts.map((c) => ({
      concept: c,
      trajectory: generateConceptTrajectory(c, settings, maxDay),
    }));
  }, [isComparisonMode, comparedConcepts, settings, maxDay]);

  // Construct SVG path strings
  const historyPathD = useMemo(() => {
    const pts = trajectory.historyCurve;
    if (pts.length === 0) return '';
    return pts.reduce((acc, pt, idx) => {
      const x = dayToX(pt.day);
      const y = scoreToY(pt.score);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [trajectory.historyCurve, minDay, totalDays]);

  const neglectedPathD = useMemo(() => {
    const pts = trajectory.neglectedProjection;
    if (pts.length === 0) return '';
    return pts.reduce((acc, pt, idx) => {
      const x = dayToX(pt.day);
      const y = scoreToY(pt.score);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [trajectory.neglectedProjection, minDay, totalDays]);

  const reviewedPathD = useMemo(() => {
    const pts = trajectory.reviewedProjection;
    if (pts.length === 0) return '';
    return pts.reduce((acc, pt, idx) => {
      const x = dayToX(pt.day);
      const y = scoreToY(pt.score);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [trajectory.reviewedProjection, minDay, totalDays]);

  // Key x ticks
  const xTicks = [
    { day: -9, label: '-9D' },
    { day: -6, label: '-6D' },
    { day: -2, label: '-2D (풀이)' },
    { day: 0, label: '0D (현재)', isToday: true },
    { day: 3, label: '+3D 권장' },
    { day: maxDay, label: `+${maxDay}D (중간고사)` },
  ].filter((t) => t.day >= minDay && t.day <= maxDay);

  const yTicks = [0, 20, 40, 60, 80, 100];
  const thresholdY = scoreToY(trajectory.criticalThreshold);
  const todayX = dayToX(0);
  const currentY = scoreToY(trajectory.currentScore);

  const comparisonColors = ['#191817', '#c52828', '#2563eb'];

  return (
    <div className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs space-y-3">
      {/* Box Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#f1ede4]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-academic-mono text-xs font-bold text-[#827d73]">ANALYSIS //</span>
            <h2 className="text-sm sm:text-base font-bold text-[#191817] font-academic-serif">
              망각곡선 감쇠 궤적 분석: {concept.title}
            </h2>
          </div>
          <div className="text-[11px] font-academic-mono text-[#827d73] mt-0.5">
            MATHEMATICAL MODEL: R(t) = S0 · (1 + t/τ)^(-α) [Power-Law Retention Model · 데모 시연용 지수]
          </div>
        </div>

        {/* View toggle buttons */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0">
          <button
            onClick={() => isComparisonMode && onToggleComparisonMode()}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-xs font-medium transition-all ${
              !isComparisonMode
                ? 'border border-[#191817] text-[#191817] bg-[#faf8f4] font-semibold'
                : 'border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>단일 궤적</span>
          </button>

          <button
            onClick={onToggleComparisonMode}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-xs font-medium transition-all ${
              isComparisonMode
                ? 'border border-[#2563eb] text-[#2563eb] bg-[#eff6ff] font-semibold'
                : 'border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>비교 모드 ({comparedConcepts.length}/3)</span>
          </button>
        </div>
      </div>

      {/* Comparison Legend if in comparison mode */}
      {isComparisonMode && (
        <div className="flex flex-wrap items-center gap-3 p-2 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-xs font-academic-mono">
          <span className="text-[#827d73] font-semibold">비교 항목:</span>
          {comparedConcepts.map((cc, i) => (
            <div key={cc.id} className="flex items-center gap-1.5">
              <span
                className="w-3 h-0.75 inline-block"
                style={{ backgroundColor: comparisonColors[i % comparisonColors.length] }}
              />
              <span className="font-medium text-[#191817] truncate max-w-[150px]">{cc.title}</span>
              <span className="text-[11px] text-[#827d73]">({Math.round(cc.currentScore)}점)</span>
            </div>
          ))}
          {comparedConcepts.length === 0 && (
            <span className="text-[#827d73]">상단 레일에서 비교할 개념을 최대 3개 선택하세요.</span>
          )}
        </div>
      )}

      {/* Interactive SVG Chart Container */}
      <div className="relative w-full overflow-hidden bg-[#fdfcfb] border border-[#ede8de] rounded-xs select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto block"
          style={{ minHeight: '260px' }}
        >
          <defs>
            {/* Grid pattern if needed */}
          </defs>

          {/* Horizontal Gridlines & Y-Axis Labels */}
          {yTicks.map((score) => {
            const y = scoreToY(score);
            return (
              <g key={`y-${score}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#e8e4dc"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="font-academic-mono text-[10px] fill-[#827d73]"
                >
                  {score}
                </text>
              </g>
            );
          })}

          {/* Critical Threshold Line (Red dashed) */}
          <line
            x1={padding.left}
            y1={thresholdY}
            x2={width - padding.right}
            y2={thresholdY}
            stroke="#c52828"
            strokeWidth="1.2"
            strokeDasharray="5 4"
            opacity="0.85"
          />
          <text
            x={width - padding.right}
            y={thresholdY - 6}
            textAnchor="end"
            className="font-academic-mono text-[10px] font-bold fill-[#c52828]"
          >
            CRITICAL THRESHOLD (SCORE {trajectory.criticalThreshold.toFixed(1)})
          </text>

          {/* Today Vertical Line (0D) */}
          <line
            x1={todayX}
            y1={padding.top}
            x2={todayX}
            y2={height - padding.bottom}
            stroke="#191817"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          {/* Today Box Header */}
          <g transform={`translate(${todayX - 44}, ${padding.top - 20})`}>
            <rect width="88" height="18" fill="#191817" rx="2" />
            <text
              x="44"
              y="12"
              textAnchor="middle"
              className="font-academic-mono text-[10px] font-bold fill-white tracking-wider"
            >
              TODAY [Day 0]
            </text>
          </g>

          {/* Comparison Curves */}
          {isComparisonMode &&
            comparedTrajectories.map((ct, idx) => {
              const strokeColor = comparisonColors[idx % comparisonColors.length];
              const pts = ct.trajectory.historyCurve;
              const pathD = pts.reduce((acc, pt, i) => {
                const x = dayToX(pt.day);
                const y = scoreToY(pt.score);
                return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
              }, '');
              return (
                <path
                  key={`comp-${ct.concept.id}`}
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2"
                  opacity="0.75"
                />
              );
            })}

          {/* Single Mode Primary Curves */}
          {!isComparisonMode && (
            <>
              {/* Historical Trajectory Curve (Solid Charcoal) */}
              <path
                d={historyPathD}
                fill="none"
                stroke="#191817"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Future Projection 1: Reviewed (Gray dotted line rising) */}
              <path
                d={reviewedPathD}
                fill="none"
                stroke="#78716c"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <text
                x={dayToX(maxDay) - 5}
                y={scoreToY(trajectory.examProjectedScoreReviewed) - 6}
                textAnchor="end"
                className="font-academic-mono text-[10px] fill-[#57544e]"
              >
                복습 이행시 예상: {Math.round(trajectory.examProjectedScoreReviewed)}점
              </text>

              {/* Future Projection 2: Neglected (Red dashed line falling) */}
              <path
                d={neglectedPathD}
                fill="none"
                stroke="#c52828"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.8"
              />
              <text
                x={dayToX(maxDay) - 5}
                y={scoreToY(trajectory.examProjectedScoreNeglected) + 14}
                textAnchor="end"
                className="font-academic-mono text-[10px] font-semibold fill-[#c52828]"
              >
                방치시: {Math.round(trajectory.examProjectedScoreNeglected)}점 예상
              </text>

              {/* Today Red Square Marker */}
              <rect
                x={todayX - 4}
                y={currentY - 4}
                width="8"
                height="8"
                fill="#c52828"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              {/* Today Red Score Callout */}
              <g transform={`translate(${todayX + 10}, ${currentY + 4})`}>
                <text
                  x="0"
                  y="0"
                  className="font-academic-mono text-[11px] font-bold fill-[#c52828]"
                >
                  SCORE {trajectory.currentScore.toFixed(1)} {trajectory.currentScore < 50 ? '[경고]' : ''}
                </text>
              </g>

              {/* Historical Event Dots (Clickable) */}
              {allEvents.map((ev) => {
                const ex = dayToX(ev.dayOffset);
                const ey = scoreToY(ev.resultScore);
                const isSelected = ev.id === selectedEventId;

                return (
                  <g
                    key={ev.id}
                    onClick={() => onSelectEvent(ev.id)}
                    className="cursor-pointer group"
                  >
                    {/* Outer highlight circle if selected */}
                    {isSelected && (
                      <circle
                        cx={ex}
                        cy={ey}
                        r="8"
                        fill="none"
                        stroke="#c52828"
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                      />
                    )}

                    {/* Point Dot */}
                    <circle
                      cx={ex}
                      cy={ey}
                      r="4.5"
                      fill={isSelected ? '#c52828' : '#191817'}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                      className="transition-transform group-hover:scale-125"
                    />

                    {/* Event Tag Label */}
                    <text
                      x={ex}
                      y={ey - 10}
                      textAnchor="middle"
                      className={`font-academic-mono text-[10px] font-semibold ${
                        isSelected ? 'fill-[#c52828]' : 'fill-[#191817]'
                      }`}
                    >
                      {ev.title} ({ev.resultScore}점)
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {/* X Axis Line */}
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke="#c8c2b5"
            strokeWidth="1"
          />

          {/* X Axis Ticks and Labels */}
          {xTicks.map((t) => {
            const x = dayToX(t.day);
            return (
              <g key={`x-${t.day}`}>
                <line
                  x1={x}
                  y1={height - padding.bottom}
                  x2={x}
                  y2={height - padding.bottom + 5}
                  stroke="#c8c2b5"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                  className={`font-academic-mono text-[10px] ${
                    t.isToday ? 'font-bold fill-[#c52828]' : 'fill-[#57544e]'
                  }`}
                >
                  {t.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Interactive Event Timeline Strip underneath Chart */}
      <div className="pt-1">
        <div className="text-[11px] font-academic-mono text-[#827d73] mb-1.5 flex items-center justify-between">
          <span>● 이력 기록 점(Dot)을 클릭하여 해당 회차의 정밀 첨삭 및 루브릭을 확인하세요:</span>
          <span>{allEvents.length}개 풀이/학습 이벤트 보존</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {allEvents.map((ev) => (
            <button
              key={ev.id}
              onClick={() => onSelectEvent(ev.id)}
              className={`px-2.5 py-1 text-xs font-academic-mono rounded-xs border transition-all ${
                ev.id === selectedEventId
                  ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                  : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e] hover:bg-white hover:text-[#191817]'
              }`}
            >
              [Day {ev.dayOffset >= 0 ? `+${ev.dayOffset}` : ev.dayOffset}] {ev.title} ({ev.resultScore}점)
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
