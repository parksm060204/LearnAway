'use client';

import { createClient } from '../supabase/client';
import type { Subject } from '../types';
import { rowToSubject, subjectToUpsert } from './mappers';
import type { RepoResult, SubjectRow } from './types';
import { repoError, repoOk } from './types';

function toMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export async function listSubjects(): Promise<RepoResult<Subject[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk((data as SubjectRow[]).map(rowToSubject));
  } catch (error) {
    return repoError(toMessage(error, '과목을 불러오지 못했습니다.'));
  }
}

/**
 * Idempotent create/update keyed by the subject id. The existing local id is
 * preserved so concepts/problems references stay valid. user_id is never sent:
 * the column default (auth.uid()) and RLS own it.
 */
export async function upsertSubject(subject: Subject): Promise<RepoResult<Subject>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('subjects')
      .upsert(subjectToUpsert(subject), { onConflict: 'id,user_id' })
      .select('*')
      .single();
    if (error) return repoError(error.message);
    return repoOk(rowToSubject(data as SubjectRow));
  } catch (error) {
    return repoError(toMessage(error, '과목을 저장하지 못했습니다.'));
  }
}

export async function deleteSubject(id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const supabase = createClient();
    const { error } = await supabase.from('subjects').delete().eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(toMessage(error, '과목을 삭제하지 못했습니다.'));
  }
}
