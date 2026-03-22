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

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy.engine import Engine

from app.db import fetch_secret

logger = logging.getLogger(__name__)


def _get_fernet(engine: Engine, schema: str) -> Fernet:
    key = fetch_secret(engine, schema, "CONNECTION_KEY")
    try:
        return Fernet(key.strip().encode())
    except Exception:
        logger.error("[connection_crypto] CONNECTION_KEY in [adm].[Secrets] is not a valid Fernet key")
        raise HTTPException(status_code=500, detail="Server configuration error: invalid encryption key")


def encrypt_credentials(engine: Engine, schema: str, credentials: dict) -> str:
    """Encrypt a credentials dict and return the Fernet token as a UTF-8 string."""
    f = _get_fernet(engine, schema)
    return f.encrypt(json.dumps(credentials).encode("utf-8")).decode("utf-8")


def decrypt_credentials(engine: Engine, schema: str, token: str) -> dict:
    """Decrypt a stored Fernet token and return the credentials dict."""
    f = _get_fernet(engine, schema)
    return json.loads(f.decrypt(token.encode("utf-8")).decode("utf-8"))
