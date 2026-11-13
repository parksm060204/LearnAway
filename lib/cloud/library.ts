'use client';

import type { Material } from '../types';
import { rowToMaterial } from './mappers';
import { downloadMaterialContent, listMaterialRows } from './materialsRepository';
import { listSubjects } from './subjectsRepository';
import type { CloudLibrary, MaterialRow, RepoResult } from './types';
import { repoError, repoOk } from './types';

const DEFAULT_DOWNLOAD_CONCURRENCY = 3;

export interface LoadCloudLibraryDeps {
  listSubjects: typeof listSubjects;
  listMaterialRows: typeof listMaterialRows;
  downloadMaterialContent: typeof downloadMaterialContent;
  maxConcurrency?: number;
  isStale?: () => boolean;
}

/**
 * Loads the cloud library (subjects + materials with bodies) using bounded
 * concurrent downloads while preserving input order and error propagation.
 */
export async function loadCloudLibraryWithDeps(
  deps: LoadCloudLibraryDeps
): Promise<RepoResult<CloudLibrary>> {
  const subjects = await deps.listSubjects();
  if (!subjects.ok) return subjects;
  if (deps.isStale?.()) {
    return repoError('계정이 변경되어 자료 불러오기를 중단했습니다.');
  }

  const rows = await deps.listMaterialRows();
  if (!rows.ok) return rows;
  if (deps.isStale?.()) {
    return repoError('계정이 변경되어 자료 불러오기를 중단했습니다.');
  }

  const visibleRows = rows.data.filter((row) => row.upload_state !== 'deleting');
  const materials: Array<Material | undefined> = new Array(visibleRows.length);
  const originalPathByMaterialId: Record<string, string> = {};
  const readyIndices: number[] = [];

  for (let i = 0; i < visibleRows.length; i += 1) {
    const row = visibleRows[i];
    if (row.original_path) originalPathByMaterialId[row.id] = row.original_path;
    if (row.upload_state !== 'ready') {
      materials[i] = rowToMaterial(row);
    } else {
      readyIndices.push(i);
    }
  }

  if (readyIndices.length > 0) {
    const concurrency = Math.max(
      1,
      Math.min(deps.maxConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY, readyIndices.length)
    );
    let cursor = 0;
    let firstError: string | null = null;

    const worker = async () => {
      while (cursor < readyIndices.length && !firstError) {
        if (deps.isStale?.()) {
          firstError = '계정이 변경되어 자료 불러오기를 중단했습니다.';
          return;
        }
        const idx = readyIndices[cursor];
        cursor += 1;
        const row = visibleRows[idx];
        const content = await deps.downloadMaterialContent(row);
        if (deps.isStale?.()) {
          firstError = '계정이 변경되어 자료 불러오기를 중단했습니다.';
          return;
        }
        if (!content.ok) {
          if (!firstError) {
            firstError = `자료 본문을 불러오지 못했습니다. (${row.id}: ${content.error})`;
          }
          return;
        }
        materials[idx] = rowToMaterial(row, content.data);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (firstError) return repoError(firstError);
  }

  if (deps.isStale?.()) {
    return repoError('계정이 변경되어 자료 불러오기를 중단했습니다.');
  }

  return repoOk({
    subjects: subjects.data,
    materials: materials.filter((m): m is Material => Boolean(m)),
    originalPathByMaterialId,
  });
}

/**
 * Loads the cloud library (subjects + materials with bodies).
 *
 * Server data is authoritative: a failed read returns an error and never
 * silently falls back to an empty list or local data. Rows that are not yet
 * `ready` are returned as metadata only (their body is not available).
 */
export async function loadCloudLibrary(): Promise<RepoResult<CloudLibrary>> {
  return loadCloudLibraryWithDeps({
    listSubjects,
    listMaterialRows,
    downloadMaterialContent,
  });
}

export function materialRowsById(rows: MaterialRow[]): Map<string, MaterialRow> {
  return new Map(rows.map((row) => [row.id, row]));
}
