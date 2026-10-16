# Google Drive 백업 외부 설정 가이드

이 문서는 LearnAway에서 Google Drive 백업 기능을 활성화하기 위해
**개발자 및 운영자가 Google Cloud Console에서 구성해야 하는 항목**을 설명합니다.

> **보안 주의사항**
> - `GOOGLE_DRIVE_CLIENT_SECRET`은 서버 전용 비밀키입니다. 브라우저 코드나 공개 저장소에 절대 노출하지 마세요.
> - `NEXT_PUBLIC_` 접두사를 붙이지 마세요.

---

## 1. 사전 준비 (Google Cloud Console)

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속하여 로그인합니다.
2. 새 프로젝트를 생성하거나 기존 LearnAway 프로젝트를 선택합니다.
3. **API 및 서비스 > 라이브러리**로 이동합니다.
4. **Google Drive API**를 검색하고 **사용(Enable)** 버튼을 클릭합니다.

---

## 2. OAuth 동의 화면 구성

1. **API 및 서비스 > OAuth 동의 화면**으로 이동합니다.
2. User Type을 선택합니다:
   - **외부(External)**: 일반 Google 계정 사용자를 위해 선택합니다.
3. 앱 정보를 입력합니다:
   - **앱 이름**: LearnAway
   - **사용자 지원 이메일**: 관리자 이메일
   - **개발자 연락처 정보**: 관리자 이메일
4. **범위(Scopes) 추가**:
   - `https://www.googleapis.com/auth/drive.file` (앱에서 생성하거나 연 파일/폴더만 관리하는 최소 권한)
   - `https://www.googleapis.com/auth/userinfo.email` (연결된 계정의 이메일을 UI에 표시하기 위한 권한)
   > **중요**: 전체 Drive에 접근하는 `drive` 또는 `drive.readonly` 범위는 절대 요청하지 않습니다.
5. **테스트 사용자 (게시 상태가 '테스트'인 경우)**:
   - 개발 및 테스트 단계에서는 백업을 테스트할 본인 또는 팀원의 Google 계정 이메일을 **테스트 사용자** 목록에 등록해야 로그인이 허용됩니다.
6. **프로덕션 게시 (공개 전환 조건)**:
   - `drive.file`은 민감한(Sensitive) 범위에 해당하므로, 모든 일반 사용자에게 앱을 공개하려면 Google의 앱 확인(Verification) 절차를 거치거나 사전 테스트 사용자로 등록해야 합니다.

---

## 3. OAuth 2.0 클라이언트 ID 생성

1. **API 및 서비스 > 사용자 인증 정보**로 이동합니다.
2. **사용자 인증 정보 만들기 > OAuth 클라이언트 ID**를 클릭합니다.
3. 애플리케이션 유형으로 **웹 애플리케이션(Web Application)**을 선택합니다.
4. 이름을 입력합니다 (예: `LearnAway Web Client`).
5. **승인된 자바스크립트 원본 (Authorized JavaScript origins)**:
   - 로컬 개발: `http://localhost:3000`
   - 운영 서버: `https://your-domain.com`
6. **승인된 리디렉션 URI (Authorized redirect URIs)**:
   - 로컬 개발: `http://localhost:3000/api/drive/callback`
   - 운영 서버: `https://your-domain.com/api/drive/callback`
7. **만들기**를 클릭하고 발급된 **클라이언트 ID**와 **클라이언트 보안 비밀번호(Client Secret)**를 확인합니다.

---

## 4. 환경변수 설정

`.env.local` 파일에 아래 환경변수를 등록합니다 (`.env.example` 참조):

```bash
# Google Cloud Console에서 발급받은 OAuth 2.0 Web Client 정보
GOOGLE_DRIVE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:3000/api/drive/callback
```

> **환경변수 미설정 시 동작**
> - 위 환경변수가 비어 있거나 설정되지 않은 경우, UI에 "Google Drive API 환경변수 설정 필요" 안내가 표시되며,
> - **로컬 파일 백업("이 기기에 파일로 저장")은 아무런 제약 없이 100% 정상 이용 가능**합니다.

---

## 5. 인증 및 백업 동작 원리

```
[사용자] "Google Drive 연결" 클릭
    └─ GET /api/drive/auth (CSRF state 서명 및 쿠키 발급)
        └─ Google OAuth 동의 화면 (drive.file + userinfo.email 승인)
            └─ GET /api/drive/callback (state 검증 & code를 토큰으로 교환)
                └─ HTTP-only 암호화 세션 쿠키(learnaway_drive_session) 발급
                    └─ 설정 화면으로 복귀: "연결된 계정: email@gmail.com" 표시

[사용자] "Google Drive에 백업" 클릭
    └─ POST /api/drive/upload (백업 데이터 + 작업 고유 ID 전송)
        └─ 전용 폴더 "LearnAway Backups" 확인/생성 (비공개, appProperties 식별)
            └─ 다중 파트 업로드 및 멱등성 검증 완료 후 결과 반환
```

- **안전한 격리**: 토큰은 브라우저 `localStorage`, URL, 로그에 절대 저장되지 않으며, 서버의 안전한 암호화(AES-256-GCM) 쿠키로만 취급됩니다.
- **계정 전환 보호**: 로그인한 LearnAway 사용자 ID와 Drive 세션 소유자가 일치하지 않으면 접근이 즉시 차단됩니다.
- **연결 해제**: "해제" 버튼을 누르면 서버 세션 쿠키만 삭제되며, 사용자의 Google Drive에 저장된 기존 백업 파일은 임의로 삭제되지 않습니다.

---

## 6. 할당량 및 저장 공간 안내

- **API 호출 할당량**: Google Drive API는 기본적으로 일일 프로젝트 쿼리 한도(기본 10억 회/일, 100초당 사용자당 10,000회)가 적용됩니다. LearnAway는 사용자가 명시적으로 백업 버튼을 누를 때만 수동 업로드하므로 일반적인 사용량에서는 한도를 초과하지 않습니다.
- **사용자 저장 공간**: 백업 파일은 사용자의 개인 Google Drive 용량(기본 15GB 무료 용량 공유)을 사용합니다. 드라이브 잔여 공간이 부족할 경우 `STORAGE_FULL` 오류로 감지되어 로컬 다운로드 대안을 안내합니다.
