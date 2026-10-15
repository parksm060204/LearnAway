# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-15 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `6b3992df1cf47b1624441c94eb9d3d54824b9efb`
- 현재 작업 기준 HEAD SHA: `6b3992df1cf47b1624441c94eb9d3d54824b9efb`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **286 passed** (8대 리뷰 지적 사항에 대한 실제 라우트 핸들러 및 DB 모의 연결 회귀 검증 포함, 0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings** (Next.js / ESLint 검사 통과)
  - `npm run build`: **Compiled successfully** (16/16 pages & API routes Turbopack 최적화 프로덕션 빌드 완료)

---

## 1. 8대 리뷰 지적 사항별 원인·수정 및 검증 상태

본 문서는 테스트 개수나 빌드 통과 여부만으로 완료를 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 코드와 마이그레이션이 작성됨
2. **로컬/Mock 검증 완료**: 실제 라우트 핸들러, 독립 DB 모의 트랜잭션, 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 발송 채널로 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라 배포 및 크리덴셜 설정이 필요한 항목

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|---|
| **1** | **분석 RPC의 사용자 소유권 검증** | `claim_analysis_chunk_lease`, `commit_analysis_chunk_result`, `pause_analysis_job`, `resume_analysis_job`이 `SECURITY DEFINER`로 실행되면서 `p_user_id`를 신뢰하거나 `auth.uid()` 소유권을 충분히 검사하지 않고, `analysis_job_chunks`에 일반 사용자 직접 UPDATE 정책이 남아 우회 가능했음. | - 신규 마이그레이션 `20260101000016`: 모든 작업 조회·선점·결과 반환·완료·중단·재개에서 `auth.uid() = analysis_jobs.user_id`를 엄격 검증<br>- 호출자 인자 `p_user_id`를 권한 판단 근거로 사용하지 않고 무시<br>- `analysis_job_chunks`의 직접 UPDATE RLS 정책(`Users can update chunks for their own jobs`)을 DROP하여 RPC 검증 우회 차단<br>- 중단 요청(`pause`)과 청크 선점 경쟁 시 `status = 'paused'` 상태 보존 및 선점 차단 | **로컬/Mock 검증 완료**<br>*(운영 DB 마이그레이션 16 배포 대기)* |
| **2** | **기존 알림 RPC의 취약한 함수 시그니처 제거** | 마이그레이션 15에서 인자 수가 변경된 `claim_notification_dispatch` 및 `complete_notification_dispatch`를 `CREATE OR REPLACE`하여 마이그레이션 14의 6-arg 및 3-arg 구 시그니처가 잔존하여 PostgREST 모호성 및 권한 탈취 위험 존재. | - 신규 마이그레이션 `20260101000016`에서 구버전 함수 명시적 제거(`DROP FUNCTION public.claim_notification_dispatch(uuid, text, text, integer, text, boolean)`, `DROP FUNCTION public.complete_notification_dispatch(uuid, text, text)`)<br>- 신규 시그니처에서 `PUBLIC`, `anon`, `authenticated` 실행 권한을 전면 취소하고 `service_role` 전용으로만 제한 | **로컬/Mock 검증 완료**<br>*(운영 DB 마이그레이션 16 배포 대기)* |
| **3** | **정상 분석 결과가 빈 응답으로 반환되는 회귀 수정** | DB 청크 선점 및 결과 저장은 성공했으나 메모리 원장에 선점 정보가 동기화되지 않아 메모리 `commitChunkResult`가 `worker_mismatch`를 발생시키고, 빈 drafts(`[]`)와 0개 완료를 반환하여 AI가 생성한 개념이 소실됨. | - 작업 상태의 절대적 기준을 DB로 통일<br>- `lib/analysisCheckpoint.ts`에 `syncDbLeaseToLedger` 및 `recordAuthoritativeChunkResult`를 추가하여 DB 선점/완료 결과를 메모리 세션 원장에 즉시 동기화<br>- `already_completed` 응답 시에도 DB에 보존된 개념 결과를 정상 로드하여 API 응답 및 초안 저장에 일관되게 반영<br>- DB RPC 실패 시 메모리 선점으로 우회하는 운영 폴백 제거 | **실제 Route Handler Mock AI·DB 회귀 검증 완료** |
| **4** | **초안 생성의 조회-저장 경쟁 조건 제거** | 조회 시점에 없던 초안이 다른 요청이나 사용자에 의해 생성/편집된 후, 원래 요청의 upsert가 사용자의 수정 본문과 승인 상태를 덮어쓰는 경쟁 조건 발생. | - `lib/cloud/learningRepository.ts`의 `upsertConceptDrafts` 및 `upsertProblemDrafts`에 `{ onConflict: 'id,user_id', ignoreDuplicates: true }` 적용<br>- 신규 삽입 충돌 시 기존 행을 절대 덮어쓰지 않고 최신 서버 상태를 재조회하여 반환<br>- 사용자의 편집 내용(`title`, `description`, `coreDefinitionFormulaOrAlgorithm`, `is_approved`, `edited_by_user`) 영구 보존 | **독립 DB 인스턴스 동시성 시뮬레이션 검증 완료** |
| **5** | **평가 요청에 실제 문제 버전·시험 스냅샷 연결** | 모달 화면 컴포넌트가 `problemVersion`과 `mockExamSessionId`를 전달하지 않고, 서버에서 문제 조회 실패 시 최신 문제로 자동 폴백하거나 클라이언트 지문/정답/루브릭으로 조용히 대체하는 위험 존재. | - `MockExamModal`, `ProblemSessionModal`, `LogicStrengthenModal`에서 `problemVersion: problem.version ?? 1` 및 `mockExamSessionId`를 명시 전달<br>- 서버 `app/api/evaluate-answer/route.ts`에서 사용자의 제출/채점 완료된 시험 세션 스냅샷을 우선 조회<br>- 요청 버전이 최신과 다를 때 불변 버전 스냅샷(`problem_versions`)을 강제 조회하며, 미존재 시 404 명시 오류 반환 (최신 문제로 조용히 대체 금지)<br>- 지문·정답·루브릭·수식·코드를 서버 공인 스냅샷에서 강제 바인딩 | **컴포넌트 요청 구성 및 Route Handler 회귀 검증 완료** |
| **6** | **AI 결과 저장 실패의 실제 복구 경로 구현** | DB 저장 실패 시 `canRetrySave: true`가 반환되어도 UI가 단순 에러 토스트만 표시하고 저장 재시도 경로가 실제로 연결되지 않았음. | - 서버 `app/api/analyze-concepts/route.ts`에 `action: 'retry_save'` 엔드포인트 구현: 이미 생성된 drafts, workerId, leaseToken, chunkIndex를 검증하여 AI 재호출 없이 DB 결과 커밋 및 초안 영속 저장만 1회 재시도 확정<br>- `components/ConceptReviewModal.tsx`에 "생성 완료, 저장 실패 - 저장 재시도" UI 및 버튼 연동<br>- `DashboardClient.tsx`에 `handleRetrySaveAnalysis` 연동<br>- 선점 만료 또는 충돌 시 안전한 복구가 불가능함을 명시 안내 | **Route Handler 재시도 시 AI 미호출 검증 완료** |
| **7** | **첫 분석 중단·진행률·새로고침 복원 구현** | 첫 분석 중 전체 요청 종료 전까지 진행률이 갱신되지 않고, 중단 버튼 클릭 시 jobKey가 없어 동작하지 않으며 새로고침 시 복원이 불가했음. | - `action: 'init'` 분리를 통해 청크 처리 시작 전에 `jobKey`를 선확보하여 클라이언트에 즉시 전달<br>- 첫 분석 처리 중에도 즉시 중단(`action: 'pause'`)이 해당 작업에 정확히 전달<br>- 새로고침 후 `action: 'status'`로 DB 상태를 순수 조회하여 AI 재호출 없이 진행 상태 복원<br>- `materialId` 일치 검증으로 다른 자료 모달에 진행률이 오염되는 현상 차단 | **Route Handler 단계별 전이 검증 완료** |
| **8** | **서버 권한 키 미설정 시 명시적으로 실패** | `SUPABASE_SERVICE_ROLE_KEY`가 없을 때 공개 anon 키 클라이언트로 폴백하여 RLS로 인해 조회 결과가 0건처럼 오작동하는 보안 결함. | - `lib/supabase/admin.ts`에서 `SUPABASE_SERVICE_ROLE_KEY` 누락 시 즉시 명시적 예외 발생<br>- 브라우저 실행 시 즉시 예외 발생 (`server-only` 경계 준수)<br>- `app/api/reminders/cron/route.ts`에서 키 미설정 시 500 에러 및 적절한 실패 응답 반환 (0건 처리 위장 차단) | **Admin 클라이언트 및 Cron Route 회귀 검증 완료** |

---

## 2. 변경 파일 및 신규 마이그레이션 내역

1. **신규 마이그레이션**
   - `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql` (신규):
     - 마이그레이션 14의 구버전 함수 `claim_notification_dispatch(6 args)` 및 `complete_notification_dispatch(3 args)` 완전 제거(`DROP FUNCTION`)
     - 마이그레이션 15의 신규 디스패치 함수 권한을 `service_role` 전용으로 제한
     - `claim_analysis_chunk_lease`, `commit_analysis_chunk_result`, `pause_analysis_job`, `resume_analysis_job`에 `auth.uid() = analysis_jobs.user_id` 소유권 강제 적용
     - `analysis_job_chunks`의 직접 UPDATE 정책 제거로 RPC 우회 차단

2. **서버 인프라 및 저장소**
   - `lib/supabase/admin.ts`: 공개 키 폴백 제거, `SUPABASE_SERVICE_ROLE_KEY` 필수화, 브라우저 환경 차단, 테스트 주입 지원
   - `lib/cloud/learningRepository.ts`: `upsertConceptDrafts` 및 `upsertProblemDrafts`의 `ignoreDuplicates: true` 기반 사용자 편집/승인 상태 영구 보존

3. **분석 체크포인트 및 API 라우트**
   - `lib/analysisCheckpoint.ts`: `syncDbLeaseToLedger`, `recordAuthoritativeChunkResult`를 통한 DB-메모리 원장 완전 동기화
   - `app/api/analyze-concepts/route.ts`: `action: 'init'`(작업 키 선확보), `action: 'retry_save'`(AI 미호출 DB 저장 재시도), `action: 'status'`(새로고침 복원), DB RPC 소유권 검증 및 운영 메모리 폴백 제거
   - `app/api/evaluate-answer/route.ts`: 불변 스냅샷 우선 적용, 미존재 버전 404 차단, 서버 스냅샷 데이터 강제 바인딩

4. **사용자 화면 컴포넌트**
   - `components/MockExamModal.tsx`: 평가 요청 시 `problemVersion: problem.version ?? 1` 및 `mockExamSessionId` 전달
   - `components/ProblemSessionModal.tsx`: 평가 요청 시 `problemVersion: problem.version ?? 1` 전달
   - `components/LogicStrengthenModal.tsx`: 평가 요청 시 `problemVersion: problem.version ?? 1` 전달
   - `components/ConceptReviewModal.tsx`: 저장 실패 상태(`saveFailedState`) 및 "저장 재시도" 버튼 연동, `materialId` 기반 진행률 격리
   - `app/DashboardClient.tsx`: `handleRetrySaveAnalysis`, 모달 오픈 시 배경 진행 상태 복원 연동

5. **검증 스위트**
   - `scripts/test-regressions.mjs`: 8대 리뷰 문제에 대응하는 8건의 엄격한 회귀 테스트(체크 1~8) 작성 및 통과 (총 286개 통과)

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **286개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (16개 라우트 생성 완료)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **분석 RPC 소유권 및 권한** | **통과**: 타 사용자 작업 선점·완료·중단·재개 차단 및 마이그레이션 16 DROP 확인 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 16 배포 대기 | `supabase db push`를 통한 16번 마이그레이션 배포 |
| **기존 알림 RPC 오버로드 정리** | **통과**: 구버전 시그니처 DROP 및 `service_role` 실행 권한 확인 | **미검증 (대기)**: 운영 Supabase 배포 대기 | 16번 마이그레이션 배포 |
| **분석 결과 DB-메모리 동기화** | **통과**: Route Handler 모의 연결에서 1건 생성, 완료 청크 재사용 시 AI 미호출 확인 | **로컬 Route Handler 검증 완료** | - |
| **초안 생성 조회-저장 동시성** | **통과**: A 조회 -> B 편집 -> A 저장 시 B의 수정 내용 및 승인 상태 영구 보존 | **로컬 DB 시뮬레이션 완료** | - |
| **평가 스냅샷 및 문제 버전** | **통과**: 시험 v1 시작 후 v2 수정 시 v1 스냅샷 채점, 없는 버전 404 차단 확인 | **컴포넌트 및 API 검증 완료** | 학교 게이트웨이 라이브 호출 전 API 키 등록 필요 |
| **AI 저장 실패 복구 UI/API** | **통과**: DB 실패 시 유료 결과 보존 후 `retry_save` 호출로 AI 재호출 없이 1회 저장 완료 | **Route Handler 및 컴포넌트 검증 완료** | - |
| **첫 분석 중단 및 복원** | **통과**: `init`으로 키 선점 후 처리 중 `pause` 전이, 새로고침 시 `status` 복원 확인 | **Route Handler 검증 완료**<br>*(브라우저 실화면 확인 권장)* | 개발 서버(`npm run dev`)에서 브라우저 수동 확인 |
| **서버 어드민 클라이언트 보안** | **통과**: 키 미설정 시 즉시 에러 발생, 브라우저 실행 차단, Cron 500 반환 확인 | **서버 모듈 검증 완료** | 서버 환경에 `SUPABASE_SERVICE_ROLE_KEY` 등록 |

---

## 4. 운영 환경 설정 가이드

### 1) 마이그레이션 순차 적용
운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql` (최신 필수 패치)

### 2) 필수 환경 변수 구성
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase 프로젝트 설정 -> API -> `service_role` (secret) 키 (알림 발송 및 서버 작업 전용)
- `CRON_SECRET`: 예약 알림 스케줄러 인증용 고유 비밀 문자열
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 학교 BAZE API 키 대칭 암호화 키 (32바이트)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: 클라이언트 공개 설정
