import http.cookiejar
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from database import Database
from server import handler_for


class AccountApiTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("NPUARENA_DB_PATH")
        os.environ["NPUARENA_DB_PATH"] = str(Path(self.temporary.name) / "accounts.sqlite3")
        self.cookies = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.start_server()

    def tearDown(self):
        self.stop_server()
        if self.previous_path is None:
            os.environ.pop("NPUARENA_DB_PATH", None)
        else:
            os.environ["NPUARENA_DB_PATH"] = self.previous_path
        self.temporary.cleanup()

    def start_server(self):
        self.database = Database()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.database))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, path, payload=None, origin=None):
        headers = {}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers = {"Content-Type": "application/json", "Origin": origin or self.origin}
        request = Request(self.origin + path, data=body, headers=headers)
        try:
            response = self.opener.open(request)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            return response.status, json.loads(content) if path.startswith("/api/") else content.decode(), response.headers

    def test_registration_survives_server_restart_and_logout_revokes_session(self):
        status, result, headers = self.request(
            "/api/auth/register",
            {"displayName": "NPU Tester", "email": "TEST@example.com", "password": "strong-password-123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["email"], "test@example.com")
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
        self.assertEqual(self.request("/api/auth/login", {"email": "test@example.com", "password": "strong-password-123"})[0], 200)

    def test_duplicate_login_failure_and_cross_origin_request(self):
        account = {"displayName": "Tester", "email": "test@example.com", "password": "strong-password-123"}
        self.assertEqual(self.request("/api/auth/register", account)[0], 200)
        self.assertEqual(self.request("/api/auth/register", account)[0], 409)
        self.assertEqual(self.request("/api/auth/login", {"email": account["email"], "password": "wrong-password"})[0], 401)
        self.assertEqual(self.request("/api/auth/logout", {}, origin="https://evil.example")[0], 403)
        self.assertIsNotNone(self.request("/api/auth/me")[1]["user"])


if __name__ == "__main__":
    unittest.main()
