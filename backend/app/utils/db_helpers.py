# app/utils/db_helpers.py

from app.backends.mssql_backend import MSSQLBackend, create_mssql_backend
from app.utils.secure_config import load_core_config

# Module-level singleton — initialised once at startup, replaced on config change.
_backend: MSSQLBackend | None = None


def _create_backend(core: dict) -> MSSQLBackend:
    """Factory: build the appropriate backend from the decrypted core-config dict.

    Currently only 'mssql' is supported.  The 'db_type' key defaults to 'mssql'
    for backward compatibility with existing encrypted config files that pre-date
    ticket #78 (which will write the key explicitly).
    When ticket #76 lands, add the 'postgres' branch here.
    """
    db_type = core.get("db_type", "mssql")
    if db_type != "mssql":
        raise RuntimeError(f"Unsupported CORE_DB_TYPE: {db_type!r}. Only 'mssql' is supported in this version.")
    return create_mssql_backend(core)


def init_engine() -> MSSQLBackend:
    """Load config from disk and create the backend singleton.

    Called at startup (via lifespan) and after setup config is written.
    Raises if no config file exists — callers must guard with core_config_exists().
    """
    global _backend

    core = load_core_config()
    _backend = _create_backend(core)
    return _backend


def get_backend() -> MSSQLBackend:
    """Return the cached backend instance.

    Raises RuntimeError if not yet initialised — this surfaces as a 503 via
    auth_dependency before any protected route runs.
    """
    if _backend is None:
        raise RuntimeError("Database backend not initialised. Setup may not be complete.")
    return _backend
