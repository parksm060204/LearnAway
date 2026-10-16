#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PDF Service Security & Token Verification
"""

import os
import hmac
import hashlib
import time
import json
from typing import Optional, Dict, Any


SERVICE_TOKEN = os.getenv("PDF_CONVERT_SERVICE_TOKEN", "").strip()


def verify_service_token(provided_token: Optional[str]) -> bool:
    """
    Verifies fixed pre-shared service token.
    If no SERVICE_TOKEN is configured in the environment, returns True (open local dev mode).
    In production, SERVICE_TOKEN MUST be configured.
    """
    if not SERVICE_TOKEN:
        return True
    if not provided_token:
        return False
    return hmac.compare_digest(provided_token.strip(), SERVICE_TOKEN)


def verify_job_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verifies HMAC-signed job token containing payload:
    {
      "userId": "uuid",
      "jobId": "uuid",
      "materialId": "optional-id",
      "exp": 1700000000
    }
    Format: payload_base64.signature_hex
    """
    if not token or "." not in token:
        return None

    try:
        payload_b64, signature = token.split(".", 1)
        import base64
        payload_bytes = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        payload = json.loads(payload_bytes.decode("utf-8"))

        # Verify expiration
        exp = payload.get("exp", 0)
        if time.time() > exp:
            return None

        # Verify HMAC signature
        expected_sig = hmac.new(
            SERVICE_TOKEN.encode("utf-8"),
            payload_bytes,
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_sig):
            return None

        return payload
    except Exception:
        return None
