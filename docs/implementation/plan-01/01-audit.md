# LearnAway — Plan 01 안정화 전수 점검 보고서 (Audit)

## 1. 개요 및 초기 상태

- **프로젝트**: LearnAway (대학 강의 자료 분석, 시험 수준 문제 생성 및 복습 도구)
- **점검 기준 커밋**: `13f35435864f7ec47e279262ec15ddd558d39e3b`
- **작업 브랜치**: `fix/plan-01-predeploy-stabilization`
- **배포 목표 인프라**: Vercel Hobby + Supabase + BAZE AI Gateway / DeepSeek V4.1 Flash

본 감사는 Vercel 배포 전 서비스의 신뢰성, 보안성, 데이터 격리, 계정별 크레딧 정책, AI 호출 비용 제어, 데이터 저장 지속성을 점검하고 실질적인 코드 수정을 검증하기 위해 수행되었습니다.

---

## 2. 확인된 결함 목록 및 심각도 분석

| ID | 결함 영역 | 심각도 | 문제 요약 |
|---|---|---|---|
| **P0-1** | 임시 파일 스토리지 정리 | **CRITICAL (P0)** | `temp_pdf_conversion_jobs`에 authenticated INSERT/UPDATE 권한 및 부실한 경로 검증으로 인한 타인 영구 자료 교차 삭제 취약점 |
| **P0-2** | 펜싱 토큰 (`lease_token`) | **CRITICAL (P0)** | `recordTrialResultReady` 실패 시에도 실제 학습 데이터(문제 초안/개념 초안/세션 평가)가 저장되는 펜싱 누수 |
| **P0-3** | 크레딧 원장 정산 원자성 | **CRITICAL (P0)** | AI 결과 캐시 영속화 실패 시에도 크레딧만 소진되어 재조회 시 결과가 유실되는 불일치 |
| **P1-1** | 구형 RPC 오버로드 및 토큰 검증 | **HIGH (P1)** | null lease token 허용 및 인자 수 다른 레거시 RPC 오버로드 잔존 |
| **P1-2** | 임시 PDF 장부 등록 및 취소 경로 | **HIGH (P1)** | 장부 insert 오류 시에도 티켓 발급, 서명 실패 시 미정리 잔존, 10분 이상 중단된 converting 영구 방치 |
| **P1-3** | 계정 유형별 AI 체험 크레딧 정책 | **HIGH (P1)** | 게스트(간편) 계정(1회)과 일반 가입 계정(3회) 차등 미적용 (일괄 1회 부여 상태), 재가입/전환 시 중복 지급 위험 |
| **P1-4** | Vercel Cron 규격 불일치 | **HIGH (P1)** | `/api/reminders/cron`이 POST만 지원하여 GET으로 호출하는 Vercel Cron 환경에서 405 Method Not Allowed 발생 |
| **P2-1** | 로컬스토리지 용량 초과 대응 | **MEDIUM (P2)** | `safeSetItem`이 QuotaExceededError 시 예외를 삼키고 반환값이 없어 호출자가 저장 실패를 감지하지 못함 |

---

## 3. 결함별 재현 절차 및 원인 분석

### P0-1: 임시 파일 정리의 교차 사용자 삭제 취약점
- **원인**:
  - `temp_pdf_conversion_jobs`에 authenticated 일반 사용자의 `INSERT`, `UPDATE` 권한이 부여되어 있었음.
  - RLS가 `user_id` 소유권만 확인하고 `storage_path`가 실제로 본인의 임시 디렉터리(`{userId}/temp-convert/{jobId}/...`)인지 검증하지 않음.
  - 일반 사용자가 `action: cleanup_expired_temp_files`를 호출하면 서버가 `storage_path`를 신뢰하여 관리자 권한(`admin.storage.from('materials').remove([storage_path])`)으로 일괄 삭제함.
- **재현 절차**:
  1. 공격자 계정으로 `temp_pdf_conversion_jobs`에 본인 `user_id`로 행을 추가하면서 `storage_path`에 희생자의 영구 자료(`victim/materials/exam.pdf`) 또는 상대경로(`../`)를 삽입.
  2. 정리 API를 호출하면 관리자 스토리지 클라이언트가 희생자의 실제 학습 자료를 영구 삭제함.

### P0-2: 펜싱 검증 실패 시 학습 데이터 영속화 차단 누락
- **원인**:
  - 라우트 핸들러(`generate-problems`, `analyze-concepts`, `evaluate-answer`)에서 `recordTrialResultReady`가 토큰 불일치(`STALE_LEASE_TOKEN`)로 거부되어도 경고 로그만 남긴 후 `persistProblemDraftsForResponse` 등을 그대로 실행함.
- **재현 절차**:
  1. 지연 실행 A가 lease 만료 후 신규 실행 B가 시작된 상황에서, A가 뒤늦게 완료 결과를 저장하려 할 때 크레딧 장부는 거부되지만 문제 초안 테이블에는 A의 결과가 저장되어 B의 학습 데이터와 충돌함.

### P0-3: 결과 보존 실패 후 크레딧만 확정되는 문제
- **원인**:
  - AI 결과 캐시 저장이 DB 일시 오류 등으로 실패했음에도 곧바로 `settleTrialCredit`를 호출하여 크레딧을 소진함.
  - 클라이언트로 전달되는 네트워크 응답이 유실되면, 크레딧은 0이 되었으나 `cached_result`가 null이라 재조회가 불가능한 데이터 소실 상태가 됨.

### P1-3: 계정 유형별 AI 체험 크레딧 차등 정책 불일치
- **원인**:
  - Migration 23에서 `get_or_create_trial_credits`가 신규 계정에 일괄 1회만 지급하도록 변경되어 일반 가입 사용자(Google OAuth, 일반 이메일)의 3회 정책이 적용되지 않음.
  - 게스트/간편 계정과 일반 계정을 구분하는 서버 로직 부재.

### P1-4: Vercel Cron 규격 불일치
- **원인**:
  - Vercel Cron은 항상 HTTP `GET` 방식으로 엔드포인트를 호출하는데, 기존 `/api/reminders/cron/route.ts`에는 `export async function POST`만 선언되어 있어 405 Method Not Allowed로 실행 실패.

---

## 4. 조치 결과 요약

모든 P0, P1, P2 결함에 대해:
1. 후속 마이그레이션(`20260101000026`, `20260101000027`) 작성으로 DB 수준 보안 강화 및 권한 격리.
2. 경로 세그먼트 엄격 검증(`validateTempStoragePath`), 오염된 장부 격리(`quarantined`), 관리자 스토리지 파일 삭제 0회 보장.
3. 펜싱 실패 시 즉시 409 반환 및 저장 중단.
4. 결과 캐시와 DB 영속화가 모두 확인된 경우에만 크레딧 정산 실행.
5. 게스트 계정 1회 vs 일반 계정 3회 차등 지급 및 전환 시 중복 지급 방지.
6. Vercel Cron용 `GET` 핸들러 지원 추가.
7. `safeSetItem` boolean 반환 및 `inMemoryStore` 안전 폴백 구현.
8. 총 361개 회귀 테스트 및 287개 도메인 테스트 전수 통과 확인.
