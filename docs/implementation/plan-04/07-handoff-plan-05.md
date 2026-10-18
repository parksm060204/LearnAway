# Plan 04 — 07. Plan 05 인계 문서 (Handoff to Plan 05)

## 1. Plan 04 완료 상태 요약
- **작업 브랜치**: `feat/plan-04-adaptive-review`
- **인계 상태**: **READY** (모든 단위·통합·회귀 테스트 및 프로덕션 빌드 통과 완료)
- **달성 목표**:
  - 숙련도(Mastery)와 기억 유지율(Retention)의 분리 모델 구축.
  - Plan 03 학술 오답 분류 연계 5대 맞춤형 재출제 유형(Types A~E) 결정론적 매핑.
  - 시험 D-Day 3단계 적응형 스케줄러 및 일일 학습량 상한 엄격 준수.
  - 복합 개념 전체 문항 귀속 및 동일 풀이 멱등성 보장.
  - 4대 규칙 기반 설명 가능성 UI 연동.
  - 전수 회귀 테스트 (393건 통과) 및 1~90일 시뮬레이션 완료.

---

## 2. Plan 05 (클라우드 동기화, 백업 및 운영 최적화) 인계 항목

Plan 05 엔지니어가 이어받아 진행해야 할 핵심 작업 목록:

### A. 클라우드 DB 스키마 동기화 및 마이그레이션 적용
- **배경**:
  - Plan 04에서 `Concept`에 추가된 `masteryScore`, `retentionScore`, `StudyPlanItem`의 `recommendedPracticeKind`, `explanationDetails`는 로컬 및 JSON 스키마에서 안전하게 운용 중임.
- **인계 작업**:
  - Supabase `concepts` 테이블 및 `study_plan_items` 테이블의 서버 스키마에 해당 필드가 필요한 경우 후속 마이그레이션을 안전하게 추가할 것 (기존 레코드 보존 필수).
  - RLS(Row Level Security) 정책이 사용자별로 엄격히 적용되는지 확인.

### B. 다중 기기 간 실시간 동기화 충돌 해결 (Conflict Resolution)
- **배경**:
  - 학생이 태블릿에서 문제를 풀고(`Attempt`), 노트북에서 스케줄러(`StudyPlan`)를 조회하는 경우 발생할 수 있는 시계열 불일치.
- **인계 작업**:
  - `completedAt` 및 `updatedAt` 타임스탬프 기반의 LWW (Last-Write-Wins) 또는 Vector Clock 기반 충돌 병합 정책 적용.
  - 오프라인 상태에서 생성된 `Attempt`가 온라인 복귀 시 누락 없이 서버로 동기화되도록 오프라인 큐 처리 보강.

### C. Google Drive 및 클라우드 백업 스키마 정합성 검증
- **배경**:
  - `lib/drive/googleDrive.ts`와 `lib/cloud/` 저장소가 Plan 04에서 확장된 `masteryScore`, `academicErrorType` 필드를 정상적으로 내보내기/가져오기 할 수 있는지 확인.
- **인계 작업**:
  - 백업 JSON 파싱 시 신규 필드가 누락되지 않는지 백업-복원 회귀 테스트에 Plan 04 필드 검증 추가.

### D. 서버리스 및 Cron 알림 운영 비용 최적화
- **배경**:
  - Vercel Hobby 환경의 Cron 실행 제한(1일 1회)과 타임아웃(60초) 내에서 복습 알림(`app/api/reminders/cron/route.ts`)이 효율적으로 실행되어야 함.
- **인계 작업**:
  - 복습 대상이 없는 사용자는 조기 반환(Early Return)하여 서버리스 실행 시간 절약.
  - 발송 성공 여부 및 멱등 토큰을 기록하여 중복 푸시/이메일 발송 차단.

---

## 3. 주요 주의사항 (Invariants to Maintain)
1. **AI 크레딧 보호 원칙**:
   - 스케줄 계산, 복습 계획 조회, 우선순위 정렬에서 절대로 유료 AI API를 호출하지 말 것.
2. **과거 풀이 기록 불변성**:
   - 서버 동기화 과정에서 과거의 `Attempt`, `ReviewEvent`, 루브릭 평가 스냅샷을 최신 데이터로 임의 덮어쓰거나 초기화하지 말 것.
3. **사용자 설정 존중**:
   - 학생이 설정한 요일별 가용 시간, 수동 미루기 일수, 고정 학습 범위는 서버 병합 시 항상 최우선 보존할 것.
