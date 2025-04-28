from fastapi import APIRouter, HTTPException
from app.database.database_setup import create_schema_and_table, encrypt_connection_string
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
        # Save the schema they passed
        if "schema" in connection_details:
            SCHEMA_NAME = connection_details["schema"]

        # Build a raw connection string
        connection_string = f"mssql+pyodbc://{connection_details['db_user']}:{connection_details['db_password']}@{connection_details['db_host']}:{connection_details['db_port']}/{connection_details['db_name']}?driver=ODBC+Driver+17+for+SQL+Server"

        # Encrypt the connection string
        encrypted_conn = encrypt_connection_string(connection_string)

        # Run the database setup (schema + table)
        create_schema_and_table(connection_details)

        # (Optional) Save the encrypted_conn to your Connections table here if needed

        return {"status": "success", "message": "Database setup completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
