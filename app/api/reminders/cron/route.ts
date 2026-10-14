import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  rowToSubscription,
  getKstDateString,
  getKstHour,
  makeReminderIdempotencyKey,
  formatReviewReminderMessage,
} from '@/lib/reviewNotifications';

/**
 * Scheduled Cron Endpoint for Daily Review Notifications.
 * Intended to be invoked hourly by a cron runner (e.g. Vercel Cron, GitHub Actions, or crontab).
 *
 * Security: Authenticated via Authorization: Bearer <CRON_SECRET> or x-cron-secret header.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const customHeader = req.headers.get('x-cron-secret');

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : customHeader?.trim();

  // If CRON_SECRET is configured in environment, require it
  if (cronSecret && token !== cronSecret) {
    return NextResponse.json(
      { success: false, error: '스케줄러 호출 인증에 실패했습니다.' },
      { status: 401 }
    );
  }

  try {
    const supabase = await createClient();
    const now = new Date();
    const currentKstHour = getKstHour(now);
    const todayKst = getKstDateString(now);

    const pageSize = 50;
    let page = 0;
    let totalEvaluated = 0;
    let dispatched = 0;
    let skipped = 0;
    let failed = 0;

    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;

    while (true) {
      const { data: subRows, error: subError } = await supabase
        .from('review_notification_subscriptions')
        .select('*')
        .eq('is_active', true)
        .eq('preferred_hour_kst', currentKstHour)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (subError || !Array.isArray(subRows) || subRows.length === 0) {
        break;
      }

      for (const row of subRows) {
        totalEvaluated++;
        const sub = rowToSubscription(row);
        if (!sub || !sub.isActive || !sub.target) {
          skipped++;
          continue;
        }

        // 1. Calculate actual due review items from database
        let dueCount = 0;
        try {
          const { data: planItems } = await supabase
            .from('study_plan_items')
            .select('id')
            .eq('user_id', sub.userId)
            .lte('assigned_date', todayKst)
            .eq('status', 'pending');

          if (Array.isArray(planItems)) {
            dueCount = planItems.length;
          }
        } catch {
          dueCount = 0;
        }

        // Suppress dispatch if no actual due reviews exist
        if (dueCount <= 0) {
          skipped++;
          continue;
        }

        const idempotencyKey = makeReminderIdempotencyKey(sub.userId, todayKst, sub.channel);
        const message = formatReviewReminderMessage(dueCount);

        // 2. Atomic dispatch claim via Postgres RPC
        let logId: string | null = null;
        let claimOk = false;

        const { data: claimData } = await supabase.rpc('claim_notification_dispatch', {
          p_user_id: sub.userId,
          p_idempotency_key: idempotencyKey,
          p_channel: sub.channel,
          p_due_item_count: dueCount,
          p_message: message,
          p_is_test: false,
        });

        if (claimData && typeof claimData === 'object') {
          const c = claimData as { allowed?: boolean; log_id?: string };
          claimOk = Boolean(c.allowed);
          logId = c.log_id || null;
        }

        if (!claimOk || !logId) {
          skipped++;
          continue;
        }

        // 3. Provider invocation
        if (!webhookUrl) {
          await supabase.rpc('complete_notification_dispatch', {
            p_log_id: logId,
            p_status: 'failed',
            p_error: 'NOTIFICATION_WEBHOOK_URL_NOT_CONFIGURED',
          }).catch(() => {});
          failed++;
          continue;
        }

        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              userId: sub.userId,
              channel: sub.channel,
              target: sub.target,
              message,
              dueItemCount: dueCount,
              idempotencyKey,
              sentAt: new Date().toISOString(),
            }),
          });

          if (res.ok) {
            const status = res.status === 202 ? 'accepted' : 'delivered';
            await supabase.rpc('complete_notification_dispatch', {
              p_log_id: logId,
              p_status: status,
            }).catch(() => {});
            dispatched++;
          } else {
            await supabase.rpc('complete_notification_dispatch', {
              p_log_id: logId,
              p_status: 'failed',
              p_error: `Provider HTTP error: ${res.status}`,
            }).catch(() => {});
            failed++;
          }
        } catch (err) {
          await supabase.rpc('complete_notification_dispatch', {
            p_log_id: logId,
            p_status: 'failed',
            p_error: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
          }).catch(() => {});
          failed++;
        }
      }

      if (subRows.length < pageSize) break;
      page++;
    }

    return NextResponse.json({
      success: true,
      executionHourKst: currentKstHour,
      dateKst: todayKst,
      totalEvaluated,
      dispatched,
      skipped,
      failed,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Cron 실행 오류' },
      { status: 500 }
    );
  }
}
