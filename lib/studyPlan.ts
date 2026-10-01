/**
 * REDCALL Academic Suite - Study Plan Engine (Stage 9)
 * Pure deterministic rule-based planning engine.
 * Connects exam schedule, exam scope, retention priorities, and daily time budget.
 *
 * NO AI calls, NO artificial score inflation, NO fake study events.
 */

import {
  Subject,
  Concept,
  Problem,
  Attempt,
  ProblemType,
  RetentionModelSettings,
  StudyPlanSettings,
  StudyPlanItem,
  StudyPlanItemKind,
  DailyStudyPlan,
  StudyPlanSummary,
  StudyPlanScopeRemaining,
  DEFAULT_STUDY_PLAN_SETTINGS,
  isProblemAvailableForPractice,
  RechallengeReservation,
} from './types';
import {
  toSeoulDateString,
  calculateDDay,
  formatSeoulDate,
  addDaysToDate,
  getCurrentDate,
} from './dateUtils';
import {
  DEFAULT_RETENTION_SETTINGS,
  calculateNextReviewRecommendation,
} from './retentionModel';

export interface GenerateStudyPlanParams {
  subjects: Subject[];
  concepts: Concept[];
  problems: Problem[];
  attempts: Attempt[];
  settings?: StudyPlanSettings;
  retentionSettings?: RetentionModelSettings;
  referenceDate?: Date;
  existingItems?: StudyPlanItem[];
  daysCount?: number;
  // Stage 10: unified personalization input (same multiplier used by today's review)
  personalizationMultiplier?: number;
  personalizationNote?: string;
  // Stage 13: delayed rechallenge reservations reflected in the time budget
  rechallengeReservations?: RechallengeReservation[];
}

/**
 * Returns available approved problems for a subject and concept,
 * strictly excluding demo problems from real user plans and verifying
 * composite problem concepts are entirely within selected scope.
 */
export function getEligibleProblemsForPlan(
  subject: Subject,
  concept: Concept,
  allProblems: Problem[],
  selectedScopeConceptIds: string[],
  preferredTypes?: ProblemType[]
): {
  eligibleProblems: Problem[];
  outdatedProblems: Problem[];
  quarantinedCount: number;
} {
  const scopeSet = new Set(selectedScopeConceptIds);
  const subjectProblems = allProblems.filter((p) => p.subjectId === subject.id);

  const conceptProblems = subjectProblems.filter((p) => {
    // Problem must be linked to target concept
    const legacyConceptId = (p as Problem & { conceptId?: string }).conceptId;
    const linksConcept = p.conceptIds?.includes(concept.id) || legacyConceptId === concept.id;
    if (!linksConcept) return false;

    // Real plan constraint: exclude demo problems
    if (p.isDemo === true) return false;

    // Composite problem constraint: all linked concepts must be within exam scope
    if (p.conceptIds && p.conceptIds.length > 1) {
      const allInScope = p.conceptIds.every((cid) => scopeSet.has(cid));
      if (!allInScope) return false;
    }

    return true;
  });

  const available = conceptProblems.filter(
    (p) => p.isApproved !== false && isProblemAvailableForPractice(p)
  );
  const quarantinedCount = conceptProblems.length - available.length;

  const outdatedProblems = available.filter((p) => p.isOutdated === true);
  const currentProblems = available.filter((p) => !p.isOutdated);

  // The selected problem types are a real filter, not just a sort preference.
  // If none of the approved problems match the selected types, the concept needs
  // a new problem rather than silently using an unselected type.
  const typeSet =
    preferredTypes && preferredTypes.length > 0 ? new Set(preferredTypes) : null;
  const matchesType = (p: Problem) => !typeSet || typeSet.has(p.type);

  const typedCurrent = currentProblems.filter(matchesType).sort((a, b) => a.id.localeCompare(b.id));
  const typedOutdated = outdatedProblems.filter(matchesType).sort((a, b) => a.id.localeCompare(b.id));
  const pool = typedCurrent.length > 0 ? typedCurrent : typedOutdated;

  return {
    eligibleProblems: pool,
    outdatedProblems: typedOutdated,
    quarantinedCount,
  };
}

