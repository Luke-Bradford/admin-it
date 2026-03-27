# app/routes/setup_routes.py

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import psycopg2
import psycopg2.sql
import pyodbc
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text

from app.utils.auth_dependency import verify_token, verify_token_string
from app.utils.host_resolver import resolve_hostname
from app.utils.secure_config import (
    core_config_exists,
    delete_core_config,
    load_core_config,
    save_core_config,
)
from app.utils.sql_helpers import quote_ident as qi

_optional_bearer = HTTPBearer(auto_error=False)

router = APIRouter()
logger = logging.getLogger(__name__)

# Generate a Fernet key for encrypting core config if not present
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if not ENV_PATH.exists() or "CORE_FERNET_KEY" not in os.environ:
    key = Fernet.generate_key().decode()
    with open(ENV_PATH, "a", encoding="utf-8") as f:
        f.write(f"\nCORE_FERNET_KEY={key}\n")
    os.environ["CORE_FERNET_KEY"] = key

load_dotenv(dotenv_path=ENV_PATH, override=False)
FERNET_KEY = os.getenv("CORE_FERNET_KEY")
if not FERNET_KEY:
    raise RuntimeError("Missing CORE_FERNET_KEY")
fernet = Fernet(FERNET_KEY.encode())


class ConnDetails(BaseModel):
    db_type: Literal["mssql", "postgres"] = "mssql"
    db_host: str
    db_port: int
    db_user: str
    db_password: str = Field(..., min_length=1)
    db_name: str
    db_schema: str = Field("adm", alias="schema")
    odbc_driver: str = Field("ODBC Driver 17 for SQL Server", alias="odbc_driver")
    use_localhost_alias: bool = False

    model_config = {"populate_by_name": True}


class AdminUserInput(BaseModel):
    username: str
    email: str
    password: str


# Allowlist for SQL identifiers used in DDL.  Restricts to characters that are
# safe in both connection string parameters and as quoted SQL identifiers.
# Applied to all user-supplied DDL names (databases, schemas, logins) before
# use in any dynamic SQL, even when bracket/double-quote quoting is also applied.
_IDENT_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _ident(value: str, field: str) -> str:
    if not _IDENT_RE.match(value):
        raise ValueError(f"{field} must contain only letters, digits, and underscores")
    return value


def _bracket(name: str) -> str:
    """Return a SQL Server bracket-quoted identifier.  The name must already
    have passed _ident() validation — brackets alone are not sufficient because
    a closing bracket in the name would break out of the quoted context."""
    return f"[{name}]"


class PgCreateDbRequest(BaseModel):
    db_host: str
    db_port: int = 5432
    superuser: str
    superuser_password: str
    new_db_name: str
    app_user: str = "adminit_app"
    app_user_password: str
    db_schema: str = Field("adm", alias="schema")
    use_localhost_alias: bool = False

    model_config = {"populate_by_name": True}

    @field_validator("new_db_name")
    @classmethod
    def validate_new_db_name(cls, v: str) -> str:
        return _ident(v, "new_db_name")

    @field_validator("app_user")
    @classmethod
    def validate_app_user(cls, v: str) -> str:
        return _ident(v, "app_user")

    @field_validator("db_schema", mode="before")
    @classmethod
    def validate_db_schema(cls, v: str) -> str:
        return _ident(v, "schema")


# Accepted ODBC driver names for SQL Server.  Used both by MssqlCreateDbRequest
# validation and by the encrypt_clause detection — validating against this list
# makes the "18" substring check safe.
_MSSQL_ODBC_DRIVERS = frozenset(["ODBC Driver 17 for SQL Server", "ODBC Driver 18 for SQL Server"])


class MssqlCreateDbRequest(BaseModel):
    db_host: str
    db_port: int = 1433
    sysadmin_user: str
    sysadmin_password: str
    new_db_name: str
    app_login: str = "adminit_app"
    app_login_password: str
    db_schema: str = Field("adm", alias="schema")
    odbc_driver: str = "ODBC Driver 17 for SQL Server"
    use_localhost_alias: bool = False

    model_config = {"populate_by_name": True}

    @field_validator("new_db_name")
    @classmethod
    def validate_new_db_name(cls, v: str) -> str:
        return _ident(v, "new_db_name")

    @field_validator("app_login")
    @classmethod
    def validate_app_login(cls, v: str) -> str:
        return _ident(v, "app_login")

    @field_validator("db_schema", mode="before")
    @classmethod
    def validate_db_schema(cls, v: str) -> str:
        return _ident(v, "schema")

    @field_validator("odbc_driver")
    @classmethod
    def validate_odbc_driver(cls, v: str) -> str:
        if v not in _MSSQL_ODBC_DRIVERS:
            raise ValueError(f"odbc_driver must be one of: {', '.join(sorted(_MSSQL_ODBC_DRIVERS))}")
        return v


