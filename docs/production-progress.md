# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-14 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 과거 계획 기준 SHA: `2946ffb104ca835539cd9aefca8fd6115bf19a97`
- 현재 작업 기준 HEAD SHA: `242ed2b` ("fix: harden save integrity and operational boundaries")
- 기본 자동 검사 실행 결과:
  - `npm run test:regressions`: **274 passed** (Stage 2 청크 분석 엔진 및 Stage 5 알림 멱등 검증 포함)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings** (React 19 훅 규칙 및 Next.js 린트 통과)
  - `npm run build`: **Compiled successfully in 16.5s** (11/11 pages & API routes Turbopack 최적화 빌드 완료)

---

## 1. 요구사항 대비 단계별 분류 및 구현 상태

| 단계 | 항목 | 최종 상태 | 구현 및 검증 내용 |
|---|---|---|---|
| **0단계** | A. 자료 저장 작업 정체성 | **구현 및 로컬 검증 완료**<br>*(운영 DB 실환경 대기)* | - `jobId`, `expectedVersion`, `last_completed_job_id` 응답 유실 복구 멱등성 보장<br>- 목표 해시 불일치 시 `MATERIAL_JOB_ID_CONFLICT` 에러로 버전 조작 방지 |
| **0단계** | B. 후처리 부분 완료 | **구현 및 로컬 검증 완료**<br>*(운영 DB 실환경 대기)* | - `materialEditSave`, `postprocessLedger` 부분 완료 영속 및 재시도 장부 분리<br>- 후처리 실패 시 전체를 completed로 속이지 않고 failure 기록 보존 |
| **0단계** | C. 답안·계정 격리 | **구현 및 로컬 검증 완료**<br>*(운영 DB 실환경 대기)* | - 탭별 독립 답안 초안(`draftStorageKey`) 분리 및 로컬 충돌 별도 보존<br>- 계정 전환 시 `scopeIsUnchanged()` 가드로 비동기 저장 중단 |
| **0단계** | D. PDF API와 운영 데이터 | **구현 및 로컬 검증 완료**<br>*(운영 DB 실환경 대기)* | - 세션 토큰 인증 강제 (`requireAuth: true`)<br>- 멀티파트 헤더 오버헤드 반영 및 비정상 body 400 처리, 매직 바이트 검증<br>- 파이썬 내부 경로/오류 사용자 노출 차단 |
| **1단계** | 실제 자료 입력과 MD 검토 | **구현 및 검증 완료** | - `lib/materialIngestion.ts`: 전사본과 일반 Markdown 분리 파싱, 크기/MIME 검증<br>- `components/MaterialUploadModal.tsx`: 동일 본문 해시 중복 감지 및 기존 자료 열기 안내<br>- 스캔/이미지 PDF(`needs_review`) 감지 시 외부 변환 MD(.md) 재연결 기능 제공 |
| **2단계** | 전체 범위 분석과 중단 재개 | **구현 및 검증 완료**<br>*(실제 AI 호출은 승인 대기)* | - `chunks.slice(0, 4)` 데모 제한 완전 제거<br>- `lib/analysisCheckpoint.ts`: `makeAnalysisJobKey`, 청크별 상태 장부(`AnalysisSessionLedger`), `getSessionProgress`<br>- 완료 청크 캐시 재사용으로 중복 AI 호출 방지, 출처 보존 개념 병합(`deduplicateConceptDrafts`) |
| **3단계** | 고난도 문제 생성·품질 검증 | **구현 및 검증 완료**<br>*(실제 AI 호출은 승인 대기)* | - `app/api/generate-problems/route.ts`: 누락 루브릭에 가짜 기본 템플릿 채우는 취약점 제거<br>- 루브릭 불일치/누락 시 `needs_review`로 초안 격리<br>- 코딩 문제는 격리 실행기 미탑재에 따른 AI 정적 평가 안내 명시 |
| **4단계** | 풀이·실제 평가·재도전 | **구현 및 검증 완료**<br>*(실제 AI 호출은 승인 대기)* | - 답안 및 문제/루브릭 스냅샷 고정 기반 평가<br>- 정답/동치/부분점수 기준 루브릭 합산 및 항목별 상한 검증 (`lib/evaluationValidation.ts`)<br>- 평가 성공 후 저장 실패 시 AI 재호출 없이 저장만 재시도하는 격리 처리 |
| **5단계** | 복습·망각곡선·실제 알림 | **구현 및 로컬 검증 완료**<br>*(운영 알림 실발송 대기)* | - `supabase/migrations/20260101000012_review_notifications.sql`: 구독 및 전달 로그 테이블<br>- `lib/reviewNotifications.ts`: KST 기준 알림 생성, 당일 중복 방지 idempotency key, 민감 정보 제외<br>- `/api/reminders/settings`, `/api/reminders/dispatch`, `components/RemindersSection.tsx` 연동 |
| **6단계** | 메인 UI 정리 및 운영 검증 | **구현 및 검증 완료** | - 메인 UI: 과목 D-day, 망각곡선 학술 복습 추정치 라벨 고지, 오늘 복습 3단 집중 구조 유지<br>- `npm run build` 성공 (11개 정적/동적 라우트 컴파일 및 타입 검사 통과) |

