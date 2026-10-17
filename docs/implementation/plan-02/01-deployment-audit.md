# LearnAway — Plan 02 배포 호환성 및 감사 보고서 (Deployment Audit)

## 1. 개요 및 감사 기준

- **대상 저장소**: `parksm060204/LearnAway`
- **작업 브랜치**: `feat/plan-02-vercel-beta`
- **기준 커밋 (Base HEAD)**: `4bcf71a26edf74920d0784e90c0b0ee7cae13942`
- **안정화 커밋**: `1acf2d4` (`fix(stabilization): resolve trial credit schema mismatch and enforce storage cleanup lease atomicity`)
- **목적**: 대학 강의자료 기반 AI 학습 플랫폼 LearnAway의 Vercel Hobby 환경 베타 배포 준비 및 종합 검증

---

## 2. Plan 01 결과 검증 및 보안 감사

Plan 01에서 식별 및 해결된 4대 핵심 과제가 작업 브랜치에 안전하게 반영되었는지 확인했습니다:

1. **AI 체험 크레딧 SQL 오류 (`42703 undefined_column`) 해결**:
   - `ai_trial_reservations` 테이블에 존재하지 않는 `updated_at` 컬럼 INSERT 제거.
   - 후속 마이그레이션 `20260101000028_catchup_stabilization_and_cleanup_atomicity.sql`을 통해 `updated_at` 컬럼 안전 추가.
2. **기존 운영 DB용 후속 마이그레이션 28 작성**:
   - 이미 27번까지 적용된 DB에 대해 멱등적(`IF NOT EXISTS`, `CREATE OR REPLACE`) DDL 및 RPC 동기화 완료.
   - 구형 오버로드 함수 4종(`reserve_trial_credit` 등)을 안전하게 정리.
3. **Cron의 모든 종료 경로에 실행 토큰 검증 적용**:
   - `app/api/cron/cleanup-temp-pdf/route.ts`의 성공(`cleaned`), 실패(`failed`), 격리(`quarantined`) 모든 경로에 `job_id + lease_token + status='cleaning'` 조건부 원자적 검증 적용.
4. **오래된 변환 작업의 Storage 파일 삭제 원천 차단**:
   - `app/api/convert/route.ts`에서 Storage 파일 삭제 전 DB 선점 RPC(`claim_temp_pdf_cleanup_by_converter`)를 거치도록 분리하여 임대 만료된 작업자의 교차 파일 삭제 차단.

---

## 3. Vercel 배포 환경에서 발견된 문제와 조치

### 3.1. 서버리스 함수 실행 시간 제한 (Timeout)
- **문제**: Vercel Hobby 플랜에서 Serverless Function의 기본 실행 시간은 10~15초입니다. 그러나 DeepSeek-v4.1-flash 기반의 대학 시험 문제 생성 및 논술 답안 평가는 복합 추론으로 인해 20~35초가 소요되며, 서버 설정 상한(`MAX_TRIAL_EXECUTION_TIMEOUT_MS = 40000`)에 도달하기 전 Vercel 게이트웨이 타임아웃(`504 GATEWAY_TIMEOUT`)이 발생할 위험이 있었습니다.
- **조치**:
  - `app/api/analyze-concepts/route.ts`
  - `app/api/generate-problems/route.ts`
  - `app/api/evaluate-answer/route.ts`
  - `app/api/convert/route.ts`
  - `app/api/cron/cleanup-temp-pdf/route.ts`
  - `app/api/reminders/cron/route.ts`
  - `app/api/reminders/dispatch/route.ts`
  - `app/api/drive/upload/route.ts`
  - `app/api/review-problem-quality/route.ts`
  - `app/api/transfer-problem/route.ts`
  - `app/api/logic-questions/route.ts`
  위 모든 동적 라우트에 `export const dynamic = 'force-dynamic';`과 `export const maxDuration = 60;`을 선언하여 Vercel Hobby의 최대 지원 타임아웃인 60초를 확보했습니다.

### 3.2. Vercel Hobby 플랜 Cron 빈도 제한
- **문제**: Vercel Hobby 플랜은 `vercel.json`에 분 단위 또는 시간 단위 크론(`*/15 * * * *`, `0 * * * *`)이 포함될 경우 배포 빌드 단계에서 오류를 발생시킵니다 (Hobby는 일 1회 Daily Cron만 지원).
- **조치**:
  - `vercel.json`에 Hobby 호환 일일 크론(`0 0 * * *`, `0 1 * * *`)을 구성.
  - 시간별 알림 및 15분 주기 임시 파일 정리를 원하는 운영자를 위해 완전 무료인 GitHub Actions 스케줄러 워크플로(`.github/workflows/cron-scheduler.yml`)를 추가 제공.

### 3.3. 서버리스 파일시스템 비영속성 대응
- **문제**: Vercel 서버리스 컨테이너는 요청 종료 시 소멸하므로 로컬 파일 저장소나 메모리 캐시를 영속적 저장소로 사용할 수 없습니다.
- **조치**:
  - 모든 사용자 학습 데이터는 Supabase DB 및 IndexedDB(클라이언트 로컬 원본)에 영속화.
  - 대용량 PDF는 서버리스 메모리를 거치지 않고 Supabase Storage 임시 버킷(`temp-pdf-conversions`)에 클라이언트 직접 서명 업로드 후 티켓 기반으로 처리.

---

## 4. 잔여 위험 및 배포 전 점검사항

1. **Google OAuth 승인된 리다이렉션 URI**:
   - Vercel Preview/Production 배포 URL (`https://<domain>/auth/callback`, `https://<domain>/api/drive/callback`)이 Google Cloud Console에 등록되어야 실서버 OAuth가 정상 동작합니다.
2. **Supabase Migration 28 적용**:
   - 운영 Supabase Cloud DB에 `20260101000028_catchup_stabilization_and_cleanup_atomicity.sql`이 적용되어야 최신 RPC 선점 함수가 호출 가능합니다.
3. **운영자 AI 키 및 암호화 키 주입**:
   - Vercel 대시보드 환경변수에 `BAZE_API_KEY` 및 `AI_CREDENTIAL_ENCRYPTION_KEY`가 필수로 등록되어야 합니다.
