/**
 * Date and Timezone utilities for Learn my way Academic Suite.
 * Target Timezone: Asia/Seoul (UTC+09:00)
 */

export const REFERENCE_NOW_ISO = '2026-09-28T22:47:12+09:00';

/**
 * Returns current timestamp in real runtime (no frozen static timestamp for live scheduling)
 */
export function getCurrentDate(): Date {
  return new Date();
}

/**
 * Converts a date or ISO string to Asia/Seoul calendar date string YYYY-MM-DD
 */
export function toSeoulDateString(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // returns YYYY-MM-DD
}

/**
 * Extracts 24-hour time string ('HH:mm', '00:00' ~ '23:59') explicitly in Asia/Seoul timezone.
 * Never depends on the browser or host machine local timezone.
 */
export function toSeoulTimeString(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const rawHour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const rawMinute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const normalizedHour = rawHour === '24' ? '00' : rawHour.padStart(2, '0');
  const normalizedMinute = rawMinute.padStart(2, '0');
  return `${normalizedHour}:${normalizedMinute}`;
}

/**
 * Builds an explicit Asia/Seoul ISO timestamp (`YYYY-MM-DDTHH:mm:00+09:00`) from
 * a Seoul calendar date string (`YYYY-MM-DD`) and 24-hour time string (`HH:mm`).
 */
export function buildSeoulIsoTimestamp(dateStr?: string | null, timeStr: string = '10:00'): string {
  const cleanDate = (dateStr ?? '').trim();
  if (!cleanDate) return '';

  const rawTime = (timeStr ?? '').trim();
  const [rawH = '10', rawM = '00'] = (rawTime.includes(':') ? rawTime : '10:00').split(':');
  let hNum = parseInt(rawH, 10);
  if (hNum === 24) hNum = 0;
  if (isNaN(hNum) || hNum < 0 || hNum > 23) hNum = 10;
  let mNum = parseInt(rawM, 10);
  if (isNaN(mNum) || mNum < 0 || mNum > 59) mNum = 0;

  const hh = String(hNum).padStart(2, '0');
  const mm = String(mNum).padStart(2, '0');
  return `${cleanDate}T${hh}:${mm}:00+09:00`;
}

/**
 * Extracts initial date and time fields for the exam schedule editor in Asia/Seoul timezone.
 */
export function extractSeoulExamSchedule(
  examAt?: string | null,
  examEndTime?: string | null
): { dateStr: string; startTime: string; endTime: string } {
  const dateStr = examAt ? toSeoulDateString(examAt) : '';
  const startTime = (examAt ? toSeoulTimeString(examAt) : '') || '10:00';
  const endTime = examEndTime || '12:00';
  return { dateStr, startTime, endTime };
}

/**
 * Calculates calendar day difference between two dates in Asia/Seoul:
 * returns (toDate - fromDate) in whole calendar days.
 * Handles midnight boundary transitions in KST cleanly.
 */
export function getSeoulCalendarDiff(fromDateInput: Date | string, toDateInput: Date | string): number {
  const fromStr = toSeoulDateString(fromDateInput);
  const toStr = toSeoulDateString(toDateInput);
  if (!fromStr || !toStr) return 0;

  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);

  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((utc2 - utc1) / msPerDay);
}

/**
 * Calculates real elapsed fractional days from an ISO timestamp to reference date.
 */
