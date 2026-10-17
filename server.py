"""Serve the NPUArena site and its account API from one origin."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from database import Database, DuplicateEmail, verify_password


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
COOKIE_NAME = "npuarena_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
AUTH_PATHS = {"/api/auth/register", "/api/auth/login", "/api/auth/logout"}
attempts: dict[tuple[str, str], deque[float]] = defaultdict(deque)
attempts_lock = threading.Lock()


def allowed_attempt(client: str, action: str) -> bool:
    now = time.monotonic()
    key = (client, action)
    with attempts_lock:
        bucket = attempts[key]
        while bucket and now - bucket[0] > 15 * 60:
            bucket.popleft()
        if len(bucket) >= (5 if action == "register" else 12):
            return False
        bucket.append(now)
        return True


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def handler_for(database: Database):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

        def json_response(self, status: HTTPStatus, data: dict, cookie: str | None = None):
            body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)

        def session_token(self) -> str | None:
            try:
                cookie = SimpleCookie()
                cookie.load(self.headers.get("Cookie", ""))
                value = cookie.get(COOKIE_NAME)
                token = value.value if value else None
                return token if token and re.fullmatch(r"[A-Za-z0-9_-]{30,120}", token) else None
            except Exception:
                return None

        def session_cookie(self, token: str, lifetime: int = SESSION_SECONDS) -> str:
            parts = [f"{COOKIE_NAME}={token}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={lifetime}"]
            if os.environ.get("COOKIE_SECURE", "").lower() == "true" or os.environ.get("PUBLIC_ORIGIN", "").startswith("https://"):
                parts.append("Secure")
            return "; ".join(parts)

        def same_origin(self) -> bool:
            origin = self.headers.get("Origin", "")
            configured = os.environ.get("PUBLIC_ORIGIN", "").rstrip("/")
            expected = configured or f"http://{self.headers.get('Host', '')}"
            return origin == expected

        def read_json(self) -> dict | None:
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                self.json_response(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "请使用 JSON 提交。"})
                return None
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length < 2 or length > 16_384:
                self.json_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "请求内容无效或过大。"})
                return None
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                data = None
            if not isinstance(data, dict):
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": "请求格式无效。"})
                return None
            return data

        def new_session(self, user: dict):
            token = secrets.token_urlsafe(32)
            database.create_session(token_hash(token), user["id"], SESSION_SECONDS)
            self.json_response(HTTPStatus.OK, {"user": user}, self.session_cookie(token))

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/api/auth/me":
                token = self.session_token()
                user = database.user_by_session(token_hash(token)) if token else None
                self.json_response(HTTPStatus.OK, {"user": user})
                return
            if path == "/api/health":
                database.check()
                self.json_response(HTTPStatus.OK, {"status": "ok", "database": database.kind})
                return
            if path.startswith("/api/"):
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            super().do_GET()

        def do_POST(self):
            path = urlsplit(self.path).path
            if path not in AUTH_PATHS:
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            if not self.same_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                return
            data = self.read_json()
            if data is None:
                return
            if path == "/api/auth/logout":
                token = self.session_token()
                if token:
                    database.delete_session(token_hash(token))
                self.json_response(HTTPStatus.OK, {"ok": True}, self.session_cookie("", 0))
                return

            action = path.rsplit("/", 1)[-1]
            if not allowed_attempt(self.client_address[0], action):
                self.json_response(HTTPStatus.TOO_MANY_REQUESTS, {"error": "尝试次数过多，请稍后再试。"})
                return

            email = str(data.get("email", "")).strip().lower()
            password = data.get("password", "")
            if not isinstance(password, str) or not EMAIL_PATTERN.fullmatch(email) or len(email) > 254:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": "请输入有效邮箱和密码。"})
                return

            if action == "register":
                name = str(data.get("displayName", "")).strip()
                if len(name) < 2 or len(name) > 40 or len(password) < 8 or len(password) > 128:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": "昵称需为 2–40 字，密码需为 8–128 字。"})
                    return
                try:
                    user = database.create_user(name, email, password)
                except DuplicateEmail:
                    self.json_response(HTTPStatus.CONFLICT, {"error": "此邮箱已注册，请直接登录。"})
                    return
                self.new_session(user)
                return

            user = database.user_by_email(email)
            if not user or not verify_password(password, user["password_hash"]):
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "邮箱或密码不正确。"})
                return
            self.new_session({"id": user["id"], "displayName": user["display_name"], "email": user["email"]})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="NPUArena website and account API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    database = Database()
    server = ThreadingHTTPServer((args.host, args.port), handler_for(database))
    print(f"NPUArena: http://{args.host}:{args.port}/ (database: {database.kind})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
