# 클라우드 저장(과목·자료) 적용 가이드

이번 단계에서 **과목(subjects)** 과 **자료(materials)** 를 Supabase에 저장합니다.
문제·답안·복습 이력은 아직 로컬에 남습니다.

> 이 문서는 적용 절차입니다. 이 저장소 환경에서는 실제 Supabase에 연결해
> 마이그레이션을 적용하거나 RLS/Storage를 검증하지 않았습니다.

---

## 1. 저장 범위

### Supabase에 저장 (서버가 기준 데이터)
- `public.subjects`: 과목명·과목 설정·시험 날짜/시간/장소/범위
- `public.materials`: 자료 종류·이름·처리 상태·업로드 상태·버전·콘텐츠 해시·Storage 경로
- Storage `materials` 버킷(비공개): 원본(PDF/전사본), `markdown.md`, `pages.json`, `transcript.txt`

### 아직 로컬에 남는 데이터
- 개념(concepts)·개념 초안, 문제(problems)·문제 초안, 답안(attempts), 복습 이벤트
- 모의시험, 학습 계획, 개인화 설정, 로직 강화 세션, 재도전 예약
- 위 데이터는 **다른 기기에서 동기화된다고 안내하지 않습니다.**

과목·자료의 **ID는 그대로 보존**되므로, 로컬 개념·문제·답안의 참조 관계는 유지됩니다.

---

## 2. 마이그레이션 적용

파일:
- `supabase/migrations/20260101000000_subjects_materials.sql` — 테이블·제약·RLS·트리거
- `supabase/migrations/20260101000001_materials_storage.sql` — 비공개 버킷 + Storage 정책
- `supabase/migrations/20260101000002_ids_and_pending_uploads.sql` — ID 정책(text + 사용자별 PK), pending 업로드 컬럼, `deleting` 상태

### 방법 A — Supabase CLI
```bash
supabase link --project-ref <project-ref>
supabase db push
```

### 방법 B — Dashboard SQL Editor
두 파일의 내용을 순서대로 붙여 실행합니다.

### ID 정책
- `subjects.id`, `materials.id`, `materials.subject_id`는 **text**입니다.
  - 기존 로컬 문자열 ID(`subj-…`, `mat-…`)를 그대로 보존해 개념·문제·답안 참조가 끊기지 않습니다.
  - 신규 생성은 앱에서 UUID(`crypto.randomUUID()`)로 만듭니다.
- 기본 키는 `(id, user_id)`이므로 **서로 다른 계정이 같은 이전 ID를 가질 수 있습니다.**

### 제약 요약
- `subjects.user_id` 기본값은 `auth.uid()`이며, 클라이언트는 `user_id`를 보내지 않습니다.
- `materials`는 `(subject_id, user_id)` 복합 외래키로 **다른 사용자의 과목에 연결할 수 없습니다.**
- RLS: subjects/materials 각각 SELECT·INSERT·UPDATE·DELETE 정책을 소유자 기준으로 적용.
- `upload_state`: `uploading | ready | failed | deleting` (변환 `status`와 분리).

---

## 3. Storage 버킷

- 버킷 이름: `materials` (private)
- 경로 규칙: `<auth.uid()>/<material_id>/v<version>/<file>`
  - `original.pdf` (또는 `original.txt`)
  - `transcript.txt`, `markdown.md`, `pages.json`
- Storage 정책: 첫 경로 세그먼트가 `auth.uid()`와 일치해야 읽기/쓰기/수정/삭제 가능.

원본 보기/다운로드는 앱이 `createSignedUrl(path, 300)`로 만든 **5분 유효 signed URL**을
사용합니다(비공개 버킷이므로 공개 URL이 아닙니다).

---

## 4. 자료 저장·수정·삭제 흐름 (앱 동작)

파일 업로드와 DB 저장은 하나의 트랜잭션이 아니므로 다음 순서로 처리합니다.

1. 메타데이터 행을 `upload_state='uploading'`으로 기록
2. Storage에 본문(markdown/pages/transcript)과 원본 업로드
3. 업로드한 본문을 다시 내려받아 **콘텐츠 해시로 검증**
4. 검증 성공 시 `upload_state='ready'`로 전환 (실패 시 `failed` + `upload_error`)

- **진행 중 업로드 분리**: 활성 버전과 진행 중 업로드를 `pending_*` 컬럼으로 분리합니다. 업로드가
  실패해도 활성 버전·본문·원본 PDF 경로는 그대로 유지됩니다.
- **재시도/중복 방지**: 로컬 자료 ID를 그대로 사용하고 경로가 `<id>/v<version>`로 고정됩니다.
  아직 `ready`가 아닌 pending 업로드는 같은 버전·작업 ID로 재개하며 새 버전을 만들지 않습니다.
- **수정**: pending 버전에 업로드·본문 재조회·해시 검증을 마친 뒤 `pending_job_id` 조건으로 활성
  버전을 전환합니다(늦게 도착한 이전 작업은 무시). 새 원본을 주지 않으면 기존 원본 경로를 유지합니다.
- **삭제**: Storage 목록 조회 실패는 삭제 실패로 처리하고 DB 행을 지우지 않습니다. 파일 삭제 후 DB
  삭제가 실패하면 `upload_state='deleting'`으로 남겨 재시도할 수 있게 합니다(정상 자료로 표시하지 않음).

---

## 5. 로컬 → 클라우드 이전

- **서버 캐시와 이전 원본 분리**: 첫 클라우드 로드 전에 계정별 로컬 과목·자료(메타데이터 + IndexedDB
  본문)를 `redcall_user_<id>__origin_*` 영역과 별도 IndexedDB 스코프에 스냅샷합니다. 이후 클라우드
  캐시가 일반 사용자 영역을 덮어써도 이전 원본은 보존됩니다.
- 대상: **현재 로그인 계정에 귀속된 로컬 과목·자료만**. 미귀속 공용 기록은 자동 업로드하지 않습니다.
- 사용자가 대시보드에서 "클라우드로 이전"을 명시적으로 선택해야 시작합니다.
- 작업 레코드(`redcall_user_<id>__cloud_migration_job_v1`)와 진행 상태를 기록하고,
  중단 후 재시도 시 이미 일치하는 항목은 건너뜁니다(중복 방지).
- 같은 ID에 다른 내용이 있으면 **충돌로 보고**하고 자동 덮어쓰기하지 않습니다.
- 이전 성공 후에도 **로컬 원본은 자동 삭제하지 않습니다.**

---

## 6. 검증 체크리스트 (실제 Supabase에서)

1. 새 계정으로 과목 생성 + 시험일 설정 → 새로고침 후 유지
2. PDF/전사본 등록 → `upload_state='ready'`, Storage에 `v1` 파일 생성, 원본 보기(signed URL)
3. 같은 계정 다른 브라우저에서 과목·자료 조회
4. A 사용자가 B 사용자의 행/파일에 접근 불가(RLS·Storage 정책)
5. B의 과목에 A가 자료를 연결 시도 → 외래키/RLS로 차단
6. 업로드 성공 후 DB 저장 실패 시 `failed` 표시 및 재시도
7. 자료 수정(새 버전 전환)·삭제 실패 처리
8. 로컬 이전 중단 → 재개 → 동일 ID 다른 콘텐츠 충돌 보고
9. 기존 문제 생성·풀이·복습 기능에서 과목·자료 참조 유지

`npm run test:regressions`의 클라우드 관련 검사는 **해시·매퍼·이전 계획의 순수 로직**만
검증합니다. 사용자 간 접근 차단은 실제 Supabase에서만 검증할 수 있습니다.
