# LearnAway 실사용 완성 진행 기록 (docs/production-progress.md)

- 기록 갱신 일시: 2026-10-16 (한국시간)
- 대상 저장소: `parksm060204/LearnAway` (작업 경로: `C:\Users\abcde\Desktop\study-tool`)
- 리뷰 기준 커밋 SHA: `cf116bcd6466e24c2864839f53776d39c3637401`
- 현재 작업 기준 HEAD SHA: `cf116bcd6466e24c2864839f53776d39c3637401`
- 자동화 검사 실행 결과:
  - `npm run test:regressions`: **292 passed** (기존 286건 + 6대 REDCALL 핵심 결함 회귀 검증 6건 포함, 0 failed)
  - `npm run test:suite`: **287 passed** (0 failed)
  - `npx tsc --noEmit`: **0 errors** (타입 검사 완전 통과)
  - `npm run lint`: **0 errors, 0 warnings** (Next.js / ESLint 검사 통과)
  - `npm run build`: **Compiled successfully** (Turbopack 프로덕션 빌드 완료, 정적 및 동적 라우트 최적화)

---

## 1. 6대 핵심 문제별 원인·수정 및 검증 상태

본 문서는 테스트 통과만으로 실제 배포 환경에서의 완전 무결성을 단정하지 않으며, 아래 4개 범주로 엄격히 구분하여 기록합니다:
1. **구현 완료**: 필요한 기능 코드와 마이그레이션이 작성됨
2. **로컬/Mock 검증 완료**: 실제 라우트 핸들러, 독립 DB 모의 트랜잭션, 회귀 테스트 스위트를 통과함
3. **실제 환경 검증 완료**: 실제 운영 Supabase DB 배포, 실제 학교 BAZE Gateway, 실제 브라우저 환경에서 검증됨
4. **부분 구현 또는 미검증**: 외부 인프라 배포 및 운영 크리덴셜 설정이 필요한 항목

| 번호 | 항목 | 문제 원인 | 구현 및 수정 내용 | 검증 수준 |
|---|---|---|---|---|
| **1** | **retry_save에서 클라이언트 초안 신뢰 문제** | `retry_save` 요청의 클라이언트 `drafts`를 검증 없이 DB에 전달하고, DB가 `already_completed`를 반환해도 DB 결과를 재조회하지 않고 클라이언트 변조본을 `recordAuthoritativeChunkResult`에 전달함. | - `already_completed` 발생 시 DB에 확정된 청크 결과만 강제 채택, 클라이언트 전달 drafts 전면 무시<br>- DB 미완료 청크 저장 시 서버가 발급한 HMAC-SHA256 기반 서명 토큰(`signedRecoveryToken`) 필수 검증 (사용자, 작업, 청크, 본문 해시, 모델, drafts 해시, 만료 시각 결합)<br>- 변조·타 계정 재사용·만료 토큰은 403 Forbidden 차단<br>- 마이그레이션 17: `commit_analysis_chunk_result`에서 완료 청크 재진입 시 DB의 권한 있는 drafts 반환 | **로컬 Route Handler Mock AI·DB 검증 완료**<br>*(운영 DB 마이그레이션 17 적용 대기)* |
| **2** | **저장 실패인데 "저장 완료" 표시 문제** | API가 `{ success: true, persisted: false }`를 반환할 때 화면이 실패 상태를 지우고 "안전하게 저장되었습니다"를 오표시함. | - 체크포인트 커밋(`checkpointCommitted`)과 `concept_drafts` 테이블 영속화(`persisted`)를 별도 단계로 구분<br>- 부분 실패 시 `{ success: false, checkpointCommitted: true, persisted: false }` 반환<br>- `DashboardClient`에서 전체 완료가 검증될 때만 복구 데이터 정리 및 완료 토스트 표시<br>- `ConceptReviewModal`에 부분 실패 단계 안내 및 "결과 JSON 백업" / "초안 저장 재시도" UI 유지 | **컴포넌트 및 Route Handler 회귀 검증 완료** |
| **3** | **서버 재시작·새로고침 후 진행 상태 복원** | `syncFromSupabase`가 DB의 `processing` 및 `running` 상태를 메모리에 반영하지 않아 새 서버에서 `pending`으로 초기화되고, 화면은 단 1회만 조회함. | - `syncFromSupabase`에서 DB `processing`, `running`(선점 만료 검사 포함), `failed`, `completed` 상태를 완전 복원<br>- `action === 'status'` 응답에 `runningChunks` 포함, AI 호출 유발 완전 차단<br>- `DashboardClient`에서 모달 오픈 시 DB 상태 조회 및 `processing` 중 2.5초 간격 폴링 갱신, 모달 종료/자료 전환 시 타이머 정리<br>- 완료 작업은 AI 재호출 없이 기존 결과 즉시 복원 | **독립 실행 환경 및 Route Handler 회귀 검증 완료** |
| **4** | **코딩 과목 저장 재시도의 작업 정보 누락** | `retry_save` 요청에 `domain`이 누락되어 `computer_science` 작업이 기본값 `math_stats`로 해석되어 정체성 검증에 실패하고, IndexedDB만 존재하는 본문 재시도 시 빈 본문으로 전송될 위험 존재. | - DB 작업 레코드 및 메모리 원장에서 최초 작업의 `domain`, `subjectId`, `materialId`, `markdown_hash`, `model_id`, `prompt_version`을 복원하여 사용<br>- 본문 해시 불일치 시 400 `MARKDOWN_HASH_MISMATCH` 명시 거부 (기존 작업 오염 방지)<br>- 저장 재시도 및 상태 조회 시 불필요한 전체 원문 재전송 제거 | **코딩 도메인 보존 및 해시 검증 통과** |
| **5** | **모의시험 평가 답안을 서버 제출본으로 고정** | 모의시험 평가 시 문제·정답·루브릭은 동결 스냅샷을 사용하면서, 정작 채점 대상 답안은 클라이언트 요청 `userAnswer`를 그대로 신뢰함. | - 서버 `examPayload.answers[problemId]`에 확정된 공식 제출 답안만 강제 채점<br>- 클라이언트 답안 변조 또는 불일치 시 400 에러로 즉시 거부<br>- 방법 선택 이유(`reasons`), 해당 없음(`isReasonNotApplicable`), 사유(`reasonNotApplicableJustification`)도 서버 기록 바인딩<br>- 이미 완료된 평가는 `examPayload.evaluations[problemId]` 캐시를 반환하여 유료 AI 재호출 완전 차단 | **Route Handler 제출본 고정 및 변조 거부 검증 완료** |
| **6** | **새로고침에도 생성 결과 복구 가능하게 보존** | 저장 실패 시 복구 정보가 React 상태에만 존재하여 새로고침 시 소실되고, DB 체크포인트가 실패한 경우 서버 상태로도 복원 불가했음. | - 계정별 격리된 IndexedDB 저장소(`lib/analysisRecovery.ts`)에 복구 레코드(`AnalysisRecoveryRecord`) 보존<br>- 저장 즉시 read-back 검증 수행, 실패 시 명시 안내<br>- 비상용 "결과 JSON 백업" 다운로드 폴백 제공으로 AI 생성 데이터 유실 방지<br>- API 키·비밀키는 복구 데이터에서 원천 배제 | **IndexedDB 격리 및 읽기 검증 스위트 통과** |

