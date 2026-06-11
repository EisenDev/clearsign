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
import cv2
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
# We use lighter models (isnet-general-use, u2net) by default for CPU-only systems
# to ensure extremely fast processing (<2-3s) without pegging CPU performance.
MODE_MODEL_MAP: Final[dict[str, str]] = {
    "auto":      "isnet-general-use",   # High-accuracy general model (~170MB), fast on CPU
    "portrait":  "u2net_human_seg",     # Fast human portrait segmentation (~170MB)
    "product":   "u2net",               # Fast general product/object segmentation (~176MB)
    "logo":      "isnet-general-use",   # Logos/graphics: isnet with binary post-process
    "signature": "isnet-general-use",   # Signature: custom stroke-preservation pipeline
    "anime":     "isnet-anime",         # Anime/illustration-specific model (fixes session error)
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


def remove_isolated_noise_cv2(alpha: np.ndarray, min_area: int = 100) -> np.ndarray:
    """Find connected components in the alpha mask and remove small isolated noise regions."""
    # Binarize alpha (non-zero pixels)
    _, thresh = cv2.threshold(alpha, 1, 255, cv2.THRESH_BINARY)

    # Connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(thresh, connectivity=8)

    # We create a boolean mask of pixels to keep. Label 0 is the background, so we exclude it.
    keep_mask = np.zeros_like(alpha, dtype=bool)

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= min_area:
            keep_mask[labels == i] = True

    # Set pixels not in keep_mask to 0
    return np.where(keep_mask, alpha, 0).astype(np.uint8)


def clean_alpha_mask(processed_png: bytes, mode: str) -> bytes:
    """Clean the alpha mask adaptively based on the removal mode.

    - For all modes: Remove small isolated background noise specks using connected components.
    - For non-portrait/non-auto modes (like logo, product): Keep clean boundaries.
    - For portrait and auto modes: Avoid aggressive morphological operations that destroy hair/edges.
    """
    img, arr = _alpha_channel(processed_png)
    alpha = arr[:, :, 3].copy()

    # 1. Drop very faint noise pixels below threshold 5
    alpha = np.where(alpha < 5, 0, alpha)

    # 2. Remove isolated noise blobs using OpenCV connected components
    alpha = remove_isolated_noise_cv2(alpha, min_area=100)

    if mode in ("logo", "product"):
        # For logos and products, apply a mild morphological closing to fill inner holes
        pil_a = Image.fromarray(alpha, mode="L")
        pil_a = pil_a.filter(ImageFilter.MaxFilter(5))  # dilate
        pil_a = pil_a.filter(ImageFilter.MinFilter(5))  # erode
        alpha = np.array(pil_a)

    # 3. Soften the mask boundaries slightly to prevent staircasing
    pil_a = Image.fromarray(alpha, mode="L")
    blur_radius = 0.4 if mode == "portrait" else 0.6
    pil_a = pil_a.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    out = arr.copy()
    out[:, :, 3] = np.clip(np.array(pil_a), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def sharpen_alpha_contrast(processed_png: bytes) -> bytes:
    """Push semi-transparent pixels toward either fully opaque or fully transparent.

    Uses a very gentle piecewise linear remap to avoid producing jagged edges
    while cleaning up faint boundary mist.
    """
    img, arr = _alpha_channel(processed_png)
    alpha = arr[:, :, 3].astype(np.float32)

    # Gentle stretch: values below 10 become 0, values above 245 become 255.
    lo, hi = 10.0, 245.0
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
    """Remove color fringing (halo) using alpha-weighted color decontamination.

    This blurs only the foreground colors (weighted by alpha) and normalizes by
    the blurred alpha mask. This mathematically prevents the background colors
    from bleeding into the transition edge zone.
    """
    img, arr = _alpha_channel(processed_png)
    rgb = arr[:, :, :3].astype(np.float32)
    alpha = (arr[:, :, 3].astype(np.float32)) / 255.0

    # Pre-multiply RGB by alpha to focus only on foreground colors
    rgb_prem = rgb * alpha[:, :, np.newaxis]

    # Blur the pre-multiplied RGB and the alpha channel
    radius = 5
    kernel_size = radius * 2 + 1
    rgb_prem_blur = cv2.GaussianBlur(rgb_prem, (kernel_size, kernel_size), 0)
    alpha_blur = cv2.GaussianBlur(alpha, (kernel_size, kernel_size), 0)

    # Avoid division by zero
    alpha_blur_safe = np.where(alpha_blur < 1e-4, 1e-4, alpha_blur)

    # Calculate decontaminated color
    decontam_rgb = rgb_prem_blur / alpha_blur_safe[:, :, np.newaxis]
    decontam_rgb = np.clip(decontam_rgb, 0, 255)

    # Only apply decontamination to the transition zone (e.g. 0.02 < alpha < 0.85)
    # Fully opaque pixels remain unchanged. Fully transparent pixels remain transparent.
    mask = (alpha > 0.02) & (alpha < 0.85)

    final_rgb = rgb.copy()
    final_rgb[mask] = decontam_rgb[mask]

    out = np.dstack((final_rgb.astype(np.uint8), arr[:, :, 3]))
    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
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
    1. rembg core segmentation (isnet / u2net depending on mode)
    2. Alpha mask cleanup (morphological closing/opening + noise cut)
    3. Alpha contrast sharpening (push semi-transparent bleed toward 0/255)
    4. Mode-specific passes (signature stroke rescue, logo binarise)
    5. Optional: shadow removal
    6. Optional: defringe (colour halo removal)
    7. Optional: edge feather (Gaussian alpha blur)
    """
    model_name = MODE_MODEL_MAP.get(mode, "isnet-general-use")
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
    processed = clean_alpha_mask(processed, mode=mode)

    # ── Step 3: sharpen alpha contrast to kill semi-transparent bleed ─────────
    # Skip for signature/logo which have their own binarisation logic.
    # Also skip for portrait mode and if alpha matting is active.
    if mode not in ("signature", "logo", "portrait") and not use_alpha_matting:
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
            "model": MODE_MODEL_MAP.get(mode, "isnet-general-use"),
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
