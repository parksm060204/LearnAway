# Plan 05 — 02. 로컬-클라우드 동기화 일관성 및 Plan 04 필드 보존 정책 (Sync Consistency & Plan 04 Field Preservation)

## 1. 동기화 개요 및 과제
LearnAway의 분산 동기화 시스템은 클라이언트의 오프라인 학습 데이터와 Supabase Cloud DB를 양방향으로 동기화한다.
Plan 04에서 도입된 적응형 복습 엔진의 핵심 필드(`masteryScore`, `retentionScore`, `recommendedPracticeKind`, `vulnerableRubricCriteria` 등)가 DB 업서트(`upsert`) 및 행 조회(`rowToConcept`) 과정에서 누락되거나 기본값으로 초기화되는 경우, 장기 간격 반복 복습 모델 전체가 왜곡될 위험이 있다.

본 문서는 로컬-클라우드 간 동기화 일관성 보장 정책, JSONB 페이로드를 통한 확장 필드 무손실 왕복(Roundtrip), 동시성 제어 및 멱등성 보장 방안을 정리한다.

---

## 2. Plan 04 핵심 학습 필드의 완전 보존

### 2.1 개념(`Concept`) 엔티티 동기화
`lib/cloud/learningMappers.ts`의 `conceptToUpsert` 및 `rowToConcept`는 DB 테이블의 고정 열 외의 진보된 학습 상태를 `payload` JSONB 열에 완전 보존한다:

| 필드명 | 데이터 타입 | 보존 위치 | 동기화 목적 |
| :--- | :--- | :--- | :--- |
| `id` | string (UUID) | DB 열 `id` | 개념 식별자 |
| `subjectId` | string (UUID) | DB 열 `subject_id` | 소속 과목 외래키 |
| `title` | string | DB 열 `title` | 개념명 |
| `order` | number | DB 열 `order_index` | 강의 순서 |
| `status` | string | DB 열 `status` | 학습 상태 (`unstudied`, `in_progress`, `review_needed`, `mastered`) |
| `currentScore` | number | DB 열 `current_score` | 하위 호환성 점수 (0~100) |
| **`masteryScore`** | number | **DB 열 `payload.masteryScore`** | **Plan 04 누적 개념 숙련도 (망각곡선 독립 수치)** |
| **`retentionScore`** | number | **DB 열 `payload.retentionScore`** | **Plan 04 현재 회상 확률 (망각 감쇠 반영 수치)** |
| **`vulnerableRubricCriteria`** | string[] | **DB 열 `payload.vulnerableRubricCriteria`** | **취약 루브릭 평가 기준 목록** |
| `events` | ReviewEvent[] | **DB 테이블 `review_events`** | 풀이 이력 이벤트 (독립 테이블로 정규화 관리) |

```typescript
// 매핑 보존 검증 (Roundtrip)
const upsertRow = cloudLearningMappers.conceptToUpsert(concept);
const roundtrip = cloudLearningMappers.rowToConcept(upsertRow);
assert.equal(roundtrip.masteryScore, concept.masteryScore);
assert.equal(roundtrip.retentionScore, concept.retentionScore);
assert.deepEqual(roundtrip.vulnerableRubricCriteria, concept.vulnerableRubricCriteria);
```

### 2.2 학습 계획(`StudyPlanItem`) 엔티티 동기화
`planItemToUpsert` 및 `rowToPlanItem`은 Plan 04의 맞춤형 문제 추천 유형 및 설명 가능성 세부정보를 보존한다:
- `recommendedPracticeKind`: 맞춤형 문제 재출제 5대 유형 (`original_rechallenge`, `similar_problem`, `variant_problem`, `transfer_problem`, `concept_targeted`)
- `explanationDetails`: 학습자에게 제공되는 4대 설명 규칙 근거 객체 (`reasons`, `targetScore`, `decayDays`)

---

## 3. 동시성 제어 및 충돌 해결 전략 (Conflict Resolution)

### 3.1 낙관적 동시성 제어 (Optimistic Concurrency Control)
- 모든 동기화 가능한 엔티티는 단조 증가 `version` 필드 또는 ISO `updated_at` 타임스탬프를 보유한다.
- 클라이언트가 서버로 변경 사항을 푸시할 때, 기존 레코드의 버전을 조건부 검증한다.
- 서버 버전이 로컬 시작 버전보다 높은 경우 충돌(Conflict) 상태로 처리하며 무조건적인 덮어쓰기(`blind upsert`)를 거부한다.

### 3.2 충돌 해결 규칙 (Resolution Matrix)
```mermaid
graph TD
    SyncStart[동기화 요청 시작] --> VersionCheck{서버 버전 > 로컬 버전?}
    VersionCheck -->|No: 최신 로컬| PushServer[서버 Upsert 적용 및 버전 증가]
    VersionCheck -->|Yes: 동시 변경 충돌| EntityType{충돌 대상 엔티티?}
    EntityType -->|Attempt / ReviewEvent| AppendOnly[원자적 Append: 두 기록 모두 보존 (고유 ID)]
    EntityType -->|Concept / PlanItem| FieldMerge[지능형 병합: 최신 풀이 이력 기준 재계산]
    EntityType -->|Material Body| KeepBoth[충돌 복사본 보존 및 사용자 선택 안내]
```

1. **Attempt / ReviewEvent (추가 전용 로그)**:
   - 과거 풀이 기록은 절대 덮어쓰지 않는다.
   - 클라이언트 UUID가 고유하므로 두 기기에서 발생한 풀이는 각각 독립된 행으로 서버에 병합된다.
2. **Concept 점수 병합**:
   - 두 기기에서 충돌 시, 서버의 최신 풀이 이벤트 목록을 기준으로 `retentionModel` 함수를 재실행하여 결정론적으로 일관된 점수를 재도출한다.
3. **미저장 로컬 답안 보존**:
   - 동기화 도중 네트워크 실패나 충돌이 발생해도 클라이언트의 `inMemoryStore` 및 `localStorage` 초안은 절대 삭제하지 않는다.

---

## 4. 멱등성 및 중복 방지 (Idempotency & Deduplication)

1. **클라이언트 생성 UUID 고유성**:
   - 모든 과목, 자료, 개념, 문제, 풀이, 복습 이벤트는 생성 시 클라이언트에서 고유 UUID v4를 부여한다.
   - 네트워크 타임아웃으로 인한 재시도 시에도 동일 ID를 사용하므로 중복 레코드가 생성되지 않는다.
2. **DB 유니크 제약 조건**:
   - `attempts` 테이블: `UNIQUE (user_id, id)`
   - `review_events` 테이블: `UNIQUE (user_id, id)`
   - `user_trial_credits` 테이블: `UNIQUE (user_id)`
3. **학습 통계 이중 계산 방지**:
   - 재시도 요청으로 인해 복습 회차(`round`)나 학습 횟수가 중복 가산되지 않도록 이벤트 ID 기준 중복 검사(`Set` 필터링)를 상시 수행한다.
