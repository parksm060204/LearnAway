# LearnAway 프론트엔드 통일감 및 정보 밀도 개선 보고서

## 1. 변경 전 문제

- **상단 유틸리티 바(`TopUtilityBar`) 밀집 및 줄바꿈**: 1440px 데스크톱에서도 과목 선택, 5개 탭, 바로가기·배지, AI 상태, 이메일·로그아웃이 한 줄에 겹치며 2줄로 줄바꿈됨.
- **시각 규칙·타이포그래피 불일치**: 화면마다 10~11px 일반 텍스트와 `font-academic-mono`가 본문·라벨에 혼용되고, 카드 테두리·패딩·빈 상태 표현이 워크스페이스마다 달랐음.
- **오늘 학습(`TodayWorkspace`) 정보 우선순위**: 핵심 학습 목록(`TodayStudyList`)보다 `ForgettingCurveChart`가 먼저 강조되어 오늘 할 일의 우선순위가 흐려짐.
- **모달 접근성 및 레이아웃**: `AddSubjectModal` 등 주요 모달이 `role="dialog"` / Escape 닫기 / 포커스 트랩·복원 규칙을 통일하지 않았고, 3열 시간 선택 그리드에서 `TimeDialPicker`가 좁은 열을 넘치는 문제가 있었음.

## 2. 실제 개선 내용

1. **공통 시각 토큰 및 CSS 변수 연결 (`app/globals.css`, `components/ui/`)**:
   - `app/globals.css`에 surface/status/radius/focus 토큰을 정리하고 `font-academic-mono`에 `font-variant-numeric: tabular-nums`를 적용했으며, `summary:focus-visible` 및 `[role="button"]:focus-visible` 포커스 링을 보강함.
   - 새로 추가한 `WorkspacePrimitives.tsx` 및 `ModalShell.tsx`의 표면/잉크/포인트/상태/radius 스타일을 `--paper-card`, `--paper-surface-muted`, `--paper-border`, `--paper-border-strong`, `--ink-primary`, `--ink-secondary`, `--ink-muted`, `--crimson-accent`, `--crimson-accent-hover`, `--crimson-light`, `--status-*-bg/text/border`, `--radius-control` CSS 변수에 직접 연결함.
2. **공통 UI 기반 신설 (`components/ui/`)**:
   - `WorkspacePrimitives.tsx`: `Button`, `Badge`, `SectionCard`, `WorkspaceHeader`, `EmptyState`, `Input`, `Select`
   - `ModalShell.tsx`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, 열릴 때 모달 내부 첫 포커스 가능 요소(`bodyRef` 우선)로 초기 포커스 이동, `Tab` / `Shift+Tab` 모달 내부 포커스 순환 트랩, `Escape` 키 닫기, 닫힐 때 기존 트리거가 DOM에 남아 있으면 포커스 복원(`onCloseRef`로 불필요한 리스너 재등록 방지).
3. **상단 내비게이션 (`TopUtilityBar.tsx`)**: 좌(브랜드·과목 드롭다운) / 중(5개 탭 `whitespace-nowrap`, 통일된 아이콘 톤, `aria-current="page"`) / 우(AI 상태·`계정` 드롭다운 메뉴) 3구역으로 분리하고, 외부 클릭 및 Escape 닫기·포커스 복원을 추가함.
4. **핵심 5개 워크스페이스 및 오늘 학습 하위 컴포넌트**:
   - `TodayWorkspace.tsx`: `TodayStudyList`를 `ForgettingCurveChart`보다 위에 배치하고, 빈 상태 3단계 온보딩을 `SectionCard`, `Button`, `Badge`, `break-keep`, `text-xs`로 정리함.
   - `ExamRecordCard.tsx`, `TodayStudyList.tsx`, `StatusStrip.tsx`, `ForgettingCurveChart.tsx`: 공통 `SectionCard`·`Button`·`Badge` 적용 및 과도한 장식 라벨 정리.
   - `MaterialsWorkspace.tsx`, `ProblemsWorkspace.tsx`, `HistoryWorkspace.tsx`, `SettingsWorkspace.tsx`: `WorkspaceHeader`, `SectionCard`, `Button`, `Badge`, `Input`, `Select`, `EmptyState`로 헤더·필터·목록·빈 상태 규칙을 통일하고 모바일 가로 스크롤 탭을 정리함.
