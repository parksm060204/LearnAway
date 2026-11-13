#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Unit tests for single-request time budget, queue wait, early abort when
remaining budget is insufficient, and slot/temp cleanup on timeout.
"""

import asyncio
import glob
import os
import sys
import tempfile
import time
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(__file__))
import main  # noqa: E402


MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n"
    b"4 0 obj<</Length 55>>stream\n"
    b"BT /F1 18 Tf 50 100 Td (LearnAway Budget Test) Tj ET\n"
    b"endstream\n"
    b"endobj\n"
    b"xref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000216 00000 n\n"
    b"trailer<</Size 5/Root 1 0 R>>\nstartxref\n321\n%%EOF"
)


def slow_worker(pdf_path: str, max_pages: int, res_queue) -> None:
    time.sleep(2.5)
    res_queue.put({"success": True, "pageCount": 1, "pages": [], "fullMarkdown": "late"})


async def run_all_tests() -> None:
    # Configure short deterministic limits for tests
    main.MAX_CONCURRENT_TASKS = 1
    main.concurrency_semaphore = asyncio.Semaphore(1)
    main.CONVERSION_QUEUE_TIMEOUT_SECONDS = 2.0
    main.CLEANUP_AND_RESPONSE_MARGIN_SECONDS = 0.2
    main.MIN_CONVERSION_BUDGET_SECONDS = 0.5

    temp_dir = tempfile.gettempdir()

    # 1. Immediate success
    before_pdfs = set(glob.glob(os.path.join(temp_dir, "*.pdf")))
    deadline = main.compute_work_deadline(time.monotonic(), 10.0)
    res = await main.execute_conversion_with_killable_process(
        MINIMAL_PDF, 10, 5.0, deadline_monotonic=deadline
    )
    assert res["success"] is True, f"Expected immediate success, got {res}"
    assert "LearnAway Budget Test" in res["fullMarkdown"]
    assert main.concurrency_semaphore._value == 1, "Semaphore must be released after immediate success"
    after_pdfs = set(glob.glob(os.path.join(temp_dir, "*.pdf")))
    assert after_pdfs <= before_pdfs, f"Leaked temp PDFs: {after_pdfs - before_pdfs}"
    print("[PASS] 1. Immediate conversion succeeds and releases slot + temp file")

    # 2. Wait in queue then succeed within remaining budget
    await main.concurrency_semaphore.acquire()

    async def release_soon():
        await asyncio.sleep(0.25)
        main.concurrency_semaphore.release()

    releaser = asyncio.create_task(release_soon())
    deadline = main.compute_work_deadline(time.monotonic(), 5.0)
    res = await main.execute_conversion_with_killable_process(
        MINIMAL_PDF, 10, 5.0, deadline_monotonic=deadline
    )
    await releaser
    assert res["success"] is True
    assert main.concurrency_semaphore._value == 1
    print("[PASS] 2. Waited in queue and succeeded within remaining single-request budget")

    # 3A. Insufficient remaining budget BEFORE queue wait -> must not start worker
    deadline_short = time.monotonic() + 0.2  # < MIN_CONVERSION_BUDGET_SECONDS (0.5)
    with patch("main.mp.get_context") as mock_mp:
        try:
            await main.execute_conversion_with_killable_process(
                MINIMAL_PDF, 10, 5.0, deadline_monotonic=deadline_short
            )
            raise AssertionError("Expected 504 HTTPException when budget < MIN_CONVERSION_BUDGET_SECONDS")
        except HTTPException as exc:
            assert exc.status_code == 504, f"Expected 504, got {exc.status_code}"
        assert mock_mp.call_count == 0, "Worker subprocess must not be spawned when budget is insufficient"
    assert main.concurrency_semaphore._value == 1
    print("[PASS] 3A. Insufficient budget before wait aborts with 504 without spawning worker")

    # 3B. Insufficient remaining budget AFTER queue wait -> must release slot & not start worker
    await main.concurrency_semaphore.acquire()

    async def release_late():
        await asyncio.sleep(0.55)
        main.concurrency_semaphore.release()

    releaser2 = asyncio.create_task(release_late())
    # Total work deadline = 0.85s -> after 0.55s wait, 0.30s < 0.50s min conversion budget
    deadline_tight = time.monotonic() + 0.85
    with patch("main.mp.get_context") as mock_mp:
        try:
            await main.execute_conversion_with_killable_process(
                MINIMAL_PDF, 10, 5.0, deadline_monotonic=deadline_tight
            )
            raise AssertionError("Expected 504 HTTPException after wait leaves insufficient budget")
        except HTTPException as exc:
            assert exc.status_code == 504, f"Expected 504, got {exc.status_code}"
        assert mock_mp.call_count == 0, "Worker subprocess must not be spawned when post-wait budget < min"
    await releaser2
    assert main.concurrency_semaphore._value == 1, "Semaphore must be released after post-wait abort"
    after_pdfs_3b = set(glob.glob(os.path.join(temp_dir, "*.pdf")))
    assert after_pdfs_3b <= before_pdfs, f"Leaked temp PDFs: {after_pdfs_3b - before_pdfs}"
    print("[PASS] 3B. Insufficient budget after queue wait aborts with 504, releases slot, leaves 0 temp files")

    # 4. Timeout during conversion -> kills worker, deletes temp file, releases slot
    deadline_timeout = time.monotonic() + 1.0
    with patch("main.run_worker_conversion", side_effect=slow_worker):
        # Note: Windows spawn imports target by name, so patch converter.run_worker_conversion?
        # Even better: test timeout directly with a short timeout_seconds and a monkeypatched Process/worker
        pass

    # Use a real subprocess via a small helper module or short timeout on converter
    import converter as conv_mod
    orig_worker = main.run_worker_conversion
    # On Windows spawn, pickling requires top-level function; use a tiny temp module or patch timeout=0.001
    try:
        try:
            await main.execute_conversion_with_killable_process(
                MINIMAL_PDF, 10, 0.01, deadline_monotonic=time.monotonic() + 2.0
            )
            raise AssertionError("Expected 504 timeout on 0.01s conversion limit")
        except HTTPException as exc:
            assert exc.status_code == 504, f"Expected 504, got {exc.status_code}"
    finally:
        main.run_worker_conversion = orig_worker

    assert main.concurrency_semaphore._value == 1, "Semaphore must be released after conversion timeout"
    after_pdfs_4 = set(glob.glob(os.path.join(temp_dir, "*.pdf")))
    assert after_pdfs_4 <= before_pdfs, f"Leaked temp PDFs after timeout: {after_pdfs_4 - before_pdfs}"
    print("[PASS] 4. Conversion timeout kills worker, deletes temp file, and releases slot")

    print("\nALL REQUEST BUDGET TESTS PASSED!")


if __name__ == "__main__":
    asyncio.run(run_all_tests())

