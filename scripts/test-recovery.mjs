import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learnaway-recovery-'));
const load = createRequire(import.meta.url);
let failed = 0;
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}
const problem = {
  id: 'recovery-p', subjectId: 's', title: 'Title', promptText: 'Server',
  type: 'essay_descriptive', conceptIds: ['c'], modelAnswer: 'Answer',
  hints: [], rubric: [{ id: 'r', label: 'R', maxScore: 100 }],
  timeStandardMinutes: 10, version: 3, serverConfirmedVersion: 3,
};
const revision = {
  ...problem, problemId: problem.id, revisionId: 'revision-a', generation: 1,
  baseVersion: 1, revisionVersion: 2, revisedAt: '2026-01-01T00:00:00Z',
  syncStatus: 'conflict', serverLatestSummary: problem,
};
const draft = {
  problemId: 'p', problemVersion: 1, tabId: 'tab', answerText: 'OLD',
  revealedHints: [], confidence: 3, errorType: 'none', reasoningNotes: '',
  solvingReason: '', isReasonNotApplicable: false,
  reasonNotApplicableJustification: '', savedAt: '2026-01-01T00:00:00Z',
};

try {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/storage.ts', 'lib/practiceAnswerDraft.ts', 'lib/cloud/library.ts',
    'lib/cloud/pendingExamAnswers.ts', 'lib/cloud/mockExamSync.ts',
    'app/api/convert/route.ts', '--rootDir', root, '--outDir', output,
    'components/ProblemSessionModal.tsx', '--jsx', 'react-jsx',
    '--module', 'commonjs', '--target', 'ES2020', '--moduleResolution', 'node',
    '--esModuleInterop', '--skipLibCheck', '--strict',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');
  const storage = load(path.join(output, 'lib/storage.js'));
  const scope = load(path.join(output, 'lib/storageScope.js'));
  const practice = load(path.join(output, 'lib/practiceAnswerDraft.js'));
  const pendingExam = load(path.join(output, 'lib/cloud/pendingExamAnswers.js'));
  const mockExamSync = load(path.join(output, 'lib/cloud/mockExamSync.js'));

  await check('revision read failure never deletes sibling edits or reports a save', () => {
    scope.setStorageScope({ kind: 'user', userId: 'recovery-test' });
    const adapter = memoryStorage();
    storage.setStorageAdapterForTest(adapter);
    assert.equal(storage.saveUnsavedProblemRevision(revision), true);
    assert.equal(storage.saveUnsavedProblemRevision({ ...revision, problemId: 'sibling' }), true);
    const before = [...adapter.data.entries()];
    const get = adapter.getItem;
    let failOnce = true, writes = 0;
    adapter.getItem = (key) => {
      if (failOnce && key.endsWith('unsaved_problem_revisions_v1')) {
        failOnce = false; throw new Error('injected read failure');
      }
      return get(key);
    };
    const set = adapter.setItem;
    adapter.setItem = (k, v) => { writes++; set(k, v); };
    assert.equal(storage.saveUnsavedProblemRevision({ ...revision, generation: 2 }), false);
    assert.equal(writes, 0);
    assert.deepEqual([...adapter.data.entries()], before);
    assert.ok(storage.getUnsavedProblemRevision('sibling'));
  });

  await check('corrupt revision maps are never replaced, and deletion read-back failure keeps memory', () => {
    for (const raw of ['{broken', '[]', 'null', '{"other":null}']) {
      const adapter = memoryStorage();
      storage.setStorageAdapterForTest(adapter);
      storage.saveUnsavedProblemRevision(revision);
      const key = [...adapter.data.keys()][0];
      adapter.data.set(key, raw);
      assert.equal(storage.saveUnsavedProblemRevision(revision), false);
      assert.equal(storage.clearUnsavedProblemRevision(problem.id), false);
      assert.equal(adapter.data.get(key), raw);
    }
    const adapter = memoryStorage();
    storage.setStorageAdapterForTest(adapter);
    storage.saveUnsavedProblemRevision(revision);
    const get = adapter.getItem, set = adapter.setItem;
    let afterDelete = false, reads = 0;
    adapter.setItem = (k, v) => { set(k, v); afterDelete = true; };
    adapter.getItem = (k) => {
      if (afterDelete && ++reads === 2) throw new Error('verification read failure');
      return get(k);
    };
    assert.equal(storage.clearUnsavedProblemRevision(problem.id), false);
    assert.ok(storage.getInMemoryProblemRevision(problem.id));
    adapter.getItem = get;
    // Retry confirms absence rather than erasing the retained memory blindly.
    assert.equal(storage.saveUnsavedProblemRevision(revision), true);
    assert.equal(storage.clearUnsavedProblemRevision(problem.id), true);
    assert.equal(storage.getUnsavedProblemRevision(problem.id), null);
  });

  await check('cleanup intent survives a failed read and performs zero body writes', () => {
    const adapter = memoryStorage();
    storage.setStorageAdapterForTest(adapter);
    storage.saveStoredProblems([problem]);
    storage.saveUnsavedProblemRevision(revision);
    const set = adapter.setItem;
    adapter.setItem = (key, value) => {
      if (key.endsWith('unsaved_problem_revisions_v1')) throw new Error('injected quota');
      set(key, value);
    };
    let res = storage.resolveProblemRevisionConflict(problem.id, 'accept_server', {
      scopeId: scope.getStorageScopeId(), revisionId: revision.revisionId,
      generation: revision.generation, serverProblem: problem,
    });
    assert.equal(res.status, 'partial_cleanup_failed');
    const partial = res;
    let bodyWrites = 0;
    adapter.setItem = (key, value) => { if (key.endsWith('problems_v1')) bodyWrites++; set(key, value); };
    const get = adapter.getItem;
    let failOnce = true;
    adapter.getItem = (key) => {
      if (failOnce && key.endsWith('problems_v1')) { failOnce = false; throw new Error('injected read'); }
      return get(key);
    };
    for (let i = 0; i < 2; i++) {
      const req = storage.buildConflictResolutionRequest(revision, 'accept_server', res);
      assert.equal(req.action, 'retry_cleanup');
      res = storage.resolveProblemRevisionConflict(problem.id, req.action, req.params);
    }
    assert.equal(res.status, 'complete');
    assert.equal(bodyWrites, 0);
    // The request remains bound to the original edit and account even if the UI changed.
    storage.saveUnsavedProblemRevision({ ...revision, revisionId: 'new-edit', generation: 2 });
    const staleRequest = storage.buildConflictResolutionRequest(
      { ...revision, revisionId: 'new-edit', generation: 2 }, 'accept_server', partial);
    assert.equal(staleRequest.params.revisionId, revision.revisionId);
    assert.equal(storage.resolveProblemRevisionConflict('different-problem', staleRequest.action, staleRequest.params).status, 'stale_revision_aborted');
    assert.equal(storage.resolveProblemRevisionConflict(problem.id, staleRequest.action, staleRequest.params).status, 'stale_revision_aborted');
    scope.setStorageScope({ kind: 'user', userId: 'another-account' });
    const newAccount = memoryStorage();
    storage.setStorageAdapterForTest(newAccount);
    assert.equal(storage.resolveProblemRevisionConflict(problem.id, staleRequest.action, staleRequest.params).status, 'scope_changed');
    assert.equal(newAccount.data.size, 0);
    scope.setStorageScope({ kind: 'user', userId: 'recovery-test' });
  });

  await check('practice read failure is contained at the storage boundary', () => {
    global.window = { localStorage: { getItem() { throw new Error('blocked read'); } } };
    assert.doesNotThrow(() => practice.loadPracticeAnswerDraftForTab('u', 'p', 1, 'tab'));
    assert.equal(practice.loadPracticeDraftState('u', 'p', 1, 'tab').ok, false);
  });

  await check('practice editor renders a storage failure notice instead of crashing', () => {
    const React = load('react');
    const { renderToString } = load('react-dom/server');
    const { INITIAL_PROBLEMS, INITIAL_CONCEPTS, INITIAL_SUBJECTS } = load(path.join(output, 'lib/initialData.js'));
    const { ProblemSessionModal } = load(path.join(output, 'components/ProblemSessionModal.js'));
    const session = memoryStorage();
    global.window = { localStorage: { getItem() { throw new Error('blocked'); } }, sessionStorage: session };
    const html = renderToString(React.createElement(ProblemSessionModal, {
      isOpen: true, userId: 'u', problem: INITIAL_PROBLEMS[0],
      concept: INITIAL_CONCEPTS[0], subject: INITIAL_SUBJECTS[0],
      onClose() {}, onSubmitAttempt: async () => ({}),
    }));
    assert.ok(html.includes('자동저장을 중지했습니다'));
    assert.ok(html.includes('초안 확인 다시 시도'));
  });

  await check('legacy migration retry preserves newer and explicitly emptied answers', () => {
    for (const answerText of ['NEW', '']) {
      const adapter = memoryStorage();
      global.window = { localStorage: adapter };
      const key = 'redcall_user_u__practice_answer_drafts_v1';
      adapter.setItem(key, JSON.stringify({ 'p::tab': draft }));
      const remove = adapter.removeItem;
      adapter.removeItem = (k) => { if (k === key) throw new Error('read-only legacy'); remove(k); };
      practice.loadPracticeAnswerDraftForTab('u', 'p', 1, 'tab');
      assert.equal(practice.loadPracticeDraftState('u', 'p', 1, 'tab').ok, true,
        'legacy cleanup failure must not block editing verified entries');
      assert.equal(practice.savePracticeAnswerDraft('u', { ...draft, answerText }), true);
      adapter.removeItem = remove;
      assert.equal(practice.loadPracticeAnswerDraftForTab('u', 'p', 1, 'tab').answerText, answerText);
      const state = practice.loadPracticeDraftState('u', 'p', 1, 'tab');
      assert.equal(state.ok, true);
      assert.equal(state.draft.answerText, answerText);
      assert.ok(state.recoverable.some((d) => d.answerText === 'OLD'));
      assert.ok(adapter.getItem(key), 'conflicting legacy source remains available');
    }
  });

  await check('editor snapshot scans once, filters identities, and rejects corrupt draft fields', () => {
    const adapter = memoryStorage();
    global.window = { localStorage: adapter };
    for (let i = 0; i < 1000; i++) {
      practice.savePracticeAnswerDraft('u', { ...draft, tabId: `tab-${i}` });
    }
    practice.savePracticeAnswerDraft('other', { ...draft, answerText: 'other user' });
    let reads = 0;
    const get = adapter.getItem;
    adapter.getItem = (key) => { reads++; return get(key); };
    const state = practice.loadPracticeDraftState('u', 'p', 1, 'tab-0');
    assert.equal(state.ok, true);
    assert.equal(state.recoverable.length, 999);
    assert.equal(reads, 1001, 'one legacy lookup plus one read per account draft');
    assert.equal(practice.loadPracticeDraftState('u', 'different-problem', 1, 'tab-0').draft, null);
    const key = [...adapter.data.keys()].find((k) => k.endsWith('__tab-0'));
    adapter.data.set(key, JSON.stringify({ problemId: 'p', problemVersion: 1, tabId: 'tab-0' }));
    assert.equal(practice.loadPracticeDraftState('u', 'p', 1, 'tab-0').ok, false);
    assert.equal(practice.loadPracticeAnswerDraftForTab('u', 'p', 1, 'tab-0'), null);
  });

  // Replace only authenticated-user / DB / external-service boundaries; execute the real handler.
  const authPath = path.join(output, 'lib/auth/apiAuth.js');
  load.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
    exports: { requireApiUser: async () => ({ ok: true, user: { id: 'pdf-user' } }) } };
  const adminPath = path.join(output, 'lib/supabase/admin.js');
  let cleanupCalls = 0;
  const admin = {
    from() {
      const query = { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { job_id: 'pdf-job', user_id: 'pdf-user',
          storage_path: 'pdf-user/temp-convert/pdf-job/test.pdf', status: 'uploaded' }, error: null }) };
      return query;
    },
    rpc: async (name) => ({ data: name === 'claim_temp_pdf_cleanup_by_converter'
      ? { cleanup_token: 'cleanup', success: true } : { lease_token: 'lease', success: true }, error: null }),
    storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/signed' }, error: null }),
      remove: async () => { cleanupCalls++; return { error: null }; },
    }) },
  };
  load.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true,
    exports: { createAdminClient: () => admin, hasAdminClientConfig: () => true } };
  const { NextRequest } = load('next/server');
  const { POST } = load(path.join(output, 'app/api/convert/route.js'));
  const originalFetch = global.fetch;
  process.env.PDF_CONVERT_SERVICE_URL = 'https://converter.invalid';
  process.env.PDF_CONVERT_SERVICE_TOKEN = 'local-fixture-token';
  await check('storage PDF route preserves rate limits and hides provider internals', async () => {
    global.fetch = async () => Response.json({ detail: 'private-provider-detail' }, {
      status: 429, headers: { 'Retry-After': '12' },
    });
    const response = await POST(new NextRequest('http://localhost/api/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'convert_storage', jobId: 'pdf-job' }),
    }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '12');
    const data = await response.json();
    assert.equal(data.success, false);
    assert.ok(data.error);
    assert.ok(!JSON.stringify(data).includes('private-provider-detail'));
    assert.ok(!data.pages || data.pages.length === 0);
    assert.equal(cleanupCalls, 1);
  });
  global.fetch = originalFetch;
  await check('PDF error matrix returns structured failures and normal conversion keeps cleanup', async () => {
    for (const [status, payload, expected] of [
      [503, { detail: 'private' }, 502],
      [502, '<html>private</html>', 502],
      [200, { success: false, error: 'private' }, 502],
      [200, 'not JSON', 502],
      [422, { success: false, code: 'PDF_ENCRYPTED', error: 'private' }, 422],
      [200, { success: true, fullMarkdown: 'converted', pageCount: 1, pages: [] }, 200],
    ]) {
      global.fetch = async () => typeof payload === 'string'
        ? new Response(payload, { status }) : Response.json(payload, { status });
      const before = cleanupCalls;
      const response = await POST(new NextRequest('http://localhost/api/convert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert_storage', jobId: 'pdf-job' }),
      }));
      assert.equal(response.status, expected);
      const body = await response.json();
      assert.equal(body.success, expected === 200);
      if (expected !== 200) {
        assert.ok(body.code && body.error);
        assert.equal(body.pageCount, 0);
        assert.deepEqual(body.pages, []);
        assert.ok(!JSON.stringify(body).includes('private'));
      } else {
        assert.equal(body.fullMarkdown, 'converted');
      }
      assert.equal(cleanupCalls, before + 1);
    }
  });
  global.fetch = originalFetch;

  await check('cloud library bounds concurrent downloads to three and preserves ordering / errors', async () => {
    const subjectsPath = path.join(output, 'lib/cloud/subjectsRepository.js');
    const materialsPath = path.join(output, 'lib/cloud/materialsRepository.js');
    let active = 0, peak = 0, fail = false;
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: String(i), user_id: 'u', subject_id: 's', title: `M${i}`, kind: 'pdf',
      upload_state: i === 5 ? 'deleting' : i === 6 ? 'pending' : 'ready',
    }));
    load.cache[subjectsPath] = { id: subjectsPath, filename: subjectsPath, loaded: true,
      exports: { listSubjects: async () => ({ ok: true, data: [] }) } };
    load.cache[materialsPath] = { id: materialsPath, filename: materialsPath, loaded: true,
      exports: {
        listMaterialRows: async () => ({ ok: true, data: rows }),
        downloadMaterialContent: async (row) => {
          active++; peak = Math.max(peak, active);
          assert.equal(row.upload_state, 'ready');
          await new Promise((resolve) => setTimeout(resolve, row.id === '0' ? 20 : 1));
          active--;
          return fail && row.id === '1' ? { ok: false, error: 'fixture' }
            : { ok: true, data: { markdown: row.id } };
        },
      } };
    const { loadCloudLibrary } = load(path.join(output, 'lib/cloud/library.js'));
    const result = await loadCloudLibrary();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.materials.map((m) => m.id), ['0', '1', '2', '3', '4', '6']);
    assert.equal(peak, 3);
    fail = true;
    assert.equal((await loadCloudLibrary()).ok, false);
    assert.equal(active, 0, 'in-flight tasks settle before error return');
  });
  await check('pending exam & conflict archive preserve originals on read/corrupt/write failures and isolate users/sessions', () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const makeSess = (id, ans = 'A') => ({
        id, subjectId: 'sub-1', createdAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-01T01:00:00Z',
        durationMinutes: 60, status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: ans }, reasons: { p1: 'why' }, isReasonNotApplicable: {}, reasonNotApplicableJustification: {}, evaluations: {},
      });
      const makeArch = (sessionId, ans = 'A') => ({
        sessionId, answers: { p1: ans }, reasons: { p1: 'why' }, isReasonNotApplicable: {},
        reasonNotApplicableJustification: {}, baseVersion: 1, comparedServerVersion: 2, savedAt: '2026-01-01T00:00:00Z',
      });

      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;
      const tabId = 'tab-1';

      assert.equal(pendingExam.savePendingExamAnswers('u-a', makeSess('s1', 'A1'), 1, tabId), true);
      assert.equal(pendingExam.savePendingExamAnswers('u-a', makeSess('s2', 'A2'), 1, tabId), true);
      assert.equal(pendingExam.savePendingExamAnswers('u-b', makeSess('s1', 'B1'), 1, tabId), true);
      assert.deepEqual(pendingExam.saveConflictArchive('u-a', makeArch('s1', 'A1'), tabId), { ok: true });
      assert.deepEqual(pendingExam.saveConflictArchive('u-a', makeArch('s2', 'A2'), tabId), { ok: true });

      // 1. Read exception must abort writes and preserve sibling sessions.
      const beforeEntries = [...mem.data.entries()];
      const origGet = mem.getItem;
      const origSet = mem.setItem;
      let writes = 0;
      mem.getItem = () => { throw new Error('injected read failure'); };
      mem.setItem = (k, v) => { writes++; origSet(k, v); };

      assert.equal(pendingExam.savePendingExamAnswers('u-a', makeSess('s3', 'A3'), 1, tabId), false);
      assert.equal(pendingExam.clearPendingExamAnswers('u-a', 's1', tabId), false);
      assert.equal(pendingExam.saveConflictArchive('u-a', makeArch('s3', 'A3'), tabId).ok, false);
      assert.equal(pendingExam.clearConflictArchive('u-a', 's1', tabId), false);
      assert.equal(writes, 0);
      assert.deepEqual([...mem.data.entries()], beforeEntries);
      assert.equal(pendingExam.loadPendingExamAnswersResult('u-a', 's1', tabId).ok, false);
      assert.equal(pendingExam.loadConflictArchiveResult('u-a', 's1', tabId).ok, false);

      mem.getItem = origGet;
      mem.setItem = origSet;
      assert.equal(pendingExam.loadPendingExamAnswers('u-a', 's2', tabId)?.answers.p1, 'A2');
      assert.equal(pendingExam.loadPendingExamAnswers('u-b', 's1', tabId)?.answers.p1, 'B1');
      assert.equal(pendingExam.loadConflictArchive('u-a', 's2', tabId)?.answers.p1, 'A2');

      // 2. Corrupt JSON / invalid shapes / wrong map value types / key-sessionId mismatch must be preserved untouched and isolated per session.
      for (const raw of [
        '{broken',
        '[]',
        'null',
        '{"s1":null}',
        '{"s1":{"sessionId":"s1"}}',
        '{"s1":{"sessionId":"s1","answers":{"p1":{}}}}',
        '{"s1":{"sessionId":"s1","answers":{"p1":"ok"},"isReasonNotApplicable":{"p1":"yes"}}}',
        '{"s1":{"sessionId":"other","answers":{"p1":"ok"}}}',
      ]) {
        const corruptMem = memoryStorage();
        global.window = { localStorage: corruptMem, sessionStorage: memoryStorage() };
        global.localStorage = corruptMem;
        pendingExam.savePendingExamAnswers('u-c', makeSess('s1', 'A1'), 1, tabId);
        pendingExam.saveConflictArchive('u-c', makeArch('s1', 'A1'));
        const pKey = [...corruptMem.data.keys()].find((k) => k.includes('pending_exam_answers_v2__s1'));
        const aKey = [...corruptMem.data.keys()].find((k) => k.includes('conflict_archives_v2__s1'));
        corruptMem.data.set(pKey, raw);
        corruptMem.data.set(aKey, raw);

        // Corrupt s1 must stay untouched and fail closed on load/clear, while isolated s2 still works.
        assert.equal(pendingExam.clearPendingExamAnswers('u-c', 's1', tabId), false);
        assert.equal(pendingExam.clearConflictArchive('u-c', 's1'), false);
        assert.equal(corruptMem.data.get(pKey), raw);
        assert.equal(corruptMem.data.get(aKey), raw);
        assert.equal(pendingExam.loadPendingExamAnswersResult('u-c', 's1', tabId).ok, false);
        assert.equal(pendingExam.loadConflictArchiveResult('u-c', 's1').ok, false);
        assert.equal(pendingExam.savePendingExamAnswers('u-c', makeSess('s2', 'A2'), 1, tabId), true);
        assert.equal(pendingExam.saveConflictArchive('u-c', makeArch('s2', 'A2')).ok, true);
      }

      // 3. Deletion removeItem/setItem failure AND read-back verification failure must return false.
      const failMem = memoryStorage();
      global.window = { localStorage: failMem, sessionStorage: memoryStorage() };
      global.localStorage = failMem;
      pendingExam.savePendingExamAnswers('u-d', makeSess('s1', 'A1'), 1, tabId);
      pendingExam.saveConflictArchive('u-d', makeArch('s1', 'A1'));
      const fSet = failMem.setItem;
      const fRemove = failMem.removeItem;
      failMem.setItem = () => { throw new Error('quota'); };
      failMem.removeItem = () => { throw new Error('readonly'); };
      assert.equal(pendingExam.clearPendingExamAnswers('u-d', 's1', tabId), false);
      assert.equal(pendingExam.clearConflictArchive('u-d', 's1'), false);
      failMem.setItem = fSet;
      failMem.removeItem = fRemove;
      assert.ok(pendingExam.loadPendingExamAnswers('u-d', 's1', tabId));
      assert.ok(pendingExam.loadConflictArchive('u-d', 's1'));

      // Read-back failure right after removeItem during clear:
      const fGet = failMem.getItem;
      let removed = false;
      failMem.removeItem = (k) => { removed = true; return fRemove(k); };
      failMem.getItem = (k) => {
        if (removed) throw new Error('read-back failed');
        return fGet(k);
      };
      assert.equal(pendingExam.clearPendingExamAnswers('u-d', 's1', tabId), false);
      removed = false;
      assert.equal(pendingExam.clearConflictArchive('u-d', 's1'), false);
      failMem.getItem = fGet;
      failMem.removeItem = fRemove;
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('reconcile adoption guard, exists+reload failure, and retry action tracking prevent false success', () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;

      const sess = {
        id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'graded', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: 'A1' }, evaluations: { p1: { calculatedScore: 90 } },
      };

      // 1. Pending read failure blocks server snapshot adoption (0 writes).
      pendingExam.savePendingExamAnswers('u-r', { ...sess, status: 'in_progress' }, 1);
      const origGet = mem.getItem;
      mem.getItem = () => { throw new Error('blocked'); };
      const pendingRead = pendingExam.loadPendingExamAnswersResult('u-r', 's1');
      assert.equal(pendingRead.ok, false);
      const adoption = mockExamSync.decideServerSnapshotAdoption(pendingRead);
      assert.equal(adoption.adopt, false);
      mem.getItem = origGet;

      // 2. Archive exists followed by reload read failure is surfaced as ok:false (never null).
      pendingExam.saveConflictArchive('u-r', {
        sessionId: 's1', answers: { p1: 'A1' }, baseVersion: 1, comparedServerVersion: 2, savedAt: 't1',
      });
      const dup = pendingExam.saveConflictArchive('u-r', {
        sessionId: 's1', answers: { p1: 'B1' }, baseVersion: 1, comparedServerVersion: 2, savedAt: 't2',
      });
      assert.deepEqual(dup, { ok: false, reason: 'exists' });
      mem.getItem = () => { throw new Error('reload failed'); };
      assert.equal(pendingExam.loadConflictArchiveResult('u-r', 's1').ok, false);
      mem.getItem = origGet;

      // 3. Retry action tracking never substitutes grading for failed record_attempts or failed submit.
      assert.equal(
        mockExamSync.resolveExamSaveRetry({ kind: 'record_attempts' }, sess)?.kind,
        'record_attempts'
      );
      const submittedWithEval = { ...sess, status: 'submitted' };
      const submitRetry = mockExamSync.resolveExamSaveRetry(
        { kind: 'submit', session: submittedWithEval },
        submittedWithEval
      );
      assert.equal(submitRetry?.kind, 'submit');
      assert.equal(
        mockExamSync.resolveExamSaveRetry({ kind: 'grading', status: 'graded' }, sess)?.kind,
        'grading'
      );
      assert.equal(
        mockExamSync.resolveExamSaveRetry({ kind: 'autosave' }, { ...sess, status: 'in_progress' })?.kind,
        'autosave'
      );
      assert.equal(mockExamSync.resolveExamSaveRetry(null, sess), null);
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('executeResolveFromServer blocks stale cross-account/session responses and preserves in-memory edits on storage recovery', async () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;

      const localSess = {
        id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: 'local-in-memory-edit' }, evaluations: {},
      };
      const serverSess = { ...localSess, answers: { p1: 'server-old' } };

      // 1. Account switch mid-flight during fetchServer: 0 cache/state mutations!
      let activeUser = 'user-A';
      let activeSessionId = 's1';
      let modalOpen = true;
      let snapshotsApplied = 0;
      let serverVersion = 1;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => localSess,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 1,
        getCurrentRequestGen: () => 1,
        isStillValid: () => modalOpen && activeUser === 'user-A' && activeSessionId === 's1',
        fetchServer: async () => {
          activeUser = 'user-B';
          return { ok: true, session: serverSess, version: 5 };
        },
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => {},
        applySnapshot: () => { snapshotsApplied++; },
        setServerVersion: (v) => { serverVersion = v; },
        setSyncBlocked: () => {},
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });
      assert.equal(snapshotsApplied, 0);
      assert.equal(serverVersion, 1);

      // 2. Pending read failure blocks adoption (0 snapshotsApplied, flushes autosave timer).
      activeUser = 'user-A';
      let flushed = 0;
      let blocked = false;
      let readFailed = false;
      const origGet = mem.getItem;
      mem.getItem = () => { throw new Error('storage locked'); };
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => localSess,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 2,
        getCurrentRequestGen: () => 2,
        isStillValid: () => true,
        fetchServer: async () => ({ ok: true, session: serverSess, version: 5 }),
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => { flushed++; },
        applySnapshot: () => { snapshotsApplied++; },
        setServerVersion: (v) => { serverVersion = v; },
        setSyncBlocked: (b) => { blocked = b; },
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: (f) => { readFailed = f; },
        setSyncNotice: () => {},
      });
      assert.equal(snapshotsApplied, 0);
      assert.equal(serverVersion, 1);
      assert.ok(flushed >= 1);
      assert.equal(blocked, true);
      assert.equal(readFailed, true);

      // 3. Storage recovers: in-memory edit is saved into pending BEFORE applySnapshot(server).
      mem.getItem = origGet;
      const order = [];
      let adoptedSession = null;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => localSess,
        userId: 'user-A',
        hadPendingReadFailure: true,
        requestGen: 3,
        getCurrentRequestGen: () => 3,
        isStillValid: () => true,
        fetchServer: async () => ({ ok: true, session: serverSess, version: 5 }),
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: (uid, s, ver) => {
          order.push('savePending');
          return pendingExam.savePendingExamAnswers(uid, s, ver);
        },
        flushAutosaveTimer: () => {},
        applySnapshot: (s) => {
          order.push('applySnapshot');
          adoptedSession = s;
        },
        setServerVersion: (v) => { serverVersion = v; },
        setSyncBlocked: (b) => { blocked = b; },
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: (f) => { readFailed = f; },
        setSyncNotice: () => {},
      });
      assert.deepEqual(order, ['savePending', 'applySnapshot']);
      assert.equal(adoptedSession?.answers.p1, 'server-old');
      assert.equal(pendingExam.loadPendingExamAnswers('user-A', 's1')?.answers.p1, 'local-in-memory-edit');
      assert.equal(blocked, true);
      assert.equal(readFailed, false);
      assert.equal(serverVersion, 5);
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('executeResolveFromServer preserves L2 typed during await fetchServer, drops out-of-order refresh, and skips fetchServer when invalid', async () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;

      let currentLocal = {
        id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: 'L1' }, evaluations: {},
      };
      const serverSess = { ...currentLocal, answers: { p1: 'server-old' } };

      // 1. Invalid scope before start => 0 server calls, 0 state changes.
      let fetchCalls = 0;
      let stateMutated = 0;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 1,
        getCurrentRequestGen: () => 1,
        isStillValid: () => false,
        fetchServer: async () => { fetchCalls++; return { ok: true, session: serverSess, version: 9 }; },
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => { stateMutated++; },
        applySnapshot: () => { stateMutated++; },
        setServerVersion: () => { stateMutated++; },
        setSyncBlocked: () => { stateMutated++; },
        setSaveState: () => { stateMutated++; },
        setFailedSaveOp: () => { stateMutated++; },
        setPendingAvailable: () => { stateMutated++; },
        setPendingReadFailed: () => { stateMutated++; },
        setSyncNotice: () => { stateMutated++; },
      });
      assert.equal(fetchCalls, 0);
      assert.equal(stateMutated, 0);

      // 2. L2 typed during await fetchServer is read via getCurrentLocal() and preserved!
      let adopted = null;
      let serverVer = 1;
      let blocked = false;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        userId: 'user-A',
        hadPendingReadFailure: true,
        requestGen: 1,
        getCurrentRequestGen: () => 1,
        isStillValid: () => true,
        fetchServer: async () => {
          currentLocal = { ...currentLocal, answers: { p1: 'L2-typed-during-fetch' } };
          return { ok: true, session: serverSess, version: 5 };
        },
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => {},
        applySnapshot: (s) => { adopted = s; },
        setServerVersion: (v) => { serverVer = v; },
        setSyncBlocked: (b) => { blocked = b; },
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });
      assert.equal(adopted?.answers.p1, 'server-old');
      assert.equal(pendingExam.loadPendingExamAnswers('user-A', 's1')?.answers.p1, 'L2-typed-during-fetch');
      assert.equal(serverVer, 5);
      assert.equal(blocked, true);

      // 3. Overlapping refresh: older requestGen=1 resolves AFTER newer requestGen=2 => ignored!
      let activeGen = 1;
      let resolveReq1;
      const req1Promise = new Promise((res) => { resolveReq1 = res; });
      const p1 = mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 1,
        getCurrentRequestGen: () => activeGen,
        isStillValid: () => true,
        fetchServer: () => req1Promise,
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => {},
        applySnapshot: (s) => { adopted = s; },
        setServerVersion: (v) => { serverVer = v; },
        setSyncBlocked: () => {},
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });
      activeGen = 2;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 2,
        getCurrentRequestGen: () => activeGen,
        isStillValid: () => true,
        fetchServer: async () => ({ ok: true, session: { ...serverSess, answers: { p1: 'server-v8' } }, version: 8 }),
        readPending: pendingExam.loadPendingExamAnswersResult,
        savePending: pendingExam.savePendingExamAnswers,
        flushAutosaveTimer: () => {},
        applySnapshot: (s) => { adopted = s; },
        setServerVersion: (v) => { serverVer = v; },
        setSyncBlocked: () => {},
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: () => {},
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });
      assert.equal(serverVer, 8);
      resolveReq1({ ok: true, session: { ...serverSess, answers: { p1: 'server-stale-v4' } }, version: 4 });
      await p1;
      // Older response must NOT revert serverVer from 8 back to 4 or overwrite adopted.
      assert.equal(serverVer, 8);
      assert.equal(adopted?.answers.p1, 'server-v8');
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('finalizeRecordedExamOnServer awaits server confirmation before recorded transition, archive clear, and close', async () => {
    const recordedSess = {
      id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
      status: 'recorded', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
      problems: [], answers: { p1: 'A1' }, evaluations: { p1: { calculatedScore: 95 } },
      recordedAttemptIds: ['att-exam-s1-p1'],
    };

    // 1. Server error keeps local state un-recorded, archive intact, and modal open.
    const events1 = [];
    let failedOp = null;
    let saveState = 'idle';
    const ok1 = await mockExamSync.finalizeRecordedExamOnServer({
      recordedSession: recordedSess,
      getExpectedVersion: () => 3,
      isStillValid: () => true,
      saveGradingServer: async () => { events1.push('server'); return { ok: false, code: 'error' }; },
      applyRecordedLocal: () => { events1.push('local'); },
      setServerVersion: () => {},
      setSyncBlocked: () => {},
      setSaveState: (s) => { saveState = s; },
      setSaveMessage: () => {},
      setFailedSaveOp: (op) => { failedOp = op; },
      setError: () => {},
      setSyncNotice: () => {},
      clearArchiveAfterConfirm: () => { events1.push('clearArchive'); return true; },
      onExamRecorded: () => { events1.push('onExamRecorded'); },
    });
    assert.equal(ok1, false);
    assert.deepEqual(events1, ['server']);
    assert.equal(saveState, 'error');
    assert.equal(failedOp?.kind, 'record_finalize');

    // 2. Retry succeeds: exact order server -> local -> clearArchive -> onExamRecorded.
    const events2 = [];
    const ok2 = await mockExamSync.finalizeRecordedExamOnServer({
      recordedSession: recordedSess,
      getExpectedVersion: () => 3,
      isStillValid: () => true,
      saveGradingServer: async () => { events2.push('server'); return { ok: true, version: 4 }; },
      applyRecordedLocal: () => { events2.push('local'); },
      setServerVersion: () => {},
      setSyncBlocked: () => {},
      setSaveState: (s) => { saveState = s; },
      setSaveMessage: () => {},
      setFailedSaveOp: (op) => { failedOp = op; },
      setError: () => {},
      setSyncNotice: () => {},
      clearArchiveAfterConfirm: () => { events2.push('clearArchive'); return true; },
      onExamRecorded: () => { events2.push('onExamRecorded'); },
    });
    assert.equal(ok2, true);
    assert.deepEqual(events2, ['server', 'local', 'clearArchive', 'onExamRecorded']);
    assert.equal(saveState, 'saved');
    assert.equal(failedOp, null);

    // 3. Archive cleanup failure keeps modal open (onExamRecorded NOT called).
    const events3 = [];
    await mockExamSync.finalizeRecordedExamOnServer({
      recordedSession: recordedSess,
      getExpectedVersion: () => 4,
      isStillValid: () => true,
      saveGradingServer: async () => { events3.push('server'); return { ok: true, version: 5 }; },
      applyRecordedLocal: () => { events3.push('local'); },
      setServerVersion: () => {},
      setSyncBlocked: () => {},
      setSaveState: (s) => { saveState = s; },
      setSaveMessage: () => {},
      setFailedSaveOp: () => {},
      setError: () => {},
      setSyncNotice: () => {},
      clearArchiveAfterConfirm: () => { events3.push('clearArchive'); return false; },
      onExamRecorded: () => { events3.push('onExamRecorded'); },
    });
    assert.deepEqual(events3, ['server', 'local', 'clearArchive']);

    // 4. not_configured preserves local-only policy without claiming 'saved'.
    const events4 = [];
    await mockExamSync.finalizeRecordedExamOnServer({
      recordedSession: recordedSess,
      getExpectedVersion: () => 5,
      isStillValid: () => true,
      saveGradingServer: async () => { events4.push('server'); return { ok: false, code: 'not_configured' }; },
      applyRecordedLocal: () => { events4.push('local'); },
      setServerVersion: () => {},
      setSyncBlocked: () => {},
      setSaveState: (s) => { saveState = s; },
      setSaveMessage: () => {},
      setFailedSaveOp: () => {},
      setError: () => {},
      setSyncNotice: () => {},
      clearArchiveAfterConfirm: () => { events4.push('clearArchive'); return true; },
      onExamRecorded: () => { events4.push('onExamRecorded'); },
    });
    assert.deepEqual(events4, ['server', 'local', 'clearArchive', 'onExamRecorded']);
    assert.equal(saveState, 'idle');

    // 5. Invalid scope before start => 0 server calls, 0 local/UI mutations.
    const events5 = [];
    const ok5 = await mockExamSync.finalizeRecordedExamOnServer({
      recordedSession: recordedSess,
      getExpectedVersion: () => 5,
      isStillValid: () => false,
      saveGradingServer: async () => { events5.push('server'); return { ok: true, version: 6 }; },
      applyRecordedLocal: () => { events5.push('local'); },
      setServerVersion: () => { events5.push('ver'); },
      setSyncBlocked: () => { events5.push('blk'); },
      setSaveState: () => { events5.push('st'); },
      setSaveMessage: () => {},
      setFailedSaveOp: () => {},
      setError: () => {},
      setSyncNotice: () => {},
      clearArchiveAfterConfirm: () => { events5.push('clearArchive'); return true; },
      onExamRecorded: () => { events5.push('onExamRecorded'); },
    });
    assert.equal(ok5, false);
    assert.deepEqual(events5, []);
  });

  await check('queued grading 3->4 then serialized finalizeRecorded reads expectedVersion=4->5 without stale conflict, plus double-click guard', async () => {
    const recordedSess = {
      id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
      status: 'recorded', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
      problems: [], answers: { p1: 'A1' }, evaluations: { p1: { calculatedScore: 95 } },
      recordedAttemptIds: ['att-exam-s1-p1'],
    };

    let serverVersion = 3;
    let chain = Promise.resolve();
    const enqueue = (task) => {
      const next = chain.then(task, task);
      chain = next.then(() => undefined, () => undefined);
      return next;
    };

    let gradingCalls = 0;
    let finalizeCalls = 0;
    const seenExpectedVersions = [];
    const events = [];

    // Queue grading save 3 -> 4
    const pGrading = enqueue(async () => {
      gradingCalls++;
      await new Promise((r) => setTimeout(r, 10));
      serverVersion = 4;
      events.push('grading:3->4');
    });

    // Concurrently user clicks finalize twice (double-click guard)
    let finalizing = false;
    const triggerFinalize = async () => {
      if (finalizing) return false;
      finalizing = true;
      try {
        return await enqueue(() => mockExamSync.finalizeRecordedExamOnServer({
          recordedSession: recordedSess,
          getExpectedVersion: () => serverVersion,
          isStillValid: () => true,
          saveGradingServer: async (_sess, expectedVer) => {
            finalizeCalls++;
            seenExpectedVersions.push(expectedVer);
            if (expectedVer !== serverVersion) return { ok: false, code: 'stale' };
            serverVersion = expectedVer + 1;
            events.push(`server:${expectedVer}->${serverVersion}`);
            return { ok: true, version: serverVersion };
          },
          applyRecordedLocal: () => { events.push('local'); },
          setServerVersion: (v) => { serverVersion = v; },
          setSyncBlocked: () => {},
          setSaveState: () => {},
          setSaveMessage: () => {},
          setFailedSaveOp: () => {},
          setError: () => {},
          setSyncNotice: () => {},
          clearArchiveAfterConfirm: () => { events.push('clearArchive'); return true; },
          onExamRecorded: () => { events.push('onExamRecorded'); },
        }));
      } finally {
        finalizing = false;
      }
    };

    const [, r1, r2] = await Promise.all([pGrading, triggerFinalize(), triggerFinalize()]);
    assert.equal(r1, true);
    assert.equal(r2, false);
    assert.equal(gradingCalls, 1);
    assert.equal(finalizeCalls, 1);
    assert.deepEqual(seenExpectedVersions, [4]);
    assert.deepEqual(events, ['grading:3->4', 'server:4->5', 'local', 'clearArchive', 'onExamRecorded']);
    assert.equal(serverVersion, 5);
  });

  await check('pendingExamAnswers v2 isolates per-session and per-tab keys, forks on duplicate tab, and migrates legacy v1 safely', async () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      const sStore = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: sStore };
      global.localStorage = mem;

      const makeSess = (id, ans) => ({
        id, subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: ans }, evaluations: {},
      });

      // 1. Per-session and per-tab isolation
      assert.equal(pendingExam.savePendingExamAnswers('u1', makeSess('s1', 'tabA-s1'), 1, 'tab-A'), true);
      assert.equal(pendingExam.savePendingExamAnswers('u1', makeSess('s1', 'tabB-s1'), 1, 'tab-B'), true);
      assert.equal(pendingExam.savePendingExamAnswers('u1', makeSess('s2', 'tabA-s2'), 1, 'tab-A'), true);

      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's1', 'tab-A')?.answers.p1, 'tabA-s1');
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's1', 'tab-B')?.answers.p1, 'tabB-s1');
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's2', 'tab-A')?.answers.p1, 'tabA-s2');

      const othersForA = pendingExam.listOtherTabPendingExamAnswers('u1', 's1', 'tab-A');
      assert.equal(othersForA.ok, true);
      assert.equal(othersForA.value.length, 1);
      assert.equal(othersForA.value[0].answers.p1, 'tabB-s1');

      // Clearing tab-A on s1 leaves tab-B on s1 and tab-A on s2 untouched
      assert.equal(pendingExam.clearPendingExamAnswers('u1', 's1', 'tab-A'), true);
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's1', 'tab-A'), null);
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's1', 'tab-B')?.answers.p1, 'tabB-s1');
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's2', 'tab-A')?.answers.p1, 'tabA-s2');

      // 2. Tab lease fork on duplicated sessionStorage
      const tab1 = pendingExam.resolveExamTabId();
      assert.ok(tab1);
      practice.resetPracticeTabPageForTests();
      // While tab1 lease is fresh in localStorage, a duplicated sessionStorage forks a new tabId
      const tab2 = pendingExam.resolveExamTabId();
      assert.ok(tab2);
      assert.notEqual(tab2, tab1);

      // Pre-existing newer v2 for s4 (without migration marker, e.g. written before legacy migration ran)
      assert.equal(
        pendingExam.savePendingExamAnswers('u1', makeSess('s4', 'newer-v2-s4'), 3, 'tab-A'),
        true
      );
      mem.removeItem('redcall_user_u1__pending_exam_migrated_v2__s4');
      const v1Key = 'redcall_user_u1__pending_exam_answers_v1';
      mem.setItem(v1Key, JSON.stringify({
        s3: { sessionId: 's3', answers: { p1: 'legacy-s3' }, baseVersion: 2, savedAt: '2026-01-01T00:00:00.000Z' },
        s4: { sessionId: 's4', answers: { p1: 'legacy-s4-old' }, baseVersion: 1, savedAt: '2026-01-01T00:00:00.000Z' },
      }));

      // Simulate partial failure when writing migration marker for s3
      const origSetItem = mem.setItem;
      let failMarkerOnce = true;
      mem.setItem = (k, v) => {
        if (failMarkerOnce && k.includes('pending_exam_migrated_v2__s3')) {
          failMarkerOnce = false;
          throw new Error('quota');
        }
        return origSetItem(k, v);
      };
      const firstRead = pendingExam.loadPendingExamAnswersResult('u1', 's3', 'tab-A');
      // Marker write failure fails closed without claiming verified migration, while v1 remains intact.
      assert.equal(firstRead.ok, false);
      assert.ok(mem.getItem(v1Key));

      // Retry without failure completes migration & writes verified marker
      mem.setItem = origSetItem;
      const secondRead = pendingExam.loadPendingExamAnswersResult('u1', 's3', 'tab-A');
      assert.equal(secondRead.ok, true);
      assert.equal(secondRead.value?.answers.p1, 'legacy-s3');
      assert.ok(mem.getItem('redcall_user_u1__pending_exam_migrated_v2__s3'));

      // Clearing migrated s3 sets cleared tombstone and does NOT resurrect from v1
      assert.equal(pendingExam.clearPendingExamAnswers('u1', 's3', 'tab-A'), true);
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's3', 'tab-A'), null);
      assert.ok(mem.getItem(v1Key));

      // Newer v2 for s4 wins over older v1, and older v1 is preserved in legacy-backup
      const s4Read = pendingExam.loadPendingExamAnswers('u1', 's4', 'tab-A');
      assert.equal(s4Read?.answers.p1, 'newer-v2-s4');
      assert.equal(
        pendingExam.loadPendingExamAnswers('u1', 's4', 'legacy-backup')?.answers.p1,
        'legacy-s4-old'
      );
    } finally {
      practice.resetPracticeTabPageForTests();
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('executeResolveFromServer with hadPendingReadFailure=false preserves L2 typed during fetchServer, blocks queued/timer S overwrite, and does not misclassify old cache', async () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;

      // 1. Untouched old server cache (hadPendingReadFailure=false, inputGen unchanged, pending=null)
      // must NOT be falsely marked as unsaved/blocked when newer server S arrives.
      let currentLocal = {
        id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: 'old-server-cache' }, evaluations: {},
      };
      const serverS = { ...currentLocal, answers: { p1: 'server-S' } };
      let inputGen = 0;
      let syncBlocked = false;
      let pendingAvailable = false;
      let serverVer = 1;
      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        getInputGen: () => inputGen,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 1,
        getCurrentRequestGen: () => 1,
        isStillValid: () => true,
        fetchServer: async () => ({ ok: true, session: serverS, version: 5 }),
        readPending: (uid, sid) => pendingExam.loadPendingExamAnswersResult(uid, sid, 'tab-A'),
        savePending: (uid, s, ver) => pendingExam.savePendingExamAnswers(uid, s, ver, 'tab-A'),
        flushAutosaveTimer: () => {},
        applySnapshot: (s) => { currentLocal = s; },
        setServerVersion: (v) => { serverVer = v; },
        setSyncBlocked: (b) => { syncBlocked = b; },
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: (a) => { pendingAvailable = a; },
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });
      assert.equal(currentLocal.answers.p1, 'server-S');
      assert.equal(syncBlocked, false);
      assert.equal(pendingAvailable, false);
      assert.equal(serverVer, 5);

      // 2. hadPendingReadFailure=false + user types L2 during await fetchServer + 800ms autosave timer scheduled:
      // executeResolveFromServer must flush timer, block sync so S is NOT saved back over L2, and keep L2 in pending!
      let scheduledTimerFn = null;
      let timerCancelled = false;
      let serverSaves = 0;
      const runScheduledAutosaveIfAny = () => {
        if (!scheduledTimerFn || syncBlocked) return;
        // Simulate runAutosave reading sessionRef.current (= serverS) and clearing pending if allowed!
        serverSaves++;
        if (pendingExam.pendingAfterAutosave(currentLocal, currentLocal) === 'clear') {
          pendingExam.clearPendingExamAnswers('user-A', 's1', 'tab-A');
        }
      };

      await mockExamSync.executeResolveFromServer({
        sessionId: 's1',
        getCurrentLocal: () => currentLocal,
        getInputGen: () => inputGen,
        userId: 'user-A',
        hadPendingReadFailure: false,
        requestGen: 2,
        getCurrentRequestGen: () => 2,
        isStillValid: () => true,
        fetchServer: async () => {
          // User types L2 while refresh is in flight: save(L2) stores L2 in pending and schedules 800ms timer.
          inputGen += 1;
          currentLocal = { ...currentLocal, answers: { p1: 'L2-typed-while-normal-storage' } };
          pendingExam.savePendingExamAnswers('user-A', currentLocal, serverVer, 'tab-A');
          timerCancelled = false;
          scheduledTimerFn = runScheduledAutosaveIfAny;
          return { ok: true, session: serverS, version: 6 };
        },
        readPending: (uid, sid) => pendingExam.loadPendingExamAnswersResult(uid, sid, 'tab-A'),
        savePending: (uid, s, ver) => pendingExam.savePendingExamAnswers(uid, s, ver, 'tab-A'),
        flushAutosaveTimer: () => {
          if (scheduledTimerFn) {
            scheduledTimerFn = null;
            timerCancelled = true;
          }
        },
        applySnapshot: (s) => { currentLocal = s; },
        setServerVersion: (v) => { serverVer = v; },
        setSyncBlocked: (b) => { syncBlocked = b; },
        setSaveState: () => {},
        setFailedSaveOp: () => {},
        setPendingAvailable: (a) => { pendingAvailable = a; },
        setPendingReadFailed: () => {},
        setSyncNotice: () => {},
      });

      // Even if a queued autosave callback attempts to run afterward, syncBlocked prevents it!
      runScheduledAutosaveIfAny();
      assert.equal(timerCancelled, true);
      assert.equal(syncBlocked, true);
      assert.equal(pendingAvailable, true);
      assert.equal(serverSaves, 0);
      assert.equal(currentLocal.answers.p1, 'server-S');
      assert.equal(
        pendingExam.loadPendingExamAnswers('user-A', 's1', 'tab-A')?.answers.p1,
        'L2-typed-while-normal-storage'
      );
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('conflict archive v2 isolates per-tab keys across sequential tab writes, preserves B when A clears, keeps B on A-exists conflict, and migrates v1/session-only v2', () => {
    const prevWindow = global.window;
    const prevLocalStorage = global.localStorage;
    try {
      const mem = memoryStorage();
      global.window = { localStorage: mem, sessionStorage: memoryStorage() };
      global.localStorage = mem;

      const archA = {
        sessionId: 's1', answers: { p1: 'arch-A' }, reasons: { p1: 'rA' },
        isReasonNotApplicable: {}, reasonNotApplicableJustification: {},
        baseVersion: 1, comparedServerVersion: 2, savedAt: '2026-01-01T00:00:01Z',
      };
      const archB = {
        sessionId: 's1', answers: { p1: 'arch-B' }, reasons: { p1: 'rB' },
        isReasonNotApplicable: {}, reasonNotApplicableJustification: {},
        baseVersion: 1, comparedServerVersion: 3, savedAt: '2026-01-01T00:00:02Z',
      };

      // 1. Sequential tab-A and tab-B writes on a shared storage adapter use distinct
      // per-tab keys without overwriting each other (single-process mock check).
      const origGet = mem.getItem;
      const origSet = mem.setItem;
      const observedArchiveWrites = [];
      mem.setItem = (k, v) => {
        if (k.includes('mock_exam_conflict_archives_v2__s1')) observedArchiveWrites.push(k);
        return origSet(k, v);
      };
      assert.deepEqual(pendingExam.saveConflictArchive('u1', archA, 'tab-A'), { ok: true });
      assert.deepEqual(pendingExam.saveConflictArchive('u1', archB, 'tab-B'), { ok: true });
      assert.equal(observedArchiveWrites.length, 2);
      assert.notEqual(observedArchiveWrites[0], observedArchiveWrites[1]);
      mem.getItem = origGet;
      mem.setItem = origSet;

      assert.equal(pendingExam.loadConflictArchive('u1', 's1', 'tab-A')?.answers.p1, 'arch-A');
      assert.equal(pendingExam.loadConflictArchive('u1', 's1', 'tab-B')?.answers.p1, 'arch-B');

      // 2. Clearing tab-A archive leaves tab-B archive intact and discoverable via listOtherTabConflictArchives
      assert.equal(pendingExam.clearConflictArchive('u1', 's1', 'tab-A'), true);
      assert.equal(pendingExam.loadConflictArchive('u1', 's1', 'tab-A'), null);
      assert.equal(pendingExam.loadConflictArchive('u1', 's1', 'tab-B')?.answers.p1, 'arch-B');
      const othersForA = pendingExam.listOtherTabConflictArchives('u1', 's1', 'tab-A');
      assert.equal(othersForA.ok, true);
      assert.equal(othersForA.value.length, 1);
      assert.equal(othersForA.value[0].answers.p1, 'arch-B');

      // 3. Existing archive A on tab-A + newer conflicting local B:
      // saveConflictArchive returns 'exists' without overwriting A, and saveImmutableConflictArchive preserves B!
      assert.deepEqual(pendingExam.saveConflictArchive('u1', archA, 'tab-A'), { ok: true });
      const secondSave = pendingExam.saveConflictArchive('u1', archB, 'tab-A');
      assert.deepEqual(secondSave, { ok: false, reason: 'exists' });
      assert.equal(pendingExam.loadConflictArchive('u1', 's1', 'tab-A')?.answers.p1, 'arch-A');

      assert.deepEqual(pendingExam.saveImmutableConflictArchive('u1', archB, 'tab-A'), { ok: true });
      const allOthersAfterImmutable = pendingExam.listOtherTabConflictArchives('u1', 's1', 'tab-A');
      assert.equal(allOthersAfterImmutable.ok, true);
      assert.ok(allOthersAfterImmutable.value.some((entry) => entry.answers.p1 === 'arch-B' && entry.archiveId));

      // 4. Migration of legacy v1 AND session-only v2 (from earlier step) without destroying originals
      const legacyV1Key = 'redcall_user_u1__mock_exam_conflict_archives_v1';
      const sessionOnlyV2Key = 'redcall_user_u1__mock_exam_conflict_archives_v2__s2';
      mem.setItem(legacyV1Key, JSON.stringify({
        s3: { ...archA, sessionId: 's3', answers: { p1: 'v1-s3' } },
      }));
      mem.setItem(sessionOnlyV2Key, JSON.stringify({
        ...archB, sessionId: 's2', answers: { p1: 'session-only-s2' },
      }));
      assert.equal(pendingExam.loadConflictArchive('u1', 's3', 'tab-A')?.answers.p1, 'v1-s3');
      assert.equal(pendingExam.loadConflictArchive('u1', 's2', 'tab-A')?.answers.p1, 'session-only-s2');
      assert.ok(mem.getItem(legacyV1Key));
      assert.ok(mem.getItem(sessionOnlyV2Key));

      // Clearing migrated s3 sets tombstone so it never resurrects from v1
      assert.equal(pendingExam.clearConflictArchive('u1', 's3', 'tab-A'), true);
      assert.equal(pendingExam.loadConflictArchive('u1', 's3', 'tab-A'), null);

      // 5. Old session-only marker (`mock_exam_conflict_archives_migrated_v2__s5=1`) +
      // session-only v2 archive present + no per-tab key yet: must migrate into per-tab!
      mem.setItem('redcall_user_u1__mock_exam_conflict_archives_migrated_v2__s5', '1');
      mem.setItem('redcall_user_u1__mock_exam_conflict_archives_v2__s5', JSON.stringify({
        ...archA, sessionId: 's5', answers: { p1: 'session-only-s5' },
      }));
      const s5Res = pendingExam.loadConflictArchiveResult('u1', 's5', 'tab-A');
      assert.equal(s5Res.ok, true);
      assert.equal(s5Res.value?.answers.p1, 'session-only-s5');
      const s5Others = pendingExam.listOtherTabConflictArchives('u1', 's5', 'tab-B');
      assert.equal(s5Others.ok, true);
      assert.ok(s5Others.value.some((e) => e.answers.p1 === 'session-only-s5'));
      assert.equal(mem.getItem('redcall_user_u1__mock_exam_conflict_archives_migrated_v2_tabs__s5'), '1');

      // Cleared tombstone from earlier phase prevents resurrection even under the new marker
      mem.setItem('redcall_user_u1__mock_exam_conflict_archives_cleared_v2__s6', '1');
      mem.setItem('redcall_user_u1__mock_exam_conflict_archives_v2__s6', JSON.stringify({
        ...archA, sessionId: 's6', answers: { p1: 'cleared-s6' },
      }));
      assert.equal(pendingExam.loadConflictArchive('u1', 's6', 'tab-A'), null);

      // 6. All sources differ (current tab-A, existing legacy-backup, session-only v2, legacy v1) +
      // backup write failure retry: must preserve all distinct sources & never set marker before verify!
      assert.deepEqual(
        pendingExam.saveConflictArchive('u1', { ...archA, sessionId: 's7', answers: { p1: 'current-tabA' } }, 'tab-A'),
        { ok: true }
      );
      assert.deepEqual(
        pendingExam.saveConflictArchive('u1', { ...archA, sessionId: 's7', answers: { p1: 'existing-backup' } }, 'legacy-backup'),
        { ok: true }
      );
      mem.removeItem('redcall_user_u1__mock_exam_conflict_archives_migrated_v2_tabs__s7');
      mem.setItem('redcall_user_u1__mock_exam_conflict_archives_v2__s7', JSON.stringify({
        ...archA, sessionId: 's7', answers: { p1: 'session-only-s7' },
      }));
      mem.setItem(legacyV1Key, JSON.stringify({
        s7: { ...archA, sessionId: 's7', answers: { p1: 'legacy-v1-s7' } },
      }));

      // Fail backup write once -> migration fails closed and does NOT set marker!
      let failBackupWriteOnce = true;
      mem.setItem = (k, v) => {
        if (failBackupWriteOnce && k.includes('legacy-backup-session-v2')) {
          failBackupWriteOnce = false;
          throw new Error('quota');
        }
        return origSet(k, v);
      };
      const failMig = pendingExam.loadConflictArchiveResult('u1', 's7', 'tab-A');
      assert.equal(failMig.ok, false);
      assert.equal(mem.getItem('redcall_user_u1__mock_exam_conflict_archives_migrated_v2_tabs__s7'), null);

      // Retry without failure -> all 4 distinct copies exist & marker is written!
      mem.setItem = origSet;
      const okMig = pendingExam.loadConflictArchiveResult('u1', 's7', 'tab-A');
      assert.equal(okMig.ok, true);
      assert.equal(okMig.value?.answers.p1, 'current-tabA');
      const s7Others = pendingExam.listOtherTabConflictArchives('u1', 's7', 'tab-A');
      assert.equal(s7Others.ok, true);
      const s7Answers = s7Others.value.map((e) => e.answers.p1);
      assert.ok(s7Answers.includes('existing-backup'));
      assert.ok(s7Answers.includes('session-only-s7'));
      assert.ok(s7Answers.includes('legacy-v1-s7'));
      assert.equal(mem.getItem('redcall_user_u1__mock_exam_conflict_archives_migrated_v2_tabs__s7'), '1');

      // Same backup-collision protection for pendingExamAnswers (tab-A + legacy-backup + legacy-v1)
      const makeSess = (id, ans) => ({
        id, subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
        status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
        problems: [], answers: { p1: ans }, evaluations: {},
      });
      assert.equal(pendingExam.savePendingExamAnswers('u1', makeSess('s8', 'p-tabA'), 1, 'tab-A'), true);
      assert.equal(pendingExam.savePendingExamAnswers('u1', makeSess('s8', 'p-existing-backup'), 1, 'legacy-backup'), true);
      mem.removeItem('redcall_user_u1__pending_exam_migrated_v2__s8');
      mem.setItem('redcall_user_u1__pending_exam_answers_v1', JSON.stringify({
        s8: { sessionId: 's8', answers: { p1: 'p-legacy-v1' }, baseVersion: 1, savedAt: '2026-01-01T00:00:00Z' },
      }));
      assert.equal(pendingExam.loadPendingExamAnswers('u1', 's8', 'tab-A')?.answers.p1, 'p-tabA');
      const s8Others = pendingExam.listOtherTabPendingExamAnswers('u1', 's8', 'tab-A');
      assert.equal(s8Others.ok, true);
      const s8Answers = s8Others.value.map((e) => e.answers.p1);
      assert.ok(s8Answers.includes('p-existing-backup'));
      assert.ok(s8Answers.includes('p-legacy-v1'));
    } finally {
      global.window = prevWindow;
      global.localStorage = prevLocalStorage;
    }
  });

  await check('applyPendingAnswers preserves deletion intent, handles legacy fields, and guards session/status/evaluations', () => {
    const server = {
      id: 's1', subjectId: 'sub-1', createdAt: 't1', endsAt: 't2', durationMinutes: 60,
      status: 'in_progress', selectedConceptIds: ['c1'], selectedTypes: ['essay_descriptive'],
      problems: [{ id: 'p1', title: 'P1' }, { id: 'p2', title: 'P2' }],
      answers: { p1: 'srv1', p2: 'srv2' },
      reasons: { p1: 'srv-reason' },
      isReasonNotApplicable: { p1: true },
      reasonNotApplicableJustification: { p1: 'srv-just' },
      evaluations: { p1: { calculatedScore: 85 } },
    };

    // Explicit empty objects and omitted deleted keys must NOT resurrect server fields.
    const emptiedPending = {
      sessionId: 's1',
      answers: { p1: 'local1' },
      reasons: {},
      isReasonNotApplicable: {},
      reasonNotApplicableJustification: {},
      baseVersion: 1,
      savedAt: 't3',
    };
    const restored = pendingExam.applyPendingAnswers(server, emptiedPending);
    assert.deepEqual(restored.answers, { p1: 'local1' });
    assert.deepEqual(restored.reasons, {});
    assert.deepEqual(restored.isReasonNotApplicable, {});
    assert.deepEqual(restored.reasonNotApplicableJustification, {});
    assert.deepEqual(restored.evaluations, server.evaluations);

    // Legacy snapshot with undefined optional fields preserves server's optional fields.
    const legacyPending = {
      sessionId: 's1',
      answers: { p1: 'legacy1' },
      savedAt: 't3',
    };
    const legacyRestored = pendingExam.applyPendingAnswers(server, legacyPending);
    assert.deepEqual(legacyRestored.answers, { p1: 'legacy1' });
    assert.deepEqual(legacyRestored.reasons, { p1: 'srv-reason' });
    assert.deepEqual(legacyRestored.isReasonNotApplicable, { p1: true });
    assert.deepEqual(legacyRestored.reasonNotApplicableJustification, { p1: 'srv-just' });

    // Mismatched sessionId must be rejected without modifying the session.
    const wrongSession = pendingExam.applyPendingAnswers(server, { ...emptiedPending, sessionId: 'other' });
    assert.deepEqual(wrongSession, server);

    // Submitted / graded / recorded sessions must never be modified.
    for (const status of ['submitted', 'graded', 'recorded', 'abandoned']) {
      const locked = { ...server, status };
      assert.deepEqual(pendingExam.applyPendingAnswers(locked, emptiedPending), locked);
    }
  });

  storage.setStorageAdapterForTest(undefined);
  console.log(`${passed} recovery checks passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

