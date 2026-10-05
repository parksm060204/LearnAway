/**
 * Restore execution for material backups.
 *
 * Separated from the UI so the write path can be regression-tested. Contract:
 *  - File lookups distinguish found / missing / error; an ERROR never becomes a
 *    write and is reported as retryable.
 *  - State is re-checked immediately before each write (the plan is only a
 *    plan; anything that changed since it was built is not overwritten).
 *  - The storage scope is sampled at the start and before every write; an
 *    account change aborts the run instead of writing into another account.
 *  - Metadata is persisted through the caller-verified callback; a metadata
 *    save failure is never reported as a restored material.
 */

import type { Material } from './types';
import {
  base64ToBytes,
  planMaterialRestore,
  type MaterialBackupEntry,
  type RestoreConflict,
  type RestoreMissingFile,
  type RestorePlan,
  type RestoreExistingSnapshot,
} from './materialPolicy';
import { materialContentHash } from './cloud/hash';
import {
  hashBlob,
  type MaterialLoadResult,
  type MaterialSaveResult,
  type OriginalLoadResult,
  type OriginalSaveResult,
} from './materialStorage';

export interface MaterialRestoreIo {
  /** Current metadata list of the active scope. */
  getMaterials(): Material[];
  loadBodyResult(materialId: string): Promise<MaterialLoadResult>;
  loadOriginalResult(materialId: string): Promise<OriginalLoadResult>;
  saveBody(materialId: string, content: { markdown: string; rawText?: string; pages?: Material['pages'] }): Promise<MaterialSaveResult>;
  saveOriginal(materialId: string, blob: Blob, contentType: string, knownHash?: string): Promise<OriginalSaveResult>;
  /** Persists metadata additions; must return false when the write is unverified. */
  persistMetadata(materials: Material[]): Promise<boolean> | boolean;
  /** Active storage scope id, sampled to detect account changes. */
  getScopeId(): string;
  knownSubjectIds: string[];
  /** Explicit target subject per material id (user decision for unknown subjects). */
  subjectOverride?: Record<string, string>;
}

export interface MaterialRestoreOutcome {
  restored: string[];
  skippedExisting: string[];
  conflicts: RestoreConflict[];
  failed: Array<{ id: string; title: string; reason: string }>;
  missing: RestoreMissingFile[];
  metadataPersisted: boolean;
  aborted: boolean;
  plan: RestorePlan;
}

const ACCOUNT_SWITCH_MESSAGE = '계정이 변경되어 복원을 중단했습니다. 다시 로그인한 뒤 시도해 주세요.';

function bodyHashOf(content: { markdown?: string; rawText?: string; pages?: Material['pages'] }): string {
  return materialContentHash({
    markdown: typeof content.markdown === 'string' ? content.markdown : '',
    rawText: content.rawText,
    pages: content.pages,
  });
}

