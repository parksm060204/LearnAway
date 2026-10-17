# Plan 03: Plan 04 인계서 — 맞춤형 복습 사이클 및 적응형 추천 연계 (07-handoff-plan-04.md)

## 1. 인계 배경

Plan 03을 통해 강의자료 기반의 핵심 개념 추출, 5단계 난이도 및 대학 전공 시험 특화 문제 생성, 서술형 루브릭 평가, 9대 학술 오답 원인 분석 및 `StructuredErrorRecord` 기록 시스템이 완성되었다.
Plan 04에서는 이 평가 데이터를 기반으로 **학습자 맞춤형 복습 주기(Spaced Repetition) 최적화**, **취약 개념 집중 강화(Adaptive Recommendation)**, 그리고 **시험 직전 모의고사 적응형 출제**를 구현해야 한다.

## 2. Plan 03 산출물 및 인계 자산

### 2.1 핵심 타입 및 데이터 구조 (`lib/types.ts`)
- `AcademicDifficultyLevel` (1~5): 문항 난이도 수준.
- `AcademicErrorType`: 9대 학술 오답 분류 (`CONCEPT_MISUNDERSTANDING`, `FORMULA_MISAPPLICATION`, `CALCULATION_ERROR`, `LOGICAL_ERROR`, `CONDITION_OMISSION`, `TERMINOLOGY_ERROR`, `INCOMPLETE_REASONING`, `ANSWER_FORMAT_ERROR`, `UNCERTAIN`).
- `StructuredErrorRecord`: 취약점 심각도(`critical`, `moderate`, `minor`, `none`), 인용 근거(`evidence`), 피드백(`feedback`), 평가 시각.
- `Attempt` 및 `ReviewEvent`: 상기 필드가 포함된 풀이 및 복습 이력 엔티티.

### 2.2 인계 인터페이스 및 API 엔드포인트
- `POST /api/generate-problems`:
  - `difficultyLevel` (1~5) 파라미터 지원.
  - `problemType` (서술형, 계산형, 증명형, 디버깅형, 개념설명형 등) 지원.
  - 출처 근거(`sourceMaterialId`, `sourceExcerpt`, `sourcePage`) 자동 포함.
- `POST /api/evaluate-answer`:
  - 수학적 동등성 및 부분점수 지원.
  - 100점 루브릭 채점 및 `academicErrorType` / `structuredError` 출력.
- `components/ProblemSessionModal.tsx`:
  - 난이도 뱃지, 출처 검증 상태 뱃지, 출처 발췌문 렌더링.
  - 오답 원인 정밀 진단 및 개념 보완 가이드 표시.
- `components/ArchiveRecordDetail.tsx`:
  - 과거 풀이 이력 열람 시 학술 오답 유형 및 심층 취약점 근거 표시.

## 3. Plan 04 권장 구현 사항

1. **오답 유형별 복습 가중치 차등 적용 (`retentionModel.ts`, `todayStudy.ts`)**:
   - `critical` 심각도(예: `CONCEPT_MISUNDERSTANDING`, `FORMULA_MISAPPLICATION`): 복습 주기 대폭 단축 (1~2일 후 즉시 재복습 권장).
   - `minor` 심각도(예: `CALCULATION_ERROR`, `ANSWER_FORMAT_ERROR`): 주기 완만 감소 또는 기본 주기 유지.
2. **취약점 극복용 맞춤형 전이 문제(Transfer Problem) 추천**:
   - 학생이 특정 개념에서 `StructuredErrorRecord`를 기록한 경우, 해당 개념의 조건을 변형한 맞춤형 문제를 추천(`transfer-problem` 라우트 연동).
3. **학습 분석 대시보드 고도화 (`components/LearningAnalyticsModal.tsx`)**:
   - 9대 학술 오답 유형별 발생 빈도 및 추이 차트 시각화.
   - 5단계 난이도별 성취도(정답률 및 평균 점수) 분석 제공.
4. **모의고사 문항 구성 최적화 (`lib/mockExam.ts`)**:
   - 시험 D-Day 기준 취약 개념(Level 1~3)과 변별력 문항(Level 4~5)의 최적 배분(예: 6:4 또는 7:3 비율).

## 4. 제약 사항 및 보존 원칙

- **과거 데이터 불변성 유지**: Plan 04 구현 중 과거 `Attempt` 및 `ReviewEvent`의 채점 결과나 스냅샷을 재계산하여 변경하지 말 것.
- **크레딧 거버넌스 엄수**: 복습 문제 생성 시에도 게스트 1회, 일반 3회, 개인키 0회 차감 정책을 엄격히 계승할 것.
- **Serverless 예산 준수**: 모든 비동기 처리 및 추천 연산은 Vercel Serverless 타임아웃(40초 안전 한도) 내에 완료할 것.