export function getElapsedDays(fromIso: string, referenceDate: Date = new Date()): number {
  const from = new Date(fromIso);
  if (isNaN(from.getTime())) return 0;
  const diffMs = referenceDate.getTime() - from.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Formats a date in Asia/Seoul into compact label (e.g. "09.28", "2026.09.28 (월)")
 */
export function formatSeoulDate(
  dateInput: string | Date,
  options?: { includeYear?: boolean; includeDayName?: boolean }
): string {
  const seoulDateStr = toSeoulDateString(dateInput);
  if (!seoulDateStr) return '';

  const koreanDayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const [year, month, day] = seoulDateStr.split('-');
  const seoulDayIndex = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  const dayName = koreanDayNames[seoulDayIndex];

  let result = options?.includeYear ? `${year}.${month}.${day}` : `${month}.${day}`;
  if (options?.includeDayName) {
    result += ` (${dayName})`;
  }
  return result;
}

/**
 * Adds whole calendar days to an Asia/Seoul date and returns ISO string
 */
export function addDaysToDate(baseDateInput: string | Date, daysToAdd: number): string {
  const base = typeof baseDateInput === 'string' ? new Date(baseDateInput) : new Date(baseDateInput);
  if (isNaN(base.getTime())) return new Date().toISOString();
  const next = new Date(base.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

/**
 * Formats a date into "2026.10.12 (월) 10:00 - 12:00" format
 */
export function formatExamDate(isoString: string, endTime?: string): string {
  if (!isoString) return '시험일 미설정';
  const seoulDateStr = toSeoulDateString(isoString);
  const seoulTimeStr = toSeoulTimeString(isoString);
  if (!seoulDateStr || !seoulTimeStr) return '시험일 미설정';

  const koreanDayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const [year, month, day] = seoulDateStr.split('-');
  const seoulDayIndex = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  const dayName = koreanDayNames[seoulDayIndex];

  let res = `${year}.${month}.${day} (${dayName}) ${seoulTimeStr}`;
  if (endTime) {
    res += ` - ${endTime}`;
  }
  return res;
}

export interface DDayResult {
  calendarDiff: number; // positive = future, 0 = today, negative = past
  displayBadge: string; // "D-14", "D-Day", "시험 종료", "시험일 설정"
  exactHoursRemaining?: number;
  hoursDisplay?: string;
  isOverdue: boolean;
  isToday: boolean;
  isNotSet: boolean;
}

/**
 * Calculates D-day accurately using Asia/Seoul calendar days
 */
export function calculateDDay(examAtIso?: string, referenceDate: Date = getCurrentDate()): DDayResult {
  if (!examAtIso) {
    return {
      calendarDiff: 0,
      displayBadge: '시험일 설정',
      isOverdue: false,
      isToday: false,
      isNotSet: true,
    };
  }

  const examDate = new Date(examAtIso);
  if (isNaN(examDate.getTime())) {
    return {
      calendarDiff: 0,
      displayBadge: '시험일 설정',
      isOverdue: false,
      isToday: false,
      isNotSet: true,
    };
  }

  const refSeoulDateStr = toSeoulDateString(referenceDate);
  const examSeoulDateStr = toSeoulDateString(examDate);

  const [refY, refM, refD] = refSeoulDateStr.split('-').map(Number);
  const [examY, examM, examD] = examSeoulDateStr.split('-').map(Number);

  // UTC-based date diff for pure calendar days
  const refUtc = Date.UTC(refY, refM - 1, refD);
  const examUtc = Date.UTC(examY, examM - 1, examD);

  const msPerDay = 1000 * 60 * 60 * 24;
  const calendarDiff = Math.round((examUtc - refUtc) / msPerDay);

  // Exact hours remaining between timestamps
  const diffMs = examDate.getTime() - referenceDate.getTime();
  const exactHoursRemaining = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));

  if (calendarDiff === 0) {
    return {
      calendarDiff: 0,
      displayBadge: 'D-Day',
      exactHoursRemaining,
      hoursDisplay: `${exactHoursRemaining}h`,
      isOverdue: false,
      isToday: true,
      isNotSet: false,
    };
  }

  if (calendarDiff < 0) {
    return {
      calendarDiff,
      displayBadge: '시험 종료',
      isOverdue: true,
      isToday: false,
      isNotSet: false,
    };
  }

  return {
    calendarDiff,
    displayBadge: `D-${calendarDiff}`,
    exactHoursRemaining,
    hoursDisplay: `${exactHoursRemaining}h`,
    isOverdue: false,
    isToday: false,
    isNotSet: false,
  };
}

/**
 * Format relative day for UI display, e.g. -9 -> "-9일", -2 -> "-2일 전", 0 -> "오늘", 3 -> "+3일 권장"
 */
export function formatRelativeDay(dayOffset: number): string {
  if (dayOffset === 0) return '오늘 (0D)';
  if (dayOffset > 0) return `+${dayOffset}일 후`;
  return `${dayOffset}일 전`;
}
