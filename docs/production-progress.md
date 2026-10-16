# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-16 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `fbfe7671d702e35505ccd029b5f2ec83176d3a0c`
- 현재 작업 기준 HEAD SHA: `fbfe7671d702e35505ccd029b5f2ec83176d3a0c`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **298 passed** (기존 292건 + 신규 6대 핵심 결함 심층 회귀 검증 6건 포함, 0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 1 warning** (기존 회귀 스크립트 미사용 변수 1건 외 오류 없음)
  - `npm run build`: **Compiled successfully** (Next.js 16.3.6 Turbopack 프로덕션 빌드 완료, 정적 및 동적 16개 라우트 정상 생성)

---

## 1. 6대 핵심 문제별 원인·수정 및 검증 상태

본 문서는 테스트 통과만으로 실제 배포 환경에서의 완전 무결성을 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 기능 코드와 신규 마이그레이션이 작성됨
2. **로컬/Mock 검증 완료**: 실제 라우트 핸들러, 독립 DB 모의 트랜잭션, 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 브라우저 환경에서 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라 배포 및 운영 크리덴셜 설정이 필요한 항목

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|---|
| **1** | **진행률 조회를 실제 분석 작업과 연결** | 화면이 `jobKey` 없이 요청하고 서버는 빈 본문 해시로 새 작업을 계산함. API 응답에 `materialId`가 없어 클라이언트 일치 검증에 실패하고, 존재하지 않는 작업을 `pending`으로 반환하거나 후속 polling이 끊어짐. | - 실행 중인 작업은 클라이언트가 유지하는 `jobKey`로 조회<br>- 새로고침 후 `jobKey` 부재 시 사용자·자료 기준 DB 최신 작업(`dbJobForIdentity`) 및 메모리 세션 탐색 경로 제공<br>- 작업 미존재 시 빈 해시로 작업을 조작하지 않고 명시적 404 (`errorCode: 'JOB_NOT_FOUND', notFound: true`) 반환<br>- 응답에 `jobKey`, `materialId`, `subjectId`, `domain`, `markdownHash`, `modelId`, `promptVersion`, `chunkingVersion`, `checkpointStatus`, `draftsPersistStatus` 포함<br>- 진행 중(`processing`)에는 2.5초 간격 제한적 polling 수행, 완료·모달 닫기·자료/계정 변경 시 즉각 정리<br>- 늦은 응답이 타 자료를 덮어쓰지 않도록 `activeMaterialIdRef` 검증 적용<br>- 상태 조회 과정에서 AI 호출 0회 및 원문 재전송 불필요 보장 | **Route Handler & DashboardClient 회귀 검증 완료** |
| **2** | **복구 서명 범위와 비밀값 처리 수정** | 서명용 해시에 `materialId`, `subjectId`, `sourceMarkdownHash`, `sourceEvidence.verified`, `additionalEvidences`, `status`, `isApproved`가 누락되어 초안 변조 탐지가 불가능했고, 비밀값 미설정 시 공개된 고정 문자열로 서명함. | - 공개된 기본 서명 비밀값(`redcall-default-recovery-secret...`) 전면 제거<br>- 전용 서버 키(`ANALYSIS_RECOVERY_SIGNING_SECRET` 또는 `SUPABASE_SERVICE_ROLE_KEY`) 필수 강제, 미설정 시 유료 AI 호출 전 500 (`SIGNING_SECRET_UNCONFIGURED`) 즉각 차단<br>- `computeDraftsHash`에 출처 검증 상태(`verified`), 추가 근거 목록, `status`, `isApproved`, 본문 해시, 자료/과목 식별자를 결합한 v2 스키마 서명 적용<br>- `sanitizeRecoveryDraft` 구현: 미인가 클라이언트 입력 필드 제거, `isApproved: false` 및 `status: 'draft'` 강제, 서버 검증 컨텍스트 바인딩<br>- 다른 계정·작업·모델·만료 토큰 재사용 엄격 거부 | **암호학적 서명 및 변조 탐지 회귀 검증 완료** |
| **3** | **직접 RPC 호출로 결과 검증 우회 차단** | `authenticated` 사용자가 `claim_analysis_chunk_lease` 및 `commit_analysis_chunk_result`를 직접 호출하여 서버 AI 검증 없이 임의의 `p_drafts`를 완료 처리할 수 있었음. | - **신규 마이그레이션 18** (`supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql`) 추가<br>- `claim_analysis_chunk_lease` 및 `commit_analysis_chunk_result` 실행 권한을 `public, anon, authenticated`에서 전면 박탈(REVOKE)하고 `service_role` 전용으로 제한<br>- `analysis_job_chunks` 테이블의 직접 INSERT/UPDATE 정책을 차단하여 테이블 쓰기 우회 봉쇄 (조회 및 pause/resume만 유지)<br>- 서버 Route Handler에서 인증된 사용자의 자료/작업 소유권(`auth.user.id`)을 먼저 검증한 후, `getPrivilegedClient`를 통해서만 결과 확정 RPC 호출 수행 | **SQL 마이그레이션 검증 및 Route Handler 서버 권한 분리 완료**<br>*(운영 DB 마이그레이션 18 배포 대기)* |
| **4** | **복구 데이터를 작업·청크별로 안전하게 보존** | IndexedDB 키가 `materialId` 단일값으로 되어 있어 동일 자료의 다중 작업·다중 청크가 덮어써지고, 삭제 시에도 자료 ID만 사용하여 새 복구 데이터를 지울 수 있었음. 저장 실패 반환값을 UI에서 무시함. | - IndexedDB 스토어를 v2로 업그레이드하고 복합 키 `${jobKey}_c${chunkIndex}`로 작업·청크별 독립 격리 보존<br>- IndexedDB `tx.oncomplete`를 대기하여 트랜잭션 내구성을 검증한 후 저장 성공 처리<br>- 저장 직후 식별자뿐 아니라 데이터 해시 대조를 통한 read-back 검증 수행<br>- `deleteAnalysisRecovery`에 조건부 삭제(`chunkIndex`, `expectedContentHash`)를 적용하여 타 청크나 더 최신 복구 데이터의 오삭제 차단<br>- 저장 실패 시 UI에서 `isMemoryOnly: true` 설정 및 "메모리에만 보관됨" 뱃지 표시, 비상 JSON 다운로드 내보내기 경로 안내 | **IndexedDB 다중 청크 보존, 조건부 삭제, UI 폴백 검증 완료** |
| **5** | **체크포인트 완료와 초안 저장 완료를 분리** | 상태가 `completed`이면 복구 데이터를 삭제했으나, 당시 `completed`는 청크 분석 완료일 뿐 `concept_drafts` DB 영속 저장을 보장하지 않았음. | - 분석 청크 완료(`checkpointStatus`: `'completed'`)와 `concept_drafts` 테이블 영속 저장(`draftsPersistStatus`: `'pending' | 'persisted' | 'failed'`)을 별도 상태로 분리 관리<br>- 부분 실패 시 500 `{ checkpointCommitted: true, draftsPersistStatus: 'failed', canRetrySave: true }` 반환<br>- DB에 저장된 초안 존재 및 작업 연결(`isAllComplete`)을 확인한 후에만 전체 저장 완료로 판정<br>- 체크포인트 완료 후 초안 저장 실패 시 복구 데이터와 재시도 UI를 유지하고, AI 재호출 없이 초안 저장만 재시도(`action === 'retry_save'`) 제공<br>- 두 단계 모두 확인된 정확한 레코드만 조건부 삭제, 유효한 빈 개념 결과(`drafts: []`)도 정상 완료로 지원 | **부분 실패 상태 분리, 재시도 일관성, 복구 레코드 조건부 정리 검증 완료** |
| **6** | **재개 작업의 기록 모델과 실제 호출 모델 일치** | 작업 식별에는 DB의 `model_id`를 사용하면서 실제 AI 호출에는 현재 사용자 설정인 `cred.config.model`을 사용하여 모델 불일치가 발생할 위험 존재. | - 작업 생성 시 확정한 모델(`dbJobForIdentity.model_id` = Model A)을 재개 시에도 `aiConfig.model`로 일관되게 바인딩<br>- 사용자 설정이 Model B로 변경된 상태에서 기존 Job A를 재개할 때, 사용자가 임의로 새 모델을 주입하면 400 `JOB_MODEL_MISMATCH`로 명시 거부 (이전 모델 청크와 새 모델 청크 혼합 원천 차단)<br>- 정상 재개 시에는 기존 모델(Model A)을 강제 유지하여 실제 AI 호출 설정, 작업 메타데이터, 응답 모델 정보의 100% 일치 보장<br>- 유료 대체 모델로의 자동 전환 금지 | **모델 불일치 거부 및 실제 AI 파라미터 일치 회귀 검증 완료** |

---

## 2. 변경 파일 및 신규 마이그레이션 내역

### 1) 신규 마이그레이션
- `supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql` (신규):
  - `claim_analysis_chunk_lease` 및 `commit_analysis_chunk_result`의 실행 권한을 `public`, `anon`, `authenticated`로부터 REVOKE하고 `service_role`에만 GRANT.
  - `analysis_job_chunks` 테이블의 직접 INSERT/UPDATE 정책을 삭제하여 일반 사용자의 결과 위조 차단.
  - 소유권 기반 SELECT 및 pause/resume 권한은 안전하게 보존.

### 2) 암호학적 서명 및 로컬 복구 인프라
- `lib/recoveryToken.ts`:
  - 공개된 고정 비밀값 제거 (`hasRecoverySigningSecret` 및 전용 키 강제).
  - `computeDraftsHash`: `materialId`, `subjectId`, `sourceMarkdownHash`, `sourceEvidence.verified`, `additionalEvidences`, `status`, `isApproved` 전체 필드 해시.
  - `sanitizeRecoveryDraft`: 클라이언트 조작 방지 및 안전한 초안 정규화.
- `lib/analysisRecovery.ts`:
  - v2 복합 키 `${jobKey}_c${chunkIndex}` 적용, `tx.oncomplete` 내구성 보장, read-back 해시 검증.
  - `deleteAnalysisRecovery`: `chunkIndex` 및 `expectedContentHash` 조건부 안전 삭제.
  - `isMemoryOnly` 플래그 및 JSON 백업 내보내기 지원.
- `lib/analysisCheckpoint.ts`:
  - `findLatestSessionForMaterial` 함수 추가: `jobKey` 없이 새로고침된 상태에서도 최신 세션 탐색 지원.

### 3) API 라우트 및 비즈니스 로직
- `app/api/analyze-concepts/route.ts`:
  - `getPrivilegedClient`: 서버 소유권 확인 후 `service_role` 권한으로 RPC 실행.
  - `action === 'status'`: 빈 해시 조작 차단, 최신 DB 작업 식별, 404 `JOB_NOT_FOUND` 명시, `checkpointStatus`와 `draftsPersistStatus` 분리 반환, AI 호출 0회 보장.
  - `action === 'retry_save'`: 복구 토큰 전체 필드 검증 및 초안 정규화 후 안전 저장.
  - `action === 'process'`: `hasRecoverySigningSecret()` 사전 확인(500 조기 차단), `aiConfig.model = resolvedModelId` 강제, `JOB_MODEL_MISMATCH` 충돌 거부.

### 4) 클라이언트 UI
- `components/ConceptReviewModal.tsx`:
  - `isMemoryOnly` 뱃지 ("메모리에만 보관됨") 및 동적 재시도 라벨 표시.
  - 비상 JSON 백업 버튼 제공.
- `app/DashboardClient.tsx`:
  - `saveAnalysisRecovery` 실패 시 `isMemoryOnly: true` 설정 및 사용자 안내.
  - `fetchStatus`: 활성 `jobKey` 전달, 404 `notFound` 처리, `isReallyAllComplete` vs 부분 실패 분리 판단, 완전 성공 시에만 조건부 삭제.

### 5) 회귀 검증 스위트
- `scripts/test-regressions.mjs`:
  - 6대 핵심 문제에 대한 엄밀한 통합 회귀 테스트 6건 추가 (총 298건 통과).

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **298개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개 (경고 1건: 기존 테스트 스크립트 미사용 변수)
- `npm run build`: Turbopack 프로덕션 빌드 성공 (16개 라우트 정상 생성)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **진행률 조회 연결** | **통과**: 확정 `jobKey` 조회, 새로고침 복원, 404 `JOB_NOT_FOUND`, AI 호출 0회 확인 | **Route Handler & Client 시뮬레이션 완료** | 개발 서버(`npm run dev`)에서 브라우저 수동 확인 권장 |
| **복구 서명 전체 필드 검증** | **통과**: 출처검증·추가근거·승인상태 변조 탐지, 서명키 부재 시 AI 호출 전 500 확인 | **단위 및 통합 검증 완료** | `ANALYSIS_RECOVERY_SIGNING_SECRET` 또는 `SUPABASE_SERVICE_ROLE_KEY` 설정 |
| **직접 RPC 우회 차단** | **통과**: 일반 사용자 RPC 실행 권한 박탈 및 서버 소유권 기반 권한 클라이언트 호출 확인 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 18 배포 대기 | `supabase db push` (마이그레이션 18 적용) |
| **작업·청크별 복구 데이터 보존** | **통과**: 다중 작업/청크 공존, 조건부 삭제, 트랜잭션 완료 확인, 메모리 폴백 확인 | **IndexedDB 모듈 검증 완료** | 브라우저 쿠키/스토리지 차단 설정 여부 확인 |
| **체크포인트/초안 저장 분리** | **통과**: 체크포인트 성공 후 초안 실패 시 부분 실패 반환, 복구 유지 후 재시도 성공 확인 | **Route Handler & State 머신 검증 완료** | - |
| **재개 작업 모델 일치** | **통과**: 기존 모델 A 강제 바인딩, 새 모델 B 주입 시 `JOB_MODEL_MISMATCH` 거부 확인 | **Route Handler & Mock AI 검증 완료** | - |

---

## 4. 운영 환경 마이그레이션 적용 가이드

운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql`
5. `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql`
6. `supabase/migrations/20260101000018_restrict_analysis_commit_to_service_role.sql` (최신 보안 마이그레이션)

### 필수 환경 변수
- `ANALYSIS_RECOVERY_SIGNING_SECRET`: 복구 토큰 HMAC-SHA256 서명용 전용 비밀키 (미설정 시 `SUPABASE_SERVICE_ROLE_KEY`를 서버 폴백으로 사용하며, 둘 다 없으면 AI 호출 전 명시적 500 오류 반환)
- `SUPABASE_SERVICE_ROLE_KEY`: 청크 선점 및 결과 커밋 등 서버 권한 전용 RPC 실행에 필수
- `CRON_SECRET`: 복습 알림 스케줄러 인증용 비밀키
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 API 키 대칭 암호화 키
