from __future__ import annotations

import os

# Set environment variables for thread limits and fork safety before importing
# any libraries that utilize OpenMP, BLAS, or Numba.
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["NUMBA_THREADING_LAYER"] = "workqueue"

import io
import logging
from typing import Any, Final, cast
from urllib.parse import urlparse

import boto3
import numpy as np
import requests
from botocore.client import BaseClient
from botocore.config import Config
from celery import Celery
from celery.utils.log import get_task_logger
from PIL import Image
from rembg import new_session, remove

from app.core.job_store import update_job
from app.core.settings import get_settings

logger = cast(logging.Logger, get_task_logger(__name__))
settings = get_settings()
REQUEST_TIMEOUT_SECONDS: Final[float] = 30.0
DOCUMENT_WHITE_THRESHOLD: Final[int] = 235
DOCUMENT_DARK_THRESHOLD: Final[int] = 208
DOCUMENT_LOW_SATURATION_THRESHOLD: Final[int] = 42
DOCUMENT_BACKGROUND_PERCENTILE: Final[float] = 97.0
DOCUMENT_STROKE_MARGIN: Final[int] = 10
DOCUMENT_MAX_STROKE_GRAYSCALE: Final[int] = 245
DOCUMENT_STROKE_SATURATION_THRESHOLD: Final[int] = 72


