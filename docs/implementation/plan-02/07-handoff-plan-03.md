# LearnAway — Plan 03 인계 보고서 (Handoff to Plan 03)

## 1. 인계 배경 및 현재 상태

Plan 02 단계에서는 LearnAway의 **Vercel Hobby 환경 베타 배포 준비 및 인프라·보안 안정화**를 완수했습니다:
- **작업 브랜치**: `feat/plan-02-vercel-beta`
- **테스트 통과 현황**:
  - `npm run test:regressions`: **377/377 PASS**
  - `npm run test:suite`: **287/287 PASS**
  - `npm run build`: **Next.js 16.3.6 프로덕션 빌드 성공 (Turbopack)**
  - `npm run lint`: **0 errors**
  - `npx tsc --noEmit`: **0 errors**
- **인프라 구성 완료 내역**:
  - `vercel.json`: Vercel Hobby 호환 일일 크론 구성 완료.
  - `.github/workflows/cron-scheduler.yml`: 시간별 알림 및 15분 주기 임시 파일 정리를 위한 무료 GitHub Actions 스케줄러 제공.
  - 모든 장기 실행 라우트에 `export const dynamic = 'force-dynamic';` 및 `export const maxDuration = 60;` 적용 완료.
  - 마이그레이션 28 (`20260101000028_catchup_stabilization_and_cleanup_atomicity.sql`) 작성 완료.

---

## 2. Plan 03 핵심 목표: AI 문제 품질 및 서술형·증명 평가 고도화

Plan 02에서 안정화된 인프라를 바탕으로, Plan 03에서는 **대학 수준의 AI 문제 출제 품질 및 서술형 채점 엔진의 정밀도**를 본격적으로 고도화합니다:

### 2.1. 대학 시험 수준 문제 출제 정밀화
1. **복합 논술·증명·반례 문항 생성 강화**:
   - 수학·통계학의 엄밀한 정리 증명 및 반례 제시 문항 출제 템플릿 강화.
   - 컴퓨터과학의 알고리즘 시간/공간 복잡도 증명 및 디버깅 반례 문항 구조화.
2. **KaTeX 수식 표기 일관성 보장**:
   - `$...$` 인라인 수식과 `$$...$$` 블록 수식의 렌더링 오류 방지 및 이스케이프 검증.
3. **루브릭(채점 기준표) 세분화**:
   - 각 문제마다 부분 점수 기준(배점, 핵심 키워드, 감점 요인)을 명확히 명시.

### 2.2. 서술형 답안 및 풀이 이유(Reasoning) 독립 평가
1. **정답 점수와 풀이 이유 평가의 완전 분리 (Decoupled Scoring)**:
   - Stage 8에서 구현된 '방법 선택 이유(Method Selection Diagnosis)' 엔진을 정밀화하여, 최종 계산이 맞더라도 개념적 이유가 부족한 경우와 계산 실수가 있더라도 접근법이 타당한 경우를 독립적으로 채점.
2. **환각(Hallucination) 방지 및 강의자료 근거 바인딩**:
   - 생성된 문제가 원본 강의자료의 특정 청크/페이지에 반드시 앵커링되도록 출처 검증 파이프라인 유지.
3. **모의시험(Mock Exam) 일괄 채점 최적화**:
   - 여러 문항이 포함된 모의시험의 경우, 체험 크레딧이 아닌 개인 API 키 기반으로 안정적인 일괄 채점을 수행하고 임시 초안 저장 기능 강화.

---

## 3. Plan 03 착수 전 필수 점검 체크리스트 (Pre-flight Checklist)

- [ ] **운영 Supabase DB 마이그레이션 적용**:
  - `20260101000028_catchup_stabilization_and_cleanup_atomicity.sql` 실행 여부 확인.
- [ ] **환경변수 세팅 확인**:
  - Vercel 또는 로컬 테스트 환경에 `BAZE_API_KEY`, `AI_CREDENTIAL_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 등록.
- [ ] **회귀 테스트 슈트 보존**:
  - `npm run test:regressions` (377개) 및 `npm run test:suite` (287개)의 통과 기준을 임의로 완화하거나 삭제하지 않고 신규 기능 테스트 추가.
- [ ] **Vercel 60초 타임아웃 준수**:
  - 프롬프트 엔지니어링 시 모델의 생성 시간이 40초를 초과하지 않도록 청크 크기 및 출력 토큰 상한 관리.
