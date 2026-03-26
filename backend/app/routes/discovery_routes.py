# app/routes/discovery_routes.py

import logging
import socket
from typing import Literal

import psycopg2
import pyodbc
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.utils.host_resolver import resolve_hostname

router = APIRouter()


class DatabaseDiscoveryRequest(BaseModel):
    db_type: Literal["mssql", "postgres"] = "mssql"
    host: str
    port: int
    user: str
    password: str
    driver: str = "ODBC Driver 17 for SQL Server"
    # If True, host resolves to host.docker.internal (for use when running inside Docker)
    use_localhost_alias: bool = False


@router.get("/drivers")
def list_sql_drivers():
    try:
        drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
        return {"drivers": drivers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ping")
def ping_host(host: str, port: int = 1433, use_localhost_alias: bool = False):
    # Checks if the specified host and port are reachable.
    # If use_localhost_alias is True, host.docker.internal is substituted.
    try:
        resolved = resolve_hostname(host, use_localhost_alias)
        socket.create_connection((resolved, port), timeout=3).close()
        return {"reachable": True}
    except Exception:
        return {"reachable": False}


@router.post("/databases")
def list_databases(request: DatabaseDiscoveryRequest):
    try:
        resolved_host = resolve_hostname(request.host, request.use_localhost_alias)
        logging.info("[discovery] Connecting to %s:%s as %s", resolved_host, request.port, request.user)

        if request.db_type == "postgres":
            conn = psycopg2.connect(
                host=resolved_host,
                port=request.port,
                user=request.user,
                password=request.password,
                dbname="postgres",
                connect_timeout=5,
            )
            cur = conn.cursor()
            # Exclude template databases
            cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
            dbs = [row[0] for row in cur.fetchall()]
            conn.close()
        else:
            cs = (
                f"DRIVER={{{request.driver}}};"
                f"SERVER={resolved_host},{request.port};"
                f"UID={request.user};"
                f"PWD={request.password};"
                "Encrypt=yes;TrustServerCertificate=yes"
            )
            conn = pyodbc.connect(cs, timeout=5)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sys.databases WHERE database_id > 4")
            dbs = [row[0] for row in cursor.fetchall()]
            conn.close()

        return {"databases": dbs}
    except (pyodbc.Error, psycopg2.Error) as e:
        logging.error("[discovery] DB error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logging.error("[discovery] Unexpected error: %s", e)
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")
