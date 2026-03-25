# app/routes/connections_routes.py

import logging
import uuid
from datetime import datetime, timezone

import pyodbc
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.utils.auth_dependency import verify_token
from app.utils.connection_crypto import decrypt_credentials, encrypt_credentials
from app.utils.db_helpers import get_backend
from app.utils.sql_helpers import quote_ident as qi

router = APIRouter()
logger = logging.getLogger(__name__)

ADMIN_ROLES = {"Admin", "SystemAdmin"}

# Allowlist of supported ODBC drivers. User input is validated against this
# before being interpolated into the connection string.
ALLOWED_ODBC_DRIVERS = {
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 18 for SQL Server",
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ConnectionIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    host: str = Field(..., min_length=1)
    port: int = Field(1433, ge=1, le=65535)
    db_user: str = Field(..., min_length=1)
    db_password: str = Field(..., min_length=1)
    database: str = Field(..., min_length=1)
    odbc_driver: str = Field("ODBC Driver 17 for SQL Server")


class ConnectionPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    host: str | None = None
    port: int | None = Field(None, ge=1, le=65535)
    db_user: str | None = None
    db_password: str | None = None
    database: str | None = None
    odbc_driver: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_admin(user: dict) -> None:
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_system_admin(user: dict) -> None:
    if "SystemAdmin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="SystemAdmin role required")


def _validate_driver(driver: str) -> None:
    if driver not in ALLOWED_ODBC_DRIVERS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported ODBC driver. Allowed: {sorted(ALLOWED_ODBC_DRIVERS)}",
        )


def _test_pyodbc(creds: dict) -> None:
    """Attempt a live pyodbc connection. Raises 400 on failure (generic message, detail logged)."""
    driver = creds.get("odbc_driver", "ODBC Driver 17 for SQL Server")
    _validate_driver(driver)
    encrypt = ";Encrypt=yes;TrustServerCertificate=yes" if "18" in driver else ""
    cs = (
        f"DRIVER={{{driver}}};"
        f"SERVER={creds['host']},{creds['port']};"
        f"DATABASE={creds['database']};"
        f"UID={creds['db_user']};"
        f"PWD={creds['db_password']}"
        f"{encrypt}"
    )
    try:
        conn = pyodbc.connect(cs, timeout=5)
        conn.close()
    except Exception as e:
        logger.warning("[connections] Connection test failed: %s", e)
        raise HTTPException(
            status_code=400,
            detail="Connection test failed. Check host, port, credentials, and database name.",
        )


def _parse_connection_id(raw: str) -> str:
    """Validate that a path parameter is a well-formed UUID. Returns the canonical string."""
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid connection ID format")


# ---------------------------------------------------------------------------
# GET /api/connections
# ---------------------------------------------------------------------------


