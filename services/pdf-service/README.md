# LearnAway PDF 변환 마이크로서비스 (PyMuPDF4LLM)

대학 시험 수준의 수식·표·구조화 문서를 보존하며 PDF를 Markdown으로 정밀 변환하는 독립 Python 마이크로서비스입니다.

---

## 1. 아키텍처 및 분리 배경

### 왜 Next.js에서 Python을 spawn하지 않는가?
- **Vercel/AWS Lambda 서버리스 런타임 제약**: Vercel Node.js 런타임 환경에는 Python 인터프리터(`python3`) 및 C 컴파일러가 포함되어 있지 않습니다. 따라서 `child_process.spawn('python3')` 호출 시 `ENOENT` 또는 즉각적인 프로세스 오류가 발생합니다.
- **Vercel Python 런타임이 부적합한 이유**:
  1. **번들 크기 제한**: PyMuPDF 및 PyMuPDF4LLM은 고성능 C 라이브러리(MuPDF) 바이너리를 포함하며, 압축 해제 시 Vercel 서버리스 한도(250MB)에 근접하거나 초과합니다.
  2. **실행 시간 및 메모리 제약**: 100페이지 이상의 대학 교재/논문 변환 시 CPU 집약적 연산으로 인해 Vercel 기본 타임아웃(10초~60초)을 초과할 위험이 높습니다.
- **해결책**:
  - 기본 변환: **브라우저 로컬 PDF.js** ("이 기기에서 변환", 서버 전송 0, 100% 프라이빗).
  - 정밀 변환: **독립 컨테이너 마이크로서비스** (Google Cloud Run, AWS App Runner, Fly.io, 사내 서버 등).

---

## 2. 라이선스 및 준수 가이드

| 구성 요소 | 라이선스 | 비고 |
| :--- | :--- | :--- |
| **PDF.js (`pdfjs-dist`)** | Apache-2.0 | 브라우저 로컬 변환에 사용. 상용/비상용 자유 사용 가능 |
| **PyMuPDF (`fitz`)** | GNU AGPL v3 / 상용 | Artifex Software 소유. 오픈소스 AGPL 또는 상용 라이선스 |
| **PyMuPDF4LLM** | GNU AGPL v3 | PyMuPDF 기반 LLM Markdown 변환기 |

### AGPL-3.0 검토 사항
- PyMuPDF 및 PyMuPDF4LLM은 **GNU AGPL v3** 라이선스가 적용됩니다.
- AGPL-3.0은 네트워크를 통해 서비스를 제공하는 경우(Network-interaction copyleft)에도 해당 소프트웨어를 수정한 전체 프로그램의 소스 코드를 AGPL-3.0 조건으로 공개하도록 요구할 수 있습니다.
- 서비스를 물리적으로 별도 마이크로서비스로 분리하더라도, 네트워크 파이프라인의 통합 성격에 따라 오픈소스 공개 의무가 해석될 수 있으므로, **독점 상용 배포가 필요한 조직은 Artifex Software(artifex.com)의 상용 라이선스를 취득**해야 합니다.

---

## 3. 로컬 실행 가이드

### 1) 의존성 설치
```bash
cd services/pdf-service
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 2) 서비스 실행
```bash
# 기본 포트 8000 실행
python main.py
# 또는 uvicorn 직접 실행:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 4. Docker 컨테이너 배포

### 빌드 및 실행
```bash
docker build -t learnaway-pdf-service:latest .
docker run -p 8000:8000 -e PDF_CONVERT_SERVICE_TOKEN="your-secure-secret-token" learnaway-pdf-service:latest
```

### Google Cloud Run 배포 예시
```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/learnaway-pdf-service
gcloud run deploy learnaway-pdf-service \
  --image gcr.io/PROJECT_ID/learnaway-pdf-service \
  --platform managed \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars PDF_CONVERT_SERVICE_TOKEN="your-secret-token"
```

---

## 5. Next.js 연동 설정

Next.js 앱의 `.env.local`에 다음 환경 변수를 지정합니다:

```env
# 배포된 Python 마이크로서비스 URL (끝 슬래시 제외)
PDF_CONVERT_SERVICE_URL=http://localhost:8000

# 서비스 간 인증용 사전 공유 비밀키 (옵션, 일치 필요)
PDF_CONVERT_SERVICE_TOKEN=your-secure-secret-token
```
