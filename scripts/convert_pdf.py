#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
REDCALL Academic Study Suite - PyMuPDF4LLM PDF Conversion Worker
Extracts page-by-page markdown and metadata from PDF files using pymupdf4llm.
"""

import sys
import os
import json

def convert_pdf_to_markdown(pdf_path):
    if not os.path.exists(pdf_path):
        return {
            "success": False,
            "hasText": False,
            "pageCount": 0,
            "error": f"파일을 찾을 수 없습니다: {pdf_path}",
            "pages": [],
            "fullMarkdown": ""
        }

    try:
        import pymupdf
        import pymupdf4llm
    except ImportError as e:
        return {
            "success": False,
            "hasText": False,
            "pageCount": 0,
            "error": f"PyMuPDF4LLM 라이브러리가 로드되지 않았습니다: {str(e)}",
            "pages": [],
            "fullMarkdown": ""
        }

    doc = None
    try:
        doc = pymupdf.open(pdf_path)
        page_count = len(doc)

        if page_count == 0:
            return {
                "success": False,
                "hasText": False,
                "pageCount": 0,
                "error": "빈 PDF 문서입니다.",
                "pages": [],
                "fullMarkdown": ""
            }

        # Extract page-by-page chunks
        chunks = pymupdf4llm.to_markdown(doc, page_chunks=True)

        pages = []
        total_text_len = 0

        for i, chunk in enumerate(chunks):
            page_num = i + 1
            text = chunk.get("text", "")
            trimmed = text.strip()
            total_text_len += len(trimmed)

            pages.append({
                "pageNumber": page_num,
                "markdown": text,
                "hasText": len(trimmed) > 0
            })

        # Combine into complete document markdown with page markers
        full_markdown_parts = []
        for p in pages:
            full_markdown_parts.append(f"<!-- [PAGE {p['pageNumber']}] -->\n" + p["markdown"])
        full_markdown = "\n\n".join(full_markdown_parts)

        # Detect image-only / scan PDFs with zero extractable text
        has_text = total_text_len > 0

        if not has_text:
            return {
                "success": False,
                "hasText": False,
                "pageCount": page_count,
                "error": "이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다. 원본 확인이 필요합니다.",
                "pages": pages,
                "fullMarkdown": ""
            }

        return {
            "success": True,
            "hasText": True,
            "pageCount": page_count,
            "pages": pages,
            "fullMarkdown": full_markdown,
            "error": None
        }

    except Exception as e:
        return {
            "success": False,
            "hasText": False,
            "pageCount": 0,
            "error": f"변환 실패: {str(e)}",
            "pages": [],
            "fullMarkdown": ""
        }
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass

if __name__ == "__main__":
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    if len(sys.argv) < 2:
        res = {
            "success": False,
            "hasText": False,
            "pageCount": 0,
            "error": "PDF 파일 경로 인자가 필요합니다.",
            "pages": [],
            "fullMarkdown": ""
        }
        print(json.dumps(res, ensure_ascii=False))
        sys.exit(1)

    pdf_file = sys.argv[1]
    result = convert_pdf_to_markdown(pdf_file)
    print(json.dumps(result, ensure_ascii=False))
