# LearnAway — AI API 연결 및 크레딧 정책 통합 검증서 (AI & Credit Validation)

## 1. AI API 연결 아키텍처

LearnAway는 대학생의 고난도 수학·통계·코딩 문제 풀이 및 심층 평가를 위해 2개 경로의 AI 모델 연결을 지원합니다:

### 1.1. 학교 BAZE AI Gateway (기본 운영자 연결)
- **제공자**: `school_gateway` (인천대학교 AI:NU BAZE Gateway)
- **기본 엔드포인트**: `https://factchat-cloud.mindlogic.ai/v1/gateway`
- **기본 모델**: `deepseek-v4.1-flash` (대학 수준의 수학 정리 증명, 복합 논술, 루브릭 채점에 최적화)
- **최소 출력 토큰 하한**: `BAZE_MIN_OUTPUT_TOKENS=16000` (DeepSeek 모델의 심층 사고 reasoning token이 잘려 빈 응답이 반환되는 현상 방지)
- **보안 격리**: 운영자 키는 클라이언트 번들에 절대 포함되지 않으며 오직 서버리스 Route Handler 내에서만 참조됩니다.

### 1.2. 사용자 개인 API 키 (Personal Key)
- **지원 공급자**: Gemini, OpenAI, DeepSeek, 학교 BAZE Gateway
- **서버 측 암호화 저장**:
  - `AI_CREDENTIAL_ENCRYPTION_KEY`를 이용한 32바이트 **AES-256-GCM** 암호화.
  - 브라우저에는 마스킹된 힌트(`sk-••••1234`)만 전달되며 원문 키는 서버 메모리에서만 일시적으로 복호화.
- **자동 대체 금지 (Strict Isolation)**:
  - 등록된 개인 API 키의 호출이 실패(한도 초과, 인증 오류 등)하더라도 운영자 유료 API로 자동 전환되지 않고 즉시 해당 오류를 사용자에게 반환합니다.

---

## 2. 계정 유형별 AI 체험 크레딧 정책

| 계정 유형 | 판별 기준 (서버 검증) | 초기 지급 크레딧 | 1회 성공 작업 시 | 잔액 소진 시 |
|---|---|---|---|---|
| **게스트 계정 (아이디 가입)** | `username_accounts` 존재 또는 `@id.learnaway.local` | **1회** | 1회 차감 (잔액 0) | 추가 운영자 AI 호출 차단 (`TRIAL_CREDITS_EXHAUSTED`) |
| **일반 계정 (Google 등)** | 외부 이메일 인증 계정 | **3회** | 1회 차감 | 3회 소진 후 추가 호출 차단 |
| **개인 API 키 등록자** | `ai_credentials` 테이블 보유자 | 영향 없음 | **0회 차감** (체험 잔액 보존) | 무제한 (개인 할당량 기준) |

### 클라이언트 임의 위변조 방지
- 클라이언트가 요청 본문으로 전송하는 `isGuest` 플래그는 일체 신뢰하지 않으며, 데이터베이스 RPC `determine_initial_trial_credits(user_id)`가 서버 내 `username_accounts` 테이블 및 `auth.users` 메타데이터를 직접 조회하여 계정 유형을 결정합니다.

---

## 3. 원자적 예약·정산·환급 라이프사이클

```
[클라이언트 요청]
       │
       ▼
[1. reserve_trial_credit] ──(잔액 < 1)──► [402 차단: TRIAL_CREDITS_EXHAUSTED]
       │ (잔액 1 이상 시 원자적 1 차감 + lease_token 발급)
       ▼
[2. AI 호출 (DeepSeek)] ───(네트워크/파싱 실패)──► [release_trial_credit] ──► [잔액 1 즉시 환급]
       │ (정상 성공)
       ▼
[3. record_trial_result_ready] (결과 캐시 저장)
       │
       ▼
[4. DB 영속화 저장] ────(DB 저장 실패)──► [초안 보존 + retry_save 안내 (AI 0회 재호출)]
       │ (저장 성공)
       ▼
[5. settle_trial_credit] (차감 확정 완료)
```

---

## 4. 장애 복원 및 동시성 검증 결과

1. **동일 작업 재시도 (Idempotency)**:
   - 동일한 `task_id`와 입력 해시로 재요청이 발생할 경우, 중복 차감 없이 캐시된 결과(`cached_result`)를 반환하여 AI 호출 비용과 잔액을 보존함 (`PASS`).
2. **동시 다중 요청 임대 락 (Lease Fencing)**:
   - 잔액 1인 상태에서 2개의 동시 요청이 도달하면 데이터베이스 `FOR UPDATE` 행 잠금에 의해 정확히 1개만 예약되고 다른 1개는 차단됨 (`PASS`).
3. **타임아웃 상한 일관성**:
   - 서버 측 AI 실행 타임아웃 상한(`MAX_TRIAL_EXECUTION_TIMEOUT_MS = 40000`, 40초)이 Vercel 서버리스 Function 제한(`maxDuration = 60`, 60초) 이내로 구성되어 게이트웨이 타임아웃 없이 안전하게 에러를 포착하고 환급을 수행함 (`PASS`).
