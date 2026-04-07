# app/utils/email_sender.py
#
# Thin wrapper around stdlib smtplib + email.message.EmailMessage.
# All failures are normalised to EmailSendError so callers don't depend on
# smtplib internals. No external dependencies.

import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Literal

logger = logging.getLogger(__name__)

TlsMode = Literal["none", "starttls", "tls"]


class EmailSendError(Exception):
    """Raised when an email cannot be sent. Message is the underlying error."""


def _attachment_mime(filename: str) -> tuple[str, str]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        return ("text", "csv")
    if lower.endswith(".xlsx"):
        return ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
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
    verify_ssl: bool = True,
) -> None:
    """Send a single email synchronously. Raises EmailSendError on failure.

    Uses SMTP_SSL for tls_mode='tls', SMTP+STARTTLS for 'starttls', plain SMTP
    for 'none'. Authenticates only if both username and password are provided.

    `verify_ssl` controls TLS certificate verification for both SMTP_SSL and
    STARTTLS modes. Defaults to True (verify the server certificate against
    the system trust store). Set to False for self-signed internal SMTP relays
    — common in self-hosted deployments — but be aware this disables hostname
    and certificate validation entirely. Has no effect when tls_mode='none'.
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

    ssl_context = ssl.create_default_context()
    if not verify_ssl:
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

    try:
        if tls_mode == "tls":
            with smtplib.SMTP_SSL(host, port, timeout=15, context=ssl_context) as client:
                if username and password:
                    client.login(username, password)
                client.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.ehlo()
                if tls_mode == "starttls":
                    client.starttls(context=ssl_context)
                    client.ehlo()
                if username and password:
                    client.login(username, password)
                client.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        logger.warning("[email_sender] Send failed: %s", e)
        raise EmailSendError(str(e))
