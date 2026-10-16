#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PyMuPDF4LLM Document Conversion Engine
"""

import hashlib
from typing import Dict, Any, List

MAX_PAGES_DEFAULT = 250
MAX_OUTPUT_BYTES = 8 * 1024 * 1024  # 8MB max output string


def convert_pdf_stream(pdf_bytes: bytes, max_pages: int = MAX_PAGES_DEFAULT) -> Dict[str, Any]:
    """
    Parses a PDF document from bytes and converts each page into structured Markdown
    using PyMuPDF4LLM, maintaining exact page boundary markers and source citations.
    """
    file_size = len(pdf_bytes)
    original_hash = hashlib.sha256(pdf_bytes).hexdigest()

    if file_size < 5 or pdf_bytes[:5] != b"%PDF-":
        return {
            "success": False,
            "engine": "pymupdf4llm",
            "engineVersion": "0.0.17",
            "hasText": False,
            "pageCount": 0,
            "code": "PDF_SIGNATURE_INVALID",
            "errorCode": "PDF_SIGNATURE_INVALID",
            "error": "파일 내용이 올바른 PDF 형식이 아닙니다 (시그니처 불일치).",
            "pages": [],
            "fullMarkdown": "",
            "markdown": "",
            "originalHash": original_hash,
            "fileSize": file_size,
        }

    try:
        import pymupdf
        import pymupdf4llm
    except ImportError:
        return {
            "success": False,
            "engine": "pymupdf4llm",
            "engineVersion": "unknown",
            "hasText": False,
            "pageCount": 0,
            "code": "DEPENDENCY_MISSING",
            "errorCode": "DEPENDENCY_MISSING",
            "error": "서버에 PyMuPDF 또는 pymupdf4llm 라이브러리가 준비되지 않았습니다.",
            "pages": [],
            "fullMarkdown": "",
            "markdown": "",
            "originalHash": original_hash,
            "fileSize": file_size,
        }

    doc = None
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)

        if doc.is_encrypted:
            return {
                "success": False,
                "engine": "pymupdf4llm",
                "engineVersion": "0.0.17",
                "hasText": False,
                "pageCount": page_count,
                "code": "PDF_ENCRYPTED",
                "errorCode": "PDF_ENCRYPTED",
                "error": "암호로 보호된 PDF 문서입니다. 암호를 해제한 후 다시 등록해 주세요.",
                "pages": [],
                "fullMarkdown": "",
                "markdown": "",
                "originalHash": original_hash,
                "fileSize": file_size,
            }

        if page_count == 0:
            return {
                "success": False,
                "engine": "pymupdf4llm",
                "engineVersion": "0.0.17",
                "hasText": False,
                "pageCount": 0,
                "code": "PDF_EMPTY",
                "errorCode": "PDF_EMPTY",
                "error": "페이지가 없는 빈 PDF 문서입니다.",
                "pages": [],
                "fullMarkdown": "",
                "markdown": "",
                "originalHash": original_hash,
                "fileSize": file_size,
            }

        if page_count > max_pages:
            return {
                "success": False,
                "engine": "pymupdf4llm",
                "engineVersion": "0.0.17",
                "hasText": False,
                "pageCount": page_count,
                "code": "PDF_PAGE_LIMIT",
                "errorCode": "PDF_PAGE_LIMIT",
                "error": f"PDF 페이지 수({page_count}쪽)가 허용 한도({max_pages}쪽)를 초과했습니다.",
                "pages": [],
                "fullMarkdown": "",
                "markdown": "",
                "originalHash": original_hash,
                "fileSize": file_size,
            }

        # Page-by-page chunks extraction
        chunks = pymupdf4llm.to_markdown(doc, page_chunks=True)
        pages: List[Dict[str, Any]] = []
        total_text_len = 0

        for i, chunk in enumerate(chunks):
            page_num = i + 1
            text = chunk.get("text", "")
            trimmed = text.strip()
            total_text_len += len(trimmed)
            pages.append({
                "pageNumber": page_num,
                "markdown": text,
                "hasText": len(trimmed) > 0,
                "rawText": trimmed,
            })

        full_markdown_parts = [
            f"<!-- [PAGE {p['pageNumber']}] -->\n" + p["markdown"] for p in pages
        ]
        full_markdown = "\n\n".join(full_markdown_parts).strip()

        if len(full_markdown.encode("utf-8")) > MAX_OUTPUT_BYTES:
            return {
                "success": False,
                "engine": "pymupdf4llm",
                "engineVersion": "0.0.17",
                "hasText": True,
                "pageCount": page_count,
                "code": "OUTPUT_TOO_LARGE",
                "errorCode": "OUTPUT_TOO_LARGE",
                "error": "변환된 Markdown 결과의 크기가 허용치(8MB)를 초과했습니다.",
                "pages": [],
                "fullMarkdown": "",
                "markdown": "",
                "originalHash": original_hash,
                "fileSize": file_size,
            }

        if total_text_len == 0:
            return {
                "success": False,
                "engine": "pymupdf4llm",
                "engineVersion": "0.0.17",
                "hasText": False,
                "pageCount": page_count,
                "code": "PDF_NO_TEXT",
                "errorCode": "PDF_NO_TEXT",
                "error": "스캔된 이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다 (OCR 미지원). 텍스트가 포함된 원본 PDF를 등록해 주세요.",
                "pages": pages,
                "fullMarkdown": "",
                "markdown": "",
                "originalHash": original_hash,
                "fileSize": file_size,
                "needsReview": True,
                "reviewReason": "텍스트 레이어가 없는 스캔/이미지 PDF",
            }

        return {
            "success": True,
            "engine": "pymupdf4llm",
            "engineVersion": "0.0.17",
            "hasText": True,
            "pageCount": page_count,
            "pages": pages,
            "fullMarkdown": full_markdown,
            "markdown": full_markdown,
            "originalHash": original_hash,
            "fileSize": file_size,
            "error": None,
        }
    except Exception as e:
        return {
            "success": False,
            "engine": "pymupdf4llm",
            "engineVersion": "0.0.17",
            "hasText": False,
            "pageCount": 0,
            "code": "PDF_PARSE_ERROR",
            "errorCode": "PDF_PARSE_ERROR",
            "error": f"PDF 파싱 중 오류가 발생했습니다: {str(e)}",
            "pages": [],
            "fullMarkdown": "",
            "markdown": "",
            "originalHash": original_hash,
            "fileSize": file_size,
        }
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


def run_worker_conversion(pdf_path: str, max_pages: int, res_queue: Any) -> None:
    """
    Subprocess entry point for converting PDF from a local file path.
    Runs in an isolated process so it can be terminated on timeout.
    Writes result dictionary to multiprocessing Queue.
    """
    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        res = convert_pdf_stream(pdf_bytes, max_pages)
        res_queue.put(res)
    except Exception as e:
        res_queue.put({
            "success": False,
            "engine": "pymupdf4llm",
            "code": "WORKER_EXCEPTION",
            "errorCode": "WORKER_EXCEPTION",
            "error": f"작업자 프로세스 실행 오류: {str(e)}",
            "pages": [],
            "fullMarkdown": "",
            "markdown": "",
        })