@router.get("")
def list_connections(user: dict = Depends(verify_token)):
    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type
    engine = backend.get_engine()
    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))

    with engine.connect() as conn:
        if is_admin:
            rows = conn.execute(
                text(f"""
                    SELECT "ConnectionId", "Name", "CreatedDate", "ModifiedDate"
                    FROM {qi(schema, "Connections", db_type)}
                    WHERE "IsActive" = :active
                    ORDER BY "Name"
                """),
                {"active": True},
            ).fetchall()
        else:
            rows = conn.execute(
                text(f"""
                    SELECT c."ConnectionId", c."Name", c."CreatedDate", c."ModifiedDate"
                    FROM {qi(schema, "Connections", db_type)} c
                    JOIN {qi(schema, "UserConnectionAccess", db_type)} uca
                        ON uca."ConnectionId" = c."ConnectionId"
                    WHERE uca."UserId" = :uid AND c."IsActive" = :active
                    ORDER BY c."Name"
                """),
                {"uid": user["user_id"], "active": True},
            ).fetchall()

    return [
        {
            "id": str(r[0]),
            "name": r[1],
            "created_date": r[2].isoformat() if r[2] else None,
            "modified_date": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/connections
# ---------------------------------------------------------------------------


@router.post("", status_code=201)
def create_connection(body: ConnectionIn, user: dict = Depends(verify_token)):
    _require_admin(user)
    _validate_driver(body.odbc_driver)

    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type
    engine = backend.get_engine()

    # 1. Duplicate-name check (cheap) before live test (expensive).
    with engine.connect() as conn:
        existing = conn.execute(
            text(f'SELECT 1 FROM {qi(schema, "Connections", db_type)} WHERE "Name" = :name AND "IsActive" = :active'),
            {"name": body.name, "active": True},
        ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="A connection with that name already exists")

    # 2. Live connection test.
    creds = {
        "host": body.host,
        "port": body.port,
        "db_user": body.db_user,
        "db_password": body.db_password,
        "database": body.database,
        "odbc_driver": body.odbc_driver,
    }
    _test_pyodbc(creds)

    # 3. Encrypt and persist.
    encrypted = encrypt_credentials(backend, creds)
    connection_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        conn.execute(
            text(f"""
                INSERT INTO {qi(schema, "Connections", db_type)}
                    ("ConnectionId", "Name", "ConnectionString", "IsActive",
                     "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate")
                VALUES
                    (:cid, :name, :cs, :active,
                     :uid, :now, :uid, :now)
            """),
            {
                "cid": connection_id,
                "name": body.name,
                "cs": encrypted,
                "active": True,
                "uid": user["user_id"],
                "now": now,
            },
        )

    return {"id": connection_id, "name": body.name}


# ---------------------------------------------------------------------------
# PATCH /api/connections/{connection_id}
# ---------------------------------------------------------------------------


@router.patch("/{connection_id}")
def update_connection(
    connection_id: str,
    body: ConnectionPatch,
    user: dict = Depends(verify_token),
):
    _require_admin(user)
    cid = _parse_connection_id(connection_id)

    if body.odbc_driver is not None:
        _validate_driver(body.odbc_driver)

    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type
    engine = backend.get_engine()
    now = datetime.now(timezone.utc)

    # 1. Fetch current row (read-only — no transaction yet).
    with engine.connect() as conn:
        row = conn.execute(
            text(f"""
                SELECT "ConnectionId", "Name", "ConnectionString"
                FROM {qi(schema, "Connections", db_type)}
                WHERE "ConnectionId" = :cid AND "IsActive" = :active
            """),
            {"cid": cid, "active": True},
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")

    current_creds = decrypt_credentials(backend, row[2])

    updated_creds = {
        "host": body.host if body.host is not None else current_creds["host"],
        "port": body.port if body.port is not None else current_creds["port"],
        "db_user": body.db_user if body.db_user is not None else current_creds["db_user"],
        "db_password": body.db_password if body.db_password is not None else current_creds["db_password"],
        "database": body.database if body.database is not None else current_creds["database"],
        "odbc_driver": body.odbc_driver if body.odbc_driver is not None else current_creds["odbc_driver"],
    }
    new_name = body.name if body.name is not None else row[1]

    # 2. Name-collision check before live test.
    if new_name != row[1]:
        with engine.connect() as conn:
            conflict = conn.execute(
                text(f"""
                    SELECT 1 FROM {qi(schema, "Connections", db_type)}
                    WHERE "Name" = :name AND "ConnectionId" != :cid AND "IsActive" = :active
                """),
                {"name": new_name, "cid": cid, "active": True},
            ).fetchone()
        if conflict:
            raise HTTPException(status_code=409, detail="A connection with that name already exists")

    # 3. Live test only if credentials changed (outside any open transaction).
    credential_fields = {"host", "port", "db_user", "db_password", "database", "odbc_driver"}
    if any(getattr(body, f) is not None for f in credential_fields):
        _test_pyodbc(updated_creds)

    # 4. Encrypt and write.
    new_encrypted = encrypt_credentials(backend, updated_creds)

    with engine.begin() as conn:
        result = conn.execute(
            text(f"""
                UPDATE {qi(schema, "Connections", db_type)}
                SET "Name" = :name,
                    "ConnectionString" = :cs,
                    "ModifiedById" = :uid,
                    "ModifiedDate" = :now
                WHERE "ConnectionId" = :cid AND "IsActive" = :active
            """),
            {
                "name": new_name,
                "cs": new_encrypted,
                "uid": user["user_id"],
                "now": now,
                "cid": cid,
                "active": True,
            },
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Connection not found")

    return {"id": cid, "name": new_name}


# ---------------------------------------------------------------------------
# DELETE /api/connections/{connection_id}
# ---------------------------------------------------------------------------


@router.delete("/{connection_id}", status_code=204)
def delete_connection(connection_id: str, user: dict = Depends(verify_token)):
    _require_system_admin(user)
    cid = _parse_connection_id(connection_id)

    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type
    engine = backend.get_engine()
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        row = conn.execute(
            text(f"""
                SELECT 1 FROM {qi(schema, "Connections", db_type)}
                WHERE "ConnectionId" = :cid AND "IsActive" = :active
            """),
            {"cid": cid, "active": True},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Connection not found")

        conn.execute(
            text(f"""
                UPDATE {qi(schema, "Connections", db_type)}
                SET "IsActive" = :active,
                    "ModifiedById" = :uid,
                    "ModifiedDate" = :now
                WHERE "ConnectionId" = :cid
            """),
            {"active": False, "uid": user["user_id"], "now": now, "cid": cid},
        )
