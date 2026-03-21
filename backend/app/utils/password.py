# app/utils/password.py
#
# Single source of truth for password hashing and verification.
#
# Hash format:
#   New hashes  — argon2id via argon2-cffi. The full hash string is stored in
#                 PasswordHash; no separate salt column is needed (argon2id embeds
#                 its own salt in the hash string).
#   Legacy hashes — SHA-256(password + salt), stored as a 64-char hex string.
#                   Salt stored separately in UserSecrets.Salt.
#
# Migration is the caller's responsibility: call needs_rehash() after a successful
# verify_password(); if True, call hash_password() and persist the new hash.

import hashlib
import hmac

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()

# Argon2id hashes always start with this prefix.
_ARGON2_PREFIX = "$argon2id$"


def hash_password(password: str) -> str:
    """Hash a new password with argon2id. Returns the full hash string."""
    return _ph.hash(password)


def verify_password(password: str, stored_hash: str, legacy_salt: str | None = None) -> bool:
    """
    Verify a password against a stored hash.

    Supports both argon2id (new) and SHA-256+salt (legacy) formats.
    Returns True if the password matches, False otherwise.
    Never raises — a corrupted or unrecognised hash returns False.
    """
    if stored_hash.startswith(_ARGON2_PREFIX):
        try:
            _ph.verify(stored_hash, password)
            return True
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    else:
        # Legacy SHA-256 path — requires the salt from UserSecrets.
        if legacy_salt is None:
            return False
        candidate = hashlib.sha256((password + legacy_salt).encode("utf-8")).hexdigest()
        # Use hmac.compare_digest to prevent timing oracle attacks.
        return hmac.compare_digest(candidate, stored_hash)


def needs_rehash(stored_hash: str) -> bool:
    """Return True if the stored hash is legacy (SHA-256) and should be upgraded to argon2id."""
    return not stored_hash.startswith(_ARGON2_PREFIX)