@router.post("/create-mssql-db")
async def create_mssql_db(req: MssqlCreateDbRequest):
    """
    SQL Server create-new-database path.

    Only callable before setup is complete — once the core config exists this
    endpoint returns 403.

    Connects with sysadmin credentials to the master database, creates the target
    database, creates a SQL login scoped to that database with least-privilege
    grants, then returns app-login credentials so the caller can proceed with
    the normal setup flow.  Sysadmin credentials are NOT persisted.
    """
    if core_config_exists():
        raise HTTPException(status_code=403, detail="Setup already complete.")

    resolved_host = resolve_hostname(req.db_host, use_localhost_alias=req.use_localhost_alias)
    logger.debug("[create-mssql-db] Using resolved host: %s", resolved_host)

    db = _bracket(req.new_db_name)
    schema = _bracket(req.db_schema)
    login = _bracket(req.app_login)  # DB user has same name as login

    # odbc_driver validated against _MSSQL_ODBC_DRIVERS allowlist — "18" substring check is safe.
    encrypt_clause = ";Encrypt=yes;TrustServerCertificate=yes" if "18" in req.odbc_driver else ""

    # UID and PWD values are brace-wrapped per the ODBC connection string spec so that
    # values containing ';', '=', or '}' cannot break the key=value structure or inject
    # additional connection-string attributes.  A literal '}' inside a brace-wrapped
    # value must be escaped as '}}'; sysadmin_user/password are plain str with no
    # further restriction — the braces are the sole defence here.
    def _cs(database: str) -> str:
        uid = req.sysadmin_user.replace("}", "}}")
        pwd = req.sysadmin_password.replace("}", "}}")
        return (
            f"DRIVER={{{req.odbc_driver}}};"
            f"SERVER={resolved_host},{req.db_port};"
            f"DATABASE={database};"
            f"UID={{{uid}}};"
            f"PWD={{{pwd}}}" + encrypt_clause
        )

    try:
        # --- Step 1: connect to master, create the database and login ---
        with pyodbc.connect(_cs("master"), timeout=10) as master_conn:
            master_conn.autocommit = True
            with master_conn.cursor() as cur:
                # Create database (idempotent)
                cur.execute(f"IF DB_ID(N'{req.new_db_name}') IS NULL CREATE DATABASE {db}")
                # Create login (idempotent).
                # SQL Server does not support bind parameters in DDL, so the password
                # is embedded as a T-SQL string literal.  Single quotes are escaped by
                # doubling them, which is the standard T-SQL escaping mechanism.
                # Both the password and the login name are embedded as T-SQL string
                # literals (SQL Server DDL does not support bind parameters).
                # Single quotes are escaped by doubling — the only injection vector
                # in a T-SQL N'...' literal.  _ident() validation on app_login means
                # it cannot contain single quotes in practice, but we escape anyway
                # for consistency and defence-in-depth.
                escaped_pwd = req.app_login_password.replace("'", "''")
                escaped_login = req.app_login.replace("'", "''")
                cur.execute(
                    f"""
                    IF NOT EXISTS (
                        SELECT 1 FROM sys.server_principals WHERE name = N'{escaped_login}'
                    )
                    CREATE LOGIN {login} WITH PASSWORD = N'{escaped_pwd}'
                    """
                )

        # --- Step 2: connect to the new database, create DB user and grant permissions ---
        with pyodbc.connect(_cs(req.new_db_name), timeout=10) as db_conn:
            db_conn.autocommit = True
            with db_conn.cursor() as cur:
                escaped_schema = req.db_schema.replace("'", "''")
                # Create schema (idempotent)
                cur.execute(
                    f"IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'{escaped_schema}') "
                    f"EXEC('CREATE SCHEMA {schema}')"
                )
                # Create DB user mapped to the login (idempotent)
                cur.execute(
                    f"""
                    IF NOT EXISTS (
                        SELECT 1 FROM sys.database_principals WHERE name = N'{escaped_login}'
                    )
                    CREATE USER {login} FOR LOGIN {login}
                    """
                )
                # Grant least-privilege permissions on the schema
                cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::{schema} TO {login}")
                cur.execute(f"GRANT CREATE TABLE TO {login}")
                cur.execute(f"GRANT ALTER ON SCHEMA::{schema} TO {login}")

    except pyodbc.Error as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("[create-mssql-db] Unexpected error: %s", e)
        raise HTTPException(status_code=500, detail="An unexpected error occurred. Check server logs.")

    return {
        "status": "success",
        "message": f"Database '{req.new_db_name}' created with login '{req.app_login}'.",
        "connection": {
            "db_type": "mssql",
            "db_host": req.db_host,
            "db_port": req.db_port,
            "db_name": req.new_db_name,
            "db_user": req.app_login,
            "schema": req.db_schema,
            "odbc_driver": req.odbc_driver,
            "use_localhost_alias": req.use_localhost_alias,
        },
    }


