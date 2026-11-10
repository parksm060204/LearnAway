'use client';

import React from 'react';

interface TimeDialPickerProps {
  label: string;
  value: string; // "HH:mm" (24h format)
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function TimeDialPicker({
  label,
  value,
  onChange,
  disabled = false,
}: TimeDialPickerProps) {
  // Parse "HH:mm"
  const [rawHour = '10', rawMinute = '00'] = (value || '10:00').split(':');
  let hNum = parseInt(rawHour, 10);
  if (isNaN(hNum) || hNum < 0 || hNum > 23) hNum = 10;
  let mNum = parseInt(rawMinute, 10);
  if (isNaN(mNum) || mNum < 0 || mNum > 59) mNum = 0;

  const isPm = hNum >= 12;
  const period = isPm ? 'PM' : 'AM';
  const hour12 = hNum % 12 === 0 ? 12 : hNum % 12;

  const emitTime = (newPeriod: 'AM' | 'PM', newH12: number, newM: number) => {
    let final24H = newH12 % 12;
    if (newPeriod === 'PM') {
      final24H += 12;
    }
    const hh = String(final24H).padStart(2, '0');
    const mm = String(newM).padStart(2, '0');
    onChange(`${hh}:${mm}`);
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPeriod = e.target.value as 'AM' | 'PM';
    emitTime(newPeriod, hour12, mNum);
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newH12 = parseInt(e.target.value, 10);
    emitTime(period, newH12, mNum);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newM = parseInt(e.target.value, 10);
    emitTime(period, hour12, newM);
  };

  return (
    <div className="space-y-1">
      <label className="block font-academic-mono text-[11px] text-[#57544e]">
        {label}
      </label>
      <div
        className={`flex items-center gap-1.5 p-1.5 border border-[#ded6c8] rounded-xs bg-[#fefefe] ${
          disabled ? 'opacity-50 cursor-not-allowed bg-[#faf8f4]' : ''
        }`}
      >
        {/* AM / PM Select */}
        <select
          value={period}
          onChange={handlePeriodChange}
          disabled={disabled}
          aria-label={`${label} 오전/오후 선택`}
          className="bg-transparent text-xs font-bold text-[#191817] px-1 py-1 rounded-xs border border-transparent hover:border-[#ded6c8] focus:border-[#191817] focus:outline-hidden cursor-pointer disabled:cursor-not-allowed"
        >
          <option value="AM">오전</option>
          <option value="PM">오후</option>
        </select>

        <span className="text-[#c8c2b5] select-none text-xs">|</span>

        {/* Hour Select (1~12) */}
        <div className="flex items-center gap-0.5">
          <select
            value={hour12}
            onChange={handleHourChange}
            disabled={disabled}
            aria-label={`${label} 시 선택`}
            className="bg-transparent text-xs font-semibold text-[#191817] px-1 py-1 rounded-xs border border-transparent hover:border-[#ded6c8] focus:border-[#191817] focus:outline-hidden cursor-pointer disabled:cursor-not-allowed text-center"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}
              </option>
            ))}
          </select>
          <span className="text-[10.5px] text-[#827d73] select-none">시</span>
        </div>

        <span className="text-[#827d73] select-none font-bold text-xs">:</span>

        {/* Minute Select (00~55 in 5m increments or all minutes) */}
        <div className="flex items-center gap-0.5">
          <select
            value={mNum}
            onChange={handleMinuteChange}
            disabled={disabled}
            aria-label={`${label} 분 선택`}
            className="bg-transparent text-xs font-semibold text-[#191817] px-1 py-1 rounded-xs border border-transparent hover:border-[#ded6c8] focus:border-[#191817] focus:outline-hidden cursor-pointer disabled:cursor-not-allowed text-center"
          >
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
            {/* If the incoming minute isn't a multiple of 5, make sure it is still represented */}
            {mNum % 5 !== 0 && (
              <option value={mNum}>{String(mNum).padStart(2, '0')}</option>
            )}
          </select>
          <span className="text-[10.5px] text-[#827d73] select-none">분</span>
        </div>
      </div>
    </div>
  );
}

