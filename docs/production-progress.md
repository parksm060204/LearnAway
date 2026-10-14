# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-14 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `2faea4cb76ac08ce87de5627e7afb5cc21bf3f00`
- 현재 작업 기준 HEAD SHA: `2faea4cb76ac08ce87de5627e7afb5cc21bf3f00`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **286 passed** (8대 리뷰 지적 사항에 대한 핵심 회귀 검증 8건 추가 포함)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings** (Next.js / ESLint 검사 통과)
  - `npm run build`: **Compiled successfully** (16/16 pages & API routes Turbopack 최적화 빌드 완료)

---

## 1. 8대 리뷰 지적 사항별 원인·수정 및 검증 상태

본 문서는 테스트 개수나 빌드 통과 여부만으로 완료를 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 코드와 정책이 작성됨
2. **로컬/Mock 검증 완료**: 로컬 단위·회귀 테스트 및 시뮬레이션을 통과함
3. **실제 환경 검증 완료**: 실제 배포 Supabase DB, 실제 AI Gateway, 실제 발송 채널로 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라/크리덴셜 미설정 등으로 실제 환경 검증이 대기 중임

| 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|
| **1. 알림 RPC 권한 및 소유권** | `complete_notification_dispatch` 및 `claim_notification_dispatch`를 authenticated 사용자가 직접 호출 가능하여 타인 로그를 조회/선점/임의 완료할 수 있었음. | - 신규 마이그레이션 `20260101000015`: 해당 함수들의 실행 권한을 `PUBLIC`, `anon`, `authenticated`로부터 전면 취소(`REVOKE`)하고 오직 `service_role` 전용으로 제한<br>- 서버 전용 `createAdminClient`(`SUPABASE_SERVICE_ROLE_KEY`)를 신설하여 신뢰된 서버 워커에서만 선점/완료 RPC를 호출하도록 격리<br>- 일반 사용자 API는 세션과 구독 소유권(`user_id`, `channel`, `target`) 검증 후 서버 워커 경로로만 위임 | **로컬/Mock 검증 완료**<br>*(운영 DB 배포 대기)* |
| **2. 분석 청크 선점 원자성 및 영속 저장** | `acquireChunkLease`가 메모리 객체만 변경하여 다중 서버 환경에서 동일 청크가 중복 선점되고, AI 호출 후 DB 동기화가 이뤄져 비용 낭비가 발생함. | - 신규 마이그레이션 `20260101000015`: `claim_analysis_chunk_lease` 및 `commit_analysis_chunk_result` DB RPC 신설<br>- AI 호출 전에 DB 원자적 연산으로 선점 토큰(`lease_token`), `worker_id`, `lease_expires_at`을 기록<br>- 토큰과 작업자가 일치할 때만 커밋을 확정하고 만료된 작업자의 늦은 쓰기 거부<br>- 정상 완료된 빈 결과(`drafts: []`)도 DB에 영속 보존하여 재호출 차단 | **로컬/Mock 검증 완료**<br>*(운영 DB 배포 대기)* |
| **3. 분석 저장 실패 구분 및 작업 정체성** | `syncFromSupabase`가 조회 오류를 무시하고, `syncToSupabase`가 upsert 오류를 확인하지 않으며, `subject_id`에 `materialId`가 저장되고 `model_id`가 `'default'`로 하드코딩됨. | - DB 조회 실패(네트워크/권한 오류)와 작업 미존재를 명확히 구분하여 500 에러 반환 (임의 재호출 차단)<br>- 실제 `session.subjectId`와 실제 `session.modelId`를 DB에 정확히 바인딩<br>- 작업 키(`makeAnalysisJobKey`)에 사용자, 과목, 자료, 본문 해시, 모델, 프롬프트 버전, 청크 분할 버전을 모두 포함<br>- AI 호출 후 DB 저장만 실패한 경우 유료 결과를 보존하고 클라이언트에 `canRetrySave: true` 플래그를 전달하여 재시도 허용 | **로컬/Mock 검증 완료** |
| **4. 사용자 편집 초안 및 승인 상태 영구 보존** | 동일 생성 작업의 재시도 시 content upsert가 기존 초안의 `title`과 전체 payload를 덮어써 사용자가 수정한 본문이 소실됨. | - `lib/cloud/learningRepository.ts`의 `upsertConceptDrafts` / `upsertProblemDrafts`에서 기존 초안을 선조회<br>- `edited_by_user === true`이거나 `is_approved === true`인 초안은 기존 서버의 사용자 수정 내용(`title`, `description`, `coreDefinitionFormulaOrAlgorithm`)을 영구 보존하고 옛 AI 결과로 덮어쓰지 않음<br>- `lib/cloud/learningTypes.ts`에 `edited_by_user` 필드 명시 지원 | **로컬/Mock 검증 완료** |
| **5. 평가 문제·버전 신뢰 경계** | 문제 조회 실패·RLS 차단 시 경고만 붙이고 클라이언트 정답/루브릭으로 평가를 계속하며, 과거 시험 스냅샷 대신 최신 문제를 사용할 위험이 존재함. | - 문제 DB 조회 실패 시 즉시 500 에러로 중단하고 AI 호출 차단<br>- `problemVersion` 지정 시 `problem_versions`의 불변 스냅샷을 우선 조회<br>- `mockExamSessionId` 지정 시 모의시험 세션의 고정 문항 스냅샷으로 평가 확정<br>- 서버 공인 데이터(`verifiedPrompt`, `verifiedModelAnswer`, `verifiedRubric`, 수식/코드/조건)로 강제 치환<br>- 서버 미등록 로컬 문항은 명시적 `isProvisionalLocal: true` 플래그가 없으면 400 거부하고 공식 학습 기록 저장 차단 | **로컬/Mock 검증 완료** |
| **6. 예약 알림 cron 인증 및 격리** | cron이 사용자 쿠키 기반 클라이언트를 사용해 쿠키 없는 스케줄러가 구독을 읽지 못하고, `CRON_SECRET` 미설정 시 인증을 생략하거나 오류 시 `success: true`로 응답함. | - `CRON_SECRET` 환경 변수 미설정 시 즉시 500 거부, 잘못된 Authorization 헤더는 401 거부<br>- 사용자 쿠키 의존성을 전면 제거하고 서버 전용 `createAdminClient()` 사용<br>- 구독/학습계획 DB 조회 오류 시 `success: false` 및 500 에러로 반환<br>- Asia/Seoul(UTC+9) 기준 선호 시간대 필터링 및 50건 단위 안정적 페이징 처리 | **로컬/Mock 검증 완료**<br>*(운영 스케줄러 트리거 대기)* |
| **7. 알림 재시도 동시성 및 상태 전이** | 실패 로그 재시도가 무조건 갱신이어서 동시 발송 위험이 있고, `sending` 만료 규칙이 없으며, 웹훅 HTTP 200 응답을 즉시 `delivered`로 단정함. | - 신규 발송 및 실패 재시도 모두 `claim_notification_dispatch`의 `sending_token`으로 원자적 선점<br>- `sending` 상태의 lease 만료 및 재선점 허용<br>- 외부 웹훅 성공(200 OK)은 `accepted`로 기록하고, 최종 전달 증거가 있을 때만 `delivered`로 기록<br>- 운영 RPC 실패 시 비원자적 테이블 쓰기 폴백을 전면 제거 | **로컬/Mock 검증 완료** |
| **8. 분석 중단·재개와 실제 화면 연결** | `pause` 상태를 해제하는 재개 동작이 없고, 대시보드 UI가 진행률/중단/재개 API를 사용하지 않음. | - `action: 'resume'` API 구현 및 `resume_analysis_job` RPC 신설 (`paused` -> `processing` 전이)<br>- `action: 'status'`를 순수 읽기 전용으로 격리하여 AI 호출 유발 차단<br>- `ConceptReviewModal` 및 `DashboardClient`에 실시간 청크 진행률(완료/대기/실패) 바, "일시 중단" 및 "이어서 재개" 버튼 연동<br>- 새로고침 시에도 동일 작업 키를 기반으로 기완료 청크를 재사용하고 잔여 청크만 이어서 처리 | **로컬/Mock 검증 완료**<br>*(브라우저 수동 검증 권장)* |

