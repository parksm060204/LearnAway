import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      code: 'GUEST_LOGIN_DEPRECATED',
      errorCode: 'GUEST_LOGIN_DEPRECATED',
      error: '공용 게스트 로그인은 서비스가 종료되었습니다. 간편 회원가입 / 아이디 로그인을 이용해 주세요.',
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      code: 'GUEST_LOGIN_DEPRECATED',
      errorCode: 'GUEST_LOGIN_DEPRECATED',
      error: '공용 게스트 로그인은 서비스가 종료되었습니다. 간편 회원가입 / 아이디 로그인을 이용해 주세요.',
    },
    { status: 410 }
  );
}
