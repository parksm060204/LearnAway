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
  'lib/problemSources.ts', 'lib/problemFreshness.ts', 'app/api/evaluate-answer/route.ts',
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
  const markdownUtils = load(path.join(output, 'lib/markdownUtils.js'));
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

  console.log(`${passed} regression checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));
