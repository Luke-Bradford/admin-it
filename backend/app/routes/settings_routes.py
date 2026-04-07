# app/routes/settings_routes.py
#
# SMTP configuration routes (admin-only). The SMTP password is encrypted with
# the existing CONNECTION_KEY Fernet key and stored in [adm].[Secrets] under
# SecretType = 'SMTP_PASSWORD'. All other SMTP fields are JSON-encoded into
# rows in [adm].[Settings] keyed 'smtp.host', 'smtp.port', etc.
#
# The Settings table is generic key/value — keys are tightly allowlisted at
# the route layer, never derived from user input.

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import bindparam, text

from app.utils.auth_dependency import ADMIN_ROLES, verify_token
from app.utils.connection_crypto import decrypt_value, encrypt_value
from app.utils.db_helpers import get_backend
from app.utils.email_sender import EmailSendError, send_email
from app.utils.sql_helpers import quote_ident as qi

router = APIRouter()
logger = logging.getLogger(__name__)

TlsMode = Literal["none", "starttls", "tls"]

# Allowlist of Settings keys this router is allowed to read/write. Used to
# defend against any future code path that might pass a key derived from
# user input — every key reaching the SQL template must be in this set.
# Note: this list is small (10 items) and bounded. SQLAlchemy's expanding
# bindparam generates `IN (:k_1, :k_2, ...)` which is fine on MSSQL up to its
# 2,100-parameter limit — well above any plausible growth here.
SMTP_SETTING_KEYS: tuple[str, ...] = (
    "smtp.host",
    "smtp.port",
    "smtp.tls_mode",
    "smtp.username",
    "smtp.from_address",
    "smtp.from_name",
    "smtp.reply_to_address",
    "smtp.allowlist_enabled",
    "smtp.allowed_domains",
    "smtp.verify_ssl",
)

SMTP_PASSWORD_SECRET = "SMTP_PASSWORD"

# Lightweight email syntax check — full RFC 5322 is overkill and we don't have
# email-validator installed. The SMTP server is the real source of truth.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    if not _EMAIL_RE.match(value):
        raise ValueError("Invalid email address")
    return value


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class SmtpSettingsOut(BaseModel):
    host: str | None
    port: int | None
    tls_mode: TlsMode | None
    username: str | None
    from_address: str | None
    from_name: str | None
    reply_to_address: str | None
    allowlist_enabled: bool
    allowed_domains: list[str]
    verify_ssl: bool
    password_set: bool


