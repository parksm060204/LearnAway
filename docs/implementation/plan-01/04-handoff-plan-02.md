# LearnAway — Plan 02 인계 및 배포 준비 가이드 (Handoff to Plan 02)

## 1. 배포에 필요한 환경변수 목록

> [!CAUTION]
> 본 문서에는 환경변수의 **이름과 용도**만 기재하며, 실제 비밀값(Secret Key)은 절대 포함하지 않습니다.

| 환경변수 이름 | 필수 여부 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **필수** | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **필수** | Supabase 공개 익명 키 (클라이언트 인증용) |
| `SUPABASE_SERVICE_ROLE_KEY` | **필수** | Supabase 관리자 권한 키 (서버 전용, 클라이언트 노출 절대 금지) |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | **필수** | 사용자 개인 API 키 암호화용 32바이트 AES-256 키 (Base64) |
| `CRON_SECRET` | **필수** | Vercel Cron 엔드포인트 호출 인증용 비밀 토큰 |
| `BAZE_API_KEY` | 선택 (운영자) | 학교 BAZE AI Gateway 기본 운영자 키 |
| `BAZE_BASE_URL` | 선택 (운영자) | BAZE Gateway Base URL (기본값 설정됨) |
| `BAZE_MODEL` | 선택 (운영자) | 기본 모델 지정 (기본값: `deepseek-v4.1-flash`) |
| `PDF_CONVERT_SERVICE_URL` | 선택 | 외부 Python PyMuPDF4LLM 정밀 변환 마이크로서비스 URL |
| `PDF_CONVERT_SERVICE_TOKEN` | 선택 | 외부 변환 서비스 HMAC/Bearer 인증 토큰 |
| `GOOGLE_DRIVE_CLIENT_ID` | 선택 | Google Drive 백업용 OAuth 클라이언트 ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | 선택 | Google Drive 백업용 OAuth 클라이언트 Secret |
| `GOOGLE_DRIVE_ENCRYPTION_KEY` | 선택 | Google Drive OAuth 세션 토큰 AES 암호화 키 |

---

## 2. DB 마이그레이션 적용 순서

신규 DB 생성 시 또는 기존 DB 업그레이드 시 다음 순서로 적용합니다:

1. 기존 마이그레이션 `00` ~ `25`: 기존 스키마 및 기본 RPC 구성
2. **`20260101000026_harden_temp_pdf_and_fencing_tokens.sql`**:
   - `temp_pdf_conversion_jobs` RLS 강화 (일반 사용자 조작 차단)
   - 구형 7개 RPC 오버로드 삭제
   - 펜싱 토큰(`p_lease_token`) 필수화 및 엄격 상태 전이 제약
   - 원자적 임시 파일 만료 선점 RPC `claim_expired_temp_pdf_jobs` 생성
3. **`20260101000027_tiered_trial_credits_by_account_type.sql`**:
   - `get_or_create_trial_credits()` 계정 유형별 차등 지급 정책 적용
   - 게스트 계정(`username_accounts`): 1회 지급
   - 일반 가입 계정(Google/표준 이메일): 3회 지급
   - 기존 계정 잔액 보존 (`ON CONFLICT (user_id) DO NOTHING`)

적용 명령:
```bash
npx supabase db push
# 또는 Supabase 대시보드의 SQL Editor에서 26번, 27번 순차 실행
```

---

## 3. Vercel 배포 및 Cron 설정 가이드

### Vercel Hobby 플랜 제약사항
1. **Cron 스케줄 빈도**:
   - Vercel Hobby(무료) 플랜은 Cron 작업이 **하루 1회(Daily)** 로 제한됩니다 (예: `0 0 * * *`).
   - 15분 또는 매시간 스케줄(`*/15 * * * *`, `0 * * * *`)을 사용하려면 Vercel Pro 플랜을 사용하거나, 외부 스케줄러(GitHub Actions Scheduled Workflow, Cron-job.org 등)를 통해 `Authorization: Bearer <CRON_SECRET>` 헤더와 함께 GET 요청을 호출해야 합니다.
2. **서버리스 함수 실행 제한**:
   - Hobby 플랜의 최대 실행 시간은 10초(기본) ~ 최대 60초입니다.
   - 대용량 PDF 변환이나 청크 분석 작업 시 타임아웃을 고려하여 클라이언트 백오프 및 비동기 작업 패턴을 유지해야 합니다.
3. **HTTP 메서드**:
   - Vercel Cron은 오직 `GET` 요청만 전송하므로, 신규 엔드포인트 추가 시 반드시 `GET` 핸들러를 구성해야 합니다. (`/api/reminders/cron` 및 `/api/cron/cleanup-temp-pdf` 모두 GET 지원 완료)

### `vercel.json` 권장 설정
```json
{
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

## 4. 외부 PDF 정밀 변환 서비스 연결 가이드

- `PDF_CONVERT_SERVICE_URL`이 설정되지 않은 경우:
  - 시스템은 안전한 Fallback으로 전환되어 브라우저 내장 PDF.js(`이 기기에서 변환`)를 사용하도록 자동 안내하며 시스템 장애로 이어지지 않습니다.
- 외부 PyMuPDF4LLM 서비스를 연결할 경우:
  - HTTPS 주소와 일치하는 `PDF_CONVERT_SERVICE_TOKEN`을 반드시 설정하여 SSRF 및 비인가 변환을 방지해야 합니다.

---

## 5. 비용 및 크레딧 관리 주의사항

1. **신규 계정 가입 시 크레딧 남용 방지**:
   - `auth_rate_limits` 테이블을 통해 IP당 가입 횟수가 15분당 5회로 제한되어 있습니다.
2. **소진 시 운영자 AI 차단**:
   - 게스트는 1회, 일반 사용자는 3회가 소진되면 추가 운영자 AI 호출이 철저히 차단되며, 개인 API 키 등록을 요구합니다.
3. **AI 호출 예산 상한**:
   - `MAX_TRIAL_ANALYZE_CHUNKS = 2`, `MAX_TRIAL_OUTPUT_TOKENS = 16000`, `MAX_TRIAL_EXECUTION_TIMEOUT_MS = 40000` 상한이 서버단에서 강제됩니다.

---

## 6. Plan 02에서 해결 및 검증할 과제

1. **실제 Vercel 프로덕션 배포 및 도메인 바인딩**:
   - 커스텀 도메인 DNS 연결 및 SSL 인증서 프로비저닝.
2. **Google Cloud Console OAuth 승인된 리다이렉션 URI 등록**:
   - 실제 배포 URL (`https://<domain>/auth/callback`) 등록 및 실 기기 로그인 테스트.
3. **실제 Supabase Cloud 프로덕션 환경 마이그레이션 26, 27 적용 및 RLS 실서버 검증**.
4. **외부 Cron 스케줄러 연동 (Hobby 플랜 한계 보완 시)**:
   - 15분 주기 임시 파일 정리를 위한 GitHub Actions 워크플로 또는 외부 크론 서비스 등록 검토.
5. **E2E 브라우저 실제 시나리오 테스트**:
   - 모바일/데스크톱 브라우저 환경에서 실제 15MB PDF 업로드, 개념 분석, 시험 모드 풀이 전 과정 검증.