def get_celery_app() -> Celery:
    celery_app = Celery(
        "media_processor",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
    celery_app.conf.update(
        task_default_queue=settings.celery_queue_name,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        task_track_started=True,
        timezone="UTC",
        enable_utc=True,
    )
    return celery_app


celery_app = get_celery_app()


def get_r2_client() -> BaseClient:
    if not all(
        [
            settings.r2_account_id,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket_name,
        ]
    ):
        raise RuntimeError("Missing one or more Cloudflare R2 environment variables.")

    endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def download_image_bytes(image_url: str) -> bytes:
    response = requests.get(image_url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.content


def build_output_object_key(job_id: str) -> str:
    return f"media/processed/{job_id}.png"


def build_public_output_url(object_key: str) -> str:
    public_domain = settings.r2_public_domain.rstrip("/")
    if public_domain:
        return f"{public_domain}/{object_key}"
    return object_key


def infer_source_filename(image_url: str, job_id: str) -> str:
    path = urlparse(image_url).path
    candidate = path.rsplit("/", maxsplit=1)[-1]
    return candidate or f"{job_id}.bin"


def upload_processed_png(job_id: str, png_bytes: bytes, source_url: str) -> str:
    if not all(
        [
            settings.r2_account_id,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket_name,
            settings.r2_public_domain,
        ]
    ):
        local_path = settings.processed_dir / f"{job_id}.png"
        local_path.write_bytes(png_bytes)
        return f"{settings.backend_base_url}/storage/processed/{job_id}.png"

    object_key = build_output_object_key(job_id)
    r2_client = get_r2_client()
    r2_client.upload_fileobj(
        Fileobj=io.BytesIO(png_bytes),
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        ExtraArgs={
            "ContentType": "image/png",
            "CacheControl": "public, max-age=31536000, immutable",
            "Metadata": {
                "job-id": job_id,
                "source-filename": infer_source_filename(source_url, job_id),
            },
        },
    )
    return build_public_output_url(object_key)


def is_document_like_image(rgb_array: np.ndarray) -> bool:
    grayscale = np.round(
        0.299 * rgb_array[:, :, 0] + 0.587 * rgb_array[:, :, 1] + 0.114 * rgb_array[:, :, 2]
    ).astype(np.uint8)
    rgb_max = np.max(rgb_array, axis=2)
    rgb_min = np.min(rgb_array, axis=2)
    saturation = rgb_max - rgb_min

    white_ratio = float(np.mean(grayscale >= DOCUMENT_WHITE_THRESHOLD))
    dark_ratio = float(np.mean(grayscale <= DOCUMENT_DARK_THRESHOLD))
    low_saturation_ratio = float(np.mean(saturation <= DOCUMENT_LOW_SATURATION_THRESHOLD))

    return white_ratio >= 0.45 and dark_ratio <= 0.35 and low_saturation_ratio >= 0.55


def preserve_document_strokes(source_image: bytes, processed_png: bytes) -> bytes:
    source = Image.open(io.BytesIO(source_image)).convert("RGBA")
    result = Image.open(io.BytesIO(processed_png)).convert("RGBA")

    source_rgba = np.asarray(source, dtype=np.uint8)
    result_rgba = np.asarray(result, dtype=np.uint8)
    source_rgb = source_rgba[:, :, :3]

    if not is_document_like_image(source_rgb):
        return processed_png

    grayscale = np.round(
        0.299 * source_rgb[:, :, 0] + 0.587 * source_rgb[:, :, 1] + 0.114 * source_rgb[:, :, 2]
    ).astype(np.uint8)
    rgb_max = np.max(source_rgb, axis=2)
    rgb_min = np.min(source_rgb, axis=2)
    saturation = rgb_max - rgb_min

    existing_alpha = result_rgba[:, :, 3].astype(np.uint8)

    # Estimate the page background dynamically so faint gray signatures are preserved
    # without turning the white paper opaque again.
    background_level = int(np.percentile(grayscale, DOCUMENT_BACKGROUND_PERCENTILE))
    dynamic_threshold = min(background_level - DOCUMENT_STROKE_MARGIN, DOCUMENT_MAX_STROKE_GRAYSCALE)

    if dynamic_threshold <= 0:
        return processed_png

    stroke_delta = np.clip(background_level - grayscale, 0, 255).astype(np.uint8)
    stroke_strength = np.clip(stroke_delta.astype(np.int16) * 12, 0, 255).astype(np.uint8)
    stroke_mask = (
        (grayscale <= dynamic_threshold)
        & (saturation <= DOCUMENT_STROKE_SATURATION_THRESHOLD)
        & (stroke_delta >= DOCUMENT_STROKE_MARGIN)
    )
    rescued_alpha = np.where(stroke_mask, np.maximum(existing_alpha, stroke_strength), existing_alpha).astype(
        np.uint8
    )

    final_rgba = result_rgba.copy()
    final_rgba[:, :, :3] = source_rgb
    final_rgba[:, :, 3] = rescued_alpha

    buffer = io.BytesIO()
    Image.fromarray(final_rgba, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


@celery_app.task(
    bind=True,
    name="app.workers.bg_removal.remove_background_task",
    autoretry_for=(requests.RequestException,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def remove_background_task(self: Any, job_id: str, image_url: str) -> dict[str, Any]:
    logger.info("Starting background removal job", extra={"job_id": job_id, "image_url": image_url})
    update_job(job_id, status="PROCESSING", error=None)

    # Use isnet-general-use (DIS) for high-accuracy segmentation of fine details
    # (e.g. signatures, logos, thin strokes). Alpha matting further sharpens edges.
    _session = new_session("isnet-general-use")

    try:
        source_image = download_image_bytes(image_url)
        processed_png = remove(
            source_image,
            session=_session,
            alpha_matting=False,
        )
        if not isinstance(processed_png, bytes):
            raise TypeError("rembg.remove returned an unexpected payload type.")
        processed_png = preserve_document_strokes(source_image, processed_png)

        output_url = upload_processed_png(job_id, processed_png, image_url)
        completed_record = update_job(
            job_id,
            status="COMPLETED",
            output_url=output_url,
            error=None,
        )
        result = {
            "job_id": completed_record.job_id,
            "status": completed_record.status,
            "output_url": completed_record.output_url,
            "updated_at": completed_record.updated_at,
        }
        logger.info("Background removal job completed", extra=result)
        return result
    except Exception as exc:
        logger.exception("Background removal job failed", extra={"job_id": job_id})
        failed_record = update_job(job_id, status="FAILED", error=str(exc))
        self.update_state(
            state="FAILURE",
            meta={
                "job_id": failed_record.job_id,
                "status": failed_record.status,
                "error": failed_record.error,
            },
        )
        raise
