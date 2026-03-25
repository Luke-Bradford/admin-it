# app/utils/db_helpers.py

import logging

from app.backends.core_backend import CoreBackend
from app.backends.mssql_backend import create_mssql_backend
from app.utils.secure_config import load_core_config

logger = logging.getLogger(__name__)

# Module-level singleton — initialised once at startup, replaced on config change.
_backend: CoreBackend | None = None


def _create_backend(core: dict) -> CoreBackend:
    """Factory: build the appropriate backend from the decrypted core-config dict.

    The 'db_type' key defaults to 'mssql' for backward compatibility with
    existing encrypted config files that pre-date ticket #78 (which writes
    the key explicitly).
    """
    db_type = core.get("db_type", "mssql")
    if db_type == "mssql":
        return create_mssql_backend(core)
    if db_type == "postgres":
        # Deferred import so that psycopg2 is only required when actually used.
        from app.backends.postgres_backend import create_postgres_backend  # noqa: PLC0415

        return create_postgres_backend(core)
    raise RuntimeError(f"Unsupported db_type: {db_type!r}. Supported values: 'mssql', 'postgres'.")


def init_engine() -> CoreBackend:
    """Load config from disk and create the backend singleton.

    Called at startup (via lifespan) and after setup config is written.
    Raises if no config file exists — callers must guard with core_config_exists().
    """
    global _backend

    core = load_core_config()
    _backend = _create_backend(core)
    return _backend


def get_backend() -> CoreBackend:
    """Return the cached backend instance.

    Raises RuntimeError if not yet initialised — this surfaces as a 503 via
    auth_dependency before any protected route runs.
    """
    if _backend is None:
        raise RuntimeError("Database backend not initialised. Setup may not be complete.")
    return _backend
