# LearnAway 보안·무결성 수정 및 전체 코드 재리뷰 보고서

## 1. 수정 요약 (4건 및 보완 사항 A~F)

1. **[P1] 모의고사 제출 후 불변성 강제 (`supabase/migrations/20260101000040_mock_exam_immutability.sql`)**
   - `guard_mock_exam_session_update()` 트리거를 교체하여 `old.status <> 'in_progress'`(`submitted`, `graded`, `recorded`, `abandoned`) 상태에서 `id`, `user_id`, `subject_id`, `duration_minutes`, `created_at`, `ends_at`, `submitted_at` 및 `payload` 내 `answers`, `reasons`, `isReasonNotApplicable`, `reasonNotApplicableJustification`, `problems`, `selectedConceptIds`, `selectedTypes`, 시험 메타데이터 변경을 `MOCK_SESSION_IMMUTABLE` 예외로 차단(직접 테이블 `UPDATE` 포함).
   - `same_mock_exam_timestamp()` 헬퍼로 `timestamptz` 동등성을 판정해 `Z`와 `+00:00` 포맷 차이 및 `rowToMockExamSession()`의 서버 `submitted_at` 왕복은 정상 허용하고, 실제 시각 변조나 잘못된 시각 문자열은 `MOCK_SESSION_IMMUTABLE`로 차단.
   - `save_mock_exam_grading()` RPC가 전체 `p_payload`를 덮어쓰지 않고 불변 필드 변조 시 `MOCK_SESSION_IMMUTABLE`을 발생시키며, 허용된 `status`, `evaluations`, `recordedAttemptIds`만 기존 `payload`에 병합 갱신하도록 수정.
   - **적용 필요 마이그레이션**: `supabase/migrations/20260101000040_mock_exam_immutability.sql`.

2. **[P1] 학습 콘텐츠 클라우드 이관 버전 누락 복구 및 검증 강화 (`lib/cloud/learningMigration.ts`, `lib/cloud/learningRepository.ts`, `lib/cloud/learningPlan.ts`)**
   - `listProblemVersionsByProblemIds()`에 `CHUNK_SIZE = 100` ID 청킹과 `fetchAllPages()` 페이지네이션, `row.version` 권위 매핑을 적용해 Supabase REST 1,000행 제한 및 URL 길이 한도를 방지.
   - `migrateLocalLearningToCloud()`에서 `plan.problems` 스킵 여부와 무관하게 모든 로컬 문제의 누락된 버전 스냅샷(`v1` 포함)을 insert-only(`ignoreDuplicates: true`)로 독립 복구하며, `problemSnapshots()`가 `versionHistory`에 현재 버전이 빠진 경우도 보완.
   - `upsertConcepts()`, `upsertConceptDraftsFull()`, `upsertProblemDraftsFull()`에 `ignoreDuplicates: true`를 적용해 동시 생성/수정된 최신 서버 데이터를 덮어쓰지 않도록 보호.
   - `learningPlan.ts`에 `canonicalJson()`(`stableStringify` + `undefined` 제거 + DB 기본값 정규화) 및 `problemSnapshotIdentity()`를 도입해 Postgres JSONB 키 재정렬에 의한 오탐을 방지하고, `verifyMigration()`이 버전 번호뿐 아니라 스냅샷 내용(`promptText`, `modelAnswer`, `rubric` 등)과 `conceptDrafts`/`problemDrafts`까지 검증한 뒤에만 `verifiedVersion: 2` 완료 마커를 기록.

3. **[P2] 문제 생성 AI 루브릭 스키마 엄격 검증 (`app/api/generate-problems/route.ts`)**
   - `entry.maxScore` 오류·누락 시 `25`점으로 보정하던 폴백을 제거하고 `lib/evaluationValidation.ts`의 `validateEvaluationRubric()`을 재사용하여 숫자·양수·빈 라벨·중복 ID·총합 100점을 엄격 검증.
   - 비정상 루브릭 문항은 정상 검증(`draft`/`isVerified`)·정상 완료(200)·과금 정산(`settleTrialCredit`) 경로에서 배제하고, 유효 문항이 없으면 체험 크레딧을 환급(`releaseTrialCredit`)하고 `502`를 반환.

