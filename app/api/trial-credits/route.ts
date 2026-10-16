import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { getTrialCreditStatus } from '@/lib/trialCredits';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const status = await getTrialCreditStatus(auth.user.id);
    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '체험 크레딧 조회 실패',
      },
      { status: 500 }
    );
  }
}
