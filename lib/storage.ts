import {
  Subject,
  Material,
  Concept,
  ConceptDraft,
  ConceptStatus,
  Problem,
  ProblemDraft,
  Attempt,
  RetentionModelSettings,
  ReviewEvent,
  ProblemReport,
  ProblemReportType,
  ProblemQualityStatus,
  ProblemVersionSnapshot,
  StudyPlanSettings,
  StudyPlanItem,
  DEFAULT_STUDY_PLAN_SETTINGS,
  PersonalizationSettings,
  PersonalizationCorrectionState,
  DEFAULT_PERSONALIZATION_SETTINGS,
  AttemptSaveStatus,
  toAcademicDifficultyLevel,
  SourceVerificationStatus,
  UnsavedProblemRevision,
  UnsavedProblemRevisionPriorVerification,
  ProblemRevisionVerificationFailureReason,
  ConceptScheduleAdjustment,
} from './types';

export type { AttemptSaveStatus } from './types';
import {
  INITIAL_SUBJECTS,
  INITIAL_MATERIALS,
  INITIAL_CONCEPTS,
  INITIAL_PROBLEMS,
} from './initialData';
import {
  DEFAULT_RETENTION_SETTINGS,
  calculateCurrentConceptScore,
  calculateConceptMasteryScore,
  getConceptStatusFromScore,
} from './retentionModel';
import { addDaysToDate } from './dateUtils';
import { computeMarkdownHash, verifyPageGrounding } from './markdownUtils';
import { completeRechallengeReservation } from './logicSession';
import {
  isMaterialBodyPersisted,
  loadMaterialContentInScope,
  saveMaterialContentInScope,
  unmarkMaterialBodyPersistedInScope,
} from './materialStorage';
import { materialContentHash } from './cloud/hash';
import {
  getProblemEvaluationSignature,
  problemContentMatches,
  isRevisionMatchingProblem,
  isCompleteProblemSnapshot,
  snapshotEvaluationMatchesProblem,
} from './problemComparison';

export { getProblemEvaluationSignature, problemContentMatches } from './problemComparison';
import {
  getStorageScopeId,
  scopedStorageKey,
  scopedStorageKeyForScopeId,
  isKeyInActiveScope,
  getStorageScope,
  getScopedStoragePrefix,
  LEGACY_KEY_PREFIX,
} from './storageScope';

// Base key names. The `redcall_` prefix and user namespace are applied by
// scopedStorageKey() so legacy (pre-login) data keeps its exact historical keys.
const STORAGE_KEYS = {
  CURRENT_SUBJECT_ID: 'active_subject_id',
  SUBJECTS: 'subjects_v1',
  MATERIALS: 'materials_v1',
  CONCEPTS: 'concepts_v1',
  CONCEPT_DRAFTS: 'concept_drafts_v1',
  PROBLEMS: 'problems_v1',
  PROBLEM_DRAFTS: 'problem_drafts_v1',
  ATTEMPTS: 'attempts_v1',
  SETTINGS: 'retention_settings_v1',
  STUDY_PLAN_SETTINGS: 'study_plan_settings_v1',
  STUDY_PLAN_ITEMS: 'study_plan_items_v1',
  PERSONALIZATION_SETTINGS: 'personalization_settings_v1',
  PERSONALIZATION_STATE: 'personalization_state_v1',
  UNSAVED_PROBLEM_REVISIONS: 'unsaved_problem_revisions_v1',
  CONCEPT_SCHEDULE_ADJUSTMENTS: 'concept_schedule_adjustments_v1',
} as const;

const MOCK_EXAM_KEY = 'mock_exam_sessions_v1';
const LOGIC_SESSIONS_KEY = 'logic_sessions_v1';
const REC_HALLENGE_KEY = 'rechallenge_reservations_v1';

let testStorageAdapterOverride: Storage | null | undefined = undefined;

/**
 * Explicitly configures a Storage adapter for Node/unit tests (or resets to default browser lookup when undefined).
 * Passing `null` forces storage unavailability (simulating blocked/disabled persistent storage).
 */
export function setStorageAdapterForTest(adapter: Storage | null | undefined): void {
  testStorageAdapterOverride = adapter;
}