@router.post("/test-connection")
async def test_connection(details: ConnDetails):
    resolved_host = resolve_hostname(details.db_host, use_localhost_alias=details.use_localhost_alias)
    logger.debug("[test-connection] Using resolved host: %s", resolved_host)

    try:
        if details.db_type == "postgres":
            with psycopg2.connect(
                host=resolved_host,
                port=details.db_port,
                user=details.db_user,
                password=details.db_password,
                dbname=details.db_name,
                connect_timeout=5,
            ):
                pass
        else:
            cs = (
                f"DRIVER={{{details.odbc_driver}}};"
                f"SERVER={resolved_host},{details.db_port};"
                f"DATABASE={details.db_name};"
                f"UID={details.db_user};"
                f"PWD={details.db_password}"
                + (";Encrypt=yes;TrustServerCertificate=yes" if "18" in details.odbc_driver else "")
            )
            with pyodbc.connect(cs, timeout=5):
                pass
        return {"status": "success", "message": "Connection OK"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/create-postgres-db")
async def create_postgres_db(req: PgCreateDbRequest):
    """
    PostgreSQL create-new-database path.

    Only callable before setup is complete — once the core config exists this
    endpoint returns 403 so it cannot be used as a post-install relay for
    arbitrary superuser credentials.

    Connects with superuser credentials, creates the target database and a
    restricted application user, then returns the app-user credentials so the
    caller can proceed with the normal setup flow.  Superuser credentials are
    NOT persisted anywhere after this request completes.
    """
    if core_config_exists():
        raise HTTPException(status_code=403, detail="Setup already complete.")

    resolved_host = resolve_hostname(req.db_host, use_localhost_alias=req.use_localhost_alias)
    logger.debug("[create-postgres-db] Using resolved host: %s", resolved_host)

    # Safe identifier composition — psycopg2.sql.Identifier handles quoting and
    # escaping so that values containing double-quotes cannot break out of the
    # identifier context.
    db_ident = psycopg2.sql.Identifier(req.new_db_name)
    user_ident = psycopg2.sql.Identifier(req.app_user)
    schema_ident = psycopg2.sql.Identifier(req.db_schema)

    try:
        # Connect to the default 'postgres' maintenance DB as superuser.
        with psycopg2.connect(
            host=resolved_host,
            port=req.db_port,
            user=req.superuser,
            password=req.superuser_password,
            dbname="postgres",
            connect_timeout=5,
        ) as su_conn:
            su_conn.autocommit = True
            with su_conn.cursor() as cur:
                # Create the database (skip if it already exists).
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (req.new_db_name,))
                if not cur.fetchone():
                    cur.execute(psycopg2.sql.SQL("CREATE DATABASE {}").format(db_ident))

                # Create the app user (skip if it already exists).
                cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (req.app_user,))
                if not cur.fetchone():
                    cur.execute(
                        psycopg2.sql.SQL("CREATE USER {} WITH PASSWORD %s").format(user_ident),
                        (req.app_user_password,),
                    )

                # Grant connect privilege on the new database.
                cur.execute(psycopg2.sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(db_ident, user_ident))

        # Connect to the new database to grant schema and future-object privileges.
        with psycopg2.connect(
            host=resolved_host,
            port=req.db_port,
            user=req.superuser,
            password=req.superuser_password,
            dbname=req.new_db_name,
            connect_timeout=5,
        ) as db_conn:
            db_conn.autocommit = True
            with db_conn.cursor() as cur2:
                cur2.execute(psycopg2.sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(schema_ident))
                cur2.execute(psycopg2.sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(schema_ident, user_ident))
                cur2.execute(
                    psycopg2.sql.SQL(
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
                    ).format(schema_ident, user_ident)
                )
                cur2.execute(
                    psycopg2.sql.SQL(
                        "ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT USAGE, SELECT ON SEQUENCES TO {}"
                    ).format(schema_ident, user_ident)
                )
                # Cover tables that already exist in the schema (e.g. retry after
                # partial failure, or deploy ran as a different user).
                cur2.execute(
                    psycopg2.sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {} TO {}").format(
                        schema_ident, user_ident
                    )
                )
                cur2.execute(
                    psycopg2.sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {} TO {}").format(
                        schema_ident, user_ident
                    )
                )
    except psycopg2.Error as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "success",
        "message": f"Database '{req.new_db_name}' created with user '{req.app_user}'.",
        "connection": {
            "db_type": "postgres",
            "db_host": req.db_host,
            "db_port": req.db_port,
            "db_name": req.new_db_name,
            "db_user": req.app_user,
            "schema": req.db_schema,
            "use_localhost_alias": req.use_localhost_alias,
        },
    }


