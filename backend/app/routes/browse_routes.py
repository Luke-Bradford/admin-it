# app/routes/browse_routes.py
#
# Phase 3 — Data browser (#12): table browser endpoints.
#
# These endpoints query the *target* database (a user-managed connection) via
# INFORMATION_SCHEMA, distinct from the admin-it core schema.
#
# Security model:
#   - All endpoints require a valid JWT (verify_token).
#   - Admins / SystemAdmins see all active connections.
#   - Regular users must have a row in [adm].[UserConnectionAccess] for the
#     requested connection.
#   - Target-DB queries use parameterised statements only; schema/table name
#     path parameters are passed as bind values to INFORMATION_SCHEMA queries
#     (never interpolated into SQL).
#   - pyodbc connection string values are brace-escaped to prevent connection-
#     string injection (a semicolon or ODBC keyword in a credential value would
#     otherwise allow injection at the driver level).

import logging

import pyodbc
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.utils.auth_dependency import verify_token
from app.utils.connection_crypto import decrypt_credentials
from app.utils.db_helpers import get_backend
from app.utils.sql_helpers import quote_ident as qi

router = APIRouter()
logger = logging.getLogger(__name__)

ADMIN_ROLES = {"Admin", "SystemAdmin"}

# Maximum time (seconds) to wait for a single query on a target database.
# The pyodbc connect() timeout covers only the connection handshake; this
# covers individual cursor.execute() calls so a slow or hung target DB
# cannot block a FastAPI worker thread indefinitely.
TARGET_QUERY_TIMEOUT_SECONDS = 30


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require_connection_access(connection_id: str, user: dict) -> dict:
    """Fetch the connection row and verify the calling user has access.

    For admins: a single query fetches the ConnectionString directly.
    For non-admins: a single JOIN query fetches the ConnectionString only when
    a matching UserConnectionAccess row exists — no TOCTOU gap.

    Returns the decrypted credentials dict on success.
    Raises 404 if the connection does not exist or is inactive.
    Raises 403 if a non-admin user has no UserConnectionAccess row.
    """
    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type
    engine = backend.get_engine()
    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))

    with engine.connect() as conn:
        if is_admin:
            row = conn.execute(
                text(f"""
                    SELECT "ConnectionString"
                    FROM {qi(schema, "Connections", db_type)}
                    WHERE "ConnectionId" = :cid AND "IsActive" = :active
                """),
                {"cid": connection_id, "active": True},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Connection not found")
        else:
            # Single JOIN — connection existence and access permission checked atomically.
            row = conn.execute(
                text(f"""
                    SELECT c."ConnectionString"
                    FROM {qi(schema, "Connections", db_type)} c
                    JOIN {qi(schema, "UserConnectionAccess", db_type)} uca
                        ON uca."ConnectionId" = c."ConnectionId"
                    WHERE c."ConnectionId" = :cid AND c."IsActive" = :active
                      AND uca."UserId" = :uid
                """),
                {"cid": connection_id, "active": True, "uid": user["user_id"]},
            ).fetchone()
            if not row:
                # Return 403 rather than 404 to avoid leaking connection existence
                # to users who have no access.
                raise HTTPException(status_code=403, detail="Access denied to this connection")

    return decrypt_credentials(backend, row[0])


def _cs_escape(value: str) -> str:
    """Escape a value for safe interpolation into a pyodbc connection string.

    pyodbc DSN values that contain special characters must be wrapped in braces.
    Any literal `}` inside the value is doubled to `}}` so the driver does not
    misinterpret it as the closing brace of the wrapper.

    This prevents connection-string injection: a semicolon or ODBC keyword in
    a credential value (e.g. PWD=x;Trusted_Connection=yes) would otherwise let
    an attacker inject additional DSN directives at the pyodbc layer.
    """
    return "{" + str(value).replace("}", "}}") + "}"


def _open_target(creds: dict) -> pyodbc.Connection:
    """Open a pyodbc connection to the target database.

    Credential values are brace-escaped via _cs_escape() before interpolation
    to prevent connection-string injection.

    Raises 400 if the connection cannot be established.
    """
    driver = creds.get("odbc_driver", "ODBC Driver 17 for SQL Server")
    encrypt = ";Encrypt=yes;TrustServerCertificate=yes" if "18" in driver else ""
    # SERVER= expects "hostname,port" as a single DSN token; brace-escape the
    # combined value so a semicolon in either component cannot inject directives.
    server = _cs_escape(f"{creds['host']},{creds['port']}")
    cs = (
        f"DRIVER={_cs_escape(driver)};"
        f"SERVER={server};"
        f"DATABASE={_cs_escape(creds['database'])};"
        f"UID={_cs_escape(creds['db_user'])};"
        f"PWD={_cs_escape(creds['db_password'])}"
        f"{encrypt}"
    )
    try:
        return pyodbc.connect(cs, timeout=5)
    except Exception as exc:
        logger.warning("[browse] Could not open target connection: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="Could not connect to the target database. Check connection credentials.",
        )


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/schemas
# ---------------------------------------------------------------------------


@router.get("/{connection_id}/schemas")
def list_schemas(connection_id: str, user: dict = Depends(verify_token)):
    """Return the list of user schemas on the target database."""
    creds = _require_connection_access(connection_id, user)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
        # Filter using sys.schemas.schema_id instead of a name-based exclusion
        # list. SQL Server reserves schema_id values >= 16384 for user-created
        # schemas. Built-in fixed-database-role schemas (db_owner, db_datareader,
        # etc.) and system schemas (sys, INFORMATION_SCHEMA, guest) all have
        # schema_id < 16384. 'dbo' has schema_id=1 but is a genuine user schema
        # so it is explicitly included via its fixed schema_id rather than by name.
        cursor.execute("SELECT name FROM sys.schemas WHERE schema_id >= 16384 OR schema_id = 1 ORDER BY name")
        schemas = [row[0] for row in cursor.fetchall()]

    return {"schemas": schemas}


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/schemas/{schema_name}/tables
# ---------------------------------------------------------------------------


@router.get("/{connection_id}/schemas/{schema_name}/tables")
def list_tables(connection_id: str, schema_name: str, user: dict = Depends(verify_token)):
    """Return tables (with approximate row count) for a schema on the target database."""
    creds = _require_connection_access(connection_id, user)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
        # Fetch table list from INFORMATION_SCHEMA — schema_name is a bind parameter.
        cursor.execute(
            "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            schema_name,
        )
        tables_raw = cursor.fetchall()

        # Row counts from sys.dm_db_partition_stats (fast, no full scan).
        # Views are not included in this DMV, so row_count will always be None
        # for VIEW rows — the frontend handles null gracefully.
        # This DMV requires VIEW DATABASE STATE or VIEW SERVER STATE; wrap in
        # try/except so a minimal-privilege account still gets the table list
        # (with null row counts) rather than a hard 500 error.
        try:
            cursor.execute(
                "SELECT o.name, SUM(p.row_count) "
                "FROM sys.objects o "
                "JOIN sys.schemas s ON s.schema_id = o.schema_id "
                "JOIN sys.dm_db_partition_stats p ON p.object_id = o.object_id "
                "WHERE s.name = ? AND o.type IN ('U','V') AND p.index_id IN (0,1) "
                "GROUP BY o.name",
                schema_name,
            )
            row_counts = {row[0]: row[1] for row in cursor.fetchall()}
        except pyodbc.Error:
            # VIEW DATABASE STATE not granted — return null counts rather than failing.
            logger.debug("[browse] list_tables: row count query failed; returning null counts")
            row_counts = {}

    tables = [
        {
            "name": row[0],
            "type": "VIEW" if row[1] == "VIEW" else "TABLE",
            "row_count": row_counts.get(row[0]),
        }
        for row in tables_raw
    ]

    return {"schema": schema_name, "tables": tables}


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/schemas/{schema_name}/tables/{table_name}/columns
# ---------------------------------------------------------------------------


@router.get("/{connection_id}/schemas/{schema_name}/tables/{table_name}/columns")
def list_columns(
    connection_id: str,
    schema_name: str,
    table_name: str,
    user: dict = Depends(verify_token),
):
    """Return column metadata for a specific table on the target database."""
    creds = _require_connection_access(connection_id, user)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
        cursor.execute(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, "
            "NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
            "ORDER BY ORDINAL_POSITION",
            (schema_name, table_name),
        )
        rows = cursor.fetchall()

    if not rows:
        # Could be a non-existent table or a table in the wrong schema — return
        # an empty list rather than 404 so the UI can show "no columns found".
        return {"schema": schema_name, "table": table_name, "columns": []}

    columns = [
        {
            "name": row[0],
            "data_type": row[1],
            "max_length": row[2],
            "numeric_precision": row[3],
            "numeric_scale": row[4],
            "nullable": row[5] == "YES",
            "default": row[6],
            "ordinal": row[7],
        }
        for row in rows
    ]

    return {"schema": schema_name, "table": table_name, "columns": columns}
