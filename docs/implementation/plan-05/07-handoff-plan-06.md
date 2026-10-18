# Plan 05 — 07. Plan 06 인수인계 및 운영 지침서 (Handoff to Plan 06)

## 1. Plan 05 달성 결과 요약

Plan 05를 통해 LearnAway는 데이터 안전성(Goal A)과 AI 운영 비용 통제(Goal B)의 핵심 백엔드 및 인프라 기반을 완성하였다:

1. **데이터 안전성 (Goal A)**:
   - Supabase를 권위적 단일 진실 공급원(SoT)으로 확립하고 로컬 캐시와 초안을 엄격히 계층화.
   - Plan 04 핵심 학습 필드(`masteryScore`, `retentionScore`, `recommendedPracticeKind` 등)의 완전 보존.
   - Google Drive 백업 v2 스키마(`schemaVersion: 2`, `contentHash`, `recordCounts`) 구축 및 위변조 거부.
   - `checkStoredDataIntegrity()`를 통한 비정상 JSON 사전 감지 및 `QuotaExceededError` 무중단 격리.
2. **AI 운영 비용 통제 (Goal B)**:
   - 게스트 1회, 일반 회원 3회 크레딧 정책 및 개인 API 키 0회 차감 원칙 확립.
   - 6대 AI API 라우트 전수 텔레메트리 연동 및 모델별 단가표(`deepseek-v4.1-flash`: $0.14/$0.28) 기준 실시간 USD/KRW 원가 계산.
   - 관리자 분석 집계 엔드포인트(`GET /api/admin/ai-metrics`) 및 비정상 어뷰징 탐지(Anomaly Alert) 탑재.
   - 망각곡선 및 학습 스케줄러의 100% 로컬 연산 불변 조건 보장 (AI 호출 0회).

---

## 2. Plan 06 (UI/UX 고도화 및 온보딩 개선) 인수인계 과제

Plan 06 엔지니어는 Plan 05에서 구현된 견고한 백엔드 인터페이스를 바탕으로 다음의 사용자 경험 개선 작업을 수행할 수 있다:

### 과제 1: 운영자 AI 비용 모니터링 대시보드 화면 구축
- **연동 API**: `GET /api/admin/ai-metrics`
- **구현 내용**:
  - 일별 AI 호출 건수, 총 토큰 수, 일별 원화(KRW) 지출 추이를 시각화하는 차트 컴포넌트 추가.
  - 운영자 체험 크레딧 vs 개인 API 키 비율 파이 차트 제공.
  - 비정상 대량 호출 발생 시 상단에 "어뷰징 의심 사용자(Anomaly)" 경고 배지 표시.

### 과제 2: 헤더 및 설정 화면의 크레딧/개인키 상태 배지
- **연동 모듈**: `lib/trialCredits.ts`, `lib/aiCredentials.ts`
- **구현 내용**:
  - 네비게이션 헤더에 현재 사용자의 크레딧 상태 표시:
    - 게스트: `체험 1회 남음 (가입 시 +2회)`
    - 일반 회원: `체험 N회 남음` (소진 시 `크레딧 소진 - 개인 키 필요`)
    - 개인 API 키 사용자: `개인 API 키 활성 (무제한)` (초록색 배지)
  - 크레딧 소진 시 부드러운 온보딩 모달을 띄워 OpenAI/DeepSeek API 키 발급 가이드 링크 제공.

### 과제 3: 저장소 상태 점검 및 원클릭 복원 배너
- **연동 모듈**: `lib/storage.ts`의 `checkStoredDataIntegrity()`
- **구현 내용**:
  - 앱 초기 로딩 시 무결성 검증을 백그라운드로 수행.
  - `ok: false`일 경우 화면 상단에 비간섭형 알림 배너 표시: "로컬 데이터에 이상이 감지되었습니다. [클라우드에서 최신 데이터 복원] [JSON 백업 다운로드]"

### 과제 4: Google Drive v2 백업 UI 및 미확인 과목 매핑 모달
- **연동 모듈**: `lib/materialRestore.ts`, `lib/drive/googleDrive.ts`
- **구현 내용**:
  - 백업 관리 화면에서 최근 백업 일시, 백업 ID, 무결성 해시 상태 표시.
  - 타 계정 또는 구형 기기 백업 복원 시 과목이 일치하지 않을 때 `need_subject_mapping` 플래그를 감지하여 "과목 매핑 선택 모달"을 띄우고 사용자가 직접 새 과목 생성 또는 기존 과목에 연결할 수 있도록 지원.

---

## 3. 환경 변수 및 배포 체크리스트

프로덕션 배포 시 다음 환경 변수가 구성되어 있는지 확인하십시오:

| 환경 변수명 | 필수 여부 | 권장 기본값 / 설명 |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | 필수 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 필수 | 클라이언트 공개 anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 (서버 전용) | 크레딧 및 관리자 텔레메트리 전용 키 |
| `BAZE_API_KEY` | 권장 (학교 AI) | 학교 게이트웨이 deepseek-v4.1-flash API 키 |
| `BAZE_BASE_URL` | 권장 (학교 AI) | 학교 BAZE Gateway 엔드포인트 URL |
| `GOOGLE_CLIENT_ID` | 선택 (Drive 백업) | Google Cloud 콘솔 OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | 선택 (Drive 백업) | Google Cloud 콘솔 OAuth Client Secret |
| `GOOGLE_SESSION_SECRET` | 선택 (Drive 백업) | AES-256-GCM 세션 암호화 키 (32바이트 이상) |
| `EMERGENCY_AI_SHUTDOWN` | 운영 비상용 | 기본값 `false`. `true` 설정 시 모든 운영자 크레딧 호출 차단 |

### 마이그레이션 적용
Plan 05 신규 마이그레이션이 Supabase에 적용되어 있는지 확인하십시오:
- `supabase/migrations/20260101000030_ai_usage_telemetry.sql`: 텔레메트리 테이블 생성, 인덱스 및 RLS 정책.
