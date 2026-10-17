# Plan 03: 서술형 답안 평가 및 루브릭 채점 엔진 (03-answer-evaluation.md)

## 1. 개요

대학 시험 서술형 답안 평가 엔진(`app/api/evaluate-answer/route.ts` 및 `lib/evaluationValidation.ts`)은 학생이 제출한 풀이 전개 과정을 루브릭 기준별로 정밀 검증하여 0~100점 점수를 산출하고 구체적인 피드백을 제공한다.

## 2. 평가 시스템의 4대 핵심 원칙

### 2.1 수학적 동등성 및 대안적 유도 인정 (Mathematical Equivalence)
- **표기법 다양성 수용**: $\frac{1}{2}$, $0.5$, $2^{-1}$, 또는 LaTeX 수식 표기와 관계없이 수학적으로 동등한 표현은 정답으로 인정한다.
- **대안적 증명 경로 수용**: 모범 답안과 다른 유효한 대안적 증명(예: 수학적 귀납법 대신 직접 계산, 대우 명제 증명, 동치 정리 적용)을 오류로 취급하지 않고 논리적 타당성을 기준으로 정당하게 채점한다.

### 2.2 연산 실수에 대한 합리적 부분점수 (Partial Credit for Derivations)
- 접근 방법, 개념 적용, 논리적 전개 방향이 올바른 상태에서 단순 산술 연산, 부호 착오, 중간 계수 전개 실수가 발생한 경우:
  - 해당 전개 과정 배점의 **70% ~ 90%**를 부분점수로 부여한다.
  - 최종 결론 배점만 감점 처리하여 학생의 개념 이해도와 풀이 논리가 공정하게 반영되도록 한다.

### 2.3 전개 과정 누락에 대한 단답 감점 (Answer-Only Deduction)
- 서술형·계산 유도형·증명형 문제에서 중간 유도 및 논증 단계 없이 최종 숫자나 수식 단답만 제출한 경우:
  - 개념 이해 및 전개 과정에 배정된 점수를 감점하고, 최종 결론 배점만 인정한다.
  - 피드백에 `INCOMPLETE_REASONING` 원인을 명시하여 단계별 논증 훈련을 유도한다.

### 2.4 풀이 점수와 방법 선택 이유의 독립 분리 (Decoupled Scoring Invariant)
- Stage 8에서 도입된 "풀이 방법 선택 이유(Method Selection Reason)" 진단은 학생의 메타인지 평가를 목적으로 별도 표시된다.
- **불변식**: 방법 선택 이유가 미흡하거나 우수하더라도 문제 자체의 루브릭 채점 총점(0~100점)은 절대 변동되지 않는다.

## 3. 평가 결과 데이터 구조 (`EvaluationResult`)

```typescript
export interface EvaluationResult {
  calculatedScore: number;          // 루브릭 기준별 점수 합계 (0~100)
  rubricResults: RubricResult[];    // 기준별 획득 점수, 인용 근거, 감점 원인, 개선 가이드
  feedback: string;                 // 종합 학술 첨삭 총평
  strengths: string;                // 풀이에서 돋보인 점
  criticalImprovements: string;     // 가장 시급한 보완점
  academicErrorType: AcademicErrorType; // 9대 학술 오답 유형
  recommendedErrorType: ErrorType;  // 레거시 하위 호환 오답 유형
  structuredError: StructuredErrorRecord; // 상세 오답 원인 및 심각도 기록
  needsReview: boolean;             // AI 평가 신뢰도 부족 시 검토 필요 플래그
  isAiEvaluated: boolean;           // AI 평가 완료 여부 (항상 true)
  sourceProvenance?: ProblemSourceProvenance; // 문제 출처 추적 정보
}
```

## 4. 평가 점수 임계값에 따른 오답 원인 정합성 보장

- **90점 이상 고득점 (`calculatedScore >= 90`)**:
  - AI 모델이 응답에서 오답 유형을 선언했더라도, 시스템 검증 계층(`validateEvaluationOutput`)에서 자동으로 `academicErrorType = 'NO_ERROR'` 및 `severity = 'none'`으로 강제 보정한다.
- **90점 미만 감점 발생 (`calculatedScore < 90`)**:
  - 감점을 유발한 가장 지배적인 요인을 9대 학술 오답 유형 중 하나로 엄밀하게 분류하고, 학생 답안에서 발췌한 직접 근거(`evidence`)와 개선 가이드(`feedback`)를 `StructuredErrorRecord`로 생성한다.
