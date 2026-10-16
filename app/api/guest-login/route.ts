import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { createAdminClient, hasAdminClientConfig } from '../../../lib/supabase/admin';
import { readSupabaseEnv } from '../../../lib/supabase/config';

const GUEST_EMAIL = 'guest@learnaway.ai';
const GUEST_PASSWORD = process.env.GUEST_USER_PASSWORD || 'TestPassword123!@#';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';

    if (code !== 'abc') {
      return NextResponse.json(
        {
          success: false,
          error: '게스트 코드가 일치하지 않습니다. 올바른 코드(abc)를 입력해 주세요.',
        },
        { status: 400 }
      );
    }

    if (!readSupabaseEnv()) {
      // Mock/Offline fallback
      return NextResponse.json({
        success: true,
        user: { id: 'guest-user-offline', email: GUEST_EMAIL },
      });
    }

    // Ensure the guest user exists using service_role admin client if available
    if (hasAdminClientConfig()) {
      try {
        const admin = createAdminClient();
        const { data: userList } = await admin.auth.admin.listUsers();
        const existing = userList?.users?.find((u) => u.email === GUEST_EMAIL);
        if (!existing) {
          await admin.auth.admin.createUser({
            email: GUEST_EMAIL,
            password: GUEST_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: '게스트 사용자' },
          });
        }
      } catch (err) {
        console.warn('Admin user check warning (continuing to sign-in):', err);
      }
    }

    // Sign in using server client so session cookies are written to the response
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: GUEST_EMAIL,
      password: GUEST_PASSWORD,
    });

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: `게스트 계정 로그인에 실패했습니다: ${error.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email },
      session: data.session,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : '게스트 로그인 처리 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
