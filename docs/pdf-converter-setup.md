# LearnAway PDF 변환 아키텍처 및 배포·라이선스 가이드

이 문서는 LearnAway에서 대학 강의 자료(PDF)를 구조화된 Markdown으로 안정적이고 안전하게 변환하기 위한 이원화 엔진 아키텍처, 배포 설정, 대용량 파일 처리 및 라이선스 고지 사항을 설명합니다.

---

## 1. 아키텍처 개요

LearnAway는 서버리스 배포 환경의 제약(Python 런타임 부재, 4.5MB 페이로드 한도)을 극복하고, 사용자의 프라이버시와 문서 구조 정밀성을 모두 충족하기 위해 **이원화된 변환 엔진**을 제공합니다.

```
                      [ 사용자 PDF 파일 선택 ]
                                |
          +---------------------+---------------------+
          |                                           |
[ 이 기기에서 변환 (기본, 권장) ]             [ 정밀 변환 (선택) ]
   (브라우저 PDF.js 엔진)                       (독립 Python 마이크로서비스)
          |                                           |
  - 100% 브라우저 로컬 변환                    - PyMuPDF4LLM 고정밀 분석
  - 외부 서버 원본 전송 0건                   - 수학 기호, 표, 다단 레이아웃 복원
  - Vercel 페이로드 한도 무관 (20MB)           - 대용량 파일: Supabase Storage 티켓
  - 오프라인/서버 미설정 시에도 즉시 동작       - 서비스 인증 토큰(HMAC) 격리
          |                                           |
          +---------------------+---------------------+
                                |
                     [ 공통 규격 Markdown 결과 ]
                 (페이지 앵커 <!-- [PAGE X] --> 보존)
                                |
               [ 사용자 본문 검토 및 라이브 편집 ]
                                |
                    [ 로컬 IndexedDB 원본 보존 ]
                                |
              [ 대학 시험 수준 복합 개념 분석 및 문제 생성 ]
```

---

## 2. 엔진별 특성 및 기술적 한계

| 항목 | 이 기기에서 변환 (PDF.js) | 정밀 변환 (PyMuPDF4LLM) |
| :--- | :--- | :--- |
| **실행 위치** | 사용자 웹 브라우저 (클라이언트) | 독립 컨테이너 / Python 서비스 |
| **네트워크 전송** | **없음 (0 바이트)** | 파일 또는 임시 스토리지 전송 |
| **지원 크기 / 페이지**| 최대 20MB / 250페이지 | 최대 20MB / 250페이지 |
| **수식 복원** | 수학 기호(∑, ∫, √ 등) 감지 및 원문 텍스트 유지 | LaTeX 및 인라인 수식 구조화 |
| **표·행렬 복원** | 탭/열 정렬 기반 감지 (검토 권장) | Markdown Table 서식 복원 |
| **다단 레이아웃** | 좌표 기반 2단 감지 및 순차 정렬 | PyMuPDF4LLM 문서 흐름 기반 정렬 |
| **스캔 PDF (이미지)**| OCR 미지원 안내 (`PDF_NO_TEXT`) | OCR 미지원 안내 (`PDF_NO_TEXT`) |
| **서버 설정 의존성**| **없음 (즉시 사용 가능)** | `PDF_CONVERT_SERVICE_URL` 설정 필요 |

> [!NOTE]
> 스캔된 종이 강의 노트 등 텍스트 레이어가 없는 이미지 전용 PDF는 두 엔진 모두 자체 OCR을 강제로 추정하지 않으며, **"OCR 필요"** 안내를 제공하고 사용자가 외부 OCR로 생성한 `.md` 파일을 직접 연결할 수 있도록 지원합니다.

---

## 3. 대용량 PDF (4.5MB 초과) 전달 아키텍처

Vercel Serverless Function은 단일 HTTP 요청의 바디 크기를 최대 **4.5MB**로 엄격히 제한합니다. 20MB PDF를 Next.js 서버리스 API로 직접 POST할 경우 413 Payload Too Large 오류가 발생합니다.

LearnAway는 이를 다음과 같이 해결합니다:
1. **브라우저 로컬 변환 (PDF.js)**: 원본 파일이 서버를 거치지 않으므로 Vercel 제한의 영향을 전혀 받지 않습니다.
2. **정밀 변환 (PyMuPDF4LLM)**:
   - **4.5MB 이하**: Next.js API를 통해 마이크로서비스로 직접 스트리밍 프록시.
   - **4.5MB 초과 (최대 20MB)**:
     1. 브라우저가 `POST /api/convert` (`action: create_storage_ticket`)를 호출하여 격리된 임시 경로(`<auth.uid()>/temp-convert/<jobId>/<fileName>.pdf`) 티켓을 발급받음.
     2. 브라우저가 Supabase Storage(`materials` 버킷)로 직접 업로드 (Vercel 경유 없음).
     3. Next.js가 300초 유효 기간의 임시 서명 URL과 HMAC 작업 토큰을 생성하여 Python 서비스 `POST /convert/storage`로 변환을 요청.
     4. Python 서비스는 승인된 서명 URL에서만 스트리밍 다운로드하여 변환(SSRF 방지 도메인 화이트리스트 검증).
     5. 변환 완료 즉시 Supabase Storage의 임시 원본 객체는 자동으로 완전 삭제됨.

