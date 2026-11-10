# 서비스 정책 및 운영 안내 공개 전 확정 체크리스트

본 문서는 `Learn my way` (`LearnAway / REDCALL`) 정식 공개 전에 운영자가 확정하여 `lib/serviceGuideContent.ts`의 정책 메타데이터(`SERVICE_POLICY_METADATA`) 및 각 안내 본문에 반영해야 하는 항목을 정리한 체크리스트입니다.

현재 저장소에서는 확인되지 않은 운영자 정보나 법적 분류를 임의로 추측·기재하지 않고, `SERVICE_POLICY_METADATA.status = 'draft'` (`안내 초안 · 운영 정보 확인 중`) 상태로 관리합니다.

---

## 1. 운영 주체 및 문의·권리 행사 연락처

- [ ] **운영 주체 명칭 (`operatorName`)**: 개인 운영자 성명, 프로젝트 팀명, 학내 연구실/기관명 또는 법인명 확정
- [ ] **일반 이용 문의 연락처 (`contactEmail`)**: 서비스 장애·이용 문의 수신용 공식 이메일 또는 문의 창구 확정
- [ ] **개인정보 보호 권리 행사 접수처 (`privacyRightsContact`)**: 개인정보 열람·정정·삭제·처리정지 요구를 접수하고 회신할 담당자 및 연락처 확정

## 2. 수집 항목 및 항목별 보유·이용 기간

- [ ] **Google OAuth 수집 범위 최종 확인**: Supabase Auth의 Google Provider 설정에서 실제로 저장·유지하는 메타데이터 범위와 보유기간 확정
- [ ] **간편 회원가입(`username_accounts`) 보유기간**: 아이디(`username`) 및 내부 매핑 이메일(`@id.learnaway.local`)의 탈퇴·장기 미이용 시 보유기간 확정
- [ ] **학습 데이터 보유기간**: 과목(`subjects`), 자료 메타데이터·본문·원본(`materials`), 개념(`concepts`), 문제·버전(`problems`, `problem_versions`), 풀이·초안(`study_records`, `answer_drafts`), 학습 계획(`study_plans`)의 보유기간 확정
- [ ] **보안·운영 로그 보유기간**:
  - 로그인·가입 속도 제한 기록(`auth_rate_limits`)
  - AI 체험 크레딧 예약 및 사용량 기록(`ai_trial_credits`, `ai_trial_reservations`, `ai_usage_events`)
  - 복습 알림 발송 이력(`review_notification_logs`)
  - 대용량 PDF 변환 임시 파일 작업 기록(`temp_pdf_jobs`)

## 3. 계정 탈퇴 및 서버·백업 파기 절차

- [ ] **계정 탈퇴 경로 확정**:
  - 앱 내 `설정 > 계정`에 즉시 탈퇴(Supabase Auth 계정 및 연관 사용자 데이터 일괄 삭제) 기능을 구현할지, 또는 초기 운영 단계에서 운영자 접수 후 처리할지 결정
- [ ] **서버 백업 및 스토리지 파기 주기 확정**:
  - 계정 탈퇴 또는 자료 삭제 시 활성 DB 행 삭제 외에 Supabase 자동 백업 스냅샷, 스토리지 버킷(`materials`, `temp-pdf-uploads`)에 잔존할 수 있는 데이터의 최대 파기 소요 기간 확정

## 4. 외부 사업자와의 개인정보 처리위탁·제3자 제공 관계

코드에서 확인된 외부 연동 경로별로 개인정보 보호법상 **처리위탁**, **제3자 제공**, 또는 **사용자 직접 연동** 여부를 법률 검토 후 확정해야 합니다.

