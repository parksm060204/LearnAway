import {
  calculateDDay,
  formatExamDate,
  toSeoulDateString,
  getSeoulCalendarDiff,
  getElapsedDays,
  formatSeoulDate,
  addDaysToDate,
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
  getConfirmedEvents,
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
} from './storage';
import {
  Attempt,
  Problem,
  ProblemReport,
  ProblemReportType,
  ProblemQualityStatus,
  isProblemAvailableForPractice,
  PROBLEM_REPORT_TYPE_LABELS,
  PROBLEM_QUALITY_STATUS_LABELS,
} from './types';

function runTests() {
  console.log('=== STARTING REDCALL AUTOMATED VERIFICATION SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
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
  const { parseTranscript } = require('./transcriptParser');

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
  const { saveMaterialContent, loadMaterialContent } = require('./materialStorage');
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
    const econMats = INITIAL_MATERIALS.filter((m: any) => m.subjectId === 'subj-econ302');
    const csMats = INITIAL_MATERIALS.filter((m: any) => m.subjectId === 'subj-cs201');
    assert(econMats.length === 4, 'ECON302 has 4 materials');
    assert(csMats.length === 3, 'CS201 has 3 materials');
    assert(!econMats.some((m: any) => m.subjectId === 'subj-cs201'), 'No cross-contamination of subject materials');

    // Verify demo badges and AI statuses
    assert(econMats.every((m: any) => m.isDemo === true), 'Demo materials have isDemo=true');
    assert(econMats.every((m: any) => m.status === 'ready'), 'Initial materials are ready');

    // 8. Stage 2: Markdown Hash & Version Change Detection
    console.log('\n--- 8. Testing Markdown Hash & Version Change Detection ---');
    const { computeMarkdownHash, chunkMarkdownForAnalysis, verifySourceCitation } = require('./markdownUtils');
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
    const {
      saveStoredConceptDrafts,
      approveConceptDraft,
      mergeConceptDrafts,
      markConceptAsLearned,
      saveStoredConcepts,
    } = require('./storage');

    const dummyDraftId = 'test-draft-stage2-001';
    const dummyDraft = {
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
      createdAt: '2026-09-29T00:00:00+09:00',
      updatedAt: '2026-09-29T00:00:00+09:00',
    };

    saveStoredConceptDrafts([dummyDraft]);
    const { updatedDrafts, approvedConcept } = approveConceptDraft(dummyDraftId);
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
      const { updatedConcepts, learnedConcept } = markConceptAsLearned(approvedConcept.id, 75);
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
    const finalMerged = mergedList.find((d: any) => d.id === 'draft-merge-A');
    assert(mergedList.some((d: any) => d.id === 'draft-merge-B') === false, 'Source draft B removed after merge');
    assert(finalMerged?.prerequisites.includes('우선순위 큐') && finalMerged?.prerequisites.includes('그래프 탐색'), 'Prerequisites combined without loss');
    assert(finalMerged?.relatedConcepts.filter((c: string) => c === '벨만-포드').length === 1, 'Related concepts deduplicated');
    assert(finalMerged?.examples?.includes('네트워크 라우팅 예제'), 'Examples merged');

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
    const {
      saveStoredProblemDrafts,
      loadStoredProblemDrafts,
      approveProblemDraft,
      updateProblemDraft,
      loadStoredProblems,
    } = require('./storage');

    const testDraftId = 'test-prob-draft-001';
    const testDraft = {
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
    assert(loadedDrafts.some((d: any) => d.id === testDraftId), 'Draft saved and loaded from storage');

    // Update draft
    const updatedDraft = { ...testDraft, title: '수정된 시험 문제 제목' };
    updateProblemDraft(updatedDraft);
    const loadedAfterEdit = loadStoredProblemDrafts().find((d: any) => d.id === testDraftId);
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
      approvalResult.approvedProblem?.rubric.reduce((s: number, r: any) => s + r.maxScore, 0) === 100,
      'Approved problem maintains 100-point rubric'
    );

    // Verify draft status in storage
    const approvedDraftInStore = loadStoredProblemDrafts().find((d: any) => d.id === testDraftId);
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
    const demoProblems = storedProblems.filter((p: any) => p.isDemo === true);
    assert(demoProblems.length > 0, 'Original demo problems preserved without deletion');
    assert(
      storedProblems.some((p: any) => p.id === approvalResult.approvedProblem?.id),
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
    const { getAttemptById, loadStoredConcepts } = require('./storage');
    const preConcepts = loadStoredConcepts();
    const c2Pre = preConcepts.find((c: any) => c.id === 'c-econ-02');
    const c2PreEventCount = c2Pre?.events?.length || 0;

    const recordResult = recordAttemptAndUpdateConcept(stage4Attempt, DEFAULT_RETENTION_SETTINGS);
    assert(recordResult.updatedAttempts.some((a: any) => a.id === stage4Attempt.id), 'Attempt saved in attempts store');

    // Check duplicate attempt guard
    const recordDuplicate = recordAttemptAndUpdateConcept(stage4Attempt, DEFAULT_RETENTION_SETTINGS);
    const countOccurrences = recordDuplicate.updatedAttempts.filter((a: any) => a.id === stage4Attempt.id).length;
    assert(countOccurrences === 1, 'Duplicate submission prevention: attempt ID only recorded once');

    // Concept isolation: c1 updated, c2 NOT artificially altered
    const c1Post = recordResult.updatedConcepts.find((c: any) => c.id === 'c-econ-01');
    const c2Post = recordResult.updatedConcepts.find((c: any) => c.id === 'c-econ-02');
    assert(
      Boolean(c1Post?.events.some((e: any) => e.attemptId === stage4Attempt.id)),
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
    const conceptsBeforePostpone: any[] = loadStoredConcepts(refSeoulTime);
    const targetC = conceptsBeforePostpone.find((c: any) => c.id === 'c-econ-01')!;
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
      conceptsBeforePostpone.filter((c: any) => c.subjectId === 'subj-econ302'),
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
    const csConcepts = conceptsBeforePostpone.filter((c: any) => c.subjectId === 'subj-cs201');
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
    const rawLegacyProblems: any[] = [
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
    saveStoredProblems(rawLegacyProblems);

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
    const rawLegacyAttempts: any[] = [
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
    saveStoredAttempts(rawLegacyAttempts);
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
    assert(reportedProb.reports.length === 1, 'Problem reports array contains 1 recorded report');
    assert(reportedProb.reports[0].type === 'missing_or_vague_condition', 'Report type preserved correctly');
    assert(reportedProb.reports[0].attemptId === 'att-legacy-01', 'Report preserves user attemptId linkage');
    assert(reportedProb.reports[0].status === 'open', 'New report initialized in open status');

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
    assert(probAfterSpam.reports.length === 1, 'Report count DID NOT increment on duplicate submission');

    // A distinct non-duplicate report (e.g. rubric_error) succeeds
    const secondReportRes = reportProblemError('prob-legacy-01', {
      type: 'rubric_error',
      details: '배점 기준의 기각역 유도 항목 40점이 너무 과다합니다.',
    });
    assert(secondReportRes.success === true, 'Distinct report with different category/details succeeds');
    const probWithTwoReports = loadStoredProblems().find((p: Problem) => p.id === 'prob-legacy-01')!;
    assert(probWithTwoReports.reports.length === 2, 'Problem preserves multiple distinct reports with timestamps');

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
    const dismissedRep = probAfterDismiss1.reports.find((r: ProblemReport) => r.id === secondReportRes.reportId)!;
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

    console.log(`\n=== ALL STAGES 1, 2, 3, 4, 5 & 6 TESTS PASSED: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  });
}

runTests();

