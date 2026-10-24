import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../lib/auth/apiAuth';
import { isServerAdminUser } from '../../../../lib/auth/adminAuth';
import {
  queryAiUsageTelemetryFromDb,
  type TelemetryFilter,
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
    const model = searchParams.get('model') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '50', 10) || 50));

    const requestedUserId = searchParams.get('userId')?.trim();
    const isAdmin = isServerAdminUser(auth.user);

    let effectiveUserId: string | undefined;

    if (!isAdmin) {
      // General user: strictly forbid querying other users or all metrics
      if (requestedUserId && requestedUserId !== auth.user.id) {
        return NextResponse.json(
          {
            success: false,
            error: '관리자 권한이 필요합니다.',
            errorCode: 'FORBIDDEN',
          },
          { status: 403 }
        );
      }
      effectiveUserId = auth.user.id;
    } else {
      // Verified server admin: can query specific user or all users
      if (requestedUserId && requestedUserId !== 'all') {
        effectiveUserId = requestedUserId;
      } else {
        effectiveUserId = undefined;
      }
    }

    const filter: TelemetryFilter = {
      userId: effectiveUserId,
      taskType,
      creditSource,
      model,
      startDate,
      endDate,
    };

    const result = await queryAiUsageTelemetryFromDb(filter, limit);

    return NextResponse.json({
      success: true,
      filter,
      summary: result.summary,
      recentRecords: result.records,
      fromDb: result.fromDb,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'AI 계측 지표 조회 중 오류가 발생했습니다.',
        errorCode: 'QUERY_FAILED',
      },
      { status: 500 }
    );
  }
}

