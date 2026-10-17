# Plan 03: 9대 학술 오답 분류 체계 및 구조화 취약점 기록 (04-error-classification.md)

## 1. 개요

대학 시험 수준의 문제 풀이에서 학생이 겪는 어려움은 단순한 부주의와 근본적인 개념 오해 사이에 넓은 스펙트럼이 존재한다.
Plan 03은 이를 체계적으로 분석하고 향후 복습 주기에 정밀 반영하기 위해 **9대 학술 오답 분류 체계(`AcademicErrorType`)**와 **구조화된 취약점 기록(`StructuredErrorRecord`)**을 정의하였다.

## 2. 9대 학술 오답 분류 체계 (Academic Error Taxonomy)

| 코드 | 한글 명칭 | 설명 | 레거시 매핑 (`ErrorType`) |
| :--- | :--- | :--- | :--- |
| `NO_ERROR` | 정상 완제 (오류 없음) | 핵심 개념, 전개 논리, 최종 결론이 학술적으로 타당함 | `none` |
| `CONCEPT_MISUNDERSTANDING` | 개념 이해 부족 | 핵심 개념의 정의, 성질, 또는 의미를 오해함 | `concept_confusion` |
| `FORMULA_MISAPPLICATION` | 공식의 잘못된 적용 | 문제 조건에 맞지 않는 정리를 적용하거나 전제조건 무시 | `method_selection_error` |
| `CALCULATION_ERROR` | 계산 실수 | 접근법과 논리는 맞으나 중간 산술/대수 계산 및 부호 착오 | `calc_or_impl_mistake` |
| `LOGICAL_ERROR` | 논리 전개 오류 | 단계 간의 인과관계 결여, 순환논증, 또는 논리적 비약 | `concept_confusion` |
| `CONDITION_OMISSION` | 조건 누락 | 문제에 주어진 필수 제약 조건, 정의역, 특수 조건을 간과 | `condition_misinterpretation` |
| `TERMINOLOGY_ERROR` | 용어 사용 오류 | 학술 용어, 표기법, 또는 기호의 부적절한 사용 | `concept_confusion` |
| `INCOMPLETE_REASONING` | 풀이 과정 부족 | 정답만 제시하거나 핵심 증명/유도 단계가 생략됨 | `concept_confusion` |
| `ANSWER_FORMAT_ERROR` | 답안 형식 오류 | 요구된 단위, 표현 형태, 또는 제출 양식 미준수 | `condition_misinterpretation` |
| `UNCERTAIN` | 원인 확정 불가 | 답안 서술이 모호하여 오류 원인을 단정할 수 없음 | `concept_confusion` |

## 3. 구조화된 취약점 기록 (`StructuredErrorRecord`)

```typescript
export interface StructuredErrorRecord {
  errorType: AcademicErrorType;     // 9대 학술 오답 유형
  legacyErrorType: ErrorType;       // 레거시 호환 오답 유형
  severity: 'critical' | 'moderate' | 'minor' | 'none'; // 취약점 심각도
  conceptId?: string;               // 취약점이 발견된 핵심 개념 ID
  conceptTitle?: string;            // 핵심 개념 이름
  evidence: string;                 // 학생 답안 내 오류 직접 인용
  feedback: string;                 // 취약점 극복을 위한 개념 보완 지도
  evaluationVersion: string;        // 평가 엔진 버전 ('p03-eval-v1')
  evaluatedAt: string;              // 평가 일시 (ISO 8601)
}
```

### 심각도 판정 기준 (Severity)
- **`none`**: 90점 이상 획득 시 부여.
- **`minor`**: 단순 계산 실수, 표기법 사소한 오기, 단순 답안 형식 미준수.
- **`moderate`**: 부차적 제약조건 누락, 일부 논증 단계 축약.
- **`critical`**: 핵심 정리의 부적절한 차용, 근본적 정의 오해, 반대 부호에 기초한 잘못된 전개.

## 4. 양방향 변환 및 하위 호환성 (Bidirectional Conversion)

- `toAcademicErrorType(val: unknown)`:
  - 레거시 문자열(`'concept_confusion'`, `'concept'`, `'calc_or_impl_mistake'`, `'calculation'`, `'condition_misinterpretation'`, `'method_selection_error'`, `'logic'`, `'none'`)을 9대 학술 분류로 안전하게 매핑.
- `toLegacyErrorType(val: unknown)`:
  - 신규 9대 분류를 기존 4대 `ErrorType`으로 자동 축약하여 기존 분석 대시보드와 복습 알고리즘(`todayStudy`, `retentionModel`)이 무단 중단 없이 작동하도록 보장.

## 5. 저장소 및 데이터베이스 영속화 (Storage Persistence)

- 사용자가 풀이를 완료하고 확정 저장하면:
  - `Attempt` 엔티티에 `academicErrorType`과 `structuredError`가 함께 포함되어 로컬 저장소 및 Supabase DB에 기록된다.
  - `storage.recordAttemptAndUpdateConcept()` 호출 시 생성되는 `ReviewEvent`의 `payload`에 해당 데이터가 영구 보존된다.
  - 과거의 채점 결과 및 스냅샷은 불변(Immutable) 상태로 유지된다.
