# 프론트엔드 통일감 및 정보 밀도 개선 작업 지시

## 역할과 목표

사용자는 프론트엔드가 난잡하다고 느끼며, 전체 UI 통일감 개선을 요청했다. 주 담당 Codex는 계획과 검토만 하고, 실제 코드 구현과 검증은 Antigravity `gemini-4-hydrogen-medium` 워커가 전담한다. 이 문서는 실행 지시이며 추가 승인 없이 현재 작업 공간에서 구현과 검증까지 완료한다.

## 사전 확인과 보존

- 작업 경로: `C:\Users\abcde\Desktop\study-tool`. AGENTS.md, README, docs/implementation/plan-06의 UX·대시보드·접근성 문서와 현재 코드를 읽는다. 문서보다 현재 코드의 실제 동작을 우선 확인한다.
- Next.js 16의 로컬 가이드 `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`, `03-layouts-and-pages.md`와 관련 가이드를 읽고 수정한다.
- supabase/migrations의 현재 스키마를 확인하되 UI 작업에서 DB/API/저장소/인증/AI 모델 설정을 변경하지 않는다. 앱 기본 AI와 워커 모델은 별개다.
- 시작 시 git status와 diff를 기록한다. 기존 수정 파일: AGENTS.md, components/MockExamModal.tsx, lib/cloud/mockExamSync.ts, lib/cloud/pendingExamAnswers.ts, scripts/test-recovery.mjs. 미추적 debug.log, install.cmd도 사용자 소유로 간주한다. 기존 변경을 덮어쓰거나 되돌리지 않는다. MockExamModal은 이번 변경에서 제외하고 공통 스타일 영향만 점검한다.
- 커밋, 푸시, 배포, 데이터 삭제, 실제 유료 AI 호출을 하지 않는다. 비밀정보를 읽어 출력하지 않는다.

## 진단과 디자인 방향

현재 globals.css에는 종이색 배경, 잉크색 텍스트, crimson 포인트, Pretendard/Noto Serif KR/JetBrains Mono 토큰이 존재한다. 이를 유지하고 확장한다. 여러 화면의 10~11px 일반 텍스트, 다양한 장식용 색상, 반복된 박스·배지·액션, 상단의 밀집된 메뉴가 정보 우선순위를 흐리는지 확인한다. 현재 TodayWorkspace가 차트를 먼저 강조하는지 확인하고 오늘의 핵심 학습 동작이 우선 보이도록 정리한다.

