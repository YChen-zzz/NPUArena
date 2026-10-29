"""Serve the NPUTrainArena site and its account API from one origin."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
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

from database import Database, hash_password, verify_password
from email_delivery import configured as smtp_configured, send_verification_email
from human_verification import configured as turnstile_configured, verify_turnstile


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
COOKIE_NAME = "npuarena_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
AUTH_PATHS = {"/api/auth/register", "/api/auth/verify", "/api/auth/login", "/api/auth/logout"}
VERIFY_SECONDS = 15 * 60
REGISTER_MESSAGE = "如果该邮箱可以注册，我们已发送确认邮件。请在 15 分钟内完成验证。"
DUMMY_PASSWORD_HASH = hash_password("npuarena-invalid-account-dummy-password")
DRAFTS_PATH = "/api/leaderboards/drafts"
SUBMISSIONS_PATH = "/api/submissions"
ADMIN_SUBMISSIONS_PATH = "/api/admin/submissions"
DRAFT_FIELDS = {
    "title": 100, "category": 20, "summary": 2000, "hardware": 300,
    "workload": 300, "model": 1000, "target": 500, "metric": 300,
    "direction": 10, "rulesVersion": 100, "submission": 20,
    "evidence": 2000, "verification": 2000, "projectUrl": 1000,
    "submissionUrl": 1000, "baselineName": 300, "baselineScore": 100,
    "baselineEvidence": 1000,
}
DRAFT_REQUIRED = {"title", "category", "summary", "hardware", "workload", "model", "target", "metric", "direction", "rulesVersion", "submission", "evidence", "verification"}
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


def validate_draft(data: dict) -> dict:
    values = {}
    for field, limit in DRAFT_FIELDS.items():
        value = data.get(field, "")
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise ValueError("字段格式无效或内容过长。")
        values[field] = value.strip()
    if any(not values[field] for field in DRAFT_REQUIRED):
        raise ValueError("请填写所有必填字段。")
    if values["category"] not in {"training", "inference", "kernel"} or values["direction"] not in {"asc", "desc"} or values["submission"] not in {"github-pr", "external", "maintainer"}:
        raise ValueError("榜单选项无效。")
    baseline = (values["baselineName"], values["baselineScore"], values["baselineEvidence"])
    if any(baseline) and not all(baseline):
        raise ValueError("首条成绩需要方案名称、成绩和证据链接。")
    for field in ("projectUrl", "submissionUrl", "baselineEvidence"):
        if values[field] and urlsplit(values[field]).scheme not in {"http", "https"}:
            raise ValueError("链接必须以 http:// 或 https:// 开头。")
    return values


def validate_community_submission(data: dict) -> tuple[str, dict]:
    limits = {"kind": 20, "category": 20, "title": 100, "summary": 1200,
              "repoUrl": 500, "email": 254, "hardware": 300, "metric": 300, "quality": 300}
    values = {}
    for field, limit in limits.items():
        value = data.get(field, "")
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise ValueError("字段格式无效或内容过长。")
        values[field] = value.strip()
    values["email"] = values["email"].lower()
    if values["kind"] not in {"benchmark", "leaderboard"} or values["category"] not in {"training", "inference", "kernel"}:
        raise ValueError("请选择提交类型和加速方向。")
    if not 3 <= len(values["title"]) <= 100 or not 20 <= len(values["summary"]) <= 1200:
        raise ValueError("标题至少 3 字，说明至少 20 字。")
    if not EMAIL_PATTERN.fullmatch(values["email"]):
        raise ValueError("请输入有效的联系邮箱。")
    repo = urlsplit(values["repoUrl"])
    if repo.scheme != "https" or repo.hostname != "github.com" or repo.username or repo.password or repo.query or repo.fragment or not re.fullmatch(r"/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?", repo.path):
        raise ValueError("请填写 GitHub 仓库主页链接。")
    email = values.pop("email")
    values["repoUrl"] = f"https://github.com{repo.path.rstrip('/')}"
    return email, values


def handler_for(database: Database, mailer=send_verification_email, challenge_verifier=verify_turnstile):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            if os.environ.get("PUBLIC_ORIGIN", "").startswith("https://"):
                self.send_header("Strict-Transport-Security", "max-age=31536000")
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

        def secure_auth_origin(self) -> bool:
            configured = os.environ.get("PUBLIC_ORIGIN", "").rstrip("/")
            if configured:
                parsed = urlsplit(configured)
                local_peer = self.client_address[0] in {"127.0.0.1", "::1"}
                trusted_proxies = {item.strip() for item in os.environ.get("TRUSTED_PROXY_IPS", "").split(",") if item.strip()}
                if parsed.scheme == "https":
                    return local_peer or self.client_address[0] in trusted_proxies
                return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"} and local_peer
            host = urlsplit(f"http://{self.headers.get('Host', '')}").hostname
            return host in {"localhost", "127.0.0.1", "::1"} and self.client_address[0] in {"127.0.0.1", "::1"}

        def client_ip(self) -> str:
            direct = self.client_address[0]
            trusted = {item.strip() for item in os.environ.get("TRUSTED_PROXY_IPS", "").split(",") if item.strip()}
            if direct not in trusted:
                return direct
            forwarded = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
            try:
                return str(ipaddress.ip_address(forwarded))
            except ValueError:
                return direct

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

        def current_user(self) -> dict | None:
            token = self.session_token()
            return database.user_by_session(token_hash(token)) if token else None

        def require_admin(self) -> dict | None:
            user = self.current_user()
            if not user:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "请先登录管理员账号。"})
                return None
            if user["role"] != "admin":
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "仅管理员可以创建或修改 Leaderboard。"})
                return None
            return user

        def draft_id(self, path: str) -> str | None:
            prefix = DRAFTS_PATH + "/"
            value = path[len(prefix):] if path.startswith(prefix) else ""
            return value if re.fullmatch(r"[0-9a-f-]{36}", value) else None

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == f"{SUBMISSIONS_PATH}/public" or path == ADMIN_SUBMISSIONS_PATH:
                if not self.secure_auth_origin():
                    self.json_response(HTTPStatus.FORBIDDEN, {"error": "提交操作需要 HTTPS。"})
                    return
                if path == f"{SUBMISSIONS_PATH}/public":
                    self.json_response(HTTPStatus.OK, {"submissions": database.list_community_submissions(public_only=True)})
                    return
                if path == ADMIN_SUBMISSIONS_PATH:
                    if self.require_admin():
                        self.json_response(HTTPStatus.OK, {"submissions": database.list_community_submissions()})
                    return
            if path == "/api/auth/config":
                self.json_response(HTTPStatus.OK, {
                    "turnstileSiteKey": os.environ.get("TURNSTILE_SITE_KEY", "").strip(),
                    "registrationAvailable": os.environ.get("PUBLIC_REGISTRATION_ENABLED", "").lower() == "true" and bool(os.environ.get("PUBLIC_ORIGIN", "").strip()) and self.secure_auth_origin() and smtp_configured() and turnstile_configured(),
                })
                return
            if (path == "/api/auth/me" or path.startswith(DRAFTS_PATH)) and not self.secure_auth_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "账号操作需要 HTTPS。"})
                return
            if path == "/api/auth/me":
                self.json_response(HTTPStatus.OK, {"user": self.current_user()})
                return
            if path == DRAFTS_PATH or self.draft_id(path):
                if not self.require_admin():
                    return
                if path == DRAFTS_PATH:
                    self.json_response(HTTPStatus.OK, {"drafts": database.list_leaderboard_drafts()})
                else:
                    draft = database.leaderboard_draft(self.draft_id(path))
                    self.json_response(HTTPStatus.OK if draft else HTTPStatus.NOT_FOUND, {"draft": draft} if draft else {"error": "找不到这个草稿。"})
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
            review_match = re.fullmatch(r"/api/admin/submissions/([0-9a-f-]{36})/review", path)
            if path in {SUBMISSIONS_PATH, f"{SUBMISSIONS_PATH}/receipt"} or review_match:
                if not self.secure_auth_origin():
                    self.json_response(HTTPStatus.FORBIDDEN, {"error": "提交操作需要 HTTPS。"})
                    return
                if not self.same_origin():
                    self.json_response(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                    return
                if review_match and not self.require_admin():
                    return
                data = self.read_json()
                if data is None:
                    return
                if path == f"{SUBMISSIONS_PATH}/receipt":
                    receipt = data.get("receipt", "")
                    if not isinstance(receipt, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,120}", receipt):
                        self.json_response(HTTPStatus.NOT_FOUND, {"error": "找不到这条提交。"})
                        return
                    submission = database.community_submission_by_receipt(token_hash(receipt))
                    self.json_response(HTTPStatus.OK if submission else HTTPStatus.NOT_FOUND,
                                       {"submission": submission} if submission else {"error": "找不到这条提交。"})
                    return
                if review_match:
                    status = data.get("status")
                    note = data.get("note", "")
                    if status not in {"approved", "rejected"} or not isinstance(note, str) or len(note.strip()) > 1000:
                        self.json_response(HTTPStatus.BAD_REQUEST, {"error": "审核状态或备注无效。"})
                        return
                    item = database.review_community_submission(review_match.group(1), status, note.strip())
                    self.json_response(HTTPStatus.OK if item else HTTPStatus.NOT_FOUND,
                                       {"submission": item} if item else {"error": "找不到这条提交。"})
                    return
                if data.get("website", ""):
                    self.json_response(HTTPStatus.ACCEPTED, {"message": "提交已收到。"})
                    return
                try:
                    email, proposal = validate_community_submission(data)
                except ValueError as error:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                    return
                receipt = secrets.token_urlsafe(32)
                item = database.create_community_submission(email, self.client_ip(), proposal, token_hash(receipt))
                if not item:
                    self.json_response(HTTPStatus.TOO_MANY_REQUESTS, {"error": "提交过于频繁，请稍后再试。"})
                    return
                self.json_response(HTTPStatus.ACCEPTED, {"receipt": receipt, "status": "pending"})
                return
            if path in {"/api/auth/register", "/api/auth/verify"} and os.environ.get("PUBLIC_REGISTRATION_ENABLED", "").lower() != "true":
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "公开注册已关闭。"})
                return
            if path not in AUTH_PATHS and path != DRAFTS_PATH:
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            if (path in AUTH_PATHS or path == DRAFTS_PATH) and not self.secure_auth_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "账号操作需要 HTTPS。"})
                return
            if not self.same_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                return
            if path == DRAFTS_PATH and not self.require_admin():
                return
            data = self.read_json()
            if data is None:
                return
            if path == DRAFTS_PATH:
                try:
                    values = validate_draft(data)
                except ValueError as error:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                    return
                self.json_response(HTTPStatus.CREATED, {"draft": database.save_leaderboard_draft(values, self.current_user()["id"])})
                return
            if path == "/api/auth/logout":
                token = self.session_token()
                if token:
                    database.delete_session(token_hash(token))
                self.json_response(HTTPStatus.OK, {"ok": True}, self.session_cookie("", 0))
                return

            if path == "/api/auth/verify":
                if not allowed_attempt(self.client_ip(), "verify"):
                    self.json_response(HTTPStatus.TOO_MANY_REQUESTS, {"error": "尝试次数过多，请稍后再试。"})
                    return
                token = data.get("token", "")
                if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,120}", token):
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": "确认链接无效或已过期。"})
                    return
                user = database.consume_pending_registration(token_hash(token))
                if not user:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": "确认链接无效或已过期。"})
                    return
                self.new_session(user)
                return

            action = path.rsplit("/", 1)[-1]
            allowed = database.reserve_login_attempt(self.client_ip()) if action == "login" else allowed_attempt(self.client_ip(), action)
            if not allowed:
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
                origin = os.environ.get("PUBLIC_ORIGIN", "").rstrip("/")
                if not origin or urlsplit(origin).scheme not in {"http", "https"} or not urlsplit(origin).netloc:
                    self.json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "注册服务暂时不可用，请稍后再试。"})
                    return
                if (mailer is send_verification_email and not smtp_configured()) or (challenge_verifier is verify_turnstile and not turnstile_configured()):
                    self.json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "注册服务暂时不可用，请稍后再试。"})
                    return
                if not database.registration_allowed(self.client_ip(), email):
                    self.json_response(HTTPStatus.TOO_MANY_REQUESTS, {"error": "注册申请过于频繁，请稍后再试。"})
                    return
                challenge_token = data.get("turnstileToken", "")
                if not isinstance(challenge_token, str) or not challenge_token or len(challenge_token) > 2048:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": "请完成人机验证。"})
                    return
                try:
                    valid_challenge = challenge_verifier(challenge_token, self.client_ip(), urlsplit(origin).hostname)
                except Exception:
                    self.json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "人机验证暂时不可用，请稍后再试。"})
                    return
                if not valid_challenge:
                    self.json_response(HTTPStatus.BAD_REQUEST, {"error": "人机验证未通过，请重试。"})
                    return
                token = secrets.token_urlsafe(32)
                password_hash = hash_password(password)
                existing_user = database.user_by_email(email)
                if not existing_user:
                    database.save_pending_registration(name, email, password_hash, token_hash(token), VERIFY_SECONDS)
                url = f"{origin}/#/account/login" if existing_user else f"{origin}/#/account/verify?token={token}"
                try:
                    mailer(email, url)
                except Exception:
                    self.json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "注册服务暂时不可用，请稍后再试。"})
                    return
                self.json_response(HTTPStatus.ACCEPTED, {"message": REGISTER_MESSAGE})
                return

            user = database.user_by_email(email)
            password_valid = verify_password(password, user["password_hash"] if user else DUMMY_PASSWORD_HASH)
            if not user or not password_valid or user["role"] != "admin":
                if not database.record_failed_login(email):
                    self.json_response(HTTPStatus.TOO_MANY_REQUESTS, {"error": "尝试次数过多，请稍后再试。"})
                    return
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "邮箱或密码不正确。"})
                return
            database.clear_login_failures(email, self.client_ip())
            self.new_session({"id": user["id"], "displayName": user["display_name"], "email": user["email"], "role": user["role"]})

        def do_PUT(self):
            path = urlsplit(self.path).path
            if not self.secure_auth_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "账号操作需要 HTTPS。"})
                return
            draft_id = self.draft_id(path)
            if not draft_id:
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            if not self.same_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                return
            user = self.require_admin()
            if not user:
                return
            data = self.read_json()
            if data is None:
                return
            try:
                values = validate_draft(data)
            except ValueError as error:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            draft = database.save_leaderboard_draft(values, user["id"], draft_id)
            self.json_response(HTTPStatus.OK if draft else HTTPStatus.NOT_FOUND, {"draft": draft} if draft else {"error": "找不到这个草稿。"})

        def do_DELETE(self):
            path = urlsplit(self.path).path
            if not self.secure_auth_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "账号操作需要 HTTPS。"})
                return
            draft_id = self.draft_id(path)
            if not draft_id:
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return
            if not self.same_origin():
                self.json_response(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                return
            if not self.require_admin():
                return
            deleted = database.delete_leaderboard_draft(draft_id)
            self.json_response(HTTPStatus.OK if deleted else HTTPStatus.NOT_FOUND, {"ok": True} if deleted else {"error": "找不到这个草稿。"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="NPUTrainArena website and account API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    database = Database()
    server = ThreadingHTTPServer((args.host, args.port), handler_for(database))
    print(f"NPUTrainArena: http://{args.host}:{args.port}/ (database: {database.kind})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