---

## 4. 독립 Python 마이크로서비스 설정 및 실행

### A. 로컬 개발 환경에서 직접 실행

```bash
# 1. 서비스 디렉터리로 이동
cd services/pdf-service

# 2. 가상환경 생성 및 활성화
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# 3. 고정 버전 의존성 설치
pip install -r requirements.txt

# 4. 서비스 실행
uvicorn main:app --host 0.0.0.0 --port 8000
```

### B. Docker 컨테이너 배포 (권장: Google Cloud Run, AWS ECS, 사설 서버)

`services/pdf-service/Dockerfile`이 이미 준비되어 있습니다:

```bash
# 1. 도커 이미지 빌드
docker build -t learnaway-pdf-service:latest services/pdf-service

# 2. 컨테이너 실행 (환경변수 설정)
docker run -d \
  -p 8000:8000 \
  -e PORT=8000 \
  -e MAX_CONCURRENT_CONVERSIONS=3 \
  -e PDF_CONVERT_SERVICE_TOKEN="your_secure_random_token" \
  --name pdf-converter \
  learnaway-pdf-service:latest
```

### C. 상태 확인 엔드포인트

```bash
curl http://localhost:8000/health
```
응답 예시:
```json
{
  "status": "ok",
  "service": "learnaway-pdf-converter",
  "engine": "pymupdf4llm",
  "version": "1.1.0",
  "maxPages": 250,
  "maxBytes": 20971520
}
```
*주의: `/health` 엔드포인트는 인증 토큰이나 내부 파일 경로를 절대 누출하지 않습니다.*

---

## 5. Next.js 연결 환경변수 설정

Next.js 앱 루트의 `.env.local`에 다음을 추가합니다:

```ini
# 정밀 변환 마이크로서비스 엔드포인트
PDF_CONVERT_SERVICE_URL=http://localhost:8000

# 서비스 간 상호 인증 토큰 (Python 서비스의 PDF_CONVERT_SERVICE_TOKEN과 일치해야 함)
PDF_CONVERT_SERVICE_TOKEN=your_secure_random_token
```

- `PDF_CONVERT_SERVICE_URL`이 설정되지 않았거나 서비스가 오프라인인 경우:
  - Next.js의 `GET /api/convert`가 `{ available: false }`를 반환합니다.
  - UI의 "정밀 변환" 버튼이 안전하게 비활성화되며, "서버 미연결" 상태가 표시됩니다.
  - **"이 기기에서 변환 (브라우저 PDF.js)" 및 Markdown 직접 등록은 100% 정상 작동을 유지합니다.**

---

## 6. 라이선스 고지 및 법적 검토 사항

LearnAway의 PDF 변환 파이프라인에 사용된 라이브러리와 서비스의 라이선스는 다음과 같습니다.

### 1) PDF.js (`pdfjs-dist`)
- **라이선스**: **Apache License 2.0**
- **적용 범위**: 브라우저 클라이언트 사이드 (`public/pdf.worker.min.mjs`, `lib/pdf/browserPdfConverter.ts`)
- **준수 사항**:
  - 상업적 이용, 수정, 배포가 자유롭습니다.
  - 저작권 고지문 및 Apache 2.0 라이선스 사본을 유지해야 합니다.

### 2) PyMuPDF & PyMuPDF4LLM
- **라이선스**: **GNU Affero General Public License v3.0 (AGPL-3.0)** 또는 Artifex Commercial License
- **적용 범위**: 독립 Python 마이크로서비스 (`services/pdf-service/`)
- **중요 법적 고지**:
  - **네트워크 카피레프트(Network Copyleft)**: AGPL-3.0 라이선스는 서비스를 네트워크를 통해 상호작용하는 사용자에게도 해당 서비스의 소스 코드를 제공할 의무를 부과합니다.
  - **서버 분리(Network Boundary)의 영향**: Next.js 웹 앱과 Python 서비스를 별도 프로세스 및 컨테이너로 분리하더라도, Python 마이크로서비스 자체를 수정하여 운영할 경우 해당 마이크로서비스의 소스 코드는 AGPL-3.0에 따라 공개되어야 합니다.
  - **상업용 배포 시 주의**: LearnAway를 비공개 상용 SaaS로 서비스하면서 소스 코드를 공개하지 않고자 하는 경우, Artifex(MuPDF 저작권사)로부터 상업용 라이선스를 취득해야 합니다.
  - LearnAway의 `services/pdf-service/`는 완전히 개방된 표준 코드로 제공되므로, 오픈 소스 운영 시 AGPL-3.0 요건을 충족합니다.

### 3) FastAPI / Uvicorn
- **FastAPI**: MIT License
- **Uvicorn**: BSD 3-Clause License
- 상업적 배포 및 컨테이너화에 제약이 없습니다.
