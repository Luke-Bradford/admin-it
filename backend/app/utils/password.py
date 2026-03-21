# app/utils/password.py
#
# Single source of truth for password hashing and verification.
#
# Hash format:
#   New hashes — argon2id via argon2-cffi. Stored in PasswordHash column.
#   Legacy hashes — SHA-256(password + salt), stored as 64-char hex string.
#     Salt stored separately in UserSecrets.Salt.
#
# Migration: on successful login with a legacy hash, re-hash with argon2id
# and update the stored hash. Transparent to the user.

import hashlib

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

_ph = PasswordHasher()

# Argon2id hashes always start with this prefix.
_ARGON2_PREFIX = "$argon2id$"


def hash_password(password: str) -> str:
    """Hash a new password with argon2id. Returns the full hash string (no separate salt needed)."""
    return _ph.hash(password)


def verify_password(password: str, stored_hash: str, legacy_salt: str | None = None) -> bool:
    """
    Verify a password against a stored hash.

    Supports both argon2id (new) and SHA-256+salt (legacy) formats.
    Returns True if the password matches.
    """
    if stored_hash.startswith(_ARGON2_PREFIX):
        try:
            _ph.verify(stored_hash, password)
            return True
        except (VerifyMismatchError, VerificationError):
            return False
    else:
        # Legacy SHA-256 path — requires the salt from UserSecrets.
        if legacy_salt is None:
            return False
        legacy_hash = hashlib.sha256((password + legacy_salt).encode("utf-8")).hexdigest()
        return legacy_hash == stored_hash


def needs_rehash(stored_hash: str) -> bool:
    """Return True if the stored hash is legacy (SHA-256) and should be upgraded to argon2id."""
    return not stored_hash.startswith(_ARGON2_PREFIX)
