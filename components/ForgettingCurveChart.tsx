'use client';

import React, { useMemo } from 'react';
import { Concept, RetentionModelSettings, ReviewEvent } from '../lib/types';
import {
  generateConceptTrajectory,
  DEFAULT_RETENTION_SETTINGS,
} from '../lib/retentionModel';
import { Layers, Grid, AlertCircle, Info, Calendar, Sparkles } from 'lucide-react';
import { formatSeoulDate } from '../lib/dateUtils';

interface ForgettingCurveChartProps {
  concept: Concept;
  comparedConcepts?: Concept[];
  isComparisonMode: boolean;
  onToggleComparisonMode: () => void;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  settings?: RetentionModelSettings;
  examDayOffset?: number;
  hasExamDate?: boolean;
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
  hasExamDate = true,
}: ForgettingCurveChartProps) {
  // SVG Canvas configuration
  const width = 760;
  const height = 340;
  const padding = { top: 35, right: 45, bottom: 48, left: 52 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Trajectory calculation for primary selected concept using actual event timestamps
  const trajectory = useMemo(() => {
    return generateConceptTrajectory(concept, settings, examDayOffset);
  }, [concept, settings, examDayOffset]);

  const minDay = trajectory.minDay;
  const maxDay = trajectory.maxDay;
  const totalDays = Math.max(1, maxDay - minDay);

  // Coordinate conversion helpers
  const dayToX = (day: number) => {
    return padding.left + ((day - minDay) / totalDays) * plotWidth;
  };

  const scoreToY = (score: number) => {
    const clamped = Math.min(100, Math.max(0, score));
    return padding.top + plotHeight - (clamped / 100) * plotHeight;
  };

  // Comparison trajectories
  const comparedTrajectories = useMemo(() => {
    if (!isComparisonMode || comparedConcepts.length === 0) return [];
    return comparedConcepts.map((c) => ({
      concept: c,
      trajectory: generateConceptTrajectory(c, settings, examDayOffset),
    }));
  }, [isComparisonMode, comparedConcepts, settings, examDayOffset]);

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

  const yTicks = [0, 20, 40, 60, 80, 100];
  const thresholdY = scoreToY(trajectory.criticalThreshold);
  const todayX = dayToX(0);
  const currentY = scoreToY(trajectory.currentScore);

  const comparisonColors = ['#191817', '#c52828', '#2563eb'];
  const allEvents = concept.events || [];
  const confirmedEvents = allEvents.filter(
    (e) => e.kind === 'initial_study' || e.kind === 'attempt' || e.kind === 'review'
  );

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
            {concept.isDemo ? (
              <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-2xs font-academic-mono">
                데모 과목 기록
              </span>
            ) : (
              <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-2xs font-academic-mono">
                실제 학습자 기록
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-academic-mono text-[#827d73] mt-0.5">
            <span>MODEL: R(t) = S₀ · (1 + t/τ)^(-α)</span>
            <span className="text-[#c8c2b5]">·</span>
            <span className="text-[#57544e]">
              τ={settings.tau}D, α={settings.alpha}, 임계치={settings.threshold}점 (학술 기준 모수)
            </span>
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
              <span className="text-[11px] text-[#827d73]">
                ({cc.status === 'unstudied' ? '미학습' : `${Math.round(cc.currentScore)}점`})
              </span>
            </div>
          ))}
          {comparedConcepts.length === 0 && (
            <span className="text-[#827d73]">상단 레일에서 비교할 개념을 최대 3개 선택하세요.</span>
          )}
        </div>
      )}

      {/* UNSTUDIED CONCEPT PLACEHOLDER (No fake score or fake curve!) */}
      {trajectory.isUnstudied ? (
        <div className="p-8 text-center bg-[#faf8f4] border border-dashed border-[#ded6c8] rounded-xs space-y-2.5">
          <AlertCircle className="w-8 h-8 mx-auto text-[#827d73]" />
          <h3 className="text-sm font-bold text-[#191817] font-academic-serif">
            미학습 개념 (기록 대기 중)
          </h3>
          <p className="text-xs text-[#57544e] max-w-md mx-auto leading-relaxed">
            본 개념은 아직 학습 완료가 등록되지 않았거나 풀이 기록이 없습니다.
            우측 패널에서 첫 문제를 풀이·확정하거나 [학습 완료 등록]을 진행하면,
            실제 날짜와 성취도를 바탕으로 모델 감쇠 곡선이 생성됩니다.
          </p>
          <div className="pt-1">
            <span className="text-[11px] font-academic-mono bg-white border border-[#ded6c8] text-[#827d73] px-2.5 py-1 rounded-2xs">
              임의의 가짜 기억 점수(SCORE) 및 곡선 생성 방지됨
            </span>
          </div>
        </div>
      ) : (
        /* Interactive SVG Chart Container */
        <div className="relative w-full overflow-hidden bg-[#fdfcfb] border border-[#ede8de] rounded-xs select-none">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto block"
            style={{ minHeight: '260px' }}
          >
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

            {/* Y-Axis Title: 모델 복습 점수 */}
            <text
              transform={`rotate(-90)`}
              x={-(padding.top + plotHeight / 2)}
              y={14}
              textAnchor="middle"
              className="font-academic-mono text-[9.5px] fill-[#827d73] tracking-wide"
            >
              모델 복습 점수 (Model Score: 0~100)
            </text>

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
              임계 기준선 (THRESHOLD {trajectory.criticalThreshold.toFixed(1)}점)
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
            <g transform={`translate(${todayX - 38}, ${padding.top - 20})`}>
              <rect width="76" height="18" fill="#191817" rx="2" />
              <text
                x="38"
                y="12"
                textAnchor="middle"
                className="font-academic-mono text-[10px] font-bold fill-white tracking-wider"
              >
                TODAY [오늘]
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
                {/* Historical Trajectory Curve (Solid Charcoal: Observed past events) */}
                <path
                  d={historyPathD}
                  fill="none"
                  stroke="#191817"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Future Projection 1: Hypothetical review today (Dotted Slate) */}
                <path
                  d={reviewedPathD}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.85"
                />
                <text
                  x={dayToX(maxDay) - 5}
                  y={scoreToY(trajectory.examProjectedScoreReviewed) - 6}
                  textAnchor="end"
                  className="font-academic-mono text-[9.5px] font-medium fill-[#059669]"
                >
                  오늘 복습 시 예상 경로: ~{Math.round(trajectory.examProjectedScoreReviewed)}점
                </text>

                {/* Future Projection 2: Neglected (Red dashed line falling: Model projection) */}
                <path
                  d={neglectedPathD}
                  fill="none"
                  stroke="#c52828"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.85"
                />
                <text
                  x={dayToX(maxDay) - 5}
                  y={scoreToY(trajectory.examProjectedScoreNeglected) + 14}
                  textAnchor="end"
                  className="font-academic-mono text-[9.5px] font-semibold fill-[#c52828]"
                >
                  {hasExamDate
                    ? `미복습 시험일 예상치: ${Math.round(trajectory.examProjectedScoreNeglected)}점`
                    : `미복습 14일 후 예상: ${Math.round(trajectory.examProjectedScoreNeglected)}점`}
                </text>

                {/* Today Red Marker */}
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
                    현재 {trajectory.currentScore.toFixed(1)}점 {trajectory.currentScore < 50 ? '[복습 필요]' : ''}
                  </text>
                </g>

                {/* Historical Event Dots (Clickable with actual dates and scores) */}
                {trajectory.historyCurve
                  .filter((pt) => pt.isEventPoint)
                  .map((pt, idx) => {
                    const ex = dayToX(pt.day);
                    const ey = scoreToY(pt.score);
                    const isSelected = pt.eventId === selectedEventId;

                    return (
                      <g
                        key={`ev-dot-${pt.eventId || idx}`}
                        onClick={() => pt.eventId && onSelectEvent(pt.eventId)}
                        className="cursor-pointer group"
                      >
                        {/* Outer highlight circle if selected */}
                        {isSelected && (
                          <circle
                            cx={ex}
                            cy={ey}
                            r="9"
                            fill="none"
                            stroke="#c52828"
                            strokeWidth="1.8"
                            strokeDasharray="3 2"
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

                        {/* Event Tag Label with calendar date */}
                        <text
                          x={ex}
                          y={ey - 10}
                          textAnchor="middle"
                          className={`font-academic-mono text-[9.5px] font-semibold ${
                            isSelected ? 'fill-[#c52828]' : 'fill-[#191817]'
                          }`}
                        >
                          {pt.dateStr || ''} {pt.score}점
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

            {/* Dynamic X Axis Ticks and Actual Calendar Date Labels */}
            {trajectory.dateTicks.map((t) => {
              const x = dayToX(t.day);
              return (
                <g key={`x-${t.day}-${t.label}`}>
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
                    y={height - padding.bottom + 17}
                    textAnchor="middle"
                    className={`font-academic-mono text-[9.5px] ${
                      t.isToday
                        ? 'font-bold fill-[#c52828]'
                        : t.isExam
                        ? 'font-semibold fill-[#191817]'
                        : 'fill-[#57544e]'
                    }`}
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Chart Legend & Academic Grounding Notice */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-academic-mono text-[#57544e] border-t border-[#f1ede4]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#191817] inline-block" />
            <span>실제 학습·풀이 기록점 (클릭 시 첨삭 열람)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#c52828] border-t border-dashed border-[#c52828] inline-block" />
            <span className="text-[#c52828]">미복습 시 모델 예상 감쇠</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#059669] border-t border-dotted border-[#059669] inline-block" />
            <span className="text-[#059669]">오늘 복습 시 예상 궤적 (가정 시나리오)</span>
          </div>
        </div>

        <div className="text-[10px] text-[#827d73]">
          ※ 본 점수는 상대적 복습 우선순위 산출용이며 실제 기억률의 임상적 확정치가 아닙니다.
        </div>
      </div>

      {/* Interactive Event Timeline Strip underneath Chart */}
      {!trajectory.isUnstudied && confirmedEvents.length > 0 && (
        <div className="pt-1">
          <div className="text-[11px] font-academic-mono text-[#827d73] mb-1.5 flex items-center justify-between">
            <span>● 관측된 학습·풀이 이력 ({confirmedEvents.length}건):</span>
            <span>클릭하여 당시 문제 지문·100점 루브릭 감점 근거 열람</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {confirmedEvents.map((ev) => {
              const formattedDate = formatSeoulDate(ev.at, { includeYear: true, includeDayName: true });
              return (
                <button
                  key={ev.id}
                  onClick={() => onSelectEvent(ev.id)}
                  className={`px-2.5 py-1 text-xs font-academic-mono rounded-xs border transition-all ${
                    ev.id === selectedEventId
                      ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                      : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e] hover:bg-white hover:text-[#191817]'
                  }`}
                >
                  [{formattedDate}] {ev.title} ({ev.resultScore}점)
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
