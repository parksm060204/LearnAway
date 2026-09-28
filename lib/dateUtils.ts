/**
 * Date and Timezone utilities for REDCALL Academic Suite.
 * Target Timezone: Asia/Seoul (UTC+09:00)
 */

export const REFERENCE_NOW_ISO = '2026-09-28T22:47:12+09:00';

/**
 * Returns current timestamp or reference timestamp
 */
export function getCurrentDate(): Date {
  return new Date(REFERENCE_NOW_ISO);
}

/**
 * Converts a date or ISO string to Asia/Seoul calendar date string YYYY-MM-DD
 */
export function toSeoulDateString(dateInput: string | Date): string {
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
 * Formats a date into "2026.10.12 (월) 10:00 - 12:00" format
 */
export function formatExamDate(isoString: string, endTime?: string): string {
  if (!isoString) return '시험일 미설정';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '시험일 미설정';

  const koreanDayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');

  // get day of week in Seoul
  const seoulDayIndex = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).getDay();
  const dayName = koreanDayNames[seoulDayIndex];

  let res = `${year}.${month}.${day} (${dayName}) ${hour}:${minute}`;
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