---

## 2. 변경 파일 및 신규 마이그레이션 내역

1. **신규 마이그레이션**
   - `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql`:
     - `commit_analysis_chunk_result` RPC 개선: 이미 완료된 청크 재시입 시 DB에 저장된 권한 있는 drafts를 JSONB로 반환하여 클라이언트 변조 차단
     - 원 작업자의 선점 시간이 경과했더라도 타 작업자의 경합이 없는 경우 안전하게 커밋할 수 있도록 허용하되, 비인가 작업자나 충돌 발생 시 엄격 거부

2. **암호학적 서명 및 로컬 복구 인프라**
   - `lib/recoveryToken.ts` (신규):
     - HMAC-SHA256 기반 서명 토큰 발급 (`signRecoveryToken`) 및 무결성 검증 (`verifyRecoveryToken`)
     - 사용자, 작업 ID, 자료 ID, 과목 ID, 도메인, 청크 인덱스, 본문 해시, 모델 ID, drafts 해시, 만료 시간(1시간) 결합 검증
   - `lib/analysisRecovery.ts` (신규):
     - 계정 스코프별 격리된 IndexedDB 데이터베이스 관리 (`saveAnalysisRecovery`, `loadAnalysisRecovery`, `deleteAnalysisRecovery`)
     - 저장 직후 읽기 검증(read-back verification) 수행
     - 로컬 스토리지 한도 초과 시 비상 JSON 다운로드 폴백 (`exportAnalysisRecoveryAsJson`) 제공

3. **분석 체크포인트 및 API 라우트**
   - `lib/analysisCheckpoint.ts`:
     - `getSessionProgress`에 `runningChunks` 집계 추가
     - `deduplicateConceptDrafts`에서 prerequisites 등 옵셔널 배열 병합 안전 가드 (`|| []`) 보강
   - `app/api/analyze-concepts/route.ts`:
     - `syncFromSupabase`: DB `processing`, `running`, `failed`, `completed` 상태 완전 동기화
     - DB 작업 레코드에서 `domain`, `subjectId`, `materialId`, `markdown_hash` 등 작업 정체성 복원
     - `retry_save`: DB 완료 건은 DB 데이터만 채택. DB 미완료 건은 `signedRecoveryToken` 필수 검증
     - 초안 영속 저장 실패 시 `{ success: false, checkpointCommitted: true, persisted: false }` 명확 반환
     - `action === 'status'` 응답에 `runningChunks` 포함 및 AI 미호출 보장
     - `action === 'pause'` / `'resume'`: DB `analysis_jobs.status` 테이블 컬럼 직접 갱신
   - `app/api/evaluate-answer/route.ts`:
     - `mockExamSessionId` 경로: 소유권, 제출 완료 상태(`submitted`, `graded`), 스냅샷 포함 여부 검증
     - `examPayload.answers[problemId]`와 `body.userAnswer` 대조하여 불일치 시 400 거부
     - 서버의 풀이 이유 및 해당 없음 사유 바인딩
     - `evaluations[problemId]` 캐시 확인으로 AI 재호출 차단 및 채점 결과 세션 페이로드 캐싱

