#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PDF Conversion Microservice
Independent FastAPI Service using PyMuPDF4LLM
"""

import os
import asyncio
from typing import Optional
from urllib.parse import urlparse
import uvicorn
from fastapi import FastAPI, File, UploadFile, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from converter import convert_pdf_stream, MAX_PAGES_DEFAULT
from security import verify_service_token, verify_job_token

app = FastAPI(
    title="LearnAway PDF Conversion Service",
    description="Dedicated microservice for converting academic lecture PDFs to structured Markdown",
    version="1.1.0",
)

MAX_FILE_BYTES = int(os.getenv("MAX_PDF_BYTES", 20 * 1024 * 1024))  # 20MB
MAX_CONCURRENT_TASKS = int(os.getenv("MAX_CONCURRENT_CONVERSIONS", 3))
CONVERSION_TIMEOUT_SECONDS = int(os.getenv("CONVERSION_TIMEOUT_SECONDS", 60))

# Concurrency semaphore to protect CPU/memory on container instances
concurrency_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)


class StorageConvertRequest(BaseModel):
    signedUrl: str
    jobId: Optional[str] = None
    userId: Optional[str] = None
    fileSize: Optional[int] = None


@app.get("/health")
async def health_check():
    """
    Public health check endpoint.
    Strictly omits any tokens, credentials, or internal directory paths.
    """
    return {
        "status": "ok",
        "service": "learnaway-pdf-converter",
        "engine": "pymupdf4llm",
        "version": "1.1.0",
        "maxPages": MAX_PAGES_DEFAULT,
        "maxBytes": MAX_FILE_BYTES,
    }


def authenticate_request(
    x_service_token: Optional[str],
    x_job_token: Optional[str],
):
    """
    Verifies either the pre-shared service token or a signed job token.
    """
    if x_service_token and verify_service_token(x_service_token):
        return True
    if x_job_token and verify_job_token(x_job_token):
        return True
    if verify_service_token(None):
        return True  # Unsecured dev mode only when SERVICE_TOKEN is unset
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="유효한 서비스 인증 토큰(X-Service-Token 또는 X-Job-Token)이 필요합니다.",
    )


@app.post("/convert")
async def convert_direct_file(
    file: UploadFile = File(...),
    x_service_token: Optional[str] = Header(None, alias="X-Service-Token"),
    x_job_token: Optional[str] = Header(None, alias="X-Job-Token"),
):
    """
    Converts directly uploaded PDF multipart file stream into Markdown.
    Used for files up to 20MB.
    """
    authenticate_request(x_service_token, x_job_token)

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"파일 스트림을 읽지 못했습니다: {str(e)}",
        )

    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"PDF 파일 크기가 허용 범위({MAX_FILE_BYTES // (1024 * 1024)}MB)를 초과했습니다.",
        )

    try:
        async with asyncio.timeout(CONVERSION_TIMEOUT_SECONDS):
            async with concurrency_semaphore:
                # Run CPU-bound PyMuPDF4LLM in threadpool
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    None, convert_pdf_stream, content, MAX_PAGES_DEFAULT
                )
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"PDF 변환 처리 시간이 제한({CONVERSION_TIMEOUT_SECONDS}초)을 초과했습니다.",
        )

    if not result["success"]:
        code = result.get("code")
        status_code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if code == "PDF_PAGE_LIMIT"
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        return JSONResponse(status_code=status_code, content=result)

    return result


@app.post("/convert/storage")
async def convert_storage_file(
    req: StorageConvertRequest,
    x_service_token: Optional[str] = Header(None, alias="X-Service-Token"),
    x_job_token: Optional[str] = Header(None, alias="X-Job-Token"),
):
    """
    Converts a PDF from a pre-authenticated storage signed URL.
    Bypasses Vercel 4.5MB payload limits by streaming directly from storage to the worker.
    """
    authenticate_request(x_service_token, x_job_token)

    # SSRF Protection: Validate URL host
    parsed = urlparse(req.signedUrl)
    if parsed.scheme != "https":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="안전한 HTTPS 스토리지 URL만 허용됩니다.",
        )

    allowed_domains = [
        "supabase.co",
        "supabase.in",
        "127.0.0.1",
        "localhost",
    ]
    host = parsed.netloc.split(":")[0]
    if not any(host == d or host.endswith("." + d) for d in allowed_domains):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="승인되지 않은 외부 스토리지 도메인입니다.",
        )

    import urllib.request
    try:
        # Download storage content with timeout
        with urllib.request.urlopen(req.signedUrl, timeout=30) as response:
            content = response.read(MAX_FILE_BYTES + 1)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"스토리지 원본 다운로드 실패: {str(e)}",
        )

    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"스토리지 파일이 크기 제한({MAX_FILE_BYTES // (1024 * 1024)}MB)을 초과했습니다.",
        )

    try:
        async with asyncio.timeout(CONVERSION_TIMEOUT_SECONDS):
            async with concurrency_semaphore:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    None, convert_pdf_stream, content, MAX_PAGES_DEFAULT
                )
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="스토리지 PDF 변환 처리 시간이 초과되었습니다.",
        )

    if not result["success"]:
        code = result.get("code")
        status_code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if code == "PDF_PAGE_LIMIT"
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        return JSONResponse(status_code=status_code, content=result)

    return result


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
