/* Regression tests for practiceAnswerDraft migration/resilience/efficiency & cloud library bounded parallel downloads. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redcall-regressions-drafts-'));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'next/headers') {
    return { cookies: async () => ({ getAll: () => [], set: () => {} }) };
  }
  if (request.startsWith('@/')) {
    return origLoad.call(this, path.join(output, request.slice(2)), parent, isMain);
  }
  return origLoad.call(this, request, parent, isMain);
};

const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/types.ts',
    'lib/mockExam.ts',
    'lib/storageScope.ts',
    'lib/auth/redirects.ts',
    'lib/practiceAnswerDraft.ts',
    'lib/cloud/types.ts',
    'lib/cloud/mappers.ts',
    'lib/cloud/library.ts',
    'lib/cloud/learningMigration.ts',
    'lib/cloud/learningPlan.ts',
    'lib/cloud/learningLibrary.ts',
    'lib/cloud/learningRepository.ts',
    'lib/cloud/learningOriginals.ts',
    'components/ProblemSessionModal.tsx',
    '--jsx',
    'react-jsx',
    '--rootDir',
    root,
    '--outDir',
    output,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--moduleResolution',
    'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
  ],
  { cwd: root, encoding: 'utf8' }
);
if (compile.status !== 0) {
  throw new Error(compile.stdout + compile.stderr);
}

spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'app/api/persist-drafts/route.ts',
    'app/api/drive/upload/route.ts',
    'lib/drive/googleDrive.ts',
    'lib/materialPolicy.ts',
    'lib/auth/apiAuth.ts',
    'lib/supabase/server.ts',
    '--rootDir',
    root,
    '--outDir',
    output,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--moduleResolution',
    'node',
    '--esModuleInterop',
    '--skipLibCheck',
  ],
  { cwd: root, encoding: 'utf8' }
);

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  let getItemCalls = 0;
  let throwOnGetItem = null;
  let throwOnRemoveItem = null;

  const storage = {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(k) {
      getItemCalls++;
      if (throwOnGetItem && throwOnGetItem(k, getItemCalls)) {
        throw new Error(`Simulated getItem failure for ${k}`);
      }
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      if (throwOnRemoveItem && throwOnRemoveItem(k)) {
        throw new Error(`Simulated removeItem failure for ${k}`);
      }
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    __map: map,
    __getCalls: () => getItemCalls,
    __resetCalls: () => {
      getItemCalls = 0;
    },
    __setThrowOnGetItem: (fn) => {
      throwOnGetItem = fn;
    },
    __setThrowOnRemoveItem: (fn) => {
      throwOnRemoveItem = fn;
    },
  };
  return storage;
}

async function run() {
  if (compile.status !== 0) {
    throw new Error(compile.stdout + compile.stderr);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');

  let passed = 0;
  const check = (name, fn) => {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  };
  const checkAsync = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  };

  const localStore = createMockStorage();
  const sessionStore = createMockStorage();
  globalThis.window = {
    localStorage: localStore,
    sessionStorage: sessionStore,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const draftMod = load(path.join(output, 'lib/practiceAnswerDraft.js'));
  const userId = 'user-draft-test';
  const legacyKey = `redcall_user_${encodeURIComponent(userId)}__practice_answer_drafts_v1`;
  const makeDraft = (overrides = {}) => ({
    problemId: 'prob-1',
    problemVersion: 1,
    tabId: 'tab-1',
    answerText: 'OLD',
    revealedHints: [],
    confidence: 3,
    errorType: 'none',
    reasoningNotes: '',
    solvingReason: '',
    isReasonNotApplicable: false,
    reasonNotApplicableJustification: '',
    savedAt: '2026-11-13T01:00:00.000Z',
    ...overrides,
  });

  // 1. Item 2: Legacy migration retry must NEVER overwrite NEW or explicitly cleared answer
  check('Item 2: legacy migration retry preserves NEW and explicitly cleared drafts, keeping conflict recovery', () => {
    localStore.clear();
    const oldDraft = makeDraft({ answerText: 'OLD', savedAt: '2026-11-13T01:00:00.000Z' });
    const oldDraft2 = makeDraft({ problemId: 'prob-2', tabId: 'tab-2', answerText: 'OLD-2' });
    localStore.setItem(legacyKey, JSON.stringify({ 'prob-1::tab-1': oldDraft, 'prob-2::tab-2': oldDraft2 }));

    // Step A: removeItem fails on first migration
    localStore.__setThrowOnRemoveItem((k) => k === legacyKey);
    const firstLoad = draftMod.loadPracticeAnswerDraftForTab(userId, 'prob-1', 1, 'tab-1');
    assert.equal(firstLoad?.answerText, 'OLD');

    // Step B: user edits prob-1 to NEW, and explicitly clears prob-2 to ""
    const newDraft = makeDraft({ answerText: 'NEW', savedAt: '2026-11-13T02:00:00.000Z' });
    assert.equal(draftMod.savePracticeAnswerDraft(userId, newDraft), true);
    const clearedDraft2 = makeDraft({
      problemId: 'prob-2',
      tabId: 'tab-2',
      answerText: '',
      savedAt: '2026-11-13T02:05:00.000Z',
    });
    assert.equal(draftMod.savePracticeAnswerDraft(userId, clearedDraft2), true);

    // Step C: allow removeItem now and reload -> NEW and "" must NOT be overwritten by OLD!
    localStore.__setThrowOnRemoveItem(null);
    const reloaded1 = draftMod.loadPracticeAnswerDraftForTab(userId, 'prob-1', 1, 'tab-1');
    assert.equal(reloaded1?.answerText, 'NEW', 'NEW answer must never be overwritten by legacy OLD');

    const reloaded2 = draftMod.loadPracticeAnswerDraftForTab(userId, 'prob-2', 1, 'tab-2');
    assert.equal(reloaded2?.answerText, '', 'Explicitly cleared answer must never be resurrected by legacy OLD');

    // Conflicting legacy OLD must still be recoverable (not silently lost)
    const otherTabs = draftMod.listOtherTabPracticeDrafts(userId, 'prob-1', 1, 'tab-1');
    assert.ok(
      otherTabs.some((d) => d.answerText === 'OLD') || localStore.getItem(legacyKey) !== null,
      'Conflicting legacy OLD must remain recoverable'
    );
  });

  // 2. Item 3: Storage getItem throwing & corrupt fields must NOT crash initialization
  check('Item 3: getItem exception and corrupt draft fields do not throw and report load status cleanly', () => {
    localStore.clear();
    localStore.__setThrowOnGetItem(() => true);
    try {
      // Must not throw out of loadPracticeAnswerDraftForTab / listOtherTabPracticeDrafts
      const loaded = draftMod.loadPracticeAnswerDraftForTab(userId, 'prob-1', 1, 'tab-1');
      assert.equal(loaded, null);
      const others = draftMod.listOtherTabPracticeDrafts(userId, 'prob-1', 1, 'tab-1');
      assert.deepEqual(others, []);
      if (typeof draftMod.loadPracticeAnswerDraftForTabWithStatus === 'function') {
        const res = draftMod.loadPracticeAnswerDraftForTabWithStatus(userId, 'prob-1', 1, 'tab-1');
        assert.equal(res.status, 'read_error');
      }
    } finally {
      localStore.__setThrowOnGetItem(null);
    }

    // Corrupt fields inside JSON must be sanitized/handled without TypeError on trim/localeCompare/length
    const entryKey = `${legacyKey}__prob-corrupt__v1__tab-c`;
    localStore.setItem(
      entryKey,
      JSON.stringify({
        problemId: 'prob-corrupt',
        problemVersion: 1,
        tabId: 'tab-c',
        answerText: 12345,
        revealedHints: 'not-an-array',
        confidence: 'bad',
        errorType: null,
        reasoningNotes: null,
        solvingReason: 99,
        isReasonNotApplicable: 'yes',
        reasonNotApplicableJustification: null,
        savedAt: 999,
      })
    );
    const corruptLoaded = draftMod.loadPracticeAnswerDraftForTab(userId, 'prob-corrupt', 1, 'tab-c');
    if (corruptLoaded) {
      assert.equal(typeof corruptLoaded.answerText, 'string');
      assert.ok(Array.isArray(corruptLoaded.revealedHints));
      assert.equal(typeof corruptLoaded.savedAt, 'string');
      assert.doesNotThrow(() => draftMod.hasPracticeDraftContent(corruptLoaded));
    }
    assert.doesNotThrow(() => draftMod.listOtherTabPracticeDrafts(userId, 'prob-corrupt', 1, 'tab-other'));

    // Unreadable/corrupt entry must not be deleted by clearPracticeAnswerDraft(..., expected)
    const corruptKey = `${legacyKey}__prob-corrupt__v1__tab-corrupt-clear`;
    localStore.setItem(corruptKey, '{not-valid-json');
    assert.equal(
      draftMod.clearPracticeAnswerDraft(userId, 'prob-corrupt', 1, 'tab-corrupt-clear', makeDraft({ problemId: 'prob-corrupt', tabId: 'tab-corrupt-clear' })),
      false,
      'clearPracticeAnswerDraft must refuse to delete unreadable JSON when expected is provided'
    );
    assert.equal(localStore.getItem(corruptKey), '{not-valid-json');

    // SSR render of ProblemSessionModal when localStorage.getItem throws
    const React = load('react');
    const { renderToString } = load('react-dom/server');
    const { INITIAL_PROBLEMS, INITIAL_CONCEPTS, INITIAL_SUBJECTS } = load(path.join(output, 'lib/initialData.js'));
    const { ProblemSessionModal } = load(path.join(output, 'components/ProblemSessionModal.js'));
    const prevWindow = globalThis.window;
    try {
      globalThis.window = {
        localStorage: {
          get length() { return 0; },
          key() { return null; },
          getItem() { throw new Error('blocked storage'); },
          setItem() {},
          removeItem() {},
        },
        sessionStorage: createMockStorage(),
      };
      const html = renderToString(
        React.createElement(ProblemSessionModal, {
          isOpen: true,
          userId: 'u-ssr',
          problem: INITIAL_PROBLEMS[0],
          concept: INITIAL_CONCEPTS[0],
          subject: INITIAL_SUBJECTS[0],
          onClose() {},
          onSubmitAttempt: async () => ({}),
        })
      );
      assert.ok(html.includes('자동저장을 중지했습니다'), 'Modal must show blocked autosave warning on storage read failure');
      assert.ok(html.includes('초안 확인 다시 시도'), 'Modal must show retry draft read button');
    } finally {
      globalThis.window = prevWindow;
    }
  });

  // 3. Item 6A: 1,000 drafts single-snapshot classification reduces getItem calls by half
  check('Item 6A: 1,000 drafts recoverable classification reads storage in a single pass (~1001 getItem calls)', () => {
    localStore.clear();
    for (let i = 0; i < 1000; i++) {
      const pid = i < 2 ? 'prob-target' : `prob-${i}`;
      const ver = i === 1 ? 2 : 1;
      const tid = `tab-${i}`;
      const k = `${legacyKey}__${pid}__v${ver}__${tid}`;
      localStore.setItem(k, JSON.stringify(makeDraft({ problemId: pid, problemVersion: ver, tabId: tid, answerText: `ans-${i}` })));
    }
    localStore.__resetCalls();
    draftMod.listOtherTabPracticeDrafts(userId, 'prob-target', 1, 'tab-current');
    draftMod.listPracticeAnswerDraftsForProblem(userId, 'prob-target');
    const beforeReads = localStore.__getCalls();

    localStore.__resetCalls();
    assert.equal(typeof draftMod.listRecoverablePracticeDraftsWithStatus, 'function', 'listRecoverablePracticeDraftsWithStatus must exist');
    const res = draftMod.listRecoverablePracticeDraftsWithStatus(userId, 'prob-target', 1, 'tab-current');
    const afterReads = localStore.__getCalls();
    console.log(`  [6A 1,000-draft getItem count] before (2 scans): ${beforeReads}, after (1 scan): ${afterReads}`);
    assert.equal(res.status, 'ok');
    assert.equal(res.drafts.length, 2, 'Should find 1 other-tab and 1 other-version draft');
    assert.ok(beforeReads >= 2000, `Expected legacy two-scan >= 2000 getItem calls, got ${beforeReads}`);
    assert.ok(afterReads <= 1002, `Expected <= 1002 getItem calls for 1000 drafts, got ${afterReads}`);
  });

  // 4. Item 6B: Bounded parallel cloud library download (max 3), order preserved, deleting skipped, error propagated, stale blocked
  await checkAsync('Item 6B: loadCloudLibrary runs bounded parallel downloads (<=3), preserves order, skips deleting, propagates error & stale check', async () => {
    const libraryMod = load(path.join(output, 'lib/cloud/library.js'));
    assert.equal(typeof libraryMod.loadCloudLibraryWithDeps, 'function', 'loadCloudLibraryWithDeps or test hook expected');

    let inFlight = 0;
    let maxInFlight = 0;
    const rows = [
      { id: 'm1', subject_id: 's1', title: 'M1', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p1', original_path: 'o1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm2-del', subject_id: 's1', title: 'Del', kind: 'pdf', source_ref: '', upload_state: 'deleting', content_path: 'p2', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm3', subject_id: 's1', title: 'M3', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p3', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm4-pending', subject_id: 's1', title: 'Pend', kind: 'pdf', source_ref: '', upload_state: 'uploading', content_path: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'm5', subject_id: 's1', title: 'M5', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p5', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm6', subject_id: 's1', title: 'M6', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p6', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm7', subject_id: 's1', title: 'M7', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p7', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm8', subject_id: 's1', title: 'M8', kind: 'pdf', source_ref: '', upload_state: 'ready', content_path: 'p8', created_at: '2026-01-01T00:00:00Z' },
    ];

    const res = await libraryMod.loadCloudLibraryWithDeps({
      listSubjects: async () => ({ ok: true, data: [{ id: 's1', name: '통계학', exam_date: null, color: '#000', created_at: '2026-01-01T00:00:00Z' }] }),
      listMaterialRows: async () => ({ ok: true, data: rows }),
      downloadMaterialContent: async (row) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Variable delays so out-of-order completion happens if not ordered properly
        const delayMs = row.id === 'm1' ? 40 : 15;
        await new Promise((r) => setTimeout(r, delayMs));
        inFlight--;
        return { ok: true, data: { markdown: `body-${row.id}`, pages: [] } };
      },
    });

    assert.equal(res.ok, true);
    assert.ok(maxInFlight >= 2 && maxInFlight <= 3, `Expected bounded concurrency 2..3, got ${maxInFlight}`);
    assert.deepEqual(
      res.data.materials.map((m) => m.id),
      ['m1', 'm3', 'm4-pending', 'm5', 'm6', 'm7', 'm8'],
      'Output order must match input order with deleting excluded'
    );
    assert.equal(res.data.originalPathByMaterialId['m1'], 'o1');

    // Error propagation check
    const errRes = await libraryMod.loadCloudLibraryWithDeps({
      listSubjects: async () => ({ ok: true, data: [] }),
      listMaterialRows: async () => ({ ok: true, data: rows }),
      downloadMaterialContent: async (row) => {
        if (row.id === 'm5') return { ok: false, error: 'network boom' };
        return { ok: true, data: { markdown: `body-${row.id}`, pages: [] } };
      },
    });
    assert.equal(errRes.ok, false);
    assert.ok(errRes.error.includes('m5') && errRes.error.includes('network boom'));

    // Stale account switch check
    let switched = false;
    const staleRes = await libraryMod.loadCloudLibraryWithDeps({
      listSubjects: async () => ({ ok: true, data: [] }),
      listMaterialRows: async () => ({ ok: true, data: rows }),
      downloadMaterialContent: async (row) => {
        await new Promise((r) => setTimeout(r, 15));
        switched = true;
        return { ok: true, data: { markdown: `body-${row.id}`, pages: [] } };
      },
      isStale: () => switched,
    });
    assert.equal(staleRes.ok, false);
  });

  await checkAsync('learningMigration: problem insert 후 버전 upload 실패 시 재시도 복구 및 v1/초안 검증', async () => {
    const learningMigration = load(path.join(output, 'lib/cloud/learningMigration.js'));
    const userId = 'mig-retry-user';
    const userPrefix = `redcall_user_${encodeURIComponent(userId)}__`;

    const origWindow = global.window;
    const origLocalStorage = global.localStorage;
    const store = new Map();
    const memStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    };
    global.window = { localStorage: memStorage };
    global.localStorage = memStorage;

    try {
      // Seed subjects/materials migration marker + local problem (v1) + draft
      store.set(`${userPrefix}cloud_migration_v1`, JSON.stringify({ completed: true }));
      const localProblem = {
        id: 'prob-mig-1',
        subjectId: 'subj-1',
        conceptIds: ['c-1'],
        title: '이관 문제 1',
        type: 'essay_descriptive',
        difficulty: 'advanced_college',
        promptText: '증명하시오.',
        modelAnswer: '증명 완료',
        rubric: [{ id: 'r1', label: '논리', maxScore: 100, weight: 1, description: '엄밀성' }],
        hints: ['힌트'],
        version: 1,
        isApproved: true,
        isDemo: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const localConceptDraft = {
        id: 'cd-mig-1',
        subjectId: 'subj-1',
        materialId: 'mat-1',
        title: '초안 개념',
        description: '설명',
        coreDefinitionFormulaOrAlgorithm: '정의',
        prerequisites: [],
        relatedConcepts: [],
        commonMisconceptions: [],
        examples: [],
        sourceEvidence: { type: 'page', pageNumber: 1, quote: '근거' },
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        needsSourceReview: false,
      };
      store.set(`${userPrefix}problems_v1`, JSON.stringify([localProblem]));
      store.set(`${userPrefix}concept_drafts_v1`, JSON.stringify([localConceptDraft]));
      store.set(`${userPrefix}concepts_v1`, JSON.stringify([]));
      store.set(`${userPrefix}problem_drafts_v1`, JSON.stringify([]));

      // Fake Supabase where problem_versions upsert fails on attempt 1, succeeds on attempt 2
      const dbState = {
        concepts: [],
        concept_drafts: [],
        problems: [],
        problem_drafts: [],
        problem_versions: [],
      };
      let failVersionUpsert = true;

      const makeFakeClient = () => ({
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from(table) {
          let filters = [];
          let rangeBounds = null;
          const runSelect = () => {
            let rows = [...(dbState[table] || [])];
            for (const [col, val, op] of filters) {
              if (op === 'in') rows = rows.filter((r) => val.includes(r[col]));
              else rows = rows.filter((r) => r[col] === val);
            }
            if (rangeBounds) {
              rows = rows.slice(rangeBounds[0], rangeBounds[1] + 1);
            }
            return { data: rows, error: null };
          };
          const builder = {
            select() { return builder; },
            eq(col, val) { filters.push([col, val, 'eq']); return builder; },
            in(col, val) { filters.push([col, val, 'in']); return builder; },
            order() { return builder; },
            range(from, to) { rangeBounds = [from, to]; return builder; },
            then(resolve) { return Promise.resolve(runSelect()).then(resolve); },
            upsert(rows, opts) {
              if (table === 'problem_versions' && failVersionUpsert) {
                return Promise.resolve({ data: null, error: { message: 'injected version upload failure' } });
              }
              const arr = Array.isArray(rows) ? rows : [rows];
              const inserted = [];
              for (const row of arr) {
                const keyField = table === 'problem_versions' ? 'problem_id' : 'id';
                const exists = dbState[table].some((r) =>
                  table === 'problem_versions'
                    ? r.problem_id === row.problem_id && r.version === row.version
                    : r[keyField] === row[keyField]
                );
                if (!exists) {
                  const storedRow = {
                    ...row,
                    user_id: userId,
                    created_at: row.created_at ?? row.payload?.createdAt ?? '2026-01-01T00:00:00.000Z',
                    updated_at: row.updated_at ?? '2026-01-01T00:00:00.000Z',
                    payload: row.payload ?? row,
                  };
                  dbState[table].push(storedRow);
                  inserted.push(storedRow);
                } else if (!opts?.ignoreDuplicates) {
                  const idx = dbState[table].findIndex((r) => r[keyField] === row[keyField]);
                  dbState[table][idx] = {
                    ...row,
                    user_id: userId,
                    created_at: row.created_at ?? row.payload?.createdAt ?? '2026-01-01T00:00:00.000Z',
                    updated_at: row.updated_at ?? '2026-01-01T00:00:00.000Z',
                    payload: row.payload ?? row,
                  };
                  inserted.push(dbState[table][idx]);
                }
              }
              return {
                select: () => Promise.resolve({ data: inserted, error: null }),
                then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
              };
            },
          };
          return builder;
        },
      });

      const fakeSupabase = makeFakeClient();

      // Attempt 1: problem row is inserted, version upload fails -> must NOT write completion marker
      const firstRes = await learningMigration.migrateLocalLearningToCloud(userId, fakeSupabase);
      assert.equal(firstRes.ok, false, `버전 업로드 실패 시 이관은 실패해야 함: ${firstRes.message}`);
      assert.equal(dbState.problems.length, 1, `문제 본체는 이미 삽입됨 (${firstRes.message})`);
      assert.equal(dbState.problem_versions.length, 0, '버전 스냅샷은 아직 없음');
      assert.equal(store.has(`${userPrefix}cloud_learning_migration_v1`), false, '검증 전 완료 표시가 기록되면 안 됨');

      // Attempt 2: retry (problem is skipped by planLearningMigration, yet version v1 must be recovered!)
      failVersionUpsert = false;
      const retryRes = await learningMigration.migrateLocalLearningToCloud(userId, fakeSupabase);
      assert.equal(retryRes.ok, true, `재시도 성공해야 함: ${retryRes.message}`);
      assert.equal(dbState.problem_versions.length, 1, '누락된 v1 버전 스냅샷이 독립 복구되어야 함');
      assert.equal(dbState.problem_versions[0].version, 1);
      assert.equal(store.has(`${userPrefix}cloud_learning_migration_v1`), true, '검증 통과 후 완료 표시 기록');

      // Legacy falsely-completed marker without verifiedVersion=2 & missing v1 version -> detected and repaired
      dbState.problem_versions = [];
      store.set(`${userPrefix}cloud_learning_migration_v1`, JSON.stringify({ completed: true, uploaded: 1 }));
      const legacyState = learningMigration.getLearningMigrationState(userId);
      assert.equal(legacyState.imported, false, '구형 미검증 완료 표시는 재검증 대상으로 탐지되어야 함');
      assert.equal(legacyState.resume, true);

      const repairRes = await learningMigration.migrateLocalLearningToCloud(userId, fakeSupabase);
      assert.equal(repairRes.ok, true, `구형 미검증 마커 복구 성공해야 함: ${repairRes.message}`);
      assert.equal(dbState.problem_versions.length, 1, '구형 마커 복구 시 누락 v1 버전 복원');

      // Same-version snapshot content conflict -> verifyMigration MUST reject and NOT write completion marker
      store.delete(`${userPrefix}cloud_learning_migration_v1`);
      dbState.problem_versions[0].snapshot = {
        ...dbState.problem_versions[0].snapshot,
        promptText: '변조된 다른 지문 내용',
      };
      const conflictSnapRes = await learningMigration.migrateLocalLearningToCloud(userId, fakeSupabase);
      assert.equal(conflictSnapRes.ok, false, '동일 버전 다른 스냅샷 내용은 완료 처리되면 안 됨');
      assert.equal(store.has(`${userPrefix}cloud_learning_migration_v1`), false, '스냅샷 내용 충돌 시 완료 마커 금지');

      // JSONB key reordering identical content -> MUST succeed
      const reverseKeys = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
        return Object.fromEntries(Object.keys(obj).reverse().map((k) => [k, reverseKeys(obj[k])]));
      };
      dbState.problems[0].payload = reverseKeys(localProblem);
      dbState.concept_drafts[0].payload = reverseKeys(localConceptDraft);
      dbState.problem_versions[0].snapshot = reverseKeys({
        ...localProblem,
        version: 1,
        editedAt: localProblem.createdAt,
        editReason: 'migrated',
      });
      const reorderedRes = await learningMigration.migrateLocalLearningToCloud(userId, fakeSupabase);
      assert.equal(reorderedRes.ok, true, `JSONB 키 재정렬 동일 내용은 성공해야 함: ${reorderedRes.message}`);

      // Pagination & ID chunking test for listProblemVersionsByProblemIds (>1000 rows / >100 IDs)
      const learningRepo = load(path.join(output, 'lib/cloud/learningRepository.js'));
      const manyIds = Array.from({ length: 120 }, (_, i) => `prob-page-${i}`);
      const origVersions = dbState.problem_versions;
      dbState.problem_versions = manyIds.flatMap((pid) => [
        { problem_id: pid, version: 1, snapshot: { version: 1, title: pid, promptText: 'p', type: 'essay_descriptive', conceptIds: ['c1'], hints: ['h'], modelAnswer: 'a', rubric: [{ id: 'r1', label: 'l', maxScore: 100 }] } },
        { problem_id: pid, version: 2, snapshot: { version: 2, title: pid, promptText: 'p2', type: 'essay_descriptive', conceptIds: ['c1'], hints: ['h'], modelAnswer: 'a', rubric: [{ id: 'r1', label: 'l', maxScore: 100 }] } },
      ]);
      const pagedVersionsRes = await learningRepo.listProblemVersionsByProblemIds(fakeSupabase, manyIds);
      assert.equal(pagedVersionsRes.ok, true, '청크+페이지네이션 버전 조회 성공해야 함');
      assert.equal(Object.keys(pagedVersionsRes.data).length, 120, '120개 문제 모두 조회되어야 함');
      assert.equal(pagedVersionsRes.data['prob-page-119'].length, 2, '마지막 문제 v1/v2 모두 포함');
      dbState.problem_versions = origVersions;
    } finally {
      global.window = origWindow;
      global.localStorage = origLocalStorage;
    }
  });

  await check('mockExam scopes in-memory store per account and never overwrites corrupt localStorage', async () => {
    const scopeMod = load(path.join(output, 'lib/storageScope.js'));
    const mockExamMod = load(path.join(output, 'lib/mockExam.js'));
    const origWindow = global.window;
    const origLocalStorage = global.localStorage;
    try {
      // 1. Without localStorage, account A and B must have isolated in-memory stores
      global.window = undefined;
      global.localStorage = undefined;
      scopeMod.setStorageScope({ kind: 'user', userId: 'mock-user-a' });
      mockExamMod.saveMockExam({
        id: 'exam-a',
        subjectId: 'sub-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T01:00:00.000Z',
        durationMinutes: 60,
        status: 'in_progress',
        selectedConceptIds: [],
        selectedTypes: [],
        problems: [],
        answers: {},
        evaluations: {},
      });
      assert.equal(mockExamMod.loadMockExams().length, 1);

      scopeMod.setStorageScope({ kind: 'user', userId: 'mock-user-b' });
      assert.equal(mockExamMod.loadMockExams().length, 0, '계정 B는 계정 A의 인메모리 모의고사를 보지 않아야 함');

      // 2. Corrupt localStorage must not be overwritten by saveMockExam
      const corruptRaw = '{corrupt-json';
      const backing = new Map([['redcall_user_mock-user-b__mock_exam_sessions_v1', corruptRaw]]);
      const fakeLs = {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => { backing.set(k, v); },
        removeItem: (k) => { backing.delete(k); },
      };
      global.window = { localStorage: fakeLs };
      global.localStorage = fakeLs;
      mockExamMod.saveMockExam({
        id: 'exam-b',
        subjectId: 'sub-b',
        createdAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T01:00:00.000Z',
        durationMinutes: 60,
        status: 'in_progress',
        selectedConceptIds: [],
        selectedTypes: [],
        problems: [],
        answers: {},
        evaluations: {},
      });
      assert.equal(
        backing.get('redcall_user_mock-user-b__mock_exam_sessions_v1'),
        corruptRaw,
        '손상된 localStorage 모의고사 데이터는 덮어쓰지 않고 보존되어야 함'
      );
      assert.equal(mockExamMod.loadMockExams().length, 1, '손상 시에도 인메모리 최신 저장본을 반환해야 함');

      // 3. setItem quota failure -> subsequent save -> storage recovery -> same-ID latest-content
      scopeMod.setStorageScope({ kind: 'user', userId: 'mock-user-c' });
      let throwQuota = true;
      const quotaLs = {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => {
          if (throwQuota) throw new Error('QuotaExceededError');
          backing.set(k, v);
        },
        removeItem: (k) => { backing.delete(k); },
      };
      global.window = { localStorage: quotaLs };
      global.localStorage = quotaLs;

      mockExamMod.saveMockExam({
        id: 'exam-c1',
        subjectId: 'sub-c',
        createdAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T01:00:00.000Z',
        durationMinutes: 60,
        status: 'in_progress',
        selectedConceptIds: [],
        selectedTypes: [],
        problems: [],
        answers: { p1: 'first' },
        evaluations: {},
      });
      assert.equal(mockExamMod.loadMockExams().length, 1, 'setItem 실패 후에도 loadMockExams가 최신 메모리 항목을 반환해야 함');
      assert.equal(mockExamMod.loadMockExams()[0].answers.p1, 'first');

      // Subsequent save while quota still failing must preserve previous unsaved exam
      mockExamMod.saveMockExam({
        id: 'exam-c2',
        subjectId: 'sub-c',
        createdAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T01:00:00.000Z',
        durationMinutes: 60,
        status: 'in_progress',
        selectedConceptIds: [],
        selectedTypes: [],
        problems: [],
        answers: { p2: 'second' },
        evaluations: {},
      });
      assert.equal(mockExamMod.loadMockExams().length, 2, '연속 setItem 실패 시 이전 미저장 모의고사도 보존되어야 함');

      // Storage recovers & same-ID update keeps latest content
      throwQuota = false;
      mockExamMod.saveMockExam({
        id: 'exam-c1',
        subjectId: 'sub-c',
        createdAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T01:00:00.000Z',
        durationMinutes: 60,
        status: 'submitted',
        selectedConceptIds: [],
        selectedTypes: [],
        problems: [],
        answers: { p1: 'updated' },
        evaluations: {},
      });
      const recovered = mockExamMod.loadMockExams();
      assert.equal(recovered.length, 2);
      assert.equal(recovered.find((e) => e.id === 'exam-c1')?.answers.p1, 'updated');
      assert.equal(recovered.find((e) => e.id === 'exam-c1')?.status, 'submitted');
      const persistedParsed = JSON.parse(backing.get('redcall_user_mock-user-c__mock_exam_sessions_v1'));
      assert.equal(persistedParsed.length, 2, '저장소 복구 시 누적된 모의고사 전체가 localStorage에 반영되어야 함');
    } finally {
      global.window = origWindow;
      global.localStorage = origLocalStorage;
    }
  });

  await check('resolveAuthCallbackOrigin enforces http/https schemes, valid host/port syntax, and safe fallbacks', async () => {
    const { resolveAuthCallbackOrigin } = load(path.join(output, 'lib/auth/redirects.js'));
    assert.equal(
      resolveAuthCallbackOrigin({ siteUrl: 'https://learnaway.example.com/some/path', fallbackOrigin: 'http://localhost:3000' }),
      'https://learnaway.example.com'
    );
    assert.equal(
      resolveAuthCallbackOrigin({ siteUrl: 'javascript:alert(1)', fallbackOrigin: 'http://localhost:3000' }),
      'http://localhost:3000'
    );
    assert.equal(
      resolveAuthCallbackOrigin({ siteUrl: 'ftp://files.example.com', fallbackOrigin: 'http://localhost:3000' }),
      'http://localhost:3000'
    );
    assert.equal(
      resolveAuthCallbackOrigin({ siteUrl: 'not-a-valid-url', fallbackOrigin: 'http://localhost:3000' }),
      'http://localhost:3000'
    );
    assert.equal(
      resolveAuthCallbackOrigin({
        forwardedHost: 'proxy.example.com:8443',
        forwardedProto: 'https',
        fallbackOrigin: 'http://localhost:3000',
      }),
      'https://proxy.example.com:8443'
    );
    assert.equal(
      resolveAuthCallbackOrigin({
        forwardedHost: 'evil.com/path',
        forwardedProto: 'https',
        fallbackOrigin: 'http://localhost:3000',
      }),
      'http://localhost:3000'
    );
    assert.equal(
      resolveAuthCallbackOrigin({
        forwardedHost: 'user@evil.com',
        forwardedProto: 'https',
        fallbackOrigin: 'http://localhost:3000',
      }),
      'http://localhost:3000'
    );
    assert.equal(
      resolveAuthCallbackOrigin({
        forwardedHost: 'proxy.example.com',
        forwardedProto: 'javascript',
        fallbackOrigin: 'http://localhost:3000',
      }),
      'https://proxy.example.com'
    );
  });

  await check('persist-drafts rejects invalid draft array items with 400 before DB write and accepts valid items', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server.js'));
    const apiAuthMod = load(path.join(output, 'lib/auth/apiAuth.js'));
    const supaServerMod = load(path.join(output, 'lib/supabase/server.js'));
    const learningRepoMod = load(path.join(output, 'lib/cloud/learningRepository.js'));

    const origRequireApiUser = apiAuthMod.requireApiUser;
    const origCreateClient = supaServerMod.createClient;
    const origUpsertConceptDrafts = learningRepoMod.upsertConceptDrafts;

    let createClientCalls = 0;
    apiAuthMod.requireApiUser = async () => ({ ok: true, user: { id: 'u-persist-1', email: 'u@example.com' } });
    supaServerMod.createClient = async () => {
      createClientCalls++;
      return {};
    };
    learningRepoMod.upsertConceptDrafts = async (_supa, drafts) => ({ ok: true, data: drafts });

    try {
      const persistRoute = load(path.join(output, 'app/api/persist-drafts/route.js'));
      const invalidPayloads = [
        { kind: 'concept', drafts: [null] },
        { kind: 'concept', drafts: [{ id: '', subjectId: 'sub-1' }] },
        { kind: 'problem', drafts: [{ id: 'd-1' }] },
        { kind: 'problem', drafts: [['nested']] },
      ];
      for (const body of invalidPayloads) {
        const req = new NextRequest('http://localhost/api/persist-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const res = await persistRoute.POST(req);
        assert.equal(res.status, 400);
      }
      assert.equal(createClientCalls, 0, '잘못된 초안 배열은 DB 클라이언트 생성 전에 차단되어야 함');

      const validReq = new NextRequest('http://localhost/api/persist-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'concept', drafts: [{ id: 'd-ok', subjectId: 'sub-1', title: 'Valid' }] }),
      });
      const validRes = await persistRoute.POST(validReq);
      assert.equal(validRes.status, 200);
      assert.equal(createClientCalls, 1);
    } finally {
      apiAuthMod.requireApiUser = origRequireApiUser;
      supaServerMod.createClient = origCreateClient;
      learningRepoMod.upsertConceptDrafts = origUpsertConceptDrafts;
    }
  });

  await check('drive upload persists refreshed OAuth cookie on init and intermediate chunk responses', async () => {
    const { NextRequest } = load(path.join(root, 'node_modules/next/server.js'));
    const apiAuthMod = load(path.join(output, 'lib/auth/apiAuth.js'));
    const driveLibMod = load(path.join(output, 'lib/drive/googleDrive.js'));

    const origRequireApiUser = apiAuthMod.requireApiUser;
    const origGetConfig = driveLibMod.getGoogleDriveConfig;
    const origDecrypt = driveLibMod.decryptPayload;
    const origEncrypt = driveLibMod.encryptPayload;
    const origRefresh = driveLibMod.refreshGoogleAccessToken;
    const origFindFolder = driveLibMod.findOrCreateBackupFolder;
    const origCreateResumable = driveLibMod.createResumableUploadSession;
    const origUploadChunk = driveLibMod.uploadResumableChunk;

    apiAuthMod.requireApiUser = async () => ({ ok: true, user: { id: 'u-drive-1', email: 'd@example.com' } });
    driveLibMod.getGoogleDriveConfig = () => ({ configured: true, clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://localhost/cb' });
    driveLibMod.decryptPayload = (token) => {
      if (token === 'enc-expired-session') {
        return JSON.stringify({
          userId: 'u-drive-1',
          googleEmail: 'd@example.com',
          accessToken: 'old-access',
          expiresAt: Date.now() - 60_000,
          refreshToken: 'refresh-tok-1',
        });
      }
      if (token === 'enc-upload-session') {
        return JSON.stringify({
          userId: 'u-drive-1',
          jobId: 'job-1',
          resumableUri: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc',
          totalBytes: 10,
          fileName: 'backup.json',
          completeness: 'complete',
          totalMaterials: 1,
          withFiles: 1,
          createdAt: Date.now(),
        });
      }
      return null;
    };
    driveLibMod.encryptPayload = (raw) => `enc:${Buffer.from(raw, 'utf8').toString('base64')}`;
    driveLibMod.refreshGoogleAccessToken = async () => ({ accessToken: 'new-access-tok', expiresIn: 3600 });
    driveLibMod.findOrCreateBackupFolder = async () => 'folder-1';
    driveLibMod.createResumableUploadSession = async () => 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';
    driveLibMod.uploadResumableChunk = async () => ({ complete: false, range: 'bytes=0-4' });

    try {
      const driveUploadRoute = load(path.join(output, 'app/api/drive/upload/route.js'));

      // 1. init with expired session -> refreshes token and sets updated cookie
      const initReq = new NextRequest('http://localhost/api/drive/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${driveLibMod.DRIVE_SESSION_COOKIE_NAME}=enc-expired-session`,
        },
        body: JSON.stringify({ action: 'init', totalBytes: 10, totalMaterials: 1, withFiles: 1 }),
      });
      const initRes = await driveUploadRoute.POST(initReq);
      assert.equal(initRes.status, 200);
      const initSetCookie = initRes.headers.get('set-cookie') || '';
      assert.ok(initSetCookie.includes(driveLibMod.DRIVE_SESSION_COOKIE_NAME), 'init 응답에 갱신된 Drive 쿠키가 포함되어야 함');

      // 2. intermediate chunk with expired session -> refreshes token and sets updated cookie
      const chunkReq = new NextRequest('http://localhost/api/drive/upload', {
        method: 'POST',
        headers: {
          cookie: `${driveLibMod.DRIVE_SESSION_COOKIE_NAME}=enc-expired-session`,
          'x-upload-session': 'enc-upload-session',
          'content-range': 'bytes 0-4/10',
        },
        body: Buffer.from('hello'),
      });
      const chunkRes = await driveUploadRoute.POST(chunkReq);
      assert.equal(chunkRes.status, 200);
      const chunkSetCookie = chunkRes.headers.get('set-cookie') || '';
      assert.ok(chunkSetCookie.includes(driveLibMod.DRIVE_SESSION_COOKIE_NAME), '중간 청크 응답에도 갱신된 Drive 쿠키가 포함되어야 함');
    } finally {
      apiAuthMod.requireApiUser = origRequireApiUser;
      driveLibMod.getGoogleDriveConfig = origGetConfig;
      driveLibMod.decryptPayload = origDecrypt;
      driveLibMod.encryptPayload = origEncrypt;
      driveLibMod.refreshGoogleAccessToken = origRefresh;
      driveLibMod.findOrCreateBackupFolder = origFindFolder;
      driveLibMod.createResumableUploadSession = origCreateResumable;
      driveLibMod.uploadResumableChunk = origUploadChunk;
    }
  });

  console.log(`${passed} draft/library regression checks passed`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));

