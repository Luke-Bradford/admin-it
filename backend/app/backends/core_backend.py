# app/backends/core_backend.py
#
# Protocol (structural interface) for the admin-it core database backend.
# MSSQLBackend implements this for SQL Server; PostgreSQLBackend will implement
# it in ticket #76.  No inheritance is required — Python's structural subtyping
# means any class with the right shape satisfies the Protocol.

from typing import Protocol

from sqlalchemy.engine import Engine


class CoreBackend(Protocol):
    """Structural interface that every core-database backend must satisfy."""

    schema: str

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

    def get_audit_records(self) -> list[dict]:
        """Return paginated audit records.

        Not yet implemented — placeholder for ticket #76/#77.
        Raises NotImplementedError on all current backends.
        """
        ...
