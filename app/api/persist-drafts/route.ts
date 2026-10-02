import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import { upsertConceptDrafts, upsertProblemDrafts } from '@/lib/cloud/learningRepository';
import type { ConceptDraft, ProblemDraft } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Persists already-generated drafts without calling the paid AI again.
 * Used to retry a failed persistence (idempotent by draft id / job id).
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!record) {
    return NextResponse.json({ success: false, error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
  }
  const kind = record.kind === 'problem' ? 'problem' : record.kind === 'concept' ? 'concept' : null;
  if (!kind) {
    return NextResponse.json({ success: false, error: "kind는 'concept' 또는 'problem'이어야 합니다." }, { status: 400 });
  }
  const jobId = typeof record.generationJobId === 'string' ? record.generationJobId : undefined;
  const drafts = Array.isArray(record.drafts) ? record.drafts : [];
  if (drafts.length === 0) {
    return NextResponse.json({ success: true, persisted: true, drafts: [], count: 0 });
  }

  try {
    const supabase = await createClient();
    const result =
      kind === 'concept'
        ? await upsertConceptDrafts(supabase, drafts as ConceptDraft[], jobId)
        : await upsertProblemDrafts(supabase, drafts as ProblemDraft[], jobId);
    if (!result.ok) {
      return NextResponse.json({ success: false, persisted: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      persisted: true,
      drafts: result.data,
      count: result.data.length,
      generationJobId: jobId ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, persisted: false, error: error instanceof Error ? error.message : '초안 저장에 실패했습니다.' },
      { status: 500 }
    );
  }
}
