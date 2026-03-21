# backend/app/db.py

import os
from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql import text


class DatabaseConfig:
    """
    Load database configuration from environment variables or dynamic settings.
    If you pass any of the parameters, those will override the corresponding env var.
    """

    def __init__(
        self,
        server: str = None,
        port: int = None,
        user: str = None,
        password: str = None,
        database: str = None,
        odbc_driver: str = None,
        schema: str = None,
    ):
        # dynamic overrides take precedence, otherwise fall back to env
        self.server = server or os.getenv("MSSQL_SERVER")
        # default to 1433 if neither passed nor in env
        self.port = port or int(os.getenv("MSSQL_PORT", "1433"))
        self.user = user or os.getenv("MSSQL_USER")
        self.password = password or os.getenv("MSSQL_PASSWORD")
        self.database = database or os.getenv("MSSQL_DATABASE")
        self.driver = odbc_driver or os.getenv("MSSQL_DRIVER", "ODBC Driver 17 for SQL Server")
        self.schema = schema or os.getenv("MSSQL_SCHEMA", "adm")

    def is_complete(self) -> bool:
        return all(
            [
                self.server,
                self.port,
                self.user,
                self.password,
                self.database,
            ]
        )

    def connection_string(self) -> str:
        """
        Build the ODBC connection string, including encryption/trust settings
        for ODBC 18+ drivers.
        """
        encrypt = ";Encrypt=yes" if "18" in self.driver else ""
        trust = ";TrustServerCertificate=yes" if "18" in self.driver else ""
        raw = (
            f"DRIVER={{{self.driver}}};"
            f"SERVER={self.server},{self.port};"
            f"DATABASE={self.database};"
            f"UID={self.user};"
            f"PWD={self.password}"
            f"{encrypt}{trust}"
        )
        # URL-encode for SQLAlchemy
        params = quote_plus(raw)
        return f"mssql+pyodbc:///?odbc_connect={params}"


def get_engine(
    config: DatabaseConfig,
    pool_size: int = 5,
    max_overflow: int = 10,
) -> Engine:
    """
    Create a SQLAlchemy engine with pooling. Raises if config incomplete.
    """
    if not config.is_complete():
        raise RuntimeError("Incomplete database configuration.")

    try:
        return create_engine(
            config.connection_string(),
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
            pool_timeout=30,
        )
    except SQLAlchemyError as e:
        raise RuntimeError(f"Error creating engine: {e}")


def test_connection(engine: Engine) -> bool:
    """
    Attempt to connect and execute a trivial query.
    """
    try:
        with engine.connect() as conn:
            conn.execute("SELECT 1")
        return True
    except SQLAlchemyError:
        return False


def fetch_secret(engine, schema: str, secret_type: str) -> str:
    """Fetch a secret value from the Secrets table using the given schema."""
    with engine.connect() as conn:
        query = text(f"""
            SELECT SecretValue FROM [{schema}].[Secrets]
            WHERE SecretType = :secret_type
        """)
        result = conn.execute(query, {"secret_type": secret_type}).fetchone()
        if result:
            return result[0]
        raise RuntimeError(f"Secret '{secret_type}' not found in schema '{schema}'")
