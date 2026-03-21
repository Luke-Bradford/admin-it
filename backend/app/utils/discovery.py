# app/utils/discovery.py

import socket
from typing import List

import pyodbc


def test_tcp_connection(host: str, port: int, timeout: float = 2.0) -> bool:
    """
    Simple TCP check to see if a host:port is reachable.
    """
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except (OSError, socket.timeout):
        return False


def get_databases(
    host: str, port: int, user: str, password: str, driver: str = "ODBC Driver 18 for SQL Server"
) -> List[str]:
    """
    Returns a list of databases accessible with the provided credentials.
    """
    conn_str = (
        f"DRIVER={{{driver}}};SERVER={host},{port};UID={user};PWD={password};Encrypt=yes;TrustServerCertificate=yes"
    )
    try:
        conn = pyodbc.connect(conn_str, timeout=3)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sys.databases WHERE state = 0")
        dbs = [row[0] for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return dbs
    except Exception as e:
        raise RuntimeError(f"Failed to fetch databases: {str(e)}")


def list_sql_drivers() -> List[str]:
    """
    Returns installed ODBC SQL Server drivers.
    """
    return [d for d in pyodbc.drivers() if "SQL Server" in d]
