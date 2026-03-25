# app/backends/postgres_backend.py
#
# PostgreSQL implementation of CoreBackend.
# Uses psycopg2 via SQLAlchemy (postgresql+psycopg2://).
#
# Audit context: each request that modifies data should call
# postgres_backend.set_current_user(user_id) before the first DB write.
# The 'begin' event listener propagates this to the Postgres session variable
# app.current_user_id, which the audit triggers read via current_setting().

import logging
import os
from contextvars import ContextVar, Token
from urllib.parse import quote_plus

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.inspection import inspect as sa_inspect

from app.utils.sql_helpers import quote_ident as qi

logger = logging.getLogger(__name__)

# Per-request context variable carrying the authenticated user's UUID string.
# Set by the HTTP middleware in main.py; read by the engine 'begin' listener.
_current_user_id: ContextVar[str | None] = ContextVar("pg_current_user_id", default=None)

_SQL_FILE_PATH = os.path.join(os.path.dirname(__file__), "../sql/deploy_core_schema_postgres.sql")
_SCHEMA_PLACEHOLDER = "__SCHEMA__"

_EXPECTED_TABLES = [
    "Users",
    "UserSecrets",
    "Roles",
    "UserRoles",
    "Connections",
    "ConnectionPermissions",
    "UserConnectionAccess",
    "Secrets",
    "audit_log",
]


class PostgreSQLBackend:
    """PostgreSQL backend for the admin-it core schema."""

    db_type: str = "postgres"

    def __init__(self, engine: Engine, schema: str) -> None:
        self._engine = engine
        self.schema: str = schema
        self._register_begin_listener()

    def _register_begin_listener(self) -> None:
        """Register a SQLAlchemy 'begin' event that sets app.current_user_id
        as a transaction-local Postgres session variable.

        set_config(..., true) is transaction-local (equivalent to SET LOCAL),
        so the value is automatically reset when the transaction ends and the
        connection is returned to the pool.
        """

        @event.listens_for(self._engine, "begin")
        def _set_session_user(conn) -> None:
            uid = _current_user_id.get()
            if uid:
                conn.execute(
                    text("SELECT set_config('app.current_user_id', :uid, true)"),
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
        """Deploy (or re-deploy) the core schema into the Postgres database.

        The SQL script is idempotent: CREATE TABLE IF NOT EXISTS,
        CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING seeds.
        """
        with open(_SQL_FILE_PATH, encoding="utf-8") as fh:
            sql = fh.read()

        sql = sql.replace(_SCHEMA_PLACEHOLDER, self.schema)

        # psycopg2's cursor.execute() accepts a multi-statement string when
        # called via the raw DBAPI connection (bypassing SQLAlchemy's
        # statement splitting).  We use autocommit mode so DDL takes effect
        # immediately without needing an explicit COMMIT.
        raw_conn = self._engine.raw_connection()
        try:
            raw_conn.autocommit = True
            with raw_conn.cursor() as cur:
                cur.execute(sql)
        finally:
            raw_conn.autocommit = False
            raw_conn.close()

        logger.info("[postgres_backend] Core schema deployed successfully.")

    def is_schema_deployed(self) -> bool:
        """Return True if all expected core-schema tables are present."""
        try:
            inspector = sa_inspect(self._engine)
            existing = set(inspector.get_table_names(schema=self.schema))
            missing = [t for t in _EXPECTED_TABLES if t not in existing]
            if missing:
                logger.info("[postgres_backend] Missing tables: %s", missing)
            return len(missing) == 0
        except Exception as exc:
            logger.error("[postgres_backend] is_schema_deployed failed: %s", exc)
            return False

    def fetch_secret(self, secret_type: str) -> str:
        """Fetch a secret value from the Secrets table by SecretType."""
        schema = self.schema
        with self._engine.connect() as conn:
            result = conn.execute(
                text(f'SELECT "SecretValue" FROM {qi(schema, "Secrets", "postgres")} WHERE "SecretType" = :st'),
                {"st": secret_type},
            ).fetchone()
        if result:
            return result._mapping["SecretValue"]
        logger.error("[postgres_backend] Secret '%s' not found in schema '%s'", secret_type, schema)
        raise RuntimeError(f"Secret '{secret_type}' not found.")

    def get_audit_records(self) -> list[dict]:
        """Return the most recent 1000 audit log entries, newest first."""
        schema = self.schema
        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT id, table_name, record_id, action,
                           changed_by, changed_at, old_data, new_data
                    FROM {qi(schema, "audit_log", "postgres")}
                    ORDER BY changed_at DESC
                    LIMIT 1000
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
                "old_data": r._mapping["old_data"],
                "new_data": r._mapping["new_data"],
            }
            for r in rows
        ]


def set_current_user(uid: str | None) -> "Token[str | None]":
    """Set the per-request user ID for the Postgres audit trigger.

    Call this at the start of each request; pair with reset_current_user()
    in a finally block.  Exposed as a public function so callers never
    need to import the private ContextVar directly.
    """
    return _current_user_id.set(uid)


def reset_current_user(token: "Token[str | None]") -> None:
    """Reset the ContextVar to its pre-request state using the token returned by set_current_user()."""
    _current_user_id.reset(token)


def create_postgres_backend(core: dict) -> PostgreSQLBackend:
    """Build and return a PostgreSQLBackend from a decrypted core-config dict."""
    from app.utils.host_resolver import resolve_hostname  # local import avoids circularity

    try:
        resolved_host = resolve_hostname(
            core["db_host"],
            use_localhost_alias=core.get("use_localhost_alias", False),
        )
        port = core.get("db_port", 5432)
        user = core["db_user"]
        password = core["db_password"]
        database = core["db_name"]
        schema = core.get("schema", "adm")
    except KeyError as exc:
        raise RuntimeError(f"Core config is missing required key: {exc}") from exc

    url = f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}@{resolved_host}:{port}/{database}"
    engine = create_engine(
        url,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_timeout=30,
    )
    return PostgreSQLBackend(engine=engine, schema=schema)
