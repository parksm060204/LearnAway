# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-14 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `05dd8288b3b02fb06130588bd63f1193654f4fa7`
- 현재 작업 기준 HEAD SHA: `05dd8288b3b02fb06130588bd63f1193654f4fa7`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **278 passed** (신규 계정 격리·원자적 lease·초안 멱등성·DB 매핑 검증 포함)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings** (Next.js / ESLint 검사 통과)
  - `npm run build`: **Compiled successfully** (16/16 pages & API routes Turbopack 최적화 빌드 완료)

---

## 1. 문제별 수정 내용 및 검증 상태 구분

본 문서는 테스트 개수나 빌드 통과 여부만으로 완료를 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 코드와 정책이 작성됨
2. **로컬/Mock 검증 완료**: 로컬 단위·회귀 테스트 및 시뮬레이션을 통과함
3. **실제 환경 검증 완료**: 실제 배포 Supabase DB, 실제 AI Gateway, 실제 발송 채널로 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라/크리덴셜 미설정 등으로 실제 환경 검증이 대기 중임

| 항목 | 구현 상태 | 검증 수준 | 주요 수정 및 보안 조치 내용 |
|---|---|---|---|
| **1. 분석 작업 계정 격리** | **구현 완료** | **로컬/Mock 검증 완료**<br>*(운영 DB 적용 대기)* | - 사용자 ID는 서버 인증 세션(`requireApiUser`)에서만 확정<br>- 클라이언트의 임의 jobKey 제출 시 소유권/해시 일치 검증 (`validateJobIdentity`)<br>- 타 사용자 작업 조회 차단 및 오류 메시지로 존재 여부 누설 금지 (`404 NOT_FOUND_OR_FORBIDDEN`)<br>- Supabase DB 내 `materials` 소유자(`user_id`) 검증 추가 |
| **2. 영속 분석 체크포인트 및 원자적 Lease** | **구현 완료** | **로컬/Mock 검증 완료**<br>*(운영 DB 적용 대기)* | - `analysis_jobs` 및 `analysis_job_chunks` 영속 테이블 및 RLS 마이그레이션 (`20260101000013`)<br>- 작업 키에 사용자·자료·본문 해시·도메인·프롬프트 버전·청크 버전 결합<br>- 청크별 `acquireChunkLease` 원자적 선점 및 만료 복구, 늦게 도착한 작업자 쓰기 차단 (`worker_mismatch`)<br>- 유효한 빈 결과(`drafts: []`)도 `completed`로 보존하여 AI 중복 재호출 차단<br>- `action: pause`로 신규 청크 실행 차단 및 이미 발생한 비용 보존 안내<br>- 서버 재시작 후 `syncFromSupabase`로 완료 청크 복원 |
| **3. 분석 재시도 시 개념 초안 중복 방지** | **구현 완료** | **로컬/Mock 검증 완료** | - `generationJobId`를 영속 분석 작업 키에 고정 (`gen_${jobKey}`)<br>- `makeConceptDraftId`: 청크 순서나 배열 인덱스 변화와 무관한 결정론적 초안 ID 부여<br>- `deduplicateConceptDrafts`: 다중 청크에서 추출된 동일 개념의 출처 인용(`additionalEvidences`) 보존<br>- 사용자가 검토·수정·승인한 초안(`isApproved`, `editedByUser`)을 재시도 결과로 덮어쓰지 않음 |
| **4. 알림 구독 데이터 매핑** | **구현 완료** | **로컬/Mock 검증 완료** | - `rowToSubscription`: DB의 실제 snake_case 행(`user_id`, `is_active`, `preferred_hour_kst` 등)을 엄격한 런타임 타입 검증과 함께 도메인 객체로 변환<br>- `is_active === true`의 엄격한 불리언 판정 (비활성 오판 방지)<br>- `target` 공백/누락 엄격 검증, `user_id, channel` 복합키 기반 유일성 보장<br>- 실제 DB 형태의 snake_case 응답을 사용하는 회귀 테스트 추가 |
| **5. 알림 발송 권한·상태·중복·재시도** | **구현 완료** | **로컬/Mock 검증 완료**<br>*(운영 DB 적용 대기)* | - 신규 마이그레이션 (`20260101000014`): 상태 제약조건(`queued`, `sending`, `accepted`, `delivered`, `failed`, `suppressed`) 및 원자적 선점 RPC(`claim_notification_dispatch`, `complete_notification_dispatch`)<br>- 외부 호출 전 DB에 `sending`으로 원자적 슬롯 선점하여 동시 발송 차단<br>- 제공업체(`NOTIFICATION_WEBHOOK_URL`) 미설정 시 성공으로 처리하지 않고 `503` 오류 반환 및 실패 로그 기록<br>- 실패 로그는 제한된 재시도 허용, 성공/진행 중 작업은 재전송 차단<br>- `testSend`도 세션 인증, 본인 소유 수신 대상, 유효한 동의 검증 필수<br>- 테스트 전송용 멱등성 키 분리(`makeTestNotificationIdempotencyKey`)로 일일 할당량 간섭 차단 |
| **6. 실제 복습 기반 예약 알림 연결** | **구현 완료** | **로컬/Mock 검증 완료**<br>*(실제 스케줄러 트리거 대기)* | - 스케줄러 진입점: `POST /api/reminders/cron` 구현 (`CRON_SECRET` 인증)<br>- Asia/Seoul(UTC+9) 기준 현재 선호 시간 사용자 선별 및 50건 단위 페이징<br>- 클라이언트의 `dueItemCount`가 아닌 서버 `study_plan_items` 테이블의 실제 미완료 복습 항목(`assigned_date <= todayKst`, `pending`) 직접 계산<br>- 실제 복습 대상이 없으면 발송 건너뜀 (`skipped`)<br>- 채널은 신뢰성 있는 단일 Webhook/이메일 채널 완성을 우선 목표로 구축 |
| **7. 평가 입력의 신뢰 경계 검증** | **구현 완료** | **로컬/Mock 검증 완료** | - `app/api/evaluate-answer/route.ts`: `problemId` 전달 시 서버 `problems` 테이블에서 공식 문제 조회<br>- 타인의 문제에 대한 접근 차단 (`404 NOT_FOUND_OR_FORBIDDEN`)<br>- 클라이언트 변조 모범답안·배점 대신 서버 공인 문제 데이터(`promptText`, `modelAnswer`, `rubric`)를 강제 적용<br>- 문항의 정밀 검증 여부(`quality_status !== 'verified'`)에 따라 `qualityStatusNotice` 부착하여 "검증 완료"로 단정하지 않고 학습 참고용 고지 제공<br>- 클라이언트 평가 완료 후 저장 실패 시 AI 재호출 없이 저장만 재시도하는 격리 구조 보존 |

