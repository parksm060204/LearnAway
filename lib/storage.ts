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
  ProblemType,
  RubricCriterion,
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
  getConceptStatusFromScore,
} from './retentionModel';
import { addDaysToDate } from './dateUtils';
import { computeMarkdownHash } from './markdownUtils';
import { completeRechallengeReservation } from './logicSession';
import {
  isMaterialBodyPersisted,
  loadMaterialContentInScope,
  saveMaterialContentInScope,
  unmarkMaterialBodyPersistedInScope,
} from './materialStorage';
import { materialContentHash } from './cloud/hash';
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
} as const;

const MOCK_EXAM_KEY = 'mock_exam_sessions_v1';
const LOGIC_SESSIONS_KEY = 'logic_sessions_v1';
const REC_HALLENGE_KEY = 'rechallenge_reservations_v1';

const inMemoryStore: Record<string, string> = {};

function safeGetItem<T>(baseKey: string, fallback: T): T {
  const key = scopedStorageKey(baseKey);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } else {
      const raw = inMemoryStore[key];
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.warn(`Failed to parse localStorage key ${key}`, e);
    return fallback;
  }
}

function safeSetItem<T>(baseKey: string, val: T): void {
  const key = scopedStorageKey(baseKey);
  try {
    const serialized = JSON.stringify(val);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, serialized);
    } else {
      inMemoryStore[key] = serialized;
    }
  } catch (e) {
    console.error(`Failed to write localStorage key ${key}`, e);
  }
}

function safeRemoveItem(baseKey: string): void {
  const key = scopedStorageKey(baseKey);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(key);
    } else {
      delete inMemoryStore[key];
    }
  } catch (e) {
    console.error(`Failed to remove localStorage key ${key}`, e);
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
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: true, failedKeys: [] };
  }

  const failedKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const baseKey = baseKeyForActiveScope(key);
      if (baseKey === null) continue;
      const raw = localStorage.getItem(key);
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
  // A deleted material is no longer local-only.
  clearLocalOnlyMaterialMarker(materialId);
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

function isLocalOnlyMaterial(materialId: string): boolean {
  return readLocalOnlyMaterialMarkers()[materialId] !== undefined;
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
  hash: string;
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
  if (!record || !storedHashIdentityMatches(record, identity)) return undefined;
  return record.hash;
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

export function saveStoredMaterials(materials: Material[]): void {
  persistMaterialsMetadata(materials, false);
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
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(key);
    }
    return inMemoryStore[key] ?? null;
  } catch {
    return null;
  }
}