---

## 2. 변경 파일 목록

1. **보안 및 안정성 / 0단계**
   - `lib/cloud/materialsRepository.ts`: 작업 정체성/버전/해시 멱등성 및 충돌 보호
   - `app/api/convert/route.ts`: 멀티파트 크기 오버헤드 반영 및 비정상 요청 400 처리
   - `app/DashboardClient.tsx`: 계정 전환 감지 가드 (`scopeIsUnchanged`)

2. **자료 입력 및 파싱 / 1단계**
   - `lib/materialIngestion.ts`: 입력 유효성 검증, 중복 본문 해시 감지, MD/전사본 분리
   - `components/MaterialUploadModal.tsx`: 중복 자료 안내 링크, 스캔 PDF 외부 MD 재연결 버튼

3. **청크 분석 엔진 / 2단계**
   - `lib/analysisCheckpoint.ts` (신규): 청크 세션 장부, 중단/재개, 출처 보존 개념 중복 병합
   - `app/api/analyze-concepts/route.ts`: 4개 청크 제한 제거, 체크포인트 기반 완료 청크 재호출 스킵

4. **문제 생성 및 평가 / 3단계, 4단계**
   - `app/api/generate-problems/route.ts`: 가짜 루브릭 덮어쓰기 제거 및 `needs_review` 초안 격리, 코딩 AI 정적 평가 안내
   - `components/ForgettingCurveChart.tsx`: 망각곡선이 학술 추정치임을 알리는 고지 추가

5. **복습 알림 시스템 / 5단계**
   - `supabase/migrations/20260101000012_review_notifications.sql` (신규): 알림 구독/발송 로그 테이블
   - `lib/reviewNotifications.ts` (신규): KST 시간대, 당일 멱등성 키, 복습 리마인더 생성 로직
   - `app/api/reminders/settings/route.ts` (신규): 알림 채널/시간 설정 조회 및 저장 API
   - `app/api/reminders/dispatch/route.ts` (신규): 당일 복습 알림 발송 및 발송 로그 기록 API
   - `components/RemindersSection.tsx` (신규): 설정 화면 내 알림 관리 탭 UI
   - `components/SettingsWorkspace.tsx`: 알림 설정 섹션 연동

6. **테스트 및 계획 문서**
   - `scripts/test-regressions.mjs`: Stage 2 청크 분석 엔진 및 Stage 5 알림 멱등 회귀 테스트 추가
   - `docs/production-progress.md`: 전체 완성 진행 기록
   - `public/implementation-plan/*.md`: 진행 상황 동기화

---

## 3. 검증 구분 및 결과

1. **자동화 로컬 검사 (All Passed)**
   - `npm run test:regressions`: 274개 테스트 통과 (0 failed)
   - `npm run test:suite`: 287개 테스트 통과 (0 failed)
   - `npx tsc --noEmit`: 에러 0개
   - `npm run lint`: 에러 0개, 경고 0개
   - `npm run build`: Turbopack 최적화 빌드 성공 (종료 코드 0)
2. **실환경 검증 대기 (외부 자격증명/명시적 사용자 승인 필요 항목)**
   - **원격 Supabase 마이그레이션 적용**: 신규 파일 `20260101000012_review_notifications.sql`을 실제 운영 DB에 `supabase db push`하는 작업은 승인된 배포 권한 필요.
   - **학교 BAZE Gateway 유료 AI 호출**: deepseek-v4.1-flash 실제 계정 API 키를 통한 라이브 토큰 소모 테스트는 유료 예산 승인 필요.
   - **실제 이메일/웹푸시 발송**: Resend/WebPush VAPID 실제 외부 인증서 설정 후 테스트 수신자에게 전송하는 작업은 실제 서비스 크리덴셜 설정 대기.
