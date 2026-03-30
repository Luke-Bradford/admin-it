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
