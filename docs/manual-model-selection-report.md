# 사용자 직접 AI 모델 선택(Manual Model Selection) 적용 보고서

## 1. 정책 요약 및 우선순위

기존의 학술 난이도(Level 1~3 / Level 4~5) 기반 AI 모델 자동 강제 분기를 제거하고, 사용자가 직접 모델을 선택할 수 있도록 전환했습니다.

- **학교 BAZE Gateway 선택 가능 모델**:
  - **DeepSeek**: `deepseek-v4.1-flash` (`DEFAULT_SCHOOL_MODEL`, 기존 `minOutputTokens: 16000` 및 `BAZE_JSON_MODE` 유지)
  - **Sonnet**: `claude-sonnet-5-5` (`DEFAULT_SONNET_SCHOOL_MODEL`, `BAZE_SONNET_MODEL` / `AI_SONNET_MODEL` / `BAZE_HIGH_DIFFICULTY_MODEL` / `AI_HIGH_DIFFICULTY_MODEL` 환경 변수 재정의 지원, 플레이스홀더 거부; DeepSeek의 `minOutputTokens: 16000` 및 `jsonMode`를 복사하지 않고 `minOutputTokens: 0`, `jsonMode: 'none'` 적용)
- **서버 모델 결정 우선순위**:
  1. 검증된 이번 요청의 명시 선택 (`selectedModel`)
  2. 저장된 사용자 기본 모델 (`ai_connections.model`)
  3. 미등록 체험/운영자 기본 모델 (`resolveOperatorAiConfig()?.model`)
  4. 기본값 DeepSeek (`deepseek-v4.1-flash`)
- **비학교 제공자 보존**: `gemini`, `openai`, `deepseek` 직접 설정이 활성화된 경우 학교 모델을 끼워 넣지 않고 기존 단일 제공자 모델을 보존하며, 학교 모델 선택 요청은 명시적으로 거부합니다.
- **폴백 차단**: 선택한 모델이 미지원(`MODEL_NOT_AVAILABLE`), 권한 거부(`403`), 조회 실패 시 다른 유료 모델이나 DeepSeek로 자동 대체하지 않고 오류를 반환하며, 예약된 체험 크레딧이 있으면 즉시 환급합니다.

---

## 2. 실제 선택 위치 및 사용법

| 위치 | 파일 | 동작 및 사용법 |
| --- | --- | --- |
| **설정 > 내 AI API 연결** | `components/AiConnectionSection.tsx` | 연결된 사용자가 API 키를 다시 입력하지 않고도 `사용 가능 모델 새로고침`(`POST /api/ai-connection` `{ useStoredKey: true }`)으로 키의 실시간 모델 목록(`GET /models/?type=llm`)을 조회하고, `기본 AI 모델 선택` 드롭다운에서 모델을 고른 뒤 `기본 모델 저장`(`PUT /api/ai-connection` `{ model }`, `touch_ai_connection` RPC)으로 저장할 수 있습니다. |
| **문제 생성 모달** | `components/ProblemGeneratorModal.tsx` | `4. 이번 출제에 사용할 AI 모델` 섹션에서 `DeepSeek (deepseek-v4.1-flash)` / `Sonnet (claude-sonnet-5-5)`을 이름과 정확한 ID로 구분하여 선택합니다. 기본값은 저장된 사용자 모델(또는 운영자 기본 모델/DeepSeek)입니다. |
| **문제 풀이·답안 채점 모달** | `components/ProblemSessionModal.tsx` | 답안 제출 버튼 상단의 `채점 AI 모델 선택`에서 `DeepSeek (deepseek-v4.1-flash)` / `Sonnet (claude-sonnet-5-5)`을 직접 선택합니다. 저장 실패 후 `handleRetrySave` 시에는 스냅샷(`evalSnapshot.selectedModel`)과 서명 토큰을 고정해 AI 재호출 없이 원래 결과를 복구합니다. |
| **관련 후속 작업** | `MockExamModal.tsx`, `LogicStrengthenModal.tsx`, `ProblemQualityReviewTab.tsx` | 별도 선택 컨트롤이 없는 모의시험 채점, 논리 질문, 전이 문제, 품질 검토는 저장된 사용자 기본 모델(또는 운영자 기본/DeepSeek)을 일관되게 사용하며, 난이도 기반 강제 분기를 수행하지 않습니다. |

---

## 3. 서버 안전성·격리·복구 처리

