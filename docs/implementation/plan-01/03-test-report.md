# LearnAway — Plan 01 검증 및 테스트 결과 보고서 (Test Report)

## 1. 실행 명령 및 최종 결과 요약

모든 명령은 Windows 작업 환경에서 실제 실행되었으며, 100% 통과했습니다.

| 검증 단계 | 실행 명령 | 종료 코드 | 결과 | 비고 |
|---|---|---|---|---|
| **정적 타입 검사** | `npx tsc --noEmit` | **0** | **PASS** | TypeScript 타입 에러 0건 |
| **코드 스타일 & 린트** | `npm run lint` | **0** | **PASS** | ESLint 오류 0건, 경고 0건 |
| **단위 및 도메인 검증** | `npm run test:suite` | **0** | **PASS** | **287개 테스트 전체 통과 (0 failed)** |
| **핵심 회귀 검증** | `npm run test:regressions` | **0** | **PASS** | **361개 회귀 테스트 전체 통과 (0 failed)** |
| **프로덕션 빌드** | `npm run build` | **0** | **PASS** | Next.js 16.3.6 Turbopack 빌드 성공 |

---

## 2. 주요 테스트 시나리오 및 통과 내역

### A. P01-02: 계정 유형별 AI 체험 크레딧 정책
1. **일반 가입 계정 (Google OAuth / 표준 이메일)**:
   - `get_or_create_trial_credits` 호출 시 `granted: 3, balance: 3, isGuest: false` 확인.
   - 재로그인 및 새로고침 시 기존 3회 잔액 유지 확인.
2. **게스트 / 간편 아이디 계정 (`username_accounts`)**:
   - `get_or_create_trial_credits` 호출 시 `granted: 1, balance: 1, isGuest: true` 확인.
   - 1회 AI 호출 수행 후 `balance: 0` 확인.
   - 0회 상태에서 추가 호출 시 `INSUFFICIENT_CREDITS`로 완벽 차단 확인.
3. **게스트에서 일반 계정 전환 시나리오**:
   - 이미 레코드가 존재하는 계정은 `ON CONFLICT DO NOTHING`에 의해 추가 크레딧 중복 지급 없이 기존 잔액 유지 확인.
4. **개인 API 키 사용자**:
   - 개인 키가 등록된 계정은 AI 호출 시 체험 크레딧이 차감되지 않음(`balance` 보존) 확인.

### B. 임시 파일 정리 및 교차 사용자 삭제 방지
1. **비인가 호출 차단**:
   - 헤더에 `CRON_SECRET`이 없거나 일치하지 않으면 즉시 401 Unauthorized 반환.
2. **오염된 장부 격리 및 파일 삭제 0회 보장**:
   - 장부에 타인의 영구 파일(`victim-user/materials/important.pdf`) 또는 traversal 경로(`../`)가 기재되어 있어도, 삭제 직전 엄격 경로 검증에 의해 감지되어 스토리지 파일 삭제 API 호출 횟수 **0회**.
   - 해당 장부 행은 `quarantined` 상태로 즉시 격리.
3. **정상 본인 임시 파일 취소/정리**:
   - 본인이 생성한 정규 임시 파일(`{userId}/temp-convert/{jobId}/doc.pdf`)만 안전하게 삭제 및 장부 상태 갱신.

### C. 펜싱 토큰(`lease_token`) 및 이중 저장/정산 방지
1. **지연 실행 차단**:
   - 실행 A의 lease가 만료되고 실행 B가 시작된 후, A가 뒤늦게 결과를 저장하려 할 때 `STALE_LEASE_TOKEN` 에러 반환 및 문제/개념 초안 영속 저장 차단 확인 (409 반환).
2. **원자적 정산 조건**:
   - 결과 캐시 보존 성공 AND DB 영속화 저장이 모두 확인된 경우에만 크레딧이 확정(`settled`) 처리됨을 확인.
   - 캐시가 없는 상태에서 정산 시도 시 `MISSING_CACHED_RESULT`로 거부.

### D. 데이터 저장 안정성 (P01-06)
1. **QuotaExceededError 및 스토리지 예외**:
   - `localStorage.setItem` 실패 시 JS 크래시 없이 `inMemoryStore`에 안전 폴백 저장 및 `false` 반환 확인.
2. **데이터 무결성 검증**:
   - `checkStoredDataIntegrity()` 함수를 통해 손상된 로컬 레코드 감지 및 빈 계정 위장 방지 확인.

---

## 3. 미실행 테스트 및 이유

원칙에 따라 "외부 인증정보가 필요한 검증은 추측하거나 성공한 것처럼 보고하지 않는다"는 지침을 철저히 준수합니다.

1. **실제 Supabase Cloud 프로덕션 데이터베이스**:
   - 본 로컬 검증에서는 완벽한 모의 Supabase 인스턴스 및 RLS/RPC 권한 모델로 테스트를 완료하였으나, 실제 Supabase Cloud 대시보드에서의 마이그레이션 DDL 26, 27 적용 및 실서버 PostgreSQL 동시성 트랜잭션은 프로덕션 배포 단계에서 검증해야 합니다.
2. **실제 Vercel 인프라 및 Vercel Cron 트리거**:
   - Vercel Cron 규격에 맞추어 `GET` 엔드포인트와 `CRON_SECRET` 검증을 완료하였으나, 실제 Vercel 대시보드에 배포되어 15분/1시간 단위로 원격 서버리스 컨테이너를 깨우는 실제 크론 호출은 배포 후 확인 대상입니다.
3. **실제 Google OAuth 계정 연동**:
   - 모의 인증 토큰 교환은 검증하였으나, 실제 Google Cloud Console의 클라이언트 ID/Secret 및 실 브라우저 팝업/리다이렉션 E2E 흐름은 배포 도메인에 승인된 URI 설정 후 확인해야 합니다.
4. **실제 BAZE AI:NU Gateway DeepSeek V4.1 Flash 유료 호출**:
   - 유료 API 호출 금지 지침에 따라 모의 AI 응답으로 페이로드 파싱, 루브릭 검증, 펜싱 토큰, 초안 영속화를 검증하였으며, 실제 외부 게이트웨이 호출은 수행하지 않았습니다.
