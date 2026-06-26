import datetime
import logging
import re
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, ValidationInfo, field_validator
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12

# Configure minimal backend logging.
# Ensure passwords or request bodies are NEVER logged.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("p12_generator")

APP_VERSION = "0.3.0"
SAFE_TEXT_PATTERN = re.compile(r"^[ -~]+$")


def _validate_printable_text(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if not SAFE_TEXT_PATTERN.fullmatch(normalized):
        raise ValueError(f"{field_name} must contain printable characters only")
    return normalized


app = FastAPI(
    title="P12 Generator API",
    description="Local/internal API for generating password-protected PKCS#12 certificate bundles",
    version=APP_VERSION
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class P12GenerationRequest(BaseModel):
    fileBaseName: str = Field(..., min_length=1, max_length=64)
    commonName: str = Field(..., min_length=1, max_length=64)
    emailAddress: EmailStr
    country: str = Field(..., min_length=2, max_length=2)
    state: str = Field(..., min_length=1, max_length=64)
    locality: str = Field(..., min_length=1, max_length=64)
    organization: str = Field(..., min_length=1, max_length=64)
    organizationalUnit: str = Field(..., min_length=1, max_length=64)
    validityDays: int = Field(..., ge=1, le=18250)
    password: str = Field(..., min_length=6, max_length=128)

    @field_validator("fileBaseName")
    @classmethod
    def validate_file_basename(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("fileBaseName must only contain letters, numbers, dashes, and underscores")
        return v

    @field_validator("commonName", "state", "locality", "organization", "organizationalUnit")
    @classmethod
    def validate_subject_text(cls, v: str, info: ValidationInfo) -> str:
        return _validate_printable_text(v, info.field_name)

    @field_validator("country")
    @classmethod
    def validate_and_uppercase_country(cls, v: str) -> str:
        uppercased = v.upper()
        if not re.match(r"^[A-Z]{2}$", uppercased):
            raise ValueError("country must be exactly two letters")
        return uppercased


@app.get("/api/health")
def health_check():
    """
    Service health check endpoint.
    """
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }


@app.post("/api/generate-p12")
def generate_p12(data: P12GenerationRequest):
    """
    Generates an RSA Private Key and a Self-Signed X.509 Certificate in memory,
    packages them into a PKCS#12 bundle encrypted with the provided password,
    and returns the binary file stream.
    """
    try:
        # 1. Generate RSA Private Key in memory
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )

        # 2. Build Certificate Names (Subject contains full user details, Issuer contains Organization/OU only)
        subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, data.country),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, data.state),
            x509.NameAttribute(NameOID.LOCALITY_NAME, data.locality),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, data.organization),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, data.organizationalUnit),
            x509.NameAttribute(NameOID.COMMON_NAME, data.commonName),
            x509.NameAttribute(NameOID.EMAIL_ADDRESS, data.emailAddress),
        ])

        issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, data.country),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, data.state),
            x509.NameAttribute(NameOID.LOCALITY_NAME, data.locality),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, data.organization),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, data.organizationalUnit),
        ])

        now = datetime.datetime.now(datetime.timezone.utc)
        valid_until = now + datetime.timedelta(days=data.validityDays)

        # Build SubjectAlternativeName extension
        san = x509.SubjectAlternativeName([
            x509.RFC822Name(data.emailAddress)
        ])

        certificate = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(valid_until)
            .add_extension(san, critical=False)
            .sign(private_key, hashes.SHA256())
        )

        # 3. Serialize to PKCS#12 bundle using BestAvailableEncryption
        p12_data = pkcs12.serialize_key_and_certificates(
            name=data.fileBaseName.encode("utf-8"),
            key=private_key,
            cert=certificate,
            cas=None,
            encryption_algorithm=serialization.BestAvailableEncryption(
                data.password.encode("utf-8")
            )
        )

        headers = {
            "Content-Disposition": f'attachment; filename="{data.fileBaseName}.p12"',
            "Cache-Control": "no-store, max-age=0"
        }

        # Return binary stream response directly
        return Response(
            content=p12_data,
            media_type="application/x-pkcs12",
            headers=headers
        )

    except Exception:
        # Log generic message to avoid leaking passwords or stack traces in standard console outputs
        logger.error("Error generating PKCS#12 bundle")
        return JSONResponse(
            status_code=400,
            content={
                "error": "GenerationFailed",
                "message": "Failed to generate PKCS#12 certificate bundle."
            }
        )