---

## 2. 변경 파일 및 신규 마이그레이션 목록

1. **API 및 라우트**
   - `app/api/analyze-concepts/route.ts`: 계정 격리, 자료 소유권 검증, 영속 세션 연동, 청크 원자적 선점, 일시 중단 및 상태 조회
   - `app/api/reminders/dispatch/route.ts`: 실제 서버 학습 계획 기반 복습 건수 계산, 원자적 선점 RPC 연동, 제공업체 미설정 시 실패 처리, 테스트 전송 멱등키 분리
   - `app/api/reminders/settings/route.ts`: DB 행 명시적 매핑 적용, 채널별 유일성 제약 준수, 런타임 유효성 검증
   - `app/api/reminders/cron/route.ts` (신규): 시간별 정기 스케줄러 엔드포인트 (`CRON_SECRET` 인증, Asia/Seoul 선호 시간 필터, 배치 페이징)
   - `app/api/evaluate-answer/route.ts`: 서버 공인 문제 조회 및 변조 모범답안/루브릭 교정, 타인 문제 격리, 품질 검증 상태 고지(`qualityStatusNotice`)

2. **코어 라이브러리 및 타입**
   - `lib/analysisCheckpoint.ts`: 영속 세션 장부, 원자적 lease 선점, 작업 정체성 검증, 늦은 쓰기 차단, 결정론적 초안 ID, 출처 및 사용자 승인 보존 병합
   - `lib/reviewNotifications.ts`: `rowToSubscription`, `subscriptionToRow`, `rowToDeliveryLog` 명시적 변환기, 테스트 전송용 멱등성 키 생성기, 타겟 미설정 검증
   - `lib/types.ts`: `additionalEvidences`, `qualityStatusNotice` 필드 추가

3. **신규 데이터베이스 마이그레이션**
   - `supabase/migrations/20260101000013_analysis_jobs.sql`:
     - `analysis_jobs` 테이블 (작업 키, 사용자 ID, 자료, 해시, 모델, 청크 분할 버전, 상태)
     - `analysis_job_chunks` 테이블 (청크 인덱스, 상태, drafts, worker lease, 완료 시각)
     - 사용자 격리 RLS 정책 적용
   - `supabase/migrations/20260101000014_review_notification_dispatch.sql`:
     - `review_notification_logs` 상태 제약조건 확장 (`queued`, `sending`, `accepted`, `delivered`, `failed`, `suppressed`)
     - 원자적 선점 RPC: `claim_notification_dispatch` (중복 방지, 활성 구독/동의 검증, 실패 재시도 허용)
     - 완료 기록 RPC: `complete_notification_dispatch` (소유권 검증 및 배달 상태 기록)

