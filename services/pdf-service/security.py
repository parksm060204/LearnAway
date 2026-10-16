#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PDF Service Security & Token Verification
Default-deny security model: All requests require authenticated service or job tokens.
HMAC signatures are computed strictly over the Base64URL-encoded ASCII payload string.
"""

import os
import hmac
import hashlib
import time
import json
import base64
from typing import Optional, Dict, Any


def get_service_token() -> str:
    return os.getenv("PDF_CONVERT_SERVICE_TOKEN", "").strip()


def verify_service_token(provided_token: Optional[str]) -> bool:
    """
    Verifies fixed pre-shared service token.
    Default-deny: If no SERVICE_TOKEN is configured in the environment,
    returns False immediately to protect against unauthorized open access.
    """
    service_token = get_service_token()
    if not service_token:
        return False
    if not provided_token:
        return False
    return hmac.compare_digest(provided_token.strip(), service_token)


def verify_job_token(
    token: str,
    expected_user_id: Optional[str] = None,
    expected_job_id: Optional[str] = None,
    expected_storage_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Verifies HMAC-signed job token containing payload:
    {
      "userId": "uuid",
      "jobId": "uuid",
      "storagePath": "optional-path",
      "maxPages": 250,
      "exp": 1700000000
    }
    Format: payload_base64url.signature_hex
    HMAC is computed over the Base64URL string in ASCII encoding.
    Restores Base64URL padding before decoding.
    """
    service_token = get_service_token()
    if not service_token:
        return None

    if not token or "." not in token:
        return None

    parts = token.split(".", 1)
    if len(parts) != 2:
        return None

    payload_b64, signature = parts

    try:
        # Constant-time comparison of HMAC signature over the exact payload_b64 ASCII string
        expected_sig = hmac.new(
            service_token.encode("utf-8"),
            payload_b64.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_sig):
            return None

        # Restore Base64URL padding
        pad_len = (4 - len(payload_b64) % 4) % 4
        padded_b64 = payload_b64 + ("=" * pad_len)
        payload_bytes = base64.urlsafe_b64decode(padded_b64.encode("ascii"))
        payload = json.loads(payload_bytes.decode("utf-8"))

        if not isinstance(payload, dict):
            return None

        user_id = payload.get("userId")
        job_id = payload.get("jobId")
        exp = payload.get("exp")

        if not user_id or not job_id or not isinstance(exp, (int, float)):
            return None

        # Verify expiration
        if time.time() > float(exp):
            return None

        # Verify binding claims against request context if provided
        if expected_user_id and user_id != expected_user_id:
            return None
        if expected_job_id and job_id != expected_job_id:
            return None
        if expected_storage_path and payload.get("storagePath"):
            if payload.get("storagePath") != expected_storage_path:
                return None

        return payload
    except Exception:
        return None
