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
  'lib/personalization.ts', 'lib/logicSession.ts', 'lib/logicValidation.ts', 'lib/logicAsync.ts',
  'lib/academicProofing.ts', 'lib/aiConfig.ts', 'lib/asyncRequestTracker.ts', 'lib/learningAnalytics.ts', 'lib/transferValidation.ts',
  'lib/storageScope.ts', 'lib/auth/redirects.ts', 'lib/legacyImport.ts', 'lib/appReadiness.ts',
  'lib/cloud/hash.ts', 'lib/cloud/mappers.ts', 'lib/cloud/plan.ts',
  'lib/cloud/subjectsRepository.ts', 'lib/cloud/materialsRepository.ts', 'lib/cloud/library.ts',
  'lib/cloud/migrationOriginals.ts', 'lib/cloud/localMigration.ts',
  'lib/cloud/learningMappers.ts', 'lib/cloud/learningPlan.ts', 'lib/cloud/learningRepository.ts',
  'lib/cloud/mergeLearning.ts', 'lib/cloud/learningOriginals.ts', 'lib/learningApproval.ts',
  'app/api/evaluate-answer/route.ts', 'app/api/logic-questions/route.ts', 'app/api/transfer-problem/route.ts',
  '--outDir', output, '--module', 'commonjs', '--target', 'ES2020', '--moduleResolution', 'node',
  '--esModuleInterop', '--skipLibCheck', '--strict'], { cwd: root, encoding: 'utf8' });

