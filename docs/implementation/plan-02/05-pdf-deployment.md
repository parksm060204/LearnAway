# LearnAway — PDF 변환 시스템 배포 대응 및 라이선스 보고서 (PDF Deployment)

## 1. 이원화 변환 아키텍처 (Dual-Engine Architecture)

LearnAway는 Vercel 서버리스 런타임의 제약(Python 부재, C 라이브러리 용량 한도, 60초 타임아웃)을 극복하기 위해 두 가지 독립적인 PDF 변환 경로를 유지합니다:

```
                  강의자료 PDF 등록
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
[경로 A: 브라우저 PDF.js 변환]       [경로 B: PyMuPDF4LLM 정밀 변환]
  - 기본 활성화 ("이 기기에서 변환")       - 외부 독립 컨테이너 (Docker / Cloud Run)
  - 서버 비용 0원, 100% 로컬 처리          - 고난도 다단 수식·표 추출
  - Vercel 서버리스와 완전 독립           - 서버 간 HMAC 토큰 및 서명 URL 연동
  - 스캔 이미지 OCR 미지원 명확 안내      - 미구성 시 경로 A로 안전한 자동 Fallback
```

---

## 2. 경로 A: 브라우저 PDF.js 변환 (기본 경로)

- **엔진**: `pdfjs-dist` (Apache-2.0 라이선스)
- **작동 원리**: 사용자 브라우저의 Web Worker 환경에서 PDF 바이너리를 파싱하여 페이지별 텍스트 및 구조화된 Markdown을 생성.
- **제약 및 검증**:
  - 최대 파일 크기: 20MB
  - 최대 페이지 수: 250페이지
  - **스캔 PDF 처리**: 텍스트 레이어가 없는 스캔/이미지 PDF 업로드 시 `422 (PDF_NO_TEXT)` 에러 코드와 함께 *"스캔된 이미지 전용 PDF는 OCR을 지원하지 않습니다. 텍스트가 포함된 원본 PDF를 등록해 주세요."* 안내 메시지를 명확히 출력.
- **호환성**: Chrome, Safari, Firefox, Edge, 모바일 브라우저 전원 호환.

---

## 3. 경로 B: PyMuPDF4LLM 정밀 변환 마이크로서비스

`services/pdf-service/` 디렉터리에 위치한 독립 컨테이너 마이크로서비스입니다:

### 3.1. 왜 Vercel 서버리스 내부에서 Python을 실행하지 않는가?
1. **바이너리 번들 한도**: PyMuPDF 및 C 의존 라이브러리는 압축 해제 시 Vercel 서버리스 한도(250MB)에 근접하거나 초과합니다.
2. **연산 집약성 및 타임아웃**: 200페이지 분량의 대학 전공 서적 변환은 CPU 집약적이어서 서버리스 60초 제한을 초과할 수 있습니다.
3. **격리성**: 독립 마이크로서비스(Google Cloud Run, Fly.io, 사내 서버)로 분리하여 웹 애플리케이션의 안정성을 보장합니다.

### 3.2. 보안 및 보호 조치
- **SSRF 차단 (`main.py:validate_storage_url`)**:
  - 오직 HTTPS 스킴과 승인된 Supabase Storage 도메인(`*.supabase.co`, `*.supabase.in`)의 `/storage/v1/` 경로만 접근 허용.
  - `localhost`, `127.0.0.1`, 사설망 IP(`10.*`, `172.*`, `192.168.*`)는 즉각 400 차단.
- **격리된 프로세스 실행 및 타임아웃 강제 종료 (`main.py:execute_conversion_with_killable_process`)**:
  - `multiprocessing` spawn 컨텍스트를 이용해 독립 워커 프로세스에서 변환 수행.
  - 변환 타임아웃 발생 시 즉시 프로세스를 강제 종료(kill)하여 좀비 프로세스 및 메모리 누수 방지.
- **기본 거부(Default-Deny) 토큰 인증**:
  - `PDF_CONVERT_SERVICE_TOKEN` 미설정 시 서비스가 구동되더라도 모든 변환 요청을 503 거부.
  - `job_id`, `user_id`, `storage_path`가 바인딩된 HMAC 서명 토큰 검증.

### 3.3. 무중단 Fallback 보장
- `PDF_CONVERT_SERVICE_URL`이 설정되지 않았거나 외부 서비스가 다운된 경우:
  - `GET /api/convert`는 `available: false`를 반환하고, UI는 사용자에게 *"외부 정밀 변환 서버가 준비되지 않아 브라우저 엔진(이 기기에서 변환)으로 진행합니다"*를 안내하며 정상 학습을 지속합니다 (`P02-05`).

---

## 4. 라이선스 및 배포 주의사항 (AGPL-3.0)

| 라이브러리 | 라이선스 | 비고 |
|---|---|---|
| **PDF.js** | Apache-2.0 | 자유롭게 상용 및 비상용 서비스에 내장 가능 |
| **PyMuPDF (`fitz`)** | GNU AGPL v3 / 상용 | Artifex Software 소유 |
| **PyMuPDF4LLM** | GNU AGPL v3 | AGPL v3 카피레프트 적용 |

> [!WARNING]
> PyMuPDF 및 PyMuPDF4LLM은 **GNU AGPL v3** 라이선스입니다. 네트워크를 통해 서비스를 제공하더라도 소스 코드 공개 의무가 발생할 수 있습니다. 폐쇄형 상용 서비스를 운영하는 조직은 반드시 Artifex Software(artifex.com)로부터 상용 라이선스를 취득해야 합니다.
