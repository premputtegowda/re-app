"""Send email via Gmail API using a user's OAuth refresh token."""
from __future__ import annotations

import base64
import logging
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


class GmailSendError(Exception):
    pass


class GmailSender:
    """
    Sends email via the Gmail API on behalf of a user.

    Requires a stored OAuth refresh token (gmail.send scope).
    Refreshes the access token on each send — stateless, no caching.
    """

    def __init__(self, refresh_token: str, sender_email: str):
        self._refresh_token = refresh_token
        self._sender_email = sender_email

    async def _get_access_token(self) -> str:
        settings = get_settings()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            if resp.status_code != 200:
                raise GmailSendError(f"Failed to refresh Gmail access token: {resp.text}")
            return resp.json()["access_token"]

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        attachment_bytes: bytes,
        attachment_filename: str,
    ) -> None:
        message = MIMEMultipart()
        message["From"] = self._sender_email
        message["To"] = to_email
        message["Subject"] = subject

        message.attach(MIMEText(body, "plain"))

        attachment = MIMEApplication(attachment_bytes, Name=attachment_filename)
        attachment["Content-Disposition"] = f'attachment; filename="{attachment_filename}"'
        message.attach(attachment)

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        access_token = await self._get_access_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GMAIL_SEND_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"raw": raw},
            )
            if resp.status_code not in (200, 202):
                raise GmailSendError(f"Gmail API send failed {resp.status_code}: {resp.text}")

        logger.info("Email sent via Gmail API from %s to %s", self._sender_email, to_email)