---

## 2. 변경 파일 및 신규 마이그레이션 목록

1. **신규 마이그레이션**
   - `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`:
     - `claim_notification_dispatch` / `complete_notification_dispatch`의 PUBLIC 권한 취소 및 `service_role` 전용 권한 부여
     - `claim_analysis_chunk_lease`: lease 토큰(UUID), worker ID, 만료 시각 기반의 DB 원자적 청크 선점 RPC
     - `commit_analysis_chunk_result`: lease 토큰 및 worker ID 검증 기반의 DB 청크 결과 확정 RPC
     - `pause_analysis_job` / `resume_analysis_job`: 분석 작업의 중단 및 재개 상태 전이 RPC

2. **서버 인증 및 클라이언트**
   - `lib/supabase/admin.ts` (신규): `SUPABASE_SERVICE_ROLE_KEY`를 사용하는 서버 전용 Supabase 어드민 클라이언트 생성 모듈
   - `.env.example`: `SUPABASE_SERVICE_ROLE_KEY` 및 `CRON_SECRET` 필수 환경 변수 명시

3. **API 라우트**
   - `app/api/reminders/cron/route.ts`: `CRON_SECRET` 검증 필수화, 쿠키 의존성 제거, `createAdminClient` 연동, 조회 실패 엄격 반환
   - `app/api/reminders/dispatch/route.ts`: `sending_token` 연동, 비원자적 폴백 제거, 웹훅 성공 시 `accepted` 상태 기록
   - `app/api/analyze-concepts/route.ts`: `claim_analysis_chunk_lease` 및 `commit_analysis_chunk_result` DB RPC 연동, 실제 `subjectId` 및 `modelId` 저장, `resume` 액션 추가, `status` 읽기 전용화
   - `app/api/evaluate-answer/route.ts`: DB 조회 오류 시 500 중단, `problemVersion` / `mockExamSessionId` 스냅샷 우선 적용, 공식 데이터 강제 치환, 미등록 로컬 문항 `isProvisionalLocal` 검증