1. **작업 ID 및 캐시 격리**:
   - `app/api/generate-problems/route.ts`, `app/api/evaluate-answer/route.ts`, `app/api/transfer-problem/route.ts`, `app/api/logic-questions/route.ts`, `app/api/review-problem-quality/route.ts` 모두 `resolveEffectiveModelForRequest`로 요청/저장 모델을 사전 확정한 뒤 `inputIdentifier`와 `taskId`에 포함합니다.
   - 동일 입력이라도 DeepSeek와 Sonnet 호출은 서로 다른 `taskId`로 분리되어 이전 모델의 캐시 결과를 반환하지 않습니다.
2. **저장 재시도 및 레거시 토큰 호환**:
   - `isSaveRetry: true` 요청은 `resolveAiConfigForUser` 및 외부 AI 호출 이전에 처리되며, 기본 모델을 변경한 뒤 저장만 재시도해도 원래 `taskId`와 `signedRecoveryToken`으로 안전하게 복구됩니다.
   - `model` 필드가 없던 이전 버전의 복구 토큰도 `legacyInputIdentifiers`를 통해 계속 복구 가능합니다.
3. **기존 DB 소유권 및 권한 검증 유지**:
   - `resolveProblemDifficultyForRoute` / `lookupAuthoritativeProblemDifficultyById` 및 `evaluate-answer`의 DB/버전 스냅샷 소유권 검증은 그대로 유지되어 타 사용자 문제, DB 오류/예외, 미존재 `problemId`(`isProvisionalLocal !== true`)를 AI 호출 0회·크레딧 예약 0회로 차단합니다.

---

## 4. 변경 파일 목록

- `lib/aiCredentials.ts`: `buildSchoolConfig`에서 비-DeepSeek(Sonnet 등) 모델에 DeepSeek `minOutputTokens: 16000` 및 `jsonMode`가 복사되지 않도록 분리
- `lib/aiModelPolicy.ts`: 난이도 기반 강제 분기 제거, `resolveEffectiveModelForRequest`, `selectAiConfigForManualModel`, `resolveAndVerifyManualModelConfig`, `validateRequestedModelInput`, `getAllowedSchoolModels`, `getSchoolModelOptions` 구현 (기존 DB 소유권/난이도 조회 헬퍼 유지)
- `app/api/ai-connection/route.ts`: `GET`에 `availableSchoolModels` 반환(난이도 경계 제거), `POST`에 `{ useStoredKey: true }` 저장 키 기반 모델 목록 조회 지원, `PUT`에 모델 입력 검증 추가
- `app/api/generate-problems/route.ts`: 명시 선택·저장 모델 우선순위 적용, 모델별 `inputIdentifier`/`taskId` 격리, `resolveAndVerifyManualModelConfig` 적용
- `app/api/evaluate-answer/route.ts`: 명시 선택·저장 모델 우선순위 적용, 모델별 `inputIdentifier`/`taskId` 격리, `signTaskRecoveryToken`에 `targetConfig.model` 전달, `isSaveRetry` 다중 모델/레거시 호환
- `app/api/transfer-problem/route.ts`: 저장 모델/명시 선택 적용, DB 소유권 검증 유지, 모델별 `taskId` 격리 및 `isSaveRetry` 호환
- `app/api/logic-questions/route.ts`: 저장 모델/명시 선택 적용, DB 소유권 검증 유지, 모델별 `taskId` 격리 및 `isSaveRetry` 호환
- `app/api/review-problem-quality/route.ts`: 저장 모델/명시 선택 적용, DB 소유권 검증 유지, 모델별 `taskId` 격리 및 `isSaveRetry` 호환
- `components/AiConnectionSection.tsx`: 연결 상태에서 키 재입력 없는 기본 모델 선택/저장 UI 및 조회/저장 실패 상태 분리
- `components/ProblemGeneratorModal.tsx`: 출제 AI 모델 선택 UI(DeepSeek/Sonnet 구분) 및 시작 시 모델 고정
- `components/ProblemSessionModal.tsx`: 채점 AI 모델 선택 UI 및 `EvaluateAnswerInputSnapshot.selectedModel` 기반 저장 재시도 고정
- `scripts/test-difficulty-model-routing.mjs`: 사용자 직접 모델 선택 정책 및 실제 라우트 핸들러 Mock 테스트로 갱신
- `docs/difficulty-model-routing-report.md`: 대체 정책 안내 추가
- `docs/manual-model-selection-report.md`: 본 보고서 작성

