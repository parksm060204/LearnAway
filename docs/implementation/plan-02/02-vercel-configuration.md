# LearnAway — Vercel 배포 환경 구성 및 런타임 명세서 (Vercel Configuration)

## 1. Vercel 프로젝트 기본 구성

- **프레임워크 프리셋**: `Next.js` (Next.js 16.3.6 App Router, Turbopack)
- **Node.js 런타임**: `Node.js 20.x` 또는 `22.x`
- **패키지 매니저**: `npm` (`npm ci` 권장)
- **빌드 명령어**: `npm run build`
- **출력 디렉터리**: `.next` (Next.js 기본값)

---

## 2. 서버리스 런타임 제약사항 및 최적화

| 항목 | Vercel Hobby 제약 | LearnAway 구현 및 대응 방식 |
|---|---|---|
| **최대 실행 시간 (Timeout)** | 기본 10~15초 (최대 60초) | 장기 실행 AI 및 백그라운드 API 라우트에 `export const maxDuration = 60;` 명시 적용 |
| **요청 본문 크기 (Payload)** | 최대 4.5MB | 대용량 PDF(최대 20MB)는 서버리스 Function을 직접 통과하지 않고 Supabase Storage로 사전 서명 직접 업로드 후 티켓 전달 |
| **Cron 스케줄 빈도** | 일 1회 (Daily) | `vercel.json`에 `0 0 * * *`, `0 1 * * *` 설정. 고빈도(시간별/15분) 스케줄링은 무료 GitHub Actions 러너 제공 |
| **파일시스템 상태** | Ephemeral (임시) | 파일시스템 지속성을 가정하지 않으며 모든 상태는 Supabase DB 및 클라이언트 IndexedDB에 보존 |
| **동적 라우트 캐싱** | 빌드 시 정적 최적화 시도 | DB/AI 의존 라우트에 `export const dynamic = 'force-dynamic';` 강제하여 빌드 시점 크래시 방지 |

---

## 3. 환경변수 전수 분류표

본 프로젝트의 환경변수는 **필수**, **선택**, **개발 전용** 3단계로 엄격히 구분됩니다:

### A. 필수 환경변수 (누락 시 서비스 접속 및 기본 동작 불가)

| 변수명 | 노출 범위 | 용도 및 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저 (Public) | Supabase 프로젝트 URL (예: `https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저 (Public) | Supabase 클라이언트 익명 키 (`NEXT_PUBLIC_SUPABASE_ANON_KEY` 호환) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 (Secret) | 서버 관리자 권한 키. RLS 우회하여 크레딧 예약, 선점 정리 등에 사용 |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | 서버 전용 (Secret) | 사용자 개인 API 키 암호화용 32바이트 AES-256-GCM 키 (Base64) |
| `CRON_SECRET` | 서버 전용 (Secret) | Cron 엔드포인트(`Authorization: Bearer <CRON_SECRET>`) 호출 인증 토큰 |

### B. 선택 환경변수 (누락 시 해당 부가 기능만 안전하게 비활성화)

| 변수명 | 노출 범위 | 용도 및 설명 |
|---|---|---|
| `AI_PROVIDER` | 서버 전용 (Secret) | 운영자 AI 공급자 선택 (`school_gateway`, `gemini`, `openai`, `deepseek`) |
| `BAZE_API_KEY` | 서버 전용 (Secret) | 학교 BAZE AI Gateway 운영자 API 키 |
| `BAZE_BASE_URL` | 서버 전용 (Secret) | BAZE Gateway 엔드포인트 URL (기본값 설정됨) |
| `BAZE_MODEL` | 서버 전용 (Secret) | 운영자 기본 모델 (`deepseek-v4.1-flash`) |
| `BAZE_MIN_OUTPUT_TOKENS` | 서버 전용 (Secret) | 추론 모델 최소 토큰 할당 (기본값: `16000`) |
| `AI_ALLOW_OPERATOR_FALLBACK`| 서버 전용 (Secret) | 개인키 미등록 시 운영자 키 사용 허용 여부 (`true`/`false`) |
| `OPERATOR_EMERGENCY_STOP` | 서버 전용 (Secret) | 긴급 운영자 AI 호출 중지 스위치 (`true` 시 즉시 차단) |
| `PDF_CONVERT_SERVICE_URL` | 서버 전용 (Secret) | 외부 Python PyMuPDF4LLM 서비스 URL (미설정 시 브라우저 PDF.js 엔진 사용) |
| `PDF_CONVERT_SERVICE_TOKEN`| 서버 전용 (Secret) | 외부 Python 서비스 인증용 HMAC 공유 토큰 |
| `GOOGLE_DRIVE_CLIENT_ID` | 서버 전용 (Secret) | Google Drive OAuth 2.0 클라이언트 ID |
| `GOOGLE_DRIVE_CLIENT_SECRET`| 서버 전용 (Secret) | Google Drive OAuth 2.0 클라이언트 시크릿 |
| `GOOGLE_DRIVE_REDIRECT_URI` | 서버 전용 (Secret) | Google Drive 콜백 URL (`https://<domain>/api/drive/callback`) |
| `GOOGLE_DRIVE_ENCRYPTION_KEY`| 서버 전용 (Secret) | Drive 세션 토큰 AES 암호화 키 (미설정 시 AI 키 재사용) |
| `NOTIFICATION_WEBHOOK_URL` | 서버 전용 (Secret) | 복습 알림 발송용 외부 웹훅 주소 (Slack, Discord, 사내 게이트웨이) |

### C. 개발 전용 환경변수 (운영 배포 시 절대 설정 금지)

| 변수명 | 설명 및 주의사항 |
|---|---|
| `NODE_ENV=development` | 로컬 개발 모드 전용. Next.js 빌드 시 프로덕션 번들에 불필요한 디버그 코드 포함 방지 |

---

## 4. `vercel.json` 구성 파일

Vercel Hobby 배포를 위한 `vercel.json` 파일 명세:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/reminders/cron",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/cleanup-temp-pdf",
      "schedule": "0 1 * * *"
    }
  ]
}
```

---

## 5. Preview 및 Production 환경 분리 가이드

1. **Vercel Environment Variables Scope**:
   - `Production`: 운영 도메인 바인딩, 운영 Supabase 인스턴스, 정식 OAuth Client ID.
   - `Preview`: PR 배포용, 테스트용 Supabase 프로젝트 분리 권장, 브랜치별 프리뷰 URL 자동 생성.
2. **보안 및 오류 로깅**:
   - API 라우트는 예외 발생 시 원시 데이터베이스 에러 객체나 내부 스택 트레이스를 클라이언트에 직접 노출하지 않고 규격화된 한글 메시지와 `errorCode`를 반환합니다.
   - `proxy.ts` (Next.js 16 미들웨어)는 정적 에셋을 제외한 모든 경로의 세션 쿠키를 갱신하며, 비인가 사용자의 내부 페이지 접근을 `/login?next=...`로 차단합니다.
