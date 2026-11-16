# LearnAway 전체 코드베이스 감사 및 수정 보고서

## 1. 감사 범위 (Coverage)

본 감사는 LearnAway(`C:/Users/abcde/Desktop/study-tool`) 전체 코드베이스를 대상으로 수행되었습니다.

- **문서 및 설정**: `AGENTS.md`, `README.md`, `docs/*`, `.env.example`, `next.config.ts`, `tsconfig.json`, `vercel.json`, `proxy.ts`, `eslint.config.mjs`, `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- **인증·세션·계정 격리**: `lib/auth/*`, `lib/supabase/*`, `app/page.tsx`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `app/api/auth/username/route.ts`, `app/api/guest-login/route.ts`, `components/GatewayPage.tsx`, `lib/storageScope.ts`, `app/DashboardClient.tsx`
- **클라우드 저장·동시성·이관·불변성**: `lib/cloud/*` (`learningRepository.ts`, `learningMigration.ts`, `learningPlan.ts`, `historyRepository.ts`, `historyMigration.ts`, `localMigration.ts`, `mockExamSync.ts`, `materialsRepository.ts`, `subjectsRepository.ts`, `library.ts`), `lib/mockExam.ts`, `lib/storage.ts`, `app/api/persist-drafts/route.ts`, `supabase/migrations/20260101000000` ~ `20260101000041`
- **AI 호출·모델 라우팅·크레딧·파싱·검증**: `lib/aiConfig.ts`, `lib/aiClient.ts`, `lib/aiCredentials.ts`, `lib/aiModelPolicy.ts`, `lib/trialCredits.ts`, `lib/evaluationValidation.ts`, `lib/transferValidation.ts`, `lib/logicValidation.ts`, `lib/problemSources.ts`, `app/api/analyze-concepts/route.ts`, `app/api/generate-problems/route.ts`, `app/api/evaluate-answer/route.ts`, `app/api/logic-questions/route.ts`, `app/api/review-problem-quality/route.ts`, `app/api/transfer-problem/route.ts`, `app/api/ai-connection/route.ts`, `app/api/trial-credits/route.ts`, `app/api/admin/ai-metrics/route.ts`
- **PDF 변환·Google Drive·Cron·학습 스케줄링**: `app/api/convert/route.ts`, `app/api/cron/cleanup-temp-pdf/route.ts`, `app/api/drive/*`, `app/api/reminders/*`, `lib/pdf/*`, `services/pdf-service/*`, `lib/dateUtils.ts`, `lib/retentionModel.ts`, `lib/types.ts`, `components/MockExamModal.tsx`, `components/LogicStrengthenModal.tsx`

---

## 2. 사전 존재 미커밋 변경(Pre-existing Edits) 구분

작업 시작 시점부터 존재했던 아래 변경 사항은 모두 그대로 보존되었습니다.

- **모의고사 제출 후 불변성 강제**: `supabase/migrations/20260101000040_mock_exam_immutability.sql` (untracked)
- **문제 초안 출처 재검토 병합 RPC**: `supabase/migrations/20260101000041_problem_draft_source_review_merge.sql` (untracked)
- **클라우드 학습 콘텐츠 이관·버전 검증 강화**: `lib/cloud/learningMigration.ts`, `lib/cloud/learningPlan.ts`, `lib/cloud/learningRepository.ts`
- **문제 생성 루브릭·사전 소유권·해시 검증**: `app/api/generate-problems/route.ts`
- **기존 회귀·PGlite·모델 라우팅 테스트 및 보고서**: `scripts/test-regressions.mjs`, `scripts/test-regressions-drafts-and-library.mjs`, `scripts/test-difficulty-model-routing.mjs`, `scripts/verify-migration-pglite.mjs`, `docs/security-integrity-remediation-report.md`, `debug.log`, `install.cmd`

---

## 3. 금번 감사에서 발견 및 수정한 결함 (Defects & Fixes)

### 결함 1: `analyze-concepts` 수동 모델 검증·옵션 격리 누락, `resume` 오류 게이트 우회 및 크레딧 임대 누수
- **대상 파일**: [`app/api/analyze-concepts/route.ts`](file:///C:/Users/abcde/Desktop/study-tool/app/api/analyze-concepts/route.ts)
- **트리거 및 원인**:
  1. 타 AI 라우트(`generate-problems`, `evaluate-answer`, `logic-questions`, `review-problem-quality`, `transfer-problem`)와 달리 `analyze-concepts`만 `resolveEffectiveModelForRequest()` / `resolveAndVerifyManualModelConfig()`를 사용하지 않고 `payload.model`을 원시 문자열로 수신함. 이로 인해 플레이스홀더(`55sonnet`)·비허용 모델 차단 및 모델별 옵션 격리가 누락되었고, `{ ...cred.config, model: ... }` 형태로 덮어쓸 경우 Sonnet 선택 시 DeepSeek의 `minOutputTokens: 16000` 및 `jsonMode`가 그대로 복사되는 결함이 있었음.
  2. `if (!cred.ok && action === 'process')` 조건이 `action === 'resume'`을 누락하여, `resume` 요청이 `concurrent_in_progress`(409) 또는 `already_completed` 상태에서 조기 차단되지 않고 `resume_analysis_job` / `init_analysis_job_and_chunks` DB RPC를 먼저 실행한 뒤 502로 실패함.
  3. `executesAi` 경로에서 체험 크레딧 임대(`cred.leaseToken`)를 획득한 뒤 `syncJobToSupabase` 실패 또는 `hasRecoverySigningSecret()` 미설정으로 500을 반환할 때 `releaseTrialCredit()`을 호출하지 않아 임대가 만료(60초)될 때까지 크레딧이 잠김.
- **수정 내용**:
  - `validateRequestedModelInput()`으로 모델 입력 형식을 검증하고, 기존 작업(`dbJobForIdentity?.model_id`)과 다른 모델 요청 시 `400 JOB_MODEL_MISMATCH`를 선행 반환하도록 유지함.
  - 기존 작업 모델이 있는 경우에도 `dbJobForIdentity.model_id` 자체를 `resolveEffectiveModelForRequest()` 및 `resolveAndVerifyManualModelConfig()`에 전달하여 선택·옵션 격리·Gateway 가용성 검증·자격 증명/제공자/키 변경 충돌 검증을 모두 거치며, 검증 후 원시 `config.model` 덮어쓰기를 제거함.
  - `if (!cred.ok && executesAi)`로 `process`와 `resume` 모두 동일하게 `409 CONCURRENT_EXECUTION_BLOCKED` 및 `already_completed` 캐시 복구 경로를 타도록 수정함.
  - `initJobRes` 실패, `JOB_MODEL_MISMATCH`, `SIGNING_SECRET_UNCONFIGURED`, `model_unavailable` 조기 종료 시 `releaseTrialCredit()`을 호출하도록 보완함.
- **회귀 테스트**: [`scripts/test-difficulty-model-routing.mjs`](file:///C:/Users/abcde/Desktop/study-tool/scripts/test-difficulty-model-routing.mjs) Test 13·14(플레이스홀더 차단, Sonnet 옵션 격리, `resume` 409/캐시 복구, 기존 작업 모델 생략 재개 시 기본 모델 변경·미지원 모델·제공자 드리프트 차단, 조기 실패 시 크레딧 환급).

### 결함 2: `lib/mockExam.ts` 인메모리 저장소 계정 간 공유 및 쓰기 실패/손상된 `localStorage` 덮어쓰기
- **대상 파일**: [`lib/mockExam.ts`](file:///C:/Users/abcde/Desktop/study-tool/lib/mockExam.ts)
- **트리거 및 원인**:
  - `inMemoryMockStore`가 `scopedStorageKey(STORAGE_KEY)`로 분리되지 않은 단일 전역 배열이어서 `localStorage` 미지원 환경이나 `JSON.parse` 예외 시 다른 계정의 인메모리 모의고사 목록이 노출될 수 있었음.
  - `localStorage.setItem()` 실패 시 이후 `loadMockExams()`가 오래된 `localStorage` 또는 빈 배열을 반환하여 인메모리 최신 변경을 무시하고, 후속 `saveMockExam()`이 이전 미저장 모의고사를 유실할 수 있었음. 또한 손상된 JSON이 있을 때 덮어써 기존 기록을 소실할 위험이 있었음.
- **수정 내용**:
  - `inMemoryMockStoreByKey = new Map<string, MockExamSession[]>()` 및 `dirtyInMemoryKeys = new Set<string>()`로 키 단위 격리 및 미반영 메모리 상태 추적.
  - `setItem` 실패 또는 손상된 `localStorage` 감지 시 `dirtyInMemoryKeys`를 유지하여 `loadMockExams()`와 후속 `saveMockExam()`이 최신 인메모리 상태를 보존·누적하고, 손상된 `localStorage` 원본은 덮어쓰지 않으며, 저장소 복구 시 누적 항목을 정상 영속화하도록 수정.
- **회귀 테스트**: [`scripts/test-regressions-drafts-and-library.mjs`](file:///C:/Users/abcde/Desktop/study-tool/scripts/test-regressions-drafts-and-library.mjs) (`mockExam` 계정 격리, `setItem` 할당량 실패·연속 저장·복구·동일 ID 최신화·손상 `localStorage` 보존).

### 결함 3: Google Drive 청크/초기화 업로드 시 갱신된 OAuth 토큰 쿠키 미반영
- **대상 파일**: [`app/api/drive/upload/route.ts`](file:///C:/Users/abcde/Desktop/study-tool/app/api/drive/upload/route.ts)
- **트리거 및 원인**:
  - 만료된 Google Drive 액세스 토큰을 `refreshGoogleAccessToken()`으로 갱신한 뒤, 최종 청크 완료(`CASE A` 완료) 및 단일 업로드(`CASE C`) 응답에만 갱신된 세션 쿠키를 저장하고, `action === 'init'`(`CASE B`) 및 중간 청크(`CASE A` 미완료) 응답에는 갱신 쿠키를 쓰지 않아 매 청크마다 재갱신이 발생함.
- **수정 내용**:
  - `sessionRefreshed` 플래그를 두고 `CASE A` 중간 청크 및 `CASE B` 초기화 응답에도 갱신된 암호화 세션 쿠키(`DRIVE_SESSION_COOKIE_NAME`)를 설정하도록 수정.
- **회귀 테스트**: [`scripts/test-regressions-drafts-and-library.mjs`](file:///C:/Users/abcde/Desktop/study-tool/scripts/test-regressions-drafts-and-library.mjs) (`init` 및 중간 청크 응답의 `Set-Cookie` 검증).

### 결함 4: `/api/persist-drafts` 초안 항목 필수 식별자 검증 누락
- **대상 파일**: [`app/api/persist-drafts/route.ts`](file:///C:/Users/abcde/Desktop/study-tool/app/api/persist-drafts/route.ts)
- **트리거 및 원인**:
  - 요청 `drafts` 배열 내 각 항목의 `id`, `subjectId` 존재 여부를 검증하지 않고 저장소 계층으로 전달하여, 기형 입력 시 400 대신 500 DB/매퍼 오류가 발생할 수 있었음.
- **수정 내용**:
  - 모든 항목이 `id`와 `subjectId`(비어 있지 않은 문자열)를 포함하는지 검증하고 누락 시 DB 클라이언트 생성 전에 `400` 반환.
- **회귀 테스트**: [`scripts/test-regressions-drafts-and-library.mjs`](file:///C:/Users/abcde/Desktop/study-tool/scripts/test-regressions-drafts-and-library.mjs) (기형 배열 `400` 차단 및 DB 미호출 검증).

### 결함 5: `/auth/callback` 리다이렉트 origin URL 스킴·헤더 구문 검증 보완
- **대상 파일**: [`lib/auth/redirects.ts`](file:///C:/Users/abcde/Desktop/study-tool/lib/auth/redirects.ts), [`app/auth/callback/route.ts`](file:///C:/Users/abcde/Desktop/study-tool/app/auth/callback/route.ts)
- **트리거 및 원인**:
  - `NEXT_PUBLIC_SITE_URL`에 `javascript:`/`ftp:` 등 비-HTTP(S) 스킴이 설정되거나 `x-forwarded-host`/`x-forwarded-proto`가 비정상 형식일 때 `new URL(...).origin`이 `'null'` 문자열이 되거나 비정상 리다이렉트가 발생할 수 있었음.
- **수정 내용**:
  - `resolveAuthCallbackOrigin()`을 분리해 `NEXT_PUBLIC_SITE_URL`의 `http:`/`https:` 스킴 및 유효한 `origin`을 필수 검증하고, `x-forwarded-host`에 대해 호스트명[:포트] 구문 검증 및 `http`/`https` 프로토콜 정규화를 적용함. (참고: 정규식 검증은 구문 검증이며 신뢰 호스트 검증이 아니므로, 프록시 환경에서의 호스트 신뢰는 `NEXT_PUBLIC_SITE_URL` 설정 또는 리버스 프록시의 헤더 덮어쓰기에 의존함.)
- **회귀 테스트**: [`scripts/test-regressions-drafts-and-library.mjs`](file:///C:/Users/abcde/Desktop/study-tool/scripts/test-regressions-drafts-and-library.mjs) (`resolveAuthCallbackOrigin` 스킴·포트·기형 헤더 테스트).

---

## 4. 검증 결과 (최종 수정 후 실행)

| 검사 항목 | 명령 | 결과 | 비고 / 환경 |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | PASS (exit 0) | 정적 타입 검사 |
| ESLint | `npm run lint` | PASS (exit 0) | 정적 린트 |
| 프로덕션 빌드 | `npm run build` | PASS (exit 0) | Next.js 16.4.6 (Turbopack) |
| 회귀 테스트 | `npm run test:regressions` | PASS (exit 0) | Mock 기반 5개 스크립트(`test-regressions`, `concurrency`, `pdf-convert`, `drafts-and-library` 9건, `recovery` 20건) |
| 통합 스위트 | `npm run test:suite` | PASS (287/287, exit 0) | 로컬 단위/시나리오 |
| 난이도·모델 라우팅 | `node scripts/test-difficulty-model-routing.mjs` | PASS (14/14, exit 0) | Mock 기반 (`analyze-concepts` 신규 Test 13·14 포함) |
| Cron 워크플로우 | `node scripts/verify-cron-workflow.mjs` | PASS (10/10, exit 0) | 로컬 Mock HTTP 서버 |
| PGlite 마이그레이션 | `node scripts/verify-migration-pglite.mjs` | PASS (exit 0) | 인메모리 Postgres (00~41, 시나리오 A~W) |
| Python PDF 서비스 | `py -3 services/pdf-service/test_request_budget.py`, `test_nonblocking_download.py` | PASS (exit 0) | 로컬 Mock 스토리지 서버 |

---

## 5. 정직한 제한 사항 (Limits)

- **미실행 실환경 검증**: 실운영 Supabase Auth/Storage/Postgres(RLS) 네트워크, 실제 Google Drive OAuth 및 BAZE Gateway 유료 AI 호출, 실브라우저 E2E 클릭 플로우는 작업 지침 및 환경 제약상 실행하지 않았습니다.
- **로컬 테스트 범위**: 모든 API/DB/Cron/PDF 서비스 테스트는 로컬 Mock 또는 PGlite 인메모리 Postgres 기반입니다.
- **배포 전 확인 필요**: 사전 존재 미커밋 마이그레이션 `20260101000040_mock_exam_immutability.sql` 및 `20260101000041_problem_draft_source_review_merge.sql`은 운영 DB에 순서대로 적용해야 합니다.