async function run() {
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
  if (mode === 'authenticated') return { ok: true, user: { id: 'test-user', email: 'test@example.com' } };
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
    `exports.createClient = () => globalThis.__fakeSupabaseClient;`
  );
  delete load.cache[supabaseClientPath];

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

  const storage = load(path.join(output, 'lib/storage.js'));
  const exams = load(path.join(output, 'lib/mockExam.js'));
  const validation = load(path.join(output, 'lib/evaluationValidation.js'));
  const matStorage = load(path.join(output, 'lib/materialStorage.js'));
  const problemSources = load(path.join(output, 'lib/problemSources.js'));
  const problemFreshness = load(path.join(output, 'lib/problemFreshness.js'));
  const studyPlan = load(path.join(output, 'lib/studyPlan.js'));
  const logicSession = load(path.join(output, 'lib/logicSession.js'));
  const logicValidation = load(path.join(output, 'lib/logicValidation.js'));
  const transferValidation = load(path.join(output, 'lib/transferValidation.js'));
  const logicAsync = load(path.join(output, 'lib/logicAsync.js'));
  const asyncTracker = load(path.join(output, 'lib/asyncRequestTracker.js'));
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

  // ---- Authentication gate ----
  const callsBeforeAnonymous = calls;
  auth.__setMode('anonymous');
  const unauthenticated = await POST(request(body));
  check('unauthenticated AI evaluation is blocked with 401 before any AI call', () => {
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls, callsBeforeAnonymous);
  });
  auth.__setMode('authenticated');

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
  const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

  // A minimal in-memory IndexedDB that supports the operations materialStorage
  // uses, with failure injection so read/write/abort paths can be exercised
  // without replacing the service under test.
  function createFakeIndexedDB() {
    const databases = new Map();
    const failure = { get: new Set(), getAll: false, put: new Set(), abortPut: new Set(), corruptPut: new Set() };

    const recordFor = (name) => {
      if (!databases.has(name)) databases.set(name, new Map());
      return databases.get(name);
    };

    const makeRequest = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null });

    const makeTransaction = (stores, storeName) => {
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
        get: (id) => {
          const req = makeRequest();
          setTimeout(() => {
            if (failure.get.has(id)) { req.error = new Error('injected read failure'); if (req.onerror) req.onerror(); finish('error', req.error); return; }
            req.result = store.has(id) ? structuredClone(store.get(id)) : undefined;
            if (req.onsuccess) req.onsuccess();
          }, 0);
          return req;
        },
        getAll: () => {
          const req = makeRequest();
          setTimeout(() => {
            if (failure.getAll) { req.error = new Error('injected getAll failure'); if (req.onerror) req.onerror(); return; }
            req.result = Array.from(store.values()).map((value) => structuredClone(value));
            if (req.onsuccess) req.onsuccess();
          }, 0);
          return req;
        },
        getAllKeys: () => {
          const req = makeRequest();
          setTimeout(() => { req.result = Array.from(store.keys()); if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        put: (value) => {
          const req = makeRequest();
          setTimeout(() => {
            if (failure.abortPut.has(value.materialId)) { finish('abort', new Error('injected abort')); return; }
            if (failure.put.has(value.materialId)) { req.error = new Error('injected write failure'); if (req.onerror) req.onerror(); finish('error', req.error); return; }
            if (failure.corruptPut.has(value.materialId)) {
              store.set(value.materialId, structuredClone({ ...value, markdown: String(value.markdown || '') + ' corrupted' }));
              req.result = value.materialId;
              if (req.onsuccess) req.onsuccess();
              finish('complete');
              return;
            }
            store.set(value.materialId, structuredClone(value));
            req.result = value.materialId;
            if (req.onsuccess) req.onsuccess();
            finish('complete');
          }, 0);
          return req;
        },
        delete: (id) => {
          const req = makeRequest();
          setTimeout(() => { store.delete(id); if (req.onsuccess) req.onsuccess(); finish('complete'); }, 0);
          return req;
        },
        clear: () => {
          const req = makeRequest();
          setTimeout(() => { store.clear(); if (req.onsuccess) req.onsuccess(); finish('complete'); }, 0);
          return req;
        },
      };
      tx.objectStore = () => api;
      return tx;
    };

    return {
      __failure: failure,
      __databases: databases,
      open(name) {
        const request = makeRequest();
        setTimeout(() => {
          const stores = recordFor(name);
          const db = {
            name,
            objectStoreNames: { contains: (storeName) => stores.has(storeName) },
            createObjectStore: (storeName) => { if (!stores.has(storeName)) stores.set(storeName, new Map()); return {}; },
            transaction: (storeName, mode) => makeTransaction(stores, storeName, mode || 'readonly'),
            close: () => {},
          };
          request.result = db;
          if (request.onupgradeneeded) request.onupgradeneeded({ target: request });
          if (request.onsuccess) request.onsuccess({ target: request });
        }, 0);
        return request;
      },
    };
  }

  const withFakeIndexedDB = async (fn) => {
    const fake = createFakeIndexedDB();
    window.indexedDB = fake;
    try {
      return await fn(fake);
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
      delete window.indexedDB;
    }
  };

  // A controllable fake Supabase client used to exercise the real repository
  // code with injected failures at the external boundary.
  function createFakeSupabase(options = {}) {
    const state = {
      user: options.user === undefined ? { id: 'user-a' } : options.user,
      subjects: options.subjects ? [...options.subjects] : [],
      materials: options.materials ? [...options.materials] : [],
      objects: new Map(options.objects ? Object.entries(options.objects) : []),
      fail: options.fail || {},
      rpcCalls: [],
      rpcResult: options.rpcResult,
    };
    // Seed any additional table arrays provided in options.
    for (const key of Object.keys(options)) {
      if (['user', 'subjects', 'materials', 'objects', 'fail', 'rpcResult'].includes(key)) continue;
      if (Array.isArray(options[key])) state[key] = [...options[key]];
    }
    const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
    const nowIso = () => new Date().toISOString();
    const matchFilters = (rows, filters) =>
      rows.filter((row) => filters.every(([col, val]) => row[col] === val));

    function tableBuilder(table) {
      const ctx = { op: 'select', payload: null, onConflict: null, filters: [], order: null };
      const builder = {
        select() { return builder; },
        order(col, opts) { ctx.order = { col, opts }; return builder; },
        eq(col, val) { ctx.filters.push([col, val]); return builder; },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return builder; },
        upsert(payload, opts) { ctx.op = 'upsert'; ctx.payload = payload; ctx.onConflict = opts && opts.onConflict; return builder; },
        delete() { ctx.op = 'delete'; return builder; },
        maybeSingle() { return exec(true); },
        single() { return exec(false); },
        then(resolve, reject) { return exec(null).then(resolve, reject); },
      };

      async function exec(maybe) {
        const rows = (state[table] = state[table] || []);
        try {
          if (ctx.op === 'select') {
            let result = matchFilters(rows, ctx.filters);
            if (ctx.order) {
              const { col, opts } = ctx.order;
              const dir = opts && opts.ascending ? 1 : -1;
              result = [...result].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * dir);
            }
            if (maybe === true) return { data: result[0] ? clone(result[0]) : null, error: null };
            if (maybe === false) {
              if (result.length === 0) return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
              return { data: clone(result[0]), error: null };
            }
            return { data: result.map(clone), error: null };
          }
          if (ctx.op === 'upsert') {
            if (state.fail.upsert) return { data: null, error: { message: 'injected upsert failure' } };
            const keys = (ctx.onConflict || 'id').split(',').map((s) => s.trim());
            const items = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
            const savedItems = [];
            for (const raw of items) {
              const payload = { ...raw };
              if (payload.user_id === undefined) payload.user_id = state.user ? state.user.id : null;
              const idx = rows.findIndex((row) => keys.every((k) => row[k] === payload[k]));
              let saved;
              if (idx >= 0) {
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

    const storage = {
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
      },
      from(table) { return tableBuilder(table); },
      rpc(name, params) {
        if (state.fail.rpc) {
          return Promise.resolve({ data: null, error: { message: state.fail.rpcMessage || 'injected rpc failure' } });
        }
        state.rpcCalls.push({ name, params });
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
      assert.equal(row.title, 'new', 'content updated');
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
    assert.equal(ok.status, 200);
    const okJson = await ok.json();
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

  console.log(`${passed} regression checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));

