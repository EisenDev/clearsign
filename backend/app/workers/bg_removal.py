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
from PIL import Image, ImageFilter
from rembg import new_session, remove

from app.core.job_store import update_job
from app.core.settings import get_settings

logger = cast(logging.Logger, get_task_logger(__name__))
settings = get_settings()
REQUEST_TIMEOUT_SECONDS: Final[float] = 30.0

# Document / signature detection thresholds
DOCUMENT_WHITE_THRESHOLD: Final[int] = 235
DOCUMENT_DARK_THRESHOLD: Final[int] = 208
DOCUMENT_LOW_SATURATION_THRESHOLD: Final[int] = 42
DOCUMENT_BACKGROUND_PERCENTILE: Final[float] = 97.0
DOCUMENT_STROKE_MARGIN: Final[int] = 10
DOCUMENT_MAX_STROKE_GRAYSCALE: Final[int] = 245
DOCUMENT_STROKE_SATURATION_THRESHOLD: Final[int] = 72

# Removal mode → rembg model mapping
MODE_MODEL_MAP: Final[dict[str, str]] = {
    "auto": "isnet-general-use",
    "portrait": "u2net_human_seg",
    "product": "u2net",
    "logo": "isnet-general-use",
    "signature": "isnet-general-use",
    "anime": "isnet_anime",
}


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


# ──────────────────────────────────────────────────────────────────────────────
# Document / Signature helpers
# ──────────────────────────────────────────────────────────────────────────────

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
    rescued_alpha = np.where(
        stroke_mask, np.maximum(existing_alpha, stroke_strength), existing_alpha
    ).astype(np.uint8)

    final_rgba = result_rgba.copy()
    final_rgba[:, :, :3] = source_rgb
    final_rgba[:, :, 3] = rescued_alpha

    buffer = io.BytesIO()
    Image.fromarray(final_rgba, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# ──────────────────────────────────────────────────────────────────────────────
# Shadow removal helper
# ──────────────────────────────────────────────────────────────────────────────

def remove_shadows(processed_png: bytes) -> bytes:
    """Detect and remove soft drop-shadows from an RGBA image.

    Shadows appear as semi-transparent near-neutral pixels surrounding the
    foreground subject. We identify them by low saturation combined with
    low-to-medium alpha and suppress their opacity.
    """
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)

    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

    # Compute per-pixel saturation (0-255 scale)
    rgb_max = np.maximum(np.maximum(r, g), b)
    rgb_min = np.minimum(np.minimum(r, g), b)
    saturation = rgb_max - rgb_min  # range 0-255

    # Lightness (average)
    lightness = (rgb_max + rgb_min) / 2.0

    # Shadow heuristic: semi-transparent + low saturation + medium-light pixel
    is_shadow = (
        (a > 5) & (a < 200)          # semi-transparent
        & (saturation < 30)           # nearly neutral gray
        & (lightness > 60)            # not pure black (shadow, not ink)
    )

    # Suppress shadow pixels by multiplying their alpha by a decay factor
    decay = np.where(is_shadow, (a / 255.0) ** 2.2 * 255.0, a)
    out = arr.copy()
    out[:, :, 3] = np.clip(decay, 0, 255)

    buffer = io.BytesIO()
    Image.fromarray(out.astype(np.uint8), mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# ──────────────────────────────────────────────────────────────────────────────
# Edge feathering / defringe helpers
# ──────────────────────────────────────────────────────────────────────────────

def apply_edge_feather(processed_png: bytes, radius: int) -> bytes:
    """Smooth the alpha-channel edges by applying a small blur to the mask."""
    if radius <= 0:
        return processed_png
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    r, g, b, a = img.split()
    # Blur only the alpha channel to soften hard edges
    a_blurred = a.filter(ImageFilter.GaussianBlur(radius=radius))
    result = Image.merge("RGBA", (r, g, b, a_blurred))
    buffer = io.BytesIO()
    result.save(buffer, format="PNG")
    return buffer.getvalue()


def apply_defringe(processed_png: bytes) -> bytes:
    """Remove color fringing (halo) artifacts left by the original background.

    For each edge pixel, we sample the color from the fully-opaque interior
    neighbours and blend toward that color proportional to semi-transparency.
    This is a simplified 'despill' / decontamination pass.
    """
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)

    a = arr[:, :, 3] / 255.0  # normalised alpha 0-1

    # Build a blurred version of the RGB channels weighted by alpha
    pil_a = Image.fromarray((a * 255).astype(np.uint8), mode="L")
    # Dilate the fully-opaque core colours by blurring
    for c in range(3):
        channel = Image.fromarray(arr[:, :, c].astype(np.uint8), mode="L")
        blurred = channel.filter(ImageFilter.GaussianBlur(radius=3))
        blurred_arr = np.asarray(blurred, dtype=np.float32)
        # Replace semi-transparent pixel colours with blurred interior colour
        mask = (a > 0.05) & (a < 0.85)
        arr[:, :, c] = np.where(mask, blurred_arr, arr[:, :, c])

    buffer = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# ──────────────────────────────────────────────────────────────────────────────
