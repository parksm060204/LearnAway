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
    'lib/dateUtils.ts',
    'lib/problemComparison.ts',
    'lib/storage.ts',
    'lib/storageScope.ts',
    'lib/cloud/types.ts',
    'lib/cloud/hash.ts',
    'lib/cloud/mappers.ts',
    'lib/cloud/learningMappers.ts',
    'lib/cloud/learningRepository.ts',
    'lib/cloud/mergeLearning.ts',
    'lib/problemRevisionSync.ts',
    'lib/serviceGuideContent.ts',
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
  let blockedSubstrings = [];
  const writeCounts = new Map();
  global.window = { localStorage: {} };
  global.localStorage = {
    setBlockedKeys: (keys) => {
      blockedSubstrings = Array.isArray(keys) ? keys : [];
    },
    resetWriteCounts: () => {
      writeCounts.clear();
    },
    getWriteCount: (keySubstring) => {
      let total = 0;
      for (const [k, count] of writeCounts.entries()) {
        if (k === keySubstring || k.endsWith(keySubstring)) {
          total += count;
        }
      }
      return total;
    },
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (blockedSubstrings.some((b) => key === b || key.endsWith(b))) {
        throw new Error(`QuotaExceededError: blocked write to ${key}`);
      }
      writeCounts.set(key, (writeCounts.get(key) || 0) + 1);
      data.set(key, String(value));
    },
    removeItem: (key) => {
      if (blockedSubstrings.some((b) => key === b || key.endsWith(b))) {
        throw new Error(`QuotaExceededError: blocked remove from ${key}`);
      }
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

      // Test adapter implementing `update_problem_quality` RPC (production code must never fall back to direct table `.update()`):
      const rpcMockSupabase = {
        rpc: async (fnName, args) => {
          if (fnName !== 'update_problem_quality') {
            return { data: null, error: { code: '42883', message: `Could not find the function public.${fnName}` } };
          }
          const { p_problem_id: id, p_patch: patch } = args;
          if (id !== serverState.row.id) {
            return { data: null, error: { message: 'PROBLEM_NOT_FOUND' } };
          }
          if (typeof patch.expectedVersion === 'number' && serverState.row.version !== patch.expectedVersion) {
            return { data: null, error: { message: 'VERSION_CONFLICT' } };
          }
          if (typeof patch.expectedUpdatedAt === 'string' && serverState.row.updated_at !== patch.expectedUpdatedAt) {
            return { data: null, error: { message: 'VERSION_CONFLICT' } };
          }
          const currentPayload = { ...serverState.row.payload };
          const existingReports = Array.isArray(currentPayload.reports) ? currentPayload.reports : [];
          if (patch.dismissReport && !existingReports.some((r) => r.id === patch.dismissReport.reportId)) {
            return { data: null, error: { message: 'REPORT_NOT_FOUND' } };
          }
          const mergedReports = learningRepo.mergeProblemReportsAtomically(existingReports, patch);
          const hasOpenReports = mergedReports.some((r) => r.status === 'open' || r.status === 'under_review');
          let nextStatus = serverState.row.quality_status ?? 'normal';
          if (patch.addReport) {
            nextStatus = serverState.row.quality_status === 'under_review' ? 'under_review' : 'reported';
          } else if (patch.dismissReport) {
            nextStatus = hasOpenReports
              ? serverState.row.quality_status === 'under_review'
                ? 'under_review'
                : 'reported'
              : serverState.row.version > 1
                ? 'reapproved'
                : 'normal';
          } else if (typeof patch.qualityStatus === 'string' && patch.qualityStatus) {
            nextStatus = patch.qualityStatus;
          }
          const nextOutdated =
            typeof patch.isOutdated === 'boolean' ? patch.isOutdated : serverState.row.is_outdated;
          const nextNeedsReview =
            typeof patch.needsSourceReview === 'boolean'
              ? patch.needsSourceReview
              : serverState.row.needs_source_review;
          const safePayload = {
            ...currentPayload,
            version: serverState.row.version,
            qualityStatus: nextStatus,
            isOutdated: nextOutdated,
            needsSourceReview: nextNeedsReview,
            reports: mergedReports,
          };
          serverState.row = {
            ...serverState.row,
            quality_status: nextStatus,
            is_outdated: nextOutdated,
            needs_source_review: nextNeedsReview,
            payload: safePayload,
          };
          return { data: { ...serverState.row, payload: { ...serverState.row.payload } }, error: null };
        },
        from: (table) => {
          if (table === 'problems') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { ...serverState.row, payload: { ...serverState.row.payload } }, error: null }),
                }),
                in: async () => ({ data: [{ ...serverState.row, payload: { ...serverState.row.payload } }], error: null }),
              }),
              update: () => {
                throw new Error('updateProblemQuality must NOT fall back to direct problems.update()');
              },
              upsert: async () => {
                throw new Error('upsertProblems must not overwrite existing problem rows');
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };

      // Tab A calls updateProblemQuality with stale v1 payload + new report:
      const qualResA = await learningRepo.updateProblemQuality(rpcMockSupabase, 'prob-c1', {
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
      const qualResARetry = await learningRepo.updateProblemQuality(rpcMockSupabase, 'prob-c1', {
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
      const qualResB = await learningRepo.updateProblemQuality(rpcMockSupabase, 'prob-c1', {
        qualityStatus: 'reported',
        addReport: reportTabB,
      });
      assert.equal(qualResB.ok, true);
      assert.equal(qualResB.data.reports.length, 2, 'Both Tab A and Tab B reports preserved');

      // Precondition mismatch on expectedVersion must fail with version_conflict:
      const qualConflict = await learningRepo.updateProblemQuality(rpcMockSupabase, 'prob-c1', {
        qualityStatus: 'suspended',
        expectedVersion: 1,
      });
      assert.equal(qualConflict.ok, false, 'Mismatched expectedVersion rejected');
      assert.ok(qualConflict.error.includes('version_conflict'), 'Error code indicates version_conflict');

      // Missing RPC in production must fail safely with not_configured and NEVER call direct .from('problems').update():
      let directUpdateCalled = false;
      const missingRpcSupabase = {
        rpc: async () => ({
          data: null,
          error: { code: '42883', message: 'Could not find the function public.update_problem_quality' },
        }),
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                directUpdateCalled = true;
                return { data: serverState.row, error: null };
              },
            }),
          }),
          update: () => {
            directUpdateCalled = true;
            throw new Error('Direct update fallback must not be called when RPC is missing');
          },
        }),
      };
      const missingRpcRes = await learningRepo.updateProblemQuality(missingRpcSupabase, 'prob-c1', {
        qualityStatus: 'suspended',
      });
      assert.equal(missingRpcRes.ok, false, 'Missing update_problem_quality RPC fails safely');
      assert.ok(missingRpcRes.error.startsWith('not_configured:'), 'Missing RPC returns not_configured error code');
      assert.equal(directUpdateCalled, false, 'Direct problems table fallback is never executed');

      // upsertProblems must skip existing problem IDs so full-payload upserts cannot overwrite server v2 with stale v1:
      const upsertRes = await learningRepo.upsertProblems(rpcMockSupabase, [staleV1Problem]);
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
            return {
              data: {
                confirmedVersion: 2,
                confirmedSnapshot: snapshotV2,
                problemRow: serverRowV3,
              },
              error: null,
            };
          }
          throw new Error(`Unexpected RPC ${fnName}`);
        },
        from: () => {
          throw new Error('Atomic revise_problem_with_snapshot must not issue redundant follow-up queries when snapshot and problemRow are returned');
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
            return { data: { confirmedVersion: 2 }, error: null };
          }
          throw new Error(`Unexpected RPC ${fnName}`);
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
      assert.equal(readFailRes.outcome, 'verification_failed', 'Discriminated outcome is verification_failed');
      assert.equal(readFailRes.ok, false, 'Post-save read failure sets ok: false so callers cannot treat it as verified completion');
      assert.equal(readFailRes.savedToServer, true, 'savedToServer is true');
      assert.equal(readFailRes.contentVerified, false, 'contentVerified is false');
      assert.equal(readFailRes.confirmedVersion, 2, 'confirmedVersion is 2');
      assert.equal(readFailRes.verificationStatus, 'verification_failed', 'Explicitly marks verification_failed when post-save read fails');
      assert.equal(readFailRes.verificationFailureReason, 'read_error');
      assert.equal(readFailRes.data, undefined, 'Does not expose unverified request-derived data');

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

  await checkAsync('service guide modal content, policy draft metadata, and accessibility integration', async () => {
    const serviceGuide = load(path.join(output, 'lib/serviceGuideContent.js'));

    // 1. Verify section IDs and order
    assert.deepEqual(
      serviceGuide.SERVICE_GUIDE_SECTION_ORDER,
      ['overview', 'terms', 'privacy', 'ai', 'storage'],
      'Section order must match overview, terms, privacy, ai, storage'
    );
    assert.equal(serviceGuide.isServiceGuideSection('overview'), true);
    assert.equal(serviceGuide.isServiceGuideSection('terms'), true);
    assert.equal(serviceGuide.isServiceGuideSection('privacy'), true);
    assert.equal(serviceGuide.isServiceGuideSection('ai'), true);
    assert.equal(serviceGuide.isServiceGuideSection('storage'), true);
    assert.equal(serviceGuide.isServiceGuideSection('unknown'), false);

    // 2. Verify unconfirmed policy metadata is strictly draft/null without fake placeholders
    const meta = serviceGuide.SERVICE_POLICY_METADATA;
    assert.equal(meta.status, 'draft');
    assert.equal(meta.statusBadgeLabel, '안내 초안 · 운영 정보 확인 중');
    assert.equal(meta.operatorName, null);
    assert.equal(meta.contactEmail, null);
    assert.equal(meta.privacyRightsContact, null);
    assert.equal(meta.effectiveDate, null);
    assert.equal(meta.documentVersion, null);
    assert.equal(meta.hostingProviderAndRegion, null);
    assert.equal(meta.retentionScheduleConfirmed, false);

    // 3. Verify document titles and summaries
    const docs = serviceGuide.SERVICE_GUIDE_DOCUMENTS;
    assert.equal(docs.overview.title, '서비스 소개');
    assert.equal(
      docs.overview.summary,
      '강의 자료를 이해하고, 시험 수준의 문제를 풀며, 복습을 이어가는 학습 도구입니다.'
    );
    assert.equal(docs.terms.title, '이용약관');
    assert.equal(docs.terms.isDraftPolicy, true);
    assert.equal(docs.privacy.title, '개인정보 처리 안내');
    assert.equal(docs.privacy.isDraftPolicy, true);
    assert.equal(docs.ai.title, 'AI 이용 안내');
    assert.equal(docs.ai.isDraftPolicy, true);
    assert.equal(docs.storage.title, '저장 및 백업');
    assert.equal(docs.storage.isDraftPolicy, true);

    // 4. Verify required core sentences and absence of placeholder tokens like [운영자명]
    const serializedDocs = JSON.stringify(docs);
    assert.ok(
      serializedDocs.includes(
        '자료를 이 기기에 보관하는 설정과 AI 분석을 위한 전송은 별개입니다. 로컬 보관 자료라도 AI 기능을 실행하면 필요한 내용이 외부 처리 경로로 전송될 수 있습니다.'
      ),
      'AI guide must contain exact local-storage vs AI-transmission notice'
    );
    assert.ok(
      !serializedDocs.includes('[운영자명]'),
      'Policy documents must not expose unreplaced placeholder tokens like [운영자명]'
    );
    assert.ok(
      docs.overview.blocks[1].orderedItems.length === 7,
      'Overview must describe the 7-step learning workflow'
    );
    assert.ok(
      serviceGuide.VERIFIED_EXTERNAL_PROCESSING_ENTRIES.length >= 6,
      'Privacy guide must list the verified external processing paths'
    );

    // 5. Verify ServiceGuideModal and GatewayPage integration & accessibility guards
    const modalSrc = fs.readFileSync(path.join(root, 'components/ServiceGuideModal.tsx'), 'utf8');
    const gatewaySrc = fs.readFileSync(path.join(root, 'components/GatewayPage.tsx'), 'utf8');
    const checklistSrc = fs.readFileSync(
      path.join(root, 'docs/service-policy-publication-checklist.md'),
      'utf8'
    );

    assert.ok(modalSrc.includes('role="dialog"'), 'Modal must declare role="dialog"');
    assert.ok(modalSrc.includes('aria-modal="true"'), 'Modal must declare aria-modal="true"');
    assert.ok(modalSrc.includes("event.key === 'Escape'"), 'Modal must close on Escape');
    assert.ok(modalSrc.includes("event.key === 'Tab'"), 'Modal must trap Tab focus');
    assert.ok(
      modalSrc.includes('bodyScrollRef.current.scrollTop = 0'),
      'Modal must reset body scroll position on section switch'
    );
    assert.ok(
      !modalSrc.includes('동의하고 시작'),
      'Modal close button must not be labeled 동의하고 시작'
    );
    assert.ok(
      !modalSrc.includes('fetch('),
      'ServiceGuideModal must not trigger network, AI, or deletion calls while reading'
    );

    assert.ok(
      gatewaySrc.includes("openServiceGuide('overview')"),
      'Header 서비스 안내 button must open overview section'
    );
    assert.ok(
      gatewaySrc.includes("openServiceGuide('terms')"),
      '이용약관 quick link must open terms section'
    );
    assert.ok(
      gatewaySrc.includes("openServiceGuide('privacy')"),
      '개인정보 처리 안내 quick link must open privacy section'
    );
    assert.ok(
      checklistSrc.includes('SERVICE_POLICY_METADATA'),
      'Publication checklist must document SERVICE_POLICY_METADATA fields'
    );
  });

  await checkAsync('Items 1, 2, 3 & 4: Rubric JSONB key-order independence, unified problem comparison, atomic revise_problem_with_snapshot, and post-save verification separation', async () => {
    const problemComp = load(path.join(output, 'lib/problemComparison.js'));

    // 1. Explicit array ordering policy
    assert.deepEqual(
      problemComp.PROBLEM_ARRAY_ORDER_POLICY,
      {
        rubric: 'ordered',
        hints: 'ordered',
        conceptIds: 'unordered',
      },
      'Array ordering policy must explicitly specify rubric/hints as ordered and conceptIds as unordered'
    );

    const baseProblem = {
      id: 'prob-rubric-key-order-1',
      subjectId: 'sub-math-1',
      type: 'proof_counterexample',
      conceptIds: ['concept-a', 'concept-b'],
      title: '코시-슈바르츠 부등식 증명',
      promptText: '내적공간에서 코시-슈바르츠 부등식을 증명하시오.',
      appliedConditionNote: '실수 내적공간 가정',
      mathFormula: '|<u, v>| <= ||u|| ||v||',
      codeSnippet: '    def check_equality(u, v):\n        return True',
      modelAnswer: '임의의 실수 t에 대해 ||u - tv||^2 >= 0 성질을 이용한다.',
      hints: ['||u - tv||^2 전개', '판별식 D <= 0 적용'],
      rubric: [
        {
          id: 'r1',
          label: '내적의 양의 정부호성 설정',
          maxScore: 40,
          weight: 0.4,
          description: '||u - tv||^2 >= 0 식을 정확히 세움',
        },
        {
          id: 'r2',
          label: '판별식 전개 및 결론 도출',
          maxScore: 60,
          weight: 0.6,
          description: 't에 대한 이차부등식의 판별식 D <= 0으로부터 결론 도출',
        },
      ],
      timeStandardMinutes: 20,
      designIntent: '내적공간의 공리와 이차형식 판별식 연결 확인',
      version: 2,
    };

    // Simulate PostgreSQL JSONB key reordering (sorted by key length then ASCII order):
    // In Postgres JSONB, keys of r1/r2 come back as: id (2), label (5), weight (6), maxScore (8), description (11)
    const jsonbReorderedRubric = [
      {
        id: 'r1',
        label: '내적의 양의 정부호성 설정',
        weight: 0.4,
        maxScore: 40,
        description: '||u - tv||^2 >= 0 식을 정확히 세움',
      },
      {
        id: 'r2',
        label: '판별식 전개 및 결론 도출',
        weight: 0.6,
        maxScore: 60,
        description: 't에 대한 이차부등식의 판별식 D <= 0으로부터 결론 도출',
      },
    ];
    // Note that raw JSON.stringify differs because of key order:
    assert.notEqual(
      JSON.stringify(baseProblem.rubric),
      JSON.stringify(jsonbReorderedRubric),
      'Precondition: raw JSON.stringify differs when JSONB reorders object keys'
    );

    const jsonbSnapshot = {
      version: 2,
      title: baseProblem.title,
      promptText: baseProblem.promptText,
      type: baseProblem.type,
      conceptIds: ['concept-b', 'concept-a'], // unordered set
      appliedConditionNote: baseProblem.appliedConditionNote,
      mathFormula: baseProblem.mathFormula,
      codeSnippet: baseProblem.codeSnippet,
      timeStandardMinutes: baseProblem.timeStandardMinutes,
      hints: [...baseProblem.hints],
      modelAnswer: baseProblem.modelAnswer,
      rubric: jsonbReorderedRubric,
      editedAt: '2026-11-10T06:00:00.000Z',
    };

    // Key order difference alone MUST match across all comparison functions!
    assert.equal(problemComp.rubricsEqual(baseProblem.rubric, jsonbReorderedRubric), true);
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, jsonbSnapshot),
      true,
      'snapshotEvaluationMatchesProblem must ignore JSONB key order and conceptIds order'
    );
    assert.equal(
      problemComp.getProblemEvaluationSignature(baseProblem),
      problemComp.getProblemEvaluationSignature({ ...baseProblem, rubric: jsonbReorderedRubric, conceptIds: ['concept-b', 'concept-a'] }),
      'getProblemEvaluationSignature must be invariant to rubric key order and conceptIds order'
    );
    assert.equal(
      problemComp.isRevisionMatchingProblem({ ...baseProblem, rubric: jsonbReorderedRubric }, baseProblem),
      true,
      'isRevisionMatchingProblem must match when rubric key order differs'
    );

    // Meaningful changes in rubric description, maxScore, weight, label, or array order MUST be detected:
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        rubric: [
          { ...jsonbReorderedRubric[0], description: '변경된 채점 기준 설명' },
          jsonbReorderedRubric[1],
        ],
      }),
      false,
      'Detects rubric description change'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        rubric: [
          { ...jsonbReorderedRubric[0], maxScore: 50 },
          { ...jsonbReorderedRubric[1], maxScore: 50 },
        ],
      }),
      false,
      'Detects rubric maxScore change'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        rubric: [
          { ...jsonbReorderedRubric[0], weight: 0.5 },
          { ...jsonbReorderedRubric[1], weight: 0.5 },
        ],
      }),
      false,
      'Detects rubric weight change'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        rubric: [jsonbReorderedRubric[1], jsonbReorderedRubric[0]],
      }),
      false,
      'Detects rubric array order change'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        hints: [baseProblem.hints[1], baseProblem.hints[0]],
      }),
      false,
      'Detects hints array order change'
    );

    // Code indentation changes (including leading spaces on line 1) MUST be detected:
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        codeSnippet: '  def check_equality(u, v):\n        return True', // 2 leading spaces on line 1 instead of 4
      }),
      false,
      'Detects leading indentation change on line 1 of codeSnippet'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {
        ...jsonbSnapshot,
        codeSnippet: '    def check_equality(u, v):\n    return True', // 4 spaces on line 2 instead of 8
      }),
      false,
      'Detects internal indentation change on line 2 of codeSnippet'
    );

    // Incomplete snapshots must NEVER be treated as matching:
    assert.equal(problemComp.isCompleteProblemSnapshot({}), false);
    assert.equal(problemComp.isCompleteProblemSnapshot({ version: 2 }), false);
    assert.equal(
      problemComp.isCompleteProblemSnapshot({
        title: baseProblem.title,
        promptText: baseProblem.promptText,
        modelAnswer: baseProblem.modelAnswer,
        // missing rubric array
      }),
      false
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, {}),
      false,
      'Empty snapshot {} must NOT match'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, { version: 2 }),
      false,
      'Incomplete snapshot { version: 2 } must NOT match'
    );

    // Atomic revise_problem_with_snapshot return path:
    // 1) Succeeds with JSONB-reordered rubric and issues ZERO follow-up table queries when atomic payload is complete
    let followUpTableQueried = false;
    const atomicSuccessSupabase = {
      rpc: async (fnName, args) => {
        assert.equal(fnName, 'revise_problem_with_snapshot');
        assert.equal(args.p_problem_id, baseProblem.id);
        assert.equal(args.p_expected_version, 1);
        return {
          data: {
            confirmedVersion: 2,
            confirmedSnapshot: jsonbSnapshot,
            problemRow: {
              id: baseProblem.id,
              user_id: 'user-atomic-1',
              subject_id: baseProblem.subjectId,
              type: baseProblem.type,
              title: baseProblem.title,
              quality_status: 'review_after_edit',
              is_outdated: false,
              needs_source_review: false,
              version: 2,
              payload: {
                ...baseProblem,
                rubric: jsonbReorderedRubric,
                version: 2,
              },
              created_at: '2026-11-10T05:00:00.000Z',
              updated_at: '2026-11-10T06:00:00.000Z',
            },
          },
          error: null,
        };
      },
      from: () => {
        followUpTableQueried = true;
        throw new Error('Should not query tables when revise_problem_with_snapshot returns atomic snapshot and row');
      },
    };
    const atomicRes = await learningRepo.reviseProblem(atomicSuccessSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(atomicRes.ok, true);
    assert.equal(atomicRes.savedToServer, true);
    assert.equal(atomicRes.confirmedVersion, 2);
    assert.equal(atomicRes.verificationStatus, 'verified_current');
    assert.equal(followUpTableQueried, false, 'Zero redundant follow-up queries on atomic return');

    // 2) When RPC succeeds (savedToServer: true) but snapshot is incomplete or mismatched,
    //    report savedToServer: true and verificationStatus: 'verification_failed' (NOT savedToServer: false / VERSION_CONFLICT!)
    const incompleteSnapSupabase = {
      rpc: async () => ({
        data: {
          confirmedVersion: 2,
          confirmedSnapshot: { version: 2 }, // incomplete snapshot
          problemRow: {
            id: baseProblem.id,
            user_id: 'user-atomic-1',
            subject_id: baseProblem.subjectId,
            type: baseProblem.type,
            title: baseProblem.title,
            quality_status: 'review_after_edit',
            is_outdated: false,
            needs_source_review: false,
            version: 2,
            payload: { ...baseProblem, version: 2 },
            created_at: '2026-11-10T05:00:00.000Z',
            updated_at: '2026-11-10T06:00:00.000Z',
          },
        },
        error: null,
      }),
    };
    const incompleteSnapRes = await learningRepo.reviseProblem(incompleteSnapSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(incompleteSnapRes.outcome, 'verification_failed');
    assert.equal(incompleteSnapRes.ok, false, 'Incomplete snapshot verification_failed must set ok: false');
    assert.equal(incompleteSnapRes.savedToServer, true, 'savedToServer is true even when snapshot verification fails');
    assert.equal(incompleteSnapRes.contentVerified, false);
    assert.equal(incompleteSnapRes.confirmedVersion, 2);
    assert.equal(incompleteSnapRes.verificationStatus, 'verification_failed');
    assert.equal(incompleteSnapRes.verificationFailureReason, 'snapshot_incomplete');
    assert.ok(incompleteSnapRes.verificationError, 'Provides verificationError reason');
    assert.equal(incompleteSnapRes.data, undefined, 'Must never fabricate data from request when snapshot is incomplete');

    // 3) Invalid RPC return value (missing/zero confirmedVersion) must NEVER guess expectedVersion + 1:
    const badReturnSupabase = {
      rpc: async () => ({ data: {}, error: null }),
    };
    const badReturnRes = await learningRepo.reviseProblem(badReturnSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(badReturnRes.ok, false, 'Invalid RPC return value must fail');
    assert.equal(badReturnRes.savedToServer, false);
    assert.ok(badReturnRes.error.startsWith('invalid_rpc_response:'), 'Marks invalid_rpc_response instead of guessing expectedVersion + 1');

    // 4) Unapplied RPC or permission error must be classified as not_configured / forbidden:
    const unappliedRpcSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: '42883', message: 'Could not find the function public.revise_problem_with_snapshot' },
      }),
    };
    const unappliedRes = await learningRepo.reviseProblem(unappliedRpcSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(unappliedRes.ok, false);
    assert.equal(unappliedRes.savedToServer, false);
    assert.ok(unappliedRes.error.startsWith('not_configured:'));

    const forbiddenRpcSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: '42501', message: 'permission denied for function revise_problem_with_snapshot' },
      }),
    };
    const forbiddenRes = await learningRepo.reviseProblem(forbiddenRpcSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(forbiddenRes.ok, false);
    assert.equal(forbiddenRes.savedToServer, false);
    assert.ok(forbiddenRes.error.startsWith('forbidden:'));

    // 5) Real PGlite RPC save -> problem_versions snapshot query -> learningRepo.reviseProblem judgment
    const savedWindow = global.window;
    delete global.window;
    let pg;
    try {
      const { PGlite } = await import('@electric-sql/pglite');
      pg = new PGlite();
      await pg.waitReady;
    } finally {
      global.window = savedWindow;
    }
    await pg.exec(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;
      create schema if not exists auth;
      create schema if not exists storage;
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
        raw_user_meta_data jsonb default '{}'::jsonb,
        created_at timestamptz default now()
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      create or replace function auth.role() returns text language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $$;
      create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, created_at timestamptz default now());
      create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/'); $$;
      create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]; $$;
      create or replace function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', 2); $$;
      create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on all functions in schema auth to anon, authenticated, service_role;
    `);
    const migDir = path.join(root, 'supabase/migrations');
    const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    for (const mf of migFiles) {
      const sql = fs
        .readFileSync(path.join(migDir, mf), 'utf8')
        .replace(/create extension if not exists ["']pgcrypto["'];?/gi, '-- pgcrypto');
      await pg.exec(sql);
    }
    const pgUserId = '99999999-9999-9999-9999-999999999999';
    await pg.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'pg@example.com', '{"auth_type":"email"}'::jsonb);`,
      [pgUserId]
    );
    await pg.exec(`
      select set_config('request.jwt.claim.sub', '${pgUserId}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    await pg.query(
      `insert into public.subjects (id, user_id, name, code, timezone) values ($1, $2, '해석학', '2026-MATH-99', 'Asia/Seoul');`,
      [baseProblem.subjectId, pgUserId]
    );
    for (const cid of baseProblem.conceptIds) {
      await pg.query(
        `insert into public.concepts (id, user_id, subject_id, title) values ($1, $2, $3, $4);`,
        [cid, pgUserId, baseProblem.subjectId, cid]
      );
    }
    const v1Problem = { ...baseProblem, version: 1, title: '초기 제목 v1' };
    await pg.query(
      `insert into public.problems (id, user_id, subject_id, type, title, quality_status, version, payload)
       values ($1, $2, $3, $4, $5, 'normal', 1, $6::jsonb);`,
      [baseProblem.id, pgUserId, baseProblem.subjectId, baseProblem.type, v1Problem.title, JSON.stringify(v1Problem)]
    );

    // Supabase adapter backed by live PGlite instance
    const pgliteSupabase = {
      rpc: async (fnName, args) => {
        if (fnName === 'revise_problem_with_snapshot') {
          const r = await pg.query(
            `select public.revise_problem_with_snapshot($1, $2, $3::jsonb) as res;`,
            [args.p_problem_id, args.p_expected_version, JSON.stringify(args.p_problem)]
          );
          return { data: r.rows[0].res, error: null };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      },
      from: (table) => {
        if (table === 'problem_versions') {
          return {
            select: () => ({
              eq: (_col1, pid) => ({
                eq: (_col2, ver) => ({
                  maybeSingle: async () => {
                    const r = await pg.query(
                      `select * from public.problem_versions where problem_id = $1 and version = $2 limit 1;`,
                      [pid, ver]
                    );
                    return { data: r.rows[0] ?? null, error: null };
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'problems') {
          return {
            select: () => ({
              eq: (_col, pid) => ({
                maybeSingle: async () => {
                  const r = await pg.query(`select * from public.problems where id = $1 limit 1;`, [pid]);
                  return { data: r.rows[0] ?? null, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const pgReviseRes = await learningRepo.reviseProblem(pgliteSupabase, baseProblem.id, 1, baseProblem);
    assert.equal(pgReviseRes.ok, true, 'Real PGlite reviseProblem succeeds without false VERSION_CONFLICT');
    assert.equal(pgReviseRes.savedToServer, true);
    assert.equal(pgReviseRes.confirmedVersion, 2);
    assert.equal(pgReviseRes.verificationStatus, 'verified_current');

    // Also query snapshot via getProblemVersionSnapshot and verify snapshotEvaluationMatchesProblem
    const pgSnapRes = await learningRepo.getProblemVersionSnapshot(pgliteSupabase, baseProblem.id, 2);
    assert.equal(pgSnapRes.ok, true);
    assert.ok(pgSnapRes.data);
    assert.notEqual(
      JSON.stringify(baseProblem.rubric),
      JSON.stringify(pgSnapRes.data.rubric),
      'PostgreSQL JSONB reordered rubric keys in problem_versions'
    );
    assert.equal(
      problemComp.snapshotEvaluationMatchesProblem(baseProblem, pgSnapRes.data),
      true,
      'snapshotEvaluationMatchesProblem matches real PGlite JSONB snapshot'
    );
    await pg.close();
  });

  await checkAsync('Item 5: Exam schedule date and time are extracted and round-tripped consistently in Asia/Seoul across timezones', async () => {
    const dateUtils = load(path.join(output, 'lib/dateUtils.js'));

    // Verify ExamScheduleModal.tsx no longer uses browser-local toTimeString()
    const examModalSrc = fs.readFileSync(path.join(root, 'components/ExamScheduleModal.tsx'), 'utf8');
    assert.ok(!examModalSrc.includes('toTimeString('), 'ExamScheduleModal.tsx must not use browser-local toTimeString()');
    assert.ok(examModalSrc.includes('extractSeoulExamSchedule'), 'ExamScheduleModal.tsx must use extractSeoulExamSchedule');
    assert.ok(examModalSrc.includes('buildSeoulIsoTimestamp'), 'ExamScheduleModal.tsx must use buildSeoulIsoTimestamp');

    // Test cases in Asia/Seoul (+09:00) and their UTC equivalents (as returned by Supabase timestamptz)
    const testCases = [
      {
        label: 'Seoul 10:00 standard exam',
        seoulIso: '2026-10-20T10:00:00+09:00',
        utcIso: '2026-10-20T01:00:00.000Z',
        expectedDate: '2026-10-20',
        expectedTime: '10:00',
      },
      {
        label: 'Seoul 00:00 midnight boundary (previous day 15:00 in UTC / 08:00 in LA)',
        seoulIso: '2026-10-20T00:00:00+09:00',
        utcIso: '2026-10-19T15:00:00.000Z',
        expectedDate: '2026-10-20',
        expectedTime: '00:00',
      },
      {
        label: 'Seoul 12:00 noon boundary',
        seoulIso: '2026-10-20T12:00:00+09:00',
        utcIso: '2026-10-20T03:00:00.000Z',
        expectedDate: '2026-10-20',
        expectedTime: '12:00',
      },
      {
        label: 'Seoul 23:55 end-of-day boundary',
        seoulIso: '2026-10-20T23:55:00+09:00',
        utcIso: '2026-10-20T14:55:00.000Z',
        expectedDate: '2026-10-20',
        expectedTime: '23:55',
      },
    ];

    // Empty / unset date handling
    assert.equal(dateUtils.toSeoulDateString(''), '');
    assert.equal(dateUtils.toSeoulTimeString(''), '');
    assert.equal(dateUtils.buildSeoulIsoTimestamp(''), '');
    assert.deepEqual(dateUtils.extractSeoulExamSchedule(undefined, undefined), {
      dateStr: '',
      startTime: '10:00',
      endTime: '12:00',
    });

    // Spawn child node processes with TZ=Asia/Seoul, TZ=UTC, and TZ=America/Los_Angeles
    // to verify 100% identical extraction and round-trip regardless of runtime local timezone!
    const timezones = ['Asia/Seoul', 'UTC', 'America/Los_Angeles'];
    const dateUtilsPath = path.join(output, 'lib/dateUtils.js');

    for (const tz of timezones) {
      const childScript = `
        const assert = require('node:assert/strict');
        const dateUtils = require(${JSON.stringify(dateUtilsPath)});
        const cases = ${JSON.stringify(testCases)};
        for (const c of cases) {
          for (const inputIso of [c.seoulIso, c.utcIso]) {
            const extracted = dateUtils.extractSeoulExamSchedule(inputIso, '12:00');
            assert.equal(extracted.dateStr, c.expectedDate, \`[\${process.env.TZ}] \${c.label} dateStr mismatch for \${inputIso}\`);
            assert.equal(extracted.startTime, c.expectedTime, \`[\${process.env.TZ}] \${c.label} startTime mismatch for \${inputIso}\`);
            const rebuiltIso = dateUtils.buildSeoulIsoTimestamp(extracted.dateStr, extracted.startTime);
            assert.equal(rebuiltIso, c.seoulIso, \`[\${process.env.TZ}] \${c.label} rebuiltIso mismatch\`);
            assert.equal(
              new Date(rebuiltIso).getTime(),
              new Date(inputIso).getTime(),
              \`[\${process.env.TZ}] \${c.label} epoch timestamp must be preserved identically on open+save\`
            );
          }
        }
      `;
      const tzRun = spawnSync(process.execPath, ['-e', childScript], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      });
      if (tzRun.status !== 0) {
        throw new Error(`Timezone check failed for TZ=${tz}: ${tzRun.stdout}\n${tzRun.stderr}`);
      }
    }
  });

  await checkAsync('Reproduction & Verification Failure Recovery: MY EDIT vs SERVER DIFFERENT must never be marked synced or delete protected revision', async () => {
    storageScope.setStorageScope({ kind: 'user', userId: 'user_verif_fail_repro' });
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();
    try {
      const probId = 'prob-verif-fail-repro';
      const probV1 = {
        id: probId,
        subjectId: 'sub-verif-1',
        type: 'essay_descriptive',
        title: 'Original v1',
        promptText: 'Original prompt v1',
        modelAnswer: 'Original answer v1',
        rubric: [{ id: 'r1', label: '기준', maxScore: 100, weight: 1, description: 'Original rubric' }],
        hints: ['H1'],
        conceptIds: ['c-1'],
        timeStandardMinutes: 15,
        version: 1,
        serverConfirmedVersion: 1,
        qualityStatus: 'normal',
        reports: [],
      };
      storage.saveStoredProblems([probV1]);

      const localEdit = storage.editAndReviseProblem(
        probId,
        {
          title: 'MY EDIT',
          promptText: 'MY EDIT',
          modelAnswer: 'MY EDIT answer',
        },
        'My local edit'
      );
      assert.equal(localEdit.success, true);
      const revBefore = storage.getEffectiveUnsavedProblemRevision(probId);
      assert.ok(revBefore);
      assert.equal(revBefore.promptText, 'MY EDIT');

      const mismatchSupabase = {
        rpc: async () => ({
          data: {
            confirmedVersion: 2,
            confirmedSnapshot: {
              version: 2,
              title: 'SERVER DIFFERENT',
              promptText: 'SERVER DIFFERENT',
              modelAnswer: 'SERVER DIFFERENT answer',
              type: 'essay_descriptive',
              conceptIds: ['c-1'],
              hints: ['H1'],
              timeStandardMinutes: 15,
              rubric: [{ id: 'r1', label: '기준', maxScore: 100, weight: 1, description: 'Original rubric' }],
            },
            problemRow: {
              id: probId,
              user_id: 'user_verif_fail_repro',
              subject_id: 'sub-verif-1',
              type: 'essay_descriptive',
              title: 'SERVER DIFFERENT',
              quality_status: 'review_after_edit',
              is_outdated: false,
              needs_source_review: false,
              version: 2,
              payload: {
                ...probV1,
                title: 'SERVER DIFFERENT',
                promptText: 'SERVER DIFFERENT',
                modelAnswer: 'SERVER DIFFERENT answer',
                version: 2,
                qualityStatus: 'review_after_edit',
              },
              created_at: '2026-11-10T10:00:00.000Z',
              updated_at: '2026-11-10T10:01:00.000Z',
            },
          },
          error: null,
        }),
      };

      const repoRes = await learningRepo.reviseProblem(mismatchSupabase, probId, 1, localEdit.updatedProblem);
      // Pre-fix bug: repoRes.ok was true and repoRes.data held 'MY EDIT', causing DashboardClient's
      // `if (result.ok) confirmProblemRevisionSynced(...)` to return status:'applied' and delete revBefore!
      assert.equal(repoRes.ok, false, 'verification_failed must set ok: false so callers cannot enter verified completion path');
      assert.equal(repoRes.outcome, 'verification_failed');
      assert.equal(repoRes.savedToServer, true);
      assert.equal(repoRes.contentVerified, false);
      assert.equal(repoRes.data, undefined, 'verification_failed must NOT return request-derived data');

      // And through the shared coordinator (used by DashboardClient):
      const revSync = load(path.join(output, 'lib/problemRevisionSync.js'));
      const syncOutcome = await revSync.pushProblemRevisionToServer({
        supabase: mismatchSupabase,
        problemId: probId,
        expectedVersion: 1,
        problem: localEdit.updatedProblem,
        snapshotProblem: localEdit.updatedProblem,
        targetRevisionId: revBefore.revisionId,
        targetGeneration: revBefore.generation,
        editReason: revBefore.editReason,
        pinnedScopeId: storageScope.getStorageScopeId(),
        unsaved: revBefore,
      });
      assert.notEqual(syncOutcome.syncOutcomeStatus, 'applied', 'Must NEVER produce status: applied on verification_failed');
      assert.equal(syncOutcome.needsRecovery, true);
      const protectedAfter = storage.getEffectiveUnsavedProblemRevision(probId);
      assert.ok(protectedAfter, 'Protected revision MUST NOT be null after verification_failed');
      assert.equal(protectedAfter.promptText, 'MY EDIT', 'Protected revision keeps local MY EDIT content');
      assert.equal(protectedAfter.syncStatus, 'conflict', 'Content mismatch transitions protected revision to conflict');
      assert.equal(protectedAfter.confirmedVersion, 2);
      assert.equal(protectedAfter.serverLatestSummary?.promptText, 'SERVER DIFFERENT', 'Server content is preserved for diff/resolution');

      // Defensive guard: confirmProblemRevisionSynced itself must refuse to clear revision on verification_failed
      const directGuardOutcome = storage.confirmProblemRevisionSynced(
        probId,
        { ...localEdit.updatedProblem, version: 2 },
        {
          revisionId: revBefore.revisionId,
          generation: revBefore.generation,
          verificationStatus: 'verification_failed',
          contentVerified: false,
        }
      );
      assert.equal(directGuardOutcome.status, 'stale_ignored');
      assert.ok(storage.getEffectiveUnsavedProblemRevision(probId), 'Protected revision remains after blocked confirm');

      // Read-only retry verification when server STILL mismatches -> keeps conflict, ZERO RPC/AI calls
      let rpcCallCount = 0;
      const stillMismatchReadSupabase = {
        rpc: async () => {
          rpcCallCount++;
          throw new Error('Retry verification must never invoke revise RPC');
        },
        from: (table) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === 'problems'
                  ? { data: { id: probId, user_id: 'user_verif_fail_repro', subject_id: 'sub-verif-1', type: 'essay_descriptive', title: 'SERVER DIFFERENT', quality_status: 'review_after_edit', version: 2, payload: { ...probV1, title: 'SERVER DIFFERENT', promptText: 'SERVER DIFFERENT', modelAnswer: 'SERVER DIFFERENT answer', version: 2 } }, error: null }
                  : { data: null, error: null },
              eq: () => ({
                maybeSingle: async () => ({
                  data: { snapshot: { version: 2, title: 'SERVER DIFFERENT', promptText: 'SERVER DIFFERENT', modelAnswer: 'SERVER DIFFERENT answer', type: 'essay_descriptive', conceptIds: ['c-1'], hints: ['H1'], rubric: probV1.rubric } },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
      const retryStillMismatch = await revSync.verifyProblemRevisionOnServer({
        supabase: stillMismatchReadSupabase,
        problemId: probId,
        pinnedScopeId: storageScope.getStorageScopeId(),
      });
      assert.equal(rpcCallCount, 0, 'Retry verification never executes RPC');
      assert.equal(retryStillMismatch.outcome, 'conflict');
      assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.syncStatus, 'conflict');
      assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.promptText, 'MY EDIT');

      // Simulate page refresh (persisted JSON reload via mergeProblems): conflict stays conflict & MY EDIT survives
      const cloudMerge = load(path.join(output, 'lib/cloud/mergeLearning.js'));
      const reloadedRevisions = storage.loadUnsavedProblemRevisions();
      const mergedAfterReload = cloudMerge.mergeProblems(
        [{ ...probV1, title: 'SERVER DIFFERENT', promptText: 'SERVER DIFFERENT', modelAnswer: 'SERVER DIFFERENT answer', version: 2 }],
        storage.loadStoredProblems(),
        {},
        new Set([probId]),
        new Set([probId]),
        reloadedRevisions,
        (rev) => storage.saveUnsavedProblemRevision(rev)
      );
      assert.equal(mergedAfterReload.length, 1);
      assert.equal(storage.getUnsavedProblemRevision(probId)?.syncStatus, 'conflict');
      assert.equal(storage.getUnsavedProblemRevision(probId)?.promptText, 'MY EDIT');

      // Explicit conflict resolution: accept_server clears conflict revision and applies SERVER DIFFERENT
      const acceptRes = revSync.resolveProblemRevisionConflict(probId, 'accept_server', {
        scopeId: storageScope.getStorageScopeId(),
        revisionId: revBefore.revisionId,
        generation: revBefore.generation,
      });
      assert.equal(acceptRes.ok, true);
      assert.equal(storage.getEffectiveUnsavedProblemRevision(probId), null);
      assert.equal(storage.loadStoredProblems().find((p) => p.id === probId)?.promptText, 'SERVER DIFFERENT');
    } finally {
      storageScope.setStorageScope({ kind: 'legacy' });
    }
  });

  await checkAsync('Verification Pending Cases (read error, missing/incomplete snapshot, uncertain network error, retry success, concurrent edit B preservation, account switch)', async () => {
    const revSync = load(path.join(output, 'lib/problemRevisionSync.js'));
    const probId = 'prob-verif-cases-1';
    const probV1 = {
      id: probId,
      subjectId: 'sub-vc-1',
      type: 'essay_descriptive',
      title: 'VC v1',
      promptText: 'VC Prompt v1',
      modelAnswer: 'VC Answer v1',
      rubric: [{ id: 'r1', label: '기준', maxScore: 100, weight: 1, description: 'R1' }],
      hints: ['H1'],
      conceptIds: ['c-1'],
      timeStandardMinutes: 15,
      version: 1,
      serverConfirmedVersion: 1,
      qualityStatus: 'normal',
      reports: [],
    };

    // Case 1: Incomplete snapshot -> stays verification_pending, never backfilled or deleted
    storageScope.setStorageScope({ kind: 'user', userId: 'user_vc_A' });
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();
    storage.saveStoredProblems([probV1]);
    const editInc = storage.editAndReviseProblem(probId, { promptText: 'Edit Incomplete' }, 'Edit inc');
    const revInc = storage.getEffectiveUnsavedProblemRevision(probId);
    const incSupabase = {
      rpc: async () => ({
        data: { confirmedVersion: 2, confirmedSnapshot: { version: 2 }, problemRow: null },
        error: null,
      }),
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    };
    const incOutcome = await revSync.pushProblemRevisionToServer({
      supabase: incSupabase,
      problemId: probId,
      expectedVersion: 1,
      problem: editInc.updatedProblem,
      targetRevisionId: revInc.revisionId,
      targetGeneration: revInc.generation,
      editReason: revInc.editReason,
      pinnedScopeId: storageScope.getStorageScopeId(),
      unsaved: revInc,
    });
    assert.equal(incOutcome.outcome, 'verification_pending');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.syncStatus, 'verification_pending');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.promptText, 'Edit Incomplete');

    // Case 2: Post-save read failure -> verification_pending -> read-only retry succeeds & clears ONLY matching revision (0 RPC calls)
    storage.clearAllUnsavedProblemRevisions();
    storage.saveStoredProblems([probV1]);
    const editReadFail = storage.editAndReviseProblem(probId, { promptText: 'Edit Read Retry' }, 'Read retry');
    const revReadFail = storage.getEffectiveUnsavedProblemRevision(probId);
    let rpcCallsDuringReadFailAndRetry = 0;
    const readFailThenOkSupabase = {
      rpc: async () => {
        rpcCallsDuringReadFailAndRetry++;
        return { data: { confirmedVersion: 2 }, error: null };
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'Temporary read timeout' } }),
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'Temporary read timeout' } }),
            }),
          }),
        }),
      }),
    };
    const readFailOut = await revSync.pushProblemRevisionToServer({
      supabase: readFailThenOkSupabase,
      problemId: probId,
      expectedVersion: 1,
      problem: editReadFail.updatedProblem,
      targetRevisionId: revReadFail.revisionId,
      targetGeneration: revReadFail.generation,
      editReason: revReadFail.editReason,
      pinnedScopeId: storageScope.getStorageScopeId(),
      unsaved: revReadFail,
    });
    assert.equal(rpcCallsDuringReadFailAndRetry, 1);
    assert.equal(readFailOut.outcome, 'verification_pending');
    assert.equal(storage.getUnsavedProblemRevision(probId)?.syncStatus, 'verification_pending');
    assert.equal(storage.getUnsavedProblemRevision(probId)?.confirmedVersion, 2);

    // Retry verification when read succeeds:
    const v2Row = {
      id: probId,
      user_id: 'user_vc_A',
      subject_id: 'sub-vc-1',
      type: 'essay_descriptive',
      title: 'VC v1',
      quality_status: 'review_after_edit',
      version: 2,
      payload: { ...editReadFail.updatedProblem, version: 2 },
    };
    const v2Snap = {
      version: 2,
      title: 'VC v1',
      promptText: 'Edit Read Retry',
      modelAnswer: 'VC Answer v1',
      type: 'essay_descriptive',
      conceptIds: ['c-1'],
      hints: ['H1'],
      timeStandardMinutes: 15,
      rubric: probV1.rubric,
    };
    const readOkSupabase = {
      rpc: async () => {
        rpcCallsDuringReadFailAndRetry++;
        throw new Error('Retry must NOT call revise RPC');
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: table === 'problems' ? v2Row : null, error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: table === 'problem_versions' ? { snapshot: v2Snap } : null, error: null }),
            }),
          }),
        }),
      }),
    };
    const retryOk = await revSync.verifyProblemRevisionOnServer({
      supabase: readOkSupabase,
      problemId: probId,
      pinnedScopeId: storageScope.getStorageScopeId(),
    });
    assert.equal(rpcCallsDuringReadFailAndRetry, 1, 'Retry did NOT re-run RPC or AI');
    assert.equal(retryOk.outcome, 'verified_synced');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId), null, 'Matching revision cleared after verified match');
    assert.equal(storage.loadStoredProblems().find((p) => p.id === probId)?.serverConfirmedVersion, 2);

    // Case 3: Ambiguous network error on RPC -> save_uncertain (not marked definitively failed) -> read-only check handles safely
    storage.clearAllUnsavedProblemRevisions();
    storage.saveStoredProblems([probV1]);
    const editUnc = storage.editAndReviseProblem(probId, { promptText: 'Edit Uncertain' }, 'Uncertain net');
    const revUnc = storage.getEffectiveUnsavedProblemRevision(probId);
    const uncertainOutcome = await revSync.pushProblemRevisionToServer({
      supabase: { rpc: async () => { throw new Error('Failed to fetch'); } },
      problemId: probId,
      expectedVersion: 1,
      problem: editUnc.updatedProblem,
      targetRevisionId: revUnc.revisionId,
      targetGeneration: revUnc.generation,
      editReason: revUnc.editReason,
      pinnedScopeId: storageScope.getStorageScopeId(),
      unsaved: revUnc,
    });
    assert.equal(uncertainOutcome.outcome, 'verification_pending');
    assert.equal(uncertainOutcome.savedToServer, 'unknown');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.verificationFailureReason, 'save_uncertain');

    // Case 4 & 5: Save A -> Edit B while A in flight (or after A is verification_pending) -> A fails verification -> B preserved -> A retry verification succeeds -> B STILL preserved!
    storage.clearAllUnsavedProblemRevisions();
    storage.saveStoredProblems([probV1]);
    const editA = storage.editAndReviseProblem(probId, { promptText: 'Prompt A v2' }, 'Reason A');
    const revA = storage.getEffectiveUnsavedProblemRevision(probId);
    // Suppose A commits v2 on server, fails read verification (`verification_pending`):
    await revSync.pushProblemRevisionToServer({
      supabase: readFailThenOkSupabase,
      problemId: probId,
      expectedVersion: 1,
      problem: editA.updatedProblem,
      targetRevisionId: revA.revisionId,
      targetGeneration: revA.generation,
      editReason: revA.editReason,
      pinnedScopeId: storageScope.getStorageScopeId(),
      unsaved: revA,
    });
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.syncStatus, 'verification_pending');

    // Now user makes newer local edit B while A is pending verification:
    const editB = storage.editAndReviseProblem(probId, { promptText: 'Prompt B v3' }, 'Reason B');
    assert.equal(editB.success, true);
    const revB = storage.getEffectiveUnsavedProblemRevision(probId);
    assert.equal(revB.promptText, 'Prompt B v3');
    assert.ok(revB.pendingPriorVerification, 'B records prior unverified commit A safely');

    // Simulate a late verification_failed response for A arriving AFTER B exists: B must remain intact!
    const lateAFail = await revSync.applyReviseProblemResult({
      supabase: readFailThenOkSupabase,
      problemId: probId,
      expectedVersion: 1,
      problem: editA.updatedProblem,
      snapshotProblem: editA.updatedProblem,
      result: {
        outcome: 'verification_failed',
        ok: false,
        savedToServer: true,
        contentVerified: false,
        verificationStatus: 'verification_failed',
        verificationFailureReason: 'content_mismatch',
        verificationError: 'Simulated late mismatch for A',
        confirmedVersion: 2,
        serverSnapshot: null,
        latestServerProblem: null,
        serverAdvancedBeyondConfirmed: false,
        error: 'Simulated late mismatch for A',
      },
      targetRevisionId: revA.revisionId,
      targetGeneration: revA.generation,
      editReason: revA.editReason,
      pinnedScopeId: storageScope.getStorageScopeId(),
      unsaved: revA,
    });
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.revisionId, revB.revisionId, 'B must NOT be overwritten by late A failure');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.promptText, 'Prompt B v3', 'B promptText stays untouched');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId)?.syncStatus, 'pending', 'B syncStatus stays pending (not overwritten with A conflict)');
    assert.ok(lateAFail.message.includes('보존'));

    // Now retry verification for A succeeds (`Prompt A v2` verified at v2): B must STILL be preserved with baseVersion advanced to 2!
    const v2SnapA = {
      version: 2,
      title: 'VC v1',
      promptText: 'Prompt A v2',
      modelAnswer: 'VC Answer v1',
      type: 'essay_descriptive',
      conceptIds: ['c-1'],
      hints: ['H1'],
      timeStandardMinutes: 15,
      rubric: probV1.rubric,
    };
    const v2RowA = { ...v2Row, payload: { ...editA.updatedProblem, version: 2 } };
    const verifyAOnBRes = await revSync.verifyProblemRevisionOnServer({
      supabase: {
        rpc: () => { throw new Error('No RPC on verify'); },
        from: (table) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: table === 'problems' ? v2RowA : null, error: null }),
              eq: () => ({
                maybeSingle: async () => ({ data: table === 'problem_versions' ? { snapshot: v2SnapA } : null, error: null }),
              }),
            }),
          }),
        }),
      },
      problemId: probId,
      pinnedScopeId: storageScope.getStorageScopeId(),
    });
    assert.equal(verifyAOnBRes.outcome, 'verified_synced');
    const bAfterAVerified = storage.getEffectiveUnsavedProblemRevision(probId);
    assert.ok(bAfterAVerified, 'B is preserved after prior A verification succeeded');
    assert.equal(bAfterAVerified.promptText, 'Prompt B v3');
    assert.equal(bAfterAVerified.baseVersion, 2, 'B baseVersion cleanly advanced to verified v2');
    assert.equal(bAfterAVerified.baseSnapshot?.promptText, 'Prompt A v2');
    assert.equal(bAfterAVerified.pendingPriorVerification, undefined, 'Prior verification cleared once verified');

    // Case 6: Account switch isolation during verification retry
    const scopeUserA = storageScope.getStorageScopeId();
    storageScope.setStorageScope({ kind: 'user', userId: 'user_vc_B' });
    localStorage.clear();
    const isolatedRes = await revSync.verifyProblemRevisionOnServer({
      supabase: readOkSupabase,
      problemId: probId,
      pinnedScopeId: scopeUserA, // request was started for user A, now in user B!
    });
    assert.equal(isolatedRes.outcome, 'scope_changed', 'Verification aborted on account switch');
    assert.equal(storage.getEffectiveUnsavedProblemRevision(probId), null, 'User B storage untouched');
    assert.equal(storage.loadStoredProblems().length, 0, 'User B problem list stays empty');
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('Conflict resolution (resolveProblemRevisionConflict): local storage failure and partial completion safety', async () => {
    const storage = load(path.join(output, 'lib/storage.js'));
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();

    const probId = 'p_conflict_safety_1';
    const baseRubric = [
      { id: 'r1', label: 'C1', maxScore: 60, weight: 0.6, description: 'Criterion 1' },
      { id: 'r2', label: 'C2', maxScore: 40, weight: 0.4, description: 'Criterion 2' },
    ];
    const probV1 = {
      id: probId,
      subjectId: 'sub-cs-1',
      type: 'essay_descriptive',
      categoryLabel: 'Theory',
      categoryNumber: 1,
      conceptIds: ['c-1'],
      sourceRefs: 'S1',
      timeBreakdownDesc: '15m',
      coreEvaluationHighlight: 'H1',
      itemCountDesc: '1',
      title: 'Title v1',
      promptText: 'Original Prompt v1',
      hints: ['Hint 1'],
      modelAnswer: 'Original Answer v1',
      rubric: baseRubric,
      timeStandardMinutes: 15,
      version: 1,
      serverConfirmedVersion: 1,
      versionHistory: [],
    };
    storage.saveStoredProblems([probV1]);
    const initialAttemptV1 = {
      id: 'att_conflict_hist_1',
      problemId: probId,
      subjectId: 'sub-cs-1',
      conceptId: 'c-1',
      problemVersion: 1,
      submittedAnswer: 'Historical student answer at v1',
      score: 92,
      feedback: 'Historical evaluation feedback',
      rubricScores: [{ criterionId: 'r1', score: 55 }, { criterionId: 'r2', score: 37 }],
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    localStorage.setItem('redcall_attempts_v1', JSON.stringify([initialAttemptV1]));

    // 1. Reproduce pre-fix bug: local problem body = v2, server body = v3, conflict revision exists.
    // Inject localStorage failure when saving problems_v1 during accept_server.
    const editRes = storage.editAndReviseProblem(
      probId,
      { promptText: 'Local Body v2', modelAnswer: 'Local Answer v2' },
      'Edit v2'
    );
    assert.equal(editRes.success, true);
    const revV2 = storage.getEffectiveUnsavedProblemRevision(probId);
    assert.ok(revV2, 'Protected revision exists');

    const serverProbV3 = {
      ...probV1,
      title: 'Server Title v3',
      promptText: 'Server Body v3',
      modelAnswer: 'Server Answer v3',
      version: 3,
      serverConfirmedVersion: 3,
    };

    storage.recordProblemRevisionMismatchConflict(probId, {
      targetRevisionId: revV2.revisionId,
      targetGeneration: revV2.generation,
      confirmedVersion: 3,
      saveConfirmedOnServer: true,
      errorMessage: 'Conflict with Server v3',
      serverLatestProblem: serverProbV3,
    });

    const conflictRevBefore = storage.getUnsavedProblemRevision(probId);
    assert.equal(conflictRevBefore?.syncStatus, 'conflict');
    assert.equal(storage.loadStoredProblems()[0].version, 2);
    assert.equal(storage.loadStoredProblems()[0].promptText, 'Local Body v2');

    // Inject storage error on problems_v1 write
    localStorage.setBlockedKeys(['problems_v1']);
    let acceptFailRes;
    try {
      acceptFailRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
        revisionId: conflictRevBefore.revisionId,
        generation: conflictRevBefore.generation,
        serverProblem: serverProbV3,
      });
    } finally {
      localStorage.setBlockedKeys([]);
    }

    // Must NOT report ok:true or sync completion, and must preserve both persisted and memory revision!
    assert.equal(acceptFailRes.ok, false, 'accept_server must return ok:false when problem body persistence fails');
    assert.equal(acceptFailRes.status, 'body_save_failed');
    assert.ok(
      !acceptFailRes.message.includes('동기화했습니다'),
      'accept_server must not claim sync completed when body save failed'
    );
    assert.equal(storage.loadStoredProblems()[0].version, 2, 'Persisted problem body remains v2');
    assert.equal(storage.loadStoredProblems()[0].promptText, 'Local Body v2');
    assert.ok(
      storage.getUnsavedProblemRevision(probId),
      'Persisted protected revision must NOT be deleted when problem body save fails'
    );
    assert.ok(
      storage.getInMemoryProblemRevision(probId),
      'In-memory protected revision must NOT be deleted when problem body save fails'
    );
    assert.equal(acceptFailRes.bodyPersisted, false);
    assert.equal(acceptFailRes.revisionCleared, false);
    assert.equal(acceptFailRes.needsRetry, true);

    // 2. accept_server: Read-back verification failure (version, body, or identity mismatch on read-back)
    // must NOT delete the protected revision!
    const origGetItem = localStorage.getItem;
    let corruptNextProblemsRead = false;
    localStorage.getItem = (key) => {
      const raw = origGetItem(key);
      if (corruptNextProblemsRead && key.endsWith('problems_v1') && raw) {
        const parsed = JSON.parse(raw);
        // Simulate read-back returning stale v2 body or corrupted content even though setItem did not throw
        parsed[0].promptText = 'Tampered Readback Prompt';
        return JSON.stringify(parsed);
      }
      return raw;
    };
    let verifyFailRes;
    try {
      // Restore v2 before testing read-back failure
      storage.saveStoredProblems(editRes.updatedProblems);
      corruptNextProblemsRead = true;
      verifyFailRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
        revisionId: conflictRevBefore.revisionId,
        generation: conflictRevBefore.generation,
        serverProblem: serverProbV3,
      });
    } finally {
      corruptNextProblemsRead = false;
      localStorage.getItem = origGetItem;
      storage.saveStoredProblems(editRes.updatedProblems);
    }
    assert.equal(verifyFailRes.ok, false);
    assert.equal(verifyFailRes.status, 'body_verify_failed');
    assert.equal(verifyFailRes.bodyVerified, false);
    assert.equal(verifyFailRes.revisionCleared, false);
    assert.ok(storage.getUnsavedProblemRevision(probId), 'Protected revision kept on read-back verify failure');
    assert.ok(storage.getInMemoryProblemRevision(probId), 'In-memory revision kept on read-back verify failure');

    // Also test read-back version mismatch and identity mismatch
    let mismatchVersionRead = false;
    localStorage.getItem = (key) => {
      const raw = origGetItem(key);
      if (mismatchVersionRead && key.endsWith('problems_v1') && raw) {
        const parsed = JSON.parse(raw);
        parsed[0].version = 2; // Stale version on read-back
        return JSON.stringify(parsed);
      }
      return raw;
    };
    try {
      mismatchVersionRead = true;
      const verVerifyFail = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
        revisionId: conflictRevBefore.revisionId,
        generation: conflictRevBefore.generation,
        serverProblem: serverProbV3,
      });
      assert.equal(verVerifyFail.ok, false);
      assert.equal(verVerifyFail.status, 'body_verify_failed');
      assert.ok(storage.getUnsavedProblemRevision(probId));
    } finally {
      mismatchVersionRead = false;
      localStorage.getItem = origGetItem;
      storage.saveStoredProblems(editRes.updatedProblems);
    }

    // 3. accept_server: Body save + verification succeed, but protected revision cleanup fails
    // -> partial_cleanup_failed, and retry cleanly finishes without duplication!
    localStorage.setBlockedKeys(['unsaved_problem_revisions_v1']);
    let partialRes;
    try {
      partialRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
        revisionId: conflictRevBefore.revisionId,
        generation: conflictRevBefore.generation,
        serverProblem: serverProbV3,
      });
    } finally {
      localStorage.setBlockedKeys([]);
    }
    assert.equal(partialRes.ok, false, 'Partial completion must NOT return ok:true');
    assert.equal(partialRes.status, 'partial_cleanup_failed');
    assert.equal(storage.isConflictResolutionComplete(partialRes), false);
    assert.equal(storage.isConflictResolutionPartial(partialRes), true);
    assert.equal(partialRes.bodyPersisted, true);
    assert.equal(partialRes.bodyVerified, true);
    assert.equal(partialRes.revisionCleared, false);
    assert.equal(partialRes.needsRetry, true);
    assert.equal(storage.loadStoredProblems()[0].version, 3, 'Server v3 body is persisted');
    assert.equal(storage.loadStoredProblems()[0].promptText, 'Server Body v3');
    assert.ok(storage.getUnsavedProblemRevision(probId), 'Revision still in storage after cleanup failure');

    // Historical v1 snapshot in versionHistory must remain untouched
    assert.equal(storage.loadStoredProblems()[0].versionHistory.length, 1);
    assert.equal(storage.loadStoredProblems()[0].versionHistory[0].version, 1);
    assert.equal(storage.loadStoredProblems()[0].versionHistory[0].promptText, 'Original Prompt v1');

    // Retry accept_server after storage unblocked: cleans up the revision without duplicating versionHistory or reports
    const retryCleanupRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
      revisionId: conflictRevBefore.revisionId,
      generation: conflictRevBefore.generation,
      serverProblem: serverProbV3,
    });
    assert.equal(retryCleanupRes.ok, true);
    assert.equal(retryCleanupRes.status, 'complete');
    assert.equal(storage.isConflictResolutionComplete(retryCleanupRes), true);
    assert.equal(retryCleanupRes.bodyPersisted, true);
    assert.equal(retryCleanupRes.bodyVerified, true);
    assert.equal(retryCleanupRes.revisionCleared, true);
    assert.equal(retryCleanupRes.needsRetry, false);
    assert.equal(storage.getUnsavedProblemRevision(probId), null, 'Persisted revision cleaned up on retry');
    assert.equal(storage.getInMemoryProblemRevision(probId), null, 'Memory revision cleaned up on retry');
    assert.equal(storage.loadStoredProblems()[0].version, 3);
    assert.equal(storage.loadStoredProblems()[0].versionHistory.length, 1, 'No duplicate versionHistory on retry');
    const attemptsAfterAccept = storage.loadStoredAttempts();
    assert.equal(attemptsAfterAccept.length, 1, 'Past attempt history preserved');
    assert.equal(attemptsAfterAccept[0].id, 'att_conflict_hist_1');
    assert.equal(attemptsAfterAccept[0].problemVersion, 1);
    assert.equal(attemptsAfterAccept[0].score, 92);
    assert.equal(attemptsAfterAccept[0].submittedAnswer, 'Historical student answer at v1');

    // 4. prepare_rebase_edit:
    // Set up a fresh conflict with pendingPriorVerification to test both preserved and superseded prior verification
    storage.saveStoredProblems([probV1]);
    storage.editAndReviseProblem(
      probId,
      { promptText: 'My Rebase Candidate Prompt', modelAnswer: 'My Rebase Candidate Answer' },
      'Rebase Reason'
    );
    const revBeforeRebase = storage.getEffectiveUnsavedProblemRevision(probId);
    // Attach a pendingPriorVerification at v2 (which should be cleared when rebasing onto v3,
    // or kept if confirmedVersion > newBaseVer)
    const conflictWithPriorV2 = {
      ...revBeforeRebase,
      syncStatus: 'conflict',
      confirmedVersion: 3,
      saveConfirmedOnServer: true,
      serverLatestSummary: serverProbV3,
      pendingPriorVerification: {
        revisionId: 'prior-rev-v2',
        generation: 1,
        confirmedVersion: 2,
        submittedProblem: { ...probV1, version: 2 },
        editReason: 'Prior v2',
        reason: 'read_error',
      },
    };
    storage.saveUnsavedProblemRevision(conflictWithPriorV2);

    // 4a. Reject rebasing onto incomplete server base or wrong problemId / wrong subjectId
    const wrongIdBase = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
      revisionId: conflictWithPriorV2.revisionId,
      generation: conflictWithPriorV2.generation,
      serverProblem: { ...serverProbV3, id: 'other_problem_id' },
    });
    assert.equal(wrongIdBase.ok, false);
    assert.equal(wrongIdBase.status, 'invalid_server_base');
    assert.equal(storage.canOpenEditorAfterRebasePrepare(wrongIdBase), false);
    assert.equal(storage.getUnsavedProblemRevision(probId)?.syncStatus, 'conflict');

    const wrongSubjectBase = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
      revisionId: conflictWithPriorV2.revisionId,
      generation: conflictWithPriorV2.generation,
      serverProblem: { ...serverProbV3, subjectId: 'other_subject_id' },
    });
    assert.equal(wrongSubjectBase.ok, false);
    assert.equal(wrongSubjectBase.status, 'invalid_server_base');

    const incompleteServerBase = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
      revisionId: conflictWithPriorV2.revisionId,
      generation: conflictWithPriorV2.generation,
      serverProblem: { ...serverProbV3, rubric: [] },
    });
    assert.equal(incompleteServerBase.ok, false);
    assert.equal(incompleteServerBase.status, 'invalid_server_base');
    assert.equal(storage.getUnsavedProblemRevision(probId)?.baseVersion, 1, 'Never rebased onto incomplete server base');

    // 4b. prepare_rebase_edit when persistent storage fails:
    // Memory state is prepared (memoryOnly: true), status is 'rebase_persist_failed' (NOT 'complete'),
    // and existing persisted conflict revision in localStorage is preserved intact!
    localStorage.setBlockedKeys(['unsaved_problem_revisions_v1']);
    let rebaseMemOnlyRes;
    try {
      rebaseMemOnlyRes = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
        revisionId: conflictWithPriorV2.revisionId,
        generation: conflictWithPriorV2.generation,
        serverProblem: serverProbV3,
      });
    } finally {
      localStorage.setBlockedKeys([]);
    }
    assert.equal(rebaseMemOnlyRes.ok, false, 'prepare_rebase_edit must return ok:false when localStorage fails');
    assert.equal(rebaseMemOnlyRes.status, 'rebase_persist_failed');
    assert.equal(rebaseMemOnlyRes.revisionPersisted, false);
    assert.equal(rebaseMemOnlyRes.memorySaved, true);
    assert.equal(rebaseMemOnlyRes.memoryOnly, true);
    assert.equal(rebaseMemOnlyRes.needsRetry, true);
    assert.equal(storage.canOpenEditorAfterRebasePrepare(rebaseMemOnlyRes), true);
    assert.ok(!rebaseMemOnlyRes.message.includes('준비되었습니다'), 'Must not claim rebase persistence completed');

    // Existing persisted conflict revision in localStorage is untouched
    const persistedStillConflict = storage.getUnsavedProblemRevision(probId);
    assert.equal(persistedStillConflict?.syncStatus, 'conflict');
    assert.equal(persistedStillConflict?.baseVersion, 1);
    assert.equal(persistedStillConflict?.promptText, 'My Rebase Candidate Prompt');

    // In-memory revision has the rebased state
    const memRebased = storage.getInMemoryProblemRevision(probId);
    assert.equal(memRebased?.syncStatus, 'pending');
    assert.equal(memRebased?.baseVersion, 3);
    assert.equal(memRebased?.revisionVersion, 4);
    assert.equal(memRebased?.baseSnapshot?.promptText, 'Server Body v3');
    assert.equal(memRebased?.pendingPriorVerification, undefined, 'Superseded prior v2 cleared against base v3');

    // 4c. Retry prepare_rebase_edit when storage is unblocked -> persists cleanly!
    const rebaseRetryOk = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
      revisionId: conflictWithPriorV2.revisionId,
      generation: conflictWithPriorV2.generation,
      serverProblem: serverProbV3,
    });
    assert.equal(rebaseRetryOk.ok, true);
    assert.equal(rebaseRetryOk.status, 'complete');
    assert.equal(rebaseRetryOk.revisionPersisted, true);
    assert.equal(rebaseRetryOk.memoryOnly, false);
    assert.equal(rebaseRetryOk.needsRetry, false);

    const persistedAfterRebase = storage.getUnsavedProblemRevision(probId);
    assert.equal(persistedAfterRebase?.syncStatus, 'pending');
    assert.equal(persistedAfterRebase?.baseVersion, 3);
    assert.equal(persistedAfterRebase?.revisionVersion, 4);
    assert.equal(persistedAfterRebase?.baseSnapshot?.version, 3);
    assert.equal(persistedAfterRebase?.baseSnapshot?.promptText, 'Server Body v3');
    assert.equal(persistedAfterRebase?.pendingPriorVerification, undefined);

    // 4d. Test that pendingPriorVerification IS preserved when confirmedVersion > newBaseVer
    const conflictWithHigherPrior = {
      ...conflictWithPriorV2,
      generation: 5,
      pendingPriorVerification: {
        revisionId: 'prior-rev-v5',
        generation: 4,
        confirmedVersion: 5,
        submittedProblem: { ...probV1, version: 5 },
        editReason: 'Prior v5',
        reason: 'read_error',
      },
    };
    storage.saveUnsavedProblemRevision(conflictWithHigherPrior);
    const rebaseKeepPrior = storage.resolveProblemRevisionConflict(probId, 'prepare_rebase_edit', {
      revisionId: conflictWithHigherPrior.revisionId,
      generation: conflictWithHigherPrior.generation,
      serverProblem: serverProbV3,
    });
    assert.equal(rebaseKeepPrior.ok, true);
    assert.equal(rebaseKeepPrior.status, 'complete');
    assert.equal(
      storage.getUnsavedProblemRevision(probId)?.pendingPriorVerification?.confirmedVersion,
      5,
      'pendingPriorVerification with confirmedVersion > newBaseVer must be preserved'
    );

    // 5. Common invariants:
    // 5a. Newer revision B (different revisionId or higher generation) must never be deleted or overwritten by stale conflict resolution A
    storage.editAndReviseProblem(
      probId,
      { promptText: 'Brand New Edit B', modelAnswer: 'Brand New Answer B' },
      'Newer Edit B'
    );
    const revBNewer = storage.getEffectiveUnsavedProblemRevision(probId);
    const staleAcceptRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
      revisionId: 'old-stale-rev-id',
      generation: 1,
      serverProblem: serverProbV3,
    });
    assert.equal(staleAcceptRes.ok, false);
    assert.equal(staleAcceptRes.status, 'stale_revision_aborted');
    assert.equal(storage.getUnsavedProblemRevision(probId)?.revisionId, revBNewer.revisionId);
    assert.equal(storage.getUnsavedProblemRevision(probId)?.promptText, 'Brand New Edit B');

    // 5b. Account switch isolation
    const scopeAtRequest = storageScope.getStorageScopeId();
    storageScope.setStorageScope({ kind: 'user', userId: 'user_conflict_other' });
    localStorage.clear();
    const crossScopeRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
      scopeId: scopeAtRequest,
      revisionId: revBNewer.revisionId,
      generation: revBNewer.generation,
      serverProblem: serverProbV3,
    });
    assert.equal(crossScopeRes.ok, false);
    assert.equal(crossScopeRes.status, 'scope_changed');
    assert.equal(storage.loadStoredProblems().length, 0, 'Other account problems untouched');
    assert.equal(storage.getUnsavedProblemRevision(probId), null);
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  await checkAsync('Reproduction 1: accept_server / prepare_rebase_edit must never mix local fields into incomplete server snapshot or resurrect deleted optional fields', async () => {
    const storage = load(path.join(output, 'lib/storage.js'));
    const revSync = load(path.join(output, 'lib/problemRevisionSync.js'));
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();

    const probId = 'p_repro1_server_only';
    const baseRubric = [
      { id: 'r1', label: 'C1', maxScore: 60, weight: 0.6, description: 'Criterion 1' },
      { id: 'r2', label: 'C2', maxScore: 40, weight: 0.4, description: 'Criterion 2' },
    ];
    const localProbV2 = {
      id: probId,
      subjectId: 'sub-cs-1',
      type: 'essay_descriptive',
      categoryLabel: 'Theory',
      categoryNumber: 1,
      conceptIds: ['c-1'],
      sourceRefs: 'S1',
      timeBreakdownDesc: '15m',
      coreEvaluationHighlight: 'H1',
      itemCountDesc: '1',
      title: 'Local Title v2',
      promptText: 'Local Prompt v2',
      mathFormula: 'E = mc^2',
      codeSnippet: 'const localCode = 42;',
      appliedConditionNote: 'Local condition x > 0',
      hints: ['Local Hint 1'],
      modelAnswer: 'Local Model Answer v2',
      rubric: baseRubric,
      timeStandardMinutes: 15,
      version: 2,
      serverConfirmedVersion: 1,
      versionHistory: [],
    };
    storage.saveStoredProblems([localProbV2]);

    // Server snapshot has NO serverLatestSummary, and serverSnapshotSummary is missing required modelAnswer!
    const incompleteServerSnapshot = {
      version: 3,
      title: 'Server Snapshot Title v3',
      promptText: 'Server Snapshot Prompt v3',
      type: 'essay_descriptive',
      conceptIds: ['c-1'],
      hints: ['Server Hint'],
      rubric: baseRubric,
      timeStandardMinutes: 20,
      // modelAnswer is missing!
    };
    const conflictRev = {
      problemId: probId,
      revisionId: 'rev-repro1-1',
      generation: 1,
      baseVersion: 1,
      revisionVersion: 2,
      title: localProbV2.title,
      promptText: localProbV2.promptText,
      type: localProbV2.type,
      conceptIds: localProbV2.conceptIds,
      mathFormula: localProbV2.mathFormula,
      codeSnippet: localProbV2.codeSnippet,
      appliedConditionNote: localProbV2.appliedConditionNote,
      hints: localProbV2.hints,
      modelAnswer: localProbV2.modelAnswer,
      rubric: localProbV2.rubric,
      timeStandardMinutes: localProbV2.timeStandardMinutes,
      editReason: 'Local edit v2',
      revisedAt: new Date().toISOString(),
      syncStatus: 'conflict',
      confirmedVersion: 3,
      saveConfirmedOnServer: true,
      serverLatestSummary: undefined,
      serverSnapshotSummary: incompleteServerSnapshot,
    };
    storage.saveUnsavedProblemRevision(conflictRev);

    // Build the exact input that ProblemQualityReviewTab uses for the button click
    const uiReq =
      typeof revSync.buildConflictResolutionRequest === 'function'
        ? revSync.buildConflictResolutionRequest(conflictRev, 'accept_server', null)
        : {
            action: 'accept_server',
            params: {
              revisionId: conflictRev.revisionId,
              generation: conflictRev.generation,
              serverProblem:
                conflictRev.serverLatestSummary ??
                (conflictRev.serverSnapshotSummary
                  ? {
                      ...localProbV2,
                      ...conflictRev.serverSnapshotSummary,
                      id: localProbV2.id,
                      subjectId: localProbV2.subjectId,
                      version: conflictRev.serverSnapshotSummary.version,
                    }
                  : null),
            },
          };
    localStorage.resetWriteCounts();
    const res = storage.resolveProblemRevisionConflict(probId, uiReq.action, uiReq.params);

    assert.equal(res.ok, false, `Expected ok:false but got ok:${res.ok} status:${res.status}`);
    assert.equal(res.status, 'invalid_server_base');
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Zero writes to problems_v1');
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 0, 'Zero deletes/writes to unsaved_problem_revisions_v1');
    assert.ok(storage.getUnsavedProblemRevision(probId), 'Protected revision preserved');
    assert.ok(res.message.includes('저장 결과 다시 확인'), 'Must guide user to 저장 결과 다시 확인');

    // Same server-base validation for prepare_rebase_edit while keeping protected revision
    const uiRebaseReq =
      typeof revSync.buildConflictResolutionRequest === 'function'
        ? revSync.buildConflictResolutionRequest(conflictRev, 'prepare_rebase_edit', null)
        : {
            action: 'prepare_rebase_edit',
            params: uiReq.params,
          };
    localStorage.resetWriteCounts();
    const resRebase = storage.resolveProblemRevisionConflict(probId, uiRebaseReq.action, uiRebaseReq.params);
    assert.equal(resRebase.ok, false);
    assert.equal(resRebase.status, 'invalid_server_base');
    assert.equal(localStorage.getWriteCount('problems_v1'), 0);
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 0);
    assert.equal(storage.getUnsavedProblemRevision(probId)?.promptText, 'Local Prompt v2', 'User protected revision preserved');

    // Complete server snapshot where optional fields (codeSnippet, mathFormula, appliedConditionNote) were deleted on server:
    // must NOT resurrect local optional fields from localProbV2!
    const completeServerSnapshotWithoutOptionals = {
      version: 3,
      title: 'Server Clean Title v3',
      promptText: 'Server Clean Prompt v3',
      type: 'essay_descriptive',
      conceptIds: ['c-1'],
      hints: ['Server Hint v3'],
      modelAnswer: 'Server Complete Model Answer v3',
      rubric: baseRubric,
      timeStandardMinutes: 20,
      // codeSnippet, mathFormula, appliedConditionNote omitted (deleted on server)
    };
    const conflictRevComplete = {
      ...conflictRev,
      serverSnapshotSummary: completeServerSnapshotWithoutOptionals,
    };
    storage.saveUnsavedProblemRevision(conflictRevComplete);
    const uiCleanReq =
      typeof revSync.buildConflictResolutionRequest === 'function'
        ? revSync.buildConflictResolutionRequest(conflictRevComplete, 'accept_server', null)
        : {
            action: 'accept_server',
            params: {
              revisionId: conflictRevComplete.revisionId,
              generation: conflictRevComplete.generation,
            },
          };
    const resClean = storage.resolveProblemRevisionConflict(probId, uiCleanReq.action, uiCleanReq.params);
    assert.equal(resClean.ok, true);
    assert.equal(resClean.status, 'complete');
    const savedProbAfterAccept = storage.loadStoredProblems().find((p) => p.id === probId);
    assert.equal(savedProbAfterAccept?.modelAnswer, 'Server Complete Model Answer v3');
    assert.equal(savedProbAfterAccept?.codeSnippet, undefined, 'Deleted codeSnippet must not resurrect from local problem');
    assert.equal(savedProbAfterAccept?.mathFormula, undefined, 'Deleted mathFormula must not resurrect from local problem');
    assert.equal(savedProbAfterAccept?.appliedConditionNote, undefined, 'Deleted appliedConditionNote must not resurrect from local problem');

    const uiSrc = fs.readFileSync(path.join(root, 'components/ProblemQualityReviewTab.tsx'), 'utf8');
    assert.ok(
      uiSrc.includes('buildConflictResolutionRequest'),
      'ProblemQualityReviewTab must use shared buildConflictResolutionRequest without spreading activeProblem into serverSnapshotSummary'
    );
  });

  await checkAsync('Reproduction 2: Pre-write read failure or corrupted JSON in problems_v1 must never delete other problems (Problem B)', async () => {
    const storage = load(path.join(output, 'lib/storage.js'));
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();

    const baseRubric = [
      { id: 'r1', label: 'C1', maxScore: 100, weight: 1, description: 'Criterion 1' },
    ];
    const probA = {
      id: 'prob_A',
      subjectId: 'sub-1',
      type: 'essay_descriptive',
      categoryLabel: 'T',
      categoryNumber: 1,
      conceptIds: ['c-1'],
      sourceRefs: 'S1',
      timeBreakdownDesc: '15m',
      coreEvaluationHighlight: 'H1',
      itemCountDesc: '1',
      title: 'Problem A v2',
      promptText: 'Prompt A v2',
      hints: ['H1'],
      modelAnswer: 'Answer A v2',
      rubric: baseRubric,
      timeStandardMinutes: 15,
      version: 2,
      serverConfirmedVersion: 1,
      versionHistory: [],
    };
    const probB = {
      ...probA,
      id: 'prob_B',
      title: 'Problem B v1',
      promptText: 'Prompt B v1',
      modelAnswer: 'Answer B v1',
      version: 1,
    };
    storage.saveStoredProblems([probA, probB]);
    const rawBefore = localStorage.getItem('redcall_problems_v1');

    // A also has an in-memory problem and a conflict revision
    storage.editAndReviseProblem('prob_A', { promptText: 'Prompt A edit' }, 'Reason A');
    const revA = storage.getEffectiveUnsavedProblemRevision('prob_A');
    const serverProbAV3 = {
      ...probA,
      title: 'Server A v3',
      promptText: 'Server Prompt A v3',
      modelAnswer: 'Server Answer A v3',
      version: 3,
      serverConfirmedVersion: 3,
    };
    storage.recordProblemRevisionMismatchConflict('prob_A', {
      targetRevisionId: revA.revisionId,
      targetGeneration: revA.generation,
      confirmedVersion: 3,
      saveConfirmedOnServer: true,
      errorMessage: 'Conflict A',
      serverLatestProblem: serverProbAV3,
    });
    // Reset raw problems_v1 to [probA, probB] snapshot to verify exact string preservation
    localStorage.setItem('redcall_problems_v1', rawBefore);

    // Fail ONLY the first getItem on problems_v1, while setItem remains unblocked
    const origGetItem = localStorage.getItem;
    let failFirstProblemsGet = true;
    localStorage.getItem = (key) => {
      if (failFirstProblemsGet && key.endsWith('problems_v1')) {
        failFirstProblemsGet = false;
        throw new Error('Transient read error on problems_v1');
      }
      return origGetItem(key);
    };
    localStorage.resetWriteCounts();
    let resReadFail;
    try {
      resReadFail = storage.resolveProblemRevisionConflict('prob_A', 'accept_server', {
        revisionId: revA.revisionId,
        generation: revA.generation,
        serverProblem: serverProbAV3,
      });
    } finally {
      localStorage.getItem = origGetItem;
    }

    assert.equal(resReadFail.ok, false);
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Must NOT write to problems_v1 when initial list read failed');
    assert.equal(localStorage.getItem('redcall_problems_v1'), rawBefore, 'Persisted JSON string unchanged');
    assert.equal(storage.loadStoredProblems().length, 2, 'Both Problem A and Problem B preserved');
    assert.ok(storage.loadStoredProblems().some((p) => p.id === 'prob_B'), 'Problem B preserved');
    assert.ok(storage.getUnsavedProblemRevision('prob_A'), 'Problem A protected revision preserved');

    // Subcase 2b: Corrupted JSON string in problems_v1 must NOT be overwritten
    localStorage.setItem('redcall_problems_v1', '{corrupted_json');
    localStorage.resetWriteCounts();
    const resCorrupt = storage.resolveProblemRevisionConflict('prob_A', 'accept_server', {
      revisionId: revA.revisionId,
      generation: revA.generation,
      serverProblem: serverProbAV3,
    });
    assert.equal(resCorrupt.ok, false);
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Zero writes when problems_v1 has corrupted JSON');
    assert.equal(localStorage.getItem('redcall_problems_v1'), '{corrupted_json', 'Corrupted raw value untouched');
    assert.ok(storage.getUnsavedProblemRevision('prob_A'), 'Protected revision preserved on corrupted JSON');

    // Subcase 2c: Non-array JSON in problems_v1 must NOT be overwritten
    localStorage.setItem('redcall_problems_v1', '{"notAnArray":true}');
    localStorage.resetWriteCounts();
    const resNonArray = storage.resolveProblemRevisionConflict('prob_A', 'accept_server', {
      revisionId: revA.revisionId,
      generation: revA.generation,
      serverProblem: serverProbAV3,
    });
    assert.equal(resNonArray.ok, false);
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Zero writes when problems_v1 is non-array JSON');
    assert.equal(localStorage.getItem('redcall_problems_v1'), '{"notAnArray":true}');
    assert.ok(storage.getUnsavedProblemRevision('prob_A'), 'Protected revision preserved on non-array JSON');

    // Subcase 2d: When problems_v1 key genuinely does NOT exist (absent), recovering in-memory problem A works cleanly
    localStorage.removeItem('redcall_problems_v1');
    localStorage.resetWriteCounts();
    const resAbsentRecover = storage.resolveProblemRevisionConflict('prob_A', 'accept_server', {
      revisionId: revA.revisionId,
      generation: revA.generation,
      serverProblem: serverProbAV3,
    });
    assert.equal(resAbsentRecover.ok, true, 'Recovering in-memory problem when key is genuinely absent must succeed');
    assert.equal(resAbsentRecover.status, 'complete');
    assert.equal(localStorage.getWriteCount('problems_v1'), 1);
    assert.equal(storage.loadStoredProblems().length, 1);
    assert.equal(storage.loadStoredProblems()[0].id, 'prob_A');
    assert.equal(storage.loadStoredProblems()[0].version, 3);
  });

  await checkAsync('Reproduction 3: Retry after partial_cleanup_failed must clean up target revision with 0 writes to problems_v1', async () => {
    const storage = load(path.join(output, 'lib/storage.js'));
    const revSync = load(path.join(output, 'lib/problemRevisionSync.js'));
    const storageScope = load(path.join(output, 'lib/storageScope.js'));
    localStorage.clear();
    storage.clearAllUnsavedProblemRevisions();

    const probId = 'p_repro3_cleanup_only';
    const baseRubric = [
      { id: 'r1', label: 'C1', maxScore: 100, weight: 1, description: 'Criterion 1' },
    ];
    const probV1 = {
      id: probId,
      subjectId: 'sub-1',
      type: 'essay_descriptive',
      categoryLabel: 'T',
      categoryNumber: 1,
      conceptIds: ['c-1'],
      sourceRefs: 'S1',
      timeBreakdownDesc: '15m',
      coreEvaluationHighlight: 'H1',
      itemCountDesc: '1',
      title: 'Title v1',
      promptText: 'Prompt v1',
      hints: ['H1'],
      modelAnswer: 'Answer v1',
      rubric: baseRubric,
      timeStandardMinutes: 15,
      version: 1,
      serverConfirmedVersion: 1,
      versionHistory: [],
    };
    storage.saveStoredProblems([probV1]);
    storage.editAndReviseProblem(probId, { promptText: 'Edit v2' }, 'Reason v2');
    const rev = storage.getEffectiveUnsavedProblemRevision(probId);
    const serverV3 = {
      ...probV1,
      title: 'Server Title v3',
      promptText: 'Server Prompt v3',
      modelAnswer: 'Server Answer v3',
      version: 3,
      serverConfirmedVersion: 3,
    };
    storage.recordProblemRevisionMismatchConflict(probId, {
      targetRevisionId: rev.revisionId,
      targetGeneration: rev.generation,
      confirmedVersion: 3,
      saveConfirmedOnServer: true,
      errorMessage: 'Conflict v3',
      serverLatestProblem: serverV3,
    });

    // Also put a protected revision on a sibling problem to verify only target problem's revision is removed
    storage.saveUnsavedProblemRevision({
      ...rev,
      problemId: 'p_repro3_sibling',
      revisionId: 'rev-sibling-keep',
    });

    // Step 1: accept_server succeeds on problems_v1 write & read-back, fails on unsaved_problem_revisions_v1 cleanup
    localStorage.setBlockedKeys(['unsaved_problem_revisions_v1']);
    localStorage.resetWriteCounts();
    let firstRes;
    try {
      firstRes = storage.resolveProblemRevisionConflict(probId, 'accept_server', {
        revisionId: rev.revisionId,
        generation: rev.generation,
        serverProblem: serverV3,
      });
    } finally {
      localStorage.setBlockedKeys([]);
    }
    assert.equal(firstRes.status, 'partial_cleanup_failed');
    assert.equal(localStorage.getWriteCount('problems_v1'), 1, 'First accept_server writes problems_v1 once');

    // Step 2: Retry using the UI button request builder
    const activeUnsavedNow = storage.getEffectiveUnsavedProblemRevision(probId);
    const retryReq =
      typeof revSync.buildConflictResolutionRequest === 'function'
        ? revSync.buildConflictResolutionRequest(activeUnsavedNow, 'accept_server', firstRes)
        : {
            action: 'accept_server',
            params: {
              revisionId: activeUnsavedNow.revisionId,
              generation: activeUnsavedNow.generation,
              serverProblem: activeUnsavedNow.serverLatestSummary,
            },
          };
    assert.equal(retryReq.action, 'retry_cleanup');
    localStorage.resetWriteCounts();
    const secondRes = storage.resolveProblemRevisionConflict(probId, retryReq.action, retryReq.params);

    assert.equal(secondRes.ok, true);
    assert.equal(secondRes.status, 'complete');
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Retry cleanup must write problems_v1 ZERO times');
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 1, 'Retry cleanup writes unsaved_problem_revisions_v1 once');
    assert.equal(storage.getUnsavedProblemRevision(probId), null, 'Protected revision cleaned up');
    assert.equal(storage.getInMemoryProblemRevision(probId), null, 'Memory revision cleaned up');
    assert.ok(storage.getUnsavedProblemRevision('p_repro3_sibling'), 'Sibling problem protected revision untouched');

    // Step 3: If another tab modified the persisted problem body in problems_v1 before retry_cleanup,
    // must NOT overwrite problems_v1 or delete the revision, and must guide to 저장 결과 다시 확인
    storage.saveUnsavedProblemRevision(activeUnsavedNow);
    const crossTabModifiedBody = {
      ...serverV3,
      promptText: 'Cross-tab modified prompt in problems_v1',
      version: 4,
      serverConfirmedVersion: 4,
    };
    storage.saveStoredProblems([crossTabModifiedBody]);
    localStorage.resetWriteCounts();
    const resCrossTabBody = storage.resolveProblemRevisionConflict(probId, 'retry_cleanup', retryReq.params);
    assert.equal(resCrossTabBody.ok, false);
    assert.equal(localStorage.getWriteCount('problems_v1'), 0, 'Zero writes to problems_v1 when cross-tab body changed');
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 0, 'Zero writes to unsaved_problem_revisions_v1 when cross-tab body changed');
    assert.equal(storage.loadStoredProblems()[0].promptText, 'Cross-tab modified prompt in problems_v1', 'Cross-tab body preserved');
    assert.ok(storage.getUnsavedProblemRevision(probId), 'Protected revision preserved when cross-tab body changed');
    assert.ok(resCrossTabBody.message.includes('저장 결과 다시 확인'), 'Guides user to 저장 결과 다시 확인');

    // Step 3b: If another tab modified the protected revision in unsaved_problem_revisions_v1 before retry_cleanup,
    // must NOT delete the modified revision and must guide to 저장 결과 다시 확인
    storage.saveStoredProblems([serverV3]);
    const crossTabModifiedRev = {
      ...activeUnsavedNow,
      revisionId: 'rev-cross-tab-newer',
      generation: (activeUnsavedNow.generation ?? 1) + 1,
      promptText: 'Cross-tab newer revision prompt',
    };
    storage.saveUnsavedProblemRevision(crossTabModifiedRev);
    localStorage.resetWriteCounts();
    const resCrossTabRev = storage.resolveProblemRevisionConflict(probId, 'retry_cleanup', retryReq.params);
    assert.equal(resCrossTabRev.ok, false);
    assert.equal(resCrossTabRev.status, 'stale_revision_aborted');
    assert.equal(localStorage.getWriteCount('problems_v1'), 0);
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 0);
    assert.equal(storage.getUnsavedProblemRevision(probId)?.promptText, 'Cross-tab newer revision prompt', 'Cross-tab newer revision preserved');
    assert.ok(resCrossTabRev.message.includes('저장 결과 다시 확인'), 'Guides user to 저장 결과 다시 확인');

    // Step 4: Account switch isolation during retry_cleanup
    storage.saveStoredProblems([serverV3]);
    const scopeBefore = storageScope.getStorageScopeId();
    storageScope.setStorageScope({ kind: 'user', userId: 'other_user_retry_cleanup' });
    localStorage.clear();
    localStorage.resetWriteCounts();
    const resScopeSwitch = storage.resolveProblemRevisionConflict(probId, 'retry_cleanup', {
      ...retryReq.params,
      scopeId: scopeBefore,
    });
    assert.equal(resScopeSwitch.ok, false);
    assert.equal(resScopeSwitch.status, 'scope_changed');
    assert.equal(localStorage.getWriteCount('problems_v1'), 0);
    assert.equal(localStorage.getWriteCount('unsaved_problem_revisions_v1'), 0);
    storageScope.setStorageScope({ kind: 'legacy' });
  });

  console.log(`${passed} concurrency regression checks passed`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));