| 연동 구분 | 코드상 대상 | 공개 전 확정 필요 사항 |
| :--- | :--- | :--- |
| 인증·DB·스토리지 | Supabase | 수탁사 법인명, 위탁 업무 범위, 재위탁 여부 |
| AI 분석·생성·평가 | 학교 BAZE Gateway (`factchat-cloud.mindlogic.ai`) 및 하위 모델 제공자 | 게이트웨이 운영 주체와의 관계, 하위 모델 제공자(DeepSeek, Google Gemini 등) 명칭 및 법적 지위 |
| PDF 정밀 변환 | `PDF_CONVERT_SERVICE_URL` 운영 서버 | 자체 운영 서버인지 외부 사업자 위탁인지 여부 |
| 선택적 백업 | Google Drive API | 사용자 본인의 OAuth 동의에 따른 직접 전송 구조 설명 및 Google API 서비스 사용자 데이터 정책 준수 문구 확인 |
| 선택적 알림 | `NOTIFICATION_WEBHOOK_URL` 수신 서비스 | 이메일·웹 푸시 발송 대행 사업자 명칭 및 위탁 범위 |
| 웹 호스팅 | 배포 플랫폼 (Vercel 등) | 실제 프로덕션 호스팅 사업자 및 인프라 로그 처리 범위 |

## 5. 저장·처리 국가(리전) 및 국외이전 세부사항

- [ ] **Supabase 프로젝트 리전 확인**: DB 및 Storage 버킷이 위치한 물리적 국가·도시(예: Northeast Asia `ap-northeast-2` 서울 등 또는 국외 리전) 확인
- [ ] **AI 게이트웨이 및 모델 서버 소재지 확인**: 학교 BAZE Gateway 및 연결된 언어 모델 서버의 처리 국가 확인
- [ ] **국외이전 고지 항목 작성 (해당 시)**: 이전되는 항목, 이전 국가, 이전 일시 및 방법, 이전받는 자의 명칭·연락처, 보유·이용 기간, 이전 거부 방법 및 효과 명시

## 6. 외부 AI 제공자의 입력 데이터 보관·모델 학습 이용 정책

- [ ] **학교 BAZE Gateway 로그 보관 정책**: 게이트웨이에서 요청 프롬프트·응답 본문을 보관하는지 여부와 보관 기간 확인
- [ ] **모델 학습(Training) 이용 여부**: API를 통해 전송된 강의 자료 본문·문제·답안이 외부 모델 제공자의 학습 데이터로 사용되는지(Zero Data Retention / Opt-out 적용 여부) 확인

## 7. 공식 시행일·문서 버전 및 약관 동의 설계

- [ ] **공식 시행일(`effectiveDate`) 및 버전(`documentVersion`) 확정**: 실제 공개 일정에 맞춘 시행일(YYYY-MM-DD)과 문서 버전 부여
- [ ] **열람과 동의의 분리 원칙 유지 및 동의 절차 설계**:
  - 현재 로그인 화면의 `서비스 안내` 모달은 정보 열람용이며, 모달 열기·닫기나 로그인 버튼 클릭만으로 포괄적 약관·개인정보 동의를 간주하지 않음
  - 정식 운영 시 신규 가입 단계에서 필수/선택 동의 체크박스와 서버 동의 이력(`consented_at`, 약관 버전 기록) 저장이 필요한지 확정

---

## 코드 반영 위치 안내

운영 정보가 모두 확정되면 `lib/serviceGuideContent.ts`의 `SERVICE_POLICY_METADATA`를 다음과 같이 갱신합니다.

1. `operatorName`, `contactEmail`, `privacyRightsContact`, `effectiveDate`, `documentVersion`, `hostingProviderAndRegion`에 확정된 실제 값을 입력합니다.
2. 각 확인 완료 플래그(`retentionScheduleConfirmed`, `accountDeletionWorkflowConfirmed`, `externalLegalClassificationConfirmed`, `aiTrainingPolicyConfirmed`)를 `true`로 전환합니다.
3. 모든 필수 항목이 반영된 후 `status`를 `'published'`로 변경합니다.

