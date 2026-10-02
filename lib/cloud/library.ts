'use client';

import type { Material } from '../types';
import { rowToMaterial } from './mappers';
import { downloadMaterialContent, listMaterialRows } from './materialsRepository';
import { listSubjects } from './subjectsRepository';
import type { CloudLibrary, MaterialRow, RepoResult } from './types';
import { repoError, repoOk } from './types';

/**
 * Loads the cloud library (subjects + materials with bodies).
 *
 * Server data is authoritative: a failed read returns an error and never
 * silently falls back to an empty list or local data. Rows that are not yet
 * `ready` are returned as metadata only (their body is not available).
 */
export async function loadCloudLibrary(): Promise<RepoResult<CloudLibrary>> {
  const subjects = await listSubjects();
  if (!subjects.ok) return subjects;

  const rows = await listMaterialRows();
  if (!rows.ok) return rows;

  const materials: Material[] = [];
  const originalPathByMaterialId: Record<string, string> = {};
  for (const row of rows.data) {
    if (row.original_path) originalPathByMaterialId[row.id] = row.original_path;
    if (row.upload_state !== 'ready') {
      materials.push(rowToMaterial(row));
      continue;
    }
    const content = await downloadMaterialContent(row);
    if (!content.ok) {
      return repoError(`자료 본문을 불러오지 못했습니다. (${row.id}: ${content.error})`);
    }
    materials.push(rowToMaterial(row, content.data));
  }

  return repoOk({ subjects: subjects.data, materials, originalPathByMaterialId });
}

export function materialRowsById(rows: MaterialRow[]): Map<string, MaterialRow> {
  return new Map(rows.map((row) => [row.id, row]));
}
