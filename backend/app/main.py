from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.media import router as media_router
from app.core.settings import get_settings

settings = get_settings()

app = FastAPI(title=settings.project_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media_router)
app.mount("/storage", StaticFiles(directory=Path(settings.storage_root)), name="storage")


@app.get("/api/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
