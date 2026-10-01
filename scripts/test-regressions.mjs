/* Compile and exercise real storage, selection, deadline and API paths without paid AI calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redcall-regressions-'));
const compile = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
  'lib/storage.ts', 'lib/mockExam.ts', 'lib/evaluationValidation.ts', 'lib/materialStorage.ts',
  'lib/problemSources.ts', 'lib/problemFreshness.ts', 'lib/studyPlan.ts',
  'lib/personalization.ts', 'lib/logicSession.ts', 'lib/logicValidation.ts', 'lib/learningAnalytics.ts',
  'app/api/evaluate-answer/route.ts', 'app/api/logic-questions/route.ts',
  '--outDir', output, '--module', 'commonjs', '--target', 'ES2020', '--moduleResolution', 'node',
  '--esModuleInterop', '--skipLibCheck', '--strict'], { cwd: root, encoding: 'utf8' });

async function run() {
  if (compile.status !== 0) throw new Error(compile.stdout + compile.stderr);
  // Windows cannot create directory symlinks without elevation; a junction works unprivileged.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');
  const data = new Map();
  global.window = { localStorage: {} };
  global.localStorage = { getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  window.localStorage = localStorage;
  const storage = load(path.join(output, 'lib/storage.js'));
  const exams = load(path.join(output, 'lib/mockExam.js'));
  const validation = load(path.join(output, 'lib/evaluationValidation.js'));
  const matStorage = load(path.join(output, 'lib/materialStorage.js'));
  const problemSources = load(path.join(output, 'lib/problemSources.js'));
  const problemFreshness = load(path.join(output, 'lib/problemFreshness.js'));
  const studyPlan = load(path.join(output, 'lib/studyPlan.js'));
  const logicSession = load(path.join(output, 'lib/logicSession.js'));
  const logicValidation = load(path.join(output, 'lib/logicValidation.js'));
  const learningAnalytics = load(path.join(output, 'lib/learningAnalytics.js'));
  const markdownUtils = load(path.join(output, 'lib/markdownUtils.js'));
  const personalization = load(path.join(output, 'lib/personalization.js'));
  const types = load(path.join(output, 'lib/types.js'));
  const { INITIAL_SUBJECTS, INITIAL_CONCEPTS, INITIAL_PROBLEMS } = load(path.join(output, 'lib/initialData.js'));
  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
  const concept = structuredClone(INITIAL_CONCEPTS[0]);
  const subject = INITIAL_SUBJECTS.find((s) => s.id === concept.subjectId);
  storage.saveStoredConcepts([concept]);
  storage.saveStoredAttempts([]);
  const attempt = { id: 'regression-attempt', problemId: 'p', conceptId: concept.id,
    subjectId: concept.subjectId, at: new Date().toISOString(), answer: 'answer', confidence: 3,
    errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 80,
    rubricResults: [], evaluatorFeedback: '' };
  storage.recordAttemptAndUpdateConcept(attempt);
  const first = storage.loadStoredConcepts()[0];
  storage.recordAttemptAndUpdateConcept(attempt);
  const second = storage.loadStoredConcepts()[0];
  check('retry saves one Attempt and one review event', () => {
    assert.equal(storage.loadStoredAttempts().length, 1);
    assert.equal(second.events.length, first.events.length);
    assert.equal(second.exerciseCount, first.exerciseCount);
  });
  check('another subject cannot save an inconsistent attempt or mutate the concept', () => {
    assert.throws(() => storage.recordAttemptAndUpdateConcept({ ...attempt, id: 'wrong-subject', subjectId: 'other' }));
    assert.equal(storage.loadStoredConcepts()[0].events.length, second.events.length);
    assert.equal(storage.loadStoredAttempts().length, 1);
  });
  const other = { ...structuredClone(concept), id: 'second-concept' };
  const base = { ...structuredClone(INITIAL_PROBLEMS[0]), subjectId: subject.id, isApproved: true,
    qualityStatus: 'normal', isOutdated: false, type: 'essay_descriptive' };
  const problems = [
    { ...base, id: 'valid', conceptIds: [concept.id] },
    { ...base, id: 'mixed', conceptIds: [concept.id, other.id] },
    { ...base, id: 'reported', conceptIds: [concept.id], qualityStatus: 'reported' },
    { ...base, id: 'unapproved', conceptIds: [concept.id], isApproved: false },
    { ...base, id: 'outdated', conceptIds: [concept.id], isOutdated: true },
    { ...base, id: 'foreign', conceptIds: [concept.id], subjectId: 'other' },
  ];
  check('selection excludes out-of-scope, quarantined and outdated problems', () => {
    assert.deepEqual(exams.selectMockExamProblems(subject, [concept, other], problems,
      [concept.id], ['essay_descriptive'], 10).map((p) => p.id), ['valid']);
  });
  check('unknown concept IDs cannot expand exam scope', () => {
    assert.deepEqual(exams.selectMockExamProblems(subject, [concept], problems,
      [other.id], ['essay_descriptive'], 10), []);
  });
  const deadline = Date.parse('2026-09-30T06:00:00Z');
  const session = { id: 'exam', subjectId: subject.id, createdAt: new Date(deadline - 60000).toISOString(),
    endsAt: new Date(deadline).toISOString(), durationMinutes: 1, status: 'in_progress',
    selectedConceptIds: [concept.id], selectedTypes: ['essay_descriptive'], problems: [problems[0]],
    answers: { valid: 'original' }, evaluations: {} };
  check('reopened expired exam is submitted at its deadline', () => {
    const expired = exams.expireMockExam(session, deadline + 5000);
    assert.equal(expired.status, 'submitted');
    assert.equal(expired.submittedAt, session.endsAt);
  });
  check('an edit after deadline cannot change the answer', () => {
    const expired = exams.updateMockExamAnswer(session, 'valid', 'late edit', deadline);
    assert.equal(expired.answers.valid, 'original');
    assert.equal(expired.status, 'submitted');
    assert.equal(exams.updateMockExamAnswer(session, 'valid', 'on time', deadline - 1).answers.valid, 'on time');
  });
  const rubric = [{ id: 'logic', label: '논리', maxScore: 100, weight: 1, description: '논리' }];
  const result = { rubricResults: [{ criterionId: 'logic', score: 80.5, evidenceQuote: 'answer' }], needsReview: false };
  check('invalid rubric totals and duplicate IDs are rejected', () => {
    assert.throws(() => validation.validateEvaluationRubric([{ ...rubric[0], maxScore: 50 }]));
    assert.throws(() => validation.validateEvaluationRubric([{ ...rubric[0], maxScore: 50 }, { ...rubric[0], maxScore: 50 }]));
  });
  check('missing evaluation is rejected instead of fabricated zero', () => {
    assert.throws(() => validation.validateEvaluationOutput({}, rubric));
    assert.throws(() => validation.validateEvaluationOutput({ rubricResults: [] }, rubric));
    assert.throws(() => validation.validateEvaluationOutput({ rubricResults: [{ criterionId: 'logic', score: null }] }, rubric));
    assert.throws(() => validation.validateEvaluationOutput({ rubricResults: [{ criterionId: 'logic', score: 101 }] }, rubric));
  });
  check('score sum preserves partial points and missing evidence requires review', () => {
    assert.equal(validation.validateEvaluationOutput(result, rubric).calculatedScore, 80.5);
    assert.equal(validation.validateEvaluationOutput({ ...result, rubricResults: [{ criterionId: 'logic', score: 0 }] }, rubric).needsReview, true);
  });

  const { AI_CONFIG } = load(path.join(output, 'lib/aiConfig.js'));
  AI_CONFIG.apiKey = 'test-only-not-a-real-key';
  const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
  const { POST } = load(path.join(output, 'app/api/evaluate-answer/route.js'));
  const body = { ...attempt, domain: 'math_stats', problemTitle: 'Test', problemPrompt: 'Test question',
    userAnswer: 'answer', modelAnswer: 'model', rubric, revealedHintCount: 0 };
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ choices: [{ message: { content: '{}' } }] }); };
  const request = (value) => new NextRequest('http://localhost/api/evaluate-answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const malformed = await POST(request({ ...body, userAnswer: 42 }));
  check('malformed answer returns 400 before AI call', () => { assert.equal(malformed.status, 400); assert.equal(calls, 0); });
  const invalidRubric = await POST(request({ ...body, rubric: [{ ...rubric[0], maxScore: 50 }] }));
  check('invalid rubric returns 400 before AI call', () => { assert.equal(invalidRubric.status, 400); assert.equal(calls, 0); });
  const incomplete = await POST(request(body));
  check('incomplete AI JSON returns 502', () => assert.equal(incomplete.status, 502));
  global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  const valid = await POST(request(body));
  const response = await valid.json();
  check('valid API evaluation returns actual rubric sum', () => {
    assert.equal(valid.status, 200); assert.equal(response.evaluation.calculatedScore, 80.5);
  });

  // ---- Stage 11: material storage reliability ----
  const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

  await checkAsync('material save reports memory-only persistence honestly', async () => {
    const saved = await matStorage.saveMaterialContent('mat-x', { markdown: '# hello' });
    assert.equal(saved.persisted, false);
    assert.equal(saved.storage, 'memory');
    assert.equal(matStorage.getCachedMaterialContent('mat-x').markdown, '# hello');
  });

  await checkAsync('material load distinguishes found/missing and delete clears cache', async () => {
    assert.equal((await matStorage.loadMaterialContentResult('mat-x')).status, 'found');
    await matStorage.deleteMaterialContent('mat-x');
    assert.equal(matStorage.getCachedMaterialContent('mat-x'), null);
    assert.equal((await matStorage.loadMaterialContentResult('mat-x')).status, 'missing');
  });

  await checkAsync('full reset clears every material body from the memory store', async () => {
    await matStorage.saveMaterialContent('mat-y', { markdown: '# y' });
    await matStorage.clearAllMaterialContent();
    assert.equal(matStorage.getCachedMaterialContent('mat-y'), null);
  });

  // ---- Stage 11: problem source collection ----
  const sourceConceptA = { id: 'src-a', subjectId: subject.id, materialIds: ['mat-a'] };
  const sourceConceptForeign = { id: 'src-f', subjectId: 'other-subject', materialIds: ['mat-f'] };
  const sourceMaterials = [
    { id: 'mat-a', subjectId: subject.id, title: '자료 A', sourceRefs: 'p.1', parsedMarkdown: '# A' },
    { id: 'mat-f', subjectId: 'other-subject', title: '자료 F', sourceRefs: 'p.9', parsedMarkdown: '# F' },
  ];

  await checkAsync('only the selected concept materials from the same subject are sent', async () => {
    const collected = await problemSources.collectProblemSources({
      concepts: [sourceConceptA, sourceConceptForeign],
      materials: sourceMaterials,
      subjectId: subject.id,
    });
    assert.equal(collected.ok, true);
    assert.deepEqual(collected.sources.map((s) => s.materialId), ['mat-a']);
    assert.equal(collected.sources[0].contentHash, markdownUtils.computeMarkdownHash('# A'));
  });

  await checkAsync('unreadable or empty material bodies block generation with a reason', async () => {
    const empty = await problemSources.collectProblemSources({
      concepts: [{ id: 'src-e', subjectId: subject.id, materialIds: ['mat-empty'] }],
      materials: [{ id: 'mat-empty', subjectId: subject.id, title: '빈 자료', sourceRefs: 'p.1', parsedMarkdown: '' }],
      subjectId: subject.id,
    });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /본문 없음|본문을 확인할 수 없어/);

    const failed = await problemSources.collectProblemSources({
      concepts: [{ id: 'src-a', subjectId: subject.id, materialIds: ['mat-a'] }],
      materials: sourceMaterials,
      subjectId: subject.id,
      loadContent: async () => ({ status: 'error', error: 'storage down' }),
    });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /읽기 오류/);
  });

  // ---- Stage 11: per-material outdated marking ----
  const freshnessConcept = { id: 'fresh-c', subjectId: subject.id, materialIds: ['mat-a'] };
  const freshnessBase = {
    ...structuredClone(INITIAL_PROBLEMS[0]),
    subjectId: subject.id,
    conceptIds: [freshnessConcept.id],
    isApproved: true,
    qualityStatus: 'normal',
    isOutdated: false,
    rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'r' }],
  };
  const problemOnA = { ...freshnessBase, id: 'prob-on-a', sourceMaterials: [{ materialId: 'mat-a', title: '자료 A', markdownHash: markdownUtils.computeMarkdownHash('# A') }] };
  const problemOnF = { ...freshnessBase, id: 'prob-on-f', sourceMaterials: [{ materialId: 'mat-f', title: '자료 F', markdownHash: markdownUtils.computeMarkdownHash('# F') }] };
  const legacyProblem = { ...freshnessBase, id: 'prob-legacy', sourceMarkdownHash: markdownUtils.computeMarkdownHash('# old') };

  check('editing one material only marks the problems that referenced it', () => {
    const edited = { ...sourceMaterials[0], parsedMarkdown: '# A v2' };
    const applied = problemFreshness.applyMaterialEditToProblems(
      [problemOnA, problemOnF, legacyProblem],
      edited,
      [freshnessConcept]
    );
    assert.deepEqual(applied.outdatedIds, ['prob-on-a']);
    assert.deepEqual(applied.reviewIds, ['prob-legacy']);
    assert.ok(applied.unchangedIds.includes('prob-on-f'));
    assert.equal(applied.updatedProblems.find((p) => p.id === 'prob-on-f').isOutdated, false);
  });

  check('a stale problem is blocked from practice until re-approval clears it', () => {
    assert.equal(types.isProblemAvailableForPractice({ ...freshnessBase, id: 'stale', isOutdated: true }), false);
    storage.saveStoredProblems([{ ...freshnessBase, id: 'stale', isOutdated: true, qualityStatus: 'review_after_edit' }]);
    const result = storage.reapproveProblem('stale', '검토 후 재승인');
    assert.equal(result.success, true);
    assert.equal(result.updatedProblem.isOutdated, false);
    assert.equal(result.updatedProblem.needsSourceReview, false);
    assert.equal(types.isProblemAvailableForPractice(result.updatedProblem), true);
  });

  // ---- Stage 11: partial attempt save recovery ----
  await checkAsync('a missing review event is recovered on retry without duplication', async () => {
    const recoveryConcept = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([recoveryConcept]);
    storage.saveStoredAttempts([]);
    const recoveryAttempt = {
      id: 'recovery-attempt', problemId: 'p', conceptId: recoveryConcept.id,
      subjectId: recoveryConcept.subjectId, at: new Date().toISOString(), answer: 'answer',
      confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70,
      rubricResults: [], evaluatorFeedback: '',
    };
    // Simulate a partial save: the Attempt persisted but its review event did not.
    storage.saveStoredAttempts([recoveryAttempt]);
    assert.equal(storage.loadStoredConcepts()[0].events.length, 0);

    const { recoveredCount } = storage.recoverMissingAttemptEvents();
    assert.equal(recoveredCount, 1);
    const afterRecovery = storage.loadStoredConcepts()[0];
    assert.equal(afterRecovery.events.filter((e) => e.attemptId === 'recovery-attempt').length, 1);
    assert.equal(storage.loadStoredAttempts().length, 1);
    const exerciseCount = afterRecovery.exerciseCount;

    // A retry must not add a second Attempt, event, or exercise count.
    storage.recordAttemptAndUpdateConcept(recoveryAttempt);
    const afterRetry = storage.loadStoredConcepts()[0];
    assert.equal(afterRetry.events.filter((e) => e.attemptId === 'recovery-attempt').length, 1);
    assert.equal(storage.loadStoredAttempts().length, 1);
    assert.equal(afterRetry.exerciseCount, exerciseCount);
  });

  // ---- Stage 12: review rounds, scheduling constraints, type filter ----
  const planSubject = {
    ...structuredClone(INITIAL_SUBJECTS[0]), id: 'plan-subj', isDemo: false,
    examAt: '2026-10-20T10:00:00+09:00',
  };
  const planRef = new Date('2026-10-01T09:00:00+09:00');
  const planSettings = structuredClone(types.DEFAULT_STUDY_PLAN_SETTINGS);
  planSettings.subjectConfigs = {
    'plan-subj': {
      subjectId: 'plan-subj', selectedConceptIds: ['plan-c1'],
      selectedProblemTypes: ['essay_descriptive'], includeMockExam: false, mockExamTargetMinutes: 45,
    },
  };
  const mkPlanProblem = (id, type, conceptId = 'plan-c1') => ({
    ...structuredClone(INITIAL_PROBLEMS[0]), id, subjectId: 'plan-subj', conceptIds: [conceptId],
    isDemo: false, isApproved: true, qualityStatus: 'normal', isOutdated: false, version: 1, type,
    rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'r' }],
  });
  const oldAttemptConcept = {
    ...structuredClone(INITIAL_CONCEPTS[0]), id: 'plan-c1', subjectId: 'plan-subj', isDemo: false,
    isLearned: true, status: 'stable', exerciseCount: 1,
    events: [{ id: 'ev-old', conceptId: 'plan-c1', at: '2026-09-01T10:00:00+09:00', dayOffset: 0,
      kind: 'attempt', title: 'old', resultScore: 80, confidence: 3, hintCount: 0, sourceRef: '', rubricScores: [] }],
  };
  const recentHighConcept = {
    ...structuredClone(INITIAL_CONCEPTS[0]), id: 'plan-c2', subjectId: 'plan-subj', isDemo: false,
    isLearned: true, status: 'stable', exerciseCount: 1,
    events: [{ id: 'ev-new', conceptId: 'plan-c2', at: '2026-10-01T08:00:00+09:00', dayOffset: 0,
      kind: 'attempt', title: 'recent', resultScore: 95, confidence: 4, hintCount: 0, sourceRef: '', rubricScores: [] }],
  };
  const recentHighProblem = mkPlanProblem('plan-prob2', 'essay_descriptive', 'plan-c2');
  const recentHighSettings = {
    ...planSettings,
    subjectConfigs: {
      'plan-subj': { ...planSettings.subjectConfigs['plan-subj'], selectedConceptIds: ['plan-c2'] },
    },
  };

  check('a past attempt does not complete a new review round', () => {
    const plan = studyPlan.generateStudyPlan({
      subjects: [planSubject], concepts: [oldAttemptConcept],
      problems: [mkPlanProblem('plan-prob', 'essay_descriptive')], attempts: [],
      settings: planSettings, referenceDate: planRef, daysCount: 7,
    });
    const all = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems);
    const pending = all.find((i) => i.conceptId === 'plan-c1' && i.round === 2);
    assert.ok(pending, 'a new review round item exists');
    assert.equal(pending.status, 'pending');
    assert.ok(!all.some((i) => i.status === 'completed' && i.completedAttemptId === 'ev-old'),
      'the old attempt does not complete any round');
  });

  check('a far-future recommendation is not assigned today', () => {
    const plan = studyPlan.generateStudyPlan({
      subjects: [planSubject], concepts: [recentHighConcept], problems: [recentHighProblem],
      attempts: [], settings: recentHighSettings, referenceDate: planRef, daysCount: 7,
    });
    const all = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems);
    const pending = all.find((i) => i.conceptId === 'plan-c2' && i.round === 2);
    assert.ok(pending.earliestDate > '2026-10-01', 'earliest date is in the future');
    for (const item of plan.days.flatMap((d) => d.items)) {
      if (item.earliestDate) assert.ok(item.assignedDate >= item.earliestDate, 'assigned on/after earliest');
    }
  });

  check('work that cannot fit before the exam is counted as shortage', () => {
    const urgentSubject = { ...planSubject, examAt: '2026-10-02T10:00:00+09:00' };
    const plan = studyPlan.generateStudyPlan({
      subjects: [urgentSubject], concepts: [recentHighConcept], problems: [recentHighProblem],
      attempts: [], settings: recentHighSettings, referenceDate: planRef, daysCount: 7,
    });
    assert.ok(plan.totalShortageMinutes > 0, 'shortage is reported');
    const afterExam = plan.days.filter((d) => d.date > '2026-10-02').flatMap((d) => d.items);
    assert.equal(afterExam.length, 0, 'nothing is assigned after the exam');
  });

  check('unselected problem types are filtered, not just sorted', () => {
    const proofOnly = mkPlanProblem('plan-proof', 'proof_counterexample');
    const { eligibleProblems } = studyPlan.getEligibleProblemsForPlan(
      planSubject, oldAttemptConcept, [proofOnly], ['plan-c1'], ['essay_descriptive']
    );
    assert.equal(eligibleProblems.length, 0);
    const plan = studyPlan.generateStudyPlan({
      subjects: [planSubject], concepts: [oldAttemptConcept], problems: [proofOnly],
      attempts: [], settings: planSettings, referenceDate: planRef, daysCount: 7,
    });
    const item = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems)
      .find((i) => i.conceptId === 'plan-c1');
    assert.equal(item.needsProblemGeneration, true);
  });

  await checkAsync('recovery uses the stored Attempt score, not the retry payload', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    const base = {
      id: 'stored-att', problemId: 'p', conceptId: c.id, subjectId: c.subjectId,
      at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none',
      hintCount: 0, reasoningNotes: '', rubricResults: [], evaluatorFeedback: '',
    };
    storage.saveStoredAttempts([{ ...base, calculatedScore: 80 }]);
    // Retry with a different score must not corrupt the recovered event.
    storage.recordAttemptAndUpdateConcept({ ...base, calculatedScore: 10 });
    const ev = storage.loadStoredConcepts()[0].events.find((e) => e.attemptId === 'stored-att');
    assert.equal(ev.resultScore, 80);
  });

  await checkAsync('re-approval records the confirmed source hash', async () => {
    const material = { id: 'm-confirm', subjectId: subject.id, title: '자료', sourceRefs: 'p.1', parsedMarkdown: '# A v2' };
    const problem = {
      ...freshnessBase, id: 'prob-confirm',
      sourceMaterials: [{ materialId: 'm-confirm', title: '자료', markdownHash: 'stale-hash' }],
    };
    storage.saveStoredProblems([problem]);
    const r = storage.reapproveProblem('prob-confirm', '확인 후 재승인', [material]);
    assert.equal(r.success, true);
    assert.equal(r.updatedProblem.sourceMaterials[0].markdownHash, markdownUtils.computeMarkdownHash('# A v2'));
    const applied = problemFreshness.applyMaterialEditToProblems([r.updatedProblem], material, []);
    assert.deepEqual(applied.outdatedIds, [], 're-saving the same source does not re-flag outdated');
  });

  // ---- Stage 12 fixes: plan/completion integrity, mock exam config, personalization ----
  const mkPlanItem = (overrides) => ({
    id: 'spi-x', subjectId: 's', subjectName: '과목', conceptId: 'c', conceptName: '개념',
    problemId: 'p', problemTitle: '문제', problemType: 'essay_descriptive', kind: 'recommended_review',
    assignedDate: '2026-10-01', estimatedMinutes: 15, isEstimatedTime: false, priorityScore: 50,
    priorityReason: 'r', status: 'pending', round: 1, snapshotTitle: 't', snapshotDetail: 'd',
    ...overrides,
  });

  await checkAsync('a shared composite problem does not complete another concept plan', async () => {
    const subjectId = 'shared-subj';
    const c1 = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'shared-c1', subjectId, isDemo: false, isLearned: true, status: 'stable', events: [], exerciseCount: 1 };
    const c2 = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'shared-c2', subjectId, isDemo: false, isLearned: true, status: 'stable', events: [], exerciseCount: 1 };
    storage.saveStoredConcepts([c1, c2]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([
      mkPlanItem({ id: 'shared-c2-item', subjectId, conceptId: c2.id, problemId: 'shared-p', status: 'pending' }),
      mkPlanItem({ id: 'shared-c1-skipped', subjectId, conceptId: c1.id, problemId: 'shared-p', status: 'skipped' }),
    ]);
    const attempt = {
      id: 'shared-att', problemId: 'shared-p', conceptId: c1.id, subjectId,
      at: new Date().toISOString(), answer: 'a', confidence: 3, errorType: 'none', hintCount: 0,
      reasoningNotes: '', calculatedScore: 80, rubricResults: [], evaluatorFeedback: '',
    };
    const res = storage.recordAttemptAndUpdateConcept(attempt);
    const items = storage.loadStoredStudyPlanItems();
    assert.equal(items.find((i) => i.id === 'shared-c2-item').status, 'pending', 'another concept plan stays pending');
    assert.equal(items.find((i) => i.id === 'shared-c1-skipped').status, 'skipped', 'skipped item is not auto-completed');
    assert.equal(res.planLinkage.linkedItemId, null, 'no plan item is linked for the wrong concept');

    // A valid pending item for the attempt's own concept IS completed.
    // C1 already has one recorded round, so this second attempt is round 2.
    storage.saveStoredStudyPlanItems([
      mkPlanItem({ id: 'shared-c1-item', subjectId, conceptId: c1.id, problemId: 'shared-p', status: 'pending', round: 2 }),
    ]);
    const res2 = storage.recordAttemptAndUpdateConcept({ ...attempt, id: 'shared-att-2', conceptId: c1.id });
    assert.equal(storage.loadStoredStudyPlanItems().find((i) => i.id === 'shared-c1-item').status, 'completed', 'the matching concept plan is completed');
    assert.equal(res2.planLinkage.linkedItemId, 'shared-c1-item', 'the correct plan item is linked');
  });

  await checkAsync('plan save failure is surfaced and a retry repairs only the plan link', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'fail-c', subjectId: 'fail-subj', events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([
      mkPlanItem({ id: 'fail-item', subjectId: 'fail-subj', conceptId: c.id, problemId: 'fail-p', status: 'pending' }),
    ]);
    const attempt = {
      id: 'fail-att', problemId: 'fail-p', conceptId: c.id, subjectId: 'fail-subj',
      at: new Date().toISOString(), answer: 'a', confidence: 3, errorType: 'none', hintCount: 0,
      reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '',
    };
    const originalSet = localStorage.setItem;
    const PLAN_KEY = 'redcall_study_plan_items_v1';
    localStorage.setItem = (key, value) => {
      if (key === PLAN_KEY) throw new Error('plan storage down');
      return originalSet(key, value);
    };
    let first;
    try {
      first = storage.recordAttemptAndUpdateConcept(attempt);
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(first.partial, true, 'plan-only failure is reported as partial (not a false success)');
    assert.equal(first.planLinkage.persisted, false, 'plan link did not persist');
    assert.equal(storage.loadStoredAttempts().length, 1, 'Attempt persisted despite the plan failure');
    assert.equal(storage.loadStoredConcepts()[0].events.filter((e) => e.attemptId === 'fail-att').length, 1, 'review event persisted once');
    assert.equal(storage.loadStoredStudyPlanItems()[0].status, 'pending', 'plan link really failed');

    const exerciseCount = storage.loadStoredConcepts()[0].exerciseCount;
    const retry = storage.recordAttemptAndUpdateConcept(attempt);
    assert.equal(retry.partial, false, 'retry reports a complete save');
    assert.equal(retry.planLinkage.persisted, true, 'retry repairs the plan link');
    assert.equal(storage.loadStoredStudyPlanItems().find((i) => i.id === 'fail-item').status, 'completed', 'plan item completed on retry');
    assert.equal(storage.loadStoredAttempts().length, 1, 'retry does not duplicate the Attempt');
    assert.equal(storage.loadStoredConcepts()[0].events.filter((e) => e.attemptId === 'fail-att').length, 1, 'retry does not duplicate the event');
    assert.equal(storage.loadStoredConcepts()[0].exerciseCount, exerciseCount, 'retry does not re-increment exerciseCount');
  });

  check('completion history is not duplicated when the plan kind changes', () => {
    const subjectId = 'hist-subj';
    const conceptId = 'hist-c';
    const problemId = 'hist-p';
    const subject = { ...structuredClone(INITIAL_SUBJECTS[0]), id: subjectId, isDemo: false, examAt: '2026-10-20T10:00:00+09:00' };
    const concept = {
      ...structuredClone(INITIAL_CONCEPTS[0]), id: conceptId, subjectId, isDemo: false, isLearned: true, status: 'stable', exerciseCount: 1,
      events: [{ id: 'ev-hist', conceptId, at: '2026-10-01T08:00:00+09:00', dayOffset: 0, kind: 'attempt', title: 't', resultScore: 80, confidence: 3, hintCount: 0, sourceRef: '', rubricScores: [], attemptId: 'att-hist' }],
    };
    const problem = {
      ...structuredClone(INITIAL_PROBLEMS[0]), id: problemId, subjectId, conceptIds: [conceptId], isDemo: false,
      isApproved: true, qualityStatus: 'normal', isOutdated: false, version: 1, type: 'essay_descriptive',
      rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'r' }],
    };
    const settings = {
      ...structuredClone(types.DEFAULT_STUDY_PLAN_SETTINGS),
      subjectConfigs: { [subjectId]: { subjectId, selectedConceptIds: [conceptId], selectedProblemTypes: ['essay_descriptive'], includeMockExam: false, mockExamTargetMinutes: 45 } },
    };
    // Saved completion id uses the OLD kind; the same attempt must not be reproduced under a new kind id.
    const existing = mkPlanItem({
      id: `spi-recommended_review-${subjectId}-${conceptId}-${problemId}-r1`, subjectId, subjectName: subject.name,
      conceptId, problemId, kind: 'recommended_review', status: 'completed', round: 1,
      completedAt: '2026-10-01T08:00:00+09:00', completedAttemptId: 'att-hist',
    });
    const plan = studyPlan.generateStudyPlan({
      subjects: [subject], concepts: [concept], problems: [problem], attempts: [], settings,
      referenceDate: new Date('2026-10-01T09:00:00+09:00'), existingItems: [existing], daysCount: 7,
    });
    const all = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems);
    const linked = all.filter((i) => i.completedAttemptId === 'att-hist');
    assert.equal(linked.length, 1, 'exactly one completion entry exists for the attempt');
    assert.equal(linked[0].completedAt, '2026-10-01T08:00:00+09:00', 'completion shows the real completion date');
  });

  check('mixed mock exam plan item stores scope, types and planned minutes', () => {
    const subjectId = 'mock-subj';
    const c1 = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'mock-c1', subjectId, isDemo: false, isLearned: true, status: 'stable', exerciseCount: 1, events: [] };
    const c2 = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'mock-c2', subjectId, isDemo: false, isLearned: true, status: 'stable', exerciseCount: 1, events: [] };
    const rubric = [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'r' }];
    const p1 = { ...structuredClone(INITIAL_PROBLEMS[0]), id: 'mock-p1', subjectId, conceptIds: ['mock-c1'], isDemo: false, isApproved: true, qualityStatus: 'normal', isOutdated: false, version: 1, type: 'essay_descriptive', rubric };
    const p2 = { ...p1, id: 'mock-p2', conceptIds: ['mock-c2'] };
    const subject = { ...structuredClone(INITIAL_SUBJECTS[0]), id: subjectId, isDemo: false, examAt: '2026-10-08T10:00:00+09:00' };
    const settings = {
      ...structuredClone(types.DEFAULT_STUDY_PLAN_SETTINGS),
      subjectConfigs: { [subjectId]: { subjectId, selectedConceptIds: ['mock-c1', 'mock-c2'], selectedProblemTypes: ['essay_descriptive'], includeMockExam: true, mockExamTargetMinutes: 35 } },
    };
    const plan = studyPlan.generateStudyPlan({
      subjects: [subject], concepts: [c1, c2], problems: [p1, p2], attempts: [], settings,
      referenceDate: new Date('2026-10-01T09:00:00+09:00'), daysCount: 7,
    });
    const mock = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems).find((i) => i.kind === 'mixed_mock_exam');
    assert.ok(mock, 'a mixed mock exam item is generated');
    assert.equal(mock.mockExamConfig.minutes, 35, 'planned exam minutes are stored on the item');
    assert.deepEqual(mock.mockExamConfig.selectedTypes, ['essay_descriptive'], 'selected problem types are stored on the item');
    assert.deepEqual([...mock.mockExamConfig.conceptIds].sort(), ['mock-c1', 'mock-c2'], 'scope concepts are stored on the item');
  });

  check('low performance does not lengthen the interval just because hints were unused', () => {
    const subjectId = 'pers-subj';
    const subject = { ...structuredClone(INITIAL_SUBJECTS[0]), id: subjectId, isDemo: false };
    const concept = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'pers-c', subjectId, isDemo: false };
    const problemIds = ['pers-p1', 'pers-p2', 'pers-p3'];
    const problems = problemIds.map((id) => ({
      ...structuredClone(INITIAL_PROBLEMS[0]), id, subjectId, conceptIds: ['pers-c'],
      isDemo: false, isApproved: true, qualityStatus: 'normal', isOutdated: false, version: 1,
    }));
    const days = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'];
    const mkAttempts = (score) => days.map((d, idx) => ({
      id: `pers-att-${score}-${idx}`, problemId: problemIds[idx % 3], conceptId: 'pers-c', subjectId,
      at: `${d}T09:00:00+09:00`, answer: 'a', confidence: 3, errorType: 'none', hintCount: 0,
      reasoningNotes: '', calculatedScore: score, rubricResults: [], evaluatorFeedback: '', problemVersion: 1,
    }));
    const settings = { ...structuredClone(types.DEFAULT_PERSONALIZATION_SETTINGS), enabled: true, autoAdjust: true, tendency: 'standard' };
    const referenceDate = new Date('2026-10-01T09:00:00+09:00');

    const bad = personalization.computeCorrectionState({ attempts: mkAttempts(40), mockExams: [], problems, subjects: [subject], concepts: [concept], settings, referenceDate });
    const badSignal = bad.perSubject.find((s) => s.subjectId === subjectId);
    assert.ok(badSignal, 'subject signal exists');
    assert.equal(badSignal.direction, 'shorten', 'low average performance shortens the interval');
    assert.ok(bad.appliedMultiplier < 1, `applied multiplier is below 1 (got ${bad.appliedMultiplier})`);

    const good = personalization.computeCorrectionState({ attempts: mkAttempts(90), mockExams: [], problems, subjects: [subject], concepts: [concept], settings, referenceDate });
    const goodSignal = good.perSubject.find((s) => s.subjectId === subjectId);
    assert.equal(goodSignal.direction, 'lengthen', 'stable high performance lengthens the interval');
  });

  // ---- Stage 13: answer-logic strengthening & delayed rechallenge ----
  const lsSubject = { ...structuredClone(INITIAL_SUBJECTS[0]), id: 'ls-subj', isDemo: false, examAt: '2026-10-20T10:00:00+09:00' };
  const lsConcept = { ...structuredClone(INITIAL_CONCEPTS[0]), id: 'ls-c', subjectId: 'ls-subj', isDemo: false, isLearned: true, status: 'stable', exerciseCount: 0, events: [] };
  const lsRubric = [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'r' }];
  const lsProblem = { ...structuredClone(INITIAL_PROBLEMS[0]), id: 'ls-prob', subjectId: 'ls-subj', conceptIds: ['ls-c'], isDemo: false, isApproved: true, qualityStatus: 'normal', isOutdated: false, version: 1, rubric: lsRubric };
  const lsSettings = structuredClone(types.DEFAULT_STUDY_PLAN_SETTINGS);
  lsSettings.subjectConfigs = { 'ls-subj': { subjectId: 'ls-subj', selectedConceptIds: ['ls-c'], selectedProblemTypes: [lsProblem.type], includeMockExam: false, mockExamTargetMinutes: 45 } };

  await checkAsync('starting a logic session does not modify the original Attempt', async () => {
    storage.saveStoredConcepts([structuredClone(lsConcept)]);
    storage.saveStoredAttempts([]);
    const original = { id: 'ls-orig', problemId: 'ls-prob', conceptId: 'ls-c', subjectId: 'ls-subj', at: '2026-10-01T08:00:00+09:00', answer: 'orig answer', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 60, rubricResults: [], evaluatorFeedback: '', isAiEvaluated: true, attemptOrigin: 'independent' };
    storage.recordAttemptAndUpdateConcept(original);
    const draft = { id: 'logic-ls-orig', subjectId: 'ls-subj', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1, sourceAttemptId: 'ls-orig', createdAt: '2026-10-01T09:00:00+09:00', updatedAt: '2026-10-01T09:00:00+09:00', status: 'draft', problemTitleSnapshot: 't', problemPromptSnapshot: 'p', modelAnswerSnapshot: 'm', rubricSnapshot: lsRubric, originalAnswer: 'orig answer', originalScore: 60, originalRubricResults: [], questions: [], questionAnswers: {}, revisedAnswer: '' };
    assert.equal(logicSession.saveLogicSession(draft), true);
    assert.equal(logicSession.getLogicSession('logic-ls-orig').originalAnswer, 'orig answer', 'draft restored after refresh');
    const after = storage.loadStoredAttempts().find((a) => a.id === 'ls-orig');
    assert.equal(after.calculatedScore, 60, 'original score unchanged');
    assert.equal(after.answer, 'orig answer', 'original answer unchanged');
    assert.equal(storage.loadStoredAttempts().length, 1, 'session start creates no attempt');
  });

  await checkAsync('an assisted revision is stored once and excluded from independent analytics', async () => {
    const before = storage.loadStoredConcepts().find((c) => c.id === 'ls-c');
    const revised = { id: 'ls-rev', problemId: 'ls-prob', conceptId: 'ls-c', subjectId: 'ls-subj', at: '2026-10-01T10:00:00+09:00', answer: 'revised', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 95, rubricResults: [], evaluatorFeedback: '', isAiEvaluated: true, attemptOrigin: 'assisted_revision', sourceAttemptId: 'ls-orig', logicSessionId: 'logic-ls-orig' };
    storage.recordAssistedRevisionAttempt(revised);
    storage.recordAssistedRevisionAttempt(revised); // duplicate click
    assert.equal(storage.loadStoredAttempts().filter((a) => a.id === 'ls-rev').length, 1, 'assisted attempt stored once');
    const after = storage.loadStoredConcepts().find((c) => c.id === 'ls-c');
    assert.equal(after.events.filter((e) => e.attemptId === 'ls-rev').length, 1, 'assisted event stored once');
    assert.equal(after.currentScore, before.currentScore, 'assisted revision does not change retention score');
    assert.equal(after.exerciseCount, before.exerciseCount, 'assisted revision does not increase exercise count');

    const collection = learningAnalytics.collectValidRecords({ attempts: storage.loadStoredAttempts(), mockExams: [], problems: [lsProblem], subjects: [lsSubject], concepts: [after] });
    assert.equal(collection.assistedRevisionCount, 1, 'assisted revision counted separately');
    assert.ok(!collection.records.some((r) => r.attemptId === 'ls-rev'), 'assisted revision excluded from independent records');
    assert.ok(collection.records.some((r) => r.attemptId === 'ls-orig'), 'original independent record included');
  });

  check('AI-only question validation never creates learning history', () => {
    const attemptsBefore = storage.loadStoredAttempts().length;
    const qs = logicValidation.validateLogicQuestionsOutput(
      { questions: [{ id: 'q1', question: 'a', linkedCriterionId: 'r' }, { id: 'q2', question: 'b' }] },
      lsRubric
    );
    assert.equal(qs.length, 2);
    assert.throws(() => logicValidation.validateLogicQuestionsOutput({ questions: [{ id: 'q1', question: 'a' }] }, lsRubric));
    assert.equal(storage.loadStoredAttempts().length, attemptsBefore, 'no history from AI-only validation');
  });

  check('rechallenge reservation adds a plan item without changing score or round', () => {
    const attemptsBefore = storage.loadStoredAttempts().length;
    const concept = storage.loadStoredConcepts().find((c) => c.id === 'ls-c');
    const eventsBefore = concept.events.length;
    const reservation = { id: 'rr-1', subjectId: 'ls-subj', subjectName: '과목', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1, problemTitle: 't', problemType: lsProblem.type, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: '2026-10-01T09:00:00+09:00', status: 'scheduled' };
    const plan = studyPlan.generateStudyPlan({ subjects: [lsSubject], concepts: [concept], problems: [lsProblem], attempts: storage.loadStoredAttempts(), settings: lsSettings, referenceDate: new Date('2026-10-01T09:00:00+09:00'), daysCount: 7, rechallengeReservations: [reservation] });
    const item = plan.days.flatMap((d) => d.items).concat(plan.days[0].unassignedItems).find((i) => i.kind === 'rechallenge');
    assert.ok(item, 'rechallenge item generated');
    assert.equal(item.rechallengeId, 'rr-1');
    assert.equal(storage.loadStoredAttempts().length, attemptsBefore, 'reservation creates no attempt');
    assert.equal(storage.loadStoredConcepts().find((c) => c.id === 'ls-c').events.length, eventsBefore, 'reservation adds no review event');
  });

  await checkAsync('logic-questions API rejects malformed output and accepts valid questions', async () => {
    const { POST } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const reqBody = { subjectId: 'ls-subj', domain: 'math_stats', problemTitle: 't', problemPrompt: 'p', modelAnswer: 'm', rubric: lsRubric, originalAnswer: 'orig', solvingReason: '' };
    const request = (value) => new NextRequest('http://localhost/api/logic-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'a' }, { id: 'q2', question: 'b' }] }) } }] });
    const ok = await POST(request(reqBody));
    assert.equal(ok.status, 200);
    const okJson = await ok.json();
    assert.equal(okJson.questions.length, 2);
    global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'a' }] }) } }] });
    const bad = await POST(request(reqBody));
    assert.equal(bad.status, 502, 'insufficient questions rejected');
    const badReq = await POST(request({ ...reqBody, originalAnswer: '' }));
    assert.equal(badReq.status, 400, 'missing original answer rejected before AI call');
  });

  console.log(`${passed} regression checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));