4. **검증 스크립트**
   - `scripts/test-regressions.mjs`:
     - 계정 격리 및 입력 불일치 거부 검증
     - 원자적 청크 lease 선점 및 늦은 쓰기 차단 검증
     - 결정론적 초안 ID 및 출처/승인 보존 병합 검증
     - DB snake_case 매핑 및 타겟 미설정 차단 검증

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **278개 검사 통과** (기존 274개 + 신규 4개 도메인 검증 추가)
- `npm run test:suite`: **287개 검사 통과** (0개 실패)
- `npx tsc --noEmit`: 컴파일 에러 0개
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (16개 라우트 정상 생성)

### 2) Mock vs 실제 환경 검증 구분 (중요)

> [!IMPORTANT]
> 로컬 테스트 및 Mock 테스트 통과만으로 실제 배포 환경에서의 완전한 정상 작동을 단정하지 않습니다. 본 작업에서는 아래와 같이 검증 단계를 분리하여 관리합니다.

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **분석 세션 및 체크포인트** | **통과**: 인메모리 장부, lease 락킹, 늦은 쓰기 차단, 초안 중복 방지 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 `000013` 적용 전이므로 원격 DB RLS 및 영속성 테스트 대기 | `supabase db push`를 통한 13번 마이그레이션 배포 |
| **알림 스케줄러 & 선점 RPC** | **통과**: snake_case 매핑, 타겟 누락 검증, 멱등키 분리 | **미검증 (대기)**: 운영 Supabase에 `000014` RPC 배포 및 cron runner(Vercel Cron/GitHub Actions) 연동 대기 | `supabase db push`를 통한 14번 마이그레이션 배포, `CRON_SECRET`, `NOTIFICATION_WEBHOOK_URL` 환경 변수 설정 |
| **AI 개념 분석 및 평가** | **통과**: 입력 스키마, 루브릭 검증, 프롬프트 생성, 변조 방지 경계 | **미검증 (대기)**: 유료 토큰 소모 및 학교 게이트웨이 라이브 호출 대기 | 학교 BAZE Gateway API 키 등록 및 유료 호출 예산 승인 |
| **실제 알림 발송** | **통과**: 페이로드 구성, KST 시간 필터, 복습 건수 계산 | **미검증 (대기)**: 외부 Webhook/메일 서버 실제 수신 대기 | 수신 엔드포인트 URL 구성 및 테스트 계정 구독 등록 |

---

## 4. 운영 가이드 및 재시도 절차

### 1) 마이그레이션 적용 순서
운영 Supabase 환경에 아래 순서로 신규 마이그레이션을 순차 적용해야 합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`

### 2) 환경 변수 설정 안내
운영 서버에 다음 환경 변수가 구성되어야 합니다:
- `CRON_SECRET`: 스케줄러(Vercel Cron 또는 외부 크론잡)에서 `/api/reminders/cron` 호출 시 전달하는 Bearer 토큰
- `NOTIFICATION_WEBHOOK_URL`: 알림을 실제 수신자에게 전송하는 외부 웹훅/메일 발송 서비스 엔드포인트 URL (서버 환경 변수로만 보관되며 클라이언트 입력을 허용하지 않음)

### 3) 일일 알림 스케줄러 실행 방법
- 주기: 매시간 정각 (`0 * * * *`)
- 요청: `POST /api/reminders/cron`
- 헤더: `Authorization: Bearer <CRON_SECRET>`
- 동작: 현재 시각의 KST 시간대(`preferred_hour_kst`)와 일치하고 `is_active = true`인 구독자를 조회하여 실제 당일 복습 항목이 1개 이상인 경우에만 멱등키 기반 원자적 선점 후 발송

### 4) 실패 확인 및 재시도 절차
- 알림 발송 실패 시:
  - `review_notification_logs` 테이블에 `status = 'failed'`, `error = <오류 메시지>`로 기록됩니다.
  - 당일 복습 알림은 `claim_notification_dispatch` RPC에 의해 실패한 경우에 한하여 동일 멱등키로 재시도가 허용됩니다 (성공하거나 진행 중인 작업은 재전송 차단).
- 분석 작업 실패 시:
  - `analysis_job_chunks` 테이블에 `status = 'failed'`, `last_error = <오류 메시지>`로 보존됩니다.
  - 사용자가 동일한 본문으로 재개 요청 시, 이미 완료된 청크는 건너뛰고 실패하거나 대기 중인 청크만 선점하여 이어서 처리합니다.
