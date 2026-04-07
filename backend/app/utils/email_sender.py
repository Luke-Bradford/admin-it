# app/utils/email_sender.py
#
# Thin wrapper around stdlib smtplib + email.message.EmailMessage.
# All failures are normalised to EmailSendError so callers don't depend on
# smtplib internals. No external dependencies.

import logging
import smtplib
from email.message import EmailMessage
from typing import Literal

logger = logging.getLogger(__name__)

TlsMode = Literal["none", "starttls", "tls"]

_CSV_MIME = ("text", "csv")
_XLSX_MIME = (
    "application",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)


class EmailSendError(Exception):
    """Raised when an email cannot be sent. Message is the underlying error."""


def _attachment_mime(filename: str) -> tuple[str, str]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        return _CSV_MIME
    if lower.endswith(".xlsx"):
        return _XLSX_MIME
    # Generic fallback — caller should normally use one of the two above.
    return ("application", "octet-stream")


def send_email(
    *,
    host: str,
    port: int,
    tls_mode: TlsMode,
    username: str | None,
    password: str | None,
    from_address: str,
    from_name: str | None,
    reply_to: str | None,
    to: list[str],
    subject: str,
    body: str,
    attachment_bytes: bytes | None = None,
    attachment_filename: str | None = None,
) -> None:
    """Send a single email synchronously. Raises EmailSendError on failure.

    Uses SMTP_SSL for tls_mode='tls', SMTP+STARTTLS for 'starttls', plain SMTP
    for 'none'. Authenticates only if both username and password are provided.
    """
    if not to:
        raise EmailSendError("At least one recipient required")

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{from_address}>" if from_name else from_address
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)

    if attachment_bytes is not None and attachment_filename:
        maintype, subtype = _attachment_mime(attachment_filename)
        msg.add_attachment(
            attachment_bytes,
            maintype=maintype,
            subtype=subtype,
            filename=attachment_filename,
        )

    try:
        if tls_mode == "tls":
            smtp_cls = smtplib.SMTP_SSL
            with smtp_cls(host, port, timeout=15) as client:
                if username and password:
                    client.login(username, password)
                client.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.ehlo()
                if tls_mode == "starttls":
                    client.starttls()
                    client.ehlo()
                if username and password:
                    client.login(username, password)
                client.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        logger.warning("[email_sender] Send failed: %s", e)
        raise EmailSendError(str(e))
