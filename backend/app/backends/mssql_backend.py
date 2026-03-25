# app/backends/mssql_backend.py
#
# SQL Server implementation of CoreBackend.
# Wraps the existing DatabaseConfig / engine / schema-deployment logic behind
# the CoreBackend interface so that routes never import MSSQL-specific helpers
# directly.

from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql import text

from app.database.database_setup import deploy_core_schema, is_core_schema_deployed
from app.db import DatabaseConfig, get_engine


class MSSQLBackend:
    """SQL Server backend for the admin-it core schema."""

    def __init__(self, config: DatabaseConfig, engine: Engine) -> None:
        self._config = config
        self._engine = engine
        self.schema: str = config.schema

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
                text(f"SELECT SecretValue FROM [{self.schema}].[Secrets] WHERE SecretType = :st"),
                {"st": secret_type},
            ).fetchone()
        if result:
            return result[0]
        raise RuntimeError(f"Secret '{secret_type}' not found in schema '{self.schema}'")

    def get_audit_records(self) -> list[dict]:
        """Not yet implemented — placeholder for ticket #77.

        Raises NotImplementedError; the audit UI does not exist yet.
        """
        raise NotImplementedError("Audit records not yet implemented for MSSQLBackend (ticket #77)")


def create_mssql_backend(core: dict) -> MSSQLBackend:
    """Build and return an MSSQLBackend from a decrypted core-config dict."""
    from app.utils.host_resolver import resolve_hostname  # local import avoids circularity at module level

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
    engine = get_engine(config)
    return MSSQLBackend(config=config, engine=engine)
