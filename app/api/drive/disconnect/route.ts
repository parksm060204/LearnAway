import { NextResponse } from 'next/server';
import { DRIVE_SESSION_COOKIE_NAME, DRIVE_STATE_COOKIE_NAME } from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true, message: 'Google Drive 연결이 해제되었습니다.' });
  response.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
  response.cookies.delete(DRIVE_STATE_COOKIE_NAME);
  return response;
}
