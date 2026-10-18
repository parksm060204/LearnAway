import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../lib/auth/apiAuth';
import {
  getAiUsageSummary,
  getInMemoryTelemetryRecords,
  type TelemetryFilter,
  type AiUsageTelemetryRecord,
} from '../../../../lib/aiCostTelemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskType = searchParams.get('taskType') || undefined;
    const creditSource = (searchParams.get('creditSource') as 'operator_trial' | 'personal_key') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Normal user queries are scoped to their own userId; operators can pass userId
    const requestedUserId = searchParams.get('userId');
    const effectiveUserId = requestedUserId || auth.user.id;

    const filter: TelemetryFilter = {
      userId: effectiveUserId,
      taskType,
      creditSource,
      startDate,
      endDate,
    };

    const summary = getAiUsageSummary(filter);
    const inMemory = getInMemoryTelemetryRecords()
      .filter((r: AiUsageTelemetryRecord) => !effectiveUserId || r.userId === effectiveUserId)
      .slice(-50)
      .reverse();

    return NextResponse.json({
      success: true,
      filter,
      summary,
      recentRecords: inMemory,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'AI 계측 지표 조회 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
