# LearnAway — Supabase 연동 및 보안 검증 보고서 (Supabase Integration)

## 1. 인증 체계 (Authentication)

LearnAway는 Supabase Auth를 기반으로 두 가지 로그인 방식을 제공합니다:

1. **표준 Google OAuth 2.0 로그인**:
   - 일반 사용자 계정으로 분류되며, 최초 가입 시 **3회의 AI 체험 크레딧**이 부여됩니다.
   - 콜백 경로: `/auth/callback` (PKCE 인증 코드 교환 후 세션 쿠키 수립).
2. **간편 아이디 회원가입 및 로그인 (`/api/auth/username`)**:
   - 대학생들의 빠른 접근을 위한 익명/게스트 형태의 아이디 기반 인증.
   - 내부 가상 이메일(`{username}@id.learnaway.local`)로 Supabase Auth에 매핑.
   - `username_accounts` 테이블에 영속화되며 최초 가입 시 **1회의 AI 체험 크레딧**이 부여됩니다.
   - 브루트포스 방지를 위해 `auth_rate_limits` 테이블 기반 15분당 5회 IP 제한 적용.
3. **공용 게스트 로그인 폐기 (`/api/guest-login`)**:
   - 과거 세션 공유 보안 결함이 있던 공용 비밀번호 게스트 API는 완전히 폐기되었으며, 호출 시 `410 GUEST_LOGIN_DEPRECATED`를 반환합니다.
4. **세션 유지 및 자동 갱신 (`proxy.ts`)**:
   - Next.js 16 Proxy 미들웨어에서 `@supabase/ssr`의 `createServerClient`를 활용하여 모든 보호 경로 접근 시 세션 쿠키를 자동 갱신합니다.

---

## 2. 데이터베이스 및 사용자 격리 (RLS & Ownership)

모든 사용자 데이터 테이블에는 PostgreSQL Row Level Security (RLS)가 적용되어 타 사용자의 데이터 침범을 원천 차단합니다:

| 테이블명 | RLS 정책 요약 | 타 사용자 조작 시 동작 |
|---|---|---|
| `subjects` | `auth.uid() = user_id` 조건으로 SELECT, INSERT, UPDATE, DELETE 제한 | 조회 시 0건, 타인 과목 수정 시 0건 갱신 |
| `study_materials` | `auth.uid() = user_id` 및 본인 소유 과목 외래키 검증 | 타인 과목에 자료 등록 거부, 타인 자료 조회 차단 |
| `concepts` / `concept_drafts` | 소유 자료 기반 RLS 및 작업 정체성 검증 | 타 사용자 접근 불가 |
| `generated_problems` | `auth.uid() = user_id` 및 본인 개념 연동 | 타인 문제 풀이 조회 및 채점 불가 |
| `practice_attempts` | 풀이 제출 시 본인 검증 및 과거 채점 결과 불변성 보존 | 스냅샷 보존으로 타인 접근 차단 |
| `study_plan_items` | 학습 일정 RLS 격리 | 타인 계획 조회/완료 처리 불가 |

### 교차 사용자 ID 전달 시 보안 검증
- `init_analysis_job_and_chunks` RPC 테스트 결과, 타인의 `subject_id` 또는 `material_id`를 강제로 전달하더라도 DB RPC 레벨에서 `NOT_FOUND_OR_FORBIDDEN` 에러를 반환하며 작업 생성이 즉각 차단됨을 확인했습니다 (`P02-03`).

---

## 3. Storage 스토리지 및 임시 파일 수명주기

- **임시 변환 버킷**: `temp-pdf-conversions`
- **파일 크기 제한**: 20MB (`MAX_UPLOAD_BYTES = 20 * 1024 * 1024`)
- **형식 검증**: 파일 확장자뿐만 아니라 바이트 레벨의 매직 바이트(`%PDF-`) 및 텍스트 포함 여부를 검증.
- **격리 경로**: `{user_id}/temp-convert/{job_id}/{filename}` 경로로 저장되어 다른 사용자의 경로를 덮어쓰거나 접근할 수 없음.
- **원자적 수명주기 정리 파이프라인**:
  1. 변환 완료/실패 시 `claim_temp_pdf_cleanup_by_converter`를 호출하여 DB에서 `status='cleaning'` 및 cleanup 전용 토큰을 먼저 선점.
  2. 선점에 성공한 변환 프로세스만 `supabase.storage.remove()` 실행.
  3. 지연/만료된 오래된 작업자는 Storage 삭제 권한을 획득하지 못해 원천 차단됨 (`P2-04`).
  4. 만료된 고아 파일은 Cron 스케줄러(`claim_expired_temp_pdf_jobs` 및 `finalize_temp_pdf_cleanup`)가 주기적으로 안전하게 회수.

---

## 4. 마이그레이션 적용 및 함수 권한 (SECURITY DEFINER)

- **마이그레이션 26**: 펜싱 토큰(`p_lease_token`) 필수화 및 허위 함수 REVOKE 배제.
- **마이그레이션 27**: 계정 유형별 차등 크레딧 지급 (`updated_at` 누락 컬럼 수정 완료).
- **마이그레이션 28**: 후속 증분 마이그레이션으로 기존 27까지 적용된 DB를 최신 스키마 및 원자적 cleanup RPC로 안전 갱신.
- **RPC 실행 권한**:
  - `get_or_create_trial_credits`: `authenticated` 허용 (본인 조회).
  - `reserve_trial_credit`, `settle_trial_credit`, `release_trial_credit`, `record_trial_result_ready`: **`service_role` 전용 격리** (일반 사용자의 직접 RPC 호출 차단).
  - `claim_expired_temp_pdf_jobs`, `claim_temp_pdf_cleanup_by_converter`, `finalize_temp_pdf_cleanup`: **`service_role` 전용 격리**.
