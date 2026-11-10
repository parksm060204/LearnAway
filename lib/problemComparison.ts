import type {
  Problem,
  ProblemType,
  ProblemVersionSnapshot,
  RubricCriterion,
} from './types';

/**
 * Explicit per-field array ordering semantics for problem comparison:
 * - `rubric`: 'ordered' — 채점 기준 항목은 표시 및 평가 순서가 의미 있으므로 배열 순서를 보존하여 비교한다.
 * - `hints`: 'ordered' — 단계별 힌트는 순차 공개 순서가 의미 있으므로 배열 순서를 보존하여 비교한다.
 * - `conceptIds`: 'unordered' — 문제에 연결된 개념 ID 목록은 집합 동등성(정렬 후 비교)으로 비교한다.
 */
export const PROBLEM_ARRAY_ORDER_POLICY = {
  rubric: 'ordered',
  hints: 'ordered',
  conceptIds: 'unordered',
} as const;

export function normalizeProblemText(val?: string | null): string {
  if (val === undefined || val === null) return '';
  return String(val).replace(/\r\n/g, '\n').trim();
}

/**
 * Normalizes code snippets by converting CRLF to LF and stripping only
 * leading/trailing blank newlines (`\n`), strictly preserving all leading
 * spaces/tabs (indentation) on every line including the first line.
 */
export function normalizeProblemCode(val?: string | null): string {
  if (val === undefined || val === null) return '';
  return String(val).replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

export interface NormalizedRubricCriterion {
  id: string;
  label: string;
  criterion: string;
  criteria: string;
  description: string;
  maxScore: number;
  points: number | null;
  weight: number;
  extraEntries: Array<[string, unknown]>;
}

const KNOWN_RUBRIC_KEYS = new Set([
  'id',
  'label',
  'criterion',
  'criteria',
  'description',
  'maxScore',
  'points',
  'weight',
]);

function canonicalizeValue(val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(canonicalizeValue);
  const record = val as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    out[key] = canonicalizeValue(record[key]);
  }
  return out;
}

/**
 * Normalizes a rubric item into a canonical key-order-independent structure.
 * Preserves all meaningful evaluation fields (`id`, `label`, `criterion`, `criteria`,
 * `description`, `maxScore`, `points`, `weight`) and any additional defined keys.
 */
export function normalizeRubricCriterion(item: unknown): NormalizedRubricCriterion {
  if (!item || typeof item !== 'object') {
    return {
      id: '',
      label: '',
      criterion: '',
      criteria: '',
      description: '',
      maxScore: 0,
      points: null,
      weight: 0,
      extraEntries: [],
    };
  }
  const r = item as Record<string, unknown>;
  const rawMaxScore = r.maxScore !== undefined && r.maxScore !== null ? r.maxScore : r.points;
  const maxScoreNum = rawMaxScore !== undefined && rawMaxScore !== null ? Number(rawMaxScore) : 0;
  const pointsNum = r.points !== undefined && r.points !== null ? Number(r.points) : null;
  const weightNum = r.weight !== undefined && r.weight !== null ? Number(r.weight) : 0;

  const extraKeys = Object.keys(r)
    .filter((k) => !KNOWN_RUBRIC_KEYS.has(k) && r[k] !== undefined)
    .sort();
  const extraEntries: Array<[string, unknown]> = extraKeys.map((k) => [
    k,
    typeof r[k] === 'string' ? normalizeProblemText(r[k] as string) : canonicalizeValue(r[k]),
  ]);

  return {
    id: normalizeProblemText(typeof r.id === 'string' ? r.id : String(r.id ?? '')),
    label: normalizeProblemText(typeof r.label === 'string' ? r.label : undefined),
    criterion: normalizeProblemText(typeof r.criterion === 'string' ? r.criterion : undefined),
    criteria: normalizeProblemText(typeof r.criteria === 'string' ? r.criteria : undefined),
    description: normalizeProblemText(typeof r.description === 'string' ? r.description : undefined),
    maxScore: Number.isFinite(maxScoreNum) ? maxScoreNum : 0,
    points: pointsNum !== null && Number.isFinite(pointsNum) ? pointsNum : null,
    weight: Number.isFinite(weightNum) ? weightNum : 0,
    extraEntries,
  };
}

/**
 * Compares two rubric arrays in element order (`PROBLEM_ARRAY_ORDER_POLICY.rubric = 'ordered'`),
 * independent of JSON/JSONB object key order.
 */
