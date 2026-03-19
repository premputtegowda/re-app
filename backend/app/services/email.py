from __future__ import annotations

import logging
from dataclasses import dataclass
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Protocol

import aiosmtplib

from app.config import get_settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    """Structural protocol for sending emails (Open/Closed principle)."""

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        attachment_bytes: bytes,
        attachment_filename: str,
    ) -> None:
        ...


@dataclass
class SmtpEmailSender:
    """
    Sends email via SMTP using STARTTLS on port 587.

    Stateless: each call opens and closes its own SMTP connection.
    """

    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        attachment_bytes: bytes,
        attachment_filename: str,
    ) -> None:
        message = MIMEMultipart()
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message["Subject"] = subject

        message.attach(MIMEText(body, "plain"))

        attachment = MIMEApplication(attachment_bytes, Name=attachment_filename)
        attachment["Content-Disposition"] = f'attachment; filename="{attachment_filename}"'
        message.attach(attachment)

        await aiosmtplib.send(
            message,
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            start_tls=True,
        )


    async def send_plain(self, to_email: str, subject: str, body: str) -> None:
        """Send a plain-text email with no attachment."""
        message = MIMEMultipart()
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message["Subject"] = subject
        message.attach(MIMEText(body, "plain"))

        await aiosmtplib.send(
            message,
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            start_tls=True,
        )


def get_smtp_sender() -> SmtpEmailSender:
    """Factory that reads settings once and returns a configured SmtpEmailSender."""
    settings = get_settings()
    return SmtpEmailSender(
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        from_email=settings.smtp_from_email,
        from_name=settings.smtp_from_name,
    )
