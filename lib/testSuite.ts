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

    console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  });
}

runTests();
