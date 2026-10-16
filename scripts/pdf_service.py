#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LearnAway PDF Microservice Runner (Compat Shim)
Routes execution to services/pdf-service/main.py
"""

import sys
import os

service_dir = os.path.join(os.path.dirname(__file__), '..', 'services', 'pdf-service')
sys.path.insert(0, os.path.abspath(service_dir))

from main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
