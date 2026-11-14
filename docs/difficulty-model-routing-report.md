> [!NOTE]
> **정책 대체 안내**: 난이도(Level 1~3 / Level 4~5) 기반 AI 모델 자동 분기 정책은 **사용자 직접 AI 모델 선택 정책**으로 대체되었습니다. 최신 구현과 검증 결과는 [manual-model-selection-report.md](file:///C:/Users/abcde/Desktop/study-tool/docs/manual-model-selection-report.md)를 참고하세요.

# 난이도별 AI 모델 선택(Difficulty-Based Model Routing) 적용 보고서

## 1. 확정 정책 및 모델 ID

- **난이도 경계**: Level 1~3 (표준) / Level 4~5 (고난도) (`DIFFICULTY_MODEL_BOUNDARY_LEVEL = 4`)
- **학교 BAZE Gateway 모델**:
  - Level 1~3: `deepseek-v4.1-flash` (`DEFAULT_SCHOOL_MODEL`, 기존 `minOutputTokens: 16000` 및 `jsonMode` 유지)
  - Level 4~5: `claude-sonnet-5-5` (`DEFAULT_HIGH_DIFFICULTY_SCHOOL_MODEL`, 미확인 `response_format`/`minOutputTokens: 16000`을 복사하지 않는 보수적 설정: `minOutputTokens: 0`, `jsonMode: 'none'`)
- **환경 변수 오버라이드**: `BAZE_HIGH_DIFFICULTY_MODEL` 또는 `AI_HIGH_DIFFICULTY_MODEL`로 고난도 모델 ID를 재정의할 수 있으며, 미설정 시 `claude-sonnet-5-5`를 기본값으로 사용(미확정 플레이스홀더 `55sonnet` 등은 거부).
- **비학교 제공자 보존**: `gemini`, `openai`, `deepseek` 직접 설정은 기존 단일 `AiConfig` 동작을 그대로 보존.

---

## 2. 실제 적용 범위 (전체 AI 라우트)

| 라우트 | 작업 유형 (`taskType`) | 난이도 기준 | 적용 내용 |
| --- | --- | --- | --- |
| `app/api/generate-problems/route.ts` | `generate_problems` | 검증된 요청 `difficultyLevel ?? difficulty` | `resolveAndVerifyDifficultyConfig` 적용, 실패 시 예약 크레딧 환급, 실제 응답 모델 텔레메트리 기록 |
| `app/api/evaluate-answer/route.ts` | `evaluate_answer` | 서버 DB/스냅샷(`frozenProb`, `problems.payload`, `problem_versions.snapshot`), 로컬 임시 문항만 요청 값 | 클라이언트 난이도 조작 무시, `extractAuthoritativeProblemDifficulty` 적용, 실패 시 예산 미소모·크레딧 환급 |
| `app/api/transfer-problem/route.ts` | `transfer_problem` | `problemId` 제공 시 DB 소유권(`user_id === userId || is_demo`) 검증 후 `problems.payload` 난이도 우선 | `resolveProblemDifficultyForRoute` (`resolveAiConfigForUser` 이전 실행, DB 오류·미조회·타 사용자/null 소유권 시 크레딧 예약/AI 호출 0회로 차단), `effectiveInputIdentifier`·`taskId`·`signTaskRecoveryToken`·`isSaveRetry` 조회/검증 식별자 통일(레거시 해시 및 `isSaveRetry` 중 DB 문제 버전/난이도 변경 복구 호환 유지) |
| `app/api/review-problem-quality/route.ts` | `review_problem_quality` | `problem.id` 기반 DB 소유권(`user_id === userId || is_demo`) 검증 후 `problems.payload` 난이도 우선 | `resolveProblemDifficultyForRoute` (`resolveAiConfigForUser` 이전 실행, DB 오류·미조회·타 사용자/null 소유권 시 크레딧 예약/AI 호출 0회로 차단) |
| `app/api/logic-questions/route.ts` | `logic_questions` | `problemId` 제공 시 DB 소유권(`user_id === userId || is_demo`) 검증 후 `problems.payload` 난이도 우선 | `resolveProblemDifficultyForRoute` (`resolveAiConfigForUser` 이전 실행, DB 오류·미조회·타 사용자/null 소유권 시 크레딧 예약/AI 호출 0회로 차단), `effectiveInputIdentifier`·`taskId`·`signTaskRecoveryToken`·`isSaveRetry` 조회/검증 식별자 통일(레거시 해시 및 `isSaveRetry` 중 DB 문제 버전/난이도 변경 복구 호환 유지) |
| `app/api/analyze-concepts/route.ts` | `analyze_concepts` | 문제 난이도 없음 | 기존 `deepseek-v4.1-flash` 동작 보존 |

---

## 3. 보안·안정성·비용 및 UI 처리

1. **게이트웨이 모델 지원 검증 및 폴백 차단**:
   - Level 4~5(`school_gateway`) 호출 전 `verifySelectedModelOnGateway`(`GET /models/?type=llm`, 유료 생성 없는 읽기 전용 메타데이터 조회)로 해당 키(사용자 키 또는 운영자 키)에서 `claude-sonnet-5-5`가 활성화되어 있는지 검증.
   - 미지원(`MODEL_NOT_AVAILABLE`), 권한 거부(`403`), 인증/크레딧/네트워크/조회 실패 시 다른 유료 모델이나 DeepSeek로 폴백하지 않고 명시적 실패 반환 및 예약된 체험 크레딧 즉시 환급(`releaseTrialCredit`).
2. **idempotency / 저장 재시도 / 캐시 복구 보존**:
   - `isSaveRetry` 및 `already_completed` 캐시 복구 경로는 `resolveAndVerifyDifficultyConfig` 및 `callAiChat` 이전에 처리되어 저장 재시도 시 AI를 재호출하지 않음.
3. **실제 응답 모델 텔레메트리 및 미검증 단가 오인 방지**:
   - `callAiChat`은 게이트웨이 응답의 `data.model`을 우선 반환하여 실제 사용 모델명을 기록.
   - `lib/aiCostTelemetry.ts`는 `MODEL_PRICING_TABLE`에 없는 모델(`claude-sonnet-5-5` 등)의 단가를 임의 추정하지 않고 `pricingVerified: false`, `unverifiedPricingRequests`로 분리.
   - `components/AdminAiMetricsModal.tsx`는 단가 미확인 모델을 `(₩0)` 대신 `(단가 미확인)`으로 표시하고 합계에 `단가 미확인 N건 제외` 안내를 표시.
4. **UI 안내**:
   - `components/ProblemGeneratorModal.tsx`: 난이도 선택 영역 하단에 선택된 레벨에 따른 사용 모델(`deepseek-v4.1-flash` / `claude-sonnet-5-5`) 간결히 안내.
   - `components/AiConnectionSection.tsx`: 설정 화면에 Level 1~3(`deepseek-v4.1-flash`) / Level 4~5(`claude-sonnet-5-5`) 자동 선택 정책 안내 추가.

---

## 4. 검사 및 결과

| 검사 항목 | 명령어 | 결과 |
| --- | --- | --- |
| TypeScript 타입 검사 | `npx tsc --noEmit` | 통과 (exit 0) |
| ESLint | `npm run lint` | 통과 (exit 0) |
| 프로덕션 빌드 | `npm run build` | 통과 (exit 0, Next.js 16.4.6 Turbopack) |
| 기존 회귀 테스트 | `npm run test:regressions` | 통과 (exit 0, recovery 20/20 포함) |
| 난이도별 모델 정책 단위/Mock 테스트 | `node scripts/test-difficulty-model-routing.mjs` | 통과 (11/11 passed, 실제 라우트 핸들러 DB throw/error/타 사용자/미존재 ID·`isProvisionalLocal` 차단·Level 4 조작 거부·저장 재시도·`signedRecoveryToken` 일관성/변조 거부/DB 버전 변경 복구·자동 `taskId` 캐시 격리 포함) |

---

## 5. 필요한 환경 설정·권한 및 미검증 범위

- **필요한 환경 설정 / 모델 권한**:
  - 학교 BAZE Gateway API 키(사용자 개인 키 또는 운영자 키)의 테넌트/조직에서 `deepseek-v4.1-flash` 및 `claude-sonnet-5-5` 모델 권한이 활성화되어 있어야 함 (`GET /models/?type=llm` 목록에 포함 필요).
  - 필요 시 `BAZE_HIGH_DIFFICULTY_MODEL` 또는 `AI_HIGH_DIFFICULTY_MODEL` 환경 변수로 고난도 모델 ID 재정의 가능(미설정 시 기본값 `claude-sonnet-5-5`).
- **미검증 범위 및 사유**:
  - **실제 학교 BAZE Gateway 목록 읽기(`GET /models/?type=llm`, 비유료 읽기 검증)**는 테스트 환경에 실제 BAZE API 키를 주입한 실시간 네트워크 검증을 수행하지 않아 미실행(Mock 응답으로만 검증).
  - **유료 실제 AI 생성·채점 호출(`claude-sonnet-5-5`)**은 유료 실호출 금지 원칙에 따라 미실행(Mock 응답으로만 검증).
  - 실제 Supabase DB 환경 및 브라우저 E2E UI 검증은 미실행.
