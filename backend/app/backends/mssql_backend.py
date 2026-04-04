# app/backends/mssql_backend.py
#
# SQL Server implementation of CoreBackend.
# Wraps the existing DatabaseConfig / engine / schema-deployment logic behind
# the CoreBackend interface so that routes never import MSSQL-specific helpers
# directly.
#
# Audit context: each request that modifies data should set the per-request
# ContextVar via set_current_user() before the first DB write.  The 'begin'
# event listener propagates this to SQL Server's SESSION_CONTEXT, which the
# audit triggers read via SESSION_CONTEXT(N'app_user_id').

import json
import logging
import math
from contextvars import ContextVar, Token
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql import text

from app.database.database_setup import deploy_core_schema, is_core_schema_deployed
from app.db import DatabaseConfig, get_engine
from app.utils.sql_helpers import quote_ident as qi

logger = logging.getLogger(__name__)

# Per-request context variable carrying the authenticated user's UUID string.
# Set by the HTTP middleware in main.py; read by the engine 'begin' listener.
_current_user_id: ContextVar[str | None] = ContextVar("mssql_current_user_id", default=None)


def _set_mssql_session_user(conn) -> None:
    """SQLAlchemy 'begin' event handler.  Sets SESSION_CONTEXT(N'app_user_id') to the
    current request's user UUID so SQL Server audit triggers can record who made each change.

    sp_set_session_context @read_only=0 allows overwriting within the same pooled connection.
    Passing NULL clears any previously set value for unauthenticated requests.
    """
    uid = _current_user_id.get()
    conn.execute(
        text("EXEC sp_set_session_context N'app_user_id', :uid, @read_only=0"),
        {"uid": uid},
    )


def set_current_user(uid: str | None) -> "Token[str | None]":
    """Set the per-request user ID for the SQL Server audit trigger.

    Call at the start of each request; pair with reset_current_user() in a finally block.
    """
    return _current_user_id.set(uid)


def reset_current_user(token: "Token[str | None]") -> None:
    """Reset the ContextVar to its pre-request state."""
    _current_user_id.reset(token)


