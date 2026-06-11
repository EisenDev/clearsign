from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    project_name: str
    backend_host: str
    backend_port: int
    cors_origins: list[str]
    storage_root: Path
    uploads_dir: Path
    processed_dir: Path
    job_db_path: Path
    celery_broker_url: str
    celery_result_backend: str
    celery_queue_name: str
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str
    r2_public_domain: str

    @property
    def backend_base_url(self) -> str:
        return f"http://{self.backend_host}:{self.backend_port}"


def _parse_cors_origins(raw_value: str | None) -> list[str]:
    if raw_value is None or raw_value.strip() == "":
        return ["http://127.0.0.1:3000", "http://localhost:3000"]
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def get_settings() -> Settings:
    backend_root = Path(__file__).resolve().parents[2]
    storage_root = backend_root / "storage"
    uploads_dir = storage_root / "uploads"
    processed_dir = storage_root / "processed"
    broker_dir = backend_root / ".celery"
    broker_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)

    default_broker_path = broker_dir / "broker.sqlite3"
    default_result_path = broker_dir / "results.sqlite3"

    return Settings(
        project_name=os.getenv("PROJECT_NAME", "AI Media Processor"),
        backend_host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        backend_port=int(os.getenv("BACKEND_PORT", "8000")),
        cors_origins=_parse_cors_origins(os.getenv("BACKEND_CORS_ORIGINS")),
        storage_root=storage_root,
        uploads_dir=uploads_dir,
        processed_dir=processed_dir,
        job_db_path=storage_root / "jobs.sqlite3",
        celery_broker_url=os.getenv(
            "CELERY_BROKER_URL",
            f"sqla+sqlite:///{default_broker_path}",
        ),
        celery_result_backend=os.getenv(
            "CELERY_RESULT_BACKEND",
            f"db+sqlite:///{default_result_path}",
        ),
        celery_queue_name=os.getenv("CELERY_QUEUE_NAME", "media"),
        r2_account_id=os.getenv("R2_ACCOUNT_ID", ""),
        r2_access_key_id=os.getenv("R2_ACCESS_KEY_ID", ""),
        r2_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY", ""),
        r2_bucket_name=os.getenv("R2_BUCKET_NAME", ""),
        r2_public_domain=os.getenv("R2_PUBLIC_DOMAIN", ""),
    )

