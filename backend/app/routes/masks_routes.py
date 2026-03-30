# app/routes/masks_routes.py
#
# Phase 3 — Column-level data masking (#15).
#
# Mask management endpoints — Admin role required for all operations.
# Masks are stored in the admin-it core schema (ColumnMasks table).
#
# Security model:
#   - All endpoints require a valid JWT with Admin or SystemAdmin role.
#   - Column existence is validated against INFORMATION_SCHEMA on the target
#     connection before a mask is saved — names are not stored unless confirmed.
#   - DELETE is scoped to both MaskId AND ConnectionId to prevent cross-connection
#     deletion by a crafted request.
#   - The ColumnMasks table is always queried via the core engine (backend), never
#     via a target connection.

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.routes.browse_routes import TARGET_QUERY_TIMEOUT_SECONDS, _open_target, _require_connection_access
from app.utils.auth_dependency import verify_token
from app.utils.db_helpers import get_backend
from app.utils.sql_helpers import quote_ident as qi

router = APIRouter()
logger = logging.getLogger(__name__)

ADMIN_ROLES = {"Admin", "SystemAdmin"}


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class MaskIn(BaseModel):
    schema_name: str = Field(..., min_length=1, max_length=128)
    table_name: str = Field(..., min_length=1, max_length=128)
    column_name: str = Field(..., min_length=1, max_length=128)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require_admin(user: dict) -> None:
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")


def _validate_uuid(value: str, name: str) -> str:
    """Raise 422 if value is not a valid UUID. Returns the value unchanged."""
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid {name}: {value!r}")
    return value


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/masks
# ---------------------------------------------------------------------------


@router.get("/{connection_id}/masks")
def list_masks(connection_id: str, user: dict = Depends(verify_token)):
    """List all column masks configured for a connection.

    Admin role required.
    """
    _require_admin(user)
    _validate_uuid(connection_id, "connection_id")

    backend = get_backend()
    mask_table = qi(backend.schema, "ColumnMasks", backend.db_type)

    with backend.get_engine().connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT MaskId, ConnectionId, SchemaName, TableName, ColumnName, "
                f"CreatedById, CreatedDate "
                f"FROM {mask_table} "
                f"WHERE ConnectionId = :cid "
                f"ORDER BY SchemaName, TableName, ColumnName"
            ),
            {"cid": connection_id},
        ).fetchall()

    return [
        {
            "mask_id": str(row[0]),
            "connection_id": str(row[1]),
            "schema_name": row[2],
            "table_name": row[3],
            "column_name": row[4],
            "created_by": str(row[5]) if row[5] else None,
            "created_date": row[6].isoformat() if row[6] else None,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/connections/{connection_id}/masks
# ---------------------------------------------------------------------------


@router.post("/{connection_id}/masks", status_code=201)
def add_mask(connection_id: str, body: MaskIn, user: dict = Depends(verify_token)):
    """Add a column mask for a connection.

    Admin role required.  The schema/table/column are validated against
    INFORMATION_SCHEMA on the target connection before saving.

    Returns 409 if the exact same column is already masked for this connection.
    Returns 422 if the column does not exist on the target database.
    """
    _require_admin(user)
    _validate_uuid(connection_id, "connection_id")

    backend = get_backend()
    schema = backend.schema
    db_type = backend.db_type

    # _require_connection_access validates connection existence and activity (404 if missing/inactive)
    # and enforces user-level access control (403 if lacking UserConnectionAccess).
    # The explicit existence check is intentionally omitted here — it is redundant.
    creds = _require_connection_access(connection_id, user)

    # Validate schema/table/column against the target connection's INFORMATION_SCHEMA.
    # Use canonical names returned by the DB (not user-supplied strings) for storage,
    # so the stored mask reliably matches during load_masks comparison even on
    # case-sensitive collation configurations.
    try:
        with _open_target(creds) as target:
            cursor = target.cursor()
            cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
            cursor.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                (body.schema_name, body.table_name, body.column_name),
            )
            col_row = cursor.fetchone()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[masks] Failed to validate column on target: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="Could not validate column against the target database.",
        )

    if not col_row:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Column '{body.column_name}' not found in {body.schema_name}.{body.table_name} on the target database."
            ),
        )

    # Use DB-canonical schema, table, and column names (row[0], row[1], row[2]).
    canonical_schema, canonical_table, canonical_col = col_row[0], col_row[1], col_row[2]

    # Insert the mask row.
    mask_table = qi(schema, "ColumnMasks", db_type)
    new_id = str(uuid.uuid4())

    try:
        with backend.get_engine().begin() as conn:
            row = conn.execute(
                text(
                    f"INSERT INTO {mask_table} "
                    "(MaskId, ConnectionId, SchemaName, TableName, ColumnName, CreatedById) "
                    "OUTPUT INSERTED.MaskId, INSERTED.ConnectionId, INSERTED.SchemaName, "
                    "INSERTED.TableName, INSERTED.ColumnName, INSERTED.CreatedById, INSERTED.CreatedDate "
                    "VALUES (:mid, :cid, :schema, :table, :col, :uid)"
                ),
                {
                    "mid": new_id,
                    "cid": connection_id,
                    "schema": canonical_schema,
                    "table": canonical_table,
                    "col": canonical_col,
                    "uid": user["user_id"],
                },
            ).fetchone()
    except Exception as exc:
        err_str = str(exc)
        # SQL Server uniqueness violation = error 2627 or 2601.
        if "2627" in err_str or "2601" in err_str or "UNIQUE" in err_str.upper():
            raise HTTPException(
                status_code=409,
                detail="This column is already masked for this connection.",
            )
        logger.exception("[masks] Failed to insert mask row")
        raise

    return {
        "mask_id": str(row[0]),
        "connection_id": str(row[1]),
        "schema_name": row[2],
        "table_name": row[3],
        "column_name": row[4],
        "created_by": str(row[5]) if row[5] else None,
        "created_date": row[6].isoformat() if row[6] else None,
    }


# ---------------------------------------------------------------------------
# DELETE /api/connections/{connection_id}/masks/{mask_id}
# ---------------------------------------------------------------------------


@router.delete("/{connection_id}/masks/{mask_id}", status_code=204)
def delete_mask(connection_id: str, mask_id: str, user: dict = Depends(verify_token)):
    """Remove a column mask.

    Admin role required.  Scoped to both MaskId AND ConnectionId so a crafted
    request cannot delete masks belonging to another connection.

    Returns 404 if the mask does not exist for this connection.
    """
    _require_admin(user)
    _validate_uuid(connection_id, "connection_id")
    _validate_uuid(mask_id, "mask_id")

    backend = get_backend()
    mask_table = qi(backend.schema, "ColumnMasks", backend.db_type)

    # Use OUTPUT DELETED to reliably detect whether the row existed.
    # rowcount can be -1 on some MSSQL/pyodbc configurations.
    with backend.get_engine().begin() as conn:
        deleted = conn.execute(
            text(f"DELETE FROM {mask_table} OUTPUT DELETED.MaskId WHERE MaskId = :mid AND ConnectionId = :cid"),
            {"mid": mask_id, "cid": connection_id},
        ).fetchone()

    if deleted is None:
        raise HTTPException(status_code=404, detail="Mask not found")
