# 인증(Google 로그인) 외부 설정 가이드

이 문서는 Learn my way의 Supabase 인증 / Google 로그인을 실제로 켜기 위해
**사용자가 외부 콘솔에서 설정해야 하는 항목**과, 로컬 데이터와 서버 데이터의
차이를 설명합니다. 외부 설정을 완료하지 않았다면 "로그인 연결 완료"로 보고하지
않습니다.

> 비밀키(Client Secret, service_role key 등)는 코드/문서/채팅에 기록하지 마세요.

---

## 1. 인증 흐름 요약

```
[브라우저] Google로 로그인 클릭
    └─ supabase.auth.signInWithOAuth({ provider: 'google' })
        └─ Supabase Auth → Google 동의 화면
            └─ Google → Supabase 공급자 콜백
                └─ Supabase → 앱의 /auth/callback?code=...
                    └─ exchangeCodeForSession(code) 로 세션 쿠키 발급
                        └─ /(대시보드)로 이동
```

- 세션 갱신은 루트 `proxy.ts`가 담당합니다(Next.js 16에서는 기존 middleware가
  proxy로 이름이 바뀌었습니다).
- 페이지/서버 컴포넌트/Route Handler는 모두 서버에서 세션을 다시 검증합니다.
- AI API(`/api/analyze-concepts`, `/api/generate-problems`, `/api/evaluate-answer`,
  `/api/logic-questions`, `/api/review-problem-quality`, `/api/transfer-problem`)는
  미인증 요청에 `401`을 반환합니다.

---

## 2. 환경변수

`.env.local` (커밋 금지) 에 아래 값을 설정합니다. 이름만 `.env.example`에 기록되어
있습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- 위치: Supabase Dashboard → Project Settings → **API** → Project URL /
  Publishable key
- `service_role` / secret 키는 절대 `NEXT_PUBLIC_*`로 두지 마세요.
- 두 값 중 하나라도 없으면 대시보드와 `/login`에 설정 안내가 표시됩니다.
  무한 로딩이나 데모 데이터로 대체하지 않습니다.
- 값을 바꾼 뒤에는 개발 서버를 재시작하세요(공개 변수는 빌드 시 주입됨).

선택: 리버스 프록시/터널 뒤에서 OAuth가 잘못된 호스트로 돌아오면
`NEXT_PUBLIC_SITE_URL`로 외부 기준 URL을 지정할 수 있습니다.

---

## 3. Supabase 프로젝트 설정

1. Supabase Dashboard → **Authentication → Providers → Google**을 엽니다.
2. **Enable Sign in with Google**을 켭니다.
3. Google Cloud에서 발급받은 **Client ID**와 **Client Secret**을 입력합니다.
   - 여러 플랫폼용 Client ID가 있으면 웹용을 **맨 앞**에 두고 쉼표로 구분합니다.
4. 같은 화면에 표시되는 **Supabase 공급자 콜백(Callback) URL**을 복사해 둡니다.
   - 예: `https://<project-ref>.supabase.co/auth/v1/callback`

### 반드시 구분할 것

| 항목 | 값 | 설정 위치 |
| --- | --- | --- |
| **Supabase 공급자 콜백** | `https://<project-ref>.supabase.co/auth/v1/callback` | Google Cloud의 Authorized redirect URI |
| **앱 콜백** | `https://<your-domain>/auth/callback` | Supabase의 Redirect URLs (허용 목록) |

Google은 **Supabase 콜백**으로 돌아오고, Supabase는 다시 **앱의 `/auth/callback`**
으로 돌아옵니다. 두 주소를 혼동하면 `redirect_uri_mismatch`가 발생합니다.

---

## 4. Google Cloud 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를
   선택/생성합니다.
2. **Google Auth Platform**(또는 APIs & Services → Credentials)에서 동의 화면
   (Branding / Audience / Scopes)을 구성합니다.
   - 필요 스코프: `openid`, `.../userinfo.email`, `.../userinfo.profile`
3. **OAuth client ID 만들기 → Web application**을 선택합니다.
4. **Authorized JavaScript origins** 에 앱의 origin을 추가합니다.
   - 로컬: `http://localhost:3000`
   - 배포: `https://<your-domain>`
5. **Authorized redirect URIs** 에 **Supabase 공급자 콜백**을 추가합니다.
   - 로컬 Supabase를 쓰는 경우: `http://127.0.0.1:54321/auth/v1/callback`
   - 호스팅 Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
