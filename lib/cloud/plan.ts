import type { Material, Subject } from '../types';
import { materialContentHash } from './hash';
import type { CloudMaterialContent } from './types';

export interface MigrationConflict {
  kind: 'subject' | 'material';
  id: string;
  reason: string;
}

export interface MigrationPlan {
  subjects: Subject[];
  materials: Material[];
  conflicts: MigrationConflict[];
  skippedSubjects: number;
  skippedMaterials: number;
}

/** Identity-relevant subject fields (ignores ownerId/timestamps/demo flags). */
export function subjectEquivalent(a: Subject, b: Subject): boolean {
  return (
    a.name === b.name &&
    (a.code ?? '') === (b.code ?? '') &&
    (a.examAt ?? null) === (b.examAt ?? null) &&
    (a.examEndTime ?? null) === (b.examEndTime ?? null) &&
    (a.location ?? null) === (b.location ?? null) &&
    (a.semester ?? null) === (b.semester ?? null) &&
    (a.scope ?? null) === (b.scope ?? null) &&
    (a.domain ?? null) === (b.domain ?? null) &&
    JSON.stringify(a.chapters ?? []) === JSON.stringify(b.chapters ?? [])
  );
}

/** Identity-relevant material metadata fields. */
export function materialMetadataEquivalent(a: Material, b: Material): boolean {
  return (
    a.subjectId === b.subjectId &&
    a.kind === b.kind &&
    a.title === b.title &&
    (a.sourceRefs ?? '') === (b.sourceRefs ?? '')
  );
}

/**
 * Decides what an explicit local->cloud migration must upload.
 *
 * Rules:
 *  - Only local subjects/materials that the caller already scoped to the
 *    current account are passed in.
 *  - A same-id record with identical content is skipped (idempotent).
 *  - A same-id record with different content is a conflict and is never
 *    overwritten automatically.
 *  - A material whose subject is neither in the cloud nor scheduled for upload
 *    is a conflict (dangling reference).
 */
export function planLocalMigration(input: {
  localSubjects: Subject[];
  localMaterials: Material[];
  cloudSubjects: Subject[];
  cloudMaterials: Material[];
  localContentHashes: Map<string, string>;
  cloudContentHashes: Map<string, string>;
  /** Upload lifecycle of cloud rows: non-'ready' rows are retried, not conflicts. */
  cloudMaterialUploadStates?: Map<string, 'uploading' | 'ready' | 'failed' | 'deleting'>;
}): MigrationPlan {
  const cloudSubjectById = new Map(input.cloudSubjects.map((s) => [s.id, s]));
  const cloudMaterialById = new Map(input.cloudMaterials.map((m) => [m.id, m]));
  const conflicts: MigrationConflict[] = [];

  const subjectsToUpload: Subject[] = [];
  let skippedSubjects = 0;
  for (const local of input.localSubjects) {
    const cloud = cloudSubjectById.get(local.id);
    if (!cloud) {
      subjectsToUpload.push(local);
    } else if (subjectEquivalent(local, cloud)) {
      skippedSubjects += 1;
    } else {
      conflicts.push({
        kind: 'subject',
        id: local.id,
        reason: '같은 ID의 과목이 서버에 다른 내용으로 존재합니다.',
      });
    }
  }

  const availableSubjectIds = new Set<string>([
    ...input.cloudSubjects.map((s) => s.id),
    ...subjectsToUpload.map((s) => s.id),
  ]);

  const materialsToUpload: Material[] = [];
  let skippedMaterials = 0;
  for (const local of input.localMaterials) {
    if (!availableSubjectIds.has(local.subjectId)) {
      conflicts.push({
        kind: 'material',
        id: local.id,
        reason: '연결된 과목이 서버에 없고 이전 대상에도 포함되지 않습니다.',
      });
      continue;
    }
    const cloud = cloudMaterialById.get(local.id);
    if (!cloud) {
      materialsToUpload.push(local);
      continue;
    }
    const uploadState = input.cloudMaterialUploadStates?.get(local.id);
    if (uploadState && uploadState !== 'ready') {
      // An interrupted upload of this same id is resumed, not a conflict.
      materialsToUpload.push(local);
      continue;
    }
    const localHash = input.localContentHashes.get(local.id) ?? materialContentHash({});
    const cloudHash = input.cloudContentHashes.get(local.id) ?? '';
    if (materialMetadataEquivalent(local, cloud) && localHash === cloudHash) {
      skippedMaterials += 1;
    } else {
      conflicts.push({
        kind: 'material',
        id: local.id,
        reason: '같은 ID의 자료가 서버에 다른 내용으로 존재합니다.',
      });
    }
  }

  return {
    subjects: subjectsToUpload,
    materials: materialsToUpload,
    conflicts,
    skippedSubjects,
    skippedMaterials,
  };
}

/** Convenience: hash helper so callers do not import hash.ts directly. */
export function hashContent(content: CloudMaterialContent): string {
  return materialContentHash(content);
}
