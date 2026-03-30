# app/utils/audit_helpers.py
#
# Application-level audit log writer.
#
# SQL triggers cover mutations on core tables (Users, Connections, etc.).
# Operations that are read-only on the target DB but still need an audit
# record — like data exports — must write directly via this helper.

import json
import logging

from sqlalchemy.sql import text

from app.backends.core_backend import CoreBackend
from app.utils.sql_helpers import quote_ident as qi

logger = logging.getLogger(__name__)


def log_export_audit(
    backend: CoreBackend,
    user_id: str,
    connection_id: str,
    schema_name: str,
    table_name: str,
    export_format: str,
    row_count: int,
) -> None:
    """Write a single audit_log row recording a data export event.

    Uses action='INSERT' (the only valid values are INSERT/UPDATE/DELETE per
    the CHECK constraint) and table_name='DataExport' to identify the event
    type.  The new_data JSON carries the semantic payload: connection, schema,
    table, format, and row count.

    Failures are logged but not re-raised — a failed audit write must not
    prevent the export response from being delivered to the caller.
    """
    audit_table = qi(backend.schema, "audit_log", backend.db_type)
    payload = json.dumps(
        {
            "connection_id": connection_id,
            "schema": schema_name,
            "table": table_name,
            "format": export_format,
            "row_count": row_count,
        }
    )
    try:
        with backend.get_engine().begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {audit_table} "
                    "(table_name, record_id, action, changed_by, new_data) "
                    "VALUES (:tbl, NULL, 'INSERT', :uid, :data)"
                ),
                {"tbl": "DataExport", "uid": user_id, "data": payload},
            )
    except Exception:
        logger.exception(
            "[audit] Failed to write export audit row for user=%s connection=%s",
            user_id,
            connection_id,
        )


def log_masked_access_audit(
    backend: CoreBackend,
    user_id: str,
    connection_id: str,
    schema_name: str,
    table_name: str,
    masked_columns: list[str],
) -> None:
    """Write a single audit_log row when a privileged user accesses masked column data.

    Uses action='INSERT' and table_name='MaskedColumnAccess' to identify the
    event type, consistent with the DataExport pattern.  The new_data JSON carries
    connection_id, schema, table, and the list of masked column names that were
    accessed.

    Failures are logged but not re-raised — a failed audit write must not prevent
    the data response from being delivered to the admin user.
    """
    audit_table = qi(backend.schema, "audit_log", backend.db_type)
    payload = json.dumps(
        {
            "connection_id": connection_id,
            "schema": schema_name,
            "table": table_name,
            "masked_columns": masked_columns,
            "user_id": user_id,
        }
    )
    try:
        with backend.get_engine().begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {audit_table} "
                    "(table_name, record_id, action, changed_by, new_data) "
                    "VALUES (:tbl, NULL, 'INSERT', :uid, :data)"
                ),
                {"tbl": "MaskedColumnAccess", "uid": user_id, "data": payload},
            )
    except Exception:
        logger.exception(
            "[audit] Failed to write masked access audit row for user=%s connection=%s",
            user_id,
            connection_id,
        )
