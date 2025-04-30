from fastapi import APIRouter, HTTPException
from app.database.database_setup import DatabaseSetup
from app.utils.secure_string import encrypt_connection_string
from app.settings import SCHEMA_NAME

router = APIRouter()

@router.post("/setup")
async def setup_database(connection_details: dict):
    """
    Expected payload:
    {
      "db_host": "localhost",
      "db_port": 1433,
      "db_user": "admin",
      "db_password": "password",
      "db_name": "defaultdb",
      "schema": "adm"
    }
    """
    try:
        schema = connection_details.get("schema", "adm")

        # Build raw pyodbc-style connection string
        connection_string = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={connection_details['db_host']},{connection_details['db_port']};"
            f"DATABASE={connection_details['db_name']};"
            f"UID={connection_details['db_user']};"
            f"PWD={connection_details['db_password']}"
        )

        # Optionally log (without password)
        print("Connecting to DB at:", f"{connection_details['db_host']}:{connection_details['db_port']} / {connection_details['db_name']}")

        # Encrypt if you're going to store it later
        encrypted_conn = encrypt_connection_string(connection_string)

        # Run DB setup
        db_setup = DatabaseSetup(conn_str=connection_string, schema=schema)
        db_setup.run_setup()

        return {"status": "success", "message": "Database setup completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
