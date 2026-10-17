"""Account and session storage for NPUArena.

SQLite is the zero-dependency local default. Set DATABASE_URL to use PostgreSQL
when the site is deployed with a database service.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
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
            connection.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at BIGINT NOT NULL,
                    expires_at BIGINT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)")

    def create_user(self, display_name: str, email: str, password: str) -> dict:
        user = {"id": str(uuid.uuid4()), "displayName": display_name, "email": email}
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

    def user_by_email(self, email: str):
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT id, display_name, email, password_hash FROM users WHERE email = {self.placeholder}",
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
                f"""SELECT users.id, users.display_name, users.email
                    FROM sessions JOIN users ON users.id = sessions.user_id
                    WHERE sessions.token_hash = {self.placeholder} AND sessions.expires_at > {self.placeholder}""",
                (token_hash, int(time.time())),
            ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "displayName": row["display_name"], "email": row["email"]}

    def delete_session(self, token_hash: str) -> None:
        with self.connection() as connection:
            connection.execute(f"DELETE FROM sessions WHERE token_hash = {self.placeholder}", (token_hash,))

    def check(self) -> None:
        with self.connection() as connection:
            connection.execute("SELECT 1").fetchone()
