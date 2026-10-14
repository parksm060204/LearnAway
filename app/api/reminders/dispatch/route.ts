import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { createClient } from '@/lib/supabase/server';
import {
  rowToSubscription,
  rowToDeliveryLog,
  getKstDateString,
  makeReminderIdempotencyKey,
  makeTestNotificationIdempotencyKey,
  formatReviewReminderMessage,
} from '@/lib/reviewNotifications';

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    let body: { testSend?: boolean; subjectNames?: string[] } = {};
    try {
      body = await req.json();
    } catch {
      // allow empty body
    }

    const supabase = await createClient();
    const isTest = Boolean(body.testSend);

    // 1. Fetch user subscription using explicit mapper and runtime validation
    const { data: subRow, error: subError } = await supabase
      .from('review_notification_subscriptions')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (subError && subError.code !== 'PGRST116') {
      return NextResponse.json({ success: false, error: subError.message }, { status: 500 });
    }

    const subscription = subRow ? rowToSubscription(subRow) : null;

    // Strict consent check: Even testSend requires active subscription with consent
    if (!subscription || !subscription.isActive) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: '알림 수신 동의가 없거나 비활성화되었습니다.',
      }, { status: 400 });
    }

    if (!subscription.target) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: '알림 수신 대상(이메일 또는 푸시 엔드포인트)이 설정되지 않았습니다.',
      }, { status: 400 });
    }

    // 2. Authoritative server calculation of due review items
    // Never trust client's dueItemCount
    const todayKst = getKstDateString();
    let calculatedDueCount = 0;
    const subjectNames: string[] = Array.isArray(body.subjectNames) ? body.subjectNames : [];

    try {
      const { data: planItems, error: planError } = await supabase
        .from('study_plan_items')
        .select('id, subject_id')
        .eq('user_id', auth.user.id)
        .lte('assigned_date', todayKst)
        .eq('status', 'pending');

      if (!planError && Array.isArray(planItems)) {
        calculatedDueCount = planItems.length;
      } else {
        // Fallback: check concepts table if study_plan_items is empty
        const { data: concepts } = await supabase
          .from('concepts')
          .select('id')
          .eq('user_id', auth.user.id)
          .eq('status', 'review_target');
        if (Array.isArray(concepts)) {
          calculatedDueCount = concepts.length;
        }
      }
    } catch {
      // If offline/mock without tables, default to 0 for safety
      calculatedDueCount = 0;
    }

    // If not a test send and no due items exist, suppress dispatch
    if (!isTest && calculatedDueCount <= 0) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: '오늘 예정된 복습 항목이 없습니다.',
        dueItemCount: 0,
      });
    }

    // 3. Formulate idempotency key and message
    const idempotencyKey = isTest
      ? makeTestNotificationIdempotencyKey(auth.user.id, Date.now(), subscription.channel)
      : makeReminderIdempotencyKey(auth.user.id, todayKst, subscription.channel);

    const message = formatReviewReminderMessage(
      isTest ? Math.max(1, calculatedDueCount) : calculatedDueCount,
      subjectNames
    );

    // 4. Atomic Dispatch Claiming
    // Attempt claim via Postgres RPC
    let logId: string | null = null;
    let claimOk = false;
    let claimReason = '';

    const { data: rpcClaim, error: rpcError } = await supabase.rpc('claim_notification_dispatch', {
      p_user_id: auth.user.id,
      p_idempotency_key: idempotencyKey,
      p_channel: subscription.channel,
      p_due_item_count: calculatedDueCount,
      p_message: message,
      p_is_test: isTest,
    });

    if (!rpcError && rpcClaim && typeof rpcClaim === 'object') {
      const c = rpcClaim as { allowed?: boolean; log_id?: string; reason?: string };
      claimOk = Boolean(c.allowed);
      logId = c.log_id || null;
      claimReason = c.reason || '';
    } else {
      // Fallback for mock/local test environments without RPC
      const { data: existingLogs } = await supabase
        .from('review_notification_logs')
        .select('*')
        .eq('idempotency_key', idempotencyKey);

      const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;

      if (existingLog) {
        if (['sending', 'queued', 'accepted', 'delivered'].includes(existingLog.status)) {
          claimOk = false;
          claimReason = 'ALREADY_DISPATCHED_OR_IN_FLIGHT';
        } else {
          // Retry failed dispatch
          claimOk = true;
          logId = existingLog.id;
          await supabase
            .from('review_notification_logs')
            .update({ status: 'sending', error: null })
            .eq('id', existingLog.id);
        }
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('review_notification_logs')
          .insert({
            user_id: auth.user.id,
            subscription_id: subscription.id || null,
            idempotency_key: idempotencyKey,
            channel: subscription.channel,
            status: 'sending',
            due_item_count: calculatedDueCount,
            message,
            created_at: new Date().toISOString(),
          })
          .select('*')
          .single();

        if (!insertErr && inserted) {
          claimOk = true;
          logId = inserted.id;
        } else {
          claimOk = false;
          claimReason = 'CONCURRENT_DISPATCH_CONFLICT';
        }
      }
    }

    if (!claimOk) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason:
          claimReason === 'ALREADY_DISPATCHED_OR_IN_FLIGHT' || claimReason === 'CONCURRENT_DISPATCH_CONFLICT'
            ? '오늘 날짜의 알림이 이미 발송되었거나 현재 발송 진행 중입니다.'
            : claimReason,
        idempotencyKey,
      });
    }

    // 5. External Provider Execution
    // Provider webhook is ONLY taken from server environment variable, never client body
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (!webhookUrl) {
      const missingProviderError = '알림 발송 제공업체(NOTIFICATION_WEBHOOK_URL)가 서버에 설정되지 않았습니다.';
      if (logId) {
        await supabase.rpc('complete_notification_dispatch', {
          p_log_id: logId,
          p_status: 'failed',
          p_error: missingProviderError,
        }).catch(() => {
          return supabase
            .from('review_notification_logs')
            .update({ status: 'failed', error: missingProviderError })
            .eq('id', logId);
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: missingProviderError,
          errorCode: 'NOTIFICATION_PROVIDER_NOT_CONFIGURED',
        },
        { status: 503 }
      );
    }

    // Execute external call
    let providerSuccess = false;
    let providerError = '';
    let deliveryStatus: 'delivered' | 'accepted' | 'failed' = 'failed';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          userId: auth.user.id,
          channel: subscription.channel,
          target: subscription.target,
          message,
          dueItemCount: calculatedDueCount,
          idempotencyKey,
          sentAt: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        providerSuccess = true;
        deliveryStatus = response.status === 202 ? 'accepted' : 'delivered';
      } else {
        providerError = `외부 알림 제공업체 HTTP 오류: ${response.status}`;
      }
    } catch (err) {
      providerError = `외부 알림 네트워크 연결 실패: ${err instanceof Error ? err.message : '오류'}`;
    }

    // 6. Record Completion Status
    if (logId) {
      await supabase.rpc('complete_notification_dispatch', {
        p_log_id: logId,
        p_status: deliveryStatus,
        p_error: providerSuccess ? null : providerError,
      }).catch(() => {
        return supabase
          .from('review_notification_logs')
          .update({
            status: deliveryStatus,
            error: providerSuccess ? null : providerError,
            delivered_at: providerSuccess ? new Date().toISOString() : null,
          })
          .eq('id', logId);
      });
    }

    const { data: finalLog } = logId
      ? await supabase.from('review_notification_logs').select('*').eq('id', logId).maybeSingle()
      : { data: null };

    return NextResponse.json({
      success: providerSuccess,
      deliveryLog: finalLog ? rowToDeliveryLog(finalLog) : null,
      message: providerSuccess
        ? '알림이 성공적으로 발송되었습니다.'
        : '알림 발송에 실패했습니다. 잠시 후 다시 시도할 수 있습니다.',
      error: providerSuccess ? undefined : providerError,
      dueItemCount: calculatedDueCount,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
