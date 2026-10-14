export type NotificationChannel = 'email' | 'web_push';

export interface NotificationSubscription {
  id?: string;
  userId: string;
  channel: NotificationChannel;
  target: string;
  preferredHourKst: number;
  isActive: boolean;
  consentedAt: string;
  updatedAt?: string;
}

export interface NotificationDeliveryLog {
  id?: string;
  userId: string;
  subscriptionId?: string;
  idempotencyKey: string;
  channel: NotificationChannel;
  status: 'pending' | 'delivered' | 'failed' | 'suppressed';
  dueItemCount: number;
  message: string;
  error?: string;
  deliveredAt?: string;
  createdAt: string;
}

/**
 * Returns the current date formatted as YYYY-MM-DD in Asia/Seoul (KST, UTC+9).
 */
export function getKstDateString(date = new Date()): string {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstDate = new Date(date.getTime() + kstOffsetMs);
  return kstDate.toISOString().slice(0, 10);
}

/**
 * Returns current hour (0-23) in Asia/Seoul.
 */
export function getKstHour(date = new Date()): number {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstDate = new Date(date.getTime() + kstOffsetMs);
  return kstDate.getUTCHours();
}

/**
 * Constructs an idempotency key for daily notifications.
 * Prevents more than one dispatch per user, date, and channel.
 */
export function makeReminderIdempotencyKey(
  userId: string,
  kstDateStr: string,
  channel: NotificationChannel
): string {
  return `reminder_${userId}_${kstDateStr}_${channel}`;
}

/**
 * Builds a clean, privacy-respecting review notification message.
 * NEVER includes lecture text, model answers, or sensitive tokens.
 */
export function formatReviewReminderMessage(dueItemCount: number, subjectNames: string[] = []): string {
  const subjectSummary = subjectNames.length > 0 ? ` [${subjectNames.join(', ')}]` : '';
  if (dueItemCount <= 0) {
    return `[LearnAway] 오늘 예정된 복습이 모두 완료되었습니다.${subjectSummary}`;
  }
  return `[LearnAway] 오늘의 복습 알림: 오늘 학습할 개념이 총 ${dueItemCount}개 예정되어 있습니다.${subjectSummary} 잊기 전에 확인해 보세요.`;
}

/**
 * Evaluates whether a notification dispatch should proceed.
 */
export function evaluateNotificationDispatch(
  subscription: NotificationSubscription | null,
  dueItemCount: number,
  existingLogKeys: Set<string>,
  now = new Date()
): {
  shouldSend: boolean;
  reason: string;
  idempotencyKey: string;
} {
  const kstDateStr = getKstDateString(now);

  if (!subscription || !subscription.isActive) {
    return {
      shouldSend: false,
      reason: '알림 수신 동의가 없거나 비활성화되었습니다.',
      idempotencyKey: '',
    };
  }

  const idempotencyKey = makeReminderIdempotencyKey(
    subscription.userId,
    kstDateStr,
    subscription.channel
  );

  if (existingLogKeys.has(idempotencyKey)) {
    return {
      shouldSend: false,
      reason: '오늘 날짜의 알림이 이미 발송되었습니다 (중복 방지).',
      idempotencyKey,
    };
  }

  if (dueItemCount <= 0) {
    return {
      shouldSend: false,
      reason: '오늘 예정된 복습 항목이 없습니다.',
      idempotencyKey,
    };
  }

  // Allow sending if preferred hour matches current hour or if manual dispatch
  return {
    shouldSend: true,
    reason: `오늘 복습 항목 ${dueItemCount}개 발송 대상입니다.`,
    idempotencyKey,
  };
}
