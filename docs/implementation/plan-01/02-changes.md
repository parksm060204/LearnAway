# LearnAway — Plan 01 코드 변경 이력서 (Changes)

## 1. 변경된 파일 목록

| 파일 경로 | 변경 유형 | 관련 영역 |
|---|---|---|
| `supabase/migrations/20260101000026_harden_temp_pdf_and_fencing_tokens.sql` | **신규 생성** | 임시 파일 장부 RLS, 구형 RPC 정리, 펜싱 토큰 필수화 |
| `supabase/migrations/20260101000027_tiered_trial_credits_by_account_type.sql` | **신규 생성** | 계정 유형별(게스트 1회, 일반 3회) 차등 크레딧 지급 |
| `lib/pdf/tempStorage.ts` | **신규 생성** | 임시 스토리지 경로 엄격 검증 (`validateTempStoragePath`) |
| `app/api/cron/cleanup-temp-pdf/route.ts` | **신규 생성** | 서버/스케줄러 전용 정기 정리 엔드포인트 (`CRON_SECRET` 필수) |
| `app/api/convert/route.ts` | **수정** | 장부 등록 실패 시 티켓 미발급, 사용자 임의 경로 전달 차단, 일반 정리 액션 제거 |
| `lib/trialCredits.ts` | **수정** | 펜싱 토큰 필수화, 구조화된 에러 반환, 계정별 차등 크레딧 상수/함수 연동 |
| `lib/aiCredentials.ts` | **수정** | 손상된 캐시(settled이나 결과 null) 명시적 에러 처리 |
| `app/api/generate-problems/route.ts` | **수정** | 펜싱 실패 시 초안 저장 차단, 캐시/초안 보존 확인 전 정산 차단 |
| `app/api/analyze-concepts/route.ts` | **수정** | 펜싱 실패 시 개념 저장 차단, 캐시/개념 보존 확인 전 정산 차단 |
| `app/api/evaluate-answer/route.ts` | **수정** | 펜싱 실패 시 세션 저장 차단, 캐시 확인 전 정산 차단 |
| `app/api/reminders/cron/route.ts` | **수정** | Vercel Cron 규격에 맞추어 `GET` 핸들러 추가 (POST와 공통 로직 공유) |
| `lib/storage.ts` | **수정** | `safeSetItem` 실패 시 boolean 반환 및 `inMemoryStore` 안전 폴백 |
| `vercel.json.example` | **신규 생성** | Vercel Cron 스케줄 구성 예시 |
| `scripts/test-regressions.mjs` | **수정** | 5대 리뷰 결함 및 P01-02, P01-06 전수 회귀 테스트 추가 |

---

## 2. 세부 수정 내용 및 호환성 영향

### 1) DB 마이그레이션 26 & 27 (`supabase/migrations/`)
- **수정 전**:
  - `temp_pdf_conversion_jobs`에 일반 사용자 `INSERT`/`UPDATE` 권한이 있어 장부 변조 가능.
  - 구형 RPC 7개 오버로드 잔존 및 `p_lease_token is null` 허용.
  - 모든 신규 계정에 일괄 1회 크레딧 지급.
- **수정 내용**:
  - `temp_pdf_conversion_jobs` 권한을 `service_role` 전용으로 제한, 일반 사용자는 오직 SELECT만 가능.
  - 구형 오버로드 DROP 및 `p_lease_token` 필수화 (`null`, 빈 문자열, 불일치 시 엄격 거부).
  - 마이그레이션 27: `get_or_create_trial_credits`에서 `username_accounts`에 존재하는 게스트 계정은 1회, Google/일반 이메일 계정은 3회 최초 지급. 기존 계정의 `granted_credits`와 `balance`는 100% 보존 (`ON CONFLICT DO NOTHING`).
- **호환성 영향**:
  - 기존 데이터 손실 없음. 기존 사용자 잔액 보존.

### 2) 임시 파일 보안 검증 모듈 (`lib/pdf/tempStorage.ts`)
- **수정 전**:
  - 경로 검증이 단순 `startsWith`에 의존하여 traversal(`..`), 특수문자, 인코딩 우회에 취약.
