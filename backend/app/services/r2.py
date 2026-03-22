"""Cloudflare R2 storage service (S3-compatible)."""
from __future__ import annotations

import uuid
import boto3
from botocore.config import Config

from app.config import get_settings

# Pre-signed URL expiry
UPLOAD_URL_EXPIRY = 300        # 5 minutes
DOWNLOAD_URL_EXPIRY = 3600     # 1 hour


def _make_client():
    settings = get_settings()
    endpoint = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


_r2_client = None

def get_r2_client():
    """Return a cached R2 client."""
    global _r2_client
    if _r2_client is None:
        _r2_client = _make_client()
    return _r2_client


def generate_object_key(user_id: str, entry_id: str, filename: str) -> str:
    """Generate a unique, structured R2 object key."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    unique = uuid.uuid4().hex
    return f"{user_id}/{entry_id}/{unique}.{ext}"


def generate_upload_url(key: str, content_type: str) -> str:
    """Generate a pre-signed PUT URL for direct browser → R2 upload."""
    client = get_r2_client()
    settings = get_settings()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=UPLOAD_URL_EXPIRY,
    )


def generate_download_url(key: str) -> str:
    """Generate a pre-signed GET URL for viewing/downloading a file."""
    client = get_r2_client()
    settings = get_settings()
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": key,
        },
        ExpiresIn=DOWNLOAD_URL_EXPIRY,
    )


def delete_object(key: str) -> None:
    """Delete an object from R2."""
    client = get_r2_client()
    settings = get_settings()
    client.delete_object(Bucket=settings.r2_bucket_name, Key=key)


def get_object_bytes(key: str) -> bytes:
    """Fetch raw file bytes from R2 (used for ZIP generation)."""
    client = get_r2_client()
    settings = get_settings()
    response = client.get_object(Bucket=settings.r2_bucket_name, Key=key)
    return response["Body"].read()
