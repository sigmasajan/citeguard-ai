"""Database and authentication management using SQLite.

Manages users, authentication sessions (tokens), and saved citation verification analyses.
Zero external database dependencies required.
"""

from typing import Dict, List, Any, Optional, Tuple
import os
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "citeguard.db"


def get_connection() -> sqlite3.Connection:
    """Get a SQLite database connection with row factory enabled."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    """Initialize database tables for users, sessions, and analysis history."""
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                paper_title TEXT NOT NULL,
                document_text TEXT NOT NULL,
                total_claims INTEGER NOT NULL,
                supported INTEGER NOT NULL,
                weakly_supported INTEGER NOT NULL,
                mismatched INTEGER NOT NULL,
                unverifiable INTEGER NOT NULL,
                results_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
            CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
            """
        )


def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """Securely hash a password with PBKDF2-HMAC-SHA256."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations=100000,
    ).hex()
    return hashed, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """Verify whether a candidate password matches the stored hash."""
    test_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(test_hash, password_hash)


def create_user(username: str, email: str, password: str) -> Dict[str, Any]:
    """Register a new user account.

    Raises:
        ValueError: If username or email is already registered or inputs are invalid.
    """
    clean_username = username.strip()
    clean_email = email.strip().lower()

    if len(clean_username) < 3:
        raise ValueError("Username must be at least 3 characters long.")
    if "@" not in clean_email or "." not in clean_email:
        raise ValueError("Please provide a valid email address.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters long.")

    password_hash, salt = hash_password(password)
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO users (username, email, password_hash, salt, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (clean_username, clean_email, password_hash, salt, now_iso),
            )
            user_id = cursor.lastrowid
            conn.commit()
            return {
                "id": user_id,
                "username": clean_username,
                "email": clean_email,
                "created_at": now_iso,
            }
    except sqlite3.IntegrityError as exc:
        err_msg = str(exc).lower()
        if "users.username" in err_msg or "unique constraint failed: users.username" in err_msg:
            raise ValueError(f"Username '{clean_username}' is already taken.") from exc
        if "users.email" in err_msg or "unique constraint failed: users.email" in err_msg:
            raise ValueError(f"Email '{clean_email}' is already registered.") from exc
        raise ValueError("User registration failed: username or email already exists.") from exc


def authenticate_user(username_or_email: str, password: str) -> Optional[Dict[str, Any]]:
    """Verify credentials and return user record if valid."""
    clean_identifier = username_or_email.strip().lower()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, username, email, password_hash, salt, created_at
            FROM users
            WHERE LOWER(username) = ? OR LOWER(email) = ?
            """,
            (clean_identifier, clean_identifier),
        )
        row = cursor.fetchone()
        if not row:
            return None

        if verify_password(password, row["password_hash"], row["salt"]):
            return {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "created_at": row["created_at"],
            }
    return None


def create_session(user_id: int, days: int = 30) -> str:
    """Generate and store an authentication session token."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=days)

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (token, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token, user_id, now.isoformat(), expires.isoformat()),
        )
        conn.commit()
    return token


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """Retrieve the user associated with a valid, non-expired session token."""
    if not token:
        return None

    clean_token = token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    now_iso = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT u.id, u.username, u.email, u.created_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (clean_token, now_iso),
        )
        row = cursor.fetchone()
        if row:
            return {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "created_at": row["created_at"],
            }
    return None


def delete_session(token: str) -> bool:
    """Remove a session token (logout)."""
    clean_token = token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (clean_token,))
        conn.commit()
        return cursor.rowcount > 0


def save_analysis(
    user_id: int,
    paper_title: str,
    document_text: str,
    summary: Dict[str, Any],
    results: List[Dict[str, Any]],
) -> int:
    """Persist an analysis session tied to a user account."""
    import json

    now_iso = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO analyses (
                user_id, paper_title, document_text,
                total_claims, supported, weakly_supported, mismatched, unverifiable,
                results_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                paper_title or "Untitled Document",
                document_text,
                summary.get("total_claims", len(results)),
                summary.get("supported", 0),
                summary.get("weakly_supported", 0),
                summary.get("mismatched", 0),
                summary.get("unverifiable", 0),
                json.dumps(results),
                now_iso,
            ),
        )
        conn.commit()
        return cursor.lastrowid


def get_user_analyses(user_id: int) -> List[Dict[str, Any]]:
    """Get list of past analyses for a user, sorted newest first."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, paper_title, total_claims, supported, weakly_supported, mismatched, unverifiable, created_at
            FROM analyses
            WHERE user_id = ?
            ORDER BY id DESC
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        analyses = []
        for r in rows:
            analyses.append(
                {
                    "id": r["id"],
                    "paper_title": r["paper_title"],
                    "created_at": r["created_at"],
                    "summary": {
                        "total_claims": r["total_claims"],
                        "supported": r["supported"],
                        "weakly_supported": r["weakly_supported"],
                        "mismatched": r["mismatched"],
                        "unverifiable": r["unverifiable"],
                    },
                }
            )
        return analyses


def get_analysis_by_id(analysis_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve full analysis report by ID for a specific user."""
    import json

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, paper_title, document_text, total_claims, supported, weakly_supported, mismatched, unverifiable, results_json, created_at
            FROM analyses
            WHERE id = ? AND user_id = ?
            """,
            (analysis_id, user_id),
        )
        row = cursor.fetchone()
        if not row:
            return None

        try:
            results_data = json.loads(row["results_json"])
        except Exception:
            results_data = []

        return {
            "id": row["id"],
            "paper_title": row["paper_title"],
            "document_text": row["document_text"],
            "created_at": row["created_at"],
            "summary": {
                "total_claims": row["total_claims"],
                "supported": row["supported"],
                "weakly_supported": row["weakly_supported"],
                "mismatched": row["mismatched"],
                "unverifiable": row["unverifiable"],
            },
            "results": results_data,
        }


def delete_analysis(analysis_id: int, user_id: int) -> bool:
    """Delete an analysis report owned by the user."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM analyses WHERE id = ? AND user_id = ?", (analysis_id, user_id))
        conn.commit()
        return cursor.rowcount > 0


# Initialize tables when module is imported
init_db()
