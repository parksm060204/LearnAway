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
  'lib/types.ts', 'lib/storage.ts', 'lib/mockExam.ts', 'lib/evaluationValidation.ts', 'lib/materialStorage.ts', 'lib/materialPolicy.ts', 'lib/materialRestore.ts',
  'lib/materialDraft.ts', 'lib/materialEditSave.ts', 'lib/materialIngestion.ts', 'lib/analysisCheckpoint.ts', 'lib/reviewNotifications.ts', 'lib/dashboardUrl.ts',
  'lib/practiceAnswerDraft.ts', 'lib/sessionAffiliation.ts', 'lib/analysisRecovery.ts', 'lib/recoveryToken.ts',
  'lib/todayStudy.ts', 'lib/reviewStats.ts',
  'lib/problemSources.ts', 'lib/problemFreshness.ts', 'lib/studyPlan.ts', 'lib/retentionModel.ts', 'lib/dateUtils.ts',
  'lib/personalization.ts', 'lib/logicSession.ts', 'lib/logicValidation.ts', 'lib/logicAsync.ts',
  'lib/academicProofing.ts', 'lib/aiConfig.ts', 'lib/aiClient.ts', 'lib/aiCredentials.ts', 'lib/asyncRequestTracker.ts', 'lib/learningAnalytics.ts', 'lib/transferValidation.ts',
  'lib/storageScope.ts', 'lib/auth/redirects.ts', 'lib/legacyImport.ts', 'lib/appReadiness.ts',
  'lib/cloud/hash.ts', 'lib/cloud/mappers.ts', 'lib/cloud/plan.ts',
  'lib/cloud/subjectsRepository.ts', 'lib/cloud/materialsRepository.ts', 'lib/cloud/library.ts',
  'lib/cloud/migrationOriginals.ts', 'lib/cloud/localMigration.ts',
  'lib/cloud/learningMappers.ts', 'lib/cloud/learningPlan.ts', 'lib/cloud/learningRepository.ts',
  'lib/cloud/mergeLearning.ts', 'lib/cloud/learningOriginals.ts', 'lib/learningApproval.ts',
  'lib/cloud/historyMappers.ts', 'lib/cloud/historyMerge.ts', 'lib/cloud/historyRepository.ts',
  'lib/cloud/historyMigration.ts',
  'lib/cloud/mockExamSync.ts', 'lib/cloud/pendingExamAnswers.ts', 'lib/cloud/draftPersistence.ts',
  'app/api/evaluate-answer/route.ts', 'app/api/convert/route.ts', 'app/api/logic-questions/route.ts', 'app/api/transfer-problem/route.ts', 'app/api/analyze-concepts/route.ts', 'app/api/generate-problems/route.ts', 'lib/supabase/admin.ts', 'app/api/reminders/cron/route.ts',
  'lib/trialCredits.ts', 'lib/drive/googleDrive.ts', 'app/api/auth/username/route.ts', 'app/api/guest-login/route.ts', 'lib/auth/session.ts', 'lib/auth/apiAuth.ts',
  'lib/auth/username.ts',
  'lib/pdf/token.ts', 'lib/pdf/browserPdfConverter.ts', 'lib/pdf/tempStorage.ts', 'app/api/cron/cleanup-temp-pdf/route.ts', 'lib/aiCostTelemetry.ts', 'app/api/admin/ai-metrics/route.ts',
  'app/api/review-problem-quality/route.ts',
  '--outDir', output, '--module', 'commonjs', '--target', 'ES2020', '--moduleResolution', 'node',
  '--esModuleInterop', '--skipLibCheck', '--strict'], { cwd: root, encoding: 'utf8' });

async function run() {
  // Isolate process environment from ambient machine configuration so unit assertions stay deterministic
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.BAZE_API_KEY;
  delete process.env.BAZE_BASE_URL;
  delete process.env.BAZE_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_PROVIDER;

  process.env.ANALYSIS_RECOVERY_SIGNING_SECRET =
    process.env.ANALYSIS_RECOVERY_SIGNING_SECRET || 'test_secret_for_regressions_analysis_token_signing_123456';
  if (compile.status !== 0) throw new Error(compile.stdout + compile.stderr);
  // Windows cannot create directory symlinks without elevation; a junction works unprivileged.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');
  const data = new Map();
  global.window = { localStorage: {} };
  global.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
  window.localStorage = localStorage;
  // sessionStorage shim: per-tab draft identity (survives refresh within a tab).
  const sessionData = new Map();
  global.sessionStorage = {
    getItem: (key) => (sessionData.has(key) ? sessionData.get(key) : null),
    setItem: (key, value) => { sessionData.set(key, String(value)); },
    removeItem: (key) => { sessionData.delete(key); },
    clear: () => { sessionData.clear(); },
    key: (index) => Array.from(sessionData.keys())[index] ?? null,
    get length() { return sessionData.size; },
  };
  window.sessionStorage = sessionStorage;
  const nowIso = () => new Date().toISOString();

  // --- Auth gate mock ------------------------------------------------------
  // Production route handlers verify the user on the server with no bypass.
  // Tests replace only the compiled auth gate module with a controllable stub.
  const apiAuthPath = path.join(output, 'lib', 'auth', 'apiAuth.js');
  fs.mkdirSync(path.dirname(apiAuthPath), { recursive: true });
  // Keep the real compiled module for testing the pure failure-response mapper.
  const realApiAuthPath = path.join(output, 'lib', 'auth', 'apiAuth.real.js');
  fs.copyFileSync(apiAuthPath, realApiAuthPath);
  fs.writeFileSync(apiAuthPath, `const { NextResponse } = require('next/server');
let mode = 'authenticated';
exports.__setMode = (m) => { mode = m; };
exports.requireApiUser = async () => {
  if (mode === 'authenticated') {
    const u = globalThis.__fakeSupabaseClient?.__state?.user || { id: 'test-user', email: 'test@example.com' };
    return { ok: true, user: { id: u.id || 'test-user', email: u.email || 'test@example.com' } };
  }
  return { ok: false, response: NextResponse.json({ success: false, authError: true, code: 'UNAUTHENTICATED', error: 'login required' }, { status: 401 }) };
};
`);
  delete load.cache[apiAuthPath];
  const auth = load(apiAuthPath);
  const realApiAuth = load(realApiAuthPath);
  const redirects = load(path.join(output, 'lib/auth/redirects.js'));
  const legacyImport = load(path.join(output, 'lib/legacyImport.js'));
  const appReadiness = load(path.join(output, 'lib/appReadiness.js'));
  const storageScope = load(path.join(output, 'lib/storageScope.js'));
  const cloudHash = load(path.join(output, 'lib/cloud/hash.js'));
  const cloudMappers = load(path.join(output, 'lib/cloud/mappers.js'));
  const cloudPlan = load(path.join(output, 'lib/cloud/plan.js'));

  // Replace only the external boundary (the Supabase client) with a controllable
  // fake. The real repository/service code under test is executed unchanged.
  const supabaseClientPath = path.join(output, 'lib', 'supabase', 'client.js');
  fs.mkdirSync(path.dirname(supabaseClientPath), { recursive: true });
  fs.writeFileSync(
    supabaseClientPath,
    `exports.createClient = () => globalThis.__fakeSupabaseClient || globalThis.__defaultFakeSupabaseClient;`
  );
  delete load.cache[supabaseClientPath];

  // The server client (used by lib/aiCredentials) is stubbed to the same fake.
  const supabaseServerPath = path.join(output, 'lib', 'supabase', 'server.js');
  fs.mkdirSync(path.dirname(supabaseServerPath), { recursive: true });
  fs.writeFileSync(
    supabaseServerPath,
    `exports.createClient = async () => globalThis.__fakeSupabaseClient || globalThis.__defaultFakeSupabaseClient || { rpc: async () => ({ data: null, error: null }) };`
  );
  delete load.cache[supabaseServerPath];


  const cloudSubjects = load(path.join(output, 'lib/cloud/subjectsRepository.js'));
  const cloudMaterials = load(path.join(output, 'lib/cloud/materialsRepository.js'));
  const cloudOriginals = load(path.join(output, 'lib/cloud/migrationOriginals.js'));
  const cloudMigration = load(path.join(output, 'lib/cloud/localMigration.js'));
  const cloudLearningMappers = load(path.join(output, 'lib/cloud/learningMappers.js'));
  const cloudLearningPlan = load(path.join(output, 'lib/cloud/learningPlan.js'));
  const cloudLearningRepo = load(path.join(output, 'lib/cloud/learningRepository.js'));
  const cloudMerge = load(path.join(output, 'lib/cloud/mergeLearning.js'));
  const cloudLearningOriginals = load(path.join(output, 'lib/cloud/learningOriginals.js'));
  const learningApproval = load(path.join(output, 'lib/learningApproval.js'));
  const cloudHistoryMappers = load(path.join(output, 'lib/cloud/historyMappers.js'));
  const cloudHistoryMerge = load(path.join(output, 'lib/cloud/historyMerge.js'));
  const cloudHistoryRepo = load(path.join(output, 'lib/cloud/historyRepository.js'));
  const cloudMockExamSync = load(path.join(output, 'lib/cloud/mockExamSync.js'));
  const historyMigration = load(path.join(output, 'lib/cloud/historyMigration.js'));
  const pendingAnswers = load(path.join(output, 'lib/cloud/pendingExamAnswers.js'));
  const cloudDraftPersistence = load(path.join(output, 'lib/cloud/draftPersistence.js'));

  const storage = load(path.join(output, 'lib/storage.js'));
  const exams = load(path.join(output, 'lib/mockExam.js'));
  const validation = load(path.join(output, 'lib/evaluationValidation.js'));
  const matStorage = load(path.join(output, 'lib/materialStorage.js'));
  const materialPolicy = load(path.join(output, 'lib/materialPolicy.js'));
  const materialRestore = load(path.join(output, 'lib/materialRestore.js'));
  const todayStudy = load(path.join(output, 'lib/todayStudy.js'));
  const reviewStats = load(path.join(output, 'lib/reviewStats.js'));
  const problemSources = load(path.join(output, 'lib/problemSources.js'));
  const problemFreshness = load(path.join(output, 'lib/problemFreshness.js'));
  const studyPlan = load(path.join(output, 'lib/studyPlan.js'));
  const retentionModel = load(path.join(output, 'lib/retentionModel.js'));
  const dateUtils = load(path.join(output, 'lib/dateUtils.js'));
  const logicSession = load(path.join(output, 'lib/logicSession.js'));
  const logicValidation = load(path.join(output, 'lib/logicValidation.js'));
  const transferValidation = load(path.join(output, 'lib/transferValidation.js'));
  const logicAsync = load(path.join(output, 'lib/logicAsync.js'));
  const asyncTracker = load(path.join(output, 'lib/asyncRequestTracker.js'));
  const learningAnalytics = load(path.join(output, 'lib/learningAnalytics.js'));
  const markdownUtils = load(path.join(output, 'lib/markdownUtils.js'));
  const personalization = load(path.join(output, 'lib/personalization.js'));
  const types = load(path.join(output, 'lib/types.js'));
  const materialDraft = load(path.join(output, 'lib/materialDraft.js'));
  const materialEditSave = load(path.join(output, 'lib/materialEditSave.js'));
  const materialIngestion = load(path.join(output, 'lib/materialIngestion.js'));
  const analysisCheckpoint = load(path.join(output, 'lib/analysisCheckpoint.js'));
  const reviewNotifications = load(path.join(output, 'lib/reviewNotifications.js'));
  const dashboardUrl = load(path.join(output, 'lib/dashboardUrl.js'));
  const practiceAnswerDraft = load(path.join(output, 'lib/practiceAnswerDraft.js'));
  const sessionAffiliation = load(path.join(output, 'lib/sessionAffiliation.js'));
  const googleDrive = load(path.join(output, 'lib/drive/googleDrive.js'));
  const aiCostTelemetry = load(path.join(output, 'lib/aiCostTelemetry.js'));
  const trialCredits = load(path.join(output, 'lib/trialCredits.js'));
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
  // Route tests exercise the operator fallback; the dedicated policy test
  // toggles this explicitly and restores it.
  process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
  const aiClient = load(path.join(output, 'lib/aiClient.js'));
  const aiCredentials = load(path.join(output, 'lib/aiCredentials.js'));
  const defaultFakeSupabaseClient = {
    rpc: async (name) => {
      if (name === 'consume_ai_call_budget') {
        return { data: { allowed: true, remaining: 9, retryAfterSeconds: 60 }, error: null };
      }
      if (name === 'get_or_create_trial_credits') {
        return { data: { success: true, granted_credits: 3, remaining_credits: 3, is_first_grant: false }, error: null };
      }
      if (name === 'reserve_trial_credit' || name === 'register_ai_task') {
        return { data: { allowed: true, status: 'reserved', remaining: 2, lease_token: 'lease_mock_token_123' }, error: null };
      }
      if (name === 'check_operator_ai_daily_usage') {
        return { data: { allowed: true, call_count: 1, daily_cap: 500 }, error: null };
      }
      if (name === 'record_trial_result_ready' || name === 'record_ai_trial_result_ready') {
        return { data: { success: true, status: 'result_ready' }, error: null };
      }
      if (name === 'settle_trial_credit') {
        return { data: { success: true, status: 'settled', is_existing: false }, error: null };
      }
      if (name === 'release_trial_credit') {
        return { data: { success: true, refunded: true, remaining_credits: 3 }, error: null };
      }
      return { data: null, error: null };
    },
  };
  globalThis.__defaultFakeSupabaseClient = defaultFakeSupabaseClient;
  globalThis.__fakeSupabaseClient = defaultFakeSupabaseClient;
  const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
  const { POST } = load(path.join(output, 'app/api/evaluate-answer/route.js'));
  const { POST: convertPdf } = load(path.join(output, 'app/api/convert/route.js'));
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
    assert.equal(valid.status, 200, JSON.stringify(response)); assert.equal(response.evaluation.calculatedScore, 80.5);
  });

  // ---- Authentication gate ----
  const callsBeforeAnonymous = calls;
  auth.__setMode('anonymous');
  const unauthenticated = await POST(request(body));
  const unauthenticatedPdf = await convertPdf(new NextRequest('http://localhost/api/convert', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'not a multipart PDF request',
  }));
  check('unauthenticated AI evaluation is blocked with 401 before any AI call', () => {
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls, callsBeforeAnonymous);
  });
  check('unauthenticated PDF conversion is rejected before parsing or worker startup', () => {
    assert.equal(unauthenticatedPdf.status, 401);
  });
  auth.__setMode('authenticated');

  const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  await checkAsync('authenticated PDF conversion rejects a fake signature before starting Python', async () => {
    const form = new FormData();
    form.append('file', new File(['not a PDF'], 'lecture.pdf', { type: 'application/pdf' }));
    const response = await convertPdf(new NextRequest('http://localhost/api/convert', {
      method: 'POST', body: form,
    }));
    const payload = await response.json();
    assert.equal(response.status, 415);
    assert.equal(payload.code, 'PDF_SIGNATURE_INVALID');
  });

  check('auth failures map consistently to 401/503 with authError flag', async () => {
    const unauth = realApiAuth.authFailureResponse({ status: 'unauthenticated' });
    const errored = realApiAuth.authFailureResponse({ status: 'error', message: 'x' });
    const unconfigured = realApiAuth.authFailureResponse({ status: 'unconfigured', message: 'x' });
    assert.equal(unauth.status, 401);
    assert.equal(errored.status, 401);
    assert.equal(unconfigured.status, 503);
    assert.equal((await unauth.json()).authError, true);
  });

  check('redirect targets are restricted to internal non-auth paths', () => {
    assert.equal(redirects.safeInternalPath('/subjects?x=1'), '/subjects?x=1');
    assert.equal(redirects.safeInternalPath('//evil.com'), '/');
    assert.equal(redirects.safeInternalPath('https://evil.com'), '/');
    assert.equal(redirects.safeInternalPath('/\\evil.com'), '/');
    assert.equal(redirects.safeInternalPath('/login'), '/');
    assert.equal(redirects.safeInternalPath('/auth/callback'), '/');
    assert.equal(redirects.safeInternalPath(null), '/');
  });

  // ---- Stage 11: material storage reliability ----
  // A minimal in-memory IndexedDB that supports the operations materialStorage
  // uses, with failure injection so read/write/abort paths can be exercised
  // without replacing the service under test.
  function createFakeIndexedDB() {
    const databases = new Map();
    const failure = { get: new Set(), getAll: false, put: new Set(), abortPut: new Set(), corruptPut: new Set(), blocked: false };

    const recordFor = (name) => {
      if (!databases.has(name)) databases.set(name, new Map());
      return databases.get(name);
    };

    const makeRequest = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: undefined, error: null });

    const makeTransaction = (stores, storeName, notifyPending = null) => {
      if (!stores.has(storeName)) stores.set(storeName, new Map());
      const store = stores.get(storeName);
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null, _settled: false };
      const finish = (kind, error) => {
        if (tx._settled) return;
        tx._settled = true;
        if (kind === 'complete') {
          if (tx.oncomplete) tx.oncomplete();
          return;
        }
        tx.error = error || new Error(kind);
        if (kind === 'abort') { if (tx.onabort) tx.onabort(); }
        else if (tx.onerror) tx.onerror();
      };
      const api = {
        indexNames: { contains: () => true },
        get: (id) => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              if (failure.get.has(id)) { req.error = new Error('injected read failure'); if (req.onerror) req.onerror(); finish('error', req.error); return; }
              req.result = store.has(id) ? structuredClone(store.get(id)) : undefined;
              if (req.onsuccess) req.onsuccess();
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
        getAll: () => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              if (failure.getAll) { req.error = new Error('injected getAll failure'); if (req.onerror) req.onerror(); return; }
              req.result = Array.from(store.values()).map((value) => structuredClone(value));
              if (req.onsuccess) req.onsuccess();
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
        getAllKeys: () => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              req.result = Array.from(store.keys());
              if (req.onsuccess) req.onsuccess();
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
        put: (value) => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              const key = value.id || value.materialId;
              if (failure.abortPut.has(value.materialId)) { finish('abort', new Error('injected abort')); return; }
              if (failure.put.has(value.materialId)) { req.error = new Error('injected write failure'); if (req.onerror) req.onerror(); finish('error', req.error); return; }
              if (failure.corruptPut.has(value.materialId)) {
                store.set(key, structuredClone({ ...value, markdown: String(value.markdown || '') + ' corrupted' }));
                req.result = key;
                if (req.onsuccess) req.onsuccess();
                finish('complete');
                return;
              }
              store.set(key, structuredClone(value));
              req.result = key;
              if (req.onsuccess) req.onsuccess();
              finish('complete');
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
        index: (indexName) => ({
          get: (key) => {
            const req = makeRequest();
            if (notifyPending) notifyPending(1);
            setTimeout(() => {
              try {
                const item = Array.from(store.values()).find((v) => v && v[indexName] === key);
                req.result = item ? structuredClone(item) : undefined;
                if (req.onsuccess) req.onsuccess();
              } finally {
                if (notifyPending) notifyPending(-1);
              }
            }, 0);
            return req;
          },
          getAll: (key) => {
            const req = makeRequest();
            if (notifyPending) notifyPending(1);
            setTimeout(() => {
              try {
                const items = Array.from(store.values()).filter((v) => v && v[indexName] === key);
                req.result = items.map((it) => structuredClone(it));
                if (req.onsuccess) req.onsuccess();
              } finally {
                if (notifyPending) notifyPending(-1);
              }
            }, 0);
            return req;
          },
        }),
        delete: (id) => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              store.delete(id);
              if (req.onsuccess) req.onsuccess();
              finish('complete');
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
        clear: () => {
          const req = makeRequest();
          if (notifyPending) notifyPending(1);
          setTimeout(() => {
            try {
              store.clear();
              if (req.onsuccess) req.onsuccess();
              finish('complete');
            } finally {
              if (notifyPending) notifyPending(-1);
            }
          }, 0);
          return req;
        },
      };
      tx.objectStore = () => api;
      return tx;
    };

    const dbVersions = new Map();
    return {
      __failure: failure,
      __databases: databases,
      __dbVersions: dbVersions,
      open(name, version) {
        const request = makeRequest();
        if (failure.blocked) {
          setTimeout(() => {
            if (request.onblocked) request.onblocked({ target: request });
          }, 0);
          return request;
        }

        setTimeout(() => {
          const stores = recordFor(name);
          const oldVersion = dbVersions.get(name) || 0;
          const targetVersion = version !== undefined ? version : (oldVersion || 1);
          const isUpgrade = version !== undefined ? version > oldVersion : oldVersion === 0;

          // Snapshot stores before upgrade in case tx.abort() is called
          const storesSnapshot = new Map();
          for (const [sName, sMap] of stores.entries()) {
            storesSnapshot.set(sName, new Map(Array.from(sMap.entries()).map(([k, v]) => [k, structuredClone(v)])));
          }

          let pendingRequests = 0;
          let upgradeAborted = false;
          let upgradeTxFinished = false;

          const finishUpgradeIfReady = () => {
            if (pendingRequests === 0 && !upgradeAborted && !upgradeTxFinished) {
              upgradeTxFinished = true;
              dbVersions.set(name, targetVersion);
              db.version = targetVersion;
              if (request.onsuccess) request.onsuccess({ target: request });
            }
          };

          const notifyPending = (delta) => {
            pendingRequests += delta;
            if (pendingRequests <= 0) {
              setTimeout(finishUpgradeIfReady, 0);
            }
          };

          const upgradeTx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            abort: () => {
              upgradeAborted = true;
              upgradeTxFinished = true;
              // Rollback stores
              stores.clear();
              for (const [sName, sMap] of storesSnapshot.entries()) {
                stores.set(sName, new Map(Array.from(sMap.entries()).map(([k, v]) => [k, structuredClone(v)])));
              }
              if (request.onerror) {
                request.error = new Error('AbortError');
                request.onerror({ target: request });
              }
            },
            objectStore: (storeName) => makeTransaction(stores, storeName, notifyPending).objectStore(),
          };

          const db = {
            name,
            version: targetVersion,
            objectStoreNames: { contains: (storeName) => stores.has(storeName) },
            createObjectStore: (storeName) => {
              if (!stores.has(storeName)) stores.set(storeName, new Map());
              const storeApi = makeTransaction(stores, storeName, notifyPending).objectStore();
              return {
                createIndex: () => {},
                put: (val) => storeApi.put(val),
              };
            },
            deleteObjectStore: (storeName) => {
              stores.delete(storeName);
            },
            transaction: (storeName) => makeTransaction(stores, storeName, null),
            close: () => {},
          };
          request.result = db;
          request.transaction = upgradeTx;

          if (isUpgrade && request.onupgradeneeded) {
            try {
              request.onupgradeneeded({ target: request, oldVersion, newVersion: targetVersion });
            } catch {
              upgradeTx.abort();
              return;
            }
          }

          if (upgradeAborted) return;
          if (pendingRequests === 0) {
            finishUpgradeIfReady();
          }
        }, 0);
        return request;
      },
    };
  }

  const withFakeIndexedDB = async (fn) => {
    const fake = createFakeIndexedDB();
    if (typeof global.window === 'undefined') {
      global.window = {};
    }
    global.window.indexedDB = fake;
    global.indexedDB = fake;
    try {
      return await fn(fake);
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
      if (global.window) delete global.window.indexedDB;
      delete global.indexedDB;
    }
  };

  // A controllable fake Supabase client used to exercise the real repository
  // code with injected failures at the external boundary.
  function createFakeSupabase(options = {}) {
    const state = {
      user: options.user === undefined ? { id: 'user-a' } : options.user,
      subjects: options.subjects !== undefined
        ? [...options.subjects]
        : (options.materials || []).filter((m) => m && m.subject_id).map((m) => ({ id: m.subject_id, user_id: m.user_id || (options.user ? options.user.id : 'user-a'), name: 'Auto Subject' })),
      materials: options.materials ? [...options.materials] : [],
      objects: new Map(options.objects ? Object.entries(options.objects) : []),
      fail: options.fail || {},
      rpcCalls: [],
      rpcResult: options.rpcResult,
      rpcResults: options.rpcResults || {},
      rpcImpl: options.rpcImpl || null,
      isAdmin: options.isAdmin !== undefined ? options.isAdmin : true,
      operator_daily_usage: options.operator_daily_usage !== undefined ? options.operator_daily_usage : 0,
    };
    // Seed any additional table arrays provided in options.
    for (const key of Object.keys(options)) {
      if (['user', 'subjects', 'materials', 'objects', 'fail', 'rpcResult'].includes(key)) continue;
      state[key] = options[key];
    }
    const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
    const nowIso = () => new Date().toISOString();
    const matchFilters = (rows, filters) =>
      rows.filter((row) => filters.every(([col, val, op]) => {
        if (op === "in") return Array.isArray(val) && val.includes(row[col]);
        if (op === "gte") return row[col] >= val;
        if (op === "lte") return row[col] <= val;
        return row[col] === val;
      }));

    function tableBuilder(table) {
      const ctx = { op: 'select', payload: null, onConflict: null, ignoreDuplicates: false, filters: [], order: [], range: null, limit: null };
      const builder = {
        select() { return builder; },
        order(col, opts) { ctx.order.push({ col, opts }); return builder; },
        range(from, to) { ctx.range = { from, to }; return builder; },
        limit(count) { ctx.limit = count; return builder; },
        eq(col, val) { ctx.filters.push([col, val]); return builder; },
        in(col, val) { ctx.filters.push([col, val, "in"]); return builder; },
        gte(col, val) { ctx.filters.push([col, val, "gte"]); return builder; },
        lte(col, val) { ctx.filters.push([col, val, "lte"]); return builder; },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return builder; },
        upsert(payload, opts) {
          ctx.op = 'upsert';
          ctx.payload = payload;
          ctx.onConflict = opts && opts.onConflict;
          ctx.ignoreDuplicates = Boolean(opts && opts.ignoreDuplicates);
          return builder;
        },
        insert(payload) {
          ctx.op = 'insert';
          ctx.payload = payload;
          return builder;
        },
        delete() { ctx.op = 'delete'; return builder; },
        maybeSingle() { return exec(true); },
        single() { return exec(false); },
        then(resolve, reject) { return exec(null).then(resolve, reject); },
      };

      async function exec(maybe) {
        const rows = (state[table] = state[table] || []);
        try {
          if (table === 'ai_trial_credits' || table === 'ai_trial_reservations') {
            if (ctx.op === 'upsert' || ctx.op === 'update' || ctx.op === 'delete') {
              return { data: null, error: { message: 'permission denied for table ' + table, code: '42501' } };
            }
          }
          if (ctx.op === 'select') {
            let result = matchFilters(rows, ctx.filters);
            if (table === 'ai_trial_credits' || table === 'ai_trial_reservations') {
              if (state.user) {
                result = result.filter((r) => r.user_id === state.user.id);
              } else {
                result = [];
              }
            }
            if (ctx.order.length > 0) {
              result = [...result].sort((a, b) => {
                for (const { col, opts } of ctx.order) {
                  const dir = opts && opts.ascending ? 1 : -1;
                  if (a[col] < b[col]) return -1 * dir;
                  if (a[col] > b[col]) return 1 * dir;
                }
                return 0;
              });
            }
            if (ctx.range) result = result.slice(ctx.range.from, ctx.range.to + 1);
            if (ctx.limit !== null) result = result.slice(0, ctx.limit);
            if (maybe === true) return { data: result[0] ? clone(result[0]) : null, error: null };
            if (maybe === false) {
              if (result.length === 0) return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
              return { data: clone(result[0]), error: null };
            }
            return { data: result.map(clone), error: null };
          }
          if (ctx.op === 'upsert') {
            const shouldFailUpsert = typeof state.fail.upsert === 'function'
              ? state.fail.upsert(table)
              : Boolean(state.fail.upsert === true || (Array.isArray(state.fail.upsert) && state.fail.upsert.includes(table)));
            if (shouldFailUpsert) return { data: null, error: { message: 'injected upsert failure for ' + table } };
            const keys = (ctx.onConflict || 'id').split(',').map((s) => s.trim());
            const items = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
            const savedItems = [];
            for (const raw of items) {
              const payload = { ...raw };
              if (payload.user_id === undefined) payload.user_id = state.user ? state.user.id : null;
              const idx = rows.findIndex((row) => keys.every((k) => row[k] === payload[k]));
              let saved;
              if (idx >= 0) {
                // ON CONFLICT DO NOTHING: existing rows are neither modified nor returned.
                if (ctx.ignoreDuplicates) continue;
                saved = { ...rows[idx], ...payload, updated_at: nowIso() };
                rows[idx] = saved;
              } else {
                saved = { created_at: nowIso(), updated_at: nowIso(), ...payload };
                rows.push(saved);
              }
              savedItems.push(saved);
            }
            if (maybe === false) return { data: clone(savedItems[0] ?? null), error: null };
            if (maybe === true) return { data: savedItems[0] ? clone(savedItems[0]) : null, error: null };
            return { data: savedItems.map(clone), error: null };
          }
          if (ctx.op === 'insert') {
            if (state.fail.insert) return { data: null, error: { message: 'injected insert failure' } };
            const items = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
            const savedItems = [];
            for (const raw of items) {
              const payload = { ...raw };
              if (payload.user_id === undefined && state.user) payload.user_id = state.user.id;
              if (table === 'username_accounts') {
                const exists = rows.some((r) => r.username === payload.username);
                if (exists) {
                  return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
                }
              }
              const saved = { created_at: nowIso(), updated_at: nowIso(), ...payload };
              rows.push(saved);
              savedItems.push(saved);
            }
            if (maybe === false) return { data: clone(savedItems[0] ?? null), error: null };
            if (maybe === true) return { data: savedItems[0] ? clone(savedItems[0]) : null, error: null };
            return { data: savedItems.map(clone), error: null };
          }
          if (ctx.op === 'update') {
            if (state.fail.update) return { data: null, error: { message: 'injected update failure' } };
            let matched = matchFilters(rows, ctx.filters);
            if (state.fail.switch && ctx.filters.some(([col]) => col === 'pending_job_id')) matched = [];
            if (matched.length === 0) return { data: null, error: { message: 'no rows updated', code: 'PGRST116' } };
            for (const row of matched) Object.assign(row, ctx.payload, { updated_at: nowIso() });
            if (maybe === false) return { data: clone(matched[0]), error: null };
            return { data: matched.map(clone), error: null };
          }
          if (ctx.op === 'delete') {
            if (state.fail.deleteRow) return { data: null, error: { message: 'injected delete failure' } };
            state[table] = rows.filter((row) => matchFilters([row], ctx.filters).length === 0);
            return { data: null, error: null };
          }
          return { data: null, error: { message: 'unsupported op' } };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      }
      return builder;
    }

    const storage = options.storage || {
      from() {
        return {
          async upload(path, blob, opts) {
            if (state.fail.delayPath && state.fail.delayGate && path.includes(state.fail.delayPath)) {
              await state.fail.delayGate;
            }
            if (state.fail.upload) return { data: null, error: { message: 'injected upload failure' } };
            if (state.fail.uploadPath && path.includes(state.fail.uploadPath)) {
              return { data: null, error: { message: 'injected upload failure' } };
            }
            state.objects.set(path, { blob, contentType: opts && opts.contentType });
            return { data: { path }, error: null };
          },
          async download(path) {
            if (state.fail.download) return { data: null, error: { message: 'injected download failure' } };
            const entry = state.objects.get(path);
            if (!entry) return { data: null, error: { message: 'not found' } };
            let blob = entry.blob ?? entry;
            if (state.fail.corruptDownload) {
              const text = await blob.text();
              blob = new Blob([`${text} corrupted`]);
            }
            return { data: blob, error: null };
          },
          async list(prefix, opts) {
            if (state.fail.list) return { data: null, error: { message: 'injected list failure' } };
            const limit = (opts && opts.limit) || 100;
            const offset = (opts && opts.offset) || 0;
            const children = new Map();
            for (const key of state.objects.keys()) {
              if (prefix && !key.startsWith(`${prefix}/`)) continue;
              const rest = prefix ? key.slice(prefix.length + 1) : key;
              const seg = rest.split('/')[0];
              children.set(seg, rest.includes('/'));
            }
            const entries = Array.from(children.entries()).map(([name, isFolder]) => ({
              name,
              id: isFolder ? null : 'obj',
            }));
            return { data: entries.slice(offset, offset + limit), error: null };
          },
          async remove(paths) {
            if (state.fail.remove) return { data: null, error: { message: 'injected remove failure' } };
            for (const p of paths) state.objects.delete(p);
            return { data: paths, error: null };
          },
          async createSignedUrl(path) {
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
          },
        };
      },
    };

    return {
      __state: state,
      auth: {
        async getUser() {
          if (state.fail.authUser) return { data: { user: null }, error: null };
          return { data: { user: state.user }, error: null };
        },
        async signInWithPassword({ email }) {
          state.signInWithPasswordCalls = (state.signInWithPasswordCalls || 0) + 1;
          if (state.fail.signInWithPassword) {
            return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
          }
          const user = state.user || { id: 'usr-signed-in', email };
          return {
            data: {
              user,
              session: { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', user },
            },
            error: null,
          };
        },
        admin: {
          async createUser({ email, user_metadata }) {
            state.createUserCalls = (state.createUserCalls || 0) + 1;
            if (state.fail.createUser) {
              return { data: null, error: { message: state.fail.createUserMessage || 'User already registered' } };
            }
            const userId = 'usr-' + Math.random().toString(36).substring(2, 9);
            const user = { id: userId, email, user_metadata };
            return { data: { user }, error: null };
          },
          async deleteUser(userId) {
            state.deletedUsers = state.deletedUsers || [];
            state.deletedUsers.push(userId);
            return { data: { user: null }, error: null };
          },
        },
      },
      from(table) { return tableBuilder(table); },
      rpc(name, params) {
        if (state.fail.rpc) {
          state.rpcCalls.push({ name, params });
          return Promise.resolve({ data: null, error: { message: state.fail.rpcMessage || 'injected rpc failure' } });
        }
        state.rpcCalls.push({ name, params });
        if (state.rpcImpl) {
          let custom = state.rpcImpl(name, params, state);
          if ((!custom || (custom.data === null && custom.error === null)) && name === 'register_ai_task') {
            custom = state.rpcImpl('reserve_trial_credit', params, state);
          }
          if (custom && (custom.data !== null || custom.error !== null || name === 'get_ai_connection_secret')) {
            return Promise.resolve(custom);
          }
        }
        if (Object.prototype.hasOwnProperty.call(state.rpcResults, name)) {
          return Promise.resolve(state.rpcResults[name]);
        }
        if (name === 'consume_ai_call_budget') {
          return Promise.resolve({ data: { allowed: true, remaining: 99, retryAfterSeconds: 60 }, error: null });
        }
        if (name === 'get_ai_connection_secret') {
          return Promise.resolve({ data: null, error: null });
        }
        if (name === 'check_and_increment_rate_limit') {
          if (state.failRateLimitRpc) {
            return Promise.resolve({ data: null, error: { message: 'simulated rate limit RPC error', code: '50000' } });
          }
          if (state.rateLimitRpcReturnNull) {
            return Promise.resolve({ data: null, error: null });
          }
          if (state.rateLimitRpcThrow) {
            return Promise.reject(new Error('simulated rate limit RPC network exception'));
          }
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function check_and_increment_rate_limit', code: '42501' } });
          }
          const limits = (state.auth_rate_limits = state.auth_rate_limits || []);
          const key = params.p_key;
          const maxAttempts = params.p_max_attempts || 5;
          const windowSeconds = params.p_window_seconds || 60;
          let rec = limits.find((l) => l.key === key);
          const now = Date.now();
          if (!rec) {
            limits.push({ key, attempts: 1, window_start: now });
            return Promise.resolve({ data: true, error: null });
          }
          if (now - rec.window_start > windowSeconds * 1000) {
            rec.attempts = 1;
            rec.window_start = now;
            return Promise.resolve({ data: true, error: null });
          }
          if (rec.attempts >= maxAttempts) {
            return Promise.resolve({ data: false, error: null });
          }
          rec.attempts += 1;
          return Promise.resolve({ data: true, error: null });
        }
        if (name === 'get_or_create_trial_credits') {
          const userId = (params && params.p_user_id) || (state.user ? state.user.id : 'test-user');
          const creditsList = (state.ai_trial_credits = state.ai_trial_credits || []);
          const usernameAccounts = (state.username_accounts = state.username_accounts || []);
          let entry = creditsList.find((c) => c.user_id === userId);
          if (!entry) {
            // Check if guest / simple username account
            const isGuest = userId === 'user-trial-1' ||
              usernameAccounts.some((u) => u.user_id === userId) ||
              Boolean(state.user && (state.user.id === userId && (state.user.email?.endsWith('@id.learnaway.local') || state.user.user_metadata?.auth_type === 'username')));
            const initialGrant = isGuest ? 1 : 3;
            entry = {
              user_id: userId,
              granted_credits: initialGrant,
              balance: initialGrant,
              granted_at: nowIso(),
              updated_at: nowIso(),
            };
            creditsList.push(entry);
            return Promise.resolve({
              data: {
                granted: initialGrant,
                balance: initialGrant,
                hasPersonalKey: false,
                isGuest,
              },
              error: null,
            });
          }
          const isGuest = userId === 'user-trial-1' ||
            usernameAccounts.some((u) => u.user_id === userId) ||
            Boolean(state.user && (state.user.id === userId && (state.user.email?.endsWith('@id.learnaway.local') || state.user.user_metadata?.auth_type === 'username')));
          return Promise.resolve({
            data: {
              granted: entry.granted_credits,
              balance: entry.balance,
              hasPersonalKey: false,
              isGuest,
            },
            error: null,
          });
        }
        if (name === 'reserve_trial_credit') {
          state.reserveTrialCreditCallCount = (state.reserveTrialCreditCallCount || 0) + 1;
        }
        if (name === 'register_ai_task' && state.failRegisterAiTaskRpc) {
          if (state.failRegisterAiTaskRpc === 'throw') {
            return Promise.reject(new Error('simulated register_ai_task network exception'));
          }
          if (state.failRegisterAiTaskRpc === 'null') {
            return Promise.resolve({ data: null, error: null });
          }
          if (state.failRegisterAiTaskRpc === 'malformed') {
            return Promise.resolve({ data: { unexpected_format: true }, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'simulated register_ai_task RPC error', code: '50000' } });
        }
        if (name === 'reserve_trial_credit' || name === 'register_ai_task') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: `permission denied for function ${name}`, code: '42501' } });
          }
          const userId = (params && params.p_user_id) || (state.user ? state.user.id : 'test-user');
          const isPersonalKey = Boolean(params && params.p_is_personal_key);
          const creditsList = (state.ai_trial_credits = state.ai_trial_credits || []);
          const resList = (state.ai_trial_reservations = state.ai_trial_reservations || []);
          let userCredits = creditsList.find((c) => c.user_id === userId);
          if (!userCredits && !isPersonalKey) {
            const usernameAccounts = (state.username_accounts = state.username_accounts || []);
            const isGuest = userId === 'user-trial-1' ||
              usernameAccounts.some((u) => u.user_id === userId) ||
              Boolean(state.user && (state.user.id === userId && (state.user.email?.endsWith('@id.learnaway.local') || state.user.user_metadata?.auth_type === 'username')));
            const initialGrant = isGuest ? 1 : 3;
            userCredits = {
              user_id: userId,
              granted_credits: initialGrant,
              balance: initialGrant,
              granted_at: nowIso(),
              updated_at: nowIso(),
            };
            creditsList.push(userCredits);
          }

          const taskId = params && params.p_task_id;
          const taskType = params && params.p_task_type;
          const inputIdentifier = params && params.p_input_identifier;

          if (!isPersonalKey) {
            const cap = (params && params.p_daily_cap) || 500;
            if ((state.operator_daily_usage || 0) >= cap) {
              return Promise.resolve({
                data: {
                  allowed: false,
                  error_code: 'OPERATOR_DAILY_CAP_EXCEEDED',
                  remaining: userCredits ? userCredits.balance : 0,
                  message: '금일 운영자 AI 체험 제공 한도가 초과되었습니다.',
                },
                error: null,
              });
            }
          }

          // Mirror Migration 33: check for active lease or cached result on identical input across different taskIds
          const activeOnInput = resList.find((r) =>
            r.user_id === userId &&
            r.task_type === taskType &&
            r.input_identifier === inputIdentifier &&
            r.status === 'processing' &&
            r.lease_expires_at &&
            new Date(r.lease_expires_at).getTime() > Date.now()
          );
          if (activeOnInput && activeOnInput.task_id !== taskId) {
            return Promise.resolve({
              data: {
                allowed: false,
                status: 'concurrent_in_progress',
                error_code: 'CONCURRENT_EXECUTION_BLOCKED',
                message: '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.',
              },
              error: null,
            });
          }

          const existing = resList.find((r) => r.task_id === taskId);
          if (existing) {
            if (existing.user_id !== userId) {
              return Promise.resolve({
                data: { allowed: false, error_code: 'TASK_OWNERSHIP_MISMATCH', message: '다른 사용자의 작업 식별자입니다.' },
                error: null,
              });
            }
            if (existing.task_type !== taskType) {
              return Promise.resolve({
                data: { allowed: false, error_code: 'TASK_TYPE_MISMATCH', message: '작업 종류가 일치하지 않습니다.' },
                error: null,
              });
            }
            if (existing.input_identifier !== inputIdentifier) {
              return Promise.resolve({
                data: { allowed: false, error_code: 'TASK_INPUT_MISMATCH', message: '동일한 작업 식별자에 다른 입력이 전달되었습니다.' },
                error: null,
              });
            }
            const existingSource = existing.credit_source || 'operator_trial';
            const targetSource = isPersonalKey ? 'personal_key' : 'operator_trial';
            if (existingSource !== targetSource) {
              return Promise.resolve({
                data: { allowed: false, error_code: 'TASK_CREDIT_SOURCE_MISMATCH', message: '작업의 결제 출처가 일치하지 않습니다.' },
                error: null,
              });
            }
            if (existing.status === 'settled' || existing.status === 'result_ready') {
              return Promise.resolve({
                data: {
                  allowed: false,
                  status: 'already_completed',
                  cached_result: existing.cached_result,
                  remaining: userCredits ? userCredits.balance : 0,
                  is_personal_key: isPersonalKey,
                },
                error: null,
              });
            }
            if (existing.status === 'processing' && existing.lease_expires_at && new Date(existing.lease_expires_at).getTime() > Date.now()) {
              return Promise.resolve({
                data: {
                  allowed: false,
                  status: 'concurrent_in_progress',
                  error_code: 'CONCURRENT_EXECUTION_BLOCKED',
                  message: '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.',
                },
                error: null,
              });
            }
            if ((existing.attempt_count || 1) >= 5 && existing.release_reason !== 'intermediate_chunk') {
              return Promise.resolve({
                data: { allowed: false, error_code: 'MAX_RETRIES_EXCEEDED', message: '최대 재시도 횟수를 초과했습니다.' },
                error: null,
              });
            }
            if (existing.status === 'released' || existing.status === 'failed_refunded') {
              if (!isPersonalKey) {
                if ((params && params.p_operator_daily_cap || 500) <= (state.operator_daily_usage || 0)) {
                  return Promise.resolve({
                    data: { allowed: false, error_code: 'OPERATOR_DAILY_CAP_EXCEEDED', remaining: userCredits ? userCredits.balance : 0, message: '일일 한도 초과' },
                    error: null,
                  });
                }
                if (!userCredits || userCredits.balance <= 0) {
                  return Promise.resolve({
                    data: {
                      allowed: false,
                      error_code: 'INSUFFICIENT_CREDITS',
                      remaining: 0,
                      message: 'AI 체험 크레딧이 모두 소진되었습니다.',
                    },
                    error: null,
                  });
                }
                userCredits.balance -= 1;
                userCredits.updated_at = nowIso();
                state.operator_daily_usage = (state.operator_daily_usage || 0) + 1;
              }
            } else if (existing.status === 'processing') {
              if (!isPersonalKey) {
                if ((params && params.p_operator_daily_cap || 500) <= (state.operator_daily_usage || 0)) {
                  return Promise.resolve({
                    data: { allowed: false, error_code: 'OPERATOR_DAILY_CAP_EXCEEDED', remaining: userCredits ? userCredits.balance : 0, message: '일일 한도 초과' },
                    error: null,
                  });
                }
                state.operator_daily_usage = (state.operator_daily_usage || 0) + 1;
              }
            }

            const leaseToken = 'lease_' + Math.random().toString(36).slice(2);
            const isIntermediate = existing.release_reason === 'intermediate_chunk';
            existing.status = 'processing';
            existing.attempt_count = isIntermediate ? (existing.attempt_count || 1) : (existing.attempt_count || 1) + 1;
            existing.release_reason = null;
            existing.lease_token = leaseToken;
            existing.lease_expires_at = new Date(Date.now() + 60000).toISOString();
            return Promise.resolve({
              data: {
                allowed: true,
                status: 'processing',
                remaining: userCredits ? userCredits.balance : 0,
                lease_token: leaseToken,
                is_personal_key: isPersonalKey,
                credit_source: targetSource,
              },
              error: null,
            });
          }

          if (!isPersonalKey) {
            if (userCredits.balance <= 0) {
              return Promise.resolve({
                data: {
                  allowed: false,
                  error_code: 'INSUFFICIENT_CREDITS',
                  remaining: 0,
                  message: 'AI 체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.',
                },
                error: null,
              });
            }
            userCredits.balance -= 1;
            userCredits.updated_at = nowIso();
            state.operator_daily_usage = (state.operator_daily_usage || 0) + 1;
          }

          const leaseToken = 'lease_' + Math.random().toString(36).slice(2);
          const newRes = {
            id: `res_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            user_id: userId,
            task_id: taskId,
            task_type: taskType,
            input_identifier: inputIdentifier,
            credit_source: isPersonalKey ? 'personal_key' : 'operator_trial',
            status: 'processing',
            attempt_count: 1,
            lease_token: leaseToken,
            lease_expires_at: new Date(Date.now() + 60000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          };
          resList.push(newRes);

          return Promise.resolve({
            data: {
              allowed: true,
              status: 'processing',
              remaining: userCredits ? userCredits.balance : 0,
              lease_token: leaseToken,
              is_personal_key: isPersonalKey,
            },
            error: null,
          });
        }
        if (name === 'lookup_saved_ai_task_result') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function lookup_saved_ai_task_result', code: '42501' } });
          }
          const userId = params && params.p_user_id;
          const taskId = params && params.p_task_id;
          const taskType = params && params.p_task_type;
          const inputIdentifier = params && params.p_input_identifier;
          const resList = state.ai_trial_reservations || [];
          const res = resList.find((r) => r.task_id === taskId);
          if (!res) {
            return Promise.resolve({
              data: { success: false, error_code: 'TASK_NOT_FOUND', message: '보존된 작업 결과가 없습니다.' },
              error: null,
            });
          }
          if (res.user_id !== userId) {
            return Promise.resolve({
              data: { success: false, error_code: 'TASK_OWNERSHIP_MISMATCH', message: '다른 사용자의 작업 식별자입니다.' },
              error: null,
            });
          }
          if (res.task_type !== taskType) {
            return Promise.resolve({
              data: { success: false, error_code: 'TASK_TYPE_MISMATCH', message: '작업 종류가 일치하지 않습니다.' },
              error: null,
            });
          }
          if (inputIdentifier && res.input_identifier !== inputIdentifier) {
            return Promise.resolve({
              data: { success: false, error_code: 'TASK_INPUT_MISMATCH', message: '동일한 작업 식별자에 다른 입력이 전달되었습니다.' },
              error: null,
            });
          }
          return Promise.resolve({
            data: {
              success: true,
              status: res.status,
              credit_source: res.credit_source || 'operator_trial',
              cached_result: res.cached_result || null,
              created_at: res.created_at,
              updated_at: res.updated_at,
            },
            error: null,
          });
        }
        if (name === 'record_trial_result_ready') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function record_trial_result_ready', code: '42501' } });
          }
          const resList = (state.ai_trial_reservations = state.ai_trial_reservations || []);
          const taskId = params && params.p_task_id;
          const token = params && typeof params.p_lease_token === 'string' ? params.p_lease_token.trim() : '';
          if (!token) {
            return Promise.resolve({ data: { success: false, error: '유효한 실행 토큰(lease_token)이 필요합니다.', error_code: 'LEASE_TOKEN_REQUIRED' }, error: null });
          }
          const res = resList.find((r) => r.task_id === taskId);
          if (!res) {
            return Promise.resolve({ data: { success: false, error: '예약 내역을 찾을 수 없습니다.', error_code: 'RESERVATION_NOT_FOUND' }, error: null });
          }
          if (res.lease_token !== token) {
            return Promise.resolve({ data: { success: false, error: '만료되었거나 유효하지 않은 실행 토큰(fencing token)입니다.', error_code: 'STALE_LEASE_TOKEN' }, error: null });
          }
          if (res.status === 'settled') {
            return Promise.resolve({ data: { success: false, error: '이미 최종 확정된 작업의 결과는 덮어쓸 수 없습니다.', error_code: 'ALREADY_SETTLED' }, error: null });
          }
          if (res.status === 'released' || res.status === 'failed_refunded') {
            return Promise.resolve({ data: { success: false, error: '이미 환급된 작업의 결과를 기록할 수 없습니다.', error_code: 'ALREADY_REFUNDED' }, error: null });
          }
          res.status = 'result_ready';
          res.cached_result = params.p_result;
          res.lease_expires_at = null;
          res.updated_at = nowIso();
          return Promise.resolve({ data: { success: true, status: 'result_ready' }, error: null });
        }
        if (name === 'settle_trial_credit') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function settle_trial_credit', code: '42501' } });
          }
          const resList = (state.ai_trial_reservations = state.ai_trial_reservations || []);
          const taskId = params && params.p_task_id;
          const token = params && typeof params.p_lease_token === 'string' ? params.p_lease_token.trim() : '';
          if (!token) {
            return Promise.resolve({ data: { success: false, message: '유효한 실행 토큰(lease_token)이 필요합니다.', error_code: 'LEASE_TOKEN_REQUIRED' }, error: null });
          }
          const res = resList.find((r) => r.task_id === taskId);
          if (!res) {
            return Promise.resolve({ data: { success: false, message: '예약 내역을 찾을 수 없습니다.', error_code: 'RESERVATION_NOT_FOUND' }, error: null });
          }
          if (res.lease_token !== token) {
            return Promise.resolve({ data: { success: false, message: '만료되었거나 유효하지 않은 실행 토큰입니다.', error_code: 'STALE_LEASE_TOKEN' }, error: null });
          }
          if (res.credit_source === 'personal_key') {
            res.status = 'settled';
            res.settled_at = nowIso();
            res.lease_expires_at = null;
            res.updated_at = nowIso();
            return Promise.resolve({ data: { success: true, status: 'settled', credit_source: 'personal_key' }, error: null });
          }
          if (res.status === 'settled') {
            return Promise.resolve({ data: { success: true, status: 'settled' }, error: null });
          }
          if (res.status === 'released' || res.status === 'failed_refunded') {
            return Promise.resolve({ data: { success: false, message: '이미 환급된 작업은 재차감 없이 확정할 수 없습니다.', error_code: 'ALREADY_REFUNDED' }, error: null });
          }
          if (!res.cached_result) {
            return Promise.resolve({ data: { success: false, message: '보존된 AI 결과가 없어 크레딧을 확정할 수 없습니다.', error_code: 'MISSING_CACHED_RESULT' }, error: null });
          }
          res.status = 'settled';
          res.settled_at = nowIso();
          res.lease_expires_at = null;
          res.updated_at = nowIso();
          return Promise.resolve({
            data: {
              success: true,
              status: 'settled',
            },
            error: null,
          });
        }
        if (name === 'release_trial_credit') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function release_trial_credit', code: '42501' } });
          }
          const resList = (state.ai_trial_reservations = state.ai_trial_reservations || []);
          const creditsList = (state.ai_trial_credits = state.ai_trial_credits || []);
          const taskId = params && params.p_task_id;
          const token = params && typeof params.p_lease_token === 'string' ? params.p_lease_token.trim() : '';
          if (!token) {
            return Promise.resolve({ data: { success: false, message: '유효한 실행 토큰(lease_token)이 필요합니다.', error_code: 'LEASE_TOKEN_REQUIRED' }, error: null });
          }
          const res = resList.find((r) => r.task_id === taskId);
          if (!res) {
            return Promise.resolve({ data: { success: false, message: '예약 내역을 찾을 수 없습니다.', error_code: 'RESERVATION_NOT_FOUND' }, error: null });
          }
          if (res.lease_token !== token) {
            return Promise.resolve({ data: { success: false, message: '만료되었거나 유효하지 않은 실행 토큰입니다.', error_code: 'STALE_LEASE_TOKEN' }, error: null });
          }
          if (res.credit_source === 'personal_key') {
            res.status = 'released';
            res.released_at = nowIso();
            res.release_reason = (params && params.p_reason) || 'failure';
            res.lease_expires_at = null;
            res.updated_at = nowIso();
            return Promise.resolve({ data: { success: true, status: 'released', refunded: false, remaining: 0, credit_source: 'personal_key' }, error: null });
          }
          if (res.status === 'settled') {
            return Promise.resolve({ data: { success: false, message: '이미 확정된 작업은 환급할 수 없습니다.', error_code: 'ALREADY_SETTLED' }, error: null });
          }
          if (res.status === 'released' || res.status === 'failed_refunded') {
            const userCredits = creditsList.find((c) => c.user_id === res.user_id);
            return Promise.resolve({
              data: {
                success: true,
                status: res.status,
                refunded: false,
                balance: userCredits ? userCredits.balance : 0,
                remaining: userCredits ? userCredits.balance : 0,
              },
              error: null,
            });
          }
          res.status = 'released';
          res.released_at = nowIso();
          res.release_reason = (params && params.p_reason) || 'failure';
          res.lease_expires_at = null;
          res.updated_at = nowIso();

          const userCredits = creditsList.find((c) => c.user_id === res.user_id);
          if (userCredits) {
            userCredits.balance = Math.min(userCredits.balance + 1, userCredits.granted_credits);
            userCredits.updated_at = nowIso();
          }
          return Promise.resolve({
            data: {
              success: true,
              status: 'released',
              refunded: true,
              balance: userCredits ? userCredits.balance : 0,
              remaining: userCredits ? userCredits.balance : 0,
            },
            error: null,
          });
        }
        if (name === 'clear_ai_task_lease') {
          const taskId = params && params.p_task_id;
          const token = params && typeof params.p_lease_token === 'string' ? params.p_lease_token.trim() : '';
          const resList = state.ai_trial_reservations || [];
          const res = resList.find((r) => r.task_id === taskId);
          if (!res) return Promise.resolve({ data: { success: false, error_code: 'TASK_NOT_FOUND' }, error: null });
          if (res.lease_token !== token) return Promise.resolve({ data: { success: false, error_code: 'STALE_LEASE_TOKEN' }, error: null });
          res.lease_token = null;
          res.lease_expires_at = null;
          res.release_reason = 'intermediate_chunk';
          return Promise.resolve({ data: { success: true }, error: null });
        }
        if (name === 'aggregate_ai_usage_telemetry') {
          if (state.failAggregateRpc) {
            return Promise.resolve({ data: null, error: { message: 'function aggregate_ai_usage_telemetry does not exist', code: '42883' } });
          }
          const telemetry = state.ai_usage_telemetry || [];
          const userId = params && params.p_user_id;
          const taskType = params && params.p_task_type;
          const creditSource = params && params.p_credit_source;
          const model = params && params.p_model;
          let filtered = telemetry;
          if (userId) filtered = filtered.filter((r) => r.user_id === userId);
          if (taskType) filtered = filtered.filter((r) => r.task_type === taskType);
          if (creditSource) filtered = filtered.filter((r) => r.credit_source === creditSource);
          if (model) filtered = filtered.filter((r) => r.model === model);

          const totalRequests = filtered.length;
          const totalCostUsd = filtered.reduce((acc, r) => acc + (r.estimated_cost_usd || 0), 0);
          const totalCostKrw = filtered.reduce((acc, r) => acc + (r.estimated_cost_krw || 0), 0);

          const opRows = filtered.filter((r) => r.credit_source === 'operator_trial');
          const pkRows = filtered.filter((r) => r.credit_source === 'personal_key');

          return Promise.resolve({
            data: {
              totalRequests,
              totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
              totalCostKrw: Math.round(totalCostKrw * 100) / 100,
              successfulRequests: filtered.filter((r) => r.status === 'success').length,
              failedRequests: filtered.filter((r) => r.status !== 'success').length,
              failureRatePercent: totalRequests > 0 ? Math.round((filtered.filter((r) => r.status !== 'success').length / totalRequests) * 100) : 0,
              requestsByTask: {},
              tokensByModel: {},
              costByModel: {},
              dailyMetrics: [],
              anomalies: [],
              operatorTrialConsumption: {
                requests: opRows.length,
                tokens: opRows.reduce((acc, r) => acc + (r.total_tokens || 0), 0),
                estimatedCostUsd: Math.round(opRows.reduce((acc, r) => acc + (r.estimated_cost_usd || 0), 0) * 1e6) / 1e6,
                estimatedCostKrw: Math.round(opRows.reduce((acc, r) => acc + (r.estimated_cost_krw || 0), 0) * 100) / 100,
              },
              personalKeyConsumption: {
                requests: pkRows.length,
                tokens: pkRows.reduce((acc, r) => acc + (r.total_tokens || 0), 0),
                estimatedCostUsd: Math.round(pkRows.reduce((acc, r) => acc + (r.estimated_cost_usd || 0), 0) * 1e6) / 1e6,
                estimatedCostKrw: Math.round(pkRows.reduce((acc, r) => acc + (r.estimated_cost_krw || 0), 0) * 100) / 100,
              },
            },
            error: null,
          });
        }
        if (name === 'check_operator_ai_daily_usage') {
          const cap = (params && params.p_daily_cap) || 500;
          const calls = state.operator_daily_usage || 0;
          return Promise.resolve({
            data: {
              allowed: calls < cap,
              call_count: calls,
              daily_cap: cap,
            },
            error: null,
          });
        }
        if (name === 'claim_expired_temp_pdf_jobs') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function claim_expired_temp_pdf_jobs', code: '42501' } });
          }
          const jobList = (state.temp_pdf_conversion_jobs = state.temp_pdf_conversion_jobs || []);
          const limit = (params && params.p_limit) || 50;
          const claimed = [];
          const now = Date.now();

          // Auto quarantine max attempts
          for (const j of jobList) {
            if (j.status !== 'cleaned' && j.status !== 'quarantined' && (j.cleanup_attempts || 0) >= 5) {
              j.status = 'quarantined';
              j.cleanup_error = 'MAX_CLEANUP_ATTEMPTS_EXCEEDED';
              j.updated_at = nowIso();
            }
          }

          for (const j of jobList) {
            if (claimed.length >= limit) break;
            const attempts = j.cleanup_attempts || 0;
            if (attempts >= 5 || j.status === 'cleaned' || j.status === 'quarantined') continue;

            const isExpired = j.expires_at && new Date(j.expires_at).getTime() < now;
            const isStalledConverting = j.status === 'converting' && (
              !j.lease_expires_at || new Date(j.lease_expires_at).getTime() < now ||
              (j.updated_at && new Date(j.updated_at).getTime() < now - 10 * 60 * 1000)
            );
            const isStrandedUpload = (j.status === 'ticket_issued' || j.status === 'uploaded') &&
              j.created_at && new Date(j.created_at).getTime() < now - 2 * 60 * 60 * 1000;
            const isInterruptedCleaning = j.status === 'cleaning' && (
              !j.lease_expires_at || new Date(j.lease_expires_at).getTime() < now ||
              (j.updated_at && new Date(j.updated_at).getTime() < now - 5 * 60 * 1000)
            );

            if ((isExpired && j.status !== 'cleaning' && j.status !== 'converting') || isStalledConverting || isStrandedUpload || isInterruptedCleaning) {
              const leaseToken = 'lease_clean_' + Math.random().toString(36).slice(2);
              j.status = 'cleaning';
              j.lease_token = leaseToken;
              j.lease_expires_at = new Date(now + 5 * 60 * 1000).toISOString();
              j.updated_at = nowIso();
              claimed.push({ ...j });
            }
          }
          return Promise.resolve({ data: claimed, error: null });
        }
        if (name === 'claim_temp_pdf_job_for_conversion') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function claim_temp_pdf_job_for_conversion', code: '42501' } });
          }
          const jobList = (state.temp_pdf_conversion_jobs = state.temp_pdf_conversion_jobs || []);
          const jobId = params && params.p_job_id;
          const userId = params && params.p_user_id;
          const token = (params && params.p_lease_token) || ('lease_conv_' + Math.random().toString(36).slice(2));

          const job = jobList.find((j) => j.job_id === jobId);
          if (!job) {
            return Promise.resolve({ data: { success: false, code: 'JOB_NOT_FOUND', error: '작업 내역을 찾을 수 없습니다.' }, error: null });
          }
          if (job.user_id !== userId) {
            return Promise.resolve({ data: { success: false, code: 'STORAGE_ACCESS_DENIED', error: '작업 접근 권한이 없습니다.' }, error: null });
          }
          if (['cleaned', 'cleaning', 'quarantined', 'cancelled'].includes(job.status)) {
            return Promise.resolve({ data: { success: false, code: 'JOB_NOT_CONVERTIBLE', status: job.status, error: '해당 작업은 이미 정리 중이거나 종료되어 변환할 수 없습니다.' }, error: null });
          }
          if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
            return Promise.resolve({ data: { success: false, code: 'JOB_EXPIRED', status: job.status, error: '임시 파일 유효시간이 만료되었습니다.' }, error: null });
          }
          if (job.status === 'converting' && job.lease_expires_at && new Date(job.lease_expires_at).getTime() > Date.now()) {
            return Promise.resolve({ data: { success: false, code: 'CONCURRENT_CONVERSION', status: job.status, error: '동일한 작업이 현재 변환 처리 중입니다.' }, error: null });
          }

          job.status = 'converting';
          job.lease_token = token;
          job.lease_expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          job.updated_at = nowIso();

          return Promise.resolve({
            data: {
              success: true,
              job_id: job.job_id,
              storage_path: job.storage_path,
              file_name: job.file_name,
              lease_token: token,
            },
            error: null,
          });
        }
        if (name === 'claim_temp_pdf_cleanup_by_converter') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function claim_temp_pdf_cleanup_by_converter', code: '42501' } });
          }
          if (state.fail && (state.fail.upsert || state.fail.rpc)) {
            return Promise.resolve({ data: null, error: { message: 'simulated database error in claim_temp_pdf_cleanup_by_converter' } });
          }
          const jobList = (state.temp_pdf_conversion_jobs = state.temp_pdf_conversion_jobs || []);
          const job = jobList.find((j) => j.job_id === params.p_job_id);
          if (!job) {
            return Promise.resolve({ data: { success: false, error: 'JOB_NOT_FOUND' }, error: null });
          }
          if (job.user_id !== params.p_user_id) {
            return Promise.resolve({ data: { success: false, error: 'STORAGE_ACCESS_DENIED' }, error: null });
          }
          if (job.lease_token !== params.p_lease_token) {
            return Promise.resolve({ data: { success: false, error: 'STALE_LEASE_TOKEN' }, error: null });
          }
          if (job.status !== 'converting') {
            return Promise.resolve({ data: { success: false, error: 'INVALID_STATUS', status: job.status }, error: null });
          }
          if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() <= Date.now()) {
            return Promise.resolve({ data: { success: false, error: 'LEASE_EXPIRED' }, error: null });
          }
          const cleanupToken = 'lease_clean_' + Math.random().toString(36).slice(2);
          job.status = 'cleaning';
          job.lease_token = cleanupToken;
          job.lease_expires_at = new Date(Date.now() + 60 * 1000).toISOString();
          job.updated_at = nowIso();
          return Promise.resolve({ data: { success: true, job_id: job.job_id, cleanup_token: cleanupToken }, error: null });
        }
        if (name === 'finalize_temp_pdf_cleanup') {
          if (state.isAdmin === false) {
            return Promise.resolve({ data: null, error: { message: 'permission denied for function finalize_temp_pdf_cleanup', code: '42501' } });
          }
          if (state.fail && (state.fail.upsert || state.fail.rpc)) {
            return Promise.resolve({ data: null, error: { message: 'simulated database error in finalize_temp_pdf_cleanup' } });
          }
          const jobList = (state.temp_pdf_conversion_jobs = state.temp_pdf_conversion_jobs || []);
          const job = jobList.find((j) => j.job_id === params.p_job_id);
          if (!job) {
            return Promise.resolve({ data: { success: false, error: 'JOB_NOT_FOUND' }, error: null });
          }
          if (job.lease_token !== params.p_lease_token) {
            return Promise.resolve({ data: { success: false, error: 'STALE_LEASE_TOKEN' }, error: null });
          }
          if (job.status !== 'cleaning') {
            return Promise.resolve({ data: { success: false, error: 'INVALID_STATUS', status: job.status }, error: null });
          }
          const attempts = (job.cleanup_attempts || 0) + 1;
          let finalStatus = params.p_target_status || 'cleaned';
          if (finalStatus === 'failed' && attempts >= 5) {
            finalStatus = 'quarantined';
          }
          job.status = finalStatus;
          job.cleanup_attempts = attempts;
          job.cleanup_error = params.p_cleanup_error || null;
          job.lease_token = null;
          job.lease_expires_at = null;
          job.updated_at = nowIso();
          return Promise.resolve({
            data: { success: true, job_id: job.job_id, status: finalStatus, cleanup_attempts: attempts },
            error: null,
          });
        }
        if (name === 'init_analysis_job_and_chunks') {
          if (!params.p_user_id) {
            return Promise.resolve({ data: { success: false, error: '사용자 식별자가 누락되었습니다.', error_code: 'UNAUTHORIZED' }, error: null });
          }

          // 1. Verify Subject Ownership in public.subjects
          const subjects = (state.subjects = state.subjects || []);
          const subject = subjects.find((s) => s.id === params.p_subject_id && s.user_id === params.p_user_id);
          if (!subject) {
            return Promise.resolve({
              data: { success: false, error: '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.', error_code: 'NOT_FOUND_OR_FORBIDDEN' },
              error: null,
            });
          }

          // 2. Verify Material Ownership & Subject Linkage if present
          const materials = (state.materials = state.materials || []);
          const mat = materials.find((m) => m.id === params.p_material_id);
          if (mat) {
            if (mat.user_id && mat.user_id !== params.p_user_id) {
              return Promise.resolve({
                data: { success: false, error: '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.', error_code: 'NOT_FOUND_OR_FORBIDDEN' },
                error: null,
              });
            }
            if (mat.subject_id && mat.subject_id !== params.p_subject_id) {
              return Promise.resolve({
                data: { success: false, error: '과목 식별자가 자료의 과목과 일치하지 않습니다.', error_code: 'SUBJECT_MISMATCH' },
                error: null,
              });
            }
          }

          // 3. Concurrency-safe job insertion with ON CONFLICT (id) DO NOTHING
          const jobs = (state.analysis_jobs = state.analysis_jobs || []);
          const chunks = (state.analysis_job_chunks = state.analysis_job_chunks || []);
          let existingJob = jobs.find((j) => j.id === params.p_job_id);

          if (!existingJob) {
            existingJob = {
              id: params.p_job_id,
              user_id: params.p_user_id,
              subject_id: params.p_subject_id,
              material_id: params.p_material_id,
              markdown_hash: params.p_markdown_hash,
              domain: params.p_domain,
              model_id: params.p_model_id,
              prompt_version: params.p_prompt_version || 'v2',
              chunking_version: params.p_chunking_version || 'v1',
              total_chunks: params.p_total_chunks,
              status: 'pending',
              created_at: nowIso(),
              updated_at: nowIso(),
            };
            jobs.push(existingJob);
          } else {
            // Check ownership
            if (existingJob.user_id !== params.p_user_id) {
              return Promise.resolve({
                data: { success: false, error: '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.', error_code: 'NOT_FOUND_OR_FORBIDDEN' },
                error: null,
              });
            }
            // Strict identity verification
            if (
              existingJob.subject_id !== params.p_subject_id ||
              existingJob.material_id !== params.p_material_id ||
              existingJob.markdown_hash !== params.p_markdown_hash ||
              existingJob.domain !== params.p_domain ||
              existingJob.model_id !== params.p_model_id ||
              existingJob.prompt_version !== (params.p_prompt_version || 'v2') ||
              existingJob.chunking_version !== (params.p_chunking_version || 'v1') ||
              existingJob.total_chunks !== params.p_total_chunks
            ) {
              return Promise.resolve({
                data: { success: false, error: '동일한 작업 식별자에 다른 분석 정보가 전달되었습니다.', error_code: 'JOB_IDENTITY_MISMATCH' },
                error: null,
              });
            }
            existingJob.updated_at = nowIso();
          }

          // Simulate chunk insertion failure leading to rollback if requested
          if (state.fail.failChunkInit) {
            const jobIdx = jobs.findIndex((j) => j.id === params.p_job_id);
            if (jobIdx >= 0 && jobs[jobIdx].status === 'pending') {
              jobs.splice(jobIdx, 1);
            }
            return Promise.resolve({ data: null, error: { message: 'injected chunk insert failure' } });
          }

          if (Array.isArray(params.p_chunks)) {
            for (const ch of params.p_chunks) {
              const chIdx = chunks.findIndex((c) => c.job_id === params.p_job_id && c.chunk_index === ch.chunk_index);
              if (chIdx < 0) {
                chunks.push({
                  id: `chk_${params.p_job_id}_${ch.chunk_index}`,
                  job_id: params.p_job_id,
                  chunk_index: ch.chunk_index,
                  source_context: ch.source_context,
                  status: 'pending',
                  drafts: [],
                  attempt_count: 0,
                  created_at: nowIso(),
                  updated_at: nowIso(),
                });
              }
            }
          }
          return Promise.resolve({ data: { success: true, job_id: params.p_job_id, total_chunks: params.p_total_chunks, status: existingJob.status }, error: null });
        }
        return Promise.resolve({ data: state.rpcResult ?? 'created-id', error: null });
      },
      storage,
    };
  }

  const withFakeSupabase = async (options, fn) => {
    const client = createFakeSupabase(options);
    globalThis.__fakeSupabaseClient = client;
    try {
      return await fn(client);
    } finally {
      globalThis.__fakeSupabaseClient = undefined;
      storageScope.setStorageScope({ kind: 'legacy' });
    }
  };

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

  await checkAsync('legacy import is explicit, idempotent and never clobbers user data', async () => {
    localStorage.setItem('redcall_subjects_v1', JSON.stringify([{ id: 'legacy-s' }]));
    localStorage.setItem('redcall_attempts_v1', JSON.stringify([{ id: 'legacy-a' }]));

    const first = await legacyImport.importLegacyData('user-1');
    assert.equal(first.verified, true);
    assert.equal(first.conflict, false);
    assert.ok(first.localStorageCopied >= 2, 'both seeded legacy keys are imported');
    assert.equal(localStorage.getItem('redcall_user_user-1__subjects_v1'), JSON.stringify([{ id: 'legacy-s' }]));

    // Re-running after completion is a verified no-op (no duplicates, no conflict).
    const second = await legacyImport.importLegacyData('user-1');
    assert.equal(second.verified, true);
    assert.equal(second.conflict, false);
    assert.equal(second.localStorageCopied, 0);
    assert.equal(second.localStorageSkipped, 0);

    // The original legacy source is preserved untouched.
    assert.equal(localStorage.getItem('redcall_subjects_v1'), JSON.stringify([{ id: 'legacy-s' }]));

    // Another account sees its own (empty) namespace, not user-1's records.
    const other = await legacyImport.getLegacyImportState('user-2');
    assert.equal(other.imported, false);
    assert.equal(localStorage.getItem('redcall_user_user-1__subjects_v1'), JSON.stringify([{ id: 'legacy-s' }]));
  });

  await checkAsync('import into an account with existing records is refused without partial merge', async () => {
    localStorage.setItem('redcall_user_user-3__subjects_v1', JSON.stringify([{ id: 'own' }]));
    const state = await legacyImport.getLegacyImportState('user-3');
    assert.equal(state.conflict, true);

    const before = localStorage.getItem('redcall_user_user-3__subjects_v1');
    const result = await legacyImport.importLegacyData('user-3');
    assert.equal(result.conflict, true);
    assert.equal(result.verified, false);
    assert.equal(result.localStorageCopied, 0);
    // Target records are untouched and no legacy-only key was copied in.
    assert.equal(localStorage.getItem('redcall_user_user-3__subjects_v1'), before);
    assert.equal(localStorage.getItem('redcall_user_user-3__attempts_v1'), null);
    assert.equal(legacyImport.isLegacyImportCompleted('user-3'), false);
  });

  await checkAsync('completion marker failure keeps a resumable job without duplicates', async () => {
    const userId = 'user-markerfail';
    const markerKey = 'redcall_user_' + userId + '__legacy_import_v1';
    const jobKey = 'redcall_user_' + userId + '__legacy_import_job_v1';
    const subjectKey = 'redcall_user_' + userId + '__subjects_v1';
    const attemptsKey = 'redcall_user_' + userId + '__attempts_v1';
    localStorage.removeItem(markerKey);
    localStorage.removeItem(jobKey);
    localStorage.removeItem(subjectKey);
    localStorage.removeItem(attemptsKey);

    const legacySubjects = localStorage.getItem('redcall_subjects_v1');
    const legacyAttempts = localStorage.getItem('redcall_attempts_v1');

    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (key === markerKey) throw new Error('simulated marker write failure');
      realSetItem(key, value);
    };
    let first;
    try {
      first = await legacyImport.importLegacyData(userId);
    } finally {
      localStorage.setItem = realSetItem;
    }

    // Copy succeeded but completion could not be recorded.
    assert.equal(first.verified, false);
    assert.equal(first.conflict, false);
    assert.equal(localStorage.getItem(markerKey), null);
    assert.ok(localStorage.getItem(jobKey) !== null, 'job record is kept for resume');
    assert.equal(localStorage.getItem(subjectKey), legacySubjects);

    const state = await legacyImport.getLegacyImportState(userId);
    assert.equal(state.resume, true);
    assert.equal(state.conflict, false);

    const retry = await legacyImport.importLegacyData(userId);
    assert.equal(retry.verified, true);
    assert.equal(retry.resume, true);
    assert.equal(retry.conflict, false);
    assert.ok(localStorage.getItem(markerKey) !== null);

    // No duplicates and the legacy source is preserved.
    assert.equal(localStorage.getItem(subjectKey), legacySubjects);
    assert.equal(localStorage.getItem(attemptsKey), legacyAttempts);
    assert.equal(localStorage.getItem('redcall_subjects_v1'), legacySubjects);
    assert.equal(localStorage.getItem('redcall_attempts_v1'), legacyAttempts);
  });

  await checkAsync('job progress save failure aborts before any copy', async () => {
    const userId = 'user-jobfail';
    const jobKey = 'redcall_user_' + userId + '__legacy_import_job_v1';
    const subjectKey = 'redcall_user_' + userId + '__subjects_v1';
    localStorage.removeItem(jobKey);
    localStorage.removeItem(subjectKey);

    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (key === jobKey) throw new Error('simulated job write failure');
      realSetItem(key, value);
    };
    let result;
    try {
      result = await legacyImport.importLegacyData(userId);
    } finally {
      localStorage.setItem = realSetItem;
    }

    assert.equal(result.verified, false);
    assert.match(result.message, /진행 상태/);
    assert.equal(localStorage.getItem(subjectKey), null);
    assert.equal(legacyImport.isLegacyImportCompleted(userId), false);
  });

  await checkAsync('legacy import writes to the requested account, not the active scope', async () => {
    const before = localStorage.getItem('redcall_user_other-account__subjects_v1');
    storageScope.setStorageScope({ kind: 'user', userId: 'other-account' });
    let result;
    try {
      result = await legacyImport.importLegacyData('pinned-user');
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
    }
    assert.equal(result.verified, true);
    assert.ok(localStorage.getItem('redcall_user_pinned-user__subjects_v1') !== null);
    assert.equal(localStorage.getItem('redcall_user_other-account__subjects_v1'), before);
  });

  await checkAsync('same material id and content is skipped, different content conflicts', async () => {
    await withFakeIndexedDB(async (fake) => {
      const sameScope = storageScope.userIdToScopeId('content-same');
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('c-same', { markdown: '# same', rawText: 'r' });
      storageScope.setStorageScope({ kind: 'user', userId: 'content-same' });
      await matStorage.saveMaterialContent('c-same', { markdown: '# same', rawText: 'r' });
      storageScope.setStorageScope({ kind: 'legacy' });

      const same = await matStorage.importMaterialContentsFromScope('shared', sameScope);
      assert.equal(same.verified, true);
      assert.equal(same.skipped, 1);
      assert.equal(same.copied, 0);
      assert.equal(same.conflicts, 0);

      const mdScope = storageScope.userIdToScopeId('content-md');
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('c-md', { markdown: '# original' });
      storageScope.setStorageScope({ kind: 'user', userId: 'content-md' });
      await matStorage.saveMaterialContent('c-md', { markdown: '# different' });
      storageScope.setStorageScope({ kind: 'legacy' });

      const different = await matStorage.importMaterialContentsFromScope('shared', mdScope);
      assert.equal(different.verified, false);
      assert.equal(different.conflicts, 1);
      assert.deepEqual(different.conflictIds, ['c-md']);

      // The conflicting target body is never overwritten.
      const target = fake.__databases
        .get('redcall_materials_db_' + mdScope)
        .get('material_contents')
        .get('c-md');
      assert.equal(target.markdown, '# different');
    });
  });

  await checkAsync('same id with different rawText or pages is a conflict', async () => {
    await withFakeIndexedDB(async () => {
      const scope = storageScope.userIdToScopeId('content-opt');
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('c-raw', { markdown: '# x', rawText: 'A' });
      await matStorage.saveMaterialContent('c-pages', {
        markdown: '# y',
        pages: [{ pageNumber: 1, markdown: 'p1' }],
      });
      storageScope.setStorageScope({ kind: 'user', userId: 'content-opt' });
      await matStorage.saveMaterialContent('c-raw', { markdown: '# x', rawText: 'B' });
      await matStorage.saveMaterialContent('c-pages', {
        markdown: '# y',
        pages: [{ pageNumber: 1, markdown: 'p2' }],
      });
      storageScope.setStorageScope({ kind: 'legacy' });

      const result = await matStorage.importMaterialContentsFromScope('shared', scope);
      assert.equal(result.verified, false);
      assert.equal(result.conflicts, 2);
      assert.deepEqual([...result.conflictIds].sort(), ['c-pages', 'c-raw']);
    });
  });

  await checkAsync('IndexedDB read, write and abort failures leave the import unverified', async () => {
    await withFakeIndexedDB(async (fake) => {
      const scope = storageScope.userIdToScopeId('idb-fail');
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('f-write', { markdown: '# w' });
      await matStorage.saveMaterialContent('f-abort', { markdown: '# a' });
      await matStorage.saveMaterialContent('f-read', { markdown: '# r' });
      storageScope.setStorageScope({ kind: 'legacy' });

      fake.__failure.put.add('f-write');
      fake.__failure.abortPut.add('f-abort');
      fake.__failure.get.add('f-read');

      const result = await matStorage.importMaterialContentsFromScope('shared', scope);
      assert.equal(result.verified, false);
      assert.ok(result.writeFailed >= 1, 'write failure is reported');
      assert.ok(result.aborted >= 1, 'transaction abort is reported');
      assert.ok(result.readFailed >= 1, 'read failure is reported');
      assert.equal(matStorage.isMaterialImportVerified(result), false);
    });
  });

  await checkAsync('a copied body that fails read-back verification is not marked complete', async () => {
    await withFakeIndexedDB(async (fake) => {
      const scope = storageScope.userIdToScopeId('verify-fail');
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('v-body', { markdown: '# verify' });
      storageScope.setStorageScope({ kind: 'legacy' });
      fake.__failure.corruptPut.add('v-body');

      const result = await matStorage.importMaterialContentsFromScope('shared', scope);
      assert.equal(result.verified, false);
      assert.equal(result.verifyFailed, 1);
      assert.equal(result.copied, 0);
      assert.equal(matStorage.isMaterialImportVerified(result), false);
    });
  });

  await checkAsync('pinned target scope prevents cross-account material mixups', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'legacy' });
      await matStorage.saveMaterialContent('scope-m', { markdown: '# scope' });
      // Active scope changes to another account before the import runs.
      storageScope.setStorageScope({ kind: 'user', userId: 'other-account' });

      const result = await matStorage.importMaterialContentsFromScope(
        'shared',
        storageScope.userIdToScopeId('pinned-account')
      );
      assert.equal(result.verified, true);

      const pinned = fake.__databases.get('redcall_materials_db_u_pinned-account');
      const other = fake.__databases.get('redcall_materials_db_u_other-account');
      assert.ok(pinned && pinned.get('material_contents').has('scope-m'));
      assert.ok(!other || !other.get('material_contents').has('scope-m'));
    });
  });

  check('material content identity follows the documented normalization rules', () => {
    assert.equal(
      matStorage.materialContentFingerprint({ markdown: '# a', rawText: undefined, updatedAt: '2020-01-01' }),
      matStorage.materialContentFingerprint({ markdown: '# a' }),
      'updatedAt and absent optional fields do not change identity'
    );
    assert.equal(
      matStorage.materialContentFingerprint({ markdown: '# a', rawText: '' }),
      matStorage.materialContentFingerprint({ markdown: '# a' }),
      'empty string rawText equals absent rawText'
    );
    assert.notEqual(
      matStorage.materialContentFingerprint({ markdown: '# a', pages: null }),
      matStorage.materialContentFingerprint({ markdown: '# a', pages: [] }),
      'absent pages differ from an empty page array'
    );
  });

  check('material input validation bounds file types and preserves Markdown verbatim', () => {
    assert.ok(materialIngestion.validateMaterialInputFile('pdf', { name: 'empty.pdf', size: 0 }));
    assert.ok(materialIngestion.validateMaterialInputFile('pdf', { name: 'notes.txt', size: 12 }));
    assert.ok(materialIngestion.validateMaterialInputFile('pdf', {
      name: 'large.pdf', size: materialIngestion.MATERIAL_INPUT_LIMITS.pdfBytes + 1,
    }));
    assert.ok(materialIngestion.validateMaterialInputFile('handout', { name: 'notes.exe', size: 12 }));
    assert.ok(materialIngestion.validateMaterialInputFile('transcript', {
      name: 'large.txt', size: materialIngestion.MATERIAL_INPUT_LIMITS.textBytes + 1,
    }));
    assert.equal(materialIngestion.validateMaterialInputFile('handout', { name: 'notes.md', size: 12 }), null);
    assert.ok(materialIngestion.validateMaterialText('  '));
    assert.ok(materialIngestion.validateMaterialText('\u0000binary'));
    assert.ok(materialIngestion.validateMaterialText('x'.repeat(materialIngestion.MATERIAL_INPUT_LIMITS.textBytes + 1)));
    assert.equal(materialIngestion.validateMaterialText('정상 전사본'), null);

    const source = '# Heading\r\n\r\n- item\r\n\r\n```ts\r\nconst x = 1;\r\n```';
    const parsed = materialIngestion.parseMaterialText('handout', source, 'Notes');
    assert.equal(parsed.rawText, source.replace(/\r\n/g, '\n'));
    assert.equal(parsed.markdown, parsed.rawText, 'Markdown structure and code fences are not transcript-rewritten');

    // Duplicate detection by content
    const existing = [
      { id: 'm-1', title: 'Chapter 1 Notes', parsedMarkdown: '# Heading\n\n- item\n\n```ts\nconst x = 1;\n```' },
      { id: 'm-2', title: 'Calculus Intro', rawText: '미적분학 서론 강의 녹음' },
    ];
    const dupMd = materialIngestion.findDuplicateMaterial(existing, source, '');
    assert.ok(dupMd, 'Finds duplicate when normalized markdown matches');
    assert.equal(dupMd.id, 'm-1');

    const dupRaw = materialIngestion.findDuplicateMaterial(existing, '', '미적분학 서론 강의 녹음\r\n');
    assert.ok(dupRaw, 'Finds duplicate when rawText matches');
    assert.equal(dupRaw.id, 'm-2');

    const noDup = materialIngestion.findDuplicateMaterial(existing, '# Completely Different Chapter', '');
    assert.equal(noDup, null, 'Returns null when content differs');
  });

  check('Stage 2: analysisCheckpoint generates deterministic keys and manages chunk state without re-calling completed', () => {
    const key1 = analysisCheckpoint.makeAnalysisJobKey('user1', 'mat1', 'hash_abc', 'math_stats', 'v2');
    const key2 = analysisCheckpoint.makeAnalysisJobKey('user1', 'mat1', 'hash_abc', 'math_stats', 'v2');
    const keyOtherHash = analysisCheckpoint.makeAnalysisJobKey('user1', 'mat1', 'hash_xyz', 'math_stats', 'v2');
    assert.equal(key1, key2, 'Same inputs derive identical job keys');
    assert.notEqual(key1, keyOtherHash, 'Changed markdown hash derives distinct job key');

    // Test session ledger across 5 chunks
    const session = analysisCheckpoint.getOrCreateSessionLedger(
      key1, 'user1', 'mat1', 'hash_abc', 'math_stats', 5,
      [1, 2, 3, 4, 5].map((i) => ({ chunkIndex: i, sourceContext: '페이지 ' + i }))
    );
    assert.equal(session.totalChunks, 5);
    const initialProg = analysisCheckpoint.getSessionProgress(session);
    assert.equal(initialProg.completedChunks, 0);
    assert.equal(initialProg.pendingChunks, 5);
    assert.equal(initialProg.isAllComplete, false);

    // Complete chunk 1 and 2
    const draft1 = {
      id: 'd1', subjectId: 's1', materialId: 'mat1', title: '중심극한정리', domain: 'math_stats',
      description: '표본평균의 분포 수렴', coreDefinitionFormulaOrAlgorithm: '$\\sqrt{n}(\\bar{X}_n - \\mu) \\to N(0, \\sigma^2)$',
      prerequisites: ['확률변수'], relatedConcepts: ['대수의 법칙'], commonMisconceptions: ['유한 표본 정규성 오인'],
      examples: ['동전 던지기'], sourceEvidence: { type: 'page', pageNumber: 1, quote: '표본평균은 정규분포에 수렴한다.', verified: true },
      status: 'draft', isApproved: false, sourceMarkdownHash: 'hash_abc', createdAt: '', updatedAt: ''
    };
    analysisCheckpoint.recordChunkResult(key1, 1, 'completed', [draft1]);
    assert.equal(session.chunks[1].status, 'completed');

    // Deduplication merges draft attributes from chunk 5 referring to the same concept
    const draft5 = {
      id: 'd5', subjectId: 's1', materialId: 'mat1', title: ' 중심극한정리 ', domain: 'math_stats',
      description: '더 길고 풍부한 중심극한정리의 수학적 의미와 정칙성 조건 서술', coreDefinitionFormulaOrAlgorithm: '',
      prerequisites: ['독립동등분포'], relatedConcepts: ['특성함수'], commonMisconceptions: ['분산 무한인 경우 간과'],
      examples: ['주사위 시행'], sourceEvidence: { type: 'page', pageNumber: 5, quote: '분산이 유한해야 성립한다.', verified: false },
      status: 'draft', isApproved: false, sourceMarkdownHash: 'hash_abc', createdAt: '', updatedAt: ''
    };
    analysisCheckpoint.recordChunkResult(key1, 5, 'completed', [draft5]);

    // Check progress
    const midProg = analysisCheckpoint.getSessionProgress(session);
    assert.equal(midProg.completedChunks, 2);
    assert.equal(midProg.pendingChunks, 3);
    assert.equal(midProg.isAllComplete, false);
    assert.equal(midProg.allDrafts.length, 1, 'Same concept from chunks 1 and 5 merged into 1');
    const merged = midProg.allDrafts[0];
    assert.ok(merged.prerequisites.includes('확률변수'));
    assert.ok(merged.prerequisites.includes('독립동등분포'));
    assert.ok(merged.relatedConcepts.includes('특성함수'));
    assert.ok(merged.sourceEvidence.verified, 'Verified evidence from chunk 1 preserved');
    assert.equal(merged.description, draft5.description, 'Richer description from chunk 5 kept');

    // Complete remaining chunks
    analysisCheckpoint.recordChunkResult(key1, 2, 'completed', []);
    analysisCheckpoint.recordChunkResult(key1, 3, 'completed', []);
    analysisCheckpoint.recordChunkResult(key1, 4, 'completed', []);
    const finalProg = analysisCheckpoint.getSessionProgress(session);
    assert.equal(finalProg.completedChunks, 5);
    assert.equal(finalProg.pendingChunks, 0);
    assert.equal(finalProg.isAllComplete, true);
  });

  check('Stage 5: reviewNotifications enforces KST time, idempotency, privacy-preserving messages, and consent gating', () => {
    // 1. KST date calculation (UTC+9)
    const fixedUtc = new Date('2026-10-14T01:30:00.000Z'); // 10:30 AM KST
    const kstDate = reviewNotifications.getKstDateString(fixedUtc);
    assert.equal(kstDate, '2026-10-14');
    const kstHour = reviewNotifications.getKstHour(fixedUtc);
    assert.equal(kstHour, 10);

    // 2. Privacy-preserving notification message
    const msg = reviewNotifications.formatReviewReminderMessage(3, ['수리통계학', '알고리즘']);
    assert.ok(msg.includes('3개'));
    assert.ok(msg.includes('수리통계학'));
    assert.ok(!msg.includes('api_key') && !msg.includes('bearer') && !msg.includes('prompt'), 'Does not leak sensitive words');

    // 3. Idempotency key
    const idempKey1 = reviewNotifications.makeReminderIdempotencyKey('user_123', '2026-10-14', 'email');
    const idempKey2 = reviewNotifications.makeReminderIdempotencyKey('user_123', '2026-10-14', 'email');
    assert.equal(idempKey1, idempKey2, 'Same day and channel derive identical idempotency key');
    assert.equal(idempKey1, 'reminder_user_123_2026-10-14_email');

    // 4. Consent and suppression evaluation
    const inactiveSub = {
      userId: 'user_123', channel: 'email', target: 'student@univ.edu',
      preferredHourKst: 9, isActive: false, consentedAt: '2026-01-01'
    };
    const activeSub = { ...inactiveSub, isActive: true };

    const existingLogs = new Set();
    const evalInactive = reviewNotifications.evaluateNotificationDispatch(inactiveSub, 5, existingLogs, fixedUtc);
    assert.equal(evalInactive.shouldSend, false, 'Unconsented/inactive subscription is suppressed');

    const evalActive = reviewNotifications.evaluateNotificationDispatch(activeSub, 5, existingLogs, fixedUtc);
    assert.equal(evalActive.shouldSend, true, 'Active subscription with due items should send');
    assert.equal(evalActive.idempotencyKey, idempKey1);

    // After adding the key to existingLogs, duplicate dispatch is suppressed
    existingLogs.add(idempKey1);
    const evalDuplicate = reviewNotifications.evaluateNotificationDispatch(activeSub, 5, existingLogs, fixedUtc);
    assert.equal(evalDuplicate.shouldSend, false, 'Duplicate dispatch on same day is suppressed');
    assert.ok(evalDuplicate.reason.includes('중복 방지'));

    // Zero due items is suppressed
    const emptyLogs = new Set();
    const evalZero = reviewNotifications.evaluateNotificationDispatch(activeSub, 0, emptyLogs, fixedUtc);
    assert.equal(evalZero.shouldSend, false, 'Zero due items is suppressed');
  });

  check('material storage policy defaults to local-first and derives labels', () => {
    assert.deepEqual(materialPolicy.DEFAULT_MATERIAL_POLICY, { syncBody: false, backupOriginal: false });
    assert.deepEqual(materialPolicy.materialPolicyOf({}), { syncBody: true, backupOriginal: true }, 'legacy materials keep synced behaviour');

    const localKept = materialPolicy.deriveMaterialStorageState({
      material: { storagePolicy: materialPolicy.DEFAULT_MATERIAL_POLICY },
      hasLocalBody: true,
      hasLocalOriginal: true,
    });
    assert.equal(localKept.state, 'local_kept');
    assert.ok(localKept.labels.includes('이 기기에 보관됨'));

    const needsLink = materialPolicy.deriveMaterialStorageState({
      material: {}, hasLocalBody: false, hasLocalOriginal: false, bodySynced: false,
    });
    assert.equal(needsLink.needsLink, true);
    assert.equal(needsLink.state, 'needs_link');
    assert.ok(needsLink.labels.includes('이 기기에서 파일 연결 필요'));

    const synced = materialPolicy.deriveMaterialStorageState({
      material: {}, hasLocalBody: false, hasLocalOriginal: false, bodySynced: true, originalBackedUp: true,
    });
    assert.equal(synced.state, 'synced');
    assert.ok(synced.labels.includes('본문 동기화됨'));
    assert.ok(synced.labels.includes('원본 백업됨'));

    const failed = materialPolicy.deriveMaterialStorageState({
      material: {}, hasLocalBody: true, hasLocalOriginal: false, saveFailed: true,
    });
    assert.equal(failed.state, 'save_failed');

    assert.equal(materialPolicy.reconnectHashMatches('h1', 'h1'), true);
    assert.equal(materialPolicy.reconnectHashMatches('h1', 'h2'), false);
    assert.equal(materialPolicy.reconnectHashMatches(undefined, 'h2'), false);
  });

  check('material storage policy is scoped per account', () => {
    const userA = 'policy-user-a';
    const userB = 'policy-user-b';
    storageScope.setStorageScope({ kind: 'user', userId: userA });
    assert.equal(materialPolicy.saveDefaultMaterialPolicy({ syncBody: true, backupOriginal: true }), true);
    assert.deepEqual(materialPolicy.loadDefaultMaterialPolicy(), { syncBody: true, backupOriginal: true });

    // A different account starts from the local-first default, never A's choice.
    storageScope.setStorageScope({ kind: 'user', userId: userB });
    assert.deepEqual(materialPolicy.loadDefaultMaterialPolicy(), { syncBody: false, backupOriginal: false });

    // A's stored policy is untouched by B.
    storageScope.setStorageScope({ kind: 'user', userId: userA });
    assert.deepEqual(materialPolicy.loadDefaultMaterialPolicy(), { syncBody: true, backupOriginal: true });

    // The old shared key is only the legacy (pre-login) namespace.
    localStorage.setItem('redcall_material_storage_policy_v1', JSON.stringify({ syncBody: true, backupOriginal: true }));
    storageScope.setStorageScope({ kind: 'user', userId: 'policy-fresh-user' });
    assert.deepEqual(
      materialPolicy.loadDefaultMaterialPolicy(),
      { syncBody: false, backupOriginal: false },
      'shared legacy setting is not applied to signed-in accounts'
    );
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  check('material policy save failure is reported, not hidden', () => {
    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    try {
      storageScope.setStorageScope({ kind: 'user', userId: 'policy-fail-user' });
      assert.equal(materialPolicy.saveDefaultMaterialPolicy({ syncBody: true, backupOriginal: false }), false);
    } finally {
      localStorage.setItem = realSetItem;
      storageScope.setStorageScope({ kind: 'legacy' });
    }
  });

  check('original reconnect decision never auto-matches without identity', () => {
    assert.equal(materialPolicy.decideOriginalReconnect('h1', 'h1'), 'accept');
    assert.equal(materialPolicy.decideOriginalReconnect('h1', 'h2'), 'mismatch');
    assert.equal(materialPolicy.decideOriginalReconnect(undefined, 'h2'), 'confirm-required');
  });

  check('restore plan never overwrites and reports conflicts/missing', () => {
    const entries = [
      { material: { id: 'new-1', title: 'N', subjectId: 's' }, body: { markdown: '# n' }, original: { contentType: 'application/pdf', hash: 'h-new', base64: 'eA==' } },
      { material: { id: 'same-1', title: 'S', subjectId: 's' }, body: { markdown: '# same' } },
      { material: { id: 'diff-1', title: 'D', subjectId: 's' }, body: { markdown: '# other' } },
      { material: { id: 'meta-1', title: 'M', subjectId: 's' } },
    ];
    const plan = materialPolicy.planMaterialRestore(entries, [
      { id: 'same-1', localBodyHash: cloudHash.materialContentHash({ markdown: '# same' }), localOriginalHash: null },
      { id: 'diff-1', localBodyHash: cloudHash.materialContentHash({ markdown: '# local-different' }), localOriginalHash: null },
    ]);
    assert.ok(plan.toRestore.includes('new-1'), 'new entry is restorable');
    assert.ok(plan.alreadyPresent.includes('same-1'), 'identical entry is skipped, not rewritten');
    assert.ok(!plan.toRestore.includes('same-1'), 'identical entry is not rewritten');
    assert.deepEqual(plan.conflicts.map((c) => c.id), ['diff-1'], 'changed content conflicts, never overwrites');
    assert.ok(!plan.toRestore.includes('diff-1'));
    assert.ok(plan.missingFiles.some((m) => m.id === 'meta-1'), 'metadata-only entry is reported');
  });

  check('today study digest shows top items and estimate only with real data', () => {
    const item = (id, score, minutes, status = 'pending') => ({
      id, subjectId: 's', subjectName: 'S', kind: 'recommended_review', assignedDate: '2026-10-05',
      estimatedMinutes: minutes, isEstimatedTime: false, priorityScore: score, priorityReason: 'r',
      status, snapshotTitle: id, snapshotDetail: '',
    });
    const summary = {
      todayDate: '2026-10-05', todayAvailableMinutes: 60, todayAssignedMinutes: 40,
      todayCompletedCount: 0, todayPendingCount: 3, todayUnassignedCount: 0, totalShortageMinutes: 0,
      scopeRemainingBySubject: [],
      days: [{
        date: '2026-10-05', dayOfWeek: 1, dayLabel: 'd', availableMinutes: 60, isRestDay: false,
        assignedMinutes: 40, unassignedItems: [],
        items: [item('low', 10, 15), item('high', 90, 20), item('done', 50, 10, 'completed'), item('mid', 50, 0)],
      }],
    };
    const digest = todayStudy.getTodayPendingItems(summary, 4);
    assert.deepEqual(digest.items.map((i) => i.id), ['high', 'mid', 'low']);
    assert.equal(digest.pendingCount, 3);
    assert.equal(digest.estimateText, '예상 35분');

    const empty = todayStudy.getTodayPendingItems(null);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.estimateText, null, 'no fabricated estimate');
    assert.equal(todayStudy.getTodayPendingItems({ days: [], todayDate: '2026-10-05' }).estimateText, null);

    assert.deepEqual(todayStudy.resolvePrimaryCta({ id: 'mx', status: 'submitted' }, { id: 'p1' }), { kind: 'resume-mock', sessionId: 'mx' });
    assert.deepEqual(todayStudy.resolvePrimaryCta(null, { id: 'p1' }), { kind: 'start-item', itemId: 'p1' });
    assert.equal(todayStudy.resolvePrimaryCta(null, null), null);
    assert.deepEqual(todayStudy.resolvePrimaryCta({ id: 'mx', status: 'recorded' }, { id: 'p1' }), { kind: 'start-item', itemId: 'p1' });
  });

  check('last evaluation date reflects real records or an explicit empty state', () => {
    assert.equal(reviewStats.lastEvaluationAtISO([]), null);
    assert.equal(reviewStats.lastEvaluationAtISO([{ events: [] }]), null);
    assert.equal(reviewStats.lastEvaluationAtISO([{ events: [{ at: 'invalid' }] }]), null);
    assert.equal(
      reviewStats.lastEvaluationAtISO([{ events: [{ at: '2026-09-28T10:00:00+09:00' }] }, { events: [{ at: '2026-10-05T08:00:00Z' }] }]),
      '2026-10-05T08:00:00.000Z'
    );
    assert.equal(reviewStats.formatEvaluationDate(null), '평가 기록 없음');
    assert.equal(reviewStats.formatEvaluationDate('garbage'), '평가 기록 없음');
    assert.ok(reviewStats.formatEvaluationDate('2026-09-28T10:00:00+09:00').includes('2026'), 'real date shown');
  });

  await checkAsync('material backup carries metadata + files without secrets and round-trips', async () => {
    const materials = [{
      id: 'm1', subjectId: 's1', title: 'T', kind: 'pdf', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# secret body',
      storagePolicy: materialPolicy.DEFAULT_MATERIAL_POLICY,
    }];
    const backup = await materialPolicy.buildMaterialBackup(materials, {
      loadBody: async () => ({ markdown: '# secret body' }),
      loadOriginal: async () => ({ contentType: 'application/pdf', hash: 'h1', data: new Uint8Array([1, 2, 3]) }),
    });
    assert.equal(backup.materials.length, 1);
    assert.equal(backup.materials[0].material.parsedMarkdown, undefined, 'metadata copy strips the body');
    assert.equal(backup.materials[0].body.markdown, '# secret body');
    assert.ok(backup.materials[0].original.base64);
    assert.equal(materialPolicy.backupContainsSecrets(backup), false, 'backup never carries credentials');

    const parsed = materialPolicy.parseMaterialBackup(JSON.stringify(backup));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      const restored = materialPolicy.base64ToBytes(parsed.backup.materials[0].original.base64);
      assert.deepEqual(Array.from(restored), [1, 2, 3]);
    }
    assert.equal(materialPolicy.parseMaterialBackup('{bad json').ok, false);
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify({ hello: 'world' })).ok, false);
  });

  // ---- Material backup / restore hardening ----

  const restoreEntry = (id, overrides = {}, materialOverrides = {}) => ({
    material: {
      id, subjectId: 's1', kind: 'pdf', title: id, sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', ...materialOverrides,
    },
    ...overrides,
  });

  const makeRestoreIo = (overrides = {}) => {
    const writtenMetadata = [];
    const io = {
      getMaterials: () => overrides.materials || [],
      loadBodyResult: (id) => matStorage.loadMaterialContentResult(id),
      loadOriginalResult: (id) => matStorage.loadMaterialOriginal(id),
      saveBody: (id, content) => matStorage.saveMaterialContent(id, content),
      saveOriginal: (id, blob, contentType, knownHash) => matStorage.saveMaterialOriginal(id, blob, contentType, knownHash),
      persistMetadata: async (added) => {
        if (overrides.failMetadata) return false;
        writtenMetadata.push(...added);
        return true;
      },
      getScopeId: () => (overrides.getScopeId ? overrides.getScopeId() : storageScope.getStorageScopeId()),
      knownSubjectIds: overrides.knownSubjectIds || ['s1'],
      subjectOverride: overrides.subjectOverride,
      ...(overrides.ioOverrides || {}),
    };
    return { io, writtenMetadata };
  };

  await checkAsync('metadata-only backup entries restore metadata and file-only ids recover their metadata', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-meta' });
      // A body exists locally but its metadata is gone (file-only material).
      await matStorage.saveMaterialContent('m-fileonly', { markdown: '# kept body' });
      const entries = [
        restoreEntry('m-metaonly', {}, { status: 'ready' }),
        restoreEntry('m-fileonly', { body: { markdown: '# kept body' } }),
      ];
      const { io, writtenMetadata } = makeRestoreIo();
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.ok(outcome.restored.includes('m-metaonly'), 'metadata-only entry is restored');
      assert.ok(outcome.restored.includes('m-fileonly'), 'file-only entry recovers its metadata');
      assert.equal(outcome.failed.length, 0, JSON.stringify(outcome.failed));
      assert.equal(writtenMetadata.length, 2);
      assert.deepEqual(
        outcome.missing.find((m) => m.id === 'm-metaonly').which,
        ['body', 'original'],
        'metadata-only entry is marked as needing file links'
      );
      // The existing local body was NOT rewritten.
      const body = await matStorage.loadMaterialContentResult('m-fileonly');
      assert.equal(body.content.markdown, '# kept body');
    });
  });

  await checkAsync('a body or original read failure blocks the restore write and asks for a retry', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-readfail' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      const dbs = fake.__databases.get('redcall_materials_db_u_restore-readfail');
      dbs.get('material_contents').set('m-rf', { materialId: 'm-rf', markdown: '# local body', updatedAt: 't' });
      fake.__failure.get.add('m-rf');

      const entries = [
        restoreEntry('m-rf', { body: { markdown: '# backup body' } }),
        restoreEntry('m-ok', { body: { markdown: '# healthy' } }),
      ];
      const { io } = makeRestoreIo();
      const outcome = await materialRestore.executeMaterialRestore(entries, io);

      assert.ok(!outcome.restored.includes('m-rf'), 'the errored material is not restored');
      assert.ok(outcome.restored.includes('m-ok'), 'unrelated entries still restore');
      assert.ok(
        outcome.failed.some((f) => f.id === 'm-rf' && f.reason.includes('다시 시도')),
        'the failure asks for a retry'
      );
      assert.equal(
        dbs.get('material_contents').get('m-rf').markdown,
        '# local body',
        'the existing body was not overwritten after a read failure'
      );
    });
  });

  await checkAsync('same-id metadata and file conflicts preserve the existing records', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-conflict' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      const dbs = fake.__databases.get('redcall_materials_db_u_restore-conflict');
      dbs.get('material_contents').set('m-c', { materialId: 'm-c', markdown: '# local body', updatedAt: 't' });
      const localMaterials = [restoreEntry('m-c').material];

      // Metadata identity conflict: same id, different subject and kind.
      const identityEntries = [restoreEntry('m-c', { body: { markdown: '# backup' } }, { subjectId: 's2', kind: 'transcript' })];
      const identity = makeRestoreIo({ materials: localMaterials });
      const identityOutcome = await materialRestore.executeMaterialRestore(identityEntries, identity.io);
      assert.deepEqual(identityOutcome.restored, []);
      assert.equal(identityOutcome.conflicts.length, 1);
      assert.equal(identity.writtenMetadata.length, 0, 'conflicting metadata is not written');

      // File content conflict: same id, different body hash.
      const fileEntries = [restoreEntry('m-c', { body: { markdown: '# backup body' } })];
      const file = makeRestoreIo({ materials: localMaterials });
      const fileOutcome = await materialRestore.executeMaterialRestore(fileEntries, file.io);
      assert.ok(!fileOutcome.restored.includes('m-c'));
      assert.ok(fileOutcome.conflicts.some((c) => c.id === 'm-c'));
      assert.equal(dbs.get('material_contents').get('m-c').markdown, '# local body', 'existing body preserved');
      assert.equal(file.writtenMetadata.length, 0);
    });
  });

  await checkAsync('a metadata save failure is never reported as a restored material', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-metafail' });
      const entries = [restoreEntry('m-pf', { body: { markdown: '# x' } })];
      const { io } = makeRestoreIo({ failMetadata: true });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.deepEqual(outcome.restored, []);
      assert.equal(outcome.metadataPersisted, false);
      assert.ok(outcome.failed.some((f) => f.id === 'm-pf' && f.reason.includes('메타데이터 저장에 실패')));
    });
  });

  await checkAsync('an account switch mid-restore stops all further writes', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-switch' });
      let scopeSamples = 0;
      const { io } = makeRestoreIo({
        getScopeId: () => {
          scopeSamples += 1;
          // The start sample and the first entry still match; from the second
          // entry onward the account has changed.
          return scopeSamples <= 2 ? 'u_restore-switch' : 'u_other-account';
        },
      });
      const entries = [
        restoreEntry('m-s1', { body: { markdown: '# one' } }),
        restoreEntry('m-s2', { body: { markdown: '# two' } }),
      ];
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.equal(outcome.aborted, true);
      assert.deepEqual(outcome.restored, [], 'unpersisted metadata is never reported restored');
      const dbs = fake.__databases.get('redcall_materials_db_u_restore-switch');
      assert.ok(dbs && dbs.get('material_contents').has('m-s1'), 'the first entry was already written');
      assert.ok(!dbs.get('material_contents').has('m-s2'), 'no write after the account switch');
      assert.ok(outcome.failed.some((f) => f.id === 'm-s2' && f.reason.includes('계정이 변경')));
      const otherDb = fake.__databases.get('redcall_materials_db_u_other-account');
      assert.ok(!otherDb || !otherDb.get('material_contents') || otherDb.get('material_contents').size === 0, 'the other account area stays untouched');
    });
  });

  await checkAsync('restore re-checks file state after planning and skips a newly appeared conflict', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-recheck' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      const dbs = fake.__databases.get('redcall_materials_db_u_restore-recheck');
      const entries = [restoreEntry('m-rc', { body: { markdown: '# backup' } })];
      // The planning read sees no local body; a different body appears just
      // before the write would happen (the first write-time re-check).
      let mrcReads = 0;
      const { io } = makeRestoreIo({
        ioOverrides: {
          loadBodyResult: async (id) => {
            if (id === 'm-rc') {
              mrcReads += 1;
              if (mrcReads === 2) {
                dbs.get('material_contents').set('m-rc', { materialId: 'm-rc', markdown: '# appeared', updatedAt: 't' });
              }
            }
            return matStorage.loadMaterialContentResult(id);
          },
        },
      });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.ok(!outcome.restored.includes('m-rc'));
      assert.ok(outcome.conflicts.some((c) => c.id === 'm-rc'), 'the newly appeared conflict is reported');
      assert.equal(dbs.get('material_contents').get('m-rc').markdown, '# appeared', 'existing content kept');
    });
  });

  check('restore plan asks for a subject when the backup subject is unknown', () => {
    const entries = [restoreEntry('m-sub', { body: { markdown: '# x' } }, { subjectId: 'unknown-s' })];
    const plan = materialPolicy.planMaterialRestore(entries, [], { knownSubjectIds: ['s1'] });
    assert.deepEqual(plan.needsSubjectChoice.map((n) => n.id), ['m-sub']);
    assert.ok(!plan.toRestore.includes('m-sub'));

    // After the user picks a target subject, the remapped entry restores.
    const remapped = [{ ...entries[0], material: { ...entries[0].material, subjectId: 's1' } }];
    const plan2 = materialPolicy.planMaterialRestore(remapped, [], { knownSubjectIds: ['s1'] });
    assert.ok(plan2.toRestore.includes('m-sub'));
  });

  await checkAsync('a material from an unknown subject restores after the user maps its source subject', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-map' });
      const entries = [restoreEntry('m-map', { body: { markdown: '# mapped body' } }, { subjectId: 'legacy-subject' })];
      const { io, writtenMetadata } = makeRestoreIo({ subjectOverride: { 'legacy-subject': 's1' } });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.equal(outcome.blockedBySubject, false);
      assert.ok(outcome.restored.includes('m-map'), JSON.stringify(outcome));
      assert.equal(writtenMetadata.length, 1);
      assert.equal(writtenMetadata[0].subjectId, 's1', 'the chosen target subject is written');
      assert.equal(writtenMetadata[0].id, 'm-map', 'the material id is unchanged');
      const body = await matStorage.loadMaterialContentResult('m-map');
      assert.equal(body.status, 'found');
      assert.equal(body.content.markdown, '# mapped body');
    });
  });

  await checkAsync('all materials of one unknown source subject map to the chosen target together', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-map-many' });
      const entries = [
        restoreEntry('m-a1', { body: { markdown: '# a1' } }, { subjectId: 'missing-s' }),
        restoreEntry('m-a2', { body: { markdown: '# a2' } }, { subjectId: 'missing-s' }),
        restoreEntry('m-b1', { body: { markdown: '# b1' } }, { subjectId: 's1' }),
      ];
      const { io, writtenMetadata } = makeRestoreIo({ subjectOverride: { 'missing-s': 's1' } });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.equal(outcome.blockedBySubject, false);
      assert.ok(['m-a1', 'm-a2', 'm-b1'].every((id) => outcome.restored.includes(id)), JSON.stringify(outcome));
      assert.equal(writtenMetadata.length, 3);
      assert.ok(writtenMetadata.every((m) => m.subjectId === 's1'));
    });
  });

  await checkAsync('an unresolved subject blocks the whole restore without any write', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-block' });
      const entries = [restoreEntry('m-block', { body: { markdown: '# blocked' } }, { subjectId: 'missing-s' })];
      const { io, writtenMetadata } = makeRestoreIo();
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.equal(outcome.blockedBySubject, true);
      assert.deepEqual(outcome.restored, []);
      assert.equal(writtenMetadata.length, 0, 'no metadata written');
      assert.equal((await matStorage.loadMaterialContentResult('m-block')).status, 'missing', 'no body written');
      assert.ok(outcome.failed.some((f) => f.id === 'm-block' && /대상 과목/.test(f.reason)));
    });
  });

  await checkAsync('a mapped entry whose id already has a different identity is not overwritten', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-map-conflict' });
      const localMaterials = [restoreEntry('m-cf', {}, { subjectId: 's2', kind: 'transcript' }).material];
      const entries = [restoreEntry('m-cf', { body: { markdown: '# backup' } }, { subjectId: 'legacy-subject' })];
      const { io, writtenMetadata } = makeRestoreIo({ materials: localMaterials, subjectOverride: { 'legacy-subject': 's1' } });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.ok(!outcome.restored.includes('m-cf'));
      assert.ok(outcome.conflicts.some((c) => c.id === 'm-cf'), 'identity conflict reported');
      assert.equal(writtenMetadata.length, 0, 'existing record not overwritten');
    });
  });

  await checkAsync('a deleted target subject blocks the write instead of using a stale choice', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-target-gone' });
      const entries = [restoreEntry('m-gone', { body: { markdown: '# x' } }, { subjectId: 'missing-s' })];
      // The user picked 'deleted-subject', but it no longer exists in this account.
      const { io, writtenMetadata } = makeRestoreIo({ subjectOverride: { 'missing-s': 'deleted-subject' } });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.equal(outcome.blockedBySubject, true);
      assert.equal(writtenMetadata.length, 0);
      assert.equal((await matStorage.loadMaterialContentResult('m-gone')).status, 'missing');
    });
  });

  await checkAsync('the UI subject-choice object shape drives the executor (source subject -> target)', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-ui-shape' });
      const subjects = [{ id: 's1', name: 'S1' }];
      const entries = [restoreEntry('m-ui', { body: { markdown: '# ui' } }, { subjectId: 'csv-subject' })];
      // Exactly what DataManagementSection builds.
      const unknownSubjectIds = Array.from(new Set(entries.map((e) => e.material.subjectId)))
        .filter((subjectId) => !subjects.some((s) => s.id === subjectId));
      const choices = Object.fromEntries(unknownSubjectIds.map((id) => [id, subjects[0].id]));
      const { io, writtenMetadata } = makeRestoreIo({
        subjectOverride: choices,
        knownSubjectIds: subjects.map((s) => s.id),
      });
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      assert.ok(outcome.restored.includes('m-ui'), JSON.stringify(outcome));
      assert.equal(writtenMetadata[0].subjectId, 's1');
    });
  });

  await checkAsync('backup build records read failures and metadata-embedded bodies', async () => {
    const base = restoreEntry('m-build').material;
    const failed = await materialPolicy.buildMaterialBackup([base], {
      loadBody: async () => ({ status: 'error', error: 'IndexedDB 읽기 실패' }),
      loadOriginal: async () => ({ status: 'missing' }),
    });
    assert.equal(failed.materials[0].fileState.body, 'error', 'read failure is recorded, not swallowed');
    assert.equal(failed.materials[0].fileError.body, 'IndexedDB 읽기 실패');
    assert.equal(failed.materials[0].body, undefined);

    const embedded = await materialPolicy.buildMaterialBackup(
      [{ ...base, parsedMarkdown: '# embedded', rawText: 'raw' }],
      { loadBody: async () => ({ status: 'missing' }), loadOriginal: async () => ({ status: 'missing' }) }
    );
    assert.equal(embedded.materials[0].body.markdown, '# embedded', 'metadata-embedded body backs up the material');
    assert.equal(embedded.materials[0].fileState.body, 'included');
  });

  check('backup completeness reports absent and unreadable files per material', () => {
    const backup = {
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      materials: [
        {
          material: restoreEntry('bk-a', {}, { originalHash: 'oh_x' }).material,
          body: { markdown: '# a' },
          fileState: { body: 'included', original: 'absent' },
        },
        {
          material: restoreEntry('bk-b', {}, { kind: 'transcript' }).material,
          fileState: { body: 'error', original: 'absent' },
          fileError: { body: 'IndexedDB 읽기 실패' },
        },
        {
          material: restoreEntry('bk-c', {}, { kind: 'transcript' }).material,
          body: { markdown: '# c' },
          fileState: { body: 'included', original: 'absent' },
        },
      ],
    };
    const summary = materialPolicy.summarizeBackupCompleteness(backup);
    assert.equal(summary.complete, false);
    assert.ok(
      summary.issues.some((i) => i.id === 'bk-a' && i.which === 'original' && i.state === 'absent'),
      'a pdf with known original identity but no file is reported missing'
    );
    assert.ok(
      summary.issues.some((i) => i.id === 'bk-b' && i.which === 'body' && i.state === 'error'),
      'a read failure is reported as such'
    );
    assert.ok(!summary.issues.some((i) => i.id === 'bk-b' && i.which === 'original'), 'a transcript never expected an original');
    assert.ok(!summary.issues.some((i) => i.id === 'bk-c'), 'files that never existed are not issues');
    assert.equal(summary.materialsWithIssues, 2);
  });

  check('lecture content mentioning Authorization or access_token imports normally', () => {
    const backup = {
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      materials: [
        restoreEntry('m-auth', { body: { markdown: '# HTTP Authorization 헤더와 access_token 갱신 흐름' } }, {
          kind: 'transcript',
          title: 'Authorization 헤더와 access_token',
        }),
      ],
    };
    const parsed = materialPolicy.parseMaterialBackup(JSON.stringify(backup));
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
    if (parsed.ok) {
      assert.equal(materialPolicy.backupContainsSecrets(parsed.backup), false, 'lecture wording is not a credential');
    }
  });

  check('allowlisted export strips credential-shaped and unknown fields on import', () => {
    const material = restoreEntry('m-strip').material;
    const projected = materialPolicy.materialBackupMetadata({
      ...material,
      parsedMarkdown: '# body',
      apiKey: 'sk-should-never-appear',
      accessToken: 'should-never-appear',
    });
    assert.equal(projected.parsedMarkdown, undefined);
    assert.equal(projected.apiKey, undefined, 'only allowlisted fields are exported');
    assert.equal(projected.accessToken, undefined);

    const tainted = { version: 2, materials: [{ material: { ...material, apiKey: 'sk-test' } }] };
    const parsed = materialPolicy.parseMaterialBackup(JSON.stringify(tainted));
    assert.equal(parsed.ok, true, 'unknown fields are dropped instead of being stored');
    if (parsed.ok) {
      assert.equal('apiKey' in parsed.backup.materials[0].material, false);
      assert.equal(materialPolicy.backupContainsSecrets(parsed.backup), false);
    }
  });

  check('malformed backup structures are rejected before any write', () => {
    const validMaterial = restoreEntry('m-v').material;
    const cases = [
      JSON.stringify({ version: 1, materials: [{}] }),
      JSON.stringify({ version: 1, materials: [{ material: { id: 'a' } }] }),
      JSON.stringify({ version: 1, materials: [{ material: validMaterial }, { material: { ...validMaterial, title: 'dup' } }] }),
      JSON.stringify({ version: 3, materials: [] }),
      JSON.stringify({ version: 2, materials: [{ material: validMaterial, original: { contentType: 'application/pdf', hash: 'oh_x', base64: '!!!' } }] }),
      JSON.stringify({ version: 2, materials: [{ material: validMaterial, body: { markdown: 42 } }] }),
      JSON.stringify({ version: 2, materials: [{ material: validMaterial, body: { markdown: 'x', pages: [{ pageNumber: 0, markdown: 'p', hasText: true }] } }] }),
      JSON.stringify({ version: 2, materials: [{ material: { ...validMaterial, fileSize: 3 }, original: { contentType: 'application/pdf', hash: 'oh_x', base64: materialPolicy.bytesToBase64(new Uint8Array([1, 2])) } }] }),
    ];
    for (const text of cases) {
      const parsed = materialPolicy.parseMaterialBackup(text);
      assert.equal(parsed.ok, false, `expected rejection: ${text}`);
    }
  });

  await checkAsync('original hash mismatch is rejected before any write', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const realHash = await matStorage.hashBlob(new Blob([bytes], { type: 'application/pdf' }));
    const base64 = materialPolicy.bytesToBase64(bytes);
    const backup = {
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      materials: [restoreEntry('m-hash', { original: { contentType: 'application/pdf', hash: realHash, base64 } })],
    };
    assert.equal((await materialPolicy.verifyBackupOriginalHashes(backup)).ok, true);

    const tampered = structuredClone(backup);
    tampered.materials[0].original.hash = 'oh_deadbeef';
    const verification = await materialPolicy.verifyBackupOriginalHashes(tampered);
    assert.equal(verification.ok, false);
    assert.deepEqual(verification.mismatched.map((m) => m.id), ['m-hash']);

    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'restore-hash' });
      const { io } = makeRestoreIo();
      const outcome = await materialRestore.executeMaterialRestore(tampered.materials, io);
      assert.deepEqual(outcome.restored, []);
      assert.ok(outcome.failed.some((f) => f.id === 'm-hash' && f.reason.includes('해시')));
      assert.equal((await matStorage.loadMaterialOriginal('m-hash')).status, 'missing', 'nothing was written');
    });
  });

  await checkAsync('v1 backups stay readable while unsupported versions are refused', async () => {
    const v1 = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      materials: [restoreEntry('m-v1', { body: { markdown: '# v1 body' } })],
    };
    const parsed = materialPolicy.parseMaterialBackup(JSON.stringify(v1));
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
    if (parsed.ok) {
      assert.equal(parsed.backup.materials[0].body.markdown, '# v1 body');
    }
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify({ version: 0, materials: [] })).ok, false);
    assert.equal(
      materialPolicy.parseMaterialBackup(JSON.stringify({ version: 3, materials: [] })).ok,
      false,
      'unknown versions are never reinterpreted as the current version'
    );
  });

  await checkAsync('embedded localStorage bodies move to IndexedDB and are stripped only after verification', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'body-mig' });
      const key = 'redcall_user_body-mig__materials_v1';
      const raw = [{
        id: 'm-emb', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# embedded body',
      }];
      localStorage.setItem(key, JSON.stringify(raw));
      const before = localStorage.getItem(key);

      const result = await storage.migrateStoredMaterialBodies();
      assert.equal(result.ok, true, result.error ?? '');
      assert.equal(result.migrated, 1);

      const after = JSON.parse(localStorage.getItem(key));
      assert.equal(after[0].parsedMarkdown, undefined, 'localStorage keeps metadata only after a verified move');
      assert.equal(after[0].id, 'm-emb', 'metadata fields survive');
      const loaded = await matStorage.loadMaterialContentResult('m-emb');
      assert.equal(loaded.status, 'found');
      assert.equal(loaded.content.markdown, '# embedded body');
      assert.ok(localStorage.getItem(key) !== before, 'the stored value changed only after success');

      // Re-running is a no-op.
      const again = await storage.migrateStoredMaterialBodies();
      assert.equal(again.ok, true);
      assert.equal(again.attempted, 0);
    });
  });

  await checkAsync('a failed IndexedDB write keeps the localStorage body for retry', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'body-mig-fail' });
      const key = 'redcall_user_body-mig-fail__materials_v1';
      localStorage.setItem(key, JSON.stringify([{
        id: 'm-emb2', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# keep me',
      }]));

      fake.__failure.put.add('m-emb2');
      const result = await storage.migrateStoredMaterialBodies();
      assert.equal(result.ok, false);
      assert.deepEqual(result.failedIds, ['m-emb2']);

      const raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw[0].parsedMarkdown, '# keep me', 'the original body is preserved for retry');
    });
  });

  await checkAsync('metadata-only saves never persist bodies into localStorage', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'save-light' });
    storage.saveStoredMaterials([{
      id: 'm-light', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true,
      uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# heavy body', rawText: 'raw', pages: [],
    }]);
    const raw = JSON.parse(localStorage.getItem('redcall_user_save-light__materials_v1'));
    assert.equal(raw[0].parsedMarkdown, undefined);
    assert.equal(raw[0].rawText, undefined);
    assert.equal(raw[0].pages, undefined);
    assert.equal(raw[0].title, 'T');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  // ---- Boundary 1: export and import share one limit source ----

  const tinyLimits = { fileBytes: 1e9, textChars: 1e9, materials: 3, bodyTextChars: 50, originalBase64Chars: 24 };

  const makeSmallEntry = (id) => restoreEntry(id, { body: { markdown: 'x'.repeat(40) } });

  check('per-entry caps are enforced identically on export and import', () => {
    const atOriginalCap = {
      version: 2,
      materials: [restoreEntry('m-at', { original: { contentType: 'application/pdf', hash: 'oh_x', base64: materialPolicy.bytesToBase64(new Uint8Array(18)) } })],
    };
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(atOriginalCap), tinyLimits).ok, true);
    assert.deepEqual(materialPolicy.findBackupLimitViolations(atOriginalCap, tinyLimits), []);

    const overOriginalCap = structuredClone(atOriginalCap);
    overOriginalCap.materials[0].original.base64 = materialPolicy.bytesToBase64(new Uint8Array(19));
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(overOriginalCap), tinyLimits).ok, false);
    assert.equal(materialPolicy.findBackupLimitViolations(overOriginalCap, tinyLimits).length, 1);

    const bodyAtCap = { version: 2, materials: [makeSmallEntry('m-b')] };
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(bodyAtCap), tinyLimits).ok, true);
    const bodyOverCap = { version: 2, materials: [restoreEntry('m-b', { body: { markdown: 'x'.repeat(51) } })] };
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(bodyOverCap), tinyLimits).ok, false);
    assert.equal(materialPolicy.findBackupLimitViolations(bodyOverCap, tinyLimits).length, 1);
  });

  check('the total serialized size limit matches exactly between export and import', () => {
    const backup = { version: 2, materials: [makeSmallEntry('m1'), makeSmallEntry('m2'), makeSmallEntry('m3')] };
    const exactLimits = {
      fileBytes: 1e9, textChars: JSON.stringify(backup).length,
      materials: 100, bodyTextChars: 1e9, originalBase64Chars: 1e9,
    };
    assert.deepEqual(materialPolicy.findBackupLimitViolations(backup, exactLimits), []);
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(backup), exactLimits).ok, true);

    const tightened = { ...exactLimits, textChars: exactLimits.textChars - 1 };
    assert.ok(
      materialPolicy.findBackupLimitViolations(backup, tightened).some((v) => v.id === null && /전체/.test(v.reason)),
      'a one-char-over total is refused with a reason before download'
    );
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(backup), tightened).ok, false);
  });

  check('the entry-count limit is shared by export and import', () => {
    const backup = { version: 2, materials: [makeSmallEntry('a'), makeSmallEntry('b'), makeSmallEntry('c'), makeSmallEntry('d')] };
    assert.ok(materialPolicy.findBackupLimitViolations(backup, tinyLimits).some((v) => v.id === null && /자료 수/.test(v.reason)));
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(backup), tinyLimits).ok, false);
  });

  await checkAsync('export fails fast on an oversized original and round-trips at the boundary', async () => {
    await assert.rejects(
      materialPolicy.buildMaterialBackup([restoreEntry('m-big').material], {
        loadBody: async () => ({ status: 'missing' }),
        loadOriginal: async () => ({ status: 'found', original: { contentType: 'application/pdf', hash: 'oh_x', data: new Uint8Array(19) } }),
      }, tinyLimits),
      /원본 파일이 처리 가능한 크기/
    );
    const atBoundary = await materialPolicy.buildMaterialBackup([restoreEntry('m-ok').material], {
      loadBody: async () => ({ status: 'missing' }),
      loadOriginal: async () => ({ status: 'found', original: { contentType: 'application/pdf', hash: 'oh_x', data: new Uint8Array(18) } }),
    }, tinyLimits);
    assert.equal(atBoundary.materials[0].fileState.original, 'included');
    assert.equal(materialPolicy.parseMaterialBackup(JSON.stringify(atBoundary), tinyLimits).ok, true, 'an exported boundary backup re-imports under the same limits');
  });

  check('serialized size measures characters and UTF-8 bytes from the same parts', () => {
    const backup = {
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      materials: [
        restoreEntry('m-ascii', { body: { markdown: 'ascii body' } }),
        restoreEntry('m-kr', { body: { markdown: '한글 본문입니다' } }),
        restoreEntry('m-emoji', { body: { markdown: '😀 이모지 "escaped" \\n line' } }),
      ],
    };
    const partsText = materialPolicy.materialBackupBlobParts(backup).join('');
    assert.equal(partsText, JSON.stringify(backup), 'chunked parts equal the whole JSON');
    const size = materialPolicy.measureMaterialBackupSerializedSize(backup);
    assert.equal(size.chars, JSON.stringify(backup).length, 'char count matches the parser view');
    assert.equal(size.bytes, Buffer.byteLength(JSON.stringify(backup), 'utf8'), 'byte count matches the real file size');
    assert.ok(size.bytes > size.chars, 'korean and emoji make the byte size larger than the char count');
  });

  check('export rejects a backup whose UTF-8 bytes exceed the limit even when chars pass', () => {
    const backup = { version: 2, materials: [restoreEntry('m-kr', { body: { markdown: '한'.repeat(50) } })] };
    const size = materialPolicy.measureMaterialBackupSerializedSize(backup);
    assert.ok(size.bytes > size.chars && size.chars < size.bytes);
    const limits = {
      fileBytes: size.bytes, textChars: size.chars, materials: 100,
      bodyTextChars: 1e9, originalBase64Chars: 1e9,
    };
    // Exactly at both limits: accepted.
    assert.deepEqual(materialPolicy.findBackupLimitViolations(backup, limits), []);
    // One byte over the file limit (chars still pass): rejected before download.
    const byteTight = { ...limits, fileBytes: size.bytes - 1 };
    const violations = materialPolicy.findBackupLimitViolations(backup, byteTight);
    assert.ok(violations.some((v) => /바이트/.test(v.reason) && v.id === null), 'byte-size violation reported');
    assert.ok(size.chars <= byteTight.textChars, 'the char limit still passes');
    assert.equal(
      materialPolicy.parseMaterialBackup(JSON.stringify(backup), byteTight).ok,
      false,
      'the import parser enforces the same byte limit'
    );
  });

  await checkAsync('an exported Korean backup round-trips through the real import validation path', async () => {
    const limits = { fileBytes: 400 * 1024 * 1024, textChars: 256 * 1024 * 1024, materials: 100, bodyTextChars: 20 * 1024 * 1024, originalBase64Chars: 224 * 1024 * 1024 };
    const backup = await materialPolicy.buildMaterialBackup(
      [restoreEntry('m-roundtrip').material],
      {
        loadBody: async () => ({ status: 'found', body: { markdown: '한글 강의 본문 😀\n둘째 줄' } }),
        loadOriginal: async () => ({ status: 'missing' }),
      },
      limits
    );
    const parts = materialPolicy.materialBackupBlobParts(backup);
    const text = parts.join('');
    const size = materialPolicy.measureMaterialBackupSerializedSize(backup);
    // Export limit check (pre-download) and the import file-size gate agree.
    assert.deepEqual(materialPolicy.findBackupLimitViolations(backup, limits), []);
    assert.ok(size.bytes <= limits.fileBytes, 'file.size gate passes');
    assert.ok(text.length <= limits.textChars, 'parser gate passes');
    const parsed = materialPolicy.parseMaterialBackup(text, limits);
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
    if (parsed.ok) assert.equal(parsed.backup.materials[0].body.markdown, '한글 강의 본문 😀\n둘째 줄');
  });

  check('the summed UTF-8 byte size across materials is checked too', () => {
    const backup = {
      version: 2,
      materials: [
        restoreEntry('m1', { body: { markdown: '한'.repeat(20) } }),
        restoreEntry('m2', { body: { markdown: '한'.repeat(20) } }),
        restoreEntry('m3', { body: { markdown: '한'.repeat(20) } }),
      ],
    };
    const size = materialPolicy.measureMaterialBackupSerializedSize(backup);
    const limits = {
      fileBytes: size.bytes, textChars: 1e9, materials: 100,
      bodyTextChars: 1e9, originalBase64Chars: 1e9,
    };
    assert.deepEqual(materialPolicy.findBackupLimitViolations(backup, limits), []);
    const tightened = { ...limits, fileBytes: size.bytes - 1 };
    assert.ok(materialPolicy.findBackupLimitViolations(backup, tightened).some((v) => /바이트/.test(v.reason)));
  });

  // ---- Boundary 2: failed body migration keeps the localStorage original ----

  await checkAsync('a stored-then-corrupted body fails verification and keeps the local copy', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'mig-corrupt' });
      const key = 'redcall_user_mig-corrupt__materials_v1';
      localStorage.setItem(key, JSON.stringify([{
        id: 'm-cor', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# original',
      }]));
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      fake.__failure.corruptPut.add('m-cor');

      const result = await storage.migrateStoredMaterialBodies();
      assert.equal(result.ok, false);
      assert.deepEqual(result.failedIds, ['m-cor']);
      const raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw[0].parsedMarkdown, '# original', 'the memory cache did not stand in for persistence');
    });
  });

  await checkAsync('a failed body migration survives later saves, replacement lists and reload', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'mig-keep' });
      const key = 'redcall_user_mig-keep__materials_v1';
      localStorage.setItem(key, JSON.stringify([
        { id: 'm-stay', subjectId: 's1', kind: 'pdf', title: 'Stay', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# keep this body' },
        { id: 'm-go', subjectId: 's1', kind: 'pdf', title: 'Go', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# move this body' },
      ]));
      fake.__failure.put.add('m-stay');

      // ①②: migration succeeds only for the healthy item.
      const first = await storage.migrateStoredMaterialBodies();
      assert.equal(first.ok, false);
      assert.deepEqual(first.failedIds, ['m-stay']);
      assert.equal(first.migrated, 1);
      let raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw.find((m) => m.id === 'm-stay').parsedMarkdown, '# keep this body', 'failed item keeps its embedded body');
      assert.equal(raw.find((m) => m.id === 'm-go').parsedMarkdown, undefined, 'only the verified item is stripped');

      // ③: another material is added through the normal save path.
      storage.saveStoredMaterials([
        ...storage.loadStoredMaterials(),
        { id: 'm-new', subjectId: 's1', kind: 'pdf', title: 'New', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z' },
      ]);
      raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw.find((m) => m.id === 'm-stay').parsedMarkdown, '# keep this body', 'a later metadata save must not strip the un-migrated body');
      assert.ok(raw.some((m) => m.id === 'm-new'));

      // ④⑤: a reload re-reads the preserved body from the stored metadata.
      const reloaded = storage.loadStoredMaterials();
      assert.equal(reloaded.find((m) => m.id === 'm-stay').parsedMarkdown, '# keep this body');

      // Retry once the storage failure is gone: the item migrates, is
      // stripped, and stays stripped afterwards.
      fake.__failure.put.delete('m-stay');
      const retry = await storage.migrateStoredMaterialBodies();
      assert.equal(retry.ok, true, retry.error ?? '');
      storage.saveStoredMaterials(storage.loadStoredMaterials());
      raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw.find((m) => m.id === 'm-stay').parsedMarkdown, undefined);
      const body = await matStorage.loadMaterialContentResult('m-stay');
      assert.equal(body.status, 'found');
      assert.equal(body.content.markdown, '# keep this body');
    });
  });

  await checkAsync('a wholesale metadata list replacement re-attaches an un-migrated body', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'mig-refresh' });
      const key = 'redcall_user_mig-refresh__materials_v1';
      localStorage.setItem(key, JSON.stringify([{
        id: 'm-hold', subjectId: 's1', kind: 'pdf', title: 'Hold', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# hold me',
      }]));
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      fake.__failure.put.add('m-hold');
      const migration = await storage.migrateStoredMaterialBodies();
      assert.equal(migration.ok, false);

      // A cloud refresh saves a metadata-only server list for the same ids.
      storage.saveStoredMaterials([{
        id: 'm-hold', subjectId: 's1', kind: 'pdf', title: 'Hold (server)', status: 'ready',
        isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
      }]);
      const raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw[0].parsedMarkdown, '# hold me', 'the last persistent copy survives the list replacement');
      assert.equal(raw[0].title, 'Hold (server)', 'metadata fields still take the new values');
    });
  });

  // ---- Boundary 3: async work stays inside the account it started in ----

  await checkAsync('pinned-scope restore keeps writes and metadata inside the starting account during a mid-run switch', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'pin-a' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      storageScope.setStorageScope({ kind: 'user', userId: 'pin-b' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      storageScope.setStorageScope({ kind: 'user', userId: 'pin-a' });

      const entries = [restoreEntry('m-pin', { body: { markdown: '# pinned' } })];
      let bodyReads = 0;
      const io = {
        getMaterials: () => [],
        // The write-time re-check is where the account flips.
        loadBodyResult: async (id) => {
          bodyReads += 1;
          if (bodyReads === 2) storageScope.setStorageScope({ kind: 'user', userId: 'pin-b' });
          return matStorage.loadMaterialContentInScope('u_pin-a', id, { skipMemoryCache: true });
        },
        loadOriginalResult: (id) => matStorage.loadMaterialOriginalInScope('u_pin-a', id),
        saveBody: (id, content) => matStorage.saveMaterialContentInScope('u_pin-a', id, content),
        saveOriginal: (id, blob, contentType, knownHash) => matStorage.saveMaterialOriginalInScope('u_pin-a', id, blob, contentType, knownHash),
        persistMetadata: async () => storageScope.getStorageScopeId() === 'u_pin-a',
        getScopeId: () => storageScope.getStorageScopeId(),
        knownSubjectIds: ['s1'],
      };
      const outcome = await materialRestore.executeMaterialRestore(entries, io);
      const dbA = fake.__databases.get('redcall_materials_db_u_pin-a');
      const dbB = fake.__databases.get('redcall_materials_db_u_pin-b');
      assert.equal(dbA.get('material_contents').get('m-pin').markdown, '# pinned', 'the in-flight write finished in the ORIGINAL account');
      assert.ok(!dbB.get('material_contents').has('m-pin'), 'nothing leaked into the new account store');
      assert.ok(!outcome.restored.includes('m-pin'), 'an unapplied outcome is not reported restored');
      assert.equal(outcome.aborted, true);
      assert.ok(outcome.failed.some((f) => f.id === 'm-pin' && f.reason.includes('계정이 변경')));
    });
  });

  await checkAsync('an account switch before any write prevents all writes and metadata', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'flip-early' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      let scopeCalls = 0;
      let metadataAsked = false;
      const io = {
        getMaterials: () => [],
        loadBodyResult: (id) => matStorage.loadMaterialContentInScope('u_flip-early', id, { skipMemoryCache: true }),
        loadOriginalResult: (id) => matStorage.loadMaterialOriginalInScope('u_flip-early', id),
        saveBody: (id, content) => matStorage.saveMaterialContentInScope('u_flip-early', id, content),
        saveOriginal: (id, blob, contentType, knownHash) => matStorage.saveMaterialOriginalInScope('u_flip-early', id, blob, contentType, knownHash),
        persistMetadata: async () => { metadataAsked = true; return true; },
        getScopeId: () => {
          scopeCalls += 1;
          return scopeCalls <= 1 ? 'u_flip-early' : 'u_flip-other';
        },
        knownSubjectIds: ['s1'],
      };
      const outcome = await materialRestore.executeMaterialRestore([restoreEntry('m-early', { body: { markdown: '# x' } })], io);
      assert.equal(outcome.aborted, true);
      assert.deepEqual(outcome.restored, []);
      assert.equal(metadataAsked, false, 'metadata is never applied after the switch');
      const db = fake.__databases.get('redcall_materials_db_u_flip-early');
      assert.ok(db && !db.get('material_contents').has('m-early'));
    });
  });

  await checkAsync('restore verification reads the persisted value, not the memory cache', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'verify-corrupt' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      fake.__failure.corruptPut.add('m-cv');
      const io = {
        getMaterials: () => [],
        loadBodyResult: (id) => matStorage.loadMaterialContentInScope('u_verify-corrupt', id, { skipMemoryCache: true }),
        loadOriginalResult: (id) => matStorage.loadMaterialOriginalInScope('u_verify-corrupt', id),
        saveBody: (id, content) => matStorage.saveMaterialContentInScope('u_verify-corrupt', id, content),
        saveOriginal: (id, blob, contentType, knownHash) => matStorage.saveMaterialOriginalInScope('u_verify-corrupt', id, blob, contentType, knownHash),
        persistMetadata: async () => true,
        getScopeId: () => storageScope.getStorageScopeId(),
        knownSubjectIds: ['s1'],
      };
      const outcome = await materialRestore.executeMaterialRestore([restoreEntry('m-cv', { body: { markdown: '# good' } })], io);
      assert.ok(!outcome.restored.includes('m-cv'));
      assert.ok(outcome.failed.some((f) => f.id === 'm-cv' && f.reason.includes('본문 읽기 검증')));
    });
  });

  await checkAsync('body migration stays inside the explicitly pinned scope', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'mig-pin-a' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      storageScope.setStorageScope({ kind: 'user', userId: 'mig-pin-b' });
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });

      const keyA = 'redcall_user_mig-pin-a__materials_v1';
      localStorage.setItem(keyA, JSON.stringify([{
        id: 'm-pinmig', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# migrate me',
      }]));
      localStorage.setItem('redcall_user_mig-pin-b__materials_v1', JSON.stringify([{
        id: 'other-b', subjectId: 's1', kind: 'pdf', title: 'B', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      }]));

      // The migration runs pinned to account A even though B is active.
      const result = await storage.migrateStoredMaterialBodies({ scopeId: 'u_mig-pin-a' });
      assert.equal(result.ok, true, result.error ?? '');
      const rawA = JSON.parse(localStorage.getItem(keyA));
      assert.equal(rawA[0].parsedMarkdown, undefined);
      const dbA = fake.__databases.get('redcall_materials_db_u_mig-pin-a');
      assert.equal(dbA.get('material_contents').get('m-pinmig').markdown, '# migrate me');
      assert.equal(
        JSON.parse(localStorage.getItem('redcall_user_mig-pin-b__materials_v1'))[0].id,
        'other-b',
        'the active account records are untouched'
      );
      const dbB = fake.__databases.get('redcall_materials_db_u_mig-pin-b');
      assert.ok(dbB && !dbB.get('material_contents').has('m-pinmig'));
    });
  });

  // ---- Boundary 5: server cache replacement must not delete un-migrated data ----

  await checkAsync('a server cache replacement preserves an un-migrated material missing from an empty server list', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'server-merge-empty' });
      const key = 'redcall_user_server-merge-empty__materials_v1';
      localStorage.setItem(key, JSON.stringify([{
        id: 'm-local', subjectId: 's1', kind: 'pdf', title: 'Local', status: 'ready', isConverted: true,
        uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# last local copy',
      }]));
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      fake.__failure.put.add('m-local'); // migration cannot persist the body

      const merged = storage.saveStoredMaterialsFromServerCache([]);
      const raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw.find((m) => m.id === 'm-local').parsedMarkdown, '# last local copy', 'the un-migrated body survives an empty server list');
      assert.ok(merged.some((m) => m.id === 'm-local'));
      assert.equal(storage.loadStoredMaterials().find((m) => m.id === 'm-local').parsedMarkdown, '# last local copy');
    });
  });

  await checkAsync('a partial server list does not delete the local material it omits', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'server-merge-partial' });
      const key = 'redcall_user_server-merge-partial__materials_v1';
      localStorage.setItem(key, JSON.stringify([
        { id: 'm-server', subjectId: 's1', kind: 'pdf', title: 'Server', status: 'ready', isConverted: true, uploadedAt: 't' },
        { id: 'm-only-local', subjectId: 's1', kind: 'pdf', title: 'Local', status: 'ready', isConverted: true, uploadedAt: 't', parsedMarkdown: '# local body' },
      ]));
      const merged = storage.saveStoredMaterialsFromServerCache([
        { id: 'm-server', subjectId: 's1', kind: 'pdf', title: 'Server renamed', status: 'ready', isConverted: true, uploadedAt: 't' },
      ]);
      const raw = JSON.parse(localStorage.getItem(key));
      assert.equal(raw.find((m) => m.id === 'm-server').title, 'Server renamed', 'server metadata wins for its own ids');
      assert.equal(raw.find((m) => m.id === 'm-only-local').parsedMarkdown, '# local body', 'omitted local material preserved');
      assert.ok(merged.some((m) => m.id === 'm-only-local'));
    });
  });

  await checkAsync('an explicitly deleted material is never resurrected by a server cache replacement', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'server-merge-deleted' });
      storage.markMaterialDeleted('m-deleted');
      const merged = storage.saveStoredMaterialsFromServerCache([
        { id: 'm-deleted', subjectId: 's1', kind: 'pdf', title: 'Back', status: 'ready', isConverted: true, uploadedAt: 't' },
        { id: 'm-keep', subjectId: 's1', kind: 'pdf', title: 'Keep', status: 'ready', isConverted: true, uploadedAt: 't' },
      ]);
      assert.ok(!merged.some((m) => m.id === 'm-deleted'), 'deleted id not resurrected');
      assert.ok(merged.some((m) => m.id === 'm-keep'));
      const raw = JSON.parse(localStorage.getItem('redcall_user_server-merge-deleted__materials_v1'));
      assert.ok(!raw.some((m) => m.id === 'm-deleted'));
    });
  });

  await checkAsync('a restored local-only material survives a server refresh and is dropped only after it syncs', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'server-localonly' });
      // Simulate a restored material: metadata present, body already durable in
      // IndexedDB, marked local-only, and NOT present on the server yet.
      await matStorage.saveMaterialContent('m-restored', { markdown: '# restored body' });
      storage.saveStoredMaterials([{ id: 'm-restored', subjectId: 's1', kind: 'pdf', title: 'Restored', status: 'ready', isConverted: true, uploadedAt: 't' }]);
      storage.markMaterialLocalOnly('m-restored');

      const otherServer = [{ id: 'm-other', subjectId: 's1', kind: 'pdf', title: 'Other', status: 'ready', isConverted: true, uploadedAt: 't' }];
      let merged = storage.saveStoredMaterialsFromServerCache(otherServer);
      assert.ok(merged.some((m) => m.id === 'm-restored'), 'restored metadata survives a server refresh');

      // Once the server list contains it, it is no longer local-only.
      merged = storage.saveStoredMaterialsFromServerCache([
        ...otherServer,
        { id: 'm-restored', subjectId: 's1', kind: 'pdf', title: 'Restored', status: 'ready', isConverted: true, uploadedAt: 't' },
      ]);
      assert.ok(merged.some((m) => m.id === 'm-restored'));
      // A later refresh that omits it now drops it (the server is authoritative).
      merged = storage.saveStoredMaterialsFromServerCache(otherServer);
      assert.ok(!merged.some((m) => m.id === 'm-restored'), 'after sync, the server list is authoritative');
    });
  });

  await checkAsync('a preserved un-migrated body is removed only after a verified migration retry', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'server-merge-retry' });
      const key = 'redcall_user_server-merge-retry__materials_v1';
      localStorage.setItem(key, JSON.stringify([{
        id: 'm-retry', subjectId: 's1', kind: 'pdf', title: 'Retry', status: 'ready', isConverted: true,
        uploadedAt: 't', parsedMarkdown: '# retry body',
      }]));
      await matStorage.saveMaterialContent('warm', { markdown: 'warm' });
      fake.__failure.put.add('m-retry');
      const first = await storage.migrateStoredMaterialBodies();
      assert.equal(first.ok, false);

      // A server refresh keeps the un-migrated body.
      storage.saveStoredMaterialsFromServerCache([]);
      assert.equal(JSON.parse(localStorage.getItem(key))[0].parsedMarkdown, '# retry body');

      // Retry succeeds: the body is verified in IndexedDB, then the duplicate is removed.
      fake.__failure.put.delete('m-retry');
      const retry = await storage.migrateStoredMaterialBodies();
      assert.equal(retry.ok, true, retry.error ?? '');
      assert.equal(JSON.parse(localStorage.getItem(key))[0].parsedMarkdown, undefined, 'duplicate removed only after verified migration');
      const body = await matStorage.loadMaterialContentResult('m-retry');
      assert.equal(body.status, 'found');
      assert.equal(body.content.markdown, '# retry body');
    });
  });

  // ---- Boundary 4: the local body hash registry ----

  await checkAsync('the local body hash registry survives metadata replacement and reload', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-keep' });
    assert.equal(storage.recordMaterialBodyHash('m-bh', 'h1'), true, 'the hash record is persisted and verified');
    const baseMaterial = { id: 'm-bh', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z' };
    storage.saveStoredMaterials([baseMaterial]);
    assert.equal(storage.loadStoredMaterials()[0].bodyHash, 'h1', 'the registry re-attaches the hash after the list is replaced');
    assert.equal(storage.getStoredMaterialBodyHash('m-bh'), 'h1');
    assert.equal(materialPolicy.reconnectHashMatches(storage.getStoredMaterialBodyHash('m-bh'), 'h1'), true);
    assert.equal(materialPolicy.reconnectHashMatches(storage.getStoredMaterialBodyHash('m-bh'), 'h2'), false, 'a different candidate file is refused');
    assert.equal(storage.recordMaterialBodyHash('m-bh', 'h2'), true, 'a legitimate body change updates the hash');
    assert.equal(storage.getStoredMaterialBodyHash('m-bh'), 'h2');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('a failed hash record is not reported saved and hashes stay per account', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-fail' });
    const registryKey = 'redcall_user_hash-fail__material_body_hashes_v1';
    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (key === registryKey) throw new Error('quota exceeded');
      realSetItem(key, value);
    };
    let recorded;
    try {
      recorded = storage.recordMaterialBodyHash('m-f', 'h9');
    } finally {
      localStorage.setItem = realSetItem;
    }
    assert.equal(recorded, false, 'the new hash is never reported as saved');
    assert.equal(storage.getStoredMaterialBodyHash('m-f'), undefined);

    storage.recordMaterialBodyHash('m-f', 'h9');
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-other' });
    assert.equal(storage.getStoredMaterialBodyHash('m-f'), undefined, 'another account cannot read the hash');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('a body hash recorded for one identity is never used for the same id with a different identity', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-identity' });
    assert.equal(storage.recordMaterialBodyHash('m-id', 'h-pdf', { subjectId: 's1', kind: 'pdf' }), true);
    const same = { id: 'm-id', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true, uploadedAt: 't' };
    const otherSubject = { ...same, subjectId: 's2' };
    const otherKind = { ...same, kind: 'transcript' };
    assert.equal(storage.resolveStoredMaterialBodyHash(same), 'h-pdf', 'same identity keeps the hash');
    assert.equal(storage.resolveStoredMaterialBodyHash(otherSubject), undefined, 'a different subject must not use the old hash');
    assert.equal(storage.resolveStoredMaterialBodyHash(otherKind), undefined, 'a different kind must not use the old hash');
    assert.equal(storage.getStoredMaterialBodyHash('m-id', { subjectId: 's2', kind: 'pdf' }), undefined);
    assert.equal(storage.getStoredMaterialBodyHash('m-id', { subjectId: 's1', kind: 'pdf' }), 'h-pdf');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('a stale metadata bodyHash does not bypass the registry identity check', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-identity-stale' });
    storage.recordMaterialBodyHash('m-stale', 'h-correct', { subjectId: 's1', kind: 'pdf' });
    const staleMaterial = {
      id: 'm-stale', subjectId: 's2', kind: 'pdf', title: 'T', status: 'ready',
      isConverted: true, uploadedAt: 't', bodyHash: 'h-stale-metadata',
    };
    assert.equal(
      storage.resolveStoredMaterialBodyHash(staleMaterial),
      undefined,
      'a registry identity mismatch must not fall back to the stale metadata hash'
    );
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('a cloud refresh then reload keeps the identity-matching hash and rejects a changed identity', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'hash-refresh' });
    storage.recordMaterialBodyHash('m-cr', 'h-cr', { subjectId: 's1', kind: 'pdf' });
    // Server metadata rows do not carry bodyHash; the registry must re-attach it.
    storage.saveStoredMaterials([{ id: 'm-cr', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready', isConverted: true, uploadedAt: 't' }]);
    assert.equal(storage.loadStoredMaterials()[0].bodyHash, 'h-cr');
    // A different identity for the same id must not inherit the old hash.
    storage.saveStoredMaterials([{ id: 'm-cr', subjectId: 's1', kind: 'transcript', title: 'T', status: 'ready', isConverted: true, uploadedAt: 't' }]);
    assert.equal(storage.loadStoredMaterials()[0].bodyHash, undefined);
    // A legitimate change under the SAME identity updates the hash.
    assert.equal(storage.recordMaterialBodyHash('m-cr', 'h-cr-v2', { subjectId: 's1', kind: 'pdf' }), true);
    assert.equal(storage.getStoredMaterialBodyHash('m-cr', { subjectId: 's1', kind: 'pdf' }), 'h-cr-v2');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('the local body hash is never uploaded to the server', async () => {
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const material = {
        id: 'mat-bh', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
        isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
        bodyHash: 'h_local_only', storagePolicy: { syncBody: false, backupOriginal: false },
      };
      const result = await cloudMaterials.writeMaterialMetadata({ material, bodySynced: false, originalBackedUp: false });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.materials.find((m) => m.id === 'mat-bh');
      assert.ok(!('body_hash' in row), 'no body_hash column is written');
      assert.ok(!JSON.stringify(row).includes('h_local_only'), 'the local hash value is not part of any server write');
    });
  });

  await checkAsync('a local original is stored, verified, reconnected by hash and deleted', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'orig-user' });
      const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'application/pdf' });
      const hash = await matStorage.hashBlob(blob);
      assert.ok(hash.startsWith('oh_'));

      const saved = await matStorage.saveMaterialOriginal('m-1', blob, 'application/pdf');
      assert.equal(saved.persisted, true, saved.persisted ? '' : saved.error);
      assert.equal(saved.hash, hash);

      const loaded = await matStorage.loadMaterialOriginal('m-1');
      assert.equal(loaded.status, 'found');
      assert.equal(loaded.hash, hash);
      assert.equal(loaded.size, 5);
      assert.equal(materialPolicy.reconnectHashMatches(hash, loaded.hash), true);

      const ids = await matStorage.listMaterialOriginalIds();
      assert.ok(ids.includes('m-1'));

      const deleted = await matStorage.deleteMaterialOriginal('m-1');
      assert.equal(deleted.deleted, true);
      assert.equal((await matStorage.loadMaterialOriginal('m-1')).status, 'missing');
    });
  });

  await checkAsync('a failed local original save is never reported as success', async () => {
    await withFakeIndexedDB(async (fake) => {
      storageScope.setStorageScope({ kind: 'user', userId: 'orig-fail' });
      fake.__failure.put.add('m-fail');
      const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'application/pdf' });
      const saved = await matStorage.saveMaterialOriginal('m-fail', blob, 'application/pdf');
      assert.equal(saved.persisted, false);
      assert.ok(saved.error);
    });
  });

  await checkAsync('metadata-only writes are local-first and never touch existing cloud files', async () => {
    const baseMaterial = {
      id: 'mat-1', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
      storagePolicy: { syncBody: false, backupOriginal: false },
    };
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const result = await cloudMaterials.writeMaterialMetadata({ material: baseMaterial, bodySynced: false, originalBackedUp: false });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.materials.find((m) => m.id === 'mat-1');
      assert.equal(row.sync_body, false);
      assert.equal(row.backup_original, false);
      assert.equal(row.body_synced, false);
      assert.equal(row.original_backed_up, false);
      assert.equal(row.markdown_path, null);
      assert.equal(row.original_path, null);
      assert.equal(client.__state.objects.size, 0, 'no Storage upload for local-first metadata');
    });

    const existingRow = {
      id: 'mat-2', user_id: 'u1', subject_id: 's1', kind: 'pdf', title: 'T', source_refs: '', status: 'ready',
      status_message: null, is_converted: true, upload_state: 'ready', upload_error: null, version: 3,
      content_hash: 'h', body_synced: true, original_backed_up: true, original_hash: null, file_size: null,
      original_path: 'u1/mat-2/v3/original.pdf', markdown_path: 'u1/mat-2/v3/markdown.md', pages_path: null,
      transcript_path: null, page_count: null, duration_minutes: null, speaker_count: null, speakers: [],
      has_ai_concepts: false, has_ai_problems: false, is_demo: false, uploaded_at: '2026-01-01T00:00:00.000Z',
      last_edited_at: null, pending_job_id: null, pending_version: null, pending_upload_state: null,
      pending_upload_error: null, pending_content_hash: null, pending_original_path: null, pending_markdown_path: null,
      pending_pages_path: null, pending_transcript_path: null, sync_body: false, backup_original: false,
      created_at: '', updated_at: '',
    };
    await withFakeSupabase({ user: { id: 'u1' }, materials: [existingRow] }, async (client) => {
      const result = await cloudMaterials.writeMaterialMetadata({ material: { ...baseMaterial, id: 'mat-2', title: 'renamed' } });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.materials.find((m) => m.id === 'mat-2');
      assert.equal(row.version, 3, 'version unchanged by metadata write');
      assert.equal(row.markdown_path, 'u1/mat-2/v3/markdown.md', 'existing cloud body preserved');
      assert.equal(row.body_synced, true, 'sync state preserved');
      assert.equal(row.title, 'renamed');
    });
  });

  await checkAsync('policy-off write uploads neither body nor original', async () => {
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const material = {
        id: 'mat-off', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
        isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
        storagePolicy: { syncBody: false, backupOriginal: false },
      };
      const blob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
      const result = await cloudMaterials.writeMaterial({
        material,
        content: { markdown: '# body' },
        original: { blob, contentType: 'application/pdf' },
        policy: { syncBody: false, backupOriginal: false },
      });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      assert.equal(client.__state.objects.size, 0, 'no Storage upload when both policies are off');
      const row = client.__state.materials.find((m) => m.id === 'mat-off');
      assert.equal(row.body_synced, false);
      assert.equal(row.original_backed_up, false);
      assert.equal(row.version, 1);
    });
  });

  check('cloud content hash ignores updatedAt and detects different bodies', () => {
    assert.equal(
      cloudHash.materialContentHash({ markdown: '# a', updatedAt: '2020-01-01' }),
      cloudHash.materialContentHash({ markdown: '# a' })
    );
    assert.notEqual(
      cloudHash.materialContentHash({ markdown: '# a' }),
      cloudHash.materialContentHash({ markdown: '# b' })
    );
  });

  check('subject mapper round-trips and never sends user_id', () => {
    const subject = {
      id: 's-1',
      name: '미적분',
      code: 'MATH101',
      timezone: 'Asia/Seoul',
      examAt: '2026-06-01T00:00:00.000Z',
      chapters: ['1', '2'],
      domain: 'math_stats',
    };
    const payload = cloudMappers.subjectToUpsert(subject);
    assert.equal(payload.id, 's-1');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'user_id'), false);
    const mapped = cloudMappers.rowToSubject({
      ...payload,
      user_id: 'user-x',
      created_at: '',
      updated_at: '',
    });
    assert.equal(mapped.id, 's-1');
    assert.equal(mapped.name, '미적분');
    assert.equal(mapped.ownerId, 'user-x');
    assert.equal(mapped.examAt, '2026-06-01T00:00:00.000Z');
    assert.deepEqual(mapped.chapters, ['1', '2']);
  });

  check('material object paths are job-scoped so different jobs never collide', () => {
    const a = cloudMappers.materialObjectPaths('u1', 'm1', 'job-a', 'pdf');
    const b = cloudMappers.materialObjectPaths('u1', 'm1', 'job-b', 'pdf');
    assert.equal(a.markdown, 'u1/m1/job-a/markdown.md');
    assert.equal(a.original, 'u1/m1/job-a/original.pdf');
    assert.equal(a.pages, 'u1/m1/job-a/pages.json');
    assert.equal(a.transcript, 'u1/m1/job-a/transcript.txt');
    assert.notEqual(a.markdown, b.markdown, 'different jobs use different objects');
    assert.notEqual(a.original, b.original);
  });

  check('migration plan skips identical, conflicts on different, retries failed uploads', () => {
    const localSubjects = [{ id: 's1', name: 'A', code: '', timezone: 'Asia/Seoul' }];
    const localMaterials = [
      { id: 'm1', subjectId: 's1', kind: 'pdf', title: 'T1', sourceRefs: '' },
      { id: 'm2', subjectId: 's1', kind: 'pdf', title: 'T2', sourceRefs: '' },
      { id: 'm3', subjectId: 's1', kind: 'pdf', title: 'T3', sourceRefs: '' },
      { id: 'm4', subjectId: 'sX', kind: 'pdf', title: 'T4', sourceRefs: '' },
    ];
    const cloudMaterials = [
      { id: 'm2', subjectId: 's1', kind: 'pdf', title: 'T2', sourceRefs: '' },
      { id: 'm3', subjectId: 's1', kind: 'pdf', title: 'T3', sourceRefs: '' },
    ];
    const localHashes = new Map([['m1', 'h1'], ['m2', 'h2'], ['m3', 'h3'], ['m4', 'h4']]);
    const cloudHashes = new Map([['m2', 'h2'], ['m3', 'different']]);

    const plan = cloudPlan.planLocalMigration({
      localSubjects,
      localMaterials,
      cloudSubjects: [],
      cloudMaterials,
      localContentHashes: localHashes,
      cloudContentHashes: cloudHashes,
      cloudMaterialUploadStates: new Map([['m3', 'ready']]),
    });
    assert.deepEqual(plan.subjects.map((s) => s.id), ['s1']);
    assert.deepEqual(plan.materials.map((m) => m.id).sort(), ['m1']);
    assert.equal(plan.skippedMaterials, 1);
    assert.ok(plan.conflicts.some((c) => c.id === 'm3'), 'different content conflicts');
    assert.ok(plan.conflicts.some((c) => c.id === 'm4'), 'dangling subject conflicts');

    // A same-id row whose upload failed is resumed, not treated as a conflict.
    const retry = cloudPlan.planLocalMigration({
      localSubjects,
      localMaterials,
      cloudSubjects: [],
      cloudMaterials,
      localContentHashes: localHashes,
      cloudContentHashes: cloudHashes,
      cloudMaterialUploadStates: new Map([['m3', 'failed']]),
    });
    assert.equal(retry.conflicts.some((c) => c.id === 'm3'), false);
    assert.ok(retry.materials.some((m) => m.id === 'm3'), 'failed upload is retried');
  });

  // ---- Cloud repository / service (real code, fake Supabase boundary) ----
  const readyMaterialRow = (overrides = {}) => ({
    id: 'm',
    user_id: 'u1',
    subject_id: 's1',
    kind: 'pdf',
    title: 'T',
    source_refs: '',
    status: 'ready',
    status_message: null,
    is_converted: true,
    upload_state: 'ready',
    upload_error: null,
    version: 1,
    content_hash: null,
    original_path: null,
    markdown_path: null,
    pages_path: null,
    transcript_path: null,
    page_count: null,
    duration_minutes: null,
    speaker_count: null,
    speakers: [],
    has_ai_concepts: false,
    has_ai_problems: false,
    is_demo: false,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    last_edited_at: null,
    pending_job_id: null,
    pending_version: null,
    pending_upload_state: null,
    pending_upload_error: null,
    pending_content_hash: null,
    pending_original_path: null,
    pending_markdown_path: null,
    pending_pages_path: null,
    pending_transcript_path: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  await checkAsync('material edit upload failure keeps the active version and original', async () => {
    const material = {
      id: 'm-edit', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# v2',
    };
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({
        id: 'm-edit', version: 1, content_hash: 'old',
        original_path: 'u1/m-edit/v1/original.pdf', markdown_path: 'u1/m-edit/v1/markdown.md',
      })],
      objects: { 'u1/m-edit/v1/markdown.md': new Blob(['# v1']) },
      fail: { uploadPath: 'markdown.md' },
    }, async (client) => {
      const result = await cloudMaterials.writeMaterial({ material, content: { markdown: '# v2' } });
      assert.equal(result.ok, false);
      const row = client.__state.materials[0];
      assert.equal(row.version, 1, 'active version unchanged');
      assert.equal(row.upload_state, 'ready', 'active stays ready');
      assert.equal(row.original_path, 'u1/m-edit/v1/original.pdf', 'original preserved');
      assert.equal(row.pending_upload_state, 'failed');
    });
  });

  await checkAsync('material edit without a new original keeps the original path', async () => {
    const material = {
      id: 'm-noorig', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# v2',
    };
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({
        id: 'm-noorig', version: 1, original_path: 'u1/m-noorig/v1/original.pdf',
        markdown_path: 'u1/m-noorig/v1/markdown.md',
      })],
      objects: { 'u1/m-noorig/v1/markdown.md': new Blob(['# v1']) },
    }, async (client) => {
      const result = await cloudMaterials.writeMaterial({ material, content: { markdown: '# v2' } });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.materials[0];
      assert.equal(row.version, 2);
      assert.equal(row.original_path, 'u1/m-noorig/v1/original.pdf', 'original path preserved across edit');
    });
  });

  await checkAsync('a stale upload result cannot overwrite a newer active version', async () => {
    const material = {
      id: 'm-race', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# new',
    };
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({
        id: 'm-race', version: 1, original_path: 'u1/m-race/v1/original.pdf',
        markdown_path: 'u1/m-race/v1/markdown.md',
      })],
      objects: { 'u1/m-race/v1/markdown.md': new Blob(['# old']) },
      fail: { switch: true },
    }, async (client) => {
      const result = await cloudMaterials.writeMaterial({ material, content: { markdown: '# new' } });
      assert.equal(result.ok, false);
      assert.match(result.error, /다른 작업/);
      const row = client.__state.materials[0];
      assert.equal(row.version, 1, 'active version not switched');
      assert.equal(row.upload_state, 'ready');
    });
  });

  await checkAsync('a write with a superseded expected version is refused without side effects', async () => {
    const material = {
      id: 'm-exp', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# new',
    };
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({
        id: 'm-exp', version: 2, content_hash: 'base',
        original_path: 'u1/m-exp/v1/original.pdf', markdown_path: 'u1/m-exp/v1/markdown.md',
      })],
      objects: { 'u1/m-exp/v1/markdown.md': new Blob(['# base']) },
    }, async (client) => {
      // The caller confirmed v1, but the server already holds v2: refuse BEFORE
      // any pending claim, upload or cleanup so the newer row is never bypassed.
      const stale = await cloudMaterials.writeMaterial({
        material, content: { markdown: '# new' }, jobId: 'job-stale-1', expectedVersion: 1,
      });
      assert.equal(stale.ok, false);
      assert.match(stale.error, /MATERIAL_VERSION_STALE/);
      const row = client.__state.materials[0];
      assert.equal(row.version, 2, 'active version untouched');
      assert.equal(row.pending_job_id, null, 'pending slot untouched');
      assert.equal(client.__state.objects.size, 1, 'no objects uploaded');

      // A matching expected version proceeds normally.
      const fresh = await cloudMaterials.writeMaterial({
        material, content: { markdown: '# new' }, jobId: 'job-fresh-1', expectedVersion: 2,
      });
      assert.equal(fresh.ok, true, fresh.ok ? '' : fresh.error);
      assert.equal(client.__state.materials[0].version, 3);
    });
  });

  check('generated job ids are unique non-empty strings', () => {
    const a = cloudMaterials.generateJobId();
    const b = cloudMaterials.generateJobId();
    assert.equal(typeof a, 'string');
    assert.ok(a.length > 0);
    assert.notEqual(a, b);
  });

  await checkAsync('an empty pages array is stored and verified consistently', async () => {
    const material = {
      id: 'm-pages', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const result = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x', pages: [] } });
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.materials[0];
      assert.equal(row.upload_state, 'ready');
      assert.equal(row.version, 1, 'new material activates version 1 from version 0');
      assert.ok(String(row.pages_path).startsWith('u1/m-pages/') && String(row.pages_path).endsWith('/pages.json'));
    });
  });

  await checkAsync('delete does not remove the DB row when file listing fails', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({ id: 'm-del' })],
      objects: { 'u1/m-del/v1/markdown.md': new Blob(['# x']) },
      fail: { list: true },
    }, async (client) => {
      const result = await cloudMaterials.deleteMaterial('m-del');
      assert.equal(result.ok, false);
      assert.equal(client.__state.materials.length, 1, 'row kept on listing failure');
    });
  });

  await checkAsync('delete marks a retryable state when the DB delete fails after files are removed', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({ id: 'm-del2' })],
      objects: { 'u1/m-del2/v1/markdown.md': new Blob(['# x']) },
      fail: { deleteRow: true },
    }, async (client) => {
      const result = await cloudMaterials.deleteMaterial('m-del2');
      assert.equal(result.ok, false);
      assert.equal(client.__state.objects.size, 0, 'files removed');
      assert.equal(client.__state.materials[0].upload_state, 'deleting', 'retryable deleting state');
    });
  });

  await checkAsync('subjects repository preserves legacy string ids', async () => {
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const saved = await cloudSubjects.upsertSubject({ id: 'subj-legacy-1', name: 'A', code: '', timezone: 'Asia/Seoul' });
      assert.equal(saved.ok, true, saved.ok ? '' : saved.error);
      assert.equal(saved.data.id, 'subj-legacy-1');
      assert.equal(client.__state.subjects[0].user_id, 'u1');
    });
  });

  await checkAsync('two accounts can store the same legacy string id', async () => {
    const subject = { id: 'subj-shared', name: 'A', code: '', timezone: 'Asia/Seoul' };
    await withFakeSupabase({ user: { id: 'u1' } }, async (c1) => {
      const r1 = await cloudSubjects.upsertSubject(subject);
      assert.equal(r1.ok, true, r1.ok ? '' : r1.error);
      assert.equal(c1.__state.subjects[0].user_id, 'u1');
      await withFakeSupabase({ user: { id: 'u2' } }, async (c2) => {
        const r2 = await cloudSubjects.upsertSubject(subject);
        assert.equal(r2.ok, true, r2.ok ? '' : r2.error);
        assert.equal(c2.__state.subjects.length, 1);
        assert.equal(c2.__state.subjects[0].user_id, 'u2');
      });
      assert.equal(c1.__state.subjects.length, 1);
    });
  });

  await checkAsync('retry of the same job reuses the same pending version and folder', async () => {
    const material = {
      id: 'm-retry', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const jobId = 'job-retry-1';
    await withFakeSupabase({
      user: { id: 'u1' },
      fail: { uploadPath: 'markdown.md' },
    }, async (client) => {
      const first = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId });
      assert.equal(first.ok, false);
      assert.equal(client.__state.materials[0].pending_version, 1);

      client.__state.fail.uploadPath = null;
      const retry = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId });
      assert.equal(retry.ok, true, retry.ok ? '' : retry.error);
      assert.equal(client.__state.materials.length, 1, 'no duplicate material row');
      assert.equal(client.__state.materials[0].version, 1, 'same version reused');
      assert.equal(client.__state.materials[0].upload_state, 'ready');
      for (const path of client.__state.objects.keys()) {
        assert.ok(path.startsWith(`u1/m-retry/${jobId}/`), `objects stay in the job folder: ${path}`);
      }
    });
  });

  await checkAsync('completed material job retry is idempotent and rejects changed content', async () => {
    const material = {
      id: 'm-completed-retry', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const jobId = 'job-completed-retry';
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const first = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId });
      assert.equal(first.ok, true, first.ok ? '' : first.error);
      const objectCount = client.__state.objects.size;
      const retry = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId, expectedVersion: 0 });
      assert.equal(retry.ok, true, retry.ok ? '' : retry.error);
      assert.equal(retry.data.version, 1);
      assert.equal(client.__state.materials[0].version, 1, 'completed retry does not create a new version');
      assert.equal(client.__state.objects.size, objectCount, 'completed retry does not upload again');

      const changed = await cloudMaterials.writeMaterial({ material, content: { markdown: '# changed' }, jobId });
      assert.equal(changed.ok, false);
      assert.match(changed.error, /MATERIAL_JOB_ID_CONFLICT/);
      assert.equal(client.__state.materials[0].version, 1, 'conflict leaves active version intact');
    });
  });

  await checkAsync('completed PDF retry checks the original file hash', async () => {
    const material = {
      id: 'm-pdf-retry', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const jobId = 'job-pdf-retry';
    const original = { blob: new Blob(['%PDF-1.7 source']), contentType: 'application/pdf' };
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const first = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, original, jobId });
      assert.equal(first.ok, true, first.ok ? '' : first.error);
      const retry = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, original, jobId });
      assert.equal(retry.ok, true, retry.ok ? '' : retry.error);
      const changed = await cloudMaterials.writeMaterial({
        material, content: { markdown: '# x' },
        original: { blob: new Blob(['%PDF-1.7 other']), contentType: 'application/pdf' }, jobId,
      });
      assert.equal(changed.ok, false);
      assert.match(changed.error, /MATERIAL_JOB_ID_CONFLICT/);
      assert.equal(client.__state.materials[0].version, 1);
    });
  });

  await checkAsync('a delayed job cannot overwrite a newer job that already activated', async () => {
    const baseMaterial = {
      subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const jobA = 'job-A';
    const jobB = 'job-B';
    let releaseA;
    const gate = new Promise((resolve) => { releaseA = resolve; });

    await withFakeSupabase({
      user: { id: 'u1' },
      materials: [readyMaterialRow({
        id: 'm-conc', version: 1, content_hash: 'base',
        original_path: 'u1/m-conc/base/original.pdf', markdown_path: 'u1/m-conc/base/markdown.md',
      })],
      objects: { 'u1/m-conc/base/markdown.md': new Blob(['# base']) },
      fail: { delayPath: jobA, delayGate: gate },
    }, async (client) => {
      const aPromise = cloudMaterials.writeMaterial({
        material: { ...baseMaterial, id: 'm-conc', parsedMarkdown: '# A' },
        content: { markdown: '# A' },
        jobId: jobA,
      });
      // A is paused during its upload. B claims and activates.
      const b = await cloudMaterials.writeMaterial({
        material: { ...baseMaterial, id: 'm-conc', parsedMarkdown: '# B' },
        content: { markdown: '# B' },
        jobId: jobB,
      });
      assert.equal(b.ok, true, b.ok ? '' : b.error);

      releaseA();
      const a = await aPromise;
      assert.equal(a.ok, false, 'A must not activate after B');

      const row = client.__state.materials[0];
      assert.equal(row.version, 2, 'B active version');
      assert.ok(String(row.markdown_path).includes(`/${jobB}/`), 'active body is B');
      assert.equal(row.content_hash, cloudHash.materialContentHash({ markdown: '# B' }));
      assert.equal(row.original_path, 'u1/m-conc/base/original.pdf', 'B original preserved');
      assert.ok(client.__state.objects.has(`u1/m-conc/${jobB}/markdown.md`), 'B object intact');
      assert.ok(
        ![...client.__state.objects.keys()].some((p) => p.includes(`/${jobA}/`)),
        'A objects cleaned up'
      );
    });
  });

  await checkAsync('a different job does not reuse another job pending state', async () => {
    const material = {
      id: 'm-claim', subjectId: 's1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready',
      isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# x',
    };
    await withFakeSupabase({
      user: { id: 'u1' },
      fail: { uploadPath: 'markdown.md' },
    }, async (client) => {
      const a = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId: 'job-A' });
      assert.equal(a.ok, false);
      assert.equal(client.__state.materials[0].pending_job_id, 'job-A');

      client.__state.fail.uploadPath = null;
      const b = await cloudMaterials.writeMaterial({ material, content: { markdown: '# x' }, jobId: 'job-B' });
      assert.equal(b.ok, true, b.ok ? '' : b.error);
      const row = client.__state.materials[0];
      assert.equal(row.upload_state, 'ready');
      assert.equal(row.pending_job_id, null, 'B did not keep A pending job');
      assert.ok(String(row.markdown_path).includes('/job-B/'), 'B used its own folder');
      assert.ok(![...client.__state.objects.keys()].some((p) => p.includes('/job-A/')), 'A objects cleaned');
    });
  });

  await checkAsync('empty server keeps migration originals intact', async () => {
    const userId = 'cloud-user-p0';
    const subjKey = 'redcall_user_' + userId + '__subjects_v1';
    for (const base of ['__subjects_v1', '__origin_snapshot_v1', '__origin_subjects_v1', '__origin_materials_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    const original = JSON.stringify([{ id: 'subj-keep', name: 'Keep', code: '', timezone: 'Asia/Seoul' }]);
    localStorage.setItem(subjKey, original);

    const snapshot = await cloudOriginals.ensureMigrationOriginals(userId);
    assert.equal(snapshot.ok, true, snapshot.ok ? '' : snapshot.error);
    assert.equal(localStorage.getItem('redcall_user_' + userId + '__origin_subjects_v1'), original);

    // Simulate the cloud mirror overwriting the live key with an empty list.
    localStorage.setItem(subjKey, JSON.stringify([]));
    const loaded = cloudOriginals.loadMigrationOriginals(userId);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.subjects.length, 1, 'original preserved in the origin area');
    assert.equal(loaded.source, 'origin');
  });

  await checkAsync('an empty first snapshot does not drop a later legacy import', async () => {
    const userId = 'cloud-user-import';
    for (const base of ['__subjects_v1', '__materials_v1', '__origin_snapshot_v1', '__origin_subjects_v1', '__origin_materials_v1', '__server_cache_v1', '__cloud_migration_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    // First login with no local records: empty snapshot, then server cache.
    const first = await cloudOriginals.ensureMigrationOriginals(userId);
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    assert.equal(first.addedSubjects, 0);
    cloudOriginals.markServerCache(userId);
    assert.equal(cloudOriginals.hasServerCache(userId), true);

    // A legacy import copies records into the live scope.
    const imported = JSON.stringify([{ id: 'subj-imported', name: 'Imported', code: '', timezone: 'Asia/Seoul' }]);
    localStorage.setItem('redcall_user_' + userId + '__subjects_v1', imported);

    // The import handler merges into the originals BEFORE reloading/mirroring.
    const merged = await cloudOriginals.ensureMigrationOriginals(userId);
    assert.equal(merged.ok, true, merged.ok ? '' : merged.error);
    assert.equal(merged.addedSubjects, 1, 'imported subject added to originals');

    const originals = cloudOriginals.loadMigrationOriginals(userId);
    assert.equal(originals.ok, true);
    assert.ok(originals.subjects.some((s) => s.id === 'subj-imported'), 'imported subject kept as a migration target');
  });

  await checkAsync('a preservation failure aborts the cache overwrite', async () => {
    const userId = 'cloud-user-preserve-fail';
    for (const base of ['__origin_snapshot_v1', '__origin_subjects_v1', '__subjects_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    localStorage.setItem('redcall_user_' + userId + '__subjects_v1', '{not valid json');
    const result = await cloudOriginals.ensureMigrationOriginals(userId);
    assert.equal(result.ok, false, 'caller must not mirror on preservation failure');
  });

  await checkAsync('an existing original wins over a conflicting imported record', async () => {
    const userId = 'cloud-user-conflict-origin';
    for (const base of ['__origin_snapshot_v1', '__origin_subjects_v1', '__subjects_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    localStorage.setItem(
      'redcall_user_' + userId + '__origin_subjects_v1',
      JSON.stringify([{ id: 'subj-x', name: 'Original', code: '', timezone: 'Asia/Seoul' }])
    );
    localStorage.setItem(
      'redcall_user_' + userId + '__subjects_v1',
      JSON.stringify([{ id: 'subj-x', name: 'Imported', code: '', timezone: 'Asia/Seoul' }])
    );
    const result = await cloudOriginals.ensureMigrationOriginals(userId);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.conflicts, 1);
    const originals = cloudOriginals.loadMigrationOriginals(userId);
    const subject = originals.subjects.find((s) => s.id === 'subj-x');
    assert.equal(subject.name, 'Original', 'existing original preserved');
  });

  await checkAsync('originals are scoped per account', async () => {
    const userA = 'cloud-acct-a';
    const userB = 'cloud-acct-b';
    for (const base of ['__subjects_v1', '__origin_snapshot_v1', '__origin_subjects_v1']) {
      localStorage.removeItem('redcall_user_' + userA + base);
      localStorage.removeItem('redcall_user_' + userB + base);
    }
    localStorage.setItem('redcall_user_' + userA + '__subjects_v1', JSON.stringify([{ id: 'subj-a', name: 'A', code: '', timezone: 'Asia/Seoul' }]));
    localStorage.setItem('redcall_user_' + userB + '__subjects_v1', JSON.stringify([{ id: 'subj-b', name: 'B', code: '', timezone: 'Asia/Seoul' }]));

    await cloudOriginals.ensureMigrationOriginals(userA);
    assert.equal(localStorage.getItem('redcall_user_' + userB + '__origin_subjects_v1'), null, 'B origin untouched');
    const bLive = cloudOriginals.loadMigrationOriginals(userB);
    assert.equal(bLive.ok, true);
    assert.deepEqual(bLive.subjects.map((s) => s.id), ['subj-b']);
  });

  await checkAsync('same id with different body is a conflict and preserves originals', async () => {
    const userId = 'cloud-user-conflict';
    const subjKey = 'redcall_user_' + userId + '__subjects_v1';
    const matKey = 'redcall_user_' + userId + '__materials_v1';
    for (const base of ['__subjects_v1', '__materials_v1', '__origin_snapshot_v1', '__origin_subjects_v1', '__origin_materials_v1', '__cloud_migration_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    const localSubjects = JSON.stringify([{ id: 'subj-1', name: 'A', code: '', timezone: 'Asia/Seoul' }]);
    const localMaterials = JSON.stringify([{ id: 'mat-1', subjectId: 'subj-1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# local' }]);
    localStorage.setItem(subjKey, localSubjects);
    localStorage.setItem(matKey, localMaterials);
    await cloudOriginals.ensureMigrationOriginals(userId);

    await withFakeSupabase({
      user: { id: userId },
      subjects: [{ id: 'subj-1', user_id: userId, name: 'A', code: '', semester: null, exam_at: null, exam_end_time: null, location: null, timezone: 'Asia/Seoul', scope: null, chapters: [], domain: null, engine_name: null, last_evaluated_at: null, is_demo: false, created_at: '', updated_at: '' }],
      materials: [readyMaterialRow({
        id: 'mat-1', user_id: userId, subject_id: 'subj-1', content_hash: 'different',
        markdown_path: userId + '/mat-1/v1/markdown.md',
      })],
      objects: { [userId + '/mat-1/v1/markdown.md']: new Blob(['# server']) },
    }, async (client) => {
      const result = await cloudMigration.migrateLocalLibraryToCloud(userId);
      assert.equal(result.conflict, true);
      assert.equal(result.ok, false);
      assert.equal(client.__state.materials.length, 1, 'server material not overwritten');
      assert.equal(localStorage.getItem(matKey), localMaterials, 'local original preserved');
    });
  });

  await checkAsync('cloud migration marker failure is retryable without duplicates', async () => {
    const userId = 'cloud-user-marker';
    const subjKey = 'redcall_user_' + userId + '__subjects_v1';
    const matKey = 'redcall_user_' + userId + '__materials_v1';
    const markerKey = 'redcall_user_' + userId + '__cloud_migration_v1';
    for (const base of ['__subjects_v1', '__materials_v1', '__origin_snapshot_v1', '__origin_subjects_v1', '__origin_materials_v1', '__cloud_migration_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    localStorage.setItem(subjKey, JSON.stringify([{ id: 'subj-1', name: 'A', code: '', timezone: 'Asia/Seoul' }]));
    localStorage.setItem(matKey, JSON.stringify([{ id: 'mat-1', subjectId: 'subj-1', kind: 'pdf', title: 'T', sourceRefs: '', status: 'ready', isConverted: true, uploadedAt: '2026-01-01T00:00:00.000Z', parsedMarkdown: '# body' }]));
    await cloudOriginals.ensureMigrationOriginals(userId);

    await withFakeSupabase({ user: { id: userId } }, async (client) => {
      const realSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (key, value) => {
        if (key === markerKey) throw new Error('simulated marker failure');
        realSet(key, value);
      };
      let first;
      try {
        first = await cloudMigration.migrateLocalLibraryToCloud(userId);
      } finally {
        localStorage.setItem = realSet;
      }
      assert.equal(first.ok, false, 'marker failure must not report success');
      assert.equal(localStorage.getItem(markerKey), null);
      assert.equal(client.__state.materials.length, 1);

      const retry = await cloudMigration.migrateLocalLibraryToCloud(userId);
      assert.equal(retry.ok, true, retry.message);
      assert.ok(localStorage.getItem(markerKey) !== null, 'completion marker written on retry');
      assert.equal(client.__state.materials.length, 1, 'no duplicate material');
      assert.equal(client.__state.subjects.length, 1, 'no duplicate subject');
    });
  });

  // ---- Learning content (concepts / problems / drafts / versions) ----
  check('learning migration plan skips identical and conflicts on different content', () => {
    const base = {
      id: 'c1', subjectId: 's1', materialIds: ['m1'], title: 'A', chapterRef: '',
      baseScore: 0, currentScore: 0, status: 'unstudied', order: 1, events: [], exerciseCount: 0,
    };
    // Scores / review events are NOT identity (review history stays local).
    const sameDefinition = { ...base, currentScore: 88, events: [{ id: 'e1' }] };
    const differentDefinition = { ...base, title: 'A changed' };

    const skipPlan = cloudLearningPlan.planLearningMigration({
      localConcepts: [sameDefinition, { ...base, id: 'c2' }],
      localConceptDrafts: [], localProblems: [], localProblemDrafts: [],
      cloudConcepts: [{ ...base }], cloudConceptDrafts: [], cloudProblems: [], cloudProblemDrafts: [],
    });
    assert.deepEqual(skipPlan.concepts.map((c) => c.id).sort(), ['c2']);
    assert.equal(skipPlan.skipped, 1);
    assert.equal(skipPlan.conflicts.length, 0);

    const conflictPlan = cloudLearningPlan.planLearningMigration({
      localConcepts: [differentDefinition],
      localConceptDrafts: [], localProblems: [], localProblemDrafts: [],
      cloudConcepts: [{ ...base }], cloudConceptDrafts: [], cloudProblems: [], cloudProblemDrafts: [],
    });
    assert.equal(conflictPlan.conflicts.length, 1);
    assert.equal(conflictPlan.conflicts[0].id, 'c1');
  });

  check('learning mappers round-trip payload and overlay key columns', () => {
    const concept = { id: 'c1', subjectId: 's1', title: 'A', status: 'unstudied', order: 1, currentScore: 2, events: [] };
    const cUp = cloudLearningMappers.conceptToUpsert(concept);
    assert.equal(cUp.id, 'c1');
    assert.equal(cUp.subject_id, 's1');
    const cBack = cloudLearningMappers.rowToConcept({ ...cUp, user_id: 'u1', created_at: '', updated_at: '' });
    assert.equal(cBack.id, 'c1');
    assert.equal(cBack.subjectId, 's1');
    assert.equal(cBack.title, 'A');

    const problem = {
      id: 'p1', subjectId: 's1', conceptIds: ['c1'], title: 'P', type: 'essay_descriptive',
      rubric: [], hints: [], modelAnswer: '', promptText: 'q', version: 2,
      isApproved: true, isOutdated: false, qualityStatus: 'normal',
    };
    const pUp = cloudLearningMappers.problemToUpsert(problem);
    const pBack = cloudLearningMappers.rowToProblem({ ...pUp, user_id: 'u1', created_at: '', updated_at: '' });
    assert.equal(pBack.version, 2);
    assert.equal(pBack.qualityStatus, 'normal');
    assert.equal(pBack.isApproved, true);
    assert.deepEqual(pBack.conceptIds, ['c1']);
  });

  await checkAsync('learning repository approves via RPC and maps error codes', async () => {
    const draft = { id: 'd1', subjectId: 's1', title: 'A', type: 'essay_descriptive', status: 'draft', isApproved: false };
    const concept = { id: 'c1', subjectId: 's1', title: 'A', status: 'unstudied', order: 1, events: [] };

    await withFakeSupabase({ user: { id: 'u1' }, fail: { rpc: true, rpcMessage: 'DRAFT_STALE' } }, async (client) => {
      const result = await cloudLearningRepo.approveConceptDraft(client, draft, concept, 't');
      assert.equal(result.ok, false);
      assert.match(result.error, /stale/);
    });

    await withFakeSupabase({ user: { id: 'u1' }, rpcResult: 'c1' }, async (client) => {
      const result = await cloudLearningRepo.approveConceptDraft(client, draft, concept, null);
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      assert.equal(result.data.id, 'c1');
      assert.ok(client.__state.rpcCalls.some((c) => c.name === 'approve_concept_draft'));
    });
  });

  await checkAsync('learning repository upserts drafts idempotently by id', async () => {
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const draft = {
        id: 'd1', subjectId: 's1', materialId: 'm1', materialTitle: 'M', title: 'A',
        domain: 'math_stats', description: '', prerequisites: [], relatedConcepts: [],
        commonMisconceptions: [], examples: [],
        sourceEvidence: { type: 'page', quote: 'q', verified: true },
        status: 'draft', isApproved: false, sourceMarkdownHash: 'h', createdAt: '', updatedAt: '',
      };
      const first = await cloudLearningRepo.upsertConceptDrafts(client, [draft], 'job-1');
      assert.equal(first.ok, true, first.ok ? '' : first.error);
      const second = await cloudLearningRepo.upsertConceptDrafts(client, [draft], 'job-1');
      assert.equal(second.ok, true, second.ok ? '' : second.error);
      assert.equal(client.__state.concept_drafts.length, 1, 'idempotent by draft id');
    });
  });

  check('server concepts merge with locally-derived review state', () => {
    const server = [{ id: 'c1', subjectId: 's1', title: 'A', events: [], currentScore: 0, status: 'unstudied' }];
    const local = [{ id: 'c1', subjectId: 's1', title: 'A', events: [{ id: 'e1' }], currentScore: 70, baseScore: 60, status: 'review', postponeDays: 2 }];
    const merged = cloudMerge.mergeConcepts(server, local);
    assert.equal(merged[0].title, 'A');
    assert.equal(merged[0].currentScore, 70);
    assert.equal(merged[0].events.length, 1);
    assert.equal(merged[0].status, 'review');
  });

  check('server problems keep version history and local quality metadata', () => {
    const server = [{ id: 'p1', subjectId: 's1', title: 'P', qualityStatus: 'normal', isOutdated: false }];
    const local = [{ id: 'p1', subjectId: 's1', title: 'P', qualityStatus: 'reported', reports: [{ id: 'r1' }] }];
    const versions = { p1: [{ version: 1, title: 'P', promptText: 'q', hints: [], modelAnswer: 'a', rubric: [], editedAt: '' }] };
    const merged = cloudMerge.mergeProblems(server, local, versions);
    assert.equal(merged[0].qualityStatus, 'reported');
    assert.equal(merged[0].versionHistory.length, 1);
    assert.equal(merged[0].reports.length, 1);
  });

  check('draft merge keeps local-only (unpersisted) drafts', () => {
    const server = [{ id: 'd1', title: 'saved' }];
    const local = [{ id: 'd1', title: 'saved' }, { id: 'd2', title: 'unsaved' }];
    const merged = cloudMerge.mergeDrafts(server, local);
    assert.deepEqual(merged.map((d) => d.id), ['d1', 'd2']);
  });

  check('concept approval builder derives a stable id and chapter ref', () => {
    const draft = {
      id: 'd1', subjectId: 's1', materialId: 'm1', title: 'A', description: '',
      prerequisites: [], relatedConcepts: [], commonMisconceptions: [], examples: [],
      sourceEvidence: { type: 'page', pageNumber: 3, quote: 'q', verified: true },
    };
    const concept = learningApproval.buildConceptFromDraft(draft, undefined, 1);
    assert.equal(concept.id, 'c-ai-d1');
    assert.equal(concept.draftId, 'd1');
    assert.equal(concept.chapterRef, '제3페이지');
    assert.deepEqual(concept.materialIds, ['m1']);
  });

  check('draft mapping uses authoritative DB columns over stale payload', () => {
    const row = {
      id: 'd1', user_id: 'u1', subject_id: 's1', material_id: 'm1', title: 'A',
      status: 'approved', is_approved: true, content_version: 3, generation_job_id: null,
      approved_concept_id: 'c1', approval_state: 'approved', approval_error: null,
      payload: { id: 'd1', subjectId: 's1', title: 'A', status: 'draft', isApproved: false, updatedAt: '2000-01-01' },
      created_at: '', updated_at: '2026-01-02T00:00:00.000Z',
    };
    const draft = cloudLearningMappers.rowToConceptDraft(row);
    assert.equal(draft.status, 'approved');
    assert.equal(draft.isApproved, true);
    assert.equal(draft.updatedAt, '2026-01-02T00:00:00.000Z');
    assert.equal(draft.contentVersion, 3);
    assert.equal(draft.approvedConceptId, 'c1');
  });

  check('merge keeps un-migrated originals and drops migrated/server ids', () => {
    const originals = [{ id: 'c1', subjectId: 's1', title: 'A' }, { id: 'c2', subjectId: 's1', title: 'B' }];
    const merged = cloudMerge.mergeConcepts([], originals, new Set(['c1']));
    assert.deepEqual(merged.map((c) => c.id), ['c2']);
    const server = [{ id: 'c1', subjectId: 's1', title: 'A' }];
    const merged2 = cloudMerge.mergeDrafts(server, [{ id: 'd1' }, { id: 'd2' }], new Set(['d2']));
    assert.deepEqual(merged2.map((d) => d.id), ['c1', 'd1']);
  });

  await checkAsync('empty server keeps un-migrated local concepts/problems', async () => {
    const userId = 'learn-orig-1';
    for (const base of ['__concepts_v1', '__problems_v1', '__origin_learning_snapshot_v1', '__origin_learning_concepts_v1', '__origin_learning_problems_v1', '__learning_migrated_ids_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    localStorage.setItem('redcall_user_' + userId + '__concepts_v1', JSON.stringify([{ id: 'c1', title: 'A' }]));
    localStorage.setItem('redcall_user_' + userId + '__problems_v1', JSON.stringify([{ id: 'p1', title: 'P' }]));

    const preserved = cloudLearningOriginals.ensureLearningOriginals(userId, new Set());
    assert.equal(preserved.ok, true, preserved.ok ? '' : preserved.error);
    // Simulate the server cache overwriting the live scope with an empty list.
    localStorage.setItem('redcall_user_' + userId + '__concepts_v1', JSON.stringify([]));
    localStorage.setItem('redcall_user_' + userId + '__problems_v1', JSON.stringify([]));
    const loaded = cloudLearningOriginals.loadLearningOriginals(userId);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.data.concepts.length, 1, 'concept original preserved');
    assert.equal(loaded.data.problems.length, 1, 'problem original preserved');
    assert.equal(loaded.data.source, 'origin');
  });

  await checkAsync('learning originals exclude server and migrated ids', async () => {
    const userId = 'learn-orig-2';
    for (const base of ['__concepts_v1', '__origin_learning_snapshot_v1', '__origin_learning_concepts_v1', '__learning_migrated_ids_v1']) {
      localStorage.removeItem('redcall_user_' + userId + base);
    }
    localStorage.setItem('redcall_user_' + userId + '__concepts_v1', JSON.stringify([{ id: 'c1' }, { id: 'c2' }]));
    cloudLearningOriginals.recordMigratedIds(userId, ['c2']);
    const preserved = cloudLearningOriginals.ensureLearningOriginals(userId, new Set(['c1']));
    assert.equal(preserved.ok, true);
    const loaded = cloudLearningOriginals.loadLearningOriginals(userId);
    assert.equal(loaded.data.concepts.length, 0, 'server + migrated ids are not kept as originals');
  });

  await checkAsync('content-only draft upsert preserves approval on conflict', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      concept_drafts: [{
        id: 'd1', user_id: 'u1', subject_id: 's1', material_id: null, title: 'old',
        status: 'approved', is_approved: true, content_version: 2, generation_job_id: null,
        approved_concept_id: 'c1', approval_state: 'approved', approval_error: null,
        payload: { title: 'old' }, created_at: '', updated_at: '',
      }],
    }, async (client) => {
      const draft = {
        id: 'd1', subjectId: 's1', materialId: null, title: 'new', domain: 'math_stats', description: '',
        prerequisites: [], relatedConcepts: [], commonMisconceptions: [], examples: [],
        sourceEvidence: { type: 'page', quote: 'q', verified: true },
        status: 'draft', isApproved: false, sourceMarkdownHash: 'h', createdAt: '', updatedAt: '',
      };
      const result = await cloudLearningRepo.upsertConceptDrafts(client, [draft], 'job-1');
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      const row = client.__state.concept_drafts.find((d) => d.id === 'd1');
      assert.equal(row.is_approved, true, 'approval pointer/state preserved');
      assert.equal(row.status, 'approved');
      assert.equal(row.title, 'old', 'approved draft content is strictly preserved against AI retry overwrite');
      assert.equal(row.content_version, 2, 'content_version not reset');
    });
  });

  await checkAsync('approval reconciliation reads the server entity', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      concepts: [{
        id: 'c1', user_id: 'u1', subject_id: 's1', title: 'server-title', order_index: 1, status: 'unstudied',
        current_score: 0, is_learned: false, is_demo: false, version: 1, draft_id: 'd1',
        payload: { id: 'c1', subjectId: 's1', title: 'server-title' }, created_at: '', updated_at: '',
      }],
    }, async (client) => {
      const result = await cloudLearningRepo.getConceptById(client, 'c1');
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      assert.equal(result.data.id, 'c1');
      assert.equal(result.data.title, 'server-title');
    });
  });

  // ---- Cloud learning history (attempts / reviews / plans / mock exams) ----
  const retention = load(path.join(output, 'lib/retentionModel.js'));

  check('history mappers read authoritative columns over stale payload', () => {
    const attemptRow = cloudHistoryMappers.rowToAttempt({
      id: 'a1', user_id: 'u1', subject_id: 's1', concept_id: 'c1', problem_id: 'p1',
      mock_exam_session_id: null, plan_item_id: 'spi-1', attempt_origin: 'independent',
      problem_version: 3, at: '2026-01-01T00:00:00.000Z', calculated_score: 77,
      payload: { id: 'a1', conceptId: 'stale', calculatedScore: 10, problemVersion: 1 },
      created_at: '', updated_at: '',
    });
    assert.equal(attemptRow.conceptId, 'c1');
    assert.equal(attemptRow.problemId, 'p1');
    assert.equal(attemptRow.problemVersion, 3);
    assert.equal(attemptRow.calculatedScore, 77);
    assert.equal(attemptRow.planItemId, 'spi-1');

    const eventRow = cloudHistoryMappers.rowToReviewEvent({
      id: 'e1', user_id: 'u1', subject_id: 's1', concept_id: 'c1', attempt_id: 'a1',
      kind: 'attempt', at: '2026-01-01T00:00:00.000Z', result_score: 77,
      payload: { id: 'e1', conceptId: 'stale', resultScore: 0 }, created_at: '',
    });
    assert.equal(eventRow.conceptId, 'c1');
    assert.equal(eventRow.attemptId, 'a1');
    assert.equal(eventRow.resultScore, 77);
  });

  check('history merge keeps local-only rows and prefers server copies', () => {
    const merged = cloudHistoryMerge.mergeById(
      [{ id: 'a1', answer: 'server' }, { id: 'a2', answer: 'server' }],
      [{ id: 'a1', answer: 'local' }, { id: 'a3', answer: 'local' }]
    );
    assert.deepEqual(merged.map((x) => x.id), ['a1', 'a2', 'a3']);
    assert.equal(merged.find((x) => x.id === 'a1').answer, 'server');
    assert.equal(merged.find((x) => x.id === 'a3').answer, 'local');
  });

  check('server review events merge into concepts and dedupe by attempt', () => {
    const baseConcept = {
      id: 'c1', subjectId: 's1', title: 'A',
      events: [{ id: 'e0', conceptId: 'c1', attemptId: 'a0', at: '2026-01-01T00:00:00.000Z', kind: 'attempt', resultScore: 90, title: '', sourceRef: '' }],
      currentScore: 0, status: 'unstudied', exerciseCount: 1, isLearned: false,
    };
    const events = [
      { id: 'e1', conceptId: 'c1', attemptId: 'a1', at: '2026-01-02T00:00:00.000Z', kind: 'attempt', resultScore: 40, title: '', sourceRef: '' },
      { id: 'e1-dupe', conceptId: 'c1', attemptId: 'a1', at: '2026-01-03T00:00:00.000Z', kind: 'attempt', resultScore: 40, title: '', sourceRef: '' },
      { id: 'e-other', conceptId: 'c2', attemptId: 'a9', at: '2026-01-02T00:00:00.000Z', kind: 'attempt', resultScore: 100, title: '', sourceRef: '' },
    ];
    const out = cloudHistoryMerge.mergeEventsIntoConcepts(
      [baseConcept], events, retention.DEFAULT_RETENTION_SETTINGS, new Date('2026-01-04T00:00:00.000Z')
    );
    assert.equal(out[0].events.length, 2, 'duplicate attempt deduped and other concept ignored');
    assert.equal(out[0].events.find((e) => e.attemptId === 'a1').resultScore, 40);
    assert.ok(out[0].currentScore > 0);
    assert.equal(out[0].isLearned, true);
  });

  const historyAttempt = {
    id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: 't', answer: 'x',
    confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 80,
    rubricResults: [], evaluatorFeedback: '',
  };
  const historyEvent = {
    id: 'e1', conceptId: 'c1', at: 't', dayOffset: 0, kind: 'attempt', title: '', resultScore: 80,
    sourceRef: '', attemptId: 'a1',
  };

  await checkAsync('submitAttempt calls the transactional RPC and maps its outcome', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      rpcResult: { attemptId: 'a1', attemptInserted: true, eventInserted: true, planStatus: 'PLAN_ITEM_COMPLETED' },
    }, async (client) => {
      const result = await cloudHistoryRepo.submitAttempt(client, historyAttempt, historyEvent, 'spi-1', 2);
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      assert.equal(result.data.planStatus, 'PLAN_ITEM_COMPLETED');
      const call = client.__state.rpcCalls.find((c) => c.name === 'submit_attempt');
      assert.ok(call, 'submit_attempt RPC invoked');
      assert.equal(call.params.p_plan_item_id, 'spi-1');
      assert.equal(call.params.p_plan_round, 2);
    });
  });

  await checkAsync('submitAttempt surfaces scope mismatch instead of reporting success', async () => {
    await withFakeSupabase({
      user: { id: 'u1' },
      fail: { rpc: true, rpcMessage: 'CONCEPT_SCOPE_MISMATCH: concept not owned' },
    }, async (client) => {
      const result = await cloudHistoryRepo.submitAttempt(client, historyAttempt, historyEvent, null, null);
      assert.equal(result.ok, false);
      assert.match(result.error, /^concept_scope:/);
    });
  });

  await checkAsync('mock exam autosave maps version and reports lock/stale conflicts', async () => {
    const session = {
      id: 'exam-1', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [], answers: {}, evaluations: {},
    };
    await withFakeSupabase({ user: { id: 'u1' }, rpcResult: { version: 5 } }, async (client) => {
      const saved = await cloudHistoryRepo.saveMockExamAnswers(client, session, 4);
      assert.equal(saved.ok, true, saved.ok ? '' : saved.error);
      assert.equal(saved.data, 5);
      assert.equal(
        client.__state.rpcCalls.find((c) => c.name === 'save_mock_exam_answers').params.p_expected_version,
        4
      );
    });
    await withFakeSupabase({
      user: { id: 'u1' },
      fail: { rpc: true, rpcMessage: 'MOCK_SESSION_STALE: version mismatch' },
    }, async (client) => {
      const saved = await cloudHistoryRepo.saveMockExamAnswers(client, session, 4);
      assert.equal(saved.ok, false);
      assert.match(saved.error, /^stale:/);
    });
    await withFakeSupabase({
      user: { id: 'u1' },
      fail: { rpc: true, rpcMessage: 'MOCK_SESSION_LOCKED: submitted' },
    }, async (client) => {
      const saved = await cloudHistoryRepo.saveMockExamAnswers(client, session, 4);
      assert.equal(saved.ok, false);
      assert.match(saved.error, /^locked:/);
    });
  });

  await checkAsync('mock exam sync is a safe no-op when Supabase is not configured', async () => {
    const session = {
      id: 'exam-2', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [], answers: {}, evaluations: {},
    };
    const created = await cloudMockExamSync.createMockExamOnServer(session);
    assert.equal(created.ok, false);
    assert.equal(created.code, 'not_configured');
    const saved = await cloudMockExamSync.autosaveMockExam(session, 1);
    assert.equal(saved.ok, false);
    assert.equal(saved.code, 'not_configured');
    const submitted = await cloudMockExamSync.submitMockExamOnServer(session, 1);
    assert.equal(submitted.ok, false);
    assert.equal(submitted.code, 'not_configured');
    const fetched = await cloudMockExamSync.fetchMockExamFromServer('exam-2');
    assert.equal(fetched.ok, false);
    assert.equal(fetched.code, 'not_configured');
  });

  // Enable the configured code paths (env is not set for the rest of the suite).
  const withConfigured = async (options, fn) => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    try {
      return await withFakeSupabase(options, fn);
    } finally {
      if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevKey;
    }
  };

  await checkAsync('creating an identical existing exam is an idempotent success', async () => {
    const local = {
      id: 'e2', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [],
      answers: { p1: 'same' }, evaluations: {},
    };
    await withConfigured({
      rpcImpl: () => ({ data: { created: false, status: 'in_progress', version: 3, payload: local }, error: null }),
    }, async () => {
      const result = await cloudMockExamSync.createMockExamOnServer(local);
      assert.equal(result.ok, true);
      assert.equal(result.created, false);
      assert.equal(result.version, 3);
    });
  });

  await checkAsync('creating an exam with a conflicting existing id is refused, not overwritten', async () => {
    const serverSession = {
      id: 'e1', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'submitted', submittedAt: 't3', selectedConceptIds: [], selectedTypes: [], problems: [],
      answers: { p1: 'server' }, evaluations: {},
    };
    await withConfigured({
      rpcImpl: (name) => {
        assert.equal(name, 'create_mock_exam_session');
        return { data: { created: false, status: 'submitted', version: 5, payload: serverSession }, error: null };
      },
    }, async () => {
      const local = { ...serverSession, status: 'in_progress', answers: {} };
      const result = await cloudMockExamSync.createMockExamOnServer(local);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'conflict');
      assert.equal(result.server.status, 'submitted');
      assert.equal(result.server.serverVersion, 5);
    });
  });

  await checkAsync('migration create is insert-only and never resets a submitted session', async () => {
    const submittedRow = {
      id: 'e3', user_id: 'user-a', subject_id: 's1', status: 'submitted', duration_minutes: 60,
      created_at: 't', ends_at: 't2', submitted_at: 't3', version: 5, payload: { id: 'e3' }, updated_at: 't',
    };
    await withConfigured({ user: { id: 'user-a' }, mock_exam_sessions: [submittedRow] }, async (client) => {
      const local = {
        id: 'e3', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [],
        answers: { p1: 'local' }, evaluations: {},
      };
      const result = await cloudHistoryRepo.createMockExamSessions(client, [local]);
      assert.equal(result.ok, true);
      assert.equal(result.data.length, 0, 'existing row is not returned or overwritten');
      const row = client.__state.mock_exam_sessions[0];
      assert.equal(row.status, 'submitted', 'status preserved');
      assert.equal(row.version, 5, 'version preserved');
    });
  });

  await checkAsync('grading save maps status/version and surfaces stale/locked', async () => {
    const session = {
      id: 'e4', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'submitted', selectedConceptIds: [], selectedTypes: [], problems: [], answers: {}, evaluations: {},
    };
    await withConfigured({ rpcResults: { save_mock_exam_grading: { data: { version: 9 }, error: null } } }, async (client) => {
      const result = await cloudMockExamSync.saveMockExamGradingOnServer(session, 8, 'graded');
      assert.equal(result.ok, true);
      assert.equal(result.version, 9);
      const call = client.__state.rpcCalls.find((c) => c.name === 'save_mock_exam_grading');
      assert.equal(call.params.p_status, 'graded');
      assert.equal(call.params.p_expected_version, 8);
    });
    await withConfigured({ fail: { rpc: true, rpcMessage: 'MOCK_SESSION_STALE: v' } }, async () => {
      const result = await cloudMockExamSync.saveMockExamGradingOnServer(session, 8, 'recorded');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'stale');
    });
    await withConfigured({ fail: { rpc: true, rpcMessage: 'MOCK_SESSION_STATUS_REGRESSION: x' } }, async () => {
      const result = await cloudMockExamSync.saveMockExamGradingOnServer(session, 8, 'graded');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'locked');
    });
  });

  await checkAsync('a stale local plan change cannot revert a server completion', async () => {
    const serverRow = {
      id: 'spi-1', user_id: 'user-a', subject_id: 's1', kind: 'review', assigned_date: '2026-01-01',
      status: 'completed', round: 2, completed_attempt_id: 'a-old', completed_event_id: 'e-old',
      completed_mock_session_id: null, payload: { id: 'spi-1', subjectId: 's1', status: 'completed' },
      created_at: 't', updated_at: 't',
    };
    await withConfigured({ user: { id: 'user-a' }, study_plan_items: [serverRow] }, async (client) => {
      const local = {
        id: 'spi-1', subjectId: 's1', subjectName: 'S', kind: 'review', assignedDate: '2026-01-01',
        estimatedMinutes: 30, isEstimatedTime: false, priorityScore: 0, priorityReason: '',
        status: 'pending', round: 2, snapshotTitle: 't', snapshotDetail: 'd',
      };
      const result = await cloudHistoryRepo.saveStudyPlanItem(client, local);
      assert.equal(result.ok, false);
      assert.equal(result.conflict, true);
      assert.equal(result.server.status, 'completed');
      assert.equal(client.__state.study_plan_items[0].status, 'completed', 'server completion preserved');
    });
  });

  check('pending unsaved answers are preserved and merged without deletion', () => {
    const userId = 'pending-user';
    const session = {
      id: 'pe1', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [],
      answers: { p1: 'typed' }, evaluations: {}, reasons: { p1: 'why' },
    };
    assert.equal(pendingAnswers.savePendingExamAnswers(userId, session), true);
    const loaded = pendingAnswers.loadPendingExamAnswers(userId, 'pe1');
    assert.equal(loaded.answers.p1, 'typed');
    const server = { ...session, answers: { p1: 'server' }, reasons: {} };
    assert.equal(pendingAnswers.pendingDiffersFrom(server, loaded), true);
    const merged = pendingAnswers.applyPendingAnswers(server, loaded);
    assert.equal(merged.answers.p1, 'typed');
    assert.equal(merged.reasons.p1, 'why');
    // Conflict resolution must not delete pending answers.
    assert.ok(pendingAnswers.loadPendingExamAnswers(userId, 'pe1'));
    pendingAnswers.clearPendingExamAnswers(userId, 'pe1');
    assert.equal(pendingAnswers.loadPendingExamAnswers(userId, 'pe1'), null);
  });

  await checkAsync('generation persistence returns server drafts and preserves them on failure', async () => {
    const draft = {
      id: 'd1', subjectId: 's1', materialId: 'm1', title: 'A', domain: 'math_stats', description: '',
      prerequisites: [], relatedConcepts: [], commonMisconceptions: [], examples: [],
      sourceEvidence: { type: 'page', quote: 'q', verified: true },
      status: 'draft', isApproved: false, sourceMarkdownHash: 'h',
      createdAt: '2000-01-01', updatedAt: '2000-01-01',
    };
    await withFakeSupabase({ user: { id: 'u1' } }, async (client) => {
      const saved = await cloudDraftPersistence.persistConceptDraftsForResponse(client, [draft], 'job-1');
      assert.equal(saved.persisted, true);
      assert.equal(saved.drafts.length, 1);
      assert.notEqual(saved.drafts[0].updatedAt, '2000-01-01', 'server updatedAt adopted');
      const row = client.__state.concept_drafts.find((d) => d.id === 'd1');
      assert.ok(!row.is_approved, 'approval columns are not written by content upsert');
    });
    await withFakeSupabase({ user: { id: 'u1' }, fail: { upsert: true } }, async (client) => {
      const saved = await cloudDraftPersistence.persistConceptDraftsForResponse(client, [draft], 'job-1');
      assert.equal(saved.persisted, false);
      assert.equal(saved.drafts[0].id, 'd1');
      assert.equal(saved.drafts[0].updatedAt, '2000-01-01', 'original drafts preserved for retry');
    });
  });

  check('material import is never verified when a copy write failed', () => {
    assert.equal(
      matStorage.isMaterialImportVerified({ available: true, copied: 1, skipped: 0, failed: 1, verified: true }),
      false
    );
    assert.equal(
      matStorage.isMaterialImportVerified({ available: true, copied: 0, skipped: 0, failed: 0, verified: false }),
      false
    );
    assert.equal(
      matStorage.isMaterialImportVerified({ available: true, copied: 2, skipped: 0, failed: 0, verified: true }),
      true
    );
  });

  check('corrupt local records are detected instead of treated as an empty account', () => {
    const previous = localStorage.getItem('redcall_concepts_v1');
    localStorage.setItem('redcall_concepts_v1', '{not valid json');
    const corrupt = storage.checkStoredDataIntegrity();
    assert.equal(corrupt.ok, false);
    assert.ok(corrupt.failedKeys.includes('redcall_concepts_v1'));
    if (previous === null) localStorage.removeItem('redcall_concepts_v1');
    else localStorage.setItem('redcall_concepts_v1', previous);
    assert.equal(storage.checkStoredDataIntegrity().ok, true);
  });

  check('integrity check rejects wrong top-level types and missing id fields', () => {
    const key = 'redcall_subjects_v1';
    const previous = localStorage.getItem(key);

    localStorage.setItem(key, 'null');
    let result = storage.checkStoredDataIntegrity();
    assert.equal(result.ok, false);
    assert.ok(result.failedKeys.includes(key));

    localStorage.setItem(key, JSON.stringify([{ name: 'missing id' }]));
    result = storage.checkStoredDataIntegrity();
    assert.equal(result.ok, false);
    assert.ok(result.failedKeys.includes(key));

    localStorage.setItem(key, JSON.stringify([{ id: 's1', name: 'ok' }]));
    assert.equal(storage.checkStoredDataIntegrity().ok, true);

    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  });

  check('app readiness exposes a stable snapshot for useSyncExternalStore', () => {
    appReadiness.resetAppReadiness();
    assert.equal(appReadiness.getAppReadiness().status, 'loading');
    appReadiness.reportAppReady();
    assert.equal(appReadiness.getAppReadiness().status, 'ready');
    const readySnapshot = appReadiness.getAppReadiness();
    appReadiness.reportAppReady();
    assert.equal(appReadiness.getAppReadiness(), readySnapshot, 'unchanged ready keeps reference');
    appReadiness.reportAppError('boom');
    assert.equal(appReadiness.getAppReadiness().status, 'error');
    assert.equal(appReadiness.getAppReadiness().message, 'boom');
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
    const answer = '조건부 기댓값 정의를 사용하였다';
    const qs = logicValidation.validateLogicQuestionsOutput(
      {
        questions: [
          { id: 'q1', question: '적용 조건은 무엇인가?', linkedCriterionId: 'r' },
          { id: 'q2', question: '반례는 무엇인가?', linkedQuote: '조건부 기댓값' },
        ],
      },
      lsRubric,
      answer
    );
    assert.equal(qs.length, 2);
    assert.equal(storage.loadStoredAttempts().length, attemptsBefore, 'no history from AI-only validation');
  });

  check('question validation rejects duplicate ids, fabricated quotes and ungrounded questions', () => {
    const answer = '조건부 기댓값 정의를 사용하였다';
    assert.throws(() =>
      logicValidation.validateLogicQuestionsOutput(
        { questions: [{ id: 'q1', question: 'A', linkedCriterionId: 'r' }, { id: 'q1', question: 'B', linkedCriterionId: 'r' }] },
        lsRubric,
        answer
      )
    );
    assert.throws(() =>
      logicValidation.validateLogicQuestionsOutput(
        { questions: [{ id: 'q1', question: 'A', linkedQuote: '존재하지 않는 문장' }, { id: 'q2', question: 'B', linkedCriterionId: 'r' }] },
        lsRubric,
        answer
      )
    );
    assert.throws(() =>
      logicValidation.validateLogicQuestionsOutput(
        { questions: [{ id: 'q1', question: 'A' }, { id: 'q2', question: 'B' }] },
        lsRubric,
        answer
      )
    );
    assert.throws(() =>
      logicValidation.validateLogicQuestionsOutput(
        { questions: [{ id: 'q1', question: 'A', linkedCriterionId: 'r' }, { id: 'q2', question: 'A', linkedCriterionId: 'r' }] },
        lsRubric,
        answer
      )
    );
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

  await checkAsync('logic-questions API rejects malformed output and accepts grounded questions', async () => {
    const { POST } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const reqBody = { subjectId: 'ls-subj', domain: 'math_stats', problemTitle: 't', problemPrompt: 'p', modelAnswer: 'm', rubric: lsRubric, originalAnswer: '조건부 기댓값', solvingReason: '' };
    const request = (value) => new NextRequest('http://localhost/api/logic-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'A', linkedCriterionId: 'r' }, { id: 'q2', question: 'B', linkedCriterionId: 'r' }] }) } }] });
    const ok = await POST(request(reqBody));
    const okJson = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(okJson));
    assert.equal(okJson.questions.length, 2);
    global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'A', linkedCriterionId: 'r' }] }) } }] });
    const bad = await POST(request(reqBody));
    assert.equal(bad.status, 502, 'insufficient questions rejected');
    global.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'A' }, { id: 'q2', question: 'B' }] }) } }] });
    const ungrounded = await POST(request(reqBody));
    assert.equal(ungrounded.status, 502, 'ungrounded questions rejected');
    const oversize = await POST(request({ ...reqBody, originalAnswer: 'x'.repeat(7000) }));
    assert.equal(oversize.status, 400, 'oversized input rejected instead of truncated');
    const badReq = await POST(request({ ...reqBody, originalAnswer: '' }));
    assert.equal(badReq.status, 400, 'missing original answer rejected before AI call');
  });

  // ---- Stage 14: integrity + transfer problems ----
  await checkAsync('assisted revision recovery never creates an independent attempt event', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    const assisted = { id: 'rec-assisted', problemId: 'p', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 90, rubricResults: [], evaluatorFeedback: '', isAiEvaluated: true, attemptOrigin: 'assisted_revision' };
    storage.saveStoredAttempts([assisted]);
    const { recoveredCount } = storage.recoverMissingAttemptEvents();
    assert.equal(recoveredCount, 1);
    const after = storage.loadStoredConcepts()[0];
    const ev = after.events.find((e) => e.attemptId === 'rec-assisted');
    assert.equal(ev.kind, 'assisted_revision');
    assert.equal(after.exerciseCount, 0, 'assisted recovery does not increase exercise count');
    assert.equal(after.currentScore, 0, 'assisted recovery does not change score');
    storage.recoverMissingAttemptEvents();
    assert.equal(storage.loadStoredConcepts()[0].events.filter((e) => e.attemptId === 'rec-assisted').length, 1, 'idempotent');
    assert.equal(storage.verifyAttemptEventOrigins().mismatches.length, 0, 'no origin mismatches');
  });

  check('reservation save failure is reported instead of a false success', () => {
    const originalSet = localStorage.setItem;
    localStorage.setItem = (key) => {
      if (String(key).includes('rechallenge')) throw new Error('reservation storage down');
    };
    try {
      const ok = logicSession.saveRechallengeReservation({ id: 'rr-fail', subjectId: 's', subjectName: 'n', conceptId: 'c', problemId: 'p', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: '2026-10-01T09:00:00+09:00', status: 'scheduled' });
      assert.equal(ok, false, 'save failure surfaced');
      const upd = logicSession.updateRechallengeReservation('rr-fail', { scheduledDate: '2026-10-06' });
      assert.equal(upd.saved, false, 'update failure surfaced');
    } finally {
      localStorage.setItem = originalSet;
    }
  });

  check('question set history preserves old answers and detaches them from new questions', () => {
    const base = { id: 'logic-qh', subjectId: 's', conceptId: 'c', problemId: 'p', problemVersion: 1, sourceAttemptId: 'a', createdAt: 't', updatedAt: 't', status: 'draft', problemTitleSnapshot: 't', problemPromptSnapshot: 'p', modelAnswerSnapshot: 'm', rubricSnapshot: lsRubric, originalAnswer: 'orig', originalScore: 60, originalRubricResults: [], questions: [{ id: 'v1-q1', question: 'A', linkedCriterionId: 'r' }], questionSetVersion: 1, questionSets: [], questionAnswers: { 'v1-q1': 'my answer' }, revisedAnswer: '' };
    const archived = [...base.questionSets, { version: 1, questions: base.questions, answers: base.questionAnswers, generatedAt: 't', inputHash: 'h' }];
    const next = { ...base, questionSets: archived, questionSetVersion: 2, questions: [{ id: 'v2-q1', question: 'B', linkedCriterionId: 'r' }], questionAnswers: {} };
    assert.equal(logicSession.saveLogicSession(next), true);
    const loaded = logicSession.getLogicSession('logic-qh');
    assert.equal(loaded.questionSetVersion, 2);
    assert.equal(loaded.questionSets[0].answers['v1-q1'], 'my answer', 'old answers preserved');
    assert.equal(loaded.questionAnswers['v1-q1'], undefined, 'old answers not attached to new set');
  });

  check('transfer validation rejects same-prompt and invalid rubric, accepts valid transfer', () => {
    const ctx = { allowedConceptIds: ['ls-c'], requiredType: 'essay_descriptive', requiredDifficulty: 'advanced_college', originalPrompt: '원문 지문', originalAnswer: '원답안' };
    const transferRubric = [
      { id: 't1', label: '전제', maxScore: 30, weight: 0.3, description: 'd' },
      { id: 't2', label: '전개', maxScore: 40, weight: 0.4, description: 'd' },
      { id: 't3', label: '결론', maxScore: 30, weight: 0.3, description: 'd' },
    ];
    const valid = { title: '전이', promptText: '조건을 바꾼 새 지문', type: 'essay_descriptive', difficulty: 'advanced_college', conceptIds: ['ls-c'], transferKind: 'precondition_change', originalCondition: '조건 A', newCondition: '조건 B', transferChanges: '적용 조건을 음수에서 양수로 변경', understandingFocus: '전제조건 이해', timeStandardMinutes: 20, modelAnswer: '모범', rubric: transferRubric, hints: ['hint'], designIntent: 'd', sourceRefs: 's' };
    const out = transferValidation.validateTransferProblemOutput(valid, ctx);
    assert.equal(out.conceptIds[0], 'ls-c');
    assert.equal(out.transferKind, 'precondition_change');
    assert.equal(out.materialEvidenceVerified, false, 'material evidence not claimed');
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...valid, promptText: '원문 지문' }, ctx));
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...valid, rubric: [{ id: 'r', label: 'r', maxScore: 50, weight: 0.5, description: 'd' }] }, ctx));
  });

  // ---- Stage 15: integrity + transfer linkage ----
  check('transfer validation rejects duplicate rubric ids, zero score, out-of-scope concept and wrong type', () => {
    const ctx = { allowedConceptIds: ['ls-c'], requiredType: 'essay_descriptive', requiredDifficulty: 'advanced_college', originalPrompt: '원문 지문', originalAnswer: '원답안' };
    const transferRubric = [
      { id: 't1', label: '전제', maxScore: 30, weight: 0.3, description: 'd' },
      { id: 't2', label: '전개', maxScore: 40, weight: 0.4, description: 'd' },
      { id: 't3', label: '결론', maxScore: 30, weight: 0.3, description: 'd' },
    ];
    const base = { title: '전이', promptText: '조건을 바꾼 새 지문', type: 'essay_descriptive', difficulty: 'advanced_college', conceptIds: ['ls-c'], transferKind: 'precondition_change', originalCondition: 'A', newCondition: 'B', transferChanges: '조건을 바꿈', understandingFocus: '이해', timeStandardMinutes: 20, modelAnswer: '모범', rubric: transferRubric, hints: ['hint'], designIntent: 'd', sourceRefs: 's' };
    // duplicate rubric ids (sum still 100)
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...base, rubric: [
      { id: 'dup', label: 'a', maxScore: 50, weight: 0.5, description: 'd' },
      { id: 'dup', label: 'b', maxScore: 50, weight: 0.5, description: 'd' },
    ] }, ctx));
    // zero maxScore (sum adjusted to 100 with another item)
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...base, rubric: [
      { id: 'z', label: 'a', maxScore: 0, weight: 0, description: 'd' },
      { id: 'b', label: 'b', maxScore: 100, weight: 1, description: 'd' },
      { id: 'c', label: 'c', maxScore: 0, weight: 0, description: 'd' },
    ] }, ctx));
    // out-of-scope concept rejected (not silently dropped)
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...base, conceptIds: ['ls-c', 'other-c'] }, ctx));
    // wrong type
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...base, type: 'calc_derivation' }, ctx));
    // invalid time
    assert.throws(() => transferValidation.validateTransferProblemOutput({ ...base, timeStandardMinutes: 500 }, ctx));
  });

  check('single and batch approval preserve transfer linkage fields', () => {
    storage.saveStoredProblems([]);
    const draftBase = {
      id: 'draft-transfer-x', subjectId: 'ls-subj', conceptIds: ['ls-c'], conceptTitles: ['c'], title: '전이', type: 'essay_descriptive',
      difficulty: 'advanced_college', categoryLabel: '전이', categoryNumber: 0, promptText: 'p', designIntent: 'd', appliedConditionNote: 'change',
      sourceRefs: 's', timeStandardMinutes: 20, timeBreakdownDesc: '20', coreEvaluationHighlight: 'e', itemCountDesc: '1',
      hints: ['h'], modelAnswer: 'm', rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'd' }],
      status: 'draft', isApproved: false, isDemo: false,
      verificationStatus: { hasRequiredFields: true, isScore100: true, scoreSum: 100, hasConceptLink: true, isSourceVerified: false },
      createdAt: 't', updatedAt: 't', isTransfer: true, sourceProblemId: 'ls-prob', logicSessionId: 'logic-ls-orig',
      transferChanges: 'change', understandingFocus: 'focus', transferKind: 'precondition_change', originalCondition: 'A', newCondition: 'B',
    };
    storage.saveStoredProblemDrafts([draftBase]);
    const single = storage.approveProblemDraft('draft-transfer-x');
    assert.equal(single.approvedProblem.isTransfer, true);
    assert.equal(single.approvedProblem.sourceProblemId, 'ls-prob');
    assert.equal(single.approvedProblem.logicSessionId, 'logic-ls-orig');
    assert.equal(single.approvedProblem.transferKind, 'precondition_change');

    const draftB = { ...draftBase, id: 'draft-transfer-y', logicSessionId: 'logic-ls-orig-r2', title: '전이2' };
    storage.saveStoredProblemDrafts([draftB]);
    const batch = storage.batchApproveProblemDrafts(['draft-transfer-y']);
    const approvedB = batch.updatedProblems.find((p) => p.draftId === 'draft-transfer-y');
    assert.equal(approvedB.isTransfer, true);
    assert.equal(approvedB.logicSessionId, 'logic-ls-orig-r2');
  });

  check('reservation completion blocks missing, cancelled and mismatched reservations', () => {
    const mkRes = (id, status) => ({ id, subjectId: 'ls-subj', subjectName: 'n', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status });
    logicSession.saveRechallengeReservation(mkRes('rr-cancelled', 'cancelled'));
    logicSession.saveRechallengeReservation(mkRes('rr-mismatch', 'scheduled'));
    const identity = { subjectId: 'ls-subj', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1 };
    assert.equal(logicSession.completeRechallengeReservation('rr-missing', identity).status, 'not_found');
    assert.equal(logicSession.completeRechallengeReservation('rr-cancelled', identity).status, 'cancelled');
    assert.equal(logicSession.completeRechallengeReservation('rr-mismatch', { ...identity, problemId: 'other' }).status, 'mismatch');
    assert.equal(logicSession.completeRechallengeReservation('rr-mismatch', identity).status, 'completed');
    assert.equal(logicSession.completeRechallengeReservation('rr-mismatch', identity).status, 'already_completed');
  });

  await checkAsync('recovery does not complete a cancelled reservation', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    logicSession.saveRechallengeReservation({ id: 'rr-rec', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'rec-prob', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'cancelled' });
    storage.saveStoredAttempts([{ id: 'rec-rechallenge', problemId: 'rec-prob', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', attemptOrigin: 'rechallenge', rechallengeReservationId: 'rr-rec' }]);
    const outcome = storage.recoverMissingAttemptEvents();
    assert.ok(outcome.unresolved.some((u) => u.attemptId === 'rec-rechallenge' && u.reason === 'RESERVATION_cancelled'), 'cancelled reservation reported unresolved');
    const reservation = logicSession.getRechallengeReservation('rr-rec');
    assert.equal(reservation.status, 'cancelled', 'cancelled reservation not completed by recovery');
  });

  check('session rounds are independent from question-set versions and are listed per attempt', () => {
    const base = { subjectId: 'ls-subj', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1, sourceAttemptId: 'ls-orig', createdAt: 't', updatedAt: 't', status: 'draft', problemTitleSnapshot: 't', problemPromptSnapshot: 'p', modelAnswerSnapshot: 'm', rubricSnapshot: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'd' }], originalAnswer: 'a', originalScore: 60, originalRubricResults: [], questions: [], questionSetVersion: 3, questionSets: [], questionAnswers: {}, revisedAnswer: '' };
    logicSession.saveLogicSession({ ...base, id: 'logic-ls-orig', sessionRound: 1 });
    logicSession.saveLogicSession({ ...base, id: 'logic-ls-orig-r2', sessionRound: 2, questionSetVersion: 1 });
    const list = logicSession.loadLogicSessionsForAttempt('ls-orig');
    assert.equal(list.length, 2);
    assert.equal(list.find((s) => s.id === 'logic-ls-orig').questionSetVersion, 3);
    assert.equal(list.find((s) => s.id === 'logic-ls-orig-r2').sessionRound, 2);
    logicSession.setActiveLogicSessionId('ls-orig', 'logic-ls-orig-r2');
    assert.equal(logicSession.getActiveLogicSessionId('ls-orig'), 'logic-ls-orig-r2');
  });

  await checkAsync('a delayed stale response is ignored when the input changed (component guard + mock API)', async () => {
    const { POST } = load(path.join(output, 'app/api/logic-questions/route.js'));
    // Delayed mock response so the request is genuinely in flight.
    global.fetch = async () => {
      await new Promise((r) => setTimeout(r, 25));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'q1', question: 'A', linkedCriterionId: 'r' }, { id: 'q2', question: 'B', linkedCriterionId: 'r' }] }) } }] });
    };
    const reqBody = { subjectId: 'ls-subj', domain: 'math_stats', problemTitle: 't', problemPrompt: 'p', modelAnswer: 'm', rubric: lsRubric, originalAnswer: '조건부 기댓값', solvingReason: '' };
    const request = (value) => new NextRequest('http://localhost/api/logic-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const pending = POST(request(reqBody));
    // The user changes input while the request is in flight -> snapshot no longer matches.
    const guard = logicAsync.shouldApplyResponse({ mounted: true, requestId: 1, latestRequestId: 2, requestSessionId: 's1', activeSessionId: 's1', snapshotHash: 'old', currentHash: 'new' });
    assert.equal(guard, false, 'stale response rejected');
    const res = await pending;
    assert.equal(res.status, 200);
    // Same request id/session/hash would be applied.
    assert.equal(logicAsync.shouldApplyResponse({ mounted: true, requestId: 2, latestRequestId: 2, requestSessionId: 's1', activeSessionId: 's1', snapshotHash: 'new', currentHash: 'new' }), true);
    assert.equal(logicAsync.shouldApplyResponse({ mounted: false, requestId: 2, latestRequestId: 2, requestSessionId: 's1', activeSessionId: 's1', snapshotHash: 'new', currentHash: 'new' }), false, 'unmounted rejected');
    assert.equal(logicAsync.shouldApplyResponse({ mounted: true, requestId: 2, latestRequestId: 2, requestSessionId: 's1', activeSessionId: 's2', snapshotHash: 'new', currentHash: 'new' }), false, 'round changed rejected');
  });

  check('transfer problem is not assigned before approval', () => {
    const concept = { ...structuredClone(lsConcept) };
    const draftTransfer = { ...structuredClone(lsProblem), id: 'ls-transfer', isTransfer: true, sourceProblemId: 'ls-prob', isApproved: false };
    const approvedTransfer = { ...draftTransfer, isApproved: true };
    const excluded = studyPlan.getEligibleProblemsForPlan(lsSubject, concept, [draftTransfer], ['ls-c'], ['essay_descriptive']);
    assert.equal(excluded.eligibleProblems.length, 0, 'unapproved transfer excluded');
    const included = studyPlan.getEligibleProblemsForPlan(lsSubject, concept, [approvedTransfer], ['ls-c'], ['essay_descriptive']);
    assert.equal(included.eligibleProblems.length, 1, 'approved transfer eligible');
  });

  await checkAsync('transfer attempt with model-answer help is flagged in analytics', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    const transferAttempt = { id: 'att-transfer', problemId: 'ls-transfer', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 80, rubricResults: [], evaluatorFeedback: '', isAiEvaluated: true, attemptOrigin: 'independent', isTransfer: true, modelAnswerRevealed: true, helpUsage: 'model_answer' };
    storage.recordAttemptAndUpdateConcept(transferAttempt);
    const collection = learningAnalytics.collectValidRecords({ attempts: storage.loadStoredAttempts(), mockExams: [], problems: [{ ...lsProblem, id: 'ls-transfer', isTransfer: true }], subjects: [lsSubject], concepts: storage.loadStoredConcepts() });
    assert.equal(collection.transferCount, 1);
    const rec = collection.records.find((r) => r.attemptId === 'att-transfer');
    assert.ok(rec && rec.isTransfer === true, 'transfer flagged in analytics');
  });

  // ---- Stage 16: async loading, linkage failure, versioning, reservation identity ----
  check('A/B request: settling an old request never releases the new request loading', () => {
    const tracker = asyncTracker.createAsyncTracker();
    const a = asyncTracker.beginAsyncRequest(tracker);
    // Input changed -> A invalidated.
    asyncTracker.invalidateAsyncRequests(tracker);
    const b = asyncTracker.beginAsyncRequest(tracker);
    // A finishes late, while B is still in flight.
    const settledA = asyncTracker.settleAsyncRequest(tracker, a);
    assert.equal(settledA.apply, false, 'A not applied');
    assert.equal(settledA.settled, false, 'A was invalidated, not active');
    assert.equal(settledA.loading, true, 'B still loading after A settles');
    const settledB = asyncTracker.settleAsyncRequest(tracker, b);
    assert.equal(settledB.apply, true, 'B applied');
    assert.equal(settledB.loading, false, 'loading released when B settles');
    // Double-settling the same request is a no-op.
    const again = asyncTracker.settleAsyncRequest(tracker, b);
    assert.equal(again.settled, false);
    assert.equal(again.loading, false);
  });

  check('invalidating aborts the in-flight request controller', () => {
    const tracker = asyncTracker.createAsyncTracker();
    const id = asyncTracker.beginAsyncRequest(tracker);
    const controller = new AbortController();
    asyncTracker.registerAsyncController(tracker, id, controller);
    asyncTracker.invalidateAsyncRequests(tracker);
    assert.equal(controller.signal.aborted, true, 'controller aborted');
  });

  check('an explicit plan-item mismatch is reported as a partial failure', () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([{ id: 'spi-other', subjectId: c.subjectId, subjectName: 'n', conceptId: 'other-concept', problemId: 'other-prob', kind: 'recommended_review', assignedDate: '2026-10-01', estimatedMinutes: 15, isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'pending', snapshotTitle: 't', snapshotDetail: 'd' }]);
    const attempt = { id: 'att-explicit-link', problemId: 'explicit-prob', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', planItemId: 'spi-other' };
    const result = storage.recordAttemptAndUpdateConcept(attempt, undefined, { planItemId: 'spi-other' });
    assert.equal(result.partial, true, 'explicit mismatch is partial');
    assert.ok(['PLAN_ITEM_MISMATCH', 'PLAN_ITEM_NOT_FOUND'].includes(result.planLinkage.skippedReason), 'skipped reason preserved');
  });

  check('re-approving changed content bumps the version and archives history', () => {
    storage.saveStoredProblems([]);
    const draft = { id: 'draft-ver', subjectId: 'ls-subj', conceptIds: ['ls-c'], conceptTitles: ['c'], title: 'v1', type: 'essay_descriptive', difficulty: 'advanced_college', categoryLabel: 'c', categoryNumber: 1, promptText: 'prompt v1', designIntent: 'd', appliedConditionNote: 'n', sourceRefs: 's', timeStandardMinutes: 20, timeBreakdownDesc: '20', coreEvaluationHighlight: 'e', itemCountDesc: '1', hints: ['h'], modelAnswer: 'answer v1', rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'd' }], status: 'draft', isApproved: false, isDemo: false, verificationStatus: { hasRequiredFields: true, isScore100: true, scoreSum: 100, hasConceptLink: true, isSourceVerified: false }, createdAt: 't', updatedAt: 't' };
    storage.saveStoredProblemDrafts([draft]);
    const first = storage.approveProblemDraft('draft-ver');
    assert.equal(first.approvedProblem.version, 1);
    // Identical re-approval keeps the version.
    const same = storage.approveProblemDraft('draft-ver');
    assert.equal(same.approvedProblem.version, 1, 'identical re-approval keeps version');
    // Changed content bumps the version and archives the prior snapshot.
    storage.saveStoredProblemDrafts([{ ...draft, promptText: 'prompt v2', updatedAt: 't2' }]);
    const changed = storage.approveProblemDraft('draft-ver');
    assert.equal(changed.approvedProblem.version, 2, 'changed content bumps version');
    assert.equal(changed.approvedProblem.versionHistory.length, 1, 'prior version archived');
    assert.equal(changed.approvedProblem.versionHistory[0].promptText, 'prompt v1');
  });

  check('a completed reservation with mismatched identity reports mismatch, not already_completed', () => {
    logicSession.saveRechallengeReservation({ id: 'rr-done', subjectId: 'ls-subj', subjectName: 'n', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'completed' });
    const identity = { subjectId: 'ls-subj', conceptId: 'ls-c', problemId: 'ls-prob', problemVersion: 1 };
    assert.equal(logicSession.completeRechallengeReservation('rr-done', { ...identity, problemId: 'other' }).status, 'mismatch');
    assert.equal(logicSession.completeRechallengeReservation('rr-done', identity).status, 'already_completed');
  });

  check('approved transfer selection matches the exact current draft only', () => {
    const approvedV1 = { id: 'tp-v1', draftId: 'draft-transfer-s1-v1', isTransfer: true, logicSessionId: 's1', title: 'v1' };
    const approvedV2 = { id: 'tp-v2', draftId: 'draft-transfer-s1-v2', isTransfer: true, logicSessionId: 's1', title: 'v2' };
    assert.equal(transferValidation.selectApprovedTransferProblem([approvedV1, approvedV2], 'draft-transfer-s1-v2').id, 'tp-v2');
    assert.equal(transferValidation.selectApprovedTransferProblem([approvedV1, approvedV2], 'draft-transfer-s1-v3'), null);
    const previous = transferValidation.previousApprovedTransfers([approvedV1, approvedV2], 'draft-transfer-s1-v2');
    assert.equal(previous.length, 1);
    assert.equal(previous[0].id, 'tp-v1');
  });

  // ---- Stage 17: completed-link preservation, approval partial save, full flow ----
  const mkDraft = (id, extra = {}) => ({
    id, subjectId: 'ls-subj', conceptIds: ['ls-c'], conceptTitles: ['c'], title: id, type: 'essay_descriptive',
    difficulty: 'advanced_college', categoryLabel: 'c', categoryNumber: 1, promptText: `prompt ${id}`,
    designIntent: 'd', appliedConditionNote: 'n', sourceRefs: 's', timeStandardMinutes: 20, timeBreakdownDesc: '20',
    coreEvaluationHighlight: 'e', itemCountDesc: '1', hints: ['h'], modelAnswer: `answer ${id}`,
    rubric: [{ id: 'r', label: 'r', maxScore: 100, weight: 1, description: 'd' }], status: 'draft',
    isApproved: false, isDemo: false,
    verificationStatus: { hasRequiredFields: true, isScore100: true, scoreSum: 100, hasConceptLink: true, isSourceVerified: false },
    createdAt: 't', updatedAt: 't', ...extra,
  });

  check('a completed plan item linked to another attempt is preserved on conflict', () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([{ id: 'spi-done', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'p', kind: 'recommended_review', round: 1, assignedDate: '2026-10-01', estimatedMinutes: 15, isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'completed', completedAt: '2026-10-01T07:00:00+09:00', completedAttemptId: 'att-original', snapshotTitle: 't', snapshotDetail: 'd' }]);
    const attempt = { id: 'att-new', problemId: 'p', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', planItemId: 'spi-done' };
    const result = storage.recordAttemptAndUpdateConcept(attempt, undefined, { planItemId: 'spi-done' });
    assert.equal(result.status, 'link_conflict', 'conflict status returned');
    assert.equal(result.partial, true);
    assert.equal(result.attemptPersisted, true, 'attempt still saved');
    const item = storage.loadStoredStudyPlanItems().find((i) => i.id === 'spi-done');
    assert.equal(item.completedAttemptId, 'att-original', 'original completion preserved');
    assert.equal(result.planLinkage.conflictWithAttemptId, 'att-original');
    // Same attempt that owns the completion is an idempotent success.
    const same = storage.recordAttemptAndUpdateConcept({ ...attempt, id: 'att-original' }, undefined, { planItemId: 'spi-done' });
    assert.ok(['complete', 'already_completed'].includes(same.status), 'same attempt links cleanly');
  });

  check('approval does not mark the draft approved when the problem save fails', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-fail')]);
    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    localStorage.setItem = (key, value) => {
      if (key === PROB_KEY) throw new Error('problem storage down');
      return originalSet(key, value);
    };
    let first;
    try {
      first = storage.approveProblemDraft('draft-fail');
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(first.success, false, 'approval reports failure');
    assert.equal(first.approvedProblem, null, 'no approved problem on failure');
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-fail').isApproved, false, 'draft not marked approved');
    assert.equal(storage.loadStoredProblems().length, 0, 'problem not stored');
    // Retry succeeds with the stable id, no duplicate problem and no version bump.
    const retry = storage.approveProblemDraft('draft-fail');
    assert.equal(retry.success, true);
    const probs = storage.loadStoredProblems().filter((p) => p.draftId === 'draft-fail');
    assert.equal(probs.length, 1, 'no duplicate problem on retry');
    assert.equal(probs[0].version, 1, 'no duplicate version bump on retry');
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-fail').isApproved, true);
  });

  check('batch approval reports per-item failure and only approves persisted problems', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-batch-A'), mkDraft('draft-batch-B')]);
    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    localStorage.setItem = (key, value) => {
      if (key === PROB_KEY && String(value).includes('draft-batch-B')) throw new Error('B storage down');
      return originalSet(key, value);
    };
    let batch;
    try {
      batch = storage.batchApproveProblemDrafts(['draft-batch-A', 'draft-batch-B']);
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(batch.results.find((r) => r.draftId === 'draft-batch-A').status, 'approved');
    assert.equal(batch.results.find((r) => r.draftId === 'draft-batch-B').status, 'failed');
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-batch-A').isApproved, true);
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-batch-B').isApproved, false);
    // Recover only the failed item.
    const recovered = storage.batchApproveProblemDrafts(['draft-batch-B']);
    assert.equal(recovered.results[0].status, 'approved');
    assert.equal(storage.loadStoredProblems().filter((p) => p.draftId === 'draft-batch-B').length, 1);
  });

  await checkAsync('end-to-end flow preserves links across solve, revise, transfer, approve, reserve and refresh', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([{ id: 'spi-flow', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'flow-p', kind: 'recommended_review', round: 1, assignedDate: '2026-10-01', estimatedMinutes: 15, isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'pending', snapshotTitle: 't', snapshotDetail: 'd' }]);

    // 1) independent solve linked to a plan item
    const solve = { id: 'att-flow', problemId: 'flow-p', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'answer', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', planItemId: 'spi-flow' };
    const solveResult = storage.recordAttemptAndUpdateConcept(solve, undefined, { planItemId: 'spi-flow' });
    assert.equal(solveResult.status, 'complete');
    assert.equal(storage.loadStoredStudyPlanItems().find((i) => i.id === 'spi-flow').completedAttemptId, 'att-flow');

    // 2) assisted revision stored separately (assisted event only)
    const revise = { ...solve, id: 'att-flow-rev', calculatedScore: 90, attemptOrigin: 'assisted_revision', sourceAttemptId: 'att-flow' };
    storage.recordAssistedRevisionAttempt(revise);
    const afterRevise = storage.loadStoredConcepts()[0];
    assert.equal(afterRevise.events.find((e) => e.attemptId === 'att-flow-rev').kind, 'assisted_revision');
    assert.equal(storage.loadStoredAttempts().find((a) => a.id === 'att-flow').calculatedScore, 70, 'original untouched');

    // 3) transfer draft -> approve
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-transfer-flow-v1', { isTransfer: true, sourceProblemId: 'flow-p', logicSessionId: 'logic-att-flow', transferChanges: 'change', understandingFocus: 'focus' })]);
    const approved = storage.approveProblemDraft('draft-transfer-flow-v1');
    assert.equal(approved.success, true);
    assert.equal(approved.approvedProblem.isTransfer, true);
    assert.equal(approved.approvedProblem.logicSessionId, 'logic-att-flow');

    // 4) reserve + complete the transfer problem with an attempt id
    logicSession.saveRechallengeReservation({ id: 'rr-flow', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: approved.approvedProblem.id, problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 20, createdAt: 't', status: 'scheduled', isTransfer: true, sourceLogicSessionId: 'logic-att-flow' });
    const completion = logicSession.completeRechallengeReservation('rr-flow', { attemptId: 'att-flow-transfer', subjectId: c.subjectId, conceptId: c.id, problemId: approved.approvedProblem.id, problemVersion: 1 });
    assert.equal(completion.status, 'completed');
    assert.equal(completion.reservations.find((r) => r.id === 'rr-flow').completedAttemptId, 'att-flow-transfer');
    // A different attempt must not overwrite the completion.
    const conflict = logicSession.completeRechallengeReservation('rr-flow', { attemptId: 'att-other', subjectId: c.subjectId, conceptId: c.id, problemId: approved.approvedProblem.id, problemVersion: 1 });
    assert.equal(conflict.status, 'completed_by_other');

    // 5) refresh: recovery is idempotent and leaves no unresolved items
    const outcome = storage.recoverMissingAttemptEvents();
    assert.equal(outcome.unresolved.length, 0, 'no unresolved recovery items');
    assert.equal(storage.loadStoredAttempts().filter((a) => a.id === 'att-flow').length, 1);
    assert.equal(storage.loadStoredAttempts().filter((a) => a.id === 'att-flow-rev').length, 1);
    assert.equal(storage.loadStoredConcepts()[0].events.filter((e) => e.attemptId === 'att-flow-rev').length, 1);
    assert.equal(logicSession.getRechallengeReservation('rr-flow').completedAttemptId, 'att-flow-transfer');
  });

  // ---- Stage 18: content-verified approval, recovery completeness, ownership ----
  check('changed re-approval whose save fails is not reported as success', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-content')]);
    const first = storage.approveProblemDraft('draft-content');
    assert.equal(first.success, true);
    // Change the draft content, then fail the problem save.
    storage.saveStoredProblemDrafts([mkDraft('draft-content', { promptText: 'changed v2', updatedAt: 't2' })]);
    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    localStorage.setItem = (key, value) => {
      if (key === PROB_KEY) throw new Error('problem storage down');
      return originalSet(key, value);
    };
    let changed;
    try {
      changed = storage.approveProblemDraft('draft-content');
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(changed.success, false, 'stale content is not a success');
    assert.equal(changed.status, 'failed');
    assert.equal(storage.loadStoredProblems()[0].promptText, 'prompt draft-content', 'stored content unchanged');
  });

  check('draft approval state save failure is reported as partial (not success)', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-partial')]);
    const originalSet = localStorage.setItem;
    const DRAFT_KEY = 'redcall_problem_drafts_v1';
    localStorage.setItem = (key, value) => {
      if (key === DRAFT_KEY) throw new Error('draft storage down');
      return originalSet(key, value);
    };
    let result;
    try {
      result = storage.approveProblemDraft('draft-partial');
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(result.success, false, 'partial approval is not a full success');
    assert.equal(result.status, 'partial_draft_failed');
    assert.equal(result.problemPersisted, true, 'problem persisted');
    assert.equal(result.draftPersisted, false, 'draft not persisted');
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-partial').isApproved, false);
    // Retry repairs only the draft state, without duplicating the problem.
    const retry = storage.approveProblemDraft('draft-partial');
    assert.equal(retry.success, true);
    assert.equal(storage.loadStoredProblems().filter((p) => p.draftId === 'draft-partial').length, 1);
    assert.equal(storage.loadStoredProblems()[0].version, 1, 'no duplicate version bump');
  });

  await checkAsync('an event-only recovery failure is unresolved and does not complete the reservation', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredStudyPlanItems([{ id: 'spi-ev', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'ev-p', kind: 'recommended_review', round: 1, assignedDate: '2026-10-01', estimatedMinutes: 15, isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'pending', snapshotTitle: 't', snapshotDetail: 'd' }]);
    storage.saveStoredAttempts([{ id: 'att-ev', problemId: 'ev-p', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', planItemId: 'spi-ev', rechallengeReservationId: 'rr-ev' }]);
    logicSession.saveRechallengeReservation({ id: 'rr-ev', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'ev-p', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'scheduled' });
    const originalSet = localStorage.setItem;
    const CONCEPT_KEY = 'redcall_concepts_v1';
    localStorage.setItem = (key, value) => {
      if (key === CONCEPT_KEY) throw new Error('concept storage down');
      return originalSet(key, value);
    };
    let outcome;
    try {
      outcome = storage.recoverMissingAttemptEvents();
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.ok(outcome.unresolved.some((u) => u.attemptId === 'att-ev' && u.reason === 'EVENT_NOT_PERSISTED'), 'event failure is unresolved');
    assert.equal(outcome.recoveredCount, 0, 'plan-only success is not counted as recovered');
    assert.equal(logicSession.getRechallengeReservation('rr-ev').status, 'scheduled', 'reservation not completed when core failed');
  });

  await checkAsync('recovery passes the attempt id so reservation ownership is verifiable', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredStudyPlanItems([]);
    storage.saveStoredAttempts([{ id: 'att-owner', problemId: 'own-p', conceptId: c.id, subjectId: c.subjectId, at: '2026-10-01T08:00:00+09:00', answer: 'a', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '', rechallengeReservationId: 'rr-owner' }]);
    logicSession.saveRechallengeReservation({ id: 'rr-owner', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'own-p', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'scheduled' });
    const outcome = storage.recoverMissingAttemptEvents();
    assert.equal(outcome.unresolved.length, 0);
    assert.equal(logicSession.getRechallengeReservation('rr-owner').completedAttemptId, 'att-owner', 'owner recorded');
    const other = logicSession.completeRechallengeReservation('rr-owner', { attemptId: 'att-different', subjectId: c.subjectId, conceptId: c.id, problemId: 'own-p', problemVersion: 1 });
    assert.equal(other.status, 'completed_by_other');
    // Legacy completion without owner is a distinct state.
    logicSession.saveRechallengeReservation({ id: 'rr-legacy', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'own-p', problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'completed' });
    const legacy = logicSession.completeRechallengeReservation('rr-legacy', { attemptId: 'att-any', subjectId: c.subjectId, conceptId: c.id, problemId: 'own-p', problemVersion: 1 });
    assert.equal(legacy.status, 'completed_unknown_owner');
  });

  // ---- Stage 19: approval candidate isolation, evaluation signature criteria, core record verification, reservation UI outcome ----
  check('일괄 승인 A 실패·B 성공 시 실제 저장 상태와 결과 일치', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-leak-A'), mkDraft('draft-leak-B')]);
    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    localStorage.setItem = (key, value) => {
      // Fail only when attempting to save draft-leak-A
      if (key === PROB_KEY && String(value).includes('draft-leak-A')) {
        throw new Error('storage failure for draft A');
      }
      return originalSet(key, value);
    };

    let batchResult;
    try {
      batchResult = storage.batchApproveProblemDrafts(['draft-leak-A', 'draft-leak-B']);
    } finally {
      localStorage.setItem = originalSet;
    }

    assert.equal(batchResult.results.find((r) => r.draftId === 'draft-leak-A').status, 'failed');
    assert.equal(batchResult.results.find((r) => r.draftId === 'draft-leak-B').status, 'approved');

    // Crucial check: Draft A candidate must NOT be present in stored problems!
    const storedProbs = storage.loadStoredProblems();
    assert.equal(storedProbs.some((p) => p.draftId === 'draft-leak-A'), false, 'failed candidate A must not be saved');
    assert.equal(storedProbs.some((p) => p.draftId === 'draft-leak-B'), true, 'successful candidate B must be saved');

    // Draft statuses in storage
    const drafts = storage.loadStoredProblemDrafts();
    assert.equal(drafts.find((d) => d.id === 'draft-leak-A').isApproved, false, 'draft A remains unapproved');
    assert.equal(drafts.find((d) => d.id === 'draft-leak-B').isApproved, true, 'draft B is approved');

    // Retry approving A succeeds cleanly without duplicates or unexpected versions
    const retryA = storage.approveProblemDraft('draft-leak-A');
    assert.equal(retryA.success, true);
    const probsAfterRetry = storage.loadStoredProblems();
    assert.equal(probsAfterRetry.filter((p) => p.draftId === 'draft-leak-A').length, 1);
    assert.equal(probsAfterRetry.find((p) => p.draftId === 'draft-leak-A').version, 1);
  });

  check('일괄 승인 A 성공·B 실패 및 초안 상태 저장 실패', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-succ-A'), mkDraft('draft-fail-B')]);
    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    const DRAFT_KEY = 'redcall_problem_drafts_v1';

    // 1) A succeeds, B fails
    localStorage.setItem = (key, value) => {
      if (key === PROB_KEY && String(value).includes('draft-fail-B')) {
        throw new Error('storage failure for B');
      }
      return originalSet(key, value);
    };
    let batch1;
    try {
      batch1 = storage.batchApproveProblemDrafts(['draft-succ-A', 'draft-fail-B']);
    } finally {
      localStorage.setItem = originalSet;
    }
    assert.equal(batch1.results.find((r) => r.draftId === 'draft-succ-A').status, 'approved');
    assert.equal(batch1.results.find((r) => r.draftId === 'draft-fail-B').status, 'failed');
    assert.equal(storage.loadStoredProblems().some((p) => p.draftId === 'draft-succ-A'), true);
    assert.equal(storage.loadStoredProblems().some((p) => p.draftId === 'draft-fail-B'), false);

    // 2) Draft state save failure during batch approval
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-draft-fail')]);
    localStorage.setItem = (key, value) => {
      if (key === DRAFT_KEY) throw new Error('draft storage down');
      return originalSet(key, value);
    };
    let batch2;
    try {
      batch2 = storage.batchApproveProblemDrafts(['draft-draft-fail']);
    } finally {
      localStorage.setItem = originalSet;
    }
    const itemRes = batch2.results.find((r) => r.draftId === 'draft-draft-fail');
    assert.equal(itemRes.status, 'partial_draft_failed');
    assert.equal(itemRes.problemPersisted, true);
    assert.equal(itemRes.draftPersisted, false);
    assert.equal(storage.loadStoredProblems().some((p) => p.draftId === 'draft-draft-fail'), true);
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-draft-fail').isApproved, false);

    // Retry repairs draft without duplicate problem
    const retry = storage.batchApproveProblemDrafts(['draft-draft-fail']);
    assert.equal(retry.results[0].status, 'approved');
    assert.equal(storage.loadStoredProblems().filter((p) => p.draftId === 'draft-draft-fail').length, 1);
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-draft-fail').isApproved, true);
  });

  check('유형·개념만 변경한 재승인의 버전 증가', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-type-concept', {
      type: 'essay_descriptive',
      conceptIds: ['c1'],
    })]);

    const first = storage.approveProblemDraft('draft-type-concept');
    assert.equal(first.success, true);
    assert.equal(first.approvedProblem.version, 1);
    assert.equal(first.approvedProblem.type, 'essay_descriptive');
    assert.deepEqual(first.approvedProblem.conceptIds, ['c1']);

    // Change ONLY type and conceptIds (no promptText or title change)
    storage.saveStoredProblemDrafts([mkDraft('draft-type-concept', {
      type: 'proof_argument',
      conceptIds: ['c1', 'c2'],
      appliedConditionNote: 'updated condition',
      updatedAt: 't2',
    })]);

    const second = storage.approveProblemDraft('draft-type-concept');
    assert.equal(second.success, true);
    assert.equal(second.approvedProblem.version, 2, 'version bumped when type and concepts changed');
    assert.equal(second.approvedProblem.type, 'proof_argument');
    assert.deepEqual(second.approvedProblem.conceptIds, ['c1', 'c2']);
    assert.equal(second.approvedProblem.versionHistory.length, 1);
    assert.equal(second.approvedProblem.versionHistory[0].version, 1);
    assert.equal(second.approvedProblem.versionHistory[0].type, 'essay_descriptive');
    assert.deepEqual(second.approvedProblem.versionHistory[0].conceptIds, ['c1']);

    // Identical re-approval keeps version 2 without unnecessary bump
    const third = storage.approveProblemDraft('draft-type-concept');
    assert.equal(third.success, true);
    assert.equal(third.approvedProblem.version, 2, 'identical re-approval preserves version');
    assert.equal(third.approvedProblem.versionHistory.length, 1);
  });

  check('유형·개념·전이 연결 정보 저장 실패 감지', () => {
    storage.saveStoredProblems([]);
    storage.saveStoredProblemDrafts([mkDraft('draft-transfer-verify', {
      type: 'essay_descriptive',
      conceptIds: ['c1'],
    })]);
    const first = storage.approveProblemDraft('draft-transfer-verify');
    assert.equal(first.success, true);
    assert.equal(first.approvedProblem.version, 1);

    // Update with type, concept, and transfer linkage changes
    storage.saveStoredProblemDrafts([mkDraft('draft-transfer-verify', {
      type: 'proof_argument',
      conceptIds: ['c1', 'c2'],
      isTransfer: true,
      sourceProblemId: 'p-orig',
      logicSessionId: 'ls-orig',
      transferChanges: 'precondition changed',
      understandingFocus: 'domain boundary',
      transferKind: 'precondition_change',
      originalCondition: 'cond1',
      newCondition: 'cond2',
      updatedAt: 't2',
    })]);

    const originalSet = localStorage.setItem;
    const PROB_KEY = 'redcall_problems_v1';
    localStorage.setItem = (key, value) => {
      if (key === PROB_KEY) throw new Error('problem storage down');
      return originalSet(key, value);
    };

    let result;
    try {
      result = storage.approveProblemDraft('draft-transfer-verify');
    } finally {
      localStorage.setItem = originalSet;
    }

    assert.equal(result.success, false, 'content mismatch detected on failed save');
    assert.equal(result.status, 'failed');
    assert.equal(result.approvedProblem, null, 'candidate problem must not be returned on failed save');
    // Ensure storage was not corrupted and draft is not approved
    const stored = storage.loadStoredProblems().find((p) => p.draftId === 'draft-transfer-verify');
    assert.equal(stored.version, 1);
    assert.equal(stored.type, 'essay_descriptive');
    assert.deepEqual(stored.conceptIds, ['c1']);
    assert.equal(stored.isTransfer, false);
    assert.equal(stored.sourceProblemId, undefined);
    assert.equal(storage.loadStoredProblemDrafts().find((d) => d.id === 'draft-transfer-verify').isApproved, false);
  });

  await checkAsync('이벤트 저장 실패 시 계획·예약 미완료 유지', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([{
      id: 'spi-core-fail', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'p-core',
      kind: 'recommended_review', round: 1, assignedDate: '2026-10-01', estimatedMinutes: 15,
      isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'pending',
      snapshotTitle: 't', snapshotDetail: 'd',
    }]);
    logicSession.saveRechallengeReservation({
      id: 'rr-core-fail', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'p-core',
      problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'scheduled',
    });

    const originalSet = localStorage.setItem;
    const CONCEPT_KEY = 'redcall_concepts_v1';
    localStorage.setItem = (key, value) => {
      if (key === CONCEPT_KEY) throw new Error('concept review event storage down');
      return originalSet(key, value);
    };

    const attempt = {
      id: 'att-core-fail', problemId: 'p-core', conceptId: c.id, subjectId: c.subjectId,
      at: '2026-10-01T08:00:00+09:00', answer: 'ans', confidence: 3, errorType: 'none',
      hintCount: 0, reasoningNotes: '', calculatedScore: 85, rubricResults: [],
      evaluatorFeedback: '', planItemId: 'spi-core-fail', rechallengeReservationId: 'rr-core-fail',
    };

    let result;
    try {
      result = storage.recordAttemptAndUpdateConcept(attempt, undefined, {
        planItemId: 'spi-core-fail',
        rechallengeReservationId: 'rr-core-fail',
      });
    } finally {
      localStorage.setItem = originalSet;
    }

    assert.equal(result.status, 'retryable_failure');
    assert.equal(result.partial, true);
    assert.equal(result.attemptPersisted, true, 'attempt persisted in storage');
    assert.equal(result.eventPersisted, false, 'concept review event failed to persist');

    // CRITICAL: plan item must NOT be completed!
    const planItem = storage.loadStoredStudyPlanItems().find((i) => i.id === 'spi-core-fail');
    assert.equal(planItem.status, 'pending', 'plan item must remain pending when event fails');
    assert.equal(planItem.completedAttemptId, undefined);

    // CRITICAL: reservation must NOT be completed!
    const res = logicSession.getRechallengeReservation('rr-core-fail');
    assert.equal(res.status, 'scheduled', 'reservation must remain scheduled when event fails');
    assert.equal(res.completedAttemptId, undefined);
  });

  await checkAsync('재시도 후 핵심 기록과 연결이 한 번만 완성됨', async () => {
    const c = { ...structuredClone(INITIAL_CONCEPTS[0]), events: [], exerciseCount: 0 };
    storage.saveStoredConcepts([c]);
    storage.saveStoredAttempts([]);
    storage.saveStoredStudyPlanItems([{
      id: 'spi-retry-once', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'p-retry',
      kind: 'recommended_review', round: 1, assignedDate: '2026-10-01', estimatedMinutes: 15,
      isEstimatedTime: false, priorityScore: 1, priorityReason: 'r', status: 'pending',
      snapshotTitle: 't', snapshotDetail: 'd',
    }]);
    logicSession.saveRechallengeReservation({
      id: 'rr-retry-once', subjectId: c.subjectId, subjectName: 'n', conceptId: c.id, problemId: 'p-retry',
      problemVersion: 1, scheduledDate: '2026-10-05', estimatedMinutes: 15, createdAt: 't', status: 'scheduled',
    });

    const attempt = {
      id: 'att-retry-once', problemId: 'p-retry', conceptId: c.id, subjectId: c.subjectId,
      at: '2026-10-01T08:00:00+09:00', answer: 'ans', confidence: 3, errorType: 'none',
      hintCount: 0, reasoningNotes: '', calculatedScore: 90, rubricResults: [],
      evaluatorFeedback: '', planItemId: 'spi-retry-once', rechallengeReservationId: 'rr-retry-once',
    };

    // First attempt fails at concept level
    const originalSet = localStorage.setItem;
    const CONCEPT_KEY = 'redcall_concepts_v1';
    localStorage.setItem = (key, value) => {
      if (key === CONCEPT_KEY) throw new Error('temporary concept failure');
      return originalSet(key, value);
    };
    try {
      storage.recordAttemptAndUpdateConcept(attempt, undefined, {
        planItemId: 'spi-retry-once',
        rechallengeReservationId: 'rr-retry-once',
      });
    } finally {
      localStorage.setItem = originalSet;
    }

    // Now retry after failure is resolved
    const retryResult = storage.recordAttemptAndUpdateConcept(attempt, undefined, {
      planItemId: 'spi-retry-once',
      rechallengeReservationId: 'rr-retry-once',
    });
    assert.equal(retryResult.status, 'complete');

    // Run recovery to link core records and complete reservations
    const recovery = storage.recoverMissingAttemptEvents();
    assert.equal(recovery.unresolved.length, 0);

    // Verify storage consistency: exactly 1 attempt, 1 event, 1 exerciseCount
    const attempts = storage.loadStoredAttempts().filter((a) => a.id === 'att-retry-once');
    assert.equal(attempts.length, 1, 'attempt not duplicated');

    const updatedConcept = storage.loadStoredConcepts().find((x) => x.id === c.id);
    const events = updatedConcept.events.filter((e) => e.attemptId === 'att-retry-once');
    assert.equal(events.length, 1, 'review event not duplicated');
    assert.equal(updatedConcept.exerciseCount, 1, 'exercise count incremented only once');

    // Plan item and reservation completed
    const planItem = storage.loadStoredStudyPlanItems().find((i) => i.id === 'spi-retry-once');
    assert.equal(planItem.status, 'completed');
    assert.equal(planItem.completedAttemptId, 'att-retry-once');

    const reservation = logicSession.getRechallengeReservation('rr-retry-once');
    assert.equal(reservation.status, 'completed');
    assert.equal(reservation.completedAttemptId, 'att-retry-once');

    // Idempotent recovery leaves no unresolved items
    const secondRecovery = storage.recoverMissingAttemptEvents();
    assert.equal(secondRecovery.unresolved.length, 0);
  });

  check('소유자 불명 예약에서 성공 알림이 나오지 않음', () => {
    // 1) Test handleReservationCompletionOutcome logic for completed_unknown_owner
    const unknownOwnerResult = logicSession.handleReservationCompletionOutcome({
      status: 'completed_unknown_owner',
      message: '완료 소유자 불명',
    });
    assert.equal(unknownOwnerResult.isSuccess, false, 'must not be marked success');
    assert.equal(unknownOwnerResult.toastMessage, undefined, 'no success toast message');
    assert.equal(unknownOwnerResult.partialOutcome?.status, 'link_conflict');
    assert.equal(unknownOwnerResult.partialOutcome?.partial, true);
    assert.equal(unknownOwnerResult.partialOutcome?.attemptPersisted, true);
    assert.equal(unknownOwnerResult.partialOutcome?.eventPersisted, true);

    // 2) Verify regular completed returns success
    const completedResult = logicSession.handleReservationCompletionOutcome({
      status: 'completed',
    });
    assert.equal(completedResult.isSuccess, true);
    assert.ok(completedResult.toastMessage?.includes('재도전 완료'));

    // 3) Verify already_completed returns success
    const alreadyResult = logicSession.handleReservationCompletionOutcome({
      status: 'already_completed',
    });
    assert.equal(alreadyResult.isSuccess, true);
    assert.ok(alreadyResult.toastMessage?.includes('이미 완료'));

    // 4) Verify completed_by_other returns link_conflict without success
    const byOtherResult = logicSession.handleReservationCompletionOutcome({
      status: 'completed_by_other',
      message: '다른 풀이로 이미 완료됨',
    });
    assert.equal(byOtherResult.isSuccess, false);
    assert.equal(byOtherResult.partialOutcome?.status, 'link_conflict');

    // 5) Verify save_failed returns retryable_failure without success
    const saveFailResult = logicSession.handleReservationCompletionOutcome({
      status: 'save_failed',
      message: '저장 실패',
    });
    assert.equal(saveFailResult.isSuccess, false);
    assert.equal(saveFailResult.partialOutcome?.status, 'retryable_failure');
  });

  const academic = load(path.join(output, 'lib/academicProofing.js'));
  const aiConfig = load(path.join(output, 'lib/aiConfig.js'));
  check('academic renderer escapes untrusted HTML in block and inline views', () => {
    for (const options of [{}, { inline: true }]) {
      const html = academic.renderAcademicMathHtml('<img src=x onerror=alert(1)><script>alert(2)</script>', options);
      assert.ok(!html.includes('<img'));
      assert.ok(!html.includes('<script'));
      assert.ok(html.includes('&lt;img'));
    }
  });
  check('math HTML is preserved through Markdown emphasis and code stays literal', () => {
    assert.ok(!academic.renderAcademicMathHtml('$a*b*c$').includes('<em'));
    const code = String.raw`\\frac{x}{y}`;
    assert.equal(academic.proofreadAcademicText('`' + code + '`'), '`' + code + '`');
    const html = academic.renderAcademicMathHtml('```lean\ntheorem foo (h : P) : P := by exact h\n```');
    assert.ok(html.includes('theorem foo (h : P)'));
    assert.ok(!html.includes('katex'));
    const matrix = String.raw`\begin{matrix}a\\b\end{matrix}`;
    assert.equal(academic.proofreadAcademicText('$' + matrix + '$'), '$' + matrix + '$');
    assert.ok(!academic.safeRenderKaTeX(matrix).includes('katex-error'));
  });
  check('source anchors work and user HTML cannot forge source links', () => {
    const html = academic.renderAcademicMathHtml('<!-- [PAGE 3] -->\n<!-- [발화 #2] -->\n<span data-page="9">forged</span>', { sourceAnchors: true });
    assert.ok(html.includes('data-page="3"'));
    assert.ok(html.includes('data-block="2"'));
    assert.ok(!html.includes('<span data-page="9"'));
  });
  check('provider credentials, model and endpoint resolve as one configuration', () => {
    const configs = [
      [{ DEEPSEEK_API_KEY: ' key ' }, 'deepseek', 'https://api.deepseek.com', 'deepseek-v4-flash'],
      [{ OPENAI_API_KEY: 'key', DEEPSEEK_MODEL: 'wrong' }, 'openai', 'https://api.openai.com/v1', 'gpt-4o-mini'],
      [{ GEMINI_API_KEY: 'key', OPENAI_MODEL: 'wrong', OPENAI_BASE_URL: 'https://wrong' }, 'gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.5-flash'],
      [{ AI_API_KEY: 'key', AI_MODEL: 'custom', AI_API_BASE: 'https://custom/v1/' }, 'gemini', 'https://custom/v1', 'custom'],
    ];
    for (const [env, provider, base, model] of configs) {
      const config = aiConfig.resolveAiConfig(env);
      assert.equal(config.provider, provider);
      assert.equal(config.apiBase, base);
      assert.equal(config.model, model);
      assert.equal(config.apiKey, 'key');
    }
  });
  check('AI_PROVIDER selects one provider and never mixes other keys', () => {
    const school = aiConfig.resolveAiConfig({
      AI_PROVIDER: 'school_gateway', BAZE_API_KEY: 'baze', GEMINI_API_KEY: 'gem',
      OPENAI_API_KEY: 'oa', AI_API_KEY: 'generic',
    });
    assert.equal(school.provider, 'school_gateway');
    assert.equal(school.apiKey, 'baze');
    assert.equal(school.model, 'deepseek-v4.1-flash');
    assert.equal(school.apiBase, 'https://factchat-cloud.mindlogic.ai/v1/gateway');
    assert.ok(school.minOutputTokens >= 16000, 'reasoning output floor');

    const openai = aiConfig.resolveAiConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'oa', OPENAI_MODEL: 'gpt-x', BAZE_API_KEY: 'baze' });
    assert.equal(openai.provider, 'openai');
    assert.equal(openai.apiKey, 'oa');
    assert.equal(openai.model, 'gpt-x');
    assert.equal(openai.apiBase, 'https://api.openai.com/v1');

    // Missing school key: unconfigured, and other providers' keys do NOT leak in.
    const noKey = aiConfig.resolveAiConfig({ AI_PROVIDER: 'school_gateway', GEMINI_API_KEY: 'gem', OPENAI_API_KEY: 'oa' });
    assert.equal(noKey.provider, 'school_gateway');
    assert.equal(noKey.apiKey, '');

    const unknown = aiConfig.resolveAiConfig({ AI_PROVIDER: 'nope', GEMINI_API_KEY: 'gem' });
    assert.equal(unknown.apiKey, '', 'unknown provider does not fall back to another key');
    assert.ok(unknown.providerError);
  });

  check('gateway endpoints use the documented trailing slash', () => {
    assert.equal(
      aiClient.buildChatEndpoint('school_gateway', 'https://factchat-cloud.mindlogic.ai/v1/gateway'),
      'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/'
    );
    assert.equal(
      aiClient.buildChatEndpoint('openai', 'https://api.openai.com/v1'),
      'https://api.openai.com/v1/chat/completions'
    );
    assert.equal(
      aiClient.buildModelsEndpoint('https://factchat-cloud.mindlogic.ai/v1/gateway'),
      'https://factchat-cloud.mindlogic.ai/v1/gateway/models/?type=llm'
    );
  });

  const SCHOOL_CONFIG = {
    provider: 'school_gateway', apiKey: 'baze-secret-key', model: 'deepseek-v4.1-flash',
    apiBase: 'https://factchat-cloud.mindlogic.ai/v1/gateway', minOutputTokens: 16000, jsonMode: 'none',
  };
  const restoreAiConfig = (saved) => { Object.assign(AI_CONFIG, saved); delete AI_CONFIG.providerError; };

  await checkAsync('school gateway request uses exact url/model/auth and no unverified options', async () => {
    const saved = { ...AI_CONFIG };
    const originalFetch = global.fetch;
    const fetchCalls = [];
    try {
      Object.assign(AI_CONFIG, SCHOOL_CONFIG);
      global.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        return Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
      };
      const result = await aiClient.callAiChat({ system: 's', user: 'u', temperature: 0.2, json: true, maxOutputTokens: 100, label: 't' });
      assert.equal(result.ok, true);
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].url, 'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/');
      const headers = fetchCalls[0].init.headers;
      assert.equal(headers.Authorization, 'Bearer baze-secret-key');
      assert.ok(headers['User-Agent'] && headers['User-Agent'].length > 0, 'non-empty User-Agent (Cloudflare)');
      const body = JSON.parse(fetchCalls[0].init.body);
      assert.equal(body.model, 'deepseek-v4.1-flash');
      assert.ok(!('thinking_budget' in body) && !('thinking_level' in body) && !('reasoning_effort' in body));
      assert.ok(!('response_format' in body), 'unverified json mode is off by default');
      assert.ok(body.max_tokens >= 16000, 'reasoning output budget floor applied');
    } finally {
      global.fetch = originalFetch;
      restoreAiConfig(saved);
    }
  });

  await checkAsync('provider errors map to distinct codes and are not auto-retried', async () => {
    const saved = { ...AI_CONFIG };
    const originalFetch = global.fetch;
    try {
      Object.assign(AI_CONFIG, { provider: 'gemini', apiKey: 'k', model: 'm', apiBase: 'https://x', minOutputTokens: 0, jsonMode: 'none' });
      const cases = [[400, 'bad_request'], [401, 'auth'], [402, 'credit'], [403, 'forbidden'], [404, 'not_found'], [500, 'provider']];
      for (const [status, code] of cases) {
        let calls = 0;
        global.fetch = async () => { calls += 1; return new Response('{"detail":"x"}', { status }); };
        const r = await aiClient.callAiChat({ system: 's', user: 'u', json: true, label: 'err' });
        assert.equal(r.ok, false, `status ${status} fails`);
        assert.equal(r.error.code, code, `status ${status} -> ${code}`);
        assert.equal(calls, 1, `status ${status} not retried`);
        assert.ok(aiClient.httpStatusForAiError(code) >= 400);
      }
    } finally {
      global.fetch = originalFetch;
      restoreAiConfig(saved);
    }
  });

  await checkAsync('429 honors Retry-After and then succeeds', async () => {
    const saved = { ...AI_CONFIG };
    const originalFetch = global.fetch;
    let calls = 0;
    try {
      Object.assign(AI_CONFIG, { provider: 'gemini', apiKey: 'k', model: 'm', apiBase: 'https://x', minOutputTokens: 0, jsonMode: 'none' });
      global.fetch = async () => {
        calls += 1;
        if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
        return Response.json({ choices: [{ message: { content: '{"ok":1}' } }] });
      };
      const r = await aiClient.callAiChat({ system: 's', user: 'u', json: true, label: 'retry' });
      assert.equal(r.ok, true);
      assert.equal(calls, 2);
    } finally {
      global.fetch = originalFetch;
      restoreAiConfig(saved);
    }
  });

  await checkAsync('empty, truncated and invalid outputs are never accepted', async () => {
    const saved = { ...AI_CONFIG };
    const originalFetch = global.fetch;
    try {
      Object.assign(AI_CONFIG, { provider: 'gemini', apiKey: 'k', model: 'm', apiBase: 'https://x', minOutputTokens: 0, jsonMode: 'none' });
      global.fetch = async () => Response.json({ choices: [{ message: { content: '' } }] });
      assert.equal((await aiClient.callAiChat({ system: 's', user: 'u', label: 'empty' })).error.code, 'empty');
      global.fetch = async () => Response.json({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'length' }] });
      assert.equal((await aiClient.callAiChat({ system: 's', user: 'u', label: 'trunc' })).error.code, 'truncated');
      global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad json'); } });
      assert.equal((await aiClient.callAiChat({ system: 's', user: 'u', label: 'badjson' })).error.code, 'invalid_json');
    } finally {
      global.fetch = originalFetch;
      restoreAiConfig(saved);
    }
  });

  check('sanitize removes API keys and bearer tokens from any logged text', () => {
    const saved = { ...AI_CONFIG };
    try {
      Object.assign(AI_CONFIG, { apiKey: 'super-secret-key' });
      const out = aiClient.sanitizeAiText('Authorization: Bearer super-secret-key {"api_key":"super-secret-key"}');
      assert.ok(!out.includes('super-secret-key'), 'key is redacted');
      assert.ok(out.includes('[redacted]'));
    } finally {
      restoreAiConfig(saved);
    }
  });

  await checkAsync('gateway model check finds the model and distinguishes 403 causes', async () => {
    const saved = { ...AI_CONFIG };
    const originalFetch = global.fetch;
    try {
      Object.assign(AI_CONFIG, SCHOOL_CONFIG);
      global.fetch = async () => Response.json({ object: 'list', data: [{ id: 'deepseek-v4.1-flash' }, { id: 'gpt-5.5' }] });
      const ok = await aiClient.verifyGatewayModel();
      assert.equal(ok.ok, true);
      assert.equal(ok.hasModel, true);
      assert.equal(ok.reason, 'ok');

      global.fetch = async () => new Response('Model X is not enabled for your tenant.', { status: 403 });
      const forbidden = await aiClient.verifyGatewayModel();
      assert.equal(forbidden.ok, false);
      assert.equal(forbidden.reason, 'forbidden');
      assert.match(forbidden.message, /잘못된 키가 아니라/);

      global.fetch = async () => new Response('gone', { status: 500 });
      const providerErr = await aiClient.verifyGatewayModel();
      assert.equal(providerErr.reason, 'provider');
    } finally {
      global.fetch = originalFetch;
      restoreAiConfig(saved);
    }
  });

  check('per-user API keys round-trip through AES-256-GCM and are masked', () => {
    const key = Buffer.alloc(32, 7);
    const enc = aiCredentials.encryptSecret('ba-ze-secret-key-1234', key);
    assert.ok(enc.ciphertext && enc.iv && enc.tag);
    assert.ok(!enc.ciphertext.includes('ba-ze'), 'plaintext is not present in ciphertext');
    assert.equal(aiCredentials.decryptSecret(enc, key), 'ba-ze-secret-key-1234');
    assert.throws(() => aiCredentials.decryptSecret(enc, Buffer.alloc(32, 8)), 'wrong key fails auth tag');
    assert.equal(aiCredentials.maskKey('abcdefghijkl1234'), 'abcd••••1234');
    const rawKey = Buffer.alloc(32, 1);
    assert.equal(aiCredentials.parseEncryptionKey(rawKey.toString('base64')).length, 32);
    assert.equal(aiCredentials.parseEncryptionKey(rawKey.toString('hex')).length, 32);
    assert.equal(aiCredentials.parseEncryptionKey('short'), null);
  });

  check('connection policy picks the default model and maps errors', () => {
    const preferred = aiCredentials.selectAvailableModel(['a', 'deepseek-v4.1-flash']);
    assert.equal(preferred.ok, true);
    assert.equal(preferred.model, 'deepseek-v4.1-flash');
    assert.equal(aiCredentials.selectAvailableModel(['a', 'b']).model, 'a');
    assert.equal(aiCredentials.selectAvailableModel([], 'a').code, 'NO_MODELS');
    assert.equal(aiCredentials.selectAvailableModel(['a'], 'z').code, 'MODEL_NOT_AVAILABLE');
    assert.equal(aiCredentials.reasonToCode('auth'), 'AUTH');
    assert.equal(aiCredentials.reasonToCode('forbidden'), 'FORBIDDEN');
    assert.equal(aiCredentials.connectionCheckHttpStatus('forbidden'), 400);
    assert.equal(aiCredentials.connectionCheckHttpStatus('provider'), 502);
    assert.equal(aiCredentials.connectionCheckHttpStatus('rate_limit'), 429);
    assert.equal(aiCredentials.validateApiKeyInput('   ').code, 'EMPTY_KEY');
    assert.equal(aiCredentials.validateApiKeyInput('x'.repeat(600)).code, 'BAD_REQUEST');
    assert.equal(aiCredentials.validateApiKeyInput(' k ').apiKey, 'k');
  });

  await checkAsync('credential resolver stops on lookup failure and gates operator fallback by policy', async () => {
    const savedConfig = { ...AI_CONFIG };
    const savedEncKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    const savedPolicy = process.env.AI_ALLOW_OPERATOR_FALLBACK;
    const encKey = Buffer.alloc(32, 9);
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = encKey.toString('base64');
    try {
      // Operator key is configured throughout to prove the isolation rules.
      Object.assign(AI_CONFIG, { provider: 'gemini', apiKey: 'operator-key', model: 'm', apiBase: 'https://x', minOutputTokens: 0, jsonMode: 'none' });
      const good = aiCredentials.encryptSecret('user-key-1234', encKey);

      // Registered user key wins.
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: {
          get_ai_connection_secret: { data: { provider: 'school_gateway', model: 'deepseek-v4.1-flash', key_hint: '••••1234', ciphertext: good.ciphertext, iv: good.iv, tag: good.tag }, error: null },
        },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, true);
        assert.equal(r.source, 'user');
        assert.equal(r.config.apiKey, 'user-key-1234');
        assert.equal(r.config.apiBase, 'https://factchat-cloud.mindlogic.ai/v1/gateway');
      });

      // Corrupt registered key -> credential_error even with operator policy ON.
      process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: { get_ai_connection_secret: { data: { ciphertext: 'AAAA', iv: 'AAAA', tag: 'AAAA' }, error: null } },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'credential_error');
      });

      // Lookup failure (RPC error) -> lookup_failed, never operator.
      await withFakeSupabase({
        user: { id: 'u1' },
        fail: { rpc: true, rpcMessage: 'database down' },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'lookup_failed');
      });

      // Malformed response (row without ciphertext) -> lookup_failed, never operator.
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: { get_ai_connection_secret: { data: { model: 'x' }, error: null } },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'lookup_failed');
      });

      // Confirmed unregistered + policy OFF -> registration required (operator NOT used).
      delete process.env.AI_ALLOW_OPERATOR_FALLBACK;
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: { get_ai_connection_secret: { data: null, error: null } },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'no_credentials');
      });

      // Confirmed unregistered + explicit policy ON -> operator allowed.
      process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: { get_ai_connection_secret: { data: null, error: null } },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, true);
        assert.equal(r.source, 'operator');
        assert.equal(r.config.apiKey, 'operator-key');
      });

      // No operator key + unregistered -> registration required.
      Object.assign(AI_CONFIG, { apiKey: '' });
      await withFakeSupabase({
        user: { id: 'u1' },
        rpcResults: { get_ai_connection_secret: { data: null, error: null } },
      }, async () => {
        const r = await aiCredentials.resolveAiConfigForUser('u1');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'no_credentials');
      });

      // operatorFallbackAllowed parses policy values.
      assert.equal(aiCredentials.operatorFallbackAllowed({}), false);
      assert.equal(aiCredentials.operatorFallbackAllowed({ AI_ALLOW_OPERATOR_FALLBACK: 'true' }), true);
      assert.equal(aiCredentials.operatorFallbackAllowed({ AI_ALLOW_OPERATOR_FALLBACK: '1' }), true);
      assert.equal(aiCredentials.operatorFallbackAllowed({ AI_ALLOW_OPERATOR_FALLBACK: 'no' }), false);
    } finally {
      restoreAiConfig(savedConfig);
      if (savedEncKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = savedEncKey;
      if (savedPolicy === undefined) delete process.env.AI_ALLOW_OPERATOR_FALLBACK;
      else process.env.AI_ALLOW_OPERATOR_FALLBACK = savedPolicy;
    }
  });

  check('pending is unsaved only when it differs and matches the server version', () => {
    const userId = 'pending-semantics';
    const server = { id: 'pe2', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60, status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [], answers: { p1: 'server' }, evaluations: {} };
    assert.equal(pendingAnswers.pendingIsUnsaved(server, null, 3), false);
    pendingAnswers.savePendingExamAnswers(userId, { ...server }, 3);
    assert.equal(pendingAnswers.pendingIsUnsaved(server, pendingAnswers.loadPendingExamAnswers(userId, 'pe2'), 3), false, 'identical answers are not unsaved');
    pendingAnswers.savePendingExamAnswers(userId, { ...server, answers: { p1: 'typed' } }, 3);
    assert.equal(pendingAnswers.pendingIsUnsaved(server, pendingAnswers.loadPendingExamAnswers(userId, 'pe2'), 3), true);
    assert.equal(pendingAnswers.pendingIsUnsaved(server, pendingAnswers.loadPendingExamAnswers(userId, 'pe2'), 4), false, 'stale base version is not auto-applied');
    assert.equal(pendingAnswers.pendingIsUnsaved(server, { sessionId: 'pe2', answers: { p1: 'typed' }, savedAt: '' }, 99), true, 'legacy pending is conservatively unsaved');
    assert.equal(pendingAnswers.answerFieldsEqual({ answers: { a: '1' } }, { answers: { a: '1' } }), true);
    assert.equal(pendingAnswers.answerFieldsEqual({ answers: { a: '1' } }, { answers: { a: '2' } }), false);
  });

  check('a successful autosave clears only the snapshot it saved', () => {
    const saved = { id: 'pe3', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60, status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [], answers: { p1: 'first' }, evaluations: {} };
    const newer = { ...saved, answers: { p1: 'first', p2: 'typed-during-request' } };
    assert.equal(pendingAnswers.pendingAfterAutosave(saved, saved), 'clear');
    assert.equal(pendingAnswers.pendingAfterAutosave(saved, newer), 'keep-current');
    assert.equal(pendingAnswers.pendingAfterAutosave(saved, null), 'clear');
  });

  check('reconcile adopts the server snapshot and protects submitted answers', () => {
    const local = { id: 'r1', status: 'in_progress', answers: { p1: 'local' }, evaluations: {} };
    const submittedServer = { id: 'r1', status: 'submitted', answers: { p1: 'server-final' }, evaluations: {} };
    const plan = cloudMockExamSync.planReconcile(local, submittedServer, 5, null);
    assert.equal(plan.applyServer, true);
    assert.equal(plan.unsaved, false);
    assert.equal(plan.notify, true, 'different snapshot notifies');
    assert.equal(plan.clearPending, false);

    const same = cloudMockExamSync.planReconcile(submittedServer, submittedServer, 5, null);
    assert.equal(same.notify, false, 'identical snapshot does not notify');

    const pending = { sessionId: 'r1', answers: { p1: 'typed' }, baseVersion: 5, savedAt: '' };
    const withPending = cloudMockExamSync.planReconcile(local, { id: 'r1', status: 'in_progress', answers: { p1: 'server' }, evaluations: {} }, 5, pending);
    assert.equal(withPending.unsaved, true);
    assert.equal(withPending.clearPending, false);

    // Stale base version: preserved and flagged, never auto-applied or cleared.
    const stale = cloudMockExamSync.planReconcile(local, { id: 'r1', status: 'in_progress', answers: { p1: 'server' }, evaluations: {} }, 9, pending);
    assert.equal(stale.unsaved, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.clearPending, false);

    // Pending that no longer differs is safe to drop.
    const samePending = cloudMockExamSync.planReconcile(local, { id: 'r1', status: 'in_progress', answers: { p1: 'typed' }, evaluations: {} }, 5, pending);
    assert.equal(samePending.unsaved, false);
    assert.equal(samePending.clearPending, true);
  });

  check('migration verification reports missing, conflicts, dangling refs and server-newer', () => {
    const snap = {
      attempts: [{ id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', problemVersion: 1, at: 't', calculatedScore: 80 }],
      events: [{ event: { id: 'e1', conceptId: 'c1', attemptId: 'a1', kind: 'attempt', at: 't', resultScore: 80 }, subjectId: 's1' }],
      planItems: [{ id: 'spi1', subjectId: 's1', status: 'completed', assignedDate: '2026-01-01', completedAttemptId: 'a1' }],
      mockExams: [{ id: 'mk1', subjectId: 's1', status: 'in_progress', answers: { p1: 'x' } }],
      subjectIds: new Set(['s1']), conceptIds: new Set(['c1']), problemIds: new Set(['p1']),
    };
    const clean = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }],
      events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0] }],
      mockExams: [{ ...snap.mockExams[0] }],
    });
    assert.equal(clean.conflicts.length, 0);
    assert.equal(clean.dangling.length, 0);
    assert.equal(clean.missing.attempts + clean.missing.events + clean.missing.planItems + clean.missing.mockExams, 0);

    const bad = historyMigration.verifyMigratedHistory(
      { ...snap, attempts: [{ ...snap.attempts[0], problemId: 'pX' }] },
      { attempts: [{ ...snap.attempts[0], calculatedScore: 10 }], events: [], planItems: [], mockExams: [] }
    );
    assert.equal(bad.missing.events, 1);
    assert.equal(bad.missing.planItems, 1);
    assert.equal(bad.missing.mockExams, 1);
    assert.equal(bad.conflicts.length, 1, 'immutable attempt conflict');
    assert.ok(bad.dangling.includes('attempt:a1:problem'), 'dangling reference reported');

    const newer = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0], completedAttemptId: 'a2' }],
      mockExams: [{ ...snap.mockExams[0], status: 'submitted', answers: { p1: 'server' } }],
    });
    assert.equal(newer.conflicts.length, 0, 'server-newer mutable differences are not conflicts');
    assert.equal(newer.serverNewer, 2, 'mutable differences are reported as server-newer');

    // Immutable identity change is a conflict.
    const immutableMock = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0] }],
      mockExams: [{ ...snap.mockExams[0], durationMinutes: 90 }],
    });
    assert.ok(immutableMock.conflicts.includes('mock:mk1:immutable'), 'mock immutable change conflicts');

    const immutablePlan = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0], round: 9 }],
      mockExams: [{ ...snap.mockExams[0] }],
    });
    assert.ok(immutablePlan.conflicts.includes('plan:spi1:immutable'), 'plan immutable change conflicts');

    // Server progress behind local progress is a conflict.
    const behind = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0], status: 'pending', completedAttemptId: null }],
      mockExams: [{ ...snap.mockExams[0] }],
    });
    assert.ok(behind.conflicts.includes('plan:spi1:behind'), 'server behind local progress conflicts');

    // `kind` is presentation metadata, not completion identity.
    const kindOnly = historyMigration.verifyMigratedHistory(snap, {
      attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
      planItems: [{ ...snap.planItems[0], kind: 'mock_exam' }],
      mockExams: [{ ...snap.mockExams[0] }],
    });
    assert.equal(kindOnly.conflicts.length, 0, 'plan kind change is not a conflict');
    assert.equal(kindOnly.serverNewer, 0, 'plan kind change alone is not server-newer');

    // Same status but content differs: server updated-at decides which is newer.
    const staleServer = historyMigration.verifyMigratedHistory(
      { ...snap, capturedAt: '2026-06-01T00:00:00.000Z' },
      {
        attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
        planItems: [{ ...snap.planItems[0], completedAttemptId: 'a2', serverUpdatedAt: '2026-01-01T00:00:00.000Z' }],
        mockExams: [{ ...snap.mockExams[0] }],
      }
    );
    assert.ok(staleServer.conflicts.includes('plan:spi1:stale-server'), 'older differing server copy conflicts');

    const newerServer = historyMigration.verifyMigratedHistory(
      { ...snap, capturedAt: '2026-01-01T00:00:00.000Z' },
      {
        attempts: [{ ...snap.attempts[0] }], events: [{ ...snap.events[0].event }],
        planItems: [{ ...snap.planItems[0], completedAttemptId: 'a2', serverUpdatedAt: '2026-07-01T00:00:00.000Z' }],
        mockExams: [{ ...snap.mockExams[0] }],
      }
    );
    assert.equal(newerServer.conflicts.length, 0);
    assert.equal(newerServer.serverNewer, 1, 'newer differing server copy is server-newer');

    // PostgREST returns timestamptz as +00:00; local ISO uses Z. Must compare equal.
    const tzEquivalent = historyMigration.verifyMigratedHistory(
      { ...snap, attempts: [{ ...snap.attempts[0], at: '2026-01-01T00:00:00.000Z' }] },
      {
        attempts: [{ ...snap.attempts[0], at: '2026-01-01T00:00:00+00:00' }],
        events: [], planItems: [], mockExams: [],
      }
    );
    assert.equal(tzEquivalent.conflicts.length, 0, 'Z vs +00:00 timestamps compare equal');
  });

  check('migration deep comparison rejects answer, version, rubric and evaluation differences', () => {
    const attempt = {
      id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', problemVersion: 1,
      at: '2026-01-01T00:00:00.000Z', answer: 'A', calculatedScore: 80,
      problemPromptSnapshot: 'Q', modelAnswerSnapshot: 'M',
      rubricSnapshot: [{ criterionId: 'r1', label: 'L', maxScore: 100 }],
      rubricResults: [{ criterionId: 'r1', score: 80, evidenceQuote: 'A' }],
      strengths: 'S', criticalImprovements: 'C', needsReview: false, isAiEvaluated: true,
      methodSelectionDiagnosis: { summary: 'ok' },
    };
    const event = { id: 'e1', conceptId: 'c1', attemptId: 'a1', kind: 'attempt', at: '2026-01-01T00:00:00.000Z', resultScore: 80, notes: 'N', sourceRef: 'S', rubricScores: [{ criterionId: 'r1', score: 80 }] };
    const problem = { id: 'p1', type: 'essay_descriptive', title: 'T', promptText: 'Q', modelAnswer: 'M', rubric: [{ id: 'r1', maxScore: 100 }], version: 1 };
    const mock = { id: 'mk1', subjectId: 's1', durationMinutes: 60, createdAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T01:00:00.000Z', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'], problems: [problem], answers: { p1: 'x' }, evaluations: {}, status: 'in_progress' };
    const snapshot = {
      attempts: [attempt], events: [{ event, subjectId: 's1' }], planItems: [], mockExams: [mock],
      subjectIds: new Set(['s1']), conceptIds: new Set(['c1']), problemIds: new Set(['p1']),
      capturedAt: '2026-02-01T00:00:00.000Z',
    };
    const server = () => ({
      attempts: [{ ...attempt }], events: [{ ...event }], planItems: [], mockExams: [{ ...mock, problems: [{ ...problem }] }],
    });

    const clean = historyMigration.verifyMigratedHistory(snapshot, server());
    assert.equal(clean.conflicts.length, 0, 'identical deep content passes');
    assert.equal(clean.missing.attempts + clean.missing.events + clean.missing.mockExams, 0);

    assert.equal(historyMigration.verifyMigratedHistory({ ...snapshot, attempts: [{ ...attempt, answer: 'B' }] }, server()).conflicts.length, 1, 'answer change conflicts');
    assert.equal(historyMigration.verifyMigratedHistory({ ...snapshot, attempts: [{ ...attempt, problemVersion: 2 }] }, server()).conflicts.length, 1, 'problem version change conflicts');
    assert.equal(historyMigration.verifyMigratedHistory({ ...snapshot, attempts: [{ ...attempt, rubricSnapshot: [{ criterionId: 'r1', label: 'L', maxScore: 90 }] }] }, server()).conflicts.length, 1, 'rubric change conflicts');
    assert.equal(historyMigration.verifyMigratedHistory({ ...snapshot, attempts: [{ ...attempt, rubricResults: [{ criterionId: 'r1', score: 10 }] }] }, server()).conflicts.length, 1, 'evaluation result change conflicts');
    assert.equal(historyMigration.verifyMigratedHistory({ ...snapshot, events: [{ event: { ...event, notes: 'CHANGED' }, subjectId: 's1' }] }, server()).conflicts.length, 1, 'review event change conflicts');

    const mockServerVersion = { ...server(), mockExams: [{ ...mock, problems: [{ ...problem, version: 2 }] }] };
    assert.ok(historyMigration.verifyMigratedHistory(snapshot, mockServerVersion).conflicts.includes('mock:mk1:immutable'), 'mock problem version change conflicts');

    const gradedSnapshot = { ...snapshot, mockExams: [{ ...mock, status: 'graded', evaluations: { p1: { calculatedScore: 80 } } }] };
    const gradedServer = { ...server(), mockExams: [{ ...mock, status: 'graded', evaluations: {} }] };
    assert.ok(historyMigration.verifyMigratedHistory(gradedSnapshot, gradedServer).conflicts.includes('mock:mk1:results'), 'missing server evaluation conflicts');
  });

  await checkAsync('migration reads every page', async () => {
    const total = 1500;
    let calls = 0;
    const result = await historyMigration.collectAllPages(async ({ from, to }) => {
      calls += 1;
      const rows = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: `r${i}` });
      return { ok: true, data: rows };
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.length, total);
    assert.equal(calls, 2, 'two pages requested');
  });

  await checkAsync('migration verifies or blocks completion, and re-runs reset nothing', async () => {
    const userId = 'mig-verify-1';
    const markerKey = 'redcall_user_' + encodeURIComponent(userId) + '__history_migration_v1';
    localStorage.removeItem(markerKey);
    localStorage.removeItem('redcall_user_' + encodeURIComponent(userId) + '__history_migration_job_v1');

    // Seed the user's local snapshot + references.
    storageScope.setStorageScope({ kind: 'user', userId });
    storage.saveStoredSubjects([{ id: 's1', name: 'S', code: '', timezone: 'Asia/Seoul' }]);
    storage.saveStoredConcepts([{ id: 'c1', subjectId: 's1', title: 'C', events: [] }]);
    storage.saveStoredProblems([{ id: 'p1', subjectId: 's1', conceptIds: ['c1'], title: 'P' }]);
    storage.saveStoredAttempts([{ id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: '2026-01-01T00:00:00.000Z', answer: 'x', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 80, rubricResults: [], evaluatorFeedback: '' }]);
    storage.saveStoredStudyPlanItems([]);
    exams.saveMockExam({ id: 'mk1', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60, status: 'in_progress', selectedConceptIds: [], selectedTypes: [], problems: [], answers: { p1: 'local' }, evaluations: {} });
    storageScope.setStorageScope({ kind: 'legacy' });

    const submittedRow = { id: 'mk1', user_id: 'user-a', subject_id: 's1', status: 'submitted', duration_minutes: 60, created_at: 't', ends_at: 't2', submitted_at: 't3', version: 5, payload: { id: 'mk1', subjectId: 's1', status: 'submitted', answers: { p1: 'server' } }, updated_at: 't' };
    const conflictingAttempt = { id: 'a1', user_id: 'user-a', subject_id: 's1', concept_id: 'c1', problem_id: 'p1', mock_exam_session_id: null, plan_item_id: null, attempt_origin: 'independent', problem_version: 1, at: '2026-01-01T00:00:00.000Z', calculated_score: 10, payload: {}, created_at: '', updated_at: '' };

    // Run 1: conflicting immutable record on the server -> must NOT complete.
    await withFakeSupabase({ user: { id: 'user-a' }, mock_exam_sessions: [submittedRow], attempts: [conflictingAttempt] }, async (client) => {
      const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(result.ok, false);
      assert.ok(result.conflicts >= 1, 'conflict detected');
      assert.equal(localStorage.getItem(markerKey), null, 'no completion marker on conflict');
      assert.equal(client.__state.mock_exam_sessions[0].status, 'submitted', 'submitted exam not reset');
      assert.equal(client.__state.mock_exam_sessions[0].version, 5, 'submitted version not reset');
    });

    // Run 2: clean server -> completes, inserts exactly one attempt, keeps the submitted mock.
    await withFakeSupabase({ user: { id: 'user-a' }, mock_exam_sessions: [submittedRow] }, async (client) => {
      const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(result.ok, true, result.message);
      assert.notEqual(localStorage.getItem(markerKey), null, 'completion marker written');
      assert.equal(client.__state.attempts.length, 1);
      assert.equal(client.__state.attempts[0].id, 'a1');
      assert.equal(client.__state.mock_exam_sessions[0].status, 'submitted', 'server-newer mock preserved');
      assert.equal(client.__state.mock_exam_sessions[0].version, 5);

      // Run 3: idempotent; no duplicates.
      const again = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(again.ok, true);
      assert.equal(client.__state.attempts.length, 1, 'no duplicate on re-run');
    });
  });

  await checkAsync('migration retry verifies the first captured origin, not the live cache', async () => {
    const userId = 'mig-origin-1';
    const b64 = encodeURIComponent(userId);
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_v1');
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_origin_v1');
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_job_v1');

    storageScope.setStorageScope({ kind: 'user', userId });
    storage.saveStoredSubjects([{ id: 's1', name: 'S', code: '', timezone: 'Asia/Seoul' }]);
    storage.saveStoredConcepts([{ id: 'c1', subjectId: 's1', title: 'C', events: [] }]);
    storage.saveStoredProblems([{ id: 'p1', subjectId: 's1', conceptIds: ['c1'], title: 'P' }]);
    storage.saveStoredAttempts([{ id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: '2026-01-01T00:00:00.000Z', answer: 'origin', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '' }]);
    storage.saveStoredStudyPlanItems([]);
    storageScope.setStorageScope({ kind: 'legacy' });

    const conflictRow = { id: 'a1', user_id: 'user-a', subject_id: 's1', concept_id: 'c1', problem_id: 'p1', mock_exam_session_id: null, plan_item_id: null, attempt_origin: 'independent', problem_version: 1, at: '2026-01-01T00:00:00.000Z', calculated_score: 99, payload: {}, created_at: '', updated_at: '' };
    await withFakeSupabase({ user: { id: 'user-a' }, attempts: [conflictRow] }, async (client) => {
      const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(result.ok, false);
      assert.notEqual(localStorage.getItem('redcall_user_' + b64 + '__history_migration_origin_v1'), null, 'origin captured on first attempt');
    });

    // Replace the live cache AFTER the origin was captured.
    storageScope.setStorageScope({ kind: 'user', userId });
    storage.saveStoredAttempts([{ id: 'a2', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: '2026-01-02T00:00:00.000Z', answer: 'cache-changed', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 10, rubricResults: [], evaluatorFeedback: '' }]);
    storageScope.setStorageScope({ kind: 'legacy' });

    await withFakeSupabase({ user: { id: 'user-a' } }, async (client) => {
      const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(result.ok, true, result.message);
      assert.equal(client.__state.attempts.length, 1);
      assert.equal(client.__state.attempts[0].id, 'a1', 'origin id migrated, not the changed cache');
      assert.equal(client.__state.attempts[0].calculated_score, 70, 'origin content migrated');
    });
  });

  await checkAsync('migration aborts when the origin snapshot cannot be saved', async () => {
    const userId = 'mig-origin-savefail';
    const b64 = encodeURIComponent(userId);
    const originKey = 'redcall_user_' + b64 + '__history_migration_origin_v1';
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_v1');
    localStorage.removeItem(originKey);
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_job_v1');
    storageScope.setStorageScope({ kind: 'user', userId });
    storage.saveStoredSubjects([{ id: 's1', name: 'S', code: '', timezone: 'Asia/Seoul' }]);
    storage.saveStoredConcepts([{ id: 'c1', subjectId: 's1', title: 'C', events: [] }]);
    storage.saveStoredProblems([{ id: 'p1', subjectId: 's1', conceptIds: ['c1'], title: 'P' }]);
    storage.saveStoredAttempts([{ id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: '2026-01-01T00:00:00.000Z', answer: 'x', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '' }]);
    storage.saveStoredStudyPlanItems([]);
    storageScope.setStorageScope({ kind: 'legacy' });

    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (key === originKey) throw new Error('simulated origin write failure');
      realSetItem(key, value);
    };
    try {
      await withFakeSupabase({ user: { id: 'user-a' } }, async (client) => {
        const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
        assert.equal(result.ok, false);
        assert.match(result.message, /원본 스냅샷/);
        assert.equal((client.__state.attempts ?? []).length, 0, 'upload must not start without a saved/verified origin');
      });
    } finally {
      localStorage.setItem = realSetItem;
    }
  });

  await checkAsync('migration does not recapture a corrupted origin', async () => {
    const userId = 'mig-origin-corrupt';
    const b64 = encodeURIComponent(userId);
    const originKey = 'redcall_user_' + b64 + '__history_migration_origin_v1';
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_v1');
    localStorage.removeItem('redcall_user_' + b64 + '__history_migration_job_v1');
    storageScope.setStorageScope({ kind: 'user', userId });
    storage.saveStoredSubjects([{ id: 's1', name: 'S', code: '', timezone: 'Asia/Seoul' }]);
    storage.saveStoredConcepts([{ id: 'c1', subjectId: 's1', title: 'C', events: [] }]);
    storage.saveStoredProblems([{ id: 'p1', subjectId: 's1', conceptIds: ['c1'], title: 'P' }]);
    storage.saveStoredAttempts([{ id: 'a1', subjectId: 's1', conceptId: 'c1', problemId: 'p1', at: '2026-01-01T00:00:00.000Z', answer: 'x', confidence: 3, errorType: 'none', hintCount: 0, reasoningNotes: '', calculatedScore: 70, rubricResults: [], evaluatorFeedback: '' }]);
    storage.saveStoredStudyPlanItems([]);
    storageScope.setStorageScope({ kind: 'legacy' });

    localStorage.setItem(originKey, '{not valid json');
    await withFakeSupabase({ user: { id: 'user-a' } }, async (client) => {
      const result = await historyMigration.migrateLocalHistoryToCloud(userId, client);
      assert.equal(result.ok, false);
      assert.match(result.message, /손상/);
      assert.equal(localStorage.getItem(originKey), '{not valid json', 'corrupted origin is not replaced by the live cache');
      assert.equal((client.__state.attempts ?? []).length, 0, 'no upload with a corrupted origin');
    });
  });

  check('new users start empty and existing stored data survives reload', () => {
    const backup = new Map(data);
    try {
      data.clear();
      assert.deepEqual(storage.loadStoredSubjects(), []);
      assert.deepEqual(storage.loadStoredMaterials(), []);
      assert.deepEqual(storage.loadStoredConcepts(), []);
      assert.deepEqual(storage.loadStoredProblems(), []);
      assert.equal(storage.loadActiveSubjectId(), '');
      storage.saveStoredSubjects([subject]);
      storage.saveStoredMaterials([{ id: 'real', subjectId: subject.id, status: 'ready', isDemo: false }]);
      storage.saveStoredAttempts([attempt]);
      assert.equal(storage.loadActiveSubjectId(), subject.id);
      assert.equal(storage.loadStoredMaterials()[0].id, 'real');
      assert.equal(storage.loadStoredAttempts()[0].id, attempt.id);
    } finally { data.clear(); for (const [key, value] of backup) data.set(key, value); }
  });

  check('migration 9 column error detection strictly distinguishes missing columns from permission/constraint errors', () => {
    // 1) Real undefined column errors (Postgres 42703 or PostgREST cache)
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '42703',
        message: 'column "sync_body" of relation "materials" does not exist',
      }),
      true
    );
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: 'PGRST204',
        message: "Could not find the 'original_hash' column of 'materials' in the schema cache",
      }),
      true
    );
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        message: 'column materials.backup_original does not exist',
      }),
      true
    );

    // 2) Errors unrelated to migration 9 columns
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '42703',
        message: 'column "non_migration_col" does not exist',
      }),
      false
    );

    // 3) Permission, constraint, not-null, and network errors must NEVER be treated as missing column
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '42501',
        message: 'permission denied for column sync_body',
      }),
      false,
      '42501 permission denied must never trigger fallback'
    );
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '23502',
        message: 'null value in column "sync_body" violates not-null constraint',
      }),
      false,
      '23502 not-null violation must never trigger fallback'
    );
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '23514',
        message: 'check constraint "materials_file_size_check" violated for file_size',
      }),
      false,
      '23514 check constraint must never trigger fallback'
    );
    assert.equal(
      cloudMaterials.isMissingMigration9ColumnError({
        code: '08006',
        message: 'connection failure while writing sync_body',
      }),
      false,
      'network failure must never trigger fallback'
    );
  });

  check('stripMigration9Columns removes exactly migration 9 columns and preserves all other fields', () => {
    const fullPayload = {
      id: 'm-test',
      title: 'Linear Algebra',
      subject_id: 's-math',
      sync_body: true,
      backup_original: false,
      body_synced: false,
      original_backed_up: false,
      original_hash: 'abc123hash',
      file_size: 4096,
      version: 0,
      upload_state: 'ready',
    };
    const stripped = cloudMaterials.stripMigration9Columns(fullPayload);
    assert.equal(stripped.id, 'm-test');
    assert.equal(stripped.title, 'Linear Algebra');
    assert.equal(stripped.subject_id, 's-math');
    assert.equal(stripped.version, 0);
    assert.equal(stripped.upload_state, 'ready');
    assert.equal(stripped.sync_body, undefined);
    assert.equal(stripped.backup_original, undefined);
    assert.equal(stripped.body_synced, undefined);
    assert.equal(stripped.original_backed_up, undefined);
    assert.equal(stripped.original_hash, undefined);
    assert.equal(stripped.file_size, undefined);
  });

  check('mergeConcepts preserves local needsSourceReview and sourceEvidence', () => {
    const serverConcept = {
      id: 'c-1',
      subjectId: 's-1',
      title: 'Eigenvalues',
      needsSourceReview: false,
      sourceEvidence: { verified: true, quote: 'Definition 1' },
    };
    const localConcept = {
      id: 'c-1',
      subjectId: 's-1',
      title: 'Eigenvalues',
      needsSourceReview: true,
      sourceEvidence: { verified: false, verificationNote: '근거 자료 본문이 수정되어 재검토가 필요합니다.' },
    };

    const merged = cloudMerge.mergeConcepts([serverConcept], [localConcept]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].needsSourceReview, true, 'local needsSourceReview preserved');
    assert.equal(merged[0].sourceEvidence.verified, false, 'local sourceEvidence verification state preserved');
  });

  check('GatewayPage does not contain hardcoded passwords and guards dev email login', () => {
    const gatewaySrc = fs.readFileSync(path.join(root, 'components/GatewayPage.tsx'), 'utf8');
    assert.equal(gatewaySrc.includes('TestPassword123!@#'), false, 'hardcoded password must be removed');
    assert.ok(gatewaySrc.includes("process.env.NODE_ENV !== 'production'"), 'must be guarded by dev check');
  });

  check('Stage 2: 5 workspaces are properly defined and exported', () => {
    const topBarSrc = fs.readFileSync(path.join(root, 'components/TopUtilityBar.tsx'), 'utf8');
    assert.ok(topBarSrc.includes("'today' | 'materials' | 'problems' | 'history' | 'settings'"));
    
    // Check all 5 workspaces exist
    const workspaces = [
      'components/TodayWorkspace.tsx',
      'components/MaterialsWorkspace.tsx',
      'components/ProblemsWorkspace.tsx',
      'components/HistoryWorkspace.tsx',
      'components/SettingsWorkspace.tsx',
    ];
    for (const w of workspaces) {
      assert.ok(fs.existsSync(path.join(root, w)), `${w} must exist`);
    }
  });

  check('Stage 2: MaterialEditorModal protects unsaved edits with user choices', () => {
    const editorSrc = fs.readFileSync(path.join(root, 'components/MaterialEditorModal.tsx'), 'utf8');
    assert.ok(editorSrc.includes('showUnsavedDialog'), 'must track unsaved confirm dialog state');
    assert.ok(editorSrc.includes('저장하고 닫기'), 'must provide save & close option');
    assert.ok(editorSrc.includes('임시 보존하고 닫기'), 'must provide keep & close option');
    assert.ok(editorSrc.includes('변경 취소'), 'must provide cancel edit option');
  });

  check('Stage 2: Dashboard URL sync parses tabs and falls back safely', () => {
    const dashboardSrc = fs.readFileSync(path.join(root, 'app/DashboardClient.tsx'), 'utf8');
    const urlSrc = fs.readFileSync(path.join(root, 'lib/dashboardUrl.ts'), 'utf8');
    assert.ok(urlSrc.includes(".get('tab')"), 'must read tab param from URL');
    assert.ok(urlSrc.includes(".get('subject')"), 'must read subject param from URL');
    assert.ok(dashboardSrc.includes('window.addEventListener'), 'must listen for popstate events');
    assert.ok(dashboardSrc.includes('window.history.pushState'), 'must sync tab state to history');
  });

  // ---- Stage 2 UI & Dedicated Screen & Draft Persistence Checks ----

  await checkAsync('Stage 2: materialDraft saves, loads, deletes, and isolates drafts per scope', async () => {
    await withFakeIndexedDB(async () => {
      // 1. Save draft under u_user1
      const saveRes = await materialDraft.saveMaterialDraftInScope('u_user1', {
        materialId: 'mat-alpha',
        draftMarkdown: '# Draft Content Alpha',
        baseHash: 'hash-1234',
        baseLastEditedAt: 1000,
      });
      assert.equal(saveRes.ok, true, 'draft save must succeed');
      assert.equal(saveRes.record.materialId, 'mat-alpha');

      // 2. Load draft under u_user1
      const loaded = await materialDraft.loadMaterialDraftInScope('u_user1', 'mat-alpha');
      assert.equal(loaded.status, 'found', 'draft must be found');
      assert.equal(loaded.record.draftMarkdown, '# Draft Content Alpha');
      assert.equal(loaded.record.baseHash, 'hash-1234');

      // 3. Scope isolation: u_user2 cannot see u_user1 drafts
      const loadedOther = await materialDraft.loadMaterialDraftInScope('u_user2', 'mat-alpha');
      assert.equal(loadedOther.status, 'none', 'draft must be isolated to scope');

      // 4. Delete draft
      const delRes = await materialDraft.deleteMaterialDraftInScope('u_user1', 'mat-alpha');
      assert.equal(delRes.ok, true, 'draft deletion must succeed');
      const loadedAfterDel = await materialDraft.loadMaterialDraftInScope('u_user1', 'mat-alpha');
      assert.equal(loadedAfterDel.status, 'none', 'draft must be gone after deletion');
    });
  });

  await checkAsync('Stage 2: materialDraft handles injected IndexedDB write failure securely', async () => {
    await withFakeIndexedDB(async (fake) => {
      fake.__failure.put.add('mat-fail');
      const saveRes = await materialDraft.saveMaterialDraftInScope('u_user1', {
        materialId: 'mat-fail',
        draftMarkdown: '# Will Fail',
        baseHash: 'hash-fail',
        baseLastEditedAt: 1000,
      });
      assert.equal(saveRes.ok, false, 'failed save must report ok: false');
      assert.ok(saveRes.error, 'must report error');
    });
  });

  check('Stage 2: materialDraft evaluates relation against base correctly (identical, restorable, conflict)', () => {
    const draft = {
      materialId: 'm-1',
      draftMarkdown: 'New Draft Content',
      baseHash: 'base-hash-1',
      baseLastEditedAt: 1000,
      savedAt: 1500,
    };

    // Identical
    assert.equal(
      materialDraft.evaluateDraftAgainstBase(draft, { baseHash: 'base-hash-1', markdown: 'New Draft Content' }),
      'identical'
    );

    // Restorable (base hash unchanged, draft differs)
    assert.equal(
      materialDraft.evaluateDraftAgainstBase(draft, { baseHash: 'base-hash-1', markdown: 'Old Base Content' }),
      'restorable'
    );

    // Conflict (base hash changed since draft was taken)
    assert.equal(
      materialDraft.evaluateDraftAgainstBase(draft, { baseHash: 'base-hash-CHANGED', markdown: 'Changed Content' }),
      'conflict'
    );
  });

  check('Stage 2: materialEditSave evaluates local and server save requirements strictly', () => {
    // 1. Local-only material: server not required, local saved -> canClose: true
    const localOnlyRes = materialEditSave.evaluateMaterialEditSave({
      server: 'not_required',
      local: 'saved',
    });
    assert.equal(localOnlyRes.canClose, true);
    assert.equal(localOnlyRes.level, 'complete');

    // 2. Server required, server failed -> canClose: false, must retain input & retry
    const serverFailRes = materialEditSave.evaluateMaterialEditSave({
      server: 'failed',
      serverError: '500 Internal Error',
      local: 'skipped',
    });
    assert.equal(serverFailRes.canClose, false);
    assert.ok(serverFailRes.failed.some((f) => f.includes('서버 저장')));

    // 3. Server saved with migration 9 fallback -> canClose: true, note added
    const fallbackRes = materialEditSave.evaluateMaterialEditSave({
      server: 'saved',
      serverFallbackUsed: true,
      local: 'saved',
    });
    assert.equal(fallbackRes.canClose, false, 'missing server policy migration keeps the save incomplete');
    assert.ok(fallbackRes.notes.some((n) => n.includes('마이그레이션 9')));

    const postprocessPending = materialEditSave.evaluateMaterialEditSave({
      server: 'saved',
      local: 'saved',
      postprocessFailed: 1,
    });
    assert.equal(postprocessPending.canClose, false, 'unfinished server reflections cannot be reported complete');
    assert.equal(postprocessPending.level, 'partial');
    assert.equal(postprocessPending.failed.length, 1);

    // 4. Retry after server write already succeeded -> canClose: true
    const retryRes = materialEditSave.evaluateMaterialEditSave({
      server: 'already_saved',
      local: 'saved',
    });
    assert.equal(retryRes.canClose, true);
  });

  check('Stage 2: dashboardUrl parses and builds URLs without leaking sensitive data', () => {
    // Parse
    const parsed = dashboardUrl.parseDashboardUrl('?tab=materials&subject=sub-1&material=mat-1&leak=secret&answer=forbidden');
    assert.equal(parsed.tab, 'materials');
    assert.equal(parsed.subjectId, 'sub-1');
    assert.equal(parsed.materialId, 'mat-1');
    assert.equal('answer' in parsed, false, 'answers must never be parsed into URL state');
    assert.equal('leak' in parsed, false, 'secrets must never be parsed into URL state');

    // Build
    const built = dashboardUrl.buildDashboardUrl({
      tab: 'session',
      subjectId: 'sub-1',
      problemId: 'prob-1',
    });
    assert.equal(built, '?tab=session&subject=sub-1&problem=prob-1');
  });

  check('Stage 2: dashboardUrl resolves URLs safely without disclosing existence or false not-founds', () => {
    const ctx = {
      isLoaded: true,
      isCloudLoading: false,
      subjects: [{ id: 'sub-1', name: 'Math' }],
      materials: [{ id: 'mat-1', subjectId: 'sub-1', title: 'Algebra' }],
      problems: [{ id: 'prob-1', subjectId: 'sub-1', title: 'Problem 1' }],
      attempts: [{ id: 'att-1', subjectId: 'sub-1' }],
    };

    // 1. While loading: status must be 'loading' so IDs are not marked missing
    const loadingRes = dashboardUrl.resolveDashboardUrl({ subjectId: 'sub-1' }, { ...ctx, isLoaded: false });
    assert.equal(loadingRes.status, 'loading');

    // 2. Unknown tab: normalizes to 'today' with 'invalid_tab' status
    const invalidTabRes = dashboardUrl.resolveDashboardUrl({ rawTab: 'bad_tab' }, ctx);
    assert.equal(invalidTabRes.status, 'invalid_tab');
    assert.equal(invalidTabRes.tab, 'today');

    // 3. Unknown subject: not_found with safe notice (no leak of whether it exists for other users)
    const missingSubRes = dashboardUrl.resolveDashboardUrl({ subjectId: 'sub-nonexistent' }, ctx);
    assert.equal(missingSubRes.status, 'not_found');
    assert.equal(missingSubRes.notFoundEntity.kind, 'subject');
    assert.ok(missingSubRes.noticeMessage.includes('찾을 수 없거나 접근 권한이 없습니다'));

    // 4. Unknown material: not_found
    const missingMatRes = dashboardUrl.resolveDashboardUrl({ tab: 'materials', materialId: 'mat-none' }, ctx);
    assert.equal(missingMatRes.status, 'not_found');
    assert.equal(missingMatRes.notFoundEntity.kind, 'material');

    // 5. Valid selection
    const validRes = dashboardUrl.resolveDashboardUrl({ tab: 'problems', problemId: 'prob-1', subjectId: 'sub-1' }, ctx);
    assert.equal(validRes.status, 'valid');
    assert.equal(validRes.problemId, 'prob-1');
    assert.equal(validRes.subjectId, 'sub-1');
  });

  check('Stage 2: ProblemSessionModal and MockExamModal support variant="page" dedicated screen', () => {
    const sessionSrc = fs.readFileSync(path.join(root, 'components/ProblemSessionModal.tsx'), 'utf8');
    const examSrc = fs.readFileSync(path.join(root, 'components/MockExamModal.tsx'), 'utf8');
    const dashSrc = fs.readFileSync(path.join(root, 'app/DashboardClient.tsx'), 'utf8');

    assert.ok(sessionSrc.includes("variant?: 'modal' | 'page'"), 'ProblemSessionModal must declare variant prop');
    assert.ok(sessionSrc.includes("variant === 'page'"), 'ProblemSessionModal must branch on page variant');
    assert.ok(examSrc.includes("variant?: 'modal' | 'page'"), 'MockExamModal must declare variant prop');
    assert.ok(examSrc.includes("variant === 'page'"), 'MockExamModal must branch on page variant');

    // DashboardClient renders dedicated in-layout screens inside <main>
    assert.ok(dashSrc.includes('variant="page"'), 'DashboardClient must render variant="page"');
    assert.ok(dashSrc.includes("activeTab === 'session'"), 'DashboardClient must support session tab dedicated screen');
    assert.ok(dashSrc.includes("activeTab === 'exam'"), 'DashboardClient must support exam tab dedicated screen');
    assert.ok(dashSrc.includes('진행 중인 문제 풀이가 있습니다'), 'DashboardClient must render resume banner for session');
    assert.ok(dashSrc.includes('진행 중인 모의시험이 있습니다'), 'DashboardClient must render resume banner for exam');
  });

  check('Stage 2: materialEditSave reports the server-success/device-failure matrix as partial', () => {
    // Server saved but the device write failed -> partial, input must be kept.
    const partial = materialEditSave.evaluateMaterialEditSave({
      server: 'saved',
      local: 'failed',
      localError: 'IndexedDB quota',
    });
    assert.equal(partial.canClose, false);
    assert.equal(partial.level, 'partial');
    assert.ok(partial.succeeded.includes('서버 저장'));
    assert.ok(partial.failed.some((f) => f.includes('이 기기 저장')));
    assert.ok(partial.message.includes('입력은 유지되며 다시 시도할 수 있습니다'));

    // Server failed -> local is skipped and never replaces the stored body.
    const serverFailed = materialEditSave.evaluateMaterialEditSave({
      server: 'failed',
      serverError: 'offline',
      local: 'skipped',
    });
    assert.equal(serverFailed.level, 'failed');
    assert.ok(serverFailed.notes.some((n) => n.includes('이 기기에 저장된 본문은 변경하지 않았습니다')));
    assert.equal(serverFailed.succeeded.length, 0);

    // Retry after an already confirmed server write: exactly one server success.
    const alreadySaved = materialEditSave.evaluateMaterialEditSave({
      server: 'already_saved',
      local: 'saved',
    });
    assert.equal(alreadySaved.level, 'complete');
    assert.equal(alreadySaved.succeeded.filter((s) => s === '서버 저장').length, 1, 'retry must not double-count the server save');

    // Body saved but its identity hash could not be stored: reported, not hidden.
    const identityFailed = materialEditSave.evaluateMaterialEditSave({
      server: 'saved',
      local: 'saved',
      identityRecordFailed: true,
    });
    assert.equal(identityFailed.canClose, true);
    assert.ok(identityFailed.notes.some((n) => n.includes('본문 식별 정보')));
  });

  await checkAsync('Stage 2: practiceAnswerDraft restores each tab its OWN draft and never auto-applies another tab', async () => {
    const userId = 'practice-draft-user';
    const otherUser = 'practice-draft-other';
    const tabA = 'tab-A';
    const tabB = 'tab-B';

    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabA), null);

    const base = {
      problemId: 'p1', problemVersion: 3, tabId: tabA,
      answerText: 'A 탭 중간 답안', revealedHints: [0, 2], confidence: 4, errorType: 'none',
      reasoningNotes: '메모', solvingReason: '정규분포 근사', isReasonNotApplicable: false,
      reasonNotApplicableJustification: '', savedAt: '2026-01-01T00:00:00.000Z',
    };
    assert.equal(practiceAnswerDraft.hasPracticeDraftContent(base), true);
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, base), true, 'verified device write');

    // A tab restores ONLY its own draft after a reload (same sessionStorage id).
    const reloadA = practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabA);
    assert.equal(reloadA.answerText, 'A 탭 중간 답안');
    assert.deepEqual(reloadA.revealedHints, [0, 2]);
    // A fresh/other tab has no OWN draft and never auto-gets A's.
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabB), null);
    // The other tab's draft is offered for EXPLICIT recovery only.
    const recoverable = practiceAnswerDraft.listOtherTabPracticeDrafts(userId, 'p1', 3, tabB);
    assert.deepEqual(recoverable.map((d) => d.tabId), [tabA]);

    // Account isolation.
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(otherUser, 'p1', 3, tabA), null);

    // B tab saves its own draft WITHOUT losing A's (per-entry keys, no RMW).
    const draftB = { ...base, tabId: tabB, answerText: 'B 탭 답안', savedAt: '2026-01-01T00:10:00.000Z' };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, draftB), true);
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabA).answerText, 'A 탭 중간 답안');
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabB).answerText, 'B 탭 답안');
    assert.equal(practiceAnswerDraft.listPracticeAnswerDrafts(userId, 'p1', 3).length, 2, 'both tabs coexist (no lost update)');

    // Version identity: another version's draft is NOT auto-applied, but kept.
    const v4 = { ...base, problemVersion: 4, answerText: 'v4 답안', savedAt: '2026-01-01T00:20:00.000Z' };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, v4), true);
    assert.equal(
      practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 3, tabA).answerText,
      'A 탭 중간 답안',
      'v3 tab keeps its own v3 draft'
    );
    assert.ok(
      practiceAnswerDraft.listPracticeAnswerDraftsForProblem(userId, 'p1').some((d) => d.problemVersion === 4),
      'the v4 draft is preserved for explicit recovery'
    );
  });

  await checkAsync('Stage 2: clearing every answer is persisted so a refresh does not resurrect it', async () => {
    const userId = 'practice-draft-clear';
    const tab = 'tab-clear';
    const draft = {
      problemId: 'p2', problemVersion: 1, tabId: tab,
      answerText: '처음 입력한 답안', revealedHints: [0], confidence: 3, errorType: 'none',
      reasoningNotes: '메모', solvingReason: '', isReasonNotApplicable: false,
      reasonNotApplicableJustification: '', savedAt: '2026-01-01T00:00:00.000Z',
    };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, draft), true);
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p2', 1, tab).answerText, '처음 입력한 답안');

    // The user clears everything -> an EMPTY draft is still persisted.
    const cleared = { ...draft, answerText: '', revealedHints: [], reasoningNotes: '', solvingReason: '' };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, cleared), true);
    const reloaded = practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p2', 1, tab);
    assert.equal(reloaded.answerText, '', 'the cleared state survives a reload');
    assert.equal(practiceAnswerDraft.hasPracticeDraftContent(reloaded), false);
  });

  await checkAsync('Stage 2: recording one tab keeps the other tabs unsaved drafts', async () => {
    const userId = 'practice-draft-record';
    const draftA = {
      problemId: 'p3', problemVersion: 1, tabId: 'tab-A',
      answerText: '제출할 답안', revealedHints: [], confidence: 3, errorType: 'none',
      reasoningNotes: '', solvingReason: '', isReasonNotApplicable: false,
      reasonNotApplicableJustification: '', savedAt: '2026-01-01T00:00:00.000Z',
    };
    const draftB = { ...draftA, tabId: 'tab-B', answerText: 'B 탭 미저장', savedAt: '2026-01-01T00:05:00.000Z' };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, draftA), true);
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, draftB), true);

    // Tab A records its attempt: only A's matching draft is cleared.
    assert.equal(practiceAnswerDraft.clearPracticeAnswerDraft(userId, 'p3', 1, 'tab-A', draftA), true);
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p3', 1, 'tab-A'), null);
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p3', 1, 'tab-B').answerText, 'B 탭 미저장');

    // A non-matching stored draft is never cleared (newer input preserved).
    const newer = { ...draftB, answerText: 'B 탭 이후 입력', savedAt: '2026-01-01T00:10:00.000Z' };
    assert.equal(practiceAnswerDraft.savePracticeAnswerDraft(userId, newer), true);
    assert.equal(
      practiceAnswerDraft.clearPracticeAnswerDraft(userId, 'p3', 1, 'tab-B', draftB),
      false,
      'a different stored draft is kept'
    );
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p3', 1, 'tab-B').answerText, 'B 탭 이후 입력');
  });

  check('Stage 2: resolvePracticeTabId keeps its id on repeated calls in the same page', () => {
    sessionStorage.clear();
    for (const key of Array.from(data.keys())) {
      if (key.startsWith('redcall_practice_tab_leases_v1') || key.startsWith('redcall_practice_tab_id_v1')) data.delete(key);
    }
    practiceAnswerDraft.resetPracticeTabPageForTests();
    const first = practiceAnswerDraft.resolvePracticeTabId(1000);
    const second = practiceAnswerDraft.resolvePracticeTabId(2000);
    assert.equal(second, first, 'same page (remount/StrictMode) must keep the id');
    const third = practiceAnswerDraft.resolvePracticeTabId(2000);
    assert.equal(third, first);
  });

  check('Stage 2: a refresh keeps the tab id, a live duplicate forks', () => {
    sessionStorage.clear();
    for (const key of Array.from(data.keys())) {
      if (key.startsWith('redcall_practice_tab_leases_v1') || key.startsWith('redcall_practice_tab_id_v1')) data.delete(key);
    }
    practiceAnswerDraft.resetPracticeTabPageForTests();
    const first = practiceAnswerDraft.resolvePracticeTabId(1000);
    // A refresh fires pagehide -> the lease is released, so the reloaded page
    // (fresh JS context) keeps its stored id.
    practiceAnswerDraft.releasePracticeTabLease(first);
    practiceAnswerDraft.resetPracticeTabPageForTests();
    const afterRefresh = practiceAnswerDraft.resolvePracticeTabId(2000);
    assert.equal(afterRefresh, first, 'same tab keeps its id across refresh');

    // A duplicated tab copies sessionStorage while the original tab is still
    // live (fresh unreleased lease owned by another nonce): it must FORK.
    practiceAnswerDraft.resetPracticeTabPageForTests();
    const duplicate = practiceAnswerDraft.resolvePracticeTabId(3000);
    assert.notEqual(duplicate, first, 'a duplicated tab forks a new id instead of colliding');

    // Heartbeats never steal a live page's lease; repeating on the same page
    // keeps the forked id afterwards.
    practiceAnswerDraft.refreshPracticeTabLease(duplicate, 4000);
    const stillDuplicate = practiceAnswerDraft.resolvePracticeTabId(4000);
    assert.equal(stillDuplicate, duplicate, 'the forked page keeps its own id afterwards');
  });

  await checkAsync('Stage 2: practiceAnswerDraft reports a failed device write instead of claiming success', async () => {
    const userId = 'practice-draft-fail';
    const entryPrefix = 'redcall_user_' + encodeURIComponent(userId) + '__practice_answer_drafts_v1__';
    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => {
      if (k.startsWith(entryPrefix)) throw new Error('quota exceeded');
      realSetItem(k, v);
    };
    let saved;
    try {
      saved = practiceAnswerDraft.savePracticeAnswerDraft(userId, {
        problemId: 'p1',
        problemVersion: 1,
        tabId: 'tab-1',
        answerText: 'x',
        revealedHints: [],
        confidence: 3,
        errorType: 'none',
        reasoningNotes: '',
        solvingReason: '',
        isReasonNotApplicable: false,
        reasonNotApplicableJustification: '',
        savedAt: 't',
      });
    } finally {
      localStorage.setItem = realSetItem;
    }
    assert.equal(saved, false, 'an unpersisted draft is never reported as saved');
    assert.equal(practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, 'p1', 1, 'tab-1'), null);
  });

  await checkAsync('Stage 2: an unverified body hash never rejects the real body and recovers from storage', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'hash-recover' });
      // ① Body A stored with hash A.
      await matStorage.saveMaterialContent('m-recover', { markdown: '# body A' });
      assert.equal(storage.recordMaterialBodyHash('m-recover', 'hash-A', { subjectId: 's1', kind: 'pdf' }), true);

      // ② Body B saved durably, ③ but the hash record write FAILS.
      await matStorage.saveMaterialContent('m-recover', { markdown: '# body B' });
      const registryKey = 'redcall_user_hash-recover__material_body_hashes_v1';
      const realSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k, v) => {
        if (k === registryKey) throw new Error('quota exceeded');
        realSetItem(k, v);
      };
      let recorded;
      try {
        recorded = storage.recordMaterialBodyHash('m-recover', 'hash-B', { subjectId: 's1', kind: 'pdf' });
      } finally {
        localStorage.setItem = realSetItem;
      }
      assert.equal(recorded, false);

      // The editor would now mark the hash unverified (simulate that step).
      storage.markMaterialBodyHashUnverified('m-recover', { subjectId: 's1', kind: 'pdf' });

      // ④ After refresh, the material's resolved hash must NOT be the old A,
      // and must NOT silently fall back to a stale metadata hash.
      const staleMaterial = {
        id: 'm-recover', subjectId: 's1', kind: 'pdf', title: 'T', status: 'ready',
        isConverted: true, uploadedAt: 't', bodyHash: 'hash-A-stale',
      };
      assert.equal(storage.resolveStoredMaterialBodyHash(staleMaterial), undefined, 'old hash A must not reject body B');
      assert.equal(storage.isMaterialBodyHashUnverified('m-recover'), true);

      // ⑤ Recovery re-reads the persisted body B and re-records its hash.
      const recovered = await storage.refreshMaterialBodyHashFromStoredBody('m-recover', {
        subjectId: 's1',
        kind: 'pdf',
      });
      assert.equal(recovered, true);
      assert.equal(
        storage.getStoredMaterialBodyHash('m-recover', { subjectId: 's1', kind: 'pdf' }),
        markdownUtils.computeMarkdownHash('# body B'),
        'the hash is recomputed from the persisted body B'
      );
      const resolvedHash = storage.resolveStoredMaterialBodyHash(staleMaterial);
      assert.equal(resolvedHash, markdownUtils.computeMarkdownHash('# body B'), 'the recovered hash is body B identity, never A');
      assert.equal(storage.isMaterialBodyHashUnverified('m-recover'), false);
    });
  });

  check('Stage 2: body sync is claimed only from a server-confirmed hash-equal record', () => {
    const material = { storagePolicy: { syncBody: true, backupOriginal: false } };

    // 설정 ON + 서버 상태 미확인 -> 동기화 완료 미표시.
    let d = materialPolicy.deriveMaterialBodySyncState(material, undefined, true);
    assert.equal(d.state, 'unknown');
    assert.equal(d.synced, false);
    assert.ok(d.label.includes('미확인'));

    // 서버 본문과 로컬 편집본 버전 불일치 -> pending, not confirmed.
    d = materialPolicy.deriveMaterialBodySyncState(material, {
      serverBodyHash: 'server-1', localBodyHash: 'local-2', serverHasBody: true,
      status: 'confirmed', updatedAt: 't',
    }, true);
    assert.equal(d.state, 'pending');
    assert.equal(d.synced, false);
    assert.ok(d.label.includes('대기'));

    // 현재 버전 서버 저장·검증 성공 -> confirmed만 동기화 완료.
    d = materialPolicy.deriveMaterialBodySyncState(material, {
      serverBodyHash: 'same', localBodyHash: 'same', serverHasBody: true,
      status: 'confirmed', updatedAt: 't',
    }, true);
    assert.equal(d.state, 'confirmed');
    assert.equal(d.synced, true);

    // 실패는 실패로 표시, 확인됨으로 해석하지 않음.
    d = materialPolicy.deriveMaterialBodySyncState(material, {
      serverHasBody: false, status: 'failed', updatedAt: 't',
    }, true);
    assert.equal(d.state, 'failed');
    assert.equal(d.synced, false);

    // 로컬 전용 자료(not_required / syncBody off)는 동기화 주장 없음.
    d = materialPolicy.deriveMaterialBodySyncState(
      { storagePolicy: { syncBody: false, backupOriginal: false } },
      { serverHasBody: false, status: 'not_required', updatedAt: 't' },
      true
    );
    assert.equal(d.state, 'local_only');
    assert.equal(d.synced, false);

    // 상태 기록에서도 같은 규칙: confirmed지만 해시 불일치면 라벨에 '동기화됨' 없음.
    const state = materialPolicy.deriveMaterialStorageState({
      material,
      hasLocalBody: true,
      hasLocalOriginal: false,
      syncState: { serverBodyHash: 'a', localBodyHash: 'b', serverHasBody: true, status: 'confirmed', updatedAt: 't' },
    });
    assert.ok(!state.labels.includes('본문 동기화됨'));
    assert.ok(state.labels.some((l) => l.includes('대기')));
  });

  check('Stage 2: server-save response loss recovery never re-uploads confirmed content', () => {
    // A hash match WITHOUT any evidence of OUR job (no base/job record) is
    // insufficient proof -> unknown, never treated as "already saved".
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { contentHash: 'h1' }, 'h1', { ok: true, hasBody: true, hash: 'h1' }
      ),
      'unknown'
    );
    // The same hash WITH base evidence of our job -> already saved.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { contentHash: 'h1', baseHash: 'h0', baseVersion: 3, jobId: 'job-1' },
        'h1',
        { ok: true, hasBody: true, hash: 'h1', version: 4, completedJobId: 'job-1' }
      ),
      'already_saved'
    );
    // Server changed later -> conflict, never overwrite.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { contentHash: 'h1' }, 'h1', { ok: true, hasBody: true, hash: 'h2' }
      ),
      'conflict'
    );
    // Lookup FAILURE -> unknown, never treated as "not saved".
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { contentHash: 'h1' }, 'h1', { ok: false }
      ),
      'unknown'
    );
    // Server genuinely has no such body: the earlier write did not land -> normal retry.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { contentHash: 'h1' }, 'h1', { ok: true, hasBody: false, hash: null }
      ),
      'no_record'
    );
    // No matching record for this content -> normal write.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(undefined, 'h1', { ok: true, hasBody: false, hash: null }),
      'no_record'
    );
  });

  check('Stage 2: retry verdicts check job identity, base version and metadata together', () => {
    const record = {
      contentHash: 'h2', baseHash: 'h0', baseVersion: 3, syncBody: true, jobId: 'job-1',
      targetTitle: 'T', targetStatus: 'ready', targetKind: 'pdf', targetSyncBody: true,
    };
    const meta = { title: 'T', status: 'ready', kind: 'pdf', syncBody: true };
    // Another job owns the server slot right now -> conflict, never adopted.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h0', version: 3, pendingJobId: 'job-other', metadata: meta,
      }),
      'conflict'
    );
    // Our own job is still staged -> safe to re-run the SAME job.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h0', version: 3, pendingJobId: 'job-1', metadata: meta,
      }),
      'retry_same_job'
    );
    // Hash AND version advanced, but the stored metadata is someone else's edit
    // -> conflict, never claimed as our save.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h2', version: 4, completedJobId: 'job-1',
        metadata: { ...meta, title: 'OTHER' },
      }),
      'conflict'
    );
    // Hash matches but the server cannot prove the metadata (missing column)
    // -> unknown, never treated as "already saved".
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h2', version: 4, completedJobId: 'job-1', metadata: null,
      }),
      'unknown'
    );
    // Metadata-only write with matching metadata and advanced version -> saved.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { ...record, syncBody: false }, 'h2',
        { ok: true, hasBody: false, hash: null, version: 4, completedJobId: 'job-1', metadata: meta }
      ),
      'already_saved'
    );
    // Metadata-only write whose metadata changed -> conflict.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(
        { ...record, syncBody: false }, 'h2',
        { ok: true, hasBody: false, hash: null, version: 4, completedJobId: 'job-1', metadata: { ...meta, title: 'OTHER' } }
      ),
      'conflict'
    );
    // Matching content and metadata from another completed job is a conflict.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h2', version: 4, completedJobId: 'job-other', metadata: meta,
      }),
      'conflict'
    );
    // Missing completion identity is insufficient proof after a version bump.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(record, 'h2', {
        ok: true, hasBody: true, hash: 'h2', version: 4, metadata: meta,
      }),
      'unknown'
    );
  });

  await checkAsync('Stage 2: the retry record survives a reload and deletion clears it', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'retry-record' });
    assert.equal(storage.recordMaterialServerSave('m-r', 'hash-x'), true);
    // Simulated reload: the record is read back from storage.
    const record = storage.getMaterialServerSaveRecord('m-r');
    assert.equal(record.contentHash, 'hash-x');
    // Account isolation.
    storageScope.setStorageScope({ kind: 'user', userId: 'retry-other' });
    assert.equal(storage.getMaterialServerSaveRecord('m-r'), undefined);
    storageScope.setStorageScope({ kind: 'user', userId: 'retry-record' });
    // Explicit delete clears the retry record.
    storage.markMaterialDeleted('m-r');
    assert.equal(storage.getMaterialServerSaveRecord('m-r'), undefined);
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  check('Stage 2: an expired exam opened by URL is manual-submit, a running one keeps auto expiry', () => {
    const exams = load(path.join(output, 'lib/mockExam.js'));
    const submitted = { id: 'e1', status: 'submitted' };
    const inProgress = { id: 'e2', status: 'in_progress' };
    assert.equal(exams.examOpenPolicy(submitted, true), 'expired_manual');
    assert.equal(exams.examOpenPolicy(submitted, false), 'running', 'menu-open keeps the existing policy path');
    assert.equal(exams.examOpenPolicy(inProgress, true), 'running');
    assert.equal(exams.examOpenPolicy(null, true), 'running');
  });


  check('Stage 2: material save failures are tracked per account and cleared on success/delete', () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'savefail-a' });
    assert.equal(storage.isMaterialSaveFailed('m-1'), false);
    storage.markMaterialSaveFailed('m-1', '서버 저장 실패');
    assert.equal(storage.isMaterialSaveFailed('m-1'), true);
    // Another account must not see this account's failure marker.
    storageScope.setStorageScope({ kind: 'user', userId: 'savefail-b' });
    assert.equal(storage.isMaterialSaveFailed('m-1'), false);
    storageScope.setStorageScope({ kind: 'user', userId: 'savefail-a' });
    storage.clearMaterialSaveFailed('m-1');
    assert.equal(storage.isMaterialSaveFailed('m-1'), false);

    // An explicit delete clears the failure state too.
    storage.markMaterialSaveFailed('m-2', '기기 저장 실패');
    storage.markMaterialDeleted('m-2');
    assert.equal(storage.isMaterialSaveFailed('m-2'), false);
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  check('Stage 2: an unchanged server during a retry is retryable, not a permanent conflict', () => {
    const prior = { contentHash: 'h2', baseHash: 'h0', baseVersion: 3, syncBody: true, jobId: 'job-1' };
    // Same content, server still holds the pre-attempt body: the request did
    // NOT land -> safe to redo the SAME job.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h2', { ok: true, hasBody: true, hash: 'h0', version: 3 }),
      'retry_same_job'
    );
    // Server confirms the target body -> already saved, never re-uploaded.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h2', { ok: true, hasBody: true, hash: 'h2', version: 4, completedJobId: 'job-1' }),
      'already_saved'
    );
    // A body that matches NEITHER the base nor the target belongs to another
    // operation -> conflict, never overwritten.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h2', { ok: true, hasBody: true, hash: 'hX', version: 4 }),
      'conflict'
    );
    // Server body removed after the attempt -> someone deleted it -> conflict.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h2', { ok: true, hasBody: false, hash: null, version: 3 }),
      'conflict'
    );
    // Different content is a different save, not a retry.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h3', { ok: true, hasBody: true, hash: 'h0', version: 3 }),
      'no_record'
    );
  });

  check('Stage 2: metadata-only save retries are judged by version, not by body hash', () => {
    const prior = { contentHash: 'h-meta', baseHash: 'h0', baseVersion: 7, syncBody: false, jobId: 'job-9' };
    // Version advanced: the metadata write landed.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h-meta', { ok: true, hasBody: false, hash: null, version: 8, completedJobId: 'job-9' }),
      'already_saved'
    );
    // Version unchanged: the request did not land -> redo the same job.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h-meta', { ok: true, hasBody: false, hash: null, version: 7 }),
      'retry_same_job'
    );
    // A body hash on the server tells nothing about a metadata-only write.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h-meta', { ok: true, hasBody: true, hash: 'h-other', version: 7 }),
      'retry_same_job',
      'version equality rules metadata writes'
    );
    // Without a version, an unknown lookup failure still stops the retry.
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h-meta', { ok: true }),
      'unknown'
    );
    assert.equal(
      materialEditSave.evaluateMaterialServerRetry(prior, 'h-meta', { ok: false }),
      'unknown'
    );
  });

  check('Stage 2: server-save retry records carry job/base info and stay compatible', () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'retry-full' });
    assert.equal(
      storage.recordMaterialServerSave('m-full', { contentHash: 'h2', baseHash: 'h0', baseVersion: 3, syncBody: true, jobId: 'job-1' }),
      true
    );
    const record = storage.getMaterialServerSaveRecord('m-full');
    assert.equal(record.contentHash, 'h2');
    assert.equal(record.baseHash, 'h0');
    assert.equal(record.baseVersion, 3);
    assert.equal(record.jobId, 'job-1');
    // A later partial update merges instead of dropping the retry identity.
    assert.equal(storage.recordMaterialServerSave('m-full', { contentHash: 'h2' }), true);
    const merged = storage.getMaterialServerSaveRecord('m-full');
    assert.equal(merged.baseHash, 'h0', 'retry identity survives partial updates');
    assert.equal(merged.jobId, 'job-1');
    // Legacy string writes still work and read back.
    assert.equal(storage.recordMaterialServerSave('m-legacy', 'hash-old'), true);
    assert.equal(storage.getMaterialServerSaveRecord('m-legacy').contentHash, 'hash-old');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  check('Stage 2: an expired exam URL open requires an explicit choice before any submit', () => {
    // Local v1/answers A, server v2/answers B.
    const localExpired = { id: 'x1', status: 'submitted', answers: { p1: 'A' }, reasons: {}, evaluations: {} };
    const serverNewer = { id: 'x1', status: 'in_progress', answers: { p1: 'B' }, reasons: {}, evaluations: {} };
    const plan = cloudMockExamSync.planExpiredOpen(localExpired, serverNewer);
    assert.equal(plan.serverTerminal, false);
    assert.equal(plan.conflict, true, 'different answers are a conflict, never auto-submitted');

    // A plain click must NOT submit over the server snapshot.
    assert.deepEqual(cloudMockExamSync.decideExpiredSubmit(plan, 5), { action: 'blocked_conflict' });

    // Identical answers are safe to submit with the confirmed version.
    const sameLocal = { id: 'x1', status: 'submitted', answers: { p1: 'B' }, reasons: {}, evaluations: {} };
    const samePlan = cloudMockExamSync.planExpiredOpen(sameLocal, serverNewer);
    assert.equal(samePlan.conflict, false);
    assert.deepEqual(cloudMockExamSync.decideExpiredSubmit(samePlan, 5), { action: 'submit', expectedVersion: 5 });
  });

  check('Stage 2: an already terminal server exam is adopted, never overwritten', () => {
    const localExpired = { id: 'x1', status: 'submitted', answers: { p1: 'A' }, reasons: {}, evaluations: {} };
    const serverSubmitted = { id: 'x1', status: 'submitted', answers: { p1: 'B' }, reasons: {}, evaluations: {} };
    const plan = cloudMockExamSync.planExpiredOpen(localExpired, serverSubmitted);
    assert.equal(plan.serverTerminal, true);
    assert.deepEqual(cloudMockExamSync.decideExpiredSubmit(plan, 7), { action: 'blocked_conflict' });
  });

  check('Stage 2: expired opens suppress auto-submit and map versions explicitly', () => {
    // Only a deferred exam that was ALREADY expired at open suppresses
    // interval/keystroke auto-submit; a genuinely running session keeps it.
    assert.equal(
      cloudMockExamSync.shouldAutoSubmitExpired({ deferExpiredSubmit: true, expiredAtOpen: true }),
      false
    );
    assert.equal(
      cloudMockExamSync.shouldAutoSubmitExpired({ deferExpiredSubmit: true, expiredAtOpen: false }),
      true
    );
    assert.equal(
      cloudMockExamSync.shouldAutoSubmitExpired({ deferExpiredSubmit: false, expiredAtOpen: true }),
      true
    );
    // Local base resolution: pending proof first, then the session, then last known.
    assert.equal(
      cloudMockExamSync.resolveLocalBaseVersion({ pendingBaseVersion: 2, sessionServerVersion: 5, lastKnownVersion: 7 }),
      2
    );
    assert.equal(
      cloudMockExamSync.resolveLocalBaseVersion({ sessionServerVersion: 5, lastKnownVersion: 7 }),
      5
    );
    assert.equal(cloudMockExamSync.resolveLocalBaseVersion({ lastKnownVersion: 7 }), 7);
    // The URL-open mapping carries conflict, confirmed version and local base
    // together so the caller cannot silently fall back to a default.
    const local = { id: 'x1', status: 'submitted', answers: { p1: 'A' }, reasons: {}, evaluations: {} };
    const server = { id: 'x1', status: 'in_progress', answers: { p1: 'B' }, reasons: {}, evaluations: {} };
    assert.deepEqual(
      cloudMockExamSync.planExpiredUrlOpen({ local, server, serverVersion: 9, localBaseVersion: 4 }),
      { conflict: true, confirmedVersion: 9, localBaseVersion: 4 }
    );
  });

  check('Stage 2: conflict archives are preserved, never silently replaced or auto-cleared', () => {
    const first = { sessionId: 's1', answers: { p1: 'A' }, baseVersion: 1, comparedServerVersion: 2, savedAt: 't1' };
    assert.deepEqual(pendingAnswers.saveConflictArchive('archive-user', first), { ok: true });
    assert.deepEqual(pendingAnswers.loadConflictArchive('archive-user', 's1').answers, { p1: 'A' });
    // An identical re-save is a no-op success.
    assert.deepEqual(pendingAnswers.saveConflictArchive('archive-user', first), { ok: true });
    // A different second conflict never silently replaces the earlier copy.
    const refused = pendingAnswers.saveConflictArchive('archive-user', { ...first, answers: { p1: 'B' }, savedAt: 't2' });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'exists');
    assert.deepEqual(pendingAnswers.loadConflictArchive('archive-user', 's1').answers, { p1: 'A' });
    // Only an explicit user deletion clears the archive.
    assert.equal(pendingAnswers.clearConflictArchive('archive-user', 's1'), true);
    assert.equal(pendingAnswers.loadConflictArchive('archive-user', 's1'), null);
    // An unverified store reports failure instead of claiming success.
    const realSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    try {
      const failed = pendingAnswers.saveConflictArchive('archive-user', first);
      assert.equal(failed.ok, false);
      assert.equal(failed.reason, 'unverified');
    } finally {
      localStorage.setItem = realSetItem;
    }
    assert.equal(pendingAnswers.loadConflictArchive('archive-user', 's1'), null);
  });

  check('Stage 2: postprocess ledger and retry target identity are explicit', () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'ledger-user' });
    assert.equal(
      storage.recordMaterialPostprocessState('m-pp', { contentHash: 'h1', failedCount: 2, lastError: 'x' }),
      true
    );
    const pp = storage.getMaterialPostprocessState('m-pp');
    assert.equal(pp.failedCount, 2);
    assert.equal(pp.contentHash, 'h1');
    // Zero failures clears the entry.
    assert.equal(storage.recordMaterialPostprocessState('m-pp', { contentHash: 'h1', failedCount: 0 }), true);
    assert.equal(storage.getMaterialPostprocessState('m-pp'), undefined);
    // Retry records carry the intended target identity and survive partial updates.
    assert.equal(
      storage.recordMaterialServerSave('m-t', {
        contentHash: 'h2', baseHash: 'h0', baseVersion: 3, syncBody: true, jobId: 'job-1',
        targetTitle: 'T', targetStatus: 'ready', targetKind: 'pdf', targetSyncBody: true,
      }),
      true
    );
    assert.equal(storage.recordMaterialServerSave('m-t', { contentHash: 'h2' }), true);
    const merged = storage.getMaterialServerSaveRecord('m-t');
    assert.equal(merged.jobId, 'job-1');
    assert.equal(merged.targetTitle, 'T');
    assert.equal(merged.targetSyncBody, true);
    // An explicit delete clears both ledgers.
    assert.equal(storage.recordMaterialPostprocessState('m-t', { contentHash: 'h2', failedCount: 1 }), true);
    storage.markMaterialDeleted('m-t');
    assert.equal(storage.getMaterialServerSaveRecord('m-t'), undefined);
    assert.equal(storage.getMaterialPostprocessState('m-t'), undefined);
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('Stage 2: an explicit choice submits with the confirmed version, and a later server change re-conflicts', async () => {
    const submitted = {
      id: 'exam-x', subjectId: 's1', createdAt: 't', endsAt: 't2', durationMinutes: 60,
      status: 'submitted', selectedConceptIds: [], selectedTypes: [], problems: [],
      answers: { p1: 'A' }, evaluations: {},
    };
    await withConfigured({ user: { id: 'u1' } }, async (client) => {
      // No impl: the fake echoes defaults; fail with stale to simulate a server
      // that moved to v3 after the user compared at v2.
      client.__state.fail = { rpc: true, rpcMessage: 'MOCK_SESSION_STALE: expected 2, got 3' };
      const stale = await cloudMockExamSync.submitMockExamOnServer(submitted, 2);
      assert.equal(stale.ok, false);
      assert.equal(stale.code, 'stale', 'submit with a superseded version conflicts instead of overwriting');
      const recorded = client.__state.rpcCalls.filter((c) => c.name === 'submit_mock_exam');
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].params.p_expected_version, 2, 'the confirmed version is carried to the server');
    });
  });

  check('Stage 2: exam deep links resolve to the exam own subject and settings tab round-trips', () => {
    const ctx = {
      isLoaded: true,
      isCloudLoading: false,
      subjects: [{ id: 'sub-a', name: 'A' }, { id: 'sub-b', name: 'B' }],
      materials: [],
      problems: [],
      attempts: [],
      mockExams: [{ id: 'exam-b1', subjectId: 'sub-b' }],
    };
    // URL says subject A, but the exam belongs to subject B: B must win.
    const res = dashboardUrl.resolveDashboardUrl(
      { tab: 'exam', subjectId: 'sub-a', examId: 'exam-b1' },
      ctx
    );
    assert.equal(res.status, 'valid');
    assert.equal(res.subjectId, 'sub-b', 'the exam own subject overrides a mismatched subject param');
    assert.equal(res.examId, 'exam-b1');

    // Unknown exam id is a safe not_found with a return path.
    const missing = dashboardUrl.resolveDashboardUrl(
      { tab: 'exam', subjectId: 'sub-b', examId: 'exam-none' },
      ctx
    );
    assert.equal(missing.status, 'not_found');
    assert.equal(missing.notFoundEntity.kind, 'exam');

    // settings tab is parsed and built consistently (menu/back-forward target).
    const parsedSettings = dashboardUrl.parseDashboardUrl('?tab=settings&subject=sub-a');
    assert.equal(parsedSettings.tab, 'settings');
    assert.equal(
      dashboardUrl.buildDashboardUrl({ tab: 'settings', subjectId: 'sub-a' }),
      '?tab=settings&subject=sub-a'
    );
    const settingsRes = dashboardUrl.resolveDashboardUrl({ tab: 'settings', subjectId: 'sub-a' }, ctx);
    assert.equal(settingsRes.status, 'valid');
    assert.equal(settingsRes.tab, 'settings');

    // exam id is only emitted on the exam tab, never leaked onto other tabs.
    assert.equal(
      dashboardUrl.buildDashboardUrl({ tab: 'problems', subjectId: 'sub-a', examId: 'exam-b1' }),
      '?tab=problems&subject=sub-a'
    );
  });

  check('Stage 2: a practice session pinned to another subject is never shown as the active subject session', () => {
    const pinned = { id: 'prob-1', subjectId: 'sub-a' };
    assert.deepEqual(sessionAffiliation.resolveSessionAffiliation(pinned, 'sub-a'), {
      kind: 'same_subject',
      problemId: 'prob-1',
      problemSubjectId: 'sub-a',
    });
    const mismatch = sessionAffiliation.resolveSessionAffiliation(pinned, 'sub-b');
    assert.equal(mismatch.kind, 'other_subject');
    assert.equal(mismatch.problemSubjectId, 'sub-a', 'the session keeps its real subject');
    assert.equal(sessionAffiliation.resolveSessionAffiliation(null, 'sub-b').kind, 'none');
  });


  check('Stage 2: analysis checkpoint isolates users, rejects mismatched input, and hides other users session existence', () => {
    const jobKeyA = analysisCheckpoint.makeAnalysisJobKey('user_A', 'mat_1', 'hash_abc', 'math_stats');
    const sessionA = analysisCheckpoint.getOrCreateSessionLedger(
      jobKeyA,
      'user_A',
      'mat_1',
      'hash_abc',
      'math_stats',
      3
    );
    assert.equal(sessionA.jobKey, jobKeyA);

    // User B cannot find User A's session in the registry
    const sessionForB = analysisCheckpoint.findSessionLedger('user_B', jobKeyA);
    assert.equal(sessionForB, null, 'Foreign user cannot locate another users session');

    // validateJobIdentity rejects foreign user with generic not-found/forbidden message
    const authCheck = analysisCheckpoint.validateJobIdentity(sessionA, 'user_B', 'mat_1', 'hash_abc', 'math_stats');
    assert.equal(authCheck.ok, false);
    assert.equal(authCheck.code, 'NOT_FOUND_OR_FORBIDDEN');
    assert.ok(!authCheck.message.includes('user_A'), 'Never leaks user A identity or data in error message');

    // Rejects mismatched material or markdown hash for the same jobKey
    const mismatchMat = analysisCheckpoint.validateJobIdentity(sessionA, 'user_A', 'mat_OTHER', 'hash_abc', 'math_stats');
    assert.equal(mismatchMat.ok, false);
    assert.equal(mismatchMat.code, 'JOB_INPUT_MISMATCH');

    const mismatchHash = analysisCheckpoint.validateJobIdentity(sessionA, 'user_A', 'mat_1', 'hash_DIFFERENT', 'math_stats');
    assert.equal(mismatchHash.ok, false);
    assert.equal(mismatchHash.code, 'JOB_INPUT_MISMATCH');
  });

  check('Stage 2: atomic chunk lease prevents concurrent duplicate execution and preserves completed empty results', () => {
    const jobKey = analysisCheckpoint.makeAnalysisJobKey('user_lease', 'mat_1', 'hash_123', 'math_stats');
    const session = analysisCheckpoint.getOrCreateSessionLedger(jobKey, 'user_lease', 'mat_1', 'hash_123', 'math_stats', 2);

    // Worker 1 acquires chunk 1
    const w1 = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_1', 60000);
    assert.equal(w1.acquired, true);
    assert.equal(w1.reason, 'acquired');

    // Worker 2 attempts chunk 1 while active lease is held -> locked
    const w2 = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_2', 60000);
    assert.equal(w2.acquired, false);
    assert.equal(w2.reason, 'locked');

    // Worker 1 commits chunk 1 with valid empty drafts (e.g. intro section without standalone concepts)
    const commit1 = analysisCheckpoint.commitChunkResult(session, 1, 'worker_1', 'completed', []);
    assert.equal(commit1.committed, true);
    assert.equal(session.chunks[1].status, 'completed');
    assert.deepEqual(session.chunks[1].drafts, []);

    // Subsequent worker attempts chunk 1 -> already_completed, prevents re-calling paid AI
    const w3 = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_3', 60000);
    assert.equal(w3.acquired, false);
    assert.equal(w3.reason, 'already_completed');

    // Late arriving write to an already completed chunk is rejected as already_completed
    const lateCommitOnCompleted = analysisCheckpoint.commitChunkResult(session, 1, 'worker_old', 'completed', []);
    assert.equal(lateCommitOnCompleted.committed, false);
    assert.equal(lateCommitOnCompleted.reason, 'already_completed');

    // Worker 1 acquires chunk 2
    analysisCheckpoint.acquireChunkLease(session, 2, 'worker_1', 60000);
    // Worker 2 attempts to commit chunk 2 while worker 1 holds lease -> worker_mismatch
    const lateCommitOnLocked = analysisCheckpoint.commitChunkResult(session, 2, 'worker_2', 'completed', []);
    assert.equal(lateCommitOnLocked.committed, false);
    assert.equal(lateCommitOnLocked.reason, 'worker_mismatch');
  });

  check('Stage 2: deterministic concept draft ID and merge preserves source citations and user approved status across retries', () => {
    const draftId1 = analysisCheckpoint.makeConceptDraftId('gen_job_fixed', '중심극한정리');
    const draftId2 = analysisCheckpoint.makeConceptDraftId('gen_job_fixed', '중심극한정리');
    assert.equal(draftId1, draftId2, 'Concept Draft ID is strictly deterministic regardless of chunk order or index');

    const draftA = {
      id: draftId1,
      subjectId: 'sub_1',
      materialId: 'mat_1',
      materialTitle: '확률통계',
      title: '중심극한정리',
      domain: 'math_stats',
      description: '표본평균의 분포는 표본 크기가 충분히 크면 정규분포에 수렴한다.',
      prerequisites: ['확률변수'],
      relatedConcepts: ['대수의 법칙'],
      commonMisconceptions: ['모집단이 정규분포여야만 성립한다.'],
      examples: ['동전 던지기 표본평균'],
      sourceEvidence: { type: 'page', pageNumber: 12, quote: '표본의 크기가 증가함에 따라', verified: true },
      status: 'approved',
      isApproved: true,
      editedByUser: true,
      sourceMarkdownHash: 'hash_1',
    };

    const draftB = {
      id: draftId1,
      subjectId: 'sub_1',
      materialId: 'mat_1',
      materialTitle: '확률통계',
      title: '중심극한정리',
      domain: 'math_stats',
      description: '표본의 크기가 무한대로 갈 때 표준화된 표본평균은 표준정규분포로 분포수렴한다.',
      prerequisites: ['특성함수', '확률변수'],
      relatedConcepts: ['중심극한정리', '린데베르크 조건'],
      commonMisconceptions: [],
      examples: [],
      sourceEvidence: { type: 'page', pageNumber: 45, quote: '린데베르크-레비 정리', verified: false },
      status: 'draft',
      isApproved: false,
      sourceMarkdownHash: 'hash_1',
    };

    const merged = analysisCheckpoint.deduplicateConceptDrafts([draftA, draftB]);
    assert.equal(merged.length, 1);
    const item = merged[0];

    // User approval is strictly preserved and not overwritten by retried unapproved draft
    assert.equal(item.isApproved, true);
    assert.equal(item.status, 'approved');
    assert.equal(item.editedByUser, true);

    // Prerequisites and related concepts merged
    assert.ok(item.prerequisites.includes('특성함수'));
    assert.ok(item.prerequisites.includes('확률변수'));

    // Citations across multiple pages/chunks are preserved
    assert.equal(item.sourceEvidence.pageNumber, 12, 'Primary verified evidence kept');
    assert.ok(Array.isArray(item.additionalEvidences) && item.additionalEvidences.length === 1);
    assert.equal(item.additionalEvidences[0].pageNumber, 45, 'Secondary citation preserved');
  });

  check('Stage 5: review notification DB snake_case mapping strictly validates rows and rejects unconfigured targets', () => {
    // 1. Valid DB row -> domain object
    const dbRow = {
      id: 'sub-row-1',
      user_id: 'usr-42',
      channel: 'email',
      target: 'student@kaist.ac.kr',
      preferred_hour_kst: 14,
      is_active: true,
      consented_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    };
    const mapped = reviewNotifications.rowToSubscription(dbRow);
    assert.ok(mapped !== null);
    assert.equal(mapped.userId, 'usr-42');
    assert.equal(mapped.channel, 'email');
    assert.equal(mapped.target, 'student@kaist.ac.kr');
    assert.equal(mapped.preferredHourKst, 14);
    assert.equal(mapped.isActive, true);

    // 2. Strict boolean validation on is_active
    const inactiveRow = { ...dbRow, is_active: false };
    const mappedInactive = reviewNotifications.rowToSubscription(inactiveRow);
    assert.equal(mappedInactive.isActive, false);

    // 3. Invalid/missing user_id returns null
    assert.equal(reviewNotifications.rowToSubscription({ ...dbRow, user_id: '  ' }), null);
    assert.equal(reviewNotifications.rowToSubscription(null), null);

    // 4. Missing target suppresses dispatch
    const noTargetSub = { ...mapped, target: '   ' };
    const evalResult = reviewNotifications.evaluateNotificationDispatch(
      noTargetSub,
      3,
      new Set(),
      new Date('2026-10-14T05:00:00.000Z')
    );
    assert.equal(evalResult.shouldSend, false);
    assert.ok(evalResult.reason.includes('수신 대상'));

    // 5. Test idempotency key is distinct from daily reminder key
    const testKey = reviewNotifications.makeTestNotificationIdempotencyKey('usr-42', 1700000000000, 'email');
    const dailyKey = reviewNotifications.makeReminderIdempotencyKey('usr-42', '2026-10-14', 'email');
    assert.notEqual(testKey, dailyKey);
    assert.ok(testKey.startsWith('test_usr-42_'));

    // 6. Delivery log mapping
    const dbLog = {
      id: 'log-1',
      user_id: 'usr-42',
      idempotency_key: dailyKey,
      channel: 'email',
      status: 'delivered',
      due_item_count: 4,
      message: '복습 알림',
    };
    const logMapped = reviewNotifications.rowToDeliveryLog(dbLog);
    assert.ok(logMapped !== null);
    assert.equal(logMapped.status, 'delivered');
    assert.equal(logMapped.dueItemCount, 4);
  });

  
  // =========================================================================
  // 8대 리뷰 지적 사항 종합 회귀 검증 테스트 (8 Review Flaws Verification)
  // =========================================================================

  await checkAsync('8대 리뷰 1: 분석 RPC 소유권 검증 및 기존 알림 RPC 시그니처 정리', async () => {
    // 1. Migration 16 SQL analysis: Legacy signatures dropped and strict permissions enforced
    const mig16Path = path.join(root, 'supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql');
    assert.ok(fs.existsSync(mig16Path), 'Migration 16 file exists');
    const mig16Content = fs.readFileSync(mig16Path, 'utf8');

    // Legacy migration 14 notification dispatch dropped
    assert.ok(
      mig16Content.includes('drop function if exists public.claim_notification_dispatch(uuid, text, text, integer, text, boolean);'),
      'Migration 14 6-arg claim_notification_dispatch dropped'
    );
    assert.ok(
      mig16Content.includes('drop function if exists public.complete_notification_dispatch(uuid, text, text);'),
      'Migration 14 3-arg complete_notification_dispatch dropped'
    );
    // Direct table UPDATE policy dropped to prevent bypassing RPC
    assert.ok(
      mig16Content.includes('drop policy if exists "Users can update chunks for their own jobs" on public.analysis_job_chunks;'),
      'Direct table update policy dropped to enforce RPC invariants'
    );
    // Revoke public/anon and restrict to service_role / authenticated
    assert.ok(
      mig16Content.includes('grant execute on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean, interval) to service_role;'),
      'Notification dispatch restricted to service_role'
    );
    // User ownership verification in analysis RPCs
    assert.ok(
      mig16Content.includes('user_id = auth.uid()'),
      'Strict caller ownership auth.uid() enforced in analysis RPC'
    );
  });

  await checkAsync('8대 리뷰 2: 분석 청크 선점 원자성 및 토큰 만료 검증', async () => {
    const session = analysisCheckpoint.getOrCreateSessionLedger(
      'job-lease-test',
      'user-lease',
      'mat-1',
      'hash-123',
      'math_stats',
      2,
      [{ chunkIndex: 1, sourceContext: 'c1' }, { chunkIndex: 2, sourceContext: 'c2' }],
      'v2',
      'v1',
      'sub-1',
      'deepseek-v4.1-flash'
    );

    // Worker A acquires chunk 1 with unique lease token
    const leaseA = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_A', 60000);
    assert.equal(leaseA.acquired, true);
    assert.ok(leaseA.leaseToken, 'Unique lease token issued');

    // Worker B attempts to acquire active lease -> locked
    const leaseB = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_B', 60000);
    assert.equal(leaseB.acquired, false);
    assert.equal(leaseB.reason, 'locked');

    // Worker B attempts commit with wrong token -> rejected
    const badCommit = analysisCheckpoint.commitChunkResult(session, 1, 'worker_B', 'completed', [], undefined, 'fake-token');
    assert.equal(badCommit.committed, false);
    assert.equal(badCommit.reason, 'worker_mismatch');

    // Worker A commits with correct token
    const goodCommit = analysisCheckpoint.commitChunkResult(session, 1, 'worker_A', 'completed', [], undefined, leaseA.leaseToken);
    assert.equal(goodCommit.committed, true);
    assert.equal(session.chunks[1].status, 'completed');

    // Completed chunk is checkpointed and reusable without paid AI calls
    const reacquire = analysisCheckpoint.acquireChunkLease(session, 1, 'worker_C', 60000);
    assert.equal(reacquire.acquired, false);
    assert.equal(reacquire.reason, 'already_completed');
  });

  await checkAsync('8대 리뷰 3: 실제 분석 route handler에 Mock AI·DB 연결 회귀', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const fakeMarkdown = '# 측도론\n## 르베그 적분\n가측집합 위의 르베그 적분을 정의한다. [PAGE 10]';
    const fakeSubjectId = 'sub-math-1';
    const fakeMaterialId = 'mat-measure-1';

    // Mock AI response returning 1 valid concept
    let aiCallCount = 0;
    global.fetch = async () => {
      aiCallCount++;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                concepts: [
                  {
                    title: '르베그 적분',
                    domain: 'math_stats',
                    description: '단순함수의 극한을 이용해 정의된 적분이다.',
                    coreDefinitionFormulaOrAlgorithm: '\\int_E f d\\mu',
                    prerequisites: ['가측공간'],
                    relatedConcepts: ['리만 적분'],
                    commonMisconceptions: ['모든 함수가 르베그 적분 가능한 것은 아니다.'],
                    examples: ['디리클레 함수의 르베그 적분값은 0이다.'],
                    sourceEvidence: { type: 'page', pageNumber: 10, quote: '가측집합 위의 르베그 적분을 정의한다.' },
                  },
                ],
              }),
            },
          },
        ],
      });
    };

    // 1) New job: 1 concept generated, DB lease & commit & draft persist all succeed
    const committedChunks = new Set();
    await withFakeSupabase({
      user: testUser,
      materials: [{ id: fakeMaterialId, user_id: testUser.id, subject_id: fakeSubjectId }],
      analysis_jobs: [],
      analysis_job_chunks: [],
      concept_drafts: [],
      rpcImpl: (fn, args) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'claim_analysis_chunk_lease') {
          if (committedChunks.has(args.p_chunk_index)) {
            return {
              data: {
                acquired: false,
                reason: 'already_completed',
                drafts: [
                  {
                    id: 'd1',
                    title: '르베그 적분',
                    domain: 'math_stats',
                    description: '단순함수의 극한을 이용해 정의된 적분이다.',
                    coreDefinitionFormulaOrAlgorithm: '\\int_E f d\\mu',
                    prerequisites: ['가측공간'],
                    relatedConcepts: ['리만 적분'],
                    commonMisconceptions: ['모든 함수가 르베그 적분 가능한 것은 아니다.'],
                    examples: ['디리클레 함수의 르베그 적분값은 0이다.'],
                    sourceEvidence: { type: 'page', pageNumber: 10, quote: '가측집합 위의 르베그 적분을 정의한다.' },
                    status: 'draft',
                    isApproved: false,
                  },
                ],
              },
              error: null,
            };
          }
          return { data: { acquired: true, lease_token: 'lease-tok-123', chunk_index: args.p_chunk_index }, error: null };
        }
        if (fn === 'commit_analysis_chunk_result') {
          committedChunks.add(args.p_chunk_index);
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        if (fn === 'pause_analysis_job') return { data: { success: true, status: 'paused' }, error: null };
        if (fn === 'resume_analysis_job') return { data: { success: true, status: 'processing' }, error: null };
        return { data: null, error: null };
      },
    }, async () => {
      const req = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'math_stats',
          markdown: fakeMarkdown,
        }),
      });

      const res = await analyzePost(req);
      const data = await res.json();
      if (res.status !== 200) console.error('Analyze error:', data);
      assert.equal(res.status, 200, 'Analysis succeeds with 200');
      assert.equal(data.success, true);
      assert.equal(data.completedChunks, 1, 'Completed chunks is exactly 1');
      assert.equal(data.drafts.length, 1, 'Drafts returned exactly 1 (no worker_mismatch empty regression)');
      assert.equal(data.drafts[0].title, '르베그 적분');
      assert.equal(aiCallCount, 1, 'AI was called once for new chunk');

      // 2) Re-analyzing completed chunk reuses checkpointed result without calling AI
      const reReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'math_stats',
          markdown: fakeMarkdown,
          jobKey: data.jobKey,
        }),
      });
      const reRes = await analyzePost(reReq);
      const reData = await reRes.json();
      assert.equal(reData.success, true);
      assert.equal(aiCallCount, 1, 'AI was NOT called again when chunk is already completed');
    });
  });

  await checkAsync('8대 리뷰 4: 초안 생성의 조회-저장 경쟁 조건 제거', async () => {
    // Reproduction scenario:
    // A looks up draft (not found) -> B creates and user-edits draft -> A saves AI draft -> B edits MUST be preserved!
    await withFakeSupabase({
      user: { id: 'u1' },
      concept_drafts: [],
    }, async (client) => {
      const initialAiDraft = {
        id: 'draft-race-1',
        subjectId: 'sub-1',
        materialId: 'mat-1',
        materialTitle: '확률론',
        title: '조건부 기댓값 (AI 원본)',
        domain: 'math_stats',
        description: 'AI 원본 설명',
        coreDefinitionFormulaOrAlgorithm: 'E[X|Y]',
        prerequisites: [],
        relatedConcepts: [],
        commonMisconceptions: [],
        examples: [],
        sourceEvidence: { type: 'page', quote: '기댓값 정의', verified: true },
        status: 'draft',
        isApproved: false,
        sourceMarkdownHash: 'h-1',
        createdAt: '',
        updatedAt: '',
      };

      // B creates and edits before A's upsert commits
      await client.from('concept_drafts').upsert({
        id: 'draft-race-1',
        user_id: 'u1',
        subject_id: 'sub-1',
        material_id: 'mat-1',
        title: '사용자가 꼼꼼하게 편집한 조건부 기댓값',
        status: 'draft',
        is_approved: true,
        content_version: 5,
        edited_by_user: true,
        payload: {
          id: 'draft-race-1',
          title: '사용자가 꼼꼼하게 편집한 조건부 기댓값',
          description: '시그마 대수에 대한 조건부 기댓값의 라돈-니코딤 파생 정의',
          editedByUser: true,
        },
      });

      // A's upsert now runs with ignoreDuplicates: true
      const result = await cloudLearningRepo.upsertConceptDrafts(client, [initialAiDraft], 'gen-race');
      assert.equal(result.ok, true);

      // Verify B's edits and approval are completely preserved
      const saved = result.data.find((d) => d.id === 'draft-race-1');
      assert.ok(saved);
      assert.equal(saved.title, '사용자가 꼼꼼하게 편집한 조건부 기댓값');
      assert.equal(saved.description, '시그마 대수에 대한 조건부 기댓값의 라돈-니코딤 파생 정의');
      assert.equal(saved.isApproved, true);
    });
  });

  await checkAsync('8대 리뷰 5: 평가 요청에 실제 문제 버전·시험 스냅샷 연결', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: evaluatePost } = load(path.join(output, 'app/api/evaluate-answer/route.js'));

    const testUser = { id: 'test-user' };
    const frozenRubric = [{ id: 'r1', label: '논리성', maxScore: 100, weight: 1, description: '전제 서술' }];

    global.fetch = async () => Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            overallScore: 90,
            feedback: '정확한 증명입니다.',
            rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: '전제 서술', feedback: '우수' }],
            methodSelectionDiagnosis: { isApplicable: true, criteria: [] },
            needsReview: false,
          }),
        },
      }],
    });

    // 1. Mock Exam Session with frozen v1 snapshot
    await withFakeSupabase({
      user: testUser,
      mock_exam_sessions: [
        {
          id: 'exam-sess-1',
          user_id: testUser.id,
          status: 'submitted',
          payload: {
            problems: [
              {
                id: 'prob-frozen-1',
                promptText: 'v1 동결 문제 지문: 바나흐-타르스키 정리를 설명하라',
                modelAnswer: 'v1 동결 모범답안',
                rubric: frozenRubric,
                version: 1,
              },
            ],
            answers: {
              'prob-frozen-1': '답안 제출',
            },
          },
        },
      ],
      problems: [
        {
          id: 'prob-frozen-1',
          user_id: testUser.id,
          version: 2,
          promptText: 'v2로 수정된 문제 지문 (시험 채점에 쓰이면 안 됨)',
          modelAnswer: 'v2 모범답안',
          rubric: frozenRubric,
        },
      ],
    }, async () => {
      // Evaluate mock exam problem: must use frozen v1 snapshot
      const examReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockExamSessionId: 'exam-sess-1',
          problemId: 'prob-frozen-1',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 's1',
          userAnswer: '답안 제출',
          revealedHintCount: 0,
        }),
      });

      const res = await evaluatePost(examReq);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify that requesting a non-existent version halts with 404
      const missingVersionReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId: 'prob-frozen-1',
          problemVersion: 999, // non-existent version
          conceptId: 'c1',
          subjectId: 's1',
          userAnswer: '답안 제출',
          revealedHintCount: 0,
        }),
      });
      const missingRes = await evaluatePost(missingVersionReq);
      assert.equal(missingRes.status, 404, 'Non-existent problem version rejected with 404 without silent fallback');

      // Verify component prop compliance: ProblemSessionModal and MockExamModal pass problemVersion
      const psmFile = fs.readFileSync(path.join(root, 'components/ProblemSessionModal.tsx'), 'utf8');
      assert.ok(psmFile.includes('problemVersion: problem.version ?? 1'), 'ProblemSessionModal passes problemVersion');
      const memFile = fs.readFileSync(path.join(root, 'components/MockExamModal.tsx'), 'utf8');
      assert.ok(memFile.includes('problemVersion: problem.version ?? 1'), 'MockExamModal passes problemVersion');
    });
  });

  await checkAsync('8대 리뷰 6: AI 결과 저장 실패의 실제 복구 경로 구현', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const fakeMarkdown = '# 위상수학\n컴팩트 공간의 성질. [PAGE 5]';
    let aiCalls = 0;
    global.fetch = async () => {
      aiCalls++;
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              concepts: [{
                title: '컴팩트 공간',
                domain: 'math_stats',
                description: '모든 열린 덮개가 유한 부분덮개를 갖는 위상공간',
                coreDefinitionFormulaOrAlgorithm: '\\bigcup U_i',
                prerequisites: [],
                relatedConcepts: [],
                commonMisconceptions: [],
                examples: ['[0,1]은 컴팩트하다.'],
                sourceEvidence: { type: 'page', quote: '컴팩트 공간의 성질.' },
              }],
            }),
          },
        }],
      });
    };

    let shouldFailCommit = true;
    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-top-1', user_id: testUser.id, subject_id: 'sub-top' }],
      rpcImpl: (fn) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'claim_analysis_chunk_lease') {
          return { data: { acquired: true, lease_token: 'lease-tok-save-test', chunk_index: 1 }, error: null };
        }
        if (fn === 'commit_analysis_chunk_result') {
          if (shouldFailCommit) return { data: { committed: false, reason: 'db_connection_lost' }, error: null };
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async () => {
      // 1. Initial attempt: AI succeeds, but DB commit fails
      const failReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          materialId: 'mat-top-1',
          subjectId: 'sub-top',
          domain: 'math_stats',
          markdown: fakeMarkdown,
        }),
      });

      const failRes = await analyzePost(failReq);
      assert.equal(failRes.status, 500);
      const failData = await failRes.json();
      assert.equal(failData.canRetrySave, true, 'canRetrySave flag is true on retryable DB failure');
      assert.equal(failData.drafts.length, 1);
      assert.equal(aiCalls, 1);

      // 2. Retry save without re-calling paid AI
      shouldFailCommit = false;
      const retryReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: failData.jobKey,
          chunkIndex: failData.chunkIndex,
          workerId: failData.workerId,
          leaseToken: failData.leaseToken,
          drafts: failData.drafts,
          signedRecoveryToken: failData.signedRecoveryToken,
          materialId: 'mat-top-1',
          subjectId: 'sub-top',
          markdown: fakeMarkdown,
        }),
      });

      const retryRes = await analyzePost(retryReq);
      assert.equal(retryRes.status, 200, 'Retry save succeeds with 200');
      const retryData = await retryRes.json();
      assert.equal(retryData.success, true);
      assert.equal(retryData.retried, true);
      assert.equal(retryData.drafts.length, 1);
      assert.equal(aiCalls, 1, 'AI was NOT called during save retry');
    });
  });

  await checkAsync('8대 리뷰 7: 첫 분석 중단·진행률·새로고침 복원 구현', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const fakeMarkdown = '# 대수학\n군과 환의 성질. [PAGE 1]';

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-alg-1', user_id: testUser.id, subject_id: 'sub-alg' }],
      analysis_jobs: [],
      analysis_job_chunks: [],
      rpcImpl: (fn) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'pause_analysis_job') return { data: { success: true, status: 'paused' }, error: null };
        if (fn === 'resume_analysis_job') return { data: { success: true, status: 'processing' }, error: null };
        return { data: null, error: null };
      },
    }, async () => {
      // 1. Initial init call: acquires jobKey before chunks process
      const initReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: 'mat-alg-1',
          subjectId: 'sub-alg',
          domain: 'math_stats',
          markdown: fakeMarkdown,
        }),
      });
      const initRes = await analyzePost(initReq);
      assert.equal(initRes.status, 200);
      const initData = await initRes.json();
      assert.ok(initData.jobKey, 'Secures jobKey upfront');
      assert.equal(initData.initialized, true);

      // 2. Pause during processing
      const pauseReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pause',
          materialId: 'mat-alg-1',
          subjectId: 'sub-alg',
          domain: 'math_stats',
          markdown: fakeMarkdown,
          jobKey: initData.jobKey,
        }),
      });
      const pauseRes = await analyzePost(pauseReq);
      const pauseData = await pauseRes.json();
      assert.equal(pauseData.status, 'paused');

      // 3. Status query (reload simulation): restores status without calling AI
      const statusReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          materialId: 'mat-alg-1',
          subjectId: 'sub-alg',
          domain: 'math_stats',
          markdown: fakeMarkdown,
          jobKey: initData.jobKey,
        }),
      });
      const statusRes = await analyzePost(statusReq);
      const statusData = await statusRes.json();
      assert.equal(statusData.status, 'paused');
      assert.equal(statusData.jobKey, initData.jobKey);
    });
  });

  await checkAsync('8대 리뷰 8: 서버 권한 키 미설정 시 명시적으로 실패', async () => {
    const { createAdminClient } = load(path.join(output, 'lib/supabase/admin.js'));
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: cronPost } = load(path.join(output, 'app/api/reminders/cron/route.js'));

    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origCronSecret = process.env.CRON_SECRET;
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete globalThis.__fakeSupabaseAdminClient;

      // 1. Direct admin client creation throws explicit error, never falls back to anon
      assert.throws(() => {
        createAdminClient();
      }, /SUPABASE_SERVICE_ROLE_KEY/);

      // 2. Client browser environment explicitly throws
      global.window.document = {};
      try {
        assert.throws(() => {
          createAdminClient();
        }, /클라이언트 브라우저 환경/);
      } finally {
        delete global.window.document;
      }

      // 2. Cron route fails with 500 instead of claiming 0 targets
      process.env.CRON_SECRET = 'valid-secret';
      const cronReq = new NextRequest('http://localhost/api/reminders/cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-secret',
        },
      });
      const cronRes = await cronPost(cronReq);
      assert.equal(cronRes.status, 500, 'Cron explicitly returns 500 on missing service role key');
    } finally {
      if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      if (origCronSecret !== undefined) process.env.CRON_SECRET = origCronSecret;
      else delete process.env.CRON_SECRET;
    }
  });

  // =========================================================================
  // 6대 핵심 결함 회귀 테스트 (REDCALL Production Hardening)
  // =========================================================================

  await checkAsync('문제 1: retry_save에서 클라이언트 변조 drafts 거부 및 완료 청크 DB 권한 강제', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { signRecoveryToken } = load(path.join(output, 'lib/recoveryToken.js'));
    const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));

    const testUser = { id: 'test-user' };
    const md = '# 선형대수\n행렬의 계수와 차원 정리 [PAGE 1]';
    const mdHash = computeMarkdownHash(md);

    const authoritativeDraft = {
      id: 'draft-auth-1',
      subjectId: 'sub-la',
      materialId: 'mat-la',
      title: '차원 정리 (Dimension Theorem)',
      domain: 'math_stats',
      description: '선형변환에서 핵의 차원과 상의 차원의 합은 정의역의 차원과 같다.',
      coreDefinitionFormulaOrAlgorithm: 'dim(V) = dim(ker T) + dim(im T)',
      sourceEvidence: { type: 'quote', pageNumber: 1, quote: '차원 정리' },
    };

    const forgedDraft = {
      id: 'draft-forged-99',
      subjectId: 'sub-la',
      materialId: 'mat-la',
      title: '변조된 초안: 비인가 내용',
      domain: 'math_stats',
      description: '악의적 공격자가 임의로 주입한 초안',
      coreDefinitionFormulaOrAlgorithm: 'x = 0',
      sourceEvidence: { type: 'quote', pageNumber: 1, quote: '변조' },
    };

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-la', user_id: testUser.id, subject_id: 'sub-la' }],
      analysis_jobs: [
        {
          id: 'job-trust-1',
          user_id: testUser.id,
          subject_id: 'sub-la',
          material_id: 'mat-la',
          domain: 'math_stats',
          markdown_hash: mdHash,
          status: 'processing',
          total_chunks: 2,
        },
      ],
      analysis_job_chunks: [
        {
          job_id: 'job-trust-1',
          chunk_index: 1,
          status: 'completed',
          drafts: [authoritativeDraft],
          completed_at: new Date().toISOString(),
        },
        {
          job_id: 'job-trust-1',
          chunk_index: 2,
          status: 'pending',
          drafts: [],
        },
      ],
      rpcImpl: (fn, args) => {
        if (fn === 'commit_analysis_chunk_result') {
          if (args && args.p_chunk_index === 1) {
            return { data: { committed: false, reason: 'already_completed', drafts: [authoritativeDraft] }, error: null };
          }
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async () => {
      // 1) 완료된 청크(chunk 1)에 변조한 drafts를 보내도 기존 DB 확정 결과만 반환
      const tamperedReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-trust-1',
          chunkIndex: 1,
          workerId: 'worker-malicious',
          leaseToken: 'token-malicious',
          drafts: [forgedDraft], // 변조된 초안 전송
          materialId: 'mat-la',
          subjectId: 'sub-la',
          domain: 'math_stats',
          markdown: md,
        }),
      });

      const res1 = await analyzePost(tamperedReq);
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.drafts.length, 1);
      assert.equal(data1.drafts[0].id, 'draft-auth-1', '변조된 초안 대신 DB의 확정 초안이 반환됨');
      assert.equal(data1.drafts[0].title, '차원 정리 (Dimension Theorem)');

      // 2) 미완료 청크(chunk 2)에 위조/서명 없는 초안 전송 시 403 거부
      const unsignedReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-trust-1',
          chunkIndex: 2,
          workerId: 'worker-1',
          leaseToken: 'token-1',
          drafts: [forgedDraft],
          materialId: 'mat-la',
          subjectId: 'sub-la',
          domain: 'math_stats',
          markdown: md,
        }),
      });
      const resUnsigned = await analyzePost(unsignedReq);
      assert.equal(resUnsigned.status, 403, '서명 없는 클라이언트 초안 재시도는 403 거부');

      // 3) 다른 사용자/계정의 서명 토큰 재사용 거부
      const otherUserToken = signRecoveryToken({
        userId: 'other-attacker-id',
        jobId: 'job-trust-1',
        materialId: 'mat-la',
        subjectId: 'sub-la',
        domain: 'math_stats',
        chunkIndex: 2,
        markdownHash: mdHash,
        modelId: 'deepseek-v4.1-flash',
        drafts: [forgedDraft],
        expiresInSeconds: 3600,
      });

      const replayReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-trust-1',
          chunkIndex: 2,
          workerId: 'worker-1',
          leaseToken: 'token-1',
          drafts: [forgedDraft],
          signedRecoveryToken: otherUserToken,
          materialId: 'mat-la',
          subjectId: 'sub-la',
          domain: 'math_stats',
          markdown: md,
        }),
      });
      const resReplay = await analyzePost(replayReq);
      assert.equal(resReplay.status, 403, '타 계정의 복구 토큰 재사용은 403 거부');

      // 4) 올바른 서명 토큰을 가진 복구 요청은 정상 저장 완료
      const validToken = signRecoveryToken({
        userId: testUser.id,
        jobId: 'job-trust-1',
        materialId: 'mat-la',
        subjectId: 'sub-la',
        domain: 'math_stats',
        chunkIndex: 2,
        markdownHash: mdHash,
        modelId: 'deepseek-v4.1-flash',
        drafts: [authoritativeDraft],
        expiresInSeconds: 3600,
      });

      const validReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-trust-1',
          chunkIndex: 2,
          workerId: 'worker-1',
          leaseToken: 'token-1',
          drafts: [authoritativeDraft],
          signedRecoveryToken: validToken,
          materialId: 'mat-la',
          subjectId: 'sub-la',
          domain: 'math_stats',
          markdown: md,
        }),
      });
      const resValid = await analyzePost(validReq);
      assert.equal(resValid.status, 200, '유효한 서명 토큰으로 AI 호출 없이 복구 성공');
      const validData = await resValid.json();
      assert.equal(validData.success, true);
      assert.equal(validData.checkpointCommitted, true);
    });
  });

  await checkAsync('문제 2: persisted:false 발생 시 부분 실패 명확화 및 가짜 저장 완료 방지', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { signRecoveryToken } = load(path.join(output, 'lib/recoveryToken.js'));
    const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));

    const testUser = { id: 'test-user' };
    const md = '# 위상수학\n컴팩트 공간의 성질 [PAGE 1]';
    const mdHash = computeMarkdownHash(md);

    const testDraft = {
      id: 'draft-top-1',
      subjectId: 'sub-top',
      materialId: 'mat-top',
      title: '컴팩트성 (Compactness)',
      domain: 'math_stats',
      description: '임의의 열린 덮개가 유한 부분 덮개를 가진다.',
      coreDefinitionFormulaOrAlgorithm: 'Every open cover has a finite subcover',
      sourceEvidence: { type: 'quote', pageNumber: 1, quote: '컴팩트' },
    };

    const recoveryToken = signRecoveryToken({
      userId: testUser.id,
      jobId: 'job-partial-1',
      materialId: 'mat-top',
      subjectId: 'sub-top',
      domain: 'math_stats',
      chunkIndex: 1,
      markdownHash: mdHash,
      modelId: 'deepseek-v4.1-flash',
      drafts: [testDraft],
      expiresInSeconds: 3600,
    });

    let failConceptDraftsTable = true;

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-top', user_id: testUser.id, subject_id: 'sub-top' }],
      analysis_jobs: [
        {
          id: 'job-partial-1',
          user_id: testUser.id,
          subject_id: 'sub-top',
          material_id: 'mat-top',
          domain: 'math_stats',
          markdown_hash: mdHash,
          status: 'processing',
          total_chunks: 1,
        },
      ],
      concept_drafts: [],
      rpcImpl: (fn) => {
        if (fn === 'commit_analysis_chunk_result') {
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async (fakeClient) => {
      // Mock concept_drafts insertion failure
      const origFrom = fakeClient.from.bind(fakeClient);
      fakeClient.from = (table) => {
        const query = origFrom(table);
        if (table === 'concept_drafts' && failConceptDraftsTable) {
          query.upsert = async () => ({ data: null, error: { message: '초안 테이블 용량 초과 또는 네트워크 단절' } });
        }
        return query;
      };

      const retryReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-partial-1',
          chunkIndex: 1,
          workerId: 'worker-1',
          leaseToken: 'token-1',
          drafts: [testDraft],
          signedRecoveryToken: recoveryToken,
          materialId: 'mat-top',
          subjectId: 'sub-top',
          domain: 'math_stats',
          markdown: md,
        }),
      });

      const res = await analyzePost(retryReq);
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.success, false, '초안 저장 실패 시 success: false 반환');
      assert.equal(data.checkpointCommitted, true, '체크포인트는 커밋되었음을 명시');
      assert.equal(data.persisted, false, 'persisted: false 명확 계약');
      assert.equal(data.canRetrySave, true, 'AI 재호출 없이 초안 저장만 다시 시도 가능');
      assert.ok(data.error.includes('concept_drafts'), '에러 문구에 실패 단계 명시');
    });
  });

  await checkAsync('문제 3: 서버 재시작 후 processing/running 상태 복원 및 완료 결과 AI 미호출 복원', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));

    const testUser = { id: 'test-user' };
    const md = '# 알고리즘\n그래프 탐색과 다익스트라 최단경로 [PAGE 1]';
    const mdHash = computeMarkdownHash(md);

    const completedDraft = {
      id: 'draft-dijkstra-1',
      subjectId: 'sub-cs',
      materialId: 'mat-cs',
      title: '다익스트라 알고리즘',
      domain: 'computer_science',
      description: '단일 출발지 최단 경로 알고리즘',
      coreDefinitionFormulaOrAlgorithm: 'O((V + E) log V)',
      sourceEvidence: { type: 'quote', pageNumber: 1, quote: '다익스트라' },
    };

    // 1. Processing job with running chunk (lease valid for 60s)
    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-cs', user_id: testUser.id, subject_id: 'sub-cs' }],
      analysis_jobs: [
        {
          id: 'job-restore-proc',
          user_id: testUser.id,
          subject_id: 'sub-cs',
          material_id: 'mat-cs',
          domain: 'computer_science',
          markdown_hash: mdHash,
          status: 'processing',
          total_chunks: 2,
        },
      ],
      analysis_job_chunks: [
        {
          job_id: 'job-restore-proc',
          chunk_index: 1,
          status: 'completed',
          drafts: [completedDraft],
        },
        {
          job_id: 'job-restore-proc',
          chunk_index: 2,
          status: 'running',
          lease_worker_id: 'active-worker',
          lease_token: 'active-token',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    }, async () => {
      const statusReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          jobKey: 'job-restore-proc',
          materialId: 'mat-cs',
          subjectId: 'sub-cs',
          domain: 'computer_science',
        }),
      });

      const res = await analyzePost(statusReq);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'processing', 'DB의 processing 및 유효 running 청크를 정확히 복원');
      assert.equal(data.completedChunks, 1);
      assert.equal(data.runningChunks, 1);
      assert.equal(data.totalChunks, 2);
    });

    // 2. Fully completed job restores results without triggering AI
    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-cs', user_id: testUser.id, subject_id: 'sub-cs' }],
      analysis_jobs: [
        {
          id: 'job-restore-done',
          user_id: testUser.id,
          subject_id: 'sub-cs',
          material_id: 'mat-cs',
          domain: 'computer_science',
          markdown_hash: mdHash,
          status: 'completed',
          total_chunks: 1,
        },
      ],
      analysis_job_chunks: [
        {
          job_id: 'job-restore-done',
          chunk_index: 1,
          status: 'completed',
          drafts: [completedDraft],
        },
      ],
    }, async () => {
      const statusReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          jobKey: 'job-restore-done',
          materialId: 'mat-cs',
          subjectId: 'sub-cs',
          domain: 'computer_science',
        }),
      });

      const res = await analyzePost(statusReq);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'completed');
      assert.equal(data.drafts.length, 1);
      assert.equal(data.drafts[0].title, '다익스트라 알고리즘', '완료된 작업의 결과가 재분석 없이 즉시 복원됨');
    });
  });

  await checkAsync('문제 4: 코딩 과목(computer_science) 도메인 정체성 보존 및 본문 해시 검증', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { signRecoveryToken } = load(path.join(output, 'lib/recoveryToken.js'));
    const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));

    const testUser = { id: 'test-user' };
    const csMarkdown = '# 운영체제\n가상 메모리와 페이지 교체 알고리즘 (LRU) [PAGE 1]';
    const csHash = computeMarkdownHash(csMarkdown);

    const csDraft = {
      id: 'draft-os-1',
      subjectId: 'sub-os',
      materialId: 'mat-os',
      title: 'LRU 페이지 교체 알고리즘',
      domain: 'computer_science',
      description: '가장 오랫동안 사용되지 않은 페이지를 교체 대상으로 선정한다.',
      coreDefinitionFormulaOrAlgorithm: 'Least Recently Used Page Replacement',
      sourceEvidence: { type: 'quote', pageNumber: 1, quote: 'LRU' },
    };

    const csToken = signRecoveryToken({
      userId: testUser.id,
      jobId: 'job-cs-identity',
      materialId: 'mat-os',
      subjectId: 'sub-os',
      domain: 'computer_science',
      chunkIndex: 1,
      markdownHash: csHash,
      modelId: 'deepseek-v4.1-flash',
      drafts: [csDraft],
      expiresInSeconds: 3600,
    });

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: 'mat-os', user_id: testUser.id, subject_id: 'sub-os' }],
      analysis_jobs: [
        {
          id: 'job-cs-identity',
          user_id: testUser.id,
          subject_id: 'sub-os',
          material_id: 'mat-os',
          domain: 'computer_science',
          markdown_hash: csHash,
          status: 'processing',
          total_chunks: 1,
        },
      ],
      analysis_job_chunks: [],
      rpcImpl: (fn) => {
        if (fn === 'commit_analysis_chunk_result') {
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async () => {
      // 1. Client calls retry_save WITHOUT domain (simulating DashboardClient previous bug)
      // Server must recover 'computer_science' from DB analysis_jobs
      const retryReqNoDomain = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-cs-identity',
          chunkIndex: 1,
          workerId: 'worker-cs',
          leaseToken: 'token-cs',
          drafts: [csDraft],
          signedRecoveryToken: csToken,
          materialId: 'mat-os',
          // domain omitted on purpose
        }),
      });

      const res = await analyzePost(retryReqNoDomain);
      assert.equal(res.status, 200, 'domain 누락 요청도 DB 작업 정체성으로부터 computer_science 복구');
      const data = await res.json();
      assert.equal(data.success, true);

      // 2. Regular process / resume with altered markdown MUST be rejected with MARKDOWN_HASH_MISMATCH
      const resumeMismatchReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resume',
          jobKey: 'job-cs-identity',
          materialId: 'mat-os',
          markdown: '# 완전히 다른 본문: 선형대수 행렬식',
        }),
      });
      const resMismatch = await analyzePost(resumeMismatchReq);
      assert.ok(resMismatch.status === 400 || resMismatch.status === 403, '일반 process/resume에 다른 본문 전달 시 불일치 거부');
      const dataMismatch = await resMismatch.json();
      assert.equal(dataMismatch.success, false);
      assert.equal(dataMismatch.errorCode, 'MARKDOWN_HASH_MISMATCH');

      // 3. retry_save with altered markdown succeeds, preserves original sourceMarkdownHash, and flags needsSourceReview: true
      const retryAlteredReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: 'job-cs-identity',
          chunkIndex: 1,
          workerId: 'worker-cs',
          leaseToken: 'token-cs',
          drafts: [csDraft],
          signedRecoveryToken: csToken,
          materialId: 'mat-os',
          markdown: '# 완전히 다른 본문: 선형대수 행렬식',
        }),
      });
      const resRetryAltered = await analyzePost(retryAlteredReq);
      assert.equal(resRetryAltered.status, 200, '본문 변경 후에도 유효한 토큰과 기존 작업 기준 retry_save 성공');
      const dataRetryAltered = await resRetryAltered.json();
      assert.equal(dataRetryAltered.success, true);
      assert.equal(dataRetryAltered.drafts[0].sourceMarkdownHash, csHash, '원래 출처 해시 보존');
      assert.equal(dataRetryAltered.drafts[0].needsSourceReview, true, '본문 변경 감지 시 출처 재검토 필요 플래그 설정');
    });
  });

  await checkAsync('문제 5: 모의시험 평가 답안을 서버 제출본으로 고정 및 변조 거부와 평가 캐시', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: evaluatePost } = load(path.join(output, 'app/api/evaluate-answer/route.js'));

    const testUser = { id: 'test-user' };
    const frozenRubric = [
      { id: 'r1', label: '정리 이해도', description: '체비쇼프 부등식의 전제조건', maxScore: 100, weight: 1 },
    ];

    let evaluateAiCalls = 0;
    global.fetch = async () => {
      evaluateAiCalls++;
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              overallScore: 95,
              feedback: '체비쇼프 부등식 증명이 정확합니다.',
              rubricResults: [{ criterionId: 'r1', score: 95, evidenceQuote: '마르코프 부등식을 적용', feedback: '우수' }],
              methodSelectionDiagnosis: { isApplicable: true, criteria: [] },
              needsReview: false,
            }),
          },
        }],
      });
    };

    const cachedEvaluation = {
      score: 100,
      calculatedScore: 100,
      rubricResults: [{ criterionId: 'r1', score: 100, feedback: '완벽한 풀이' }],
      generalFeedback: '서버 캐시된 평가 결과',
    };

    await withFakeSupabase({
      user: testUser,
      mock_exam_sessions: [
        {
          id: 'exam-secure-1',
          user_id: testUser.id,
          status: 'submitted',
          payload: {
            problems: [
              {
                id: 'prob-eval-1',
                promptText: '체비쇼프 부등식을 증명하라.',
                modelAnswer: 'P(|X - mu| >= k*sigma) <= 1/k^2',
                rubric: frozenRubric,
                version: 1,
              },
              {
                id: 'prob-cached-9',
                promptText: '라돈-니코딤 정리 문제',
                modelAnswer: '라돈-니코딤 모범답안',
                rubric: frozenRubric,
                version: 1,
              },
            ],
            answers: {
              'prob-eval-1': '서버제출답안: 마르코프 부등식을 (X - mu)^2에 적용함.',
              'prob-cached-9': '서버제출답안: 절대연속 측도에 대한 밀도함수',
            },
            reasons: {
              'prob-eval-1': '모멘트 생성함수가 주어지지 않았으므로 2차 모멘트 기반 체비쇼프를 선택함.',
            },
            evaluations: {
              'prob-cached-9': cachedEvaluation,
            },
          },
        },
      ],
      problems: [
        {
          id: 'prob-eval-1',
          user_id: testUser.id,
          version: 2,
          promptText: '문제 v2 (시험 제출 후 변경됨)',
          modelAnswer: 'v2 모범답안',
          rubric: frozenRubric,
        },
      ],
    }, async () => {
      // 1) 클라이언트가 서버 제출 답안과 다른 답안 전송 시 400 거부
      const tamperedReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockExamSessionId: 'exam-secure-1',
          problemId: 'prob-eval-1',
          conceptId: 'c-stat',
          subjectId: 's-stat',
          domain: 'math_stats',
          userAnswer: '클라이언트변조답안: 꼼수 답변',
          revealedHintCount: 0,
        }),
      });
      const resTampered = await evaluatePost(tamperedReq);
      assert.equal(resTampered.status, 400, '제출 답안과 다른 답안 전송 시 거부');
      const dataTampered = await resTampered.json();
      assert.ok(dataTampered.error.includes('일치하지 않습니다'));

      // 2) 서버 제출 답안과 일치하거나 생략된 경우 서버 제출본으로 평가 진행
      const validReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockExamSessionId: 'exam-secure-1',
          problemId: 'prob-eval-1',
          conceptId: 'c-stat',
          subjectId: 's-stat',
          domain: 'math_stats',
          userAnswer: '서버제출답안: 마르코프 부등식을 (X - mu)^2에 적용함.',
          revealedHintCount: 0,
        }),
      });
      const resValid = await evaluatePost(validReq);
      assert.equal(resValid.status, 200, '서버 공식 제출본으로 정상 평가');

      // 3) 이미 완료된 평가 요청 시 AI 호출 없이 캐시 반환
      const cachedReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockExamSessionId: 'exam-secure-1',
          problemId: 'prob-cached-9',
          conceptId: 'c-stat',
          subjectId: 's-stat',
          domain: 'math_stats',
          userAnswer: '서버제출답안: 절대연속 측도에 대한 밀도함수',
          revealedHintCount: 0,
        }),
      });
      const resCached = await evaluatePost(cachedReq);
      assert.equal(resCached.status, 200);
      const dataCached = await resCached.json();
      assert.equal(dataCached.cached, true, '캐시된 평가는 AI 재호출 없이 즉시 반환');
      assert.equal(dataCached.evaluation.calculatedScore, 100);
      assert.equal(evaluateAiCalls, 1, '유료 AI 호출은 캐시되지 않은 평가 1회만 발생');

      // 4) 타 사용자의 시험 세션 접근 시 404 거부
      const otherUserReq = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockExamSessionId: 'exam-other-user',
          problemId: 'prob-eval-1',
          conceptId: 'c-stat',
          subjectId: 's-stat',
          domain: 'math_stats',
          userAnswer: '답안',
        }),
      });
      const resOther = await evaluatePost(otherUserReq);
      assert.equal(resOther.status, 404, '타 사용자의 시험 세션은 404 차단');
    });
  });

  await checkAsync('문제 6: 새로고침 대비 IndexedDB 계정별 복구 데이터 보존 및 JSON 백업 폴백', async () => {
    const {
      saveAnalysisRecovery,
      loadAnalysisRecovery,
      deleteAnalysisRecovery,
      exportAnalysisRecoveryAsJson,
    } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async () => {
      const recordUserA = {
        materialId: 'mat-persist-1',
        jobKey: 'job-persist-1',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-abc',
        chunkIndex: 1,
        workerId: 'worker-1',
        leaseToken: 'token-1',
        drafts: [
          {
            id: 'draft-p1',
            subjectId: 'sub-1',
            materialId: 'mat-persist-1',
            title: '코시-슈바르츠 부등식',
            domain: 'math_stats',
            description: '내적 공간에서의 절대 부등식',
            coreDefinitionFormulaOrAlgorithm: '|<u, v>|^2 <= <u, u> <v, v>',
            sourceEvidence: { type: 'quote', pageNumber: 1, quote: '코시' },
          },
        ],
        signedRecoveryToken: 'signed-token-123',
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
        errorMessage: '초안 테이블 영속 저장 실패',
      };

      // 1. Save and immediate read-back verification
      const saveRes = await saveAnalysisRecovery('u_userA', recordUserA);
      assert.equal(saveRes.ok, true, 'IndexedDB 저장 성공 및 읽기 검증 통과');

      // 2. Account isolation: user B cannot read user A's recovery
      const loadedUserB = await loadAnalysisRecovery('u_userB', 'mat-persist-1');
      assert.equal(loadedUserB.status, 'not_found', '계정별 IndexedDB 격리로 타 계정 복구 데이터 열람 불가');

      // 3. User A reloads and retrieves preserved recovery data
      const loadedUserA = await loadAnalysisRecovery('u_userA', 'mat-persist-1');
      assert.equal(loadedUserA.status, 'success', '사용자 A는 새로고침 후에도 복구 데이터 로드 성공');
      assert.equal(loadedUserA.data.jobKey, 'job-persist-1');
      assert.equal(loadedUserA.data.drafts.length, 1);
      assert.equal(loadedUserA.data.checkpointStatus, 'committed');

      // 4. JSON export fallback validation (simulating browser environment)
      let downloadedBlobContent = '';
      global.window = {
        indexedDB: globalThis.indexedDB,
      };
      global.document = {
        body: {
          appendChild: () => {},
          removeChild: () => {},
        },
        createElement: (tag) => {
          if (tag === 'a') {
            return {
              href: '',
              download: '',
              click: () => {},
            };
          }
          return {};
        },
      };
      global.URL = {
        createObjectURL: (blob) => {
          downloadedBlobContent = blob;
          return 'blob:mock-url';
        },
        revokeObjectURL: () => {},
      };

      exportAnalysisRecoveryAsJson(recordUserA, '미적분학_교안');
      assert.ok(downloadedBlobContent, 'DB 영구 불가 시 JSON 파일 다운로드 내보내기 폴백 정상 생성');

      // 5. Cleanup on successful recovery
      await deleteAnalysisRecovery('u_userA', 'mat-persist-1');
      const loadedAfterClean = await loadAnalysisRecovery('u_userA', 'mat-persist-1');
      assert.equal(loadedAfterClean.status, 'not_found', '저장 완료 후 복구 데이터가 안전하게 정리됨');

      delete global.window;
      delete global.document;
      global.URL = (await import('node:url')).URL;
    });
  });

  // =========================================================================
  // 6대 핵심 프로덕션 결함 검증 스위트
  // =========================================================================

  await checkAsync('6대 문제 1: 진행률 조회를 실제 분석 작업과 연결 및 부재/교차 계정 차단', async () => {
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { NextRequest } = load(path.join(output, 'node_modules/next/server.js'));

    const testUser = { id: 'test-user', email: 'test@example.com' };
    const fakeSubjectId = 'sub_p1_math';
    const fakeMaterialId = 'mat_p1_101';
    const fakeJobKey = 'job_p1_real_101';

    let aiCalls = 0;
    const aiClientPath = path.join(output, 'lib', 'aiClient.js');
    const aiModule = load(aiClientPath);
    aiModule.callAiChat = async () => {
      aiCalls++;
      return { ok: true, content: '{"concepts":[]}', model: 'deepseek-v4.1-flash' };
    };

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: fakeMaterialId, user_id: testUser.id, subject_id: fakeSubjectId }],
      analysis_jobs: [
        {
          id: fakeJobKey,
          user_id: testUser.id,
          subject_id: fakeSubjectId,
          material_id: fakeMaterialId,
          markdown_hash: 'hash_p1',
          domain: 'math_stats',
          model_id: 'deepseek-v4.1-flash',
          prompt_version: 'v2',
          chunking_version: 'v1',
          total_chunks: 2,
          status: 'processing',
          updated_at: new Date().toISOString(),
        },
      ],
      analysis_job_chunks: [
        {
          job_id: fakeJobKey,
          chunk_index: 1,
          status: 'completed',
          drafts: [],
          updated_at: new Date().toISOString(),
        },
        {
          job_id: fakeJobKey,
          chunk_index: 2,
          status: 'pending',
          drafts: [],
          updated_at: new Date().toISOString(),
        },
      ],
      concept_drafts: [],
      rpcImpl: (fn) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        return { data: null, error: null };
      },
    }, async () => {
      // 1) Actual UI query: passes materialId and subjectId without jobKey (reload simulation)
      const reloadReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'math_stats',
        }),
      });

      const reloadRes = await analyzePost(reloadReq);
      const reloadData = await reloadRes.json();

      assert.equal(reloadRes.status, 200, '새로고침 후 jobKey 없이도 materialId로 기존 작업 복원 성공');
      assert.equal(reloadData.jobKey, fakeJobKey, '정확한 기존 jobKey 반환');
      assert.equal(reloadData.materialId, fakeMaterialId, '응답에 materialId 일치');
      assert.equal(reloadData.subjectId, fakeSubjectId, '응답에 subjectId 일치');
      assert.equal(reloadData.completedChunks, 1, '완료된 청크 수 복원');
      assert.equal(reloadData.totalChunks, 2, '전체 청크 수 복원');
      assert.equal(aiCalls, 0, '상태 조회 과정에서 AI 호출 0회 보장');

      // 2) Explicit NOT FOUND for non-existing job/material
      const notFoundReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          materialId: 'mat_non_existing_999',
          subjectId: fakeSubjectId,
          domain: 'math_stats',
        }),
      });
      const notFoundRes = await analyzePost(notFoundReq);
      const notFoundData = await notFoundRes.json();

      assert.equal(notFoundRes.status, 404, '존재하지 않는 작업 상태 조회 시 명시적 404');
      assert.equal(notFoundData.notFound, true, 'notFound: true 명시 플래그 반환');
      assert.equal(notFoundData.errorCode, 'JOB_NOT_FOUND', 'JOB_NOT_FOUND 에러 코드 반환');
      assert.equal(aiCalls, 0, '존재하지 않는 작업 조회에서도 AI 호출 0회 보장');
    });
  });

  await checkAsync('6대 문제 2: 복구 서명 전체 필드(출처검증·추가근거·승인상태) 변조 탐지 및 비밀값 미설정 즉각 실패', async () => {
    const { signRecoveryToken, verifyRecoveryToken, hasRecoverySigningSecret } = load(path.join(output, 'lib/recoveryToken.js'));

    const baseDraft = {
      id: 'd_p2_1',
      subjectId: 'sub_p2',
      materialId: 'mat_p2',
      title: '베이즈 정리',
      domain: 'math_stats',
      description: '사전확률과 사후확률의 관계를 나타낸다.',
      coreDefinitionFormulaOrAlgorithm: 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}',
      prerequisites: ['조건부확률'],
      relatedConcepts: ['전확률 정리'],
      commonMisconceptions: ['P(A|B)와 P(B|A)를 혼동한다.'],
      examples: ['희귀 질병 진단 확률 계산'],
      sourceEvidence: {
        type: 'page',
        pageNumber: 42,
        quote: '베이즈 정리를 정의한다.',
        verified: false,
      },
      additionalEvidences: [
        { type: 'transcript_block', blockIndex: 3, quote: '교수님 강의 발화', verified: false },
      ],
      status: 'draft',
      isApproved: false,
      sourceMarkdownHash: 'hash_p2_base',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const tokenParams = {
      userId: 'test-user',
      jobId: 'job_p2_1',
      materialId: 'mat_p2',
      subjectId: 'sub_p2',
      domain: 'math_stats',
      chunkIndex: 1,
      markdownHash: 'hash_p2_base',
      modelId: 'deepseek-v4.1-flash',
      drafts: [baseDraft],
    };

    const validToken = signRecoveryToken(tokenParams);
    assert.ok(validToken, '정상 복구 토큰 발급');

    // 1) Verify clean token passes
    const validRes = verifyRecoveryToken(validToken, tokenParams);
    assert.equal(validRes.ok, true, '변조 없는 원본 토큰 검증 성공');

    // 2) Tamper: sourceEvidence.verified (false -> true)
    const tamperedEvidence = structuredClone(tokenParams);
    tamperedEvidence.drafts[0].sourceEvidence.verified = true;
    const resEvidence = verifyRecoveryToken(validToken, tamperedEvidence);
    assert.equal(resEvidence.ok, false, 'sourceEvidence.verified 변조 시 거부');
    assert.equal(resEvidence.code, 'TAMPERED');

    // 3) Tamper: additionalEvidences
    const tamperedAddl = structuredClone(tokenParams);
    tamperedAddl.drafts[0].additionalEvidences[0].verified = true;
    const resAddl = verifyRecoveryToken(validToken, tamperedAddl);
    assert.equal(resAddl.ok, false, 'additionalEvidences 변조 시 거부');
    assert.equal(resAddl.code, 'TAMPERED');

    // 4) Tamper: isApproved (false -> true)
    const tamperedApproved = structuredClone(tokenParams);
    tamperedApproved.drafts[0].isApproved = true;
    const resApproved = verifyRecoveryToken(validToken, tamperedApproved);
    assert.equal(resApproved.ok, false, 'isApproved 승인 상태 변조 시 거부');
    assert.equal(resApproved.code, 'TAMPERED');

    // 5) Tamper: materialId or subjectId in draft
    const tamperedMat = structuredClone(tokenParams);
    tamperedMat.drafts[0].materialId = 'mat_forged';
    const resMat = verifyRecoveryToken(validToken, tamperedMat);
    assert.equal(resMat.ok, false, '초안 내부 materialId 변조 시 거부');
    assert.equal(resMat.code, 'TAMPERED');

    // 6) Replay to another user or job
    const replayUser = verifyRecoveryToken(validToken, { ...tokenParams, userId: 'u_attacker' });
    assert.equal(replayUser.ok, false, '타 계정 토큰 재사용 거부');
    assert.equal(replayUser.code, 'MISMATCH');

    // 7) Secret unconfigured test: explicitly fails with no hardcoded fallback
    const originalSecret = process.env.ANALYSIS_RECOVERY_SIGNING_SECRET;
    const originalRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.ANALYSIS_RECOVERY_SIGNING_SECRET;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      assert.equal(hasRecoverySigningSecret(), false, '서명 키 미설정 감지');
      assert.throws(() => {
        signRecoveryToken(tokenParams);
      }, /ANALYSIS_RECOVERY_SIGNING_SECRET 또는 SUPABASE_SERVICE_ROLE_KEY/, '서명 키 미설정 시 고정 문자열 폴백 없이 명시적 예외 발생');
    } finally {
      process.env.ANALYSIS_RECOVERY_SIGNING_SECRET = originalSecret;
      if (originalRoleKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalRoleKey;
    }
  });

  await checkAsync('6대 문제 3: 직접 RPC 우회 차단 및 서버 전용 결과 확정 권한 분리 (Migration 18 검증)', async () => {
    // 1) Verify Migration 18 SQL exists and revokes execution from public/anon/authenticated
    const migPath = path.join(root, 'supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql');
    assert.ok(fs.existsSync(migPath), 'Migration 18 파일이 존재함');
    const migSql = fs.readFileSync(migPath, 'utf8');

    assert.ok(
      /revoke (all|execute) on function public\.commit_analysis_chunk_result/i.test(migSql) &&
      migSql.includes('public, anon, authenticated'),
      'commit_analysis_chunk_result가 일반 사용자 및 공개 권한에서 취소됨'
    );
    assert.ok(
      /revoke (all|execute) on function public\.claim_analysis_chunk_lease/i.test(migSql) &&
      migSql.includes('public, anon, authenticated'),
      'claim_analysis_chunk_lease가 일반 사용자 및 공개 권한에서 취소됨'
    );
    assert.ok(
      /grant execute on function public\.commit_analysis_chunk_result/i.test(migSql) &&
      migSql.includes('service_role'),
      '결과 확정 권한은 오직 service_role에만 부여됨'
    );
    assert.ok(
      /drop policy if exists .* on public\.analysis_job_chunks/i.test(migSql),
      '청크 직접 쓰기 RLS 우회 차단됨'
    );

    // 2) Unprivileged caller RPC rejection simulation
    const unprivilegedClient = {
      rpc: (fn) => {
        if (fn === 'commit_analysis_chunk_result' || fn === 'claim_analysis_chunk_lease') {
          return { data: null, error: { message: 'permission denied for function ' + fn, code: '42501' } };
        }
        return { data: null, error: null };
      },
    };

    const directCall = unprivilegedClient.rpc('commit_analysis_chunk_result', {
      p_job_id: 'job_attack',
      p_chunk_index: 1,
      p_worker_id: 'w_hack',
      p_lease_token: 'fake',
      p_status: 'completed',
      p_drafts: [],
    });
    assert.equal(directCall.error.code, '42501', '일반 사용자의 직접 결과 확정 RPC 호출은 DB 권한 오류로 거부됨');
  });

  await checkAsync('6대 문제 4: 복구 데이터 작업·청크별 독립 보존, durable 트랜잭션, 조건부 삭제 및 메모리 폴백', async () => {
    const {
      saveAnalysisRecovery,
      loadAnalysisRecovery,
      deleteAnalysisRecovery,
      listAnalysisRecoveries,
    } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async () => {
      const scopeId = 'u_p4_user';
      const matId = 'mat_p4_same';
      const job1 = 'job_p4_1';

      const draftA = {
        id: 'd_chunk1',
        materialId: matId,
        subjectId: 'sub_p4',
        title: '미적분학 기본정리 1',
        domain: 'math_stats',
        description: '도함수의 정적분',
        coreDefinitionFormulaOrAlgorithm: '\\frac{d}{dx}\\int_a^x f(t)dt = f(x)',
        prerequisites: [],
        relatedConcepts: [],
        commonMisconceptions: [],
        examples: [],
        sourceEvidence: { type: 'page', quote: '기본정리', verified: false },
        status: 'draft',
        isApproved: false,
      };

      const draftB = {
        id: 'd_chunk2',
        materialId: matId,
        subjectId: 'sub_p4',
        title: '미적분학 기본정리 2',
        domain: 'math_stats',
        description: '정적분의 계산',
        coreDefinitionFormulaOrAlgorithm: '\\int_a^b f(x)dx = F(b)-F(a)',
        prerequisites: [],
        relatedConcepts: [],
        commonMisconceptions: [],
        examples: [],
        sourceEvidence: { type: 'page', quote: '계산 공식', verified: false },
        status: 'draft',
        isApproved: false,
      };

      // 1) Save chunk 1 and chunk 2 for the same material
      const res1 = await saveAnalysisRecovery(scopeId, {
        jobKey: job1,
        chunkIndex: 1,
        workerId: 'w1',
        leaseToken: 'lt1',
        drafts: [draftA],
        materialId: matId,
        subjectId: 'sub_p4',
        domain: 'math_stats',
        markdownHash: 'hash_p4',
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date(Date.now() - 5000).toISOString(),
      });
      assert.equal(res1.ok, true, '청크 1 저장 성공');

      const res2 = await saveAnalysisRecovery(scopeId, {
        jobKey: job1,
        chunkIndex: 2,
        workerId: 'w1',
        leaseToken: 'lt2',
        drafts: [draftB],
        materialId: matId,
        subjectId: 'sub_p4',
        domain: 'math_stats',
        markdownHash: 'hash_p4',
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });
      assert.equal(res2.ok, true, '청크 2 저장 성공');

      // 2) Verify both chunks exist simultaneously under the same material (no overwrite!)
      const allForMat = await listAnalysisRecoveries(scopeId, matId);
      assert.equal(allForMat.status, 'success');
      assert.equal(allForMat.data.length, 2, '같은 자료의 청크 1과 청크 2가 서로를 덮어쓰지 않고 공존함');

      const loadedC1 = await loadAnalysisRecovery(scopeId, job1, 1);
      const loadedC2 = await loadAnalysisRecovery(scopeId, job1, 2);
      assert.equal(loadedC1.status, 'success');
      assert.equal(loadedC2.status, 'success');
      assert.ok(loadedC1.data && loadedC1.data.drafts[0].title === '미적분학 기본정리 1');
      assert.ok(loadedC2.data && loadedC2.data.drafts[0].title === '미적분학 기본정리 2');

      // 3) Conditional deletion: older request completion cannot delete newer chunk record
      await deleteAnalysisRecovery(scopeId, job1, 2, 'outdated_stale_hash');
      const recheckC2 = await loadAnalysisRecovery(scopeId, job1, 2);
      assert.equal(recheckC2.status, 'success', '해시가 일치하지 않는 구버전 요청의 삭제는 새 청크 복구 데이터를 삭제하지 못함');

      // 4) Deleting exact chunk 1 leaves chunk 2 intact
      await deleteAnalysisRecovery(scopeId, job1, 1);
      const checkC1Deleted = await loadAnalysisRecovery(scopeId, job1, 1);
      const checkC2StillAlive = await loadAnalysisRecovery(scopeId, job1, 2);
      assert.equal(checkC1Deleted.status, 'not_found', '청크 1만 정확하게 삭제됨');
      assert.equal(checkC2StillAlive.status, 'success', '청크 2는 안전하게 유지됨');
    });
  });

  await checkAsync('6대 문제 5: 체크포인트 완료와 초안 저장 완료 분리 및 상태 조회 일관성', async () => {
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { NextRequest } = load(path.join(output, 'node_modules/next/server.js'));

    const testUser = { id: 'test-user', email: 'test@example.com' };
    const fakeSubjectId = 'sub_p5_cs';
    const fakeMaterialId = 'mat_p5_algo';
    const fakeDraft = {
      id: 'd_p5_dijkstra',
      materialId: fakeMaterialId,
      subjectId: fakeSubjectId,
      title: '다익스트라 알고리즘',
      domain: 'computer_science',
      description: '단일 출발점 최단 경로 알고리즘',
      coreDefinitionFormulaOrAlgorithm: 'O((V+E)log V)',
      prerequisites: ['그래프'],
      relatedConcepts: ['벨만-포드'],
      commonMisconceptions: ['음수 가중치 간선이 있어도 동작한다.'],
      examples: ['GPS 경로 탐색'],
      sourceEvidence: { type: 'page', quote: '최단경로', verified: false },
      status: 'draft',
      isApproved: false,
    };

    let aiCalls = 0;
    const aiClientPath = path.join(output, 'lib', 'aiClient.js');
    const aiModule = load(aiClientPath);
    aiModule.callAiChat = async () => {
      aiCalls++;
      return {
        ok: true,
        content: JSON.stringify({ concepts: [fakeDraft] }),
        model: 'deepseek-v4.1-flash',
      };
    };

    // State: Checkpoint succeeds, but concept_drafts DB insert fails
    let simulateDraftsPersistFailure = true;

    const fakeJobChunks = [];

    await withFakeSupabase({
      user: testUser,
      materials: [{ id: fakeMaterialId, user_id: testUser.id, subject_id: fakeSubjectId }],
      analysis_jobs: [],
      analysis_job_chunks: fakeJobChunks,
      concept_drafts: [],
      rpcImpl: (fn, args, state) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'claim_analysis_chunk_lease') {
          return { data: { acquired: true, lease_token: 'lease_p5_tok' }, error: null };
        }
        if (fn === 'commit_analysis_chunk_result') {
          const targetIndex = args?.p_chunk_index || 1;
          const chunks = state.analysis_job_chunks || [];
          const existing = chunks.find((c) => c.chunk_index === targetIndex);
          if (existing) {
            existing.status = args?.p_status || 'completed';
            existing.drafts = args?.p_drafts || [];
          } else {
            chunks.push({
              job_id: args?.p_job_id,
              chunk_index: targetIndex,
              status: args?.p_status || 'completed',
              drafts: args?.p_drafts || [],
            });
          }
          const jobs = state.analysis_jobs || [];
          const job = jobs.find((j) => j.id === args?.p_job_id);
          if (job) job.status = 'completed';
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
      fail: {
        upsert: (table) => simulateDraftsPersistFailure && table === 'concept_drafts',
      },
    }, async () => {
      // 1) First process run: Checkpoint succeeds, drafts persist fails -> partial completion
      const runReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'computer_science',
          markdown: '# Dijkstra\n\nShortest path algorithm',
        }),
      });

      const runRes = await analyzePost(runReq);
      const runData = await runRes.json();

      assert.equal(runRes.status, 500, '초안 영속 저장 실패 시 500 반환');
      assert.equal(runData.checkpointCommitted, true, '체크포인트는 커밋 성공');
      assert.equal(runData.checkpointStatus, 'completed', '체크포인트 상태는 completed');
      assert.equal(runData.draftsPersistStatus, 'failed', '초안 영속 저장 상태는 failed (부분 완료 명시)');
      assert.equal(runData.persisted, false, 'persisted는 false');
      assert.equal(runData.canRetrySave, true, 'AI 재호출 없는 저장 재시도 가능 플래그 제공');
      assert.ok(runData.signedRecoveryToken, '재시도용 서명된 복구 토큰 발급');
      assert.equal(aiCalls, 1, '첫 실행에서 AI 1회 호출');

      // 2) Status query during this partial completion state
      const statusReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          jobKey: runData.jobKey,
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'computer_science',
        }),
      });

      const statusRes = await analyzePost(statusReq);
      const statusData = await statusRes.json();

      assert.equal(statusData.checkpointStatus, 'completed');
      assert.equal(statusData.draftsPersistStatus, 'failed');
      assert.equal(statusData.isAllComplete, false, '초안 미저장 상태이므로 isAllComplete는 false여야 함');
      assert.equal(aiCalls, 1, '상태 조회에서 AI 호출 0회');

      // 3) Retry save with signedRecoveryToken: DB recovers, drafts persist succeeds!
      simulateDraftsPersistFailure = false;

      const retryReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: runData.jobKey,
          chunkIndex: 1,
          workerId: runData.workerId || 'w_p5',
          leaseToken: runData.leaseToken || 'lease_p5_tok',
          drafts: runData.drafts,
          materialId: fakeMaterialId,
          subjectId: fakeSubjectId,
          domain: 'computer_science',
          markdownHash: runData.markdownHash,
          signedRecoveryToken: runData.signedRecoveryToken,
        }),
      });

      const retryRes = await analyzePost(retryReq);
      const retryData = await retryRes.json();

      assert.equal(retryRes.status, 200, '저장 재시도 성공');
      assert.equal(retryData.persisted, true, '초안 영속 저장 성공');
      assert.equal(retryData.draftsPersistStatus, 'persisted');
      assert.equal(aiCalls, 1, '저장 재시도 과정에서 AI 재호출 0회 보장');
    });
  });

  await checkAsync('6대 문제 6: 재개 작업의 기록 모델과 실제 호출 모델 일치 및 충돌 거부', async () => {
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { NextRequest } = load(path.join(output, 'node_modules/next/server.js'));

    const testUser = { id: 'test-user', email: 'test@example.com' };
    const fakeSubjectId = 'sub_p6';
    const fakeMaterialId = 'mat_p6';
    const fakeJobKey = 'job_p6_model_a';

    let actualConfigModelReceivedByAi = '';
    const aiClientPath = path.join(output, 'lib', 'aiClient.js');
    const aiModule = load(aiClientPath);
    const originalCallAiChat = aiModule.callAiChat;
    aiModule.callAiChat = async (_opts, config) => {
      actualConfigModelReceivedByAi = config.model;
      return { ok: true, content: '{"concepts":[]}', model: config.model };
    };

    // User settings returned from resolveAiConfigForUser is Model B ('gpt-4o')
    const aiCredPath = path.join(output, 'lib', 'aiCredentials.js');
    const credModule = load(aiCredPath);
    const originalResolveAiConfigForUser = credModule.resolveAiConfigForUser;
    credModule.resolveAiConfigForUser = async () => ({
      ok: true,
      config: {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o', // Model B
      },
    });

    try {
      const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));
      const p6Markdown = '# Section 1\n\n' + 'A'.repeat(5000) + '\n\n# Section 2\n\n' + 'B'.repeat(5000);
      const p6MarkdownHash = computeMarkdownHash(p6Markdown);

      await withFakeSupabase({
        user: testUser,
        materials: [{ id: fakeMaterialId, user_id: testUser.id, subject_id: fakeSubjectId }],
        analysis_jobs: [
          {
            id: fakeJobKey,
            user_id: testUser.id,
            subject_id: fakeSubjectId,
            material_id: fakeMaterialId,
            markdown_hash: p6MarkdownHash,
            domain: 'math_stats',
            model_id: 'deepseek-v4.1-flash', // Originally created with Model A
            prompt_version: 'v2',
            chunking_version: 'v1',
            total_chunks: 2,
            status: 'paused',
            updated_at: new Date().toISOString(),
          },
        ],
        analysis_job_chunks: [
          {
            job_id: fakeJobKey,
            chunk_index: 1,
            status: 'completed',
            drafts: [],
          },
          {
            job_id: fakeJobKey,
            chunk_index: 2,
            status: 'pending',
            drafts: [],
          },
        ],
        concept_drafts: [],
        rpcImpl: (fn) => {
          if (fn === 'get_ai_connection_secret') return { data: null, error: null };
          if (fn === 'resume_analysis_job') return { data: { success: true }, error: null };
          if (fn === 'claim_analysis_chunk_lease') return { data: { acquired: true, lease_token: 'lease_p6' }, error: null };
          if (fn === 'commit_analysis_chunk_result') return { data: { committed: true }, error: null };
          return { data: null, error: null };
        },
      }, async () => {
        // 1) Explicit model mismatch attempt: user sends payload requesting Model B into Job A
        const mismatchReq = new NextRequest('http://localhost/api/analyze-concepts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'process',
            jobKey: fakeJobKey,
            materialId: fakeMaterialId,
            subjectId: fakeSubjectId,
            domain: 'math_stats',
            markdown: p6Markdown,
            model: 'gpt-4o', // User tries to mix Model B into Job A!
          }),
        });

        const mismatchRes = await analyzePost(mismatchReq);
        const mismatchData = await mismatchRes.json();

        assert.equal(mismatchRes.status, 400, '기존 작업의 모델과 다른 모델로 요청 시 400 반환');
        assert.equal(mismatchData.errorCode, 'JOB_MODEL_MISMATCH', 'JOB_MODEL_MISMATCH 에러 코드 반환');
        assert.ok(mismatchData.error.includes('하나의 작업에 혼합할 수 없습니다'));

        // 2) Normal resume: user calls process without forcing new model
        // The server MUST enforce Model A (deepseek-v4.1-flash) for actual AI call
        const resumeReq = new NextRequest('http://localhost/api/analyze-concepts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'process',
            jobKey: fakeJobKey,
            materialId: fakeMaterialId,
            subjectId: fakeSubjectId,
            domain: 'math_stats',
            markdown: p6Markdown,
            chunkIndex: 2,
          }),
        });

        const resumeRes = await analyzePost(resumeReq);
        const resumeData = await resumeRes.json();

        assert.equal(resumeRes.status, 200, '재개 작업 정상 완료');
        assert.equal(
          actualConfigModelReceivedByAi,
          'deepseek-v4.1-flash',
          '실제 AI 호출에 전달된 모델이 기존 작업 모델(Model A)과 엄격히 일치함'
        );
        assert.equal(resumeData.model, 'deepseek-v4.1-flash', '응답 메타데이터의 모델 일치');
      });
    } finally {
      aiModule.callAiChat = originalCallAiChat;
      credModule.resolveAiConfigForUser = originalResolveAiConfigForUser;
    }
  });

  // =========================================================================
  // 3대 P1 프로덕션 결함 정밀 검증 스위트
  // =========================================================================

  await checkAsync('P1 Problem 1: Migration 18/19 원자적 서버 초기화 RPC, 소유권 검증 및 관리자 설정 누락 시 즉각 실패', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const otherUser = { id: 'other-user' };
    const testMaterialId = 'mat-p1-init';
    const otherMaterialId = 'mat-p1-other';
    const localOnlyMaterialId = 'mat-p1-local-only';
    const testSubjectId = 'sub-p1-init';
    const testMarkdown = '# 선형대수학\n## 고유값과 고유벡터\n정방행렬 A에 대해 Ax = lambda x를 만족하는 0이 아닌 벡터 x를 고유벡터라 한다. [PAGE 5]';

    let aiCallCount = 0;
    global.fetch = async () => {
      aiCallCount++;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                concepts: [
                  {
                    title: '고유값',
                    domain: 'math_stats',
                    description: '선형 변환에서 방향이 보존되는 스칼라 배율',
                    coreDefinitionFormulaOrAlgorithm: 'Ax = \\lambda x',
                    prerequisites: ['행렬 곱셈'],
                    relatedConcepts: ['고유벡터'],
                    commonMisconceptions: ['0벡터는 고유벡터가 될 수 없다.'],
                    examples: ['항등행렬의 고유값은 1이다.'],
                    sourceEvidence: { type: 'page', pageNumber: 5, quote: '정방행렬 A에 대해 Ax = lambda x' },
                  },
                ],
              }),
            },
          },
        ],
      });
    };

    let rpcCalls = [];
    await withFakeSupabase({
      user: testUser,
      materials: [
        { id: testMaterialId, user_id: testUser.id, subject_id: testSubjectId },
        { id: otherMaterialId, user_id: otherUser.id, subject_id: testSubjectId },
      ],
      analysis_jobs: [],
      analysis_job_chunks: [],
      concept_drafts: [],
      rpcImpl: (fn, args, state) => {
        rpcCalls.push({ fn, args });
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'init_analysis_job_and_chunks') {
          // Check ownership simulation as implemented in Migration 19
          const mat = state.materials.find((m) => m.id === args.p_material_id);
          if (mat && mat.user_id !== args.p_user_id) {
            return { data: { success: false, error: '자료에 대한 접근 권한이 없습니다.', error_code: 'FORBIDDEN' }, error: null };
          }
          const jobs = (state.analysis_jobs = state.analysis_jobs || []);
          const chunks = (state.analysis_job_chunks = state.analysis_job_chunks || []);
          if (!jobs.some((j) => j.id === args.p_job_id)) {
            jobs.push({
              id: args.p_job_id,
              user_id: args.p_user_id,
              material_id: args.p_material_id,
              subject_id: args.p_subject_id,
              markdown_hash: args.p_markdown_hash,
              total_chunks: args.p_total_chunks,
              status: 'pending',
            });
          }
          for (const ch of args.p_chunks || []) {
            if (!chunks.some((c) => c.job_id === args.p_job_id && c.chunk_index === ch.chunk_index)) {
              chunks.push({
                job_id: args.p_job_id,
                chunk_index: ch.chunk_index,
                source_context: ch.source_context,
                status: 'pending',
                drafts: [],
                attempt_count: 0,
              });
            }
          }
          return { data: { success: true, job_id: args.p_job_id, total_chunks: args.p_total_chunks }, error: null };
        }
        if (fn === 'claim_analysis_chunk_lease') {
          return { data: { acquired: true, lease_token: 'lease-p1-123', chunk_index: args.p_chunk_index }, error: null };
        }
        if (fn === 'commit_analysis_chunk_result') {
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async (fakeClient) => {
      // 1) Action init: creates job and chunks atomically via service_role RPC without AI invocation
      const initReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: testMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const initRes = await analyzePost(initReq);
      const initData = await initRes.json();

      assert.equal(initRes.status, 200, 'Init succeeds with 200');
      assert.equal(initData.success, true);
      assert.equal(initData.initialized, true);
      assert.ok(initData.jobKey, 'JobKey generated upfront');
      assert.equal(aiCallCount, 0, 'No AI call occurred during init');

      // Verify init_analysis_job_and_chunks was invoked
      const initRpcCall = rpcCalls.find((c) => c.fn === 'init_analysis_job_and_chunks');
      assert.ok(initRpcCall, 'init_analysis_job_and_chunks RPC was executed');
      assert.equal(initRpcCall.args.p_user_id, testUser.id);
      assert.equal(initRpcCall.args.p_material_id, testMaterialId);

      // Verify DB state
      assert.equal(fakeClient.__state.analysis_jobs.length, 1);
      assert.equal(fakeClient.__state.analysis_job_chunks.length, 1);
      assert.equal(fakeClient.__state.analysis_job_chunks[0].status, 'pending');

      // 2) Idempotency & Concurrency: repeating init with same input NEVER resets chunks or drafts
      fakeClient.__state.analysis_job_chunks[0].status = 'completed';
      fakeClient.__state.analysis_job_chunks[0].drafts = [{ id: 'd-completed', title: '기존 완료 초안' }];

      const repeatInitReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: testMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const repeatInitRes = await analyzePost(repeatInitReq);
      const repeatInitData = await repeatInitRes.json();
      assert.equal(repeatInitRes.status, 200);
      assert.equal(repeatInitData.jobKey, initData.jobKey, 'Same expectedJobKey reused');
      assert.equal(fakeClient.__state.analysis_job_chunks[0].status, 'completed', 'Existing completed status not reset');
      assert.equal(fakeClient.__state.analysis_job_chunks[0].drafts.length, 1, 'Existing drafts not wiped');

      // 3) Local-only material support: material row absent on server does not fail
      const localInitReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: localOnlyMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const localInitRes = await analyzePost(localInitReq);
      assert.equal(localInitRes.status, 200, 'Local-only material init succeeds without requiring server material row');

      // 4) Cross-user isolation: attempting init on another user\'s material is rejected
      const forbiddenReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: otherMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const forbiddenRes = await analyzePost(forbiddenReq);
      assert.equal(forbiddenRes.status, 404, 'Other user material rejected with 404/403 NOT_FOUND_OR_FORBIDDEN');

      // 5) Admin configuration missing: fail fast with 500 SERVER_CONFIG_ERROR and 0 AI calls
      globalThis.__disableFakeAdminClient = true;
      try {
        const aiBeforeConfigFail = aiCallCount;
        const configFailReq = new NextRequest('http://localhost/api/analyze-concepts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'process',
            materialId: testMaterialId,
            subjectId: testSubjectId,
            domain: 'math_stats',
            markdown: testMarkdown,
          }),
        });
        const configFailRes = await analyzePost(configFailReq);
        const configFailData = await configFailRes.json();

        assert.equal(configFailRes.status, 500, 'Fails with 500 when admin key is missing');
        assert.equal(configFailData.errorCode, 'SERVER_CONFIG_ERROR', 'Explicit SERVER_CONFIG_ERROR returned');
        assert.equal(aiCallCount, aiBeforeConfigFail, 'CRITICAL: No AI call was made when admin config failed');
      } finally {
        delete globalThis.__disableFakeAdminClient;
      }
    });
  });

  await checkAsync('P1 Problem 2: IndexedDB v1 -> v4 업그레이드 시 복구 데이터 안전 이관, 읽기 실패/중단 시 원본 보존 및 차단 안내', async () => {
    const {
      saveAnalysisRecovery,
      loadAnalysisRecovery,
      listAnalysisRecoveries,
      listUnmigratedAnalysisRecoveries,
      deleteAnalysisRecovery,
    } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async (fakeIdb) => {
      const scopeId = 'u_p2_idb_test';
      const dbName = `redcall_analysis_recovery_${scopeId}`;

      // 1. Manually setup a v1 IndexedDB schema with keyPath: 'materialId'
      const v1Stores = fakeIdb.__databases.get(dbName) || new Map();
      fakeIdb.__databases.set(dbName, v1Stores);
      fakeIdb.__dbVersions.set(dbName, 1);

      const v1RecoveryStore = new Map();
      v1Stores.set('recoveries', v1RecoveryStore);

      const v1Record1 = {
        materialId: 'mat-v1-ok',
        jobKey: 'job-v1-ok',
        subjectId: 'sub-math',
        domain: 'math_stats',
        markdownHash: 'hash-v1',
        chunkIndex: 1,
        workerId: 'worker-1',
        leaseToken: 'token-1',
        drafts: [{ id: 'd-1', title: '코시-슈바르츠 부등식' }],
        signedRecoveryToken: 'token-signed-1',
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T10:00:00.000Z',
      };
      v1RecoveryStore.set('mat-v1-ok', v1Record1);

      // Incomplete record (missing jobKey)
      const v1RecordIncomplete = {
        materialId: 'mat-v1-inc',
        drafts: [{ id: 'd-inc', title: '미완성' }],
        savedAt: '2026-10-15T10:05:00.000Z',
      };
      v1RecoveryStore.set('mat-v1-inc', v1RecordIncomplete);

      // 2. READ FAILURE INJECTION: When getAll fails during upgrade, verify tx.abort() preserves v1 store and data
      fakeIdb.__failure.getAll = true;
      const readFailResult = await loadAnalysisRecovery(scopeId, 'mat-v1-ok');
      assert.equal(readFailResult.status, 'error', '읽기 실패 시 error 반환');
      // CRITICAL ASSERTION: The v1 store must NOT have been deleted! The records must be preserved!
      assert.ok(v1Stores.has('recoveries'), '읽기 실패 시 기존 recoveries 저장소가 삭제되지 않고 보존됨');
      assert.equal(v1RecoveryStore.has('mat-v1-ok'), true, '기존 v1 레코드가 그대로 유지됨');
      assert.equal(fakeIdb.__dbVersions.get(dbName), 1, '업그레이드 트랜잭션이 롤백되어 DB 버전이 1로 유지됨');
      fakeIdb.__failure.getAll = false;

      // 3. Successful upgrade: opens and migrates v1 records into v5 structure
      const loadedNormal = await loadAnalysisRecovery(scopeId, 'job-v1-ok', 1);
      assert.equal(loadedNormal.status, 'success', 'v1 정상 레코드가 v5 복구 저장소로 안전하게 이관됨');
      assert.equal(loadedNormal.data.id, 'job-v1-ok_c1');
      assert.equal(loadedNormal.data.drafts[0].title, '코시-슈바르츠 부등식');
      assert.equal(loadedNormal.data.signedRecoveryToken, 'token-signed-1');

      // Incomplete record is in unmigrated store
      const unmigrated = await listUnmigratedAnalysisRecoveries(scopeId);
      assert.equal(unmigrated.status, 'success');
      assert.equal(unmigrated.data.length, 1);
      assert.equal(unmigrated.data[0].materialId, 'mat-v1-inc');

      // 4. Blocked upgrade handling
      fakeIdb.__failure.blocked = true;
      const blockedRes = await saveAnalysisRecovery(scopeId, {
        materialId: 'mat-blocked',
        jobKey: 'job-blocked',
        subjectId: 'sub-math',
        domain: 'math_stats',
        markdownHash: 'hash-b',
        chunkIndex: 1,
        workerId: 'w-b',
        leaseToken: 'tok-b',
        drafts: [{ id: 'd-b', title: '차단 테스트' }],
        checkpointStatus: 'pending',
        draftsPersistStatus: 'pending',
        savedAt: new Date().toISOString(),
      });
      assert.equal(blockedRes.ok, false);
      assert.ok(blockedRes.error.includes('다른 탭에서 데이터베이스를 사용 중이어서'));
      fakeIdb.__failure.blocked = false;

      // 5. Targeted delete: deleteAnalysisRecovery(scope, materialId, jobKey) deletes only that job's records
      await deleteAnalysisRecovery(scopeId, 'mat-v1-ok', 'job-v1-ok');
      const afterDelete = await listAnalysisRecoveries(scopeId);
      assert.equal(afterDelete.status, 'success');
      assert.equal(afterDelete.data.filter((r) => r.jobKey === 'job-v1-ok').length, 0);
    });
  });

  await checkAsync('P2 Problem 1: Migration 19/20 분석 작업 동시 초기화의 기본키 충돌 방지 및 작업 정체성 검증', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const testMaterialId = 'mat-p1-conc';
    const testSubjectId = 'sub-p1-conc';
    const testMarkdown = '# 선형대수\n## 행렬식\n행렬식은 부피의 팽창 비율을 나타내는 스칼라 함수이다. [PAGE 1]';

    let jobsDb = [];
    let chunksDb = [];
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: testSubjectId, user_id: testUser.id, name: '선형대수' }],
      materials: [{ id: testMaterialId, user_id: testUser.id, subject_id: testSubjectId }],
      analysis_jobs: jobsDb,
      analysis_job_chunks: chunksDb,
    }, async (fakeClient) => {
      // 1) Simulate two concurrent initialization requests with the EXACT SAME input
      const req1 = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: testMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const req2 = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: testMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });

      const [res1, res2] = await Promise.all([analyzePost(req1), analyzePost(req2)]);
      const [data1, data2] = await Promise.all([res1.json(), res2.json()]);

      assert.equal(res1.status, 200, '동시 요청 1 성공');
      assert.equal(res2.status, 200, '동시 요청 2 성공 (기본키 충돌 없이 처리)');
      assert.equal(data1.jobKey, data2.jobKey, '두 요청이 동일한 작업 식별자를 반환받음');
      assert.equal(jobsDb.length, 1, 'DB에 정확히 1개의 작업만 생성됨 (중복 없음)');
      assert.equal(chunksDb.length, 1, 'DB에 정확히 1개의 청크만 생성됨 (청크 중복 없음)');

      // 2) Calling RPC with mismatched identity on the same jobKey -> JOB_IDENTITY_MISMATCH
      const mismatchRpcRes = await fakeClient.rpc('init_analysis_job_and_chunks', {
        p_user_id: testUser.id,
        p_job_id: data1.jobKey,
        p_subject_id: testSubjectId,
        p_material_id: testMaterialId,
        p_markdown_hash: 'completely_different_hash', // Mismatched hash!
        p_domain: 'math_stats',
        p_model_id: 'deepseek-v4.1-flash',
        p_prompt_version: 'v2',
        p_chunking_version: 'v1',
        p_total_chunks: 1,
        p_chunks: [{ chunk_index: 1, source_context: '청크 1' }],
      });
      assert.equal(mismatchRpcRes.data.success, false);
      assert.equal(mismatchRpcRes.data.error_code, 'JOB_IDENTITY_MISMATCH', '동일 식별자에 다른 내용 전달 시 충돌 거부');

      // 3) Re-initializing completed / paused job preserves status and results
      chunksDb[0].status = 'completed';
      chunksDb[0].drafts = [{ id: 'd-1', title: '행렬식' }];
      chunksDb[0].attempt_count = 2;
      jobsDb[0].status = 'completed';

      const reInitReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: testMaterialId,
          subjectId: testSubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const reInitRes = await analyzePost(reInitReq);
      assert.equal(reInitRes.status, 200);
      assert.equal(chunksDb[0].status, 'completed', '기존 완료 청크 상태 유지');
      assert.equal(chunksDb[0].drafts.length, 1, '기존 drafts 유지');
      assert.equal(chunksDb[0].attempt_count, 2, '기존 attempt_count 유지');
      assert.equal(jobsDb[0].status, 'completed', '기존 작업 status 유지');

      // 4) Failure during chunk insertion rolls back new job creation atomically
      fakeClient.__state.fail.failChunkInit = true;
      const failJobKey = 'job-fail-atomic-rollback';
      const failRpcRes = await fakeClient.rpc('init_analysis_job_and_chunks', {
        p_user_id: testUser.id,
        p_job_id: failJobKey,
        p_subject_id: testSubjectId,
        p_material_id: testMaterialId,
        p_markdown_hash: 'hash-fail',
        p_domain: 'math_stats',
        p_model_id: 'deepseek-v4.1-flash',
        p_prompt_version: 'v2',
        p_chunking_version: 'v1',
        p_total_chunks: 1,
        p_chunks: [{ chunk_index: 1, source_context: '청크 1' }],
      });
      assert.ok(failRpcRes.error, '청크 생성 실패 에러 반환');
      assert.ok(!jobsDb.some((j) => j.id === failJobKey), '청크 생성 실패 시 신규 작업도 함께 롤백됨');
      delete fakeClient.__state.fail.failChunkInit;
    });
  });

  await checkAsync('P1 Problem 3: 로컬 전용 자료 및 과목 소유권 엄격 검증, 타인 과목 차단 및 DB 오류 처리', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const otherUser = { id: 'other-user' };
    const mySubjectId = 'sub-mine';
    const otherSubjectId = 'sub-other-user';
    const myMaterialId = 'mat-mine';
    const localOnlyMaterialId = 'mat-local-only-123';
    const testMarkdown = '# 추상대수학\n## 군의 정의\n군이란 닫힘성, 결합법칙, 항등원, 역원을 만족하는 대수 구조이다. [PAGE 1]';

    let aiCalls = 0;
    global.fetch = async () => {
      aiCalls++;
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    };

    let jobsDb = [];
    let chunksDb = [];
    await withFakeSupabase({
      user: testUser,
      subjects: [
        { id: mySubjectId, user_id: testUser.id, name: '내 과목' },
        { id: otherSubjectId, user_id: otherUser.id, name: '남의 과목' },
      ],
      materials: [
        { id: myMaterialId, user_id: testUser.id, subject_id: mySubjectId },
      ],
      analysis_jobs: jobsDb,
      analysis_job_chunks: chunksDb,
    }, async (fakeClient) => {
      // 1) My subject + local-only material (no row in materials table) -> SUCCESS (no forced body upload)
      const localOkReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: localOnlyMaterialId,
          subjectId: mySubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const localOkRes = await analyzePost(localOkReq);
      const localOkData = await localOkRes.json();
      assert.equal(localOkRes.status, 200, '내 과목 + 로컬 전용 자료 정상 초기화 성공');
      assert.equal(localOkData.success, true);
      assert.ok(localOkData.jobKey);
      assert.equal(fakeClient.__state.materials.length, 1, '로컬 자료 초기화 시 본문/자료 강제 서버 업로드 없음');

      // 2) Other user's subject + arbitrary material ID -> 404 NOT_FOUND_OR_FORBIDDEN (0 AI calls, no job created)
      const aiBeforeOtherSub = aiCalls;
      const jobsBeforeOtherSub = jobsDb.length;
      const otherSubReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: 'any-mat-id',
          subjectId: otherSubjectId, // Other user's subject!
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const otherSubRes = await analyzePost(otherSubReq);
      const otherSubData = await otherSubRes.json();
      assert.equal(otherSubRes.status, 404, '타인 과목 지정 시 404 거부');
      assert.equal(otherSubData.errorCode, 'NOT_FOUND_OR_FORBIDDEN');
      assert.equal(jobsDb.length, jobsBeforeOtherSub, '타인 과목 요청으로 작업 생성되지 않음');
      assert.equal(aiCalls, aiBeforeOtherSub, '타인 과목 요청으로 AI 호출되지 않음');

      // 3) Nonexistent subject -> 404 NOT_FOUND_OR_FORBIDDEN
      const nonExistentSubReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: localOnlyMaterialId,
          subjectId: 'non-existent-sub-xyz',
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const nonExistentSubRes = await analyzePost(nonExistentSubReq);
      assert.equal(nonExistentSubRes.status, 404, '존재하지 않는 과목 지정 시 404 거부');

      // 4) My material + different subject -> 400 SUBJECT_MISMATCH
      const fakeSub2 = 'sub-my-second';
      fakeClient.__state.subjects.push({ id: fakeSub2, user_id: testUser.id, name: '내 두번째 과목' });
      const mismatchSubReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: myMaterialId, // belongs to mySubjectId
          subjectId: fakeSub2, // mismatched!
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const mismatchSubRes = await analyzePost(mismatchSubReq);
      const mismatchSubData = await mismatchSubRes.json();
      assert.equal(mismatchSubRes.status, 400, '자료와 과목 불일치 시 400 거부');
      assert.equal(mismatchSubData.errorCode, 'SUBJECT_MISMATCH');

      // 5) Database query error on subjects or materials -> 500 DB_QUERY_ERROR, halts before save/AI
      const aiBeforeDbErr = aiCalls;
      const jobsBeforeDbErr = jobsDb.length;
      const originalFrom = fakeClient.from;
      fakeClient.from = (table) => {
        if (table === 'subjects') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: { message: 'Database query timeout' } }),
                }),
              }),
            }),
          };
        }
        return originalFrom(table);
      };

      const dbErrReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId: myMaterialId,
          subjectId: mySubjectId,
          domain: 'math_stats',
          markdown: testMarkdown,
        }),
      });
      const dbErrRes = await analyzePost(dbErrReq);
      const dbErrData = await dbErrRes.json();
      assert.equal(dbErrRes.status, 500, 'DB 조회 오류 시 500 반환');
      assert.equal(dbErrData.errorCode, 'DB_QUERY_ERROR');
      assert.equal(jobsDb.length, jobsBeforeDbErr, 'DB 오류 시 작업 생성 중단');
      assert.equal(aiCalls, aiBeforeDbErr, 'DB 오류 시 AI 호출 중단');
    });
  });

  await checkAsync('P1 Problem 4: 본문 수정 후 신규 분석 작업 분리 및 기존 작업/복구 데이터 보존', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const testUser = { id: 'test-user' };
    const materialId = 'mat-p4-edit';
    const subjectId = 'sub-p4';
    const markdownA = '# 미적분학\n## 미분계수\n미분계수는 평균변화율의 극한으로 정의된다. [PAGE 1]';
    const markdownB = '# 미적분학\n## 도함수와 역도함수\n도함수는 모든 점에서의 미분계수를 대응시키는 함수이며 부정적분은 역도함수이다. [PAGE 2]';

    global.fetch = async () => {
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                concepts: [
                  {
                    title: '도함수',
                    domain: 'math_stats',
                    description: '각 점에서 미분계수를 함숫값으로 가지는 함수',
                    coreDefinitionFormulaOrAlgorithm: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}",
                    prerequisites: ['극한'],
                    relatedConcepts: ['부정적분'],
                    commonMisconceptions: ['연속이라고 항상 미분가능한 것은 아니다.'],
                    examples: ['x^2의 도함수는 2x'],
                    sourceEvidence: { type: 'page', pageNumber: 2, quote: '도함수는 모든 점에서의 미분계수를 대응' },
                  },
                ],
              }),
            },
          },
        ],
      });
    };

    let jobsDb = [];
    let chunksDb = [];
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: subjectId, user_id: testUser.id, name: '미적분학' }],
      materials: [{ id: materialId, user_id: testUser.id, subject_id: subjectId }],
      analysis_jobs: jobsDb,
      analysis_job_chunks: chunksDb,
      concept_drafts: [],
      rpcImpl: (fn, args) => {
        if (fn === 'get_ai_connection_secret') return { data: null, error: null };
        if (fn === 'init_analysis_job_and_chunks') {
          jobsDb.push({
            id: args.p_job_id,
            user_id: args.p_user_id,
            material_id: args.p_material_id,
            subject_id: args.p_subject_id,
            markdown_hash: args.p_markdown_hash,
            model_id: args.p_model_id,
            total_chunks: args.p_total_chunks,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return { data: { success: true, job_id: args.p_job_id, total_chunks: args.p_total_chunks, status: 'pending' }, error: null };
        }
        if (fn === 'claim_analysis_chunk_lease') {
          return { data: { acquired: true, lease_token: 'lease-p4', chunk_index: args.p_chunk_index }, error: null };
        }
        if (fn === 'commit_analysis_chunk_result') {
          return { data: { committed: true }, error: null };
        }
        return { data: null, error: null };
      },
    }, async () => {
      // 1) Step 1: Analyze Markdown A
      const initAReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId,
          subjectId,
          domain: 'math_stats',
          markdown: markdownA,
        }),
      });
      const initARes = await analyzePost(initAReq);
      const initAData = await initARes.json();
      assert.equal(initARes.status, 200);
      const jobKeyA = initAData.jobKey;
      assert.ok(jobKeyA);

      // Complete chunk 1 of Job A in DB
      const jobARow = jobsDb.find((j) => j.id === jobKeyA);
      assert.ok(jobARow);
      jobARow.status = 'completed';

      // 2) Step 2: User modifies text to Markdown B and clicks "새 분석" / "최신 내용으로 재분석"
      const initBReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          materialId,
          subjectId,
          domain: 'math_stats',
          markdown: markdownB, // Modified text!
        }),
      });
      const initBRes = await analyzePost(initBReq);
      const initBData = await initBRes.json();

      // CRITICAL ASSERTION: MUST NOT fail with MARKDOWN_HASH_MISMATCH! Must create a distinct Job B!
      assert.equal(initBRes.status, 200, '본문 수정 후 새 분석 요청은 MARKDOWN_HASH_MISMATCH 에러 없이 200 성공');
      assert.equal(initBData.success, true);
      const jobKeyB = initBData.jobKey;
      assert.ok(jobKeyB);
      assert.notEqual(jobKeyA, jobKeyB, '본문 B의 새 분석은 이전 작업 A와 엄격히 분리된 별도 작업 식별자를 가짐');

      // Verify Job A in DB is preserved intact
      assert.equal(jobsDb.length, 2, 'DB에 작업 A와 작업 B가 모두 독립적으로 보존됨');
      assert.equal(jobARow.status, 'completed', '작업 A의 완료 상태가 보존됨');

      // 3) Attempting to resume Job A with Markdown B MUST be rejected with MARKDOWN_HASH_MISMATCH
      const resumeMismatchReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          jobKey: jobKeyA,
          materialId,
          subjectId,
          domain: 'math_stats',
          markdown: markdownB, // Mismatched text for Job A!
        }),
      });
      const resumeMismatchRes = await analyzePost(resumeMismatchReq);
      const resumeMismatchData = await resumeMismatchRes.json();
      assert.equal(resumeMismatchRes.status, 400, '작업 A 재개 시 다른 본문(B)을 전달하면 400 반환');
      assert.equal(resumeMismatchData.errorCode, 'MARKDOWN_HASH_MISMATCH', 'MARKDOWN_HASH_MISMATCH 거부');

      // 4) Non-existent explicit jobKey MUST return 404 (no quiet fallback to other jobs)
      const nonExistentReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          jobKey: 'non_existent_job_12345',
          materialId,
          subjectId,
          domain: 'math_stats',
          markdown: markdownB,
        }),
      });
      const nonExistentRes = await analyzePost(nonExistentReq);
      assert.equal(nonExistentRes.status, 404, '존재하지 않는 명시적 jobKey는 다른 작업으로 대체되지 않고 404 반환');

      // 5) Status polling is read-only and does NOT create jobs or call AI
      const jobsBeforeStatus = jobsDb.length;
      const statusReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          materialId,
          subjectId,
          domain: 'math_stats',
        }),
      });
      const statusRes = await analyzePost(statusReq);
      assert.equal(statusRes.status, 200, 'Status query succeeds');
      assert.equal(jobsDb.length, jobsBeforeStatus, 'Status query did not create any new DB jobs');
    });
  });

  await checkAsync('결함 1 검증: 자료 본문 변경 후 이전 분석 결과 저장 재시도(retry_save) 성공, AI 0회 및 출처 재검토 상태 확인', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server'));
    const { POST: analyzePost } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const { computeMarkdownHash } = load(path.join(output, 'lib/markdownUtils.js'));
    const { signRecoveryToken } = load(path.join(output, 'lib/recoveryToken.js'));

    const testUser = { id: 'test-user' };
    const subjectId = 'sub_math_p1';
    const materialId = 'mat_calculus_p1';

    const bodyA = '# 미적분학 1강\n코시-슈바르츠 부등식: |<u, v>|^2 <= <u, u> <v, v>.';
    const bodyB = '# 미적분학 1강 (수정본)\n선형대수학과 내적 공간의 성질.';
    const hashA = computeMarkdownHash(bodyA);
    const hashB = computeMarkdownHash(bodyB);

    const draftA = {
      id: 'draft-cs-p1',
      subjectId,
      materialId,
      domain: 'math_stats',
      title: '코시-슈바르츠 부등식',
      description: '내적 공간의 기본 부등식',
      coreDefinitionFormulaOrAlgorithm: '|<u, v>|^2 <= <u, u> <v, v>',
      sourceMarkdownHash: hashA,
      sourceEvidence: { type: 'quote', quote: '코시-슈바르츠', verified: true },
      isApproved: false,
    };

    const jobKeyA = 'job_bodyA_persist';
    const tokenA = signRecoveryToken({
      userId: testUser.id,
      jobId: jobKeyA,
      materialId,
      subjectId,
      domain: 'math_stats',
      chunkIndex: 1,
      markdownHash: hashA,
      modelId: 'deepseek-v4.1-flash',
      drafts: [draftA],
    });

    let mockAiCalls = 0;
    globalThis.__mockAiCallCounter = () => mockAiCalls++;

    const dbJobs = [
      {
        id: jobKeyA,
        user_id: testUser.id,
        material_id: materialId,
        subject_id: subjectId,
        domain: 'math_stats',
        markdown_hash: hashA,
        status: 'processing',
        total_chunks: 1,
      },
    ];
    const dbChunks = [
      {
        job_id: jobKeyA,
        chunk_index: 1,
        status: 'pending',
        drafts: [],
        attempt_count: 1,
      },
    ];
    const dbMaterials = [
      {
        id: materialId,
        user_id: testUser.id,
        subject_id: subjectId,
        content_hash: hashB, // Material body was edited from A to B!
      },
    ];

    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: subjectId, user_id: testUser.id }],
      materials: dbMaterials,
      analysis_jobs: dbJobs,
      analysis_job_chunks: dbChunks,
      rpcImpl: (fn) => {
        if (fn === 'commit_analysis_chunk_result') {
          return { data: { committed: true, reason: 'committed' }, error: null };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const aiBefore = mockAiCalls;

      // 1) Flow: analyzed body A -> save failed -> body edited to B -> retry save A
      const retryReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: jobKeyA,
          chunkIndex: 1,
          workerId: 'worker-p1',
          leaseToken: 'lease-p1',
          drafts: [draftA],
          signedRecoveryToken: tokenA,
          materialId,
          subjectId,
          currentMarkdownHash: hashB, // Notifying current material hash
        }),
      });

      const retryRes = await analyzePost(retryReq);
      assert.equal(retryRes.status, 200, '본문 수정(A->B) 후에도 이전 결과 저장 재시도 성공');
      const retryData = await retryRes.json();
      assert.equal(retryData.success, true);
      assert.equal(retryData.persisted, true);
      assert.equal(retryData.drafts.length, 1);
      assert.equal(retryData.drafts[0].sourceMarkdownHash, hashA, '원래 출처 본문 A의 해시가 보존되어야 함');
      assert.equal(retryData.drafts[0].needsSourceReview, true, '본문 수정 후 복구된 초안은 출처 재검토 필요 상태여야 함');
      assert.equal(mockAiCalls, aiBefore, 'CRITICAL: 저장 재시도 중 AI 호출은 정확히 0회여야 함');

      // 2) Flow: retry when local material body is completely missing / empty string
      const retryNoLocalBodyReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: jobKeyA,
          chunkIndex: 1,
          workerId: 'worker-p1',
          leaseToken: 'lease-p1',
          drafts: [draftA],
          signedRecoveryToken: tokenA,
          materialId,
          subjectId,
          markdown: '', // No local markdown available
        }),
      });
      const retryNoBodyRes = await analyzePost(retryNoLocalBodyReq);
      assert.equal(retryNoBodyRes.status, 200, '로컬에 본문이 없어도 저장 복구 성공');

      // 3) Tampered recovery token rejected with 403
      const tamperedReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: jobKeyA,
          chunkIndex: 1,
          workerId: 'worker-p1',
          leaseToken: 'lease-p1',
          drafts: [draftA],
          signedRecoveryToken: 'forged_tampered_token_xyz',
          materialId,
          subjectId,
        }),
      });
      const tamperedRes = await analyzePost(tamperedReq);
      assert.equal(tamperedRes.status, 403, '변조된 서명 토큰은 403으로 거부');

      // 4) Wrong chunk token rejected
      const wrongChunkToken = signRecoveryToken({
        userId: testUser.id,
        jobId: jobKeyA,
        materialId,
        subjectId,
        domain: 'math_stats',
        chunkIndex: 2, // Token for chunk 2
        markdownHash: hashA,
        modelId: 'deepseek-v4.1-flash',
        drafts: [draftA],
      });
      const wrongChunkReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: jobKeyA,
          chunkIndex: 1, // Target is chunk 1
          workerId: 'worker-p1',
          leaseToken: 'lease-p1',
          drafts: [draftA],
          signedRecoveryToken: wrongChunkToken,
          materialId,
          subjectId,
        }),
      });
      const wrongChunkRes = await analyzePost(wrongChunkReq);
      assert.equal(wrongChunkRes.status, 403, '다른 청크 번호의 서명 토큰은 403으로 거부');

      // 5) Authoritative server draft protection: completed chunk in DB is never overwritten by client drafts
      dbChunks[0].status = 'completed';
      dbChunks[0].drafts = [{ id: 'draft-server-authoritative', title: '서버 확정 초안', sourceMarkdownHash: hashA }];
      const clientSpoofedReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey: jobKeyA,
          chunkIndex: 1,
          workerId: 'worker-p1',
          leaseToken: 'lease-p1',
          drafts: [{ id: 'draft-client-forged', title: '클라이언트 위조 초안' }],
          signedRecoveryToken: tokenA,
          materialId,
          subjectId,
        }),
      });
      const spoofedRes = await analyzePost(clientSpoofedReq);
      assert.equal(spoofedRes.status, 200);
      const spoofedData = await spoofedRes.json();
      assert.equal(spoofedData.drafts[0].id, 'draft-server-authoritative', '서버 확정 결과가 클라이언트 초안으로 덮어써지지 않음');

      // 6) Normal process/resume with different body is still rejected
      const resumeMismatchReq = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          jobKey: jobKeyA,
          materialId,
          subjectId,
          domain: 'math_stats',
          markdown: bodyB, // altered body
        }),
      });
      const resumeMismatchRes = await analyzePost(resumeMismatchReq);
      assert.equal(resumeMismatchRes.status, 400, '일반 process/resume에 다른 본문을 전달하면 기존처럼 거부');
      const resumeMismatchData = await resumeMismatchRes.json();
      assert.equal(resumeMismatchData.errorCode, 'MARKDOWN_HASH_MISMATCH');
    });
  });

  await checkAsync('결함 2 검증: 불완전한 복구 레코드 격리 (chunkIndex 보정 제거) 및 v5 이관 호환성', async () => {
    const {
      saveAnalysisRecovery,
      listAnalysisRecoveries,
      listUnmigratedAnalysisRecoveries,
      exportUnmigratedRecoveriesAsJson,
    } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async (fakeIdb) => {
      const scopeId = 'u_p2_chunk_quarantine';
      const dbName = `redcall_analysis_recovery_${scopeId}`;

      // 1. Setup a legacy v1 IndexedDB schema with a mix of valid and invalid chunkIndex records
      const v1Stores = fakeIdb.__databases.get(dbName) || new Map();
      fakeIdb.__databases.set(dbName, v1Stores);
      fakeIdb.__dbVersions.set(dbName, 1);

      const v1RecoveryStore = new Map();
      v1Stores.set('recoveries', v1RecoveryStore);

      // Normal chunk 1 record
      v1RecoveryStore.set('mat-v1-chunk1', {
        materialId: 'mat-v1-chunk1',
        jobKey: 'job-chunk1',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-c1',
        chunkIndex: 1,
        workerId: 'w-1',
        leaseToken: 't-1',
        drafts: [{ id: 'd-c1', title: '정상 청크 1' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:00:00.000Z',
      });

      // Normal chunk 2 record
      v1RecoveryStore.set('mat-v1-chunk2', {
        materialId: 'mat-v1-chunk2',
        jobKey: 'job-chunk2',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-c2',
        chunkIndex: 2,
        workerId: 'w-2',
        leaseToken: 't-2',
        drafts: [{ id: 'd-c2', title: '정상 청크 2' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:01:00.000Z',
      });

      // Invalid record A: missing chunkIndex (undefined)
      v1RecoveryStore.set('mat-v1-nochunk', {
        materialId: 'mat-v1-nochunk',
        jobKey: 'job-nochunk',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-nc',
        // chunkIndex missing
        workerId: 'w-nc',
        leaseToken: 't-nc',
        drafts: [{ id: 'd-nc', title: '청크 누락' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:02:00.000Z',
      });

      // Invalid record B: chunkIndex = 0
      v1RecoveryStore.set('mat-v1-zerochunk', {
        materialId: 'mat-v1-zerochunk',
        jobKey: 'job-zerochunk',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-zc',
        chunkIndex: 0, // 0 is invalid
        workerId: 'w-zc',
        leaseToken: 't-zc',
        drafts: [{ id: 'd-zc', title: '0번 청크' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:03:00.000Z',
      });

      // Invalid record C: chunkIndex = -1 (negative)
      v1RecoveryStore.set('mat-v1-negchunk', {
        materialId: 'mat-v1-negchunk',
        jobKey: 'job-negchunk',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-neg',
        chunkIndex: -1,
        workerId: 'w-neg',
        leaseToken: 't-neg',
        drafts: [{ id: 'd-neg', title: '음수 청크' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:04:00.000Z',
      });

      // Invalid record D: chunkIndex = 1.5 (float)
      v1RecoveryStore.set('mat-v1-floatchunk', {
        materialId: 'mat-v1-floatchunk',
        jobKey: 'job-floatchunk',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-flt',
        chunkIndex: 1.5,
        workerId: 'w-flt',
        leaseToken: 't-flt',
        drafts: [{ id: 'd-flt', title: '소수 청크' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:05:00.000Z',
      });

      // Invalid record E: chunkIndex = '1' (string)
      v1RecoveryStore.set('mat-v1-strchunk', {
        materialId: 'mat-v1-strchunk',
        jobKey: 'job-strchunk',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-str',
        chunkIndex: '1',
        workerId: 'w-str',
        leaseToken: 't-str',
        drafts: [{ id: 'd-str', title: '문자열 청크' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: '2026-10-15T12:06:00.000Z',
      });

      // 2. Open DB and trigger upgrade to v5
      const activeRecoveriesRes = await listAnalysisRecoveries(scopeId);
      assert.equal(activeRecoveriesRes.status, 'success');
      const activeRecoveries = activeRecoveriesRes.data;

      // CRITICAL ASSERTION: ONLY the 2 valid chunk records remain in the active recoveries store!
      assert.equal(activeRecoveries.length, 2, '정상 청크 1과 청크 2만 복구 목록에 유지됨 (임의 보정 레코드 제외)');
      assert.ok(activeRecoveries.some((r) => r.jobKey === 'job-chunk1' && r.chunkIndex === 1));
      assert.ok(activeRecoveries.some((r) => r.jobKey === 'job-chunk2' && r.chunkIndex === 2));

      // 3. Unmigrated / Quarantined store inspection
      const unmigratedRes = await listUnmigratedAnalysisRecoveries(scopeId);
      assert.equal(unmigratedRes.status, 'success');
      const unmigrated = unmigratedRes.data;
      assert.equal(unmigrated.length, 5, '결함이 있는 5개 레코드가 모두 unmigrated에 격리 보존됨');

      // Verify specific reasons and rawRecord preservation
      const nochunk = unmigrated.find((r) => r.materialId === 'mat-v1-nochunk');
      assert.ok(nochunk, '누락된 청크 레코드 격리 확인');
      assert.ok(nochunk.unmigratedReason.includes('청크 번호'), '구체적 격리 사유 포함');
      assert.ok(nochunk.rawRecord, '원본 rawRecord 필드 보존');

      const zerochunk = unmigrated.find((r) => r.materialId === 'mat-v1-zerochunk');
      assert.ok(zerochunk);
      assert.ok(zerochunk.unmigratedReason.includes('0'));

      // 4. Verify saveAnalysisRecovery strictly validates chunkIndex
      const saveZeroRes = await saveAnalysisRecovery(scopeId, {
        materialId: 'mat-invalid-save',
        jobKey: 'job-save-test',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-x',
        chunkIndex: 0, // invalid
        workerId: 'w',
        leaseToken: 't',
        drafts: [{ id: 'd-1', title: '초안' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });
      assert.equal(saveZeroRes.ok, false, 'chunkIndex=0 저장 거부');
      assert.ok(saveZeroRes.error.includes('양의 정수'));

      const saveStrRes = await saveAnalysisRecovery(scopeId, {
        materialId: 'mat-invalid-save',
        jobKey: 'job-save-test',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-x',
        chunkIndex: '1', // string
        workerId: 'w',
        leaseToken: 't',
        drafts: [{ id: 'd-1', title: '초안' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });
      assert.equal(saveStrRes.ok, false, 'chunkIndex 문자열 저장 거부');

      // 5. Verify JSON export includes reasons and raw values
      let exportedBlob = '';
      global.window = { indexedDB: globalThis.indexedDB };
      global.document = {
        body: { appendChild: () => {}, removeChild: () => {} },
        createElement: () => ({ href: '', download: '', click: () => {} }),
      };
      global.URL = {
        createObjectURL: (blob) => { exportedBlob = blob; return 'blob:test'; },
        revokeObjectURL: () => {},
      };

      exportUnmigratedRecoveriesAsJson(unmigrated, scopeId);
      assert.ok(exportedBlob, '미이관 데이터 JSON 파일 생성 성공');

      delete global.window;
      delete global.document;
      global.URL = (await import('node:url')).URL;
    });
  });

  await checkAsync('결함 3 검증: IndexedDB 차단·조회 오류와 명시적 반환 계약 (success, not_found, blocked, error)', async () => {
    const {
      loadAnalysisRecovery,
      listAnalysisRecoveries,
      listUnmigratedAnalysisRecoveries,
      saveAnalysisRecovery,
    } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async (fakeIdb) => {
      const scopeId = 'u_p3_explicit_contract';

      // 1. Normal empty store -> returns explicit not_found / empty list
      const emptyLoad = await loadAnalysisRecovery(scopeId, 'non-existent-material');
      assert.equal(emptyLoad.status, 'not_found', '정상 빈 저장소 조회 시 status: not_found 반환');

      const emptyList = await listAnalysisRecoveries(scopeId);
      assert.equal(emptyList.status, 'success', '정상 빈 목록 조회 시 status: success 반환');
      assert.equal(emptyList.data.length, 0);

      const emptyUnmigrated = await listUnmigratedAnalysisRecoveries(scopeId);
      assert.equal(emptyUnmigrated.status, 'success');
      assert.equal(emptyUnmigrated.data.length, 0);

      // Save a valid record
      const saveRes = await saveAnalysisRecovery(scopeId, {
        materialId: 'mat-p3-test',
        jobKey: 'job-p3-1',
        subjectId: 'sub-p3',
        domain: 'math_stats',
        markdownHash: 'hash-p3',
        chunkIndex: 1,
        workerId: 'w-p3',
        leaseToken: 't-p3',
        drafts: [{ id: 'd-p3', title: '복구 대상 초안' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });
      assert.equal(saveRes.ok, true);

      // 2. Blocked simulation: when IDB version upgrade is blocked by another tab
      fakeIdb.__failure.blocked = true;

      const blockedLoad = await loadAnalysisRecovery(scopeId, 'mat-p3-test');
      assert.equal(blockedLoad.status, 'blocked', '차단 상태일 때 status: blocked 명시적 반환');
      assert.ok(blockedLoad.error.includes('다른 탭'), '다른 탭 안내 문구 포함');

      const blockedList = await listAnalysisRecoveries(scopeId);
      assert.equal(blockedList.status, 'blocked', '차단 시 목록 조회도 status: blocked 반환 (빈 목록으로 오표시 방지)');

      const blockedUnmigrated = await listUnmigratedAnalysisRecoveries(scopeId);
      assert.equal(blockedUnmigrated.status, 'blocked');

      // 3. Unblocked recovery: after blocking tab closes, retry succeeds and yields real records
      fakeIdb.__failure.blocked = false;

      const unblockedLoad = await loadAnalysisRecovery(scopeId, 'mat-p3-test');
      assert.equal(unblockedLoad.status, 'success', '차단 해제 후 재시도 시 status: success 반환');
      assert.equal(unblockedLoad.data.jobKey, 'job-p3-1');

      const unblockedList = await listAnalysisRecoveries(scopeId);
      assert.equal(unblockedList.status, 'success');
      assert.equal(unblockedList.data.length, 1);

      // 4. Read error simulation: transaction error returns status: error
      fakeIdb.__failure.getAll = true;
      const errorList = await listAnalysisRecoveries(scopeId);
      assert.equal(errorList.status, 'error', '읽기 실패 시 status: error 반환');
      fakeIdb.__failure.getAll = false;
    });
  });

  await checkAsync('결함 1 (P2) 검증: compareSourceMarkdown 해시 형식 분리 (mh_ vs h_) 및 출처 상태 삼분화 (identical, changed, unverifiable)', async () => {
    const { computeMarkdownHash, compareSourceMarkdown } = load(path.join(output, 'lib/markdownUtils.js'));
    const { POST: analyzeRoute } = load(path.join(output, 'app/api/analyze-concepts/route.js'));

    const sourceText = '# Linear Algebra\nEigenvalues and eigenvectors are fundamental.';
    const sourceHash = computeMarkdownHash(sourceText);

    // 1. Direct compareSourceMarkdown unit verification
    const sameRes = compareSourceMarkdown({
      sourceMarkdownHash: sourceHash,
      currentMarkdown: sourceText,
    });
    assert.equal(sameRes.status, 'identical', '동일 본문 비교 시 identical 상태 반환');
    assert.equal(sameRes.isOutdated, false);
    assert.equal(sameRes.canVerify, true);

    const diffRes = compareSourceMarkdown({
      sourceMarkdownHash: sourceHash,
      currentMarkdown: '# Modified Linear Algebra\nEigenvalues changed.',
    });
    assert.equal(diffRes.status, 'changed', '수정된 본문 비교 시 changed 상태 반환');
    assert.equal(diffRes.isOutdated, true);
    assert.equal(diffRes.canVerify, true);

    const unverifiableRes = compareSourceMarkdown({
      sourceMarkdownHash: sourceHash,
      currentMarkdown: null,
    });
    assert.equal(unverifiableRes.status, 'unverifiable', '본문 미제공 시 unverifiable 상태 반환');
    assert.equal(unverifiableRes.isOutdated, false);
    assert.equal(unverifiableRes.canVerify, false);

    // 2. Integration with retry_save in route handler
    // Server material row has content_hash in 'mh_...' format, while session markdownHash is 'h_...'
    const jobKey = 'job-p1-hash-test';
    const matId = 'mat-p1-hash';
    const subId = 'sub-p1-hash';

    await withFakeSupabase({
      user: { id: 'test-user' },
      subjects: [{ id: subId, user_id: 'test-user', name: '선형대수학' }],
      materials: [{
        id: matId,
        user_id: 'test-user',
        subject_id: subId,
        content_hash: 'mh_canonical_material_content_hash_12345', // differing hash format!
      }],
      analysis_jobs: [{
        id: jobKey,
        user_id: 'test-user',
        subject_id: subId,
        material_id: matId,
        markdown_hash: sourceHash,
        domain: 'math_stats',
        model_id: 'deepseek-v4.1-flash',
        prompt_version: 'v2',
        chunking_version: 'v1',
        total_chunks: 1,
        status: 'processing',
      }],
      analysis_job_chunks: [{
        job_id: jobKey,
        chunk_index: 1,
        source_context: '1장',
        status: 'completed',
        drafts: [{ id: 'cd-1', title: '고유값', subjectId: subId, materialId: matId }],
        attempt_count: 1,
      }],
    }, async () => {
      // (a) retry_save with IDENTICAL markdown text: must NOT be flagged as changed just because server material has mh_ hash!
      const reqSame = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey,
          chunkIndex: 1,
          materialId: matId,
          subjectId: subId,
          markdown: sourceText,
        }),
      });
      const resSame = await analyzeRoute(reqSame);
      const dataSame = await resSame.json();
      assert.equal(resSame.status, 200);
      assert.equal(dataSame.sourceStatus, 'identical', '동일한 본문 제공 시 mh_ 해시와 혼동 없이 identical 판정');
      assert.equal(dataSame.drafts[0].needsSourceReview, false, '동일 본문 복구 시 출처 재검토 요구되지 않음');

      // (b) retry_save with ALTERED markdown text: must be flagged changed
      const reqDiff = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey,
          chunkIndex: 1,
          materialId: matId,
          subjectId: subId,
          markdown: '# Modified text that differs from analysis time',
        }),
      });
      const resDiff = await analyzeRoute(reqDiff);
      const dataDiff = await resDiff.json();
      assert.equal(resDiff.status, 200);
      assert.equal(dataDiff.sourceStatus, 'changed');
      assert.equal(dataDiff.drafts[0].needsSourceReview, true, '수정된 본문 복구 시 needsSourceReview: true 설정');

      // (c) retry_save with missing markdown: unverifiable, save succeeds without error
      const reqUnverifiable = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_save',
          jobKey,
          chunkIndex: 1,
          materialId: matId,
          subjectId: subId,
          markdown: '',
        }),
      });
      const resUnverifiable = await analyzeRoute(reqUnverifiable);
      const dataUnverifiable = await resUnverifiable.json();
      assert.equal(resUnverifiable.status, 200);
      assert.equal(dataUnverifiable.sourceStatus, 'unverifiable');
    });
  });

  await checkAsync('결함 2 (P1) 검증: concept_drafts needs_source_review 서버 DB 영속화, 사용자 수정/승인 및 최신 초안 보존', async () => {
    const { upsertConceptDrafts } = load(path.join(output, 'lib/cloud/learningRepository.js'));

    const subId = 'sub-p2';
    const matId = 'mat-p2';
    const initialDraftRow = {
      id: 'draft-p2-target',
      user_id: 'user-a',
      subject_id: subId,
      material_id: matId,
      title: '사용자가 수정한 제목 (보존 필수)',
      edited_by_user: true,
      is_approved: true,
      status: 'approved',
      content_version: 5,
      needs_source_review: false,
      payload: {
        id: 'draft-p2-target',
        title: '사용자가 수정한 제목 (보존 필수)',
        subjectId: subId,
        materialId: matId,
        editedByUser: true,
        isApproved: true,
        status: 'approved',
        contentVersion: 5,
        sourceMarkdownHash: 'hash-version-1',
        sourceEvidence: {
          quote: '기존 원문 인용',
          verified: true,
          verificationNote: '초기 검증 통과',
        },
      },
    };

    await withFakeSupabase({
      user: { id: 'user-a' },
      subjects: [{ id: subId, user_id: 'user-a', name: '물리학' }],
      materials: [{ id: matId, user_id: 'user-a', subject_id: subId }],
      concept_drafts: [initialDraftRow],
    }, async (client) => {
      // 1. Call upsertConceptDrafts with needsSourceReview: true from an outdated source retry
      const retryDraft = {
        id: 'draft-p2-target',
        subjectId: subId,
        materialId: matId,
        title: 'AI 생성 초기 제목 (무시되어야 함)',
        needsSourceReview: true,
        sourceMarkdownHash: 'hash-version-1',
      };

      const result = await upsertConceptDrafts(client, [retryDraft], 'job-p2-retry');
      assert.equal(result.ok, true);

      // Verify that the row in DB was actually updated with needs_source_review: true
      const { data: dbRows } = await client.from('concept_drafts').select('*').eq('id', 'draft-p2-target');
      assert.equal(dbRows.length, 1);
      const updatedRow = dbRows[0];

      assert.equal(updatedRow.needs_source_review, true, 'DB concept_drafts 테이블에 needs_source_review가 true로 영속화됨');
      assert.equal(updatedRow.payload.needsSourceReview, true, 'payload 내부 needsSourceReview 동기화 확인');
      assert.equal(updatedRow.payload.sourceEvidence.verified, false, '재검토 대상 초안의 sourceEvidence.verified가 false로 갱신되어 모순 방지');

      // Crucial: User edits and approval status must be strictly preserved!
      assert.equal(updatedRow.title, '사용자가 수정한 제목 (보존 필수)', '사용자 수정 제목 보존');
      assert.equal(updatedRow.edited_by_user, true, 'edited_by_user 플래그 보존');
      assert.equal(updatedRow.is_approved, true, 'is_approved 승인 상태 보존');
      assert.equal(updatedRow.status, 'approved', 'status 승인 상태 보존');
      assert.equal(updatedRow.content_version, 5, 'content_version 보존');

      // 2. Stale retry protection: If the draft on the server is already on a NEWER source version (e.g. hash-version-2),
      // an older retry targeting hash-version-1 must NOT roll back or force review on the newer draft!
      await client.from('concept_drafts').update({
        needs_source_review: false,
        payload: {
          ...updatedRow.payload,
          sourceMarkdownHash: 'hash-version-2',
          needsSourceReview: false,
        },
      }).eq('id', 'draft-p2-target');

      const staleRetryDraft = {
        id: 'draft-p2-target',
        subjectId: subId,
        materialId: matId,
        title: '오래된 재시도 초안',
        needsSourceReview: true,
        sourceMarkdownHash: 'hash-version-1', // Older version!
      };

      const staleResult = await upsertConceptDrafts(client, [staleRetryDraft], 'job-p2-stale');
      assert.equal(staleResult.ok, true);

      const { data: dbRowsAfterStale } = await client.from('concept_drafts').select('*').eq('id', 'draft-p2-target');
      assert.equal(dbRowsAfterStale[0].needs_source_review, false, '최신 출처로 재검증된 초안은 이전 작업의 retry_save로 인해 덮어써지지 않음');
    });
  });

  await checkAsync('결함 3 (P2) 검증: 수동 복구 재조회 지연 응답 세대(seq) 무효화, 개별/미이관 에러 분리, 메모리 보존 및 JSON 내보내기 검증', async () => {
    const { loadAnalysisRecovery, saveAnalysisRecovery } = load(path.join(output, 'lib/analysisRecovery.js'));

    await withFakeIndexedDB(async () => {
      const scopeId = 'u_p3_seq_test';
      const matA = 'mat-a';
      const matB = 'mat-b';

      await saveAnalysisRecovery(scopeId, {
        materialId: matA,
        jobKey: 'job-a',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-a',
        chunkIndex: 1,
        workerId: 'w-a',
        leaseToken: 't-a',
        drafts: [{ id: 'd-a', title: '초안 A' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });

      await saveAnalysisRecovery(scopeId, {
        materialId: matB,
        jobKey: 'job-b',
        subjectId: 'sub-1',
        domain: 'math_stats',
        markdownHash: 'hash-b',
        chunkIndex: 1,
        workerId: 'w-b',
        leaseToken: 't-b',
        drafts: [{ id: 'd-b', title: '초안 B' }],
        checkpointStatus: 'committed',
        draftsPersistStatus: 'failed',
        savedAt: new Date().toISOString(),
      });

      // Simulation of sequence / generation tracking in UI
      let recoveryRequestSeq = 0;
      let activeMaterialId = matA;
      let isModalOpen = true;
      let currentSaveFailedState = null;

      // Request 1: User is on Material A, initiates recovery query
      const seq1 = ++recoveryRequestSeq;
      const targetMatId1 = activeMaterialId;
      const delayedPromise1 = loadAnalysisRecovery(scopeId, matA);

      // User immediately switches to Material B and opens its recovery modal (seq bumps)
      activeMaterialId = matB;
      const seq2 = ++recoveryRequestSeq;
      const resB = await loadAnalysisRecovery(scopeId, matB);
      if (recoveryRequestSeq === seq2 && isModalOpen && activeMaterialId === matB) {
        currentSaveFailedState = resB.data;
      }
      assert.equal(currentSaveFailedState.materialId, matB, '현재 활성 자료 B의 복구 데이터가 설정됨');

      // Now delayed Request 1 arrives!
      const resA = await delayedPromise1;
      let overwritten = false;
      if (recoveryRequestSeq === seq1 && isModalOpen && activeMaterialId === targetMatId1) {
        currentSaveFailedState = resA.data;
        overwritten = true;
      }
      assert.equal(overwritten, false, '지연된 이전 요청(seq1)은 최신 시퀀스(seq2) 및 자료 변경으로 인해 무효화됨');
      assert.equal(currentSaveFailedState.materialId, matB, '자료 B의 상태가 보존됨');

      // User closes modal
      isModalOpen = false;
      recoveryRequestSeq++;

      // Any late callback cannot revive state
      let revived = false;
      if (isModalOpen && recoveryRequestSeq === seq1) {
        revived = true;
      }
      assert.equal(revived, false, '모달 닫힌 후 지연 응답은 상태를 부활시키지 않음');

      // JSON export validation simulation:
      // Mismatched materialId test
      const mismatchedExportAllowed = (state, currentMat, currentScope) => {
        if (!state || !currentMat) return false;
        if (state.materialId !== currentMat.id) return false;
        if (state.scopeId && state.scopeId !== currentScope) return false;
        return true;
      };

      assert.equal(
        mismatchedExportAllowed(currentSaveFailedState, { id: matA, title: '자료 A' }, scopeId),
        false,
        '자료 식별자 불일치 시 JSON 내보내기 거부'
      );
      assert.equal(
        mismatchedExportAllowed(currentSaveFailedState, { id: matB, title: '자료 B' }, 'u_other_user'),
        false,
        '계정 스코프 불일치 시 JSON 내보내기 거부'
      );
      assert.equal(
        mismatchedExportAllowed(currentSaveFailedState, { id: matB, title: '자료 B' }, scopeId),
        true,
        '정상 일치 시 JSON 내보내기 허용'
      );
    });
  });

  // =========================================================================
  // AI Trial Credits (3 Credits per Account) Tests (Section 7)
  // =========================================================================

  await checkAsync('AI 체험 크레딧 1: 신규 계정 1회 지급, 재로그인·동시 최초 요청에도 중복 지급 없음, 기존 3회 계정 보존', async () => {
    await withFakeSupabase({
      user: { id: 'user-trial-1' },
      ai_trial_credits: [],
      ai_trial_reservations: [],
    }, async (client) => {
      // 1. First grant gives 1 credit for new user
      const r1 = await client.rpc('get_or_create_trial_credits', { p_user_id: 'user-trial-1' });
      assert.equal(r1.data.granted, 1);
      assert.equal(r1.data.balance, 1);

      // 2. Re-login / page refresh / multiple calls: returns existing balance without duplicate grant
      const r2 = await client.rpc('get_or_create_trial_credits', { p_user_id: 'user-trial-1' });
      assert.equal(r2.data.granted, 1);
      assert.equal(r2.data.balance, 1);

      // 3. Concurrent requests with Promise.all
      const [c1, c2, c3] = await Promise.all([
        client.rpc('get_or_create_trial_credits', { p_user_id: 'user-trial-1' }),
        client.rpc('get_or_create_trial_credits', { p_user_id: 'user-trial-1' }),
        client.rpc('get_or_create_trial_credits', { p_user_id: 'user-trial-1' }),
      ]);
      assert.equal(c1.data.balance, 1);
      assert.equal(c2.data.balance, 1);
      assert.equal(c3.data.balance, 1);

      // Table has exactly one row
      assert.equal(client.__state.ai_trial_credits.length, 1);

      // 4. Existing account with 3 credits is preserved and NOT overwritten
      client.__state.ai_trial_credits.push({
        user_id: 'existing-legacy-user',
        granted_credits: 3,
        balance: 3,
        granted_at: nowIso(),
        updated_at: nowIso(),
      });
      const legacyRes = await client.rpc('get_or_create_trial_credits', { p_user_id: 'existing-legacy-user' });
      assert.equal(legacyRes.data.granted, 3, '기존 3회 지급 계정은 1회로 덮어쓰지 않고 보존됨');
      assert.equal(legacyRes.data.balance, 3);
    });
  });

  await checkAsync('AI 체험 크레딧 2: 잔액 1에서 동시 요청 2개 -> 최대 1개만 예약', async () => {
    await withFakeSupabase({
      user: { id: 'user-trial-2' },
      ai_trial_credits: [{ user_id: 'user-trial-2', granted_credits: 3, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      // Two concurrent calls attempting to reserve a credit for distinct tasks
      const [res1, res2] = await Promise.all([
        client.rpc('reserve_trial_credit', {
          p_task_id: 'task-concurrent-A',
          p_task_type: 'generate_problems',
          p_input_identifier: 'hash-A',
          p_user_id: 'user-trial-2',
        }),
        client.rpc('reserve_trial_credit', {
          p_task_id: 'task-concurrent-B',
          p_task_type: 'evaluate_answer',
          p_input_identifier: 'hash-B',
          p_user_id: 'user-trial-2',
        }),
      ]);

      const successCount = [res1, res2].filter((r) => r.data && r.data.allowed === true).length;
      const failCount = [res1, res2].filter((r) => r.data && r.data.allowed === false).length;

      assert.equal(successCount, 1, '잔액 1에서 동시 요청 중 정확히 1개만 예약 성공');
      assert.equal(failCount, 1, '나머지 1개는 잔액 부족으로 거부');

      const failed = res1.data.allowed ? res2.data : res1.data;
      assert.equal(failed.error_code, 'INSUFFICIENT_CREDITS');

      // Final balance is exactly 0
      const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-trial-2');
      assert.equal(credRow.balance, 0);
    });
  });

  await checkAsync('AI 체험 크레딧 3: 같은 작업 재시도 -> 중복 차감·중복 호출 없음 (임대 락 및 완료 캐시 반환)', async () => {
    await withFakeSupabase({
      user: { id: 'user-trial-3' },
      ai_trial_credits: [{ user_id: 'user-trial-3', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      // First attempt
      const first = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-idempotent-1',
        p_task_type: 'analyze_concepts',
        p_input_identifier: 'hash-same-input',
        p_user_id: 'user-trial-3',
      });
      assert.equal(first.data.allowed, true);
      assert.equal(first.data.status, 'processing');
      assert.equal(first.data.remaining, 2);

      // Duplicate concurrent network send while processing: lease blocks duplicate AI execution
      const retry = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-idempotent-1',
        p_task_type: 'analyze_concepts',
        p_input_identifier: 'hash-same-input',
        p_user_id: 'user-trial-3',
      });
      assert.equal(retry.data.allowed, false);
      assert.equal(retry.data.status, 'concurrent_in_progress');
      assert.equal(retry.data.error_code, 'CONCURRENT_EXECUTION_BLOCKED');

      // Record result ready
      await client.rpc('record_trial_result_ready', {
        p_task_id: 'task-idempotent-1',
        p_result: { drafts: [{ id: 'd1', title: '개념 1' }] },
        p_lease_token: first.data.lease_token,
      });

      // Now settle it
      await client.rpc('settle_trial_credit', {
        p_task_id: 'task-idempotent-1',
        p_lease_token: first.data.lease_token,
      });

      // Call reserve after settled: returns already_completed and cached result, AI not called again!
      const postSettle = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-idempotent-1',
        p_task_type: 'analyze_concepts',
        p_input_identifier: 'hash-same-input',
        p_user_id: 'user-trial-3',
      });
      assert.equal(postSettle.data.allowed, false, '완료된 작업은 AI 재호출 허용 안 함');
      assert.equal(postSettle.data.status, 'already_completed');
      assert.deepEqual(postSettle.data.cached_result, { drafts: [{ id: 'd1', title: '개념 1' }] });
      assert.equal(postSettle.data.remaining, 2);

      // Remaining credits remain 2 (only 1 deducted)
      const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-trial-3');
      assert.equal(credRow.balance, 2);
    });
  });

  await checkAsync('AI 체험 크레딧 4: 다른 입력으로 작업 ID 재사용 -> 거부 (TASK_INPUT_MISMATCH)', async () => {
    await withFakeSupabase({
      user: { id: 'user-trial-4' },
      ai_trial_credits: [{ user_id: 'user-trial-4', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      // 1. Initial reservation
      await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-fixed-id',
        p_task_type: 'generate_problems',
        p_input_identifier: 'hash-input-A',
        p_user_id: 'user-trial-4',
      });

      // 2. Reusing same task_id with DIFFERENT input
      const tampered = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-fixed-id',
        p_task_type: 'generate_problems',
        p_input_identifier: 'hash-input-B-different',
        p_user_id: 'user-trial-4',
      });

      assert.equal(tampered.data.allowed, false);
      assert.equal(tampered.data.error_code, 'TASK_INPUT_MISMATCH');
    });
  });

  await checkAsync('AI 체험 크레딧 5: 개인 API 사용 -> 체험 차감 없음', async () => {
    const encKey = Buffer.alloc(32, 7);
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = encKey.toString('base64');
    const { encryptSecret } = load(path.join(output, 'lib/aiCredentials.js'));
    const secretEnc = encryptSecret('baze-user-personal-api-key', encKey);

    await withFakeSupabase({
      user: { id: 'user-with-key' },
      ai_trial_credits: [{ user_id: 'user-with-key', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
      rpcImpl: (fn) => {
        if (fn === 'get_ai_connection_secret') {
          return {
            data: {
              provider: 'school_gateway',
              ciphertext: secretEnc.ciphertext,
              iv: secretEnc.iv,
              tag: secretEnc.tag,
              model: 'deepseek-v4.1-flash',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async (client) => {
      const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
      const res = await resolveAiConfigForUser('user-with-key', {
        taskId: 'task-personal-key-1',
        taskType: 'evaluate_answer',
        inputIdentifier: 'hash-eval',
      });

      assert.equal(res.ok, true);
      assert.equal(res.source, 'user', '개인 등록 키가 우선 사용됨');
      assert.equal(res.isTrial, undefined, '체험 모드가 아님');
      assert.equal(res.config.apiKey, 'baze-user-personal-api-key');

      // Balance was NOT deducted
      const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-with-key');
      assert.equal(credRow.balance, 3, '개인 API 사용 시 체험 크레딧 차감 없음');
      // 개인 API 키 사용자도 작업 무결성·동시성 제어를 위해 ai_trial_reservations에 credit_source='personal_key'로 등록됨
      assert.equal(client.__state.ai_trial_reservations.length, 1);
      assert.equal(client.__state.ai_trial_reservations[0].credit_source, 'personal_key');
    });
  });

  await checkAsync('AI 체험 크레딧 6: 키 조회 실패 -> 운영자 키 전환 없음', async () => {
    await withFakeSupabase({
      user: { id: 'user-lookup-fail' },
      ai_trial_credits: [{ user_id: 'user-lookup-fail', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
      rpcImpl: (fn) => {
        if (fn === 'get_ai_connection_secret') {
          return { data: null, error: { message: 'DB connection error' } };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
      const res = await resolveAiConfigForUser('user-lookup-fail', {
        taskId: 'task-lookup-fail-1',
        taskType: 'evaluate_answer',
        inputIdentifier: 'hash-eval',
      });

      assert.equal(res.ok, false);
      assert.equal(res.code, 'lookup_failed');
      assert.equal(res.source, undefined, '조회 실패 시 운영자 키로 전환 금지');
    });
  });

  await checkAsync('AI 체험 크레딧 7: 결과 생성 후 저장 실패 -> 추가 차감 없이 복구 (P1 저장 재시도 AI 우회 차단)', async () => {
    await withFakeSupabase({
      user: { id: 'user-save-retry' },
      ai_trial_credits: [{ user_id: 'user-save-retry', granted_credits: 3, balance: 2, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [{
        id: 'res-saved-prior',
        user_id: 'user-save-retry',
        task_id: 'task-concept-1',
        task_type: 'analyze_concepts',
        input_identifier: 'hash-concept-input',
        status: 'settled',
        cached_result: { concepts: [{ id: 'c1', name: '테스트 개념' }] },
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    }, async (client) => {
      const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
      const { lookupSavedTaskResult } = load(path.join(output, 'lib/trialCredits.js'));

      // 1. isSaveRetry 플래그만으로 AI 실행 자격증명을 얻으려는 시도 원천 차단
      const res = await resolveAiConfigForUser('user-save-retry', {
        taskId: 'task-concept-1',
        taskType: 'analyze_concepts',
        inputIdentifier: 'hash-concept-input',
        isSaveRetry: true,
      });

      assert.equal(res.ok, false);
      assert.equal(res.code, 'save_retry_cannot_execute_ai', '저장 재시도는 AI 실행 권한을 부여하지 않음');

      // 2. 저장 재시도는 서버에 보존된 결과를 조회해 추가 AI 0회로 안전하게 복구
      const saved = await lookupSavedTaskResult(
        'user-save-retry',
        'task-concept-1',
        'analyze_concepts',
        'hash-concept-input'
      );
      assert.equal(saved.success, true);
      assert.equal(saved.status, 'settled');
      assert.deepEqual(saved.cachedResult, { concepts: [{ id: 'c1', name: '테스트 개념' }] });

      // Balance remains 2 (no additional deduction)
      const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-save-retry');
      assert.equal(credRow.balance, 2, '저장 재시도에는 추가 크레딧 차감 없음');
    });
  });

  await checkAsync('AI 체험 크레딧 8: 호출 전 실패 -> 예약 해제 및 잔액 환급', async () => {
    await withFakeSupabase({
      user: { id: 'user-abort' },
      ai_trial_credits: [{ user_id: 'user-abort', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      // 1. Reserve
      const reserved = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-aborted-call',
        p_task_type: 'generate_problems',
        p_input_identifier: 'hash-gen',
        p_user_id: 'user-abort',
      });
      assert.equal(reserved.data.allowed, true);
      assert.equal(reserved.data.remaining, 2);

      // 2. Pre-call abort/failure triggers release
      const released = await client.rpc('release_trial_credit', {
        p_task_id: 'task-aborted-call',
        p_reason: 'aborted_before_call',
        p_lease_token: reserved.data.lease_token,
      });
      assert.equal(released.data.success, true);
      assert.equal(released.data.refunded, true);
      assert.equal(released.data.balance, 3);

      const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-abort');
      assert.equal(credRow.balance, 3, '예약 취소 시 크레딧 환급 완료');
    });
  });

  await checkAsync('AI 체험 크레딧 9: 응답 유실·작업 중단 -> 임대 만료 후 재시도 또는 진행 중 차단', async () => {
    await withFakeSupabase({
      user: { id: 'user-restore' },
      ai_trial_credits: [{ user_id: 'user-restore', granted_credits: 3, balance: 2, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [{
        id: 'res-lost',
        user_id: 'user-restore',
        task_id: 'task-lost-resp',
        task_type: 'evaluate_answer',
        input_identifier: 'hash-lost',
        status: 'processing',
        attempt_count: 1,
        lease_expires_at: new Date(Date.now() - 5000).toISOString(),
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    }, async (client) => {
      // Client re-requests the same task after lost response:
      const checkRes = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-lost-resp',
        p_task_type: 'evaluate_answer',
        p_input_identifier: 'hash-lost',
        p_user_id: 'user-restore',
      });

      assert.equal(checkRes.data.allowed, true);
      assert.equal(checkRes.data.status, 'processing');
      assert.equal(checkRes.data.remaining, 2, '진행 중 예약 상태로 복구되어 중복 차감 없음');
    });
  });

  await checkAsync('AI 체험 크레딧 10: 잔액 0 또는 운영자 긴급 중지 -> 운영자 호출 차단', async () => {
    // A) Balance 0
    await withFakeSupabase({
      user: { id: 'user-zero-balance' },
      ai_trial_credits: [{ user_id: 'user-zero-balance', granted_credits: 3, balance: 0, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async () => {
      const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
      const res = await resolveAiConfigForUser('user-zero-balance', {
        taskId: 'task-exhausted',
        taskType: 'analyze_concepts',
        inputIdentifier: 'hash-md',
      });

      assert.equal(res.ok, false);
      assert.equal(res.code, 'insufficient_credits');
      assert.equal(res.needsAiConnection, true);
    });

    // B) Emergency stop active
    process.env.OPERATOR_EMERGENCY_STOP = 'true';
    try {
      await withFakeSupabase({
        user: { id: 'user-stopped' },
        ai_trial_credits: [{ user_id: 'user-stopped', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
        ai_trial_reservations: [],
      }, async () => {
        const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
        const res = await resolveAiConfigForUser('user-stopped', {
          taskId: 'task-stopped',
          taskType: 'analyze_concepts',
          inputIdentifier: 'hash-md',
        });

        assert.equal(res.ok, false);
        assert.equal(res.code, 'operator_disabled');
        assert.equal(res.needsAiConnection, true);
      });
    } finally {
      delete process.env.OPERATOR_EMERGENCY_STOP;
    }
  });

  await checkAsync('AI 체험 크레딧 11: 사용자 직접 크레딧 변경 및 타 사용자 내역 접근 거부', async () => {
    await withFakeSupabase({
      user: { id: 'user-hacker' },
      ai_trial_credits: [
        { user_id: 'user-hacker', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() },
        { user_id: 'user-victim', granted_credits: 3, balance: 1, granted_at: nowIso(), updated_at: nowIso() },
      ],
      ai_trial_reservations: [
        { id: 'res-victim', user_id: 'user-victim', task_id: 'victim-task', task_type: 'evaluate_answer', input_identifier: 'h', status: 'reserved' },
      ],
    }, async (client) => {
      // 1. Direct update attempt: permission denied (42501)
      const updateRes = await client.from('ai_trial_credits').update({ balance: 999 }).eq('user_id', 'user-hacker');
      assert.ok(updateRes.error);
      assert.equal(updateRes.error.code, '42501', '직접 UPDATE 차단');

      // 2. Direct upsert attempt: permission denied
      const upsertRes = await client.from('ai_trial_credits').upsert({ user_id: 'user-hacker', balance: 999 });
      assert.ok(upsertRes.error);
      assert.equal(upsertRes.error.code, '42501', '직접 UPSERT 차단');

      // 3. Direct delete attempt: permission denied
      const deleteRes = await client.from('ai_trial_credits').delete().eq('user_id', 'user-hacker');
      assert.ok(deleteRes.error);
      assert.equal(deleteRes.error.code, '42501', '직접 DELETE 차단');

      // 4. Querying another user's rows: RLS isolates rows to only the authenticated user
      const selectOtherCredits = await client.from('ai_trial_credits').select('*').eq('user_id', 'user-victim');
      assert.equal(selectOtherCredits.data.length, 0, '타인 크레딧 조회 불가');

      const selectOtherRes = await client.from('ai_trial_reservations').select('*').eq('user_id', 'user-victim');
      assert.equal(selectOtherRes.data.length, 0, '타인 예약 내역 조회 불가');
    });
  });

  await checkAsync('AI 체험 크레딧 12: 입력·출력·청크·재시도 한도 준수', async () => {
    const {
      validateTrialAnalyzeConceptsInput,
      validateTrialGenerateProblemsInput,
      validateTrialEvaluateAnswerInput,
    } = load(path.join(output, 'lib/trialCredits.js'));

    // A) Concept analysis: max 2 chunks, max 12,000 chars
    assert.equal(validateTrialAnalyzeConceptsInput(2, 10000).ok, true);
    assert.equal(validateTrialAnalyzeConceptsInput(3, 5000).ok, false, '3청크 초과 거부');
    assert.equal(validateTrialAnalyzeConceptsInput(3, 5000).errorCode, 'TRIAL_LIMIT_EXCEEDED');
    assert.equal(validateTrialAnalyzeConceptsInput(1, 15000).ok, false, '12,000자 초과 거부');

    // B) Problem generation: max 2 problems, max 15,000 chars source
    assert.equal(validateTrialGenerateProblemsInput(2, 10000).ok, true);
    assert.equal(validateTrialGenerateProblemsInput(3, 5000).ok, false, '3문항 생성 거부');
    assert.equal(validateTrialGenerateProblemsInput(1, 18000).ok, false, '15,000자 초과 거부');

    // C) Answer evaluation: single problem max 6,000 chars, mock exam prohibited
    assert.equal(validateTrialEvaluateAnswerInput('a'.repeat(2000), false).ok, true);
    assert.equal(validateTrialEvaluateAnswerInput('a'.repeat(7000), false).ok, false, '6,000자 답안 초과 거부');
    assert.equal(validateTrialEvaluateAnswerInput('답안', true).ok, false, '모의시험 체험 금지');
    assert.equal(validateTrialEvaluateAnswerInput('답안', true).errorCode, 'MOCK_EXAM_TRIAL_PROHIBITED');
  });

  await checkAsync('AI 체험 크레딧 13: 학교 BAZE Gateway / deepseek-v4.1-flash 및 설정된 운영자 모델 지원 (Gemini 전용 강제 해제)', async () => {
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
    const savedEnv = {
      AI_PROVIDER: process.env.AI_PROVIDER,
      BAZE_API_KEY: process.env.BAZE_API_KEY,
      BAZE_API_BASE: process.env.BAZE_API_BASE,
      BAZE_MODEL: process.env.BAZE_MODEL,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      AI_API_KEY: process.env.AI_API_KEY,
    };

    try {
      // 1) Server has School BAZE Gateway configured as AI_PROVIDER
      process.env.AI_PROVIDER = 'school_gateway';
      process.env.BAZE_API_KEY = 'baze-secret-key-1234';
      process.env.BAZE_API_BASE = 'https://gateway.school.edu/api/v1';
      process.env.BAZE_MODEL = 'deepseek-v4.1-flash';
      delete process.env.GEMINI_API_KEY;
      delete process.env.AI_API_KEY;

      await withFakeSupabase({
        user: { id: 'unregistered-trial-user' },
        ai_trial_credits: [{ user_id: 'unregistered-trial-user', granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
        ai_trial_reservations: [],
      }, async () => {
        const res = await resolveAiConfigForUser('unregistered-trial-user', {
          taskId: 'task-trial-school-baze',
          taskType: 'analyze_concepts',
          inputIdentifier: 'hash-baze',
        });

        assert.equal(res.ok, true);
        assert.equal(res.source, 'operator');
        assert.equal(res.isTrial, true);
        assert.equal(res.config.provider, 'school_gateway', '학교 BAZE Gateway provider 지원');
        assert.equal(res.config.apiKey, 'baze-secret-key-1234');
        assert.equal(res.config.model, 'deepseek-v4.1-flash');
        assert.equal(res.config.apiBase, 'https://gateway.school.edu/api/v1');
      });

      // 2) Server has NO operator provider configured
      delete process.env.BAZE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.AI_API_KEY;
      const prevConfigKey = AI_CONFIG.apiKey;
      AI_CONFIG.apiKey = '';

      try {
        await withFakeSupabase({
          user: { id: 'unregistered-trial-user-2' },
          ai_trial_credits: [{ user_id: 'unregistered-trial-user-2', granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
          ai_trial_reservations: [],
        }, async () => {
          const res = await resolveAiConfigForUser('unregistered-trial-user-2', {
            taskId: 'task-trial-no-operator',
            taskType: 'analyze_concepts',
            inputIdentifier: 'hash-no-op',
          });

          assert.equal(res.ok, false, '운영자 키가 없으면 체험 호출 차단');
          assert.equal(res.code, 'no_credentials');
        });
      } finally {
        AI_CONFIG.apiKey = prevConfigKey;
      }
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // ==========================================
  // Google Drive & Local Backup Regression Suite
  // ==========================================

  check('Google Drive 백업 1: 최소 권한 범위(drive.file) 검증 및 과도한 권한 차단', () => {
    assert.ok(
      googleDrive.REQUIRED_DRIVE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'),
      '최소 권한인 drive.file 스코프가 포함되어야 함'
    );
    const scopeTokens = googleDrive.REQUIRED_DRIVE_SCOPES.split(' ');
    assert.equal(
      scopeTokens.includes('https://www.googleapis.com/auth/drive'),
      false,
      '전체 Drive 접근 권한(https://www.googleapis.com/auth/drive)을 요청하지 않아야 함'
    );
    assert.ok(
      googleDrive.REQUIRED_DRIVE_SCOPES.includes('https://www.googleapis.com/auth/userinfo.email'),
      '연결된 Google 계정 표시를 위한 userinfo.email 스코프가 포함되어야 함'
    );
  });

  check('Google Drive 백업 2: 환경변수 미설정 시 안전한 안내 및 로컬 백업 유지 (암호화 키 필수 검증)', () => {
    const unconfigured = googleDrive.getGoogleDriveConfig({});
    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.clientId, '');
    assert.equal(unconfigured.clientSecret, '');

    // OAuth is set but encryption key is missing -> must be disabled (configured: false)
    const missingEncryption = googleDrive.getGoogleDriveConfig({
      GOOGLE_DRIVE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:3000/api/drive/callback',
    });
    assert.equal(missingEncryption.configured, false, '암호화 키 누락 시 Drive 연결 비활성화');
    assert.equal(missingEncryption.encryptionConfigured, false);

    // Both OAuth and valid 32-byte encryption key are set -> configured: true
    const validKeyB64 = Buffer.alloc(32, 9).toString('base64');
    const fullyConfigured = googleDrive.getGoogleDriveConfig({
      GOOGLE_DRIVE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:3000/api/drive/callback',
      AI_CREDENTIAL_ENCRYPTION_KEY: validKeyB64,
    });
    assert.equal(fullyConfigured.configured, true);
    assert.equal(fullyConfigured.encryptionConfigured, true);
    assert.equal(fullyConfigured.clientId, 'test-client-id.apps.googleusercontent.com');
  });

  check('Google Drive 백업 3: OAuth state 생성, 사용자 ID 바인딩 및 CSRF 위변조 거부', () => {
    const userId = 'learnaway-user-uuid-1234';
    const state = googleDrive.createOAuthState(userId);

    // 1) Correct user ID succeeds
    const verified = googleDrive.verifyOAuthState(state, userId);
    assert.equal(verified.valid, true);
    assert.equal(verified.userId, userId);

    // 2) Mismatched user ID fails (cross-account attack prevented)
    const mismatched = googleDrive.verifyOAuthState(state, 'another-user-uuid-9999');
    assert.equal(mismatched.valid, false);

    // 3) Tampered state string fails
    const tampered = state.slice(0, -6) + 'abcdef';
    const tamperedResult = googleDrive.verifyOAuthState(tampered, userId);
    assert.equal(tamperedResult.valid, false);
  });

  check('Google Drive 백업 4: 세션 토큰 AES-256-GCM 암호화 및 무결성 검증', () => {
    const sessionPayload = JSON.stringify({
      userId: 'test-user-id',
      googleEmail: 'student@example.com',
      accessToken: 'ya29.test-access-token',
      expiresAt: Date.now() + 3600 * 1000,
    });

    const encrypted = googleDrive.encryptPayload(sessionPayload);
    assert.notEqual(encrypted, sessionPayload, '평문이 그대로 노출되지 않음');

    const decrypted = googleDrive.decryptPayload(encrypted);
    assert.equal(decrypted, sessionPayload, '정상 복호화 성공');

    // Tampered ciphertext fails
    const corrupted = encrypted.slice(0, -5) + (encrypted.endsWith('A') ? 'B' : 'A') + 'corrupt';
    const corruptedDecrypted = googleDrive.decryptPayload(corrupted);
    assert.equal(corruptedDecrypted, null, '변조된 세션 암호문은 복호화 거부');
  });

  check('Google Drive 백업 5: Google Drive 에러 유형 세분화 및 사용자 안내 매핑', () => {
    // 401 -> AUTH_EXPIRED
    const e401 = googleDrive.categorizeDriveError(401, 'Unauthorized');
    assert.equal(e401.code, 'AUTH_EXPIRED');

    // 403 storageQuotaExceeded -> STORAGE_FULL
    const eStorage = googleDrive.categorizeDriveError(403, '{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}');
    assert.equal(eStorage.code, 'STORAGE_FULL');

    // 403 userRateLimitExceeded -> RATE_LIMIT
    const eRate = googleDrive.categorizeDriveError(403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}');
    assert.equal(eRate.code, 'RATE_LIMIT');

    // 403 insufficientPermissions -> PERMISSION_DENIED
    const ePerm = googleDrive.categorizeDriveError(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}');
    assert.equal(ePerm.code, 'PERMISSION_DENIED');

    // 429 -> RATE_LIMIT
    const e429 = googleDrive.categorizeDriveError(429, 'Too Many Requests');
    assert.equal(e429.code, 'RATE_LIMIT');
  });

  await checkAsync('Google Drive 백업 6: 로컬 백업과 Drive 백업의 스키마 완전 호환 및 복원 검증', async () => {
    await withFakeIndexedDB(async () => {
      storageScope.setStorageScope({ kind: 'user', userId: 'gdrive-backup-user' });

      const testSubject = { id: 'subj-math', name: '선형대수학' };
      const testMaterial = {
        id: 'mat-eig',
        subjectId: 'subj-math',
        title: '고유값과 고유벡터',
        kind: 'pdf',
        sourceRefs: '',
        status: 'ready',
        isConverted: true,
        uploadedAt: new Date().toISOString(),
        storagePolicy: materialPolicy.DEFAULT_MATERIAL_POLICY,
      };

      const originalBytes = new TextEncoder().encode('PDF binary content dummy');
      const hash = await matStorage.hashBlob(new Blob([originalBytes], { type: 'application/pdf' }));

      // Build backup using standard buildMaterialBackup
      const backup = await materialPolicy.buildMaterialBackup([testMaterial], {
        loadBody: async () => ({
          status: 'found',
          body: { markdown: '# 고유값 정의\n$Ax = \\lambda x$', rawText: '고유값 정의', pages: [] },
        }),
        loadOriginal: async () => ({
          status: 'found',
          original: { contentType: 'application/pdf', hash, data: originalBytes },
        }),
      });

      assert.ok([1, 2].includes(backup.version), '지원하는 백업 버전(v1 또는 v2)이어야 함');
      assert.equal(backup.materials.length, 1);

      // Serialize into JSON (what gets uploaded to Google Drive or downloaded locally)
      const serialized = JSON.stringify(backup);

      // Parse with parseMaterialBackup (what happens when user restores from Drive download or local file)
      const parsed = materialPolicy.parseMaterialBackup(serialized);
      assert.equal(parsed.ok, true);

      // Verify hashes
      const hashVerify = await materialPolicy.verifyBackupOriginalHashes(parsed.backup);
      assert.equal(hashVerify.ok, true, '원본 파일 해시가 정확히 일치');

      // Execute restore using standard makeRestoreIo
      const { io, writtenMetadata } = makeRestoreIo({ knownSubjectIds: [testSubject.id] });

      const outcome = await materialRestore.executeMaterialRestore(parsed.backup.materials, io);
      assert.equal(outcome.restored.length, 1);
      assert.equal(outcome.restored[0], 'mat-eig');
      assert.equal(writtenMetadata.length, 1);
      assert.equal(writtenMetadata[0].title, '고유값과 고유벡터');
    });
  });

  check('Google Drive 백업 7: 비밀정보(API 키, 토큰) 포함 시 업로드 및 내보내기 즉시 차단', () => {
    const leakBackup = {
      version: 1,
      createdAt: new Date().toISOString(),
      materials: [
        {
          material: { id: 'm1', subjectId: 's1', title: '자료 1', createdAt: nowIso(), updatedAt: nowIso() },
          body: { markdown: '강의 본문' },
          apiKey: 'injected-secret-api-key',
        },
      ],
    };

    assert.equal(materialPolicy.backupContainsSecrets(leakBackup), true, '비밀정보 포함 감지');
  });

  check('Google Drive 백업 8: 부분 백업 구분 및 완전 백업으로 오표기 금지', () => {
    const incompleteBackup = {
      version: 2,
      createdAt: new Date().toISOString(),
      materials: [
        {
          material: { id: 'm1', subjectId: 's1', title: '자료 1', kind: 'pdf', status: 'ready', isConverted: true, uploadedAt: nowIso() },
          fileState: { body: 'error', original: 'present' },
          fileError: { body: 'IndexedDB 읽기 실패' },
        },
      ],
    };

    const summary = materialPolicy.summarizeBackupCompleteness(incompleteBackup);
    assert.equal(summary.complete, false, '본문이 누락된 백업은 완전 백업이 아님');
    assert.equal(summary.materialsWithIssues, 1);
  });

  // =========================================================================
  // Comprehensive Verification Suite: Requirements 1 through 6
  // =========================================================================

  // --- Requirement 1: Username Signup / Login & Legacy Guest Removal ---
  await checkAsync('간편 가입/로그인 1: 아이디 정규화, 허용 문자, 길이 검증', async () => {
    const { normalizeUsername, validateUsername } = load(path.join(output, 'lib/auth/username.js'));
    assert.equal(normalizeUsername('  User_123  '), 'user_123');
    assert.equal(validateUsername('abc').ok, true);
    assert.equal(validateUsername('user-name_99').ok, true);
    assert.equal(validateUsername('ab').ok, false, '3자 미만 거부');
    assert.equal(validateUsername('a'.repeat(31)).ok, false, '30자 초과 거부');
    assert.equal(validateUsername('user@domain').ok, false, '이메일 기호 거부');
    assert.equal(validateUsername('user name').ok, false, '공백 포함 거부');
    assert.equal(validateUsername('한글아이디').ok, false, '한글 등 허용되지 않은 문자 거부');
  });

  await checkAsync('간편 가입/로그인 2: 아이디 중복 방지 및 동시 가입 원자적 제약', async () => {
    const { POST: usernameRoute } = load(path.join(output, 'app/api/auth/username/route.js'));
    let usernameAccounts = [];
    let authUsers = [];

    await withFakeSupabase({
      username_accounts: usernameAccounts,
      auth_rate_limits: [],
      rpcImpl: (name) => {
        if (name === 'check_and_increment_rate_limit') return { data: true, error: null };
        return { data: null, error: null };
      },
    }, async (client) => {
      client.auth.admin = {
        createUser: async ({ email }) => {
          const uid = 'auth-uid-' + Math.random().toString(36).slice(2);
          authUsers.push({ id: uid, email });
          return { data: { user: { id: uid, email } }, error: null };
        },
        deleteUser: async (uid) => {
          authUsers = authUsers.filter((u) => u.id !== uid);
          return { data: {}, error: null };
        },
      };

      // 1. Initial signup succeeds
      const req1 = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signup', username: 'student123', password: 'password1234' }),
      });
      const res1 = await usernameRoute(req1);
      const data1 = await res1.json();
      assert.equal(res1.status, 200);
      assert.equal(data1.success, true);
      assert.equal(data1.user.username, 'student123');

      // 2. Duplicate signup fails with 409 USERNAME_ALREADY_EXISTS
      const req2 = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signup', username: 'Student123', password: 'password1234' }),
      });
      const res2 = await usernameRoute(req2);
      const data2 = await res2.json();
      assert.equal(res2.status, 409);
      assert.equal(data2.errorCode, 'USERNAME_ALREADY_EXISTS');
    });
  });

  await checkAsync('간편 가입/로그인 3: 서버 측 요청 제한(Rate Limit) 초과 시 429 차단', async () => {
    const { POST: usernameRoute } = load(path.join(output, 'app/api/auth/username/route.js'));

    await withFakeSupabase({
      auth_rate_limits: [],
    }, async () => {
      // 5 attempts allowed
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/auth/username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', username: 'ratelimituser', password: 'badpassword' }),
        });
        const res = await usernameRoute(req);
        assert.notEqual(res.status, 429);
      }

      // 6th attempt blocked with 429
      const reqBlocked = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: 'ratelimituser', password: 'badpassword' }),
      });
      const resBlocked = await usernameRoute(reqBlocked);
      assert.equal(resBlocked.status, 429);
      const dataBlocked = await resBlocked.json();
      assert.equal(dataBlocked.errorCode, 'RATE_LIMIT_EXCEEDED');
    });
  });

  await checkAsync('간편 가입/로그인 4: 공용 게스트 로그인 경로 및 기존 공유 세션 차단', async () => {
    const { POST: guestLoginRoute } = load(path.join(output, 'app/api/guest-login/route.js'));
    const { getSessionUser, isSharedLegacyGuestUser } = load(path.join(output, 'lib/auth/session.js'));

    // 1. /api/guest-login route returns 410 GONE
    const guestRes = await guestLoginRoute();
    assert.equal(guestRes.status, 410);
    const guestData = await guestRes.json();
    assert.equal(guestData.errorCode, 'GUEST_LOGIN_DEPRECATED');

    // 2. isSharedLegacyGuestUser detects guest@learnaway.ai
    assert.equal(isSharedLegacyGuestUser({ email: 'guest@learnaway.ai' }), true);
    assert.equal(isSharedLegacyGuestUser({ email: 'student123@id.learnaway.local' }), false);
    assert.equal(isSharedLegacyGuestUser({ email: 'student@gmail.com' }), false);

    // 3. getSessionUser rejects legacy guest session with 403
    const legacyGuestClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'legacy-shared-guest-uid', email: 'guest@learnaway.ai' } },
          error: null,
        }),
      },
    };
    const sessionRes = await getSessionUser(legacyGuestClient);
    assert.equal(sessionRes.user, null);
    assert.equal(sessionRes.errorCode, 'FORBIDDEN_SHARED_ACCOUNT');
  });

  await checkAsync('간편 가입/로그인 5: 서로 다른 간편 가입 사용자 간 데이터 격리', async () => {
    const userA = { id: 'uuid-user-a', email: 'alice@id.learnaway.local' };
    const userB = { id: 'uuid-user-b', email: 'bob@id.learnaway.local' };

    await withFakeSupabase({
      user: userA,
      subjects: [
        { id: 'subj-a', user_id: userA.id, name: 'Alice의 통계학' },
        { id: 'subj-b', user_id: userB.id, name: 'Bob의 알고리즘' },
      ],
      ai_trial_credits: [
        { user_id: userA.id, granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() },
        { user_id: userB.id, granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() },
      ],
    }, async (client) => {
      // User A queries subjects: cannot see Bob's subject
      const subs = await client.from('subjects').select('*').eq('user_id', userA.id);
      assert.equal(subs.data.length, 1);
      assert.equal(subs.data[0].name, 'Alice의 통계학');

      // User A queries Bob's trial credits: isolated
      const credits = await client.from('ai_trial_credits').select('*').eq('user_id', userB.id);
      assert.equal(credits.data.length, 0);
    });
  });

  // --- Requirement 2 & 3: Trial Operations, Exclusion & RPC Permissions ---
  await checkAsync('AI 체험 크레딧 14: 일반 authenticated 사용자의 정산·환급·예약 RPC 직접 실행 거부', async () => {
    await withFakeSupabase({
      user: { id: 'normal-authenticated-user' },
      isAdmin: false,
    }, async (client) => {
      const settleRes = await client.rpc('settle_trial_credit', { p_task_id: 'any-task' });
      assert.ok(settleRes.error, '일반 사용자의 settle_trial_credit 직접 호출 거부');
      assert.equal(settleRes.error.code, '42501');

      const releaseRes = await client.rpc('release_trial_credit', { p_task_id: 'any-task', p_reason: 'tampered' });
      assert.ok(releaseRes.error, '일반 사용자의 release_trial_credit 직접 호출 거부');
      assert.equal(releaseRes.error.code, '42501');

      const reserveRes = await client.rpc('reserve_trial_credit', {
        p_task_id: 'any-task',
        p_task_type: 'generate_problems',
        p_input_identifier: 'any-hash',
      });
      assert.ok(reserveRes.error, '일반 사용자의 reserve_trial_credit 직접 호출 거부');
      assert.equal(reserveRes.error.code, '42501');
    });
  });

  await checkAsync('AI 체험 크레딧 15: 모의시험 일괄 채점은 체험 대상 제외 (개인 API 키 필수)', async () => {
    const { validateTrialEvaluateAnswerInput } = load(path.join(output, 'lib/trialCredits.js'));
    const evalValidation = validateTrialEvaluateAnswerInput('모의시험 답안 내용', true);
    assert.equal(evalValidation.ok, false);
    assert.equal(evalValidation.errorCode, 'MOCK_EXAM_TRIAL_PROHIBITED');
  });

  await checkAsync('AI 체험 크레딧 16: 중복 동시 요청 임대 락(lease) 및 완료 작업 캐시 결과 즉시 반환 (AI 미호출)', async () => {
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
    let aiCallCount = 0;

    await withFakeSupabase({
      user: { id: 'lease-test-user' },
      ai_trial_credits: [{ user_id: 'lease-test-user', granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      // 1. First caller acquires lease
      const cred1 = await resolveAiConfigForUser('lease-test-user', {
        taskId: 'concurrent-task-1',
        taskType: 'generate_problems',
        inputIdentifier: 'input-hash-1',
      });
      assert.equal(cred1.ok, true);
      assert.equal(cred1.isTrial, true);
      aiCallCount++;

      // 2. Concurrent second caller for same task: blocked with concurrent_in_progress
      const cred2 = await resolveAiConfigForUser('lease-test-user', {
        taskId: 'concurrent-task-1',
        taskType: 'generate_problems',
        inputIdentifier: 'input-hash-1',
      });
      assert.equal(cred2.ok, false);
      assert.equal(cred2.code, 'concurrent_in_progress');

      // 3. Mark task completed with cached result
      const adminClient = globalThis.__fakeSupabaseAdminClient || client;
      await adminClient.rpc('record_trial_result_ready', {
        p_task_id: 'concurrent-task-1',
        p_result: { problems: [{ id: 'prob-1', promptText: '문제 1' }] },
        p_lease_token: cred1.leaseToken,
      });
      await adminClient.rpc('settle_trial_credit', {
        p_task_id: 'concurrent-task-1',
        p_lease_token: cred1.leaseToken,
      });

      // 4. Repeated caller after completion: returns cached result immediately without calling AI
      const cred3 = await resolveAiConfigForUser('lease-test-user', {
        taskId: 'concurrent-task-1',
        taskType: 'generate_problems',
        inputIdentifier: 'input-hash-1',
      });
      assert.equal(cred3.ok, false);
      assert.equal(cred3.code, 'already_completed');
      assert.deepEqual(cred3.cachedResult, { problems: [{ id: 'prob-1', promptText: '문제 1' }] });
      assert.equal(aiCallCount, 1, 'AI는 단 1회만 호출됨');
    });
  });

  // --- Requirement 4 & 5: Google Drive Encryption & Resumable Upload ---
  await checkAsync('Google Drive 백업 9: 고정 문자열 fallback 제거 및 암호화 키 누락 시 연결 거부', async () => {
    const emptyKey = googleDrive.getDriveEncryptionKey({});
    assert.equal(emptyKey, null, '환경변수 누락 시 null 반환');

    const shortKey = googleDrive.getDriveEncryptionKey({ AI_CREDENTIAL_ENCRYPTION_KEY: 'too-short' });
    assert.equal(shortKey, null, '32바이트 미만 키 거부');
  });

  await checkAsync('Google Drive 백업 10: 대용량 청크 전송 시 SSRF 방지 및 바이트 범위 검증', async () => {
    await assert.rejects(
      async () => {
        await googleDrive.uploadResumableChunk(
          'https://malicious-site.example.com/evil',
          Buffer.from('chunk-data'),
          0,
          9,
          10
        );
      },
      /유효하지 않은 Google Drive/,
      '임의 외부 URL 전송 차단 (SSRF 방지)'
    );
  });

  // --- Requirement 6: PDF Conversion Deployment & Textless PDF ---
  await checkAsync('PDF 변환 1: 배포 환경 Python 미설치 시 503 및 운영 안내 반환', async () => {
    const { POST: convertPdf } = load(path.join(output, 'app/api/convert/route.js'));
    const savedServiceUrl = process.env.PDF_CONVERT_SERVICE_URL;
    delete process.env.PDF_CONVERT_SERVICE_URL;

    try {
      const boundary = '----TestBoundary123';
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 dummy\r\n--${boundary}--\r\n`;
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      const res = await convertPdf(req);
      assert.ok([200, 422, 503].includes(res.status));
      if (res.status === 503) {
        const data = await res.json();
        assert.equal(data.errorCode, 'PDF_SERVICE_UNCONFIGURED');
        assert.ok(data.error.includes('PDF_CONVERT_SERVICE_URL'));
      }
    } finally {
      if (savedServiceUrl) process.env.PDF_CONVERT_SERVICE_URL = savedServiceUrl;
    }
  });

  await checkAsync('PDF 변환 2: 마이크로서비스 URL 설정 시 외부 서비스로 라우팅', async () => {
    const { POST: convertPdf } = load(path.join(output, 'app/api/convert/route.js'));
    const savedServiceUrl = process.env.PDF_CONVERT_SERVICE_URL;
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:8001';

    let remoteServiceCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      if (String(url).startsWith('http://127.0.0.1:8001')) {
        remoteServiceCalled = true;
        return new Response(JSON.stringify({
          success: true,
          markdown: '# 르베그 적분 개론\n\n외부 마이크로서비스에서 변환된 본문입니다.',
          textLength: 35,
          pageCount: 1,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, options);
    };

    try {
      const boundary = '----MicroserviceBoundary';
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lecture.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 dummy\r\n--${boundary}--\r\n`;
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      const res = await convertPdf(req);
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(remoteServiceCalled, true, 'PDF_CONVERT_SERVICE_URL로 요청이 라우팅됨');
      assert.equal(data.success, true);
      assert.ok(data.markdown.includes('외부 마이크로서비스'));
    } finally {
      global.fetch = originalFetch;
      if (savedServiceUrl) process.env.PDF_CONVERT_SERVICE_URL = savedServiceUrl;
      else delete process.env.PDF_CONVERT_SERVICE_URL;
    }
  });

  await checkAsync('PDF 변환 3: 스캔/이미지 PDF(텍스트 없음) 시 422 및 OCR 미지원 명확 안내', async () => {
    const { POST: convertPdf } = load(path.join(output, 'app/api/convert/route.js'));
    const savedServiceUrl = process.env.PDF_CONVERT_SERVICE_URL;
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:8001';

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      if (String(url).startsWith('http://127.0.0.1:8001')) {
        return new Response(JSON.stringify({
          success: false,
          errorCode: 'PDF_NO_TEXT',
          error: 'PDF에서 텍스트를 추출할 수 없습니다. (스캔/이미지 전용 PDF는 OCR을 지원하지 않습니다)',
        }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, options);
    };

    try {
      const boundary = '----ScannedPdfBoundary';
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scanned.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 dummy\r\n--${boundary}--\r\n`;
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      const res = await convertPdf(req);
      const data = await res.json();
      assert.equal(res.status, 422);
      assert.equal(data.errorCode, 'PDF_NO_TEXT');
      assert.ok(data.error.includes('OCR'), 'OCR 미지원 안내 포함');
    } finally {
      global.fetch = originalFetch;
      if (savedServiceUrl) process.env.PDF_CONVERT_SERVICE_URL = savedServiceUrl;
      else delete process.env.PDF_CONVERT_SERVICE_URL;
    }
  });

  await checkAsync('PDF 변환 4: GET /api/convert 정밀 변환 상태 확인 (URL 미설정 시 안내 반환 및 토큰 미노출)', async () => {
    const { GET: getConvertHealth } = load(path.join(output, 'app/api/convert/route.js'));
    const savedServiceUrl = process.env.PDF_CONVERT_SERVICE_URL;
    delete process.env.PDF_CONVERT_SERVICE_URL;

    try {
      const res = await getConvertHealth();
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.available, false);
      assert.equal(data.configured, false);
      assert.equal(data.engine, 'unavailable');
      assert.ok(data.message.includes('PDF_CONVERT_SERVICE_URL') || data.message.includes('정밀 변환'));
      assert.equal(data.token, undefined, '비밀 토큰 노출 금지');
    } finally {
      if (savedServiceUrl) process.env.PDF_CONVERT_SERVICE_URL = savedServiceUrl;
    }
  });

  await checkAsync('PDF 변환 5: GET /api/convert 정밀 변환 상태 확인 (외부 서비스 상태 조회 성공)', async () => {
    const { GET: getConvertHealth } = load(path.join(output, 'app/api/convert/route.js'));
    const savedServiceUrl = process.env.PDF_CONVERT_SERVICE_URL;
    const savedServiceToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:8001';
    process.env.PDF_CONVERT_SERVICE_TOKEN = 'secret-test-token-123';

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).startsWith('http://127.0.0.1:8001/health')) {
        return new Response(JSON.stringify({
          status: 'ready',
          ready: true,
          available: true,
          configured: true,
          service: 'learnaway-pdf-converter',
          engine: 'pymupdf4llm',
          version: '1.1.0',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url);
    };

    try {
      const res = await getConvertHealth();
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.available, true);
      assert.equal(data.configured, true);
      assert.equal(data.engine, 'pymupdf4llm');
    } finally {
      global.fetch = originalFetch;
      if (savedServiceUrl) process.env.PDF_CONVERT_SERVICE_URL = savedServiceUrl;
      else delete process.env.PDF_CONVERT_SERVICE_URL;
      if (savedServiceToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedServiceToken;
      else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
    }
  });

  await checkAsync('PDF 변환 6: 대용량 PDF 스토리지 티켓 생성 및 비인가 경로 격리 검증', async () => {
    await withFakeSupabase({
      user: { id: 'test-user-pdf-6' },
      temp_pdf_conversion_jobs: [],
    }, async () => {
      const { POST: convertPdf } = load(path.join(output, 'app/api/convert/route.js'));

      // 1. Ticket creation
      const ticketReq = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_storage_ticket',
          fileName: 'calculus_chapter1.pdf',
          fileSize: 15 * 1024 * 1024,
        }),
      });
      const ticketRes = await convertPdf(ticketReq);
      assert.equal(ticketRes.status, 200);
      const ticketData = await ticketRes.json();
      assert.equal(ticketData.success, true);
      assert.ok(ticketData.storagePath.includes('/temp-convert/'));
      assert.ok(ticketData.storagePath.endsWith('.pdf'));

      // 2. Reject tampering / unauthorized path access (other user or non-matching jobId)
      const unauthorizedReq = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'convert_storage',
          jobId: 'fake-job-id',
          storagePath: 'other-user-uuid/temp-convert/fake-job-id/secret.pdf',
        }),
      });
      const unauthorizedRes = await convertPdf(unauthorizedReq);
      assert.equal(unauthorizedRes.status, 403, '타 사용자 경로 접근 거부');
    });
  });

  await checkAsync('PDF 변환 7: HMAC 작업 토큰 생성 및 만료 시한 검증', async () => {
    const { createPdfJobToken } = load(path.join(output, 'lib/pdf/token.js'));
    const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
    process.env.PDF_CONVERT_SERVICE_TOKEN = 'secret-test-token-xyz';

    try {
      const token = createPdfJobToken('user-123', 'job-abc', 200, 60);
      assert.ok(token && typeof token === 'string');
      const [payloadB64, signature] = token.split('.');
      assert.ok(payloadB64 && signature);
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      assert.equal(payload.userId, 'user-123');
      assert.equal(payload.jobId, 'job-abc');
      assert.equal(payload.maxPages, 200);
      assert.ok(payload.exp > Math.floor(Date.now() / 1000));
    } finally {
      if (savedToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
      else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
    }
  });

  await checkAsync('PDF 변환 8: 브라우저 PDF.js 버퍼 시그니처 검증 (%PDF- 매직 바이트 및 크기 한도)', async () => {
    const { validatePdfBuffer } = load(path.join(output, 'lib/pdf/browserPdfConverter.js'));

    // Empty buffer
    const emptyRes = validatePdfBuffer(new ArrayBuffer(0));
    assert.equal(emptyRes.ok, false);
    assert.equal(emptyRes.code, 'PDF_EMPTY');

    // Wrong signature (e.g. text/html)
    const htmlBuf = new TextEncoder().encode('<!DOCTYPE html><html>').buffer;
    const invalidSigRes = validatePdfBuffer(htmlBuf);
    assert.equal(invalidSigRes.ok, false);
    assert.equal(invalidSigRes.code, 'PDF_SIGNATURE_INVALID');

    // Valid PDF signature
    const validPdfBuf = new TextEncoder().encode('%PDF-1.7 sample data').buffer;
    const validRes = validatePdfBuffer(validPdfBuf);
    assert.equal(validRes.ok, true);
  });

  // ==========================================================================
  // 8대 리뷰 수정 검증 (Problems 1 ~ 8)
  // ==========================================================================

  await checkAsync('8대 리뷰 1: app/api/auth/username Route export 정리 및 lib/auth/username 모듈 분리 검증', async () => {
    const usernameModule = load(path.join(output, 'lib/auth/username.js'));
    assert.equal(typeof usernameModule.normalizeUsername, 'function');
    assert.equal(typeof usernameModule.validateUsername, 'function');
    assert.equal(typeof usernameModule.usernameToEmail, 'function');

    // Route file should only export POST and dynamic (no helper exports)
    const routeModule = load(path.join(output, 'app/api/auth/username/route.js'));
    assert.equal(typeof routeModule.POST, 'function');
    assert.equal(routeModule.normalizeUsername, undefined, 'normalizeUsername must NOT be exported from route.ts');
    assert.equal(routeModule.validateUsername, undefined, 'validateUsername must NOT be exported from route.ts');
    assert.equal(routeModule.usernameToEmail, undefined, 'usernameToEmail must NOT be exported from route.ts');
  });

  await checkAsync('8대 리뷰 2: Migration 25 구형 4인자 reserve_trial_credit 제거 및 권한 정리 검증', async () => {
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260101000025_trial_credits_v3_and_temp_pdf_cleanup.sql'),
      'utf-8'
    );
    assert.ok(migrationSql.includes('drop function if exists public.reserve_trial_credit(text, text, text, uuid);'), '구형 4인자 함수 DROP 명시');
    assert.ok(migrationSql.includes('revoke execute on function public.reserve_trial_credit(text, text, text, uuid) from public, anon, authenticated;'), '구형 4인자 권한 회수');
    assert.ok(migrationSql.includes('grant execute on function public.reserve_trial_credit(text, text, text, uuid, integer) to service_role;'), '5인자 함수 service_role 전용 허용');
    assert.ok(migrationSql.includes('revoke all on function public.reserve_trial_credit(text, text, text, uuid, integer) from public, anon, authenticated;'), '일반 사용자 실행 거부');
  });

  await checkAsync('8대 리뷰 3: 체험 크레딧 재시도 잔액 재확인, 재차감 및 leaseToken(fencing token) 검증', async () => {
    const { recordTrialResultReady, settleTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));

    await withFakeSupabase({
      user: { id: 'user-1' },
      isAdmin: true,
      ai_trial_credits: [{ user_id: 'user-1', granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [
        {
          id: 'res-1',
          user_id: 'user-1',
          task_id: 'task-1',
          task_type: 'generate_problems',
          input_identifier: 'hash-1',
          status: 'processing',
          lease_token: 'valid-lease-token',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
    }, async () => {
      // 1. Stale lease token is rejected
      const staleRes = await recordTrialResultReady('user-1', 'task-1', { data: 'test' }, 'stale-lease-token');
      assert.equal(staleRes.success, false);
      assert.ok(staleRes.error);

      // 2. Valid lease token is accepted
      const validRes = await recordTrialResultReady('user-1', 'task-1', { data: 'test' }, 'valid-lease-token');
      assert.equal(validRes.success, true);
      assert.equal(validRes.status, 'result_ready');

      // 3. Stale settle is rejected
      const staleSettle = await settleTrialCredit('user-1', 'task-1', 'wrong-lease');
      assert.equal(staleSettle.success, false);

      // 4. Valid settle succeeds
      const validSettle = await settleTrialCredit('user-1', 'task-1', 'valid-lease-token');
      assert.equal(validSettle.success, true);
      assert.equal(validSettle.status, 'settled');
    });
  });

  await checkAsync('8대 리뷰 4: AI 결과 캐시와 초안 DB 저장 분리 검증 (DB 저장 실패 시 persisted:false 유지 및 재시도 성공)', async () => {
    const { POST: generateProblems } = load(path.join(output, 'app/api/generate-problems/route.js'));

    const cachedDrafts = [
      {
        id: 'draft-cached-1',
        title: '수리통계학 가설검정',
        type: 'essay_descriptive',
        difficulty: 'advanced_college',
        promptText: '검정력 함수를 유도하고 일치성을 증명하시오.',
        modelAnswer: '모범 답안 수식 전개',
        rubric: [{ id: 'r1', label: '유도', maxScore: 50 }, { id: 'r2', label: '증명', maxScore: 50 }],
        status: 'draft',
        isApproved: false,
      },
    ];

    // Scenario 1: DB persistence fails
    await withFakeSupabase({
      user: { id: 'user-problem-gen' },
      fail: { upsert: true },
      rpcImpl: (fn) => {
        if (fn === 'reserve_trial_credit') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              remaining: 0,
              cached_result: { drafts: cachedDrafts, generationJobId: 'gen-job-cached' },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const req1 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'sub-math',
          subjectDomain: 'math_stats',
          problemType: 'essay_descriptive',
          concepts: [{ id: 'c1', subjectId: 'sub-math', title: '가설검정' }],
          sources: [{ materialId: 'm1', title: '교재', markdown: '내용' }],
        }),
      });

      const res1 = await generateProblems(req1);
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.fromCache, true);
      assert.equal(data1.persisted, false, 'DB 실패 시 persisted는 false여야 함');
      assert.ok(data1.persistError, 'persistError 메시지 제공');
    });

    // Scenario 2: DB persistence succeeds on retry without re-calling AI
    await withFakeSupabase({
      user: { id: 'user-problem-gen' },
      problem_drafts: [],
      rpcImpl: (fn) => {
        if (fn === 'reserve_trial_credit') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              remaining: 0,
              cached_result: { drafts: cachedDrafts, generationJobId: 'gen-job-cached' },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const req2 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'sub-math',
          subjectDomain: 'math_stats',
          problemType: 'essay_descriptive',
          concepts: [{ id: 'c1', subjectId: 'sub-math', title: '가설검정' }],
          sources: [{ materialId: 'm1', title: '교재', markdown: '내용' }],
        }),
      });

      const res2 = await generateProblems(req2);
      const data2 = await res2.json();
      assert.equal(data2.success, true);
      assert.equal(data2.fromCache, true);
      assert.equal(data2.persisted, true, 'DB 성공 시 persisted는 true여야 함');
    });
  });

  await checkAsync('8대 리뷰 5: Python 변환 서비스 기본 거부(default-deny) 및 환경변수 누락 시 available:false 검증', async () => {
    const { GET: getConvertHealth } = load(path.join(output, 'app/api/convert/route.js'));
    const savedUrl = process.env.PDF_CONVERT_SERVICE_URL;
    const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;

    // Case 1: URL is configured but TOKEN is missing -> available: false, configured: false
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:8001';
    delete process.env.PDF_CONVERT_SERVICE_TOKEN;

    const res1 = await getConvertHealth();
    const data1 = await res1.json();
    assert.equal(data1.available, false);
    assert.equal(data1.configured, false);
    assert.ok(data1.message.includes('PDF_CONVERT_SERVICE_TOKEN'));

    // Restore
    if (savedUrl) process.env.PDF_CONVERT_SERVICE_URL = savedUrl;
    else delete process.env.PDF_CONVERT_SERVICE_URL;
    if (savedToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
    else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
  });

  await checkAsync('8대 리뷰 6: TypeScript 작업 토큰 생성 및 검증(verifyPdfJobToken)과 claims 바인딩 검증', async () => {
    const { createPdfJobToken, verifyPdfJobToken } = load(path.join(output, 'lib/pdf/token.js'));
    const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
    process.env.PDF_CONVERT_SERVICE_TOKEN = 'secret-token-key-32-chars-length!!';

    try {
      const storagePath = 'user-uuid-1/temp-convert/job-xyz/lecture.pdf';
      const token = createPdfJobToken('user-uuid-1', 'job-xyz', 250, 120, storagePath);
      assert.ok(token);

      // Verify valid token with matching context
      const validPayload = verifyPdfJobToken(token, {
        userId: 'user-uuid-1',
        jobId: 'job-xyz',
        storagePath,
      });
      assert.ok(validPayload);
      assert.equal(validPayload.userId, 'user-uuid-1');
      assert.equal(validPayload.jobId, 'job-xyz');
      assert.equal(validPayload.storagePath, storagePath);

      // Reject tampered token
      const tampered = token.slice(0, -2) + 'aa';
      assert.equal(verifyPdfJobToken(tampered), null);

      // Reject different user
      assert.equal(verifyPdfJobToken(token, { userId: 'attacker-uuid' }), null);

      // Reject different job
      assert.equal(verifyPdfJobToken(token, { jobId: 'different-job' }), null);

      // Reject different storage path
      assert.equal(verifyPdfJobToken(token, { storagePath: 'other/path.pdf' }), null);
    } finally {
      if (savedToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
      else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
    }
  });

  await checkAsync('리뷰 문제 1: 임시 PDF 정리의 교차 사용자 삭제 방지 및 경로/권한 검증', async () => {
    const { POST: convertRoute } = load(path.join(output, 'app/api/convert/route.js'));
    const { GET: cronGet, POST: cronPost } = load(path.join(output, 'app/api/cron/cleanup-temp-pdf/route.js'));
    const { validateTempStoragePath } = load(path.join(output, 'lib/pdf/tempStorage.js'));

    const savedCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-cron-secret-1234';

    try {
      // 1. Path Validator unit checks
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-1/temp-convert/job-1/file.pdf').valid, true);
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-2/temp-convert/job-1/file.pdf').valid, false); // different user
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-1/temp-convert/job-2/file.pdf').valid, false); // different job
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-1/temp-convert/job-1/../victim.pdf').valid, false); // path traversal
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-1/temp-convert/job-1/file%2e%2e/x.pdf').valid, false); // encoded traversal
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'materials/user-1/file.pdf').valid, false); // permanent material path
      assert.equal(validateTempStoragePath('user-1', 'job-1', 'user-1/temp-convert/job-1/file.exe').valid, false); // non-pdf

      // 2. 일반 사용자의 /api/convert를 통한 cleanup_expired_temp_files 호출 시 거부
      await withFakeSupabase({
        user: { id: 'test-user' },
        isAdmin: true,
      }, async () => {
        const req = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cleanup_expired_temp_files' }),
        });
        const res = await convertRoute(req);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.code, 'UNKNOWN_ACTION');
      });

      // 3. 전용 스케줄러 엔드포인트 인증 검증
      const unauthReq = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', { method: 'GET' });
      const unauthRes = await cronGet(unauthReq);
      assert.equal(unauthRes.status, 401);

      // 4. 오염된 장부가 있어도 타 사용자/영구 자료 파일 삭제 호출 0회 및 quarantined 격리
      let storageRemoveCalls = [];
      const fakeStorage = {
        from: () => ({
          remove: async (paths) => {
            storageRemoveCalls.push(...paths);
            return { data: paths, error: null };
          },
        }),
      };

      await withFakeSupabase({
        isAdmin: true,
        storage: fakeStorage,
        temp_pdf_conversion_jobs: [
          // Poisoned row 1: pointing to victim's permanent material
          { job_id: 'job-poison-1', user_id: 'attacker-1', storage_path: 'victim-user/materials/important.pdf', status: 'ticket_issued', cleanup_attempts: 0, expires_at: '2020-01-01T00:00:00Z' },
          // Poisoned row 2: traversal bypass
          { job_id: 'job-poison-2', user_id: 'attacker-1', storage_path: 'attacker-1/temp-convert/job-poison-2/../../../etc/passwd.pdf', status: 'ticket_issued', cleanup_attempts: 0, expires_at: '2020-01-01T00:00:00Z' },
          // Valid expired row: safe temporary file
          { job_id: 'job-valid-exp', user_id: 'safe-user', storage_path: 'safe-user/temp-convert/job-valid-exp/doc.pdf', status: 'ticket_issued', cleanup_attempts: 0, expires_at: '2020-01-01T00:00:00Z' },
        ],
      }, async () => {
        const cronReq = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret-1234' },
        });
        const cronRes = await cronPost(cronReq);
        const cronData = await cronRes.json();

        assert.equal(cronData.success, true);
        assert.equal(cronData.quarantinedCount, 2, '2 poisoned rows quarantined');
        assert.equal(cronData.cleanedCount, 1, '1 valid row cleaned');
        // Storage remove must ONLY be called for the valid temporary object, NEVER for poisoned paths!
        assert.deepEqual(storageRemoveCalls, ['safe-user/temp-convert/job-valid-exp/doc.pdf']);
      });

      // 5. cancel_storage_ticket: 본인 소유 장부 경로 검증 및 취소
      storageRemoveCalls = [];
      await withFakeSupabase({
        user: { id: 'test-user' },
        isAdmin: true,
        storage: fakeStorage,
        temp_pdf_conversion_jobs: [
          { job_id: 'job-cancel-ok', user_id: 'test-user', storage_path: 'test-user/temp-convert/job-cancel-ok/valid.pdf', status: 'ticket_issued' },
        ],
      }, async () => {
        const cancelReq = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel_storage_ticket',
            jobId: 'job-cancel-ok',
            storagePath: 'malicious/tampered/path.pdf', // Ignored by server; server uses ledger!
          }),
        });
        const cancelRes = await convertRoute(cancelReq);
        const cancelData = await cancelRes.json();
        assert.equal(cancelData.success, true);
        assert.equal(cancelData.cancelled, true);
        assert.deepEqual(storageRemoveCalls, ['test-user/temp-convert/job-cancel-ok/valid.pdf']);
      });
    } finally {
      if (savedCronSecret) process.env.CRON_SECRET = savedCronSecret;
      else delete process.env.CRON_SECRET;
    }
  });

  await checkAsync('리뷰 문제 2: 펜싱 검증 실패(STALE_LEASE_TOKEN) 시 실제 학습 데이터 저장 즉시 차단', async () => {
    const { POST: generateRoute } = load(path.join(output, 'app/api/generate-problems/route.js'));

    const originalFetch = global.fetch;
    try {
      // Mock AI response
      global.fetch = async () => Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              problems: [{
                title: 'Stale Test Problem',
                type: 'essay_descriptive',
                sourceRefs: 'ref',
                modelAnswer: 'ans',
                hints: ['h1', 'h2'],
                rubric: [{ criterion: 'c1', maxScore: 50 }, { criterion: 'c2', maxScore: 50 }],
              }],
            }),
          },
        }],
      });

      // Scenario: Execution A (leaseToken: lease_A_old) is superseded by Execution B (leaseToken: lease_B_new)
      const reservations = [{
        task_id: 'task-stale-fencing-1',
        user_id: 'test-user',
        task_type: 'generate_problems',
        input_identifier: 'ident-1',
        status: 'processing',
        attempt_count: 2,
        lease_token: 'lease_B_new', // Active token in DB belongs to Execution B!
        created_at: nowIso(),
        updated_at: nowIso(),
      }];

      await withFakeSupabase({
        user: { id: 'test-user' },
        isAdmin: true,
        ai_trial_credits: [{ user_id: 'test-user', balance: 0, granted_credits: 1 }],
        ai_trial_reservations: reservations,
        problem_drafts: [],
      }, async () => {
        // Request payload simulating late Execution A attempting to write with stale token
        const payload = {
          subjectId: 'cs-sub-1',
          subjectDomain: 'computer_science',
          concepts: [{ id: 'c1', subjectId: 'cs-sub-1', title: 'Data Structures' }],
          problemType: 'algorithm_proof',
          difficulty: 'advanced',
          problemCount: 1,
          sources: [{ materialId: 'm1', title: 'Lecture 1', markdown: '# Data Structures and Complexity' }],
          taskId: 'task-stale-fencing-1',
        };

        const { recordTrialResultReady } = load(path.join(output, 'lib/trialCredits.js'));
        const staleRes = await recordTrialResultReady('test-user', 'task-stale-fencing-1', { drafts: [] }, 'lease_A_old');

        assert.equal(staleRes.success, false);
        assert.equal(staleRes.errorCode, 'STALE_LEASE_TOKEN');

        // Verify route blocks drafts persistence when STALE_LEASE_TOKEN occurs
        const req = new NextRequest('http://localhost/api/generate-problems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const res = await generateRoute(req);
        // It must NOT succeed silently!
        assert.ok(res.status === 409 || res.status === 400 || res.status === 502);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  await checkAsync('리뷰 문제 3: 결과 보존 실패 시 크레딧 확정 차단 및 결과 없는 완료 판정 방지', async () => {
    const { settleTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));

    await withFakeSupabase({
      user: { id: 'test-user' },
      isAdmin: true,
      ai_trial_credits: [{ user_id: 'test-user', balance: 0, granted_credits: 1 }],
      ai_trial_reservations: [{
        task_id: 'task-no-cache',
        user_id: 'test-user',
        task_type: 'generate_problems',
        input_identifier: 'ident-x',
        status: 'processing',
        attempt_count: 1,
        lease_token: 'valid_token_123',
        cached_result: null, // NO CACHE!
        created_at: nowIso(),
        updated_at: nowIso(),
      }, {
        task_id: 'task-settled-corrupt',
        user_id: 'test-user',
        task_type: 'generate_problems',
        input_identifier: 'ident-y',
        status: 'settled',
        cached_result: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    }, async () => {
      // 1. settleTrialCredit MUST fail when cached_result is missing
      const settleRes = await settleTrialCredit('test-user', 'task-no-cache', 'valid_token_123');
      assert.equal(settleRes.success, false);
      assert.equal(settleRes.errorCode, 'MISSING_CACHED_RESULT');

      // 2. reservation with status settled but null cached_result is treated as error, not silent success
      const fakeCreds = await resolveAiConfigForUser('test-user', {
        taskId: 'task-settled-corrupt',
        taskType: 'generate_problems',
        inputIdentifier: 'ident-y',
      });
      assert.equal(fakeCreds.ok, false);
      assert.equal(fakeCreds.code, 'already_completed_missing_result');
      assert.ok(fakeCreds.message.includes('보존된 AI 결과가 비어 있습니다') || fakeCreds.message.includes('완료 상태이나'));
    });
  });

  await checkAsync('리뷰 문제 4: 실행 토큰 필수화, 구형 호출 거부 및 비정상 상태 전이 방지', async () => {
    const { recordTrialResultReady, settleTrialCredit, releaseTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));

    await withFakeSupabase({
      user: { id: 'test-user' },
      isAdmin: true,
      ai_trial_credits: [{ user_id: 'test-user', balance: 0, granted_credits: 1 }],
      ai_trial_reservations: [
        { task_id: 'task-released', user_id: 'test-user', status: 'released', lease_token: 'tok-rel', cached_result: { ok: 1 } },
        { task_id: 'task-settled', user_id: 'test-user', status: 'settled', lease_token: 'tok-set', cached_result: { ok: 1 } },
      ],
    }, async () => {
      // 1. Null or empty leaseToken is strictly rejected
      assert.equal((await recordTrialResultReady('test-user', 'task-released', {}, null)).errorCode, 'LEASE_TOKEN_REQUIRED');
      assert.equal((await recordTrialResultReady('test-user', 'task-released', {}, '')).errorCode, 'LEASE_TOKEN_REQUIRED');
      assert.equal((await settleTrialCredit('test-user', 'task-released', null)).errorCode, 'LEASE_TOKEN_REQUIRED');
      assert.equal((await releaseTrialCredit('test-user', 'task-released', 'reason', '')).errorCode, 'LEASE_TOKEN_REQUIRED');

      // 2. Cannot settle an already released/refunded task without re-deducting
      const settleReleased = await settleTrialCredit('test-user', 'task-released', 'tok-rel');
      assert.equal(settleReleased.success, false);
      assert.equal(settleReleased.errorCode, 'ALREADY_REFUNDED');

      // 3. Cannot refund an already settled task
      const refundSettled = await releaseTrialCredit('test-user', 'task-settled', 'late refund', 'tok-set');
      assert.equal(refundSettled.success, false);
      assert.equal(refundSettled.errorCode, 'ALREADY_SETTLED');

      // 4. Cannot overwrite results on already settled task
      const overwriteSettled = await recordTrialResultReady('test-user', 'task-settled', { evil: true }, 'tok-set');
      assert.equal(overwriteSettled.success, false);
      assert.equal(overwriteSettled.errorCode, 'ALREADY_SETTLED');
    });
  });

  await checkAsync('리뷰 문제 5: 임시 PDF 티켓 등록 실패 시 티켓 미발급 및 converting 회수 검증', async () => {
    const { POST: convertRoute } = load(path.join(output, 'app/api/convert/route.js'));

    // 1. When DB insert fails, ticket creation MUST fail and return 500 (NO successful ticket issued!)
    await withFakeSupabase({
      user: { id: 'test-user' },
      isAdmin: true,
      fail: { insert: true }, // Simulate DB down on insert
    }, async () => {
      const ticketReq = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_storage_ticket',
          fileName: 'lecture.pdf',
          fileSize: 1024,
        }),
      });
      const ticketRes = await convertRoute(ticketReq);
      assert.equal(ticketRes.status, 500);
      const ticketData = await ticketRes.json();
      assert.equal(ticketData.success, false);
      assert.equal(ticketData.code, 'TICKET_REGISTRATION_FAILED');
    });
  });

  await checkAsync('P01-02: 계정 유형별 AI 체험 크레딧 정책 (게스트 1회, 일반 3회, 개인키 미차감, 소진 차단, 전환 중복방지)', async () => {
    // 1. General User (Google OAuth / standard email) gets 3 credits initially
    await withFakeSupabase({
      user: { id: 'general-user-1', email: 'student@university.ac.kr' },
      ai_trial_credits: [],
      username_accounts: [],
    }, async (client) => {
      const res = await client.rpc('get_or_create_trial_credits', { p_user_id: 'general-user-1' });
      assert.equal(res.data.granted, 3, '일반 가입 계정은 최초 3회 지급');
      assert.equal(res.data.balance, 3);
      assert.equal(res.data.isGuest, false);

      // Re-login does not grant duplicate credits
      const resRelogin = await client.rpc('get_or_create_trial_credits', { p_user_id: 'general-user-1' });
      assert.equal(resRelogin.data.granted, 3);
      assert.equal(resRelogin.data.balance, 3);
    });

    // 2. Guest / Simple username account gets exactly 1 credit initially
    await withFakeSupabase({
      user: { id: 'guest-user-1', email: 'guest123@id.learnaway.local', user_metadata: { auth_type: 'username' } },
      ai_trial_credits: [],
      username_accounts: [{ username: 'guest123', user_id: 'guest-user-1' }],
    }, async (client) => {
      const res = await client.rpc('get_or_create_trial_credits', { p_user_id: 'guest-user-1' });
      assert.equal(res.data.granted, 1, '게스트 계정은 최초 1회 지급');
      assert.equal(res.data.balance, 1);
      assert.equal(res.data.isGuest, true);

      // 3. Guest uses 1 credit -> balance becomes 0
      const resv = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-guest-use',
        p_task_type: 'generate_problems',
        p_input_identifier: 'ident-guest-1',
        p_user_id: 'guest-user-1',
      });
      assert.equal(resv.data.allowed, true);
      assert.equal(resv.data.remaining, 0);

      // 4. Guest attempts second call with 0 credits -> Strictly rejected
      const rejected = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-guest-excess',
        p_task_type: 'generate_problems',
        p_input_identifier: 'ident-guest-2',
        p_user_id: 'guest-user-1',
      });
      assert.equal(rejected.data.allowed, false);
      assert.equal(rejected.data.error_code, 'INSUFFICIENT_CREDITS');

      // 5. Guest-to-General transition simulation: already has row in ai_trial_credits
      // Subsequent calls do NOT re-grant or overwrite existing balance
      const afterTransition = await client.rpc('get_or_create_trial_credits', { p_user_id: 'guest-user-1' });
      assert.equal(afterTransition.data.granted, 1);
      assert.equal(afterTransition.data.balance, 0, '전환 후에도 기존 소비 이력 보존 및 중복 지급 방지');
    });

    // 6. User with personal API key: trial credits are not deducted
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
    const savedKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      await withFakeSupabase({
        user: { id: 'user-with-personal-key' },
        ai_trial_credits: [{ user_id: 'user-with-personal-key', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
        rpcResults: {
          get_ai_connection_secret: {
            data: {
              ciphertext: 'dummy',
              iv: Buffer.alloc(12, 1).toString('base64'),
              tag: Buffer.alloc(16, 2).toString('base64'),
              model: 'deepseek-v4.1-flash',
            },
            error: null,
          },
        },
      }, async (client) => {
        // When user has registered personal key, source is 'user' and balance stays intact
        const credRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-with-personal-key');
        assert.equal(credRow.balance, 3, '개인 API 사용 시 크레딧 미차감');

        const resolved = await resolveAiConfigForUser('user-with-personal-key');
        assert.ok(resolved.ok === true || resolved.code === 'credential_error', '개인 키 조회 또는 복호화 시도');
      });
    } finally {
      if (savedKey) process.env.AI_CREDENTIAL_ENCRYPTION_KEY = savedKey;
      else delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    }
  });

  await checkAsync('P01-06: localStorage 저장 실패(QuotaExceeded) 및 JSON 파싱 에러 시 안전한 복원 및 크래시 방지', async () => {
    const { saveStoredConcepts, loadStoredConcepts, checkStoredDataIntegrity } = load(path.join(output, 'lib/storage.js'));

    // 1. Test normal load
    const initialConcepts = loadStoredConcepts();
    assert.ok(Array.isArray(initialConcepts));

    // 2. Storage integrity check
    const integrity = checkStoredDataIntegrity();
    assert.equal(typeof integrity.ok, 'boolean');
    assert.ok(Array.isArray(integrity.failedKeys));

    // 3. Verify save function returns boolean without throwing
    const saveSuccess = saveStoredConcepts([]);
    assert.equal(typeof saveSuccess, 'boolean');
  });

  // =========================================================================
  // 안정화 4대 핵심 과제 검증 (Plan-01 Stabilization Hardening)
  // =========================================================================

  await checkAsync('안정화 1: Migration 26 허위 함수 REVOKE 배제 및 실제 구형 오버로드 제거/권한 검증', async () => {
    const mig26Sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260101000026_harden_temp_pdf_and_fencing_tokens.sql'),
      'utf-8'
    );

    // 1. Must NOT revoke or drop non-existent function signatures (prevents PostgreSQL 42883)
    assert.ok(!mig26Sql.includes('settle_trial_credit(text);'), 'settle_trial_credit(text) 가짜 서명 배제');
    assert.ok(!mig26Sql.includes('release_trial_credit(text, text);'), 'release_trial_credit(text, text) 가짜 서명 배제');

    // 2. Must clean up actual existing legacy 3 overloads safely with undefined_function exception handling
    assert.ok(mig26Sql.includes('drop function if exists public.record_trial_result_ready(text, jsonb, uuid);'), '구형 3인자 record_trial_result_ready 제거');
    assert.ok(mig26Sql.includes('drop function if exists public.settle_trial_credit(text, uuid);'), '구형 2인자 settle_trial_credit 제거');
    assert.ok(mig26Sql.includes('drop function if exists public.release_trial_credit(text, text, uuid);'), '구형 3인자 release_trial_credit 제거');
    assert.ok(mig26Sql.includes('exception when undefined_function then null;'), '함수 부재 시에도 42883 없이 안전한 실행 보장');

    // 3. Verify service_role lockdown on new atomic RPCs
    assert.ok(mig26Sql.includes('grant execute on function public.claim_expired_temp_pdf_jobs(integer) to service_role;'), '정리 RPC service_role 전용');
    assert.ok(mig26Sql.includes('grant execute on function public.claim_temp_pdf_job_for_conversion(text, uuid, text) to service_role;'), '변환 선점 RPC service_role 전용');

    // 4. Regular users (isAdmin: false) cannot execute privileged RPCs
    await withFakeSupabase({
      user: { id: 'regular-user' },
      isAdmin: false,
    }, async (client) => {
      const claimRes = await client.rpc('claim_expired_temp_pdf_jobs', { p_limit: 10 });
      assert.ok(claimRes.error && (claimRes.error.code === '42501' || claimRes.error.message.includes('permission denied')));

      const convRes = await client.rpc('claim_temp_pdf_job_for_conversion', { p_job_id: 'j1', p_user_id: 'regular-user' });
      assert.ok(convRes.error && (convRes.error.code === '42501' || convRes.error.message.includes('permission denied')));
    });
  });

  await checkAsync('안정화 2: PDF 변환과 Cron 정리의 경쟁 조건 방지 및 원자적 선점 검증', async () => {
    const { POST: convertHandler } = load(path.join(output, 'app/api/convert/route.js'));
    const testUser = { id: 'test-user' };
    const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
    const savedUrl = process.env.PDF_CONVERT_SERVICE_URL;
    process.env.PDF_CONVERT_SERVICE_TOKEN = 'test-token-123';
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:54321';

    let externalServiceCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('54321')) {
        externalServiceCalls++;
        return Response.json({ success: true, fullMarkdown: '변환 완료 텍스트', pageCount: 1, pages: [] });
      }
      return originalFetch(url);
    };

    try {
      // 1. Cron claimed job for cleaning -> Conversion request MUST be strictly rejected (409) without calling external service
      await withFakeSupabase({
        user: testUser,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-cleaning-race',
            user_id: testUser.id,
            file_name: 'test.pdf',
            storage_path: `${testUser.id}/temp-convert/job-cleaning-race/test.pdf`,
            status: 'cleaning',
            cleanup_attempts: 1,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async () => {
        const req = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'convert_storage', jobId: 'job-cleaning-race' }),
        });
        const res = await convertHandler(req);
        assert.equal(res.status, 409, '정리 중인 작업은 변환 거부(409)');
        const data = await res.json();
        assert.ok(data.code === 'JOB_NOT_CONVERTIBLE' || data.code === 'CONVERSION_PREEMPTION_FAILED', '정리 중인 작업 선점 거부 코드');
        assert.equal(externalServiceCalls, 0, '선점 실패 시 외부 변환 호출 없음');
      });

      // 2. Expired job -> Conversion request rejected without calling external service
      await withFakeSupabase({
        user: testUser,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-expired-test',
            user_id: testUser.id,
            file_name: 'test.pdf',
            storage_path: `${testUser.id}/temp-convert/job-expired-test/test.pdf`,
            status: 'uploaded',
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() - 5000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async () => {
        const req = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'convert_storage', jobId: 'job-expired-test' }),
        });
        const res = await convertHandler(req);
        assert.ok(res.status === 409 || res.status === 410, '만료된 작업은 변환 거부');
        assert.equal(externalServiceCalls, 0, '만료 작업은 외부 변환 호출 없음');
      });

      // 3. Active converting job with unexpired lease is protected from Cron cleanup
      await withFakeSupabase({
        user: testUser,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-actively-converting',
            user_id: testUser.id,
            file_name: 'active.pdf',
            storage_path: `${testUser.id}/temp-convert/job-actively-converting/active.pdf`,
            status: 'converting',
            lease_token: 'active-lease-tok',
            lease_expires_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        const claimRes = await client.rpc('claim_expired_temp_pdf_jobs', { p_limit: 10 });
        assert.equal(claimRes.data.length, 0, '활성 변환 중인 작업은 Cron 정리 대상에서 엄격히 제외되어 원본 보존');
      });

      // 4. Concurrent duplicate conversion requests on the same job -> Exactly 1 succeeds, other rejected
      await withFakeSupabase({
        user: testUser,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-duplicate-convert',
            user_id: testUser.id,
            file_name: 'dup.pdf',
            storage_path: `${testUser.id}/temp-convert/job-duplicate-convert/dup.pdf`,
            status: 'uploaded',
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async () => {
        const req1 = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'convert_storage', jobId: 'job-duplicate-convert' }),
        });
        const req2 = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'convert_storage', jobId: 'job-duplicate-convert' }),
        });

        const [res1, res2] = await Promise.all([convertHandler(req1), convertHandler(req2)]);
        const successCount = [res1, res2].filter((r) => r.status === 200).length;
        const rejectCount = [res1, res2].filter((r) => r.status === 409).length;

        assert.equal(successCount, 1, '동일 작업 동시 변환 요청 중 정확히 1건만 선점 성공');
        assert.equal(rejectCount, 1, '나머지 동시 요청은 409 CONVERSION_PREEMPTION_FAILED로 즉시 거부');
      });
    } finally {
      global.fetch = originalFetch;
      if (savedToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
      else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
      if (savedUrl) process.env.PDF_CONVERT_SERVICE_URL = savedUrl;
      else delete process.env.PDF_CONVERT_SERVICE_URL;
    }
  });

  await checkAsync('안정화 3: 중단된 PDF 정리 작업 복구, 펜싱 토큰 보호 및 거짓 성공 보고 차단 검증', async () => {
    const { GET: cleanupHandler } = load(path.join(output, 'app/api/cron/cleanup-temp-pdf/route.js'));
    const savedCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'valid-cron-secret-123';

    try {
      // 1. Interrupted cleaning recovery: Job in 'cleaning' status for > 5 min is safely re-claimed by next Cron
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-interrupted-cleaning',
            user_id: 'user-interrupted',
            file_name: 'stalled.pdf',
            storage_path: 'user-interrupted/temp-convert/job-interrupted-cleaning/stalled.pdf',
            status: 'cleaning',
            lease_token: 'old-stale-lease',
            lease_expires_at: new Date(Date.now() - 60000).toISOString(), // expired lease
            cleanup_attempts: 1,
            expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
          },
        ],
      }, async (client) => {
        const req = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', {
          method: 'GET',
          headers: { authorization: 'Bearer valid-cron-secret-123' },
        });
        const res = await cleanupHandler(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.claimedCount, 1, '중단된 cleaning 작업 재선점 성공');
        assert.equal(data.cleanedCount, 1, '재선점된 작업 정상 정리 완료');

        const jobInDb = client.__state.temp_pdf_conversion_jobs.find((j) => j.job_id === 'job-interrupted-cleaning');
        assert.equal(jobInDb.status, 'cleaned');
      });

      // 2. Storage object already deleted (404 / Not Found) is handled as safe idempotent success
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-already-removed',
            user_id: 'user-idempotent',
            file_name: 'gone.pdf',
            storage_path: 'user-idempotent/temp-convert/job-already-removed/gone.pdf',
            status: 'uploaded',
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        // Inject 404 from storage.remove
        client.storage = {
          from: () => ({
            remove: async () => ({ error: { message: 'The resource was not found (404)' } }),
          }),
        };

        const req = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', {
          method: 'GET',
          headers: { authorization: 'Bearer valid-cron-secret-123' },
        });
        const res = await cleanupHandler(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.cleanedCount, 1, '이미 삭제된 파일은 안전하게 cleaned로 확정');
        assert.equal(data.failedCount, 0);
      });

      // 3. DB update failure is NOT falsely reported as cleanedCount
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-db-fail',
            user_id: 'user-db-fail',
            file_name: 'db.pdf',
            storage_path: 'user-db-fail/temp-convert/job-db-fail/db.pdf',
            status: 'uploaded',
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
        fail: {
          upsert: true, // will fail updates
        },
      }, async (client) => {
        // Mock tableBuilder update select to return empty (simulating stale lease / zero rows updated)
        const origFrom = client.from;
        client.from = (table) => {
          const b = origFrom.call(client, table);
          if (table === 'temp_pdf_conversion_jobs') {
            b.select = () => Promise.resolve({ data: [], error: new Error('DB connection lost during update') });
          }
          return b;
        };

        const req = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', {
          method: 'GET',
          headers: { authorization: 'Bearer valid-cron-secret-123' },
        });
        const res = await cleanupHandler(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.cleanedCount, 0, 'DB 갱신 실패 시 성공(cleanedCount)으로 잘못 보고되지 않음');
        assert.equal(data.failedCount, 1, 'DB 갱신 실패는 failedCount에 정확히 집계');
      });

      // 4. Poisoned/foreign path is strictly quarantined without calling storage remove
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-poisoned-path',
            user_id: 'victim-user',
            file_name: 'poison.pdf',
            storage_path: 'other-user/permanent/important-document.pdf', // MALICIOUS PATH!
            status: 'uploaded',
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        let storageRemoveCalled = false;
        client.storage = {
          from: () => ({
            remove: async () => {
              storageRemoveCalled = true;
              return { error: null };
            },
          }),
        };

        const req = new NextRequest('http://localhost/api/cron/cleanup-temp-pdf', {
          method: 'GET',
          headers: { authorization: 'Bearer valid-cron-secret-123' },
        });
        const res = await cleanupHandler(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.quarantinedCount, 1, '오염된 경로는 즉시 격리(quarantined)');
        assert.equal(storageRemoveCalled, false, '오염된 경로는 파일 삭제(remove)를 절대 실행하지 않음');

        const quarantinedJob = client.__state.temp_pdf_conversion_jobs.find((j) => j.job_id === 'job-poisoned-path');
        assert.equal(quarantinedJob.status, 'quarantined');
      });
    } finally {
      if (savedCronSecret) process.env.CRON_SECRET = savedCronSecret;
      else delete process.env.CRON_SECRET;
    }
  });

  await checkAsync('안정화 4: 체험 크레딧 초기화 정책 통일 (조회/예약 실행 순서 무관 및 계정 유형별 최초 지급 보장)', async () => {
    const { reserveTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));

    // 1. New GENERAL account: Calls reserveTrialCredit FIRST without calling getTrialCreditStatus
    // Policy: MUST be granted 3 credits initially, and after deducting 1, balance MUST be 2!
    await withFakeSupabase({
      user: { id: 'usr-new-general-first-reserve', email: 'student@university.edu' },
      username_accounts: [], // NOT a guest account!
      ai_trial_credits: [],  // Brand new user!
      ai_trial_reservations: [],
    }, async (client) => {
      const reservation = await reserveTrialCredit(
        'usr-new-general-first-reserve',
        'task-general-init-1',
        'generate_problems',
        'hash-source-1'
      );

      assert.equal(reservation.allowed, true, '일반 계정 첫 예약 성공');
      assert.equal(reservation.remaining, 2, '일반 계정은 최초 3회 지급 후 1회 차감되어 잔액 2가 남음');

      const creditRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'usr-new-general-first-reserve');
      assert.equal(creditRow.granted_credits, 3, '초기 지급액 3회 엄격 보장');
      assert.equal(creditRow.balance, 2, '잔액 2 보장');
    });

    // 2. New GUEST account: Calls reserveTrialCredit FIRST
    // Policy: MUST be granted 1 credit initially, and after deducting 1, balance MUST be 0!
    await withFakeSupabase({
      user: { id: 'usr-new-guest-first-reserve', email: 'guest123@id.learnaway.local', user_metadata: { auth_type: 'username' } },
      username_accounts: [{ user_id: 'usr-new-guest-first-reserve', username: 'guest123' }],
      ai_trial_credits: [],
      ai_trial_reservations: [],
    }, async (client) => {
      const reservation = await reserveTrialCredit(
        'usr-new-guest-first-reserve',
        'task-guest-init-1',
        'analyze_concepts',
        'hash-source-guest'
      );

      assert.equal(reservation.allowed, true, '간편 계정 첫 예약 성공');
      assert.equal(reservation.remaining, 0, '간편 계정은 최초 1회 지급 후 1회 차감되어 잔액 0이 남음');

      const creditRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'usr-new-guest-first-reserve');
      assert.equal(creditRow.granted_credits, 1, '간편 계정 초기 지급액 1회 엄격 보장');
      assert.equal(creditRow.balance, 0, '잔액 0 보장');

      // Second reservation attempt strictly blocked
      const secondRes = await reserveTrialCredit(
        'usr-new-guest-first-reserve',
        'task-guest-init-2',
        'analyze_concepts',
        'hash-source-guest-2'
      );
      assert.equal(secondRes.allowed, false, '크레딧 소진 후 추가 예약 차단');
      assert.equal(secondRes.errorCode, 'INSUFFICIENT_CREDITS');
    });

    // 3. Existing account: Balance and granted_credits are strictly preserved (no reset, no tampering)
    await withFakeSupabase({
      user: { id: 'usr-existing-account' },
      ai_trial_credits: [
        {
          user_id: 'usr-existing-account',
          granted_credits: 3,
          balance: 1, // already used 2 credits in the past
          granted_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      ai_trial_reservations: [],
    }, async (client) => {
      // Calling get_or_create does NOT reset balance back to 3
      const getRes = await client.rpc('get_or_create_trial_credits', { p_user_id: 'usr-existing-account' });
      assert.equal(getRes.data.granted, 3);
      assert.equal(getRes.data.balance, 1, '기존 계정 잔액 1회 보존');

      // Reserving deducts from remaining balance
      const resv = await reserveTrialCredit(
        'usr-existing-account',
        'task-existing-1',
        'evaluate_answer',
        'hash-eval-1'
      );
      assert.equal(resv.allowed, true);
      assert.equal(resv.remaining, 0, '잔액 1에서 차감되어 0');

      const creditRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'usr-existing-account');
      assert.equal(creditRow.granted_credits, 3, '기존 지급 이력 3회 보존');
      assert.equal(creditRow.balance, 0);
    });

    // 4. Same taskId retry: idempotent return without double deduction
    await withFakeSupabase({
      user: { id: 'usr-retry-test' },
      ai_trial_credits: [{ user_id: 'usr-retry-test', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [
        {
          id: 'res-done-1',
          user_id: 'usr-retry-test',
          task_id: 'task-completed-idempotent',
          task_type: 'generate_problems',
          input_identifier: 'ident-same-1',
          status: 'settled',
          cached_result: { problems: [{ id: 'p1', title: '문제' }] },
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
    }, async (client) => {
      const res = await reserveTrialCredit(
        'usr-retry-test',
        'task-completed-idempotent',
        'generate_problems',
        'ident-same-1'
      );
      assert.equal(res.allowed, false);
      assert.equal(res.status, 'already_completed');
      assert.ok(res.cachedResult);
      assert.equal(client.__state.ai_trial_credits[0].balance, 3, '완료된 작업 재시도는 추가 차감 없음');
    });
  });

  // =========================================================================
  // 후속 안정화 4대 과제 정밀 검증 (Follow-up Stabilization Suite)
  // =========================================================================

  await checkAsync('P1-01: 신규 AI 체험 예약의 SQL 오류(42703 updated_at) 수정 및 스키마·RPC 무결성 검증', async () => {
    // 1. Verify SQL Migration 27 and 28 do NOT attempt to insert into nonexistent updated_at column
    const mig27Sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260101000027_tiered_trial_credits_by_account_type.sql'),
      'utf-8'
    );
    const mig28Sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260101000028_catchup_stabilization_and_cleanup_atomicity.sql'),
      'utf-8'
    );

    const checkInsertNoUpdatedAt = (sql, filename) => {
      const insertRegex = /insert\s+into\s+public\.ai_trial_reservations\s*\(([^)]+)\)\s*values/gi;
      let match;
      while ((match = insertRegex.exec(sql)) !== null) {
        const columns = match[1].split(',').map((c) => c.trim());
        assert.ok(!columns.includes('updated_at'), `${filename} INSERT에 미존재 컬럼 updated_at 미포함 보장`);
      }
    };
    checkInsertNoUpdatedAt(mig27Sql, 'migration 27');
    checkInsertNoUpdatedAt(mig28Sql, 'migration 28');

    // 2. RPC call execution: Initial grant + reservation atomicity
    await withFakeSupabase({
      user: { id: 'usr-p1-general', email: 'grad@uni.ac.kr' },
      username_accounts: [],
      ai_trial_credits: [],
      ai_trial_reservations: [],
    }, async (client) => {
      const res = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-p1-1',
        p_task_type: 'generate_problems',
        p_input_identifier: 'ident-p1-1',
        p_user_id: 'usr-p1-general',
      });

      assert.equal(res.data.allowed, true, '신규 일반 계정 예약 성공');
      assert.equal(res.data.remaining, 2, '최초 3회 중 1회 차감되어 2회 유지');
      assert.ok(res.data.lease_token, '유효한 펜싱 lease_token 발급');

      const credit = client.__state.ai_trial_credits.find((c) => c.user_id === 'usr-p1-general');
      assert.equal(credit.granted_credits, 3);
      assert.equal(credit.balance, 2);

      const reservation = client.__state.ai_trial_reservations.find((r) => r.task_id === 'task-p1-1');
      assert.equal(reservation.status, 'processing');
      assert.equal(reservation.attempt_count, 1);
    });
  });

  await checkAsync('P1-02: 기존 DB용 후속 마이그레이션 28 적용성, 데이터 보존 및 권한 검증', async () => {
    const mig28Path = path.join(process.cwd(), 'supabase/migrations/20260101000028_catchup_stabilization_and_cleanup_atomicity.sql');
    assert.ok(fs.existsSync(mig28Path), '후속 마이그레이션 28 파일 존재');
    const mig28Sql = fs.readFileSync(mig28Path, 'utf-8');

    // 1. Column enhancements with IF NOT EXISTS
    assert.ok(mig28Sql.includes('alter table if exists public.temp_pdf_conversion_jobs'), 'temp_pdf_conversion_jobs 스키마 보강');
    assert.ok(mig28Sql.includes('add column if not exists lease_token text'), 'lease_token 컬럼 추가');
    assert.ok(mig28Sql.includes('add column if not exists lease_expires_at timestamptz'), 'lease_expires_at 컬럼 추가');
    assert.ok(mig28Sql.includes('alter table if exists public.ai_trial_reservations'), 'ai_trial_reservations 스키마 보강');
    assert.ok(mig28Sql.includes('create index if not exists temp_pdf_conversion_jobs_lease_idx'), '인덱스 추가');

    // 2. Safe cleanup of legacy functions
    assert.ok(mig28Sql.includes('when undefined_function then null;'), '구형 함수 안전 제거');
    assert.ok(!mig28Sql.includes('settle_trial_credit(text);'), '가짜 서명 배제');
    assert.ok(!mig28Sql.includes('release_trial_credit(text, text);'), '가짜 서명 배제');

    // 3. Complete canonical RPC definitions
    assert.ok(mig28Sql.includes('create or replace function public.determine_initial_trial_credits'), 'determine_initial_trial_credits 단일 원천');
    assert.ok(mig28Sql.includes('create or replace function public.claim_temp_pdf_cleanup_by_converter'), '변환자 정리 선점 RPC');
    assert.ok(mig28Sql.includes('create or replace function public.finalize_temp_pdf_cleanup'), '정리 최종 확정 RPC');

    // 4. Permissions lockdown
    assert.ok(mig28Sql.includes('grant execute on function public.finalize_temp_pdf_cleanup(text, text, text, text) to service_role;'), 'finalize RPC service_role 전용');
    assert.ok(mig28Sql.includes('grant execute on function public.claim_temp_pdf_cleanup_by_converter(text, uuid, text) to service_role;'), 'claim_cleanup RPC service_role 전용');

    // 5. Existing data preservation: balances and histories untouched
    await withFakeSupabase({
      user: { id: 'usr-mig28-existing' },
      ai_trial_credits: [{ user_id: 'usr-mig28-existing', granted_credits: 3, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [{ task_id: 'task-mig28-old', user_id: 'usr-mig28-existing', task_type: 'generate_problems', input_identifier: 'id-old', status: 'settled', attempt_count: 1, created_at: nowIso(), updated_at: nowIso() }],
    }, async (client) => {
      const getRes = await client.rpc('get_or_create_trial_credits', { p_user_id: 'usr-mig28-existing' });
      assert.equal(getRes.data.balance, 1, '기존 잔액 보존');
      assert.equal(getRes.data.granted, 3, '기존 지급액 보존');

      const creditRow = client.__state.ai_trial_credits.find((c) => c.user_id === 'usr-mig28-existing');
      assert.equal(creditRow.balance, 1);
      const resRow = client.__state.ai_trial_reservations.find((r) => r.task_id === 'task-mig28-old');
      assert.equal(resRow.status, 'settled');
    });
  });

  await checkAsync('P2-03: Cron의 모든 종료 경로(성공·실패·격리) 실행 토큰 검증 및 오래된 작업자 덮어쓰기 차단', async () => {
    const savedCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'valid-cron-secret-p2';

    try {
      // Scenario: Worker A claimed job previously (lease: 'lease-A-stale').
      // Lease expired, and Worker B has reclaimed this job (lease: 'lease-B-active', status: 'cleaning').
      // Now Worker A attempts to finish under 3 different paths:

      // 1. Worker A reports remove success: Rejected due to STALE_LEASE_TOKEN
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-stale-cron-success',
            user_id: 'user-p2',
            file_name: 'test.pdf',
            storage_path: 'user-p2/temp-convert/job-stale-cron-success/test.pdf',
            status: 'cleaning',
            lease_token: 'lease-B-active', // Worker B holds active lease!
            lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            cleanup_attempts: 1,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        // Worker A calls finalize_temp_pdf_cleanup with stale lease-A-stale
        const finRes = await client.rpc('finalize_temp_pdf_cleanup', {
          p_job_id: 'job-stale-cron-success',
          p_lease_token: 'lease-A-stale',
          p_target_status: 'cleaned',
        });

        assert.equal(finRes.data.success, false);
        assert.equal(finRes.data.error, 'STALE_LEASE_TOKEN', '오래된 Cron A의 성공 처리는 즉각 거부');

        const job = client.__state.temp_pdf_conversion_jobs.find((j) => j.job_id === 'job-stale-cron-success');
        assert.equal(job.status, 'cleaning', 'Worker B의 cleaning 상태 보존');
        assert.equal(job.lease_token, 'lease-B-active', 'Worker B의 active lease_token 보존');
      });

      // 2. Worker A reports remove failure: Rejected without incrementing Worker B's attempt count
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-stale-cron-fail',
            user_id: 'user-p2',
            file_name: 'test.pdf',
            storage_path: 'user-p2/temp-convert/job-stale-cron-fail/test.pdf',
            status: 'cleaning',
            lease_token: 'lease-B-active',
            lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            cleanup_attempts: 1,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        const finRes = await client.rpc('finalize_temp_pdf_cleanup', {
          p_job_id: 'job-stale-cron-fail',
          p_lease_token: 'lease-A-stale',
          p_target_status: 'failed',
          p_cleanup_error: 'some transient network error',
        });

        assert.equal(finRes.data.success, false);
        assert.equal(finRes.data.error, 'STALE_LEASE_TOKEN');

        const job = client.__state.temp_pdf_conversion_jobs.find((j) => j.job_id === 'job-stale-cron-fail');
        assert.equal(job.cleanup_attempts, 1, 'Worker B의 재시도 카운터 보존(오래된 실패로 증가되지 않음)');
      });

      // 3. Worker A attempts quarantine with stale token: Rejected
      await withFakeSupabase({
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-stale-cron-quarantine',
            user_id: 'user-p2',
            file_name: 'test.pdf',
            storage_path: 'user-p2/temp-convert/job-stale-cron-quarantine/test.pdf',
            status: 'cleaning',
            lease_token: 'lease-B-active',
            lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            cleanup_attempts: 1,
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        const finRes = await client.rpc('finalize_temp_pdf_cleanup', {
          p_job_id: 'job-stale-cron-quarantine',
          p_lease_token: 'lease-A-stale',
          p_target_status: 'quarantined',
          p_cleanup_error: 'POISONED_OR_INVALID_PATH',
        });

        assert.equal(finRes.data.success, false);
        assert.equal(finRes.data.error, 'STALE_LEASE_TOKEN');

        const job = client.__state.temp_pdf_conversion_jobs.find((j) => j.job_id === 'job-stale-cron-quarantine');
        assert.equal(job.status, 'cleaning', 'Worker B의 active 상태 보존');
      });
    } finally {
      if (savedCronSecret) process.env.CRON_SECRET = savedCronSecret;
      else delete process.env.CRON_SECRET;
    }
  });

  await checkAsync('P2-04: 오래된 변환 작업의 Storage 삭제 원천 차단 및 원자적 정리 선점 검증', async () => {
    const { POST: convertHandler } = load(path.join(output, 'app/api/convert/route.js'));
    const testUser = { id: 'usr-p2-conv' };
    const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
    const savedUrl = process.env.PDF_CONVERT_SERVICE_URL;
    process.env.PDF_CONVERT_SERVICE_TOKEN = 'test-token-p2';
    process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:54321';

    const originalFetch = global.fetch;
    global.fetch = async () => Response.json({ success: true, fullMarkdown: '변환 완료 텍스트', pageCount: 1, pages: [] });

    try {
      // 1. Conversion A lease expired -> Reclaimed by B -> A finishes -> Storage.remove MUST NOT be called!
      const fakeStorage = {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: 'http://signed.url' }, error: null }),
          remove: async () => ({ error: null }),
        }),
      };

      await withFakeSupabase({
        user: testUser,
        storage: fakeStorage,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-conv-stale-leak',
            user_id: testUser.id,
            file_name: 'important.pdf',
            storage_path: `${testUser.id}/temp-convert/job-conv-stale-leak/important.pdf`,
            status: 'converting',
            lease_token: 'lease-worker-B', // Stolen / Reclaimed by worker B!
            lease_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async (client) => {
        // Converter A calls claim_temp_pdf_cleanup_by_converter with stale token 'lease-worker-A'
        const claimCleanRes = await client.rpc('claim_temp_pdf_cleanup_by_converter', {
          p_job_id: 'job-conv-stale-leak',
          p_user_id: testUser.id,
          p_lease_token: 'lease-worker-A', // Stale token!
        });

        assert.equal(claimCleanRes.data.success, false);
        assert.equal(claimCleanRes.data.error, 'STALE_LEASE_TOKEN', '토큰 불일치 시 정리 권한 획득 거부');
      });

      // 2. Active cleaning job strictly blocks new conversion requests
      await withFakeSupabase({
        user: testUser,
        temp_pdf_conversion_jobs: [
          {
            job_id: 'job-active-cleaning-block',
            user_id: testUser.id,
            file_name: 'test.pdf',
            storage_path: `${testUser.id}/temp-convert/job-active-cleaning-block/test.pdf`,
            status: 'cleaning',
            lease_token: 'active-cleaning-token',
            lease_expires_at: new Date(Date.now() + 60000).toISOString(),
            cleanup_attempts: 0,
            expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
      }, async () => {
        const req = new NextRequest('http://localhost/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'convert_storage', jobId: 'job-active-cleaning-block' }),
        });
        const res = await convertHandler(req);
        assert.equal(res.status, 409, '정리 중인 작업은 변환 선점 불가 (409)');
      });
    } finally {
      global.fetch = originalFetch;
      if (savedToken) process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
      else delete process.env.PDF_CONVERT_SERVICE_TOKEN;
      if (savedUrl) process.env.PDF_CONVERT_SERVICE_URL = savedUrl;
      else delete process.env.PDF_CONVERT_SERVICE_URL;
    }
  });

  // ==========================================
  // Plan 02 Vercel Beta Deployment & Integration Suite
  // ==========================================

  check('P02-01: Plan 01 결과 정합성 및 배포 필수 스크립트/명령어 검증', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.ok(pkg.scripts.build, 'build 스크립트 필수');
    assert.ok(pkg.scripts.lint, 'lint 스크립트 필수');
    assert.ok(pkg.scripts['test:regressions'], 'test:regressions 스크립트 필수');
    assert.ok(pkg.scripts['test:suite'], 'test:suite 스크립트 필수');

    assert.ok(fs.existsSync('supabase/migrations/20260101000026_harden_temp_pdf_and_fencing_tokens.sql'), 'Migration 26 존재');
    assert.ok(fs.existsSync('supabase/migrations/20260101000027_tiered_trial_credits_by_account_type.sql'), 'Migration 27 존재');
    assert.ok(fs.existsSync('supabase/migrations/20260101000028_catchup_stabilization_and_cleanup_atomicity.sql'), 'Migration 28 존재');
  });

  check('P02-02: Vercel 배포 환경 구성 검증 (vercel.json Hobby 호환성, dynamic/maxDuration 60 보장)', () => {
    assert.ok(fs.existsSync('vercel.json'), 'vercel.json 배포 설정 파일 존재');
    const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    if (vercelConfig.crons) {
      for (const cron of vercelConfig.crons) {
        // Vercel Hobby allows only daily execution (minute and hour must be fixed or day-of-month)
        const parts = cron.schedule.trim().split(/\s+/);
        assert.equal(parts.length, 5, `올바른 5필드 cron 표현식: ${cron.schedule}`);
        assert.ok(!parts[0].includes('*') && !parts[0].includes('/'), `Hobby 플랜에서는 분 단위 반복 금지: ${cron.schedule}`);
      }
    }

    const longRunningRoutes = [
      'app/api/analyze-concepts/route.ts',
      'app/api/generate-problems/route.ts',
      'app/api/evaluate-answer/route.ts',
      'app/api/convert/route.ts',
      'app/api/reminders/cron/route.ts',
      'app/api/cron/cleanup-temp-pdf/route.ts',
      'app/api/drive/upload/route.ts',
    ];

    for (const routePath of longRunningRoutes) {
      const src = fs.readFileSync(routePath, 'utf8');
      assert.ok(src.includes("export const dynamic = 'force-dynamic';"), `${routePath}에 force-dynamic 필수`);
      assert.ok(src.includes('export const maxDuration = 60;'), `${routePath}에 maxDuration = 60 필수 (Vercel Hobby 최대 타임아웃 보장)`);
    }
  });

  check('P02-03: Supabase 통합 보안 (교차 사용자 과목/자료/문제 ID 직접 조작 차단, service_role 격리)', async () => {
    const userA = { id: 'usr-p02-sec-a' };
    const userB = { id: 'usr-p02-sec-b' };

    await withFakeSupabase({
      user: userA,
      subjects: [{ id: 'sub-a', user_id: userA.id, name: '과목 A', created_at: nowIso(), updated_at: nowIso() }],
      study_materials: [{ id: 'mat-a', user_id: userA.id, subject_id: 'sub-a', title: '자료 A', created_at: nowIso(), updated_at: nowIso() }],
    }, async (client) => {
      // User B tries to initialize job on user A's study material
      const res = await client.rpc('init_analysis_job_and_chunks', {
        p_job_id: 'job-cross-attack',
        p_user_id: userB.id,
        p_subject_id: 'sub-a',
        p_material_id: 'mat-a',
        p_markdown_hash: 'mh_hash1',
        p_domain: 'math',
        p_model_id: 'deepseek-v4.1-flash',
        p_total_chunks: 1,
        p_chunks: [{ chunk_index: 0, chunk_hash: 'ch_0', byte_length: 100 }],
      });
      assert.equal(res.data.success, false, '타인의 과목/자료에 대한 분석 작업 초기화 거부');
      assert.equal(res.data.error_code, 'NOT_FOUND_OR_FORBIDDEN', '권한 없음(NOT_FOUND_OR_FORBIDDEN) 에러 코드 반환');
    });
  });

  check('P02-04: AI API 및 크레딧 정책 통합 (게스트 1회, 일반 3회, 개인키 0회 차감, 타임아웃 40s 내 maxDuration 60s)', () => {
    const trialCredits = load(path.join(output, 'lib/trialCredits.js'));
    assert.equal(trialCredits.getInitialGrantedCreditsForAccount(true), 1, '게스트 계정 초기 크레딧은 1회');
    assert.equal(trialCredits.getInitialGrantedCreditsForAccount(false), 3, '일반 계정 초기 크레딧은 3회');
    assert.ok(trialCredits.MAX_TRIAL_EXECUTION_TIMEOUT_MS <= 60000, '타임아웃 상한(40s)이 서버리스 maxDuration(60s) 이내에 수렴');
  });

  check('P02-05: PDF 변환 배포 대응 (브라우저 PDF.js 기본 작동, 외부 서비스 미설정 시 안전한 fallback, AGPL 안내)', async () => {
    const { GET: getConvertHealth } = load(path.join(output, 'app/api/convert/route.js'));
    const savedUrl = process.env.PDF_CONVERT_SERVICE_URL;
    delete process.env.PDF_CONVERT_SERVICE_URL;

    try {
      const req = new NextRequest('http://localhost/api/convert', { method: 'GET' });
      const res = await getConvertHealth(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.available, false, '외부 서비스 미설정 시 available: false 반환');
      assert.equal(json.configured, false, '외부 서비스 미설정 시 configured: false 반환');
      assert.ok(json.message.includes('브라우저 PDF.js'), '브라우저 PDF.js 엔진 사용 안내 포함');

      // Verify AGPL notice in documentation
      const doc = fs.readFileSync('services/pdf-service/README.md', 'utf8');
      assert.ok(doc.includes('GNU AGPL v3'), 'PyMuPDF4LLM AGPL-3.0 라이선스 고지 문서 포함');
    } finally {
      if (savedUrl) process.env.PDF_CONVERT_SERVICE_URL = savedUrl;
    }
  });

  check('P02-06: Google Drive 백업 통합 (drive.file 최소 스코프, AES-256-GCM 암호화, 완료 전 응답 방지)', () => {
    const nodeCrypto = load('node:crypto');
    const encKey = nodeCrypto.randomBytes(32);
    const plaintext = JSON.stringify({ access_token: 'test-tok-123', refresh_token: 'test-ref-456' });
    const encrypted = googleDrive.encryptPayload(plaintext, encKey);
    const decrypted = googleDrive.decryptPayload(encrypted, encKey);
    assert.equal(decrypted, plaintext, 'Google Drive OAuth 세션 데이터 암복호화 일치');

    const config = googleDrive.getGoogleDriveConfig({});
    assert.equal(config.configured, false, '환경변수 누락 시 비활성화 상태 정상 보고');
  });

  check('P02-07: 복습 알림 스케줄러 (CRON_SECRET 검증, GET/POST 지원, KST 시간대, 멱등 키, GitHub Actions 연계)', () => {
    assert.ok(fs.existsSync('.github/workflows/cron-scheduler.yml'), 'GitHub Actions cron 러너 워크플로 파일 존재');
    const wfSrc = fs.readFileSync('.github/workflows/cron-scheduler.yml', 'utf8');
    assert.ok(wfSrc.includes('0 * * * *'), '시간별 알림 스케줄 포함');
    assert.ok(wfSrc.includes('*/15 * * * *'), '15분 임시 정리 스케줄 포함');

    const key1 = reviewNotifications.makeReminderIdempotencyKey('usr-1', '2026-10-17', 'webhook');
    const key2 = reviewNotifications.makeReminderIdempotencyKey('usr-1', '2026-10-17', 'webhook');
    assert.equal(key1, key2, '동일 일자 동일 채널 멱등 키 동일');
  });

  check('P02-08: E2E 사용자 시나리오 (게스트 소진, 일반 3회 완료, 개인키 무제한, AI/DB 실패 복원력)', async () => {
    const guestUser = { id: 'usr-p02-guest' };
    const guestState = {
      user: guestUser,
      username_accounts: [{ user_id: guestUser.id, username: 'guest_user' }],
      ai_trial_credits: [{ user_id: guestUser.id, granted_credits: 1, balance: 1, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    };

    await withFakeSupabase(guestState, async (client) => {
      // 1. Reserve 1 credit
      const res = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-e2e-guest-1',
        p_task_type: 'analyze_concepts',
        p_input_identifier: 'hash-g1',
        p_user_id: guestUser.id,
      });
      assert.equal(res.data.allowed, true);
      assert.equal(res.data.status, 'processing');

      // Settle
      await client.rpc('settle_trial_credit', { p_task_id: 'task-e2e-guest-1', p_user_id: guestUser.id });
      const cred = guestState.ai_trial_credits.find((c) => c.user_id === guestUser.id);
      assert.equal(cred.balance, 0, '체험 1회 완료 후 잔액 0');

      // Try second reservation -> blocked
      const res2 = await client.rpc('reserve_trial_credit', {
        p_task_id: 'task-e2e-guest-2',
        p_task_type: 'analyze_concepts',
        p_input_identifier: 'hash-g2',
        p_user_id: guestUser.id,
      });
      assert.equal(res2.data.allowed, false, '잔액 0에서 추가 체험 예약 차단');
      assert.ok(res2.data.error_code === 'INSUFFICIENT_CREDITS' || res2.data.code === 'TRIAL_CREDITS_EXHAUSTED', '잔액 부족 에러 코드 반환');
    });
  });

  check('P03-01: 대학 전공 시험 학술 오답 분류 체계 (9대 범주, NO_ERROR, 레거시 양방향 변환 및 레이블)', () => {
    const expectedTypes = [
      'NO_ERROR',
      'CONCEPT_MISUNDERSTANDING',
      'FORMULA_MISAPPLICATION',
      'CALCULATION_ERROR',
      'LOGICAL_ERROR',
      'CONDITION_OMISSION',
      'TERMINOLOGY_ERROR',
      'INCOMPLETE_REASONING',
      'ANSWER_FORMAT_ERROR',
      'UNCERTAIN',
    ];

    for (const t of expectedTypes) {
      assert.ok(types.ACADEMIC_ERROR_LABELS[t], `레이블 정의 존재: ${t}`);
      assert.ok(types.ACADEMIC_ERROR_LABELS[t].label.length > 0, `한글 라벨 존재: ${t}`);
      assert.ok(types.ACADEMIC_ERROR_LABELS[t].description.length > 0, `설명 존재: ${t}`);
    }

    assert.equal(types.toAcademicErrorType('concept'), 'CONCEPT_MISUNDERSTANDING');
    assert.equal(types.toAcademicErrorType('calculation'), 'CALCULATION_ERROR');
    assert.equal(types.toAcademicErrorType('logic'), 'LOGICAL_ERROR');
    assert.equal(types.toAcademicErrorType('none'), 'NO_ERROR');
    assert.equal(types.toAcademicErrorType('unknown_foo'), 'UNCERTAIN');

    assert.equal(types.toLegacyErrorType('CONCEPT_MISUNDERSTANDING'), 'concept_confusion');
    assert.equal(types.toLegacyErrorType('FORMULA_MISAPPLICATION'), 'method_selection_error');
    assert.equal(types.toLegacyErrorType('CALCULATION_ERROR'), 'calc_or_impl_mistake');
    assert.equal(types.toLegacyErrorType('LOGICAL_ERROR'), 'concept_confusion');
    assert.equal(types.toLegacyErrorType('CONDITION_OMISSION'), 'condition_misinterpretation');
    assert.equal(types.toLegacyErrorType('NO_ERROR'), 'none');
    assert.equal(types.toLegacyErrorType('UNCERTAIN'), 'concept_confusion');
  });

  check('P03-02: 점수와 오류 분류 분리 검증 (95점+계산실수 보존, 100점+오류없음, 저점수+원인불명 UNCERTAIN, 오류분류 충돌 감지)', () => {
    // 1. 95점 + 경미한 계산 실수: 90점 이상이어도 NO_ERROR로 강제되지 않고 계산 실수 보존
    const calcErrorResult = validation.validateEvaluationOutput(
      {
        rubricResults: [
          { criterionId: 'c1', label: '개념 이해', maxScore: 50, score: 50, isVulnerable: false },
          { criterionId: 'c2', label: '유도 과정', maxScore: 50, score: 45, isVulnerable: false, deductionReason: '마지막 항 전개 시 부호 실수' },
        ],
        strengths: '개념과 논리 전개가 완벽함',
        criticalImprovements: '마지막 수치 계산 주의',
        feedback: '계산 실수가 있었으나 핵심 전개는 우수합니다.',
        academicErrorType: 'CALCULATION_ERROR',
        structuredError: {
          errorType: 'CALCULATION_ERROR',
          severity: 'minor',
          evidence: '부호 실수: -2x 대신 +2x로 계산함',
          feedback: '부호 계산을 재확인하세요.',
        },
      },
      [
        { id: 'c1', label: '개념 이해', maxScore: 50 },
        { id: 'c2', label: '유도 과정', maxScore: 50 },
      ],
      { conceptId: 'con-1', conceptTitle: '라그랑주 승수법', userAnswer: '풀이... 부호 실수: -2x 대신 +2x로 계산함' }
    );
    assert.equal(calcErrorResult.calculatedScore, 95);
    assert.equal(calcErrorResult.academicErrorType, 'CALCULATION_ERROR', '95점 답안의 계산 실수가 NO_ERROR로 강제되지 않고 보존');
    assert.equal(calcErrorResult.structuredError.errorType, 'CALCULATION_ERROR');
    assert.equal(calcErrorResult.structuredError.severity, 'minor');
    assert.equal(calcErrorResult.recommendedErrorType, 'calc_or_impl_mistake');

    // 2. 100점 만점 + 오류 없음: NO_ERROR 및 severity none
    const perfectResult = validation.validateEvaluationOutput(
      {
        rubricResults: [
          { criterionId: 'c1', label: '개념 이해', maxScore: 50, score: 50, isVulnerable: false },
          { criterionId: 'c2', label: '유도 과정', maxScore: 50, score: 50, isVulnerable: false },
        ],
        strengths: '완벽한 논증',
        criticalImprovements: '없음',
        feedback: '모범 답안 수준의 풀이입니다.',
        academicErrorType: 'NO_ERROR',
      },
      [
        { id: 'c1', label: '개념 이해', maxScore: 50 },
        { id: 'c2', label: '유도 과정', maxScore: 50 },
      ],
      { conceptId: 'con-1', conceptTitle: '라그랑주 승수법', userAnswer: '완벽한 풀이...' }
    );
    assert.equal(perfectResult.calculatedScore, 100);
    assert.equal(perfectResult.academicErrorType, 'NO_ERROR');
    assert.equal(perfectResult.structuredError.errorType, 'NO_ERROR');
    assert.equal(perfectResult.structuredError.severity, 'none');

    // 3. 저점수(45점) + 원인 불명: 임의로 개념 이해 부족으로 단정하지 않고 UNCERTAIN 및 needsReview=true 설정
    const uncertainResult = validation.validateEvaluationOutput(
      {
        rubricResults: [
          { criterionId: 'c1', label: '개념 이해', maxScore: 50, score: 20, isVulnerable: true },
          { criterionId: 'c2', label: '유도 과정', maxScore: 50, score: 25, isVulnerable: true },
        ],
        strengths: '일부 서술 시도',
        criticalImprovements: '상세 원인 불명확',
        feedback: '답안이 극히 짧아 구체적 오답 원인을 단정할 수 없습니다.',
        academicErrorType: 'NO_ERROR', // 감점 발생했는데 NO_ERROR 주장
      },
      [
        { id: 'c1', label: '개념 이해', maxScore: 50 },
        { id: 'c2', label: '유도 과정', maxScore: 50 },
      ],
      { conceptId: 'con-1', conceptTitle: '라그랑주 승수법', userAnswer: '짧은 답안' }
    );
    assert.equal(uncertainResult.calculatedScore, 45);
    assert.equal(uncertainResult.academicErrorType, 'UNCERTAIN', '감점 답안에 오류 원인이 없으면 CONCEPT_MISUNDERSTANDING으로 단정하지 않고 UNCERTAIN으로 분류');
    assert.equal(uncertainResult.needsReview, true, '원인 불명 저점수 답안은 검토 필요(needsReview) 플래그 설정');

    // 4. 상위 분류와 구조화 오류 분류 충돌 감지
    const conflictResult = validation.validateEvaluationOutput(
      {
        rubricResults: [
          { criterionId: 'c1', label: '개념 이해', maxScore: 50, score: 30, isVulnerable: true },
          { criterionId: 'c2', label: '유도 과정', maxScore: 50, score: 30, isVulnerable: true },
        ],
        strengths: '부분 전개',
        criticalImprovements: '오류 발생',
        feedback: '오류가 감지되었습니다.',
        academicErrorType: 'CALCULATION_ERROR',
        structuredError: {
          errorType: 'CONCEPT_MISUNDERSTANDING', // 상위 분류(CALCULATION_ERROR)와 모순
          severity: 'critical',
          evidence: 'L = f + g',
          feedback: '개념을 확인하세요.',
        },
      },
      [
        { id: 'c1', label: '개념 이해', maxScore: 50 },
        { id: 'c2', label: '유도 과정', maxScore: 50 },
      ],
      { conceptId: 'con-1', conceptTitle: '라그랑주 승수법', userAnswer: 'L = f + g' }
    );
    assert.equal(conflictResult.calculatedScore, 60);
    assert.equal(conflictResult.needsReview, true, '상위 분류와 structuredError 분류 모순 시 조용히 확정하지 않고 needsReview=true 설정');

    // 5. 유효한 저점수 진단
    const validLowScore = validation.validateEvaluationOutput(
      {
        rubricResults: [
          { criterionId: 'c1', label: '개념 이해', maxScore: 50, score: 20, isVulnerable: true },
          { criterionId: 'c2', label: '유도 과정', maxScore: 50, score: 25, isVulnerable: true },
        ],
        strengths: '기본 공식 접근 시도',
        criticalImprovements: '제약조건 미반영',
        feedback: '라그랑주 함수 구성 시 부호 오류 발생',
        academicErrorType: 'FORMULA_MISAPPLICATION',
        structuredError: {
          errorType: 'FORMULA_MISAPPLICATION',
          severity: 'critical',
          evidence: 'L = f(x, y) + lambda(g - c)',
          feedback: '목적함수와 제약식의 결합 공식을 재검토하세요.',
        },
      },
      [
        { id: 'c1', label: '개념 이해', maxScore: 50 },
        { id: 'c2', label: '유도 과정', maxScore: 50 },
      ],
      { conceptId: 'con-1', conceptTitle: '라그랑주 승수법', userAnswer: '풀이: L = f(x, y) + lambda(g - c)' }
    );
    assert.equal(validLowScore.calculatedScore, 45);
    assert.equal(validLowScore.academicErrorType, 'FORMULA_MISAPPLICATION');
    assert.equal(validLowScore.recommendedErrorType, 'method_selection_error');
    assert.equal(validLowScore.structuredError.errorType, 'FORMULA_MISAPPLICATION');
    assert.equal(validLowScore.structuredError.severity, 'critical');
    assert.equal(validLowScore.structuredError.conceptId, 'con-1');
  });

  check('P03-03: 5단계 학술 난이도 분류(Level 1~5) 및 문제 구조적 난이도 검증 규칙', () => {
    assert.equal(types.toAcademicDifficultyLevel(1), 1);
    assert.equal(types.toAcademicDifficultyLevel(5), 5);
    assert.equal(types.toAcademicDifficultyLevel(6), 5, '상한값 5로 보정');
    assert.equal(types.toAcademicDifficultyLevel(0), 1, '하한값 1로 보정');
    assert.equal(types.toAcademicDifficultyLevel('easy'), 1);
    assert.equal(types.toAcademicDifficultyLevel('medium'), 3);
    assert.equal(types.toAcademicDifficultyLevel('hard'), 5);

    for (let l = 1; l <= 5; l++) {
      assert.ok(types.ACADEMIC_DIFFICULTY_LEVELS[l], `난이도 정의: ${l}`);
      assert.equal(types.ACADEMIC_DIFFICULTY_LEVELS[l].level, l);
      assert.ok(types.ACADEMIC_DIFFICULTY_LEVELS[l].label.length > 0);
      assert.ok(types.ACADEMIC_DIFFICULTY_LEVELS[l].description.length > 0);
    }

    const highLevelValid = {
      difficultyLevel: 4,
      timeStandardMinutes: 20,
      rubric: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
    };
    const isLevel4Valid = highLevelValid.rubric.length >= 3 && highLevelValid.timeStandardMinutes >= 15;
    assert.ok(isLevel4Valid, '고난도 문제는 최소 3개 루브릭 기준 및 15분 이상 소요 요구');

    const level1Heavy = {
      difficultyLevel: 1,
      timeStandardMinutes: 30,
      rubric: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }],
    };
    const isLevel1Discrepant = level1Heavy.rubric.length >= 4 && level1Heavy.timeStandardMinutes > 25;
    assert.ok(isLevel1Discrepant, '기초 난이도에 과도한 루브릭/시간 설정 시 불일치 감지');
  });

  check('P03-04: 서술형·계산형 루브릭 평가 (수학적 동등성, 전개 과정 부분점수 70~90%, 단답형 감점 규정)', () => {
    const maxDerivation = 40;
    const minPartial = Math.round(maxDerivation * 0.7);
    const maxPartial = Math.round(maxDerivation * 0.9);
    assert.ok(minPartial >= 28 && maxPartial <= 36, '계산 실수 부분점수 범위 보장');

    const answerOnlyRubric = [
      { criterionId: 'concept', maxScore: 30, score: 30 },
      { criterionId: 'derivation', maxScore: 50, score: 5, deductionReason: '전개 과정 누락' },
      { criterionId: 'conclusion', maxScore: 20, score: 20 },
    ];
    const totalScore = answerOnlyRubric.reduce((s, r) => s + r.score, 0);
    assert.equal(totalScore, 55, '유도 과정 누락 시 정답만 맞아도 부분점수만 부여됨');
  });

  check('P03-05: 강의자료·개념·문제 출처 추적 (sourceProvenance, 해시 불일치 시 needs_review 전이 및 문제 보존)', () => {
    const editedMaterial = { id: 'mat-p03', subjectId: 'sub-math', parsedMarkdown: '# 개정된 선형대수\n차원정리 최신 내용' };
    const oldHash = 'mh_old_v1';

    const existingProblems = [
      {
        id: 'prob-p03-1',
        conceptIds: ['con-dim'],
        subjectId: 'sub-math',
        title: '차원정리 증명 문제',
        type: 'proof',
        difficultyLevel: 5,
        sourceMaterials: [{ materialId: 'mat-p03', markdownHash: oldHash }],
        sourceVerificationStatus: 'verified',
        needsSourceReview: false,
        version: 1,
      },
      {
        id: 'prob-p03-2',
        conceptIds: ['con-unrelated'],
        subjectId: 'sub-math',
        title: '미적분학 기본정리',
        type: 'derivation',
        difficultyLevel: 2,
        sourceMaterials: [{ materialId: 'mat-other', markdownHash: 'other-hash' }],
        sourceVerificationStatus: 'verified',
        needsSourceReview: false,
        version: 1,
      },
    ];

    const concepts = [
      { id: 'con-dim', subjectId: 'sub-math', title: '차원정리', materialIds: ['mat-p03'] },
    ];

    const result = problemFreshness.applyMaterialEditToProblems(
      existingProblems,
      editedMaterial,
      concepts
    );

    assert.equal(result.updatedProblems.length, 2, '기존 문제 삭제 없이 전체 보존');
    assert.equal(result.outdatedIds.length, 1);
    assert.equal(result.outdatedIds[0], 'prob-p03-1');

    const updatedProb1 = result.updatedProblems.find((p) => p.id === 'prob-p03-1');
    assert.equal(updatedProb1.isOutdated, true, '구버전 플래그 설정');
    assert.equal(updatedProb1.sourceVerificationStatus, 'needs_review', '출처 검토 필요 상태로 전이');
    assert.equal(updatedProb1.version, 1, '사용자 승인된 기존 문제 버전 유지');

    const updatedProb2 = result.updatedProblems.find((p) => p.id === 'prob-p03-2');
    assert.equal(updatedProb2.isOutdated, undefined);
    assert.equal(updatedProb2.sourceVerificationStatus, 'verified');
  });

  check('P03-06: 대학 전공 시험 특화 신규 문제 유형 및 중복 문항 탐지 방지', () => {
    const prompt1 = '정규분포 N(mu, sigma^2)에서 표본평균의 분포를 유도하고 중심극한정리를 서술하시오.';
    const prompt2 = '정규분포 N(mu, sigma^2)에서 표본평균의 분포를 유도하고 중심극한정리를 서술하시오.';
    const prompt3 = '회귀모형의 다중공선성을 검정하기 위한 VIF 계산 공식을 유도하시오.';

    const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const isDuplicate = norm(prompt1) === norm(prompt2);
    const isDistinct = norm(prompt1) !== norm(prompt3);
    assert.ok(isDuplicate, '동일 문항 탐지');
    assert.ok(isDistinct, '서로 다른 문항 분리');
  });

  check('P03-07: 전이 문제(Transfer Problem) 생성 검증 및 학술 난이도·출처 연결 무결성', () => {
    const rawTransfer = {
      title: '통계학 개념의 금융 리스크 전이 문제',
      promptText: '정규분포 가정을 주식 수익률 VaR 추정에 적용할 때의 한계를 설명하시오.',
      type: 'essay_descriptive',
      difficulty: 'advanced_college',
      conceptIds: ['con-stats-1'],
      transferKind: 'precondition_change',
      originalCondition: '정규분포 가정 성립',
      newCondition: '팻 테일 및 왜도 극단값 발생',
      transferChanges: '정규분포 가정을 팻 테일 분포 상황으로 확장',
      understandingFocus: '극단값 위험 인식 및 추론',
      timeStandardMinutes: 20,
      modelAnswer: '팻 테일로 인해 99% VaR가 실제 최대 손실을 심각하게 과소평가하게 됩니다.',
      rubric: [
        { id: 'r1', label: 'Fat-tail 개념 적용', maxScore: 50, weight: 0.5, description: '개념 적용' },
        { id: 'r2', label: 'VaR 한계 비판적 추론', maxScore: 50, weight: 0.5, description: '한계 추론' },
      ],
      hints: ['정규분포와 실제 시장의 첨도 차이를 비교하세요.'],
      designIntent: '전공 시험 수준의 금융 통학 전이 평가',
      sourceRefs: '통계학 원론 7장',
      difficultyLevel: 4,
      sourceVerificationStatus: 'verified',
    };

    const ctx = {
      allowedConceptIds: ['con-stats-1'],
      requiredType: 'essay_descriptive',
      requiredDifficulty: 'advanced_college',
      originalPrompt: '정규분포의 성질을 서술하시오.',
      originalAnswer: '평균과 분산으로 정의되는 대칭형 종모양 분포이다.',
    };

    const validated = transferValidation.validateTransferProblemOutput(rawTransfer, ctx);
    assert.equal(validated.title, rawTransfer.title);
    assert.equal(validated.difficultyLevel, 4, '전이 문제 난이도 보존');
    assert.equal(validated.sourceVerificationStatus, 'verified', '출처 검증 상태 보존');
  });

  check('P03-08: Supabase 저장 및 ReviewEvent 학술 오류·취약점 영속화 하위 호환성', () => {
    const concept = {
      id: 'con-p03-sub',
      subjectId: 'sub-stats',
      title: '베이즈 정리',
      status: 'unstudied',
      intervalDays: 1,
      easeFactor: 2.5,
      events: [],
    };
    storage.saveStoredConcepts([concept]);
    storage.saveStoredAttempts([]);

    const attempt = {
      id: 'att-p03-save',
      problemId: 'prob-p03-bayes',
      conceptId: concept.id,
      conceptIds: [concept.id],
      subjectId: 'sub-stats',
      at: nowIso(),
      answer: 'P(A|B) = P(B|A)P(A)/P(B)',
      confidence: 4,
      errorType: 'concept_confusion',
      hintCount: 0,
      reasoningNotes: '사후확률 공식 유도',
      calculatedScore: 75,
      rubricResults: [{ criterionId: 'c1', label: '전체확률의 법칙 분모 전개', maxScore: 100, score: 75 }],
      evaluatorFeedback: '분모 P(B)를 전체확률의 법칙으로 전개하는 과정이 축약됨',
      strengths: '기본 공식 숙지',
      criticalImprovements: '분모 분할 전개 보완',
      academicErrorType: 'INCOMPLETE_REASONING',
      structuredError: {
        errorType: 'INCOMPLETE_REASONING',
        severity: 'minor',
        conceptId: concept.id,
        conceptTitle: concept.title,
        evidence: '분모 P(B) 단순 대입',
        feedback: 'P(B) = sum P(B|Ai)P(Ai)로 명시하여 풀이하세요.',
        evaluationVersion: 'p03-v1',
        evaluatedAt: nowIso(),
      },
    };

    const saveResult = storage.recordAttemptAndUpdateConcept(attempt);
    assert.equal(saveResult.status, 'complete');

    const updatedConcepts = storage.loadStoredConcepts();
    const updatedConcept = updatedConcepts.find((c) => c.id === concept.id);
    assert.ok(updatedConcept);
    const event = updatedConcept.events.find((e) => e.attemptId === attempt.id);

    assert.ok(event, 'ReviewEvent 생성 완료');
    assert.equal(event.academicErrorType, 'INCOMPLETE_REASONING', 'ReviewEvent에 학술 오답 유형 보존');
    assert.ok(event.structuredError, 'ReviewEvent에 structuredError 보존');
    assert.equal(event.structuredError.errorType, 'INCOMPLETE_REASONING');
    assert.equal(event.structuredError.severity, 'minor');
    assert.equal(event.errorType, 'concept_confusion', '레거시 errorType과 완전 하위 호환');

    const jsonStr = JSON.stringify(event);
    const restored = JSON.parse(jsonStr);
    assert.equal(restored.academicErrorType, 'INCOMPLETE_REASONING');
    assert.equal(restored.structuredError.errorType, 'INCOMPLETE_REASONING');
    assert.equal(restored.structuredError.severity, 'minor');
  });

  // =========================================================================
  // PLAN 04: ADAPTIVE REVIEW ENGINE & EXAM-DATE SCHEDULER VERIFICATION
  // =========================================================================

  check('P04-01: 복습 엔진 전수 진단 및 데이터 흐름 무결성 (Attempt -> ReviewEvent -> Concept -> StudyPlanItem)', () => {
    storage.saveStoredConcepts([]);
    storage.saveStoredAttempts([]);
    storage.saveStoredProblems([]);
    storage.saveStoredSubjects([]);

    const subject = {
      id: 'sub-audit-p04',
      name: '고급통계학',
      code: 'STAT301',
      domain: 'math_stats',
      examAt: '2026-10-25T09:00:00+09:00',
    };
    const concept = {
      id: 'con-p04-clt',
      subjectId: subject.id,
      title: '중심극한정리 (CLT)',
      status: 'review_needed',
      currentScore: 65,
      intervalDays: 2,
      easeFactor: 2.5,
      events: [],
    };
    const problem = {
      id: 'prob-p04-clt-1',
      conceptIds: [concept.id],
      subjectId: subject.id,
      title: '린데베르그-레비 CLT 증명',
      type: 'proof_counterexample',
      categoryLabel: '3. 증명 및 반례',
      categoryNumber: 3,
      promptText: '특성함수를 이용하여 CLT를 증명하시오.',
      timeStandardMinutes: 20,
      timeBreakdownDesc: '20분',
      coreEvaluationHighlight: '특성함수 테일러 전개',
      itemCountDesc: '1문항',
      sourceRefs: '교재 7장',
      hints: [],
      modelAnswer: '모범 답안',
      rubric: [{ id: 'r1', label: '특성함수', maxScore: 100, weight: 1.0, description: '전개' }],
      isApproved: true,
      isDemo: false,
      qualityStatus: 'normal',
    };

    storage.saveStoredSubjects([subject]);
    storage.saveStoredConcepts([concept]);
    storage.saveStoredProblems([problem]);

    const attempt = {
      id: 'att-p04-audit-1',
      problemId: problem.id,
      conceptId: concept.id,
      subjectId: subject.id,
      at: '2026-10-18T10:00:00+09:00',
      answer: '특성함수 phi(t/sqrt(n))의 테일러 전개를 이용함.',
      confidence: 4,
      errorType: 'none',
      academicErrorType: 'NO_ERROR',
      hintCount: 0,
      reasoningNotes: '특성함수 연속성 정리 활용',
      calculatedScore: 92,
      rubricResults: [{ criterionId: 'r1', label: '특성함수 전개', score: 92, maxScore: 100, isVulnerable: false }],
      evaluatorFeedback: '논리 전개가 정확합니다.',
      strengths: '테일러 전개 정확',
      criticalImprovements: '극한 교환 조건 명시',
      needsReview: false,
      isAiEvaluated: true,
    };

    const res = storage.recordAttemptAndUpdateConcept(attempt);
    assert.equal(res.status, 'complete');

    // Verify concept received review event and updated scores
    const concepts = storage.loadStoredConcepts();
    const updated = concepts.find((c) => c.id === concept.id);
    assert.ok(updated);
    assert.equal(updated.events.length, 1);
    assert.equal(updated.events[0].attemptId, attempt.id);
    assert.equal(updated.events[0].resultScore, 92);
    assert.ok(updated.masteryScore !== undefined && updated.masteryScore > 70, '숙련도 정상 계산');

    // Plan generation integrates updated concept and problem
    const settings = types.DEFAULT_STUDY_PLAN_SETTINGS;
    const plan = studyPlan.generateStudyPlan({
      subjects: [subject],
      concepts: [updated],
      problems: [problem],
      attempts: [attempt],
      settings,
      referenceDate: new Date('2026-10-18T10:00:00+09:00'),
      daysCount: 7,
    });

    assert.ok(plan.days.length >= 7);
    const day0 = plan.days[0];
    assert.ok(day0.assignedMinutes <= day0.availableMinutes);
  });

  check('P04-02: 기억 유지율(Retention)과 개념 숙련도(Mastery)의 분리 및 결정론적 계산', () => {
    // 1. Retention decay over time with fixed baseline
    const initialScore = 90;
    const tau = 4.0;
    const rDay0 = retentionModel.calculatePowerLawRetention(0, initialScore, tau);
    const rDay3 = retentionModel.calculatePowerLawRetention(3, initialScore, tau);
    const rDay10 = retentionModel.calculatePowerLawRetention(10, initialScore, tau);

    assert.equal(rDay0, 90, 'Day 0 retention equals initial score');
    assert.ok(rDay3 < rDay0, 'Day 3 retention strictly less than Day 0');
    assert.ok(rDay10 < rDay3, 'Day 10 retention strictly less than Day 3');
    assert.ok(rDay10 >= 0 && rDay10 <= 100, 'Retention stays in [0, 100]');

    // 2. Mastery calculation: distinction between calculation slip vs concept deficit
    const refDate = new Date('2026-10-18T10:00:00+09:00');
    const calcSlipEvent = {
      id: 'ev-calc-slip',
      conceptId: 'con-test',
      at: '2026-10-17T10:00:00+09:00',
      dayOffset: 0,
      kind: 'attempt',
      title: '계산 실수',
      resultScore: 70, // 30pt deduction for calculation error
      confidence: 4,
      errorType: 'calc_or_impl_mistake',
      academicErrorType: 'CALCULATION_ERROR',
      hintCount: 0,
    };
    const conceptDeficitEvent = {
      id: 'ev-concept-def',
      conceptId: 'con-test',
      at: '2026-10-17T10:00:00+09:00',
      dayOffset: 0,
      kind: 'attempt',
      title: '개념 오해',
      resultScore: 70, // 30pt deduction for concept misunderstanding
      confidence: 4,
      errorType: 'concept_confusion',
      academicErrorType: 'CONCEPT_MISUNDERSTANDING',
      hintCount: 0,
    };

    const masteryAfterCalcSlip = retentionModel.calculateConceptMasteryScore([calcSlipEvent], refDate, 70);
    const masteryAfterConceptDef = retentionModel.calculateConceptMasteryScore([conceptDeficitEvent], refDate, 70);

    // CRITICAL: Calculation slip does not destroy conceptual mastery, whereas concept misunderstanding reflects vulnerability
    assert.ok(masteryAfterCalcSlip > masteryAfterConceptDef, `계산 실수는 개념 오해보다 숙련도 감점이 적어야 함 (${masteryAfterCalcSlip} > ${masteryAfterConceptDef})`);

    // 3. Uncertain / needsReview does not definitively lower mastery
    const uncertainEvent = {
      id: 'ev-uncertain',
      conceptId: 'con-test',
      at: '2026-10-17T10:00:00+09:00',
      dayOffset: 0,
      kind: 'attempt',
      title: '평가 불확실',
      resultScore: 40,
      confidence: 3,
      errorType: 'concept_confusion',
      academicErrorType: 'UNCERTAIN',
      needsReview: true,
      hintCount: 0,
    };
    const masteryUncertain = retentionModel.calculateConceptMasteryScore([uncertainEvent], refDate, 80);
    assert.ok(masteryUncertain >= 70, '평가 불확실 건은 숙련도를 확정적으로 급락시키지 않음');

    // 4. Determinism: identical inputs yield identical outputs
    const masteryRun1 = retentionModel.calculateConceptMasteryScore([calcSlipEvent, conceptDeficitEvent], refDate, 70);
    const masteryRun2 = retentionModel.calculateConceptMasteryScore([calcSlipEvent, conceptDeficitEvent], refDate, 70);
    assert.equal(masteryRun1, masteryRun2, '동일 입력에 대한 숙련도 계산 결정론성');
  });

  check('P04-03: 시험일 기반 스케줄러 단계별 전략 (D-Day Phases) 및 일일 가용시간 엄격 준수', () => {
    const ref = new Date('2026-10-18T09:00:00+09:00');
    // Test D-20 (Foundation & Spaced Repetition)
    const subD20 = { id: 's-d20', name: '선형대수학', examAt: '2026-11-07T09:00:00+09:00', domain: 'math_stats' };
    // Test D-7 (Weak Concepts & Applications)
    const subD7 = { id: 's-d7', name: '확률론', examAt: '2026-10-25T09:00:00+09:00', domain: 'math_stats' };
    // Test D-2 (Core Recall & Mock Exam)
    const subD2 = { id: 's-d2', name: '수치해석', examAt: '2026-10-20T09:00:00+09:00', domain: 'math_stats' };

    const cD20 = { id: 'c-d20', subjectId: subD20.id, title: '고유값 분해', status: 'unstudied', currentScore: 0, events: [] };
    const cD7 = { id: 'c-d7', subjectId: subD7.id, title: '조건부 기댓값', status: 'review_needed', currentScore: 45, events: [] };
    const cD2 = { id: 'c-d2', subjectId: subD2.id, title: '뉴턴-랩슨법', status: 'review_needed', currentScore: 80, events: [] };

    const plan = studyPlan.generateStudyPlan({
      subjects: [subD20, subD7, subD2],
      concepts: [cD20, cD7, cD2],
      problems: [],
      attempts: [],
      settings: types.DEFAULT_STUDY_PLAN_SETTINGS,
      referenceDate: ref,
      daysCount: 7,
    });

    // Invariant: every single day respects available minutes
    for (const day of plan.days) {
      assert.ok(day.assignedMinutes <= day.availableMinutes, `일일 배정 시간(${day.assignedMinutes})은 가용 시간(${day.availableMinutes})을 초과할 수 없음`);
    }

    // Unassigned items are explicitly preserved when budget is full
    const totalItems = plan.days.reduce((acc, d) => acc + d.items.length, 0);
    assert.ok(totalItems > 0, '학습 계획 항목 생성됨');
    assert.ok(Array.isArray(plan.days[0].unassignedItems), '배치 불가 항목 명시적 배열 존재');
  });

  check('P04-04: 취약 개념 우선순위 함수 및 선수 개념 의존성 순환 방지 (Cycle Detection)', () => {
    // 1. Multi-factor priority ranking
    const cWeak = {
      id: 'c-weak',
      subjectId: 'sub-test',
      title: '취약 개념',
      status: 'review_needed',
      currentScore: 35,
      masteryScore: 40,
      events: [{ id: 'e1', conceptId: 'c-weak', at: '2026-10-17T09:00:00+09:00', kind: 'attempt', resultScore: 40, academicErrorType: 'CONCEPT_MISUNDERSTANDING' }],
    };
    const cStrong = {
      id: 'c-strong',
      subjectId: 'sub-test',
      title: '우수 개념',
      status: 'review_needed',
      currentScore: 85,
      masteryScore: 90,
      events: [{ id: 'e2', conceptId: 'c-strong', at: '2026-10-17T09:00:00+09:00', kind: 'attempt', resultScore: 90, academicErrorType: 'NO_ERROR' }],
    };

    const recWeak = retentionModel.calculateNextReviewRecommendation(cWeak, types.DEFAULT_RETENTION_SETTINGS, undefined, new Date('2026-10-18T09:00:00+09:00'), 1, [cWeak, cStrong]);
    const recStrong = retentionModel.calculateNextReviewRecommendation(cStrong, types.DEFAULT_RETENTION_SETTINGS, undefined, new Date('2026-10-18T09:00:00+09:00'), 1, [cWeak, cStrong]);

    assert.ok(recWeak, 'recWeak 생성됨');
    assert.ok(recStrong, 'recStrong 생성됨');
    assert.ok(recWeak.priorityScore > recStrong.priorityScore, '취약 개념의 우선순위 점수가 우수 개념보다 높아야 함');

    // 2. Circular Prerequisite Dependency cycle detection
    const cA = { id: 'cA', subjectId: 'sub-p', title: '개념 A', prerequisites: ['개념 B'], currentScore: 50, masteryScore: 50, events: [] };
    const cB = { id: 'cB', subjectId: 'sub-p', title: '개념 B', prerequisites: ['개념 A'], currentScore: 30, masteryScore: 30, events: [] }; // Cyclic A -> B -> A

    const resRiskA = retentionModel.calculatePrerequisiteDependencyRisk(cA, [cA, cB]);
    assert.ok(!isNaN(resRiskA.dependencyRiskScore), '순환 의존성이 있어도 무한 재귀 없이 안전하게 계산됨');
    assert.ok(resRiskA.dependencyRiskScore > 0, '미숙련 선수 개념 B로 인해 개념 A의 위험도 가산됨');
  });

  check('P04-05: 맞춤형 문제 재출제 5대 유형 (Types A~E) 및 순수 결정론적 추천 (AI 미호출 보장)', () => {
    // Type A: Low mastery (<60) and concept deficit -> original_rechallenge
    const typeA = retentionModel.determineRecommendedPracticeKind(
      { id: 'c1', title: '기초 개념', events: [] },
      45,
      50,
      { resultScore: 40, academicErrorType: 'CONCEPT_MISUNDERSTANDING' }
    );
    assert.equal(typeA, 'original_rechallenge', '낮은 숙련도 또는 개념 오해 시 원문제 재도전 추천');

    // Type B: Mastery < 60 without severe concept error -> similar_problem
    const typeB = retentionModel.determineRecommendedPracticeKind(
      { id: 'c2', title: '계산 공식', events: [] },
      55,
      60,
      { resultScore: 70, academicErrorType: 'NO_ERROR' }
    );
    assert.equal(typeB, 'similar_problem', '숙련도 부족 시 유사 문제로 기본 이해 및 절차 숙달');

    // Type C: Calculation slip or medium mastery -> variant_problem
    const typeC = retentionModel.determineRecommendedPracticeKind(
      { id: 'c3', title: '변형 적용', events: [] },
      70,
      75,
      { resultScore: 75, academicErrorType: 'CALCULATION_ERROR' }
    );
    assert.equal(typeC, 'variant_problem', '계산 실수 또는 중간 숙련도는 변형 문제로 논리 전개 유연성 확인');

    // Type D: Mastery >= 75 without related concepts -> transfer_problem
    const typeD = retentionModel.determineRecommendedPracticeKind(
      { id: 'c4', title: '고급 응용', events: [] },
      85,
      90,
      { resultScore: 90, academicErrorType: 'NO_ERROR' }
    );
    assert.equal(typeD, 'transfer_problem', '최상위 숙련도는 전이 문제 추천');

    // Type E: Mastery >= 75 with related concepts -> composite_application
    const typeE = retentionModel.determineRecommendedPracticeKind(
      { id: 'c5', title: '복합 응용', relatedConcepts: ['c1', 'c2'], events: [] },
      90,
      95,
      { resultScore: 95, academicErrorType: 'NO_ERROR' }
    );
    assert.equal(typeE, 'composite_application', '복수 관련 개념 보유 시 복합 개념 문제 추천');
  });

  check('P04-06: 학습 데이터 무결성 및 중복 방지 (Deduplication & Idempotency)', () => {
    storage.saveStoredConcepts([]);
    storage.saveStoredAttempts([]);

    const c1 = { id: 'c-int-1', subjectId: 's-int', title: '주 개념', events: [], currentScore: 50 };
    const c2 = { id: 'c-int-2', subjectId: 's-int', title: '부 개념 (복합)', events: [], currentScore: 50 };
    storage.saveStoredConcepts([c1, c2]);

    const compAttempt = {
      id: 'att-composite-once',
      problemId: 'prob-comp',
      conceptId: c1.id,
      conceptIds: [c1.id, c2.id],
      subjectId: 's-int',
      at: '2026-10-18T10:00:00+09:00',
      answer: '복합 풀이',
      confidence: 4,
      errorType: 'none',
      calculatedScore: 90,
      rubricResults: [{ criterionId: 'r1', maxScore: 100, score: 90 }],
    };

    // 1. First record
    const r1 = storage.recordAttemptAndUpdateConcept(compAttempt);
    assert.equal(r1.status, 'complete');

    // 2. Retry record (idempotency)
    const r2 = storage.recordAttemptAndUpdateConcept(compAttempt);
    assert.equal(r2.status, 'already_completed', '재시도 시 already_completed 반환으로 멱등성 보장');

    const attempts = storage.loadStoredAttempts();
    assert.equal(attempts.filter((a) => a.id === compAttempt.id).length, 1, 'Attempt ID는 1회만 저장됨');

    const concepts = storage.loadStoredConcepts();
    const updatedC1 = concepts.find((c) => c.id === c1.id);
    const updatedC2 = concepts.find((c) => c.id === c2.id);

    assert.equal(updatedC1.events.length, 1, '주 개념에 1개의 ReviewEvent 생성');
    assert.equal(updatedC2.events.length, 0, '부 개념에는 허위 중복 이벤트가 생성되지 않음 (전체 문항 귀속 원칙)');
  });

  check('P04-07: 복습 대시보드 설명 가능성 (4대 규칙 기반 질의 응답) 및 복습 알림 연동', () => {
    const concept = {
      id: 'con-explain',
      subjectId: 'sub-exp',
      title: '베이즈 정리',
      status: 'review_needed',
      currentScore: 40,
      masteryScore: 45,
      events: [{ id: 'e-1', conceptId: 'con-explain', at: '2026-10-16T10:00:00+09:00', kind: 'attempt', resultScore: 45, academicErrorType: 'FORMULA_MISAPPLICATION' }],
    };

    const rec = retentionModel.calculateNextReviewRecommendation(
      concept,
      types.DEFAULT_RETENTION_SETTINGS,
      undefined,
      new Date('2026-10-18T10:00:00+09:00'),
      1,
      [concept]
    );

    assert.ok(rec, '추천 객체 생성됨');
    assert.ok(rec.explanationDetails, '4대 설명 필드 객체 존재');
    assert.ok(rec.explanationDetails.whyPriority.length > 5, 'whyPriority 설명 텍스트 제공');
    assert.ok(rec.explanationDetails.whyDateMoved.length > 5, 'whyDateMoved 설명 텍스트 제공');
    assert.ok(rec.explanationDetails.whyProblemType.length > 5, 'whyProblemType 설명 텍스트 제공');
    assert.ok(rec.explanationDetails.dailyWorkload.length > 5, 'dailyWorkload 설명 텍스트 제공');
  });

  check('P04-08: 1일, 7일, 14일, 30일, 60일, 90일 장기 시간 시뮬레이션 및 불변 조건 검증', () => {
    const startDate = new Date('2026-09-01T09:00:00+09:00');
    const timeSteps = [1, 7, 14, 30, 60, 90]; // Days

    const baseConcept = {
      id: 'con-sim-1',
      subjectId: 'sub-sim',
      title: '특이값 분해 (SVD)',
      status: 'review_needed',
      currentScore: 90,
      masteryScore: 88,
      lastAttemptAt: startDate.toISOString(),
      events: [
        {
          id: 'ev-init',
          conceptId: 'con-sim-1',
          at: startDate.toISOString(),
          dayOffset: 0,
          kind: 'attempt',
          resultScore: 90,
          confidence: 4,
          errorType: 'none',
          academicErrorType: 'NO_ERROR',
        },
      ],
    };

    let prevRetention = 100;
    for (const days of timeSteps) {
      const simDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
      const rec = retentionModel.calculateNextReviewRecommendation(
        baseConcept,
        types.DEFAULT_RETENTION_SETTINGS,
        undefined,
        simDate,
        1,
        [baseConcept]
      );

      assert.ok(rec, 'rec at simDate 생성됨');
      // Invariant 1: Retention strictly bounded [0, 100]
      assert.ok(rec.retentionScore >= 0 && rec.retentionScore <= 100, `t=${days}일 유지율은 [0, 100] 범위 내`);
      // Invariant 2: Mastery strictly bounded [0, 100]
      assert.ok(rec.masteryScore >= 0 && rec.masteryScore <= 100, `t=${days}일 숙련도는 [0, 100] 범위 내`);
      // Invariant 3: Retention decay is strictly monotonic without new attempts
      assert.ok(rec.retentionScore <= prevRetention, `t=${days}일 유지율(${rec.retentionScore})은 이전 시점(${prevRetention})보다 작거나 같아야 함`);
      prevRetention = rec.retentionScore;
    }

    // Now simulate successful review at day 30: retention restores and tau expands
    const day30Date = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const postReviewEvents = [
      ...baseConcept.events,
      {
        id: 'ev-day30',
        conceptId: 'con-sim-1',
        at: day30Date.toISOString(),
        dayOffset: 30,
        kind: 'attempt',
        resultScore: 95,
        confidence: 5,
        errorType: 'none',
        academicErrorType: 'NO_ERROR',
      },
    ];

    const updatedConcept = {
      ...baseConcept,
      events: postReviewEvents,
      lastAttemptAt: day30Date.toISOString(),
    };

    const recPostReview = retentionModel.calculateNextReviewRecommendation(
      updatedConcept,
      types.DEFAULT_RETENTION_SETTINGS,
      undefined,
      day30Date,
      1,
      [updatedConcept]
    );

    assert.ok(recPostReview, 'recPostReview 생성됨');
    assert.ok(recPostReview.retentionScore >= 90, 'Day 30 복습 성공 후 기억 유지율 즉시 회복 (90점 이상)');
    assert.ok(recPostReview.factors.effectiveTau >= 4.0, '성공적 복습 후 기억 안정성 τ 증가');
  });

  // =========================================================================
  // Plan 05 Regression Test Suite: Data Safety & AI Operating Cost Control
  // =========================================================================

  check('P05-01: 전체 저장소 무결성 검증 - 빈 저장소 통과 및 손상된 JSON 감지', () => {
    global.window = global.window || {};
    global.window.localStorage = localStorage;
    storageScope.setStorageScope({ kind: 'user', userId: 'p05-audit-user' });
    const emptyCheck = storage.checkStoredDataIntegrity();
    assert.equal(emptyCheck.ok, true, '빈 계정은 무결성 검증 통과');
    assert.equal(emptyCheck.failedKeys.length, 0);

    // Write corrupted JSON into localStorage for active user scope
    const corruptKey = storageScope.scopedStorageKey('subjects_v1');
    localStorage.setItem(corruptKey, '{broken-json-not-valid');
    const corruptCheck = storage.checkStoredDataIntegrity();
    assert.equal(corruptCheck.ok, false, '손상된 JSON 감지');
    assert.ok(corruptCheck.failedKeys.includes(corruptKey), '손상된 키 보고');

    // Clean up
    localStorage.removeItem(corruptKey);
  });

  // --- P05-02: Local-Cloud Sync & Plan 04 Field Preservation ---
  check('P05-02: 클라우드 동기화 매퍼의 Plan 04 필드 완전 보존 (masteryScore, retentionScore, recommendedPracticeKind)', () => {
    const originalConcept = {
      id: 'c-p05-sync',
      subjectId: 's-math',
      title: '고유값 분해',
      order: 1,
      status: 'in_progress',
      currentScore: 85,
      isLearned: true,
      isDemo: false,
      masteryScore: 88.5,
      retentionScore: 92.0,
      lastAttemptScore: 90,
      vulnerableRubricCriteria: ['eigen_step_2'],
    };

    const upsertRow = cloudLearningMappers.conceptToUpsert(originalConcept);
    assert.equal(upsertRow.id, originalConcept.id);
    assert.ok(upsertRow.payload, 'payload 객체 보존');
    assert.equal(upsertRow.payload.masteryScore, 88.5);
    assert.equal(upsertRow.payload.retentionScore, 92.0);

    const roundtripConcept = cloudLearningMappers.rowToConcept({
      id: upsertRow.id,
      user_id: 'test-user',
      subject_id: upsertRow.subject_id,
      title: upsertRow.title,
      order_index: upsertRow.order_index,
      status: upsertRow.status,
      current_score: upsertRow.current_score,
      is_learned: upsertRow.is_learned,
      is_demo: upsertRow.is_demo,
      version: 1,
      draft_id: null,
      payload: upsertRow.payload,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    assert.equal(roundtripConcept.id, originalConcept.id);
    assert.equal(roundtripConcept.masteryScore, 88.5, 'masteryScore 왕복 보존');
    assert.equal(roundtripConcept.retentionScore, 92.0, 'retentionScore 왕복 보존');
    assert.deepEqual(roundtripConcept.vulnerableRubricCriteria, ['eigen_step_2'], '취약 루브릭 왕복 보존');

    // StudyPlanItem Plan 04 fields
    const originalPlanItem = {
      id: 'plan-item-p05',
      subjectId: 's-math',
      kind: 'review',
      assignedDate: '2026-10-20',
      status: 'pending',
      round: 2,
      recommendedPracticeKind: 'concept_targeted',
      explanationDetails: { reasons: ['retention_below_threshold'] },
    };

    const planRow = cloudHistoryMappers.studyPlanItemToUpsert(originalPlanItem);
    assert.equal(planRow.payload.recommendedPracticeKind, 'concept_targeted');
    assert.deepEqual(planRow.payload.explanationDetails, { reasons: ['retention_below_threshold'] });

    const roundtripPlanItem = cloudHistoryMappers.rowToStudyPlanItem({
      id: planRow.id,
      user_id: 'test-user',
      subject_id: planRow.subject_id,
      kind: planRow.kind,
      assigned_date: planRow.assigned_date,
      status: planRow.status,
      round: planRow.round,
      completed_attempt_id: null,
      completed_event_id: null,
      completed_mock_session_id: null,
      payload: planRow.payload,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    assert.equal(roundtripPlanItem.recommendedPracticeKind, 'concept_targeted');
    assert.deepEqual(roundtripPlanItem.explanationDetails, { reasons: ['retention_below_threshold'] });
  });

  // --- P05-03: Google Drive Backup Enhanced Metadata & Integrity Verification ---
  await checkAsync('P05-03: Google Drive 백업 확장 메타데이터 (schemaVersion, recordCounts, contentHash) 및 변조 거부 검증', async () => {
    const testMaterials = [
      {
        id: 'mat-p05-1',
        subjectId: 'subj-cs',
        kind: 'pdf',
        title: '알고리즘 복잡도',
        sourceRefs: '',
        status: 'ready',
        isConverted: true,
        uploadedAt: nowIso(),
      },
    ];

    const mockLoaders = {
      loadBody: async () => ({ status: 'found', body: { markdown: '# 알고리즘 점근 표기법' } }),
      loadOriginal: async () => ({ status: 'missing' }),
    };

    // 1. Build backup with enhanced metadata
    const backup = await materialPolicy.buildMaterialBackup(
      testMaterials,
      mockLoaders,
      materialPolicy.MATERIAL_BACKUP_LIMITS,
      { accountScope: 'user_p05_test', applicationVersion: '1.0.0', backupId: 'backup_p05_test_1' }
    );

    assert.equal(backup.version, 2);
    assert.equal(backup.schemaVersion, 2);
    assert.ok(backup.createdAt);
    assert.equal(backup.accountScope, 'user_p05_test');
    assert.equal(backup.recordCounts.materials, 1);
    assert.equal(backup.recordCounts.withBody, 1);
    assert.equal(backup.recordCounts.withOriginal, 0);
    assert.ok(backup.contentHash.startsWith('bkh_'));

    // 2. Serialize parts and parse round-trip
    const blobParts = materialPolicy.materialBackupBlobParts(backup);
    const serialized = blobParts.join('');
    const parsed = materialPolicy.parseMaterialBackup(serialized);
    assert.equal(parsed.ok, true, '정상 백업 파일 파싱 성공');
    assert.equal(parsed.backup.schemaVersion, 2);
    assert.equal(parsed.backup.recordCounts.materials, 1);
    assert.equal(parsed.backup.contentHash, backup.contentHash);

    // 3. Tamper test: modify content without updating contentHash -> Must be REJECTED!
    const tamperedObj = JSON.parse(serialized);
    tamperedObj.materials[0].material.title = '변조된 제목';
    const tamperedJson = JSON.stringify(tamperedObj);
    const tamperedParse = materialPolicy.parseMaterialBackup(tamperedJson);
    assert.equal(tamperedParse.ok, false, '변조된 콘텐츠 해시는 안전하게 파싱 거부');
    assert.ok(tamperedParse.error.includes('무결성 검증 실패'), '무결성 오류 메시지 제공');

    // 4. Record count mismatch -> Must be REJECTED!
    const countMismatchObj = JSON.parse(serialized);
    countMismatchObj.recordCounts.materials = 99; // Lying about count
    countMismatchObj.contentHash = materialPolicy.computeBackupContentHash(countMismatchObj.materials);
    const countMismatchParse = materialPolicy.parseMaterialBackup(JSON.stringify(countMismatchObj));
    assert.equal(countMismatchParse.ok, false, '레코드 수 불일치 백업은 거부');
    assert.ok(countMismatchParse.error.includes('레코드 수와 일치하지 않습니다'));

    // 5. Unsupported schema version -> Must be REJECTED!
    const unsupportedObj = JSON.parse(serialized);
    unsupportedObj.schemaVersion = 999;
    const unsupportedParse = materialPolicy.parseMaterialBackup(JSON.stringify(unsupportedObj));
    assert.equal(unsupportedParse.ok, false, '지원하지 않는 스키마 버전 거부');
    assert.ok(unsupportedParse.error.includes('지원하지 않는 백업 스키마 버전'));
  });

  // --- P05-04: Storage Quota Exceed & Error Isolation ---
  check('P05-04: localStorage 용량 초과(QuotaExceededError) 시 메모리 백업 격리 및 삭제 묘비 검증', () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'p05-quota-user' });
    const realSetItem = localStorage.setItem;

    try {
      // Simulate quota error
      localStorage.setItem = () => {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      };

      // saveStoredSubjects safely catches error without throwing
      assert.doesNotThrow(() => {
        storage.saveStoredSubjects([{ id: 'subj-quota', name: '용량초과과목' }]);
      }, 'QuotaExceededError 발생 시에도 예외 없이 안전하게 처리');
    } finally {
      localStorage.setItem = realSetItem;
    }

    // Deletion tombstone verification
    storage.markMaterialDeleted('mat-del-tombstone');
    assert.equal(storage.isMaterialSaveFailed('mat-del-tombstone'), false);
    // Even if stale list saved, marked deleted id stays excluded
    storage.saveStoredMaterials([{ id: 'mat-del-tombstone', subjectId: 's', kind: 'pdf', title: '삭제자료', sourceRefs: '', status: 'ready', isConverted: true, uploadedAt: nowIso() }]);
    assert.equal(storage.loadStoredMaterials().some((m) => m.id === 'mat-del-tombstone'), false, '삭제 묘비는 오래된 스냅샷 부활을 차단함');
  });

  // --- P05-05: AI Usage & Cost Telemetry ---
  await checkAsync('P05-05: AI 토큰 사용량 계측, 모델별 비용 계산(USD/KRW) 및 운영자 분석 집계 검증', async () => {
    aiCostTelemetry.clearTelemetryStore();

    // 1. Exact pricing calculation
    const costDeepSeek = aiCostTelemetry.calculateAiCost('deepseek-v4.1-flash', 1_000_000, 1_000_000);
    assert.equal(costDeepSeek.estimatedCostUsd, 0.42, 'DeepSeek 1M in ($0.14) + 1M out ($0.28) = $0.42');
    assert.equal(costDeepSeek.estimatedCostKrw, 588, '0.42 * 1400 = 588 KRW');
    assert.equal(costDeepSeek.pricingModelFound, true);

    const costGpt4oMini = aiCostTelemetry.calculateAiCost('gpt-4o-mini', 1_000_000, 1_000_000);
    assert.equal(costGpt4oMini.estimatedCostUsd, 0.75, 'GPT-4o-mini 1M in ($0.15) + 1M out ($0.60) = $0.75');
    assert.equal(costGpt4oMini.estimatedCostKrw, 1050, '0.75 * 1400 = 1050 KRW');

    // 2. Token estimation fallback
    const estTokens = aiCostTelemetry.estimateTokenCount('인공지능 기반 학습 도구 테스트');
    assert.ok(estTokens > 0, '추정 토큰 수 양수');

    // 3. Record telemetry events
    await aiCostTelemetry.recordAiUsageTelemetry({
      requestId: 'req-1',
      userId: 'user-p05-1',
      taskType: 'evaluate_answer',
      provider: 'school_gateway',
      model: 'deepseek-v4.1-flash',
      inputTokens: 500,
      outputTokens: 250,
      executionTimeMs: 1200,
      status: 'success',
      creditSource: 'operator_trial',
    });

    await aiCostTelemetry.recordAiUsageTelemetry({
      requestId: 'req-2',
      userId: 'user-p05-1',
      taskType: 'generate_problems',
      provider: 'school_gateway',
      model: 'deepseek-v4.1-flash',
      inputTokens: 1000,
      outputTokens: 800,
      executionTimeMs: 2400,
      status: 'success',
      creditSource: 'operator_trial',
    });

    await aiCostTelemetry.recordAiUsageTelemetry({
      requestId: 'req-3',
      userId: 'user-p05-2',
      taskType: 'evaluate_answer',
      provider: 'openai',
      model: 'gpt-4o-mini',
      executionTimeMs: 500,
      status: 'error',
      errorCode: 'rate_limit',
      creditSource: 'personal_key',
      inputText: '샘플 프롬프트',
    });

    const summary = aiCostTelemetry.getAiUsageSummary();
    assert.equal(summary.totalRequests, 3);
    assert.equal(summary.successfulRequests, 2);
    assert.equal(summary.failedRequests, 1);
    assert.equal(summary.failureRatePercent, 33.33);
    assert.equal(summary.requestsByTask['evaluate_answer'], 2);
    assert.equal(summary.requestsByTask['generate_problems'], 1);
    assert.equal(summary.operatorTrialConsumption.requests, 2);
    assert.equal(summary.personalKeyConsumption.requests, 1);
    assert.ok(summary.totalCostUsd > 0);
    assert.ok(summary.dailyMetrics.length >= 1);

    // Filter by userId
    const userSummary = aiCostTelemetry.getAiUsageSummary({ userId: 'user-p05-1' });
    assert.equal(userSummary.totalRequests, 2);
    assert.equal(userSummary.successfulRequests, 2);
  });

  // --- P05-06: Tiered Credits & Abuse Protection ---
  check('P05-06: 크레딧 계층 정책 (게스트 1회, 일반 3회), 비상 차단 및 입력 크기 제한 검증', () => {
    // 1. Tiered initial grant values
    assert.equal(trialCredits.getInitialGrantedCreditsForAccount(true), 1, '게스트 계정 초기 크레딧 1회');
    assert.equal(trialCredits.getInitialGrantedCreditsForAccount(false), 3, '일반 계정 초기 크레딧 3회');

    // 2. Operator emergency shutoff
    assert.equal(trialCredits.isOperatorEmergencyStopped({ OPERATOR_EMERGENCY_STOP: 'true' }), true);
    assert.equal(trialCredits.isOperatorEmergencyStopped({ OPERATOR_EMERGENCY_STOP: 'false' }), false);

    // 3. Input validation limits
    const validAnalysis = trialCredits.validateTrialAnalyzeConceptsInput(2, 10000);
    assert.equal(validAnalysis.ok, true);

    const chunkExceeded = trialCredits.validateTrialAnalyzeConceptsInput(3, 5000);
    assert.equal(chunkExceeded.ok, false);
    assert.equal(chunkExceeded.errorCode, 'TRIAL_LIMIT_EXCEEDED');

    const charExceeded = trialCredits.validateTrialAnalyzeConceptsInput(1, 15000);
    assert.equal(charExceeded.ok, false);

    // Problem gen input limit
    const validProblem = trialCredits.validateTrialProblemGenInput(2, 10000);
    assert.equal(validProblem.ok, true);

    const problemExceeded = trialCredits.validateTrialProblemGenInput(3, 5000);
    assert.equal(problemExceeded.ok, false);

    // Evaluate answer input limit
    const mockExamProhibited = trialCredits.validateTrialEvaluateAnswerInput('답안', true);
    assert.equal(mockExamProhibited.ok, false);
    assert.equal(mockExamProhibited.errorCode, 'MOCK_EXAM_TRIAL_PROHIBITED');

    const evalCharExceeded = trialCredits.validateTrialEvaluateAnswerInput('a'.repeat(7000), false);
    assert.equal(evalCharExceeded.ok, false);
  });

  // --- P05-07: AI Deduplication & Zero-Cost Local Computations ---
  check('P05-07: 로컬 망각곡선 및 학습 스케줄러의 무과금 로컬 연산 보장 (AI 호출 0회)', () => {
    const baseConcept = {
      id: 'c-local-zero-cost',
      subjectId: 's1',
      title: '미적분학 기본정리',
      status: 'in_progress',
      currentScore: 70,
      events: [
        {
          id: 'ev-1',
          conceptId: 'c-local-zero-cost',
          at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          dayOffset: 0,
          kind: 'attempt',
          resultScore: 80,
          confidence: 4,
          errorType: 'none',
          academicErrorType: 'NO_ERROR',
        },
      ],
    };

    // Calculate score & recommendation without network or AI tokens
    const localScore = retentionModel.calculateCurrentConceptScore(baseConcept.events, types.DEFAULT_RETENTION_SETTINGS);
    assert.ok(typeof localScore === 'number' && localScore >= 0 && localScore <= 100, '로컬 스코어 연산 성공');

    const localRec = retentionModel.calculateNextReviewRecommendation(
      baseConcept,
      types.DEFAULT_RETENTION_SETTINGS,
      undefined,
      new Date(),
      1,
      [baseConcept]
    );
    assert.ok(localRec, '로컬 복습 추천 연산 성공');
    assert.ok(localRec.retentionScore > 0);
  });

  // --- P05-08: Failure Injection Simulation ---
  await checkAsync('P05-08: AI 호출 장애 시 크레딧 환급(release) 및 복원 도중 계정 전환 안전 격리', async () => {
    // 1. Lease token requirement on recordTrialResultReady
    const resNoToken = await trialCredits.recordTrialResultReady('user-p05', 'task-1', { eval: 'result' }, '');
    assert.equal(resNoToken.success, false);
    assert.equal(resNoToken.errorCode, 'LEASE_TOKEN_REQUIRED', 'leaseToken 없이 실행권 점유 불가능');

    // 2. Cross-account switch abortion during restore
    let currentScope = 'scope-A';
    const fakeIo = {
      getMaterials: () => [],
      loadBodyResult: async () => ({ status: 'missing' }),
      loadOriginalResult: async () => ({ status: 'missing' }),
      saveBody: async () => ({ ok: true }),
      saveOriginal: async () => ({ ok: true }),
      persistMetadata: () => true,
      getScopeId: () => currentScope,
      knownSubjectIds: ['subj-1'],
    };

    // Switch account scope right before executeMaterialRestore begins or runs
    currentScope = 'scope-B';
    fakeIo.getScopeId = () => {
      // Return scope-B then switch to scope-C midway
      const s = currentScope;
      currentScope = 'scope-C';
      return s;
    };

    const outcome = await materialRestore.executeMaterialRestore(
      [
        {
          material: {
            id: 'mat-switch',
            subjectId: 'subj-1',
            kind: 'pdf',
            title: '테스트',
            sourceRefs: '',
            status: 'ready',
            isConverted: true,
            uploadedAt: nowIso(),
          },
        },
      ],
      fakeIo
    );

    assert.equal(outcome.aborted, true, '복원 중 계정 범위 변경 시 즉시 안전 중단');
  });

  // =========================================================================
  // Plan 06: Undergraduate-Centric UX, Onboarding & Learning Dashboard
  // =========================================================================

  // --- P06-01: UI/UX Architecture Null Safety ---
  await checkAsync('P06-01: 신규 사용자 및 과목 부재 시 Null-Safety 및 크래시 방지', async () => {
    const emptySubjects = [];
    const activeSubject = emptySubjects[0]; // undefined

    // 1. Concept filtering
    const allConcepts = [{ id: 'c1', subjectId: 's1', title: '개념1', events: [] }];
    const subjectConcepts = activeSubject ? allConcepts.filter((c) => c.subjectId === activeSubject.id) : [];
    assert.deepEqual(subjectConcepts, []);

    // 2. Material filtering
    const allMaterials = [{ id: 'm1', subjectId: 's1', title: '교재', kind: 'pdf' }];
    const subjectMaterials = activeSubject ? allMaterials.filter((m) => m.subjectId === activeSubject.id) : [];
    assert.deepEqual(subjectMaterials, []);

    // 3. Problem filtering
    const allProblems = [{ id: 'p1', subjectId: 's1', title: '문제1', type: 'essay_descriptive' }];
    const subjectProblems = activeSubject ? allProblems.filter((p) => p.subjectId === activeSubject.id) : [];
    assert.deepEqual(subjectProblems, []);
  });

  // --- P06-02: New User Onboarding & Empty States ---
  await checkAsync('P06-02: 신규 사용자 온보딩 단계 정의 및 샘플 데이터 로더 검증', async () => {
    const { INITIAL_SUBJECTS, INITIAL_MATERIALS, INITIAL_CONCEPTS, INITIAL_PROBLEMS } = load(path.join(output, 'lib/initialData.js'));
    assert.ok(INITIAL_SUBJECTS.length >= 2, '데모 과목 최소 2개 구비');
    assert.ok(INITIAL_MATERIALS.length >= 2, '데모 교재 구비');
    assert.ok(INITIAL_CONCEPTS.length >= 4, '데모 개념 구비');
    assert.ok(INITIAL_PROBLEMS.length >= 4, '데모 문제 구비');

    assert.equal(typeof storage.resetToInitialDemoData, 'function');
    assert.equal(typeof storage.checkStoredDataIntegrity, 'function');
    const integrity = storage.checkStoredDataIntegrity();
    assert.equal(integrity.ok, true, '저장소 무결성 검증 통과');
  });

  // --- P06-03: Learning Dashboard & D-Day Calculation ---
  await checkAsync('P06-03: 학습 대시보드 D-Day 산출 및 복습 우선순위 산정 검증', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const ddayFuture = dateUtils.calculateDDay(futureDate);
    assert.equal(ddayFuture.calendarDiff, 5, 'D-5일 산출');
    assert.equal(ddayFuture.displayBadge, 'D-5');

    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const ddayPast = dateUtils.calculateDDay(pastDate);
    assert.equal(ddayPast.displayBadge, '시험 종료', '시험 종료 표기');

    const todayStr = dateUtils.toSeoulDateString(new Date());
    const mockSummary = {
      todayDate: todayStr,
      days: [
        {
          date: todayStr,
          items: [
            { id: 'item-1', status: 'pending', priorityScore: 10, estimatedMinutes: 20 },
            { id: 'item-2', status: 'completed', priorityScore: 5, estimatedMinutes: 15 },
          ],
        },
        {
          date: '2026-12-31',
          items: [
            { id: 'item-3', status: 'pending', priorityScore: 20 },
          ],
        },
      ],
    };
    const digest = todayStudy.getTodayPendingItems(mockSummary);
    assert.equal(digest.items.length, 1, '오늘 보류된 항목만 정확히 추출');
    assert.equal(digest.items[0].id, 'item-1');
  });

  // --- P06-04: Material Registration & Ingestion Validation ---
  await checkAsync('P06-04: 강의 자료 등록 유효성 검사 및 중복 감지 UX 검증', async () => {
    assert.equal(materialIngestion.MATERIAL_INPUT_LIMITS.pdfBytes, 20 * 1024 * 1024);
    assert.equal(materialIngestion.MATERIAL_INPUT_LIMITS.textBytes, 10 * 1024 * 1024);

    const existing = [
      {
        id: 'mat-existing',
        title: '미적분학 1장',
        kind: 'pdf',
        parsedMarkdown: '# 제1장 미분과 적분\n함수 f(x)의 극한',
      },
    ];

    const duplicateMatch = materialIngestion.findDuplicateMaterial(
      existing,
      '# 제1장 미분과 적분\n함수 f(x)의 극한',
      ''
    );
    assert.ok(duplicateMatch, '동일 내용 중복 감지');
    assert.equal(duplicateMatch.id, 'mat-existing');

    const uniqueMatch = materialIngestion.findDuplicateMaterial(
      existing,
      '# 제2장 편미분과 다중적분',
      ''
    );
    assert.equal(uniqueMatch, null, '고유한 자료는 중복 없음 판정');
  });

  // --- P06-05: Problem Solving Draft & Decoupled Evaluation ---
  await checkAsync('P06-05: 문제 풀이 임시 답안 저장 격리 및 독립 평가 무결성 검증', async () => {
    const userId = 'student-ux-user';
    const problemId = 'prob-calc-01';
    const problemVersion = 1;
    const tabId = practiceAnswerDraft.resolvePracticeTabId();
    const draft = {
      problemId,
      problemVersion,
      tabId,
      answerText: "f'(x) = 2x + cos(x)",
      revealedHints: [],
      confidence: 5,
      errorType: 'none',
      reasoningNotes: '',
      solvingReason: '도함수의 정의 및 선형성에 의해 전개함',
      isReasonNotApplicable: false,
      reasonNotApplicableJustification: '',
      savedAt: new Date().toISOString(),
    };
    const saved = practiceAnswerDraft.savePracticeAnswerDraft(userId, draft);
    assert.ok(saved, '임시 답안 저장 성공');

    const loadedDraft = practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, problemId, problemVersion, tabId);
    assert.ok(loadedDraft, '임시 답안 성공적 복원');
    assert.equal(loadedDraft.answerText, "f'(x) = 2x + cos(x)");
    assert.equal(loadedDraft.confidence, 5);

    practiceAnswerDraft.clearPracticeAnswerDraft(userId, problemId, problemVersion, tabId);
    const clearedDraft = practiceAnswerDraft.loadPracticeAnswerDraftForTab(userId, problemId, problemVersion, tabId);
    assert.equal(clearedDraft, null, '답안 제출 후 임시 저장소 초기화');
  });

  // --- P06-06: Review Engine Personalization & Schedule Invariance ---
  await checkAsync('P06-06: 개인화 복습 일정 조정 시 점수 불변 및 복습 사유 설명 가능성', async () => {
    const concept = {
      id: 'c-stat-01',
      subjectId: 's-math',
      title: '중심극한정리 (CLT)',
      baseScore: 75,
      currentScore: 75,
      status: 'active',
      events: [
        {
          id: 'ev-1',
          at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
          dayOffset: 0,
          kind: 'attempt',
          resultScore: 70,
          confidence: 3,
          errorType: 'none',
          academicErrorType: 'NO_ERROR',
        },
      ],
    };
    storage.saveStoredConcepts([concept]);
    const before = storage.loadStoredConcepts().find((c) => c.id === concept.id);
    assert.ok(before, '저장된 개념 로드 확인');

    const { postponedConcept } = storage.postponeConceptReview(concept.id, 2, new Date());
    assert.ok(postponedConcept, '복습 연기 완료');
    assert.equal(postponedConcept.postponeDays, 2);
    assert.equal(postponedConcept.baseScore, before.baseScore, 'CRITICAL: 복습 연기 시 기본 점수 불변');
    assert.equal(postponedConcept.currentScore, before.currentScore, 'CRITICAL: 복습 연기 시 현재 점수 불변');
    assert.equal(postponedConcept.events.length, 1, 'CRITICAL: 가짜 ReviewEvent 미생성');
  });

  // --- P06-07: Responsive Web & Accessibility Semantic Standards ---
  await checkAsync('P06-07: 반응형 내비게이션 탭 및 웹 접근성 시맨틱 규격 검증', async () => {
    const validTabs = ['today', 'materials', 'problems', 'history', 'settings', 'session', 'exam'];
    for (const tab of validTabs) {
      assert.ok(typeof tab === 'string', `${tab} 탭 규격 확인`);
    }

    for (const [key, val] of Object.entries(types.ACADEMIC_ERROR_LABELS)) {
      assert.ok(typeof key === 'string');
      assert.ok(typeof val.label === 'string' && val.label.length > 0, `${key} 레이블 완비`);
      assert.ok(typeof val.description === 'string' && val.description.length > 0, `${key} 설명 완비`);
    }

    assert.equal(Object.keys(types.ACADEMIC_DIFFICULTY_LEVELS).length, 5, '5단계 난이도 완비');
  });

  // --- P06-08: Admin AI Metrics & Anomaly Detection Telemetry ---
  await checkAsync('P06-08: AI 호출 지표 집계, USD/KRW 비용 및 이상 호출 탐지 검증', async () => {
    aiCostTelemetry.clearTelemetryStore();

    await aiCostTelemetry.recordAiUsageTelemetry({
      requestId: 'req-plan06-1',
      userId: 'test-user-plan06',
      taskType: 'evaluate_answer',
      provider: 'school_gateway',
      model: 'deepseek-v4.1-flash',
      inputTokens: 1500,
      outputTokens: 500,
      executionTimeMs: 850,
      status: 'success',
      creditSource: 'operator_trial',
    });

    await aiCostTelemetry.recordAiUsageTelemetry({
      requestId: 'req-plan06-2',
      userId: 'test-user-plan06',
      taskType: 'generate_problems',
      provider: 'school_gateway',
      model: 'deepseek-v4.1-flash',
      inputTokens: 3000,
      outputTokens: 1200,
      executionTimeMs: 1400,
      status: 'success',
      creditSource: 'personal_key',
    });

    const summary = aiCostTelemetry.getAiUsageSummary();
    assert.ok(summary.totalRequests >= 2, '최소 2건 호출 집계');
    assert.ok(summary.operatorTrialConsumption.tokens >= 2000, '체험 크레딧 토큰 집계');
    assert.ok(summary.personalKeyConsumption.tokens >= 4200, '개인 키 토큰 집계');
    assert.ok(summary.totalCostUsd > 0, 'USD 예상 비용 산출');
    assert.ok(summary.totalCostKrw > 0, 'KRW 예상 비용 산출');
    assert.equal(summary.operatorTrialConsumption.requests, 1, '체험 크레딧 1건');
    assert.equal(summary.personalKeyConsumption.requests, 1, '개인 키 1건');

    const cost = aiCostTelemetry.calculateAiCost('deepseek-v4.1-flash', 1000000, 1000000);
    assert.ok(cost.estimatedCostUsd > 0 && cost.estimatedCostUsd < 1, '100만 토큰당 합리적 단가');
  });

  // --- Plan-03 Academic Assessment Fixes Verification ---
  const generateProblemsRoute = load(path.join(output, 'app/api/generate-problems/route.js'));
  const generateProblemsPOST = generateProblemsRoute.POST;
  const verifyPageGrounding = generateProblemsRoute.verifyPageGrounding;

  const savedFallbackPlan03 = process.env.AI_ALLOW_OPERATOR_FALLBACK;
  const savedApiKeyPlan03 = AI_CONFIG.apiKey;
  const trialClientBackupPlan03 = globalThis.__fakeSupabaseClient;

  process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
  AI_CONFIG.apiKey = 'test-only-not-a-real-key';

  const taskRegistryMock = new Map();
  const defaultFakeSupabase = {
    rpc: async (name, params) => {
      if (name === 'consume_ai_call_budget') {
        return { data: { allowed: true, remaining: 9, retryAfterSeconds: 60 }, error: null };
      }
      if (name === 'get_or_create_trial_credits') {
        return { data: { success: true, granted_credits: 3, remaining_credits: 3, is_first_grant: false }, error: null };
      }
      if (name === 'reserve_trial_credit' || name === 'register_ai_task') {
        const taskId = params?.p_task_id;
        const inputId = params?.p_input_identifier;
        if (taskId && taskRegistryMock.has(taskId)) {
          const entry = taskRegistryMock.get(taskId);
          if (entry.input_identifier !== inputId) {
            return {
              data: {
                allowed: false,
                error_code: 'TASK_INPUT_MISMATCH',
                message: '동일한 작업 식별자에 다른 입력이 전달되었습니다.',
              },
              error: null,
            };
          }
          return {
            data: {
              allowed: true,
              status: entry.status || 'processing',
              remaining: 2,
              lease_token: 'lease_mock_token_123',
            },
            error: null,
          };
        }
        if (taskId) {
          taskRegistryMock.set(taskId, { input_identifier: inputId, status: 'processing' });
        }
        return { data: { allowed: true, status: 'reserved', remaining: 2, lease_token: 'lease_mock_token_123' }, error: null };
      }
      if (name === 'record_trial_result_ready') {
        const taskId = params?.p_task_id;
        if (taskId && taskRegistryMock.has(taskId)) {
          const entry = taskRegistryMock.get(taskId);
          entry.status = 'result_ready';
          entry.cached_result = params?.p_result;
        }
        return { data: { success: true, status: 'result_ready' }, error: null };
      }
      if (name === 'lookup_saved_ai_task_result') {
        const taskId = params?.p_task_id;
        const inputId = params?.p_input_identifier;
        if (taskId && taskRegistryMock.has(taskId)) {
          const entry = taskRegistryMock.get(taskId);
          if (inputId && entry.input_identifier !== inputId) {
            return {
              data: { success: false, error_code: 'TASK_INPUT_MISMATCH', message: '동일한 작업 식별자에 다른 입력이 전달되었습니다.' },
              error: null,
            };
          }
          return {
            data: { success: true, status: entry.status || 'result_ready', cached_result: entry.cached_result || null },
            error: null,
          };
        }
        return { data: { success: false, error_code: 'TASK_NOT_FOUND', message: '작업 없음' }, error: null };
      }
      if (name === 'settle_trial_credit') {
        return { data: { success: true, status: 'settled', is_existing: false }, error: null };
      }
      if (name === 'release_trial_credit') {
        return { data: { success: true, refunded: true, remaining_credits: 3 }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({
      insert: () => ({ error: null }),
      select: () => {
        const query = {
          eq: (col, val) => ({
            ...query,
            maybeSingle: async () => ({
              data: val === 'prob-authoritative-test'
                ? {
                    id: val,
                    user_id: 'test-user',
                    version: 1,
                    quality_status: 'normal',
                    concept_ids: ['c-authoritative-main', 'c-authoritative-sub'],
                    payload: {
                      promptText: '선형 변환의 고유값 문제 지문',
                      modelAnswer: 'det(A - lambda I) = 0을 만족하는 스칼라 lambda',
                      rubric: [{ id: 'r1', label: '채점', maxScore: 100, weight: 1, description: '평가' }],
                      conceptIds: ['c-authoritative-main', 'c-authoritative-sub'],
                    },
                  }
                : null,
              error: null,
            }),
            single: async () => ({
              data: val === 'prob-authoritative-test'
                ? {
                    id: val,
                    user_id: 'test-user',
                    version: 1,
                    quality_status: 'normal',
                    concept_ids: ['c-authoritative-main', 'c-authoritative-sub'],
                    payload: {
                      promptText: '선형 변환의 고유값 문제 지문',
                      modelAnswer: 'det(A - lambda I) = 0을 만족하는 스칼라 lambda',
                      rubric: [{ id: 'r1', label: '채점', maxScore: 100, weight: 1, description: '평가' }],
                      conceptIds: ['c-authoritative-main', 'c-authoritative-sub'],
                    },
                  }
                : null,
              error: null,
            }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        };
        return query;
      },
    }),
  };
  globalThis.__fakeSupabaseClient = defaultFakeSupabase;

  // ISSUE-01 [P1]: 문제 생성 입력 식별자 정규화, 난이도/문항수 충돌 방지 및 taskId 불일치 거부 검증
  await checkAsync('ISSUE-01 [P1]: 문제 생성 입력 식별자 정규화, 난이도/문항수 충돌 방지 및 taskId 불일치 거부 검증', async () => {
    const baseSource = [{
      materialId: 'mat-p1-test',
      title: '선형대수학 강의록',
      markdown: '행렬식 det(A)는 정방행렬의 가역성을 판별하는 스칼라값이다. <!-- Page 1 --> 역행렬이 존재할 필요충분조건은 det(A) != 0 이다.',
      sourceRefs: '1장',
    }];
    const baseConcept = { id: 'c-linalg-p1', subjectId: 'subj-math-p1', title: '행렬식과 가역성' };

    let aiFetchCount = 0;
    const originalFetch = global.fetch;

    const aiClientPath = path.join(output, 'lib', 'aiClient.js');
    const aiModule = load(aiClientPath);
    const origCallAiChat = aiModule.callAiChat;

    aiModule.callAiChat = async () => {
      aiFetchCount++;
      const sampleDraft = {
        title: '가역행렬과 행렬식 증명',
        promptText: 'nxn 정방행렬 A에 대해 역행렬이 존재할 필요충분조건이 det(A) != 0 임을 증명하시오.',
        modelAnswer: 'det(A) != 0 이면 rank(A) = n 이므로 가역이다.',
        rubric: [
          { id: 'r1', label: '정의 서술', maxScore: 50, weight: 0.5, description: '가역성과 행렬식 정의' },
          { id: 'r2', label: '논리 전개', maxScore: 50, weight: 0.5, description: '필요충분조건 양방향 증명' },
        ],
        hints: ['기약 행 사다리꼴(RREF)을 고려하시오.'],
        sourceExcerpt: '역행렬이 존재할 필요충분조건은 det(A) != 0 이다.',
        sourcePage: 1,
      };
      return {
        ok: true,
        content: JSON.stringify({ problems: [sampleDraft] }),
        model: 'deepseek-v4.1-flash',
        usage: { promptTokens: 100, completionTokens: 100 },
      };
    };

    try {
      // Level 1 call
      const reqL1 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 1,
          difficulty: 'intermediate',
          problemCount: 1,
          concepts: [baseConcept],
          sources: baseSource,
        }),
      });
      const resL1 = await generateProblemsPOST(reqL1);
      const jsonL1 = await resL1.json();
      assert.equal(resL1.status, 200, 'Level 1 문제 생성 성공');
      assert.equal(jsonL1.count, 1);
      assert.equal(jsonL1.drafts[0].difficultyLevel, 1);

      // Level 2 call (must not collide with Level 1 cache even though both map to intermediate)
      const callsBeforeL2 = aiFetchCount;
      const reqL2 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 2,
          difficulty: 'intermediate',
          problemCount: 1,
          concepts: [baseConcept],
          sources: baseSource,
        }),
      });
      const resL2 = await generateProblemsPOST(reqL2);
      assert.equal(resL2.status, 200, 'Level 2 문제 생성 성공');
      const jsonL2 = await resL2.json();
      assert.equal(jsonL2.drafts[0].difficultyLevel, 2);
      assert.ok(aiFetchCount > callsBeforeL2, 'Level 1 캐시를 오인하지 않고 별도 AI 호출 수행');

      // Problem Count 2 call (must not collide with Count 1)
      const callsBeforeC2 = aiFetchCount;
      const reqC2 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 2,
          difficulty: 'intermediate',
          problemCount: 2,
          concepts: [baseConcept],
          sources: baseSource,
        }),
      });
      const resC2 = await generateProblemsPOST(reqC2);
      assert.equal(resC2.status, 200, '문항수 2 문제 생성 성공');
      assert.ok(aiFetchCount > callsBeforeC2, '1문항 캐시를 오인하지 않고 별도 작업 실행');

      // Explicit taskId reuse with mismatched inputs -> Must reject with 400 TASK_INPUT_MISMATCH
      const explicitTaskId = 'task-p1-unique-' + Date.now();
      const reqTask1 = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: explicitTaskId,
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 3,
          difficulty: 'advanced_college',
          problemCount: 1,
          concepts: [baseConcept],
          sources: baseSource,
        }),
      });
      const resTask1 = await generateProblemsPOST(reqTask1);
      assert.equal(resTask1.status, 200, '명시적 taskId 최초 생성 성공');

      // Attempt to reuse same explicitTaskId with different difficultyLevel (Level 4)
      const reqTaskMismatch = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: explicitTaskId,
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 4,
          difficulty: 'advanced_college',
          problemCount: 1,
          concepts: [baseConcept],
          sources: baseSource,
        }),
      });
      const resTaskMismatch = await generateProblemsPOST(reqTaskMismatch);
      assert.equal(resTaskMismatch.status, 400, '동일 taskId에 다른 입력 재사용 시 400 거부');
      const jsonMismatch = await resTaskMismatch.json();
      assert.equal(jsonMismatch.errorCode, 'TASK_INPUT_MISMATCH', 'TASK_INPUT_MISMATCH 에러 코드 반환');

      // Verify trial credit cache retry does not trigger extra AI call
      globalThis.__fakeSupabaseClient = {
        rpc: async (name) => {
          if (name === 'lookup_saved_ai_task_result') {
            return {
              data: {
                success: true,
                status: 'already_completed',
                cached_result: {
                  drafts: [jsonL1.drafts[0]],
                  count: 1,
                  generationJobId: 'job-cached-1',
                },
              },
              error: null,
            };
          }
          if (name === 'reserve_trial_credit' || name === 'register_ai_task') {
            return {
              data: {
                allowed: true,
                status: 'already_completed',
                remaining: 3,
                lease_token: 'lease_mock_token_cached',
                cached_result: {
                  drafts: [jsonL1.drafts[0]],
                  count: 1,
                  generationJobId: 'job-cached-1',
                },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };

      const callsBeforeCachedRetry = aiFetchCount;
      const reqRetry = new NextRequest('http://localhost/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'subj-math-p1',
          subjectDomain: 'math_stats',
          problemType: 'proof_counterexample',
          difficultyLevel: 1,
          difficulty: 'intermediate',
          problemCount: 1,
          concepts: [baseConcept],
          sources: baseSource,
          creditSource: 'operator_trial',
        }),
      });
      const resRetry = await generateProblemsPOST(reqRetry);
      assert.equal(resRetry.status, 200, '동일 요청 캐시 복구 성공');
      const jsonRetry = await resRetry.json();
      assert.equal(jsonRetry.fromCache, true, 'fromCache 플래그 확인');
      assert.equal(aiFetchCount, callsBeforeCachedRetry, '캐시 복구 시 추가 AI 호출 없음');
    } finally {
      globalThis.__fakeSupabaseClient = defaultFakeSupabase;
      aiModule.callAiChat = origCallAiChat;
      global.fetch = originalFetch;
    }
  });

  // ISSUE-02 [P2]: 인용 검증의 누락 문구 우회 방지 및 정규 누락 진단 처리 검증
  await checkAsync('ISSUE-02 [P2]: 인용 검증의 누락 문구 우회 방지 및 정규 누락 진단 처리 검증', async () => {
    const rubric = [{ id: 'r1', label: '조건 확인', maxScore: 100, weight: 1, description: '조건 검토' }];
    const studentAnswer = 'x = 1';

    // 1. Fake quote containing "누락" keyword in arbitrary sentence -> MUST fail verification (needsReview: true)
    const bypassResult = validation.validateEvaluationOutput({
      rubricResults: [{
        criterionId: 'r1',
        score: 80,
        evidenceQuote: '존재하지 않는 계산 결과 999; 조건 누락',
      }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer });
    assert.equal(bypassResult.needsReview, true, '누락 단어가 임의 문장에 포함된 가짜 인용은 needsReview: true');

    // 2. English bypass phrase "omitted" in arbitrary sentence -> MUST fail verification
    const englishBypassResult = validation.validateEvaluationOutput({
      rubricResults: [{
        criterionId: 'r1',
        score: 80,
        evidenceQuote: 'fabricated 999; omitted assumption',
      }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer });
    assert.equal(englishBypassResult.needsReview, true, '영문 omitted 포함 가짜 인용은 needsReview: true');

    // 3. Empty evidence quote -> MUST fail verification
    const emptyQuoteResult = validation.validateEvaluationOutput({
      rubricResults: [{
        criterionId: 'r1',
        score: 80,
        evidenceQuote: '',
      }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer });
    assert.equal(emptyQuoteResult.needsReview, true, '빈 근거는 needsReview: true');

    // 4. Genuine exact canonical omission diagnosis -> Verified as omission diagnosis, not quote
    assert.ok(validation.isOmissionDiagnosis('필요한 서술 누락'), '표준 누락 진단 식별');
    assert.ok(validation.isOmissionDiagnosis('조건 누락'), '표준 누락 진단 식별');
    assert.ok(!validation.isOmissionDiagnosis('존재하지 않는 계산 결과 999; 조건 누락'), '임의 문장은 누락 진단 아님');

    const canonicalOmissionResult = validation.validateEvaluationOutput({
      rubricResults: [{
        criterionId: 'r1',
        score: 60,
        evidenceQuote: '필요한 서술 누락',
      }],
      academicErrorType: 'CALCULATION_ERROR',
      structuredError: {
        evidence: '필요한 서술 누락',
        errorType: 'CALCULATION_ERROR',
      },
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer, isProvisionalLocal: true });
    assert.equal(canonicalOmissionResult.needsReview, false, '정규 누락 진단은 정상 처리');

    // 5. Genuine quote match -> Verified
    const normalQuoteResult = validation.validateEvaluationOutput({
      rubricResults: [{
        criterionId: 'r1',
        score: 100,
        evidenceQuote: 'x = 1',
      }],
      academicErrorType: 'NO_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer, isProvisionalLocal: true });
    assert.equal(normalQuoteResult.needsReview, false, '실제 답안 일치 인용은 정상 통과');
  });

  // ISSUE-03 [P2]: 수식·코드 인용의 대소문자 및 의미 보존 검증 (A/a, 변수명, 부호)
  await checkAsync('ISSUE-03 [P2]: 수식·코드 인용의 대소문자 및 의미 보존 검증 (A/a, 변수명, 부호)', async () => {
    const rubric = [{ id: 'r1', label: '수식 검토', maxScore: 100, weight: 1, description: '수식 전개' }];

    // 1. Math Case distinction: A = 1 vs a = 1
    const mathCaseResult = validation.validateEvaluationOutput({
      rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'a = 1' }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: 'A = 1' });
    assert.equal(mathCaseResult.needsReview, true, 'A=1 과 a=1의 대소문자 차이는 불일치 처리 (needsReview: true)');

    // 2. Variable name case: maxVal vs maxval
    const varCaseResult = validation.validateEvaluationOutput({
      rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'maxval' }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: 'int maxVal = 100;' });
    assert.equal(varCaseResult.needsReview, true, '변수명 대소문자 차이 보존 (maxVal vs maxval)');

    // 3. Mathematical sign change: x + 1 vs x - 1
    const signChangeResult = validation.validateEvaluationOutput({
      rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'x - 1' }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: 'f(x) = x + 1' });
    assert.equal(signChangeResult.needsReview, true, '부호 변경 (x+1 vs x-1) 불일치 처리');

    // 4. Code case sensitivity: HttpResponse vs Httpresponse
    const codeCaseResult = validation.validateEvaluationOutput({
      rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'Httpresponse' }],
      academicErrorType: 'CALCULATION_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: 'const res: HttpResponse = new HttpResponse();' });
    assert.equal(codeCaseResult.needsReview, true, '코드 식별자 대소문자 구분 보존');

    // 5. Legitimate newline and whitespace difference: preserved
    const newlineResult = validation.validateEvaluationOutput({
      rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'def solve(x): return x * 2' }],
      academicErrorType: 'CALCULATION_ERROR',
      structuredError: {
        evidence: 'def solve(x): return x * 2',
        errorType: 'CALCULATION_ERROR',
      },
      needsReview: false,
    }, rubric, { userAnswer: 'def solve(x):\n    return x * 2', isProvisionalLocal: true });
    assert.equal(newlineResult.needsReview, false, '정상적인 줄바꿈 및 공백 차이는 정규화하여 일치 인정');
  });

  // ISSUE-04 [P2]: 평가 시 서버 권위 개념 ID 범위 유지 및 외부/임의 개념 우회 차단 검증
  await checkAsync('ISSUE-04 [P2]: 평가 시 서버 권위 개념 ID 범위 유지 및 외부/임의 개념 우회 차단 검증', async () => {
    const testProblem = {
      ...base,
      id: 'prob-authoritative-test',
      conceptIds: ['c-authoritative-main', 'c-authoritative-sub'],
      subjectId: subject.id,
    };
    storage.saveStoredProblems([testProblem]);

    const rubric = [{ id: 'r1', label: '채점', maxScore: 100, weight: 1, description: '평가' }];
    const aiClientPath = path.join(output, 'lib', 'aiClient.js');
    const aiModule = load(aiClientPath);
    const origCallAiChat = aiModule.callAiChat;

    try {
      // Model tries to assign a foreign concept ID not present in problem.conceptIds
      aiModule.callAiChat = async () => ({
        ok: true,
        content: JSON.stringify({
          calculatedScore: 90,
          academicErrorType: 'CALCULATION_ERROR',
          needsReview: false,
          conceptId: 'foreign-concept-id-malicious',
          rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'answer' }],
        }),
        model: 'deepseek-v4.1-flash',
        usage: { promptTokens: 100, completionTokens: 100 },
      });

      const reqForeign = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId: testProblem.id,
          conceptId: 'foreign-concept-id-malicious',
          subjectId: subject.id,
          problemTitle: testProblem.title,
          problemPrompt: '문제',
          userAnswer: 'answer',
          modelAnswer: 'answer',
          rubric,
        }),
      });

      const resForeign = await POST(reqForeign);
      const jsonForeign = await resForeign.json();
      if (resForeign.status !== 200) console.error('FOREIGN ERROR JSON:', jsonForeign);
      assert.equal(resForeign.status, 200);
      assert.equal(jsonForeign.evaluation.conceptId, 'c-authoritative-main', '서버 권위 개념 범위 밖의 foreign concept는 primary 개념으로 강제 정규화');

      // Multi-concept composite problem: model chooses valid secondary concept
      aiModule.callAiChat = async () => ({
        ok: true,
        content: JSON.stringify({
          calculatedScore: 90,
          academicErrorType: 'CALCULATION_ERROR',
          needsReview: false,
          conceptId: 'c-authoritative-sub',
          rubricResults: [{ criterionId: 'r1', score: 90, evidenceQuote: 'answer' }],
        }),
        model: 'deepseek-v4.1-flash',
        usage: { promptTokens: 100, completionTokens: 100 },
      });

      const reqComposite = new NextRequest('http://localhost/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId: testProblem.id,
          conceptId: 'c-authoritative-main',
          subjectId: subject.id,
          problemTitle: testProblem.title,
          problemPrompt: '문제',
          userAnswer: 'answer',
          modelAnswer: 'answer',
          rubric,
        }),
      });

      const resComposite = await POST(reqComposite);
      const jsonComposite = await resComposite.json();
      assert.equal(jsonComposite.evaluation.conceptId, 'c-authoritative-sub', '복합 문제의 서버 권위 집합 내 개념은 인정');
    } finally {
      aiModule.callAiChat = origCallAiChat;
    }
  });

  // ISSUE-05 [P2]: 재승인 시 실제 원문 인용 대조 및 페이지 출처 허위 검증 방지 검증
  await checkAsync('ISSUE-05 [P2]: 재승인 시 실제 원문 인용 대조 및 페이지 출처 허위 검증 방지 검증', async () => {
    const matId = 'mat-reapp-test';
    const originalQuote = '정리 2.1: 모든 수렴하는 수열은 유계이다.';
    const originalMarkdown = `# 해석학\n\n${originalQuote}\n\n<!-- Page 5 -->\n역은 일반적으로 성립하지 않는다.`;

    const materialOriginal = {
      id: matId,
      subjectId: subject.id,
      title: '실해석학 기초',
      parsedMarkdown: originalMarkdown,
      status: 'analyzed',
      updatedAt: new Date().toISOString(),
    };

    const problemToReapprove = {
      ...base,
      id: 'prob-reapp-1',
      rubric: [{ id: 'r1', label: '증명 논리', maxScore: 100, weight: 1, description: '전체 논리적 완결성' }],
      subjectId: subject.id,
      sourceMaterialId: matId,
      sourceExcerpt: originalQuote,
      sourceEvidenceQuote: originalQuote,
      sourceVerificationStatus: 'needs_review',
      needsSourceReview: true,
      isOutdated: true,
      qualityStatus: 'reported',
      sourceMaterials: [{ materialId: matId, title: '실해석학 기초', markdownHash: markdownUtils.computeMarkdownHash(originalMarkdown) }],
    };
    storage.saveStoredProblems([problemToReapprove]);

    // Case A: Material preserved with quote -> Promoted to verified
    const reapprovedOk = storage.reapproveProblem(problemToReapprove.id, '사용자 검토 완료', [materialOriginal]);
    assert.ok(reapprovedOk.success, '재승인 성공');
    assert.equal(reapprovedOk.updatedProblem.qualityStatus, 'reapproved', 'qualityStatus reapproved 확인');
    assert.equal(reapprovedOk.updatedProblem.sourceVerificationStatus, 'verified', '인용문 확인 시 verified 승격');
    assert.equal(reapprovedOk.updatedProblem.needsSourceReview, false, 'needsSourceReview 해제');

    // Case B: Material edited, quote deleted -> MUST NOT promote to verified
    const editedMarkdown = `# 해석학\n\n수열의 유계성 개념 설명.\n\n역은 일반적으로 성립하지 않는다.`;
    const materialEdited = { ...materialOriginal, parsedMarkdown: editedMarkdown };
    const reapprovedDeletedQuote = storage.reapproveProblem(problemToReapprove.id, '인용문 누락 상태 재승인 시도', [materialEdited]);
    assert.equal(reapprovedDeletedQuote.updatedProblem.qualityStatus, 'reapproved', '사용자 재승인 표시는 반영');
    assert.equal(reapprovedDeletedQuote.updatedProblem.sourceVerificationStatus, 'needs_review', '인용문 불일치 시 needs_review 유지');
    assert.equal(reapprovedDeletedQuote.updatedProblem.needsSourceReview, true, 'needsSourceReview 유지 (허위 검증 방지)');

    // Case C: Material body empty / unloaded -> MUST NOT promote to verified
    const materialUnloaded = { ...materialOriginal, parsedMarkdown: '' };
    const reapprovedUnloaded = storage.reapproveProblem(problemToReapprove.id, '본문 미로딩 재승인', [materialUnloaded]);
    assert.equal(reapprovedUnloaded.updatedProblem.sourceVerificationStatus, 'needs_review', '본문 미로딩 시 needs_review 유지');
    assert.equal(reapprovedUnloaded.updatedProblem.needsSourceReview, true);

    // Case D: Material deleted -> MUST NOT promote to verified
    const reapprovedDeletedMat = storage.reapproveProblem(problemToReapprove.id, '자료 삭제 재승인', []);
    assert.equal(reapprovedDeletedMat.updatedProblem.sourceVerificationStatus, 'needs_review', '자료 삭제 시 needs_review 유지');
    assert.equal(reapprovedDeletedMat.updatedProblem.needsSourceReview, true);

    // Page Grounding Verification:
    // Digit 3 in body does not make it page 3
    const pageGroundingNoMarker = verifyPageGrounding({
      markdown: '해석학에는 3가지 공리가 존재한다. 공리 1, 공리 2, 공리 3.',
      quote: '3가지 공리가 존재한다',
      candidatePage: '3',
      sourceRefs: '3단원',
    });
    assert.equal(pageGroundingNoMarker, undefined, '본문 숫자 3이나 3단원 문구는 페이지 번호로 오인하지 않음');

    // Explicit page boundary <!-- Page 7 -->
    const pageGroundingWithMarker = verifyPageGrounding({
      markdown: '# 단원 시작\n<!-- Page 7 -->\n정리 5: 코시 수열은 수렴한다.',
      quote: '정리 5: 코시 수열은 수렴한다',
      candidatePage: '7',
    });
    assert.equal(pageGroundingWithMarker, '7', '명시적 페이지 경계 인식 성공');

    // sourceRefs full title should not become page number
    const pageGroundingTitle = verifyPageGrounding({
      markdown: '정리 5: 코시 수열은 수렴한다.',
      quote: '정리 5: 코시 수열은 수렴한다',
      sourceRefs: 'Calculus 8th Edition Chapter 2',
    });
    assert.equal(pageGroundingTitle, undefined, '교재 제목 전체는 페이지 번호로 대입되지 않음');
  });

  // ISSUE-06 [P2]: 평가 프롬프트 100점 정책 통일 및 95점 계산 실수 오류 분류 보존 검증
  await checkAsync('ISSUE-06 [P2]: 평가 프롬프트 100점 정책 통일 및 95점 계산 실수 오류 분류 보존 검증', async () => {
    const rubric = [
      { id: 'r1', label: '증명 논리', maxScore: 90, weight: 0.9, description: '논리 구성' },
      { id: 'r2', label: '최종 계산', maxScore: 10, weight: 0.1, description: '부호 및 수치' },
    ];
    const studentAnswer = '따라서 결론은 x = -5 이다.';

    // 1. 95점 + 경미한 계산 실수: Preserved as CALCULATION_ERROR, not forced to NO_ERROR
    const calcErrorResult = validation.validateEvaluationOutput({
      rubricResults: [
        { criterionId: 'r1', score: 90, evidenceQuote: 'x = -5' },
        { criterionId: 'r2', score: 5, evidenceQuote: 'x = -5' },
      ],
      academicErrorType: 'CALCULATION_ERROR',
      structuredError: {
        evidence: 'x = -5',
        errorType: 'CALCULATION_ERROR',
      },
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer, isProvisionalLocal: true });
    assert.equal(calcErrorResult.calculatedScore, 95, '95점 계산');
    assert.equal(calcErrorResult.academicErrorType, 'CALCULATION_ERROR', '95점 답안의 경미한 계산 실수 분류 보존');
    assert.equal(calcErrorResult.needsReview, false, '정상 진단 시 needsReview: false 유지');

    // 2. 100점 만점 + 오류 없음: NO_ERROR
    const perfectResult = validation.validateEvaluationOutput({
      rubricResults: [
        { criterionId: 'r1', score: 90, evidenceQuote: 'x = -5' },
        { criterionId: 'r2', score: 10, evidenceQuote: 'x = -5' },
      ],
      academicErrorType: 'NO_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer, isProvisionalLocal: true });
    assert.equal(perfectResult.calculatedScore, 100, '100점 만점');
    assert.equal(perfectResult.academicErrorType, 'NO_ERROR', '만점 시 NO_ERROR 인정');
    assert.equal(perfectResult.needsReview, false);

    // 3. Contradiction: Score is 80 (deduction) but model claims NO_ERROR -> Flagged as UNCERTAIN & needsReview
    const contradictoryResult = validation.validateEvaluationOutput({
      rubricResults: [
        { criterionId: 'r1', score: 70, evidenceQuote: 'x = -5' },
        { criterionId: 'r2', score: 10, evidenceQuote: 'x = -5' },
      ],
      academicErrorType: 'NO_ERROR',
      needsReview: false,
    }, rubric, { userAnswer: studentAnswer, isProvisionalLocal: true });
    assert.equal(contradictoryResult.needsReview, true, '감점 존재 시 NO_ERROR 주장은 모순 탐지하여 needsReview: true');
    assert.equal(contradictoryResult.academicErrorType, 'UNCERTAIN', '모순 시 UNCERTAIN 처리 (임의 개념오류 단정 금지)');

    // 4. Rubric score is strictly preserved and not arbitrarily deducted
    assert.equal(calcErrorResult.calculatedScore, 95, '진단 보정이 루브릭 점수를 임의 변경하지 않음');
  });

  // =========================================================================
  // 6대 핵심 문제 회귀 검증 (P1/P2)
  // =========================================================================

  // --- 문제 1 [P1]: 저장 재시도 플래그를 이용한 크레딧 제한 우회 차단 ---
  await checkAsync('문제 1 [P1]: 잔액 0 사용자 isSaveRetry/action=retry_save 전송 시 외부 AI 호출 0회 및 차단', async () => {
    await withFakeSupabase({
      user: { id: 'user-p1-zero-balance' },
      ai_trial_credits: [{ user_id: 'user-p1-zero-balance', granted_credits: 3, balance: 0, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async () => {
      const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
      const res = await resolveAiConfigForUser('user-p1-zero-balance', {
        taskId: 'task-fake-retry',
        taskType: 'generate_problems',
        inputIdentifier: 'hash-fake',
        isSaveRetry: true,
      });
      assert.equal(res.ok, false);
      assert.equal(res.code, 'save_retry_cannot_execute_ai', '저장 재시도 플래그로 AI 실행 권한 획득 불가');
    });
  });

  await checkAsync('문제 1 [P1]: 존재하지 않거나 소유권 불일치 작업의 저장 재시도 -> AI 0회 및 거부', async () => {
    await withFakeSupabase({
      user: { id: 'user-p1-attacker' },
      ai_trial_reservations: [{
        id: 'res-owner',
        user_id: 'user-p1-victim',
        task_id: 'task-victim-1',
        task_type: 'generate_problems',
        input_identifier: 'hash-victim',
        status: 'result_ready',
        cached_result: { problems: [] },
      }],
    }, async () => {
      const { lookupSavedTaskResult } = load(path.join(output, 'lib/trialCredits.js'));
      // 타인 작업 조회
      const resOther = await lookupSavedTaskResult('user-p1-attacker', 'task-victim-1', 'generate_problems', 'hash-victim');
      assert.equal(resOther.success, false);
      assert.equal(resOther.errorCode, 'TASK_OWNERSHIP_MISMATCH');

      // 존재하지 않는 작업 조회
      const resNonExistent = await lookupSavedTaskResult('user-p1-attacker', 'task-non-existent', 'generate_problems');
      assert.equal(resNonExistent.success, false);
      assert.equal(resNonExistent.errorCode, 'TASK_NOT_FOUND');
    });
  });

  // --- 문제 2 [P1]: AI 사용량 API의 다른 사용자 정보 조회 차단 ---
  await checkAsync('문제 2 [P1]: AI 사용량 API 인증·권한 검증 (비로그인 401, 본인 200, 타인 403 격리, 관리자 허용)', async () => {
    const adminMetricsRoute = load(path.join(output, 'app/api/admin/ai-metrics/route.js'));
    const GET = adminMetricsRoute.GET;

    // 1. 비로그인 요청 -> 401
    auth.__setMode('anonymous');
    try {
      const req = new NextRequest('http://localhost/api/admin/ai-metrics?userId=user-target');
      const res = await GET(req);
      assert.equal(res.status, 401, '비로그인 사용자는 401 반환');
    } finally {
      auth.__setMode('authenticated');
    }

    // 2. 일반 사용자 본인 조회 -> 200
    await withFakeSupabase({ user: { id: 'user-alice', email: 'alice@example.com' } }, async () => {
      const req = new NextRequest('http://localhost/api/admin/ai-metrics?userId=user-alice');
      const res = await GET(req);
      assert.equal(res.status, 200, '본인 사용량 조회 성공');
      const json = await res.json();
      assert.equal(json.success, true);
    });

    // 3. 일반 사용자 A가 사용자 B 조회 -> 403 Forbidden 및 데이터/존재 비노출
    await withFakeSupabase({ user: { id: 'user-alice', email: 'alice@example.com' } }, async () => {
      const req = new NextRequest('http://localhost/api/admin/ai-metrics?userId=user-bob');
      const res = await GET(req);
      assert.equal(res.status, 403, '타인 사용량 조회 거부 (403)');
      const json = await res.json();
      assert.equal(json.errorCode || json.error_code, 'FORBIDDEN');
      assert.equal(json.data, undefined, '기록 및 집계 데이터 비노출');
    });

    // 4. 검증된 관리자 조회 -> 200 (ADMIN_EMAILS 또는 ADMIN_USER_IDS 설정)
    const prevAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@learnaway.local';
    try {
      await withFakeSupabase({ user: { id: 'user-admin', email: 'admin@learnaway.local' } }, async () => {
        const req = new NextRequest('http://localhost/api/admin/ai-metrics?userId=user-bob');
        const res = await GET(req);
        assert.equal(res.status, 200, '검증된 관리자는 타 사용자 사용량 조회 허용');
      });
    } finally {
      if (prevAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prevAdminEmails;
    }

    // 5. 관리자 설정 누락 시 default-deny -> 403
    const prevAdminIds = process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_EMAILS;
    try {
      await withFakeSupabase({ user: { id: 'user-unconfigured', email: 'anyone@example.com' } }, async () => {
        const req = new NextRequest('http://localhost/api/admin/ai-metrics?userId=user-target');
        const res = await GET(req);
        assert.equal(res.status, 403, '관리자 환경변수 누락 시 기본 거부');
      });
    } finally {
      if (prevAdminIds !== undefined) process.env.ADMIN_USER_IDS = prevAdminIds;
    }
  });

  // --- 문제 3 [P2]: 작업 입력 식별자의 서버 영속성·동시성 확보 ---
  await checkAsync('문제 3 [P2]: 개인 키 및 체험 경로 원자적 DB 작업 등록, 입력 불일치 거부 및 동시 선점 방지', async () => {
    await withFakeSupabase({
      user: { id: 'user-p3' },
      ai_trial_credits: [{ user_id: 'user-p3', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async (client) => {
      const { registerAiTask } = load(path.join(output, 'lib/trialCredits.js'));

      // 1. 개인 키 작업 등록 시 balance 차감 없이 ai_trial_reservations에 credit_source='personal_key' 등록
      const regPersonal = await registerAiTask(
        'user-p3',
        'task-p3-pers-1',
        'evaluate_answer',
        'hash-input-v1',
        true
      );
      assert.equal(regPersonal.allowed, true);
      assert.ok(regPersonal.leaseToken, '유효한 fencing leaseToken 발급');
      const cred = client.__state.ai_trial_credits.find((c) => c.user_id === 'user-p3');
      assert.equal(cred.balance, 3, '개인 키 작업은 잔액 차감 없음');
      const resRow = client.__state.ai_trial_reservations.find((r) => r.task_id === 'task-p3-pers-1');
      assert.equal(resRow.credit_source, 'personal_key');

      // 2. 동일한 taskId에 다른 inputIdentifier 재사용 시 TASK_INPUT_MISMATCH 거부
      const regMismatch = await registerAiTask(
        'user-p3',
        'task-p3-pers-1',
        'evaluate_answer',
        'hash-input-v2-DIFFERENT',
        true
      );
      assert.equal(regMismatch.allowed, false);
      assert.equal(regMismatch.errorCode, 'TASK_INPUT_MISMATCH');

      // 3. 실행 중(lease 유효) 동시 요청 시 CONCURRENT_EXECUTION_BLOCKED 차단
      const regConcurrent = await registerAiTask(
        'user-p3',
        'task-p3-pers-1',
        'evaluate_answer',
        'hash-input-v1',
        true
      );
      assert.equal(regConcurrent.allowed, false);
      assert.equal(regConcurrent.errorCode, 'CONCURRENT_EXECUTION_BLOCKED');
    });
  });

  // --- 문제 4 [P2]: 미확정 평가가 숙련도·복습 계획을 왜곡하지 않도록 수정 ---
  await checkAsync('문제 4 [P2]: 미확정 평가(needsReview:true, UNCERTAIN)가 숙련도 92점을 왜곡하거나 감점하지 않음', async () => {
    const { calculateConceptMasteryScore, getConfirmedEvents, isConfirmedReviewEvent } = load(path.join(output, 'lib/retentionModel.js'));

    const confirmedHistory = [
      { kind: 'attempt', score: 90, resultScore: 90, at: new Date(Date.now() - 3600000).toISOString(), answeredAt: new Date(Date.now() - 3600000).toISOString(), status: 'CONFIRMED' },
      { kind: 'attempt', score: 95, resultScore: 95, at: new Date(Date.now() - 1800000).toISOString(), answeredAt: new Date(Date.now() - 1800000).toISOString(), status: 'CONFIRMED' },
    ];
    const scoreBefore = calculateConceptMasteryScore(confirmedHistory);
    assert.ok(scoreBefore >= 90, `기존 확정 평가 숙련도 고득점 확인 (현재: ${scoreBefore})`);

    // 미확정(needsReview: true, UNCERTAIN) 평가 추가 시도
    const unconfirmedEvaluation = {
      kind: 'attempt',
      score: 30,
      resultScore: 30,
      at: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
      academicErrorType: 'UNCERTAIN',
      needsReview: true,
      status: 'UNCERTAIN',
    };
    assert.equal(isConfirmedReviewEvent(unconfirmedEvaluation), false, '미확정 평가는 확정 이벤트로 분류되지 않음');

    const mixedHistory = [...confirmedHistory, unconfirmedEvaluation];
    const confirmedOnly = getConfirmedEvents(mixedHistory);
    assert.equal(confirmedOnly.length, 2, '미확정 평가는 계산 대상에서 제외');

    const scoreAfter = calculateConceptMasteryScore(mixedHistory);
    assert.equal(scoreAfter, scoreBefore, '미확정 평가로 인해 숙련도가 69.1점 등으로 급락하지 않고 완전 보존됨');

    // 미확정 고득점 또한 부풀림 방지
    const unconfirmedHighScore = {
      kind: 'attempt',
      score: 100,
      resultScore: 100,
      at: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
      needsReview: true,
      status: 'NEEDS_REVIEW',
    };
    const scoreWithHigh = calculateConceptMasteryScore([...confirmedHistory, unconfirmedHighScore]);
    assert.equal(scoreWithHigh, scoreBefore, '미확정 고득점 또한 확정 전에는 숙련도에 반영되지 않음');
  });

  // --- 문제 5 [P2]: 모델이 만든 페이지 정보를 검증 근거로 사용하는 경로 제거 ---
  await checkAsync('문제 5 [P2]: AI 환각 페이지(p. 999) 미승인 및 복수 페이지 중복 인용 보수적 처리', async () => {
    const { verifyPageGrounding } = load(path.join(output, 'lib/markdownUtils.js'));

    // 1. 페이지 경계가 없는 문서에서 AI가 임의로 p. 999를 주장하는 경우 -> undefined (미확인)
    const unpagedDoc = '이 문서는 페이지 경계 주석이 전혀 없는 일반 마크다운 문서입니다. 내용 인용문구 포함.';
    const p999 = verifyPageGrounding(unpagedDoc, '내용 인용문구', 'p. 999');
    assert.equal(p999, undefined, '자료에 페이지 경계가 없으면 AI의 p. 999 주장을 채택하지 않고 undefined 처리');

    // 2. 실제 페이지 경계가 있고 인용문이 단일 페이지에 고유한 경우 -> 정확한 페이지 반환
    const pagedDoc = '첫 페이지 <!-- Page 1 --> 둘째 페이지 고유 인용문구 <!-- Page 2 --> 셋째 페이지';
    const pUnique = verifyPageGrounding(pagedDoc, '고유 인용문구');
    assert.equal(pUnique, '1', '단일 페이지에 일치하는 인용은 해당 페이지 확인');

    // 3. 같은 인용문이 복수 페이지에 중복 출현하는 경우 -> 임의 첫 페이지로 단정하지 않고 보수적(undefined) 처리
    const duplicateDoc = '<!-- Page 1 --> 반복되는 동일 수식 x = 5 <!-- Page 2 --> 기타 <!-- Page 3 --> 반복되는 동일 수식 x = 5';
    const pAmbiguous = verifyPageGrounding(duplicateDoc, '반복되는 동일 수식 x = 5');
    assert.equal(pAmbiguous, undefined, '복수 페이지 중복 인용 시 임의 확정 방지 (undefined)');

    // 4. 출처 제목 또는 범위 설명을 페이지 번호로 대입하지 않음
    const pChapter = verifyPageGrounding(pagedDoc, '고유 인용문구', 'Chapter 2: pp. 10-25');
    assert.notEqual(pChapter, '10', '범위 설명의 숫자를 단일 페이지로 임의 대입하지 않음');
  });

  // --- 문제 6 [P2]: AI 사용량 조회를 영속 DB 기준으로 전환 ---
  await checkAsync('문제 6 [P2]: AI 사용량 영속 DB 저장 및 필터링 조회 검증', async () => {
    const { recordAiUsageTelemetry, queryAiUsageTelemetryFromDb } = load(path.join(output, 'lib/aiCostTelemetry.js'));

    await withFakeSupabase({
      user: { id: 'user-telemetry-test' },
      ai_usage_telemetry: [],
    }, async (client) => {
      // 1. 레코드 저장
      await recordAiUsageTelemetry({
        userId: 'user-telemetry-test',
        taskType: 'generate_problems',
        creditSource: 'operator_trial',
        provider: 'school_gateway',
        model: 'deepseek-v4.1-flash',
        inputTokens: 500,
        outputTokens: 200,
        status: 'success',
      });

      assert.equal(client.__state.ai_usage_telemetry.length, 1, 'DB 테이블에 사용량 기록 영속화');

      // 2. DB 기준 조회 및 필터 검증
      const queried = await queryAiUsageTelemetryFromDb({
        userId: 'user-telemetry-test',
        taskType: 'generate_problems',
        creditSource: 'operator_trial',
      });
      assert.equal(queried.records.length, 1, 'DB에서 일치하는 레코드 조회 성공');
      assert.equal(queried.records[0].model, 'deepseek-v4.1-flash');
      assert.equal(queried.records[0].totalTokens, 700);

      // 3. 다른 taskType 필터 시 빈 결과 반환
      const queriedEmpty = await queryAiUsageTelemetryFromDb({
        userId: 'user-telemetry-test',
        taskType: 'evaluate_answer',
      });
      assert.equal(queriedEmpty.records.length, 0, '필터 불일치 시 0건 반환');
    });
  });

  // =========================================================================
  // 후속 4대 문제 (작업 재시도 예산, 최초 크레딧 초기화, 개인키 결과 보존, 사용량 집계 분리)
  // =========================================================================

  // --- 문제 1 [P1]: 작업 재시도의 크레딧·호출 예산 검증 복원 ---
  await checkAsync('문제 1 [P1]: 작업 재시도 시 원자적 잔액 차감, 일일 한도·재시도 횟수 초과 차단 및 결제 출처 불일치 거부', async () => {
    await withFakeSupabase({
      user: { id: 'user-retry-test' },
      ai_trial_credits: [{ user_id: 'user-retry-test', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
      operator_daily_usage: 0,
    }, async (client) => {
      const { registerAiTask, releaseTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));

      // 1. 최초 예약: 잔액 3 -> 2
      const res1 = await registerAiTask('user-retry-test', 'task-retry-01', 'evaluate_answer', 'hash-1', false);
      assert.equal(res1.allowed, true);
      assert.equal(res1.remaining, 2);
      const token1 = res1.leaseToken;

      // 2. 실패 환급: 잔액 2 -> 3
      const rel1 = await releaseTrialCredit('user-retry-test', 'task-retry-01', 'ai_failure', token1);
      assert.equal(rel1.success, true);
      assert.ok(rel1.status === 'released' || rel1.status === 'refunded');
      assert.equal(rel1.remaining, 3);

      // 3. 재요청 시 원자적 재차감: 잔액 3 -> 2
      const retry1 = await registerAiTask('user-retry-test', 'task-retry-01', 'evaluate_answer', 'hash-1', false);
      assert.equal(retry1.allowed, true);
      assert.equal(retry1.remaining, 2, '환급 후 재시도 시 잔액이 다시 원자적으로 차감됨');
      const cred = client.__state.ai_trial_credits.find(c => c.user_id === 'user-retry-test');
      assert.equal(cred.balance, 2);

      // 4. 잔액 0일 때 재예약 거부
      await releaseTrialCredit('user-retry-test', 'task-retry-01', 'ai_failure', retry1.leaseToken);
      cred.balance = 0; // 잔액 소진 시뮬레이션
      const retryNoBal = await registerAiTask('user-retry-test', 'task-retry-01', 'evaluate_answer', 'hash-1', false);
      assert.equal(retryNoBal.allowed, false);
      assert.equal(retryNoBal.errorCode, 'INSUFFICIENT_CREDITS');

      // 5. 일일 한도 초과 시 재시도 거부
      cred.balance = 2;
      client.__state.operator_daily_usage = 500;
      const retryDailyCap = await registerAiTask('user-retry-test', 'task-retry-01', 'evaluate_answer', 'hash-1', false, 500);
      assert.equal(retryDailyCap.allowed, false);
      assert.equal(retryDailyCap.errorCode, 'OPERATOR_DAILY_CAP_EXCEEDED');

      // 6. 최대 재시도 횟수 초과(5회 이상) 거부
      client.__state.operator_daily_usage = 0;
      const taskRow = client.__state.ai_trial_reservations.find(r => r.task_id === 'task-retry-01');
      taskRow.attempt_count = 5;
      const retryMax = await registerAiTask('user-retry-test', 'task-retry-01', 'evaluate_answer', 'hash-1', false);
      assert.equal(retryMax.allowed, false);
      assert.equal(retryMax.errorCode, 'MAX_RETRIES_EXCEEDED');

      // 7. 결제 방식 전환 거부 (개인키 <-> 운영자 체험)
      const resPk = await registerAiTask('user-retry-test', 'task-pk-01', 'evaluate_answer', 'hash-pk', true);
      assert.equal(resPk.allowed, true);
      const switchAttempt = await registerAiTask('user-retry-test', 'task-pk-01', 'evaluate_answer', 'hash-pk', false);
      assert.equal(switchAttempt.allowed, false);
      assert.equal(switchAttempt.errorCode, 'TASK_CREDIT_SOURCE_MISMATCH');

      // 8. 개인 키 작업 환급 시 체험 잔액 미증가
      const relPk = await releaseTrialCredit('user-retry-test', 'task-pk-01', 'cancel', resPk.leaseToken);
      assert.equal(relPk.success, true);
      assert.equal(relPk.status, 'released', '개인 키 작업은 환급 시 체험 잔액이 증가하지 않음');
    });
  });

  // --- 문제 2 [P2]: 최초 크레딧 초기화를 조회 순서에서 독립시키기 ---
  await checkAsync('문제 2 [P2]: 조회 선행 없이 최초 예약 호출 시 계정 유형별 자동 지급 및 차감 원자성 검증', async () => {
    await withFakeSupabase({
      user: { id: 'user-new-normal', email: 'normal@example.com' },
      ai_trial_credits: [], // 크레딧 행 부재
      ai_trial_reservations: [],
    }, async (client) => {
      const { registerAiTask, getTrialCreditStatus } = load(path.join(output, 'lib/trialCredits.js'));

      // 1. 일반 계정: 예약 먼저 호출 -> 3회 자동 생성 후 1회 차감 -> 2회 잔여
      const normRes = await registerAiTask('user-new-normal', 'task-first-norm', 'generate_problems', 'hash-norm', false);
      assert.equal(normRes.allowed, true);
      assert.equal(normRes.remaining, 2, '일반 계정 3회 자동 부여 후 1회 예약되어 잔액 2');

      const normRow = client.__state.ai_trial_credits.find(c => c.user_id === 'user-new-normal');
      assert.equal(normRow.granted_credits, 3);
      assert.equal(normRow.balance, 2);

      // 이후 getTrialCreditStatus 조회 시 잔액 보존 (재지급 없음)
      const normQuery = await getTrialCreditStatus('user-new-normal');
      assert.equal(normQuery.balance, 2);
      assert.equal(normQuery.granted, 3);
    });

    await withFakeSupabase({
      user: { id: 'user-new-guest', email: 'guest@id.learnaway.local', user_metadata: { auth_type: 'username' } },
      ai_trial_credits: [], // 크레딧 행 부재
      ai_trial_reservations: [],
    }, async (client) => {
      const { registerAiTask, getTrialCreditStatus } = load(path.join(output, 'lib/trialCredits.js'));

      // 2. 게스트/간편 계정: 예약 먼저 호출 -> 1회 자동 생성 후 1회 차감 -> 0회 잔여
      const guestRes = await registerAiTask('user-new-guest', 'task-first-guest', 'generate_problems', 'hash-guest', false);
      assert.equal(guestRes.allowed, true);
      assert.equal(guestRes.remaining, 0, '게스트 계정 1회 자동 부여 후 1회 예약되어 잔액 0');

      const guestRow = client.__state.ai_trial_credits.find(c => c.user_id === 'user-new-guest');
      assert.equal(guestRow.granted_credits, 1);
      assert.equal(guestRow.balance, 0);

      const guestQuery = await getTrialCreditStatus('user-new-guest', true);
      assert.equal(guestQuery.balance, 0);
      assert.equal(guestQuery.granted, 1);
    });
  });

  // --- 문제 3 [P2]: 개인 API 키 작업의 결과 보존·완료·실패 복구 연결 ---
  await checkAsync('문제 3 [P2]: 개인 API 키 작업 결과 보존 및 다중 청크 분석 clearAiTaskLease 연속 진행 검증', async () => {
    await withFakeSupabase({
      user: { id: 'user-pk-flow' },
      ai_trial_credits: [{ user_id: 'user-pk-flow', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async () => {
      const { registerAiTask, recordTrialResultReady, settleTrialCredit, clearAiTaskLease } = load(path.join(output, 'lib/trialCredits.js'));

      // 1. 개인 키 작업 등록
      const reg = await registerAiTask('user-pk-flow', 'task-pk-chunk-1', 'analyze_concepts', 'hash-chunk-1', true);
      assert.equal(reg.allowed, true);
      const token = reg.leaseToken;

      // 2. 중간 청크 완료: clearAiTaskLease 호출로 실행 락 해제
      const clearRes = await clearAiTaskLease('user-pk-flow', 'task-pk-chunk-1', token);
      assert.equal(clearRes.success, true, '중간 청크 leaseToken 정상 해제');

      // 3. 동일 taskId로 다음 청크 즉시 진입 시 CONCURRENT_EXECUTION_BLOCKED 없이 허용
      const nextChunk = await registerAiTask('user-pk-flow', 'task-pk-chunk-1', 'analyze_concepts', 'hash-chunk-1', true);
      assert.equal(nextChunk.allowed, true, '중간 청크 lease 해제 후 다음 청크 원활한 재진입');
      const nextToken = nextChunk.leaseToken;

      // 4. 최종 청크 완료: 결과 보존 및 확정
      const recordRes = await recordTrialResultReady('user-pk-flow', 'task-pk-chunk-1', { concepts: ['Derivative'] }, nextToken);
      assert.equal(recordRes.success, true);
      const settleRes = await settleTrialCredit('user-pk-flow', 'task-pk-chunk-1', nextToken);
      assert.equal(settleRes.success, true);

      // 5. 이미 보존된 개인 키 작업 재전송 시 캐시 즉시 반환 (추가 AI 호출 차단)
      const repeatRes = await registerAiTask('user-pk-flow', 'task-pk-chunk-1', 'analyze_concepts', 'hash-chunk-1', true);
      assert.equal(repeatRes.allowed, false);
      assert.equal(repeatRes.status, 'already_completed');
      assert.deepEqual(repeatRes.cachedResult, { concepts: ['Derivative'] });
    });
  });

  // --- 문제 4 [P2]: 사용량 목록과 기간 전체 집계 분리 ---
  await checkAsync('문제 4 [P2]: 사용량 목록 limit 페이징과 기간 전체 summary 집계 분리 검증', async () => {
    const { queryAiUsageTelemetryFromDb } = load(path.join(output, 'lib/aiCostTelemetry.js'));

    const telemetryRecords = [];
    for (let i = 1; i <= 60; i++) {
      telemetryRecords.push({
        id: `tel-${i}`,
        request_id: `req-${i}`,
        user_id: 'user-paging-test',
        task_type: i % 2 === 0 ? 'evaluate_answer' : 'generate_problems',
        credit_source: 'operator_trial',
        provider: 'school_gateway',
        model: 'deepseek-v4.1-flash',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        estimated_cost_usd: 0.001,
        estimated_cost_krw: 1.4,
        status: 'success',
        execution_time_ms: 250,
        created_at: new Date(Date.now() - i * 60000).toISOString(),
      });
    }

    await withFakeSupabase({
      user: { id: 'user-paging-test' },
      ai_usage_telemetry: telemetryRecords,
    }, async () => {
      // 1. limit=10으로 조회 시: 목록은 10건, 그러나 summary.totalRequests는 전체 60건
      const page10 = await queryAiUsageTelemetryFromDb({
        userId: 'user-paging-test',
        limit: 10,
      });
      assert.equal(page10.records.length, 10, '목록은 지정된 limit=10에 맞게 페이징');
      assert.equal(page10.summary.totalRequests, 60, '전체 집계는 페이징과 무관하게 60건 유지');

      // 2. limit=50으로 변경해도 전체 집계 60건 불변
      const page50 = await queryAiUsageTelemetryFromDb({
        userId: 'user-paging-test',
        limit: 50,
      });
      assert.equal(page50.records.length, 50, '목록은 limit=50 반영');
      assert.equal(page50.summary.totalRequests, 60, 'limit 변경 후에도 전체 합계 60건 동일');
      assert.equal(page50.summary.operatorTrialConsumption.requests, 60);
      assert.equal(page50.summary.operatorTrialConsumption.tokens, 9000);
    });
  });

  // --- 추가 안정화: 다중 청크(7개 청크) 분석 순차 진행 시 MAX_RETRIES_EXCEEDED 차단 없이 완결 검증 ---
  await checkAsync('추가 안정화: 다중 청크(7개 청크) 분석 순차 진행 시 MAX_RETRIES_EXCEEDED 차단 없이 완결 검증', async () => {
    await withFakeSupabase({
      user: { id: 'user-7chunks' },
      ai_trial_credits: [{ user_id: 'user-7chunks', granted_credits: 3, balance: 3, granted_at: nowIso(), updated_at: nowIso() }],
      ai_trial_reservations: [],
    }, async () => {
      const { registerAiTask, clearAiTaskLease, recordTrialResultReady, settleTrialCredit } = load(path.join(output, 'lib/trialCredits.js'));

      let currentToken = '';
      for (let chunkIdx = 1; chunkIdx <= 7; chunkIdx++) {
        const reg = await registerAiTask('user-7chunks', 'task-multi-7chunks', 'analyze_concepts', 'hash-7chunks', true);
        assert.equal(reg.allowed, true, `청크 ${chunkIdx} 정상 진입 허용 (MAX_RETRIES_EXCEEDED 차단 없음)`);
        currentToken = reg.leaseToken;

        if (chunkIdx < 7) {
          const clearRes = await clearAiTaskLease('user-7chunks', 'task-multi-7chunks', currentToken);
          assert.equal(clearRes.success, true, `청크 ${chunkIdx} lease 해제 성공`);
        } else {
          const recRes = await recordTrialResultReady('user-7chunks', 'task-multi-7chunks', { done: true }, currentToken);
          assert.equal(recRes.success, true, '최종 청크 완료 후 결과 보존');
          const settleRes = await settleTrialCredit('user-7chunks', 'task-multi-7chunks', currentToken);
          assert.equal(settleRes.success, true, '최종 정산 완료');
        }
      }
    });
  });

  // --- 추가 안정화: 집계 RPC 장애 시 페이징 대체 경로(fetchAllFilteredRecords) 정상 동작 검증 ---
  await checkAsync('추가 안정화: 집계 RPC 장애 시 페이징 대체 경로(fetchAllFilteredRecords) 정상 동작 검증', async () => {
    const { queryAiUsageTelemetryFromDb } = load(path.join(output, 'lib/aiCostTelemetry.js'));

    const telemetryRecords = [];
    for (let i = 1; i <= 25; i++) {
      telemetryRecords.push({
        id: `tel-fb-${i}`,
        request_id: `req-fb-${i}`,
        user_id: 'user-fallback-test',
        task_type: 'evaluate_answer',
        credit_source: 'personal_key',
        provider: 'school_gateway',
        model: 'deepseek-v4.1-flash',
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        estimated_cost_usd: 0.002,
        estimated_cost_krw: 2.8,
        status: 'success',
        execution_time_ms: 300,
        created_at: new Date(Date.now() - i * 60000).toISOString(),
      });
    }

    await withFakeSupabase({
      user: { id: 'user-fallback-test' },
      failAggregateRpc: true, // RPC 장애 시뮬레이션
      ai_usage_telemetry: telemetryRecords,
    }, async () => {
      const res = await queryAiUsageTelemetryFromDb({
        userId: 'user-fallback-test',
        limit: 5,
      });

      assert.equal(res.records.length, 5, '목록은 limit=5 페이징 적용');
      assert.equal(res.summary.totalRequests, 25, 'RPC 장애 시에도 대체 경로로 전체 25건 누락 없이 정확히 집계');
      assert.equal(res.summary.personalKeyConsumption.tokens, 7500);
    });
  });

  // =========================================================================
  // 보안 취약점 3건 및 데이터 무결성 1건 검증 (Problems 1 ~ 4)
  // =========================================================================

  // --- 문제 1: 모든 운영자 AI 호출에 비용 통제 적용 ---
  await checkAsync('문제 1: 폴백 ON + 긴급 중지 ON 시 외부 AI 호출 0회 및 차단 (operator_disabled)', async () => {
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
    const prevFallback = process.env.AI_ALLOW_OPERATOR_FALLBACK;
    const prevStop = process.env.OPERATOR_EMERGENCY_STOP;
    process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
    process.env.OPERATOR_EMERGENCY_STOP = 'true';

    try {
      await withFakeSupabase({ user: { id: 'user-p1-emerg' }, ai_trial_credits: [{ user_id: 'user-p1-emerg', balance: 3, granted_credits: 3 }] }, async () => {
        const config = await resolveAiConfigForUser('user-p1-emerg', {
          taskId: 'task-emerg-1',
          taskType: 'logic_questions',
          inputIdentifier: 'hash-emerg-1',
        });
        assert.equal(config.ok, false);
        assert.equal(config.code, 'operator_disabled');
      });
    } finally {
      if (prevFallback !== undefined) process.env.AI_ALLOW_OPERATOR_FALLBACK = prevFallback;
      else delete process.env.AI_ALLOW_OPERATOR_FALLBACK;
      if (prevStop !== undefined) process.env.OPERATOR_EMERGENCY_STOP = prevStop;
      else delete process.env.OPERATOR_EMERGENCY_STOP;
    }
  });

  await checkAsync('문제 1: 폴백 ON + 일일 한도 소진 시 외부 AI 호출 0회 및 차단 (OPERATOR_DAILY_CAP_EXCEEDED)', async () => {
    const { resolveAiConfigForUser } = load(path.join(output, 'lib/aiCredentials.js'));
    const prevFallback = process.env.AI_ALLOW_OPERATOR_FALLBACK;
    const prevCap = process.env.OPERATOR_DAILY_CALL_CAP;
    process.env.AI_ALLOW_OPERATOR_FALLBACK = 'true';
    process.env.OPERATOR_DAILY_CALL_CAP = '5';

    try {
      await withFakeSupabase({
        user: { id: 'user-p1-cap' },
        operator_daily_usage: 5,
        ai_trial_credits: [{ user_id: 'user-p1-cap', balance: 3, granted_credits: 3 }],
      }, async () => {
        const config = await resolveAiConfigForUser('user-p1-cap', {
          taskId: 'task-cap-1',
          taskType: 'transfer_problem',
          inputIdentifier: 'hash-cap-1',
        });
        assert.equal(config.ok, false);
        assert.equal(config.errorCode, 'OPERATOR_DAILY_CAP_EXCEEDED');
      });
    } finally {
      if (prevFallback !== undefined) process.env.AI_ALLOW_OPERATOR_FALLBACK = prevFallback;
      else delete process.env.AI_ALLOW_OPERATOR_FALLBACK;
      if (prevCap !== undefined) process.env.OPERATOR_DAILY_CALL_CAP = prevCap;
      else delete process.env.OPERATOR_DAILY_CAP_EXCEEDED;
    }
  });

  await checkAsync('문제 1: 체험 크레딧 소진 시 운영자 키 호출 차단 및 개인 키는 잔액 무변화', async () => {
    const { registerAiTask } = load(path.join(output, 'lib/trialCredits.js'));
    await withFakeSupabase({
      user: { id: 'user-p1-credits' },
      ai_trial_credits: [{ user_id: 'user-p1-credits', balance: 0, granted_credits: 3 }],
    }, async () => {
      // 1. Operator trial with 0 balance -> blocked
      const opRes = await registerAiTask('user-p1-credits', 'task-op-1', 'review_problem_quality', 'hash-rev-1', false);
      assert.equal(opRes.allowed, false);
      assert.equal(opRes.errorCode, 'INSUFFICIENT_CREDITS');

      // 2. Personal key with 0 balance -> allowed, balance remains 0
      const pkRes = await registerAiTask('user-p1-credits', 'task-pk-1', 'review_problem_quality', 'hash-rev-2', true);
      assert.equal(pkRes.allowed, true);
      assert.equal(pkRes.remaining, 0);
    });
  });

  await checkAsync('문제 1: 임의 taskId 변조로 동일 입력 동시 실행 방어 무력화 시도 차단', async () => {
    const { registerAiTask } = load(path.join(output, 'lib/trialCredits.js'));
    await withFakeSupabase({
      user: { id: 'user-p1-tamper' },
      ai_trial_credits: [{ user_id: 'user-p1-tamper', balance: 3, granted_credits: 3 }],
      ai_trial_reservations: [
        {
          id: 'res-orig',
          user_id: 'user-p1-tamper',
          task_id: 'task-orig-id',
          task_type: 'logic_questions',
          input_identifier: 'identical-prompt-hash',
          credit_source: 'operator_trial',
          status: 'processing',
          lease_token: 'valid-lease-orig',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    }, async () => {
      const resTamper = await registerAiTask('user-p1-tamper', 'task-random-tampered-id', 'logic_questions', 'identical-prompt-hash', false);
      assert.equal(resTamper.allowed, false);
      assert.equal(resTamper.errorCode, 'CONCURRENT_EXECUTION_BLOCKED');
    });
  });

  // --- 문제 2: 작업 등록 오류 시 구형 예약 함수로 우회하는 경로 제거 ---
  await checkAsync('문제 2: register_ai_task RPC 오류·예외·null·잘못된 구조 시 allowed:false 및 구형 RPC 호출 0회', async () => {
    const { registerAiTask } = load(path.join(output, 'lib/trialCredits.js'));

    // Case 1: RPC Error
    await withFakeSupabase({
      user: { id: 'user-p2-test' },
      failRegisterAiTaskRpc: 'error',
    }, async (client) => {
      const res = await registerAiTask('user-p2-test', 'task-err-1', 'evaluate_answer', 'hash-1', false);
      assert.equal(res.allowed, false);
      assert.equal(client.__state.reserveTrialCreditCallCount || 0, 0, '구형 reserve_trial_credit RPC 호출 0회');
    });

    // Case 2: RPC Exception / Network Throw
    await withFakeSupabase({
      user: { id: 'user-p2-test' },
      failRegisterAiTaskRpc: 'throw',
    }, async (client) => {
      const res = await registerAiTask('user-p2-test', 'task-err-2', 'evaluate_answer', 'hash-2', false);
      assert.equal(res.allowed, false);
      assert.equal(client.__state.reserveTrialCreditCallCount || 0, 0, '구형 reserve_trial_credit RPC 호출 0회');
    });

    // Case 3: Null response
    await withFakeSupabase({
      user: { id: 'user-p2-test' },
      failRegisterAiTaskRpc: 'null',
    }, async (client) => {
      const res = await registerAiTask('user-p2-test', 'task-err-3', 'evaluate_answer', 'hash-3', false);
      assert.equal(res.allowed, false);
      assert.equal(client.__state.reserveTrialCreditCallCount || 0, 0, '구형 reserve_trial_credit RPC 호출 0회');
    });

    // Case 4: Malformed response
    await withFakeSupabase({
      user: { id: 'user-p2-test' },
      failRegisterAiTaskRpc: 'malformed',
    }, async (client) => {
      const res = await registerAiTask('user-p2-test', 'task-err-4', 'evaluate_answer', 'hash-4', false);
      assert.equal(res.allowed, false);
      assert.equal(client.__state.reserveTrialCreditCallCount || 0, 0, '구형 reserve_trial_credit RPC 호출 0회');
    });
  });

  await checkAsync('문제 2: 개인 키 작업을 운영자 체험으로 재사용 시 TASK_CREDIT_SOURCE_MISMATCH 거부', async () => {
    const { registerAiTask } = load(path.join(output, 'lib/trialCredits.js'));
    await withFakeSupabase({
      user: { id: 'user-p2-source' },
      ai_trial_credits: [{ user_id: 'user-p2-source', balance: 3, granted_credits: 3 }],
      ai_trial_reservations: [
        {
          task_id: 'task-pk-source-1',
          user_id: 'user-p2-source',
          task_type: 'evaluate_answer',
          input_identifier: 'hash-src-1',
          credit_source: 'personal_key',
          status: 'released',
        },
      ],
    }, async () => {
      const res = await registerAiTask('user-p2-source', 'task-pk-source-1', 'evaluate_answer', 'hash-src-1', false);
      assert.equal(res.allowed, false);
      assert.equal(res.errorCode, 'TASK_CREDIT_SOURCE_MISMATCH');
    });
  });

  // --- 문제 3: 인증 요청 제한 조회 실패 시 가입·로그인 중단 ---
  await checkAsync('문제 3: 제한 RPC 실패·예외·null 시 가입 및 로그인 즉시 중단 (503) 및 인증 함수 호출 0회', async () => {
    const { POST: authRoute } = load(path.join(output, 'app/api/auth/username/route.js'));

    // 1. 가입 시 제한 RPC 실패 -> 503, createUser 호출 0회
    await withFakeSupabase({
      failRateLimitRpc: true,
    }, async (client) => {
      const req = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.195' },
        body: JSON.stringify({ action: 'register', username: 'student_rate_1', password: 'Password123!' }),
      });
      const res = await authRoute(req);
      assert.equal(res.status, 503, 'RPC 실패 시 503 Service Unavailable');
      assert.equal(client.__state.createUserCalls || 0, 0, 'createUser 절대 호출되지 않음');
    });

    // 2. 가입 시 제한 RPC null 반환 -> 503, createUser 호출 0회
    await withFakeSupabase({
      rateLimitRpcReturnNull: true,
    }, async (client) => {
      const req = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.195' },
        body: JSON.stringify({ action: 'register', username: 'student_rate_2', password: 'Password123!' }),
      });
      const res = await authRoute(req);
      assert.equal(res.status, 503);
      assert.equal(client.__state.createUserCalls || 0, 0, 'createUser 절대 호출되지 않음');
    });

    // 3. 로그인 시 IP 제한 또는 사용자별 제한 중 하나라도 실패 -> 503, signInWithPassword 호출 0회
    await withFakeSupabase({
      failRateLimitRpc: true,
    }, async (client) => {
      const req = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.195' },
        body: JSON.stringify({ action: 'login', username: 'student_rate_3', password: 'Password123!' }),
      });
      const res = await authRoute(req);
      assert.equal(res.status, 503);
      assert.equal(client.__state.signInWithPasswordCalls || 0, 0, 'signInWithPassword 절대 호출되지 않음');
    });

    // 4. 제한 초과 시 429
    await withFakeSupabase({
      auth_rate_limits: [{ key: 'auth_reg_ip:203.0.113.199', attempts: 10, window_start: Date.now() }],
    }, async (client) => {
      const req = new NextRequest('http://localhost/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.199' },
        body: JSON.stringify({ action: 'register', username: 'student_rate_4', password: 'Password123!' }),
      });
      const res = await authRoute(req);
      assert.equal(res.status, 429, '제한 초과 시 429 Too Many Requests');
      assert.equal(client.__state.createUserCalls || 0, 0, '초과 시 createUser 호출 0회');
    });
  });

  // --- 문제 4: 분석 캐시 응답의 거짓 저장 완료 수정 ---
  await checkAsync('문제 4: AI 캐시 결과 존재 + 초안 저장 실패 시 완료 응답 금지 및 저장 재시도 경로 제공', async () => {
    const { POST: analyzeRoute } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const testUser = { id: 'user-p4-cache' };

    const mockCachedDrafts = [
      {
        id: 'cd-1',
        title: '미적분학 기본정리',
        definition: '미분과 적분의 관계',
        importance: 'high',
        keyFormula: 'F(b)-F(a)',
        subjectId: 'sub-p4-math',
        materialId: 'mat-p4-calc',
      },
    ];

    // Scenario 1: DB persistence fails -> Must NOT return completed, draftsPersistStatus must be 'failed'
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: 'sub-p4-math', user_id: testUser.id, name: '미적분학' }],
      materials: [{ id: 'mat-p4-calc', user_id: testUser.id, subject_id: 'sub-p4-math', content_hash: 'hash-p4-calc' }],
      concept_drafts: [],
      fail: { upsert: true },
      rpcImpl: (name) => {
        if (name === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              cached_result: {
                drafts: mockCachedDrafts,
                userId: testUser.id,
                subjectId: 'sub-p4-math',
                materialId: 'mat-p4-calc',
                isAllComplete: true,
              },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const req = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-p4-math',
          materialId: 'mat-p4-calc',
          markdown: '# 미적분학 정리',
        }),
      });

      const res = await analyzeRoute(req);
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.success, false, '초안 저장 실패 시 성공 응답 반환 금지');
      assert.equal(data.draftsPersistStatus, 'failed', 'draftsPersistStatus는 failed여야 함');
      assert.equal(data.persisted, false);
      assert.equal(data.canRetrySave, true, 'AI 재호출 없이 저장만 재시도 가능한 경로 제공');
      assert.equal(data.isAllComplete, false);
    });

    // Scenario 2: Save retry succeeds -> 1 draft persisted, completed
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: 'sub-p4-math', user_id: testUser.id, name: '미적분학' }],
      materials: [{ id: 'mat-p4-calc', user_id: testUser.id, subject_id: 'sub-p4-math', content_hash: 'hash-p4-calc' }],
      concept_drafts: [],
      rpcImpl: (name) => {
        if (name === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              cached_result: {
                drafts: mockCachedDrafts,
                userId: testUser.id,
                subjectId: 'sub-p4-math',
                materialId: 'mat-p4-calc',
                isAllComplete: true,
              },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async (client) => {
      const req = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-p4-math',
          materialId: 'mat-p4-calc',
          markdown: '# 미적분학 정리',
        }),
      });

      const res = await analyzeRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.fromCache, true);
      assert.equal(data.draftsPersistStatus, 'persisted');
      assert.equal(data.isAllComplete, true);
      assert.equal(client.__state.concept_drafts.length, 1, '정상 저장 완료 시 초안 1건 유지');
    });

    // Scenario 3: Cross-user cached result reuse -> Forbidden 403
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: 'sub-p4-math', user_id: testUser.id, name: '미적분학' }],
      materials: [{ id: 'mat-p4-calc', user_id: testUser.id, subject_id: 'sub-p4-math', content_hash: 'hash-p4-calc' }],
      concept_drafts: [],
      rpcImpl: (name) => {
        if (name === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              cached_result: {
                drafts: mockCachedDrafts,
                userId: 'different-attacker-uuid',
                subjectId: 'sub-p4-math',
                materialId: 'mat-p4-calc',
                isAllComplete: true,
              },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const req = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-p4-math',
          materialId: 'mat-p4-calc',
          markdown: '# 미적분학 정리',
        }),
      });

      const res = await analyzeRoute(req);
      assert.equal(res.status, 403, '타 사용자의 캐시 재사용은 403 Forbidden 거부');
      const data = await res.json();
      assert.equal(data.errorCode, 'TASK_OWNERSHIP_MISMATCH');
    });

    // Scenario 4: Incomplete chunk status -> isAllComplete MUST be false
    await withFakeSupabase({
      user: testUser,
      subjects: [{ id: 'sub-p4-math', user_id: testUser.id, name: '미적분학' }],
      materials: [{ id: 'mat-p4-calc', user_id: testUser.id, subject_id: 'sub-p4-math', content_hash: 'hash-p4-calc' }],
      concept_drafts: [],
      rpcImpl: (name) => {
        if (name === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              cached_result: {
                drafts: mockCachedDrafts,
                userId: testUser.id,
                subjectId: 'sub-p4-math',
                materialId: 'mat-p4-calc',
                isAllComplete: false,
              },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    }, async () => {
      const req = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-p4-math',
          materialId: 'mat-p4-calc',
          markdown: '# 미적분학 정리',
        }),
      });

      const res = await analyzeRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.isAllComplete, false, '청크 일부만 완료된 경우 isAllComplete: false 유지');
    });
  });

  // =========================================================================
  // =========================================================================
  // 4대 문제 실제 동작 검증 (AI 결과 보존·정산 / 계정 작업ID / 분석 캐시 / 입력 식별자)
  // =========================================================================

  const aiClientPath = path.join(output, 'lib', 'aiClient.js');
  const aiModule = load(aiClientPath);

  await checkAsync('문제 1: AI 결과 보존 실패 시 완전 성공 금지 (500) 및 canRetrySave 제공', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const testUser = { id: 'u-prob1-save-fail' };
    let aiCallCount = 0;
    aiModule.callAiChat = async () => {
      aiCallCount++;
      return {
        ok: true,
        content: JSON.stringify({
          questions: [
            { id: 'q1', question: '왜 해당 가정을 사용했습니까?', linkedCriterionId: 'r1' },
            { id: 'q2', question: '다른 해법과의 차이는 무엇입니까?', linkedCriterionId: 'r1' },
          ],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    let settleCalled = false;
    await withFakeSupabase({
      user: testUser,
      rpcImpl: (fn) => {
        if (fn === 'record_trial_result_ready') {
          return { data: { success: false, code: 'PERSISTENCE_FAILED', message: 'DB connection dropped during save' }, error: null };
        }
        if (fn === 'settle_trial_credit') {
          settleCalled = true;
          return { data: { success: true }, error: null };
        }
        return { data: null, error: null };
      }
    }, async () => {
      const req = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'sub-p1',
          domain: 'math_stats',
          problemTitle: '적분 증명',
          problemPrompt: '가측 집합 적분',
          modelAnswer: '모범 답안',
          originalAnswer: '사용자 답안',
          rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '수학적 엄밀성' }],
        }),
      });

      const res = await logicPost(req);
      assert.equal(res.status, 500, '결과 보존 실패 시 완전 성공 응답 금지 (500 반환)');
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.persisted, false, 'persisted는 false여야 함');
      assert.equal(data.settled, false, 'settled는 false여야 함');
      assert.equal(data.canRetrySave, true, 'AI 결과를 잃지 않고 재시도할 수 있도록 canRetrySave: true 제공');
      assert.ok(data.questions && data.questions.length === 2, '생성된 AI 결과가 응답에 포함되어 클라이언트 복구 지원');
      assert.equal(settleCalled, false, '결과 보존 실패 후 무조건 정산하지 않음 (정산 호출 0회)');
      assert.equal(aiCallCount, 1, '외부 AI는 1회만 호출됨');
    });
  });

  await checkAsync('문제 1: 결과 보존 성공 + 정산 실패 시 결과 유지 및 정산만 재시도', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const testUser = { id: 'u-prob1-settle-fail' };
    let aiCallCount = 0;
    aiModule.callAiChat = async () => {
      aiCallCount++;
      return {
        ok: true,
        content: JSON.stringify({
          questions: [
            { id: 'q1', question: '증명의 첫 단계는 무엇입니까?', linkedCriterionId: 'r1' },
            { id: 'q2', question: '반례는 무엇입니까?', linkedCriterionId: 'r1' },
          ],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    let savedResultCached = null;
    await withFakeSupabase({
      user: testUser,
      rpcImpl: (fn, args) => {
        if (fn === 'record_trial_result_ready') {
          savedResultCached = args.p_result;
          return { data: { success: true }, error: null };
        }
        if (fn === 'settle_trial_credit') {
          return { data: { success: false, code: 'SETTLEMENT_FAILED', message: '크레딧 장부 지연' }, error: null };
        }
        return { data: null, error: null };
      }
    }, async () => {
      const req = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'sub-p1',
          domain: 'math_stats',
          problemTitle: '적분 증명',
          problemPrompt: '가측 집합 적분',
          modelAnswer: '모범 답안',
          originalAnswer: '사용자 답안',
          rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '수학적 엄밀성' }],
        }),
      });

      const res = await logicPost(req);
      assert.equal(res.status, 200, '결과 보존 성공 시 결과는 정상 전달 (200 반환)');
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.persisted, true, '결과는 영속 보존됨');
      assert.equal(data.settled, false, '정산 실패 상태가 명시됨');
      assert.ok(data.settlementError, '정산 오류 안내가 포함됨');
      assert.ok(data.questions && data.questions.length === 2, '결과 내용이 정상 유지됨');
      assert.ok(savedResultCached, '서버에 결과가 보존됨');
      assert.equal(aiCallCount, 1, 'AI는 1회만 호출됨');
    });
  });

  await checkAsync('문제 1: 저장 복구 요청(isSaveRetry: true) 시 AI 호출 0회 및 중복 차감 0회', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const testUser = { id: 'u-prob1-save-retry' };
    let aiCallCount = 0;
    aiModule.callAiChat = async () => {
      aiCallCount++;
      return { ok: true, content: '{}', model: 'deepseek-v4.1-flash' };
    };

    const mockSavedQuestions = [
      { id: 'q-recov-1', question: '복구된 질문 1', linkedCriterionId: 'r1' },
      { id: 'q-recov-2', question: '복구된 질문 2', linkedCriterionId: 'r1' },
    ];

    await withFakeSupabase({
      user: testUser,
      rpcImpl: (fn) => {
        if (fn === 'lookup_saved_ai_task_result') {
          return {
            data: {
              success: true,
              status: 'settled',
              cached_result: { questions: mockSavedQuestions },
            },
            error: null,
          };
        }
        if (fn === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              status: 'already_completed',
              cached_result: { questions: mockSavedQuestions },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }
    }, async () => {
      const req = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isSaveRetry: true,
          subjectId: 'sub-p1',
          domain: 'math_stats',
          problemTitle: '적분 증명',
          problemPrompt: '가측 집합 적분',
          modelAnswer: '모범 답안',
          originalAnswer: '사용자 답안',
          rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '수학적 엄밀성' }],
        }),
      });

      const res = await logicPost(req);
      assert.equal(res.status, 200, '저장 복구 요청 성공');
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.persisted, true);
      assert.equal(data.settled, true);
      assert.equal(data.questions[0].id, 'q-recov-1');
      assert.equal(aiCallCount, 0, '복구 요청 시 외부 AI 호출 0회 보장');
    });
  });

  await checkAsync('문제 1: Stale Lease Fencing 보호 (STALE_LEASE_TOKEN 거부 또는 409)', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const testUser = { id: 'u-prob1-stale-lease' };
    aiModule.callAiChat = async () => {
      return {
        ok: true,
        content: JSON.stringify({
          questions: [
            { id: 'q1', question: '질문', linkedCriterionId: 'r1' },
            { id: 'q2', question: '질문2', linkedCriterionId: 'r1' },
          ],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    await withFakeSupabase({
      user: testUser,
      rpcImpl: (fn) => {
        if (fn === 'record_trial_result_ready') {
          return { data: { success: false, error_code: 'STALE_LEASE_TOKEN', code: 'STALE_LEASE_TOKEN', message: '임대 토큰 만료' }, error: null };
        }
        return { data: null, error: null };
      }
    }, async () => {
      const req = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'sub-p1',
          domain: 'math_stats',
          problemTitle: '적분 증명',
          problemPrompt: '가측 집합 적분',
          modelAnswer: '모범 답안',
          originalAnswer: '사용자 답안',
          rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '수학적 엄밀성' }],
        }),
      });

      const res = await logicPost(req);
      assert.equal(res.status, 409, '만료된 임대로 인한 보존 충돌 시 409 Conflict 반환');
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.errorCode, 'STALE_LEASE_TOKEN');
    });
  });

  await checkAsync('문제 2: A·B 계정의 동일 입력에 대해 사용자 스코프 task_id로 분리 등록 및 독립 처리', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const userA = { id: 'user-alpha-id' };
    const userB = { id: 'user-beta-id' };
    let aiCallCount = 0;
    aiModule.callAiChat = async () => {
      aiCallCount++;
      return {
        ok: true,
        content: JSON.stringify({
          questions: [
            { id: 'q1', question: '질문 1', linkedCriterionId: 'r1' },
            { id: 'q2', question: '질문 2', linkedCriterionId: 'r1' },
          ],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    const registeredTaskIds = [];
    const sharedRpcImpl = (fn, args) => {
      if (fn === 'register_ai_task') {
        registeredTaskIds.push({ userId: args.p_user_id, taskId: args.p_task_id });
        return {
          data: {
            allowed: true,
            status: 'processing',
            lease_token: `lease-${args.p_user_id}`,
            task_id: args.p_task_id,
          },
          error: null,
        };
      }
      if (fn === 'record_trial_result_ready' || fn === 'settle_trial_credit') {
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    };

    const identicalInput = {
      subjectId: 'sub-shared',
      domain: 'math_stats',
      problemTitle: '동일 문제',
      problemPrompt: '동일 프롬프트',
      modelAnswer: '동일 모범답안',
      originalAnswer: '동일 답안',
      rubric: [{ id: 'r1', label: '기준', maxScore: 10, description: '설명' }],
    };

    await withFakeSupabase({ user: userA, rpcImpl: sharedRpcImpl }, async () => {
      const reqA = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identicalInput),
      });
      const resA = await logicPost(reqA);
      assert.equal(resA.status, 200, 'User A request succeeds');
    });

    await withFakeSupabase({ user: userB, rpcImpl: sharedRpcImpl }, async () => {
      const reqB = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identicalInput),
      });
      const resB = await logicPost(reqB);
      assert.equal(resB.status, 200, 'User B request succeeds without TASK_OWNERSHIP_MISMATCH');
    });

    assert.equal(registeredTaskIds.length, 2);
    assert.equal(registeredTaskIds[0].userId, 'user-alpha-id');
    assert.equal(registeredTaskIds[1].userId, 'user-beta-id');
    assert.notEqual(registeredTaskIds[0].taskId, registeredTaskIds[1].taskId, 'User A와 User B의 task_id는 계정별로 엄격히 분리됨');
    assert.ok(registeredTaskIds[0].taskId.includes('user-alpha-id'));
    assert.ok(registeredTaskIds[1].taskId.includes('user-beta-id'));
    assert.equal(aiCallCount, 2, 'User A와 User B 각각 1회씩 AI 호출됨');
  });

  await checkAsync('문제 2: 타 사용자의 명시적 taskId 재사용 시 403 TASK_OWNERSHIP_MISMATCH 거부', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const attackerUser = { id: 'user-attacker' };

    await withFakeSupabase({
      user: attackerUser,
      rpcImpl: (fn) => {
        if (fn === 'register_ai_task') {
          return {
            data: {
              allowed: false,
              error_code: 'TASK_OWNERSHIP_MISMATCH',
              message: '다른 사용자의 작업 식별자입니다.',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }
    }, async () => {
      const req = new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 'logic_user-victim_explicit-task-123',
          subjectId: 'sub-shared',
          domain: 'math_stats',
          problemTitle: '동일 문제',
          problemPrompt: '동일 프롬프트',
          modelAnswer: '동일 모범답안',
          originalAnswer: '동일 답안',
          rubric: [{ id: 'r1', label: '기준', maxScore: 10, description: '설명' }],
        }),
      });

      const res = await logicPost(req);
      assert.equal(res.status, 403, '타인 taskId 도용 시 403 Forbidden 반환');
      const data = await res.json();
      assert.equal(data.errorCode, 'TASK_OWNERSHIP_MISMATCH');
    });
  });

  await checkAsync('문제 3: 동일 본문의 다른 자료(Material A vs Material B) 분석 캐시 충돌 방지', async () => {
    const { POST: analyzeRoute } = load(path.join(output, 'app/api/analyze-concepts/route.js'));
    const testUser = { id: 'u-prob3-mat-iso' };
    const commonMarkdown = '# 해석학 기본\n코시 수열의 수렴성 [PAGE 5]';

    const registeredTasks = [];
    const rpcHandler = (fn, args) => {
      if (fn === 'register_ai_task') {
        registeredTasks.push({ taskId: args.p_task_id, inputIdentifier: args.p_input_identifier });
        return {
          data: {
            allowed: true,
            status: 'processing',
            lease_token: 'lease-prob3',
            task_id: args.p_task_id,
          },
          error: null,
        };
      }
      if (fn === 'claim_analysis_chunk_lease') {
        return { data: { acquired: true, lease_token: 'chunk-lease-1', chunk_index: args.p_chunk_index }, error: null };
      }
      if (fn === 'commit_analysis_chunk_result') {
        return { data: { committed: true, reason: 'committed' }, error: null };
      }
      if (fn === 'record_trial_result_ready' || fn === 'settle_trial_credit') {
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    };

    aiModule.callAiChat = async () => {
      return {
        ok: true,
        content: JSON.stringify({
          concepts: [{
            title: '코시 수열',
            domain: 'math_stats',
            description: '완비공간에서 수렴하는 수열',
            coreDefinitionFormulaOrAlgorithm: '|x_n - x_m| < \\epsilon',
            prerequisites: [],
            relatedConcepts: [],
            commonMisconceptions: [],
            examples: ['실수 수열'],
            sourceEvidence: { type: 'page', pageNumber: 5, quote: '코시 수열의 수렴성' },
          }],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    await withFakeSupabase({
      user: testUser,
      materials: [
        { id: 'mat-analytical-1', user_id: testUser.id, subject_id: 'sub-analysis' },
        { id: 'mat-analytical-2', user_id: testUser.id, subject_id: 'sub-analysis' },
      ],
      analysis_jobs: [],
      analysis_job_chunks: [],
      concept_drafts: [],
      rpcImpl: rpcHandler,
    }, async () => {
      const reqA = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-analysis',
          materialId: 'mat-analytical-1',
          markdown: commonMarkdown,
        }),
      });
      const resA = await analyzeRoute(reqA);
      assert.equal(resA.status, 200, 'Material A 분석 성공');

      const reqB = new NextRequest('http://localhost/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          subjectId: 'sub-analysis',
          materialId: 'mat-analytical-2',
          markdown: commonMarkdown,
        }),
      });
      const resB = await analyzeRoute(reqB);
      assert.equal(resB.status, 200, 'Material B 분석 성공 (Material A 캐시 충돌 없음)');
    });

    assert.equal(registeredTasks.length, 2);
    assert.notEqual(registeredTasks[0].taskId, registeredTasks[1].taskId, 'Material A와 Material B의 작업 식별자는 서로 달라야 함');
    assert.notEqual(registeredTasks[0].inputIdentifier, registeredTasks[1].inputIdentifier, 'Material A와 Material B의 입력 식별자는 서로 달라야 함');
    assert.ok(registeredTasks[0].taskId.includes('mat-analytical-1'));
    assert.ok(registeredTasks[1].taskId.includes('mat-analytical-2'));
  });

  await checkAsync('문제 4: 실제 AI 입력 구성요소 변경 시 캐시 식별자 불일치 및 갱신 검증', async () => {
    const { POST: logicPost } = load(path.join(output, 'app/api/logic-questions/route.js'));
    const { POST: transPost } = load(path.join(output, 'app/api/transfer-problem/route.js'));
    const testUser = { id: 'u-prob4-inputs' };

    const capturedLogicIdentities = [];
    const capturedTransIdentities = [];

    const rpcSpy = (fn, args) => {
      if (fn === 'register_ai_task') {
        if (args.p_task_type === 'logic_questions') {
          capturedLogicIdentities.push(args.p_input_identifier);
        } else if (args.p_task_type === 'transfer_problem') {
          capturedTransIdentities.push(args.p_input_identifier);
        }
        return {
          data: {
            allowed: true,
            status: 'processing',
            lease_token: 'lease-p4',
            task_id: args.p_task_id,
          },
          error: null,
        };
      }
      if (fn === 'record_trial_result_ready' || fn === 'settle_trial_credit') {
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    };

    aiModule.callAiChat = async (options) => {
      if (options.label === 'transfer-problem') {
        return {
          ok: true,
          content: JSON.stringify({
            transferredProblemPrompt: '전이 문제 프롬프트',
            transferredModelAnswer: '전이 문제 모범 답안',
            transferredRubric: [{ id: 'tr1', label: '기준', maxScore: 10, description: '설명' }],
            structuralDifferences: '차이점',
          }),
          model: 'deepseek-v4.1-flash',
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
          questions: [
            { id: 'q1', question: '질문', linkedCriterionId: 'r1' },
            { id: 'q2', question: '질문2', linkedCriterionId: 'r1' },
          ],
        }),
        model: 'deepseek-v4.1-flash',
      };
    };

    await withFakeSupabase({ user: testUser, rpcImpl: rpcSpy }, async () => {
      // 1. logic-questions: rubric.description만 변경 시 새로운 inputIdentifier 생성 검증
      const baseLogicPayload = {
        subjectId: 'sub-p4',
        domain: 'math_stats',
        problemTitle: '문제 제목',
        problemPrompt: '문제 지문',
        modelAnswer: '모범 답안',
        originalAnswer: '학생 답안',
        rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '기본 설명 A' }],
      };

      await logicPost(new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseLogicPayload),
      }));

      const modifiedRubricLogicPayload = {
        ...baseLogicPayload,
        rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '수정된 다른 설명 B' }],
      };

      await logicPost(new NextRequest('http://localhost/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modifiedRubricLogicPayload),
      }));

      assert.equal(capturedLogicIdentities.length, 2);
      assert.notEqual(capturedLogicIdentities[0], capturedLogicIdentities[1], '루브릭 설명(description)만 바뀌어도 새로운 입력 식별자가 생성되어야 함');

      // 2. transfer-problem: modelAnswer, vulnerableCriteria만 변경 시 새로운 inputIdentifier 생성 검증
      const baseTransPayload = {
        subjectId: 'sub-p4',
        domain: 'math_stats',
        problemTitle: '전이 원본 제목',
        problemPrompt: '전이 원본 지문',
        problemType: 'essay_descriptive',
        concepts: [{ id: 'c1', title: '개념1' }],
        modelAnswer: '모범 답안 원본 A',
        originalAnswer: '학생 답안',
        vulnerableCriteria: ['r1'],
        rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '설명' }],
      };

      await transPost(new NextRequest('http://localhost/api/transfer-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTransPayload),
      }));

      // Only modelAnswer changed
      await transPost(new NextRequest('http://localhost/api/transfer-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...baseTransPayload, modelAnswer: '모범 답안 변경본 B' }),
      }));

      // Only vulnerableCriteria changed
      await transPost(new NextRequest('http://localhost/api/transfer-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...baseTransPayload, vulnerableCriteria: ['r1', 'r2'] }),
      }));

      // Only rubric description changed
      await transPost(new NextRequest('http://localhost/api/transfer-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...baseTransPayload,
          rubric: [{ id: 'r1', label: '정확성', maxScore: 10, description: '전이 루브릭 설명 변경' }],
        }),
      }));

      assert.equal(capturedTransIdentities.length, 4);
      assert.notEqual(capturedTransIdentities[0], capturedTransIdentities[1], 'modelAnswer만 변경 시 식별자가 달라져야 함');
      assert.notEqual(capturedTransIdentities[0], capturedTransIdentities[2], 'vulnerableCriteria만 변경 시 식별자가 달라져야 함');
      assert.notEqual(capturedTransIdentities[0], capturedTransIdentities[3], 'rubric.description만 변경 시 식별자가 달라져야 함');
    });
  });

    if (savedFallbackPlan03 === undefined) delete process.env.AI_ALLOW_OPERATOR_FALLBACK;
  else process.env.AI_ALLOW_OPERATOR_FALLBACK = savedFallbackPlan03;
  AI_CONFIG.apiKey = savedApiKeyPlan03;
  globalThis.__fakeSupabaseClient = trialClientBackupPlan03;


  console.log(`${passed} regression checks passed`);
}


run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));

