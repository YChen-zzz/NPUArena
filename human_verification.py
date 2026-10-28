"""Validate Cloudflare Turnstile challenges on the server."""

from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def configured() -> bool:
    return bool(os.environ.get("TURNSTILE_SITE_KEY", "").strip() and os.environ.get("TURNSTILE_SECRET_KEY", "").strip())


def verify_turnstile(token: str, remote_ip: str, hostname: str) -> bool:
    secret = os.environ.get("TURNSTILE_SECRET_KEY", "").strip()
    if not secret:
        raise RuntimeError("Turnstile is not configured")
    if not isinstance(token, str) or not token or len(token) > 2048:
        return False
    payload = json.dumps({"secret": secret, "response": token, "remoteip": remote_ip}).encode("utf-8")
    request = Request(SITEVERIFY_URL, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=8) as response:
        result = json.load(response)
    return result.get("success") is True and result.get("hostname") == hostname and result.get("action") == "register"
