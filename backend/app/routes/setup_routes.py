# app/routes/setup_routes.py

import traceback
import logging
import os
import uuid
import hashlib
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import pyodbc
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from sqlalchemy import text

from app.utils.secure_config import (
    save_core_config,
    load_core_config,
    core_config_exists,
    delete_core_config,
)
from app.database.database_setup import is_core_schema_deployed, deploy_core_schema
from app.utils.db_helpers import get_config_and_engine
from app.utils.host_resolver import resolve_hostname

router = APIRouter()

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
    db_host: str
    db_port: int
    db_user: str
    db_password: str = Field(..., min_length=1)
    db_name: str
    db_schema: str = Field("adm", alias="schema")
    odbc_driver: str = Field("ODBC Driver 17 for SQL Server", alias="odbc_driver")
    use_localhost_alias: bool = False  # ← Added to enable Docker host resolution

    class Config:
        allow_population_by_alias = True
        allow_population_by_field_name = True


class AdminUserInput(BaseModel):
    username: str
    email: str
    password: str


@router.post("/test-connection")
async def test_connection(details: ConnDetails):
    # Resolve host — especially for Docker environments using host.docker.internal
    resolved_host = resolve_hostname(details.db_host, use_localhost_alias=details.use_localhost_alias)
    print(f"[test-connection] Using resolved host: {resolved_host}")

    # Build connection string
    cs = (
        f"DRIVER={{{details.odbc_driver}}};"
        f"SERVER={resolved_host},{details.db_port};"
        f"DATABASE={details.db_name};"
        f"UID={details.db_user};"
        f"PWD={details.db_password}"
        + (";Encrypt=yes;TrustServerCertificate=yes" if "18" in details.odbc_driver else "")
    )
    try:
        conn = pyodbc.connect(cs, timeout=5)
        conn.close()
        return {"status": "success", "message": "Connection OK"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("")
async def setup(details: ConnDetails):
    # Test DB connectivity before saving config
    await test_connection(details)

    raw = details.dict(by_alias=True)
    save_core_config(raw)

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
async def delete_setup():
    delete_core_config()
    return {"configured": False, "status": "success", "message": "Deleted."}


@router.get("/deploy-status")
def check_deploy_status():
    try:
        config, engine = get_config_and_engine()
        deployed = is_core_schema_deployed(engine, schema=config.schema)
        return {"deployed": deployed}
    except Exception as e:
        logging.error(f"Error checking deployment status: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to determine deployment status")


@router.post("/deploy-schema")
def trigger_deploy_schema():
    try:
        config, engine = get_config_and_engine()

        if is_core_schema_deployed(engine, schema=config.schema):
            return JSONResponse(status_code=200, content={"message": "Schema already deployed."})

        deploy_core_schema(engine, schema=config.schema)
        return {"message": "Schema deployed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-admin")
def create_admin_user(user: AdminUserInput):
    try:
        config, engine = get_config_and_engine()
        now = datetime.utcnow()

        with engine.begin() as conn:
            # Prevent duplicate SystemAdmin users
            existing = conn.execute(
                text(f"""
                SELECT COUNT(*)
                FROM [{config.schema}].[Users] u
                JOIN [{config.schema}].[UserRoles] ur ON u.UserId = ur.UserId
                JOIN [{config.schema}].[Roles] r ON ur.RoleId = r.RoleId
                WHERE r.RoleName = 'SystemAdmin'
            """)
            ).scalar()
            if existing > 0:
                raise HTTPException(status_code=400, detail="SystemAdmin user already exists.")

            role_id = conn.execute(
                text(f"""
                SELECT TOP 1 RoleId FROM [{config.schema}].[Roles] WHERE RoleName = 'SystemAdmin'
            """)
            ).scalar()
            if not role_id:
                raise HTTPException(status_code=500, detail="SystemAdmin role not found.")

            user_id = str(uuid.uuid4())
            salt = os.urandom(16).hex()
            hashed = hashlib.sha256((user.password + salt).encode()).hexdigest()

            # Insert User
            conn.execute(
                text(f"""
                INSERT INTO [{config.schema}].[Users] (
                    UserId, Username, Email, PasswordHash,
                    CreatedById, CreatedDate, ModifiedById, ModifiedDate
                ) VALUES (
                    :uid, :username, :email, :phash,
                    NULL, :now, NULL, :now
                )
            """),
                dict(uid=user_id, username=user.username, email=user.email, phash=hashed, now=now),
            )

            # Insert Secret
            conn.execute(
                text(f"""
                INSERT INTO [{config.schema}].[UserSecrets] (
                    UserSecretId, UserId, Salt,
                    CreatedById, CreatedDate, ModifiedById, ModifiedDate
                ) VALUES (
                    :sid, :uid, :salt,
                    NULL, :now, NULL, :now
                )
            """),
                dict(sid=str(uuid.uuid4()), uid=user_id, salt=salt, now=now),
            )

            # Insert Role Mapping
            conn.execute(
                text(f"""
                INSERT INTO [{config.schema}].[UserRoles] (
                    UserId, RoleId, AssignedDate,
                    CreatedById, CreatedDate, ModifiedById, ModifiedDate
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
        config, engine = get_config_and_engine()
        schema = config.schema
        with engine.connect() as conn:
            result = conn.execute(
                text(f"""
                SELECT COUNT(*) FROM [{schema}].[Users] u
                JOIN [{schema}].[UserRoles] ur ON ur.UserId = u.UserId
                JOIN [{schema}].[Roles] r ON r.RoleId = ur.RoleId
                WHERE r.RoleName = 'SystemAdmin'
            """)
            )
            count = result.scalar()
            return {"present": count > 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check for admin user: {e}")
