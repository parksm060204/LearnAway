import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import {
  NotificationSubscription,
  evaluateNotificationDispatch,
  formatReviewReminderMessage,
} from '@/lib/reviewNotifications';

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    let body: { dueItemCount?: number; subjectNames?: string[]; testSend?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // allow empty body
    }

    const dueItemCount = typeof body.dueItemCount === 'number' ? body.dueItemCount : 1;
    const subjectNames = Array.isArray(body.subjectNames) ? body.subjectNames : [];

    const supabase = await createClient();

    // 1. Fetch user subscription
    const { data: subData, error: subError } = await supabase
      .from('review_notification_subscriptions')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (subError && subError.code !== 'PGRST116') {
      return NextResponse.json({ success: false, error: subError.message }, { status: 500 });
    }

    const subscription = subData as NotificationSubscription | null;

    // 2. Fetch existing dispatch logs for today (to enforce idempotency)
    const { data: existingLogs } = await supabase
      .from('review_notification_logs')
      .select('idempotency_key')
      .eq('user_id', auth.user.id);

    const existingKeys = new Set<string>((existingLogs || []).map((l: { idempotency_key: string }) => l.idempotency_key));

    // 3. Evaluate dispatch
    const evaluation = evaluateNotificationDispatch(subscription, dueItemCount, existingKeys);

    if (!evaluation.shouldSend && !body.testSend) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: evaluation.reason,
        idempotencyKey: evaluation.idempotencyKey,
      });
    }

    const message = formatReviewReminderMessage(dueItemCount, subjectNames);
    const targetChannel = subscription?.channel || 'email';
    const idempotencyKey = evaluation.idempotencyKey || `test_${auth.user.id}_${Date.now()}`;

    // 4. Record delivery log
    const now = new Date().toISOString();
    let deliveryStatus: 'delivered' | 'failed' = 'delivered';
    let deliveryError: string | undefined = undefined;

    // Optional webhook or external email provider execution
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl && subscription?.target) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: auth.user.id,
            channel: targetChannel,
            target: subscription.target,
            message,
            dueItemCount,
            sentAt: now,
          }),
        });
        if (!response.ok) {
          deliveryStatus = 'failed';
          deliveryError = `외부 알림 서버 응답 오류: ${response.status}`;
        }
      } catch (err) {
        deliveryStatus = 'failed';
        deliveryError = `외부 알림 발송 네트워크 실패: ${err instanceof Error ? err.message : '오류'}`;
      }
    }

    const { data: logRecord, error: logError } = await supabase
      .from('review_notification_logs')
      .insert({
        user_id: auth.user.id,
        subscription_id: subscription?.id || null,
        idempotency_key: idempotencyKey,
        channel: targetChannel,
        status: deliveryStatus,
        due_item_count: dueItemCount,
        message,
        error: deliveryError,
        delivered_at: deliveryStatus === 'delivered' ? now : null,
        created_at: now,
      })
      .select()
      .single();

    if (logError) {
      return NextResponse.json({ success: false, error: logError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: deliveryStatus === 'delivered',
      deliveryLog: logRecord,
      message: deliveryStatus === 'delivered' ? '알림이 성공적으로 발송되었습니다.' : '알림 발송에 실패했습니다.',
      details: deliveryError,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
