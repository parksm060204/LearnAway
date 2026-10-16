# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-16 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `9c3bc02b5ae0c515707096e029f716f12061eed3`
- 현재 작업 기준 HEAD SHA: `9c3bc02b5ae0c515707096e029f716f12061eed3`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **303 passed** (기존 298건 + 이전 P1 3건 + 신규 3대 문제 2건 추가, 0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings**
  - `npm run build`: **Compiled successfully** (Next.js 16.3.6 Turbopack 프로덕션 빌드 완료, 12개 정적·동적 라우트 정상 생성)

---

## 1. 3대 핵심 결함 원인·수정 및 검증 내역

본 문서는 테스트 통과만으로 실제 배포 환경에서의 완전 무결성을 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 기능 코드와 신규 마이그레이션이 작성됨
2. **로컬/Mock 검증 완료**: 실제 라우트 핸들러, 독립 DB 모의 트랜잭션, 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 브라우저 환경에서 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라 배포 및 운영 크리덴셜 설정이 필요한 항목

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|---|
| **P1** | **IndexedDB 복구 데이터 읽기 실패 시 원본 삭제** | `getLegacyV1RecordsIfAny`에서 `getAll` 오류/예외 시 `null`을 반환하여 정상적인 "이관 대상 없음"으로 간주되고 기존 `recoveries` 저장소가 삭제됨. 또한 사전 읽기와 버전 업그레이드가 별개 트랜잭션으로 분리되어 동시 탭 변경 누락 위험 존재. | - DB 버전을 `v4`로 승격하고 외부 사전 읽기(`getLegacyV1RecordsIfAny`) 제거<br>- `onupgradeneeded` 내부 단일 `versionchange` 트랜잭션 안에서 기존 레코드 읽기·변환·새 구조 저장을 일괄 처리<br>- 읽기/변환/저장 실패 시 즉각 `tx.abort()` 호출하여 기존 버전·데이터 100% 롤백 보존<br>- 필수 식별자가 누락된 불완전 레코드는 임의 값 생성 없이 `recoveries_unmigrated` 저장소에 원본 격리 보존<br>- 타 탭 점유 시 `onblocked` 처리 및 안내/재시도 제공, 모든 연결에 `onversionchange` 자동 닫기 처리<br>- 복구 UI(`ConceptReviewModal`, `DashboardClient`)에 미이관 레코드 건수 표시 및 JSON 백업 내보내기 연결 ("과거 삭제 데이터 복구 불가" 고지) | **IndexedDB v1->v4 인-트랜잭션 이관, 읽기 실패 시 원본 보존, abort 롤백, 차단 안내 회귀 검증 완료** |
| **P2** | **분석 작업 동시 초기화의 기본키 충돌** | 마이그레이션 19의 RPC가 `SELECT`로 작업 부재를 확인한 뒤 일반 `INSERT`를 실행하여, 동일 작업에 대한 독립 세션 동시 요청 시 모두 부재로 확인 후 기본키 중복 에러 발생. 청크 `ON CONFLICT`만으로 작업 자체의 경쟁 조건 미해결. | - 배포된 마이그레이션 19를 수정하지 않고 후속 **마이그레이션 20** (`20260101000020_concurrency_and_subject_ownership.sql`) 추가<br>- `INSERT ... ON CONFLICT (id) DO NOTHING` 후 기존 행을 안전하게 조회하는 멱등적 구조로 개선<br>- 단순 충돌 무시가 아닌 엄격한 작업 정체성 검증 (`userId`, `subjectId`, `materialId`, `markdownHash`, `domain`, `modelId`, `promptVersion`, `chunkingVersion`, `totalChunks`), 불일치 시 `JOB_IDENTITY_MISMATCH` 거부<br>- 기존 완료 결과, drafts, lease, attemptCount, paused 상태 완전 보존<br>- 초기화 도중 청크 생성 실패 시 신규 작업 원자적 롤백<br>- 일반 사용자 직접 실행 차단 및 `service_role` 제한 유지 | **독립 2개 동시 연결 단일 작업 반환, 기본키 충돌 없음, 정체성 불일치 거부, 완료 상태 보존 회귀 검증 완료** |
| **P1** | **로컬 전용 자료에서 과목 소유권 검증 누락** | 서버에 자료 행이 없으면 로컬 전용 자료로 허용하지만, 클라이언트가 전달한 `subjectId`가 로그인 사용자의 소유인지 별도로 확인하지 않아 타인 과목에 분석 작업이 생성될 위험 존재. | - `app/api/analyze-concepts/route.ts` 및 마이그레이션 20에서 `public.subjects` 소유권(`id = subjectId AND user_id = auth.user.id`) 필수 사전 검증<br>- 타인 과목 및 부재 과목은 작업 생성·청크 생성·AI 호출 전 404 `NOT_FOUND_OR_FORBIDDEN`으로 즉각 차단 (타인 과목 실존 여부 노출 방지)<br>- 서버 자료 존재 시 자료 소유권과 과목 일치(`subject_id`) 추가 검증 (불일치 시 400 `SUBJECT_MISMATCH`)<br>- DB 쿼리 오류 발생 시 로컬 자료로 오판하지 않고 500 `DB_QUERY_ERROR`로 즉시 중단<br>- 검증을 위해 사용자의 개인 Markdown 본문을 서버에 강제 업로드하지 않음 | **내 과목+로컬 자료 정상 초기화, 타인 과목 차단, 존재하지 않는 과목 404, 과목 불일치 400, DB 오류 500 회귀 검증 완료** |

---

## 2. 변경 파일 및 신규 마이그레이션 내역

### 1) 신규 DB 마이그레이션
- `supabase/migrations/20260101000020_concurrency_and_subject_ownership.sql` (신규):
  - 마이그레이션 19의 `init_analysis_job_and_chunks` RPC를 안전하게 대체 (후속 마이그레이션).
  - `p_user_id` 필수 검증.
  - `public.subjects`에서 `id = p_subject_id AND user_id = p_user_id` 검증 (실패 시 `NOT_FOUND_OR_FORBIDDEN`).
  - `public.materials` 존재 시 `user_id` 및 `subject_id` 일치 검증 (`FORBIDDEN`, `SUBJECT_MISMATCH`).
  - `INSERT INTO public.analysis_jobs ... ON CONFLICT (id) DO NOTHING`으로 기본키 충돌 제거.
  - 기존 작업 조회 후 엄격한 정체성 대조 (불일치 시 `JOB_IDENTITY_MISMATCH`).
  - 기존 청크 상태 유지 및 신규 청크 일괄 삽입.
  - 실행 권한을 `service_role` 전용으로 제한 (`REVOKE ALL ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role`).

### 2) 서버 API 라우트
- `app/api/analyze-concepts/route.ts`:
  - `POST` 진입부에서 `subjectId` 소유권 조회 (`supabaseClient.from('subjects').select('id').eq('id', subjectId).eq('user_id', auth.user.id).maybeSingle()`).
  - 쿼리 에러 시 500 `DB_QUERY_ERROR`, 미존재/타인 소유 시 404 `NOT_FOUND_OR_FORBIDDEN` 즉시 반환.
  - 서버 자료 존재 시 `user_id` 및 `subject_id` 대조. 로컬 전용 자료는 과목 검증 통과 시 안전하게 허용.
  - `syncJobToSupabase`에서 `init_analysis_job_and_chunks` RPC의 `JOB_IDENTITY_MISMATCH` 및 오류 코드 전파.

### 3) 클라이언트 복구 저장소 및 화면
- `lib/analysisRecovery.ts`:
  - DB 버전 `v4` 승격.
  - 외부 사전 읽기 `getLegacyV1RecordsIfAny` 제거.
  - `onupgradeneeded` 내부 단일 `versionchange` 트랜잭션 안에서 읽기/변환/쓰기를 수행하며, 오류 시 `tx.abort()`로 원본 보존.
  - 필수 키 결손 레코드는 `recoveries_unmigrated`로 격리 보존.
  - `openRecoveryDb`에 `req.onblocked` 처리 추가 (타 탭 점유 시 차단 안내 반환).
  - 모든 연결에 `db.onversionchange = () => db.close()` 추가하여 타 탭의 업그레이드 차단 방지.
  - `exportUnmigratedRecoveriesAsJson` 유틸리티 추가 및 내보내기 지원.
- `components/ConceptReviewModal.tsx`:
  - 미이관 레코드 건수 배너 및 JSON 백업 다운로드 버튼 제공.
  - "(참고: 과거에 이미 삭제되었던 데이터는 복구할 수 없습니다)" 안내 문구 표시.
- `app/DashboardClient.tsx`:
  - 개념 검토 모달 열림 시 `listUnmigratedAnalysisRecoveries` 비동기 조회.
  - 미이관 레코드 수 및 백업 내보내기 핸들러 바인딩.

### 4) 회귀 검증 스위트
- `scripts/test-regressions.mjs`:
  - `createFakeIndexedDB`: `notifyPending` 비동기 요청 추적, `failure.blocked` 차단 시뮬레이션, `tx.abort()` 시 스토어 롤백 구현.
  - `createFakeSupabase`: 마이그레이션 20 RPC 로직 시뮬레이션 (과목 소유권, `ON CONFLICT DO NOTHING`, 정체성 검증, 청크 롤백), 커스텀 테이블 참조 배열 보존.
  - 신규 검증 시나리오 2건 추가:
    1. P2 동시성: 2개 독립 요청 동시 초기화 -> 단일 작업/단일 청크 생성, 동일 작업키 반환, 정체성 불일치 시 `JOB_IDENTITY_MISMATCH`, 완료 청크 보존, 청크 실패 시 롤백.
    2. P1 과목 소유권: 내 과목+로컬 자료 성공, 타인 과목 차단, 미존재 과목 차단, 과목 불일치 차단, DB 쿼리 오류 차단, 본문 미업로드 검증.
  - 총 303개 검사 100% 통과.

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **303개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (Next.js 16.3.6)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **IndexedDB v4 인-트랜잭션 이관 (P1)** | **통과**: v1 스키마 생성 후 v4 업그레이드 시뮬레이션, 읽기 실패 시 abort 후 v1 보존 확인, 불완전 레코드 격리 확인, onblocked 차단 감지 확인 | **IndexedDB 모듈 검증 완료** | 브라우저 쿠키/스토리지 차단 설정 여부 확인 |
| **분석 동시 초기화 기본키 충돌 방지 (P2)** | **통과**: 독립 2개 동시 연결 단일 작업 생성 확인, `ON CONFLICT DO NOTHING` 멱등성 확인, 식별 정보 불일치 시 `JOB_IDENTITY_MISMATCH` 거부 확인, 기존 완료 상태 보존 확인 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 20 배포 대기 | `supabase db push` (마이그레이션 20 적용) 및 `SUPABASE_SERVICE_ROLE_KEY` 설정 |
| **로컬 자료 과목 소유권 검증 (P1)** | **통과**: 내 과목+로컬 자료 허용, 타인 과목 404 차단, 부재 과목 404 차단, 자료-과목 불일치 400 차단, DB 조회 에러 500 차단 확인 | **Route Handler 검증 완료** | 운영 Supabase RLS 및 사용자 세션 정상 작동 확인 |

---

## 4. 운영 환경 마이그레이션 적용 순서

운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql`
5. `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql`
6. `supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql`
7. `supabase/migrations/20260101000019_init_analysis_job_and_chunks.sql` (최초 원자적 초기화 RPC)
8. `supabase/migrations/20260101000020_concurrency_and_subject_ownership.sql` (신규: 동시성 기본키 충돌 방지 및 과목 소유권 강화 후속 마이그레이션)

### 필수 환경 변수
- `SUPABASE_SERVICE_ROLE_KEY`: 청크 선점, 결과 커밋, 원자적 초기화 RPC(`init_analysis_job_and_chunks`) 실행에 필수 (미설정 시 AI 호출 없이 500 에러)
- `ANALYSIS_RECOVERY_SIGNING_SECRET`: 복구 토큰 HMAC-SHA256 서명용 전용 비밀키 (미설정 시 `SUPABASE_SERVICE_ROLE_KEY`로 대체)
- `CRON_SECRET`: 복습 알림 스케줄러 인증용 비밀키
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 API 키 대칭 암호화 키

