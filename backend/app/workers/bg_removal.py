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

# ─── Document / Signature detection thresholds ────────────────────────────────
DOCUMENT_WHITE_THRESHOLD: Final[int] = 235
DOCUMENT_DARK_THRESHOLD: Final[int] = 208
DOCUMENT_LOW_SATURATION_THRESHOLD: Final[int] = 42
DOCUMENT_BACKGROUND_PERCENTILE: Final[float] = 97.0
DOCUMENT_STROKE_MARGIN: Final[int] = 10
DOCUMENT_MAX_STROKE_GRAYSCALE: Final[int] = 245
DOCUMENT_STROKE_SATURATION_THRESHOLD: Final[int] = 72

# ─── Removal mode → model mapping ─────────────────────────────────────────────
# BiRefNet (2024 SOTA) dramatically outperforms older isnet/u2net models.
# Especially for portraits with complex hair, edges, and varied backgrounds.
MODE_MODEL_MAP: Final[dict[str, str]] = {
    "auto":      "birefnet-general",    # BiRefNet general – best overall quality
    "portrait":  "birefnet-portrait",   # BiRefNet specifically trained on portraits
    "product":   "birefnet-general",    # BiRefNet general handles products well
    "logo":      "isnet-general-use",   # Logos/graphics: isnet with binary post-process
    "signature": "isnet-general-use",   # Signature: custom stroke-preservation pipeline
    "anime":     "isnet_anime",         # Anime/illustration-specific model
}

# Per-mode alpha matting parameters (fg_threshold, bg_threshold, erode_size).
# These define the "uncertain zone" fed to PyMatting for transition refinement.
MODE_MATTING_PARAMS: Final[dict[str, tuple[int, int, int]]] = {
    "auto":      (240, 15, 10),
    "portrait":  (240, 10, 15),  # wider erode to include more hair transition
    "product":   (245, 10, 10),
    "logo":      (250, 5,  5),
    "signature": (245, 10, 8),
    "anime":     (240, 15, 10),
}


# ─── Celery setup ─────────────────────────────────────────────────────────────

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


# ─── Cloud / storage helpers ──────────────────────────────────────────────────

def get_r2_client() -> BaseClient:
    if not all([
        settings.r2_account_id,
        settings.r2_access_key_id,
        settings.r2_secret_access_key,
        settings.r2_bucket_name,
    ]):
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
    if not all([
        settings.r2_account_id,
        settings.r2_access_key_id,
        settings.r2_secret_access_key,
        settings.r2_bucket_name,
        settings.r2_public_domain,
    ]):
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


# ─── Core alpha mask utilities ────────────────────────────────────────────────

def _alpha_channel(processed_png: bytes) -> tuple[Image.Image, np.ndarray]:
    """Return (rgba_pil_image, alpha_uint8_array)."""
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    arr = np.asarray(img, dtype=np.uint8)
    return img, arr