5. **연결 모달 및 게이트웨이 (`AddSubjectModal.tsx`, `MaterialUploadModal.tsx`, `ProblemGeneratorModal.tsx`, `GatewayPage.tsx`)**: `AddSubjectModal`을 `ModalShell`/`Input`/`Button`으로 이전하고 `시험일`과 `시작/종료 시각` 2열 그리드로 분리해 `TimeDialPicker` 넘침을 해소함. `MaterialUploadModal`·`ProblemGeneratorModal`의 `role="dialog"`·헤더·푸터 버튼을 맞추고 `GatewayPage` 히어로 문구에 `break-keep`을 적용함.

## 3. Vercel 스킬 검토 적용 내역

- `C:/Users/abcde/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/react-best-practices/SKILL.md`:
  - `bundle-barrel-imports`: `components/ui/index.ts` 배럴 파일을 만들지 않고 `@/components/ui/WorkspacePrimitives`, `@/components/ui/ModalShell`을 직접 import함.
  - `client-event-listeners` & `advanced-event-handler-refs`: `ModalShell`의 `keydown` 리스너를 `isOpen`일 때만 등록·해제하고 `onCloseRef`/`closeOnEscapeRef`를 사용해 부모 리렌더로 포커스 초기화가 재실행되지 않게 함.
  - `rerender-no-inline-components` / `rendering-conditional-render`: 컴포넌트 내부 인라인 컴포넌트 정의를 두지 않고 `ReactNode` 슬롯(`footer`, `icon`) 조건부 렌더링에서 숫자 `0` 누출이 없음을 확인함.
- `C:/Users/abcde/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/verification/SKILL.md`:
  - 로컬 개발 서버(`next dev`), Orca 내장 브라우저 렌더링·키보드 동작·스크린샷, 서버 로그, `.env.local` 기반 환경 상태를 함께 확인함.

## 4. 공통 UI 사용처

- `Button`: `TodayWorkspace`, `ExamRecordCard`, `TodayStudyList`, `ForgettingCurveChart`, `MaterialsWorkspace`, `ProblemsWorkspace`, `SettingsWorkspace`, `AddSubjectModal`, `ProblemGeneratorModal`
- `Badge`: `TopUtilityBar`, `TodayWorkspace`, `ExamRecordCard`, `TodayStudyList`, `ForgettingCurveChart`, `MaterialsWorkspace`, `ProblemsWorkspace`, `HistoryWorkspace`, `SettingsWorkspace`
- `SectionCard`: `TodayWorkspace`, `ExamRecordCard`, `TodayStudyList`, `ForgettingCurveChart`, `MaterialsWorkspace`, `ProblemsWorkspace`, `HistoryWorkspace`, `SettingsWorkspace`
- `WorkspaceHeader`: `MaterialsWorkspace`, `ProblemsWorkspace`, `HistoryWorkspace`, `SettingsWorkspace`
- `EmptyState`: `MaterialsWorkspace`, `ProblemsWorkspace`, `HistoryWorkspace`
- `Input` / `Select`: `MaterialsWorkspace`, `ProblemsWorkspace`, `HistoryWorkspace`, `SettingsWorkspace`, `AddSubjectModal`
- `ModalShell`: `AddSubjectModal`

## 5. 변경 파일

- **신규**: `components/ui/WorkspacePrimitives.tsx`, `components/ui/ModalShell.tsx`, `docs/ui-consistency-report.md`
- **수정**: `app/globals.css`, `components/TopUtilityBar.tsx`, `components/TodayWorkspace.tsx`, `components/ExamRecordCard.tsx`, `components/TodayStudyList.tsx`, `components/StatusStrip.tsx`, `components/ForgettingCurveChart.tsx`, `components/MaterialsWorkspace.tsx`, `components/ProblemsWorkspace.tsx`, `components/HistoryWorkspace.tsx`, `components/SettingsWorkspace.tsx`, `components/AddSubjectModal.tsx`, `components/MaterialUploadModal.tsx`, `components/ProblemGeneratorModal.tsx`, `components/GatewayPage.tsx`
- **보존된 기존 사용자 변경 파일(무수정)**: `AGENTS.md`, `components/MockExamModal.tsx`, `lib/cloud/mockExamSync.ts`, `lib/cloud/pendingExamAnswers.ts`, `scripts/test-recovery.mjs`, `debug.log`, `install.cmd`, `docs/ui-consistency-worker-plan.md`

## 6. 검증 결과 (최종 수정 후 실행)

