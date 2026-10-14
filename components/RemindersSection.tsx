'use client';

import React, { useState, useEffect } from 'react';
import { Bell, Check, Loader2, Send, AlertTriangle } from 'lucide-react';
import { NotificationChannel } from '../lib/reviewNotifications';

interface RemindersSectionProps {
  currentUserEmail?: string | null;
}

interface SubscriptionData {
  id?: string;
  channel: NotificationChannel;
  target: string;
  preferred_hour_kst?: number;
  preferredHourKst?: number;
  is_active?: boolean;
  isActive?: boolean;
  consented_at?: string;
}

interface DeliveryLog {
  id: string;
  created_at: string;
  channel: string;
  status: string;
  due_item_count: number;
  message: string;
  error?: string;
}

export function RemindersSection({ currentUserEmail }: RemindersSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [channel, setChannel] = useState<NotificationChannel>('email');
  const [target, setTarget] = useState(currentUserEmail || '');
  const [preferredHour, setPreferredHour] = useState(9);
  const [recentLogs, setRecentLogs] = useState<DeliveryLog[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch('/api/reminders/settings');
        const data = await res.json();
        if (!ignore && res.ok && data.success) {
          if (data.subscription) {
            const sub = data.subscription as SubscriptionData;
            setIsActive(Boolean(sub.is_active ?? sub.isActive));
            setChannel(sub.channel || 'email');
            setTarget(sub.target || currentUserEmail || '');
            setPreferredHour(sub.preferred_hour_kst ?? sub.preferredHourKst ?? 9);
          } else if (currentUserEmail) {
            setTarget(currentUserEmail);
          }
          setRecentLogs(data.recentLogs || []);
        }
      } catch {
        // ignore
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [currentUserEmail, refreshCount]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/reminders/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          target: target.trim(),
          preferredHourKst: Number(preferredHour),
          isActive,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ text: data.message || '알림 설정이 저장되었습니다.' });
        setRefreshCount((c) => c + 1);
      } else {
        setStatusMessage({ text: data.error || '저장에 실패했습니다.', isError: true });
      }
    } catch (err) {
      setStatusMessage({ text: err instanceof Error ? err.message : '네트워크 오류', isError: true });
    } finally {
      setSaving(false);
    }
  };

  const handleTestDispatch = async () => {
    setTesting(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/reminders/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testSend: true, dueItemCount: 2, subjectNames: ['수리통계학'] }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ text: '테스트 알림 발송이 완료되었습니다.' });
        setRefreshCount((c) => c + 1);
      } else {
        setStatusMessage({
          text: data.reason || data.details || data.error || '알림 발송에 실패했습니다.',
          isError: true,
        });
      }
    } catch (err) {
      setStatusMessage({ text: err instanceof Error ? err.message : '오류 발생', isError: true });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-[#827d73]">
        <Loader2 className="w-4 h-4 animate-spin" />
        알림 설정을 불러오는 중입니다...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-[#191817] font-academic-serif flex items-center gap-2">
          <Bell className="w-4 h-4 text-rose-500" />
          오늘의 복습 외부 알림 (이메일 / 웹 푸시)
        </h3>
        <p className="text-xs text-[#827d73] mt-1">
          망각곡선과 시험일에 따라 오늘 예정된 복습 항목이 있을 때, KST(한국 표준시) 지정 시각에 리마인더를 발송합니다.
          알림 본문에는 강의 원문, 시험 답안, API 키 등의 민감 정보가 포함되지 않습니다.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4 max-w-lg">
        {/* Active Toggle */}
        <div className="flex items-center justify-between p-3.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
          <div>
            <span className="font-bold text-xs text-[#191817]">복습 알림 수신 동의</span>
            <p className="text-[11px] text-[#827d73]">
              체크를 해제하면 모든 예약 발송이 즉시 중단됩니다.
            </p>
          </div>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4 text-[#191817] rounded border-[#ded6c8]"
          />
        </div>

        {/* Channel Selection */}
        <div>
          <label className="block text-xs font-semibold text-[#57544e] mb-1">
            알림 채널
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChannel('email')}
              className={`flex-1 py-1.5 px-3 text-xs border rounded-xs font-medium ${
                channel === 'email'
                  ? 'bg-[#191817] text-white border-[#191817]'
                  : 'bg-white text-[#57544e] border-[#ded6c8]'
              }`}
            >
              이메일 알림
            </button>
            <button
              type="button"
              onClick={() => setChannel('web_push')}
              className={`flex-1 py-1.5 px-3 text-xs border rounded-xs font-medium ${
                channel === 'web_push'
                  ? 'bg-[#191817] text-white border-[#191817]'
                  : 'bg-white text-[#57544e] border-[#ded6c8]'
              }`}
            >
              웹 브라우저 푸시
            </button>
          </div>
        </div>

        {/* Target Address */}
        <div>
          <label className="block text-xs font-semibold text-[#57544e] mb-1">
            {channel === 'email' ? '수신 이메일 주소' : '수신 디바이스 엔드포인트'}
          </label>
          <input
            type={channel === 'email' ? 'email' : 'text'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={channel === 'email' ? 'student@university.ac.kr' : '엔드포인트 URI'}
            disabled={!isActive}
            className="w-full p-2 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817] disabled:bg-gray-100"
          />
        </div>

        {/* Preferred Hour (KST) */}
        <div>
          <label className="block text-xs font-semibold text-[#57544e] mb-1">
            발송 희망 시각 (KST, 한국 표준시)
          </label>
          <select
            value={preferredHour}
            onChange={(e) => setPreferredHour(Number(e.target.value))}
            disabled={!isActive}
            className="w-full p-2 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817] disabled:bg-gray-100"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                오전/오후 {i.toString().padStart(2, '0')}:00 KST
              </option>
            ))}
          </select>
        </div>

        {statusMessage && (
          <div
            className={`p-3 rounded text-xs flex items-center gap-2 ${
              statusMessage.isError
                ? 'bg-red-50 text-red-900 border border-red-200'
                : 'bg-emerald-50 text-emerald-900 border border-emerald-200'
            }`}
          >
            {statusMessage.isError ? (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-[#191817] text-white text-xs font-bold rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-50"
          >
            {saving ? '저장 중...' : '알림 설정 저장'}
          </button>

          {isActive && (
            <button
              type="button"
              onClick={handleTestDispatch}
              disabled={testing}
              className="px-3.5 py-2 bg-white border border-[#ded6c8] text-[#57544e] text-xs font-medium rounded-xs hover:bg-[#faf8f4] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              테스트 알림 발송
            </button>
          )}
        </div>
      </form>

      {/* Recent Delivery Logs */}
      <div className="pt-4 border-t border-[#f1ede4]">
        <h4 className="text-xs font-bold text-[#191817] mb-2 font-academic-mono">
          최근 알림 발송 이력 (중복 방지 장부)
        </h4>
        {recentLogs.length === 0 ? (
          <p className="text-[11px] text-[#827d73]">아직 발송된 알림 이력이 없습니다.</p>
        ) : (
          <div className="border border-[#ded6c8] rounded-xs overflow-hidden">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#faf8f4] text-[#827d73] border-b border-[#ded6c8] font-academic-mono">
                <tr>
                  <th className="p-2">발송 시각 (KST)</th>
                  <th className="p-2">채널</th>
                  <th className="p-2">상태</th>
                  <th className="p-2">복습 건수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1ede4]">
                {recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#faf8f4]">
                    <td className="p-2 text-[#57544e] font-academic-mono">
                      {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </td>
                    <td className="p-2 text-[#191817] uppercase">{log.channel}</td>
                    <td className="p-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'delivered'
                            ? 'bg-emerald-50 text-emerald-800'
                            : log.status === 'failed'
                            ? 'bg-red-50 text-red-800'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="p-2 text-[#191817] font-bold">{log.due_item_count}개</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
