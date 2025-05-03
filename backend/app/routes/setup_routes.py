# backend/app/routes/setup_routes.py

from fastapi import APIRouter, HTTPException
from app.database.database_setup import DatabaseSetup
from app.utils.secure_string import encrypt_connection_string
import pyodbc

router = APIRouter()

@router.post("/setup")
async def setup_database(connection_details: dict):
    """
    Setup and create the base schema/table after validating DB connection.

    Expected payload:
    {
      "db_host": "localhost",
      "db_port": 1433,
      "db_user": "admin",
      "db_password": "password",
      "db_name": "defaultdb",
      "schema": "adm",
      "odbc_driver": "ODBC Driver 17 for SQL Server"
    }
    """
    try:
        schema = connection_details.get("schema", "adm")
        driver = connection_details.get("odbc_driver", "ODBC Driver 17 for SQL Server")

        trust_cert = (
            ";TrustServerCertificate=yes"
            if "18" in driver
            else ""
        )

        connection_string = (
            f"DRIVER={{{driver}}};"
            f"SERVER={connection_details['db_host']},{connection_details['db_port']};"
            f"DATABASE={connection_details['db_name']};"
            f"UID={connection_details['db_user']};"
            f"PWD={connection_details['db_password']}"
            f"{trust_cert}"
        )

        print("Connecting to DB at:", f"{connection_details['db_host']}:{connection_details['db_port']} / {connection_details['db_name']}")

        # Encrypt connection string if you plan to save it
        encrypted_conn = encrypt_connection_string(connection_string)

        # Run setup
        db_setup = DatabaseSetup(conn_str=connection_string, schema=schema)
        db_setup.run_setup()

        return {"status": "success", "message": "Database setup completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-connection")
async def test_connection(connection_details: dict):
    """
    Test the DB connection with provided credentials before saving or setup.

    Same payload as /setup.
    """
    try:
        driver = connection_details.get("odbc_driver", "ODBC Driver 17 for SQL Server")

        test_string = (
            f"DRIVER={{{driver}}};"
            f"SERVER={connection_details['db_host']},{connection_details['db_port']};"
            f"DATABASE={connection_details['db_name']};"
            f"UID={connection_details['db_user']};"
            f"PWD={connection_details['db_password']}"
        )

        conn = pyodbc.connect(test_string, timeout=5)
        conn.close()
        return {"status": "success", "message": "Connection successful."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")