| 검사 항목 | 명령어 | 종료 코드 | 비고 |
| --- | --- | --- | --- |
| ESLint | `npm run lint` | `0` | 경고/오류 없이 통과 |
| TypeScript | `npx tsc --noEmit` | `0` | 타입 오류 없음 |
| 회귀 테스트 | `npm run test:regressions` | `0` | 5개 스크립트 전체 통과 |
| 프로덕션 빌드 | `npm run build` | `0` | Next.js 16.4.6 Turbopack 빌드 성공 |

## 7. 브라우저 확인 범위 및 스크린샷

Orca 내장 브라우저에서 로컬 개발 서버(`http://localhost:3000`, 일회용 테스트 계정 `ui_check_demo_26`)로 확인했습니다.

- **모달 키보드 검증 (`AddSubjectModal` / `ModalShell`)**:
  - 열기 직후 초기 포커스가 모달 내부 `#add-subject-name`으로 이동(`inDialog: true`).
  - `Shift+Tab`으로 `닫기` → 마지막 요소 `과목 생성 및 선택`으로 래핑(`inDialog: true`), `Tab`으로 다시 `닫기`로 래핑(`inDialog: true`), `Escape`로 모달 닫힘(`dialogOpen: false`) 확인.
  - 단, `TopUtilityBar`의 과목 드롭다운 안 `+ 새 과목 폴더 추가` 버튼은 클릭 시 드롭다운이 닫히며 언마운트되므로, 트리거가 DOM에 유지되는 경우에만 `ModalShell`의 `previousFocusRef` 복원이 동작합니다.
- **변경 전(기준선)**:
  - `/login`: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\eaa63afa-4203-44b3-a9ff-01069402d310-screenshot.png`
  - 온보딩: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\43381136-5fa1-45d8-a132-9075f889af73-screenshot.png`
  - 1440px Today(2줄 상단 바 확인): `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\85668f8c-103c-4a35-9276-07d0f8eeafb2-screenshot.png`
- **변경 후 데스크톱 (1440×900)**:
  - 오늘 학습: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\c7dc9e64-d593-4024-b7ea-b365b7983f07-screenshot.png`
  - 자료: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\a7756f57-70c0-45d3-95e0-38bd69fe2c25-screenshot.png`
  - 문제은행: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\f52f1c2a-d24f-4449-a29c-68ba79cb1553-screenshot.png`
  - 학습 기록: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\9083340e-1f74-4f15-b6c0-26be809103ba-screenshot.png`
  - 설정: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\ba8b3330-ea42-4f47-ab0f-c67cb2364301-screenshot.png`
  - `AddSubjectModal` 수정 후 확인: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\0957fa89-997f-4221-b33f-5dcf53c55737-screenshot.png`
- **변경 후 모바일 (375×812, 5개 탭 전체 확인)**:
  - 오늘 학습(`scrollWidth === innerWidth === 375`): `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\7c872422-a362-461b-941e-a34e140cb073-screenshot.png`
  - 자료: `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\e2fa835a-3197-49d5-af60-a53d8843c125-screenshot.png`
  - 문제은행(`scrollWidth === innerWidth === 375`): `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\b226a3f1-ba31-4afe-a7c2-6b4aedf783ac-screenshot.png`
  - 학습 기록(`scrollWidth === innerWidth === 375`): `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\8e84f6a7-5c76-4ace-acc0-fc37edcd4a69-screenshot.png`
  - 설정(`scrollWidth === innerWidth === 375`): `C:\Users\abcde\AppData\Local\Temp\orca-browser-screenshots\8ecdc877-0152-494a-a395-670ac300e23f-screenshot.png`

## 8. 남은 제한 사항 및 환경 설정

- **새 환경 설정 불필요**: 추가 패키지, 환경 변수, DB 마이그레이션 변경 없음.
- **샘플 데이터 경로 제한**: `TodayWorkspace`의 `"체험용 샘플 데이터 불러오기"`(`app/DashboardClient.tsx`의 `handleLoadDemoData`)를 실행해 확인한 결과, 해당 동작은 `resetToInitialDemoData()`로 `localStorage`에만 샘플을 기록한 뒤 새로고침하며, 로그인된 Supabase 세션(`ui_check_demo_26`)에서는 재조회 시 서버(Supabase) 클라우드 상태를 우선 로드하므로 빈 과목 상태가 유지되었습니다. 저장 로직·인증 우회·임의 SQL 조작을 하지 않는 정책에 따라 다량의 실제 개념/문제/채점 이력이 채워진 화면은 브라우저에서 직접 채워 확인하지 못했습니다.
