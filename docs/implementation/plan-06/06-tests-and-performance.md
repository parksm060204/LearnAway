# Plan 06 — 06. 검증 테스트 및 렌더링 성능 최적화 (Tests & Performance)

## 1. 개요
Plan 06의 프론트엔드 UX 고도화는 단순 시각적 수정을 넘어, 엄격한 회귀 테스트(Regression Tests)와 렌더링 안정성 규칙을 충족하도록 설계되었다.
본 문서는 추가된 8대 회귀 검증 항목(P06-01 ~ P06-08)과 빌드·타입 검사 결과 및 성능 최적화 내역을 기록한다.

---

## 2. Plan 06 8대 회귀 검증 명세 (P06-01 ~ P06-08)

`scripts/test-regressions.mjs`에 통합된 8대 테스트의 목적과 검증 결과는 다음과 같다:

| 테스트 ID | 검증 명칭 | 핵심 검증 내용 | 결과 |
| :--- | :--- | :--- | :---: |
| **P06-01** | 신규 사용자 0과목 Null-Safety | 과목이 0개일 때 `activeSubject`가 null/undefined여도 메인 워크스페이스 및 하위 컴포넌트 크래시 방지 | **PASS** |
| **P06-02** | 온보딩 및 샘플 로더 무결성 | `INITIAL_SUBJECTS/MATERIALS/CONCEPTS/PROBLEMS` 데모 데이터 로드 및 스토리지 무결성 검증 통과 | **PASS** |
| **P06-03** | D-Day 산출 및 복습 우선순위 | 미래/과거/당일 D-Day 레이블 규격(`D-5`, `시험 종료`) 및 당일 보류 항목 필터링 검증 | **PASS** |
| **P06-04** | 강의 자료 등록 및 중복 감지 | 20MB/10MB 파일 한도 및 동일 내용 등록 시 `findDuplicateMaterial` 중복 감지 정확성 | **PASS** |
| **P06-05** | 임시 답안 저장 격리 및 초기화 | `practiceAnswerDraft`의 탭별 격리 저장, 새로고침 복원 및 제출 후 원자적 삭제 무결성 | **PASS** |
| **P06-06** | 복습 일정 조정 시 점수 불변성 | `postponeConceptReview` 호출 시 기본 점수/현재 점수 불변 및 가짜 ReviewEvent 미생성 불변 조건 | **PASS** |
| **P06-07** | 반응형 탭 및 접근성 시맨틱 | 7대 탭 식별자 규격, 학술 오류 9대 레이블 및 5단계 학술 난이도 체계 완비 검증 | **PASS** |
| **P06-08** | AI 사용량 계측 및 비용/이상 탐지 | `recordAiUsageTelemetry` 기록, USD/KRW 비용 환산 및 체험/개인키 분리 집계 무결성 | **PASS** |

---

## 3. 전체 테스트 및 빌드 검증 결과

```bash
# 1. TypeScript 타입 검사
$ npx tsc --noEmit
✓ Compiled successfully (0 errors)

# 2. ESLint 코드 스타일 및 규칙 검사
$ npm run lint
✓ No errors, no warnings (0 errors, 0 warnings)

# 3. Next.js 16 프로덕션 빌드
$ npm run build
✓ Compiled successfully in 1702ms
✓ Generating static pages (4/4) in 101ms

# 4. 회귀 테스트 러너
$ npm run test:regressions
✓ 409 regression checks passed (P01~P06 전수 통과)

# 5. 종합 비즈니스 로직 테스트 스위트
$ npm run test:suite
✓ 287 passed, 0 failed (Stage 1~10 전수 통과)
```

---

## 4. 프론트엔드 성능 및 렌더링 최적화 내역

### 4.1 React Hook 규칙(Rules of Hooks) 엄격 준수
`HistoryWorkspace.tsx`와 `ProblemsWorkspace.tsx`에서 과목이 없을 때 조기 반환(`if (!activeSubject) return ...`)을 수행하는 위치를 모든 `useMemo`, `useCallback`, `useState` 훅의 **이후**로 재배치하였다. 이를 통해 과목 생성/삭제 시 React 훅 호출 순서가 뒤바뀌는 런타임 에러(`Rendered fewer hooks than expected`)를 원천 차단하였다.

### 4.2 불필요한 리렌더링 방지 및 무과금 로컬 연산 보장
- **결정론적 로컬 연산**: 망각곡선 감쇠 계산, D-Day 산출, 복습 우선순위 정렬은 브라우저 CPU에서 수 밀리초 내로 즉각 완료되며, 어떠한 유료 AI 호출도 유발하지 않는다 (`AI API 호출 0회`).
- **메모이제이션**: 취약 개념 필터링 및 통계 집계 연산에 `useMemo`를 적용하여 탭 전환 시 매끄러운 60fps 인터랙션을 제공한다.
