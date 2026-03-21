# app/utils/db_helpers.py

from app.db import DatabaseConfig, get_engine
from app.utils.host_resolver import resolve_hostname
from app.utils.secure_config import load_core_config

# Module-level singletons — initialised once at startup, replaced on config change.
_engine = None
_config = None


def init_engine():
    """
    Load config from disk and create the SQLAlchemy engine singleton.
    Called at startup (via lifespan) and after setup config is written.
    Raises if no config file exists — callers must guard with core_config_exists().
    """
    global _engine, _config

    core = load_core_config()
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

    _config = config
    _engine = engine
    return config, engine


def get_config_and_engine():
    """
    Return the cached (config, engine) pair.
    Raises RuntimeError if the engine has not been initialised yet —
    this surfaces as a 503 via auth_dependency before any protected route runs.
    """
    if _engine is None or _config is None:
        raise RuntimeError("Database engine not initialised. Setup may not be complete.")
    return _config, _engine
