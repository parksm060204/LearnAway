# Plan 05 — 06. 회귀 테스트 및 장애 시뮬레이션 결과 보고서 (Tests & Failure Simulation)

## 1. 테스트 실행 결과 요약

LearnAway의 데이터 안전성(Goal A) 및 AI 운영 비용 통제(Goal B)를 검증하기 위해 단위, 통합, 회귀, 장애 시뮬레이션 테스트를 전수 수행하였다:

| 테스트 제품군 | 명령어 | 검증 항목 수 | 결과 | 비고 |
| :--- | :--- | :--- | :--- | :--- |
| **종합 회귀 테스트** | `npm run test:regressions` | **401 checks** | **100% 통과 (PASS)** | Plan 05 전용 8대 회귀 검증 포함 |
| **단계별 기능 테스트** | `npm run test:suite` | **287 checks** | **100% 통과 (PASS)** | Stage 1~10 핵심 비즈니스 로직 검증 |
| **TypeScript 정적 타입 검사** | `npx tsc --noEmit` | 프로젝트 전체 | **오류 0건 (Exit 0)** | 엄격 모드 (`--strict`) 통과 |
| **ESLint 코드 품질 검사** | `npm run lint` | 프로젝트 전체 | **오류 0건 (Exit 0)** | 린트 경고 및 규칙 준수 |
| **Next.js 프로덕션 빌드** | `npm run build` | 26개 전 라우트 | **성공 (Exit 0)** | Turbopack 최적화 번들 생성 |

---

## 2. Plan 05 전용 8대 핵심 회귀 검증 상세

### P05-01: 전체 저장소 무결성 검증 (`checkStoredDataIntegrity`)
- **검증 내용**: 빈 계정의 무결성 통과 여부 및 의도적으로 주입된 비정상 JSON(`{broken-json`) 감지.
- **결과**: `checkStoredDataIntegrity()`가 손상된 키(`redcall_user_...__subjects_v1`)를 정확히 감지하고 `ok: false`를 보고하여 크래시 없이 안전하게 예외 격리됨을 확인.

### P05-02: 클라우드 동기화 매퍼의 Plan 04 필드 완전 보존
- **검증 내용**: `Concept`의 `masteryScore`, `retentionScore`, `vulnerableRubricCriteria` 및 `StudyPlanItem`의 `recommendedPracticeKind`, `explanationDetails`의 DB 업서트 행 변환 및 조회 왕복(Roundtrip).
- **결과**: JSONB 페이로드를 통해 소수점 점수와 배열 구조가 100% 손실 없이 보존됨을 확인.

### P05-03: Google Drive 백업 확장 메타데이터 및 변조 거부
- **검증 내용**: `schemaVersion: 2`, `applicationVersion: '0.1.0'`, `accountScope`, `recordCounts`, `contentHash` 생성 및 텍스트 1글자 위변조 시 거부 검증.
- **결과**: 내용 변조 시 `백업 파일 무결성 검증 실패`, 미지원 버전(`schemaVersion: 999`) 시 `지원하지 않는 백업 스키마 버전` 에러를 반환하며 안전하게 파싱 거부.

### P05-04: localStorage 용량 초과(`QuotaExceededError`) 시 무중단 격리 및 삭제 묘비
- **검증 내용**: 스토리지 용량 초과 예외 주입 시 애플리케이션 크래시 방지 및 삭제 묘비(`deleted_material_ids_v1`) 동작 확인.
- **결과**: `safeSetItem`이 예외 없이 안전하게 catch하고, 삭제된 자료는 서버 구형 스냅샷 수신 시에도 부활하지 않고 안전하게 배제됨을 확인.

### P05-05: AI 토큰 사용량 계측, 모델별 비용 계산(USD/KRW) 및 운영자 집계
- **검증 내용**: `deepseek-v4.1-flash`($0.14/$0.28), `gpt-4o-mini`($0.15/$0.60) 정밀 원가 계산, 한글/영문 토큰 수 추정기, 텔레메트리 링버퍼 및 `GET /api/admin/ai-metrics` 요약 집계.
- **결과**: 1M 입력+1M 출력에 대해 $0.42(588원), $0.75(1,050원) 정확 산출, 비정상 사용량(Anomaly > 100건 또는 >500k 토큰) 플래그 정상 감지.

### P05-06: 크레딧 계층 정책 (게스트 1회, 일반 3회), 비상 차단 및 입력 상한
- **검증 내용**: 개인 API 키 사용 시 운영자 크레딧 차감 0회 보장, 크레딧 소진 시 추가 호출 차단, 비상 차단 스위치(`isAiServiceSuspended`), 초대형 입력(PDF 30MB, 100페이지 초과) 거부.
- **결과**: `creditSource: 'personal_key'` 설정 시 크레딧 0회 소모, 상한 초과 입력 즉시 차단 확인.

### P05-07: 로컬 망각곡선 및 학습 스케줄러의 무과금 연산 보장
- **검증 내용**: 1일, 7일, 30일 간격의 기억 유지율 감쇠 계산 및 일일 가용시간 준수 스케줄 생성이 외부 AI 호출 없이 순수 로컬 알고리즘으로 완료되는지 확인.
- **결과**: `aiCallCount === 0` 불변 조건 충족 (운영 비용 0원).

### P05-08: AI 호출 장애 시 크레딧 환급 및 복원 도중 계정 전환 격리
- **검증 내용**: AI 응답 실패(502 Gateway Error) 시 선점된 임대 토큰이 `released`로 환급되는지 확인, 백업 복원 도중 사용자 계정이 전환될 때 쓰기 작업이 즉시 중단되는지 검증.
- **결과**: 실패 시 크레딧 100% 보존, 교차 계정 쓰기 0건(완전 격리) 확인.

---

## 3. 한계 및 미검증 항목 (Limitations & Edge Conditions)

1. **실제 Google OAuth 리프레시 토큰 만료**:
   - 단위 테스트는 AES-256-GCM 암호화/복호화 및 토큰 교환 프로토콜을 모의(Mock) 검증하였으며, Google 클라우드 콘솔의 실제 프로덕션 Client ID 및 비밀번호는 배포 환경에서 운영자가 설정해야 함.
2. **학교 BAZE Gateway의 실시간 네트워크 가용성**:
   - 캠퍼스 인트라넷 환경 또는 게이트웨이 점검 시 발생하는 일시적 접속 지연은 타임아웃(40초) 및 환급 로직으로 방어하였으나, 물리적 서버 다운 시 로컬 오프라인 모드로 자동 안내됨.
3. **단일 브라우저 내 100개 이상의 다중 탭 동시 동기화**:
   - 일반적인 1~3개 탭 환경에서는 `sessionStorage` 탭 식별자와 `storageScope` 이벤트 리스너로 충돌 없이 동작하나, 극단적인 대량 동시 탭 쓰기는 브라우저 스토리지 락 경합이 발생할 수 있음.
