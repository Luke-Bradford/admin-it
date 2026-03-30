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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require_connection_access(connection_id: str, user: dict) -> dict:
    """Fetch the connection row and verify the calling user has access.

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

    if not is_admin:
        with engine.connect() as conn:
            access = conn.execute(
                text(f"""
                    SELECT 1
                    FROM {qi(schema, "UserConnectionAccess", db_type)}
                    WHERE "ConnectionId" = :cid AND "UserId" = :uid
                """),
                {"cid": connection_id, "uid": user["user_id"]},
            ).fetchone()
        if not access:
            raise HTTPException(status_code=403, detail="Access denied to this connection")

    return decrypt_credentials(backend, row[0])


def _open_target(creds: dict) -> pyodbc.Connection:
    """Open a pyodbc connection to the target database.

    Raises 400 if the connection cannot be established.
    """
    driver = creds.get("odbc_driver", "ODBC Driver 17 for SQL Server")
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
        cursor.execute(
            "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA "
            "WHERE SCHEMA_NAME NOT IN "
            "('information_schema','sys','db_owner','db_accessadmin','db_securityadmin',"
            "'db_ddladmin','db_backupoperator','db_datareader','db_datawriter',"
            "'db_denydatareader','db_denydatawriter','guest') "
            "ORDER BY SCHEMA_NAME"
        )
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
        # Fetch table list from INFORMATION_SCHEMA — schema_name is a bind parameter.
        cursor.execute(
            "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            schema_name,
        )
        tables_raw = cursor.fetchall()

        # Row counts from sys.dm_db_partition_stats (fast, no full scan).
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
        cursor.execute(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, "
            "NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
            "ORDER BY ORDINAL_POSITION",
            schema_name,
            table_name,
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
