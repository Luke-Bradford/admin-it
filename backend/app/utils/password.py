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


_SHA256_HEX_LENGTH = 64
_SHA256_HEX_CHARS = frozenset("0123456789abcdef")


def needs_rehash(stored_hash: str) -> bool:
    """
    Return True only if the stored hash is a plausible legacy SHA-256 hash that should
    be upgraded to argon2id.

    A plausible SHA-256 hash is exactly 64 lowercase hex characters. Anything else
    (empty string, argon2id hash, corrupted value) returns False — we let
    verify_password() fail for unrecognised formats rather than triggering a rehash
    that would silently overwrite a corrupted record.
    """
    if stored_hash.startswith(_ARGON2_PREFIX):
        return False
    return len(stored_hash) == _SHA256_HEX_LENGTH and all(c in _SHA256_HEX_CHARS for c in stored_hash)
