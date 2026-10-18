# Plan 05 — 04. AI 토큰 사용량 계측, 단가 체계 및 운영 비용 모니터링 (AI Usage Telemetry & Cost Control)

## 1. 개요 및 비용 통제 원칙
LearnAway는 학교 BAZE Gateway의 `deepseek-v4.1-flash`를 기본 모델로 활용하며, 사용자의 선택에 따라 OpenAI(`gpt-4o-mini`, `gpt-4o`), Google(`gemini-1.5-flash`) 등을 지원한다.
운영자 입장에서 제공하는 무료 체험 크레딧의 원가 지출을 방어하고, 과도한 토큰 소모나 무한 루프 호출을 조기에 탐지·차단하기 위해 정밀한 서버 사이드 텔레메트리(`lib/aiCostTelemetry.ts`) 및 관리자 모니터링 API(`/api/admin/ai-metrics`)를 구축하였다.

---

## 2. 모델별 공식 단가표 및 비용 계산 체계

### 2.1 단가 기준표 (`MODEL_PRICING_TABLE`)
기준 일자: 2026년 1월 1일 | 적용 환율: 1,400 KRW / USD

| 모델 식별자 (`model`) | 입력 단가 (1M 토큰당 USD) | 출력 단가 (1M 토큰당 USD) | 1,000토큰당 원화 환산 (입력/출력) | 비고 |
| :--- | :--- | :--- | :--- | :--- |
| **`deepseek-v4.1-flash`** | **$0.14** | **$0.28** | **약 0.20원 / 0.39원** | **LearnAway 기본 모델 (학교 게이트웨이)** |
| `deepseek-chat` | $0.14 | $0.28 | 약 0.20원 / 0.39원 | 공식 DeepSeek API |
| `gpt-4o-mini` | $0.15 | $0.60 | 약 0.21원 / 0.84원 | 경량 고속 모델 |
| `gpt-4o` | $2.50 | $10.00 | 약 3.50원 / 14.00원 | 고성능 플래그십 모델 |
| `gemini-1.5-flash` | $0.075 | $0.30 | 약 0.11원 / 0.42원 | 대규모 컨텍스트 경량 모델 |

### 2.2 결정론적 비용 산출 공식
$$\text{Cost}_{\text{USD}} = \frac{\text{inputTokens} \times P_{\text{input}} + \text{outputTokens} \times P_{\text{output}}}{1,000,000}$$
$$\text{Cost}_{\text{KRW}} = \text{round}(\text{Cost}_{\text{USD}} \times 1,400)$$

- 모델 응답 객체의 `usage` 정보(`prompt_tokens`, `completion_tokens`)를 파싱하여 정확한 토큰 수 측정.
- 제공자가 `usage`를 미반환하는 경우 `estimateTokenCount()`를 통한 문자·단어 기반 보수적 폴백 추정 적용 (한글 약 1.8 토큰/글자, 영문 약 0.25 토큰/글자).

---

## 3. 서버 사이드 텔레메트리 파이프라인

### 3.1 기록 속성 규격 (`AiUsageTelemetryRecord`)
```typescript
export interface AiUsageTelemetryRecord {
  requestId: string;                      // 고유 요청 식별자
  userId: string;                         // 호출 사용자 ID
  taskType: AiTaskType;                   // 작업 유형 ('evaluate_answer', 'generate_problems', 등)
  provider: string;                       // 제공자 ('school_gateway', 'openai', 'gemini' 등)
  model: string;                          // 실제 호출 모델명
  creditSource: 'operator_trial' | 'personal_key'; // 비용 청구 주체
  inputTokens: number;                    // 입력 토큰 수
  outputTokens: number;                   // 생성 토큰 수
  totalTokens: number;                    // 총 토큰 수
  estimatedCostUsd: number;               // USD 원가 추정치
  estimatedCostKrw: number;               // 원화 원가 추정치
  executionTimeMs: number;                // AI 엔드포인트 응답 소요 시간 (ms)
  success: boolean;                       // 성공 여부
  errorCode?: string;                     // 실패 시 표준 에러 코드
  createdAt: string;                      // ISO 타임스탬프
}
```

### 3.2 AI 라우트 전수 연동
다음의 6대 핵심 AI API 엔드포인트 전부에 호출 시간 계측 및 텔레메트리 자동 기록을 연동하였다:
1. `POST /api/evaluate-answer` (서술형 답안 채점 및 루브릭 평가)
2. `POST /api/generate-problems` (과목/개념 기반 시험 문항 생성)
3. `POST /api/analyze-concepts` (강의자료 분석 및 개념 추출)
4. `POST /api/transfer-problem` (전이 문제 및 변형 문항 생성)
5. `POST /api/logic-questions` (논리적 추론 및 단계별 질문)
6. `POST /api/review-problem-quality` (문제 품질 검토 및 루브릭 진단)

---

## 4. 운영자 분석 엔드포인트 (`GET /api/admin/ai-metrics`)

시스템 관리자 및 운영자를 위해 실시간 비용 분석 및 비정상 어뷰징 탐지 API를 제공한다:

### 4.1 집계 지표 (`AiUsageSummary`)
- **총합 통계**: 총 요청 수, 성공률, 총 토큰 수, 누적 USD 원가, 누적 KRW 원가.
- **비용 주체별 분리**: 운영자 체험 크레딧 소모액 vs 사용자 개인 API 키 사용량.
- **작업 유형별/모델별 상세**: 태스크별 토큰 소모량, 모델별 빈도 및 평균 레이턴시.
- **일별 추이 (Daily Metrics)**: 일자별 요청 건수 및 원화 비용 추이.

### 4.2 비정상 사용량(Anomaly) 자동 탐지
특정 사용자가 단시간 내에 과도한 호출을 발생시킬 경우 운영자에게 즉각 경고 플래그를 제공한다:
- **요청 수 임계치**: 단일 사용자 누적 요청 수 > 100건
- **토큰 소모 임계치**: 단일 사용자 누적 토큰 > 500,000 토큰

---

## 5. 학습 엔진 무과금 연산 보장 (Zero-Cost Local Invariant)

- **망각곡선 감쇠 계산**: $R(t) = S_0 (1 + t/\tau)^{-\alpha}$ 공식은 순수 JavaScript 로컬 산술 연산으로 수행 (AI 미호출, 0원).
- **일일 학습 계획 스케줄러**: 시험 D-Day 기반 가용 시간 배정 및 과목별 우선순위 정렬은 100% 로컬 결정론적 알고리즘으로 동작.
- **5대 맞춤형 복습 유형 추천**: `determineRecommendedPracticeKind` 함수는 학생의 누적 점수와 오답 유형 규칙 기반으로 분기하여 외부 AI 호출을 일체 배제.
