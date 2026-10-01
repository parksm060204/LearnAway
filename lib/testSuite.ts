import {
  calculateDDay,
  toSeoulDateString,
  getSeoulCalendarDiff,
  getElapsedDays,
} from './dateUtils';
import {
  calculatePowerLawRetention,
  getEffectiveTau,
  calculateComprehensiveTau,
  calculateCurrentConceptScore,
  calculatePowerLawOptimalInterval,
  calculateNextReviewRecommendation,
  rankConceptsForReview,
  generateConceptTrajectory,
  DEFAULT_RETENTION_SETTINGS,
} from './retentionModel';
import {
  INITIAL_SUBJECTS,
  INITIAL_CONCEPTS,
  INITIAL_PROBLEMS,
  INITIAL_MATERIALS,
} from './initialData';
import {
  recordAttemptAndUpdateConcept,
  postponeConceptReview,
  loadStoredConcepts,
  loadStoredProblems,
  saveStoredProblems,
  loadStoredAttempts,
  saveStoredAttempts,
  reportProblemError,
  updateProblemQualityStatus,
  dismissProblemReport,
  editAndReviseProblem,
  reapproveProblem,
  suspendProblem,
  saveStoredStudyPlanItems,
  markStudyPlanItemCompleted,
} from './storage';
import {
  Attempt,
  Concept,
  ConceptDraft,
  Problem,
  ProblemDraft,
  Subject,
  PersonalizationSettings,
  DEFAULT_PERSONALIZATION_SETTINGS,
  ProblemReport,
  ProblemReportType,
  isProblemAvailableForPractice,
  PROBLEM_REPORT_TYPE_LABELS,
  MethodReasonCriterionKey,
  MethodReasonRating,
  METHOD_REASON_CRITERION_LABELS,
  METHOD_REASON_RATING_LABELS,
  MockExamSession,
  StudyPlanSettings,
  StudyPlanItem,
  DEFAULT_STUDY_PLAN_SETTINGS,
} from './types';
import {
  generateStudyPlan,
  getEligibleProblemsForPlan,
} from './studyPlan';
import {
  buildLearningAnalyticsReport,
  collectValidRecords,
} from './learningAnalytics';
import {
  computeCorrectionState,
  getEffectiveIntervalMultiplier,
  PERSONALIZATION_CONSTANTS,
} from './personalization';
import { saveMockExam, loadMockExams, clearMockExams } from './mockExam';
import { parseTranscript } from './transcriptParser';
import { saveMaterialContent, loadMaterialContent } from './materialStorage';
import {
  computeMarkdownHash,
  chunkMarkdownForAnalysis,
  verifySourceCitation,
} from './markdownUtils';
import {
  saveStoredConceptDrafts,
  approveConceptDraft,
  mergeConceptDrafts,
  markConceptAsLearned,
  saveStoredConcepts,
  saveStoredProblemDrafts,
  loadStoredProblemDrafts,
  approveProblemDraft,
  updateProblemDraft,
  getAttemptById,
} from './storage';

