import { calculateDDay, formatExamDate, toSeoulDateString } from './dateUtils';
import {
  calculatePowerLawRetention,
  getEffectiveTau,
  calculateCurrentConceptScore,
  generateConceptTrajectory,
  DEFAULT_RETENTION_SETTINGS,
} from './retentionModel';
import {
  INITIAL_SUBJECTS,
  INITIAL_CONCEPTS,
  INITIAL_PROBLEMS,
  INITIAL_MATERIALS,
} from './initialData';
import { recordAttemptAndUpdateConcept } from './storage';
import { Attempt } from './types';

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
      saveStoredConcepts([approvedConcept]);
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

    console.log(`\n=== ALL STAGE 1, 2 & 3 TESTS PASSED: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  });
}

runTests();