class SmtpSettingsUpdate(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    tls_mode: TlsMode
    username: str | None = Field(default=None, max_length=255)
    from_address: str = Field(min_length=3, max_length=320)
    from_name: str | None = Field(default=None, max_length=255)
    reply_to_address: str | None = Field(default=None, max_length=320)
    allowlist_enabled: bool = False
    allowed_domains: list[str] = Field(default_factory=list)
    verify_ssl: bool = True

    @field_validator("from_address")
    @classmethod
    def _check_from(cls, v: str) -> str:
        return _validate_email(v)

    @field_validator("reply_to_address")
    @classmethod
    def _check_reply_to(cls, v: str | None) -> str | None:
        return _validate_email(v) if v else v

    @field_validator("allowed_domains")
    @classmethod
    def _check_domains(cls, v: list[str]) -> list[str]:
        cleaned: list[str] = []
        for d in v:
            d = d.strip().lower()
            if not d:
                continue
            if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", d):
                raise ValueError(f"Invalid domain: {d}")
            cleaned.append(d)
        return cleaned


class SmtpPasswordUpdate(BaseModel):
    password: str = Field(min_length=1, max_length=500)


class SmtpTestRequest(BaseModel):
    to: str = Field(min_length=3, max_length=320)

    @field_validator("to")
    @classmethod
    def _check_to(cls, v: str) -> str:
        return _validate_email(v)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_admin(user: dict) -> None:
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")


def _read_smtp_settings_rows(conn, schema: str, db_type: str) -> dict[str, Any]:
    """Read all SMTP settings rows in one query and decode their JSON values.

    Returns a dict keyed by short field name (e.g. 'host', 'port').
    """
    stmt = text(f"""
        SELECT "SettingKey", "SettingValue"
        FROM {qi(schema, "Settings", db_type)}
        WHERE "SettingKey" IN :keys
    """).bindparams(bindparam("keys", expanding=True))
    rows = conn.execute(stmt, {"keys": list(SMTP_SETTING_KEYS)}).fetchall()
    out: dict[str, Any] = {}
    for key, raw in rows:
        if key not in SMTP_SETTING_KEYS:
            continue
        short = key.removeprefix("smtp.")
        try:
            out[short] = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("[settings] Could not JSON-decode %s", key)
            out[short] = None
    return out


def _password_row_exists_in_conn(conn, schema: str, db_type: str) -> bool:
    """Return True iff a row keyed SMTP_PASSWORD exists in [adm].[Secrets].

    Uses a direct SELECT on the supplied connection — does NOT call
    `fetch_secret`, because that helper raises a generic `RuntimeError` for
    not-found and would force us to swallow ALL RuntimeErrors here. We only
    want to treat row-absence as 'not set'; any other error (DB down,
    permission denied) must propagate so the admin sees a real error rather
    than being told 'no password set' and overwriting a still-encrypted
    secret.

    Takes the conn as a parameter so callers can include this check in the
    same transaction as their settings reads/writes — otherwise a concurrent
    `PUT /smtp/password` could commit between the two connections and the
    response would show a stale `password_set` value.
    """
    row = conn.execute(
        text(f'SELECT 1 FROM {qi(schema, "Secrets", db_type)} WHERE "SecretType" = :st'),
        {"st": SMTP_PASSWORD_SECRET},
    ).fetchone()
    return row is not None


def _load_password(backend) -> str | None:
    """Return the decrypted SMTP password, or None if no row exists.

    Mirrors `_password_row_exists`: only row-absence yields None. Any
    decrypt failure propagates as HTTPException(500) via decrypt_value.
    """
    engine = backend.get_engine()
    table = qi(backend.schema, "Secrets", backend.db_type)
    with engine.connect() as conn:
        row = conn.execute(
            text(f'SELECT "SecretValue" FROM {table} WHERE "SecretType" = :st'),
            {"st": SMTP_PASSWORD_SECRET},
        ).fetchone()
    if row is None:
        return None
    return decrypt_value(backend, row[0])


def _upsert_setting(conn, schema: str, db_type: str, key: str, value: Any, user_id: str, now: datetime) -> None:
    """Upsert a single Settings row. Key MUST be in SMTP_SETTING_KEYS."""
    if key not in SMTP_SETTING_KEYS:
        # Defensive — should be impossible since callers iterate the constant.
        raise HTTPException(status_code=500, detail="Internal error: unknown setting key")
    encoded = json.dumps(value)
    table = qi(schema, "Settings", db_type)
    if db_type == "mssql":
        sql = f"""
            MERGE {table} WITH (HOLDLOCK) AS target
            USING (SELECT :k AS k) AS src ON target."SettingKey" = src.k
            WHEN MATCHED THEN UPDATE SET
                "SettingValue" = :v, "UpdatedAt" = :now, "UpdatedBy" = :uid
            WHEN NOT MATCHED THEN
                INSERT ("SettingKey", "SettingValue", "UpdatedAt", "UpdatedBy")
                VALUES (:k, :v, :now, :uid);
        """
    else:
        sql = f"""
            INSERT INTO {table} ("SettingKey", "SettingValue", "UpdatedAt", "UpdatedBy")
            VALUES (:k, :v, :now, :uid)
            ON CONFLICT ("SettingKey") DO UPDATE SET
                "SettingValue" = EXCLUDED."SettingValue",
                "UpdatedAt" = EXCLUDED."UpdatedAt",
                "UpdatedBy" = EXCLUDED."UpdatedBy";
        """
    conn.execute(text(sql), {"k": key, "v": encoded, "now": now, "uid": user_id})


def _upsert_secret(conn, schema: str, db_type: str, secret_type: str, secret_value: str) -> None:
    """Atomically upsert a row in [adm].[Secrets] keyed by SecretType.

    Uses MERGE / ON CONFLICT to avoid a TOCTOU race between two concurrent
    password updates (which with a separate SELECT-then-INSERT would both
    see no row and both INSERT, causing a primary-key violation).
    """
    table = qi(schema, "Secrets", db_type)
    desc = "SMTP outbound password (Fernet-encrypted with CONNECTION_KEY)"
    new_id = str(uuid.uuid4())
    if db_type == "mssql":
        sql = f"""
            MERGE {table} WITH (HOLDLOCK) AS target
            USING (SELECT :st AS st) AS src ON target."SecretType" = src.st
            WHEN MATCHED THEN UPDATE SET
                "SecretValue" = :v
            WHEN NOT MATCHED THEN
                INSERT ("SecretId", "SecretType", "SecretDescription", "SecretValue")
                VALUES (:id, :st, :desc, :v);
        """
    else:
        sql = f"""
            INSERT INTO {table} ("SecretId", "SecretType", "SecretDescription", "SecretValue")
            VALUES (:id, :st, :desc, :v)
            ON CONFLICT ("SecretType") DO UPDATE SET
                "SecretValue" = EXCLUDED."SecretValue";
        """
    conn.execute(
        text(sql),
        {"id": new_id, "st": secret_type, "desc": desc, "v": secret_value},
    )


def _build_settings_out(stored: dict[str, Any], password_set: bool) -> SmtpSettingsOut:
    return SmtpSettingsOut(
        host=stored.get("host"),
        port=stored.get("port"),
        tls_mode=stored.get("tls_mode"),
        username=stored.get("username"),
        from_address=stored.get("from_address"),
        from_name=stored.get("from_name"),
        reply_to_address=stored.get("reply_to_address"),
        allowlist_enabled=bool(stored.get("allowlist_enabled") or False),
        allowed_domains=list(stored.get("allowed_domains") or []),
        verify_ssl=bool(stored.get("verify_ssl") if stored.get("verify_ssl") is not None else True),
        password_set=password_set,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/smtp", response_model=SmtpSettingsOut)
def get_smtp_settings(user: dict = Depends(verify_token)) -> SmtpSettingsOut:
    _require_admin(user)
    backend = get_backend()
    engine = backend.get_engine()
    with engine.connect() as conn:
        stored = _read_smtp_settings_rows(conn, backend.schema, backend.db_type)
        password_set = _password_row_exists_in_conn(conn, backend.schema, backend.db_type)
    return _build_settings_out(stored, password_set)


@router.put("/smtp", response_model=SmtpSettingsOut)
def update_smtp_settings(body: SmtpSettingsUpdate, user: dict = Depends(verify_token)) -> SmtpSettingsOut:
    _require_admin(user)
    backend = get_backend()
    engine = backend.get_engine()
    schema = backend.schema
    db_type = backend.db_type
    now = datetime.now(timezone.utc)

    field_to_value: dict[str, Any] = {
        "smtp.host": body.host,
        "smtp.port": body.port,
        "smtp.tls_mode": body.tls_mode,
        "smtp.username": body.username,
        "smtp.from_address": body.from_address,
        "smtp.from_name": body.from_name,
        "smtp.reply_to_address": body.reply_to_address,
        "smtp.allowlist_enabled": body.allowlist_enabled,
        "smtp.allowed_domains": body.allowed_domains,
        "smtp.verify_ssl": body.verify_ssl,
    }

    with engine.begin() as conn:
        for key, value in field_to_value.items():
            _upsert_setting(conn, schema, db_type, key, value, user["user_id"], now)
        stored = _read_smtp_settings_rows(conn, schema, db_type)
        password_set = _password_row_exists_in_conn(conn, schema, db_type)

    return _build_settings_out(stored, password_set)


@router.put("/smtp/password", status_code=204)
def update_smtp_password(body: SmtpPasswordUpdate, user: dict = Depends(verify_token)) -> None:
    _require_admin(user)
    backend = get_backend()
    engine = backend.get_engine()
    encrypted = encrypt_value(backend, body.password)
    with engine.begin() as conn:
        _upsert_secret(conn, backend.schema, backend.db_type, SMTP_PASSWORD_SECRET, encrypted)
    return None


@router.post("/smtp/test")
def send_smtp_test(body: SmtpTestRequest, user: dict = Depends(verify_token)) -> dict:
    _require_admin(user)
    backend = get_backend()
    engine = backend.get_engine()
    with engine.connect() as conn:
        stored = _read_smtp_settings_rows(conn, backend.schema, backend.db_type)

    host = stored.get("host")
    port = stored.get("port")
    tls_mode = stored.get("tls_mode")
    from_address = stored.get("from_address")
    if not host or not port or not tls_mode or not from_address:
        # Return 200 with ok=False so the UI handles "incomplete config" the
        # same way it handles a real send failure (consistent contract — see
        # PR description and the EmailSendError branch below).
        return {
            "ok": False,
            "error": "SMTP is not fully configured. Save host, port, TLS mode, and from address first.",
        }

    verify_ssl = stored.get("verify_ssl")
    if verify_ssl is None:
        verify_ssl = True

    password = _load_password(backend)
    try:
        send_email(
            host=host,
            port=int(port),
            tls_mode=tls_mode,
            username=stored.get("username"),
            password=password,
            from_address=from_address,
            from_name=stored.get("from_name"),
            reply_to=stored.get("reply_to_address"),
            to=[body.to],
            verify_ssl=bool(verify_ssl),
            subject="admin-it SMTP test message",
            body=("This is a test message from admin-it.\n\nIf you received this, your SMTP configuration is working."),
        )
    except EmailSendError as e:
        return {"ok": False, "error": str(e)}

    return {"ok": True}