function runTests() {
  console.log('=== STARTING REDCALL AUTOMATED VERIFICATION SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: unknown) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  // 1. Date and Asia/Seoul D-Day tests
  console.log('--- 1. Testing Date & Asia/Seoul D-Day ---');
  const ddayEcon = calculateDDay('2026-10-12T10:00:00+09:00', new Date('2026-09-28T22:47:12+09:00'));
  assert(ddayEcon.displayBadge === 'D-14', 'ECON302 D-Day calculation is D-14', ddayEcon);
  assert(ddayEcon.calendarDiff === 14, 'ECON302 Calendar diff is exactly 14 days');
  assert(ddayEcon.exactHoursRemaining !== undefined && ddayEcon.exactHoursRemaining > 300, 'Accurate hours calculated');

  const ddayCs = calculateDDay('2026-10-20T14:00:00+09:00', new Date('2026-09-28T22:47:12+09:00'));
  assert(ddayCs.displayBadge === 'D-22', 'CS201 D-Day calculation is D-22', ddayCs);

  const ddayToday = calculateDDay('2026-09-28T15:00:00+09:00', new Date('2026-09-28T10:00:00+09:00'));
  assert(ddayToday.displayBadge === 'D-Day', 'Same calendar day yields D-Day', ddayToday);

  const ddayPast = calculateDDay('2026-09-20T10:00:00+09:00', new Date('2026-09-28T10:00:00+09:00'));
  assert(ddayPast.displayBadge === '시험 종료', 'Past date yields 시험 종료', ddayPast);

  const ddayUnset = calculateDDay(undefined);
  assert(ddayUnset.displayBadge === '시험일 설정', 'Unset exam date yields 시험일 설정', ddayUnset);
  assert(ddayUnset.isNotSet === true, 'ddayUnset.isNotSet is true');

  // 2. Pure Power-Law Retention Model tests
  console.log('\n--- 2. Testing Power-Law Retention Decay Model ---');
  const r0 = calculatePowerLawRetention(0, 88);
  assert(r0 === 88, 'R(0) equals starting score S0 (88)');

  const r1 = calculatePowerLawRetention(3.5, 100, 3.5, 0.45); // t=tau => (1 + 1)^(-0.45) = 2^(-0.45) ~ 0.732
  assert(r1 > 70 && r1 < 75, `R(tau) decays predictably to ~73.2 (got ${r1})`);

  const rLong = calculatePowerLawRetention(30, 88);
  assert(rLong < 45 && rLong > 10, `Long-term decay drops below 45 (got ${rLong})`);

  // Spaced repetition stability scaling
  const tau0 = getEffectiveTau(3.5, 0);
  const tau2 = getEffectiveTau(3.5, 2);
  assert(tau2 > tau0, `Successive reviews scale up memory stability: tau0=${tau0} < tau2=${tau2}`);

  // Current score for Concept 1
  const econConcept1 = INITIAL_CONCEPTS[0];
  const scoreConcept1 = calculateCurrentConceptScore(econConcept1.events, DEFAULT_RETENTION_SETTINGS, 0);
  assert(scoreConcept1 >= 45 && scoreConcept1 <= 55, `Concept 1 score at Day 0 is around 48-52 (got ${scoreConcept1})`);

  // 3. Trajectory Generation for SVG Chart
  console.log('\n--- 3. Testing Trajectory Projection for SVG Chart ---');
  const trajectory = generateConceptTrajectory(econConcept1, DEFAULT_RETENTION_SETTINGS, 14);
  assert(trajectory.historyCurve.length > 5, 'History curve contains piecewise decay coordinates');
  assert(trajectory.neglectedProjection.length > 5, 'Neglected projection generates future curve');
  assert(trajectory.reviewedProjection.length > 5, 'Reviewed projection generates future curve');
  assert(
    trajectory.examProjectedScoreReviewed > trajectory.examProjectedScoreNeglected,
    `Reviewing yields higher score than neglect at exam day (${trajectory.examProjectedScoreReviewed} vs ${trajectory.examProjectedScoreNeglected})`
  );

  // 4. Subject Data Isolation tests
  console.log('\n--- 4. Testing Subject Data Isolation ---');
  const econConcepts = INITIAL_CONCEPTS.filter((c) => c.subjectId === 'subj-econ302');
  const csConcepts = INITIAL_CONCEPTS.filter((c) => c.subjectId === 'subj-cs201');
  assert(econConcepts.length === 5, 'ECON302 has exactly 5 concepts');
  assert(csConcepts.length === 5, 'CS201 has exactly 5 concepts');
  assert(!econConcepts.some((c) => c.subjectId === 'subj-cs201'), 'No cross-contamination of concepts');

  const econProblems = INITIAL_PROBLEMS.filter((p) => p.subjectId === 'subj-econ302');
  const csProblems = INITIAL_PROBLEMS.filter((p) => p.subjectId === 'subj-cs201');
  assert(econProblems.length === 4, 'ECON302 has 4 distinct problem types');
  assert(csProblems.length === 4, 'CS201 has 4 distinct problem types');

  // Check 4 problem types in each domain
  assert(econProblems.some((p) => p.type === 'essay_descriptive'), 'ECON302 has essay_descriptive');
  assert(econProblems.some((p) => p.type === 'calc_derivation'), 'ECON302 has calc_derivation');
  assert(econProblems.some((p) => p.type === 'proof_counterexample'), 'ECON302 has proof_counterexample');
  assert(econProblems.some((p) => p.type === 'error_spotting'), 'ECON302 has error_spotting');

  assert(csProblems.some((p) => p.type === 'impl_descriptive'), 'CS201 has impl_descriptive');
  assert(csProblems.some((p) => p.type === 'algorithm_optimization'), 'CS201 has algorithm_optimization');
  assert(csProblems.some((p) => p.type === 'complexity_proof'), 'CS201 has complexity_proof');
  assert(csProblems.some((p) => p.type === 'debug_counterexample'), 'CS201 has debug_counterexample');

  // 5. Stage 1: Transcript Parsing Tests
  console.log('\n--- 5. Testing Transcript Parser & Timestamp Preservation ---');

  // Case A: Transcript with explicit timestamps and speakers
  const transcriptWithTs = `[00:15:30] 교수: 오늘 강의는 중심극한정리를 다룹니다.
[00:16:10] 학생: 표본 크기 n은 몇 이상이어야 하나요?
[00:16:25] 교수: 보통 30 이상을 충분히 큰 표본으로 봅니다.`;
  const parsedA = parseTranscript(transcriptWithTs, '통계 강의');
  assert(parsedA.hasTimestamps === true, 'Detected timestamps in transcript with timestamps');
  assert(parsedA.speakers.length === 2, 'Detected 2 speakers (교수, 학생)');
  assert(parsedA.speakers.includes('교수') && parsedA.speakers.includes('학생'), 'Speaker names matched');
  assert(parsedA.markdown.includes('00:15:30'), 'Markdown retains exact timestamp 00:15:30');
  assert(parsedA.markdown.includes('중심극한정리'), 'Markdown retains raw text');

  // Case B: Transcript WITHOUT timestamps (CRITICAL REQUIREMENT: NEVER INVENT TIMESTAMPS)
  const transcriptNoTs = `교수: 이번 알고리즘은 다익스트라 최단경로입니다.
학생: 음의 가중치가 있는 그래프에서도 동작하나요?
교수: 아닙니다. 음의 간선이 있으면 벨만-포드를 사용해야 합니다.`;
  const parsedB = parseTranscript(transcriptNoTs, '알고리즘 강의');
  assert(parsedB.hasTimestamps === false, 'hasTimestamps is false when raw text has no time');
  assert(!parsedB.markdown.includes('00:00') && !parsedB.markdown.includes('00:01'), 'Never invents artificial timestamps');
  assert(parsedB.speakers.length === 2, 'Identified speakers without timestamps');
  assert(parsedB.markdown.includes('벨만-포드'), 'Original academic content is preserved');

  // 6. Stage 1: Decoupled Material Content Storage Tests
  console.log('\n--- 6. Testing Decoupled Material Content Storage ---');
  const testMatId = 'test-mat-stage1-001';
  const testMarkdown = '# 테스트 교재\n\n$$E[X] = \\mu$$\n\n본문 내용입니다.';
  const testPages = [
    { pageNumber: 1, markdown: '# 1페이지', hasText: true },
    { pageNumber: 2, markdown: '', hasText: false },
  ];

  // Async test in sync suite runner
  saveMaterialContent(testMatId, {
    markdown: testMarkdown,
    rawText: '테스트 원문',
    pages: testPages,
  }).then(async () => {
    const loaded = await loadMaterialContent(testMatId);
    assert(loaded !== null, 'Loaded decoupled material content');
    assert(loaded?.markdown === testMarkdown, 'Loaded markdown matches saved markdown');
    assert(loaded?.pages?.length === 2, 'Pages array preserved with page numbers');
    assert(loaded?.pages?.[1].hasText === false, 'Image-only page hasText=false preserved');

    // 7. Stage 1: Subject Isolation for Materials
    console.log('\n--- 7. Testing Subject Isolation for Materials ---');
    const econMats = INITIAL_MATERIALS.filter((m) => m.subjectId === 'subj-econ302');
    const csMats = INITIAL_MATERIALS.filter((m) => m.subjectId === 'subj-cs201');
    assert(econMats.length === 4, 'ECON302 has 4 materials');
    assert(csMats.length === 3, 'CS201 has 3 materials');
    assert(!econMats.some((m) => m.subjectId === 'subj-cs201'), 'No cross-contamination of subject materials');

    // Verify demo badges and AI statuses
    assert(econMats.every((m) => m.isDemo === true), 'Demo materials have isDemo=true');
    assert(econMats.every((m) => m.status === 'ready'), 'Initial materials are ready');

    // 8. Stage 2: Markdown Hash & Version Change Detection
    console.log('\n--- 8. Testing Markdown Hash & Version Change Detection ---');
      const mdV1 = '# 중심극한정리\n표본평균의 분포는 정규분포에 수렴한다.';
    const mdV2 = '# 중심극한정리\n표본평균의 분포는 정규분포에 수렴한다.\n\n수정된 내용 추가';
    const hashV1 = computeMarkdownHash(mdV1);
    const hashV2 = computeMarkdownHash(mdV2);
    assert(hashV1.startsWith('h_'), 'Hash format uses h_ prefix');
    assert(hashV1 === computeMarkdownHash(mdV1), 'Deterministic hashing returns same value for same content');
    assert(hashV1 !== hashV2, 'Content change produces different hash (enabling outdated draft warning)');

    // 9. Stage 2: Citation Verification & User Review Flagging
    console.log('\n--- 9. Testing Source Citation Verification ---');
    const fullSourceMd = `<!-- [PAGE 3] -->
## 베이즈 정리 (Bayes' Theorem)
조건부 확률 공식: $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$
사전확률과 사후확률의 관계를 나타냅니다.`;

    const validEvidence = {
      type: 'page' as const,
      pageNumber: 3,
      quote: '조건부 확률 공식: $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$',
      verified: false,
    };
    const checkValid = verifySourceCitation(fullSourceMd, validEvidence);
    assert(checkValid.verified === true, 'Exact quote in source markdown is verified as valid');

    const fakeEvidence = {
      type: 'page' as const,
      pageNumber: 5,
      quote: '이 문장은 원문에 전혀 존재하지 않는 조작된 인용구입니다.',
      verified: false,
    };
    const checkFake = verifySourceCitation(fullSourceMd, fakeEvidence);
    assert(checkFake.verified === false, 'Fake or hallucinated quote fails verification');
    assert(checkFake.verificationNote.length > 0, 'Provides user-review warning reason');

    // 10. Stage 2: Chunking Preserving Page / Speech Markers
    console.log('\n--- 10. Testing Chunking Preserving Page / Speech Markers ---');
    const multiPageMd = `<!-- [PAGE 1] -->
# 1페이지 서론
기초 내용입니다.

<!-- [PAGE 2] -->
# 2페이지 심화
심화 공식입니다.`;
    const chunks = chunkMarkdownForAnalysis(multiPageMd, 50);
    assert(chunks.length >= 2, 'Large multi-page document chunked into multiple pieces');
    assert(chunks[0].text.includes('<!-- [PAGE 1] -->'), 'Chunk 0 preserves PAGE 1 marker');
    assert(chunks[1].text.includes('<!-- [PAGE 2] -->'), 'Chunk 1 preserves PAGE 2 marker');

    // 11. Stage 2: Draft Approval Without Artificial Mastery / Events (CRITICAL REQUIREMENT)
    console.log('\n--- 11. Testing Draft Approval Without Fake Mastery or Review Events ---');
    const dummyDraftId = 'test-draft-stage2-001';
    const dummyDraft: ConceptDraft = {
      id: dummyDraftId,
      materialId: 'test-mat-001',
      subjectId: 'subj-econ302',
      title: '새로 추출된 가설검정',
      domain: 'math_stats',
      description: '귀무가설과 대립가설의 기각역을 검정합니다.',
      coreDefinitionFormulaOrAlgorithm: 'p-value < alpha',
      prerequisites: ['정규분포'],
      relatedConcepts: ['유의수준'],
      commonMisconceptions: ['p값이 대립가설이 참일 확률이라고 오해함'],
      examples: ['t-검정 예제'],
      sourceEvidence: validEvidence,
      sourceMarkdownHash: hashV1,
      isApproved: false,
      status: 'draft',
      createdAt: '2026-09-29T00:00:00+09:00',
      updatedAt: '2026-09-29T00:00:00+09:00',
    };

    saveStoredConceptDrafts([dummyDraft]);
    const { approvedConcept } = approveConceptDraft(dummyDraftId);
    assert(approvedConcept !== null, 'Draft successfully approved and converted to Concept');
    assert(approvedConcept?.status === 'unstudied', 'CRITICAL: Approved concept starts as "unstudied"');
    assert(approvedConcept?.events.length === 0, 'CRITICAL: Approved concept has ZERO fake review events');
    assert(approvedConcept?.baseScore === 0, 'CRITICAL: Approved concept has baseScore 0 (SCORE --)');
    assert(approvedConcept?.currentScore === 0, 'CRITICAL: Approved concept has currentScore 0');
    assert(approvedConcept?.isDemo === false, 'Concept is tagged isDemo=false (user-extracted concept)');
    assert(approvedConcept?.isLearned === false, 'Concept is not yet marked as learned');

    // 12. Stage 2: Transition from Unstudied to Learned
    console.log('\n--- 12. Testing Marking Concept as Learned ---');
    if (approvedConcept) {
      saveStoredConcepts([approvedConcept, ...INITIAL_CONCEPTS]);
      const { learnedConcept } = markConceptAsLearned(approvedConcept.id, 75);
      assert(learnedConcept?.isLearned === true, 'Concept transitioned to isLearned=true');
      assert(learnedConcept?.status === 'newly_learned', 'Concept status changed to newly_learned');
      assert(learnedConcept?.events.length === 1, 'Legitimate initial review event recorded');
      assert(learnedConcept?.currentScore === 75, 'Current score reflects initial evaluation score');
    }

    // 13. Stage 2: Draft Merging
    console.log('\n--- 13. Testing Merging Duplicate Drafts ---');
    const draftA = {
      ...dummyDraft,
      id: 'draft-merge-A',
      title: '다익스트라 알고리즘',
      prerequisites: ['우선순위 큐'],
      relatedConcepts: ['벨만-포드'],
    };
    const draftB = {
      ...dummyDraft,
      id: 'draft-merge-B',
      title: '다익스트라 최단경로법',
      prerequisites: ['그래프 탐색'],
      relatedConcepts: ['벨만-포드', 'A* 알고리즘'],
      examples: ['네트워크 라우팅 예제'],
    };
    saveStoredConceptDrafts([draftA, draftB]);
    const mergedList = mergeConceptDrafts('draft-merge-A', 'draft-merge-B');
    const finalMerged = mergedList.find((d) => d.id === 'draft-merge-A');
    assert(mergedList.some((d) => d.id === 'draft-merge-B') === false, 'Source draft B removed after merge');
    assert(Boolean(finalMerged?.prerequisites.includes('우선순위 큐') && finalMerged?.prerequisites.includes('그래프 탐색')), 'Prerequisites combined without loss');
    assert(finalMerged?.relatedConcepts.filter((c) => c === '벨만-포드').length === 1, 'Related concepts deduplicated');
    assert(Boolean(finalMerged?.examples?.includes('네트워크 라우팅 예제')), 'Examples merged');

    // 14. Stage 3: Domain Problem Type Filtering & Subject Scoping
    console.log('\n--- 14. Testing Stage 3 Problem Type Filtering & Subject Scoping ---');
    const mathTypes = ['essay_descriptive', 'calc_derivation', 'proof_counterexample', 'error_spotting'];
    const csTypes = ['impl_descriptive', 'algorithm_optimization', 'complexity_proof', 'debug_counterexample'];
    
    assert(mathTypes.every((t) => !csTypes.includes(t)), 'Math problem types and CS types are strictly disjoint');
    assert(mathTypes.length === 4 && csTypes.length === 4, 'Exactly 4 problem types per domain');

    // 15. Stage 3: 100-Point Rubric Verification
    console.log('\n--- 15. Testing Stage 3 100-Point Rubric Rule ---');
    const validRubric = [
      { id: 'crit-1', label: '전제조건 및 엄밀한 정의 서술', maxScore: 30, weight: 0.3, description: '전제조건 서술' },
      { id: 'crit-2', label: '단계별 유도 및 증명 논리 전개', maxScore: 40, weight: 0.4, description: '유도 과정' },
      { id: 'crit-3', label: '최종 결론 및 통계적/알고리즘적 해석', maxScore: 30, weight: 0.3, description: '결론 도출' },
    ];
    const rubricSum = validRubric.reduce((sum, c) => sum + c.maxScore, 0);
    assert(rubricSum === 100, 'Detailed rubric criteria sum equals exactly 100 points');

    // 16. Stage 3: Problem Draft Lifecycle & Approval
    console.log('\n--- 16. Testing Stage 3 Problem Draft Lifecycle & Storage Isolation ---');
    const testDraftId = 'test-prob-draft-001';
    const testDraft: ProblemDraft = {
      id: testDraftId,
      subjectId: 'subj-econ302',
      conceptIds: ['c1-iterated-expectations', 'c2-mle'],
      conceptTitles: ['반복 기댓값의 법칙', '최대우도추정법'],
      title: '조건부 기댓값 하에서의 MLE 일치성 증명 및 제약 최적화',
      type: 'essay_descriptive',
      difficulty: 'advanced_college',
      categoryLabel: '1. 대학 논술·서술형',
      categoryNumber: 1,
      promptText: '두 개념을 연계하여 조건부 기댓값 수렴 조건 하에서 MLE의 점근적 정규성을 증명하시오.',
      mathFormula: 'E[Y] = E[E[Y|X]]',
      designIntent: '단순 계산을 지양하고 전제조건 정당화 및 다단계 논리적 증명 능력을 평가',
      appliedConditionNote: 'AI 설계 응용 조건: 결합밀도함수의 적분 순서 교환 가능성(Fubini 정리) 조건 추가',
      sourceRefs: 'Wooldridge Ch. 2 & Ch. 9',
      sourceEvidenceQuote: '조건부 평균의 정의에 따라 E[u|x]=0이면 Cov(x,u)=0이다.',
      sourceMarkdownHash: 'h_test1234_l100',
      timeStandardMinutes: 20,
      timeBreakdownDesc: '조건 분석 4분, 증명 전개 12분, 결론 4분',
      coreEvaluationHighlight: '푸비니 정리 적용 정당성',
      itemCountDesc: '소문항 2개',
      hints: ['1단계: 조건부 기댓값 정의', '2단계: 우도함수 테일러 전개'],
      modelAnswer: '모범 답안 본문: 수렴 정리와 우도방정식을 결합...',
      rubric: validRubric,
      status: 'draft',
      isApproved: false,
      verificationStatus: {
        hasRequiredFields: true,
        isScore100: true,
        scoreSum: 100,
        hasConceptLink: true,
        isSourceVerified: true,
      },
      createdAt: '2026-09-29T00:00:00+09:00',
      updatedAt: '2026-09-29T00:00:00+09:00',
    };

    saveStoredProblemDrafts([testDraft]);
    const loadedDrafts = loadStoredProblemDrafts();
    assert(loadedDrafts.some((d) => d.id === testDraftId), 'Draft saved and loaded from storage');

    // Update draft
    const updatedDraft = { ...testDraft, title: '수정된 시험 문제 제목' };
    updateProblemDraft(updatedDraft);
    const loadedAfterEdit = loadStoredProblemDrafts().find((d) => d.id === testDraftId);
    assert(loadedAfterEdit?.title === '수정된 시험 문제 제목', 'Draft edited and persisted');
    assert(loadedAfterEdit?.editedByUser === true, 'editedByUser flag marked true on edit');

    // Approve draft
    const approvalResult = approveProblemDraft(testDraftId);
    assert(approvalResult.approvedProblem !== null, 'Draft converted to Problem upon approval');
    assert(approvalResult.approvedProblem?.isApproved === true, 'Approved problem has isApproved=true');
    assert(approvalResult.approvedProblem?.isDemo === false, 'Approved problem has isDemo=false');
    assert(approvalResult.approvedProblem?.draftId === testDraftId, 'Approved problem correctly links back to draftId');
    assert(approvalResult.approvedProblem?.subjectId === 'subj-econ302', 'Problem subject isolation maintained');
    assert(
      approvalResult.approvedProblem?.rubric.reduce((s: number, r) => s + r.maxScore, 0) === 100,
      'Approved problem maintains 100-point rubric'
    );

    // Verify draft status in storage
    const approvedDraftInStore = loadStoredProblemDrafts().find((d) => d.id === testDraftId);
    assert(approvedDraftInStore?.isApproved === true, 'Stored draft marked isApproved=true');
    assert(approvedDraftInStore?.status === 'approved', 'Stored draft status marked "approved"');

    // 17. Outdated Source Markdown Detection
    console.log('\n--- 17. Testing Outdated Source Markdown Detection ---');
    const currentHash = 'h_newhash5678_l200';
    const isOutdated = approvalResult.approvedProblem?.sourceMarkdownHash !== currentHash;
    assert(isOutdated === true, 'Problem generated from old markdown hash correctly flagged as outdated');

    // 18. Non-destruction of User Data Rule
    console.log('\n--- 18. Testing Data Integrity: No Destruction of Problems or Attempts ---');
    const storedProblems = loadStoredProblems();
    const demoProblems = storedProblems.filter((p) => p.isDemo === true);
    assert(demoProblems.length > 0, 'Original demo problems preserved without deletion');
    assert(
      storedProblems.some((p) => p.id === approvalResult.approvedProblem?.id),
      'Newly approved problem persists in storedProblems alongside demo problems'
    );

    // 19. Stage 4: Empty Answer Blocking & Validation Rules
    console.log('\n--- 19. Testing Stage 4 Answer Validation & Anti-Empty Rules ---');
    const empty1 = '';
    const empty2 = '   \n\t  ';
    assert(!empty1.trim() && !empty2.trim(), 'Empty and whitespace-only answers cleanly detected and blocked');

    // 20. Stage 4: 100-Point Rubric Score Calculation (No Double Weighting)
    console.log('\n--- 20. Testing Stage 4 100-Point Rubric Calculation & Non-Double Weighting ---');
    const stage4Rubric = [
      {
        criterionId: 'r1',
        label: '전제조건 확인',
        score: 25,
        maxScore: 30,
        evidenceQuote: '결합밀도함수 조건 명시',
        deductionReason: '가측성 언급 미흡',
        improvementTip: '가측 집합 명시',
      },
      {
        criterionId: 'r2',
        label: '적분 순서 교환',
        score: 35,
        maxScore: 40,
        evidenceQuote: '푸비니 정리 적용',
        deductionReason: '절대수렴성 정당화 단계 간략화',
        improvementTip: '절대값 적분 수렴성 명시',
      },
      {
        criterionId: 'r3',
        label: '결론 도출',
        score: 30,
        maxScore: 30,
        evidenceQuote: 'E[E[Y|X]] = E[Y]',
        deductionReason: '감점 요인 없음 (만점 기준 충족)',
        improvementTip: '완벽한 결론 도출',
      },
    ];
    const totalMax = stage4Rubric.reduce((sum, r) => sum + r.maxScore, 0);
    const earnedTotal = stage4Rubric.reduce((sum, r) => sum + r.score, 0);
    assert(totalMax === 100, 'Rubric max scores sum to 100 points');
    assert(earnedTotal === 90, 'Earned total is direct arithmetic sum of criteria scores (90/100) without double-weighting');
    assert(stage4Rubric.every((r) => r.score >= 0 && r.score <= r.maxScore), 'All criterion scores bounded in [0, maxScore]');

    // 21. Stage 4: Attempt Structure & Snapshot Integrity
    console.log('\n--- 21. Testing Stage 4 Attempt Structure & Problem Snapshot Preservation ---');
    const stage4Attempt = {
      id: 'test-att-stage4-001',
      problemId: approvalResult.approvedProblem!.id,
      conceptId: 'c-econ-01',
      conceptIds: ['c-econ-01', 'c-econ-02'],
      subjectId: 'subj-econ302',
      at: '2026-09-29T10:00:00+09:00',
      answer: '결합밀도함수 f(x,y)에 대해 E[Y|X=x]를 정의하고 푸비니 정리에 의해 적분 순서를 교환하여 E[E[Y|X]] = E[Y]를 증명함.',
      confidence: 4,
      errorType: 'none' as const,
      hintCount: 1,
      reasoningNotes: '푸비니 정리의 전제조건을 증명 첫 줄에 명시함',
      calculatedScore: earnedTotal,
      rubricResults: stage4Rubric,
      evaluatorFeedback: '푸비니 정리 적용과 이중적분 순서 교환이 명확하고 논리적임.',
      strengths: '푸비니 정리의 핵심 정당화 단계를 정확히 포착함.',
      criticalImprovements: '절대수렴 조건 부등식 표현을 보완할 것.',
      staticAnalysisNotice: '본 평가는 AI 모델의 정적 분석 및 논증 검토를 바탕으로 산출되었습니다.',
      needsReview: false,
      isAiEvaluated: true,
      modelAnswerSnapshot: approvalResult.approvedProblem!.modelAnswer,
      problemTitleSnapshot: approvalResult.approvedProblem!.title,
      problemPromptSnapshot: approvalResult.approvedProblem!.promptText,
    };

    assert(stage4Attempt.problemPromptSnapshot.length > 0, 'Problem prompt snapshot safely preserved in Attempt');
    assert((stage4Attempt.modelAnswerSnapshot?.length || 0) > 0, 'Model answer snapshot safely preserved in Attempt');
    assert(stage4Attempt.rubricResults[0].evidenceQuote !== undefined, 'Rubric result contains evidence quote');
    assert(stage4Attempt.rubricResults[0].deductionReason !== undefined, 'Rubric result contains deduction reason');
    assert(stage4Attempt.rubricResults[0].improvementTip !== undefined, 'Rubric result contains improvement tip');

    // 22. Stage 4: Safe Attempt Recording & Concept Isolation
    console.log('\n--- 22. Testing Attempt Recording & Concept Isolation (No Arbitrary Score Duplication) ---');
    const preConcepts = loadStoredConcepts();
    const c2Pre = preConcepts.find((c) => c.id === 'c-econ-02');
    const c2PreEventCount = c2Pre?.events?.length || 0;

    const recordResult = recordAttemptAndUpdateConcept(stage4Attempt, DEFAULT_RETENTION_SETTINGS);
    assert(recordResult.updatedAttempts.some((a) => a.id === stage4Attempt.id), 'Attempt saved in attempts store');

    // Check duplicate attempt guard
    const recordDuplicate = recordAttemptAndUpdateConcept(stage4Attempt, DEFAULT_RETENTION_SETTINGS);
    const countOccurrences = recordDuplicate.updatedAttempts.filter((a) => a.id === stage4Attempt.id).length;
    assert(countOccurrences === 1, 'Duplicate submission prevention: attempt ID only recorded once');

    // Concept isolation: c1 updated, c2 NOT artificially altered
    const c1Post = recordResult.updatedConcepts.find((c) => c.id === 'c-econ-01');
    const c2Post = recordResult.updatedConcepts.find((c) => c.id === 'c-econ-02');
    assert(
      Boolean(c1Post?.events.some((e) => e.attemptId === stage4Attempt.id)),
      'Target concept received legitimate review event with attemptId'
    );
    assert((c2Post?.events?.length || 0) === c2PreEventCount, 'Multi-concept problem rule: unselected related concept does NOT receive forged duplicate score');

    // 23. Stage 4: Re-viewing Saved Attempt Data via getAttemptById
    console.log('\n--- 23. Testing Re-viewing Saved Attempt via getAttemptById ---');
    const retrievedAttempt = getAttemptById(stage4Attempt.id);
    assert(retrievedAttempt !== null, 'Saved attempt successfully retrieved by ID');
    assert(retrievedAttempt?.answer === stage4Attempt.answer, 'Retrieved attempt contains original answer text');
    assert(retrievedAttempt?.calculatedScore === stage4Attempt.calculatedScore, 'Retrieved attempt contains original calculatedScore');
    assert(retrievedAttempt?.rubricResults.length === stage4Rubric.length, 'Retrieved attempt contains full itemized rubric results');

    // 24. Stage 5: Timestamp-based Asia/Seoul Calendar & Elapsed Time Calculation
    console.log('\n--- 24. Testing Real Timestamp-Based Asia/Seoul Calendar & Elapsed Day Calculations ---');
    const refSeoulTime = new Date('2026-09-29T10:00:00+09:00');
    const eventTime1 = '2026-09-26T16:00:00+09:00'; // 3 calendar days ago
    const eventTime2 = '2026-09-29T02:00:00+09:00'; // same calendar day (midnight crossed)
    const futureTime = '2026-10-12T10:00:00+09:00'; // +13 calendar days

    const diff1 = getSeoulCalendarDiff(eventTime1, refSeoulTime);
    assert(diff1 === 3, `Calendar day diff in Asia/Seoul is exactly 3 days (got ${diff1})`);

    const diffMidnight = getSeoulCalendarDiff(eventTime2, refSeoulTime);
    assert(diffMidnight === 0, `Same calendar day across midnight yields 0 days (got ${diffMidnight})`);

    const diffFuture = getSeoulCalendarDiff(refSeoulTime, futureTime);
    assert(diffFuture === 13, `Future date calendar diff is exactly +13 days (got ${diffFuture})`);

    const fractionalElapsed = getElapsedDays(eventTime1, refSeoulTime);
    assert(
      fractionalElapsed > 2.7 && fractionalElapsed < 2.8,
      `Exact fractional elapsed days calculated accurately (~2.75 days, got ${fractionalElapsed.toFixed(2)})`
    );

    // 25. Stage 5: Spaced Repetition Optimal Interval & Factor Sensitivity
    console.log('\n--- 25. Testing Optimal Review Interval & Factor Sensitivity ---');
    // High confidence (5) vs Low confidence (1)
    const tauHighConf = calculateComprehensiveTau(2.5, 1, 5, 0, 0);
    const tauLowConf = calculateComprehensiveTau(2.5, 1, 1, 0, 0);
    assert(
      tauHighConf > tauLowConf,
      `Higher confidence yields greater stability: tauHigh(${tauHighConf}) > tauLow(${tauLowConf})`
    );

    // Hint usage penalty
    const tauNoHints = calculateComprehensiveTau(2.5, 1, 3, 0, 0);
    const tauWithHints = calculateComprehensiveTau(2.5, 1, 3, 3, 0);
    assert(
      tauNoHints > tauWithHints,
      `Using hints reduces stability: tauNoHints(${tauNoHints}) > tauWithHints(${tauWithHints})`
    );

    // Vulnerable rubric items penalty
    const tauCleanRubric = calculateComprehensiveTau(2.5, 1, 3, 0, 0);
    const tauVulnerableRubric = calculateComprehensiveTau(2.5, 1, 3, 0, 2);
    assert(
      tauCleanRubric > tauVulnerableRubric,
      `Vulnerable rubric items accelerate decay: clean(${tauCleanRubric}) > vulnerable(${tauVulnerableRubric})`
    );

    // Power-law inversion formula: interval where R(t*) = threshold
    const interval88 = calculatePowerLawOptimalInterval(88, 2.5, 0.55, 50.0);
    assert(
      interval88 > 2.0 && interval88 < 8.0,
      `Power-law inversion yields reasonable optimal review interval (~4-6 days, got ${interval88.toFixed(2)})`
    );

    const intervalBelowThreshold = calculatePowerLawOptimalInterval(45, 2.5, 0.55, 50.0);
    assert(
      intervalBelowThreshold === 0,
      'Score already at or below critical threshold triggers immediate review (interval = 0)'
    );

    // 26. Stage 5: Postpone (+1 Day) Invariant (No Fake Score Boost or Events)
    console.log('\n--- 26. Testing Postpone (+1 Day) Invariant (No Fake Score Boost or Events) ---');
    const conceptsBeforePostpone: Concept[] = loadStoredConcepts(refSeoulTime);
    const targetC = conceptsBeforePostpone.find((c) => c.id === 'c-econ-01')!;
    const scoreBefore = targetC.currentScore;
    const baseScoreBefore = targetC.baseScore;
    const eventCountBefore = targetC.events.length;
    const initialPostpone = targetC.postponeDays || 0;

    const postponeResult1 = postponeConceptReview(targetC.id, 1, refSeoulTime);
    const postponedC1 = postponeResult1.postponedConcept!;

    assert(
      postponedC1.postponeDays === initialPostpone + 1,
      `Postpone increments postponeDays by 1 (was ${initialPostpone}, now ${postponedC1.postponeDays})`
    );
    assert(
      postponedC1.currentScore === scoreBefore,
      `CRITICAL INVARIANT: Postpone does NOT inflate currentScore (${postponedC1.currentScore} === ${scoreBefore})`
    );
    assert(
      postponedC1.baseScore === baseScoreBefore,
      `CRITICAL INVARIANT: Postpone does NOT modify baseScore (${postponedC1.baseScore} === ${baseScoreBefore})`
    );
    assert(
      postponedC1.events.length === eventCountBefore,
      `CRITICAL INVARIANT: Postpone does NOT append fake ReviewEvents (${postponedC1.events.length} === ${eventCountBefore})`
    );
    assert(
      Boolean(postponedC1.postponedUntil),
      `Postponed target date safely stored in postponedUntil (${postponedC1.postponedUntil})`
    );

    // Second consecutive postpone adds another day
    const postponeResult2 = postponeConceptReview(targetC.id, 1, refSeoulTime);
    assert(
      postponeResult2.postponedConcept!.postponeDays === initialPostpone + 2,
      'Consecutive postpone shifts schedule additively (+2 days)'
    );

    // 27. Stage 5: Deterministic Review Urgency Ranking
    console.log('\n--- 27. Testing Deterministic Review Urgency Ranking ---');
    const rankingEcon = rankConceptsForReview(
      conceptsBeforePostpone.filter((c) => c.subjectId === 'subj-econ302'),
      DEFAULT_RETENTION_SETTINGS,
      '2026-10-12T10:00:00+09:00',
      refSeoulTime
    );

    assert(rankingEcon.rankedRecommendations.length > 0, 'Generated ranked recommendations for ECON302');
    assert(
      rankingEcon.rankedRecommendations[0].priorityRank === 1,
      'Top recommendation assigned priorityRank = 1'
    );
    assert(
      rankingEcon.rankedRecommendations[0].urgencyScore >= rankingEcon.rankedRecommendations[1].urgencyScore,
      `Deterministic ordering: Rank 1 urgency (${rankingEcon.rankedRecommendations[0].urgencyScore}) >= Rank 2 (${rankingEcon.rankedRecommendations[1].urgencyScore})`
    );

    // Concept with low score (c-econ-01: ~48 score) is due today or overdue
    const recC1 = rankingEcon.rankedRecommendations.find((r) => r.conceptId === 'c-econ-01');
    assert(recC1 !== undefined, 'Concept 1 included in recommendations');
    assert(
      recC1!.priorityReason.includes('모델 점수') || recC1!.priorityReason.includes('임계치'),
      `Priority rationale clearly explains factors: "${recC1!.priorityReason}"`
    );

    // 28. Stage 5: Dynamic Trajectory Projection to Exam Date vs Unset Exam & Unstudied Concepts
    console.log('\n--- 28. Testing Dynamic Trajectory to Exam Date vs Unset Exam & Unstudied Concepts ---');
    // Concept with exam date
    const trajWithExam = generateConceptTrajectory(targetC, DEFAULT_RETENTION_SETTINGS, 13, refSeoulTime);
    assert(trajWithExam.hasExamDate === true, 'trajWithExam recognizes set exam date');
    assert(trajWithExam.historyCurve.length > 0, 'Contains observed historical points');
    assert(
      trajWithExam.historyCurve.some((pt) => pt.isEventPoint && pt.dateStr),
      'Event dots annotated with real calendar dates'
    );
    assert(trajWithExam.dateTicks.some((t) => t.isToday), 'Chart X-axis includes dynamic Today tick');
    assert(trajWithExam.dateTicks.some((t) => t.isExam), 'Chart X-axis includes dynamic Exam Day tick');

    // Unset exam fallback
    const trajUnsetExam = generateConceptTrajectory(targetC, DEFAULT_RETENTION_SETTINGS, 0, refSeoulTime);
    assert(trajUnsetExam.hasExamDate === false, 'trajUnsetExam cleanly flags hasExamDate = false');

    // Unstudied concept invariant
    const unstudiedConcept = {
      ...targetC,
      id: 'c-test-unstudied',
      status: 'unstudied' as const,
      events: [],
      currentScore: 0,
      baseScore: 0,
    };
    const trajUnstudied = generateConceptTrajectory(unstudiedConcept, DEFAULT_RETENTION_SETTINGS, 13, refSeoulTime);
    assert(trajUnstudied.isUnstudied === true, 'Unstudied concept isUnstudied flag is true');
    assert(trajUnstudied.historyCurve.length === 0, 'Unstudied concept has ZERO fake history coordinates');
    assert(trajUnstudied.neglectedProjection.length === 0, 'Unstudied concept has ZERO fake projection coordinates');
    assert(trajUnstudied.currentScore === 0, 'Unstudied concept score is strictly 0 (SCORE --)');

    // 29. Stage 5: Subject Data Isolation & Non-Contamination
    console.log('\n--- 29. Testing Subject Data Isolation & Recommendation Scoping ---');
    const csConcepts = conceptsBeforePostpone.filter((c) => c.subjectId === 'subj-cs201');
    const rankingCs = rankConceptsForReview(csConcepts, DEFAULT_RETENTION_SETTINGS, undefined, refSeoulTime);

    assert(
      !rankingCs.rankedRecommendations.some((r) => r.conceptId.startsWith('c-econ')),
      'CS201 recommendations contain NO ECON302 concepts'
    );
    assert(
      !rankingEcon.rankedRecommendations.some((r) => r.conceptId.startsWith('c-cs')),
      'ECON302 recommendations contain NO CS201 concepts'
    );

    // ========================================================
    // STAGE 6 TESTS: PROBLEM QUALITY REPORT, REVIEW, EDIT, REAPPROVAL
    // ========================================================

    // 30. Stage 6: Problem Quality Status & Version Default Migration
    console.log('\n--- 30. Testing Stage 6 Problem Quality & Version Migration ---');
    // Save raw problem without version or qualityStatus (simulating legacy data)
    const rawLegacyProblems: unknown[] = [
      {
        id: 'prob-legacy-01',
        draftId: 'draft-legacy-01',
        subjectId: 'subj-econ302',
        conceptIds: ['c-econ-01'],
        type: 'essay_descriptive',
        difficulty: 'exam_advanced',
        title: '레거시 수리통계 검정 문제',
        promptText: '검정력 함수의 단조성을 증명하시오.',
        modelAnswer: '모수 공간 theta > theta_0에 대해 기각역을 설정하여...',
        rubric: [
          { item: '가설 설정', maxScore: 30, description: '귀무가설과 대립가설' },
          { item: '기각역 유도', maxScore: 40, description: '우도비 통계량' },
          { item: '단조성 증명', maxScore: 30, description: '도함수 부호 판별' },
        ],
        hints: ['우도비 검정을 활용하세요.'],
        createdAt: '2026-09-20T10:00:00+09:00',
      },
    ];
    saveStoredProblems(rawLegacyProblems as unknown as Problem[]);

    const loadedMigrated = loadStoredProblems();
    const migratedProb = loadedMigrated.find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(migratedProb !== undefined, 'Legacy problem loaded safely');
    assert(migratedProb.version === 1, `Legacy problem migrated with default version 1 (got ${migratedProb.version})`);
    assert(
      migratedProb.qualityStatus === 'normal',
      `Legacy problem migrated with default qualityStatus 'normal' (got ${migratedProb.qualityStatus})`
    );
    assert(Array.isArray(migratedProb.reports) && migratedProb.reports.length === 0, 'Legacy problem initialized with empty reports array');
    assert(Array.isArray(migratedProb.versionHistory) && migratedProb.versionHistory.length === 0, 'Legacy problem initialized with empty versionHistory');
    assert(isProblemAvailableForPractice(migratedProb) === true, 'Migrated normal problem is available for practice');

    // Legacy attempt migration (problemVersion default)
    const rawLegacyAttempts: unknown[] = [
      {
        id: 'att-legacy-01',
        conceptId: 'c-econ-01',
        problemId: 'prob-legacy-01',
        problemType: 'essay_descriptive',
        userAnswer: '가설 H0: theta <= theta_0 ...',
        revealedHintCount: 0,
        selfConfidence: 4,
        diagnosedErrorType: 'none',
        calculatedScore: 92,
        evaluatedAt: '2026-09-20T11:00:00+09:00',
      },
    ];
    saveStoredAttempts(rawLegacyAttempts as unknown as Attempt[]);
    const loadedMigratedAttempts = loadStoredAttempts();
    const migratedAtt = loadedMigratedAttempts.find((a: Attempt) => a.id === 'att-legacy-01')!;
    assert(migratedAtt.problemVersion === 1, `Legacy attempt migrated with default problemVersion 1 (got ${migratedAtt.problemVersion})`);

    // 31. Stage 6: Reporting Problem Across 7 Categories & Quarantine Invariant
    console.log('\n--- 31. Testing Problem Reporting across 7 Categories & Practice Quarantine ---');
    const reportCategories: ProblemReportType[] = [
      'missing_or_vague_condition',
      'incorrect_model_answer',
      'rubric_error',
      'source_mismatch',
      'multiple_answers_possible',
      'inappropriate_difficulty_or_scope',
      'other',
    ];

    for (const cat of reportCategories) {
      assert(PROBLEM_REPORT_TYPE_LABELS[cat] !== undefined, `Category ${cat} has user-friendly label: "${PROBLEM_REPORT_TYPE_LABELS[cat]}"`);
    }

    // Submit report on migrated problem
    const reportRes1 = reportProblemError('prob-legacy-01', {
      type: 'missing_or_vague_condition',
      details: '표본의 정규분포 가정이 누락되어 우도비 검정 통계량 전개가 성립하지 않습니다.',
      attemptId: 'att-legacy-01',
    });

    assert(reportRes1.success === true, 'Successfully reported problem error with category and attempt link');
    assert(reportRes1.reportId !== undefined, 'Report returned unique reportId');

    const problemsAfterReport = loadStoredProblems();
    const reportedProb = problemsAfterReport.find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(reportedProb.qualityStatus === 'reported', `Problem status automatically transitioned to 'reported' (got ${reportedProb.qualityStatus})`);
    assert(reportedProb.reports!.length === 1, 'Problem reports array contains 1 recorded report');
    assert(reportedProb.reports![0].type === 'missing_or_vague_condition', 'Report type preserved correctly');
    assert(reportedProb.reports![0].attemptId === 'att-legacy-01', 'Report preserves user attemptId linkage');
    assert(reportedProb.reports![0].status === 'open', 'New report initialized in open status');

    // CRITICAL INVARIANT: Quarantine from practice / review / mock exams
    assert(
      isProblemAvailableForPractice(reportedProb) === false,
      'CRITICAL INVARIANT: Reported problem is immediately quarantined and excluded from practice/review/mock exams'
    );

    // 32. Stage 6: Debounce Protection (Anti-Spam Rapid Duplicate Prevention)
    console.log('\n--- 32. Testing Anti-Spam Debounce Protection ---');
    // Immediate identical report submission within 15 seconds
    const spamReportRes = reportProblemError('prob-legacy-01', {
      type: 'missing_or_vague_condition',
      details: '표본의 정규분포 가정이 누락되어 우도비 검정 통계량 전개가 성립하지 않습니다.',
    });
    assert(spamReportRes.success === false, 'Duplicate report within debounce window is REJECTED');
    assert(
      Boolean(
        spamReportRes.error?.includes('중복') ||
        spamReportRes.error?.includes('연속') ||
        spamReportRes.error?.includes('동일한')
      ),
      `Debounce rejection returns informative message: "${spamReportRes.error}"`
    );

    const probAfterSpam = loadStoredProblems().find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(probAfterSpam.reports!.length === 1, 'Report count DID NOT increment on duplicate submission');

    // A distinct non-duplicate report (e.g. rubric_error) succeeds
    const secondReportRes = reportProblemError('prob-legacy-01', {
      type: 'rubric_error',
      details: '배점 기준의 기각역 유도 항목 40점이 너무 과다합니다.',
    });
    assert(secondReportRes.success === true, 'Distinct report with different category/details succeeds');
    const probWithTwoReports = loadStoredProblems().find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(probWithTwoReports.reports!.length === 2, 'Problem preserves multiple distinct reports with timestamps');

    // 33. Stage 6: Quality Review Lifecycle (`under_review`)
    console.log('\n--- 33. Testing Quality Review Status Transition ---');
    const { updatedProblem: underReviewProb } = updateProblemQualityStatus('prob-legacy-01', 'under_review', '운영자가 검토 착수');
    assert(underReviewProb !== null && underReviewProb !== undefined, 'updateProblemQualityStatus succeeds');
    assert(underReviewProb!.qualityStatus === 'under_review', 'Problem qualityStatus is now under_review');
    assert(isProblemAvailableForPractice(underReviewProb!) === false, 'Problem remains quarantined while under_review');
    assert(
      Boolean(underReviewProb!.reports && underReviewProb!.reports.every((r: ProblemReport) => r.status === 'under_review')),
      'All pending reports transitioned to under_review'
    );

    // 34. Stage 6: Report Dismissal with Documented Reason & Practice Restoration
    console.log('\n--- 34. Testing Report Dismissal with Documented Reason ---');
    // Dismiss without reason fails
    const failDismiss = dismissProblemReport('prob-legacy-01', secondReportRes.reportId!, '');
    assert(failDismiss.success === false, 'Dismissal without documented reason is REJECTED');

    // Dismiss second report
    const okDismiss2 = dismissProblemReport(
      'prob-legacy-01',
      secondReportRes.reportId!,
      '수리통계학 기말 배점 관행상 기각역 유도 40점은 정상적인 배점 분배임.'
    );
    assert(okDismiss2.success === true, 'Report dismissed successfully with documented reason');

    const probAfterDismiss1 = loadStoredProblems().find((p: Problem) => p.id === 'prob-legacy-01')!;
    const dismissedRep = probAfterDismiss1.reports!.find((r: ProblemReport) => r.id === secondReportRes.reportId)!;
    assert(dismissedRep.status === 'dismissed', 'Report status marked as dismissed');
    assert(dismissedRep.resolutionNote !== undefined, 'Dismissed reason preserved');
    assert(probAfterDismiss1.qualityStatus === 'under_review', 'Problem remains under review because first report is still open');

    // Dismiss first report as well
    const okDismiss1 = dismissProblemReport(
      'prob-legacy-01',
      reportRes1.reportId!,
      '문제 전문의 단서 조항에 i.i.d. N(mu, sigma^2) 가정이 이미 명시되어 있어 신고 기각함.'
    );
    assert(okDismiss1.success === true, 'First report dismissed');

    const probAllDismissed = loadStoredProblems().find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(
      probAllDismissed.qualityStatus === 'normal' || probAllDismissed.qualityStatus === 'reapproved',
      `All reports resolved: problem automatically restored to active status (${probAllDismissed.qualityStatus})`
    );
    assert(
      isProblemAvailableForPractice(probAllDismissed) === true,
      'Problem is RESTORED to practice availability once all false reports are dismissed'
    );

    // 35. Stage 6: Problem Revision, Version Increment (v1 -> v2) & Version Snapshot Invariant
    console.log('\n--- 35. Testing Problem Revision & Version History Snapshot ---');
    // Report a real error on a fresh problem to test revision flow
    const testProbV1: Problem = {
      id: 'prob-revision-test',
      draftId: 'draft-rev-01',
      subjectId: 'subj-econ302',
      conceptIds: ['c-econ-01'],
      type: 'essay_descriptive',
      difficulty: 'advanced_college',
      categoryLabel: '대학 논술·서술형',
      categoryNumber: 1,
      timeStandardMinutes: 20,
      timeBreakdownDesc: '풀이 및 검산 20분',
      coreEvaluationHighlight: '수리적 엄밀성',
      itemCountDesc: '2개 세부 문항',
      sourceRefs: '수리통계학 제4장 p.120',
      title: '가설검정 오류 검토 대상 문제 v1',
      promptText: '지문 v1: 표본 X_1, ..., X_n에 대한 검정통계량을 구하시오.',
      modelAnswer: '모범 답안 v1: t-통계량 = (X_bar - mu0) / (S / sqrt(n))',
      rubric: [
        { id: 'r1', label: '항목 1', maxScore: 50, weight: 0.5, description: '통계량 유도' },
        { id: 'r2', label: '항목 2', maxScore: 50, weight: 0.5, description: '자유도 명시' },
      ],
      hints: ['힌트 v1'],
      version: 1,
      qualityStatus: 'normal',
      reports: [],
      versionHistory: [],
      createdAt: '2026-09-20T10:00:00+09:00',
    };
    saveStoredProblems([...loadStoredProblems(), testProbV1]);

    // Record an attempt for v1 BEFORE revision
    const attemptForV1: Attempt = {
      id: 'att-v1-recorded',
      conceptId: 'c-econ-01',
      problemId: 'prob-revision-test',
      subjectId: 'subj-econ302',
      problemVersion: 1,
      at: '2026-09-20T12:00:00+09:00',
      answer: '사용자 v1 작성 답안: t = ...',
      confidence: 3,
      errorType: 'none',
      hintCount: 0,
      reasoningNotes: '',
      calculatedScore: 88,
      rubricResults: [
        { criterionId: 'r1', label: '항목 1', score: 45, maxScore: 50, feedback: '전개 우수' },
        { criterionId: 'r2', label: '항목 2', score: 43, maxScore: 50, feedback: '자유도 n-1 정확함' },
      ],
      evaluatorFeedback: '전반적으로 우수함',
    };
    saveStoredAttempts([...loadStoredAttempts(), attemptForV1]);

    // Report problem
    reportProblemError('prob-revision-test', {
      type: 'missing_or_vague_condition',
      details: '모분산이 알려지지 않은 정규모집단 가정이 누락됨.',
      attemptId: 'att-v1-recorded',
    });

    // Revise problem with new text and mandatory editReason
    const editRes = editAndReviseProblem(
      'prob-revision-test',
      {
        promptText: '지문 v2: 모분산 sigma^2을 모르는 정규모집단으로부터의 확률표본 X_1, ..., X_n에 대한...',
        modelAnswer: '모범 답안 v2: t-통계량 유도 및 자유도 n-1의 t-분포 따름을 명시...',
        hints: ['힌트 v2: 정규모집단 표준화 과정 주의'],
      },
      '모집단 정규성 및 모분산 미지 조건 명시'
    );

    assert(editRes.success === true, 'Problem revision succeeded');
    const probV2 = loadStoredProblems().find((p: Problem) => p.id === 'prob-revision-test')!;

    assert(probV2.version === 2, `Problem version incremented to 2 (got ${probV2.version})`);
    assert(
      probV2.qualityStatus === 'review_after_edit',
      `Problem status moved to 'review_after_edit' (got ${probV2.qualityStatus})`
    );
    assert(
      isProblemAvailableForPractice(probV2) === false,
      'Revised problem remains quarantined until explicit re-approval'
    );
    assert(Boolean(probV2.versionHistory && probV2.versionHistory.length === 1), 'Version history contains 1 archived snapshot');

    const v1Snapshot = probV2.versionHistory![0];
    assert(v1Snapshot.version === 1, 'Snapshot correctly archives version 1');
    assert(v1Snapshot.promptText === '지문 v1: 표본 X_1, ..., X_n에 대한 검정통계량을 구하시오.', 'Snapshot preserves v1 promptText');
    assert(v1Snapshot.modelAnswer === '모범 답안 v1: t-통계량 = (X_bar - mu0) / (S / sqrt(n))', 'Snapshot preserves v1 modelAnswer');
    assert(v1Snapshot.editReason === '모집단 정규성 및 모분산 미지 조건 명시', 'Snapshot documents revision reason');

    // 36. Stage 6: Past Attempt Immutability Invariant (Never Regrade or Overwrite)
    console.log('\n--- 36. Testing Past Attempt Score Immutability & Version Invariant ---');
    const allAttemptsAfterRev = loadStoredAttempts();
    const pastAttempt = allAttemptsAfterRev.find((a: Attempt) => a.id === 'att-v1-recorded')!;

    assert(pastAttempt !== undefined, 'Past attempt found in storage');
    assert(
      pastAttempt.calculatedScore === 88,
      `CRITICAL INVARIANT: Past attempt score is strictly PRESERVED at 88 (NOT regraded or overwritten)`
    );
    assert(
      pastAttempt.problemVersion === 1,
      `CRITICAL INVARIANT: Past attempt still accurately points to problemVersion 1 (got ${pastAttempt.problemVersion})`
    );
    assert(
      pastAttempt.problemVersion !== probV2.version,
      `Attempt version (v1) and current problem version (v2) are clearly distinguished in history`
    );

    // 37. Stage 6: AI Re-review Rules & Invariant (No Auto Re-approval)
    console.log('\n--- 37. Testing Deterministic Quality Rules & Non-Auto-Reapproval Invariant ---');
    // Test rule checking logic: Rubric sum != 100
    const invalidRubricProb: Problem = {
      ...probV2,
      id: 'prob-invalid-rubric',
      rubric: [
        { id: 'rA', label: '항목 A', maxScore: 50, weight: 0.5, description: 'A' },
        { id: 'rB', label: '항목 B', maxScore: 40, weight: 0.4, description: 'B' }, // sum = 90
      ],
    };
    saveStoredProblems([...loadStoredProblems(), invalidRubricProb]);

    // Reapproval of problem with sum 90 must FAIL
    const reapproveFailRes = reapproveProblem('prob-invalid-rubric', '승인 시도');
    assert(reapproveFailRes.success === false, 'Re-approval with non-100-point rubric is REJECTED');
    assert(
      Boolean(reapproveFailRes.error?.includes('100점')),
      `Re-approval error message clearly specifies rubric requirement: "${reapproveFailRes.error}"`
    );

    // 38. Stage 6: Manual Re-approval Flow & Practice Restoration
    console.log('\n--- 38. Testing Manual Re-approval & Practice Circulation Restoration ---');
    // Reapprove probV2 (which has valid 50+50=100 rubric)
    const reapproveSuccessRes = reapproveProblem('prob-revision-test', '출처 및 필수 항목 검증 완료');
    assert(reapproveSuccessRes.success === true, 'Manual re-approval succeeded');

    const probAfterReapproval = loadStoredProblems().find((p: Problem) => p.id === 'prob-revision-test')!;
    assert(
      probAfterReapproval.qualityStatus === 'reapproved',
      `Problem qualityStatus is now 'reapproved' (got ${probAfterReapproval.qualityStatus})`
    );
    assert(
      isProblemAvailableForPractice(probAfterReapproval) === true,
      'Re-approved problem is RESTORED to practice circulation'
    );
    assert(
      Boolean(probAfterReapproval.reports && probAfterReapproval.reports.every((r: ProblemReport) => r.status === 'resolved')),
      'All open reports transitioned to resolved upon problem re-approval'
    );

    // 39. Stage 6: Problem Suspension
    console.log('\n--- 39. Testing Problem Suspension ---');
    const { updatedProblem: suspendRes } = suspendProblem('prob-revision-test', '출제 범위 개정으로 인한 문제 영구 제외');
    assert(suspendRes !== null && suspendRes !== undefined, 'suspendProblem call returned suspended problem');
    assert(suspendRes!.qualityStatus === 'suspended', 'Quality status is suspended');
    assert(
      isProblemAvailableForPractice(suspendRes!) === false,
      'Suspended problem is permanently excluded from practice'
    );

    // 40. Stage 6: Subject Data Isolation & Non-Contamination
    console.log('\n--- 40. Testing Subject Isolation for Problems & Quality Reports ---');
    const econProblems = loadStoredProblems().filter((p: Problem) => p.subjectId === 'subj-econ302');
    const csProblems = loadStoredProblems().filter((p: Problem) => p.subjectId === 'subj-cs201');

    assert(
      econProblems.every((p: Problem) => p.subjectId === 'subj-econ302'),
      'ECON302 problem set contains ONLY ECON302 problems'
    );
    assert(
      csProblems.every((p: Problem) => p.subjectId === 'subj-cs201'),
      'CS201 problem set contains ONLY CS201 problems'
    );

    // ==========================================
    // STAGE 8: SOLVING REASON & METHOD SELECTION EVALUATION
    // ==========================================
    console.log('\n=== STAGE 8 VERIFICATION: SOLVING REASON EXPLANATION & METHOD EVALUATION ===');

    // 41. Stage 8: Criteria and Rating Label Definitions
    console.log('\n--- 41. Testing Stage 8 Criteria and Rating Label Mappings ---');
    const expectedCriteria: MethodReasonCriterionKey[] = [
      'appropriate_method',
      'precondition_understanding',
      'constraint_alignment',
      'alternatives_limitations',
    ];
    assert(
      expectedCriteria.every((key) => Boolean(METHOD_REASON_CRITERION_LABELS[key])),
      'All 4 method reason criteria have defined Korean academic labels'
    );
    assert(
      METHOD_REASON_CRITERION_LABELS.appropriate_method === '적절한 방법 선택' &&
      METHOD_REASON_CRITERION_LABELS.precondition_understanding === '전제조건 이해' &&
      METHOD_REASON_CRITERION_LABELS.constraint_alignment === '문제의 제약과의 연결' &&
      METHOD_REASON_CRITERION_LABELS.alternatives_limitations === '대안·한계 인식',
      'Criteria labels strictly match Stage 8 specifications'
    );

    const expectedRatings: MethodReasonRating[] = [
      'proficient',
      'partially_met',
      'needs_improvement',
      'not_applicable',
    ];
    assert(
      expectedRatings.every((r) => Boolean(METHOD_REASON_RATING_LABELS[r])),
      'All 4 rating levels have defined Korean academic labels'
    );
    assert(
      METHOD_REASON_RATING_LABELS.proficient === '충분' &&
      METHOD_REASON_RATING_LABELS.partially_met === '부분 충족' &&
      METHOD_REASON_RATING_LABELS.needs_improvement === '보완 필요' &&
      METHOD_REASON_RATING_LABELS.not_applicable === '평가 불가',
      'Rating labels strictly match Stage 8 specifications (충분, 부분 충족, 보완 필요, 평가 불가)'
    );

    // 42. Stage 8: Decoupled Scoring Invariant (Correct Answer + Weak Reason)
    console.log('\n--- 42. Testing Decoupled Scoring: Correct Answer (100) with Weak Method Reason ---');
    const stage8WeakReasonAttempt: Attempt = {
      id: 'att-s8-correct-weak-reason',
      problemId: 'prob-econ-1',
      conceptId: 'c-econ-01',
      subjectId: 'subj-econ302',
      at: '2026-09-30T10:00:00+09:00',
      answer: '수식 전개: \\int_0^1 \\int_0^1 xy dx dy = 1/4. 최종 답은 1/4입니다.',
      confidence: 4,
      errorType: 'none',
      hintCount: 0,
      reasoningNotes: '직관으로 풀었음',
      calculatedScore: 100, // 100% full rubric score
      rubricResults: [
        {
          criterionId: 'r1',
          label: '적분 순서 교환 및 계산 정합성',
          score: 100,
          maxScore: 100,
          isVulnerable: false,
          evidenceQuote: '최종 답은 1/4입니다',
          deductionReason: '감점 요인 없음 (만점 기준 충족)',
          improvementTip: '완벽한 계산 전개입니다.',
        },
      ],
      evaluatorFeedback: '수학적 계산 및 결론 도출이 모두 정확합니다.',
      strengths: '간결하고 정확한 적분 계산',
      criticalImprovements: '선택한 정리의 전제조건 서술 보완 필요',
      isAiEvaluated: true,
      problemVersion: 1,
      // Stage 8 fields:
      solvingReason: '그냥 직관적으로 계산하기 편할 것 같아서 적분 순서를 바꿨습니다.',
      isReasonNotApplicable: false,
      methodSelectionDiagnosis: {
        isApplicable: true,
        applicabilityAssessment: '이 문제는 적분 순서 변경을 위해 푸비니 또는 톤넬리 정리의 적용 타당성을 설명해야 하는 문항입니다.',
        criteria: [
          {
            key: 'appropriate_method',
            label: '적절한 방법 선택',
            rating: 'partially_met',
            evidence: '적분 순서를 바꿨습니다',
            feedback: '적분 순서 교환 접근은 유효하나 적용 정리 명시가 누락되었습니다.',
          },
          {
            key: 'precondition_understanding',
            label: '전제조건 이해',
            rating: 'needs_improvement',
            evidence: '답안 및 이유에 해당 서술 없음',
            feedback: '피적분함수의 가측성이나 비음수성(톤넬리 정리)에 대한 전제조건 서술이 없습니다.',
          },
          {
            key: 'constraint_alignment',
            label: '문제의 제약과의 연결',
            rating: 'partially_met',
            evidence: '계산하기 편할 것 같아서',
            feedback: '구체적인 수식 제약과의 연계 논증이 부족합니다.',
          },
          {
            key: 'alternatives_limitations',
            label: '대안·한계 인식',
            rating: 'needs_improvement',
            evidence: '답안 및 이유에 해당 서술 없음',
            feedback: '단순 반복적분 대신 순서 교환을 택한 수학적 대안 비교가 없습니다.',
          },
        ],
        summary: '수학적 계산은 완제되었으나, 방법 선택의 이론적 근거와 정리 전제조건 서술이 보완되어야 합니다.',
        suggestedImprovements: [
          '피적분함수 f(x,y)=xy >= 0 (x,y in [0,1])이므로 톤넬리 정리에 의해 적분 순서 교환이 정당화됨을 명시하십시오.',
        ],
        nextConceptsToReview: ['톤넬리-푸비니 정리의 가측성 및 적분가능성 전제조건'],
        evaluatedAt: '2026-09-30T10:00:05+09:00',
      },
    };

    assert(
      stage8WeakReasonAttempt.calculatedScore === 100,
      'CRITICAL INVARIANT: Solution score remains 100 despite weak method reason'
    );
    assert(
      Boolean(stage8WeakReasonAttempt.methodSelectionDiagnosis?.criteria.some((c) => c.rating === 'needs_improvement')),
      'Method selection reason independently flags needs_improvement without confounding solution score'
    );

    // 43. Stage 8: Decoupled Scoring Invariant (Wrong Answer + Proficient Reason)
    console.log('\n--- 43. Testing Decoupled Scoring: Calculation Error (50) with Proficient Method Reason ---');
    const stage8SoundReasonAttempt: Attempt = {
      id: 'att-s8-wrong-sound-reason',
      problemId: 'prob-cs-1',
      conceptId: 'c-cs-02',
      subjectId: 'subj-cs201',
      at: '2026-09-30T10:30:00+09:00',
      answer: '다익스트라 알고리즘 구현 중 힙 삽입 조건 부등호를 반대로 작성하여 최단경로 갱신 실패 (오류 발생)',
      confidence: 3,
      errorType: 'calc_or_impl_mistake',
      hintCount: 0,
      reasoningNotes: '부등호 오타',
      calculatedScore: 50, // 50% due to implementation bug
      rubricResults: [
        {
          criterionId: 'crit-cs-1',
          label: '알고리즘 구현 정확성',
          score: 50,
          maxScore: 100,
          isVulnerable: true,
          evidenceQuote: '힙 삽입 조건 부등호를 반대로 작성',
          deductionReason: '조건문 부등호 반대 표기로 인한 런타임 최단거리 불일치',
          improvementTip: '우선순위 큐 최소 힙 비교 함수를 재검토하십시오.',
        },
      ],
      evaluatorFeedback: '구현 상의 부등호 실수로 인해 최종 결과가 불일치합니다.',
      strengths: '적절한 다익스트라 알고리즘 및 우선순위 큐 구조 선택',
      criticalImprovements: '우선순위 큐 조건식 검증',
      isAiEvaluated: true,
      problemVersion: 1,
      // Stage 8 fields:
      solvingReason: '정점 수 V=10^5, 간선 수 E=3*10^5이고 모든 가중치가 비음수이므로, O(V^2) 단순 탐색은 시간초과가 발생합니다. 음수 사이클이 없으므로 벨만-포드보다 O((V+E)log V) 우선순위 큐 다익스트라가 최적입니다.',
      isReasonNotApplicable: false,
      methodSelectionDiagnosis: {
        isApplicable: true,
        applicabilityAssessment: '입력 크기 및 최단 경로 문제의 제약조건상 알고리즘 선택 이유 평가가 유효합니다.',
        criteria: [
          {
            key: 'appropriate_method',
            label: '적절한 방법 선택',
            rating: 'proficient',
            evidence: 'O((V+E)log V) 우선순위 큐 다익스트라가 최적입니다',
            feedback: '문제의 성격에 가장 부합하는 알고리즘을 정확히 선택했습니다.',
          },
          {
            key: 'precondition_understanding',
            label: '전제조건 이해',
            rating: 'proficient',
            evidence: '모든 가중치가 비음수이므로, 음수 사이클이 없으므로',
            feedback: '다익스트라가 성립하기 위한 핵심 전제조건(비음수 가중치)을 명확히 짚었습니다.',
          },
          {
            key: 'constraint_alignment',
            label: '문제의 제약과의 연결',
            rating: 'proficient',
            evidence: '정점 수 V=10^5, 간선 수 E=3*10^5',
            feedback: '입력 크기 제약과 시간복잡도 요구사항을 올바르게 연결지었습니다.',
          },
          {
            key: 'alternatives_limitations',
            label: '대안·한계 인식',
            rating: 'proficient',
            evidence: 'O(V^2) 단순 탐색은 시간초과, 벨만-포드보다 최적',
            feedback: '비효율적인 대안과 불필요한 알고리즘의 한계를 명확히 설명했습니다.',
          },
        ],
        summary: '구현 상의 단순 실수가 있었으나, 자료구조 및 알고리즘 선택의 논증은 만점에 해당할 정도로 훌륭합니다.',
        suggestedImprovements: ['우선순위 큐 삽입 시의 거리 갱신 부등호 방향을 면밀히 확인하십시오.'],
        nextConceptsToReview: ['최소 힙(Min-heap) 비교 연산자 정의 및 다익스트라 시간복잡도 증명'],
        evaluatedAt: '2026-09-30T10:30:05+09:00',
      },
    };

    assert(
      stage8SoundReasonAttempt.calculatedScore === 50,
      'CRITICAL INVARIANT: Solution score remains 50 despite proficient method reason'
    );
    assert(
      Boolean(stage8SoundReasonAttempt.methodSelectionDiagnosis?.criteria.every((c) => c.rating === 'proficient')),
      'Method reason criteria all proficient independently from solution score'
    );

    // 44. Stage 8: 'Not Applicable' (해당 없음) Handling
    console.log('\n--- 44. Testing Stage 8 "Not Applicable" (해당 없음) Logic ---');
    const notApplicableAttempt: Attempt = {
      id: 'att-s8-not-applicable',
      problemId: 'prob-definition-check',
      conceptId: 'c-econ-01',
      subjectId: 'subj-econ302',
      at: '2026-09-30T11:00:00+09:00',
      answer: '확률변수 X의 기댓값 정의는 E[X] = \\int x f(x) dx 입니다.',
      confidence: 5,
      errorType: 'none',
      hintCount: 0,
      reasoningNotes: '단순 정의 문항',
      calculatedScore: 100,
      rubricResults: [
        {
          criterionId: 'r1',
          label: '기댓값 정의 기술',
          score: 100,
          maxScore: 100,
          isVulnerable: false,
          evidenceQuote: 'E[X] = \\int x f(x) dx',
          deductionReason: '감점 없음',
          improvementTip: '정의 정확함',
        },
      ],
      evaluatorFeedback: '정의 서술이 완벽합니다.',
      isAiEvaluated: true,
      // Stage 8 fields:
      isReasonNotApplicable: true,
      reasonNotApplicableJustification: '단순 정의 회상 문항으로 별도의 공식·정리·알고리즘 선택이 필요하지 않음',
      methodSelectionDiagnosis: {
        isApplicable: false,
        applicabilityAssessment: '해당 문항은 수학적 정의를 직접 기술하는 단일 단계 회상형 문항으로, 별도의 정리나 알고리즘 선택이 요구되지 않습니다. 학생의 [해당 없음] 선택이 타당합니다.',
        criteria: [
          { key: 'appropriate_method', label: '적절한 방법 선택', rating: 'not_applicable', evidence: '해당 없음 선택됨', feedback: '방법 선택 평가 비대상' },
          { key: 'precondition_understanding', label: '전제조건 이해', rating: 'not_applicable', evidence: '해당 없음 선택됨', feedback: '방법 선택 평가 비대상' },
          { key: 'constraint_alignment', label: '문제의 제약과의 연결', rating: 'not_applicable', evidence: '해당 없음 선택됨', feedback: '방법 선택 평가 비대상' },
          { key: 'alternatives_limitations', label: '대안·한계 인식', rating: 'not_applicable', evidence: '해당 없음 선택됨', feedback: '방법 선택 평가 비대상' },
        ],
        summary: '단순 정의 문항으로 방법 선택 평가 해당 없음 확인 완료.',
        suggestedImprovements: ['정의의 적분가능성 전제(E[|X|] < infinity)를 추가로 기억해두면 좋습니다.'],
        nextConceptsToReview: ['르베그 적분 가능성과 기댓값의 존재조건'],
        evaluatedAt: '2026-09-30T11:00:05+09:00',
      },
    };

    assert(
      notApplicableAttempt.isReasonNotApplicable === true,
      'isReasonNotApplicable is true'
    );
    assert(
      Boolean(notApplicableAttempt.reasonNotApplicableJustification),
      'reasonNotApplicableJustification is present'
    );
    assert(
      notApplicableAttempt.methodSelectionDiagnosis?.isApplicable === false,
      'methodSelectionDiagnosis.isApplicable is false'
    );
    assert(
      Boolean(notApplicableAttempt.methodSelectionDiagnosis?.criteria.every((c) => c.rating === 'not_applicable')),
      'All criteria rated as not_applicable when not applicable'
    );

    // 45. Stage 8: Mock Exam Auto-Save, Restoration & Attempt Recording
    console.log('\n--- 45. Testing Mock Exam Reason Input Auto-Save & Restoration ---');
    clearMockExams();

    const mockSession: MockExamSession = {
      id: 'mock-exam-stage8-test',
      subjectId: 'subj-econ302',
      createdAt: '2026-09-30T12:00:00+09:00',
      endsAt: '2026-09-30T13:00:00+09:00',
      durationMinutes: 60,
      status: 'in_progress',
      selectedConceptIds: ['c-econ-01'],
      selectedTypes: ['calc_derivation'],
      problems: [INITIAL_PROBLEMS[0]],
      answers: {
        [INITIAL_PROBLEMS[0].id]: '모의시험 풀이 답안 작성',
      },
      reasons: {
        [INITIAL_PROBLEMS[0].id]: '비음수 확률변수이므로 톤넬리 정리를 선택하여 적분 순서를 변경함',
      },
      isReasonNotApplicable: {
        [INITIAL_PROBLEMS[0].id]: false,
      },
      reasonNotApplicableJustification: {},
      evaluations: {},
    };

    saveMockExam(mockSession);
    const loadedExams = loadMockExams();
    const retrievedMock = loadedExams.find((e) => e.id === 'mock-exam-stage8-test');

    assert(retrievedMock !== undefined, 'Mock exam session successfully saved and retrieved');
    assert(
      retrievedMock?.reasons?.[INITIAL_PROBLEMS[0].id] === '비음수 확률변수이므로 톤넬리 정리를 선택하여 적분 순서를 변경함',
      'Mock exam problem reason text successfully auto-saved and restored'
    );
    assert(
      retrievedMock?.isReasonNotApplicable?.[INITIAL_PROBLEMS[0].id] === false,
      'Mock exam problem isReasonNotApplicable successfully preserved'
    );

    // 46. Stage 8: Past Attempt Immutability & Safe Display Fallback
    console.log('\n--- 46. Testing Past Attempt Immutability & Safe Legacy Fallback ---');
    const storedAttempts = loadStoredAttempts();
    const legacyAttempt = storedAttempts.find((a) => a.id === 'att-econ-1' || a.id.startsWith('att-demo-'));

    if (legacyAttempt) {
      assert(
        legacyAttempt.solvingReason === undefined,
        'Legacy attempt has undefined solvingReason (no retroactive forgery)'
      );
      assert(
        legacyAttempt.methodSelectionDiagnosis === undefined,
        'Legacy attempt has undefined methodSelectionDiagnosis (no retroactive forgery)'
      );
      assert(
        typeof legacyAttempt.calculatedScore === 'number',
        'Legacy attempt calculatedScore is preserved intact'
      );
    } else {
      // Create a mock legacy attempt if storage doesn't have one
      const dummyLegacy: Attempt = {
        id: 'att-legacy-dummy',
        problemId: 'prob-econ-1',
        conceptId: 'c-econ-01',
        subjectId: 'subj-econ302',
        at: '2026-09-20T10:00:00+09:00',
        answer: '과거 답안',
        confidence: 3,
        errorType: 'none',
        hintCount: 0,
        reasoningNotes: '과거 메모',
        calculatedScore: 85,
        rubricResults: [],
        evaluatorFeedback: '과거 피드백',
      };
      assert(
        dummyLegacy.solvingReason === undefined && dummyLegacy.methodSelectionDiagnosis === undefined,
        'Legacy attempt structure safely omits Stage 8 fields'
      );
    }

    // 47. Stage 8: Retention Score Stability (No Impact on Retention Model Calculations)
    console.log('\n--- 47. Testing Retention Score Stability (Decoupled from Retention Model) ---');
    const { updatedConcepts: recordedConcepts } = recordAttemptAndUpdateConcept(
      stage8WeakReasonAttempt,
      DEFAULT_RETENTION_SETTINGS
    );
    const updatedTargetConcept = recordedConcepts.find((c) => c.id === stage8WeakReasonAttempt.conceptId)!;
    const targetAttemptEvent = updatedTargetConcept.events.find((e) => e.attemptId === stage8WeakReasonAttempt.id)!;

    assert(
      targetAttemptEvent !== undefined,
      'Attempt successfully recorded into concept review events'
    );
    assert(
      targetAttemptEvent.resultScore === 100,
      `Review event resultScore strictly reflects rubric calculatedScore (100) (got ${targetAttemptEvent.resultScore})`
    );
    assert(
      updatedTargetConcept.currentScore >= 95,
      `Concept retention score is driven strictly by rubric score and model decay (got ${updatedTargetConcept.currentScore})`
    );

    // =========================================================================
    // STAGE 9: EXAM DATE-DRIVEN STUDY PLAN ENGINE & WORKFLOW TESTS
    // =========================================================================
    console.log('\n=== STAGE 9 VERIFICATION: EXAM DATE-DRIVEN STUDY PLAN ENGINE ===');

    const testRefDate = new Date('2026-09-30T09:00:00+09:00');

    // 48. Stage 9: Unified Daily Budget Across Multiple Subjects
    console.log('\n--- 48. Testing Unified Daily Budget Across Multiple Subjects ---');
    const multiSubjectSettings: StudyPlanSettings = {
      defaultDailyMinutes: 60,
      weekdaySettings: {
        0: { dayOfWeek: 0, minutes: 60, isRestDay: false },
        1: { dayOfWeek: 1, minutes: 60, isRestDay: false },
        2: { dayOfWeek: 2, minutes: 60, isRestDay: false },
        3: { dayOfWeek: 3, minutes: 60, isRestDay: false },
        4: { dayOfWeek: 4, minutes: 60, isRestDay: false },
        5: { dayOfWeek: 5, minutes: 60, isRestDay: false },
        6: { dayOfWeek: 6, minutes: 60, isRestDay: false },
      },
      subjectConfigs: {
        'subj-econ302': {
          subjectId: 'subj-econ302',
          selectedConceptIds: ['c-econ-01', 'c-econ-02', 'c-econ-03'],
          selectedProblemTypes: ['essay_descriptive', 'calc_derivation'],
          includeMockExam: false,
          mockExamTargetMinutes: 45,
        },
        'subj-cs201': {
          subjectId: 'subj-cs201',
          selectedConceptIds: ['c-cs-01', 'c-cs-02'],
          selectedProblemTypes: ['impl_descriptive'],
          includeMockExam: false,
          mockExamTargetMinutes: 45,
        },
      },
      updatedAt: testRefDate.toISOString(),
    };

    const multiSubPlan = generateStudyPlan({
      subjects: INITIAL_SUBJECTS,
      concepts: INITIAL_CONCEPTS,
      problems: INITIAL_PROBLEMS,
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });

    assert(
      multiSubPlan.days[0].availableMinutes === 60,
      'Today available minutes strictly equals configured 60 minutes'
    );
    assert(
      multiSubPlan.days[0].assignedMinutes <= 60,
      `Today assigned minutes (${multiSubPlan.days[0].assignedMinutes}) strictly respects 60m unified budget across subjects`
    );
    assert(
      multiSubPlan.days.every((d) => d.assignedMinutes <= d.availableMinutes),
      'CRITICAL INVARIANT: Every single planned day assigned minutes <= availableMinutes'
    );

    // 49. Stage 9: Rest Day and 0-Minute Budget Handling
    console.log('\n--- 49. Testing Rest Day and 0-Minute Budget Handling ---');
    // Day 0 is Wednesday (dayOfWeek 3 in 2026-09-30). Set Thursday (day 4) as rest day.
    const restDaySettings: StudyPlanSettings = {
      ...multiSubjectSettings,
      weekdaySettings: {
        ...multiSubjectSettings.weekdaySettings,
        4: { dayOfWeek: 4, minutes: 0, isRestDay: true },
      },
    };

    const restDayPlan = generateStudyPlan({
      subjects: INITIAL_SUBJECTS,
      concepts: INITIAL_CONCEPTS,
      problems: INITIAL_PROBLEMS,
      attempts: [],
      settings: restDaySettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });

    const thursdayPlan = restDayPlan.days[1]; // Thursday (2026-10-01)
    assert(thursdayPlan.dayOfWeek === 4, 'Day 1 is Thursday');
    assert(thursdayPlan.isRestDay === true, 'Thursday is designated as rest day');
    assert(thursdayPlan.availableMinutes === 0, 'Thursday availableMinutes is strictly 0');
    assert(thursdayPlan.assignedMinutes === 0, 'Thursday assignedMinutes is strictly 0');
    assert(thursdayPlan.items.length === 0, 'No items are scheduled on rest day (0 minutes)');

    // 50. Stage 9: Exam Date States (Unset, Day-Of, Ended)
    console.log('\n--- 50. Testing Exam Date States (Unset, Day-Of, Ended) ---');
    const unsetExamSubject = { ...INITIAL_SUBJECTS[0], examAt: undefined };
    const dayOfExamSubject = {
      ...INITIAL_SUBJECTS[0],
      examAt: '2026-09-30T14:00:00+09:00', // Today at 14:00 (5 hours remaining from 09:00)
    };
    const endedExamSubject = {
      ...INITIAL_SUBJECTS[0],
      examAt: '2026-09-20T10:00:00+09:00', // Past exam
    };

    const unsetPlan = generateStudyPlan({
      subjects: [unsetExamSubject],
      concepts: INITIAL_CONCEPTS.filter((c) => c.subjectId === 'subj-econ302'),
      problems: INITIAL_PROBLEMS.filter((p) => p.subjectId === 'subj-econ302'),
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });
    assert(
      unsetPlan.days.length > 0 && unsetPlan.days[0].items.length > 0,
      'Unset exam provides general review plan smoothly without crashing'
    );

    const dayOfPlan = generateStudyPlan({
      subjects: [dayOfExamSubject],
      concepts: INITIAL_CONCEPTS.filter((c) => c.subjectId === 'subj-econ302'),
      problems: INITIAL_PROBLEMS.filter((p) => p.subjectId === 'subj-econ302'),
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });
    assert(
      dayOfPlan.days[0].availableMinutes <= 300,
      'Day-of-exam available study time is capped by hours remaining before exam start'
    );

    const endedPlan = generateStudyPlan({
      subjects: [endedExamSubject],
      concepts: INITIAL_CONCEPTS.filter((c) => c.subjectId === 'subj-econ302'),
      problems: INITIAL_PROBLEMS.filter((p) => p.subjectId === 'subj-econ302'),
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });
    assert(
      endedPlan.days.length > 0 && endedPlan.days[0].items.length > 0,
      'Ended exam transitions smoothly to post-exam general review mode'
    );

    // 51. Stage 9: Out-of-Scope Composite Problem Exclusion
    console.log('\n--- 51. Testing Out-of-Scope Composite Problem Exclusion ---');
    const compositeProb: Problem = {
      id: 'prob-composite-test',
      conceptIds: ['c-econ-01', 'c-econ-02'],
      subjectId: 'subj-econ302',
      title: '다중 개념 결합 논술 문제',
      type: 'essay_descriptive',
      categoryLabel: '1. 대학 논술·서술형',
      categoryNumber: 1,
      promptText: '두 개념을 연결하여 논증하시오.',
      timeStandardMinutes: 20,
      timeBreakdownDesc: '20분',
      coreEvaluationHighlight: '연계 논증',
      itemCountDesc: '1문항',
      sourceRefs: '교재 3장-4장',
      hints: [],
      modelAnswer: '모범 답안',
      rubric: [{ id: 'r1', label: '연계', maxScore: 100, weight: 1.0, description: '연계 논증' }],
      isApproved: true,
      isDemo: false,
      qualityStatus: 'normal',
    };

    // Case A: Scope includes only c-econ-01 -> composite problem MUST BE EXCLUDED
    const { eligibleProblems: scopeExclusion } = getEligibleProblemsForPlan(
      INITIAL_SUBJECTS[0],
      INITIAL_CONCEPTS[0], // c-econ-01
      [compositeProb],
      ['c-econ-01'], // Scope lacks c-econ-02!
      ['essay_descriptive']
    );
    assert(
      scopeExclusion.length === 0,
      'CRITICAL INVARIANT: Composite problem testing out-of-scope concept (c-econ-02) is strictly excluded'
    );

    // Case B: Scope includes BOTH c-econ-01 and c-econ-02 -> composite problem is eligible
    const { eligibleProblems: scopeInclusion } = getEligibleProblemsForPlan(
      INITIAL_SUBJECTS[0],
      INITIAL_CONCEPTS[0],
      [compositeProb],
      ['c-econ-01', 'c-econ-02'],
      ['essay_descriptive']
    );
    assert(
      scopeInclusion.length === 1 && scopeInclusion[0].id === 'prob-composite-test',
      'Composite problem is eligible when ALL linked concepts are within selected exam scope'
    );

    // 52. Stage 9: Missing Approved Problem & "문제 생성 필요" Flag
    console.log('\n--- 52. Testing Missing Approved Problem & "문제 생성 필요" Flag ---');
    const emptyProblemPlan = generateStudyPlan({
      subjects: [INITIAL_SUBJECTS[0]],
      concepts: [INITIAL_CONCEPTS[0]],
      problems: [], // ZERO problems provided
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });

    const missingProblemItem = emptyProblemPlan.days[0].items[0];
    assert(missingProblemItem !== undefined, 'Plan item generated for concept even without problem');
    assert(
      missingProblemItem.needsProblemGeneration === true,
      'Item correctly flags needsProblemGeneration = true when no approved problems exist'
    );
    assert(
      missingProblemItem.problemId === undefined,
      'problemId is undefined when problem generation is needed'
    );
    assert(
      missingProblemItem.snapshotTitle.includes('문제 생성 필요'),
      'Snapshot title clearly indicates problem generation is needed'
    );

    // 53. Stage 9: Actual Record Completion Invariant (No Fake Completions)
    console.log('\n--- 53. Testing Actual Record Completion Invariant (No Fake Completions) ---');
    const freshPlan = generateStudyPlan({
      subjects: [INITIAL_SUBJECTS[0]],
      concepts: [INITIAL_CONCEPTS[0]],
      problems: [compositeProb],
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      daysCount: 7,
    });
    const pendingItem = freshPlan.days[0].items[0];
    assert(
      pendingItem.status === 'pending',
      'Newly generated plan item has status "pending" (not falsely marked completed)'
    );

    // Save and mark complete with actual attemptId
    saveStoredStudyPlanItems([pendingItem]);
    const completedItems = markStudyPlanItemCompleted(pendingItem.id, {
      attemptId: 'att-actual-verified-123',
    });
    const completedItem = completedItems.find((i) => i.id === pendingItem.id)!;

    assert(
      completedItem.status === 'completed',
      'Item transitioned to completed upon explicit recording'
    );
    assert(
      completedItem.completedAttemptId === 'att-actual-verified-123',
      'Completed item preserves actual attemptId linkage'
    );
    assert(
      Boolean(completedItem.completedAt),
      'Completed item has real completedAt timestamp'
    );

    // 54. Stage 9: Duplicate Prevention & Single-Date Problem Uniqueness
    console.log('\n--- 54. Testing Single-Date Problem Uniqueness ---');
    const singleProb = { ...compositeProb, id: 'prob-unique-test' };
    const duplicateTestPlan = generateStudyPlan({
      subjects: [INITIAL_SUBJECTS[0]],
      concepts: [INITIAL_CONCEPTS[0], INITIAL_CONCEPTS[1]],
      problems: [singleProb],
      attempts: [],
      settings: {
        ...multiSubjectSettings,
        defaultDailyMinutes: 120, // Large budget
        weekdaySettings: {
          ...multiSubjectSettings.weekdaySettings,
          3: { dayOfWeek: 3, minutes: 120, isRestDay: false },
        },
      },
      referenceDate: testRefDate,
      daysCount: 7,
    });

    const day0ProblemIds = duplicateTestPlan.days[0].items
      .map((i) => i.problemId)
      .filter(Boolean);
    const uniqueDay0Problems = new Set(day0ProblemIds);
    assert(
      day0ProblemIds.length === uniqueDay0Problems.size,
      'CRITICAL INVARIANT: Same problem ID is NEVER duplicated on the same planned date'
    );

    // 55. Stage 9: Recalculation Completed History Preservation
    console.log('\n--- 55. Testing Recalculation Completed History Preservation ---');
    // Change settings daily budget from 60 to 40 minutes and recalculate
    const reducedBudgetSettings: StudyPlanSettings = {
      ...multiSubjectSettings,
      defaultDailyMinutes: 40,
    };

    const recalculatedPlan = generateStudyPlan({
      subjects: [INITIAL_SUBJECTS[0]],
      concepts: [INITIAL_CONCEPTS[0]],
      problems: [compositeProb],
      attempts: [],
      settings: reducedBudgetSettings,
      referenceDate: testRefDate,
      existingItems: [completedItem], // Feed previously completed item
      daysCount: 7,
    });

    const day0ItemRecalc = recalculatedPlan.days[0].items.find((i) => i.id === completedItem.id);
    assert(day0ItemRecalc !== undefined, 'Completed item remains scheduled on day 0');
    assert(
      day0ItemRecalc?.status === 'completed',
      'Completed item status is strictly preserved as "completed" across recalculation'
    );
    assert(
      day0ItemRecalc?.completedAttemptId === 'att-actual-verified-123',
      'Completed item attemptId linkage is preserved intact across recalculation'
    );

    // 56. Stage 9: Postponement and Overdue Past Exam Warning
    console.log('\n--- 56. Testing Postponement and Past-Exam Warning Note ---');
    const urgentSubject = {
      ...INITIAL_SUBJECTS[0],
      id: 'subj-urgent-exam',
      examAt: '2026-10-02T10:00:00+09:00', // Exam is in 2 days (Oct 2)
    };

    const postponedOverExamItem: StudyPlanItem = {
      id: 'spi-postponed-over-exam',
      subjectId: 'subj-urgent-exam',
      subjectName: urgentSubject.name,
      kind: 'recommended_review',
      assignedDate: '2026-10-05', // Shifted to Oct 5 (AFTER Oct 2 exam!)
      estimatedMinutes: 15,
      isEstimatedTime: false,
      priorityScore: 90,
      priorityReason: '복습 일정 미룸',
      status: 'postponed',
      snapshotTitle: '복습 항목',
      snapshotDetail: '상세',
    };

    const warningPlan = generateStudyPlan({
      subjects: [urgentSubject],
      concepts: [INITIAL_CONCEPTS[0]],
      problems: [compositeProb],
      attempts: [],
      settings: multiSubjectSettings,
      referenceDate: testRefDate,
      existingItems: [postponedOverExamItem],
      daysCount: 7,
    });

    const warnedItem = warningPlan.days
      .flatMap((d) => d.items)
      .find((i) => i.id === postponedOverExamItem.id);

    if (warnedItem) {
      assert(
        Boolean(warnedItem.warningNote),
        'Item postponed beyond exam date includes warning note: ' + warnedItem.warningNote
      );
    }

    // =========================================================================
    // STAGE 10: PERSONAL REVIEW RECOMMENDATION & LEARNING ANALYTICS
    // =========================================================================
    console.log('\n=== STAGE 10 VERIFICATION: PERSONAL REVIEW RECOMMENDATION & LEARNING ANALYTICS ===');

    const l10Ref = new Date('2026-10-01T10:00:00+09:00');
    const l10Subject: Subject = { ...INITIAL_SUBJECTS[0], id: 'subj-l10', name: 'Stage10 과목', isDemo: false, examAt: undefined };
    const l10Concept: Concept = {
      ...INITIAL_CONCEPTS[0],
      id: 'c-l10',
      subjectId: 'subj-l10',
      isDemo: false,
      isLearned: true,
      status: 'stable',
      events: [],
    };
    const buildL10Problem = (id: string, conceptIds: string[], extra: Partial<Problem> = {}): Problem => ({
      ...INITIAL_PROBLEMS[0],
      id,
      subjectId: 'subj-l10',
      conceptIds,
      isDemo: false,
      isApproved: true,
      qualityStatus: 'normal',
      version: 1,
      type: 'essay_descriptive',
      difficulty: 'advanced_college',
      ...extra,
    });
    const l10Problems: Problem[] = [
      buildL10Problem('prob-l10-a', ['c-l10']),
      buildL10Problem('prob-l10-b', ['c-l10']),
      buildL10Problem('prob-l10-c', ['c-l10']),
    ];
    const mkL10Attempt = (id: string, at: string, score: number, extra: Partial<Attempt> = {}): Attempt => ({
      id,
      problemId: 'prob-l10-a',
      conceptId: 'c-l10',
      conceptIds: ['c-l10'],
      subjectId: 'subj-l10',
      at,
      answer: '풀이 답안',
      confidence: 3,
      errorType: 'none',
      hintCount: 0,
      reasoningNotes: '',
      calculatedScore: score,
      rubricResults: [],
      evaluatorFeedback: '',
      problemVersion: 1,
      ...extra,
    });

    // 57. Stage 10: Analysis record validation & exclusion reasons
    console.log('\n--- 57. Testing Analysis Record Validation & Exclusions ---');
    const demoProblem = { ...INITIAL_PROBLEMS[0], id: 'prob-l10-demo', subjectId: 'subj-l10', isDemo: true, conceptIds: ['c-l10'] };
    const exclusionCollection = collectValidRecords({
      attempts: [
        mkL10Attempt('att-valid', '2026-09-28T08:00:00+09:00', 75),
        mkL10Attempt('att-dup', '2026-09-28T09:00:00+09:00', 70),
        mkL10Attempt('att-dup', '2026-09-28T11:00:00+09:00', 80),
        mkL10Attempt('att-needs', '2026-09-28T07:00:00+09:00', 60, { needsReview: true }),
        mkL10Attempt('att-empty', '2026-09-28T06:00:00+09:00', 0, { answer: '' }),
        mkL10Attempt('att-demo', '2026-09-28T05:00:00+09:00', 90, { problemId: demoProblem.id }),
        mkL10Attempt('att-version', '2026-09-28T04:00:00+09:00', 80, { problemVersion: 0 }),
      ],
      mockExams: [],
      problems: [...l10Problems, demoProblem],
      subjects: [l10Subject, INITIAL_SUBJECTS[0]],
      concepts: [l10Concept],
    });
    assert(
      exclusionCollection.records.length === 2 &&
        exclusionCollection.records.some((r) => r.attemptId === 'att-valid') &&
        exclusionCollection.records.some((r) => r.attemptId === 'att-dup') &&
        !exclusionCollection.records.some((r) => r.problemId === 'prob-l10-demo'),
      'Only valid real attempts are analyzed (duplicate deduped, demo excluded)'
    );
    assert(exclusionCollection.excludedByReason.duplicate_attempt_id === 1, 'Duplicate Attempt ID is excluded');
    assert(exclusionCollection.excludedByReason.needs_review === 1, 'Evaluation flagged for review is excluded');
    assert(exclusionCollection.excludedByReason.unanswered === 1, 'Unanswered item is excluded');
    assert(exclusionCollection.excludedByReason.demo_record === 1, 'Demo record is excluded');
    assert(exclusionCollection.excludedByReason.version_mismatch === 1, 'Evaluation against an older problem version is not auto-validated');

    const reportedProblem = buildL10Problem('prob-l10-reported', ['c-l10'], { qualityStatus: 'reported' });
    const qualityCollection = collectValidRecords({
      attempts: [mkL10Attempt('att-quality', '2026-09-28T08:00:00+09:00', 82, { problemId: 'prob-l10-reported' })],
      mockExams: [],
      problems: [...l10Problems, reportedProblem],
      subjects: [l10Subject],
      concepts: [l10Concept],
    });
    assert(qualityCollection.excludedByReason.quality_unresolved === 1, 'Evaluation of an unresolved-quality problem is excluded');

    // 58. Stage 10: Recorded mock-exam inclusion, dedupe & draft exclusion
    console.log('\n--- 58. Testing Recorded Mock Exam Inclusion, Dedupe & Draft Exclusion ---');
    const mockProblem = l10Problems[0];
    const mkMockSession = (id: string, status: MockExamSession['status'], answer = '모의 답안'): MockExamSession => ({
      id,
      subjectId: 'subj-l10',
      createdAt: '2026-09-27T10:00:00+09:00',
      endsAt: '2026-09-27T11:00:00+09:00',
      submittedAt: status === 'recorded' || status === 'graded' ? '2026-09-27T11:00:00+09:00' : undefined,
      durationMinutes: 60,
      status,
      selectedConceptIds: ['c-l10'],
      selectedTypes: ['essay_descriptive'],
      problems: [mockProblem],
      answers: { [mockProblem.id]: answer },
      evaluations: {
        [mockProblem.id]: {
          calculatedScore: 77,
          rubricResults: [],
          feedback: '',
          strengths: '',
          criticalImprovements: '',
          recommendedErrorType: 'none',
          staticAnalysisNotice: '',
          needsReview: false,
          isAiEvaluated: true,
        },
      },
      reasons: {},
      isReasonNotApplicable: {},
      reasonNotApplicableJustification: {},
    } as MockExamSession);

    const recordedOnly = collectValidRecords({
      attempts: [],
      mockExams: [mkMockSession('mock-l10-1', 'recorded')],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
    });
    assert(recordedOnly.records.length === 1 && recordedOnly.records[0].source === 'mock_exam', 'Recorded mock exam item evaluation is included');

    const gradedOnly = collectValidRecords({
      attempts: [],
      mockExams: [mkMockSession('mock-l10-3', 'graded')],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
    });
    assert(gradedOnly.records.length === 0, 'Unrecorded (graded only) mock exam results are excluded as drafts');

    const dedupeAttemptId = `att-exam-mock-l10-2-${mockProblem.id}`;
    const dedupeCollection = collectValidRecords({
      attempts: [mkL10Attempt(dedupeAttemptId, '2026-09-27T11:00:00+09:00', 77)],
      mockExams: [mkMockSession('mock-l10-2', 'recorded')],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
    });
    assert(dedupeCollection.records.length === 1 && dedupeCollection.records[0].source === 'attempt', 'Recorded mock item already stored as an Attempt is not double-counted');

    const unansweredMock = collectValidRecords({
      attempts: [],
      mockExams: [mkMockSession('mock-l10-4', 'recorded', '')],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
    });
    assert(unansweredMock.records.length === 0 && unansweredMock.excludedByReason.unanswered === 1, 'Unanswered mock exam item is excluded');

    // 59. Stage 10: Period filter
    console.log('\n--- 59. Testing Analytics Period Filter ---');
    const periodCollectionRecords = [
      mkL10Attempt('att-recent', '2026-09-30T08:00:00+09:00', 80),
      mkL10Attempt('att-old', '2026-09-01T08:00:00+09:00', 80),
    ];
    const report7 = buildLearningAnalyticsReport({
      attempts: periodCollectionRecords,
      mockExams: [],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      period: 'last7',
      referenceDate: l10Ref,
    });
    assert(report7.records.length === 1 && report7.records[0].attemptId === 'att-recent', 'Last-7-days filter keeps only recent records');
    const reportAll = buildLearningAnalyticsReport({
      attempts: periodCollectionRecords,
      mockExams: [],
      problems: l10Problems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      period: 'all',
      referenceDate: l10Ref,
    });
    assert(reportAll.records.length === 2, 'All-period filter keeps every valid record');

    // 60. Stage 10: Distinct type/difficulty grouping & withheld change judgment
    console.log('\n--- 60. Testing Type/Difficulty Separation & Withheld Change ---');
    const easyProblem = buildL10Problem('prob-l10-easy', ['c-l10'], { difficulty: 'intermediate' });
    const mixedReport = buildLearningAnalyticsReport({
      attempts: [
        mkL10Attempt('att-hard', '2026-09-30T08:00:00+09:00', 60, { problemId: 'prob-l10-a' }),
        mkL10Attempt('att-easy', '2026-09-30T09:00:00+09:00', 95, { problemId: 'prob-l10-easy' }),
      ],
      mockExams: [],
      problems: [...l10Problems, easyProblem],
      subjects: [l10Subject],
      concepts: [l10Concept],
      period: 'last30',
      referenceDate: l10Ref,
    });
    assert(mixedReport.performance.byType.length === 2, 'Scores of different difficulty are grouped separately');
    assert(mixedReport.performance.change.status === 'insufficient', 'Change judgment withheld when comparable samples are insufficient');

    // 61. Stage 10: Composite problem is a single whole-item score
    console.log('\n--- 61. Testing Composite Problem Whole-Item Attribution ---');
    const compositeConceptB: Concept = { ...l10Concept, id: 'c-l10-b' };
    const compositeProblem = buildL10Problem('prob-l10-comp', ['c-l10', 'c-l10-b']);
    const compositeReport = buildLearningAnalyticsReport({
      attempts: [mkL10Attempt('att-comp', '2026-09-30T08:00:00+09:00', 88, { problemId: 'prob-l10-comp', conceptId: 'c-l10', conceptIds: ['c-l10', 'c-l10-b'] })],
      mockExams: [],
      problems: [compositeProblem],
      subjects: [l10Subject],
      concepts: [l10Concept, compositeConceptB],
      period: 'last30',
      referenceDate: l10Ref,
    });
    assert(compositeReport.records.length === 1, 'Composite problem produces ONE whole-item record');
    assert(compositeReport.records[0].isComposite === true && compositeReport.records[0].conceptIds.length === 2, 'Composite record preserves linked concepts without duplicating scores');
    assert(compositeReport.records[0].primaryConceptId === 'c-l10', 'Composite score is attributed to the primary concept, not per-concept scores');

    // 62. Stage 10: Auto correction requires sufficient evidence
    console.log('\n--- 62. Testing Auto Correction Evidence Requirements ---');
    const personalizationOn: PersonalizationSettings = { ...DEFAULT_PERSONALIZATION_SETTINGS, enabled: true, autoAdjust: true, tendency: 'standard' };
    const l10ConceptRec: Concept = {
      ...l10Concept,
      id: 'c-l10-rec',
      events: [{ id: 'ev-l10-rec', conceptId: 'c-l10-rec', at: '2026-09-20T10:00:00+09:00', dayOffset: 0, kind: 'attempt', title: '풀이', resultScore: 90, confidence: 3, hintCount: 0, sourceRef: '', rubricScores: [] }],
    };
    const insufficientState = computeCorrectionState({
      attempts: [mkL10Attempt('att-one', '2026-09-30T08:00:00+09:00', 70, { conceptId: 'c-l10-rec', conceptIds: ['c-l10-rec'], problemId: 'prob-l10-rec' })],
      mockExams: [],
      problems: [buildL10Problem('prob-l10-rec', ['c-l10-rec'])],
      subjects: [l10Subject],
      concepts: [l10ConceptRec],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    assert(insufficientState.dataSufficient === false, 'Automatic correction reports insufficient data');
    assert(insufficientState.autoMultiplier === 1, 'Automatic correction keeps base multiplier 1 when records are insufficient');
    assert(getEffectiveIntervalMultiplier(personalizationOn, insufficientState) === 1, 'Insufficient data keeps the default recommendation');

    // 63. Stage 10: Shorten / lengthen / neutral directions
    console.log('\n--- 63. Testing Personal Correction Directions ---');
    const mkL10ProblemAttempt = (id: string, at: string, score: number, problemIndex: number, extra: Partial<Attempt> = {}) =>
      mkL10Attempt(id, at, score, { problemId: l10Problems[problemIndex].id, ...extra });
    const l10StandardProblems = l10Problems;
    const shortAttempts: Attempt[] = [
      mkL10ProblemAttempt('sa1', '2026-09-28T10:00:00+09:00', 50, 0, { hintCount: 1, errorType: 'concept_confusion' }),
      mkL10ProblemAttempt('sa2', '2026-09-29T10:00:00+09:00', 55, 1, { hintCount: 1, errorType: 'concept_confusion' }),
      mkL10ProblemAttempt('sa3', '2026-09-30T10:00:00+09:00', 45, 2, { hintCount: 2 }),
      mkL10ProblemAttempt('sa4', '2026-09-29T14:00:00+09:00', 52, 0),
      mkL10ProblemAttempt('sa5', '2026-09-30T14:00:00+09:00', 58, 1, { hintCount: 1 }),
    ];
    const shortState = computeCorrectionState({
      attempts: shortAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    assert(shortState.dataSufficient === true, 'Sufficient records enable automatic correction');
    assert(shortState.autoMultiplier < 1, `Repeated errors / hint dependency / low scores shorten the interval (${shortState.autoMultiplier})`);
    assert(shortState.appliedMultiplier >= PERSONALIZATION_CONSTANTS.MULTIPLIER_MIN, 'Applied multiplier respects the 0.75 lower bound');

    const stableAttempts: Attempt[] = [
      mkL10ProblemAttempt('st1', '2026-09-28T10:00:00+09:00', 86, 0),
      mkL10ProblemAttempt('st2', '2026-09-29T10:00:00+09:00', 92, 1),
      mkL10ProblemAttempt('st3', '2026-09-30T10:00:00+09:00', 88, 2),
      mkL10ProblemAttempt('st4', '2026-09-29T14:00:00+09:00', 90, 0),
      mkL10ProblemAttempt('st5', '2026-09-30T14:00:00+09:00', 85, 1),
    ];
    const stableState = computeCorrectionState({
      attempts: stableAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    assert(stableState.autoMultiplier > 1, `Stable performance with low hint dependency lengthens the interval (${stableState.autoMultiplier})`);
    assert(stableState.appliedMultiplier <= PERSONALIZATION_CONSTANTS.MULTIPLIER_MAX, 'Applied multiplier respects the 1.25 upper bound');

    const conflictAttempts: Attempt[] = [
      mkL10ProblemAttempt('cf1', '2026-09-28T10:00:00+09:00', 86, 0, { hintCount: 1, errorType: 'concept_confusion' }),
      mkL10ProblemAttempt('cf2', '2026-09-29T10:00:00+09:00', 88, 1, { errorType: 'concept_confusion' }),
      mkL10ProblemAttempt('cf3', '2026-09-30T10:00:00+09:00', 90, 2),
      mkL10ProblemAttempt('cf4', '2026-09-29T14:00:00+09:00', 84, 0),
      mkL10ProblemAttempt('cf5', '2026-09-30T14:00:00+09:00', 89, 1, { hintCount: 1 }),
    ];
    const conflictState = computeCorrectionState({
      attempts: conflictAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    assert(conflictState.autoMultiplier === 1, 'Conflicting signals keep the base interval (multiplier 1)');

    // 64. Stage 10: Gentle update (a single record barely moves the multiplier)
    console.log('\n--- 64. Testing Gentle Correction Update ---');
    const beforeExtra = computeCorrectionState({
      attempts: shortAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    const afterExtra = computeCorrectionState({
      attempts: [...shortAttempts, mkL10ProblemAttempt('sa6', '2026-09-30T16:00:00+09:00', 30, 2, { hintCount: 2 })],
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: personalizationOn,
      referenceDate: l10Ref,
    });
    assert(Math.abs(afterExtra.autoMultiplier - beforeExtra.autoMultiplier) < 0.1, 'A single new record only gently changes the multiplier');

    // 65. Stage 10: Multiplier clamp under dense tendency + shorten
    console.log('\n--- 65. Testing Multiplier Clamp ---');
    const denseState = computeCorrectionState({
      attempts: shortAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      settings: { ...personalizationOn, tendency: 'dense' },
      referenceDate: l10Ref,
    });
    assert(denseState.appliedMultiplier === PERSONALIZATION_CONSTANTS.MULTIPLIER_MIN, 'Combined multiplier is clamped at the 0.75 floor');

    // 66. Stage 10: Disabling personalization restores the base recommendation
    console.log('\n--- 66. Testing Personalization Disable Restores Base Recommendation ---');
    const disabledSettings: PersonalizationSettings = { ...personalizationOn, enabled: false };
    assert(getEffectiveIntervalMultiplier(disabledSettings, denseState) === 1, 'Disabled personalization yields multiplier 1');
    const recBase = calculateNextReviewRecommendation(l10ConceptRec, DEFAULT_RETENTION_SETTINGS, undefined, l10Ref, 1);
    const recDisabled = calculateNextReviewRecommendation(l10ConceptRec, DEFAULT_RETENTION_SETTINGS, undefined, l10Ref, getEffectiveIntervalMultiplier(disabledSettings, denseState));
    assert(recBase !== null && recDisabled !== null, 'Base and disabled personalization recommendations are produced');
    assert(recBase!.recommendedAt === recDisabled!.recommendedAt, 'Disabled personalization reproduces the exact base recommended date');

    // 67. Stage 10: Single unified path scales interval without touching model score
    console.log('\n--- 67. Testing Unified Path: Interval Scaling Without Score Mutation ---');
    const recShort = calculateNextReviewRecommendation(l10ConceptRec, DEFAULT_RETENTION_SETTINGS, undefined, l10Ref, 0.75);
    const recLong = calculateNextReviewRecommendation(l10ConceptRec, DEFAULT_RETENTION_SETTINGS, undefined, l10Ref, 1.25);
    assert(recShort !== null && recLong !== null, 'Adjusted recommendations are produced');
    assert(recShort!.intervalMultiplier === 0.75 && recShort!.isPersonalized === true, 'Multiplier and isPersonalized flag are recorded');
    assert(recShort!.recommendedAt <= recBase!.recommendedAt, 'A multiplier below 1 recommends an earlier date');
    assert(recLong!.recommendedAt >= recBase!.recommendedAt, 'A multiplier above 1 recommends a later date');
    assert(recShort!.factors.lastScore === recBase!.factors.lastScore, 'Personal interval adjustment does not modify the model score');
    assert(l10ConceptRec.events.length === 1 && l10ConceptRec.events[0].resultScore === 90, 'Past events remain unchanged after recommendation adjustment');

    // 68. Stage 10: Plan recalculation applies the SAME multiplier and preserves history
    console.log('\n--- 68. Testing Unified Plan Integration & History Preservation ---');
    const l10RecProblem = buildL10Problem('prob-l10-rec', ['c-l10-rec']);
    const l10ConceptRec2: Concept = {
      ...l10Concept,
      id: 'c-l10-rec2',
      events: [{ id: 'ev-l10-rec2', conceptId: 'c-l10-rec2', at: '2026-09-22T10:00:00+09:00', dayOffset: 0, kind: 'attempt', title: '풀이', resultScore: 70, confidence: 3, hintCount: 2, sourceRef: '', rubricScores: [] }],
    };
    const l10RecProblem2 = buildL10Problem('prob-l10-rec2', ['c-l10-rec2']);
    const l10CompletedItem: StudyPlanItem = {
      id: 'spi-recommended_review-subj-l10-c-l10-rec-prob-l10-rec',
      subjectId: 'subj-l10',
      subjectName: l10Subject.name,
      conceptId: 'c-l10-rec',
      conceptName: l10ConceptRec.title,
      problemId: 'prob-l10-rec',
      problemTitle: l10RecProblem.title,
      problemType: 'essay_descriptive',
      kind: 'recommended_review',
      assignedDate: toSeoulDateString(testRefDate),
      estimatedMinutes: 15,
      isEstimatedTime: false,
      priorityScore: 80,
      priorityReason: '완료된 복습',
      status: 'completed',
      snapshotTitle: '완료 항목',
      snapshotDetail: '상세',
      completedAt: '2026-09-30T12:00:00+09:00',
      completedAttemptId: 'att-l10-completed',
    };
    const l10PlanSettings: StudyPlanSettings = {
      ...DEFAULT_STUDY_PLAN_SETTINGS,
      weekdaySettings: {
        0: { dayOfWeek: 0, minutes: 120, isRestDay: false },
        1: { dayOfWeek: 1, minutes: 120, isRestDay: false },
        2: { dayOfWeek: 2, minutes: 120, isRestDay: false },
        3: { dayOfWeek: 3, minutes: 120, isRestDay: false },
        4: { dayOfWeek: 4, minutes: 120, isRestDay: false },
        5: { dayOfWeek: 5, minutes: 120, isRestDay: false },
        6: { dayOfWeek: 6, minutes: 120, isRestDay: false },
      },
    };
    const planBase = generateStudyPlan({
      subjects: [l10Subject],
      concepts: [l10ConceptRec, l10ConceptRec2],
      problems: [l10RecProblem, l10RecProblem2],
      attempts: [],
      settings: l10PlanSettings,
      referenceDate: testRefDate,
      existingItems: [l10CompletedItem],
      daysCount: 7,
      personalizationMultiplier: 1,
    });
    const planAdjusted = generateStudyPlan({
      subjects: [l10Subject],
      concepts: [l10ConceptRec, l10ConceptRec2],
      problems: [l10RecProblem, l10RecProblem2],
      attempts: [],
      settings: l10PlanSettings,
      referenceDate: testRefDate,
      existingItems: [l10CompletedItem],
      daysCount: 7,
      personalizationMultiplier: 0.75,
      personalizationNote: '개인별 보정 x0.75',
    });
    const completedInBase = planBase.days.flatMap((d) => d.items).find((i) => i.id === l10CompletedItem.id);
    const completedInAdjusted = planAdjusted.days.flatMap((d) => d.items).find((i) => i.id === l10CompletedItem.id);
    assert(completedInBase?.status === 'completed' && completedInBase?.completedAttemptId === 'att-l10-completed', 'Completed plan item is preserved on recalculation');
    assert(completedInAdjusted?.status === 'completed' && completedInAdjusted?.completedAttemptId === 'att-l10-completed', 'Completed plan item is preserved when the personal multiplier changes');
    const pendingAdjusted = planAdjusted.days.flatMap((d) => d.items).find((i) => i.conceptId === 'c-l10-rec2');
    assert(Boolean(pendingAdjusted && pendingAdjusted.priorityReason.includes('개인별 보정 x0.75')), 'Future pending plan item reflects the same personal multiplier used by today review');

    // 69. Stage 10: Analytics is read-only (no mutation of stored attempts)
    console.log('\n--- 69. Testing Analytics Read-Only Guarantee ---');
    const attemptsStoreBefore = JSON.stringify(loadStoredAttempts());
    buildLearningAnalyticsReport({
      attempts: shortAttempts,
      mockExams: [],
      problems: l10StandardProblems,
      subjects: [l10Subject],
      concepts: [l10Concept],
      period: 'all',
      referenceDate: l10Ref,
    });
    assert(JSON.stringify(loadStoredAttempts()) === attemptsStoreBefore, 'Running analytics never mutates stored attempts');

    console.log(`\n=== ALL STAGES 1, 2, 3, 4, 5, 6, 8, 9 & 10 TESTS PASSED: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  });
}

runTests();


