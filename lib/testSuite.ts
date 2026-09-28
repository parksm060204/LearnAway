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

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
