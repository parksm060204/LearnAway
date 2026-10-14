import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../lib/auth/apiAuth';
import { createClient } from '../../../../lib/supabase/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import {
  rowToSubscription,
  rowToDeliveryLog,
  getKstDateString,
  makeReminderIdempotencyKey,
  makeTestNotificationIdempotencyKey,
  formatReviewReminderMessage,
} from '../../../../lib/reviewNotifications';

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
    const adminClient = createAdminClient();
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

    // 4. Atomic Dispatch Claiming via Secure Server RPC (using adminClient)
    let logId: string | null = null;
    let sendingToken: string | null = null;
    let claimOk = false;
    let claimReason = '';

    const { data: rpcClaim, error: rpcError } = await adminClient.rpc('claim_notification_dispatch', {
      p_user_id: auth.user.id,
      p_idempotency_key: idempotencyKey,
      p_channel: subscription.channel,
      p_due_item_count: calculatedDueCount,
      p_message: message,
      p_is_test: isTest,
    });

    if (!rpcError && rpcClaim && typeof rpcClaim === 'object') {
      const c = rpcClaim as { allowed?: boolean; log_id?: string; sending_token?: string; reason?: string };
      claimOk = Boolean(c.allowed);
      logId = c.log_id || null;
      sendingToken = c.sending_token || null;
      claimReason = c.reason || '';
    } else {
      claimOk = false;
      claimReason = rpcError ? rpcError.message : '알림 발송 선점에 실패했습니다.';
    }

    if (!claimOk) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason:
          claimReason === 'ALREADY_DISPATCHED' || claimReason === 'ALREADY_IN_FLIGHT' || claimReason === 'CONCURRENT_DISPATCH_CONFLICT'
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
      if (logId && sendingToken) {
        await adminClient.rpc('complete_notification_dispatch', {
          p_log_id: logId,
          p_sending_token: sendingToken,
          p_status: 'failed',
          p_error: missingProviderError,
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
        // Provider HTTP success means the message was accepted for delivery.
        // It is only marked 'delivered' if explicit provider proof is returned.
        let isDeliveredProof = false;
        try {
          const resBody = await response.json();
          if (resBody && resBody.delivered === true) {
            isDeliveredProof = true;
          }
        } catch {
          // Non-JSON or standard 200/202 response
        }
        deliveryStatus = isDeliveredProof ? 'delivered' : 'accepted';
      } else {
        providerError = `외부 알림 제공업체 HTTP 오류: ${response.status}`;
      }
    } catch (err) {
      providerError = `외부 알림 네트워크 연결 실패: ${err instanceof Error ? err.message : '오류'}`;
    }

    // 6. Record Completion Status via Secure RPC
    let completeResult: { success?: boolean; error?: string } | null = null;
    if (logId && sendingToken) {
      const { data: compData, error: compErr } = await adminClient.rpc('complete_notification_dispatch', {
        p_log_id: logId,
        p_sending_token: sendingToken,
        p_status: deliveryStatus,
        p_error: providerSuccess ? null : providerError,
      });
      if (compErr || (compData && compData.success === false)) {
        completeResult = { success: false, error: compErr?.message || compData?.error };
      } else {
        completeResult = { success: true };
      }
    }

    const { data: finalLog } = logId
      ? await adminClient.from('review_notification_logs').select('*').eq('id', logId).maybeSingle()
      : { data: null };

    if (!providerSuccess || (completeResult && !completeResult.success)) {
      return NextResponse.json({
        success: false,
        deliveryLog: finalLog ? rowToDeliveryLog(finalLog) : null,
        message: '알림 발송에 실패했습니다. 잠시 후 다시 시도할 수 있습니다.',
        error: providerError || completeResult?.error || '발송 상태 기록 실패',
        dueItemCount: calculatedDueCount,
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      deliveryLog: finalLog ? rowToDeliveryLog(finalLog) : null,
      message: deliveryStatus === 'delivered'
        ? '알림이 성공적으로 수신자에게 전달되었습니다.'
        : '알림 발송이 정상 접수(accepted)되었습니다.',
      dueItemCount: calculatedDueCount,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
