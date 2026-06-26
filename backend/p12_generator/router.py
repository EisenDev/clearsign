"""
P12 Generator – Router Adapter
Wraps the standalone p12_generator/main.py FastAPI app into an APIRouter
so it can be mounted in the main backend without touching the original code.
"""
from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

# Import business logic directly from the standalone app (exact, unmodified)
from p12_generator.main import P12GenerationRequest, generate_p12 as _generate_p12

router = APIRouter(prefix="/api/p12", tags=["P12 Generator"])


@router.post("/generate")
def generate_p12_route(data: P12GenerationRequest):
    """
    Proxy to the standalone generate_p12 handler.
    Exposed as POST /api/p12/generate
    """
    return _generate_p12(data)


@router.get("/health")
def p12_health():
    import datetime
    return {
        "status": "healthy",
        "service": "p12-generator",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
