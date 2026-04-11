"""DocuSeal REST API client."""
from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class DocuSealError(Exception):
    pass


class DocuSealClient:
    """Thin async wrapper around the DocuSeal REST API."""

    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "X-Auth-Token": self._api_key,
            "Content-Type": "application/json",
        }

    async def create_submission(
        self,
        pdf_bytes: bytes,
        document_name: str,
        signers: list[dict],  # [{name, email, role, order}]
    ) -> dict[str, Any]:
        """
        Upload a PDF and create a DocuSeal submission with e-signature fields.

        Returns the DocuSeal submission object (contains submission id + submitter signing URLs).
        """
        encoded = base64.b64encode(pdf_bytes).decode()

        # Build one signature field per signer role
        fields = [
            {
                "name": f"Signature {i + 1}",
                "type": "signature",
                "role": s["role"],
                "required": True,
            }
            for i, s in enumerate(signers)
        ]

        payload = {
            "template": {
                "name": document_name,
                "documents": [
                    {
                        "name": f"{document_name}.pdf",
                        "file": f"data:application/pdf;base64,{encoded}",
                    }
                ],
                "fields": fields,
            },
            "submitters": [
                {
                    "name": s["name"],
                    "email": s["email"],
                    "role": s["role"],
                    "send_email": True,
                }
                for s in signers
            ],
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._base_url}/api/v1/submissions/direct",
                headers=self._headers,
                json=payload,
            )
            if resp.status_code >= 400:
                logger.error("DocuSeal create_submission error %s: %s", resp.status_code, resp.text)
                raise DocuSealError(f"DocuSeal API error {resp.status_code}: {resp.text}")
            return resp.json()

    async def get_submission(self, submission_id: str) -> dict[str, Any]:
        """Fetch submission status and submitter progress."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self._base_url}/api/v1/submissions/{submission_id}",
                headers=self._headers,
            )
            if resp.status_code >= 400:
                raise DocuSealError(f"DocuSeal API error {resp.status_code}: {resp.text}")
            return resp.json()

    async def download_document(self, submission_id: str) -> bytes:
        """Download the completed signed PDF from DocuSeal."""
        submission = await self.get_submission(submission_id)
        documents = submission.get("documents", [])
        if not documents:
            raise DocuSealError("No documents found in completed submission")

        download_url = documents[0].get("url")
        if not download_url:
            raise DocuSealError("No download URL in submission documents")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(download_url)
            resp.raise_for_status()
            return resp.content

    async def void_submission(self, submission_id: str) -> None:
        """Cancel/void a pending submission."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(
                f"{self._base_url}/api/v1/submissions/{submission_id}",
                headers=self._headers,
            )
            if resp.status_code not in (200, 204):
                logger.warning("DocuSeal void_submission returned %s", resp.status_code)


def get_docuseal_client() -> DocuSealClient:
    settings = get_settings()
    return DocuSealClient(
        api_key=settings.docuseal_api_key,
        base_url=settings.docuseal_base_url,
    )
