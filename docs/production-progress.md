# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-16 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `bc891ec80487ce3a1cde93476c3acf1f153046e9`
- 현재 작업 기준 HEAD SHA: `bc891ec80487ce3a1cde93476c3acf1f153046e9`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **301 passed** (기존 298건 + 신규 3대 P1 결함 검증 3건 포함, 0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings**
  - `npm run build`: **Compiled successfully** (Next.js 16.3.6 Turbopack 프로덕션 빌드 완료, 정적 및 동적 라우트 정상 생성)

---

## 1. 3대 P1 핵심 결함 원인·수정 및 검증 내역

본 문서는 테스트 통과만으로 실제 배포 환경에서의 완전 무결성을 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 기능 코드와 신규 마이그레이션이 작성됨
2. **로컬/Mock 검증 완료**: 실제 라우트 핸들러, 독립 DB 모의 트랜잭션, 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 브라우저 환경에서 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라 배포 및 운영 크리덴셜 설정이 필요한 항목

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|---|
| **P1-1** | **마이그레이션 18 적용 후 신규 분석 초기화 실패** | 마이그레이션 18에서 `analysis_job_chunks`의 `authenticated` 쓰기 권한을 제거했으나, `syncJobToSupabase`가 여전히 사용자 인증 클라이언트로 청크를 upsert하여 초기화 단계에서 RLS 위반 에러 발생. 관리자 키 미설정 시 조용한 폴백 위험. | - **신규 마이그레이션 19** (`supabase/migrations/20260101000019_init_analysis_job_and_chunks.sql`) 추가<br>- 작업과 초기 청크 일괄 생성을 단일 원자적 DB 트랜잭션 RPC(`init_analysis_job_and_chunks`)로 처리 (`security definer`, `service_role` 전용)<br>- 서버 권한 실행 전 `auth.user.id`와 자료/과목 소유권 검증 (서버에 자료 행이 없는 로컬 전용 자료도 차단 없이 정상 허용)<br>- `ON CONFLICT (job_id, chunk_index) DO NOTHING`으로 재시도/동시 요청 시 기존 완료 청크, lease, drafts 상태 보존<br>- `hasAdminClientConfig()` 사전 검사로 관리자 키 미설정 시 AI 호출 없이 500 `SERVER_CONFIG_ERROR` 즉각 반환 | **원자적 RPC 및 서버 권한 격리 회귀 검증 완료** |
| **P1-2** | **IndexedDB v1 → v2 업그레이드 시 복구 데이터 삭제** | `onupgradeneeded`에서 기존 `recoveries` 저장소를 `deleteObjectStore`로 무조건 삭제 후 재생성하여, 이전 버전의 저장 실패 복구 데이터가 이관 없이 전면 소실됨. | - DB 버전을 `v3`으로 업그레이드하고, v1 레코드를 파싱하여 `${jobKey}_c${chunkIndex}` 복합 키 스토어로 안전 이관<br>- 모든 복구 필드(`drafts`, `signedRecoveryToken`, `jobKey`, `chunkIndex`, `leaseToken`, `workerId`, 상태 등) 100% 보존<br>- 필수 식별자가 누락된 불완전 레거시 레코드는 임의 삭제/덮어쓰기 대신 격리 저장소(`recoveries_unmigrated`)에 안전 보관<br>- 동일 키 충돌 발생 시 기존 데이터를 덮어쓰지 않고 `_alt_` 접미사로 보존<br>- 이관 도중 오류 발생 시 `tx.abort()`로 트랜잭션을 중단하여 기존 데이터 손실 방지<br>- 단순 조회, 새로고침, 계정 전환 시 복구 데이터 삭제 경로 차단 | **IndexedDB v1->v3 이관, 트랜잭션 중단, 격리 스토어 회귀 검증 완료** |
| **P1-3** | **본문 수정 후 신규 분석을 시작할 수 없는 문제** | `jobKey`가 없는 요청에서 자료의 최신 작업을 자동 선택하는 로직이 `status`뿐만 아니라 `init`/`process`에도 적용되어, 본문 수정 후 신규 분석 요청 시 이전 작업이 잡혀 `MARKDOWN_HASH_MISMATCH`로 거부됨. | - 신규 분석(`init`/`process` 무 `jobKey`), 기존 작업 재개(명시적 `jobKey`), 상태 조회(`status`) 3대 경로 완전 분리<br>- 신규 분석은 현재 본문 해시·모델·프롬프트 버전으로 고유 `jobKey`를 산출하여 독립 작업 생성 (이전 작업 및 복구 데이터 100% 보존)<br>- 기존 작업 재개는 명시적 `jobKey`로 조회하고 불일치 시 충돌 반환, 미존재 시 조용한 대체 없이 404 `JOB_NOT_FOUND` 반환<br>- `DashboardClient`에서 새 분석 트리거 시 진행 상태(`setAnalysisProgress(null)`) 초기화 및 `init` 실패 시 `process` 맹목적 호출 차단<br>- `MaterialEditorModal`에서 본문 수정 후 분석 시 수정된 최신 마크다운 전달 보장 | **본문 수정 독립 작업 생성, 이전 작업 보존, 상태 조회 분리 회귀 검증 완료** |

---

## 2. 변경 파일 및 신규 마이그레이션 내역

### 1) 신규 DB 마이그레이션
- `supabase/migrations/20260101000019_init_analysis_job_and_chunks.sql` (신규):
  - 원자적 RPC `init_analysis_job_and_chunks` 정의.
  - 작업 생성 및 청크 생성을 1개 트랜잭션으로 처리.
  - 실행 권한을 `service_role` 전용으로 제한 (`REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role`).
  - `ON CONFLICT DO NOTHING`을 적용하여 기존 청크 상태 및 lease 보존.

### 2) 서버 API 라우트 및 권한 모듈
- `lib/supabase/admin.ts`:
  - `hasAdminClientConfig()` 검증 함수 추가.
  - 테스트 및 런타임 환경에서 관리자 클라이언트 주입/비활성화 안전 유틸리티 제공.
- `app/api/analyze-concepts/route.ts`:
  - `syncJobToSupabase`: 사용자 클라이언트 직접 청크 upsert 제거 -> `init_analysis_job_and_chunks` 서버 전용 RPC 호출로 전환.
  - 소유권 검증: 서버 자료 존재 시 `user_id` 대조, 로컬 전용 자료(서버 행 부재) 허용.
  - 신규 분석 시 `expectedJobKey` 기반 고유 식별자 산출 및 재개 시 명시적 `clientJobKey` 대조.
  - 관리자 키 미설정 시 AI 호출 전 500 `SERVER_CONFIG_ERROR` 즉각 반환.

### 3) 클라이언트 복구 저장소 및 화면
- `lib/analysisRecovery.ts`:
  - DB 버전 v3 승격 및 `recoveries_unmigrated` 보존 저장소 추가.
  - v1 마이그레이션 로직 작성 (`tx.abort()` 안전장치, 충돌 방지 `_alt_`, 레거시 불완전 레코드 보존).
  - `deleteAnalysisRecovery`: 특정 `jobKey` 및 `chunkIndex` 지정 삭제 지원으로 타 작업 복구 데이터 오삭제 방지.
- `app/DashboardClient.tsx`:
  - `handleTriggerAiAnalysis`: 신규 분석 시 진행률 초기화, `init` 실패 시 조기 중단(blind fallback 차단).
- `components/MaterialEditorModal.tsx`:
  - 본문 수정 후 분석 실행 시 수정된 마크다운을 올바르게 바인딩하여 전달.

### 4) 회귀 검증 스위트
- `scripts/test-regressions.mjs`:
  - P1-1 (원자적 init RPC, 동시성 멱등성, 권한 분리, 로컬 자료 호환, 관리자 누락 차단)
  - P1-2 (IndexedDB v1->v3 이관, 필드 보존, 트랜잭션 중단, 격리 스토어, 타깃 삭제)
  - P1-3 (본문 변경 별도 작업 생성, 이전 작업 보존, 재개 불일치 거부, 404 처리, status 읽기 전용)
  - 총 301개 검사 100% 통과.

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **301개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (Next.js 16.3.6)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **신규 분석 초기화 (P1-1)** | **통과**: 모의 Supabase 트랜잭션 RPC 검증, 관리자 키 부재 시 AI 0회 및 500 확인, 소유권 불일치 거부, 로컬 자료 허용 확인 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 19 배포 대기 | `supabase db push` (마이그레이션 19 적용) 및 `SUPABASE_SERVICE_ROLE_KEY` 설정 |
| **IndexedDB 복구 보존 (P1-2)** | **통과**: v1 스키마 생성 후 v3 업그레이드 시뮬레이션, 전 필드 보존, 에러 시 abort 확인, 충돌 방지 확인 | **IndexedDB 모듈 검증 완료** | 브라우저 쿠키/스토리지 차단 설정 여부 확인 |
| **본문 수정 후 신규 분석 (P1-3)** | **통과**: 본문 A -> 본문 B 분리 작업 생성, 이전 작업 A 보존, 본문 불일치 재개 거부, 404 미존재 처리 확인 | **Route Handler & UI State 검증 완료** | 개발 서버(`npm run dev`)에서 실제 브라우저 수동 확인 권장 |

---

## 4. 운영 환경 마이그레이션 적용 순서

운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql`
5. `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql`
6. `supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql`
7. `supabase/migrations/20260101000019_init_analysis_job_and_chunks.sql` (신규 원자적 초기화 RPC)

### 필수 환경 변수
- `SUPABASE_SERVICE_ROLE_KEY`: 청크 선점, 결과 커밋, 원자적 초기화 RPC(`init_analysis_job_and_chunks`) 실행에 필수 (미설정 시 AI 호출 없이 500 에러)
- `ANALYSIS_RECOVERY_SIGNING_SECRET`: 복구 토큰 HMAC-SHA256 서명용 전용 비밀키 (미설정 시 `SUPABASE_SERVICE_ROLE_KEY`로 대체)
- `CRON_SECRET`: 복습 알림 스케줄러 인증용 비밀키
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 API 키 대칭 암호화 키
