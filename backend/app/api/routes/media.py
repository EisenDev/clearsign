from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.job_store import JobStatus, create_job, get_job, list_jobs_by_user
from app.core.settings import get_settings
from app.workers.bg_removal import remove_background_task

router = APIRouter(prefix="/api/media", tags=["media"])
settings = get_settings()

RemovalMode = Literal["auto", "portrait", "product", "logo", "signature", "anime"]


class RemoveBackgroundRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    image_url: HttpUrl = Field(..., description="Publicly accessible URL for the source image.")
    user_id: str = Field(..., min_length=1, max_length=128)

    # Removal mode selects the AI model and post-processing pipeline
    mode: RemovalMode = Field(default="auto", description="Removal mode (auto, portrait, product, logo, signature, anime).")

    # Precision options
    alpha_matting: bool = Field(default=False, description="Enable alpha matting for fine edge detail (hair, fur).")
    shadow_removal: bool = Field(default=False, description="Detect and remove soft drop-shadows.")
    edge_feather: int = Field(default=0, ge=0, le=10, description="Gaussian blur radius to soften alpha edges (0 = off).")
    defringe: bool = Field(default=False, description="Remove colour halo fringing left by the original background.")


class RemoveBackgroundAcceptedResponse(BaseModel):
    job_id: str
    status: JobStatus


class JobStatusResponse(BaseModel):
    job_id: str
    user_id: str
    status: JobStatus
    input_url: str
    output_url: str | None = None
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class JobHistoryResponse(BaseModel):
    jobs: list[JobStatusResponse]


@router.post(
    "/uploads",
    status_code=status.HTTP_201_CREATED,
)
async def upload_source_image(file: UploadFile = File(...)) -> dict[str, str]:
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG, JPEG, and WebP uploads are supported.",
        )

    extension = Path(file.filename or "upload.bin").suffix or ".bin"
    object_name = f"{uuid4()}{extension.lower()}"
    destination = settings.uploads_dir / object_name
    file_bytes = await file.read()
    destination.write_bytes(file_bytes)

    return {
        "image_url": f"{settings.backend_base_url}/storage/uploads/{object_name}",
    }


@router.post(
    "/remove-background",
    response_model=RemoveBackgroundAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def enqueue_background_removal(
    payload: RemoveBackgroundRequest,
) -> RemoveBackgroundAcceptedResponse:
    job_id = str(uuid4())
    job_record = create_job(job_id=job_id, user_id=payload.user_id, input_url=str(payload.image_url))

    remove_background_task.delay(
        job_id=job_id,
        image_url=str(payload.image_url),
        mode=payload.mode,
        alpha_matting=payload.alpha_matting,
        shadow_removal=payload.shadow_removal,
        edge_feather=payload.edge_feather,
        defringe=payload.defringe,
    )

    return RemoveBackgroundAcceptedResponse(job_id=job_id, status=job_record.status)


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    status_code=status.HTTP_200_OK,
)
async def get_background_removal_job(job_id: str) -> JobStatusResponse:
    job_record = get_job(job_id)
    if job_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' was not found.",
        )

    return JobStatusResponse(**asdict(job_record))


@router.get(
    "/history",
    response_model=JobHistoryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_background_removal_history(
    user_id: str = Query(..., min_length=1, max_length=128),
    limit: int = 24,
) -> JobHistoryResponse:
    safe_limit = max(1, min(limit, 100))
    job_records = list_jobs_by_user(user_id=user_id, limit=safe_limit)
    return JobHistoryResponse(jobs=[JobStatusResponse(**asdict(job)) for job in job_records])
