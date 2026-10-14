import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import { NotificationChannel, NotificationSubscription } from '@/lib/reviewNotifications';

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const supabase = await createClient();
    const { data: sub, error } = await supabase
      .from('review_notification_subscriptions')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const { data: logs } = await supabase
      .from('review_notification_logs')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      success: true,
      subscription: sub || null,
      recentLogs: logs || [],
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
      return NextResponse.json({ success: false, error: '올바른 JSON 요청이어야 합니다.' }, { status: 400 });
    }

    const payload = body as Partial<NotificationSubscription>;
    const channel: NotificationChannel = payload.channel === 'web_push' ? 'web_push' : 'email';
    const target = typeof payload.target === 'string' ? payload.target.trim() : '';
    const preferredHour = typeof payload.preferredHourKst === 'number'
      ? Math.max(0, Math.min(23, payload.preferredHourKst))
      : 9;
    const isActive = Boolean(payload.isActive);

    if (isActive && !target) {
      return NextResponse.json(
        { success: false, error: '알림을 수신할 이메일 주소 또는 푸시 엔드포인트가 필요합니다.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('review_notification_subscriptions')
      .upsert(
        {
          user_id: auth.user.id,
          channel,
          target,
          preferred_hour_kst: preferredHour,
          is_active: isActive,
          consented_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id,channel' }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      subscription: data,
      message: isActive ? '알림 수신 설정이 등록되었습니다.' : '알림 수신이 해제되었습니다.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