- **변경 파일 추가 및 최종 보완**:
  - `lib/aiModelSelectionClient.ts`: 모달의 `GET /api/ai-connection` 조회 결과를 해석하는 공통 순수 헬퍼(`applyAiConnectionLookup`)를 분리하여, 지연 조회 중 사용자가 선택한 모델을 `dirty-ref`로 보존하고, 기존 저장된 다른 유효 학교 모델(예: `qwen3-coder`)을 임의로 `deepseek-v4.1-flash`로 덮어쓰지 않고 선택지에 유지합니다.
  - `components/ProblemGeneratorModal.tsx`, `components/ProblemSessionModal.tsx`: 중복되던 빠른 선택 카드 그룹을 제거하고 공통 `Select`(`components/ui/WorkspacePrimitives.tsx`) 단일 컨트롤로 통일했습니다. `loading / ready / error` 상태를 명시하여 조회 중 실행을 제어하고, 조회 실패 시 `다시 조회` 재시도 버튼을 제공하며, 모달 재오픈·과목/문제/계정 전환 시 `AbortController`와 시퀀스 번호로 이전 응답이 상태를 덮어쓰지 않게 격리했습니다.
  - `lib/aiModelPolicy.ts` 및 5개 API 라우트: `resolveEffectiveModelForRequest`가 확정한 `provider`, `effectiveModel`, `expectedSource`, `expectedKeyFingerprint`(SHA-256)를 `resolveAndVerifyManualModelConfig`에 고정 전달(`pinnedResolution`)하여, 중간에 기본 모델이 변경되더라도 해시 모델과 실제 호출 모델이 항상 일치하도록 하고, 키·제공자·자격출처가 바뀐 경우에는 기존 키를 섞지 않고 `409 AI_CONNECTION_CHANGED_CONFLICT`로 안전하게 차단합니다. 또한 이미 저장된 유효 학교 모델(`defaultModel`)이 명시 재전송되어도 허용하되 변조된 미허용 모델은 계속 `400`으로 거부합니다.

---

## 5. 검사 결과

| 검사 항목 | 명령어 | 결과 |
| --- | --- | --- |
| TypeScript 타입 검사 | `npx tsc --noEmit` | 통과 (exit 0) |
| ESLint | `npm run lint` | 통과 (exit 0, 0 errors, 0 warnings) |
| 기존 회귀 테스트 | `npm run test:regressions` | 통과 (exit 0, recovery 20/20 포함) |
| 수동 모델 선택 단위·라우트 Mock 테스트 | `node scripts/test-difficulty-model-routing.mjs` | 통과 (12/12 passed) |
| 프로덕션 빌드 | `npm run build` | 통과 (exit 0, Next.js 16.4.6 Turbopack) |
| 프로덕션 서버 엔드포인트 점검 (`next start -p 3100`) | `/` · `/login` · `/api/ai-connection` 요청 | `/` → `307 /login`, `/login` → `200`, `/api/ai-connection` → `401` (인증 경계 확인) |

---

## 6. 필요한 모델 권한·설정 및 미검증 범위

- **필요한 설정 및 권한**:
  - 학교 BAZE Gateway API 키(사용자 개인 키 또는 운영자 키)에서 `deepseek-v4.1-flash` 및 `claude-sonnet-5-5`(또는 기존 저장된 유효 학교 모델) 모델 권한이 활성화되어 있어야 합니다 (`GET /models/?type=llm` 응답에 포함 필요).
  - 필요 시 `BAZE_SONNET_MODEL` 또는 `AI_SONNET_MODEL`(기존 `BAZE_HIGH_DIFFICULTY_MODEL` / `AI_HIGH_DIFFICULTY_MODEL` 포함)로 Sonnet 모델 ID를 재정의할 수 있습니다.
- **미검증 범위 및 사유**:
  - **실제 Supabase DB 환경** 및 **실시간 학교 BAZE Gateway 네트워크(`GET /models/?type=llm`)**는 테스트 환경에 실 키·실 DB를 연결하지 않아 Mock 응답으로만 검증했습니다.
  - **유료 실제 AI 생성·채점 호출**은 유료 실호출 금지 원칙에 따라 미실행했습니다.
  - **로그인 이후 실제 브라우저 E2E UI 검증(설정·문제 생성·채점 모달 인터랙션)**: `next start -p 3100`에서 확인한 바와 같이 `/`는 미인증 시 `/login`으로 `307` 리다이렉트되고 `/api/ai-connection`은 `401`을 반환하며, 현재 Orca CLI(`orca browser`는 `identity get/set`만 제공) 및 테스트 환경에 로그인된 Supabase 세션·실 키가 없어 로그인 경계 이후의 실제 브라우저 클릭/모바일 화면 검증은 미실행했습니다. 대신 클라이언트 조회/지연 덮어쓰기 방지/기존 저장 모델 유지 로직은 `lib/aiModelSelectionClient.ts` 단위 테스트(Check 10)로 검증했습니다.
