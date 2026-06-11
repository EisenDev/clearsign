from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.core.settings import get_settings

JobStatus = Literal["PENDING", "PROCESSING", "COMPLETED", "FAILED"]


@dataclass(frozen=True, slots=True)
class JobRecord:
    job_id: str
    user_id: str
    status: JobStatus
    input_url: str
    output_url: str | None = None
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


def utc_now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _get_connection() -> sqlite3.Connection:
    settings = get_settings()
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.job_db_path)
    connection.row_factory = sqlite3.Row
    _ensure_schema(connection)
    return connection


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            input_url TEXT NOT NULL,
            output_url TEXT,
            error TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    connection.commit()


def create_job(job_id: str, user_id: str, input_url: str) -> JobRecord:
    timestamp = utc_now_iso()
    record = JobRecord(
        job_id=job_id,
        user_id=user_id,
        status="PENDING",
        input_url=input_url,
        created_at=timestamp,
        updated_at=timestamp,
    )
    with _get_connection() as connection:
        connection.execute(
            """
            INSERT INTO jobs (job_id, user_id, status, input_url, output_url, error, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.job_id,
                record.user_id,
                record.status,
                record.input_url,
                record.output_url,
                record.error,
                record.created_at,
                record.updated_at,
            ),
        )
        connection.commit()
    return record


def get_job(job_id: str) -> JobRecord | None:
    with _get_connection() as connection:
        row = connection.execute(
            """
            SELECT job_id, user_id, status, input_url, output_url, error, created_at, updated_at
            FROM jobs
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
    if row is None:
        return None
    return JobRecord(
        job_id=row["job_id"],
        user_id=row["user_id"],
        status=row["status"],
        input_url=row["input_url"],
        output_url=row["output_url"],
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def update_job(
    job_id: str,
    *,
    status: JobStatus,
    output_url: str | None = None,
    error: str | None = None,
) -> JobRecord:
    existing = get_job(job_id)
    if existing is None:
        raise ValueError(f"Job '{job_id}' was not found.")

    updated = JobRecord(
        job_id=existing.job_id,
        user_id=existing.user_id,
        status=status,
        input_url=existing.input_url,
        output_url=output_url if output_url is not None else existing.output_url,
        error=error,
        created_at=existing.created_at,
        updated_at=utc_now_iso(),
    )

    with _get_connection() as connection:
        connection.execute(
            """
            UPDATE jobs
            SET status = ?, output_url = ?, error = ?, updated_at = ?
            WHERE job_id = ?
            """,
            (
                updated.status,
                updated.output_url,
                updated.error,
                updated.updated_at,
                updated.job_id,
            ),
        )
        connection.commit()
    return updated


def delete_job(job_id: str) -> bool:
    with _get_connection() as connection:
        cursor = connection.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        connection.commit()
        return cursor.rowcount > 0


def delete_jobs(job_ids: list[str]) -> int:
    if not job_ids:
        return 0
    with _get_connection() as connection:
        # SQLite maximum parameters is 999, which is plenty for history batch deletion.
        placeholders = ",".join("?" for _ in job_ids)
        cursor = connection.execute(
            f"DELETE FROM jobs WHERE job_id IN ({placeholders})",
            job_ids,
        )
        connection.commit()
        return cursor.rowcount


def list_jobs_by_user(user_id: str, *, page: int = 1, limit: int = 20) -> tuple[list[JobRecord], int]:
    offset = (page - 1) * limit
    with _get_connection() as connection:
        count_row = connection.execute(
            "SELECT COUNT(*) as total FROM jobs WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        total_count = count_row["total"] if count_row else 0

        rows = connection.execute(
            """
            SELECT job_id, user_id, status, input_url, output_url, error, created_at, updated_at
            FROM jobs
            WHERE user_id = ?
            ORDER BY COALESCE(updated_at, created_at) DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, limit, offset),
        ).fetchall()

    jobs = [
        JobRecord(
            job_id=row["job_id"],
            user_id=row["user_id"],
            status=row["status"],
            input_url=row["input_url"],
            output_url=row["output_url"],
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]
    return jobs, total_count