4. **클라이언트 화면 컴포넌트**
   - `components/ConceptReviewModal.tsx`:
     - 부분 실패(`checkpointStatus: committed`, `draftsPersistStatus: failed`) 단계별 명시 안내 배너
     - "결과 JSON 백업" 및 비상 "JSON 내보내기" 버튼 연동
     - `onExportRecoveryJson` 이벤트 및 `saveFailedInfo` 연동
   - `app/DashboardClient.tsx`:
     - 저장 실패 시 `saveAnalysisRecovery`를 통한 IndexedDB 보존
     - `handleRetrySaveAnalysis`: 최초 작업의 `domain`, `markdownHash`, `signedRecoveryToken` 유지 전송 및 `persisted: false` 시 상태 유지
     - 모달 오픈 시 IndexedDB 복구 데이터 확인 및 백그라운드 DB `status` 조회, `processing` 시 2.5초 간격 폴링 적용

5. **회귀 검증 스위트**
   - `scripts/test-regressions.mjs`:
     - 6대 핵심 문제에 대한 엄격한 E2E/통합 회귀 테스트 6건 추가 (총 292개 통과)

---

## 3. 검증 구분 및 결과 보고

### 1) 자동화 로컬 검사 (All Passed)
- `npm run test:regressions`: **292개 검사 통과** (0 failed)
- `npm run test:suite`: **287개 검사 통과** (0 failed)
- `npx tsc --noEmit`: 컴파일 에러 0개 (TypeScript 검사 통과)
- `npm run lint`: ESLint 에러 0개, 경고 0개
- `npm run build`: Turbopack 프로덕션 빌드 성공 (16개 라우트 정상 생성)

### 2) Mock vs 로컬 DB vs 실제 환경 검증 구분

| 영역 | 로컬 / Mock 검증 상태 | 실제 환경 검증 상태 | 실환경 실행에 필요한 사전 설정 |
|---|---|---|---|
| **retry_save 변조 거부** | **통과**: 변조 초안 전송 시 403 거부, DB 완료 건은 DB 결과만 반환 확인 | **미검증 (대기)**: 운영 Supabase에 마이그레이션 17 배포 대기 | `supabase db push` (마이그레이션 17 배포) |
| **부분 실패 UI 처리** | **통과**: `persisted: false` 시 저장 완료 위장 차단 및 재시도 UI 유지 확인 | **컴포넌트 및 Route Handler 검증 완료** | - |
| **서버 재시작 후 상태 복원** | **통과**: processing/running 상태 복원, status 조회 시 AI 미호출 확인 | **독립 Route Handler 시뮬레이션 완료** | 개발 서버(`npm run dev`)에서 브라우저 수동 확인 권장 |
| **코딩 도메인 정체성 보존** | **통과**: computer_science 도메인 유지 복구 및 본문 해시 불일치 차단 확인 | **Route Handler 검증 완료** | - |
| **모의시험 제출 답안 고정** | **통과**: 제출 답안 불일치 시 400 거부, 평가 캐시 재사용 시 AI 미호출 확인 | **Route Handler 검증 완료** | 학교 게이트웨이 라이브 호출 전 API 키 등록 필요 |
| **새로고침 IndexedDB 복구** | **통과**: 계정별 격리, read-back 검증, JSON 백업 폴백 동작 확인 | **스토리지 모듈 검증 완료** | 브라우저 쿠키/스토리지 차단 설정 여부 확인 |

---

## 4. 운영 환경 설정 가이드

### 1) 마이그레이션 순차 적용
운영 Supabase 데이터베이스에 아래 순서대로 적용합니다:
1. `supabase/migrations/20260101000013_analysis_jobs.sql`
2. `supabase/migrations/20260101000014_review_notification_dispatch.sql`
3. `supabase/migrations/20260101000015_harden_notification_and_analysis_rpc.sql`
4. `supabase/migrations/20260101000016_drop_legacy_rpcs_and_enforce_ownership.sql`
5. `supabase/migrations/20260101000017_enhance_analysis_commit_and_recovery.sql` (최신 필수 패치)

### 2) 필수 환경 변수 구성
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase 프로젝트 설정 -> API -> `service_role` (secret) 키 (알림 발송 및 서버 작업 전용)
- `CRON_SECRET`: 예약 알림 스케줄러 인증용 고유 비밀 문자열
- `AI_CREDENTIAL_ENCRYPTION_KEY`: 사용자별 학교 BAZE API 키 대칭 암호화 키 (32바이트)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: 클라이언트 공개 설정
