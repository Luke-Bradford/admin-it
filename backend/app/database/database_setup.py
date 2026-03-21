import logging
import os
import traceback

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

SQL_FILE_PATH = os.path.join(os.path.dirname(__file__), "../sql/spDeployCoreSchema.sql")


def is_core_schema_deployed(engine: Engine, schema: str = "adm") -> bool:
    expected_tables = [
        "Users",
        "UserSecrets",
        "Roles",
        "UserRoles",
        "Connections",
        "ConnectionPermissions",
        "UserConnectionAccess",
        "Secrets",
    ]

    try:
        logging.info(f"Checking core schema deployment for schema: {schema}")
        inspector = inspect(engine)
        existing = inspector.get_table_names(schema=schema)
        logging.info(f"Found tables in schema '{schema}': {existing}")

        existing_lower = {name.lower() for name in existing}
        missing = [t for t in expected_tables if t.lower() not in existing_lower]
        return len(missing) == 0
    except Exception as e:
        logging.error(f"Failed to inspect schema '{schema}': {str(e)}")
        logging.error(traceback.format_exc())
        return False


def deploy_core_schema(engine: Engine, schema: str = "adm") -> None:
    """
    Deploys the core schema by loading and executing the schema deployment SQL script.
    """
    try:
        with open(SQL_FILE_PATH, "r", encoding="utf-8") as file:
            sql_script = file.read()

        # Inject schema name by simple replacement (safe: schema comes from encrypted config, not user input)
        placeholder = "DECLARE @SchemaName NVARCHAR(100) = 'changeme';"
        replacement = f"DECLARE @SchemaName NVARCHAR(100) = '{schema}';"
        sql_script = sql_script.replace(placeholder, replacement)

        with engine.begin() as conn:
            conn.execute(text(sql_script))

        logging.info("Core schema deployed successfully.")
    except SQLAlchemyError as e:
        logging.error(f"SQLAlchemy error during deployment: {e}")
        raise
    except Exception as e:
        logging.error(f"General error during deployment: {e}")
        raise
