/* Regression tests for practiceAnswerDraft migration/resilience/efficiency & cloud library bounded parallel downloads. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redcall-regressions-drafts-'));

const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/types.ts',
    'lib/practiceAnswerDraft.ts',
    'lib/cloud/types.ts',
    'lib/cloud/mappers.ts',
    'lib/cloud/library.ts',
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

  console.log(`${passed} draft/library regression checks passed`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));

