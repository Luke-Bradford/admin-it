# app/utils/mask_helpers.py
#
# Loads column masks from the admin-it core schema.
#
# Called from both browse_table and export_table to determine which columns
# are masked for a given connection+schema+table.  Deliberately isolated here
# to avoid circular imports between masks_routes, data_routes, and browse_routes.

import logging

from sqlalchemy import text

from app.backends.core_backend import CoreBackend
from app.utils.sql_helpers import quote_ident as qi

logger = logging.getLogger(__name__)


def load_masks_for_connection(
    backend: CoreBackend,
    connection_id: str,
) -> set[str]:
    """Return a set of lowercase column names that are masked for *any* table
    on the given connection.

    Used by the saved-query run/export endpoints where schema+table context is
    unavailable for arbitrary query results.  Masking is applied by column name
    alone — a conservative over-mask is preferable to under-masking.

    Re-raises on failure: same safe-failure semantics as load_masks().
    """
    mask_table = qi(backend.schema, "ColumnMasks", backend.db_type)
    try:
        with backend.get_engine().connect() as conn:
            rows = conn.execute(
                text(f"SELECT ColumnName FROM {mask_table} WHERE ConnectionId = :cid"),
                {"cid": connection_id},
            ).fetchall()
        return {row[0].lower() for row in rows}
    except Exception:
        logger.exception(
            "[masks] Failed to load connection-level masks for connection=%s",
            connection_id,
        )
        raise


def load_masks(
    backend: CoreBackend,
    connection_id: str,
    schema_name: str,
    table_name: str,
) -> set[str]:
    """Return a set of lowercase column names that are masked for the given
    connection+schema+table.

    Re-raises on failure: failing open (returning an empty set) would silently
    serve unmasked data to non-admin users, which is the wrong safe-failure mode.
    A 500 response is preferable to leaking sensitive data.
    """
    mask_table = qi(backend.schema, "ColumnMasks", backend.db_type)
    try:
        with backend.get_engine().connect() as conn:
            rows = conn.execute(
                text(
                    f"SELECT ColumnName FROM {mask_table} "
                    "WHERE ConnectionId = :cid "
                    "  AND SchemaName = :schema "
                    "  AND TableName = :table"
                ),
                {"cid": connection_id, "schema": schema_name, "table": table_name},
            ).fetchall()
        return {row[0].lower() for row in rows}
    except Exception:
        logger.exception(
            "[masks] Failed to load masks for connection=%s schema=%s table=%s",
            connection_id,
            schema_name,
            table_name,
        )
        raise
