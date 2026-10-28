import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import http.cookiejar

from database import Database
from server import handler_for


class CommunitySubmissionTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = {key: os.environ.get(key) for key in ("NPUARENA_DB_PATH", "PUBLIC_ORIGIN", "PUBLIC_REGISTRATION_ENABLED", "TRUSTED_PROXY_IPS")}
        os.environ["NPUARENA_DB_PATH"] = str(Path(self.directory.name) / "test.sqlite3")
        os.environ.pop("PUBLIC_REGISTRATION_ENABLED", None)
        os.environ.pop("TRUSTED_PROXY_IPS", None)
        self.database = Database()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.database))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["PUBLIC_ORIGIN"] = self.origin
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.directory.cleanup()

    def request(self, path, payload=None, origin=None):
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json", "Origin": self.origin if origin is None else origin} if payload is not None else {}
        try:
            response = self.opener.open(Request(self.origin + path, data=body, headers=headers))
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    @staticmethod
    def proposal(email="person@example.com", **changes):
        return {"kind": "benchmark", "category": "training", "title": "CIFAR-10 NPU training",
                "summary": "Train CIFAR-10 on Ascend NPU and compare elapsed time at fixed accuracy.",
                "repoUrl": "https://github.com/example/cifar10-npu", "email": email,
                "hardware": "Ascend 910C", "metric": "seconds", "quality": "accuracy >= 96%", **changes}

    def test_anonymous_submission_moderation_receipt_and_privacy(self):
        self.assertEqual(self.request("/api/auth/register", self.proposal())[0], 404)
        status, created = self.request("/api/submissions", self.proposal())
        self.assertEqual(status, 202)
        receipt = created["receipt"]
        self.assertIsNone(self.database.user_by_email("person@example.com"))
        self.assertEqual(self.request("/api/submissions/public")[1]["submissions"], [])
        self.assertEqual(self.request("/api/submissions/receipt", {"receipt": receipt})[1]["submission"]["status"], "pending")
        self.assertEqual(self.request("/api/submissions/receipt/" + receipt)[0], 404)
        self.assertEqual(self.request("/api/submissions/receipt", {"receipt": receipt}, origin="https://evil.example")[0], 403)
        self.assertEqual(self.request("/api/admin/submissions")[0], 401)
        self.assertEqual(self.request("/api/admin/submissions/" + self.database.list_community_submissions()[0]["id"] + "/review", {"status": "approved"})[0], 401)

        self.database.create_admin("Admin", "admin@example.com", "long-admin-password-123")
        self.assertEqual(self.request("/api/auth/login", {"email": "admin@example.com", "password": "long-admin-password-123"})[0], 200)
        admin_item = self.request("/api/admin/submissions")[1]["submissions"][0]
        self.assertEqual(admin_item["email"], "person@example.com")
        review_path = "/api/admin/submissions/" + admin_item["id"] + "/review"
        self.assertEqual(self.request(review_path, {"status": "approved"}, origin="https://evil.example")[0], 403)
        self.assertEqual(self.request(review_path, {"status": "approved", "note": "Approved"})[0], 200)
        public = self.request("/api/submissions/public")[1]["submissions"]
        self.assertEqual(len(public), 1)
        self.assertNotIn("email", public[0])
        self.assertNotIn("reviewNote", public[0])
        self.assertNotIn("person@example.com", json.dumps(public))
        self.assertEqual(self.request("/api/submissions/receipt", {"receipt": receipt})[1]["submission"]["status"], "approved")
        self.assertEqual(self.request(review_path, {"status": "rejected", "note": "Need more data"})[0], 200)
        self.assertEqual(self.request("/api/submissions/public")[1]["submissions"], [])

    def test_email_two_hour_limit_and_invalid_content(self):
        self.assertEqual(self.request("/api/submissions", self.proposal(repoUrl="javascript:alert(1)"))[0], 400)
        self.assertEqual(self.request("/api/submissions", self.proposal())[0], 202)
        self.assertEqual(self.request("/api/submissions", self.proposal())[0], 429)
        self.assertEqual(self.request("/api/submissions", self.proposal(email="PERSON@EXAMPLE.COM"))[0], 429)
        self.assertEqual(self.request("/api/submissions", self.proposal(email="second@example.com"), origin="https://evil.example")[0], 403)
        self.assertEqual(len(self.database.list_community_submissions()), 1)
        self.assertNotIn("person@example.com", json.dumps(self.request("/api/submissions/receipt", {"receipt": "invalid"})[1]))

    def test_ip_and_global_quotas_persist(self):
        for index in range(4):
            status, _ = self.request("/api/submissions", self.proposal(email=f"user{index}@example.com"))
            self.assertEqual(status, 202)
        self.assertEqual(self.request("/api/submissions", self.proposal(email="fifth@example.com"))[0], 429)
        restarted = Database()
        self.assertIsNone(restarted.create_community_submission("next@example.com", "127.0.0.1", {
            "kind": "benchmark", "category": "training", "title": "Next", "summary": "A new benchmark idea",
            "repoUrl": "https://github.com/example/next", "hardware": "", "metric": "", "quality": "",
        }, "unique-hash"))

    def test_global_quota_and_honeypot_do_not_create_accounts(self):
        status, _ = self.request("/api/submissions", {**self.proposal(), "website": "spam.example"})
        self.assertEqual(status, 202)
        self.assertEqual(self.database.list_community_submissions(), [])
        payload = {"kind": "benchmark", "category": "training", "title": "Synthetic proposal",
                   "summary": "Synthetic proposal for quota testing", "repoUrl": "https://github.com/example/test",
                   "hardware": "", "metric": "", "quality": ""}
        for index in range(80):
            self.assertIsNotNone(self.database.create_community_submission(
                f"user{index}@example.invalid", f"192.0.2.{index}", payload, f"receipt-hash-{index}"))
        self.assertIsNone(Database().create_community_submission(
            "extra@example.invalid", "198.51.100.1", payload, "receipt-hash-extra"))
        self.assertIsNone(self.database.user_by_email("person@example.com"))


if __name__ == "__main__":
    unittest.main()