# Logo / graphic post-processing
# ──────────────────────────────────────────────────────────────────────────────

def refine_logo_mask(processed_png: bytes) -> bytes:
    """Hard-threshold the alpha channel for logos/graphics to produce a clean,
    binary mask without semi-transparent fringe artefacts."""
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    arr = np.asarray(img, dtype=np.uint8).copy()
    alpha = arr[:, :, 3].astype(np.int16)
    # Binarise: pixels >=128 become fully opaque, below become fully transparent
    arr[:, :, 3] = np.where(alpha >= 128, 255, 0).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# ──────────────────────────────────────────────────────────────────────────────
# Core pipeline
# ──────────────────────────────────────────────────────────────────────────────

def run_removal_pipeline(
    source_image: bytes,
    mode: str,
    alpha_matting: bool,
    shadow_removal: bool,
    edge_feather: int,
    defringe: bool,
) -> bytes:
    """Run the full background removal pipeline for the given mode and options."""
    model_name = MODE_MODEL_MAP.get(mode, "isnet-general-use")
    session = new_session(model_name)

    # rembg core removal
    # Alpha matting is most useful for portraits (hair) and products
    use_alpha_matting = alpha_matting and mode in ("portrait", "product", "auto")

    processed: bytes = remove(
        source_image,
        session=session,
        alpha_matting=use_alpha_matting,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=10,
    )
    if not isinstance(processed, bytes):
        raise TypeError("rembg.remove returned an unexpected payload type.")

    # Mode-specific post-processing
    if mode == "signature":
        processed = preserve_document_strokes(source_image, processed)
    elif mode == "logo":
        processed = refine_logo_mask(processed)
        processed = apply_defringe(processed)

    # Optional precision passes
    if shadow_removal:
        processed = remove_shadows(processed)

    if defringe and mode not in ("logo",):  # logo already defringed
        processed = apply_defringe(processed)

    if edge_feather > 0:
        processed = apply_edge_feather(processed, radius=edge_feather)

    return processed


@celery_app.task(
    bind=True,
    name="app.workers.bg_removal.remove_background_task",
    autoretry_for=(requests.RequestException,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def remove_background_task(
    self: Any,
    job_id: str,
    image_url: str,
    mode: str = "auto",
    alpha_matting: bool = False,
    shadow_removal: bool = False,
    edge_feather: int = 0,
    defringe: bool = False,
) -> dict[str, Any]:
    logger.info(
        "Starting background removal job",
        extra={
            "job_id": job_id,
            "image_url": image_url,
            "mode": mode,
            "alpha_matting": alpha_matting,
            "shadow_removal": shadow_removal,
            "edge_feather": edge_feather,
            "defringe": defringe,
        },
    )
    update_job(job_id, status="PROCESSING", error=None)

    try:
        source_image = download_image_bytes(image_url)
        processed_png = run_removal_pipeline(
            source_image=source_image,
            mode=mode,
            alpha_matting=alpha_matting,
            shadow_removal=shadow_removal,
            edge_feather=edge_feather,
            defringe=defringe,
        )

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