/**
 * Main Deterministic Study Plan Generation Engine.
 */
export function generateStudyPlan({
  subjects,
  concepts,
  problems,
  attempts,
  settings = DEFAULT_STUDY_PLAN_SETTINGS,
  retentionSettings = DEFAULT_RETENTION_SETTINGS,
  referenceDate = getCurrentDate(),
  existingItems = [],
  daysCount = 14,
  personalizationMultiplier = 1,
  personalizationNote,
  rechallengeReservations = [],
}: GenerateStudyPlanParams): StudyPlanSummary {
  const todaySeoulStr = toSeoulDateString(referenceDate);

  // 1. Map existing completed, postponed, and skipped items by unique key or id
  const completedByProblem = new Map<string, StudyPlanItem>();
  const completedByConceptInitial = new Map<string, StudyPlanItem>();
  const completedByMockExam = new Map<string, StudyPlanItem>();
  const existingItemMap = new Map<string, StudyPlanItem>();

  // Completion identity is deliberately INDEPENDENT of the plan item kind
  // (`recommended_review` / `vulnerability_fix`). If the recommendation kind is
  // later re-diagnosed, the same (subject, concept, problem, round) must map to the
  // same completion, not create a duplicate history entry.
  const roundIdentity = (item: StudyPlanItem): string | null => {
    if (!item.conceptId || !item.problemId || item.round === undefined) return null;
    return `${item.subjectId}|${item.conceptId}|${item.problemId}|r${item.round}`;
  };

  const existingByRoundIdentity = new Map<string, StudyPlanItem>();
  const completedByRoundIdentity = new Map<string, StudyPlanItem>();
  // Any completed item that already references an Attempt/event must not be
  // reproduced as a second history entry (covers legacy items without a round).
  const completedByAttemptId = new Map<string, StudyPlanItem>();

  for (const item of existingItems) {
    existingItemMap.set(item.id, item);
    if (item.status === 'completed' && item.completedAttemptId) {
      completedByAttemptId.set(item.completedAttemptId, item);
    }
    const identity = roundIdentity(item);
    if (identity) {
      existingByRoundIdentity.set(identity, item);
      if (item.status === 'completed') {
        const prev = completedByRoundIdentity.get(identity);
        // Keep the completion with the earliest real completion date so merged
        // old/new duplicates display the actual first completion.
        if (!prev || (item.completedAt || '') < (prev.completedAt || '')) {
          completedByRoundIdentity.set(identity, item);
        }
      }
    }
    if (item.status === 'completed') {
      if (item.problemId) {
        completedByProblem.set(item.problemId, item);
      }
      if (item.kind === 'initial_study' && item.conceptId) {
        completedByConceptInitial.set(item.conceptId, item);
      }
      if (item.kind === 'mixed_mock_exam') {
        completedByMockExam.set(`${item.subjectId}-${item.assignedDate}`, item);
      }
    }
  }

  // 3. For each active subject, extract scope and build candidate plan items
  interface CandidateItem {
    item: StudyPlanItem;
    examDDayDiff: number;
    urgencyPriority: number;
    subjectOrder: number;
  }

  const candidateItems: CandidateItem[] = [];
  const scopeRemainingList: StudyPlanScopeRemaining[] = [];
  // Deduplicate generated completion history by stable identity across the whole plan.
  const emittedHistoryIdentities = new Set<string>();

  subjects.forEach((subject, subIdx) => {
    const subConfig = settings.subjectConfigs[subject.id] || {
      subjectId: subject.id,
      selectedConceptIds: concepts.filter((c) => c.subjectId === subject.id).map((c) => c.id),
      selectedProblemTypes: [
        subject.domain === 'math_stats' ? 'essay_descriptive' : 'impl_descriptive',
      ],
      includeMockExam: true,
      mockExamTargetMinutes: 45,
    };

    const selectedConceptIds =
      subConfig.selectedConceptIds && subConfig.selectedConceptIds.length > 0
        ? subConfig.selectedConceptIds
        : concepts.filter((c) => c.subjectId === subject.id).map((c) => c.id);

    const scopeSet = new Set(selectedConceptIds);
    const subjectConcepts = concepts.filter((c) => c.subjectId === subject.id && scopeSet.has(c.id));

    // Exam timeline analysis
    const dday = calculateDDay(subject.examAt, referenceDate);
    const examDiff = dday.isNotSet ? 999 : dday.calendarDiff;

    // Remaining scope statistics
    const unstudied = subjectConcepts.filter(
      (c) => c.status === 'unstudied' || (!c.isLearned && (!c.events || c.events.length === 0))
    );
    const studied = subjectConcepts.filter((c) => !unstudied.includes(c));

    scopeRemainingList.push({
      subjectId: subject.id,
      subjectName: subject.name,
      totalScopeConcepts: subjectConcepts.length,
      unstudiedConceptsCount: unstudied.length,
      studiedConceptsCount: studied.length,
      unstudiedConceptTitles: unstudied.map((c) => c.title),
    });

    // 3.1 Generate 'initial_study' items for unstudied concepts in scope
    unstudied.forEach((c) => {
      // Check if already completed
      const existingComp = completedByConceptInitial.get(c.id);
      if (existingComp) return;

      // Priority calculation:
      // D-8 or earlier: high priority to finish base learning early (75 - order*0.2)
      // D-7 to D-3: medium priority (60 - order*0.2)
      // D-2 to D-1: lower priority (35 - order*0.2)
      // No exam: 60 - order*0.2
      let basePri = 60;
      if (examDiff > 7) basePri = 80;
      else if (examDiff >= 3 && examDiff <= 7) basePri = 65;
      else if (examDiff >= 0 && examDiff < 3) basePri = 35;

      const priorityScore = Number((basePri - (c.order || 0) * 0.2).toFixed(1));
      const reason =
        examDiff > 7
          ? '시험 범위 내 미학습 개념 (조기 1회독 권장)'
          : examDiff >= 0 && examDiff <= 2
          ? '시험 임박 미학습 개념 (핵심 정의 및 공식 속성 확인)'
          : '시험 범위 내 미학습 개념 원문 및 핵심 정리 학습';

      const itemId = `spi-init-${subject.id}-${c.id}`;
      const existing = existingItemMap.get(itemId);

      const item: StudyPlanItem = {
        id: itemId,
        subjectId: subject.id,
        subjectName: subject.name,
        conceptId: c.id,
        conceptName: c.title,
        kind: 'initial_study',
        earliestDate: todaySeoulStr,
        assignedDate: existing?.assignedDate || todaySeoulStr,
        estimatedMinutes: 20, // Explicit estimated time for reading & understanding
        isEstimatedTime: true,
        priorityScore,
        priorityReason: reason,
        status: existing?.status || 'pending',
        snapshotTitle: `[최초 학습] ${c.title}`,
        snapshotDetail: `출처: ${c.chapterRef || '교재'} · 핵심 개념 및 수식/불변식 정독`,
      };

      candidateItems.push({
        item,
        examDDayDiff: examDiff,
        urgencyPriority: priorityScore,
        subjectOrder: subIdx,
      });
    });

    // 3.2 Generate 'recommended_review' & 'vulnerability_fix' for studied concepts
    studied.forEach((c) => {
      const rec = calculateNextReviewRecommendation(
        c,
        retentionSettings,
        subject.examAt,
        referenceDate,
        personalizationMultiplier
      );

      // Check recent attempts for vulnerabilities & Stage 8 diagnosis
      const conceptAttempts = attempts
        .filter((a) => a.conceptId === c.id || a.conceptIds?.includes(c.id))
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const lastAttempt = conceptAttempts[0];

      const hasMethodError = lastAttempt?.errorType === 'method_selection_error';
      const hasCalcError = lastAttempt?.errorType === 'calc_or_impl_mistake';
      const hasNeedsImprovementDiagnosis =
        lastAttempt?.methodSelectionDiagnosis?.criteria.some((cr) => cr.rating === 'needs_improvement');
      const hasVulnerableRubric =
        lastAttempt?.rubricResults?.some((r) => r.isVulnerable || r.score < r.maxScore * 0.6);

      const isVulnerabilityTarget =
        hasMethodError || hasCalcError || hasNeedsImprovementDiagnosis || hasVulnerableRubric;

      // Review rounds: the pending item targets the NEXT review (reviewCount + 1).
      // Completion is only linked to the attempt that actually belongs to a round.
      const reviewEvents = (c.events || [])
        .filter((e) => e.kind === 'attempt' || e.kind === 'review')
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const reviewCount = reviewEvents.length;
      const nextRound = reviewCount + 1;
      const attemptById = new Map(attempts.map((a) => [a.id, a]));

      // Find available problem for practice
      const { eligibleProblems } = getEligibleProblemsForPlan(
        subject,
        c,
        problems,
        selectedConceptIds,
        subConfig.selectedProblemTypes
      );

      const targetProblem = eligibleProblems[0] || null;
      const isOutdated = targetProblem?.isOutdated === true;
      const needsGeneration = !targetProblem;

      const problemMinutes = targetProblem?.timeStandardMinutes || 15;

      // Plan item kind: vulnerability_fix or recommended_review
      const kind: StudyPlanItemKind = isVulnerabilityTarget ? 'vulnerability_fix' : 'recommended_review';

      // Priority calculation:
      // Base from retention urgency score
      let priorityScore = rec ? rec.urgencyScore : 50;

      // Boost for vulnerability in mid/final phases (D-7~D-1)
      const reasonParts: string[] = [];
      if (rec) {
        if (rec.daysUntilReview <= 0) {
          reasonParts.push(
            rec.daysUntilReview < 0
              ? `복습 기한 ${Math.abs(rec.daysUntilReview)}일 경과`
              : '오늘 복습 권장일 도래'
          );
        } else {
          reasonParts.push(`D+${rec.daysUntilReview} 권장`);
        }
      }

      if (hasMethodError || hasNeedsImprovementDiagnosis) {
        priorityScore += 30;
        reasonParts.push('최근 방법 선택 이유 보완 필요');
      } else if (hasCalcError) {
        priorityScore += 20;
        reasonParts.push('최근 계산/구현 오답 보완');
      } else if (hasVulnerableRubric) {
        priorityScore += 15;
        reasonParts.push('취약 루브릭 감점 보완');
      }

      if (examDiff >= 0 && examDiff <= 7) {
        priorityScore += (8 - examDiff) * 5; // Exam proximity boost
        reasonParts.push(`시험 D-${examDiff}`);
      }

      if (personalizationMultiplier !== 1 && personalizationNote) {
        reasonParts.push(personalizationNote);
      }

      priorityScore = Number(priorityScore.toFixed(1));
      const reason = reasonParts.join(' · ') || '기억 감쇠 방지 권장 복습';

      const probIdSuffix = targetProblem ? targetProblem.id : 'no-prob';
      const itemId = `spi-${kind}-${subject.id}-${c.id}-${probIdSuffix}-r${nextRound}`;
      // Resolve the previously persisted item for THIS round regardless of the current
      // kind, so a kind re-diagnosis does not drop a completed link or reset status.
      const existing =
        existingItemMap.get(itemId) ||
        existingByRoundIdentity.get(`${subject.id}|${c.id}|${probIdSuffix}|r${nextRound}`);

      // Only a persisted completed item for THIS round counts. A past attempt for the
      // same problem must never complete the next round's item.
      const isCompleted = existing?.status === 'completed';
      const completedAttId = existing?.completedAttemptId;
      const completedAt = existing?.completedAt;

      // The next review cannot be assigned before the model's recommended date.
      const recommendedDateStr = rec?.recommendedDateStr || todaySeoulStr;
      const earliestDate = recommendedDateStr > todaySeoulStr ? recommendedDateStr : todaySeoulStr;

      const item: StudyPlanItem = {
        id: itemId,
        subjectId: subject.id,
        subjectName: subject.name,
        conceptId: c.id,
        conceptName: c.title,
        problemId: targetProblem?.id,
        problemTitle: targetProblem?.title,
        problemType: targetProblem?.type,
        kind,
        round: nextRound,
        earliestDate,
        assignedDate: existing?.assignedDate || todaySeoulStr,
        estimatedMinutes: problemMinutes,
        isEstimatedTime: false,
        priorityScore,
        priorityReason: reason,
        status: isCompleted ? 'completed' : existing?.status || 'pending',
        snapshotTitle: targetProblem ? `[${kind === 'vulnerability_fix' ? '취약점 보완' : '권장 복습'}] ${targetProblem.title}` : `[문제 생성 필요] ${c.title}`,
        snapshotDetail: targetProblem
          ? `개념: ${c.title} · ${targetProblem.categoryLabel} · 권장 ${problemMinutes}분 · ${nextRound}회차`
          : `승인된 문제가 없습니다. 문제 출제 및 검토 화면에서 새 문제를 생성해 주세요.`,
        completedAt,
        completedAttemptId: completedAttId,
        needsProblemGeneration: needsGeneration,
        isOutdatedProblem: isOutdated,
      };

      candidateItems.push({
        item,
        examDDayDiff: examDiff,
        urgencyPriority: priorityScore,
        subjectOrder: subIdx,
      });

      // Preserve completed review history within the horizon, each linked to the
      // actual attempt of its own round. Identity is kind-independent and any attempt
      // already recorded as completed is not reproduced (no double counting).
      for (let k = 1; k <= reviewCount; k++) {
        const ev = reviewEvents[k - 1];
        const completedDateStr = toSeoulDateString(ev.at);
        if (completedDateStr < todaySeoulStr) continue;

        const matchedAttempt = ev.attemptId ? attemptById.get(ev.attemptId) : undefined;
        const histProblemId = matchedAttempt?.problemId || targetProblem?.id;
        const identity = `${subject.id}|${c.id}|${histProblemId || 'no-prob'}|r${k}`;

        const completedAttemptRef = ev.attemptId || ev.id;
        if (completedByRoundIdentity.has(identity)) continue;
        if (completedByAttemptId.has(completedAttemptRef)) continue;
        if (completedByAttemptId.has(ev.id)) continue;
        if (emittedHistoryIdentities.has(identity)) continue;
        emittedHistoryIdentities.add(identity);

        const matchedProblem = histProblemId ? problems.find((p) => p.id === histProblemId) : undefined;
        const histMinutes = matchedProblem?.timeStandardMinutes || problemMinutes;
        const histId = `spi-history-${subject.id}-${c.id}-${histProblemId || 'no-prob'}-r${k}`;
        const existingHist = existingItemMap.get(histId);

        const historyItem: StudyPlanItem = {
          id: histId,
          subjectId: subject.id,
          subjectName: subject.name,
          conceptId: c.id,
          conceptName: c.title,
          problemId: histProblemId,
          problemTitle:
            matchedAttempt?.problemTitleSnapshot || matchedProblem?.title || targetProblem?.title,
          problemType: matchedProblem?.type || targetProblem?.type,
          kind,
          round: k,
          assignedDate: existingHist?.assignedDate || completedDateStr,
          estimatedMinutes: histMinutes,
          isEstimatedTime: false,
          priorityScore: 0,
          priorityReason: `복습 ${k}회차 완료 (해당 회차 실제 기록 연결)`,
          status: 'completed',
          snapshotTitle: `[복습 ${k}회차 완료] ${c.title}`,
          snapshotDetail: `완료일 ${completedDateStr} · 회차 ${k}`,
          completedAt: ev.at,
          completedAttemptId: completedAttemptRef,
        };

        candidateItems.push({
          item: historyItem,
          examDDayDiff: examDiff,
          urgencyPriority: -1,
          subjectOrder: subIdx,
        });
      }
    });

    // 3.3 Generate 'mixed_mock_exam' if enabled and subject has studied concepts
    if (subConfig.includeMockExam && studied.length >= 2 && examDiff >= 0 && examDiff <= 14) {
      const mockMinutes = subConfig.mockExamTargetMinutes || 45;
      // Schedule at D-7, D-5, D-3, or D-1
      const isMockTiming = examDiff === 7 || examDiff === 5 || examDiff === 3 || examDiff === 1;
      const priorityScore = isMockTiming ? 95 : 75;
      const reason = `시험 D-${examDiff} 대비 전 범위 실전 모의시험 (${studied.length}개 개념 종합 점검)`;

      const itemId = `spi-mock-${subject.id}`;
      const existing = existingItemMap.get(itemId);

      const item: StudyPlanItem = {
        id: itemId,
        subjectId: subject.id,
        subjectName: subject.name,
        conceptIds: studied.map((c) => c.id),
        kind: 'mixed_mock_exam',
        earliestDate: todaySeoulStr,
        assignedDate: existing?.assignedDate || todaySeoulStr,
        estimatedMinutes: mockMinutes,
        isEstimatedTime: false,
        priorityScore,
        priorityReason: reason,
        status: existing?.status || 'pending',
        snapshotTitle: `[혼합 모의시험] ${subject.name} 실전 모의평가`,
        snapshotDetail: `출제 범위: ${studied.length}개 개념 · 목표 시간 ${mockMinutes}분 · 전 문항 AI 서술형 평가`,
        // 계획에서 시작할 때 모달로 전달할 범위·유형·시간 스냅샷
        mockExamConfig: {
          conceptIds: studied.map((c) => c.id),
          selectedTypes: [...subConfig.selectedProblemTypes],
          minutes: mockMinutes,
        },
      };

      candidateItems.push({
        item,
        examDDayDiff: examDiff,
        urgencyPriority: priorityScore,
        subjectOrder: subIdx,
      });
    }
  });

  // 3.4 Scheduled delayed-rechallenge reservations (independent re-solve)
  for (const reservation of rechallengeReservations) {
    if (reservation.status !== 'scheduled') continue;
    const subject = subjects.find((s) => s.id === reservation.subjectId);
    if (!subject) continue;
    const dday = calculateDDay(subject.examAt, referenceDate);
    const examDiff = dday.isNotSet ? 999 : dday.calendarDiff;
    const itemId = `spi-rechallenge-${reservation.id}`;
    const existing = existingItemMap.get(itemId);
    const priorityScore = 70;

    const item: StudyPlanItem = {
      id: itemId,
      subjectId: reservation.subjectId,
      subjectName: reservation.subjectName,
      conceptId: reservation.conceptId,
      problemId: reservation.problemId,
      problemTitle: reservation.problemTitle,
      problemType: reservation.problemType,
      kind: 'rechallenge',
      earliestDate: reservation.scheduledDate,
      assignedDate: existing?.assignedDate || reservation.scheduledDate,
      estimatedMinutes: reservation.estimatedMinutes,
      isEstimatedTime: false,
      priorityScore,
      priorityReason: '지연 재도전: 보완 후 독립적으로 다시 풀기 예약 (점수·회차 불변)',
      status: existing?.status || 'pending',
      snapshotTitle: `[지연 재도전] ${reservation.problemTitle || '문제'}`,
      snapshotDetail: `예약일 ${reservation.scheduledDate} · 원답안/보완 답안을 가리고 새로 풀기`,
      rechallengeId: reservation.id,
    };

    candidateItems.push({
      item,
      examDDayDiff: examDiff,
      urgencyPriority: priorityScore,
      subjectOrder: subjects.indexOf(subject),
    });
  }

  // 4. Stable deterministic ordering of all candidate items across subjects:
  // - completed items keep priority
  // - higher priority score first
  // - earlier exam D-day first
  // - stable subject order, then concept order, then item ID
  candidateItems.sort((a, b) => {
    // Priority score descending
    if (b.urgencyPriority !== a.urgencyPriority) {
      return b.urgencyPriority - a.urgencyPriority;
    }
    // Earlier exam D-day first
    if (a.examDDayDiff !== b.examDDayDiff) {
      return a.examDDayDiff - b.examDDayDiff;
    }
    // Subject order
    if (a.subjectOrder !== b.subjectOrder) {
      return a.subjectOrder - b.subjectOrder;
    }
    // Stable ID
    return a.item.id.localeCompare(b.item.id);
  });

  // Separate already completed items from pending candidate pool
  const pendingPool = candidateItems.map((c) => c.item);

  // Normalize ALL completed history (persisted + freshly derived) through one path
  // so the same subject/concept/problem/round/attempt is counted exactly once,
  // regardless of the item kind.
  const completedKeyOf = (i: StudyPlanItem) =>
    [i.subjectId, i.conceptId || '', i.problemId || '', i.round ?? '', i.completedAttemptId || ''].join('|');
  const completedByKey = new Map<string, StudyPlanItem>();
  const registerCompleted = (item: StudyPlanItem) => {
    const key = completedKeyOf(item);
    const existing = completedByKey.get(key);
    if (!existing) {
      completedByKey.set(key, item);
      return;
    }
    // Prefer a record that carries a valid completedAt (real completion date).
    if (item.completedAt && !existing.completedAt) completedByKey.set(key, item);
  };
  for (const item of existingItems) {
    if (item.status === 'completed') registerCompleted(item);
  }
  for (const item of pendingPool) {
    if (item.status === 'completed') registerCompleted(item);
  }
  const completedCandidates = Array.from(completedByKey.values());

  // 5. Daily budget allocation across the planning horizon
  const days: DailyStudyPlan[] = [];
  const allocatedProblemIdsByDate = new Map<string, Set<string>>();
  const scheduledItemIds = new Set<string>();

  // Extract preserved postponed or skipped items
  const postponedOrSkipped = new Map<string, StudyPlanItem>();
  for (const item of existingItems) {
    if (item.status === 'postponed' || item.status === 'skipped') {
      postponedOrSkipped.set(item.id, item);
    }
  }

  for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
    const dayIso = addDaysToDate(referenceDate, dayOffset);
    const dayDateStr = toSeoulDateString(dayIso);

    // Day of week in Asia/Seoul (0 = Sun, 1 = Mon, ..., 6 = Sat)
    const seoulDateObj = new Date(new Date(dayIso).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const dayOfWeek = seoulDateObj.getDay();

    const weekdayCfg = settings.weekdaySettings[dayOfWeek] || {
      dayOfWeek,
      minutes: settings.defaultDailyMinutes || 60,
      isRestDay: false,
    };

    const isRestDay = weekdayCfg.isRestDay || weekdayCfg.minutes === 0;
    let dayAvailableMinutes = isRestDay ? 0 : weekdayCfg.minutes;

    // Check if any subject has exam on this day
    const examOnThisDay = subjects.find((s) => {
      if (!s.examAt) return false;
      return toSeoulDateString(s.examAt) === dayDateStr;
    });

    if (examOnThisDay && dayOffset === 0) {
      // On exam day, remaining available study time is capped by hours until exam start
      const dday = calculateDDay(examOnThisDay.examAt, referenceDate);
      if (dday.exactHoursRemaining !== undefined) {
        const remainingMinutesToExam = Math.max(0, dday.exactHoursRemaining * 60);
        dayAvailableMinutes = Math.min(dayAvailableMinutes, remainingMinutesToExam);
      }
    }

    const dayLabel = formatSeoulDate(dayIso, { includeYear: true, includeDayName: true });
    const dayItems: StudyPlanItem[] = [];
    const dayUnassigned: StudyPlanItem[] = [];
    let assignedMinutes = 0;

    const usedProblemsToday = new Set<string>();
    allocatedProblemIdsByDate.set(dayDateStr, usedProblemsToday);

    // Place deduplicated completed history on its REAL completion date
    // (completedAt preferred; assignedDate only as a fallback).
    for (const item of completedCandidates) {
      if (scheduledItemIds.has(item.id)) continue;
      const completedDateStr = item.completedAt
        ? toSeoulDateString(item.completedAt)
        : item.assignedDate;
      if (completedDateStr === dayDateStr) {
        dayItems.push({ ...item, assignedDate: dayDateStr });
        scheduledItemIds.add(item.id);
        if (item.problemId) usedProblemsToday.add(item.problemId);
        assignedMinutes += item.estimatedMinutes;
      }
    }

    // Next, allocate pending items if budget remains and not rest day
    if (!isRestDay && dayAvailableMinutes > 0) {
      for (const item of pendingPool) {
        if (scheduledItemIds.has(item.id)) continue;
        // Completed history is placed above; never auto-schedule it forward.
        if (item.status === 'completed') continue;

        // Start constraint: never assign before the recommended/earliest date.
        if (item.earliestDate && dayDateStr < item.earliestDate) continue;

        // Deadline constraint: for an upcoming exam, never assign that subject's
        // work after the exam date. (A past exam keeps a general post-exam mode.)
        const itemSubject = subjects.find((s) => s.id === item.subjectId);
        if (itemSubject?.examAt) {
          const subExamStr = toSeoulDateString(itemSubject.examAt);
          if (subExamStr >= todaySeoulStr && dayDateStr > subExamStr) continue;
        }

        // Check if item was postponed or skipped
        const override = postponedOrSkipped.get(item.id);
        if (override) {
          if (override.status === 'skipped') {
            scheduledItemIds.add(item.id);
            continue;
          }
          if (override.status === 'postponed') {
            // Only consider on or after postponed date
            if (dayDateStr < override.assignedDate) {
              continue;
            }
          }
        }

        // Avoid duplicate problem on same date
        if (item.problemId && usedProblemsToday.has(item.problemId)) {
          continue;
        }

        // Check time budget
        if (assignedMinutes + item.estimatedMinutes <= dayAvailableMinutes) {
          const scheduledItem: StudyPlanItem = {
            ...item,
            assignedDate: dayDateStr,
          };

          dayItems.push(scheduledItem);
          scheduledItemIds.add(item.id);
          if (item.problemId) usedProblemsToday.add(item.problemId);
          assignedMinutes += item.estimatedMinutes;
        }
      }
    }

    days.push({
      date: dayDateStr,
      dayOfWeek,
      dayLabel,
      availableMinutes: dayAvailableMinutes,
      isRestDay,
      assignedMinutes,
      items: dayItems,
      unassignedItems: dayUnassigned,
    });
  }

  // 6. Any pending items not scheduled in the horizon are gathered into unassigned items
  const allUnassignedItems: StudyPlanItem[] = [];
  for (const item of pendingPool) {
    if (item.status === 'completed') continue;
    if (!scheduledItemIds.has(item.id)) {
      const sub = subjects.find((s) => s.id === item.subjectId);
      const pastExam = Boolean(
        sub?.examAt && toSeoulDateString(referenceDate) > toSeoulDateString(sub.examAt)
      );
      allUnassignedItems.push({
        ...item,
        assignedDate: '',
        warningNote:
          sub?.examAt && !pastExam
            ? '시험일 이전 일정에 배정하지 못했습니다. 학습 시간을 늘리거나 범위를 조정해 주세요.'
            : item.warningNote,
      });
    }
  }

  // Distribute unassigned items to today's unassigned list for clear UI visibility
  if (days.length > 0) {
    days[0].unassignedItems = allUnassignedItems;
  }

  // 7. Calculate total time shortage before exam dates
  let totalShortageMinutes = 0;
  for (const unassigned of allUnassignedItems) {
    const sub = subjects.find((s) => s.id === unassigned.subjectId);
    if (sub?.examAt) {
      const dday = calculateDDay(sub.examAt, referenceDate);
      if (!dday.isNotSet && dday.calendarDiff >= 0) {
        totalShortageMinutes += unassigned.estimatedMinutes;
      }
    }
  }

  const todayPlan = days[0] || {
    date: todaySeoulStr,
    availableMinutes: 60,
    assignedMinutes: 0,
    items: [],
    unassignedItems: [],
  };

  const todayCompletedCount = todayPlan.items.filter((i) => i.status === 'completed').length;
  const todayPendingCount = todayPlan.items.filter((i) => i.status !== 'completed').length;

  return {
    todayDate: todaySeoulStr,
    todayAvailableMinutes: todayPlan.availableMinutes,
    todayAssignedMinutes: todayPlan.assignedMinutes,
    todayCompletedCount,
    todayPendingCount,
    todayUnassignedCount: allUnassignedItems.length,
    totalShortageMinutes,
    scopeRemainingBySubject: scopeRemainingList,
    days,
  };
}
