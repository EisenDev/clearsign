# Gemini 3.5 Flash Integration Guide

This application utilizes **Gemini 3.5 Flash** as its core reasoning and multimodal engine. This document specifies configuration standards, prompt engineering guidelines, and API usage to ensure optimal performance, low latency, and cost efficiency.

## Model Configuration

All interactions with Gemini 3.5 Flash should use the centralized service wrapper located in the Python backend (`app/services/llm.py`) to ensure consistent parameter injection.

**Default Parameters:**
* `model`: `gemini-3.5-flash`
* `temperature`: `0.2` (Optimized for deterministic, programmatic outputs like JSON. Increase to `0.7` for creative text generation).
* `max_output_tokens`: `4096`
* `top_p`: `0.8`

## Environment Setup

Ensure the following environment variable is set securely. Never commit this to version control.

```env
# .env
GEMINI_API_KEY=your_production_api_key_here
```

## System Instructions & Context Management

Gemini 3.5 Flash supports system instructions to set the persona and strict behavioral boundaries.

## Standard JSON Output Prompt Template

When requesting data structures from Gemini to be consumed by the TypeScript frontend, always enforce JSON mode using Pydantic schemas in the Python backend:

```python
import google.generativeai as genai
import typing_extensions as typing

class ProcessingResult(typing.TypedDict):
    status: str
    confidence_score: float
    metadata: dict

model = genai.GenerativeModel("gemini-3.5-flash")
result = model.generate_content(
    "Analyze this image metadata and return the structured result.",
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=ProcessingResult,
    ),
)
```

## Multimodal Capabilities (Vision)

When processing images alongside text (e.g., analyzing an image before background removal), use the direct file upload API for efficiency, especially for larger files or batch processing.

1. Upload the image to Cloudflare R2 or temporary local storage.
2. Pass the file URI to the model.
3. Combine with text prompts.

```python
# Example payload structure for Vision requests
prompt = [
    "Analyze this image and identify the primary foreground subject.",
    uploaded_image_file
]
response = await model.generate_content_async(prompt)
```

## Token Optimization & Rate Limiting

*   **Caching**: For static or repetitive system prompts, utilize Gemini's Context Caching API to reduce input token costs.
*   **Batching**: If processing multiple independent items, use asynchronous batch processing via FastAPI rather than sequential blocking calls.