4. **[P2] 문제 생성 사전 소유권·해시 검증 및 재시도 출처 보존 (`app/api/generate-problems/route.ts`, `lib/cloud/learningRepository.ts`, `supabase/migrations/20260101000041_problem_draft_source_review_merge.sql`)**
   - `createClient()` 실패 시 fail-open 없이 즉시 `500` 반환. AI 호출·크레딧 예약 전 `subjects` 소유권, `concepts` 소유권·과목 일치(`serverVerifiedConceptIds` 추적), `materials` 소유권·과목 일치 및 실제 저장 본문/해시(`sync_body` + `markdown_path` 다운로드 해시 또는 `materialContentHash` `mh_...` / 레거시 `h_...`)를 검증.
   - RLS 빈 결과 등으로 서버 소유권/존재가 확인되지 않은 자료(`!matRow`) 또는 개념(`!hasServerVerifiedConcepts`)은 로컬 전용 진행은 유지하되 절대 `'verified'` provenance나 `isVerified: true`를 부여하지 않고 `'unverified'` / `needs_review`로 격리.
   - `isSaveRetry` 및 `already_completed` 작업 캐시 복구 시 원문이 변경·삭제(요청 본문에 구 원문이 남아 있는 경우 포함)되었거나 Storage 다운로드가 `{ error, data: null }` / 예외로 실패한 경우 AI 재호출·신규 예약 없이 기존 생성 초안을 보존하며 `needsSourceReview: true`, `sourceVerificationStatus: 'needs_review'`를 부여(캐시 미존재 시 `502 SOURCE_VERIFICATION_FAILED` / `400 SOURCE_HASH_MISMATCH` 차단).
   - **적용 필요 마이그레이션 41 (`mark_problem_draft_source_review` RPC)**: `upsertProblemDrafts()`가 `existing` 초안을 만났을 때 `FOR UPDATE` 행 잠금으로 승인/거절 상태, 최신 다른 원문 재검증 결과, 사용자 편집 내용(`content_version > 1` 포함)을 모두 보존한 채 `needsSourceReview` 및 `sourceVerificationStatus: 'needs_review'`만 원자적으로 병합 영속화.

---

## 2. 검증 결과

| 검사 | 명령 | 결과 | 환경 / 비고 |
|---|---|---|---|
| ESLint | `npm run lint` | PASS (exit 0) | 정적 린트 |
| TypeScript | `npx tsc --noEmit` | PASS (exit 0) | 정적 타입 검사 |
| 회귀 테스트 | `npm run test:regressions` | PASS (exit 0) | Mock 기반 (`test-regressions`, `concurrency`, `pdf-convert`, `drafts-and-library` 5건, `recovery` 20건 포함) |
| 통합 스위트 | `npm run test:suite` | PASS (287/287, exit 0) | 로컬 단위/시나리오 |
| PGlite 마이그레이션 | `node scripts/verify-migration-pglite.mjs` | PASS (42개 마이그레이션 00~41, 시나리오 A~W 통과, exit 0) | PGlite 인메모리 Postgres (운영 DB 아님) |
| Cron 워크플로우 | `node scripts/verify-cron-workflow.mjs` | PASS (10/10, exit 0) | 로컬 Mock HTTP 서버 |
| 난이도·모델 라우팅 | `node scripts/test-difficulty-model-routing.mjs` | PASS (12/12, exit 0) | Mock 기반 (실제 AI 호출 없음) |
| 프로덕션 빌드 | `npm run build` | PASS (exit 0) | Next.js 16.4.6 Turbopack |
| Python PDF 서비스 | `py -3 services/pdf-service/test_request_budget.py`, `test_nonblocking_download.py` | PASS (exit 0) | 로컬 Mock 스토리지 서버 (이전 실행 통과, 금번 무수정) |
| 실브라우저 / 운영 DB / 유료 AI | — | 미실행 | 작업 지침상 금지 및 실환경 미연동 |

---

## 3. 전체 코드 재리뷰 및 제한 사항

- **타 AI 라우트 재검토**: `app/api/review-problem-quality/route.ts`, `app/api/transfer-problem/route.ts`, `app/api/logic-questions/route.ts`는 클라이언트 임시/연습 문제 변환을 지원하는 의도된 경로이며 `requireApiUser()` 인증과 호출자 본인 크레딧/키를 사용하고 DB 상태를 직접 변조하지 않으므로 보안 결함으로 확정하지 않음.
- **제한 사항**: PGlite 및 Mock 기반 검증으로 실제 운영 Supabase Auth/Storage/RLS 네트워크 동작, 실브라우저 E2E, 실제 BAZE Gateway 유료 AI 호출은 미검증.