@router.post("")
async def setup(
    details: ConnDetails,
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    if core_config_exists():
        # System is already configured — require a SystemAdmin JWT to overwrite.
        if credentials is None:
            raise HTTPException(status_code=401, detail="Authorization required to reconfigure a configured system")
        user = verify_token_string(credentials.credentials)
        if "SystemAdmin" not in user.get("roles", []):
            raise HTTPException(status_code=403, detail="SystemAdmin role required")

    await test_connection(details)

    raw = details.model_dump(by_alias=True)
    save_core_config(raw)

    # Reinitialise the backend singleton so protected routes pick up the new config
    # without requiring a server restart. Deferred import avoids a circular import:
    # setup_routes is imported by main.py before db_helpers is fully initialised.
    from app.utils.db_helpers import init_engine  # noqa: PLC0415

    init_engine()  # returns CoreBackend; singleton stored internally in db_helpers

    masked = raw.copy()
    masked["db_password"] = "*" * len(raw["db_password"])
    return {"configured": True, "connection": masked, "status": "success", "message": "Core initialized."}


@router.get("")
async def get_setup():
    if not core_config_exists():
        return {"configured": False}
    try:
        data = load_core_config()
    except InvalidToken:
        delete_core_config()
        return {"configured": False}
    data["db_password"] = "*" * len(data["db_password"])
    return {"configured": True, "connection": data}


@router.delete("")
async def delete_setup(_user: dict = Depends(verify_token)):
    """Delete the core config. Requires a valid JWT with SystemAdmin role."""
    if "SystemAdmin" not in _user.get("roles", []):
        raise HTTPException(status_code=403, detail="SystemAdmin role required")
    delete_core_config()
    return {"configured": False, "status": "success", "message": "Deleted."}


@router.get("/deploy-status")
def check_deploy_status():
    try:
        # Deferred import: db_helpers singleton may not be initialised yet on fresh install.
        from app.utils.db_helpers import get_backend  # noqa: PLC0415

        backend = get_backend()
        deployed = backend.is_schema_deployed()
        return {"deployed": deployed}
    except Exception as e:
        logging.error("Error checking deployment status: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to determine deployment status")


@router.post("/deploy-schema")
def trigger_deploy_schema(
    force: bool = False,
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """
    Deploy the core schema.

    `force=false` (default): no-op if already deployed; safe to call without
    authentication during the initial setup wizard flow.

    `force=true`: re-deploys even when the schema already exists (disaster-
    recovery path). Requires a valid SystemAdmin JWT because the schema can
    only be deployed at this point, meaning setup was previously completed and
    an authenticated admin is making a deliberate decision to overwrite it.
    """
    if force:
        if credentials is None:
            raise HTTPException(status_code=401, detail="Authorization required for force re-deploy")
        user = verify_token_string(credentials.credentials)
        if "SystemAdmin" not in user.get("roles", []):
            raise HTTPException(status_code=403, detail="SystemAdmin role required for force re-deploy")

    try:
        from app.utils.db_helpers import get_backend  # noqa: PLC0415

        backend = get_backend()

        if backend.is_schema_deployed() and not force:
            return JSONResponse(status_code=200, content={"message": "Schema already deployed."})

        backend.deploy_schema()
        return {"message": "Schema deployed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-admin")
def create_admin_user(user: AdminUserInput):
    try:
        from app.utils.db_helpers import get_backend  # noqa: PLC0415
        from app.utils.password import hash_password  # noqa: PLC0415

        backend = get_backend()
        schema = backend.schema
        db_type = backend.db_type
        engine = backend.get_engine()
        now = datetime.now(timezone.utc)

        with engine.begin() as conn:
            existing = conn.execute(
                text(f"""
                SELECT COUNT(*)
                FROM {qi(schema, "Users", db_type)} u
                JOIN {qi(schema, "UserRoles", db_type)} ur ON u."UserId" = ur."UserId"
                JOIN {qi(schema, "Roles", db_type)} r ON ur."RoleId" = r."RoleId"
                WHERE r."RoleName" = 'SystemAdmin'
            """)
            ).scalar()
            if existing > 0:
                raise HTTPException(status_code=400, detail="SystemAdmin user already exists.")

            # RoleName has a UNIQUE constraint so this returns at most one row;
            # no LIMIT/FETCH needed (and FETCH without ORDER BY breaks on SQL Server).
            role_id = conn.execute(
                text(f"""
                SELECT "RoleId" FROM {qi(schema, "Roles", db_type)}
                WHERE "RoleName" = 'SystemAdmin'
            """)
            ).scalar()
            if not role_id:
                raise HTTPException(status_code=500, detail="SystemAdmin role not found.")

            user_id = str(uuid.uuid4())
            # argon2id hash — salt is embedded in the hash string; UserSecrets.Salt
            # is set to an empty string as a sentinel for the argon2id path.
            hashed = hash_password(user.password)

            conn.execute(
                text(f"""
                INSERT INTO {qi(schema, "Users", db_type)} (
                    "UserId", "Username", "Email", "PasswordHash",
                    "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate"
                ) VALUES (
                    :uid, :username, :email, :phash,
                    NULL, :now, NULL, :now
                )
            """),
                dict(uid=user_id, username=user.username, email=user.email, phash=hashed, now=now),
            )

            conn.execute(
                text(f"""
                INSERT INTO {qi(schema, "UserSecrets", db_type)} (
                    "UserSecretId", "UserId", "Salt",
                    "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate"
                ) VALUES (
                    :sid, :uid, :salt,
                    NULL, :now, NULL, :now
                )
            """),
                dict(sid=str(uuid.uuid4()), uid=user_id, salt="", now=now),
            )

            conn.execute(
                text(f"""
                INSERT INTO {qi(schema, "UserRoles", db_type)} (
                    "UserId", "RoleId", "AssignedDate",
                    "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate"
                ) VALUES (
                    :uid, :rid, :now,
                    NULL, :now, NULL, :now
                )
            """),
                dict(uid=user_id, rid=role_id, now=now),
            )

        return {"status": "success", "message": "Admin user created."}

    except HTTPException:
        raise
    except Exception as e:
        logging.error("Failed to create admin user: %s", str(e))
        raise HTTPException(status_code=500, detail="Internal error creating admin user")


@router.get("/admin-status")
def check_admin_user_present():
    try:
        from app.utils.db_helpers import get_backend  # noqa: PLC0415

        backend = get_backend()
        schema = backend.schema
        db_type = backend.db_type
        with backend.get_engine().connect() as conn:
            result = conn.execute(
                text(f"""
                SELECT COUNT(*) FROM {qi(schema, "Users", db_type)} u
                JOIN {qi(schema, "UserRoles", db_type)} ur ON ur."UserId" = u."UserId"
                JOIN {qi(schema, "Roles", db_type)} r ON r."RoleId" = ur."RoleId"
                WHERE r."RoleName" = 'SystemAdmin'
            """)
            )
            count = result.scalar()
            return {"present": count > 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check for admin user: {e}")