6. 생성된 **Client ID / Client Secret**을 Supabase의 Google 공급자 설정에 넣습니다.

---

## 5. 앱 URL / Redirect URL 허용 목록 (Supabase)

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: 기본 배포 주소 (예: `https://<your-domain>`)
- **Redirect URLs** (허용 목록)에 아래를 추가합니다.
  - 로컬: `http://localhost:3000/auth/callback`
  - 배포: `https://<your-domain>/auth/callback`

앱은 `signInWithOAuth`의 `redirectTo`로 `<origin>/auth/callback?next=...`를
전달합니다. `next`는 내부 경로만 허용되며 외부 URL/프로토콜 상대 경로는
무시됩니다(`lib/auth/redirects.ts`).

---

## 6. 로컬 개발 체크리스트

1. 위 환경변수를 `.env.local`에 설정합니다.
2. Supabase와 Google Cloud의 주소를 로컬 주소로 등록합니다.
3. `npm run dev` 실행 후 `http://localhost:3000` 접속 → 자동으로 `/login` 이동.
4. Google로 로그인 → 성공 시 대시보드(`/`)로 이동.
5. 새로고침해도 로그인 유지, 로그아웃 후 보호 경로 접근 시 다시 `/login`.

---

## 7. 로컬 데이터 분리 vs 서버 저장 (중요)

이번 단계에서 로그인은 **인증만** 담당합니다. 기존 학습 데이터(자료/답안/복습
기록)는 여전히 **브라우저 로컬**에 있습니다.

- localStorage: `redcall_*` (기존 공용/legacy 키)
- IndexedDB: `redcall_materials_db` (자료 본문)
- 로그인 후에는 계정별 네임스페이스로 분리됩니다.
  - localStorage 키: `redcall_user_<userId>__<base>`
  - IndexedDB DB: `redcall_materials_db_u_<userId>`
- 로그인/로그아웃 시 **기존 로컬 기록을 자동으로 삭제하거나 계정에 귀속하지
  않습니다.**
- 기존 기록이 있고 아직 가져오지 않았다면 대시보드에
  "기존 학습 기록 가져오기" 안내가 표시됩니다.
  - 가져오기는 명시적 선택으로만 실행됩니다.
  - 이미 값이 있는 계정 키는 덮어쓰지 않으며, 재시도해도 중복되지 않습니다.
  - 검증에 성공한 뒤에만 완료 표시를 기록합니다.
  - 기존 공용 기록은 그대로 보존됩니다.
- 다른 계정으로 로그인하면 이전 계정 키가 보이지 않습니다.

> **로컬 계정 분리 ≠ 서버 저장**
>
> - 로컬 분리는 같은 브라우저 안에서 계정별로 기록을 섞지 않을 뿐입니다.
> - 브라우저 캐시를 지우거나 다른 기기를 쓰면 기록은 따라가지 않습니다.
> - 서버(DB) 저장과 사용자별 RLS는 이번 단계 범위에 포함되지 않습니다.
> - 향후 DB 저장을 도입할 때 사용자 소유권은 **서버 인증 정보**(JWT `sub`)로
>   결정하고 RLS로 접근을 제어해야 합니다. UI 로그인 여부만으로 보호하지
>   않습니다.

---

## 8. 익명(anonymous) Supabase 사용자 연결 (향후)

현재는 익명 Supabase 사용자를 만들지 않으므로 즉시 처리할 항목은 없습니다.
향후 오프라인/익명 세션을 먼저 만들고 나중에 Google을 연결하는 흐름을 도입할
경우:

- 같은 Supabase 사용자 ID를 유지하려면 `linkIdentity`로 Google을 **연결**해야
  새 사용자로 분리되지 않습니다.
- 연결 전에 로컬 기록의 소유자(익명 user id)와 가져오기 상태를 함께 기록해,
  연결 후에도 동일 user id 네임스페이스를 그대로 사용하도록 마이그레이션해야
  합니다.

---

## 9. 검증 명령

```bash
npm run test:regressions   # 인증 게이트(/401), 리다이렉트 안전성, 가져오기 멱등성
npm run lint
npm run build
```

실제 Google OAuth는 외부 콘솔 설정과 브라우저 상호작용이 필요하므로, 자동
테스트는 목(mock) 인증 결과입니다. 실제 로그인 왕복 검증은 위 6장 체크리스트로
수행합니다.