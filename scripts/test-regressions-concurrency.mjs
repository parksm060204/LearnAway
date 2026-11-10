/* Regression tests for problem save concurrency bugs 1, 2 & 3 (extracted to keep file sizes below IDE 1MB inline-diff limit). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redcall-regressions-concurrency-'));
const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/types.ts',
    'lib/storage.ts',
    'lib/storageScope.ts',
    'lib/cloud/types.ts',
    'lib/cloud/hash.ts',
    'lib/cloud/mappers.ts',
    'lib/cloud/learningMappers.ts',
    'lib/cloud/learningRepository.ts',
    'lib/cloud/mergeLearning.ts',
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

async function run() {
  if (compile.status !== 0) {
    throw new Error(compile.stdout + compile.stderr);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');

  const data = new Map();
  global.window = { localStorage: {} };
  global.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  window.localStorage = localStorage;

  const storage = load(path.join(output, 'lib', 'storage.js'));
  const storageScope = load(path.join(output, 'lib', 'storageScope.js'));
  const learningRepo = load(path.join(output, 'lib', 'cloud', 'learningRepository.js'));

  let passed = 0;
  const checkAsync = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  };

  await checkAsync('Bug 3 (Stale Response Reversion): Late v2 success response arriving after v3 was confirmed must not revert B/v3 to A/v2', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'user_bug3_stale_reversion' });
    try {
      const problemId = 'prob-stale-reversion-test';
      const initialProblem = {
        id: problemId,
        subjectId: 'sub-stale-1',
        title: 'Initial Title v1',
        promptText: 'Initial Prompt v1',
        type: 'logic_proof',
        conceptIds: ['c-stale'],
        hints: ['Hint 1'],
        modelAnswer: 'Answer 1',
        rubric: [{ id: 'r1', criteria: 'c1', points: 10, description: 'd1' }],
        timeStandardMinutes: 10,
        version: 1,
        serverConfirmedVersion: 1,
      };
      storage.saveStoredProblems([initialProblem]);

      // Edit A: v1 -> v2
      const editA = storage.editAndReviseProblem(
        problemId,
        {
          title: 'Title Edit A v2',
          promptText: 'Prompt Edit A v2',
        },
        'Edit A reason'
      );
      assert.equal(editA.success, true);
      assert.equal(editA.updatedProblem.version, 2);

      // Edit B: v2 -> v3
      const editB = storage.editAndReviseProblem(
        problemId,
        {
          title: 'Title Edit B v3',
          promptText: 'Prompt Edit B v3',
        },
        'Edit B reason'
      );
      assert.equal(editB.success, true);
      assert.equal(editB.updatedProblem.version, 3);

      // B's server confirmation (v3) arrives FIRST and is processed
      const serverProbB = {
        ...editB.updatedProblem,
        version: 3,
      };
      const syncB = storage.confirmProblemRevisionSynced(problemId, serverProbB, {
        revisionId: editB.memoryRevision.revisionId,
        generation: editB.memoryRevision.generation,
        snapshotProblem: editB.updatedProblem,
        editReason: 'Edit B reason',
      });
      assert.equal(syncB.reconciled, true);

      // Verify B/v3 is currently in storage
      const storedAfterB = storage.loadStoredProblems().find((p) => p.id === problemId);
      assert.equal(storedAfterB.version, 3);
      assert.equal(storedAfterB.title, 'Title Edit B v3');
      assert.equal(storedAfterB.serverConfirmedVersion, 3);

      // B's revision is cleaned up (as expected after normal sync)
      assert.equal(storage.getEffectiveUnsavedProblemRevision(problemId), null);

      // NOW: Late v2 success response for Edit A arrives!
      const serverProbA = {
        ...editA.updatedProblem,
        version: 2,
      };
      const syncA = storage.confirmProblemRevisionSynced(problemId, serverProbA, {
        revisionId: editA.memoryRevision.revisionId,
        generation: 1,
        snapshotProblem: editA.updatedProblem,
        editReason: 'Edit A reason',
      });

      // Assertions:
      assert.equal(syncA.status, 'stale_ignored', 'Late v2 response identified as stale_ignored');
      const storedAfterLateA = storage.loadStoredProblems().find((p) => p.id === problemId);
      assert.equal(storedAfterLateA.version, 3, 'Stored problem version remains 3 (NOT reverted to 2)');
      assert.equal(storedAfterLateA.title, 'Title Edit B v3', 'Stored problem body remains B (NOT reverted to A)');
      assert.equal(storedAfterLateA.serverConfirmedVersion, 3, 'serverConfirmedVersion remains 3');

      // Check 2: Storage reload preserves B/v3
      const reloadedStored = storage.loadStoredProblems().find((p) => p.id === problemId);
      assert.equal(reloadedStored.version, 3, 'Reloaded problem version remains 3');
      assert.equal(reloadedStored.title, 'Title Edit B v3', 'Reloaded problem title remains B');
      assert.equal(reloadedStored.serverConfirmedVersion, 3, 'Reloaded serverConfirmedVersion remains 3');

      // Check 3: Latest pending revision baseVersion is NOT decreased by older response
      const editC = storage.editAndReviseProblem(
        problemId,
        {
          title: 'Title Edit C v4',
          promptText: 'Prompt Edit C v4',
        },
        'Edit C reason'
      );
      assert.equal(editC.success, true);
      assert.equal(editC.updatedProblem.version, 4);
      const pendingC = storage.getEffectiveUnsavedProblemRevision(problemId);
      assert.ok(pendingC);
      assert.equal(pendingC.baseVersion, 3, 'Pending edit C is based on v3');

      // Now another old response (v2) arrives while C is pending:
      const syncOldWhilePending = storage.confirmProblemRevisionSynced(problemId, serverProbA, {
        revisionId: editA.memoryRevision.revisionId,
        generation: 1,
        snapshotProblem: editA.updatedProblem,
        editReason: 'Edit A reason',
      });
      assert.equal(syncOldWhilePending.status, 'stale_ignored', 'Old response ignored while C is pending');
      const pendingCAfterOld = storage.getEffectiveUnsavedProblemRevision(problemId);
      assert.equal(pendingCAfterOld.baseVersion, 3, 'Pending C baseVersion strictly NOT decreased (remains 3)');

      // Check 4: Duplicate response with same version and SAME content: idempotent, no duplicate history
      const serverProbBRepeat = {
        ...serverProbB,
        version: 3,
      };
      const histLengthBefore = storage.loadStoredProblems().find((p) => p.id === problemId).versionHistory?.length ?? 0;
      const syncDup = storage.confirmProblemRevisionSynced(problemId, serverProbBRepeat, {
        revisionId: editB.memoryRevision.revisionId,
        generation: editB.memoryRevision.generation,
      });
      assert.equal(syncDup.status, 'duplicate', 'Duplicate response identified as duplicate');
      const storedAfterDup = storage.loadStoredProblems().find((p) => p.id === problemId);
      assert.equal(storedAfterDup.versionHistory?.length ?? 0, histLengthBefore, 'No duplicate history added');

      // Check 5: Same version with DIFFERENT content: conflict, does not overwrite local problem
      const serverProbBMismatch = {
        ...serverProbB,
        title: 'Tampered Title from other device',
        promptText: 'Tampered Prompt from other device',
        version: 3,
      };
      const syncConflict = storage.confirmProblemRevisionSynced(problemId, serverProbBMismatch, {
        revisionId: 'other-rev-id',
        generation: 1,
      });
      assert.equal(syncConflict.status, 'conflict', 'Content mismatch at same version identified as conflict');
      const storedAfterConflict = storage.loadStoredProblems().find((p) => p.id === problemId);
      assert.equal(storedAfterConflict.title, 'Title Edit C v4', 'Local problem not overwritten by conflicting response');

      // Check 6: Local optimistic version higher than server confirmed version:
      const problemId6 = 'prob-optimistic-higher-test';
      storage.saveStoredProblems([
        ...storage.loadStoredProblems(),
        {
          id: problemId6,
          subjectId: 'sub-stale-1',
          title: 'Problem 6 Initial',
          promptText: 'Prompt 6',
          type: 'logic_proof',
          conceptIds: ['c-stale'],
          hints: [],
          modelAnswer: 'ans',
          rubric: [],
          timeStandardMinutes: 10,
          version: 1,
          serverConfirmedVersion: 1,
        },
      ]);
      const edit6 = storage.editAndReviseProblem(problemId6, { title: 'Problem 6 Edited' }, 'Edit reason');
      assert.equal(edit6.updatedProblem.version, 2, 'Local temporary version is 2');
      const edit6Higher = {
        ...edit6.updatedProblem,
        version: 4,
        serverConfirmedVersion: 1,
      };
      storage.saveStoredProblems(
        storage.loadStoredProblems().map((p) => (p.id === problemId6 ? edit6Higher : p))
      );
      storage.setInMemoryProblem(edit6Higher);
      const sync6 = storage.confirmProblemRevisionSynced(problemId6, { ...edit6.updatedProblem, version: 2 }, {
        revisionId: edit6.memoryRevision.revisionId,
        generation: edit6.memoryRevision.generation,
      });
      assert.equal(sync6.status, 'applied', 'Confirmed version 2 applied successfully even when local temp was 4 (> 2)');
      const prob6After = storage.loadStoredProblems().find((p) => p.id === problemId6);
      assert.equal(prob6After.version, 2, 'Problem version reconciled to server confirmed 2');
      assert.equal(prob6After.serverConfirmedVersion, 2);
      assert.equal(storage.detectLocalProblemVersionInconsistencies([prob6After]).length, 0, 'Zero version inconsistencies after confirming v2 from temp v4');

      // Check 7: Account scope mismatch and problem identity mismatch guards:
      const syncWrongScope = storage.confirmProblemRevisionSynced(problemId6, { ...prob6After, version: 3 }, {
        scopeId: 'user:different_account_scope',
      });
      assert.equal(syncWrongScope.status, 'stale_ignored', 'Mismatched scopeId ignored as stale_ignored');
      const syncWrongId = storage.confirmProblemRevisionSynced(problemId6, { ...prob6After, id: 'other-problem-id', version: 3 });
      assert.equal(syncWrongId.status, 'stale_ignored', 'Mismatched problemId ignored as stale_ignored');
      assert.equal(storage.loadStoredProblems().find((p) => p.id === problemId6).version, 2, 'Problem 6 unchanged after wrong scope/id');

      // Check 8: DashboardClient response path guard verification:
      let stateProblems = storage.loadStoredProblems();
      let stateUpdatedCount = 0;
      const simulateDashboardHandler = (outcome) => {
        if (outcome.status === 'stale_ignored' || outcome.status === 'conflict') {
          return false;
        }
        stateProblems = outcome.updatedProblems;
        stateUpdatedCount++;
        return true;
      };

      const lateOutcome = storage.confirmProblemRevisionSynced(problemId, serverProbA);
      const applied = simulateDashboardHandler(lateOutcome);
      assert.equal(applied, false, 'DashboardClient ignores stale response without calling setAllProblems');
      assert.equal(stateUpdatedCount, 0, 'UI state not updated by stale response');
      assert.ok(stateProblems, 'stateProblems is initialized');

      // Check 9: Isolated Two-Tab Delayed Response Inversion Scenario:
      const problemIdTab = 'prob-two-tab-latency-inversion';
      storage.saveStoredProblems([
        ...storage.loadStoredProblems(),
        {
          id: problemIdTab,
          subjectId: 'sub-stale-1',
          title: 'Problem Tab Base v1',
          promptText: 'Base prompt',
          type: 'logic_proof',
          conceptIds: ['c-stale'],
          hints: [],
          modelAnswer: 'base ans',
          rubric: [],
          timeStandardMinutes: 10,
          version: 1,
          serverConfirmedVersion: 1,
        },
      ]);

      const tab1EditA = storage.editAndReviseProblem(problemIdTab, { title: 'Tab 1 Edit A v2' }, 'Tab 1 reason');
      assert.equal(tab1EditA.success, true);

      const tab2EditB = storage.editAndReviseProblem(problemIdTab, { title: 'Tab 2 Edit B v3' }, 'Tab 2 reason');
      assert.equal(tab2EditB.success, true);

      const tab2ResponsePromise = Promise.resolve().then(() => {
        return storage.confirmProblemRevisionSynced(problemIdTab, {
          ...tab2EditB.updatedProblem,
          version: 3,
        }, {
          revisionId: tab2EditB.memoryRevision.revisionId,
          generation: tab2EditB.memoryRevision.generation,
        });
      });

      const tab1ResponsePromise = new Promise((resolve) => setTimeout(resolve, 30)).then(() => {
        return storage.confirmProblemRevisionSynced(problemIdTab, {
          ...tab1EditA.updatedProblem,
          version: 2,
        }, {
          revisionId: tab1EditA.memoryRevision.revisionId,
          generation: tab1EditA.memoryRevision.generation,
        });
      });

      const [outcomeTab2, outcomeTab1] = await Promise.all([tab2ResponsePromise, tab1ResponsePromise]);
      assert.equal(outcomeTab2.status, 'applied', 'Tab 2 fast response applied cleanly at v3');
      assert.equal(outcomeTab1.status, 'stale_ignored', 'Tab 1 delayed response ignored as stale without rolling back');
      const finalStoredTab = storage.loadStoredProblems().find((p) => p.id === problemIdTab);
      assert.equal(finalStoredTab.version, 3, 'Final stored version is 3');
      assert.equal(finalStoredTab.title, 'Tab 2 Edit B v3', 'Final stored title is Tab 2 Edit B');
      assert.equal(finalStoredTab.serverConfirmedVersion, 3, 'Final stored serverConfirmedVersion is 3');
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
    }
  });

  await checkAsync('Concurrency Bugs 1, 2 & 3: updateProblemQuality body protection, reviseProblem version-snapshot binding, and combined two-tab scenario', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'user_concurrency_bugs_123' });
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();

    try {
      // -----------------------------------------------------------------------
      // 1. Bug 1: sanitizeProblemQualityPatch & updateProblemQuality body protection
      // -----------------------------------------------------------------------
      const staleV1Problem = {
        id: 'prob-c1',
        subjectId: 'sub-c1',
        type: 'essay_descriptive',
        title: 'Title v1 STALE',
        promptText: 'Prompt v1 STALE',
        modelAnswer: 'ModelAnswer v1 STALE',
        rubric: [{ id: 'r1', description: 'Rubric v1 STALE', maxScore: 100 }],
        hints: ['Hint v1 STALE'],
        conceptIds: ['c-1'],
        version: 1,
        qualityStatus: 'reported',
        isOutdated: false,
        needsSourceReview: false,
        reports: [
          {
            id: 'rep-tab-a',
            problemId: 'prob-c1',
            type: 'typo_or_expression',
            details: 'Tab A typo report',
            createdAt: '2026-11-02T11:00:00.000Z',
            status: 'open',
          },
        ],
      };

      const sanitizedPatch = learningRepo.sanitizeProblemQualityPatch({
        qualityStatus: 'reported',
        addReport: staleV1Problem.reports[0],
        payload: staleV1Problem,
      });
      assert.equal(sanitizedPatch.promptText, undefined, 'sanitizeProblemQualityPatch strips promptText');
      assert.equal(sanitizedPatch.modelAnswer, undefined, 'sanitizeProblemQualityPatch strips modelAnswer');
      assert.equal(sanitizedPatch.rubric, undefined, 'sanitizeProblemQualityPatch strips rubric');
      assert.equal(sanitizedPatch.version, undefined, 'sanitizeProblemQualityPatch strips version');
      assert.equal(sanitizedPatch.title, undefined, 'sanitizeProblemQualityPatch strips title');
      assert.equal(sanitizedPatch.qualityStatus, 'reported', 'sanitizeProblemQualityPatch keeps qualityStatus');
      assert.equal(sanitizedPatch.addReport?.id, 'rep-tab-a', 'sanitizeProblemQualityPatch keeps addReport');

      const serverState = {
        row: {
          id: 'prob-c1',
          user_id: 'user_concurrency_bugs_123',
          subject_id: 'sub-c1',
          type: 'essay_descriptive',
          title: 'Title v2 LATEST',
          quality_status: 'review_after_edit',
          is_outdated: false,
          needs_source_review: false,
          version: 2,
          payload: {
            id: 'prob-c1',
            subjectId: 'sub-c1',
            type: 'essay_descriptive',
            title: 'Title v2 LATEST',
            promptText: 'Prompt v2 LATEST',
            modelAnswer: 'ModelAnswer v2 LATEST',
            rubric: [{ id: 'r1', description: 'Rubric v2 LATEST', maxScore: 100 }],
            hints: ['Hint v2 LATEST'],
            conceptIds: ['c-1'],
            version: 2,
            qualityStatus: 'review_after_edit',
            reports: [],
          },
          created_at: '2026-11-02T10:00:00.000Z',
          updated_at: '2026-11-02T10:30:00.000Z',
        },
        versions: [
          {
            problem_id: 'prob-c1',
            version: 1,
            snapshot: {
              version: 1,
              title: 'Title v1 STALE',
              promptText: 'Prompt v1 STALE',
              modelAnswer: 'ModelAnswer v1 STALE',
              rubric: [{ id: 'r1', description: 'Rubric v1 STALE', maxScore: 100 }],
              hints: ['Hint v1 STALE'],
              conceptIds: ['c-1'],
              type: 'essay_descriptive',
            },
          },
          {
            problem_id: 'prob-c1',
            version: 2,
            snapshot: {
              version: 2,
              title: 'Title v2 LATEST',
              promptText: 'Prompt v2 LATEST',
              modelAnswer: 'ModelAnswer v2 LATEST',
              rubric: [{ id: 'r1', description: 'Rubric v2 LATEST', maxScore: 100 }],
              hints: ['Hint v2 LATEST'],
              conceptIds: ['c-1'],
              type: 'essay_descriptive',
            },
          },
        ],
      };

      const fallbackMockSupabase = {
        rpc: async () => ({ data: null, error: { message: 'Could not find the function public.update_problem_quality' } }),
        from: (table) => {
          if (table === 'problems') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { ...serverState.row, payload: { ...serverState.row.payload } }, error: null }),
                }),
                in: async () => ({ data: [{ ...serverState.row, payload: { ...serverState.row.payload } }], error: null }),
              }),
              update: (upd) => ({
                eq: () => {
                  const applyUpdate = async () => {
                    serverState.row = {
                      ...serverState.row,
                      ...upd,
                      payload: { ...upd.payload },
                    };
                    return { data: { ...serverState.row }, error: null };
                  };
                  return {
                    eq: () => ({
                      select: () => ({
                        single: applyUpdate,
                        maybeSingle: applyUpdate,
                      }),
                    }),
                    select: () => ({
                      single: applyUpdate,
                      maybeSingle: applyUpdate,
                    }),
                  };
                },
              }),
              upsert: async () => {
                throw new Error('upsertProblems must not overwrite existing problem rows');
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };

      // Tab A calls updateProblemQuality with stale v1 payload + new report:
      const qualResA = await learningRepo.updateProblemQuality(fallbackMockSupabase, 'prob-c1', {
        qualityStatus: 'reported',
        addReport: staleV1Problem.reports[0],
        payload: staleV1Problem,
      });
      assert.equal(qualResA.ok, true, 'updateProblemQuality succeeds');
      assert.equal(qualResA.data.version, 2, 'Server problem version remains 2');
      assert.equal(qualResA.data.promptText, 'Prompt v2 LATEST', 'Server problem promptText remains v2 LATEST (never reverted to v1)');
      assert.equal(qualResA.data.modelAnswer, 'ModelAnswer v2 LATEST', 'Server modelAnswer remains v2 LATEST');
      assert.equal(qualResA.data.rubric[0].description, 'Rubric v2 LATEST', 'Server rubric remains v2 LATEST');
      assert.equal(qualResA.data.reports.length, 1, 'Tab A report added');
      assert.equal(qualResA.data.reports[0].id, 'rep-tab-a');

      // Retry of Tab A's report must be idempotent (no duplicate report):
      const qualResARetry = await learningRepo.updateProblemQuality(fallbackMockSupabase, 'prob-c1', {
        qualityStatus: 'reported',
        addReport: staleV1Problem.reports[0],
      });
      assert.equal(qualResARetry.ok, true);
      assert.equal(qualResARetry.data.reports.length, 1, 'Retried report is not duplicated');

      // Tab B concurrently adds another report: both reports must be preserved!
      const reportTabB = {
        id: 'rep-tab-b',
        problemId: 'prob-c1',
        type: 'grading_rubric_error',
        details: 'Tab B rubric report',
        createdAt: '2026-11-02T11:01:00.000Z',
        status: 'open',
      };
      const qualResB = await learningRepo.updateProblemQuality(fallbackMockSupabase, 'prob-c1', {
        qualityStatus: 'reported',
        addReport: reportTabB,
      });
      assert.equal(qualResB.ok, true);
      assert.equal(qualResB.data.reports.length, 2, 'Both Tab A and Tab B reports preserved');

      // Precondition mismatch on expectedVersion must fail with version_conflict:
      const qualConflict = await learningRepo.updateProblemQuality(fallbackMockSupabase, 'prob-c1', {
        qualityStatus: 'suspended',
        expectedVersion: 1,
      });
      assert.equal(qualConflict.ok, false, 'Mismatched expectedVersion rejected');
      assert.ok(qualConflict.error.includes('version_conflict'), 'Error code indicates version_conflict');

      // upsertProblems must skip existing problem IDs so full-payload upserts cannot overwrite server v2 with stale v1:
      const upsertRes = await learningRepo.upsertProblems(fallbackMockSupabase, [staleV1Problem]);
      assert.equal(upsertRes.ok, true, 'upsertProblems skips existing problems without overwriting');
      assert.equal(serverState.row.payload.promptText, 'Prompt v2 LATEST', 'Server v2 body untouched by upsertProblems');

      // -----------------------------------------------------------------------
      // 2. Bug 2: reviseProblem binds confirmedVersion to its exact snapshot
      //    even when another request advances the server to v3 before follow-up read
      // -----------------------------------------------------------------------
      const bug2ProbId = 'prob-c2-revise-race';
      const probV1 = {
        id: bug2ProbId,
        subjectId: 'sub-c1',
        type: 'essay_descriptive',
        title: 'Race v1',
        promptText: 'Prompt v1',
        modelAnswer: 'Answer v1',
        rubric: [{ id: 'r1', description: 'R1', maxScore: 100 }],
        hints: ['H1'],
        conceptIds: ['c-1'],
        timeStandardMinutes: 15,
        version: 1,
        serverConfirmedVersion: 1,
        qualityStatus: 'normal',
        reports: [],
      };
      storage.saveStoredProblems([probV1]);

      // Edit A locally (v1 -> v2)
      const editA = storage.editAndReviseProblem(bug2ProbId, {
        title: 'Race A v2',
        promptText: 'Prompt A v2',
        modelAnswer: 'Answer A v2',
      }, 'Edit A to v2');
      assert.equal(editA.success, true);
      const revA = editA.memoryRevision;

      // While A's request is in flight, user makes Edit B locally (v2 -> v3)
      const editB = storage.editAndReviseProblem(bug2ProbId, {
        title: 'Race B v3',
        promptText: 'Prompt B v3',
        modelAnswer: 'Answer B v3',
      }, 'Edit B to v3');
      assert.equal(editB.success, true);
      const revB = editB.memoryRevision;
      assert.equal(revB.baseVersion, 1, 'While A is unconfirmed, B starts with baseVersion 1 and revisionVersion 3');
      assert.equal(revB.revisionVersion, 3);

      const snapshotV2 = {
        version: 2,
        title: 'Race A v2',
        promptText: 'Prompt A v2',
        modelAnswer: 'Answer A v2',
        rubric: [{ id: 'r1', description: 'R1', maxScore: 100 }],
        hints: ['H1'],
        conceptIds: ['c-1'],
        type: 'essay_descriptive',
        timeStandardMinutes: 15,
      };
      const serverRowV3 = {
        id: bug2ProbId,
        user_id: 'user_concurrency_bugs_123',
        subject_id: 'sub-c1',
        type: 'essay_descriptive',
        title: 'Race B v3',
        quality_status: 'review_after_edit',
        is_outdated: false,
        needs_source_review: false,
        version: 3,
        payload: {
          ...probV1,
          title: 'Race B v3',
          promptText: 'Prompt B v3',
          modelAnswer: 'Answer B v3',
          version: 3,
          qualityStatus: 'review_after_edit',
        },
        created_at: '2026-11-02T10:00:00.000Z',
        updated_at: '2026-11-02T10:05:00.000Z',
      };

      const raceMockSupabase = {
        rpc: async (fnName) => {
          if (fnName === 'revise_problem_with_snapshot') {
            return { data: null, error: { message: 'Could not find the function public.revise_problem_with_snapshot' } };
          }
          if (fnName === 'revise_problem') {
            return { data: 2, error: null };
          }
          throw new Error(`Unexpected RPC ${fnName}`);
        },
        from: (table) => {
          if (table === 'problems') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: serverRowV3, error: null }),
                }),
              }),
            };
          }
          if (table === 'problem_versions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: (_col, ver) => ({
                    maybeSingle: async () => ({
                      data: ver === 2 ? { snapshot: snapshotV2 } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };

      const reviseResA = await learningRepo.reviseProblem(
        raceMockSupabase,
        bug2ProbId,
        1,
        editA.updatedProblem
      );
      assert.equal(reviseResA.ok, true, 'reviseProblem for A succeeds');
      assert.equal(reviseResA.confirmedVersion, 2, 'confirmedVersion is strictly bound to RPC return value 2');
      assert.equal(reviseResA.data.version, 2, 'reviseResA.data.version is 2 (NOT 3!)');
      assert.equal(reviseResA.data.promptText, 'Prompt A v2', 'reviseResA.data.promptText is A/v2 (NOT B/v3!)');
      assert.equal(reviseResA.serverAdvancedBeyondConfirmed, true, 'Detects that server row advanced beyond v2 to v3');
      assert.equal(reviseResA.latestServerProblem?.version, 3, 'Exposes latestServerProblem v3 separately');
      assert.equal(reviseResA.latestServerProblem?.promptText, 'Prompt B v3');

      const confirmAOutcome = storage.confirmProblemRevisionSynced(
        bug2ProbId,
        { ...reviseResA.data, version: reviseResA.confirmedVersion },
        {
          revisionId: revA.revisionId,
          generation: revA.generation,
          snapshotProblem: editA.updatedProblem,
          editReason: revA.editReason,
        }
      );
      assert.equal(confirmAOutcome.status, 'in_flight_advanced', 'Pending edit B is preserved and advanced, NOT deleted');
      assert.equal(confirmAOutcome.revisionCleared, false, 'Pending edit B is not cleared');
      const pendingBAfterA = storage.getUnsavedProblemRevision(bug2ProbId);
      assert.ok(pendingBAfterA, 'Pending edit B still exists in storage');
      assert.equal(pendingBAfterA.promptText, 'Prompt B v3', 'Pending edit B keeps its v3 promptText');
      assert.equal(pendingBAfterA.baseVersion, 2, 'Pending edit B baseVersion advanced to 2');
      assert.equal(pendingBAfterA.baseSnapshot.version, 2, 'Pending edit B baseSnapshot is v2');
      assert.equal(pendingBAfterA.baseSnapshot.promptText, 'Prompt A v2', 'Pending edit B baseSnapshot has A/v2 content (never polluted with B/v3)');

      const readFailMockSupabase = {
        rpc: async (fnName) => {
          if (fnName === 'revise_problem_with_snapshot') {
            return { data: null, error: { message: 'Could not find the function public.revise_problem_with_snapshot' } };
          }
          return { data: 2, error: null };
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'Network read timeout after commit' } }),
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: { message: 'Network read timeout after commit' } }),
              }),
            }),
          }),
        }),
      };
      const readFailRes = await learningRepo.reviseProblem(
        readFailMockSupabase,
        bug2ProbId,
        1,
        editA.updatedProblem
      );
      assert.equal(readFailRes.ok, true, 'RPC commit succeeded so reviseProblem returns ok: true');
      assert.equal(readFailRes.savedToServer, true, 'savedToServer is true');
      assert.equal(readFailRes.confirmedVersion, 2, 'confirmedVersion is 2');
      assert.equal(readFailRes.verificationStatus, 'verification_failed', 'Explicitly marks verification_failed when post-save read fails');
      assert.equal(readFailRes.data.version, 2);
      assert.equal(readFailRes.data.promptText, 'Prompt A v2');

      // -----------------------------------------------------------------------
      // 3. Combined Two-Tab Scenario:
      //    Tab 1 & Tab 2 perform overlapping body edits, quality reports, and delayed responses
      // -----------------------------------------------------------------------
      const combinedProbId = 'prob-combined-two-tab';
      storage.clearAllUnsavedProblemRevisions();
      storage.saveStoredProblems([
        {
          id: combinedProbId,
          subjectId: 'sub-c1',
          type: 'essay_descriptive',
          title: 'Combined v1',
          promptText: 'Combined Prompt v1',
          modelAnswer: 'Combined Answer v1',
          rubric: [{ id: 'r1', description: 'R1', maxScore: 100 }],
          hints: ['H1'],
          conceptIds: ['c-1'],
          timeStandardMinutes: 15,
          version: 1,
          serverConfirmedVersion: 1,
          qualityStatus: 'normal',
          reports: [],
        },
      ]);

      const combEditA = storage.editAndReviseProblem(combinedProbId, { promptText: 'Combined Prompt v2' }, 'Edit A');
      const combEditB = storage.editAndReviseProblem(combinedProbId, { promptText: 'Combined Prompt v3' }, 'Edit B');
      assert.equal(combEditA.success, true);
      assert.equal(combEditB.success, true);

      const combConfirmB = storage.confirmProblemRevisionSynced(
        combinedProbId,
        { ...combEditB.updatedProblem, version: 3 },
        {
          revisionId: combEditB.memoryRevision.revisionId,
          generation: combEditB.memoryRevision.generation,
        }
      );
      assert.equal(combConfirmB.status, 'applied');

      const serverAfterReport = {
        ...combEditB.updatedProblem,
        version: 3,
        qualityStatus: 'reported',
        reports: [
          {
            id: 'rep-combined-1',
            problemId: combinedProbId,
            type: 'condition_omission',
            details: 'Missing boundary condition',
            createdAt: '2026-11-02T12:00:00.000Z',
            status: 'open',
          },
        ],
      };
      const qualReconcile = storage.reconcileProblemQualitySynced(combinedProbId, serverAfterReport);
      assert.equal(qualReconcile.reconciled, true);

      const combLateA = storage.confirmProblemRevisionSynced(
        combinedProbId,
        { ...combEditA.updatedProblem, version: 2 },
        {
          revisionId: combEditA.memoryRevision.revisionId,
          generation: combEditA.memoryRevision.generation,
        }
      );
      assert.equal(combLateA.status, 'stale_ignored', 'Late v2 response is ignored');

      const finalCombined = storage.loadStoredProblems().find((p) => p.id === combinedProbId);
      assert.equal(finalCombined.version, 3, 'Final version is 3');
      assert.equal(finalCombined.serverConfirmedVersion, 3, 'Final serverConfirmedVersion is 3');
      assert.equal(finalCombined.promptText, 'Combined Prompt v3', 'Final promptText is v3');
      assert.equal(finalCombined.qualityStatus, 'reported', 'Quality status is reported');
      assert.equal(finalCombined.reports.length, 1, 'Report is preserved');
      assert.equal(finalCombined.reports[0].id, 'rep-combined-1');
      assert.equal(
        storage.detectLocalProblemVersionInconsistencies([finalCombined]).length,
        0,
        'Zero local version inconsistencies on finalCombined'
      );
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
    }
  });

  console.log(`${passed} concurrency regression checks passed`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));