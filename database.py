"""Account and session storage for NPUArena.

SQLite is the zero-dependency local default. Set DATABASE_URL to use PostgreSQL
when the site is deployed with a database service.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class DuplicateEmail(Exception):
    pass


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${_encode(salt)}${_encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = stored.split("$")
        if algorithm != "scrypt" or (int(n), int(r), int(p)) != (16384, 8, 1):
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=_decode(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(actual, _decode(expected))
    except (ValueError, TypeError):
        return False


class Database:
    def __init__(self) -> None:
        self.url = os.environ.get("DATABASE_URL", "").strip()
        self.kind = "postgresql" if self.url else "sqlite"
        if not self.url:
            configured = os.environ.get("NPUARENA_DB_PATH", "data/npuarena.sqlite3")
            self.path = Path(configured)
            if not self.path.is_absolute():
                self.path = ROOT / self.path
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.placeholder = "%s" if self.url else "?"
        self.initialize()

    @contextmanager
    def connection(self):
        if self.url:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as error:
                raise RuntimeError("PostgreSQL requires: pip install -r requirements.txt") from error
            connection = psycopg.connect(self.url, row_factory=dict_row)
        else:
            connection = sqlite3.connect(self.path, timeout=10)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at BIGINT NOT NULL
                )"""
            )
            if self.url:
                connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'")
            else:
                columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
                if "role" not in columns:
                    connection.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at BIGINT NOT NULL,
                    expires_at BIGINT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS pending_registrations (
                    email TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at BIGINT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS pending_registrations_expires_at_idx ON pending_registrations (expires_at)")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS rate_limit_events (
                    bucket_key TEXT NOT NULL,
                    created_at BIGINT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS rate_limit_events_key_time_idx ON rate_limit_events (bucket_key, created_at)")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS leaderboard_drafts (
                    id TEXT PRIMARY KEY,
                    data_json TEXT NOT NULL,
                    created_by TEXT NOT NULL REFERENCES users(id),
                    created_at BIGINT NOT NULL,
                    updated_at BIGINT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS community_submissions (
                    id TEXT PRIMARY KEY,
                    receipt_hash TEXT NOT NULL UNIQUE,
                    email TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    review_note TEXT NOT NULL DEFAULT '',
                    created_at BIGINT NOT NULL,
                    updated_at BIGINT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS community_submissions_status_idx ON community_submissions (status, created_at)")

    def create_user(self, display_name: str, email: str, password: str) -> dict:
        user = {"id": str(uuid.uuid4()), "displayName": display_name, "email": email, "role": "member"}
        password_hash = hash_password(password)
        try:
            with self.connection() as connection:
                connection.execute(
                    f"INSERT INTO users (id, display_name, email, password_hash, created_at) VALUES ({','.join([self.placeholder] * 5)})",
                    (user["id"], display_name, email, password_hash, int(time.time())),
                )
        except Exception as error:
            if isinstance(error, sqlite3.IntegrityError) or getattr(error, "sqlstate", None) == "23505":
                raise DuplicateEmail from error
            raise
        return user

    def create_admin(self, display_name: str, email: str, password: str) -> dict:
        user = {"id": str(uuid.uuid4()), "displayName": display_name, "email": email.strip().lower(), "role": "admin"}
        password_hash = hash_password(password)
        try:
            with self.connection() as connection:
                connection.execute(
                    f"INSERT INTO users (id, display_name, email, password_hash, created_at, role) VALUES ({','.join([self.placeholder] * 6)})",
                    (user["id"], display_name, user["email"], password_hash, int(time.time()), "admin"),
                )
        except Exception as error:
            if isinstance(error, sqlite3.IntegrityError) or getattr(error, "sqlstate", None) == "23505":
                raise DuplicateEmail from error
            raise
        return user

    def reset_admin_password(self, email: str, password: str) -> bool:
        """Replace an administrator password and revoke all existing sessions."""
        password_hash = hash_password(password)
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT id FROM users WHERE email = {self.placeholder} AND role = 'admin'",
                (email.strip().lower(),),
            ).fetchone()
            if not row:
                return False
            user_id = row["id"]
            connection.execute(
                f"UPDATE users SET password_hash = {self.placeholder} WHERE id = {self.placeholder}",
                (password_hash, user_id),
            )
            connection.execute(
                f"DELETE FROM sessions WHERE user_id = {self.placeholder}",
                (user_id,),
            )
        return True

    def user_by_email(self, email: str):
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT id, display_name, email, password_hash, role FROM users WHERE email = {self.placeholder}",
                (email,),
            ).fetchone()
        return dict(row) if row else None

    def create_session(self, token_hash: str, user_id: str, lifetime_seconds: int) -> None:
        now = int(time.time())
        with self.connection() as connection:
            connection.execute(
                f"INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ({','.join([self.placeholder] * 4)})",
                (token_hash, user_id, now, now + lifetime_seconds),
            )
            connection.execute(f"DELETE FROM sessions WHERE expires_at <= {self.placeholder}", (now,))

    def user_by_session(self, token_hash: str):
        with self.connection() as connection:
            row = connection.execute(
                f"""SELECT users.id, users.display_name, users.email, users.role
                    FROM sessions JOIN users ON users.id = sessions.user_id
                    WHERE sessions.token_hash = {self.placeholder} AND sessions.expires_at > {self.placeholder}""",
                (token_hash, int(time.time())),
            ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "displayName": row["display_name"], "email": row["email"], "role": row["role"]}

    def set_user_role(self, email: str, role: str) -> bool:
        if role not in {"member", "admin"}:
            raise ValueError("Invalid role")
        with self.connection() as connection:
            cursor = connection.execute(
                f"UPDATE users SET role = {self.placeholder} WHERE email = {self.placeholder}",
                (role, email.strip().lower()),
            )
            return cursor.rowcount == 1

    def registration_allowed(self, ip: str, email: str) -> bool:
        now = int(time.time())
        domain = email.rsplit("@", 1)[-1]
        rules = [
            (f"register:ip:{ip}", 15 * 60, 5),
            (f"register:email:{email}", 60 * 60, 3),
            (f"register:domain:{domain}", 24 * 60 * 60, 20),
            ("register:global", 24 * 60 * 60, 30),
        ]
        with self.connection() as connection:
            if self.kind == "sqlite":
                connection.execute("BEGIN IMMEDIATE")
            else:
                connection.execute("SELECT pg_advisory_xact_lock(76191001)")
            connection.execute(f"DELETE FROM rate_limit_events WHERE created_at < {self.placeholder}", (now - 24 * 60 * 60,))
            for key, window, limit in rules:
                row = connection.execute(
                    f"SELECT COUNT(*) AS event_count FROM rate_limit_events WHERE bucket_key = {self.placeholder} AND created_at > {self.placeholder}",
                    (key, now - window),
                ).fetchone()
                count = row[0] if self.kind == "sqlite" else row["event_count"]
                if count >= limit:
                    return False
            for key, _, _ in rules:
                connection.execute(
                    f"INSERT INTO rate_limit_events (bucket_key, created_at) VALUES ({self.placeholder}, {self.placeholder})",
                    (key, now),
                )
        return True

    def reserve_login_attempt(self, ip: str) -> bool:
        """Persist IP and site-wide login limits before password hashing."""
        now = int(time.time())
        rules = [(f"login:ip:{ip}", 12), ("login:global", 120)]
        with self.connection() as connection:
            if self.kind == "sqlite":
                connection.execute("BEGIN IMMEDIATE")
            else:
                connection.execute("SELECT pg_advisory_xact_lock(76191003)")
            connection.execute(f"DELETE FROM rate_limit_events WHERE created_at < {self.placeholder}", (now - 24 * 60 * 60,))
            for key, limit in rules:
                row = connection.execute(
                    f"SELECT COUNT(*) AS event_count FROM rate_limit_events WHERE bucket_key = {self.placeholder} AND created_at > {self.placeholder}",
                    (key, now - 15 * 60),
                ).fetchone()
                if (row[0] if self.kind == "sqlite" else row["event_count"]) >= limit:
                    return False
            for key, _ in rules:
                connection.execute(
                    f"INSERT INTO rate_limit_events (bucket_key, created_at) VALUES ({self.placeholder}, {self.placeholder})",
                    (key, now),
                )
        return True

    @staticmethod
    def _login_email_key(email: str) -> str:
        return "login:failed:" + hashlib.sha256(email.encode("utf-8")).hexdigest()

    def record_failed_login(self, email: str) -> bool:
        """Return False when this account has reached its failure threshold."""
        now = int(time.time())
        key = self._login_email_key(email)
        with self.connection() as connection:
            if self.kind == "sqlite":
                connection.execute("BEGIN IMMEDIATE")
            else:
                connection.execute("SELECT pg_advisory_xact_lock(76191004)")
            row = connection.execute(
                f"SELECT COUNT(*) AS event_count FROM rate_limit_events WHERE bucket_key = {self.placeholder} AND created_at > {self.placeholder}",
                (key, now - 15 * 60),
            ).fetchone()
            if (row[0] if self.kind == "sqlite" else row["event_count"]) >= 12:
                return False
            connection.execute(
                f"INSERT INTO rate_limit_events (bucket_key, created_at) VALUES ({self.placeholder}, {self.placeholder})",
                (key, now),
            )
        return True

    def clear_login_failures(self, email: str, ip: str) -> None:
        """A successful admin login resets this account and source IP's counters."""
        with self.connection() as connection:
            connection.execute(
                f"DELETE FROM rate_limit_events WHERE bucket_key IN ({self.placeholder}, {self.placeholder})",
                (self._login_email_key(email), f"login:ip:{ip}"),
            )

    def create_community_submission(self, email: str, ip: str, payload: dict, receipt_hash: str) -> dict | None:
        """Atomically enforce quotas and save a proposal; None means rate limited."""
        now = int(time.time())
        rules = [
            (f"proposal:ip:{ip}", 2 * 60 * 60, 4),
            (f"proposal:ip-day:{ip}", 24 * 60 * 60, 12),
        ]
        item = {"id": str(uuid.uuid4()), **payload, "status": "pending", "createdAt": now, "updatedAt": now}
        with self.connection() as connection:
            if self.kind == "sqlite":
                connection.execute("BEGIN IMMEDIATE")
            else:
                connection.execute("SELECT pg_advisory_xact_lock(76191002)")
            connection.execute(f"DELETE FROM rate_limit_events WHERE created_at < {self.placeholder}", (now - 24 * 60 * 60,))
            for key, window, limit in rules:
                row = connection.execute(
                    f"SELECT COUNT(*) AS event_count FROM rate_limit_events WHERE bucket_key = {self.placeholder} AND created_at > {self.placeholder}",
                    (key, now - window),
                ).fetchone()
                count = row[0] if self.kind == "sqlite" else row["event_count"]
                if count >= limit:
                    return None
            connection.execute(
                f"INSERT INTO community_submissions (id, receipt_hash, email, payload_json, status, created_at, updated_at) VALUES ({','.join([self.placeholder] * 7)})",
                (item["id"], receipt_hash, email, json.dumps(payload, ensure_ascii=False), "pending", now, now),
            )
            for key, _, _ in rules:
                connection.execute(
                    f"INSERT INTO rate_limit_events (bucket_key, created_at) VALUES ({self.placeholder}, {self.placeholder})",
                    (key, now),
                )
        return item

    @staticmethod
    def _submission(row, include_email: bool = False) -> dict:
        payload = json.loads(row["payload_json"])
        result = {"id": row["id"], **payload, "status": row["status"],
                  "reviewNote": row["review_note"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]}
        if include_email:
            result["email"] = row["email"]
        return result

    def list_community_submissions(self, public_only: bool = False) -> list[dict]:
        with self.connection() as connection:
            if public_only:
                rows = connection.execute("SELECT * FROM community_submissions WHERE status = 'approved' ORDER BY updated_at DESC").fetchall()
            else:
                rows = connection.execute("SELECT * FROM community_submissions ORDER BY created_at DESC").fetchall()
        items = [self._submission(row, include_email=not public_only) for row in rows]
        if public_only:
            for item in items:
                item.pop("reviewNote", None)
        return items

    def community_submission_by_receipt(self, receipt_hash: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT * FROM community_submissions WHERE receipt_hash = {self.placeholder}", (receipt_hash,)
            ).fetchone()
        return self._submission(row) if row else None

    def review_community_submission(self, submission_id: str, status: str, note: str) -> dict | None:
        if status not in {"approved", "rejected"}:
            raise ValueError("Invalid review status")
        now = int(time.time())
        with self.connection() as connection:
            cursor = connection.execute(
                f"UPDATE community_submissions SET status = {self.placeholder}, review_note = {self.placeholder}, updated_at = {self.placeholder} WHERE id = {self.placeholder}",
                (status, note, now, submission_id),
            )
            if cursor.rowcount != 1:
                return None
            row = connection.execute(
                f"SELECT * FROM community_submissions WHERE id = {self.placeholder}", (submission_id,)
            ).fetchone()
        return self._submission(row, include_email=True)

    def save_pending_registration(self, display_name: str, email: str, password_hash: str, token_hash: str, lifetime_seconds: int) -> None:
        expires_at = int(time.time()) + lifetime_seconds
        with self.connection() as connection:
            connection.execute(
                f"""INSERT INTO pending_registrations (email, display_name, password_hash, token_hash, expires_at)
                    VALUES ({','.join([self.placeholder] * 5)})
                    ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name,
                    password_hash = EXCLUDED.password_hash, token_hash = EXCLUDED.token_hash,
                    expires_at = EXCLUDED.expires_at""",
                (email, display_name, password_hash, token_hash, expires_at),
            )
            connection.execute(f"DELETE FROM pending_registrations WHERE expires_at <= {self.placeholder}", (int(time.time()),))

    def consume_pending_registration(self, token_hash: str) -> dict | None:
        now = int(time.time())
        try:
            with self.connection() as connection:
                if self.kind == "sqlite":
                    connection.execute("BEGIN IMMEDIATE")
                query = f"SELECT email, display_name, password_hash FROM pending_registrations WHERE token_hash = {self.placeholder} AND expires_at > {self.placeholder}"
                if self.kind == "postgresql":
                    query += " FOR UPDATE"
                row = connection.execute(query, (token_hash, now)).fetchone()
                if not row:
                    return None
                user = {"id": str(uuid.uuid4()), "displayName": row["display_name"], "email": row["email"], "role": "member"}
                connection.execute(
                    f"INSERT INTO users (id, display_name, email, password_hash, created_at) VALUES ({','.join([self.placeholder] * 5)})",
                    (user["id"], user["displayName"], user["email"], row["password_hash"], now),
                )
                connection.execute(f"DELETE FROM pending_registrations WHERE token_hash = {self.placeholder}", (token_hash,))
                return user
        except Exception as error:
            if isinstance(error, sqlite3.IntegrityError) or getattr(error, "sqlstate", None) == "23505":
                return None
            raise

    def list_leaderboard_drafts(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute("SELECT data_json FROM leaderboard_drafts ORDER BY updated_at DESC").fetchall()
        return [json.loads(row["data_json"]) for row in rows]

    def leaderboard_draft(self, draft_id: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT data_json FROM leaderboard_drafts WHERE id = {self.placeholder}", (draft_id,)
            ).fetchone()
        return json.loads(row["data_json"]) if row else None

    def save_leaderboard_draft(self, data: dict, user_id: str, draft_id: str | None = None) -> dict | None:
        now = int(time.time())
        with self.connection() as connection:
            if draft_id:
                row = connection.execute(
                    f"SELECT data_json FROM leaderboard_drafts WHERE id = {self.placeholder}", (draft_id,)
                ).fetchone()
                if not row:
                    return None
                original = json.loads(row["data_json"])
                item = {**data, "id": draft_id, "createdAt": original["createdAt"], "updatedAt": now}
                connection.execute(
                    f"UPDATE leaderboard_drafts SET data_json = {self.placeholder}, updated_at = {self.placeholder} WHERE id = {self.placeholder}",
                    (json.dumps(item, ensure_ascii=False), now, draft_id),
                )
            else:
                draft_id = str(uuid.uuid4())
                item = {**data, "id": draft_id, "createdAt": now, "updatedAt": now}
                connection.execute(
                    f"INSERT INTO leaderboard_drafts (id, data_json, created_by, created_at, updated_at) VALUES ({','.join([self.placeholder] * 5)})",
                    (draft_id, json.dumps(item, ensure_ascii=False), user_id, now, now),
                )
        return item

    def delete_leaderboard_draft(self, draft_id: str) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                f"DELETE FROM leaderboard_drafts WHERE id = {self.placeholder}", (draft_id,)
            )
            return cursor.rowcount == 1

    def delete_session(self, token_hash: str) -> None:
        with self.connection() as connection:
            connection.execute(f"DELETE FROM sessions WHERE token_hash = {self.placeholder}", (token_hash,))

    def check(self) -> None:
        with self.connection() as connection:
            connection.execute("SELECT 1").fetchone()
