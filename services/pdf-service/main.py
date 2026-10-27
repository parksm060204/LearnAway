#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PDF Conversion Microservice
Independent FastAPI Service using PyMuPDF4LLM
Hardened with isolated subprocess worker execution, process kill on timeout,
default-deny authentication, and SSRF domain protection.
"""

import os
import sys
import time
import ssl
import asyncio
import tempfile
import multiprocessing as mp
from typing import Optional, Dict, Any
import urllib.parse
from urllib.parse import urlparse
import urllib.request
import urllib.error
import uvicorn
from fastapi import FastAPI, File, UploadFile, Header, HTTPException, status, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from converter import convert_pdf_stream, run_worker_conversion, MAX_PAGES_DEFAULT
from security import verify_service_token, verify_job_token, get_service_token

app = FastAPI(
    title="LearnAway PDF Conversion Service",
    description="Dedicated microservice for converting academic lecture PDFs to structured Markdown",
    version="1.1.0",
)

MAX_FILE_BYTES = int(os.getenv("MAX_PDF_BYTES", 20 * 1024 * 1024))  # 20MB
MAX_CONCURRENT_TASKS = int(os.getenv("MAX_CONCURRENT_CONVERSIONS", 3))
CONVERSION_TIMEOUT_SECONDS = int(os.getenv("CONVERSION_TIMEOUT_SECONDS", 60))
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", 3))
DOWNLOAD_TIMEOUT_SECONDS = float(os.getenv("DOWNLOAD_TIMEOUT_SECONDS", 30.0))
DOWNLOAD_QUEUE_TIMEOUT_SECONDS = float(os.getenv("DOWNLOAD_QUEUE_TIMEOUT_SECONDS", 10.0))

# Concurrency semaphore to protect CPU/memory on container instances
concurrency_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
download_semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
active_downloads_count = 0
active_downloads_lock = asyncio.Lock()


def get_active_download_count() -> int:
    global active_downloads_count
    return active_downloads_count


class StorageConvertRequest(BaseModel):
    signedUrl: str
    jobId: Optional[str] = None
    userId: Optional[str] = None
    fileSize: Optional[int] = None
    storagePath: Optional[str] = None


def check_engine_ready() -> bool:
    try:
        import pymupdf  # noqa: F401
        import pymupdf4llm  # noqa: F401
        return True
    except Exception:
        return False


@app.get("/health")
async def health_check():
    """
    Public health check endpoint.
    Strictly omits any tokens, credentials, or internal directory paths.
    Accurately reports whether conversion engine and authentication are configured.
    """
    engine_ready = check_engine_ready()
    configured = bool(get_service_token())
    ready = engine_ready and configured
    return {
        "status": "ready" if ready else "not_configured" if not configured else "engine_missing",
        "ready": ready,
        "available": ready,
        "engine": "pymupdf4llm" if engine_ready else "unavailable",
        "configured": configured,
        "version": "1.1.0",
        "maxPages": MAX_PAGES_DEFAULT,
        "maxBytes": MAX_FILE_BYTES,
        "activeDownloads": active_downloads_count,
        "maxConcurrentDownloads": MAX_CONCURRENT_DOWNLOADS,
    }


def authenticate_request(
    x_service_token: Optional[str],
    x_job_token: Optional[str],
    expected_user_id: Optional[str] = None,
    expected_job_id: Optional[str] = None,
    expected_storage_path: Optional[str] = None,
) -> bool:
    """
    Verifies service token or signed job token.
    Default-deny: Rejects if no secret is configured or if tokens are invalid.
    If job token is provided, binds to userId, jobId, and storagePath.
    """
    if not get_service_token():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PDF 변환 서비스 인증이 구성되지 않았습니다 (PDF_CONVERT_SERVICE_TOKEN 누락).",
        )

    if x_service_token and verify_service_token(x_service_token):
        if x_job_token:
            payload = verify_job_token(
                x_job_token,
                expected_user_id=expected_user_id,
                expected_job_id=expected_job_id,
                expected_storage_path=expected_storage_path,
            )
            if not payload:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="작업 인증 토큰이 변조되었거나 요청 작업/사용자와 일치하지 않습니다.",
                )
        return True

    if x_job_token:
        payload = verify_job_token(
            x_job_token,
            expected_user_id=expected_user_id,
            expected_job_id=expected_job_id,
            expected_storage_path=expected_storage_path,
        )
        if payload:
            return True
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="작업 인증 토큰이 유효하지 않거나 만료되었습니다.",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="유효한 서비스 인증 토큰(X-Service-Token 또는 X-Job-Token)이 필요합니다.",
    )


def validate_storage_url(signed_url: str) -> None:
    """
    Validates that the storage URL is an authorized HTTPS Supabase Storage endpoint.
    Strictly forbids private IP addresses, localhost, and non-HTTPS schemes.
    """
    if os.getenv("ALLOW_INSECURE_STORAGE_URL_FOR_TESTS") == "true":
        return

    parsed = urlparse(signed_url)
    if parsed.scheme != "https":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="안전한 HTTPS 스토리지 URL만 허용됩니다.",
        )

    host = parsed.netloc.split(":")[0].lower()
    forbidden_hosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0"]
    if host in forbidden_hosts or host.startswith("10.") or host.startswith("192.168.") or host.startswith("172."):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="사설망 또는 로컬 주소로는 접근할 수 없습니다.",
        )

    allowed_domains = ["supabase.co", "supabase.in"]
    if not any(host.endswith("." + d) or host == d for d in allowed_domains):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="승인되지 않은 외부 스토리지 도메인입니다.",
        )

    if not parsed.path.startswith("/storage/v1/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="스토리지 API 경로가 올바르지 않습니다.",
        )


async def _async_http_download(
    url: str,
    max_bytes: int = MAX_FILE_BYTES,
    max_redirects: int = 5,
) -> bytes:
    """
    Asynchronously streams HTTP/HTTPS storage downloads without background thread pools.
    Supports native cancellation on timeout, chunked encoding, redirect verification,
    and strict max byte enforcement.
    """
    current_url = url
    for _ in range(max_redirects + 1):
        validate_storage_url(current_url)
        parsed = urlparse(current_url)
        is_ssl = (parsed.scheme == "https")
        port = parsed.port or (443 if is_ssl else 80)
        host = parsed.hostname
        if not host:
            raise ValueError(f"Invalid host in storage URL: {current_url}")

        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        ssl_ctx = ssl.create_default_context() if is_ssl else None

        reader, writer = await asyncio.open_connection(
            host, port, ssl=ssl_ctx, server_hostname=host if is_ssl else None
        )
        try:
            req_lines = [
                f"GET {path} HTTP/1.1",
                f"Host: {parsed.netloc}",
                "User-Agent: LearnAway-PdfWorker/1.0",
                "Connection: close",
                "",
                "",
            ]
            writer.write("\r\n".join(req_lines).encode("latin-1"))
            await writer.drain()

            status_line = await reader.readline()
            if not status_line:
                raise ValueError("스토리지 서버로부터 빈 응답을 받았습니다.")
            parts = status_line.decode("latin-1").strip().split(None, 2)
            if len(parts) < 2:
                raise ValueError(f"잘못된 HTTP 상태 라인: {status_line}")
            status_code = int(parts[1])

            headers: Dict[str, str] = {}
            while True:
                line = await reader.readline()
                if not line or line in (b"\r\n", b"\n"):
                    break
                header_str = line.decode("latin-1").strip()
                if ":" in header_str:
                    k, v = header_str.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            if status_code in (301, 302, 303, 307, 308):
                location = headers.get("location")
                if not location:
                    raise ValueError("리다이렉트 응답에 Location 헤더가 없습니다.")
                current_url = urllib.parse.urljoin(current_url, location)
                continue

            if status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"스토리지 서버 응답 오류 (HTTP {status_code}).",
                )

            is_chunked = (headers.get("transfer-encoding", "").lower() == "chunked")
            cl_header = headers.get("content-length")
            if cl_header and cl_header.isdigit() and int(cl_header) > max_bytes:
                raise ValueError("SIZE_EXCEEDED")

            body_chunks = []
            total_read = 0

            if is_chunked:
                received_terminal_chunk = False
                while True:
                    try:
                        line = await reader.readline()
                    except asyncio.IncompleteReadError:
                        raise ValueError("청크 전송 인코딩 헤더 수신 중 연결이 종료되었습니다.")
                    if not line:
                        break
                    chunk_len_str = line.decode("latin-1").strip().split(";")[0].strip()
                    if not chunk_len_str:
                        continue
                    try:
                        chunk_len = int(chunk_len_str, 16)
                    except ValueError:
                        raise ValueError(f"잘못된 청크 크기 헤더: {chunk_len_str}")
                    if chunk_len < 0:
                        raise ValueError(f"음수 청크 크기는 허용되지 않습니다: {chunk_len}")
                    if chunk_len > (max_bytes - total_read):
                        raise ValueError("SIZE_EXCEEDED")
                    if chunk_len == 0:
                        while True:
                            try:
                                trailer = await reader.readline()
                            except asyncio.IncompleteReadError:
                                break
                            if not trailer or trailer in (b"\r\n", b"\n"):
                                break
                        received_terminal_chunk = True
                        break

                    bytes_left = chunk_len
                    while bytes_left > 0:
                        slice_size = min(bytes_left, 64 * 1024)
                        try:
                            slice_data = await reader.readexactly(slice_size)
                        except asyncio.IncompleteReadError:
                            raise ValueError("청크 데이터 수신 중 예기치 않게 연결이 종료되었습니다.")
                        body_chunks.append(slice_data)
                        total_read += len(slice_data)
                        bytes_left -= len(slice_data)

                    try:
                        crlf = await reader.readexactly(2)
                    except asyncio.IncompleteReadError:
                        raise ValueError("청크 종료 구분자(CRLF) 수신 중 연결이 종료되었습니다.")
                    if crlf != b"\r\n":
                        raise ValueError(f"잘못된 청크 구분자: {crlf!r}")

                if not received_terminal_chunk:
                    raise ValueError("청크 전송 인코딩 스트림이 비정상 종료되었습니다 (종료 청크 누락).")
            else:
                cl = int(cl_header) if cl_header and cl_header.isdigit() else None
                while True:
                    to_read = min(64 * 1024, max_bytes - total_read + 1)
                    try:
                        data = await reader.read(to_read)
                    except (ConnectionResetError, BrokenPipeError):
                        raise ValueError("스토리지 본문 수신 중 연결이 끊어졌습니다.")
                    if not data:
                        break
                    total_read += len(data)
                    if total_read > max_bytes:
                        raise ValueError("SIZE_EXCEEDED")
                    body_chunks.append(data)
                    if cl is not None and total_read >= cl:
                        break

                if cl is not None and total_read < cl:
                    raise ValueError(f"스토리지 응답 본문이 Content-Length보다 일찍 종료되었습니다 (수신: {total_read}바이트, 예상: {cl}바이트).")

            return b"".join(body_chunks)
        finally:
            try:
                writer.close()
            except Exception:
                pass


async def download_storage_file_async(signed_url: str) -> bytes:
    """
    Asynchronously streams storage file downloads natively in the event loop with:
    - Bounded concurrency queue (429 on saturation)
    - Total execution timeout (504 on timeout)
    - Max size limits (413 on exceed)
    - Immediate native cancellation and socket closure on abort/timeout/cancel
    - Preserved SSRF domain and redirect validation
    - Real-time active download counter tracking
    """
    try:
        async with asyncio.timeout(DOWNLOAD_QUEUE_TIMEOUT_SECONDS):
            await download_semaphore.acquire()
    except (TimeoutError, asyncio.TimeoutError):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="다운로드 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.",
        )

    global active_downloads_count
    async with active_downloads_lock:
        active_downloads_count += 1

    try:
        async with asyncio.timeout(DOWNLOAD_TIMEOUT_SECONDS):
            content = await _async_http_download(signed_url)
            return content
    except (TimeoutError, asyncio.TimeoutError):
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"스토리지 원본 다운로드 시간 초과({int(DOWNLOAD_TIMEOUT_SECONDS)}초).",
        )
    except asyncio.CancelledError:
        raise
    except ValueError as ve:
        if str(ve) == "SIZE_EXCEEDED":
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"스토리지 파일이 크기 제한({MAX_FILE_BYTES // (1024 * 1024)}MB)을 초과했습니다.",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(ve),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"스토리지 원본 다운로드 실패: {str(e)}",
        )
    finally:
        try:
            async with active_downloads_lock:
                active_downloads_count = max(0, active_downloads_count - 1)
        finally:
            download_semaphore.release()



async def execute_conversion_with_killable_process(
    pdf_bytes: bytes,
    max_pages: int,
    timeout_seconds: float,
) -> Dict[str, Any]:
    """
    Executes PDF conversion in an isolated, killable subprocess.
    If timeout occurs, terminates the worker process and confirms process exit
    BEFORE releasing the concurrency slot back to the semaphore.
    """
    # 1. Bounded queue wait timeout (15s) to prevent unbounded memory queuing
    try:
        async with asyncio.timeout(15.0):
            await concurrency_semaphore.acquire()
    except (TimeoutError, asyncio.TimeoutError):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="변환 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.",
        )

    temp_path = None
    proc = None
    res_queue = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(pdf_bytes)
            temp_path = tmp.name

        ctx = mp.get_context("spawn")
        res_queue = ctx.Queue()
        proc = ctx.Process(
            target=run_worker_conversion,
            args=(temp_path, max_pages, res_queue),
        )
        proc.start()

        start_time = time.time()
        result = None
        while time.time() - start_time < timeout_seconds:
            if not res_queue.empty():
                result = res_queue.get_nowait()
                break
            if not proc.is_alive():
                if not res_queue.empty():
                    result = res_queue.get_nowait()
                break
            await asyncio.sleep(0.1)

        if result is None and (time.time() - start_time >= timeout_seconds):
            raise TimeoutError("Conversion timeout exceeded")

        if result is None:
            raise RuntimeError(f"변환 작업자 프로세스가 비정상 종료되었습니다 (exitcode: {proc.exitcode}).")

        return result
    except (TimeoutError, asyncio.TimeoutError):
        if proc and proc.is_alive():
            proc.terminate()
            proc.join(timeout=2.0)
            if proc.is_alive():
                proc.kill()
                proc.join(timeout=1.0)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"PDF 변환 처리 시간이 제한({timeout_seconds}초)을 초과했습니다.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        if proc and proc.is_alive():
            proc.terminate()
            proc.join(timeout=2.0)
            if proc.is_alive():
                proc.kill()
                proc.join(timeout=1.0)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"변환 처리 중 오류: {str(exc)}",
        )
    finally:
        if proc and proc.is_alive():
            proc.kill()
            proc.join(timeout=1.0)
        if res_queue is not None:
            try:
                res_queue.close()
                res_queue.join_thread()
            except Exception:
                pass
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass
        concurrency_semaphore.release()


@app.post("/convert")
async def convert_direct_file(
    file: UploadFile = File(...),
    x_service_token: Optional[str] = Header(None, alias="X-Service-Token"),
    x_job_token: Optional[str] = Header(None, alias="X-Job-Token"),
):
    """
    Converts directly uploaded PDF multipart file stream into Markdown.
    Used for files up to 20MB. Reads in bounded chunks.
    """
    authenticate_request(x_service_token, x_job_token)

    content_chunks = []
    total_read = 0
    CHUNK_SIZE = 64 * 1024
    try:
        while True:
            chunk = await file.read(CHUNK_SIZE)
            if not chunk:
                break
            total_read += len(chunk)
            if total_read > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"PDF 파일 크기가 허용 범위({MAX_FILE_BYTES // (1024 * 1024)}MB)를 초과했습니다.",
                )
            content_chunks.append(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"파일 스트림을 읽지 못했습니다: {str(e)}",
        )

    content = b"".join(content_chunks)

    result = await execute_conversion_with_killable_process(
        content,
        MAX_PAGES_DEFAULT,
        CONVERSION_TIMEOUT_SECONDS,
    )

    if not result.get("success"):
        code = result.get("code") or result.get("errorCode")
        status_code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if code in ("PDF_PAGE_LIMIT", "OUTPUT_TOO_LARGE")
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
    Validates token claims, SSRF boundaries, and executes in killable worker.
    """
    authenticate_request(
        x_service_token,
        x_job_token,
        expected_user_id=req.userId,
        expected_job_id=req.jobId,
        expected_storage_path=req.storagePath,
    )

    validate_storage_url(req.signedUrl)

    content = await download_storage_file_async(req.signedUrl)

    result = await execute_conversion_with_killable_process(
        content,
        MAX_PAGES_DEFAULT,
        CONVERSION_TIMEOUT_SECONDS,
    )

    if not result.get("success"):
        code = result.get("code") or result.get("errorCode")
        status_code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if code in ("PDF_PAGE_LIMIT", "OUTPUT_TOO_LARGE")
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        return JSONResponse(status_code=status_code, content=result)

    return result


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
