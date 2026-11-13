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
  storage.setStorageAdapterForTest(undefined);
  console.log(`${passed} recovery checks passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