export async function executeMaterialRestore(
  entries: MaterialBackupEntry[],
  io: MaterialRestoreIo
): Promise<MaterialRestoreOutcome> {
  const scopeAtStart = io.getScopeId();
  const currentMetadata = io.getMaterials();

  const snapshots: RestoreExistingSnapshot[] = [];
  for (const entry of entries) {
    const id = entry.material.id;
    const metadata = currentMetadata.find((m) => m.id === id);
    const body = await io.loadBodyResult(id);
    const original = await io.loadOriginalResult(id);
    snapshots.push({
      id,
      metadataExists: Boolean(metadata),
      metadata,
      localBody: body.status,
      localBodyHash: body.status === 'found' ? bodyHashOf(body.content) : null,
      localOriginal: original.status,
      localOriginalHash: original.status === 'found' ? original.hash : null,
    });
  }

  const plan = planMaterialRestore(entries, snapshots, { knownSubjectIds: io.knownSubjectIds });

  const restored: string[] = [];
  const conflicts: RestoreConflict[] = [...plan.conflicts];
  const failed: Array<{ id: string; title: string; reason: string }> = [];
  const metadataToAdd: Material[] = [];
  let aborted = false;

  for (const id of plan.toRestore) {
    const entry = entries.find((e) => e.material.id === id);
    if (!entry) continue;
    const title = entry.material.title;

    if (aborted || io.getScopeId() !== scopeAtStart) {
      aborted = true;
      failed.push({ id, title, reason: ACCOUNT_SWITCH_MESSAGE });
      continue;
    }

    const overrideSubject = io.subjectOverride?.[id];
    const materialMeta: Material = overrideSubject
      ? { ...entry.material, subjectId: overrideSubject }
      : entry.material;
    const needsMetadata = plan.metadataToCreate.includes(id);
    let ok = true;

    if (entry.body) {
      // Re-check the current state right before writing.
      const current = await io.loadBodyResult(id);
      if (current.status === 'error') {
        failed.push({ id, title, reason: '기존 본문 상태를 확인하지 못했습니다. 다시 시도해 주세요.' });
        ok = false;
      } else if (current.status === 'found') {
        if (bodyHashOf(current.content) !== bodyHashOf(entry.body)) {
          conflicts.push({
            id,
            title,
            reason: '복원 중 같은 ID에 다른 본문이 나타나 덮어쓰지 않았습니다.',
          });
          ok = false;
        }
      } else {
        const saved = await io.saveBody(id, {
          markdown: entry.body.markdown,
          rawText: entry.body.rawText,
          pages: entry.body.pages,
        });
        if (!saved.persisted) {
          failed.push({ id, title, reason: `본문 저장 실패: ${saved.error}. 다시 시도해 주세요.` });
          ok = false;
        } else {
          const verify = await io.loadBodyResult(id);
          if (verify.status !== 'found' || bodyHashOf(verify.content) !== bodyHashOf(entry.body)) {
            failed.push({ id, title, reason: '본문 읽기 검증에 실패했습니다. 다시 시도해 주세요.' });
            ok = false;
          }
        }
      }
    }

    if (ok && entry.original) {
      if (aborted || io.getScopeId() !== scopeAtStart) {
        aborted = true;
        failed.push({ id, title, reason: ACCOUNT_SWITCH_MESSAGE });
        ok = false;
      } else {
        const current = await io.loadOriginalResult(id);
        if (current.status === 'error') {
          failed.push({ id, title, reason: '기존 원본 상태를 확인하지 못했습니다. 다시 시도해 주세요.' });
          ok = false;
        } else if (current.status === 'found') {
          if (current.hash !== entry.original.hash) {
            conflicts.push({
              id,
              title,
              reason: '복원 중 같은 ID에 다른 원본이 나타나 덮어쓰지 않았습니다.',
            });
            ok = false;
          }
        } else {
          let bytes: Uint8Array<ArrayBuffer> | null = null;
          try {
            bytes = base64ToBytes(entry.original.base64);
          } catch {
            failed.push({ id, title, reason: '원본 데이터를 해석하지 못했습니다. 다시 시도해 주세요.' });
            ok = false;
          }
          if (ok && bytes) {
            const blob = new Blob([bytes], { type: entry.original.contentType || 'application/pdf' });
            const actualHash = await hashBlob(blob);
            if (actualHash !== entry.original.hash) {
              failed.push({ id, title, reason: '원본 해시가 일치하지 않아 저장하지 않았습니다.' });
              ok = false;
            } else {
              const saved = await io.saveOriginal(id, blob, entry.original.contentType || 'application/pdf', entry.original.hash);
              if (!saved.persisted) {
                failed.push({ id, title, reason: `원본 저장 실패: ${saved.error}. 다시 시도해 주세요.` });
                ok = false;
              } else {
                const verify = await io.loadOriginalResult(id);
                if (verify.status !== 'found' || verify.hash !== entry.original.hash) {
                  failed.push({ id, title, reason: '원본 읽기 검증에 실패했습니다. 다시 시도해 주세요.' });
                  ok = false;
                }
              }
            }
          }
        }
      }
    }

    if (needsMetadata) metadataToAdd.push(materialMeta);
    if (ok) restored.push(id);
  }

  let metadataPersisted = true;
  if (metadataToAdd.length > 0) {
    if (aborted || io.getScopeId() !== scopeAtStart) {
      aborted = true;
      metadataPersisted = false;
      const unsaved = new Set(metadataToAdd.map((m) => m.id));
      for (const material of metadataToAdd) {
        failed.push({ id: material.id, title: material.title, reason: ACCOUNT_SWITCH_MESSAGE });
      }
      for (const id of Array.from(unsaved)) {
        const index = restored.indexOf(id);
        if (index >= 0) restored.splice(index, 1);
      }
    } else {
      metadataPersisted = (await io.persistMetadata(metadataToAdd)) !== false;
      if (!metadataPersisted) {
        const unsaved = new Set(metadataToAdd.map((m) => m.id));
        for (const material of metadataToAdd) {
          failed.push({
            id: material.id,
            title: material.title,
            reason: '자료 메타데이터 저장에 실패했습니다. 다시 시도해 주세요.',
          });
        }
        for (const id of Array.from(unsaved)) {
          const index = restored.indexOf(id);
          if (index >= 0) restored.splice(index, 1);
        }
      }
    }
  }

  return {
    restored,
    skippedExisting: plan.alreadyPresent,
    conflicts,
    failed,
    missing: plan.missingFiles,
    metadataPersisted,
    aborted,
    plan,
  };
}