def clean_alpha_mask(processed_png: bytes) -> bytes:
    """Remove background bleed-through and fill internal holes.

    Strategy:
    1. Hard-cut near-zero alpha (noise pixels from bad segmentation).
    2. Morphological closing (dilate → erode) to fill gaps inside the subject.
    3. Morphological opening (erode → dilate) to remove tiny isolated specks.
    4. Gentle Gaussian smooth to remove staircase jaggies.
    """
    img, arr = _alpha_channel(processed_png)
    alpha = arr[:, :, 3].copy()

    # 1. Hard threshold: drop faint background noise
    alpha = np.where(alpha < 12, 0, alpha)
    # Hard-cap near-opaque: consolidate anything >=240 to 255
    alpha = np.where(alpha > 240, 255, alpha)

    pil_a = Image.fromarray(alpha, mode="L")

    # 2. Morphological closing: fill small holes (e.g. gaps inside hair)
    size_close = 7
    pil_a = pil_a.filter(ImageFilter.MaxFilter(size_close))  # dilate
    pil_a = pil_a.filter(ImageFilter.MinFilter(size_close))  # erode back

    # 3. Morphological opening: remove tiny isolated noise blobs
    size_open = 3
    pil_a = pil_a.filter(ImageFilter.MinFilter(size_open))   # erode
    pil_a = pil_a.filter(ImageFilter.MaxFilter(size_open))   # dilate back

    # 4. Very subtle smoothing to soften the staircase without blurring edges
    pil_a = pil_a.filter(ImageFilter.GaussianBlur(radius=0.6))

    out = arr.copy()
    out[:, :, 3] = np.clip(np.array(pil_a), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def sharpen_alpha_contrast(processed_png: bytes) -> bytes:
    """Push semi-transparent pixels toward either fully opaque or fully transparent.

    Uses a piecewise linear remap: values in the lower 15% → 0,
    values in the upper 15% → 255, and a steeper curve in-between.
    This eliminates the "misty" semi-transparent background bleed that
    fools the eye into seeing leftover background.
    """
    img, arr = _alpha_channel(processed_png)
    alpha = arr[:, :, 3].astype(np.float32)

    # Piecewise remap: [0,30] → 0, [30,220] → linear stretch to [0,255], [220,255] → 255
    lo, hi = 30.0, 220.0
    alpha = np.clip((alpha - lo) / (hi - lo), 0.0, 1.0) * 255.0

    out = arr.copy()
    out[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def remove_shadows(processed_png: bytes) -> bytes:
    """Suppress soft drop-shadows: semi-transparent near-neutral pixels."""
    img, arr = _alpha_channel(processed_png)
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    a = arr[:, :, 3].astype(np.float32)

    rgb_max = np.maximum(np.maximum(r, g), b)
    rgb_min = np.minimum(np.minimum(r, g), b)
    saturation = rgb_max - rgb_min
    lightness = (rgb_max + rgb_min) / 2.0

    # Shadow: semi-transparent + low saturation + not very dark
    is_shadow = (a > 5) & (a < 210) & (saturation < 35) & (lightness > 55)

    # Gamma-compress shadow pixels' alpha → push them toward transparent
    decay = np.where(is_shadow, (a / 255.0) ** 2.5 * 255.0, a)

    out = arr.copy()
    out[:, :, 3] = np.clip(decay, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def apply_edge_feather(processed_png: bytes, radius: int) -> bytes:
    """Gaussian blur on alpha channel only to soften hard edges."""
    if radius <= 0:
        return processed_png
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    r, g, b, a = img.split()
    a = a.filter(ImageFilter.GaussianBlur(radius=radius))
    buf = io.BytesIO()
    Image.merge("RGBA", (r, g, b, a)).save(buf, format="PNG")
    return buf.getvalue()


def apply_defringe(processed_png: bytes) -> bytes:
    """Replace semi-transparent edge pixel colours with blurred interior colour.

    This removes the colour halo ('fringe') left by the original background
    bleeding into the transition zone.
    """
    img = Image.open(io.BytesIO(processed_png)).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)
    a = arr[:, :, 3] / 255.0

    for c in range(3):
        channel = Image.fromarray(arr[:, :, c].astype(np.uint8), mode="L")
        blurred = channel.filter(ImageFilter.GaussianBlur(radius=2))
        blurred_arr = np.asarray(blurred, dtype=np.float32)
        # Only replace pixels in the semi-transparent fringe zone
        mask = (a > 0.05) & (a < 0.90)
        arr[:, :, c] = np.where(mask, blurred_arr, arr[:, :, c])

    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def refine_logo_mask(processed_png: bytes) -> bytes:
    """Binary-threshold the alpha for logos: ≥128 → 255, <128 → 0."""
    img, arr = _alpha_channel(processed_png)
    out = arr.copy()
    out[:, :, 3] = np.where(arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


# ─── Document / Signature helpers ─────────────────────────────────────────────

def is_document_like_image(rgb_array: np.ndarray) -> bool:
    grayscale = np.round(
        0.299 * rgb_array[:, :, 0]
        + 0.587 * rgb_array[:, :, 1]
        + 0.114 * rgb_array[:, :, 2]
    ).astype(np.uint8)
    rgb_max = np.max(rgb_array, axis=2)
    rgb_min = np.min(rgb_array, axis=2)
    saturation = rgb_max - rgb_min

    white_ratio = float(np.mean(grayscale >= DOCUMENT_WHITE_THRESHOLD))
    dark_ratio = float(np.mean(grayscale <= DOCUMENT_DARK_THRESHOLD))
    low_sat_ratio = float(np.mean(saturation <= DOCUMENT_LOW_SATURATION_THRESHOLD))

    return white_ratio >= 0.45 and dark_ratio <= 0.35 and low_sat_ratio >= 0.55


def preserve_document_strokes(source_image: bytes, processed_png: bytes) -> bytes:
    """Recover ink strokes that rembg may have made transparent on paper."""
    source = Image.open(io.BytesIO(source_image)).convert("RGBA")
    result = Image.open(io.BytesIO(processed_png)).convert("RGBA")

    source_rgba = np.asarray(source, dtype=np.uint8)
    result_rgba = np.asarray(result, dtype=np.uint8)
    source_rgb = source_rgba[:, :, :3]

    if not is_document_like_image(source_rgb):
        return processed_png

    grayscale = np.round(
        0.299 * source_rgb[:, :, 0]
        + 0.587 * source_rgb[:, :, 1]
        + 0.114 * source_rgb[:, :, 2]
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
    stroke_strength = np.clip(stroke_delta.astype(np.int16) * 14, 0, 255).astype(np.uint8)
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

    buf = io.BytesIO()
    Image.fromarray(final_rgba, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


# ─── Core removal pipeline ────────────────────────────────────────────────────

def run_removal_pipeline(
    source_image: bytes,
    mode: str,
    alpha_matting: bool,
    shadow_removal: bool,
    edge_feather: int,
    defringe: bool,
) -> bytes:
    """Full background removal pipeline routed by mode.

    Pipeline order:
    1. rembg core segmentation (BiRefNet / isnet / u2net depending on mode)
    2. Alpha mask cleanup (morphological closing/opening + noise cut)
    3. Alpha contrast sharpening (push semi-transparent bleed toward 0/255)
    4. Mode-specific passes (signature stroke rescue, logo binarise)
    5. Optional: shadow removal
    6. Optional: defringe (colour halo removal)
    7. Optional: edge feather (Gaussian alpha blur)
    """
    model_name = MODE_MODEL_MAP.get(mode, "birefnet-general")
    session = new_session(model_name)

    # Per-mode alpha matting thresholds
    fg_thresh, bg_thresh, erode_sz = MODE_MATTING_PARAMS.get(mode, (240, 15, 10))

    # Alpha matting is most beneficial for portraits and products where
    # subject edges transition gradually (hair, fur, soft fabric).
    use_alpha_matting = alpha_matting and mode in ("portrait", "product", "auto")

    processed: bytes = remove(
        source_image,
        session=session,
        alpha_matting=use_alpha_matting,
        alpha_matting_foreground_threshold=fg_thresh,
        alpha_matting_background_threshold=bg_thresh,
        alpha_matting_erode_size=erode_sz,
    )
    if not isinstance(processed, bytes):
        raise TypeError("rembg.remove returned an unexpected payload type.")

    # ── Step 2: always clean the mask ────────────────────────────────────────
    processed = clean_alpha_mask(processed)

    # ── Step 3: sharpen alpha contrast to kill semi-transparent bleed ─────────
    # Skip for signature/logo which have their own binarisation logic.
    if mode not in ("signature", "logo"):
        processed = sharpen_alpha_contrast(processed)

    # ── Step 4: mode-specific passes ─────────────────────────────────────────
    if mode == "signature":
        processed = preserve_document_strokes(source_image, processed)
    elif mode == "logo":
        processed = refine_logo_mask(processed)
        processed = apply_defringe(processed)

    # ── Step 5: optional shadow removal ───────────────────────────────────────
    if shadow_removal:
        processed = remove_shadows(processed)

    # ── Step 6: optional defringe ─────────────────────────────────────────────
    if defringe and mode not in ("logo",):
        processed = apply_defringe(processed)

    # ── Step 7: optional edge feather ─────────────────────────────────────────
    if edge_feather > 0:
        processed = apply_edge_feather(processed, radius=edge_feather)

    return processed


# ─── Celery task ──────────────────────────────────────────────────────────────

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
            "model": MODE_MODEL_MAP.get(mode, "birefnet-general"),
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
