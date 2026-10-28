import http.cookiejar
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from urllib.parse import parse_qs, urlsplit

from database import Database, verify_password
from server import attempts, handler_for


class AccountApiTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("NPUARENA_DB_PATH")
        self.previous_origin = os.environ.get("PUBLIC_ORIGIN")
        self.previous_public_registration = os.environ.get("PUBLIC_REGISTRATION_ENABLED")
        self.previous_trusted_proxies = os.environ.get("TRUSTED_PROXY_IPS")
        os.environ.pop("TRUSTED_PROXY_IPS", None)
        os.environ["NPUARENA_DB_PATH"] = str(Path(self.temporary.name) / "accounts.sqlite3")
        os.environ["PUBLIC_REGISTRATION_ENABLED"] = "true"
        attempts.clear()
        self.sent_emails = []
        self.cookies = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.start_server()

    def tearDown(self):
        self.stop_server()
        if self.previous_path is None:
            os.environ.pop("NPUARENA_DB_PATH", None)
        else:
            os.environ["NPUARENA_DB_PATH"] = self.previous_path
        if self.previous_origin is None:
            os.environ.pop("PUBLIC_ORIGIN", None)
        else:
            os.environ["PUBLIC_ORIGIN"] = self.previous_origin
        if self.previous_public_registration is None:
            os.environ.pop("PUBLIC_REGISTRATION_ENABLED", None)
        else:
            os.environ["PUBLIC_REGISTRATION_ENABLED"] = self.previous_public_registration
        if self.previous_trusted_proxies is None:
            os.environ.pop("TRUSTED_PROXY_IPS", None)
        else:
            os.environ["TRUSTED_PROXY_IPS"] = self.previous_trusted_proxies
        self.temporary.cleanup()

    def start_server(self):
        self.database = Database()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.database, self.capture_email, self.verify_challenge))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["PUBLIC_ORIGIN"] = self.origin

    def capture_email(self, recipient, url):
        self.sent_emails.append((recipient, url))

    def verify_challenge(self, token, ip, hostname):
        return token == "test-challenge" and hostname == "127.0.0.1"

    def register_and_verify(self, email="test@example.com"):
        account = {"displayName": "NPU Tester", "email": email, "password": "strong-password-123"}
        status, result, headers = self.request("/api/auth/register", account)
        self.assertEqual(status, 202)
        self.assertIsNone(self.request("/api/auth/me")[1]["user"])
        token = parse_qs(urlsplit(self.sent_emails[-1][1]).fragment.split("?", 1)[1])["token"][0]
        return account, self.request("/api/auth/verify", {"token": token})

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, path, payload=None, origin=None, method=None, extra_headers=None):
        headers = {}
        body = None
        if payload is not None:
            if path == "/api/auth/register":
                payload = {"turnstileToken": "test-challenge", **payload}
            body = json.dumps(payload).encode("utf-8")
            headers = {"Content-Type": "application/json", "Origin": origin or self.origin}
        if method in {"PUT", "DELETE"}:
            headers["Origin"] = origin or self.origin
        headers.update(extra_headers or {})
        request = Request(self.origin + path, data=body, headers=headers, method=method)
        try:
            response = self.opener.open(request)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            return response.status, json.loads(content) if path.startswith("/api/") else content.decode(), response.headers

    def test_registration_survives_server_restart_and_logout_revokes_session(self):
        account, (status, result, headers) = self.register_and_verify()
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["email"], "test@example.com")
        self.assertEqual(result["user"]["role"], "member")
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", headers["Set-Cookie"])
        self.assertNotIn("strong-password-123", Path(os.environ["NPUARENA_DB_PATH"]).read_bytes().decode("latin-1"))
        self.assertTrue(self.database.user_by_email("test@example.com")["password_hash"].startswith("scrypt$"))
        self.assertEqual(self.request("/api/auth/me")[1]["user"]["displayName"], "NPU Tester")

        self.stop_server()
        self.start_server()
        self.assertEqual(self.request("/api/auth/me")[1]["user"]["email"], "test@example.com")
        self.assertEqual(self.request("/api/auth/logout", {})[0], 200)
        self.assertIsNone(self.request("/api/auth/me")[1]["user"])
        self.assertEqual(self.request("/api/auth/login", {"email": account["email"], "password": account["password"]})[0], 401)
        self.database.set_user_role(account["email"], "admin")
        self.assertEqual(self.request("/api/auth/login", {"email": account["email"], "password": account["password"]})[0], 200)

    def test_public_registration_disabled_by_default_and_cli_admin_can_log_in(self):
        os.environ.pop("PUBLIC_REGISTRATION_ENABLED", None)
        account = {"displayName": "Tester", "email": "test@example.com", "password": "strong-password-123"}
        self.assertEqual(self.request("/api/auth/register", account)[0], 404)
        self.assertEqual(self.request("/api/auth/verify", {"token": "anything"})[0], 404)
        self.assertFalse(self.request("/api/auth/config")[1]["registrationAvailable"])
        self.assertEqual(self.sent_emails, [])
        self.assertIsNone(self.database.user_by_email(account["email"]))
        self.database.create_admin("Admin", "admin@example.com", "long-admin-password-123")
        self.assertEqual(self.request("/api/auth/login", {"email": "admin@example.com", "password": "long-admin-password-123"})[0], 200)
        self.assertEqual(self.request("/api/auth/me")[1]["user"]["role"], "admin")

    def test_login_unknown_email_uses_password_hash_and_generic_error(self):
        self.database.create_admin("Admin", "admin@example.com", "long-admin-password-123")
        with patch("server.verify_password", wraps=verify_password) as checked:
            unknown = self.request("/api/auth/login", {"email": "unknown@example.com", "password": "wrong-password"})
            self.assertEqual(checked.call_count, 1)
            self.assertTrue(checked.call_args.args[1].startswith("scrypt$"))
        known = self.request("/api/auth/login", {"email": "admin@example.com", "password": "wrong-password"})
        self.assertEqual((unknown[0], unknown[1]), (known[0], known[1]))

    def test_login_limits_survive_restart_and_span_source_ips(self):
        self.database.create_admin("Admin", "admin@example.com", "long-admin-password-123")
        os.environ["TRUSTED_PROXY_IPS"] = "127.0.0.1"
        for index in range(12):
            status, _, _ = self.request("/api/auth/login", {
                "email": "admin@example.com", "password": "wrong-password"
            }, extra_headers={"X-Forwarded-For": f"192.0.2.{index + 1}"})
            self.assertEqual(status, 401)
        self.stop_server()
        self.start_server()
        headers = {"X-Forwarded-For": "198.51.100.1"}
        self.assertEqual(self.request("/api/auth/login", {
            "email": "admin@example.com", "password": "wrong-password"
        }, extra_headers=headers)[0], 429)
        self.assertEqual(self.request("/api/auth/login", {
            "email": "admin@example.com", "password": "long-admin-password-123"
        }, extra_headers=headers)[0], 200)
        self.assertTrue(Database().record_failed_login("admin@example.com"))

    def test_login_ip_limit_survives_restart(self):
        for _ in range(12):
            self.assertEqual(self.request("/api/auth/login", {
                "email": "unknown@example.com", "password": "wrong-password"
            })[0], 401)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.request("/api/auth/login", {
            "email": "another@example.com", "password": "wrong-password"
        })[0], 429)

    def test_distributed_login_limit_survives_restart(self):
        for index in range(120):
            self.assertTrue(self.database.reserve_login_attempt(f"198.51.100.{index + 1}"))
        self.assertFalse(Database().reserve_login_attempt("203.0.113.1"))

    def test_duplicate_login_failure_and_cross_origin_request(self):
        account = {"displayName": "Tester", "email": "test@example.com", "password": "strong-password-123"}
        first = self.request("/api/auth/register", account)
        token = parse_qs(urlsplit(self.sent_emails[-1][1]).fragment.split("?", 1)[1])["token"][0]
        self.assertEqual(self.request("/api/auth/verify", {"token": token})[0], 200)
        duplicate = self.request("/api/auth/register", account)
        self.assertEqual((first[0], first[1]), (duplicate[0], duplicate[1]))
        self.assertEqual(urlsplit(self.sent_emails[-1][1]).fragment, "/account/login")
        self.assertEqual(self.request("/api/auth/login", {"email": account["email"], "password": "wrong-password"})[0], 401)
        self.assertEqual(self.request("/api/auth/logout", {}, origin="https://evil.example")[0], 403)
        self.assertIsNotNone(self.request("/api/auth/me")[1]["user"])

    def test_leaderboard_drafts_require_admin_on_every_write(self):
        draft = {
            "title": "Test leaderboard", "category": "training", "summary": "A test task",
            "hardware": "1 NPU", "workload": "dataset", "model": "model",
            "target": "loss <= 1", "metric": "seconds", "direction": "asc",
            "rulesVersion": "v1", "submission": "github-pr", "evidence": "logs",
            "verification": "review logs",
        }
        self.assertEqual(self.request("/api/leaderboards/drafts")[0], 401)
        self.assertEqual(self.request("/api/leaderboards/drafts", draft)[0], 401)
        self.register_and_verify("admin@example.com")
        self.assertEqual(self.request("/api/leaderboards/drafts")[0], 403)
        self.assertEqual(self.request("/api/leaderboards/drafts", draft)[0], 403)
        self.assertTrue(self.database.set_user_role("admin@example.com", "admin"))
        self.assertEqual(self.request("/api/auth/me")[1]["user"]["role"], "admin")
        self.assertEqual(self.request("/api/leaderboards/drafts", draft, origin="https://evil.example")[0], 403)
        status, result, _ = self.request("/api/leaderboards/drafts", draft)
        self.assertEqual(status, 201)
        draft_id = result["draft"]["id"]
        self.assertEqual(self.request("/api/leaderboards/drafts")[1]["drafts"][0]["title"], "Test leaderboard")
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}")[0], 200)
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}", {**draft, "title": "Updated"}, method="PUT")[1]["draft"]["title"], "Updated")
        self.stop_server()
        self.start_server()
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}")[1]["draft"]["title"], "Updated")
        self.assertTrue(self.database.set_user_role("admin@example.com", "member"))
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}", {**draft, "title": "Forbidden"}, method="PUT")[0], 403)
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}", method="DELETE")[0], 403)
        self.assertTrue(self.database.set_user_role("admin@example.com", "admin"))
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}", method="DELETE")[0], 200)
        self.assertEqual(self.request(f"/api/leaderboards/drafts/{draft_id}")[0], 404)

    def test_registration_is_rate_limited_across_email_addresses(self):
        for index in range(5):
            self.assertEqual(self.request("/api/auth/register", {
                "displayName": "Tester", "email": f"user{index}@example.com", "password": "strong-password-123"
            }, extra_headers={"X-Forwarded-For": f"192.0.2.{index}"})[0], 202)
        self.assertEqual(self.request("/api/auth/register", {
            "displayName": "Tester", "email": "sixth@example.com", "password": "strong-password-123"
        }, extra_headers={"X-Forwarded-For": "192.0.2.200"})[0], 429)
        self.assertEqual(self.database.user_by_email("user0@example.com"), None)

    def test_database_registration_limit_cannot_be_evaded_by_new_ips(self):
        for index in range(30):
            self.assertTrue(self.database.registration_allowed(f"192.0.2.{index}", f"user{index}@domain{index}.example"))
        restarted = Database()
        self.assertFalse(restarted.registration_allowed("198.51.100.1", "next@another.example"))

    def test_registration_fails_closed_when_mail_is_unavailable(self):
        self.stop_server()
        def unavailable_mailer(recipient, url):
            raise RuntimeError("SMTP unavailable")
        self.database = Database()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.database, unavailable_mailer, self.verify_challenge))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["PUBLIC_ORIGIN"] = self.origin
        status, _, _ = self.request("/api/auth/register", {
            "displayName": "Tester", "email": "test@example.com", "password": "strong-password-123"
        })
        self.assertEqual(status, 503)
        self.assertIsNone(self.database.user_by_email("test@example.com"))

    def test_public_http_auth_is_rejected(self):
        os.environ["PUBLIC_ORIGIN"] = "http://public.example"
        self.assertEqual(self.request("/api/auth/register", {
            "displayName": "Tester", "email": "test@example.com", "password": "strong-password-123"
        }, origin="http://public.example")[0], 403)

    def test_registration_requires_valid_human_challenge(self):
        status, _, _ = self.request("/api/auth/register", {
            "displayName": "Tester", "email": "test@example.com", "password": "strong-password-123",
            "turnstileToken": "invalid-token",
        })
        self.assertEqual(status, 400)
        self.assertEqual(self.sent_emails, [])
        self.assertIsNone(self.database.user_by_email("test@example.com"))

    def test_existing_user_table_gains_member_role(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy_path = Path(directory) / "legacy.sqlite3"
            with closing(sqlite3.connect(legacy_path)) as connection:
                with connection:
                    connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL)")
                    connection.execute("INSERT INTO users VALUES ('legacy-id', 'Legacy', 'legacy@example.com', 'hash', 1)")
            current_path = os.environ["NPUARENA_DB_PATH"]
            try:
                os.environ["NPUARENA_DB_PATH"] = str(legacy_path)
                migrated = Database()
                self.assertEqual(migrated.user_by_email("legacy@example.com")["role"], "member")
            finally:
                os.environ["NPUARENA_DB_PATH"] = current_path


if __name__ == "__main__":
    unittest.main()
