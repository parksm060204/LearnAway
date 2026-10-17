# Plan 03: 시스템 감사 및 대학 전공 시험 적합성 평가 (01-system-audit.md)

## 1. 개요 및 배경

LearnAway는 대학 강의자료(PDF 변환 Markdown, 강의 녹음 전사본)를 분석하고, 핵심 개념을 기반으로 시험 수준의 문제 풀이와 복습을 지원하는 학술 학습 플랫폼이다.
Plan 03은 단순 암기 확인용 객관식/단답식을 넘어 대학 전공 시험(수학·통계학·컴퓨터과학)의 본질인 **논술·증명·유도·복합 개념 서술형 평가 시스템**을 고도화하는 것을 최종 목표로 한다.

## 2. 기존 출제/채점 시스템 감사 (Audit)

### 2.1 기존 시스템의 강점
1. **정밀 루브릭 평가 체계**:
   - `lib/evaluationValidation.ts`: 배점 총합 100점 불변식, 기준별 점수 상한 및 취약 기준(`isVulnerable`) 식별 구조 확립.
   - Stage 8 풀이 근거 진단: 풀이 본점수(0~100점)와 풀이 접근법/이유 평가의 독립 분리(Decoupled Scoring) 원칙 보장.
2. **크레딧 및 보안 거버넌스**:
   - 게스트 1회, 일반 회원 3회, 개인 API 키 무제한(0회 차감) 정책 확립.
   - Vercel Serverless 실행 예산 40초 타임아웃 및 펜싱 토큰 기반 원자적 정산 보장.
3. **영속성 및 데이터 불변성**:
   - `attempts`와 `review_events`의 `payload: jsonb` 구조를 통해 스키마 파괴 없이 풍부한 진단 메타데이터 영속화.

### 2.2 식별된 문제점 및 한계 (Gaps)
1. **문제 난이도 체계의 부재**:
   - 단순 문자열 난이도(`basic`, `intermediate`, `advanced`)로 구성되어, 대학 시험의 다차원적 사고 수준(단순 정의 vs 정리 응용 vs 복합 증명)을 정량화하지 못함.
2. **오답 분류 체계의 협소함**:
   - 기존 4대 분류(`concept_confusion`, `condition_misinterpretation`, `calc_or_impl_mistake`, `method_selection_error`)는 단순 실수와 깊은 개념 오개념, 논리적 비약, 조건 누락을 명확히 구분하기 어려움.
3. **수학적 동등성 및 부분점수 처리 미흡**:
   - 수식 표기 차이($\frac{1}{2}$ vs $0.5$ vs $2^{-1}$, 동치 명제, 대안적 증명 전개)를 AI가 오답으로 오판할 위험 존재.
   - 유도 과정 중 단순 연산 실수가 발생했을 때 전체 루브릭 점수가 영점 처리되는 과도한 감점 문제.
4. **강의자료 출처 근거 추적(Provenance) 미흡**:
   - 문제 생성 시 원문 강의자료의 구체적 페이지나 발췌문이 문제 인터페이스에 명시되지 않아, 자료 수정 시 영향 범위를 한눈에 확인하기 어려움.

## 3. Plan 03 아키텍처 개선 결정

1. **5단계 학술 난이도 체계 도입 (`AcademicDifficultyLevel`: 1~5)**:
   - Level 1: 개념 정의 및 직접 대입 (10분 내외, 2~3개 기준)
   - Level 2: 단일 정리·알고리즘 응용 (10~15분)
   - Level 3: 다단계 유도 및 복합 조건 해석 (15~20분)
   - Level 4: 전공 심화 종합 증명 및 엣지 케이스 분석 (20~30분, >=3개 기준)
   - Level 5: 대학원/경시대회급 비정형 문제 해결 (30분 이상, 다차원 루브릭)
2. **9대 범주 학술 오답 분류 체계 (`AcademicErrorType`)**:
   - `NO_ERROR`, `CONCEPT_MISUNDERSTANDING`, `FORMULA_MISAPPLICATION`, `CALCULATION_ERROR`, `LOGICAL_ERROR`, `CONDITION_OMISSION`, `TERMINOLOGY_ERROR`, `INCOMPLETE_REASONING`, `ANSWER_FORMAT_ERROR`, `UNCERTAIN` 구축.
   - 레거시 4대 분류와의 완전한 양방향 자동 호환성 보장.
3. **수학적 동등성 및 공정 부분점수 가이드라인**:
   - 대수적/논리적 동등성 인정 및 대안적 유도 경로 수용.
   - 연산 실수 시 전개 논리가 올바르면 전개 배점의 70~90% 부분점수 부여 규정.
   - 풀이 과정 없는 단답 제출 시 강력한 감점(결론 배점만 인정).
4. **출처 연계(Provenance) 및 본문 수정 안전망**:
   - `sourceMaterialId`, `sourceExcerpt`, `sourcePage`, `sourceVerificationStatus` 명시.
   - 본문 수정 시 문제를 무단 삭제하지 않고 `needs_review`로 안전하게 상태 전이.