1. **공통 시각 규칙**: 색상, 간격, radius, border, surface, 타이포그래피와 focus 토큰을 정리한다. 제목/본문/보조 설명/수치의 역할을 구분하고 일반 텍스트에 mono를 남용하지 않는다. 일반 본문과 입력은 읽을 수 있는 크기로, 작은 텍스트는 제한된 메타데이터에만 사용한다. 포인트 색은 주요 행동·선택 상태에 집중하고 성공/경고/실패 색의 의미는 유지한다.
2. **작은 공통 UI 기반**: 기존 구조를 확인한 뒤 필요한 최소한의 Button, Card/Section, WorkspaceHeader, Badge, Input/Select, EmptyState 등을 컴포넌트 또는 명시적 공통 클래스로 공유한다. 정의만 만들지 말고 실제 화면에서 사용한다. 광범위한 CSS 선택자, !important 덮어쓰기, 원시 Tailwind 색상 일괄 치환은 피한다. 새 UI 라이브러리나 불필요한 의존성은 추가하지 않는다.
3. **상단과 정보 구조**: TopUtilityBar의 과목 선택·주요 탭·계정 도구를 구분하고 반복 바로가기와 배지의 시각적 경쟁을 줄인다. 기능을 제거하지 않고 보조 행동은 적절한 메뉴나 섹션 안에서 접근 가능하게 한다. 활성 탭과 메뉴의 focus/선택 상태가 명확해야 한다.
4. **핵심 5개 화면**: TodayWorkspace, MaterialsWorkspace, ProblemsWorkspace, HistoryWorkspace, SettingsWorkspace의 헤더·검색/필터·액션·목록·빈 상태를 같은 규칙으로 통일한다. 화면별 주 동작 하나가 우선 보이도록 하고, 보조 동작의 무게를 낮춘다. 큰 카드 안의 불필요한 중첩 박스와 장식성 구분선을 줄인다. Today의 핵심 하위 컴포넌트(예: TodayStudyList, TodayReviewPanel, ConceptRail, StatusStrip, ForgettingCurveChart)도 실제 렌더링을 보고 필요한 표현 수정만 수행한다.
5. **연결 흐름**: AddSubjectModal, MaterialUploadModal, ProblemGeneratorModal, ProblemSessionModal 등 실제 사용 빈도가 높은 연결 모달을 확인하고 헤더·입력·하단 버튼·간격을 같은 규칙으로 맞춘다. GatewayPage/로그인의 기존 톤도 확인하고 유독 다른 부분만 정리한다. 모든 모달을 대대적으로 재작성하지 않는다.
6. **반응형·접근성**: 최소 375px 모바일과 1440px 데스크톱에서 주요 5개 화면을 점검한다. 긴 한국어 과목명, 빈 데이터/내용이 있는 상태, 검색/필터, 메뉴와 모달을 확인한다. 페이지 가로 overflow를 없애고 버튼 줄바꿈·메뉴 폭·차트 overflow를 처리한다. 주요 컨트롤에 라벨과 visible keyboard focus를 유지한다. 필요시 메뉴 닫기와 포커스 복원을 보완하되 범위를 좁힌다.

## 동작 보존

라우팅과 activeTab, 과목 선택, 업로드, 개념 분석, 문제 생성/검토/풀이, 모의시험 진입, 기록 조회, 설정을 보존한다. 성공/실패/충돌/저장 중/부분 완료 등의 의미와 재시도 동작은 없애거나 축약으로 감추지 않는다. 시험 답안, 로컬 초안, 서버 상태, 과거 버전/스냅샷, retry 로직을 수정하지 않는다. 모달의 기존 submit 이벤트와 disabled 상태, 로딩과 서버 확인 메시지를 보존한다.

## 완료 조건과 증거

- 작업 후 lint, `npx tsc --noEmit`, `npm run test:regressions`, `npm run build`를 실행하고 결과를 기록한다. 실패 시 기존 실패와 신규 회귀를 분리하고 신규 회귀는 수정한다. 비영(非零) 종료는 성공으로 보고하지 않는다.
- 여러 TSX 컴포넌트를 수정하면 vercel:react-best-practices SKILL.md의 해당 체크리스트를 읽고 검토한다. dev 서버를 시작하면 vercel:verification SKILL.md를 읽고 해당 흐름에 맞게 검증한다. 브라우저는 Orca CLI 스킬을 읽고 Orca embedded browser를 사용한다.
- 가능하면 로컬 브라우저에서 데스크톱/모바일로 5개 탭과 핵심 메뉴/모달을 확인하고 변경 전후 스크린샷을 남긴다. 인증 제한이 있으면 개인정보 없는 허용된 데모 흐름을 활용하되 실제 사용자 저장소를 초기화하지 않는다. 인증을 우회하거나 데이터 로직을 바꾸지 않는다. 불가능한 브라우저 확인을 수행한 것처럼 쓰지 않는다.
- `docs/ui-consistency-report.md`에 변경 전 문제, 실제 개선, 공통 UI 사용처, 변경 파일, 수행한 검사와 종료 결과, 스크린샷 경로/브라우저 확인 범위, 남은 제한을 간결하게 작성한다. 새 환경 설정이 필요하지 않으면 그렇게 명시한다.
- 구현과 검증을 마친 뒤 orchestration의 worker_done으로 요약과 증거를 주 담당에게 보고한다. 기존 사용자 변경은 최종 diff에서도 보존한다.
