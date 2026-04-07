# app/utils/connection_crypto.py
#
# Fernet encryption/decryption for connection credentials stored in
# [adm].[Connections].ConnectionString.
#
# The Fernet key is stored in [adm].[Secrets] under SecretType = 'CONNECTION_KEY'.
# It is fetched at call time (not cached at module level) so that key rotation
# only requires updating the DB row, not restarting the process.

import json
import logging

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.backends.core_backend import CoreBackend

logger = logging.getLogger(__name__)


def _get_fernet(backend: CoreBackend) -> Fernet:
    key = backend.fetch_secret("CONNECTION_KEY")
    try:
        return Fernet(key.strip().encode())
    except Exception:
        logger.error("[connection_crypto] CONNECTION_KEY in Secrets is not a valid Fernet key")
        raise HTTPException(status_code=500, detail="Server configuration error: invalid encryption key")


def encrypt_credentials(backend: CoreBackend, credentials: dict) -> str:
    """Encrypt a credentials dict and return the Fernet token as a UTF-8 string."""
    f = _get_fernet(backend)
    return f.encrypt(json.dumps(credentials).encode("utf-8")).decode("utf-8")


def encrypt_value(backend: CoreBackend, value: str) -> str:
    """Encrypt a single string value with the CONNECTION_KEY Fernet key.

    Used for opaque secrets (e.g. SMTP password) that don't fit the dict-shaped
    `encrypt_credentials` helper. Reuses CONNECTION_KEY rather than introducing a
    second key — see project_query_scheduling_pr2_handoff.
    """
    f = _get_fernet(backend)
    return f.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(backend: CoreBackend, token: str) -> str:
    """Decrypt a single string value previously written by `encrypt_value`."""
    f = _get_fernet(backend)
    try:
        return f.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.error("[connection_crypto] Failed to decrypt opaque secret — token corrupt or wrong key")
        raise HTTPException(
            status_code=500,
            detail="Server configuration error: could not decrypt stored secret",
        )


def decrypt_credentials(backend: CoreBackend, token: str) -> dict:
    """Decrypt a stored Fernet token and return the credentials dict."""
    f = _get_fernet(backend)
    try:
        return json.loads(f.decrypt(token.encode("utf-8")).decode("utf-8"))
    except InvalidToken:
        logger.error(
            "[connection_crypto] Failed to decrypt ConnectionString — "
            "token may be corrupt or was encrypted with a different key"
        )
        raise HTTPException(
            status_code=500,
            detail="Server configuration error: could not decrypt connection credentials",
        )
