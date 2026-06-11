from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.job_store import JobStatus, create_job, get_job, list_jobs_by_user, delete_job, delete_jobs, update_job
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
    total_jobs: int
    total_pages: int
    page: int
    limit: int


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
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> JobHistoryResponse:
    job_records, total_count = list_jobs_by_user(user_id=user_id, page=page, limit=limit)
    import math
    total_pages = math.ceil(total_count / limit)
    return JobHistoryResponse(
        jobs=[JobStatusResponse(**asdict(job)) for job in job_records],
        total_jobs=total_count,
        total_pages=total_pages,
        page=page,
        limit=limit,
    )


@router.delete(
    "/jobs/{job_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_background_removal_job(job_id: str) -> dict[str, str]:
    # Try to delete the local file if it exists
    settings = get_settings()
    local_path = settings.processed_dir / f"{job_id}.png"
    try:
        if local_path.exists():
            local_path.unlink()
    except Exception:
        pass

    deleted = delete_job(job_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' was not found.",
        )
    return {"detail": f"Job '{job_id}' has been deleted."}


class BatchDeleteRequest(BaseModel):
    job_ids: list[str]


@router.post(
    "/jobs/batch-delete",
    status_code=status.HTTP_200_OK,
)
async def batch_delete_jobs(payload: BatchDeleteRequest) -> dict[str, str]:
    settings = get_settings()
    for job_id in payload.job_ids:
        local_path = settings.processed_dir / f"{job_id}.png"
        try:
            if local_path.exists():
                local_path.unlink()
        except Exception:
            pass
    deleted_count = delete_jobs(payload.job_ids)
    return {"detail": f"Successfully deleted {deleted_count} jobs."}


@router.post(
    "/jobs/{job_id}/refine",
    response_model=JobStatusResponse,
    status_code=status.HTTP_200_OK,
)
async def refine_job_output(
    job_id: str,
    file: UploadFile = File(...),
) -> JobStatusResponse:
    job_record = get_job(job_id)
    if job_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' was not found.",
        )

    if file.content_type != "image/png":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refined output must be a PNG image.",
        )

    file_bytes = await file.read()

    # Upload or save locally
    if not all([
        settings.r2_account_id,
        settings.r2_access_key_id,
        settings.r2_secret_access_key,
        settings.r2_bucket_name,
        settings.r2_public_domain,
    ]):
        local_path = settings.processed_dir / f"{job_id}.png"
        local_path.write_bytes(file_bytes)
        output_url = f"{settings.backend_base_url}/storage/processed/{job_id}.png"
    else:
        from app.workers.bg_removal import build_output_object_key, get_r2_client, build_public_output_url, infer_source_filename
        import io
        object_key = build_output_object_key(job_id)
        r2_client = get_r2_client()
        r2_client.upload_fileobj(
            Fileobj=io.BytesIO(file_bytes),
            Bucket=settings.r2_bucket_name,
            Key=object_key,
            ExtraArgs={
                "ContentType": "image/png",
                "CacheControl": "public, max-age=31536000, immutable",
                "Metadata": {
                    "job-id": job_id,
                    "source-filename": infer_source_filename(job_record.input_url, job_id),
                    "refined": "true",
                },
            },
        )
        output_url = build_public_output_url(object_key)

    # Update the job record
    updated_record = update_job(
        job_id=job_id,
        status="COMPLETED",
        output_url=output_url,
    )

    return JobStatusResponse(**asdict(updated_record))

