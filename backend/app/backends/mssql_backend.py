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
from contextvars import ContextVar, Token

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
        """

        @event.listens_for(self._engine, "begin")
        def _set_session_user(conn) -> None:
            uid = _current_user_id.get()
            # sp_set_session_context @read_only=0 allows overwrite within the same connection.
            # Passing NULL clears any previously set value when no user is authenticated.
            conn.execute(
                text("EXEC sp_set_session_context N'app_user_id', :uid, @read_only=0"),
                {"uid": uid},
            )

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

    def get_audit_records(self) -> list[dict]:
        """Return the most recent 1000 audit log entries, newest first."""
        schema = self.schema
        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT TOP 1000 id, table_name, record_id, action,
                                    changed_by, changed_at, old_data, new_data
                    FROM {qi(schema, "audit_log", "mssql")}
                    ORDER BY changed_at DESC
                """)
            ).fetchall()
        return [
            {
                "id": str(r._mapping["id"]),
                "table_name": r._mapping["table_name"],
                "record_id": str(r._mapping["record_id"]) if r._mapping["record_id"] else None,
                "action": r._mapping["action"],
                "changed_by": str(r._mapping["changed_by"]) if r._mapping["changed_by"] else None,
                "changed_at": r._mapping["changed_at"].isoformat() if r._mapping["changed_at"] else None,
                "old_data": _parse_json(r._mapping["old_data"]),
                "new_data": _parse_json(r._mapping["new_data"]),
            }
            for r in rows
        ]


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
