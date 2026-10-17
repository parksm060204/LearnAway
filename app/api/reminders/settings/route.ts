import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import {
  NotificationChannel,
  NotificationSubscription,
  rowToSubscription,
  subscriptionToRow,
  rowToDeliveryLog,
} from '@/lib/reviewNotifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const supabase = await createClient();
    const { data: subRow, error } = await supabase
      .from('review_notification_subscriptions')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const subscription = subRow ? rowToSubscription(subRow) : null;

    const { data: logRows } = await supabase
      .from('review_notification_logs')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentLogs = Array.isArray(logRows)
      ? logRows.map(rowToDeliveryLog).filter(Boolean)
      : [];

    return NextResponse.json({
      success: true,
      subscription,
      recentLogs,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: '올바른 JSON 요청이어야 합니다.' },
        { status: 400 }
      );
    }

    const payload = body as Partial<NotificationSubscription>;
    const channel: NotificationChannel = payload.channel === 'web_push' ? 'web_push' : 'email';
    const target = typeof payload.target === 'string' ? payload.target.trim() : '';
    const preferredHour = typeof payload.preferredHourKst === 'number'
      ? Math.max(0, Math.min(23, Math.floor(payload.preferredHourKst)))
      : 9;
    const isActive = Boolean(payload.isActive);

    if (isActive && !target) {
      return NextResponse.json(
        { success: false, error: '알림을 수신할 이메일 주소 또는 푸시 엔드포인트가 필요합니다.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const insertRow = subscriptionToRow({
      userId: auth.user.id,
      channel,
      target,
      preferredHourKst: preferredHour,
      isActive,
      consentedAt: new Date().toISOString(),
    });

    const { data, error } = await supabase
      .from('review_notification_subscriptions')
      .upsert(insertRow, { onConflict: 'user_id,channel' })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const mapped = rowToSubscription(data);

    return NextResponse.json({
      success: true,
      subscription: mapped,
      message: isActive ? '알림 수신 설정이 등록되었습니다.' : '알림 수신이 해제되었습니다.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
