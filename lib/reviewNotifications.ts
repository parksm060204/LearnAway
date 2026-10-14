export type NotificationChannel = 'email' | 'web_push';

export type NotificationDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'suppressed';

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
  status: NotificationDeliveryStatus;
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
 * Explicit DB snake_case row -> domain NotificationSubscription conversion
 * with strict runtime validation. Guards against simple casting bugs.
 */
export function rowToSubscription(row: unknown): NotificationSubscription | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const userId = typeof r.user_id === 'string' ? r.user_id.trim() : '';
  if (!userId) return null;

  const rawChannel = r.channel;
  const channel: NotificationChannel =
    rawChannel === 'web_push' ? 'web_push' : rawChannel === 'email' ? 'email' : 'email';

  const target = typeof r.target === 'string' ? r.target.trim() : '';
  const rawHour = typeof r.preferred_hour_kst === 'number' ? r.preferred_hour_kst : 9;
  const preferredHourKst = Math.max(0, Math.min(23, Math.floor(rawHour)));

  // Strict boolean validation from DB is_active column
  const isActive = r.is_active === true;
  const consentedAt = typeof r.consented_at === 'string' ? r.consented_at : new Date().toISOString();
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : undefined;
  const id = typeof r.id === 'string' ? r.id : undefined;

  return {
    id,
    userId,
    channel,
    target,
    preferredHourKst,
    isActive,
    consentedAt,
    updatedAt,
  };
}

/**
 * Explicit domain NotificationSubscription -> DB snake_case row conversion.
 */
export function subscriptionToRow(
  sub: Partial<NotificationSubscription> & { userId: string }
): Record<string, unknown> {
  const channel: NotificationChannel = sub.channel === 'web_push' ? 'web_push' : 'email';
  const hour = typeof sub.preferredHourKst === 'number'
    ? Math.max(0, Math.min(23, Math.floor(sub.preferredHourKst)))
    : 9;

  return {
    user_id: sub.userId,
    channel,
    target: (sub.target || '').trim(),
    preferred_hour_kst: hour,
    is_active: Boolean(sub.isActive),
    consented_at: sub.consentedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Explicit DB snake_case row -> domain NotificationDeliveryLog conversion.
 */
export function rowToDeliveryLog(row: unknown): NotificationDeliveryLog | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const userId = typeof r.user_id === 'string' ? r.user_id.trim() : '';
  const idempotencyKey = typeof r.idempotency_key === 'string' ? r.idempotency_key : '';
  if (!userId || !idempotencyKey) return null;

  const validStatuses: NotificationDeliveryStatus[] = [
    'queued',
    'sending',
    'accepted',
    'delivered',
    'failed',
    'suppressed',
  ];
  const status: NotificationDeliveryStatus = validStatuses.includes(
    r.status as NotificationDeliveryStatus
  )
    ? (r.status as NotificationDeliveryStatus)
    : 'failed';

  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    userId,
    subscriptionId: typeof r.subscription_id === 'string' ? r.subscription_id : undefined,
    idempotencyKey,
    channel: r.channel === 'web_push' ? 'web_push' : 'email',
    status,
    dueItemCount: typeof r.due_item_count === 'number' ? r.due_item_count : 0,
    message: typeof r.message === 'string' ? r.message : '',
    error: typeof r.error === 'string' ? r.error : undefined,
    deliveredAt: typeof r.delivered_at === 'string' ? r.delivered_at : undefined,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
  };
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
 * Constructs an idempotency key for test dispatches.
 * Distinct from daily reminders to avoid blocking the daily quota.
 */
export function makeTestNotificationIdempotencyKey(
  userId: string,
  timestampMs: number,
  channel: NotificationChannel
): string {
  return `test_${userId}_${timestampMs}_${channel}`;
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

  if (!subscription.target || !subscription.target.trim()) {
    return {
      shouldSend: false,
      reason: '알림 수신 대상(이메일 또는 푸시 엔드포인트)이 설정되지 않았습니다.',
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

  return {
    shouldSend: true,
    reason: `오늘 복습 항목 ${dueItemCount}개 발송 대상입니다.`,
    idempotencyKey,
  };
}
