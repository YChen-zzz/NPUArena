"""Send registration confirmation links using the configured SMTP service."""

from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage


def configured() -> bool:
    return all(os.environ.get(key, "").strip() for key in ("SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD")) and os.environ.get("SMTP_SECURITY", "starttls").strip().lower() in {"starttls", "ssl"}


def send_verification_email(recipient: str, url: str) -> None:
    host = os.environ.get("SMTP_HOST", "").strip()
    sender = os.environ.get("SMTP_FROM", "").strip()
    username = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    security = os.environ.get("SMTP_SECURITY", "starttls").strip().lower()
    if not configured():
        raise RuntimeError("Registration email is not configured")
    port = int(os.environ.get("SMTP_PORT", "465" if security == "ssl" else "587"))
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "NPUArena 账号申请"
    message.set_content(
        "如果你刚刚申请 NPUArena 账号，请打开以下链接继续。新账号需在 15 分钟内确认邮箱；已有账号可直接登录。\n\n"
        f"{url}\n\n"
        "如果不是你发起的请求，请忽略此邮件。"
    )
    context = ssl.create_default_context()
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=10, context=context) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            smtp.starttls(context=context)
            smtp.login(username, password)
            smtp.send_message(message)
