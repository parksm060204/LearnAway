import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { createAdminClient, hasAdminClientConfig } from '../../../../lib/supabase/admin';
import { readSupabaseEnv } from '../../../../lib/supabase/config';
import { normalizeUsername, validateUsername, usernameToEmail } from '../../../../lib/auth/username';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'register' | 'signup' | 'login';
      username?: string;
      password?: string;
    };

    const rawAction = body.action;
    const isRegister = rawAction === 'register' || rawAction === 'signup';
    if (!isRegister && rawAction !== 'login') {
      return NextResponse.json(
        { success: false, code: 'INVALID_PARAMETERS', errorCode: 'INVALID_PARAMETERS', error: '올바른 동작(register, signup 또는 login)을 지정해 주세요.' },
        { status: 400 }
      );
    }
    const action = isRegister ? 'register' : 'login';

    const rawUsername = body.username || '';
    const rawPassword = body.password || '';

    const normalized = normalizeUsername(rawUsername);
    const validCheck = validateUsername(normalized);
    if (!validCheck.ok) {
      return NextResponse.json({ success: false, code: 'INVALID_USERNAME', errorCode: 'INVALID_USERNAME', error: validCheck.error }, { status: 400 });
    }

    if (!rawPassword || rawPassword.length < 6) {
      return NextResponse.json(
        { success: false, code: 'PASSWORD_TOO_SHORT', errorCode: 'PASSWORD_TOO_SHORT', error: '비밀번호는 최소 6자 이상이어야 합니다.' },
        { status: 400 }
      );
    }
    if (rawPassword.length > 100) {
      return NextResponse.json(
        { success: false, code: 'PASSWORD_TOO_LONG', errorCode: 'PASSWORD_TOO_LONG', error: '비밀번호가 너무 깁니다 (최대 100자).' },
        { status: 400 }
      );
    }

    // Check if Supabase is configured
    const isTestFake = Boolean(
      (globalThis as unknown as { __fakeSupabaseClient?: unknown }).__fakeSupabaseClient ||
      (globalThis as unknown as { __fakeSupabaseAdminClient?: unknown }).__fakeSupabaseAdminClient
    );
    if (!isTestFake && !readSupabaseEnv()) {
      return NextResponse.json(
        { success: false, code: 'SUPABASE_UNCONFIGURED', errorCode: 'SUPABASE_UNCONFIGURED', error: '서버 인증이 설정되지 않았습니다. 관리자에게 문의해 주세요.' },
        { status: 503 }
      );
    }

    if (!isTestFake && !hasAdminClientConfig()) {
      return NextResponse.json(
        { success: false, code: 'ADMIN_KEY_MISSING', errorCode: 'ADMIN_KEY_MISSING', error: '서버 관리자 설정이 누락되어 계정을 생성하거나 검증할 수 없습니다.' },
        { status: 503 }
      );
    }

    const admin = createAdminClient();
    const forwardedHeader = req.headers.get('x-forwarded-for');
    const realIpHeader = req.headers.get('x-real-ip');
    const clientIp = (forwardedHeader ? forwardedHeader.split(',')[0].trim() : '') || realIpHeader?.trim() || '127.0.0.1';

    async function evaluateRateLimit(
      key: string,
      maxAttempts: number,
      windowSeconds: number,
      exceededMessage: string
    ): Promise<NextResponse | null> {
      try {
        const { data: allowed, error: rateErr } = await admin.rpc('check_and_increment_rate_limit', {
          p_key: key,
          p_max_attempts: maxAttempts,
          p_window_seconds: windowSeconds,
        });

        if (rateErr || typeof allowed !== 'boolean') {
          return NextResponse.json(
            {
              success: false,
              code: 'RATE_LIMIT_CHECK_FAILED',
              errorCode: 'RATE_LIMIT_CHECK_FAILED',
              error: '인증 서비스 확인 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
            },
            { status: 503 }
          );
        }

        if (allowed === false) {
          return NextResponse.json(
            {
              success: false,
              code: 'RATE_LIMIT_EXCEEDED',
              errorCode: 'RATE_LIMIT_EXCEEDED',
              error: exceededMessage,
            },
            { status: 429 }
          );
        }

        return null;
      } catch {
        return NextResponse.json(
          {
            success: false,
            code: 'RATE_LIMIT_CHECK_FAILED',
            errorCode: 'RATE_LIMIT_CHECK_FAILED',
            error: '인증 서비스 확인 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
          },
          { status: 503 }
        );
      }
    }

    // 1. Persistent Server-Side Rate Limiting via DB (strictly fail-closed)
    if (action === 'register') {
      const regLimitRes = await evaluateRateLimit(
        `auth_reg_ip:${clientIp}`,
        5,
        900,
        '가입 요청이 너무 많습니다. 15분 후 다시 시도해 주세요.'
      );
      if (regLimitRes) return regLimitRes;
    } else {
      // Login rate limiting: by IP and by username
      const ipLimitRes = await evaluateRateLimit(
        `auth_login_ip:${clientIp}`,
        15,
        300,
        '로그인 시도가 너무 많습니다. 5분 후 다시 시도해 주세요.'
      );
      if (ipLimitRes) return ipLimitRes;

      const userLimitRes = await evaluateRateLimit(
        `auth_login_user:${normalized}`,
        5,
        300,
        '해당 아이디의 연속된 로그인 실패로 일시 차단되었습니다. 5분 후 다시 시도해 주세요.'
      );
      if (userLimitRes) return userLimitRes;
    }

    const syntheticEmail = usernameToEmail(normalized);

    // ==========================================
    // ACTION: REGISTER
    // ==========================================
    if (action === 'register') {
      // 1. Check existing username via indexed lookup (NEVER listUsers())
      const { data: existingMap, error: mapQueryErr } = await admin
        .from('username_accounts')
        .select('user_id')
        .eq('username', normalized)
        .maybeSingle();

      if (mapQueryErr) {
        return NextResponse.json(
          { success: false, error: '아이디 확인 중 데이터베이스 오류가 발생했습니다.' },
          { status: 500 }
        );
      }
      if (existingMap) {
        return NextResponse.json(
          { success: false, code: 'USERNAME_ALREADY_EXISTS', errorCode: 'USERNAME_ALREADY_EXISTS', error: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' },
          { status: 409 }
        );
      }

      // 2. Create Auth User in Supabase Auth (admin service_role)
      const { data: authCreated, error: createAuthErr } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password: rawPassword,
        email_confirm: true,
        user_metadata: {
          username: normalized,
          auth_type: 'username',
        },
      });

      if (createAuthErr || !authCreated?.user) {
        const msg = createAuthErr?.message || '';
        if (msg.includes('already registered') || msg.includes('already exists')) {
          return NextResponse.json(
            { success: false, code: 'USERNAME_ALREADY_EXISTS', errorCode: 'USERNAME_ALREADY_EXISTS', error: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { success: false, error: '계정 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 500 }
        );
      }

      const createdUserId = authCreated.user.id;

      // 3. Atomically Insert into username_accounts with foreign key & unique constraint
      const { error: insertMapErr } = await admin
        .from('username_accounts')
        .insert({
          username: normalized,
          user_id: createdUserId,
        });

      if (insertMapErr) {
        // Rollback created auth user to maintain strict 1:1 mapping consistency
        try {
          await admin.auth.admin.deleteUser(createdUserId);
        } catch (delErr) {
          console.error('Failed to rollback orphaned auth user after mapping error:', delErr);
        }
        if (insertMapErr.code === '23505') {
          return NextResponse.json(
            { success: false, code: 'USERNAME_ALREADY_EXISTS', errorCode: 'USERNAME_ALREADY_EXISTS', error: '이미 사용 중인 아이디입니다.' },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { success: false, error: '아이디 매핑 저장에 실패하여 계정 생성이 취소되었습니다. 다시 시도해 주세요.' },
          { status: 500 }
        );
      }

      // 4. Sign in to write secure session cookies
      const supabase = await createClient();
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: syntheticEmail,
        password: rawPassword,
      });

      if (signInErr || !signInData.session) {
        return NextResponse.json(
          { success: false, error: '가입은 완료되었으나 로그인 세션 생성에 실패했습니다. 아이디 로그인으로 다시 시도해 주세요.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        user: { id: createdUserId, username: normalized, email: syntheticEmail },
        session: signInData.session,
      });
    }

    // ==========================================
    // ACTION: LOGIN
    // ==========================================
    if (action === 'login') {
      // 1. Verify username existence in username_accounts
      const { data: accountRow, error: accountErr } = await admin
        .from('username_accounts')
        .select('user_id')
        .eq('username', normalized)
        .maybeSingle();

      if (accountErr || !accountRow) {
        return NextResponse.json(
          { success: false, code: 'INVALID_CREDENTIALS', errorCode: 'INVALID_CREDENTIALS', error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
          { status: 401 }
        );
      }

      // 2. Sign in with Supabase Auth using synthetic email and password
      const supabase = await createClient();
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: syntheticEmail,
        password: rawPassword,
      });

      if (signInErr || !signInData.session) {
        return NextResponse.json(
          { success: false, code: 'INVALID_CREDENTIALS', errorCode: 'INVALID_CREDENTIALS', error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        success: true,
        user: { id: signInData.user.id, username: normalized, email: syntheticEmail },
        session: signInData.session,
      });
    }

    return NextResponse.json({ success: false, error: '지원하지 않는 동작입니다.' }, { status: 400 });
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
