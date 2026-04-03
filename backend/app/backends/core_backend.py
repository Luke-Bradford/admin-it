# app/backends/core_backend.py
#
# Protocol (structural interface) for the admin-it core database backend.
# MSSQLBackend implements this for SQL Server; PostgreSQLBackend will implement
# it in ticket #76.  No inheritance is required — Python's structural subtyping
# means any class with the right shape satisfies the Protocol.

from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from sqlalchemy.engine import Engine


class CoreBackend(Protocol):
    """Structural interface that every core-database backend must satisfy."""

    schema: str
    db_type: str  # "mssql" | "postgres"

    def get_engine(self) -> Engine:
        """Return the SQLAlchemy engine for the core schema database."""
        ...

    def test_connection(self) -> bool:
        """Test the backend's own stored connection. Returns True on success."""
        ...

    def deploy_schema(self) -> None:
        """Deploy (or re-deploy) the core schema into the target database."""
        ...

    def is_schema_deployed(self) -> bool:
        """Return True if the core schema tables are present in the database."""
        ...

    def fetch_secret(self, secret_type: str) -> str:
        """Fetch a secret value from the Secrets table by SecretType."""
        ...

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
        """Return paginated, filtered audit log entries.

        Returns a dict with keys: entries, total_count, page, page_size, total_pages.
        Raises NotImplementedError on backends that do not yet support audit.
        """
        ...