export function rubricsEqual(
  a?: readonly unknown[] | null,
  b?: readonly unknown[] | null
): boolean {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;

  for (let i = 0; i < listA.length; i++) {
    const normA = normalizeRubricCriterion(listA[i]);
    const normB = normalizeRubricCriterion(listB[i]);
    if (
      normA.id !== normB.id ||
      normA.label !== normB.label ||
      normA.criterion !== normB.criterion ||
      normA.criteria !== normB.criteria ||
      normA.description !== normB.description ||
      normA.maxScore !== normB.maxScore ||
      normA.points !== normB.points ||
      normA.weight !== normB.weight ||
      JSON.stringify(normA.extraEntries) !== JSON.stringify(normB.extraEntries)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Compares two hint arrays in element order (`PROBLEM_ARRAY_ORDER_POLICY.hints = 'ordered'`).
 */
export function hintsEqual(
  a?: readonly string[] | null,
  b?: readonly string[] | null
): boolean {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (normalizeProblemText(listA[i]) !== normalizeProblemText(listB[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Compares two conceptId lists as an order-independent set (`PROBLEM_ARRAY_ORDER_POLICY.conceptIds = 'unordered'`).
 */
export function conceptIdsEqual(
  a?: readonly string[] | null,
  b?: readonly string[] | null
): boolean {
  const listA = (Array.isArray(a) ? a : []).map((c) => normalizeProblemText(c)).sort();
  const listB = (Array.isArray(b) ? b : []).map((c) => normalizeProblemText(c)).sort();
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i] !== listB[i]) return false;
  }
  return true;
}

/**
 * Canonical evaluation-affecting content signature shared between
 * version bump detection in `buildProblemFromDraft`, local edit detection,
 * and persistence verification in `problemContentMatches`.
 *
 * Key order inside rubric items does not affect the signature, and code indentation is preserved.
 */
export function getProblemEvaluationSignature(p: {
  type?: ProblemType;
  conceptIds?: string[];
  title: string;
  promptText: string;
  appliedConditionNote?: string;
  mathFormula?: string;
  codeSnippet?: string;
  modelAnswer: string;
  hints: string[];
  rubric: RubricCriterion[];
  timeStandardMinutes?: number;
  designIntent?: string;
}): string {
  const sortedConcepts = [...(p.conceptIds || [])].map((c) => normalizeProblemText(c)).sort();
  const normalizedRubric = (p.rubric || []).map((r) => normalizeRubricCriterion(r));
  const normalizedHints = (p.hints || []).map((h) => normalizeProblemText(h));
  const timeMinutes =
    p.timeStandardMinutes !== undefined && p.timeStandardMinutes !== null
      ? Number(p.timeStandardMinutes)
      : 0;

  return JSON.stringify([
    normalizeProblemText(p.type),
    sortedConcepts,
    normalizeProblemText(p.title),
    normalizeProblemText(p.promptText),
    normalizeProblemText(p.appliedConditionNote),
    normalizeProblemText(p.mathFormula),
    normalizeProblemCode(p.codeSnippet),
    normalizeProblemText(p.modelAnswer),
    normalizedHints,
    normalizedRubric,
    Number.isFinite(timeMinutes) ? timeMinutes : 0,
    normalizeProblemText(p.designIntent),
  ]);
}

/**
 * Compares the evaluation-affecting content, transfer linkage, version, and required metadata
 * of two stored `Problem` objects.
 */
export function problemContentMatches(a: Problem, b: Problem): boolean {
  if (a.version !== b.version) return false;
  if (getProblemEvaluationSignature(a) !== getProblemEvaluationSignature(b)) {
    return false;
  }
  const isTransferA = Boolean(a.isTransfer);
  const isTransferB = Boolean(b.isTransfer);
  if (isTransferA !== isTransferB) return false;
  if (isTransferA) {
    if (
      (a.sourceProblemId || '') !== (b.sourceProblemId || '') ||
      (a.logicSessionId || '') !== (b.logicSessionId || '') ||
      (a.transferChanges || '') !== (b.transferChanges || '') ||
      (a.understandingFocus || '') !== (b.understandingFocus || '') ||
      (a.transferKind || '') !== (b.transferKind || '') ||
      (a.originalCondition || '') !== (b.originalCondition || '') ||
      (a.newCondition || '') !== (b.newCondition || '')
    ) {
      return false;
    }
  }
  if (
    a.subjectId !== b.subjectId ||
    (a.difficulty || '') !== (b.difficulty || '') ||
    (a.sourceRefs || '') !== (b.sourceRefs || '') ||
    (a.draftId || '') !== (b.draftId || '')
  ) {
    return false;
  }
  return true;
}

/**
 * Validates that a snapshot or server problem candidate contains the required
 * evaluation fields (`title`, `promptText`, `modelAnswer`, `rubric`).
 * Incomplete or empty snapshots must never be assumed to match a submitted problem.
 */
export function isCompleteProblemSnapshot(
  candidate: (Partial<ProblemVersionSnapshot> & Partial<Problem>) | null | undefined
): candidate is Partial<ProblemVersionSnapshot> & Partial<Problem> {
  if (!candidate || typeof candidate !== 'object') return false;
  if (typeof candidate.title !== 'string' || normalizeProblemText(candidate.title).length === 0) {
    return false;
  }
  if (typeof candidate.promptText !== 'string' || normalizeProblemText(candidate.promptText).length === 0) {
    return false;
  }
  if (typeof candidate.modelAnswer !== 'string' || normalizeProblemText(candidate.modelAnswer).length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.rubric) || candidate.rubric.length === 0) {
    return false;
  }
  for (const item of candidate.rubric) {
    if (!item || typeof item !== 'object') return false;
    const rec = item as unknown as Record<string, unknown>;
    const rawScore = rec.maxScore !== undefined && rec.maxScore !== null ? rec.maxScore : rec.points;
    const scoreNum = rawScore !== undefined && rawScore !== null ? Number(rawScore) : NaN;
    if (!Number.isFinite(scoreNum)) return false;
  }
  return true;
}

/**
 * Verifies that a server version snapshot (or server problem row) matches the
 * evaluation-affecting content of a submitted `Problem` after `reviseProblem`.
 *
 * - Rejects incomplete snapshots (`isCompleteProblemSnapshot` === false).
 * - Compares rubric items independent of JSONB key ordering while detecting all
 *   meaningful changes (`id`, `label`, `criterion`, `description`, `maxScore`, `weight`).
 * - Preserves code snippet indentation (`normalizeProblemCode`).
 */
export function snapshotEvaluationMatchesProblem(
  submitted: Problem,
  candidate: (Partial<ProblemVersionSnapshot> & Partial<Problem>) | null | undefined
): boolean {
  if (!isCompleteProblemSnapshot(candidate)) {
    return false;
  }
  if (normalizeProblemText(submitted.title) !== normalizeProblemText(candidate.title)) return false;
  if (normalizeProblemText(submitted.promptText) !== normalizeProblemText(candidate.promptText)) return false;
  if (normalizeProblemText(submitted.modelAnswer) !== normalizeProblemText(candidate.modelAnswer)) return false;
  if (normalizeProblemText(submitted.mathFormula) !== normalizeProblemText(candidate.mathFormula)) return false;
  if (normalizeProblemCode(submitted.codeSnippet) !== normalizeProblemCode(candidate.codeSnippet)) return false;
  if (
    normalizeProblemText(submitted.appliedConditionNote) !==
    normalizeProblemText(candidate.appliedConditionNote)
  ) {
    return false;
  }
  if (submitted.type !== undefined || candidate.type !== undefined) {
    if (normalizeProblemText(submitted.type) !== normalizeProblemText(candidate.type)) {
      return false;
    }
  }
  if (submitted.timeStandardMinutes !== undefined || candidate.timeStandardMinutes !== undefined) {
    const subTime = submitted.timeStandardMinutes !== undefined ? Number(submitted.timeStandardMinutes) : 0;
    const candTime = candidate.timeStandardMinutes !== undefined ? Number(candidate.timeStandardMinutes) : 0;
    if (subTime !== candTime) return false;
  }
  if (!rubricsEqual(submitted.rubric, candidate.rubric)) return false;
  if (!hintsEqual(submitted.hints, candidate.hints)) return false;
  if (!conceptIdsEqual(submitted.conceptIds, candidate.conceptIds)) return false;
  if (candidate.designIntent !== undefined) {
    if (normalizeProblemText(submitted.designIntent) !== normalizeProblemText(candidate.designIntent)) {
      return false;
    }
  }
  return true;
}

function findMatchingHistorySnapshot(
  unsaved: {
    baseVersion?: number;
    revisionVersion?: number;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): ProblemVersionSnapshot | undefined {
  if (!referenceSnapshots || referenceSnapshots.length === 0) return undefined;
  if (unsaved.baseVersion !== undefined) {
    const byBase = referenceSnapshots.find((s) => s && s.version === unsaved.baseVersion);
    if (byBase) return byBase;
  }
  if (unsaved.revisionVersion !== undefined) {
    const byRev = referenceSnapshots.find((s) => s && s.version === unsaved.revisionVersion);
    if (byRev) return byRev;
  }
  return undefined;
}

function resolveReferenceSnapshot(
  unsaved: {
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): ProblemVersionSnapshot | undefined {
  const fromHistory = findMatchingHistorySnapshot(unsaved, referenceSnapshots);
  if (unsaved.baseSnapshot && fromHistory) {
    return {
      ...fromHistory,
      ...unsaved.baseSnapshot,
      type: unsaved.baseSnapshot.type ?? fromHistory.type,
      conceptIds: unsaved.baseSnapshot.conceptIds ?? fromHistory.conceptIds,
      appliedConditionNote: unsaved.baseSnapshot.appliedConditionNote ?? fromHistory.appliedConditionNote,
    };
  }
  return unsaved.baseSnapshot ?? fromHistory;
}

export function hasVerifiableConditionNote(
  unsaved: {
    appliedConditionNote?: string;
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): { verifiable: boolean; value?: string } {
  if ('appliedConditionNote' in unsaved && unsaved.appliedConditionNote !== undefined) {
    return { verifiable: true, value: unsaved.appliedConditionNote };
  }
  if (
    unsaved.baseSnapshot &&
    'appliedConditionNote' in unsaved.baseSnapshot &&
    unsaved.baseSnapshot.appliedConditionNote !== undefined
  ) {
    return { verifiable: true, value: unsaved.baseSnapshot.appliedConditionNote };
  }
  const refSnap = findMatchingHistorySnapshot(unsaved, referenceSnapshots);
  if (refSnap && 'appliedConditionNote' in refSnap && refSnap.appliedConditionNote !== undefined) {
    return { verifiable: true, value: refSnap.appliedConditionNote };
  }
  return { verifiable: false };
}

/**
 * Checks if an unsaved revision (or snapshot/problem) matches a remote `Problem`.
 * Preserves legacy revision backward-compatibility by resolving `type`, `conceptIds`,
 * and `appliedConditionNote` from `baseSnapshot` or `referenceSnapshots` when omitted
 * on older revision records, while refusing to loosely match unverifiable condition notes.
 */
export function isRevisionMatchingProblem(
  unsaved: {
    title?: string;
    promptText?: string;
    type?: Problem['type'];
    conceptIds?: string[];
    modelAnswer?: string;
    rubric?: Problem['rubric'];
    mathFormula?: string;
    codeSnippet?: string;
    hints?: string[];
    timeStandardMinutes?: number;
    appliedConditionNote?: string;
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  remote: Problem,
  referenceSnapshots?: ProblemVersionSnapshot[]
): boolean {
  if (normalizeProblemText(unsaved.promptText) !== normalizeProblemText(remote.promptText)) return false;
  if (normalizeProblemText(unsaved.modelAnswer) !== normalizeProblemText(remote.modelAnswer)) return false;
  if (normalizeProblemText(unsaved.title) !== normalizeProblemText(remote.title)) return false;
  if (normalizeProblemText(unsaved.mathFormula) !== normalizeProblemText(remote.mathFormula)) return false;
  if (normalizeProblemCode(unsaved.codeSnippet) !== normalizeProblemCode(remote.codeSnippet)) return false;

  const refSnap = resolveReferenceSnapshot(unsaved, referenceSnapshots);

  // Problem type comparison (with fallback to reference snapshot for legacy revisions)
  const expectedType = unsaved.type !== undefined ? unsaved.type : refSnap?.type;
  if (expectedType !== undefined && remote.type !== undefined) {
    if (normalizeProblemText(expectedType) !== normalizeProblemText(remote.type)) return false;
  }

  // Concept IDs comparison (with fallback to reference snapshot for legacy revisions)
  const expectedConcepts = Array.isArray(unsaved.conceptIds)
    ? unsaved.conceptIds
    : Array.isArray(refSnap?.conceptIds)
      ? refSnap.conceptIds
      : undefined;
  if (expectedConcepts !== undefined && Array.isArray(remote.conceptIds)) {
    if (!conceptIdsEqual(expectedConcepts, remote.conceptIds)) return false;
  }

  // Applied condition note comparison with backward compatibility for legacy revisions
  const condCheck = hasVerifiableConditionNote(unsaved, referenceSnapshots);
  if (condCheck.verifiable) {
    if (normalizeProblemText(condCheck.value) !== normalizeProblemText(remote.appliedConditionNote)) {
      return false;
    }
  } else if (normalizeProblemText(remote.appliedConditionNote) !== '') {
    return false;
  }

  // Time standard comparison
  if (unsaved.timeStandardMinutes !== undefined || remote.timeStandardMinutes !== undefined) {
    const uTime = unsaved.timeStandardMinutes !== undefined ? Number(unsaved.timeStandardMinutes) : 0;
    const rTime = remote.timeStandardMinutes !== undefined ? Number(remote.timeStandardMinutes) : 0;
    if (uTime !== rTime) return false;
  }

  // Full rubric comparison (key-order-independent)
  if (!rubricsEqual(unsaved.rubric, remote.rubric)) return false;

  // Ordered hints comparison
  if (!hintsEqual(unsaved.hints, remote.hints)) return false;

  return true;
}