- **수정 내용**:
  - `validateTempStoragePath(userId, jobId, storagePath)`:
    1. 정확히 4개 세그먼트(`[userId, 'temp-convert', jobId, fileName]`) 분할 검증.
    2. null 바이트, URL 인코딩(`%2e`), `..` 디렉터리 탐색 차단.
    3. 영구 학습 자료 경로(`materials/`) 참조 절대 거부.

### 3) 정기 정리 전용 엔드포인트 분리 (`app/api/cron/cleanup-temp-pdf/route.ts`)
- **수정 전**:
  - 일반 `/api/convert`에서 누구나 정리 실행 가능.
- **수정 내용**:
  - 일반 라우트에서 정리 액션 완전 제거.
  - 전용 엔드포인트 분리, `Authorization: Bearer <CRON_SECRET>` 및 `x-cron-secret` 검증.
  - `claim_expired_temp_pdf_jobs` RPC를 통한 원자적 선점(`FOR UPDATE SKIP LOCKED`).
  - 오염된 장부 발견 시 파일 삭제 호출 0회 및 장부 상태를 `quarantined`로 즉시 격리.

### 4) 펜싱 토큰 기반 학습 데이터 영속화 차단 (`app/api/*/route.ts`)
- **수정 전**:
  - `recordTrialResultReady`가 실패해도 초안 저장 계속 수행.
- **수정 내용**:
  - `recordTrialResultReady` 실패 시 `persistProblemDraftsForResponse`, 개념 초안 저장, 답안 세션 저장을 즉시 중단하고 409 Conflict 반환.
  - 결과 캐시 보존 및 DB 초안 영속 저장이 모두 성공한 경우에만 `settleTrialCredit` 호출.

### 5) Vercel Cron GET 핸들러 지원 (`app/api/reminders/cron/route.ts`)
- **수정 전**:
  - `POST` 메서드만 지원하여 Vercel Cron의 GET 호출 시 405 에러 발생.
- **수정 내용**:
  - 공통 `handleCron(req: NextRequest)` 함수로 로직을 일원화하고, `GET`과 `POST`를 모두 export.

### 6) 로컬 스토리지 안정성 강화 (`lib/storage.ts`)
- **수정 전**:
  - `safeSetItem`이 `void` 반환 및 용량 초과 예외 발생 시 호출자가 알 수 없음.
- **수정 내용**:
  - `safeSetItem`이 저장 성공 시 `true`, 실패 시 `false` 반환.
  - `QuotaExceededError` 발생 시 `inMemoryStore`에 안전 복사하여 세션 중 데이터 증발 및 크래시 방지.
  - 주요 저장 함수(`saveStoredConcepts`, `saveStoredMaterials` 등)가 저장 결과 boolean을 반환하도록 개선.

---

## 3. 추가된 회귀 테스트 요약

`scripts/test-regressions.mjs`에 다음 시나리오 추가 완료:
1. `리뷰 문제 1`: 비인가 cron 호출 거부(401), 오염된 장부(영구 경로, `..` traversal) 탐지 시 스토리지 파일 삭제 0회 및 `quarantined` 격리, 본인 소유 임시 파일의 정상 취소 확인.
2. `리뷰 문제 2`: 오래된 lease 토큰을 가진 지연 실행 A의 결과 기록/초안 저장/정산 차단(`STALE_LEASE_TOKEN`, 409 반환), 최신 실행 B의 데이터 및 크레딧 보존 확인.
3. `리뷰 문제 3`: 캐시 없는 작업의 정산 차단(`MISSING_CACHED_RESULT`), 캐시 유실된 settled 상태를 정상 성공으로 위장하지 않고 에러로 반환 확인.
4. `리뷰 문제 4`: `record_trial_result_ready`, `settle_trial_credit`, `release_trial_credit`에 null/빈 토큰 전달 시 `LEASE_TOKEN_REQUIRED` 즉시 거부, 환급된 작업의 재차감 없는 확정 차단 확인.
5. `리뷰 문제 5`: DB insert 실패 시 티켓 미발급(500), 10분 이상 중단된 `converting` 작업의 만료 선점 및 회수 확인.
6. `P01-02`: 게스트 계정 1회 지급, 일반 가입 계정 3회 지급, 개인 API 키 사용 시 크레딧 미차감, 소진 시 차단, 게스트-일반 전환 시 중복 지급 방지 확인.
7. `P01-06`: 로컬스토리지 저장 실패 및 손상 데이터에 대한 무결성 검증과 안전한 boolean 반환 확인.