function safeSetItemRaw(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, value);
    } else {
      inMemoryStore[key] = value;
    }
  } catch (e) {
    console.error(`Failed to write localStorage key ${key}`, e);
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

export function saveStoredConcepts(concepts: Concept[]): void {
  safeSetItem(STORAGE_KEYS.CONCEPTS, concepts);
}

export function loadStoredConceptDrafts(): ConceptDraft[] {
  return safeGetItem<ConceptDraft[]>(STORAGE_KEYS.CONCEPT_DRAFTS, []);
}

export function saveStoredConceptDrafts(drafts: ConceptDraft[]): void {
  safeSetItem(STORAGE_KEYS.CONCEPT_DRAFTS, drafts);
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

export function loadStoredProblems(): Problem[] {
  const raw = safeGetItem<Problem[]>(STORAGE_KEYS.PROBLEMS, []);
  // Legacy migration: recover transfer linkage ONLY when the original draft can
  // still be resolved by draftId. Never infer a source/session.
  const drafts = loadStoredProblemDrafts();
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  return raw.map((p) => {
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
}

export function saveStoredProblems(problems: Problem[]): void {
  safeSetItem(STORAGE_KEYS.PROBLEMS, problems);
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
/**
 * Canonical evaluation-affecting content representation shared between
 * version bump detection in `buildProblemFromDraft` and persistence verification in `problemContentMatches`.
 * Covers:
 * - 문제 유형 (type)
 * - 개념 범위 (conceptIds)
 * - 제목 (title)
 * - 지문 (promptText)
 * - 적용 조건 (appliedConditionNote)
 * - 수식 (mathFormula)
 * - 코드 (codeSnippet)
 * - 모범답안 (modelAnswer)
 * - 힌트 (hints)
 * - 루브릭 (rubric)
 * - 기준 시간 (timeStandardMinutes)
 * - 출제 의도 (designIntent)
 */
export function getProblemEvaluationSignature(p: {
  type: ProblemType;
  conceptIds: string[];
  title: string;
  promptText: string;
  appliedConditionNote?: string;
  mathFormula?: string;
  codeSnippet?: string;
  modelAnswer: string;
  hints: string[];
  rubric: RubricCriterion[];
  timeStandardMinutes: number;
  designIntent?: string;
}): string {
  const sortedConcepts = [...(p.conceptIds || [])].sort();
  const normalizedRubric = (p.rubric || []).map((r) => ({
    id: r.id,
    label: r.label,
    maxScore: r.maxScore,
    weight: r.weight,
    description: r.description,
  }));
  return JSON.stringify([
    p.type,
    sortedConcepts,
    p.title,
    p.promptText,
    p.appliedConditionNote || '',
    p.mathFormula || '',
    p.codeSnippet || '',
    p.modelAnswer,
    p.hints || [],
    normalizedRubric,
    p.timeStandardMinutes,
    p.designIntent || '',
  ]);
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

/**
 * Compares the evaluation-affecting content, transfer linkage, version and metadata
 * of two problems so that a failed save of a CHANGED re-approval is never mistaken
 * for success just because an older problem with the same id/draftId is still stored.
 */
export function problemContentMatches(a: Problem, b: Problem): boolean {
  if (a.version !== b.version) return false;
  if (getProblemEvaluationSignature(a) !== getProblemEvaluationSignature(b)) {
    return false;
  }
  // Transition / transfer connection info verification
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
  // Required metadata verification
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
export function editAndReviseProblem(
  problemId: string,
  updates: Partial<Problem>,
  editReason: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  const trimmedReason = editReason.trim();
  if (!trimmedReason) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '수정 사유 및 변경 내용을 입력해 주세요.' };
  }

  const currentVersion = target.version || 1;
  const snapshot: ProblemVersionSnapshot = {
    version: currentVersion,
    title: target.title,
    promptText: target.promptText,
    mathFormula: target.mathFormula,
    codeSnippet: target.codeSnippet,
    timeStandardMinutes: target.timeStandardMinutes,
    hints: [...target.hints],
    modelAnswer: target.modelAnswer,
    rubric: [...target.rubric],
    editedAt: new Date().toISOString(),
    editReason: trimmedReason,
  };

  const nextVersion = currentVersion + 1;
  const now = new Date().toISOString();

  const updatedProblem: Problem = {
    ...target,
    ...updates,
    version: nextVersion,
    versionHistory: [snapshot, ...(target.versionHistory || [])],
    qualityStatus: 'review_after_edit',
    lastReviewedAt: now,
    reviewNotes: `v${nextVersion} 수정 완료: ${trimmedReason}`,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
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

  const updatedProblem: Problem = {
    ...target,
    reports: updatedReports,
    qualityStatus: 'reapproved',
    sourceMaterials: refreshedSourceMaterials,
    // Explicit user re-approval clears the outdated/review flags so the problem
    // is not permanently excluded from circulation.
    isOutdated: false,
    needsSourceReview: false,
    lastReviewedAt: now,
    reviewNotes: reapprovalNote || '품질 검증 통과 및 재승인 완료 (출제 가능 복귀)',
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
  if (typeof window === 'undefined') return;
  safeRemoveItem(STORAGE_KEYS.CURRENT_SUBJECT_ID);
  safeRemoveItem(STORAGE_KEYS.SUBJECTS);
  safeRemoveItem(STORAGE_KEYS.MATERIALS);
  safeRemoveItem(MATERIAL_BODY_HASHES_KEY);
  safeRemoveItem(DELETED_MATERIAL_IDS_KEY);
  safeRemoveItem(LOCAL_ONLY_MATERIAL_IDS_KEY);
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

  // 2. Persist the Concept ReviewEvent.
  const updatedConcepts = currentConcepts.map((c) => {
    // Only update the primary concept connected to this attempt
    if (c.id !== effectiveAttempt.conceptId || c.subjectId !== effectiveAttempt.subjectId) return c;
    // Never append a duplicate event for the same Attempt.
    if (alreadyEventStored) return c;

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
  return { updatedConcepts, postponedConcept };
}

export function getAttemptById(attemptId: string): Attempt | null {
  const attempts = loadStoredAttempts();
  return attempts.find((a) => a.id === attemptId) || null;
}

