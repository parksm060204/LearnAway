# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-16 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `d07a344d2d6184608bebca24bd24de930b559f61`
- 현재 작업 기준 HEAD SHA: `d07a344d2d6184608bebca24bd24de930b559f61`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **306 passed** (0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (TypeScript 컴파일 에러 없음)
  - `npm run lint`: **0 errors, 0 warnings** (ESLint 통과)
  - `npm run build`: **Compiled successfully** (Next.js 16.3.6 Turbopack 프로덕션 빌드 완료, 12개 정적·동적 라우트 정상 생성)

---

## 1. 결함 원인·수정 및 검증 내역

본 문서는 테스트 통과만으로 실제 배포 환경에서의 완전 무결성을 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 기능 코드와 마이그레이션이 작성됨
2. **로컬 / Mock 검증 완료**: Node.js FakeIndexedDB, 단일 프로세스 모의 Supabase 객체(`withFakeSupabase`), 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 브라우저 환경에서 직접 확인됨
4. **미검증 또는 운영 설정 대기**: 외부 인프라 배포, 실환경 브라우저 다중 탭 테스트, 실제 RLS 정책 및 PostgreSQL 트랜잭션 락 검증이 필요한 항목

### 최근 수정된 3대 결함 내역

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 및 한계 |
|---|---|---|---|---|
| **결함 1 (P1)** | **자료 본문 변경 후 이전 분석 결과의 저장 재시도(retry_save) 실패** | `action === 'retry_save'` 처리 시에도 상단에서 현재 자료의 `content_hash`와 세션의 `markdownHash`를 즉시 대조하여, 자료 본문이 수정된 경우 400 `MARKDOWN_HASH_MISMATCH`로 초안 저장이 조기 거부됨. | - `app/api/analyze-concepts/route.ts`의 상단 본문 일치 검사에서 `action === 'retry_save'` 제외<br>- `verifyRecoveryToken` 및 세션 원본 `markdownHash` 검증 유지<br>- 현재 서버 자료의 `content_hash`와 대조하여 본문이 변경된 경우 초안에 `needsSourceReview: true` 부여 (원본 `sourceMarkdownHash`는 변조 없이 유지)<br>- 로컬에 본문이 없는 경우에도 이전 분석 결과 안전 복구 허용<br>- 추가 AI 호출 0회 보장 (기존 생성 결과만 커밋/저장)<br>- `DashboardClient.tsx`에서 초안 ID 기준 중복 방지 병합 및 사용자 승인 상태(`isApproved`) 보존 | **로컬/Mock 검증 완료**<br>- 306번 회귀 테스트에서 본문 수정 후 retry_save 성공, AI 0회 호출, `needsSourceReview: true` 반환 확인<br>- *제한*: 실제 브라우저 세션에서 대용량 자료 변경 후 장시간 경과 복구는 미검증 |
| **결함 2 (P2)** | **불완전한 복구 레코드의 임의 보정(`chunkIndex = 1`)으로 인한 데이터 왜곡** | `lib/analysisRecovery.ts`의 v1->v4 이관 및 로드 시 `chunkIndex`가 누락되거나 0, 음수, 소수, 문자열 등 비정상 값일 때 `record.chunkIndex || 1`로 임의 보정하여 정상 청크 1과 충돌하거나 다중 청크 결과가 왜곡될 위험 존재. | - IndexedDB 스키마 버전을 `v5`로 승격<br>- 유효 청크 번호 검증(`Number.isInteger(c) && c > 0`) 추가<br>- `chunkIndex` 비정상 레코드 및 식별자(`jobKey`, `materialId`) 누락 레코드는 1로 임의 보정하지 않고 `recoveries_unmigrated` 저장소에 `rawRecord` 원본 및 `unmigratedReason`과 함께 격리 보존<br>- 유효한 청크 1 및 다중 청크 정상 레코드는 안전하게 유지<br>- 격리된 레코드는 정상 자동 복구 목록에서 제외하여 잘못된 초안 덮어쓰기 방지<br>- `saveAnalysisRecovery`에서 비정상 `chunkIndex` 저장 차단 | **로컬/Mock 검증 완료**<br>- FakeIndexedDB에서 v1 레코드(정상 2건, 결함 5건) v5 이관 시 정상 2건만 활성 유지 및 결함 5건 격리 확인<br>- JSON 내보내기 사유 포함 확인<br>- *제한*: 실제 구형 브라우저 엔진의 IndexedDB v1 데이터 이관은 Mock 시뮬레이션 기반임 |
| **결함 3 (P2/P3)** | **IndexedDB 차단/읽기 오류를 "복구 데이터 없음"으로 오인하여 상태 유실 위험** | `loadAnalysisRecovery` 및 `listAnalysisRecoveries`가 오류/차단 시 단순히 `null` 또는 `[]`을 반환하여, 다른 탭이 DB를 점유 중이거나 스토리지 접근 실패 시 "복구 데이터 없음"으로 오인되어 진행 상태를 잘못 덮어쓸 위험 존재. | - 복구 API 반환 타입을 명시적 유니온(`success`, `not_found`, `blocked`, `error`)으로 전면 전환<br>- 차단(`blocked`) 또는 에러(`error`) 발생 시 메모리의 기존 초안/작업 상태를 초기화하거나 덮어쓰지 않고 보존<br>- 차단 시 "다른 탭을 닫고 다시 시도" 배너와 재시도 액션(`onRetryRecoveryDb`) 제공<br>- `req.onsuccess`가 `wasBlocked` 이후 지연 실행되는 경우 연결 핸들 즉시 닫기(`db.close()`)로 리소스 누수 방지<br>- 비동기 로딩 완료 전 모달 닫힘 또는 계정/자료 스코프 변경 시 stale 응답 무시 가드 적용 | **로컬/Mock 검증 완료**<br>- FakeIndexedDB 차단 주입 시 blocked 상태 반환, 타 탭 점유 해제 후 지연 `onsuccess` 연결 닫기(`db.close()`), 모달 차단 배너 렌더링 확인<br>- *제한*: 실제 다중 브라우저 탭 간의 락 경합 및 운영체제 스토리지 쿼터 초과 상황은 미검증 |

---

## 2. 변경 파일 및 구성 내역

### 1) 서버 API 라우트 및 토큰 검증
- `app/api/analyze-concepts/route.ts`:
  - `action === 'retry_save'`인 경우 라우트 상단의 조기 `MARKDOWN_HASH_MISMATCH` 검사를 건너뛰도록 분기.
  - 서버 `materials` 행의 `content_hash`와 대조하여 본문 변경 여부(`isSourceOutdated`) 판별.
  - 본문이 수정된 경우 응답 초안들에 `needsSourceReview: true`를 부여하고, 원본 `sourceMarkdownHash`는 보존.
  - `verifyRecoveryToken`을 통해 이전 세션의 토큰과 해시를 검증하며, AI 호출 없이 기존 결과만 커밋/저장.
- `lib/recoveryToken.ts`:
  - `sanitizeRecoveryDraft`에서 `needsSourceReview` 불리언 필드 지원.
  - `sourceMarkdownHash`가 누락된 경우 기본 빈 문자열 폴백으로 타입 안정성 확보.

### 2) 클라이언트 복구 저장소 및 화면
- `lib/analysisRecovery.ts`:
  - DB 버전 `v5` (`RECOVERY_DB_VERSION = 5`) 승격.
  - `isValidChunkIndex(val)` 유효성 검사기 추가.
  - v1 및 v4->v5 업그레이드 시 `chunkIndex` 비정상(0, 음수, 소수, 문자열, undefined) 레코드 및 필수 식별자 결손 레코드를 `recoveries_unmigrated`로 격리 보존 (`rawRecord`, `unmigratedReason`).
  - 반환 계약을 `LoadAnalysisRecoveryResult` 및 `ListAnalysisRecoveryResult` 명시적 판별 유니온(`status: 'success' | 'not_found' | 'blocked' | 'error'`)으로 정의.
  - `openRecoveryDb`에서 `wasBlocked` 플래그를 추적하여 지연 `onsuccess` 발생 시 `db.close()`로 연결 정리.
  - `saveAnalysisRecovery`에서 비정상 `chunkIndex`, `jobKey`, `materialId` 및 빈 `drafts` 저장 거부.
- `app/DashboardClient.tsx`:
  - `unmigratedRecoveries`를 `{ scopeId, records }` 형태로 관리하여 계정/자료 스코프 혼선 방지.
  - `recoveryDbStatus` 상태를 추가하여 `blocked` 또는 `error` 시 기존 메모리 초안을 초기화하지 않고 보존.
  - `handleRetrySaveAnalysis`에서 자료 본문 대신 `currentMarkdownHash`를 전달하고, 복구된 초안을 ID 기준으로 병합하여 사용자의 `isApproved` 상태 보존.
  - 모달 닫힘 및 스코프 변경 가드를 적용하여 비동기 응답 도착 시 stale 업데이트 방지.
- `components/ConceptReviewModal.tsx`:
  - `recoveryDbStatus` 및 `onRetryRecoveryDb` 프롭스 추가.
  - IndexedDB 차단 시 "다른 탭을 닫고 다시 시도" 안내 및 재시도 버튼 제공.
  - 오류 발생 시에도 기존 검토 상태 보존.

### 3) 회귀 검증 스위트
- `scripts/test-regressions.mjs`:
  - `결함 1 검증`: 자료 본문 변경 후 이전 분석 결과 저장 재시도(retry_save) 성공, AI 0회 호출, `needsSourceReview: true` 확인.
  - `결함 2 검증`: 불완전한 복구 레코드 격리 (`chunkIndex` 보정 제거) 및 v5 이관 호환성 (정상 청크 2건 활성 보존, 비정상 5건 격리 보존, JSON 백업 내보내기).
  - `결함 3 검증`: IndexedDB 차단·조회 오류 시 명시적 반환 계약 (`success`, `not_found`, `blocked`, `error`) 및 지연 onsuccess 핸들 닫기 확인.
  - ESLint 미사용 변수 정리 완료 (0 errors, 0 warnings).

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **306개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (Next.js 16.3.6)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 상세 구분

> [!IMPORTANT]
> **검증 성격 구분 고지**  
> 본 프로젝트의 자동화 테스트 스위트는 Node.js 환경에서 모의 객체(`FakeIndexedDB`, `withFakeSupabase`)를 사용하여 실행되었습니다. 따라서 아래 표와 같이 단위 로직과 실제 인프라 동작 여부를 엄격히 분리하여 보고합니다.

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 반영을 위한 전제 조건 및 한계 |
|---|---|---|---|
| **자료 본문 변경 후 retry_save (결함 1)** | **통과 (Mock)**: Mock AI 호출 0회, 복구 토큰 검증, 본문 변경 시 `needsSourceReview: true` 플래그 부여 및 초안 병합 확인 | **미검증**: 실제 운영 환경에서의 대용량 본문 변경 및 다중 청크 복구 | 운영 Supabase에 최신 API 배포 및 정상 사용자 세션 필요 |
| **IndexedDB v5 이관 및 불완전 청크 격리 (결함 2)** | **통과 (Mock)**: Node.js `FakeIndexedDB` 환경에서 v1 스키마 생성 후 v5 승격 시뮬레이션. 유효 청크(1, 2) 활성 유지, 비정상 청크(0, 음수, 소수, 문자열, undefined) 5건 격리 보존, JSON 백업 확인 | **미검증 (Mock 검증만 수행됨)**: 실제 브라우저(Chrome, Safari, Firefox) 스토리지 엔진 검증 미실시 | 브라우저별 IndexedDB 트랜잭션 수명 주기 및 쿼터 제한 정책 확인 필요 |
| **IndexedDB 차단/오류 명시적 계약 (결함 3)** | **통과 (Mock)**: `FakeIndexedDB` 차단 시뮬레이션을 통해 `blocked` 상태 반환, 타 탭 점유 해제 후 지연 `onsuccess` 연결 닫기(`db.close()`), 모달 차단 배너 렌더링 확인 | **미검증 (Mock 검증만 수행됨)**: 실제 브라우저의 다중 탭 동시 접속 경합 미실시 | 사용자가 브라우저 탭을 여러 개 열고 동시에 DB 업그레이드가 일어나는 실환경 관찰 필요 |
| **분석 동시 초기화 기본키 충돌 방지 (이전 P2)** | **통과 (Mock)**: `withFakeSupabase`와 `Promise.all` 기반의 단일 프로세스 모의 호출에서 `ON CONFLICT DO NOTHING` 시뮬레이션 및 식별 정보 불일치 거부 확인 | **미검증 (대기)**: 독립된 두 개의 물리적 PostgreSQL 커넥션 동시성, 실제 Row Lock (`FOR UPDATE`), RLS 정책 적용 및 트랜잭션 롤백은 실제 DB에서 미검증 | `supabase db push`를 통한 마이그레이션 20 배포 및 `SUPABASE_SERVICE_ROLE_KEY` 설정 |
| **로컬 자료 과목 소유권 검증 (이전 P1)** | **통과 (Mock)**: Route Handler 단위 테스트에서 내 과목+로컬 자료 허용, 타인 과목 404 차단, 부재 과목 404 차단, 자료-과목 불일치 400 차단 확인 | **Route Handler 검증 완료 (로컬)**: 실제 Supabase RLS 정책과의 종합 연동은 배포 대기 | 운영 Supabase RLS 및 사용자 인증 세션 정상 작동 확인 |

---

## 4. 이번에 수정한 동작과 아직 남은 제한 사항

### 1) 이번에 수정 완료된 동작
1. **자료 본문 변경 후 복구 보장**: 자료 본문이 분석 도중 또는 분석 완료 후 수정되었더라도, 이전 분석 세션의 복구 토큰이 유효하면 400 에러 없이 초안을 복구하고 `needsSourceReview: true`로 마킹하여 출처 재검토를 유도합니다.
2. **청크 인덱스 왜곡 방지 및 격리**: `chunkIndex`가 누락되거나 비정상적인 레코드를 강제로 1번 청크로 보정하지 않고 `recoveries_unmigrated`에 격리하여 다중 청크 결과의 왜곡과 덮어쓰기를 방지합니다.
3. **스토리지 차단 및 오류 분리**: IndexedDB 차단/읽기 오류를 단순 "데이터 없음"으로 처리하지 않고 `blocked`/`error` 상태를 반환하여 메모리 데이터를 보존하고 재시도 경로를 제공합니다.
4. **연결 리소스 누수 방지**: 차단 상태에서 지연 완료된 IDB 요청의 데이터베이스 연결을 명시적으로 닫아 오프라인 핸들 누수를 방지합니다.

### 2) 아직 남은 제한 사항
1. **실제 브라우저 스토리지 쿼터 및 프라이빗 브라우징 한계**: 브라우저의 시크릿 모드나 스토리지 쿼터 초과 상황에서는 IndexedDB 쓰기가 영구 실패할 수 있으며, 이 경우 메모리 상태만 유지되고 페이지 새로고침 시 복구가 불가합니다.
2. **운영 Supabase 마이그레이션 배포 필요**: 마이그레이션 20(`20260101000020_concurrency_and_subject_ownership.sql`)은 코드베이스에 작성 완료되었으나, 운영 DB에 `supabase db push` 등으로 직접 적용되기 전까지는 실제 PostgreSQL 수준의 동시성 락 및 RLS 강제가 미적용 상태입니다.
3. **학교 BAZE Gateway 실제 호출 예산**: 본 작업 원칙에 따라 유료/외부 AI 실환경 호출은 수행하지 않았으며, 모든 AI 관련 검증은 Mock 인터페이스를 기반으로 수행되었습니다.

---

## 5. 운영 환경 마이그레이션 적용 순서

운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql`
5. `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql`
6. `supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql`
7. `supabase/migrations/20260101000019_init_analysis_job_and_chunks.sql` (원자적 초기화 RPC)
8. `supabase/migrations/20260101000020_concurrency_and_subject_ownership.sql` (동시성 기본키 충돌 방지 및 과목 소유권 강화 후속 마이그레이션)

### 필수 환경 변수
- `SUPABASE_SERVICE_ROLE_KEY`: 청크 선점, 결과 커밋, 원자적 초기화 RPC(`init_analysis_job_and_chunks`) 실행에 필수 (미설정 시 AI 호출 없이 500 에러)
- `ANALYSIS_RECOVERY_SIGNING_SECRET`: 복구 토큰 HMAC-SHA256 서명용 전용 비밀키 (미설정 시 `SUPABASE_SERVICE_ROLE_KEY`로 대체)
- `CRON_SECRET`: 복습 알림 스케줄러 인증용 비밀키
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 API 키 대칭 암호화 키