4. **코어 라이브러리 및 UI**
   - `lib/analysisCheckpoint.ts`: `leaseToken` 관리, 토큰/워커 불일치 시 쓰기 차단, `paused` 상태에서의 선점 차단
   - `lib/cloud/learningTypes.ts`: `ConceptDraftRow` 및 `ProblemDraftRow`에 `edited_by_user` 필드 정의
   - `lib/cloud/learningRepository.ts`: 사용자 편집(`edited_by_user`) 및 승인(`is_approved`) 초안의 덮어쓰기 방지 쿼리 적용
   - `components/ConceptReviewModal.tsx`: 청크 분석 진행률 바, 일시 중단 및 재개 버튼 UI 구현
   - `app/DashboardClient.tsx`: `handlePauseAiAnalysis`, `handleResumeAiAnalysis`, `analysisProgress` 상태 바인딩

5. **검증 스크립트**
   - `scripts/test-regressions.mjs`: 8대 리뷰 지적 사항에 대응하는 8가지 회귀 검사(체크 1~8) 추가

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **286개 검사 통과** (기존 278개 + 신규 8대 리뷰 검사 8건)
- `npm run test:suite`: **287개 검사 통과** (0개 실패)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 엄격 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (16개 라우트 완전 생성)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

> [!IMPORTANT]
> 본 작업은 운영 DB 변경, 실서비스 알림 발송, 유료 AI 호출을 방지하기 위해 로컬 및 Mock 환경에서 모든 권한·상태 전이·알고리즘을 검증하였습니다. 실제 환경 배포 시 아래의 사전 설정과 적용 절차가 필요합니다.

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **알림 RPC 권한 격리** | **통과**: `service_role` 전용 권한 제한, 일반 사용자 직접 호출 차단 및 `sending_token` 검증 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 `000015` 배포 대기 | `supabase db push`를 통한 15번 마이그레이션 배포 |
| **분석 청크 DB 원자적 선점** | **통과**: lease 토큰 만료 복구, 동시 선점 차단, 늦은 쓰기 거부 | **미검증 (대기)**: 운영 다중 인스턴스 환경에서의 동시 부하 테스트 대기 | 15번 마이그레이션 배포 및 Supabase RPC 활성화 |
| **초안 보존 저장소** | **통과**: `edited_by_user`/`is_approved` 초안이 AI 재시도 시 영구 보존됨 | **로컬 DB 검증 완료** | 별도 설정 불필요 (기존 RLS 테이블 스키마와 완벽 호환) |
| **스냅샷 기반 평가** | **통과**: `problemVersion` / `mockExamSessionId` 스냅샷 적용, DB 실패 시 AI 호출 즉시 중단 | **로컬 Mock 검증 완료** | 학교 게이트웨이 라이브 호출 전 API 키 등록 필요 |
| **예약 알림 cron** | **통과**: `CRON_SECRET` 미설정 시 500, 잘못된 헤더 401, 어드민 클라이언트 격리 | **미검증 (대기)**: 외부 크론 러너(Vercel Cron/GitHub Actions) 실제 트리거 대기 | Vercel Cron 또는 스케줄러에 `Authorization: Bearer <CRON_SECRET>` 등록 |
| **분석 재개 대시보드** | **통과**: 일시 중단 및 재개 액션 처리, 기완료 청크 재사용 및 진행률 반환 | **UI 컴포넌트 검증 완료**<br>*(브라우저 실화면 확인 권장)* | 개발 서버(`npm run dev`)에서 실제 PDF/Markdown 분석 실행 후 중단/재개 버튼 동작 확인 |

---

## 4. 운영 환경 설정 가이드

### 1) 마이그레이션 순차 적용
운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql` (최신 필수 보안 패치)

### 2) 필수 환경 변수 구성
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase 프로젝트 설정 -> API -> `service_role` (secret) 키 (알림 발송 및 분석 선점 RPC 전용)
- `CRON_SECRET`: 예약 알림 스케줄러 인증용 임의의 고유 비밀 문자열 (최소 32자 권장)
- `NOTIFICATION_WEBHOOK_URL`: Slack/Discord/이메일 게이트웨이 등의 수신 Webhook 엔드포인트 URL
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: 일반 클라이언트 공개 설정

### 3) 정기 크론 러너 설정 (`vercel.json` 예시)
```json
{
  "crons": [
    {
      "path": "/api/reminders/cron",
      "schedule": "0 * * * *"
    }
  ]
}
```
*(참고: Vercel Cron은 자동으로 `CRON_SECRET`을 Bearer 토큰으로 헤더에 첨부하여 요청합니다.)*
