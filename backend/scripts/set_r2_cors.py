#!/usr/bin/env python3
"""One-time script to set CORS policy on the R2 bucket.

Run from backend/ with the venv active:
  python scripts/set_r2_cors.py

Requires the same .env vars used by the app:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
"""
import sys
import os

# Load .env from the backend directory
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass

import boto3
from botocore.config import Config

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://reps-roi-staging.vercel.app",
    # Add your production domain here, e.g.:
    # "https://reps-roi.vercel.app",
]

CORS_CONFIG = {
    "CORSRules": [
        {
            "AllowedOrigins": ALLOWED_ORIGINS,
            "AllowedMethods": ["GET", "PUT", "HEAD"],
            "AllowedHeaders": ["*"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3600,
        }
    ]
}


def main():
    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket = os.environ.get("R2_BUCKET_NAME")

    missing = [k for k, v in {
        "R2_ACCOUNT_ID": account_id,
        "R2_ACCESS_KEY_ID": access_key,
        "R2_SECRET_ACCESS_KEY": secret_key,
        "R2_BUCKET_NAME": bucket,
    }.items() if not v]

    if missing:
        print(f"ERROR: Missing env vars: {', '.join(missing)}")
        sys.exit(1)

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    print(f"Setting CORS on bucket: {bucket}")
    print(f"Allowed origins: {ALLOWED_ORIGINS}")

    client.put_bucket_cors(Bucket=bucket, CORSConfiguration=CORS_CONFIG)

    # Verify
    result = client.get_bucket_cors(Bucket=bucket)
    print("\nCORS policy applied successfully:")
    for rule in result["CORSRules"]:
        print(f"  Origins:  {rule['AllowedOrigins']}")
        print(f"  Methods:  {rule['AllowedMethods']}")
        print(f"  Headers:  {rule['AllowedHeaders']}")


if __name__ == "__main__":
    main()
