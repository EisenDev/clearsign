from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.media import router as media_router
from app.core.settings import get_settings
from p12_generator.router import router as p12_router

class CORSStaticFiles(StaticFiles):
    async def __call__(self, scope, receive, send) -> None:
        async def send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"access-control-allow-origin", b"*"))
                headers.append((b"access-control-allow-methods", b"GET, OPTIONS"))
                headers.append((b"access-control-allow-headers", b"*"))
                message["headers"] = headers
            await send(message)
        await super().__call__(scope, receive, send_wrapper)


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
app.include_router(p12_router)
app.mount("/storage", CORSStaticFiles(directory=Path(settings.storage_root)), name="storage")


@app.get("/api/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}