function getLocalStorage(): Storage | null {
  if (testStorageAdapterOverride !== undefined) {
    return testStorageAdapterOverride;
  }
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      return window.localStorage || null;
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function safeGetItem<T>(baseKey: string, fallback: T): T {
  const key = scopedStorageKey(baseKey);
  const storage = getLocalStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to parse localStorage key ${key}`, e);
    return fallback;
  }
}

function safeSetItem<T>(baseKey: string, val: T): boolean {
  const key = scopedStorageKey(baseKey);
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(val);
    storage.setItem(key, serialized);
    const readBack = storage.getItem(key);
    if (readBack !== serialized) {
      console.error(`Read-after-write verification failed for ${key}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Failed to write localStorage key ${key}`, e);
    return false;
  }
}

function safeRemoveItem(baseKey: string): boolean {
  const key = scopedStorageKey(baseKey);
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    const readBack = storage.getItem(key);
    if (readBack !== null) {
      console.error(`Read-after-delete verification failed for ${key}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Failed to remove localStorage key ${key}`, e);
    return false;
  }
}

export interface StoredDataIntegrity {
  ok: boolean;
  failedKeys: string[];
}

type StoredValueShape =
  | { kind: 'string' }
  | { kind: 'object' }
  | { kind: 'arrayRecords'; requiredStringFields: string[] };

/**
 * Expected top-level shape for each known record. Unknown keys only need valid
 * JSON. This catches structural corruption (e.g. `null` where an array is
 * expected) that would crash later `.map()`/`.some()` calls.
 */
const STORED_VALUE_SHAPES: Record<string, StoredValueShape> = {
  active_subject_id: { kind: 'string' },
  subjects_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  materials_v1: { kind: 'arrayRecords', requiredStringFields: ['id', 'subjectId'] },
  concepts_v1: { kind: 'arrayRecords', requiredStringFields: ['id', 'subjectId'] },
  concept_drafts_v1: { kind: 'arrayRecords', requiredStringFields: ['id', 'subjectId'] },
  problems_v1: { kind: 'arrayRecords', requiredStringFields: ['id', 'subjectId'] },
  problem_drafts_v1: { kind: 'arrayRecords', requiredStringFields: ['id', 'subjectId'] },
  attempts_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  mock_exam_sessions_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  logic_sessions_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  rechallenge_reservations_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  study_plan_items_v1: { kind: 'arrayRecords', requiredStringFields: ['id'] },
  retention_settings_v1: { kind: 'object' },
  study_plan_settings_v1: { kind: 'object' },
  personalization_settings_v1: { kind: 'object' },
  personalization_state_v1: { kind: 'object' },
};

function baseKeyForActiveScope(rawKey: string): string | null {
  if (!isKeyInActiveScope(rawKey)) return null;
  if (getStorageScope().kind === 'user') {
    return rawKey.slice(getScopedStoragePrefix().length);
  }
  return rawKey.slice(LEGACY_KEY_PREFIX.length);
}

function matchesStoredShape(baseKey: string, parsed: unknown): boolean {
  const shape = STORED_VALUE_SHAPES[baseKey];
  if (!shape) return true;

  if (shape.kind === 'string') {
    return typeof parsed === 'string';
  }
  if (shape.kind === 'object') {
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  }
  if (!Array.isArray(parsed)) return false;
  return parsed.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      shape.requiredStringFields.every(
        (field) => typeof (item as Record<string, unknown>)[field] === 'string'
      )
  );
}

/**
 * Detects corrupt local records for the active scope.
 *
 * A missing key is a valid empty account. Invalid JSON, a wrong top-level type,
 * or records missing required string fields are reported so callers can show an
 * error + retry instead of silently presenting an empty account or substituting
 * demo data.
 */
export function checkStoredDataIntegrity(): StoredDataIntegrity {
  if (typeof window === 'undefined' && testStorageAdapterOverride === undefined) {
    return { ok: true, failedKeys: [] };
  }

  const failedKeys: string[] = [];
  try {
    const storage = testStorageAdapterOverride !== undefined ? testStorageAdapterOverride : window.localStorage;
    if (!storage) {
      return { ok: false, failedKeys: ['localStorage'] };
    }
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      const baseKey = baseKeyForActiveScope(key);
      if (baseKey === null) continue;
      const raw = storage.getItem(key);
      if (raw === null || raw === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        failedKeys.push(key);
        continue;
      }
      if (!matchesStoredShape(baseKey, parsed)) {
        failedKeys.push(key);
      }
    }
  } catch {
    return { ok: false, failedKeys: ['localStorage'] };
  }

  return { ok: failedKeys.length === 0, failedKeys };
}

export function loadStoredSubjects(): Subject[] {
  return safeGetItem<Subject[]>(STORAGE_KEYS.SUBJECTS, []);
}

export function saveStoredSubjects(subjects: Subject[]): void {
  safeSetItem(STORAGE_KEYS.SUBJECTS, subjects);
}

export function loadActiveSubjectId(): string {
  const subjects = loadStoredSubjects();
  const stored = safeGetItem<string>(STORAGE_KEYS.CURRENT_SUBJECT_ID, '');
  return subjects.some((subject) => subject.id === stored) ? stored : subjects[0]?.id || '';
}

export function saveActiveSubjectId(id: string): void {
  safeSetItem(STORAGE_KEYS.CURRENT_SUBJECT_ID, id);
}

export function loadStoredMaterials(): Material[] {
  const loaded = safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, []);
  const deletedIds = deletedMaterialMarkerIds();
  const registry = readBodyHashRegistry();
  return (Array.isArray(loaded) ? loaded : [])
    // An explicitly deleted id never comes back through any read path, even if
    // a stale wholesale list save managed to write it before being filtered.
    .filter((m) => !(m && deletedIds.has(m.id)))
    .map((m) => ({
      ...m,
      status: m.status || (m.isConverted ? 'ready' : 'converting'),
      isDemo: m.isDemo ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
      hasAiConcepts: m.hasAiConcepts ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
      hasAiProblems: m.hasAiProblems ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
      // The body-hash registry is the maintained local source for this local-only
      // field: it survives cloud metadata refreshes that replace this list. The
      // hash is merged ONLY when the recorded identity still matches this record.
      bodyHash: mergeStoredBodyHash(registry, m),
    }));
}

// ---------------------------------------------------------------------------
// Explicit deletion ledger (account-scoped).
//
// A material deleted on this device is recorded here so that a LATER wholesale
// list save (e.g. a cloud snapshot that was read before the delete committed)
// cannot resurrect it. A stale snapshot save is filtered out by material id;
// a fresh authoritative load that shows the id again clears the marker,
// because then the material legitimately exists on the server once more.
// ---------------------------------------------------------------------------

const DELETED_MATERIAL_IDS_KEY = 'deleted_material_ids_v1';

interface DeletedMaterialMarker {
  deletedAt: string;
}

function readDeletedMaterialMarkers(): Record<string, DeletedMaterialMarker> {
  return safeGetItem<Record<string, DeletedMaterialMarker>>(DELETED_MATERIAL_IDS_KEY, {});
}

function writeDeletedMaterialMarkers(registry: Record<string, DeletedMaterialMarker>): boolean {
  safeSetItem(DELETED_MATERIAL_IDS_KEY, registry);
  const readBack = safeGetItem<Record<string, DeletedMaterialMarker>>(DELETED_MATERIAL_IDS_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

function deletedMaterialMarkerIds(): Set<string> {
  return new Set(Object.keys(readDeletedMaterialMarkers()));
}

/** Records an explicitly deleted material so later saves cannot resurrect it. */
export function markMaterialDeleted(materialId: string): void {
  if (!materialId) return;
  const registry = readDeletedMaterialMarkers();
  registry[materialId] = { deletedAt: new Date().toISOString() };
  writeDeletedMaterialMarkers(registry);
  // A deleted material is no longer local-only and has no pending save state.
  clearLocalOnlyMaterialMarker(materialId);
  clearMaterialSaveFailed(materialId);
  clearMaterialSyncState(materialId);
  clearMaterialServerSaveRecord(materialId);
  clearMaterialPostprocessState(materialId);
}

/** Clears the marker when the material legitimately exists again (explicit restore, re-upload). */
export function clearDeletedMaterialMarker(materialId: string): void {
  if (!materialId) return;
  const registry = readDeletedMaterialMarkers();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeDeletedMaterialMarkers(registry);
}

/**
 * Reconciles the deletion ledger against a freshly loaded, authoritative server
 * list. Markers whose delete committed BEFORE the load started are cleared when
 * the ids are visible again (a legitimate server-side re-add); markers from a
 * delete committed DURING or after the load stay, because that snapshot may be
 * stale. Returns the ids that remain explicitly deleted and must be excluded
 * from wholesale saves and server-derived UI state.
 */
export function reconcileDeletedMaterialMarkers(
  visibleServerIds: string[],
  loadStartedAt: string
): Set<string> {
  const registry = readDeletedMaterialMarkers();
  for (const id of visibleServerIds) {
    const marker = registry[id];
    if (marker && marker.deletedAt <= loadStartedAt) {
      delete registry[id];
    }
  }
  writeDeletedMaterialMarkers(registry);
  return new Set(Object.keys(registry));
}

// ---------------------------------------------------------------------------
// Local-only material markers (account-scoped).
//
// A material that exists ONLY on this device (e.g. restored from a backup and
// not (yet) on the server) is recorded here. A server cache replacement merges
// these back in instead of dropping them just because the server list lacks
// them. The marker is cleared once the server list actually contains the id.
// ---------------------------------------------------------------------------

const LOCAL_ONLY_MATERIAL_IDS_KEY = 'local_only_material_ids_v1';

interface LocalOnlyMaterialMarker {
  markedAt: string;
}

function readLocalOnlyMaterialMarkers(): Record<string, LocalOnlyMaterialMarker> {
  return safeGetItem<Record<string, LocalOnlyMaterialMarker>>(LOCAL_ONLY_MATERIAL_IDS_KEY, {});
}

function writeLocalOnlyMaterialMarkers(registry: Record<string, LocalOnlyMaterialMarker>): boolean {
  safeSetItem(LOCAL_ONLY_MATERIAL_IDS_KEY, registry);
  const readBack = safeGetItem<Record<string, LocalOnlyMaterialMarker>>(LOCAL_ONLY_MATERIAL_IDS_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

/** Marks a material that lives ONLY on this device (restored / explicitly local). */
export function markMaterialLocalOnly(materialId: string): void {
  if (!materialId) return;
  const registry = readLocalOnlyMaterialMarkers();
  registry[materialId] = { markedAt: new Date().toISOString() };
  writeLocalOnlyMaterialMarkers(registry);
}

/** Clears the local-only marker once the material is server-known (or deleted). */
export function clearLocalOnlyMaterialMarker(materialId: string): void {
  if (!materialId) return;
  const registry = readLocalOnlyMaterialMarkers();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeLocalOnlyMaterialMarkers(registry);
}

export function isLocalOnlyMaterial(materialId: string): boolean {
  return readLocalOnlyMaterialMarkers()[materialId] !== undefined;
}

// ---------------------------------------------------------------------------
// Material edit save-failure markers (account-scoped).
//
// A failed/partial edit save (server or device) is recorded here so the
// material list can show the real "저장 실패 · 재시도 필요" state instead of
// claiming a synced body. Cleared when a later save completes or the material
// is deleted / the data is reset.
// ---------------------------------------------------------------------------

const MATERIAL_SAVE_FAILURE_KEY = 'material_save_failures_v1';

export interface MaterialSaveFailure {
  failedAt: string;
  message: string;
}

function readMaterialSaveFailures(): Record<string, MaterialSaveFailure> {
  return safeGetItem<Record<string, MaterialSaveFailure>>(MATERIAL_SAVE_FAILURE_KEY, {});
}

function writeMaterialSaveFailures(registry: Record<string, MaterialSaveFailure>): boolean {
  safeSetItem(MATERIAL_SAVE_FAILURE_KEY, registry);
  const readBack = safeGetItem<Record<string, MaterialSaveFailure>>(MATERIAL_SAVE_FAILURE_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

/** Records that the material's latest edit save did not fully complete. */
export function markMaterialSaveFailed(materialId: string, message: string): void {
  if (!materialId) return;
  const registry = readMaterialSaveFailures();
  registry[materialId] = { failedAt: new Date().toISOString(), message };
  writeMaterialSaveFailures(registry);
}

/** Clears the failure marker after a fully successful save (or delete/reset). */
export function clearMaterialSaveFailed(materialId: string): void {
  if (!materialId) return;
  const registry = readMaterialSaveFailures();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeMaterialSaveFailures(registry);
}

export function isMaterialSaveFailed(materialId: string): boolean {
  return readMaterialSaveFailures()[materialId] !== undefined;
}

// ---------------------------------------------------------------------------
// Material body sync-state registry (account-scoped).
//
// '본문 동기화됨' is claimed ONLY when the server CONFIRMED a body whose hash
// equals the hash of the body last written to THIS device. Settings alone
// (syncBody), mere local presence, or a server body of a different version are
// never enough. A failed server lookup is never recorded as confirmed/absent.
// ---------------------------------------------------------------------------

const MATERIAL_SYNC_STATE_KEY = 'material_sync_states_v1';

export type MaterialSyncStatus = 'confirmed' | 'pending' | 'failed' | 'unknown' | 'not_required';

export interface MaterialSyncStateRecord {
  /** Body hash (materialContentHash) the SERVER confirmed for this material. */
  serverBodyHash?: string;
  /** Body hash (materialContentHash) of the body as last written to this device. */
  localBodyHash?: string;
  /** True when the server row stores a body (any version). */
  serverHasBody: boolean;
  status: MaterialSyncStatus;
  updatedAt: string;
}

function readMaterialSyncStates(): Record<string, MaterialSyncStateRecord> {
  return safeGetItem<Record<string, MaterialSyncStateRecord>>(MATERIAL_SYNC_STATE_KEY, {});
}

function writeMaterialSyncStates(registry: Record<string, MaterialSyncStateRecord>): boolean {
  safeSetItem(MATERIAL_SYNC_STATE_KEY, registry);
  const readBack = safeGetItem<Record<string, MaterialSyncStateRecord>>(MATERIAL_SYNC_STATE_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

/** Merges a partial update into the per-material sync-state record. */
export function recordMaterialSyncState(
  materialId: string,
  patch: Partial<Omit<MaterialSyncStateRecord, 'updatedAt'>> & { status: MaterialSyncStatus }
): void {
  if (!materialId) return;
  const registry = readMaterialSyncStates();
  const previous = registry[materialId];
  const next: MaterialSyncStateRecord = {
    serverHasBody: patch.serverHasBody ?? previous?.serverHasBody ?? false,
    status: patch.status,
    updatedAt: new Date().toISOString(),
  };
  if (patch.serverBodyHash !== undefined) next.serverBodyHash = patch.serverBodyHash;
  else if (previous?.serverBodyHash !== undefined) next.serverBodyHash = previous.serverBodyHash;
  if (patch.localBodyHash !== undefined) next.localBodyHash = patch.localBodyHash;
  else if (previous?.localBodyHash !== undefined) next.localBodyHash = previous.localBodyHash;
  registry[materialId] = next;
  writeMaterialSyncStates(registry);
}

export function getMaterialSyncState(materialId: string): MaterialSyncStateRecord | undefined {
  return readMaterialSyncStates()[materialId];
}

export function clearMaterialSyncState(materialId: string): void {
  if (!materialId) return;
  const registry = readMaterialSyncStates();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeMaterialSyncStates(registry);
}

// ---------------------------------------------------------------------------
// Server-save confirmation records (account-scoped).
//
// When a save response is lost, the retry must ask the SERVER (by content hash)
// whether that exact content is already stored, instead of uploading again and
// bumping the version. Only syncBody:true edit saves are recorded here.
// ---------------------------------------------------------------------------

const MATERIAL_SERVER_SAVE_KEY = 'material_server_saves_v1';

export interface MaterialServerSaveRecord {
  /** materialContentHash of the content the previous attempt tried to write. */
  contentHash: string;
  /** Server body hash BEFORE the attempt (undefined for a legacy record). */
  baseHash?: string | null;
  /** Server row version BEFORE the attempt. */
  baseVersion?: number;
  /** Whether the policy syncs the body (false = metadata-only write). */
  syncBody?: boolean;
  /** Job id of the attempt, so the SAME job can be re-run safely. */
  jobId?: string | null;
  /** Intended title at save time (metadata-match proof for already_saved). */
  targetTitle?: string;
  /** Intended status at save time. */
  targetStatus?: string;
  /** Intended kind at save time. */
  targetKind?: string;
  /** Intended body-sync policy at save time. */
  targetSyncBody?: boolean;
  confirmedAt: string;
}

/** Accepts either the legacy content hash string or the full retry record. */
export type MaterialServerSaveInput =
  | string
  | Omit<MaterialServerSaveRecord, 'confirmedAt'>;

function readMaterialServerSaves(): Record<string, MaterialServerSaveRecord> {
  return safeGetItem<Record<string, MaterialServerSaveRecord>>(MATERIAL_SERVER_SAVE_KEY, {});
}

function writeMaterialServerSaves(registry: Record<string, MaterialServerSaveRecord>): boolean {
  safeSetItem(MATERIAL_SERVER_SAVE_KEY, registry);
  const readBack = safeGetItem<Record<string, MaterialServerSaveRecord>>(MATERIAL_SERVER_SAVE_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

export function recordMaterialServerSave(materialId: string, input: MaterialServerSaveInput): boolean {
  if (!materialId) return false;
  const partial = typeof input === 'string' ? { contentHash: input } : input;
  if (!partial.contentHash) return false;
  const registry = readMaterialServerSaves();
  // Merge over any previous record so a partial update never drops retry info.
  registry[materialId] = { ...registry[materialId], ...partial, confirmedAt: new Date().toISOString() };
  return writeMaterialServerSaves(registry);
}

export function getMaterialServerSaveRecord(materialId: string): MaterialServerSaveRecord | undefined {
  return readMaterialServerSaves()[materialId];
}

export function clearMaterialServerSaveRecord(materialId: string): void {
  if (!materialId) return;
  const registry = readMaterialServerSaves();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeMaterialServerSaves(registry);
}

// ---------------------------------------------------------------------------
// Material-edit postprocess ledger (account-scoped).
//
// The body write and the follow-up reflection (linked problems' stale/review
// flags, concepts/drafts review state mirrored to the server) are separate
// steps. When the reflection only partially lands, this ledger keeps the
// failure VISIBLE and retryable: the next save of the same body re-runs ONLY
// the reflection, and the editor offers an explicit "retry reflection" action
// instead of silently dropping the flags. Clearing happens only on explicit
// success (zero failures), on delete, or when a different body is saved.
// ---------------------------------------------------------------------------

const MATERIAL_POSTPROCESS_KEY = 'material_postprocess_v1';

export interface MaterialPostprocessState {
  /** materialContentHash of the body whose reflection is pending/failed. */
  contentHash: string;
  /** How many server reflections failed in the last attempt. */
  failedCount: number;
  /** Human-readable summary of the last failure (Korean, UI-facing). */
  lastError?: string;
  updatedAt: string;
}

function readMaterialPostprocessStates(): Record<string, MaterialPostprocessState> {
  return safeGetItem<Record<string, MaterialPostprocessState>>(MATERIAL_POSTPROCESS_KEY, {});
}

function writeMaterialPostprocessStates(registry: Record<string, MaterialPostprocessState>): boolean {
  safeSetItem(MATERIAL_POSTPROCESS_KEY, registry);
  const readBack = safeGetItem<Record<string, MaterialPostprocessState>>(MATERIAL_POSTPROCESS_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

/** Records the reflection outcome for one saved body. Zero failures clears. */
export function recordMaterialPostprocessState(
  materialId: string,
  input: { contentHash: string; failedCount: number; lastError?: string }
): boolean {
  if (!materialId || !input.contentHash) return false;
  const registry = readMaterialPostprocessStates();
  if (input.failedCount <= 0) {
    if (registry[materialId] === undefined) return true;
    delete registry[materialId];
    return writeMaterialPostprocessStates(registry);
  }
  registry[materialId] = {
    contentHash: input.contentHash,
    failedCount: input.failedCount,
    lastError: input.lastError,
    updatedAt: new Date().toISOString(),
  };
  return writeMaterialPostprocessStates(registry);
}

export function getMaterialPostprocessState(materialId: string): MaterialPostprocessState | undefined {
  if (!materialId) return undefined;
  return readMaterialPostprocessStates()[materialId];
}

export function clearMaterialPostprocessState(materialId: string): void {
  if (!materialId) return;
  const registry = readMaterialPostprocessStates();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeMaterialPostprocessStates(registry);
}

// ---------------------------------------------------------------------------
// Local body-hash registry (account-scoped, never sent to the server).
//
// bodyHash identifies the converted markdown of a material so a reconnected
// .md file can be verified. Because cloud metadata refreshes replace the
// materials list with server rows (which cannot carry this local-only field),
// the hash lives in its own account-scoped record and is merged on load.
// The registry ALSO stores the material identity (subjectId/kind) recorded at
// the time, so an old hash is never merged into a record whose identity changed.
// ---------------------------------------------------------------------------

const MATERIAL_BODY_HASHES_KEY = 'material_body_hashes_v1';

export interface MaterialHashIdentity {
  subjectId?: string;
  kind?: string;
}

interface StoredMaterialBodyHash extends MaterialHashIdentity {
  hash?: string;
  /**
   * The last recorded hash could not be persisted for a body that WAS saved.
   * While this flag is set, the old hash must never be used to judge a
   * reconnect candidate; the stored body is recomputed instead.
   */
  unverified?: boolean;
}

function readBodyHashRegistry(): Record<string, StoredMaterialBodyHash> {
  return safeGetItem<Record<string, StoredMaterialBodyHash>>(MATERIAL_BODY_HASHES_KEY, {});
}

function writeBodyHashRegistry(registry: Record<string, StoredMaterialBodyHash>): boolean {
  safeSetItem(MATERIAL_BODY_HASHES_KEY, registry);
  const readBack = safeGetItem<Record<string, StoredMaterialBodyHash>>(MATERIAL_BODY_HASHES_KEY, {});
  return JSON.stringify(readBack) === JSON.stringify(registry);
}

function storedHashIdentityMatches(
  record: StoredMaterialBodyHash,
  identity?: MaterialHashIdentity
): boolean {
  if (!identity) return true;
  if (record.subjectId !== undefined && record.subjectId !== identity.subjectId) return false;
  if (record.kind !== undefined && record.kind !== identity.kind) return false;
  return true;
}

function mergeStoredBodyHash(
  registry: Record<string, StoredMaterialBodyHash>,
  material: Material
): string | undefined {
  const record = registry[material.id];
  if (!record) return material.bodyHash;
  // A body was saved but its identity could not be recorded: the old hash must
  // NOT silently stand in, and the metadata hash must not be a silent fallback.
  if (record.unverified) return undefined;
  if (!storedHashIdentityMatches(record, { subjectId: material.subjectId, kind: material.kind })) {
    // A different material identity with the same id: never use the old hash,
    // and never fall back to the (possibly stale) metadata-carried hash either.
    return undefined;
  }
  return record.hash;
}

/**
 * Resolves the body identity hash for a material with the SAME rule everywhere:
 * the account-scoped registry wins; a hash recorded for a DIFFERENT identity is
 * ignored (no fallback to a stale metadata hash); only when no registry record
 * exists is the material's own bodyHash used.
 */
export function resolveStoredMaterialBodyHash(material: Material): string | undefined {
  return mergeStoredBodyHash(readBodyHashRegistry(), material);
}

/**
 * Records the verified hash of a material's current body (with its identity).
 * Returns false when the write could not be persisted — callers must not treat
 * a failed record as saved.
 */
export function recordMaterialBodyHash(
  materialId: string,
  hash: string,
  identity?: MaterialHashIdentity
): boolean {
  if (!materialId || !hash) return false;
  const registry = readBodyHashRegistry();
  registry[materialId] = identity
    ? { hash, subjectId: identity.subjectId, kind: identity.kind }
    : { hash };
  return writeBodyHashRegistry(registry);
}

export function getStoredMaterialBodyHash(
  materialId: string,
  identity?: MaterialHashIdentity
): string | undefined {
  const record = readBodyHashRegistry()[materialId];
  if (!record || record.unverified || !storedHashIdentityMatches(record, identity)) return undefined;
  return record.hash;
}

/** Marks the recorded identity as unverified so it never rejects a real body. */
export function markMaterialBodyHashUnverified(materialId: string, identity?: MaterialHashIdentity): void {
  if (!materialId) return;
  const registry = readBodyHashRegistry();
  const previous = registry[materialId];
  registry[materialId] = {
    hash: previous?.hash,
    unverified: true,
    subjectId: identity?.subjectId ?? previous?.subjectId,
    kind: identity?.kind ?? previous?.kind,
  };
  writeBodyHashRegistry(registry);
}

export function isMaterialBodyHashUnverified(materialId: string): boolean {
  const record = readBodyHashRegistry()[materialId];
  return Boolean(record?.unverified);
}

/**
 * Recovery: re-reads the PERSISTED body (memory cache bypassed) and recomputes
 * the identity hash, so a hash record that failed to persist after a successful
 * body save never permanently blocks reconnecting the real body.
 */
export async function refreshMaterialBodyHashFromStoredBody(
  materialId: string,
  identity?: MaterialHashIdentity
): Promise<boolean> {
  if (!materialId) return false;
  const result = await loadMaterialContentInScope(getStorageScopeId(), materialId, {
    skipMemoryCache: true,
  });
  if (result.status !== 'found' || typeof result.content.markdown !== 'string') return false;
  const hash = computeMarkdownHash(result.content.markdown);
  return recordMaterialBodyHash(materialId, hash, identity);
}

export function removeStoredMaterialBodyHash(materialId: string): void {
  const registry = readBodyHashRegistry();
  if (registry[materialId] === undefined) return;
  delete registry[materialId];
  writeBodyHashRegistry(registry);
}

function hasEmbeddedMaterialBody(m: Material | undefined): boolean {
  return Boolean(
    m && (m.parsedMarkdown !== undefined || m.rawText !== undefined || m.pages !== undefined)
  );
}

/**
 * Persists the material metadata list. localStorage keeps METADATA ONLY, with
 * ONE exception that protects the last persistent copy of a body: when the
 * CURRENTLY stored record still carries embedded body fields that have not
 * been durably moved into IndexedDB (migration failed or not yet run), those
 * fields are KEPT (or re-attached when the caller's copy already lost them).
 * A memory-cache presence never counts as persistence here.
 */
function persistMaterialsMetadata(materials: Material[], verify: boolean): boolean {
  // An id explicitly deleted on this device is NEVER written back, no matter
  // what the input list (e.g. a stale server snapshot) carries.
  const deletedIds = deletedMaterialMarkerIds();
  const currentById = new Map<string, Material>(
    (safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, []) || [])
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => [m.id, m])
  );

  const light = materials
    .filter((m) => !deletedIds.has(m.id))
    .map((m) => {
      const copy: Material = { ...m };
      const current = currentById.get(m.id);
      if (hasEmbeddedMaterialBody(current) && !isMaterialBodyPersisted(m.id)) {
        copy.parsedMarkdown =
          typeof m.parsedMarkdown === 'string' ? m.parsedMarkdown : current!.parsedMarkdown;
        copy.rawText = m.rawText ?? current!.rawText;
        copy.pages = m.pages ?? current!.pages;
        return copy;
      }
      delete copy.parsedMarkdown;
      delete copy.rawText;
      delete copy.pages;
      return copy;
    });

  safeSetItem(STORAGE_KEYS.MATERIALS, light);
  if (!verify) return true;
  const readBack = safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, []);
  if (!Array.isArray(readBack) || readBack.length !== light.length) return false;
  return readBack.every((m, i) => JSON.stringify(m) === JSON.stringify(light[i]));
}

export function saveStoredMaterials(materials: Material[]): boolean {
  return persistMaterialsMetadata(materials, false);
}

/**
 * Saves material metadata and verifies the persisted value by reading it back.
 * Used by restore paths so a failed metadata write is never reported as a
 * restored material.
 */
export function saveStoredMaterialsVerified(materials: Material[]): boolean {
  return persistMaterialsMetadata(materials, true);
}

/**
 * Replaces the local material cache with an AUTHORITATIVE server list, while
 * preserving local-only materials that must not disappear:
 *  - un-migrated materials whose only body copy is embedded in localStorage,
 *  - materials explicitly marked local-only (e.g. restored from a backup),
 *  - never an id recorded in the deletion ledger.
 *
 * This is the ONLY path that may drop a local material merely because the
 * server list lacks it; every other save is a local modification/delete and
 * keeps its exact list. Returns the list that is now persisted (for UI state).
 */
export function saveStoredMaterialsFromServerCache(serverMaterials: Material[]): Material[] {
  const deletedIds = deletedMaterialMarkerIds();
  const current = safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, []);
  const currentList = Array.isArray(current) ? current : [];
  const serverIds = new Set(serverMaterials.map((m) => m.id));

  const preserved = currentList.filter(
    (m) =>
      m &&
      typeof m.id === 'string' &&
      !serverIds.has(m.id) &&
      !deletedIds.has(m.id) &&
      // Preserve a material whose last persistent body is still only embedded,
      // or that is explicitly local-only (restored / not yet synced).
      (hasEmbeddedMaterialBody(m) || isLocalOnlyMaterial(m.id))
  );

  const merged = preserved.length > 0 ? [...serverMaterials, ...preserved] : serverMaterials;
  persistMaterialsMetadata(merged, false);

  // The server list is authoritative for its own ids: those are no longer
  // local-only, so a later server refresh will not treat them as preserved.
  for (const material of serverMaterials) clearLocalOnlyMaterialMarker(material.id);

  return loadStoredMaterials();
}

export interface MaterialBodyMigrationResult {
  attempted: number;
  migrated: number;
  ok: boolean;
  failedIds: string[];
  error?: string;
}

/**
 * Moves bodies still embedded in the localStorage materials list into IndexedDB.
 *
 * Recovery contract:
 *  - Every body is written to IndexedDB AND verified by reading the persisted
 *    value back (memory cache bypassed) before localStorage is touched.
 *  - localStorage is rewritten per item: only VERIFIED bodies are stripped from
 *    the metadata; failed items keep their embedded body as the last persistent
 *    copy and are retried on the next run.
 *  - The scope is pinned from the start, so an account change mid-run cannot
 *    redirect reads, writes, or the localStorage rewrite to another account.
 */
export async function migrateStoredMaterialBodies(
  options: { scopeId?: string } = {}
): Promise<MaterialBodyMigrationResult> {
  const scopeId = options.scopeId ?? getStorageScopeId();
  const materialsKey = scopedStorageKeyForScopeId(scopeId, STORAGE_KEYS.MATERIALS);

  let raw: Material[];
  try {
    const text = localStorage.getItem(materialsKey);
    raw = text === null ? [] : JSON.parse(text) as Material[];
  } catch {
    raw = safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, []);
  }
  if (!Array.isArray(raw)) {
    return { attempted: 0, migrated: 0, ok: false, failedIds: [], error: '자료 메타데이터를 읽지 못했습니다.' };
  }
  const withBodies = raw.filter(hasEmbeddedMaterialBody);
  if (withBodies.length === 0) {
    return { attempted: 0, migrated: 0, ok: true, failedIds: [] };
  }

  const migratedIds: string[] = [];
  const failedIds: string[] = [];
  for (const material of withBodies) {
    const content = {
      markdown: typeof material.parsedMarkdown === 'string' ? material.parsedMarkdown : '',
      rawText: material.rawText,
      pages: material.pages,
    };
    const saved = await saveMaterialContentInScope(scopeId, material.id, content);
    if (!saved.persisted) {
      failedIds.push(material.id);
      continue;
    }
    // Read the PERSISTED value back (memory cache bypassed) before trusting it.
    const verify = await loadMaterialContentInScope(scopeId, material.id, { skipMemoryCache: true });
    if (verify.status !== 'found' || materialContentHash(verify.content) !== materialContentHash(content)) {
      // The write did not survive intact: withdraw the durability mark so
      // later metadata saves keep the localStorage copy.
      unmarkMaterialBodyPersistedInScope(scopeId, material.id);
      failedIds.push(material.id);
      continue;
    }
    migratedIds.push(material.id);
  }

  // Strip embedded bodies ONLY for the verified items; failed items keep theirs.
  const migratedSet = new Set(migratedIds);
  const updated = raw.map((m) => {
    if (!m || !migratedSet.has(m.id)) return m;
    const light: Material = { ...m };
    delete light.parsedMarkdown;
    delete light.rawText;
    delete light.pages;
    return light;
  });
  safeSetItemRaw(materialsKey, JSON.stringify(updated));

  const check = safeGetRaw(materialsKey);
  const writeVerified = (() => {
    if (check === null) return false;
    try {
      const parsed = JSON.parse(check) as Material[];
      if (!Array.isArray(parsed) || parsed.length !== updated.length) return false;
      return parsed.every(
        (m, i) =>
          (migratedSet.has(m.id) && !hasEmbeddedMaterialBody(m)) ||
          (!migratedSet.has(m.id) && JSON.stringify(m) === JSON.stringify(updated[i]))
      );
    } catch {
      return false;
    }
  })();

  if (!writeVerified) {
    return {
      attempted: withBodies.length,
      migrated: migratedIds.length,
      ok: false,
      failedIds,
      error: 'localStorage 본문 정리를 검증하지 못했습니다. 원본은 보존되었으며 다음 실행에 다시 시도됩니다.',
    };
  }

  if (failedIds.length > 0) {
    return {
      attempted: withBodies.length,
      migrated: migratedIds.length,
      ok: false,
      failedIds,
      error: '일부 자료 본문을 IndexedDB로 옮기지 못했습니다. 해당 자료의 localStorage 본문은 보존되었으며 다음 실행에 다시 시도됩니다.',
    };
  }
  return { attempted: withBodies.length, migrated: migratedIds.length, ok: true, failedIds: [] };
}

function safeGetRaw(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItemRaw(key: string, value: string): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch (e) {
    console.error(`Failed to write localStorage key ${key}`, e);
    return false;
  }
}

export function loadStoredConcepts(referenceDate: Date = new Date()): Concept[] {
  const loaded = safeGetItem<Concept[]>(STORAGE_KEYS.CONCEPTS, []);
  const settings = safeGetItem<RetentionModelSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_RETENTION_SETTINGS);

  return loaded.map((c) => {
    const isDemo = c.isDemo ?? (c.id.startsWith('c-econ') || c.id.startsWith('c-cs'));
    const isLearned = c.isLearned ?? isDemo;
    const isUnstudied = c.status === 'unstudied' || (!isLearned && (!c.events || c.events.length === 0));

    if (isUnstudied) {
      return {
        ...c,
        status: 'unstudied' as ConceptStatus,
        baseScore: 0,
        currentScore: 0,
        events: c.events || [],
        isDemo,
        isLearned: false,
        postponeDays: c.postponeDays ?? 0,
      };
    }

    // Dynamic model score recalculation using actual timestamps and elapsed time
    const dynamicScore = calculateCurrentConceptScore(c.events, settings, referenceDate);
    const dynamicStatus = getConceptStatusFromScore(dynamicScore);

    return {
      ...c,
      status: dynamicStatus,
      currentScore: dynamicScore,
      isDemo,
      isLearned: true,
      postponeDays: c.postponeDays ?? 0,
    };
  });
}

export function saveStoredConcepts(concepts: Concept[]): boolean {
  return safeSetItem(STORAGE_KEYS.CONCEPTS, concepts);
}

export function loadStoredConceptDrafts(): ConceptDraft[] {
  return safeGetItem<ConceptDraft[]>(STORAGE_KEYS.CONCEPT_DRAFTS, []);
}

export function saveStoredConceptDrafts(drafts: ConceptDraft[]): boolean {
  return safeSetItem(STORAGE_KEYS.CONCEPT_DRAFTS, drafts);
}

export function approveConceptDraft(draftId: string): {
  updatedDrafts: ConceptDraft[];
  updatedConcepts: Concept[];
  newConcept: Concept | null;
  approvedConcept: Concept | null;
} {
  const drafts = loadStoredConceptDrafts();
  const concepts = loadStoredConcepts();

  const targetDraft = drafts.find((d) => d.id === draftId);
  if (!targetDraft) {
    return { updatedDrafts: drafts, updatedConcepts: concepts, newConcept: null, approvedConcept: null };
  }

  const updatedDrafts = drafts.map((d) =>
    d.id === draftId
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: new Date().toISOString() }
      : d
  );
  saveStoredConceptDrafts(updatedDrafts);

  // Check if concept already created from this draft
  const existingIndex = concepts.findIndex((c) => c.draftId === draftId);
  let newConcept: Concept;

  const chapterRef =
    targetDraft.sourceEvidence.type === 'page'
      ? `제${targetDraft.sourceEvidence.pageNumber || 1}페이지`
      : targetDraft.sourceEvidence.timestamp
        ? `전사본 ${targetDraft.sourceEvidence.timestamp}`
        : `전사본 발화 #${targetDraft.sourceEvidence.blockIndex || 1}`;

  if (existingIndex >= 0) {
    newConcept = {
      ...concepts[existingIndex],
      title: targetDraft.title,
      description: targetDraft.description,
      coreDefinitionFormulaOrAlgorithm: targetDraft.coreDefinitionFormulaOrAlgorithm,
      prerequisites: targetDraft.prerequisites,
      relatedConcepts: targetDraft.relatedConcepts,
      commonMisconceptions: targetDraft.commonMisconceptions,
      examples: targetDraft.examples,
      sourceEvidence: targetDraft.sourceEvidence,
    };
    concepts[existingIndex] = newConcept;
  } else {
    newConcept = {
      id: `c-ext-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      subjectId: targetDraft.subjectId,
      materialIds: [targetDraft.materialId],
      title: targetDraft.title,
      chapterRef,
      baseScore: 0,
      currentScore: 0,
      status: 'unstudied', // DO NOT invent fake score or events!
      order: concepts.length + 1,
      events: [],
      exerciseCount: 0,
      isDemo: false,
      isLearned: false,
      description: targetDraft.description,
      coreDefinitionFormulaOrAlgorithm: targetDraft.coreDefinitionFormulaOrAlgorithm,
      prerequisites: targetDraft.prerequisites,
      relatedConcepts: targetDraft.relatedConcepts,
      commonMisconceptions: targetDraft.commonMisconceptions,
      examples: targetDraft.examples,
      sourceEvidence: targetDraft.sourceEvidence,
      draftId: targetDraft.id,
    };
    concepts.push(newConcept);
  }

  saveStoredConcepts(concepts);

  // Update material hasAiConcepts flag
  const materials = loadStoredMaterials();
  const matUpdated = materials.map((m) =>
    m.id === targetDraft.materialId ? { ...m, hasAiConcepts: true } : m
  );
  saveStoredMaterials(matUpdated);

  return { updatedDrafts, updatedConcepts: concepts, newConcept, approvedConcept: newConcept };
}

export function batchApproveConceptDrafts(draftIds: string[]): {
  updatedDrafts: ConceptDraft[];
  updatedConcepts: Concept[];
} {
  const drafts = loadStoredConceptDrafts();
  const concepts = loadStoredConcepts();
  const targetIdsSet = new Set(draftIds);

  const updatedDrafts = drafts.map((d) =>
    targetIdsSet.has(d.id)
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: new Date().toISOString() }
      : d
  );
  saveStoredConceptDrafts(updatedDrafts);

  for (const draftId of draftIds) {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) continue;

    const existingIndex = concepts.findIndex((c) => c.draftId === draftId);
    const chapterRef =
      draft.sourceEvidence.type === 'page'
        ? `제${draft.sourceEvidence.pageNumber || 1}페이지`
        : draft.sourceEvidence.timestamp
          ? `전사본 ${draft.sourceEvidence.timestamp}`
          : `전사본 발화 #${draft.sourceEvidence.blockIndex || 1}`;

    if (existingIndex >= 0) {
      concepts[existingIndex] = {
        ...concepts[existingIndex],
        title: draft.title,
        description: draft.description,
        coreDefinitionFormulaOrAlgorithm: draft.coreDefinitionFormulaOrAlgorithm,
        prerequisites: draft.prerequisites,
        relatedConcepts: draft.relatedConcepts,
        commonMisconceptions: draft.commonMisconceptions,
        examples: draft.examples,
        sourceEvidence: draft.sourceEvidence,
      };
    } else {
      concepts.push({
        id: `c-ext-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subjectId: draft.subjectId,
        materialIds: [draft.materialId],
        title: draft.title,
        chapterRef,
        baseScore: 0,
        currentScore: 0,
        status: 'unstudied',
        order: concepts.length + 1,
        events: [],
        exerciseCount: 0,
        isDemo: false,
        isLearned: false,
        description: draft.description,
        coreDefinitionFormulaOrAlgorithm: draft.coreDefinitionFormulaOrAlgorithm,
        prerequisites: draft.prerequisites,
        relatedConcepts: draft.relatedConcepts,
        commonMisconceptions: draft.commonMisconceptions,
        examples: draft.examples,
        sourceEvidence: draft.sourceEvidence,
        draftId: draft.id,
      });
    }
  }

  saveStoredConcepts(concepts);
  return { updatedDrafts, updatedConcepts: concepts };
}

export function deleteConceptDraft(draftId: string): ConceptDraft[] {
  const drafts = loadStoredConceptDrafts();
  const updated = drafts.filter((d) => d.id !== draftId);
  saveStoredConceptDrafts(updated);
  return updated;
}

export function mergeConceptDrafts(
  targetDraftId: string,
  sourceDraftId: string,
  mergedData?: Partial<ConceptDraft>
): ConceptDraft[] {
  const drafts = loadStoredConceptDrafts();
  const target = drafts.find((d) => d.id === targetDraftId);
  const source = drafts.find((d) => d.id === sourceDraftId);

  if (!target || !source) return drafts;

  const mergedPrerequisites = Array.from(
    new Set([...target.prerequisites, ...source.prerequisites])
  );
  const mergedRelated = Array.from(
    new Set([...target.relatedConcepts, ...source.relatedConcepts])
  );
  const mergedMisconceptions = Array.from(
    new Set([...target.commonMisconceptions, ...source.commonMisconceptions])
  );
  const mergedExamples = Array.from(new Set([...target.examples, ...source.examples]));

  const updatedDraft: ConceptDraft = {
    ...target,
    ...mergedData,
    prerequisites: mergedPrerequisites,
    relatedConcepts: mergedRelated,
    commonMisconceptions: mergedMisconceptions,
    examples: mergedExamples,
    updatedAt: new Date().toISOString(),
    editedByUser: true,
  };

  const updated = drafts
    .filter((d) => d.id !== sourceDraftId)
    .map((d) => (d.id === targetDraftId ? updatedDraft : d));

  saveStoredConceptDrafts(updated);
  return updated;
}

export function markConceptAsLearned(
  conceptId: string,
  baseScore: number = 85
): { updatedConcepts: Concept[]; learnedConcept?: Concept } {
  const concepts = loadStoredConcepts();
  const now = new Date().toISOString();

  let targetLearned: Concept | undefined;

  const updated = concepts.map((c) => {
    if (c.id !== conceptId) return c;
    const initialEvent: ReviewEvent = {
      id: `ev-${Date.now()}`,
      conceptId: c.id,
      at: now,
      dayOffset: 0,
      kind: 'initial_study',
      title: '학습 완료 등록',
      resultScore: baseScore,
      confidence: 4,
      sourceRef: c.chapterRef,
      evaluationSummary: '사용자 학습 완료 확인',
    };
    const learned: Concept = {
      ...c,
      isLearned: true,
      status: 'newly_learned' as ConceptStatus,
      firstLearnedAt: now,
      firstLearnedDayOffset: 0,
      baseScore,
      currentScore: baseScore,
      events: [initialEvent],
    };
    targetLearned = learned;
    return learned;
  });

  saveStoredConcepts(updated);
  return { updatedConcepts: updated, learnedConcept: targetLearned };
}

// Scoped cache of the last verified persisted problem list, used strictly as a
// read-only baseline when localStorage access later fails with SecurityError
// so editAndReviseProblem can preserve the user's edit in memory without
// claiming persistent storage succeeded.
const lastKnownProblemsByScope: Record<string, Record<string, Problem>> = {};

// Separate in-memory problem buffer keyed by scoped storage key,
// strictly distinguished from browser localStorage persistence.
const inMemoryProblemFallback: Record<string, Record<string, Problem>> = {};

function getScopedLastKnownProblemsMap(): Record<string, Problem> {
  const key = scopedStorageKey(STORAGE_KEYS.PROBLEMS);
  if (!lastKnownProblemsByScope[key]) {
    lastKnownProblemsByScope[key] = {};
  }
  return lastKnownProblemsByScope[key];
}

function recordLastKnownProblems(problems: Problem[]): void {
  const key = scopedStorageKey(STORAGE_KEYS.PROBLEMS);
  const nextMap: Record<string, Problem> = {};
  for (const p of problems) {
    if (p && p.id) {
      nextMap[p.id] = { ...p };
    }
  }
  lastKnownProblemsByScope[key] = nextMap;
}

function getLastKnownProblem(problemId: string): Problem | null {
  const map = getScopedLastKnownProblemsMap();
  return map[problemId] ? { ...map[problemId] } : null;
}

function getScopedInMemoryProblemMap(): Record<string, Problem> {
  const key = scopedStorageKey(STORAGE_KEYS.PROBLEMS);
  if (!inMemoryProblemFallback[key]) {
    inMemoryProblemFallback[key] = {};
  }
  return inMemoryProblemFallback[key];
}

export function setInMemoryProblem(problem: Problem): void {
  const map = getScopedInMemoryProblemMap();
  const existing = map[problem.id];
  if (existing) {
    const existingConfirmed = existing.serverConfirmedVersion ?? 0;
    const incomingConfirmed = problem.serverConfirmedVersion ?? 0;
    if (incomingConfirmed < existingConfirmed) {
      return;
    }
    if (
      incomingConfirmed === existingConfirmed &&
      typeof existing.version === 'number' &&
      typeof problem.version === 'number' &&
      problem.version < existing.version
    ) {
      return;
    }
  }
  map[problem.id] = { ...problem };
}

export function getInMemoryProblem(problemId: string): Problem | null {
  const map = getScopedInMemoryProblemMap();
  return map[problemId] ? { ...map[problemId] } : null;
}

export function clearInMemoryProblem(
  problemId: string,
  expected?: { version?: number; serverConfirmedVersion?: number }
): void {
  const map = getScopedInMemoryProblemMap();
  const existing = map[problemId];
  if (!existing) return;
  if (expected?.serverConfirmedVersion !== undefined) {
    const existingConfirmed = existing.serverConfirmedVersion ?? 0;
    if (existingConfirmed > expected.serverConfirmedVersion) {
      return;
    }
  } else if (
    expected?.version !== undefined &&
    typeof existing.version === 'number' &&
    existing.version > expected.version
  ) {
    return;
  }
  delete map[problemId];
}

export function loadStoredProblems(): Problem[] {
  const raw = safeGetItem<Problem[]>(STORAGE_KEYS.PROBLEMS, []);
  // Legacy migration: recover transfer linkage ONLY when the original draft can
  // still be resolved by draftId. Never infer a source/session.
  const drafts = loadStoredProblemDrafts();
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const loaded = raw.map((p) => {
    const base: Problem = {
      ...p,
      isDemo: p.isDemo ?? true,
      isApproved: p.isApproved ?? true,
      qualityStatus: p.qualityStatus ?? 'normal',
      version: p.version ?? 1,
      reports: p.reports ?? [],
      versionHistory: p.versionHistory ?? [],
    };
    if (base.isTransfer === undefined && base.draftId) {
      const draft = draftById.get(base.draftId);
      if (draft?.isTransfer === true) {
        base.isTransfer = true;
        base.sourceProblemId = draft.sourceProblemId;
        base.logicSessionId = draft.logicSessionId;
        base.transferChanges = draft.transferChanges;
        base.understandingFocus = draft.understandingFocus;
        base.transferKind = draft.transferKind;
        base.originalCondition = draft.originalCondition;
        base.newCondition = draft.newCondition;
      }
    }
    return base;
  });
  if (getLocalStorage() !== null && loaded.length > 0) {
    recordLastKnownProblems(loaded);
  }
  return loaded;
}

export function saveStoredProblems(problems: Problem[]): boolean {
  const ok = safeSetItem(STORAGE_KEYS.PROBLEMS, problems);
  if (ok) {
    recordLastKnownProblems(problems);
  }
  return ok;
}

export function loadStoredProblemDrafts(): ProblemDraft[] {
  return safeGetItem<ProblemDraft[]>(STORAGE_KEYS.PROBLEM_DRAFTS, []);
}

export function saveStoredProblemDrafts(drafts: ProblemDraft[]): void {
  safeSetItem(STORAGE_KEYS.PROBLEM_DRAFTS, drafts);
}

export function updateProblemDraft(draft: ProblemDraft): ProblemDraft[] {
  const drafts = loadStoredProblemDrafts();
  const updated = drafts.map((d) =>
    d.id === draft.id ? { ...draft, editedByUser: true, updatedAt: new Date().toISOString() } : d
  );
  saveStoredProblemDrafts(updated);
  return updated;
}

export function deleteProblemDraft(draftId: string): ProblemDraft[] {
  const drafts = loadStoredProblemDrafts();
  const updated = drafts.filter((d) => d.id !== draftId);
  saveStoredProblemDrafts(updated);
  return updated;
}

/**
 * Single conversion path from an approved draft to a stored Problem. Guarantees
 * that every approval route preserves the SAME fields, including transfer linkage
 * (isTransfer / sourceProblemId / logicSessionId / structured condition change).
 */
export function buildProblemFromDraft(
  draft: ProblemDraft,
  existing: Problem | undefined,
  now: string
): Problem {
  const derived: Omit<Problem, 'id' | 'createdAt' | 'version' | 'qualityStatus' | 'reports' | 'versionHistory'> = {
    conceptIds: draft.conceptIds,
    subjectId: draft.subjectId,
    title: draft.title,
    type: draft.type,
    categoryLabel: draft.categoryLabel,
    categoryNumber: draft.categoryNumber,
    promptText: draft.promptText,
    mathFormula: draft.mathFormula,
    codeSnippet: draft.codeSnippet,
    timeStandardMinutes: draft.timeStandardMinutes,
    timeBreakdownDesc: draft.timeBreakdownDesc,
    coreEvaluationHighlight: draft.coreEvaluationHighlight,
    itemCountDesc: draft.itemCountDesc,
    sourceRefs: draft.sourceRefs,
    hints: draft.hints,
    modelAnswer: draft.modelAnswer,
    rubric: draft.rubric,
    isDemo: false,
    isApproved: true,
    draftId: draft.id,
    difficulty: draft.difficulty,
    designIntent: draft.designIntent,
    appliedConditionNote: draft.appliedConditionNote,
    sourceMarkdownHash: draft.sourceMarkdownHash,
    sourceMaterials: draft.sourceMaterials,
    // Transfer linkage (explicitly assigned so stale values never linger).
    isTransfer: draft.isTransfer ? true : false,
    sourceProblemId: draft.sourceProblemId,
    logicSessionId: draft.logicSessionId,
    transferChanges: draft.transferChanges,
    understandingFocus: draft.understandingFocus,
    transferKind: draft.transferKind,
    originalCondition: draft.originalCondition,
    newCondition: draft.newCondition,
    difficultyLevel: draft.difficultyLevel ?? (draft.difficulty ? toAcademicDifficultyLevel(draft.difficulty) : undefined),
    sourceMaterialId: draft.sourceMaterialId,
    sourceConceptIds: draft.sourceConceptIds ? [...draft.sourceConceptIds] : undefined,
    sourceExcerpt: draft.sourceExcerpt,
    sourcePage: draft.sourcePage,
    sourceContentVersion: draft.sourceContentVersion,
    sourceVerificationStatus: draft.sourceVerificationStatus,
  };

  if (existing) {
    // A re-approval that changes evaluation-affecting content is a NEW version
    // with an archived snapshot; an identical re-approval keeps the version.
    const contentChanged =
      getProblemEvaluationSignature(existing) !== getProblemEvaluationSignature(derived);

    if (contentChanged) {
      const currentVersion = existing.version || 1;
      const snapshot: ProblemVersionSnapshot = {
        version: currentVersion,
        title: existing.title,
        promptText: existing.promptText,
        type: existing.type,
        conceptIds: [...(existing.conceptIds || [])],
        appliedConditionNote: existing.appliedConditionNote,
        mathFormula: existing.mathFormula,
        codeSnippet: existing.codeSnippet,
        timeStandardMinutes: existing.timeStandardMinutes,
        hints: [...(existing.hints || [])],
        modelAnswer: existing.modelAnswer,
        rubric: [...(existing.rubric || [])],
        editedAt: now,
        editReason: '재승인 시 내용 변경',
        difficultyLevel: existing.difficultyLevel ?? (existing.difficulty ? toAcademicDifficultyLevel(existing.difficulty) : undefined),
        sourceMaterialId: existing.sourceMaterialId,
        sourceConceptIds: existing.sourceConceptIds ? [...existing.sourceConceptIds] : undefined,
        sourceExcerpt: existing.sourceExcerpt,
        sourcePage: existing.sourcePage,
        sourceContentVersion: existing.sourceContentVersion,
        sourceVerificationStatus: existing.sourceVerificationStatus,
      };
      return {
        ...existing,
        ...derived,
        qualityStatus: 'reapproved',
        version: currentVersion + 1,
        reports: existing.reports || [],
        versionHistory: [snapshot, ...(existing.versionHistory || [])],
        lastReviewedAt: now,
      };
    }

    return {
      ...existing,
      ...derived,
      qualityStatus: existing.qualityStatus || 'normal',
      version: existing.version || 1,
      reports: existing.reports || [],
      versionHistory: existing.versionHistory || [],
    };
  }

  return {
    ...derived,
    // Stable id derived from the draft id: a retry after a partial save never
    // creates a duplicate problem.
    id: `prob-ai-${draft.id}`,
    createdAt: now,
    version: 1,
    qualityStatus: 'normal',
    reports: [],
    versionHistory: [],
  };
}

export type ApprovalStatus = 'complete' | 'failed' | 'partial_draft_failed';

export function approveProblemDraft(draftId: string): {
  success: boolean;
  status: ApprovalStatus;
  problemPersisted: boolean;
  draftPersisted: boolean;
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedProblem: Problem | null;
  error?: string;
} {
  const drafts = loadStoredProblemDrafts();
  const problems = loadStoredProblems();

  const targetDraft = drafts.find((d) => d.id === draftId);
  if (!targetDraft) {
    return {
      success: false,
      status: 'failed',
      problemPersisted: false,
      draftPersisted: false,
      updatedDrafts: drafts,
      updatedProblems: problems,
      approvedProblem: null,
      error: '초안을 찾을 수 없습니다.',
    };
  }

  const now = new Date().toISOString();
  const existingIndex = problems.findIndex((p) => p.draftId === draftId);
  const existing = existingIndex >= 0 ? problems[existingIndex] : undefined;
  const approvedProblem = buildProblemFromDraft(targetDraft, existing, now);
  const nextProblems = existingIndex >= 0
    ? problems.map((p, i) => (i === existingIndex ? approvedProblem : p))
    : [...problems, approvedProblem];

  saveStoredProblems(nextProblems);

  // Verify the problem is really persisted with the EXACT content/version we
  // intended (not just an older row with the same id/draftId).
  const persisted = loadStoredProblems().find(
    (p) => p.id === approvedProblem.id && p.draftId === draftId && problemContentMatches(p, approvedProblem)
  );
  if (!persisted) {
    return {
      success: false,
      status: 'failed',
      problemPersisted: false,
      draftPersisted: false,
      updatedDrafts: loadStoredProblemDrafts(),
      updatedProblems: loadStoredProblems(),
      approvedProblem: null,
      error: '문제 저장에 실패했습니다. 초안은 승인되지 않았으며 다시 시도할 수 있습니다.',
    };
  }

  const updatedDrafts = drafts.map((d) =>
    d.id === draftId
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: now }
      : d
  );
  saveStoredProblemDrafts(updatedDrafts);

  // Verify the draft approval actually persisted; otherwise it is a PARTIAL
  // approval (problem usable, draft still marked unapproved after refresh).
  const persistedDraft = loadStoredProblemDrafts().find((d) => d.id === draftId);
  const draftPersisted =
    persistedDraft?.isApproved === true && persistedDraft?.updatedAt === now;

  if (!draftPersisted) {
    return {
      success: false,
      status: 'partial_draft_failed',
      problemPersisted: true,
      draftPersisted: false,
      updatedDrafts: loadStoredProblemDrafts(),
      updatedProblems: loadStoredProblems(),
      approvedProblem: persisted,
      error: '문제는 저장되었지만 초안 승인 상태 저장에 실패했습니다. 다시 시도하면 초안 상태만 복구됩니다.',
    };
  }

  return {
    success: true,
    status: 'complete',
    problemPersisted: true,
    draftPersisted: true,
    updatedDrafts: loadStoredProblemDrafts(),
    updatedProblems: loadStoredProblems(),
    approvedProblem: persisted,
  };
}

export interface BatchApproveItemResult {
  draftId: string;
  status: 'approved' | 'failed' | 'partial_draft_failed' | 'skipped';
  problemPersisted?: boolean;
  draftPersisted?: boolean;
  error?: string;
}

export function batchApproveProblemDrafts(draftIds: string[]): {
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedCount: number;
  results: BatchApproveItemResult[];
} {
  const results: BatchApproveItemResult[] = [];
  let approvedCount = 0;

  for (const draftId of draftIds) {
    const res = approveProblemDraft(draftId);
    if (res.status === 'complete') {
      approvedCount += 1;
      results.push({
        draftId,
        status: 'approved',
        problemPersisted: res.problemPersisted,
        draftPersisted: res.draftPersisted,
      });
    } else if (res.status === 'partial_draft_failed') {
      results.push({
        draftId,
        status: 'partial_draft_failed',
        problemPersisted: res.problemPersisted,
        draftPersisted: res.draftPersisted,
        error: res.error,
      });
    } else if (res.error === '초안을 찾을 수 없습니다.') {
      results.push({ draftId, status: 'skipped', error: res.error });
    } else {
      results.push({
        draftId,
        status: 'failed',
        problemPersisted: res.problemPersisted,
        draftPersisted: res.draftPersisted,
        error: res.error || '문제 저장에 실패했습니다.',
      });
    }
  }

  return {
    updatedDrafts: loadStoredProblemDrafts(),
    updatedProblems: loadStoredProblems(),
    approvedCount,
    results,
  };
}

// Stage 6: Problem Quality, Reporting, Versioning & Review Operations

/**
 * Submits an error report for a problem.
 * Quarantines problem by transitioning qualityStatus to 'reported',
 * excluding it from future practice/mock exams until re-approved.
 * Guards against rapid duplicate submissions by the same user.
 */
export function reportProblemError(
  problemId: string,
  reportData: {
    attemptId?: string;
    type: ProblemReportType;
    details: string;
  }
): {
  success: boolean;
  reportId?: string;
  updatedProblems: Problem[];
  newReport: ProblemReport | null;
  error?: string;
} {
  const problems = loadStoredProblems();
  const targetProblem = problems.find((p) => p.id === problemId);

  if (!targetProblem) {
    return { success: false, updatedProblems: problems, newReport: null, error: '신고 대상 문제를 찾을 수 없습니다.' };
  }

  const trimmedDetails = reportData.details.trim();
  if (!trimmedDetails) {
    return { success: false, updatedProblems: problems, newReport: null, error: '신고 사유 및 상세 내용을 입력해 주세요.' };
  }

  const now = new Date();
  const existingReports = targetProblem.reports || [];

  // Debounce & duplicate prevention: identical report within 15 seconds
  const recentDuplicate = existingReports.find((r) => {
    if (r.type !== reportData.type) return false;
    if (r.status === 'dismissed' || r.status === 'resolved') return false;
    const timeDiffMs = Math.abs(now.getTime() - new Date(r.createdAt).getTime());
    return timeDiffMs < 15000 && r.details.trim() === trimmedDetails;
  });

  if (recentDuplicate) {
    return {
      success: false,
      updatedProblems: problems,
      newReport: null,
      error: '동일한 내용의 신고가 방금 접수되었습니다. 잠시 후 다시 확인해 주세요.',
    };
  }

  const newReport: ProblemReport = {
    id: `rep-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    problemId,
    attemptId: reportData.attemptId,
    type: reportData.type,
    details: trimmedDetails,
    createdAt: now.toISOString(),
    status: 'open',
  };

  const updatedReports = [newReport, ...existingReports];

  // Exclude from new practice: transition to 'reported' unless already 'under_review'
  const nextStatus: ProblemQualityStatus =
    targetProblem.qualityStatus === 'under_review' ? 'under_review' : 'reported';

  const updatedProblem: Problem = {
    ...targetProblem,
    reports: updatedReports,
    qualityStatus: nextStatus,
    lastReviewedAt: now.toISOString(),
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);

  return { success: true, reportId: newReport.id, updatedProblems, newReport };
}

/**
 * Updates the problem's quality review status ('normal' | 'reported' | 'under_review' | 'review_after_edit' | 'reapproved' | 'suspended')
 */
export function updateProblemQualityStatus(
  problemId: string,
  newStatus: ProblemQualityStatus,
  note?: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };

  const now = new Date().toISOString();
  const updatedReports = (target.reports || []).map((r) => {
    if (newStatus === 'under_review' && r.status === 'open') {
      return { ...r, status: 'under_review' as const };
    }
    return r;
  });

  const updatedProblem: Problem = {
    ...target,
    qualityStatus: newStatus,
    reports: updatedReports,
    lastReviewedAt: now,
    reviewNotes: note !== undefined ? note : target.reviewNotes,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Dismisses a report with a documented reason.
 * If all reports are resolved/dismissed, problem is restored to practice circulation ('normal' or 'reapproved').
 */
export function dismissProblemReport(
  problemId: string,
  reportId: string,
  dismissReason: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  const trimmedReason = dismissReason.trim();
  if (!trimmedReason) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '신고 기각 사유를 반드시 작성해야 합니다.' };
  }

  const now = new Date().toISOString();
  let foundReport = false;
  const updatedReports = (target.reports || []).map((r) => {
    if (r.id === reportId) {
      foundReport = true;
      return {
        ...r,
        status: 'dismissed' as const,
        resolutionNote: trimmedReason,
        resolvedAt: now,
      };
    }
    return r;
  });

  if (!foundReport) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '해당 신고 내역을 찾을 수 없습니다.' };
  }

  // Check if any open or under_review reports remain
  const hasRemainingOpenReports = updatedReports.some(
    (r) => r.status === 'open' || r.status === 'under_review'
  );

  const restoredStatus: ProblemQualityStatus = hasRemainingOpenReports
    ? target.qualityStatus || 'reported'
    : (target.version && target.version > 1 ? 'reapproved' : 'normal');

  const updatedProblem: Problem = {
    ...target,
    reports: updatedReports,
    qualityStatus: restoredStatus,
    lastReviewedAt: now,
    reviewNotes: `신고 #${reportId} 기각 처리: ${trimmedReason}`,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Edits problem content, archiving current version into versionHistory and incrementing version number.
 * Sets qualityStatus to 'review_after_edit' pending re-approval.
 */
export type ReviseProblemSaveStatus =
  | 'complete'
  | 'partial_revision_only'
  | 'partial_problem_only'
  | 'failed';

export function editAndReviseProblem(
  problemId: string,
  updates: Partial<Problem>,
  editReason: string
): {
  success: boolean;
  status: ReviseProblemSaveStatus;
  persisted: boolean;
  partialFailure: boolean;
  problemPersisted: boolean;
  revisionPersisted: boolean;
  updatedProblems: Problem[];
  updatedProblem: Problem | null;
  memoryProblem: Problem | null;
  memoryRevision: UnsavedProblemRevision | null;
  error?: string;
} {
  const problems = loadStoredProblems();
  const persistedTarget = problems.find((p) => p.id === problemId);
  const lastKnownTarget = getLastKnownProblem(problemId);
  const memoryTarget = getInMemoryProblem(problemId);
  const target =
    memoryTarget && (!persistedTarget || (memoryTarget.version ?? 0) > (persistedTarget.version ?? 0))
      ? memoryTarget
      : (persistedTarget ?? lastKnownTarget ?? memoryTarget);
  if (!target) {
    return {
      success: false,
      status: 'failed',
      persisted: false,
      partialFailure: false,
      problemPersisted: false,
      revisionPersisted: false,
      updatedProblems: problems,
      updatedProblem: null,
      memoryProblem: null,
      memoryRevision: null,
      error: '문제를 찾을 수 없습니다.',
    };
  }

  const trimmedReason = editReason.trim();
  if (!trimmedReason) {
    return {
      success: false,
      status: 'failed',
      persisted: false,
      partialFailure: false,
      problemPersisted: false,
      revisionPersisted: false,
      updatedProblems: problems,
      updatedProblem: null,
      memoryProblem: null,
      memoryRevision: null,
      error: '수정 사유 및 변경 내용을 입력해 주세요.',
    };
  }

  const now = new Date().toISOString();
  const currentVersion = target.version || 1;
  const snapshot: ProblemVersionSnapshot = {
    version: currentVersion,
    title: target.title,
    promptText: target.promptText,
    type: target.type,
    conceptIds: [...(target.conceptIds || [])],
    mathFormula: target.mathFormula,
    codeSnippet: target.codeSnippet,
    timeStandardMinutes: target.timeStandardMinutes,
    appliedConditionNote: target.appliedConditionNote,
    hints: [...(target.hints || [])],
    modelAnswer: target.modelAnswer,
    rubric: [...(target.rubric || [])],
    editedAt: now,
    editReason: trimmedReason,
    difficultyLevel: target.difficultyLevel ?? (target.difficulty ? toAcademicDifficultyLevel(target.difficulty) : undefined),
    sourceMaterialId: target.sourceMaterialId,
    sourceConceptIds: target.sourceConceptIds ? [...target.sourceConceptIds] : undefined,
    sourceExcerpt: target.sourceExcerpt,
    sourcePage: target.sourcePage,
    sourceContentVersion: target.sourceContentVersion,
    sourceVerificationStatus: target.sourceVerificationStatus,
  };

  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const existingUnsaved = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved).latest;
  const isUnsyncedEdit = Boolean(
    existingUnsaved &&
    (existingUnsaved.syncStatus === 'pending' ||
      existingUnsaved.syncStatus === 'failed' ||
      existingUnsaved.syncStatus === 'syncing' ||
      existingUnsaved.syncStatus === 'verification_pending')
  );
  const carriedPriorVerification: UnsavedProblemRevisionPriorVerification | undefined = (() => {
    if (!existingUnsaved) return undefined;
    if (
      existingUnsaved.syncStatus === 'verification_pending' &&
      typeof existingUnsaved.confirmedVersion === 'number' &&
      existingUnsaved.confirmedVersion > existingUnsaved.baseVersion
    ) {
      return {
        revisionId: existingUnsaved.revisionId,
        generation: existingUnsaved.generation,
        confirmedVersion: existingUnsaved.confirmedVersion,
        submittedProblem: {
          ...target,
          title: existingUnsaved.title,
          promptText: existingUnsaved.promptText,
          type: existingUnsaved.type ?? target.type,
          conceptIds: existingUnsaved.conceptIds ?? target.conceptIds,
          mathFormula: existingUnsaved.mathFormula,
          codeSnippet: existingUnsaved.codeSnippet,
          hints: existingUnsaved.hints,
          modelAnswer: existingUnsaved.modelAnswer,
          rubric: existingUnsaved.rubric,
          timeStandardMinutes: existingUnsaved.timeStandardMinutes ?? target.timeStandardMinutes,
          appliedConditionNote:
            existingUnsaved.appliedConditionNote !== undefined
              ? existingUnsaved.appliedConditionNote
              : target.appliedConditionNote,
          version: existingUnsaved.confirmedVersion,
        },
        editReason: existingUnsaved.editReason,
        reason: existingUnsaved.verificationFailureReason ?? 'read_error',
      };
    }
    return existingUnsaved.pendingPriorVerification;
  })();

  // Detect if previous attempt was an explicit partial_problem_only save
  // (problem body updated in storage with localUnrecordedBaseVersion, while unsaved revision failed to persist).
  // Never infer partial failure from qualityStatus ('review_after_edit') alone!
  const hasUnrecordedLocalEdit = Boolean(
    !isUnsyncedEdit &&
    typeof target.localUnrecordedBaseVersion === 'number' &&
    target.localUnrecordedBaseVersion < currentVersion &&
    target.serverConfirmedVersion !== currentVersion &&
    target.versionHistory &&
    target.versionHistory.length > 0
  );

  let baseVersion: number;
  let baseSnapshot: ProblemVersionSnapshot;
  let nextVersion: number;
  let nextGen: number;
  let newRevisionId: string;
  let nextVersionHistory: ProblemVersionSnapshot[];

  const candidateMerged: Problem = {
    ...target,
    ...updates,
  };

  if (isUnsyncedEdit) {
    baseVersion = existingUnsaved!.baseVersion;
    baseSnapshot = existingUnsaved!.baseSnapshot ?? snapshot;

    // Check if previous attempt did not persist problem body (partial_revision_only or total failed)
    // or did not persist revision (partial_problem_only with localUnrecordedBaseVersion)
    const isRetryAfterUnpersistedProblem = currentVersion <= existingUnsaved!.baseVersion;
    const isRetryAfterUnpersistedRevision =
      !persistedUnsaved &&
      typeof target.localUnrecordedBaseVersion === 'number' &&
      target.localUnrecordedBaseVersion === existingUnsaved!.baseVersion;

    const existingRevAsProblem: Problem = {
      ...target,
      title: existingUnsaved!.title,
      promptText: existingUnsaved!.promptText,
      type: existingUnsaved!.type ?? target.type,
      conceptIds: existingUnsaved!.conceptIds ?? target.conceptIds,
      mathFormula: existingUnsaved!.mathFormula,
      codeSnippet: existingUnsaved!.codeSnippet,
      hints: existingUnsaved!.hints,
      modelAnswer: existingUnsaved!.modelAnswer,
      rubric: existingUnsaved!.rubric,
      timeStandardMinutes: existingUnsaved!.timeStandardMinutes ?? target.timeStandardMinutes,
      appliedConditionNote: existingUnsaved!.appliedConditionNote !== undefined
        ? existingUnsaved!.appliedConditionNote
        : target.appliedConditionNote,
    };
    const isSameAsExistingUnsaved =
      getProblemEvaluationSignature(candidateMerged) === getProblemEvaluationSignature(existingRevAsProblem) &&
      existingUnsaved!.editReason === trimmedReason;

    if (isRetryAfterUnpersistedProblem || isRetryAfterUnpersistedRevision || isSameAsExistingUnsaved) {
      nextVersion = existingUnsaved!.revisionVersion;
      nextGen = isSameAsExistingUnsaved
        ? (existingUnsaved!.generation ?? 1)
        : (existingUnsaved!.generation ?? 1) + 1;
      newRevisionId = isSameAsExistingUnsaved && existingUnsaved!.revisionId
        ? existingUnsaved!.revisionId
        : `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    } else {
      nextVersion = currentVersion + 1;
      nextGen = (existingUnsaved!.generation ?? 1) + 1;
      newRevisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    const existingHist = target.versionHistory || [];
    const hasBaseSnap = existingHist.some((s) => s.version === baseSnapshot.version);
    nextVersionHistory = hasBaseSnap ? existingHist : [baseSnapshot, ...existingHist];
  } else if (hasUnrecordedLocalEdit) {
    // Recovering from partial_problem_only state where problem body was bumped to currentVersion
    // but unsaved_problem_revisions_v1 failed to persist (and in-memory revision was cleared/reloaded).
    const recordedBaseVer = target.localUnrecordedBaseVersion!;
    baseSnapshot =
      target.versionHistory!.find((s) => s.version === recordedBaseVer) ??
      target.versionHistory![0];
    baseVersion = recordedBaseVer;
    nextVersion = currentVersion;
    nextGen = (existingUnsaved?.generation ?? 0) + 1;
    newRevisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    nextVersionHistory = target.versionHistory!;
  } else {
    baseVersion = currentVersion;
    baseSnapshot = snapshot;
    nextVersion = currentVersion + 1;
    nextGen = (existingUnsaved?.generation ?? (existingUnsaved ? 1 : 0)) + 1;
    newRevisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    nextVersionHistory = [snapshot, ...(target.versionHistory || [])];
  }

  const updatedProblem: Problem = {
    ...target,
    ...updates,
    version: nextVersion,
    versionHistory: nextVersionHistory,
    qualityStatus: 'review_after_edit',
    lastReviewedAt: now,
    reviewNotes: `v${nextVersion} 수정 완료: ${trimmedReason}`,
    localUnrecordedBaseVersion: undefined,
  };

  const newRevision: UnsavedProblemRevision = {
    problemId,
    revisionId: newRevisionId,
    generation: nextGen,
    baseVersion,
    revisionVersion: nextVersion,
    title: updatedProblem.title,
    promptText: updatedProblem.promptText,
    type: updatedProblem.type,
    conceptIds: [...(updatedProblem.conceptIds || [])],
    mathFormula: updatedProblem.mathFormula,
    codeSnippet: updatedProblem.codeSnippet,
    hints: [...(updatedProblem.hints || [])],
    modelAnswer: updatedProblem.modelAnswer,
    rubric: [...(updatedProblem.rubric || [])],
    timeStandardMinutes: updatedProblem.timeStandardMinutes,
    appliedConditionNote: updatedProblem.appliedConditionNote,
    editReason: trimmedReason,
    revisedAt: now,
    syncStatus: 'pending',
    pendingPriorVerification: carriedPriorVerification,
    baseSnapshot,
  };

  // Record in-memory fallback separately from browser persistence
  setInMemoryProblemRevision(newRevision);

  // Attempt both persistent writes and verify each via read-after-write re-query
  const revWriteOk = saveUnsavedProblemRevision(newRevision);
  const verifiedRev = getUnsavedProblemRevision(problemId);
  const revisionPersisted = Boolean(
    revWriteOk &&
    verifiedRev &&
    verifiedRev.revisionId === newRevision.revisionId &&
    verifiedRev.revisionVersion === newRevision.revisionVersion &&
    verifiedRev.baseVersion === newRevision.baseVersion
  );

  // If the revision failed to persist, mark localUnrecordedBaseVersion on the problem record
  // so that if the problem body DOES persist (partial_problem_only), a subsequent retry
  // knows the exact unrecorded baseVersion without relying on qualityStatus.
  const problemToPersist: Problem = revisionPersisted
    ? { ...updatedProblem, localUnrecordedBaseVersion: undefined }
    : { ...updatedProblem, localUnrecordedBaseVersion: baseVersion };

  const baseProblemsList =
    problems.length > 0 ? problems : Object.values(getScopedLastKnownProblemsMap());
  const candidateProblems = baseProblemsList.some((p) => p.id === problemId)
    ? baseProblemsList.map((p) => (p.id === problemId ? problemToPersist : p))
    : [...baseProblemsList, problemToPersist];
  const probWriteOk = saveStoredProblems(candidateProblems);
  const reloadedProblems = loadStoredProblems();
  const verifiedProb = reloadedProblems.find((p) => p.id === problemId);
  const problemPersisted = Boolean(
    probWriteOk &&
    verifiedProb &&
    verifiedProb.version === problemToPersist.version &&
    problemContentMatches(verifiedProb, problemToPersist)
  );

  if (problemPersisted) {
    clearInMemoryProblem(problemId);
  } else {
    setInMemoryProblem(problemToPersist);
  }

  const allPersisted = revisionPersisted && problemPersisted;
  const partialFailure = (revisionPersisted && !problemPersisted) || (!revisionPersisted && problemPersisted);
  const status: ReviseProblemSaveStatus = allPersisted
    ? 'complete'
    : revisionPersisted
      ? 'partial_revision_only'
      : problemPersisted
        ? 'partial_problem_only'
        : 'failed';

  return {
    success: allPersisted,
    status,
    persisted: allPersisted,
    partialFailure,
    problemPersisted,
    revisionPersisted,
    updatedProblems: reloadedProblems,
    updatedProblem: problemPersisted ? (verifiedProb ?? problemToPersist) : null,
    memoryProblem: problemToPersist,
    memoryRevision: newRevision,
    error: allPersisted
      ? undefined
      : status === 'partial_revision_only'
        ? '부분 완료: 보호 수정본은 저장되었으나 문제 본문 저장소 동기화에 실패했습니다. 편집기 입력과 마지막 정상 원본은 유지되었으니 다시 시도해 주세요.'
        : status === 'partial_problem_only'
          ? '부분 완료: 문제 본문은 저장되었으나 미동기화 보호 수정본 기록에 실패했습니다. 편집기 입력은 유지되었으니 다시 시도해 주세요.'
          : '브라우저 저장 공간 부족(QuotaExceededError) 또는 접근 제한(SecurityError)으로 로컬 영속 저장에 실패했습니다. 메모리에는 임시 보존되었으며 편집기 입력과 마지막 정상 원본은 유지되었으니 다시 시도해 주세요.',
  };
}

/**
 * Re-approves a problem after quality review and/or edits, verifying mandatory 100-point rubric and required fields.
 * Restores problem to practice availability with status 'reapproved'.
 */
export function reapproveProblem(
  problemId: string,
  reapprovalNote?: string,
  currentMaterials?: Material[]
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  // Strict verification rules before re-approval
  if (!target.promptText || !target.promptText.trim()) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제 지문이 비어 있어 재승인할 수 없습니다.' };
  }
  if (!target.modelAnswer || !target.modelAnswer.trim()) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '모범 답안이 누락되어 재승인할 수 없습니다.' };
  }
  if (!target.rubric || target.rubric.length === 0) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '채점 기준(루브릭)이 비어 있어 재승인할 수 없습니다.' };
  }
  const rubricSum = target.rubric.reduce((sum, r) => sum + (Number(r.maxScore) || 0), 0);
  if (Math.abs(rubricSum - 100) > 0.001) {
    return {
      success: false,
      updatedProblems: problems,
      updatedProblem: null,
      error: `루브릭 배점 합계가 100점이 아닙니다. (현재 합계: ${rubricSum}점)`,
    };
  }

  const now = new Date().toISOString();
  // Mark all unresolved reports as resolved
  const updatedReports = (target.reports || []).map((r) => {
    if (r.status === 'open' || r.status === 'under_review') {
      return {
        ...r,
        status: 'resolved' as const,
        resolutionNote: reapprovalNote || '문제 검토 및 수정/보완 완료 후 사용자 재승인',
        resolvedAt: now,
      };
    }
    return r;
  });

  // Record the source versions the user confirmed, so re-saving the SAME source
  // content does not immediately re-flag the problem as outdated.
  const refreshedSourceMaterials = currentMaterials
    ? target.sourceMaterials?.map((ref) => {
      const material = currentMaterials.find((m) => m.id === ref.materialId);
      if (!material) return ref;
      return {
        ...ref,
        title: material.title,
        markdownHash: computeMarkdownHash(material.parsedMarkdown || ''),
      };
    })
    : target.sourceMaterials;

  // Re-verify actual quote against current material text
  const quote = (target.sourceExcerpt || (target as { sourceEvidenceQuote?: string }).sourceEvidenceQuote || '').trim();
  const normalize = (v: string) => v.replace(/\s+/g, ' ').trim();
  const normalizedQuote = normalize(quote);

  let newVerificationStatus: SourceVerificationStatus = target.sourceVerificationStatus || 'unverified';
  let newContentVersion = target.sourceContentVersion;
  let newNeedsSourceReview = Boolean(target.needsSourceReview);
  let newSourcePage = target.sourcePage;
  let verificationNote = '';

  if (currentMaterials && target.sourceMaterialId) {
    const matchedMaterial = currentMaterials.find((m) => m.id === target.sourceMaterialId);
    if (!matchedMaterial) {
      // Source material has been deleted: cannot verify quote
      newVerificationStatus = 'needs_review';
      newNeedsSourceReview = true;
      verificationNote = ' (연결된 원본 자료가 삭제되어 출처 검토 필요)';
    } else if (!matchedMaterial.parsedMarkdown || !matchedMaterial.parsedMarkdown.trim()) {
      // Material body could not be loaded / empty: cannot verify quote
      newVerificationStatus = 'needs_review';
      newNeedsSourceReview = true;
      verificationNote = ' (원본 자료 본문이 미로딩되어 출처 검토 필요)';
    } else {
      const currentMarkdown = matchedMaterial.parsedMarkdown;
      const currentHash = computeMarkdownHash(currentMarkdown);
      newContentVersion = currentHash;

      if (!normalizedQuote) {
        // No quote provided in the problem originally
        newVerificationStatus = 'unverified';
        newNeedsSourceReview = false;
      } else if (normalize(currentMarkdown).includes(normalizedQuote)) {
        // Quote verified in current material!
        newVerificationStatus = 'verified';
        newNeedsSourceReview = false;
        newSourcePage = verifyPageGrounding({
          markdown: currentMarkdown,
          quote: normalizedQuote,
          candidatePage: target.sourcePage,
          sourceRefs: matchedMaterial.sourceRefs,
        });
      } else {
        // Quote NO LONGER exists in the updated material text!
        newVerificationStatus = 'needs_review';
        newNeedsSourceReview = true; // MUST NOT promote to verified!
        verificationNote = ' (인용문이 수정된 자료 본문에서 확인되지 않아 출처 검토 필요)';
      }
    }
  } else if (!target.sourceMaterialId) {
    newVerificationStatus = target.sourceVerificationStatus === 'verified' && !normalizedQuote ? 'unverified' : (target.sourceVerificationStatus || 'unverified');
  }

  const updatedProblem: Problem = {
    ...target,
    reports: updatedReports,
    qualityStatus: 'reapproved',
    sourceMaterials: refreshedSourceMaterials,
    sourceContentVersion: newContentVersion,
    sourceVerificationStatus: newVerificationStatus,
    sourcePage: newSourcePage,
    difficultyLevel: target.difficultyLevel ?? (target.difficulty ? toAcademicDifficultyLevel(target.difficulty) : undefined),
    // Explicit user re-approval clears the outdated flag so problem returns to practice,
    // but needsSourceReview strictly preserves quote grounding validity.
    isOutdated: false,
    needsSourceReview: newNeedsSourceReview,
    lastReviewedAt: now,
    reviewNotes: (reapprovalNote || '품질 검증 통과 및 재승인 완료 (출제 가능 복귀)') + verificationNote,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Suspends problem from circulation if it cannot be salvaged or has fatal academic flaws.
 */
export function suspendProblem(
  problemId: string,
  suspensionReason?: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };

  const now = new Date().toISOString();
  const updatedProblem: Problem = {
    ...target,
    qualityStatus: 'suspended',
    lastReviewedAt: now,
    reviewNotes: suspensionReason || '품질 기준 미달로 사용 중지',
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

export function loadStoredAttempts(): Attempt[] {
  const raw = safeGetItem<Attempt[]>(STORAGE_KEYS.ATTEMPTS, []);
  return raw.map((a) => ({
    ...a,
    problemVersion: a.problemVersion ?? 1,
  }));
}

export function saveStoredAttempts(attempts: Attempt[]): void {
  safeSetItem(STORAGE_KEYS.ATTEMPTS, attempts);
}

export function loadStoredSettings(): RetentionModelSettings {
  return safeGetItem<RetentionModelSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_RETENTION_SETTINGS);
}

export function saveStoredSettings(settings: RetentionModelSettings): void {
  safeSetItem(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Resets all user changes back to original academic demo dataset
 */
export function resetToInitialDemoData(): void {
  if (typeof window === 'undefined' && !getLocalStorage()) return;
  safeRemoveItem(STORAGE_KEYS.CURRENT_SUBJECT_ID);
  safeRemoveItem(STORAGE_KEYS.SUBJECTS);
  safeRemoveItem(STORAGE_KEYS.MATERIALS);
  safeRemoveItem(MATERIAL_BODY_HASHES_KEY);
  safeRemoveItem(DELETED_MATERIAL_IDS_KEY);
  safeRemoveItem(LOCAL_ONLY_MATERIAL_IDS_KEY);
  safeRemoveItem(MATERIAL_SAVE_FAILURE_KEY);
  safeRemoveItem(MATERIAL_SYNC_STATE_KEY);
  safeRemoveItem(MATERIAL_SERVER_SAVE_KEY);
  safeRemoveItem(STORAGE_KEYS.CONCEPTS);
  safeRemoveItem(STORAGE_KEYS.CONCEPT_DRAFTS);
  safeRemoveItem(STORAGE_KEYS.PROBLEMS);
  safeRemoveItem(STORAGE_KEYS.PROBLEM_DRAFTS);
  safeRemoveItem(STORAGE_KEYS.ATTEMPTS);
  safeRemoveItem(MOCK_EXAM_KEY);
  safeRemoveItem(STORAGE_KEYS.SETTINGS);
  safeRemoveItem(STORAGE_KEYS.STUDY_PLAN_SETTINGS);
  safeRemoveItem(STORAGE_KEYS.STUDY_PLAN_ITEMS);
  safeRemoveItem(STORAGE_KEYS.PERSONALIZATION_SETTINGS);
  safeRemoveItem(STORAGE_KEYS.PERSONALIZATION_STATE);
  safeRemoveItem(LOGIC_SESSIONS_KEY);
  safeRemoveItem(REC_HALLENGE_KEY);
  safeRemoveItem(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS);
  safeRemoveItem(STORAGE_KEYS.CONCEPT_SCHEDULE_ADJUSTMENTS);
  const revKey = scopedStorageKey(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS);
  delete inMemoryRevisionFallback[revKey];
  const probKey = scopedStorageKey(STORAGE_KEYS.PROBLEMS);
  delete inMemoryProblemFallback[probKey];
  delete lastKnownProblemsByScope[probKey];
  // Demo data is now loaded only through this explicit reset action.
  saveStoredSubjects(INITIAL_SUBJECTS);
  saveStoredMaterials(INITIAL_MATERIALS);
  saveStoredConcepts(INITIAL_CONCEPTS);
  saveStoredProblems(INITIAL_PROBLEMS);
  saveActiveSubjectId(INITIAL_SUBJECTS[0].id);
}

// Stage 10: Personal review recommendation settings & correction state
export function loadStoredPersonalizationSettings(): PersonalizationSettings {
  const loaded = safeGetItem<Partial<PersonalizationSettings>>(
    STORAGE_KEYS.PERSONALIZATION_SETTINGS,
    DEFAULT_PERSONALIZATION_SETTINGS
  );
  return {
    enabled: loaded.enabled ?? DEFAULT_PERSONALIZATION_SETTINGS.enabled,
    tendency: loaded.tendency ?? DEFAULT_PERSONALIZATION_SETTINGS.tendency,
    autoAdjust: loaded.autoAdjust ?? DEFAULT_PERSONALIZATION_SETTINGS.autoAdjust,
    updatedAt: loaded.updatedAt ?? DEFAULT_PERSONALIZATION_SETTINGS.updatedAt,
  };
}

export function saveStoredPersonalizationSettings(settings: PersonalizationSettings): void {
  safeSetItem(STORAGE_KEYS.PERSONALIZATION_SETTINGS, settings);
}

export function loadStoredPersonalizationState(): PersonalizationCorrectionState | null {
  return safeGetItem<PersonalizationCorrectionState | null>(STORAGE_KEYS.PERSONALIZATION_STATE, null);
}

export function saveStoredPersonalizationState(state: PersonalizationCorrectionState): void {
  safeSetItem(STORAGE_KEYS.PERSONALIZATION_STATE, state);
}

// Stage 9: Study Plan Storage Operations
export function loadStoredStudyPlanSettings(): StudyPlanSettings {
  return safeGetItem<StudyPlanSettings>(STORAGE_KEYS.STUDY_PLAN_SETTINGS, DEFAULT_STUDY_PLAN_SETTINGS);
}

export function saveStoredStudyPlanSettings(settings: StudyPlanSettings): void {
  safeSetItem(STORAGE_KEYS.STUDY_PLAN_SETTINGS, settings);
}

export function loadStoredStudyPlanItems(): StudyPlanItem[] {
  return safeGetItem<StudyPlanItem[]>(STORAGE_KEYS.STUDY_PLAN_ITEMS, []);
}

export function saveStoredStudyPlanItems(items: StudyPlanItem[]): void {
  safeSetItem(STORAGE_KEYS.STUDY_PLAN_ITEMS, items);
}

export function markStudyPlanItemCompleted(
  itemId: string,
  linkage: { attemptId?: string; eventId?: string; mockSessionId?: string }
): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const now = new Date().toISOString();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
        ...i,
        status: 'completed' as const,
        completedAt: now,
        completedAttemptId: linkage.attemptId || i.completedAttemptId,
        completedEventId: linkage.eventId || i.completedEventId,
        completedMockSessionId: linkage.mockSessionId || i.completedMockSessionId,
      }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

export function postponeStudyPlanItem(itemId: string, nextDate: string): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
        ...i,
        status: 'postponed' as const,
        assignedDate: nextDate,
      }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

export function skipStudyPlanItem(itemId: string): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
        ...i,
        status: 'skipped' as const,
      }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

/** 계획 연결 결과 (호출자가 부분 실패를 인지할 수 있도록 노출) */
export interface PlanLinkageResult {
  /** 계획 연결을 시도했는지 여부 */
  attempted: boolean;
  /** 연결 대상으로 선택된 계획 항목 ID */
  linkedItemId: string | null;
  /** 계획 항목 완료가 저장·검증되었는지 여부 */
  persisted: boolean;
  /** 연결을 건너뛴 사유 (없으면 undefined) */
  skippedReason?:
  | 'PLAN_ITEM_NOT_FOUND'
  | 'PLAN_ITEM_MISMATCH'
  | 'PLAN_ITEM_SKIPPED'
  | 'PLAN_ITEM_COMPLETED_BY_OTHER'
  | 'NO_MATCHING_ITEM'
  | 'CORE_RECORD_NOT_PERSISTED';
  /** 완료 충돌 시 기존 완료 기록의 Attempt ID */
  conflictWithAttemptId?: string;
}

export interface AttemptSaveResult {
  updatedConcepts: Concept[];
  updatedAttempts: Attempt[];
  /** 재시도가 필요한(또는 충돌/대상 없음) 경우 true. complete/already_completed는 false. */
  partial: boolean;
  status: AttemptSaveStatus;
  /** Attempt가 실제 저장·검증되었는지 */
  attemptPersisted: boolean;
  /** ReviewEvent가 실제 저장·검증되었는지 */
  eventPersisted: boolean;
  /** 호출부에 표시할 안내 문구 */
  message?: string;
  planLinkage: PlanLinkageResult;
}

/**
 * Adds an attempt and automatically creates a new ReviewEvent on the concept,
 * recalculating its retention score and status dynamically without artificial duplicates.
 * Also links the attempt to the matching StudyPlanItem of the SAME subject, concept,
 * problem, and review round — never completing a different concept's plan merely
 * because a shared (composite) problem was solved.
 *
 * Callers can pass an explicit `planItemId` to link the exact executed plan item;
 * the id is still validated against the attempt.
 */
export function recordAttemptAndUpdateConcept(
  attempt: Attempt,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  linkage?: { planItemId?: string }
): AttemptSaveResult {
  const currentConcepts = loadStoredConcepts();
  const currentAttempts = loadStoredAttempts();

  const alreadyAttemptStored = currentAttempts.some((a) => a.id === attempt.id);
  // Recovery must use the STORED record, not a possibly different retry payload,
  // so a recovered event can never disagree with the saved Attempt's score.
  const effectiveAttempt = alreadyAttemptStored
    ? currentAttempts.find((a) => a.id === attempt.id) ?? attempt
    : attempt;

  const targetConcept = currentConcepts.find(
    (c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId
  );
  if (!targetConcept) {
    throw new Error('풀이 기록의 개념과 과목이 일치하지 않습니다.');
  }

  const alreadyEventStored = targetConcept.events.some((e) => e.attemptId === effectiveAttempt.id);

  // 1. Persist the Attempt if it is missing (idempotent).
  const newAttempts = alreadyAttemptStored ? currentAttempts : [effectiveAttempt, ...currentAttempts];
  if (!alreadyAttemptStored) {
    saveStoredAttempts(newAttempts);
  }

  // 2. Persist the Concept ReviewEvent (strictly attributed to primary concept).
  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== effectiveAttempt.conceptId || c.subjectId !== effectiveAttempt.subjectId) return c;
    const conceptAlreadyHasEvent = c.events.some((e) => e.attemptId === effectiveAttempt.id);
    if (conceptAlreadyHasEvent) return c;



    const newEvent: ReviewEvent = {
      id: `ev-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptId: c.id,
      at: effectiveAttempt.at,
      dayOffset: 0, // Recorded today
      kind: 'attempt',
      title: `풀이 제출 (${effectiveAttempt.calculatedScore}점)`,
      resultScore: effectiveAttempt.calculatedScore,
      confidence: effectiveAttempt.confidence,
      errorType: effectiveAttempt.errorType,
      academicErrorType: effectiveAttempt.academicErrorType,
      structuredError: effectiveAttempt.structuredError,
      sourceProvenance: effectiveAttempt.sourceProvenance,
      hintCount: effectiveAttempt.hintCount,
      notes: effectiveAttempt.reasoningNotes,
      sourceRef: c.chapterRef,
      evaluationSummary: effectiveAttempt.evaluatorFeedback,
      rubricScores: effectiveAttempt.rubricResults,
      attemptId: effectiveAttempt.id,
      strengths: effectiveAttempt.strengths,
      criticalImprovements: effectiveAttempt.criticalImprovements,
      needsReview: effectiveAttempt.needsReview,
    };

    const updatedEvents = [...c.events, newEvent];
    const newCurrentScore = calculateCurrentConceptScore(updatedEvents, settings, new Date(effectiveAttempt.at));
    const newMasteryScore = calculateConceptMasteryScore(updatedEvents, new Date(effectiveAttempt.at), c.baseScore);
    const newStatus = getConceptStatusFromScore(newCurrentScore);

    return {
      ...c,
      events: updatedEvents,
      lastAttemptAt: effectiveAttempt.at,
      lastAttemptDayOffset: 0,
      firstLearnedAt: c.firstLearnedAt || effectiveAttempt.at,
      firstLearnedDayOffset: c.firstLearnedDayOffset ?? 0,
      isLearned: true,
      baseScore: c.baseScore > 0 ? c.baseScore : effectiveAttempt.calculatedScore,
      currentScore: newCurrentScore,
      retentionScore: newCurrentScore,
      masteryScore: newMasteryScore,
      status: newStatus,
      exerciseCount: c.exerciseCount + 1,
      postponeDays: 0, // Reset postponement upon active confirmed review
      postponedUntil: undefined,
    };
  });

  saveStoredConcepts(updatedConcepts);

  // 3. Verify core records (Attempt + ReviewEvent) persisted.
  const attemptPersisted = loadStoredAttempts().some((a) => a.id === effectiveAttempt.id);
  const eventPersisted =
    loadStoredConcepts()
      .find((c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId)
      ?.events.some((e) => e.attemptId === effectiveAttempt.id) === true;

  // 4. CRITICAL INVARIANT: If core records failed to persist, DO NOT complete any plan items or reservations!
  if (!attemptPersisted || !eventPersisted) {
    const currentPlanItems = loadStoredStudyPlanItems();
    const conflictItems = currentPlanItems.filter(
      (i) => i.status === 'completed' && i.completedAttemptId === effectiveAttempt.id
    );
    if (conflictItems.length > 0) {
      const sanitized = currentPlanItems.map((i) =>
        i.status === 'completed' && i.completedAttemptId === effectiveAttempt.id
          ? { ...i, status: 'pending' as const, completedAt: undefined, completedAttemptId: undefined }
          : i
      );
      saveStoredStudyPlanItems(sanitized);
    }
    return {
      updatedConcepts: loadStoredConcepts(),
      updatedAttempts: loadStoredAttempts(),
      partial: true,
      status: 'retryable_failure',
      attemptPersisted,
      eventPersisted,
      message: '풀이 기록 저장이 일부만 완료되었습니다. 같은 기록으로 다시 시도하면 누락분이 복구됩니다.',
      planLinkage: {
        attempted: Boolean(linkage?.planItemId),
        linkedItemId: null,
        persisted: false,
        skippedReason: 'CORE_RECORD_NOT_PERSISTED',
      },
    };
  }

  // 4b. Core records verified: Clear any postponement schedule adjustment set prior to or for this review attempt.
  // Only clear on the initial confirmed recording (!alreadyEventStored) so that retry attempts do NOT
  // repeat the reset and do NOT wipe out any new postponement the user configured afterwards.
  if (!alreadyEventStored) {
    clearConceptScheduleAdjustment(effectiveAttempt.conceptId, {
      onlyIfUpdatedBefore: effectiveAttempt.at || new Date().toISOString(),
    });
  }

  // 5. Core records verified. Now proceed to link the StudyPlanItem for THIS review round only.
  const conceptRounds = targetConcept.events
    .filter((e) => e.kind === 'attempt' || e.kind === 'review')
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const existingEventIndex = conceptRounds.findIndex((e) => e.attemptId === effectiveAttempt.id);
  const attemptRound = existingEventIndex >= 0 ? existingEventIndex + 1 : conceptRounds.length + 1;

  const currentPlanItems = loadStoredStudyPlanItems();
  const planLinkage: PlanLinkageResult = {
    attempted: true,
    linkedItemId: null,
    persisted: false,
  };

  let matchingPlanItem: StudyPlanItem | undefined;

  if (linkage?.planItemId) {
    // Explicit link: still validate every dimension of the target item.
    const byId = currentPlanItems.find((i) => i.id === linkage.planItemId);
    if (!byId) {
      planLinkage.skippedReason = 'PLAN_ITEM_NOT_FOUND';
    } else if (byId.status === 'skipped') {
      planLinkage.skippedReason = 'PLAN_ITEM_SKIPPED';
    } else if (
      byId.subjectId !== effectiveAttempt.subjectId ||
      (byId.conceptId !== undefined && byId.conceptId !== effectiveAttempt.conceptId) ||
      (byId.problemId !== undefined && byId.problemId !== effectiveAttempt.problemId)
    ) {
      planLinkage.skippedReason = 'PLAN_ITEM_MISMATCH';
    } else if (byId.status === 'completed') {
      // Same attempt retry is idempotent success; a different attempt must never
      // overwrite the existing completion history. (Round is ignored here because
      // the stored completion already represents this round.)
      if (byId.completedAttemptId === effectiveAttempt.id) {
        matchingPlanItem = byId;
      } else {
        planLinkage.skippedReason = 'PLAN_ITEM_COMPLETED_BY_OTHER';
        planLinkage.conflictWithAttemptId = byId.completedAttemptId;
      }
    } else if (byId.round !== undefined && byId.round !== attemptRound) {
      planLinkage.skippedReason = 'PLAN_ITEM_MISMATCH';
    } else {
      matchingPlanItem = byId;
    }
  } else {
    // Implicit link: require subject + concept + problem + round to agree.
    // Legacy items that omit conceptId/round are handled by the validated fallback below.
    matchingPlanItem = currentPlanItems.find((i) => {
      if (i.status === 'completed' || i.status === 'skipped') return false;
      if (i.subjectId !== effectiveAttempt.subjectId) return false;
      if (i.problemId !== effectiveAttempt.problemId) return false;
      // A plan item that names a concept must match the attempt's concept.
      if (i.conceptId !== undefined && i.conceptId !== effectiveAttempt.conceptId) return false;
      // A plan item that names a round must match this attempt's round.
      if (i.round !== undefined && i.round !== attemptRound) return false;
      // Legacy fallback (no concept, no round): only accept when the item's concept
      // scope is absent or explicitly includes the attempt's concept.
      if (
        i.conceptId === undefined &&
        i.round === undefined &&
        Array.isArray(i.conceptIds) &&
        i.conceptIds.length > 0 &&
        !i.conceptIds.includes(effectiveAttempt.conceptId)
      ) {
        return false;
      }
      return true;
    });
    if (!matchingPlanItem) {
      planLinkage.skippedReason = 'NO_MATCHING_ITEM';
    }
  }

  if (matchingPlanItem) {
    const targetId = matchingPlanItem.id;
    const updatedPlanItems = currentPlanItems.map((i) =>
      i.id === targetId
        ? {
          ...i,
          status: 'completed' as const,
          completedAt: effectiveAttempt.at,
          completedAttemptId: effectiveAttempt.id,
        }
        : i
    );
    saveStoredStudyPlanItems(updatedPlanItems);
    const persistedItem = loadStoredStudyPlanItems().find((i) => i.id === targetId);
    planLinkage.linkedItemId = targetId;
    planLinkage.persisted =
      persistedItem?.status === 'completed' &&
      persistedItem?.completedAttemptId === effectiveAttempt.id;
  }

  // Classify the outcome so callers can react precisely (retry vs resolve vs keep).
  let status: AttemptSaveStatus;
  let message: string | undefined;

  if (planLinkage.skippedReason === 'PLAN_ITEM_COMPLETED_BY_OTHER') {
    status = 'link_conflict';
    message = '이 계획은 이미 다른 풀이 기록으로 완료되었습니다. 기존 완료 기록을 유지하고 이 풀이는 계획 연결 없이 보존할 수 있습니다.';
  } else if (planLinkage.skippedReason === 'PLAN_ITEM_MISMATCH') {
    status = 'link_conflict';
    message = '계획 항목이 현재 풀이와 일치하지 않습니다. 올바른 계획을 선택하거나 계획 연결 없이 기록을 보존하세요.';
  } else if (
    planLinkage.skippedReason === 'PLAN_ITEM_NOT_FOUND' ||
    planLinkage.skippedReason === 'PLAN_ITEM_SKIPPED'
  ) {
    status = 'target_missing';
    message = '연결하려던 계획 항목을 사용할 수 없습니다(삭제·건너뜀). 계획 연결 없이 기록을 보존할 수 있습니다.';
  } else if (matchingPlanItem !== undefined && !planLinkage.persisted) {
    status = 'retryable_failure';
    message = '계획 완료 반영 저장에 실패했습니다. 같은 기록으로 다시 시도해 주세요.';
  } else if (
    alreadyAttemptStored &&
    alreadyEventStored &&
    (!linkage?.planItemId || planLinkage.persisted)
  ) {
    status = 'already_completed';
    message = '이미 기록된 풀이입니다.';
  } else {
    status = 'complete';
  }

  const partial = status !== 'complete' && status !== 'already_completed';

  return {
    updatedConcepts,
    updatedAttempts: newAttempts,
    partial,
    status,
    attemptPersisted,
    eventPersisted,
    message,
    planLinkage,
  };
}

/**
 * Stage 13: Records an ASSISTED revision answer as a separate Attempt + an
 * `assisted_revision` event. The event is excluded from confirmed retention
 * events, so it never extends the recommended interval or counts as an
 * independent review. The original Attempt is never modified.
 */
export function recordAssistedRevisionAttempt(
  attempt: Attempt
): { updatedConcepts: Concept[]; updatedAttempts: Attempt[] } {
  const currentConcepts = loadStoredConcepts();
  const currentAttempts = loadStoredAttempts();

  const alreadyAttemptStored = currentAttempts.some((a) => a.id === attempt.id);
  const effectiveAttempt = alreadyAttemptStored
    ? currentAttempts.find((a) => a.id === attempt.id) ?? attempt
    : attempt;

  const targetConcept = currentConcepts.find(
    (c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId
  );
  if (!targetConcept) {
    throw new Error('보완 답안의 개념과 과목이 일치하지 않습니다.');
  }

  const alreadyEventStored = targetConcept.events.some((e) => e.attemptId === effectiveAttempt.id);
  if (alreadyAttemptStored && alreadyEventStored) {
    return { updatedConcepts: currentConcepts, updatedAttempts: currentAttempts };
  }

  const newAttempts = alreadyAttemptStored ? currentAttempts : [effectiveAttempt, ...currentAttempts];
  if (!alreadyAttemptStored) saveStoredAttempts(newAttempts);

  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== effectiveAttempt.conceptId || c.subjectId !== effectiveAttempt.subjectId) return c;
    if (alreadyEventStored) return c;

    const newEvent: ReviewEvent = {
      id: `ev-assisted-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptId: c.id,
      at: effectiveAttempt.at,
      dayOffset: 0,
      kind: 'assisted_revision',
      title: `보완 답안 (${effectiveAttempt.calculatedScore}점)`,
      resultScore: effectiveAttempt.calculatedScore,
      confidence: effectiveAttempt.confidence,
      errorType: effectiveAttempt.errorType,
      hintCount: effectiveAttempt.hintCount,
      notes: effectiveAttempt.reasoningNotes,
      sourceRef: c.chapterRef,
      evaluationSummary: effectiveAttempt.evaluatorFeedback,
      rubricScores: effectiveAttempt.rubricResults,
      attemptId: effectiveAttempt.id,
      strengths: effectiveAttempt.strengths,
      criticalImprovements: effectiveAttempt.criticalImprovements,
      needsReview: effectiveAttempt.needsReview,
      academicErrorType: effectiveAttempt.academicErrorType,
      structuredError: effectiveAttempt.structuredError,
      sourceProvenance: effectiveAttempt.sourceProvenance,
    };

    // Deliberately do NOT recalculate currentScore/exerciseCount/status: an
    // assisted revision is not an independent review performance.
    return { ...c, events: [...c.events, newEvent] };
  });

  saveStoredConcepts(updatedConcepts);

  const attemptPersisted = loadStoredAttempts().some((a) => a.id === effectiveAttempt.id);
  const eventPersisted = loadStoredConcepts()
    .find((c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId)
    ?.events.some((e) => e.attemptId === effectiveAttempt.id);
  if (!attemptPersisted || !eventPersisted) {
    throw new Error('보완 답안 저장이 완료되지 않았습니다. 다시 시도해 주세요.');
  }

  return { updatedConcepts, updatedAttempts: newAttempts };
}

/**
 * Scans stored Attempts and rebuilds any missing review events on their concepts.
 * Used to recover after a partial save (Attempt persisted, event missing).
 */
export interface RecoveryOutcome {
  recoveredCount: number;
  updatedConcepts: Concept[];
  /** Attempts whose event/plan/reservation could not be repaired this pass. */
  unresolved: { attemptId: string; reason: string }[];
}

export function recoverMissingAttemptEvents(
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS
): RecoveryOutcome {
  const concepts = loadStoredConcepts();
  const attempts = loadStoredAttempts();
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const currentPlanItems = loadStoredStudyPlanItems();
  const attemptIds = new Set(attempts.map((a) => a.id));

  let recoveredCount = 0;
  const unresolved: { attemptId: string; reason: string }[] = [];

  // Identify completed plan items whose connecting attempt record is completely missing
  for (const item of currentPlanItems) {
    if (item.status === 'completed' && item.completedAttemptId) {
      if (!attemptIds.has(item.completedAttemptId)) {
        unresolved.push({ attemptId: item.completedAttemptId, reason: 'PLAN_COMPLETED_EVENT_MISSING' });
      }
    }
  }

  for (const attempt of attempts) {
    const concept = conceptById.get(attempt.conceptId);
    if (!concept || concept.subjectId !== attempt.subjectId) continue;

    try {
      // Assisted revisions must NEVER be recovered as independent attempts:
      // that would create an `attempt` event and inflate the review count.
      if (attempt.attemptOrigin === 'assisted_revision') {
        const hadAssisted = concept.events.some((e: ReviewEvent) => e.attemptId === attempt.id);
        recordAssistedRevisionAttempt(attempt);
        const assistedNow = loadStoredConcepts()
          .find((c) => c.id === attempt.conceptId)
          ?.events.some((e: ReviewEvent) => e.attemptId === attempt.id) === true;
        if (!assistedNow) {
          unresolved.push({ attemptId: attempt.id, reason: 'EVENT_NOT_PERSISTED' });
        } else if (!hadAssisted) {
          recoveredCount += 1;
        }
        continue;
      }

      // Independent / rechallenge attempts.
      const hadEvent = concept.events.some((e: ReviewEvent) => e.attemptId === attempt.id);
      const matchingPlanItem = currentPlanItems.find(
        (i) => (attempt.planItemId && i.id === attempt.planItemId) || i.completedAttemptId === attempt.id
      );
      const planItemId = attempt.planItemId || matchingPlanItem?.id;
      const hadPlanCompleted =
        matchingPlanItem?.status === 'completed' && matchingPlanItem.completedAttemptId === attempt.id;

      const result = recordAttemptAndUpdateConcept(attempt, settings, {
        planItemId,
      });

      // Verify each dimension independently. The core record (Attempt + event)
      // must be complete before the plan/reservation may be considered repaired.
      const corePersisted = result.attemptPersisted && result.eventPersisted;
      const repairedEvent = !hadEvent && result.eventPersisted;
      const planOk =
        !planItemId ||
        (result.planLinkage.linkedItemId !== null && result.planLinkage.persisted);

      if (!result.attemptPersisted) unresolved.push({ attemptId: attempt.id, reason: 'ATTEMPT_NOT_PERSISTED' });
      if (!result.eventPersisted) unresolved.push({ attemptId: attempt.id, reason: 'EVENT_NOT_PERSISTED' });
      if (!planOk) {
        unresolved.push({ attemptId: attempt.id, reason: `PLAN_${result.planLinkage.skippedReason || 'FAILED'}` });
      }

      // Reservation completion is only allowed once the core record persists, and
      // it must carry the attempt id so ownership is verifiable later.
      let reservationCompleted = false;
      if (attempt.rechallengeReservationId) {
        if (!corePersisted) {
          unresolved.push({ attemptId: attempt.id, reason: 'RESERVATION_SKIPPED_CORE_RECORD_FAILED' });
        } else {
          const completion = completeRechallengeReservation(attempt.rechallengeReservationId, {
            attemptId: attempt.id,
            subjectId: attempt.subjectId,
            conceptId: attempt.conceptId,
            problemId: attempt.problemId,
            problemVersion: attempt.problemVersion,
          });
          if (completion.status === 'completed') reservationCompleted = true;
          else if (completion.status !== 'already_completed') {
            unresolved.push({ attemptId: attempt.id, reason: `RESERVATION_${completion.status}` });
          }
        }
      }

      // Count as recovered ONLY when the core record is persisted AND something
      // was actually repaired (a plan-only success with a failed event is not).
      if (corePersisted && (repairedEvent || (planItemId && planOk && !hadPlanCompleted) || reservationCompleted)) {
        recoveredCount += 1;
      }
    } catch (cause) {
      unresolved.push({ attemptId: attempt.id, reason: cause instanceof Error ? cause.message : 'UNKNOWN' });
    }
  }

  return { recoveredCount, updatedConcepts: loadStoredConcepts(), unresolved };
}

/**
 * Read-only audit: reports attempts whose review event kind does not match their
 * provenance (e.g. an assisted revision that was wrongly recorded as an attempt).
 * The original Attempt is never modified; callers can decide on a correction.
 */
export function verifyAttemptEventOrigins(): {
  mismatches: { attemptId: string; expectedKind: string; actualKinds: string[] }[];
} {
  const concepts = loadStoredConcepts();
  const attempts = loadStoredAttempts();
  const mismatches: { attemptId: string; expectedKind: string; actualKinds: string[] }[] = [];

  for (const attempt of attempts) {
    const concept = concepts.find((c) => c.id === attempt.conceptId);
    if (!concept) continue;
    const events = concept.events.filter((e) => e.attemptId === attempt.id);
    if (events.length === 0) continue;

    const expectedKind = attempt.attemptOrigin === 'assisted_revision' ? 'assisted_revision' : 'attempt';
    const actualKinds = Array.from(new Set(events.map((e) => e.kind)));
    if (!actualKinds.includes(expectedKind) || actualKinds.some((k) => k !== expectedKind && k !== 'assisted_revision')) {
      mismatches.push({ attemptId: attempt.id, expectedKind, actualKinds });
    }
  }

  return { mismatches };
}

/**
 * Postpones a concept's review schedule by specified calendar days (default +1 day).
 * CRITICAL INVARIANT: This modifies ONLY the schedule offset (postponeDays & postponedUntil).
 * It NEVER inflates retention score, NEVER modifies baseScore, and NEVER appends fake ReviewEvents.
 */
export function postponeConceptReview(
  conceptId: string,
  daysToAdd: number = 1,
  referenceDate: Date = new Date()
): { updatedConcepts: Concept[]; postponedConcept: Concept | null } {
  const currentConcepts = loadStoredConcepts(referenceDate);
  let postponedConcept: Concept | null = null;

  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== conceptId) return c;

    const currentPostpone = c.postponeDays || 0;
    const nextPostpone = currentPostpone + daysToAdd;
    const postponedUntil = addDaysToDate(referenceDate, nextPostpone);

    const updated: Concept = {
      ...c,
      postponeDays: nextPostpone,
      postponedUntil,
      // ABSOLUTE INTEGRITY: Retention score and review events remain unchanged
      events: [...c.events],
      baseScore: c.baseScore,
      currentScore: c.currentScore,
      status: c.status,
    };
    postponedConcept = updated;
    return updated;
  });

  saveStoredConcepts(updatedConcepts);
  if (postponedConcept) {
    saveConceptScheduleAdjustment(conceptId, (postponedConcept as Concept).postponeDays || 1, (postponedConcept as Concept).postponedUntil);
  }
  return { updatedConcepts, postponedConcept };
}

export function getAttemptById(attemptId: string): Attempt | null {
  const attempts = loadStoredAttempts();
  return attempts.find((a) => a.id === attemptId) || null;
}

// ---------------------------------------------------------------------------
// Unsaved Problem Revisions (Bug 1, Bug 2 & Bug 3)
// ---------------------------------------------------------------------------

// Separate in-memory revision buffer keyed by scoped storage key,
// strictly distinguished from browser localStorage persistence.
const inMemoryRevisionFallback: Record<string, Record<string, UnsavedProblemRevision>> = {};

function getScopedInMemoryRevisionMap(): Record<string, UnsavedProblemRevision> {
  const key = scopedStorageKey(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS);
  if (!inMemoryRevisionFallback[key]) {
    inMemoryRevisionFallback[key] = {};
  }
  return inMemoryRevisionFallback[key];
}

export function setInMemoryProblemRevision(
  revision: UnsavedProblemRevision,
  options?: { onlyIfRevisionId?: string; onlyIfGeneration?: number }
): boolean {
  const map = getScopedInMemoryRevisionMap();
  const existing = map[revision.problemId];
  if (existing) {
    if (options?.onlyIfRevisionId && existing.revisionId !== options.onlyIfRevisionId) {
      return false;
    }
    if (options?.onlyIfGeneration !== undefined && existing.generation !== options.onlyIfGeneration) {
      return false;
    }
    if (
      revision.generation !== undefined &&
      existing.generation !== undefined &&
      revision.generation < existing.generation
    ) {
      return false;
    }
    if (
      revision.revisionId &&
      existing.revisionId &&
      revision.revisionId !== existing.revisionId &&
      (existing.generation ?? 0) >= (revision.generation ?? 0) &&
      new Date(existing.revisedAt).getTime() > new Date(revision.revisedAt).getTime()
    ) {
      return false;
    }
  }
  map[revision.problemId] = revision;
  return true;
}

export function getInMemoryProblemRevision(problemId: string): UnsavedProblemRevision | null {
  const map = getScopedInMemoryRevisionMap();
  return map[problemId] || null;
}

export function clearInMemoryProblemRevision(
  problemId: string,
  expected?: { revisionId?: string; generation?: number }
): boolean {
  const map = getScopedInMemoryRevisionMap();
  const existing = map[problemId];
  if (!existing) return false;
  if (expected) {
    if (expected.revisionId && existing.revisionId && existing.revisionId !== expected.revisionId) {
      return false;
    }
    if (expected.generation !== undefined && existing.generation !== undefined && existing.generation > expected.generation) {
      return false;
    }
  }
  delete map[problemId];
  return true;
}

/**
 * Reconciles persisted and in-memory problem revision records using strict precedence:
 * generation > revisedAt timestamp.
 * Returns the latest revision, its source, and whether the persisted record is stale.
 */
export function resolveLatestProblemRevision(
  persisted: UnsavedProblemRevision | null | undefined,
  memory: UnsavedProblemRevision | null | undefined
): {
  latest: UnsavedProblemRevision | null;
  source: 'persisted' | 'memory' | 'none';
  persistedStale: boolean;
} {
  if (!persisted && !memory) {
    return { latest: null, source: 'none', persistedStale: false };
  }
  if (!persisted) {
    return { latest: memory!, source: 'memory', persistedStale: false };
  }
  if (!memory) {
    return { latest: persisted, source: 'persisted', persistedStale: false };
  }

  const pGen = persisted.generation ?? 0;
  const mGen = memory.generation ?? 0;

  if (persisted.revisionId && memory.revisionId && persisted.revisionId === memory.revisionId) {
    if (mGen > pGen) {
      return { latest: memory, source: 'memory', persistedStale: true };
    }
    if (pGen > mGen) {
      return { latest: persisted, source: 'persisted', persistedStale: false };
    }
    // Same revision ID and generation: memory holds active in-flight syncStatus (e.g. 'syncing')
    return { latest: memory, source: 'memory', persistedStale: false };
  }

  if (mGen > pGen) {
    return { latest: memory, source: 'memory', persistedStale: true };
  }
  if (pGen > mGen) {
    return { latest: persisted, source: 'persisted', persistedStale: false };
  }

  const pTime = new Date(persisted.revisedAt).getTime();
  const mTime = new Date(memory.revisedAt).getTime();
  if (mTime > pTime) {
    return { latest: memory, source: 'memory', persistedStale: true };
  }
  return { latest: persisted, source: 'persisted', persistedStale: false };
}

export function getEffectiveUnsavedProblemRevision(problemId: string): UnsavedProblemRevision | null {
  const persisted = getUnsavedProblemRevision(problemId);
  const memory = getInMemoryProblemRevision(problemId);
  return resolveLatestProblemRevision(persisted, memory).latest;
}

export function loadAllEffectiveUnsavedProblemRevisions(): Record<string, UnsavedProblemRevision> {
  const persisted = loadUnsavedProblemRevisions();
  const memoryMap = getScopedInMemoryRevisionMap();
  const result: Record<string, UnsavedProblemRevision> = {};
  const allIds = new Set([...Object.keys(persisted), ...Object.keys(memoryMap)]);
  for (const id of allIds) {
    const resolved = resolveLatestProblemRevision(persisted[id], memoryMap[id]).latest;
    if (resolved) {
      result[id] = resolved;
    }
  }
  return result;
}

function revisionRecordMatches(a: UnsavedProblemRevision, b: UnsavedProblemRevision): boolean {
  return (
    a.problemId === b.problemId &&
    (a.revisionId ?? '') === (b.revisionId ?? '') &&
    (a.generation ?? 0) === (b.generation ?? 0) &&
    a.baseVersion === b.baseVersion &&
    a.revisionVersion === b.revisionVersion &&
    a.syncStatus === b.syncStatus &&
    (a.confirmedVersion ?? 0) === (b.confirmedVersion ?? 0) &&
    (a.verificationFailureReason ?? '') === (b.verificationFailureReason ?? '') &&
    Boolean(a.saveConfirmedOnServer) === Boolean(b.saveConfirmedOnServer) &&
    (a.syncError ?? '') === (b.syncError ?? '') &&
    a.title === b.title &&
    a.promptText === b.promptText &&
    a.modelAnswer === b.modelAnswer &&
    (a.appliedConditionNote ?? '') === (b.appliedConditionNote ?? '') &&
    (a.mathFormula ?? '') === (b.mathFormula ?? '') &&
    (a.codeSnippet ?? '') === (b.codeSnippet ?? '') &&
    (a.timeStandardMinutes ?? 0) === (b.timeStandardMinutes ?? 0) &&
    getProblemEvaluationSignature(a) === getProblemEvaluationSignature(b)
  );
}

export function loadUnsavedProblemRevisions(): Record<string, UnsavedProblemRevision> {
  return safeGetItem<Record<string, UnsavedProblemRevision>>(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS, {});
}

export function getUnsavedProblemRevision(problemId: string): UnsavedProblemRevision | null {
  const all = loadUnsavedProblemRevisions();
  return all[problemId] || null;
}

export function saveUnsavedProblemRevision(
  revision: UnsavedProblemRevision,
  options?: { onlyIfRevisionId?: string; onlyIfGeneration?: number }
): boolean {
  const all = loadUnsavedProblemRevisions();
  const existing = all[revision.problemId];
  if (existing) {
    if (options?.onlyIfRevisionId && existing.revisionId !== options.onlyIfRevisionId) {
      return false;
    }
    if (options?.onlyIfGeneration !== undefined && existing.generation !== options.onlyIfGeneration) {
      return false;
    }
    // Prevent an older revision or stale failure from overwriting a newer generation
    if (
      revision.generation !== undefined &&
      existing.generation !== undefined &&
      revision.generation < existing.generation
    ) {
      return false;
    }
    // If different revisionId and existing is newer by timestamp or generation, do not overwrite
    if (
      revision.revisionId &&
      existing.revisionId &&
      revision.revisionId !== existing.revisionId &&
      (existing.generation ?? 0) >= (revision.generation ?? 0) &&
      new Date(existing.revisedAt).getTime() > new Date(revision.revisedAt).getTime()
    ) {
      return false;
    }
  }
  all[revision.problemId] = revision;
  const wrote = safeSetItem(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS, all);
  if (!wrote) return false;
  const readBack = getUnsavedProblemRevision(revision.problemId);
  if (!readBack || !revisionRecordMatches(readBack, revision)) {
    return false;
  }
  setInMemoryProblemRevision(revision);
  return true;
}

export function clearUnsavedProblemRevision(
  problemId: string,
  expected?: { revisionId?: string; generation?: number }
): boolean {
  const all = loadUnsavedProblemRevisions();
  const existing = all[problemId];
  if (!existing) return false;
  if (expected) {
    if (expected.revisionId && existing.revisionId && existing.revisionId !== expected.revisionId) {
      return false; // Newer or different revision present, do not delete!
    }
    if (expected.generation !== undefined && existing.generation !== undefined && existing.generation > expected.generation) {
      return false; // Newer generation present, do not delete!
    }
  }
  delete all[problemId];
  const wrote = safeSetItem(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS, all);
  if (!wrote) return false;
  if (getUnsavedProblemRevision(problemId) !== null) {
    return false;
  }
  clearInMemoryProblemRevision(problemId, expected);
  return true;
}

export function clearAllUnsavedProblemRevisions(): boolean {
  const wrote = safeSetItem(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS, {});
  if (!wrote) return false;
  const remaining = loadUnsavedProblemRevisions();
  if (Object.keys(remaining).length > 0) return false;
  const key = scopedStorageKey(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS);
  delete inMemoryRevisionFallback[key];
  return true;
}

/**
 * Reconciles local problem state and unsaved revision records after the server
 * confirms a problem revision at `confirmedVersion`.
 * - Explicitly separates server save success from local persistent storage (`localPersisted`).
 * - Protects newer in-flight consecutive edits (`generation` / `revisionId` guard) by
 *   advancing their `baseVersion` to `confirmedVersion` instead of overwriting or deleting them.
 * - Clears `localUnrecordedBaseVersion` and records `serverConfirmedVersion`.
 */
export type ConfirmProblemRevisionSyncStatus =
  | 'applied'
  | 'in_flight_advanced'
  | 'duplicate'
  | 'stale_ignored'
  | 'conflict';

export interface ConfirmProblemRevisionSyncOutcome {
  status: ConfirmProblemRevisionSyncStatus;
  reconciled: boolean;
  advancedInFlightRevision: boolean;
  localPersisted: boolean;
  revisionCleared: boolean;
  updatedProblems: Problem[];
  message: string;
}

/**
 * Resolves the authoritative server-confirmed version of a problem,
 * strictly distinguishing it from temporary local optimistic versions
 * and unconfirmed in-progress revisions.
 */
export function getAuthoritativeServerConfirmedVersion(
  problem?: Problem | null,
  unsaved?: UnsavedProblemRevision | null
): number | undefined {
  if (!problem) return undefined;
  if (typeof problem.serverConfirmedVersion === 'number') {
    return problem.serverConfirmedVersion;
  }
  const hasActiveUnsaved = Boolean(unsaved && unsaved.syncStatus !== 'synced');
  if (hasActiveUnsaved && typeof unsaved?.baseVersion === 'number') {
    return unsaved.baseVersion;
  }
  if (typeof problem.localUnrecordedBaseVersion === 'number') {
    return problem.localUnrecordedBaseVersion;
  }
  return problem.version ?? 1;
}

/**
 * Reconciles local problem state and unsaved revision records after the server
 * confirms a problem revision at `confirmedVersion`.
 * - Explicitly separates server save success from local persistent storage (`localPersisted`).
 * - Protects newer in-flight consecutive edits (`generation` / `revisionId` guard) by
 *   advancing their `baseVersion` to `confirmedVersion` instead of overwriting or deleting them.
 * - Guards against stale responses: ignores older responses (`confirmedVersion < existingConfirmedVersion`,
 *   stale generation, or mismatched scope/problem identity) to guarantee local body and confirmed version
 *   are never rolled back even after the active unsaved revision has been cleared.
 * - Idempotently handles duplicates (same version and content) and rejects mismatches as conflict.
 * - Clears `localUnrecordedBaseVersion` and records `serverConfirmedVersion`, `serverConfirmedRevisionId`,
 *   and `serverConfirmedGeneration`.
 */
export function confirmProblemRevisionSynced(
  problemId: string,
  serverProblem: Partial<Problem> & { version: number },
  expected?: {
    revisionId?: string;
    generation?: number;
    snapshotProblem?: Problem;
    editReason?: string;
    scopeId?: string;
    verificationStatus?: 'verified_current' | 'verified_snapshot_only' | 'verification_failed';
    contentVerified?: boolean;
  }
): ConfirmProblemRevisionSyncOutcome {
  // Defensive invariant: verification_failed / unverified results must NEVER mark a revision synced or clear protected edits.
  if (
    expected?.verificationStatus === 'verification_failed' ||
    expected?.contentVerified === false
  ) {
    const currentStored = loadStoredProblems();
    return {
      status: 'stale_ignored',
      reconciled: false,
      advancedInFlightRevision: false,
      localPersisted: true,
      revisionCleared: false,
      updatedProblems: currentStored,
      message: '서버 내용 검증에 실패한 결과는 동기화 완료로 처리할 수 없어 보호 수정본을 유지했습니다.',
    };
  }
  // 0. SCOPE & PROBLEM IDENTITY CHECK:
  if (expected?.scopeId && expected.scopeId !== getStorageScopeId()) {
    const currentStored = loadStoredProblems();
    return {
      status: 'stale_ignored',
      reconciled: false,
      advancedInFlightRevision: false,
      localPersisted: true,
      revisionCleared: false,
      updatedProblems: currentStored,
      message: '계정 범위가 변경되어 이전 계정의 서버 저장 응답을 무시했습니다.',
    };
  }
  if (
    (serverProblem.id && serverProblem.id !== problemId) ||
    (expected?.snapshotProblem?.id && expected.snapshotProblem.id !== problemId)
  ) {
    const currentStored = loadStoredProblems();
    return {
      status: 'stale_ignored',
      reconciled: false,
      advancedInFlightRevision: false,
      localPersisted: true,
      revisionCleared: false,
      updatedProblems: currentStored,
      message: '문제 식별정보가 일치하지 않는 응답을 무시했습니다.',
    };
  }

  const confirmedVersion = serverProblem.version;
  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const { latest: currentUnsaved } = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved);
  const targetRevisionId = expected?.revisionId;
  const targetGeneration = expected?.generation;

  const currentStored = loadStoredProblems();
  const baseList =
    currentStored.length > 0 ? currentStored : Object.values(getScopedLastKnownProblemsMap());
  const storedProb = baseList.find((p) => p.id === problemId);
  const memoryProb = getInMemoryProblem(problemId);
  const existingProblem = (() => {
    if (!memoryProb) return storedProb;
    if (!storedProb) return memoryProb;
    const memConfirmed = memoryProb.serverConfirmedVersion ?? 0;
    const storedConfirmed = storedProb.serverConfirmedVersion ?? 0;
    if (memConfirmed !== storedConfirmed) {
      return memConfirmed > storedConfirmed ? memoryProb : storedProb;
    }
    return (memoryProb.version ?? 0) >= (storedProb.version ?? 0) ? memoryProb : storedProb;
  })();

  const existingConfirmedVersion = getAuthoritativeServerConfirmedVersion(existingProblem, currentUnsaved);
  const effectiveCurrentProblems = (() => {
    if (!existingProblem) return currentStored;
    if (currentStored.length === 0) return [existingProblem];
    return currentStored.some((p) => p.id === problemId)
      ? currentStored.map((p) => (p.id === problemId ? existingProblem : p))
      : [...currentStored, existingProblem];
  })();

  // 1. STALE RESPONSE CHECK:
  // If the server response confirmed a version lower than our already-confirmed version,
  // or lower than our active pending revision's baseVersion,
  // ignore it completely so late responses cannot revert newer versions, bodies, or baseVersions.
  const isStaleByConfirmedVersion = Boolean(
    existingProblem && existingConfirmedVersion !== undefined && confirmedVersion < existingConfirmedVersion
  );
  const isStaleByPendingBaseVersion = Boolean(
    currentUnsaved && confirmedVersion < currentUnsaved.baseVersion
  );

  if (isStaleByConfirmedVersion || isStaleByPendingBaseVersion) {
    const authoritativeVer = Math.max(
      existingConfirmedVersion ?? 0,
      currentUnsaved?.baseVersion ?? 0
    );
    return {
      status: 'stale_ignored',
      reconciled: false,
      advancedInFlightRevision: false,
      localPersisted: true,
      revisionCleared: false,
      updatedProblems: effectiveCurrentProblems,
      message: `이미 최신 서버 확정 버전(v${authoritativeVer})이 존재하여 이전 응답(v${confirmedVersion})을 무시했습니다.`,
    };
  }

  // 2. SAME-VERSION CHECK (Duplicate vs Conflict):
  // If the response matches our existing confirmed version:
  if (existingProblem && existingConfirmedVersion !== undefined && confirmedVersion === existingConfirmedVersion) {
    const snapshotAtConfirmedVersion =
      existingProblem.version === confirmedVersion
        ? undefined
        : (Array.isArray(existingProblem.versionHistory)
          ? existingProblem.versionHistory.find((s) => s.version === confirmedVersion)
          : undefined) ??
        (currentUnsaved?.baseSnapshot?.version === confirmedVersion
          ? currentUnsaved.baseSnapshot
          : undefined);

    const referenceProblemForComparison: Problem = snapshotAtConfirmedVersion
      ? {
        ...existingProblem,
        ...snapshotAtConfirmedVersion,
        version: confirmedVersion,
      }
      : existingProblem;

    const isIdentical = isRevisionMatchingProblem(referenceProblemForComparison, serverProblem as Problem);
    if (isIdentical) {
      // Idempotent duplicate: identical content confirmed at the same version.
      // Clean up target revision ONLY if it corresponds to this confirmed revision
      // (never delete a newer pending revision whose baseVersion >= confirmedVersion).
      const isPersistedMatchingConfirmed = Boolean(
        persistedUnsaved &&
        (targetRevisionId
          ? persistedUnsaved.revisionId === targetRevisionId
          : persistedUnsaved.revisionVersion <= confirmedVersion &&
          persistedUnsaved.baseVersion < confirmedVersion)
      );
      let cleared = true;
      if (isPersistedMatchingConfirmed) {
        cleared = clearUnsavedProblemRevision(problemId, {
          revisionId: targetRevisionId ?? persistedUnsaved?.revisionId,
          generation: targetGeneration ?? persistedUnsaved?.generation,
        });
      }
      const isMemoryMatchingConfirmed = Boolean(
        memoryUnsaved &&
        (targetRevisionId
          ? memoryUnsaved.revisionId === targetRevisionId
          : memoryUnsaved.revisionVersion <= confirmedVersion &&
          memoryUnsaved.baseVersion < confirmedVersion)
      );
      if (isMemoryMatchingConfirmed) {
        clearInMemoryProblemRevision(problemId, {
          revisionId: targetRevisionId ?? memoryUnsaved?.revisionId,
          generation: targetGeneration ?? memoryUnsaved?.generation,
        });
      }
      return {
        status: 'duplicate',
        reconciled: true,
        advancedInFlightRevision: false,
        localPersisted: true,
        revisionCleared: cleared,
        updatedProblems: effectiveCurrentProblems,
        message: `문제 수정본(v${confirmedVersion})이 이미 동일한 내용으로 동기화되어 있습니다.`,
      };
    } else {
      // Content mismatch on the same version: DO NOT OVERWRITE! Mark conflict or preserve.
      if (currentUnsaved && (!targetRevisionId || currentUnsaved.revisionId === targetRevisionId)) {
        const conflictRev: UnsavedProblemRevision = {
          ...currentUnsaved,
          syncStatus: 'conflict',
          syncError: `동일 버전(v${confirmedVersion}) 내용 불일치: 서버에 다른 내용이 이미 저장되어 있습니다.`,
        };
        setInMemoryProblemRevision(conflictRev);
        saveUnsavedProblemRevision(conflictRev, {
          onlyIfRevisionId: targetRevisionId,
          onlyIfGeneration: targetGeneration,
        });
      }
      return {
        status: 'conflict',
        reconciled: false,
        advancedInFlightRevision: false,
        localPersisted: true,
        revisionCleared: false,
        updatedProblems: effectiveCurrentProblems,
        message: `동일한 서버 버전(v${confirmedVersion})에 다른 내용이 이미 존재하여 충돌로 보존되었습니다.`,
      };
    }
  }

  // 3. FRESH CONFIRMATION (confirmedVersion > existingConfirmedVersion or new problem)
  // Check if a newer consecutive edit occurred while this server request was in flight
  const isNewerConsecutiveEdit = Boolean(
    currentUnsaved &&
    ((targetRevisionId && currentUnsaved.revisionId !== targetRevisionId) ||
      (targetGeneration !== undefined && (currentUnsaved.generation ?? 0) > targetGeneration) ||
      (!targetRevisionId &&
        targetGeneration === undefined &&
        (currentUnsaved.baseVersion >= confirmedVersion ||
          currentUnsaved.revisionVersion > confirmedVersion)))
  );

  if (isNewerConsecutiveEdit && currentUnsaved) {
    const baseSource =
      serverProblem.promptText !== undefined
        ? (serverProblem as Problem)
        : (expected?.snapshotProblem ?? (serverProblem as Problem));
    const confirmedSnapshot: ProblemVersionSnapshot = {
      version: confirmedVersion,
      title: baseSource.title ?? currentUnsaved.title,
      promptText: baseSource.promptText ?? currentUnsaved.promptText,
      type: baseSource.type ?? currentUnsaved.type,
      conceptIds: [...(baseSource.conceptIds ?? currentUnsaved.conceptIds ?? [])],
      mathFormula: baseSource.mathFormula,
      codeSnippet: baseSource.codeSnippet,
      timeStandardMinutes: baseSource.timeStandardMinutes,
      appliedConditionNote: baseSource.appliedConditionNote,
      hints: [...(baseSource.hints ?? [])],
      modelAnswer: baseSource.modelAnswer ?? currentUnsaved.modelAnswer,
      rubric: [...(baseSource.rubric ?? currentUnsaved.rubric ?? [])],
      editedAt: new Date().toISOString(),
      editReason: expected?.editReason ?? '서버 동기화 완료 버전',
    };
    const nextBaseVersion = Math.max(currentUnsaved.baseVersion, confirmedVersion);
    const nextRevVer = Math.max(currentUnsaved.revisionVersion, nextBaseVersion + 1);
    const clearMatchingPriorVerification =
      currentUnsaved.pendingPriorVerification &&
      (!targetRevisionId || currentUnsaved.pendingPriorVerification.revisionId === targetRevisionId) &&
      currentUnsaved.pendingPriorVerification.confirmedVersion <= confirmedVersion;
    const updatedInFlightRev: UnsavedProblemRevision = {
      ...currentUnsaved,
      baseVersion: nextBaseVersion,
      revisionVersion: nextRevVer,
      baseSnapshot: confirmedSnapshot,
      pendingPriorVerification: clearMatchingPriorVerification
        ? undefined
        : currentUnsaved.pendingPriorVerification,
    };
    setInMemoryProblemRevision(updatedInFlightRev);

    // If persistent storage still has the older target revision (A), clear it first!
    if (persistedUnsaved && (!targetRevisionId || persistedUnsaved.revisionId === targetRevisionId)) {
      clearUnsavedProblemRevision(problemId, {
        revisionId: targetRevisionId,
        generation: targetGeneration,
      });
    }

    const revSaved = saveUnsavedProblemRevision(updatedInFlightRev, {
      onlyIfRevisionId: currentUnsaved.revisionId,
      onlyIfGeneration: currentUnsaved.generation,
    });

    const hasInBaseList = baseList.some((p) => p.id === problemId);
    const reconciledWithInFlight = hasInBaseList
      ? baseList.map((p) => {
        if (p.id !== problemId) return p;
        const effectiveProblem =
          memoryProb && (memoryProb.version ?? 0) >= (p.version ?? 0) ? memoryProb : p;
        const existingHist = effectiveProblem.versionHistory || p.versionHistory || [];
        const hasConfirmedSnap = existingHist.some((s) => s.version === confirmedVersion);
        const nextConfirmedGen = Math.max(
          targetGeneration ?? 0,
          effectiveProblem.serverConfirmedGeneration ?? 0
        );
        return {
          ...effectiveProblem,
          version: nextRevVer,
          serverConfirmedVersion: confirmedVersion,
          serverConfirmedRevisionId: targetRevisionId ?? effectiveProblem.serverConfirmedRevisionId,
          serverConfirmedGeneration: nextConfirmedGen > 0 ? nextConfirmedGen : undefined,
          localUnrecordedBaseVersion: undefined,
          reports: mergeProblemReportLists(effectiveProblem.reports, serverProblem.reports),
          versionHistory: hasConfirmedSnap ? existingHist : [confirmedSnapshot, ...existingHist],
        };
      })
      : [
        ...baseList,
        {
          ...(memoryProb ?? (serverProblem as Problem)),
          version: nextRevVer,
          serverConfirmedVersion: confirmedVersion,
          serverConfirmedRevisionId: targetRevisionId,
          serverConfirmedGeneration: targetGeneration,
          localUnrecordedBaseVersion: undefined,
          reports: mergeProblemReportLists(memoryProb?.reports, serverProblem.reports),
          versionHistory: [confirmedSnapshot],
        },
      ];
    const probSaved = saveStoredProblems(reconciledWithInFlight);
    const reconciledProb = reconciledWithInFlight.find((p) => p.id === problemId);
    if (reconciledProb) {
      setInMemoryProblem(reconciledProb);
    }
    const localPersisted = revSaved && probSaved;
    return {
      status: 'in_flight_advanced',
      reconciled: true,
      advancedInFlightRevision: true,
      localPersisted,
      revisionCleared: false,
      updatedProblems: probSaved ? loadStoredProblems() : reconciledWithInFlight,
      message: localPersisted
        ? '이전 수정본이 서버에 저장되었으며, 최신 로컬 편집 내용이 보존되었습니다.'
        : '이전 수정본이 서버에 저장되었고 최신 편집은 메모리에 보존되었으나, 브라우저 로컬 영속 저장소 갱신에는 실패했습니다.',
    };
  }

  // Normal completion of the active revision
  const hasInBaseList = baseList.some((p) => p.id === problemId);
  const reconciledProblems = hasInBaseList
    ? baseList.map((p) => {
      if (p.id !== problemId) return p;
      const combinedHistory = [
        ...(serverProblem.versionHistory ?? []),
        ...(p.versionHistory ?? []),
      ];
      const seenVersions = new Set<number>();
      const dedupedHistory: ProblemVersionSnapshot[] = [];
      for (const snap of combinedHistory) {
        if (
          snap &&
          typeof snap.version === 'number' &&
          snap.version < confirmedVersion &&
          !seenVersions.has(snap.version)
        ) {
          seenVersions.add(snap.version);
          dedupedHistory.push(snap);
        }
      }
      dedupedHistory.sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
      const nextConfirmedGen = Math.max(
        targetGeneration ?? 0,
        p.serverConfirmedGeneration ?? 0
      );

      return {
        ...p,
        ...serverProblem,
        version: confirmedVersion,
        serverConfirmedVersion: confirmedVersion,
        serverConfirmedRevisionId: targetRevisionId ?? p.serverConfirmedRevisionId,
        serverConfirmedGeneration: nextConfirmedGen > 0 ? nextConfirmedGen : undefined,
        localUnrecordedBaseVersion: undefined,
        reports: mergeProblemReportLists(p.reports, serverProblem.reports),
        versionHistory: dedupedHistory,
        reviewNotes: serverProblem.reviewNotes ?? p.reviewNotes,
      };
    })
    : [
      ...baseList,
      {
        ...(serverProblem as Problem),
        version: confirmedVersion,
        serverConfirmedVersion: confirmedVersion,
        serverConfirmedRevisionId: targetRevisionId,
        serverConfirmedGeneration: targetGeneration,
        localUnrecordedBaseVersion: undefined,
        reports: serverProblem.reports ?? [],
        versionHistory: (serverProblem.versionHistory ?? []).filter(
          (s) => s && typeof s.version === 'number' && s.version < confirmedVersion
        ),
        reviewNotes: serverProblem.reviewNotes,
      },
    ];
  const probSaved = saveStoredProblems(reconciledProblems);
  if (probSaved) {
    clearInMemoryProblem(problemId, {
      version: confirmedVersion,
      serverConfirmedVersion: confirmedVersion,
    });
  } else {
    const memProb = reconciledProblems.find((p) => p.id === problemId);
    if (memProb) setInMemoryProblem(memProb);
  }

  const hadTargetPersistedUnsaved = Boolean(
    persistedUnsaved && (!targetRevisionId || persistedUnsaved.revisionId === targetRevisionId)
  );

  let cleared = true;
  if (hadTargetPersistedUnsaved) {
    cleared = clearUnsavedProblemRevision(problemId, {
      revisionId: targetRevisionId,
      generation: targetGeneration,
    });
  }
  clearInMemoryProblemRevision(problemId, {
    revisionId: targetRevisionId,
    generation: targetGeneration,
  });

  const localPersisted = probSaved && (!hadTargetPersistedUnsaved || cleared);
  return {
    status: 'applied',
    reconciled: true,
    advancedInFlightRevision: false,
    localPersisted,
    revisionCleared: cleared,
    updatedProblems: probSaved ? loadStoredProblems() : reconciledProblems,
    message: !probSaved
      ? '서버에는 수정본이 저장되었으나 브라우저 로컬 영속 저장소 기록에는 실패했습니다. (메모리 상태만 유지됨)'
      : hadTargetPersistedUnsaved && !cleared
        ? '서버에는 저장되었으나 로컬 수정본 임시 기록 정리에 실패했습니다.'
        : '문제 수정본이 서버에 안전하게 저장되었습니다.',
  };
}

function isMatchingTargetRevision(
  currentUnsaved: UnsavedProblemRevision | null,
  targetRevisionId?: string,
  targetGeneration?: number
): currentUnsaved is UnsavedProblemRevision {
  if (!currentUnsaved) return false;
  if (targetRevisionId && currentUnsaved.revisionId && currentUnsaved.revisionId !== targetRevisionId) {
    return false;
  }
  if (
    targetGeneration !== undefined &&
    currentUnsaved.generation !== undefined &&
    currentUnsaved.generation > targetGeneration
  ) {
    return false;
  }
  return true;
}

/**
 * Records a pending post-save verification (Case A: read/network error or save_uncertain,
 * Case B: missing/incomplete snapshot) WITHOUT clearing the protected revision, WITHOUT
 * fabricating snapshots, and WITHOUT overwriting any newer in-flight edit B.
 */
export function recordProblemRevisionVerificationPending(
  problemId: string,
  params: {
    scopeId?: string;
    targetRevisionId?: string;
    targetGeneration?: number;
    confirmedVersion?: number;
    saveConfirmedOnServer: boolean;
    reason: ProblemRevisionVerificationFailureReason;
    errorMessage: string;
    serverSnapshot?: ProblemVersionSnapshot | null;
    serverLatestProblem?: Problem | null;
  }
): {
  updated: boolean;
  preservedNewerRevision: boolean;
  localPersisted: boolean;
  revision: UnsavedProblemRevision | null;
} {
  if (params.scopeId && params.scopeId !== getStorageScopeId()) {
    return { updated: false, preservedNewerRevision: false, localPersisted: true, revision: null };
  }
  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const { latest: currentUnsaved } = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved);

  if (!isMatchingTargetRevision(currentUnsaved, params.targetRevisionId, params.targetGeneration)) {
    // A newer revision B exists: preserve B completely untouched (never clobber or downgrade it).
    return {
      updated: false,
      preservedNewerRevision: Boolean(currentUnsaved),
      localPersisted: true,
      revision: currentUnsaved,
    };
  }

  // Never downgrade an already-confirmed content mismatch conflict to verification_pending
  // unless an explicit retry just discovered a read error (keep serverLatestSummary if present).
  const nextRevision: UnsavedProblemRevision = {
    ...currentUnsaved,
    syncStatus: 'verification_pending',
    confirmedVersion: params.confirmedVersion ?? currentUnsaved.confirmedVersion,
    saveConfirmedOnServer: params.saveConfirmedOnServer || Boolean(currentUnsaved.saveConfirmedOnServer),
    verificationFailureReason: params.reason,
    syncError: params.errorMessage,
    serverSnapshotSummary:
      params.serverSnapshot !== undefined
        ? (params.serverSnapshot ?? undefined)
        : currentUnsaved.serverSnapshotSummary,
    serverLatestSummary:
      params.serverLatestProblem !== undefined
        ? (params.serverLatestProblem ?? undefined)
        : currentUnsaved.serverLatestSummary,
  };

  setInMemoryProblemRevision(nextRevision);
  const wrote = saveUnsavedProblemRevision(nextRevision, {
    onlyIfRevisionId: params.targetRevisionId ?? currentUnsaved.revisionId,
    onlyIfGeneration: params.targetGeneration ?? currentUnsaved.generation,
  });
  return {
    updated: true,
    preservedNewerRevision: false,
    localPersisted: wrote,
    revision: nextRevision,
  };
}

/**
 * Records a content mismatch or version conflict (Case C) WITHOUT deleting the protected
 * local revision, WITHOUT marking it synced, and WITHOUT touching newer edit B.
 * Preserves actual fetched server content separately in `serverSnapshotSummary` /
 * `serverLatestSummary` for side-by-side diff inspection and explicit resolution.
 */
export function recordProblemRevisionMismatchConflict(
  problemId: string,
  params: {
    scopeId?: string;
    targetRevisionId?: string;
    targetGeneration?: number;
    confirmedVersion?: number;
    saveConfirmedOnServer?: boolean;
    errorMessage: string;
    serverSnapshot?: ProblemVersionSnapshot | null;
    serverLatestProblem?: Problem | null;
  }
): {
  updated: boolean;
  preservedNewerRevision: boolean;
  localPersisted: boolean;
  updatedProblems: Problem[];
  revision: UnsavedProblemRevision | null;
} {
  if (params.scopeId && params.scopeId !== getStorageScopeId()) {
    return {
      updated: false,
      preservedNewerRevision: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      revision: null,
    };
  }
  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const { latest: currentUnsaved } = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved);

  if (!isMatchingTargetRevision(currentUnsaved, params.targetRevisionId, params.targetGeneration)) {
    return {
      updated: false,
      preservedNewerRevision: Boolean(currentUnsaved),
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      revision: currentUnsaved,
    };
  }

  const nextRevision: UnsavedProblemRevision = {
    ...currentUnsaved,
    syncStatus: 'conflict',
    confirmedVersion: params.confirmedVersion ?? currentUnsaved.confirmedVersion,
    saveConfirmedOnServer: params.saveConfirmedOnServer ?? currentUnsaved.saveConfirmedOnServer,
    verificationFailureReason: 'content_mismatch',
    syncError: params.errorMessage,
    serverSnapshotSummary:
      params.serverSnapshot !== undefined
        ? (params.serverSnapshot ?? undefined)
        : currentUnsaved.serverSnapshotSummary,
    serverLatestSummary:
      params.serverLatestProblem !== undefined
        ? (params.serverLatestProblem ?? undefined)
        : currentUnsaved.serverLatestSummary,
  };

  setInMemoryProblemRevision(nextRevision);
  const wrote = saveUnsavedProblemRevision(nextRevision, {
    onlyIfRevisionId: params.targetRevisionId ?? currentUnsaved.revisionId,
    onlyIfGeneration: params.targetGeneration ?? currentUnsaved.generation,
  });

  return {
    updated: true,
    preservedNewerRevision: false,
    localPersisted: wrote,
    updatedProblems: loadStoredProblems(),
    revision: nextRevision,
  };
}

export type ResolveProblemRevisionConflictStatus =
  | 'complete'
  | 'body_save_failed'
  | 'body_verify_failed'
  | 'partial_cleanup_failed'
  | 'rebase_persist_failed'
  | 'invalid_server_base'
  | 'stale_revision_aborted'
  | 'scope_changed';

export interface ResolveProblemRevisionConflictResult {
  /**
   * True ONLY when `status === 'complete'`.
   * Callers MUST NOT treat failures (`body_save_failed`, `body_verify_failed`,
   * `invalid_server_base`, `stale_revision_aborted`, `scope_changed`) or partial
   * completions (`partial_cleanup_failed`, `rebase_persist_failed`) as full success.
   */
  ok: boolean;
  status: ResolveProblemRevisionConflictStatus;
  action: 'accept_server' | 'prepare_rebase_edit';
  bodyPersisted: boolean;
  bodyVerified: boolean;
  revisionPersisted: boolean;
  memorySaved: boolean;
  memoryOnly: boolean;
  revisionCleared: boolean;
  needsRetry: boolean;
  updatedProblems: Problem[];
  revision: UnsavedProblemRevision | null;
  message: string;
}

export function isConflictResolutionComplete(
  result: Pick<ResolveProblemRevisionConflictResult, 'ok' | 'status'> | null | undefined
): boolean {
  return Boolean(result && result.status === 'complete' && result.ok === true);
}

export function isConflictResolutionPartial(
  result: Pick<ResolveProblemRevisionConflictResult, 'status'> | null | undefined
): boolean {
  return Boolean(
    result &&
      (result.status === 'partial_cleanup_failed' || result.status === 'rebase_persist_failed')
  );
}

export function canOpenEditorAfterRebasePrepare(
  result:
    | Pick<ResolveProblemRevisionConflictResult, 'action' | 'status' | 'revision'>
    | null
    | undefined
): boolean {
  return Boolean(
    result &&
      result.action === 'prepare_rebase_edit' &&
      (result.status === 'complete' || result.status === 'rebase_persist_failed') &&
      result.revision !== null
  );
}

function isTargetOrMemoryRebaseRetryRevision(
  currentUnsaved: UnsavedProblemRevision | null,
  persistedUnsaved: UnsavedProblemRevision | null,
  memoryUnsaved: UnsavedProblemRevision | null,
  targetRevisionId?: string,
  targetGeneration?: number
): currentUnsaved is UnsavedProblemRevision {
  if (!currentUnsaved) return false;
  if (
    targetRevisionId &&
    currentUnsaved.revisionId &&
    currentUnsaved.revisionId !== targetRevisionId
  ) {
    return false;
  }
  if (
    targetRevisionId &&
    persistedUnsaved?.revisionId &&
    persistedUnsaved.revisionId !== targetRevisionId
  ) {
    return false;
  }
  if (
    targetRevisionId &&
    memoryUnsaved?.revisionId &&
    memoryUnsaved.revisionId !== targetRevisionId
  ) {
    return false;
  }
  if (targetGeneration !== undefined) {
    const currentGen = currentUnsaved.generation ?? 0;
    if (currentGen > targetGeneration) {
      // Allow retry when memoryUnsaved is the unpersisted rebase of the exact same persisted conflict revision
      const isMemoryOnlyRebaseOfTarget = Boolean(
        persistedUnsaved &&
          memoryUnsaved &&
          currentUnsaved === memoryUnsaved &&
          persistedUnsaved.revisionId &&
          persistedUnsaved.revisionId === memoryUnsaved.revisionId &&
          (!targetRevisionId || persistedUnsaved.revisionId === targetRevisionId) &&
          (persistedUnsaved.generation ?? 0) === targetGeneration &&
          persistedUnsaved.syncStatus === 'conflict' &&
          memoryUnsaved.syncStatus === 'pending' &&
          getProblemEvaluationSignature(memoryUnsaved) ===
            getProblemEvaluationSignature(persistedUnsaved)
      );
      if (!isMemoryOnlyRebaseOfTarget) {
        return false;
      }
    }
    if (persistedUnsaved && (persistedUnsaved.generation ?? 0) > targetGeneration) {
      return false;
    }
  }
  return true;
}

function extractValidatedServerBase(
  problemId: string,
  localCurrent: Problem | null | undefined,
  paramsServerProblem: Problem | null | undefined,
  currentUnsaved: UnsavedProblemRevision,
  persistedUnsaved: UnsavedProblemRevision | null
):
  | {
      ok: true;
      serverProblem: Problem;
      serverVersion: number;
      snapshot: ProblemVersionSnapshot;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!localCurrent || localCurrent.id !== problemId) {
    return {
      ok: false,
      message:
        '로컬 문제 원본을 찾을 수 없어 서버 기준의 문제·과목 소속을 검증할 수 없습니다.',
    };
  }

  const validateCandidateProblem = (
    candidate: Partial<Problem> & { version?: number }
  ):
    | { ok: true; problem: Problem; version: number; snapshot: ProblemVersionSnapshot }
    | { ok: false; message: string } => {
    if (candidate.id !== undefined && candidate.id !== problemId) {
      return {
        ok: false,
        message: '서버 기준 문제의 식별자(problemId)가 현재 문제와 일치하지 않습니다.',
      };
    }
    if (
      candidate.subjectId !== undefined &&
      localCurrent.subjectId &&
      candidate.subjectId !== localCurrent.subjectId
    ) {
      return {
        ok: false,
        message: '서버 기준 문제의 과목 소속(subjectId)이 현재 문제와 일치하지 않습니다.',
      };
    }
    const ver = candidate.version;
    if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 1) {
      return {
        ok: false,
        message: '서버 기준 문제의 확정 버전 정보가 유효하지 않습니다.',
      };
    }
    const snapCandidate = {
      ...candidate,
      version: ver,
    };
    if (!isCompleteProblemSnapshot(snapCandidate)) {
      return {
        ok: false,
        message:
          '서버 기준 문제·스냅샷의 필수 평가 필드(제목·지문·모범답안·루브릭 등)가 불완전하여 적용할 수 없습니다.',
      };
    }
    const mergedProblem: Problem = {
      ...localCurrent,
      ...snapCandidate,
      id: problemId,
      subjectId: localCurrent.subjectId,
      version: ver,
      serverConfirmedVersion: ver,
      rubric: (snapCandidate.rubric ?? []).map((r) => ({ ...r })),
      hints: [...(snapCandidate.hints ?? [])],
      conceptIds: [...(snapCandidate.conceptIds ?? [])],
    };
    const snapshot: ProblemVersionSnapshot = {
      version: ver,
      title: mergedProblem.title,
      promptText: mergedProblem.promptText,
      type: mergedProblem.type,
      conceptIds: [...mergedProblem.conceptIds],
      appliedConditionNote: mergedProblem.appliedConditionNote,
      mathFormula: mergedProblem.mathFormula,
      codeSnippet: mergedProblem.codeSnippet,
      timeStandardMinutes: mergedProblem.timeStandardMinutes,
      hints: [...mergedProblem.hints],
      modelAnswer: mergedProblem.modelAnswer,
      rubric: mergedProblem.rubric.map((r) => ({ ...r })),
      editedAt: mergedProblem.lastReviewedAt || new Date().toISOString(),
      editReason: mergedProblem.reviewNotes,
    };
    return { ok: true, problem: mergedProblem, version: ver, snapshot };
  };

  // If caller explicitly passed serverProblem, validate it strictly without falling back on error
  if (paramsServerProblem !== undefined && paramsServerProblem !== null) {
    if (typeof paramsServerProblem !== 'object') {
      return {
        ok: false,
        message: '제공된 서버 기준 문제 형식이 올바르지 않습니다.',
      };
    }
    if (!paramsServerProblem.id || paramsServerProblem.id !== problemId) {
      return {
        ok: false,
        message: '서버 기준 문제의 식별자(problemId)가 현재 문제와 일치하지 않습니다.',
      };
    }
    if (
      localCurrent.subjectId &&
      (!paramsServerProblem.subjectId || paramsServerProblem.subjectId !== localCurrent.subjectId)
    ) {
      return {
        ok: false,
        message: '서버 기준 문제의 과목 소속(subjectId)이 현재 문제와 일치하지 않습니다.',
      };
    }
    const validated = validateCandidateProblem(paramsServerProblem);
    if (!validated.ok) return validated;
    return {
      ok: true,
      serverProblem: validated.problem,
      serverVersion: validated.version,
      snapshot: validated.snapshot,
    };
  }

  const latestSummary =
    currentUnsaved.serverLatestSummary ?? persistedUnsaved?.serverLatestSummary ?? null;
  if (latestSummary) {
    if (latestSummary.id && latestSummary.id !== problemId) {
      return {
        ok: false,
        message: '저장된 서버 문제 요약의 식별자(problemId)가 현재 문제와 일치하지 않습니다.',
      };
    }
    if (
      latestSummary.subjectId &&
      localCurrent.subjectId &&
      latestSummary.subjectId !== localCurrent.subjectId
    ) {
      return {
        ok: false,
        message: '저장된 서버 문제 요약의 과목 소속(subjectId)이 현재 문제와 일치하지 않습니다.',
      };
    }
    const validatedLatest = validateCandidateProblem(latestSummary);
    if (validatedLatest.ok) {
      return {
        ok: true,
        serverProblem: validatedLatest.problem,
        serverVersion: validatedLatest.version,
        snapshot: validatedLatest.snapshot,
      };
    }
  }

  const snapshotSummary =
    currentUnsaved.serverSnapshotSummary ?? persistedUnsaved?.serverSnapshotSummary ?? null;
  if (snapshotSummary) {
    const snapWithMeta = snapshotSummary as ProblemVersionSnapshot & {
      id?: string;
      subjectId?: string;
    };
    if (snapWithMeta.id && snapWithMeta.id !== problemId) {
      return {
        ok: false,
        message: '서버 버전 스냅샷의 문제 식별자(problemId)가 현재 문제와 일치하지 않습니다.',
      };
    }
    if (
      snapWithMeta.subjectId &&
      localCurrent.subjectId &&
      snapWithMeta.subjectId !== localCurrent.subjectId
    ) {
      return {
        ok: false,
        message: '서버 버전 스냅샷의 과목 소속(subjectId)이 현재 문제와 일치하지 않습니다.',
      };
    }
    const validatedSnap = validateCandidateProblem(snapshotSummary);
    if (validatedSnap.ok) {
      return {
        ok: true,
        serverProblem: validatedSnap.problem,
        serverVersion: validatedSnap.version,
        snapshot: validatedSnap.snapshot,
      };
    }
    return validatedSnap;
  }

  // Also support retry when currentUnsaved is already an in-memory rebased revision with a verified baseSnapshot
  if (
    currentUnsaved.syncStatus === 'pending' &&
    persistedUnsaved?.syncStatus === 'conflict' &&
    currentUnsaved.baseSnapshot &&
    typeof currentUnsaved.baseVersion === 'number' &&
    currentUnsaved.baseVersion > persistedUnsaved.baseVersion
  ) {
    const validatedBaseSnap = validateCandidateProblem({
      ...currentUnsaved.baseSnapshot,
      version: currentUnsaved.baseVersion,
    });
    if (validatedBaseSnap.ok) {
      return {
        ok: true,
        serverProblem: validatedBaseSnap.problem,
        serverVersion: validatedBaseSnap.version,
        snapshot: validatedBaseSnap.snapshot,
      };
    }
  }

  return {
    ok: false,
    message:
      '검증 가능한 서버 확정 본문·스냅샷 정보가 없습니다. [저장 결과 다시 확인]으로 서버 내용을 먼저 확인해 주세요.',
  };
}

/**
 * Resolves a preserved conflict revision through explicit user choice:
 * - `'accept_server'`: Adopts actual server content into local problems (never modifying
 *   historical snapshots), verifies persistence via read-back (version, identity, evaluation fields),
 *   and only then clears the matching conflict revision. Distinguishes full completion, body save
 *   failure, read-back verification failure, and partial cleanup failure.
 * - `'prepare_rebase_edit'`: Validates the server base problem/snapshot completeness & ownership,
 *   reconciles `pendingPriorVerification`, and re-anchors the protected local revision onto the
 *   verified server version (`baseVersion = serverVersion`, `revisionVersion = serverVersion + 1`).
 *   Distinguishes persistent storage success from memory-only preservation (`rebase_persist_failed`).
 */
export function resolveProblemRevisionConflict(
  problemId: string,
  action: 'accept_server' | 'prepare_rebase_edit',
  params: {
    scopeId?: string;
    revisionId?: string;
    generation?: number;
    serverProblem?: Problem | null;
  }
): ResolveProblemRevisionConflictResult {
  if (params.scopeId && params.scopeId !== getStorageScopeId()) {
    return {
      ok: false,
      status: 'scope_changed',
      action,
      bodyPersisted: false,
      bodyVerified: false,
      revisionPersisted: false,
      memorySaved: false,
      memoryOnly: false,
      revisionCleared: false,
      needsRetry: false,
      updatedProblems: loadStoredProblems(),
      revision: null,
      message: '계정 범위가 변경되어 충돌 해결을 중단했습니다.',
    };
  }

  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const { latest: currentUnsaved } = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved);

  if (
    !isTargetOrMemoryRebaseRetryRevision(
      currentUnsaved,
      persistedUnsaved,
      memoryUnsaved,
      params.revisionId,
      params.generation
    )
  ) {
    return {
      ok: false,
      status: 'stale_revision_aborted',
      action,
      bodyPersisted: false,
      bodyVerified: false,
      revisionPersisted: Boolean(persistedUnsaved),
      memorySaved: Boolean(memoryUnsaved),
      memoryOnly: !persistedUnsaved && Boolean(memoryUnsaved),
      revisionCleared: false,
      needsRetry: false,
      updatedProblems: loadStoredProblems(),
      revision: currentUnsaved,
      message: '더 최신 편집 내용이 존재하여 이전 충돌 해결 요청을 적용하지 않았습니다.',
    };
  }

  const currentList = loadStoredProblems();
  const localCurrent =
    currentList.find((p) => p.id === problemId) ?? getInMemoryProblem(problemId);

  const validatedBase = extractValidatedServerBase(
    problemId,
    localCurrent,
    params.serverProblem,
    currentUnsaved,
    persistedUnsaved
  );

  if (!validatedBase.ok) {
    return {
      ok: false,
      status: 'invalid_server_base',
      action,
      bodyPersisted: false,
      bodyVerified: false,
      revisionPersisted: Boolean(persistedUnsaved),
      memorySaved: Boolean(memoryUnsaved),
      memoryOnly: !persistedUnsaved && Boolean(memoryUnsaved),
      revisionCleared: false,
      needsRetry: false,
      updatedProblems: currentList,
      revision: currentUnsaved,
      message: validatedBase.message,
    };
  }

  const {
    serverProblem: authoritativeSource,
    serverVersion: serverVer,
    snapshot: validatedBaseSnapshot,
  } = validatedBase;

  if (action === 'accept_server') {
    const cleanedHistory = (localCurrent!.versionHistory || [])
      .filter((s) => s && typeof s.version === 'number' && s.version < serverVer)
      .map((s) => ({
        ...s,
        conceptIds: Array.isArray(s.conceptIds) ? [...s.conceptIds] : [],
        hints: Array.isArray(s.hints) ? [...s.hints] : [],
        rubric: Array.isArray(s.rubric) ? s.rubric.map((r) => ({ ...r })) : [],
      }));

    const expectedServerProblem: Problem = {
      ...localCurrent!,
      ...authoritativeSource,
      id: problemId,
      subjectId: localCurrent!.subjectId,
      version: serverVer,
      serverConfirmedVersion: serverVer,
      localUnrecordedBaseVersion: undefined,
      reports: mergeProblemReportLists(localCurrent!.reports, authoritativeSource.reports),
      versionHistory: cleanedHistory,
    };

    const hasInCurrentList = currentList.some((p) => p.id === problemId);
    const updatedList = hasInCurrentList
      ? currentList.map((p) => (p.id === problemId ? expectedServerProblem : p))
      : [...currentList, expectedServerProblem];

    const problemsStorageKey = scopedStorageKey(STORAGE_KEYS.PROBLEMS);
    const storageAdapter = getLocalStorage();
    let writeSucceeded = false;
    if (storageAdapter) {
      try {
        storageAdapter.setItem(problemsStorageKey, JSON.stringify(updatedList));
        writeSucceeded = true;
      } catch (e) {
        console.error(`Failed to write localStorage key ${problemsStorageKey}`, e);
        writeSucceeded = false;
      }
    }

    if (!writeSucceeded) {
      return {
        ok: false,
        status: 'body_save_failed',
        action: 'accept_server',
        bodyPersisted: false,
        bodyVerified: false,
        revisionPersisted: Boolean(persistedUnsaved),
        memorySaved: Boolean(memoryUnsaved),
        memoryOnly: !persistedUnsaved && Boolean(memoryUnsaved),
        revisionCleared: false,
        needsRetry: true,
        updatedProblems: loadStoredProblems(),
        revision: currentUnsaved,
        message: `서버 확정 내용(v${serverVer})을 브라우저 영속 저장소에 기록하지 못했습니다. 기존 문제 본문과 내 보호 수정본은 그대로 유지되었으니 저장 공간을 확인한 뒤 다시 시도해 주세요.`,
      };
    }

    // Read-back verification of problem body, version, identity, and evaluation fields
    const reloadedProblems = loadStoredProblems();
    const reloadedTarget = reloadedProblems.find((p) => p.id === problemId);
    const isReadBackVerified = Boolean(
      reloadedTarget &&
        reloadedTarget.id === problemId &&
        reloadedTarget.subjectId === expectedServerProblem.subjectId &&
        reloadedTarget.version === serverVer &&
        reloadedTarget.serverConfirmedVersion === serverVer &&
        isCompleteProblemSnapshot(reloadedTarget) &&
        problemContentMatches(reloadedTarget, expectedServerProblem) &&
        snapshotEvaluationMatchesProblem(expectedServerProblem, reloadedTarget)
    );

    if (!isReadBackVerified) {
      // Restore last known problems snapshot if possible and keep protected revision intact
      recordLastKnownProblems(currentList);
      return {
        ok: false,
        status: 'body_verify_failed',
        action: 'accept_server',
        bodyPersisted: false,
        bodyVerified: false,
        revisionPersisted: Boolean(persistedUnsaved),
        memorySaved: Boolean(memoryUnsaved),
        memoryOnly: !persistedUnsaved && Boolean(memoryUnsaved),
        revisionCleared: false,
        needsRetry: true,
        updatedProblems: reloadedProblems,
        revision: currentUnsaved,
        message: `서버 확정 내용(v${serverVer}) 저장 후 재조회 검증에 실패하여 보호 수정본을 삭제하지 않고 유지했습니다. 다시 시도해 주세요.`,
      };
    }

    recordLastKnownProblems(reloadedProblems);

    // Re-check scope and target revision right before deleting the protected revision
    if (params.scopeId && params.scopeId !== getStorageScopeId()) {
      return {
        ok: false,
        status: 'scope_changed',
        action: 'accept_server',
        bodyPersisted: true,
        bodyVerified: true,
        revisionPersisted: Boolean(persistedUnsaved),
        memorySaved: Boolean(memoryUnsaved),
        memoryOnly: false,
        revisionCleared: false,
        needsRetry: false,
        updatedProblems: reloadedProblems,
        revision: null,
        message: '계정 범위가 변경되어 보호 수정본 정리를 중단했습니다.',
      };
    }

    const latestBeforeClear = resolveLatestProblemRevision(
      getUnsavedProblemRevision(problemId),
      getInMemoryProblemRevision(problemId)
    ).latest;
    if (
      latestBeforeClear &&
      !isMatchingTargetRevision(
        latestBeforeClear,
        currentUnsaved.revisionId,
        currentUnsaved.generation
      )
    ) {
      return {
        ok: false,
        status: 'stale_revision_aborted',
        action: 'accept_server',
        bodyPersisted: true,
        bodyVerified: true,
        revisionPersisted: Boolean(getUnsavedProblemRevision(problemId)),
        memorySaved: Boolean(getInMemoryProblemRevision(problemId)),
        memoryOnly: false,
        revisionCleared: false,
        needsRetry: false,
        updatedProblems: reloadedProblems,
        revision: latestBeforeClear,
        message: '중간에 생성된 더 최신 편집 내용을 보호하기 위해 수정본 삭제를 중단했습니다.',
      };
    }

    clearInMemoryProblem(problemId, { version: serverVer, serverConfirmedVersion: serverVer });

    const targetRevId = currentUnsaved.revisionId;
    const targetGen = currentUnsaved.generation;
    const persistedBeforeClear = getUnsavedProblemRevision(problemId);
    const hasTargetPersisted = Boolean(
      persistedBeforeClear &&
        (!targetRevId || persistedBeforeClear.revisionId === targetRevId) &&
        (targetGen === undefined || (persistedBeforeClear.generation ?? 0) <= targetGen)
    );

    let clearOk = true;
    if (hasTargetPersisted) {
      clearOk = clearUnsavedProblemRevision(problemId, {
        revisionId: targetRevId,
        generation: targetGen,
      });
    }
    const remainingPersisted = getUnsavedProblemRevision(problemId);
    const stillHasTargetPersisted = Boolean(
      remainingPersisted &&
        (!targetRevId || remainingPersisted.revisionId === targetRevId) &&
        (targetGen === undefined || (remainingPersisted.generation ?? 0) <= targetGen)
    );

    if (!clearOk || stillHasTargetPersisted) {
      const partialRev: UnsavedProblemRevision = {
        ...(remainingPersisted ?? currentUnsaved),
        serverLatestSummary:
          currentUnsaved.serverLatestSummary ?? authoritativeSource,
        serverSnapshotSummary:
          currentUnsaved.serverSnapshotSummary ?? validatedBaseSnapshot,
        syncError: `서버 확정 본문(v${serverVer})은 로컬에 반영·검증되었으나, 보호 수정본 임시 기록 정리에 실패했습니다(부분 완료). [보호 기록 정리 재시도]를 눌러 완료해 주세요.`,
      };
      setInMemoryProblemRevision(partialRev);
      return {
        ok: false,
        status: 'partial_cleanup_failed',
        action: 'accept_server',
        bodyPersisted: true,
        bodyVerified: true,
        revisionPersisted: true,
        memorySaved: true,
        memoryOnly: false,
        revisionCleared: false,
        needsRetry: true,
        updatedProblems: reloadedProblems,
        revision: partialRev,
        message: `서버 확정 본문(v${serverVer})은 로컬에 반영·검증되었으나 보호 수정본 기록 정리에 실패했습니다(부분 완료). 다시 시도하면 보호 기록만 안전하게 정리됩니다.`,
      };
    }

    clearInMemoryProblemRevision(problemId, {
      revisionId: targetRevId,
      generation: targetGen,
    });

    return {
      ok: true,
      status: 'complete',
      action: 'accept_server',
      bodyPersisted: true,
      bodyVerified: true,
      revisionPersisted: false,
      memorySaved: false,
      memoryOnly: false,
      revisionCleared: true,
      needsRetry: false,
      updatedProblems: reloadedProblems,
      revision: null,
      message: `서버 확정 내용(v${serverVer})을 채택하여 동기화했습니다.`,
    };
  }

  // 'prepare_rebase_edit': re-anchor local edits onto the verified server version for explicit review/save.
  const newBaseVer = serverVer;
  const newBaseSnapshot: ProblemVersionSnapshot = validatedBaseSnapshot;

  // Reconcile pendingPriorVerification against the verified server base:
  // Keep it ONLY if it is for this problem and its confirmedVersion is still > newBaseVer;
  // clear it when superseded (confirmedVersion <= newBaseVer).
  const existingPrior =
    currentUnsaved.pendingPriorVerification ?? persistedUnsaved?.pendingPriorVerification;
  const reconciledPriorVerification: UnsavedProblemRevisionPriorVerification | undefined =
    existingPrior &&
    typeof existingPrior.confirmedVersion === 'number' &&
    existingPrior.confirmedVersion > newBaseVer &&
    (!existingPrior.submittedProblem?.id || existingPrior.submittedProblem.id === problemId)
      ? existingPrior
      : undefined;

  const isRetryOfMemoryOnlyRebase = Boolean(
    persistedUnsaved &&
      memoryUnsaved &&
      currentUnsaved === memoryUnsaved &&
      persistedUnsaved.revisionId === memoryUnsaved.revisionId &&
      persistedUnsaved.syncStatus === 'conflict' &&
      memoryUnsaved.syncStatus === 'pending' &&
      getProblemEvaluationSignature(memoryUnsaved) ===
        getProblemEvaluationSignature(persistedUnsaved)
  );
  const nextGen = isRetryOfMemoryOnlyRebase
    ? Math.max((persistedUnsaved?.generation ?? 1) + 1, memoryUnsaved?.generation ?? 1)
    : (currentUnsaved.generation ?? 1) + 1;

  const rebasedRev: UnsavedProblemRevision = {
    ...currentUnsaved,
    generation: nextGen,
    baseVersion: newBaseVer,
    revisionVersion: newBaseVer + 1,
    baseSnapshot: newBaseSnapshot,
    pendingPriorVerification: reconciledPriorVerification,
    syncStatus: 'pending',
    syncError: undefined,
    verificationFailureReason: undefined,
    saveConfirmedOnServer: false,
    confirmedVersion: undefined,
    serverSnapshotSummary: undefined,
    serverLatestSummary: undefined,
  };

  const revSaved = saveUnsavedProblemRevision(rebasedRev, {
    onlyIfRevisionId: currentUnsaved.revisionId,
    onlyIfGeneration: persistedUnsaved?.generation,
  });
  const readBackRev = getUnsavedProblemRevision(problemId);
  const isRebasePersisted = Boolean(
    revSaved &&
      readBackRev &&
      revisionRecordMatches(readBackRev, rebasedRev) &&
      readBackRev.baseVersion === newBaseVer &&
      readBackRev.revisionVersion === newBaseVer + 1 &&
      readBackRev.syncStatus === 'pending' &&
      readBackRev.baseSnapshot &&
      isCompleteProblemSnapshot(readBackRev.baseSnapshot) &&
      getProblemEvaluationSignature(readBackRev) ===
        getProblemEvaluationSignature(rebasedRev) &&
      (reconciledPriorVerification
        ? readBackRev.pendingPriorVerification?.confirmedVersion ===
          reconciledPriorVerification.confirmedVersion
        : readBackRev.pendingPriorVerification === undefined)
  );

  if (!isRebasePersisted) {
    // Ensure any previously persisted protected revision in localStorage is preserved intact
    if (persistedUnsaved) {
      const currentPersistedNow = getUnsavedProblemRevision(problemId);
      if (!currentPersistedNow || !revisionRecordMatches(currentPersistedNow, persistedUnsaved)) {
        const all = loadUnsavedProblemRevisions();
        all[problemId] = persistedUnsaved;
        safeSetItem(STORAGE_KEYS.UNSAVED_PROBLEM_REVISIONS, all);
      }
    }

    const memoryOnlyRev: UnsavedProblemRevision = {
      ...rebasedRev,
      serverLatestSummary:
        currentUnsaved.serverLatestSummary ??
        persistedUnsaved?.serverLatestSummary ??
        authoritativeSource,
      serverSnapshotSummary:
        currentUnsaved.serverSnapshotSummary ??
        persistedUnsaved?.serverSnapshotSummary ??
        newBaseSnapshot,
      syncError: `서버 v${newBaseVer} 기준 재편집 상태가 메모리에만 임시 준비되었으며 브라우저 영속 저장에는 실패했습니다. 기존 영속 보호 수정본은 유지되었으며 [기준 갱신 영속 저장 재시도]를 눌러 저장할 수 있습니다.`,
    };
    setInMemoryProblemRevision(memoryOnlyRev, {
      onlyIfRevisionId: currentUnsaved.revisionId,
    });

    return {
      ok: false,
      status: 'rebase_persist_failed',
      action: 'prepare_rebase_edit',
      bodyPersisted: false,
      bodyVerified: true,
      revisionPersisted: false,
      memorySaved: true,
      memoryOnly: true,
      revisionCleared: false,
      needsRetry: true,
      updatedProblems: currentList,
      revision: memoryOnlyRev,
      message: `서버 v${newBaseVer} 기준 재편집 상태가 메모리에만 임시 보관되었으며 브라우저 영속 저장에는 실패했습니다(기준 갱신 미완료). 기존 영속 보호 수정본은 안전하게 유지되었으며 다시 시도할 수 있습니다.`,
    };
  }

  setInMemoryProblemRevision(rebasedRev, {
    onlyIfRevisionId: currentUnsaved.revisionId,
  });

  return {
    ok: true,
    status: 'complete',
    action: 'prepare_rebase_edit',
    bodyPersisted: false,
    bodyVerified: true,
    revisionPersisted: true,
    memorySaved: true,
    memoryOnly: false,
    revisionCleared: false,
    needsRetry: false,
    updatedProblems: currentList,
    revision: rebasedRev,
    message: `보호 수정본이 서버 v${newBaseVer} 기준으로 준비되었습니다. 편집기에서 확인 후 새 버전으로 저장할 수 있습니다.`,
  };
}

function mergeProblemReportLists(
  localReports: ProblemReport[] | undefined,
  serverReports: ProblemReport[] | undefined
): ProblemReport[] {
  const localArr = Array.isArray(localReports) ? localReports : [];
  const serverArr = Array.isArray(serverReports) ? serverReports : [];
  if (localArr.length === 0) return serverArr;
  if (serverArr.length === 0) return localArr;

  const statusRank = (s: ProblemReport['status'] | undefined): number => {
    if (s === 'resolved' || s === 'dismissed') return 3;
    if (s === 'under_review') return 2;
    return 1;
  };

  const mergedById = new Map<string, ProblemReport>();
  for (const rep of [...serverArr, ...localArr]) {
    if (!rep || !rep.id) continue;
    const prev = mergedById.get(rep.id);
    if (!prev) {
      mergedById.set(rep.id, rep);
    } else if (statusRank(rep.status) > statusRank(prev.status)) {
      mergedById.set(rep.id, rep);
    }
  }
  return Array.from(mergedById.values());
}

/**
 * Reconciles a server quality-update response into local problem storage without
 * ever reverting a newer local body/version or clobbering an active unsaved revision.
 */
export function reconcileProblemQualitySynced(
  problemId: string,
  serverProblem: Problem,
  options?: { scopeId?: string }
): { reconciled: boolean; localPersisted: boolean; updatedProblems: Problem[] } {
  if (options?.scopeId && options.scopeId !== getStorageScopeId()) {
    return {
      reconciled: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
    };
  }
  if (!serverProblem || (serverProblem.id && serverProblem.id !== problemId)) {
    return {
      reconciled: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
    };
  }

  const currentStored = loadStoredProblems();
  const baseList =
    currentStored.length > 0 ? currentStored : Object.values(getScopedLastKnownProblemsMap());
  const persistedUnsaved = getUnsavedProblemRevision(problemId);
  const memoryUnsaved = getInMemoryProblemRevision(problemId);
  const { latest: currentUnsaved } = resolveLatestProblemRevision(persistedUnsaved, memoryUnsaved);
  const memoryProb = getInMemoryProblem(problemId);

  const hasInBaseList = baseList.some((p) => p.id === problemId);
  if (!hasInBaseList && !memoryProb) {
    return {
      reconciled: false,
      localPersisted: true,
      updatedProblems: currentStored,
    };
  }

  const reconciledProblems = (hasInBaseList ? baseList : [memoryProb!]).map((p) => {
    if (p.id !== problemId) return p;
    const effectiveLocal =
      memoryProb && (memoryProb.version ?? 0) >= (p.version ?? 0) ? memoryProb : p;
    const localConfirmedVer =
      getAuthoritativeServerConfirmedVersion(effectiveLocal, currentUnsaved) ??
      (effectiveLocal.version ?? 1);
    const serverVer = serverProblem.version ?? 1;
    const mergedReports = mergeProblemReportLists(effectiveLocal.reports, serverProblem.reports);

    // Only adopt the server's body/version if there is NO active local unsaved revision
    // AND the server row has a strictly newer version than our local confirmed version.
    const canAdoptNewerServerBody = !currentUnsaved && serverVer > localConfirmedVer;

    if (canAdoptNewerServerBody) {
      return {
        ...effectiveLocal,
        ...serverProblem,
        version: serverVer,
        serverConfirmedVersion: serverVer,
        reports: mergedReports,
      };
    }

    // Otherwise, preserve local body, version, and unsaved state; merge quality fields only.
    return {
      ...effectiveLocal,
      qualityStatus: serverProblem.qualityStatus ?? effectiveLocal.qualityStatus,
      isOutdated:
        typeof serverProblem.isOutdated === 'boolean'
          ? serverProblem.isOutdated
          : effectiveLocal.isOutdated,
      needsSourceReview:
        typeof serverProblem.needsSourceReview === 'boolean'
          ? serverProblem.needsSourceReview
          : effectiveLocal.needsSourceReview,
      lastReviewedAt: serverProblem.lastReviewedAt ?? effectiveLocal.lastReviewedAt,
      reviewNotes: serverProblem.reviewNotes ?? effectiveLocal.reviewNotes,
      sourceMaterials: serverProblem.sourceMaterials ?? effectiveLocal.sourceMaterials,
      sourceContentVersion: serverProblem.sourceContentVersion ?? effectiveLocal.sourceContentVersion,
      sourceVerificationStatus:
        serverProblem.sourceVerificationStatus ?? effectiveLocal.sourceVerificationStatus,
      sourcePage: serverProblem.sourcePage ?? effectiveLocal.sourcePage,
      difficultyLevel: serverProblem.difficultyLevel ?? effectiveLocal.difficultyLevel,
      reports: mergedReports,
    };
  });

  const probSaved = saveStoredProblems(reconciledProblems);
  if (!probSaved) {
    const memProb = reconciledProblems.find((p) => p.id === problemId);
    if (memProb) setInMemoryProblem(memProb);
  }
  return {
    reconciled: true,
    localPersisted: probSaved,
    updatedProblems: probSaved ? loadStoredProblems() : reconciledProblems,
  };
}

export interface LocalProblemVersionInconsistency {
  problemId: string;
  rowVersion: number;
  snapshotVersion?: number;
  issueType:
  | 'CURRENT_SNAPSHOT_CONTENT_MISMATCH'
  | 'DUPLICATE_HISTORY_VERSION'
  | 'HISTORY_VERSION_GTE_CURRENT';
  details: string;
}

/**
 * Read-only diagnostic helper to detect version/snapshot inconsistencies in local or merged problems
 * without mutating any historical snapshots or problem records.
 */
export function detectLocalProblemVersionInconsistencies(
  problems: Problem[] = loadStoredProblems(),
  serverSnapshots: Record<string, ProblemVersionSnapshot[]> = {}
): LocalProblemVersionInconsistency[] {
  const issues: LocalProblemVersionInconsistency[] = [];
  for (const p of problems) {
    const ver = p.version ?? 1;
    const history = p.versionHistory || [];
    const seenVersions = new Set<number>();
    for (const snap of history) {
      if (seenVersions.has(snap.version)) {
        issues.push({
          problemId: p.id,
          rowVersion: ver,
          snapshotVersion: snap.version,
          issueType: 'DUPLICATE_HISTORY_VERSION',
          details: `문제 ${p.id}의 versionHistory에 v${snap.version} 스냅샷이 중복 존재합니다.`,
        });
      }
      seenVersions.add(snap.version);
      if (snap.version >= ver) {
        issues.push({
          problemId: p.id,
          rowVersion: ver,
          snapshotVersion: snap.version,
          issueType: 'HISTORY_VERSION_GTE_CURRENT',
          details: `문제 ${p.id}(현재 v${ver})의 과거 이력에 현재 버전 이상인 v${snap.version} 스냅샷이 포함되어 있습니다.`,
        });
      }
    }

    const remoteSnaps = serverSnapshots[p.id] || [];
    const matchingSnap = remoteSnaps.find((s) => s.version === ver);
    if (matchingSnap) {
      const snapSig = getProblemEvaluationSignature({
        type: matchingSnap.type ?? p.type,
        conceptIds: matchingSnap.conceptIds ?? p.conceptIds,
        title: matchingSnap.title,
        promptText: matchingSnap.promptText,
        appliedConditionNote: matchingSnap.appliedConditionNote,
        mathFormula: matchingSnap.mathFormula,
        codeSnippet: matchingSnap.codeSnippet,
        modelAnswer: matchingSnap.modelAnswer,
        hints: matchingSnap.hints || [],
        rubric: matchingSnap.rubric || [],
        timeStandardMinutes: matchingSnap.timeStandardMinutes ?? p.timeStandardMinutes,
        designIntent: p.designIntent,
      });
      const curSig = getProblemEvaluationSignature(p);
      if (snapSig !== curSig) {
        issues.push({
          problemId: p.id,
          rowVersion: ver,
          snapshotVersion: matchingSnap.version,
          issueType: 'CURRENT_SNAPSHOT_CONTENT_MISMATCH',
          details: `문제 ${p.id}(v${ver})의 현재 본문과 v${matchingSnap.version} 버전 스냅샷의 평가 필드가 불일치합니다.`,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Concept Schedule Adjustments (Bug 3)
// ---------------------------------------------------------------------------

export function loadConceptScheduleAdjustments(): Record<string, ConceptScheduleAdjustment> {
  return safeGetItem<Record<string, ConceptScheduleAdjustment>>(STORAGE_KEYS.CONCEPT_SCHEDULE_ADJUSTMENTS, {});
}

export function getConceptScheduleAdjustment(conceptId: string): ConceptScheduleAdjustment | null {
  const all = loadConceptScheduleAdjustments();
  return all[conceptId] || null;
}

export function saveConceptScheduleAdjustment(
  conceptId: string,
  postponeDays: number,
  postponedUntil?: string
): boolean {
  const all = loadConceptScheduleAdjustments();
  const nextRecord: ConceptScheduleAdjustment = {
    conceptId,
    postponeDays,
    postponedUntil,
    updatedAt: new Date().toISOString(),
  };
  all[conceptId] = nextRecord;
  const wrote = safeSetItem(STORAGE_KEYS.CONCEPT_SCHEDULE_ADJUSTMENTS, all);
  if (!wrote) return false;
  const verified = getConceptScheduleAdjustment(conceptId);
  return Boolean(
    verified &&
    verified.conceptId === conceptId &&
    verified.postponeDays === postponeDays &&
    (verified.postponedUntil ?? '') === (postponedUntil ?? '')
  );
}

export function clearConceptScheduleAdjustment(
  conceptId: string,
  options?: { onlyIfUpdatedBefore?: string }
): boolean {
  const all = loadConceptScheduleAdjustments();
  const existing = all[conceptId];
  if (!existing) return false;
  if (options?.onlyIfUpdatedBefore) {
    if (existing.updatedAt && new Date(existing.updatedAt).getTime() > new Date(options.onlyIfUpdatedBefore).getTime()) {
      return false; // A newer adjustment was set after this timestamp! Do not clear!
    }
  }
  delete all[conceptId];
  const wrote = safeSetItem(STORAGE_KEYS.CONCEPT_SCHEDULE_ADJUSTMENTS, all);
  if (!wrote) return false;
  return getConceptScheduleAdjustment(conceptId) === null;
}

export function clearAllConceptScheduleAdjustments(): boolean {
  return safeSetItem(STORAGE_KEYS.CONCEPT_SCHEDULE_ADJUSTMENTS, {});
}

