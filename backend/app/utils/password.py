# app/utils/password.py
#
# Central password hashing utility.
# All new passwords are hashed with argon2id via argon2-cffi.
# Existing SHA-256 hashes (stored as 64-char hex strings with a non-empty Salt)
# are verified with hmac.compare_digest and transparently migrated to argon2id
# on the user's next successful login.
#
# Salt sentinel: UserSecrets.Salt is a NOT NULL column. After migration to argon2id
# the Salt is set to "" (empty string). needs_rehash() inspects only the hash string
# format, not Salt, so it is safe even if Salt is somehow inconsistent.

import hashlib
import hmac
import logging

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

logger = logging.getLogger(__name__)

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    """Return an argon2id hash of *password*. Salt is embedded in the hash string."""
    return _ph.hash(password)


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """
    Return True if *password* matches *stored_hash*.

    Handles two cases:
    - argon2id hash (Salt column is empty string ""): verify with argon2-cffi.
    - Legacy SHA-256 hash (Salt column is a non-empty hex string): verify with
      hmac.compare_digest to avoid timing oracle, then return True so the caller
      can rehash to argon2id.
    """
    if needs_rehash(stored_hash):
        # Legacy SHA-256 path — timing-safe comparison.
        # Guard against a corrupted DB row where Salt is not a string.
        if not isinstance(salt, str):
            logger.warning("verify_password: SHA-256 path but Salt is not a string — possible corrupted row")
            return False
        expected = hashlib.sha256((password + salt).encode("utf-8")).hexdigest()
        return hmac.compare_digest(expected, stored_hash)

    # argon2id path
    try:
        return _ph.verify(stored_hash, password)
    except VerifyMismatchError:
        return False
    except InvalidHashError:
        # stored_hash is neither a valid argon2 hash nor a SHA-256 hex string.
        # This should never happen on a healthy database but could indicate a
        # corrupted credential store (truncated write, wrong column, etc.).
        # Log at WARNING so an operator can diagnose a stuck account.
        logger.warning("verify_password: InvalidHashError for stored hash — possible corrupted credential")
        return False


def needs_rehash(stored_hash: str) -> bool:
    """
    Return True if *stored_hash* looks like a raw SHA-256 hex digest and should
    be migrated to argon2id. Only matches 64-character lowercase hex strings —
    the exact output of hashlib.sha256(...).hexdigest().
    """
    return len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash)
