import io
import json
import os
import unittest
from unittest.mock import patch

from human_verification import verify_turnstile


class TurnstileValidationTest(unittest.TestCase):
    def test_server_checks_success_hostname_and_action(self):
        def response_for(payload):
            return io.BytesIO(json.dumps(payload).encode("utf-8"))

        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}):
            valid = {"success": True, "hostname": "arena.example", "action": "register"}
            with patch("human_verification.urlopen", return_value=response_for(valid)) as call:
                self.assertTrue(verify_turnstile("browser-token", "192.0.2.1", "arena.example"))
                self.assertIn(b'"secret": "server-secret"', call.call_args.args[0].data)
            for changed in ({"success": False}, {"hostname": "evil.example"}, {"action": "login"}):
                with patch("human_verification.urlopen", return_value=response_for({**valid, **changed})):
                    self.assertFalse(verify_turnstile("browser-token", "192.0.2.1", "arena.example"))


if __name__ == "__main__":
    unittest.main()