class MSSQLBackend:
    """SQL Server backend for the admin-it core schema."""

    db_type: str = "mssql"

    def __init__(self, engine: Engine, schema: str) -> None:
        self._engine = engine
        self.schema: str = schema
        self._register_begin_listener()

    def _register_begin_listener(self) -> None:
        """Register a SQLAlchemy 'begin' event that sets SESSION_CONTEXT(N'app_user_id').

        SESSION_CONTEXT is connection-scoped on SQL Server, so we explicitly clear it
        at connection checkout (begin) rather than relying on pool cleanup.

        The listener is registered only once per engine instance; subsequent calls
        (e.g. from a second MSSQLBackend wrapping the same engine) are no-ops.
        """
        if event.contains(self._engine, "begin", _set_mssql_session_user):
            return
        event.listen(self._engine, "begin", _set_mssql_session_user)

    def get_engine(self) -> Engine:
        return self._engine

    def test_connection(self) -> bool:
        """Test the backend's stored connection with a trivial SELECT."""
        try:
            with self._engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except SQLAlchemyError:
            return False

    def deploy_schema(self) -> None:
        deploy_core_schema(self._engine, self.schema)

    def is_schema_deployed(self) -> bool:
        return is_core_schema_deployed(self._engine, self.schema)

    def fetch_secret(self, secret_type: str) -> str:
        """Fetch a secret value from [schema].[Secrets] by SecretType."""
        with self._engine.connect() as conn:
            result = conn.execute(
                text(f"SELECT SecretValue FROM {qi(self.schema, 'Secrets', 'mssql')} WHERE SecretType = :st"),
                {"st": secret_type},
            ).fetchone()
        if result:
            return result[0]
        logger.error("[mssql_backend] Secret '%s' not found in schema '%s'", secret_type, self.schema)
        raise RuntimeError(f"Secret '{secret_type}' not found.")

    def get_audit_records(
        self,
        page: int = 1,
        page_size: int = 50,
        table_name: str | None = None,
        action: Literal["INSERT", "UPDATE", "DELETE", "ACCESS", "EXPORT"] | None = None,
        changed_by: UUID | None = None,
        record_id: UUID | None = None,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
    ) -> dict:
        """Return paginated, filtered audit log entries with username resolution."""
        schema = self.schema

        # Apply 24h default only when no date or record filter is present
        if record_id is None and from_dt is None and to_dt is None:
            from_dt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)

        where_clauses = ["1=1"]
        params: dict = {}

        if table_name is not None:
            where_clauses.append("a.[table_name] = :table_name")
            params["table_name"] = table_name

        if action is not None:
            where_clauses.append("a.[action] = :action")
            params["action"] = action

        if changed_by is not None:
            where_clauses.append("a.[changed_by] = :changed_by")
            params["changed_by"] = str(changed_by)

        if record_id is not None:
            where_clauses.append("a.[record_id] = :record_id")
            params["record_id"] = str(record_id)

        if from_dt is not None:
            where_clauses.append("a.[changed_at] >= :from_dt")
            params["from_dt"] = from_dt

        if to_dt is not None:
            where_clauses.append("a.[changed_at] <= :to_dt")
            params["to_dt"] = to_dt

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * page_size

        rows_sql = text(f"""
            SELECT
                a.[id], a.[table_name], a.[record_id], a.[action],
                a.[changed_by], u.[Username] AS [changed_by_username],
                a.[changed_at], a.[old_data], a.[new_data]
            FROM [{schema}].[audit_log] a
            LEFT JOIN [{schema}].[Users] u ON a.[changed_by] = u.[UserId]
            WHERE {where_sql}
            ORDER BY a.[changed_at] DESC
            OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
        """)
        # No LEFT JOIN on Users here — all WHERE clauses reference only a.[...] columns.
        # If a future filter on changed_by_username is added, the JOIN must be added here too.
        count_sql = text(f"""
            SELECT COUNT(*) AS total
            FROM [{schema}].[audit_log] a
            WHERE {where_sql}
        """)

        row_params = {**params, "offset": offset, "page_size": page_size}

        with self._engine.connect() as conn:
            with conn.begin():
                rows = conn.execute(rows_sql, row_params).fetchall()
                total_count = conn.execute(count_sql, params).scalar() or 0

        total_pages = math.ceil(total_count / page_size) if total_count else 1

        return {
            "entries": [
                {
                    "id": str(m["id"]),
                    "table_name": m["table_name"],
                    "record_id": str(m["record_id"]) if m["record_id"] else None,
                    "action": m["action"],
                    "changed_by": str(m["changed_by"]) if m["changed_by"] else None,
                    "changed_by_username": m["changed_by_username"],
                    "changed_at": m["changed_at"].isoformat() if m["changed_at"] else None,
                    "old_data": _parse_json(m["old_data"]),
                    "new_data": _parse_json(m["new_data"]),
                }
                for r in rows
                for m in (r._mapping,)
            ],
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    def get_audit_users(self) -> list[dict]:
        """Return active users for the audit log filter dropdown."""
        schema = self.schema
        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT [UserId], [Username]
                    FROM [{schema}].[Users]
                    WHERE [IsActive] = 1
                    ORDER BY [Username]
                """)
            ).fetchall()
        return [{"id": str(r._mapping["UserId"]), "username": r._mapping["Username"]} for r in rows]


def _parse_json(value: str | None):
    """Parse a JSON string from the MSSQL FOR JSON AUTO column, or return None."""
    if value is None:
        return None
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return value


def create_mssql_backend(core: dict) -> MSSQLBackend:
    """Build and return an MSSQLBackend from a decrypted core-config dict."""
    from app.utils.host_resolver import resolve_hostname  # local import avoids circularity at module level

    try:
        resolved_host = resolve_hostname(core["db_host"], use_localhost_alias=core.get("use_localhost_alias", False))
        config = DatabaseConfig(
            server=resolved_host,
            port=core["db_port"],
            user=core["db_user"],
            password=core["db_password"],
            database=core["db_name"],
            odbc_driver=core["odbc_driver"],
            schema=core["schema"],
        )
    except KeyError as exc:
        raise RuntimeError(f"Core config is missing required key: {exc}") from exc
    engine = get_engine(config)
    return MSSQLBackend(engine=engine, schema=config.schema)
