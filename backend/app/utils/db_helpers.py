# app/utils/db_helpers.py

from app.utils.secure_config import load_core_config
from app.db import DatabaseConfig, get_engine
from app.utils.host_resolver import resolve_hostname

def get_config_and_engine():
    core = load_core_config()

    # Resolve hostname only at runtime, leave saved config untouched
    resolved_host = resolve_hostname(
        core["db_host"],
        use_localhost_alias=core.get("use_localhost_alias", False)
    )

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
    return config, engine
